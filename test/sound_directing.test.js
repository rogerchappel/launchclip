import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DIRECTING, directCues, directSound, measureDirecting, sceneSoundProblems, storySoundWarnings } from "@launchclip/core/sound/directing.mjs";
import { resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { buildMix, mixGraph, scoreGraph } from "../src/scripts/build-mix.mjs";
import { decodeAudio } from "../src/music/beats.js";

const scene = (id, start, end, sound) => ({ id, module: "kinetic-words", start, end, ...(sound ? { sound } : {}) });
const story = (scenes, duration = scenes.at(-1).end) => ({ resolved: { duration }, format: { fps: 30, duration }, scenes });
const problems = (sound, place = {}) => sceneSoundProblems(sound, { start: 3, end: 6, ...place }).errors;
const levelAt = (points, t) => {
  for (let i = 0; i < points.length - 1; i += 1) {
    const [a, la] = points[i], [b, lb] = points[i + 1];
    if (t >= a && t <= b) return la + (lb - la) * (t - a) / (b - a || 1);
  }
  return points.length ? points.at(-1)[1] : 1;
};

test("hush: {at, for} passes; a hush too long, outside its scene or missing at fails", () => {
  assert.deepEqual(problems({ hush: { at: 4, for: 0.5 } }, { hushAt: 4 }), []);
  assert.match(problems({ hush: { at: 4, for: 1.2 } }, { hushAt: 4 })[0], /hush\.for must be 0\.2–0\.8/);
  assert.match(problems({ hush: { at: 7, for: 0.5 } }, { hushAt: 7 })[0], /falls outside the scene/);
  assert.match(problems({ hush: { for: 0.5 } })[0], /hush\.at is required/);
});

test("prelap: 0.15–1 s on a scene after the first passes; on the first scene, too long, or against a tail fails", () => {
  assert.deepEqual(problems({ prelap: 0.4 }), []);
  assert.match(problems({ prelap: 0.4 }, { first: true })[0], /first scene has no cut/);
  assert.match(problems({ prelap: 1.5 })[0], /prelap must be 0\.15–1 s/);
  assert.match(problems({ prelap: 0.4 }, { prevTail: 0.3 })[0], /a J or an L, not both/);
});

test("tail: rings past a cut that exists; on the last scene it fails", () => {
  assert.deepEqual(problems({ tail: 0.3 }), []);
  assert.match(problems({ tail: 0.3 }, { last: true })[0], /last scene has no cut/);
  assert.match(problems({ tail: 0.05 })[0], /tail must be/);
});

test("into: a known transition sound passes; an unknown one, the first scene, or silence with a prelap fails", () => {
  for (const kind of ["riser", "swell", "tape-stop", "hit", "silence"]) assert.deepEqual(problems({ into: kind }), []);
  assert.match(problems({ into: "boom" })[0], /into must be one of/);
  assert.match(problems({ into: "hit" }, { first: true })[0], /no cut into it/);
  assert.match(problems({ into: "silence", prelap: 0.3 })[0], /cannot also arrive early/);
  assert.match(problems({ into: "silence" }, { prevTail: 0.3 })[0], /cannot ring over it/);
});

test("space and focus: the named values pass, anything else fails; unknown fields fail", () => {
  for (const space of ["dry", "room", "hall"]) assert.deepEqual(problems({ space }), []);
  for (const focus of ["voice", "music", "fx"]) assert.deepEqual(problems({ focus }), []);
  assert.match(problems({ space: "cave" })[0], /space must be one of dry, room, hall/);
  assert.match(problems({ focus: "drums" })[0], /focus must be one of voice, music, fx/);
  assert.match(problems({ echo: 1 })[0], /echo is not a sound field/);
});

test("validateStory checks the block in place and resolveStory resolves hush.at anchors", () => {
  const base = { schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 6 } };
  const ok = validateStory({ ...base, scenes: [scene("s1", 0, 3, { hush: { at: 2.5, for: 0.4 } }), scene("s2", 3, 6, { prelap: 0.5, into: "riser" })] });
  assert.deepEqual(ok.errors.filter((error) => error.includes("sound")), []);
  const bad = validateStory({ ...base, scenes: [scene("s1", 0, 3, { prelap: 0.5 }), scene("s2", 3, 6, { tail: 0.3 })] });
  assert.deepEqual(bad.errors.filter((error) => error.includes("sound")), ["scenes[0].sound.prelap: the first scene has no cut to arrive before", "scenes[1].sound.tail: the last scene has no cut to ring past"]);
  const resolved = resolveStory({ ...base, scenes: [scene("s1", 0, 3, { hush: { at: "word:now", for: 0.4 } }), scene("s2", 3, 6)] }, { words: [{ text: "now", start: 2.2, end: 2.5 }] });
  assert.equal(resolved.scenes[0].sound.hush.at, 2.2);
});

test("directSound: a hush dips the beds to −24 dB, a prelap moves the cut early, a tail late, silence gates everything", () => {
  const direct = directSound(story([scene("s1", 0, 3, { hush: { at: 2, for: 0.5 }, tail: 0.4 }), scene("s2", 3, 6, { focus: "music", space: "hall" }), scene("s3", 6, 9, { prelap: 0.6, into: "silence" })]));
  assert.ok(Math.abs(levelAt(direct.levels, 1.75) - DIRECTING.hush) < 0.002);
  assert.equal(levelAt(direct.levels, 2.0), 1);
  // Tail: s1's level holds past the cut at 3 and reaches s2's at 3.4.
  assert.equal(levelAt(direct.levels, 3), 1);
  assert.ok(Math.abs(levelAt(direct.levels, 3.4) - DIRECTING.focus.music) < 0.002);
  // Prelap: s3's level has arrived on the cut, starting 0.6 s before it.
  assert.ok(Math.abs(levelAt(direct.levels, 5.4) - DIRECTING.focus.music) < 0.002);
  assert.deepEqual(direct.cuts.map((cut) => [cut.kind, cut.from, cut.to]), [["tail", 3, 3.4], ["prelap", 5.4, 6]]);
  assert.equal(levelAt(direct.gate, 5.97), 0);
  assert.equal(levelAt(direct.gate, 6.01), 1);
  assert.equal(levelAt(direct.wet, 4.5), 2);
  assert.deepEqual(direct.into, [{ type: "silence", cut: 6, shot: "s3" }]);
  assert.equal(directSound(story([scene("s1", 0, 3)])), null);
});

test("directCues: nothing starts in a hush but what lands on it; a prelapped scene's arrival sounds move early", () => {
  const direct = directSound(story([scene("s1", 0, 3, { hush: { at: 2.5, for: 0.5 } }), scene("s2", 3, 6, { prelap: 0.5 })]));
  const cues = directCues([
    { cue: "tick", at: 2.2, shot: "s1" },
    { cue: "riser", at: 1.2, lands_at: 2.5, shot: "s1" },
    { cue: "whoosh", at: 2.3, align: "peak", shot: "s1" },
    { cue: "impact", at: 2.5, shot: "s1" },
    { cue: "pop", at: 3.1, shot: "s2" },
    { cue: "pop", at: 4.5, shot: "s2" }
  ], direct);
  // A prelap that moves an arrival sound into a hush loses it there.
  const into = directSound(story([scene("s1", 0, 3, { hush: { at: 2.8, for: 0.6 } }), scene("s2", 3, 6, { prelap: 0.6 })]));
  assert.deepEqual(directCues([{ cue: "pop", at: 3.1, shot: "s2" }], into), []);
  assert.deepEqual(cues.map((cue) => [cue.cue, cue.at]), [["riser", 1.2], ["whoosh", 2.3], ["impact", 2.5], ["pop", 2.6], ["pop", 4.5]]);
});

test("story warnings: planned silences per length, one held breath, early sound, a hush over words", () => {
  const long = story([scene("s1", 0, 25, { hush: { at: 10, for: 0.3 } }), scene("s2", 25, 50)]);
  const warnings = storySoundWarnings(long, { words: [{ text: "wait", start: 9.8, end: 10.1 }] });
  assert.ok(warnings.some((line) => /1 planned silence .* plan 2/.test(line)));
  assert.ok(warnings.some((line) => /no held breath/.test(line)));
  assert.ok(warnings.some((line) => /no early sound/.test(line)));
  assert.ok(warnings.some((line) => /has the word "wait"/.test(line)));
  const good = story([scene("s1", 0, 25, { hush: { at: 10, for: 0.5 } }), scene("s2", 25, 50, { prelap: 0.5, hush: { at: 40, for: 0.4 } })]);
  assert.deepEqual(storySoundWarnings(good, { words: [] }), []);
  assert.deepEqual(storySoundWarnings(story([scene("s1", 0, 50)])), []);
});

test("the mixers multiply the curves into the beds, the room, the cues and the reverb send", () => {
  const direct = directSound(story([scene("s1", 0, 3, { hush: { at: 2, for: 0.5 } }), scene("s2", 3, 6, { into: "silence", space: "hall" })]));
  const cue = { cue: "tick", at: 1, volume: 0.3, file: "t.wav" };
  const plain = mixGraph({ cues: [cue], duration: 6, hasVoice: false, hasMusic: true, hasAmbience: true, direct });
  assert.match(plain, /volume=0\.42,asetnsamples=n=480:p=0,volume='if\(lt\(t,/);
  assert.match(plain, /volume=0\.5,asetnsamples=n=480:p=0,volume='if\(lt\(t,/);
  assert.match(plain, /\[cuewetin\]\[cueir\]afir/);
  assert.equal(mixGraph({ cues: [cue], duration: 6, hasVoice: false, hasMusic: true }), mixGraph({ cues: [cue], duration: 6, hasVoice: false, hasMusic: true, direct: null }));
  const score = scoreGraph({ cues: [cue], duration: 6, hasVoice: false, room: [[0, 0.5]], direct });
  assert.match(score, /volume='0\.5':eval=frame,asetnsamples=n=480:p=0,volume='if/);
  assert.match(score, /volume='0\.07\*\(/);
  assert.match(score, /level=0,asetnsamples=n=480:p=0,volume='if\(lt\(t,/);
});

test("measured in a real mix: the hush is quiet and its hit lands, the prelap leads; without directing both fail", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sound-directing-"));
  try {
    const bed = path.join(dir, "bed.wav");
    const hit = path.join(dir, "hit.wav");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "anoisesrc=d=8:c=pink:r=48000:s=7:a=0.4", "-ac", "2", bed]);
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "aevalsrc=0.9*sin(2*PI*90*t)*exp(-6*t):s=48000:d=0.6", hit]);
    // s1 hushes before its hit at 2.5; s2 leads with the music (+7 dB) 0.6 s before its cut at 5.
    const planned = story([scene("s1", 0, 5, { hush: { at: 2.5, for: 0.5 } }), scene("s2", 5, 8, { prelap: 0.6, focus: "music" })]);
    const direct = directSound(planned);
    const cues = [{ cue: "hit", at: 2.5, volume: 1, file: hit }];
    const mixed = path.join(dir, "directed.wav");
    const flat = path.join(dir, "flat.wav");
    buildMix({ music: bed, cues, duration: 8, out: mixed, musicVolume: 0.3, direct });
    buildMix({ music: bed, cues, duration: 8, out: flat, musicVolume: 0.3 });
    const [directed, plain] = [await decodeAudio(mixed), await decodeAudio(flat)];
    {
      const good = measureDirecting(directed.samples, directed.sampleRate, direct);
      assert.deepEqual(good.errors, []);
      assert.ok(good.hushes[0].depth_db >= DIRECTING.hushDepthDb, `hush only ${good.hushes[0].depth_db} dB down`);
      assert.ok(Math.abs(good.hushes[0].hit_at - 2.5) <= DIRECTING.hitWindow);
      assert.ok(good.cuts[0].measured >= 0.3, `prelap led by ${good.cuts[0].measured} s`);
      const bad = measureDirecting(plain.samples, plain.sampleRate, direct);
      assert.equal(bad.hushes[0].ok, false);
      assert.equal(bad.cuts[0].ok, false);
      assert.equal(bad.errors.length, 2);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("finish turns into into cues on the cut: a riser and a softer swell end on it, a tape stop runs out on it, a hit lands on it", async () => {
  const { intoCues } = await import("../src/finish.js");
  const direct = directSound(story([scene("s1", 0, 3), scene("s2", 3, 6, { into: "riser" }), scene("s3", 6, 9, { into: "swell" }), scene("s4", 9, 12, { into: "tape-stop" }), scene("s5", 12, 15, { into: "hit" }), scene("s6", 15, 18, { into: "silence" })]));
  const cues = intoCues(direct);
  assert.deepEqual(cues.map((cue) => [cue.cue, cue.at, cue.lands_at ?? null, cue.source]), [["riser", 1.67, 3, "directing"], ["riser", 4.67, 6, "directing"], ["tape-stop", 8.3, null, "directing"], ["impact", 12, null, "directing"]]);
  assert.ok(cues[1].volume < cues[0].volume);
});

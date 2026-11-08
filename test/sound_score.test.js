import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SCORE_MOMENTS, soundProblems } from "@launchclip/core/sound/options.mjs";
import { STORY_MOMENTS, validateStory } from "@launchclip/core/story.mjs";
import { scoreStandsAlone } from "../src/finish.js";
import { levelExpression, scoreGraph } from "../src/scripts/build-mix.mjs";
import { midiName, noteMidi, planScore, roomLevels, scoreKey, tunedNote } from "../src/sfx/score.js";
import { applyScoreSounds, chipGraph, kickGraph, nativeSound, parseBankPitches, pluckGraph } from "../src/sfx/score_sounds.js";

const scene = (id, start, end, elements = [], extra = {}) => ({ id, module: "ui-scene", start, end, energy: 2, params: { elements }, ...extra });
const story = (scenes, duration = 40) => ({ scenes, format: { width: 1080 }, resolved: { duration } });
const byRole = (cues, role) => cues.filter((cue) => cue.role === role);

test("the story's moment list stays in step with the sound kit's", () => {
  assert.deepEqual(STORY_MOMENTS, [...SCORE_MOMENTS]);
});

test("sound.score must be a boolean", () => {
  assert.deepEqual(soundProblems({ score: true }), []);
  assert.match(soundProblems({ score: "yes" })[0], /sound\.score/);
});

test("a key's notes are its scale, and bass notes are its tonic or fifth", () => {
  const key = scoreKey("A");
  assert.equal(midiName(key.scale(4, 0)), "A4");
  assert.equal(midiName(key.scale(4, 2)), "C#5");
  assert.equal(midiName(key.scale(4, 4)), "E5");
  assert.equal(key.deep, 41.2);
  assert.equal(key.punch, 55);
  assert.equal(key.inScale(noteMidi("C5")), false, "C natural is the minor third of A");
  assert.equal(key.inScale(noteMidi("C#5")), true);
});

test("a sound is moved to the nearest note its key allows", () => {
  const key = scoreKey("A");
  assert.equal(tunedNote(noteMidi("C5"), key), "B4");
  assert.equal(tunedNote(noteMidi("C#5") + 0.2, key), "C#5");
  // In the bass, only the tonic and the fifth: D1 goes to E1, not to a scale note beside it.
  assert.equal(tunedNote(noteMidi("D#1"), key), "E1");
  assert.equal(tunedNote(noteMidi("Ab1"), key), "A1");
});

test("the bank's listing gives each pitched sound its own note", () => {
  const pitches = parseBankPitches("252 sounds\nid dur peak\nclick/double 0.103 0.004 click | dur param, pitch F#7 -27c\nknock/desk 0.224 0.025 tock\nimpact/deep 6.2 0.08 hit,land | dur trim, pitch Eb1 -40c");
  assert.equal(pitches.get("click/double"), noteMidi("F#7") - 0.27);
  assert.equal(pitches.get("impact/deep"), noteMidi("Eb1") - 0.4);
  assert.equal(pitches.has("knock/desk"), false);
});

test("every pitched note the score writes is in its key", () => {
  const unlock = { kind: "lock-cards", at: 0, rect: { x: 100, y: 100, width: 800, height: 400 }, props: { cards: [{ name: "A", unlockAt: 1 }] } };
  const meter = { kind: "meter", at: 0.2, rect: { x: 600, y: 900, width: 400, height: 300 }, props: { from: -31, to: -14, settleAt: 0.8 } };
  const plane = { kind: "scan-plane", at: 0, rect: { x: 0, y: 500, width: 1080, height: 700 }, props: { scanAt: 0.1, scanDur: 2, markers: [{ at: 0.5, x: 0.2 }, { at: 1, x: 0.7 }] } };
  const plan = planScore(story([scene("a", 0, 3, [unlock]), scene("b", 3, 6, [meter]), scene("c", 6, 9, [plane], { hits: [{ at: 7, event: "x", moment: "crystallise" }] }), scene("d", 9, 12, [], { hits: [{ at: 10, event: "y", moment: "promise" }] })], 12), { seed: "s", key: "A" });
  const key = scoreKey("A");
  const notes = plan.cues.flatMap((cue) => [cue.native?.note, cue.native?.a, cue.native?.b, cue.take?.pitch]).filter(Boolean);
  assert.ok(notes.length > 20);
  for (const note of notes) assert.ok(key.inScale(noteMidi(note)), `${note} is not in A major`);
  for (const cue of byRole(plan.cues, "kick")) assert.ok([41.2, 55].includes(cue.native.hz), `kick at ${cue.native.hz} Hz`);
});

test("a scan is an even comb following the playhead, with a blip and a type bar on each find", () => {
  const plane = { kind: "scan-plane", at: 0, rect: { x: 0, y: 500, width: 1080, height: 700 }, props: { scanAt: 0.1, scanDur: 2, markers: [{ at: 0.5, x: 0.2 }, { at: 1.2, x: 0.7 }] } };
  const { cues } = planScore(story([scene("a", 10, 13, [plane])]), { seed: "s" });
  const keys = byRole(cues, "key");
  assert.equal(keys.length, 26, "13 ticks a second for 2 s");
  assert.ok(keys[0].pan < keys.at(-1).pan, "it travels across the speakers");
  const gaps = keys.slice(1).map((cue, i) => cue.at - keys[i].at);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < 0.01, "the comb is even");
  const chips = byRole(cues, "chip");
  assert.deepEqual(chips.map((cue) => cue.at), [10.5, 11.2]);
  assert.ok(noteMidi(chips[1].native.a) > noteMidi(chips[0].native.a), "each find climbs");
  assert.equal(byRole(cues, "strike").length, 2);
});

test("a dial clicks through its detents, slowing and climbing, and stops dead", () => {
  const meter = { kind: "meter", at: 1, rect: { x: 600, y: 900, width: 400, height: 300 }, props: { from: -31, to: -14, settleAt: 1.5 } };
  const { cues } = planScore(story([scene("a", 0, 3), scene("b", 3, 6, [meter])]), { seed: "s" });
  const detents = byRole(cues, "detent");
  assert.ok(detents.length >= 5);
  const gaps = detents.slice(1).map((cue, i) => cue.at - detents[i].at);
  assert.ok(gaps.at(-1) > gaps[0], "it slows into its stop");
  assert.ok(noteMidi(detents.at(-1).take.pitch) > noteMidi(detents[0].take.pitch), "it climbs");
  assert.ok(detents[0].pan > 0, "it sounds where the dial is");
  assert.equal(byRole(cues, "fader").length, 1);
  assert.equal(byRole(cues, "seat")[0].at, 4.5);
  assert.equal(byRole(cues, "stop")[0].at, 4.5);
});

test("a scene that opens big crosses the room over a bass drum, out of a hush", () => {
  const { cues, room, silences } = planScore(story([scene("a", 0, 5), scene("b", 5, 10, [], { energy: 3 }), scene("c", 10, 15, [], { energy: 3 })]), { seed: "s" });
  const crossings = byRole(cues, "cross").filter((cue) => cue.at > 1);
  assert.equal(crossings.length, 2);
  assert.deepEqual(crossings[0].sweep, [-1, 1]);
  assert.deepEqual(crossings[1].sweep, [1, -1], "the next one crosses the other way");
  assert.ok(byRole(cues, "kick").some((cue) => cue.at === 5));
  assert.ok(silences.some((span) => span.to === 5));
  const before = room.find(([t]) => t === 5)?.[1];
  assert.ok(before <= 0.05 && room.some(([t, level]) => t > 5 && t < 5.1 && level >= 1), "the room drops away, then swells on the hit");
});

test("rewards climb from one unlock to the next", () => {
  const cards = (unlockAt) => ({ kind: "lock-cards", at: 0, rect: { x: 0, y: 0, width: 800, height: 400 }, props: { cards: [{ name: "x", unlockAt }] } });
  const { cues } = planScore(story([scene("a", 0, 8, [cards(2)]), scene("b", 8, 16, [cards(2)])]), { seed: "s" });
  const rewards = byRole(cues, "pluck").filter((cue) => cue.intent.includes("level up"));
  assert.equal(rewards.length, 6);
  assert.ok(noteMidi(rewards[3].native.note) > noteMidi(rewards[0].native.note));
  assert.equal(byRole(cues, "sting").length, 2, "the sting is the one sound that repeats, as the motif");
});

test("a moment comes from the planner's hit, and a letdown has no hits on it", () => {
  const { cues, silences } = planScore(story([scene("a", 0, 10, [], { hits: [{ at: 5, event: "cheap", moment: "letdown" }] })]), { seed: "s" });
  assert.equal(byRole(cues, "hollow")[0].at, 5);
  assert.ok(byRole(cues, "sink")[0].at < 5);
  assert.ok(silences.some((span) => span.to === 5 && span.depth === 0));
  assert.equal(cues.filter((cue) => cue.at >= 4.7 && cue.at < 5 && cue.align !== "peak").length, 0, "nothing plays in the hush");
});

test("detail sounds are panned to their element and never run the same take twice", () => {
  const left = { kind: "chip", at: 1, rect: { x: 0, y: 0, width: 200, height: 100 }, props: {} };
  const right = { kind: "chip", at: 2, rect: { x: 880, y: 0, width: 200, height: 100 }, props: {} };
  const more = Array.from({ length: 12 }, (_, i) => ({ kind: "chip", at: 3 + i * 0.5, rect: { x: 400, y: 0, width: 200, height: 100 }, props: {} }));
  const { cues } = planScore(story([scene("a", 0, 12, [left, right, ...more])]), { seed: "s" });
  const details = cues.filter((cue) => cue.intent === "score: chip changes");
  assert.ok(details.find((cue) => cue.at === 1).pan < -0.5);
  assert.ok(details.find((cue) => cue.at === 2).pan > 0.5);
  const takes = details.map((cue) => cue.take.id);
  takes.slice(1).forEach((id, i) => assert.notEqual(id, takes[i]));
});

test("a low density drops the smallest sounds", () => {
  const beats = Array.from({ length: 20 }, (_, i) => ({ at: 0.5 + i * 0.3, set: {} }));
  const element = { kind: "chip", at: 0, rect: { x: 0, y: 0, width: 100, height: 100 }, props: {}, beats };
  const count = (density) => planScore(story([scene("a", 0, 10, [element])], 10), { seed: "s", density }).cues.length;
  assert.ok(count(0.1) < count(0.8));
});

test("a score is the same every time for a story", () => {
  const element = { kind: "chip", at: 1, rect: { x: 0, y: 0, width: 100, height: 100 }, props: {} };
  const make = () => planScore(story([scene("a", 0, 10, [element]), scene("b", 10, 20, [element], { energy: 3 })], 20), { seed: "same" });
  assert.deepEqual(make(), make());
});

test("the room follows the scenes and fades at the end", () => {
  const points = roomLevels([{ start: 0, energy: 1 }, { start: 5, energy: 3 }], [], [], 10);
  assert.ok(points.find(([t]) => t === 5.3)[1] > points.find(([t]) => t === 0.3)[1]);
  assert.deepEqual(points.at(-1), [9.7, 0]);
});

test("the room's level is a straight line between points", () => {
  assert.equal(levelExpression([[0, 1]]), "1");
  assert.equal(levelExpression([[0, 0], [2, 1]]), "if(lt(t,2),0+(1-(0))*(t-0)/(2-0),1)");
});

test("the score's graph places each cue, keeps the voice centred and ducks the rest under it", () => {
  const cues = [{ file: "a.wav", at: 1, volume: 0.5, pan: 0.5 }, { file: "b.wav", at: 2, volume: 0.9, sweep: [-1, 1], sweep_seconds: 1.4 }];
  const graph = scoreGraph({ cues, duration: 5, hasVoice: true, room: [[0, 0.2], [4, 0.5]], mono: [0] });
  assert.match(graph, /\[1\]aformat=channel_layouts=stereo,pan=stereo\|c0=0\.500\*c0\|c1=1\.000\*c1,adelay=1000\.0\|1006\.0,volume=0\.5\[s0\]/);
  assert.match(graph, /\[2\]aformat=channel_layouts=stereo,aeval=.*min\(t\/1\.4,1\).*adelay=2000\.0:all=1,volume=0\.9\[s1\]/);
  assert.match(graph, /\[0\]highpass=f=70,.*pan=stereo\|c0=c0\|c1=c0,asplit=2\[voice\]\[keyraw\]/);
  assert.match(graph, /\[fxraw\]\[k0\]sidechaincompress/);
  assert.match(graph, /\[voice\]\[fx\]\[room\]amix=inputs=3/);
  assert.match(scoreGraph({ cues, duration: 5, hasVoice: false, room: [] }), /\[fx\]\[room\]amix=inputs=2/);
  assert.throws(() => scoreGraph({ cues: [], duration: 5, hasVoice: true, room: [] }), /needs cues/);
});

test("the native sounds are built from their notes", () => {
  assert.match(kickGraph({ hz: 41.2, decay: 1 }).source, /41\.2\*t/);
  assert.match(chipGraph({ a: "A5", b: "E6" }).source, /880\.00.*1318\.51/);
  assert.match(pluckGraph({ note: "A4" }).source, /440\.00/);
});

test("without Earshot the score keeps its native sounds and its kit files, and says so", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "score-"));
  const made = [];
  const run = async (_, args) => { made.push(args.at(-1)); return { stdout: Buffer.alloc(0) }; };
  const cues = [
    { role: "kick", at: 1, volume: 1, native: { type: "kick", hz: 55, decay: 1 }, align: "start" },
    { role: "key", at: 2, volume: 0.3, take: { id: "fit/key/medium" }, file: "/kit/keystroke.wav", align: "start" },
    { role: "tap", at: 3, volume: 0.2, take: { id: "tap/soft" }, align: "start" }
  ];
  const result = await applyScoreSounds(cues, { project, env: {}, bin: null, run });
  assert.equal(result.source, "kit");
  assert.match(result.warnings[0], /Earshot is not installed/);
  assert.equal(result.cues.length, 2, "a cue with no file is dropped");
  assert.equal(result.cues[1].file, "/kit/keystroke.wav");
  assert.ok(result.cues[0].file.endsWith(".wav") && made.includes(result.cues[0].file));
  await rm(project, { recursive: true, force: true });
});

test("with Earshot a pitched take moves to the key and its peak lands on the moment", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "score-"));
  const requests = [];
  const run = async () => ({ stdout: "x/sting 1.0 0.5 sting | dur param, pitch C5\n" });
  const take = async (request) => { requests.push(request); return { file: `/bank/${request.id.replace("/", "_")}.wav`, meta: { peak_s: 0.5 } }; };
  const cues = [{ role: "sting", at: 3, volume: 1, take: { id: "x/sting" }, align: "peak" }, { role: "sting", at: 0.2, volume: 1, take: { id: "x/sting" }, align: "peak" }];
  const result = await applyScoreSounds(cues, { project, key: "A", bin: "/bin/earshot", env: {}, run, take });
  assert.equal(requests.length, 1, "one render per take");
  assert.equal(requests[0].pitch, "B4", "C5 is not in A major");
  const [early, late] = result.cues;
  assert.equal(late.at, 2.5);
  assert.equal(early.at, 0);
  assert.equal(early.offset, 0.3, "a take that would start before 0 loses its head");
  assert.equal(result.source, "earshot");
  await rm(project, { recursive: true, force: true });
});

test("hit.moment is checked by the story's validation", () => {
  const base = { schema: "launchclip.story.v1", format: { width: 1080, height: 1920, fps: 30, duration: 5 }, scenes: [{ id: "a", module: "title", start: 0, end: 5, hits: [{ at: 1, event: "x", moment: "nope" }] }] };
  const result = validateStory(base);
  assert.ok((result.errors ?? []).some((message) => /moment must be one of/.test(message)), JSON.stringify(result.errors));
});

test("the bass drum is deep and has no noise on top", { skip: process.env.LAUNCHCLIP_MEDIA_TESTS !== "1" }, async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "score-"));
  const file = await nativeSound({ type: "kick", hz: 41.2, decay: 1 }, { project });
  const pcm = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-ac", "1", "-ar", "8000", "-f", "f32le", "-"], { maxBuffer: 1 << 26 });
  // Crossings of zero count the pitch: well under 120 a second means no snare or noise in it.
  let crossings = 0;
  for (let i = 4; i + 3 < pcm.length; i += 4) if (pcm.readFloatLE(i) * pcm.readFloatLE(i - 4) < 0) crossings += 1;
  const seconds = pcm.length / 4 / 8000;
  assert.ok(crossings / seconds / 2 < 120, `${(crossings / seconds / 2).toFixed(0)} Hz by zero crossings`);
  await rm(project, { recursive: true, force: true });
});

test("a score plays alone unless a real track or --music is asked for", () => {
  assert.equal(scoreStandsAlone(undefined, undefined), true);
  assert.equal(scoreStandsAlone("synth", undefined), true);
  assert.equal(scoreStandsAlone({ provider: "synth", bpm: 100 }, null), true);
  assert.equal(scoreStandsAlone("assets/track.mp3", undefined), false);
  assert.equal(scoreStandsAlone({ provider: "elevenlabs" }, undefined), false);
  assert.equal(scoreStandsAlone(undefined, "synth"), false);
});

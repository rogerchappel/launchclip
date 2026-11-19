// The hand-in contract (docs/ANIMATION_PIPELINE_RFC.md §5) on a fixture
// story with a frozen show bible: test/fixtures/animation-first-run plus
// test/fixtures/generate-story/BIBLE.json, pinned here. Media are probed
// through stand-ins; the last test decodes real files with ffmpeg.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { bibleCharacter, bibleHash, withBible } from "@launchclip/core/bible.mjs";
import { resolveStoryCast } from "@launchclip/core/characters/cues.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { charactersView } from "@launchclip/core/catalog-characters.mjs";
import { runCli } from "../src/cli.js";
import { HANDIN_REPORT, HANDIN_SCHEMA, applyHandIn, checkHandIn, visionHandInJudge } from "../src/hand_in.js";
import { runFinish } from "../src/finish.js";
import { shotList } from "../src/story_shots.js";
import { readProjectStory } from "../src/story_loader.js";
import { ffmpegMissing, mediaSkip } from "./helpers/media.js";

const FIXTURES = new URL("./fixtures/", import.meta.url);
const PNG = new URL("parity/assets/testsrc.png", FIXTURES);
const SOURCE = { made_with: "a test fixture", licence: "CC0-1.0", generated: false };

// The fixture story pinned to its bible, with the bible's sheets on disk.
async function project() {
  const dir = await mkdtemp(path.join(tmpdir(), "hand-in-"));
  await cp(new URL("animation-first-run/", FIXTURES), dir, { recursive: true });
  const story = JSON.parse(await readFile(path.join(dir, "storyboard.json"), "utf8"));
  // The fixture bible's world and rules; its cast frozen from the story's own rig params.
  const draft = JSON.parse(await readFile(new URL("generate-story/BIBLE.json", FIXTURES), "utf8"));
  const { members } = resolveStoryCast(story);
  const frozen = { ...draft, cast: { style: story.cast.style, characters: story.cast.characters.map(({ id }) => bibleCharacter(members.get(id), { sheet: `bible/sheets/${id}.png` })) } };
  const bible = { ...frozen, hash: bibleHash(frozen) };
  await writeFile(path.join(dir, "BIBLE.json"), JSON.stringify(bible));
  await mkdir(path.join(dir, "bible/sheets"), { recursive: true });
  for (const member of bible.cast.characters) await cp(PNG, path.join(dir, member.sheet));
  await writeFile(path.join(dir, "storyboard.json"), JSON.stringify({ ...withBible(story, bible), audio: { words: "NARRATION.json" } }));
  return { dir, bible, story: (await readProjectStory(dir)).resolved };
}

// Hand in the named assets: a whole shot per id (files only named; the probe stand-in sizes them), and plates.
async function handIn(dir, bible, { shots = [], places = [], hash = bible.hash } = {}) {
  await mkdir(path.join(dir, "assets/shots"), { recursive: true });
  await mkdir(path.join(dir, "assets/plates"), { recursive: true });
  for (const id of shots) await writeFile(path.join(dir, `assets/shots/${id}.mp4`), "");
  for (const place of places) await cp(PNG, path.join(dir, `assets/plates/${place.place}.png`));
  await writeFile(path.join(dir, "HANDIN.json"), JSON.stringify({
    schema: HANDIN_SCHEMA,
    bible_hash: hash,
    shots: shots.map((id) => ({ shot: id, clip: `assets/shots/${id}.mp4`, source_start: 0.3, source: SOURCE })),
    places: places.map((place) => ({ plate: `assets/plates/${place.place}.png`, source: SOURCE, ...place }))
  }));
}

// ffprobe/ffmpeg stand-ins: every clip is the story's size and rate and long enough; plates are 1920×1080.
const fakes = (overrides = {}) => ({
  probe: async (file) => (file.endsWith(".png") ? { width: 1920, height: 1080, fps: 25, frames: 1 } : { width: 1920, height: 1080, fps: 30, frames: 400, ...(overrides.clip?.(file) ?? {}) }),
  measure: async (file) => ({ peak: 0.8, motion: overrides.frozen?.(file) ? 0 : 0.05, frames: 4 }),
  still: async (_video, _at, target) => cp(PNG, target)
});

test("no HANDIN.json: nothing to check", async () => {
  const { dir, story } = await project();
  assert.equal(await checkHandIn(dir, { story, ...fakes() }), null);
});

test("hand-in passes: every shot whole and a plate, applied as clip scenes; the judge is not-checked without a model", async () => {
  const { dir, bible, story } = await project();
  const ids = shotList(story).shots.map((shot) => shot.id);
  await handIn(dir, bible, { shots: ids, places: [{ place: "standing", floor: 0.8 }] });
  const report = await checkHandIn(dir, { story, ...fakes() });
  assert.equal(report.look, "whole-shots");
  assert.equal(report.status, "ready-for-review");
  const whole = report.assets.filter((asset) => asset.kind === "whole-shot");
  assert.equal(whole.length, ids.length);
  assert.ok(whole.every((asset) => asset.status === "used" && asset.judge.status === "not-checked"));
  // Every shot is whole, so the plate has nowhere to go.
  assert.match(report.assets.find((asset) => asset.kind === "plate").reason, /every shot there is handed in whole/);
  const applied = applyHandIn(story, report);
  assert.ok(applied.scenes.every((scene) => scene.module === "clip"));
  assert.deepEqual(applied.scenes[1].params.media, { src: "assets/shots/foal-questions.mp4", sourceStart: 0.3 });
  assert.equal(applied.scenes[1].in, story.scenes[1].in, "the shot keeps its transition");
});

test("a plate passes on its own: the cast stands on it, nothing drawn behind, the plate image in the shared tree", async () => {
  const { dir, bible, story } = await project();
  await handIn(dir, bible, { places: [{ place: "standing", floor: 0.8, light: { dir: 125 } }] });
  const report = await checkHandIn(dir, { story, ...fakes() });
  assert.equal(report.look, "code-drawn");
  const plate = report.assets.find((asset) => asset.kind === "plate");
  assert.equal(plate.status, "used");
  assert.equal(plate.shots.length, shotList(story).shots.length);
  const applied = applyHandIn(story, report);
  const scene = applied.scenes[0];
  assert.deepEqual(scene.params.plate, { src: "assets/plates/standing.png", floor: 0.8 });
  assert.equal(scene.params.light.dir, 125);
  const model = resolveModule(scene, applied, {});
  assert.equal(model.content.backdrop, "plate");
  assert.equal(model.content.drawWorld, null, "no world drawn over the plate");
  const tree = JSON.stringify(charactersView(model));
  assert.ok(tree.includes('"src":"assets/plates/standing.png"'), "both renderers draw the plate from the one tree");
});

test("hand-in fails → code-drawn: each rejection names the fix, and one bad shot drops every whole shot", async () => {
  const { dir, bible, story } = await project();
  const ids = shotList(story).shots.map((shot) => shot.id);
  await handIn(dir, bible, { shots: ids });
  const report = await checkHandIn(dir, { story, ...fakes({ clip: (file) => (file.endsWith("gate-opens.mp4") ? { frames: 20 } : file.endsWith("foal-ready.mp4") ? { width: 1280, height: 720 } : null), frozen: (file) => file.endsWith("gate-wide.mp4") }) });
  const by = (id) => report.assets.find((asset) => asset.shot === id);
  assert.equal(by("gate-opens").status, "rejected");
  assert.match(by("gate-opens").reason, /has 11 frame\(s\) from source_start 0\.3 s; shot gate-opens needs 75/);
  assert.match(by("foal-ready").reason, /is 1280×720; the story is 1920×1080/);
  assert.match(by("gate-wide").reason, /frozen picture/);
  assert.equal(by("mare-playful").status, "unused");
  assert.match(by("mare-playful").reason, /one look per video: .*gate-opens.*every shot is code-drawn/);
  assert.equal(report.look, "code-drawn");
  assert.equal(report.status, "fallback");
  assert.equal(applyHandIn(story, report), story, "nothing applied");
  // --look mixed keeps each passing shot.
  const mixed = await checkHandIn(dir, { story, look: "mixed", ...fakes({ clip: (file) => (file.endsWith("gate-opens.mp4") ? { frames: 20 } : null) }) });
  assert.equal(mixed.look, "mixed");
  const applied = applyHandIn(story, mixed);
  assert.equal(applied.scenes.find((scene) => scene.id === "gate-opens").module, "cast-scene");
  assert.equal(applied.scenes.find((scene) => scene.id === "foal-ready").module, "clip");
});

test("manifest problems reject every asset: a stale bible_hash, a missing source, a file outside assets/", async () => {
  const { dir, bible, story } = await project();
  await handIn(dir, bible, { places: [{ place: "standing" }], hash: "sha256:0000" });
  let report = await checkHandIn(dir, { story, ...fakes() });
  assert.match(report.assets[0].reason, /made against bible 0000; the frozen bible is/);
  const manifest = { schema: HANDIN_SCHEMA, bible_hash: bible.hash, places: [{ place: "standing", plate: "assets/plates/standing.png" }, { place: "kitchen", plate: "../x.png", source: SOURCE }] };
  await writeFile(path.join(dir, "HANDIN.json"), JSON.stringify(manifest));
  report = await checkHandIn(dir, { story, ...fakes() });
  assert.match(report.assets[0].reason, /has no source \{made_with, licence\}/);
  assert.match(report.assets[1].reason, /no shot takes place in "kitchen"/);
});

test("the vision judge rejects art that drops a must_keep item, and is shown the sheets and the frames", async () => {
  const { dir, bible, story } = await project();
  await handIn(dir, bible, { places: [{ place: "standing" }] });
  let asked = null;
  const client = { runStructured: async (request) => { asked = request; return { value: { matches: false, findings: ["a figure stands by the gate"] } }; } };
  const report = await checkHandIn(dir, { story, judge: visionHandInJudge(client), ...fakes() });
  assert.equal(report.assets[0].status, "rejected");
  assert.match(report.assets[0].reason, /the bible check found: a figure stands by the gate/);
  assert.match(asked.input, /background plate for the place: park, day, the standing set/);
  assert.equal(asked.images.length, 1);
  // A whole shot: both characters' sheets, then three frames, with must_keep as the checklist.
  await handIn(dir, bible, { shots: ["gate-opens"] });
  await checkHandIn(dir, { story, judge: visionHandInJudge(client), ...fakes() });
  assert.equal(asked.images.length, 5);
  assert.match(asked.input, /Foal must keep: chestnut foal; small size; white socks/);
});

test("finish draws the hand-in in its resolved copy, writes qa/hand-in.json and reports the gate", async () => {
  const { dir, bible, story } = await project();
  await handIn(dir, bible, { places: [{ place: "standing", floor: 0.8 }] });
  const report = await runFinish(dir, { renderer: "remotion", planOnly: true }, { env: {}, notice() {}, handInHooks: fakes() });
  assert.notEqual(report.status, "failed", JSON.stringify(report.stages.filter((stage) => stage.error)));
  const resolved = JSON.parse(await readFile(path.join(dir, ".launchclip/finish/story.resolved.json"), "utf8"));
  assert.ok(resolved.scenes.every((scene) => scene.params.plate?.src === "assets/plates/standing.png"));
  const written = JSON.parse(await readFile(path.join(dir, HANDIN_REPORT), "utf8"));
  assert.equal(written.assets[0].status, "used");
  assert.equal(JSON.parse(await readFile(path.join(dir, "storyboard.json"), "utf8")).scenes[0].params.plate, undefined, "storyboard.json is never rewritten");
  void story;
});

test("handin check: the command writes the report and exits 1 when anything was rejected", async () => {
  const { dir, bible } = await project();
  await handIn(dir, bible, { places: [{ place: "standing", floor: 2 }] });
  const out = [];
  const before = process.exitCode;
  await runCli(["handin", "check", dir, "--json"], { stdout: { write: (chunk) => out.push(chunk) }, productionAdapters: { handIn: fakes() } });
  try {
    assert.equal(process.exitCode, 1);
    const report = JSON.parse(out.join(""));
    assert.match(report.assets[0].reason, /floor is where the ground sits as a share of the height, 0\.3–1; got 2/);
  } finally {
    process.exitCode = before;
  }
});

test("real files: a moving clip of the story's size passes, a still clip is frozen, a small plate is refused", { skip: mediaSkip(ffmpegMissing()) }, async () => {
  const run = promisify(execFile);
  const { dir, bible, story } = await project();
  await handIn(dir, bible, { shots: ["gate-wide", "gate-opens"], places: [{ place: "standing" }] });
  const make = (name, source) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `${source}:size=1920x1080:rate=30:duration=3`, "-pix_fmt", "yuv420p", path.join(dir, `assets/shots/${name}.mp4`)]);
  await make("gate-wide", "testsrc=decimals=0");
  await make("gate-opens", "color=c=gray");
  const report = await checkHandIn(dir, { story, look: "mixed" });
  const by = (id) => report.assets.find((asset) => asset.shot === id);
  assert.equal(by("gate-wide").status, "used", JSON.stringify(by("gate-wide")));
  assert.match(by("gate-opens").reason, /frozen picture/);
  // The fixture png is 640×360: the right aspect, too small for a 1920 frame.
  assert.match(report.assets.find((asset) => asset.kind === "plate").reason, /640 px wide; it needs at least 960/);
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=1920x1080", "-frames:v", "1", path.join(dir, "assets/plates/standing.png")]);
  const again = await checkHandIn(dir, { story, look: "mixed" });
  assert.equal(again.assets.find((asset) => asset.kind === "plate").status, "used");
});

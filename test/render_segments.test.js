import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chunkWords, narrationWords } from "../kit/core/captions.mjs";
import {
  gatherSegmentInputs,
  hashSegments,
  kitFingerprint,
  planSegments,
  renderWithSegments,
  sceneModels,
  segmentLayers,
  segmentsForScenes,
  storyCaptionChunks,
  storySoundtrack
} from "../src/render_segments.js";
import { resolveStory } from "../src/story.js";
import { segmentSummary } from "../src/finish.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXPLAINER = path.join(ROOT, "examples/story/explainer-9x16");

async function explainer(mutate) {
  const story = JSON.parse(await readFile(path.join(EXPLAINER, "storyboard.json"), "utf8"));
  const words = narrationWords(JSON.parse(await readFile(path.join(EXPLAINER, "NARRATION.json"), "utf8")));
  if (mutate) mutate(story);
  return { story: resolveStory(story, { words }), words };
}

// Inputs as gatherSegmentInputs returns them, without touching the disk.
function inputsFor(story, words, overrides = {}) {
  return { renderer: "remotion", kit: "kit-1", fonts: "fonts-1", captions: chunkWords(words), assets: {}, base: null, models: sceneModels(story), ...overrides };
}

async function hashes(mutate, overrides) {
  const { story, words } = await explainer(mutate);
  const plan = planSegments(story);
  return Object.fromEntries(hashSegments(story, plan, inputsFor(story, words, overrides)).map((segment) => [segment.label, segment.hash]));
}

function changed(before, after) {
  return Object.keys(after).filter((label) => before[label] !== after[label]);
}

const SEGMENT_LABELS = ["s1", "s1+s2", "s2", "s2+s3", "s3", "s3+s4", "s4", "s4+s5", "s5", "s5+s1~loop"];

test("planSegments cuts at layer changes: scene bodies and whole transition overlaps", async () => {
  const { story } = await explainer();
  const plan = planSegments(story);
  assert.equal(plan.frames, 780);
  assert.deepEqual(plan.segments.map((segment) => segment.label), SEGMENT_LABELS);
  assert.deepEqual(plan.segments.map((segment) => segment.kind), ["scene", "transition", "scene", "transition", "scene", "transition", "scene", "transition", "scene", "transition"]);
  // Contiguous, covering every frame exactly once.
  assert.equal(plan.segments[0].startFrame, 0);
  assert.equal(plan.segments.at(-1).endFrame, 780);
  for (let i = 1; i < plan.segments.length; i += 1) assert.equal(plan.segments[i].startFrame, plan.segments[i - 1].endFrame);
  // The camera pans down into s2 over 0.6 s from 4.4 s: s1 is held until the
  // pan settles, and the whole overlap (frames 132–150) is one segment holding both scenes.
  const s1 = segmentLayers(story).find((layer) => layer.key === "s1");
  assert.deepEqual([s1.from, s1.to], [0, 150]);
  const pan = plan.segments[1];
  assert.deepEqual([pan.startFrame, pan.endFrame, pan.scenes], [132, 150, ["s1", "s2"]]);
  // The fade loop ending overlaps s5 for its last 0.4 s.
  assert.deepEqual([plan.segments.at(-1).startFrame, plan.segments.at(-1).scenes], [768, ["s5", "s1"]]);
  assert.deepEqual(segmentsForScenes(plan.segments, ["s3"]).map((segment) => segment.label), ["s2+s3", "s3", "s3+s4"]);
});

test("planSegments: cuts hold nothing, gaps show nothing, overlays split, tiny segments merge", () => {
  const base = {
    format: { width: 1080, height: 1920, fps: 30, duration: 10 },
    resolved: { duration: 10, fps: 30, frames: 300 }
  };
  const cut = planSegments({ ...base, scenes: [
    { id: "a", module: "x", start: 0, end: 5 },
    { id: "b", module: "x", start: 5, end: 10, in: { type: "cut", dur: 0 } }
  ] });
  assert.deepEqual(cut.segments.map((segment) => [segment.label, segment.startFrame, segment.endFrame]), [["a", 0, 150], ["b", 150, 300]]);

  // After a gap longer than 0.1 s the previous plate is not held: the background shows.
  const gap = planSegments({ ...base, scenes: [
    { id: "a", module: "x", start: 0, end: 4 },
    { id: "b", module: "x", start: 5, end: 10, in: { type: "fade", dur: 0.5 } }
  ] });
  assert.deepEqual(gap.segments.map((segment) => [segment.label, segment.kind]), [["a", "scene"], ["gap", "gap"], ["b", "scene"]]);

  // A track-1 overlay scene splits the plate under it.
  const overlay = planSegments({ ...base, scenes: [
    { id: "a", module: "x", start: 0, end: 10 },
    { id: "o", module: "x", track: 1, start: 3, end: 4 }
  ] });
  assert.deepEqual(overlay.segments.map((segment) => [segment.label, segment.kind, segment.startFrame, segment.endFrame]), [["a", "scene", 0, 90], ["a+o", "scene", 90, 120], ["a", "scene", 120, 300]]);

  const merged = planSegments({ ...base, scenes: [
    { id: "a", module: "x", start: 0, end: 5 },
    { id: "b", module: "x", start: 5, end: 10, in: { type: "fade", dur: 0.2 } }
  ] }, { minFrames: 10 });
  assert.deepEqual(merged.segments.map((segment) => [segment.label, segment.startFrame, segment.endFrame]), [["a", 0, 150], ["a+b", 150, 300]]);
});

test("a scene edit invalidates only the segments that show the scene", async () => {
  const before = await hashes();
  assert.deepEqual(Object.keys(before), SEGMENT_LABELS);
  const copy = await hashes((story) => { story.scenes[2].params.title = "Same rate, a bigger pile"; });
  assert.deepEqual(changed(before, copy), ["s2+s3", "s3", "s3+s4"]);
  // s3 morphs from s2.curve, so every segment that draws s3 depends on s2 as well.
  const s2 = await hashes((story) => { story.scenes[1].params.title = "$100 at 8% a year"; });
  assert.deepEqual(changed(before, s2), ["s1+s2", "s2", "s2+s3", "s3", "s3+s4"]);
  // s1 also draws the loop ending.
  const s1 = await hashes((story) => { story.scenes[0].params.words[0].text = "Tiny gains"; });
  assert.deepEqual(changed(before, s1), ["s1", "s1+s2", "s5+s1~loop"]);
});

test("a transition edit invalidates the segments of both scenes it joins", async () => {
  const before = await hashes();
  // s4 fades in over 0.4 s; a 0.5 s push changes s4 and the out-tweens and hold of s3.
  const push = await hashes((story) => { story.scenes[3].in = { type: "push", dur: 0.5, direction: "left" }; });
  assert.deepEqual(changed(before, push), ["s2+s3", "s3", "s3+s4", "s4", "s4+s5"]);
  // The loop ending's transition changes the last plate and the loop layer only.
  const ending = await hashes((story) => { story.ending.in = { type: "fade", dur: 0.4, direction: "left" }; });
  assert.deepEqual(changed(before, ending), ["s5+s1~loop"]);
});

test("the world camera path is hashed per segment: one pan direction invalidates the segments it moves", async () => {
  const story = async (mutate = () => {}) => {
    const dir = path.join(ROOT, "examples/story/world-camera-9x16");
    const value = JSON.parse(await readFile(path.join(dir, "storyboard.json"), "utf8"));
    mutate(value);
    const words = narrationWords(JSON.parse(await readFile(path.join(dir, "NARRATION.json"), "utf8")));
    return { story: resolveStory(value, { words }), words };
  };
  const hashOf = async (mutate) => {
    const { story: resolved, words } = await story(mutate);
    const plan = planSegments(resolved);
    return Object.fromEntries(hashSegments(resolved, plan, inputsFor(resolved, words)).map((segment) => [segment.label, segment.hash]));
  };
  const before = await hashOf();
  assert.deepEqual(Object.keys(before), ["s1", "s1+s2", "s2", "s2+s3", "s3", "s3+s4", "s4", "s4+s5", "s5", "s5+s1~loop"]);
  // s3's pan goes left instead of down: the camera path changes from that move
  // on (s3, s4 and s5 sit elsewhere, the parallax layer has travelled
  // differently, the whip-pan home is longer). s1 and s2 never see it: the
  // move into s2 and everything before s3's pan are unchanged.
  const left = await hashOf((value) => { value.scenes[2].in.direction = "left"; });
  assert.deepEqual(changed(before, left), ["s2+s3", "s3", "s3+s4", "s4", "s4+s5", "s5", "s5+s1~loop"]);
  // Only the camera digest catches s5 and the loop ending: their scenes and
  // transitions did not change, but the camera arrives there from elsewhere
  // and the parallax layer has travelled differently.
  const { story: resolved, words } = await story((value) => { value.scenes[2].in.direction = "left"; });
  const plan = planSegments(resolved);
  const hashed = hashSegments(resolved, plan, inputsFor(resolved, words));
  const { story: original, words: originalWords } = await story();
  const base = hashSegments(original, planSegments(original), inputsFor(original, originalWords));
  for (const label of ["s5", "s5+s1~loop"]) {
    const now = hashed.find((entry) => entry.label === label), then = base.find((entry) => entry.label === label);
    assert.equal(now.parts.layers, then.parts.layers, `${label} layers are unchanged`);
    assert.notEqual(now.parts.camera, then.parts.camera, `${label} camera changed`);
  }
  // A later move leaves earlier segments alone.
  const orbit = await hashOf((value) => { value.scenes[4].in.direction = "left"; });
  assert.deepEqual(changed(before, orbit), ["s4+s5", "s5", "s5+s1~loop"]);
  const segment = hashed.find((entry) => entry.label === "s4");
  assert.ok(segment.parts.camera, "camera stories carry a camera part");
  // The background field is part of the camera digest: parallax false keeps
  // the field but moves it 1× with the plates, so the camera part changes
  // from the first move on, while s1 (at home, before any move) frames the
  // same field tiles. Turning ambient's background off swaps the field for
  // glows, which every segment's camera part sees.
  const cameraParts = async (mutate) => {
    const { story: resolved, words } = await story(mutate);
    return Object.fromEntries(hashSegments(resolved, planSegments(resolved), inputsFor(resolved, words)).map((entry) => [entry.label, entry.parts.camera]));
  };
  const parts = await cameraParts(), flat = await cameraParts((value) => { value.camera.parallax = false; });
  assert.equal(flat.s1, parts.s1);
  for (const label of ["s1+s2", "s2", "s3", "s4", "s5", "s5+s1~loop"]) assert.notEqual(flat[label], parts[label], `${label} camera part sees the 1× field`);
  const glows = await cameraParts((value) => { value.ambient = { background: false }; });
  for (const label of Object.keys(parts)) assert.notEqual(glows[label], parts[label], `${label} camera part sees the glows`);
  // A cuts story without camera transitions has no camera part at all.
  const cuts = await explainer((value) => { value.scenes[1].in = { type: "push", dur: 0.45, direction: "up" }; });
  const cutsPlan = planSegments(cuts.story);
  assert.equal(hashSegments(cuts.story, cutsPlan, inputsFor(cuts.story, cuts.words))[0].parts.camera, undefined);
});

test("captions invalidate the segments their chunks are on screen in, and a chunk crossing a join both", async () => {
  const { story, words } = await explainer();
  const plan = planSegments(story);
  const chunks = chunkWords(words);
  const base = hashSegments(story, plan, inputsFor(story, words, { captions: chunks }));
  // The chunk that starts during the s3 -> s4 fade (16.2-16.6 s) stays on screen into s4.
  const index = chunks.findIndex((chunk) => chunk.start >= 16.2 && chunk.start < 16.6);
  assert.ok(index >= 0);
  const edited = chunks.map((chunk, i) => (i === index ? { ...chunk, words: chunk.words.map((word, k) => (k === 0 ? { ...word, text: "EDITED" } : word)) } : chunk));
  const after = hashSegments(story, plan, inputsFor(story, words, { captions: edited }));
  const touched = after.filter((segment, i) => segment.hash !== base[i].hash).map((segment) => segment.label);
  assert.deepEqual(touched, ["s3+s4", "s4"]);
  // Caption style is global; removing captions changes every segment.
  const styled = await hashes((s) => { s.overlays[0].style = "line"; });
  assert.deepEqual(changed(await hashes(), styled), SEGMENT_LABELS);
});

test("timed overlays touch their window; global settings, kit, fonts and renderer touch every segment", async () => {
  const before = await hashes();
  const timed = await hashes((story) => { story.overlays.push({ type: "lower-third", start: 12, end: 13, text: "Rule of 72" }); });
  assert.deepEqual(changed(before, timed), ["s3"]);
  const untimed = await hashes((story) => { story.overlays.push({ type: "watermark", text: "LaunchClip" }); });
  assert.deepEqual(changed(before, untimed), SEGMENT_LABELS);
  for (const mutate of [
    (story) => { story.brand.colors.primary = "#ff0000"; },
    (story) => { story.format.platform = "tiktok"; },
    // A world camera path or ambient drift is global: every segment it spans.
    (story) => { story.camera = { path: [{ at: 0, x: 0 }, { at: 26, x: 100 }] }; },
    (story) => { story.ambient = { drift: 0.2 }; }
  ]) assert.deepEqual(changed(before, await hashes(mutate)), SEGMENT_LABELS);
  // Audio-only and descriptive fields never reach a frame.
  for (const mutate of [
    (story) => { story.audio.mix = "assets/audio/other.wav"; },
    (story) => { story.audio.mix_volume = 0.5; },
    (story) => { story.notes = "x"; }
  ]) assert.deepEqual(changed(before, await hashes(mutate)), []);
  assert.deepEqual(changed(before, await hashes(null, { kit: "kit-2" })), SEGMENT_LABELS);
  assert.deepEqual(changed(before, await hashes(null, { fonts: "fonts-2" })), SEGMENT_LABELS);
  assert.deepEqual(changed(before, await hashes(null, { renderer: "hyperframes" })), SEGMENT_LABELS);
});

test("asset content changes invalidate the scenes that reference the asset", async () => {
  const { story, words } = await explainer((s) => { s.scenes[3].params.image = "assets/images/pacioli.png"; });
  const plan = planSegments(story);
  const a = hashSegments(story, plan, inputsFor(story, words, { assets: { "assets/images/pacioli.png": "aaa" } }));
  const b = hashSegments(story, plan, inputsFor(story, words, { assets: { "assets/images/pacioli.png": "bbb" } }));
  assert.deepEqual(a.filter((segment, i) => segment.hash !== b[i].hash).map((segment) => segment.label), ["s3+s4", "s4", "s4+s5"]);
});

test("kitFingerprint hashes kit source content per renderer; inputs come from disk", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-kit-"));
  try {
    for (const dir of ["kit/core", "kit/remotion", "kit/hyperframes"]) await mkdir(path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, "kit/core/a.mjs"), "export const a = 1;");
    await writeFile(path.join(root, "kit/remotion/B.tsx"), "export const B = 1;");
    await writeFile(path.join(root, "kit/hyperframes/c.mjs"), "export const c = 1;");
    const remotion = await kitFingerprint("remotion", { root, cache: false });
    const hyperframes = await kitFingerprint("hyperframes", { root, cache: false });
    await writeFile(path.join(root, "kit/hyperframes/c.mjs"), "export const c = 2;");
    assert.equal(await kitFingerprint("remotion", { root, cache: false }), remotion, "HyperFrames sources do not change Remotion segments");
    assert.notEqual(await kitFingerprint("hyperframes", { root, cache: false }), hyperframes);
    await writeFile(path.join(root, "kit/core/a.mjs"), "export const a = 2;");
    assert.notEqual(await kitFingerprint("remotion", { root, cache: false }), remotion);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-segments-"));
  try {
    await cp(EXPLAINER, project, { recursive: true });
    const { story } = await explainer();
    const story2 = { ...story, overlays: [{ type: "captions", style: "word-highlight" }] };
    const inputs = await gatherSegmentInputs(project, story2, "remotion");
    assert.equal(inputs.renderer, "remotion");
    assert.match(inputs.kit, /^[0-9a-f]{64}$/);
    assert.match(inputs.fonts, /^[0-9a-f]{64}$/);
    assert.ok(inputs.captions.length > 0, "captions chunk the narration words");
    // A hidesCaptions scene drops the chunks that start in its window.
    const all = await storyCaptionChunks(project, story2, { models: new Map() });
    const hidden = await storyCaptionChunks(project, story2, { models: new Map([["s3", { hidesCaptions: true }]]) });
    assert.equal(all.length, 22);
    assert.equal(hidden.length, 16);
    assert.ok(hidden.every((chunk) => !(chunk.start >= 11.2 && chunk.start < 16.6)));
    assert.equal(await storyCaptionChunks(project, { ...story2, overlays: [] }), null);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("storySoundtrack picks what StoryComposition plays", () => {
  assert.deepEqual(storySoundtrack({ audio: { mix: "m.wav", voice: "v.wav", mix_volume: 0.5 } }), { src: "m.wav", volume: 0.5, base: false });
  assert.deepEqual(storySoundtrack({ audio: { voice: "v.wav", mix_volume: 0.5 } }), { src: "v.wav", volume: 1, base: false });
  assert.deepEqual(storySoundtrack({ format: { fps: 30, duration: 4 }, base: { src: "assets/a.mp4", volume: 0.8 }, audio: { voice: "v.wav" } }), { src: null, volume: 1, base: true });
  assert.deepEqual(storySoundtrack({ format: { fps: 30, duration: 4 }, base: { src: "assets/a.mp4", volume: 0 }, audio: { mix: "m.wav" } }), { src: "m.wav", volume: 1, base: false });
});

// A fake frame-range renderer: each segment file records its frame range.
function fakeRemotion() {
  const calls = [];
  return {
    calls,
    adapter: {
      name: "remotion",
      segmentEncoder: () => ({ fake: true }),
      async renderSegments(project, segments) {
        calls.push(segments.map((segment) => [segment.startFrame, segment.endFrame]));
        for (const segment of segments) await writeFile(segment.output, `${segment.startFrame}-${segment.endFrame}\n`);
        return { segments: segments.map(() => ({ seconds: 1 })) };
      },
      async encodeDelivery(input, output) { await writeFile(output, `encoded\n${await readFile(input, "utf8")}`); }
    }
  };
}

function fakeTools(log = []) {
  return {
    async concat(files, output) { log.push(["concat", files.length]); await writeFile(output, (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("")); },
    async encodeAudio({ audio, output, volume, duration }) { log.push(["encodeAudio", path.basename(audio), volume, duration]); await writeFile(output, "aac"); },
    async mux({ video, audio, output, offset, duration }) { log.push(["mux", audio ? path.extname(audio) : "none", offset, duration]); await writeFile(output, await readFile(video, "utf8")); },
    async countFrames() { return NaN; },
    async still(video, frame, output) { await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, `frame ${frame}`); },
    async trim(video, start, end, output) { log.push(["trim", start, end]); await writeFile(output, `trim ${start}-${end}`); }
  };
}

test("renderWithSegments renders missing segments, reuses cached ones, forces --scene and previews one scene", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-segments-"));
  try {
    await cp(EXPLAINER, project, { recursive: true });
    const { story } = await explainer();
    const fake = fakeRemotion();
    const log = [];
    const options = { project, story, renderer: "remotion", adapter: fake.adapter, quality: "draft", output: path.join(project, "out/raw.mp4"), tools: fakeTools(log) };
    const first = await renderWithSegments(options);
    assert.equal(first.mode, "segments");
    assert.deepEqual([first.segments, first.reused, first.rendered], [10, 0, 10]);
    assert.equal(fake.calls[0].length, 10);
    const joined = await readFile(options.output, "utf8");
    assert.match(joined, /^encoded\n0-132\n132-150\n/);
    assert.match(joined, /768-780\n$/);
    assert.deepEqual(log.find((entry) => entry[0] === "encodeAudio"), ["encodeAudio", "mix.m4a", 1, 26]);
    assert.deepEqual(log.find((entry) => entry[0] === "mux"), ["mux", ".m4a", 0, undefined]);
    assert.ok(existsSync(path.join(project, first.cache, "index.json")));

    const again = await renderWithSegments(options);
    assert.deepEqual([again.reused, again.rendered], [10, 0]);
    assert.equal(log.filter((entry) => entry[0] === "encodeAudio").length, 1, "the soundtrack encode is cached");
    assert.equal(fake.calls.length, 1, "nothing rendered");
    assert.ok(again.seconds_saved >= 10);

    const forced = await renderWithSegments({ ...options, scenes: ["s3"] });
    assert.deepEqual([forced.reused, forced.rendered, forced.forced], [7, 3, 3]);
    assert.deepEqual(fake.calls.at(-1), [[336, 351], [351, 486], [486, 498]]);

    const { story: edited } = await explainer((s) => { s.scenes[2].params.title = "Same rate, a bigger pile"; });
    const second = await renderWithSegments({ ...options, story: edited });
    assert.deepEqual(second.plan.filter((entry) => entry.status === "rendered").map((entry) => entry.id), ["03-s2+s3", "04-s3", "05-s3+s4"]);

    // A preview reuses the final's segments and renders only its scene's.
    const same = await renderWithSegments({ ...options, story: edited, previewScene: "s4", output: path.join(project, "renders/scene-s4.mp4") });
    assert.deepEqual(same.plan.map((entry) => entry.status), ["reused", "reused", "reused"]);
    const { story: s4 } = await explainer((s) => { s.scenes[2].params.title = "Same rate, a bigger pile"; s.scenes[3].params.kicker = "Venezia"; });
    const preview = await renderWithSegments({ ...options, story: s4, previewScene: "s4", output: path.join(project, "renders/scene-s4.mp4") });
    assert.deepEqual(preview.frames, { start: 486, end: 651, count: 165 });
    assert.deepEqual(preview.plan.map((entry) => entry.status), ["rendered", "rendered", "rendered"]);
    assert.equal(await readFile(path.join(project, "renders/scene-s4.mp4"), "utf8"), "encoded\n486-498\n498-636\n636-651\n");
    assert.deepEqual(log.at(-1), ["mux", ".m4a", 16.2, 5.5]);
    await assert.rejects(renderWithSegments({ ...options, previewScene: "s9" }), /scene "s9" is not on screen/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("renderers without frame ranges render whole videos, cached by the whole timeline's hash", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-segments-hf-"));
  try {
    await cp(EXPLAINER, project, { recursive: true });
    const { story } = await explainer();
    let renders = 0;
    const log = [];
    const options = {
      project, story, renderer: "hyperframes", adapter: { name: "hyperframes" }, quality: "draft", output: path.join(project, "out/raw.mp4"), tools: fakeTools(log),
      renderWhole: async (file) => { renders += 1; await writeFile(file, `whole ${renders}`); }
    };
    const first = await renderWithSegments(options);
    assert.deepEqual([first.mode, first.rendered, renders], ["whole", 1, 1]);
    assert.match(first.note, /partial rendering is Remotion-only/);
    const again = await renderWithSegments(options);
    assert.deepEqual([again.reused, renders], [1, 1]);
    assert.equal(await readFile(options.output, "utf8"), "whole 1");
    const forced = await renderWithSegments({ ...options, scenes: ["s2"] });
    assert.deepEqual([forced.forced, renders], [1, 2]);
    const { story: edited } = await explainer((s) => { s.scenes[0].params.words[0].text = "Tiny"; });
    await renderWithSegments({ ...options, story: edited });
    assert.equal(renders, 3);
    const preview = await renderWithSegments({ ...options, story: edited, previewScene: "s2", output: path.join(project, "renders/scene-s2.mp4") });
    assert.deepEqual(preview.frames, { start: 132, end: 351, count: 219 });
    assert.deepEqual(log.at(-1), ["trim", 132, 351]);
    assert.equal(renders, 3, "the preview cuts the cached whole render");
    // With no whole render cached, a preview renders only the scene's window.
    const windows = [];
    const { story: changed } = await explainer((s) => { s.scenes[0].params.words[0].text = "Small"; });
    const alone = await renderWithSegments({ ...options, story: changed, previewScene: "s2", output: path.join(project, "renders/scene-s2.mp4"), renderWindow: async (file, span) => { windows.push(span); await writeFile(file, "window"); } });
    assert.equal(renders, 3, "no whole render");
    assert.deepEqual(windows, [{ start: 4.4, end: 11.7, frames: [132, 351] }]);
    assert.deepEqual([alone.mode, alone.frames], ["window", { start: 132, end: 351, count: 219 }]);
    assert.equal(await readFile(path.join(project, "renders/scene-s2.mp4"), "utf8"), "window");
    assert.match(segmentSummary(alone), /scene window only \(frames 132–351/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("Remotion segments are lossless; the delivery encode matches remotion render's settings", async () => {
  const { DELIVERY, MEZZANINE, deliveryArgs, losslessArgs } = await import("../src/renderers/remotion_segments.js");
  const encode = ["-i", "remotion", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast", "-video_track_timescale", "90000", "-crf", "18", "-vf", "copy", "-y", "out.mp4"];
  assert.deepEqual(losslessArgs(encode).slice(10, 12), ["-qp", "0"]);
  assert.ok(!losslessArgs(encode).includes("-crf"));
  const stitch = ["-i", "pre.mp4", "-an", "-c:v", "copy", "-y", "out.mp4"];
  assert.deepEqual(losslessArgs(stitch), stitch, "the stream-copy pass is left alone");
  assert.throws(() => losslessArgs(["-c:v", "libvpx-vp9"]), /lossless segments need libx264/);
  assert.equal(MEZZANINE.pixelFormat, "yuv420p");
  assert.deepEqual(DELIVERY.draft, { crf: 28, x264Preset: "veryfast" });
  const draft = deliveryArgs("in.mp4", "out.mp4", "draft");
  assert.deepEqual(draft.slice(draft.indexOf("-c:v"), draft.indexOf("-an")), ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-video_track_timescale", "90000", "-crf", "28"]);
  const high = deliveryArgs("in.mp4", "out.mp4", "high");
  assert.ok(!high.includes("-preset"));
  assert.equal(high[high.indexOf("-crf") + 1], "18");
  assert.throws(() => deliveryArgs("a", "b", "ultra"), /unknown quality/);
});

test("ambient: a scene override touches only that scene's segments; the field's seed and level touch every segment", async () => {
  const before = await hashes();
  // Per-scene drift lives on the scene layer.
  const drift = await hashes((story) => { story.scenes[2].ambient = { drift: false }; });
  assert.deepEqual(changed(before, drift), ["s2+s3", "s3", "s3+s4"]);
  // The background field is seeded from the title and defaults its level from
  // the dominant scene energy, so both reach every plate.
  assert.deepEqual(changed(before, await hashes((story) => { story.title = "Another title"; })), SEGMENT_LABELS);
  assert.deepEqual(changed(before, await hashes((story) => { for (const scene of story.scenes) scene.energy = 3; })), SEGMENT_LABELS);
  assert.deepEqual(changed(before, await hashes((story) => { story.ambient = "lively"; })), SEGMENT_LABELS);
});

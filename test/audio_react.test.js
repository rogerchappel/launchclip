import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { AUDIO_FEATURES_SCHEMA, RATE, SERIES, audioFeatures, busFeatures } from "../src/scripts/audio-features.mjs";
import { AUDIO_REACT_KINDS, audioReactErrors, audioReactPlan, audioReactStyle, pickAudioFeatures } from "@launchclip/core/audio-react.mjs";
import { resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";
import { withAudioFeatures } from "../src/finish.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples/story/minimal");

// A 55 Hz kick every 0.5 s over a quiet 440 Hz tone, stereo, at RATE.
function kickTrack(seconds) {
  const left = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < left.length; i += 1) {
    const t = i / RATE;
    left[i] = 0.6 * Math.exp(-12 * (t % 0.5)) * Math.sin(2 * Math.PI * 55 * t) + 0.1 * Math.sin(2 * Math.PI * 440 * t);
  }
  return { left, right: left };
}

function features(seconds, fps) {
  const { left, right } = kickTrack(seconds);
  const frames = Math.round(seconds * fps);
  const mix = busFeatures(left, right, { fps, frames });
  return { schema: AUDIO_FEATURES_SCHEMA, fps, frames, series: SERIES, buses: { mix, music: mix } };
}

test("bus features are deterministic, bounded and land the kicks", () => {
  const fps = 30, frames = 60;
  const { left, right } = kickTrack(2);
  const a = busFeatures(left, right, { fps, frames });
  assert.deepEqual(busFeatures(left, right, { fps, frames }), a, "same audio → same numbers");
  assert.deepEqual(Object.keys(a), SERIES);
  for (const name of SERIES) {
    assert.equal(a[name].length, frames, name);
    assert.ok(a[name].every((v) => v >= 0 && v <= 1), `${name} in 0..1`);
  }
  const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
  assert.ok(mean(a.sub) > mean(a.air) + 0.2, "a 55 Hz kick lives in the sub band, not the air");
  // The onset envelope rises at each kick (frames 0, 15, 30, 45) and decays between.
  for (const at of [15, 30, 45]) assert.ok(a.onset[at + 1] > a.onset[at - 2], `onset rises at frame ${at}`);
});

test("audio.react validation agrees between the core module and the story validator", () => {
  const cases = [
    undefined, { glow: true }, { glow: true, bar: { strength: 0.5 }, pulse: { bus: "voice", series: "onset" } },
    "yes", { sparkle: true }, { bar: { bus: "drums" } }, { pulse: { series: "treble" } }, { glow: { strength: 2 } }, { glow: 3 }
  ];
  const base = { schema: "launchclip.story.v1", lane: "motion", title: "R", format: { width: 1080, height: 1920, fps: 30, duration: 4 }, scenes: [{ id: "a", module: "hook-title", start: 0, end: 4, params: { headline: "Hi" } }] };
  for (const react of cases) {
    const coreValid = audioReactErrors(react).length === 0;
    const storyErrors = validateStory({ ...base, audio: { react } }).errors.filter((e) => /audio\.react/.test(e.message ?? e));
    assert.equal(storyErrors.length === 0, coreValid, JSON.stringify(react));
  }
});

test("pickAudioFeatures keeps only the series a story reads, falling back to the mix", () => {
  const full = features(1, 30);
  delete full.buses.music;
  const story = { audio: { react: { glow: true, bar: true } } };
  const picked = pickAudioFeatures(story, full);
  assert.deepEqual(Object.keys(picked.buses), ["mix"]);
  assert.deepEqual(Object.keys(picked.buses.mix).sort(), ["loud", "sub"]);
  assert.equal(pickAudioFeatures(story, { buses: {} }), null);
  assert.equal(withAudioFeatures({ audio: {} }, full).audio.features, undefined, "no audio.react, nothing attached");
});

test("no features or no audio.react draws nothing", () => {
  const format = { width: 1080, height: 1920, fps: 30 };
  assert.equal(audioReactPlan({ format, audio: { react: { glow: true } } }), null);
  assert.equal(audioReactPlan({ format, audio: { features: pickAudioFeatures({ audio: { react: { glow: true } } }, features(1, 30)) } }), null);
});

test("each layer: the HyperFrames runtime paints the numbers Remotion's style gives, frame by frame", async () => {
  const base = JSON.parse(await readFile(path.join(MINIMAL, "storyboard.json"), "utf8"));
  const words = JSON.parse(await readFile(path.join(MINIMAL, "NARRATION.json"), "utf8")).words;
  for (const kind of AUDIO_REACT_KINDS) {
    const copy = { ...base, audio: { ...base.audio, react: { [kind]: true } } };
    const resolved = resolveStory(copy, { words });
    const { fps, duration } = resolved.resolved;
    const story = withAudioFeatures(resolved, features(duration, fps));
    const plan = audioReactPlan(story);
    assert.equal(plan.layers.length, 1, kind);
    const { html } = await compileStoryToHyperFrames(story, { write: false, sourceDir: MINIMAL });
    const script = html.match(/\/\/ audio-reactive layers\n\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)/)?.[1];
    assert.ok(script, `${kind}: runtime script in the composition`);
    assert.match(html, new RegExp(`id="${plan.id}-${kind}"`));
    // Run the runtime against stub nodes and a stub GSAP timeline.
    const nodes = {};
    let tween;
    const document = { getElementById: (id) => (nodes[id] ??= { style: {} }) };
    const tl = { fromTo: (target, _from, to) => { tween = { target, onUpdate: to.onUpdate }; } };
    new Function("document", "tl", script)(document, tl);
    const node = nodes[`${plan.id}-${kind}`];
    for (let frame = 0; frame < Math.round(duration * fps); frame += 7) {
      const t = frame / fps;
      tween.target.t = t;
      tween.onUpdate();
      const remotion = audioReactStyle(plan.layers[0], t, plan.fps);
      assert.equal(Number(node.style.opacity), remotion.opacity, `${kind} opacity at frame ${frame}`);
      assert.equal(node.style.transform, remotion.transform, `${kind} transform at frame ${frame}`);
    }
  }
});

test("audioFeatures decodes buses through FFmpeg and skips absent ones", { skip: !process.env.LAUNCHCLIP_MEDIA_TESTS && "media test: run with npm run test:media (LAUNCHCLIP_MEDIA_TESTS=1)" }, async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(path.join(tmpdir(), "launchclip-features-"));
  const mix = path.join(dir, "mix.wav");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=55:sample_rate=48000:duration=1", "-ac", "2", mix]);
  const out = await audioFeatures({ mix, music: null }, { fps: 30, duration: 1 });
  assert.deepEqual(Object.keys(out.buses), ["mix"]);
  assert.equal(out.buses.mix.loud.length, 30);
});

// audio-visualizer (kit/core/catalog-h-audio.mjs): the scene's band frames, painted by the shared spectrum painter.
test("audio-visualizer reads its bus's bands, sliced to the scene, and rests without features", async () => {
  const { resolveModule } = await import("@launchclip/core/modules.mjs");
  const { spectrumValues } = await import("@launchclip/core/particles.mjs");
  const { audioFeatureNeeds } = await import("@launchclip/core/audio-react.mjs");
  const full = features(4, 30);
  const scene = { id: "viz", module: "audio-visualizer", start: 1, end: 3, params: { variant: "ring", bus: "music" } };
  const story = { schema: "launchclip.story.v1", format: { width: 1080, height: 1920, fps: 30, duration: 4 }, brand: { colors: { bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", ink: "#06070d", paper: "#f2eee6" } }, scenes: [scene] };
  assert.deepEqual(audioFeatureNeeds(story).map((need) => `${need.bus}.${need.series}`), ["music.sub", "music.low", "music.mid", "music.high", "music.air"]);
  const picked = pickAudioFeatures(story, full);
  assert.deepEqual(Object.keys(picked.buses.music), ["sub", "low", "mid", "high", "air"]);
  const layer = (s) => Object.values(resolveModule(scene, s).content.paint)[0].layers[0];
  const live = layer({ ...story, audio: { features: picked } });
  assert.equal(live.f0, 30);
  assert.equal(live.bands.length, 61 * 5);
  assert.equal(live.bands[0], full.buses.music.sub[30]);
  // A kick frame lifts the bass bars over the frame before the next kick.
  const kick = spectrumValues(live, 2.0), tail = spectrumValues(live, 2.45);
  assert.ok(kick[0] > tail[0], `bass ${kick[0]} on the kick vs ${tail[0]} after it`);
  const rest = layer(story);
  assert.deepEqual(rest.bands, []);
  assert.ok(spectrumValues(rest, 2).every((v) => Math.abs(v - 0.04) < 1e-9));
});

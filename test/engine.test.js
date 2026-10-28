// The engine an app embeds (src/engine/index.js createEngine): adapters
// replace every model and provider call, project paths stay inside workDir,
// and state the CLI keeps in ~/.launchclip or ~/.cache/launchclip lands under
// the app's folders for the length of each call, concurrently and without
// touching process.env.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_BRAND } from "@launchclip/core/planning-prompt.mjs";
import { ADAPTER_KEYS, createEngine, engineAdapters, withStateDirs } from "../src/engine/index.js";
import { queueDir } from "../src/queue.js";
import { homeStyleRoot } from "../src/style_store.js";
import { skeletonDirs } from "../src/skeletons.js";
import { userLibraryDir } from "../src/sfx/library.js";
import { modelsDir } from "../src/subject/models.js";
import { defaultBrandLibraryDir } from "../src/entity_resolution.js";
import { defaultFreeModelStatePath, defaultFreeVisionModelStatePath } from "../src/free_model_selector.js";
import { voiceCacheDir } from "../src/voice/narrate.js";
import { kokoroCacheDir } from "../src/voice/kokoro.js";
import { musicCacheDir } from "../src/music/elevenlabs.js";
import { isolationCacheDir } from "../src/voice_isolation.js";
import { useProjectTemp } from "../src/render_temp.js";

const FORMAT = { width: 1080, height: 1920, fps: 30, duration: 6, platform: "youtube-shorts" };
const WORDS = [["Ship", 0.2], ["faster", 0.6], ["today", 1.1], ["with", 3.2], ["less", 3.6], ["work", 4.0]].map(([text, start]) => ({ text, start, end: start + 0.3 }));
const STORY = {
  schema: "launchclip.story.v1",
  title: "Ship faster",
  lane: "voiceover-motion",
  format: FORMAT,
  brand: DEFAULT_BRAND,
  audio: { voice: "assets/audio/narration.wav", words: "NARRATION.json", music: { source: "synth", bpm: 96 }, sfx: "auto" },
  scenes: [
    { id: "s1", module: "hook-title", start: 0, end: "word:with", energy: 1, params: { headline: "Ship faster today", emphasis: "faster" } },
    { id: "s2", module: "cta", start: "word:with", end: 6, energy: 1, in: { type: "fade", dur: 0.3 }, params: { action: "Less work, more shipping", loop: true } }
  ],
  overlays: [{ type: "captions", style: "word-highlight" }],
  ending: { loop_to: "s1" }
};

async function folders(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-engine-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, workDir: path.join(root, "work"), cacheDir: path.join(root, "cache") };
}

test("createEngine needs a workDir and a cacheDir, and keeps projects inside workDir", async (t) => {
  const { workDir, cacheDir } = await folders(t);
  assert.throws(() => createEngine({ cacheDir }), /workDir/);
  assert.throws(() => createEngine({ workDir }), /cacheDir/);
  const engine = createEngine({ workDir, cacheDir });
  assert.equal(engine.stateDir, path.join(cacheDir, "state"));
  assert.equal(engine.project("videos/launch"), path.join(workDir, "videos/launch"));
  assert.throws(() => engine.project("../elsewhere"), /outside the engine's workDir/);
  assert.throws(() => engine.project("/etc"), /outside the engine's workDir/);
  assert.throws(() => createEngine({ workDir, cacheDir, adapters: { tts: {} } }), /adapters\.tts/);
  assert.throws(() => createEngine({ workDir, cacheDir, adapters: { imageGen: () => null } }), /unknown engine adapter/);
});

test("state the CLI keeps under the home folder resolves under the engine's folders inside a call", async () => {
  const resolve = () => ({
    queue: queueDir(), styles: homeStyleRoot(), skeletons: skeletonDirs()[0], sfx: userLibraryDir(), models: modelsDir(),
    brand: defaultBrandLibraryDir(), free: defaultFreeModelStatePath(), freeVision: defaultFreeVisionModelStatePath(),
    voice: voiceCacheDir(null), kokoro: kokoroCacheDir(), music: musicCacheDir(), isolation: isolationCacheDir()
  });
  const outside = resolve();
  const [a, b] = await Promise.all([
    withStateDirs({ home: "/apps/a/state", cache: "/apps/a/cache" }, async () => { await new Promise((done) => setTimeout(done, 5)); return resolve(); }),
    withStateDirs({ home: "/apps/b/state", cache: "/apps/b/cache" }, async () => resolve())
  ]);
  assert.deepEqual(a, {
    queue: "/apps/a/state/queue", styles: "/apps/a/state/styles", skeletons: "/apps/a/state/skeletons", sfx: "/apps/a/state/sfx", models: "/apps/a/state/models",
    brand: "/apps/a/state/brand-assets", free: "/apps/a/state/openrouter-free-models.json", freeVision: "/apps/a/state/openrouter-free-vision-models.json",
    voice: "/apps/a/cache/voice", kokoro: "/apps/a/cache/kokoro", music: "/apps/a/cache/elevenlabs/music", isolation: "/apps/a/cache/elevenlabs/audio-isolation"
  });
  assert.ok(Object.values(b).every((value) => value.startsWith("/apps/b/")), JSON.stringify(b));
  // Outside a call the CLI's resolution is unchanged.
  assert.deepEqual(resolve(), outside);
  const temp = await withStateDirs({ home: "/apps/a/state", cache: "/apps/a/cache" }, () => useProjectTemp("/apps/a/work/p"));
  assert.equal(temp.dir, null, "TMPDIR is never repointed inside an engine call");
});

test("planStoryboard runs on the app's llm adapter, inside the engine's state folders", async (t) => {
  const { workDir, cacheDir } = await folders(t);
  const requests = [];
  const llm = {
    async runStructured(request) {
      requests.push({ schemaName: request.schemaName, queue: queueDir() });
      return { model: "app-model", value: { storyboard_json: JSON.stringify(STORY) }, usage: { input_tokens: 10, output_tokens: 5 } };
    }
  };
  const engine = createEngine({ workDir, cacheDir, adapters: { llm } });
  const report = await engine.planStoryboard({ brief: "Ship faster with less work.", words: WORDS, lane: "voiceover-motion", format: FORMAT, audio: STORY.audio, tier: "structured", model: "app-model" });
  assert.equal(report.status, "passed", report.errors?.join("\n"));
  assert.equal(report.storyboard.scenes.length, 2);
  assert.deepEqual(requests, [{ schemaName: "launchclip_storyboard", queue: path.join(cacheDir, "state", "queue") }]);
});

test("without an llm adapter the default needs a model route in the engine's env, not process.env", async (t) => {
  const { workDir, cacheDir } = await folders(t);
  const saved = process.env.LAUNCHCLIP_PLANNER_MODEL;
  process.env.LAUNCHCLIP_PLANNER_MODEL = "openai:gpt-5.6-luna";
  t.after(() => { if (saved === undefined) delete process.env.LAUNCHCLIP_PLANNER_MODEL; else process.env.LAUNCHCLIP_PLANNER_MODEL = saved; });
  const engine = createEngine({ workDir, cacheDir });
  await assert.rejects(engine.planStoryboard({ brief: "x", format: FORMAT }), /no llm adapter/);
  assert.equal(typeof createEngine({ workDir, cacheDir, env: { LAUNCHCLIP_PLANNER_MODEL: "openai:gpt-5.6-luna", OPENAI_API_KEY: "test" } }).adapters.llm().runStructured, "function");
});

test("the default Remotion renderer takes its Chrome from the engine's env, not process.env", async (t) => {
  const { workDir, cacheDir } = await folders(t);
  const saved = process.env.LAUNCHCLIP_REMOTION_BROWSER;
  process.env.LAUNCHCLIP_REMOTION_BROWSER = "/app/own/chrome";
  t.after(() => { if (saved === undefined) delete process.env.LAUNCHCLIP_REMOTION_BROWSER; else process.env.LAUNCHCLIP_REMOTION_BROWSER = saved; });
  const prepared = { entry: "/p/remotion/entry.tsx", propsFile: "/p/props.json", project: "/p", format: { fps: 30 } };
  const browserOf = (args) => args.includes("--browser-executable") ? args[args.indexOf("--browser-executable") + 1] : null;
  const isolated = createEngine({ workDir, cacheDir }).adapters.renderer("remotion");
  assert.equal(browserOf(isolated.renderArgs(prepared, "/p/out.mp4")), null);
  const chosen = createEngine({ workDir, cacheDir, env: { LAUNCHCLIP_REMOTION_BROWSER: "/opt/chrome/chrome-headless-shell" } }).adapters.renderer("remotion");
  assert.equal(browserOf(chosen.renderArgs(prepared, "/p/out.mp4")), "/opt/chrome/chrome-headless-shell");
  assert.equal(browserOf(chosen.stillArgs(prepared, 1, "/p/s.png")), "/opt/chrome/chrome-headless-shell");
  assert.equal(createEngine({ workDir, cacheDir }).adapters.renderer("hyperframes").name, "hyperframes");
});

test("finish and recording adapters route narration, music and transcription to the app", async () => {
  const tts = { name: "app-voice", async synthesize() { return { file: "voice.wav" }; } };
  const music = { name: "app-music", paid: true, request: () => ({}), cacheStatus: async () => ({ cached: false }), generate: async () => ({ file: "bed.wav", cached: false }) };
  const transcribe = async () => ({ words: [] });
  const vision = { vision: false, runStructured: async () => ({ value: {} }) };
  const adapters = engineAdapters({ tts, music, transcribe, llm: vision }, { env: { ELEVENLABS_API_KEY: "k" } });
  const finish = adapters.finish();
  assert.equal(finish.voiceProvider("kokoro"), tts);
  assert.equal(finish.voiceProvider("elevenlabs"), tts);
  assert.notEqual(finish.voiceProvider("supplied"), tts, "the presenter's own recording stays local");
  assert.equal(await finish.musicProvider("elevenlabs"), music);
  assert.equal((await finish.musicProvider("synth")).name, "synth");
  assert.deepEqual(finish.env, { ELEVENLABS_API_KEY: "k" });
  assert.equal(adapters.recording().transcribe, transcribe);
  assert.equal(adapters.recording().transcribeRendered, transcribe);
  assert.equal(adapters.llm(), vision);
  assert.throws(() => adapters.llm({ vision: true }), /no vision/);
  assert.deepEqual([...ADAPTER_KEYS].sort(), ["assets", "llm", "matting", "music", "notice", "renderer", "transcribe", "tts"]);
});

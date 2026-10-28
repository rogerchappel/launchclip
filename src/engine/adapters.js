// The adapters an app gives createEngine (src/engine/index.js). Every model
// and provider call the engine makes goes through one of these; an adapter
// left out uses the CLI's own implementation. packages/engine/README.md documents each
// interface with examples.
//
//   llm         structured LLM calls, with images when vision is needed:
//               a client {runStructured(request) → result, vision?: boolean,
//               resumeStructured?(id, request)}, or ({vision}) → client.
//               request: {instructions, input, schema, schemaName, model?,
//               images?: [data URL | URL], temperature?, maxOutputTokens?,
//               reasoningEffort?, onSubmitted?({id, status, model})}.
//               result: {value (the parsed JSON) | text, usage?: {input_tokens,
//               output_tokens}, model?, response_id?, status?}.
//               Default: LAUNCHCLIP_PLANNER_MODEL from env ("provider:model",
//               src/storyboard_planner.js createPlannerClient) with its key
//               from env.
//   tts         narration: a voice provider {name, synthesize({text, voice,
//               speed, outFile, signal}) → {file?, duration?, words?, ...}},
//               used for every narration provider name except "supplied"
//               (the presenter's own recording), or (name, options) →
//               provider. Default: src/voice (kokoro local, elevenlabs).
//   music       generated music beds: a provider {name, paid, request(story,
//               params), cacheStatus(story, params), generate(story, params,
//               {outFile, force}) → {file, cached, ...}}, used where the CLI
//               would call ElevenLabs Music. The procedural synth bed and
//               supplied files stay local. Default: src/music/elevenlabs.js.
//   transcribe  speech to word times: (file, {model, language, signal}) →
//               Whisper JSON ({segments: [{words: [{word, start, end}]}]}) or
//               {words: [{text|word, start, end}]}. Used by the footage lane
//               and supplied voice. Default: local Whisper CLI.
//   matting     subject matting: (modelId, options) → segmenter
//               {segment(rgb24, width, height) → Promise<Uint8Array 0–255
//               alpha, same size>, release()}. Default: the ONNX models
//               (downloaded into stateDir/models).
//   assets      the asset-provider hook: {findShot(request) → shot | null}.
//               The planner asks it for a shot that shows something for a
//               line; see src/asset_provider.js. Default: none (the planner
//               designs every scene as motion graphics).
//   renderer    (name) → renderer adapter (src/renderers). Default: the
//               bundled HyperFrames and Remotion adapters.
//   notice      (line) → void: progress lines. Default: stderr.
import { getRenderer } from "../renderers/index.js";
import { createPlannerClient } from "../storyboard_planner.js";
import { getVoiceProvider } from "../voice/index.js";
import { getMusicProvider } from "../music/index.js";

export const ADAPTER_KEYS = Object.freeze(["llm", "tts", "music", "transcribe", "matting", "assets", "renderer", "notice"]);

const API_KEYS = Object.freeze({ anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", openrouter: "OPENROUTER_API_KEY", compatible: "OPENAI_COMPATIBLE_API_KEY" });

/** The CLI's implementations, reading keys and model routes from env only. */
export function defaultEngineAdapters({ env = {} } = {}) {
  return {
    llm() {
      const spec = env.LAUNCHCLIP_PLANNER_MODEL;
      if (!spec) throw new Error("the engine has no llm adapter: pass adapters.llm, or env.LAUNCHCLIP_PLANNER_MODEL (provider:model) with its API key");
      const provider = String(spec).split(":")[0].toLowerCase();
      return createPlannerClient(spec, { apiKey: env[API_KEYS[provider]] }).client;
    },
    tts: (name, options = {}) => getVoiceProvider(name, { env, ...options }),
    music: (name, options = {}) => getMusicProvider(name, { env, ...options }),
    async transcribe(file, options = {}) {
      const { transcribeRecording } = await import("../recording_workflow.js");
      return transcribeRecording(file, options);
    },
    matting: null,
    assets: null,
    renderer: (name) => getRenderer(name),
    notice: (line) => process.stderr.write(`${line}\n`)
  };
}

const isClient = (value) => value && typeof value === "object" && typeof value.runStructured === "function";
const isProvider = (value, method) => value && typeof value === "object" && typeof value[method] === "function";

/**
 * The app's adapters over the defaults, normalised for the engine:
 * {llm({vision}) → client, voiceProvider, musicProvider, transcribe, matting,
 * assets, renderer, notice, finish() → finish adapters, recording() →
 * prepareRecording adapters}.
 */
export function engineAdapters(given = {}, { env = {} } = {}) {
  const unknown = Object.keys(given ?? {}).filter((key) => !ADAPTER_KEYS.includes(key));
  if (unknown.length) throw new Error(`unknown engine adapter(s): ${unknown.join(", ")} (known: ${ADAPTER_KEYS.join(", ")})`);
  const defaults = defaultEngineAdapters({ env });
  const app = given ?? {};
  check(app);

  const llm = (options = {}) => {
    if (!app.llm) return defaults.llm(options);
    const client = isClient(app.llm) ? app.llm : app.llm(options);
    if (!isClient(client)) throw new Error("adapters.llm must be a client with runStructured() or a function returning one");
    if (options.vision && client.vision === false) throw new Error("this step sends images, and adapters.llm says it has no vision (vision: false)");
    return client;
  };
  const transcribe = app.transcribe ?? defaults.transcribe;
  const voiceProvider = (name, options = {}) => {
    const key = String(name ?? "").toLowerCase();
    // The presenter's own recording is prepared locally; only its transcription is the app's.
    if (key === "supplied" || !app.tts) return defaults.tts(name, { transcribe, ...options });
    return isProvider(app.tts, "synthesize") ? app.tts : app.tts(name, options);
  };
  const musicProvider = (name, options = {}) => {
    const key = String(name ?? "").toLowerCase();
    if (!app.music || key === "synth" || key === "file") return defaults.music(name, options);
    return isProvider(app.music, "generate") ? app.music : app.music(name, options);
  };
  const renderer = app.renderer ?? defaults.renderer;
  const notice = app.notice ?? defaults.notice;
  return Object.freeze({
    llm,
    voiceProvider,
    musicProvider,
    transcribe,
    matting: app.matting ?? defaults.matting,
    assets: app.assets ?? defaults.assets,
    renderer,
    notice,
    /** Adapters for src/finish.js runFinish (over its own defaultAdapters()). */
    finish: () => ({ env, notice, renderer, voiceProvider, musicProvider }),
    /** Adapters for src/recording_workflow.js prepareRecording. */
    recording: () => ({ transcribe, transcribeRendered: transcribe, notice })
  });
}

function check(app) {
  const want = { tts: "synthesize", music: "generate" };
  for (const [key, method] of Object.entries(want)) {
    const value = app[key];
    if (value != null && typeof value !== "function" && !isProvider(value, method)) throw new Error(`adapters.${key} must be a provider with ${method}() or a function (name, options) → provider`);
  }
  for (const key of ["transcribe", "matting", "renderer", "notice"]) {
    if (app[key] != null && typeof app[key] !== "function") throw new Error(`adapters.${key} must be a function`);
  }
  if (app.llm != null && typeof app.llm !== "function" && !isClient(app.llm)) throw new Error("adapters.llm must be a client with runStructured() or a function returning one");
  if (app.assets != null && !isProvider(app.assets, "findShot")) throw new Error("adapters.assets must be an asset provider with findShot(request)");
}

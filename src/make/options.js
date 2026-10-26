// The flags of `launchclip make` in one place: the CLI maps them to runMake's
// options here, runMake validates them here, and a collection recipe's `make`
// block (docs/COLLECTIONS_RFC.md §3.3) is the subset marked `setting`: the
// choices a recipe saves. The rest (the prompt's own assets, --out, --repo
// and the demo flags, --replan) belong to one video.
import { scriptPlanOptions } from "../../kit/core/script-formats.mjs";
import { MUSIC_FLAG_VALUES } from "../music/index.js";
import { resolveAspect, resolveDuration } from "./routing.js";

export const MAKE_RENDERERS = Object.freeze(["remotion", "hyperframes"]);
export const MAKE_VOICES = Object.freeze(["kokoro", "elevenlabs", "test"]);
export const MAKE_QUALITIES = Object.freeze(["draft", "high"]);

/** [flag, {boolean?, setting?}] in usage order. */
export const MAKE_FLAGS = Object.freeze([
  ["assets", {}],
  ["aspect", { setting: true }],
  ["duration", { setting: true }],
  ["format", { setting: true }],
  ["goal", { setting: true }],
  ["awareness", { setting: true }],
  ["style", { setting: true }],
  ["seed", { setting: true }],
  ["profile", { setting: true }],
  ["model", { setting: true }],
  ["voice", { setting: true }],
  ["voice-id", { setting: true }],
  ["music", { setting: true }],
  ["renderer", { setting: true }],
  ["quality", { setting: true }],
  // Cores per render: a property of the machine, not of a recipe.
  ["concurrency", {}],
  ["out", {}],
  ["replan", { boolean: true }],
  ["critic", { boolean: true, setting: true }],
  ["no-critic", { boolean: true, setting: true }],
  ["max-repairs", { setting: true }],
  ["no-subject", { boolean: true, setting: true }],
  ["visual-history-dir", {}],
  ["visual-history-limit", { setting: true }],
  ["visual-similarity-limit", { setting: true }],
  ["repo", {}],
  ["approve-demo", { boolean: true }],
  ["redemo", { boolean: true }],
  ["start", {}],
  ["url", {}],
  ["allow-host", {}],
  ["demo-plan", {}]
]);

/** The flags a recipe's `make` block may set. */
export const MAKE_SETTING_FLAGS = Object.freeze(MAKE_FLAGS.filter(([, spec]) => spec.setting).map(([flag]) => flag));

/** CLI flags ({aspect: "9:16", "max-repairs": "2", "no-critic": true, …}) → runMake options. */
export function makeOptionsFromFlags(flags = {}) {
  return {
    assets: flags.assets,
    aspect: flags.aspect,
    duration: flags.duration,
    style: flags.style,
    seed: flags.seed,
    profile: flags.profile,
    model: flags.model,
    voice: flags.voice,
    voiceId: flags["voice-id"],
    music: flags.music,
    renderer: flags.renderer,
    quality: flags.quality,
    concurrency: flags.concurrency,
    goal: flags.goal,
    format: flags.format,
    awareness: flags.awareness,
    out: flags.out,
    replan: Boolean(flags.replan),
    critic: flags["no-critic"] ? false : flags.critic ? true : undefined,
    maxRepairs: flags["max-repairs"] === undefined ? undefined : Number(flags["max-repairs"]),
    repo: flags.repo,
    approveDemo: Boolean(flags["approve-demo"]),
    redemo: Boolean(flags.redemo),
    start: flags.start,
    url: flags.url,
    allowHost: flags["allow-host"],
    demoPlan: flags["demo-plan"],
    visualHistoryDir: flags["visual-history-dir"],
    visualHistoryLimit: flags["visual-history-limit"],
    visualSimilarityLimit: flags["visual-similarity-limit"],
    ...(flags["no-subject"] ? { subject: false } : {})
  };
}

/**
 * Throws on an option runMake cannot use, with the flag's name in the
 * message. Returns the normalised {voice, renderer, quality, script}.
 */
export function validateMakeOptions(options = {}) {
  const voice = String(options.voice ?? "kokoro").toLowerCase();
  if (!MAKE_VOICES.includes(voice)) throw new Error(`--voice must be kokoro or elevenlabs; got ${options.voice}`);
  if (options.seed != null && options.style) throw new Error("--seed generates a style; pass --seed or --style, not both");
  if (options.music != null && !MUSIC_FLAG_VALUES.includes(String(options.music).toLowerCase())) throw new Error(`--music must be one of ${MUSIC_FLAG_VALUES.join(", ")}; got ${options.music}`);
  const renderer = String(options.renderer ?? "remotion").toLowerCase();
  if (!MAKE_RENDERERS.includes(renderer)) throw new Error(`--renderer must be remotion or hyperframes; got ${options.renderer}`);
  const quality = String(options.quality ?? "draft").toLowerCase();
  if (!MAKE_QUALITIES.includes(quality)) throw new Error(`--quality must be draft or high; got ${options.quality}`);
  if (options.aspect != null) resolveAspect(options.aspect, null);
  if (options.duration != null) resolveDuration({ duration: options.duration }, {});
  if (options.maxRepairs !== undefined && !(Number.isInteger(options.maxRepairs) && options.maxRepairs >= 0)) throw new Error(`--max-repairs must be a whole number of 0 or more; got ${options.maxRepairs}`);
  if (options.visualHistoryLimit != null && !(Number.isInteger(Number(options.visualHistoryLimit)) && Number(options.visualHistoryLimit) >= 0)) throw new Error(`--visual-history-limit must be a whole number of entries; got ${options.visualHistoryLimit}`);
  if (options.visualSimilarityLimit != null && !(Number(options.visualSimilarityLimit) > 0 && Number(options.visualSimilarityLimit) <= 1)) throw new Error(`--visual-similarity-limit must be above 0 and at most 1; got ${options.visualSimilarityLimit}`);
  return { voice, renderer, quality, script: scriptPlanOptions(options) };
}

/**
 * The settings a finished make used, as flags, from its MAKE.json: what
 * `recipe new --from-video` saves. The chosen values win over the flags
 * (the script plan's format, goal and awareness; the routed aspect; the
 * target duration), so the recipe repeats what the video became, not only
 * what was typed. The style is returned apart: a generated or project pack
 * has to be copied to where the recipe can name it.
 */
export function settingsFromMakeReport(report) {
  const options = report?.options ?? {};
  const plan = report?.script?.plan ?? {};
  const flags = {};
  const set = (flag, value) => { if (value !== undefined && value !== null && value !== "") flags[flag] = value; };
  set("aspect", report?.routing?.aspect ?? options.aspect);
  set("duration", options.duration != null ? Number(options.duration) : report?.routing?.format?.duration);
  set("format", plan.format ?? options.format);
  set("goal", plan.goal ?? options.goal);
  set("awareness", plan.awareness ?? options.awareness);
  set("voice", options.voice);
  set("voice-id", options.voice_id);
  set("music", options.music);
  set("renderer", options.renderer);
  set("quality", options.quality);
  if (report?.model?.source === "--model") set("model", report.model.spec);
  if (options.critic === false) flags["no-critic"] = true;
  return { flags, style: report?.style ?? null, profile: report?.profile?.id ?? null };
}

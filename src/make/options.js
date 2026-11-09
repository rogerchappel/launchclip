// The flags of `launchclip make` in one place: the CLI maps them to runMake's
// options here, runMake validates them here, and a collection recipe's `make`
// block (docs/COLLECTIONS_RFC.md §3.3) is the subset marked `setting`: the
// choices a recipe saves. The rest (the prompt's own assets, --out, --repo
// and the demo flags, --replan) belong to one video.
import { ctaPlanOptions, scriptPlanOptions, seriesPlanOptions } from "@launchclip/core/script-formats.mjs";
import { MUSIC_FLAG_VALUES, parseMusicDuck, parseMusicPrompt, parseMusicVolume } from "../music/index.js";
import { resolveAspect, resolveDuration } from "./routing.js";
import { researchMode } from "../research/make.js";
import { DESCRIPTION_MODES } from "../asset_understanding.js";
import { DEFAULT_CRITIC_REPAIRS } from "./critic_repair.js";
import { conceptsMode } from "./concept_story.js";
import { candidatesMode } from "./candidates.js";
import { parseSfxMode } from "../sfx/event_sounds.js";
import { talkingHeadLayoutError } from "../talking_head_layout.js";

export const MAKE_RENDERERS = Object.freeze(["remotion", "hyperframes"]);
export const MAKE_VOICES = Object.freeze(["kokoro", "elevenlabs", "test"]);
export const MAKE_QUALITIES = Object.freeze(["draft", "high"]);
// --card-backdrops: footage puts full-screen cards on the asset provider's clips (src/asset_provider.js).
export const CARD_BACKDROPS = Object.freeze(["off", "footage"]);

/** [flag, {boolean?, setting?}] in usage order. */
export const MAKE_FLAGS = Object.freeze([
  ["assets", {}],
  ["aspect", { setting: true }],
  ["duration", { setting: true }],
  ["format", { setting: true }],
  ["goal", { setting: true }],
  ["awareness", { setting: true }],
  ["skeleton", { setting: true }],
  // A character story: the writers' room writes a script with speakers (src/make/animation.js).
  ["animation", { boolean: true, setting: true }],
  // The narration's rate: calm (~135 wpm), standard (~150) or fast (~215; short-form's default).
  ["pace", { setting: true }],
  // A comment-keyword call to action ("Comment WORD and I'll send you <offer>"), said at the end and in the post caption.
  ["cta-keyword", { setting: true }],
  ["cta-offer", { setting: true }],
  // One episode of a series, ending on a viewer choice ("Comment A, B or C"): the label, and two to four one-word options.
  ["episode", {}],
  ["choices", {}],
  ["style", { setting: true }],
  ["seed", { setting: true }],
  // The density dial (0–1): low lets supplied footage carry the video (clip-led planning).
  ["density", { setting: true }],
  ["profile", { setting: true }],
  ["model", { setting: true }],
  ["voice", { setting: true }],
  ["voice-id", { setting: true }],
  ["music", { setting: true }],
  // The music bed's gain, 0–1 (unset: the bed's own level, from the scene energy or audio.music.volume).
  ["music-volume", { setting: true }],
  // The bed's level under speech as a share of its level in pauses, 0–1 (1: no ducking; unset: the mix's default).
  ["music-duck", { setting: true }],
  // The ElevenLabs track's style in words (over the story's audio.music.prompt; ignored for synth and none).
  ["music-prompt", { setting: true }],
  // Sound effects: generated (described per event, ElevenLabs, PAID), kit, or off. Unset: generated with ELEVENLABS_API_KEY, else kit.
  ["sfx", { setting: true }],
  ["renderer", { setting: true }],
  ["quality", { setting: true }],
  // Cores per render: a property of the machine, not of a recipe.
  ["concurrency", {}],
  ["out", {}],
  ["replan", { boolean: true }],
  // Concept and story before the script: on (default) or off (one script pass from the brief).
  ["concepts", { setting: true }],
  // Rendered candidates for the opening and one risky transition: on (default, with a model that can see) or off.
  ["candidates", { setting: true }],
  ["critic", { boolean: true, setting: true }],
  ["no-critic", { boolean: true, setting: true }],
  ["max-repairs", { setting: true }],
  // Rounds of critic-driven repair after the first render (default 3; 0 ships the critic's verdict as is).
  ["critic-repairs", { setting: true }],
  // Exit 0 when the video is needs-repair (a gate failed after the repair rounds); without it the CLI exits 2.
  ["allow-needs-repair", { boolean: true }],
  ["long-form-visuals", { setting: true }],
  ["no-subject", { boolean: true, setting: true }],
  // With --no-subject: still track the presenter's head (local, no subject effects) so cards keep off the face.
  ["face-track", { boolean: true, setting: true }],
  ["visual-history-dir", {}],
  ["visual-history-limit", { setting: true }],
  ["visual-similarity-limit", { setting: true }],
  // The app's shot source (src/asset_provider_cmd.js): a property of the host, not a recipe.
  ["asset-provider-cmd", {}],
  // The fewest shots the plan must ask the asset provider for (0, the default, leaves them optional).
  ["min-shots", {}],
  // Full-screen cards on the app's footage (off, the default, keeps the stock plates).
  ["card-backdrops", {}],
  // How handed-in images and clips are described (src/asset_understanding.js): auto (the model when it can see, else local), local or off.
  ["asset-descriptions", {}],
  // A talking head's layout for the whole video (src/talking_head_layout.js): full (default) or stacked.
  ["layout", { setting: true }],
  // The app's evidence recorder (src/make/captures.js) for research's capture requests, and how many run at once.
  ["capture-cmd", {}],
  ["capture-concurrency", {}],
  // A footage-led base the app already edited (bad takes, pauses): used as is.
  ["base-edited", { boolean: true }],
  ["base-transcript", {}],
  // The app's hard rules (src/constraints.js): hidden ranges, must_use and never_use media.
  ["constraints", {}],
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
    density: flags.density,
    profile: flags.profile,
    musicVolume: flags["music-volume"],
    musicDuck: flags["music-duck"],
    musicPrompt: flags["music-prompt"],
    sfx: flags.sfx,
    model: flags.model,
    voice: flags.voice,
    voiceId: flags["voice-id"],
    assetProviderCmd: flags["asset-provider-cmd"],
    minShots: flags["min-shots"],
    cardBackdrops: flags["card-backdrops"],
    assetDescriptions: flags["asset-descriptions"],
    layout: flags.layout,
    captureCmd: flags["capture-cmd"],
    captureConcurrency: flags["capture-concurrency"],
    baseEdited: Boolean(flags["base-edited"]),
    baseTranscript: flags["base-transcript"],
    constraints: flags.constraints,
    music: flags.music,
    renderer: flags.renderer,
    quality: flags.quality,
    concurrency: flags.concurrency,
    goal: flags.goal,
    format: flags.format,
    awareness: flags.awareness,
    skeleton: flags.skeleton,
    ...(flags.animation ? { animation: true } : {}),
    pace: flags.pace,
    ctaKeyword: flags["cta-keyword"],
    ctaOffer: flags["cta-offer"],
    episode: flags.episode,
    choices: flags.choices,
    out: flags.out,
    replan: Boolean(flags.replan),
    concepts: flags.concepts,
    candidates: flags.candidates,
    critic: flags["no-critic"] ? false : flags.critic ? true : undefined,
    maxRepairs: flags["max-repairs"] === undefined ? undefined : Number(flags["max-repairs"]),
    criticRepairs: flags["critic-repairs"] === undefined ? undefined : Number(flags["critic-repairs"]),
    longFormVisuals: flags["long-form-visuals"],
    repo: flags.repo,
    approveDemo: Boolean(flags["approve-demo"]),
    redemo: Boolean(flags.redemo),
    start: flags.start,
    url: flags.url,
    allowHost: flags["allow-host"],
    demoPlan: flags["demo-plan"],
    research: flags.research,
    visualHistoryDir: flags["visual-history-dir"],
    visualHistoryLimit: flags["visual-history-limit"],
    visualSimilarityLimit: flags["visual-similarity-limit"],
    ...(flags["no-subject"] ? { subject: false } : {}),
    ...(flags["face-track"] ? { faceTrack: true } : {})
  };
}

/**
 * Throws on an option runMake cannot use, with the flag's name in the
 * message. Returns the normalised {voice, renderer, quality, script}.
 */
export function validateMakeOptions(options = {}) {
  const voice = String(options.voice ?? "kokoro").toLowerCase();
  if (!MAKE_VOICES.includes(voice)) throw new Error(`--voice must be kokoro or elevenlabs; got ${options.voice}`);
  researchMode(options.research);
  conceptsMode(options.concepts);
  candidatesMode(options.candidates);
  if (options.seed != null && options.style) throw new Error("--seed generates a style; pass --seed or --style, not both");
  if (options.music != null && !MUSIC_FLAG_VALUES.includes(String(options.music).toLowerCase())) throw new Error(`--music must be one of ${MUSIC_FLAG_VALUES.join(", ")}; got ${options.music}`);
  if (options.musicVolume != null) parseMusicVolume(options.musicVolume);
  if (options.musicDuck != null) parseMusicDuck(options.musicDuck);
  if (options.musicPrompt != null) parseMusicPrompt(options.musicPrompt);
  if (options.sfx != null) parseSfxMode(options.sfx);
  const renderer = String(options.renderer ?? "remotion").toLowerCase();
  if (!MAKE_RENDERERS.includes(renderer)) throw new Error(`--renderer must be remotion or hyperframes; got ${options.renderer}`);
  const quality = String(options.quality ?? "draft").toLowerCase();
  if (!MAKE_QUALITIES.includes(quality)) throw new Error(`--quality must be draft or high; got ${options.quality}`);
  if (options.aspect != null) resolveAspect(options.aspect, null);
  if (options.duration != null) resolveDuration({ duration: options.duration }, {});
  if (options.density != null && !(options.density !== true && options.density !== "" && Number(options.density) >= 0 && Number(options.density) <= 1)) throw new Error(`--density must be a number from 0 to 1; got ${options.density}`);
  if (options.maxRepairs !== undefined && !(Number.isInteger(options.maxRepairs) && options.maxRepairs >= 0)) throw new Error(`--max-repairs must be a whole number of 0 or more; got ${options.maxRepairs}`);
  if (options.minShots != null && !/^\d+$/.test(String(options.minShots).trim())) throw new Error(`--min-shots must be a whole number of 0 or more; got ${options.minShots}`);
  if (options.layout != null && talkingHeadLayoutError(options.layout)) throw new Error(talkingHeadLayoutError(options.layout));
  if (options.cardBackdrops != null && !CARD_BACKDROPS.includes(String(options.cardBackdrops).toLowerCase())) throw new Error(`--card-backdrops must be ${CARD_BACKDROPS.join(" or ")}; got ${options.cardBackdrops}`);
  if (options.assetDescriptions != null && !DESCRIPTION_MODES.includes(String(options.assetDescriptions).toLowerCase())) throw new Error(`--asset-descriptions must be ${DESCRIPTION_MODES.join(", ")}; got ${options.assetDescriptions}`);
  if (options.longFormVisuals != null && !["model", "rules"].includes(String(options.longFormVisuals).toLowerCase())) throw new Error(`--long-form-visuals must be model or rules; got ${options.longFormVisuals}`);
  if (options.visualHistoryLimit != null && !(Number.isInteger(Number(options.visualHistoryLimit)) && Number(options.visualHistoryLimit) >= 0)) throw new Error(`--visual-history-limit must be a whole number of entries; got ${options.visualHistoryLimit}`);
  if (options.animation != null && typeof options.animation !== "boolean") throw new Error(`--animation takes no value; got ${options.animation}`);
  if (options.skeleton != null && !/^(auto|none|[a-z][a-z0-9-]{1,40})$/.test(String(options.skeleton).toLowerCase())) throw new Error(`--skeleton must be auto, none or a skeleton id (launchclip skeletons list); got ${options.skeleton}`);
  if (options.visualSimilarityLimit != null && !(Number(options.visualSimilarityLimit) > 0 && Number(options.visualSimilarityLimit) <= 1)) throw new Error(`--visual-similarity-limit must be above 0 and at most 1; got ${options.visualSimilarityLimit}`);
  ctaPlanOptions(options);
  seriesPlanOptions(options);
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
  set("pace", options.pace);
  set("cta-keyword", options.cta_keyword);
  set("cta-offer", options.cta_offer);
  // The skeleton the video was built on, so a recipe makes more of the same series.
  set("skeleton", report?.skeleton?.library ? report.skeleton.id : options.skeleton && options.skeleton !== "auto" ? options.skeleton : undefined);
  if (report?.routing?.kind === "animation") flags.animation = true;
  set("voice", options.voice);
  set("voice-id", options.voice_id);
  set("music", options.music);
  set("music-volume", options.music_volume);
  set("music-duck", options.music_duck);
  set("music-prompt", options.music_prompt);
  if (options.layout && options.layout !== "full") set("layout", options.layout);
  set("renderer", options.renderer);
  set("quality", options.quality);
  if (report?.model?.source === "--model") set("model", report.model.spec);
  if (options.critic === false) flags["no-critic"] = true;
  if (options.critic_repairs != null && options.critic_repairs !== DEFAULT_CRITIC_REPAIRS) set("critic-repairs", options.critic_repairs);
  return { flags, style: report?.style ?? null, profile: report?.profile?.id ?? null };
}

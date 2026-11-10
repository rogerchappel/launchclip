// launchclip make "<prompt>" [--assets dir]: a prompt and an optional folder
// of assets to a finished video, headless.
//
//   inventory → demo (--repo: demo autopilot) → route → prepare (base edit + presenter probe | voiceover prep | script + voice)
//     → bible (--animation: the cast and the world, designed and frozen) → storyboard (planner + repair loop) → candidates (the opening and one risky transition, scored from rendered frames)
//     → subject (matte the planned ranges) → finish → critic → MAKE.json
//
// Every stage is resumable: ASSETS.json entries are reused while a file's size
// and mtime match, the script and storyboard while their inputs hash the same
// (--replan forces a new storyboard), voice takes come from the narration
// cache, the base edit from edit-recording's own cache, and finish reuses its
// stages, music lock and render segments. Lane routing is deterministic
// (src/make/routing.js); the model writes only the script and the storyboard.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, cp, link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_BRAND, suggestMotion } from "@launchclip/core/planning-prompt.mjs";
import { estimateModelUsageCost } from "../cost_tracker.js";
import { SHOTS_DIR, shotRequestLimit } from "../asset_provider.js";
import { assetProviderConcurrency, assetProviderTimeoutMs, createCommandAssetProvider } from "../asset_provider_cmd.js";
import { CONSTRAINTS_FILE, PROJECT_CONSTRAINTS_FILE, constrainProvider, constraintsDocument, hasConstraints, loadConstraints, neverUseMatcher, storySrc } from "../constraints.js";
import { mediaNotesLine } from "../inventory_notes.js";
import { checkStoryboard, planStoryboard } from "../storyboard_planner.js";
import { directionJson } from "@launchclip/core/direction.mjs";
import { profileForStory, resolveProfile } from "../profile_store.js";
import { resolveStyleV2 } from "../style_store.js";
import { generateProjectStyle, projectSeedStyle, promptConstraints, promptTone, adoptStyleLook } from "../style_seed_store.js";
import { getVoiceProvider } from "../voice/index.js";
import { VOICE_SETTINGS, narrationDocument, narrationRequest, normalizeVoiceSettings, synthesizeNarration, voiceCacheDir } from "../voice/narrate.js";
import { normalizePronunciation } from "../voice/pronunciation.js";
import { inventoryAssets } from "./assets.js";
import { describeMakeAssets, featuredForMake } from "./describe.js";
import { approvals, validateMakeOptions } from "./options.js";
import { animationBrief, isAnimation, isLongForm, routeLane } from "./routing.js";
import { ANIMATION_PROFILE, checkAnimationScript, estimatedPace, repairScreenplay, standInCast, writersRoom } from "./animation.js";
import { DEFAULT_DRAWING_STYLE, animationBriefLines, designBible, makeBible, savedForDesign } from "./show_bible.js";
import { BIBLE_FILE, BIBLE_SHEETS, bibleCast, withBible } from "@launchclip/core/bible.mjs";
import { readBible } from "../bible.js";
import { askYesNo } from "../demo/autopilot.js";
import { NARRATOR, SCREENPLAY_VERSION, screenplayNarration } from "@launchclip/core/screenplay.mjs";
import { dialogueDocument, dialogueGaps, dialogueRequests, synthesizeDialogue } from "../voice/dialogue.js";
import { LONG_FORM_VERSION, LONG_FORM_VOICE, chapterId, chapterNeedsResize, chapterWords, joinTakes, joinVoice, narrationTail, scriptMarkdown, shareSpare, wordCount, writeChapter, writeOutline } from "./long_form.js";
import { beatMapReportText, beatMapToDirection, beatMapToStory, directLongForm } from "@launchclip/core/beat-director.mjs";
import { applyStyle } from "@launchclip/core/style.mjs";
import { fallbackPlates, plateMotif } from "@launchclip/core/plates.mjs";
import { rewriteLongFormCopy } from "./long_form_copy.js";
import { captureFiles, readCaptureRequests, recordCaptures } from "./captures.js";
import { evidenceClipParams } from "@launchclip/core/catalog-d-evidence-clip.mjs";
import { RESEARCH_PATHS } from "../research/schema.js";
import { directLongFormVisuals, revertCards, typographyShare, unresolvedScenes } from "./long_form_direct.js";
import { checkModelAccess, createMakeClient, selectMakeModel } from "./models.js";
import { alternativeTransition, candidatesMode, comparisonEntry, designOpening, judgeCandidates, meanScore, openingScene, renderCandidate, rendererStill, riskyBoundary, sceneResolves, sceneTimes, selectCandidate, storyWith, transitionTimes, writeReceipt } from "./candidates.js";
import { conceptLookLines, conceptSummary, conceptsMode, planConceptStory, readConceptStory, storySeconds } from "./concept_story.js";
import { needsResize, planVoiceSpeed, RULES_HEADING, runsShort, SCRIPT_VERSION, WORDS_PER_MINUTE, writeScript } from "./script.js";
import { checkScript } from "../script_check.js";
import { checkStorage, interruptedByStorage } from "../storage_check.js";
import { SCRIPT_SKELETONS, chooseScriptPlan, scriptPlanOptions } from "@launchclip/core/script-formats.mjs";
import { chooseSkeleton, skeletonPlanLines, skeletonScriptPlan, storyboardStructureErrors } from "@launchclip/core/skeleton-library.mjs";
import { loadSkeletonLibrary } from "../skeletons.js";
import { talkingHeadLayout } from "../talking_head_layout.js";
import { runHeadlessCritic } from "./critic.js";
import { changedScenes, criticBriefSection, criticFindings, criticImproved, criticProblems, criticRepairBudget, criticRepairRoute, criticScore, findingScenes } from "./critic_repair.js";
import { readProjectStory } from "../story_loader.js";
import { plannedSubjectRanges } from "../subject/plan.js";
import { TRACK_FILE, appFacesTrack, fileProjectMatte, fileProjectTrack, readStoryTrack } from "../subject/project.js";
import { describeSource, runSubjectMatte, runSubjectProbe, runSubjectTrack } from "../subject/stage.js";
import { DemoReviewNeeded, demoManifestLines, stageDemo } from "./demo.js";
import { auditNarration, noteCaptures, researchBrief, researchEnabled, researchMode, stageMakeMedia } from "../research/make.js";
import { packCaptionsFor } from "@launchclip/core/style.mjs";
import { COVER_PATH } from "../cover.js";
import { DEFAULT_VISUAL_HISTORY_LIMIT, DEFAULT_VISUAL_SIMILARITY_LIMIT, assessVariety, fingerprintStory, historyAvoid, historyPrompt, readHistoryIndex, recordHistoryEntry, varyStory } from "../visual_history.js";
import { progressLine } from "../progress.js";
import { measureMachine, renderBudget } from "../capacity.js";

export const MAKE_VERSION = "launchclip.make.v1";
export const MAKE_MAX_REPAIRS = 4;
export const MAKE_PATHS = Object.freeze({
  report: "MAKE.json",
  assets: "ASSETS.json",
  brief: "BRIEF.md",
  script: "SCRIPT.json",
  angle: "ANGLE.json",
  concepts: "CONCEPTS.json",
  retention: "STORY.json",
  words: "NARRATION.json",
  story: "storyboard.json",
  direction: "DIRECTION.json",
  constraints: PROJECT_CONSTRAINTS_FILE,
  beatMap: "BEATMAP.json",
  scriptMarkdown: "SCRIPT.md",
  chapterTakes: ".launchclip/make/chapters",
  plan: ".launchclip/storyboard-plan.json",
  variety: ".launchclip/variety.json",
  state: ".launchclip/make-state.json",
  transcripts: ".launchclip/make/transcripts",
  take: ".launchclip/make/narration.wav",
  voiceover: "assets/audio/voiceover.wav",
  brandAssets: ".launchclip/make/brand-assets.json",
  base: "assets/base-edit.mp4",
  recording: "recording"
});

/** "A 45-second launch video for Ledgerly" → "launch-video-ledgerly" (≤ 40 chars). */
export function slugify(prompt) {
  const stop = new Set(["a", "an", "the", "for", "of", "to", "and", "that", "with", "called", "video", "second", "seconds", "minute"]);
  const words = String(prompt ?? "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter((word) => word && !stop.has(word) && !/^\d+$/.test(word));
  let slug = "";
  for (const word of words) {
    if ((slug ? `${slug}-${word}` : word).length > 40) break;
    slug = slug ? `${slug}-${word}` : word;
  }
  return slug || "video";
}

/**
 * options: {assets, aspect, duration, style, seed, profile, model, voice, voiceId, music, renderer,
 *   quality, concurrency (cores per render), out, replan, critic (true|false|undefined = auto), maxRepairs, minShots, cwd,
 *   repo, approveDemo, redemo, start, url, allowHost, demoPlan,
 *   subject (false: no presenter probe or subject effects), rules (a collection's
 *   RULES.md text: the script pass, the planner and the critic follow it),
 *   brandAssets (a collection's brand folder: its images, notes and brand.json join
 *   the assets under assets/collection-brand/),
 *   visualHistoryDir (the series' history index: plan against it, record into it),
 *   visualHistoryLimit (recent entries the planner sees, default 8),
 *   visualSimilarityLimit (the variety lint's limit, default 0.6)}
 * adapters: {env, client ({client, provider, model, vision}), clientOptions
 * (passed to the client make builds from the keys: {apiKey, sdk, fetch}), fetch
 * (the model check asks a local Ollama for its model list through it), transcribe,
 *   inventory, voiceProvider, normalizeVoice, prepareRecording,
 *   subject ({probe(src, options), matte(src, range, options)}), finish
 *   (runFinish replacement or adapters for it: finishAdapters), notice, now, clock}
 * Returns the MAKE.json report. Throws only on bad options; stage failures
 * are reported with status "failed" and a next step.
 */
export async function runMake(prompt, options = {}, adapters = {}) {
  const env = adapters.env ?? process.env;
  const notice = adapters.notice ?? ((line) => process.stderr.write(`${line}\n`));
  const progress = (event) => notice(progressLine(event));
  const now = adapters.now ?? (() => performance.now());
  const clock = adapters.clock ?? (() => new Date().toISOString());
  const text = String(prompt ?? "").trim();
  if (!text) throw new Error("launchclip make needs a prompt: launchclip make \"A 30-second launch video for …\" [--assets ./assets]");
  const { voice: voiceProvider, renderer, quality, script: scriptOptions } = validateMakeOptions(options);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  // Inside a library (options.library, src/library.js) a project without
  // --out goes under storage.projects, and its drive is checked first.
  const library = options.library ?? null;
  const project = path.resolve(options.out || !library ? cwd : library.storage.projects, options.out ?? `launchclip-${slugify(text)}`);
  if (library) await checkStorage(project, { minFreeGb: library.storage.min_free_gb, label: options.out ? "--out" : "storage.projects", source: library.file });
  await mkdir(project, { recursive: true });
  const previousState = await readJson(path.join(project, MAKE_PATHS.state)) ?? {};
  const assetsDir = options.assets ? path.resolve(cwd, String(options.assets)) : previousState.assets_dir ?? null;
  const started = now();
  const report = {
    schema_version: MAKE_VERSION,
    status: "running",
    prompt: text,
    project,
    library: library?.file ?? null,
    assets_dir: assetsDir,
    options: { aspect: options.aspect ?? null, duration: options.duration ?? null, style: options.style ?? null, seed: options.seed ?? null, ...(options.density != null ? { density: Number(options.density) } : {}), ...(Number(options.minShots) > 0 ? { min_shots: Number(options.minShots) } : {}), profile: options.profile ?? null, voice: voiceProvider, voice_id: options.voiceId ?? null, music: options.music ?? null, ...(options.musicVolume != null ? { music_volume: Number(options.musicVolume) } : {}), ...(options.musicDuck != null ? { music_duck: Number(options.musicDuck) } : {}), ...(options.musicPrompt != null ? { music_prompt: String(options.musicPrompt) } : {}), ...(options.sfx != null ? { sfx: String(options.sfx).toLowerCase() } : {}), ...(options.layout != null ? { layout: talkingHeadLayout(options.layout) } : {}), renderer, quality, replan: Boolean(options.replan), critic: options.critic ?? "auto", critic_repairs: criticRepairBudget(options.criticRepairs), visual_history_dir: options.visualHistoryDir ?? null, ...scriptOptions, ...(options.pace != null ? { pace: String(options.pace).toLowerCase() } : {}), ...(options.ctaKeyword != null ? { cta_keyword: String(options.ctaKeyword) } : {}), ...(options.ctaOffer != null ? { cta_offer: String(options.ctaOffer) } : {}), ...(options.episode != null ? { episode: String(options.episode) } : {}), ...(options.choices != null ? { choices: String(options.choices) } : {}), renderer, quality, replan: Boolean(options.replan), critic: options.critic ?? "auto", critic_repairs: criticRepairBudget(options.criticRepairs), visual_history_dir: options.visualHistoryDir ?? null, ...scriptOptions, ...(options.research ? { research: researchMode(options.research) } : {}), ...(options.stopAfter != null ? { stop_after: String(options.stopAfter).toLowerCase() } : {}), ...(approvals(options.approve).length ? { approve: approvals(options.approve) } : {}) },
    model: null,
    model_access: null,
    routing: null,
    stages: {},
    timings: {},
    costs: { items: [], estimated_usd: 0, complete: true },
    repairs: null,
    gates: null,
    candidates: null,
    critic: null,
    final: null,
    warnings: [],
    notices: [],
    next_steps: [],
    started_at: clock()
  };
  const say = (line) => { report.notices.push(line); notice(line); };
  const state = { ...previousState, assets_dir: assetsDir };
  const ctx = { project, env, adapters, options, report, state, say, progress, voiceProvider, renderer, quality, text, assetsDir };

  const stages = [
    ["model", stageModel],
    ["inventory", stageInventory],
    ["demo", stageDemo],
    ["route", stageRoute],
    ["prepare", stagePrepare],
    // The animation path's own stages sit here, between the voiced script and the shot list.
    ["bible", stageBible],
    ["storyboard", stageStoryboard],
    ["candidates", stageCandidates],
    ["subject", stageSubject],
    ["finish", stageFinish],
    ["critic", stageCritic]
  ];
  for (const [index, [name, fn]] of stages.entries()) {
    // A stage that set ctx.stop ends the run there: the later stages are skipped, with its reason.
    if (ctx.stop) {
      report.stages[name] = { status: "skipped", reason: ctx.stop.reason };
      continue;
    }
    const t0 = now();
    progress({ stage: name, done: index, total: stages.length });
    try {
      const result = await fn(ctx);
      report.stages[name] = { status: result?.status ?? "done", ...(result?.reason ? { reason: result.reason } : {}) };
    } catch (error) {
      // A drive unplugged mid-job: stop with one clear line; nothing more can be written there.
      const gone = interruptedByStorage(project, { command: "launchclip make", stage: name });
      if (gone) throw gone;
      report.stages[name] = { status: "failed", error: String(error?.message ?? error) };
      report.status = "failed";
      report.failed_stage = name;
      report.next_steps.unshift(nextStepFor(name, error, ctx));
    }
    report.timings[name] = round1((now() - t0) / 1000);
    progress({ stage: name, status: report.stages[name].status, seconds: report.timings[name] });
    await writeJson(path.join(project, MAKE_PATHS.state), state);
    if (report.status === "failed") break;
  }
  report.timings.total = round1((now() - started) / 1000);
  report.costs.estimated_usd = round4(report.costs.items.reduce((sum, item) => sum + (item.estimated_usd ?? 0), 0));
  report.costs.complete = report.costs.items.every((item) => item.estimated_usd != null);
  if (ctx.stop && report.status !== "failed") {
    report.status = ctx.stop.status;
    report.stopped = { after: ctx.stop.after, reason: ctx.stop.reason };
    report.next_steps.push(...ctx.stop.next);
  } else if (report.status !== "failed") {
    const statuses = Object.values(report.gates ?? {}).map((gate) => gate.status);
    report.status = statuses.includes("failed") ? "needs-repair" : statuses.includes("pending") ? "ready-for-review" : "ready";
  }
  report.finished_at = clock();
  if (report.variety && ["ready", "ready-for-review"].includes(report.status)) await recordHistory(ctx, clock);
  await writeJson(path.join(project, MAKE_PATHS.report), report);
  return report;
}

// A finished video joins the history index (the fingerprint the lint used,
// plus the rendered cover), replacing this project's earlier entry.
async function recordHistory(ctx, clock) {
  const { project, report } = ctx;
  if (!ctx.varietyFingerprint) return;
  try {
    const fingerprint = { ...ctx.varietyFingerprint };
    if (fingerprint.cover && existsSync(path.join(project, COVER_PATH))) fingerprint.cover = { ...fingerprint.cover, file: COVER_PATH };
    report.variety.recorded = await recordHistoryEntry(report.variety.history_dir, fingerprint, { clock });
  } catch (error) {
    report.warnings.push(`variety: the video was not recorded in ${report.variety.history_dir} (${String(error?.message ?? error).split("\n")[0]})`);
  }
}

// ---------------------------------------------------------------------------
// Stages

async function stageModel(ctx) {
  const { adapters, options, env, report } = ctx;
  if (adapters.client) {
    ctx.model = { ...adapters.client, spec: adapters.client.spec ?? `${adapters.client.provider}:${adapters.client.model}`, source: "adapter" };
  } else {
    const { spec, source } = selectMakeModel(options.model, env);
    ctx.model = { ...createMakeClient(spec, adapters.clientOptions ?? {}), spec, source };
  }
  report.model = { spec: ctx.model.spec, source: ctx.model.source, provider: ctx.model.provider, model: ctx.model.model, reasoning: ctx.model.reasoning ?? null, vision: Boolean(ctx.model.vision) };
  // Which roles this run's model can play (text and vision), so an app can
  // show what the run will and will not check. No paid call (models.js).
  report.model_access = await checkModelAccess({ env, selected: ctx.model, fetch: adapters.fetch });
  return { status: "done" };
}

async function stageInventory(ctx) {
  const { project, report, adapters, state, assetsDir } = ctx;
  const constraints = await loadMakeConstraints(ctx);
  ctx.voiceInputs = await loadVoiceInputs(ctx);
  const brandDir = ctx.options.brandAssets ? path.resolve(ctx.options.cwd ?? process.cwd(), String(ctx.options.brandAssets)) : null;
  const brand = brandDir ? await brandEntries(ctx, brandDir) : [];
  if (!assetsDir) {
    ctx.inventory = { schema_version: "launchclip.make-assets.v1", dir: null, entries: brand, counts: {}, summary: [] };
    state.inventory = brand.map((entry) => [entry.path, entry.fingerprint]);
    await writeJson(path.join(project, MAKE_PATHS.assets), ctx.inventory);
    if (brand.length) report.assets = { file: MAKE_PATHS.assets, counts: {}, brand_assets: brand.length };
    return brand.length ? { status: "done", reason: `no --assets folder; ${brand.length} brand asset(s)` } : { status: "skipped", reason: "no --assets folder" };
  }
  const cache = await readJson(path.join(project, MAKE_PATHS.assets));
  const never = constraints ? neverUseMatcher(constraints, { assetsDir }) : null;
  const inventory = await (adapters.inventory ?? inventoryAssets)(assetsDir, {
    cache: cache?.dir === assetsDir ? cache : null,
    // never_use media is not inventoried, copied or offered; constraints.json is the app's, not an asset.
    metadata: [CONSTRAINTS_FILE, PRONUNCIATION_FILE, VOICE_FILE],
    ...(never ? { exclude: (relative) => (never({ src: relative }) ? "never_use (constraints)" : null) } : {}),
    // --base-transcript: the app has the recording's words already, so make
    // never runs local Whisper (slow on a busy CPU, and its words are unused).
    transcribe: adapters.transcribe ?? (ctx.options.baseTranscript ? null : async (file) => {
      const { transcribeRecording } = await import("../recording_workflow.js");
      return transcribeRecording(file, { model: "base.en", language: "en" });
    })
  });
  // Raw transcripts go to their own files (edit-recording reads them back).
  for (const entry of inventory.entries) {
    if (entry.transcript?.raw) {
      const file = path.join(project, MAKE_PATHS.transcripts, `${entry.path.replace(/[\\/]/g, "__")}.json`);
      await writeJson(file, entry.transcript.raw);
      entry.transcript.raw_file = path.relative(project, file);
      delete entry.transcript.raw;
    }
  }
  // Copy (hard-link when possible) every usable file into the project's assets/.
  for (const entry of inventory.entries) {
    if (entry.kind === "other") continue;
    await linkOrCopy(path.join(assetsDir, entry.path), path.join(project, "assets", entry.path));
  }
  for (const warning of inventory.notes?.warnings ?? []) report.warnings.push(`notes: ${warning}`);
  if (constraints) {
    const missing = constraints.must_use.filter((entry) => !inventory.entries.some((item) => item.path === entry.src));
    if (missing.length) throw new Error(`constraints: must_use ${missing.map((entry) => entry.src).join(", ")} ${missing.length === 1 ? "is" : "are"} not in --assets ${assetsDir}`);
    report.constraints = { ...report.constraints, excluded: (inventory.excluded ?? []).map((entry) => entry.path) };
  }
  // What each image and clip shows (src/asset_understanding.js): the caller's notes, the model, or a local guess.
  const described = await describeMakeAssets(ctx, inventory);
  for (const result of described.results) addCost(report, "asset-description", ctx.model, result);
  inventory.entries.push(...brand);
  ctx.inventory = inventory;
  state.inventory = inventory.entries.map((entry) => [entry.path, entry.fingerprint]);
  await writeJson(path.join(project, MAKE_PATHS.assets), inventory);
  report.assets = { file: MAKE_PATHS.assets, counts: inventory.counts, ...(brand.length ? { brand_assets: brand.length } : {}), ...(described.described.length ? { descriptions: described.counts } : {}) };
  return { status: "done" };
}

// The app's constraints (src/constraints.js): --constraints <file>, else
// constraints.json in --assets. The normalised copy goes to CONSTRAINTS.json
// beside the storyboard, where story validate and finish's gate read it; a
// run without constraints removes a stale copy.
async function loadMakeConstraints(ctx) {
  const { project, report, assetsDir, options } = ctx;
  const flag = options.constraints && options.constraints !== true ? path.resolve(options.cwd ?? process.cwd(), String(options.constraints)) : null;
  const file = flag ?? (assetsDir && existsSync(path.join(assetsDir, CONSTRAINTS_FILE)) ? path.join(assetsDir, CONSTRAINTS_FILE) : null);
  const target = path.join(project, MAKE_PATHS.constraints);
  if (!file) {
    ctx.constraints = null;
    ctx.faces = [];
    await rm(target, { force: true });
    return null;
  }
  const constraints = await loadConstraints(file);
  ctx.constraints = hasConstraints(constraints) ? constraints : null;
  ctx.faces = constraints.faces ?? [];
  await writeJson(target, constraintsDocument(constraints));
  report.constraints = { file: MAKE_PATHS.constraints, source: file, ranges: constraints.ranges.length, must_use: constraints.must_use.map((entry) => entry.src), never_use: constraints.never_use.map((entry) => entry.src ?? `id:${entry.id}`) };
  return ctx.constraints;
}

// The app's narration settings in --assets (app metadata, not assets):
// pronunciation.json { "term": "say-as" } respells terms in the text the
// voice speaks, never in the captions; voice.json { voice?, speed?,
// stability?, similarity?, style?, speaker_boost? } tunes the voice where the
// provider has the setting (--voice-id wins over its voice).
export const PRONUNCIATION_FILE = "pronunciation.json";
export const VOICE_FILE = "voice.json";

async function loadVoiceInputs(ctx) {
  const { assetsDir, report } = ctx;
  if (!assetsDir) return {};
  const read = async (name) => {
    const file = path.join(assetsDir, name);
    if (!existsSync(file)) return undefined;
    const value = await readJson(file);
    if (value === null || value === undefined) throw new Error(`${name} in --assets is not readable JSON`);
    return value;
  };
  const pronunciation = normalizePronunciation(await read(PRONUNCIATION_FILE), PRONUNCIATION_FILE);
  const voice = await read(VOICE_FILE);
  if (voice !== undefined && (typeof voice !== "object" || Array.isArray(voice))) throw new Error(`${VOICE_FILE} must be an object of voice, speed, ${Object.keys(VOICE_SETTINGS).join(", ")}`);
  const { voice: voiceId, speed, ...rest } = voice ?? {};
  if (voiceId !== undefined && !(typeof voiceId === "string" && voiceId.trim())) throw new Error(`${VOICE_FILE}.voice must be a non-empty voice id`);
  if (speed !== undefined && !(typeof speed === "number" && speed >= 0.5 && speed <= 2)) throw new Error(`${VOICE_FILE}.speed must be a number between 0.5 and 2; got ${JSON.stringify(speed)}`);
  const settings = normalizeVoiceSettings(rest, VOICE_FILE);
  const inputs = { ...(voiceId !== undefined ? { voice: voiceId.trim() } : {}), ...(speed !== undefined ? { speed } : {}), ...(pronunciation ? { pronunciation } : {}), ...(settings ? { settings } : {}) };
  if (Object.keys(inputs).length) report.voice_inputs = { ...(pronunciation ? { pronunciation: Object.keys(pronunciation).length } : {}), ...(voiceId !== undefined ? { voice: inputs.voice } : {}), ...(speed !== undefined ? { speed } : {}), ...(settings ? { settings } : {}) };
  return inputs;
}

// --pace, --cta-keyword/--cta-offer and --episode/--choices: the script plan's craft options.
function scriptCraftOptions(options) {
  return {
    ...(options.ctaKeyword != null ? { ctaKeyword: options.ctaKeyword } : {}),
    ...(options.ctaOffer != null ? { ctaOffer: options.ctaOffer } : {}),
    ...(options.episode != null ? { episode: options.episode } : {}),
    ...(options.choices != null ? { choices: options.choices } : {})
  };
}

// The voice fields of every narration request make sends: voice.json and
// pronunciation.json, then --voice-id over voice.json's voice.
// An ElevenLabs voice with no speed of its own speaks at the script plan's pace (--pace).
function narrationVoice(ctx) {
  const inputs = ctx.voiceInputs ?? {};
  const voice = ctx.options.voiceId ? String(ctx.options.voiceId) : inputs.voice;
  const speed = planVoiceSpeed(ctx.voiceProvider, ctx.scriptPlan, inputs.speed);
  return { provider: ctx.voiceProvider, ...(voice ? { voice } : {}), ...(speed !== undefined ? { speed } : {}), ...(inputs.pronunciation ? { pronunciation: inputs.pronunciation } : {}), ...(inputs.settings ? { settings: inputs.settings } : {}) };
}

// A collection's brand folder (docs/COLLECTIONS_RFC.md §3.2): its logos,
// images, notes and brand.json join the inventory as collection-brand/<path>.
// Its videos and audio do not, so a brand folder never decides the lane.
const BRAND_KINDS = new Set(["image", "notes", "brand"]);

async function brandEntries(ctx, dir) {
  const cacheFile = path.join(ctx.project, MAKE_PATHS.brandAssets);
  const cache = await readJson(cacheFile);
  const inventory = await (ctx.adapters.inventory ?? inventoryAssets)(dir, { cache: cache?.dir === dir ? cache : null });
  await writeJson(cacheFile, inventory);
  const entries = inventory.entries.filter((entry) => BRAND_KINDS.has(entry.kind));
  for (const entry of entries) if (entry.kind !== "notes") await linkOrCopy(path.join(dir, entry.path), path.join(ctx.project, "assets", "collection-brand", entry.path));
  return entries.map((entry) => ({ ...entry, path: `collection-brand/${entry.path}`, source: "brand-assets" }));
}

async function stageRoute(ctx) {
  const { report, options, text } = ctx;
  const routing = routeLane(ctx.inventory, { aspect: options.aspect, duration: options.duration, prompt: text, animation: options.animation === true });
  ctx.routing = routing;
  report.routing = routing;
  for (const entry of routing.ignored) report.warnings.push(`${entry.path}: ${entry.reason}`);
  return { status: "done" };
}

async function stagePrepare(ctx) {
  const lane = ctx.routing.lane;
  if (lane === "footage-led") return prepareFootage(ctx);
  if (lane === "voiceover-motion") return prepareVoiceover(ctx);
  if (isAnimation(ctx.routing)) return prepareAnimation(ctx);
  if (isLongForm(ctx.routing)) return prepareLongForm(ctx);
  return prepareMotion(ctx);
}

// Footage-led: the base edit (edit-recording: silences, bad takes, fillers,
// plus audio enhancement when this build has it), whose rendered base-edit.mp4
// becomes the base and whose edited transcript becomes NARRATION.json.
async function prepareFootage(ctx) {
  const { project, routing, report, adapters, state } = ctx;
  const entry = ctx.inventory.entries.find((item) => item.path === routing.base.path);
  const source = path.join(project, "assets", entry.path);
  const enhancement = await audioEnhancementFeature();
  report.base_edit = { source: `assets/${entry.path}`, enhancement };
  // --base-edited: the app already cut this recording (bad takes, pauses)
  // and its edit stays canonical, so make mounts it as is.
  if (ctx.options.baseEdited || ctx.options.baseTranscript) return suppliedFootage(ctx, entry);
  const transcriptFile = entry.transcript?.raw_file ? path.join(project, entry.transcript.raw_file) : null;
  const { prepareRecording, recordingOptions } = await import("../recording_workflow.js");
  const recordingOpts = { ...recordingOptions({}), out: path.join(project, MAKE_PATHS.recording), aspect: routing.aspect, ...(transcriptFile ? { transcript: transcriptFile } : {}) };
  if (enhancement.available && typeof enhancement.default === "boolean") recordingOpts[enhancement.option] = true;
  let words;
  let duration;
  let result = null;
  try {
    result = await (adapters.prepareRecording ?? prepareRecording)(source, recordingOpts);
  } catch (error) {
    report.warnings.push(`base edit failed (${String(error?.message ?? error).split("\n")[0]}); using the unedited recording`);
  }
  if (result?.status === "ready") {
    await linkOrCopy(result.output, path.join(project, MAKE_PATHS.base), { replace: true });
    const transcript = await readJson(result.files.transcript);
    words = (transcript?.words ?? []).map((word) => ({ text: String(word.word ?? word.text), start: word.start, end: word.end }));
    duration = Number(result.rendered_duration_seconds ?? result.duration_seconds);
    report.base_edit = { ...report.base_edit, status: "ready", output: MAKE_PATHS.base, source_seconds: result.source_duration_seconds, edited_seconds: duration, cached: Boolean(result.cached), manifest: path.relative(project, result.manifest ?? path.join(project, MAKE_PATHS.recording, "recording.json")) };
    ctx.base = { src: MAKE_PATHS.base, fit: "cover" };
  } else if (result?.status === "needs-semantic-review" && result.candidate && existsSync(result.candidate) && result.files?.plan) {
    // The QA found ambiguities it cannot settle without a semantic reviewer
    // (an agent's --qa-decisions receipt or a local --qa-model), not defects.
    // Headless, make uses the rendered candidate and leaves that review
    // pending, with the issues, instead of throwing the edit away.
    const plan = await readJson(result.files.plan);
    words = (plan?.words ?? []).map((word) => ({ text: String(word.word ?? word.text), start: word.start, end: word.end }));
    duration = Number(plan?.duration_seconds ?? result.duration_seconds);
    await linkOrCopy(result.candidate, path.join(project, MAKE_PATHS.base), { replace: true });
    const issues = (result.qa?.issues ?? []).map((issue) => `${issue.kind} @${round1(Number(issue.start_seconds ?? 0))}s: ${String(issue.explanation ?? "").split(". ")[0]}`);
    report.base_edit = { ...report.base_edit, status: "candidate", qa_status: result.status, qa_issues: issues, output: MAKE_PATHS.base, source_seconds: result.source_duration_seconds, edited_seconds: duration };
    report.warnings.push(`base edit QA needs a semantic review (${issues.length} ambiguous issue${issues.length === 1 ? "" : "s"}); make used the rendered candidate edit. Listen to ${MAKE_PATHS.base} around the listed times, or rerun edit-recording with --qa-decisions`);
    ctx.baseEditQa = { status: "pending", reason: "edit-recording QA needs a semantic review of ambiguous joins", issues };
    ctx.base = { src: MAKE_PATHS.base, fit: "cover" };
  } else {
    if (result) report.warnings.push(`base edit status ${result.status}: ${result.next_action ?? "see recording/recording-qa.json"}; using the unedited recording`);
    words = entry.transcript?.words ?? [];
    duration = Number(entry.media?.duration);
    report.base_edit = { ...report.base_edit, status: result?.status ?? "failed", output: null };
    ctx.base = { src: `assets/${entry.path}`, fit: "cover" };
  }
  return footageWords(ctx, entry, words, duration);
}

// A base the app edited itself: no edit-recording pass; its words come from
// --base-transcript (word-timed JSON: Whisper's, or {words: [{text|word,
// start, end}]}) when given, else from the inventory's transcription.
async function suppliedFootage(ctx, entry) {
  const { report } = ctx;
  const words = (await baseTranscriptWords(ctx)) ?? entry.transcript?.words ?? [];
  const duration = Number(entry.media?.duration) || Number(words.at(-1)?.end ?? 0);
  report.base_edit = { source: `assets/${entry.path}`, status: "supplied", output: `assets/${entry.path}`, edited_seconds: duration, transcript: ctx.options.baseTranscript ? "supplied" : "inventory" };
  ctx.base = { src: `assets/${entry.path}`, fit: "cover" };
  return footageWords(ctx, entry, words, duration);
}

// --base-transcript's words ({text, start, end}), or null without the flag.
async function baseTranscriptWords(ctx) {
  if (!ctx.options.baseTranscript) return null;
  const file = path.resolve(ctx.options.cwd ?? process.cwd(), String(ctx.options.baseTranscript));
  const transcript = await readJson(file);
  if (!transcript) throw new Error(`--base-transcript ${file} is not readable JSON`);
  const { normalizeRecordingTranscript } = await import("../recording_edit.js");
  return normalizeRecordingTranscript(transcript).map((word) => ({ text: word.word, start: word.start, end: word.end }));
}

async function footageWords(ctx, entry, words, duration) {
  const { project, report, routing, state } = ctx;
  if (!words.length) throw new Error(`no transcript words for ${entry.path}; footage-led needs the recording's words (pass --base-transcript, or install local Whisper: launchclip doctor)`);
  await writeJson(path.join(project, MAKE_PATHS.words), { schema_version: "launchclip.narration.v1", provider: "recording", text: words.map((word) => word.text).join(" "), duration_seconds: duration, words });
  ctx.words = words;
  ctx.narrationText = words.map((word) => word.text).join(" ");
  ctx.format = { ...routing.format, duration: Math.max(3, Math.floor(duration * 10) / 10) };
  if (ctx.options.duration && Number(ctx.options.duration) < ctx.format.duration) {
    report.warnings.push(`--duration ${ctx.options.duration} is shorter than the edited recording (${ctx.format.duration}s); the video keeps the full edit`);
  }
  ctx.audio = { words: MAKE_PATHS.words };
  report.script = { source: "recording", words: words.length, note: "footage-led: the recording's own words are the narration; no script pass" };
  state.prepare = { lane: "footage-led", base: ctx.base.src };
  ctx.subject = await probeFootageSubject(ctx);
  return { status: "done" };
}

// The presenter probe (docs/SUBJECT_EFFECTS_RFC.md §4.3): before planning, so
// the planner knows the framing and whether subject effects are possible. A
// missing runtime or model never fails make; it only means no subject effects.
async function probeFootageSubject(ctx) {
  const { project, report, adapters, options } = ctx;
  if (options.subject === false) {
    report.subject = { status: "off", reason: "--no-subject" };
    // --face-track: no subject effects, but the head track still runs so
    // tooling keeps cards off the face (src/face_clear_fit.js).
    if (options.faceTrack) await trackFootageSubject(ctx, path.join(project, ctx.base.src));
    if (!report.subject.track?.src) await fileAppFaces(ctx);
    return null;
  }
  const src = path.join(project, ctx.base.src);
  try {
    const probe = adapters.subject?.probe ?? runSubjectProbe;
    const { probe: result, cached } = await probe(src, { cacheDir: path.join(project, ".launchclip", "subject"), log: ctx.say });
    const summary = { usable: result.usable, reasons: result.reasons, framing: result.framing, headroom: result.headroom, head: result.head, people: result.people };
    report.subject = { status: result.usable ? "usable" : "unusable", ...summary, cached: Boolean(cached), mattes: [] };
    if (!result.usable) report.notices.push(`subject: no subject effects (${result.reasons.join("; ")})`);
    if (result.people !== "none") await trackFootageSubject(ctx, src);
    return { src: ctx.base.src, probe: summary };
  } catch (error) {
    const reason = String(error?.message ?? error).split("\n")[0];
    report.subject = { status: "unavailable", reason };
    report.warnings.push(`presenter probe skipped (${reason}); planning without subject effects. Run launchclip doctor`);
    return null;
  }
}

// The whole-video head track (docs/VIDEO_QUALITY_RFC.md §7.2), filed as
// assets/subject/track.json so placement and layout-check's face rule know
// where the head is outside the matted ranges. Cached like the probe; a
// failure only costs the track.
async function trackFootageSubject(ctx, src) {
  const { project, report, adapters } = ctx;
  try {
    const track = adapters.subject?.track ?? runSubjectTrack;
    const { track: result, cached } = await track(src, { cacheDir: path.join(project, ".launchclip", "subject"), log: ctx.say });
    const filed = await fileProjectTrack(project, src, result);
    report.subject.track = { src: filed.src, frames: result.frames.length, fps: result.fps, cached: Boolean(cached) };
  } catch (error) {
    const reason = String(error?.message ?? error).split("\n")[0];
    report.subject.track = { status: "unavailable", reason };
    report.warnings.push(`presenter track skipped (${reason}); the face rule only sees the matted ranges`);
  }
}

// The app's face boxes (constraints.json faces) filed as the head track,
// when nothing tracked the presenter: only for the recording as supplied,
// since the boxes are on its timeline (a base edit cuts it).
async function fileAppFaces(ctx) {
  const { project, report, adapters, options } = ctx;
  const faces = ctx.faces ?? [];
  if (!faces.length) return;
  const supplied = report.base_edit?.source;
  if (!supplied || ctx.base?.src !== supplied) {
    report.warnings.push(`constraints faces ignored: they are on ${supplied ?? "the supplied recording"}'s timeline, and make edited it (pass --base-edited with an edited recording)`);
    return;
  }
  try {
    const src = path.join(project, ctx.base.src);
    const source = await (adapters.subject?.describe ?? describeSource)(src);
    const filed = await fileProjectTrack(project, src, appFacesTrack(faces, source));
    report.subject.track = { src: filed.src, frames: faces.length, source: "constraints faces" };
  } catch (error) {
    report.warnings.push(`constraints faces not used (${String(error?.message ?? error).split("\n")[0]}); tooling places cards around the default head`);
  }
}

// Voiceover-motion: the supplied voiceover is prepared (pauses tightened,
// levelled, transcribed with word timings) into assets/audio/voiceover.wav.
// --base-transcript supplies its words (no Whisper pass in the inventory);
// --base-edited says the app already edited it: no pause edit and no second
// Whisper pass, only levelling, with the supplied (or inventory) word timings.
async function prepareVoiceover(ctx) {
  const { project, routing, report, adapters, state, options } = ctx;
  const entry = ctx.inventory.entries.find((item) => item.path === routing.voiceover.path);
  const supplied = await baseTranscriptWords(ctx);
  const text = supplied ? supplied.map((word) => word.text).join(" ") : entry.transcript?.text?.trim();
  if (!text) throw new Error(`the voiceover ${entry.path} has no transcript; make needs its words (pass --base-transcript, or install local Whisper: launchclip doctor)`);
  const edited = Boolean(options.baseEdited);
  const timed = edited ? supplied ?? (entry.transcript?.words?.length ? entry.transcript.words : null) : null;
  const sourceFile = path.join(project, "assets", entry.path);
  const voiceFile = path.join(project, MAKE_PATHS.voiceover);
  const doc = path.join(project, MAKE_PATHS.words);
  const sourceHash = hashValue({ source: await fileHash(sourceFile), edited, words: supplied });
  let take;
  const previous = await readJson(doc);
  if (state.prepare?.voiceover_hash === sourceHash && previous?.words?.length && existsSync(voiceFile)) {
    take = { words: previous.words, duration: previous.duration_seconds, cached: true };
  } else {
    const request = { text, provider: "supplied", voice: null, speed: 1 };
    take = await synthesizeNarration(request, {
      outFile: voiceFile,
      voiceProvider: adapters.voiceProvider ?? ((name, providerOptions) => getVoiceProvider(name, providerOptions)),
      normalizeVoice: adapters.normalizeVoice,
      source: sourceFile,
      ...(edited ? { edited: true } : {}),
      ...(timed ? { words: timed } : {})
    });
    await writeJson(doc, narrationDocument(request, take));
  }
  ctx.words = take.words;
  ctx.narrationText = take.words.map((word) => word.text).join(" ");
  ctx.format = { ...routing.format, duration: round1(take.duration + 0.6) };
  ctx.audio = { voice: MAKE_PATHS.voiceover, words: MAKE_PATHS.words };
  report.script = { source: "voiceover", words: take.words.length, seconds: take.duration, transcript: supplied ? "supplied" : "inventory", edited, note: "voiceover-motion: the supplied voiceover is the narration; no script pass" };
  state.prepare = { lane: "voiceover-motion", voiceover_hash: sourceHash };
  return { status: "done" };
}

// Motion: the script pass writes the narration, the script checks run on it
// (one repair pass on errors), the voice is synthesised (Kokoro by default;
// cached), and one resize pass runs when the measured take runs more than 15%
// over the target duration. The duration is a ceiling: a take that runs short
// is kept, and the video is shorter.
async function prepareMotion(ctx) {
  const { project, routing, report, state, options, voiceProvider } = ctx;
  const target = routing.format.duration;
  const briefNotes = await notesText(ctx);
  // --research on: the brief is checked against sources, and the script pass writes from what they state (src/research/make.js).
  const research = await researchBrief(ctx, briefNotes);
  if (research) startCaptures(ctx);
  const notes = research ? [...briefNotes, research.notes] : briefNotes;
  const rules = rulesText(ctx);
  const assetLines = assetManifestLines(ctx).map((item) => item.line);
  // The skeleton library (docs/VIRAL_FORMATS_RFC.md): a short video whose brief fits a library skeleton is built on it (--skeleton pins one).
  const skeleton = chooseMakeSkeleton(ctx, target);
  // The planning pass: format, goal and awareness (flags, else the brief's defaults), on the library skeleton's beats when there is one.
  const pinned = !skeleton && SCRIPT_SKELETONS[options.skeleton] ? options.skeleton : undefined;
  const planOptions = { prompt: ctx.text, duration: target, aspect: routing.aspect, assets: ctx.inventory?.entries, ...scriptPlanOptions(options), ...scriptCraftOptions(options), ...(pinned ? { skeleton: pinned } : {}) };
  const plan = skeleton ? skeletonScriptPlan(planOptions, skeleton) : chooseScriptPlan(planOptions);
  ctx.scriptPlan = plan;
  const planChecks = { format: plan.format, goal: plan.goal, awareness: plan.awareness, pace: plan.pace, ...(plan.cta?.keyword ? { ctaKeyword: plan.cta.keyword } : {}), ...(plan.series?.choices ? { choices: plan.series.choices } : {}) };
  // Concept and story first (docs/MAKE_SKILL_PARITY.md, phase 3): five concepts judged in a fresh context, the winner written and edited as a story.
  const conceptStory = await stageConceptStory(ctx, { notes, rules, assets: assetLines, duration: target, wpm: plan.wpm });
  const scriptHash = hashValue({ prompt: ctx.text, notes, assets: assetLines, target, model: ctx.model.spec, voice: voiceProvider, ...(options.voiceId ? { voice_id: String(options.voiceId) } : {}), plan: [plan.format, plan.goal, plan.awareness, plan.pace, plan.cta ?? null, plan.series ?? null], skeleton: [plan.skeleton, skeleton?.version ?? null], ...(rules ? { rules } : {}), ...(conceptStory ? { story: hashValue(conceptStory.story.narration) } : {}), v: 3 });
  let script = await readJson(path.join(project, MAKE_PATHS.script));
  const reuse = script && state.script?.hash === scriptHash && script.narration;
  if (!reuse) {
    ctx.say(`model: PAID call to ${ctx.model.provider} ${ctx.model.model} (script pass, ${plan.format}, about ${plan.word_target} words)`);
    const written = await writeScript({ client: ctx.model.client, model: ctx.model.model, provider: ctx.model.provider, prompt: ctx.text, notes, rules, assets: assetLines, duration: target, plan, skeleton, ...(conceptStory ? { story: conceptStory } : {}) });
    addCost(report, "script", ctx.model, written);
    script = { ...written, passes: [{ kind: "write", words: written.word_count, cost_usd: written.cost_usd }] };
    const first = checkScript({ narration: script.narration, duration: target, brief: { prompt: ctx.text, notes, assets: assetLines }, ...planChecks });
    if (!first.ok) {
      ctx.say(`script: ${first.errors.length} script check error(s) (${[...new Set(first.errors.map((error) => error.id))].join(", ")}); one repair pass (PAID call to ${ctx.model.provider} ${ctx.model.model})`);
      const repaired = await writeScript({ client: ctx.model.client, model: ctx.model.model, provider: ctx.model.provider, prompt: ctx.text, notes, rules, assets: assetLines, duration: target, plan, skeleton, angle: script.angle, ...(conceptStory ? { story: conceptStory } : {}), repair: { previous: script.narration, errors: first.errors } });
      addCost(report, "script-repair", ctx.model, repaired);
      script = { ...repaired, passes: [...script.passes, { kind: "repair", words: repaired.word_count, errors: first.errors.map((error) => error.id), cost_usd: repaired.cost_usd }] };
    }
  }
  if (voiceProvider === "elevenlabs") ctx.say("voice: PAID ElevenLabs text-to-speech for the narration (cached per text in .launchclip/voice)");
  let take = await synthesize(ctx, script.narration);
  if (!reuse && needsResize(take.duration, target)) {
    ctx.say(`script: the take runs ${take.duration}s, over the ${target}s target; one resize pass (PAID call to ${ctx.model.provider} ${ctx.model.model})`);
    const measuredWpm = take.words.length / Math.max(1, take.duration) * 60;
    const resized = await writeScript({ client: ctx.model.client, model: ctx.model.model, provider: ctx.model.provider, prompt: ctx.text, notes, rules, assets: assetLines, duration: target, plan, skeleton, angle: script.angle, words: Math.max(8, Math.round(target * measuredWpm / 60)), resize: { previous: script.narration, measured_seconds: take.duration, measured_words: take.words.length } });
    addCost(report, "script-resize", ctx.model, resized);
    script = { ...resized, passes: [...(script.passes ?? []), { kind: "resize", words: resized.word_count, measured_seconds: take.duration, cost_usd: resized.cost_usd }] };
    take = await synthesize(ctx, script.narration);
  }
  script.take = { seconds: take.duration, words: take.words.length, wpm: Math.round(take.words.length / Math.max(0.1, take.duration) * 60), cached: Boolean(take.cached) };
  // A take that runs short is not padded (the length is a ceiling): the script is checked at the length it runs.
  const short = runsShort(take.duration, target);
  if (short) script.take.short_of_target_seconds = round1(target - take.duration);
  // The final narration's check is the receipt; errors left after the repair pass warn, they do not stop the render.
  script.check = checkScript({ narration: script.narration, duration: short ? Math.max(1, Math.round(take.duration)) : target, brief: { prompt: ctx.text, notes, assets: assetLines }, ...planChecks });
  auditNarration(ctx, research, script.narration);
  if (!script.check.ok) report.warnings.push(`the script still fails ${script.check.errors.length} script check(s): ${script.check.errors.map((error) => `${error.id}: ${error.message}`).join("; ")} (launchclip script check ${MAKE_PATHS.script})`);
  await writeJson(path.join(project, MAKE_PATHS.script), script);
  // The angle the script is written on (a short video's script pass finds it): the agent path's ANGLE.json.
  if (script.angle) await writeJson(path.join(project, MAKE_PATHS.angle), { schema_version: "launchclip.angle.v1", ...script.angle, source: "script pass" });
  state.script = { hash: scriptHash };
  ctx.script = script;
  ctx.words = take.words;
  ctx.narrationText = script.narration;
  ctx.format = { ...routing.format, duration: round1(take.duration + 0.8) };
  if (short) report.notices.push(`the script had ${take.duration}s to say, so the video is ${ctx.format.duration}s (the ${target}s target is a ceiling; nothing is padded to reach it)`);
  else if (Math.abs(ctx.format.duration - target) > 0.5) report.warnings.push(`the narration runs ${take.duration}s, so the video is ${ctx.format.duration}s (target ${target}s)`);
  ctx.audio = { words: MAKE_PATHS.words };
  ctx.narration = { text: script.narration, ...narrationVoice(ctx) };
  report.script = { source: "model", file: MAKE_PATHS.script, title: script.title, words: script.word_count, target_words: plan.word_target, plan: script.plan ?? null, passes: script.passes?.length ?? 1, reused: Boolean(reuse), take: script.take, check: { ok: script.check.ok, errors: script.check.errors.map((error) => error.id), warnings: script.check.warnings.map((warning) => warning.id) }, ...(script.angle ? { angle: { file: MAKE_PATHS.angle, chosen: script.angle.angles[script.angle.chosen]?.angle ?? null } } : {}), ...(script.title_scores ? { titles: script.title_scores.map((entry) => ({ title: entry.title, score: entry.score })) } : {}) };
  if (options.duration == null && routing.duration_source === "default") report.warnings.push("no --duration and none named in the prompt; sized for 30 s");
  return { status: "done" };
}

// Animation (docs/ANIMATION_PIPELINE_RFC.md §4.1, §6.1): the writers' room
// (src/make/animation.js: premise and loglines, a judge, the script) writes
// SCRIPT.json version 2, a script with speakers and silent lines; the script
// checks run on it, and its spoken lines are voiced as a dialogue, one voice a
// speaker. One repair pass in all: on the first check's errors, else on the
// check against the measured take (its errors, or a take over 15% short).
// The characters speak in the voices of the project's frozen show bible when
// it has one, else in stand-in voices the bible stage then keeps.
async function prepareAnimation(ctx) {
  const { project, routing, report, state, options, voiceProvider } = ctx;
  const target = routing.format.duration;
  const notes = await notesText(ctx);
  const rules = rulesText(ctx);
  const assetLines = assetManifestLines(ctx).map((item) => item.line);
  if (researchMode(options.research) === "on") report.warnings.push("--research is not used by --animation: the writers' room writes from the brief and the notes only");
  const skeleton = chooseMakeSkeleton(ctx, target);
  // Where the problem must land: the character-story profile's limit (--profile names another).
  const { profile } = resolveProfile(options.profile ?? ANIMATION_PROFILE, { projectDir: project });
  const problemLandsSeconds = profile?.measures?.problem_lands_seconds?.p90 ?? null;
  const room = { client: ctx.model.client, model: ctx.model.model, provider: ctx.model.provider, prompt: ctx.text, notes, rules, assets: assetLines, duration: target, wpm: estimatedPace(voiceProvider, narrationRequest(narrationVoice(ctx)).speed), skeleton, structure: skeleton ? skeletonPlanLines(skeleton) : null, problemLandsSeconds, say: ctx.say };
  const spend = (calls) => { for (const call of calls) addCost(report, call.stage, ctx.model, call); };
  const scriptHash = hashValue({ kind: "animation", prompt: ctx.text, notes, assets: assetLines, target, model: ctx.model.spec, voice: voiceProvider, pace: room.wpm, ...(options.voiceId ? { voice_id: String(options.voiceId) } : {}), skeleton: [skeleton?.id ?? null, skeleton?.version ?? null], profile: [profile?.id ?? null, problemLandsSeconds], ...(rules ? { rules } : {}), v: 1 });
  let script = await readJson(path.join(project, MAKE_PATHS.script));
  const reuse = Boolean(script && state.script?.hash === scriptHash && script.schema_version === SCREENPLAY_VERSION && script.narration);
  let repairs = 1;
  if (!reuse) {
    const first = await writersRoom(room);
    spend(first.calls);
    script = first.script;
    if (!first.check.ok) {
      repairs -= 1;
      const repaired = await repairScreenplay({ ...room, script, errors: first.check.errors });
      spend(repaired.calls);
      script = repaired.script;
    }
  }
  if (voiceProvider === "elevenlabs") ctx.say("voice: PAID ElevenLabs text-to-speech for each line (cached per line in .launchclip/voice)");
  let voiced = await voiceScreenplay(ctx, script, await bibleVoices(ctx, script));
  const brief = { prompt: ctx.text, notes, assets: assetLines };
  const measuredCheck = () => checkAnimationScript(script, { duration: target, wpm: voiced.wpm, problemLandsSeconds, brief });
  if (!reuse && repairs > 0) {
    // The estimate passed; now the real take is measured. A script that fails at the voice's pace, or runs well short, gets the repair.
    const check = measuredCheck();
    const problems = [...check.errors, ...check.warnings.filter((warning) => warning.id === "under-length")];
    if (problems.length) {
      const repaired = await repairScreenplay({ ...room, script, errors: problems, measured: { seconds: voiced.take.duration, wpm: voiced.wpm } });
      spend(repaired.calls);
      script = repaired.script;
      voiced = await voiceScreenplay(ctx, script, await bibleVoices(ctx, script));
    }
  }
  const { take, derived } = voiced;
  // A rerun that reused the script and its take leaves SCRIPT.json as it is, receipt included.
  const unchanged = reuse && voiced.reused && script.take && script.check;
  if (!unchanged) {
    script.take = { seconds: take.duration, words: take.words.length, wpm: voiced.wpm, lines: take.lines.length, cached: Boolean(take.cached) };
    // The final script's check, at the measured pace, is the receipt; errors left after the repair pass warn, they do not stop the run.
    script.check = measuredCheck();
    await writeJson(path.join(project, MAKE_PATHS.script), script);
  }
  if (!script.check.ok) report.warnings.push(`the script still fails ${script.check.errors.length} script check(s): ${script.check.errors.map((error) => `${error.id}: ${error.message}`).join("; ")} (launchclip script check ${MAKE_PATHS.script})`);
  state.script = { hash: scriptHash };
  ctx.script = script;
  ctx.words = take.words;
  ctx.narrationText = script.narration;
  // Silent lines before the first spoken line and after the last are held by the picture, so they add to the length.
  ctx.format = { ...routing.format, duration: round1(derived.lead_seconds + take.duration + derived.tail_seconds + 0.8) };
  if (Math.abs(ctx.format.duration - target) > 0.5) report.warnings.push(`the dialogue runs ${take.duration}s, so the video is ${ctx.format.duration}s (target ${target}s)`);
  ctx.audio = { words: MAKE_PATHS.words };
  ctx.narration = voiced.narration;
  ctx.cast = voiced.cast;
  const stats = script.check.stats.screenplay ?? {};
  report.script = { source: "model", kind: "animation", file: MAKE_PATHS.script, version: SCREENPLAY_VERSION, title: script.title, logline: script.logline, characters: script.characters.map((character) => character.id), speakers: stats.speakers ?? [], lines: { spoken: stats.spoken_lines ?? 0, silent: stats.silent_lines ?? 0 }, words: script.word_count, target_words: script.word_target, plan: { format: "story", skeleton: skeleton?.id ?? null }, passes: script.passes?.length ?? 0, reused: reuse, take: script.take, voices: voiced.voices, voice_reused: voiced.reused, check: { ok: script.check.ok, errors: script.check.errors.map((error) => error.id), warnings: script.check.warnings.map((warning) => warning.id) } };
  const characterVoices = Object.entries(voiced.voices).filter(([speaker]) => speaker !== NARRATOR).map(([, voice]) => voice);
  if (characterVoices.length && characterVoices.every((voice) => voice === (voiced.voices[NARRATOR] ?? narrationRequest(narrationVoice(ctx)).voice ?? null))) report.warnings.push(`every character speaks in the narrator's voice: the ${voiceProvider} voice has no voices to hand out. Give each character its own with launchclip cast edit <id> --voice <voice id> --project ${project}, then launchclip bible freeze ${project} --characters ${script.characters.map((character) => character.id).join(",")} --force`);
  if (options.duration == null && routing.duration_source === "default") report.warnings.push("no --duration and none named in the prompt; sized for 30 s");
  return unchanged ? { status: "cached", reason: "script and voice inputs unchanged" } : { status: "done" };
}

// A screenplay's spoken lines voiced as a dialogue (src/voice/dialogue.js): one
// take a line, each in its speaker's voice, joined with the silent lines as
// pauses, and NARRATION.json with a speaker on every word. The characters
// borrow stand-in voices until the show bible is frozen (it keeps them, so the
// take stands). The joined take is reused while every line's request and
// every pause is unchanged.
async function voiceScreenplay(ctx, script, pinned = null) {
  const { project, adapters, state, voiceProvider } = ctx;
  const derived = screenplayNarration(script);
  const voice = narrationVoice(ctx);
  const narratorVoice = narrationRequest(voice).voice;
  // pinned: the show bible's [{id, voice}], once there is one.
  const cast = pinned ?? standInCast(script.characters, { provider: voiceProvider, narratorVoice });
  const narration = { ...voice, lines: derived.lines };
  // A script the repair pass could not fix may still name a speaker who is not a character: the narrator's voice reads those lines, so the take can be heard.
  const strangers = [...new Set(derived.lines.map((line) => line.speaker))].filter((speaker) => speaker !== NARRATOR && !cast.some((member) => member.id === speaker));
  const story = { cast: { characters: [...cast, ...strangers.map((id) => ({ id, voice: null }))] }, audio: { narration } };
  const entries = dialogueRequests(story);
  const gaps = dialogueGaps(story);
  const hash = hashValue({ entries, gaps, v: 1 });
  const doc = path.join(project, MAKE_PATHS.words);
  const file = path.join(project, MAKE_PATHS.take);
  const previous = await readJson(doc);
  const reused = Boolean(state.dialogue?.hash === hash && previous?.words?.length && previous?.lines?.length && existsSync(file));
  let take;
  if (reused) take = { words: previous.words, duration: previous.duration_seconds, lines: previous.lines, gaps: previous.gaps, cached: true };
  else {
    take = await (adapters.synthesizeDialogue ?? synthesizeDialogue)(entries, {
      outFile: file,
      cacheDir: voiceCacheDir(project),
      voiceProvider: adapters.voiceProvider ?? ((name, providerOptions) => getVoiceProvider(name, providerOptions)),
      normalizeVoice: adapters.normalizeVoice ?? (async (input, output) => (await import("../voice/supplied.js")).normalizeLoudness(input, output)),
      gap: gaps
    });
    await writeJson(doc, dialogueDocument(story, entries, take));
    state.dialogue = { hash };
  }
  // The pace of the speech itself: the words over the lines' own lengths, pauses left out.
  const spoken = take.lines.reduce((sum, line) => sum + Math.max(0, line.end - line.start), 0);
  const wpm = Math.round(take.words.length / Math.max(0.1, spoken) * 60);
  const voices = Object.fromEntries(entries.map((entry) => [entry.speaker, entry.request.voice ?? null]));
  return { take, derived, narration, cast, voices, wpm, reused };
}

// The voices a frozen show bible gives the script's characters, [{id, voice}],
// or null when the project has no frozen bible that covers them all.
async function bibleVoices(ctx, script) {
  const bible = await readJson(path.join(ctx.project, BIBLE_FILE));
  if (bible?.frozen !== true) return null;
  const entries = bibleCast(bible)?.characters ?? [];
  const cast = (script.characters ?? []).map((character) => entries.find((entry) => entry?.id === character.id)).map((entry) => (entry?.voice ? { id: entry.id, voice: entry.voice } : null));
  return cast.length && cast.every(Boolean) ? cast : null;
}

// The show bible (docs/ANIMATION_PIPELINE_RFC.md §4.2, §6.1, §6.3; the
// animation path only): who is in the story and where it happens, frozen
// before any shot is planned. One structured call designs the cast and the
// world (src/make/show_bible.js), each character goes through the door `cast
// create` uses, and `bible freeze` draws the sheets and writes BIBLE.json.
//
// A frozen bible already in the project is used as it is: make's own while
// the script's characters and the brief are unchanged, and one somebody else
// froze (launchclip bible freeze) always, so a cast you designed or edited is
// never redesigned. --replan plans new shots; it does not design a new cast.
//
// The stage is one of the two places to stop (§6.3): --stop-after bible ends
// the run `awaiting-approval`, an attended run asks, and --approve bible (or a
// yes) records the approval of this bible, so the run goes on.
async function stageBible(ctx) {
  if (!isAnimation(ctx.routing)) return { status: "skipped", reason: "not a character story (--animation)" };
  const { project, report, state, options, adapters, script } = ctx;
  const ids = script.characters.map((character) => character.id);
  const strangers = [...new Set(script.beats.flatMap((beat) => beat.lines).map((line) => line.speaker).filter((speaker) => speaker && speaker !== NARRATOR && !ids.includes(speaker)))];
  if (strangers.length) throw new Error(`the script gives lines to ${strangers.map((id) => `"${id}"`).join(", ")}, who ${strangers.length === 1 ? "is" : "are"} not in its characters (${ids.join(", ")}); a cast cannot be designed from it. Fix ${MAKE_PATHS.script} (launchclip script check ${project}) or run again for a new script`);
  const style = await projectStyle(ctx);
  // A chosen style pack's drawing style is the cast's; a seeded style's is not a choice anyone made.
  const packStyle = !ctx.generatedStyle && style?.pack?.cast?.drawing_style ? style.pack.cast.drawing_style : null;
  const narratorVoice = narrationRequest(narrationVoice(ctx)).voice ?? null;
  // The voices the script was voiced in under Kokoro: the bible keeps them, so the take stands.
  const voices = new Map(standInCast(script.characters, { provider: "kokoro", narratorVoice }).map((member) => [member.id, member.voice]));
  const notes = await notesText(ctx);
  const rules = rulesText(ctx);
  const inputs = hashValue({ characters: script.characters, places: script.beats.map((beat) => beat.place ?? null), prompt: ctx.text, notes, model: ctx.model.spec, narrator: narratorVoice, style: packStyle, ...(rules ? { rules } : {}), v: 1 });
  const hooks = { ...(adapters.renderSheet ? { render: adapters.renderSheet } : {}), ...(adapters.home ? { home: adapters.home } : {}) };
  const found = await readBible(project, hooks);
  const frozen = found?.bible?.frozen === true;
  const mine = frozen && state.bible?.hash === found.bible.hash && !state.bible.adopted;
  let source = null;
  let designed = state.bible?.characters ?? null;
  if (frozen && found.check.ok && (!mine || state.bible.inputs === inputs)) {
    source = mine ? "reused" : "project";
    if (!mine && state.bible?.hash !== found.bible.hash) {
      ctx.say(`bible: using the frozen ${BIBLE_FILE} in the project (${found.bible.hash.slice(7, 19)}); make designs a cast only when there is none`);
      state.bible = { hash: found.bible.hash, adopted: true };
      designed = null;
    }
  } else if (frozen && !mine) {
    throw new Error(`${BIBLE_FILE} is frozen but is not valid for this project:\n- ${found.check.errors.slice(0, 8).join("\n- ")}\nFreeze it again for the script's characters (launchclip bible freeze ${project} --characters ${ids.join(",")} --force), or delete it and make designs the cast`);
  } else {
    const own = state.bible?.designed ?? [];
    ctx.say(`model: PAID call to ${ctx.model.provider} ${ctx.model.model} (show bible: the cast of ${ids.length} and the world)`);
    const call = await designBible({ client: ctx.model.client, provider: ctx.model.provider, model: ctx.model.model, prompt: ctx.text, notes, rules, script, saved: (await savedForDesign(project, hooks)).filter((entry) => !own.includes(entry.id)), styleFixed: packStyle });
    addCost(report, "bible", ctx.model, call);
    const drawing = packStyle ?? call.design.drawing_style ?? DEFAULT_DRAWING_STYLE;
    const made = await makeBible({ project, script, design: call.design, style: drawing, voices, narratorVoice, own, pack: style?.name ?? null, seed: ctx.generatedStyle?.generated?.seed ?? null, chromium: ctx.env.LAUNCHCLIP_CHROMIUM ?? null }, hooks);
    for (const member of made.characters) if (member.rejected?.length) report.warnings.push(`bible: the rig has no ${member.rejected.map((set) => `${set.path}=${set.value}`).join(", ")} for ${member.id}; left out`);
    for (const warning of made.bible.warnings ?? []) report.warnings.push(`bible: ${warning}`);
    designed = made.characters.map(({ rejected: _rejected, ...member }) => member);
    state.bible = { hash: made.bible.hash, inputs, designed: made.characters.filter((member) => member.source !== "saved" && member.file).map((member) => member.id), characters: designed };
    source = "designed";
  }
  const bible = source === "designed" ? (await readBible(project, hooks)).bible : found.bible;
  ctx.bible = bible;
  const cast = bibleCast(bible).characters;
  // The take in the bible's voices: reused when the script was voiced in them (the usual case), else voiced again line by line from the cache.
  const voiced = await voiceScreenplay(ctx, script, cast.map((entry) => ({ id: entry.id, voice: entry.voice ?? null })));
  if (!voiced.reused) {
    ctx.say("bible: the cast's voices differ from the take; the dialogue was voiced again in them");
    script.take = { seconds: voiced.take.duration, words: voiced.take.words.length, wpm: voiced.wpm, lines: voiced.take.lines.length, cached: Boolean(voiced.take.cached) };
    await writeJson(path.join(project, MAKE_PATHS.script), script);
    ctx.words = voiced.take.words;
    ctx.format = { ...ctx.routing.format, duration: round1(voiced.derived.lead_seconds + voiced.take.duration + voiced.derived.tail_seconds + 0.8) };
    if (report.script) report.script = { ...report.script, take: script.take, voices: voiced.voices };
  }
  ctx.narration = voiced.narration;
  ctx.cast = voiced.cast;
  const sheets = path.join(project, BIBLE_SHEETS);
  const approve = approvals(options.approve).includes("bible");
  if (approve) state.bible.approved = bible.hash;
  let approved = state.bible.approved === bible.hash;
  report.bible = {
    file: BIBLE_FILE, hash: bible.hash, source, style: bible.cast.style, sheets: BIBLE_SHEETS,
    characters: bible.cast.characters.map((entry) => ({ id: entry.id, name: entry.name ?? entry.id, voice: entry.voice ?? null, position: entry.position ?? null, sheet: entry.sheet ?? null, ...(entry.character_file ? { character_file: entry.character_file } : {}), must_keep: entry.must_keep ?? [], ...(designed?.find((member) => member.id === entry.id) ? { designed: designed.find((member) => member.id === entry.id) } : {}) })),
    ...(bible.world ? { world: bible.world } : {}),
    ...(bible.rules?.length ? { rules: bible.rules } : {}),
    approved
  };
  ctx.say(`bible: ${bible.cast.characters.map((entry) => `${entry.name ?? entry.id} (${(entry.must_keep ?? []).slice(0, 3).join(", ")})`).join("; ")}; drawn ${bible.cast.style}${bible.world?.kind ? `, in ${bible.world.kind}` : ""}; sheets in ${sheets}`);
  if (!approved) {
    let stop = String(options.stopAfter ?? "").toLowerCase() === "bible";
    // An attended run asks (a terminal, or the app's own question); a headless run goes on unless --stop-after bible.
    const attended = Boolean(adapters.ask) || Boolean(process.stdin.isTTY && process.stderr.isTTY);
    if (!stop && attended) {
      if (await (adapters.ask ?? askYesNo)(`bible: look at the reference sheets in ${sheets}. Plan the shots with this cast?`)) { state.bible.approved = bible.hash; approved = true; report.bible.approved = true; }
      else stop = true;
    }
    if (stop) {
      const again = `launchclip make ${JSON.stringify(ctx.text)} --animation --out ${project} --approve bible`;
      ctx.stop = {
        after: "bible",
        status: "awaiting-approval",
        reason: "stopped for approval of the show bible (--stop-after bible)",
        next: [`Look at the reference sheets in ${sheets} (launchclip bible show ${project}). To go on with this cast, run the same command with --approve bible (${again}): the script, the voice and the bible are reused. To change a character first: launchclip cast edit <id> --instruction "…" --project ${project}, then launchclip bible freeze ${project} --characters ${ids.join(",")} --force.`]
      };
    }
  }
  return source === "designed" ? { status: "done" } : { status: "cached", reason: source === "project" ? `the frozen ${BIBLE_FILE} in the project` : "the script's characters and the brief are unchanged" };
}

// Long form (docs/LONG_FORM_MAKE_RFC.md, src/make/long_form.js): an outline,
// then each chapter written and voiced in order. The first chapter's take sets
// the pace every later chapter is written to. Each chapter's seconds are a
// ceiling: a chapter far over them gets one resize pass, and one that comes
// in short is kept short, its unused seconds going to the later chapters
// with the most facts. Every chapter is cached by its inputs, so a rerun
// rewrites and revoices only from the first chapter that changed.
async function prepareLongForm(ctx) {
  const { project, routing, report, state, options, voiceProvider } = ctx;
  const target = routing.format.duration;
  const briefNotes = await notesText(ctx);
  const research = await researchBrief(ctx, briefNotes);
  if (research) startCaptures(ctx);
  const notes = research ? [...briefNotes, research.notes] : briefNotes;
  const rules = rulesText(ctx);
  const assets = assetManifestLines(ctx).map((item) => item.line);
  const writer = { client: ctx.model.client, model: ctx.model.model, provider: ctx.model.provider, prompt: ctx.text, notes, rules, assets };
  const voice = narrationVoice(ctx);
  const saved = (await readJson(path.join(project, MAKE_PATHS.script)))?.long_form ?? null;
  // Concept and story first: a long video's story is a spine of at most three minutes, and the outline is derived from it.
  const conceptStory = await stageConceptStory(ctx, { notes, rules, assets, duration: storySeconds(target, { longForm: true }), wpm: WORDS_PER_MINUTE });
  const outlineHash = hashValue({ prompt: ctx.text, notes, assets, target, model: ctx.model.spec, ...(rules ? { rules } : {}), ...(conceptStory ? { story: hashValue(conceptStory.story.narration) } : {}), v: 1 });
  let outline = saved?.outline_hash === outlineHash ? saved.outline : null;
  const passes = [];
  if (!outline) {
    ctx.say(`model: PAID call to ${ctx.model.provider} ${ctx.model.model} (long-form outline, ${target}s)`);
    const written = await writeOutline({ ...writer, duration: target, ...(conceptStory ? { story: conceptStory } : {}) });
    addCost(report, "outline", ctx.model, written);
    outline = { title: written.title, title_options: written.title_options, chapters: written.chapters };
    passes.push({ kind: "outline", chapters: outline.chapters.length, cost_usd: written.cost_usd });
  }
  ctx.say(`long form: ${outline.chapters.length} chapters, ${outline.chapters.map((chapter) => `${chapter.title} (${chapter.seconds}s)`).join(", ")}`);
  const previous = new Map((saved?.outline_hash === outlineHash ? saved.chapters ?? [] : []).map((chapter) => [chapter.key, chapter]));
  const chapters = [];
  const takes = [];
  let wpm = null;
  let tail = null;
  // Each chapter's seconds: the outline's, plus what earlier chapters did not use.
  const slots = outline.chapters.map((chapter) => chapter.seconds);
  await mkdir(path.join(project, MAKE_PATHS.chapterTakes), { recursive: true });
  for (const [index, plan] of outline.chapters.entries()) {
    const id = chapterId(plan.title, index);
    const seconds = slots[index];
    const words = chapterWords(seconds, wpm);
    const key = hashValue({ outline: outlineHash, index, tail, words, voice });
    let chapter = previous.get(key) ?? null;
    ctx.progress?.({ stage: "prepare", step: "chapter", done: index, total: outline.chapters.length });
    if (!chapter) {
      ctx.say(`model: PAID call to ${ctx.model.provider} ${ctx.model.model} (chapter ${index + 1}/${outline.chapters.length}, about ${words} words)`);
      const written = await writeChapter({ ...writer, outline, index, previous: tail, words, seconds });
      addCost(report, `chapter-${index + 1}`, ctx.model, written);
      chapter = { id, title: plan.title, key, seconds, narration: written.narration, word_target: words, passes: [{ kind: "write", words: written.word_count, cost_usd: written.cost_usd }] };
    }
    ctx.say(`voice: chapter ${index + 1}/${outline.chapters.length} (${voiceProvider})`);
    let take = await synthesizeChapter(ctx, chapter.narration, index, voice);
    if (!previous.has(key) && chapterNeedsResize(take.duration, seconds)) {
      const pace = take.words.length / Math.max(1, take.duration) * 60;
      const resizedWords = chapterWords(seconds, pace);
      ctx.say(`script: chapter ${index + 1} runs ${take.duration}s, over its ${seconds}s; one resize pass (PAID call to ${ctx.model.provider} ${ctx.model.model})`);
      const resized = await writeChapter({ ...writer, outline, index, previous: tail, words: resizedWords, seconds, resize: { previous: chapter.narration, measured_words: take.words.length, measured_seconds: take.duration } });
      addCost(report, `chapter-${index + 1}-resize`, ctx.model, resized);
      chapter = { ...chapter, narration: resized.narration, word_target: resizedWords, passes: [...chapter.passes, { kind: "resize", words: resized.word_count, measured_seconds: take.duration, cost_usd: resized.cost_usd }] };
      take = await synthesizeChapter(ctx, chapter.narration, index, voice);
    }
    // A chapter that came in short keeps its length; the later chapters with the most facts may use its spare seconds.
    const handed = shareSpare(slots, outline.chapters, index, seconds - take.duration);
    if (handed) ctx.say(`long form: chapter ${index + 1} ran ${round1(seconds - take.duration)}s short; ${handed}s go to later chapters with more material`);
    // The first take's pace sizes every chapter after it.
    if (index === 0) wpm = take.words.length / Math.max(1, take.duration) * 60;
    chapter = { ...chapter, id, take: { seconds: take.duration, words: take.words.length, cached: Boolean(take.cached) } };
    chapters.push(chapter);
    takes.push({ id, title: plan.title, duration: take.duration, words: take.words, file: take.file });
    tail = narrationTail(chapter.narration);
  }
  const joined = joinTakes(takes);
  await (ctx.adapters.joinVoice ?? joinVoice)(takes.map((take) => take.file), path.join(project, LONG_FORM_VOICE));
  const narration = chapters.map((chapter) => chapter.narration).join(" ");
  await writeJson(path.join(project, MAKE_PATHS.words), { schema_version: "launchclip.narration.v1", ...voice, text: narration, duration_seconds: joined.duration, words: joined.words, chapters: joined.chapters });
  const script = {
    schema_version: SCRIPT_VERSION,
    title: outline.title,
    title_options: outline.title_options,
    narration,
    word_count: wordCount(narration),
    long_form: { version: LONG_FORM_VERSION, outline_hash: outlineHash, outline, chapters, pace_wpm: Math.round(wpm ?? 0) },
    passes,
    take: { seconds: joined.duration, words: joined.words.length, wpm: Math.round(joined.words.length / Math.max(0.1, joined.duration) * 60) }
  };
  await writeJson(path.join(project, MAKE_PATHS.script), script);
  await writeFile(path.join(project, MAKE_PATHS.scriptMarkdown), scriptMarkdown(outline.title, chapters));
  auditNarration(ctx, research, narration);
  ctx.script = script;
  ctx.words = joined.words;
  ctx.narrationText = narration;
  ctx.format = { ...routing.format, duration: round1(joined.duration + 0.8) };
  if ((target - ctx.format.duration) / target > 0.1) report.notices.push(`the chapters had ${joined.duration}s to say, so the video is ${ctx.format.duration}s (the ${target}s target is a ceiling; nothing is padded to reach it)`);
  else if ((ctx.format.duration - target) / target > 0.1) report.warnings.push(`the narration runs ${joined.duration}s, so the video is ${ctx.format.duration}s (target ${target}s)`);
  // The joined take is the voice: finish mounts it as supplied audio rather than synthesising the whole text again.
  ctx.audio = { words: MAKE_PATHS.words, voice: LONG_FORM_VOICE };
  ctx.narration = null;
  ctx.longForm = { chapters: joined.chapters, notes: conceptStory ? [...notes, ["The concept the video is built on (the visuals follow it):", ...conceptLookLines(conceptStory)].join("\n")] : notes, assets: assetManifestLines(ctx).map((item) => ({ src: item.src, line: item.line })) };
  report.script = { source: "model", file: MAKE_PATHS.script, title: script.title, words: script.word_count, long_form: { chapters: chapters.map((chapter) => ({ id: chapter.id, title: chapter.title, target_seconds: chapter.seconds, seconds: chapter.take.seconds, words: wordCount(chapter.narration), passes: chapter.passes.length, reused: previous.has(chapter.key) })), pace_wpm: script.long_form.pace_wpm }, take: script.take };
  return { status: "done" };
}

// Concept and story before the script (src/make/concept_story.js): reused
// while its inputs hash the same, skipped with --concepts off, and never
// fatal: a stage that fails is a warning and the script is written from the
// brief. → {tournament, concept, story} or null.
async function stageConceptStory(ctx, { notes, rules, assets, duration, wpm }) {
  const { project, report, state, options } = ctx;
  ctx.conceptStory = null;
  if (conceptsMode(options.concepts) === "off") { report.concept = { status: "off", reason: "--concepts off" }; return null; }
  const format = { width: ctx.routing.format.width, height: ctx.routing.format.height };
  const hash = hashValue({ prompt: ctx.text, notes, rules, assets, duration, wpm, format, model: ctx.model.spec, v: 1 });
  let result = state.concept?.hash === hash ? await readConceptStory(project) : null;
  const reused = Boolean(result);
  if (!result) {
    try {
      result = await (ctx.adapters.conceptStory ?? planConceptStory)({ project, client: ctx.model.client, model: { provider: ctx.model.provider, model: ctx.model.model, reasoning: ctx.model.reasoning }, prompt: ctx.text, notes, rules, assets, format, duration, wpm, say: ctx.say });
    } catch (error) {
      for (const call of error?.calls ?? []) addCost(report, call.stage, ctx.model, call);
      const reason = String(error?.message ?? error).split("\n")[0];
      report.concept = { status: "failed", reason };
      report.warnings.push(`the concept and story stage failed (${reason}); the script is written from the brief in one pass`);
      delete state.concept;
      return null;
    }
    for (const call of result.calls ?? []) addCost(report, call.stage, ctx.model, call);
    state.concept = { hash };
  }
  report.concept = { status: reused ? "reused" : "done", ...(await conceptSummary(project, result)) };
  ctx.say(`concept: "${result.concept.title}" won of ${report.concept.candidates}; the story has ${report.concept.story_beats} beats${reused ? " (reused)" : ""}`);
  ctx.conceptStory = result;
  return result;
}

async function synthesizeChapter(ctx, text, index, voice) {
  const request = narrationRequest({ text, ...voice });
  const file = path.join(ctx.project, MAKE_PATHS.chapterTakes, `${String(index + 1).padStart(2, "0")}.wav`);
  const take = await synthesizeNarration(request, {
    outFile: file,
    cacheDir: voiceCacheDir(ctx.project),
    voiceProvider: ctx.adapters.voiceProvider ?? ((name, providerOptions) => getVoiceProvider(name, providerOptions)),
    normalizeVoice: ctx.adapters.normalizeVoice ?? (async (input, output) => (await import("../voice/supplied.js")).normalizeLoudness(input, output))
  });
  return { ...take, file };
}

// The long-form plan: the beat director (kit/core/beat-director.mjs) cuts the
// narration into clauses and shots, plans the camera and checks the whole map
// against the long-form cadence, with a rule-made card per clause; the model
// then directs every clause's card (--long-form-visuals rules keeps the rule
// cards and only rewrites their words); beatMapToStory turns the map into the
// storyboard on the world camera.
async function stageLongFormStoryboard(ctx) {
  const { project, report, state, options } = ctx;
  const style = await loadStyle(ctx);
  const brand = await loadBrand(ctx);
  const storyFile = path.join(project, MAKE_PATHS.story);
  const { width, height, fps } = ctx.format;
  const visuals = longFormVisuals(options);
  // Research's ledger and the pages recorded from it: the beat director matches clauses to them (evidence first).
  const ledger = ctx.captures?.length || researchEnabled(ctx) ? await readLedger(project) : null;
  const captures = (ctx.captures ?? []).map(({ request, files }) => ({ ...request, out: files.clip }));
  const planHash = hashValue({ words: hashValue(ctx.words), chapters: ctx.longForm.chapters, format: ctx.format, brand, style: style?.name ?? null, title: ctx.script.title, v: 1, ...(visuals === "model" ? { visuals, model: ctx.model.spec } : {}), ...(ledger ? { ledger: hashValue(ledger.claims ?? []), captures: captures.map((entry) => entry.id) } : {}) });
  // A critic repair round (criticRepairs) directs chunks again from the last cut's beat map, so it never takes the cached plan.
  const round = ctx.criticRound ?? null;
  if (!round && !options.replan && state.plan?.hash === planHash && existsSync(storyFile)) return { status: "cached", reason: "plan inputs unchanged (pass --replan for a new storyboard)" };
  const previous = options.replan && !round ? null : await readJson(path.join(project, MAKE_PATHS.beatMap));
  const map = directLongForm({ words: ctx.words, chapters: ctx.longForm.chapters, title: ctx.script.title, format: { width, height }, ...(ledger ? { ledger, captures } : {}) }, { ...(brand ? { brand } : {}), ...(previous ? { previous } : {}) });
  ctx.say(beatMapReportText(map).split("\n")[0]);
  // The direct pass (docs/MAKE_SKILL_PARITY.md): the model picks every clause's card, as the skill's director does; chunks directed before (same key) are kept.
  let direct = null;
  if (visuals === "model") {
    const directed = new Set((previous?.chunks ?? []).filter((chunk) => chunk.directed).map((chunk) => chunk.key));
    // The round's chunks (the ones its findings name; every chunk on a replan) are directed again, with the findings.
    const review = round ? criticChunks(map, round) : null;
    if (round && !review.size) throw new Error("the critic's findings name no scene the model directed");
    for (const chunk of map.chunks) if (review?.has(chunk.id)) directed.delete(chunk.key);
    direct = await directLongFormVisuals({ client: ctx.model.client, model: ctx.model.model, provider: ctx.model.provider, map, notes: ctx.longForm.notes, assets: ctx.longForm.assets ?? [], format: { width, height }, brand, done: directed, say: ctx.say, ...(review ? { review } : {}) });
    for (const chunk of direct.chunks) if (!chunk.reused && chunk.usage) addCost(report, `${round ? `critic-${round.round}-` : ""}direct-${chunk.id}`, ctx.model, chunk);
    for (const chunk of direct.chunks) if (chunk.failed) report.warnings.push(`visual direction for chunk ${chunk.id} failed (${chunk.failed}); it keeps the rule-made cards`);
  }
  // The copy pass: the model rewrites the on-screen words of chunks it did not direct; chunks rewritten before (same key) are kept.
  const done = new Set([...(previous?.chunks ?? []).filter((chunk) => chunk.copy).map((chunk) => chunk.key), ...map.chunks.filter((chunk) => chunk.directed).map((chunk) => chunk.key)]);
  const copy = await rewriteLongFormCopy({ client: ctx.model.client, model: ctx.model.model, provider: ctx.model.provider, map, notes: ctx.longForm.notes, format: { width, height }, brand, done, say: ctx.say });
  for (const chunk of copy.chunks) if (!chunk.reused && chunk.usage) addCost(report, `copy-${chunk.id}`, ctx.model, chunk);
  const build = () => {
    let out = beatMapToStory(map, { title: ctx.script.title, format: ctx.format, fps, ...(brand ? { brand } : {}) });
    out.audio = { ...out.audio, ...ctx.audio };
    if (style) out = applyStyle({ ...out, style: style.name }, style.pack).story;
    return finalizeStory(out, ctx);
  };
  let story = build();
  // A directed card that does not resolve in the styled storyboard gets its rule-made card back, rather than failing the video at finish.
  if (direct) {
    const back = revertCards(map, direct.ruled, unresolvedScenes(story, ctx.words));
    if (back.length) {
      report.warnings.push(`${back.length} directed card${back.length === 1 ? "" : "s"} did not fit the styled storyboard and kept the rule-made card (${back.join(", ")})`);
      story = build();
    }
  }
  await writeJson(storyFile, story);
  await writeJson(path.join(project, MAKE_PATHS.beatMap), map);
  await writeFile(path.join(project, MAKE_PATHS.direction), directionJson(beatMapToDirection(map)));
  const cadence = map.report.cadence;
  if (!cadence.gate.ok) report.warnings.push(`the long-form plan misses its cadence target: ${cadence.gate.checks.filter((check) => !check.ok).map((check) => `${check.id} ${check.value} (want ${check.want})`).join("; ")}`);
  const share = typographyShare(map);
  if (share > 0.3) report.warnings.push(`${Math.round(share * 100)}% of the long-form cards are words on a backdrop (aim for at most 30%)`);
  report.direction = { file: MAKE_PATHS.direction, source: visuals === "model" ? "model on the beat director's clock" : "beat director", beat_map: MAKE_PATHS.beatMap, typography_share: share, ...(direct ? { direct: { chunks: direct.chunks.length, directed: tally(direct.chunks, "directed"), held: tally(direct.chunks, "held"), kept: tally(direct.chunks, "kept"), failed: direct.chunks.filter((chunk) => chunk.failed).length } } : {}), cadence: { per_min: cadence.per_min, ok: cadence.gate.ok }, copy: { chunks: copy.chunks.length, rewritten: copy.chunks.reduce((sum, chunk) => sum + chunk.changed, 0), kept: copy.chunks.reduce((sum, chunk) => sum + chunk.kept, 0) } };
  report.repairs = null;
  state.plan = { hash: planHash, long_form: true };
  return { status: "done" };
}

/**
 * The chunks a long-form critic round directs again: chunk id → the findings
 * to fix there. A repair takes the chunks that hold a scene a finding names
 * (each with its own findings, plus the ones that name no scene); a replan,
 * or findings that name no scene at all, takes every chunk with every finding.
 */
export function criticChunks(map, round) {
  const stateChunk = new Map();
  const byShot = new Map((map.chapters ?? []).flatMap((chapter) => chapter.shots ?? []).map((shot) => [shot.id, shot]));
  for (const chunk of map.chunks ?? []) for (const id of chunk.shots ?? []) for (const state of byShot.get(id)?.states ?? []) stateChunk.set(state.id, chunk.id);
  const findings = round.findings ?? [];
  const lines = round.problems ?? [];
  const out = new Map();
  if (round.mode === "repair") {
    for (const [index, finding] of findings.entries()) for (const scene of finding.scenes ?? []) {
      const chunk = stateChunk.get(scene);
      if (chunk && lines[index]) out.set(chunk, [...(out.get(chunk) ?? []), lines[index]]);
    }
    const loose = lines.filter((line, index) => !(findings[index]?.scenes ?? []).some((scene) => stateChunk.has(scene)));
    for (const [chunk, own] of out) out.set(chunk, [...new Set([...own, ...loose])]);
  }
  if (!out.size && lines.length) for (const chunk of map.chunks ?? []) out.set(chunk.id, lines);
  return out;
}

/** --long-form-visuals: "model" (default; the model directs every card) or "rules" (the beat director alone, the model rewrites words). */
export function longFormVisuals(options = {}) {
  const value = String(options.longFormVisuals ?? "model").toLowerCase();
  if (!["model", "rules"].includes(value)) throw new Error(`--long-form-visuals must be model or rules; got ${options.longFormVisuals}`);
  return value;
}

function tally(entries, key) { return entries.reduce((total, entry) => total + (entry[key] ?? 0), 0); }

// The library skeleton for a motion-lane script: --skeleton <id> | auto
// (default) | none, from the library (built-in plus ~/.launchclip/skeletons
// and the project's) for the brief's medium; a script format's own skeleton
// id (--skeleton call-out-pas) is a pin for chooseScriptPlan instead. Records
// the choice in MAKE.json and warns when the skeleton wants a better voice
// than the one in use.
function chooseMakeSkeleton(ctx, target) {
  const { options, report, routing, project, voiceProvider } = ctx;
  const { skeletons, problems } = loadSkeletonLibrary({ project });
  for (const problem of problems) report.warnings.push(`skeleton library: ${problem}`);
  const medium = skeletonMedium(ctx);
  const requested = options.skeleton ?? "auto";
  const choice = chooseSkeleton({ prompt: ctx.text, duration: target, aspect: routing.aspect, medium, requested: SCRIPT_SKELETONS[requested] ? "none" : requested, skeletons });
  if (choice.unknown) throw new Error(`unknown skeleton ${choice.unknown}; run launchclip skeletons list (or use auto or none)`);
  const skeleton = choice.skeleton;
  report.skeleton = { id: skeleton?.id ?? (SCRIPT_SKELETONS[requested] ? requested : null), library: Boolean(skeleton), version: skeleton?.version ?? null, medium, reasons: SCRIPT_SKELETONS[requested] ? [`skeleton ${requested}: --skeleton`] : choice.reasons, ...(choice.blocked.length ? { blocked: choice.blocked } : {}) };
  if (skeleton) {
    ctx.say(`skeleton: ${skeleton.title} (${skeleton.id}); ${choice.reasons[0]}`);
    if (skeleton.voice.tier === "human-or-premium" && voiceProvider !== "elevenlabs") report.warnings.push(`skeleton ${skeleton.id} needs a human or premium read for the final: this draft uses the ${voiceProvider} voice (record the script yourself, or --voice elevenlabs for the final take only)`);
  }
  ctx.skeleton = skeleton;
  return skeleton;
}

// What the video is made of, for matching skeletons: a cast story, a product
// demo or recording, else motion graphics.
function skeletonMedium(ctx) {
  if (isAnimation(ctx.routing) || animationBrief(ctx.text)) return "character";
  if ((ctx.routing?.media ?? []).some((item) => ["screen-recording", "product-demo"].includes(item.role)) || ctx.demo?.length) return "demo";
  return "motion";
}

async function synthesize(ctx, text) {
  const { project, adapters } = ctx;
  const request = narrationRequest({ text, ...narrationVoice(ctx) });
  const take = await synthesizeNarration(request, {
    outFile: path.join(project, MAKE_PATHS.take),
    cacheDir: voiceCacheDir(project),
    voiceProvider: adapters.voiceProvider ?? ((name, providerOptions) => getVoiceProvider(name, providerOptions)),
    normalizeVoice: adapters.normalizeVoice ?? (async (input, output) => (await import("../voice/supplied.js")).normalizeLoudness(input, output))
  });
  await writeJson(path.join(project, MAKE_PATHS.words), narrationDocument(request, take));
  return take;
}

async function stageStoryboard(ctx) {
  await settleCaptures(ctx);
  if (ctx.longForm) return stageLongFormStoryboard(ctx);
  const { project, report, state, options, routing } = ctx;
  const style = await projectStyle(ctx);
  const brand = await loadBrand(ctx);
  const manifest = assetManifestLines(ctx);
  const brief = await composeBrief(ctx, manifest);
  // A character story (--animation): the frozen show bible is pinned in every plan, repair and replan, and the script's line ids are checked.
  const pinned = ctx.bible ? { bible: ctx.bible, script: ctx.script } : null;
  // A critic repair round (criticRepairs): a replan carries the critic's
  // findings in its brief; a repair starts from the current storyboard.
  const round = ctx.criticRound ?? null;
  const planBrief = round?.mode === "replan" ? `${brief.trimEnd()}\n${criticBriefSection(round.problems)}` : brief;
  await writeFile(path.join(project, MAKE_PATHS.brief), planBrief);
  const lane = routing.lane;
  const fixedAudio = { ...ctx.audio };
  const subject = ctx.subject?.probe ?? null;
  // The cadence profile the plan aims at (RFC §5.5): the style's, else the
  // shipped one for the routed lane, aspect, duration and platform.
  const { profile, reason: profileReason } = profileForStory({ lane, format: ctx.format }, { profile: options.profile ?? null, style: style?.pack ?? null, projectDir: project });
  report.profile = profile ? { id: profile.id, reason: profileReason, provenance: profile.provenance.kind } : null;
  const constraints = ctx.constraints ?? null;
  // The presenter's head track (the subject stage's, or the app's faces), so
  // tooling keeps cards off the face; an unreadable one only costs that.
  let subjectTrack = null;
  if (lane === "footage-led" && ctx.base) {
    try { subjectTrack = await readStoryTrack(project, { base: ctx.base.src }); } catch (error) { report.warnings.push(`${TRACK_FILE} not used for placement (${String(error?.message ?? error).split("\n")[0]})`); }
  }
  const hasProvider = Boolean(ctx.adapters.assets || ctx.options.assetProviderCmd);
  const shotLimit = shotRequestLimit(ctx.format?.duration);
  const minShots = hasProvider ? Math.min(Number(options.minShots ?? 0), shotLimit) : 0;
  const cardBackdrops = hasProvider && String(options.cardBackdrops ?? "off").toLowerCase() === "footage" ? "footage" : null;
  // --layout: a talking head's layout for the whole video (footage-led, 9:16 for stacked).
  const layout = talkingHeadLayout(options.layout);
  const laidOut = layout !== "full" && lane === "footage-led" ? layout : null;
  if (layout !== "full" && !laidOut) report.warnings.push(`--layout ${layout} ignored: it lays out a talking head, and this video is ${lane} (no recording with speech is the base)`);
  if (laidOut === "stacked" && !(ctx.format.height > ctx.format.width)) report.warnings.push("--layout stacked ignored: it is for 9:16; this video is not portrait");
  const planHash = hashValue({ brief, lane, format: ctx.format, ...(ctx.skeleton ? { skeleton: ctx.skeleton.id } : {}), brand, audio: fixedAudio, base: ctx.base ?? null, style: style?.name ?? null, words: hashValue(ctx.words), model: ctx.model.spec, v: 2, profile: profile?.id ?? null, ...(options.density != null ? { density: Number(options.density) } : {}), ...(subject ? { subject: { usable: subject.usable, framing: subject.framing } } : {}), ...(hasProvider ? { shots: ctx.options.assetProviderCmd ?? "app" } : {}), ...(minShots ? { min_shots: minShots } : {}), ...(cardBackdrops ? { card_backdrops: cardBackdrops } : {}), ...(laidOut ? { layout: laidOut } : {}), ...(constraints ? { constraints: constraintsDocument(constraints) } : {}), ...(subjectTrack ? { face_track: hashValue(subjectTrack.frames) } : {}), ...(pinned ? { bible: pinned.bible.hash } : {}) });
  // --min-shots: only an asset provider can supply shots; above what a plan of this length may ask for it is clamped.
  if (Number(options.minShots) > 0 && !hasProvider) report.warnings.push(`--min-shots ${options.minShots} ignored: there is no asset provider (--asset-provider-cmd or adapters.assets) to ask for shots`);
  if (String(options.cardBackdrops ?? "off").toLowerCase() === "footage" && !hasProvider) report.warnings.push("--card-backdrops footage ignored: there is no asset provider (--asset-provider-cmd or adapters.assets) to ask for footage");
  if (hasProvider && Number(options.minShots) > shotLimit) report.warnings.push(`--min-shots ${options.minShots} is more than a plan may ask for; using ${shotLimit}`);
  const storyFile = path.join(project, MAKE_PATHS.story);
  const directionFile = path.join(project, MAKE_PATHS.direction);
  // The history is left out of planHash: a rerun keeps its storyboard even
  // after other videos join the history (--replan plans against it afresh).
  const history = await loadHistory(ctx);
  if (!round && !options.replan && state.plan?.hash === planHash && existsSync(storyFile) && (!state.plan.direction || existsSync(directionFile))) {
    report.repairs = state.plan.repairs ?? null;
    if (state.plan.shot_counts) report.shot_counts = state.plan.shot_counts;
    if (history) await lintVariety(ctx, await readJson(storyFile), style, history, state.plan.variety ?? []);
    return { status: "cached", reason: "plan inputs unchanged (pass --replan for a new storyboard)" };
  }
  const allowed = new Set([...manifest.map((item) => item.src), ...(ctx.base ? [ctx.base.src] : []), ...Object.values(fixedAudio).filter((value) => String(value).startsWith("assets/"))]);
  // The supplied clips and images, with their notes: the planner's
  // deterministic pass places from these and snaps videos into usable windows.
  const media = routing.media.map((item) => ({ src: `assets/${item.path}`, kind: item.kind, duration: item.duration ?? null, width: item.width, height: item.height, description: item.description, ...(item.notes ? { notes: item.notes } : {}), ...(item.understanding ? { understanding: item.understanding } : {}) }));
  // The files the user clearly meant to be in the video: a plan that leaves one out is repaired, then warned about.
  const featured = featuredForMake(ctx, media);
  for (const entry of constraints?.must_use ?? []) {
    if (media.some((item) => item.src === storySrc(entry.src))) continue;
    const ignored = routing.ignored.find((item) => item.path === entry.src);
    throw new Error(`constraints: must_use ${entry.src} cannot be shown in a scene (${ignored?.reason ?? (routing.base?.path === entry.src ? "it is the base recording" : "it is not a screenshot, image or b-roll video")}); fix its notes role or the constraints`);
  }
  // Headless runs have no one to hand a near-miss to, so make allows more
  // repairs than story plan (each repair is one cheap call; the planner caps it at 5).
  const maxRepairs = options.maxRepairs === undefined ? MAKE_MAX_REPAIRS : Number(options.maxRepairs);
  // Footage-led overlays must sit on track 1+, which the structured tier
  // forbids (it bans scene.track), so footage-led plans at the guided tier.
  const tier = lane === "footage-led" ? "guided" : "structured";
  ctx.say(`model: PAID calls to ${ctx.model.provider} ${ctx.model.model} (direction map, then storyboard; up to ${maxRepairs} repair passes)`);
  // The app's asset provider (adapters.assets, or --asset-provider-cmd): the
  // planner may ask it for shots, filed under assets/shots/.
  const provider = ctx.adapters.assets ?? (ctx.options.assetProviderCmd ? createCommandAssetProvider(ctx.options.assetProviderCmd, { timeoutMs: assetProviderTimeoutMs(ctx.env), concurrency: assetProviderConcurrency(ctx.env), notice: ctx.say, env: ctx.env, cwd: ctx.project }) : null);
  // never_use: the provider is told, and a shot that is one is refused.
  const assets = provider && constraints?.never_use.length ? constrainProvider(provider, constraints, { assetsDir: ctx.assetsDir, notice: ctx.say }) : provider;
  if (assets) ctx.say(`assets: the planner may ask ${ctx.adapters.assets ? "the app" : "the asset provider command"} for shots`);
  const plan = await planStoryboard({
    brief: planBrief,
    words: ctx.words,
    lane,
    format: ctx.format,
    ...(brand ? { brand } : {}),
    tier,
    model: ctx.model.spec,
    client: ctx.model.client,
    audio: fixedAudio,
    base: lane === "footage-led" ? ctx.base.src : null,
    ...(lane === "footage-led" && subject ? { subject } : {}),
    style: style?.pack ?? null,
    direction: round?.mode === "repair" && round.direction ? round.direction : true,
    ...(round?.mode === "repair" ? { seed: { storyboard: round.storyboard, errors: round.problems } } : {}),
    profile,
    maxRepairs,
    // Clip-led planning: the footage the plan may cut, and the density dial (--density, else the style's).
    ...(lane !== "footage-led" ? { clips: manifest.filter((item) => item.clip) } : {}),
    ...(options.density != null ? { density: Number(options.density) } : {}),
    ...(history?.prompt ? { history: history.prompt } : {}),
    ...(assets ? { assets, project: ctx.project, minShots, ...(cardBackdrops ? { cardBackdrops } : {}) } : {}),
    ...(constraints ? { constraints } : {}),
    ...(media.length ? { media } : {}),
    ...(featured.length ? { featured } : {}),
    ...(laidOut ? { layout: laidOut } : {}),
    ...(subjectTrack ? { subjectTrack } : {}),
    ...(pinned ?? {}),
    extraCheck: (story) => [...assetErrors(story, allowed, { shots: Boolean(assets) }), ...storyboardStructureErrors(story, ctx.skeleton)]
  }).finally(() => assets?.close?.());
  for (const shot of plan.shots ?? []) {
    if (shot.cost_usd > 0) report.costs.items.push({ stage: "shot", scene_id: shot.scene_id, provider: shot.source?.provider ?? "asset-provider", model: shot.source?.model ?? null, estimated_usd: shot.cost_usd, fallback: false });
  }
  if (assets) report.shots = plan.shots ?? [];
  // shot_counts: {min, requested, answered}; report.shots stays the list of shots used.
  if (assets) report.shot_counts = plan.shot_counts ?? { min: minShots, requested: 0, answered: 0 };
  for (const warning of plan.warnings ?? []) if (warning.startsWith("shots: ") || warning.startsWith("backdrops: ") || warning.startsWith("layout: ") || warning.startsWith("stacked: ") || warning.startsWith("face: ") || warning.startsWith("featured: ")) report.warnings.push(warning);
  if (featured.length && report.assets) report.assets = { ...report.assets, featured: featured.map((item) => ({ src: item.src, reason: item.reason })), unused_featured: (plan.warnings ?? []).filter((warning) => warning.startsWith("featured: ")).map((warning) => warning.slice(10).split(" ")[0]) };
  if (laidOut) report.layout = { name: laidOut, sections: (plan.storyboard?.sections ?? []).map((section) => ({ id: section.id, layout: section.layout, start: section.start, end: section.end })) };
  // Card backdrops: which full-screen cards sit on footage, how it measured, and which kept a stock plate.
  if (cardBackdrops) report.card_backdrops = { mode: cardBackdrops, placed: (plan.shots ?? []).filter((shot) => shot.slot === "backdrop").map((shot) => ({ scene_id: shot.scene_id, src: shot.src, kind: shot.kind, ...(shot.treatment ? { treatment: shot.treatment } : {}), ...(shot.footage ? { footage: shot.footage } : {}) })), kept_stock: (plan.warnings ?? []).filter((warning) => /keeps the story's plate$/.test(warning)).length };
  const costPrefix = round ? `critic-${round.round}-` : "";
  for (const attempt of plan.direction_attempts ?? []) addCost(report, `${costPrefix}${attempt.kind}-${attempt.attempt}`, ctx.model, { cost_usd: attempt.cost_usd, usage: attempt.usage, model: attempt.model });
  for (const attempt of plan.attempts) addCost(report, `${costPrefix}storyboard-${attempt.kind}-${attempt.attempt}`, ctx.model, { cost_usd: attempt.cost_usd, usage: attempt.usage, model: attempt.model });
  await writeJson(path.join(project, MAKE_PATHS.plan), { ...plan, brief: MAKE_PATHS.brief });
  if (plan.clip_led?.mode && plan.clip_led.mode !== "graphics") report.clip_led = { mode: plan.clip_led.mode, density: plan.clip_led.density, target: plan.clip_led.target, share: plan.clip_led.share };
  report.repairs = { tier, used: plan.repairs_used, max: plan.max_repairs, valid_first_attempt: plan.valid_first_attempt, attempts: plan.attempts.map((attempt) => ({ attempt: attempt.attempt, kind: attempt.kind, ok: attempt.ok, errors: attempt.errors.slice(0, 12) })) };
  if (plan.status !== "passed") {
    if (plan.storyboard) await writeJson(path.join(project, "storyboard.rejected.json"), plan.storyboard);
    throw new Error(`the storyboard failed its checks after ${plan.attempts.length} attempt(s):\n- ${plan.errors.slice(0, 10).join("\n- ")}`);
  }
  const story = pinned ? withBible(finalizeStory(plan.storyboard, ctx), pinned.bible) : finalizeStory(plan.storyboard, ctx);
  // The look dials that would repeat the latest videos move to unused values
  // (never the ones a chosen style pack pins); the recheck covers the change.
  const varied = history ? varyStory(story, history.avoid, { seed: hashValue({ prompt: ctx.text, project }), style: style?.pack ?? null, locked: lockedDials(style, ctx) }).changes : [];
  const recheck = checkStoryboard(story, { words: ctx.words, tier, style: style?.pack ?? null, direction: plan.direction, profile, bandErrors: false, constraints, ...(pinned ? { script: pinned.script, castGate: true } : {}) });
  // The same checks, for a storyboard with one scene changed (the candidates stage).
  ctx.storyCheck = (candidate) => {
    const checked = checkStoryboard(candidate, { words: ctx.words, tier, style: style?.pack ?? null, direction: plan.direction, profile, bandErrors: false, constraints, ...(pinned ? { script: pinned.script, castGate: true } : {}) });
    return [...(checked.ok ? [] : checked.errors), ...assetErrors(candidate, allowed, { shots: Boolean(assets) }), ...storyboardStructureErrors(candidate, ctx.skeleton)];
  };
  if (!recheck.ok) throw new Error(`the storyboard failed its checks after make filled in audio:\n- ${recheck.errors.slice(0, 10).join("\n- ")}`);
  await writeJson(storyFile, story);
  if (plan.direction) await writeFile(directionFile, directionJson(plan.direction));
  if (history) await lintVariety(ctx, story, style, history, varied);
  report.direction = plan.direction ? { file: MAKE_PATHS.direction, source: plan.direction_source, ...(plan.cadence ? { coverage: plan.cadence.coverage, face_time: plan.cadence.face_time, longest_undressed_seconds: plan.cadence.longest_undressed_seconds } : {}) } : null;
  state.plan = { hash: planHash, repairs: report.repairs, direction: Boolean(plan.direction), ...(report.shot_counts ? { shot_counts: report.shot_counts } : {}), ...(history ? { variety: varied } : {}) };
  return { status: "done" };
}

// --visual-history-dir (docs/COLLECTIONS_RFC.md §6): the index of earlier
// videos, what the next plan should not repeat, and the planner's section.
async function loadHistory(ctx) {
  const { options, project, report } = ctx;
  if (!options.visualHistoryDir) return null;
  const dir = path.resolve(options.cwd ?? process.cwd(), String(options.visualHistoryDir));
  const index = await readHistoryIndex(dir);
  const avoid = historyAvoid(index.entries, { project, limit: options.visualHistoryLimit ?? DEFAULT_VISUAL_HISTORY_LIMIT });
  report.variety = { history_dir: dir, entries: avoid.total };
  return { dir, entries: index.entries, avoid, prompt: historyPrompt(avoid) };
}

// The dials a chosen style pack pins are brand DNA; a seeded look is not.
function lockedDials(style, ctx) {
  if (!style?.pack || ctx.generatedStyle) return {};
  return { background: Boolean(style.pack.background), captions: Boolean(packCaptionsFor(style.pack, ctx.routing.lane)?.preset) };
}

// The variety lint: the plan against every entry, weighted towards recent
// ones. It reports (MAKE.json variety, a warning per finding); it never fails make.
async function lintVariety(ctx, story, style, history, varied) {
  const { project, report, options } = ctx;
  const fingerprint = fingerprintStory(story, { narration: ctx.narrationText ?? null, style: style?.pack ?? null, project, prompt: ctx.text });
  ctx.varietyFingerprint = fingerprint;
  const assessment = assessVariety(fingerprint, history.entries, { project, similarityLimit: options.visualSimilarityLimit ?? DEFAULT_VISUAL_SIMILARITY_LIMIT });
  report.variety = { history_dir: history.dir, entries: assessment.entries, varied, passes: assessment.passes, similarity_limit: assessment.similarity_limit, nearest: assessment.nearest, findings: assessment.findings, file: MAKE_PATHS.variety };
  await writeJson(path.join(project, MAKE_PATHS.variety), { ...report.variety, fingerprint, compared: assessment.compared });
  for (const change of varied) ctx.say(`variety: ${change.dial} ${change.from} → ${change.to} (the last videos in ${history.dir} used ${change.from})`);
  for (const finding of assessment.findings) report.warnings.push(`variety: ${finding} (${MAKE_PATHS.variety}; --replan plans again against the history)`);
}

/** The planned storyboard plus the fields make owns (narration, music file, title). */
export function finalizeStory(storyboard, ctx) {
  const story = JSON.parse(JSON.stringify(storyboard));
  story.audio = { ...(story.audio ?? {}) };
  if (ctx.narration) story.audio.narration = { ...ctx.narration };
  // A music track in the assets is the bed unless --music says otherwise.
  if (ctx.routing.music && ctx.options.music == null) story.audio.music = `assets/${ctx.routing.music.path}`;
  else if (typeof story.audio.music === "string" && story.audio.music.startsWith("assets/") && !ctx.routing.music) delete story.audio.music;
  if (!story.title && ctx.script?.title) story.title = ctx.script.title;
  // The library skeleton the story is built on: finish's structure gate checks its key shot.
  if (ctx.skeleton) story.skeleton = { id: ctx.skeleton.id, version: ctx.skeleton.version };
  // Loop endings are a Shorts device (portrait, 60 s or less); a landscape or
  // longer video ends on its last scene instead of replaying the hook.
  const { width, height, duration } = story.format ?? {};
  if (story.ending?.loop_to && !(height > width && Number(duration) <= 60)) {
    delete story.ending;
    ctx.report.warnings.push("dropped ending.loop_to: loop endings are for portrait Shorts of 60 s or less; the video holds on its last scene");
  }
  // A grammar the model put at the top level belongs in motion.grammar.
  if (story.grammar !== undefined) {
    if (!story.motion?.grammar && typeof story.grammar === "string") story.motion = { ...(story.motion ?? {}), grammar: story.grammar };
    delete story.grammar;
  }
  if (ctx.generatedStyle) adoptStyleLook(story, ctx.generatedStyle);
  const world = worldLook(story, ctx.text);
  if (world.length) ctx.report.notices.push(`world look: ${world.join("; ")}`);
  story.meta = { ...(story.meta ?? {}), made_by: "launchclip make", prompt: ctx.text };
  return story;
}

const TRAVEL_LANES = new Set(["motion", "voiceover-motion"]);
const PLATE_SECONDS = 8;

/**
 * Motion videos travel (suggestMotion): when the plan left the camera unset,
 * it becomes the world camera, and a world with no backdrop of its own gets
 * plates that change about every 8 s (fallbackPlates: neutral and brand-lit,
 * with the project's footage when it has some). A plan that chose cuts, a brief that
 * asks for them, or a drawn world scene keeps its own. → what was added.
 */
export function worldLook(story, prompt = "") {
  const added = [];
  if (!TRAVEL_LANES.has(story.lane)) return added;
  if (!story.camera?.mode && suggestMotion({ artDirection: prompt, lane: story.lane }).camera.mode === "world") {
    story.camera = { ...(story.camera ?? {}), mode: "world", layout: story.camera?.layout ?? "auto" };
    added.push("camera.mode world");
  }
  if (story.camera?.mode !== "world") return added;
  const base = (story.scenes ?? []).filter((scene) => (scene?.track ?? 0) === 0);
  const drawn = Boolean(story.world) || base.some((scene) => scene?.module === "world");
  // A footage backdrop (--card-backdrops) is one card's, not the story's look:
  // the other shots still get the plate cycle.
  const footage = (plate) => ["video", "image"].includes(plate?.kind);
  const ownPlates = story.plate || (story.chapters ?? []).some((chapter) => chapter?.plate) || base.some((scene) => (scene?.backdrop && !footage(scene.backdrop)) || scene?.plate);
  if (!drawn && !ownPlates && base.length > 1) {
    const duration = Number(story.format?.duration) || base.reduce((end, scene) => Math.max(end, Number(scene.end) || 0), 0);
    const every = Math.max(1, Math.min(50, Math.round(PLATE_SECONDS / Math.max(1, duration / base.length))));
    // Neutral, brand-lit plates and the project's own footage; a motif
    // (hex-shell, strands, starfield) only when the brief is about one.
    const topic = [prompt, story.title].filter(Boolean).join("\n");
    const plates = fallbackPlates(story, topic);
    story.plate = { ...plates[0], cycle: { every, plates } };
    const motif = plateMotif(topic);
    added.push(`plate cycle every ${every} shot${every === 1 ? "" : "s"} (${motif ? `${motif} plates` : "neutral plates"}${plates.some((entry) => entry.kind === "video" || entry.kind === "image") ? " and project footage" : ""})`);
  }
  return added;
}

// Rendered candidates (src/make/candidates.js): the opening and one risky
// transition, two candidates each, as stills scored from the pixels; a
// winning alternative replaces the planner's in storyboard.json. Never fatal:
// a comparison that cannot be made is reported and the planner's cut stands.
async function stageCandidates(ctx) {
  const { project, report, state, options } = ctx;
  const skip = (reason) => { report.candidates = { status: "skipped", reason }; return { status: "skipped", reason }; };
  if (candidatesMode(options.candidates) === "off") return skip("--candidates off");
  if (ctx.routing.lane === "footage-led") return skip("footage-led: the opening is the recording itself");
  if (ctx.longForm) return skip("long form: its storyboard comes from the beat map, which candidates do not change yet");
  if (!ctx.model.vision) return skip(`${ctx.model.spec} cannot take images, so nothing can score candidates from their frames`);
  const storyFile = path.join(project, MAKE_PATHS.story);
  let raw = await readJson(storyFile);
  if (state.candidates?.story === hashValue(raw)) { report.candidates = { ...state.candidates.report, status: "reused" }; return { status: "cached", reason: "the storyboard is the one the candidates chose" }; }
  if (!ctx.storyCheck) return skip("the storyboard was reused from an earlier run; pass --replan to plan again with candidates");
  const notes = [];
  const comparisons = [];
  const applied = [];
  try {
    let resolved = (await readProjectStory(project)).resolved;
    const fps = Number(resolved.resolved?.fps ?? resolved.format?.fps ?? 30);
    const still = ctx.adapters.candidateStill ?? await rendererStill({ project, renderer: ctx.renderer });
    const judge = async (kind, entries, context) => {
      ctx.say(`model: PAID call to ${ctx.model.provider} ${ctx.model.model} (${kind} candidates scored from ${entries.reduce((sum, entry) => sum + entry.frames.length, 0)} rendered frames)`);
      try {
        const judged = await judgeCandidates({ client: ctx.model.client, model: ctx.model.model, provider: ctx.model.provider, kind, candidates: entries, project, context });
        addCost(report, `candidate-judge-${kind}`, ctx.model, judged.cost);
        return judged;
      } catch (error) { if (error.cost) addCost(report, `candidate-judge-${kind}`, ctx.model, error.cost); throw error; }
    };
    // The opening: the planner's scene against one designed without seeing it.
    const opening = openingScene(resolved);
    if (opening) {
      try {
        ctx.say(`model: PAID call to ${ctx.model.provider} ${ctx.model.model} (a second opening, designed without the first)`);
        const line = (ctx.words ?? []).filter((word) => word.start >= opening.start - 0.05 && word.start < opening.end).map((word) => word.text).join(" ");
        let design;
        try { design = await designOpening({ client: ctx.model.client, model: ctx.model.model, provider: ctx.model.provider, prompt: ctx.text, line, seconds: opening.end - opening.start, format: ctx.format, assets: assetManifestLines(ctx).filter((item) => item.src), notes: await notesText(ctx) }); }
        catch (error) { if (error.cost) addCost(report, "candidate-opening", ctx.model, error.cost); throw error; }
        addCost(report, "candidate-opening", ctx.model, design.cost);
        if (design.module === opening.module && JSON.stringify(design.params) === JSON.stringify(opening.params)) throw new Error("the second opening is the same card as the first");
        const variantRaw = storyWith(raw, opening.id, design);
        const errors = ctx.storyCheck(variantRaw);
        const variant = storyWith(resolved, opening.id, design);
        if (errors.length || !sceneResolves(variant, opening.id)) throw new Error(`the second opening does not pass the storyboard checks (${errors[0] ?? "its module does not resolve"})`);
        const times = sceneTimes(opening);
        const a = { ...(await renderCandidate({ project, id: "open-a", story: resolved, times, fps, still })), source: `the planner's opening (${opening.module})` };
        const b = { ...(await renderCandidate({ project, id: "open-b", story: variant, times, fps, still })), source: `a separately designed opening (${design.module})` };
        const judged = await judge("opening", [a, b], "The opening line is: " + (line || "(no narration)"));
        const selected = selectCandidate(["open-a", "open-b"], judged.scores);
        if (!selected) throw new Error("the judge found no admissible opening");
        comparisons.push(comparisonEntry({ id: "opening", kind: "opening", candidates: [a, b], judged: judged.scores, selected, rationale: judged.rationale }));
        if (selected === "open-b") { raw = variantRaw; resolved = variant; applied.push(`opening: ${opening.module} → ${design.module}`); }
      } catch (error) { notes.push(`opening: ${String(error?.message ?? error).split("\n")[0]}`); }
    } else notes.push("opening: the storyboard has no base scene");
    // One risky transition: the planner's move against a different kind of move.
    const boundary = riskyBoundary(resolved);
    if (boundary) {
      try {
        const scene = boundary.scene;
        const move = alternativeTransition(scene, resolved);
        const variantRaw = storyWith(raw, scene.id, { in: move });
        const errors = ctx.storyCheck(variantRaw);
        if (errors.length) throw new Error(`a ${move.type} there does not pass the storyboard checks (${errors[0]})`);
        const variant = storyWith(resolved, scene.id, { in: move });
        const duration = Number(resolved.resolved?.duration ?? resolved.format?.duration);
        const times = transitionTimes(scene, { dur: Math.max(Number(scene.in?.dur) || 0, move.dur) }, duration);
        const a = { ...(await renderCandidate({ project, id: "trans-a", story: resolved, times, fps, still })), source: `the planner's ${scene.in?.type ?? "cut"}` };
        const b = { ...(await renderCandidate({ project, id: "trans-b", story: variant, times, fps, still })), source: `a ${move.type}` };
        const judged = await judge("transition", [a, b], `It joins scene ${boundary.boundary_id.replace(/-in$/, "")} to the scene before it.`);
        const selected = selectCandidate(["trans-a", "trans-b"], judged.scores);
        if (!selected) throw new Error("the judge found no admissible transition");
        comparisons.push(comparisonEntry({ id: `transition-${scene.id}`, kind: "transition", boundary: boundary.boundary_id, candidates: [a, b], judged: judged.scores, selected, rationale: judged.rationale }));
        if (selected === "trans-b") { raw = variantRaw; applied.push(`transition into ${scene.id}: ${scene.in?.type ?? "cut"} → ${move.type}`); }
      } catch (error) { notes.push(`transition: ${String(error?.message ?? error).split("\n")[0]}`); }
    } else notes.push("transition: the storyboard has no second scene in its opening stretch");
  } catch (error) {
    notes.push(String(error?.message ?? error).split("\n")[0]);
  }
  if (!comparisons.length) {
    report.candidates = { status: "skipped", reason: notes.join("; ") || "no comparison could be made", notes };
    report.warnings.push(`candidates: none compared (${report.candidates.reason}); the planner's opening and transitions stand`);
    return { status: "skipped", reason: report.candidates.reason };
  }
  const receipt = await writeReceipt(project, comparisons, { boundaryIds: comparisons.filter((entry) => entry.boundary_id).map((entry) => entry.boundary_id) });
  if (applied.length) await writeJson(storyFile, raw);
  report.candidates = {
    status: "done", receipt: receipt.file, receipt_ok: receipt.ok, ...(receipt.ok ? {} : { receipt_errors: receipt.errors.slice(0, 6) }),
    comparisons: comparisons.map((entry) => ({ id: entry.id, kind: entry.kind, ...(entry.boundary_id ? { boundary_id: entry.boundary_id } : {}), selected: entry.selected_candidate_id, rationale: entry.selection_rationale, candidates: entry.candidates.map((candidate) => ({ id: candidate.id, source: candidate.source, mean: meanScore(candidate.scores), admissible: candidate.admissible })) })),
    applied, notes
  };
  for (const note of notes) report.warnings.push(`candidates: ${note}`);
  for (const change of applied) ctx.say(`candidates: ${change} (scored higher from the rendered frames)`);
  state.candidates = { story: hashValue(raw), report: report.candidates };
  return { status: "done" };
}

// Matte exactly the source ranges the planned subject scenes cover (padded),
// filed in the project so base.subject "auto" picks them up. A failed matte
// is a warning: its scenes render, without the presenter in front.
async function stageSubject(ctx) {
  const { project, report, adapters } = ctx;
  if (ctx.routing.lane !== "footage-led") return { status: "skipped", reason: "not footage-led" };
  if (!ctx.subject?.probe?.usable) return { status: "skipped", reason: report.subject?.reason ?? report.subject?.reasons?.join("; ") ?? "no usable presenter cut-out" };
  const loaded = await readProjectStory(project);
  const src = path.join(project, ctx.subject.src);
  const source = await (adapters.subject?.describe ?? describeSource)(src);
  const ranges = plannedSubjectRanges(loaded.resolved, { sourceDuration: source.duration });
  if (!ranges.length) return { status: "skipped", reason: "the storyboard uses no subject effects" };
  const matte = adapters.subject?.matte ?? runSubjectMatte;
  ctx.say(`subject: matting ${ranges.map((range) => `${range.in}–${range.out} s`).join(", ")} of ${ctx.subject.src} (local, about 0.2 s a frame)`);
  for (const range of ranges) {
    try {
      const result = await matte(src, range, { source, cacheDir: path.join(project, ".launchclip", "subject"), log: ctx.say });
      const entry = await fileProjectMatte(project, src, result);
      report.subject.mattes.push({ in: entry.in, out: entry.out, src: entry.src, plate: entry.plate ?? null, cached: Boolean(result.cached), seconds: result.seconds ?? 0, usable: result.info.usable });
      if (!result.info.usable) report.warnings.push(`the matte for ${entry.in}–${entry.out} s is unreliable (${result.info.reasons.join("; ")}); its subject scenes may show artefacts`);
    } catch (error) {
      report.warnings.push(`matting ${range.in}–${range.out} s failed (${String(error?.message ?? error).split("\n")[0]}); those subject scenes render without the presenter in front`);
    }
  }
  return report.subject.mattes.length ? { status: "done" } : { status: "skipped", reason: "every matte failed (see the warnings); subject scenes render without the presenter in front" };
}

async function stageFinish(ctx) {
  const { project, report, adapters, options } = ctx;
  // A run that cannot have its ElevenLabs track still finishes, on the synth bed (src/finish.js musicFallback).
  const finishOptions = { renderer: ctx.renderer, quality: ctx.quality, musicFallback: true, ...(options.concurrency != null ? { concurrency: options.concurrency } : {}), ...(options.music != null ? { music: String(options.music).toLowerCase() } : {}), ...(options.musicVolume != null ? { musicVolume: Number(options.musicVolume) } : {}), ...(options.musicDuck != null ? { musicDuck: Number(options.musicDuck) } : {}), ...(options.musicPrompt != null ? { musicPrompt: String(options.musicPrompt) } : {}), sfx: makeSfxMode(options.sfx, ctx.env), ...(ctx.finishScenes?.length ? { scenes: ctx.finishScenes } : {}) };
  const musicNote = options.music != null ? `--music ${options.music}` : ctx.routing.music ? `the supplied track assets/${ctx.routing.music.path}` : (ctx.env.ELEVENLABS_API_KEY ? "ElevenLabs (ELEVENLABS_API_KEY is set; PAID unless the music lock or cache has the track)" : "the synth bed (no ELEVENLABS_API_KEY)");
  const sfxNote = finishOptions.sfx === "generated" ? "generated per event (ElevenLabs sound effects; PAID unless the project lock or cache has them)" : finishOptions.sfx;
  ctx.say(`finish: voice, captions, sound, render (${ctx.renderer}, ${ctx.quality}), master, evidence, gates; music: ${musicNote}; sfx: ${sfxNote}`);
  ctx.say(machineLine(options.concurrency));
  const finishAdapters = { env: ctx.env, notice: ctx.say, progress: (event) => ctx.progress?.({ stage: "finish", ...event }), ...(adapters.finishAdapters ?? {}) };
  if (adapters.voiceProvider) finishAdapters.voiceProvider = adapters.voiceProvider;
  if (adapters.normalizeVoice) finishAdapters.normalizeVoice = adapters.normalizeVoice;
  const run = adapters.finish ?? (await import("../finish.js")).runFinish;
  const finish = await run(project, finishOptions, finishAdapters);
  ctx.finish = finish;
  report.finish = { status: finish.status, report: "finish.json", seconds: finish.seconds, stages: finish.stages.map((stage) => ({ name: stage.name, status: stage.status, seconds: stage.seconds, ...(stage.error ? { error: stage.error.split("\n")[0] } : {}) })) };
  report.gates = Object.fromEntries(Object.entries(finish.gates ?? {}).map(([name, gate]) => [name, { status: gate.status, ...(gate.error ? { error: String(gate.error).split("\n")[0] } : {}), ...(gate.reason ? { reason: gate.reason } : {}) }]));
  if (ctx.baseEditQa) report.gates.base_edit_qa = ctx.baseEditQa;
  if (ctx.researchGate) report.gates.research = ctx.researchGate;
  report.final = finish.final ? path.relative(project, finish.final) : null;
  // finish wrote publish.json (and the cover) with SCRIPT.json's titles.
  if (finish.publish) report.publish = finish.publish;
  report.warnings.push(...(finish.warnings ?? []));
  const sound = finish.stages.find((stage) => stage.name === "sound");
  const sfxCost = Number(sound?.details?.sfx_generated?.cost_usd);
  if (Number.isFinite(sfxCost) && sfxCost > 0) report.costs.items.push({ stage: "sfx", provider: "elevenlabs", model: "eleven_text_to_sound_v2", sounds: Number(sound.details.sfx_generated.new ?? 0), estimated_usd: sfxCost, fallback: false });
  const musicCost = Number(sound?.details?.music?.cost_usd ?? sound?.details?.music_cost_usd);
  if (Number.isFinite(musicCost) && musicCost > 0 && !sound?.details?.music?.cached) report.costs.items.push({ stage: "music", provider: "elevenlabs", model: sound?.details?.music?.model ?? sound?.details?.music?.generation?.model ?? null, generated_seconds: Number(sound?.details?.music?.generated_seconds ?? sound?.details?.music?.generation?.generated_seconds ?? 0), estimated_usd: musicCost, fallback: false });
  if (finish.status === "failed") {
    const failed = finish.stages.find((stage) => stage.status === "failed");
    throw new Error(`finish failed at the ${failed?.name ?? "unknown"} stage: ${errorSummary(failed?.error)}`);
  }
  return { status: "done" };
}

// make's sound effects: the flag, else described and generated per event
// with an ElevenLabs key (PAID, cached and locked per project), else the kit.
export function makeSfxMode(flag, env = process.env) {
  if (flag != null && flag !== "") return String(flag).toLowerCase();
  return env?.ELEVENLABS_API_KEY ? "generated" : "kit";
}

// What the render runs on: the log line that tells a slow render on a small
// container from a slow story.
function machineLine(concurrency) {
  try {
    const machine = measureMachine();
    const limit = machine.container ? ` (container limit${machine.container.cores ? ` ${round1(machine.container.cores)} cores` : ""}${machine.container.ram_gb ? ` ${machine.container.ram_gb} GB` : ""})` : "";
    const budget = renderBudget({ machine });
    return `machine: ${machine.cores} cores, ${machine.ram_gb} GB${limit}; render tabs ${concurrency ?? budget.tabs}, video cache ${round1(budget.video_cache_bytes / 1024 ** 3)} GB`;
  } catch (error) {
    return `machine: not measured (${String(error?.message ?? error).split("\n")[0]})`;
  }
}

async function stageCritic(ctx) {
  const { options } = ctx;
  if (options.critic === false) return criticPending(ctx, "--no-critic");
  if (!ctx.model.vision) {
    const why = ctx.report.model_access?.vision?.reason;
    return criticPending(ctx, `${ctx.model.spec} cannot take images${why ? ` (${why})` : ""}`);
  }
  const result = await runCritic(ctx);
  if (result.status !== "written") return criticPending(ctx, result.reason ?? "the critic did not run");
  await criticRepairs(ctx, result);
  if (ctx.report.critic?.verdict !== "ship") ctx.report.next_steps.push(`The headless critic asked for ${ctx.report.critic.verdict} (${ctx.report.critic.findings} finding${ctx.report.critic.findings === 1 ? "" : "s"} in qa/critic.json): edit storyboard.json scenes, then run launchclip finish ${ctx.project} --scene <id>, or launchclip make again with --replan`);
  return { status: "done" };
}

function criticPending(ctx, reason) {
  const { project, report } = ctx;
  report.critic = { status: "pending", reason };
  if (report.gates?.critic) report.gates.critic = { status: "pending", reason };
  report.next_steps.push(`Critic pending (${reason}): have a fresh-context critic review qa/critic-sheets/ and write qa/critic.json, then run launchclip cinematic-check ${project} --renderer ${ctx.renderer} --video ${report.final ?? "renders/draft.mp4"} --expect-audio`);
  return { status: "skipped", reason };
}

// One critic pass over the current render: report.critic and the critic gate.
async function runCritic(ctx, label = "critic") {
  const { project, report } = ctx;
  ctx.say(`model: PAID call to ${ctx.model.provider} ${ctx.model.model} (headless critic over qa/critic-sheets/)`);
  const quality = ctx.finish?.gates?.coverage?.findings ?? [];
  const result = await (ctx.adapters.critic ?? runHeadlessCritic)({ project, client: ctx.model.client, model: ctx.model.model, provider: ctx.model.provider, quality, rules: rulesText(ctx) });
  if (result.cost_usd !== undefined) addCost(report, label, ctx.model, { cost_usd: result.cost_usd, usage: result.usage, model: result.model });
  if (result.status !== "written") return result;
  report.critic = { status: "written", file: "qa/critic.json", verdict: result.verdict, findings: result.findings, reviewed: result.reviewed, unreviewed: result.unreviewed, warnings: result.warnings, model: result.model, note: "headless model critic over contact sheets; a human or fresh-agent review is still the definition of done" };
  if (report.gates) report.gates.critic = { status: result.verdict === "ship" ? "passed" : "failed", verdict: result.verdict, findings: result.findings, source: "qa/critic.json (headless)" };
  return result;
}

// What runCritic's result says, as a critique: the result's own, else qa/critic.json.
async function critiqueOf(ctx, result) {
  if (result?.critique) return result.critique;
  return await readJson(path.join(ctx.project, "qa/critic.json")) ?? { verdict: result?.verdict ?? null, findings: [] };
}

// The files a critic round may overwrite, and the report fields it may change.
const CRITIC_ROUND_FILES = ["storyboard.json", "BEATMAP.json", "DIRECTION.json", "BRIEF.md", "finish.json", "publish.json", "qa", "renders", ".launchclip/finish", ".launchclip/storyboard-plan.json"];
const CRITIC_ROUND_FIELDS = ["critic", "gates", "final", "finish", "publish", "repairs", "shots", "shot_counts", "direction", "card_backdrops", "clip_led", "layout"];

async function snapshotRound(ctx) {
  const dir = path.join(ctx.project, ".launchclip", "critic-repair", "before");
  await rm(dir, { recursive: true, force: true });
  const files = [];
  for (const rel of CRITIC_ROUND_FILES) {
    const from = path.join(ctx.project, rel);
    if (!existsSync(from)) continue;
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await cp(from, path.join(dir, rel), { recursive: true });
    files.push(rel);
  }
  const fields = Object.fromEntries(CRITIC_ROUND_FIELDS.map((field) => [field, structuredClone(ctx.report[field])]));
  return { dir, files, fields, plan: structuredClone(ctx.state.plan ?? null), finish: ctx.finish };
}

async function restoreRound(ctx, snapshot) {
  for (const rel of CRITIC_ROUND_FILES) {
    const to = path.join(ctx.project, rel);
    await rm(to, { recursive: true, force: true });
    if (snapshot.files.includes(rel)) await cp(path.join(snapshot.dir, rel), to, { recursive: true });
  }
  Object.assign(ctx.report, snapshot.fields);
  ctx.state.plan = snapshot.plan;
  ctx.finish = snapshot.finish;
}

/**
 * --critic-repairs rounds: while the critic does not say ship and rounds
 * remain, its findings go back to the planner (a targeted repair, or one
 * whole replan), the changed scenes render again and the critic looks again.
 * A round that fails, changes nothing or does not lower the blocking and
 * major findings is undone and the rounds stop. Each round lands in
 * report.critic_repairs.
 */
async function criticRepairs(ctx, first) {
  const { project, report, options } = ctx;
  const budget = criticRepairBudget(options.criticRepairs);
  if (!budget) return;
  report.critic_repairs = [];
  // Long form on the rule-made cards has no model direction for a round to change.
  if (ctx.longForm && longFormVisuals(options) === "rules") {
    if (first?.verdict !== "ship") report.warnings.push("critic repairs skipped: --long-form-visuals rules keeps the beat director's cards, so there is no model direction to repair");
    return;
  }
  let critique = await critiqueOf(ctx, first);
  for (let round = 1; round <= budget; round += 1) {
    if (critique.verdict === "ship") break;
    const before = criticScore(critique);
    const loaded = await readProjectStory(project);
    const manifest = await readJson(path.join(project, "qa/temporal-evidence/manifest.json"));
    const findings = findingScenes(critique.findings, manifest?.entries ?? [], loaded.resolved?.scenes ?? []);
    const opening = (loaded.resolved?.scenes ?? []).find((scene) => (scene.track ?? 0) === 0)?.id ?? null;
    const mode = criticRepairRoute(critique, findings, opening);
    const problems = criticProblems(findings);
    const entry = { round, mode, verdict_before: before.verdict, findings_before: before, scenes: [...new Set(findings.flatMap((finding) => finding.scenes))], kept: false };
    report.critic_repairs.push(entry);
    ctx.say(`critic repair ${round} of ${budget}: ${mode} for ${before.blocking} blocking and ${before.major} major finding(s)${entry.scenes.length ? ` in ${entry.scenes.join(", ")}` : ""}`);
    const t0 = performance.now();
    const snapshot = await snapshotRound(ctx);
    const repairs = report.repairs;
    try {
      ctx.criticRound = { round, mode, problems, findings: criticFindings(findings), storyboard: await readJson(path.join(project, MAKE_PATHS.story)), direction: await readJson(path.join(project, MAKE_PATHS.direction)) };
      await stageStoryboard(ctx);
      const after = await readProjectStory(project);
      ctx.finishScenes = mode === "repair" ? changedScenes(loaded.resolved, after.resolved) : null;
      if (ctx.finishScenes && !ctx.finishScenes.length) throw new Error("the repair changed no scene");
      entry.rendered = ctx.finishScenes ?? "all";
      await stageFinish(ctx);
      const result = await runCritic(ctx, `critic-${round}`);
      if (result.status !== "written") throw new Error(`the critic did not run again (${result.reason ?? result.status})`);
      critique = await critiqueOf(ctx, result);
      const after_ = criticScore(critique);
      Object.assign(entry, { verdict_after: after_.verdict, findings_after: after_, kept: criticImproved(before, after_) });
    } catch (error) {
      entry.error = String(error?.message ?? error).split("\n")[0];
    } finally {
      ctx.criticRound = null;
      ctx.finishScenes = null;
      entry.seconds = round1((performance.now() - t0) / 1000);
    }
    // The planner's own repair record stays the first plan's; the round's is in the entry.
    if (entry.kept) {
      entry.repairs = report.repairs;
      report.repairs = repairs;
      ctx.say(`critic repair ${round}: kept (${entry.verdict_before} → ${entry.verdict_after}; blocking + major ${before.blocking + before.major} → ${entry.findings_after.blocking + entry.findings_after.major}) in ${entry.seconds}s`);
      continue;
    }
    await restoreRound(ctx, snapshot);
    critique = await critiqueOf(ctx, { verdict: report.critic?.verdict });
    const why = entry.error ?? `no better (${entry.verdict_after}; blocking + major ${before.blocking + before.major} → ${entry.findings_after.blocking + entry.findings_after.major})`;
    report.warnings.push(`critic repair ${round}: undone, the earlier cut is kept (${why})`);
    ctx.say(`critic repair ${round}: undone, keeping the earlier cut (${why}) after ${entry.seconds}s`);
    break;
  }
  await rm(path.join(project, ".launchclip", "critic-repair"), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Brief, manifest and checks

/** Every file the storyboard may reference: [{src, kind, line}]. */
// Research's capture requests are recorded while the script and voice are
// made (src/make/captures.js); the storyboard waits for them. A capture that
// cannot be recorded is a warning: the director shows the clause another way.
function startCaptures(ctx) {
  ctx.capturing ??= (async () => {
    const requests = await readCaptureRequests(ctx.project);
    if (!requests.length) return null;
    return recordCaptures(requests, { project: ctx.project, capture: ctx.adapters.capture, command: ctx.options.captureCmd, concurrency: ctx.options.captureConcurrency, env: ctx.env, say: ctx.say });
  })().catch((error) => ({ recorded: [], failed: [{ id: "*", url: null, reason: error.message }], reused: 0 }));
  return ctx.capturing;
}

async function settleCaptures(ctx) {
  if (!ctx.capturing && researchEnabled(ctx)) startCaptures(ctx);
  const result = ctx.capturing ? await ctx.capturing : null;
  ctx.captures = [];
  if (!result) { await readResearchExtras(ctx); if (ctx.longForm) ctx.longForm.assets = assetManifestLines(ctx).map((item) => ({ src: item.src, line: item.line })); return; }
  for (const request of result.recorded) {
    const files = captureFiles(request);
    try {
      const record = JSON.parse(await readFile(path.join(ctx.project, files.sidecar), "utf8"));
      ctx.captures.push({ request, files, record });
    } catch { result.failed.push({ id: request.id, url: request.url, reason: "its sidecar is missing" }); }
  }
  ctx.report.captures = { requested: result.recorded.length + result.failed.length, recorded: ctx.captures.length, reused: result.reused, ...(Object.keys(result.usage ?? {}).length ? { usage: result.usage } : {}), failed: result.failed.map((entry) => ({ id: entry.id, url: entry.url, reason: entry.reason })) };
  for (const entry of result.failed) ctx.report.warnings.push(`capture ${entry.id}${entry.url ? ` (${entry.url})` : ""} was not recorded: ${entry.reason}`);
  // Loud, with the fix, and in the research gate (src/research/capture_status.js).
  await noteCaptures(ctx, result, [...result.recorded, ...result.failed.map((entry) => ({ id: entry.id, url: entry.url }))]);
  await readResearchExtras(ctx);
  if (ctx.longForm) ctx.longForm.assets = assetManifestLines(ctx).map((item) => ({ src: item.src, line: item.line }));
}

/** Research's official posts and logos; each logo file is copied to the assets/ path its entry names, where modules can load it. */
async function readResearchExtras(ctx) {
  ctx.posts = await readPosts(ctx.project);
  // Research's stock and archive media, staged under assets/research with licence and credit (src/research/stage_media.js).
  ctx.researchMedia = await stageMakeMedia(ctx);
  ctx.researchLogos = [];
  const dir = path.join(ctx.project, RESEARCH_PATHS.dir);
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(dir, RESEARCH_PATHS.logos), "utf8")); } catch { return; }
  for (const logo of manifest.logos ?? []) {
    if (!logo?.file || !logo?.asset?.startsWith("assets/")) continue;
    try {
      await mkdir(path.dirname(path.join(ctx.project, logo.asset)), { recursive: true });
      await copyFile(path.join(dir, logo.file), path.join(ctx.project, logo.asset));
      ctx.researchLogos.push(logo);
    } catch (error) { ctx.report.warnings.push(`logo ${logo.name} could not be staged: ${error.message}`); }
  }
}

/** Research's official posts (research/social.json), each with its ready social-post card. */
async function readPosts(project) {
  try {
    const social = JSON.parse(await readFile(path.join(project, RESEARCH_PATHS.dir, RESEARCH_PATHS.social), "utf8"));
    return (social.posts ?? []).filter((post) => post?.card?.module === "social-post" && post.card.params);
  } catch { return []; }
}

/** The research ledger beside the project, or null. */
async function readLedger(project) {
  try { return JSON.parse(await readFile(path.join(project, RESEARCH_PATHS.dir, RESEARCH_PATHS.ledger), "utf8")); } catch { return null; }
}

export function assetManifestLines(ctx) {
  const routing = ctx.routing;
  const out = [];
  const lane = routing.lane;
  for (const item of routing.media) {
    const src = `assets/${item.path}`;
    const size = item.width && item.height ? `${item.width}×${item.height}` : "unknown size";
    const window = `a media-window scene with params.media {kind: "${item.kind}", src: "${src}"${item.kind === "video" ? ", sourceStart?" : ""}}`;
    // Outside footage-led, any supplied image or video can carry the narration full frame
    // (a clip, cut to its line); what reads as a screen capture is offered as a window first.
    const footage = lane !== "footage-led";
    const clip = `a full-frame clip scene cut to its line, {"module": "clip", "params": {"media": {"kind": "${item.kind}", "src": "${src}"${item.kind === "video" ? `, "sourceStart": 0${item.duration ? `, "sourceEnd": ${item.duration}` : ""}` : ""}}, "focus"?, "callouts"?}}`;
    const use = !footage
      ? `a full-frame insert that covers the speaker: {"module": "media-window", "insert": true, "params": {"title": "…", "media": {"kind": "${item.kind}", "src": "${src}"}}} (insert is a scene key, never inside params; no track)`
      : ["screenshot", "screen-recording"].includes(item.role) ? `${window}, or ${clip}` : `${clip}, or ${window}`;
    out.push({ src, kind: item.kind, ...(footage ? { clip: true } : {}), line: `${src} — ${item.kind}, ${item.role}, ${size}${item.duration ? `, ${item.duration}s` : ""}: ${item.description}.${mediaNotesLine(item)} Use as ${use}.` });
  }
  out.push(...demoManifestLines(ctx));
  // Recorded source pages: the real page on screen, as an evidence-clip with the params its sidecar gives.
  for (const { request, files, record } of ctx.captures ?? []) {
    const params = evidenceClipParams(record, { src: files.clip });
    const title = record.provenance?.source_title ?? request.provenance?.source_title ?? record.final_url ?? request.url;
    out.push({ src: files.clip, kind: "video", line: `${files.clip} — screen recording of the source page "${String(title).slice(0, 80)}" (${request.url}), ${record.duration ?? "?"} s, ${request.kind ?? "page"}${request.claims?.length ? `, backs claim${request.claims.length === 1 ? "" : "s"} ${request.claims.join(", ")}` : request.claim ? `, backs claim ${request.claim}` : ""}. Use as {"module": "evidence-clip", "params": ${JSON.stringify(params)}} on the clause that states what the page shows.` });
  }
  // The companies' own posts on X: a designed social-post card (the recording of the post, when there is one, is listed above).
  for (const post of ctx.posts ?? []) {
    out.push({ src: null, kind: "card", line: `Post by @${post.handle} (${post.name}${post.published_at ? `, ${String(post.published_at).slice(0, 10)}` : ""}): "${String(post.card.params.text).slice(0, 140)}". Use as {"module": "social-post", "params": ${JSON.stringify(post.card.params)}} on the clause that reports it.` });
  }
  out.push(...(ctx.researchMedia ?? []));
  // The named companies' logos (research/logos.json), ready params per module; a logo-row shows 2–6 of them together.
  for (const logo of ctx.researchLogos ?? []) {
    const uses = Object.entries(logo.params ?? {}).map(([module, params]) => `${module} ${JSON.stringify(params)}`).join("; ");
    out.push({ src: logo.asset, kind: "image", line: `${logo.asset} — logo of ${logo.name}${logo.domain ? ` (${logo.domain})` : ""}, ${logo.format ?? "image"}${logo.monochrome ? ", monochrome (set brand-lockup markTint)" : ""}. Use when the narration names ${logo.name}: a logo-row with the other companies named alongside it (2–6 logos), or a brand-lockup for ${logo.name} alone. Params per module: ${uses}.` });
  }
  for (const item of routing.logos) {
    const src = `assets/${item.path}`;
    out.push({ src, kind: "image", line: `${src} — image, logo, ${item.width ?? "?"}×${item.height ?? "?"}: ${item.description}. No catalogue module shows a single logo on its own (logo-row needs 2–6 logos); use it in a media-window only if a product shot is missing, otherwise leave it out.` });
  }
  return out;
}

async function composeBrief(ctx, manifest) {
  const notes = await notesText(ctx);
  const lines = [`# ${ctx.script?.title ?? "Video brief"}`, "", ctx.text, ""];
  const lane = ctx.routing.lane;
  // A character story's brief is its screenplay and its show bible (src/make/show_bible.js).
  const animation = isAnimation(ctx.routing);
  if (animation) lines.push(...animationBriefLines({ script: ctx.script, bible: ctx.bible }));
  if (lane === "motion" && !animation) lines.push("## Narration (already synthesised; the word timings are given, so time scenes to its words)", "", ctx.narrationText, "");
  if (lane === "motion" && !animation && ctx.script?.beats?.length) lines.push(`## Script beats (${ctx.script.plan?.format ?? "script"}, ${ctx.script.plan?.skeleton ?? "skeleton"}; follow them in order)`, "", ...ctx.script.beats.map((entry) => `- ${entry.beat}${entry.role ? ` (${entry.role})` : ""}: ${entry.text}`), "");
  // Titles best first (scored in the script pass): the cover echoes the first.
  if (lane === "motion" && ctx.script?.title_scores?.length) lines.push("## Titles (best first; the cover echoes the first)", "", ...ctx.script.title_options.map((title, index) => `${index + 1}. ${title}`), "");
  const angle = ctx.script?.angle;
  if (lane === "motion" && angle) lines.push("## Angle (the script is written on it; the visuals follow it, never the crowded take)", "", `- Crowded take to avoid: ${angle.crowded}`, `- Angle: ${angle.angles[angle.chosen]?.angle ?? angle.angles[0].angle}`, ...(angle.inventory.length ? [`- What only this subject has (build scenes from these): ${angle.inventory.join("; ")}`] : []), "");
  if (lane === "motion" && ctx.conceptStory) lines.push("## Concept (five were judged and this one won; the visuals follow its world, never a slideshow of its lines)", "", ...conceptLookLines(ctx.conceptStory), "");
  if (ctx.skeleton) lines.push(`## Skeleton: ${ctx.skeleton.title} (build every scene on it; the structure gate checks the opening image and the key shot)`, "", ...skeletonPlanLines(ctx.skeleton).map((line) => `- ${line}`), "");
  if (lane === "voiceover-motion") lines.push("## Voiceover transcript (the supplied voiceover; time scenes to its words)", "", ctx.narrationText, "");
  if (lane === "footage-led") lines.push("## Recording transcript (the edited base recording; its words are the narration)", "", ctx.narrationText, "", "Dress the recording: overlays and inserts on the strong lines only (10–40% of the runtime); gaps show the speaker.", "");
  if (notes.length) lines.push("## Notes", "", ...notes, "");
  const rules = rulesText(ctx);
  if (rules) lines.push(RULES_HEADING, "", rules, "");
  lines.push("## Asset manifest", "");
  if (manifest.length) {
    lines.push("These are the only files you may reference, by exact path. Do not invent other assets/ paths.", "", ...manifest.map((item) => `- ${item.line}`), "");
    if (manifest.some((item) => item.kind === "video" || item.kind === "image")) lines.push("Show the real product media: give at least one scene to each screenshot or screen recording above, on the line that describes it.", "");
  lines.push("## Facts", "", "Use only figures, names, URLs and handles that appear in the prompt, notes or narration. When none are given, prefer modules that need no numbers (checklist, process-steps, callout, media-window, kinetic-words) over count-up, metric or gauge-compare with made-up values, and never use a placeholder unit such as \"time\". A call to action names the product, not an invented domain.", "");
  } else lines.push("No media files were supplied: build every scene from catalogue modules (no media-window).", "");
  return `${lines.join("\n")}\n`;
}

/** Errors for every assets/ path in the story that is not in `allowed`. */
export function assetErrors(story, allowed, { shots = false } = {}) {
  const errors = [];
  const visit = (value, where) => {
    if (typeof value === "string") {
      // Shots the asset provider filed (src/asset_provider.js) are allowed too.
      if (shots && value.replace(/^\.\//, "").startsWith(`${SHOTS_DIR}/`)) return;
      if (/^(\.\/)?assets\//.test(value) && !allowed.has(value.replace(/^\.\//, ""))) errors.push(`${where} references ${value}, which is not in the asset manifest; use one of: ${[...allowed].join(", ") || "(none: remove the media)"}`);
      return;
    }
    if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${where}[${index}]`));
    else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) visit(item, where ? `${where}.${key}` : key);
  };
  visit({ scenes: story?.scenes, overlays: story?.overlays, ending: story?.ending }, "");
  return [...new Set(errors)].slice(0, 12);
}

/** The collection's RULES.md text (options.rules), trimmed, or null. */
function rulesText(ctx) {
  const rules = String(ctx.options.rules ?? "").trim();
  return rules ? rules.slice(0, 8000) : null;
}

async function notesText(ctx) {
  const notes = [];
  for (const entry of ctx.inventory?.entries ?? []) if (entry.kind === "notes" && entry.text) notes.push(entry.text.trim());
  return notes;
}

// The project's style, loaded once a run: the bible stage and the storyboard stage both read it.
async function projectStyle(ctx) {
  if (ctx.loadedStyle === undefined) ctx.loadedStyle = await loadStyle(ctx);
  return ctx.loadedStyle;
}

async function loadStyle(ctx) {
  const { options, routing, project, report } = ctx;
  let request = options.style && options.style !== true ? String(options.style) : null;
  let fromAssets = false;
  if (!request && routing.style) { request = path.join(project, "assets", routing.style.path); fromAssets = true; }
  if (!request) return seededStyle(ctx);
  const looksLikePath = request.includes("/") || request.endsWith(".json") || request.startsWith(".");
  const loaded = await resolveStyleV2(looksLikePath ? path.resolve(ctx.options.cwd ?? process.cwd(), request) : request, { projectDir: project });
  // finish resolves the style by name, so a pack loaded by path is copied
  // into the project's .launchclip/styles/<name>/.
  if (looksLikePath || fromAssets) {
    const target = path.join(project, ".launchclip", "styles", loaded.name, "style.json");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(loaded.pack, null, 2)}\n`);
  }
  report.style = { name: loaded.name, source: fromAssets ? "assets" : loaded.source };
  report.warnings.push(...(loaded.warnings ?? []));
  return loaded;
}

// No style and no brand (no brand.json, no logo) and no --seed... or a --seed:
// a seeded style (docs/SEEDED_STYLES_RFC.md §4). A project that already has
// one reuses it, so reruns and edits keep the look; --seed picks a look.
async function seededStyle(ctx) {
  const { options, routing, project, report, state } = ctx;
  const seed = options.seed == null ? null : String(options.seed);
  if (seed == null && (routing.brand || routing.logos?.length)) return null;
  let style = null;
  if (seed == null) style = await projectSeedStyle(project, { name: state.style?.generated ?? null });
  if (style) ctx.say(style.line);
  else {
    const made = await generateProjectStyle(project, { seed: seed ?? undefined, tone: promptTone(ctx.text), constraints: promptConstraints(ctx.text), clock: ctx.adapters.clock });
    ctx.say(made.line);
    style = { name: made.name, pack: made.pack, file: made.file, source: "generated", warnings: [], summary: made.summary };
  }
  state.style = { generated: style.name };
  report.style = { name: style.name, source: "generated", seed: style.pack.generated.seed, summary: style.summary };
  ctx.generatedStyle = style.pack;
  return style;
}

async function loadBrand(ctx) {
  const entry = ctx.routing.brand ? ctx.inventory.entries.find((item) => item.path === ctx.routing.brand.path) : null;
  if (!entry?.brand) return null;
  const brand = { colors: { ...DEFAULT_BRAND.colors }, fonts: { ...DEFAULT_BRAND.fonts } };
  const colors = entry.brand.colors ?? {};
  for (const role of Object.keys(DEFAULT_BRAND.colors)) if (typeof colors[role] === "string" && /^#[0-9a-f]{6}$/i.test(colors[role])) brand.colors[role] = colors[role];
  const fonts = entry.brand.fonts ?? {};
  for (const role of Object.keys(DEFAULT_BRAND.fonts)) if (typeof fonts[role] === "string" && fonts[role].trim()) brand.fonts[role] = fonts[role].trim();
  return brand;
}

/**
 * Feature check for base-edit audio enhancement: an option of
 * recordingOptions() named like enhance / denoise / clean audio. When the
 * build has one, make turns it on; otherwise the base edit runs without it.
 */
export async function audioEnhancementFeature() {
  try {
    const { recordingOptions } = await import("../recording_workflow.js");
    const defaults = recordingOptions({});
    const option = Object.keys(defaults).find((key) => /enhanc|denois|clean_?audio|cleanaudio/i.test(key));
    return option ? { available: true, option, default: defaults[option] } : { available: false, reason: "this build's edit-recording has no audio enhancement option" };
  } catch (error) {
    return { available: false, reason: `edit-recording did not load: ${error.message}` };
  }
}

function nextStepFor(stage, error, ctx) {
  const project = ctx.project;
  const message = String(error?.message ?? error).split("\n")[0];
  if (error instanceof DemoReviewNeeded) return error.message;
  switch (stage) {
    case "model": return `Set OPENAI_API_KEY or ANTHROPIC_API_KEY (shell or .env), or pass --model provider:model. (${message})`;
    case "inventory": return `Check the --assets folder and that ffmpeg/ffprobe are installed (launchclip doctor). (${message})`;
    case "prepare": return `Fix the inputs (${message}) and run the same launchclip make command again; finished steps are reused.`;
    case "bible": return `The show bible was not frozen (${message}). Fix that and run the same launchclip make command again (the script and the voice are reused), or design the cast yourself: launchclip cast create, then launchclip bible freeze ${project}.`;
    case "storyboard": return `The model's storyboard did not pass the checks; see ${path.join(project, MAKE_PATHS.plan)} and storyboard.rejected.json. Run launchclip make again with --replan (or a stronger --model).`;
    case "subject": return `Check the presenter cut-out (launchclip doctor; launchclip subject probe ${path.join(project, ctx.subject?.src ?? MAKE_PATHS.base)}), or run launchclip make again with --no-subject. (${message})`;
    case "finish": return `See ${path.join(project, "finish.json")}; fix the failing stage and run launchclip finish ${project} (or launchclip make again; finished stages are reused).`;
    default: return `Run launchclip make again after fixing: ${message}`;
  }
}

// ---------------------------------------------------------------------------
// Summary

export function formatMakeSummary(report) {
  const lines = [`launchclip make: ${report.status} (${report.routing?.lane ?? "?"} lane, ${report.timings?.total ?? "?"}s)`];
  if (report.model) lines.push(`model: ${report.model.spec} (${report.model.source})`);
  for (const reason of report.routing?.reasons ?? []) lines.push(`route: ${reason}`);
  for (const [name, stage] of Object.entries(report.stages ?? {})) {
    lines.push(`  ${name.padEnd(10)} ${String(stage.status).padEnd(8)} ${String(report.timings?.[name] ?? 0).padStart(7)}s  ${stage.error ? stage.error.split("\n")[0] : stage.reason ?? ""}`.trimEnd());
  }
  if (report.repairs) lines.push(`storyboard: ${report.repairs.attempts?.length ?? "?"} attempt(s), ${report.repairs.used} repair pass(es)`);
  if (report.variety?.nearest !== undefined) {
    const varied = (report.variety.varied ?? []).map((change) => `${change.dial} → ${change.to}`).join(", ");
    lines.push(`variety: ${report.variety.passes ? "passed" : `${report.variety.findings.length} finding(s)`} against ${report.variety.entries} earlier video(s)${report.variety.nearest ? `, nearest ${report.variety.nearest.similarity}` : ""}${varied ? `; varied ${varied}` : ""}`);
  }
  if (report.subject) {
    const detail = report.subject.status === "usable" ? `${report.subject.framing ?? "?"} framing, ${report.subject.mattes?.length ?? 0} matte(s)` : report.subject.reason ?? report.subject.reasons?.join("; ") ?? "";
    lines.push(`subject: ${report.subject.status}${detail ? ` (${detail})` : ""}`);
  }
  if (report.gates) {
    lines.push("gates:");
    for (const [name, gate] of Object.entries(report.gates)) lines.push(`  ${name.padEnd(17)} ${gate.status}${gate.verdict ? ` (${gate.verdict})` : ""}${gate.error ? `  ${gate.error}` : ""}`);
  }
  lines.push(`cost: about $${(report.costs?.estimated_usd ?? 0).toFixed(4)}${report.costs?.complete ? "" : " (some calls could not be priced)"}`);
  if (report.final) lines.push(`video: ${path.join(report.project, report.final)}`);
  for (const warning of [...new Set(report.warnings ?? [])].slice(0, 12)) lines.push(`warning: ${warning}`);
  for (const step of report.next_steps ?? []) lines.push(`next: ${step}`);
  lines.push(`report: ${path.join(report.project, MAKE_PATHS.report)}`);
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Helpers

// One model call: its tokens, its price, and whether that price is a vendor
// fallback estimate (a model the rate table does not list).
function addCost(report, stage, model, result) {
  const usage = result?.usage ?? {};
  const estimate = result?.usage ? estimateModelUsageCost(model.provider, result.model ?? model.model, usage) : null;
  const usd = result?.cost_usd !== undefined ? result.cost_usd : estimate?.estimated_usd;
  report.costs.items.push({
    stage, provider: model.provider, model: result?.model ?? model.model,
    input_tokens: Number(usage.input_tokens ?? 0),
    cached_input_tokens: Number(usage.cached_tokens ?? usage.cached_input_tokens ?? 0),
    output_tokens: Number(usage.output_tokens ?? 0),
    reasoning_tokens: Number(usage.reasoning_tokens ?? 0),
    estimated_usd: usd ?? null,
    fallback: Boolean(estimate?.fallback)
  });
}

async function linkOrCopy(from, to, { replace = false } = {}) {
  await mkdir(path.dirname(to), { recursive: true });
  if (existsSync(to)) {
    if (!replace) {
      const [a, b] = await Promise.all([stat(from), stat(to)]);
      if (a.size === b.size && Math.abs(a.mtimeMs - b.mtimeMs) < 2000) return;
      if (a.ino === b.ino) return;
    }
    await rm(to, { force: true });
  }
  try { await link(from, to); } catch { await copyFile(from, to); }
}

async function fileHash(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function hashValue(value) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 24);
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

// A failed command's first line is only the command; the reason is in the
// lines after it (its stderr), so keep the first line and the last few.
export function errorSummary(error, { tail = 6, max = 1200 } = {}) {
  const lines = String(error ?? "").split("\n").map((line) => line.trimEnd()).filter(Boolean);
  const kept = lines.length <= tail + 1 ? lines : [lines[0], "…", ...lines.slice(-tail)];
  const text = kept.join("\n");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function round1(value) { return Math.round(value * 10) / 10; }
function round4(value) { return Math.round(value * 1e4) / 1e4; }


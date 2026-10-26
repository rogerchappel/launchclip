// launchclip make "<prompt>" [--assets dir]: a prompt and an optional folder
// of assets to a finished video, headless.
//
//   inventory → demo (--repo: demo autopilot) → route → prepare (base edit + presenter probe | voiceover prep | script + voice)
//     → storyboard (planner + repair loop) → subject (matte the planned ranges) → finish → critic → MAKE.json
//
// Every stage is resumable: ASSETS.json entries are reused while a file's size
// and mtime match, the script and storyboard while their inputs hash the same
// (--replan forces a new storyboard), voice takes come from the narration
// cache, the base edit from edit-recording's own cache, and finish reuses its
// stages, music lock and render segments. Lane routing is deterministic
// (src/make/routing.js); the model writes only the script and the storyboard.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_BRAND } from "../../kit/core/planning-prompt.mjs";
import { estimateModelUsageCost } from "../cost_tracker.js";
import { checkStoryboard, planStoryboard } from "../storyboard_planner.js";
import { directionJson } from "../../kit/core/direction.mjs";
import { profileForStory } from "../profile_store.js";
import { resolveStyleV2 } from "../style_store.js";
import { generateProjectStyle, projectSeedStyle, promptConstraints, promptTone, adoptStyleLook } from "../style_seed_store.js";
import { getVoiceProvider } from "../voice/index.js";
import { narrationDocument, narrationRequest, synthesizeNarration, voiceCacheDir } from "../voice/narrate.js";
import { inventoryAssets } from "./assets.js";
import { validateMakeOptions } from "./options.js";
import { routeLane } from "./routing.js";
import { createMakeClient, selectMakeModel } from "./models.js";
import { needsResize, RULES_HEADING, writeScript } from "./script.js";
import { checkScript } from "../script_check.js";
import { chooseScriptPlan, scriptPlanOptions } from "../../kit/core/script-formats.mjs";
import { runHeadlessCritic } from "./critic.js";
import { readProjectStory } from "../story_loader.js";
import { plannedSubjectRanges } from "../subject/plan.js";
import { fileProjectMatte, fileProjectTrack } from "../subject/project.js";
import { describeSource, runSubjectMatte, runSubjectProbe, runSubjectTrack } from "../subject/stage.js";
import { DemoReviewNeeded, demoManifestLines, stageDemo } from "./demo.js";
import { packCaptionsFor } from "../../kit/core/style.mjs";
import { COVER_PATH } from "../cover.js";
import { DEFAULT_VISUAL_HISTORY_LIMIT, DEFAULT_VISUAL_SIMILARITY_LIMIT, assessVariety, fingerprintStory, historyAvoid, historyPrompt, readHistoryIndex, recordHistoryEntry, varyStory } from "../visual_history.js";

export const MAKE_VERSION = "launchclip.make.v1";
export const MAKE_MAX_REPAIRS = 4;
export const MAKE_PATHS = Object.freeze({
  report: "MAKE.json",
  assets: "ASSETS.json",
  brief: "BRIEF.md",
  script: "SCRIPT.json",
  words: "NARRATION.json",
  story: "storyboard.json",
  direction: "DIRECTION.json",
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
 *   quality, out, replan, critic (true|false|undefined = auto), maxRepairs, cwd,
 *   repo, approveDemo, redemo, start, url, allowHost, demoPlan,
 *   subject (false: no presenter probe or subject effects), rules (a collection's
 *   RULES.md text: the script pass, the planner and the critic follow it),
 *   brandAssets (a collection's brand folder: its images, notes and brand.json join
 *   the assets under assets/collection-brand/),
 *   visualHistoryDir (the series' history index: plan against it, record into it),
 *   visualHistoryLimit (recent entries the planner sees, default 8),
 *   visualSimilarityLimit (the variety lint's limit, default 0.6)}
 * adapters: {env, client ({client, provider, model, vision}), transcribe,
 *   inventory, voiceProvider, normalizeVoice, prepareRecording,
 *   subject ({probe(src, options), matte(src, range, options)}), finish
 *   (runFinish replacement or adapters for it: finishAdapters), notice, now, clock}
 * Returns the MAKE.json report. Throws only on bad options; stage failures
 * are reported with status "failed" and a next step.
 */
export async function runMake(prompt, options = {}, adapters = {}) {
  const env = adapters.env ?? process.env;
  const notice = adapters.notice ?? ((line) => process.stderr.write(`${line}\n`));
  const now = adapters.now ?? (() => performance.now());
  const clock = adapters.clock ?? (() => new Date().toISOString());
  const text = String(prompt ?? "").trim();
  if (!text) throw new Error("launchclip make needs a prompt: launchclip make \"A 30-second launch video for …\" [--assets ./assets]");
  const { voice: voiceProvider, renderer, quality, script: scriptOptions } = validateMakeOptions(options);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const project = path.resolve(cwd, options.out ?? `launchclip-${slugify(text)}`);
  await mkdir(project, { recursive: true });
  const previousState = await readJson(path.join(project, MAKE_PATHS.state)) ?? {};
  const assetsDir = options.assets ? path.resolve(cwd, String(options.assets)) : previousState.assets_dir ?? null;
  const started = now();
  const report = {
    schema_version: MAKE_VERSION,
    status: "running",
    prompt: text,
    project,
    assets_dir: assetsDir,
    options: { aspect: options.aspect ?? null, duration: options.duration ?? null, style: options.style ?? null, seed: options.seed ?? null, profile: options.profile ?? null, voice: voiceProvider, voice_id: options.voiceId ?? null, music: options.music ?? null, renderer, quality, replan: Boolean(options.replan), critic: options.critic ?? "auto", visual_history_dir: options.visualHistoryDir ?? null, ...scriptOptions },
    model: null,
    routing: null,
    stages: {},
    timings: {},
    costs: { items: [], estimated_usd: 0, complete: true },
    repairs: null,
    gates: null,
    candidates: { status: "skipped", reason: "make skips cheap candidate renders in headless mode; the rendered-candidates receipt is only required by cinematic-check's phase-2 contract, which make does not declare" },
    critic: null,
    final: null,
    warnings: [],
    notices: [],
    next_steps: [],
    started_at: clock()
  };
  const say = (line) => { report.notices.push(line); notice(line); };
  const state = { ...previousState, assets_dir: assetsDir };
  const ctx = { project, env, adapters, options, report, state, say, voiceProvider, renderer, quality, text, assetsDir };

  const stages = [
    ["model", stageModel],
    ["inventory", stageInventory],
    ["demo", stageDemo],
    ["route", stageRoute],
    ["prepare", stagePrepare],
    ["storyboard", stageStoryboard],
    ["subject", stageSubject],
    ["finish", stageFinish],
    ["critic", stageCritic]
  ];
  for (const [name, fn] of stages) {
    const t0 = now();
    try {
      const result = await fn(ctx);
      report.stages[name] = { status: result?.status ?? "done", ...(result?.reason ? { reason: result.reason } : {}) };
    } catch (error) {
      report.stages[name] = { status: "failed", error: String(error?.message ?? error) };
      report.status = "failed";
      report.failed_stage = name;
      report.next_steps.unshift(nextStepFor(name, error, ctx));
    }
    report.timings[name] = round1((now() - t0) / 1000);
    await writeJson(path.join(project, MAKE_PATHS.state), state);
    if (report.status === "failed") break;
  }
  report.timings.total = round1((now() - started) / 1000);
  report.costs.estimated_usd = round4(report.costs.items.reduce((sum, item) => sum + (item.estimated_usd ?? 0), 0));
  report.costs.complete = report.costs.items.every((item) => item.estimated_usd != null);
  if (report.status !== "failed") {
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
    ctx.model = { ...createMakeClient(spec), spec, source };
  }
  report.model = { spec: ctx.model.spec, source: ctx.model.source, provider: ctx.model.provider, model: ctx.model.model, reasoning: ctx.model.reasoning ?? null, vision: Boolean(ctx.model.vision) };
  return { status: "done" };
}

async function stageInventory(ctx) {
  const { project, report, adapters, state, assetsDir } = ctx;
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
  const inventory = await (adapters.inventory ?? inventoryAssets)(assetsDir, {
    cache: cache?.dir === assetsDir ? cache : null,
    transcribe: adapters.transcribe ?? (async (file) => {
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
  inventory.entries.push(...brand);
  ctx.inventory = inventory;
  state.inventory = inventory.entries.map((entry) => [entry.path, entry.fingerprint]);
  await writeJson(path.join(project, MAKE_PATHS.assets), inventory);
  report.assets = { file: MAKE_PATHS.assets, counts: inventory.counts, ...(brand.length ? { brand_assets: brand.length } : {}) };
  return { status: "done" };
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
  const routing = routeLane(ctx.inventory, { aspect: options.aspect, duration: options.duration, prompt: text });
  ctx.routing = routing;
  report.routing = routing;
  for (const entry of routing.ignored) report.warnings.push(`${entry.path}: ${entry.reason}`);
  return { status: "done" };
}

async function stagePrepare(ctx) {
  const lane = ctx.routing.lane;
  if (lane === "footage-led") return prepareFootage(ctx);
  if (lane === "voiceover-motion") return prepareVoiceover(ctx);
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
  if (!words.length) throw new Error(`no transcript words for ${entry.path}; footage-led needs the recording's words (is local Whisper installed? run: launchclip doctor)`);
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

// Voiceover-motion: the supplied voiceover is prepared (pauses tightened,
// levelled, transcribed with word timings) into assets/audio/voiceover.wav.
async function prepareVoiceover(ctx) {
  const { project, routing, report, adapters, state } = ctx;
  const entry = ctx.inventory.entries.find((item) => item.path === routing.voiceover.path);
  const text = entry.transcript?.text?.trim();
  if (!text) throw new Error(`the voiceover ${entry.path} has no transcript; make needs its words (is local Whisper installed? run: launchclip doctor)`);
  const sourceFile = path.join(project, "assets", entry.path);
  const voiceFile = path.join(project, MAKE_PATHS.voiceover);
  const doc = path.join(project, MAKE_PATHS.words);
  const sourceHash = await fileHash(sourceFile);
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
      source: sourceFile
    });
    await writeJson(doc, narrationDocument(request, take));
  }
  ctx.words = take.words;
  ctx.narrationText = take.words.map((word) => word.text).join(" ");
  ctx.format = { ...routing.format, duration: round1(take.duration + 0.6) };
  ctx.audio = { voice: MAKE_PATHS.voiceover, words: MAKE_PATHS.words };
  report.script = { source: "voiceover", words: take.words.length, seconds: take.duration, note: "voiceover-motion: the supplied voiceover is the narration; no script pass" };
  state.prepare = { lane: "voiceover-motion", voiceover_hash: sourceHash };
  return { status: "done" };
}

// Motion: the script pass writes the narration, the script checks run on it
// (one repair pass on errors), the voice is synthesised (Kokoro by default;
// cached), and one resize pass runs when the measured take misses the target
// duration by more than 15%.
async function prepareMotion(ctx) {
  const { project, routing, report, state, options, voiceProvider } = ctx;
  const target = routing.format.duration;
  const notes = await notesText(ctx);
  const rules = rulesText(ctx);
  const assetLines = assetManifestLines(ctx).map((item) => item.line);
  // The planning pass: format, goal and awareness (flags, else the brief's defaults).
  const plan = chooseScriptPlan({ prompt: ctx.text, duration: target, aspect: routing.aspect, assets: ctx.inventory?.entries, ...scriptPlanOptions(options) });
  const scriptHash = hashValue({ prompt: ctx.text, notes, assets: assetLines, target, model: ctx.model.spec, voice: voiceProvider, ...(options.voiceId ? { voice_id: String(options.voiceId) } : {}), plan: [plan.format, plan.goal, plan.awareness], ...(rules ? { rules } : {}), v: 2 });
  let script = await readJson(path.join(project, MAKE_PATHS.script));
  const reuse = script && state.script?.hash === scriptHash && script.narration;
  if (!reuse) {
    ctx.say(`model: PAID call to ${ctx.model.provider} ${ctx.model.model} (script pass, ${plan.format}, about ${plan.word_target} words)`);
    const written = await writeScript({ client: ctx.model.client, model: ctx.model.model, provider: ctx.model.provider, prompt: ctx.text, notes, rules, assets: assetLines, duration: target, plan });
    addCost(report, "script", ctx.model, written);
    script = { ...written, passes: [{ kind: "write", words: written.word_count, cost_usd: written.cost_usd }] };
    const first = checkScript({ narration: script.narration, duration: target, brief: { prompt: ctx.text, notes, assets: assetLines }, format: plan.format, goal: plan.goal, awareness: plan.awareness });
    if (!first.ok) {
      ctx.say(`script: ${first.errors.length} script check error(s) (${[...new Set(first.errors.map((error) => error.id))].join(", ")}); one repair pass (PAID call to ${ctx.model.provider} ${ctx.model.model})`);
      const repaired = await writeScript({ client: ctx.model.client, model: ctx.model.model, provider: ctx.model.provider, prompt: ctx.text, notes, rules, assets: assetLines, duration: target, plan, repair: { previous: script.narration, errors: first.errors } });
      addCost(report, "script-repair", ctx.model, repaired);
      script = { ...repaired, passes: [...script.passes, { kind: "repair", words: repaired.word_count, errors: first.errors.map((error) => error.id), cost_usd: repaired.cost_usd }] };
    }
  }
  if (voiceProvider === "elevenlabs") ctx.say("voice: PAID ElevenLabs text-to-speech for the narration (cached per text in .launchclip/voice)");
  let take = await synthesize(ctx, script.narration);
  if (!reuse && needsResize(take.duration, target)) {
    ctx.say(`script: the take runs ${take.duration}s against a ${target}s target; one resize pass (PAID call to ${ctx.model.provider} ${ctx.model.model})`);
    const measuredWpm = take.words.length / Math.max(1, take.duration) * 60;
    const resized = await writeScript({ client: ctx.model.client, model: ctx.model.model, provider: ctx.model.provider, prompt: ctx.text, notes, rules, assets: assetLines, duration: target, plan, words: Math.max(8, Math.round(target * measuredWpm / 60)), resize: { previous: script.narration, measured_seconds: take.duration, measured_words: take.words.length } });
    addCost(report, "script-resize", ctx.model, resized);
    script = { ...resized, passes: [...(script.passes ?? []), { kind: "resize", words: resized.word_count, measured_seconds: take.duration, cost_usd: resized.cost_usd }] };
    take = await synthesize(ctx, script.narration);
  }
  script.take = { seconds: take.duration, words: take.words.length, wpm: Math.round(take.words.length / Math.max(0.1, take.duration) * 60), cached: Boolean(take.cached) };
  // The final narration's check is the receipt; errors left after the repair pass warn, they do not stop the render.
  script.check = checkScript({ narration: script.narration, duration: target, brief: { prompt: ctx.text, notes, assets: assetLines }, format: plan.format, goal: plan.goal, awareness: plan.awareness });
  if (!script.check.ok) report.warnings.push(`the script still fails ${script.check.errors.length} script check(s): ${script.check.errors.map((error) => `${error.id}: ${error.message}`).join("; ")} (launchclip script check ${MAKE_PATHS.script})`);
  await writeJson(path.join(project, MAKE_PATHS.script), script);
  state.script = { hash: scriptHash };
  ctx.script = script;
  ctx.words = take.words;
  ctx.narrationText = script.narration;
  ctx.format = { ...routing.format, duration: round1(take.duration + 0.8) };
  if (Math.abs(ctx.format.duration - target) > 0.5) report.warnings.push(`the narration runs ${take.duration}s, so the video is ${ctx.format.duration}s (target ${target}s)`);
  ctx.audio = { words: MAKE_PATHS.words };
  ctx.narration = { text: script.narration, provider: voiceProvider, ...(options.voiceId ? { voice: String(options.voiceId) } : {}) };
  report.script = { source: "model", file: MAKE_PATHS.script, title: script.title, words: script.word_count, target_words: plan.word_target, plan: script.plan ?? null, passes: script.passes?.length ?? 1, reused: Boolean(reuse), take: script.take, check: { ok: script.check.ok, errors: script.check.errors.map((error) => error.id), warnings: script.check.warnings.map((warning) => warning.id) } };
  if (options.duration == null && routing.duration_source === "default") report.warnings.push("no --duration and none named in the prompt; sized for 30 s");
  return { status: "done" };
}

async function synthesize(ctx, text) {
  const { project, adapters, voiceProvider } = ctx;
  const request = narrationRequest({ text, provider: voiceProvider, ...(ctx.options.voiceId ? { voice: String(ctx.options.voiceId) } : {}) });
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
  const { project, report, state, options, routing } = ctx;
  const style = await loadStyle(ctx);
  const brand = await loadBrand(ctx);
  const manifest = assetManifestLines(ctx);
  const brief = await composeBrief(ctx, manifest);
  await writeFile(path.join(project, MAKE_PATHS.brief), brief);
  const lane = routing.lane;
  const fixedAudio = { ...ctx.audio };
  const subject = ctx.subject?.probe ?? null;
  // The cadence profile the plan aims at (RFC §5.5): the style's, else the
  // shipped one for the routed lane, aspect, duration and platform.
  const { profile, reason: profileReason } = profileForStory({ lane, format: ctx.format }, { profile: options.profile ?? null, style: style?.pack ?? null, projectDir: project });
  report.profile = profile ? { id: profile.id, reason: profileReason, provenance: profile.provenance.kind } : null;
  const planHash = hashValue({ brief, lane, format: ctx.format, brand, audio: fixedAudio, base: ctx.base ?? null, style: style?.name ?? null, words: hashValue(ctx.words), model: ctx.model.spec, v: 2, profile: profile?.id ?? null, ...(subject ? { subject: { usable: subject.usable, framing: subject.framing } } : {}) });
  const storyFile = path.join(project, MAKE_PATHS.story);
  const directionFile = path.join(project, MAKE_PATHS.direction);
  // The history is left out of planHash: a rerun keeps its storyboard even
  // after other videos join the history (--replan plans against it afresh).
  const history = await loadHistory(ctx);
  if (!options.replan && state.plan?.hash === planHash && existsSync(storyFile) && (!state.plan.direction || existsSync(directionFile))) {
    report.repairs = state.plan.repairs ?? null;
    if (history) await lintVariety(ctx, await readJson(storyFile), style, history, state.plan.variety ?? []);
    return { status: "cached", reason: "plan inputs unchanged (pass --replan for a new storyboard)" };
  }
  const allowed = new Set([...manifest.map((item) => item.src), ...(ctx.base ? [ctx.base.src] : []), ...Object.values(fixedAudio).filter((value) => String(value).startsWith("assets/"))]);
  // Headless runs have no one to hand a near-miss to, so make allows more
  // repairs than story plan (each repair is one cheap call; the planner caps it at 5).
  const maxRepairs = options.maxRepairs === undefined ? MAKE_MAX_REPAIRS : Number(options.maxRepairs);
  // Footage-led overlays must sit on track 1+, which the structured tier
  // forbids (it bans scene.track), so footage-led plans at the guided tier.
  const tier = lane === "footage-led" ? "guided" : "structured";
  ctx.say(`model: PAID calls to ${ctx.model.provider} ${ctx.model.model} (direction map, then storyboard; up to ${maxRepairs} repair passes)`);
  const plan = await planStoryboard({
    brief,
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
    direction: true,
    profile,
    maxRepairs,
    ...(history?.prompt ? { history: history.prompt } : {}),
    extraCheck: (story) => assetErrors(story, allowed)
  });
  for (const attempt of plan.direction_attempts ?? []) addCost(report, `${attempt.kind}-${attempt.attempt}`, ctx.model, { cost_usd: attempt.cost_usd, usage: attempt.usage, model: attempt.model });
  for (const attempt of plan.attempts) addCost(report, `storyboard-${attempt.kind}-${attempt.attempt}`, ctx.model, { cost_usd: attempt.cost_usd, usage: attempt.usage, model: attempt.model });
  await writeJson(path.join(project, MAKE_PATHS.plan), { ...plan, brief: MAKE_PATHS.brief });
  report.repairs = { tier, used: plan.repairs_used, max: plan.max_repairs, valid_first_attempt: plan.valid_first_attempt, attempts: plan.attempts.map((attempt) => ({ attempt: attempt.attempt, kind: attempt.kind, ok: attempt.ok, errors: attempt.errors.slice(0, 12) })) };
  if (plan.status !== "passed") {
    if (plan.storyboard) await writeJson(path.join(project, "storyboard.rejected.json"), plan.storyboard);
    throw new Error(`the storyboard failed its checks after ${plan.attempts.length} attempt(s):\n- ${plan.errors.slice(0, 10).join("\n- ")}`);
  }
  const story = finalizeStory(plan.storyboard, ctx);
  // The look dials that would repeat the latest videos move to unused values
  // (never the ones a chosen style pack pins); the recheck covers the change.
  const varied = history ? varyStory(story, history.avoid, { seed: hashValue({ prompt: ctx.text, project }), style: style?.pack ?? null, locked: lockedDials(style, ctx) }).changes : [];
  const recheck = checkStoryboard(story, { words: ctx.words, tier, style: style?.pack ?? null, direction: plan.direction, profile, bandErrors: false });
  if (!recheck.ok) throw new Error(`the storyboard failed its checks after make filled in audio:\n- ${recheck.errors.slice(0, 10).join("\n- ")}`);
  await writeJson(storyFile, story);
  if (plan.direction) await writeFile(directionFile, directionJson(plan.direction));
  if (history) await lintVariety(ctx, story, style, history, varied);
  report.direction = plan.direction ? { file: MAKE_PATHS.direction, source: plan.direction_source, ...(plan.cadence ? { coverage: plan.cadence.coverage, face_time: plan.cadence.face_time, longest_undressed_seconds: plan.cadence.longest_undressed_seconds } : {}) } : null;
  state.plan = { hash: planHash, repairs: report.repairs, direction: Boolean(plan.direction), ...(history ? { variety: varied } : {}) };
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
  story.meta = { ...(story.meta ?? {}), made_by: "launchclip make", prompt: ctx.text };
  return story;
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
  const finishOptions = { renderer: ctx.renderer, quality: ctx.quality, ...(options.music != null ? { music: String(options.music).toLowerCase() } : {}) };
  const musicNote = options.music != null ? `--music ${options.music}` : ctx.routing.music ? `the supplied track assets/${ctx.routing.music.path}` : (ctx.env.ELEVENLABS_API_KEY ? "ElevenLabs (ELEVENLABS_API_KEY is set; PAID unless the music lock or cache has the track)" : "the synth bed (no ELEVENLABS_API_KEY)");
  ctx.say(`finish: voice, captions, sound, render (${ctx.renderer}, ${ctx.quality}), master, evidence, gates; music: ${musicNote}`);
  const finishAdapters = { env: ctx.env, notice: ctx.say, ...(adapters.finishAdapters ?? {}) };
  if (adapters.voiceProvider) finishAdapters.voiceProvider = adapters.voiceProvider;
  if (adapters.normalizeVoice) finishAdapters.normalizeVoice = adapters.normalizeVoice;
  const run = adapters.finish ?? (await import("../finish.js")).runFinish;
  const finish = await run(project, finishOptions, finishAdapters);
  ctx.finish = finish;
  report.finish = { status: finish.status, report: "finish.json", seconds: finish.seconds, stages: finish.stages.map((stage) => ({ name: stage.name, status: stage.status, seconds: stage.seconds, ...(stage.error ? { error: stage.error.split("\n")[0] } : {}) })) };
  report.gates = Object.fromEntries(Object.entries(finish.gates ?? {}).map(([name, gate]) => [name, { status: gate.status, ...(gate.error ? { error: String(gate.error).split("\n")[0] } : {}), ...(gate.reason ? { reason: gate.reason } : {}) }]));
  if (ctx.baseEditQa) report.gates.base_edit_qa = ctx.baseEditQa;
  report.final = finish.final ? path.relative(project, finish.final) : null;
  // finish wrote publish.json (and the cover) with SCRIPT.json's titles.
  if (finish.publish) report.publish = finish.publish;
  report.warnings.push(...(finish.warnings ?? []));
  const sound = finish.stages.find((stage) => stage.name === "sound");
  const musicCost = Number(sound?.details?.music?.cost_usd ?? sound?.details?.music_cost_usd);
  if (Number.isFinite(musicCost) && musicCost > 0 && !sound?.details?.music?.cached) report.costs.items.push({ stage: "music", provider: "elevenlabs", estimated_usd: musicCost });
  if (finish.status === "failed") {
    const failed = finish.stages.find((stage) => stage.status === "failed");
    throw new Error(`finish failed at the ${failed?.name ?? "unknown"} stage: ${String(failed?.error ?? "").split("\n")[0]}`);
  }
  return { status: "done" };
}

async function stageCritic(ctx) {
  const { project, report, options } = ctx;
  const wanted = options.critic === true || (options.critic !== false && ctx.model.vision);
  const pending = (reason) => {
    report.critic = { status: "pending", reason };
    if (report.gates?.critic) report.gates.critic = { status: "pending", reason };
    report.next_steps.push(`Critic pending (${reason}): have a fresh-context critic review qa/critic-sheets/ and write qa/critic.json, then run launchclip cinematic-check ${project} --renderer ${ctx.renderer} --video ${report.final ?? "renders/draft.mp4"} --expect-audio`);
    return { status: "skipped", reason };
  };
  if (options.critic === false) return pending("--no-critic");
  if (!wanted) return pending(`${ctx.model.spec} is not configured as vision-capable in make (the Anthropic adapter sends text only)`);
  if (!ctx.model.vision) return pending(`${ctx.model.spec} cannot take images`);
  ctx.say(`model: PAID call to ${ctx.model.provider} ${ctx.model.model} (headless critic over qa/critic-sheets/)`);
  const quality = ctx.finish?.gates?.coverage?.findings ?? [];
  const result = await (ctx.adapters.critic ?? runHeadlessCritic)({ project, client: ctx.model.client, model: ctx.model.model, provider: ctx.model.provider, quality, rules: rulesText(ctx) });
  if (result.cost_usd !== undefined) addCost(report, "critic", ctx.model, { cost_usd: result.cost_usd, usage: result.usage, model: result.model });
  if (result.status !== "written") return pending(result.reason ?? "the critic did not run");
  report.critic = { status: "written", file: "qa/critic.json", verdict: result.verdict, findings: result.findings, reviewed: result.reviewed, unreviewed: result.unreviewed, warnings: result.warnings, model: result.model, note: "headless model critic over contact sheets; a human or fresh-agent review is still the definition of done" };
  if (report.gates) report.gates.critic = { status: result.verdict === "ship" ? "passed" : "failed", verdict: result.verdict, findings: result.findings, source: "qa/critic.json (headless)" };
  if (result.verdict !== "ship") report.next_steps.push(`The headless critic asked for ${result.verdict} (${result.findings} finding${result.findings === 1 ? "" : "s"} in qa/critic.json): edit storyboard.json scenes, then run launchclip finish ${project} --scene <id>, or launchclip make again with --replan`);
  return { status: "done" };
}

// ---------------------------------------------------------------------------
// Brief, manifest and checks

/** Every file the storyboard may reference: [{src, kind, line}]. */
export function assetManifestLines(ctx) {
  const routing = ctx.routing;
  const out = [];
  const lane = routing.lane;
  for (const item of routing.media) {
    const src = `assets/${item.path}`;
    const size = item.width && item.height ? `${item.width}×${item.height}` : "unknown size";
    const use = lane === "footage-led"
      ? `a full-frame insert that covers the speaker: {"module": "media-window", "insert": true, "params": {"title": "…", "media": {"kind": "${item.kind}", "src": "${src}"}}} (insert is a scene key, never inside params; no track)`
      : `a media-window scene with params.media {kind: "${item.kind}", src: "${src}"${item.kind === "video" ? ", sourceStart?" : ""}}`;
    out.push({ src, kind: item.kind, line: `${src} — ${item.kind}, ${item.role}, ${size}${item.duration ? `, ${item.duration}s` : ""}: ${item.description}. Use as ${use}.` });
  }
  out.push(...demoManifestLines(ctx));
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
  if (lane === "motion") lines.push("## Narration (already synthesised; the word timings are given, so time scenes to its words)", "", ctx.narrationText, "");
  if (lane === "motion" && ctx.script?.beats?.length) lines.push(`## Script beats (${ctx.script.plan?.format ?? "script"}, ${ctx.script.plan?.skeleton ?? "skeleton"}; follow them in order)`, "", ...ctx.script.beats.map((entry) => `- ${entry.beat}: ${entry.text}`), "");
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
export function assetErrors(story, allowed) {
  const errors = [];
  const visit = (value, where) => {
    if (typeof value === "string") {
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

function addCost(report, stage, model, result) {
  let usd = result?.cost_usd;
  if (usd === undefined && result?.usage) usd = estimateModelUsageCost(model.provider, result.model ?? model.model, result.usage).estimated_usd;
  report.costs.items.push({ stage, provider: model.provider, model: result?.model ?? model.model, input_tokens: Number(result?.usage?.input_tokens ?? 0), output_tokens: Number(result?.usage?.output_tokens ?? 0), estimated_usd: usd ?? null });
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

function round1(value) { return Math.round(value * 10) / 10; }
function round4(value) { return Math.round(value * 1e4) / 1e4; }


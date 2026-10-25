import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { deriveBoundaries, resolveStory, storyFormat, storyHits, validateStory as validateStoryShape } from "./story.js";
import { knownModules, resolveModule, subjectDensityWarnings } from "../kit/core/modules.mjs";
import { validateCastCues } from "../kit/core/characters/cues.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";
import { getRenderer } from "./renderers/index.js";
import { remotionInvocation, COMPOSITION_ID } from "./renderers/remotion.js";
import { captureCommand, runCommand } from "./renderers/command.js";
import { createPlannerClient, planStoryboard } from "./storyboard_planner.js";
import { DEFAULT_BRAND } from "../kit/core/planning-prompt.mjs";
import { readStoryEdl } from "./story_loader.js";
import { readStorySubject, readStoryTrack } from "./subject/project.js";
import { applyProjectStyle } from "./story_style.js";
import { resolveStyleV2 } from "./style_store.js";
import { DIRECTION_FILE, DIRECTION_LANES, directionJson, directionMeasures, validateDirection } from "../kit/core/direction.mjs";
import { compareMeasures } from "../kit/core/profiles.mjs";
import { profileForStory } from "./profile_store.js";

const UNKNOWN_MODULE = /\.module "[^"]+" is not a known module$/;

// Validation against the kit's module registry. An unknown module is a
// warning here: both compilers render it as a labelled placeholder.
export function validateStory(story) {
  const result = validateStoryShape(story, { modules: knownModules() });
  const unknown = result.errors.filter((message) => UNKNOWN_MODULE.test(message));
  const errors = result.errors.filter((message) => !UNKNOWN_MODULE.test(message));
  return { ok: errors.length === 0, errors, warnings: [...result.warnings, ...unknown.map((message) => `${message} in this kit; it renders as a placeholder`)] };
}

// Resolves every known-module scene of a resolved story through the kit's
// module registry, the step both compilers take. A scene whose params do not
// resolve renders as a placeholder in both renderers, so validation reports it
// as an error instead of letting it pass. Unknown modules stay warnings above.
export function moduleParamErrors(resolved) {
  const known = new Set(knownModules());
  const errors = [];
  for (const scene of Array.isArray(resolved?.scenes) ? resolved.scenes : []) {
    if (!scene || scene.module === "custom" || !known.has(scene.module)) continue;
    try { resolveModule(scene, resolved); }
    catch (error) { errors.push(`${error.message} (both renderers would draw a placeholder)`); }
  }
  return errors;
}

// launchclip story <validate|resolve> <storyboard.json> [--narration NARRATION.json] [--beats BEATS.json] [--out file]
/**
 * The map beside a story: DIRECTION.json beside storyboard.json, or
 * <name>.DIRECTION.json beside a loose <name>.story.json.
 */
export function directionFileFor(storyFile) {
  const base = path.basename(storyFile);
  if (base === "storyboard.json") return path.join(path.dirname(storyFile), DIRECTION_FILE);
  return path.join(path.dirname(storyFile), `${base.replace(/(\.story)?\.json$/i, "")}.${DIRECTION_FILE}`);
}

/**
 * The direction-map check `story validate` runs. A missing map is an error in
 * the narrated lanes when the story has narration words, a warning without
 * them. → {errors, warnings, summary, profileDoc}
 */
export async function checkStoryDirection({ story, resolved = null, words = null, storyDir, storyFile = null, flag = null, style = null }) {
  const errors = [];
  const warnings = [];
  const file = flag && flag !== true ? path.resolve(String(flag)) : directionFileFor(storyFile ?? path.join(storyDir, "storyboard.json"));
  const needed = DIRECTION_LANES.includes(story?.lane);
  let profileDoc = null;
  let picked = null;
  if (!(await exists(file))) {
    if (needed && story?.audio?.words) errors.push(`direction: the ${story.lane} lane needs ${DIRECTION_FILE} beside the storyboard: every narration line with an intent and a treatment (see references/direction-map.md)`);
    else if (needed) warnings.push(`direction: no ${DIRECTION_FILE}; write one before the storyboard when the story has narration (references/direction-map.md)`);
    try { picked = profileForStory(resolved ?? story, { style }); profileDoc = picked.profile; } catch { profileDoc = null; }
    return { errors, warnings, summary: needed ? { file: null, status: errors.length ? "missing" : "absent", profile: profileDoc?.id ?? null } : null, profileDoc };
  }
  const map = await readJson(file, DIRECTION_FILE);
  try { picked = profileForStory(resolved ?? story, { direction: map, style }); profileDoc = picked.profile; }
  catch (error) { errors.push(`direction: ${error.message}`); }
  // Narrative lines' cast and set cues: the character kit's check (kit/core/characters/cues.mjs).
  const check = validateDirection(map, { words: words ?? [], story: resolved, lane: story?.lane, cast: story?.cast ?? map.cast ?? null, validateCast: validateCastCues, ...(style?.segments ? { segments: style.segments } : {}) });
  errors.push(...check.errors.map((entry) => `direction: ${entry}`));
  warnings.push(...check.warnings.map((entry) => `direction: ${entry}`));
  if (!words) warnings.push("direction: no narration words, so the map's lines were not checked against them");
  let measures = null;
  let bands = [];
  if (check.ok && resolved && words?.length) {
    measures = directionMeasures(map, resolved, { words });
    if (profileDoc) bands = compareMeasures(measures, profileDoc);
    // The attention-reset ceiling is structural (long form): an error, fixed by launchclip story long-form.
    for (const band of bands) {
      if (band.status === "inside") continue;
      if (band.measure === "longest_without_reset_seconds") errors.push(`cadence: ${band.detail} (profile ${profileDoc.id}); change the layout, make a line an insert or add a section card in the longest run (launchclip story long-form places them)`);
      else warnings.push(`cadence: ${band.detail} (profile ${profileDoc.id})`);
    }
    for (const line of measures.missed) warnings.push(`direction: words [${line.words.join(", ")}] (${line.intent}) call for a visual but play on the ${line.treatment === "face" ? "presenter" : "camera"} alone: a missed opportunity unless the why says otherwise`);
  }
  return {
    errors,
    warnings,
    profileDoc,
    summary: {
      file,
      status: check.ok ? "valid" : "invalid",
      profile: profileDoc?.id ?? null,
      profile_reason: picked?.reason ?? null,
      lines: map.sections?.reduce((sum, section) => sum + (section.lines?.length ?? 0), 0) ?? 0,
      ...(measures ? { coverage: measures.coverage, face_time: measures.face_time, longest_undressed_seconds: measures.longest_undressed_seconds, missed: measures.missed.length, bands: bands.map(({ measure, status, value, band }) => ({ measure, status, value, band })) } : {})
    }
  };
}

// launchclip story compile <project> --renderer hyperframes|remotion [--out dir]
// launchclip story plan --brief brief.md [...] (see planStoryCommand)
// Without --narration, audio.words is read relative to the story file when it exists.
export async function runStoryCommand(action, storyPath, flags = {}, adapters = {}) {
  if (!new Set(["validate", "resolve", "compile", "plan", "long-form"]).has(action)) throw new Error(`Unknown story action: ${action}; use validate, resolve, compile, plan or long-form`);
  if (action === "compile") return compileStoryCommand(storyPath, flags);
  if (action === "long-form") return (await import("./long_form.js")).runLongFormCommand(storyPath, flags);
  if (action === "plan") return planStoryCommand(flags, adapters);
  const file = path.resolve(storyPath);
  const styled = await applyProjectStyle(await readJson(file, "story.json"), { projectDir: path.dirname(file) });
  const story = styled.story;
  const words = await loadWords(flags.narration, story, path.dirname(file));
  const beats = flags.beats ? await readJson(path.resolve(flags.beats), "BEATS.json") : null;
  const validation = validateStory(story);

  if (action === "validate") {
    const errors = [...validation.errors];
    let boundaries = null;
    let resolvedChecked = false;
    let resolvedStory = null;
    if (validation.ok && (words || beats || !usesAnchors(story))) {
      try {
        const resolved = resolveStory(story, { words: words?.list ?? [], beats, edl: await readStoryEdl(path.dirname(file), story), subject: await readStorySubject(path.dirname(file), story), track: await readStoryTrack(path.dirname(file), story) });
        const second = validateStory(resolved);
        errors.push(...second.errors.filter((entry) => !errors.includes(entry)));
        // Gaps between anchored scenes are only known once times resolve.
        for (const warning of second.warnings) if (warning.startsWith("empty plate") && !validation.warnings.includes(warning)) validation.warnings.push(warning);
        if (second.ok) {
          boundaries = deriveBoundaries(resolved);
          errors.push(...moduleParamErrors(resolved));
          resolvedStory = resolved;
        }
        resolvedChecked = true;
      } catch (error) {
        errors.push(error.message);
      }
    }
    // The direction map (RFC §6): required in the narrated lanes, checked
    // against the narration and the resolved storyboard, and measured
    // against the cadence profile.
    const direction = await checkStoryDirection({ story, resolved: resolvedStory, words: words?.list ?? null, storyDir: path.dirname(file), storyFile: file, flag: flags.direction, style: styled.style });
    errors.push(...direction.errors.filter((entry) => !errors.includes(entry)));
    validation.warnings.push(...direction.warnings);
    if (resolvedStory) for (const warning of subjectDensityWarnings(resolvedStory, { profile: direction.profileDoc })) if (!validation.warnings.includes(warning)) validation.warnings.push(warning);
    const result = {
      stage: "story",
      action,
      status: errors.length ? "failed" : "passed",
      story: file,
      narration: words?.file ?? null,
      anchors_resolved: resolvedChecked,
      errors,
      warnings: [...(styled.style?.warnings ?? []), ...validation.warnings],
      style: styled.style ? { name: styled.style.name, source: styled.style.source, file: styled.style.file, applied: styled.style.applied } : null,
      direction: direction.summary,
      boundaries
    };
    if (flags.out) {
      await writeJson(flags.out, result);
      return { ...result, out: path.resolve(flags.out) };
    }
    return result;
  }

  if (!validation.ok) throw new Error(`story.json is invalid:\n- ${validation.errors.join("\n- ")}`);
  const resolved = resolveStory(story, { words: words?.list ?? [], beats, edl: await readStoryEdl(path.dirname(file), story), subject: await readStorySubject(path.dirname(file), story), track: await readStoryTrack(path.dirname(file), story) });
  const check = validateStory(resolved);
  if (!check.ok) throw new Error(`resolved story is invalid:\n- ${check.errors.join("\n- ")}`);
  if (flags.out) await writeJson(flags.out, resolved);
  return {
    stage: "story",
    action,
    status: "resolved",
    story: file,
    narration: words?.file ?? null,
    out: flags.out ? path.resolve(flags.out) : null,
    format: storyFormat(resolved),
    resolved: resolved.resolved,
    warnings: [...validation.warnings, ...subjectDensityWarnings(resolved)],
    boundaries: deriveBoundaries(resolved),
    hits: storyHits(resolved),
    ...(flags.out ? {} : { story_resolved: resolved })
  };
}

// launchclip story compile <project> --renderer hyperframes|remotion [--out path]
export async function compileStoryCommand(target, flags = {}, { run = runCommand } = {}) {
  const renderer = String(flags.renderer ?? "").toLowerCase();
  if (!new Set(["hyperframes", "remotion"]).has(renderer)) throw new Error("story compile needs --renderer hyperframes or --renderer remotion");
  const input = path.resolve(target);
  const isFile = (await stat(input).catch(() => { throw new Error(`Cannot read story project: ${input}`); })).isFile();
  const project = isFile ? path.dirname(input) : input;
  const storyFile = isFile ? input : path.join(project, "storyboard.json");
  const styled = await applyProjectStyle(await readJson(storyFile, "storyboard.json"), { projectDir: project });
  const story = styled.story;
  const words = await loadWords(flags.narration, story, project) ?? await loadWords(await existsFile(path.join(project, "NARRATION.json")) ? path.join(project, "NARRATION.json") : null, story, project);
  const beatsFile = flags.beats ? path.resolve(flags.beats) : path.join(project, "BEATS.json");
  const beats = flags.beats || await existsFile(beatsFile) ? await readJson(beatsFile, "BEATS.json") : null;
  const validation = validateStory(story);
  if (!validation.ok) throw new Error(`storyboard.json is invalid:\n- ${validation.errors.join("\n- ")}`);
  const resolved = resolveStory(story, { words: words?.list ?? [], beats, edl: await readStoryEdl(project, story), subject: await readStorySubject(project, story), track: await readStoryTrack(project, story) });
  const check = validateStory(resolved);
  if (!check.ok) throw new Error(`resolved story is invalid:\n- ${check.errors.join("\n- ")}`);
  const base = { stage: "story", action: "compile", renderer, story: storyFile, project, format: storyFormat(resolved), boundaries: deriveBoundaries(resolved) };

  if (renderer === "hyperframes") {
    const out = path.resolve(flags.out ?? path.join(project, "hyperframes"));
    const result = await compileStoryToHyperFrames(resolved, { projectDir: out, sourceDir: project });
    return { ...base, status: "compiled", out, entry: path.join(out, "index.html"), composition_id: result.compositionId, files: result.files, warnings: [...validation.warnings.filter((message) => !/is not a known module in this kit/.test(message)), ...result.warnings] };
  }

  const propsFile = path.resolve(flags.out ?? path.join(project, ".launchclip", "story.resolved.json"));
  await writeJson(propsFile, resolved);
  const adapter = getRenderer("remotion");
  const entry = adapter.resolveEntry(project, { entry: flags.entry });
  const invocation = remotionInvocation(adapter.compositionsArgs({ entry, propsFile, project }));
  const listing = await captureCommand(run, invocation.command, invocation.args, { cwd: path.resolve(import.meta.dirname, "..") });
  const text = typeof listing.stdout === "string" ? listing.stdout : JSON.stringify(listing.stdout ?? "");
  const listed = listing.ok && text.split(/\s+/).includes(COMPOSITION_ID);
  if (!listed) throw new Error(`remotion compositions did not list ${COMPOSITION_ID} (exit ${listing.exit_code}):\n${String(listing.stderr || text).trim().split("\n").slice(-12).join("\n")}`);
  return { ...base, status: "compiled", out: propsFile, entry, composition_id: COMPOSITION_ID, compositions: text.split(/\s+/).filter(Boolean), files: [path.relative(project, propsFile)], warnings: validation.warnings };
}

// launchclip story plan --brief brief.md [--narration NARRATION.json] [--tier structured]
//   [--model provider:model] [--out storyboard.json] [--base assets/…] [--voice assets/…]
//   [--format WxH] [--fps n] [--duration s] [--brand brand.json] [--max-repairs n]
// The lane follows the inputs (RFC §3): --base → footage-led, --narration →
// voiceover-motion, otherwise motion. adapters.client replaces the model client.
export async function planStoryCommand(flags = {}, adapters = {}) {
  if (!flags.brief || flags.brief === true) throw new Error("story plan needs --brief <brief.md>");
  const briefFile = path.resolve(String(flags.brief));
  let brief;
  try { brief = await readFile(briefFile, "utf8"); } catch { throw new Error(`Cannot read brief: ${briefFile}`); }
  const out = path.resolve(String(flags.out ?? "storyboard.json"));
  const outDir = path.dirname(out);
  const narrationFile = flags.narration ? path.resolve(String(flags.narration)) : null;
  const words = narrationFile ? await loadWords(narrationFile, null, outDir) : null;
  const lane = String(flags.lane ?? (flags.base ? "footage-led" : words ? "voiceover-motion" : "motion"));
  const format = planFormat(flags, words?.list ?? []);
  const warnings = [];
  // --style <name|path>: plan for a channel style pack (its preferences,
  // avoid list and caption preset go into the prompt; the storyboard names it).
  const style = flags.style && flags.style !== true ? await resolveStyleV2(String(flags.style), { projectDir: outDir }) : null;
  if (style) warnings.push(...style.warnings);
  const brand = flags.brand ? await readJson(path.resolve(String(flags.brand)), "brand.json") : style ? undefined : DEFAULT_BRAND;
  const audio = {};
  if (words) {
    const relative = path.relative(outDir, words.file).split(path.sep).join("/");
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) audio.words = relative;
    else {
      audio.words = "NARRATION.json";
      warnings.push(`${words.file} is outside the storyboard's folder; audio.words is set to NARRATION.json, so copy the narration there`);
    }
    audio.voice = String(flags.voice ?? "assets/audio/narration.wav");
  } else if (flags.voice) audio.voice = String(flags.voice);
  const modelSpec = flags.model ?? process.env.LAUNCHCLIP_PLANNER_MODEL ?? null;
  const client = adapters.client ?? createPlannerClient(modelSpec, adapters.clientOptions ?? {}).client;
  const maxRepairs = flags["max-repairs"] === undefined ? undefined : Number(flags["max-repairs"]);
  // Footage-led: probe the presenter so the prompt offers subject effects only
  // when the cut-out works (as make and the skills do). A missing model or
  // runtime is a warning; --no-subject skips it.
  let subject = null;
  if (lane === "footage-led" && flags.base && !flags["no-subject"]) {
    try {
      const probe = adapters.subjectProbe ?? (await import("./subject/stage.js")).runSubjectProbe;
      const { probe: result } = await probe(path.resolve(outDir, String(flags.base)), { cacheDir: path.join(outDir, ".launchclip", "subject") });
      subject = { usable: result.usable, reasons: result.reasons, framing: result.framing, headroom: result.headroom, head: result.head, people: result.people };
    } catch (error) {
      warnings.push(`presenter probe skipped (${String(error?.message ?? error).split("\n")[0]}); planning without subject effects. Run launchclip doctor`);
    }
  }
  // The cadence profile the plan aims at (RFC §5.5): --profile, the style's,
  // else the shipped one for the lane, aspect, duration and platform.
  const { profile: cadence } = profileForStory({ lane, format }, { profile: flags.profile && flags.profile !== true ? String(flags.profile) : null, style: style?.pack ?? null, projectDir: outDir });
  const report = await planStoryboard({
    brief,
    words: words?.list ?? null,
    direction: !flags["no-direction"],
    profile: cadence,
    lane,
    format,
    brand,
    tier: String(flags.tier ?? "structured"),
    model: modelSpec,
    client,
    audio,
    base: flags.base ? String(flags.base) : null,
    style: style?.pack ?? null,
    subject,
    ...(maxRepairs === undefined ? {} : { maxRepairs })
  });
  const reportFile = path.join(outDir, ".launchclip", "storyboard-plan.json");
  await writeJson(reportFile, { ...report, brief: briefFile, narration: words?.file ?? null, out });
  const summary = {
    stage: "story",
    action: "plan",
    status: report.status,
    tier: report.tier,
    lane: report.lane,
    style: style ? { name: style.name, source: style.source, file: style.file } : null,
    subject: subject ? { usable: subject.usable, framing: subject.framing, ...(subject.usable ? {} : { reasons: subject.reasons }) } : null,
    profile: report.profile,
    direction: report.direction ? { out: path.join(outDir, DIRECTION_FILE), source: report.direction_source, attempts: report.direction_attempts.length, ...(report.cadence ? { coverage: report.cadence.coverage, face_time: report.cadence.face_time, longest_undressed_seconds: report.cadence.longest_undressed_seconds } : {}) } : null,
    model: report.model,
    out: report.status === "passed" ? out : null,
    report: reportFile,
    valid_first_attempt: report.valid_first_attempt,
    repairs_used: report.repairs_used,
    attempts: report.attempts.map((entry) => ({ attempt: entry.attempt, kind: entry.kind, ok: entry.ok, errors: entry.errors.length, layout_errors: entry.layout.errors, layout_warnings: entry.layout.warnings })),
    usage: report.usage,
    cost: report.cost,
    warnings: [...warnings, ...report.warnings]
  };
  if (report.status === "passed") {
    await writeJson(out, report.storyboard);
    if (report.direction) await writeFile(path.join(outDir, DIRECTION_FILE), directionJson(report.direction));
    return summary;
  }
  let rejected = null;
  if (report.storyboard) {
    rejected = out.replace(/\.json$/i, "") + ".rejected.json";
    await writeJson(rejected, report.storyboard);
  }
  const error = new Error(`story plan failed after ${report.attempts.length} attempt(s):\n- ${report.errors.join("\n- ")}\nReport: ${reportFile}${rejected ? `\nLast candidate: ${rejected}` : ""}`);
  error.result = summary;
  throw error;
}

function planFormat(flags, words) {
  let width = 1080, height = 1920;
  if (flags.format) {
    const named = { shorts: [1080, 1920], portrait: [1080, 1920], landscape: [1920, 1080], square: [1080, 1080] }[String(flags.format).toLowerCase()];
    const match = /^(\d+)x(\d+)$/i.exec(String(flags.format));
    if (named) [width, height] = named;
    else if (match) [width, height] = [Number(match[1]), Number(match[2])];
    else throw new Error(`--format must be WIDTHxHEIGHT (e.g. 1080x1920) or shorts, landscape or square; got ${flags.format}`);
  }
  const fps = flags.fps === undefined ? 30 : Number(flags.fps);
  if (!Number.isInteger(fps) || fps <= 0) throw new Error("--fps must be a positive integer");
  let duration = flags.duration === undefined ? null : Number(flags.duration);
  if (duration !== null && !(duration > 0)) throw new Error("--duration must be a positive number of seconds");
  if (duration === null) {
    const last = Math.max(0, ...words.map((entry) => Number(entry?.end ?? entry?.start)).filter(Number.isFinite));
    duration = last > 0 ? Math.ceil((last + 0.6) * 10) / 10 : 30;
  }
  const format = { width, height, fps, duration };
  if (height > width && duration <= 60) format.platform = "youtube-shorts";
  return format;
}

async function existsFile(file) {
  try { return (await stat(file)).isFile(); } catch { return false; }
}

async function loadWords(flag, story, storyDir) {
  let file = flag ? path.resolve(flag) : null;
  if (!file && typeof story?.audio?.words === "string") {
    const candidate = path.resolve(storyDir, story.audio.words);
    if (await exists(candidate)) file = candidate;
  }
  if (!file) return null;
  const data = await readJson(file, "NARRATION.json");
  const list = Array.isArray(data) ? data : Array.isArray(data?.words) ? data.words : null;
  if (!list) throw new Error(`${file} has no words array`);
  return { file, list };
}

function usesAnchors(story) {
  const values = [];
  for (const scene of Array.isArray(story?.scenes) ? story.scenes : []) {
    values.push(scene?.start, scene?.end, ...(Array.isArray(scene?.hits) ? scene.hits.map((hit) => hit?.at) : []));
  }
  for (const overlay of Array.isArray(story?.overlays) ? story.overlays : []) values.push(overlay?.start, overlay?.end);
  return values.some((value) => typeof value === "string" && /^(word|beat|downbeat):/.test(value.trim()));
}

async function exists(file) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file, label) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new Error(`Cannot read ${label}: ${file}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON (${file}): ${error.message}`);
  }
}

async function writeJson(file, value) {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

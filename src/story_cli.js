import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { deriveBoundaries, resolveStory, storyFormat, storyHits, validateStory as validateStoryShape } from "./story.js";
import { knownModules, resolveModule } from "../kit/core/modules.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";
import { getRenderer } from "./renderers/index.js";
import { remotionInvocation, COMPOSITION_ID } from "./renderers/remotion.js";
import { captureCommand, runCommand } from "./renderers/command.js";

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
// launchclip story compile <project> --renderer hyperframes|remotion [--out dir]
// Without --narration, audio.words is read relative to the story file when it exists.
export async function runStoryCommand(action, storyPath, flags = {}) {
  if (!new Set(["validate", "resolve", "compile"]).has(action)) throw new Error(`Unknown story action: ${action}; use validate, resolve or compile`);
  if (action === "compile") return compileStoryCommand(storyPath, flags);
  const file = path.resolve(storyPath);
  const story = await readJson(file, "story.json");
  const words = await loadWords(flags.narration, story, path.dirname(file));
  const beats = flags.beats ? await readJson(path.resolve(flags.beats), "BEATS.json") : null;
  const validation = validateStory(story);

  if (action === "validate") {
    const errors = [...validation.errors];
    let boundaries = null;
    let resolvedChecked = false;
    if (validation.ok && (words || beats || !usesAnchors(story))) {
      try {
        const resolved = resolveStory(story, { words: words?.list ?? [], beats });
        const second = validateStory(resolved);
        errors.push(...second.errors.filter((entry) => !errors.includes(entry)));
        if (second.ok) {
          boundaries = deriveBoundaries(resolved);
          errors.push(...moduleParamErrors(resolved));
        }
        resolvedChecked = true;
      } catch (error) {
        errors.push(error.message);
      }
    }
    const result = {
      stage: "story",
      action,
      status: errors.length ? "failed" : "passed",
      story: file,
      narration: words?.file ?? null,
      anchors_resolved: resolvedChecked,
      errors,
      warnings: validation.warnings,
      boundaries
    };
    if (flags.out) {
      await writeJson(flags.out, result);
      return { ...result, out: path.resolve(flags.out) };
    }
    return result;
  }

  if (!validation.ok) throw new Error(`story.json is invalid:\n- ${validation.errors.join("\n- ")}`);
  const resolved = resolveStory(story, { words: words?.list ?? [], beats });
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
    warnings: validation.warnings,
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
  const story = await readJson(storyFile, "storyboard.json");
  const words = await loadWords(flags.narration, story, project) ?? await loadWords(await existsFile(path.join(project, "NARRATION.json")) ? path.join(project, "NARRATION.json") : null, story, project);
  const beatsFile = flags.beats ? path.resolve(flags.beats) : path.join(project, "BEATS.json");
  const beats = flags.beats || await existsFile(beatsFile) ? await readJson(beatsFile, "BEATS.json") : null;
  const validation = validateStory(story);
  if (!validation.ok) throw new Error(`storyboard.json is invalid:\n- ${validation.errors.join("\n- ")}`);
  const resolved = resolveStory(story, { words: words?.list ?? [], beats });
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

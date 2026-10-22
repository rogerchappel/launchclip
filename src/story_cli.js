import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { deriveBoundaries, resolveStory, storyFormat, storyHits, validateStory } from "./story.js";

// launchclip story <validate|resolve> <story.json> [--narration NARRATION.json] [--beats BEATS.json] [--out file]
// Without --narration, audio.words is read relative to the story file when it exists.
export async function runStoryCommand(action, storyPath, flags = {}) {
  if (!new Set(["validate", "resolve"]).has(action)) throw new Error(`Unknown story action: ${action}; use validate or resolve`);
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
        if (second.ok) boundaries = deriveBoundaries(resolved);
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

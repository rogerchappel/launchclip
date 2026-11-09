// `launchclip script check <file|project> [--duration N] [--brief file]... [flags]`:
// read a script (plain text, or the narration inside storyboard.json,
// NARRATION.json or make's SCRIPT.json) and a brief, then run checkScript. A
// project folder means its SCRIPT.json. A SCRIPT.json with speakers and silent
// lines (version 2, kit/core/screenplay.mjs) is checked as a screenplay: the
// contract first, then the same script checks on its spoken lines.
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isScreenplay } from "@launchclip/core/screenplay.mjs";
import { resolveProfile } from "./profile_store.js";
import { checkScreenplay, checkScript } from "./script_check.js";

/** The profile whose problem_lands_seconds a screenplay is held to, unless --profile names another. */
export const SCREENPLAY_PROFILE = "story-characters";

/** → the checkScript (or checkScreenplay) report plus {source, input, brief_files}. */
export async function runScriptCheck(file, flags = {}) {
  if (!file) throw new Error("launchclip script check needs a script: launchclip script check <project|script.txt|storyboard.json|NARRATION.json|SCRIPT.json> [--duration <seconds>] [--brief <file>]");
  let source = path.resolve(String(file));
  if (existsSync(source) && statSync(source).isDirectory()) {
    source = path.join(source, "SCRIPT.json");
    if (!existsSync(source)) throw new Error(`launchclip script check: ${file} has no SCRIPT.json (pass a project that has one, or a script file)`);
  }
  const input = parseScriptFile(source, await readText(source, "script"));
  const duration = flags.duration != null ? Number(flags.duration) : input.duration;
  if (flags.duration != null && !(duration > 0)) throw new Error(`--duration must be a positive number of seconds; got ${flags.duration}`);
  if (flags.wpm != null && !(Number(flags.wpm) > 0)) throw new Error(`--wpm must be a positive number of words a minute; got ${flags.wpm}`);
  const briefFiles = [flags.brief].flat().filter(Boolean).map(String);
  const brief = briefFiles.length ? await readBriefs(briefFiles) : null;
  const options = {
    duration,
    brief,
    // make's SCRIPT.json records the plan it wrote against; flags override it.
    format: flags.format ?? input.plan?.format,
    goal: flags.goal ?? input.plan?.goal,
    awareness: flags.awareness ?? input.plan?.awareness,
    pace: flags.pace ?? input.plan?.pace,
    ctaKeyword: flags["cta-keyword"] ?? input.plan?.cta?.keyword,
    choices: flags.choices ?? input.plan?.series?.choices,
    product: flags.product,
    cta: flags.cta,
    audience: flags.audience
  };
  if (input.kind === "screenplay") {
    // The pace: --wpm (the voice's measured pace), else the plan's, else 150.
    const wpm = flags.wpm != null ? Number(flags.wpm) : input.wpm ?? undefined;
    const { profile } = resolveProfile(flags.profile ?? SCREENPLAY_PROFILE, { projectDir: path.dirname(source) });
    const problemLandsSeconds = profile?.measures?.problem_lands_seconds?.p90 ?? null;
    const report = checkScreenplay({ ...options, script: input.script, wpm, problemLandsSeconds });
    return { ...report, source: String(file), input: input.kind, brief_files: briefFiles, profile: profile?.id ?? null };
  }
  const report = checkScript({ ...options, narration: input.narration });
  return { ...report, source: String(file), input: input.kind, brief_files: briefFiles };
}

/** The narration and duration inside a script file (and SCRIPT.json's plan, when it has one). */
export function parseScriptFile(file, text) {
  if (!/\.json$/i.test(file)) return { kind: "text", narration: text, duration: null };
  let value;
  try { value = JSON.parse(text); } catch (error) { throw new Error(`${file} is not valid JSON: ${error.message}`); }
  const narration = value?.audio?.narration;
  if (narration && (narration.text || Array.isArray(narration.lines))) {
    const spoken = narration.text ?? narration.lines.map((line) => line.text).join(" ");
    return { kind: "storyboard", narration: spoken, duration: positive(value.format?.duration) };
  }
  if (isScreenplay(value)) {
    const plan = value.plan && typeof value.plan === "object" ? value.plan : null;
    const wpm = positive(plan?.wpm);
    return { kind: "screenplay", script: value, narration: typeof value.narration === "string" ? value.narration : null, duration: positive(value.duration ?? plan?.duration), ...(wpm ? { wpm } : {}), ...(plan ? { plan } : {}) };
  }
  if (typeof value?.narration === "string") {
    const plan = value.plan && typeof value.plan === "object" ? { format: value.plan.format, goal: value.plan.goal, awareness: value.plan.awareness, ...(value.plan.pace ? { pace: value.plan.pace } : {}), ...(value.plan.cta ? { cta: value.plan.cta } : {}), ...(value.plan.series ? { series: value.plan.series } : {}) } : null;
    return { kind: "script", narration: value.narration, duration: positive(value.take?.seconds ?? value.duration), ...(plan ? { plan } : {}) };
  }
  if (typeof value?.text === "string") return { kind: "narration", narration: value.text, duration: positive(value.duration_seconds ?? value.duration) };
  throw new Error(`${file} has no narration: expected storyboard.json (audio.narration.text), NARRATION.json (text), SCRIPT.json (narration) or a .txt file`);
}

/**
 * Brief files → {prompt, notes}. JSON with prompt/notes/assets/transcripts is
 * used as is (any other JSON contributes its strings); text and Markdown are
 * notes, less any "## Narration…" section (make's BRIEF.md carries the
 * narration itself, which would trace every figure to itself).
 */
export async function readBriefs(files) {
  const brief = { prompt: "", notes: [], assets: [], transcripts: [] };
  for (const file of files) {
    const text = await readText(path.resolve(file), "brief");
    if (/\.json$/i.test(file)) {
      let value;
      try { value = JSON.parse(text); } catch (error) { throw new Error(`${file} is not valid JSON: ${error.message}`); }
      if (value && typeof value === "object" && ["prompt", "notes", "assets", "transcripts"].some((key) => key in value)) {
        if (value.prompt) brief.notes.push(String(value.prompt));
        for (const key of ["notes", "assets", "transcripts"]) brief[key].push(...[value[key] ?? []].flat().map(String));
      } else brief.notes.push(strings(value).join("\n"));
    } else brief.notes.push(withoutNarration(text));
  }
  return brief;
}

function withoutNarration(markdown) {
  return markdown.replace(/^#{1,3} Narration\b[^\n]*\n[\s\S]*?(?=^#{1,3} |(?![\s\S]))/gim, "");
}

function strings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

function positive(value) {
  const number = Number(value);
  return value != null && number > 0 ? number : null;
}

async function readText(file, label) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`${label} file not found: ${file}`);
    throw error;
  }
}

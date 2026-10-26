// `launchclip script check <file> [--duration N] [--brief file]... [flags]`:
// read a script (plain text, or the narration inside storyboard.json,
// NARRATION.json or make's SCRIPT.json) and a brief, then run checkScript.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkScript } from "./script_check.js";

/** → the checkScript report plus {source, input, brief_files}. */
export async function runScriptCheck(file, flags = {}) {
  if (!file) throw new Error("launchclip script check needs a script: launchclip script check <script.txt|storyboard.json|NARRATION.json|SCRIPT.json> [--duration <seconds>] [--brief <file>]");
  const source = path.resolve(String(file));
  const input = parseScriptFile(source, await readText(source, "script"));
  const duration = flags.duration != null ? Number(flags.duration) : input.duration;
  if (flags.duration != null && !(duration > 0)) throw new Error(`--duration must be a positive number of seconds; got ${flags.duration}`);
  const briefFiles = [flags.brief].flat().filter(Boolean).map(String);
  const brief = briefFiles.length ? await readBriefs(briefFiles) : null;
  const report = checkScript({
    narration: input.narration,
    duration,
    brief,
    format: flags.format,
    goal: flags.goal,
    awareness: flags.awareness,
    product: flags.product,
    cta: flags.cta,
    audience: flags.audience
  });
  return { ...report, source: String(file), input: input.kind, brief_files: briefFiles };
}

/** The narration and duration inside a script file. */
export function parseScriptFile(file, text) {
  if (!/\.json$/i.test(file)) return { kind: "text", narration: text, duration: null };
  let value;
  try { value = JSON.parse(text); } catch (error) { throw new Error(`${file} is not valid JSON: ${error.message}`); }
  const narration = value?.audio?.narration;
  if (narration && (narration.text || Array.isArray(narration.lines))) {
    const spoken = narration.text ?? narration.lines.map((line) => line.text).join(" ");
    return { kind: "storyboard", narration: spoken, duration: positive(value.format?.duration) };
  }
  if (typeof value?.narration === "string") return { kind: "script", narration: value.narration, duration: positive(value.take?.seconds ?? value.duration) };
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

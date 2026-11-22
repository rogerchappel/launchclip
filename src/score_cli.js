// `launchclip score <project|file> [--rubric <file>] [--kind <kind>] [--brief <file>]
//   [--model <id>] [--concurrency <n>] [--passed <file>] [--out <file>] [--json]`:
// ask a decision model the rubric's questions about every item (src/scorer.js).
//
// What is scored:
//   hooks.txt            one item a line, of --kind (default "hook")
//   items.json|.jsonl    a list of strings or {id?, kind?, text, ...context}
//   a script file        (SCRIPT.json, NARRATION.json, a video's storyboard.json):
//                        its first sentence as "hook" and the whole as "script"
//   a project folder     a carousel's slides ("cover" then "slide") and its
//                        SCRIPT.json; the rubric defaults to <project>/rubric.json
import { existsSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { carouselSlides, isCarousel } from "@launchclip/core/carousel.mjs";
import { slideText } from "@launchclip/core/carousel-check.mjs";
import { parseScriptFile } from "./script_check_cli.js";
import { parseRubric, scoreItems } from "./scorer.js";

const USAGE = "launchclip score <project|hooks.txt|items.json|SCRIPT.json> --rubric <rubric.json> [--kind <kind>] [--brief <file>] [--model <id>] [--passed <file>] [--out <file>] [--json]";

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch (error) { throw new Error(`${file} is not valid JSON: ${error.message}`); }
}

function scriptItems(file, text) {
  const { narration } = parseScriptFile(file, text);
  const spoken = String(narration ?? "").trim();
  if (!spoken) return [];
  return [{ id: "hook", kind: "hook", text: spoken.split(/(?<=[.!?])\s+/)[0] }, { id: "script", kind: "script", text: spoken }];
}

function listItems(list, kind) {
  return list.map((entry, index) => {
    const item = typeof entry === "string" ? { text: entry } : entry;
    if (!item || typeof item.text !== "string" || !item.text.trim()) throw new Error(`item ${index + 1} needs text: a string, or {text, id?, kind?}`);
    return { kind, ...item, id: String(item.id ?? `${item.kind ?? kind}-${index + 1}`) };
  });
}

/** → the items a target holds: [{id, kind, text, ...context}] */
export async function readItems(target, { kind = "hook" } = {}) {
  const source = path.resolve(String(target));
  if (!existsSync(source)) throw new Error(`launchclip score: ${target} not found`);
  if (statSync(source).isDirectory()) {
    const items = [];
    const storyFile = path.join(source, "storyboard.json");
    const story = existsSync(storyFile) ? await readJson(storyFile) : null;
    if (story && isCarousel(story)) {
      carouselSlides(story).forEach((scene, index) => {
        const text = slideText(scene).own.trim();
        if (text) items.push({ id: `slide-${index + 1}`, kind: index === 0 ? "cover" : "slide", text });
      });
    }
    const scriptFile = path.join(source, "SCRIPT.json");
    if (existsSync(scriptFile)) items.push(...scriptItems(scriptFile, await readFile(scriptFile, "utf8")));
    else if (story && !isCarousel(story) && story.audio?.narration) items.push(...scriptItems(storyFile, JSON.stringify(story)));
    if (!items.length) throw new Error(`launchclip score: ${target} has no carousel slides and no script to score`);
    return items;
  }
  const text = await readFile(source, "utf8");
  if (/\.jsonl$/i.test(source)) return listItems(text.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)), kind);
  if (/\.json$/i.test(source)) {
    const value = JSON.parse(text);
    return Array.isArray(value) ? listItems(value, kind) : scriptItems(source, text);
  }
  return listItems(text.split("\n").map((line) => line.trim()).filter(Boolean), kind);
}

/** → the scoreItems report plus {source, rubric}. Writes --out (the report) and --passed (the passing texts, one a line). */
export async function runScore(target, flags = {}, options = {}) {
  if (!target) throw new Error(`launchclip score needs something to score: ${USAGE}`);
  const source = path.resolve(String(target));
  const projectRubric = existsSync(source) && statSync(source).isDirectory() ? path.join(source, "rubric.json") : null;
  const rubricFile = flags.rubric ? path.resolve(String(flags.rubric)) : projectRubric;
  if (!rubricFile || !existsSync(rubricFile)) throw new Error(`launchclip score needs a rubric: ${flags.rubric ? `${flags.rubric} not found` : "pass --rubric <rubric.json>, or put rubric.json in the project"}`);
  const rubric = parseRubric(await readJson(rubricFile));
  const items = await readItems(target, { kind: flags.kind });
  const concurrency = flags.concurrency != null ? Number(flags.concurrency) : undefined;
  if (concurrency !== undefined && !(concurrency >= 1)) throw new Error(`--concurrency must be 1 or more; got ${flags.concurrency}`);
  const context = flags.brief ? { brief: await readFile(path.resolve(String(flags.brief)), "utf8") } : {};
  const report = { ...(await scoreItems(items, rubric, { ...options, model: flags.model, context, ...(concurrency ? { concurrency } : {}) })), source: String(target), rubric: rubricFile };
  if (flags.out) await writeFile(path.resolve(String(flags.out)), `${JSON.stringify(report, null, 2)}\n`);
  if (flags.passed) await writeFile(path.resolve(String(flags.passed)), report.items.filter((item) => item.status === "passed").map((item) => item.text.replace(/\s+/g, " ")).join("\n").concat("\n"));
  return report;
}

/** The report as lines a person reads: failures and reviews first, then the counts. */
export function formatScore(report) {
  const lines = [];
  const clip = (text) => (text.length > 70 ? `${text.slice(0, 67)}...` : text).replace(/\s+/g, " ");
  const why = (item, keys) => keys.map((key) => `${key} (${item.answers[key].p ?? "no answer"})`).join(", ");
  for (const item of report.items) {
    if (item.status === "failed") lines.push(`FAIL    ${item.id}  "${clip(item.text)}"\n        failed: ${why(item, item.failed)}${item.unsure.length ? `; unsure: ${why(item, item.unsure)}` : ""}`);
    else if (item.status === "review") lines.push(`REVIEW  ${item.id}  "${clip(item.text)}"\n        unsure: ${why(item, item.unsure)}`);
  }
  const { passed, review, failed, skipped } = report.counts;
  lines.push(`${report.items.length} scored with ${report.model}: ${passed} passed, ${review} to review, ${failed} failed${skipped ? `, ${skipped} with no question for their kind` : ""}. Cost $${report.cost_usd}.`);
  return `${lines.join("\n")}\n`;
}

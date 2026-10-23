// Demo shots from docs: the video placeholders a docs site already has, as a
// draft DEMO-PLAN.json with one flow per video.
//
// Placeholders it reads (case-insensitive, an optional "<id> — " prefix):
//   {/* video: <description> */}            MDX comment
//   {/* VIDEO: V09 — <description> */}
//   <!-- video: <description> -->            Markdown/HTML comment
// and shot-list tables: a Markdown table with an id column and a description
// column, whose rows are videos when a type column says video (or clip, gif),
// or, with no type column, when the id looks like V01. Screenshot
// placeholders are listed too, but get no flow.
//
// The draft only has a goto per flow (to the row's route column when it has
// one, else "/"): the agent writes the steps and takes them through
// `launchclip demo doctor`. Each drafted flow keeps `shot` ({id, file, line})
// so it can be traced back to its placeholder.
import { existsSync } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_VIEWPORT, DEMO_PLAN_SCHEMA, validateDemoPlan } from "./plan.js";

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".turbo", "coverage", ".launchclip", "vendor"]);
const DOC = /\.(mdx?|markdown)$/i;
const PLACEHOLDERS = [/\{\/\*\s*(video|screenshot)\s*:\s*([\s\S]*?)\s*\*\/\}/gi, /<!--\s*(video|screenshot)\s*:\s*([\s\S]*?)\s*-->/gi];
// "V09 — text", "create-project – text", "S01 - text": an id is one token.
const ID_PREFIX = /^([A-Za-z][\w.-]{0,39})\s+[—–-]\s+([\s\S]+)$/;

const lineAt = (text, index) => text.slice(0, index).split("\n").length;
const clean = (text) => String(text).replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();
// A format example in the docs ("{/* video: … */}", "<description>") is not a shot.
const isExample = (description) => /^<[^>]*>$/.test(description) || !/[A-Za-z]{3}/.test(description);

function splitId(body) {
  const match = ID_PREFIX.exec(clean(body));
  return match ? { id: match[1], description: clean(match[2]) } : { id: null, description: clean(body) };
}

function tableCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => clean(cell.replace(/`/g, "")));
}

function column(headers, pattern) {
  const index = headers.findIndex((header) => pattern.test(header));
  return index < 0 ? null : index;
}

/** Shot-list tables in one Markdown text. → [{id, kind, description, route, line}] */
export function tableShots(text) {
  const out = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i]) || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) continue;
    const headers = tableCells(lines[i]).map((header) => header.toLowerCase());
    const idCol = column(headers, /^(id|#|shot|shot id|ref)$/);
    const descCol = column(headers, /description|what|shows|content|scene|action|ui state|summary|capture/);
    if (idCol === null || descCol === null) continue;
    const typeCol = column(headers, /^(type|kind|format|media)$/);
    const routeCol = column(headers, /^(route|path|url|screen|app route)$/);
    for (let j = i + 2; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      const cells = tableCells(lines[j]);
      const id = cells[idCol], description = cells[descCol];
      if (!id || !description || isExample(description)) continue;
      const type = typeCol === null ? "" : (cells[typeCol] ?? "").toLowerCase();
      const kind = typeCol !== null
        ? (/video|clip|gif|recording/.test(type) ? "video" : /screenshot|image|still|png/.test(type) ? "screenshot" : null)
        : (/^v\d+$/i.test(id) ? "video" : /^s\d+$/i.test(id) ? "screenshot" : null);
      if (!kind) continue;
      const route = routeCol === null ? null : (cells[routeCol] ?? "");
      out.push({ id, kind, description, route: route?.startsWith("/") ? route : null, line: j + 1 });
      i = j;
    }
  }
  return out;
}

/** Placeholders and shot-table rows in one docs file's text. → [{id, kind, description, route, line}] */
export function parseShots(text) {
  const out = [];
  for (const pattern of PLACEHOLDERS) {
    for (const match of String(text).matchAll(pattern)) {
      const shot = splitId(match[2]);
      if (!isExample(shot.description)) out.push({ ...shot, kind: match[1].toLowerCase(), route: null, line: lineAt(text, match.index) });
    }
  }
  out.push(...tableShots(text));
  return out.sort((a, b) => a.line - b.line);
}

async function docFiles(root, dir = "", depth = 0, out = []) {
  if (depth > 8 || out.length > 4000) return out;
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true }).catch(() => [])) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await docFiles(root, rel, depth + 1, out);
    else if (DOC.test(entry.name)) out.push(rel);
  }
  return out;
}

/**
 * Every video and screenshot placeholder under `target` (a docs folder or one
 * file). → [{id, kind, description, file, line, route}], in file order.
 * `file` is relative to `base` (default: the folder searched).
 */
export async function findShots(target, { base } = {}) {
  const root = path.resolve(target);
  const info = await stat(root).catch(() => null);
  if (!info) throw new Error(`${target} does not exist`);
  const dir = info.isDirectory() ? root : path.dirname(root);
  const files = info.isDirectory() ? (await docFiles(root)).sort() : [path.basename(root)];
  const from = path.resolve(base ?? dir);
  const out = [];
  for (const rel of files) {
    const file = path.join(dir, rel);
    const text = await readFile(file, "utf8").catch(() => "");
    if (!/video|screenshot|\|/i.test(text)) continue;
    for (const shot of parseShots(text)) out.push({ ...shot, file: path.relative(from, file).split(path.sep).join("/") });
  }
  return out;
}

const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function flowId(shot, taken) {
  const words = slug(shot.description).split("-").filter(Boolean).slice(0, 5).join("-");
  let base = slug([shot.id, words].filter(Boolean).join("-")).slice(0, 40).replace(/-+$/, "") || "shot";
  if (!/^[a-z]/.test(base)) base = `shot-${base}`.slice(0, 40).replace(/-+$/, "");
  let id = base, n = 2;
  while (taken.has(id)) id = `${base.slice(0, 37)}-${n++}`;
  taken.add(id);
  return id;
}

function title(text) {
  if (text.length <= 60) return text;
  const cut = text.slice(0, 59);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 30 ? cut.lastIndexOf(" ") : 59)}…`;
}

/**
 * A draft plan with one flow per video shot (screenshots are skipped), merged
 * into `existing` when given: its app and viewport are kept, and a shot whose
 * flow (by `shot.id` + file, or by flow id) is already there is left alone.
 * → {plan, added: [flowId], skipped: [flowId]}
 */
export function draftPlan(shots, { url = "http://localhost:3000", existing = null } = {}) {
  const plan = existing ? structuredClone(existing) : { schema: DEMO_PLAN_SCHEMA, app: { url }, viewport: { ...DEFAULT_VIEWPORT }, flows: [] };
  plan.flows ??= [];
  const taken = new Set(plan.flows.map((flow) => flow.id));
  const added = [], skipped = [];
  for (const shot of shots.filter((entry) => entry.kind === "video")) {
    const same = plan.flows.find((flow) => flow.shot && flow.shot.file === shot.file && (shot.id ? flow.shot.id === shot.id : flow.shot.line === shot.line));
    if (same) { skipped.push(same.id); continue; }
    const id = flowId(shot, taken);
    plan.flows.push({
      id,
      title: title(shot.description),
      goal: shot.description,
      shot: { id: shot.id, file: shot.file, line: shot.line },
      steps: [{ type: "goto", path: shot.route ?? "/" }, { type: "pause", ms: 1000 }]
    });
    added.push(id);
  }
  return { plan, added, skipped };
}

/**
 * `launchclip demo shots <docs> [--draft DEMO-PLAN.json] [--url …]`: list the
 * placeholders, and with --draft write (or extend) a plan with one flow per
 * video. → {stage, shots, draft?, added?, skipped?, warnings?, next}
 */
export async function runShots(target, flags = {}) {
  if (!target) throw new Error("launchclip demo shots needs a docs folder or file");
  const draft = typeof flags.draft === "string" ? path.resolve(flags.draft) : null;
  const shots = await findShots(target, { base: flags.base });
  const videos = shots.filter((shot) => shot.kind === "video");
  if (!draft) {
    return { stage: "demo-shots", shots, videos: videos.length, screenshots: shots.length - videos.length, next: videos.length ? `launchclip demo shots ${target} --draft demo/DEMO-PLAN.json` : "no video placeholders found" };
  }
  const existing = existsSync(draft) ? JSON.parse(await readFile(draft, "utf8")) : null;
  const { plan, added, skipped } = draftPlan(shots, { url: flags.url, existing });
  const { errors, warnings } = validateDemoPlan(plan);
  if (errors.length) throw new Error(`the drafted plan has errors:\n- ${errors.join("\n- ")}`);
  await writeFile(draft, `${JSON.stringify(plan, null, 2)}\n`);
  return {
    stage: "demo-shots",
    shots,
    draft,
    added,
    skipped,
    warnings,
    next: `write the steps of each added flow in ${draft}, then run launchclip demo doctor <repo> --plan ${draft}`
  };
}

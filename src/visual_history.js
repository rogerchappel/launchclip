// Visual history for `launchclip make` (docs/COLLECTIONS_RFC.md §6).
//
// A history directory holds an index of every video made into it
// (launchclip-history.json): the hook, the opening shot, the module sequence,
// the background, caption preset and palette, and the cover. make reads it
// before planning, tells the planner what recent videos chose, moves the
// look dials that would repeat (background, caption preset) to an unused
// value, lints the plan against every entry (weighted towards recent ones)
// and records the finished video. `launchclip history check <dir>` compares
// every pair of videos' hooks and structure, for batch planning.
//
// produce has its own history (src/visual_novelty.js fingerprints production
// plans' shots); this file reuses its set and sequence measures for
// storyboards, which have scenes and modules instead of shots.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { setSimilarity, tokenSimilarity, writeAtomic } from "./visual_novelty.js";

export const VISUAL_HISTORY_VERSION = "launchclip.visual-history.v1";
export const VISUAL_HISTORY_INDEX = "launchclip-history.json";
export const HISTORY_CHECK_VERSION = "launchclip.history-check.v1";
// How many recent entries the planner sees one by one; the lint reads them all.
export const DEFAULT_VISUAL_HISTORY_LIMIT = 8;
// A plan whose recency-weighted similarity to any entry is above this is flagged.
export const DEFAULT_VISUAL_SIMILARITY_LIMIT = 0.6;
// Pairs of scripts flagged by history check: hooks this close, or structures
// this close (module sequences of three scenes or more).
export const DEFAULT_HOOK_SIMILARITY_LIMIT = 0.6;
export const DEFAULT_STRUCTURE_SIMILARITY_LIMIT = 0.85;
// A dial counts as recently used when it appears in this many latest entries.
const RECENT_DIALS = 3;
// Recency weight halves every this many entries back.
const HALF_LIFE = 8;

// The values the vary step picks from: kinds that need no params, icons or
// logo, and caption presets that read in every lane.
const VARY_BACKGROUNDS = ["gradient", "grain-gradient", "dot-grid", "mesh", "topographic", "geometric", "paper", "halftone", "stripes", "light-rays"];
const VARY_CAPTIONS = ["word-highlight", "karaoke-fill", "pop-word", "box-highlight", "underline-sweep", "minimal-line", "quiet-accent", "split-color"];
const STOP_WORDS = new Set(["a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for", "with", "is", "are", "was", "it", "its", "this", "that", "your", "you", "we", "our", "at", "by", "be", "as", "from"]);

/**
 * The parts of a storyboard a viewer would recognise as "the same video".
 * story: the planned storyboard; narration: the spoken text (SCRIPT.json or
 * NARRATION.json); style: the loaded style pack, whose background and
 * captions apply when the story sets none.
 */
export function fingerprintStory(story, { narration = null, style = null, project = null, prompt = null } = {}) {
  const scenes = (Array.isArray(story?.scenes) ? story.scenes : []).filter((scene) => scene && scene.cover !== true);
  const main = scenes.filter((scene) => !scene.track);
  const opening = main[0] ?? scenes[0] ?? null;
  const spoken = String(narration ?? story?.audio?.narration?.text ?? "").trim();
  const background = story?.background ?? style?.background ?? null;
  const captions = (Array.isArray(story?.overlays) ? story.overlays : []).find((overlay) => overlay?.type === "captions") ?? null;
  const colors = story?.brand?.colors ?? style?.brand?.colors ?? {};
  const cover = story?.cover && typeof story.cover === "object" ? story.cover : null;
  return {
    project,
    prompt: prompt ?? story?.meta?.prompt ?? null,
    title: story?.title ?? null,
    lane: story?.lane ?? null,
    aspect: aspectOf(story?.format),
    duration: Number(story?.format?.duration) || null,
    hook: { text: firstSentence(spoken) || null, headline: headlineOf(opening) },
    opening: opening ? { module: opening.module ?? null, headline: headlineOf(opening) } : null,
    modules: main.map((scene) => scene.module).filter(Boolean),
    background: background ? { kind: background.kind ?? null, color: background.params?.color ?? null } : { kind: "default", color: null },
    captions: captions ? captions.preset ?? captions.style ?? "default" : "none",
    transitions: unique(scenes.map((scene) => scene.in?.type)),
    grammar: story?.motion?.grammar ?? null,
    medium: typeof story?.medium === "string" ? story.medium : story?.medium?.kind ?? style?.medium?.kind ?? null,
    palette: { bg: colors.bg ?? null, primary: colors.primary ?? null, accent: colors.accent ?? null },
    cover: cover ? { text: cover.text ?? null, number: cover.number ?? null, kicker: cover.kicker ?? null, frame: cover.frame ?? "first", file: null } : null
  };
}

/** 0–1: how alike two fingerprints look, hook and structure weighted most. */
export function compareStories(left, right) {
  const weighted = [
    [0.25, hookSimilarity(left, right)],
    [0.1, left.opening?.module && left.opening.module === right.opening?.module ? 1 : 0],
    [0.2, structureSimilarity(left.modules, right.modules)],
    [0.1, setSimilarity(left.modules, right.modules)],
    [0.1, left.background?.kind === right.background?.kind && left.background?.color === right.background?.color ? 1 : left.background?.kind === right.background?.kind ? 0.7 : 0],
    [0.05, left.captions === right.captions ? 1 : 0],
    [0.1, !left.cover?.text && !right.cover?.text ? 1 : left.cover?.text && right.cover?.text ? tokenSimilarity(contentWords(left.cover.text), contentWords(right.cover.text)) : 0],
    [0.05, setSimilarity(left.transitions, right.transitions)],
    [0.05, left.palette?.primary === right.palette?.primary && left.palette?.accent === right.palette?.accent ? 1 : 0]
  ];
  return round(weighted.reduce((total, [weight, score]) => total + weight * score, 0));
}

/** 0–1 overlap of two hooks' content words (spoken first sentence and opening headline). */
export function hookSimilarity(left, right) {
  const a = contentWords([left?.hook?.text, left?.hook?.headline].filter(Boolean).join(" "));
  const b = contentWords([right?.hook?.text, right?.hook?.headline].filter(Boolean).join(" "));
  if (!a.length || !b.length) return 0;
  return round(tokenSimilarity(a, b));
}

/** 0–1: the longest common subsequence of two module sequences over the longer one. */
export function structureSimilarity(left = [], right = []) {
  const a = left ?? [], b = right ?? [];
  if (!a.length || !b.length) return 0;
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) table[i][j] = a[i - 1] === b[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1]);
  return round(table[a.length][b.length] / Math.max(a.length, b.length));
}

// ---------------------------------------------------------------------------
// The index

/** → {schema_version, entries} (newest first); an empty index when the dir has none. */
export async function readHistoryIndex(dir) {
  const file = path.join(path.resolve(dir), VISUAL_HISTORY_INDEX);
  let value = null;
  try { value = JSON.parse(await readFile(file, "utf8")); } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`${file} is not a readable history index: ${error.message}`);
  }
  if (value && value.schema_version !== VISUAL_HISTORY_VERSION) throw new Error(`${file} is ${value.schema_version ?? "not a history index"}; expected ${VISUAL_HISTORY_VERSION}`);
  return { schema_version: VISUAL_HISTORY_VERSION, entries: sortEntries(value?.entries ?? []) };
}

/** Add (or replace, for the same project) one fingerprint; → the index file. */
export async function recordHistoryEntry(dir, fingerprint, { clock = () => new Date().toISOString() } = {}) {
  const root = path.resolve(dir);
  const index = await readHistoryIndex(root);
  const entry = { ...fingerprint, id: entryId(fingerprint), recorded_at: clock() };
  const entries = sortEntries([entry, ...index.entries.filter((item) => !(entry.project && item.project === entry.project))]);
  const file = path.join(root, VISUAL_HISTORY_INDEX);
  await writeAtomic(file, `${JSON.stringify({ schema_version: VISUAL_HISTORY_VERSION, updated_at: entry.recorded_at, entries }, null, 2)}\n`);
  return file;
}

// ---------------------------------------------------------------------------
// Before planning: what to avoid, and the vary step

/**
 * What the next plan should not repeat, from every entry except `project`'s
 * own: the most recent `limit` entries one by one, and for each dial the
 * values the latest RECENT_DIALS entries used.
 */
export function historyAvoid(entries, { project = null, limit = DEFAULT_VISUAL_HISTORY_LIMIT } = {}) {
  const others = sortEntries(entries).filter((entry) => !(project && entry.project === project));
  const latest = others.slice(0, RECENT_DIALS);
  return {
    total: others.length,
    recent: others.slice(0, Math.max(0, Number(limit) || DEFAULT_VISUAL_HISTORY_LIMIT)).map(compactEntry),
    dials: {
      background: unique(latest.map((entry) => entry.background?.kind)),
      captions: unique(latest.map((entry) => entry.captions)),
      opening: unique(latest.map((entry) => entry.opening?.module))
    }
  };
}

/** The planner's "## Recent videos" section, or null when there is no history. */
export function historyPrompt(avoid) {
  if (!avoid?.recent?.length) return null;
  const lines = [
    `This video joins a series of ${avoid.total} earlier video${avoid.total === 1 ? "" : "s"}. Keep the brand, but do not repeat what recent videos chose:`,
    "- open on a different hook (new words and a different opening module), and avoid their cover text;",
    "- use a different module sequence, background and caption preset where the brief allows.",
    ""
  ];
  for (const entry of avoid.recent) {
    const parts = [
      entry.hook ? `hook "${entry.hook}"` : null,
      entry.opening ? `opens on ${entry.opening}` : null,
      entry.modules.length ? `modules ${entry.modules.join(" → ")}` : null,
      `background ${entry.background}`,
      `captions ${entry.captions}`,
      entry.cover ? `cover "${entry.cover}"` : null
    ].filter(Boolean);
    lines.push(`- ${parts.join("; ")}`);
  }
  const dials = Object.entries(avoid.dials).filter(([, values]) => values.length).map(([dial, values]) => `${dial}: ${values.join(", ")}`);
  if (dials.length) lines.push("", `Used by the last ${RECENT_DIALS}: ${dials.join("; ")}.`);
  return lines.join("\n");
}

/**
 * Move the look dials that repeat the latest entries to unused values,
 * deterministically (seed orders the candidates). Mutates and returns
 * {changes: [{dial, from, to}]}. locked: {background, captions} that a
 * chosen style pack pins (brand DNA, never varied).
 */
export function varyStory(story, avoid, { seed = "", style = null, locked = {} } = {}) {
  const changes = [];
  if (!avoid?.total) return { changes };
  const order = (values) => [...values].sort((a, b) => hash(`${seed}:${a}`).localeCompare(hash(`${seed}:${b}`)));
  const current = fingerprintStory(story, { style });
  if (!locked.background && avoid.dials.background.includes(current.background.kind)) {
    const next = order(VARY_BACKGROUNDS).find((kind) => !avoid.dials.background.includes(kind));
    if (next) {
      story.background = { kind: next };
      changes.push({ dial: "background", from: current.background.kind, to: next });
    }
  }
  const overlay = (Array.isArray(story.overlays) ? story.overlays : []).find((entry) => entry?.type === "captions");
  if (!locked.captions && overlay && current.captions !== "none" && avoid.dials.captions.includes(current.captions)) {
    const next = order(VARY_CAPTIONS).find((preset) => !avoid.dials.captions.includes(preset));
    if (next) {
      if (overlay.preset !== undefined) overlay.preset = next;
      else overlay.style = next;
      changes.push({ dial: "captions", from: current.captions, to: next });
    }
  }
  return { changes };
}

// ---------------------------------------------------------------------------
// After planning: the lint

/**
 * Compare one fingerprint with every entry. Each similarity is weighted by
 * recency (an entry `age` places back counts 0.6 + 0.4 × 0.5^(age/8)), so an
 * identical video years back still flags and a near one last week flags sooner.
 * → {entries, nearest, passes, similarity_limit, findings}
 */
export function assessVariety(fingerprint, entries, { project = null, similarityLimit = DEFAULT_VISUAL_SIMILARITY_LIMIT } = {}) {
  const others = sortEntries(entries).filter((entry) => !(project && entry.project === project));
  const limit = Number(similarityLimit);
  const compared = others.map((entry, age) => {
    const similarity = compareStories(fingerprint, entry);
    const weight = 0.6 + 0.4 * 0.5 ** (age / HALF_LIFE);
    return { id: entry.id ?? null, project: entry.project ?? null, title: entry.title ?? null, age, similarity, weighted: round(similarity * weight), hook: hookSimilarity(fingerprint, entry), structure: structureSimilarity(fingerprint.modules, entry.modules) };
  }).sort((a, b) => b.weighted - a.weighted);
  const findings = [];
  for (const entry of compared) {
    if (entry.weighted > limit) findings.push(`too close to ${label(entry)}: similarity ${entry.similarity} (weighted ${entry.weighted}, limit ${limit})`);
    else if (entry.hook >= DEFAULT_HOOK_SIMILARITY_LIMIT) findings.push(`hook repeats ${label(entry)} (hook similarity ${entry.hook})`);
  }
  const latest = others.slice(0, RECENT_DIALS);
  if (fingerprint.opening?.module && latest.length >= RECENT_DIALS && latest.every((entry) => entry.opening?.module === fingerprint.opening.module)) findings.push(`opens on ${fingerprint.opening.module}, like each of the last ${RECENT_DIALS} videos`);
  return { entries: others.length, similarity_limit: limit, nearest: compared[0] ?? null, compared: compared.slice(0, 5), passes: !findings.length, findings };
}

// ---------------------------------------------------------------------------
// history check: every pair

/**
 * Flag pairs whose hooks or structure are too close. dir: a history dir
 * (its index) and/or a folder of projects (each subfolder with a
 * storyboard.json not already in the index is fingerprinted).
 */
export async function checkHistory(dir, { hookLimit = DEFAULT_HOOK_SIMILARITY_LIMIT, structureLimit = DEFAULT_STRUCTURE_SIMILARITY_LIMIT, similarityLimit = DEFAULT_VISUAL_SIMILARITY_LIMIT } = {}) {
  const root = path.resolve(dir);
  if (!existsSync(root)) throw new Error(`launchclip history check: ${root} does not exist`);
  for (const [flag, value] of [["--hook-limit", hookLimit], ["--structure-limit", structureLimit], ["--similarity-limit", similarityLimit]]) {
    if (!(Number(value) > 0 && Number(value) <= 1)) throw new Error(`${flag} must be above 0 and at most 1; got ${value}`);
  }
  const index = await readHistoryIndex(root);
  const indexed = new Set(index.entries.map((entry) => entry.project).filter(Boolean));
  const scanned = (await projectFingerprints(root)).filter((entry) => !indexed.has(entry.project));
  const videos = [...index.entries, ...scanned];
  const pairs = [];
  for (let i = 0; i < videos.length; i += 1) {
    for (let j = i + 1; j < videos.length; j += 1) {
      const [a, b] = [videos[i], videos[j]];
      const hook = hookSimilarity(a, b);
      const structure = structureSimilarity(a.modules, b.modules);
      const similarity = compareStories(a, b);
      const reasons = [];
      if (hook >= hookLimit) reasons.push(`hooks ${hook} alike (limit ${hookLimit})`);
      if (structure >= structureLimit && Math.min(a.modules.length, b.modules.length) >= 3) reasons.push(`structure ${structure} alike (limit ${structureLimit})`);
      if (similarity > similarityLimit) reasons.push(`overall ${similarity} alike (limit ${similarityLimit})`);
      pairs.push({ a: label(a), b: label(b), hook, structure, similarity, flagged: reasons.length > 0, reasons });
    }
  }
  pairs.sort((x, y) => Number(y.flagged) - Number(x.flagged) || y.similarity - x.similarity);
  const flagged = pairs.filter((pair) => pair.flagged);
  return {
    schema_version: HISTORY_CHECK_VERSION,
    dir: root,
    videos: videos.length,
    from_index: index.entries.length,
    scanned: scanned.length,
    limits: { hook: hookLimit, structure: structureLimit, similarity: similarityLimit },
    ok: flagged.length === 0,
    flagged,
    pairs
  };
}

export function formatHistoryCheck(report) {
  const lines = [`launchclip history check: ${report.videos} video${report.videos === 1 ? "" : "s"} in ${report.dir} (${report.from_index} indexed, ${report.scanned} scanned), ${report.flagged.length} pair${report.flagged.length === 1 ? "" : "s"} too close`];
  for (const pair of report.flagged) lines.push(`- ${pair.a} ↔ ${pair.b}: ${pair.reasons.join("; ")}`);
  if (!report.flagged.length && report.pairs[0]) lines.push(`closest: ${report.pairs[0].a} ↔ ${report.pairs[0].b} (overall ${report.pairs[0].similarity}, hook ${report.pairs[0].hook}, structure ${report.pairs[0].structure})`);
  return `${lines.join("\n")}\n`;
}

/** A project folder's fingerprint (storyboard.json plus SCRIPT.json or NARRATION.json), or null. */
export async function fingerprintProject(project) {
  const story = await readJson(path.join(project, "storyboard.json"));
  if (!story || !Array.isArray(story.scenes)) return null;
  const script = await readJson(path.join(project, "SCRIPT.json"));
  const words = script?.narration ? null : await readJson(path.join(project, "NARRATION.json"));
  const fingerprint = fingerprintStory(story, { narration: script?.narration ?? words?.text ?? null, project });
  if (fingerprint.cover && existsSync(path.join(project, "video/cover.png"))) fingerprint.cover.file = "video/cover.png";
  return fingerprint;
}

async function projectFingerprints(root) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; }
  const found = await Promise.all(entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => fingerprintProject(path.join(root, entry.name))));
  return found.filter(Boolean);
}

// ---------------------------------------------------------------------------

function compactEntry(entry) {
  return {
    title: entry.title ?? null,
    hook: entry.hook?.text ?? entry.hook?.headline ?? null,
    opening: entry.opening?.module ?? null,
    modules: entry.modules ?? [],
    background: entry.background?.kind ?? "default",
    captions: entry.captions ?? "default",
    cover: entry.cover?.text ?? null
  };
}

function sortEntries(entries) {
  return [...(entries ?? [])].filter((entry) => entry && typeof entry === "object").sort((a, b) => String(b.recorded_at ?? "").localeCompare(String(a.recorded_at ?? "")));
}

function entryId(fingerprint) {
  return hash(JSON.stringify([fingerprint.project, fingerprint.hook, fingerprint.modules])).slice(0, 12);
}

function label(entry) {
  const name = entry.project ? path.basename(entry.project) : entry.id ?? "video";
  return entry.title ? `${name} (${entry.title})` : name;
}

function headlineOf(scene) {
  const params = scene?.params ?? {};
  for (const key of ["headline", "title", "text", "statement", "quote", "question", "label"]) if (typeof params[key] === "string" && params[key].trim()) return params[key].trim().slice(0, 160);
  return null;
}

function firstSentence(text) {
  const match = /^[\s\S]*?[.!?](?=\s|$)/.exec(text);
  return (match ? match[0] : text).trim().slice(0, 240);
}

function contentWords(text) {
  return (String(text ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => !STOP_WORDS.has(word));
}

function aspectOf(format) {
  const width = Number(format?.width), height = Number(format?.height);
  if (!(width > 0 && height > 0)) return null;
  return width > height ? "landscape" : width < height ? "portrait" : "square";
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean).map(String))];
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

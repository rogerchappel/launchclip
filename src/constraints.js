// Direction constraints: hard rules an app sets on a story
// (docs/KIT_CONTRACTS.md "Direction constraints"). The app decides what
// footage is allowed; LaunchClip decides how to edit, inside these rules.
//
//   constraints.json (in --assets, or --constraints <file>):
//   {"version": 1,
//    "ranges": [{"start": 4.2, "end": 9.8, "picture": "hidden", "reason": "voiceover_only"}],
//    "media": {"must_use": [{"src": "broll/pinned-03.mp4", "reason": "pinned"}],
//              "never_use": ["broll/x.mp4", {"id": "asset-118", "reason": "licence"}]}}
//
// - ranges: seconds on the story's timeline (the base as it plays). A hidden
//   range is covered by full-frame inserts the whole way: every direction-map
//   line over it is an insert line, and no scene shows the presenter there.
// - must_use: each file appears in the story at least once.
// - never_use: the file never appears; make leaves it out of the inventory
//   and refuses it from the asset provider. An {id} entry matches the
//   provider's asset id.
// Media paths are relative to the assets folder ("assets/" is optional).
//
// parseConstraints → checkConstraints (story validate, finish's gate, the
// planner's checks) → enforceHiddenLines / fillConstraints (the planner's
// deterministic pass when the model leaves a rule broken).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveStory, storyBase, storySections } from "@launchclip/core/story.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { needsSubject } from "@launchclip/core/subject-layer.mjs";
import { narrationWords, segmentLines } from "@launchclip/core/direction.mjs";
import { assetRelative, formatOrientation, pickMedia } from "./inventory_notes.js";
import { normalizeShot } from "./asset_provider.js";

export const CONSTRAINTS_VERSION = 1;
// In the --assets folder.
export const CONSTRAINTS_FILE = "constraints.json";
// Beside storyboard.json (make writes the normalised copy here).
export const PROJECT_CONSTRAINTS_FILE = "CONSTRAINTS.json";
export const PICTURE_STATES = Object.freeze(["hidden"]);
// A full-frame insert the fill adds is at least this long (photo-scene's minimum).
export const FILL_MIN_SECONDS = 2;
// The fill starts a little before a hidden range and ends a little after, so
// the insert's own fade lands outside it.
export const FILL_PAD_SECONDS = 0.4;
const VISUAL_EXT = /\.(png|jpe?g|webp|svg|gif|mp4|mov|m4v|webm)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const r3 = (value) => Math.round(value * 1000) / 1000;
const span = (a, b) => `${r3(a)}–${r3(b)} s`;

/** The project path a constraint names: "broll/a.mp4" → "assets/broll/a.mp4". */
export const storySrc = (key) => `assets/${key}`;

/**
 * Parse and check a constraints document. → {ok, errors, warnings,
 * constraints} where constraints is {version, ranges: [{start, end, picture,
 * reason?}] (sorted, merged per picture state), must_use: [{src, reason?}],
 * never_use: [{src?, id?, reason?}]} with src relative to the assets folder.
 */
export function parseConstraints(raw, { source = CONSTRAINTS_FILE } = {}) {
  const errors = [];
  const warnings = [];
  const err = (message) => errors.push(`${source}: ${message}`);
  const constraints = { version: CONSTRAINTS_VERSION, ranges: [], must_use: [], never_use: [] };
  if (!isObject(raw)) return { ok: false, errors: [`${source} must be a JSON object`], warnings, constraints };
  for (const key of Object.keys(raw)) if (!["version", "ranges", "media", "notes"].includes(key)) err(`unknown field "${key}" (version, ranges, media)`);
  if (raw.version !== CONSTRAINTS_VERSION) err(`version must be ${CONSTRAINTS_VERSION}`);
  if (raw.ranges !== undefined && !Array.isArray(raw.ranges)) err("ranges must be a list of {start, end, picture, reason?}");
  for (const [index, range] of (Array.isArray(raw.ranges) ? raw.ranges : []).entries()) {
    const where = `ranges[${index}]`;
    if (!isObject(range)) { err(`${where} must be {start, end, picture, reason?}`); continue; }
    for (const key of Object.keys(range)) if (!["start", "end", "picture", "reason"].includes(key)) err(`${where} has unknown field "${key}"`);
    if (!finite(range.start) || range.start < 0) { err(`${where}.start must be seconds (0 or more)`); continue; }
    if (!finite(range.end) || range.end <= range.start) { err(`${where}.end must be seconds after start`); continue; }
    if (!PICTURE_STATES.includes(range.picture)) { err(`${where}.picture must be ${PICTURE_STATES.map((state) => `"${state}"`).join(" or ")}`); continue; }
    if (range.reason !== undefined && typeof range.reason !== "string") err(`${where}.reason must be text`);
    constraints.ranges.push({ start: r3(range.start), end: r3(range.end), picture: range.picture, ...(typeof range.reason === "string" && range.reason.trim() ? { reason: range.reason.trim() } : {}) });
  }
  constraints.ranges = mergeRanges(constraints.ranges);
  const media = raw.media;
  if (media !== undefined && !isObject(media)) err("media must be {must_use?, never_use?}");
  if (isObject(media)) {
    for (const key of Object.keys(media)) if (!["must_use", "never_use"].includes(key)) err(`media has unknown field "${key}" (must_use, never_use)`);
    for (const list of ["must_use", "never_use"]) {
      const entries = media[list];
      if (entries === undefined) continue;
      if (!Array.isArray(entries)) { err(`media.${list} must be a list of paths or {src, reason?}`); continue; }
      entries.forEach((entry, index) => {
        const where = `media.${list}[${index}]`;
        const item = typeof entry === "string" ? { src: entry } : entry;
        if (!isObject(item)) { err(`${where} must be a path or {src, reason?}`); return; }
        for (const key of Object.keys(item)) if (!["src", "id", "reason"].includes(key) || (key === "id" && list === "must_use")) err(`${where} has unknown field "${key}"`);
        const out = {};
        if (item.src !== undefined) {
          const key = typeof item.src === "string" ? assetRelative(item.src) : null;
          if (!key) { err(`${where}.src must be a path under the assets folder (no absolute path or ..)`); return; }
          out.src = key;
        }
        if (item.id !== undefined) {
          if (typeof item.id !== "string" || !item.id.trim()) { err(`${where}.id must be the asset provider's id for the asset`); return; }
          out.id = item.id.trim();
        }
        if (!out.src && !out.id) { err(`${where} needs src${list === "never_use" ? " or id" : ""}`); return; }
        if (list === "must_use" && !VISUAL_EXT.test(out.src)) { err(`${where}.src ${out.src} is not an image or video; must_use names media a scene can show`); return; }
        if (typeof item.reason === "string" && item.reason.trim()) out.reason = item.reason.trim();
        const list2 = constraints[list];
        if (!list2.some((other) => (out.src && other.src === out.src) || (out.id && other.id === out.id))) list2.push(out);
      });
    }
    for (const entry of constraints.must_use) if (constraints.never_use.some((other) => other.src === entry.src)) err(`${entry.src} is in both media.must_use and media.never_use`);
  }
  return { ok: errors.length === 0, errors, warnings, constraints };
}

/** Read and parse a constraints file; throws with every error when it is invalid. */
export async function loadConstraints(file) {
  let text;
  try { text = await readFile(file, "utf8"); } catch { throw new Error(`Cannot read constraints: ${file}`); }
  let raw;
  try { raw = JSON.parse(text); } catch (error) { throw new Error(`${path.basename(file)} is not valid JSON (${file}): ${error.message}`); }
  const parsed = parseConstraints(raw, { source: path.basename(file) });
  if (!parsed.ok) throw new Error(`invalid constraints (${file}):\n- ${parsed.errors.join("\n- ")}`);
  return parsed.constraints;
}

/** The document form of parsed constraints (what make writes to CONSTRAINTS.json). */
export function constraintsDocument(constraints) {
  return {
    version: CONSTRAINTS_VERSION,
    ranges: constraints.ranges,
    media: { must_use: constraints.must_use, never_use: constraints.never_use }
  };
}

export function hasConstraints(constraints) {
  return Boolean(constraints && (constraints.ranges?.length || constraints.must_use?.length || constraints.never_use?.length));
}

function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  for (const range of sorted) {
    const last = out.at(-1);
    if (last && last.picture === range.picture && range.start <= last.end + 1e-6) {
      last.end = Math.max(last.end, range.end);
      if (range.reason && last.reason !== range.reason) last.reason = [last.reason, range.reason].filter(Boolean).join("; ");
    } else out.push({ ...range });
  }
  return out;
}

/**
 * A matcher for never_use: (candidate {src?, file?, id?}) → the entry it
 * breaks, or null. src is a story or assets-relative path; file an absolute
 * path (matched under assetsDir, or by its trailing path); id the provider's.
 */
export function neverUseMatcher(constraints, { assetsDir = null } = {}) {
  const entries = constraints?.never_use ?? [];
  return (candidate = {}) => {
    if (!entries.length) return null;
    const keys = new Set();
    if (typeof candidate.src === "string") { const key = assetRelative(candidate.src); if (key) keys.add(key); }
    if (typeof candidate.file === "string") {
      const file = path.resolve(candidate.file).split(path.sep).join("/");
      if (assetsDir) {
        const relative = path.relative(assetsDir, path.resolve(candidate.file)).split(path.sep).join("/");
        if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) keys.add(relative);
      }
      for (const entry of entries) if (entry.src && file.endsWith(`/${entry.src}`)) keys.add(entry.src);
    }
    const ids = new Set([candidate.id, candidate.asset_id, candidate.source?.id, candidate.source?.asset_id].filter((value) => typeof value === "string" || typeof value === "number").map(String));
    return entries.find((entry) => (entry.src && keys.has(entry.src)) || (entry.id && ids.has(entry.id))) ?? null;
  };
}

/**
 * An asset provider (src/asset_provider.js) that honours never_use: each
 * request carries never_use (the assets-relative paths and ids to avoid),
 * and a shot that is one of them is refused (no shot: the planner designs
 * the scene without it). → {findShot, close}
 */
export function constrainProvider(provider, constraints, { assetsDir = null, notice = () => {} } = {}) {
  const match = neverUseMatcher(constraints, { assetsDir });
  const avoid = (constraints?.never_use ?? []).map((entry) => entry.src ?? `id:${entry.id}`);
  return {
    async findShot(request, options) {
      const answer = await provider.findShot({ ...request, never_use: avoid }, options);
      const shot = normalizeShot(answer);
      const hit = shot ? match({ src: shot.src, file: shot.file, id: shot.asset_id ?? shot.id, source: shot.source }) : null;
      if (!hit) return answer;
      notice(`constraints: refused the asset provider's shot for ${request.scene_id ?? request.id} (${hit.src ?? `id ${hit.id}`} is never_use${hit.reason ? `: ${hit.reason}` : ""})`);
      return null;
    },
    close: () => provider.close?.()
  };
}

/** Every assets/ path a story names, with where: Map("assets/…" → ["scenes[2].params.media.src", …]). */
export function storyMediaRefs(story) {
  const refs = new Map();
  const visit = (value, where) => {
    if (typeof value === "string") {
      const clean = value.replace(/^\.\//, "");
      if (clean.startsWith("assets/")) refs.set(clean, [...(refs.get(clean) ?? []), where]);
      return;
    }
    if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${where}[${index}]`));
    else if (isObject(value)) for (const [key, item] of Object.entries(value)) visit(item, where ? `${where}.${key}` : key);
  };
  for (const key of ["base", "scenes", "overlays", "ending", "audio", "sections", "cover"]) if (story?.[key] !== undefined) visit(story[key], key);
  return refs;
}

// ---------------------------------------------------------------------------
// Hidden ranges

/**
 * What hides the base picture in a resolved story: insert scenes (less a
 * transition in from the base) and sections laid out as "insert".
 * → [[start, end]] merged
 */
export function hidingIntervals(resolved) {
  const raw = [];
  for (const scene of resolved?.scenes ?? []) {
    if (scene?.insert !== true) continue;
    const start = Number(scene.start), end = Number(scene.end);
    if (finite(start) && finite(end) && end > start) raw.push({ start, end, fade: isObject(scene.in) && scene.in.type !== "cut" && finite(scene.in.dur) ? scene.in.dur : 0 });
  }
  for (const section of storySections(resolved)) if (section.layout === "insert" && section.end > section.start) raw.push({ start: section.start, end: section.end, fade: 0 });
  // A fade in from the base shows it; a hand-off from another insert does not.
  const intervals = raw.map((entry) => {
    const covered = raw.some((other) => other !== entry && other.start < entry.start + 1e-6 && other.end > entry.start - 1e-6);
    return [entry.fade && !covered ? Math.min(entry.end, entry.start + entry.fade) : entry.start, entry.end];
  });
  return union(intervals);
}

function union(intervals) {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out.at(-1);
    if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function subtract([a, b], intervals) {
  let gaps = [[a, b]];
  for (const [c, d] of intervals) {
    gaps = gaps.flatMap(([x, y]) => (d <= x || c >= y ? [[x, y]] : [...(c > x ? [[x, c]] : []), ...(d < y ? [[d, y]] : [])]));
  }
  return gaps;
}

/** The parts of each hidden range the base picture shows through: [{range, gaps: [[a, b]]}]. Gaps under one frame are ignored. */
export function hiddenExposure(resolved, constraints) {
  const fps = Number(resolved?.resolved?.fps ?? resolved?.format?.fps ?? 30) || 30;
  const hiding = hidingIntervals(resolved);
  const duration = Number(resolved?.resolved?.duration ?? resolved?.format?.duration) || Infinity;
  return (constraints?.ranges ?? []).filter((range) => range.picture === "hidden").map((range) => {
    const clipped = [range.start, Math.min(range.end, duration)];
    const gaps = clipped[1] > clipped[0] ? subtract(clipped, hiding).filter(([a, b]) => b - a >= 1 / fps - 1e-6) : [];
    return { range, gaps };
  });
}

/** Scenes that draw the presenter's cut-out (subject effects) over a hidden range: [{id, start, end, range}]. */
export function subjectOverHidden(resolved, constraints) {
  const out = [];
  for (const scene of resolved?.scenes ?? []) {
    const start = Number(scene?.start), end = Number(scene?.end);
    if (!finite(start) || !finite(end)) continue;
    const range = (constraints?.ranges ?? []).find((entry) => entry.picture === "hidden" && entry.start < end && entry.end > start);
    if (!range) continue;
    let model = null;
    try { model = resolveModule(scene, resolved); } catch { model = null; }
    if (needsSubject(scene, model)) out.push({ id: scene.id, start, end, range });
  }
  return out;
}

/** The map lines that overlap a hidden range: [{line, section, range, start, end}]. */
export function hiddenLines(map, constraints, words) {
  const list = narrationWords(words);
  const ranges = (constraints?.ranges ?? []).filter((range) => range.picture === "hidden");
  const out = [];
  if (!ranges.length || !list.length) return out;
  for (const section of map?.sections ?? []) for (const line of section?.lines ?? []) {
    const a = list[line?.words?.[0]], b = list[line?.words?.[1]];
    if (!a || !b) continue;
    const range = ranges.find((entry) => entry.start < b.end && entry.end > a.start);
    if (range) out.push({ line, section, range, start: a.start, end: b.end });
  }
  return out;
}

/**
 * Check a resolved story against the constraints. map/words: the direction
 * map and narration (their lines over hidden ranges must be insert lines).
 * story: the unresolved story, for media paths (defaults to resolved).
 * → {ok, errors, warnings, summary}
 */
export function checkConstraints(resolved, constraints, { map = null, words = null, story = null } = {}) {
  const errors = [];
  const warnings = [];
  const label = (range) => `hidden range ${span(range.start, range.end)}${range.reason ? ` (${range.reason})` : ""}`;
  const hidden = (constraints?.ranges ?? []).filter((range) => range.picture === "hidden");
  let exposed = 0;
  if (hidden.length && !storyBase(resolved)) {
    warnings.push(`constraints: ${hidden.length} hidden range${hidden.length === 1 ? "" : "s"} apply to a base recording; this ${resolved?.lane ?? ""} story has none, so nothing shows through`);
  } else if (hidden.length) {
    for (const { range, gaps } of hiddenExposure(resolved, constraints)) {
      if (!gaps.length) continue;
      exposed += 1;
      errors.push(`constraints: ${label(range)} shows the base picture at ${gaps.map(([a, b]) => span(a, b)).join(", ")}; cover the whole range with full-frame insert scenes (insert: true) or a section with layout "insert"`);
    }
    for (const entry of subjectOverHidden(resolved, constraints)) errors.push(`constraints: scene ${entry.id} (${span(entry.start, entry.end)}) draws the presenter's cut-out over the ${label(entry.range)}; keep subject effects out of hidden ranges`);
    if (map && words?.length) {
      for (const entry of hiddenLines(map, constraints, words)) {
        if (entry.line.treatment !== "insert") errors.push(`constraints: direction line words [${entry.line.words.join(", ")}] (${span(entry.start, entry.end)}) overlaps the ${label(entry.range)} but is "${entry.line.treatment}"; make it an insert line naming the insert scenes that cover it`);
      }
    }
  }
  const refs = storyMediaRefs(story ?? resolved);
  const missing = [];
  for (const entry of constraints?.must_use ?? []) {
    if (refs.has(storySrc(entry.src))) continue;
    missing.push(entry.src);
    errors.push(`constraints: must_use ${storySrc(entry.src)}${entry.reason ? ` (${entry.reason})` : ""} does not appear in the story; give it a scene (a full-frame insert or a media scene) on the line it fits best`);
  }
  const present = [];
  for (const entry of constraints?.never_use ?? []) {
    if (!entry.src) continue;
    const where = refs.get(storySrc(entry.src));
    if (!where) continue;
    present.push(entry.src);
    errors.push(`constraints: never_use ${storySrc(entry.src)}${entry.reason ? ` (${entry.reason})` : ""} appears at ${where.slice(0, 4).join(", ")}; remove it or use other media`);
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: { ranges: hidden.length, exposed, must_use: constraints?.must_use?.length ?? 0, missing, never_use: constraints?.never_use?.length ?? 0, present }
  };
}

// ---------------------------------------------------------------------------
// The planner's side

/** The planning-prompt section that states the constraints. words: the narration (each hidden range's words are quoted). */
export function constraintsPrompt(constraints, { words = [], mediaLines = new Map() } = {}) {
  if (!hasConstraints(constraints)) return "";
  const list = narrationWords(words);
  const lines = ["## Constraints from the app (hard rules; the checks enforce them)", ""];
  for (const range of constraints.ranges.filter((entry) => entry.picture === "hidden")) {
    const text = list.filter((word) => word.start < range.end && word.end > range.start).map((word) => word.text).join(" ");
    lines.push(`- ${span(range.start, range.end)} picture hidden${range.reason ? ` (${range.reason})` : ""}${text ? `: "${text.slice(0, 160)}"` : ""}. Cover all of it with full-frame insert scenes (insert: true; supplied b-roll in a photo-scene or media-window first), start the cover a little before ${r3(range.start)} s, and make every direction line over it an insert line. No face, dress or camera treatment and no subject effect there.`);
  }
  for (const entry of constraints.must_use) lines.push(`- Use ${storySrc(entry.src)}${entry.reason ? ` (${entry.reason})` : ""} in at least one scene, on the line it fits best${mediaLines.get(entry.src) ? ` (${mediaLines.get(entry.src)})` : ""}.`);
  if (constraints.never_use.some((entry) => entry.src)) lines.push(`- Never use: ${constraints.never_use.filter((entry) => entry.src).map((entry) => storySrc(entry.src)).join(", ")}.`);
  return `${lines.join("\n")}\n`;
}

/**
 * Make every map line over a hidden range an insert line (a deep copy). A
 * line with no scenes names "hidden-<n>", the insert the storyboard (or the
 * fill) gives it. → {map, changed: [{words, from}]}
 */
export function enforceHiddenLines(map, constraints, words) {
  if (!map) return { map, changed: [] };
  const copy = structuredClone(map);
  const changed = [];
  const ranges = (constraints?.ranges ?? []).filter((range) => range.picture === "hidden");
  for (const entry of hiddenLines(copy, constraints, words)) {
    if (entry.line.treatment === "insert") continue;
    changed.push({ words: entry.line.words, from: entry.line.treatment });
    entry.line.treatment = "insert";
    const scenes = (Array.isArray(entry.line.scenes) ? entry.line.scenes : []).filter(Boolean);
    entry.line.scenes = scenes.length ? scenes : [`hidden-${ranges.indexOf(entry.range) + 1}`];
    entry.line.why = `constraints: the picture is hidden over ${span(entry.range.start, entry.range.end)}${entry.range.reason ? ` (${entry.range.reason})` : ""}`;
  }
  return { map: copy, changed };
}

/**
 * Point the map's lines at the scenes that really cover them: each line over
 * a hidden range names the insert scenes overlapping it, and a face or camera
 * line mostly under a scene the fill added becomes an insert line naming it.
 * resolved: the storyboard resolved. → the map (a copy)
 */
export function reconcileMap(map, resolved, constraints, words, { added = [] } = {}) {
  if (!map) return map;
  const copy = structuredClone(map);
  const list = narrationWords(words);
  const inserts = (resolved?.scenes ?? []).filter((scene) => scene?.insert === true && finite(Number(scene.start)) && finite(Number(scene.end)));
  for (const entry of hiddenLines(copy, constraints, words)) {
    const ids = inserts.filter((scene) => Number(scene.start) < entry.end && Number(scene.end) > entry.start).map((scene) => scene.id);
    if (ids.length) entry.line.scenes = ids;
    entry.line.treatment = "insert";
  }
  const addedIds = new Set(added.map((entry) => entry.id));
  for (const section of copy.sections ?? []) for (const line of section.lines ?? []) {
    const a = list[line?.words?.[0]], b = list[line?.words?.[1]];
    if (!a || !b) continue;
    for (const scene of (resolved?.scenes ?? []).filter((item) => addedIds.has(item.id))) {
      const overlap = Math.min(b.end, Number(scene.end)) - Math.max(a.start, Number(scene.start));
      if (!(overlap > 0) || overlap < 0.5 * (b.end - a.start)) continue;
      if (line.treatment === "face" || line.treatment === "camera") {
        line.treatment = scene.insert === true ? "insert" : "dress";
        line.scenes = [scene.id];
        line.why = `constraints: ${scene.id} shows ${scene.params?.media?.src ?? "required media"} here`;
      } else if (!(line.scenes ?? []).includes(scene.id)) line.scenes = [...(line.scenes ?? []), scene.id];
    }
  }
  return copy;
}

/**
 * The deterministic pass: fix what the model left broken. Each exposed part
 * of a hidden range gets a full-frame insert (the best-matching supplied
 * clip in a photo-scene, in its best usable window; a hook-title of the
 * line's words when there is no media), padded past the range where the
 * timeline is free, or a neighbouring insert is stretched over it. Each
 * missing must_use file gets a scene on the free line it matches best, or
 * replaces the media of an existing media scene. never_use media is never
 * picked. storyboard: unresolved; media: [{src, kind, duration?, width?,
 * height?, notes?, description?}] (never_use already left out).
 * → {storyboard (a copy), added: [{id, src, start, end, reason}], changed: [text], errors: [text]}
 */
export function fillConstraints(storyboard, constraints, { words = [], media = [], beats = null } = {}) {
  const story = structuredClone(storyboard);
  const added = [];
  const changed = [];
  const errors = [];
  if (!hasConstraints(constraints) || !Array.isArray(story?.scenes)) return { storyboard: story, added, changed, errors };
  const list = narrationWords(words);
  const never = neverUseMatcher(constraints);
  const candidates = (media ?? []).filter((item) => !never({ src: item.src }));
  const footage = story.lane === "footage-led";
  const fps = Number(story.format?.fps ?? 30) || 30;
  const snap = (value) => Math.round(value * fps) / fps;
  const ids = new Set(story.scenes.map((scene) => scene?.id));
  const nextId = (stem) => { let n = 1; while (ids.has(`${stem}-${n}`)) n += 1; ids.add(`${stem}-${n}`); return `${stem}-${n}`; };
  const resolve = () => resolveStory(structuredClone(story), { words: list, beats });
  let resolved;
  try { resolved = resolve(); } catch (error) { return { storyboard: story, added, changed, errors: [`constraints: the story does not resolve (${error.message}), so tooling cannot place the required scenes`] }; }
  const duration = Number(resolved.resolved?.duration ?? story.format?.duration) || 0;
  const textAt = (a, b) => list.filter((word) => word.start < b && word.end > a).map((word) => word.text).join(" ");
  const orientation = formatOrientation(story.format);
  const used = () => new Set([...storyMediaRefs(story).keys()]);
  const unplaced = () => new Set(constraints.must_use.map((entry) => storySrc(entry.src)).filter((src) => !used().has(src)));
  // Track-0 time already taken: inserts (footage-led) or base scenes (motion lanes).
  const occupied = () => (resolved.scenes ?? []).filter((scene) => (footage ? scene.insert === true : (scene.track ?? 0) === 0) && finite(Number(scene.start)) && finite(Number(scene.end))).map((scene) => ({ id: scene.id, start: Number(scene.start), end: Number(scene.end) })).sort((a, b) => a.start - b.start);
  const freeAround = (a, b) => {
    const taken = occupied();
    const before = taken.filter((entry) => entry.end <= a + 1e-6).at(-1);
    const after = taken.find((entry) => entry.start >= b - 1e-6);
    return { lo: before ? before.end : 0, hi: after ? after.start : duration, before, after };
  };
  const mediaScene = (id, pick, start, end, text) => {
    const item = pick?.item;
    const scene = { id, start: snap(start), end: snap(end) };
    if (footage) scene.insert = true;
    if (item) {
      const sourceStart = item.kind === "video" ? (pick.window ? pick.window.start : 0) : undefined;
      scene.module = "photo-scene";
      scene.params = { media: { src: item.src, kind: item.kind, ...(sourceStart !== undefined ? { sourceStart } : {}) } };
      if (item.notes?.description) scene.params.title = item.notes.description.slice(0, 60);
    } else {
      scene.module = "hook-title";
      scene.params = { headline: headlineOf(text) };
    }
    return scene;
  };

  // 1. Hidden ranges (footage-led: only a base has a picture to hide).
  if (footage && storyBase(resolved)) {
    for (const { range, gaps } of hiddenExposure(resolved, constraints)) {
      for (const [a, b] of gaps) {
        const { lo, hi, before, after } = freeAround(a, b);
        let start = Math.max(lo, a - FILL_PAD_SECONDS);
        let end = Math.min(hi, b + FILL_PAD_SECONDS);
        if (end - start < FILL_MIN_SECONDS) end = Math.min(hi, start + FILL_MIN_SECONDS);
        if (end - start < FILL_MIN_SECONDS) start = Math.max(lo, end - FILL_MIN_SECONDS);
        const reason = `${range.reason ?? "picture hidden"} ${span(range.start, range.end)}`;
        if (end - start >= FILL_MIN_SECONDS - 1e-6) {
          const text = textAt(a, b);
          const pick = pickMedia(candidates, { text, need: end - start, orientation, used: used(), prefer: unplaced() });
          const scene = mediaScene(nextId("hidden"), pick, start, end, text || "Keep watching");
          story.scenes.push(scene);
          added.push({ id: scene.id, src: pick?.item?.src ?? null, start: scene.start, end: scene.end, reason });
        } else {
          // No room for a scene of its own: stretch the insert before it (or after it) over the gap.
          const neighbour = before && before.end >= a - 1e-6 ? before : after && after.start <= b + 1e-6 ? after : null;
          const target = neighbour ? story.scenes.find((scene) => scene.id === neighbour.id && !scene.cover) : null;
          if (!target) { errors.push(`constraints: no room for an insert over ${span(a, b)} of the hidden range ${span(range.start, range.end)}`); continue; }
          if (neighbour === before) target.end = snap(Math.min(hi, b + FILL_PAD_SECONDS));
          else target.start = snap(Math.max(lo, a - FILL_PAD_SECONDS));
          changed.push(`${target.id} stretched over ${span(a, b)} (${reason})`);
        }
        resolved = resolve();
      }
    }
  }

  // 2. must_use: a scene on the free line each file fits best.
  const lines = segmentLines(list);
  for (const entry of constraints.must_use) {
    const src = storySrc(entry.src);
    if (used().has(src)) continue;
    const item = candidates.find((candidate) => candidate.src === src) ?? { src, kind: VIDEO_EXT.test(src) ? "video" : "image" };
    let best = null;
    for (const line of lines) {
      const { lo, hi } = freeAround(line.start, line.start);
      const free = occupied().some((scene) => scene.start < line.end && scene.end > line.start) ? null : { lo, hi };
      if (!free) continue;
      const window = item.kind === "video" && item.notes?.windows ? pickMedia([item], { text: line.text, need: line.end - line.start }).window : null;
      const length = Math.min(window ? window.end - window.start : Number(item.duration) || 6, Math.max(FILL_MIN_SECONDS, Math.min(6, line.end - line.start + FILL_PAD_SECONDS)));
      let start = Math.max(free.lo, line.start - 0.1);
      let end = Math.min(free.hi, start + Math.max(FILL_MIN_SECONDS, length));
      if (end - start < FILL_MIN_SECONDS) start = Math.max(free.lo, end - FILL_MIN_SECONDS);
      if (end - start < FILL_MIN_SECONDS - 1e-6) continue;
      const score = pickMedia([item], { text: line.text, need: end - start, orientation }).score;
      if (!best || score > best.score + 1e-9) best = { line, start, end, score, window };
    }
    if (best) {
      const scene = mediaScene(nextId("must-use"), { item, window: best.window }, best.start, best.end, best.line.text);
      story.scenes.push(scene);
      added.push({ id: scene.id, src, start: scene.start, end: scene.end, reason: entry.reason ?? "must_use" });
      resolved = resolve();
      continue;
    }
    // No free line: the media scene that matches best gives up its media.
    const swappable = story.scenes.filter((scene) => ["photo-scene", "media-window"].includes(scene?.module) && scene.params?.media && !constraints.must_use.some((other) => storySrc(other.src) === (scene.params.media.src ?? scene.params.media)));
    if (swappable.length) {
      const target = swappable[0];
      const previous = typeof target.params.media === "string" ? target.params.media : target.params.media.src;
      const window = item.kind === "video" ? pickMedia([item], { need: 3 }).window : null;
      target.params = { ...target.params, media: { ...(isObject(target.params.media) ? target.params.media : {}), kind: item.kind, src, ...(item.kind === "video" ? { sourceStart: window ? window.start : 0 } : {}) } };
      if (item.kind !== "video") delete target.params.media.sourceStart;
      changed.push(`${target.id} shows ${src} instead of ${previous} (${entry.reason ?? "must_use"})`);
      resolved = resolve();
      continue;
    }
    errors.push(`constraints: no free line for must_use ${src} and no media scene to show it in`);
  }
  return { storyboard: story, added, changed, errors };
}

function headlineOf(text) {
  const words = String(text ?? "").replace(/[^\p{L}\p{N}\s'’-]/gu, "").split(/\s+/).filter(Boolean).slice(0, 6);
  return words.length ? words.join(" ") : "Keep watching";
}

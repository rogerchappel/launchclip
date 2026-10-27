// The beat director's camera (wave 3 part C): which camera move opens each
// shot of a long-form beat map, the zooms inside a card when the narration
// names something it shows, and one overview per chapter. A pass over the
// finished map, so every explainer directed with directLongForm gets them
// without placing any by hand. docs/BEAT_DIRECTOR.md, "Camera".
//
//   planCamera(map, words, {format, brand}) → map (shots gain `camera`, cards gain `zooms`)
//   zoomSpots(state, {format, brand})       → the elements a card shows, with the words that name them
//   cameraSummary(map)                      → {entries, zooms, overviews, …} for the report
//
// Entries (shot.camera = {type, dur, direction?}): a shot that stays on the
// topic of the one before pushes in, a new topic whip-pans or orbits, a
// chapter opens on a pull. After two push-ins in a row the next entry is
// never a third (a pull, a whip-pan or an orbit), so the world zoom stays in
// range.
//
// Zooms (state.zooms on the first state of a card, absolute seconds): a
// word that names a bar's label or value, a table row, a grid's count, a
// token or the focused diff line, while the card that shows it is up. A
// state-target module (shot-states.mjs STATE_MODULES) gets `target`, the rest
// a `box` from the element rects of the resolved model. 2–3 a minute, each
// eased back out (`until`) before the next, none in the card's entry move
// and none on a card under 3 s.
//
// Overviews (shot.camera = {type: 'overview', dur, span: 'chapter', hold}):
// for each chapter of 4 or more shots after the cold open, on the shot a
// recap line ("Either way…", "So…", "That is…") in the chapter's back half
// opens (or the chapter's next shot after it), else on the first shot of the
// next chapter. At most one per 60 s, never into the story's first shot.
//
// Pure ESM; imports only kit/core siblings.

import { catalogBView } from './catalog-b.mjs';
import { catalogHView } from './catalog-h.mjs';
import { resolveModule } from './modules.mjs';
import { STATE_MODULES, indexView } from './shot-states.mjs';

// Entry moves and their durations (the reference cut's).
export const ENTRY = Object.freeze({ push: 0.55, pull: 0.6, 'whip-pan': 0.45, orbit: 0.6 });
export const OVERVIEW = Object.freeze({ dur: 2.6, hold: 0.6, minShots: 4, gap: 60 });
export const ZOOM = Object.freeze({ perMinute: 3, gap: 12, minCard: 3, settle: 0.6, hold: 2.2, minHold: 1.8, tail: 0.5, between: 0.6, perCard: 2, maxArea: 0.5, pad: 24 });
const DIRECTIONS = ['right', 'down', 'left', 'up'];
const EXTENDS = new Set(['focus', 'hold', 'guide']);
const STRUCTURE = new Set(['cta', 'sting']);
export const RECAP = /^(either way|so\b|that is\b|that's\b|in short\b|put together\b|all of which\b|which is why\b)/i;
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'to', 'for', 'at', 'by', 'from', 'rest', 'other', 'others', 'more', 'less', 'all', 'it', 'its', 'is', 'was', 'per', 'vs', 'with', 'them', 'they', 'these', 'those', 'this', 'that', 'there', 'here', 'we', 'you']);

const round = (value, places = 3) => { const f = 10 ** places; return Math.round(value * f) / f; };

function familyOf(kind) {
  if (['list', 'process', 'concept', 'chain', 'lineage', 'family', 'grid'].includes(kind)) return 'idea';
  if (['stat', 'money', 'compute', 'share', 'series', 'compare', 'ranking', 'race'].includes(kind)) return 'number';
  if (['timeline', 'date', 'month'].includes(kind)) return 'time';
  if (['social', 'quote', 'pr', 'commit', 'diff', 'page', 'documents', 'code', 'terminal', 'tokens'].includes(kind)) return 'evidence';
  return kind;
}

// ---------------------------------------------------------------------------
// Matching narration words to what a card shows

/** A spoken word as {text (lower case, no edge punctuation), value (a number it says, or null)}. */
export function spoken(text) {
  const clean = String(text ?? '').toLowerCase().replace(/^[^\p{L}\p{N}$€£.-]+|[^\p{L}\p{N}%×]+$/gu, '');
  const digits = clean.replace(/^[$€£]/, '').replace(/,/g, '').replace(/(%|×|x)$/, '');
  return { text: clean, value: /^-?\d+(\.\d+)?$/.test(digits) ? Number(digits) : null };
}

const tokensOf = (label) => String(label ?? '').toLowerCase().split(/\s+/).map((part) => spoken(part).text).filter(Boolean);

/** Whether the words from i on say the label (all of it, or its one distinctive word). → words matched, or 0. */
function saysLabel(words, i, label) {
  const parts = tokensOf(label);
  // A label of filler words ("Of them") names nothing.
  if (!parts.some((part) => !STOP.has(part) && part.length >= 3)) return 0;
  if (parts.length > 1 && parts.every((part, k) => words[i + k]?.text === part)) return parts.length;
  const content = parts.filter((part) => !STOP.has(part) && !/^\d/.test(part));
  if (content.length === 1 && content[0].length >= 3 && words[i].text === content[0]) return 1;
  return 0;
}

// A line's own names (identifiers, capitalised words, words of 6+ letters), each a label a narrated word can say.
const distinctive = (text) => [...new Set(String(text ?? '').match(/[A-Za-z_][\w.-]{3,}/g) ?? [])].filter((word) => /[_.\d-]|^[A-Z]/.test(word)).slice(0, 6);
const figures = (text) => (String(text ?? '').match(/\d[\d,]*(\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, '')));

const numberIn = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const found = String(value ?? '').match(/-?\d[\d,]*(\.\d+)?/);
  return found ? Number(found[0].replace(/,/g, '')) : null;
};

// ---------------------------------------------------------------------------
// The elements a card shows

const VIEWS = [catalogBView, catalogHView];

function viewIndex(module, params, { format, brand, seconds }) {
  const scene = { id: 'z', module, start: 0, end: Math.max(3, seconds), params };
  const story = { schema: 'launchclip.story.v1', lane: 'motion', format: { width: format.width, height: format.height, fps: 30, duration: scene.end }, brand, scenes: [scene], resolved: { duration: scene.end, fps: 30 } };
  let model;
  try { model = resolveModule(scene, story); } catch { return null; }
  for (const view of VIEWS) {
    try { return { model, index: indexView([view(model)]) }; } catch { /* another catalogue's module */ }
  }
  return { model, index: null };
}

/** The union of the named elements' rects (canvas px), padded and kept inside the card, else null. */
function boxOf(found, ids) {
  if (!found?.index) return null;
  const rects = ids.map((id) => found.index.byId.get(`z-${id}`)).filter((entry) => entry && Number.isFinite(entry.width) && Number.isFinite(entry.height) && entry.width > 0 && entry.height > 0);
  if (!rects.length) return null;
  const { rect } = found.model;
  const x0 = Math.max(rect.x, Math.min(...rects.map((r) => r.ax)) - ZOOM.pad), y0 = Math.max(rect.y, Math.min(...rects.map((r) => r.ay)) - ZOOM.pad);
  const x1 = Math.min(rect.x + rect.width, Math.max(...rects.map((r) => r.ax + r.width)) + ZOOM.pad), y1 = Math.min(rect.y + rect.height, Math.max(...rects.map((r) => r.ay + r.height)) + ZOOM.pad);
  if (x1 - x0 < 8 || y1 - y0 < 8) return null;
  // A box that is most of the card is no zoom at all.
  if (((x1 - x0) * (y1 - y0)) / (rect.width * rect.height) > ZOOM.maxArea) return null;
  return { x: round(x0, 1), y: round(y0, 1), width: round(x1 - x0, 1), height: round(y1 - y0, 1) };
}

/**
 * The elements a card shows that a line can name:
 * [{name (what it is called in the report), labels: [string], values: [number], target?, box?}].
 * Bars, rows and grid counts with fewer than two items are the whole card, so they have none.
 */
export function zoomSpots(state, { format = { width: 1920, height: 1080 }, brand, seconds = 6 } = {}) {
  const p = state.params ?? {};
  const module = state.module;
  const state0 = Boolean(STATE_MODULES[module]);
  const spots = [];
  const found = () => (found.cache ??= viewIndex(module, p, { format, brand, seconds }));
  const add = (spot, ids) => {
    const box = boxOf(found(), ids);
    if (spot.target !== undefined && state0) spots.push({ ...spot, ...(box ? { box } : {}) });
    else if (box) spots.push({ ...spot, box });
  };
  if (module === 'bar-chart' && Array.isArray(p.data) && p.data.length >= 2) {
    p.data.forEach((bar, i) => add({ name: `bar ${bar.label}`, labels: [bar.label], values: [numberIn(bar.value)], target: i }, [`bar-${i}`, `label-${i}`, `value-${i}`]));
  } else if (module === 'glass-bars-3d' && Array.isArray(p.data) && p.data.length >= 2) {
    p.data.forEach((bar, i) => add({ name: `bar ${bar.label}`, labels: [bar.label], values: [numberIn(bar.value)] }, [`b${i}-top`, `b${i}-front`, `lb${i}`]));
  } else if ((module === 'comparison-table' && Array.isArray(p.rows) && p.rows.length >= 2) || (module === 'leaderboard' && Array.isArray(p.entries) && p.entries.length >= 2)) {
    const rows = p.rows ?? p.entries;
    rows.forEach((row, i) => spots.push({ name: `row ${row.label}`, labels: [row.label], values: [row.value, ...(row.values ?? [])].map(numberIn).filter((v) => v !== null), target: i }));
  } else if (module === 'process-steps' && Array.isArray(p.steps) && p.steps.length >= 2) {
    p.steps.forEach((step, i) => spots.push({ name: `step ${step.label}`, labels: [step.label], values: [numberIn(step.label)].filter((v) => v !== null), target: i }));
  } else if (module === 'excerpt' && Array.isArray(p.lines) && p.lines.length >= 2) {
    p.lines.forEach((line, i) => { if (line?.highlight) spots.push({ name: `line ${i + 1}`, labels: distinctive(line.text), values: figures(line.text), target: i }); });
  } else if (module === 'scatter-plot' && Array.isArray(p.points) && p.points.length >= 2) {
    p.points.forEach((point, i) => { if (point.label) spots.push({ name: `point ${point.label}`, labels: [point.label], values: [], target: i }); });
  } else if (module === 'number-line' && p.marker && Number.isFinite(Number(p.marker.value))) {
    add({ name: `marker ${p.marker.label ?? p.marker.value}`, labels: [], values: [Number(p.marker.value)] }, ['marker', 'ml']);
  } else if (module === 'unit-grid' && Array.isArray(p.groups) && p.groups.length >= 2) {
    p.groups.forEach((group, i) => add({ name: `count ${group.label ?? group.count}`, labels: group.label && !/\d/.test(group.label) ? [group.label] : [], values: [group.count, numberIn(group.label)].filter((v) => v !== null) }, [`gn-${i}`, `gl-${i}`]));
  } else if (module === 'grid-race' && Array.isArray(p.racers)) {
    p.racers.forEach((racer, i) => add({ name: `racer ${racer.label}`, labels: [racer.label], values: [racer.total, racer.spend?.total].filter((v) => typeof v === 'number') }, [`l-${i}`, `n-${i}`]));
  } else if (module === 'tokenizer' && Array.isArray(p.tokens)) {
    p.tokens.forEach((token, i) => { if (spoken(token).text.replace(/[^\p{L}\p{N}]/gu, '').length >= 3) add({ name: `token "${token.trim()}"`, labels: [token.trim().replace(/^[-_.]+/, '')], values: [] }, [`chip-${i}`, `cp-${i}-0`]); });
  } else if (module === 'diff-view' && Array.isArray(p.lines) && Array.isArray(p.focus)) {
    for (const focus of p.focus) {
      if (!Number.isInteger(focus.row)) continue;
      const line = p.lines[focus.row];
      const text = typeof line === 'string' ? line.slice(1) : line?.text ?? '';
      add({ name: `line ${focus.row + 1}`, labels: distinctive(text), values: [] }, [`card-row-${focus.row}`]);
    }
  }
  return spots.filter((spot) => spot.labels.some(Boolean) || spot.values.some((v) => v !== null));
}

/** Where the words in [a, b] name a spot: [{at, word, spot, value: boolean}]. */
function mentionsIn(words, a, b, spots) {
  const out = [];
  for (let i = a; i <= b; i += 1) {
    const word = words[i];
    for (const spot of spots) {
      const byValue = word.value !== null && spot.values.some((v) => v !== null && Math.abs(v - word.value) < 1e-9);
      const length = byValue ? 1 : Math.max(0, ...spot.labels.map((label) => saysLabel(words, i, label)));
      if (byValue || length) out.push({ at: word.start, word: words.slice(i, i + Math.max(1, length)).map((w) => w.raw).join(' '), spot, value: byValue });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The pass

/** The cards of a map in order: a state that puts a card up and the focus/hold/guide states that carry it on. */
export function mapCards(map) {
  const cards = [];
  for (const chapter of map.chapters ?? []) for (const shot of chapter.shots ?? []) for (const state of shot.states ?? []) {
    const last = cards.at(-1);
    if (last && EXTENDS.has(state.change) && last.state.module === state.module) { last.end = state.end; last.states.push(state); continue; }
    cards.push({ state, states: [state], shot, chapter, start: state.start, end: state.end });
  }
  return cards;
}

/**
 * Plan the camera of a beat map in place: shot.camera on every shot after the
 * first, state.zooms on the cards the narration points into. words: the
 * narration words (NARRATION.json shape). → map
 */
export function planCamera(map, words, { format = map.format ?? { width: 1920, height: 1080 }, brand } = {}) {
  const said = (words ?? []).map((word) => ({ ...spoken(word.text), raw: String(word.text ?? '').replace(/^[^\p{L}\p{N}$€£]+|[^\p{L}\p{N}%×]+$/gu, ''), start: word.start, end: word.end }));
  const shots = (map.chapters ?? []).flatMap((chapter, c) => chapter.shots.map((shot, s) => ({ shot, chapter, c, s })));
  for (const { shot } of shots) { delete shot.camera; for (const state of shot.states) delete state.zooms; }

  // Overviews: the shot each eligible chapter's overview opens.
  const overviews = new Map();
  let lastOverview = -Infinity;
  const chapters = map.chapters ?? [];
  chapters.forEach((chapter, c) => {
    if (c === 0 && chapters.length > 1) return; // the cold open
    if (chapter.shots.length < OVERVIEW.minShots) return;
    const half = chapter.start + (chapter.end - chapter.start) / 2;
    // The last recap line in the chapter's back half: the shot it opens, else the next shot of the chapter.
    let recap = null, line = null;
    chapter.shots.forEach((shot, s) => shot.states.forEach((state, k) => {
      if (state.start < half || STRUCTURE.has(state.kind) || !RECAP.test(state.text.trim())) return;
      const at = k === 0 ? s : s + 1;
      if (at >= OVERVIEW.minShots - 1 && at < chapter.shots.length && !STRUCTURE.has(chapter.shots[at].states[0].kind)) { recap = chapter.shots[at]; line = state.text; }
    }));
    const next = chapters[c + 1]?.shots.find((shot) => !STRUCTURE.has(shot.states[0].kind));
    const into = recap ?? next ?? null;
    if (!into || into.start - lastOverview < OVERVIEW.gap || into === shots[0]?.shot) return;
    overviews.set(into, { chapter: chapter.id, why: recap ? `recap line "${line.split(/\s+/).slice(0, 4).join(' ')}…"` : 'after the chapter\'s last line' });
    lastOverview = into.start;
  });

  // Entries.
  let pushes = 0, sideways = 0;
  shots.forEach(({ shot, s }, i) => {
    if (i === 0) return;
    const overview = overviews.get(shot);
    if (overview) {
      shot.camera = { type: 'overview', dur: OVERVIEW.dur, span: 'chapter', hold: OVERVIEW.hold, chapter: overview.chapter, why: `overview of ${overview.chapter}: ${overview.why}` };
      pushes = 0;
      return;
    }
    const before = shots[i - 1].shot.states.at(-1);
    let type, why;
    if (s === 0) { type = 'pull'; why = 'a new chapter steps back'; }
    else if (familyOf(shot.states[0].kind) === familyOf(before.kind) && !STRUCTURE.has(before.kind)) { type = 'push'; why = 'same topic: closer in'; }
    else { type = sideways % 3 === 2 ? 'orbit' : 'whip-pan'; why = 'a new topic: across'; }
    if (type === 'push' && pushes >= 2) { type = 'pull'; why = 'balance: after two push-ins'; }
    pushes = type === 'push' ? pushes + 1 : 0;
    const camera = { type, dur: ENTRY[type], why };
    if (type === 'whip-pan' || type === 'orbit') { camera.direction = DIRECTIONS[sideways % DIRECTIONS.length]; sideways += 1; }
    shot.camera = camera;
  });

  // Zooms.
  const candidates = [];
  for (const card of mapCards(map)) {
    if (STRUCTURE.has(card.state.kind) || card.end - card.start < ZOOM.minCard) continue;
    const entry = card.shot.states[0] === card.state ? card.shot.camera?.dur ?? 0 : 0.4;
    const from = card.start + entry + ZOOM.settle;
    const to = card.end - ZOOM.tail - ZOOM.minHold;
    if (to <= from) continue;
    const a = said.findIndex((word) => word.start >= from);
    if (a < 0) continue;
    let b = a;
    while (b + 1 < said.length && said[b + 1].start <= to) b += 1;
    if (said[a].start > to) continue;
    const spots = zoomSpots(card.state, { format, brand, seconds: card.end - card.start });
    if (!spots.length) continue;
    for (const mention of mentionsIn(said, a, b, spots)) candidates.push({ ...mention, card });
  }
  // A value before a label at the same moment; then in time order.
  candidates.sort((x, y) => x.at - y.at || Number(y.value) - Number(x.value));
  const taken = [];
  const onCard = new Map();
  for (const candidate of candidates) {
    const { card, spot } = candidate;
    const last = taken.at(-1);
    if (last && candidate.at - last.at < ZOOM.gap) continue;
    if (taken.filter((zoom) => candidate.at - zoom.at < 60).length >= ZOOM.perMinute) continue;
    const mine = onCard.get(card) ?? [];
    if (mine.length >= ZOOM.perCard || mine.some((zoom) => zoom.spot === spot) || (mine.length && candidate.at < mine.at(-1).until + ZOOM.between)) continue;
    const until = round(Math.min(candidate.at + ZOOM.hold, card.end - ZOOM.tail));
    if (until - candidate.at < ZOOM.minHold) continue;
    const zoom = { at: round(candidate.at), until, word: candidate.word, element: spot.name, ...(spot.target !== undefined ? { target: spot.target } : { box: spot.box }) };
    taken.push({ ...zoom, spot, card });
    onCard.set(card, [...mine, { ...zoom, spot }]);
    (card.state.zooms ??= []).push(zoom);
  }
  return map;
}

/** Counts for the report: {entries: {type: n}, zooms, zooms_per_min, overviews, list: {zooms, overviews}}. */
export function cameraSummary(map) {
  const entries = {};
  const zooms = [], overviews = [];
  for (const chapter of map.chapters ?? []) for (const shot of chapter.shots ?? []) {
    if (shot.camera) entries[shot.camera.type] = (entries[shot.camera.type] ?? 0) + 1;
    if (shot.camera?.type === 'overview') overviews.push({ at: shot.start, chapter: shot.camera.chapter, why: shot.camera.why });
    for (const state of shot.states) for (const zoom of state.zooms ?? []) zooms.push({ at: zoom.at, module: state.module, element: zoom.element, word: zoom.word, by: zoom.target !== undefined ? 'target' : 'box' });
  }
  let run = 0, pushRun = 0;
  for (const chapter of map.chapters ?? []) for (const shot of chapter.shots ?? []) { run = shot.camera?.type === 'push' ? run + 1 : 0; pushRun = Math.max(pushRun, run); }
  const minutes = Math.max(1 / 60, (map.duration ?? 0) / 60);
  return { entries, zooms: zooms.length, zooms_per_min: round(zooms.length / minutes, 2), overviews: overviews.length, longest_push_run: pushRun, list: { zooms, overviews } };
}

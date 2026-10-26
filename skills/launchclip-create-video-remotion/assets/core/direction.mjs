// The direction map (launchclip.direction-map.v1, DIRECTION.json beside
// storyboard.json): every line of the narration gets an intent and a visual
// decision (docs/VIDEO_QUALITY_RFC.md §6). The storyboard says what renders;
// the map says why each scene exists; the cadence profile says what the whole
// should measure like.
//
//   validateDirection(map, {words, story, lane, validateCast, deferScenes})
//                                    → {ok, errors, warnings}
//   directionMeasures(map, story, {words, face}) → storyboard measures with the
//                                      map's sections, plus per-line facts
//   segmentLines(words)              → [{words: [a, b], text, start, end}]
//   classifyIntent(text, {index, count}) → intent (the shared intent rules)
//   draftDirectionMap(story, words)  → a map drafted from an existing storyboard
//
// Pure ESM; imports only kit/core siblings. Canonical copy: kit/core/direction.mjs.

import { storyBase } from './story.mjs';
import { CAMERA_ONLY_MODULES, isGraphicScene, storyboardMeasures } from './cadence.mjs';
import { ACTIONS } from './characters/actions.mjs';
import { POSES } from './characters/rig.mjs';

// A line's key action (docs/DIRECTION_GUARDRAILS.md §2): what a character does
// on screen to show the line: an acting cue or a pose.
export const ACTION_VERBS = Object.freeze([...ACTIONS, ...POSES.filter((pose) => !['stand', 'sit'].includes(pose))]);

export const DIRECTION_SCHEMA = 'launchclip.direction-map.v1';
export const DIRECTION_FILE = 'DIRECTION.json';
export const DIRECTION_INTENTS = Object.freeze(['hook', 'claim', 'problem', 'turn', 'proof', 'number', 'list', 'process', 'product', 'personal', 'quote', 'cta']);
export const DIRECTION_TREATMENTS = Object.freeze(['dress', 'insert', 'face', 'camera']);
// Story beats for a narrative (character) map's sections (RFC §6.3).
export const NARRATIVE_BEATS = Object.freeze(['setup', 'problem', 'attempt', 'turn', 'resolution', 'cta']);
// Footage layouts a section holds (RFC §7.1; the compilers draw them).
export const DIRECTION_LAYOUTS = Object.freeze(['full', 'split-left', 'split-right', 'framed', 'stacked', 'insert']);
// The lanes whose stories need a map: every lane with narration.
export const DIRECTION_LANES = Object.freeze(['footage-led', 'motion', 'voiceover-motion']);
// Intents that call for a visual: a line with one of these held on the face
// (or only a camera move) is a candidate missed opportunity.
export const VISUAL_INTENTS = Object.freeze(['hook', 'claim', 'problem', 'proof', 'number', 'list', 'process', 'product', 'quote', 'cta']);

// The shared intent classifier (RFC §6.4): the planner prompt, the skills'
// direction-map reference and draftDirectionMap all read these rules, first
// match wins. A line that matches none is a claim; the first line is the
// hook unless it is a call to action.
export const INTENT_RULES = Object.freeze([
  { intent: 'cta', when: 'asks the viewer to act: try, sign up, download, follow, the link', patterns: ['\\b(try (it|this|launch\\w*)|sign up|download|subscribe|follow|get started|link (below|in)|visit (our|the) (site|website|page)|join (us|the)|book a)\\b'] },
  { intent: 'quote', when: 'quotes someone: quotation marks, "said", "told me"', patterns: ['["“”]', '\\b(said|says|told (me|us)|in (his|her|their) words)\\b'] },
  { intent: 'number', when: 'gives a figure: digits, a percentage, "twelve minutes", "doubled"', patterns: ['\\d', '\\b(percent|twice|double[ds]?|triple[ds]?|half|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|million|billion) (minutes?|hours?|days?|weeks?|months?|years?|seconds?|times|x|percent|people|users|customers|dollars)\\b'] },
  { intent: 'list', when: 'lists things: "three things", "first… second", items separated by commas', patterns: ['\\b(first|second|third|lastly|finally|here are|a few (things|ways|reasons))\\b', '\\b(two|three|four|five) (things|ways|reasons|steps|tools|parts)\\b', '\\b[\\w-]+, [\\w-]+,? (and|or) [\\w-]+'] },
  { intent: 'process', when: 'explains how something works or a sequence of steps', patterns: ['\\b(step|then|next|after that|how (it|this|to)|works by|it (turns|takes|runs|reads|writes|cuts|edits|transcribes))\\b'] },
  { intent: 'product', when: 'names or shows the product, a feature or the app', patterns: ['\\b(the app|our app|dashboard|feature|the product|we built|i built|built (it|this)|i make|it does|launch(clip)?|on screen)\\b'] },
  { intent: 'turn', when: 'turns the story: "but", "so", "instead", "that\'s when", "turns out"', patterns: ['^(but|so|instead|now|however|yet)\\b', '\\b(that\'s (when|why)|turns out|it hit me|everything changed)\\b'] },
  { intent: 'problem', when: 'names a problem or a pain', patterns: ['\\b(problem|hard|slow|pain|hate|broken|struggle|waste[ds]?|bury|buries|can\'t|cannot|never works|frustrat\\w*|annoying|tedious|stuck)\\b'] },
  { intent: 'proof', when: 'backs a claim with evidence: customers, results, reviews, data', patterns: ['\\b(customers?|users?|reviews?|results?|data|proof|proved?|tested|case study|benchmark)\\b'] },
  { intent: 'personal', when: 'the speaker about themselves: a personal story or feeling', patterns: ['\\b(i|i\'m|i\'ve|my|me|myself)\\b'] }
]);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

const COMPILED = INTENT_RULES.map((rule) => ({ ...rule, regexes: rule.patterns.map((pattern) => new RegExp(pattern, 'i')) }));

/** The intent of one line of narration (the shared rules, first match wins). */
export function classifyIntent(text, { index = null } = {}) {
  const line = String(text ?? '').trim();
  const hit = COMPILED.find((rule) => rule.regexes.some((regex) => regex.test(line)));
  if (hit?.intent === 'cta') return 'cta';
  if (index === 0) return 'hook';
  return hit?.intent ?? 'claim';
}

/** Narration words as {text, start, end} (NARRATION.json words or a {words} document). */
export function narrationWords(words) {
  const list = Array.isArray(words) ? words : Array.isArray(words?.words) ? words.words : [];
  return list.map((entry) => ({ text: String(entry?.text ?? entry?.word ?? ''), start: Number(entry?.start), end: Number(entry?.end ?? entry?.start) }));
}

/**
 * Split narration into lines: at sentence ends, at pauses of `pause` seconds
 * or more, and every `maxWords` words. → [{words: [a, b], text, start, end}]
 */
export function segmentLines(words, { pause = 0.6, maxWords = 16 } = {}) {
  const list = narrationWords(words);
  const lines = [];
  let first = 0;
  for (let i = 0; i < list.length; i += 1) {
    const text = list[i].text;
    const next = list[i + 1];
    const sentence = /[.!?]["”']?$/.test(text);
    const gap = next && finite(next.start) && finite(list[i].end) ? next.start - list[i].end : 0;
    if (i === list.length - 1 || sentence || gap >= pause || i - first + 1 >= maxWords) {
      lines.push(lineOf(list, first, i));
      first = i + 1;
    }
  }
  return lines;
}

function lineOf(list, a, b) {
  return { words: [a, b], text: list.slice(a, b + 1).map((entry) => entry.text).join(' '), start: list[a].start, end: list[b].end };
}

/** The narration lines with their classified intents, as the planner hints them. */
export function intentHints(words) {
  return segmentLines(words).map((line, index) => ({ ...line, intent: classifyIntent(line.text, { index }) }));
}

// ---------------------------------------------------------------------------
// Validation

/**
 * Validate a direction map. options:
 *   words: the story's narration words (required for line checks);
 *   story: the resolved storyboard (numeric scene times): checks that each
 *     named scene exists and overlaps its line's words;
 *   deferScenes: true while the storyboard is not planned yet (the planner's
 *     first pass): scene names are checked for shape only;
 *   lane: the story lane, when there is no story;
 *   segments: the style's segment formats; a section's `segment` must name one;
 *   cast: the story's cast; validateCast(line, cast) → string[] | {errors,
 *     warnings}: the character kit's cue check (kit/core/characters/), called
 *     for each line with `cast` or `set` cues. Without it, cues pass through.
 */
export function validateDirection(map, options = {}) {
  const errors = [];
  const warnings = [];
  const err = (message) => errors.push(message);
  if (!isObject(map)) return { ok: false, errors: ['DIRECTION.json must be a JSON object'], warnings };
  if (map.schema !== DIRECTION_SCHEMA) err(`schema must be "${DIRECTION_SCHEMA}"`);
  for (const key of Object.keys(map)) if (!['schema', 'profile', 'sections', 'notes', 'cast'].includes(key)) err(`unknown field "${key}"`);
  if (map.profile !== undefined && !nonEmpty(map.profile)) err('profile must be a cadence profile id');
  const words = narrationWords(options.words);
  const story = options.story ?? null;
  const lane = story?.lane ?? options.lane ?? null;
  const footage = story ? Boolean(storyBase(story)) : lane === 'footage-led';
  const scenes = new Map((Array.isArray(story?.scenes) ? story.scenes : []).map((scene) => [scene?.id, scene]));
  if (!Array.isArray(map.sections) || !map.sections.length) {
    err('sections must be a non-empty list');
    return { ok: false, errors, warnings };
  }
  const sectionIds = new Set();
  const lines = [];
  map.sections.forEach((section, s) => {
    const where = `sections[${s}]${section?.id ? ` (${section.id})` : ''}`;
    if (!isObject(section)) { err(`${where} must be an object`); return; }
    for (const key of Object.keys(section)) if (!['id', 'title', 'start', 'end', 'layout', 'beat', 'lines', 'why', 'set', 'segment'].includes(key)) err(`${where} has unknown field "${key}"`);
    if (section.segment !== undefined) {
      if (!nonEmpty(section.segment)) err(`${where}.segment must name one of the style's segment formats`);
      else if (Array.isArray(options.segments) && !options.segments.some((entry) => entry?.id === section.segment)) err(`${where}.segment "${section.segment}" is not one of the style's segment formats (${options.segments.map((entry) => entry?.id).join(', ') || 'none'})`);
    }
    if (!nonEmpty(section.id)) err(`${where}.id is required`);
    else if (sectionIds.has(section.id)) err(`${where}.id "${section.id}" is used twice`);
    else sectionIds.add(section.id);
    for (const key of ['start', 'end']) if (section[key] !== undefined && !(finite(section[key]) && section[key] >= 0)) err(`${where}.${key} must be seconds`);
    if (finite(section.start) && finite(section.end) && section.end <= section.start) err(`${where}.end must be after start`);
    if (section.layout !== undefined) {
      if (!DIRECTION_LAYOUTS.includes(section.layout)) err(`${where}.layout must be one of ${DIRECTION_LAYOUTS.join(', ')}`);
      else if (!footage && section.layout !== 'full') err(`${where}.layout "${section.layout}" is a footage layout; only footage-led stories have a presenter to lay out`);
    }
    if (section.beat !== undefined && !NARRATIVE_BEATS.includes(section.beat)) err(`${where}.beat must be one of ${NARRATIVE_BEATS.join(', ')}`);
    if (!Array.isArray(section.lines) || !section.lines.length) { err(`${where}.lines must be a non-empty list`); return; }
    section.lines.forEach((line, l) => lines.push({ line, where: `${where}.lines[${l}]`, section }));
  });
  for (const { line, where } of lines) checkLine(line, where, { err, warnings, words, footage, scenes, story, options });
  checkWordCoverage(lines, words, err);
  // A narrative (character) map names the key action of every line with cast
  // cues, and of at least one line in each section: an idea that is an action
  // is acted (docs/DIRECTION_GUARDRAILS.md §2).
  map.sections.forEach((section, s) => {
    if (!isObject(section) || section.beat === undefined || !Array.isArray(section.lines)) return;
    const where = `sections[${s}]${section.id ? ` (${section.id})` : ''}`;
    section.lines.forEach((line, l) => {
      if (isObject(line) && Array.isArray(line.cast) && line.cast.length && line.action === undefined) err(`${where}.lines[${l}] has cast cues but no key action; name what a character does on screen to show this line: action {verb: ${ACTION_VERBS.slice(0, 7).join(' | ')} | a pose, who, target?}`);
    });
    if (!section.lines.some((line) => isObject(line) && line.action !== undefined)) err(`${where} (beat ${section.beat}) names no key action; give at least one of its lines an action {verb, who, target?} that a cast scene performs`);
  });
  return { ok: errors.length === 0, errors, warnings };
}

function checkLine(line, where, { err, warnings, words, footage, scenes, story, options }) {
  if (!isObject(line)) { err(`${where} must be an object`); return; }
  for (const key of Object.keys(line)) if (!['words', 'intent', 'treatment', 'scenes', 'why', 'cast', 'set', 'text', 'action'].includes(key)) err(`${where} has unknown field "${key}"`);
  const range = line.words;
  const rangeOk = Array.isArray(range) && range.length === 2 && range.every(Number.isInteger) && range[0] >= 0 && range[1] >= range[0];
  if (!rangeOk) err(`${where}.words must be [first, last] word indexes (inclusive, first ≤ last)`);
  else if (words.length && range[1] >= words.length) err(`${where}.words [${range.join(', ')}] runs past the narration's ${words.length} words (last index ${words.length - 1})`);
  if (!DIRECTION_INTENTS.includes(line.intent)) err(`${where}.intent must be one of ${DIRECTION_INTENTS.join(', ')}`);
  if (!DIRECTION_TREATMENTS.includes(line.treatment)) { err(`${where}.treatment must be one of ${DIRECTION_TREATMENTS.join(', ')}`); return; }
  const named = line.scenes;
  if (named !== undefined && (!Array.isArray(named) || !named.every(nonEmpty))) err(`${where}.scenes must be a list of scene ids`);
  const ids = Array.isArray(named) ? named.filter(nonEmpty) : [];
  if ((line.treatment === 'dress' || line.treatment === 'insert') && !ids.length) err(`${where} is "${line.treatment}", so it names the scenes that show it (scenes: ["…"])`);
  if ((line.treatment === 'face' || line.treatment === 'camera') && !nonEmpty(line.why)) err(`${where} holds on "${line.treatment}", which needs a short why (what the plain shot does here)`);
  if (line.treatment === 'face' && !footage) err(`${where} is "face", but this story has no presenter; dress or insert it`);
  if (line.cast !== undefined && !Array.isArray(line.cast)) err(`${where}.cast must be a list of cues`);
  if (line.set !== undefined && !nonEmpty(line.set)) err(`${where}.set must be a set name`);
  if (line.action !== undefined) {
    const action = line.action;
    if (!isObject(action)) err(`${where}.action must be {verb, who, target?}`);
    else {
      for (const key of Object.keys(action)) if (!['verb', 'who', 'target'].includes(key)) err(`${where}.action has unknown field "${key}"`);
      if (!ACTION_VERBS.includes(action.verb)) err(`${where}.action.verb must be one of ${ACTION_VERBS.join(', ')}`);
      if (!nonEmpty(action.who)) err(`${where}.action.who must name the character who does it`);
    }
  }
  if ((line.cast !== undefined || line.set !== undefined) && typeof options.validateCast === 'function') {
    const result = options.validateCast(line, options.cast ?? null);
    const found = Array.isArray(result) ? { errors: result, warnings: [] } : { errors: result?.errors ?? [], warnings: result?.warnings ?? [] };
    for (const message of found.errors) err(`${where}: ${message}`);
    for (const message of found.warnings) warnings.push(`${where}: ${message}`);
  }
  if (options.deferScenes || !story || !rangeOk || !words.length || range[1] >= words.length) return;
  const start = words[range[0]].start, end = words[range[1]].end;
  for (const id of ids) {
    const scene = scenes.get(id);
    if (!scene) { err(`${where} names scene "${id}", which is not in the storyboard`); continue; }
    const a = Number(scene.start), b = Number(scene.end);
    if (!(finite(a) && finite(b))) continue;
    if (!(a < end && b > start)) err(`${where} names scene "${id}" (${round(a)}–${round(b)} s), which does not overlap the line's words (${round(start)}–${round(end)} s)`);
    else if (line.treatment === 'insert' && footage && scene.insert !== true) warnings.push(`${where} is an insert, but scene "${id}" is an overlay (no insert: true); the presenter stays on screen`);
    else if (line.treatment === 'dress' && scene.insert === true) warnings.push(`${where} is dressed beside the presenter, but scene "${id}" is a full-frame insert; call the line an insert`);
    else if (line.treatment === 'camera' && !CAMERA_ONLY_MODULES.includes(scene.module)) warnings.push(`${where} is a camera line, but scene "${id}" (${scene.module}) draws a graphic; call the line dress`);
  }
}

// Every word in exactly one line, lines in order.
function checkWordCoverage(lines, words, err) {
  if (!words.length) return;
  const owner = new Array(words.length).fill(null);
  let previous = -1;
  for (const { line, where } of lines) {
    const range = line?.words;
    if (!(Array.isArray(range) && range.length === 2 && range.every(Number.isInteger) && range[0] <= range[1])) continue;
    if (range[0] <= previous) err(`${where}.words [${range.join(', ')}] starts before the previous line ends (word ${previous}); lines run in narration order without overlapping`);
    previous = Math.max(previous, range[1]);
    for (let i = Math.max(0, range[0]); i <= Math.min(words.length - 1, range[1]); i += 1) owner[i] ??= where;
  }
  const missing = [];
  for (let i = 0; i < owner.length; i += 1) if (owner[i] === null) missing.push(i);
  if (missing.length) {
    const spans = [];
    for (const i of missing) if (spans.length && spans.at(-1)[1] === i - 1) spans.at(-1)[1] = i; else spans.push([i, i]);
    const words2 = (span) => words.slice(span[0], span[1] + 1).map((entry) => entry.text).join(' ');
    err(`every line needs an entry: words ${spans.map((span) => `[${span[0]}, ${span[1]}] ("${words2(span).slice(0, 60)}")`).join(', ')} are in no line`);
  }
}

// ---------------------------------------------------------------------------
// Measures

/**
 * Coverage, face time and the longest undressed run from the map and the
 * storyboard (RFC §6.2), plus what each line got. story: resolved
 * storyboard. → {...storyboardMeasures, lines: [{section, words, intent,
 * treatment, start, end, dressed (share of the line under a graphic),
 * missed}], missed: [line…], profile}
 */
export function directionMeasures(map, story, { words, face = null } = {}) {
  const list = narrationWords(words);
  const sections = (map?.sections ?? []).map((section) => {
    const range = sectionRange(section, list);
    return { ...range, layout: section.layout ?? 'full' };
  });
  const measures = storyboardMeasures(story, { sections, face });
  const graphic = measures.intervals.graphic;
  const lines = [];
  for (const section of map?.sections ?? []) for (const line of section.lines ?? []) {
    if (!Array.isArray(line?.words) || !list[line.words[0]] || !list[line.words[1]]) continue;
    const start = list[line.words[0]].start, end = list[line.words[1]].end;
    const span = Math.max(1e-6, end - start);
    let covered = 0;
    for (const [a, b] of graphic) covered += Math.max(0, Math.min(b, end) - Math.max(a, start));
    const dressed = Math.min(1, covered / span);
    const visual = VISUAL_INTENTS.includes(line.intent);
    lines.push({ section: section.id, words: line.words, intent: line.intent, treatment: line.treatment, start: round(start), end: round(end), dressed: round(dressed), missed: visual && dressed < 0.25 && (line.treatment === 'face' || line.treatment === 'camera') });
  }
  return { ...measures, profile: map?.profile ?? null, lines, missed: lines.filter((line) => line.missed) };
}

function sectionRange(section, words) {
  const all = (section.lines ?? []).filter((line) => Array.isArray(line?.words) && words[line.words[0]] && words[line.words[1]]);
  const start = finite(section.start) ? section.start : all.length ? words[all[0].words[0]].start : 0;
  const end = finite(section.end) ? section.end : all.length ? words[all.at(-1).words[1]].end : start;
  return { start, end };
}

// ---------------------------------------------------------------------------
// Drafting

/**
 * Draft a map from an existing storyboard (resolved) and its narration: one
 * section per `sectionSeconds`, a line per sentence, intents from the shared
 * rules, and treatments from what the storyboard already shows over each
 * line. For examples and stories planned before maps existed; a planner or
 * agent writes the map first.
 */
export function draftDirectionMap(story, words, { profile = null, sectionSeconds = 30 } = {}) {
  const footage = Boolean(storyBase(story));
  const scenes = (story?.scenes ?? []).filter((scene) => finite(Number(scene?.start)) && finite(Number(scene?.end)));
  const lines = intentHints(words).map((hint) => {
    const over = scenes.filter((scene) => Number(scene.start) < hint.end && Number(scene.end) > hint.start);
    const graphic = over.filter(isGraphicScene);
    const camera = over.filter((scene) => !isGraphicScene(scene));
    const entry = { words: hint.words, intent: hint.intent };
    if (graphic.length) {
      entry.treatment = !footage || graphic.every((scene) => scene.insert === true) ? 'insert' : 'dress';
      entry.scenes = graphic.map((scene) => scene.id);
    } else if (camera.length && footage) {
      entry.treatment = 'camera';
      entry.scenes = camera.map((scene) => scene.id);
      entry.why = `a ${camera[0].module} lands the line on the presenter`;
    } else if (footage) {
      entry.treatment = 'face';
      entry.why = 'the line plays on the presenter';
    } else {
      // A motion story with a gap: nothing on screen. Name the nearest scene so
      // validation points at the empty plate rather than a missing entry.
      const nearest = [...scenes].sort((a, b) => Math.abs(Number(a.start) - hint.start) - Math.abs(Number(b.start) - hint.start))[0];
      entry.treatment = 'insert';
      entry.scenes = nearest ? [nearest.id] : [];
    }
    return { ...entry, start: hint.start };
  });
  const sections = [];
  for (const line of lines) {
    const index = Math.floor(line.start / sectionSeconds);
    let section = sections.find((entry) => entry.index === index);
    if (!section) { section = { index, id: `s${sections.length + 1}`, lines: [] }; sections.push(section); }
    const { start, ...rest } = line;
    section.lines.push(rest);
  }
  return {
    schema: DIRECTION_SCHEMA,
    ...(profile ? { profile } : {}),
    sections: sections.map(({ index, ...section }) => ({ ...section, layout: 'full' }))
  };
}

/** DIRECTION.json text: two-space JSON with one line per map line. */
export function directionJson(map) {
  return `${JSON.stringify(map, null, 2).replace(/\[\s+([^\[\]{}]*?)\s+\]/g, (match, inner) => `[${inner.split(/,\s+/).join(', ')}]`).replace(/\{\n\s+("words": [^\n]*(?:\n\s+"[^\n]*)*?)\n\s+\}/g, (match, body) => `{ ${body.split(/,\n\s+/).join(', ')} }`)}\n`;
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

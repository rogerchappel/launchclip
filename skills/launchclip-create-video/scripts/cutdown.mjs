// Cut-downs (docs/VIDEO_QUALITY_RFC.md §10.2): a Short from a long video's
// section, re-planned against the Shorts profile rather than cropped.
//
//   chooseCutWindow(map, words, {section, max, min})  → the stretch of
//     narration lines the Short tells
//   cutTrim(resolved, start, end)                      → base.trim source ranges
//   cutWords(words, start, end)                        → the window's words, from 0
//   cutdownStory(resolved, {story, words, window, profile}) → {story, map,
//     words, hook, warnings}
//
// The cut reuses what the long form already made: the base edit (its kept
// source ranges, as base.trim), the mattes and the whole-video face track
// (both in source time, so they still apply) and the scenes in the window,
// moved to the Short's clock with their word anchors mapped. It is laid out
// again for 9:16 (split layouts become stacked), opens on a hook (a card with
// the hook line's key words in the first second) and loops back to it, and is
// dressed until it lands in the Shorts profile's coverage band. It has word
// captions (Shorts are watched muted).
//
// Shorts from a long-form beat map (kit/core/beat-director.mjs), for faceless
// long form with no base edit to trim:
//
//   chooseShortWindows(map, words, {count, min, max}) → 3–5 windows, one per
//     chapter at most, each opening on a hook-able clause
//   shortFromBeatMap(map, words, window, {registered}) → {id, map, story,
//     words, skeleton, report}: the window re-directed at short-form cadence
//     for 9:16, opening on an image (never a title card) and looping back
//   cutShorts(map, words, {count}) → every Short, best first
//
// Pure ESM; imports only kit/core siblings. Canonical copy: kit/core/cutdown.mjs.

import { cadenceGate, cadenceTarget, eventStats, isGraphicScene, storyboardMeasures } from './cadence.mjs';
import { beatMapToStory, directChunk, emptyHistory, windowWords } from './beat-director.mjs';
import { TITLE_CARD_MODULES, chooseSkeleton } from './skeleton-library.mjs';
import { capabilitiesFor, capabilityParams, resolveCapability } from './visual-capabilities.mjs';
import { draftDirectionMap, narrationWords } from './direction.mjs';
import { PROMISE_ID } from './long-form.mjs';
import { resolveModule } from './modules.mjs';
import { parseAnchor, resolveAnchor, storyBase, storySections } from './story.mjs';

export const CUTDOWN_SCHEMA = 'launchclip.cutdown.v1';
export const CUTDOWN_TARGETS = Object.freeze({
  shorts: Object.freeze({ width: 1080, height: 1920, platform: 'youtube-shorts', profile: 'short-talking-head', max: 58, min: 15 })
});
// Intents a Short can open on.
const HOOK_INTENTS = new Set(['hook', 'problem', 'number', 'claim', 'turn', 'quote', 'proof']);
const VISUAL = new Set(['hook', 'claim', 'problem', 'proof', 'number', 'list', 'process', 'product', 'quote', 'cta']);
// A carried scene keeps at least this much of itself, and this share.
const KEEP_SECONDS = 2;
const KEEP_SHARE = 0.6;
const HOOK_SECONDS = 3;
const STOP = new Set(['a', 'an', 'and', 'the', 'so', 'to', 'of', 'for', 'that', 'this', 'it', 'is', 'are', 'was', 'we', 'i', 'you', 'they', 'he', 'she', 'in', 'on', 'at', 'from', 'with', 'which', 'because', 'every', 'each', 'has', 'have', 'nobody', 'again', 'just', 'our', 'your', 'my', 'but', 'or', 'as', 'be', 'by', 'then', 'there', 'here', 'what', 'when', 'how', 'why']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * The stretch of narration the Short tells: consecutive map lines inside one
 * section, from min to max seconds, opening on a line a Short can open on and
 * carrying as many visual lines as it can. section: a map section id (or the
 * chapter id made from it) to cut from; every section otherwise.
 * → {section, title, start, end, words: [first, last], lines: [{words, intent, start, end}]}
 */
export function chooseCutWindow(map, words, { section = null, max = CUTDOWN_TARGETS.shorts.max, min = CUTDOWN_TARGETS.shorts.min } = {}) {
  const list = narrationWords(words);
  const sections = (map?.sections ?? []).filter((entry) => !section || entry.id === section || slug(entry.id) === section);
  if (!sections.length) throw new Error(section ? `no direction-map section "${section}"; the map has ${(map?.sections ?? []).map((entry) => entry.id).join(', ')}` : 'the direction map has no sections to cut from');
  let best = null;
  for (const entry of sections) {
    const lines = (entry.lines ?? []).filter((line) => Array.isArray(line?.words) && list[line.words[0]] && list[line.words[1]])
      .map((line) => ({ words: line.words, intent: line.intent, start: list[line.words[0]].start, end: list[line.words[1]].end }));
    for (let i = 0; i < lines.length; i += 1) {
      for (let j = i; j < lines.length && lines[j].end - lines[i].start <= max; j += 1) {
        const span = lines[j].end - lines[i].start;
        if (span < min) continue;
        const own = lines.slice(i, j + 1);
        const score = (HOOK_INTENTS.has(lines[i].intent) ? 2 : 0) + own.filter((line) => VISUAL.has(line.intent)).length / own.length + span / max;
        if (!best || score > best.score + 1e-9) best = { score, section: entry.id, title: entry.title ?? null, start: lines[i].start, end: lines[j].end, words: [lines[i].words[0], lines[j].words[1]], lines: own };
      }
    }
  }
  if (!best) throw new Error(`no run of lines between ${min} and ${max} s${section ? ` in section "${section}"` : ''} to cut a Short from`);
  const { score, ...window } = best;
  return window;
}

/** The base's kept source ranges inside [start, end] of the long form's timeline, back to back from 0. */
export function cutTrim(resolved, start, end) {
  const base = storyBase(resolved);
  if (!base) return null;
  const out = [];
  for (const segment of base.segments) {
    const from = Math.max(start, segment.start), to = Math.min(end, segment.end);
    if (to - from <= 1e-6) continue;
    const range = [round(segment.sourceStart + (from - segment.start), 6), round(segment.sourceStart + (to - segment.start), 6)];
    if (out.length && Math.abs(out.at(-1)[1] - range[0]) < 1e-3) out.at(-1)[1] = range[1];
    else out.push(range);
  }
  return out;
}

/** The narration words inside [start, end], on the Short's clock. */
export function cutWords(words, start, end) {
  return narrationWords(words).filter((word) => word.start >= start - 1e-6 && word.end <= end + 1e-6)
    .map((word) => ({ text: word.text, start: round(word.start - start), end: round(word.end - start) }));
}

/**
 * A time on the Short's clock for a value of the long form. A word anchor is
 * mapped into the Short's narration: kept when it lands on the same word,
 * re-counted (`word:<text>#n`) when that word is a later occurrence there,
 * and seconds only when no anchor reaches it.
 */
export function mapTime(raw, seconds, start, words) {
  const local = round(seconds - start);
  const parsed = typeof raw === 'string' ? parseAnchor(raw) : null;
  if (parsed?.kind !== 'word') return local;
  const lands = (anchor) => { try { return Math.abs(resolveAnchor(anchor, { words }) - local) < 1e-3; } catch { return false; } };
  if (lands(raw)) return raw;
  const offset = parsed.offset ? `${parsed.offset > 0 ? '+' : ''}${parsed.offset}` : '';
  for (let n = 1; n <= words.length; n += 1) {
    const anchor = `word:${parsed.text}${n > 1 ? `#${n}` : ''}${offset}`;
    if (lands(anchor)) return anchor;
    try { resolveAnchor(`word:${parsed.text}#${n}`, { words }); } catch { break; }
  }
  return local;
}

/**
 * The Short. resolved: the long story resolved (numeric times, base.trim);
 * story: the long story as written (for its anchors); window from
 * chooseCutWindow; profile: the Shorts cadence profile.
 * → {story, map, words, hook: {id, text, line}, carried: [ids], added: [ids], warnings}
 */
export function cutdownStory(resolved, { story = resolved, words, window, profile = null, target = CUTDOWN_TARGETS.shorts } = {}) {
  const warnings = [];
  const fps = Number(resolved.format?.fps ?? 30);
  const { start, end } = paddedWindow(window, words, fps);
  const duration = round(end - start);
  const local = cutWords(words, start, end);
  const raw = new Map((story?.scenes ?? []).map((scene) => [scene?.id, scene]));

  // The scenes in the window, on the Short's clock; chapter structure stays behind.
  const scenes = [];
  const carried = [];
  for (const scene of resolved.scenes ?? []) {
    const a = Number(scene.start), b = Number(scene.end);
    if (scene.id === PROMISE_ID || scene.module === 'section-card') continue;
    const from = Math.max(a, start), to = Math.min(b, end);
    if (to - from < KEEP_SECONDS || (to - from) / Math.max(1e-6, b - a) < KEEP_SHARE) continue;
    const source = raw.get(scene.id) ?? scene;
    const copy = JSON.parse(JSON.stringify(source));
    copy.start = from === a ? mapTime(source.start, a, start, local) : round(from - start);
    copy.end = to === b ? mapTime(source.end, b, start, local) : round(to - start);
    if (Array.isArray(scene.hits)) {
      copy.hits = scene.hits.map((hit, i) => ({ hit, raw: source.hits?.[i] ?? hit })).filter(({ hit }) => finite(Number(hit.at)) && hit.at >= from && hit.at <= to)
        .map(({ hit, raw: written }) => ({ ...written, at: mapTime(written.at, Number(hit.at), start, local) }));
      if (!copy.hits.length) delete copy.hits;
    }
    scenes.push(copy);
    carried.push(scene.id);
  }

  // Footage layouts for 9:16: split beside a panel becomes stacked.
  const sections = [];
  for (const section of storySections(resolved)) {
    let from = Math.max(section.start, start), to = Math.min(section.end, end);
    if (to - from < 2) continue;
    // A layout that starts or ends within a second of the cut holds from the first frame or to the last.
    if (from - start < 1) from = start;
    if (end - to < 1) to = end;
    const layout = section.layout.startsWith('split') ? 'stacked' : section.layout;
    sections.push({ id: section.id, start: round(from - start), end: round(to - start), layout, ...(section.room !== 'keep' ? { room: section.room } : {}) });
  }

  const longBase = isObject(story.base) ? story.base : { src: storyBase(resolved)?.src };
  const base = { src: longBase.src ?? longBase.source, trim: cutTrim(resolved, start, end) };
  for (const key of ['fit', 'focus', 'volume', 'subject']) if (longBase[key] !== undefined) base[key] = JSON.parse(JSON.stringify(longBase[key]));
  if (isObject(base.subject) && Array.isArray(base.subject.mattes)) {
    base.subject.mattes = base.subject.mattes.filter((matte) => base.trim.some(([a, b]) => matte.in < b && matte.out > a));
    if (!base.subject.mattes.length) base.subject = 'auto';
  }

  const audio = { ...(isObject(story.audio) ? story.audio : {}), words: 'NARRATION.json' };
  for (const key of ['mix', 'narration', 'voice']) delete audio[key];
  const frame = isObject(story.frame) ? { ...story.frame } : story.frame;
  if (isObject(frame)) { delete frame.progress; delete frame.labels; }
  const cut = {
    schema: story.schema,
    title: fitText(`${story.title ?? 'Short'}${window.title ? `: ${window.title}` : ''}`, 80),
    lane: resolved.lane,
    format: { width: target.width, height: target.height, fps, duration, platform: target.platform },
    ...(story.style !== undefined ? { style: story.style } : {}),
    brand: story.brand,
    audio,
    base,
    scenes,
    ...(sections.length ? { sections } : {}),
    ...(frame !== undefined ? { frame } : {}),
    // Shorts are watched muted: word captions, carried from the long form or added.
    overlays: (Array.isArray(story.overlays) ? story.overlays.filter((overlay) => overlay?.start === undefined && overlay?.end === undefined) : [])
  };
  if (!cut.overlays.some((overlay) => overlay?.type === 'captions')) cut.overlays.push({ type: 'captions' });
  for (const key of ['motion', 'camera', 'ambient', 'cast']) if (story[key] !== undefined) cut[key] = JSON.parse(JSON.stringify(story[key]));

  // The hook: the opening line's key words on a card in the first second, and the loop back to it.
  const lines = window.lines.map((line) => ({ ...line, start: round(line.start - start), end: round(line.end - start) }));
  const hookLine = lines[0];
  const hookText = lineText(local, hookLine, window.words[0]);
  const hook = { id: 'hook', module: 'concept-card', track: 1, start: 0, end: round(Math.min(Math.max(hookLine.end, 2), HOOK_SECONDS)), params: { text: keyWords(hookText), sub: fitText(hookText, 40) } };
  makeRoom(cut.scenes, hook, local, warnings);
  cut.scenes.unshift(fitCard(hook, cut, local, warnings));
  cut.ending = { loop_to: hook.id };

  // Carried scenes the Short's canvas cannot take (a module's own limits at
  // 9:16, a length it no longer has) stay behind.
  const numbered = withNumbers(cut, local);
  for (const scene of numbered.scenes) {
    if (scene.module === 'custom' || scene.id === hook.id) continue;
    try { resolveModule(scene, numbered); }
    catch (error) {
      warnings.push(`${scene.id} left out: ${String(error?.message ?? error).split('\n')[0]}`);
      cut.scenes = cut.scenes.filter((entry) => entry.id !== scene.id);
      const index = carried.indexOf(scene.id);
      if (index >= 0) carried.splice(index, 1);
    }
  }

  // Dress until the Short lands in the profile's band: no undressed run past
  // the profile's target, and at least its coverage floor.
  const added = [hook.id];
  const limit = profile?.measures?.longest_undressed_seconds?.p50 ?? 4;
  const floor = profile?.measures?.coverage?.p10 ?? 0.35;
  for (let pass = 0; pass < 40; pass += 1) {
    const measures = storyboardMeasures(withNumbers(cut, local));
    const gap = measures.intervals.undressed.filter(([a, b]) => b - a > limit + 1e-6).sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))[0]
      ?? (measures.coverage < floor ? measures.intervals.undressed.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))[0] : null);
    if (!gap || gap[1] - gap[0] < 2.3) break;
    const a = round(gap[0] + 0.15), b = round(Math.min(gap[1] - 0.1, gap[0] + Math.min(3.2, Math.max(2.1, (gap[1] - gap[0]) / 2))));
    const line = lines.find((entry) => entry.start < b && entry.end > a) ?? hookLine;
    const text = lineText(local, line, window.words[0]);
    const id = `dress-${added.length}`;
    const card = fitCard({ id, module: 'concept-card', track: 1, start: a, end: b, params: { text: keyWords(text, added.length) } }, cut, local, warnings);
    if (!card) break;
    cut.scenes.push(card);
    added.push(id);
  }
  cut.scenes.sort((x, y) => Number(sceneTime(x.start, local)) - Number(sceneTime(y.start, local)));

  // The map: the window's lines with their intents, the first a hook,
  // treatments read from what the Short now shows.
  const draft = draftDirectionMap(withNumbers(cut, local), local, { profile: profile?.id ?? target.profile, sectionSeconds: Infinity });
  const intents = new Map(lines.map((line) => [`${line.words[0] - window.words[0]},${line.words[1] - window.words[0]}`, line.intent]));
  for (const line of draft.sections[0]?.lines ?? []) {
    const intent = intents.get(line.words.join(','));
    if (intent) line.intent = intent;
  }
  if (draft.sections[0]?.lines?.[0]) draft.sections[0].lines[0].intent = 'hook';
  if (draft.sections[0]) {
    draft.sections[0].id = slug(window.section) || 's1';
    if (window.title) draft.sections[0].title = window.title;
  }
  return { story: cut, map: draft, words: local, hook: { id: hook.id, text: hookText, line: hookLine.words.map((index) => index - window.words[0]) }, carried, added, warnings };
}

// The window padded to breathe: a beat before the first word, a little after
// the last, never into the neighbouring words, on the frame grid.
function paddedWindow(window, words, fps) {
  const list = narrationWords(words);
  const before = list[window.words[0] - 1];
  const after = list[window.words[1] + 1];
  const start = Math.max(0, window.start - 0.15, before ? before.end + 0.02 : 0);
  const end = Math.min(window.end + 0.35, after ? after.start - 0.02 : Infinity);
  return { start: round(Math.ceil(start * fps - 1e-6) / fps, 6), end: round(Math.floor(end * fps + 1e-6) / fps, 6) };
}

// A card that fits the Short's canvas: as given, without its sub-line, then
// as a full-frame insert (the presenter's head leaves no room beside it).
function fitCard(card, story, words, warnings) {
  const { sub, ...bare } = card.params;
  const variants = [card, ...(sub ? [{ ...card, params: bare }] : []), (({ track, ...rest }) => ({ ...rest, params: bare, insert: true, in: { type: 'fade', dur: 0.2 } }))(card)];
  const numbered = withNumbers(story, words);
  for (const variant of variants) {
    try { resolveModule(variant, { ...numbered, scenes: [...numbered.scenes, variant] }); return variant; }
    catch { /* try the next variant */ }
  }
  warnings.push(`${card.id}: no concept card fits here ("${card.params.text}")`);
  return card.id === 'hook' ? variants.at(-1) : null;
}

// A carried graphic in the hook's way starts after it, or leaves.
function makeRoom(scenes, hook, words, warnings) {
  for (let i = scenes.length - 1; i >= 0; i -= 1) {
    const scene = scenes[i];
    const a = sceneTime(scene.start, words), b = sceneTime(scene.end, words);
    if (!(finite(a) && finite(b)) || !(a < hook.end && b > hook.start) || !isGraphicScene(scene)) continue;
    if (b - (hook.end + 0.05) >= KEEP_SECONDS) {
      scene.start = round(hook.end + 0.05);
      if (Array.isArray(scene.hits)) scene.hits = scene.hits.filter((hit) => !finite(Number(hit.at)) || hit.at >= scene.start);
    } else {
      warnings.push(`${scene.id} left out: the hook card holds the first ${hook.end} s`);
      scenes.splice(i, 1);
    }
  }
}

function lineText(words, line, offset) {
  return words.slice(line.words[0] - offset, line.words[1] - offset + 1).map((word) => word.text).join(' ');
}

/** Up to three key words of a line (no stop words), as a card's big text (≤ 28 characters). */
export function keyWords(text, skip = 0) {
  const tokens = String(text ?? '').split(/\s+/).map((token) => token.replace(/[^\p{L}\p{N}'-]+/gu, '')).filter(Boolean);
  const content = tokens.filter((token) => !STOP.has(token.toLowerCase()) && token.length > 2);
  const pool = content.length ? content : tokens;
  const picked = [];
  for (let i = 0; i < pool.length && picked.length < 3; i += 1) {
    const token = pool[(i + skip) % pool.length];
    if (picked.includes(token)) continue;
    if ([...picked, token].join(' ').length > 28) break;
    picked.push(token);
  }
  const phrase = picked.join(' ') || 'Watch this';
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function sceneTime(value, words) {
  return typeof value === 'number' ? value : resolveAnchor(value, { words });
}

function withNumbers(story, words) {
  return { ...story, resolved: { duration: story.format.duration, fps: story.format.fps }, scenes: story.scenes.map((scene) => ({ ...scene, start: sceneTime(scene.start, words), end: sceneTime(scene.end, words) })) };
}

function fitText(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function slug(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}


// ---------------------------------------------------------------------------
// Shorts from a beat map

export const SHORTS_FORMAT = Object.freeze({ width: 1080, height: 1920, platform: 'youtube-shorts' });
const SHORT_HOOK_KINDS = new Set(['stat', 'money', 'compute', 'share', 'compare', 'series', 'ranking', 'social', 'quote', 'pr', 'commit', 'page']);

/**
 * The windows a long video's Shorts tell: runs of whole states of min–max
 * seconds inside one chapter, opening on a clause a Short can open on (a
 * hook, a number, a quote, evidence), scored for evidence and numbers, at
 * most one per chapter and never overlapping. → [{chapter, title, start,
 * end, words: [a, b], states: [ids], score}], best first.
 */
export function chooseShortWindows(map, words, { count = 4, min = 20, max = 50, perChapter = 1 } = {}) {
  const list = narrationWords(words);
  const candidates = [];
  for (const chapter of map.chapters ?? []) {
    const states = chapter.shots.flatMap((shot) => shot.states);
    for (let i = 0; i < states.length; i += 1) {
      const opener = states[i];
      const hookable = HOOK_INTENTS.has(opener.intent) || SHORT_HOOK_KINDS.has(opener.kind) || Boolean(opener.evidence);
      if (!hookable || /^(and|but|so|or|then|which)\b/i.test(opener.text)) continue;
      for (let j = i; j < states.length; j += 1) {
        const span = list[states[j].words[1]].end - list[opener.words[0]].start;
        if (span > max) break;
        if (span < min || !/[.!?]["”')]?$/.test(states[j].text)) continue;
        const own = states.slice(i, j + 1);
        const evidence = own.filter((state) => state.evidence?.source).length / own.length;
        const numbers = own.filter((state) => SHORT_HOOK_KINDS.has(state.kind)).length / own.length;
        const score = (opener.evidence ? 1 : 0) + (SHORT_HOOK_KINDS.has(opener.kind) ? 1 : 0) + evidence + numbers + span / max;
        candidates.push({ chapter: chapter.id, title: chapter.title, start: round(list[opener.words[0]].start), end: round(list[states[j].words[1]].end), words: [opener.words[0], states[j].words[1]], states: own.map((state) => state.id), score: round(score) });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.start - b.start);
  const picked = [];
  for (const candidate of candidates) {
    if (picked.length >= count) break;
    if (picked.filter((entry) => entry.chapter === candidate.chapter).length >= perChapter) continue;
    if (perChapter === 1 && picked.some((entry) => candidate.start < entry.end && candidate.end > entry.start)) continue;
    picked.push(candidate);
  }
  return picked;
}

/**
 * One Short from a window of the long form: its clauses re-directed at the
 * short-form cadence on a 9:16 canvas (wide-only modules swap for portrait
 * ones, layouts re-flow), a library skeleton when one fits (the viral formats
 * RFC), the first frame an image rather than a title card, word captions,
 * and the ending looping back to the hook. The short's map and story run on
 * its own clock; its states keep their long-form word indexes.
 * → {id, title, window, skeleton, map, story, words, report: {cadence, gate}}
 */
export function shortFromBeatMap(map, words, window, { registered = null, brand = undefined, style = 'default', index = 0 } = {}) {
  const target = cadenceTarget('short-form', style);
  const chapter = map.chapters.find((entry) => entry.id === window.chapter);
  const chunk = { id: `short-${index + 1}`, chapter: { id: chapter.id, title: chapter.title, index: 0 }, words: window.words, first: false };
  const { shots } = directChunk(chunk, { words, history: emptyHistory(), target, format: SHORTS_FORMAT, brand, ...(registered ? { registered } : {}), ledger: null, captures: [] });
  // Evidence carries over from the long form's decisions on the same words.
  const longStates = chapter.shots.flatMap((shot) => shot.states);
  const states = shots.flatMap((shot) => shot.states);
  for (const state of states) {
    const source = longStates.find((entry) => entry.words[0] <= state.words[0] && entry.words[1] >= state.words[0] && entry.evidence);
    if (source && !state.evidence) state.evidence = source.evidence;
  }
  // The first frame is an image, never a title card.
  const first = states[0];
  if (TITLE_CARD_MODULES.includes(first.module)) {
    for (const id of capabilitiesFor(first.kind === 'title' ? 'concept' : first.kind, { wide: false })) {
      const module = resolveCapability(id, registered ? { registered } : {}).module;
      if (TITLE_CARD_MODULES.includes(module)) continue;
      const params = capabilityParams(module, first);
      if (params) { Object.assign(first, { capability: id, module, params, why: `${first.why}; the first frame is an image, not a title card` }); break; }
    }
  }
  const text = narrationWords(words).slice(window.words[0], window.words[1] + 1).map((word) => word.text).join(' ');
  const skeleton = chooseSkeleton({ prompt: text, duration: window.end - window.start, aspect: '9:16', medium: 'motion' }).skeleton;
  const shift = (t) => round(Math.max(0, t - window.start));
  for (const shot of shots) { shot.start = shift(shot.start); shot.end = shift(shot.end); for (const state of shot.states) { state.start = shift(state.start); state.end = shift(state.end); } }
  const duration = round(window.end - window.start + 0.4);
  shots.at(-1).end = duration;
  shots.at(-1).states.at(-1).end = duration;
  const id = `short-${index + 1}-${slug(window.chapter)}`.slice(0, 48);
  const short = { schema: map.schema, title: fitText(`${map.title ?? 'Short'}: ${window.title}`, 80), format: SHORTS_FORMAT, cadence: { format: 'short-form', style }, duration, source: { chapter: window.chapter, start: window.start, end: window.end, words: window.words }, chapters: [{ id: chapter.id, title: chapter.title, start: 0, end: duration, plate: chapter.plate, background: chapter.background, shots }] };
  const events = states.filter((state) => state.start > 0).map((state) => state.start);
  const cuts = shots.filter((shot) => shot.start > 0).map((shot) => shot.start);
  const stats = eventStats(events, { duration, cuts });
  const local = windowWords(words, window.start, window.end + 0.4);
  const story = beatMapToStory(short, { from: 0, to: duration, title: short.title, chapters: false, brand, format: SHORTS_FORMAT });
  if (story.scenes.length) story.ending = { loop_to: story.scenes[0].id };
  return { id, title: short.title, window, skeleton: skeleton ? { id: skeleton.id, family: skeleton.family } : null, map: short, story, words: local, report: { cadence: stats, gate: cadenceGate(stats, target) } };
}

/**
 * 3–5 Shorts from a long-form beat map, best first: the best-scoring window
 * per chapter whose Short passes the short-form cadence gate (the best
 * window when none does), never overlapping.
 */
export function cutShorts(map, words, { count = 4, min = 20, max = 50, registered = null, brand = undefined } = {}) {
  const want = Math.max(3, Math.min(5, count));
  const windows = chooseShortWindows(map, words, { count: Infinity, min, max, perChapter: Infinity });
  const byChapter = new Map();
  for (const window of windows) {
    const entry = byChapter.get(window.chapter) ?? { best: null, passing: null, tried: 0 };
    if (entry.passing || entry.tried >= 6) continue;
    entry.tried += 1;
    const short = shortFromBeatMap(map, words, window, { registered, brand });
    entry.best ??= short;
    if (short.report.gate.ok) entry.passing = short;
    byChapter.set(window.chapter, entry);
  }
  const ranked = [...byChapter.values()].map((entry) => entry.passing ?? entry.best).sort((a, b) => Number(b.report.gate.ok) - Number(a.report.gate.ok) || b.window.score - a.window.score);
  return ranked.slice(0, want).map((short, index) => ({ ...shortFromBeatMap(map, words, short.window, { registered, brand, index }) }));
}

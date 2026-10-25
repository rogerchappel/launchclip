// Long form (docs/VIDEO_QUALITY_RFC.md §10.2): structure before density.
// A long video's direction-map sections become its chapters; the structure
// pass gives the story an opening promise, a section card at each chapter
// start and a progress line with chapter ticks in the brand frame, and the
// chapters travel into the render metadata, chapters.txt and the NLE exports.
//
//   chaptersFromMap(map, words, {duration})  → [{id, title, start, segment?}]
//   structureLongForm(story, {words, map})   → {story, map, chapters, added,
//                                               changed, warnings}
//   youtubeChapters(chapters)                → chapters.txt text (0:00 Title)
//   youtubeChapterProblems(chapters, duration) → why YouTube would ignore them
//   ffmetadataChapters(chapters, {duration}) → an FFMETADATA1 document
//
// The chapter contract itself (story.chapters, validateChapters,
// storyChapters) is in kit/core/story.mjs, which stays import-free.
//
// Pure ESM; imports only kit/core siblings. Canonical copy: kit/core/long-form.mjs.

import { CHAPTER_MIN_COUNT, CHAPTER_MIN_SECONDS, resolveStory, storyBase, storyChapters } from './story.mjs';
import { isGraphicScene, resetGaps, resetTimes } from './cadence.mjs';
import { narrationWords, segmentLines } from './direction.mjs';
import { isIcon } from './icons.mjs';

// A story this long (or planned to the long-form profile) gets the pass.
export const LONG_FORM_SECONDS = 300;
// Section cards: how long one holds, and the shortest worth showing.
export const SECTION_CARD_SECONDS = 2.6;
export const SECTION_CARD_MIN_SECONDS = 1.4;
// A card may land this long after its chapter starts when a scene is in the way.
export const CARD_LATE_SECONDS = 4;
// The opening promise: what the video will cover, right after the hook.
export const PROMISE_SECONDS = 4.5;
export const PROMISE_MIN_SECONDS = 3;
export const PROMISE_LATEST_SECONDS = 45;
export const PROMISE_ID = 'promise';
// Attention resets (RFC §10.2): planned every `p50` of the profile's
// longest_without_reset_seconds, never more than its p90 apart.
export const RESET_DEFAULT = Object.freeze({ p50: 60, p90: 120 });
// Overlays that can play full frame as an insert instead (catalogue G cards
// place themselves on a plate when they are inserts).
export const INSERT_READY_MODULES = Object.freeze(['concept-card', 'icon-row', 'object-card', 'stat-card', 'quote-card', 'excerpt', 'compare', 'timeline']);
// A layout-change reset holds this long (it ends before the next reset).
export const RESET_LAYOUT_SECONDS = 20;
// A scene the pass moves keeps at least this much of itself.
const KEEP_SECONDS = 1;
const GAP = 0.05;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** The scene id of a chapter's section card. */
export function sectionCardId(chapterId) {
  return `chapter-${chapterId}`;
}

/** Whether a story (or the profile it plans to) is long form. */
export function isLongForm(story, profile = null) {
  if (profile?.id === 'youtube-long-form') return true;
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration);
  return duration >= LONG_FORM_SECONDS;
}

/**
 * Chapters from a direction map's sections: one per section, starting at its
 * first word (or its `start`), the first at 0. A section shorter than
 * CHAPTER_MIN_SECONDS joins the chapter after it (a last one, the chapter
 * before), so the list stays one YouTube reads. → [{id, title, start, segment?}]
 */
export function chaptersFromMap(map, words, { duration = null } = {}) {
  const list = narrationWords(words);
  const sections = (Array.isArray(map?.sections) ? map.sections : []).filter(isObject);
  const raw = sections.map((section, index) => {
    const first = (section.lines ?? []).find((line) => Array.isArray(line?.words) && list[line.words[0]]);
    const start = finite(section.start) ? section.start : first ? list[first.words[0]].start : null;
    return { id: slug(section.id) || `c${index + 1}`, title: chapterTitle(section, index), start, ...(nonEmpty(section.segment) ? { segment: section.segment } : {}) };
  }).filter((chapter) => finite(chapter.start));
  raw.sort((a, b) => a.start - b.start);
  if (!raw.length) return [];
  raw[0].start = 0;
  const end = finite(duration) ? duration : Infinity;
  const out = [];
  for (const chapter of raw) {
    if (chapter.start >= end) continue;
    const previous = out.at(-1);
    if (previous && chapter.start - previous.start < CHAPTER_MIN_SECONDS) {
      // The chapter before is too short: it joins this one, which keeps its start.
      Object.assign(previous, { ...chapter, start: previous.start });
      continue;
    }
    out.push({ ...chapter, start: round(chapter.start) });
  }
  while (out.length > 1 && end - out.at(-1).start < CHAPTER_MIN_SECONDS) out.pop();
  return out;
}

function chapterTitle(section, index) {
  const title = nonEmpty(section.title) ? section.title.trim() : `Part ${index + 1}`;
  return title.length > 60 ? `${title.slice(0, 59).trimEnd()}…` : title;
}

function slug(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

// ---------------------------------------------------------------------------
// The structure pass

/**
 * Give a long story its structure (RFC §10.2), deterministically, on a copy:
 *   - story.chapters from the direction map's sections (kept when the story
 *     already has them);
 *   - an opening promise (icon-row "In this video": the chapters to come)
 *     after the hook line;
 *   - a section card at each chapter start after the first (an insert in
 *     the footage-led lane), numbered, titled from the chapter;
 *   - a progress line with chapter ticks in the brand frame (frame labels
 *     fall back to the chapter titles).
 * A planned scene in a card's way starts later, ends sooner or shortens the
 * card; a card with no room is skipped with a warning. Running it again
 * replaces what it added. The map gains section titles and names the new
 * scenes on the lines they cover.
 *   - recurring segment formats (options.segments, the style's): a section
 *     or chapter titled like a segment is that segment; its card takes the
 *     segment's kicker and icon, and its chapter holds the segment's layout
 *     (a `segment-<chapter>` footage section);
 *   - attention resets (footage-led): wherever a run with no layout change,
 *     insert or section card is longer than the reset target, an overlay
 *     card near the target time becomes an insert, else a `reset-n` footage
 *     section switches the layout for up to 20 s.
 * options: {words, map, profile (its longest_without_reset_seconds sets the
 *   reset target, p50, and ceiling, p90), promise: true, cards: true,
 *   segments (style.segments), resets: true, frame: true, cardSeconds,
 *   kicker(chapter, n), icon(chapter)}
 * → {story, map, chapters, added: [{id, module, start, end, kind}],
 *    changed: [{id, start, end, was}], resets: {target, ceiling, times,
 *    longest, promoted: [ids], sections: [ids]}, segments: [{chapter,
 *    segment, card, layout, modules}], warnings}
 */
export function structureLongForm(story, options = {}) {
  const { words = [], map = null } = options;
  const out = JSON.parse(JSON.stringify(story));
  const mapOut = map ? JSON.parse(JSON.stringify(map)) : null;
  const warnings = [];
  const added = [];
  const changed = [];
  const list = narrationWords(words);
  const duration = Number(out?.format?.duration);
  const footage = Boolean(storyBase(out));
  // Footage-led overlays sit above the base (track 1); inserts and motion scenes on track 0.
  const overlayTrack = footage ? 1 : 0;

  // Drop what an earlier pass added, so the pass is idempotent.
  const ours = (scene) => scene?.id === PROMISE_ID || (typeof scene?.id === 'string' && scene.id.startsWith('chapter-') && scene.module === 'section-card');
  out.scenes = (Array.isArray(out.scenes) ? out.scenes : []).filter((scene) => !ours(scene));
  if (mapOut) for (const section of mapOut.sections ?? []) for (const line of section.lines ?? []) {
    if (Array.isArray(line.scenes)) line.scenes = line.scenes.filter((id) => id !== PROMISE_ID && !String(id).startsWith('chapter-'));
  }
  if (Array.isArray(out.sections)) {
    out.sections = out.sections.filter((section) => !/^(segment|reset)-/.test(String(section?.id)));
    if (!out.sections.length) delete out.sections;
  }

  // Recurring segment formats: a map section named like a style segment is that segment.
  const segments = (Array.isArray(options.segments) ? options.segments : []).filter((segment) => isObject(segment) && nonEmpty(segment.id));
  if (mapOut) for (const section of mapOut.sections ?? []) {
    if (nonEmpty(section.segment)) continue;
    const hit = matchSegment(section.title, segments);
    if (hit) section.segment = hit.id;
  }

  if (!Array.isArray(out.chapters) || !out.chapters.length) {
    const chapters = chaptersFromMap(mapOut, list, { duration });
    if (chapters.length) out.chapters = chapters;
    else warnings.push('no chapters: the story has no chapters and no direction map sections to make them from');
  }
  if (mapOut && Array.isArray(out.chapters)) {
    for (const section of mapOut.sections ?? []) {
      const chapter = out.chapters.find((entry) => entry.id === slug(section.id));
      if (chapter && !nonEmpty(section.title)) section.title = chapter.title;
      if (chapter && nonEmpty(section.segment) && !nonEmpty(chapter.segment)) chapter.segment = section.segment;
    }
  }
  if (Array.isArray(out.chapters)) for (const chapter of out.chapters) {
    if (!isObject(chapter) || nonEmpty(chapter.segment)) continue;
    const hit = matchSegment(chapter.title, segments);
    if (hit) chapter.segment = hit.id;
  }

  const resolved = resolveStory(out, { words: list });
  const chapters = storyChapters(resolved);
  if (chapters.length && chapters.length < CHAPTER_MIN_COUNT) warnings.push(`${chapters.length} chapter${chapters.length === 1 ? '' : 's'}: YouTube shows chapters only with at least ${CHAPTER_MIN_COUNT}; give the direction map more sections`);
  const scenes = resolved.scenes.map((scene) => ({ ...scene, start: Number(scene.start), end: Number(scene.end) }));
  const raw = new Map(out.scenes.map((scene) => [scene.id, scene]));
  const lines = mapLines(mapOut, list);

  // Make room for a new graphic over [a, a + want] (min `least`); returns the
  // window it got, or null. Scenes in the way move when they can keep their lines.
  const place = (a, want, least, { label, late = 0, track = 0, quiet = false }) => {
    let start = a, end = Math.min(duration, a + want);
    const moves = [];
    // In the way: anything on the new scene's track, and any graphic.
    for (const scene of [...scenes].sort((x, y) => x.start - y.start)) {
      if (!((scene.track ?? 0) === track || isGraphicScene(scene)) || !(scene.start < end && scene.end > start)) continue;
      if (scene.start >= start - 1e-6) {
        // Starts inside the window: start it after the window, or end the window at it.
        const from = end + GAP;
        if (scene.end - from >= KEEP_SECONDS && keepsLines(scene, from, scene.end, lines)) moves.push({ scene, start: from, end: scene.end });
        else end = Math.min(end, scene.start - GAP);
      } else {
        // Runs across the window's start: end it before, or start the window after it.
        const to = start - GAP;
        if (to - scene.start >= KEEP_SECONDS && keepsLines(scene, scene.start, to, lines)) moves.push({ scene, start: scene.start, end: to });
        else if (scene.end + GAP - a <= late) { start = scene.end + GAP; end = Math.min(duration, start + want); }
        else end = start;
      }
    }
    if (end - start < least - 1e-6) {
      if (!quiet) warnings.push(`${label}: no room at ${round(a)} s (planned scenes fill it); move a scene or place it by hand`);
      return null;
    }
    // A move may only take what the final window needs.
    for (const move of moves) {
      if (!(move.scene.start < end && move.scene.end > start)) continue;
      const was = [move.scene.start, move.scene.end];
      const target = raw.get(move.scene.id);
      move.scene.start = round(move.start); move.scene.end = round(move.end);
      if (target) {
        target.start = move.scene.start; target.end = move.scene.end;
        if (Array.isArray(target.hits)) target.hits = (move.scene.hits ?? []).filter((hit) => finite(Number(hit.at)) && hit.at >= move.scene.start && hit.at <= move.scene.end);
      }
      changed.push({ id: move.scene.id, start: move.scene.start, end: move.scene.end, was: was.map(round) });
    }
    return { start: round(start), end: round(end) };
  };

  const add = (scene, kind) => {
    out.scenes.push(scene);
    scenes.push({ ...scene });
    added.push({ id: scene.id, module: scene.module, start: scene.start, end: scene.end, kind });
    nameOnLines(mapOut, lines, scene, footage && scene.insert === true ? 'insert' : 'dress');
  };

  // Section cards first: the chapter starts are fixed, the promise can move.
  if (options.cards !== false) {
    chapters.slice(1).forEach((chapter) => {
      const n = chapter.index + 1;
      const slot = place(chapter.start, options.cardSeconds ?? SECTION_CARD_SECONDS, SECTION_CARD_MIN_SECONDS, { label: `section card for chapter "${chapter.id}"`, late: CARD_LATE_SECONDS });
      if (!slot) return;
      const segment = segments.find((entry) => entry.id === chapter.segment) ?? null;
      const kicker = typeof options.kicker === 'function' ? options.kicker(chapter, n) : segment ? segment.kicker ?? (segment.title !== chapter.title ? segment.title : null) : null;
      const icon = options.icon?.(chapter) ?? (segment?.icon && isIcon(segment.icon) ? segment.icon : null);
      const params = { title: fit(chapter.title, 48), kicker: fit(kicker ?? `Chapter ${n}`, 28), ...(icon ? { icon } : { number: n }) };
      add({ id: sectionCardId(chapter.id), module: 'section-card', start: slot.start, end: slot.end, ...(footage ? { insert: true } : {}), in: { type: 'fade', dur: 0.25 }, params }, 'section-card');
    });
  }

  if (options.promise !== false) {
    const upcoming = chapters.slice(1, 6);
    if (upcoming.length < 2) {
      if (chapters.length) warnings.push('no opening promise: it lists the chapters to come, and there are fewer than two');
    } else {
      // Right after the hook line, else at the next line start that has room.
      const narration = lines.length ? lines : segmentLines(list);
      const at = narration[0] ? narration[0].end + 0.1 : 2;
      const limit = Math.min(PROMISE_LATEST_SECONDS, chapters[1].start - 0.5);
      const starts = [at, ...narration.slice(1).map((line) => line.start).filter((start) => start > at)].filter((start) => start + PROMISE_MIN_SECONDS <= limit);
      let slot = null;
      for (const start of starts) {
        slot = place(start, Math.min(PROMISE_SECONDS, limit - start), PROMISE_MIN_SECONDS, { label: 'opening promise', late: PROMISE_SECONDS, track: overlayTrack, quiet: true });
        if (slot) break;
      }
      if (!slot) warnings.push(starts.length ? `no opening promise: no room for ${PROMISE_MIN_SECONDS} s between ${round(at)} and ${round(limit)} s (planned scenes fill it); leave a line after the hook free` : `no opening promise: the first chapter is too short to hold one after the hook (${round(at)}–${round(limit)} s)`);
      if (slot) {
        const items = upcoming.map((chapter) => ({ icon: options.icon?.(chapter) ?? chapterIcon(chapter), label: fit(chapter.title, 24) }));
        add({ id: PROMISE_ID, module: 'icon-row', ...(overlayTrack ? { track: overlayTrack } : {}), start: slot.start, end: slot.end, params: { title: 'In this video', items } }, 'promise');
      }
    }
  }

  const segmentPlan = segments.length ? applySegments({ out, chapters, segments, scenes, mapOut, footage, warnings }) : [];

  const resets = options.resets !== false && footage ? planResets({ out, scenes, raw, mapOut, lines, duration, profile: options.profile, warnings }) : null;

  if (options.frame !== false && chapters.length > 1) {
    if (out.frame === false) warnings.push('frame: false, so there is no progress line; chapters still export');
    else {
      const frame = isObject(out.frame) ? out.frame : {};
      if (frame.progress === undefined || frame.progress === false) frame.progress = { ticks: true };
      else if (frame.progress === true) frame.progress = { ticks: true };
      out.frame = frame;
    }
  }

  out.scenes.sort((a, b) => (Number(a.start) - Number(b.start)) || 0);
  return { story: out, map: mapOut, chapters: storyChapters(resolveStory(out, { words: list })), added, changed, resets, segments: segmentPlan, warnings };
}

/** The style segment a title names: its title, or one of its `match` phrases, ignoring case. */
export function matchSegment(title, segments = []) {
  const text = String(title ?? '').toLowerCase();
  if (!text.trim()) return null;
  return segments.find((segment) => [segment.title, ...(Array.isArray(segment.match) ? segment.match : [])].some((phrase) => nonEmpty(phrase) && text.includes(phrase.toLowerCase()))) ?? null;
}

// Segment chapters hold the segment's layout (a `segment-<chapter>` footage
// section over the chapter) and should show its preferred modules.
function applySegments({ out, chapters, segments, scenes, mapOut, footage, warnings }) {
  const plan = [];
  const portrait = Number(out.format?.height) > Number(out.format?.width);
  for (const chapter of chapters) {
    const segment = segments.find((entry) => entry.id === chapter.segment);
    if (!segment) {
      if (chapter.segment) warnings.push(`chapter "${chapter.id}" names segment "${chapter.segment}", which the style does not define`);
      continue;
    }
    const entry = { chapter: chapter.id, segment: segment.id, card: chapter.index > 0 ? sectionCardId(chapter.id) : null, layout: null };
    if (segment.layout && segment.layout !== 'full' && footage) {
      const sections = Array.isArray(out.sections) ? out.sections : [];
      const clash = sections.some((section) => Number(section.start) < chapter.end && Number(section.end) > chapter.start);
      if (segment.layout === 'stacked' && !portrait) warnings.push(`segment "${segment.id}": stacked is a 9:16 layout; chapter "${chapter.id}" keeps its layout`);
      else if (clash) warnings.push(`segment "${segment.id}": chapter "${chapter.id}" already has a footage section, so it keeps that layout`);
      else {
        out.sections = [...sections, { id: `segment-${chapter.id}`, start: chapter.start, end: chapter.end, layout: segment.layout }].sort((a, b) => Number(a.start) - Number(b.start));
        entry.layout = segment.layout;
        const section = mapOut?.sections?.find((item) => slug(item.id) === chapter.id);
        if (section) section.layout = segment.layout;
      }
    }
    if (Array.isArray(segment.modules) && segment.modules.length) {
      const own = scenes.filter((scene) => scene.start >= chapter.start && scene.start < chapter.end);
      entry.modules = [...new Set(own.map((scene) => scene.module).filter((module) => segment.modules.includes(module)))];
      if (!entry.modules.length) warnings.push(`segment "${segment.id}": chapter "${chapter.id}" uses none of its modules (${segment.modules.join(', ')}); plan at least one so the segment looks like itself`);
    }
    plan.push(entry);
  }
  return plan;
}

/** The reset target and ceiling for a profile: {p50, p90}. */
export function resetBand(profile) {
  const band = profile?.measures?.longest_without_reset_seconds;
  return { p50: band?.p50 ?? band?.p90 ?? RESET_DEFAULT.p50, p90: band?.p90 ?? RESET_DEFAULT.p90 };
}

// Plan attention resets into the long runs (mutates out, scenes, raw and the map).
function planResets({ out, scenes, raw, mapOut, lines, duration, profile, warnings }) {
  const band = resetBand(profile);
  const portrait = Number(out.format?.height) > Number(out.format?.width);
  const mapSections = () => (mapOut?.sections ?? []).map((section) => {
    const own = lines.filter((entry) => entry.section === section);
    return { start: own[0]?.start ?? section.start, end: own.at(-1)?.end ?? section.end, layout: section.layout ?? 'full' };
  });
  const current = () => {
    const inserts = scenes.filter((scene) => scene.insert === true).map((scene) => [scene.start, scene.end]).sort((a, b) => a[0] - b[0]);
    return resetTimes(out, scenes, { sections: mapSections(), inserts, duration });
  };
  const promoted = [];
  const added = [];
  let times = current();
  for (const [a, b] of resetGaps(times, duration)) {
    const span = b - a;
    if (span <= band.p50 + 1e-6) continue;
    const count = Math.ceil(span / band.p50) - 1;
    for (let i = 1; i <= count; i += 1) {
      const want = a + (span * i) / (count + 1);
      const reach = Math.min(band.p50 / 3, span / (count + 1) / 2);
      const chosen = promoteNear(want, reach, { scenes, raw }) ?? null;
      if (chosen) {
        promoted.push(chosen.id);
        for (const { line } of lines) if (Array.isArray(line.scenes) && line.scenes.includes(chosen.id) && line.treatment === 'dress') line.treatment = 'insert';
        continue;
      }
      const section = layoutReset(out, want, { span: Math.min(RESET_LAYOUT_SECONDS, span / (count + 1) - 1), portrait, scenes });
      if (section) added.push(section.id);
      else warnings.push(`attention reset: nothing to reset at ${round(want)} s (no overlay card to make an insert, no room for a layout change); add an insert or a layout change between ${round(a)} and ${round(b)} s`);
    }
  }
  times = current();
  const longest = resetGaps(times, duration).reduce((max, [a, b]) => Math.max(max, b - a), 0);
  if (longest > band.p90 + 1e-6) warnings.push(`attention reset: ${round(longest)} s with no reset is still past the ${band.p90} s ceiling`);
  return { target: band.p50, ceiling: band.p90, times: times.map((t) => round(t)), longest: round(longest), promoted, sections: added };
}

// The overlay card nearest `want` (within `reach`) that can become an insert:
// an insert-ready catalogue card of 1.5–10 s with nothing else on screen.
function promoteNear(want, reach, { scenes, raw }) {
  const candidates = scenes.filter((scene) => INSERT_READY_MODULES.includes(scene.module) && scene.insert !== true && (scene.track ?? 0) >= 1
    && scene.end - scene.start >= 1.5 && scene.end - scene.start <= 10 && Math.abs(scene.start - want) <= reach
    && !scenes.some((other) => other !== scene && other.start < scene.end && other.end > scene.start && ((other.track ?? 0) === 0 || isGraphicScene(other))));
  candidates.sort((x, y) => Math.abs(x.start - want) - Math.abs(y.start - want));
  const scene = candidates[0];
  if (!scene) return null;
  const target = raw.get(scene.id);
  if (!target) return null;
  delete target.track; delete scene.track;
  target.insert = true; scene.insert = true;
  if (target.in === undefined) target.in = { type: 'fade', dur: 0.25 };
  return scene;
}

// A footage section that switches the layout at `want` (split beside a panel
// in landscape, stacked in portrait) where no section, insert or card is.
function layoutReset(out, want, { span, portrait, scenes }) {
  if (!(span >= 4)) return null;
  const sections = Array.isArray(out.sections) ? out.sections : [];
  const start = round(want), end = round(want + span);
  const clash = sections.some((section) => Number(section.start) < end && Number(section.end) > start)
    || scenes.some((scene) => scene.insert === true && scene.start < end && scene.end > start);
  if (clash) return null;
  const id = `reset-${sections.filter((section) => String(section.id).startsWith('reset-')).length + 1}`;
  const section = { id, start, end, layout: portrait ? 'stacked' : 'split-right' };
  out.sections = [...sections, section].sort((a, b) => Number(a.start) - Number(b.start));
  return section;
}

// Each map line with its times and section.
function mapLines(map, words) {
  const out = [];
  for (const section of map?.sections ?? []) for (const line of section.lines ?? []) {
    if (!Array.isArray(line?.words) || !words[line.words[0]] || !words[line.words[1]]) continue;
    out.push({ line, section, start: words[line.words[0]].start, end: words[line.words[1]].end });
  }
  return out.sort((a, b) => a.start - b.start);
}

// Whether a scene moved to [start, end] still overlaps every line naming it.
function keepsLines(scene, start, end, lines) {
  return lines.every(({ line, start: a, end: b }) => !(Array.isArray(line.scenes) && line.scenes.includes(scene.id)) || (start < b && end > a));
}

// Name a new scene on the face and camera lines it covers, which now carry it.
function nameOnLines(map, lines, scene, treatment) {
  if (!map) return;
  for (const entry of lines) {
    const { line } = entry;
    if (!(scene.start < entry.end && scene.end > entry.start)) continue;
    if (line.treatment !== 'face' && line.treatment !== 'camera') continue;
    line.treatment = treatment;
    line.scenes = [...new Set([...(Array.isArray(line.scenes) ? line.scenes : []), scene.id])];
  }
}

const ICON_WORDS = [
  [/\b(tool|kit|setup|stack|config)/i, 'wrench'], [/\b(problem|mistake|wrong|pain|fail)/i, 'alert'], [/\b(fix|solution|answer)/i, 'check-circle'],
  [/\b(demo|watch|show|walkthrough)/i, 'play'], [/\b(result|number|data|growth|metric)/i, 'chart-up'], [/\b(why|question|faq)/i, 'help'],
  [/\b(how|process|step|workflow)/i, 'workflow'], [/\b(idea|tip|lesson|insight)/i, 'lightbulb'], [/\b(launch|ship|start)/i, 'rocket'],
  [/\b(money|price|cost)/i, 'dollar'], [/\b(code|build|api)/i, 'code'], [/\b(next|recap|summary|wrap)/i, 'flag']
];
const ICON_CYCLE = ['target', 'lightbulb', 'workflow', 'chart-up', 'flag'];

/** An icon for a chapter from its title, else one from a fixed cycle. */
export function chapterIcon(chapter) {
  const hit = ICON_WORDS.find(([pattern]) => pattern.test(chapter?.title ?? ''));
  return hit ? hit[1] : ICON_CYCLE[(chapter?.index ?? 0) % ICON_CYCLE.length];
}

function fit(text, max) {
  const value = String(text ?? '').trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Planner and skill guidance

/** Lines the direction-map prompt and reference carry for long form. */
export function longFormLines() {
  return [
    `Long form (${LONG_FORM_SECONDS / 60} min and up, or the youtube-long-form profile): each section is a chapter. Give every section a short \`title\` (2–5 words, the chapter name viewers see in the YouTube chapter list) and make each one at least ${CHAPTER_MIN_SECONDS} s; aim for 3–10 chapters, a new one every 1–3 minutes.`,
    'The first section opens with the hook line and the promise: say what the video will cover. The structure pass adds an "In this video" icon-row of the chapters after the hook line, a section-card insert at each later chapter start, and a progress line with chapter ticks in the brand frame (`launchclip story long-form`; the headless planner runs it).',
    'Leave the first 2–3 s of each chapter free of other scenes so its section card has room; a planned scene in the way starts later or the card shortens.',
    'Attention resets: plan a layout change (a section with another layout), an insert line or a section card about every minute (the profile\'s longest_without_reset_seconds p50), never more than its p90 apart. Where a run is longer, the structure pass turns an overlay card near the right time into an insert, else switches the layout for up to 20 s.'
  ];
}

/**
 * Markdown reference for the create-video skills
 * (skills-src/references/long-form.md, generated by scripts/sync-skills.mjs).
 */
export function longFormReference() {
  const lines = [
    '# Long form: chapters, resets, segments and cut-downs',
    '',
    '<!-- Generated from kit/core/long-form.mjs by scripts/sync-skills.mjs. Do not edit by hand; run `npm run skills:sync`. -->',
    '',
    `A video of ${LONG_FORM_SECONDS / 60} minutes or more (the \`youtube-long-form\` profile) needs structure before density: chapters, an opening promise, a section card per chapter, a progress line, and an attention reset about every minute. Its sections can then be cut into Shorts that are re-planned for 9:16, not cropped. Design: \`docs/VIDEO_QUALITY_RFC.md\` §10.2 in the LaunchClip repo.`,
    '',
    '## Steps',
    '',
    '1. Write `DIRECTION.json` first ([direction-map.md](direction-map.md)). Each section is a chapter: give it a short `title`, at least 10 s, and a new one every 1–3 minutes. When the style defines recurring segments (`segments` in its style.json), set the section\'s `"segment": "<id>"` and title it like the segment.',
    '2. Author `storyboard.json` against the map. Leave the first 2–3 s of each chapter free for its section card.',
    '3. Run `launchclip story long-form <project>`. It writes `chapters`, the "In this video" promise after the hook, a section card at each chapter start (the segment\'s kicker and icon for a segment chapter, which also holds the segment\'s layout), the progress line with chapter ticks, and the attention resets. It prints what it added and moved. Run it again after any edit; it replaces what it added.',
    '4. `launchclip story validate storyboard.json` fails a run with no reset past the profile\'s ceiling, and warns when YouTube would ignore the chapters (fewer than 3, or one under 10 s).',
    '5. `launchclip finish <project> --prototype`, then `launchclip finish <project>`. It writes `renders/chapters.txt` for the YouTube description and puts the chapters in the MP4 and in `launchclip export`.',
    '6. To fix one chapter, edit it and run `launchclip finish <project> --chapter <id>`: only that chapter re-renders, the master is stitched from the cache, and the chapter is also written alone to `renders/chapters/<id>.mp4`.',
    '7. Cut a Short with `launchclip cutdown <project> --to shorts [--section <id>]`. It picks the strongest 15–58 s run of lines in the section (or in the whole video) and writes a new 9:16 project at `<project>/cutdowns/<section>-shorts/`. Review its `storyboard.json` and `CUTDOWN.json`, then run `launchclip finish` on it. The cut must pass the Shorts profile, which its receipt reports.',
    '',
    '## Rules',
    '',
    ...longFormLines().map((line) => `- ${line}`),
    `- Section cards hold ${SECTION_CARD_SECONDS} s (at least ${SECTION_CARD_MIN_SECONDS} s, up to ${CARD_LATE_SECONDS} s late when a scene is in the way); the promise holds ${PROMISE_SECONDS} s within the first ${PROMISE_LATEST_SECONDS} s.`,
    `- A reset turns an overlay card near the right time into an insert (${INSERT_READY_MODULES.join(', ')}), else switches the layout for up to ${RESET_LAYOUT_SECONDS} s (split-right, or stacked in portrait).`,
    '',
    '## Cut-downs',
    '',
    '- **Reused from the long form:** the base edit (its kept source ranges, as `base.trim`), the mattes and the whole-video face track (in source time, hard-linked under `assets/`), and the scenes in the window. Word anchors are re-counted for the Short\'s narration (`word:<text>#n`); only one no word reaches becomes seconds.',
    '- **Re-planned for Shorts:** split layouts become `stacked`. The chapter structure (promise, section cards, progress line) stays behind. Scenes the 9:16 canvas cannot take are left out with a warning. The cut gets word captions.',
    '- **Hook and loop:** the cut opens on a hook card with the first line\'s key words in the first second, and `ending.loop_to` returns to it.',
    '- **Density:** concept cards dress any undressed run past the Shorts profile\'s target until coverage is in its band.',
    '- **Planner:** `--model provider:model` re-plans the section with the planner (paid calls) instead of the free deterministic pass, keeping the base edit and the loop.',
    ''
  ];
  return `${lines.join('\n').trimEnd()}\n`;
}

// ---------------------------------------------------------------------------
// Exports

/** A YouTube timestamp: m:ss, or h:mm:ss from an hour. */
export function youtubeTimestamp(seconds) {
  const total = Math.max(0, Math.floor(seconds + 1e-6));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** chapters.txt for a YouTube description: one "0:00 Title" line per chapter. */
export function youtubeChapters(chapters) {
  return `${(chapters ?? []).map((chapter) => `${youtubeTimestamp(chapter.start)} ${String(chapter.title).replace(/\s+/g, ' ').trim()}`).join('\n')}\n`;
}

/** Why YouTube would not show these chapters (empty when it would). */
export function youtubeChapterProblems(chapters, duration) {
  const list = chapters ?? [];
  const problems = [];
  if (!list.length) return ['no chapters'];
  if (Math.floor(list[0].start) !== 0) problems.push('the first chapter does not start at 0:00');
  if (list.length < CHAPTER_MIN_COUNT) problems.push(`${list.length} chapters; YouTube needs at least ${CHAPTER_MIN_COUNT}`);
  list.forEach((chapter, index) => {
    const end = index + 1 < list.length ? list[index + 1].start : duration;
    if (finite(end) && end - chapter.start < CHAPTER_MIN_SECONDS) problems.push(`chapter "${chapter.id}" runs ${round(end - chapter.start)} s; YouTube needs at least ${CHAPTER_MIN_SECONDS} s`);
  });
  return problems;
}

/** An FFMETADATA1 document carrying the chapters (millisecond timebase), for muxing into the MP4. */
export function ffmetadataChapters(chapters, { duration, title = null } = {}) {
  const escape = (value) => String(value).replace(/([=;#\\\n])/g, '\\$1');
  const lines = [';FFMETADATA1'];
  if (nonEmpty(title)) lines.push(`title=${escape(title)}`);
  (chapters ?? []).forEach((chapter, index) => {
    const end = index + 1 < chapters.length ? chapters[index + 1].start : duration;
    lines.push('', '[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(chapter.start * 1000)}`, `END=${Math.round(Number(end) * 1000)}`, `title=${escape(chapter.title)}`);
  });
  return `${lines.join('\n')}\n`;
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

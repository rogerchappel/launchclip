// The stacked talking head (`make --layout stacked`): a 9:16 footage-led short
// where the presenter stays on screen the whole way through, in the lower part
// of the frame, under a graphics panel that changes with every sentence.
//
//   stacked     while a panel scene is on: graphics panel on top, presenter
//               below (STACKED.share of the height), one colour world
//   take        with no panel scene on: the presenter full frame, so the
//               panel is never up with nothing in it
//   close-up    a `full` section with a zoom: the presenter fills the frame
//               on a personal line, held STACKED.face seconds, cut in and out
//   insert      the panel takes the frame for a big visual, the voice goes on
//
// The planner writes only the moments that leave the default (close-ups and
// inserts) as sections; applyStackedLayout turns them into back-to-back
// sections over the whole video, clamps their holds and puts the captions on
// the seam, one word at a time. stackedLayoutErrors and stackedFaceWarnings
// check the result. The geometry is kit/core/footage-layout.mjs.

import { CAMERA_ONLY_MODULES } from "@launchclip/core/cadence.mjs";
import { layoutPlan, layoutStateAt } from "@launchclip/core/footage-layout.mjs";
import { resolveStory } from "@launchclip/core/story.mjs";
import { cameraPoint, presenterHead } from "./presenter_box.js";
import { SHOT_LAYOUT_SLOTS, SHOT_MODULES } from "./asset_provider.js";

// Where a stacked story's captions go: one word at a time, on the seam.
export const STACKED_CAPTIONS = Object.freeze({ position: "seam", preset: "seam-word", max_words: 1 });
export const STACKED = Object.freeze({
  // The presenter's share of the height; the panel takes the rest.
  share: 0.45,
  // A close-up: its zoom, and how long it holds (seconds).
  zoom: 1.2,
  face: Object.freeze({ min: 1.5, max: 4 }),
  // A close-up at least this often (seconds), in a video longer than that.
  faceEvery: 20,
  // The panel taking the whole frame (an insert) holds at most this long.
  insertMax: 5,
  // A gap shorter than this between two moments is absorbed, not a stacked flash.
  minStacked: 1.2,
  // The panel stays up across a gap between two panel scenes shorter than this, and how long it takes to slide in or away.
  panelGap: 1.5,
  shift: 0.4
});

const EPS = 1e-6;
const round3 = (value) => Math.round(value * 1000) / 1000;

/** Planner instructions for a stacked run. */
export function stackedPrompt() {
  return [
    "## Stacked talking head (this run)",
    "",
    `The presenter stays on screen for the whole video. While a panel scene is on they sit in the bottom ${Math.round(STACKED.share * 100)}% of the frame under a graphics panel; with none on they take the whole frame. Tooling builds the layout from your scenes: write sections ONLY for the moments below, and leave every other second to tooling.`,
    `- Close-up: \`{id, start, end, layout: "full"}\` on a personal, emotional or turning-point line (a confession, a result, "here's the thing"), ${STACKED.face.min}–${STACKED.face.max} s. Aim for one every 10–15 s; never two back to back.`,
    `- Big visual: \`{id, start, end, layout: "insert"}\` only for footage, a screen, a demo or a full chart that needs the whole frame, at most ${STACKED.insertMax} s. Never for a card, a title, a list or a number: those show in the panel (tooling drops such an insert).`,
    "- Every other scene renders in the panel as an overlay (track 1, never insert: true, which would cover the presenter): give each sentence its own visual there (a shot, a screen, a prop, a number), changing on the sentence's first word. No stretch of more than one sentence with the same panel.",
    "- A numbered framework or list (\"3 things\", \"step 2\") gets one recurring motif in the panel that builds as each item lands (the same diagram gaining its next part, a counter), not a new unrelated card per item.",
    "- Keep one colour world: every panel scene on the same background family (the brand's bg, or paper, or ink), no plate changes between sentences.",
    "- Panel titles are short (≤ 7 words) with one accent word; the captions are one word at a time on the seam between the panel and the presenter, so keep panel content clear of the panel's bottom edge."
  ].join("\n");
}

/**
 * The storyboard with its sections rebuilt for the stacked layout: the
 * planner's close-ups (`full`) and inserts kept and clamped, stacked
 * sections over every other second, the captions on the seam.
 * options: {words, beats, duration}. → {storyboard, changed: [..], skipped: reason | null}
 */
export function applyStackedLayout(storyboard, { words = [], beats = null, duration = null } = {}) {
  if (!storyboard || storyboard.lane !== "footage-led") return { storyboard, changed: [], skipped: "the stacked layout needs a footage-led (talking-head) story" };
  const width = Number(storyboard.format?.width), height = Number(storyboard.format?.height);
  if (!(height > width)) return { storyboard, changed: [], skipped: "the stacked layout is for 9:16 stories" };
  const total = Number(duration ?? storyboard.format?.duration);
  if (!(total > 0)) return { storyboard, changed: [], skipped: "the story has no duration" };
  const copy = structuredClone(storyboard);
  const changed = [];
  dropCardInserts(copy, { words, beats }, changed);
  const moments = plannedMoments(copy, { words, beats, total }, changed);
  // A panel scene is an overlay: an insert's own background would cover the presenter's window, leaving it empty under the card.
  // Only a scene inside an insert section keeps the whole frame.
  const inserts = moments.filter((moment) => moment.layout === "insert");
  let times = new Map();
  if (inserts.length) try { times = new Map(resolveStory(structuredClone(copy), { words, beats }).scenes.map((scene) => [scene.id, scene])); } catch { times = null; }
  for (const scene of times ? copy.scenes ?? [] : []) {
    if (scene?.insert !== true) continue;
    const at = times.get(scene.id), middle = at ? (Number(at.start) + Number(at.end)) / 2 : null;
    if (inserts.length && (middle === null || inserts.some((moment) => middle >= moment.start - EPS && middle < moment.end))) continue;
    delete scene.insert;
    scene.track = 1;
    changed.push(`insert ${scene.id} became a panel scene (the presenter stays under it)`);
  }
  const panel = (Array.isArray(storyboard.sections) ? storyboard.sections : []).find((section) => section?.layout === "stacked" && section.panel)?.panel;
  // The panel is up only while it has something to show: with no panel scene on, the presenter takes the whole frame.
  const shown = panelSpans(copy, { words, beats, total });
  const sections = [];
  let clock = 0;
  let n = 0, takes = 0;
  // A change between the panel and the full take slides (layout-shift); the video's first section and a planned moment cut.
  const shift = () => (sections.length && !["insert"].includes(sections.at(-1).layout) && !(sections.at(-1).zoom > 1) ? { type: "layout-shift", dur: STACKED.shift } : { type: "cut" });
  const stackedSection = (start, end) => {
    n += 1;
    sections.push({ id: `stack-${n}`, start: round3(start), end: round3(end), layout: "stacked", side: "bottom", share: STACKED.share, ...(panel ? { panel } : {}), transition: shift() });
  };
  const stacked = (from, to) => {
    if (!shown) { stackedSection(from, to); return; }
    let at = from;
    for (const [start, end] of shown) {
      const a = Math.max(from, start), b = Math.min(to, end);
      if (b - a < STACKED.minStacked - EPS) continue;
      // A sliver of plain take before the panel is not worth a move: the panel comes up early instead.
      const begin = a - at < STACKED.minStacked - EPS ? at : a;
      if (begin > at + EPS) { takes += 1; sections.push({ id: `take-${takes}`, start: round3(at), end: round3(begin), layout: "full", zoom: 1, transition: shift() }); }
      stackedSection(begin, b);
      at = b;
    }
    if (to - at < STACKED.minStacked - EPS && sections.length && sections.at(-1).layout === "stacked" && Math.abs(sections.at(-1).end - round3(at)) < EPS) sections.at(-1).end = round3(to);
    else if (to > at + EPS) { takes += 1; sections.push({ id: `take-${takes}`, start: round3(at), end: round3(to), layout: "full", zoom: 1, transition: shift() }); }
  };
  for (const moment of moments) {
    if (moment.start - clock >= STACKED.minStacked - EPS) stacked(clock, moment.start);
    else if (moment.start > clock + EPS) { moment.start = clock; }
    const section = { id: moment.id, start: round3(moment.start), end: round3(moment.end), layout: moment.layout, transition: { type: "cut" } };
    if (moment.layout === "full") section.zoom = moment.zoom;
    sections.push(section);
    clock = moment.end;
  }
  if (total - clock >= STACKED.minStacked - EPS || !sections.length) stacked(clock, total);
  else if (sections.length) sections.at(-1).end = round3(total);
  copy.sections = sections;
  const captions = (Array.isArray(copy.overlays) ? copy.overlays : []).find((overlay) => overlay?.type === "captions");
  if (captions) {
    if (captions.position !== STACKED_CAPTIONS.position) changed.push(`captions moved to the ${STACKED_CAPTIONS.position} (was ${captions.position ?? "auto"})`);
    delete captions.style;
    Object.assign(captions, STACKED_CAPTIONS);
  }
  return { storyboard: copy, changed, skipped: null };
}

// What earns the whole frame: footage, a picture, a screen, a demo, a chart or
// a drawn scene. A card (a checklist, a title, a stat) reads in the panel, and
// alone on the frame it leaves most of it empty with the presenter gone.
const WHOLE_FRAME = new Set([...SHOT_MODULES, ...Object.keys(SHOT_LAYOUT_SLOTS), "product-demo", "evidence-clip", "app-stage", "phone-stage", "ui-scene", "device-frame", "window-chrome", "cast-scene", "world", "heatmap", "map-highlight"]);
const wholeFrame = (scene) => WHOLE_FRAME.has(scene.module) || /-chart$/.test(scene.module);

// An insert section the planner wrote for a card is dropped, so the card shows in the panel over the presenter.
function dropCardInserts(story, { words, beats }, changed) {
  const planned = (Array.isArray(story.sections) ? story.sections : []).filter((section) => section?.layout === "insert");
  if (!planned.length) return;
  let resolved = null;
  try { resolved = resolveStory(structuredClone({ ...story, sections: planned }), { words, beats }); } catch { return; }
  const times = new Map(resolved.sections.map((section) => [section.id, section]));
  const dropped = new Set();
  for (const section of planned) {
    const time = times.get(section.id);
    if (!time) continue;
    const inside = resolved.scenes.filter((scene) => Math.min(Number(scene.end), Number(time.end)) - Math.max(Number(scene.start), Number(time.start)) > (Number(scene.end) - Number(scene.start)) / 2);
    if (inside.length && !inside.some(wholeFrame)) { dropped.add(section.id); changed.push(`insert ${section.id} dropped: ${inside.map((scene) => `${scene.id} (${scene.module})`).join(", ")} shows in the panel, with the presenter under it`); }
  }
  if (dropped.size) story.sections = story.sections.filter((section) => !dropped.has(section?.id));
}

// When the panel has something to show: the panel scenes' times (every scene
// above the recording that is not a camera move), joined across gaps too
// short to drop the panel for. → [[start, end]] in order, or null when the
// scene times do not resolve (the panel then stays up, as before).
function panelSpans(story, { words, beats, total }) {
  let resolved = null;
  try { resolved = resolveStory(structuredClone(story), { words, beats }); } catch { return null; }
  const spans = resolved.scenes
    .filter((scene) => Number(scene.track ?? 0) >= 1 && scene.insert !== true && !CAMERA_ONLY_MODULES.includes(scene.module))
    .map((scene) => [Math.max(0, Number(scene.start)), Math.min(total, Number(scene.end))])
    .filter(([start, end]) => Number.isFinite(start) && end > start)
    .sort((a, b) => a[0] - b[0]);
  const joined = [];
  for (const [start, end] of spans) {
    const last = joined.at(-1);
    if (last && start - last[1] < STACKED.panelGap - EPS) last[1] = Math.max(last[1], end);
    else joined.push([start, end]);
  }
  return joined;
}

// The planner's close-ups and inserts, resolved to seconds, clamped and in order.
// Tooling's own plain takes (zoom 1) from an earlier pass are not the planner's: they are rebuilt.
function plannedMoments(story, { words, beats, total }, changed) {
  const planned = (Array.isArray(story.sections) ? story.sections : []).filter((section) => section && ((section.layout === "full" && section.zoom !== 1) || section.layout === "insert"));
  if (!planned.length) return [];
  let resolved = null;
  try { resolved = resolveStory(structuredClone({ ...story, sections: planned }), { words, beats }); } catch { resolved = null; }
  const times = new Map((resolved?.sections ?? []).map((section) => [section.id, section]));
  const out = [];
  for (const section of planned) {
    const time = times.get(section.id) ?? section;
    let start = Number(time.start), end = Number(time.end);
    if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) { changed.push(`section ${section.id} dropped: its times did not resolve`); continue; }
    start = Math.max(0, start);
    end = Math.min(total, end);
    const max = section.layout === "full" ? STACKED.face.max : STACKED.insertMax;
    if (end - start > max + EPS) { changed.push(`${section.layout === "full" ? "close-up" : "insert"} ${section.id} held ${round3(end - start)} s; cut to ${max} s`); end = start + max; }
    if (section.layout === "full" && end - start < STACKED.face.min - EPS) { changed.push(`close-up ${section.id} dropped: ${round3(end - start)} s is shorter than ${STACKED.face.min} s`); continue; }
    const zoom = typeof section.zoom === "number" && section.zoom > 1 ? section.zoom : STACKED.zoom;
    out.push({ id: section.id, layout: section.layout, start, end, zoom });
  }
  out.sort((a, b) => a.start - b.start);
  // No overlaps, and never two close-ups back to back.
  const kept = [];
  for (const moment of out) {
    const previous = kept.at(-1);
    if (previous && moment.start < previous.end + EPS) { changed.push(`section ${moment.id} dropped: it overlaps ${previous.id}`); continue; }
    if (previous && previous.layout === "full" && moment.layout === "full" && moment.start - previous.end < STACKED.minStacked - EPS) { changed.push(`close-up ${moment.id} dropped: it follows close-up ${previous.id} with no panel between`); continue; }
    kept.push(moment);
  }
  return kept;
}

/**
 * The stacked layout's rules on a storyboard with resolved section times, as
 * repair errors ("stacked: …"), plus warnings.
 * options: {seconds}. → {errors, warnings}
 */
export function stackedLayoutErrors(storyboard, { seconds = Number(storyboard?.format?.duration) } = {}) {
  const errors = [], warnings = [];
  const sections = (Array.isArray(storyboard?.sections) ? storyboard.sections : []).filter((section) => typeof section?.start === "number" && typeof section?.end === "number");
  if (!sections.length) { errors.push("stacked: the story has no sections; the stacked layout needs them over the whole video"); return { errors, warnings }; }
  for (const section of sections) {
    const hold = section.end - section.start;
    if (section.layout === "full" && section.zoom !== 1 && hold > STACKED.face.max + 0.05) errors.push(`stacked: close-up ${section.id} holds ${round3(hold)} s; keep a close-up to ${STACKED.face.max} s`);
    if (section.layout === "insert" && hold > STACKED.insertMax + 0.05) errors.push(`stacked: insert ${section.id} holds ${round3(hold)} s; the presenter leaves the frame for at most ${STACKED.insertMax} s`);
  }
  const captions = (storyboard.overlays ?? []).find((overlay) => overlay?.type === "captions");
  if (captions && captions.position !== STACKED_CAPTIONS.position) errors.push(`stacked: the captions sit at "${captions.position ?? "auto"}"; a stacked story puts them on the ${STACKED_CAPTIONS.position}`);
  if (seconds > STACKED.faceEvery) {
    let last = 0;
    for (const section of [...sections.filter((entry) => entry.layout === "full"), { start: seconds, end: seconds }]) {
      if (section.start - last > STACKED.faceEvery + EPS) warnings.push(`stacked: no close-up between ${round3(last)} s and ${round3(section.start)} s; a personal line in that stretch could go full frame`);
      last = section.end;
    }
  }
  return { errors, warnings };
}

/**
 * Where the presenter's head lands in each stacked stretch, from the subject
 * data (the matte or the whole-video track): a warning when its middle falls
 * outside the presenter's window, or the head is cut by the seam. A story
 * with no subject data gets no warnings. story: a resolved story.
 */
export function stackedFaceWarnings(story) {
  const plan = layoutPlan(story);
  if (!plan) return [];
  const warnings = [];
  for (const span of plan.spans.filter((entry) => entry.layout === "stacked")) {
    const head = presenterHead(story, span.start, span.end);
    if (!head) continue;
    const state = layoutStateAt(plan, round3((span.start + span.end) / 2));
    const map = (px, py) => cameraPoint(state.camera, plan.canvas, px, py);
    const [cx, cy] = map(head.x + head.width / 2, head.y + head.height / 2);
    const [, top] = map(head.x, head.y);
    const win = state.window;
    if (cx < win.x || cx > win.x + win.width || cy < win.y || cy > win.y + win.height) warnings.push(`stacked: in ${span.id ?? "a stacked stretch"} (${round3(span.start)}–${round3(span.end)} s) the presenter's face sits outside their window`);
    else if (top < win.y - EPS) warnings.push(`stacked: in ${span.id ?? "a stacked stretch"} (${round3(span.start)}–${round3(span.end)} s) the seam cuts the top of the presenter's head`);
  }
  return warnings;
}

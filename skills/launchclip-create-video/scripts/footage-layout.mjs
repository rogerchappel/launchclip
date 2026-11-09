// Footage layouts (docs/VIDEO_QUALITY_RFC.md §7.1): a footage-led story's
// `sections` each hold one layout for a stretch of the timeline, and the
// scenes inside render within it.
//
//   layout        presenter                           graphics area (the panel)
//   full          full frame                          overlays only (no section)
//   split-left    reframed onto the left side         a brand panel on the right
//   split-right   reframed onto the right side        a brand panel on the left
//   framed        inset in a rounded frame            the rest of the canvas
//   stacked       bottom (or top) `share` of the      the rest (above or below)
//                 height (half by default), 9:16 only
//   insert        hidden; the voice continues         the full canvas
//
// A full section with a `zoom` above 1 is a close-up: the head is framed in
// the middle of the canvas at that scale (a punch-in held for the section).
//
// The presenter is reframed by the base camera (the same transform punch-in
// uses, kit/core/catalog-c.mjs cameraOps): the head, measured from the matte
// or the whole-video track (subjectContext), is moved to the middle of the
// presenter's window. The panel is one element, #lc-layout-frame: a box at
// the window whose box-shadow (an optional ring in the accent colour, then a
// spread wider than the canvas in the panel colour) paints everything outside
// it. One element means a change of layout is one interpolation of its rect,
// radius and the camera: the `layout-shift` transition (deriveBoundaries
// reports it, so evidence and boundary checks see it). Both compilers set the
// same props on the same frames (layoutOps), so the renderers agree.
//
// Captions sit on the presenter's side (captionZone): in a split, framed or
// stacked section the caption band narrows to the presenter's window, a
// gutter in from its edges, and moves into the window when it would fall
// outside it; full and insert keep the band. Each caption line takes the
// zone of the section it is mostly spoken in, so a line never crosses the
// seam between the panel and the footage.
//
// Stacking: base, behind scenes, the subject, the layout frame, every other
// scene, captions. A section's `room` dims ("dim") or hides ("replace") the
// recording behind the cut-out presenter where a matte covers it.
//
// Breakout (a framed-bottom or stacked section with `breakout: true`): the
// presenter's head rises over the top edge of their window, in front of the
// panel. The camera puts the edge BREAKOUT_EDGE of the way down the head, the
// cut-out is mounted over the section, and the frame is drawn twice: a copy
// under the subject (#lc-layout-frame-under) paints the panel behind the
// head, and the frame above the subject is clipped away over the breakout
// zone (breakoutNotch), so it still trims the cut-out at the window's sides
// and bottom. It needs a matte over the section, like a room treatment.
//
// Canonical copy: kit/core/footage-layout.mjs.

import { captionsOverlayOf } from "./captions.mjs";
import { captionBandAt, profileGeometry } from "./layout-check.mjs";
import { sourceTimeAt, subjectContext } from "./subject-layer.mjs";
import { SECTION_ROOMS, STACKED_SHARE, layoutSpans, sceneSection, storyBase, storySections } from "./story.mjs";

export { BREAKOUT_LAYOUTS, FOOTAGE_LAYOUTS, LAYOUT_SHIFT, LAYOUT_SIDES, PANEL_ROLES, ROOM_MODES, SECTION_ROOMS, SECTION_TRANSITIONS, STACKED_SHARE, layoutSpans, sceneSection, storySections, validateSections } from "./story.mjs";

export const LAYOUT_FRAME = "lc-layout-frame";
// The frame's copy under the subject, in a story with a breakout section.
export const LAYOUT_FRAME_UNDER = "lc-layout-frame-under";
// Breakout: how far down the head the window's top edge crosses it (about
// eye level), and the least rise (a share of the head) that counts as one.
export const BREAKOUT_EDGE = 0.4;
const BREAKOUT_MIN = 0.15;
const HEX6 = /^#[0-9a-fA-F]{6}$/;
const EPS = 1e-6;

/**
 * The presenter's window and the panel for a layout on a canvas.
 * options: {share} (stacked: the presenter's share of the height).
 * → {window: rect, radius, panel: rect | null} (px)
 */
export function layoutGeometry(layout, side, canvas, { share = STACKED_SHARE.default } = {}) {
  const W = canvas.width, H = canvas.height;
  const portrait = H > W;
  const gutter = Math.round(0.04 * Math.min(W, H));
  const radius = Math.round(0.03 * Math.min(W, H));
  const rect = (x, y, width, height) => ({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
  // The presenter's share of the width in a split.
  const splitShare = portrait ? 0.5 : 0.46;
  switch (layout) {
    case "split-left": { const w = Math.round(W * splitShare); return { window: rect(0, 0, w, H), radius: 0, panel: rect(w, 0, W - w, H) }; }
    case "split-right": { const w = Math.round(W * splitShare); return { window: rect(W - w, 0, w, H), radius: 0, panel: rect(0, 0, W - w, H) }; }
    case "stacked": {
      const h = Math.round(H * Math.min(STACKED_SHARE.max, Math.max(STACKED_SHARE.min, Number(share) || STACKED_SHARE.default)));
      return side === "top" ? { window: rect(0, 0, W, h), radius: 0, panel: rect(0, h, W, H - h) } : { window: rect(0, H - h, W, h), radius: 0, panel: rect(0, 0, W, H - h) };
    }
    case "framed": {
      const s = side ?? (portrait ? "top" : "left");
      if (s === "left" || s === "right") {
        const w = Math.round(W * 0.42);
        const x = s === "left" ? gutter : W - gutter - w;
        return { window: rect(x, gutter, w, H - 2 * gutter), radius, panel: s === "left" ? rect(x + w, 0, W - x - w, H) : rect(0, 0, x, H) };
      }
      const h = Math.round(H * 0.46);
      const y = s === "top" ? gutter : H - gutter - h;
      return { window: rect(gutter, y, W - 2 * gutter, h), radius, panel: s === "top" ? rect(0, y + h, W, H - y - h) : rect(0, 0, W, y) };
    }
    case "insert": return { window: rect(W / 2, H / 2, 0, 0), radius: 0, panel: rect(0, 0, W, H) };
    default: return { window: rect(0, 0, W, H), radius: 0, panel: null };
  }
}

/**
 * The panel's safe area: the graphics area inside the profile's safe zone,
 * a gutter in from the presenter's window and, with captions, above the
 * caption band where it runs under the panel (captionBand: the layout's
 * caption zone, else the profile's band). The brand frame and modules place
 * themselves inside it. bottom: a y the area must end a gutter above (the
 * top of a head that breaks out over the panel).
 * → rect | null
 */
export function panelSafeArea(panel, canvas, { captions = true, captionBand: band, bottom = null } = {}) {
  if (!panel) return null;
  const { safeZone, captionBand: profileBand } = profileGeometry(canvas);
  const captionBand = band ?? profileBand;
  const gutter = Math.round(0.04 * Math.min(canvas.width, canvas.height));
  const x0 = Math.max(panel.x + gutter, safeZone.x), x1 = Math.min(panel.x + panel.width - gutter, safeZone.x + safeZone.width);
  const y0 = Math.max(panel.y + gutter, safeZone.y);
  let y1 = Math.min(panel.y + panel.height - gutter, safeZone.y + safeZone.height);
  if (typeof bottom === "number") y1 = Math.max(y0, Math.min(y1, bottom - gutter));
  // Above the captions where the band runs under the panel.
  if (captions && captionBand.x < x1 && captionBand.x + captionBand.width > x0 && captionBand.y < y1) y1 = Math.max(y0, Math.min(y1, captionBand.y - gutter));
  if (!(x1 - x0 > 0 && y1 - y0 > 0)) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * The layout at timeline t, for modules (resolveModule's ctx.layout):
 * {section, layout, side, presenter: rect, panel: rect | null, safe: rect |
 * null, color} with the section's geometry (not mid-shift), or null outside
 * every section (the full frame).
 */
export function layoutAt(story, t) {
  return sectionLayout(story, storySections(story).find((entry) => t >= entry.start - EPS && t < entry.end - EPS));
}

/**
 * The layout a scene renders in: the section that holds at least half of
 * [start, end], else the layout at its start (layoutAt). A scene that starts
 * a moment before its section (71.0 s against 71.2 s) still gets the panel;
 * validateSections warns so it can be moved.
 */
export function sceneLayoutAt(story, start, end = start) {
  const section = sceneSection(storySections(story), start, end);
  return section ? sectionLayout(story, section) : layoutAt(story, start);
}

function sectionLayout(story, section) {
  if (!section) return null;
  const canvas = { width: Number(story.format?.width), height: Number(story.format?.height) };
  const geometry = layoutGeometry(section.layout, section.side, canvas, { share: section.share });
  const captions = (story.overlays ?? []).some((overlay) => overlay?.type === "captions");
  const rise = breakoutRise(story, section, canvas);
  const captionBand = captionZone(section.layout, section.side, canvas, storyCaptionBand(story, canvas), { share: section.share, position: captionsOverlayOf(story)?.position, rise }) ?? undefined;
  return { section: section.id, layout: section.layout, side: section.side, presenter: geometry.window, panel: geometry.panel, safe: panelSafeArea(geometry.panel, canvas, { captions, captionBand, bottom: rise > 0 ? geometry.window.y - rise : null }), color: section.panel, ...(rise > 0 ? { breakout: rise } : {}) };
}

/**
 * Where the captions sit in a layout: on the presenter's side. The caption
 * band (px) narrows to the presenter's window, a gutter in from its edges,
 * and moves up or down into the window when it would fall outside it; the
 * captions wrap within it. With the captions at the "seam" (options.position)
 * a stacked section centres the band on the line between the panel and the
 * presenter instead, across the full band width; with a breakout (rise: how
 * far the head stands over the seam, px) the band sits on top of the head
 * instead of across the face. options: {share, position, rise}.
 * → rect, or null where the band is unchanged (full, insert, or a window the
 * band already sits inside).
 */
export function captionZone(layout, side, canvas, band, { share, position, rise = 0 } = {}) {
  if (!band || layout === "full" || layout === "insert" || !layout) return null;
  const { window: win } = layoutGeometry(layout, side, canvas, { share });
  if (position === "seam" && layout === "stacked") {
    const seam = side === "top" ? win.y + win.height : win.y;
    const y = rise > 0 && side !== "top" ? Math.max(0, seam - rise - band.height) : seam - band.height / 2;
    return { x: round6(band.x), y: round6(y), width: round6(band.width), height: round6(band.height) };
  }
  const gutter = Math.round(0.04 * Math.min(canvas.width, canvas.height));
  const x0 = Math.max(win.x + gutter, band.x), x1 = Math.min(win.x + win.width - gutter, band.x + band.width);
  const top = win.y + gutter, bottom = win.y + win.height - gutter - band.height;
  if (!(x1 - x0 > 0) || bottom < top) return null;
  const y = Math.min(Math.max(band.y, top), bottom);
  if (Math.abs(x0 - band.x) < EPS && Math.abs(x1 - band.x - band.width) < EPS && Math.abs(y - band.y) < EPS) return null;
  return { x: round6(x0), y: round6(y), width: round6(x1 - x0), height: round6(band.height) };
}

/**
 * The caption zones of a story's sections: [{section, start, end, rect}]
 * (px; sections whose band is unchanged are left out). With the captions at
 * the "chest", a full section's zone (or, with no sections, the whole
 * video's) sits at the presenter's chest (chestZone). Both compilers hand them to captionPlan (ctx.zones) and the
 * layout check checks the captions there.
 */
export function captionZones(story) {
  const canvas = { width: Number(story?.format?.width), height: Number(story?.format?.height) };
  if (!(canvas.width > 0 && canvas.height > 0)) return [];
  const band = storyCaptionBand(story, canvas);
  const position = captionsOverlayOf(story)?.position;
  if (position === "chest" && !storySections(story).length) {
    const duration = Number(story.resolved?.duration ?? story.format?.duration);
    const rect = chestZone(story, canvas, band, 0, duration);
    return rect ? [{ section: null, start: 0, end: duration, rect }] : [];
  }
  return storySections(story)
    .map((section) => ({ section: section.id, start: section.start, end: section.end, rect: position === "chest" && section.layout === "full" ? chestZone(story, canvas, band, section.start, section.end) : captionZone(section.layout, section.side, canvas, band, { share: section.share, position, rise: breakoutRise(story, section, canvas) }) }))
    .filter((zone) => zone.rect);
}

/** The presenter's head (px) where nothing measured it: a fifth of the width wide, its top at 30% of the height. */
export const DEFAULT_HEAD = (canvas) => ({ x: canvas.width * 0.4, y: canvas.height * 0.3, width: canvas.width * 0.2, height: canvas.height * 0.13 });

/**
 * The caption band at the presenter's chest over [start, end]: centred a
 * head-height under the chin, from the measured head (subjectContext), else
 * DEFAULT_HEAD. → rect | null
 */
export function chestZone(story, canvas, band, start = 0, end = start) {
  if (!band) return null;
  const head = subjectContext(story, start, { end })?.head ?? DEFAULT_HEAD(canvas);
  const centre = head.y + head.height * 1.6;
  const y = Math.min(canvas.height - band.height - Math.round(0.04 * canvas.height), Math.max(0, centre - band.height / 2));
  return { x: round6(band.x), y: round6(y), width: round6(band.width), height: round6(band.height) };
}

// The captions overlay's band (px) at its position.
function storyCaptionBand(story, canvas) {
  return captionBandAt(profileGeometry(canvas).captionBand, canvas, captionsOverlayOf(story)?.position);
}

/**
 * The layout plan of a resolved story, or null when it has no sections (so
 * every other story compiles exactly as before).
 * → {sections, ops: [{time, state}], boundaries, rooms: [{start, end, room}], breakouts: [{id, start, end}], canvas, captions (captionZones)}
 * Each state is {window, radius, panel (#hex), ring, ringColor, camera:
 * {scale, x, y}, hidden, breakout? (true while the head breaks out)}: the
 * frame element and the base camera at that time.
 * ops hold a state at 0, every frame of each layout-shift, and each cut; a
 * state holds until the next op.
 */
export function layoutPlan(story) {
  const sections = storySections(story);
  if (!sections.length) return null;
  const canvas = { width: Number(story.format.width), height: Number(story.format.height) };
  const fps = Number(story.resolved?.fps ?? story.format?.fps ?? 30);
  const duration = Number(story.resolved?.duration ?? story.format.duration);
  const spans = layoutSpans(story).spans;
  // A breakout needs the cut-out over its whole window, like a room treatment.
  const warnings = [];
  const wanted = breakoutWindows(story);
  const breakouts = wanted.filter((entry) => matteCovers(story, entry.start, entry.end, fps));
  for (const entry of wanted.filter((item) => !breakouts.includes(item))) warnings.push(`section ${entry.id}: breakout needs a matte over ${entry.start}–${entry.end} s (run: launchclip subject matte <recording> --range <in>-<out> --project <dir>); the head stays inside the frame`);
  const live = new Set(breakouts.map((entry) => entry.id));
  const states = spans.map((span) => spanState(story, span, canvas, { breakout: live.has(span.id) }));
  // Insert keeps the camera it comes from, so the presenter does not jump behind the panel.
  states.forEach((state, index) => { if (state.hidden && index > 0) state.camera = { ...states[index - 1].camera }; });
  const ops = [{ time: 0, state: states[0] }];
  for (let index = 1; index < spans.length; index += 1) {
    const from = states[index - 1], to = states[index];
    const span = spans[index];
    if (sameState(from, to)) continue;
    const frames = span.shift?.frames ?? 0;
    if (frames < 1) { ops.push({ time: span.start, state: to }); continue; }
    for (let f = 0; f <= frames; f += 1) ops.push({ time: round6(span.start + f / fps), state: f === frames ? to : mix(from, to, easeInOut(f / frames), span.layout !== "full") });
  }
  // A room treatment needs the cut-out over the whole section, or it would
  // dim or hide the presenter too.
  const rooms = [];
  for (const section of sections.filter((entry) => SECTION_ROOMS[entry.room])) {
    if (!matteCovers(story, section.start, section.end, fps)) { warnings.push(`section ${section.id}: room "${section.room}" needs a matte over ${section.start}–${section.end} s (run: launchclip subject matte <recording> --range <in>-<out> --project <dir>); the room is kept`); continue; }
    rooms.push({ sceneId: `layout:${section.id}`, start: section.start, end: section.end, room: { ...SECTION_ROOMS[section.room] } });
  }
  // A breakout mounts the cut-out over its window: a room entry that leaves
  // the room as it is ({}), under any treatment the section has.
  for (const entry of breakouts) rooms.unshift({ sceneId: `layout:${entry.id}:breakout`, start: entry.start, end: entry.end, room: {} });
  return { sections, spans, ops, boundaries: layoutSpans(story).boundaries, rooms, ...(breakouts.length ? { breakouts } : {}), warnings, canvas, captions: captionZones(story) };
}

/** The layout state (frame element and camera) at timeline t. */
export function layoutStateAt(plan, t) {
  if (!plan) return null;
  let lo = 0, hi = plan.ops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (plan.ops[mid].time <= t + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  return plan.ops[lo].state;
}

/**
 * The frame element's style for a state: {left, top, width, height,
 * borderRadius, boxShadow} (numbers are px). The spread is wider than the
 * canvas, so the panel colour covers everything outside the window. In a
 * breakout state it also has clipPath: the frame cut away over the breakout
 * zone (breakoutNotch), so the cut-out under it shows there.
 */
export function layoutFrameStyle(state, canvas) {
  const style = layoutUnderFrameStyle(state, canvas);
  return state.breakout ? { ...style, clipPath: breakoutNotch(state, canvas, state.window) } : style;
}

/** The style of the frame's copy under the subject (LAYOUT_FRAME_UNDER): the frame, never clipped. */
export function layoutUnderFrameStyle(state, canvas) {
  const spread = 2 * Math.max(canvas.width, canvas.height);
  const w = state.window;
  const shadows = [];
  if (state.ring > 0) shadows.push(`0px 0px 0px ${num(state.ring)}px ${state.ringColor}`);
  shadows.push(`0px 0px 0px ${spread}px ${state.panel}`);
  return { left: num(w.x), top: num(w.y), width: num(w.width), height: num(w.height), borderRadius: num(state.radius), boxShadow: shadows.join(", ") };
}

/**
 * The breakout zone of a state: the column over the window (its ring
 * included) from the top of the canvas down to where the window's top
 * corners end. → {x0, x1, y1} (canvas px), or null outside a breakout.
 */
export function breakoutZone(state) {
  const w = state?.window;
  if (!state?.breakout || state.hidden || !w || !(w.width > 0 && w.height > 0)) return null;
  const ring = Math.max(0, Number(state.ring) || 0);
  return { x0: num(w.x - ring), x1: num(w.x + w.width + ring), y1: num(Math.max(0, w.y + (Number(state.radius) || 0))) };
}

/**
 * A CSS clip-path that keeps the whole canvas but the breakout zone, for an
 * element whose box starts at `origin` (canvas px; the frame element's own
 * window, or {x: 0, y: 0} for a canvas-sized layer). "none" outside a breakout.
 */
export function breakoutNotch(state, canvas, origin = { x: 0, y: 0 }) {
  const zone = breakoutZone(state);
  if (!zone || !(zone.y1 > 0)) return "none";
  const point = (x, y) => `${num(x - origin.x)}px ${num(y - origin.y)}px`;
  const W = canvas.width, H = canvas.height;
  return `polygon(${[point(0, 0), point(zone.x0, 0), point(zone.x0, zone.y1), point(zone.x1, zone.y1), point(zone.x1, 0), point(W, 0), point(W, H), point(0, H)].join(", ")})`;
}

/**
 * The breakout sections of a story: [{id, start, end}]. Each window runs
 * from the section's start to its end plus the layout-shift that leaves it,
 * so the head stays out while the frame opens up again.
 */
export function breakoutWindows(story) {
  const spans = layoutSpans(story)?.spans ?? [];
  const fps = Number(story?.resolved?.fps ?? story?.format?.fps ?? 30);
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration);
  const out = [];
  spans.forEach((span, index) => {
    if (!span.breakout) return;
    const next = spans[index + 1];
    const tail = next && !next.breakout && next.layout !== "insert" ? (next.shift?.frames ?? 0) / fps : 0;
    out.push({ id: span.id, start: span.start, end: round6(Math.min(Number.isFinite(duration) ? duration : Infinity, span.end + tail)) });
  });
  return out;
}

/**
 * How far the presenter's head stands over the top edge of a breakout
 * section's window (px), or 0: no breakout, no matte over it, or a head the
 * footage cannot lift that far.
 */
export function breakoutRise(story, section, canvas) {
  if (!section?.breakout) return 0;
  const fps = Number(story?.resolved?.fps ?? story?.format?.fps ?? 30);
  const entry = breakoutWindows(story).find((item) => item.id === section.id);
  if (!entry || !matteCovers(story, entry.start, entry.end, fps)) return 0;
  const { window } = layoutGeometry(section.layout, section.side, canvas, { share: section.share });
  const head = subjectContext(story, section.start, { end: section.end })?.head ?? DEFAULT_HEAD(canvas);
  const camera = reframe(story, section, window, canvas, { breakout: true });
  const top = canvas.height / 2 + camera.scale * (head.y - canvas.height / 2) + camera.y;
  const rise = window.y - top;
  return rise >= BREAKOUT_MIN * head.height * camera.scale ? round6(rise) : 0;
}

/** Layout boundaries (layout-shift transitions) for deriveBoundaries. */
export function layoutBoundaries(story) {
  return layoutSpans(story)?.boundaries ?? [];
}

/**
 * Models with the layout's camera composed in, for the base and subject
 * cameras (kit/core/catalog-c.mjs cameraOps, subject-layer.mjs
 * subjectCameraOps). A module camera (punch-in) moves the footage inside
 * the layout's reframe: each sample becomes layout ∘ sample. Where no module
 * camera runs, one extra model ("layout") carries the layout camera at each
 * op time and the frame after each module camera ends.
 * fps: the story's frame rate. Without a plan the models come back as they are.
 */
export function withLayoutCameras(models, plan, { fps = 30, duration = Infinity } = {}) {
  if (!plan) return models;
  const camAt = (t) => layoutStateAt(plan, t).camera;
  const compose = (sample) => {
    const outer = camAt(sample.t);
    return { ...sample, scale: round6(outer.scale * sample.scale), x: round6(outer.scale * sample.x + outer.x), y: round6(outer.scale * sample.y + outer.y) };
  };
  const out = (models ?? []).map((model) => {
    if (!model) return model;
    let copy = model;
    if (Array.isArray(model.camera?.samples)) copy = { ...copy, camera: { ...model.camera, samples: model.camera.samples.map(compose) } };
    if (Array.isArray(model.subjectCamera?.samples)) copy = { ...copy, subjectCamera: { ...model.subjectCamera, samples: model.subjectCamera.samples.map(compose) } };
    return copy;
  });
  const windows = (models ?? []).filter((model) => Array.isArray(model?.camera?.samples) && model.camera.samples.length).map((model) => [model.camera.samples[0].t, model.camera.samples[model.camera.samples.length - 1].t]);
  const covered = (t) => windows.some(([a, b]) => t >= a - EPS && t <= b + EPS);
  const times = new Set(plan.ops.map((op) => op.time));
  for (const [, end] of windows) if (end + 1 / fps < duration) times.add(round6(Math.round((end + 1 / fps) * fps) / fps));
  const samples = [...times].sort((a, b) => a - b).filter((t) => !covered(t)).map((t) => ({ t, ...camAt(t) }));
  const identity = samples.every((sample) => sample.scale === 1 && sample.x === 0 && sample.y === 0);
  if (samples.length && !identity) out.push({ id: "layout", sceneId: "layout", module: "layout", start: 0, end: duration, camera: { samples } });
  return out;
}

// ---------------------------------------------------------------------------

function spanState(story, span, canvas, { breakout = false } = {}) {
  const geometry = layoutGeometry(span.layout, span.side, canvas, { share: span.share });
  if (breakout) return { window: geometry.window, radius: geometry.radius, panel: span.panel ?? story.brand?.colors?.bg ?? "#000000", ring: span.ring ?? 0, ringColor: span.ringColor ?? "#ffffff", camera: reframe(story, span, geometry.window, canvas, { breakout: true }), hidden: false, breakout: true };
  const state = { window: geometry.window, radius: geometry.radius, panel: span.panel ?? story.brand?.colors?.bg ?? "#000000", ring: span.ring ?? 0, ringColor: span.ringColor ?? "#ffffff", camera: { scale: 1, x: 0, y: 0 }, hidden: span.layout === "insert" };
  // A full section with a zoom is a close-up on the head.
  if (span.layout === "full" && span.zoom > 1) { state.camera = reframe(story, span, geometry.window, canvas); return state; }
  if (span.layout === "full" || span.layout === "insert") return state;
  state.camera = reframe(story, span, geometry.window, canvas);
  return state;
}

// The base camera that puts the presenter's head in the middle of the
// window (kept at its height in the frame), scaled so the footage still
// covers the window.
// breakout: the head is lifted so the window's top edge crosses it
// BREAKOUT_EDGE of the way down.
function reframe(story, span, window, canvas, { breakout = false } = {}) {
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const fit = Math.max(window.width / W, window.height / H);
  const scale = span.layout === "framed" ? fit * span.zoom : Math.max(1, span.zoom);
  const subject = subjectContext(story, span.start, { end: span.end });
  const head = subject?.head ?? (breakout ? DEFAULT_HEAD(canvas) : null);
  const hx = head ? head.x + head.width / 2 : cx;
  const hy = head ? head.y + head.height / 2 : H * 0.35;
  const targetX = window.x + window.width / 2;
  const targetY = breakout ? window.y + (0.5 - BREAKOUT_EDGE) * head.height * scale : window.y + (hy / H) * window.height;
  let x = targetX - cx - scale * (hx - cx);
  let y = targetY - cy - scale * (hy - cy);
  // Keep the footage over the whole window.
  const clamp = (value, lo, hi) => (lo <= hi ? Math.min(hi, Math.max(lo, value)) : (lo + hi) / 2);
  x = clamp(x, window.x + window.width - cx - (scale * W) / 2, window.x - cx + (scale * W) / 2);
  y = clamp(y, window.y + window.height - cy - (scale * H) / 2, window.y - cy + (scale * H) / 2);
  return { scale: round6(scale), x: round6(x), y: round6(y) };
}

// True when a matte covers every frame of timeline [start, end).
function matteCovers(story, start, end, fps) {
  const base = storyBase(story);
  if (!base || base.subject.mode !== "mattes" || !base.subject.mattes.length) return false;
  for (let f = Math.round(start * fps); f < Math.round(end * fps); f += 1) {
    const source = sourceTimeAt(base, f / fps);
    if (source !== null && !base.subject.mattes.some((matte) => source >= matte.in - EPS && source <= matte.out + EPS)) return false;
  }
  return true;
}

function sameState(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// One interpolated state between two layouts (u: eased 0–1). The panel takes
// the incoming colour, or the outgoing one when the incoming layout has no
// panel, so a panel slides out in its own colour.
function mix(a, b, u, panelled) {
  const lerp = (p, q) => round6(p + (q - p) * u);
  const rect = (p, q) => ({ x: lerp(p.x, q.x), y: lerp(p.y, q.y), width: lerp(p.width, q.width), height: lerp(p.height, q.height) });
  return {
    window: rect(a.window, b.window),
    radius: lerp(a.radius, b.radius),
    panel: panelled ? b.panel : a.panel,
    ring: lerp(a.ring, b.ring),
    ringColor: b.ring > 0 ? b.ringColor : a.ringColor,
    camera: { scale: lerp(a.camera.scale, b.camera.scale), x: lerp(a.camera.x, b.camera.x), y: lerp(a.camera.y, b.camera.y) },
    hidden: false,
    // The head stays out while the frame shifts, but not into an insert, where the window closes.
    ...(b.breakout || (a.breakout && !b.hidden) ? { breakout: true } : {})
  };
}

function easeInOut(u) {
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

const round6 = (value) => Math.round(value * 1e6) / 1e6;
const num = (value) => Math.round(value * 1000) / 1000;

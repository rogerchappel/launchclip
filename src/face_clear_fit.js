// Tooling keeps cards off the presenter's face. In a talking-head story
// (footage-led) any front-layer overlay whose box meets the presenter's head
// (plus a margin) while it is up is moved beside, above or below the head,
// or resized to fit there, before render. The face rule in layout-check
// (kit/core/subject-layer.mjs checkSubjectFace) stays the gate; this pass
// fixes what it would fail, the way fitCaptionBand and fitTimings do. A card
// that fits nowhere clear of the face is dropped (options.drop): the
// presenter plays under where it was.
//
// The head is the one layout-check's face rule measures: the whole-video
// track (resolved.subjectTrack) or the covering matte, through the base's
// trims, fit and crop, then moved by the base cameras and the footage-layout
// sections. With no face data the head is kit/core/footage-layout.mjs
// DEFAULT_HEAD (where a centred presenter's head sits), and the warning says so.

import { DEFAULT_HEAD, chestZone, layoutPlan, layoutStateAt, withLayoutCameras } from "@launchclip/core/footage-layout.mjs";
import { captionBandAt, elementsFromEditorialLayout, profileGeometry } from "@launchclip/core/layout-check.mjs";
import { catalogModules, isEditorialKind, moduleFit, resolveModule } from "@launchclip/core/modules.mjs";
import { DEFAULT_BRAND } from "@launchclip/core/planning-prompt.mjs";
import { resolveStory, storyBase } from "@launchclip/core/story.mjs";
import { sceneLayerOf, sourceTimeAt, subjectCameraAt, subjectCameraOps, subjectLocator } from "@launchclip/core/subject-layer.mjs";

export const FACE_CLEAR = Object.freeze({
  // The head is grown by this share of the canvas's short side before a card
  // counts as on the face, and moved cards keep this gap from it.
  margin: 0.03,
  // The head is sampled this many times a second over a card's time on screen.
  samplesPerSecond: 10,
  // Where a card may go, tried nearest first.
  zones: Object.freeze(["above", "below", "left", "right"])
});

const EPS = 1e-6;
const round = (value) => Math.round(value);

/**
 * Where the presenter's head is on the canvas at timeline t, the way the face
 * rule sees it. → {at(t) → rect | null, source: "matte" | "track" | "default"},
 * or null for a story with no base. infos: the mattes' subject.json objects
 * (layout-check reads them; the planner has none yet).
 */
export function presenterHeadLocator(resolved, { infos = [] } = {}) {
  const base = storyBase(resolved);
  if (!base || base.subject.mode === "off") return null;
  const canvas = { width: Number(resolved.format?.width), height: Number(resolved.format?.height) };
  const tracked = Boolean(resolved.resolved?.subjectTrack);
  const matted = base.subject.mode === "mattes" || (infos ?? []).some(Boolean);
  const located = tracked || matted ? subjectLocator(resolved, infos) : null;
  const models = [];
  for (const scene of resolved.scenes ?? []) {
    try { models.push(resolveModule(scene, resolved)); } catch { /* a bad module is the checks' to report */ }
  }
  const layout = layoutPlan(resolved);
  const fps = Number(resolved.resolved?.fps ?? resolved.format?.fps ?? 30);
  const ops = subjectCameraOps(withLayoutCameras(models, layout, { fps, duration: Number(resolved.resolved?.duration ?? resolved.format?.duration) }));
  const at = (t) => {
    if (layout && layoutStateAt(layout, t).hidden) return null;
    if (sourceTimeAt(base, t) === null) return null;
    const head = located ? located(t)?.head ?? null : DEFAULT_HEAD(canvas);
    if (!head || !ops.length) return head;
    const cam = subjectCameraAt(ops, t);
    const cx = canvas.width / 2, cy = canvas.height / 2, s = cam.scaleX ?? 1;
    return { x: cx + (head.x - cx) * s + (cam.x ?? 0), y: cy + (head.y - cy) * s + (cam.y ?? 0), width: head.width * s, height: head.height * s };
  };
  return { at, source: tracked ? "track" : matted ? "matte" : "default" };
}

/**
 * A copy of a talking-head storyboard with every front-layer card moved off
 * the presenter's face, and what changed. options: {words, beats, track (the
 * whole-video track resolveStory takes), edl and subject (finish's base.edl
 * and filed mattes, as resolveStory takes them), infos, drop (drop a card no
 * room fits; else keep it and say so), behind (a card no room fits whose
 * module is made to sit behind the presenter, but which the scene put in
 * front, goes back behind: only over a real cut-out, base.subject mattes),
 * only (scene ids: just these cards, the ones the face rule failed)}.
 * → {storyboard, moved: ["hook moved below the presenter's face (0.5–3 s)"],
 *    dropped: [..], behind: [..], kept: [..], source: "track" | "matte" | "default" | null}
 */
export function fitFaceClear(storyboard, { words = [], beats = null, track = null, edl = null, subject = null, infos = [], drop = false, behind = false, only = null } = {}) {
  const none = { storyboard, moved: [], dropped: [], behind: [], kept: [], source: null };
  if (!storyboard || storyboard.lane !== "footage-led" || !Array.isArray(storyboard.scenes)) return none;
  const story = { ...storyboard, brand: storyboard.brand ?? DEFAULT_BRAND };
  let resolved;
  try { resolved = resolveStory(structuredClone(story), { words, beats, track, ...(edl ? { edl } : {}), ...(subject ? { subject } : {}) }); } catch { return none; }
  const locator = presenterHeadLocator(resolved, { infos });
  if (!locator) return none;
  const canvas = { width: Number(resolved.format.width), height: Number(resolved.format.height) };
  const gap = round(FACE_CLEAR.margin * Math.min(canvas.width, canvas.height));
  const inserts = (resolved.scenes ?? []).filter((scene) => scene.insert === true);
  const covered = (t) => inserts.some((scene) => t >= Number(scene.start) && t < Number(scene.end));
  const copy = structuredClone(storyboard);
  const byId = new Map(copy.scenes.map((scene) => [scene?.id, scene]));
  const moved = [], dropped = [], kept = [], sentBehind = [];
  const cutOut = storyBase(resolved)?.subject.mode === "mattes";
  const drops = new Set();
  for (const scene of resolved.scenes ?? []) {
    const target = byId.get(scene.id);
    if (!target || (only && !only.has(scene.id)) || !movable(scene, resolved)) continue;
    const start = Number(scene.start), end = Number(scene.end);
    const head = headExtent(locator.at, start, end, covered);
    if (!head) continue;
    const box = sceneBox(scene, resolved, canvas);
    if (!box || !meets(box, grow(head, gap))) continue;
    const span = `${r2(start)}–${r2(end)} s`;
    const note = locator.source === "default" ? "; no face data, so the default head" : "";
    const placed = placeable(scene) ? clearPlacement(scene, resolved, canvas, { head, box, gap, start, end }) : null;
    if (placed) {
      target.params = { ...(target.params ?? {}), rect: placed.rect };
      moved.push(`${scene.id} ${placed.resized ? "resized and moved" : "moved"} ${ZONE_WORDS[placed.zone]}${placed.overBand ? " over the caption band" : ""} (${span}${note})`);
      continue;
    }
    const why = placeable(scene) ? "no room beside, above or below the head fits it" : "it places itself";
    if (behind && cutOut && madeForBehind(scene)) {
      target.layer = "behind";
      sentBehind.push(`${scene.id} (${scene.module}) set behind the presenter: it covered the face at ${span} and ${why}`);
      continue;
    }
    if (drop) {
      drops.add(scene.id);
      dropped.push(`${scene.id} (${scene.module}) dropped: it covered the presenter's face at ${span} and ${why} (${scene.module === "polaroid" || !placeable(scene) ? "plan it smaller or elsewhere" : "plan it beside the presenter"}${note})`);
    } else kept.push(`${scene.id} (${scene.module}) covers the presenter's face at ${span}; ${why}${note}`);
  }
  if (drops.size) copy.scenes = copy.scenes.filter((scene) => !drops.has(scene?.id));
  const changed = moved.length || dropped.length || sentBehind.length;
  return { storyboard: changed ? copy : storyboard, moved, dropped, behind: sentBehind, kept, source: locator.source };
}

const ZONE_WORDS = { above: "above the presenter's head", below: "below the presenter's face", left: "to the left of the presenter's face", right: "to the right of the presenter's face" };

// The cards the face rule judges: front-layer, not an insert (it replaces the
// picture), not captions or decor (a punch-in), not a module that frames the
// face itself.
function movable(scene, resolved) {
  if (!scene?.module || scene.insert === true) return false;
  let model = null;
  try { model = resolveModule(scene, resolved); } catch { return false; }
  if (model?.framesFace) return false;
  if (sceneLayerOf(scene, model).layer === "behind") return false;
  if (model?.layout?.role === "decor" || model?.layout?.role === "caption") return false;
  return true;
}

// A module tooling can move: it takes params.rect and does not place itself
// around the subject.
function placeable(scene) {
  if (isEditorialKind(scene.module)) return true;
  const definition = catalogModules()[scene.module];
  if (!definition || definition.needs?.includes("subject")) return false;
  return Object.hasOwn(definition.params ?? {}, "rect");
}

// A module made to sit behind the presenter (its definition's default layer
// is behind or split) that the scene put in front.
function madeForBehind(scene) {
  const layer = catalogModules()[scene.module]?.layer;
  return scene.layer === "front" && (layer === "behind" || layer === "split");
}

// The union of the head boxes while the card is up and the face shows.
function headExtent(at, start, end, covered) {
  const step = 1 / FACE_CLEAR.samplesPerSecond;
  let box = null;
  for (let t = start; t < end - EPS; t += step) {
    if (covered(t)) continue;
    const head = at(t);
    if (!head) continue;
    box = box ? union(box, head) : { ...head };
  }
  return box;
}

/** The box a scene draws in (px): its module's rect, or the extent of an editorial layout. */
export function sceneBox(scene, resolved, canvas) {
  let model;
  try { model = resolveModule(scene, resolved); } catch { return scene.params?.rect ?? null; }
  if (model?.layout?.rect) return model.layout.rect;
  if (isEditorialKind(scene.module) && model?.layout) {
    try {
      const rects = elementsFromEditorialLayout(model.layout, { id: scene.id, start: Number(scene.start), end: Number(scene.end), canvas }).map((element) => element.rect).filter(Boolean);
      if (rects.length) return rects.reduce(union);
    } catch { /* fall through */ }
  }
  return scene.params?.rect ?? null;
}

// The free space around the head over the card's time, inside the safe zone
// and clear of the caption band: the headroom, the band under the chin, and
// beside the face.
function clearZones(resolved, canvas, head, gap, start, end) {
  const { safeZone } = profileGeometry(canvas);
  const band = captionBand(resolved, canvas, start, end);
  const left = safeZone.x, right = safeZone.x + safeZone.width, top = safeZone.y;
  let bottom = safeZone.y + safeZone.height;
  const full = bottom;
  // A band under the face caps the space below it; a card may still reach
  // over the band (the captions dip under it: fitCaptionBand) when nothing
  // else fits. A band at the top or in the middle is the checks' to fit.
  if (band && band.y > head.y + head.height) bottom = Math.min(bottom, band.y - gap);
  const rect = (x0, y0, x1, y1) => (x1 - x0 > 1 && y1 - y0 > 1 ? { x: round(x0), y: round(y0), width: round(x1 - x0), height: round(y1 - y0) } : null);
  return {
    above: rect(left, top, right, head.y - gap),
    // Under the chin the neck, not the face, is next to the card: half the gap.
    below: rect(left, head.y + head.height + gap / 2, right, bottom),
    left: rect(left, top, head.x - gap, bottom),
    right: rect(head.x + head.width + gap, top, right, bottom),
    ...(full > bottom ? { band: { below: rect(left, head.y + head.height + gap / 2, right, full), left: rect(left, top, head.x - gap, full), right: rect(head.x + head.width + gap, top, right, full) } } : {})
  };
}

function captionBand(resolved, canvas, start, end) {
  const captions = (resolved.overlays ?? []).find((overlay) => overlay?.type === "captions");
  if (!captions) return null;
  if (captions.rect) return captions.rect;
  const band = profileGeometry(canvas).captionBand;
  if (captions.position === "chest") return chestZone(resolved, canvas, band, start, end);
  return captionBandAt(band, canvas, captions.position);
}

// The nearest rect clear of the head that the module still draws in: the card
// at its own size moved into a zone, else sized to the zone (moduleFit).
function clearPlacement(scene, resolved, canvas, { head, box, gap, start, end }) {
  const zones = clearZones(resolved, canvas, head, gap, start, end);
  const centre = (rect) => [rect.x + rect.width / 2, rect.y + rect.height / 2];
  const [bx, by] = centre(box);
  const candidates = [];
  const tiers = [[zones, false], [zones.band ?? {}, true]];
  for (const [set, overBand] of tiers) {
    for (const zone of FACE_CLEAR.zones) {
      const area = set[zone];
      if (!area) continue;
      if (box.width <= area.width + EPS && box.height <= area.height + EPS) {
        const x = clamp(box.x, area.x, area.x + area.width - box.width);
        const y = clamp(box.y, area.y, area.y + area.height - box.height);
        candidates.push({ zone, overBand, resized: false, rect: { x: round(x), y: round(y), width: round(box.width), height: round(box.height) } });
      }
      const fitted = fitIn(scene, resolved, area, zone, box);
      if (fitted) candidates.push({ zone, overBand, resized: true, rect: fitted });
    }
  }
  // Clear of the captions first; then its own size; then the largest (a
  // readable card over a sliver); then the shortest move.
  const distance = (rect) => { const [x, y] = centre(rect); return Math.hypot(x - bx, y - by); };
  const area = (rect) => rect.width * rect.height;
  candidates.sort((a, b) => (a.overBand - b.overBand) || (a.resized - b.resized) || (area(b.rect) - area(a.rect)) || (distance(a.rect) - distance(b.rect)));
  const clear = grow(head, gap / 2 - 1);
  for (const candidate of candidates) {
    const moved = { ...scene, params: { ...(scene.params ?? {}), rect: candidate.rect } };
    const drawn = sceneBox(moved, resolved, canvas);
    let ok = true;
    try { resolveModule(moved, resolved); } catch { ok = false; }
    if (ok && drawn && !meets(drawn, clear)) return candidate;
  }
  return null;
}

// The card sized to a zone: at most its own width, and the least height the
// module needs at that width (moduleFit), against the head.
function fitIn(scene, resolved, area, zone, box) {
  const width = Math.min(area.width, Math.max(box.width, 1));
  let fit;
  try { fit = moduleFit({ ...scene, params: { ...(scene.params ?? {}), rect: { ...area, width } } }, resolved, { width }); } catch { return null; }
  if (fit.minHeight === null || fit.minHeight > area.height + EPS) return null;
  const height = Math.min(area.height, Math.max(fit.minHeight, Math.min(box.height, area.height)));
  const x = zone === "left" ? area.x + area.width - width : zone === "right" ? area.x : clamp(box.x, area.x, area.x + area.width - width);
  const y = zone === "above" ? area.y + area.height - height : zone === "below" ? area.y : clamp(box.y, area.y, area.y + area.height - height);
  return { x: round(x), y: round(y), width: round(width), height: round(height) };
}

function meets(a, b) {
  return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > EPS && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > EPS;
}

function grow(rect, by) {
  return { x: rect.x - by, y: rect.y - by, width: rect.width + 2 * by, height: rect.height + 2 * by };
}

function union(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

function clamp(value, lo, hi) {
  return hi < lo ? lo : Math.min(hi, Math.max(lo, value));
}

function r2(value) {
  return Math.round(value * 100) / 100;
}

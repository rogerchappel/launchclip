// Tooling keeps captions and cards apart. A storyboard that fails because a
// card sits in the caption band while captions are visible ("layout:
// caption-band @0.3s [cover-callouts, captions] ... while captions are
// visible (0.3s–1.4s)") is settled here instead of failing the plan. A
// caption position the module layout does not plan for (captions in the
// middle of the frame, where every card sits) otherwise fails every attempt.
//
// A brand that turned captions on expects to see them, so hiding them is the
// last resort, scene by scene. For each scene with a clash, in this order:
//
//   1. the scene's own text or card moves out of the band, to the free
//      region above or below it: a module that takes params.rect is moved
//      there at its own size or re-fitted to the region (moduleFit); a module
//      with a placement param takes another value (PARAM_MOVES: a clip's
//      callout slot, a split's share);
//   2. content that cannot move (a full-frame diagram, a module with a fixed
//      layout) keeps its place and the captions move for that scene, to the
//      nearest free band above or below the content, at their size and style
//      (a zone on the captions overlay: kit/core/cast-captions.mjs
//      placedCaptionZones; both renderers draw it through captionPlan);
//   3. with no free band tall enough, the captions shrink into the tallest
//      one, down to CAPTION_ZONE_MIN_SCALE of their size;
//   4. only then are the captions hidden for the clash ([start, end] in the
//      overlay's `hide`), and the reason is recorded.
//
// Every step is checked here against the same layout rules (checkLayout over
// the scene's elements and everything on screen with it), so a move never
// trades the clash for a collision, a safe-zone error or text under its
// floor. The layout check stays strict: the caller checks the result again.

import { CAPTION_ZONE_MIN_SCALE } from "@launchclip/core/captions.mjs";
import { captionBandAt, checkLayout, elementsFromEditorialLayout, layoutExtras, profileGeometry } from "@launchclip/core/layout-check.mjs";
import { catalogModules, isEditorialKind, moduleFit, resolveModule, sceneRenderEnd } from "@launchclip/core/modules.mjs";
import { captionBandFor } from "./layout_check.js";

export const CAPTION_BAND_FIT = Object.freeze({
  // Moved content and moved captions keep this share of the canvas height from each other.
  gap: 0.0125,
  // A scene whose box covers this share of the canvas is full-frame: it is never re-fitted.
  fullFrame: 0.85,
  // A card re-fitted above or below the band keeps at least this share of its area; a smaller one stays and the captions move instead.
  minArea: 0.5,
  // The least a caption block shrinks to (step 3).
  minScale: CAPTION_ZONE_MIN_SCALE
});

// Placement params tooling may change to clear the band, tried in order
// (the value in use is skipped). Each is checked like any other move.
export const PARAM_MOVES = Object.freeze({
  clip: (params) => [{ position: params.position === "top" ? "bottom" : "top" }],
  "emphasis-caption": () => [{ position: "upper" }, { position: "lower" }],
  "split-screen": (params) => [0.3, 0.58, 0.62, 0.65].filter((share) => share !== params.share).map((share) => ({ share })),
  "footage-callout": () => [{ side: "above" }, { side: "below" }]
});

const BAND_ERROR = /^layout: caption-band @[\d.]+s \[([^,\]]+), ([^\]]+)\][^]*?caption band (-?[\d.]+),(-?[\d.]+) ([\d.]+)×([\d.]+) while captions are visible \(([\d.]+)s–([\d.]+)s\)/;
const EPS = 1e-6;

/** The caption-band clashes in a list of check errors: [{scene, captions, rect, start, end}]. */
export function captionBandErrors(errors) {
  const out = [];
  for (const error of errors ?? []) {
    const match = BAND_ERROR.exec(String(error));
    if (!match) continue;
    const [, scene, captions, x, y, width, height, start, end] = match;
    if (!(Number(end) > Number(start))) continue;
    out.push({ scene: scene.trim(), captions: captions.trim(), rect: { x: Number(x), y: Number(y), width: Number(width), height: Number(height) }, start: Number(start), end: Number(end) });
  }
  return out;
}

/**
 * A copy of the storyboard with each caption-band clash settled, and what
 * changed. options: {resolve(storyboard) → the resolved story the checks
 * see (style merged, anchors resolved); without it only step 4 is possible,
 * from: the first step allowed (1 content moves, 2 captions move, 4 hide
 * only), lay(scene, resolved, canvas) → a scene's layout elements (default:
 * as the planner's check lays a scene out)}.
 * → {storyboard,
 *    moved:  ["ask moved above the caption band"],
 *    placed: ["captions 3–6 s moved below boards (y 1114)"],
 *    hidden: ["captions 0.28–1.42 s under cover-callouts: no free band …"],
 *    changes: every line above, in the order made}
 * Only the scenes named in a clash and the captions overlay change.
 */
export function fitCaptionBand(storyboard, errors, { resolve = null, from = 1, lay = sceneElements } = {}) {
  const none = { storyboard, moved: [], placed: [], hidden: [], changes: [] };
  const found = captionBandErrors(errors);
  // No overlays at all: the captions are the style pack's (applyStyle adds
  // the overlay when the story declares none), so the story gets a captions
  // overlay of its own to carry the ranges; the pack still fills the rest.
  const styled = storyboard && typeof storyboard === "object" && storyboard.overlays === undefined;
  if (!found.length || !(styled || Array.isArray(storyboard?.overlays))) return none;
  if (!styled && !storyboard.overlays.some((item) => item?.type === "captions")) return none;
  const copy = structuredClone(storyboard);
  const picture = resolve && from < 4 ? pictureOf(copy, resolve, lay) : null;
  // The overlay a clash's captions belong to; made (for a styled story) only when a zone or a hidden range has to be written.
  const overlayFor = (clash, make = false) => {
    if (copy.overlays === undefined && make) copy.overlays = [{ type: "captions" }];
    return (copy.overlays ?? []).find((item) => item?.type === "captions" && item.id === clash.captions.split("@")[0]) ?? (copy.overlays ?? []).find((item) => item?.type === "captions") ?? null;
  };
  const moved = [], placed = [], hidden = [], changes = [];
  const say = (list, line) => { list.push(line); changes.push(line); };

  // One group per scene, in the order the clashes play.
  const groups = new Map();
  for (const clash of found) {
    const owner = picture?.ownerOf(clash.scene) ?? null;
    const key = owner?.id ?? clash.scene;
    if (!groups.has(key)) groups.set(key, { owner, clashes: [] });
    groups.get(key).clashes.push(clash);
  }
  for (const { owner, clashes } of [...groups.values()].sort((a, b) => a.clashes[0].start - b.clashes[0].start)) {
    let overlay = overlayFor(clashes[0]);
    // A zone tooling placed that the check still fails is withdrawn: the captions hide there.
    const inPlaced = clashes.some((clash) => /@placed-\d+$/.test(clash.captions));
    if (inPlaced && Array.isArray(overlay?.zones)) {
      overlay.zones = overlay.zones.filter((zone) => !clashes.some((clash) => zone.start < clash.end && zone.end > clash.start));
      if (!overlay.zones.length) delete overlay.zones;
    }
    let why = picture ? "" : resolve && from < 4 ? "the story could not be laid out" : "";
    if (picture && owner && !inPlaced) {
      const rect = clashes[0].rect;
      if (from <= 1) {
        const move = moveContent(picture, owner, rect);
        if (move) {
          const target = copy.scenes.find((scene) => scene?.id === owner.id);
          target.params = { ...(target.params ?? {}), ...move.patch };
          // The rect is tooling's: the structured tier lets the model set none (tierErrors reads scene.fitted).
          if (move.patch.rect) target.fitted = [...new Set([...(Array.isArray(target.fitted) ? target.fitted : []), "rect"])];
          picture.patch(owner.id, move.patch, move.elements);
          say(moved, `${owner.id} ${move.words}`);
          continue;
        }
      }
      if (from <= 3) {
        const zone = placeCaptions(picture, owner, rect);
        if (zone) {
          overlay = overlayFor(clashes[0], true);
          const kept = (Array.isArray(overlay.zones) ? overlay.zones : []).filter((entry) => !(entry.start < zone.end && entry.end > zone.start));
          overlay.zones = [...kept, { start: zone.start, end: zone.end, rect: zone.rect, ...(zone.scale < 1 ? { scale: zone.scale } : {}) }].sort((a, b) => a.start - b.start);
          say(placed, `captions ${zone.start}–${zone.end} s ${zone.scale < 1 ? `shrunk to ${Math.round(zone.scale * 100)}% and moved` : "moved"} ${zone.side} ${owner.id} (y ${Math.round(zone.rect.y)})`);
          continue;
        }
        why = `${owner.id} cannot move and leaves no free band ${Math.round(picture.band.height * CAPTION_BAND_FIT.minScale)} px tall above or below it`;
      }
    } else if (inPlaced) why = "the band tooling moved them to is not clear either";
    overlay = overlayFor(clashes[0], true);
    for (const clash of clashes) {
      const ranges = Array.isArray(overlay.hide) ? overlay.hide : [];
      // A hair wider than the clash, so rounding never leaves a frame of overlap.
      const range = [round(Math.max(0, clash.start - 0.02)), round(clash.end + 0.02)];
      if (ranges.some((entry) => Array.isArray(entry) && Number(entry[0]) <= range[0] && Number(entry[1]) >= range[1])) continue;
      overlay.hide = [...ranges, range];
      say(hidden, `captions ${range[0]}–${range[1]} s under ${clash.scene}${why ? `: ${why}` : ""}`);
    }
  }
  return changes.length ? { storyboard: copy, moved, placed, hidden, changes } : none;
}

/**
 * The caption band, settled: while the checks report a card in the band,
 * the clash is fitted (fitCaptionBand) and the storyboard checked again (one
 * round can expose the next clash). A round whose moves leave the checks
 * with more errors of another kind is taken again from the next step (the
 * captions move instead of the content; then they hide).
 * check(storyboard) → {ok, errors}, the caller's own check.
 * → {storyboard, checked (the last check), moved, placed, hidden, changes};
 * nothing changes when no clash is reported or none can be fitted.
 */
export function settleCaptionBand(storyboard, checked, check, { passes = 4, resolve = null, lay = undefined } = {}) {
  const out = { moved: [], placed: [], hidden: [], changes: [] };
  const others = (result) => (result.errors ?? []).filter((line) => !/^layout: caption-band /.test(String(line))).length;
  for (let pass = 0; pass < passes && !checked.ok; pass += 1) {
    let fitted = null, rechecked = null;
    for (const from of [1, 2, 4]) {
      const candidate = fitCaptionBand(storyboard, checked.errors, { resolve, from, ...(lay ? { lay } : {}) });
      if (!candidate.changes.length) break;
      const result = check(candidate.storyboard);
      fitted = candidate;
      rechecked = result;
      const tried = from === 1 ? candidate.moved.length : from === 2 ? candidate.placed.length : 0;
      if (others(result) <= others(checked) || !tried) break;
    }
    if (!fitted) break;
    storyboard = fitted.storyboard;
    checked = rechecked;
    for (const key of Object.keys(out)) out[key].push(...fitted[key]);
  }
  return { storyboard, checked, ...out };
}

/** The warnings a stage records for what settleCaptionBand or fitCaptionBand changed: one line per kind. */
export function captionBandWarnings({ moved = [], placed = [], hidden = [] } = {}) {
  return [
    ...(moved.length ? [`layout: tooling moved ${moved.join("; ")}`] : []),
    ...(placed.length ? [`layout: tooling placed ${placed.join("; ")}`] : []),
    ...(hidden.length ? [`layout: tooling hid ${hidden.join("; ")}`] : [])
  ];
}

// ---------------------------------------------------------------------------
// The picture the steps are checked against

// The story laid out: every scene's elements (as the planner's check lays
// them out), the safe zone and the band the captions take. null when the
// story does not resolve; a scene whose module does not resolve has no
// elements and is never moved.
function pictureOf(storyboard, resolve, lay) {
  let resolved;
  try { resolved = resolve(structuredClone(storyboard)); } catch { return null; }
  const canvas = { width: Number(resolved?.format?.width), height: Number(resolved?.format?.height) };
  if (!(canvas.width > 0 && canvas.height > 0) || !Array.isArray(resolved.scenes)) return null;
  const { safeZone } = profileGeometry(canvas);
  let band;
  try { band = captionBandFor(resolved, canvas); } catch { return null; }
  if (!band) return null;
  const elements = new Map();
  for (const scene of resolved.scenes) {
    try { elements.set(scene.id, lay(scene, resolved, canvas)); } catch { elements.set(scene.id, null); }
  }
  const ids = resolved.scenes.map((scene) => scene.id).sort((a, b) => b.length - a.length);
  return {
    resolved, canvas, safe: safeZone, band, elements, lay,
    gap: Math.round(CAPTION_BAND_FIT.gap * canvas.height),
    // The scene an element belongs to: its own id, or a part's ("cover-callouts" → cover).
    ownerOf(elementId) {
      const id = ids.find((sceneId) => elementId === sceneId || elementId.startsWith(`${sceneId}-`));
      return id ? resolved.scenes.find((scene) => scene.id === id) : null;
    },
    patch(sceneId, patch, laid) {
      const scene = resolved.scenes.find((entry) => entry.id === sceneId);
      scene.params = { ...(scene.params ?? {}), ...patch };
      elements.set(sceneId, laid);
    },
    // Everything else on screen during [start, end].
    around(sceneId, start, end) {
      const out = [];
      for (const [id, list] of elements) if (id !== sceneId) for (const element of list ?? []) if (element.start < end - EPS && (element.shownEnd ?? element.end) > start + EPS) out.push(element);
      return out;
    }
  };
}

// A scene's layout elements, as checkStoryboard lays a scene out (src/storyboard_planner.js).
function sceneElements(scene, resolved, canvas) {
  if (scene.module === "custom") return [];
  const end = sceneRenderEnd(resolved, scene);
  const model = resolveModule(scene, resolved, { end });
  if (!model?.layout?.rect) return [];
  const hidesCaptions = scene.hides_captions === true || model.hidesCaptions === true || model.layout.hidesCaptions === true;
  const extras = layoutExtras(model.layout, { id: scene.id, start: Number(scene.start), end: Number(scene.end), canvas, hidesCaptions });
  const shownEnd = Number.isFinite(end) && end > Number(scene.end) ? end : null;
  return [...elementsFromEditorialLayout(model.layout, {
    id: scene.id,
    role: model.layout.role ?? (scene.module === "media-window" ? "media" : "text"),
    start: Number(scene.start),
    end: Number(scene.end),
    canvas,
    ...(model.layout.minTextPx !== undefined ? { minTextPx: model.layout.minTextPx } : {}),
    ...(extras.allowOcclusion ? { allowOcclusion: extras.allowOcclusion } : {}),
    hidesCaptions
  }), ...extras.parts].map((element) => ({ ...element, start: element.start ?? Number(scene.start), end: element.end ?? Number(scene.end), ...(shownEnd && element.id === scene.id ? { shownEnd } : {}) }));
}

// The layout errors of a scene's elements among everything on screen with
// it, with captions in `rect` for the scene's whole time: {band (caption-band
// clashes of this scene), other (every other error)}.
function errorsWith(picture, scene, laid, rect) {
  const start = Number(scene.start), end = Math.max(Number(scene.end), ...laid.map((element) => element.shownEnd ?? element.end));
  const own = new Set(laid.map((element) => element.id));
  const elements = [...picture.around(scene.id, start, end), ...laid, { id: "captions", role: "caption", rect, start, end }];
  let report;
  // Elements the check cannot take (a rect off the rules) count as an error of another kind.
  try { report = checkLayout({ canvas: picture.canvas, elements, captionBand: rect }); } catch { return { band: 0, other: Infinity }; }
  const findings = report.findings.filter((finding) => finding.severity === "error" && finding.ids.some((id) => own.has(id)));
  return { band: findings.filter((finding) => finding.rule === "caption-band").length, other: findings.filter((finding) => finding.rule !== "caption-band").length };
}

// ---------------------------------------------------------------------------
// Step 1: the content moves

// A module tooling can move by rect: it takes params.rect and does not place
// itself around a subject (as src/face_clear_fit.js placeable).
function takesRect(scene) {
  if (isEditorialKind(scene.module)) return true;
  const definition = catalogModules()[scene.module];
  if (!definition || definition.needs?.includes("subject")) return false;
  return Object.hasOwn(definition.params ?? {}, "rect");
}

// → {patch, elements, words} | null
function moveContent(picture, scene, band) {
  const laid = picture.elements.get(scene.id);
  if (!laid?.length) return null;
  const before = errorsWith(picture, scene, laid, band);
  const accept = (patch) => {
    const patched = { ...scene, params: { ...(scene.params ?? {}), ...patch } };
    let elements;
    try { elements = picture.lay(patched, picture.resolved, picture.canvas); } catch { return null; }
    if (!elements.length) return null;
    const after = errorsWith(picture, patched, elements, band);
    return after.band === 0 && after.other <= before.other ? elements : null;
  };
  for (const candidate of rectMoves(picture, scene, laid, band)) {
    const elements = accept({ rect: candidate.rect });
    if (elements) return { patch: { rect: candidate.rect }, elements, words: `${candidate.resized ? "re-fitted" : "moved"} ${candidate.side} the caption band` };
  }
  for (const patch of PARAM_MOVES[scene.module]?.(scene.params ?? {}) ?? []) {
    if (Object.entries(patch).every(([key, value]) => scene.params?.[key] === value)) continue;
    const elements = accept(patch);
    if (elements) return { patch, elements, words: `set to ${Object.entries(patch).map(([key, value]) => `${key} ${JSON.stringify(value)}`).join(", ")}, clear of the caption band` };
  }
  return null;
}

// The rects a card may take above or below the band, nearest first: at its
// own size, then re-fitted to the region.
function rectMoves(picture, scene, laid, band) {
  if (!takesRect(scene)) return [];
  const box = laid.find((element) => element.id === scene.id)?.rect ?? scene.params?.rect;
  if (!box || box.width * box.height >= CAPTION_BAND_FIT.fullFrame * picture.canvas.width * picture.canvas.height) return [];
  const { safe, gap } = picture;
  // Below the band a card may reach the safe zone's foot; a module that
  // keeps itself above the usual caption band refuses that rect, so the
  // region is also tried ending short of where that band starts.
  const usual = profileGeometry(picture.canvas).captionBand;
  const top = band.y + band.height + gap, k = picture.canvas.height / 1920;
  const regions = [
    { side: "above", x: safe.x, y: safe.y, width: safe.width, height: band.y - gap - safe.y },
    ...[safe.y + safe.height, usual.y - 30 * k, usual.y - 60 * k].map((bottom) => ({ side: "below", x: safe.x, y: top, width: safe.width, height: Math.floor(bottom - top) }))
  ].filter((region) => region.height > 1);
  const centre = box.y + box.height / 2;
  regions.sort((a, b) => Math.abs(a.y + a.height / 2 - centre) - Math.abs(b.y + b.height / 2 - centre) || b.height - a.height);
  const out = [];
  const clampX = (width) => Math.round(Math.min(Math.max(box.x, safe.x), safe.x + safe.width - width));
  for (const region of regions) {
    if (box.width <= region.width + EPS && box.height <= region.height + EPS) {
      out.push({ side: region.side, resized: false, rect: { x: clampX(box.width), y: Math.round(region.y + (region.height - box.height) / 2), width: Math.round(box.width), height: Math.round(box.height) } });
      continue;
    }
    const width = Math.min(region.width, box.width);
    let fit;
    try { fit = moduleFit({ ...scene, params: { ...(scene.params ?? {}), rect: { x: region.x, y: region.y, width, height: region.height } } }, picture.resolved, { width }); } catch { continue; }
    if (fit.minHeight === null || fit.minHeight > region.height + EPS) continue;
    const height = Math.min(region.height, Math.max(fit.minHeight, Math.min(box.height, region.height)));
    if (width * height < CAPTION_BAND_FIT.minArea * box.width * box.height) continue;
    out.push({ side: region.side, resized: true, rect: { x: clampX(width), y: Math.round(region.y + (region.height - height) / 2), width: Math.round(width), height: Math.round(height) } });
  }
  // Its own size before a re-fit, whichever side that is on.
  return out.sort((a, b) => a.resized - b.resized);
}

// ---------------------------------------------------------------------------
// Steps 2 and 3: the captions move, then shrink

// The free band nearest the captions' own for the scene's time on screen:
// clear of every key text and hero element up with it, inside the safe zone.
// → {start, end, rect, scale, side} | null
function placeCaptions(picture, scene, clashRect) {
  const { safe, gap, band } = picture;
  const duration = Number(picture.resolved.resolved?.duration ?? picture.resolved.format?.duration);
  const start = round(Math.max(0, Number(scene.start))), end = round(Number.isFinite(duration) ? Math.min(duration, Number(scene.end)) : Number(scene.end));
  if (!(end > start)) return null;
  const keyed = [...(picture.elements.get(scene.id) ?? []), ...picture.around(scene.id, start, end)]
    .filter((element) => (element.role === "text" || element.role === "hero") && !element.hidesCaptions && element.rect && element.rect.x < band.x + band.width && element.rect.x + element.rect.width > band.x);
  // Free vertical runs of the safe zone, each obstacle grown by the gap.
  let free = [[safe.y, safe.y + safe.height]];
  for (const { rect } of keyed) {
    const top = rect.y - gap, bottom = rect.y + rect.height + gap;
    free = free.flatMap(([a, b]) => (bottom <= a || top >= b ? [[a, b]] : [[a, Math.min(b, top)], [Math.max(a, bottom), b]].filter(([from, to]) => to - from > 1)));
  }
  const own = (picture.elements.get(scene.id) ?? []).filter((element) => element.rect && (element.role === "text" || element.role === "hero"));
  const contentCentre = own.length ? own.reduce((sum, element) => sum + element.rect.y + element.rect.height / 2, 0) / own.length : clashRect.y + clashRect.height / 2;
  const side = (y, height) => (y + height / 2 < contentCentre ? "above" : "below");
  // Step 2: at full size, in the free run that moves the captions least. A
  // run short of the band by less than the gap still holds them: the band
  // is the tallest line they can draw.
  const full = free.filter(([a, b]) => b - a >= band.height - gap)
    .map(([a, b]) => ({ y: Math.min(Math.max(band.y, a), Math.max(a, b - band.height)), height: Math.min(band.height, b - a) }))
    .sort((p, q) => Math.abs(p.y - band.y) - Math.abs(q.y - band.y))[0];
  if (full) {
    // A place captions are designed to sit (the usual band, low, the top)
    // within two gaps of it wins, so moved captions land in the same place
    // from scene to scene.
    const usual = profileGeometry(picture.canvas).captionBand;
    const grown = { ...usual, y: usual.y - (band.height - usual.height) / 2, height: band.height };
    const clear = (y) => !keyed.some(({ rect }) => rect.y - gap < y + band.height && rect.y + rect.height + gap > y);
    const designed = full.height < band.height ? undefined : ["auto", "low", "top"].map((position) => captionBandAt(grown, picture.canvas, position).y)
      .filter((y) => Math.abs(y - full.y) <= 2 * gap && clear(y))
      .sort((p, q) => Math.abs(p - full.y) - Math.abs(q - full.y))[0];
    const y = designed ?? full.y;
    return { start, end, scale: 1, side: side(y, full.height), rect: { x: Math.round(band.x), y: Math.round(y), width: Math.round(band.width), height: Math.round(full.height) } };
  }
  // Step 3: shrunk into the tallest run that holds them at the least scale.
  const [a, b] = free.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0] ?? [0, 0];
  const scale = Math.floor(((b - a) / band.height) * 100) / 100;
  if (!(scale >= CAPTION_BAND_FIT.minScale)) return null;
  return { start, end, scale, side: side(a, b - a), rect: { x: Math.round(band.x), y: Math.round(a), width: Math.round(band.width), height: Math.round(b - a) } };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

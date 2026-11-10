// Where a character story's captions sit: clear of the cast. The caption band
// is planned for cards and footage (low in the frame, where a card leaves
// room); a character stands, sits and gestures there, so over cast scenes the
// captions move to the place the characters are not.
//
//   castCaptionZones(story)        → [{section, start, end, rect}] (captionPlan's ctx.zones)
//   storyCaptionZones(story, layout) → the footage layout's zones, else the cast's
//
// One place is chosen for the whole story, so the captions do not jump from
// shot to shot: the usual band, then the band 58% down, the middle, the top
// (CAST_CAPTION_POSITIONS), scored over every cast scene by how much of the
// band each character's reach covers (every pose and gesture it takes in the
// scene, catalog-characters.mjs actorReach), a head counting CAST_CAPTIONS.head
// times as much as a body. The first place with the lowest score wins; when
// that is the usual band there are no zones and the story renders as before.
// The zones cover the cast scenes only: cards between them keep the band they
// were laid out around.
//
// Only a character story (character-story.mjs) whose captions overlay names
// no position gets them. Both compilers, the segment renderer, the caption
// legibility check and the layout check ask storyCaptionZones, so the
// captions are drawn, measured and checked in the same place.
//
// Imports only kit/core siblings.

import { captionsOverlayOf } from './captions.mjs';
import { CAST_MODULES, isCharacterStory } from './character-story.mjs';
import { captionBandAt, profileGeometry } from './layout-check.mjs';
import { resolveModule } from './modules.mjs';

export const CAST_CAPTION_POSITIONS = Object.freeze(['auto', 'low', 'middle', 'top']);
// pad: a character's reach grows by this share of the canvas height before it
// counts (the camera's slow moves inside a shot shift it a little); head: the
// top share of a reach that is the head, and how much more it weighs.
export const CAST_CAPTIONS = Object.freeze({ pad: 0.02, headShare: 0.4, head: 3 });

const round = (value) => Math.round(value * 1000) / 1000;
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** The cast scenes of a resolved story with each character's reach: [{id, start, end, reaches: [{x, y, width, height}]}]. */
export function castReaches(story, { resolve = resolveModule } = {}) {
  const out = [];
  for (const scene of Array.isArray(story?.scenes) ? story.scenes : []) {
    if (!CAST_MODULES.includes(scene?.module)) continue;
    const start = Number(scene.start), end = Number(scene.end);
    if (!(end > start)) continue;
    let model = null;
    try { model = resolve(scene, story); } catch { model = null; }
    const reaches = (model?.content?.actors ?? []).map((actor) => actor?.reach).filter((r) => r && [r.left, r.right, r.top, r.bottom].every(Number.isFinite))
      .map((r) => ({ x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top }));
    out.push({ id: scene.id, start, end, reaches });
  }
  return out;
}

/**
 * How much of a caption band the cast covers over the story's cast scenes:
 * the covered share of the band, a head weighing more, averaged by time.
 * 0 is a band no character reaches into.
 */
export function castCover(band, scenes, canvas) {
  const pad = CAST_CAPTIONS.pad * canvas.height;
  const area = band.width * band.height;
  let total = 0, seconds = 0;
  for (const scene of scenes) {
    let cover = 0;
    for (const reach of scene.reaches) {
      const body = { x: reach.x - pad, y: reach.y - pad, width: reach.width + 2 * pad, height: reach.height + 2 * pad };
      const head = { ...body, height: reach.height * CAST_CAPTIONS.headShare + pad };
      cover += (overlap(band, body) + (CAST_CAPTIONS.head - 1) * overlap(band, head)) / area;
    }
    total += cover * (scene.end - scene.start);
    seconds += scene.end - scene.start;
  }
  return seconds > 0 ? total / seconds : 0;
}

/**
 * The caption zones of a character story (resolved): one band, clear of the
 * cast, over each run of cast scenes. [] when the story is not a character
 * story, has no captions, places them itself (position or rect), or the
 * usual band is already the clearest.
 */
export function castCaptionZones(story, { resolve = resolveModule } = {}) {
  if (!isCharacterStory(story)) return [];
  const overlay = captionsOverlayOf(story);
  if (!overlay || overlay.rect || (overlay.position !== undefined && overlay.position !== 'auto')) return [];
  const canvas = { width: Number(story?.format?.width), height: Number(story?.format?.height) };
  if (!(canvas.width > 0 && canvas.height > 0)) return [];
  const scenes = castReaches(story, { resolve });
  if (!scenes.some((scene) => scene.reaches.length)) return [];
  const usual = profileGeometry(canvas).captionBand;
  let best = null;
  for (const position of CAST_CAPTION_POSITIONS) {
    const band = captionBandAt(usual, canvas, position);
    const cover = castCover(band, scenes, canvas);
    if (!best || cover < best.cover - 1e-6) best = { position, band, cover };
  }
  if (best.position === 'auto') return [];
  const rect = { x: round(best.band.x), y: round(best.band.y), width: round(best.band.width), height: round(best.band.height) };
  // One zone per run of cast scenes (scenes that meet or overlap are one run).
  const runs = [];
  for (const scene of [...scenes].sort((a, b) => a.start - b.start)) {
    const last = runs.at(-1);
    if (last && scene.start <= last.end + 1e-6) last.end = Math.max(last.end, scene.end);
    else runs.push({ start: scene.start, end: scene.end });
  }
  return runs.map((run, index) => ({ section: `cast-${index + 1}`, start: round(run.start), end: round(run.end), rect, position: best.position }));
}

/** The caption zones a story is drawn with: its footage layout's (layoutPlan(story).captions) when it has them, else the cast's. */
export function storyCaptionZones(story, layout = null) {
  if (Array.isArray(layout?.captions) && layout.captions.length) return layout.captions;
  const zones = castCaptionZones(story);
  return zones.length ? zones : layout?.captions;
}

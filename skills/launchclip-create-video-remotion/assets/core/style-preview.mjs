// A short preview reel for a style (docs/SEEDED_STYLES_RFC.md §3.10): a
// 10-second story that shows a brand its look, with a title, a chart, a card,
// a camera move and a backdrop change. Hosts render it next to a generated
// style so a brand can judge the look before using it.
//
//   stylePreviewStory(style, {aspect, title, kicker, duration}) → launchclip.story.v1
//
// The story names the style ("style": style.name) and carries no look of its
// own, so everything a viewer sees comes from the pack: palette, type,
// panel, motion feel, camera, variants and backdrops. The beats:
//   title  hook-title with the brand name as the eyebrow
//   chart  bar-chart, entered with the style's whip transition; a focus zoom
//          on the tallest bar when the feel zooms and the beat has room for
//          the zoom's move in, hold and move out after the entry lands
//   card   concept-card on a new backdrop: the plate cycle's next plate on a
//          dark look, a primary wash behind the card on a light one
//   end    cta, entered with the style's second preferred transition
// Copy is generic (no product claims); a host may pass its own title.
//
// Pure ESM that imports only kit/core siblings. Canonical copy:
// kit/core/style-preview.mjs.

import { resolveGrammar } from './grammar.mjs';
import { TRANSITION_TYPES } from './transitions.mjs';

export const PREVIEW_SCHEMA = 'launchclip.story.v1';
export const PREVIEW_DURATION = 10;
export const PREVIEW_ASPECTS = Object.freeze({ '16:9': { width: 1920, height: 1080 }, '9:16': { width: 1080, height: 1920 }, '1:1': { width: 1080, height: 1080 } });
// Transitions the preview may enter a beat with, and their direction.
const DIRECTED = new Set(['push', 'whip', 'pan', 'whip-pan']);
const PREVIEWABLE = new Set(TRANSITION_TYPES.filter((type) => !['cut', 'card-to-card', 'rack-focus', 'overview', 'glow-wipe'].includes(type)));

const round = (value) => Math.round(value * 100) / 100;
// kit/core/zooms.mjs: a 0.8 s move in, a 1.2 s hold and a 0.8 s move out, with a margin.
const ZOOM_NEED = 2.9;

function transition(type, seconds, direction) {
  if (!PREVIEWABLE.has(type)) return null;
  return { type, dur: round(Math.min(1.2, Math.max(0.3, seconds))), ...(DIRECTED.has(type) ? { direction } : {}) };
}

/** The plates the preview's beats sit on: [title + chart, card + end], or null without plates. */
function previewPlates(style) {
  const plate = style?.plate;
  if (!plate || typeof plate !== 'object') return null;
  const list = Array.isArray(plate.cycle?.plates) && plate.cycle.plates.length ? plate.cycle.plates : [plate];
  const first = { kind: plate.kind, ...(plate.params ? { params: plate.params } : {}) };
  const next = list.find((entry) => (typeof entry === 'string' ? entry : entry.kind) !== plate.kind) ?? first;
  return [first, typeof next === 'string' ? { kind: next } : next];
}

/**
 * The preview story for a style pack. aspect: 16:9 (default), 9:16 or 1:1;
 * title / kicker: the headline and eyebrow (default: the brand name from the
 * pack's lockup, else generic copy).
 */
export function stylePreviewStory(style, { aspect = '16:9', title, kicker, duration = PREVIEW_DURATION } = {}) {
  if (!style?.name) throw new Error('style preview needs a style pack with a name');
  const size = PREVIEW_ASPECTS[aspect];
  if (!size) throw new Error(`aspect must be one of ${Object.keys(PREVIEW_ASPECTS).join(', ')}`);
  if (!(duration >= 8 && duration <= 12)) throw new Error('a style preview runs 8 to 12 seconds');
  const name = style.brand_frame?.kicker?.label ?? null;
  const feel = style.motion?.feel ?? {};
  const grammar = style.motion?.grammar;
  const seconds = (typeof grammar === 'object' ? grammar?.duration?.transition : null) ?? 0.6;
  const preference = Array.isArray(style.motion?.transition_preference) ? style.motion.transition_preference.filter((type) => PREVIEWABLE.has(type)) : [];
  const [into, out] = [preference[0] ?? 'push', preference[1] ?? preference[0] ?? 'fade'];
  // Beat lengths: the card keeps a module's 2 s minimum and the chart takes
  // the rest, the longest beat.
  const lengths = { title: 0.22 * duration, card: Math.max(2, 0.21 * duration), end: 0.18 * duration };
  const beats = [0, lengths.title, duration - lengths.end - lengths.card, duration - lengths.end, duration].map(round);
  // A zoom waits for the entry move to land (the transition, or the world
  // camera's move), then needs ZOOM_NEED for its move in, hold and move out.
  const camera = resolveGrammar({ motion: { grammar } }).duration.camera;
  const landed = Math.max(seconds, style.camera?.mode === 'world' ? camera : 0) + 0.2;
  const zoomAt = round(beats[1] + landed);
  const plates = previewPlates(style);
  const wash = !plates ? { kind: 'wash', params: { tint: 'primary', intensity: 0.35 } } : null;

  const chart = {
    id: 'chart', module: 'bar-chart', start: beats[1], end: beats[2], energy: 2,
    ...(transition(into, seconds, 'right') ? { in: transition(into, seconds, 'right') } : {}),
    params: { title: 'Growth this quarter', source: 'Illustrative figures', data: [{ label: 'Jan', value: 12 }, { label: 'Feb', value: 19 }, { label: 'Mar', value: 27 }, { label: 'Apr', value: 41 }] }
  };
  if (feel.focus_zooms?.every > 0 && beats[2] - zoomAt >= ZOOM_NEED) chart.zooms = [{ at: zoomAt, target: 3, scale: feel.focus_zooms.scale }];
  const scenes = [
    { id: 'title', module: 'hook-title', start: beats[0], end: beats[1], energy: 3, params: { eyebrow: kicker ?? name ?? 'Style preview', headline: title ?? (name ? `This is how ${name} moves` : 'A look that is yours alone') }, ...(plates ? { backdrop: plates[0] } : {}) },
    { ...chart, ...(plates ? { backdrop: plates[0] } : {}) },
    {
      id: 'card', module: 'concept-card', start: beats[2], end: beats[3], energy: 2,
      ...(transition(out, seconds, 'up') ? { in: transition(out, seconds, 'up') } : {}),
      params: { text: 'Every detail', icon: 'sparkles', sub: 'Colour, type and motion that match' },
      backdrop: plates ? plates[1] : wash
    },
    {
      id: 'end', module: 'cta', start: beats[3], end: beats[4], energy: 3,
      ...(transition(into, seconds, 'left') ? { in: transition(into, seconds, 'left') } : {}),
      params: { action: name ? `Made for ${name}` : 'Make it yours' },
      ...(plates ? { backdrop: plates[1] } : {})
    }
  ];
  return {
    schema: PREVIEW_SCHEMA,
    title: `Style preview: ${style.name}`,
    lane: 'motion',
    format: { ...size, fps: 30, duration: round(duration) },
    style: style.name,
    scenes
  };
}

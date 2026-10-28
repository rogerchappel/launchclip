// How different two styles look (docs/SEEDED_STYLES_RFC.md §3.9), across
// everything a viewer reads as a brand: palette, type, motion, backdrops and
// the per-module variants. 0 is the same look, 1 as far apart as the scale
// goes.
//
//   styleDistance(a, b)        → 0–1
//   styleDistanceReport(a, b)  → {distance, parts: {palette, type, motion, backdrops, variants}}
//
// Each part is 0–1 and the distance is their weighted sum (DISTANCE_WEIGHTS).
// Works on any style pack: a generated one, a starter, a hand-made one. A
// pack without a motion feel (motion.feel) is read from its grammar preset
// (its camera ease family, tempo 1); a pack without variants draws every
// module's default.
//
// Pure ESM that imports only kit/core siblings. Canonical copy:
// kit/core/style-distance.mjs.

import { FONT_REGISTRY, registeredFamily } from './fonts.mjs';
import { GRAMMARS } from './grammar.mjs';
import { moduleVariants } from './modules.mjs';
import { hexToOklab, hexToOklch } from './oklch.mjs';

export const DISTANCE_WEIGHTS = Object.freeze({ palette: 0.3, type: 0.15, motion: 0.2, backdrops: 0.15, variants: 0.2 });
// Below NEAR_DUPLICATE two styles read as the same brand. The generator keeps
// at least MIN_AVOID_DISTANCE from every style it is asked to avoid.
export const NEAR_DUPLICATE = 0.2;
export const MIN_AVOID_DISTANCE = 0.35;

const ROLES = ['bg', 'paper', 'primary', 'accent'];
// The renderers' fallback colours, for a pack that leaves a role out.
const FALLBACK = Object.freeze({ bg: '#0b0b0f', paper: '#f5f3ee', primary: '#ffd23f', accent: '#46d4ff' });
// Ease families in order of how hard they accelerate (motion distance).
const EASE_ORDER = ['sine', 'power1', 'power2', 'power3', 'circ', 'power4', 'expo', 'back', 'elastic', 'bounce'];
const VARIANTS = moduleVariants();
const MODULES = Object.keys(VARIANTS);

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const round = (value, places = 4) => Math.round(value * 10 ** places) / 10 ** places;
const slug = (family) => { const registered = registeredFamily(family); return registered ? FONT_REGISTRY[registered].slug : String(family ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-'); };
const familyOf = (ease) => String(ease ?? 'power3.inOut').split('.')[0].replace(/\(.*$/, '');

/** The traits of a pack the distance compares. */
export function styleTraits(pack) {
  const colors = { ...FALLBACK, ...(pack?.brand?.colors ?? {}) };
  const fonts = pack?.brand?.fonts ?? {};
  const grammar = pack?.motion?.grammar;
  const base = GRAMMARS[typeof grammar === 'string' ? grammar : grammar?.base] ?? GRAMMARS.editorial;
  const feel = isObject(pack?.motion?.feel) ? pack.motion.feel : {};
  const own = isObject(grammar) ? grammar : {};
  const plate = pack?.plate;
  const plates = !plate ? [] : typeof plate === 'string' ? [plate] : [plate.kind, ...(Array.isArray(plate.cycle?.plates) ? plate.cycle.plates.map((entry) => (typeof entry === 'string' ? entry : entry?.kind)) : [])];
  const panel = pack?.layouts?.panel ?? {};
  return {
    palette: Object.fromEntries(ROLES.map((role) => [role, hexToOklab(colors[role])])),
    theme: hexToOklch(colors.bg).l < 0.6 ? 'dark' : 'light',
    type: { display: slug(fonts.display ?? 'anton'), body: slug(fonts.body ?? 'inter'), case: pack?.layout?.title_case === false ? 'upper' : 'title' },
    motion: {
      grammar: base.id,
      ease: feel.ease ?? familyOf(own.ease?.camera ?? base.ease.camera),
      tempo: feel.tempo ?? 1,
      camera: pack?.camera?.mode === 'world' ? 'world' : 'cuts',
      whip: feel.whip ?? (base.camera.moveBlur >= 0.5 ? 'blur-whip' : 'slide'),
      blur: feel.blur ?? own.camera?.moveBlur ?? base.camera.moveBlur,
      zooms: feel.focus_zooms?.every ?? 4
    },
    backdrops: {
      background: pack?.background?.kind ?? (pack?.ambient?.background === false ? 'flat' : 'blobs'),
      plates: [...new Set(plates.filter(Boolean))],
      panel: panel.treatment ?? 'solid',
      radius: typeof panel.radius === 'number' ? panel.radius : 16,
      fill: panel.fill?.kind ?? 'none'
    },
    // Every module's variant, in MODULES order (the default where the pack names none).
    variants: MODULES.map((id) => (isObject(pack?.variants) && VARIANTS[id].includes(pack.variants[id]) ? pack.variants[id] : VARIANTS[id][0]))
  };
}

const labDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const differs = (a, b) => (a === b ? 0 : 1);
const jaccard = (a, b) => { const union = new Set([...a, ...b]); if (!union.size) return 0; return 1 - a.filter((x) => b.includes(x)).length / union.size; };

function partDistances(a, b) {
  const palette = Math.min(1, ROLES.reduce((sum, role) => sum + labDistance(a.palette[role], b.palette[role]), 0) / ROLES.length / 0.25);
  const type = 0.55 * differs(a.type.display, b.type.display) + 0.3 * differs(a.type.body, b.type.body) + 0.15 * differs(a.type.case, b.type.case);
  const ma = a.motion, mb = b.motion;
  const easeGap = Math.min(1, Math.abs(EASE_ORDER.indexOf(ma.ease) - EASE_ORDER.indexOf(mb.ease)) / 3);
  const motion = 0.25 * differs(ma.grammar, mb.grammar) + 0.2 * easeGap + 0.15 * Math.min(1, Math.abs(ma.tempo - mb.tempo) / 0.4)
    + 0.15 * differs(ma.camera, mb.camera) + 0.1 * differs(ma.whip, mb.whip) + 0.05 * Math.min(1, Math.abs(ma.blur - mb.blur) / 0.5) + 0.1 * Math.min(1, Math.abs(ma.zooms - mb.zooms) / 4);
  const ba = a.backdrops, bb = b.backdrops;
  const backdrops = 0.3 * differs(ba.background, bb.background) + 0.25 * jaccard(ba.plates, bb.plates) + 0.25 * differs(ba.panel, bb.panel)
    + 0.1 * Math.min(1, Math.abs(ba.radius - bb.radius) / 24) + 0.1 * differs(ba.fill, bb.fill);
  let changed = 0;
  for (let i = 0; i < MODULES.length; i += 1) if (a.variants[i] !== b.variants[i]) changed += 1;
  return { palette, type, motion, backdrops, variants: changed / MODULES.length };
}

const traitsOf = (value) => (value?.palette && value?.motion && value?.backdrops ? value : styleTraits(value));

/** How different two styles look, part by part. → {distance, parts} */
export function styleDistanceReport(a, b) {
  const parts = partDistances(traitsOf(a), traitsOf(b));
  const distance = Object.entries(DISTANCE_WEIGHTS).reduce((sum, [key, weight]) => sum + weight * parts[key], 0);
  return { distance: round(distance), parts: Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, round(value)])) };
}

const W = DISTANCE_WEIGHTS;

/** How different two styles look, 0 (the same) to 1. Takes packs or styleTraits (much faster for many pairs). */
export function styleDistance(a, b) {
  const p = partDistances(traitsOf(a), traitsOf(b));
  return round(W.palette * p.palette + W.type * p.type + W.motion * p.motion + W.backdrops * p.backdrops + W.variants * p.variants);
}

/** The nearest of `styles` to a pack → {index, name, distance} or null for an empty list. */
export function nearestStyle(pack, styles = []) {
  const traits = styleTraits(pack);
  let best = null;
  styles.forEach((style, index) => {
    const distance = styleDistance(traits, traitsOf(style));
    if (!best || distance < best.distance) best = { index, name: style?.name ?? null, distance };
  });
  return best;
}

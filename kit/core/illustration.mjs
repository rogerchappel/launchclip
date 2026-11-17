// illustration (docs/EXPLAINER_CLAIMS_RFC.md §3.2): an editorial illustration
// of a line's claim when no shot shows it, in the manner of magazine
// illustration: a subject object, an optional second object, and one change
// over time, on a full-bleed material plate. Like `graphic`
// (kit/core/graphic.mjs) it is a closed vocabulary, never free drawing. The
// object is drawn in detail when the kit has it (kit/core/illustration-objects.mjs:
// deck, calendar, clock), else it is a world-kit prop, else its icon at hero
// scale, never a placeholder. The change is one of CHANGES, and it happens on
// the object where the object allows:
//
//   wear         the object greys and splits (a deck along its grain); the plate greys too
//   measure      a clock's hand sweeps a wedge across its face; anything else a gauge ring or thermometer
//   count        a calendar's own days are crossed off; anything else fills a tray of cells
//   compare      a second object lands beside the first; the pick is underlined
//   cause        a sun's beam sweeps the object as it greys, a foot presses a dent; rain, heat arrive
//   before-after a wipe across the object reveals its worn state
//
// Composition: the object sits low and large, standing on the rect's bottom
// (just above the caption band) so the frame's lower half is the object, its
// number set at hero size beside it over its unit, the free-type line above.
// What is seen (object, ring, type) covers SEEN_SHARE of the safe area.
//
// Motion: the change lands on `at` (the stressed word, or the `change` hit),
// centred there with a slow → fast → slow ease and no overshoot, under a 10%
// camera kick that eases back. Through the hold the stage pushes in while
// the plate's texture travels sideways in a seamless loop (parallax), each
// scene opening on a short pan that hands over to it; the hook builds in
// steps (object, line, change). One renderer-neutral model on catalogue H's
// view tree and op list, so both renderers draw it from this file
// (registered through kit/core/catalog-i-explain.mjs). The model's layout
// declares the safe area as a hero rect and the plate as a full-canvas media
// part, so src/visual_density.js counts the scene as filled (drawn, not footage).

import {hashString, seededRandom} from './ambient.mjs';
import {hex2, svgRoot} from './catalog-b-view.mjs';
import {timingRules} from './catalog-b-base.mjs';
import {contrastRatio, createHBase, fitText, mixColor, r2, rt} from './catalog-h-base.mjs';
import {abs, countOps, countSamples, drawOps, el, label, set, strokePath, tw} from './catalog-h-view.mjs';
import {graphicNodes} from './graphic.mjs';
import {ICON_BOX, ICON_NAMES, iconNode, iconPath, isIcon} from './icons.mjs';
import {PROPS, PROP_IDS} from './worlds/index.mjs';
import {EDITORIAL_OBJECTS, OBJECT_ASPECT, clockSweep, dayCross, deckDent, deckSplits, objectGeometry, objectLook, objectNodes as drawnNodes} from './illustration-objects.mjs';
import {AT} from './catalog-i-base.mjs';

export const CHANGES = Object.freeze(['wear', 'measure', 'count', 'compare', 'cause', 'before-after']);
export const MATERIALS = Object.freeze(['wood', 'stone', 'fabric', 'paper', 'metal']);
export const PLATES = Object.freeze([...MATERIALS, 'style']);
export const FORCES = Object.freeze({sun: 'sun', foot: 'footprints', rain: 'cloud-rain', heat: 'flame'});
export const INSTRUMENTS = Object.freeze(['gauge', 'thermometer']);
// The hue each material is mixed from; the style's bg sets how dark it sits.
const MATERIAL_HUE = {wood: '#9a6a43', stone: '#8a8780', fabric: '#5f6f86', paper: '#d8d0bf', metal: '#9aa3ad'};
// Each kind's change: how long the move takes (s), its cue.
// Long enough that the change keeps moving through the hold, not just past the word.
const CHANGE_TIME = {wear: 2.0, measure: 1.8, count: 2.2, compare: 1.0, cause: 1.4, 'before-after': 1.6};
const CUE = {wear: 'whoosh-soft', measure: 'whoosh', count: 'tally', compare: 'pop', cause: 'hit-soft', 'before-after': 'whoosh'};
// Slow → fast → slow, never past the target.
// The camera drift runs at an even speed: an eased drift stalls at the scene's ends, which reads as a frozen frame.
const EASE = 'power2.inOut', DRIFT = 'none';
const WORN = 'grayscale(1) brightness(0.86) contrast(0.88)';

const OBJECT_PARAM = `{object (drawn in detail: ${EDITORIAL_OBJECTS.join(', ')}; else a world-kit prop: bench, mug, …; else an icon name), icon? (the icon drawn when object is none of those), label? ≤ 16 (compare only)}`;

/** A validated object: an editorial object, a prop, else an icon (the object itself, or its fallback icon). → {object, drawn, prop, icon, label}. */
export function objectSpec(check, raw, path, {labels = false} = {}) {
  check.obj(raw, path, ['object', 'icon', 'label'], ['object']);
  const object = check.str(raw.object, `${path}.object`, 32);
  if (raw.label !== undefined && !labels) check.fail(`${path}.label`, 'is only drawn on a compare; the caption says the words');
  const label = raw.label === undefined ? null : check.str(raw.label, `${path}.label`, 16);
  const none = {drawn: null, prop: null, icon: null};
  if (EDITORIAL_OBJECTS.includes(object)) return {object, ...none, drawn: object, label};
  if (PROP_IDS.includes(object)) return {object, ...none, prop: object, label};
  if (isIcon(object)) return {object, ...none, icon: object, label};
  if (raw.icon === undefined) {
    let hint = '';
    try { iconPath(object); } catch (error) { hint = (/\(did you mean [^)]*\)/.exec(error.message) ?? [''])[0]; }
    check.fail(`${path}.object`, `"${object}" is not a drawn object (${EDITORIAL_OBJECTS.join(', ')}), a world-kit prop (${PROP_IDS.join(', ')}) or an icon${hint ? ` ${hint}` : ''}; give icon: the icon to draw it as at hero scale`);
  }
  if (!isIcon(raw.icon)) check.fail(`${path}.icon`, `must be an icon name from kit/core/icons.mjs (${ICON_NAMES.length} names); got ${JSON.stringify(raw.icon)}`);
  return {object, ...none, icon: raw.icon, label};
}

/** Width over height of an object's box. */
const aspectOf = spec => (spec.drawn ? OBJECT_ASPECT[spec.drawn] : spec.prop ? Math.min(1.6, Math.max(0.7, PROPS[spec.prop].w / PROPS[spec.prop].h)) : 1);

/** The material's tone in the style: the hue mixed into bg, eased back toward bg until the foreground keeps 4.5:1 on it. */
export function materialTone(material, colors, foreground) {
  for (let k = 0.5; k > 0; k -= 0.05) {
    const tone = mixColor(MATERIAL_HUE[material], colors.bg, k);
    if (contrastRatio(foreground, tone) >= 4.5) return tone;
  }
  return colors.bg;
}

/**
 * The composition inside a W × H rect (rect-relative px). The object sits low
 * and large, bottom on the rect's bottom (just above the caption band), so the
 * frame's lower half is the object, not plate. Its number and unit stand
 * beside it as display type (`type`), and the free-type line runs above
 * (stacked) or in the side column (a clearly wide rect).
 * → {stacked, stage, text, type, boxes, ring, tray, tube}; seen: the share of
 * the rect the object(s) and their type cover.
 */
export const SEEN_SHARE = Object.freeze({min: 0.5, max: 0.8});
export function illustrationGeometry({width: W, height: H}, {change, instrument = 'gauge', unit: u, text = false, type = false, aspect = 1, aspect2 = 1, drawnGauge = false, drawnCount = false}) {
  const stacked = W < H * 1.2;
  const fit = (w, h, a) => (w / h > a ? {width: h * a, height: h} : {width: w, height: w / a});
  const box = (x, y, sz) => ({x: r2(x), y: r2(y), width: r2(sz.width), height: r2(sz.height)});
  const textH = text ? r2(130 * u) : 0;
  const stage = stacked || change === 'compare' ? {x: 0, y: textH, width: W, height: r2(H - textH)} : {x: 0, y: 0, width: r2(W * 0.6), height: H};
  const side = stacked ? null : {x: r2(stage.width + 50 * u), width: r2(W - stage.width - 50 * u)};
  const out = {stacked, stage, text: text ? (stacked || change === 'compare' ? {x: 0, y: 0, width: W, height: textH} : {x: side.x, y: 0, width: side.width, height: r2(H * 0.3)}) : null, type: null, boxes: [], ring: null, tray: null, tube: null};
  const bottom = stage.y + stage.height;
  if (change === 'compare') {
    const gap = 40 * u, labelH = 110 * u, sz = [fit((W - gap) / 2, stage.height - labelH, aspect), fit((W - gap) / 2, stage.height - labelH, aspect2)];
    out.boxes = sz.map((z, i) => box(i ? W - (W - gap) / 4 - z.width / 2 : (W - gap) / 4 - z.width / 2, bottom - labelH - z.height, z));
    out.labels = out.boxes.map(b => ({x: r2(b.x + b.width / 2 - (W - gap) / 4), y: r2(bottom - labelH + 10 * u), width: r2((W - gap) / 2), height: r2(labelH - 10 * u)}));
  } else {
    // Room for what the change adds round the object: a gauge ring, a thermometer, a tray of day cells.
    const ringPad = change === 'measure' && instrument === 'gauge' && !drawnGauge ? 0.78 : 1;
    const trayH = change === 'count' && !drawnCount ? 120 * u : 0, tubeW = change === 'measure' && instrument === 'thermometer' ? 150 * u : 0;
    const objW = type && stacked ? W * 0.7 : stage.width;
    let sz = fit(objW - tubeW, stage.height - trayH, aspect);
    // Never past the top of the band of what is seen: an object alone fills at most 76% of the rect.
    const cap = Math.sqrt(Math.min(1, 0.76 * W * H / (sz.width * sz.height)));
    sz = {width: sz.width * cap, height: sz.height * cap};
    const x = type && stacked ? 0 : stage.x + (stage.width - tubeW - sz.width) / 2;
    const frame = box(x, bottom - trayH - sz.height, sz);
    out.boxes = [ringPad < 1 ? box(frame.x + frame.width * (1 - ringPad) / 2, frame.y + frame.height * (1 - ringPad) / 2, {width: frame.width * ringPad, height: frame.height * ringPad}) : frame];
    if (ringPad < 1) out.ring = {cx: r2(frame.x + frame.width / 2), cy: r2(frame.y + frame.height / 2), r: r2(Math.min(frame.width, frame.height) * 0.47)};
    if (trayH) out.tray = {x: frame.x, y: r2(bottom - trayH + 20 * u), width: Math.max(frame.width, r2(W * 0.6)), height: r2(trayH - 20 * u)};
    if (tubeW) out.tube = {x: r2(frame.x + frame.width + 40 * u), y: frame.y, width: r2(60 * u), height: r2(frame.height * 0.86)};
    if (type) out.type = stacked ? {x: r2(frame.x + frame.width + 24 * u), y: frame.y, width: r2(W - frame.x - frame.width - 24 * u), height: frame.height}
      : {x: side.x, y: r2(H * 0.34), width: side.width, height: r2(H * 0.66)};
  }
  const area = b => b.width * b.height;
  out.seen = r2((out.boxes.reduce((sum, b) => sum + area(b), 0) + (out.ring ? area({width: out.ring.r * 2, height: out.ring.r * 2}) - area(out.boxes[0]) : 0) + (out.type ? area(out.type) : 0) + (out.labels ? out.labels.reduce((sum, b) => sum + area(b), 0) * 0.5 : 0)) / (W * H));
  return out;
}

// Seeded jagged cracks across a box: 3 lines that wander down it, or along it (a split in wood runs with the grain).
function crackPaths(box, seed, {along = false} = {}) {
  const rand = seededRandom(hashString(seed));
  // Worked in (across, travel) fractions of the box, then laid down or along.
  const at = (a, t) => along ? [box.x + box.width * t, box.y + box.height * a] : [box.x + box.width * a, box.y + box.height * t];
  return [0.3, 0.52, 0.72].map(fa => {
    let a = fa + (rand() - 0.5) * 0.08, t = 0.12 + rand() * 0.1;
    const pts = [at(a, t)];
    for (let i = 0; i < 6; i++) { a += (rand() - 0.5) * (along ? 0.05 : 0.14); t += 0.07 + rand() * 0.05; pts.push(at(a, t)); }
    return `M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join(' L')}`;
  });
}

// A material's ground: one seamless strip, P wide (a whole number of its boards or tiles, at
// least the frame), drawn at −P, 0, P and 2P so it loops sideways with no seam. Every
// material runs across the loop (vertical boards, brush lines, bands) and has texture at a
// coarse scale too, so its travel reads on screen and in the render's stillness check.
export const PLATE_SPEED = 75, PLATE_OPEN = 160;
const PLATE_CELL = {wood: 100, stone: 400, fabric: 240, paper: 120, metal: 120};
export function plateStrip(material, W, u) {
  const cell = PLATE_CELL[material] * u;
  return r2(Math.ceil(W / cell) * cell);
}
function materialNodes(gid, material, tone, P, H, u, seed) {
  const rand = seededRandom(hashString(`${material}|${seed}`));
  const light = mixColor('#ffffff', tone, 0.1), dark = mixColor('#000000', tone, 0.28);
  const kids = [];
  const rect = (x, y, w, h, fill, extra = {}) => kids.push(el('rect', null, null, [], {x: r2(x), y: r2(y), width: r2(w), height: r2(h), fill, ...extra}));
  const line = (d, stroke, width, opacity) => kids.push(el('path', null, null, [], {d, stroke, strokeWidth: r2(width), strokeOpacity: opacity, strokeLinecap: 'round', fill: 'none'}));
  const shade = k => mixColor(rand() < 0.5 ? light : dark, tone, k);
  if (material === 'wood') {
    // Floorboards at plank scale: narrow boards with staggered butt joints, a tone per length,
    // grain running down each length with a cathedral arch and the odd knot, nail pairs on the joists.
    const plank = 100 * u, joist = 360 * u;
    for (let x = 0; x < P - 1; x += plank) {
      for (let y = -rand() * 700 * u; y < H; ) {
        const len = (480 + rand() * 520) * u, tone_ = shade(0.72 + rand() * 0.22);
        rect(x, y, plank, len, tone_);
        for (let g = 0; g < 4; g++) {
          const gx = x + plank * (0.14 + g * 0.24), a = plank * 0.05 * (0.4 + rand()), f = 0.006 + rand() * 0.006, ph = rand() * 6;
          let d = `M${r2(gx)} ${r2(y)}`;
          for (let yy = 30 * u; yy <= len; yy += 30 * u) d += ` L${r2(gx + a * Math.sin(yy * f + ph))} ${r2(y + yy)}`;
          line(d, mixColor('#000000', tone_, 0.45), 2 * u, 0.5);
        }
        const cy = y + len * (0.3 + rand() * 0.4);
        for (let k = 0; k < 3; k++) {
          const s_ = plank * (0.12 + k * 0.1), top = cy - k * 26 * u;
          line(`M${r2(x + plank / 2 - s_)} ${r2(top + 70 * u)} Q${r2(x + plank / 2)} ${r2(top - 50 * u)} ${r2(x + plank / 2 + s_)} ${r2(top + 70 * u)}`, mixColor('#000000', tone_, 0.5), 2 * u, 0.5);
        }
        if (rand() < 0.35) {
          const kx = x + plank * (0.25 + rand() * 0.5), ky = y + len * (0.15 + rand() * 0.7);
          kids.push(el('ellipse', null, null, [], {cx: r2(kx), cy: r2(ky), rx: r2(9 * u), ry: r2(14 * u), fill: mixColor('#000000', tone_, 0.45), stroke: mixColor('#000000', tone_, 0.6), strokeWidth: r2(2 * u)}));
        }
        rect(x, y + len - 3 * u, plank, 6 * u, mixColor('#000000', tone, 0.55));
        y += len;
      }
      for (let y = joist / 2; y < H; y += joist) for (const f of [0.25, 0.75]) kids.push(el('circle', null, null, [], {cx: r2(x + plank * f), cy: r2(y), r: r2(4 * u), fill: mixColor('#000000', tone, 0.5)}));
      rect(x + plank - 4 * u, 0, 8 * u, H, mixColor('#000000', tone, 0.62));
    }
  } else if (material === 'stone') {
    // Laid flagstones: courses of irregular stones over dark mortar, each stone with a lit top-left
    // edge, a shaded bottom-right edge and a speckle; every course closes on the strip's width.
    rect(0, 0, P, H, mixColor('#000000', tone, 0.45));
    const m = 7 * u;
    for (let y = -40 * u; y < H; ) {
      const h = (150 + rand() * 90) * u, widths = [];
      let left = P;
      while (left > 0) { const w = left < 380 * u ? left : (160 + rand() * 180) * u; widths.push(w); left -= w; }
      let x = rand() * 120 * u;
      for (const w of widths) {
        const j = () => (rand() - 0.5) * 14 * u, x0 = x + m, x1 = x + w - m, y0 = y + m, y1 = y + h - m, c = 22 * u;
        const corners = [[x0 + j(), y0 + j()], [x1 + j(), y0 + j()], [x1 + j(), y1 + j()], [x0 + j(), y1 + j()]];
        const [a1, b1, c1, d1] = corners;
        const d = `M${r2(a1[0] + c)} ${r2(a1[1])} L${r2(b1[0] - c)} ${r2(b1[1])} Q${r2(b1[0])} ${r2(b1[1])} ${r2(b1[0])} ${r2(b1[1] + c)} L${r2(c1[0])} ${r2(c1[1] - c)} Q${r2(c1[0])} ${r2(c1[1])} ${r2(c1[0] - c)} ${r2(c1[1])} L${r2(d1[0] + c)} ${r2(d1[1])} Q${r2(d1[0])} ${r2(d1[1])} ${r2(d1[0])} ${r2(d1[1] - c)} L${r2(a1[0])} ${r2(a1[1] + c)} Q${r2(a1[0])} ${r2(a1[1])} ${r2(a1[0] + c)} ${r2(a1[1])} Z`;
        const face = shade(0.68 + rand() * 0.3);
        kids.push(el('path', null, null, [], {d, fill: face}));
        line(`M${r2(d1[0])} ${r2(d1[1] - c)} L${r2(a1[0])} ${r2(a1[1] + c)} Q${r2(a1[0])} ${r2(a1[1])} ${r2(a1[0] + c)} ${r2(a1[1])} L${r2(b1[0] - c)} ${r2(b1[1])}`, mixColor('#ffffff', face, 0.18), 3 * u, 0.7);
        line(`M${r2(b1[0])} ${r2(b1[1] + c)} L${r2(c1[0])} ${r2(c1[1] - c)} Q${r2(c1[0])} ${r2(c1[1])} ${r2(c1[0] - c)} ${r2(c1[1])} L${r2(d1[0] + c)} ${r2(d1[1])}`, mixColor('#000000', face, 0.4), 4 * u, 0.7);
        for (let k = 0; k < 9; k++) kids.push(el('circle', null, null, [], {cx: r2(x0 + 20 * u + rand() * (w - 2 * m - 40 * u)), cy: r2(y0 + 20 * u + rand() * (h - 2 * m - 40 * u)), r: r2((1.5 + rand() * 2.5) * u), fill: rand() < 0.5 ? mixColor('#000000', face, 0.4) : mixColor('#ffffff', face, 0.25)}));
        x += w;
      }
      y += h;
    }
  } else if (material === 'fabric') {
    // A woven ticking: broad stripes under a fine weave.
    for (let x = 0; x < P - 1; x += 120 * u) rect(x, 0, 120 * u, H, mixColor(Math.round(x / (120 * u)) % 2 ? light : dark, tone, 0.8));
    const step = 14 * u;
    for (let y = 0; y < H; y += step) line(`M0 ${r2(y)} H${P}`, light, 3 * u, 0.12 + rand() * 0.1);
    for (let x = 0; x < P - 1; x += step) line(`M${r2(x)} 0 V${H}`, dark, 3 * u, 0.12 + rand() * 0.1);
  } else if (material === 'paper') {
    // Laid paper: chain lines down the sheet (the coarse texture the travel crosses), soft mottle, then fibres.
    for (let x = 60 * u; x < P; x += 120 * u) { line(`M${r2(x)} 0 V${H}`, dark, 5 * u, 0.3); line(`M${r2(x + 7 * u)} 0 V${H}`, light, 3 * u, 0.25); }
    for (let i = 0; i < Math.round(P * H / (90000 * u * u)); i++) {
      const r = (90 + rand() * 150) * u;
      kids.push(el('circle', null, null, [], {cx: r2(rand() * P), cy: r2(rand() * H), r: r2(r), fill: `url(#${gid}-${rand() < 0.5 ? 'lo' : 'hi'})`}));
    }
    for (let i = 0; i < Math.round(P * H / 30000); i++) {
      const x = rand() * P, y = rand() * H, l = (40 + rand() * 120) * u, a = rand() * Math.PI;
      line(`M${r2(x)} ${r2(y)} q${r2(l / 2 * Math.cos(a + 0.4))} ${r2(l / 2 * Math.sin(a + 0.4))} ${r2(l * Math.cos(a))} ${r2(l * Math.sin(a))}`, dark, 1.5 * u, 0.2);
    }
  } else {
    // Brushed metal: broad bands of sheen and shade, fine brush lines down them.
    for (let x = 0; x < P - 1;) { const w = Math.min(P - x, (30 + rand() * 90) * u); rect(x, 0, w, H, shade(0.75 + rand() * 0.2)); x += w; }
    for (let x = 0; x < P - 1; x += 5 * u) line(`M${r2(x)} 0 V${H}`, rand() < 0.5 ? light : dark, 1.5 * u, 0.08 + rand() * 0.14);
  }
  const bloom = (key, color) => el('radialGradient', `${gid}-${key}`, null, [el('stop', null, null, [], {offset: '0%', stopColor: color, stopOpacity: 0.12}), el('stop', null, null, [], {offset: '100%', stopColor: color, stopOpacity: 0})]);
  const defs = el('defs', null, null, material === 'paper' ? [bloom('hi', '#ffffff'), bloom('lo', '#000000')] : []);
  const copy = dx => el('g', null, null, kids, {transform: `translate(${r2(dx)} 0)`});
  return [defs, el('rect', null, null, [], {x: r2(-P), y: 0, width: r2(4 * P), height: H, fill: tone}), copy(-P), copy(0), copy(P), copy(2 * P)];
}

// The light over the plate: a still vignette and, on metal, one broad sheen. It stays put while the texture travels.
function lightNodes(gid, material, W, H) {
  const stops = list => list.map(([offset, color, opacity]) => el('stop', null, null, [], {offset, stopColor: color, stopOpacity: opacity}));
  return [el('defs', null, null, [
    el('radialGradient', `${gid}-vignette`, null, stops([['55%', '#000000', 0], ['100%', '#000000', 0.45]]), {cx: '50%', cy: '50%', r: '75%'}),
    el('linearGradient', `${gid}-sheen`, null, stops([['30%', '#ffffff', 0], ['50%', '#ffffff', 0.14], ['70%', '#ffffff', 0]]), {x1: '0%', y1: '0%', x2: '100%', y2: '100%'})
  ]), ...(material === 'metal' ? [el('rect', null, null, [], {x: 0, y: 0, width: W, height: H, fill: `url(#${gid}-sheen)`})] : []),
  el('rect', null, null, [], {x: 0, y: 0, width: W, height: H, fill: `url(#${gid}-vignette)`})];
}

function resolve(params, ctx) {
  const b = createHBase('illustration', params, ctx, {allowed: ['subject', 'second', 'change', 'plate', 'text', 'value', 'instrument', 'reading', 'count', 'unit', 'force', 'pick', 'at'], required: ['subject', 'change']});
  const {check, u, rect} = b;
  const p = b.params;
  if (!CHANGES.includes(p.change)) check.fail('params.change', `must be one of ${CHANGES.join(', ')}, got ${JSON.stringify(p.change)}: the list is closed; a change past it is another module's job`);
  const change = p.change;
  const compare = change === 'compare';
  const subject = objectSpec(check, p.subject, 'params.subject', {labels: compare});
  if (compare && p.second === undefined) check.fail('params.second', 'is required for a compare: the object set beside the subject');
  if (!compare && p.second !== undefined) check.fail('params.second', `is only drawn on a compare (got change "${change}")`);
  const second = compare ? objectSpec(check, p.second, 'params.second', {labels: true}) : null;
  // Each kind's own params, and none of the others'.
  const OWN = {measure: ['value', 'instrument', 'reading', 'unit'], count: ['count', 'unit'], cause: ['force'], compare: ['pick']};
  for (const key of ['value', 'instrument', 'reading', 'count', 'unit', 'force', 'pick']) {
    if (p[key] !== undefined && !(OWN[change] ?? []).includes(key)) check.fail(`params.${key}`, `belongs to ${Object.keys(OWN).filter(k => OWN[k].includes(key)).join(' or ')}, not ${change}`);
  }
  const instrument = change === 'measure' ? (p.instrument === undefined ? 'gauge' : check.oneOf(p.instrument, 'params.instrument', INSTRUMENTS)) : null;
  const value = change === 'measure' ? check.num(p.value, 'params.value', 1, 100) / 100 : null;
  const reading = p.reading === undefined ? null : check.str(p.reading, 'params.reading', 10);
  const count = change === 'count' ? check.int(p.count, 'params.count', 2, 31) : null;
  const unit = p.unit === undefined ? null : check.str(p.unit, 'params.unit', 10);
  if (unit && change === 'measure' && !reading) check.fail('params.unit', 'goes under a reading; give reading too');
  const force = change === 'cause' ? check.oneOf(p.force, 'params.force', Object.keys(FORCES)) : null;
  const pick = p.pick === undefined ? null : check.oneOf(p.pick, 'params.pick', ['subject', 'second']);
  const plate = p.plate === undefined ? 'paper' : check.oneOf(p.plate, 'params.plate', PLATES);
  const text = p.text === undefined ? null : check.str(p.text, 'params.text', 32);

  const number = change === 'count' ? String(count) : reading;
  const drawnGauge = subject.drawn === 'clock' && instrument === 'gauge', drawnCount = subject.drawn === 'calendar';
  const geo = illustrationGeometry(rect, {change, instrument, unit: b.unit, text: Boolean(text), type: Boolean(number), aspect: aspectOf(subject), aspect2: second ? aspectOf(second) : 1, drawnGauge, drawnCount});
  // Type: the line at display size, the number at hero size beside the object, its unit under it.
  const textFit = text ? fitText(check, 'params.text', text, {family: 'display', width: geo.text.width, preferred: r2(Math.min(u(96), geo.text.height * (geo.stacked ? 0.72 : 0.3))), min: b.min.key, maxLines: geo.stacked || compare ? 1 : 2}) : null;
  const numberFit = number ? fitText(check, reading ? 'params.reading' : 'params.count', number, {family: 'display', width: geo.type.width, preferred: r2(Math.min(u(300), geo.type.height * 0.55)), min: b.min.key}) : null;
  const unitFit = number && unit ? fitText(check, 'params.unit', unit.toUpperCase(), {family: 'body', width: geo.type.width, preferred: r2(Math.max(b.min.key, Math.min(u(64), numberFit.size * 0.3))), min: b.min.key, spacing: 0.08}) : null;
  const labelFits = compare ? [subject, second].map((spec, i) => spec.label ? fitText(check, `params.${i ? 'second' : 'subject'}.label`, spec.label, {family: 'display', width: geo.labels[i].width, preferred: r2(Math.min(u(84), geo.labels[i].height * 0.8)), min: b.min.key}) : null) : [];
  const fg = b.theme.foreground;
  const tone = plate === 'style' ? null : materialTone(plate, b.colors, fg);

  // Timing: the object lands, then its line, then the change, centred on `at` (the stressed word).
  const buildAt = b.timeOf('build', undefined, 'build', 0.5);
  const buildEnd = rt(buildAt + 0.7);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: buildEnd, role: 'emphasis', cue: 'whoosh-soft'});
  const span = change === 'count' ? Math.min(CHANGE_TIME.count, 0.1 * count + 0.6) : CHANGE_TIME[change];
  const changeAt = b.timeOf('change', p.at, 'params.at', Math.min(b.lastEvent, Math.max(buildEnd - b.start + span / 2 + 0.3, b.duration * 0.45)),
    {min: buildEnd - b.start + span / 2 - 0.05});
  const moveAt = rt(changeAt - span / 2);
  b.events.push({id: `${b.id}-change`, name: 'change', time: changeAt, endTime: rt(moveAt + span), role: 'emphasis', cue: CUE[change]});

  const canvas = b.canvas, box = geo.boxes[0];
  const drawnGeo = (spec, bx) => (spec?.drawn ? objectGeometry(spec.drawn, bx, {days: count ?? 28}) : null);
  const content = {colors: b.colors, look: objectLook(b.colors, b.unit), change, subject, second, plate, tone, value, instrument, reading, count, unit, force, pick, geo,
    objGeo: drawnGeo(subject, box), objGeo2: drawnGeo(second, geo.boxes[1]),
    text: textFit ? {text, size: textFit.size, lines: textFit.lines} : null, number: numberFit ? {text: number, size: numberFit.size} : null, unitType: unitFit ? {text: unit.toUpperCase(), size: unitFit.size} : null,
    labels: labelFits.map((fitted, i) => fitted ? {text: [subject, second][i].label, size: fitted.size} : null),
    buildAt, buildEnd, changeAt, moveAt, span, splitPlate: Boolean(tone && subject.prop && ['wear', 'cause'].includes(change)),
    strip: tone ? plateStrip(plate, canvas.width, b.unit) : null, ground: {x: r2(-rect.x), y: r2(-rect.y), width: canvas.width, height: canvas.height},
    fg, muted: b.theme.muted, accent: b.colors.accent, primary: b.colors.primary, bg: b.colors.bg, crack: mixColor('#000000', tone ?? b.colors.bg, 0.55), seed: `${subject.object}|${change}`};
  // A fade, not a rise: the plate is full-bleed and must not slide.
  b.motion.enterFrom = {opacity: 0, x: 0, y: 0, scale: 1};
  b.motion.exitTo = {opacity: 0, x: 0, y: 0, scale: 1};
  const model = b.finish(content, {minTextPx: Math.min(textFit?.size ?? Infinity, numberFit?.size ?? Infinity, unitFit?.size ?? Infinity, ...labelFits.filter(Boolean).map(f => f.size))});
  // The drawn plate fills the frame like a picture (src/visual_density.js counts it as drawn, not footage).
  if (tone) model.layout.parts = [{id: 'plate', role: 'media', rect: {x: 0, y: 0, width: canvas.width, height: canvas.height}, over: ['self']}];
  return model;
}

// A prop or icon in its box: the prop through graphic's painter, else its icon at hero scale.
function fallbackNodes(model, spec, box, key, {worn = false} = {}) {
  const u = model.unit, c = model.content;
  const style = worn ? {filter: WORN} : {};
  if (spec.prop) {
    // drawProp fits a prop to 80% of its box: draw into a box 1.25× as big so the prop fills this one.
    const W = r2(box.width * 1.25), H = r2(box.height * 1.25);
    const nodes = graphicNodes({kind: 'prop', prop: spec.prop, state: null, label: null, icon: null}, W, H,
      {color: c.accent, ink: c.bg, fg: c.fg, panel: model.theme.panel, fonts: model.fonts, unit: u, icon: 0, labelSize: 0, colors: c.colors, canvas: model.canvas, key: `${model.id}-${key}`});
    return el('div', null, {...abs(r2(box.x - (W - box.width) / 2), r2(box.y - (H - box.height) / 2), W, H), ...style}, nodes);
  }
  const side = Math.min(box.width, box.height);
  box = {x: r2(box.x + (box.width - side) / 2), y: r2(box.y + (box.height - side) / 2), width: side, height: side};
  // Line weight at hero scale: about 16 px whatever the size (ICON_STROKE is for 24 px icons).
  const stroke = r2(16 * u * ICON_BOX / box.width);
  return el('div', null, {...abs(box.x, box.y, box.width, box.height), ...style}, [iconNode(spec.icon, {x: 0, y: 0, size: box.width, color: worn ? c.muted : c.primary, stroke, mode: 'duotone', tintOpacity: 0.22})]);
}

// One object as a rect-sized layer's children: drawn in detail, else its prop or icon (with a soft shadow).
function subjectNodes(model, spec, objGeo, box, pid, {worn = false, days = 0, sweep = false} = {}) {
  const c = model.content;
  if (spec.drawn) {
    const drawn = drawnNodes(spec.drawn, objGeo, c.look, pid, model.rect, c.seed, {worn, days, sweep});
    return [...drawn.nodes, ...drawn.over];
  }
  const shadow = el('div', null, {...abs(r2(box.x + box.width * 0.12), r2(box.y + box.height * 0.86), r2(box.width * 0.76), r2(box.height * 0.1)), borderRadius: '50%', background: `radial-gradient(closest-side, ${hex2('#000000', 0.38)}, ${hex2('#000000', 0)})`});
  return [shadow, fallbackNodes(model, spec, box, pid.slice(-6), {worn})];
}

// The splits a wear draws: along a deck's grain, along a material plate's under a prop, else across the object.
function splitPaths(c, box) {
  if (c.subject.drawn === 'deck') return deckSplits(c.objGeo, c.seed);
  if (c.splitPlate) return crackPaths({x: c.geo.stage.x, y: c.geo.stage.y, width: c.geo.stage.width, height: c.geo.stage.height}, c.seed, {along: true});
  return crackPaths(box, c.seed);
}

// The sole of a shoe seen from above, in a w × h box at (x, y).
const solePath = (x, y, w, h) => {
  const P = (fx, fy) => `${r2(x + w * fx)} ${r2(y + h * fy)}`;
  return `M${P(0.5, 0)} C${P(0.86, 0)} ${P(1, 0.2)} ${P(0.95, 0.42)} C${P(0.9, 0.58)} ${P(0.78, 0.62)} ${P(0.78, 0.72)} C${P(0.78, 0.92)} ${P(0.68, 1)} ${P(0.5, 1)} C${P(0.32, 1)} ${P(0.22, 0.92)} ${P(0.22, 0.72)} C${P(0.22, 0.62)} ${P(0.1, 0.58)} ${P(0.05, 0.42)} C${P(0, 0.2)} ${P(0.14, 0)} ${P(0.5, 0)} Z`;
};

// Where a cause's force acts: the sun over the object's far corner, a foot's dent on it.
function forceGeometry(c) {
  const box = c.geo.boxes[0];
  const sun = {cx: r2(box.x + box.width * 0.86), cy: r2(box.y + box.height * 0.04), r: r2(box.width * 0.1)};
  const dent = c.subject.drawn === 'deck' ? deckDent(c.objGeo) : {cx: box.x + box.width * 0.5, cy: box.y + box.height * 0.5, w: box.width * 0.18, h: box.width * 0.34};
  return {sun, dent: {x: r2(dent.cx - dent.w / 2), y: r2(dent.cy - dent.h / 2), width: r2(dent.w), height: r2(dent.h)}};
}

function view(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content, g = c.geo, look = c.look;
  const W = model.rect.width, H = model.rect.height;
  // Every part is named after the subject, so flow's automatic carry pairs a scene's parts only with the same object's.
  const sid = `${id}-${c.subject.object}`;
  const layer = (lid, children, extra = {}) => el('div', lid, {...abs(0, 0, W, H), ...extra}, children);
  const svgLayer = (lid, children, extra = {}) => layer(lid, [svgRoot(W, H, children)], extra);
  const kids = [];
  if (c.tone) {
    const G = c.ground, P = c.strip;
    const svg = (gid, worn) => el('div', gid, {...abs(0, 0, r2(3 * P), G.height), ...(worn ? {filter: WORN, opacity: 0} : {})},
      [svgRoot(r2(3 * P), G.height, materialNodes(gid, c.plate, c.tone, P, G.height, u, c.seed))]);
    // The plate's opening move lives on a wrapper, so the loop inside it keeps an even speed.
    kids.push(el('div', `${sid}-plate`, abs(G.x, G.y, G.width, G.height, {transformOrigin: '50% 50%'}),
      [svg(`${sid}-ground`, false), ...(greys(c) ? [svg(`${sid}-ground-worn`, true)] : [])]));
    kids.push(el('div', null, abs(G.x, G.y, G.width, G.height), [svgRoot(G.width, G.height, lightNodes(`${sid}-light`, c.plate, G.width, G.height))]));
  }
  const stage = [];
  const box = g.boxes[0];
  const splits = (lid, paths) => svgLayer(lid, paths.map((d, i) => strokePath(`${lid}-${i}`, d, c.crack, r2((c.subject.drawn === 'deck' ? 5 : 6) * u))));
  const days = c.change === 'count' && c.subject.drawn === 'calendar' ? c.count : 0, sweep = c.change === 'measure' && c.subject.drawn === 'clock' && c.instrument === 'gauge';
  if (c.splitPlate) stage.push(splits(`${sid}-split`, splitPaths(c, box)));
  const force = c.change === 'cause' ? forceGeometry(c) : null;
  if (c.change === 'cause' && c.force === 'sun') {
    // The beam: a long wedge of light from the sun, swept across the object as it greys.
    const {cx, cy} = force.sun, reach = Math.hypot(W, H);
    const wedge = [[cx, cy], [cx - reach * Math.cos(1.0), cy + reach * Math.sin(1.0)], [cx - reach * Math.cos(1.45), cy + reach * Math.sin(1.45)]];
    stage.push(svgLayer(`${sid}-beam`, [el('defs', null, null, [el('radialGradient', `${sid}-beam-g`, null, [el('stop', null, null, [], {offset: '0%', stopColor: c.primary, stopOpacity: 0.55}), el('stop', null, null, [], {offset: '100%', stopColor: c.primary, stopOpacity: 0})],
      {cx: r2(cx), cy: r2(cy), r: r2(reach * 0.75), gradientUnits: 'userSpaceOnUse'})]), el('path', null, null, [], {d: `M${wedge.map(([x, y]) => `${r2(x)} ${r2(y)}`).join(' L')} Z`, fill: `url(#${sid}-beam-g)`})],
    {transformOrigin: `${cx}px ${cy}px`, opacity: 0}));
  }
  if (c.change === 'before-after') {
    stage.push(layer(`${sid}-obj`, subjectNodes(model, c.subject, c.objGeo, box, `${sid}`)));
    stage.push(layer(`${sid}-after`, [layer(null, subjectNodes(model, c.subject, c.objGeo, box, `${sid}-a`, {worn: true}), {filter: WORN}), splits(`${sid}-ba-split`, splitPaths(c, box))], {clipPath: `inset(0% 0% 0% ${r2(box.x / W * 100)}%)`}));
    stage.push(el('div', `${sid}-wipe`, abs(r2(box.x - 3 * u), r2(box.y - 20 * u), r2(6 * u), r2(box.height + 40 * u), {background: c.fg, borderRadius: 999, opacity: 0})));
    const tagSize = r2(Math.max(model.minTextPx, 44 * u));
    const tag = (tid, x, text, align) => label(tid, x, r2(Math.max(0, box.y - tagSize * 1.6)), r2(box.width / 2), text, {size: tagSize, family: fonts.meta, color: c.fg, align, spacing: '0.12em', extra: {opacity: 0}});
    stage.push(tag(`${sid}-before`, box.x, 'BEFORE', 'left'), tag(`${sid}-after-tag`, r2(box.x + box.width / 2), 'AFTER', 'right'));
  } else {
    stage.push(layer(`${sid}-obj`, subjectNodes(model, c.subject, c.objGeo, box, `${sid}`, {days, sweep})));
  }
  if (greys(c) || (c.change === 'cause' && c.force === 'foot')) {
    if (greys(c)) stage.push(layer(`${sid}-worn`, subjectNodes(model, c.subject, c.objGeo, box, `${sid}-w`, {worn: true}), {filter: WORN, opacity: 0}));
    if (!c.splitPlate) stage.push(splits(`${sid}-split`, splitPaths(c, box).slice(0, c.force === 'foot' ? 2 : 4)));
  }
  if (c.change === 'cause' && c.force === 'foot') {
    // The dent the foot leaves, then the foot itself above it.
    const d = force.dent;
    stage.push(svgLayer(`${sid}-dent`, [el('path', null, null, [], {d: solePath(d.x, d.y, d.width, d.height), fill: mixColor('#000000', c.look.wood, 0.45), stroke: mixColor('#000000', c.look.wood, 0.65), strokeWidth: r2(3 * u)})], {opacity: 0}));
    const tread = [0.2, 0.32, 0.44, 0.8, 0.9].map(f => el('path', null, null, [], {d: `M${r2(d.x + d.width * 0.18)} ${r2(d.y + d.height * f)} L${r2(d.x + d.width * 0.82)} ${r2(d.y + d.height * f)}`, stroke: mixColor('#ffffff', c.look.ink, 0.25), strokeWidth: r2(4 * u), strokeLinecap: 'round'}));
    stage.push(svgLayer(`${sid}-foot`, [el('path', null, null, [], {d: solePath(d.x + 14 * u, d.y + 26 * u, d.width, d.height), fill: c.look.shadow}),
      el('path', null, null, [], {d: solePath(d.x, d.y, d.width, d.height), fill: c.look.ink, stroke: mixColor('#000000', c.look.ink, 0.5), strokeWidth: r2(c.look.line)}), ...tread],
    {transformOrigin: `${r2(d.x + d.width / 2)}px ${r2(d.y + d.height / 2)}px`, opacity: 0}));
  }
  if (c.change === 'cause' && c.force === 'sun') {
    const {cx, cy, r} = force.sun;
    const rays = Array.from({length: 12}, (_, k) => {
      const a = k * Math.PI / 6;
      return el('path', null, null, [], {d: `M${r2(cx + r * 1.35 * Math.cos(a))} ${r2(cy + r * 1.35 * Math.sin(a))} L${r2(cx + r * (k % 2 ? 1.75 : 2.05) * Math.cos(a))} ${r2(cy + r * (k % 2 ? 1.75 : 2.05) * Math.sin(a))}`, stroke: c.look.ink, strokeWidth: r2(c.look.line * 2.6), strokeLinecap: 'round'});
    });
    const raysIn = rays.map(n => ({...n, attrs: {...n.attrs, stroke: c.primary, strokeWidth: r2(c.look.line * 1.4)}}));
    stage.push(layer(`${sid}-sun`, [layer(`${sid}-rays`, [svgRoot(W, H, [...rays, ...raysIn])], {transformOrigin: `${cx}px ${cy}px`}),
      svgRoot(W, H, [el('circle', null, null, [], {cx, cy, r, fill: c.primary, stroke: c.look.ink, strokeWidth: c.look.line}), el('circle', null, null, [], {cx: r2(cx - r * 0.3), cy: r2(cy - r * 0.3), r: r2(r * 0.35), fill: mixColor('#ffffff', c.primary, 0.35)})])], {opacity: 0}));
  } else if (c.change === 'cause' && c.force !== 'foot') {
    const s = r2(box.width * 0.42);
    stage.push(el('div', `${sid}-force`, {...abs(r2(box.x + box.width - s * 0.7), r2(box.y - s * 0.45), s, s), opacity: 0}, [iconNode(FORCES[c.force], {x: 0, y: 0, size: s, color: c.accent, stroke: r2(14 * u * ICON_BOX / s), mode: 'duotone', tintOpacity: 0.3})]));
  }
  if (c.change === 'compare') {
    const b2 = g.boxes[1];
    stage.push(layer(`${sid}-obj2`, subjectNodes(model, c.second, c.objGeo2, b2, `${sid}-b`)));
    c.labels.forEach((t, i) => {
      if (!t) return;
      const L = g.labels[i];
      stage.push(label(`${sid}-l${i + 1}`, L.x, r2(L.y + (L.height - t.size * 1.1) / 2), L.width, t.text, {size: t.size, family: fonts.display, color: c.fg, align: 'center', lineHeight: 1.1, extra: {opacity: 0}}));
    });
    if (c.pick) {
      const i = c.pick === 'subject' ? 0 : 1, L = g.labels[i], t = c.labels[i], w = t ? Math.min(L.width * 0.8, t.size * t.text.length * 0.5) : L.width * 0.5, y = r2(L.y + L.height - 4 * u);
      stage.push(svgRoot(W, H, [strokePath(`${sid}-pick`, `M${r2(L.x + (L.width - w) / 2)} ${y} L${r2(L.x + (L.width + w) / 2)} ${y}`, c.accent, r2(10 * u))]));
    }
  }
  if (g.ring) {
    const {cx, cy, r} = g.ring, a0 = 135, a1 = 135 + 270 * c.value;
    const arc = (from, to) => { const pt = d => `${r2(cx + r * Math.cos(d * Math.PI / 180))} ${r2(cy + r * Math.sin(d * Math.PI / 180))}`; return `M${pt(from)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${pt(to)}`; };
    stage.push(svgRoot(W, H, [el('path', null, null, [], {d: arc(135, 405), stroke: hex2(c.fg, 0.18), strokeWidth: r2(22 * u), strokeLinecap: 'round', fill: 'none'}), strokePath(`${sid}-fill`, arc(a0, a1), c.accent, r2(22 * u))]));
    const d = r2(46 * u);
    stage.push(el('div', `${sid}-tip`, abs(r2(cx - r), r2(cy - r), r2(2 * r), r2(2 * r), {transformOrigin: '50% 50%', transform: `rotate(${a0}deg)`}), [
      el('div', null, {...abs(r2(2 * r - d / 2), r2(r - d / 2), d, d), borderRadius: '50%', background: c.fg, boxShadow: `0 0 ${r2(24 * u)}px ${hex2(c.accent, 0.8)}`})]));
  }
  if (g.tube) {
    const t = g.tube, bulb = r2(t.width * 1.7);
    stage.push(el('div', null, {...abs(t.x, t.y, t.width, t.height), borderRadius: 999, background: hex2(c.fg, 0.16), border: `${r2(c.look.line)}px solid ${c.look.ink}`, boxSizing: 'border-box'}));
    stage.push(el('div', `${sid}-fill`, {...abs(r2(t.x + 12 * u), r2(t.y + t.height * (1 - c.value)), r2(t.width - 24 * u), r2(t.height * c.value + bulb * 0.3)), borderRadius: 999, background: c.accent, transformOrigin: '50% 100%'}));
    stage.push(el('div', null, {...abs(r2(t.x + t.width / 2 - bulb / 2), r2(t.y + t.height - bulb * 0.2), bulb, bulb), borderRadius: '50%', background: c.accent, border: `${r2(c.look.line)}px solid ${c.look.ink}`, boxSizing: 'border-box'}));
  }
  if (g.tray) {
    const n = c.count, cols = Math.min(n, n > 14 ? Math.ceil(n / 2) : n), rows = Math.ceil(n / cols), area = g.tray;
    const gap = r2(10 * u), cell = r2(Math.min((area.width - gap * (cols - 1)) / cols, (area.height - gap * (rows - 1)) / rows));
    for (let i = 0; i < n; i++) {
      const x = r2(area.x + (i % cols) * (cell + gap)), y = r2(area.y + Math.floor(i / cols) * (cell + gap));
      stage.push(el('div', null, {...abs(x, y, cell, cell), boxSizing: 'border-box', borderRadius: r2(cell * 0.22), border: `${r2(3 * u)}px solid ${hex2(c.fg, 0.4)}`}));
      stage.push(el('div', `${sid}-day-${i}`, {...abs(x, y, cell, cell), borderRadius: r2(cell * 0.22), background: c.accent, opacity: 0}));
    }
  }
  kids.push(el('div', `${sid}-cam`, abs(0, 0, W, H, {transformOrigin: '50% 50%'}), stage));

  // Free type on the plate: the line, and the number beside the object at hero size over its unit.
  const align = g.stacked || c.change === 'compare' ? 'center' : 'left';
  if (c.text) {
    const row = g.text;
    kids.push(label(`${sid}-text`, row.x, r2(row.y + (row.height - c.text.size * 1.1 * c.text.lines) / 2), row.width, c.text.text, {size: c.text.size, family: fonts.display, color: c.fg, align, lineHeight: 1.1, wrap: c.text.lines > 1, extra: {opacity: 0}}));
  }
  if (c.number) {
    const T = g.type, N = c.number.size, uh = c.unitType ? c.unitType.size * 1.5 : 0, y = r2(T.y + (T.height - N * 0.95 - uh) / 2);
    kids.push(label(`${sid}-reading`, T.x, y, T.width, c.change === 'count' ? '1' : c.number.text, {size: N, family: fonts.display, color: c.accent, lineHeight: 0.95, extra: {opacity: 0}}));
    if (c.unitType) kids.push(label(`${sid}-unit`, r2(T.x + N * 0.04), r2(y + N * 0.95 + c.unitType.size * 0.3), T.width, c.unitType.text, {size: c.unitType.size, family: fonts.body, color: c.fg, weight: 700, spacing: '0.08em', extra: {opacity: 0}}));
  }
  // The camera kick on the change punches in on everything, so it wraps the whole frame.
  return [el('div', `${sid}-kick`, abs(0, 0, W, H, {transformOrigin: '50% 50%'}), kids)];
}

// Changes that grey the object (and its plate).
const greys = c => c.change === 'wear' || (c.change === 'cause' && c.force !== 'foot');

function timeline(model, ops) {
  const {id, start, end, unit: u} = model;
  const c = model.content, g = c.geo, W = model.rect.width;
  const sid = `${id}-${c.subject.object}`;
  const at = c.moveAt, D = c.span, box = g.boxes[0];
  const fadeIn = (target, time, dur = 0.5, to = 1) => { set(ops, target, start, {opacity: 0}); tw(ops, target, time, dur, EASE, {opacity: 0}, {opacity: to}); };
  const riseIn = (target, time, dy = 40, dur = 0.6) => { set(ops, target, start, {opacity: 0, x: 0, y: r2(dy * u)}); tw(ops, target, time, dur, EASE, {opacity: 0, y: r2(dy * u)}, {opacity: 1, y: 0}); };
  // The camera: the plate's texture travels sideways at an even speed (a seamless loop, never
  // scaled, so the wrap has no seam) while the stage pushes in: parallax through the hold.
  if (c.tone) {
    // Each scene opens on a short pan and settle that hands over to the loop: decelerating, never past its rest.
    // It travels the loop's way (leftward), so the speed hands over without a stall.
    const from = {x: r2(PLATE_OPEN * u), y: 0, scaleX: 1.08, scaleY: 1.08};
    set(ops, `${sid}-plate`, start, from);
    tw(ops, `${sid}-plate`, start, 1.2, 'power2.out', from, {x: 0, y: 0, scaleX: 1, scaleY: 1});
    const cycle = rt(c.strip / (PLATE_SPEED * u)), repeats = Math.ceil((end - start) / cycle) + 1;
    for (const target of [`${sid}-ground`, ...(greys(c) ? [`${sid}-ground-worn`] : [])]) {
      set(ops, target, start, {x: 0, y: 0, scaleX: 1, scaleY: 1});
      ops.push({type: 'loop', target, start, cycle, repeats, from: {x: 0}, to: {x: r2(-c.strip)}});
    }
    if (greys(c)) {
      set(ops, `${sid}-ground-worn`, start, {opacity: 0});
      tw(ops, `${sid}-ground-worn`, at, D, EASE, {opacity: 0}, {opacity: 0.85});
    }
  }
  set(ops, `${sid}-cam`, start, {x: 0, y: 0, scaleX: 0.94, scaleY: 0.94});
  tw(ops, `${sid}-cam`, start, rt(end - start), DRIFT, {x: 0, y: 0, scaleX: 0.94, scaleY: 0.94}, {x: 0, y: r2(-30 * u), scaleX: 1.08, scaleY: 1.08});
  // A build the eye (and the render's pace check) reads as a step: it rises and settles in scale.
  const rise = {opacity: 0, x: 0, y: r2(90 * u), scaleX: 0.9, scaleY: 0.9};
  set(ops, `${sid}-obj`, start, rise);
  tw(ops, `${sid}-obj`, c.buildAt, 0.7, EASE, rise, {opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1});
  // The hook builds in steps: the object, then its line, then the change.
  if (c.text) riseIn(`${sid}-text`, rt(c.buildAt + 0.7), 36);
  // The kick: punch in 10% over 0.25 s centred on the word, then ease back; never past either end.
  set(ops, `${sid}-kick`, start, {x: 0, y: 0, scaleX: 1, scaleY: 1});
  tw(ops, `${sid}-kick`, rt(c.changeAt - 0.125), 0.25, EASE, {scaleX: 1, scaleY: 1}, {scaleX: 1.1, scaleY: 1.1});
  tw(ops, `${sid}-kick`, rt(c.changeAt + 0.125), 0.9, EASE, {scaleX: 1.1, scaleY: 1.1}, {scaleX: 1, scaleY: 1});
  const splitCount = c.change === 'cause' && c.force === 'foot' ? 2 : (c.splitPlate || c.subject.drawn === 'deck' ? 4 : 3);
  const drawSplits = (lid, from, n = splitCount) => { for (let i = 0; i < n; i++) drawOps(ops, `${lid}-${i}`, start, rt(from + i * 0.12), rt(D * 0.6), EASE); };

  if (c.change === 'wear') {
    fadeIn(`${sid}-worn`, at, D);
    drawSplits(`${sid}-split`, at + D * 0.3);
  }
  if (c.change === 'cause' && c.force === 'sun') {
    const {cx, cy} = forceGeometry(c).sun;
    // The sun is up with the object; its rays turn the whole scene; its beam sweeps the object as it greys.
    fadeIn(`${sid}-sun`, rt(c.buildAt + 0.3), 0.6);
    set(ops, `${sid}-rays`, start, {rotation: 0});
    tw(ops, `${sid}-rays`, start, rt(end - start), DRIFT, {rotation: 0}, {rotation: 45});
    set(ops, `${sid}-beam`, start, {opacity: 0, rotation: 34});
    tw(ops, `${sid}-beam`, rt(at - 0.3), 0.5, EASE, {opacity: 0}, {opacity: 1});
    tw(ops, `${sid}-beam`, at, D, EASE, {rotation: 34}, {rotation: -6});
    const right = r2(Math.min(100, (cx / W) * 100)), left = r2(box.x / W * 100);
    set(ops, `${sid}-worn`, start, {opacity: 1, clipT: 0, clipR: 0, clipB: 0, clipL: right});
    tw(ops, `${sid}-worn`, at, D, EASE, {clipT: 0, clipR: 0, clipB: 0, clipL: right}, {clipT: 0, clipR: 0, clipB: 0, clipL: left});
    drawSplits(`${sid}-split`, at + D * 0.5);
  }
  if (c.change === 'cause' && c.force === 'foot') {
    // The foot comes down (blurred at its fastest), presses on the word, and lifts off, leaving its dent.
    const d = forceGeometry(c).dent, down = c.changeAt;
    set(ops, `${sid}-foot`, start, {opacity: 0, x: 0, y: r2(-320 * u), scaleX: 1.25, scaleY: 1.25, blur: 0});
    tw(ops, `${sid}-foot`, rt(down - 0.55), 0.55, EASE, {opacity: 0, y: r2(-320 * u), scaleX: 1.25, scaleY: 1.25}, {opacity: 1, y: 0, scaleX: 1, scaleY: 1});
    tw(ops, `${sid}-foot`, rt(down - 0.55), 0.275, 'power2.in', {blur: 0}, {blur: r2(8 * u)});
    tw(ops, `${sid}-foot`, rt(down - 0.275), 0.275, 'power2.out', {blur: r2(8 * u)}, {blur: 0});
    tw(ops, `${sid}-foot`, down, 0.25, EASE, {scaleX: 1, scaleY: 1}, {scaleX: 1.02, scaleY: 0.95});
    tw(ops, `${sid}-foot`, rt(down + 0.45), 0.7, EASE, {opacity: 1, y: 0, scaleX: 1.02, scaleY: 0.95}, {opacity: 0, y: r2(-200 * u), scaleX: 1.15, scaleY: 1.15});
    fadeIn(`${sid}-dent`, down, 0.4, 0.75);
    drawSplits(`${sid}-split`, down + 0.1);
    void d;
  }
  if (c.change === 'cause' && !['sun', 'foot'].includes(c.force)) {
    // The force comes in from off its side, blurred at its fastest, and lands on the word.
    const from = {rain: {x: 0, y: -220}, heat: {x: 0, y: 260}}[c.force];
    set(ops, `${sid}-force`, start, {opacity: 0, x: r2(from.x * u), y: r2(from.y * u), blur: 0});
    tw(ops, `${sid}-force`, at, D, EASE, {opacity: 0, x: r2(from.x * u), y: r2(from.y * u)}, {opacity: 1, x: 0, y: 0});
    tw(ops, `${sid}-force`, at, rt(D / 2), 'power2.in', {blur: 0}, {blur: r2(8 * u)});
    tw(ops, `${sid}-force`, rt(at + D / 2), rt(D / 2), 'power2.out', {blur: r2(8 * u)}, {blur: 0});
    fadeIn(`${sid}-worn`, c.changeAt, D);
    drawSplits(`${sid}-split`, c.changeAt + D * 0.3);
  }
  if (c.change === 'before-after') {
    const left = r2(box.x / W * 100), right = r2(100 - (box.x + box.width) / W * 100);
    set(ops, `${sid}-after`, start, {clipT: 0, clipR: 0, clipB: 0, clipL: r2(100 - right)});
    tw(ops, `${sid}-after`, at, D, EASE, {clipT: 0, clipR: 0, clipB: 0, clipL: r2(100 - right)}, {clipT: 0, clipR: 0, clipB: 0, clipL: left});
    set(ops, `${sid}-wipe`, start, {opacity: 0, x: r2(box.width), y: 0});
    tw(ops, `${sid}-wipe`, rt(at - 0.2), 0.2, EASE, {opacity: 0}, {opacity: 1});
    tw(ops, `${sid}-wipe`, at, D, EASE, {x: r2(box.width)}, {x: 0});
    tw(ops, `${sid}-wipe`, rt(at + D), 0.3, EASE, {opacity: 1}, {opacity: 0});
    drawSplits(`${sid}-ba-split`, at + D * 0.4);
    fadeIn(`${sid}-before`, rt(c.buildAt + 0.3), 0.5);
    fadeIn(`${sid}-after-tag`, rt(at + D * 0.5), 0.5);
  }
  if (c.change === 'measure') {
    if (g.ring) {
      drawOps(ops, `${sid}-fill`, start, at, D, EASE);
      set(ops, `${sid}-tip`, start, {rotation: 135});
      tw(ops, `${sid}-tip`, at, D, EASE, {rotation: 135}, {rotation: r2(135 + 270 * c.value)});
    } else if (g.tube) {
      set(ops, `${sid}-fill`, start, {scaleX: 1, scaleY: 0});
      tw(ops, `${sid}-fill`, at, D, EASE, {scaleY: 0}, {scaleY: 1});
    } else {
      // The clock is its own gauge: the minute hand sweeps the wedge, the hour hand follows.
      drawOps(ops, `${sid}-sweep`, start, at, D, EASE, r2(1 - c.value));
      set(ops, `${sid}-minute`, start, {rotation: 0});
      tw(ops, `${sid}-minute`, at, D, EASE, {rotation: 0}, {rotation: r2(360 * c.value)});
      set(ops, `${sid}-hour`, start, {rotation: 300});
      tw(ops, `${sid}-hour`, at, D, EASE, {rotation: 300}, {rotation: r2(300 + 30 * c.value)});
    }
    if (c.number) riseIn(`${sid}-reading`, rt(at + D * 0.45), 50);
  }
  if (c.change === 'count') {
    const step = c.count > 1 ? (D - 0.3) / (c.count - 1) : 0;
    for (let i = 0; i < c.count; i++) {
      fadeIn(`${sid}-day-${i}`, rt(at + i * step), 0.3, c.subject.drawn === 'calendar' ? 0.85 : 1);
      if (c.subject.drawn === 'calendar') drawOps(ops, `${sid}-cross-${i}`, start, rt(at + i * step + 0.05), 0.3, EASE);
    }
    riseIn(`${sid}-reading`, rt(at - 0.15), 50, 0.4);
    countOps(ops, `${sid}-reading`, start, '1', countSamples(model, at, rt(D - 0.3), 'none', 1, c.count, v => String(Math.round(v))));
  }
  if (c.change === 'compare') {
    set(ops, `${sid}-obj2`, start, {opacity: 0, x: r2(60 * u), y: 0});
    tw(ops, `${sid}-obj2`, at, D, EASE, {opacity: 0, x: r2(60 * u)}, {opacity: 1, x: 0});
    if (c.labels[0]) riseIn(`${sid}-l1`, rt(c.buildAt + 0.3), 30);
    if (c.labels[1]) riseIn(`${sid}-l2`, rt(at + D * 0.5), 30);
    if (c.pick) drawOps(ops, `${sid}-pick`, start, rt(at + D + 0.2), 0.6, EASE);
  }
  if (c.unitType) riseIn(`${sid}-unit`, rt(at + (c.change === 'count' ? 0.1 : D * 0.55)), 30, 0.5);
}

export const illustration = {
  id: 'illustration',
  describe: `An editorial illustration of the line's claim when no shot shows it, magazine-style: one object drawn in detail (${EDITORIAL_OBJECTS.join(', ')}; else a world-kit prop, or an icon at hero scale) set large and low on a full-bleed material plate (floorboards, flagstones, fabric, paper, brushed metal) or the style's plate, its number at hero size beside it, and one change landing on the stressed word: it wears (greys and splits), a value rises (a clock's hand sweeps the hour, or a gauge or thermometer), its days are crossed off, a second object lands beside it, a force acts on it (a sun's beam greys it, a foot dents it, rain, heat), or a wipe shows it before and after. A deck that greys in one summer, a clinic's two-week recovery, a report that takes an hour.`,
  params: {subject: `${OBJECT_PARAM} the object the line is about`, change: `one of ${CHANGES.join(' | ')}`, second: `${OBJECT_PARAM} compare only: the object beside it`,
    plate: `${PLATES.join(' | ')} (default paper): a material drawn full-bleed in the style's colours, or style for the scene's own plate`, text: 'string ≤ 32, one line of free type (optional; the caption usually says it)',
    value: 'measure: 1–100, how far it rises (a clock: the share of the hour its hand sweeps)', instrument: 'measure: gauge (a clock sweeps its own face; anything else gets a ring, default) | thermometer', reading: 'measure: string ≤ 10, the number set at hero size as it lands ("1", "48°C")',
    count: 'count: integer 2–31, the days crossed off (a calendar\'s own grid) or cells filled', unit: 'count or measure: string ≤ 10 under the number ("days", "hour")', force: `cause: ${Object.keys(FORCES).join(' | ')}`, pick: 'compare: subject | second, underlined after the change',
    at: `when the change lands (the stressed word): ${AT}`},
  events: ['build', 'change'], timing: timingRules({rules: ['the object lands 0.5 s in, its line 0.7 s later; the change is centred on at (or the change hit) and takes 1–2.2 s, slow → fast → slow, under a 10% kick', 'the plate travels and the stage pushes in through the hold']}), variants: ['default'],
  resolve, view, timeline
};

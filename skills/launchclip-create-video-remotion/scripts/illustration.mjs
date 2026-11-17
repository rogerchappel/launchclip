// illustration (docs/EXPLAINER_CLAIMS_RFC.md §3.2): an editorial illustration
// of a line's claim when no shot shows it: a subject object, an optional
// second object, and one change over time, on a full-bleed plate. Like
// `graphic` (kit/core/graphic.mjs) it is a closed vocabulary, never free
// drawing: the objects are world-kit props or icons (an object the kit lacks
// is drawn as its icon at hero scale), and the change is one of CHANGES:
//
//   wear         the object greys and cracks (the plate greys with it)
//   measure      a value rises on a gauge ring round the object, or a thermometer
//   count        a row of day cells fills under the object, its count ticking up
//   compare      a second object lands beside the first; the pick is underlined
//   cause        a force (sun, foot, rain, heat) arrives and the object wears
//   before-after a wipe across the object reveals its worn state
//
// The change is the motion: it lands on `at` (the stressed word, or the
// `change` hit), centred there with a slow → fast → slow ease and no
// overshoot, while the stage drifts through the hold (a slow push) and the
// plate drifts the other way. One renderer-neutral model on catalogue H's
// view tree and op list, so both renderers draw it from this file
// (registered through kit/core/catalog-i-explain.mjs).
//
// Geometry: the stage (the object and its change) covers STAGE_SHARE of the
// safe area, inside the 50–80% the RFC asks, and the model's layout declares
// the whole safe area as a hero rect, so src/visual_density.js counts it as
// filled.

import {hashString, seededRandom} from './ambient.mjs';
import {hex2, svgRoot} from './catalog-b-view.mjs';
import {timingRules} from './catalog-b-base.mjs';
import {contrastRatio, createHBase, fitText, mixColor, r2, rt} from './catalog-h-base.mjs';
import {abs, countOps, countSamples, drawOps, el, label, set, strokePath, tw} from './catalog-h-view.mjs';
import {graphicNodes} from './graphic.mjs';
import {ICON_BOX, ICON_NAMES, iconNode, iconPath, isIcon} from './icons.mjs';
import {PROP_IDS} from './worlds/index.mjs';
import {AT} from './catalog-i-base.mjs';

export const CHANGES = Object.freeze(['wear', 'measure', 'count', 'compare', 'cause', 'before-after']);
export const MATERIALS = Object.freeze(['wood', 'stone', 'fabric', 'paper', 'metal']);
export const PLATES = Object.freeze([...MATERIALS, 'style']);
export const FORCES = Object.freeze({sun: 'sun', foot: 'footprints', rain: 'cloud-rain', heat: 'flame'});
export const INSTRUMENTS = Object.freeze(['gauge', 'thermometer']);
export const STAGE_SHARE = 0.62;
// The hue each material is mixed from; the style's bg sets how dark it sits.
const MATERIAL_HUE = {wood: '#9a6a43', stone: '#8a8780', fabric: '#5f6f86', paper: '#d8d0bf', metal: '#9aa3ad'};
// Each kind's change: how long the move takes (s), its cue.
const CHANGE_TIME = {wear: 1.4, measure: 1.4, count: 1.6, compare: 0.8, cause: 1.0, 'before-after': 1.2};
const CUE = {wear: 'whoosh-soft', measure: 'whoosh', count: 'tally', compare: 'pop', cause: 'hit-soft', 'before-after': 'whoosh'};
// Slow → fast → slow, never past the target.
// The camera drift runs at an even speed: an eased drift stalls at the scene's ends, which reads as a frozen frame.
const EASE = 'power2.inOut', DRIFT = 'none';
const WORN = 'grayscale(1) brightness(0.86) contrast(0.88)';

const OBJECT_PARAM = '{object (a world-kit prop: clock, calendar, bench, mug, … or an icon name), icon? (the icon drawn when object is neither), label? ≤ 16 (compare only)}';

/** A validated object: a prop, else an icon (the object itself, or its fallback icon). → {object, prop, icon, label}. */
export function objectSpec(check, raw, path, {labels = false} = {}) {
  check.obj(raw, path, ['object', 'icon', 'label'], ['object']);
  const object = check.str(raw.object, `${path}.object`, 32);
  if (raw.label !== undefined && !labels) check.fail(`${path}.label`, 'is only drawn on a compare; the caption says the words');
  const label = raw.label === undefined ? null : check.str(raw.label, `${path}.label`, 16);
  if (PROP_IDS.includes(object)) return {object, prop: object, icon: null, label};
  if (isIcon(object)) return {object, prop: null, icon: object, label};
  if (raw.icon === undefined) {
    let hint = '';
    try { iconPath(object); } catch (error) { hint = (/\(did you mean [^)]*\)/.exec(error.message) ?? [''])[0]; }
    check.fail(`${path}.object`, `"${object}" is neither a world-kit prop (${PROP_IDS.join(', ')}) nor an icon${hint ? ` ${hint}` : ''}; give icon: the icon to draw it as at hero scale`);
  }
  if (!isIcon(raw.icon)) check.fail(`${path}.icon`, `must be an icon name from kit/core/icons.mjs (${ICON_NAMES.length} names); got ${JSON.stringify(raw.icon)}`);
  return {object, prop: null, icon: raw.icon, label};
}

/** The material's tone in the style: the hue mixed into bg, eased back toward bg until the foreground keeps 4.5:1 on it. */
export function materialTone(material, colors, foreground) {
  for (let k = 0.5; k > 0; k -= 0.05) {
    const tone = mixColor(MATERIAL_HUE[material], colors.bg, k);
    if (contrastRatio(foreground, tone) >= 4.5) return tone;
  }
  return colors.bg;
}

/**
 * The stage and object boxes inside a W × H rect (rect-relative px): the
 * stage takes STAGE_SHARE of it, beside (landscape) or under (portrait) the
 * free-type line and the reading.
 */
export function illustrationGeometry({width: W, height: H}, {change, instrument = 'gauge', unit: u, text = false, reading = false}) {
  // A shorts safe area is near square, so only a clearly wide rect puts the type beside the stage.
  const stacked = W < H * 1.2;
  let stage, rows;
  if (stacked) {
    const room = H * (1 - STAGE_SHARE), top = text ? (reading ? room * 0.5 : room) : reading ? 0 : room / 2;
    stage = {x: 0, y: r2(top), width: W, height: r2(H * STAGE_SHARE)};
    rows = {text: text ? {x: 0, y: 0, width: W, height: r2(top)} : null, reading: reading ? {x: 0, y: r2(top + stage.height), width: W, height: r2(H - top - stage.height)} : null};
  } else {
    stage = {x: 0, y: 0, width: r2(W * STAGE_SHARE), height: H};
    const x = r2(stage.width + 40 * u), w = r2(W - stage.width - 40 * u);
    rows = {text: text ? {x, y: 0, width: w, height: r2(reading ? H * 0.5 : H)} : null, reading: reading ? {x, y: r2(text ? H * 0.5 : 0), width: w, height: r2(text ? H * 0.5 : H)} : null};
  }
  const m = Math.min(stage.width, stage.height);
  const square = (cx, cy, s) => ({x: r2(cx - s / 2), y: r2(cy - s / 2), width: r2(s), height: r2(s)});
  const cx = stage.x + stage.width / 2, cy = stage.y + stage.height / 2;
  const boxes = [];
  if (change === 'compare') {
    const gap = 40 * u, labelRoom = 90 * u;
    const s = Math.min((stage.width - gap) / 2, stage.height - labelRoom) * 0.92;
    for (const k of [-1, 1]) boxes.push(square(cx + k * (s + gap) / 2, stage.y + (stage.height - labelRoom) / 2, s));
  } else if (change === 'count') {
    boxes.push(square(cx, stage.y + stage.height * 0.38, Math.min(stage.width, stage.height * 0.74) * 0.9));
  } else if (change === 'measure' && instrument === 'thermometer') {
    boxes.push(square(stage.x + (stage.width - 130 * u) / 2, cy, Math.min(stage.width - 170 * u, stage.height) * 0.86));
  } else if (change === 'measure') {
    boxes.push(square(cx, cy, m * 0.62));
  } else {
    // The stage's own shape, so a wide prop (a bench) fills it; an icon takes the square inside.
    const w = stage.width * 0.9, h = stage.height * 0.88;
    boxes.push({x: r2(cx - w / 2), y: r2(cy - h / 2), width: r2(w), height: r2(h)});
  }
  return {stacked, stage, rows, boxes, ring: change === 'measure' && instrument === 'gauge' ? {cx: r2(cx), cy: r2(cy), r: r2(m * 0.43)} : null};
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

// A material's full-bleed ground: canvas-sized SVG of seeded strokes over the tone, with a vignette.
function materialNodes(gid, material, tone, W, H, u, seed) {
  const rand = seededRandom(hashString(`${material}|${seed}`));
  const light = mixColor('#ffffff', tone, 0.1), dark = mixColor('#000000', tone, 0.28);
  const kids = [el('rect', null, null, [], {x: 0, y: 0, width: W, height: H, fill: tone})];
  const line = (d, stroke, width, opacity) => el('path', null, null, [], {d, stroke, strokeWidth: r2(width), strokeOpacity: opacity, strokeLinecap: 'round', fill: 'none'});
  if (material === 'wood') {
    // Deck boards: planks with gaps, each with wavy grain.
    const board = r2(150 * u);
    for (let y = 0; y < H; y += board) {
      kids.push(el('rect', null, null, [], {x: 0, y: r2(y), width: W, height: r2(board), fill: mixColor(rand() < 0.5 ? light : dark, tone, 0.75 + rand() * 0.2)}));
      for (let g = 0; g < 5; g++) {
        const gy = y + board * (0.15 + g * 0.17), a = board * 0.06 * (0.5 + rand()), f = 0.002 + rand() * 0.003, p = rand() * 6;
        let d = `M0 ${r2(gy)}`;
        for (let x = 60; x <= W + 60; x += 60) d += ` L${x} ${r2(gy + a * Math.sin(x * f + p))}`;
        kids.push(line(d, dark, 2.5 * u, 0.35 + rand() * 0.25));
      }
      kids.push(el('rect', null, null, [], {x: 0, y: r2(y + board - 6 * u), width: W, height: r2(6 * u), fill: mixColor('#000000', tone, 0.5)}));
    }
  } else if (material === 'stone') {
    const s = r2(260 * u);
    for (let y = -s / 2; y < H; y += s) for (let x = -s / 2 + (Math.round(y / s) % 2) * s / 2; x < W; x += s) {
      kids.push(el('rect', null, null, [], {x: r2(x + 5 * u), y: r2(y + 5 * u), width: r2(s - 10 * u), height: r2(s - 10 * u), rx: r2(18 * u), fill: mixColor(rand() < 0.5 ? light : dark, tone, 0.7 + rand() * 0.25)}));
    }
  } else if (material === 'fabric') {
    const step = r2(14 * u);
    for (let y = 0; y < H; y += step) kids.push(line(`M0 ${r2(y)} H${W}`, light, 3 * u, 0.12 + rand() * 0.1));
    for (let x = 0; x < W; x += step) kids.push(line(`M${r2(x)} 0 V${H}`, dark, 3 * u, 0.12 + rand() * 0.1));
  } else if (material === 'paper') {
    for (let i = 0; i < 70; i++) {
      const x = rand() * W, y = rand() * H, l = (40 + rand() * 120) * u, a = rand() * Math.PI;
      kids.push(line(`M${r2(x)} ${r2(y)} q${r2(l / 2 * Math.cos(a + 0.4))} ${r2(l / 2 * Math.sin(a + 0.4))} ${r2(l * Math.cos(a))} ${r2(l * Math.sin(a))}`, dark, 1.5 * u, 0.18));
    }
  } else {
    // Brushed metal: fine horizontal lines and one broad sheen.
    for (let y = 0; y < H; y += 5 * u) kids.push(line(`M0 ${r2(y)} H${W}`, rand() < 0.5 ? light : dark, 1.5 * u, 0.08 + rand() * 0.14));
    kids.push(el('rect', null, null, [], {x: 0, y: 0, width: W, height: H, fill: `url(#${gid}-sheen)`}));
  }
  kids.push(el('rect', null, null, [], {x: 0, y: 0, width: W, height: H, fill: `url(#${gid}-vignette)`}));
  const defs = el('defs', null, null, [
    el('radialGradient', `${gid}-vignette`, null, [el('stop', null, null, [], {offset: '55%', stopColor: '#000000', stopOpacity: 0}), el('stop', null, null, [], {offset: '100%', stopColor: '#000000', stopOpacity: 0.45})], {cx: '50%', cy: '50%', r: '75%'}),
    el('linearGradient', `${gid}-sheen`, null, [el('stop', null, null, [], {offset: '30%', stopColor: '#ffffff', stopOpacity: 0}), el('stop', null, null, [], {offset: '50%', stopColor: '#ffffff', stopOpacity: 0.14}), el('stop', null, null, [], {offset: '70%', stopColor: '#ffffff', stopOpacity: 0})], {x1: '0%', y1: '0%', x2: '100%', y2: '100%'})
  ]);
  return [defs, ...kids];
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
  const OWN = {measure: ['value', 'instrument', 'reading'], count: ['count', 'unit'], cause: ['force'], compare: ['pick']};
  for (const key of ['value', 'instrument', 'reading', 'count', 'unit', 'force', 'pick']) {
    if (p[key] !== undefined && !(OWN[change] ?? []).includes(key)) check.fail(`params.${key}`, `belongs to ${Object.keys(OWN).filter(k => OWN[k].includes(key)).join(' or ')}, not ${change}`);
  }
  const instrument = change === 'measure' ? (p.instrument === undefined ? 'gauge' : check.oneOf(p.instrument, 'params.instrument', INSTRUMENTS)) : null;
  const value = change === 'measure' ? check.num(p.value, 'params.value', 1, 100) / 100 : null;
  const reading = p.reading === undefined ? null : check.str(p.reading, 'params.reading', 10);
  const count = change === 'count' ? check.int(p.count, 'params.count', 2, 31) : null;
  const unit = p.unit === undefined ? null : check.str(p.unit, 'params.unit', 10);
  const force = change === 'cause' ? check.oneOf(p.force, 'params.force', Object.keys(FORCES)) : null;
  const pick = p.pick === undefined ? null : check.oneOf(p.pick, 'params.pick', ['subject', 'second']);
  const plate = p.plate === undefined ? 'paper' : check.oneOf(p.plate, 'params.plate', PLATES);
  const text = p.text === undefined ? null : check.str(p.text, 'params.text', 32);

  const geo = illustrationGeometry(rect, {change, instrument, unit: b.unit, text: Boolean(text), reading: change === 'count' || Boolean(reading)});
  const {rows} = geo;
  // Type sizes come from the rows the stage leaves: one line of text, the reading over its unit.
  const lines = geo.stacked ? 1 : 3;
  const textFit = text ? fitText(check, 'params.text', text, {family: 'display', width: rows.text.width, preferred: r2(Math.min(u(96), rows.text.height * 0.8 / lines)), min: b.min.key, maxLines: lines}) : null;
  const unitSize = r2(Math.max(b.min.key, u(40)));
  const readingSize = rows.reading ? r2(Math.min(u(140), (rows.reading.height * 0.9 - (unit ? unitSize * 1.3 : 0)) / 1.05)) : 0;
  if (rows.reading && readingSize < b.min.key) check.fail(reading ? 'params.reading' : 'params.unit', 'leaves no room for the reading; drop the text or the unit');
  const fg = b.theme.foreground;
  const tone = plate === 'style' ? null : materialTone(plate, b.colors, fg);

  // Timing: the object lands, then the change is centred on `at` (the stressed word).
  const buildAt = b.timeOf('build', undefined, 'build', 0.5);
  const buildEnd = rt(buildAt + 0.7);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: buildEnd, role: 'emphasis', cue: 'whoosh-soft'});
  const span = change === 'count' ? Math.min(CHANGE_TIME.count, 0.08 * count + 0.4) : CHANGE_TIME[change];
  const changeAt = b.timeOf('change', p.at, 'params.at', Math.min(b.lastEvent, Math.max(buildEnd - b.start + span / 2 + 0.3, b.duration * 0.45)),
    {min: buildEnd - b.start + span / 2 - 0.05});
  const moveAt = rt(changeAt - span / 2);
  b.events.push({id: `${b.id}-change`, name: 'change', time: changeAt, endTime: rt(moveAt + span), role: 'emphasis', cue: CUE[change]});

  const canvas = b.canvas;
  const content = {colors: b.colors, change, subject, second, plate, tone, text: textFit ? {text, size: textFit.size, lines: textFit.lines} : null, value, instrument, reading, count, unit, force, pick,
    readingSize, unitSize, geo, buildAt, buildEnd, changeAt, moveAt, span, splitPlate: Boolean(tone && subject.prop && ['wear', 'cause'].includes(change)), ground: {x: r2(-rect.x), y: r2(-rect.y), width: canvas.width, height: canvas.height},
    fg, muted: b.theme.muted, accent: b.colors.accent, primary: b.colors.primary, bg: b.colors.bg, crack: mixColor('#000000', tone ?? b.colors.bg, 0.55), seed: `${subject.object}|${change}`};
  // A fade, not a rise: the plate is full-bleed and must not slide.
  b.motion.enterFrom = {opacity: 0, x: 0, y: 0, scale: 1};
  b.motion.exitTo = {opacity: 0, x: 0, y: 0, scale: 1};
  const model = b.finish(content, {minTextPx: Math.min(textFit?.size ?? Infinity, unitSize)});
  // The drawn plate fills the frame like a picture (src/visual_density.js counts it as drawn, not footage).
  if (tone) model.layout.parts = [{id: 'plate', role: 'media', rect: {x: 0, y: 0, width: canvas.width, height: canvas.height}, over: ['self']}];
  return model;
}

// One object drawn in its box: the prop through graphic's painter, else its icon at hero scale.
function objectNodes(model, spec, box, key, {worn = false} = {}) {
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

function view(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content, g = c.geo;
  const kids = [];
  if (c.tone) {
    // A prop wearing on a material splits the plate under it, not the air between its parts.
    const split = c.splitPlate ? crackPaths({x: model.rect.x, y: r2(model.rect.y + g.stage.y), width: model.rect.width, height: g.stage.height}, c.seed, {along: true}).map((d, i) => strokePath(`${id}-cracks-${i}`, d, c.crack, r2(7 * u))) : [];
    const G = c.ground, svg = (gid, worn) => el('div', gid, {...abs(G.x, G.y, G.width, G.height), transformOrigin: '50% 50%', ...(worn ? {filter: WORN, opacity: 0} : {})},
      [svgRoot(G.width, G.height, [...materialNodes(gid, c.plate, c.tone, G.width, G.height, u, c.seed), ...(worn ? split : [])])]);
    kids.push(svg(`${id}-ground`, false));
    if (['wear', 'cause'].includes(c.change)) kids.push(svg(`${id}-ground-worn`, true));
  }
  const stage = [];
  const box = g.boxes[0];
  const shadow = b => el('div', null, {...abs(r2(b.x + b.width * 0.12), r2(b.y + b.height * 0.86), r2(b.width * 0.76), r2(b.height * 0.1)), borderRadius: '50%', background: `radial-gradient(closest-side, ${hex2('#000000', 0.38)}, ${hex2('#000000', 0)})`});
  const cracks = (cid, b) => el('div', cid, abs(0, 0, g.stage.x + g.stage.width, g.stage.y + g.stage.height), [svgRoot(g.stage.x + g.stage.width, g.stage.y + g.stage.height,
    crackPaths(b, c.seed).map((d, i) => strokePath(`${cid}-${i}`, d, c.crack, r2(6 * u))))]);
  stage.push(shadow(box));
  if (c.change === 'before-after') {
    stage.push(el('div', `${id}-obj`, abs(0, 0, model.rect.width, model.rect.height), [objectNodes(model, c.subject, box, 'a')]));
    stage.push(el('div', `${id}-after`, abs(0, 0, model.rect.width, model.rect.height, {clipPath: `inset(0% 0% 0% ${r2(box.x / model.rect.width * 100)}%)`}), [objectNodes(model, c.subject, box, 'b', {worn: true}), cracks(`${id}-ba-cracks`, box)]));
    stage.push(el('div', `${id}-wipe`, abs(r2(box.x - 3 * u), r2(box.y - 20 * u), r2(6 * u), r2(box.height + 40 * u), {background: c.fg, borderRadius: 999, opacity: 0})));
    const tag = (tid, x, text, align) => label(tid, x, r2(box.y - 70 * u), r2(box.width / 2), text, {size: c.unitSize, family: fonts.meta, color: c.muted, align, spacing: '0.1em', extra: {opacity: 0}});
    stage.push(tag(`${id}-before`, box.x, 'BEFORE', 'left'), tag(`${id}-after-tag`, r2(box.x + box.width / 2), 'AFTER', 'right'));
  } else {
    stage.push(el('div', `${id}-obj`, abs(0, 0, model.rect.width, model.rect.height), [objectNodes(model, c.subject, box, 'a')]));
  }
  if (['wear', 'cause'].includes(c.change)) {
    stage.push(el('div', `${id}-worn`, {...abs(0, 0, model.rect.width, model.rect.height), opacity: 0}, [objectNodes(model, c.subject, box, 'w', {worn: true})]));
    if (!c.splitPlate) stage.push(cracks(`${id}-cracks`, box));
  }
  if (c.change === 'cause') {
    const s = r2(box.width * 0.42);
    stage.push(el('div', `${id}-force`, {...abs(r2(box.x + box.width - s * 0.7), r2(box.y - s * 0.45), s, s), opacity: 0}, [iconNode(FORCES[c.force], {x: 0, y: 0, size: s, color: c.accent, stroke: r2(14 * u * ICON_BOX / s), mode: 'duotone', tintOpacity: 0.3})]));
  }
  if (c.change === 'compare') {
    const b2 = g.boxes[1];
    stage[0] = shadow(g.boxes[0]);
    stage[1] = el('div', `${id}-obj`, abs(0, 0, model.rect.width, model.rect.height), [objectNodes(model, c.subject, g.boxes[0], 'a')]);
    stage.push(el('div', `${id}-obj2`, abs(0, 0, model.rect.width, model.rect.height), [shadow(b2), objectNodes(model, c.second, b2, 'b')]));
    [[c.subject, g.boxes[0], 'l1'], [c.second, b2, 'l2']].forEach(([spec, bx, lid]) => {
      if (spec.label) stage.push(label(`${id}-${lid}`, bx.x, r2(bx.y + bx.height + 18 * u), bx.width, spec.label, {size: c.unitSize, family: fonts.body, color: c.fg, align: 'center', weight: 700, extra: {opacity: 0}}));
    });
    if (c.pick) {
      const bx = c.pick === 'subject' ? g.boxes[0] : b2, y = r2(bx.y + bx.height + 18 * u + c.unitSize * 1.35);
      stage.push(svgRoot(model.rect.width, model.rect.height, [strokePath(`${id}-pick`, `M${r2(bx.x + bx.width * 0.2)} ${y} L${r2(bx.x + bx.width * 0.8)} ${y}`, c.accent, r2(10 * u))]));
    }
  }
  if (c.change === 'measure' && c.instrument === 'gauge') {
    const {cx, cy, r} = g.ring, a0 = 135, a1 = 135 + 270 * c.value;
    const arc = (from, to) => { const p = d => `${r2(cx + r * Math.cos(d * Math.PI / 180))} ${r2(cy + r * Math.sin(d * Math.PI / 180))}`; return `M${p(from)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${p(to)}`; };
    stage.push(svgRoot(model.rect.width, model.rect.height, [
      el('path', null, null, [], {d: arc(135, 405), stroke: hex2(c.fg, 0.18), strokeWidth: r2(22 * u), strokeLinecap: 'round', fill: 'none'}),
      strokePath(`${id}-fill`, arc(a0, a1), c.accent, r2(22 * u))
    ]));
    const d = r2(46 * u);
    stage.push(el('div', `${id}-tip`, abs(r2(cx - r), r2(cy - r), r2(2 * r), r2(2 * r), {transformOrigin: '50% 50%', transform: `rotate(${a0}deg)`}), [
      el('div', null, {...abs(r2(2 * r - d / 2), r2(r - d / 2), d, d), borderRadius: '50%', background: c.fg, boxShadow: `0 0 ${r2(24 * u)}px ${hex2(c.accent, 0.8)}`})]));
  }
  if (c.change === 'measure' && c.instrument === 'thermometer') {
    const tw_ = r2(56 * u), x = r2(g.stage.x + g.stage.width - tw_ - 40 * u), top = r2(box.y), h = r2(box.height * 0.82), bulb = r2(tw_ * 1.7);
    stage.push(el('div', null, {...abs(x, top, tw_, h), borderRadius: 999, background: hex2(c.fg, 0.16)}));
    stage.push(el('div', `${id}-fill`, {...abs(r2(x + 12 * u), r2(top + h * (1 - c.value)), r2(tw_ - 24 * u), r2(h * c.value + bulb * 0.3)), borderRadius: 999, background: c.accent, transformOrigin: '50% 100%'}));
    stage.push(el('div', null, {...abs(r2(x + tw_ / 2 - bulb / 2), r2(top + h - bulb * 0.2), bulb, bulb), borderRadius: '50%', background: c.accent, boxShadow: `0 0 ${r2(30 * u)}px ${hex2(c.accent, 0.6)}`}));
  }
  if (c.change === 'count') {
    const n = c.count, cols = Math.min(n, n > 14 ? Math.ceil(n / 2) : n), rows = Math.ceil(n / cols);
    const area = {x: g.stage.x, y: r2(box.y + box.height + 30 * u), width: g.stage.width, height: r2(g.stage.y + g.stage.height - box.y - box.height - 30 * u)};
    const gap = r2(10 * u), cell = r2(Math.min((area.width - gap * (cols - 1)) / cols, (area.height - gap * (rows - 1)) / rows));
    const x0 = r2(area.x + (area.width - cols * cell - (cols - 1) * gap) / 2);
    for (let i = 0; i < n; i++) {
      const x = r2(x0 + (i % cols) * (cell + gap)), y = r2(area.y + Math.floor(i / cols) * (cell + gap));
      stage.push(el('div', null, {...abs(x, y, cell, cell), boxSizing: 'border-box', borderRadius: r2(cell * 0.22), border: `${r2(3 * u)}px solid ${hex2(c.fg, 0.28)}`}));
      stage.push(el('div', `${id}-cell-${i}`, {...abs(x, y, cell, cell), borderRadius: r2(cell * 0.22), background: c.accent, opacity: 0}));
    }
  }
  kids.push(el('div', `${id}-cam`, abs(0, 0, model.rect.width, model.rect.height, {transformOrigin: '50% 50%'}), stage));

  // Free type on the plate: the line above (stacked) or beside the stage, and the reading.
  const align = g.stacked ? 'center' : 'left';
  if (c.text) {
    const row = g.rows.text;
    kids.push(label(`${id}-text`, row.x, r2(row.y + (row.height - c.text.size * 1.1 * c.text.lines) / 2), row.width, c.text.text, {size: c.text.size, family: fonts.display, color: c.fg, align, lineHeight: 1.1, wrap: c.text.lines > 1, extra: {opacity: 0}}));
  }
  const readingText = c.change === 'count' ? '1' : c.reading;
  if (readingText) {
    const row = g.rows.reading;
    const y = r2(row.y + (row.height - c.readingSize * 1.05 - (c.unit ? c.unitSize * 1.3 : 0)) / 2);
    kids.push(label(`${id}-reading`, row.x, y, row.width, readingText, {size: c.readingSize, family: fonts.display, color: c.accent, align, lineHeight: 1.05, extra: {opacity: 0}}));
    if (c.unit) kids.push(label(`${id}-unit`, row.x, r2(y + c.readingSize * 1.05), row.width, c.unit.toUpperCase(), {size: c.unitSize, family: fonts.meta, color: c.muted, align, spacing: '0.1em', extra: {opacity: 0}}));
  }
  return kids;
}

function timeline(model, ops) {
  const {id, start, end, unit: u} = model;
  const c = model.content, g = c.geo;
  const at = c.moveAt, D = c.span;
  const fadeIn = (target, time, dur = 0.5, to = 1) => { set(ops, target, start, {opacity: 0}); tw(ops, target, time, dur, EASE, {opacity: 0}, {opacity: to}); };
  // The camera: the plate drifts one way, the stage pushes in through the hold. The plate keeps
  // (scale − 1) / 2 of the frame in overhang, more than its travel, so no edge ever shows.
  if (c.tone) {
    set(ops, `${id}-ground`, start, {x: 0, y: 0, scaleX: 1.16, scaleY: 1.16});
    tw(ops, `${id}-ground`, start, rt(end - start), DRIFT, {x: 0, y: 0, scaleX: 1.16, scaleY: 1.16}, {x: r2(-50 * u), y: r2(30 * u), scaleX: 1.1, scaleY: 1.1});
    if (['wear', 'cause'].includes(c.change)) {
      set(ops, `${id}-ground-worn`, start, {opacity: 0, x: 0, y: 0, scaleX: 1.16, scaleY: 1.16});
      tw(ops, `${id}-ground-worn`, start, rt(end - start), DRIFT, {x: 0, y: 0, scaleX: 1.16, scaleY: 1.16}, {x: r2(-50 * u), y: r2(30 * u), scaleX: 1.1, scaleY: 1.1});
      tw(ops, `${id}-ground-worn`, c.change === 'cause' ? c.changeAt : at, D, EASE, {opacity: 0}, {opacity: 0.85});
    }
  }
  set(ops, `${id}-cam`, start, {x: 0, y: 0, scaleX: 0.94, scaleY: 0.94});
  tw(ops, `${id}-cam`, start, rt(end - start), DRIFT, {x: 0, y: 0, scaleX: 0.94, scaleY: 0.94}, {x: 0, y: r2(-30 * u), scaleX: 1.08, scaleY: 1.08});
  // The object lands.
  set(ops, `${id}-obj`, start, {opacity: 0, x: 0, y: r2(40 * u)});
  tw(ops, `${id}-obj`, c.buildAt, 0.7, EASE, {opacity: 0, y: r2(40 * u)}, {opacity: 1, y: 0});
  if (c.text) fadeIn(`${id}-text`, rt(c.buildAt + 0.15), 0.6);

  if (c.change === 'wear' || c.change === 'cause') {
    const wearAt = c.change === 'cause' ? c.changeAt : at;
    if (c.change === 'cause') {
      // The force comes in from off its side, blurred at its fastest, and lands on the word.
      const from = {sun: {x: 160, y: -160}, rain: {x: 0, y: -220}, foot: {x: 0, y: -260}, heat: {x: 0, y: 260}}[c.force];
      set(ops, `${id}-force`, start, {opacity: 0, x: r2(from.x * u), y: r2(from.y * u), blur: 0});
      tw(ops, `${id}-force`, at, D, EASE, {opacity: 0, x: r2(from.x * u), y: r2(from.y * u)}, {opacity: 1, x: 0, y: 0});
      tw(ops, `${id}-force`, at, rt(D / 2), 'power2.in', {blur: 0}, {blur: r2(8 * u)});
      tw(ops, `${id}-force`, rt(at + D / 2), rt(D / 2), 'power2.out', {blur: r2(8 * u)}, {blur: 0});
    }
    fadeIn(`${id}-worn`, wearAt, D);
    crackPaths(g.boxes[0], c.seed).forEach((_, i) => drawOps(ops, `${id}-cracks-${i}`, start, rt(wearAt + D * 0.3 + i * 0.12), rt(D * 0.7), EASE));
  }
  if (c.change === 'before-after') {
    const box = g.boxes[0], W = model.rect.width, left = r2(box.x / W * 100), right = r2(100 - (box.x + box.width) / W * 100);
    set(ops, `${id}-after`, start, {clipT: 0, clipR: 0, clipB: 0, clipL: r2(100 - right)});
    tw(ops, `${id}-after`, at, D, EASE, {clipT: 0, clipR: 0, clipB: 0, clipL: r2(100 - right)}, {clipT: 0, clipR: 0, clipB: 0, clipL: left});
    set(ops, `${id}-wipe`, start, {opacity: 0, x: r2(box.width), y: 0});
    tw(ops, `${id}-wipe`, rt(at - 0.2), 0.2, EASE, {opacity: 0}, {opacity: 1});
    tw(ops, `${id}-wipe`, at, D, EASE, {x: r2(box.width)}, {x: 0});
    tw(ops, `${id}-wipe`, rt(at + D), 0.3, EASE, {opacity: 1}, {opacity: 0});
    crackPaths(box, c.seed).forEach((_, i) => drawOps(ops, `${id}-ba-cracks-${i}`, start, rt(at + D * 0.4 + i * 0.1), rt(D * 0.6), EASE));
    fadeIn(`${id}-before`, rt(c.buildAt + 0.3), 0.5);
    fadeIn(`${id}-after-tag`, rt(at + D * 0.5), 0.5);
  }
  if (c.change === 'measure') {
    if (c.instrument === 'gauge') {
      drawOps(ops, `${id}-fill`, start, at, D, EASE);
      set(ops, `${id}-tip`, start, {rotation: 135});
      tw(ops, `${id}-tip`, at, D, EASE, {rotation: 135}, {rotation: r2(135 + 270 * c.value)});
    } else {
      set(ops, `${id}-fill`, start, {scaleX: 1, scaleY: 0});
      tw(ops, `${id}-fill`, at, D, EASE, {scaleY: 0}, {scaleY: 1});
    }
  }
  if (c.change === 'count') {
    const step = c.count > 1 ? (D - 0.3) / (c.count - 1) : 0;
    for (let i = 0; i < c.count; i++) fadeIn(`${id}-cell-${i}`, rt(at + i * step), 0.3);
    countOps(ops, `${id}-reading`, start, '1', countSamples(model, at, rt(D - 0.3), 'none', 1, c.count, v => String(Math.round(v))));
  }
  if (c.change === 'compare') {
    set(ops, `${id}-obj2`, start, {opacity: 0, x: r2(60 * u), y: 0});
    tw(ops, `${id}-obj2`, at, D, EASE, {opacity: 0, x: r2(60 * u)}, {opacity: 1, x: 0});
    if (c.subject.label) fadeIn(`${id}-l1`, rt(c.buildAt + 0.3));
    if (c.second.label) fadeIn(`${id}-l2`, rt(at + D * 0.5));
    if (c.pick) drawOps(ops, `${id}-pick`, start, rt(at + D + 0.2), 0.6, EASE);
  }
  // The reading lands with the change.
  if (c.change === 'measure' && c.reading) fadeIn(`${id}-reading`, rt(at + D * 0.6), 0.5);
  if (c.change === 'count') fadeIn(`${id}-reading`, at, 0.3);
  if (c.unit) fadeIn(`${id}-unit`, rt(at + 0.1), 0.4);
}

export const illustration = {
  id: 'illustration',
  describe: 'An editorial illustration of the line\'s claim when no shot shows it: one drawn object (a world-kit prop, or an icon at hero scale) on a full-bleed material plate (wood boards, stone, fabric, paper, brushed metal) or the style\'s plate, and one change landing on the stressed word: it wears (greys and cracks), a value rises on a gauge or thermometer, a day count fills, a second object lands beside it, a force (sun, foot, rain, heat) acts on it, or a wipe shows it before and after. A deck that greys in one summer, a clinic\'s two-week recovery, a report that takes an hour.',
  params: {subject: `${OBJECT_PARAM} the object the line is about`, change: `one of ${CHANGES.join(' | ')}`, second: `${OBJECT_PARAM} compare only: the object beside it`,
    plate: `${PLATES.join(' | ')} (default paper): a material drawn full-bleed in the style's colours, or style for the scene's own plate`, text: 'string ≤ 32, one line of free type (optional; the caption usually says it)',
    value: 'measure: 1–100, how far the gauge or thermometer rises', instrument: 'measure: gauge (a ring round the object, default) | thermometer', reading: 'measure: string ≤ 10 shown as it lands ("1 hr", "48°C")',
    count: 'count: integer 2–31, the cells that fill (days, visits)', unit: 'count: string ≤ 10 under the number ("days")', force: `cause: ${Object.keys(FORCES).join(' | ')}`, pick: 'compare: subject | second, underlined after the change',
    at: `when the change lands (the stressed word): ${AT}`},
  events: ['build', 'change'], timing: timingRules({rules: ['the object lands 0.5 s in; the change is centred on at (or the change hit) and takes 0.8–1.6 s, slow → fast → slow', 'the stage drifts through the hold']}), variants: ['default'],
  resolve, view, timeline
};

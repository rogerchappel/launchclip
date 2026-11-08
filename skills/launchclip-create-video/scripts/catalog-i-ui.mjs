// Catalogue I: ui-scene, an animated interface scene. The director lays out
// tuned UI components (an editor timeline, a loudness meter, locked tool
// cards, a terminal, search results, a card wall, a downloads list, a comment
// box...) as elements with rects, entrance times and timed beats; the painter
// (kit/core/ui-runtime.mjs) draws them as DOM, a pure function of time, in both
// renderers. Registered in kit/core/catalog-h.mjs, so catalogue H's emitters
// carry it; they paint every host in model.content.ui (docs/KIT_CONTRACTS.md,
// "UI scenes").
//
// Element rects are design px (1080 wide in 9:16). Text (headlines and
// chips) is checked at the size it sets: inside the platform safe zone and
// clear of the caption band. Panels may use the whole stage (the full width
// less a 40 px margin, from just above the safe zone to its foot) and run
// under the captions, whose word chips are opaque, as the reference reels
// do. An element marked bleed (a decorative waveform or card wall) may run
// to the canvas edge. Settled elements hold still: the module opts out of
// the hold drift (layout.drift false); the camera carries the life.

import {createHBase, r2, rt} from './catalog-h-base.mjs';
import {timingRules} from './catalog-b-base.mjs';
import {mixColor} from './catalog-b-base.mjs';
import {abs, el} from './catalog-h-view.mjs';
import {UI_KINDS} from './ui-runtime.mjs';
import {uiDepthAt, uiHeadlineLines, uiHeadlinePlain, uiStageProject} from './ui-paint.mjs';
import {captionBandAt, profileGeometry} from './layout-check.mjs';

const ENTERS = Object.freeze(['up', 'down', 'left', 'right', 'zoom', 'slam', 'pop', 'drop', 'fade', 'focus', 'cut']);
const EXITS = Object.freeze(['lift', 'rack']);
const ELEMENT_KEYS = ['id', 'kind', 'rect', 'at', 'enter', 'enterDuration', 'dist', 'overshoot', 'out', 'exit', 'props', 'beats', 'children', 'tilt', 'z', 'depth', 'flashAt', 'flashTone', 'bleed', 'cue'];
// The entrance an element makes when it names none: a headline racks into
// focus, a bloom is its own swell, everything else rises.
const DEFAULT_ENTER = Object.freeze({headline: 'focus', bloom: 'cut'});
const MAX_FLASHES = 12;
const MAX_ELEMENTS = 120;
// Text props checked for length and escaped by the painter; headline text must fit its rect.
const HEADLINE_ADVANCE = 0.6;
// The sound an entrance asks for when the element names none.
const ENTER_CUES = Object.freeze({slam: 'impact', pop: 'pop-soft', zoom: 'whoosh-soft', drop: 'thud'});
// Kinds whose text the safe zone and caption band rules apply to.
const TEXT_KINDS = new Set(['headline', 'chip']);
// The smallest rect a panel draws legibly in (design px); lock-cards also
// needs LOCK_CARD_MIN px a card.
const MIN_SIZE = Object.freeze({bloom: {width: 200, height: 200}, meter: {width: 560, height: 320}, timeline: {width: 600, height: 340}, terminal: {width: 560, height: 320}, results: {width: 560, height: 420}, downloads: {width: 560, height: 300}, 'frame-ruler': {width: 800, height: 440}, 'marker-snap': {width: 560, height: 240}});
const LOCK_CARD_MIN = 110;

/** The box a headline or chip's text sets in (design px): its width and line height at its size, placed by its align. */
export function uiTextBox(kind, props, rect, beats = []) {
  let width = 0, height = 0;
  for (const state of headlineStates(props, beats)) {
    if (kind === 'headline') {
      const m = headlineMeasure(state);
      width = Math.max(width, m.width);
      height = Math.max(height, m.height);
      continue;
    }
    const text = String(state.text ?? '');
    const size = Number(state.size) || 30;
    width = Math.max(width, text.length * size * 0.62 + size * 1.2);
    height = Math.max(height, size * 1.45);
  }
  width = Math.min(rect.width, width);
  height = Math.min(rect.height, height);
  const align = props.align ?? 'center';
  const x = align === 'left' ? rect.x : align === 'right' ? rect.x + rect.width - width : rect.x + (rect.width - width) / 2;
  return {x: r2(x), y: r2(rect.y + (rect.height - height) / 2), width: r2(width), height: r2(height)};
}

/**
 * Every state an element's text shows: its props, its swap (whose text
 * stands in for the lines, as the painter's uiHeadlineState) and each beat
 * merged in, in order (uiPropsAt).
 */
function headlineStates(props, beats) {
  const states = [props];
  if (props.swap) {
    const swapped = {...props, ...props.swap};
    if (props.swap.text !== undefined && props.swap.lines === undefined) delete swapped.lines;
    states.push(swapped);
  }
  let at = props;
  for (const beat of beats) { at = {...at, ...beat.set}; states.push(at); }
  return states;
}

/**
 * A headline state's text block (design px): its single line at its size,
 * or its rich lines stacked, each at its own size, tracking and gap, as the
 * painter sets them (uiHeadlineLines).
 */
function headlineMeasure(state) {
  const rich = Array.isArray(state.lines) && state.lines.length;
  const lines = uiHeadlineLines(state, 0);
  if (!rich) return {width: lines[0].text.length * lines[0].size * HEADLINE_ADVANCE, height: lines[0].size * 1.05, lines: [{width: lines[0].text.length * lines[0].size * HEADLINE_ADVANCE}]};
  const each = lines.map((line) => ({width: uiHeadlinePlain(line.text).length * line.size * line.advance, height: line.size + line.gap}));
  return {width: Math.max(...each.map((line) => line.width)), height: each.reduce((sum, line) => sum + line.height, 0), lines: each};
}

/** A tilted element's footprint: the rect turned by tilt.z, grown for the perspective of tilt.x and tilt.y. */
export function uiTiltBox(rect, tilt) {
  if (!tilt) return rect;
  const rad = (deg) => Math.abs(deg ?? 0) * Math.PI / 180;
  const z = rad(tilt.z), grow = 1 + 0.5 * Math.sin(Math.max(rad(tilt.x), rad(tilt.y)));
  const width = (rect.width * Math.cos(z) + rect.height * Math.sin(z)) * grow;
  const height = (rect.width * Math.sin(z) + rect.height * Math.cos(z)) * grow;
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  return {x: r2(cx - width / 2), y: r2(cy - height / 2), width: r2(width), height: r2(height)};
}

/**
 * A top-level box as the stage shows it (design px): moved by its depth and
 * the stage's dolly, then turned by the stage's tilt, as the painter does
 * (uiDepthAt, uiStageProject). The dolly runs on straight lines, so the
 * bounds of the box at the scene's start and end hold it all scene long.
 */
export function uiStageBox(box, depth, stage, width, height) {
  if (!stage && !depth) return box;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of [0, stage?.duration ?? 0]) {
    const d = uiDepthAt(depth, stage, t, width, height);
    for (const [px, py] of [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]) {
      const mx = d.cx + d.x + (px - d.cx) * d.s, my = d.cy + d.y + (py - d.cy) * d.s;
      const [sx, sy] = stage?.tilt ? uiStageProject(mx, my, stage.tilt, width, height) : [mx, my];
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
  }
  return {x: r2(x0), y: r2(y0), width: r2(x1 - x0), height: r2(y1 - y0)};
}

/**
 * The painter's theme from the brand: dark surfaces from bg, text from paper,
 * the accent for state, and an alert colour (params.alert, default a warm red)
 * for the broken "before" state.
 */
export function uiTheme(colors, alert = '#ff4b3e') {
  const {bg, paper, accent} = colors;
  const m = (fg, a) => mixColor(fg, bg, a);
  return {
    bg, ink: paper, muted: m(paper, 0.52), dim: m(paper, 0.26), soft: m(paper, 0.8), accent, accentDim: m(accent, 0.24), onAccent: bg,
    tint: m(accent, 0.12), alert, alertDeep: mixColor(alert, '#000000', 0.76), alertBg: m(alert, 0.12),
    panel: m(paper, 0.03), panel2: m(paper, 0.07), panel3: m(paper, 0.15), well: m(paper, 0.02), lane: m(paper, 0.045), line: m(paper, 0.12), line2: m(paper, 0.2)
  };
}

function uiResolve(params, ctx) {
  const b = createHBase('ui-scene', params, ctx, {allowed: ['elements', 'alert', 'stage'], required: ['elements']});
  const {check, unit} = b;
  const p = b.params;
  const W = r2(b.canvas.width / unit), H = r2(b.canvas.height / unit);
  // The stage: the full width less a 40 px margin, from just above the safe
  // zone's top to its bottom; elements stay out of the caption band.
  const geometry = profileGeometry(b.canvas, b.portrait ? 'shorts' : 'landscape');
  const zone = geometry.safeZone, cap = geometry.captionBand;
  const margin = 40;
  const safe = {x: r2(zone.x / unit), y: r2(zone.y / unit), width: r2(zone.width / unit), height: r2(zone.height / unit)};
  const stage = {x: margin, y: r2(zone.y / unit - margin), width: r2(W - 2 * margin), height: r2((zone.y + zone.height) / unit - zone.y / unit + margin)};
  // The caption band where the story puts its captions (bottom by default,
  // mid-frame with position "middle", near the top with "top"), placed as
  // the layout check places it (captionBandAt).
  const placedBand = captionBandAt(cap, b.canvas, ctx.captions ?? 'auto');
  const band = {x: r2(placedBand.x / unit), y: r2(placedBand.y / unit), width: r2(placedBand.width / unit), height: r2(placedBand.height / unit)};
  const alert = p.alert === undefined ? '#ff4b3e' : b.resolveColor(p.alert, 'params.alert', '#ff4b3e');
  const stageView = p.stage === undefined ? undefined : stageOf(check, p.stage, b.duration);
  // Where a top-level box shows once depth and the stage have moved it.
  const shown = (box, depth) => uiStageBox(box, depth, stageView, W, H);
  let count = 0;
  const ids = new Set();
  let firstAt = Infinity;
  const time = (value, path) => check.num(value, path, 0, b.duration);

  const element = (raw, path, parent) => {
    check.obj(raw, path, ELEMENT_KEYS, ['kind', 'rect', 'at']);
    if (++count > MAX_ELEMENTS) check.fail(path, `is one element too many: a ui-scene draws at most ${MAX_ELEMENTS}`);
    const kind = check.oneOf(raw.kind, `${path}.kind`, UI_KINDS);
    check.obj(raw.rect, `${path}.rect`, ['x', 'y', 'width', 'height'], ['x', 'y', 'width', 'height']);
    const rect = {x: check.num(raw.rect.x, `${path}.rect.x`, -W, 2 * W), y: check.num(raw.rect.y, `${path}.rect.y`, -H, 2 * H),
      width: check.num(raw.rect.width, `${path}.rect.width`, 4, 2 * W), height: check.num(raw.rect.height, `${path}.rect.height`, 4, 2 * H)};
    const bleed = raw.bleed === undefined ? false : check.bool(raw.bleed, `${path}.bleed`);
    const min = MIN_SIZE[kind];
    if (min && (rect.width + 0.5 < min.width || rect.height + 0.5 < min.height)) check.fail(`${path}.rect`, `is ${rect.width}×${rect.height}; a ${kind} needs at least ${min.width}×${min.height} to draw legibly`);
    const tilt = raw.tilt === undefined ? undefined : tiltOf(check, raw.tilt, `${path}.tilt`);
    let depth = 0;
    if (raw.depth !== undefined) {
      if (parent) check.fail(`${path}.depth`, 'sets a layer of the scene; only top-level elements take depth (a child sits at its parent\'s)');
      depth = check.num(raw.depth, `${path}.depth`, 0, 1);
    }
    const footprint = parent ? uiTiltBox(rect, tilt) : shown(uiTiltBox(rect, tilt), depth);
    // A bloom fades to nothing at its edges: light may run off the stage.
    if (!parent && !bleed && !TEXT_KINDS.has(kind) && kind !== 'bloom') {
      const r = footprint, eps = 0.5;
      if (r.x < stage.x - eps || r.y < stage.y - eps || r.x + r.width > stage.x + stage.width + eps || r.y + r.height > stage.y + stage.height + eps) {
        check.fail(`${path}.rect`, `${tilt || depth || stageView ? `${tilt ? 'turned by its tilt' : 'placed by its depth and the stage'}, it covers {x: ${r.x}, y: ${r.y}, width: ${r.width}, height: ${r.height}}, which ` : ''}must sit on the stage, {x: ${stage.x}, y: ${stage.y}, width: ${stage.width}, height: ${stage.height}} (design px); mark a decorative element bleed: true to let it run to the edge`);
      }
    }
    const at = time(raw.at, `${path}.at`);
    if (parent && at + 1e-9 < parent.at) check.fail(`${path}.at`, `is before its parent enters (${parent.at} s)`);
    // A bloom is light, not something on screen.
    if (kind !== 'bloom') firstAt = Math.min(firstAt, at);
    const out = raw.out === undefined ? undefined : time(raw.out, `${path}.out`);
    if (out !== undefined && out <= at) check.fail(`${path}.out`, 'must be after at');
    const enter = raw.enter === undefined ? DEFAULT_ENTER[kind] ?? 'up' : check.oneOf(raw.enter, `${path}.enter`, ENTERS);
    // An element that racked into focus racks out of it.
    const exit = raw.exit === undefined ? (enter === 'focus' ? 'rack' : 'lift') : check.oneOf(raw.exit, `${path}.exit`, EXITS);
    let flashAt = undefined;
    if (raw.flashAt !== undefined) {
      const list = Array.isArray(raw.flashAt) ? raw.flashAt : [raw.flashAt];
      if (!list.length || list.length > MAX_FLASHES) check.fail(`${path}.flashAt`, `must be a time or a list of 1–${MAX_FLASHES} times`);
      flashAt = list.map((value, k) => time(value, `${path}.flashAt${Array.isArray(raw.flashAt) ? `[${k}]` : ''}`)).sort((x, y) => x - y);
    }
    const flashTone = raw.flashTone === undefined ? undefined : check.oneOf(raw.flashTone, `${path}.flashTone`, ['white', 'accent']);
    let id = undefined;
    if (raw.id !== undefined) {
      id = check.str(raw.id, `${path}.id`, 40);
      if (ids.has(id)) check.fail(`${path}.id`, `repeats "${id}"`);
      ids.add(id);
    }
    const props = raw.props === undefined ? {} : raw.props;
    check.obj(props, `${path}.props`, Object.keys(props));
    if (kind === 'headline') {
      headlineFits(check, props, rect, `${path}.props`, {at, time});
      if (props.swap !== undefined) {
        check.obj(props.swap, `${path}.props.swap`, Object.keys(props.swap), ['at']);
        if (props.swap.text !== undefined || props.swap.lines !== undefined) headlineFits(check, headlineStates(props, [])[1], rect, `${path}.props.swap`, {at, time});
      }
    }
    let state = props;
    const beats = (raw.beats ?? []).map((beat, k) => {
      check.obj(beat, `${path}.beats[${k}]`, ['at', 'set', 'cue'], ['at', 'set']);
      check.obj(beat.set, `${path}.beats[${k}].set`, Object.keys(beat.set));
      if (kind === 'headline') {
        if (Array.isArray(state.lines) && beat.set.text !== undefined && beat.set.lines === undefined) check.fail(`${path}.beats[${k}].set.text`, 'changes a headline set in lines; change them with set.lines');
        state = {...state, ...beat.set};
        if (beat.set.text !== undefined || beat.set.lines !== undefined) headlineFits(check, state, rect, `${path}.beats[${k}].set`, {at, time});
      }
      const beatAt = time(beat.at, `${path}.beats[${k}].at`);
      const cue = beat.cue === undefined ? null : check.str(beat.cue, `${path}.beats[${k}].cue`, 32);
      // Every beat is a change on screen (the holds gate counts events); only a cue makes a sound.
      b.events.push({id: `${b.id}-beat-${count}-${k}`, name: 'beat', time: rt(b.start + beatAt), role: 'emphasis', ...(cue ? {cue} : {})});
      return {at: beatAt, set: beat.set};
    }).sort((x, y) => x.at - y.at);
    if (!parent && !bleed && TEXT_KINDS.has(kind)) {
      const box = shown(uiTextBox(kind, props, rect, beats), depth), eps = 0.5;
      const outside = box.x < safe.x - eps || box.y < safe.y - eps || box.x + box.width > safe.x + safe.width + eps || box.y + box.height > safe.y + safe.height + eps;
      const inBand = box.y < band.y + band.height && box.y + box.height > band.y && box.x < band.x + band.width && box.x + box.width > band.x;
      if (outside || inBand) check.fail(`${path}.rect`, `sets its text in {x: ${box.x}, y: ${box.y}, width: ${box.width}, height: ${box.height}}, which must sit inside the platform safe zone {x: ${safe.x}, y: ${safe.y}, width: ${safe.width}, height: ${safe.height}} (design px) and clear of the caption band (y ${band.y}–${r2(band.y + band.height)}): headlines and chips are the text people read`);
    }
    if (kind === 'lock-cards') {
      const n = Array.isArray(props.cards) ? props.cards.length : 0;
      const room = (rect.height - (props.title ? 64 : 0) - (props.counter === false ? 0 : 120) - 26 - 20 * Math.max(0, n - 1)) / Math.max(1, n);
      if (n && room + 0.5 < LOCK_CARD_MIN) check.fail(`${path}.rect`, `gives each of its ${n} cards ${Math.round(room)} px; a card needs at least ${LOCK_CARD_MIN} px (height ${Math.ceil(rect.height + (LOCK_CARD_MIN - room) * n)} or more)`);
    }
    const cue = raw.cue === undefined ? ENTER_CUES[enter] ?? null : raw.cue === null ? null : check.str(raw.cue, `${path}.cue`, 32);
    // The component's own timed changes (typing, a line arriving, an unlock, a scan, a snap: any
    // prop named at or ending in At) are changes on screen too, so the holds gate sees them.
    for (const t of propTimes(props).filter((v) => v > at && v <= b.duration).slice(0, 24)) b.events.push({id: `${b.id}-state-${count}-${b.events.length}`, name: 'state', time: rt(b.start + t), role: 'emphasis'});
    // A moving entrance (a focus pull included) and each flash are changes on screen; a cut is not.
    if (!parent && enter !== 'cut') b.events.push({id: `${b.id}-el-${count}`, name: 'enter', time: rt(b.start + at), role: enter === 'slam' ? 'emphasis' : 'enter', ...(cue ? {cue} : {})});
    if (flashAt) flashAt.forEach((t, k) => b.events.push({id: `${b.id}-flash-${count}-${k}`, name: 'flash', time: rt(b.start + t), endTime: rt(b.start + t + 0.35), role: 'emphasis'}));
    const node = {kind, rect, at, enter, props, beats,
      ...(id ? {id} : {}), ...(out !== undefined ? {out} : {}), ...(exit !== 'lift' ? {exit} : {}), ...(tilt ? {tilt} : {}),
      ...(depth ? {depth} : {}), ...(flashAt ? {flashAt} : {}), ...(flashTone ? {flashTone} : {}),
      ...(raw.z !== undefined ? {z: check.int(raw.z, `${path}.z`, 0, 50)} : {}),
      ...(raw.enterDuration !== undefined ? {enterDuration: check.num(raw.enterDuration, `${path}.enterDuration`, 0.1, 1.5)} : {}),
      ...(raw.dist !== undefined ? {dist: check.num(raw.dist, `${path}.dist`, 0, 2000)} : {}),
      ...(raw.overshoot !== undefined ? {overshoot: check.num(raw.overshoot, `${path}.overshoot`, 0, 3)} : {})};
    if (raw.children !== undefined) {
      if (!Array.isArray(raw.children)) check.fail(`${path}.children`, 'must be an array of elements');
      node.children = raw.children.map((child, k) => element(child, `${path}.children[${k}]`, node));
    }
    return node;
  };

  if (!Array.isArray(p.elements) || !p.elements.length) check.fail('params.elements', 'must be a non-empty array of elements');
  const elements = p.elements.map((raw, k) => element(raw, `params.elements[${k}]`, null));
  // A scene that opens the video should show something at frame 0: enter: "cut" at 0.
  if (firstAt > 0.6) check.fail('params.elements', `leave the scene empty until ${r2(firstAt)} s; put something on screen by 0.6 s`);

  const spec = {start: b.start, width: W, height: H, unit: r2(unit), theme: uiTheme(b.colors, alert), fonts: {display: b.fonts.display, body: b.fonts.body, mono: b.fonts.meta}, elements, ...(stageView ? {stage: stageView} : {})};
  const content = {ui: {[`${b.id}-ui`]: spec}, elementCount: count, captionBand: band};
  const model = b.finish(content);
  // The layout checks see each element: text as text at the box it sets in,
  // panels as media at their (tilted) footprint, which may run under the
  // captions, both where depth and the stage show them. The largest text box
  // is the module's rect (the hero), else the largest panel. Blooms are light
  // and do not count. No hold drift: settled elements hold still (the
  // stage's dolly is the camera).
  const scale = (r) => ({x: r2(r.x * unit), y: r2(r.y * unit), width: r2(r.width * unit), height: r2(r.height * unit)});
  // Bleed panels count too (they fill the frame); bleed text is decoration.
  const parts = elements.map((element, k) => ({k, text: TEXT_KINDS.has(element.kind), at: element.at, out: element.out,
    rect: shown(TEXT_KINDS.has(element.kind) ? uiTextBox(element.kind, element.props, element.rect, element.beats) : uiTiltBox(element.rect, element.tilt), element.depth), bloom: element.kind === 'bloom'}))
    .filter(({k, text, bloom}) => !bloom && !(text && p.elements[k].bleed));
  model.layout.drift = false;
  if (parts.length) {
    const area = (r) => r.width * r.height;
    const pool = parts.some((part) => part.text) ? parts.filter((part) => part.text) : parts;
    const hero = pool.reduce((best, part) => (area(part.rect) > area(best.rect) ? part : best));
    const others = parts.filter((part) => part !== hero);
    model.layout.rect = scale(hero.rect);
    if (!hero.text) model.layout.role = 'media';
    // The director composes the scene: chips sit on panels and panels stack,
    // so its elements may overlap each other (never another scene's).
    model.layout.allowOcclusion = others.map((part) => `${b.id}-el-${part.k}`);
    model.layout.parts = others.map((part) => ({
      id: `el-${part.k}`, rect: scale(part.rect), role: part.text ? 'text' : 'media', start: rt(b.start + part.at), end: part.out === undefined ? b.end : rt(b.start + part.out + 0.3),
      over: ['self', ...others.filter((other) => other !== part).map((other) => `el-${other.k}`)]
    }));
  }
  return model;
}

/**
 * params.stage: {tilt (deg, the whole scene turned top-away about rotateX, a
 * camera looking down), dolly {x, y (design px the front layer travels over
 * the scene), scale (the front layer's zoom by the scene's end)}}. The spec
 * carries the scene's duration, which the dolly runs over.
 */
function stageOf(check, stage, duration) {
  check.obj(stage, 'params.stage', ['tilt', 'dolly'], []);
  const out = {tilt: stage.tilt === undefined ? 0 : check.num(stage.tilt, 'params.stage.tilt', -20, 20)};
  if (stage.dolly !== undefined) {
    check.obj(stage.dolly, 'params.stage.dolly', ['x', 'y', 'scale'], []);
    out.dolly = {x: stage.dolly.x === undefined ? 0 : check.num(stage.dolly.x, 'params.stage.dolly.x', -400, 400),
      y: stage.dolly.y === undefined ? 0 : check.num(stage.dolly.y, 'params.stage.dolly.y', -400, 400),
      scale: stage.dolly.scale === undefined ? 1 : check.num(stage.dolly.scale, 'params.stage.dolly.scale', 0.8, 1.3)};
  }
  out.duration = r2(duration);
  return out;
}

/** Every time (seconds from the scene start) among a component's props: keys named at or ending in At, at any depth. */
function propTimes(value, key = '') {
  if (typeof value === 'number') return /^(at|[a-z][a-z0-9]*At)$/.test(key) && Number.isFinite(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => propTimes(item, key));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => propTimes(v, k));
  return [];
}

function tiltOf(check, tilt, path) {
  check.obj(tilt, path, ['x', 'y', 'z'], []);
  const out = {};
  for (const axis of ['x', 'y', 'z']) if (tilt[axis] !== undefined) out[axis] = check.num(tilt[axis], `${path}.${axis}`, -60, 60);
  return out;
}

const LINE_KEYS = ['text', 'size', 'accent', 'weight', 'tone', 'count', 'enter', 'at'];
const LINE_SIZES = ['s', 'm', 'l', 'xl'];
const MAX_LINES = 4;

/**
 * A headline's text must be a short string that sets inside its rect at its
 * size; rich lines (props.lines) each fit its width and together its height.
 */
function headlineFits(check, props, rect, path, {at, time}) {
  const rich = props.lines !== undefined && props.lines !== null;
  if (!rich) {
    const text = check.str(props.text, `${path}.text`, 40);
    const size = props.size === undefined ? 112 : check.num(props.size, `${path}.size`, 28, 320);
    const width = text.length * size * HEADLINE_ADVANCE;
    if (width > rect.width * 1.04) check.fail(`${path}.text`, `"${text}" at ${size} px sets about ${Math.round(width)} px wide, wider than its rect (${Math.round(rect.width)} px); shorten it, lower size or widen the rect`);
    return;
  }
  if (props.text !== undefined && props.text !== null && props.lines !== undefined && path.endsWith('.props')) check.fail(`${path}`, 'sets text or lines, not both');
  if (!Array.isArray(props.lines) || !props.lines.length || props.lines.length > MAX_LINES) check.fail(`${path}.lines`, `must be a list of 1–${MAX_LINES} lines [{text, size (${LINE_SIZES.join(', ')} or px), accent, weight, tone, count, enter, at}]`);
  if (props.stagger !== undefined) check.num(props.stagger, `${path}.stagger`, 0, 1);
  props.lines.forEach((line, k) => {
    const lp = `${path}.lines[${k}]`;
    check.obj(line, lp, LINE_KEYS, ['text']);
    const text = check.str(line.text, `${lp}.text`, 44);
    const marks = (text.match(/\*/g) ?? []).length;
    if (marks % 2) check.fail(`${lp}.text`, `"${text}" opens an accent with * it does not close (*word* sets a word in the accent)`);
    if (uiHeadlinePlain(text).length > 40) check.fail(`${lp}.text`, 'must be at most 40 characters');
    if (line.size !== undefined && !(typeof line.size === 'number' ? (check.num(line.size, `${lp}.size`, 28, 320), true) : LINE_SIZES.includes(line.size))) check.fail(`${lp}.size`, `must be one of ${LINE_SIZES.join(', ')} or px (28–320)`);
    if (line.accent !== undefined) check.bool(line.accent, `${lp}.accent`);
    if (line.weight !== undefined) check.int(line.weight, `${lp}.weight`, 300, 900);
    if (line.tone !== undefined) check.str(line.tone, `${lp}.tone`, 16);
    if (line.enter !== undefined) check.oneOf(line.enter, `${lp}.enter`, ENTERS);
    if (line.at !== undefined && time(line.at, `${lp}.at`) + 1e-9 < at) check.fail(`${lp}.at`, `is before its headline enters (${at} s)`);
    if (line.count !== undefined) {
      if (typeof line.count === 'object' && line.count !== null) {
        check.obj(line.count, `${lp}.count`, ['from', 'dur'], []);
        if (line.count.from !== undefined) check.num(line.count.from, `${lp}.count.from`, -1e12, 1e12);
        if (line.count.dur !== undefined) check.num(line.count.dur, `${lp}.count.dur`, 0.2, 3);
      } else check.bool(line.count, `${lp}.count`);
      if (line.count && !/\d/.test(text)) check.fail(`${lp}.count`, `counts up the number in its text, and "${text}" has none`);
    }
  });
  const m = headlineMeasure(props);
  m.lines.forEach((line, k) => {
    if (line.width > rect.width * 1.04) check.fail(`${path}.lines[${k}].text`, `"${uiHeadlinePlain(props.lines[k].text)}" at size ${props.lines[k].size ?? 'l'} sets about ${Math.round(line.width)} px wide, wider than its rect (${Math.round(rect.width)} px); shorten it, pick a smaller size or widen the rect`);
  });
  if (m.height > rect.height * 1.04) check.fail(`${path}.lines`, `stack about ${Math.round(m.height)} px tall, taller than their rect (${Math.round(rect.height)} px); raise the rect's height, drop a line or pick smaller sizes`);
}

/** The host every element is painted into: the whole canvas, under the module rect's origin. */
function uiView(model) {
  const {rect, canvas} = model;
  return [el('div', `${model.id}-ui`, abs(-rect.x, -rect.y, canvas.width, canvas.height, {overflow: 'visible'}))];
}

/**
 * No root entrance: every element enters on its own. The scene keeps the
 * root's exit (the cut or transition takes it out).
 */
function uiTimeline(model, ops) {
  const root = model.id;
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    if (op.target !== root) continue;
    if ((op.type === 'set' && op.time === model.start) || (op.type === 'tween' && op.start === model.motion.enterStart)) ops.splice(i, 1);
  }
  ops.push({type: 'set', target: root, time: model.start, props: {opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1}});
}

/**
 * The words a viewer has to read in a ui-scene: its headlines (each at its
 * longest state). Panel labels, chips and clip names are glanced at, like a
 * real interface, so the text-hold gate does not count them.
 */
export function uiReadingWords(params) {
  let words = 0;
  const count = (text) => (typeof text === 'string' ? text.split(/\s+/).filter(Boolean).length : 0);
  const walk = (elements) => {
    for (const element of Array.isArray(elements) ? elements : []) {
      if (!element || typeof element !== 'object') continue;
      if (element.kind === 'headline') {
        // A state's words: its text, or its rich lines read together (markup out).
        const read = (state) => (Array.isArray(state?.lines) ? state.lines.map((line) => uiHeadlinePlain(line?.text ?? '')).join(' ') : state?.text);
        const states = [element.props, element.props?.swap, ...(element.beats ?? []).map((beat) => beat?.set)];
        words += Math.max(0, ...states.map((state) => count(read(state))));
      }
      walk(element.children);
    }
  };
  walk(params?.elements);
  return words;
}

export const uiScene = {
  id: 'ui-scene',
  describe: 'An animated interface scene built from tuned UI components (editor timeline, loudness meter, locked tool cards, terminal, search results, card wall, downloads list, comment box, frame ruler, pad grid, scan plane, headlines and chips), each placed with a rect, an entrance time and timed beats, and painted frame by frame. For a reel that explains a tool or a workflow on screen.',
  params: {elements: `[{kind (${UI_KINDS.join(', ')}), rect {x, y, width, height} design px inside the safe zone, at (s), enter (${ENTERS.join(', ')}; headline default focus), out (s, optional), exit (${EXITS.join(', ')}; rack after focus), props {...the component's props}, beats [{at, set {...props}, cue}] (optional), children (window and stack), tilt {x, y, z} deg (optional), z, depth 0–1 (top level; 0 front), flashAt (s or a list), flashTone (white, accent), bleed, cue}] (at most ${MAX_ELEMENTS} in all)`,
    alert: 'the "before" / broken-state colour, #rrggbb (default #ff4b3e)',
    stage: '{tilt deg (look-down, e.g. 8), dolly {x, y design px, scale} (a slow camera move over the scene; far layers move less)} (optional)'},
  events: ['enter', 'beat'],
  timing: {...timingRules({rules: ['the first element enters by 0.6 s; a scene that opens on a whip-pan or opens the video enters its hero panel with enter "cut" at 0, so it is built when the move lands', 'every time is seconds from the scene start, inside the scene', 'a child enters no earlier than its parent']}), leadIn: 0},
  variants: ['default'],
  resolve: uiResolve, view: uiView, timeline: uiTimeline
};

export const UI_MODULES = [uiScene];

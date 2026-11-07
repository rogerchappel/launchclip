// Catalogue I: ui-scene, an animated interface scene. The director lays out
// tuned UI components (an editor timeline, a loudness meter, locked tool
// cards, a terminal, search results, a card wall, a downloads list, a comment
// box...) as elements with rects, entrance times and timed beats; the painter
// (kit/core/ui-runtime.mjs) draws them as DOM, a pure function of time, in both
// renderers. Registered in kit/core/catalog-h.mjs, so catalogue H's emitters
// carry it; they paint every host in model.content.ui (docs/KIT_CONTRACTS.md,
// "UI scenes").
//
// Element rects are design px (1080 wide in 9:16) on the stage: the full width
// less a 40 px margin, from the safe zone's top to its bottom, clear of the
// caption band, so nothing moves under the captions. An element marked bleed
// (a decorative waveform or card wall) may run to the canvas edge.

import {createHBase, r2, rt} from './catalog-h-base.mjs';
import {timingRules} from './catalog-b-base.mjs';
import {mixColor} from './catalog-b-base.mjs';
import {abs, el} from './catalog-h-view.mjs';
import {UI_KINDS} from './ui-runtime.mjs';
import {profileGeometry} from './layout-check.mjs';

const ENTERS = Object.freeze(['up', 'down', 'left', 'right', 'zoom', 'slam', 'pop', 'drop', 'fade']);
const ELEMENT_KEYS = ['id', 'kind', 'rect', 'at', 'enter', 'enterDuration', 'dist', 'overshoot', 'out', 'props', 'beats', 'children', 'tilt', 'z', 'bleed', 'cue'];
const MAX_ELEMENTS = 120;
// Text props checked for length and escaped by the painter; headline text must fit its rect.
const HEADLINE_ADVANCE = 0.6;
// The sound an entrance asks for when the element names none.
const ENTER_CUES = Object.freeze({slam: 'hit-soft', pop: 'pop-soft', zoom: 'whoosh-soft', drop: 'hit-soft'});

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
  const b = createHBase('ui-scene', params, ctx, {allowed: ['elements', 'alert'], required: ['elements']});
  const {check, unit} = b;
  const p = b.params;
  const W = r2(b.canvas.width / unit), H = r2(b.canvas.height / unit);
  // The stage: the full width less a 40 px margin, from just above the safe
  // zone's top to its bottom; elements stay out of the caption band.
  const geometry = profileGeometry(b.canvas, b.portrait ? 'shorts' : 'landscape');
  const zone = geometry.safeZone, cap = geometry.captionBand;
  const margin = 40;
  const stage = {x: margin, y: r2(zone.y / unit - margin), width: r2(W - 2 * margin), height: r2((zone.y + zone.height) / unit - zone.y / unit + margin)};
  const band = {x: r2(cap.x / unit), y: r2(cap.y / unit), width: r2(cap.width / unit), height: r2(cap.height / unit)};
  const alert = p.alert === undefined ? '#ff4b3e' : b.resolveColor(p.alert, 'params.alert', '#ff4b3e');
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
    if (!parent && !bleed) {
      const eps = 0.5, r = rect;
      const outside = r.x < stage.x - eps || r.y < stage.y - eps || r.x + r.width > stage.x + stage.width + eps || r.y + r.height > stage.y + stage.height + eps;
      const inBand = r.y < band.y + band.height && r.y + r.height > band.y && r.x < band.x + band.width && r.x + r.width > band.x;
      if (outside || inBand) check.fail(`${path}.rect`, `must sit on the stage, {x: ${stage.x}, y: ${stage.y}, width: ${stage.width}, height: ${stage.height}} (design px), clear of the caption band (y ${band.y}–${r2(band.y + band.height)}); mark a decorative element bleed: true to let it run to the edge`);
    }
    const at = time(raw.at, `${path}.at`);
    if (parent && at + 1e-9 < parent.at) check.fail(`${path}.at`, `is before its parent enters (${parent.at} s)`);
    firstAt = Math.min(firstAt, at);
    const out = raw.out === undefined ? undefined : time(raw.out, `${path}.out`);
    if (out !== undefined && out <= at) check.fail(`${path}.out`, 'must be after at');
    const enter = raw.enter === undefined ? 'up' : check.oneOf(raw.enter, `${path}.enter`, ENTERS);
    let id = undefined;
    if (raw.id !== undefined) {
      id = check.str(raw.id, `${path}.id`, 40);
      if (ids.has(id)) check.fail(`${path}.id`, `repeats "${id}"`);
      ids.add(id);
    }
    const props = raw.props === undefined ? {} : raw.props;
    check.obj(props, `${path}.props`, Object.keys(props));
    if (kind === 'headline') headlineFits(check, props, rect, `${path}.props`);
    const beats = (raw.beats ?? []).map((beat, k) => {
      check.obj(beat, `${path}.beats[${k}]`, ['at', 'set', 'cue'], ['at', 'set']);
      check.obj(beat.set, `${path}.beats[${k}].set`, Object.keys(beat.set));
      if (kind === 'headline' && beat.set.text !== undefined) headlineFits(check, {...props, ...beat.set}, rect, `${path}.beats[${k}].set`);
      const beatAt = time(beat.at, `${path}.beats[${k}].at`);
      const cue = beat.cue === undefined ? null : check.str(beat.cue, `${path}.beats[${k}].cue`, 32);
      if (cue) b.events.push({id: `${b.id}-beat-${count}-${k}`, name: 'beat', time: rt(b.start + beatAt), role: 'emphasis', cue});
      return {at: beatAt, set: beat.set};
    }).sort((x, y) => x.at - y.at);
    const tilt = raw.tilt === undefined ? undefined : tiltOf(check, raw.tilt, `${path}.tilt`);
    const cue = raw.cue === undefined ? ENTER_CUES[enter] ?? null : raw.cue === null ? null : check.str(raw.cue, `${path}.cue`, 32);
    if (cue && !parent) b.events.push({id: `${b.id}-el-${count}`, name: 'enter', time: rt(b.start + at), role: enter === 'slam' ? 'emphasis' : 'enter', cue});
    const node = {kind, rect, at, enter, props, beats,
      ...(id ? {id} : {}), ...(out !== undefined ? {out} : {}), ...(tilt ? {tilt} : {}),
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
  if (firstAt > 0.6) check.fail('params.elements', `leave the scene empty until ${r2(firstAt)} s; put something on screen by 0.6 s`);

  const spec = {start: b.start, width: W, height: H, unit: r2(unit), theme: uiTheme(b.colors, alert), fonts: {display: b.fonts.display, body: b.fonts.body, mono: b.fonts.meta}, elements};
  const content = {ui: {[`${b.id}-ui`]: spec}, elementCount: count};
  return b.finish(content);
}

function tiltOf(check, tilt, path) {
  check.obj(tilt, path, ['x', 'y', 'z'], []);
  const out = {};
  for (const axis of ['x', 'y', 'z']) if (tilt[axis] !== undefined) out[axis] = check.num(tilt[axis], `${path}.${axis}`, -60, 60);
  return out;
}

/** A headline's text must be a short string that sets inside its rect at its size. */
function headlineFits(check, props, rect, path) {
  const text = check.str(props.text, `${path}.text`, 40);
  const size = props.size === undefined ? 112 : check.num(props.size, `${path}.size`, 28, 320);
  const width = text.length * size * HEADLINE_ADVANCE;
  if (width > rect.width * 1.04) check.fail(`${path}.text`, `"${text}" at ${size} px sets about ${Math.round(width)} px wide, wider than its rect (${Math.round(rect.width)} px); shorten it, lower size or widen the rect`);
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

export const uiScene = {
  id: 'ui-scene',
  describe: 'An animated interface scene built from tuned UI components (editor timeline, loudness meter, locked tool cards, terminal, search results, card wall, downloads list, comment box, frame ruler, pad grid, scan plane, headlines and chips), each placed with a rect, an entrance time and timed beats, and painted frame by frame. For a reel that explains a tool or a workflow on screen.',
  params: {elements: `[{kind (${UI_KINDS.join(', ')}), rect {x, y, width, height} design px inside the safe zone, at (s), enter (${ENTERS.join(', ')}), out (s, optional), props {...the component's props}, beats [{at, set {...props}, cue}] (optional), children (window and stack), tilt {x, y, z} deg (optional), z, bleed, cue}] (at most ${MAX_ELEMENTS} in all)`,
    alert: 'the "before" / broken-state colour, #rrggbb (default #ff4b3e)'},
  events: ['enter', 'beat'],
  timing: timingRules({rules: ['the first element enters by 0.6 s', 'every time is seconds from the scene start, inside the scene', 'a child enters no earlier than its parent']}),
  variants: ['default'],
  resolve: uiResolve, view: uiView, timeline: uiTimeline
};

export const UI_MODULES = [uiScene];

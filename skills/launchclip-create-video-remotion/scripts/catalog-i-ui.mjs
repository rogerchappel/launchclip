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
import {uiDepthAt, uiStageProject} from './ui-paint.mjs';
import {captionBandAt, profileGeometry} from './layout-check.mjs';

const ENTERS = Object.freeze(['up', 'down', 'left', 'right', 'zoom', 'slam', 'pop', 'drop', 'fade', 'focus', 'cut']);
const EXITS = Object.freeze(['lift', 'rack']);
const ELEMENT_KEYS = ['id', 'kind', 'rect', 'at', 'enter', 'enterDuration', 'dist', 'overshoot', 'out', 'exit', 'props', 'beats', 'children', 'tilt', 'z', 'depth', 'flashAt', 'flashTone', 'bleed', 'cue'];
// The entrance an element makes when it names none: a headline racks into
// focus, a bloom and a burst are their own swell, everything else rises.
const DEFAULT_ENTER = Object.freeze({headline: 'focus', bloom: 'cut', burst: 'cut'});
// Light kinds: drawn over the scene, never content (no layout part, not the
// scene's first thing on screen, free to run off the stage).
const LIGHT_KINDS = new Set(['bloom', 'burst']);
// A burst centred on a target without a rect of its own reaches this far (design px square).
const BURST_SIZE = 920;
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
const MIN_SIZE = Object.freeze({bloom: {width: 200, height: 200}, burst: {width: 200, height: 200}, meter: {width: 560, height: 320}, timeline: {width: 600, height: 340}, terminal: {width: 560, height: 320}, results: {width: 560, height: 420}, downloads: {width: 560, height: 300}, 'frame-ruler': {width: 800, height: 440}, 'marker-snap': {width: 560, height: 240}});
const LOCK_CARD_MIN = 110;

/** The box a headline or chip's text sets in (design px): its width and line height at its size, placed by its align. */
export function uiTextBox(kind, props, rect, beats = []) {
  const states = [props, ...(props.swap ? [{...props, ...props.swap}] : []), ...beats.map((beat) => ({...props, ...beat.set}))];
  let width = 0, height = 0;
  for (const state of states) {
    const text = String(state.text ?? '');
    const size = Number(state.size) || (kind === 'headline' ? 112 : 30);
    width = Math.max(width, kind === 'headline' ? text.length * size * HEADLINE_ADVANCE : text.length * size * 0.62 + size * 1.2);
    height = Math.max(height, kind === 'headline' ? size * 1.05 : size * 1.45);
  }
  width = Math.min(rect.width, width);
  height = Math.min(rect.height, height);
  const align = props.align ?? 'center';
  const x = align === 'left' ? rect.x : align === 'right' ? rect.x + rect.width - width : rect.x + (rect.width - width) / 2;
  return {x: r2(x), y: r2(rect.y + (rect.height - height) / 2), width: r2(width), height: r2(height)};
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
    // A burst aimed at another element (props.target) may leave its rect out.
    const aimed = raw?.kind === 'burst' && raw?.props?.target !== undefined;
    check.obj(raw, path, ELEMENT_KEYS, aimed ? ['kind', 'at'] : ['kind', 'rect', 'at']);
    if (++count > MAX_ELEMENTS) check.fail(path, `is one element too many: a ui-scene draws at most ${MAX_ELEMENTS}`);
    const kind = check.oneOf(raw.kind, `${path}.kind`, UI_KINDS);
    const rawRect = raw.rect ?? {x: 0, y: 0, width: BURST_SIZE, height: BURST_SIZE};
    check.obj(rawRect, `${path}.rect`, ['x', 'y', 'width', 'height'], ['x', 'y', 'width', 'height']);
    const rect = {x: check.num(rawRect.x, `${path}.rect.x`, -W, 2 * W), y: check.num(rawRect.y, `${path}.rect.y`, -H, 2 * H),
      width: check.num(rawRect.width, `${path}.rect.width`, 4, 2 * W), height: check.num(rawRect.height, `${path}.rect.height`, 4, 2 * H)};
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
    // Light (a bloom, a burst) fades to nothing at its edges: it may run off the stage.
    if (!parent && !bleed && !TEXT_KINDS.has(kind) && !LIGHT_KINDS.has(kind)) {
      const r = footprint, eps = 0.5;
      if (r.x < stage.x - eps || r.y < stage.y - eps || r.x + r.width > stage.x + stage.width + eps || r.y + r.height > stage.y + stage.height + eps) {
        check.fail(`${path}.rect`, `${tilt || depth || stageView ? `${tilt ? 'turned by its tilt' : 'placed by its depth and the stage'}, it covers {x: ${r.x}, y: ${r.y}, width: ${r.width}, height: ${r.height}}, which ` : ''}must sit on the stage, {x: ${stage.x}, y: ${stage.y}, width: ${stage.width}, height: ${stage.height}} (design px); mark a decorative element bleed: true to let it run to the edge`);
      }
    }
    const at = time(raw.at, `${path}.at`);
    if (parent && at + 1e-9 < parent.at) check.fail(`${path}.at`, `is before its parent enters (${parent.at} s)`);
    // A bloom or a burst is light, not something on screen.
    if (!LIGHT_KINDS.has(kind)) firstAt = Math.min(firstAt, at);
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
    if (kind === 'headline') headlineFits(check, props, rect, `${path}.props`);
    if (kind === 'burst') burstProps(check, props, `${path}.props`);
    const beats = (raw.beats ?? []).map((beat, k) => {
      check.obj(beat, `${path}.beats[${k}]`, ['at', 'set', 'cue'], ['at', 'set']);
      check.obj(beat.set, `${path}.beats[${k}].set`, Object.keys(beat.set));
      if (kind === 'headline' && beat.set.text !== undefined) headlineFits(check, {...props, ...beat.set}, rect, `${path}.beats[${k}].set`);
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
    // A burst is the hero beat: an emphasis on screen (with its cue, if it names one).
    if (kind === 'burst') b.events.push({id: `${b.id}-burst-${count}`, name: 'burst', time: rt(b.start + at), endTime: rt(b.start + at + (props.duration ?? 0.6)), role: 'emphasis', ...(cue ? {cue} : {})});
    const node = {kind, rect, at, enter, props, beats,
      ...(id ? {id} : {}), ...(out !== undefined ? {out} : {}), ...(exit !== 'lift' ? {exit} : {}), ...(tilt ? {tilt} : {}),
      ...(depth ? {depth} : {}), ...(flashAt ? {flashAt} : {}), ...(flashTone ? {flashTone} : {}),
      ...(raw.z !== undefined ? {z: check.int(raw.z, `${path}.z`, 0, 50)} : {}),
      ...(raw.enterDuration !== undefined ? {enterDuration: check.num(raw.enterDuration, `${path}.enterDuration`, 0.1, 1.5)} : {}),
      ...(raw.dist !== undefined ? {dist: check.num(raw.dist, `${path}.dist`, 0, 2000)} : {}),
      ...(raw.overshoot !== undefined ? {overshoot: check.num(raw.overshoot, `${path}.overshoot`, 0, 3)} : {})};
    if (kind === 'burst' && props.target !== undefined) {
      if (parent) check.fail(`${path}.props.target`, 'aims a top-level burst; a child burst sits in its parent, so give it a rect instead');
      aims.push({node, sized: raw.rect !== undefined, path: `${path}.props.target`});
    }
    if (raw.children !== undefined) {
      if (!Array.isArray(raw.children)) check.fail(`${path}.children`, 'must be an array of elements');
      node.children = raw.children.map((child, k) => element(child, `${path}.children[${k}]`, node));
    }
    return node;
  };

  if (!Array.isArray(p.elements) || !p.elements.length) check.fail('params.elements', 'must be a non-empty array of elements');
  const aims = [];
  const elements = p.elements.map((raw, k) => element(raw, `params.elements[${k}]`, null));
  // A burst aimed at an element centres its rect on that element's centre
  // (where its text sets, for a headline or chip; children by their parent's offset).
  if (aims.length) {
    const centres = new Map();
    const walk = (list, ox, oy) => {
      for (const node of list) {
        const r = TEXT_KINDS.has(node.kind) ? uiTextBox(node.kind, node.props, node.rect, node.beats) : node.rect;
        if (node.id) centres.set(node.id, {x: ox + r.x + r.width / 2, y: oy + r.y + r.height / 2});
        if (node.children) walk(node.children, ox + node.rect.x, oy + node.rect.y);
      }
    };
    walk(elements, 0, 0);
    for (const {node, sized, path} of aims) {
      const centre = centres.get(node.props.target);
      if (!centre || node.props.target === node.id) check.fail(path, `names "${node.props.target}", which is not the id of another element in this scene`);
      const width = sized ? node.rect.width : BURST_SIZE, height = sized ? node.rect.height : BURST_SIZE;
      node.rect = {x: r2(centre.x - width / 2), y: r2(centre.y - height / 2), width, height};
    }
  }
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
    rect: shown(TEXT_KINDS.has(element.kind) ? uiTextBox(element.kind, element.props, element.rect, element.beats) : uiTiltBox(element.rect, element.tilt), element.depth), light: LIGHT_KINDS.has(element.kind)}))
    .filter(({k, text, light}) => !light && !(text && p.elements[k].bleed));
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

/** A burst's props: its ray count, length, strength, tone and target. */
function burstProps(check, props, path) {
  if (props.rays !== undefined) check.int(props.rays, `${path}.rays`, 6, 24);
  if (props.duration !== undefined) check.num(props.duration, `${path}.duration`, 0.3, 1.2);
  if (props.strength !== undefined) check.num(props.strength, `${path}.strength`, 0, 1.5);
  if (props.tone !== undefined) check.str(props.tone, `${path}.tone`, 16);
  if (props.target !== undefined) check.str(props.target, `${path}.target`, 40);
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
        const states = [element.props?.text, element.props?.swap?.text, ...(element.beats ?? []).map((beat) => beat?.set?.text)];
        words += Math.max(0, ...states.map(count));
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

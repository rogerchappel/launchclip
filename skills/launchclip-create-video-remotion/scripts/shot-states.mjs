// Multi-state shots and the focus device: one module instance advances through
// 2–6 states timed to the narration, instead of cutting to a new scene for
// every line. Shared by every op-list module (catalogues B, G and H), so both
// renderers draw the same states: the extra nodes join the shared view tree
// and the state changes are ordinary ops (kit/core/catalog-b-view.mjs), which
// GSAP tweens on one side and frameState() evaluates on the other.
// Contract: docs/KIT_CONTRACTS.md, "Shot states and the focus device".
//
//   scene.states = [{at: "word:half#1" | seconds, set: {
//     params: {data: [...]},     state-animatable params (the module declares them)
//     reveal: [2] | ["row-3"],   items held back until this state
//     focus: 1 | "cell-1-2" | [0, 2] | null,   the ring travels here; the rest dims
//     dim: false | 0.3,          sibling opacity while focused (default 0.3)
//     glow: 1 | "bar-2",         a soft bloom behind a target
//     guide: {value, label?} | {target, edge, label?},   a dashed guide line
//     note: {text, target, side?},   a small chip beside a target
//     clear: true                 drop the earlier glows, guides and notes
//   }}]
//
// `at` is absolute story time once resolved (like hits). The scene's own
// params are state 0; each state's params merge over the previous state's.
//
// How a state moves (all frame-pure; every value is a function of time):
// - params: the module is resolved again with the merged params, and each
//   element of the base view tweens to where that model puts it, settled: a
//   box maps its rect (about its transform origin) with x/y/scale, text moves
//   and counts to the new value, and opacity / clip / dash follow the settled
//   ops. Colours and SVG paths do not morph. Arrays keep their length: list
//   every item in params and hold the later ones back with reveal.
// - reveal: the item's own entrance ops are shifted to start at the state.
// - focus: a rounded ring in the story's focus colour (brand accent, else
//   primary) travels from the previous target (FLIP: it starts at the old
//   rect and settles exactly on the new one) while the other items drop to
//   ~30 % opacity; a later state's focus moves it on, focus: null hides it.
// - glow, guide and note persist until a state sets clear.
//
// Plain ESM; imports only catalog-b-view.mjs and catalog-b-base.mjs.

import {abs, el, frameState, text as textNode} from './catalog-b-view.mjs';
import {contrastRatio, textWidth} from './catalog-b-base.mjs';

export const SHOT_STATE_KEYS = Object.freeze(['params', 'reveal', 'focus', 'dim', 'glow', 'guide', 'note', 'clear']);
/** States after the scene's own (state 0): a shot runs 2–6 states. */
export const MAX_SHOT_STATES = 5;
/** Minimum seconds between two states (and after the module's entrance). */
export const STATE_GAP = 0.6;
/** Seconds a param change, a reveal's fade and the ring's travel take. */
export const STATE_MOVE = 0.6;
export const FOCUS_DIM = 0.3;
/**
 * The bloom that marks a state: a soft fill in the focus colour behind the
 * state's target that lands in about two frames and decays (STATE_BLOOM.peak
 * opacity, gone after STATE_BLOOM.decay s), so the change reads as an event
 * and not as a slow drift. One pulse per state, never repeated.
 */
export const STATE_BLOOM = Object.freeze({peak: 0.6, rise: 0.07, decay: 0.85, pad: 28, blur: 34});
// The ease every state move uses: most of the change lands in the first frames.
const ONSET = 'expo.out';
const EPS = 1e-6;
const r2 = value => Math.round(value * 100) / 100;
const rt = value => Math.round(value * 1e6) / 1e6;
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// ---------------------------------------------------------------------------
// Which modules run states, and what they declare

function barGuide(model, value, params) {
  const c = model.content;
  const values = (params.data ?? []).map(row => Number(row?.value));
  const peak = Math.max(...values);
  const max = params.max === undefined ? peak : Number(params.max);
  if (!(max > 0) || !c.bars?.length) return null;
  if (c.layout === 'vertical') {
    const plot = c.plot;
    const y = r2(plot.y + plot.height * (1 - value / max));
    return {axis: 'y', at: y, from: 0, to: model.rect.width};
  }
  const longest = c.bars.reduce((best, _, i) => (values[i] > values[best] ? i : best), 0);
  const maxLen = c.bars[longest].width * max / values[longest];
  const top = c.bars[0].y, bottom = c.bars.at(-1).y + c.bars.at(-1).height;
  return {axis: 'x', at: r2(c.bars[0].x + maxLen * value / max), from: r2(top - 12 * model.unit), to: r2(bottom + 12 * model.unit)};
}

/**
 * The state-animatable modules: {params: [names a state may set], items:
 * [id parts that make one indexed item], guide?(model, value, params) →
 * {axis, at, from, to}}. A module definition may declare its own `states`
 * the same way; that wins over this table.
 */
export const STATE_MODULES = Object.freeze({
  'bar-chart': {params: ['data', 'max', 'highlight', 'format'], items: ['bar', 'label', 'value', 'dot'], guide: barGuide},
  'scatter-plot': {params: ['points', 'series', 'highlight', 'focus'], items: ['dot']},
  'comparison-table': {params: ['rows', 'highlight'], items: ['row']},
  leaderboard: {params: ['entries', 'highlight'], items: ['row']},
  'unit-grid': {params: ['highlight'], items: ['u']},
  'process-steps': {params: ['steps'], items: ['halo', 'node', 'text']},
  excerpt: {params: ['lines'], items: ['line']}
});

/** A module's state declaration (its definition's `states`, else STATE_MODULES), or null. */
export function stateSpec(moduleId, definition = null) {
  return (definition && isObject(definition.states) ? definition.states : null) ?? STATE_MODULES[moduleId] ?? null;
}

// ---------------------------------------------------------------------------
// Validation (structure only; story.mjs calls this, modules.mjs checks the module side)

/** Structural errors in scene.states, as messages prefixed by `path`. */
export function shotStateErrors(states, path = 'states', {isAnchor = () => true} = {}) {
  const errors = [];
  if (!Array.isArray(states)) return [`${path} must be an array`];
  if (states.length < 1 || states.length > MAX_SHOT_STATES) errors.push(`${path} must hold 1–${MAX_SHOT_STATES} states (the scene itself is state 0)`);
  states.forEach((state, i) => {
    const at = `${path}[${i}]`;
    if (!isObject(state)) { errors.push(`${at} must be an object`); return; }
    for (const key of Object.keys(state)) if (key !== 'at' && key !== 'set') errors.push(`${at}.${key} is not supported (use at and set)`);
    if (state.at === undefined) errors.push(`${at}.at is required`);
    else if (!isAnchor(state.at)) errors.push(`${at}.at must be seconds or a time anchor ("word:<text>[#n]")`);
    if (!isObject(state.set)) { errors.push(`${at}.set must be an object`); return; }
    const set = state.set;
    for (const key of Object.keys(set)) if (!SHOT_STATE_KEYS.includes(key)) errors.push(`${at}.set.${key} is not supported (one of ${SHOT_STATE_KEYS.join(', ')})`);
    if (!Object.keys(set).some(key => key !== 'dim')) errors.push(`${at}.set must change something`);
    if (set.params !== undefined && !isObject(set.params)) errors.push(`${at}.set.params must be an object`);
    if (set.reveal !== undefined && !(Array.isArray(set.reveal) && set.reveal.length && set.reveal.every(isTargetRef))) errors.push(`${at}.set.reveal must be a non-empty array of item indexes or element ids`);
    if (set.focus !== undefined && set.focus !== null && !isTarget(set.focus)) errors.push(`${at}.set.focus must be an item index, an element id ("cell-1-2"), an array of them, or null`);
    if (set.glow !== undefined && !isTarget(set.glow)) errors.push(`${at}.set.glow must be an item index, an element id or an array of them`);
    if (set.dim !== undefined && set.dim !== false && !(typeof set.dim === 'number' && set.dim >= 0 && set.dim <= 0.8)) errors.push(`${at}.set.dim must be false or an opacity 0–0.8`);
    if (set.clear !== undefined && set.clear !== true) errors.push(`${at}.set.clear must be true`);
    if (set.guide !== undefined) {
      const g = set.guide;
      if (!isObject(g) || (typeof g.value !== 'number' && !isTarget(g.target))) errors.push(`${at}.set.guide must be {value, label?} or {target, edge, label?}`);
      else {
        if (g.target !== undefined && !['top', 'bottom', 'left', 'right'].includes(g.edge ?? 'top')) errors.push(`${at}.set.guide.edge must be top, bottom, left or right`);
        if (g.label !== undefined && !(typeof g.label === 'string' && g.label.trim() && g.label.length <= 24)) errors.push(`${at}.set.guide.label must be a string ≤ 24`);
      }
    }
    if (set.note !== undefined) {
      const n = set.note;
      if (!isObject(n) || !(typeof n.text === 'string' && n.text.trim() && n.text.length <= 32) || !isTarget(n.target)) errors.push(`${at}.set.note must be {text ≤ 32, target, side?}`);
      else if (n.side !== undefined && !['above', 'below'].includes(n.side)) errors.push(`${at}.set.note.side must be above or below`);
    }
  });
  return errors;
}

const isTargetRef = value => (Number.isInteger(value) && value >= 0) || (typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value));
const isTarget = value => isTargetRef(value) || (Array.isArray(value) && value.length > 0 && value.every(isTargetRef));

// ---------------------------------------------------------------------------
// Resolution (modules.mjs): absolute times, merged params, one model per param change

/**
 * scene.states (anchors resolved) → model.shotStates, or throws.
 * resolveWith(params) resolves the same scene with other params (a model).
 * → {color, items, states: [{index, at, set, params, model|null, guide|null}], events}
 */
export function resolveShotStates(scene, model, {spec, resolveWith}) {
  if (!spec) throw new Error(`states: module "${model.module}" does not run states (states work on ${Object.keys(STATE_MODULES).join(', ')}, or a module that declares states)`);
  const errors = shotStateErrors(scene.states, 'states', {isAnchor: value => typeof value === 'number' && Number.isFinite(value)});
  if (errors.length) throw new Error(errors.join('; '));
  const start = model.motion?.enterEnd ?? model.start, end = model.motion?.exitStart ?? model.end;
  let params = isObject(scene.params) ? scene.params : {};
  let previous = start;
  const states = scene.states.map((state, index) => {
    const path = `states[${index}]`;
    const at = Number(state.at);
    if (at < previous + STATE_GAP - EPS) throw new Error(`${path}.at (${at}) must come at least ${STATE_GAP} s after ${index ? `states[${index - 1}]` : 'the module has entered'} (${rt(previous)})`);
    if (at > end - STATE_GAP + EPS) throw new Error(`${path}.at (${at}) must come at least ${STATE_GAP} s before the module exits (${end})`);
    previous = at;
    const set = state.set;
    let stateModel = null;
    if (set.params) {
      for (const key of Object.keys(set.params)) {
        if (!spec.params.includes(key)) throw new Error(`${path}.set.params.${key} is not state-animatable on ${model.module} (one of ${spec.params.join(', ') || 'none'})`);
        if (Array.isArray(params[key]) && !(Array.isArray(set.params[key]) && set.params[key].length === params[key].length)) {
          throw new Error(`${path}.set.params.${key} must keep ${params[key].length} entries; states change values, not how many items there are (list them all in params and hold later ones back with reveal)`);
        }
      }
      params = {...params, ...set.params};
      stateModel = resolveWith(params);
    }
    let guide = null;
    if (set.guide && typeof set.guide.value === 'number') {
      if (!spec.guide) throw new Error(`${path}.set.guide.value needs a module with a value axis (${model.module} takes {target, edge})`);
      guide = spec.guide(stateModel ?? model, set.guide.value, params);
      if (!guide) throw new Error(`${path}.set.guide.value: ${model.module} has no axis to place it on`);
    }
    return {index, at, set, params, model: stateModel, guide};
  });
  // Each state is a module event too (state-1, state-2, …), so it gets a soft cue.
  const events = states.map(state => ({id: `${model.id}-state-${state.index + 1}`, name: `state-${state.index + 1}`, time: state.at, endTime: rt(state.at + STATE_MOVE), role: 'emphasis', cue: 'hit-soft'}));
  return {color: focusColor(model.theme), items: spec.items, states, events};
}

/** The focus colour: brand.colors.focus, else the brand accent, when it reads on the background (3:1), else primary. */
export function focusColor(theme = {}) {
  const bg = theme.bg ?? theme.surface ?? '#000000';
  for (const color of [theme.focus, theme.accent, theme.primary, theme.foreground]) if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) && contrastRatio(color, bg) >= 3) return color;
  return '#46d4ff';
}

// ---------------------------------------------------------------------------
// View geometry

/**
 * Index a module's content tree: id → {id, node, parent, x, y, width, height,
 * box, text, origin, ax, ay}. x/y are the node's left/top in its parent, ax/ay
 * its position in the content box (a flowed node — no left/top — counts as 0).
 */
export function indexView(children) {
  const byId = new Map();
  const root = {id: null, node: {children}, parent: null, ax: 0, ay: 0, width: undefined, height: undefined};
  const walk = (entry) => {
    for (const child of entry.node.children ?? []) {
      if (!child || typeof child !== 'object') continue;
      const s = child.style ?? {};
      const kids = child.children ?? [];
      const isText = kids.length > 0 && kids.every(kid => typeof kid === 'string');
      const x = num(s.left) ?? num(child.attrs?.x), y = num(s.top) ?? num(child.attrs?.y);
      const width = num(s.width) ?? num(child.attrs?.width);
      let height = num(s.height) ?? num(child.attrs?.height);
      if (height === undefined && isText) height = r2((num(s.fontSize) ?? 32) * lineHeight(s.lineHeight, num(s.fontSize) ?? 32));
      const next = {id: child.id ?? null, node: child, parent: entry, x, y, width, height, flowed: x === undefined || y === undefined,
        box: !isText && width !== undefined && height !== undefined, text: isText ? kids.join('') : null, origin: origin(s.transformOrigin),
        align: s.textAlign === 'center' ? 0.5 : s.textAlign === 'right' ? 1 : 0,
        opacity: num(s.opacity), ax: entry.ax + (x ?? 0), ay: entry.ay + (y ?? 0)};
      if (child.id) byId.set(child.id, next);
      walk(next);
    }
  };
  walk(root);
  return {root, byId};
}

function num(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?(px)?$/.test(value.trim())) return Number(value.trim().replace(/px$/, ''));
  return undefined;
}

function lineHeight(value, size) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /px$/.test(value)) return Number(value.replace(/px$/, '')) / size;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 1.2;
}

function origin(value) {
  const parts = String(value ?? '50% 50%').trim().split(/\s+/);
  const pct = part => (/%$/.test(part) ? Number(part.replace('%', '')) / 100 : part === 'left' || part === 'top' ? 0 : part === 'right' || part === 'bottom' ? 1 : 0.5);
  return {x: pct(parts[0] ?? '50%'), y: pct(parts[1] ?? parts[0] ?? '50%')};
}

const ancestors = entry => { const out = []; for (let at = entry; at; at = at.parent) out.unshift(at); return out; };

/** The deepest entry every target sits in (the content root when they share nothing deeper). */
function commonContainer(index, entries) {
  if (!entries.length) return index.root;
  const chains = entries.map(ancestors);
  let container = index.root;
  for (let depth = 0; ; depth += 1) {
    const at = chains[0][depth];
    // A target is never its own container: the overlays sit beside it.
    if (!at || chains.some(chain => chain[depth] !== at || chain.length === depth + 1)) break;
    container = at;
  }
  return container;
}

/** A target entry's rect in a container's coordinates. */
function rectIn(entry, container) {
  return {x: r2(entry.ax - container.ax), y: r2(entry.ay - container.ay), width: entry.width ?? 0, height: entry.height ?? 0};
}

const union = rects => {
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
  return {x: r2(x), y: r2(y), width: r2(Math.max(...rects.map(r => r.x + r.width)) - x), height: r2(Math.max(...rects.map(r => r.y + r.height)) - y)};
};

// ---------------------------------------------------------------------------
// Targets: item indexes and element ids

const itemPattern = (model, parts) => new RegExp(`^${model.id}-(${parts.join('|')})-(\\d+)$`);

/** Every indexed item root: [{entry, part, index}]. */
function itemEntries(model, index, parts) {
  const re = itemPattern(model, parts);
  const out = [];
  for (const [id, entry] of index.byId) { const m = re.exec(id); if (m) out.push({entry, part: m[1], index: Number(m[2])}); }
  return out;
}

/**
 * One target spec → {entries (the ring's rect), items (indexes it stands for,
 * or null), siblings (entries to dim)}. Throws on a missing target.
 */
function resolveTarget(model, index, parts, spec, path) {
  const list = Array.isArray(spec) ? spec : [spec];
  const entries = [], items = new Set();
  let named = null;
  const all = itemEntries(model, index, parts);
  for (const ref of list) {
    if (Number.isInteger(ref)) {
      const found = all.filter(item => item.index === ref);
      if (!found.length) throw new Error(`${path}: ${model.module} has no item ${ref}`);
      entries.push(...found.map(item => item.entry));
      items.add(ref);
      continue;
    }
    const entry = index.byId.get(`${model.id}-${ref}`);
    if (!entry) throw new Error(`${path}: ${model.module} has no element "${ref}"`);
    entries.push(entry);
    const m = itemPattern(model, parts).exec(entry.id);
    if (m) items.add(Number(m[2]));
    else named = entry;
  }
  let siblings;
  if (items.size && !named) siblings = all.filter(item => !items.has(item.index)).map(item => item.entry);
  else siblings = [...(named ?? entries[0]).parent.node.children ?? []].filter(node => node?.id && !entries.some(entry => entry.node === node) && !/-ss-/.test(node.id)).map(node => index.byId.get(node.id));
  // Dim only the outermost: a dimmed row already dims the bar inside it.
  const dimSet = new Set(siblings);
  siblings = siblings.filter(entry => !ancestors(entry).slice(0, -1).some(up => dimSet.has(up)) && !entries.some(target => ancestors(target).includes(entry)));
  return {entries, items: [...items], siblings};
}

// ---------------------------------------------------------------------------
// The focus device (reusable by any op-list module)

/** The ring's look: a rounded rim in the focus colour with a soft outer glow. */
export function focusRingStyle(rect, {color, unit = 1, pad = 12}) {
  const p = r2(pad * unit);
  return abs(r2(rect.x - p), r2(rect.y - p), r2(rect.width + p * 2), r2(rect.height + p * 2), {
    boxSizing: 'border-box', borderRadius: r2(18 * unit), border: `${r2(3 * unit)}px solid ${color}`,
    boxShadow: `0 0 ${r2(22 * unit)}px ${color}99, inset 0 0 ${r2(14 * unit)}px ${color}33`, opacity: 0, transformOrigin: '50% 50%', pointerEvents: 'none'
  });
}

/**
 * The travelling focus ring, for any module drawn from a view tree and an op
 * list. steps: [{at, rect: {x, y, width, height} | null, dim?: [ids], dimTo?}] in the
 * coordinates of the node the rings are inserted into; rect null hides the
 * ring. → {nodes (insert after the targets, so the ring draws on top),
 * apply(ops)}: apply appends the ring's travel and the dims, reading current
 * opacities from the ops already there (so call it after the module's own).
 */
export function focusDevice({id, steps, color, unit = 1, dimTo = FOCUS_DIM, start = 0, pad = 12, move = STATE_MOVE}) {
  const rings = [], stepRings = [];
  let current = null;
  for (const step of steps) {
    if (!step.rect) current = null;
    else if (!current || !sameRect(current.rect, step.rect)) { current = {id: `${id}-ss-ring-${rings.length}`, rect: step.rect}; rings.push(current); }
    stepRings.push(current);
  }
  const nodes = rings.map(ring => el('div', ring.id, focusRingStyle(ring.rect, {color, unit, pad})));
  const apply = (ops) => {
    for (const ring of rings) ops.push({type: 'set', target: ring.id, time: start, props: {opacity: 0, x: 0, y: 0, scaleX: 1, scaleY: 1}});
    let shown = null;
    const dimmed = new Map();
    steps.forEach((step, k) => {
      const T = step.at;
      const ring = stepRings[k];
      if (ring !== shown) {
        if (ring && shown) {
          const a = center(shown.rect), b = center(ring.rect);
          const from = {opacity: 1, x: r2(a.x - b.x), y: r2(a.y - b.y), scaleX: rt((shown.rect.width + pad * 2 * unit) / (ring.rect.width + pad * 2 * unit)), scaleY: rt((shown.rect.height + pad * 2 * unit) / (ring.rect.height + pad * 2 * unit))};
          ops.push({type: 'set', target: shown.id, time: T, props: {opacity: 0}});
          ops.push({type: 'set', target: ring.id, time: T, props: from});
          ops.push({type: 'tween', target: ring.id, start: T, duration: move, ease: ONSET, from: {x: from.x, y: from.y, scaleX: from.scaleX, scaleY: from.scaleY}, to: {x: 0, y: 0, scaleX: 1, scaleY: 1}});
        } else if (ring) {
          ops.push({type: 'tween', target: ring.id, start: T, duration: 0.3, ease: 'power2.out', from: {opacity: 0}, to: {opacity: 1}});
          ops.push({type: 'tween', target: ring.id, start: T, duration: 0.45, ease: 'power3.out', from: {scaleX: 1.06, scaleY: 1.06}, to: {scaleX: 1, scaleY: 1}});
        } else ops.push({type: 'tween', target: shown.id, start: T, duration: 0.3, ease: 'power1.out', from: {opacity: 1}, to: {opacity: 0}});
        shown = ring;
      }
      // Dims: restore what leaves the set, dim what joins it.
      const level = step.dimTo ?? dimTo;
      const want = new Set(step.rect && level !== false ? step.dim ?? [] : []);
      const state = frameState(ops, T);
      for (const [target, base] of [...dimmed]) {
        if (want.has(target)) continue;
        const now = state.get(target)?.opacity ?? base;
        ops.push({type: 'tween', target, start: T, duration: 0.25, ease: ONSET, from: {opacity: now}, to: {opacity: base}});
        dimmed.delete(target);
      }
      for (const target of want) {
        if (dimmed.has(target)) continue;
        const base = state.get(target)?.opacity ?? 1;
        ops.push({type: 'tween', target, start: T, duration: 0.25, ease: ONSET, from: {opacity: base}, to: {opacity: r2(base * level)}});
        dimmed.set(target, base);
      }
    });
  };
  return {nodes, apply};
}

const sameRect = (a, b) => a && b && ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < 0.5);
const center = rect => ({x: rect.x + rect.width / 2, y: rect.y + rect.height / 2});

// ---------------------------------------------------------------------------
// The plan: everything the view and the timeline need, computed once per model

const plans = new WeakMap();

/**
 * The state plan for a model with shotStates and its content tree:
 * {container, focus (focusDevice), overlays: [{node, ops(ops)}], index}.
 */
function statePlan(model, children, view) {
  const cached = plans.get(model);
  if (cached && cached.children === children) return cached;
  const shot = model.shotStates;
  const index = indexView(children);
  const parts = shot.items;
  const u = model.unit ?? 1;
  const color = shot.color;
  // Every target the overlays point at decides where they live.
  const targetsOf = (set, path) => {
    const out = [];
    if (set.focus !== undefined && set.focus !== null) out.push(['focus', resolveTarget(model, index, parts, set.focus, `${path}.set.focus`)]);
    if (set.glow !== undefined) out.push(['glow', resolveTarget(model, index, parts, set.glow, `${path}.set.glow`)]);
    if (set.note) out.push(['note', resolveTarget(model, index, parts, set.note.target, `${path}.set.note.target`)]);
    if (set.guide?.target !== undefined) out.push(['guide', resolveTarget(model, index, parts, set.guide.target, `${path}.set.guide.target`)]);
    if (set.reveal) out.push(['reveal', resolveTarget(model, index, parts, set.reveal, `${path}.set.reveal`)]);
    return out;
  };
  const resolved = shot.states.map(state => ({state, targets: targetsOf(state.set, `states[${state.index}]`)}));
  const valueGuides = shot.states.some(state => state.guide);
  const container = valueGuides ? index.root : commonContainer(index, resolved.flatMap(r => r.targets.flatMap(([, t]) => t.entries)));
  const W = container.width ?? model.rect.width, H = container.height ?? model.rect.height;
  // Rects follow the params: a target is measured in the latest state model's view.
  const views = [];
  let latest = index;
  for (const state of shot.states) { if (state.model) latest = indexView(view(state.model)); views.push(latest); }
  const rectOf = (entries, k) => {
    const at = views[k] ?? index;
    const box = container === index.root ? at.root : at.byId.get(container.id) ?? container;
    return union(entries.map(entry => rectIn(at.byId.get(entry.id) ?? entry, box)));
  };
  const textSize = r2(Math.max(36 * u, model.canvas?.height > model.canvas?.width ? 44 : 32));
  const ink = inkFor(model.theme, color);

  // Focus: one step per state (focus persists until a state changes it).
  let focus = null, dimTo = FOCUS_DIM;
  const steps = [];
  for (const {state, targets} of resolved) {
    const f = targets.find(([kind]) => kind === 'focus')?.[1];
    if (state.set.dim !== undefined) dimTo = state.set.dim === false ? false : state.set.dim;
    if (f) focus = {rect: rectOf(f.entries, state.index), dim: f.siblings.map(entry => entry.id)};
    else if (state.set.focus === null) focus = null;
    else if (!focus) continue;
    steps.push({at: state.at, rect: focus?.rect ?? null, dim: focus?.dim ?? [], dimTo});
  }
  const device = focusDevice({id: model.id, steps, color, unit: u, start: model.start});

  // A state's guide line in container px: {axis, at, from, to}.
  const guideLine = (state, targets, k) => {
    if (state.guide) return {axis: state.guide.axis, at: r2(state.guide.at), from: state.guide.from, to: state.guide.to};
    const rect = rectOf(targets.find(([kind]) => kind === 'guide')[1].entries, k);
    const edge = state.set.guide.edge ?? 'top';
    return edge === 'top' || edge === 'bottom' ? {axis: 'y', at: edge === 'top' ? rect.y : r2(rect.y + rect.height), from: 0, to: W} : {axis: 'x', at: edge === 'left' ? rect.x : r2(rect.x + rect.width), from: 0, to: H};
  };

  // Glows, guides and notes: built hidden, shown at their state, cleared by a later clear.
  const overlays = [];
  const live = [];
  for (const {state, targets} of resolved) {
    const T = state.at;
    if (state.set.clear) for (const item of live.splice(0)) for (const target of item.ids) overlays.push({ops: ops => ops.push({type: 'tween', target, start: T, duration: 0.3, ease: 'power1.out', from: {opacity: 1}, to: {opacity: 0}})});
    const k = state.index;
    // The bloom: on what this state brings into view (focus, glow, else what
    // it reveals, else a band along its guide).
    const marked = ['focus', 'glow', 'reveal'].map(kind => targets.find(([name]) => name === kind)?.[1]).find(Boolean);
    const band = !marked && state.set.guide ? guideLine(state, targets, k) : null;
    if (marked || band) {
      const half = r2(40 * u);
      const rect = marked ? rectOf(marked.entries, k) : band.axis === 'y' ? {x: band.from, y: r2(band.at - half), width: r2(band.to - band.from), height: half * 2} : {x: r2(band.at - half), y: band.from, width: half * 2, height: r2(band.to - band.from)};
      const p = r2(STATE_BLOOM.pad * u), bid = `${model.id}-ss-bloom-${k}`;
      overlays.push({under: true, node: el('div', bid, abs(r2(rect.x - p), r2(rect.y - p), r2(rect.width + p * 2), r2(rect.height + p * 2), {borderRadius: r2(32 * u), background: color, filter: `blur(${r2(STATE_BLOOM.blur * u)}px)`, opacity: 0, transformOrigin: '50% 50%'})),
        ops: ops => {
          ops.push({type: 'set', target: bid, time: model.start, props: {opacity: 0, scaleX: 0.9, scaleY: 0.9}});
          ops.push({type: 'tween', target: bid, start: T, duration: STATE_BLOOM.rise, ease: 'power2.out', from: {opacity: 0}, to: {opacity: STATE_BLOOM.peak}});
          ops.push({type: 'tween', target: bid, start: T, duration: STATE_BLOOM.rise + STATE_BLOOM.decay, ease: ONSET, from: {scaleX: 0.9, scaleY: 0.9}, to: {scaleX: 1.04, scaleY: 1.04}});
          ops.push({type: 'tween', target: bid, start: rt(T + STATE_BLOOM.rise), duration: STATE_BLOOM.decay, ease: 'power2.out', from: {opacity: STATE_BLOOM.peak}, to: {opacity: 0}});
        }});
    }
    const glow = targets.find(([kind]) => kind === 'glow')?.[1];
    if (glow) {
      const rect = rectOf(glow.entries, k);
      const p = r2(18 * u), gid = `${model.id}-ss-glow-${k}`;
      overlays.push({under: true, node: el('div', gid, abs(r2(rect.x - p), r2(rect.y - p), r2(rect.width + p * 2), r2(rect.height + p * 2), {boxSizing: 'border-box', borderRadius: r2(24 * u), background: `${color}24`, boxShadow: `0 0 ${r2(56 * u)}px ${r2(14 * u)}px ${color}55`, opacity: 0, transformOrigin: '50% 50%'})),
        ops: ops => { ops.push({type: 'set', target: gid, time: model.start, props: {opacity: 0, scaleX: 0.92, scaleY: 0.92}}); ops.push({type: 'tween', target: gid, start: T, duration: 0.5, ease: 'power2.out', from: {opacity: 0, scaleX: 0.92, scaleY: 0.92}, to: {opacity: 1, scaleX: 1, scaleY: 1}}); }});
      live.push({ids: [gid]});
    }
    const guideSpec = state.set.guide;
    if (guideSpec) {
      const line = guideLine(state, targets, k);
      const gid = `${model.id}-ss-guide-${k}`, stroke = r2(3 * u);
      const style = line.axis === 'y'
        ? abs(line.from, r2(line.at - stroke / 2), r2(line.to - line.from), 0, {borderTop: `${stroke}px dashed ${color}`, transformOrigin: '0% 50%', opacity: 0})
        : abs(r2(line.at - stroke / 2), line.from, 0, r2(line.to - line.from), {borderLeft: `${stroke}px dashed ${color}`, transformOrigin: '50% 0%', opacity: 0});
      const scaleFrom = line.axis === 'y' ? {scaleX: 0, scaleY: 1} : {scaleX: 1, scaleY: 0};
      overlays.push({node: el('div', gid, style), ops: ops => {
        ops.push({type: 'set', target: gid, time: model.start, props: {opacity: 0, ...scaleFrom}});
        ops.push({type: 'set', target: gid, time: T, props: {opacity: 1}});
        ops.push({type: 'tween', target: gid, start: T, duration: STATE_MOVE, ease: ONSET, from: scaleFrom, to: {scaleX: 1, scaleY: 1}});
      }});
      const ids = [gid];
      if (guideSpec.label) {
        const lid = `${gid}-label`;
        const w = r2(textWidth(guideSpec.label, textSize, 'meta') + 8 * u);
        const pos = line.axis === 'y' ? {x: r2(Math.max(0, line.to - w)), y: r2(Math.max(0, line.at - textSize * 1.25 - 6 * u))} : {x: r2(Math.min(W - w, line.at + 10 * u)), y: line.from};
        overlays.push({node: textNode(lid, {...abs(pos.x, pos.y, w), fontFamily: model.fonts?.meta, fontSize: textSize, lineHeight: '1.2', fontWeight: 600, color, textAlign: line.axis === 'y' ? 'right' : 'left', opacity: 0}, guideSpec.label),
          ops: ops => { ops.push({type: 'set', target: lid, time: model.start, props: {opacity: 0, y: r2(8 * u)}}); ops.push({type: 'tween', target: lid, start: rt(T + 0.3), duration: 0.35, ease: 'power2.out', from: {opacity: 0, y: r2(8 * u)}, to: {opacity: 1, y: 0}}); }});
        ids.push(lid);
      }
      live.push({ids});
    }
    const note = targets.find(([kind]) => kind === 'note')?.[1];
    if (note) {
      const rect = rectOf(note.entries, k);
      const nid = `${model.id}-ss-note-${k}`;
      const padX = r2(16 * u), h = r2(textSize * 1.2 + 14 * u), w = r2(textWidth(state.set.note.text, textSize, 'body') + padX * 2);
      const above = (state.set.note.side ?? 'above') === 'above' ? rect.y - h - 14 * u >= 0 || rect.y + rect.height + h + 14 * u > H : false;
      // A wide target (a table row) takes the chip at its right end, clear of its cells' text.
      const anchorX = rect.width > w * 3 ? rect.x + rect.width - w : rect.x + rect.width / 2 - w / 2;
      const x = r2(Math.min(Math.max(0, anchorX), Math.max(0, W - w)));
      const y = r2(above ? Math.max(0, rect.y - h - 14 * u) : Math.min(H - h, rect.y + rect.height + 14 * u));
      overlays.push({node: el('div', nid, abs(x, y, w, h, {boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: r2(h / 2), background: color, color: ink, fontFamily: model.fonts?.body, fontSize: textSize, fontWeight: 700, lineHeight: '1.2', whiteSpace: 'nowrap', opacity: 0, transformOrigin: '50% 50%'}), [state.set.note.text]),
        ops: ops => { ops.push({type: 'set', target: nid, time: model.start, props: {opacity: 0, scaleX: 0.8, scaleY: 0.8}}); ops.push({type: 'tween', target: nid, start: T, duration: 0.25, ease: 'power1.out', from: {opacity: 0}, to: {opacity: 1}}); ops.push({type: 'tween', target: nid, start: T, duration: 0.45, ease: 'back.out(2)', from: {scaleX: 0.8, scaleY: 0.8}, to: {scaleX: 1, scaleY: 1}}); }});
      live.push({ids: [nid]});
    }
  }
  const plan = {children, index, container, device, overlays};
  plans.set(model, plan);
  return plan;
}

function inkFor(theme = {}, fill) {
  let best = '#000000', ratio = 0;
  for (const option of [theme.bg, theme.ink, theme.paper, theme.foreground, '#000000', '#ffffff']) {
    if (typeof option !== 'string' || !/^#[0-9a-f]{6}$/i.test(option)) continue;
    const r = contrastRatio(option, fill);
    if (r > ratio) { ratio = r; best = option; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The hooks the catalogues call

/**
 * A module's content children with the state overlays inserted: glows under
 * the container's children, guides, notes and the focus rings over them.
 * Unchanged when the model has no states.
 */
export function shotStateView(model, children, {view}) {
  if (!model?.shotStates) return children;
  const plan = statePlan(model, children, view);
  const under = plan.overlays.filter(o => o.under && o.node).map(o => o.node);
  const over = [...plan.overlays.filter(o => !o.under && o.node).map(o => o.node), ...plan.device.nodes];
  if (!under.length && !over.length) return children;
  const target = plan.container.node;
  const insert = node => (node === target ? {...node, children: [...under, ...(node.children ?? []), ...over]} : node.children ? {...node, children: node.children.map(child => (child && typeof child === 'object' ? insert(child) : child))} : node);
  if (plan.container === plan.index.root) return [...under, ...children, ...over];
  return children.map(child => (child && typeof child === 'object' ? insert(child) : child));
}

/**
 * Append a model's state ops to its op list (after the module's own).
 * view(model) → content children; timeline(model) → its full op list.
 */
export function applyShotStates(model, ops, {view, timeline}) {
  const shot = model?.shotStates;
  if (!shot) return ops;
  const children = view(model);
  const plan = statePlan(model, children, view);
  const {index} = plan;
  // Reveals first: they move the module's own entrance ops.
  for (const state of shot.states) for (const ref of state.set.reveal ?? []) revealOps(model, index, shot.items, ref, state.at, ops, `states[${state.index}].set.reveal`);
  // Param changes, in state order, each from wherever the frame is at its time.
  let baseIndex = index;
  for (const state of shot.states) {
    if (!state.model) continue;
    const nextIndex = indexView(view(state.model));
    const settled = frameState(timeline(state.model), (state.model.motion?.exitStart ?? state.model.end) - 1e-3);
    morphOps(model, baseIndex, nextIndex, settled, state.at, ops);
  }
  for (const overlay of plan.overlays) overlay.ops?.(ops);
  plan.device.apply(ops);
  return ops;
}

/** Shift an item's own entrance (every op on it before T, after the scene start) to start at T. */
function revealOps(model, index, parts, ref, T, ops, path) {
  const {entries} = resolveTarget(model, index, parts, ref, path);
  const ids = new Set();
  const add = entry => { if (entry.id) ids.add(entry.id); for (const [, other] of index.byId) if (other.parent === entry) add(other); };
  entries.forEach(add);
  const timeOf = op => (op.type === 'set' ? op.time : op.start);
  const moving = ops.filter(op => ids.has(op.target) && timeOf(op) > model.start + EPS && timeOf(op) < T - EPS);
  if (!moving.length) return;
  const delta = T - Math.min(...moving.map(timeOf));
  for (const op of moving) {
    if (op.type === 'set') op.time = rt(op.time + delta);
    else op.start = rt(op.start + delta);
  }
}

const MORPH_KEYS = ['opacity', 'x', 'y', 'scaleX', 'scaleY', 'rotation', 'strokeDashoffset', 'blur', 'clipT', 'clipR', 'clipB', 'clipL'];
const DEFAULTS = {opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, strokeDashoffset: 0, blur: 0, clipT: 0, clipR: 0, clipB: 0, clipL: 0};

/** Tween each base element to where the next state's model settles it. */
function morphOps(model, base, next, settled, T, ops) {
  const now = frameState(ops, T);
  for (const [id, a] of base.byId) {
    const b = next.byId.get(id);
    if (!b || /-ss-/.test(id)) continue;
    const target = {...(settled.get(id) ?? {})};
    for (const key of MORPH_KEYS) if (target[key] === undefined) target[key] = DEFAULTS[key];
    // Geometry: a box maps its rect onto b's about its transform origin;
    // text keeps its size and moves with its alignment edge.
    if (a.x !== undefined && b.x !== undefined && a.y !== undefined && b.y !== undefined) {
      const box = a.box && b.box && a.width > 0 && a.height > 0;
      const ox = box ? a.origin.x : a.align, oy = box ? a.origin.y : 0;
      target.x += (b.x + ox * (b.width ?? 0)) - (a.x + ox * (a.width ?? 0));
      target.y += (b.y + oy * (b.height ?? 0)) - (a.y + oy * (a.height ?? 0));
      if (box) { target.scaleX *= b.width / a.width; target.scaleY *= b.height / a.height; }
    }
    const current = now.get(id) ?? {};
    const from = {}, to = {};
    for (const key of MORPH_KEYS) {
      const was = current[key] ?? (key === 'opacity' ? a.opacity ?? 1 : DEFAULTS[key]);
      if (Math.abs(was - target[key]) > 1e-3) { from[key] = r2s(was, key); to[key] = r2s(target[key], key); }
    }
    if (Object.keys(to).length) ops.push({type: 'tween', target: id, start: T, duration: STATE_MOVE, ease: ONSET, from, to});
    const textNow = current.text ?? a.text, textNext = settled.get(id)?.text ?? b.text;
    if (textNow !== null && textNext !== null && textNow !== undefined && textNext !== undefined && String(textNow) !== String(textNext)) countText(ops, id, T, String(textNow), String(textNext), model.fps ?? 30);
  }
}

const r2s = (value, key) => (key.startsWith('scale') ? rt(value) : r2(value));

const NUMBER = /-?\d[\d,]*(\.\d+)?/;

/** Text sets from one string to another: a count when both carry one number in the same frame, else a swap halfway. */
export function countText(ops, target, T, from, to, fps = 30) {
  const a = NUMBER.exec(from), b = NUMBER.exec(to);
  const frame = (prefix, suffix) => [prefix, suffix];
  if (a && b && from.slice(0, a.index) === to.slice(0, b.index) && from.slice(a.index + a[0].length) === to.slice(b.index + b[0].length)) {
    const [prefix, suffix] = frame(to.slice(0, b.index), to.slice(b.index + b[0].length));
    const decimals = (b[1] ?? '').length ? b[1].length - 1 : 0, grouped = b[0].includes(',');
    const va = Number(a[0].replace(/,/g, '')), vb = Number(b[0].replace(/,/g, ''));
    const steps = Math.max(2, Math.round(STATE_MOVE * fps / 2));
    for (let i = 1; i <= steps; i += 1) {
      const p = i / steps, eased = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
      const value = i === steps ? b[0] : formatLike(va + (vb - va) * eased, decimals, grouped);
      ops.push({type: 'set', target, time: rt(T + STATE_MOVE * (i - 1) / steps), props: {text: `${prefix}${value}${suffix}`}});
    }
    return;
  }
  ops.push({type: 'set', target, time: rt(T + STATE_MOVE / 2), props: {text: to}});
}

function formatLike(value, decimals, grouped) {
  const fixed = value.toFixed(decimals);
  if (!grouped) return fixed;
  const [whole, frac] = fixed.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac ? `.${frac}` : ''}`;
}

// ---------------------------------------------------------------------------
// Lint helpers (src/direction_guardrails.js): when a scene's look changes

/** Seconds (absolute) at which a resolved scene's states change the frame. */
export function stateTimes(scene) {
  return Array.isArray(scene?.states) ? scene.states.map(state => Number(state?.at)).filter(Number.isFinite) : [];
}

// ---------------------------------------------------------------------------
// Zoom targets (kit/core/zooms.mjs): a state target's rect on the plate

/**
 * The rect (canvas px) of a state target on a module's full view tree (its
 * root node at model.rect, as catalogBView / catalogGView / catalogHView
 * return it): the union of the target's elements. parts: the module's item
 * parts (stateSpec(...).items). Throws on a missing target.
 */
export function stateTargetRect(model, tree, parts, target, path = 'target') {
  if (!isTarget(target)) throw new Error(`${path} must be an item index, an element id ("cell-1-2") or an array of them`);
  const index = indexView(Array.isArray(tree) ? tree : [tree]);
  const {entries} = resolveTarget(model, index, parts, target, path);
  return union(entries.map(entry => rectIn(entry, index.root)));
}

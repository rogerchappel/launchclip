// A member whose status changes over time (docs/FLUID_MOTION_RFC.md §10): one
// member of a set goes pending → active → pass or fail on timed events, as
// status-rack does for a whole module. A change lands at a time or on a beat
// of the module's grid (RFC §8), and the member's colour and corner mark
// cross over slow → fast → slow with no overshoot.
//
// The member is drawn once per state it reaches (the module paints its face
// in that state's colour), stacked, and the changes are opacity crossfades, so
// both renderers draw the same frames from the same view and ops.
//
// Status colours: pending is the muted foreground, active the brand primary,
// pass and fail a green and a red, each pushed until it clears 3:1 on bg, like
// status-rack's palette.
//
// The `status` member module (kit/core/members.mjs) is a card (icon, label)
// with a status: its face and a corner mark in each state's colour.
//
// Canonical copy: kit/core/member-status.mjs.

import {abs, el, hex2, set, tw} from './catalog-b-view.mjs';
import {contrastRatio, fitContrast, hexToOklch} from './oklch.mjs';
import {iconNode} from './icons.mjs';
import {graphicNodes, graphicSpec, graphicWidth} from './graphic.mjs';

export const STATUS_STATES = Object.freeze(['pending', 'active', 'pass', 'fail']);
export const STATUS_MARKS = Object.freeze({pending: 'clock', active: 'loader', pass: 'check', fail: 'x'});
// A crossfade: long enough to read, short enough to sit inside a beat at 120 bpm.
export const STATUS_CHANGE = Object.freeze({duration: 0.45, ease: 'sine.inOut', gap: 0.3, mark: 0.72});
const BASE = Object.freeze({pass: '#2fbf71', fail: '#f2545b'});

/** One line for a member's params: what a `status` may be. */
export const STATUS_PARAM = `${STATUS_STATES.join(' | ')}, or changes over time: [{state, at? (s from scene start) | beat? (beats from scene start)}] 1–4, the first holding from the start`;

const legible = (hex, bg) => contrastRatio(hex, bg) >= 3 ? hex : fitContrast(hexToOklch(hex), bg, 3) ?? hex;

/** The four status colours on a brand ({bg, primary}) and its muted tone. */
export function statusColors(colors, muted) {
  return {pending: legible(muted, colors.bg), active: legible(colors.primary, colors.bg), pass: legible(BASE.pass, colors.bg), fail: legible(BASE.fail, colors.bg)};
}

/**
 * A validated status → [{state, time}] (scene-absolute seconds, rising by at
 * least STATUS_CHANGE.gap, each change done before `until`), or a check.fail.
 * start: the scene start; until: when the module starts to leave; beat: the
 * module's beat in seconds (a `beat` change lands start + beat × n).
 */
export function memberStatus(check, raw, path, {start, until, beat = 0.5}) {
  if (typeof raw === 'string') return [{state: check.oneOf(raw, path, STATUS_STATES), time: start}];
  check.arr(raw, path, 1, 4);
  let previous = -Infinity;
  return raw.map((entry, i) => {
    const p = `${path}[${i}]`;
    const change = typeof entry === 'string' ? {state: entry} : check.obj(entry, p, ['state', 'at', 'beat'], ['state']);
    const state = check.oneOf(change.state, `${p}.state`, STATUS_STATES);
    if (change.at !== undefined && change.beat !== undefined) check.fail(p, 'takes at or beat, not both');
    if (i === 0 && (change.at !== undefined || change.beat !== undefined)) check.fail(p, 'is the state the member starts in; it holds from the scene start, so give it no at or beat');
    if (i > 0 && change.at === undefined && change.beat === undefined) check.fail(p, 'needs at (seconds from scene start) or beat (beats from scene start)');
    const time = i === 0 ? start : change.beat !== undefined ? start + check.int(change.beat, `${p}.beat`, 1, 256) * beat : start + check.num(change.at, `${p}.at`, 0, 600);
    const t = Math.round(time * 1000) / 1000;
    if (i > 0 && raw[i - 1] && state === (typeof raw[i - 1] === 'string' ? raw[i - 1] : raw[i - 1].state)) check.fail(`${p}.state`, `repeats the state before it (${state}); leave it out`);
    if (t - previous < STATUS_CHANGE.gap - 1e-6) check.fail(p, `lands ${Math.round((t - previous) * 100) / 100}s after the change before it; changes are at least ${STATUS_CHANGE.gap}s apart`);
    if (i > 0 && t + STATUS_CHANGE.duration > until + 1e-6) check.fail(p, `finishes after the module starts to leave (${Math.round(until * 100) / 100}s); change earlier`);
    previous = t;
    return {state, time: t};
  });
}

/** The states a status reaches, in order of first use. */
export const statusStates = changes => [...new Set(changes.map(c => c.state))];

/**
 * View nodes for a member's status: one layer per state it reaches, each the
 * module's face painted in that state's colour (`paint(color, state) → nodes`)
 * with a mark disc on its corner, in a width × height box. Ids <id>-status-<state>.
 * look: {colors (statusColors), ink (state → text colour), unit, mark (disc px), panel}.
 */
export function statusNodes(id, changes, width, height, paint, look) {
  const {colors, ink, unit: u, mark: D, panel} = look;
  return statusStates(changes).map((state, i) => {
    const color = colors[state];
    const disc = el('div', null, {...abs(Math.round((width - D * STATUS_CHANGE.mark) * 100) / 100, Math.round(-D * 0.28 * 100) / 100, D, D), boxSizing: 'border-box', borderRadius: '50%', background: color,
      border: `${Math.round(3 * u * 100) / 100}px solid ${panel}`, boxShadow: `0 0 ${Math.round(18 * u * 100) / 100}px ${hex2(color, 0.55)}`}, [
      iconNode(STATUS_MARKS[state], {x: Math.round(D * 0.22 * 100) / 100, y: Math.round(D * 0.22 * 100) / 100, size: Math.round(D * 0.56 * 100) / 100, color: ink(state)})]);
    return el('div', `${id}-status-${state}`, {...abs(0, 0, width, height), opacity: i === 0 ? 1 : 0}, [...paint(color, state), disc]);
  });
}

/**
 * Ops for a member's status. Only the upper of the two layers fades (the lower
 * one stays opaque under it), so the member never turns see-through mid-change.
 */
export function statusOps(ops, id, changes, start) {
  const order = statusStates(changes);
  for (const state of order) set(ops, `${id}-status-${state}`, start, {opacity: state === changes[0].state ? 1 : 0});
  for (let i = 1; i < changes.length; i++) {
    const {time} = changes[i], from = changes[i - 1].state, to = changes[i].state;
    const {duration, ease} = STATUS_CHANGE;
    if (order.indexOf(to) > order.indexOf(from)) {
      tw(ops, `${id}-status-${to}`, time, duration, ease, {opacity: 0}, {opacity: 1});
      set(ops, `${id}-status-${from}`, time + duration, {opacity: 0});
    } else {
      set(ops, `${id}-status-${to}`, time, {opacity: 1});
      tw(ops, `${id}-status-${from}`, time, duration, ease, {opacity: 1}, {opacity: 0});
    }
  }
}

// The text colour (ink, paper or bg) that reads best on a fill.
const inkOn = (colors, fill) => [colors.ink, colors.paper, colors.bg].reduce((best, c) => contrastRatio(c, fill) > contrastRatio(best, fill) ? c : best);
const CARD = ['icon', 'label'];

/** The `status` member module: a card whose status changes over time. */
export const statusMember = {
  id: 'status',
  describe: 'A member whose status changes over time: a card (icon, label) that goes pending → active → pass or fail at times or on beats, its colour and corner mark crossing over slow → fast → slow.',
  params: {status: STATUS_PARAM, icon: 'icon name (optional)', label: 'string (optional; one of icon or label)'},
  face: 'card',
  spec(check, raw, path, {labelMax, base}) {
    for (const key of Object.keys(raw)) if (key !== 'status' && !CARD.includes(key)) check.fail(`${path}.${key}`, `is not supported (allowed: module, status, ${CARD.join(', ')})`);
    if (raw.status === undefined) check.fail(`${path}.status`, `is required: ${STATUS_PARAM}`);
    const {status, ...card} = raw;
    // A beat is the set's own (node-graph's bpm), else 120 bpm, counted from the scene start.
    const changes = memberStatus(check, status, `${path}.status`, {start: base.start, until: base.motion.exitStart, beat: 60 / (base.params.bpm ?? 120)});
    const colors = statusColors(base.colors, base.theme.muted);
    const inks = Object.fromEntries(STATUS_STATES.map(state => [state, inkOn(base.colors, colors[state])]));
    return {...graphicSpec(check, {kind: 'card', ...card}, path, labelMax ? {labelMax} : undefined), status: changes, colors, inks};
  },
  width: (spec, L) => graphicWidth({...spec, kind: 'card'}, L),
  // One face per state; the set's lit rim (look.over) lies over them all.
  nodes: (spec, W, H, look) => [
    ...statusNodes(look.key, spec.status, W, H, color => graphicNodes({...spec, kind: 'card'}, W, H, {...look, color, ink: inkOn(look.colors, color), over: []}),
      {colors: spec.colors, ink: state => spec.inks[state], unit: look.unit, mark: Math.round(Math.max(look.labelSize * 1.3, look.icon * 0.6) * 100) / 100, panel: look.panel}),
    ...(look.over ?? [])],
  timeline: (ops, spec, at) => statusOps(ops, at.key, spec.status, at.start)
};

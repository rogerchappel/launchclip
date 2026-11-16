// Planner-drawn graphics (docs/FLUID_MOTION_RFC.md §10): a small graphic the
// planner describes as data, `{kind: "card", icon: "chef-hat", label: "Baker",
// badge: "3"}`, validated like module params and painted by one shared painter
// into view-tree nodes in the module's palette and type, so it renders in both
// renderers and can stand in for any member of a group (kit/core/fluid-motion.mjs).
//
// The list is closed: five shapes (card, chip, badge, ribbon, and a prop from
// the world kit), any icon from kit/core/icons.mjs, and text that fits. Anything
// else is a validation error the planner can fix, never free-form markup.
//
// graphicSpec validates, graphicWidth measures, fitGraphic sizes the label for
// a width, and graphicNodes paints into a width × height box at (0, 0); the
// module keeps its own wrappers (layout, idle) around the nodes.

import {abs, el, hex2} from './catalog-b-view.mjs';
import {mixColor, r2, textWidth} from './catalog-h-base.mjs';
import {label} from './catalog-h-view.mjs';
import {ICON_NAMES, iconNode, iconPath, isIcon} from './icons.mjs';
import {PROP_IDS, PROP_STATES, drawProp} from './worlds/index.mjs';

export const GRAPHIC_KINDS = Object.freeze(['card', 'chip', 'badge', 'ribbon', 'prop']);
// Keys each kind takes (kind is always allowed); the first group must have one of its keys.
const KEYS = {card: ['icon', 'label', 'badge'], chip: ['icon', 'label'], badge: ['icon', 'text', 'label'], ribbon: ['icon', 'label'], prop: ['prop', 'state', 'label']};
const NEEDS = {card: ['icon', 'label'], chip: ['label'], badge: ['icon', 'text'], ribbon: ['label'], prop: ['prop']};
const SHORT = 3;

// Past the closed list is a catalogue module, never a bigger spec (RFC §10). A word
// the planner reached for (an unknown kind, or a key no kind takes) → the module
// that draws it, or null when none does yet. Matched on the word or its singular.
export const BEYOND = Object.freeze({
  chart: 'bar-chart', bar: 'bar-chart', pie: 'pie-chart', line: 'trend-chart', trend: 'trend-chart', sparkline: 'sparkline',
  stat: 'stat-card', number: 'stat-card', metric: 'stat-card', value: 'stat-card', figure: 'stat-card', count: 'count-up',
  progress: 'progress', percent: 'percent-fill', ring: 'progress-ring', gauge: 'gauge-compare',
  arrow: 'callout-arrow', step: 'process-steps', flow: 'process-steps', table: 'comparison-table', list: 'item-list', bullet: 'item-list',
  image: 'photo-scene', photo: 'photo-scene', picture: 'photo-scene', src: 'photo-scene', media: 'media-grid', logo: 'logo-row',
  quote: 'quote-card', speech: 'speech-bubble', bubble: 'speech-bubble', tooltip: 'tooltip', sticker: 'sticker', note: 'tape-note',
  avatar: 'person-id', person: 'person-id', face: 'person-id', character: 'cast-scene',
  timeline: 'timeline', date: 'date-card', calendar: 'month-grid', map: 'map-highlight', code: 'code-snippet', terminal: 'terminal-session',
  phone: 'device-frame', device: 'device-frame', screen: 'device-frame', ui: 'ui-scene', post: 'social-post', tweet: 'social-post',
  title: 'motion-title', heading: 'motion-title', headline: 'motion-title',
  detail: 'concept-card', description: 'concept-card', subtitle: 'concept-card', body: 'concept-card', caption: 'concept-card',
  graphic: 'icon-grid', children: 'icon-grid', item: 'icon-grid', member: 'icon-grid', group: 'node-graph', node: 'node-graph',
  color: null, colour: null, emoji: null, shape: null, circle: null, rect: null, svg: null, path: null, html: null, style: null, css: null,
  x: null, y: null, left: null, top: null, width: null, height: null, size: null, position: null, layout: null, align: null, rotate: null, scale: null, offset: null
});
// Words past the list that a member module draws (kit/core/members.mjs): the item takes {member} instead.
export const BEYOND_MEMBER = Object.freeze({
  sub: 'sub-card', detail: 'sub-card', subtitle: 'sub-card', description: 'sub-card', caption: 'sub-card',
  value: 'value-card', figure: 'value-card', multiplier: 'value-card', price: 'value-card', amount: 'value-card',
  avatar: 'person', person: 'person', face: 'person', portrait: 'person', initials: 'person',
  logo: 'brand-mark', brand: 'brand-mark', integration: 'brand-mark', partner: 'brand-mark'
});
const NESTED = new Set(['graphic', 'children', 'item', 'member', 'group', 'node']);
const LAYOUT = new Set(['x', 'y', 'left', 'top', 'width', 'height', 'size', 'position', 'layout', 'align', 'rotate', 'scale', 'offset']);

/** Where a request past the closed list belongs: one clause naming the nearest catalogue module, or that none draws it yet. */
export function beyondGraphic(word) {
  const words = String(word).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const forms = words.flatMap(w => [w, w.replace(/s$/, ''), w.replace(/es$/, '')]);
  const member = forms.find(w => w in BEYOND_MEMBER);
  if (member) return `that is the ${BEYOND_MEMBER[member]} member's job: give the item {member: {module: "${BEYOND_MEMBER[member]}", …}} in place of the graphic`;
  const hit = forms.find(w => w in BEYOND);
  if (!hit) return 'no catalogue module draws that yet; leave it out, or add a module (docs/ROADMAP.md)';
  if (NESTED.has(hit)) return `graphics do not nest; a set of graphics is a module's members (${BEYOND[hit]}, ${hit === 'node' || hit === 'group' ? 'icon-grid' : 'node-graph'})`;
  if (LAYOUT.has(hit)) return 'the module lays out its members; no module takes free positions or sizes';
  return BEYOND[hit] ? `that is the ${BEYOND[hit]} module's job; give it its own scene` : 'no catalogue module draws that yet; leave it out, or add a module (docs/ROADMAP.md)';
}

/** One line for a module's params: what a `graphic` may be. */
export const GRAPHIC_PARAM = `{kind: card | chip | badge | ribbon | prop, …} a drawn member (RFC §10): card {icon?, label?, badge? ≤ ${SHORT} chars}; chip {label, icon?}; badge {icon | text ≤ ${SHORT} chars, label?}; ribbon {label, icon?}; prop {prop (a world-kit prop: laptop, mug, robot, …), state?, label?}; icons from kit/core/icons.mjs`;

/**
 * A validated graphic spec, or a check.fail naming what to change.
 * → {kind, icon, label, badge, text, prop, state} (absent fields null).
 */
export function graphicSpec(check, raw, path, {labelMax = 14} = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) check.fail(path, `must be a graphic: ${GRAPHIC_PARAM}`);
  if (raw.kind === undefined) check.fail(`${path}.kind`, `is required (${GRAPHIC_KINDS.join(', ')})`);
  if (!GRAPHIC_KINDS.includes(raw.kind)) check.fail(`${path}.kind`, `must be one of ${GRAPHIC_KINDS.join(', ')}, got ${JSON.stringify(raw.kind)}: the list is closed, and ${beyondGraphic(raw.kind)}`);
  const kind = raw.kind;
  for (const [key, value] of Object.entries(raw)) {
    if (key !== 'kind' && value && typeof value === 'object') check.fail(`${path}.${key}`, `must be plain text or a name, not ${Array.isArray(value) ? 'a list' : 'an object'}: ${beyondGraphic('graphic')}`);
    if (key === 'kind' || KEYS[kind].includes(key)) continue;
    const others = GRAPHIC_KINDS.filter(k => KEYS[k].includes(key));
    check.fail(`${path}.${key}`, `is not supported (allowed: kind, ${KEYS[kind].join(', ')}): ${others.length ? `${key} belongs on a ${others.join(' or ')}` : `the list is closed, and ${beyondGraphic(key)}`}`);
  }
  if (!NEEDS[kind].some(key => raw[key] !== undefined)) check.fail(path, `a ${kind} needs ${NEEDS[kind].join(' or ')}`);
  if (kind === 'badge' && raw.icon !== undefined && raw.text !== undefined) check.fail(path, 'a badge shows an icon or text, not both');
  if (raw.icon !== undefined && !isIcon(raw.icon)) {
    let hint = '';
    try { iconPath(raw.icon); } catch (error) { hint = (/\(did you mean [^)]*\)/.exec(error.message) ?? [''])[0]; }
    check.fail(`${path}.icon`, `must be an icon name from kit/core/icons.mjs (${ICON_NAMES.length} names)${hint ? ` ${hint}` : ''}; got ${JSON.stringify(raw.icon)}`);
  }
  if (raw.prop !== undefined && !PROP_IDS.includes(raw.prop)) check.fail(`${path}.prop`, `must be a world-kit prop (${PROP_IDS.join(', ')}); got ${JSON.stringify(raw.prop)}`);
  if (raw.state !== undefined) {
    if (!PROP_STATES[raw.prop]) check.fail(`${path}.state`, `${raw.prop} has no states (props with states: ${Object.keys(PROP_STATES).join(', ')})`);
    check.oneOf(raw.state, `${path}.state`, PROP_STATES[raw.prop]);
  }
  for (const key of ['badge', 'text']) if (raw[key] !== undefined && String(raw[key]).length > SHORT) check.fail(`${path}.${key}`, `must be a string of 1–${SHORT} characters; ${beyondGraphic('value')}`);
  return {
    kind, icon: raw.icon ?? null,
    label: raw.label === undefined ? null : check.str(raw.label, `${path}.label`, labelMax),
    badge: raw.badge === undefined ? null : check.str(String(raw.badge), `${path}.badge`, SHORT),
    text: raw.text === undefined ? null : check.str(String(raw.text), `${path}.text`, SHORT),
    prop: raw.prop ?? null, state: raw.state ?? null
  };
}

// Widths are in label sizes (L), so a graphic scales with its type.
const ICON_IN_LINE = 1.1, GAP = 0.45;

/** The width a graphic needs for its label at size L (px): the label plus the shape's own padding. */
export function graphicWidth(spec, L) {
  const text = spec.label ? textWidth(spec.label, L, 'body') : 0;
  const lead = spec.icon ? (ICON_IN_LINE + GAP) * L : 0;
  if (spec.kind === 'card') return text + 1.25 * L;
  if (spec.kind === 'chip') return lead + text + 1.6 * L;
  if (spec.kind === 'ribbon') return lead + text + 2.6 * L;
  return text;
}

/** The largest label size ≤ preferred whose graphic fits `width`; fails under `min`. */
export function fitGraphic(check, path, spec, width, {preferred, min}) {
  const need = graphicWidth(spec, 1);
  const size = r2(Math.min(preferred, need > 0 ? width / need : preferred));
  if (size < min) check.fail(spec.label ? `${path}.label` : path, `does not fit ${r2(width)}px at ${r2(min)}px type; shorten it`);
  return size;
}

/** The height a card needs for an icon of I px and a label of L px (the node-graph card's proportions). */
export const cardHeight = (I, L) => r2(I * (1 + 72 / 66) + L * 1.25);

/**
 * View nodes for a graphic in a width × height box at (0, 0).
 * look: {color (the member's colour), ink (text on that colour), fg, panel,
 * fonts, unit, icon (px), labelSize (px), colors (brand: bg, primary, accent,
 * ink, paper; for props), key (a unique id prefix for prop gradients),
 * over (nodes laid over the face, under the icon: a module's lit rim)}.
 */
export function graphicNodes(spec, width, height, look) {
  const {color, ink, fg, panel, fonts, unit: u, icon: I, labelSize: L, over = []} = look;
  const W = width, H = height;
  const text = (y, value, colorOf, weight = 700) => label(null, 0, r2(y), W, value, {size: L, family: fonts.body, color: colorOf, align: 'center', weight, lineHeight: 1.25});
  if (spec.kind === 'card') {
    const face = el('div', null, {...abs(0, 0, W, H), boxSizing: 'border-box', borderRadius: r2(24 * u), background: `linear-gradient(165deg, ${mixColor(color, panel, 0.16)}, ${panel} 70%)`,
      border: `${r2(2.5 * u)}px solid ${hex2(color, 0.7)}`, boxShadow: `0 ${r2(14 * u)}px ${r2(34 * u)}px ${hex2('#000000', 0.45)}, 0 0 ${r2(22 * u)}px ${hex2(color, 0.25)}`});
    const kids = [face, ...over];
    if (spec.icon) kids.push(iconNode(spec.icon, {x: r2((W - I) / 2), y: spec.label ? r2(30 * I / 66) : r2((H - I) / 2), size: I, color, mode: 'duotone'}));
    if (spec.label) kids.push(text(spec.icon ? H - L * 1.25 - 24 * I / 66 : (H - L * 1.25) / 2, spec.label, fg));
    if (spec.badge) {
      const D = r2(Math.max(L * 1.3, I * 0.6));
      kids.push(el('div', null, {...abs(r2(W - D * 0.7), r2(-D * 0.3), D, D), boxSizing: 'border-box', borderRadius: '50%', background: color, border: `${r2(3 * u)}px solid ${panel}`, boxShadow: `0 0 ${r2(18 * u)}px ${hex2(color, 0.6)}`}, [
        label(null, 0, r2((D - D * 0.5 * 1.2) / 2), D, spec.badge, {size: r2(D * 0.5), family: fonts.body, color: ink, align: 'center', weight: 800})]));
    }
    return kids;
  }
  if (spec.kind === 'chip' || spec.kind === 'ribbon') {
    const ribbon = spec.kind === 'ribbon';
    const h = r2(L * 1.25 + L * (ribbon ? 0.9 : 0.75)), w = r2(Math.min(W, graphicWidth(spec, L))), x = r2((W - w) / 2), y = r2((H - h) / 2);
    const lead = spec.icon ? (ICON_IN_LINE + GAP) * L : 0, s = r2(ICON_IN_LINE * L);
    const tx = r2(x + (w - lead - textWidth(spec.label, L, 'body')) / 2);
    const on = ribbon ? ink : fg;
    const kids = [];
    if (ribbon) {
      const n = r2(h * 0.35);
      kids.push(el('svg', null, {...abs(x, y, w, h), overflow: 'visible', filter: `drop-shadow(0 ${r2(8 * u)}px ${r2(16 * u)}px ${hex2('#000000', 0.4)})`}, [
        el('path', null, null, [], {d: `M0 0 H${w} L${r2(w - n)} ${r2(h / 2)} L${w} ${h} H0 L${n} ${r2(h / 2)} Z`, fill: color}),
        el('path', null, null, [], {d: `M${n} ${r2(h * 0.12)} H${r2(w - n)}`, stroke: mixColor(color, '#ffffff', 0.35), strokeWidth: r2(2 * u), strokeLinecap: 'round'})
      ], {width: w, height: h, viewBox: `0 0 ${w} ${h}`, fill: 'none'}));
    } else {
      kids.push(el('div', null, {...abs(x, y, w, h), boxSizing: 'border-box', borderRadius: 999, background: mixColor(color, panel, 0.2), border: `${r2(2.5 * u)}px solid ${hex2(color, 0.8)}`, boxShadow: `0 0 ${r2(18 * u)}px ${hex2(color, 0.3)}`}));
    }
    if (spec.icon) kids.push(iconNode(spec.icon, {x: tx, y: r2(y + (h - s) / 2), size: s, color: ribbon ? ink : color}));
    kids.push(label(null, r2(tx + lead), r2(y + (h - L * 1.25) / 2), r2(textWidth(spec.label, L, 'body') + L), spec.label, {size: L, family: fonts.body, color: on, weight: 700, lineHeight: 1.25}));
    return kids;
  }
  const room = spec.label ? r2(L * 1.25 + 12 * u) : 0;
  const kids = [];
  if (spec.kind === 'badge') {
    const D = r2(Math.min(W, H - room)), x = r2((W - D) / 2);
    kids.push(el('div', null, {...abs(x, 0, D, D), boxSizing: 'border-box', borderRadius: '50%', background: `radial-gradient(circle at 50% 35%, ${mixColor(color, '#ffffff', 0.25)}, ${color} 70%)`,
      border: `${r2(4 * u)}px solid ${mixColor(color, '#ffffff', 0.4)}`, boxShadow: `0 0 ${r2(30 * u)}px ${hex2(color, 0.55)}`}));
    if (spec.icon) kids.push(iconNode(spec.icon, {x: r2(x + D * 0.25), y: r2(D * 0.25), size: r2(D * 0.5), color: ink}));
    else kids.push(label(null, x, r2((D - D * 0.42 * 1.2) / 2), D, spec.text, {size: r2(D * 0.42), family: fonts.body, color: ink, align: 'center', weight: 800}));
  } else {
    const drawn = drawProp({id: spec.prop, state: spec.state ?? undefined, colors: look.colors, box: {x: 0, y: 0, width: W, height: H - room}, canvas: look.canvas ?? {width: 1080, height: 1920}, key: look.key ?? 'graphic'});
    kids.push(el('svg', null, {...abs(0, 0, W, H - room), overflow: 'visible'}, [...(drawn.defs.length ? [el('defs', null, null, drawn.defs)] : []), ...drawn.nodes],
      {width: W, height: r2(H - room), viewBox: `0 0 ${W} ${r2(H - room)}`, fill: 'none'}));
  }
  // A badge or prop has no face behind its label, so the label sits on a plate of the panel (a wire under it stays hidden).
  if (spec.label) {
    const w = r2(Math.min(W, textWidth(spec.label, L, 'body') + L * 1.2));
    kids.push(el('div', null, {...abs(r2((W - w) / 2), r2(H - L * 1.45), w, r2(L * 1.45)), borderRadius: 999, background: hex2(panel, 0.88)}), text(H - L * 1.325, spec.label, fg));
  }
  return kids;
}

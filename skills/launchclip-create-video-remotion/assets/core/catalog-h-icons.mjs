// Catalogue H icon-grid: 2–12 icons (with optional labels) that pop in on a
// stagger, in the icon set's two styles (stroke and duotone) or on tinted
// tiles. Registered in kit/core/catalog-h.mjs.

import {timingRules} from './catalog-b-base.mjs';
import {VARIANT_PARAM, createHBase, fitText, mixColor, r2, rt, toneColor} from './catalog-h-base.mjs';
import {chromeNodes, chromeOps, el, label, popOps} from './catalog-h-view.mjs';
import {iconNode, isIcon} from './icons.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';
const GRID_VARIANTS = Object.freeze(['stroke', 'duotone', 'tiles']);

function gridResolve(params, ctx) {
  const b = createHBase('icon-grid', params, ctx, {allowed: ['items', 'title', 'source', 'at', 'tone', 'columns'], required: ['items'], variants: GRID_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  check.arr(p.items, 'params.items', 2, 12);
  const items = p.items.map((item, i) => {
    const raw = typeof item === 'string' ? {icon: item} : check.obj(item, `params.items[${i}]`, ['icon', 'label'], ['icon']);
    if (!isIcon(raw.icon)) check.fail(`params.items[${i}].icon`, `must be an icon name from kit/core/icons.mjs (got ${JSON.stringify(raw.icon)})`);
    return {icon: raw.icon, label: raw.label === undefined ? null : check.str(raw.label, `params.items[${i}].label`, 22)};
  });
  const color = toneColor(b, p.tone, 'params.tone');
  const n = items.length;
  const cols = p.columns === undefined ? (b.portrait ? (n <= 4 ? 2 : 3) : Math.min(n <= 4 ? n : Math.ceil(n / 2), 6)) : check.int(p.columns, 'params.columns', 1, 6);
  const rows = Math.ceil(n / cols);
  const W = rect.width;
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 60);
  const titleFit = title ? fitText(check, 'params.title', title, {family: 'body', width: W, preferred: u(60), min: b.min.key, maxLines: 2}) : null;
  const top = titleFit ? r2(titleFit.size * 1.15 * titleFit.lines + u(40)) : 0;
  const labels = items.some(item => item.label);
  const cellW = W / cols;
  const labelSize = labels ? Math.min(...items.filter(item => item.label).map((item, i) => fitText(check, `params.items[${i}].label`, item.label, {family: 'body', width: cellW - u(16), preferred: u(36), min: b.min.meta, maxLines: 2}).size)) : 0;
  const cellH = Math.min((rect.height - top) / rows, cellW * (labels ? 1.15 : 0.9));
  // A tile is 1.5× its icon, so tiles size the icon to leave the label its room.
  const box = b.variant === 'tiles' ? 1.5 : 1;
  const iconSize = r2(Math.min(cellW * 0.5, cellH - (labels ? labelSize * 2.5 + u(20) : u(20)), u(200)) / box);
  if (iconSize < u(48)) check.fail('params.items', 'has too many icons for the rect; use fewer or set columns');
  const gridH = cellH * rows;
  const y0 = r2(top + (rect.height - top - gridH) / 2);
  const t0 = b.timeOf('build', p.at, 'params.at', 0.5);
  b.events.push({id: `${b.id}-build`, name: 'build', time: t0, endTime: rt(t0 + 0.12 * n + 0.4), role: 'emphasis', cue: 'pop'});
  const cells = items.map((item, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    // The last row centres when it is short.
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const x = r2((W - inRow * cellW) / 2 + col * cellW);
    return {...item, x, y: r2(y0 + row * cellH), time: rt(t0 + i * Math.min(0.12, 1.2 / n))};
  });
  const content = {variant: b.variant, title: titleFit ? {text: title, size: titleFit.size, lines: titleFit.lines} : null, source: null, align: 'center', cells, cellW: r2(cellW), cellH: r2(cellH), iconSize, labelSize, color,
    tile: mixColor(color, b.colors.bg, 0.16), ink: b.theme.foreground, buildAt: t0};
  return b.finish(content, {minTextPx: titleFit ? titleFit.size : b.min.key});
}

function gridView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const kids = chromeNodes(model);
  c.cells.forEach((cell, i) => {
    const tile = c.variant === 'tiles';
    const box = tile ? r2(c.iconSize * 1.5) : c.iconSize;
    const bx = r2((c.cellW - box) / 2);
    const inner = [];
    if (tile) inner.push(el('div', null, {position: 'absolute', left: bx, top: 0, width: box, height: box, borderRadius: r2(box * 0.28), background: c.tile}));
    inner.push(iconNode(cell.icon, {x: r2((c.cellW - c.iconSize * (tile ? 0.62 : 1)) / 2), y: r2(tile ? box * 0.19 : 0), size: r2(c.iconSize * (tile ? 0.62 : 1)), color: c.color, mode: c.variant === 'duotone' ? 'duotone' : 'stroke'}));
    if (cell.label) inner.push(label(null, r2(8 * u), r2(box + 18 * u), r2(c.cellW - 16 * u), cell.label, {size: c.labelSize, family: fonts.body, color: c.ink, align: 'center', weight: 600, wrap: true}));
    kids.push(el('div', `${id}-cell-${i}`, {position: 'absolute', left: cell.x, top: cell.y, width: c.cellW, height: c.cellH, opacity: 0, transformOrigin: `50% ${r2(box / 2)}px`}, inner));
  });
  return kids;
}

function gridTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  chromeOps(model, ops);
  c.cells.forEach((cell, i) => popOps(ops, `${id}-cell-${i}`, start, cell.time, {from: 0.5, duration: 0.5, ease: 'back.out(2)'}));
}

export const iconGrid = {
  id: 'icon-grid',
  describe: 'A grid of 2–12 icons from the icon set (1,935: LaunchClip\'s own and Lucide\'s) that pop in on a stagger, with optional labels: stroke icons, duotone icons, or icons on tinted tiles.',
  params: {items: '[icon name | {icon, label? ≤ 22}] 2–12', title: 'string ≤ 60 (optional)', columns: 'integer 1–6 (default by count and aspect)', tone: 'primary | accent | paper | #rrggbb', at: `build start: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['build'], timing: timingRules({rules: ['icons pop 0.12 s apart (closer for many) from at']}), variants: GRID_VARIANTS,
  resolve: gridResolve, view: gridView, timeline: gridTimeline
};

export const ICON_MODULES = [iconGrid];

// Catalogue G sequence cards: compare and timeline (docs/VIDEO_QUALITY_RFC.md
// §8). Same shape and layout approach as catalog-g-cards.mjs.

import {fitText, r2, rt} from './catalog-b-base.mjs';
import {abs, el, set, tw} from './catalog-b-view.mjs';
import {CARD_PARAMS, cardTiming, createCardBase, flow, flowText, iconParam, pick, pop, rise} from './catalog-g-base.mjs';
import {iconNode} from './icons.mjs';

const hidden = {opacity: 0};

// ---------------------------------------------------------------------------
// compare: before and after, or two columns.

function side(check, value, path) {
  check.obj(value, path, ['title', 'items', 'icon'], ['title', 'items']);
  check.arr(value.items, `${path}.items`, 1, 4);
  return {title: check.str(value.title, `${path}.title`, 24), items: value.items.map((item, i) => check.str(item, `${path}.items[${i}]`, 40)), icon: iconParam(check, value.icon, `${path}.icon`)};
}

function resolveCompare(params, ctx) {
  const b = createCardBase('compare', params, ctx, {allowed: ['left', 'right', 'mode', 'stagger', 'at'], required: ['left', 'right']});
  const {check, u, portrait, theme, colors} = b;
  const p = b.params;
  const mode = p.mode === undefined ? 'before-after' : check.oneOf(p.mode, 'params.mode', ['before-after', 'columns']);
  const sides = [side(check, p.left, 'params.left'), side(check, p.right, 'params.right')];
  const stagger = p.stagger === undefined ? 0.16 : check.num(p.stagger, 'params.stagger', 0.05, 0.6);
  const measureSide = (s, i, width, k) => {
    const mark = u(40 * Math.max(0.8, Math.min(1.2, k))), markGap = u(16);
    const head = fitText(check, `params.${i ? 'right' : 'left'}.title`, s.title, {family: 'display', width: width - (s.icon ? u(64) : 0), preferred: u(64 * k), min: b.min.key, maxLines: 1});
    const items = s.items.map((item, j) => fitText(check, `params.${i ? 'right' : 'left'}.items[${j}]`, item, {family: 'body', width: width - mark - markGap, preferred: u(44 * Math.max(1, k * 0.9)), min: b.min.key, maxLines: 2}));
    const size = Math.min(...items.map(f => f.size));
    const rows = items.map(f => r2(Math.max(mark, f.lines * size * 1.2)));
    const gap = u(18 * k), headGap = u(22 * k);
    return {head, size, rows, gap, headGap, mark, markGap, height: r2(head.size * 1.1 + headGap + rows.reduce((a, r) => a + r, 0) + gap * (rows.length - 1))};
  };
  const variant = (width, k, layout) => {
    const pad = u(28 * Math.min(1, k)), between = u((layout === 'columns' ? 64 : 48) * Math.min(1, k));
    const colW = layout === 'columns' ? r2((width - between) / 2) : width;
    const inner = colW - pad * 2;
    const parts = sides.map((s, i) => measureSide(s, i, inner, k));
    const panelH = layout === 'columns' ? r2(Math.max(...parts.map(part => part.height)) + pad * 2) : null;
    const heights = parts.map(part => panelH ?? r2(part.height + pad * 2));
    return {layout, pad, between, colW, inner: r2(inner), parts, heights, height: r2(layout === 'columns' ? heights[0] : heights[0] + between + heights[1])};
  };
  const measure = (width, maxHeight) => pick([...b.scales.map(k => () => variant(width, k, 'columns')), ...b.scales.map(k => () => variant(width, k, 'stacked'))], maxHeight);
  const box = b.place(measure, {maxWidth: u(portrait ? 940 : 1500)});
  const L = box.layout;
  const leftAt = b.timeOf('left', p.at, 'params.at', 0.5);
  const rightAt = b.timeOf('right', undefined, 'params.at', Math.min(leftAt - b.start + 0.25 + stagger * sides[0].items.length, b.lastEvent));
  const placed = sides.map((s, i) => ({...s, index: i, time: i ? rightAt : leftAt, items: s.items.map((text, j) => ({index: j, text, time: rt((i ? rightAt : leftAt) + 0.2 + j * stagger)}))}));
  b.events.push({id: `${b.id}-left`, name: 'left', time: leftAt, endTime: rt(leftAt + 0.5), role: 'title'});
  b.events.push({id: `${b.id}-right`, name: 'right', time: rightAt, endTime: rt(rightAt + 0.5), role: 'emphasis', cue: 'whoosh'});
  const after_ = mode === 'before-after';
  const tones = [{mark: after_ ? 'x' : null, color: after_ ? theme.muted : colors.primary, border: theme.border}, {mark: after_ ? 'check' : null, color: colors.primary, border: after_ ? colors.primary : theme.border}];
  return b.finish({box: {x: box.x, y: box.y, width: box.width}, layout: L, mode, sides: placed, tones, panel: theme.panel, textColor: theme.foreground, mutedText: theme.muted, arrow: colors.primary, leftAt, rightAt},
    {minTextPx: Math.min(...L.parts.flatMap(part => [part.size, part.head.size]))});
}

function compareView(model) {
  const {id, fonts, unit} = model;
  const c = model.content, L = c.layout, B = c.box;
  const panels = c.sides.map((s, i) => {
    const part = L.parts[i], tone = c.tones[i];
    const before = c.mode === 'before-after' && i === 0;
    const items = s.items.map((item, j) => flow(`${id}-item-${i}-${j}`, L.inner, part.rows[j], {...hidden, display: 'flex', alignItems: 'center', gap: part.markGap, marginTop: j ? part.gap : 0}, [
      flow(null, part.mark, part.mark, {}, [tone.mark ? iconNode(tone.mark, {size: part.mark, color: tone.color, stroke: 2.4}) : el('div', null, abs(r2(part.mark * 0.35), r2(part.mark * 0.35), r2(part.mark * 0.3), r2(part.mark * 0.3), {borderRadius: '50%', background: tone.color}))]),
      flowText(null, r2(L.inner - part.mark - part.markGap), {fontFamily: fonts.body, fontWeight: 500, fontSize: part.size, lineHeight: '1.2', color: before ? c.mutedText : c.textColor}, item.text)
    ]));
    const title = flow(null, L.inner, undefined, {display: 'flex', alignItems: 'center', gap: r2(16 * unit), marginBottom: part.headGap}, [
      s.icon ? flow(null, r2(48 * unit), r2(48 * unit), {}, [iconNode(s.icon, {size: r2(48 * unit), color: tone.color})]) : null,
      flowText(null, r2(L.inner - (s.icon ? 64 * unit : 0)), {fontFamily: fonts.display, fontSize: part.head.size, lineHeight: '1.1', color: before ? c.mutedText : c.textColor, whiteSpace: 'nowrap'}, s.title)
    ].filter(Boolean));
    return flow(`${id}-side-${i}`, L.colW, L.heights[i], {...hidden, boxSizing: 'border-box', padding: L.pad, borderRadius: r2(28 * unit), background: c.panel, border: `${r2((i && c.mode === 'before-after' ? 3 : 2) * unit)}px solid ${tone.border}`,
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', transformOrigin: '50% 50%'}, [title, ...items]);
  });
  // The arrow between the panels, turned down when they stack.
  const arrowSize = r2(Math.min(L.between - 8 * unit, 56 * unit));
  const columns = L.layout === 'columns';
  const arrow = c.mode === 'before-after' ? el('div', `${id}-arrow`, abs(0, 0, arrowSize, arrowSize, {...hidden, position: 'relative', flex: 'none', margin: columns ? `0 ${r2((L.between - arrowSize) / 2)}px` : `${r2((L.between - arrowSize) / 2)}px 0`}),
    [iconNode(columns ? 'arrow-right' : 'arrow-down', {size: arrowSize, color: c.arrow, stroke: 2.6})]) : null;
  const gap = c.mode === 'before-after' ? 0 : L.between;
  const group = el('div', null, abs(B.x, B.y, B.width, L.height, {display: 'flex', flexDirection: columns ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', gap}),
    arrow ? [panels[0], arrow, panels[1]] : panels);
  return [group];
}

function compareTimeline(model, ops) {
  const {id} = model;
  const c = model.content;
  for (const s of c.sides) {
    rise(ops, model, `${id}-side-${s.index}`, s.time, {distance: 30, duration: 0.5});
    for (const item of s.items) rise(ops, model, `${id}-item-${s.index}-${item.index}`, item.time, {distance: 12, duration: 0.35});
  }
  if (c.mode === 'before-after') pop(ops, model, `${id}-arrow`, rt(c.rightAt - 0.15), {scale: 0.4});
}

export const compare = {
  id: 'compare',
  describe: 'A comparison in two panels: before and after (the old way with crosses, an arrow, the new way with ticks on a primary-edged panel) or two neutral columns. Side by side when it fits, else stacked. For a claim that contrasts two ways, tools or states.',
  params: {left: '{title ≤ 24, items: [≤ 40] 1–4, icon?}', right: '{title ≤ 24, items: [≤ 40] 1–4, icon?}', mode: 'before-after (default) | columns', stagger: 'seconds between items (default 0.16)', at: 'left panel time', ...CARD_PARAMS},
  events: ['left', 'right'],
  timing: cardTiming(['the right panel lands 0.25 s plus stagger × left items after the left (or on a right hit)']),
  mood: ['editorial', 'launch'],
  resolve: resolveCompare, view: compareView, timeline: compareTimeline
};

// ---------------------------------------------------------------------------
// timeline: steps along a line that build on their words.

function resolveTimeline(params, ctx) {
  const b = createCardBase('timeline', params, ctx, {allowed: ['steps', 'title', 'direction', 'stagger', 'at'], required: ['steps']});
  const {check, u, portrait, theme, colors, start, id} = b;
  const p = b.params;
  check.arr(p.steps, 'params.steps', 2, 6);
  const steps = p.steps.map((raw, i) => {
    const entry = check.obj(raw, `params.steps[${i}]`, ['label', 'detail', 'icon', 'at'], ['label']);
    return {index: i, label: check.str(entry.label, `params.steps[${i}].label`, 28), detail: entry.detail === undefined ? null : check.str(entry.detail, `params.steps[${i}].detail`, 40), icon: iconParam(check, entry.icon, `params.steps[${i}].icon`), at: entry.at};
  });
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 48);
  const directionIn = p.direction === undefined ? 'auto' : check.oneOf(p.direction, 'params.direction', ['auto', 'vertical', 'horizontal']);
  const stagger = p.stagger === undefined ? 0.45 : check.num(p.stagger, 'params.stagger', 0.1, 2);
  const n = steps.length;
  const fitTitle = (width, k) => (title ? fitText(check, 'params.title', title, {family: 'body', width, preferred: u(52 * Math.max(1, k * 0.9)), min: b.min.key, maxLines: 2}) : null);
  const labelFit = (step, width, k) => fitText(check, `params.steps[${step.index}].label`, step.label, {family: 'body', width, preferred: u(48 * Math.max(1, k * 0.9)), min: b.min.key, maxLines: 2});
  const detailFit = (step, width, k) => (step.detail ? fitText(check, `params.steps[${step.index}].detail`, step.detail, {family: 'body', width, preferred: u(34 * Math.max(1, k * 0.9)), min: b.min.meta, maxLines: 2}) : null);
  const vertical = (width, k) => {
    const t = fitTitle(width, k), titleH = t ? r2(t.lines * t.size * 1.15 + u(30 * k)) : 0;
    const node = u(76 * Math.min(1.3, k)), textX = r2(node + u(28)), textW = r2(width - textX);
    const labels = steps.map(step => labelFit(step, textW, k)), details = steps.map(step => detailFit(step, textW, k));
    const size = Math.min(...labels.map(f => f.size)), dsize = details.some(Boolean) ? Math.min(...details.filter(Boolean).map(f => f.size)) : 0;
    const rows = steps.map((_, i) => r2(Math.max(node, labels[i].lines * size * 1.2 + (details[i] ? u(6) + details[i].lines * dsize * 1.25 : 0))));
    const gap = u(30 * k);
    return {direction: 'vertical', title: t, titleH, node, textX, textW, size, dsize, rows, gap, height: r2(titleH + rows.reduce((a, r) => a + r, 0) + gap * (n - 1))};
  };
  const horizontal = (width, k) => {
    const t = fitTitle(width, k), titleH = t ? r2(t.lines * t.size * 1.15 + u(34 * k)) : 0;
    const cell = r2(width / n), node = r2(Math.min(u(84 * Math.min(1.3, k)), cell * 0.6));
    const labels = steps.map(step => labelFit(step, cell - u(16), k)), details = steps.map(step => detailFit(step, cell - u(16), k));
    const size = Math.min(...labels.map(f => f.size)), dsize = details.some(Boolean) ? Math.min(...details.filter(Boolean).map(f => f.size)) : 0;
    const textH = Math.max(...steps.map((_, i) => labels[i].lines * size * 1.2 + (details[i] ? u(6) + details[i].lines * dsize * 1.25 : 0)));
    return {direction: 'horizontal', title: t, titleH, node, cell, size, dsize, labelGap: u(22), height: r2(titleH + node + u(22) + textH)};
  };
  const measure = (width, maxHeight) => {
    const quiet = f => () => { try { return f(); } catch { return null; } };
    const h = b.scales.map(k => quiet(() => horizontal(width, k))), v = b.scales.map(k => () => vertical(width, k));
    const order = directionIn === 'vertical' ? v : directionIn === 'horizontal' ? b.scales.map(k => () => horizontal(width, k)) : portrait ? v : [...h, ...v];
    return pick(order, maxHeight);
  };
  // A vertical list reads as one block nearer the middle of a 9:16 frame.
  const box = b.place(measure, {maxWidth: u(portrait && directionIn !== 'horizontal' ? 760 : portrait ? 900 : 1600)});
  const L = box.layout;
  const first = b.timeOf('step-0', p.at, 'params.at', 0.55);
  const placed = steps.map(step => {
    const time = step.at === undefined ? b.timeOf(`step-${step.index}`, undefined, `params.steps[${step.index}].at`, Math.min(first - start + step.index * stagger, b.lastEvent)) : b.timeOf(`step-${step.index}`, step.at, `params.steps[${step.index}].at`, 0);
    b.events.push({id: `${id}-step-${step.index}`, name: `step-${step.index}`, time, endTime: rt(time + 0.45), role: 'emphasis', cue: 'pop-soft'});
    return {...step, time};
  });
  for (let i = 1; i < placed.length; i++) if (placed[i].time < placed[i - 1].time) check.fail(`params.steps[${i}].at`, 'must not come before the step above it');
  // Node centres along the line (rect-local, in the content box).
  const B = {x: box.x, y: box.y, width: box.width};
  const centres = [];
  if (L.direction === 'vertical') {
    let y = B.y + L.titleH;
    for (const h of L.rows) { centres.push({x: r2(B.x + L.node / 2), y: r2(y + Math.min(h, L.node) / 2)}); y += h + L.gap; }
  } else {
    for (let i = 0; i < n; i++) centres.push({x: r2(B.x + L.cell * (i + 0.5)), y: r2(B.y + L.titleH + L.node / 2)});
  }
  return b.finish({box: B, layout: L, title, steps: placed, centres, line: theme.border, progress: colors.primary, nodeFill: theme.surface, nodeText: colors.primary, labelColor: theme.foreground, detailColor: theme.muted, titleColor: theme.muted},
    {minTextPx: L.size});
}

function timelineView(model) {
  const {id, fonts, unit} = model;
  const c = model.content, L = c.layout, B = c.box;
  const kids = [];
  const vertical = L.direction === 'vertical';
  if (c.title) kids.push(el('div', null, abs(B.x, B.y, B.width, undefined, {margin: 0, whiteSpace: 'normal', fontFamily: fonts.body, fontWeight: 600, fontSize: L.title.size, lineHeight: '1.15', color: c.titleColor, textAlign: vertical ? 'left' : 'center'}), [c.title]));
  const a = c.centres[0], z = c.centres.at(-1);
  const thick = r2(6 * unit);
  // The track, then the progress line over it (scaled along from its start).
  const track = vertical ? abs(r2(a.x - thick / 2), a.y, thick, r2(z.y - a.y)) : abs(a.x, r2(a.y - thick / 2), r2(z.x - a.x), thick);
  kids.push(el('div', null, {...track, borderRadius: thick, background: c.line}));
  kids.push(el('div', `${id}-progress`, {...track, borderRadius: thick, background: c.progress, transformOrigin: vertical ? '50% 0%' : '0% 50%', transform: vertical ? 'scale(1, 0)' : 'scale(0, 1)'}));
  c.steps.forEach((step, i) => {
    const centre = c.centres[i], node = L.node;
    const nodeKids = step.icon
      ? [iconNode(step.icon, {x: r2(node * 0.22), y: r2(node * 0.22), size: r2(node * 0.56), color: c.nodeText})]
      : [el('div', null, abs(0, 0, node, node, {display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.display, fontSize: r2(node * 0.46), lineHeight: '1', color: c.nodeText}), [String(i + 1)])];
    kids.push(el('div', `${id}-node-${i}`, abs(r2(centre.x - node / 2), r2(centre.y - node / 2), node, node, {...hidden, boxSizing: 'border-box', borderRadius: '50%', background: c.nodeFill, border: `${r2(4 * unit)}px solid ${c.progress}`, transformOrigin: '50% 50%'}), nodeKids));
    const label = {fontFamily: fonts.body, fontWeight: 600, fontSize: L.size, lineHeight: '1.2', color: c.labelColor};
    const detail = {fontFamily: fonts.body, fontWeight: 400, fontSize: L.dsize, lineHeight: '1.25', color: c.detailColor, marginTop: r2(6 * unit)};
    const text = vertical
      ? el('div', `${id}-text-${i}`, abs(r2(B.x + L.textX), r2(centre.y - Math.min(L.rows[i], node) / 2), L.textW, L.rows[i], {...hidden, display: 'flex', flexDirection: 'column', justifyContent: L.rows[i] > node ? 'flex-start' : 'center'}), [
        flowText(null, L.textW, label, step.label), step.detail ? flowText(null, L.textW, detail, step.detail) : null].filter(Boolean))
      : el('div', `${id}-text-${i}`, abs(r2(centre.x - L.cell / 2 + 8 * unit), r2(centre.y + node / 2 + L.labelGap), r2(L.cell - 16 * unit), undefined, {...hidden, display: 'flex', flexDirection: 'column', alignItems: 'center'}), [
        flowText(null, r2(L.cell - 16 * unit), {...label, textAlign: 'center'}, step.label), step.detail ? flowText(null, r2(L.cell - 16 * unit), {...detail, textAlign: 'center'}, step.detail) : null].filter(Boolean));
    kids.push(text);
  });
  return kids;
}

function timelineTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content, L = c.layout;
  const vertical = L.direction === 'vertical';
  const a = c.centres[0], z = c.centres.at(-1);
  const span = vertical ? z.y - a.y : z.x - a.x;
  const fraction = i => r2((vertical ? c.centres[i].y - a.y : c.centres[i].x - a.x) / span * 1000) / 1000;
  const axis = vertical ? 'scaleY' : 'scaleX', other = vertical ? 'scaleX' : 'scaleY';
  set(ops, `${id}-progress`, start, {[axis]: 0, [other]: 1});
  c.steps.forEach((step, i) => {
    pop(ops, model, `${id}-node-${i}`, step.time, {scale: 0.4});
    rise(ops, model, `${id}-text-${i}`, rt(step.time + 0.08), {distance: 14, duration: 0.4});
    // The line runs on to the node as each step lands.
    if (i > 0) tw(ops, `${id}-progress`, rt(Math.max(c.steps[i - 1].time, step.time - 0.35)), 0.35, 'power2.inOut', {[axis]: fraction(i - 1)}, {[axis]: fraction(i)});
  });
}

export const timeline = {
  id: 'timeline',
  describe: 'Two to six steps along a line: numbered (or icon) nodes that pop as each step is said while a primary line runs on to them, with a label and optional detail. Vertical in 9:16, across in 16:9 when the labels fit. For a process, a history or a roadmap.',
  params: {steps: '[{label ≤ 28, detail? ≤ 40, icon?, at?}] 2–6', title: 'string ≤ 48 (optional)', direction: 'auto (default) | vertical | horizontal', stagger: 'seconds between steps (default 0.45)', at: 'first step time', ...CARD_PARAMS},
  events: ['step-<i>'],
  timing: cardTiming(['steps land in order; with no at, the first lands at 0.55 s and the rest follow by stagger (default 0.45 s)']),
  mood: ['editorial', 'launch'],
  resolve: resolveTimeline, view: timelineView, timeline: timelineTimeline
};

// Catalogue G sequence cards: compare and timeline (docs/VIDEO_QUALITY_RFC.md
// §8). Same shape and layout approach as catalog-g-cards.mjs.

import {fitText, r2, rt} from './catalog-b-base.mjs';
import {abs, el, set, tw} from './catalog-b-view.mjs';
import {CARD_PARAMS, cardTiming, column, createCardBase, flow, flowText, iconParam, pick, pop, rise, solidFill, spread, tintBehind} from './catalog-g-base.mjs';
import {iconNode} from './icons.mjs';

const hidden = {opacity: 0};

// ---------------------------------------------------------------------------
// compare: before and after, or two columns.

function side(check, value, path) {
  check.obj(value, path, ['title', 'items', 'icon'], ['title', 'items']);
  check.arr(value.items, `${path}.items`, 1, 4);
  return {title: check.str(value.title, `${path}.title`, 24), items: value.items.map((item, i) => check.str(item, `${path}.items[${i}]`, 40)), icon: iconParam(check, value.icon, `${path}.icon`)};
}

// Variants: panels (two panels with an arrow between, the original), split
// (the frame halved by a divider with an arrow or VS disc, each half tinted,
// the halves sliding in from their sides), table (a header row of the two
// titles over aligned rows that reveal pair by pair) and cards (each item on
// its own card, dealt in; the before side dashed and muted, the after side
// edged in primary).
export const COMPARE_VARIANTS = Object.freeze(['panels', 'split', 'table', 'cards']);

function resolveCompare(params, ctx) {
  const b = createCardBase('compare', params, ctx, {allowed: ['left', 'right', 'mode', 'stagger', 'at'], required: ['left', 'right'], variants: COMPARE_VARIANTS});
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
  const sideKey = i => `params.${i ? 'right' : 'left'}`;
  const fitItems = (s_, i, width, k, maxLines = 2) => s_.items.map((item, j) => fitText(check, `${sideKey(i)}.items[${j}]`, item, {family: 'body', width, preferred: Math.max(b.min.key, u(44 * Math.max(1, k * 0.9))), min: b.min.key, maxLines}));
  const fitHead = (s_, i, width, k, preferred = 64) => fitText(check, `${sideKey(i)}.title`, s_.title, {family: 'display', width, preferred: Math.max(b.min.key, u(preferred * k)), min: b.min.key, maxLines: 1});
  // split: two tinted halves, across in 16:9 and over each other in 9:16.
  const split = (width, k) => {
    const across = !portrait, disc = u(96 * Math.min(1.2, k)), pad = u(40 * Math.min(1.2, k)), half = across ? r2((width - disc * 0.5) / 2) : width;
    const inner = r2(half - pad * 2 - (across ? disc * 0.25 : 0));
    const parts = sides.map((s_, i) => {
      const mark = u(40 * Math.max(0.8, Math.min(1.2, k))), markGap = u(16);
      const head = fitHead(s_, i, inner - (s_.icon ? u(64) : 0), k, 76), items = fitItems(s_, i, inner - mark - markGap, k);
      const size = Math.min(...items.map(f => f.size)), rows = items.map(f => r2(Math.max(mark, f.lines * size * 1.2)));
      const gap = u(18 * k), headGap = u(26 * k);
      return {head, size, rows, gap, headGap, mark, markGap, height: r2(head.size * 1.1 + headGap + rows.reduce((a_, r_) => a_ + r_, 0) + gap * (rows.length - 1))};
    });
    // Over each other, each half keeps clear of the disc on the seam.
    const seam = across ? 0 : r2(disc * 0.5);
    const halfH = r2(Math.max(...parts.map(part => part.height)) + pad * 2 + seam);
    return {mode: 'split', across, disc, pad, seam, half, inner, parts, halfH, height: across ? halfH : r2(halfH * 2)};
  };
  // table: a header row and aligned rows, a column per side.
  const table = (width, k) => {
    const pad = u(24 * Math.min(1.2, k)), colW = r2(width / 2), inner = r2(colW - pad * 2);
    const mark = u(36 * Math.max(0.8, Math.min(1.2, k))), markGap = u(14);
    const heads = sides.map((s_, i) => fitHead(s_, i, inner - (s_.icon ? u(60) : 0), k, 58));
    const items = sides.map((s_, i) => fitItems(s_, i, r2(inner - mark - markGap), k, 3));
    const size = Math.min(...items.flat().map(f => f.size));
    const n = Math.max(...sides.map(s_ => s_.items.length));
    const rows = Array.from({length: n}, (_, j) => r2(Math.max(mark, ...items.map(list => (list[j] ? list[j].lines * size * 1.2 : 0))) + pad * 2));
    const headH = r2(Math.max(...heads.map(h => h.size)) * 1.1 + pad * 2);
    return {mode: 'table', pad, colW, inner, mark, markGap, heads, size, rows, headH, rule: u(2), height: r2(headH + rows.reduce((a_, r_) => a_ + r_, 0) + u(2) * (n + 1))};
  };
  // cards: a title pill per side over a card per item; two columns in 16:9,
  // one after the other in 9:16.
  const cards = (width, k) => {
    const across = !portrait, gapX = u(48 * k), colW = across ? r2((width - gapX) / 2) : width, pad = u(24 * Math.min(1.2, k)), gap = u(14 * k);
    const mark = u(36 * Math.max(0.8, Math.min(1.2, k))), markGap = u(16), textW = r2(colW - pad * 2 - mark - markGap);
    const heads = sides.map((s_, i) => fitText(check, `${sideKey(i)}.title`, s_.title.toUpperCase(), {family: 'meta', width: r2(colW - u(80)), preferred: Math.max(b.min.meta, u(30 * k)), min: b.min.meta, maxLines: 1}));
    const items = sides.map((s_, i) => fitItems(s_, i, textW, k));
    const size = Math.min(...items.flat().map(f => f.size));
    const columns = items.map(list => list.map(f => r2(Math.max(mark, f.lines * size * 1.2) + pad * 2)));
    const pillH = r2(Math.max(...heads.map(h => h.size)) * 1.3 + u(18)), pillGap = u(20 * k), sideGap = u(40 * k);
    const colH = columns.map(list => r2(pillH + pillGap + list.reduce((a_, r_) => a_ + r_, 0) + gap * (list.length - 1)));
    return {mode: 'cards', across, gapX, colW, pad, gap, mark, markGap, textW, heads, size, columns, pillH, pillGap, sideGap, colH, height: across ? Math.max(...colH) : r2(colH[0] + sideGap + colH[1])};
  };
  const shaped = {split, table, cards}[b.variant];
  const measure = (width, maxHeight) => {
    const out = pick([...(shaped ? b.scales.map(k => () => shaped(width, k)) : []), ...b.scales.map(k => () => variant(width, k, 'columns')), ...b.scales.map(k => () => variant(width, k, 'stacked'))], maxHeight);
    return out?.layout === 'stacked' && b.fills ? spread(out, maxHeight, {between: [1, u(120)]}) : out;
  };
  const box = b.place(measure, {maxWidth: u(portrait ? 940 : 1500)});
  const L = box.layout;
  const leftAt = b.timeOf('left', p.at, 'params.at', 0.05);
  const rightAt = b.timeOf('right', undefined, 'params.at', Math.min(leftAt - b.start + 0.25 + stagger * sides[0].items.length, b.lastEvent));
  const placed = sides.map((s, i) => ({...s, index: i, time: i ? rightAt : leftAt, items: s.items.map((text, j) => ({index: j, text, time: rt((i ? rightAt : leftAt) + 0.2 + j * stagger)}))}));
  b.events.push({id: `${b.id}-left`, name: 'left', time: leftAt, endTime: rt(leftAt + 0.5), role: 'title'});
  b.events.push({id: `${b.id}-right`, name: 'right', time: rightAt, endTime: rt(rightAt + 0.5), role: 'emphasis', cue: 'whoosh'});
  const after_ = mode === 'before-after';
  const tones = [{mark: after_ ? 'x' : null, color: after_ ? theme.muted : colors.primary, border: theme.border}, {mark: after_ ? 'check' : null, color: colors.primary, border: after_ ? colors.primary : theme.border}];
  const content = {box: {x: box.x, y: box.y, width: box.width}, layout: L, mode, sides: placed, tones, panel: theme.panel, textColor: theme.foreground, mutedText: theme.muted, arrow: colors.primary, leftAt, rightAt};
  if (L.mode) Object.assign(content, {border: theme.border, bg: theme.bg, tint: tintBehind(b, 'primary', theme.foreground, {alpha: 0.18})});
  const sizes = L.mode === 'table' ? [L.size, ...L.heads.map(h => h.size)] : L.mode === 'cards' ? [L.size] : L.parts.flatMap(part => [part.size, part.head.size]);
  return b.finish(content, {minTextPx: Math.min(...sizes)});
}

const markNode = (tone, size) => (tone.mark ? iconNode(tone.mark, {size, color: tone.color, stroke: 2.4}) : el('div', null, abs(r2(size * 0.35), r2(size * 0.35), r2(size * 0.3), r2(size * 0.3), {borderRadius: '50%', background: tone.color})));

const COMPARE_VIEWS = {
  split(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const kids = c.sides.map((s_, i) => {
      const part = L.parts[i], tone = c.tones[i], before = c.mode === 'before-after' && i === 0;
      const x = L.across ? (i ? r2(B.width - L.half) : 0) : 0, y = L.across ? 0 : (i ? L.halfH : 0);
      const textX = L.across && i ? r2(L.pad + L.disc * 0.25) : L.pad;
      const items = s_.items.map((item, j) => flow(`${id}-item-${i}-${j}`, L.inner, part.rows[j], {...hidden, display: 'flex', alignItems: 'center', gap: part.markGap, marginTop: j ? part.gap : 0}, [
        flow(null, part.mark, part.mark, {}, [markNode(tone, part.mark)]),
        flowText(null, r2(L.inner - part.mark - part.markGap), {fontFamily: fonts.body, fontWeight: 500, fontSize: part.size, lineHeight: '1.2', color: before ? c.mutedText : c.textColor}, item.text)
      ]));
      const title = flow(null, L.inner, undefined, {display: 'flex', alignItems: 'center', gap: r2(16 * unit), marginBottom: part.headGap}, [
        s_.icon ? flow(null, r2(48 * unit), r2(48 * unit), {}, [iconNode(s_.icon, {size: r2(48 * unit), color: tone.color})]) : null,
        flowText(null, r2(L.inner - (s_.icon ? 64 * unit : 0)), {fontFamily: fonts.display, fontSize: part.head.size, lineHeight: '1.1', color: before ? c.mutedText : c.textColor, whiteSpace: 'nowrap'}, s_.title)
      ].filter(Boolean));
      const radius = r2(28 * unit);
      return el('div', `${id}-side-${i}`, abs(x, y, L.across ? L.half : B.width, L.halfH, {...hidden, boxSizing: 'border-box', background: i && c.mode === 'before-after' ? c.tint : c.panel,
        borderRadius: L.across ? (i ? `0 ${radius}px ${radius}px 0` : `${radius}px 0 0 ${radius}px`) : (i ? `0 0 ${radius}px ${radius}px` : `${radius}px ${radius}px 0 0`)}), [
        el('div', null, abs(textX, r2(L.pad + (i ? L.seam : 0)), L.inner, r2(L.halfH - L.pad * 2 - L.seam), {display: 'flex', flexDirection: 'column', justifyContent: 'center'}), [title, ...items])
      ]);
    });
    const cx = L.across ? r2(B.width / 2) : r2(B.width / 2), cy = L.across ? r2(L.halfH / 2) : L.halfH;
    const line = r2(3 * unit);
    kids.push(el('div', `${id}-divider`, L.across ? abs(r2(cx - line / 2), 0, line, L.halfH, {background: c.arrow, transformOrigin: '50% 50%', transform: 'scale(1, 0)'}) : abs(0, r2(cy - line / 2), B.width, line, {background: c.arrow, transformOrigin: '50% 50%', transform: 'scale(0, 1)'})));
    const g = r2(L.disc * 0.5);
    kids.push(el('div', `${id}-arrow`, abs(r2(cx - L.disc / 2), r2(cy - L.disc / 2), L.disc, L.disc, {...hidden, boxSizing: 'border-box', borderRadius: '50%', background: c.bg, border: `${r2(4 * unit)}px solid ${c.arrow}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', transformOrigin: '50% 50%'}), [c.mode === 'before-after'
      ? iconNode(L.across ? 'arrow-right' : 'arrow-down', {x: r2((L.disc - g) / 2 - 4 * unit), y: r2((L.disc - g) / 2 - 4 * unit), size: g, color: c.arrow, stroke: 2.6})
      : el('div', null, {margin: 0, fontFamily: fonts.display, fontSize: r2(L.disc * 0.36), lineHeight: '1', color: c.arrow}, ['VS'])]));
    return [el('div', null, abs(B.x, B.y, B.width, L.height), kids)];
  },
  table(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const rule = i => flow(`${id}-rule-${i}`, B.width, L.rule, {background: i ? c.border : c.arrow, transformOrigin: '0% 50%', transform: 'scale(0, 1)'}, []);
    const header = flow(`${id}-head`, B.width, L.headH, {...hidden, display: 'flex'}, c.sides.map((s_, i) => {
      const before = c.mode === 'before-after' && i === 0;
      return flow(null, L.colW, L.headH, {boxSizing: 'border-box', padding: `0 ${L.pad}px`, display: 'flex', alignItems: 'center', gap: r2(14 * unit)}, [
        s_.icon ? flow(null, r2(44 * unit), r2(44 * unit), {}, [iconNode(s_.icon, {size: r2(44 * unit), color: c.tones[i].color})]) : null,
        el('div', null, {margin: 0, whiteSpace: 'nowrap', fontFamily: fonts.display, fontSize: L.heads[i].size, lineHeight: '1.1', color: before ? c.mutedText : c.textColor}, [s_.title])
      ].filter(Boolean));
    }));
    const rows = [header, rule(0)];
    L.rows.forEach((h, j) => {
      rows.push(flow(null, B.width, h, {display: 'flex'}, c.sides.map((s_, i) => {
        const item = s_.items[j], tone = c.tones[i], before = c.mode === 'before-after' && i === 0;
        if (!item) return flow(null, L.colW, h, {}, []);
        return flow(`${id}-item-${i}-${j}`, L.colW, h, {...hidden, boxSizing: 'border-box', padding: `0 ${L.pad}px`, display: 'flex', alignItems: 'center', gap: L.markGap, ...(i && c.mode === 'before-after' ? {background: c.tint} : {})}, [
          flow(null, L.mark, L.mark, {}, [markNode(tone, L.mark)]),
          flowText(null, r2(L.inner - L.mark - L.markGap), {fontFamily: fonts.body, fontWeight: 500, fontSize: L.size, lineHeight: '1.2', color: before ? c.mutedText : c.textColor}, item.text)
        ]);
      })));
      rows.push(rule(j + 1));
    });
    return [column(B.x, B.y, B.width, L.height, rows, {align: 'start'})];
  },
  cards(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const columns = c.sides.map((s_, i) => {
      const tone = c.tones[i], before = c.mode === 'before-after' && i === 0;
      const pill = flow(`${id}-side-${i}`, undefined, L.pillH, {...hidden, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: r2(10 * unit), padding: `0 ${r2(20 * unit)}px`, marginBottom: L.pillGap,
        borderRadius: r2(L.pillH / 2), border: `${r2(2 * unit)}px solid ${before ? c.border : c.arrow}`, transformOrigin: '0% 50%'}, [
        s_.icon ? flow(null, r2(L.pillH * 0.55), r2(L.pillH * 0.55), {}, [iconNode(s_.icon, {size: r2(L.pillH * 0.55), color: tone.color})]) : null,
        el('div', null, {margin: 0, whiteSpace: 'nowrap', fontFamily: fonts.meta, fontSize: L.heads[i].size, lineHeight: '1.3', letterSpacing: '0.12em', color: before ? c.mutedText : c.arrow}, [s_.title.toUpperCase()])
      ].filter(Boolean));
      const items = s_.items.map((item, j) => flow(`${id}-item-${i}-${j}`, L.colW, L.columns[i][j], {...hidden, boxSizing: 'border-box', marginTop: j ? L.gap : 0, padding: `0 ${L.pad}px`, display: 'flex', alignItems: 'center', gap: L.markGap,
        borderRadius: r2(18 * unit), background: before ? 'transparent' : c.panel, border: before ? `${r2(2 * unit)}px dashed ${c.border}` : `${r2(2 * unit)}px solid ${c.arrow}`, transformOrigin: '50% 50%'}, [
        flow(null, L.mark, L.mark, {}, [markNode(tone, L.mark)]),
        flowText(null, L.textW, {fontFamily: fonts.body, fontWeight: 500, fontSize: L.size, lineHeight: '1.2', color: before ? c.mutedText : c.textColor}, item.text)
      ]));
      return flow(null, L.colW, undefined, {display: 'flex', flexDirection: 'column', alignItems: 'flex-start', ...(!L.across && i ? {marginTop: L.sideGap} : {})}, [pill, ...items]);
    });
    return [el('div', null, abs(B.x, B.y, B.width, L.height, {display: 'flex', flexDirection: L.across ? 'row' : 'column', alignItems: 'flex-start', gap: L.across ? L.gapX : 0}), columns)];
  }
};

function compareView(model) {
  const {id, fonts, unit} = model;
  const c = model.content, L = c.layout, B = c.box;
  if (COMPARE_VIEWS[L.mode]) return COMPARE_VIEWS[L.mode](model);
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
  const {id, start, unit} = model;
  const c = model.content, mode = c.layout.mode;
  if (mode === 'split') {
    const L = c.layout;
    const lead = rt(Math.max(start, c.leftAt - 0.1));
    set(ops, `${id}-divider`, start, L.across ? {scaleX: 1, scaleY: 0} : {scaleX: 0, scaleY: 1});
    tw(ops, `${id}-divider`, lead, 0.6, 'power3.inOut', L.across ? {scaleY: 0} : {scaleX: 0}, L.across ? {scaleY: 1} : {scaleX: 1});
    for (const s_ of c.sides) {
      const d = r2((s_.index ? 70 : -70) * unit), from = L.across ? {opacity: 0, x: d, y: 0} : {opacity: 0, x: 0, y: d};
      set(ops, `${id}-side-${s_.index}`, start, from);
      tw(ops, `${id}-side-${s_.index}`, s_.time, 0.55, 'power3.out', from, {opacity: 1, x: 0, y: 0});
      for (const item of s_.items) rise(ops, model, `${id}-item-${s_.index}-${item.index}`, item.time, {distance: 12, duration: 0.35});
    }
    pop(ops, model, `${id}-arrow`, rt(c.rightAt - 0.15), {scale: 0.3});
    return;
  }
  if (mode === 'table') {
    const n = c.layout.rows.length;
    set(ops, `${id}-head`, start, {opacity: 0, x: 0, y: r2(-20 * unit)});
    tw(ops, `${id}-head`, c.leftAt, 0.45, 'power3.out', {opacity: 0, y: r2(-20 * unit)}, {opacity: 1, y: 0});
    for (let i = 0; i <= n; i++) {
      set(ops, `${id}-rule-${i}`, start, {scaleX: 0, scaleY: 1});
      const at = i === 0 ? c.leftAt : (c.sides[0].items[i - 1] ?? c.sides[1].items[i - 1]).time;
      tw(ops, `${id}-rule-${i}`, rt(at + 0.05), 0.5, 'power2.out', {scaleX: 0}, {scaleX: 1});
    }
    for (const s_ of c.sides) for (const item of s_.items) {
      const target = `${id}-item-${s_.index}-${item.index}`, dx = r2((s_.index ? 30 : -30) * unit);
      set(ops, target, start, {opacity: 0, x: dx, y: 0});
      tw(ops, target, item.time, 0.4, 'power3.out', {opacity: 0, x: dx}, {opacity: 1, x: 0});
    }
    return;
  }
  if (mode === 'cards') {
    for (const s_ of c.sides) {
      const sign = s_.index ? 1 : -1;
      set(ops, `${id}-side-${s_.index}`, start, {opacity: 0, x: 0, y: 0, scaleX: 0.6, scaleY: 1});
      tw(ops, `${id}-side-${s_.index}`, s_.time, 0.4, 'back.out(1.6)', {opacity: 0, scaleX: 0.6}, {opacity: 1, scaleX: 1});
      for (const item of s_.items) {
        const target = `${id}-item-${s_.index}-${item.index}`, from = {opacity: 0, x: r2(sign * 80 * unit), y: 0, rotation: sign * 4};
        set(ops, target, start, from);
        tw(ops, target, item.time, 0.5, 'power3.out', from, {opacity: 1, x: 0, rotation: 0});
      }
    }
    return;
  }
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
  variants: COMPARE_VARIANTS,
  resolve: resolveCompare, view: compareView, timeline: compareTimeline
};

// ---------------------------------------------------------------------------
// timeline: steps along a line that build on their words.

// Variants: rail (numbered nodes on a line that runs on to each, the
// original), milestones (diamonds on a centre line with the labels
// alternating either side), cards (a card per step with a number badge,
// chevrons between, flipping in) and stairs (blocks that rise step by step,
// growing up in 16:9 and out in 9:16).
export const TIMELINE_VARIANTS = Object.freeze(['rail', 'milestones', 'cards', 'stairs']);

function resolveTimeline(params, ctx) {
  const b = createCardBase('timeline', params, ctx, {allowed: ['steps', 'title', 'direction', 'stagger', 'at'], required: ['steps'], variants: TIMELINE_VARIANTS});
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
    // One pitch for every step, so the nodes sit evenly along the line
    // whichever labels the (conservative) measure wraps.
    const pitch = Math.max(...steps.map((_, i) => r2(Math.max(node, labels[i].lines * size * 1.2 + (details[i] ? u(6) + details[i].lines * dsize * 1.25 : 0)))));
    const rows = steps.map(() => pitch);
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
  const text = (width, k, i) => {
    const label = labelFit(steps[i], width, k), detail = detailFit(steps[i], width, k);
    return {label, detail, height: r2(label.lines * label.size * 1.2 + (detail ? u(6) + detail.lines * detail.size * 1.25 : 0))};
  };
  const sized = (width, k) => {
    const all = steps.map((_, i) => text(width, k, i));
    const size = Math.min(...all.map(t => t.label.size)), details = all.filter(t => t.detail);
    const dsize = details.length ? Math.min(...details.map(t => t.detail.size)) : 0;
    return {size, dsize, heights: all.map(t => r2(t.label.lines * size * 1.2 + (t.detail ? u(6) + t.detail.lines * dsize * 1.25 : 0)))};
  };
  // milestones: a centre line, diamonds, labels alternating either side.
  const milestones = (width, k) => {
    const across = directionIn === 'horizontal' || (directionIn === 'auto' && !portrait);
    const t = fitTitle(width, k), titleH = t ? r2(t.lines * t.size * 1.15 + u(34 * k)) : 0;
    const node = u(56 * Math.min(1.3, k)), gap = u(22 * k);
    if (across) {
      const cell = r2(width / n), textW = r2(Math.min(cell * 2 - u(24), u(420 * k)));
      const {size, dsize, heights} = sized(textW, k);
      const above = Math.max(...heights.filter((_, i) => i % 2 === 0)), below = Math.max(0, ...heights.filter((_, i) => i % 2 === 1));
      return {mode: 'milestones', across, title: t, titleH, node, gap, cell, textW, size, dsize, heights, above, below, height: r2(titleH + above + gap * 2 + node + below)};
    }
    const textW = r2((width - node) / 2 - gap * 1.5);
    if (textW < u(200)) return null;
    const {size, dsize, heights} = sized(textW, k);
    const pitch = r2(Math.max(node, ...heights) + u(20 * k));
    return {mode: 'milestones', across, title: t, titleH, node, gap, textW, size, dsize, heights, pitch, height: r2(titleH + pitch * n)};
  };
  // cards: a card per step, chevrons between.
  const cards = (width, k) => {
    const across = directionIn === 'horizontal' || (directionIn === 'auto' && !portrait);
    const t = fitTitle(width, k), titleH = t ? r2(t.lines * t.size * 1.15 + u(30 * k)) : 0;
    const chevron = u(44 * Math.min(1.2, k)), pad = u(24 * Math.min(1.2, k)), badge = u(56 * Math.min(1.2, k));
    const cardW = across ? r2((width - chevron * (n - 1)) / n) : width, textW = r2(cardW - pad * 2 - (across ? 0 : badge + pad));
    if (textW < u(150)) return null;
    const {size, dsize, heights} = sized(textW, k);
    const body = Math.max(...heights);
    const cardH = across ? r2(pad * 2 + badge + u(18 * k) + body) : null;
    const rows = across ? null : heights.map(h => r2(Math.max(badge, h) + pad * 2));
    return {mode: 'cards', across, title: t, titleH, chevron, pad, badge, cardW, cardH, rows, textW, size, dsize, heights,
      height: r2(titleH + (across ? cardH : rows.reduce((a_, r_) => a_ + r_, 0) + chevron * (n - 1)))};
  };
  // stairs: blocks that rise a step at a time.
  const stairs = (width, maxHeight, k) => {
    const across = directionIn === 'horizontal' || (directionIn === 'auto' && !portrait);
    const t = fitTitle(width, k), titleH = t ? r2(t.lines * t.size * 1.15 + u(30 * k)) : 0;
    if (across) {
      const gap = u(16 * k), cell = r2((width - gap * (n - 1)) / n), textW = r2(cell - u(8));
      const {size, dsize, heights} = sized(textW, k);
      const textH = Math.max(...heights), labelGap = u(16 * k), numberH = u(80 * Math.min(1.2, k));
      const tallest = r2(Math.min(u(460 * k), maxHeight - titleH - textH - labelGap));
      const low = r2(Math.max(numberH * 1.4, tallest * 0.3));
      if (tallest < low + u(60)) return null;
      const blocks = steps.map((_, i) => r2(low + (tallest - low) * (n === 1 ? 1 : i / (n - 1))));
      return {mode: 'stairs', across, title: t, titleH, gap, cell, textW, size, dsize, heights, textH, labelGap, blocks, tallest, height: r2(titleH + textH + labelGap + tallest)};
    }
    const pad = u(22 * k), num = u(64 * Math.min(1.2, k)), gap = u(16 * k);
    const shortest = r2(width * 0.58), textW = r2(shortest - pad * 3 - num);
    const {size, dsize, heights} = sized(textW, k);
    const rows = heights.map(h => r2(Math.max(num, h) + pad * 2));
    const blocks = steps.map((_, i) => r2(shortest + (width - shortest) * (n === 1 ? 1 : i / (n - 1))));
    return {mode: 'stairs', across, title: t, titleH, pad, num, gap, textW, size, dsize, heights, rows, blocks, height: r2(titleH + rows.reduce((a_, r_) => a_ + r_, 0) + gap * (n - 1))};
  };
  const own = {milestones: (width, k) => milestones(width, k), cards: (width, k) => cards(width, k)}[b.variant];
  const measure = (width, maxHeight) => {
    const quiet = f => () => { try { return f(); } catch { return null; } };
    if (own || b.variant === 'stairs') {
      const shaped = pick(b.scales.map(k => quiet(() => (own ? own(width, k) : stairs(width, maxHeight, k)))), maxHeight);
      if (shaped && shaped.height <= maxHeight + 1e-6) return shaped;
    }
    const h = b.scales.map(k => quiet(() => horizontal(width, k))), v = b.scales.map(k => () => vertical(width, k));
    const order = directionIn === 'vertical' ? v : directionIn === 'horizontal' ? b.scales.map(k => () => horizontal(width, k)) : portrait ? v : [...h, ...v];
    const out = pick(order, maxHeight);
    return out?.direction === 'vertical' && b.fills ? spread(out, maxHeight, {gap: [n - 1, r2(out.node * 1.2)]}) : out;
  };
  // A vertical list reads as one block nearer the middle of a 9:16 frame.
  const box = b.place(measure, {maxWidth: u(portrait && directionIn !== 'horizontal' && b.variant === 'rail' ? 760 : portrait ? 900 : 1600)});
  const L = box.layout;
  const first = b.timeOf('step-0', p.at, 'params.at', 0.05);
  const placed = steps.map(step => {
    const time = step.at === undefined ? b.timeOf(`step-${step.index}`, undefined, `params.steps[${step.index}].at`, Math.min(first - start + step.index * stagger, b.lastEvent)) : b.timeOf(`step-${step.index}`, step.at, `params.steps[${step.index}].at`, 0);
    b.events.push({id: `${id}-step-${step.index}`, name: `step-${step.index}`, time, endTime: rt(time + 0.45), role: 'emphasis', cue: 'pop-soft'});
    return {...step, time};
  });
  for (let i = 1; i < placed.length; i++) if (placed[i].time < placed[i - 1].time) check.fail(`params.steps[${i}].at`, 'must not come before the step above it');
  const B = {x: box.x, y: box.y, width: box.width};
  if (L.mode) {
    const badge = solidFill(b, 'primary', 4.5);
    return b.finish({box: B, layout: L, title, steps: placed, line: theme.border, progress: colors.primary, nodeFill: theme.surface, nodeText: colors.primary, labelColor: theme.foreground, detailColor: theme.muted, titleColor: b.titleColor,
      panel: theme.panel, badgeFill: badge.fill, badgeInk: badge.ink, blockFill: badge.fill, blockInk: badge.ink, blockSolid: badge.solid}, {minTextPx: L.size});
  }
  // Node centres along the line (rect-local, in the content box).
  const centres = [];
  if (L.direction === 'vertical') {
    let y = B.y + L.titleH;
    for (const h of L.rows) { centres.push({x: r2(B.x + L.node / 2), y: r2(y + Math.min(h, L.node) / 2)}); y += h + L.gap; }
  } else {
    for (let i = 0; i < n; i++) centres.push({x: r2(B.x + L.cell * (i + 0.5)), y: r2(B.y + L.titleH + L.node / 2)});
  }
  return b.finish({box: B, layout: L, title, steps: placed, centres, line: theme.border, progress: colors.primary, nodeFill: theme.surface, nodeText: colors.primary, labelColor: theme.foreground, detailColor: theme.muted, titleColor: b.titleColor},
    {minTextPx: L.size});
}

const stepText = (model, i, width, align) => {
  const {fonts, unit} = model;
  const c = model.content, L = c.layout, step = c.steps[i];
  return [
    flowText(null, width, {fontFamily: fonts.body, fontWeight: 600, fontSize: L.size, lineHeight: '1.2', color: c.labelColor, textAlign: align}, step.label),
    step.detail ? flowText(null, width, {fontFamily: fonts.body, fontWeight: 400, fontSize: L.dsize, lineHeight: '1.25', color: c.detailColor, marginTop: r2(6 * unit), textAlign: align}, step.detail) : null
  ].filter(Boolean);
};
const timelineTitle = (model, align) => {
  const {fonts} = model;
  const c = model.content, L = c.layout, B = c.box;
  return c.title ? el('div', null, abs(0, 0, B.width, undefined, {margin: 0, whiteSpace: 'normal', fontFamily: fonts.body, fontWeight: 700, fontSize: L.title.size, lineHeight: '1.15', color: c.titleColor, textAlign: align}), [c.title]) : null;
};

const TIMELINE_VIEWS = {
  milestones(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const kids = [timelineTitle(model, 'center')];
    const thick = r2(4 * unit), half = r2(L.node / 2);
    const diamond = (i, x, y) => el('div', `${id}-node-${i}`, abs(r2(x - half), r2(y - half), L.node, L.node, {...hidden, transformOrigin: '50% 50%'}), [
      el('div', null, abs(r2(L.node * 0.15), r2(L.node * 0.15), r2(L.node * 0.7), r2(L.node * 0.7), {boxSizing: 'border-box', background: c.nodeFill, border: `${r2(4 * unit)}px solid ${c.progress}`, transform: 'rotate(45deg)'}))
    ]);
    if (L.across) {
      const y = r2(L.titleH + L.above + L.gap + half);
      kids.push(el('div', `${id}-progress`, abs(r2(L.cell / 2), r2(y - thick / 2), r2(B.width - L.cell), thick, {background: c.progress, transformOrigin: '0% 50%', transform: 'scale(0, 1)'})));
      c.steps.forEach((step, i) => {
        const x = r2(L.cell * (i + 0.5)), up = i % 2 === 0, tx = r2(Math.min(Math.max(0, x - L.textW / 2), B.width - L.textW));
        kids.push(diamond(i, x, y));
        kids.push(el('div', `${id}-text-${i}`, abs(tx, up ? r2(y - half - L.gap - L.heights[i]) : r2(y + half + L.gap), L.textW, L.heights[i], {...hidden, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: up ? 'flex-end' : 'flex-start'}), stepText(model, i, L.textW, 'center')));
      });
    } else {
      const x = r2(B.width / 2);
      kids.push(el('div', `${id}-progress`, abs(r2(x - thick / 2), r2(L.titleH + L.pitch / 2), thick, r2(L.pitch * (c.steps.length - 1)), {background: c.progress, transformOrigin: '50% 0%', transform: 'scale(1, 0)'})));
      c.steps.forEach((step, i) => {
        const y = r2(L.titleH + L.pitch * (i + 0.5)), left = i % 2 === 1;
        kids.push(diamond(i, x, y));
        kids.push(el('div', `${id}-text-${i}`, abs(left ? r2(x - half - L.gap * 1.5 - L.textW) : r2(x + half + L.gap * 1.5), r2(y - L.heights[i] / 2), L.textW, L.heights[i], {...hidden, display: 'flex', flexDirection: 'column', alignItems: left ? 'flex-end' : 'flex-start'}), stepText(model, i, L.textW, left ? 'right' : 'left')));
      });
    }
    return [el('div', null, abs(B.x, B.y, B.width, L.height), kids.filter(Boolean))];
  },
  cards(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const badge = i => flow(null, L.badge, L.badge, {flex: 'none', borderRadius: '50%', background: c.badgeFill, display: 'flex', alignItems: 'center', justifyContent: 'center'}, [
      c.steps[i].icon ? iconNode(c.steps[i].icon, {x: r2(L.badge * 0.22), y: r2(L.badge * 0.22), size: r2(L.badge * 0.56), color: c.badgeInk})
        : el('div', null, {margin: 0, fontFamily: fonts.display, fontSize: r2(L.badge * 0.5), lineHeight: '1', color: c.badgeInk}, [String(i + 1)])
    ]);
    const items = [];
    c.steps.forEach((step, i) => {
      if (i) items.push(flow(`${id}-chevron-${i}`, L.across ? L.chevron : B.width, L.across ? L.cardH : L.chevron, {...hidden, display: 'flex', alignItems: 'center', justifyContent: 'center'}, [
        flow(null, r2(L.chevron * 0.7), r2(L.chevron * 0.7), {}, [iconNode(L.across ? 'arrow-right' : 'arrow-down', {size: r2(L.chevron * 0.7), color: c.progress, stroke: 2.6})])
      ]));
      const h = L.across ? L.cardH : L.rows[i];
      items.push(flow(`${id}-node-${i}`, L.cardW, h, {...hidden, boxSizing: 'border-box', padding: L.pad, borderRadius: r2(22 * unit), background: c.panel, border: `${r2(2 * unit)}px solid ${model.content.line}`,
        display: 'flex', flexDirection: L.across ? 'column' : 'row', alignItems: L.across ? 'flex-start' : 'center', gap: L.across ? r2(18 * unit) : L.pad, transformOrigin: '50% 50%'}, [
        badge(i),
        flow(`${id}-text-${i}`, L.textW, undefined, {display: 'flex', flexDirection: 'column'}, stepText(model, i, L.textW, 'left'))
      ]));
    });
    const group = el('div', null, abs(0, L.titleH, B.width, r2(L.height - L.titleH), {display: 'flex', flexDirection: L.across ? 'row' : 'column', alignItems: 'stretch'}), items);
    return [el('div', null, abs(B.x, B.y, B.width, L.height), [timelineTitle(model, L.across ? 'center' : 'left'), group].filter(Boolean))];
  },
  stairs(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const kids = [timelineTitle(model, L.across ? 'center' : 'left')];
    const number = (i, size) => el('div', null, {margin: 0, fontFamily: fonts.display, fontSize: size, lineHeight: '1', color: c.blockInk}, [String(i + 1).padStart(2, '0')]);
    const base = r2(L.titleH + (L.across ? L.textH + L.labelGap + L.tallest : 0));
    let y = L.titleH;
    c.steps.forEach((step, i) => {
      if (L.across) {
        const x = r2(i * (L.cell + L.gap)), h = L.blocks[i];
        kids.push(el('div', `${id}-node-${i}`, abs(x, r2(base - h), L.cell, h, {boxSizing: 'border-box', borderRadius: `${r2(14 * unit)}px ${r2(14 * unit)}px 0 0`, background: c.blockFill,
          display: 'flex', alignItems: 'flex-end', padding: r2(14 * unit), transformOrigin: '50% 100%', transform: 'scale(1, 0)'}), [number(i, r2(Math.min(L.cell * 0.4, 64 * unit)))]));
        kids.push(el('div', `${id}-text-${i}`, abs(r2(x + 4 * unit), r2(base - h - L.labelGap - L.heights[i]), L.textW, L.heights[i], {...hidden, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end'}), stepText(model, i, L.textW, 'left')));
      } else {
        const h = L.rows[i], w = L.blocks[i];
        kids.push(el('div', `${id}-node-${i}`, abs(0, r2(y), w, h, {boxSizing: 'border-box', borderRadius: `0 ${r2(14 * unit)}px ${r2(14 * unit)}px 0`, background: c.blockFill, transformOrigin: '0% 50%', transform: 'scale(0, 1)'})));
        kids.push(el('div', `${id}-text-${i}`, abs(L.pad, r2(y), r2(w - L.pad * 2), h, {...hidden, display: 'flex', alignItems: 'center', gap: L.pad}), [
          flow(null, L.num, undefined, {display: 'flex', justifyContent: 'center'}, [number(i, r2(L.num * 0.8))]),
          flow(null, L.textW, undefined, {display: 'flex', flexDirection: 'column'}, [
            flowText(null, L.textW, {fontFamily: fonts.body, fontWeight: 600, fontSize: L.size, lineHeight: '1.2', color: c.blockInk}, step.label),
            step.detail ? flowText(null, L.textW, {fontFamily: fonts.body, fontWeight: 400, fontSize: L.dsize, lineHeight: '1.25', color: c.blockInk, marginTop: r2(6 * unit), opacity: 0.85}, step.detail) : null
          ].filter(Boolean))
        ]));
        y += h + L.gap;
      }
    });
    return [el('div', null, abs(B.x, B.y, B.width, L.height), kids.filter(Boolean))];
  }
};

function timelineView(model) {
  const {id, fonts, unit} = model;
  const c = model.content, L = c.layout, B = c.box;
  if (TIMELINE_VIEWS[L.mode]) return TIMELINE_VIEWS[L.mode](model);
  const kids = [];
  const vertical = L.direction === 'vertical';
  if (c.title) kids.push(el('div', null, abs(B.x, B.y, B.width, undefined, {margin: 0, whiteSpace: 'normal', fontFamily: fonts.body, fontWeight: 700, fontSize: L.title.size, lineHeight: '1.15', color: c.titleColor, textAlign: vertical ? 'left' : 'center'}), [c.title]));
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
  if (L.mode === 'milestones') {
    const axis = L.across ? 'scaleX' : 'scaleY', other = L.across ? 'scaleY' : 'scaleX', n = c.steps.length;
    set(ops, `${id}-progress`, start, {[axis]: 0, [other]: 1});
    c.steps.forEach((step, i) => {
      set(ops, `${id}-node-${i}`, start, {opacity: 0, scaleX: 0.2, scaleY: 0.2, rotation: -90});
      tw(ops, `${id}-node-${i}`, step.time, 0.5, 'back.out(1.8)', {opacity: 0, scaleX: 0.2, scaleY: 0.2, rotation: -90}, {opacity: 1, scaleX: 1, scaleY: 1, rotation: 0});
      const d = r2((L.across ? (i % 2 === 0 ? -1 : 1) : (i % 2 === 1 ? -1 : 1)) * 20 * model.unit);
      const from = L.across ? {opacity: 0, x: 0, y: d} : {opacity: 0, x: d, y: 0};
      set(ops, `${id}-text-${i}`, start, from);
      tw(ops, `${id}-text-${i}`, rt(step.time + 0.1), 0.45, 'power3.out', from, {opacity: 1, x: 0, y: 0});
      if (i > 0) tw(ops, `${id}-progress`, rt(Math.max(c.steps[i - 1].time, step.time - 0.35)), 0.35, 'power2.inOut', {[axis]: r2((i - 1) / (n - 1) * 1000) / 1000}, {[axis]: r2(i / (n - 1) * 1000) / 1000});
    });
    return;
  }
  if (L.mode === 'cards') {
    c.steps.forEach((step, i) => {
      set(ops, `${id}-node-${i}`, start, {opacity: 0, x: 0, y: 0, scaleX: L.across ? 0.2 : 1, scaleY: L.across ? 1 : 0.2});
      tw(ops, `${id}-node-${i}`, step.time, 0.5, 'back.out(1.5)', {opacity: 0, scaleX: L.across ? 0.2 : 1, scaleY: L.across ? 1 : 0.2}, {opacity: 1, scaleX: 1, scaleY: 1});
      if (i) {
        const from = L.across ? {opacity: 0, x: r2(-16 * model.unit), y: 0} : {opacity: 0, x: 0, y: r2(-16 * model.unit)};
        set(ops, `${id}-chevron-${i}`, start, from);
        tw(ops, `${id}-chevron-${i}`, rt(Math.max(c.steps[i - 1].time, step.time - 0.2)), 0.3, 'power2.out', from, {opacity: 1, x: 0, y: 0});
      }
    });
    return;
  }
  if (L.mode === 'stairs') {
    c.steps.forEach((step, i) => {
      const axis = L.across ? 'scaleY' : 'scaleX', other = L.across ? 'scaleX' : 'scaleY';
      set(ops, `${id}-node-${i}`, start, {[axis]: 0, [other]: 1});
      tw(ops, `${id}-node-${i}`, step.time, 0.55, 'power3.out', {[axis]: 0}, {[axis]: 1});
      rise(ops, model, `${id}-text-${i}`, rt(step.time + 0.2), {distance: 14, duration: 0.4});
    });
    return;
  }
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
  timing: cardTiming(['steps land in order; with no at, the first lands at 0.05 s and the rest follow by stagger (default 0.45 s)']),
  mood: ['editorial', 'launch'],
  variants: TIMELINE_VARIANTS,
  resolve: resolveTimeline, view: timelineView, timeline: timelineTimeline
};

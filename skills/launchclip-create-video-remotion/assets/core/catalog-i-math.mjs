// Catalogue I maths: equation (typeset LaTeX that reveals term by term,
// with boxed terms and labels, and a red/green diff), title-decompose (a
// paper title split into word chips, each marked term linked down to an
// icon and a gloss) and feynman-diagram (fermion, photon, gluon and scalar
// lines that draw on, with vertices, loops and labels). The equation's
// glyphs come from params.typeset, which src/math/typeset.js makes from
// params.latex with vendored MathJax; this module imports nothing.
// Registered through kit/core/catalog-i-explain.mjs.

import {contrastRatio, timingRules} from './catalog-b-base.mjs';
import {hex2, svgRoot} from './catalog-b-view.mjs';
import {VARIANT_PARAM, createHBase, fitText, mixColor, textWidth, titleBlock, toneColor} from './catalog-h-base.mjs';
import {abs, chromeNodes, chromeOps, drawOps, el, label, popOps, riseOps, set, strokePath, tw} from './catalog-h-view.mjs';
import {dataTone} from './catalog-h-data.mjs';
import {iconNode, isIcon} from './icons.mjs';
import {AT, RECT, dashedPath, drawMaskOps, glassStyle, pillNode, r2, rt, scheduleCues} from './catalog-i-base.mjs';

const GREENS = ['#3ddc84', '#2fbf71', '#1e9e5a', '#157347'];
const PATH_DATA = /^[MLQTCHVZ0-9 .,-]*$/i;

// ---------------------------------------------------------------------------
// equation

const EQUATION_VARIANTS = Object.freeze(['plain', 'glass']);

/** The typeset block from src/math/typeset.js, checked for shape and freshness. */
function typesetOf(check, p) {
  const t = p.typeset;
  const how = 'equations are typeset from params.latex by src/math/typeset.js (launchclip finish and every project read do it; a hand-built story calls typesetStory(story))';
  if (t === undefined) check.fail('params.typeset', `is missing: ${how}`);
  check.obj(t, 'params.typeset', ['v', 'latex', 'viewBox', 'glyphs', 'layers', 'boxes', 'error']);
  if (t.latex !== p.latex) check.fail('params.typeset', `is stale (typeset from different LaTeX): ${how}`);
  if (t.error) check.fail('params.latex', String(t.error).slice(0, 200));
  if (t.v !== 1) check.fail('params.typeset.v', 'must be 1');
  check.arr(t.viewBox, 'params.typeset.viewBox', 4, 4).forEach((v, i) => check.num(v, `params.typeset.viewBox[${i}]`, -1e6, 1e6));
  if (!(t.viewBox[2] > 0 && t.viewBox[3] > 0)) check.fail('params.typeset.viewBox', 'needs a positive size');
  check.obj(t.glyphs, 'params.typeset.glyphs', Object.keys(t.glyphs));
  for (const [key, d] of Object.entries(t.glyphs)) {
    if (!/^[A-Z]{1,3}(-[A-Z0-9]{1,8}){1,2}$/.test(key)) check.fail('params.typeset.glyphs', `has a bad glyph key ${JSON.stringify(key)}`);
    if (typeof d !== 'string' || d.length > 20000 || !PATH_DATA.test(d)) check.fail(`params.typeset.glyphs.${key}`, 'must be SVG path data');
  }
  check.arr(t.layers, 'params.typeset.layers', 1, 13);
  t.layers.forEach((layer, i) => {
    check.obj(layer, `params.typeset.layers[${i}]`, ['kind', 'items'], ['kind', 'items']);
    check.oneOf(layer.kind, `params.typeset.layers[${i}].kind`, i === 0 ? ['base'] : ['term', 'add', 'del']);
    check.arr(layer.items, `params.typeset.layers[${i}].items`, 0, 400);
    for (const item of layer.items) {
      const ok = Array.isArray(item.m) && item.m.length === 6 && item.m.every(Number.isFinite) && (item.g === undefined ? Array.isArray(item.r) && item.r.length === 4 && item.r.every(Number.isFinite) : Object.hasOwn(t.glyphs, item.g));
      if (!ok) check.fail(`params.typeset.layers[${i}].items`, 'holds an item that is not a glyph use or a rule');
    }
  });
  check.arr(t.boxes, 'params.typeset.boxes', t.layers.length - 1, t.layers.length - 1).forEach((box, i) => {
    if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) check.fail(`params.typeset.boxes[${i}]`, 'must be [x0, y0, x1, y1]');
  });
  return t;
}

function equationResolve(params, ctx) {
  const b = createHBase('equation', params, ctx, {allowed: ['latex', 'typeset', 'boxes', 'diffAt', 'size', 'title', 'source', 'at', 'tone'], required: ['latex'], variants: EQUATION_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  check.str(p.latex, 'params.latex', 400);
  const t = typesetOf(check, p);
  const marks = t.layers.slice(1).map((layer, i) => ({kind: layer.kind, index: i, box: t.boxes[i]}));
  const accent = toneColor(b, p.tone, 'params.tone', 'accent');
  const red = dataTone(b, 'bad', 'params (diff red)');
  const green = GREENS.find(color => contrastRatio(color, b.colors.bg) >= 3) ?? toneColor(b, 'primary', 'params (diff green)');
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const W = rect.width, H = rect.height - tb.top - tb.bottom;
  const [vx, vy, vw, vh] = t.viewBox;
  const variant = b.variant;
  const pad = variant === 'glass' ? u(56) : 0;
  let boxes = [];
  if (p.boxes !== undefined) {
    check.arr(p.boxes, 'params.boxes', 1, 4);
    boxes = p.boxes.map((raw, k) => {
      check.obj(raw, `params.boxes[${k}]`, ['mark', 'label', 'at', 'tone'], ['mark']);
      const mark = check.int(raw.mark, `params.boxes[${k}].mark`, 0, Math.max(0, marks.length - 1));
      if (!marks.length) check.fail(`params.boxes[${k}].mark`, 'needs a \\term, \\add or \\del mark in params.latex');
      return {mark, text: raw.label === undefined ? null : check.str(raw.label, `params.boxes[${k}].label`, 32), at: raw.at, color: raw.tone === undefined ? accent : toneColor(b, raw.tone, `params.boxes[${k}].tone`)};
    });
  }
  const labelSize = r2(Math.max(b.min.meta, u(34)));
  const labelRoom = boxes.some(box => box.text) ? labelSize * 1.3 + u(36) : 0;
  // Size: 1 em = `em` px, the largest that fits (default at most 120 px).
  const maxEm = p.size === undefined ? u(120) : check.num(p.size, 'params.size', b.min.key, u(240));
  const em = r2(Math.min(maxEm, (W - 2 * pad) / vw * 1000, (H - 2 * pad - labelRoom - u(30)) / vh * 1000));
  if (em < b.min.key) check.fail('params.latex', `is too wide to set at ${b.min.key} px; split it across two scenes or shorten it`);
  const k = em / 1000;
  const eqW = r2(vw * k), eqH = r2(vh * k);
  const ox = r2((W - eqW) / 2), oy = r2(tb.top + (H - eqH - labelRoom) / 2);
  const toPx = ([x0, y0, x1, y1]) => ({x: r2(ox + (x0 - vx) * k), y: r2(oy + (y0 - vy) * k), width: r2((x1 - x0) * k), height: r2((y1 - y0) * k)});

  // Cues: the build, each \term in order, the diff, then the boxes.
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: rt(buildAt + 0.7), role: 'emphasis', cue: 'whoosh-soft'});
  const cues = [];
  marks.filter(m => m.kind === 'term').forEach((m, n) => cues.push({name: `term-${n}`, path: `params (event term-${n})`, gap: 0.75, mark: m}));
  const diff = marks.some(m => m.kind !== 'term');
  if (diff) cues.push({name: 'diff', at: p.diffAt, path: 'params.diffAt', gap: 0.9, kind: 'diff'});
  else if (p.diffAt !== undefined) check.fail('params.diffAt', 'needs an \\add or \\del mark in params.latex');
  boxes.forEach((box, n) => cues.push({name: `box-${n}`, at: box.at, path: `params.boxes[${n}].at`, gap: 0.8, box}));
  scheduleCues(b, cues, buildAt - b.start + 0.8);
  for (const cue of cues) b.events.push({id: `${b.id}-${cue.name}`, name: cue.name, time: cue.time, endTime: rt(cue.time + 0.5), role: 'emphasis', cue: cue.kind === 'diff' ? 'hit' : 'hit-soft'});
  const diffAt = diff ? cues.find(cue => cue.kind === 'diff').time : null;
  const layers = t.layers.map((layer, i) => {
    const mark = i ? marks[i - 1] : null;
    const cue = mark?.kind === 'term' ? cues.find(c => c.mark === mark) : null;
    return {kind: layer.kind, items: layer.items, time: layer.kind === 'term' ? cue.time : layer.kind === 'add' ? rt(diffAt + 0.35) : buildAt, box: mark ? toPx(mark.box) : null};
  });
  const boxPad = u(14);
  const boxItems = boxes.map((box, n) => {
    const B = toPx(marks[box.mark].box);
    const frame = {x: r2(B.x - boxPad), y: r2(B.y - boxPad), width: r2(B.width + 2 * boxPad), height: r2(B.height + 2 * boxPad)};
    const lw = box.text ? r2(textWidth(box.text, labelSize, 'body') + u(36)) : 0;
    return {...box, frame, time: cues.find(c => c.box === box).time,
      pill: box.text ? {x: r2(Math.min(Math.max(0, frame.x + frame.width / 2 - lw / 2), W - lw)), y: r2(frame.y + frame.height + u(16)), width: lw, height: r2(labelSize * 1.3 + u(14))} : null};
  });
  const last = Math.max(buildAt + 0.7, ...cues.map(c => c.time + 0.5));
  const content = {variant, title: tb.title, source: tb.source, align: 'center', viewBox: t.viewBox, glyphs: t.glyphs, layers, eq: {x: ox, y: oy, width: eqW, height: eqH}, pad, k, boxes: boxItems, labelSize, diffAt,
    ink: b.theme.foreground, accent, red, green, buildAt, buildEnd: rt(last)};
  return b.finish(content, {minTextPx: Math.min(em, tb.title ? tb.title.size : Infinity)});
}

const matrix = m => `matrix(${m.join(' ')})`;
function layerSvg(model, layer, color, defs) {
  const c = model.content, [vx, vy, vw, vh] = c.viewBox;
  const uses = layer.items.map(item => (item.g === undefined
    ? el('rect', null, null, [], {x: item.r[0], y: item.r[1], width: item.r[2], height: item.r[3], transform: matrix(item.m)})
    : el('use', null, null, [], {href: `#${model.id}-g-${item.g}`, transform: matrix(item.m)})));
  return el('svg', null, {position: 'absolute', left: 0, top: 0, overflow: 'visible'}, [...(defs ? [defs] : []), el('g', null, null, uses, {fill: color, stroke: color, strokeWidth: 0})],
    {width: c.eq.width, height: c.eq.height, viewBox: `${vx} ${vy} ${vw} ${vh}`});
}

function equationView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content, E = c.eq;
  const kids = chromeNodes(model);
  if (c.variant === 'glass') kids.push(el('div', `${id}-card`, {...abs(r2(E.x - c.pad), r2(E.y - c.pad), r2(E.width + 2 * c.pad), r2(E.height + 2 * c.pad)), ...glassStyle(model, c.accent, {radius: 28}), opacity: 0}));
  const defs = el('defs', null, null, Object.entries(c.glyphs).map(([key, d]) => el('path', `${id}-g-${key}`, null, [], {d})));
  c.layers.forEach((layer, i) => {
    const color = layer.kind === 'add' ? c.green : c.ink;
    kids.push(el('div', `${id}-l-${i}`, {...abs(E.x, E.y, E.width, E.height), opacity: 0, ...(i === 0 ? {clipPath: 'inset(0% 100% 0% 0%)'} : {})}, [layerSvg(model, layer, color, i === 0 ? defs : null)]));
    if (layer.kind === 'del') {
      kids.push(el('div', `${id}-l-${i}-red`, {...abs(E.x, E.y, E.width, E.height), opacity: 0}, [layerSvg(model, layer, c.red, null)]));
      const B = layer.box, h = r2(6 * u);
      kids.push(el('div', `${id}-strike-${i}`, abs(r2(B.x - 8 * u), r2(B.y + B.height / 2 - h / 2), r2(B.width + 16 * u), h, {borderRadius: h, background: c.red, boxShadow: `0 0 ${r2(10 * u)}px ${hex2(c.red, 0.6)}`, transformOrigin: '0% 50%', transform: 'scale(0, 1)'})));
    }
  });
  c.boxes.forEach((box, n) => {
    const F = box.frame;
    kids.push(el('div', `${id}-box-${n}`, {...abs(F.x, F.y, F.width, F.height), boxSizing: 'border-box', borderRadius: r2(14 * u), border: `${r2(3 * u)}px solid ${box.color}`,
      background: hex2(box.color, 0.08), boxShadow: `0 0 ${r2(24 * u)}px ${hex2(box.color, 0.5)}`, opacity: 0}));
    if (box.pill) kids.push(pillNode(`${id}-boxl-${n}`, box.pill, box.text, {size: c.labelSize, family: fonts.body, color: box.color, background: hex2(model.theme.panel, 0.92), border: `${r2(2 * u)}px solid ${hex2(box.color, 0.6)}`, weight: 700, extra: {opacity: 0}}));
  });
  return kids;
}

function equationTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  if (c.variant === 'glass') popOps(ops, `${id}-card`, start, rt(c.buildAt - 0.1), {from: 0.96, duration: 0.5, ease: 'power3.out', fade: 0.3});
  c.layers.forEach((layer, i) => {
    const target = `${id}-l-${i}`;
    if (i === 0) {
      set(ops, target, start, {opacity: 1, clipT: 0, clipR: 100, clipB: 0, clipL: 0});
      tw(ops, target, layer.time, 0.7, 'power2.inOut', {clipT: 0, clipR: 100, clipB: 0, clipL: 0}, {clipT: 0, clipR: 0, clipB: 0, clipL: 0});
    } else if (layer.kind === 'del') {
      set(ops, target, start, {opacity: 0});
      tw(ops, target, rt(layer.time + 0.25), 0.4, 'power1.out', {opacity: 0}, {opacity: 1});
      set(ops, `${target}-red`, start, {opacity: 0});
      tw(ops, `${target}-red`, c.diffAt, 0.3, 'power1.out', {opacity: 0}, {opacity: 1});
      tw(ops, target, c.diffAt, 0.3, 'power1.out', {opacity: 1}, {opacity: 0});
      set(ops, `${id}-strike-${i}`, start, {x: 0, y: 0, scaleX: 0, scaleY: 1});
      tw(ops, `${id}-strike-${i}`, rt(c.diffAt + 0.15), 0.35, 'power2.out', {scaleX: 0}, {scaleX: 1});
    } else riseOps(ops, target, start, layer.time, r2(28 * u), {duration: 0.5, ease: 'back.out(1.6)'});
  });
  c.boxes.forEach((box, n) => {
    popOps(ops, `${id}-box-${n}`, start, box.time, {from: 1.15, duration: 0.4, ease: 'power3.out', fade: 0.2});
    if (box.pill) riseOps(ops, `${id}-boxl-${n}`, start, rt(box.time + 0.15), r2(12 * u));
  });
}

export const equation = {
  id: 'equation',
  describe: 'Typeset LaTeX (MathJax glyphs, drawn the same in both renderers) that wipes in, then reveals its \\term{…} marks one at a time, boxes marked terms with a glowing frame and a label ("first quantum correction"), and runs a red/green diff: \\del{…} turns red and is struck through while \\add{…} lands in green.',
  params: {latex: 'string ≤ 400, display-style TeX; mark parts with \\term{…} (reveals on its own cue), \\add{…} or \\del{…} (the diff); marks do not nest',
    typeset: 'generated from latex by src/math/typeset.js (launchclip fills it in; never write it by hand)', boxes: '[{mark (index of a \\term/\\add/\\del mark, from 0), label? ≤ 32, tone?, at?}] 1–4 (events box-<n>)',
    diffAt: `the diff: ${AT}`, size: 'px per em (optional; default the largest that fits, at most 120)', tone: 'box colour: primary | accent (default) | paper | #rrggbb',
    title: 'string ≤ 60 (optional)', source: 'string ≤ 80 (optional)', at: `build start: ${AT}`, variant: VARIANT_PARAM, rect: RECT},
  events: ['build', 'term-<n>', 'diff', 'box-<n>'], timing: timingRules({rules: ['the equation wipes in over 0.7 s from at; terms, the diff and the boxes follow 0.75–0.9 s apart (squeezed to fit)']}), variants: EQUATION_VARIANTS,
  resolve: equationResolve, view: equationView, timeline: equationTimeline
};

// ---------------------------------------------------------------------------
// title-decompose

const DECOMPOSE_VARIANTS = Object.freeze(['chips', 'underline']);
const wordKey = w => w.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '');

function decomposeResolve(params, ctx) {
  const b = createHBase('title-decompose', params, ctx, {allowed: ['text', 'citation', 'terms', 'tone', 'at'], required: ['text', 'terms'], variants: DECOMPOSE_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const text = check.str(p.text, 'params.text', 120);
  const citation = p.citation === undefined ? null : check.str(p.citation, 'params.citation', 80);
  const color = toneColor(b, p.tone, 'params.tone', 'accent');
  const words = text.split(/\s+/).filter(Boolean);
  check.arr(p.terms, 'params.terms', 1, 5);
  const used = new Set();
  const terms = p.terms.map((raw, i) => {
    const path = `params.terms[${i}]`;
    check.obj(raw, path, ['text', 'gloss', 'sub', 'icon'], ['text', 'gloss']);
    if (raw.icon !== undefined && !isIcon(raw.icon)) check.fail(`${path}.icon`, `is not an icon name (got ${JSON.stringify(raw.icon)})`);
    const want = check.str(raw.text, `${path}.text`, 40).split(/\s+/).map(wordKey);
    const at = words.findIndex((_, k) => want.every((w, j) => wordKey(words[k + j] ?? '') === w) && want.every((_, j) => !used.has(k + j)));
    if (at < 0) check.fail(`${path}.text`, `is not a run of words in params.text (${JSON.stringify(raw.text)})`);
    want.forEach((_, j) => used.add(at + j));
    return {first: at, last: at + want.length - 1, gloss: check.str(raw.gloss, `${path}.gloss`, 24), sub: raw.sub === undefined ? null : check.str(raw.sub, `${path}.sub`, 28), icon: raw.icon ?? null};
  }).sort((a, c) => a.first - c.first);
  const W = rect.width, H = rect.height;
  const citeSize = r2(Math.max(b.min.meta, u(28)));
  const citeH = citation ? r2(citeSize * 1.3 + u(18)) : 0;
  // Chips: the largest size at which the title wraps into at most 4 lines.
  const chipPadX = u(16), chipGap = u(12), lineGap = u(14);
  const layout = size => {
    const lines = [[]];
    let used2 = 0;
    for (const [k, word] of words.entries()) {
      const w = textWidth(word, size, 'body') + 2 * chipPadX;
      if (used2 && used2 + chipGap + w > W) { lines.push([]); used2 = 0; }
      lines.at(-1).push({k, word, w: r2(w)});
      used2 += (used2 ? chipGap : 0) + w;
    }
    return lines;
  };
  let size = u(b.portrait ? 56 : 52), lines = layout(size);
  while ((lines.length > 4 || lines.some(line => line.some(chip => chip.w > W))) && size > b.min.key) { size = Math.max(b.min.key, size - 2); lines = layout(size); }
  if (lines.length > 4 || lines.some(line => line.some(chip => chip.w > W))) check.fail('params.text', `does not fit 4 lines at ${b.min.key} px; shorten it`);
  const chipH = r2(size * 1.25 + u(16));
  const n = terms.length;
  const cellW = r2(W / n);
  const iconSize = r2(u(b.portrait && n > 3 ? 64 : 84));
  const glossSize = Math.min(u(36), ...terms.map((term, i) => fitText(check, `params.terms[${i}].gloss`, term.gloss, {family: 'body', width: cellW - u(12), preferred: u(36), min: b.min.meta, maxLines: 2}).size));
  const subSize = r2(Math.max(b.min.meta, u(28)));
  terms.forEach((term, i) => { if (term.sub) fitText(check, `params.terms[${i}].sub`, term.sub, {family: 'body', width: cellW - u(12), preferred: subSize, min: subSize, maxLines: 2}); });
  const glossLines = Math.max(...terms.map(term => (textWidth(term.gloss, glossSize, 'body') > cellW - u(12) ? 2 : 1)));
  const subLines = Math.max(0, ...terms.map(term => (term.sub ? (textWidth(term.sub, subSize, 'body') > cellW - u(12) ? 2 : 1) : 0)));
  const cellH = r2(iconSize + u(16) + glossSize * 1.25 * glossLines + (subLines ? u(6) + subSize * 1.25 * subLines : 0));
  const titleH = lines.length * chipH + (lines.length - 1) * lineGap;
  const linkH = u(b.portrait ? 150 : 120);
  const blockH = citeH + titleH + linkH + cellH;
  if (blockH > H) check.fail('params', 'does not fit the rect; shorten the title or glosses, or use fewer terms');
  const y0 = r2((H - blockH) / 2);
  const chips = [];
  lines.forEach((line, li) => {
    const lw = line.reduce((s, chip) => s + chip.w, 0) + chipGap * (line.length - 1);
    let x = (W - lw) / 2;
    for (const chip of line) { chips.push({...chip, x: r2(x), y: r2(y0 + citeH + li * (chipH + lineGap))}); x += chip.w + chipGap; }
  });
  const cellY = r2(y0 + citeH + titleH + linkH);
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const step = Math.min(0.06, 0.9 / words.length);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: rt(buildAt + step * words.length + 0.4), role: 'emphasis', cue: 'tally'});
  chips.forEach(chip => { chip.time = rt(buildAt + chip.k * step); chip.term = terms.findIndex(term => chip.k >= term.first && chip.k <= term.last); });
  const cues = terms.map((_, i) => ({name: `term-${i}`, path: `params (event term-${i})`, gap: 0.7}));
  scheduleCues(b, cues, buildAt - b.start + step * words.length + 0.5);
  // Each connector leaves the term's last line; cells run in the order the
  // connectors leave, so wrapped terms never cross each other's lines.
  const starts = terms.map((_, i) => {
    const own = chips.filter(chip => chip.term === i);
    const yb = Math.max(...own.map(chip => chip.y + chipH));
    const lastLine = own.filter(chip => chip.y + chipH === yb);
    return {sx: r2((Math.min(...lastLine.map(chip => chip.x)) + Math.max(...lastLine.map(chip => chip.x + chip.w))) / 2), sy: r2(yb + u(8))};
  });
  const slot = terms.map((_, i) => i).sort((a, c) => starts[a].sx - starts[c].sx);
  const items = terms.map((term, i) => {
    const own = chips.filter(chip => chip.term === i);
    const x0 = Math.min(...own.map(chip => chip.x)), x1 = Math.max(...own.map(chip => chip.x + chip.w));
    const {sx, sy} = starts[i], j = slot.indexOf(i);
    const cx = r2(cellW * j + cellW / 2), cy = r2(cellY - u(10));
    const time = cues[i].time;
    b.events.push({id: `${b.id}-term-${i}`, name: `term-${i}`, time, endTime: rt(time + 0.6), role: 'emphasis', cue: 'hit-soft'});
    return {...term, x0, x1, time, link: `M${sx} ${sy} C${sx} ${r2((sy + cy) / 2)} ${cx} ${r2((sy + cy) / 2)} ${cx} ${cy}`, cell: {x: r2(cellW * j), y: cellY, width: cellW}};
  });
  const content = {variant: b.variant, citation: citation ? {text: citation, size: citeSize, y: y0} : null, chips, chipH, size, terms: items, iconSize, glossSize, subSize, color, buildAt, buildEnd: rt(Math.max(...items.map(term => term.time)) + 0.6),
    ink: b.theme.foreground, muted: b.theme.muted, border: b.theme.border, panel: b.theme.panel, accent: b.colors.accent};
  return b.finish(content, {minTextPx: size});
}

function decomposeView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const W = model.rect.width, H = model.rect.height;
  const kids = [];
  if (c.citation) kids.push(label(`${id}-cite`, 0, c.citation.y, W, c.citation.text, {size: c.citation.size, family: fonts.meta, color: c.muted, align: 'center', spacing: '0.04em', extra: {opacity: 0}}));
  const underline = c.variant === 'underline';
  c.terms.forEach((term, i) => kids.push(dashedPath(`${id}-link-${i}`, W, H, term.link, hex2(c.color, 0.8), r2(3 * u), {dash: r2(8 * u), gap: r2(8 * u)})));
  c.chips.forEach(chip => {
    const box = {...abs(chip.x, chip.y, chip.w, c.chipH), boxSizing: 'border-box', borderRadius: r2(10 * u)};
    kids.push(el('div', `${id}-w-${chip.k}`, {...box, ...(underline ? {background: hex2(model.theme.bg, 0.9)} : {background: mixColor(c.panel, model.theme.bg, 0.4), border: `${r2(2 * u)}px solid ${c.border}`}), opacity: 0}, [
      label(null, 0, r2((c.chipH - c.size * 1.25) / 2), chip.w, chip.word, {size: c.size, family: fonts.body, color: c.ink, align: 'center', weight: 700, lineHeight: 1.25})
    ]));
    if (chip.term >= 0) kids.push(el('div', `${id}-hl-${chip.k}`, {...box, ...(underline ? {borderBottom: `${r2(5 * u)}px solid ${c.color}`, borderRadius: 0} : {border: `${r2(3 * u)}px solid ${c.color}`, background: hex2(c.color, 0.14)}),
      boxShadow: underline ? 'none' : `0 0 ${r2(20 * u)}px ${hex2(c.color, 0.5)}`, opacity: 0}));
  });
  c.terms.forEach((term, i) => {
    const C = term.cell, kid = [];
    if (term.icon) kid.push(iconNode(term.icon, {x: r2((C.width - c.iconSize) / 2), y: 0, size: c.iconSize, color: c.color, mode: 'duotone'}));
    else kid.push(el('div', null, abs(r2((C.width - c.iconSize * 0.5) / 2), r2(c.iconSize * 0.25), r2(c.iconSize * 0.5), r2(c.iconSize * 0.5), {borderRadius: '50%', border: `${r2(4 * u)}px solid ${c.color}`, boxSizing: 'border-box', boxShadow: `0 0 ${r2(16 * u)}px ${c.color}`})));
    kid.push(label(null, r2(6 * u), r2(c.iconSize + 16 * u), r2(C.width - 12 * u), term.gloss, {size: c.glossSize, family: fonts.body, color: c.color, align: 'center', weight: 700, lineHeight: 1.25, wrap: true}));
    if (term.sub) kid.push(label(null, r2(6 * u), r2(c.iconSize + 16 * u + c.glossSize * 1.25 * (textWidth(term.gloss, c.glossSize, 'body') > C.width - 12 * u ? 2 : 1) + 6 * u), r2(C.width - 12 * u), term.sub, {size: c.subSize, family: fonts.body, color: c.muted, align: 'center', weight: 500, lineHeight: 1.25, wrap: true}));
    kids.push(el('div', `${id}-cell-${i}`, abs(C.x, C.y, C.width, r2(H - C.y), {opacity: 0}), kid));
  });
  return kids;
}

function decomposeTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  if (c.citation) riseOps(ops, `${id}-cite`, start, rt(c.buildAt - 0.1), r2(10 * u));
  c.chips.forEach(chip => {
    popOps(ops, `${id}-w-${chip.k}`, start, chip.time, {from: 0.7, duration: 0.35, ease: 'back.out(2)'});
    if (chip.term >= 0) {
      set(ops, `${id}-hl-${chip.k}`, start, {opacity: 0});
      tw(ops, `${id}-hl-${chip.k}`, c.terms[chip.term].time, 0.3, 'power2.out', {opacity: 0}, {opacity: 1});
    }
  });
  c.terms.forEach((term, i) => {
    drawMaskOps(ops, `${id}-link-${i}`, start, rt(term.time + 0.1), 0.55);
    riseOps(ops, `${id}-cell-${i}`, start, rt(term.time + 0.45), r2(18 * u));
  });
}

export const titleDecompose = {
  id: 'title-decompose',
  describe: 'A paper (or any) title set as word chips under its citation; each marked term in turn lights its chips, a dashed connector drops from them, and an icon with a plain gloss lands under it ("Self-Mass" → "the field\'s own mass"), building a glossary row.',
  params: {text: 'string ≤ 120, the title', citation: 'string ≤ 80 over it ("Kahya & Woodard, Phys. Rev. D 76 (2007)") (optional)',
    terms: '[{text (a run of words in the title), gloss ≤ 24, sub? ≤ 28, icon?}] 1–5, glossed left to right (events term-<i>)', tone: 'primary | accent (default) | paper | #rrggbb', at: `build start: ${AT}`, variant: VARIANT_PARAM, rect: RECT},
  events: ['build', 'term-<i>'], timing: timingRules({rules: ['the words pop in reading order within about 0.9 s from at; terms follow 0.7 s apart (squeezed to fit)']}), variants: DECOMPOSE_VARIANTS,
  resolve: decomposeResolve, view: decomposeView, timeline: decomposeTimeline
};

// ---------------------------------------------------------------------------
// feynman-diagram

const FEYNMAN_VARIANTS = Object.freeze(['glow', 'ink']);
const LINE_TYPES = ['fermion', 'antifermion', 'photon', 'gluon', 'scalar', 'graviton'];
const GRID = {width: 12, height: 6};
// Presets on the 12 × 6 grid (y down): the common one-loop and tree pictures.
const PRESETS = Object.freeze({
  'self-energy': {points: {a: [0.5, 3.5], b: [3.5, 3.5], c: [8.5, 3.5], d: [11.5, 3.5]},
    lines: [{from: 'a', to: 'b', type: 'scalar', label: 'φ'}, {from: 'b', to: 'c', type: 'scalar'}, {from: 'c', to: 'd', type: 'scalar'}, {from: 'b', to: 'c', type: 'graviton', bend: -0.75, label: 'h'}]},
  exchange: {points: {a: [1, 0.8], b: [6, 1.6], c: [11, 0.8], d: [1, 5.2], e: [6, 4.4], f: [11, 5.2]},
    lines: [{from: 'a', to: 'b', type: 'fermion', label: 'e⁻'}, {from: 'b', to: 'c', type: 'fermion'}, {from: 'd', to: 'e', type: 'fermion', label: 'e⁻'}, {from: 'e', to: 'f', type: 'fermion'}, {from: 'b', to: 'e', type: 'photon', label: 'γ'}]},
  annihilation: {points: {a: [1, 0.8], b: [4, 3], c: [8, 3], d: [1, 5.2], e: [11, 0.8], f: [11, 5.2]},
    lines: [{from: 'a', to: 'b', type: 'fermion', label: 'e⁻'}, {from: 'b', to: 'd', type: 'fermion', label: 'e⁺'}, {from: 'b', to: 'c', type: 'photon', label: 'γ'}, {from: 'c', to: 'e', type: 'fermion', label: 'μ⁻'}, {from: 'f', to: 'c', type: 'fermion', label: 'μ⁺'}]}
});

/** Points along a straight or bent (circular-ish) line from P to Q: a quadratic with its control off the midpoint. */
function lineCurve(P, Q, bend) {
  const mx = (P[0] + Q[0]) / 2, my = (P[1] + Q[1]) / 2, dx = Q[0] - P[0], dy = Q[1] - P[1];
  const len = Math.hypot(dx, dy) || 1;
  const C = [mx - dy / len * bend * len, my + dx / len * bend * len];
  const at = s => [(1 - s) ** 2 * P[0] + 2 * (1 - s) * s * C[0] + s * s * Q[0], (1 - s) ** 2 * P[1] + 2 * (1 - s) * s * C[1] + s * s * Q[1]];
  const tangent = s => { const tx = 2 * (1 - s) * (C[0] - P[0]) + 2 * s * (Q[0] - C[0]), ty = 2 * (1 - s) * (C[1] - P[1]) + 2 * s * (Q[1] - C[1]); const l = Math.hypot(tx, ty) || 1; return [tx / l, ty / l]; };
  return {at, tangent, C, length: len * (1 + 0.6 * bend * bend)};
}
const fmt = pts => pts.map((pt, i) => `${i ? 'L' : 'M'}${r2(pt[0])} ${r2(pt[1])}`).join(' ');

function feynmanResolve(params, ctx) {
  const b = createHBase('feynman-diagram', params, ctx, {allowed: ['preset', 'points', 'lines', 'title', 'caption', 'tone', 'at'], variants: FEYNMAN_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const preset = p.preset === undefined ? null : PRESETS[check.oneOf(p.preset, 'params.preset', Object.keys(PRESETS))];
  if (!preset && (p.points === undefined || p.lines === undefined)) check.fail('params', 'needs a preset, or points and lines');
  const rawPoints = p.points ?? preset.points;
  check.obj(rawPoints, 'params.points', Object.keys(rawPoints));
  const points = {};
  for (const [name, xy] of Object.entries(rawPoints)) {
    if (!/^[a-z][a-z0-9]{0,7}$/.test(name)) check.fail(`params.points.${name}`, 'must be named with lowercase letters and digits');
    check.arr(xy, `params.points.${name}`, 2, 2);
    points[name] = [check.num(xy[0], `params.points.${name}[0]`, 0, GRID.width), check.num(xy[1], `params.points.${name}[1]`, 0, GRID.height)];
  }
  if (Object.keys(points).length > 12) check.fail('params.points', 'must name at most 12 points');
  const rawLines = p.lines ?? preset.lines;
  check.arr(rawLines, 'params.lines', 1, 12);
  const color = toneColor(b, p.tone, 'params.tone', 'accent');
  const lines = rawLines.map((line, i) => {
    const path = `params.lines[${i}]`;
    check.obj(line, path, ['from', 'to', 'type', 'label', 'bend', 'at'], ['from', 'to']);
    for (const end of ['from', 'to']) if (!points[line[end]]) check.fail(`${path}.${end}`, `must name a point (${Object.keys(points).join(', ')})`);
    return {from: line.from, to: line.to, type: line.type === undefined ? 'fermion' : check.oneOf(line.type, `${path}.type`, LINE_TYPES), text: line.label === undefined ? null : check.str(line.label, `${path}.label`, 12),
      bend: line.bend === undefined ? 0 : check.num(line.bend, `${path}.bend`, -1, 1), at: line.at};
  });
  const tb = titleBlock(b, {title: p.title, source: p.caption});
  const W = rect.width, H = rect.height - tb.top - tb.bottom;
  const labelSize = r2(Math.max(b.min.key, u(48)));
  const margin = labelSize * 1.4;
  const s = Math.min((W - 2 * margin) / GRID.width, (H - 2 * margin) / GRID.height);
  const ox = (W - GRID.width * s) / 2, oy = tb.top + (H - GRID.height * s) / 2;
  const P = name => [ox + points[name][0] * s, oy + points[name][1] * s];
  const amp = u(14), wave = u(50);
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: rt(buildAt + 0.4), role: 'emphasis', cue: 'whoosh-soft'});
  const cues = lines.map((line, i) => ({name: `line-${i}`, at: line.at, path: `params.lines[${i}].at`, gap: 0.55}));
  scheduleCues(b, cues, buildAt - b.start + 0.2, {tail: 0.8});
  for (const cue of cues) b.events.push({id: `${b.id}-${cue.name}`, name: cue.name, time: cue.time, endTime: rt(cue.time + 0.6), role: 'emphasis', cue: 'whoosh-soft'});
  const items = lines.map((line, i) => {
    const A = P(line.from), B = P(line.to);
    const curve = lineCurve(A, B, line.bend);
    const n = Math.max(24, Math.round(curve.length / u(4)));
    const samples = Array.from({length: n + 1}, (_, k) => k / n);
    let d;
    if (line.type === 'photon' || line.type === 'graviton') {
      const cycles = Math.max(2, Math.round(curve.length / wave));
      const pts = samples.map(t => { const [x, y] = curve.at(t), [tx, ty] = curve.tangent(t), off = Math.sin(t * cycles * 2 * Math.PI) * amp; return [x - ty * off, y + tx * off]; });
      d = fmt(pts);
      if (line.type === 'graviton') d += ` ${fmt(samples.map(t => { const [x, y] = curve.at(t), [tx, ty] = curve.tangent(t), off = -Math.sin(t * cycles * 2 * Math.PI) * amp; return [x - ty * off, y + tx * off]; })).replace(/^M/, 'M')}`;
    } else if (line.type === 'gluon') {
      const loops = Math.max(3, Math.round(curve.length / u(26)));
      const m = loops * 24;
      const pts = Array.from({length: m + 1}, (_, k) => {
        const t = k / m, phase = t * loops * 2 * Math.PI;
        const [x, y] = curve.at(t), [tx, ty] = curve.tangent(t);
        const along = -Math.sin(phase) * amp * 0.9, off = (1 - Math.cos(phase)) * amp * 0.9;
        return [x + tx * along - ty * off, y + ty * along + tx * off];
      });
      d = fmt(pts);
    } else d = line.bend ? `M${r2(A[0])} ${r2(A[1])} Q${r2(curve.C[0])} ${r2(curve.C[1])} ${r2(B[0])} ${r2(B[1])}` : `M${r2(A[0])} ${r2(A[1])} L${r2(B[0])} ${r2(B[1])}`;
    const mid = curve.at(0.5), [tx, ty] = curve.tangent(0.5);
    const dir = line.type === 'antifermion' ? -1 : 1;
    const arrow = line.type === 'fermion' || line.type === 'antifermion' ? {x: r2(mid[0]), y: r2(mid[1]), angle: r2(Math.atan2(ty * dir, tx * dir) * 180 / Math.PI)} : null;
    // The label sits off the line's middle, on the side away from the diagram's centre.
    const cx = ox + GRID.width * s / 2, cy = oy + GRID.height * s / 2;
    const side = ((mid[0] - cx) * -ty + (mid[1] - cy) * tx) >= 0 ? 1 : -1;
    const off = (line.type === 'scalar' || !line.text ? u(30) : amp + u(30)) + labelSize * 0.45;
    const lw = line.text ? r2(textWidth(line.text, labelSize, 'serif') + u(10)) : 0;
    const lx = r2(mid[0] - ty * off * side - lw / 2), ly = r2(mid[1] + tx * off * side - labelSize * 0.6);
    return {...line, d, arrow, time: cues[i].time, duration: 0.6, labelBox: line.text ? {x: lx, y: ly, w: lw} : null, ends: [A, B]};
  });
  // Vertices: points two or more lines meet, popping when the first of them is drawn.
  const touches = {};
  items.forEach(line => [line.from, line.to].forEach(name => { (touches[name] ??= []).push(line); }));
  const vertices = Object.entries(touches).filter(([, list]) => list.length >= 2).map(([name, list]) => {
    const [x, y] = P(name);
    return {name, x: r2(x), y: r2(y), time: rt(Math.min(...list.map(line => line.time + line.duration)))};
  });
  const content = {variant: b.variant, title: tb.title, source: tb.source, align: 'center', lines: items, vertices, labelSize, color, stroke: u(5), buildAt, buildEnd: rt(Math.max(...items.map(line => line.time + line.duration)) + 0.3),
    ink: b.theme.foreground, glow: b.variant === 'glow', muted: b.theme.muted};
  return b.finish(content, {minTextPx: Math.min(labelSize, tb.title ? tb.title.size : Infinity)});
}

function feynmanView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const kids = chromeNodes(model);
  const W = model.rect.width, H = model.rect.height;
  const tint = c.glow ? c.color : c.ink;
  const glow = c.glow ? {filter: `drop-shadow(0 0 ${r2(8 * u)}px ${hex2(c.color, 0.85)})`} : {};
  c.lines.forEach((line, i) => {
    const lineColor = line.type === 'scalar' || line.type === 'fermion' || line.type === 'antifermion' ? c.ink : tint;
    if (line.type === 'scalar') kids.push(el('div', null, abs(0, 0, W, H, glow), [dashedPath(`${id}-line-${i}`, W, H, line.d, lineColor, c.stroke, {dash: r2(16 * u), gap: r2(12 * u)})]));
    else kids.push(el('div', null, abs(0, 0, W, H, glow), [svgRoot(W, H, [strokePath(`${id}-line-${i}`, line.d, lineColor, r2(c.stroke * (line.type === 'gluon' ? 0.8 : 1)))])]));
    if (line.arrow) {
      const a = r2(26 * u);
      kids.push(el('div', `${id}-arrow-${i}`, abs(r2(line.arrow.x - a / 2), r2(line.arrow.y - a / 2), a, a, {opacity: 0}), [
        el('div', null, abs(0, 0, a, a, {transform: `rotate(${line.arrow.angle}deg)`}), [svgRoot(a, a, [el('path', null, null, [], {d: `M${r2(a * 0.2)} ${r2(a * 0.15)} L${r2(a * 0.85)} ${r2(a / 2)} L${r2(a * 0.2)} ${r2(a * 0.85)} Z`, fill: c.ink})])])
      ]));
    }
    if (line.labelBox) kids.push(label(`${id}-label-${i}`, line.labelBox.x, line.labelBox.y, line.labelBox.w, line.text, {size: c.labelSize, family: fonts.display === fonts.body ? fonts.body : `'Times New Roman', ${fonts.body}`, color: tint, align: 'center', lineHeight: 1.2, extra: {opacity: 0, fontStyle: 'italic'}}));
  });
  c.vertices.forEach(v => {
    const d = r2(22 * u);
    kids.push(el('div', `${id}-v-${v.name}`, abs(r2(v.x - d / 2), r2(v.y - d / 2), d, d, {borderRadius: '50%', background: c.ink, boxShadow: c.glow ? `0 0 ${r2(16 * u)}px ${c.color}, 0 0 0 ${r2(5 * u)}px ${hex2(c.color, 0.3)}` : 'none', opacity: 0})));
  });
  return kids;
}

function feynmanTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  c.lines.forEach((line, i) => {
    if (line.type === 'scalar') drawMaskOps(ops, `${id}-line-${i}`, start, line.time, line.duration, 'power1.inOut');
    else drawOps(ops, `${id}-line-${i}`, start, line.time, line.duration, 'power1.inOut');
    if (line.arrow) popOps(ops, `${id}-arrow-${i}`, start, rt(line.time + line.duration * 0.5), {from: 0.2, duration: 0.3, ease: 'back.out(2.4)'});
    if (line.labelBox) riseOps(ops, `${id}-label-${i}`, start, rt(line.time + line.duration * 0.6), r2(10 * u));
  });
  c.vertices.forEach(v => popOps(ops, `${id}-v-${v.name}`, start, v.time, {from: 0.2, duration: 0.35, ease: 'back.out(2.6)'}));
}

export const feynmanDiagram = {
  id: 'feynman-diagram',
  describe: 'A Feynman diagram that draws itself line by line: fermions (straight, with an arrow), photons (wavy), gluons (curly), scalars (dashed) and gravitons (double wave), bent into loops where asked, vertices popping as lines meet them and labels (e⁻, γ, φ) landing beside the lines. Presets: self-energy (a one-loop correction), exchange, annihilation.',
  params: {preset: `${Object.keys(PRESETS).join(' | ')} (or give points and lines)`, points: '{name: [x, y]} on a 12 × 6 grid, y down (optional with a preset)',
    lines: `[{from, to (point names), type? (${LINE_TYPES.join(' | ')}; default fermion), bend? −1–1 (a loop or arc), label? ≤ 12, at?}] 1–12, drawn in order (events line-<i>)`,
    tone: 'boson and glow colour: primary | accent (default) | paper | #rrggbb', title: 'string ≤ 60 (optional)', caption: 'string ≤ 80 under it (optional)', at: `build start: ${AT}`, variant: VARIANT_PARAM, rect: RECT},
  events: ['build', 'line-<i>'], timing: timingRules({rules: ['lines draw in 0.6 s each, about 0.55 s apart from at (squeezed to fit); vertices pop as the first line reaches them']}), variants: FEYNMAN_VARIANTS,
  resolve: feynmanResolve, view: feynmanView, timeline: feynmanTimeline
};

export const MATH = [equation, titleDecompose, feynmanDiagram];

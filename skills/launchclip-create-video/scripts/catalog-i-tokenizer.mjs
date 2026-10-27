// Catalogue I tokenizer: a sentence split into coloured token chips (a real
// BPE split, precomputed into params by src/tokenizer.js so kit/core stays
// import-free), each with its price as an output token under it for one or
// two models, token and character counts, then an output-token counter that
// races the models' bills to their totals on segmented bars. All DOM, on
// catalogue H's op list. Registered in kit/core/catalog-h.mjs.

import {VARIANT_PARAM, createHBase, fitText, numberFormat, r2, rt, textWidth} from './catalog-h-base.mjs';
import {timingRules} from './catalog-b-base.mjs';
import {hex2} from './catalog-b-view.mjs';
import {abs, countOps, countSamples, el, label, popOps, riseOps, set, tw} from './catalog-h-view.mjs';
import {dataTone} from './catalog-h-data.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';
const TOKEN_VARIANTS = Object.freeze(['panel', 'bare']);
export const MAX_TOKENS = 48;

/** USD per token from USD per 1M tokens: "$0.00001", trailing zeros trimmed, at least 2 decimals. */
export function perTokenPrice(perMillion) {
  const v = perMillion / 1e6;
  let text = v.toFixed(9).replace(/0+$/, '');
  if (text.split('.')[1].length < 2) text = v.toFixed(2);
  return `$${text}`;
}

/** What a chip shows: the token with its leading space dropped (a bare space shows as ␣). */
const chipText = token => (token.trim() ? token.replace(/^ /, '').replace(/\n/g, '⏎') : '␣');

function tokenResolve(params, ctx) {
  const b = createHBase('tokenizer', params, ctx, {allowed: ['text', 'tokens', 'encoding', 'title', 'source', 'models', 'output', 'at', 'raceAt'], required: ['text', 'tokens', 'models'], variants: TOKEN_VARIANTS,
    // A dense panel: in portrait it takes the caption band's height too.
    hidesCaptions: Number(ctx?.format?.height) > Number(ctx?.format?.width)});
  const {check, u, rect} = b;
  const p = b.params;
  const text = check.str(p.text, 'params.text', 160);
  check.arr(p.tokens, 'params.tokens', 1, MAX_TOKENS);
  const tokens = p.tokens.map((t, i) => { if (typeof t !== 'string' || !t) check.fail(`params.tokens[${i}]`, 'must be a non-empty string'); return t; });
  if (tokens.join('') !== text) check.fail('params.tokens', 'must join back to params.text exactly; precompute them with node src/tokenizer.js "<text>"');
  const encoding = p.encoding === undefined ? null : check.str(p.encoding, 'params.encoding', 24);
  const title = p.title === undefined ? 'Tokenizer' : check.str(p.title, 'params.title', 32);
  const source = p.source === undefined ? null : check.str(p.source, 'params.source', 60);
  check.arr(p.models, 'params.models', 1, 2);
  const models = p.models.map((m, i) => {
    const path = `params.models[${i}]`;
    check.obj(m, path, ['label', 'price', 'tone'], ['label', 'price']);
    const price = check.num(m.price, `${path}.price`, 0.000001, 100000);
    return {label: check.str(m.label, `${path}.label`, 24), price, each: perTokenPrice(price), color: dataTone(b, m.tone, `${path}.tone`, i ? 'accent' : 'primary')};
  });
  const output = p.output === undefined ? 1_000_000 : check.int(p.output, 'params.output', 1000, 1e12);
  const panel = b.variant === 'panel';
  const W = rect.width, H = rect.height, pad = panel ? u(b.portrait ? 40 : 34) : 0;
  const inner = W - 2 * pad;
  const meta = r2(Math.max(b.min.meta, u(26)));
  const key = b.min.key;

  // Header: title, source; stats: tokens, characters; per-token prices at the right.
  const titleSize = fitText(check, 'params.title', title, {family: 'body', width: inner * 0.4, preferred: Math.max(key, u(44)), min: key}).size;
  const statSize = r2(Math.max(key, u(b.portrait ? 64 : 56)));
  const headH = r2(titleSize * 1.3 + u(18));
  const priceRowsH = r2(meta * 1.3 * models.length);
  const statsH = r2(Math.max(meta * 1.3 + statSize * 1.1, priceRowsH) + u(12));

  // Race block: output tokens counter, one row per model with a segmented bar.
  const costFmt = numberFormat(check, {style: 'currency', decimals: 2}, 'params.models');
  const outFmt = numberFormat(check, undefined, 'params.output');
  const costs = models.map(m => m.price * output / 1e6);
  const maxCost = Math.max(...costs);
  const raceNum = r2(Math.max(key, u(b.portrait ? 60 : 52)));
  const totalW = r2(Math.max(...costs.map(c => textWidth(costFmt.format(c), raceNum, 'display'))) + u(12));
  const modelSize = Math.min(...models.map((m, i) => fitText(check, `params.models[${i}].label`, m.label, {family: 'body', width: b.portrait ? inner : inner * 0.26, preferred: Math.max(key, u(40)), min: key}).size));
  // Landscape rows are one line (the header already lists each model's price).
  const rowH = r2(b.portrait ? modelSize * 1.25 + meta * 1.3 + raceNum * 1.15 + u(18) : Math.max(modelSize * 1.25, raceNum * 1.15) + u(14));
  const outW = r2(textWidth(outFmt.format(output), raceNum, 'display') + u(20));
  const raceH = r2(raceNum * 1.1 + u(14) + models.length * rowH);

  // Chips: the largest size whose rows fit what is left.
  const chipsTop = r2(pad + headH + statsH + u(10));
  const chipsH = H - 2 * pad - headH - statsH - raceH - u(28);
  const layoutChips = size => {
    const padX = r2(size * 0.32), gapX = r2(size * 0.28), gapY = r2(size * 0.3);
    const chipH = r2(size * 1.3), priceH = r2(meta * 1.2 * models.length + u(6));
    const items = tokens.map(t => {
      const shown = chipText(t);
      const w = r2(textWidth(shown, size, 'body') + 2 * padX);
      const slot = r2(Math.max(w, ...models.map(m => textWidth(m.each, meta, 'meta') + u(4))));
      return {token: t, shown, w, slot};
    });
    const rows = [[]];
    let x = 0;
    for (const item of items) {
      if (item.slot > inner) return null;
      if (x && x + item.slot > inner) { rows.push([]); x = 0; }
      rows[rows.length - 1].push(item);
      x += item.slot + gapX;
    }
    const lineH = chipH + priceH + gapY;
    if (rows.length * lineH - gapY > chipsH) return null;
    rows.forEach((row, ri) => {
      const rowW = row.reduce((sum, item) => sum + item.slot, 0) + gapX * (row.length - 1);
      let cx = pad + (inner - rowW) / 2;
      for (const item of row) { Object.assign(item, {x: r2(cx), y: r2(chipsTop + (chipsH - (rows.length * lineH - gapY)) / 2 + ri * lineH)}); cx += item.slot + gapX; }
    });
    return {size, padX, chipH, items};
  };
  let chips = null;
  for (let size = Math.max(key, u(b.portrait ? 60 : 54)); size >= key - 1e-6 && !chips; size = r2(size - 2)) chips = layoutChips(size);
  if (!chips) check.fail('params.tokens', `do not fit at ${key} px here; shorten the text or drop a model`);

  const palette = b.series(5);
  chips.items.forEach((item, i) => { item.color = palette[i % palette.length]; });

  // Timing: chips pop in left to right, prices follow, then the race.
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const step = Math.min(0.09, 1.4 / tokens.length);
  chips.items.forEach((item, i) => { item.time = rt(buildAt + 0.35 + i * step); });
  const chipsEnd = rt(buildAt + 0.35 + (tokens.length - 1) * step + 0.4);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: chipsEnd, role: 'emphasis', cue: 'tally'});
  const raceAt = b.timeOf('race', p.raceAt, 'params.raceAt', Math.min(chipsEnd - b.start + 0.5, b.lastEvent - 1), {min: Math.min(chipsEnd - b.start, b.lastEvent - 1)});
  const raceEnd = rt(Math.min(raceAt + 2.6, b.start + b.lastEvent));
  b.events.push({id: `${b.id}-race`, name: 'race', time: raceAt, endTime: raceEnd, role: 'emphasis', cue: 'tally'});
  b.events.push({id: `${b.id}-total`, name: 'total', time: raceEnd, endTime: rt(raceEnd + 0.4), role: 'emphasis', cue: 'hit'});
  const raceTop = r2(H - pad - raceH);
  const barX = b.portrait ? pad : r2(pad + inner * 0.28);
  const barW = r2(pad + inner - totalW - u(24) - barX);
  const rows = models.map((m, i) => {
    const y = r2(raceTop + raceNum * 1.1 + u(14) + i * rowH);
    return {...m, y, cost: costs[i], fill: costs[i] / maxCost, barY: r2(b.portrait ? y + modelSize * 1.25 + meta * 1.3 + u(8) : y + (rowH - u(14)) / 2 - u(14)),
      samples: countSamples(b.model, raceAt, raceEnd - raceAt, 'none', 0, costs[i], v => costFmt.format(v))};
  });
  const content = {variant: b.variant, portrait: b.portrait, outW, title, titleSize, source, encoding, pad, inner, headH, meta, statSize, statsH, chips, models: rows, modelSize, raceNum, raceTop, totalW, barX, barW, barH: r2(u(28)),
    tokenCount: tokens.length, charCount: [...text].length, buildAt, chipsEnd, raceAt, raceEnd, buildEnd: raceEnd,
    tokenSamples: countSamples(b.model, rt(buildAt + 0.35), Math.max(0.05, chipsEnd - buildAt - 0.75), 'none', 0, tokens.length, v => String(Math.round(v))),
    charSamples: countSamples(b.model, rt(buildAt + 0.35), Math.max(0.05, chipsEnd - buildAt - 0.75), 'none', 0, [...text].length, v => String(Math.round(v))),
    outSamples: countSamples(b.model, raceAt, raceEnd - raceAt, 'none', 0, output, v => outFmt.format(Math.round(v))),
    ink: b.theme.foreground, muted: b.theme.muted, border: b.theme.border, panelBg: b.theme.panel, bg: b.colors.bg};
  return b.finish(content, {minTextPx: Math.min(titleSize, statSize, chips.size, modelSize, raceNum)});
}

function tokenView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content, W = model.rect.width, H = model.rect.height, P = c.pad;
  const kids = [];
  if (c.variant === 'panel') kids.push(el('div', `${id}-panel`, abs(0, 0, W, H, {opacity: 0, borderRadius: r2(28 * u), background: hex2(c.panelBg, 0.88), border: `${r2(2 * u)}px solid ${c.border}`, boxSizing: 'border-box'})));
  const small = (nid, x, y, w, value, color = c.muted, align = 'left') => label(nid, x, y, w, value, {size: c.meta, family: fonts.meta, color, align, extra: {opacity: 0}});
  kids.push(label(`${id}-title`, P, P, r2(c.inner * 0.45), c.title, {size: c.titleSize, family: fonts.body, color: c.ink, weight: 700, extra: {opacity: 0}}));
  const right = [c.source, c.encoding].filter(Boolean).join(' · ');
  if (right) kids.push(small(`${id}-src`, r2(P + c.inner * 0.45), r2(P + (c.titleSize - c.meta) * 0.6), r2(c.inner * 0.55), right, c.muted, 'right'));
  const sy = r2(P + c.headH), colW = r2(c.statSize * 3.4);
  kids.push(small(`${id}-tk-l`, P, sy, colW, 'Tokens'), small(`${id}-ch-l`, r2(P + colW), sy, colW, 'Characters'));
  kids.push(label(`${id}-tk`, P, r2(sy + c.meta * 1.3), colW, '0', {size: c.statSize, family: fonts.display, color: c.ink, lineHeight: 1.1, extra: {opacity: 0, fontVariantNumeric: 'tabular-nums'}}));
  kids.push(label(`${id}-ch`, r2(P + colW), r2(sy + c.meta * 1.3), colW, '0', {size: c.statSize, family: fonts.display, color: c.ink, lineHeight: 1.1, extra: {opacity: 0, fontVariantNumeric: 'tabular-nums'}}));
  const pw = r2(c.inner * 0.55);
  c.models.forEach((m, i) => kids.push(small(`${id}-pp-${i}`, r2(P + c.inner - pw), r2(sy + c.meta * 1.3 * i), pw, `${m.label} · ${m.each} per output token`, m.color, 'right')));
  const ch = c.chips;
  ch.items.forEach((item, i) => {
    kids.push(el('div', `${id}-chip-${i}`, abs(r2(item.x + (item.slot - item.w) / 2), item.y, item.w, ch.chipH, {opacity: 0, borderRadius: r2(ch.size * 0.22), background: hex2(item.color, 0.2), border: `${r2(2 * u)}px solid ${hex2(item.color, 0.55)}`, boxSizing: 'border-box', transformOrigin: '50% 50%'}), [
      label(null, 0, r2((ch.chipH - ch.size * 1.2) / 2 - 2 * u), item.w, item.shown, {size: ch.size, family: fonts.body, color: c.ink, align: 'center', weight: 600, extra: {whiteSpace: 'pre'}})
    ]));
    c.models.forEach((m, j) => kids.push(small(`${id}-cp-${i}-${j}`, r2(item.x - 20 * u), r2(item.y + ch.chipH + 6 * u + j * c.meta * 1.2), r2(item.slot + 40 * u), m.each, m.color, 'center')));
  });
  const rt0 = c.raceTop;
  kids.push(small(`${id}-out-l`, r2(P + c.outW), r2(rt0 + c.raceNum * 1.1 - c.meta * 1.55), r2(c.inner - c.outW), 'output tokens'));
  kids.push(label(`${id}-out`, P, rt0, c.outW, '0', {size: c.raceNum, family: fonts.display, color: c.ink, lineHeight: 1.1, extra: {opacity: 0, fontVariantNumeric: 'tabular-nums'}}));
  const seg = r2(12 * u), gap = r2(4 * u);
  c.models.forEach((m, i) => {
    kids.push(label(`${id}-m-${i}`, P, m.y, r2(c.barX - P - 16 * u > 0 ? c.barX - P - 16 * u : c.inner), m.label, {size: c.modelSize, family: fonts.body, color: m.color, weight: 700, extra: {opacity: 0}}));
    if (c.portrait) kids.push(small(`${id}-mp-${i}`, P, r2(m.y + c.modelSize * 1.25), r2(c.inner * 0.6), `$${m.price} per 1M output tokens`));
    const bars = stripe => `repeating-linear-gradient(90deg, ${stripe} 0 ${seg}px, transparent ${seg}px ${r2(seg + gap)}px)`;
    kids.push(el('div', `${id}-track-${i}`, abs(c.barX, m.barY, c.barW, c.barH, {opacity: 0, background: bars(hex2(c.ink, 0.1))})));
    kids.push(el('div', `${id}-bar-${i}`, abs(c.barX, m.barY, r2(c.barW * m.fill), c.barH, {background: bars(m.color), clipPath: 'inset(0% 100% 0% 0%)'})));
    kids.push(label(`${id}-cost-${i}`, r2(P + c.inner - c.totalW), r2(m.barY + c.barH / 2 - c.raceNum * 0.58), c.totalW, '$0.00', {size: c.raceNum, family: fonts.display, color: m.color, align: 'right', lineHeight: 1.1, extra: {opacity: 0, fontVariantNumeric: 'tabular-nums'}}));
  });
  return kids;
}

function tokenTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  if (c.variant === 'panel') { set(ops, `${id}-panel`, start, {opacity: 0}); tw(ops, `${id}-panel`, c.buildAt, 0.4, 'power2.out', {opacity: 0}, {opacity: 1}); }
  const rise = (nid, t, dy = 12) => riseOps(ops, nid, start, rt(t), r2(dy * u));
  rise(`${id}-title`, c.buildAt + 0.05, 14);
  if (c.source || c.encoding) rise(`${id}-src`, c.buildAt + 0.12);
  for (const nid of ['tk-l', 'ch-l', 'tk', 'ch']) rise(`${id}-${nid}`, c.buildAt + 0.15);
  c.models.forEach((_m, i) => rise(`${id}-pp-${i}`, c.buildAt + 0.22 + i * 0.06));
  countOps(ops, `${id}-tk`, start, '0', c.tokenSamples);
  countOps(ops, `${id}-ch`, start, '0', c.charSamples);
  c.chips.items.forEach((item, i) => {
    popOps(ops, `${id}-chip-${i}`, start, item.time, {from: 0.5, duration: 0.4, ease: 'back.out(2.2)'});
    c.models.forEach((_m, j) => rise(`${id}-cp-${i}-${j}`, item.time + 0.15 + j * 0.05, 8));
  });
  const race0 = rt(c.raceAt - 0.45);
  rise(`${id}-out-l`, race0);
  rise(`${id}-out`, race0);
  countOps(ops, `${id}-out`, start, '0', c.outSamples);
  c.models.forEach((m, i) => {
    rise(`${id}-m-${i}`, race0 + 0.06 * i);
    if (c.portrait) rise(`${id}-mp-${i}`, race0 + 0.06 * i + 0.05);
    rise(`${id}-track-${i}`, race0 + 0.06 * i, 0);
    rise(`${id}-cost-${i}`, race0 + 0.06 * i);
    countOps(ops, `${id}-cost-${i}`, start, '$0.00', m.samples);
    const from = {clipT: 0, clipR: 100, clipB: 0, clipL: 0};
    set(ops, `${id}-bar-${i}`, start, from);
    tw(ops, `${id}-bar-${i}`, c.raceAt, c.raceEnd - c.raceAt, 'none', from, {clipT: 0, clipR: 0, clipB: 0, clipL: 0});
  });
}

export const tokenizer = {
  id: 'tokenizer',
  describe: `A sentence split into coloured token chips (a real BPE split, up to ${MAX_TOKENS} tokens) with each token's output price under it for 1–2 models, token and character counts, then an output-token counter racing the models' bills to their totals on segmented bars ("1,000,000 tokens: $10.00 vs $5.00").`,
  params: {text: 'string ≤ 160, the sentence', tokens: `[string] 1–${MAX_TOKENS}, its BPE split, joining back to text exactly (precompute: node src/tokenizer.js "<text>")`, encoding: 'string ≤ 24 shown in the header ("o200k_base") (optional)',
    models: '[{label ≤ 24, price (USD per 1M output tokens), tone?}] 1–2', output: 'integer, the output tokens the race counts to (default 1,000,000)',
    title: 'string ≤ 32 (default "Tokenizer")', source: 'string ≤ 60 at the top right, where the text is from (optional)', at: `chips start: ${at}`, raceAt: `the race: ${at} (default 0.5 s after the chips)`, variant: VARIANT_PARAM, rect},
  events: ['build', 'race', 'total'], timing: timingRules({rules: ['chips pop in left to right within about 1.5 s of at; counts count with them', 'the race runs up to 2.6 s, ending by the last event time']}), variants: TOKEN_VARIANTS,
  resolve: tokenResolve, view: tokenView, timeline: tokenTimeline
};

export const TOKENIZER_MODULES = [tokenizer];

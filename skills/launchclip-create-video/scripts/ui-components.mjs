// The ui-scene component library beyond the core set in ui-paint.mjs. Each
// component is (el, t, ctx) → inner HTML for el.rect (design px, its own box
// at 0,0), t in seconds from the scene start, el.props with beats applied.
// Same rules as ui-paint.mjs: plain function declarations that call only each
// other and the helpers, listed in UI_COMPONENT_TABLE. Tables live inside the
// functions (no module-level constants); settled parts hold still, life comes
// from staggered entrances and timed state changes.

import {uiClamp, uiP, uiLerp, uiOutCubic, uiOutBack, uiHash, uiPad, uiEsc, uiN, uiEnter, uiTyped, uiCaret, uiDiv, uiWave, uiTone, uiChipHtml, uiHeader, uiPanelStyle, uiChildren} from './ui-paint.mjs';

/** Kind → draw function for the components in this file. */
function UI_COMPONENT_TABLE() {
  return {
    stack: uiStack, meter: uiMeter, terminal: uiTerminal, results: uiResults, 'card-wall': uiCardWall, downloads: uiDownloads,
    comment: uiComment, 'marker-snap': uiMarkerSnap, 'frame-ruler': uiFrameRuler, 'pad-grid': uiPadGrid, 'scan-plane': uiScanPlane
  };
}

/** stack: children only, no surface (a group that enters as one). */
function uiStack(el, t, ctx) { return uiChildren(el.children, t, ctx); }

/** A plain panel title bar (no traffic lights): left label, muted right label. */
function uiBar(ctx, left, right) {
  const c = ctx.c;
  return '<div style="position:absolute;left:0;right:0;top:0;height:64px;border-bottom:2px solid ' + c.line + ';font-family:' + ctx.fonts.mono + ';font-size:28px;font-weight:600;display:flex;align-items:center;padding:0 24px;white-space:nowrap;color:' + c.ink + '">' + uiEsc(left) + (right ? '<span style="margin-left:auto;color:' + c.muted + '">' + uiEsc(right) + '</span>' : '') + '</div>';
}

/** An outlined status pill in a tone (accent on tint, alert on alertBg). */
function uiRingChip(ctx, text, tone, size) {
  const c = ctx.c, col = uiTone(c, tone, 'accent');
  return '<div style="display:inline-block;white-space:nowrap;border-radius:999px;padding:' + uiN(size * 0.2) + 'px ' + uiN(size * 0.6) + 'px;font-family:' + ctx.fonts.mono + ';font-weight:700;font-size:' + size + 'px;background:' + (tone === 'alert' ? c.alertBg : c.tint) + ';color:' + col + ';box-shadow:0 0 0 3px ' + col + '">' + uiEsc(text) + '</div>';
}

/**
 * meter: a loudness dial. {title, unit, from, to, settleAt, rangeLabel, history}.
 * The needle springs to the target and the readout counts; both turn accent once
 * settled. history draws level bars over ~2 s that turn accent after the settle.
 */
function uiMeter(el, t, ctx) {
  const p = el.props, c = ctx.c, w = el.rect.width, h = el.rect.height, a0 = el.at;
  const from = p.from === undefined ? -31 : p.from, to = p.to === undefined ? -14 : p.to;
  const settle = p.settleAt === undefined ? a0 + 0.6 : p.settleAt;
  const lv = uiP(t, settle, 0.5), done = lv >= 1;
  const ang = uiLerp(-80, 18, uiOutBack(lv, 1.3));
  const D = Math.max(120, Math.min(300, h - 150)), inner = D - 32, cx = inner / 2, len = inner * 0.44;
  let s = uiBar(ctx, p.title || 'LOUDNESS', p.unit === undefined ? 'LUFS' : p.unit);
  s += uiDiv('left:70px;top:110px;width:' + D + 'px;height:' + D + 'px;border-radius:50%;border:16px solid ' + c.line + ';box-sizing:border-box;' + uiEnter(t, a0 + 0.05, 'pop'),
    uiDiv('left:' + uiN(cx - 4) + 'px;top:' + uiN(cx - len) + 'px;width:8px;height:' + uiN(len) + 'px;background:' + (done ? c.accent : '#ffffff') + ';border-radius:4px;transform-origin:4px ' + uiN(len) + 'px;transform:rotate(' + uiN(ang) + 'deg);' + (done ? 'box-shadow:0 0 14px ' + c.accent + '99' : ''), '') +
    uiDiv('left:' + uiN(cx - 14) + 'px;top:' + uiN(cx - 14) + 'px;width:28px;height:28px;border-radius:50%;background:#ffffff', ''));
  const nx = 70 + D + 50;
  s += uiDiv('left:' + nx + 'px;top:150px;font-family:' + ctx.fonts.mono + ';font-weight:800;font-size:110px;line-height:1;color:' + (done ? c.accent : c.ink) + ';' + uiEnter(t, a0 + 0.12, 'right'), String(Math.round(uiLerp(from, to, uiOutCubic(lv)))));
  if (p.rangeLabel !== false) s += uiDiv('left:' + (nx + 10) + 'px;top:285px;' + uiEnter(t, settle + 0.3, 'pop'), uiRingChip(ctx, p.rangeLabel || 'IN RANGE', 'accent', 30));
  if (p.history !== false) {
    const h0 = a0 + 0.15, dur = 2.1, N = Math.max(4, Math.min(28, Math.floor((w - nx - 30) / 18)));
    const base = Math.min(h - 30, 110 + D + 10), n = Math.floor(uiClamp((t - h0) / dur) * N);
    for (let i = 0; i < n; i++) {
      const late = h0 + dur * i / N >= settle;
      const v = late ? 0.55 + 0.08 * uiHash(i + 3) : 0.3 + 0.6 * uiHash(i);
      s += uiDiv('left:' + (nx + i * 18) + 'px;top:' + uiN(base - 70 * v) + 'px;width:12px;height:' + uiN(70 * v) + 'px;border-radius:3px;background:' + (late ? c.accent : c.dim), '');
    }
  }
  return '<div style="position:absolute;inset:0;' + uiPanelStyle(c, '') + '">' + s + '</div>';
}

/**
 * marker-snap: a track with a marker; a clip springs onto it. {title, snapLabel,
 * marker, clip, from, to (fractions of the width), snapAt, badge}.
 */
function uiMarkerSnap(el, t, ctx) {
  const p = el.props, c = ctx.c, w = el.rect.width, h = el.rect.height, a0 = el.at;
  const snapAt = p.snapAt === undefined ? a0 + 0.8 : p.snapAt;
  const mx = (p.to === undefined ? 0.55 : p.to) * w, fx = (p.from === undefined ? 0.12 : p.from) * w;
  let s = uiBar(ctx, p.title || 'A2 · sfx', p.snapLabel === undefined ? 'snap: on' : p.snapLabel);
  for (let i = 0; 30 + i * 37 < w - 30; i++) s += uiDiv('left:' + (30 + i * 37) + 'px;top:80px;width:2px;height:' + (i % 4 ? 16 : 30) + 'px;background:' + c.line2, '');
  const lineH = Math.max(80, h - 140);
  const flash = uiP(t, snapAt + 0.18, 0.5), hitGlow = t >= snapAt + 0.18 ? uiLerp(40, 14, flash) : 14;
  s += uiDiv('left:' + uiN(mx - 3) + 'px;top:70px;width:6px;height:' + uiN(lineH) + 'px;background:' + c.accent + ';box-shadow:0 0 ' + uiN(hitGlow) + 'px ' + c.accent + ';' + uiEnter(t, a0 + 0.15, 'down', {dist: 80}),
    '<div style="position:absolute;left:-60px;top:-50px">' + uiChipHtml(ctx, {text: p.marker || 'HIT', size: 26}) + '</div>');
  const sn = uiP(t, snapAt, 0.3), cx = uiLerp(fx, mx + 3, uiOutBack(sn, 1.2));
  const cw = Math.min(260, w * 0.27), ch = Math.min(96, h * 0.28), cy = Math.min(h * 0.44, h - ch - 70);
  s += uiDiv('left:' + uiN(cx) + 'px;top:' + uiN(cy) + 'px;width:' + uiN(cw) + 'px;height:' + uiN(ch) + 'px;border-radius:14px;background:' + c.tint + ';box-shadow:0 0 0 3px ' + c.accent + (sn >= 1 ? ',0 0 ' + uiN(uiLerp(40, 0, flash)) + 'px ' + c.accent : '') + ';font-family:' + ctx.fonts.mono + ';font-size:28px;color:' + c.accent + ';line-height:' + uiN(ch) + 'px;padding-left:18px;box-sizing:border-box;white-space:nowrap;overflow:hidden;' + uiEnter(t, a0 + 0.25, 'up', {dist: 60}), uiEsc(p.clip || '▸ hit.wav'));
  if (p.badge !== false) s += uiDiv('left:' + uiN(Math.min(w * 0.73, w - 200)) + 'px;top:' + uiN(h - 66) + 'px;' + uiEnter(t, snapAt + 0.2, 'pop'), uiChipHtml(ctx, {text: p.badge || 'ON BEAT', size: 28}));
  return '<div style="position:absolute;inset:0;' + uiPanelStyle(c, '') + '">' + s + '</div>';
}

/**
 * terminal: a window with a typed prompt, code lines and a rendered output well.
 * {title, sub, prompt, typeAt, cps, lines: [{at, key, text}], output: {at, label, shape (rise|decay|even), badge}}.
 * The caret blinks until the first line lands; a white scan line draws the output.
 */
function uiTerminal(el, t, ctx) {
  const p = el.props, c = ctx.c, w = el.rect.width, h = el.rect.height, a0 = el.at;
  const cps = p.cps || 40, typeAt = p.typeAt === undefined ? a0 + 0.1 : p.typeAt;
  const prompt = String(p.prompt || '');
  const typedEnd = typeAt + prompt.length / cps;
  const lines = p.lines || [];
  const lineAt = function (i) { return lines[i].at !== undefined ? lines[i].at : typedEnd + 0.25 + i * 0.1; };
  const out = p.output || null;
  const outAt = out ? (out.at !== undefined ? out.at : (lines.length ? lineAt(lines.length - 1) : typedEnd) + 0.35) : 0;
  const caretUntil = lines.length ? lineAt(0) : out ? outAt : 1e9;
  let s = uiHeader(ctx, p.title || 'terminal', p.sub, p.right);
  s += uiDiv('left:30px;top:100px;width:' + (w - 60) + 'px;font-family:' + ctx.fonts.mono + ';font-size:36px;line-height:1.3;color:' + c.ink, '<span style="color:' + c.accent + '">❯</span> ' + uiEsc(uiTyped(prompt, t, typeAt, cps)) + (t < caretUntil ? uiCaret(t, c.accent) : ''));
  const lh = 62, l0 = 190;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    s += uiDiv('left:30px;top:' + (l0 + i * lh) + 'px;white-space:nowrap;font-family:' + ctx.fonts.mono + ';font-size:32px;color:' + c.soft + ';' + uiEnter(t, lineAt(i), 'left', {dist: 60}),
      '<span style="color:' + c.muted + '">' + uiPad(i + 1) + '</span>&nbsp; ' + (ln.key ? '<span style="color:' + c.accent + '">' + uiEsc(ln.key) + '</span> = ' : '') + uiEsc(ln.text));
  }
  if (out) {
    const y = l0 + lines.length * lh + 40, wh = Math.max(140, Math.min(240, h - y - 30)), ww = w - 100, bh = wh - 80;
    const shape = out.shape || 'rise';
    const env = shape === 'rise' ? function (q) { return 0.1 + 0.9 * Math.pow(q, 1.6); } : shape === 'decay' ? function (q) { return Math.exp(-q * 4); } : null;
    const col = shape === 'rise' ? function (q) { return q > 0.7 ? c.accent : c.soft; } : shape === 'decay' ? function (q) { return q < 0.18 ? c.accent : c.soft; } : c.soft;
    let wl = uiDiv('left:20px;top:14px;font-family:' + ctx.fonts.mono + ';font-size:26px;color:' + c.accent + ';white-space:nowrap', uiEsc(out.label || '▸ output.wav'));
    wl += uiDiv('left:20px;top:64px;width:' + ww + 'px;height:' + bh + 'px', uiWave(Math.round(ww / 9.5), ww, bh, 77, col, t, outAt + 0.1, {d: 0.6, env: env}));
    if (out.badge !== false) wl += uiDiv('right:20px;top:12px;' + uiEnter(t, outAt + 0.22, 'pop'), uiChipHtml(ctx, {text: out.badge || '✓ RENDERED', size: 24}));
    const sq = uiClamp((t - outAt - 0.15) / 1.1), fade = 1 - uiP(t, outAt + 1.25, 0.3);
    if (t > outAt + 0.15 && fade > 0) wl += uiDiv('left:' + uiN(20 + ww * sq) + 'px;top:58px;width:4px;height:' + uiN(bh + 12) + 'px;background:#ffffff;box-shadow:0 0 12px #ffffff;opacity:' + fade.toFixed(3), '');
    s += uiDiv('left:30px;top:' + y + 'px;width:' + (w - 60) + 'px;height:' + wh + 'px;border-radius:16px;background:' + c.well + ';' + uiEnter(t, outAt, 'up', {dist: 80}), wl);
  }
  return '<div style="position:absolute;inset:0;' + uiPanelStyle(c, '') + '">' + s + '</div>';
}

/**
 * results: a search box types a query, then result cards land.
 * {query, typeAt, cps, layout (fan|row), cards: [{label, sub, badge, tone, at}]}.
 * fan: cards fanned in 3D with the middle card on top; row: side by side.
 */
function uiResults(el, t, ctx) {
  const p = el.props, c = ctx.c, w = el.rect.width, h = el.rect.height, a0 = el.at;
  const cps = p.cps || 40, typeAt = p.typeAt === undefined ? a0 + 0.1 : p.typeAt;
  const q = String(p.query || ''), cards = p.cards || [];
  const typedEnd = typeAt + q.length / cps;
  const fanned = p.layout !== 'row', mid0 = (cards.length - 1) / 2;
  const rank = function (i) { if (!fanned) return i; let r = 0; for (let j = 0; j < cards.length; j++) { const dj = Math.abs(j - mid0), di = Math.abs(i - mid0); if (dj > di || (dj === di && j < i)) r++; } return r; };
  const cardAt = function (i) { return cards[i].at !== undefined ? cards[i].at : typedEnd + 0.25 + rank(i) * 0.22; };
  let firstAt = 1e9;
  for (let i = 0; i < cards.length; i++) firstAt = Math.min(firstAt, cardAt(i));
  let s = uiDiv('left:0;top:0;width:' + w + 'px;height:130px;' + uiPanelStyle(c, ''),
    uiDiv('left:30px;top:32px;font-size:56px;line-height:1;color:' + c.muted, '⌕') + uiDiv('left:110px;top:38px;white-space:nowrap;font-family:' + ctx.fonts.mono + ';font-size:42px;color:' + c.ink, uiEsc(uiTyped(q, t, typeAt, cps)) + (t < firstAt + 0.4 ? uiCaret(t, c.accent) : '')));
  const n = cards.length, fan = p.layout !== 'row';
  const top = 170, avail = h - top;
  const cw = fan ? Math.min(420, w * 0.44) : (w - 24 * Math.max(0, n - 1)) / Math.max(1, n);
  const chh = fan ? Math.min(560, avail - 40) : Math.min(560, avail);
  const y0 = fan ? top + Math.max(20, (avail - chh) / 2) : top;
  const mid = (n - 1) / 2;
  const fs = Math.min(34, cw * 0.085);
  for (let i = 0; i < n; i++) {
    const cd = cards[i], k = i - mid, isC = fan && Math.abs(k) < 0.5;
    const tone = cd.tone || 'muted';
    const ring = tone === 'accent' || tone === 'alert' ? '0 0 0 3px ' + uiTone(c, tone) : '0 0 0 2px ' + c.line;
    const wellH = chh * 0.39;
    let inner = uiDiv('left:' + uiN(cw * 0.07) + 'px;top:' + uiN(cw * 0.07) + 'px;width:' + uiN(cw * 0.86) + 'px;height:' + uiN(wellH) + 'px;border-radius:14px;background:' + c.well,
      uiDiv('left:' + uiN(cw * 0.05) + 'px;top:' + uiN(wellH * 0.22) + 'px;width:' + uiN(cw * 0.76) + 'px;height:' + uiN(wellH * 0.56) + 'px', uiWave(36, cw * 0.76, wellH * 0.56, 40 + i * 7, tone === 'accent' ? c.accent : c.muted, t, cardAt(i) + 0.05, {d: 0.3})));
    const ty = cw * 0.07 + wellH + 30;
    inner += uiDiv('left:' + uiN(cw * 0.07) + 'px;top:' + uiN(ty) + 'px;right:' + uiN(cw * 0.05) + 'px;white-space:nowrap;overflow:hidden;font-family:' + ctx.fonts.mono + ';font-size:' + uiN(fs) + 'px;font-weight:700;color:' + c.ink, uiEsc(cd.label));
    if (cd.sub) inner += uiDiv('left:' + uiN(cw * 0.07) + 'px;top:' + uiN(ty + fs * 1.5) + 'px;white-space:nowrap;font-family:' + ctx.fonts.mono + ';font-size:' + uiN(fs * 0.76) + 'px;color:' + c.muted, uiEsc(cd.sub));
    if (cd.badge) inner += uiDiv('left:' + uiN(cw * 0.07) + 'px;top:' + uiN(Math.min(chh - 90, ty + fs * 4)) + 'px;' + uiEnter(t, cardAt(i) + 0.18, 'pop'), tone === 'accent' || tone === 'alert' ? uiRingChip(ctx, cd.badge, tone, Math.round(fs * 0.94)) : uiChipHtml(ctx, {text: cd.badge, tone: 'ink', fill: 'quiet', size: Math.round(fs * 0.85)}));
    const base = fan ? 'perspective(1600px) translateX(' + uiN(k * cw * 0.71) + 'px) rotateY(' + uiN(k * -28) + 'deg) rotateZ(' + uiN(k * 4) + 'deg)' : '';
    const x = fan ? (w - cw) / 2 : i * (cw + 24);
    s += uiDiv('left:' + uiN(x) + 'px;top:' + uiN(y0) + 'px;width:' + uiN(cw) + 'px;height:' + uiN(chh) + 'px;border-radius:22px;overflow:hidden;background:linear-gradient(180deg,' + c.panel2 + ',' + c.panel + ');box-shadow:' + ring + ',0 20px 40px rgba(0,0,0,.55);z-index:' + (fan ? Math.round(10 - Math.abs(k) * 2) : 1) + ';' + uiEnter(t, cardAt(i), isC ? 'slam' : fan ? 'zoom' : 'up', {base: base, d: 0.32}), inner);
  }
  return s;
}

/**
 * card-wall: a wall of small clip cards. {cards: [{label, tag, sub}] (repeated to
 * fill count), count (32), cols (4), highlightAt (a lime sweep across the columns,
 * tags turn tagTone), tagTone, ring}. Some cards sit back (dimmed, blurred).
 */
function uiCardWall(el, t, ctx) {
  const p = el.props, c = ctx.c, w = el.rect.width, h = el.rect.height, a0 = el.at;
  const list = p.cards && p.cards.length ? p.cards : [{label: 'clip'}];
  const count = p.count || 32, cols = p.cols || 4, rows = Math.ceil(count / cols);
  const stepX = (w - 40) / cols, cw = stepX * 0.908;
  const stepY = Math.min(stepX * 0.635, h / rows), chh = stepY * 0.897, k = chh / 148;
  const hl = p.highlightAt, kinds = ['zoom', 'left', 'right', 'up', 'down'];
  const tagCol = uiTone(c, p.tagTone, 'accent');
  let s = '';
  if (p.ring !== false) s += uiDiv('left:' + uiN(w * 0.056) + 'px;top:' + uiN(h * 0.1) + 'px;width:' + uiN(w * 0.89) + 'px;height:' + uiN(Math.min(h * 0.23, 300)) + 'px;border-radius:50%;border:3px solid ' + c.accent + '59;box-shadow:0 0 30px ' + c.accent + '26;' + uiEnter(t, a0 + 0.05, 'zoom', {d: 0.5}), '');
  for (let i = 0; i < count; i++) {
    const cd = list[i % list.length], col = i % cols, r = Math.floor(i / cols);
    const x = 20 + col * stepX + (r % 2) * 40 - 20 + (stepX - cw) / 2, y = r * stepY;
    const depth = uiHash(i * 3) > 0.5;
    const lp = hl === undefined ? 0 : uiP(t, hl + col * 0.08 + r * 0.05, 0.3);
    const glow = lp > 0 && lp < 1, lit = hl !== undefined && t >= hl;
    const tag = cd.tag || ['CC0', 'CC BY', 'CC BY-SA'][(i * 7) % 3];
    const sub = cd.sub || '0:0' + (1 + (i % 8)) + '.' + (i % 10);
    const inner = uiDiv('left:' + uiN(14 * k) + 'px;top:' + uiN(12 * k) + 'px;width:' + uiN(cw - 28 * k) + 'px;height:' + uiN(52 * k) + 'px', uiWave(24, cw - 28 * k, 52 * k, i * 9, glow ? c.accent : c.soft, t, a0 + 0.2 + i * 0.055, {d: 0.3})) +
      uiDiv('left:' + uiN(14 * k) + 'px;top:' + uiN(72 * k) + 'px;right:' + uiN(10 * k) + 'px;white-space:nowrap;overflow:hidden;font-family:' + ctx.fonts.mono + ';font-size:' + uiN(24 * k) + 'px;font-weight:700;color:' + c.ink, uiEsc(cd.label)) +
      uiDiv('left:' + uiN(12 * k) + 'px;top:' + uiN(106 * k) + 'px;padding:0 ' + uiN(10 * k) + 'px;border-radius:999px;white-space:nowrap;font-family:' + ctx.fonts.mono + ';font-weight:700;font-size:' + uiN(20 * k) + 'px;background:' + c.line + ';color:' + (lit ? tagCol : c.muted), uiEsc(tag)) +
      uiDiv('right:' + uiN(12 * k) + 'px;top:' + uiN(110 * k) + 'px;font-family:' + ctx.fonts.mono + ';font-size:' + uiN(20 * k) + 'px;color:' + c.muted, uiEsc(sub));
    s += uiDiv('left:' + uiN(x) + 'px;top:' + uiN(y) + 'px;width:' + uiN(cw) + 'px;height:' + uiN(chh) + 'px;overflow:hidden;border-radius:' + uiN(16 * k) + 'px;background:' + c.panel2 + ';box-shadow:0 0 0 2px ' + (glow ? c.accent + ',0 0 24px ' + c.accent + '73' : c.line) + ';' + uiEnter(t, a0 + 0.1 + i * 0.055, kinds[i % 5], {d: 0.34, dist: 180}) + (depth ? 'opacity:.55;filter:blur(1.5px);' : ''), inner);
  }
  return s;
}

/**
 * downloads: a list where picked rows highlight, then their ↓ pops to ✓.
 * {title, sub, prompt, typeAt, cps, items: [{label, sub, pick}], selectAt, doneAt: [s per picked item], counterLabel}.
 * With a title it draws as a window with a typed prompt.
 */
function uiDownloads(el, t, ctx) {
  const p = el.props, c = ctx.c, w = el.rect.width, h = el.rect.height, a0 = el.at;
  const items = p.items || [], picks = [];
  for (let i = 0; i < items.length; i++) if (items[i].pick) picks.push(i);
  const selectAt = p.selectAt === undefined ? a0 + 1 : p.selectAt;
  const doneAt = function (k) { return p.doneAt && p.doneAt[k] !== undefined ? p.doneAt[k] : selectAt + 0.6 + k * 0.5; };
  let s = '', y0 = 30;
  if (p.title) { s += uiHeader(ctx, p.title, p.sub, p.right); y0 = 100; }
  if (p.prompt) {
    const cps = p.cps || 52, ta = p.typeAt === undefined ? a0 + 0.1 : p.typeAt;
    s += uiDiv('left:30px;top:' + (y0 - 4) + 'px;width:' + (w - 60) + 'px;font-family:' + ctx.fonts.mono + ';font-size:34px;line-height:1.35;color:' + c.ink, '<span style="color:' + c.accent + '">❯</span> ' + uiEsc(uiTyped(p.prompt, t, ta, cps)) + (t < selectAt ? uiCaret(t, c.accent) : ''));
    y0 += 150;
  }
  const foot = 90, step = Math.min(140, (h - y0 - foot) / Math.max(1, items.length)), rh = step - 20, k = rh / 120;
  let nd = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i], pk = picks.indexOf(i), pick = pk >= 0;
    const sel = pick && t >= selectAt + pk * 0.08;
    const fly = pick ? uiP(t, doneAt(pk), 0.35) : 0;
    if (pick && t >= doneAt(pk)) nd++;
    let inner = uiDiv('left:' + uiN(20 * k) + 'px;top:' + uiN(20 * k) + 'px;width:' + uiN(220 * k) + 'px;height:' + uiN(80 * k) + 'px', uiWave(26, 220 * k, 80 * k, 60 + i, sel ? c.accent : c.muted, t, a0 + 0.4 + i * 0.07, {d: 0.3}));
    inner += uiDiv('left:' + uiN(270 * k) + 'px;top:' + uiN(24 * k) + 'px;right:110px;white-space:nowrap;overflow:hidden;font-family:' + ctx.fonts.mono + ';font-size:' + uiN(32 * k) + 'px;font-weight:700;color:' + c.ink, uiEsc(it.label));
    if (it.sub) inner += uiDiv('left:' + uiN(270 * k) + 'px;top:' + uiN(70 * k) + 'px;white-space:nowrap;font-family:' + ctx.fonts.mono + ';font-size:' + uiN(24 * k) + 'px;color:' + c.muted, uiEsc(it.sub));
    if (pick) { const b = 60 * k; inner += uiDiv('right:24px;top:' + uiN((rh - b) / 2) + 'px;width:' + uiN(b) + 'px;height:' + uiN(b) + 'px;border-radius:50%;background:' + (fly > 0 ? c.accent : c.line) + ';color:' + (fly > 0 ? c.onAccent : c.muted) + ';font-size:' + uiN(36 * k) + 'px;font-weight:900;text-align:center;line-height:' + uiN(b) + 'px;transform:scale(' + (fly > 0 ? uiOutBack(uiClamp(fly * 2)) : 1).toFixed(3) + ')', fly > 0 ? '✓' : '↓'); }
    s += uiDiv('left:30px;top:' + uiN(y0 + i * step) + 'px;width:' + (w - 60) + 'px;height:' + uiN(rh) + 'px;border-radius:16px;background:' + (sel ? c.tint : c.panel2) + ';box-shadow:0 0 0 ' + (sel ? 3 : 2) + 'px ' + (sel ? c.accent : c.line) + ';' + uiEnter(t, a0 + 0.3 + i * 0.07, 'left', {dist: 120}), inner);
  }
  if (p.counterLabel !== false && picks.length) s += uiDiv('left:30px;top:' + uiN(h - 70) + 'px;font-family:' + ctx.fonts.mono + ';font-size:30px;color:' + c.muted + ';' + uiEnter(t, selectAt, 'up', {dist: 40}), uiEsc(p.counterLabel || 'DOWNLOADS') + ' <span style="color:' + c.accent + ';font-size:40px;font-weight:800">' + nd + '/' + picks.length + '</span>');
  return p.title || p.panel ? '<div style="position:absolute;inset:0;' + uiPanelStyle(c, '') + '">' + s + '</div>' : s;
}

/**
 * comment: a comment box. {avatarLabel, placeholder, text, typeAt, cps (12), sendAt,
 * sent ("you: …", the part before ": " muted), reply, replyAt, links: [labels] or linkLabel}.
 * The text types, the send button dips, the sent bubble and the reply land.
 */
function uiComment(el, t, ctx) {
  const p = el.props, c = ctx.c, w = el.rect.width, a0 = el.at;
  const text = String(p.text || ''), cps = p.cps || 12;
  const typeAt = p.typeAt === undefined ? a0 + 0.3 : p.typeAt;
  const sendAt = p.sendAt === undefined ? typeAt + text.length / cps + 0.4 : p.sendAt;
  const replyAt = p.replyAt === undefined ? sendAt + 0.8 : p.replyAt;
  const pr = uiP(t, sendAt, 0.16), press = pr > 0 && pr < 1 ? 1 - Math.sin(pr * Math.PI) * 0.15 : 1;
  const typing = t >= typeAt && t < sendAt;
  let s = uiDiv('left:0;top:0;width:' + w + 'px;height:120px;border-radius:60px;background:' + c.panel2 + ';box-shadow:0 0 0 2px ' + c.line,
    uiDiv('left:20px;top:20px;width:80px;height:80px;border-radius:50%;background:' + c.line + ';color:' + c.muted + ';font-family:' + ctx.fonts.body + ';font-size:' + (String(p.avatarLabel || 'you').length > 3 ? 26 : 36) + 'px;text-align:center;line-height:80px;overflow:hidden', uiEsc(p.avatarLabel || 'you')) +
    uiDiv('left:130px;top:34px;right:120px;white-space:nowrap;overflow:hidden;font-family:' + ctx.fonts.body + ';font-size:44px;font-weight:700;color:' + c.ink, typing ? uiEsc(uiTyped(text, t, typeAt, cps)) + uiCaret(t, c.accent) : '<span style="color:' + c.muted + ';font-weight:600">' + uiEsc(p.placeholder || 'Add a comment…') + '</span>') +
    uiDiv('right:18px;top:18px;width:84px;height:84px;border-radius:50%;background:' + c.accent + ';color:' + c.onAccent + ';font-size:44px;text-align:center;line-height:84px;transform:scale(' + press.toFixed(3) + ')', '➤'));
  const sent = p.sent === undefined ? 'you: ' + text : String(p.sent || '');
  if (sent) {
    const cut = sent.indexOf(': ');
    const body = cut > 0 ? '<span style="color:' + c.muted + ';font-weight:600">' + uiEsc(sent.slice(0, cut + 1)) + '</span> ' + uiEsc(sent.slice(cut + 2)) : uiEsc(sent);
    s += uiDiv('left:0;top:150px;width:' + uiN(w * 0.73) + 'px;height:110px;border-radius:24px;background:' + c.line + ';' + uiEnter(t, sendAt + 0.15, 'up', {dist: 100}), uiDiv('left:24px;top:28px;right:20px;white-space:nowrap;overflow:hidden;font-family:' + ctx.fonts.body + ';font-size:44px;font-weight:700;color:' + c.ink, body));
  }
  if (p.reply) {
    const links = p.links || (p.linkLabel ? [p.linkLabel] : []);
    let inner = uiDiv('left:24px;top:22px;right:20px;white-space:nowrap;overflow:hidden;font-family:' + ctx.fonts.body + ';font-size:38px;font-weight:700;color:' + c.ink, uiEsc(p.reply));
    let lx = 24;
    for (let i = 0; i < links.length; i++) {
      inner += uiDiv('left:' + lx + 'px;top:110px;' + uiEnter(t, replyAt + 0.1 + i * 0.1, 'pop'), uiChipHtml(ctx, {text: '↗ ' + links[i], size: 26}));
      lx += Math.round(String(links[i]).length * 15.6 + 2 * 26 * 0.6 + 50);
    }
    s += uiDiv('left:' + uiN(w * 0.25) + 'px;top:285px;width:' + uiN(w * 0.75) + 'px;height:' + (links.length ? 200 : 100) + 'px;border-radius:24px;background:' + c.tint + ';box-shadow:0 0 0 3px ' + c.accent + ';' + uiEnter(t, replyAt, 'up', {dist: 100}), inner);
  }
  return s;
}

/**
 * frame-ruler: a ruler of frame numbers; the playhead eases from start to target,
 * the target number turns accent, a clip drops into the dashed slot.
 * {from, target, start, snapAt, pin, lane, slot: {label, dropAt}, counterLabel}.
 */
function uiFrameRuler(el, t, ctx) {
  const p = el.props, c = ctx.c, w = el.rect.width, h = el.rect.height, a0 = el.at;
  const target = p.target === undefined ? 547 : p.target, from = p.from === undefined ? target - 9 : p.from;
  const start = p.start === undefined ? target - 3 : p.start;
  const snapAt = p.snapAt === undefined ? a0 + 1 : p.snapAt;
  const slot = p.slot || {}, dropAt = slot.dropAt === undefined ? snapAt + 0.4 : slot.dropAt;
  const step = 120, xOf = function (f) { return w / 2 - 38 + (f - target) * step; };
  const ph = uiP(t, a0 + 0.1, Math.max(0.2, snapAt - a0 - 0.1)), pos = uiLerp(start, target, uiOutBack(ph, 1.1)), cur = Math.round(pos);
  const done = t >= snapAt, ry = 340;
  let r = '';
  for (let f = from; f <= target + (target - from); f++) {
    const x = xOf(f);
    if (x < -140 || x > w + 20) continue;
    r += uiDiv('left:' + uiN(x) + 'px;top:0;font-family:' + ctx.fonts.mono + ';font-size:34px;font-weight:600;color:' + (f === target && done ? c.accent : c.soft), uiPad(f, 4)) + uiDiv('left:' + uiN(x + 38) + 'px;top:52px;width:3px;height:70px;background:' + c.dim, '') + uiDiv('left:' + uiN(x + 98) + 'px;top:90px;width:2px;height:32px;background:' + c.line2, '');
  }
  let s = uiDiv('left:0;top:' + ry + 'px;width:' + w + 'px;height:130px;' + uiEnter(t, a0, 'left', {dist: 300, d: 0.4}), r);
  const pinX = xOf(target) + 38;
  s += uiDiv('left:' + uiN(pinX - 2) + 'px;top:80px;width:5px;height:' + (ry - 80) + 'px;background:' + c.accent + ';' + uiEnter(t, a0 + 0.15, 'down', {dist: 70}),
    uiDiv('left:-40px;top:-80px;width:84px;height:84px;border-radius:50%;background:' + c.accent + ';box-shadow:0 0 40px ' + c.accent, '<div style="margin:26px;width:32px;height:32px;border-radius:50%;background:' + c.bg + '"></div>') +
    uiDiv('left:60px;top:-66px;white-space:nowrap;border-radius:999px;padding:6px 18px;font-family:' + ctx.fonts.mono + ';font-weight:700;font-size:36px;background:' + c.ink + ';color:' + c.bg, uiEsc(p.pin || 'HIT · F ' + uiPad(target, 4))));
  const phx = xOf(pos) + 38, phH = Math.min(560, h - 280 - 160);
  s += uiDiv('left:' + uiN(phx - 3) + 'px;top:280px;width:7px;height:' + uiN(phH) + 'px;background:#ffffff;box-shadow:0 0 14px #ffffff;' + uiEnter(t, a0 + 0.1, 'down', {dist: 100}), '<div style="position:absolute;left:-18px;top:-10px;width:42px;height:34px;background:#ffffff;clip-path:polygon(0 0,100% 0,100% 60%,50% 100%,0 60%)"></div>');
  if (p.lane !== false) s += uiDiv('left:40px;top:540px;font-family:' + ctx.fonts.mono + ';font-size:36px;color:' + c.muted + ';' + uiEnter(t, a0 + 0.2, 'left', {dist: 80}), uiEsc(p.lane || 'A2 · sfx'));
  if (p.slot !== false) {
    const sw = Math.max(160, Math.min(380, w - pinX - 20));
    s += uiDiv('left:' + uiN(pinX) + 'px;top:520px;width:' + uiN(sw) + 'px;height:150px;box-sizing:border-box;border:4px dashed ' + c.accent + ';border-radius:12px;' + uiEnter(t, a0 + 0.25, 'pop'), '');
    s += uiDiv('left:' + uiN(pinX) + 'px;top:520px;width:' + uiN(sw) + 'px;height:150px;border-radius:12px;background:' + c.accentDim + ';box-shadow:0 0 0 4px ' + c.accent + ',0 0 40px ' + c.accent + '66;' + uiEnter(t, dropAt, 'drop', {dist: 260, d: 0.3}),
      uiDiv('left:16px;top:10px;white-space:nowrap;font-family:' + ctx.fonts.mono + ';font-size:26px;color:' + c.accent, uiEsc(slot.label || '▸ impact.wav')) + uiDiv('left:16px;top:50px;width:' + uiN(sw - 40) + 'px;height:86px', uiWave(30, sw - 40, 86, 88, c.accent, t, -1, {env: function (q) { return Math.exp(-q * 4); }})));
  }
  if (p.counterLabel !== false) {
    const bw = Math.min(580, w - 80);
    s += uiDiv('left:' + uiN((w - bw) / 2) + 'px;top:' + uiN(h - 140) + 'px;width:' + uiN(bw) + 'px;height:140px;border-radius:20px;background:' + c.panel + ';box-shadow:0 0 0 2px ' + c.line + ';text-align:center;white-space:nowrap;' + uiEnter(t, a0 + 0.3, 'up', {dist: 100}),
      '<span style="font-family:' + ctx.fonts.mono + ';font-size:36px;color:' + c.muted + ';letter-spacing:.1em;line-height:140px">' + uiEsc(p.counterLabel || 'FRAME') + ' </span><span style="font-family:' + ctx.fonts.mono + ';font-size:96px;font-weight:800;line-height:140px;color:' + (done ? c.accent : c.ink) + '">' + uiPad(cur, 4) + '</span>');
  }
  return s;
}

/**
 * pad-grid: a sequencer of sound pads; the lit pad steps once running.
 * {pads: [names], cols (3), runAt, rate (steps a second)}.
 */
function uiPadGrid(el, t, ctx) {
  const p = el.props, c = ctx.c, w = el.rect.width, h = el.rect.height, a0 = el.at;
  const pads = p.pads || ['kick', 'snap', 'whoosh', 'riser', 'hit', 'click', 'swell', 'pop', 'tail'];
  const n = pads.length, cols = p.cols || 3, rows = Math.ceil(n / cols), gap = 20;
  const cw = (w - gap * (cols - 1)) / cols, ch = Math.min(cw * 0.82, (h - gap * (rows - 1)) / rows);
  const runAt = p.runAt === undefined ? a0 + n * 0.085 + 0.3 : p.runAt, rate = p.rate || 7;
  const beat = t >= runAt ? Math.floor((t - runAt) * rate) % n : -1;
  const kinds = ['zoom', 'down', 'right', 'left', 'pop', 'right', 'up', 'left', 'zoom'];
  const k = Math.min(1, ch / 230);
  let s = '';
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), cc = i % cols, lit = beat === i;
    const inner = uiDiv('left:20px;top:20px;width:' + uiN(cw - 40) + 'px;height:' + uiN(ch * 0.48) + 'px', uiWave(22, cw - 40, ch * 0.48, i * 5, lit ? c.accent : c.muted, t, a0 + i * 0.085 + 0.08, {d: 0.3})) +
      uiDiv('left:20px;top:' + uiN(ch - 70 * k) + 'px;white-space:nowrap;font-family:' + ctx.fonts.mono + ';font-size:' + uiN(32 * k) + 'px;font-weight:700;color:' + c.ink, uiEsc(pads[i])) +
      uiDiv('right:18px;top:' + uiN(ch - 64 * k) + 'px;font-family:' + ctx.fonts.mono + ';font-size:' + uiN(22 * k) + 'px;color:' + c.muted, uiPad(i + 1));
    s += uiDiv('left:' + uiN(cc * (cw + gap)) + 'px;top:' + uiN(r * (ch + gap)) + 'px;width:' + uiN(cw) + 'px;height:' + uiN(ch) + 'px;border-radius:20px;background:' + (lit ? c.tint : c.panel2) + ';box-shadow:0 0 0 ' + (lit ? '4px ' + c.accent + ',0 0 30px ' + c.accent + '4d' : '2px ' + c.line) + ';' + uiEnter(t, a0 + i * 0.085, kinds[i % 9], {d: 0.32}), inner);
  }
  return s;
}

/**
 * scan-plane: a flat analysis plane (tilt it with el.tilt): a thumbnail row, a long
 * waveform, marker pins that drop as the glowing scan line reaches them, dashed slots.
 * {thumbs (9), markers: [{at, label, x (0–1)}], scanAt, scanDur}.
 */
function uiScanPlane(el, t, ctx) {
  const p = el.props, c = ctx.c, w = el.rect.width, h = el.rect.height, a0 = el.at;
  const nt = p.thumbs === undefined ? 9 : p.thumbs, markers = p.markers || [];
  const scanAt = p.scanAt === undefined ? a0 + 0.5 : p.scanAt, scanDur = p.scanDur || 3.4;
  let s = '';
  const tStep = (w - 40) / Math.max(1, nt), tw = tStep * 0.92, th = Math.min(150, h * 0.27);
  for (let i = 0; i < nt; i++) s += uiDiv('left:' + uiN(20 + i * tStep) + 'px;top:30px;width:' + uiN(tw) + 'px;height:' + uiN(th) + 'px;border-radius:10px;background:' + c.panel3 + ';' + uiEnter(t, a0 + 0.2 + i * 0.05, 'up', {dist: 60}),
    uiDiv('left:' + uiN(tw * 0.26) + 'px;top:' + uiN(th * 0.27) + 'px;width:' + uiN(tw * 0.48) + 'px;height:' + uiN(tw * 0.48) + 'px;border-radius:' + (i % 3 ? '50%' : '6px') + ';background:' + c.dim, ''));
  const wy = h * 0.375, wh = h * 0.27;
  s += uiDiv('left:20px;top:' + uiN(wy) + 'px;width:' + (w - 40) + 'px;height:' + uiN(wh) + 'px', uiWave(Math.round((w - 40) / 10.2), w - 40, wh, 55, c.muted, t, a0 + 0.3, {d: 0.6}));
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    const fx = m.x !== undefined ? m.x : 0.1 + 0.75 * i / Math.max(1, markers.length - 1);
    const x = fx * w;
    const at = m.at !== undefined ? m.at : scanAt + scanDur * uiClamp((x + 40) / (w - 20));
    s += uiDiv('left:' + uiN(x) + 'px;top:0;width:4px;height:' + h + 'px;background:' + c.accent + ';box-shadow:0 0 12px ' + c.accent + ';' + uiEnter(t, at, 'down', {dist: 120, d: 0.25}),
      '<div style="position:absolute;left:-16px;top:-18px;width:36px;height:36px;border-radius:50%;background:' + c.accent + '"></div>' + (m.label ? '<div style="position:absolute;left:24px;top:-20px;white-space:nowrap;border-radius:999px;padding:6px 18px;font-family:' + ctx.fonts.mono + ';font-weight:700;font-size:24px;background:' + c.ink + ';color:' + c.bg + '">' + uiEsc(m.label) + '</div>' : ''));
    s += uiDiv('left:' + uiN(x - 40) + 'px;top:' + uiN(h * 0.714) + 'px;width:120px;height:' + uiN(Math.min(90, h * 0.16)) + 'px;box-sizing:border-box;border-radius:10px;border:3px dashed ' + c.accent + ';background:' + c.accent + '1f;' + uiEnter(t, at + 0.12, 'drop', {dist: 120}), '');
  }
  const sq = uiP(t, scanAt, scanDur), fade = 1 - uiP(t, scanAt + scanDur, 0.4);
  if (t >= scanAt && fade > 0) s += uiDiv('left:' + uiN(uiLerp(-40, w - 60, sq)) + 'px;top:-20px;width:8px;height:' + (h + 40) + 'px;background:#ffffff;box-shadow:0 0 30px 8px ' + c.accent + '99;opacity:' + fade.toFixed(3), '');
  return '<div style="position:absolute;inset:0;' + uiPanelStyle(c, '') + 'overflow:visible">' + s + '</div>';
}

export {UI_COMPONENT_TABLE, uiStack, uiBar, uiRingChip, uiMeter, uiMarkerSnap, uiTerminal, uiResults, uiCardWall, uiDownloads, uiComment, uiFrameRuler, uiPadGrid, uiScanPlane};

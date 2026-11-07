// The ui-scene painter: animated interface scenes (editor timelines, meters,
// locked tool cards, terminals, search results, card walls) drawn as DOM by a
// pure function of time. paintUi(host, spec, t) writes the host's HTML for the
// absolute timeline time t (ui-runtime.mjs), so seeking to any t draws the same frame:
// HyperFrames calls it from a proxy tween's onUpdate on the paused timeline,
// Remotion from a layout effect (docs/KIT_CONTRACTS.md, "UI scenes").
//
// A spec is {start, width, height, unit, theme, fonts, elements}: canvas size
// in design px (the canvas divided by unit), and elements placed in design px
// (1080 wide in 9:16, 1920 wide in 16:9). Every element is {kind, rect: {x, y,
// width, height}, at, enter, out, props, beats, children}; times are seconds
// from the scene start. beats[] are {at, set: {...props}}: from `at` on, the
// element draws with those props merged in, so a chip can flip its text or a
// card its tone without a component of its own.
//
// Settled elements hold still: life comes from entrances (spring overshoot,
// speed blur), timed beats inside components and the shared camera. Nothing
// floats on its own.
//
// Every function here, in ui-components.mjs and in ui-runtime.mjs is listed in
// ui-runtime.mjs RUNTIME_FUNCTIONS and only calls the others, so UI_RUNTIME
// (their source) runs in the page on its own. No wall clock, no Math.random,
// no timers, no module-level constants.

// ---------------------------------------------------------------------------
// Helpers

function uiClamp(v, a, b) { const lo = a === undefined ? 0 : a, hi = b === undefined ? 1 : b; return Math.max(lo, Math.min(hi, v)); }
function uiP(t, a, d) { return d > 0 ? uiClamp((t - a) / d) : (t >= a ? 1 : 0); }
function uiLerp(a, b, p) { return a + (b - a) * p; }
function uiOutExpo(p) { return p >= 1 ? 1 : 1 - Math.pow(2, -10 * p); }
function uiOutCubic(p) { return 1 - Math.pow(1 - p, 3); }
function uiInOut(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
function uiOutBack(p, s) { const k = s === undefined ? 1.5 : s; return 1 + (k + 1) * Math.pow(p - 1, 3) + k * Math.pow(p - 1, 2); }
function uiHash(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function uiPad(n, k) { return String(n).padStart(k === undefined ? 2 : k, '0'); }
function uiEsc(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function uiN(v) { return Math.round(v * 100) / 100; }

/**
 * An entrance at t0 as inline style: kinds up, down, left, right, zoom, slam,
 * pop, drop, fade. Spring kinds (slam, pop, or any with o.ov) overshoot; the
 * move blurs while it is fast. o: {d, dist, ov, base (a transform kept under
 * the move)}. Before t0 the element is hidden.
 */
function uiEnter(t, t0, kind, o) {
  const opt = o || {}, base = opt.base || '';
  if (t < t0) return 'opacity:0;visibility:hidden;' + (base ? 'transform:' + base + ';' : '');
  const k = kind || 'up', d = opt.d || 0.36, p = uiClamp((t - t0) / d);
  const spring = k === 'slam' || k === 'pop' || opt.ov;
  const e = spring ? uiOutBack(p, opt.ov || 1.4) : uiOutExpo(p), v = 1 - uiOutExpo(p);
  const dist = opt.dist || 140;
  let tr = '', bl = 0;
  if (k === 'up') { tr = 'translateY(' + uiN((1 - e) * dist) + 'px)'; bl = v * 3; }
  else if (k === 'down') { tr = 'translateY(' + uiN(-(1 - e) * dist) + 'px)'; bl = v * 3; }
  else if (k === 'left') { tr = 'translateX(' + uiN(-(1 - e) * dist) + 'px)'; bl = v * 3; }
  else if (k === 'right') { tr = 'translateX(' + uiN((1 - e) * dist) + 'px)'; bl = v * 3; }
  else if (k === 'zoom') { tr = 'scale(' + uiN(uiLerp(0.5, 1, e) * 1000) / 1000 + ')'; bl = v * 8; }
  else if (k === 'slam') { tr = 'scale(' + uiN(uiLerp(2.1, 1, e) * 1000) / 1000 + ')'; bl = v * 5; }
  else if (k === 'pop') { tr = 'scale(' + uiN(Math.max(0, e) * 1000) / 1000 + ')'; }
  else if (k === 'drop') { tr = 'translateY(' + uiN(-(1 - e) * dist) + 'px) rotate(' + uiN((1 - e) * -8) + 'deg)'; bl = v * 3; }
  const op = k === 'fade' ? uiClamp(p * 1.4) : uiClamp(p * 5);
  return 'opacity:' + op.toFixed(3) + ';transform:' + base + ' ' + tr + ';' + (bl > 0.4 ? 'filter:blur(' + bl.toFixed(1) + 'px);' : '');
}

/** An exit at t0 (lift, fade, blur) layered over the entrance style; '' before t0. */
function uiExit(t, t0) {
  if (t0 === undefined || t0 === null || t < t0) return '';
  const p = uiClamp((t - t0) / 0.28);
  return 'opacity:' + (1 - p).toFixed(3) + ';translate:0 ' + uiN(-40 * uiOutCubic(p)) + 'px;' + (p > 0.05 && p < 1 ? 'filter:blur(' + (p * 6).toFixed(1) + 'px);' : '');
}

/** A decaying shake in px from t0. */
function uiShake(t, t0, amp, dur) { const p = uiP(t, t0, dur || 0.32); if (p <= 0 || p >= 1) return 0; return Math.sin(p * 46) * (amp || 12) * (1 - p); }
/** The first characters of text typed from t0 at cps characters a second. */
function uiTyped(text, t, t0, cps) { const s = String(text); return s.slice(0, t < t0 ? 0 : Math.min(s.length, Math.floor((t - t0) * (cps || 26)))); }
function uiCaret(t, color) { return '<span style="display:inline-block;width:.55em;height:1em;vertical-align:-.12em;background:' + color + ';opacity:' + (Math.floor(t * 3) % 2 ? 0 : 1) + '"></span>'; }
function uiDiv(style, inner) { return '<div style="position:absolute;' + style + '">' + (inner || '') + '</div>'; }

/**
 * Waveform bars: n bars across w × h, heights from seed, appearing left to
 * right from t0 over o.d s. col is a colour or a function of position 0–1;
 * o.env(position) shapes the envelope.
 */
function uiWave(n, w, h, seed, col, t, t0, o) {
  const opt = o || {}, d = opt.d === undefined ? 0.4 : opt.d, bw = w / n;
  const from = t0 === undefined ? -1e9 : t0, now = t === undefined ? 1e9 : t;
  let s = '';
  for (let i = 0; i < n; i++) {
    const tt = from + d * i / n;
    if (now < tt) break;
    const env = opt.env ? opt.env(i / n) : 0.35 + 0.65 * Math.sin(Math.PI * (i + 0.5) / n);
    const hh = Math.max(4, h * env * (0.3 + 0.7 * uiHash(i + seed)));
    const g = uiClamp((now - tt) / 0.12);
    const c = typeof col === 'function' ? col(i / n) : col;
    s += '<div style="position:absolute;left:' + uiN(i * bw) + 'px;width:' + uiN(bw * 0.62) + 'px;height:' + uiN(hh * g) + 'px;bottom:' + uiN((h - hh * g) / 2) + 'px;border-radius:4px;background:' + c + '"></div>';
  }
  return s;
}

/** A tone name (ink, muted, accent, alert, panel) → colour from the theme; a hex passes through. */
function uiTone(c, tone, fallback) {
  const name = tone || fallback || 'ink';
  if (typeof name === 'string' && name.charAt(0) === '#') return name;
  return c[name] || c.ink;
}

/** A pill: {text, tone, fill (solid|outline|quiet), size, weight, font}. */
function uiChipHtml(ctx, o) {
  const c = ctx.c, tone = uiTone(c, o.tone, 'accent'), size = o.size || 30;
  const fill = o.fill || 'solid';
  const bg = fill === 'solid' ? tone : fill === 'outline' ? c.tint : c.panel2;
  const fg = fill === 'solid' ? (o.tone === 'alert' ? '#ffffff' : c.onAccent) : fill === 'outline' ? tone : c.muted;
  const ring = fill === 'outline' ? 'box-shadow:0 0 0 3px ' + tone + (o.glow ? ',0 0 30px ' + tone + '73' : '') + ';' : o.glow ? 'box-shadow:0 0 30px ' + tone + '99;' : '';
  return '<div style="display:inline-block;white-space:nowrap;border-radius:999px;padding:' + uiN(size * 0.2) + 'px ' + uiN(size * 0.6) + 'px;font-family:' + (o.font === 'display' ? ctx.fonts.display : ctx.fonts.mono) + ';font-weight:' + (o.weight || 700) + ';font-size:' + size + 'px;background:' + bg + ';color:' + fg + ';' + ring + '">' + uiEsc(o.text) + '</div>';
}

function uiDots(c) { return '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;margin-right:8px;background:#ff5f57"></span><span style="display:inline-block;width:14px;height:14px;border-radius:50%;margin-right:8px;background:#febc2e"></span><span style="display:inline-block;width:14px;height:14px;border-radius:50%;margin-right:14px;background:#28c840"></span>'; }

/** A window's title bar: traffic lights, title, a muted subtitle and right-hand text. */
function uiHeader(ctx, title, sub, right) {
  const c = ctx.c;
  return '<div style="position:absolute;left:0;right:0;top:0;height:64px;border-bottom:2px solid ' + c.line + ';font-family:' + ctx.fonts.mono + ';font-size:28px;font-weight:600;display:flex;align-items:center;padding:0 24px;white-space:nowrap;color:' + c.ink + '">' + uiDots(c) + uiEsc(title) + (sub ? '<span style="color:' + c.muted + '">&nbsp;· ' + uiEsc(sub) + '</span>' : '') + (right ? '<span style="margin-left:auto;color:' + c.muted + '">' + uiEsc(right) + '</span>' : '') + '</div>';
}

function uiPanelStyle(c, ring) { return 'background:linear-gradient(180deg,' + c.panel2 + ',' + c.panel + ');border-radius:26px;box-shadow:0 0 0 ' + (ring ? '3px ' + ring : '2px ' + c.line) + ',0 30px 70px rgba(0,0,0,.6);overflow:hidden;'; }

// ---------------------------------------------------------------------------
// Components. Each is (el, t, ctx) → inner HTML for el.rect (design px, the
// element's own box at 0,0); t is seconds from the scene start, el.props has
// the beats applied.

/** headline: {text, size, tone, glow, align, weight, swap: {at, text, size}}. */
function uiHeadline(el, t, ctx) {
  const p = el.props, c = ctx.c;
  const swapped = p.swap && t >= p.swap.at;
  const text = swapped ? p.swap.text : p.text, size = (swapped && p.swap.size) || p.size || 112;
  const color = uiTone(c, p.tone, 'ink');
  const glow = p.glow ? 'text-shadow:0 0 28px ' + color + '8c,0 0 6px ' + color + '99;' : '';
  return '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:' + (p.align === 'left' ? 'flex-start' : p.align === 'right' ? 'flex-end' : 'center') + '"><div style="font-family:' + ctx.fonts.display + ';font-weight:' + (p.weight || 900) + ';letter-spacing:-.045em;line-height:.92;white-space:nowrap;font-size:' + size + 'px;color:' + color + ';' + glow + '">' + uiEsc(text) + '</div></div>';
}

/** chip: {text, tone, fill, size, rotate, glow, font}. */
function uiChip(el, t, ctx) {
  const p = el.props;
  return '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:' + (p.align === 'left' ? 'flex-start' : 'center') + '">' + uiChipHtml(ctx, p) + '</div>';
}

/** waveform: {bars, seed, tone, clipAt (turns the alert tone, dashed limits), draw (s), shape (even|rise|decay|pulse)}. */
function uiWaveform(el, t, ctx) {
  const p = el.props, c = ctx.c, w = el.rect.width, h = el.rect.height;
  const clipped = p.clipAt !== undefined && t >= p.clipAt;
  const base = uiTone(c, p.tone, 'muted');
  const shape = p.shape || 'even';
  const env = shape === 'rise' ? function (q) { return 0.1 + 0.9 * Math.pow(q, 1.6); } : shape === 'decay' ? function (q) { return Math.exp(-q * 4); } : shape === 'pulse' ? function (q) { return 0.45 + 0.55 * Math.abs(Math.sin(q * 9)); } : null;
  const col = clipped ? function (q) { return uiHash(q * 97) > 0.35 ? c.alert : c.alertDeep; } : base;
  const amp = clipped ? h : h * 0.7;
  let s = uiDiv('left:0;top:' + uiN((h - amp) / 2) + 'px;width:' + w + 'px;height:' + uiN(amp) + 'px', uiWave(p.bars || Math.max(12, Math.round(w / 14)), w, amp, p.seed || 3, col, t, el.at, {d: p.draw === undefined ? 0.45 : p.draw, env: env}));
  if (clipped) s += uiDiv('left:0;right:0;top:0;border-top:3px dashed ' + c.alert, '') + uiDiv('left:0;right:0;bottom:0;border-top:3px dashed ' + c.alert, '');
  return s;
}

/**
 * window: a panel with a title bar ({title, sub, right, ring}) and children
 * placed inside it (child rects relative to the window). Children enter on
 * their own times.
 */
function uiWindow(el, t, ctx) {
  const p = el.props, c = ctx.c;
  let s = '<div style="position:absolute;inset:0;' + uiPanelStyle(c, p.ring ? uiTone(c, p.ring) : '') + '">';
  if (p.title) s += uiHeader(ctx, p.title, p.sub, p.right);
  s += uiChildren(el.children, t, ctx);
  return s + '</div>';
}

/**
 * timeline: an editor sequence. {title, sub, tracks: [{label, kind (video|audio|sfx|text), clips: [{label, x, width, tone}], wave, seed}],
 * playhead: {from, to, at, dur} (0–1 across the lanes), meter: {level 0–16, alertAt, level2}, clipAt (the audio clips red), timecode}.
 * Clip labels flip with beats on the element (set.tracks) or per clip {flipAt, flipLabel, flipTone}.
 */
function uiTimeline(el, t, ctx) {
  const p = el.props, c = ctx.c, w = el.rect.width, h = el.rect.height;
  const tracks = p.tracks || [];
  const meterW = p.meter ? 64 : 0;
  const laneX = 116, laneW = w - laneX - 24 - meterW;
  const top0 = 150, avail = h - top0 - 90, gap = 12;
  const weights = tracks.map(function (tr) { return tr.kind === 'audio' ? 1.6 : 1; });
  const sum = weights.reduce(function (a, b) { return a + b; }, 0) || 1;
  const unitH = (avail - gap * Math.max(0, tracks.length - 1)) / sum;
  const clipped = p.clipAt !== undefined && t >= p.clipAt;
  let s = uiHeader(ctx, p.title || 'sequence_01', p.sub, p.timecode === false ? '' : '00:00:' + uiPad(Math.floor(Math.max(0, t) * 30 / 30) % 60) + ':' + uiPad(Math.floor(Math.max(0, t) * 30) % 30));
  let r = '';
  for (let i = 0; i * 20 < laneW; i++) r += uiDiv('left:' + (laneX + 14 + i * 20) + 'px;top:' + (i % 5 ? 112 : 96) + 'px;width:2px;height:' + (i % 5 ? 14 : 30) + 'px;background:' + c.line2, '');
  s += uiDiv('left:0;top:0;width:' + w + 'px;height:130px;' + uiEnter(t, el.at + 0.05, 'down', {dist: 40}), r);
  let y = top0;
  for (let i = 0; i < tracks.length; i++) {
    const tr = tracks[i], th = uiN(unitH * weights[i]);
    const red = clipped && tr.kind === 'audio';
    let inner = '<div style="position:absolute;left:20px;width:84px;height:' + th + 'px;display:flex;align-items:center;justify-content:center;font-family:' + ctx.fonts.mono + ';font-weight:700;font-size:28px;color:' + (red ? c.alert : c.muted) + ';background:' + c.panel2 + ';border-radius:10px">' + uiEsc(tr.label) + '</div>';
    let lane = '';
    if (tr.kind === 'audio' || tr.wave) {
      const amp = red ? th - 16 : th * 0.62;
      lane += uiDiv('left:12px;top:6px;font-family:' + ctx.fonts.mono + ';font-size:22px;color:' + c.muted, uiEsc(tr.name || ''));
      lane += uiDiv('left:10px;top:' + uiN((th - amp) / 2 + (tr.name ? 8 : 0)) + 'px;width:' + (laneW - 20) + 'px;height:' + uiN(amp) + 'px', uiWave(Math.round(laneW / 12), laneW - 20, amp, tr.seed || i * 7 + 3, red ? function (q) { return uiHash(q * 97) > 0.35 ? c.alert : c.alertDeep; } : (tr.kind === 'audio' ? c.muted : c.line2), t, el.at + 0.25, {d: 0.45}));
      if (red) lane += uiDiv('left:0;right:0;top:10px;border-top:3px dashed ' + c.alert, '') + uiDiv('left:0;right:0;bottom:10px;border-top:3px dashed ' + c.alert, '');
    }
    const clips = tr.clips || [];
    for (let j = 0; j < clips.length; j++) {
      const cl = clips[j];
      const flip = cl.flipAt !== undefined ? uiP(t, cl.flipAt, 0.26) : 0;
      const flipped = flip >= 0.5;
      const label = flipped ? cl.flipLabel : cl.label, tone = flipped ? cl.flipTone || 'accent' : cl.tone;
      const cx = uiN((cl.x || 0) * laneW), cw = uiN((cl.width || 0.25) * laneW);
      const sc = flip > 0 && flip < 1 ? Math.abs(Math.cos(flip * Math.PI)) : 1;
      const loud = tone === 'alert';
      const fillBg = !tone ? c.panel3 : loud ? c.alert : c.tint;
      const fg = !tone ? c.ink : loud ? '#ffffff' : uiTone(c, tone);
      const ring = !tone ? '' : loud ? 'box-shadow:0 0 0 4px #ffffff,0 10px 24px ' + c.alert + '66;' : 'box-shadow:0 0 0 3px ' + uiTone(c, tone) + ';';
      const rot = loud && !flipped ? cl.rotate || 0 : 0;
      const enterAt = cl.at !== undefined ? cl.at : el.at + 0.2 + j * 0.06;
      lane += uiDiv('left:' + cx + 'px;top:8px;width:' + cw + 'px;height:' + uiN(th - 16) + 'px;border-radius:12px;background:' + fillBg + ';' + ring + 'color:' + fg + ';font-family:' + (loud ? ctx.fonts.display : ctx.fonts.mono) + ';font-weight:' + (loud ? 900 : 700) + ';' + (loud ? 'font-style:italic;' : '') + 'font-size:' + uiN(Math.min(34, (th - 16) * 0.42)) + 'px;display:flex;align-items:center;justify-content:center;white-space:nowrap;overflow:hidden;' + uiEnter(t, enterAt, loud ? 'slam' : 'pop', {base: 'scaleY(' + sc.toFixed(3) + ') rotate(' + rot + 'deg)', d: 0.3}), uiEsc(label));
    }
    inner += uiDiv('left:116px;top:0;width:' + laneW + 'px;height:' + th + 'px;background:' + (red ? c.alertBg : c.lane) + ';border-radius:10px;overflow:' + (clips.length ? 'visible' : 'hidden'), lane);
    s += uiDiv('left:0;top:' + uiN(y) + 'px;width:' + w + 'px;height:' + th + 'px;' + uiEnter(t, el.at + 0.08 + i * 0.07, 'left', {dist: 90}), inner);
    y += th + gap;
  }
  if (p.meter) {
    const m = p.meter, lvl = m.alertAt !== undefined && t >= m.alertAt ? 14 : m.level2 !== undefined && m.level2At !== undefined && t >= m.level2At ? m.level2 : (m.level === undefined ? 7 : m.level);
    let bars = '';
    const mh = (h - top0 - 100) / 16;
    for (let i = 0; i < 16; i++) { const on = 15 - i < lvl; const col = 15 - i > 11 ? c.alert : 15 - i > 8 ? '#e6d040' : c.accent; bars += uiDiv('left:0;top:' + uiN(i * mh) + 'px;width:24px;height:' + uiN(mh * 0.78) + 'px;border-radius:4px;background:' + (on ? col : c.line), ''); }
    s += uiDiv('left:' + (w - meterW) + 'px;top:' + top0 + 'px;' + uiEnter(t, el.at + 0.2, 'right', {dist: 60}), bars);
  }
  if (p.playhead) {
    const ph = p.playhead, q = uiP(t, ph.at === undefined ? el.at : ph.at, ph.dur || 3);
    const x = laneX + uiLerp(ph.from || 0.05, ph.to === undefined ? 0.7 : ph.to, uiInOut(q)) * laneW;
    s += uiDiv('left:' + uiN(x) + 'px;top:88px;width:4px;height:' + uiN(h - 170) + 'px;background:#ffffff;box-shadow:0 0 12px rgba(255,255,255,.6);' + uiEnter(t, el.at + 0.3, 'down', {dist: 60}), '<div style="position:absolute;left:-12px;top:-6px;width:28px;height:22px;background:#ffffff;clip-path:polygon(0 0,100% 0,100% 60%,50% 100%,0 60%)"></div>');
  }
  s += uiDiv('left:30px;top:' + (h - 74) + 'px;width:' + (w - 60) + 'px;height:70px;border-top:2px solid ' + c.line + ';font-family:' + ctx.fonts.mono + ';font-size:30px;color:' + c.muted + ';' + uiEnter(t, el.at + 0.35, 'up', {dist: 40}), '<div style="position:absolute;left:10px;top:16px">⏮ ▶ ⏭</div>');
  return '<div style="position:absolute;inset:0;' + uiPanelStyle(c, '') + '">' + s + '</div>';
}

/**
 * lock-cards: tools behind locks. {title, cards: [{no, name, sub, icon, unlockAt}], counter (true), focus (index highlighted)}.
 * A card unlocks at unlockAt: the lock becomes its icon, the name scales in, a check pops and a scan line runs its waveform.
 */
function uiLockCards(el, t, ctx) {
  const p = el.props, c = ctx.c, w = el.rect.width, h = el.rect.height;
  const cards = p.cards || [];
  const head = p.title ? 64 : 0, foot = p.counter === false ? 0 : 120;
  const ch = Math.min(200, (h - head - foot - 26 - 20 * (cards.length - 1)) / Math.max(1, cards.length));
  let s = p.title ? uiHeader(ctx, p.title, p.sub, p.right) : '';
  let open = 0;
  for (let i = 0; i < cards.length; i++) {
    const cd = cards[i];
    const isOpen = cd.unlockAt !== undefined && t >= cd.unlockAt;
    const fresh = isOpen && t < cd.unlockAt + 2.4;
    if (isOpen) open++;
    const fp = isOpen ? uiP(t, cd.unlockAt, 0.3) : 1;
    const focus = p.focus === i || fresh;
    const y = head + 26 + i * (ch + 20);
    const ring = isOpen ? (focus ? '0 0 0 4px ' + c.accent + ',0 0 ' + uiN(uiLerp(80, 30, fp)) + 'px ' + c.accent + '80' : '0 0 0 2px ' + c.accentDim) : '0 0 0 2px ' + c.line;
    const icon = isOpen ? uiEsc(cd.icon || '✓') : '🔒';
    const box = ch - 44;
    let inner = uiDiv('left:22px;top:22px;width:' + uiN(box) + 'px;height:' + uiN(box) + 'px;border-radius:18px;background:' + c.well + ';display:flex;align-items:center;justify-content:center;font-size:' + uiN(box * 0.48) + 'px;color:' + (isOpen ? c.accent : c.dim) + ';transform:rotate(' + uiN(cd.shakeAt !== undefined ? uiShake(t, cd.shakeAt, 16, 0.4) : 0) + 'deg)', icon);
    const nameX = 44 + box;
    inner += uiDiv('left:' + nameX + 'px;top:' + uiN(ch * 0.13) + 'px;display:flex;align-items:center;gap:18px;white-space:nowrap', '<span style="font-family:' + ctx.fonts.mono + ';font-size:' + uiN(ch * 0.26) + 'px;font-weight:800;background:' + (isOpen ? c.ink : c.panel3) + ';color:' + c.bg + ';border-radius:10px;padding:0 10px">' + uiEsc(cd.no || uiPad(i + 1)) + '</span><span style="font-family:' + ctx.fonts.display + ';font-size:' + uiN(ch * 0.29) + 'px;font-weight:900;letter-spacing:-.03em;color:' + (isOpen ? c.ink : c.dim) + ';display:inline-block;transform-origin:0 50%;transform:scale(' + (isOpen && fp < 1 ? uiLerp(1.5, 1, uiOutBack(fp)).toFixed(3) : 1) + ')">' + uiEsc(isOpen ? cd.name : '? ? ?') + '</span>');
    if (cd.tag) inner += uiDiv('right:24px;top:24px', uiChipHtml(ctx, {text: cd.tag, tone: 'ink', size: 26}));
    const ww = w - 40 - nameX - 140;
    inner += isOpen ? uiDiv('left:' + nameX + 'px;top:' + uiN(ch * 0.55) + 'px;width:' + uiN(ww) + 'px;height:' + uiN(ch * 0.3) + 'px', uiWave(48, ww, ch * 0.3, i * 13, c.soft, t, fresh ? cd.unlockAt : -1, {d: 0.35})) : uiDiv('left:' + nameX + 'px;top:' + uiN(ch * 0.62) + 'px;width:' + uiN(ww * 0.86) + 'px;height:' + uiN(ch * 0.16) + 'px;border-radius:8px;background:' + c.panel3, '');
    if (fresh && t > cd.unlockAt + 0.3) { const q = uiClamp((t - cd.unlockAt - 0.3) / 2.0); inner += uiDiv('left:' + uiN(nameX + ww * q) + 'px;top:' + uiN(ch * 0.52) + 'px;width:4px;height:' + uiN(ch * 0.36) + 'px;background:' + c.accent + ';box-shadow:0 0 12px ' + c.accent, '') + uiDiv('left:' + nameX + 'px;top:' + uiN(ch * 0.52) + 'px;width:' + uiN(ww * q) + 'px;height:' + uiN(ch * 0.36) + 'px;background:' + c.accent + '1a', ''); }
    if (isOpen) inner += uiDiv('right:30px;top:' + uiN(ch * 0.52) + 'px;width:68px;height:68px;border-radius:50%;background:' + c.accent + ';color:' + c.onAccent + ';font-size:44px;font-weight:900;text-align:center;line-height:68px;' + uiEnter(t, fresh ? cd.unlockAt + 0.12 : -1, 'pop'), '✓');
    const appear = cd.at !== undefined ? cd.at : el.at + 0.1 + i * 0.08;
    s += uiDiv('left:20px;top:' + uiN(y) + 'px;width:' + (w - 40) + 'px;height:' + uiN(ch) + 'px;border-radius:22px;background:linear-gradient(180deg,' + c.panel2 + ',' + c.panel + ');overflow:hidden;box-shadow:' + ring + ';' + uiEnter(t, appear, cd.enter || 'left', {dist: 160, d: 0.32}), inner);
  }
  if (p.counter !== false) {
    s += uiDiv('left:24px;top:' + (h - 108) + 'px;font-family:' + ctx.fonts.mono + ';font-size:34px;font-weight:700;color:' + c.muted + ';' + uiEnter(t, el.at + 0.2, 'up', {dist: 40}), uiEsc(p.counterLabel || 'UNLOCKED') + ' <span style="color:' + c.accent + ';font-size:44px">' + open + '</span>/' + cards.length);
    let bars = '';
    const bw = (w - 48) / Math.max(1, cards.length);
    for (let i = 0; i < cards.length; i++) bars += uiDiv('left:' + uiN(i * bw) + 'px;top:0;width:' + uiN(bw - 14) + 'px;height:26px;border-radius:8px;background:' + (i < open ? c.accent : c.line) + ';' + (i < open ? 'box-shadow:0 0 18px ' + c.accent + '80' : ''), '');
    s += uiDiv('left:24px;top:' + (h - 52) + 'px;width:' + (w - 48) + 'px;height:26px;' + uiEnter(t, el.at + 0.25, 'up', {dist: 40}), bars);
  }
  return '<div style="position:absolute;inset:0;' + uiPanelStyle(c, '') + '">' + s + '</div>';
}

// ---------------------------------------------------------------------------
// The painter

/** The element's props at t: props with every beat at or before t merged in, in order. */
function uiPropsAt(el, t) {
  const beats = el.beats || [];
  let props = el.props || {};
  for (let i = 0; i < beats.length; i++) if (t >= beats[i].at) props = Object.assign({}, props, beats[i].set);
  return props;
}

/** Elements as HTML at scene time t, each placed at its rect with its entrance and exit. */
function uiChildren(elements, t, ctx) {
  let s = '';
  const list = elements || [];
  for (let i = 0; i < list.length; i++) {
    const el0 = list[i];
    if (el0.out !== undefined && t >= el0.out + 0.3) continue;
    if (t < el0.at) continue;
    const el = Object.assign({}, el0, {props: uiPropsAt(el0, t)});
    const draw = ctx.components[el.kind];
    if (!draw) continue;
    const r = el.rect;
    const base = (el.props.rotate ? 'rotate(' + el.props.rotate + 'deg) ' : '') + (el.tilt ? 'perspective(1400px) rotateX(' + (el.tilt.x || 0) + 'deg) rotateY(' + (el.tilt.y || 0) + 'deg) rotateZ(' + (el.tilt.z || 0) + 'deg)' : '');
    const style = uiEnter(t, el.at, el.enter || 'up', {base: base, d: el.enterDuration, dist: el.dist, ov: el.overshoot}) + uiExit(t, el.out);
    const z = el.z ? 'z-index:' + el.z + ';' : '';
    s += '<div data-ui="' + uiEsc(el.id || '') + '" style="position:absolute;left:' + uiN(r.x) + 'px;top:' + uiN(r.y) + 'px;width:' + uiN(r.width) + 'px;height:' + uiN(r.height) + 'px;' + z + style + '">' + draw(el, t, ctx) + '</div>';
  }
  return s;
}

export {uiClamp, uiP, uiLerp, uiOutExpo, uiOutCubic, uiInOut, uiOutBack, uiHash, uiPad, uiEsc, uiN, uiEnter, uiExit, uiShake, uiTyped, uiCaret, uiDiv, uiWave, uiTone, uiChipHtml, uiDots, uiHeader, uiPanelStyle,
  uiHeadline, uiChip, uiWaveform, uiWindow, uiTimeline, uiLockCards, uiPropsAt, uiChildren};

// Catalogue H frames: device-frame (browser, phone, laptop, tablet) and
// window-chrome. Each holds a project image or, without one, a mock screen
// drawn from the brand (blocks, lines and a chart), so a frame never shows
// empty. Registered in kit/core/catalog-h.mjs.

import {timingRules} from './catalog-b-base.mjs';
import {VARIANT_PARAM, clip, createHBase, fitText, mixColor, r2, rt, textWidth} from './catalog-h-base.mjs';
import {abs, el, label, riseOps, set, tw} from './catalog-h-view.mjs';
import {glassSurface, withAlpha} from './panels.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';
const TIMING = timingRules({rules: ['the frame lands at at, its screen fills 0.3 s later']});

/** Optional caption under a frame → {text, size, lines, height}. */
function frameCaption(b, raw, width) {
  if (raw === undefined) return null;
  const text = b.check.str(raw, 'params.caption', 80);
  const fit = fitText(b.check, 'params.caption', text, {family: 'body', width, preferred: b.u(46), min: b.min.key, maxLines: 2});
  return {text, size: fit.size, lines: fit.lines, height: r2(fit.size * 1.2 * fit.lines + b.u(30))};
}

// ---------------------------------------------------------------------------
// Mock screen: brand blocks that stagger in (desktop or mobile layout).

function mockScreen(model, w, h, {mobile = false, title = null, offset = 0} = {}) {
  const {id, theme, fonts, unit: u} = model;
  const c = model.content;
  const pad = r2(Math.max(10 * u, w * 0.045));
  const line = (x, y, width, height, color, k) => el('div', `${id}-ui-${k}`, abs(r2(x), r2(y), r2(width), r2(height), {borderRadius: r2(height / 2), background: color, opacity: 0}));
  const block = (x, y, width, height, style, k, children = []) => el('div', `${id}-ui-${k}`, {...abs(r2(x), r2(y), r2(width), r2(height)), boxSizing: 'border-box', borderRadius: r2(Math.min(width, height) * 0.08), opacity: 0, ...style}, children);
  const bg = c.screenBg;
  const soft = mixColor(theme.paper, bg, 0.12), softer = mixColor(theme.paper, bg, 0.06), mid = mixColor(theme.paper, bg, 0.28);
  const out = [];
  let k = offset;
  const navH = r2(h * (mobile ? 0.07 : 0.09));
  out.push(block(0, 0, w, navH, {background: softer, borderRadius: 0}, k++, [
    el('div', null, abs(pad, r2(navH * 0.3), r2(navH * 0.4), r2(navH * 0.4), {borderRadius: '50%', background: theme.primary})),
    el('div', null, abs(r2(pad + navH * 0.6), r2(navH * 0.4), r2(w * 0.18), r2(navH * 0.2), {borderRadius: 99, background: mid}))
  ]));
  const top = navH + pad;
  if (title) {
    const size = r2(Math.max(10 * u, Math.min(w * (mobile ? 0.09 : 0.05), h * 0.08)));
    out.push(el('div', `${id}-ui-${k++}`, {...abs(pad, r2(top), r2(w - pad * 2), undefined), margin: 0, fontFamily: fonts.body, fontWeight: 700, fontSize: size, lineHeight: '1.15', color: theme.paper, whiteSpace: 'normal', opacity: 0}, [title]));
  } else out.push(line(pad, top, w * 0.42, h * 0.035, mid, k++));
  const bodyTop = top + h * (title ? 0.14 : 0.07);
  if (mobile) {
    const cardH = (h - bodyTop - pad * 3) / 3;
    for (let i = 0; i < 3; i++) {
      const y = bodyTop + i * (cardH + pad);
      out.push(block(pad, y, w - pad * 2, cardH, {background: i === 0 ? theme.primary : soft}, k++, [
        el('div', null, abs(r2(pad * 0.8), r2(cardH * 0.24), r2(cardH * 0.4), r2(cardH * 0.4), {borderRadius: '50%', background: i === 0 ? mixColor(bg, theme.primary, 0.25) : mid})),
        el('div', null, abs(r2(pad * 0.8 + cardH * 0.55), r2(cardH * 0.3), r2((w - pad * 2) * 0.45), r2(cardH * 0.1), {borderRadius: 99, background: i === 0 ? mixColor(bg, theme.primary, 0.3) : mid})),
        el('div', null, abs(r2(pad * 0.8 + cardH * 0.55), r2(cardH * 0.52), r2((w - pad * 2) * 0.3), r2(cardH * 0.08), {borderRadius: 99, background: i === 0 ? mixColor(bg, theme.primary, 0.45) : softer}))
      ]));
    }
    return out;
  }
  const colW = (w - pad * 4) / 3, cardH = (h - bodyTop - pad * 2) * 0.42;
  for (let i = 0; i < 3; i++) {
    out.push(block(pad + i * (colW + pad), bodyTop, colW, cardH, {background: i === 0 ? theme.primary : soft}, k++, [
      el('div', null, abs(r2(colW * 0.1), r2(cardH * 0.18), r2(colW * 0.36), r2(cardH * 0.12), {borderRadius: 99, background: i === 0 ? mixColor(bg, theme.primary, 0.3) : mid})),
      el('div', null, abs(r2(colW * 0.1), r2(cardH * 0.44), r2(colW * 0.6), r2(cardH * 0.26), {borderRadius: r2(4 * u), background: i === 0 ? mixColor(bg, theme.primary, 0.2) : mid}))
    ]));
  }
  const chartY = bodyTop + cardH + pad, chartH = h - chartY - pad;
  const bars = [0.45, 0.62, 0.5, 0.78, 0.66, 0.9, 0.74];
  out.push(block(pad, chartY, w - pad * 2, chartH, {background: softer}, k++, bars.map((f, i) => {
    const bw = (w - pad * 4) / bars.length * 0.6;
    return el('div', null, abs(r2(pad + i * (w - pad * 4) / bars.length), r2(chartH * (1 - f * 0.8) - pad * 0.5), r2(bw), r2(chartH * f * 0.8), {borderRadius: r2(3 * u), background: i === 5 ? theme.accent : mid}));
  })));
  return out;
}

// Blocks a mock screen draws: nav, title or line, then three cards (mobile) or three cards and a chart.
const mockCount = mobile => (mobile ? 5 : 6);

function screenOps(model, ops, count, at) {
  const {id, start, unit: u} = model;
  for (let k = 0; k < count; k++) riseOps(ops, `${id}-ui-${k}`, start, rt(at + k * 0.07), r2(14 * u), {duration: 0.4});
}

// ---------------------------------------------------------------------------
// device-frame

const DEVICE_VARIANTS = Object.freeze(['clay', 'dark', 'outline']);
const DEVICES = ['browser', 'phone', 'laptop', 'tablet'];

function deviceResolve(params, ctx) {
  const b = createHBase('device-frame', params, ctx, {allowed: ['device', 'image', 'title', 'url', 'caption', 'at', 'fit'], required: [], variants: DEVICE_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const device = p.device === undefined ? (b.portrait ? 'phone' : 'browser') : check.oneOf(p.device, 'params.device', DEVICES);
  const image = p.image === undefined ? null : check.asset(p.image, 'params.image');
  const fit = p.fit === undefined ? 'cover' : check.oneOf(p.fit, 'params.fit', ['cover', 'contain']);
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 48);
  const url = device === 'browser' ? (p.url === undefined ? null : check.str(p.url, 'params.url', 60)) : null;
  const W = rect.width;
  const caption = frameCaption(b, p.caption, W);
  const room = {width: W, height: rect.height - (caption ? caption.height : 0)};
  // Body and screen geometry per device, as fractions of the body.
  const shape = {
    browser: {aspect: 16 / 10.6, bar: 0.075},
    phone: {aspect: 9 / 19, bezel: 0.045},
    laptop: {aspect: 16 / 11.4, bezel: 0.035, base: 0.07},
    tablet: {aspect: b.portrait ? 3 / 4 : 4 / 3, bezel: 0.04}
  }[device];
  let bw = room.width, bh = bw / shape.aspect;
  if (bh > room.height) { bh = room.height; bw = bh * shape.aspect; }
  if (device === 'laptop') { bh = Math.min(bh, room.height); bw = Math.min(bw, room.width); }
  bw = r2(Math.min(bw, u(device === 'phone' ? 620 : 1600))); bh = r2(bw / shape.aspect);
  const body = {x: r2((W - bw) / 2), y: r2((room.height - bh) / 2), width: bw, height: bh};
  let screen;
  if (device === 'browser') screen = {x: 0, y: r2(bh * shape.bar), width: bw, height: r2(bh * (1 - shape.bar))};
  else if (device === 'laptop') {
    const lidH = r2(bh * (1 - shape.base));
    const bz = r2(bw * shape.bezel);
    screen = {x: bz, y: bz, width: r2(bw - bz * 2), height: r2(lidH - bz * 1.6)};
    body.lid = lidH;
  } else {
    const bz = r2(Math.min(bw, bh) * (device === 'phone' ? 0.06 : shape.bezel) * (device === 'phone' ? 0.7 : 1));
    screen = {x: bz, y: bz, width: r2(bw - bz * 2), height: r2(bh - bz * 2)};
  }
  if (screen.width < u(200)) check.fail('params', 'leaves too little room for the device; drop the caption or enlarge rect');
  const showAt = b.timeOf('show', p.at, 'params.at', 0.5);
  b.events.push({id: `${b.id}-show`, name: 'show', time: showAt, endTime: rt(showAt + 0.6), role: 'emphasis', cue: 'whoosh'});
  const variant = b.variant;
  const bodyColor = variant === 'dark' ? mixColor('#ffffff', '#000000', 0.09) : variant === 'clay' ? mixColor(b.colors.paper, b.colors.bg, 0.86) : 'transparent';
  const content = {variant, device, body, screen, image: image ? {src: image, fit} : null, title, url, caption, showAt, mobile: device === 'phone',
    bodyColor, edge: variant === 'outline' ? b.colors.primary : variant === 'dark' ? mixColor('#ffffff', '#000000', 0.22) : mixColor(b.colors.paper, b.colors.bg, 0.7),
    screenBg: mixColor(b.colors.paper, b.colors.bg, 0.04), chrome: variant === 'clay' ? mixColor(b.colors.ink, b.colors.paper, 0.12) : b.theme.muted,
    barColor: variant === 'clay' ? mixColor(b.colors.paper, b.colors.bg, 0.78) : variant === 'dark' ? mixColor('#ffffff', '#000000', 0.14) : b.theme.panel};
  return b.finish(content, {minTextPx: caption ? caption.size : b.min.key});
}

function deviceView(model) {
  const {id, fonts, unit: u, theme} = model;
  const c = model.content;
  const B = c.body, S = c.screen;
  const radius = {browser: 18, phone: 64, laptop: 22, tablet: 40}[c.device] * u;
  const contentNodes = c.image
    ? [el('img', null, abs(0, 0, S.width, S.height, {objectFit: c.image.fit, display: 'block'}), [], {src: c.image.src, alt: ''})]
    : mockScreen(model, S.width, S.height, {mobile: c.mobile, title: c.title});
  const screenRadius = c.device === 'browser' ? `0 0 ${r2(radius)}px ${r2(radius)}px` : c.device === 'phone' ? r2(radius * 0.78) : c.device === 'tablet' ? r2(radius * 0.5) : r2(6 * u);
  const screen = el('div', `${id}-screen`, {...abs(S.x, S.y, S.width, S.height), overflow: 'hidden', background: c.screenBg, borderRadius: screenRadius, clipPath: 'inset(0% 0% 100% 0%)'}, contentNodes);
  const kids = [];
  const outline = c.variant === 'outline' ? {border: `${r2(4 * u)}px solid ${c.edge}`} : {border: `${r2(2 * u)}px solid ${c.edge}`};
  const shadow = c.variant === 'outline' ? {} : {boxShadow: `0 ${r2(40 * u)}px ${r2(90 * u)}px #00000099`};
  if (c.device === 'laptop') {
    kids.push(el('div', null, {...abs(0, 0, B.width, B.lid), boxSizing: 'border-box', borderRadius: `${r2(radius)}px ${r2(radius)}px ${r2(6 * u)}px ${r2(6 * u)}px`, background: c.bodyColor, ...outline, ...shadow}, [screen]));
    const baseH = r2(B.height - B.lid);
    kids.push(el('div', null, {...abs(r2(-B.width * 0.06), B.lid, r2(B.width * 1.12), baseH), background: c.variant === 'outline' ? 'transparent' : c.bodyColor, ...outline, borderRadius: `${r2(4 * u)}px ${r2(4 * u)}px ${r2(baseH * 0.6)}px ${r2(baseH * 0.6)}px`, boxSizing: 'border-box'}, [
      el('div', null, abs(r2(B.width * 0.06 + B.width * 0.42), 0, r2(B.width * 0.16), r2(baseH * 0.32), {borderRadius: `0 0 ${r2(8 * u)}px ${r2(8 * u)}px`, background: c.edge}))
    ]));
  } else {
    const inner = [];
    if (c.device === 'browser') {
      const barH = S.y;
      inner.push(el('div', null, abs(0, 0, B.width, barH, {background: c.barColor, borderRadius: `${r2(radius)}px ${r2(radius)}px 0 0`}), [
        ...[0, 1, 2].map(i => el('div', null, abs(r2(barH * 0.42 + i * barH * 0.42), r2(barH * 0.38), r2(barH * 0.24), r2(barH * 0.24), {borderRadius: '50%', background: ['#ff5f57', '#febc2e', '#28c840'][i]}))),
        el('div', null, {...abs(r2(B.width * 0.25), r2(barH * 0.22), r2(B.width * 0.5), r2(barH * 0.56)), borderRadius: 99, background: c.variant === 'clay' ? '#ffffff' : mixColor('#ffffff', '#000000', 0.2), display: 'flex', alignItems: 'center', justifyContent: 'center'}, c.url ? [
          el('div', null, {margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', fontFamily: fonts.meta, fontSize: r2(barH * 0.3), color: c.chrome}, [c.url])] : [])
      ]));
    }
    inner.push(screen);
    if (c.device === 'phone') inner.push(el('div', null, abs(r2(B.width / 2 - B.width * 0.15), r2(S.y + S.width * 0.035), r2(B.width * 0.3), r2(B.width * 0.075), {borderRadius: 99, background: '#000000'})));
    if (c.device === 'tablet') inner.push(el('div', null, abs(r2(B.width / 2 - 5 * u), r2(S.y / 2 - 5 * u), r2(10 * u), r2(10 * u), {borderRadius: '50%', background: c.edge})));
    kids.push(el('div', null, {...abs(0, 0, B.width, B.height), boxSizing: 'border-box', borderRadius: r2(radius), background: c.device === 'browser' ? c.screenBg : c.bodyColor, ...outline, ...shadow, overflow: 'hidden'}, inner));
  }
  const out = [el('div', `${id}-device`, {...abs(B.x, B.y, B.width, B.height), opacity: 0, transformOrigin: '50% 100%'}, kids)];
  if (c.caption) out.push(label(`${id}-caption`, 0, r2(B.y + B.height + 30 * u), model.rect.width, c.caption.text, {size: c.caption.size, family: fonts.body, color: theme.foreground, align: 'center', weight: 650, wrap: c.caption.lines > 1, extra: {opacity: 0}}));
  return out;
}

function deviceTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  set(ops, `${id}-device`, start, {opacity: 0, x: 0, y: r2(90 * u), scaleX: 0.92, scaleY: 0.92, rotation: c.device === 'phone' ? -6 : 0});
  tw(ops, `${id}-device`, c.showAt, 0.25, 'power1.out', {opacity: 0}, {opacity: 1});
  tw(ops, `${id}-device`, c.showAt, 0.8, 'power3.out', {y: r2(90 * u), scaleX: 0.92, scaleY: 0.92, rotation: c.device === 'phone' ? -6 : 0}, {y: 0, scaleX: 1, scaleY: 1, rotation: 0});
  set(ops, `${id}-screen`, start, clip(0, 0, 100, 0));
  tw(ops, `${id}-screen`, rt(c.showAt + 0.3), 0.6, 'power2.inOut', clip(0, 0, 100, 0), clip(0, 0, 0, 0));
  if (!c.image) screenOps(model, ops, mockCount(c.mobile), rt(c.showAt + 0.45));
  if (c.caption) riseOps(ops, `${id}-caption`, start, rt(c.showAt + 0.4), r2(14 * u));
}

export const deviceFrame = {
  id: 'device-frame',
  describe: 'A browser, phone, laptop or tablet frame rises in and its screen wipes on: a project image, or a mock screen in the brand (blocks, cards and a chart) with an optional title.',
  params: {device: '"browser" | "phone" | "laptop" | "tablet" (default phone in 9:16, browser in 16:9)', image: 'assets/… screenshot (optional; else a mock screen)', fit: '"cover" | "contain"',
    title: 'string ≤ 48 on the mock screen (optional)', url: 'string ≤ 60 in the browser bar (optional)', caption: 'string ≤ 80 under the frame (optional)', at: `lands: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['show'], timing: TIMING, variants: DEVICE_VARIANTS,
  resolve: deviceResolve, view: deviceView, timeline: deviceTimeline
};

// ---------------------------------------------------------------------------
// window-chrome

const WINDOW_VARIANTS = Object.freeze(['mac', 'minimal', 'terminal']);

function windowResolve(params, ctx) {
  const b = createHBase('window-chrome', params, ctx, {allowed: ['title', 'lines', 'image', 'at', 'stagger', 'caption'], required: [], variants: WINDOW_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 40);
  const image = p.image === undefined ? null : check.asset(p.image, 'params.image');
  const lines = p.lines === undefined ? [] : check.arr(p.lines, 'params.lines', 1, 8).map((line, i) => check.str(String(line), `params.lines[${i}]`, 64));
  if (!image && !lines.length) check.fail('params', 'needs lines or an image to show in the window');
  const terminal = b.variant === 'terminal';
  const W = rect.width;
  const caption = frameCaption(b, p.caption, W);
  const room = rect.height - (caption ? caption.height : 0);
  const barH = b.variant === 'minimal' ? r2(u(56)) : r2(u(72));
  const pad = r2(u(36));
  const family = terminal ? 'meta' : 'body';
  const longest = lines.reduce((a, l) => (l.length > a.length ? l : a), '');
  let size = u(terminal ? 40 : 46);
  // A terminal keeps one more row for the blinking cursor on a fresh prompt.
  const rowCount = lines.length + (terminal && lines.length ? 1 : 0);
  if (lines.length) {
    while (size > b.min.meta && (textWidth(`${terminal ? '$ ' : ''}${longest}`, size, family) > W - pad * 2 || barH + pad * 2 + rowCount * size * 1.55 > room)) size -= 1;
    if (size < b.min.meta) check.fail('params.lines', 'do not fit the window; shorten them or use fewer');
  }
  size = r2(size);
  const contentH = image ? r2(Math.min(room - barH, (W - 0) * 0.56)) : r2(pad * 2 + rowCount * size * 1.55);
  const height = r2(barH + contentH);
  const box = {x: 0, y: r2((room - height) / 2), width: W, height};
  const showAt = b.timeOf('show', p.at, 'params.at', 0.5);
  b.events.push({id: `${b.id}-show`, name: 'show', time: showAt, endTime: rt(showAt + 0.5), role: 'emphasis', cue: 'whoosh-soft'});
  const stagger = p.stagger === undefined ? Math.min(0.32, (b.start + b.lastEvent - showAt - 0.8) / Math.max(1, lines.length)) : check.num(p.stagger, 'params.stagger', 0.05, 2);
  const rows = lines.map((text, i) => {
    const time = rt(showAt + 0.4 + i * stagger);
    // Terminal lines type on: a linear clip wipe at about 28 characters a second.
    const type = terminal ? rt(Math.min(Math.max(0.15, text.length / 28), stagger * 0.95 || 0.6)) : 0;
    return {text, time, type, y: r2(barH + pad + i * size * 1.55)};
  });
  rows.forEach((row, i) => b.events.push({id: `${b.id}-line-${i}`, name: `line-${i}`, time: row.time, role: 'emphasis', cue: terminal ? 'keystroke-soft' : 'pop-soft'}));
  const dark = terminal ? '#0b0d12' : null;
  const content = {variant: b.variant, title, image, rows, size, barH, pad, box, caption, showAt, terminal,
    surface: terminal ? dark : b.theme.panel, bar: terminal ? '#151821' : b.variant === 'minimal' ? 'transparent' : mixColor(b.colors.paper, b.colors.bg, 0.1),
    text: terminal ? mixColor(b.colors.paper, '#000000', 0.9) : b.theme.foreground, prompt: b.colors.primary, muted: b.theme.muted, border: b.theme.border};
  return b.finish(content, {minTextPx: Math.min(caption ? caption.size : Infinity, b.min.key)});
}

function windowView(model) {
  const {id, fonts, unit: u, theme} = model;
  const c = model.content;
  const B = c.box;
  const bar = [];
  const dot = r2(c.barH * 0.24);
  [0, 1, 2].forEach(i => bar.push(el('div', null, abs(r2(c.barH * 0.4 + i * dot * 1.7), r2((c.barH - dot) / 2), dot, dot, {borderRadius: '50%', background: c.variant === 'minimal' ? c.border : ['#ff5f57', '#febc2e', '#28c840'][i]}))));
  if (c.title) bar.push(label(null, 0, r2(c.barH / 2 - c.barH * 0.3 * 0.65), B.width, c.title, {size: r2(c.barH * 0.3), family: c.terminal ? fonts.meta : fonts.body, color: c.muted, align: 'center', weight: 600}));
  // The glass role (story.panel rim-glass): the window is a glass pane and its title bar a faint band on it.
  const glass = glassSurface(model, {radius: 24});
  const barFill = glass ? (c.variant === 'minimal' ? 'transparent' : withAlpha(theme.paper, 0.05)) : c.bar;
  const barRule = glass ? withAlpha(theme.primary, 0.3) : c.border;
  const inner = [el('div', null, abs(0, 0, B.width, c.barH, {background: barFill, ...(c.variant === 'minimal' ? {} : {borderBottom: `${r2(glass ? 1.5 * u : 2 * u)}px solid ${barRule}`})}), bar)];
  if (c.image) inner.push(el('div', `${id}-body`, {...abs(0, c.barH, B.width, r2(B.height - c.barH)), overflow: 'hidden', clipPath: 'inset(0% 0% 100% 0%)'}, [
    el('img', null, abs(0, 0, B.width, r2(B.height - c.barH), {objectFit: 'cover', display: 'block'}), [], {src: c.image, alt: ''})]));
  c.rows.forEach((row, i) => {
    const family = c.terminal ? fonts.meta : fonts.body;
    const children = c.terminal ? [el('span', null, {color: c.prompt}, ['$ ']), row.text] : [row.text];
    inner.push(el('div', `${id}-line-${i}`, {...abs(c.pad, row.y, r2(B.width - c.pad * 2), undefined), margin: 0, whiteSpace: 'nowrap', fontFamily: family, fontSize: c.size, lineHeight: '1.3', color: c.text,
      ...(c.terminal ? {clipPath: 'inset(0% 100% 0% 0%)'} : {opacity: 0})}, children));
  });
  if (c.terminal) {
    const last = c.rows.at(-1);
    inner.push(el('div', `${id}-cursor`, abs(c.pad, r2(last.y + c.size * 1.55 + c.size * 0.1), r2(c.size * 0.55), r2(c.size * 1.05), {background: c.prompt, opacity: 0})));
  }
  const out = [el('div', `${id}-window`, {...abs(B.x, B.y, B.width, B.height), boxSizing: 'border-box', borderRadius: r2(24 * u), overflow: 'hidden',
    ...(glass ?? {background: c.surface, border: `${r2(2 * u)}px solid ${c.border}`, boxShadow: `0 ${r2(30 * u)}px ${r2(80 * u)}px #000000aa`}), opacity: 0}, inner)];
  if (c.caption) out.push(label(`${id}-caption`, 0, r2(B.y + B.height + 30 * u), model.rect.width, c.caption.text, {size: c.caption.size, family: fonts.body, color: theme.foreground, align: 'center', weight: 650, wrap: c.caption.lines > 1, extra: {opacity: 0}}));
  return out;
}

function windowTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  set(ops, `${id}-window`, start, {opacity: 0, x: 0, y: r2(50 * u), scaleX: 0.96, scaleY: 0.96});
  tw(ops, `${id}-window`, c.showAt, 0.6, 'power3.out', {opacity: 0, y: r2(50 * u), scaleX: 0.96, scaleY: 0.96}, {opacity: 1, y: 0, scaleX: 1, scaleY: 1});
  if (c.image) {
    set(ops, `${id}-body`, start, clip(0, 0, 100, 0));
    tw(ops, `${id}-body`, rt(c.showAt + 0.3), 0.6, 'power2.inOut', clip(0, 0, 100, 0), clip(0, 0, 0, 0));
  }
  c.rows.forEach((row, i) => {
    if (c.terminal) {
      set(ops, `${id}-line-${i}`, start, clip(0, 100, 0, 0));
      tw(ops, `${id}-line-${i}`, row.time, row.type, 'none', clip(0, 100, 0, 0), clip(0, 0, 0, 0));
    } else riseOps(ops, `${id}-line-${i}`, start, row.time, r2(12 * u), {duration: 0.4});
  });
  if (c.terminal) {
    const done = rt(c.rows.at(-1).time + c.rows.at(-1).type + 0.1);
    set(ops, `${id}-cursor`, start, {opacity: 0});
    // A blinking block cursor once the last line is typed (seek-safe sets).
    for (let t = done, on = true; t < model.motion.exitStart; t = rt(t + 0.5), on = !on) set(ops, `${id}-cursor`, t, {opacity: on ? 1 : 0});
  }
  if (c.caption) riseOps(ops, `${id}-caption`, start, rt(c.showAt + 0.3), r2(14 * u));
}

export const windowChrome = {
  id: 'window-chrome',
  describe: 'An app window with title-bar chrome around lines of text (rising in) or an image; the terminal variant types each line on after a prompt and leaves a blinking cursor.',
  params: {lines: '[string ≤ 64] 1–8 (or image)', image: 'assets/… image (or lines)', title: 'string ≤ 40 in the title bar (optional)', stagger: 'seconds between lines (default fits the scene, ≤ 0.32)',
    caption: 'string ≤ 80 under the window (optional)', at: `lands: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['show', 'line-<i>'], timing: TIMING, variants: WINDOW_VARIANTS,
  resolve: windowResolve, view: windowView, timeline: windowTimeline
};

export const FRAMES = [deviceFrame, windowChrome];

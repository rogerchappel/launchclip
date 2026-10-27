// Catalogue I code-evidence base: the source card shared by repo-pr-card,
// commit-card, diff-view, evidence-chain and date-pinned-timeline
// (kit/core/catalog-i-code.mjs). One card = a header (repo, PR number or sha,
// state chip, avatars, date, file path) and a block of diff or excerpt rows
// with line numbers, plus token boxes that draw on round a highlighted token.
//
// Code is set in a registered monospace face (the brand meta font when it is
// one, else JetBrains Mono), whose advance is exactly 0.6 em, so a token's box
// and the connectors that join tokens across cards land on the glyphs in both
// renderers without measuring the DOM.
//
// Two looks (each module's variants): `glass`, a translucent panel with a
// 1.5 px rim and outer glow in the brand accent, and `github`, GitHub's own
// dark or light surface. The token box is always the brand accent: it is our
// annotation, not part of the page.

import {fontStack, FONT_REGISTRY, fontFamilyName} from './fonts.mjs';
import {hex2} from './catalog-b-view.mjs';
import {contrastRatio, fitText, mixColor, r2, rt, textWidth} from './catalog-h-base.mjs';
import {abs, el, label, set, tw} from './catalog-h-view.mjs';
import {iconNode} from './icons.mjs';

export const CODE_ADVANCE = 0.6;
export const CARD_VARIANTS = Object.freeze(['glass', 'github']);
export const MAX_LINES = 14;
export const MAX_COMPACT_LINES = 6;
export const MAX_TOKENS = 3;
// GitHub's mark (octicon mark-github, 16 px box). Drawn only on cards that
// depict GitHub evidence.
const GITHUB_MARK = 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// ---------------------------------------------------------------------------
// Params

/** "YYYY-MM-DD" → {iso, day (days since epoch), short "Oct 16", long "Oct 16, 2026", month "OCT 2026", dom 16}. */
export function parseDate(check, value, path) {
  const m = typeof value === 'string' ? ISO_DATE.exec(value) : null;
  const ms = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  if (!m || !Number.isFinite(ms) || new Date(ms).getUTCDate() !== Number(m[3])) check.fail(path, `must be a date "YYYY-MM-DD"; got ${JSON.stringify(value)}`);
  const d = new Date(ms), mon = MONTHS[d.getUTCMonth()], dom = d.getUTCDate(), year = d.getUTCFullYear();
  return {iso: value, day: Math.round(ms / 864e5), dom, short: `${mon} ${dom}`, long: `${mon} ${dom}, ${year}`, month: `${mon.toUpperCase()} ${year}`};
}

export function repoName(check, value, path) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(value)) check.fail(path, `must be "owner/name"; got ${JSON.stringify(value)}`);
  return value;
}

/** {login, avatar?} | "login" → {login, avatar | null, initials}. */
export function person(check, value, path) {
  const raw = typeof value === 'string' ? {login: value} : check.obj(value, path, ['login', 'avatar', 'name'], ['login']);
  const login = check.str(raw.login, `${path}.login`, 39);
  const avatar = raw.avatar === undefined || raw.avatar === null ? null : check.asset(raw.avatar, `${path}.avatar`);
  return {login, avatar, initials: login.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'};
}

/**
 * Diff or excerpt lines → rows {type: add | del | ctx | hunk, old, new, text}.
 * In a diff, a string reads as a unified-diff line: "@@ -13,7 +13,7 @@" (a
 * hunk header, which also resets the line numbers), "+…", "-…" or " …". An
 * object gives {text, type?, old?, new?}. Leading indent common to every
 * code row is removed and tabs become two spaces.
 */
export function parseLines(check, raw, path, {diff = true, start, min = 1, max = MAX_LINES} = {}) {
  check.arr(raw, path, min, max);
  let old = 1, neu = 1;
  if (start !== undefined) {
    if (typeof start === 'number') old = neu = check.int(start, `${path.replace(/lines$/, '')}startLine`, 1, 1e6);
    else {
      const s = check.obj(start, `${path.replace(/lines$/, '')}startLine`, ['old', 'new'], []);
      old = s.old === undefined ? 1 : check.int(s.old, 'startLine.old', 1, 1e6);
      neu = s.new === undefined ? old : check.int(s.new, 'startLine.new', 1, 1e6);
    }
  }
  const rows = raw.map((line, i) => {
    const p = `${path}[${i}]`;
    let type, text, o, n;
    if (typeof line === 'string') {
      if (line.length > 400) check.fail(p, 'must be at most 400 characters');
      const hunk = diff ? /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line) : null;
      if (hunk) { old = Number(hunk[1]); neu = Number(hunk[2]); return {type: 'hunk', text: line.replace(/\s+$/, ''), old: null, new: null}; }
      if (diff && line[0] === '+') { type = 'add'; text = line.slice(1); }
      else if (diff && line[0] === '-') { type = 'del'; text = line.slice(1); }
      else { type = 'ctx'; text = diff && line[0] === ' ' ? line.slice(1) : line; }
    } else {
      check.obj(line, p, ['text', 'type', 'old', 'new'], ['text']);
      if (typeof line.text !== 'string' || line.text.length > 400) check.fail(`${p}.text`, 'must be a string of at most 400 characters');
      text = line.text;
      type = line.type === undefined ? 'ctx' : check.oneOf(line.type, `${p}.type`, diff ? ['add', 'del', 'ctx', 'hunk'] : ['ctx']);
      if (line.old !== undefined) old = check.int(line.old, `${p}.old`, 1, 1e6);
      if (line.new !== undefined) neu = check.int(line.new, `${p}.new`, 1, 1e6);
      if (type === 'hunk') return {type, text, old: null, new: null};
    }
    if (/[\r\n]/.test(text)) check.fail(p, 'must be one line (no line breaks)');
    text = text.replace(/\t/g, '  ').replace(/\s+$/, '');
    if (type === 'add') { n = neu++; o = null; }
    else if (type === 'del') { o = old++; n = null; }
    else { o = old++; n = neu++; }
    return {type, text, old: o, new: n};
  });
  const code = rows.filter(r => r.type !== 'hunk' && r.text.trim());
  const indent = code.length ? Math.min(...code.map(r => /^ */.exec(r.text)[0].length)) : 0;
  if (indent) for (const r of rows) if (r.type !== 'hunk') r.text = r.text.slice(Math.min(indent, /^ */.exec(r.text)[0].length));
  return rows;
}

/** highlight: "token" | {token, row?} | [...] → [{token, row | null}] (≤ MAX_TOKENS). */
export function parseHighlights(check, raw, path) {
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? check.arr(raw, path, 1, MAX_TOKENS) : [raw];
  return list.map((h, i) => {
    const p = Array.isArray(raw) ? `${path}[${i}]` : path;
    const obj = typeof h === 'string' ? {token: h} : check.obj(h, p, ['token', 'row'], ['token']);
    return {token: check.str(obj.token, typeof h === 'string' ? p : `${p}.token`, 80), row: obj.row === undefined ? null : check.int(obj.row, `${p}.row`, 0, MAX_LINES - 1)};
  });
}

/** Where each highlight sits: its row (given, else the first added row, then context, then removed, that has it) and column. */
export function locateTokens(check, rows, highlights, path) {
  const order = ['add', 'ctx', 'del'];
  return highlights.map((h, k) => {
    let row = h.row;
    if (row !== null) {
      if (row >= rows.length || !rows[row].text.includes(h.token)) check.fail(path, `token ${JSON.stringify(h.token)} is not in row ${row}`);
    } else {
      for (const type of order) { row = rows.findIndex(r => r.type === type && r.text.includes(h.token)); if (row >= 0) break; }
      if (row < 0) check.fail(Array.isArray(h) ? `${path}[${k}]` : path, `token ${JSON.stringify(h.token)} is not in any line; highlight text exactly as it appears`);
    }
    return {token: h.token, row, col: rows[row].text.indexOf(h.token), len: h.token.length};
  });
}

// ---------------------------------------------------------------------------
// Palette and fonts

const isDark = bg => contrastRatio(bg, '#000000') < contrastRatio(bg, '#ffffff');

/** The card's colours for a variant: panel, rim, text, diff tints, chips. */
export function cardPalette(b, variant) {
  const {colors, theme} = b;
  const dark = isDark(colors.bg);
  const add = dark ? '#3fb950' : '#1a7f37', del = dark ? '#f85149' : '#cf222e', merged = dark ? '#a371f7' : '#8250df';
  const accent = [colors.accent, colors.primary, colors.paper].find(c => contrastRatio(c, colors.bg) >= 3) ?? colors.paper;
  if (variant === 'github') {
    const panel = dark ? '#0d1117' : '#ffffff';
    return {variant, dark, panel, panelBg: panel, rim: dark ? '#30363d' : '#d0d7de', glow: null, bar: dark ? '#161b22' : '#f6f8fa', fg: dark ? '#e6edf3' : '#1f2328', muted: dark ? '#8b949e' : '#59636e',
      faint: dark ? '#6e7681' : '#8c959f', add, del, addBg: hex2(add, dark ? 0.15 : 0.12), delBg: hex2(del, dark ? 0.15 : 0.1), hunkBg: hex2(dark ? '#388bfd' : '#0969da', 0.1), merged, accent, line: dark ? '#21262d' : '#d8dee4'};
  }
  const panel = mixColor(colors.paper, colors.bg, 0.07);
  return {variant, dark, panel, panelBg: hex2(panel, 0.8), rim: hex2(accent, 0.72), glow: hex2(accent, 0.32), bar: hex2(mixColor(colors.paper, colors.bg, 0.12), 0.6), fg: theme.foreground, muted: theme.muted,
    faint: mixColor(colors.paper, colors.bg, 0.45), add, del, addBg: hex2(add, 0.16), delBg: hex2(del, 0.16), hunkBg: hex2(accent, 0.08), merged, accent, line: hex2(colors.paper, 0.08)};
}

/** The code font: the brand meta font when it is a registered monospace face, else JetBrains Mono. */
export function codeFont(fonts) {
  const first = String(fonts.meta).split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  const name = fontFamilyName(first);
  return name && FONT_REGISTRY[name]?.generic === 'monospace' && FONT_REGISTRY[name].advance.lower === CODE_ADVANCE ? fonts.meta : fontStack('JetBrains Mono', 'meta');
}

/** The panel style of a card: glass (translucent, accent rim and glow) or GitHub's surface. */
export function panelStyle(pal, u, radius = 18) {
  return {background: pal.panelBg, border: `${r2(1.5 * u)}px solid ${pal.rim}`, borderRadius: r2(radius * u), overflow: 'hidden', boxSizing: 'border-box',
    ...(pal.glow ? {boxShadow: `0 0 ${r2(28 * u)}px ${pal.glow}, 0 ${r2(18 * u)}px ${r2(48 * u)}px rgba(0,0,0,0.35)`, backdropFilter: `blur(${r2(16 * u)}px)`} : {boxShadow: `0 ${r2(16 * u)}px ${r2(44 * u)}px rgba(0,0,0,0.3)`})};
}

// ---------------------------------------------------------------------------
// Layout

/** Crop `text` to `max` characters, keeping [keep0, keep1) in view; → {text, shift} (shift: columns removed from the left, the "…" counted). */
export function cropLine(text, max, keep = null) {
  if (text.length <= max) return {text, shift: 0};
  let from = 0;
  if (keep && keep[1] > max - 1) from = Math.min(Math.max(0, keep[0] - Math.floor((max - (keep[1] - keep[0])) / 3)), text.length - max + 1);
  let out = text.slice(from, from + max);
  if (from > 0) out = `…${out.slice(1)}`;
  if (from + max < text.length) out = `${out.slice(0, -1)}…`;
  return {text: out, shift: from};
}

/** Short sha (7) of a 7–40 hex sha. */
export function shortSha(check, value, path) {
  if (typeof value !== 'string' || !/^[0-9a-f]{7,40}$/i.test(value)) check.fail(path, `must be a 7–40 character hex sha; got ${JSON.stringify(value)}`);
  return value.slice(0, 7).toLowerCase();
}

/**
 * Lay out the code block of a card: font size (largest in [floor, preferred]
 * that fits the longest row, else floor with rows cropped round their tokens;
 * floor defaults to min, a hero card keeps its type large and crops instead),
 * gutters, row height and each token's box. → {size, rowH, gutter, codeX,
 * rows: [{…, y, text}], tokens: [{row, x, y, w, h}], height}.
 */
export function layoutCode(b, rows, tokens, {width, preferred, min, floor = min, lead = 1.62, gutters = 2, diff = true, path = 'params.lines'}) {
  const {u} = b;
  const digits = Math.max(2, ...rows.map(r => String(Math.max(r.old ?? 0, r.new ?? 0)).length));
  const longest = Math.max(...rows.map(r => r.text.length), 8);
  const pad = u(18);
  const cols = size => {
    const adv = size * CODE_ADVANCE, gw = gutters ? (digits + 1) * adv : 0;
    const signW = diff ? 2 * adv : 0;
    return {adv, gw, signW, avail: Math.floor((width - 2 * pad - gutters * gw - signW - u(6)) / adv)};
  };
  const lowest = Math.ceil(Math.max(min, floor));
  let size = Math.floor(preferred);
  for (; size > lowest; size -= 2) if (cols(size).avail >= longest) break;
  size = Math.max(size, lowest);
  const {adv, gw, signW, avail} = cols(size);
  if (avail < 12) b.check.fail(path, `leave room for only ${avail} characters per line in a ${Math.round(width)} px card; give the module more width or fewer cards`);
  const rowH = r2(size * lead);
  const codeX = r2(pad + gutters * gw + signW);
  const out = rows.map((r, i) => {
    const mine = tokens.filter(t => t.row === i);
    const keep = mine.length ? [Math.min(...mine.map(t => t.col)), Math.max(...mine.map(t => t.col + t.len))] : null;
    if (keep && keep[1] - keep[0] > avail - 2) b.check.fail(path, `row ${i} cannot show its highlighted token in ${avail} characters; shorten the token or widen the card`);
    const {text, shift} = r.type === 'hunk' ? cropLine(r.text, avail + Math.floor(signW / adv)) : cropLine(r.text, avail, keep);
    for (const t of mine) t.vcol = t.col - shift;
    return {...r, text, y: r2(i * rowH)};
  });
  const bx = u(4), by = r2(rowH * 0.12);
  const boxes = tokens.map(t => ({row: t.row, token: t.token, col: t.vcol, len: t.len, x: r2(codeX + t.vcol * adv - bx), y: r2(t.row * rowH + by), w: r2(t.len * adv + 2 * bx), h: r2(rowH - 2 * by)}));
  return {size, adv: r2(adv), rowH, pad, gw: r2(gw), signW: r2(signW), codeX, gutters, diff, rows: out, tokens: boxes, height: r2(rows.length * rowH)};
}

/** Row views for a laid-out code block at (0, top): tinted background, gutters, sign, code with the token text in the accent. */
export function codeNodes(prefix, code, pal, font, top, width) {
  const {size, rowH, adv, gw} = code;
  return code.rows.map((r, i) => {
    const kids = [];
    if (r.type === 'add' || r.type === 'del' || r.type === 'hunk') kids.push(el('div', null, abs(0, 0, width, rowH, {background: r.type === 'add' ? pal.addBg : r.type === 'del' ? pal.delBg : pal.hunkBg})));
    const t = {fontFamily: font, fontSize: size, lineHeight: `${rowH}px`, whiteSpace: 'pre', margin: 0};
    if (r.type === 'hunk') kids.push(el('div', null, abs(code.pad, 0, width - code.pad, rowH, {...t, color: pal.muted}), [r.text]));
    else {
      const nums = code.gutters === 2 ? [r.old, r.new] : code.gutters === 1 ? [r.new ?? r.old] : [];
      nums.forEach((n, g) => kids.push(el('div', null, abs(r2(code.pad + g * gw), 0, r2(gw - adv), rowH, {...t, color: pal.faint, textAlign: 'right'}), [n === null ? '' : String(n)])));
      if (code.diff && r.type !== 'ctx') kids.push(el('div', null, abs(r2(code.codeX - code.signW), 0, code.signW, rowH, {...t, color: r.type === 'add' ? pal.add : pal.del, textAlign: 'center'}), [r.type === 'add' ? '+' : '−']));
      const mine = code.tokens.filter(tk => tk.row === i).sort((a, c) => a.col - c.col);
      const parts = [];
      let at = 0;
      for (const tk of mine) {
        if (tk.col < at) continue;
        if (tk.col > at) parts.push(r.text.slice(at, tk.col));
        parts.push(el('span', null, {color: pal.accent}, [r.text.slice(tk.col, tk.col + tk.len)]));
        at = tk.col + tk.len;
      }
      if (at < r.text.length) parts.push(r.text.slice(at));
      kids.push(el('div', null, abs(code.codeX, 0, r2(width - code.codeX), rowH, {...t, color: pal.fg, overflow: 'visible'}), parts.length ? parts : ['']));
    }
    return el('div', `${prefix}-row-${i}`, abs(0, r2(top + r.y), width, rowH, {opacity: 0}), kids);
  });
}

/** Token box views (absolute, card coordinates): a soft fill and a stroked outline that draws on. */
export function tokenNodes(prefix, code, pal, top, u) {
  return code.tokens.map((t, k) => el('svg', `${prefix}-tk-${k}`, abs(t.x, r2(top + t.y), t.w, t.h, {overflow: 'visible'}), [
    el('rect', `${prefix}-tkf-${k}`, {opacity: 0}, [], {x: 0, y: 0, width: t.w, height: t.h, rx: r2(5 * u), fill: hex2(pal.accent, 0.14)}),
    el('rect', `${prefix}-tkr-${k}`, {strokeDasharray: 1, strokeDashoffset: 1, filter: `drop-shadow(0 0 ${r2(6 * u)}px ${hex2(pal.accent, 0.8)})`}, [], {x: 0, y: 0, width: t.w, height: t.h, rx: r2(5 * u), fill: 'none', stroke: pal.accent, strokeWidth: r2(2.5 * u), pathLength: 1})
  ], {width: t.w, height: t.h, viewBox: `0 0 ${t.w} ${t.h}`, fill: 'none'}));
}

/** Rows appear top to bottom from `at`, one every `step` s → the time the last lands. */
export function rowOps(ops, prefix, start, rows, at, step, u) {
  rows.forEach((_, i) => {
    const t = rt(at + i * step);
    set(ops, `${prefix}-row-${i}`, start, {opacity: 0, x: r2(-14 * u), y: 0});
    tw(ops, `${prefix}-row-${i}`, t, 0.32, 'power2.out', {opacity: 0, x: r2(-14 * u)}, {opacity: 1, x: 0});
  });
  return rt(at + Math.max(0, rows.length - 1) * step + 0.32);
}

/** Token boxes draw on from `at`, 0.35 s apart. */
export function tokenOps(ops, prefix, start, count, at) {
  for (let k = 0; k < count; k++) {
    const t = rt(at + k * 0.35);
    set(ops, `${prefix}-tkr-${k}`, start, {strokeDashoffset: 1});
    tw(ops, `${prefix}-tkr-${k}`, t, 0.55, 'power2.inOut', {strokeDashoffset: 1}, {strokeDashoffset: 0});
    set(ops, `${prefix}-tkf-${k}`, start, {opacity: 0});
    tw(ops, `${prefix}-tkf-${k}`, rt(t + 0.3), 0.35, 'power1.out', {opacity: 0}, {opacity: 1});
  }
}

// ---------------------------------------------------------------------------
// Header pieces

/** GitHub's mark at (x, y), `size` px, in `color`. */
export function githubMark(x, y, size, color) {
  return el('svg', null, abs(x, y, size, size), [el('path', null, null, [], {d: GITHUB_MARK, fill: color})], {width: size, height: size, viewBox: '0 0 16 16', fill: 'none'});
}

/** A round avatar: the image when there is one, else initials on a tinted disc. */
export function avatarNode(p, x, y, size, pal, font, ring) {
  const style = abs(x, y, size, size, {borderRadius: '50%', overflow: 'hidden', boxSizing: 'border-box', border: `${r2(size * 0.06)}px solid ${ring}`});
  if (p.avatar) return el('div', null, style, [el('img', null, abs(0, 0, size, size, {objectFit: 'cover', display: 'block'}), [], {src: p.avatar, alt: ''})]);
  return el('div', null, {...style, background: mixColor(pal.accent, pal.panel, 0.55)}, [el('div', null, abs(0, 0, r2(size * 0.88), r2(size * 0.88), {fontFamily: font, fontSize: r2(size * 0.4), lineHeight: `${r2(size * 0.88)}px`, textAlign: 'center', color: pal.panel, fontWeight: 700, margin: 0}), [p.initials])]);
}

/** An outlined chip (state, sha, Verified): → {node, width}. */
export function chip(x, y, h, value, {color, font, size, fill = null, icon = null, weight = 600, u}) {
  const padX = r2(h * 0.42), iconSize = icon ? r2(h * 0.56) : 0, gap = icon ? r2(h * 0.18) : 0;
  const w = r2(textWidth(value, size, font === 'code' ? 'meta' : 'body') * (font === 'code' ? CODE_ADVANCE / 0.62 : 1) + 2 * padX + iconSize + gap);
  const kids = [];
  if (icon) kids.push(iconNode(icon, {x: padX, y: r2((h - iconSize) / 2 - 1.5 * u), size: iconSize, color: fill ? '#ffffff' : color, stroke: 2.4}));
  kids.push(el('div', null, abs(r2(padX + iconSize + gap), 0, undefined, h, {fontSize: size, lineHeight: `${r2(h - 3 * u)}px`, color: fill ? '#ffffff' : color, fontWeight: weight, whiteSpace: 'nowrap', margin: 0}), [value]));
  return {width: w, node: el('div', null, abs(x, y, w, h, {borderRadius: r2(h / 2), border: `${r2(1.5 * u)}px solid ${fill ?? color}`, background: fill ?? hex2(color, 0.12), boxSizing: 'border-box'}), kids)};
}

export const STATE = Object.freeze({merged: {label: 'Merged', icon: 'git-merge'}, open: {label: 'Open', icon: 'git-pull-request'}, closed: {label: 'Closed', icon: 'git-pull-request-closed'}, draft: {label: 'Draft', icon: 'git-pull-request-draft'}});
export const stateColor = (pal, state) => (state === 'merged' ? pal.merged : state === 'open' ? pal.add : state === 'closed' ? pal.del : pal.muted);

/** Window bar: three dots and a centred caption (a file or URL) → node. */
export function windowBar(width, h, caption, pal, font, size, u) {
  const d = r2(h * 0.26);
  const dots = ['#ff5f57', '#febc2e', '#28c840'].map((c, i) => el('div', null, abs(r2(h * 0.5 + i * d * 1.7), r2((h - d) / 2), d, d, {borderRadius: '50%', background: c})));
  return el('div', null, abs(0, 0, width, h, {background: pal.bar, borderBottom: `${r2(1 * u)}px solid ${pal.line}`}), [...dots,
    ...(caption ? [el('div', null, abs(r2(h * 2.2), 0, r2(width - h * 4.4), h, {fontFamily: font, fontSize: size, lineHeight: `${h}px`, textAlign: 'center', color: pal.muted, whiteSpace: 'nowrap', overflow: 'hidden', margin: 0}), [caption])] : [])]);
}

export {abs, el, set, tw, fitText, label, textWidth, r2, rt, hex2, mixColor};

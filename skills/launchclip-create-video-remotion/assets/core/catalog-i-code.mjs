// Catalogue I code evidence: rebuilt GitHub evidence for the "here is the
// receipt" beat of an explainer (docs/KIT_CONTRACTS.md, "Code evidence").
//
//   repo-pr-card          a pull request: repo, number, title, state chip,
//                         author, date and a −/+ excerpt whose token box
//                         draws on, on its word
//   commit-card           a commit: repo, short sha, Verified, co-authors,
//                         message, file and the diff hunk with its token
//   diff-view             a Files-changed diff where a focus ring steps
//                         through rows in states and the other rows dim
//   evidence-chain        2–4 sources side by side (PR, commit, excerpt,
//                         announcement), the same token in each joined by a
//                         dashed connector, one source at a time
//   date-pinned-timeline  a day axis that scrubs while source cards pin to
//                         their dates and stack, or the "why now? N clues in
//                         N days" summary
//
// terminal-session (the typing terminal) is in catalog-i-terminal.mjs. Every
// card is laid out by layoutCard() into plain data (content.cards) and drawn
// by cardNode(), so the model stays JSON. Params take real data; the
// src/evidence/github.js helper maps the public GitHub API into them.
// Registered in kit/core/catalog-h.mjs (the shared view tree and op list).

import {timingRules} from './catalog-b-base.mjs';
import {VARIANT_PARAM, createHBase, titleBlock} from './catalog-h-base.mjs';
import {chromeNodes, chromeOps, popOps, riseOps} from './catalog-h-view.mjs';
import {iconNode} from './icons.mjs';
import {FONT_REGISTRY, fontFamilyName} from './fonts.mjs';
import {CARD_VARIANTS, CODE_ADVANCE, MAX_COMPACT_LINES, MAX_LINES, STATE, abs, avatarNode, cardPalette, chip, codeFont, codeNodes, el, fitText, githubMark, hex2, label, layoutCode, locateTokens,
  panelStyle, parseDate, parseHighlights, parseLines, person, r2, repoName, rowOps, rt, set, shortSha, stateColor, textWidth, tokenNodes, tokenOps, tw, windowBar} from './catalog-i-code-base.mjs';
import {TERMINAL_MODULES} from './catalog-i-terminal.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';
const LINES = `[string | {text, type?, old?, new?}] unified-diff lines verbatim: "@@ -13,7 +13,7 @@" (a hunk header, sets the line numbers), "+added", "-removed", " context"`;
const HIGHLIGHT = `"token" | {token, row?} | [… ≤ 3]: text exactly as in a line; a box draws round it (default row: the first added line that has it)`;
const KINDS = ['pr', 'commit', 'excerpt', 'announcement'];
const SOURCE = '{kind: pr | commit | excerpt | announcement, …that kind\'s fields: pr {repo, number, state?, author?, date?, file?, lines?}, commit {repo, sha, verified?, authors?, date?, file?, lines?}, excerpt {file, sub?, lines, startLine?}, announcement {site, title, text ≤ 320, date?}; highlight}';

/** Default cue `fallback` (scene-relative), clamped into [min, last event], then timeOf. */
function cueTime(b, name, value, path, fallback, min) {
  return b.timeOf(name, value, path, Math.max(min, Math.min(fallback, b.lastEvent)), {min: Math.max(0, min - 1e-6)});
}

/**
 * Sizes of a full card (one card on stage) or a compact one (several), at
 * scale k. Above 1 (a hero), code type shrinks at most 20% to fit its longest
 * line (codeFloor) before rows are cropped.
 */
function cardSizes(b, compact, k = 1) {
  const {min} = b;
  // Above 1x the code (the evidence) grows at full rate, the chrome round it at half.
  const c = k > 1 ? 1 + (k - 1) / 2 : k;
  const u = v => b.u(v * c), m = v => r2(Math.max(min.meta, b.u(v * c)));
  const code = v => r2(Math.max(min.meta, b.u(v * k)));
  const z = compact
    ? {pad: u(22), head: m(30), meta: m(26), title: m(32), code: code(28), chipH: u(40), chipText: m(22), bar: u(40), avatar: u(34), body: m(28)}
    : {pad: u(30), head: m(36), meta: m(28), title: r2(Math.max(min.key, u(48))), code: code(34), chipH: u(48), chipText: m(26), bar: u(50), avatar: u(42), body: m(32)};
  return {...z, codeFloor: k > 1 ? r2(Math.max(min.meta, z.code * 0.8)) : min.meta, lead: k > 1 ? 1.45 : 1.62};
}

// The largest scale a card alone on stage tries (repo-pr-card, commit-card, diff-view).
const HERO_SCALE = 1.5;

/**
 * layoutCard at the largest scale from `scale` (default 1) down to 80% in
 * 10% steps (never under the text floors) that is not too tall.
 */
function fitCard(b, s, path, {scale = 1, ...opts}) {
  const ks = [];
  for (let k = scale; k > 0.8 - 1e-9; k = Math.round((k - 0.1) * 100) / 100) ks.push(k);
  for (const k of ks) {
    try { return layoutCard(b, s, path, {...opts, sizes: cardSizes(b, opts.compact, k)}); }
    catch (error) { if (k === ks.at(-1) || !/px tall/.test(error.message)) throw error; }
  }
}

// ---------------------------------------------------------------------------
// Source specs

/** A raw source (kind + fields) → a validated spec. */
function sourceSpec(b, raw, path, {kind: forced = null, require = [], maxLines = MAX_LINES, token = null} = {}) {
  const {check} = b;
  check.obj(raw, path, ['kind', 'repo', 'number', 'title', 'state', 'author', 'authors', 'sha', 'verified', 'message', 'date', 'file', 'additions', 'deletions', 'lines', 'startLine', 'highlight', 'site', 'text', 'sub', 'at', 'label']);
  const kind = forced ?? check.oneOf(raw.kind, `${path}.kind`, KINDS);
  const fields = {pr: ['repo', 'number', 'title', 'state', 'author', 'date', 'file', 'additions', 'deletions', 'lines', 'startLine', 'highlight'],
    commit: ['repo', 'sha', 'verified', 'authors', 'message', 'number', 'date', 'file', 'additions', 'deletions', 'lines', 'startLine', 'highlight'],
    excerpt: ['file', 'repo', 'sub', 'date', 'lines', 'startLine', 'highlight'], announcement: ['site', 'title', 'text', 'date', 'highlight']}[kind];
  for (const key of Object.keys(raw)) if (!['kind', 'at', 'label', 'date', ...fields].includes(key)) check.fail(`${path}.${key}`, `is not a field of a ${kind} source (${fields.join(', ')})`);
  const needs = {pr: ['repo', 'number'], commit: ['repo', 'sha'], excerpt: ['file', 'lines'], announcement: ['site', 'title', 'text']}[kind];
  for (const key of [...needs, ...require]) if (raw[key] === undefined) check.fail(`${path}.${key}`, 'is required');
  const s = {kind};
  if (raw.repo !== undefined) s.repo = repoName(check, raw.repo, `${path}.repo`);
  if (raw.number !== undefined) s.number = check.int(raw.number, `${path}.number`, 1, 1e8);
  if (raw.title !== undefined) s.title = check.str(raw.title, `${path}.title`, 140);
  if (kind === 'pr') s.state = check.oneOf(raw.state ?? 'open', `${path}.state`, Object.keys(STATE));
  if (raw.author !== undefined) s.authors = [person(check, raw.author, `${path}.author`)];
  if (raw.authors !== undefined) s.authors = check.arr(raw.authors, `${path}.authors`, 1, 3).map((a, i) => person(check, a, `${path}.authors[${i}]`));
  if (raw.sha !== undefined) s.sha = shortSha(check, raw.sha, `${path}.sha`);
  if (raw.verified !== undefined) s.verified = check.bool(raw.verified, `${path}.verified`);
  if (raw.message !== undefined) s.message = check.str(raw.message, `${path}.message`, 140);
  if (raw.date !== undefined) s.date = parseDate(check, raw.date, `${path}.date`);
  if (raw.file !== undefined) s.file = check.str(raw.file, `${path}.file`, 160);
  for (const key of ['additions', 'deletions']) if (raw[key] !== undefined) s[key] = check.int(raw[key], `${path}.${key}`, 0, 1e7);
  if (raw.sub !== undefined) s.sub = check.str(raw.sub, `${path}.sub`, 80);
  if (raw.site !== undefined) s.site = check.str(raw.site, `${path}.site`, 60);
  if (raw.text !== undefined) s.text = check.str(raw.text, `${path}.text`, 320);
  const highlights = parseHighlights(check, raw.highlight ?? token ?? undefined, `${path}.highlight`);
  if (kind === 'announcement') {
    if (highlights.length > 1) check.fail(`${path}.highlight`, 'takes one token on an announcement');
    if (highlights.length && !s.text.includes(highlights[0].token)) check.fail(`${path}.highlight`, `token ${JSON.stringify(highlights[0].token)} is not in ${path}.text`);
    s.highlight = highlights[0]?.token ?? null;
    return s;
  }
  if (raw.lines !== undefined) {
    s.diff = kind !== 'excerpt';
    s.numbered = kind !== 'excerpt' || raw.startLine !== undefined;
    s.rows = parseLines(check, raw.lines, `${path}.lines`, {diff: s.diff, start: raw.startLine, max: maxLines});
    s.tokens = locateTokens(check, s.rows, highlights, `${path}.highlight`);
  } else {
    if (highlights.length) check.fail(`${path}.highlight`, 'needs lines to highlight in');
    s.rows = [];
    s.tokens = [];
  }
  if (s.diff && s.additions === undefined && s.rows.length) { s.additions = s.rows.filter(r => r.type === 'add').length; s.deletions = s.rows.filter(r => r.type === 'del').length; s.counted = true; }
  return s;
}

// ---------------------------------------------------------------------------
// Card layout → plain data (items in card coordinates)

const verb = s => (s.state === 'merged' ? 'merged' : s.state === 'closed' ? 'closed' : 'opened');
const joinNames = list => (list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);

/**
 * Word-wrap `text` into lines of at most `width` px (body advance); the word
 * that holds the token starts its own line. → {lines, tokenLine, before} where
 * `before` is the part of that word ahead of the token.
 */
function wrapProse(text, token, size, width) {
  const lines = [];
  const cut = token ? text.indexOf(token) : -1;
  let line = '', tokenLine = -1, before = '', pos = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const start = text.indexOf(word, pos);
    pos = start + word.length;
    if (cut >= start && cut < pos && tokenLine < 0) {
      if (line) lines.push(line);
      line = word; tokenLine = lines.length; before = text.slice(start, cut);
      continue;
    }
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size, 'body') > width) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return {lines, tokenLine, before};
}

/**
 * Lay out one source card `width` px wide → {kind, w, h, items, code, codeTop,
 * tokens (card coordinates), headerCount}. compact: the small header used when
 * several cards share the stage.
 */
function layoutCard(b, s, path, {width, compact, sizes = cardSizes(b, compact), maxHeight = Infinity, urlBar = true}) {
  const {u, check} = b;
  const z = sizes, P = z.pad, W = width;
  const items = [];
  let y = 0;
  const text = (x, yy, w, v, s2, f, c, extra = {}) => items.push({t: 'text', x: r2(x), y: r2(yy), w: r2(w), v, s: s2, f, c, ...extra});
  const right = (v, s2, f, c, yy, h) => text(P, yy + (h - s2 * 1.25) / 2, W - 2 * P, v, s2, f, c, {al: 'right'});
  const bar = caption => { items.push({t: 'bar', h: z.bar, v: caption, s: Math.max(b.min.meta, r2(z.meta * 0.9))}); y = z.bar; };
  const markRow = (rightText, rightFont = 'code') => {
    const h = r2(z.head * 1.3);
    if (s.repo) {
      items.push({t: 'mark', x: P, y: r2(y + (h - z.head) / 2), s: z.head, c: 'fg'});
      const rw = W - 2 * P - z.head * 1.4 - (rightText ? textWidth(rightText, z.meta, 'meta') + u(16) : 0);
      text(P + z.head * 1.4, y + (h - z.head * 1.25) / 2, rw, s.repo, z.head, 'body', 'fg', {wt: 650, clip: true});
    }
    if (rightText) right(rightText, z.meta, rightFont, 'muted', y, h);
    y += h;
  };
  const fileRow = () => {
    if (!s.file) return;
    y += u(8);
    items.push({t: 'rule', y: r2(y)});
    const h = r2(z.meta * 1.9);
    const stats = s.additions !== undefined ? [{v: `+${s.additions}`, c: 'add'}, {v: ` −${s.deletions}`, c: 'del'}] : null;
    const statsW = stats ? (String(s.additions).length + String(s.deletions).length + 3) * z.meta * CODE_ADVANCE + u(10) : 0;
    items.push({t: 'icon', n: 'file-code', x: P, y: r2(y + (h - z.meta) / 2), s: z.meta, c: 'muted'});
    const room = Math.floor((W - 2 * P - z.meta * 1.5 - statsW) / (z.meta * CODE_ADVANCE));
    const file = s.file.length > room ? `…${s.file.slice(s.file.length - room + 1)}` : s.file;
    text(P + z.meta * 1.5, y + (h - z.meta * 1.25) / 2, W - 2 * P - z.meta * 1.5 - statsW, file, z.meta, 'code', 'muted');
    if (stats) right(stats, z.meta, 'code', 'muted', y, h);
    y += h;
  };
  const avatars = (list, x, yy, size) => {
    list.forEach((p, i) => items.push({t: 'avatar', x: r2(x + i * size * 0.62), y: r2(yy), s: size, p}));
    return r2(x + (list.length - 1) * size * 0.62 + size + u(12));
  };
  // fitText's advance is conservative; the height reserved follows the body
  // face's own advance (+6%), so a title that sets on one line takes one.
  const titleFit = (v, w, preferred, minSize, lines) => {
    const fit = fitText(check, `${path}.${s.kind === 'commit' ? 'message' : 'title'}`, v, {family: 'body', width: w, preferred, min: minSize, maxLines: lines});
    return {...fit, lines: Math.min(fit.lines, wrapCount(v, fit.size * proseAdvance(b.fonts.body) * 1.06, w))};
  };

  if (s.kind === 'pr') {
    if (!compact && urlBar) bar(`github.com/${s.repo}/pull/${s.number}`);
    y += P * 0.7;
    markRow(`#${s.number}`);
    if (s.title && !compact) {
      y += u(10);
      const fit = titleFit(s.title, W - 2 * P, z.title, b.min.key, 3);
      text(P, y, W - 2 * P, s.title, fit.size, 'body', 'fg', {wt: 700, wrap: true, lh: 1.18, box: r2(fit.size * 1.18 * fit.lines)});
      items.titleSize = fit.size;
      y += fit.size * 1.18 * fit.lines + u(14);
    } else y += u(6);
    const h = z.chipH, st = STATE[s.state];
    const c = chip(0, 0, h, st.label, {color: '#000000', font: 'body', size: z.chipText, icon: st.icon, u});
    items.push({t: 'chip', x: P, y: r2(y), h, w: c.width, v: st.label, c: `state:${s.state}`, fill: true, icon: st.icon, s: z.chipText, f: 'body'});
    let x = P + c.width + u(14);
    if (s.authors) x = avatars(s.authors.slice(0, 1), x, y + (h - z.avatar) / 2, z.avatar);
    const by = [s.authors ? s.authors[0].login : null, s.date ? `${verb(s)} ${compact ? s.date.short : `on ${s.date.long}`}` : (s.authors ? verb(s) : null)].filter(Boolean).join(' ');
    if (by) text(x, y + (h - z.meta * 1.25) / 2, W - P - x, by, z.meta, 'body', 'muted', {clip: true});
    y += h;
    fileRow();
  } else if (s.kind === 'commit') {
    if (!compact && urlBar) bar(`github.com/${s.repo}/commit/${s.sha}`);
    y += P * 0.7;
    markRow(compact ? `commit ${s.sha}` : null);
    if (!compact) {
      y += u(10);
      const h = z.chipH, ts = r2(z.head * 1.15);
      text(P, y + (h - ts * 1.25) / 2, textWidth('Commit', ts, 'body') + u(4), 'Commit', ts, 'body', 'fg', {wt: 700});
      let x = P + textWidth('Commit', ts, 'body') + u(14);
      const sc = chip(0, 0, h, s.sha, {color: '#000000', font: 'code', size: z.chipText, u});
      items.push({t: 'chip', x: r2(x), y: r2(y), h, w: sc.width, v: s.sha, c: 'accent', s: z.chipText, f: 'code'});
      x += sc.width + u(12);
      if (s.verified) {
        const vc = chip(0, 0, h, 'Verified', {color: '#000000', font: 'body', size: z.chipText, icon: 'badge-check', u});
        items.push({t: 'chip', x: r2(x), y: r2(y), h, w: vc.width, v: 'Verified', c: 'add', icon: 'badge-check', s: z.chipText, f: 'body'});
      }
      y += h + u(12);
    } else y += u(4);
    const h = r2(Math.max(z.avatar, z.meta * 1.4));
    let x = P;
    if (s.authors) x = avatars(s.authors, x, y + (h - z.avatar) / 2, z.avatar);
    const names = s.authors ? joinNames(s.authors.map(a => a.login)) : null;
    const line = [names, s.date ? (compact ? s.date.short : `authored on ${s.date.long}`) : null].filter(Boolean).join(compact ? ' · ' : ' ');
    let vw = 0;
    if (compact && s.verified) {
      const vc = chip(0, 0, z.chipH * 0.8, 'Verified', {color: '#000000', font: 'body', size: z.chipText, u});
      vw = vc.width + u(10);
      items.push({t: 'chip', x: r2(W - P - vc.width), y: r2(y + (h - z.chipH * 0.8) / 2), h: r2(z.chipH * 0.8), w: vc.width, v: 'Verified', c: 'add', s: z.chipText, f: 'body'});
    }
    if (line) text(x, y + (h - z.meta * 1.25) / 2, W - P - x - vw, line, z.meta, 'body', 'muted', {clip: true});
    y += h;
    if (s.message && !compact) {
      y += u(14);
      const tail = s.number ? ` (#${s.number})` : '';
      const fit = titleFit(`${s.message}${tail}`, W - 2 * P - u(36), z.title, b.min.key, 3);
      const boxH = r2(fit.size * 1.18 * fit.lines + u(30));
      items.push({t: 'box', x: P, y: r2(y), w: r2(W - 2 * P), h: boxH});
      text(P + u(18), y + u(15), W - 2 * P - u(36), tail ? [{v: s.message, c: 'fg'}, {v: tail, c: 'accent'}] : s.message, fit.size, 'body', 'fg', {wt: 700, wrap: true, lh: 1.18, box: r2(fit.size * 1.18 * fit.lines)});
      items.titleSize = fit.size;
      y += boxH;
    }
    fileRow();
  } else if (s.kind === 'excerpt') {
    bar(s.file);
    y += P * 0.5;
    const sub = s.sub ?? s.repo ?? null;
    if (sub) {
      const h = r2(z.meta * 1.6);
      if (s.repo && !s.sub) items.push({t: 'mark', x: P, y: r2(y + (h - z.meta) / 2), s: z.meta, c: 'muted'});
      text(P + (s.repo && !s.sub ? z.meta * 1.4 : 0), y + (h - z.meta * 1.25) / 2, W - 2 * P, [sub, s.date ? ` · ${s.date.short}` : ''].join(''), z.meta, 'body', 'muted', {clip: true});
      y += h + u(4);
    }
  } else {
    bar(s.site);
    y += P * 0.8;
    const fit = titleFit(s.title, W - 2 * P, r2(z.title * 1.1), Math.min(z.title, b.min.meta * 1.1), 2);
    text(P, y, W - 2 * P, s.title, fit.size, 'body', 'fg', {wt: 700, wrap: fit.lines > 1, lh: 1.15});
    y += fit.size * 1.15 * fit.lines + u(8);
    if (s.date) { text(P, y, W - 2 * P, s.date.long, z.meta, 'body', 'muted'); y += z.meta * 1.3 + u(12); }
    const size = z.body, lh = r2(size * 1.45);
    const {lines, tokenLine, before} = wrapProse(s.text, s.highlight, size, W - 2 * P);
    let tokenBox = null;
    lines.forEach((line, i) => {
      if (i === tokenLine) {
        const after = line.slice(before.length + s.highlight.length);
        items.push({t: 'tline', x: P, y: r2(y), w: r2(W - 2 * P), s: size, lh, before, token: s.highlight, after});
        // Prose is proportional: the box is an inline child of the token, and
        // only the connector's end uses this estimate of where the token starts.
        const lead = r2(before.length * size * proseAdvance(b.fonts.body));
        tokenBox = {x: r2(P + lead - u(6)), y: r2(y + lh * 0.08), w: r2(s.highlight.length * size * proseAdvance(b.fonts.body) + u(12)), h: r2(lh * 0.84), prose: true};
      } else text(P, y, W - 2 * P, line, size, 'body', 'fg', {lh: 1.45});
      y += lh;
    });
    y += P * 0.8;
    const h = r2(y);
    if (h > maxHeight) check.fail(path, `is ${Math.round(h)} px tall, taller than the ${Math.round(maxHeight)} px it has; shorten text or the title`);
    return {kind: s.kind, w: r2(W), h, items, titleSize: items.titleSize ?? null, code: null, codeTop: null, tokens: tokenBox ? [tokenBox] : [], sizes: z};
  }

  let code = null, codeTop = null, tokens = [];
  if (s.rows.length) {
    y += s.file ? 0 : u(8);
    if (!s.file) items.push({t: 'rule', y: r2(y)});
    y += u(6);
    codeTop = r2(y);
    code = layoutCode(b, s.rows, s.tokens, {width: W, preferred: z.code, min: b.min.meta, floor: z.codeFloor, lead: z.lead, gutters: !s.numbered ? 0 : compact ? 1 : 2, diff: s.diff, path: `${path}.lines`});
    tokens = code.tokens.map(t => ({x: t.x, y: r2(codeTop + t.y), w: t.w, h: t.h}));
    y += code.height + u(6);
  }
  y += P * 0.6;
  const h = r2(y);
  if (h > maxHeight) check.fail(path, `is ${Math.round(h)} px tall, taller than the ${Math.round(maxHeight)} px it has; use fewer lines${compact ? ' or fewer sources' : ''}, or give the module a larger rect`);
  return {kind: s.kind, w: r2(W), h, items, titleSize: items.titleSize ?? null, code, codeTop, tokens, sizes: z};
}

// ---------------------------------------------------------------------------
// Card view and ops

/** Lines `text` wraps to at `advance` px per character in `width` px (greedy, by word). */
function wrapCount(text, advance, width) {
  let lines = 1, used = 0;
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const w = word.length * advance;
    if (used && used + advance + w > width) { lines += 1; used = w; } else used += (used ? advance : 0) + w;
  }
  return lines;
}

/** Mean lowercase advance (em) of the body font, for prose estimates; 0.56 when it is not registered. */
function proseAdvance(stack) {
  const name = fontFamilyName(String(stack).split(',')[0].trim().replace(/^['"]|['"]$/g, ''));
  return FONT_REGISTRY[name]?.advance.lower ?? 0.56;
}

const colorOf = (pal, c) => (c?.startsWith('state:') ? stateColor(pal, c.slice(6)) : pal[c] ?? c);

/** One card's node at (x, y): panel, header items, code rows, token boxes. `prefix` is the card's DOM id. */
export function cardNode(model, card, prefix, x, y, {pal, code: font} = {}) {
  const {fonts, unit: u} = model;
  const family = f => (f === 'code' ? font : f === 'display' ? fonts.display : fonts.body);
  const kids = [];
  card.items.forEach((it, i) => {
    const id = `${prefix}-h-${i}`;
    if (it.t === 'band') kids.push(el('div', id, abs(0, 0, card.w, it.h, {background: pal.bar, borderBottom: `${r2(1 * u)}px solid ${pal.line}`, opacity: 0})));
    else if (it.t === 'bar') kids.push(el('div', id, abs(0, 0, card.w, it.h, {opacity: 0}), [windowBar(card.w, it.h, it.v, pal, font, it.s, u)]));
    else if (it.t === 'rule') kids.push(el('div', id, abs(0, it.y, card.w, r2(1 * u), {background: pal.line, opacity: 0})));
    else if (it.t === 'box') kids.push(el('div', id, abs(it.x, it.y, it.w, it.h, it.fill ? {background: colorOf(pal, it.fill), borderRadius: r2(2 * u), opacity: 0}
      : {background: hex2(pal.fg, 0.04), border: `${r2(1 * u)}px solid ${pal.line}`, borderRadius: r2(10 * u), boxSizing: 'border-box', opacity: 0})));
    else if (it.t === 'mark') kids.push(el('div', id, abs(it.x, it.y, it.s, it.s, {opacity: 0}), [githubMark(0, 0, it.s, colorOf(pal, it.c))]));
    else if (it.t === 'icon') kids.push(el('div', id, abs(it.x, it.y, it.s, it.s, {opacity: 0}), [iconNode(it.n, {size: it.s, color: colorOf(pal, it.c), stroke: 2})]));
    else if (it.t === 'avatar') kids.push(el('div', id, abs(it.x, it.y, it.s, it.s, {opacity: 0}), [avatarNode(it.p, 0, 0, it.s, pal, fonts.body, pal.panel)]));
    else if (it.t === 'chip') {
      const c = chip(0, 0, it.h, it.v, {color: colorOf(pal, it.c), font: it.f, size: it.s, icon: it.icon ?? null, fill: it.fill ? colorOf(pal, it.c) : null, u});
      const node = c.node;
      node.children = node.children.map(k => (k.tag === 'div' ? {...k, style: {...k.style, fontFamily: family(it.f)}} : k));
      kids.push(el('div', id, abs(it.x, it.y, it.w, it.h, {opacity: 0}), [{...node, style: {...node.style, width: it.w}}]));
    } else if (it.t === 'tline') {
      kids.push(el('div', id, abs(it.x, it.y, it.w, it.lh, {fontFamily: fonts.body, fontSize: it.s, lineHeight: `${it.lh}px`, color: pal.fg, whiteSpace: 'nowrap', margin: 0, opacity: 0}), [
        ...(it.before ? [it.before] : []),
        el('span', null, {position: 'relative', color: pal.accent, fontWeight: 650}, [it.token,
          el('span', `${prefix}-ptk-0`, {position: 'absolute', left: r2(-6 * u), right: r2(-6 * u), top: r2(it.lh * 0.08), bottom: r2(it.lh * 0.08), border: `${r2(2.5 * u)}px solid ${pal.accent}`, borderRadius: r2(5 * u),
            background: hex2(pal.accent, 0.14), boxShadow: `0 0 ${r2(10 * u)}px ${hex2(pal.accent, 0.6)}`, boxSizing: 'border-box', clipPath: 'inset(0% 100% 0% 0%)'})]),
        it.after]));
    } else {
      // A box: the text centres in the height reserved for it (its line count is an estimate).
      const extra = {opacity: 0, ...(it.clip ? {overflow: 'hidden', textOverflow: 'ellipsis'} : {}), ...(it.box ? {height: it.box, display: 'flex', alignItems: 'center'} : {})};
      const opts = {size: it.s, family: family(it.f), color: colorOf(pal, it.c), align: it.al ?? 'left', weight: it.wt, lineHeight: it.lh ?? 1.25, wrap: !!it.wrap, extra};
      const node = label(id, it.x, it.y, it.w, '', opts);
      const parts = Array.isArray(it.v) ? it.v.map(p => el('span', null, {color: colorOf(pal, p.c)}, [p.v])) : [it.v];
      node.children = it.box ? [el('div', null, null, parts)] : parts;
      kids.push(node);
    }
  });
  if (card.code) {
    kids.push(...codeNodes(prefix, card.code, pal, font, card.codeTop, card.w));
    kids.push(...tokenNodes(prefix, card.code, pal, card.codeTop, u));
  }
  return el('div', prefix, abs(x, y, card.w, card.h, panelStyle(pal, u)), kids);
}

/**
 * A card's build: the panel racks into focus (blur 14 → 0, rise) at `at`,
 * header items fade in 40 ms apart, code rows follow; → the time the last
 * row lands.
 */
export function cardBuildOps(ops, model, card, prefix, at, {rowStep = 0.07, blur = true} = {}) {
  const {start, unit: u} = model;
  const from = {opacity: 0, x: 0, y: r2(26 * u), scaleX: 0.97, scaleY: 0.97, ...(blur ? {blur: r2(14 * u)} : {})};
  set(ops, prefix, start, from);
  tw(ops, prefix, at, 0.55, 'power3.out', from, {opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1, ...(blur ? {blur: 0} : {})});
  card.items.forEach((_, i) => {
    set(ops, `${prefix}-h-${i}`, start, {opacity: 0});
    tw(ops, `${prefix}-h-${i}`, rt(at + 0.15 + Math.min(i, 10) * 0.04), 0.3, 'power1.out', {opacity: 0}, {opacity: 1});
  });
  if (!card.code) return rt(at + 0.6);
  return rowOps(ops, prefix, start, card.code.rows, rt(at + 0.35), rowStep, u);
}

/** A card's token boxes draw on at `at` (code tokens stroke on; a prose token wipes in). */
export function cardTokenOps(ops, model, card, prefix, at) {
  if (card.code) tokenOps(ops, prefix, model.start, card.code.tokens.length, at);
  else if (card.tokens.length) {
    const closed = {clipT: 0, clipR: 100, clipB: 0, clipL: 0};
    set(ops, `${prefix}-ptk-0`, model.start, closed);
    tw(ops, `${prefix}-ptk-0`, at, 0.5, 'power2.inOut', closed, {clipT: 0, clipR: 0, clipB: 0, clipL: 0});
  }
}

// ---------------------------------------------------------------------------
// repo-pr-card and commit-card

const CARD_ALLOWED = {
  'repo-pr-card': ['repo', 'number', 'title', 'state', 'author', 'date', 'file', 'additions', 'deletions', 'lines', 'startLine', 'highlight', 'highlightAt', 'at'],
  'commit-card': ['repo', 'sha', 'verified', 'authors', 'message', 'number', 'date', 'file', 'additions', 'deletions', 'lines', 'startLine', 'highlight', 'highlightAt', 'at']
};

function singleCardResolve(id, kind, required) {
  return (params, ctx) => {
    const b = createHBase(id, params, ctx, {allowed: CARD_ALLOWED[id], required, variants: CARD_VARIANTS});
    const {u, rect, check} = b;
    const p = b.params;
    const {highlightAt, at: atIn, rect: _rect, ...fields} = p;
    const spec = sourceSpec(b, fields, 'params', {kind});
    const pal = cardPalette(b, b.variant);
    // Alone on stage, the card takes the rect's width (the safe area by
    // default) at the largest scale, up to 1.5x, whose height fits.
    const width = r2(rect.width);
    // The URL bar repeats the repo row: it goes when that buys a larger scale.
    const withBar = fitCard(b, spec, 'params', {width, compact: false, maxHeight: rect.height, scale: HERO_SCALE});
    const bare = withBar.code && withBar.sizes.code < b.u(34 * HERO_SCALE) ? fitCard(b, spec, 'params', {width, compact: false, maxHeight: rect.height, scale: HERO_SCALE, urlBar: false}) : null;
    const card = bare && bare.code.size > withBar.code.size ? bare : withBar;
    const x = r2((rect.width - width) / 2), y = r2((rect.height - card.h) / 2);
    const buildAt = b.timeOf('build', atIn, 'params.at', 0.5);
    const rows = card.code?.rows.length ?? 0;
    const rowStep = rows > 1 ? Math.min(0.09, 0.8 / (rows - 1)) : 0;
    const rowsEnd = rt(buildAt + 0.35 + Math.max(0, rows - 1) * rowStep + 0.32);
    b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: rowsEnd, role: 'emphasis', cue: 'whoosh-soft'});
    let hlAt = null;
    if (card.tokens.length) {
      hlAt = cueTime(b, 'highlight', highlightAt, 'params.highlightAt', rowsEnd - b.start + 0.4, rowsEnd - b.start);
      b.events.push({id: `${b.id}-highlight`, name: 'highlight', time: hlAt, endTime: rt(hlAt + 0.55 + (card.tokens.length - 1) * 0.35), role: 'emphasis', cue: 'ping-soft'});
    } else if (highlightAt !== undefined) check.fail('params.highlightAt', 'needs params.highlight');
    const content = {variant: b.variant, pal, code: codeFont(b.fonts), card, x, y, buildAt, rowStep, highlightAt: hlAt, buildEnd: rowsEnd};
    return b.finish(content, {minTextPx: card.titleSize ?? b.min.key});
  };
}

function singleCardView(model) {
  const c = model.content;
  return [cardNode(model, c.card, `${model.id}-card`, c.x, c.y, {pal: c.pal, code: c.code})];
}

function singleCardTimeline(model, ops) {
  const c = model.content;
  cardBuildOps(ops, model, c.card, `${model.id}-card`, c.buildAt, {rowStep: c.rowStep});
  if (c.highlightAt !== null) cardTokenOps(ops, model, c.card, `${model.id}-card`, c.highlightAt);
}

const CARD_COMMON = {lines: `${LINES}, 1–${MAX_LINES}`, startLine: 'first line number: n or {old, new} (optional; a hunk header line sets it too)', file: 'path of the file the lines are from ≤ 160 (optional)',
  additions: 'integer (optional; default: counted from lines)', deletions: 'integer (optional; default: counted from lines)', date: '"YYYY-MM-DD" (optional)', highlight: HIGHLIGHT,
  highlightAt: `the token boxes draw on: ${at}`, at: `build start: ${at}`, variant: VARIANT_PARAM, rect};

export const repoPrCard = {
  id: 'repo-pr-card',
  describe: 'A GitHub pull request rebuilt as a glass card: repo, PR number, title, merged/open state chip, author avatar and date, and a −/+ excerpt with line numbers; a box draws round the highlighted token (a model name, a flag) on its word. Real data only: map a PR with src/evidence/github.js.',
  params: {repo: '"owner/name"', number: 'PR number', title: 'PR title ≤ 140', state: 'merged | open | closed | draft (default open)', author: '"login" | {login, avatar? (assets/ image)}', ...CARD_COMMON},
  events: ['build', 'highlight'], timing: timingRules({rules: ['the card racks into focus at at; rows land top to bottom within about 0.8 s', 'the token boxes draw 0.4 s after the rows (or on the highlight hit)']}), variants: CARD_VARIANTS,
  resolve: singleCardResolve('repo-pr-card', 'pr', ['repo', 'number', 'title', 'lines']), view: singleCardView, timeline: singleCardTimeline
};

export const commitCard = {
  id: 'commit-card',
  describe: 'A GitHub commit rebuilt as a glass card: repo, short sha, a Verified chip, co-author avatars and names, the message, the file path and the diff hunk; a box draws round the highlighted token on its word. Real data only (src/evidence/github.js).',
  params: {repo: '"owner/name"', sha: '7–40 hex (shown as 7)', verified: 'boolean (default false)', authors: '["login" | {login, avatar?}] 1–3', message: 'the commit message\'s first line ≤ 140', number: 'the PR number it came from (optional, shown "(#n)")', ...CARD_COMMON},
  events: ['build', 'highlight'], timing: timingRules({rules: ['the card racks into focus at at; rows land within about 0.8 s', 'the token boxes draw 0.4 s after the rows (or on the highlight hit)']}), variants: CARD_VARIANTS,
  resolve: singleCardResolve('commit-card', 'commit', ['repo', 'sha', 'message', 'lines']), view: singleCardView, timeline: singleCardTimeline
};

// ---------------------------------------------------------------------------
// diff-view

const MAX_FOCUS = 6;
const MAX_DIFF_LINES = 18;

function diffResolve(params, ctx) {
  const b = createHBase('diff-view', params, ctx, {allowed: ['file', 'lines', 'startLine', 'additions', 'deletions', 'focus', 'highlight', 'highlightAt', 'at'], required: ['file', 'lines', 'focus'], variants: CARD_VARIANTS});
  const {u, rect, check} = b;
  const p = b.params;
  const rowsIn = parseLines(check, p.lines, 'params.lines', {diff: true, start: p.startLine, min: 2, max: MAX_DIFF_LINES});
  const spec = {file: check.str(p.file, 'params.file', 160), rows: rowsIn, tokens: locateTokens(check, rowsIn, parseHighlights(check, p.highlight, 'params.highlight'), 'params.highlight'),
    additions: p.additions === undefined ? rowsIn.filter(r => r.type === 'add').length : check.int(p.additions, 'params.additions', 0, 1e7),
    deletions: p.deletions === undefined ? rowsIn.filter(r => r.type === 'del').length : check.int(p.deletions, 'params.deletions', 0, 1e7)};
  check.arr(p.focus, 'params.focus', 1, MAX_FOCUS);
  const n = spec.rows.length;
  const focus = p.focus.map((f, i) => {
    const path = `params.focus[${i}]`;
    check.obj(f, path, ['row', 'rows', 'line', 'at'], []);
    const keys = ['row', 'rows', 'line'].filter(k => f[k] !== undefined);
    if (keys.length !== 1) check.fail(path, 'needs exactly one of row, rows [from, to] or line (a new-file line number)');
    let a, z;
    if (f.row !== undefined) a = z = check.int(f.row, `${path}.row`, 0, n - 1);
    else if (f.rows !== undefined) {
      check.arr(f.rows, `${path}.rows`, 2, 2);
      a = check.int(f.rows[0], `${path}.rows[0]`, 0, n - 1); z = check.int(f.rows[1], `${path}.rows[1]`, a, n - 1);
    } else {
      const line = check.int(f.line, `${path}.line`, 1, 1e6);
      a = z = spec.rows.findIndex(r => r.new === line);
      if (a < 0) check.fail(`${path}.line`, `${line} is not a new-file line in params.lines`);
    }
    return {a, z, at: f.at};
  });
  const pal = cardPalette(b, b.variant);
  // Alone on stage: the rect's width, at the largest scale (up to 1.5x) whose height fits.
  const width = r2(rect.width);
  const layoutDiff = z => {
    // Files-changed header: chevron, path, +/− stats and the stat blocks.
    const items = [];
    const hh = r2(z.head * 1.9);
    items.push({t: 'band', h: hh});
    items.push({t: 'icon', n: 'chevron-down', x: z.pad, y: r2((hh - z.meta) / 2), s: z.meta, c: 'muted'});
    const statsV = [{v: `+${spec.additions}`, c: 'add'}, {v: ` −${spec.deletions}`, c: 'del'}];
    const statsW = (String(spec.additions).length + String(spec.deletions).length + 3) * z.meta * CODE_ADVANCE;
    const blocksW = 5 * z.meta * 0.62;
    const room = Math.floor((width - 2 * z.pad - z.meta * 1.5 - statsW - blocksW - u(24)) / (z.code * CODE_ADVANCE));
    const fileText = spec.file.length > room ? `…${spec.file.slice(spec.file.length - room + 1)}` : spec.file;
    items.push({t: 'text', x: r2(z.pad + z.meta * 1.5), y: r2((hh - z.code * 1.25) / 2), w: r2(width - 2 * z.pad - statsW - blocksW), v: fileText, s: z.code, f: 'code', c: 'fg', wt: 600});
    items.push({t: 'text', x: z.pad, y: r2((hh - z.meta * 1.25) / 2), w: r2(width - 2 * z.pad - blocksW - u(14)), v: statsV, s: z.meta, f: 'code', c: 'muted', al: 'right'});
    const total = spec.additions + spec.deletions || 1, greens = Math.round(5 * spec.additions / total);
    const reds = spec.additions + spec.deletions ? 5 - greens : 0;
    for (let k = 0; k < 5; k++) items.push({t: 'box', x: r2(width - z.pad - blocksW + k * z.meta * 0.62), y: r2((hh - z.meta * 0.5) / 2), w: r2(z.meta * 0.5), h: r2(z.meta * 0.5), fill: k < greens ? 'add' : k < greens + reds ? 'del' : 'faint'});
    const codeTop = r2(hh + u(10));
    const code = layoutCode(b, spec.rows, spec.tokens, {width, preferred: z.code, min: b.min.meta, floor: z.codeFloor, lead: z.lead, gutters: 2, diff: true, path: 'params.lines'});
    const h = r2(codeTop + code.height + u(16));
    return {kind: 'diff', w: width, h, items, titleSize: null, code, codeTop, tokens: code.tokens.map(t => ({x: t.x, y: r2(codeTop + t.y), w: t.w, h: t.h})), sizes: z};
  };
  let card = null;
  for (let k = HERO_SCALE; k > 1 - 1e-9 && !(card && card.h <= rect.height); k = Math.round((k - 0.1) * 100) / 100) card = layoutDiff(cardSizes(b, false, k));
  if (card.h > rect.height) check.fail('params.lines', `make a ${Math.round(card.h)} px diff, taller than the ${Math.round(rect.height)} px rect; use fewer lines`);
  const {h, codeTop, code} = card;
  const x = r2((rect.width - width) / 2), y = r2((rect.height - h) / 2);

  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const rowStep = n > 1 ? Math.min(0.07, 0.7 / (n - 1)) : 0;
  const rowsEnd = rt(buildAt + 0.35 + (n - 1) * rowStep + 0.32);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: rowsEnd, role: 'emphasis', cue: 'whoosh-soft'});
  const settled = rowsEnd - b.start;
  const first = settled + 0.3, last = Math.max(first, b.lastEvent - 0.4);
  const gap = focus.length > 1 ? Math.min(1.6, (last - first) / (focus.length - 1)) : 0;
  focus.forEach((f, i) => {
    f.time = cueTime(b, `focus-${i}`, f.at, `params.focus[${i}].at`, first + i * gap, settled);
    if (i && f.time < focus[i - 1].time + 0.3) check.fail(`params.focus[${i}].at`, `must come at least 0.3 s after focus ${i - 1}`);
    b.events.push({id: `${b.id}-focus-${i}`, name: `focus-${i}`, time: f.time, endTime: rt(f.time + 0.45), role: 'emphasis', cue: 'tick'});
    f.top = r2(codeTop + f.a * code.rowH); f.height = r2((f.z - f.a + 1) * code.rowH);
    delete f.at;
  });
  let hlAt = null;
  if (code.tokens.length) {
    hlAt = cueTime(b, 'highlight', p.highlightAt, 'params.highlightAt', focus[0].time - b.start + 0.4, settled);
    b.events.push({id: `${b.id}-highlight`, name: 'highlight', time: hlAt, endTime: rt(hlAt + 0.55), role: 'emphasis', cue: 'ping-soft'});
  } else if (p.highlightAt !== undefined) check.fail('params.highlightAt', 'needs params.highlight');
  const content = {variant: b.variant, pal, code: codeFont(b.fonts), card, x, y, buildAt, rowStep, focus, highlightAt: hlAt, buildEnd: rowsEnd};
  return b.finish(content, {minTextPx: Math.max(b.min.key, card.sizes.code)});
}

function diffNodes(model) {
  const {id, unit: u} = model;
  const c = model.content;
  const node = cardNode(model, c.card, `${id}-card`, c.x, c.y, {pal: c.pal, code: c.code});
  c.focus.forEach((f, i) => node.children.push(el('div', `${id}-ring-${i}`, abs(r2(6 * u), f.top, r2(c.card.w - 12 * u), f.height, {border: `${r2(2.5 * u)}px solid ${c.pal.accent}`, borderRadius: r2(8 * u), boxSizing: 'border-box',
    boxShadow: `0 0 ${r2(16 * u)}px ${hex2(c.pal.accent, 0.55)}, inset 0 0 ${r2(10 * u)}px ${hex2(c.pal.accent, 0.25)}`, opacity: 0, transformOrigin: '50% 0%'}))));
  return [node];
}

function diffTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  const prefix = `${id}-card`;
  cardBuildOps(ops, model, c.card, prefix, c.buildAt, {rowStep: c.rowStep});
  const rows = c.card.code.rows.length;
  const lit = Array(rows).fill(1);
  c.focus.forEach((f, i) => {
    const ring = `${id}-ring-${i}`;
    if (i === 0) popOps(ops, ring, start, f.time, {from: 1.06, duration: 0.4, ease: 'power3.out'});
    else {
      const prev = c.focus[i - 1];
      const from = {opacity: 1, x: 0, y: r2(prev.top - f.top), scaleX: 1, scaleY: r2(prev.height / f.height * 1e4) / 1e4};
      set(ops, ring, start, {...from, opacity: 0});
      set(ops, ring, f.time, from);
      tw(ops, ring, f.time, 0.42, 'power3.inOut', from, {opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1});
      set(ops, `${id}-ring-${i - 1}`, f.time, {opacity: 0});
    }
    for (let r = 0; r < rows; r++) {
      const target = r >= f.a && r <= f.z ? 1 : 0.3;
      if (target !== lit[r]) tw(ops, `${prefix}-row-${r}`, f.time, 0.35, 'power2.out', {opacity: lit[r]}, {opacity: target});
      lit[r] = target;
    }
  });
  if (c.highlightAt !== null) cardTokenOps(ops, model, c.card, prefix, c.highlightAt);
}

export const diffView = {
  id: 'diff-view',
  describe: 'A Files-changed file diff (path, +/− stats, two line-number gutters, red and green rows) where a cyan focus ring steps through rows in 1–6 states on their cues, sliding and resizing from one to the next while the other rows dim to 30%. Real diffs only (src/evidence/github.js).',
  params: {file: 'path ≤ 160', lines: `${LINES}, 2–${MAX_DIFF_LINES}`, startLine: CARD_COMMON.startLine, additions: CARD_COMMON.additions, deletions: CARD_COMMON.deletions,
    focus: `[{row | rows: [from, to] | line (new-file number), at?}] 1–${MAX_FOCUS} states (events focus-<i>)`, highlight: HIGHLIGHT, highlightAt: CARD_COMMON.highlightAt, at: CARD_COMMON.at, variant: VARIANT_PARAM, rect},
  events: ['build', 'focus-0', 'focus-1', 'focus-2', 'focus-3', 'focus-4', 'focus-5', 'highlight'],
  timing: timingRules({rules: ['rows land within about 0.7 s from at', 'focus states follow the build up to 1.6 s apart (at least 0.3 s)', 'the token box draws 0.4 s after the first focus']}), variants: CARD_VARIANTS,
  resolve: diffResolve, view: diffNodes, timeline: diffTimeline
};

// ---------------------------------------------------------------------------
// evidence-chain

function chainResolve(params, ctx) {
  const b = createHBase('evidence-chain', params, ctx, {allowed: ['sources', 'token', 'title', 'source', 'at'], required: ['sources'], variants: CARD_VARIANTS});
  const {u, rect, check, portrait} = b;
  const p = b.params;
  check.arr(p.sources, 'params.sources', 2, 4);
  const token = p.token === undefined ? null : check.str(p.token, 'params.token', 80);
  const n = p.sources.length;
  const specs = p.sources.map((s, i) => sourceSpec(b, s, `params.sources[${i}]`, {maxLines: MAX_COMPACT_LINES, token}));
  specs.forEach((s, i) => { if (!(s.tokens?.length || s.highlight)) check.fail(`params.sources[${i}].highlight`, 'is required (or params.token): the chain joins the same token in every source'); });
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const pal = cardPalette(b, b.variant);
  const W = rect.width, H = rect.height - tb.top - tb.bottom;
  // 9:16 stacks the cards; 16:9 sets two side by side, cascades three from
  // top left to bottom right (each wider), or sets four in a 2 × 2 grid read
  // left to right, top to bottom.
  const gap = u(portrait ? 34 : 44), lane = portrait ? u(64) : 0;
  const cascade = !portrait && n === 3, grid = !portrait && n === 4;
  const cardW = portrait ? r2(W - lane) : cascade ? r2(Math.min(u(980), W * 0.56)) : r2((W - gap) / 2);
  const maxH = portrait ? (H - gap * (n - 1)) / n : cascade ? H * 0.5 : grid ? (H - u(70)) / 2 : H;
  let cards = specs.map((s, i) => fitCard(b, s, `params.sources[${i}]`, {width: cardW, compact: true, maxHeight: maxH, scale: portrait ? 1.4 : cascade ? 1.05 : 1.3}));
  if (cascade) {
    // A later card may overlap the bottom of the one before, never its token
    // row: each step is at least that token's bottom plus a margin. Cards
    // shrink (padding to 65%, text never under its floor) until it fits.
    const needOf = list => list.slice(0, -1).map(c => Math.max(...c.tokens.map(t => t.y + t.h)) + u(14));
    const roomOf = list => H - list.at(-1).h - needOf(list).reduce((sum, v) => sum + v, 0);
    for (const k of [0.95, 0.85, 0.75, 0.65]) {
      if (roomOf(cards) >= 0) break;
      cards = specs.map((s, i) => layoutCard(b, s, `params.sources[${i}]`, {width: cardW, compact: true, maxHeight: maxH, sizes: cardSizes(b, true, k)}));
    }
    const need = needOf(cards), room = roomOf(cards);
    if (room < 0) check.fail('params.sources', `cascade ${Math.round(H - room)} px tall in ${Math.round(H)} px; use fewer lines or sources, or highlight a token nearer the top of each card`);
    const steps = need.map((v, i) => Math.min(cards[i].h + u(60), v + room / (n - 1)));
    const top = tb.top + (room - steps.reduce((sum, v, i) => sum + v - need[i], 0)) / 2;
    let y = top;
    cards.forEach((c, i) => { c.x = r2(i * (W - cardW) / (n - 1)); c.y = r2(y); y += steps[i] ?? 0; });
  } else if (grid) {
    const rowH = [Math.max(cards[0].h, cards[1].h), Math.max(cards[2].h, cards[3].h)];
    const vgap = Math.min(u(90), H - rowH[0] - rowH[1]);
    const top = tb.top + (H - rowH[0] - rowH[1] - vgap) / 2;
    cards.forEach((c, i) => { const row = i >> 1; c.x = r2((i % 2) * (cardW + gap)); c.y = r2(top + (row ? rowH[0] + vgap : 0) + (rowH[row] - c.h) / 2); });
  } else if (portrait) {
    const total = cards.reduce((sum, c) => sum + c.h, 0) + gap * (n - 1);
    if (total > H) check.fail('params.sources', `stack ${Math.round(total)} px tall in ${Math.round(H)} px; use fewer lines or sources`);
    let y = tb.top + (H - total) / 2;
    cards.forEach(c => { c.x = lane; c.y = r2(y); y += c.h + gap; });
  } else cards.forEach((c, i) => { c.x = r2(i * (cardW + gap)); c.y = r2(tb.top + (H - c.h) / 2); });

  // Each card's first token, in module coordinates.
  const anchor = c => { const t = c.tokens[0]; return {x0: r2(c.x + t.x), x1: r2(c.x + t.x + t.w), y: r2(c.y + t.y + t.h / 2)}; };
  const links = cards.slice(1).map((c, k) => {
    const A = anchor(cards[k]), B = anchor(c);
    if (cascade || (grid && k === 1)) {
      // From the bottom of one token's box to the top of the next.
      const ta = cards[k].tokens[0], tb2 = c.tokens[0];
      const a0 = {x: r2(cards[k].x + ta.x + ta.w / 2), y: r2(cards[k].y + ta.y + ta.h)}, b0 = {x: r2(c.x + tb2.x + tb2.w / 2), y: r2(c.y + tb2.y)};
      const box = {x: r2(Math.min(a0.x, b0.x) - u(8)), y: r2(a0.y - u(2)), w: r2(Math.abs(b0.x - a0.x) + u(16)), h: r2(b0.y - a0.y + u(4))};
      const a = {x: r2(a0.x - box.x), y: u(2)}, z = {x: r2(b0.x - box.x), y: r2(b0.y - box.y)};
      return {box, d: `M${a.x} ${a.y} C${a.x} ${r2(box.h * 0.75)} ${z.x} ${r2(box.h * 0.25)} ${z.x} ${z.y}`, a, b: z, dir: 'down'};
    }
    if (portrait) {
      const lx = r2(Math.min(A.x0, B.x0) - u(40)), x = r2(Math.max(u(6), Math.min(lx, lane - u(14))));
      const box = {x: r2(x - u(8)), y: r2(A.y - u(8)), w: r2(Math.max(A.x0, B.x0) - x + u(16)), h: r2(B.y - A.y + u(16))};
      const d = `M${r2(A.x0 - box.x)} ${u(8)} C${r2(x - box.x - u(10))} ${u(8)} ${r2(x - box.x - u(10))} ${r2(box.h - u(8))} ${r2(B.x0 - box.x)} ${r2(box.h - u(8))}`;
      return {box, d, a: {x: r2(A.x0 - box.x), y: u(8)}, b: {x: r2(B.x0 - box.x), y: r2(box.h - u(8))}, dir: 'down'};
    }
    const ax = cards[k].kind === 'announcement' ? r2(cards[k].x + cards[k].w) : A.x1;
    const x0 = Math.min(ax, B.x0), y0 = Math.min(A.y, B.y);
    const box = {x: r2(x0 - u(8)), y: r2(y0 - u(8)), w: r2(Math.abs(B.x0 - ax) + u(16)), h: r2(Math.abs(B.y - A.y) + u(16))};
    const a = {x: r2(ax - box.x), y: r2(A.y - box.y)}, bb = {x: r2(B.x0 - box.x), y: r2(B.y - box.y)};
    const mid = r2((a.x + bb.x) / 2);
    return {box, d: `M${a.x} ${a.y} C${mid} ${a.y} ${mid} ${bb.y} ${bb.x} ${bb.y}`, a, b: bb, dir: 'right'};
  });

  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: rt(buildAt + 0.6), role: 'emphasis', cue: 'whoosh-soft'});
  // A source's token draws once its rows are in; its connector follows.
  const tokenLag = cards.map(c => r2(Math.max(0.35 + Math.max(0, (c.code?.rows.length ?? 0) - 1) * 0.06 + 0.32, 0.6) + 0.15));
  const exitAt = b.motion.exitStart - b.start;
  const first = buildAt - b.start, last = Math.max(first, Math.min(b.lastEvent, exitAt - tokenLag.at(-1) - 0.25 - 0.6 - 0.1));
  const step = n > 1 ? Math.max(0.4, Math.min(2.6, (last - first) / (n - 1))) : 0;
  const timing = specs.map((_, i) => {
    const t = cueTime(b, `source-${i}`, p.sources[i].at, `params.sources[${i}].at`, first + i * step, first);
    const tokenAt = rt(t + tokenLag[i]);
    return {at: t, tokenAt, linkAt: i ? rt(tokenAt + 0.25) : null};
  });
  timing.forEach((tm, i) => {
    if (i && tm.at < timing[i - 1].at + 0.4 - 1e-6) check.fail(`params.sources[${i}].at`, `must come at least 0.4 s after source ${i - 1} (${r2(timing[i - 1].at - b.start)} s)`);
    b.events.push({id: `${b.id}-source-${i}`, name: `source-${i}`, time: tm.at, endTime: tm.tokenAt, role: 'emphasis', cue: i ? 'whoosh-soft' : 'pop'});
    if (tm.linkAt) b.events.push({id: `${b.id}-link-${i}`, name: `link-${i}`, time: tm.linkAt, endTime: rt(tm.linkAt + 0.6), role: 'emphasis', cue: 'ping-soft'});
  });
  const content = {variant: b.variant, title: tb.title, source: tb.source, align: 'center', pal, code: codeFont(b.fonts), cards, links, timing, buildAt, buildEnd: timing.at(-1).tokenAt};
  return b.finish(content, {minTextPx: tb.title ? tb.title.size : b.min.key});
}

function linkNode(id, link, pal, u) {
  const {box} = link;
  const dot = (pt, k) => el('circle', `${id}-dot-${k}`, {opacity: 0}, [], {cx: pt.x, cy: pt.y, r: r2(5 * u), fill: pal.accent});
  return el('svg', id, abs(box.x, box.y, box.w, box.h, {overflow: 'visible', clipPath: link.dir === 'down' ? 'inset(0% 0% 100% 0%)' : 'inset(0% 100% 0% 0%)'}), [
    el('path', null, {filter: `drop-shadow(0 0 ${r2(5 * u)}px ${hex2(pal.accent, 0.7)})`}, [], {d: link.d, stroke: pal.accent, strokeWidth: r2(2.5 * u), strokeDasharray: `${r2(7 * u)} ${r2(7 * u)}`, strokeLinecap: 'round', fill: 'none'}),
    dot(link.a, 0), dot(link.b, 1)
  ], {width: box.w, height: box.h, viewBox: `0 0 ${box.w} ${box.h}`, fill: 'none'});
}

function chainView(model) {
  const {id, unit: u} = model;
  const c = model.content;
  const kids = chromeNodes(model);
  c.cards.forEach((card, i) => kids.push(cardNode(model, card, `${id}-s${i}`, card.x, card.y, {pal: c.pal, code: c.code})));
  c.links.forEach((link, k) => kids.push(linkNode(`${id}-link-${k + 1}`, link, c.pal, u)));
  return kids;
}

function chainTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  chromeOps(model, ops);
  c.cards.forEach((card, i) => {
    const tm = c.timing[i];
    cardBuildOps(ops, model, card, `${id}-s${i}`, tm.at, {rowStep: 0.06});
    cardTokenOps(ops, model, card, `${id}-s${i}`, tm.tokenAt);
    if (!tm.linkAt) return;
    const link = `${id}-link-${i}`, dir = c.links[i - 1].dir;
    const closed = dir === 'down' ? {clipT: 0, clipR: 0, clipB: 100, clipL: 0} : {clipT: 0, clipR: 100, clipB: 0, clipL: 0};
    set(ops, link, start, closed);
    tw(ops, link, tm.linkAt, 0.6, 'power2.inOut', closed, {clipT: 0, clipR: 0, clipB: 0, clipL: 0});
    for (const [k, t] of [[0, tm.linkAt], [1, rt(tm.linkAt + 0.5)]]) {
      set(ops, `${link}-dot-${k}`, start, {opacity: 0});
      tw(ops, `${link}-dot-${k}`, t, 0.2, 'power1.out', {opacity: 0}, {opacity: 1});
    }
  });
}

export const evidenceChain = {
  id: 'evidence-chain',
  describe: 'An evidence chain: 2–4 sources (a PR, a commit, a file excerpt, an announcement) side by side (stacked in 9:16, cascading or in a 2 × 2 grid for 3–4 in 16:9), built one at a time, the same highlighted token boxed in each and joined to the previous one by an animated dashed connector: "the same name in three places".',
  params: {sources: `[${SOURCE} + at?] 2–4, up to ${MAX_COMPACT_LINES} lines each (events source-<i>, link-<i>)`, token: 'the token to box in every source that sets no highlight (optional)', title: 'string ≤ 60 (optional)',
    source: 'string ≤ 80 (optional)', at: `first source: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['build', 'source-0', 'source-1', 'source-2', 'source-3', 'link-1', 'link-2', 'link-3'],
  timing: timingRules({rules: ['each source racks in, its rows land, then its token box draws; the connector from the previous token follows 0.25 s later', 'sources are spaced evenly, 0.4–2.6 s apart, the last connector ending before the exit when the scene is long enough (about 2.5 s per source)']}), variants: CARD_VARIANTS,
  resolve: chainResolve, view: chainView, timeline: chainTimeline
};

// ---------------------------------------------------------------------------
// date-pinned-timeline

const TIMELINE_VARIANTS = Object.freeze(['axis', 'summary']);
const EVERY_DAY = [1, 2, 5, 7, 10];

function timelineResolve(params, ctx) {
  const b = createHBase('date-pinned-timeline', params, ctx, {allowed: ['from', 'to', 'cards', 'title', 'subtitle', 'at'], required: ['from', 'to', 'cards'], variants: TIMELINE_VARIANTS});
  const {u, rect, check, portrait} = b;
  const p = b.params;
  const from = parseDate(check, p.from, 'params.from'), to = parseDate(check, p.to, 'params.to');
  const days = to.day - from.day;
  if (days < 1 || days > 45) check.fail('params.to', `must be 1–45 days after params.from (got ${days})`);
  check.arr(p.cards, 'params.cards', 1, 4);
  const entries = p.cards.map((raw, i) => {
    const path = `params.cards[${i}]`;
    if (raw?.date === undefined) check.fail(`${path}.date`, 'is required');
    const date = parseDate(check, raw.date, `${path}.date`);
    if (date.day < from.day || date.day > to.day) check.fail(`${path}.date`, `must fall between params.from and params.to (${from.iso} … ${to.iso})`);
    const lab = raw.label === undefined ? null : check.str(raw.label, `${path}.label`, 32);
    return {date, label: lab, at: raw.at, spec: sourceSpec(b, raw, path, {maxLines: b.variant === 'summary' ? MAX_COMPACT_LINES : 4})};
  });
  entries.forEach((e, i) => { if (i && e.date.day < entries[i - 1].date.day) check.fail(`params.cards[${i}].date`, 'cards must be in date order'); });
  const pal = cardPalette(b, 'glass');
  const W = rect.width, H = rect.height;
  const n = entries.length;
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  let content;
  if (b.variant === 'axis') {
    if (p.title !== undefined || p.subtitle !== undefined) check.fail(p.title !== undefined ? 'params.title' : 'params.subtitle', 'is drawn by the summary variant only');
    const daySize = r2(Math.max(b.min.key, u(44))), monthSize = r2(Math.max(b.min.meta, u(28)));
    const labelW = textWidth('30', daySize, 'display') + u(10);
    const pad = r2(labelW / 2 + u(4)), axisW = W - 2 * pad - textWidth(to.month, monthSize, 'meta') - u(30);
    const xOf = d => r2(pad + (d - from.day) / days * axisW);
    const every = EVERY_DAY.find(k => (axisW / days) * k >= labelW + u(8)) ?? days;
    const axisY = r2(H - daySize * 1.3 - u(30)), labelY = r2(axisY + u(22));
    const cardW = r2(portrait ? W * 0.9 : Math.min(u(860), W * 0.5));
    const areaH = axisY - u(40);
    const cards = entries.map((e, i) => fitCard(b, e.spec, `params.cards[${i}]`, {width: cardW, compact: true, maxHeight: n > 1 ? areaH * 0.62 : areaH, scale: portrait ? 1.4 : 1.25}));
    const maxH = Math.max(...cards.map(c => c.h));
    // Cards stack lower one by one; a card may cover the one before, never its token row.
    const tokenFloor = Math.max(0, ...cards.slice(0, -1).map(c => (c.tokens.length ? Math.max(...c.tokens.map(t => t.y + t.h)) : r2(c.sizes.head * 1.6 + c.sizes.pad)) + u(30)));
    const stepY = n > 1 ? Math.min(maxH + u(24), (areaH - maxH) / (n - 1)) : 0;
    if (n > 1 && stepY < tokenFloor - 1e-6) check.fail('params.cards', `leave too little room to stack ${n} cards without covering a token; use fewer lines or cards`);
    const top = r2((areaH - (maxH + (n - 1) * stepY)) / 2);
    cards.forEach((c, i) => { const dx = xOf(entries[i].date.day); c.x = r2(Math.min(Math.max(0, dx - u(18)), W - cardW)); c.y = r2(top + i * stepY); c.pinX = dx; });
    // The last card's token box must finish drawing before the exit.
    const lag = c => r2(0.35 + 0.35 + Math.max(0, (c.code?.rows.length ?? 0) - 1) * 0.06 + 0.32 + 0.1);
    const first = buildAt - b.start + 0.9, last = Math.max(first, Math.min(b.lastEvent, b.motion.exitStart - b.start - lag(cards.at(-1)) - 0.65));
    const step = n > 1 ? Math.max(0.4, Math.min(2.4, (last - first) / (n - 1))) : 0;
    const pins = entries.map((e, i) => {
      const t = cueTime(b, `card-${i}`, e.at, `params.cards[${i}].at`, first + i * step, buildAt - b.start + 0.6);
      if (i && t < cards[i - 1].at + 0.4 - 1e-6) check.fail(`params.cards[${i}].at`, 'must come at least 0.4 s after the card before');
      cards[i].at = t;
      const tokenAt = rt(t + lag(cards[i]));
      b.events.push({id: `${b.id}-card-${i}`, name: `card-${i}`, time: t, endTime: tokenAt, role: 'emphasis', cue: 'pop'});
      return {x: cards[i].pinX, top: r2(cards[i].y + cards[i].h), at: t, cardAt: rt(t + 0.3), tokenAt, day: e.date.day - from.day};
    });
    const ticks = Array.from({length: days + 1}, (_, k) => ({x: xOf(from.day + k), dom: new Date((from.day + k) * 864e5).getUTCDate(), label: k % every === 0 || pins.some(pin => pin.day === k), lit: pins.findIndex(pin => pin.day === k)}));
    b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: rt(buildAt + 0.8), role: 'emphasis', cue: 'whoosh-soft'});
    content = {variant: 'axis', pal, code: codeFont(b.fonts), cards, pins, ticks, axisY, labelY, daySize, monthSize, month: to.month, pad, axisW: r2(axisW), labelW: r2(labelW), buildAt, buildEnd: rt(buildAt + 0.8)};
    return b.finish(content, {minTextPx: daySize});
  }
  // Summary: "why now?" over N clue thumbnails, each with its date and label.
  const title = check.str(p.title ?? 'why now?', 'params.title', 40);
  const subtitle = check.str(p.subtitle ?? `${n} clue${n === 1 ? '' : 's'} in ${days + 1} days`, 'params.subtitle', 60);
  const titleFit = fitText(check, 'params.title', title, {family: 'display', width: Math.min(W, u(1100)) - u(80), preferred: u(portrait ? 110 : 100), min: b.min.key});
  const subFit = fitText(check, 'params.subtitle', subtitle, {family: 'body', width: Math.min(W, u(1100)) - u(80), preferred: u(40), min: b.min.key * 0.8 > b.min.meta ? b.min.key * 0.8 : b.min.meta});
  const dot = u(12), dotGap = Math.min(u(30), (Math.min(W, u(1100)) - u(80)) / (days + 1));
  const panelW = r2(Math.min(W, Math.max(textWidth(title, titleFit.size, 'display'), textWidth(subtitle, subFit.size, 'body'), dotGap * (days + 1)) + u(90)));
  const panelH = r2(titleFit.size * 1.1 + subFit.size * 1.3 + dot + u(96));
  const cols = portrait && n > 2 ? 2 : n;
  const rowsN = Math.ceil(n / cols);
  const gap = u(portrait ? 40 : 56);
  const thumbW = r2(Math.min(u(540), (W - gap * (cols - 1)) / cols));
  const nominal = u(600), scale = r2(thumbW / nominal * 1e4) / 1e4;
  const cards = entries.map((e, i) => layoutCard(b, e.spec, `params.cards[${i}]`, {width: nominal, compact: true}));
  const capSize = r2(Math.max(b.min.key, u(44))), labSize = r2(Math.max(b.min.meta, u(28)));
  const thumbH = r2(Math.max(...cards.map(c => c.h)) * scale);
  const cellH = r2(thumbH + u(16) + capSize * 1.2 + (entries.some(e => e.label) ? labSize * 1.3 : 0));
  const linkH = u(portrait ? 90 : 70);
  const total = panelH + linkH + rowsN * cellH + (rowsN - 1) * gap;
  if (total > H) check.fail('params.cards', `need ${Math.round(total)} px of height and the rect has ${Math.round(H)}; use fewer cards or lines`);
  const top = r2((H - total) / 2);
  const panel = {x: r2((W - panelW) / 2), y: top, w: panelW, h: panelH};
  const gridW = cols * thumbW + (cols - 1) * gap, gx = (W - gridW) / 2;
  cards.forEach((c, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const rowCount = Math.min(cols, n - row * cols);
    const offset = (cols - rowCount) * (thumbW + gap) / 2;
    c.x = r2(gx + offset + col * (thumbW + gap)); c.y = r2(top + panelH + linkH + row * (cellH + gap)); c.scale = scale;
  });
  const first = buildAt - b.start + 1.1, last = Math.max(first, b.lastEvent - 0.6);
  const step = n > 1 ? Math.min(1.2, (last - first) / (n - 1)) : 0;
  cards.forEach((c, i) => {
    c.at = cueTime(b, `card-${i}`, entries[i].at, `params.cards[${i}].at`, first + i * step, buildAt - b.start + 0.6);
    b.events.push({id: `${b.id}-card-${i}`, name: `card-${i}`, time: c.at, endTime: rt(c.at + 0.6), role: 'emphasis', cue: 'pop'});
    c.date = entries[i].date.short; c.label = entries[i].label;
  });
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: rt(buildAt + 0.9), role: 'emphasis', cue: 'whoosh-soft'});
  const dots = Array.from({length: days + 1}, (_, k) => ({lit: entries.findIndex(e => e.date.day - from.day === k)}));
  const links = cards.map(c => {
    const ax = r2(W / 2), ay = r2(panel.y + panel.h), bx = r2(c.x + thumbW / 2), by = r2(c.y - u(8));
    const box = {x: r2(Math.min(ax, bx) - u(8)), y: r2(ay - u(2)), w: r2(Math.abs(bx - ax) + u(16)), h: r2(by - ay + u(4))};
    const a = {x: r2(ax - box.x), y: u(2)}, z = {x: r2(bx - box.x), y: r2(by - box.y)};
    return {box, d: `M${a.x} ${a.y} C${a.x} ${r2(box.h * 0.6)} ${z.x} ${r2(box.h * 0.4)} ${z.x} ${z.y}`};
  });
  content = {variant: 'summary', pal, code: codeFont(b.fonts), panel, title: {text: title, size: titleFit.size}, subtitle: {text: subtitle, size: subFit.size}, dots, dot, dotGap: r2(dotGap), cards, thumbW, capSize, labSize, links, buildAt, buildEnd: rt(buildAt + 0.9)};
  return b.finish(content, {minTextPx: Math.min(titleFit.size, capSize)});
}

function timelineView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content, pal = c.pal;
  const W = model.rect.width;
  const kids = [];
  if (c.variant === 'axis') {
    c.pins.forEach((pin, i) => kids.push(el('div', `${id}-pin-${i}`, abs(r2(pin.x - 1 * u), pin.top, r2(2 * u), r2(c.axisY - pin.top), {borderLeft: `${r2(2 * u)}px dashed ${hex2(pal.accent, 0.8)}`, clipPath: 'inset(100% 0% 0% 0%)'}))));
    kids.push(el('div', `${id}-axis`, abs(c.pad, r2(c.axisY - 1.5 * u), c.axisW, r2(3 * u), {background: hex2(pal.fg, 0.35), transform: 'scale(0, 1)', transformOrigin: '0% 50%'})));
    c.ticks.forEach((t, k) => {
      if (t.label) kids.push(label(`${id}-day-${k}`, r2(t.x - c.labelW / 2), c.labelY, c.labelW, String(t.dom), {size: c.daySize, family: fonts.display, color: pal.muted, align: 'center', extra: {opacity: 0}}));
      if (t.lit >= 0) kids.push(label(`${id}-dayl-${k}`, r2(t.x - c.labelW / 2), c.labelY, c.labelW, String(t.dom), {size: c.daySize, family: fonts.display, color: pal.accent, align: 'center', extra: {opacity: 0}}));
      if (t.lit >= 0) kids.push(el('div', `${id}-node-${k}`, abs(r2(t.x - 7 * u), r2(c.axisY - 7 * u), r2(14 * u), r2(14 * u), {borderRadius: '50%', background: pal.accent, boxShadow: `0 0 ${r2(12 * u)}px ${pal.accent}`, opacity: 0})));
    });
    kids.push(label(`${id}-month`, 0, r2(c.axisY - c.monthSize * 0.65), W, c.month, {size: c.monthSize, family: fonts.meta, color: pal.muted, align: 'right', spacing: '0.08em', extra: {opacity: 0}}));
    kids.push(el('div', `${id}-head`, abs(r2(c.pad - 9 * u), r2(c.axisY - 9 * u), r2(18 * u), r2(18 * u), {borderRadius: '50%', background: pal.fg, boxShadow: `0 0 0 ${r2(5 * u)}px ${hex2(pal.accent, 0.35)}, 0 0 ${r2(18 * u)}px ${pal.accent}`, opacity: 0})));
    c.cards.forEach((card, i) => kids.push(cardNode(model, card, `${id}-c${i}`, card.x, card.y, {pal, code: c.code})));
    return kids;
  }
  const P = c.panel;
  const dotsW = c.dotGap * c.dots.length;
  kids.push(el('div', `${id}-panel`, abs(P.x, P.y, P.w, P.h, panelStyle(pal, u, 24)), [
    label(`${id}-title`, 0, r2(u * 30), P.w, c.title.text, {size: c.title.size, family: fonts.display, color: pal.fg, align: 'center', lineHeight: 1.1, extra: {opacity: 0}}),
    label(`${id}-sub`, 0, r2(u * 30 + c.title.size * 1.1 + u * 4), P.w, c.subtitle.text, {size: c.subtitle.size, family: fonts.body, color: pal.accent, align: 'center', weight: 600, extra: {opacity: 0}}),
    ...c.dots.map((d, k) => el('div', `${id}-dot-${k}`, abs(r2((P.w - dotsW) / 2 + k * c.dotGap + (c.dotGap - c.dot) / 2), r2(P.h - u * 30 - c.dot), c.dot, c.dot, {borderRadius: '50%', background: d.lit >= 0 ? pal.accent : hex2(pal.fg, 0.25), opacity: 0,
      ...(d.lit >= 0 ? {boxShadow: `0 0 ${r2(10 * u)}px ${pal.accent}`} : {})})))
  ]));
  c.links.forEach((link, i) => kids.push(el('svg', `${id}-link-${i}`, abs(link.box.x, link.box.y, link.box.w, link.box.h, {overflow: 'visible', clipPath: 'inset(0% 0% 100% 0%)'}),
    [el('path', null, null, [], {d: link.d, stroke: hex2(pal.accent, 0.75), strokeWidth: r2(2 * u), strokeDasharray: `${r2(6 * u)} ${r2(6 * u)}`, fill: 'none'})], {width: link.box.w, height: link.box.h, viewBox: `0 0 ${link.box.w} ${link.box.h}`, fill: 'none'})));
  c.cards.forEach((card, i) => {
    const th = r2(card.h * card.scale);
    const inner = cardNode(model, card, `${id}-c${i}`, 0, 0, {pal, code: c.code});
    kids.push(el('div', `${id}-t${i}`, abs(card.x, card.y, c.thumbW, th, {opacity: 0}), [el('div', null, abs(0, 0, card.w, card.h, {transform: `scale(${card.scale})`, transformOrigin: '0% 0%'}), [inner])]));
    kids.push(label(`${id}-cap-${i}`, card.x, r2(card.y + th + 16 * u), c.thumbW, card.date, {size: c.capSize, family: fonts.body, color: pal.accent, weight: 700, extra: {opacity: 0}}));
    if (card.label) kids.push(label(`${id}-lab-${i}`, card.x, r2(card.y + th + 16 * u + c.capSize * 1.2), c.thumbW, card.label, {size: c.labSize, family: fonts.body, color: pal.fg, extra: {opacity: 0, overflow: 'hidden', textOverflow: 'ellipsis'}}));
  });
  return kids;
}

function timelineTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  if (c.variant === 'axis') {
    set(ops, `${id}-axis`, start, {x: 0, y: 0, scaleX: 0, scaleY: 1});
    tw(ops, `${id}-axis`, c.buildAt, 0.7, 'power3.out', {scaleX: 0}, {scaleX: 1});
    c.ticks.forEach((t, k) => { if (t.label) riseOps(ops, `${id}-day-${k}`, start, rt(c.buildAt + 0.1 + k * 0.02), r2(10 * u), {duration: 0.3}); });
    riseOps(ops, `${id}-month`, start, rt(c.buildAt + 0.5), r2(8 * u));
    popOps(ops, `${id}-head`, start, rt(c.buildAt + 0.3), {from: 0.3, duration: 0.35});
    let x = 0;
    c.pins.forEach((pin, i) => {
      const nx = r2(pin.x - c.pad);
      tw(ops, `${id}-head`, rt(pin.at - 0.7), 0.7, 'power2.inOut', {x, y: 0, scaleX: 1, scaleY: 1}, {x: nx, y: 0, scaleX: 1, scaleY: 1});
      x = nx;
      const k = c.ticks.findIndex(t => t.lit === i);
      set(ops, `${id}-dayl-${k}`, start, {opacity: 0});
      tw(ops, `${id}-dayl-${k}`, pin.at, 0.25, 'power1.out', {opacity: 0}, {opacity: 1});
      popOps(ops, `${id}-node-${k}`, start, pin.at, {from: 0.2, duration: 0.35, ease: 'back.out(2.4)'});
      const closed = {clipT: 100, clipR: 0, clipB: 0, clipL: 0};
      set(ops, `${id}-pin-${i}`, start, closed);
      tw(ops, `${id}-pin-${i}`, rt(pin.at + 0.05), 0.35, 'power2.out', closed, {clipT: 0, clipR: 0, clipB: 0, clipL: 0});
      cardBuildOps(ops, model, c.cards[i], `${id}-c${i}`, pin.cardAt, {rowStep: 0.06});
      cardTokenOps(ops, model, c.cards[i], `${id}-c${i}`, pin.tokenAt);
    });
    return;
  }
  riseOps(ops, `${id}-panel`, start, c.buildAt, r2(30 * u), {duration: 0.55});
  riseOps(ops, `${id}-title`, start, rt(c.buildAt + 0.15), r2(16 * u));
  riseOps(ops, `${id}-sub`, start, rt(c.buildAt + 0.35), r2(12 * u));
  c.dots.forEach((_, k) => popOps(ops, `${id}-dot-${k}`, start, rt(c.buildAt + 0.5 + k * 0.03), {from: 0.2, duration: 0.3}));
  c.cards.forEach((card, i) => {
    const closed = {clipT: 0, clipR: 0, clipB: 100, clipL: 0};
    set(ops, `${id}-link-${i}`, start, closed);
    tw(ops, `${id}-link-${i}`, rt(card.at - 0.3), 0.4, 'power2.out', closed, {clipT: 0, clipR: 0, clipB: 0, clipL: 0});
    const from = {opacity: 0, x: 0, y: r2(24 * u), scaleX: 0.94, scaleY: 0.94, blur: r2(10 * u)};
    set(ops, `${id}-t${i}`, start, from);
    tw(ops, `${id}-t${i}`, card.at, 0.5, 'power3.out', from, {opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1, blur: 0});
    // Thumbnails show settled: their header, rows and token are already in.
    set(ops, `${id}-c${i}`, start, {opacity: 1});
    card.items.forEach((_, k) => set(ops, `${id}-c${i}-h-${k}`, start, {opacity: 1}));
    (card.code?.rows ?? []).forEach((_, k) => set(ops, `${id}-c${i}-row-${k}`, start, {opacity: 1}));
    if (card.code) card.code.tokens.forEach((_, k) => { set(ops, `${id}-c${i}-tkr-${k}`, start, {strokeDashoffset: 0}); set(ops, `${id}-c${i}-tkf-${k}`, start, {opacity: 1}); });
    else if (card.tokens.length) set(ops, `${id}-c${i}-ptk-0`, start, {clipT: 0, clipR: 0, clipB: 0, clipL: 0});
    riseOps(ops, `${id}-cap-${i}`, start, rt(card.at + 0.2), r2(12 * u));
    if (card.label) riseOps(ops, `${id}-lab-${i}`, start, rt(card.at + 0.3), r2(12 * u));
  });
}

export const datePinnedTimeline = {
  id: 'date-pinned-timeline',
  describe: 'Evidence on a date axis: a day axis (Oct 16 → 25) whose playhead scrubs to each date while 1–4 source cards (PR, commit, excerpt, announcement) pin to it with a dashed stem and stack; or (variant summary) the "why now? 3 clues in 9 days" layout: a glass title panel with one dot per day over the clue thumbnails, each with its date and label.',
  params: {from: '"YYYY-MM-DD", the first day', to: '"YYYY-MM-DD", the last (1–45 days on)', cards: `[{date, label? ≤ 32 (summary caption), at?, …${SOURCE}}] 1–4 in date order (events card-<i>)`,
    title: 'summary only: ≤ 40 (default "why now?")', subtitle: 'summary only: ≤ 60 (default "N clues in N days")', at: `build start: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['build', 'card-0', 'card-1', 'card-2', 'card-3'],
  timing: timingRules({rules: ['the axis (or title panel) builds in about 0.8 s from at', 'cards follow, 0.4–2.4 s apart (axis) or up to 1.2 s (summary), the last token finishing before the exit when the scene is long enough']}), variants: TIMELINE_VARIANTS,
  resolve: timelineResolve, view: timelineView, timeline: timelineTimeline
};

export const CODE_MODULES = [repoPrCard, commitCard, diffView, evidenceChain, datePinnedTimeline, ...TERMINAL_MODULES];

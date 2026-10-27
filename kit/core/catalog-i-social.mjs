// Catalogue I social cards: real posts from X, Threads, Bluesky, LinkedIn and
// Reddit drawn as high-fidelity cards. social-post is one card (enter, a
// highlight sweep across a phrase, focus); social-stack, social-sort and
// social-wall (further down) arrange several. Registered in
// kit/core/catalog-h.mjs, so both renderers draw them from the shared view
// tree and op list like every catalogue H element.
//
// Content comes from real posts. Each post carries a source block (the
// capture lane's launchclip.capture.v1 record: url, captured_at, the archived
// screenshot) and every render shows a small source line under the card.
// validateStory warns when a post has no source.url. The one exception is a
// post marked demo: true, a fictional account for tests and samples whose
// handle says so ("@demo_…"); its source line reads "Demo account · not a
// real post". Never write a post someone did not post.
//
// Social cards hide captions: the post's own words are on screen, and a
// portrait card with media needs the caption band's height.
//
// Layout: cards are flex columns inside the module rect, so both renderers
// wrap the text with the same browser layout; the model estimates each
// card's height with the conservative advance model (catalog-b-base.mjs) to
// place and fit cards.

import {timingRules} from './catalog-b-base.mjs';
import {hex2} from './catalog-b-view.mjs';
import {VARIANT_PARAM, createHBase, fitText, inkOn, mixColor, r2, rt, textWidth, toneColor} from './catalog-h-base.mjs';
import {el, set, tw} from './catalog-h-view.mjs';
import {iconNode} from './icons.mjs';

export const PLATFORMS = Object.freeze(['x', 'threads', 'bluesky', 'linkedin', 'reddit', 'generic']);
export const LOOKS = Object.freeze(['glass', 'native', 'light']);
export const CAPTURE_SCHEMA = 'launchclip.capture.v1';
const POST_KEYS = ['platform', 'name', 'handle', 'verified', 'avatar', 'text', 'title', 'headline', 'community', 'replyingTo', 'translatedFrom', 'media', 'quote', 'time', 'date', 'ago', 'metrics', 'source', 'demo'];
const METRIC_KEYS = ['replies', 'reposts', 'likes', 'bookmarks', 'views'];
const SOURCE_KEYS = ['url', 'captured_at', 'screenshot', 'schema', 'id', 'sha256', 'archive'];
const PLATFORM_LABEL = {x: 'X', threads: 'Threads', bluesky: 'Bluesky', linkedin: 'LinkedIn', reddit: 'Reddit', generic: 'Post'};
const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rectParam = '{x, y, width, height} canvas px inside the safe zone (optional)';

// Platform colours for the native (dark) and light looks; glass takes the brand.
const NATIVE = {
  x: {card: '#000000', ink: '#e7e9ea', muted: '#8b9198', border: '#2f3336', link: '#1d9bf0'},
  threads: {card: '#101010', ink: '#f3f5f7', muted: '#8a8a8a', border: '#323232', link: '#5aa8ff'},
  bluesky: {card: '#161e27', ink: '#f1f3f5', muted: '#93a1b3', border: '#2e4052', link: '#3d9bff'},
  linkedin: {card: '#1b1f23', ink: '#e9e9e9', muted: '#a8a8a8', border: '#38434f', link: '#71b7fb'},
  reddit: {card: '#0e1113', ink: '#d7dadc', muted: '#8c9196', border: '#2a3236', link: '#4fbcff'},
  generic: {card: '#15171c', ink: '#eceef2', muted: '#959aa4', border: '#2c3038', link: '#6aa8ff'}
};
const LIGHT = {
  x: {card: '#ffffff', ink: '#0f1419', muted: '#536471', border: '#cfd9de', link: '#1d9bf0'},
  threads: {card: '#ffffff', ink: '#000000', muted: '#737373', border: '#d9d9d9', link: '#0064d1'},
  bluesky: {card: '#ffffff', ink: '#0b0f14', muted: '#5f6f82', border: '#d4dbe2', link: '#0a7aff'},
  linkedin: {card: '#ffffff', ink: '#191919', muted: '#666666', border: '#d6d6d6', link: '#0a66c2'},
  reddit: {card: '#ffffff', ink: '#1c1c1c', muted: '#576f76', border: '#d3dbde', link: '#0045ac'},
  generic: {card: '#ffffff', ink: '#14161c', muted: '#5d6470', border: '#d8dbe0', link: '#2563eb'}
};
const BADGE = {x: '#1d9bf0', threads: '#0095f6', bluesky: '#1083fe', linkedin: '#8a8a8a', reddit: '#ff4500', generic: '#3b82f6'};
const BADGE_TONES = {blue: null, gold: '#e2b719', gray: '#829aab'};
const BADGE_D = 'M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z';
const BADGE_CHECK = 'M8.2 12.2l2.6 2.6 5-5.2';

// ---------------------------------------------------------------------------
// Validation

function plainText(check, value, path, max) {
  if (typeof value !== 'string' || !value.trim().length || value.length > max) check.fail(path, `must be a string of 1–${max} characters`);
  if (/[\u0000-\u0009\u000b-\u001f<>]/.test(value)) check.fail(path, 'must not contain control characters (other than line breaks) or angle brackets');
  return value.trim();
}

function metricValue(check, value, path) {
  if (typeof value === 'string') return check.str(value, path, 8);
  return check.int(value, path, 0, 1e12);
}

/** source block → {url, host, capturedAt, screenshot, schema} (null when absent). */
export function sourceOf(check, raw, path) {
  if (raw === undefined) return null;
  check.obj(raw, path, SOURCE_KEYS);
  const url = raw.url === undefined ? null : check.str(raw.url, `${path}.url`, 400);
  if (url && !/^https?:\/\/[^\s/]+\.[^\s/]+(\/\S*)?$/i.test(url)) check.fail(`${path}.url`, 'must be the http(s) address of the original post');
  const capturedAt = raw.captured_at === undefined ? null : check.str(raw.captured_at, `${path}.captured_at`, 40);
  if (capturedAt && !/^\d{4}-\d{2}-\d{2}/.test(capturedAt)) check.fail(`${path}.captured_at`, 'must be an ISO date or timestamp (2026-10-25T06:06:00Z)');
  const screenshot = raw.screenshot === undefined ? null : check.asset(raw.screenshot, `${path}.screenshot`);
  if (raw.schema !== undefined && raw.schema !== CAPTURE_SCHEMA) check.fail(`${path}.schema`, `must be "${CAPTURE_SCHEMA}" (the capture lane's record)`);
  for (const key of ['id', 'sha256', 'archive']) if (raw[key] !== undefined) check.str(raw[key], `${path}.${key}`, 200);
  const host = url ? url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0].replace(/^www\./i, '').toLowerCase() : null;
  return {url, host, capturedAt, screenshot, schema: raw.schema ?? null};
}

const DEMO = /demo|example/i;

/** One post → validated, normalised post. `extra` names keys the caller handles (column). */
export function postOf(check, raw, path, {extra = []} = {}) {
  check.obj(raw, path, [...POST_KEYS, ...extra], ['name', 'text']);
  const platform = raw.platform === undefined ? 'x' : check.oneOf(raw.platform, `${path}.platform`, PLATFORMS);
  const name = check.str(raw.name, `${path}.name`, 50);
  const handle = raw.handle === undefined ? null : check.str(raw.handle, `${path}.handle`, 40).replace(/^(@|u\/)/, '');
  if (handle !== null && !/^[\p{L}\p{N}_.-]{1,38}$/u.test(handle)) check.fail(`${path}.handle`, 'must be a handle (letters, digits, _ . -), with or without the @');
  if (!handle && platform !== 'linkedin') check.fail(`${path}.handle`, `is required for ${PLATFORM_LABEL[platform]} posts`);
  const demo = raw.demo === undefined ? false : check.bool(raw.demo, `${path}.demo`);
  const source = sourceOf(check, raw.source, `${path}.source`);
  if (demo) {
    if (!DEMO.test(handle ?? name)) check.fail(`${path}.handle`, 'of a demo post must say so ("@demo_…" or "…example…"): demo accounts are obviously fictional');
    if (source?.url) check.fail(`${path}.source.url`, 'cannot be set on a demo post; a demo post is fictional, so it has no original');
  }
  let verified = null;
  if (raw.verified !== undefined && raw.verified !== false) {
    const tone = raw.verified === true ? 'blue' : check.oneOf(raw.verified, `${path}.verified`, Object.keys(BADGE_TONES));
    verified = BADGE_TONES[tone] ?? BADGE[platform];
  }
  const text = plainText(check, raw.text, `${path}.text`, 600);
  const media = raw.media === undefined ? null : (() => {
    check.obj(raw.media, `${path}.media`, ['image', 'layout', 'aspect'], ['image']);
    return {image: check.asset(raw.media.image, `${path}.media.image`), layout: raw.media.layout === undefined ? 'below' : check.oneOf(raw.media.layout, `${path}.media.layout`, ['below', 'side']),
      aspect: raw.media.aspect === undefined ? 16 / 9 : check.num(raw.media.aspect, `${path}.media.aspect`, 0.5, 2.5)};
  })();
  const quote = raw.quote === undefined ? null : (() => {
    const q = check.obj(raw.quote, `${path}.quote`, ['name', 'handle', 'verified', 'avatar', 'text', 'date'], ['name', 'text']);
    return {name: check.str(q.name, `${path}.quote.name`, 50), handle: q.handle === undefined ? null : check.str(q.handle, `${path}.quote.handle`, 40).replace(/^(@|u\/)/, ''),
      verified: q.verified === undefined || q.verified === false ? null : (q.verified === true ? BADGE[platform] : BADGE_TONES[check.oneOf(q.verified, `${path}.quote.verified`, Object.keys(BADGE_TONES))] ?? BADGE[platform]),
      avatar: q.avatar === undefined ? null : check.asset(q.avatar, `${path}.quote.avatar`), text: plainText(check, q.text, `${path}.quote.text`, 280), date: q.date === undefined ? null : check.str(q.date, `${path}.quote.date`, 24)};
  })();
  const metrics = {};
  if (raw.metrics !== undefined) {
    check.obj(raw.metrics, `${path}.metrics`, METRIC_KEYS);
    for (const key of METRIC_KEYS) if (raw.metrics[key] !== undefined) metrics[key] = metricValue(check, raw.metrics[key], `${path}.metrics.${key}`);
  }
  const opt = (key, max) => (raw[key] === undefined ? null : check.str(raw[key], `${path}.${key}`, max));
  const post = {platform, name, handle, demo, source, verified, text, media, quote, metrics,
    avatar: raw.avatar === undefined ? null : check.asset(raw.avatar, `${path}.avatar`),
    title: opt('title', 140), headline: opt('headline', 60), community: opt('community', 40)?.replace(/^r\//, '') ?? null,
    replyingTo: opt('replyingTo', 40)?.replace(/^@/, '') ?? null, translatedFrom: opt('translatedFrom', 24),
    time: opt('time', 12), date: opt('date', 24), ago: opt('ago', 12)};
  if (post.community && platform !== 'reddit') check.fail(`${path}.community`, 'is for Reddit posts (the subreddit)');
  if (post.title && platform !== 'reddit') check.fail(`${path}.title`, 'is for Reddit posts (the post title)');
  if (post.headline && platform !== 'linkedin') check.fail(`${path}.headline`, 'is for LinkedIn posts (the author\'s headline)');
  if (platform === 'reddit' && !post.community) check.fail(`${path}.community`, 'is required for Reddit posts (the subreddit, "r/…")');
  return post;
}

/** The handle as the platform writes it. */
export function handleText(post) {
  if (!post.handle) return '';
  if (post.platform === 'reddit') return `u/${post.handle}`;
  if (post.platform === 'threads' || post.platform === 'linkedin') return post.handle;
  return `@${post.handle}`;
}

/** The small provenance line under a card: "X · @handle · Oct 25, 2026 · x.com". */
export function sourceLine(post) {
  if (post.demo) return `${handleText(post) || post.name} · Demo account · not a real post`;
  const when = post.date ?? (post.source?.capturedAt ? post.source.capturedAt.slice(0, 10) : null);
  return [PLATFORM_LABEL[post.platform], handleText(post) || post.name, when, post.source?.host].filter(Boolean).join(' · ');
}

/** 1234 → "1.2K" (the platforms' compact counts); strings pass through. */
export function countText(value) {
  if (typeof value === 'string') return value;
  if (value < 1000) return String(value);
  const [div, letter] = value >= 1e9 ? [1e9, 'B'] : value >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
  const v = value / div;
  return `${v >= 100 ? Math.floor(v) : Math.floor(v * 10) / 10}${letter}`;
}

// ---------------------------------------------------------------------------
// Body text: words, links and the highlighted phrase

const LINK = /^([@#][\p{L}\p{N}_]|https?:\/\/|www\.|[\w-]+(\.[\w-]+)*\.(com|org|net|io|ai|dev|co|app|gg|ly|me|news|tv|social)(\/\S*)?$)/iu;
const norm = word => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** text → tokens [{space} | {word, index, core, tail, link}]. */
function tokens(text) {
  let index = 0;
  return text.split(/(\s+)/).filter(part => part.length).map(part => {
    if (/^\s+$/.test(part)) return {space: part};
    const [, core, tail] = part.match(/^(.*?)([.,!?;:…)"'”’]*)$/u);
    return {word: part, index: index++, core, tail, link: LINK.test(core)};
  });
}

/** Word indices of `phrase` in the body (whole words, case and punctuation ignored). */
function phraseWords(check, words, phrase, path, taken) {
  const want = phrase.split(/\s+/).map(norm).filter(Boolean);
  if (!want.length) check.fail(path, 'must contain a word');
  for (let i = 0; i + want.length <= words.length; i++) {
    const span = want.map((_, j) => i + j);
    if (span.every(k => !taken.has(k) && norm(words[k].word) === want[span.indexOf(k)])) return span;
  }
  return check.fail(path, `must be a phrase of the post's text, whole words (${JSON.stringify(phrase)} is not)`);
}

// ---------------------------------------------------------------------------
// Card metrics: sizes from the body size, and the estimated height

function lineCount(text, size, width) {
  let total = 0;
  const space = textWidth(' ', size, 'body');
  for (const para of text.split('\n')) {
    let lines = 1, used = 0;
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const w = textWidth(word, size, 'body');
      const wraps = Math.max(1, Math.ceil(w / width));
      if (wraps > 1) { lines += wraps - (used ? 0 : 1); used = w % width; continue; }
      if (used && used + space + w > width) { lines++; used = w; } else used += (used ? space : 0) + w;
    }
    total += lines;
  }
  return total;
}

/** Sizes and estimated height of `post` as a card `width` px wide with body text `bs` px. */
export function cardMetrics(b, post, width, bs, {compact = false} = {}) {
  const meta = r2(Math.max(b.min.meta, bs * 0.68));
  const s = {compact, bs, meta, name: bs, pad: r2(bs * 0.8), gap: r2(bs * 0.5), avatar: r2(bs * 1.8), icon: r2(meta * 1.12), radius: r2(bs * 0.6), line: 1.3, width};
  s.inner = r2(width - 2 * s.pad);
  const lh = v => v * s.line;
  const linkedin = post.platform === 'linkedin', reddit = post.platform === 'reddit';
  const headerText = linkedin ? lh(s.name) + lh(meta) * (post.headline ? 2 : 1) : post.platform === 'threads' ? lh(s.name) : lh(s.name) + lh(meta);
  s.headerH = r2(Math.max(reddit ? s.avatar * 0.8 : s.avatar, headerText));
  if (reddit) s.headerH = r2(Math.max(s.avatar * 0.8, lh(meta) * 2));
  s.title = post.title ? {size: r2(bs * 1.12), lines: lineCount(post.title, bs * 1.12, s.inner)} : null;
  const side = post.media?.layout === 'side';
  s.thumbW = side ? r2(s.inner * 0.34) : 0;
  s.textW = r2(s.inner - (side ? s.thumbW + s.gap : 0));
  s.bodyLines = lineCount(post.text, bs, s.textW);
  s.bodyH = r2(s.bodyLines * lh(bs));
  if (post.media) s.mediaH = side ? r2(s.thumbW / Math.max(1, post.media.aspect) * 1.0) : r2(s.inner / post.media.aspect);
  if (post.quote) {
    s.quoteSize = r2(Math.max(b.min.key, bs * 0.86));
    s.quotePad = r2(bs * 0.5);
    s.quoteLines = lineCount(post.quote.text, s.quoteSize, s.inner - 2 * s.quotePad);
    s.quoteH = r2(2 * s.quotePad + lh(meta) * 1.15 + s.gap * 0.4 + s.quoteLines * lh(s.quoteSize) + 2);
  }
  const row = Math.max(s.icon, lh(meta));
  s.rowH = r2(row);
  const footer = {
    x: s.gap + lh(meta) + s.gap * 1.6 + 1 + row,
    generic: s.gap + lh(meta) + s.gap * 0.8 + row,
    threads: s.gap * 0.9 + row,
    bluesky: s.gap * 0.9 + row,
    linkedin: s.gap + lh(meta) + s.gap * 1.2 + 1 + row,
    reddit: s.gap + row + meta * 0.7
  }[post.platform];
  // Compact (context) cards keep the engagement row but drop the time line and divider.
  const footerH = compact && ['x', 'generic', 'linkedin'].includes(post.platform) ? s.gap * 0.9 + row : footer;
  let h = 2 * s.pad + s.headerH + s.gap;
  if (post.replyingTo) h += lh(meta) + s.gap * 0.4;
  if (s.title) h += s.title.lines * lh(s.title.size) + s.gap * 0.4;
  h += side ? Math.max(s.bodyH, s.mediaH) : s.bodyH;
  if (post.media && !side) h += s.gap + s.mediaH;
  if (post.quote) h += s.gap + s.quoteH;
  if (post.translatedFrom) h += s.gap * 0.5 + lh(meta);
  s.height = r2(h + footerH + 2);
  return s;
}

/**
 * The largest body size in [min.key, preferred] whose card fits `maxH`,
 * → card metrics; fails naming the post when none does.
 */
export function fitCard(b, post, width, maxH, preferred, path) {
  for (let bs = Math.floor(preferred); bs >= Math.ceil(b.min.key); bs -= 2) {
    const s = cardMetrics(b, post, width, bs);
    if (s.height <= maxH) return s;
  }
  return b.check.fail(path, `does not fit: the card needs more than ${Math.round(maxH)} px at ${Math.ceil(b.min.key)} px text; quote a shorter excerpt (mark cuts with …), drop media or give fewer posts`);
}

// ---------------------------------------------------------------------------
// Card view

/** Colours of a card in `look` for `platform`. */
export function palette(b, look, platform) {
  if (look === 'glass') {
    const {paper, bg, accent} = b.colors;
    const link = toneColor(b, 'accent', 'look (glass links use brand accent)');
    return {glass: true, card: `linear-gradient(160deg, ${hex2(mixColor(paper, bg, 0.17), 0.84)} 0%, ${hex2(mixColor(paper, bg, 0.07), 0.9)} 100%)`, ink: paper, muted: b.theme.muted,
      border: hex2(paper, 0.13), rim: accent, link, hl: hex2(accent, 0.42), plate: hex2(mixColor(paper, bg, 0.12), 0.7), shadow: '#000000'};
  }
  const t = (look === 'light' ? LIGHT : NATIVE)[platform];
  return {glass: false, ...t, rim: t.link, hl: hex2(t.link, look === 'light' ? 0.24 : 0.42), plate: mixColor(t.ink, t.card, 0.06), shadow: '#000000'};
}

const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => [...w][0].toUpperCase()).join('');

function avatarNode(b, src, name, size, {square = false} = {}) {
  const radius = square ? r2(size * 0.18) : '50%';
  if (src) return el('img', null, {width: size, height: size, borderRadius: radius, objectFit: 'cover', display: 'block', flexShrink: 0}, [], {src, alt: ''});
  const {primary, accent} = b.colors;
  return el('div', null, {width: size, height: size, borderRadius: radius, flexShrink: 0, background: `linear-gradient(135deg, ${primary}, ${accent})`, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: inkOn(b.colors, primary), fontFamily: b.fonts.body, fontWeight: 700, fontSize: r2(size * 0.4), lineHeight: '1'}, [initials(name)]);
}

function badgeNode(color, size) {
  return el('svg', null, {width: size, height: size, flexShrink: 0, display: 'block'}, [
    el('path', null, null, [], {d: BADGE_D, fill: color, stroke: color, strokeWidth: 1.2, strokeLinejoin: 'round'}),
    el('path', null, null, [], {d: BADGE_CHECK, stroke: '#ffffff', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none'})
  ], {width: size, height: size, viewBox: '0 0 24 24', fill: 'none'});
}

const icon = (name, size, color, extra = {}) => iconNode(name, {size, color, stroke: 1.8, style: {position: 'relative', left: 0, top: 0, flexShrink: 0, display: 'block', ...extra}});
const textSpan = (value, style) => el('span', null, {whiteSpace: 'nowrap', ...style}, [value]);
const row = (style, children) => el('div', null, {display: 'flex', alignItems: 'center', ...style}, children);
const nameStyle = (b, s, P) => ({fontFamily: b.fonts.body, fontSize: s.name, fontWeight: 700, color: P.ink, lineHeight: String(s.line), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0});
const metaStyle = (b, s, P, extra = {}) => ({fontFamily: b.fonts.body, fontSize: s.meta, color: P.muted, lineHeight: String(s.line), whiteSpace: 'nowrap', ...extra});

function headerNode(b, post, s, P, id) {
  const badge = post.verified ? [badgeNode(post.verified, r2(s.name * 0.92))] : [];
  const dots = icon('ellipsis', s.icon, P.muted);
  const nameRow = extra => row({gap: r2(s.meta * 0.3), minWidth: 0}, [el('div', null, nameStyle(b, s, P), [post.name]), ...badge, ...extra]);
  const h = handleText(post);
  let text;
  if (post.platform === 'threads') text = [row({gap: r2(s.meta * 0.3), minWidth: 0}, [el('div', null, nameStyle(b, s, P), [h]), ...badge, ...(post.ago ? [textSpan(post.ago, metaStyle(b, s, P, {marginLeft: r2(s.meta * 0.3)}))] : [])])];
  else if (post.platform === 'linkedin') text = [nameRow([]), ...(post.headline ? [el('div', null, metaStyle(b, s, P, {overflow: 'hidden', textOverflow: 'ellipsis'}), [post.headline])] : []),
    row({gap: r2(s.meta * 0.3)}, [textSpan(post.ago ?? post.date ?? '', metaStyle(b, s, P)), textSpan('·', metaStyle(b, s, P)), icon('globe', r2(s.meta * 0.85), P.muted)])];
  else if (post.platform === 'reddit') text = [row({gap: r2(s.meta * 0.3)}, [textSpan(`r/${post.community}`, {...metaStyle(b, s, P), color: P.ink, fontWeight: 700}), ...(post.ago ? [textSpan(`· ${post.ago}`, metaStyle(b, s, P))] : [])]),
    el('div', null, metaStyle(b, s, P), [h])];
  else if (post.platform === 'bluesky') text = [nameRow([]), el('div', null, metaStyle(b, s, P, {overflow: 'hidden', textOverflow: 'ellipsis'}), [post.ago ? `${h} · ${post.ago}` : h])];
  else text = [nameRow([]), el('div', null, metaStyle(b, s, P, {overflow: 'hidden', textOverflow: 'ellipsis'}), [h])];
  const avatar = avatarNode(b, post.avatar, post.name, post.platform === 'reddit' ? r2(s.avatar * 0.8) : s.avatar);
  return el('div', `${id}-head`, {display: 'flex', alignItems: 'center', gap: r2(s.bs * 0.42), height: s.headerH, flexShrink: 0}, [
    avatar, el('div', null, {display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0, flex: '1'}, text), dots]);
}

/** Body text nodes: links coloured, highlighted words wrapped with their sweep bars. */
function bodyChildren(post, s, P, id, highlighted) {
  const out = [];
  let buffer = '', carried = false;
  const flush = () => { if (buffer) out.push(buffer); buffer = ''; };
  const list = tokens(post.text);
  const linked = t => (t.link ? [el('span', null, {color: P.link}, [t.core]), ...(t.tail ? [t.tail] : [])] : [t.word]);
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.space !== undefined) { buffer += t.space; continue; }
    const hl = highlighted.get(t.index);
    if (!hl) {
      carried = false;
      if (t.link) { flush(); out.push(...linked(t)); } else buffer += t.word;
      continue;
    }
    flush();
    // The space after a word joins its bar when the next word is highlighted too.
    const next = list[i + 1], after = list[i + 2];
    const joined = next?.space !== undefined && !next.space.includes('\n') && after && highlighted.get(after.index)?.phrase === hl.phrase;
    out.push(el('span', null, {position: 'relative', display: 'inline-block', whiteSpace: 'pre'}, [
      el('span', `${id}-hl-${t.index}`, {position: 'absolute', left: carried ? '0em' : '-0.06em', right: joined ? '0em' : '-0.06em', top: '0.04em', bottom: '0.02em', background: P.hl, borderRadius: r2(s.bs * 0.1), transformOrigin: '0% 50%'}),
      el('span', null, {position: 'relative'}, [...linked(t), ...(joined ? [' '] : [])])
    ]));
    if (joined) i++;
    carried = joined;
  }
  flush();
  return out;
}

function engagementItems(b, post, s, P) {
  const m = post.metrics;
  const item = (name, value, extra = {}) => row({gap: r2(s.meta * 0.32)}, [icon(name, s.icon, extra.color ?? P.muted), ...(value === undefined ? [] : [textSpan(countText(value), metaStyle(b, s, P, extra.text))])]);
  return {
    x: [item('message-circle', m.replies), item('repeat-2', m.reposts), item('heart', m.likes), item('bookmark', m.bookmarks), item('upload')],
    generic: [item('heart', m.likes), item('message-circle', m.replies), item('repeat-2', m.reposts), item('share-2')],
    threads: [item('heart', m.likes), item('message-circle', m.replies), item('repeat', m.reposts), item('send')],
    bluesky: [item('message-square', m.replies), item('repeat-2', m.reposts), item('heart', m.likes), item('ellipsis')]
  }[post.platform];
}

function footerNodes(b, post, s, P, id) {
  const m = post.metrics;
  const out = [];
  const line = (style = {}) => el('div', null, {height: 1, background: P.border, flexShrink: 0, ...style});
  if (s.compact && (post.platform === 'x' || post.platform === 'generic' || post.platform === 'linkedin')) {
    out.push(row({justifyContent: 'space-between', height: s.rowH, marginTop: r2(s.gap * 0.9), flexShrink: 0}, post.platform === 'linkedin' ? engagementItems(b, {...post, platform: 'generic'}, s, P) : engagementItems(b, post, s, P)));
    return el('div', `${id}-foot`, {display: 'flex', flexDirection: 'column', flexShrink: 0}, out);
  }
  if (post.platform === 'x' || post.platform === 'generic') {
    const parts = [post.time, post.date].filter(Boolean).map(v => textSpan(v, metaStyle(b, s, P)));
    if (post.platform === 'x' && m.views !== undefined) parts.push(row({gap: r2(s.meta * 0.28)}, [textSpan(countText(m.views), metaStyle(b, s, P, {color: P.ink, fontWeight: 700})), textSpan('Views', metaStyle(b, s, P))]));
    const joined = parts.flatMap((part, i) => (i ? [textSpan('·', metaStyle(b, s, P)), part] : [part]));
    out.push(row({gap: r2(s.meta * 0.35), height: r2(s.meta * s.line), marginTop: s.gap, flexShrink: 0}, joined));
    if (post.platform === 'x') out.push(line({marginTop: r2(s.gap * 0.8)}));
  }
  if (post.platform === 'linkedin') {
    const reactions = m.likes === undefined ? [] : [row({gap: r2(s.meta * 0.3)}, [el('div', null, {width: s.icon, height: s.icon, borderRadius: '50%', background: P.link, display: 'flex', alignItems: 'center', justifyContent: 'center'}, [icon('thumbs-up', r2(s.icon * 0.62), '#ffffff')]), textSpan(countText(m.likes), metaStyle(b, s, P))])];
    const counts = [m.replies === undefined ? null : `${countText(m.replies)} comments`, m.reposts === undefined ? null : `${countText(m.reposts)} reposts`].filter(Boolean).join(' · ');
    out.push(row({justifyContent: 'space-between', height: r2(s.meta * s.line), marginTop: s.gap, flexShrink: 0}, [row({}, reactions), textSpan(counts, metaStyle(b, s, P))]));
    out.push(line({marginTop: r2(s.gap * 0.6)}));
    const action = (name, text) => row({gap: r2(s.meta * 0.35)}, [icon(name, s.icon, P.muted), textSpan(text, metaStyle(b, s, P, {fontWeight: 650}))]);
    out.push(row({justifyContent: 'space-between', height: s.rowH, marginTop: r2(s.gap * 0.6), flexShrink: 0}, [action('thumbs-up', 'Like'), action('message-square', 'Comment'), action('repeat-2', 'Repost'), action('send', 'Send')]));
    return el('div', `${id}-foot`, {display: 'flex', flexDirection: 'column', flexShrink: 0}, out);
  }
  if (post.platform === 'reddit') {
    const pill = children => row({gap: r2(s.meta * 0.35), padding: `${r2(s.meta * 0.35)}px ${r2(s.meta * 0.6)}px`, borderRadius: 999, background: P.plate}, children);
    out.push(row({gap: r2(s.meta * 0.5), marginTop: s.gap, flexShrink: 0}, [
      pill([icon('arrow-big-up', s.icon, P.muted), textSpan(m.likes === undefined ? 'Vote' : countText(m.likes), metaStyle(b, s, P, {color: P.ink, fontWeight: 700})), icon('arrow-big-down', s.icon, P.muted)]),
      pill([icon('message-circle', s.icon, P.muted), textSpan(m.replies === undefined ? 'Comments' : countText(m.replies), metaStyle(b, s, P, {color: P.ink, fontWeight: 650}))]),
      pill([icon('share', s.icon, P.muted), textSpan('Share', metaStyle(b, s, P, {color: P.ink, fontWeight: 650}))])
    ]));
    return el('div', `${id}-foot`, {display: 'flex', flexDirection: 'column', flexShrink: 0}, out);
  }
  const spread = post.platform === 'threads' ? {gap: r2(s.bs * 0.9)} : {justifyContent: 'space-between'};
  const top = post.platform === 'x' ? r2(s.gap * 0.8) : post.platform === 'generic' ? r2(s.gap * 0.8) : r2(s.gap * 0.9);
  out.push(row({...spread, height: s.rowH, marginTop: top, flexShrink: 0}, engagementItems(b, post, s, P)));
  return el('div', `${id}-foot`, {display: 'flex', flexDirection: 'column', flexShrink: 0}, out);
}

function quoteNode(b, post, s, P, id) {
  const q = post.quote;
  const qh = q.handle ? (post.platform === 'reddit' ? `u/${q.handle}` : `@${q.handle}`) : null;
  const metaBits = [qh, q.date].filter(Boolean).join(' · ');
  return el('div', `${id}-quote`, {marginTop: s.gap, border: `1px solid ${P.border}`, borderRadius: r2(s.radius * 0.75), padding: s.quotePad, display: 'flex', flexDirection: 'column', gap: r2(s.gap * 0.4), flexShrink: 0, background: P.glass ? hex2(b.colors.bg, 0.25) : 'transparent'}, [
    row({gap: r2(s.meta * 0.35), height: r2(s.meta * s.line * 1.15), minWidth: 0}, [avatarNode(b, q.avatar, q.name, r2(s.meta * 1.15)), el('div', null, {...metaStyle(b, s, P), color: P.ink, fontWeight: 700}, [q.name]),
      ...(q.verified ? [badgeNode(q.verified, r2(s.meta * 0.95))] : []), ...(metaBits ? [el('div', null, metaStyle(b, s, P, {overflow: 'hidden', textOverflow: 'ellipsis'}), [metaBits])] : [])]),
    el('div', null, {fontFamily: b.fonts.body, fontSize: s.quoteSize, lineHeight: String(s.line), color: P.ink, whiteSpace: 'pre-line', overflowWrap: 'break-word'}, [q.text])
  ]);
}

/**
 * One post's card node `width` wide: flex rows (header, replying-to, title,
 * body, media, quote, translated tag, footer). `id` prefixes the animated
 * parts: -head, -body, -media, -quote, -foot, -glow and -hl-<word>.
 */
export function cardNode(b, post, s, P, id, {highlighted = new Map(), style = {}} = {}) {
  const children = [el('div', `${id}-glow`, {position: 'absolute', left: -1, top: -1, right: -1, bottom: -1, borderRadius: s.radius, border: `${r2(Math.max(1.5, s.bs * 0.04))}px solid ${hex2(P.rim, 0.85)}`,
    boxShadow: `0 0 ${r2(s.bs * 0.9)}px ${hex2(P.rim, 0.45)}, 0 0 ${r2(s.bs * 2.4)}px ${hex2(P.rim, 0.22)}`, opacity: 0})];
  children.push(headerNode(b, post, s, P, id));
  const lines = [];
  if (post.replyingTo) lines.push(el('div', null, metaStyle(b, s, P, {marginTop: s.gap, height: r2(s.meta * s.line)}), ['Replying to ', el('span', null, {color: P.link}, [`@${post.replyingTo}`])]));
  if (s.title) lines.push(el('div', null, {marginTop: lines.length ? r2(s.gap * 0.4) : s.gap, fontFamily: b.fonts.body, fontSize: s.title.size, lineHeight: String(s.line), fontWeight: 700, color: P.ink}, [post.title]));
  const top = lines.length ? r2(s.gap * 0.4) : s.gap;
  const body = el('div', null, {fontFamily: b.fonts.body, fontSize: s.bs, lineHeight: String(s.line), color: P.ink, whiteSpace: 'pre-line', overflowWrap: 'break-word', width: s.textW, flexShrink: 0}, bodyChildren(post, s, P, id, highlighted));
  const media = post.media ? el('div', `${id}-media`, {width: post.media.layout === 'side' ? s.thumbW : s.inner, height: s.mediaH, borderRadius: r2(s.radius * 0.7), overflow: 'hidden', border: `1px solid ${P.border}`, flexShrink: 0, background: P.plate,
    ...(post.media.layout === 'side' ? {} : {marginTop: s.gap})}, [el('img', null, {width: '100%', height: '100%', objectFit: 'cover', display: 'block'}, [], {src: post.media.image, alt: ''})]) : null;
  const main = [];
  if (media && post.media.layout === 'side') main.push(el('div', `${id}-body`, {display: 'flex', gap: s.gap, alignItems: 'flex-start', marginTop: top}, [body, media]));
  else {
    main.push(el('div', `${id}-body`, {marginTop: top}, [body]));
    if (media) main.push(media);
  }
  if (post.quote) main.push(quoteNode(b, post, s, P, id));
  if (post.translatedFrom) main.push(el('div', null, metaStyle(b, s, P, {marginTop: r2(s.gap * 0.5), color: P.link, fontWeight: 650}), [`Translated from ${post.translatedFrom}`]));
  const cardStyle = {boxSizing: 'border-box', width: s.width, padding: s.pad, borderRadius: s.radius, display: 'flex', flexDirection: 'column', background: P.card, border: `1px solid ${P.glass ? hex2(P.rim, 0.32) : P.border}`,
    boxShadow: P.glass ? `0 0 0 1px ${hex2(P.rim, 0.12)}, 0 0 ${r2(s.bs * 0.7)}px ${hex2(P.rim, 0.16)}, inset 0 1px 0 ${hex2(b.colors.paper, 0.16)}, 0 ${r2(s.bs * 0.6)}px ${r2(s.bs * 1.8)}px ${hex2(P.shadow, 0.45)}` : `0 ${r2(s.bs * 0.5)}px ${r2(s.bs * 1.6)}px ${hex2(P.shadow, 0.5)}`,
    ...(P.glass ? {backdropFilter: `blur(${r2(s.bs * 0.5)}px)`} : {}), position: 'relative', color: P.ink, ...style};
  return el('div', id, cardStyle, [...children, ...lines, ...main, footerNodes(b, post, s, P, id)]);
}

// ---------------------------------------------------------------------------
// Shared timing

/** The highlight phrases of `post` → {byWord: Map(word → {phrase}), phrases: [{words, chars}]}. */
export function highlightsOf(b, post, raw, path) {
  const {check} = b;
  const byWord = new Map(), phrases = [];
  if (raw === undefined) return {byWord, phrases};
  const list = Array.isArray(raw) ? raw : [raw];
  check.arr(list, path, 1, 3);
  const words = tokens(post.text).filter(t => t.space === undefined);
  const taken = new Set();
  list.forEach((entry, i) => {
    const p = list.length > 1 || Array.isArray(raw) ? `${path}[${i}]` : path;
    const item = typeof entry === 'string' ? {text: entry} : check.obj(entry, p, ['text', 'at'], ['text']);
    const text = check.str(item.text, typeof entry === 'string' ? p : `${p}.text`, 200);
    const span = phraseWords(check, words, text, typeof entry === 'string' ? p : `${p}.text`, taken);
    span.forEach(k => { taken.add(k); byWord.set(k, {phrase: i}); });
    phrases.push({words: span, chars: span.map(k => words[k].word.length + 1), at: item.at, path: typeof entry === 'string' ? `${path}.at` : `${p}.at`, event: i === 0 ? 'highlight' : `highlight-${i + 1}`});
  });
  return {byWord, phrases};
}

/** Times each phrase's sweep: events highlight, highlight-2, highlight-3, from `first` 1.4 s apart. */
export function timeHighlights(b, hl, first) {
  hl.phrases.forEach((ph, i) => {
    const rel = Math.max(first, Math.min(first + i * 1.4, b.lastEvent));
    ph.time = b.timeOf(ph.event, ph.at, ph.path, rel, {min: 0});
    const total = ph.chars.reduce((a, c) => a + c, 0);
    ph.sweep = r2(Math.min(1.4, Math.max(0.45, total * 0.035)));
    let used = 0;
    ph.bars = ph.words.map((k, j) => { const start = rt(ph.time + ph.sweep * used / total); used += ph.chars[j]; return {k, start, duration: rt(ph.sweep * ph.chars[j] / total)}; });
    b.events.push({id: `${b.id}-${ph.event}`, name: ph.event, time: ph.time, endTime: rt(ph.time + ph.sweep), role: 'emphasis', cue: 'whoosh-soft'});
    delete ph.at; delete ph.path;
  });
  return hl.phrases;
}

/** Sweep ops: each bar grows left to right in reading order, at a steady speed. */
export function highlightOps(ops, prefix, start, phrases) {
  for (const ph of phrases) for (const bar of ph.bars) {
    set(ops, `${prefix}-hl-${bar.k}`, start, {x: 0, y: 0, scaleX: 0, scaleY: 1});
    tw(ops, `${prefix}-hl-${bar.k}`, bar.start, Math.max(0.05, bar.duration), 'none', {scaleX: 0}, {scaleX: 1});
  }
}

/** Card build: the card rises out of a blur, then its rows follow. */
export function cardBuildOps(ops, prefix, start, at, u, {parts = ['head', 'body', 'media', 'quote', 'foot'], has = () => true, from = {}, to = {}} = {}) {
  const f = {opacity: 0, x: 0, y: r2(46 * u), scaleX: 0.95, scaleY: 0.95, blur: r2(12 * u), ...from};
  set(ops, prefix, start, f);
  tw(ops, prefix, at, 0.65, 'power3.out', f, {opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1, blur: 0, ...to});
  let k = 0;
  for (const part of parts) {
    if (!has(part)) continue;
    const target = `${prefix}-${part}`, when = rt(at + 0.12 + k++ * 0.07);
    set(ops, target, start, {opacity: 0, x: 0, y: r2(14 * u)});
    tw(ops, target, when, 0.45, 'power3.out', {opacity: 0, y: r2(14 * u)}, {opacity: 1, y: 0});
  }
}

const partsOf = post => part => (part === 'media' ? Boolean(post.media) && post.media.layout !== 'side' : part === 'quote' ? Boolean(post.quote) : true);

function sourceNode(b, text, size, color, id, style = {}) {
  return el('div', id, {fontFamily: b.fonts.meta, fontSize: size, lineHeight: '1.3', color, letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...style}, [text]);
}

// ---------------------------------------------------------------------------
// social-post

const POST_VARIANTS = LOOKS;
const POST_PARAMS = ['highlight', 'focus', 'focusAt', 'at'];

function postResolve(params, ctx) {
  const raw = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
  const b = createHBase('social-post', params, ctx, {allowed: [...POST_KEYS, ...POST_PARAMS], required: ['name', 'text'], variants: POST_VARIANTS, hidesCaptions: true});
  const {check, u, rect} = b;
  const postRaw = Object.fromEntries(Object.entries(b.params).filter(([key]) => POST_KEYS.includes(key)));
  const post = postOf(check, postRaw, 'params');
  const P = palette(b, b.variant, post.platform);
  const hl = highlightsOf(b, post, raw.highlight, 'params.highlight');
  const focus = b.params.focus === undefined ? b.params.focusAt !== undefined : check.bool(b.params.focus, 'params.focus');

  const W = rect.width;
  const width = r2(b.portrait ? W : Math.min(W, u(1240)));
  const sourceSize = r2(Math.max(b.min.meta, u(26)));
  const sourceH = r2(sourceSize * 1.3 + u(22));
  const s = fitCard(b, post, width, rect.height - sourceH - u(40), u(b.portrait ? 54 : 50), 'params.text');

  const buildAt = b.timeOf('build', b.params.at, 'params.at', 0.2, {min: 0});
  const buildEnd = rt(buildAt + 0.9);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: buildEnd, role: 'emphasis', cue: 'whoosh-soft'});
  const settled = buildEnd - b.start;
  const phrases = timeHighlights(b, hl, settled + 0.35);
  let focusAt = null;
  if (focus) {
    const after = phrases.length ? Math.max(...phrases.map(ph => ph.time + ph.sweep)) - b.start + 0.4 : settled + 0.5;
    focusAt = b.timeOf('focus', b.params.focusAt, 'params.focusAt', Math.min(after, b.lastEvent), {min: 0});
    b.events.push({id: `${b.id}-focus`, name: 'focus', time: focusAt, endTime: rt(focusAt + 0.6), role: 'emphasis', cue: 'pop-soft'});
  }
  const content = {variant: b.variant, post, s, P, highlighted: [...hl.byWord.entries()], phrases, focusAt, buildAt, buildEnd, source: {text: sourceLine(post), size: sourceSize, gap: r2(u(22))},
    width, cardH: s.height, platform: post.platform};
  return b.finish(content, {minTextPx: s.bs});
}

/** b-like view context from a model (fonts, colours, unit) for the card builders. */
function viewBase(model) {
  const t = model.theme;
  return {fonts: model.fonts, colors: {bg: t.bg, primary: t.primary, accent: t.accent, ink: t.ink, paper: t.paper}, unit: model.unit};
}

function postView(model) {
  const {id, rect} = model;
  const c = model.content;
  const vb = viewBase(model);
  const card = cardNode(vb, c.post, c.s, c.P, `${id}-card`, {highlighted: new Map(c.highlighted)});
  return [el('div', null, {position: 'absolute', left: 0, top: 0, width: rect.width, height: rect.height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'}, [
    card, sourceNode(vb, c.source.text, c.source.size, model.theme.muted, `${id}-src`, {width: c.width, marginTop: c.source.gap})
  ])];
}

function postTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  const card = `${id}-card`;
  cardBuildOps(ops, card, start, c.buildAt, u, {has: partsOf(c.post)});
  set(ops, `${id}-src`, start, {opacity: 0});
  tw(ops, `${id}-src`, rt(c.buildAt + 0.5), 0.4, 'power1.out', {opacity: 0}, {opacity: 1});
  highlightOps(ops, card, start, c.phrases);
  set(ops, `${card}-glow`, start, {opacity: 0});
  if (c.focusAt !== null) {
    tw(ops, card, c.focusAt, 0.6, 'power2.out', {scaleX: 1, scaleY: 1}, {scaleX: 1.035, scaleY: 1.035});
    tw(ops, `${card}-glow`, c.focusAt, 0.5, 'power2.out', {opacity: 0}, {opacity: 1});
  }
}

const POST_PARAM_DOCS = {
  platform: `${PLATFORMS.join(' | ')} (default x)`, name: 'display name ≤ 50, as on the post', handle: 'handle ≤ 40, with or without @ (u/ on Reddit); optional on LinkedIn',
  verified: 'true | "blue" | "gold" | "gray": the tick (optional)', avatar: 'assets/… the author\'s avatar from the capture (optional; else initials)', text: 'the post\'s words ≤ 600, verbatim (an excerpt marks cuts with …); @mentions, #tags and links are coloured',
  media: '{image: assets/…, layout?: "below" | "side", aspect? w/h} the attached image (optional)', quote: '{name, handle?, verified?, avatar?, text ≤ 280, date?} a quoted post (optional)',
  replyingTo: 'handle: a "Replying to @…" line (optional)', translatedFrom: 'language: a "Translated from …" tag (optional)', time: '"6:06 AM" (optional)', date: '"Oct 25, 2026" (optional)', ago: '"2h": the relative time on Threads, Bluesky, LinkedIn and Reddit (optional)',
  metrics: '{replies?, reposts?, likes?, bookmarks?, views?}: numbers (shown as 1.2K) or strings as on the post', title: 'Reddit post title ≤ 140', community: 'Reddit subreddit (required on Reddit)', headline: 'LinkedIn author headline ≤ 60',
  source: `{url, captured_at?, screenshot? (assets/…), schema? "${CAPTURE_SCHEMA}"}: where the post lives (validation warns without url; a small source line always shows)`,
  demo: 'true marks a fictional demo account for tests and samples (handle must say "demo" or "example"; no source.url)'
};

export const socialPost = {
  id: 'social-post',
  describe: 'A real social post (X, Threads, Bluesky, LinkedIn, Reddit or generic) as a high-fidelity card: avatar, name and tick, handle, body with coloured mentions and links, optional media, quoted post, "Replying to" and "Translated from" lines, time · date · views and the engagement row, with a small source line under it. It rises in, can sweep a highlight across a phrase on a word cue, then step forward into focus.',
  params: {...POST_PARAM_DOCS, highlight: 'a phrase of text (whole words), or [{text, at?}] 1–3: a highlight sweeps across it (events highlight, highlight-2, highlight-3; time it to a word with a scene hit)',
    focus: 'true: the card steps forward with a rim glow after the highlight (event focus)', focusAt: `the focus: ${at}`, at: `card build: ${at}`, variant: VARIANT_PARAM, rect: rectParam},
  events: ['build', 'highlight', 'highlight-2', 'highlight-3', 'focus'],
  timing: timingRules({rules: ['the card builds in about 0.9 s from at (default 0.2 s)', 'the highlight sweeps 0.45–1.4 s across the phrase (default 0.35 s after the build)', 'focus follows the highlight by 0.4 s']}),
  variants: POST_VARIANTS,
  resolve: postResolve, view: postView, timeline: postTimeline
};

// ---------------------------------------------------------------------------
// Several posts: shared helpers

const LOOK_PARAM = `${LOOKS.join(' | ')}: the cards' look (default glass)`;

function postsOf(b, raw, path, min, max, extra = []) {
  b.check.arr(raw, path, min, max);
  return raw.map((entry, i) => postOf(b.check, entry, `${path}[${i}]`, {extra}));
}

function lookOf(b) {
  return b.params.look === undefined ? 'glass' : b.check.oneOf(b.params.look, 'params.look', LOOKS);
}

/** The source line of several posts: the first in full, then the others' handles. */
function sourcesLine(posts, first = 0) {
  const lead = sourceLine(posts[first]);
  const rest = posts.filter((_, i) => i !== first).map(p => handleText(p) || p.name);
  return rest.length ? `${lead} · also ${[...new Set(rest)].join(', ')}` : lead;
}

function sourceBlock(b) {
  const size = r2(Math.max(b.min.meta, b.u(26)));
  return {size, h: r2(size * 1.3 + b.u(24))};
}

// Context cards (the others in a list, sorted cards) may set smaller than the
// key-text floor, down to this one; the focused card and the labels keep it.
const secondaryFloor = b => r2(Math.max(b.min.meta, b.min.key * 0.6));

const cardOf = (vb, c, i, extra = {}) => cardNode(vb, c.posts[i], c.metrics[i], c.palettes[i], `${c.prefix}-p${i}`, extra);

// ---------------------------------------------------------------------------
// social-stack

const STACK_VARIANTS = Object.freeze(['cascade', 'list']);

function stackResolve(params, ctx) {
  const b = createHBase('social-stack', params, ctx, {allowed: ['posts', 'focus', 'focusAt', 'highlight', 'look', 'at', 'stagger'], required: ['posts'], variants: STACK_VARIANTS, hidesCaptions: true});
  const {check, u, rect, params: p} = b;
  const posts = postsOf(b, p.posts, 'params.posts', 2, 5);
  const n = posts.length;
  const focus = p.focus === undefined ? n - 1 : check.int(p.focus, 'params.focus', 0, n - 1);
  const look = lookOf(b);
  const src = sourceBlock(b);
  const W = rect.width, H = rect.height - src.h;
  const cascade = b.variant === 'cascade';
  const width = r2(b.portrait ? W : Math.min(W, u(cascade ? 1180 : 1080)));
  const peek = r2(u(b.portrait ? 64 : 52));
  const gap = r2(u(28));
  let metrics;
  if (cascade) {
    const front = fitCard(b, posts[focus], width, H - (n - 1) * peek, u(b.portrait ? 52 : 48), `params.posts[${focus}].text`);
    metrics = posts.map((post, i) => (i === focus ? front : cardMetrics(b, post, width, front.bs)));
  } else {
    // The focused card keeps key-size text; the others are compact and shrink
    // first, to the secondary floor. A row in 16:9, a column in 9:16.
    const floor = secondaryFloor(b);
    const cardW = b.portrait ? width : r2((W - gap * (n - 1)) / n);
    const fits = list => (b.portrait ? list.reduce((a, m) => a + m.height, 0) + gap * (n - 1) : Math.max(...list.map(m => m.height))) <= H;
    search: for (let bs = Math.floor(u(b.portrait ? 50 : 46)); bs >= Math.ceil(b.min.key); bs -= 2) {
      for (let other = bs; other >= floor; other -= 2) {
        const list = posts.map((post, i) => cardMetrics(b, post, cardW, i === focus ? bs : other, {compact: i !== focus}));
        if (fits(list)) { metrics = list; break search; }
      }
    }
    if (!metrics) check.fail('params.posts', `do not fit as a list at ${Math.ceil(b.min.key)} px text; use the cascade variant, fewer posts or shorter excerpts`);
  }
  const hl = highlightsOf(b, posts[focus], p.highlight, 'params.highlight');
  const step = p.stagger === undefined ? 0.45 : check.num(p.stagger, 'params.stagger', 0.15, 1.2);
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.2, {min: 0});
  // Cascade: the others land first, the focused post last, in front.
  const order = cascade ? [...posts.keys()].filter(i => i !== focus).concat(focus) : [...posts.keys()];
  const enter = new Array(n);
  order.forEach((i, k) => { enter[i] = rt(buildAt + k * step); });
  const buildEnd = rt(buildAt + (n - 1) * step + 0.7);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: buildEnd, role: 'emphasis', cue: 'whoosh-soft'});
  const settled = buildEnd - b.start;
  const focusAt = b.timeOf('focus', p.focusAt, 'params.focusAt', Math.min(settled + (cascade ? 0.1 : 0.3), b.lastEvent), {min: 0});
  b.events.push({id: `${b.id}-focus`, name: 'focus', time: focusAt, endTime: rt(focusAt + 0.6), role: 'emphasis', cue: 'pop-soft'});
  const phrases = timeHighlights(b, hl, focusAt - b.start + 0.5);

  let place;
  if (cascade) {
    const total = metrics[focus].height + (n - 1) * peek;
    const top = r2(Math.max(0, (H - total) / 2) + (n - 1) * peek);
    place = posts.map(() => ({x: r2((W - width) / 2), y: top}));
  } else if (b.portrait) {
    const total = metrics.reduce((a, m) => a + m.height, 0) + gap * (n - 1);
    let y = r2((H - total) / 2);
    place = metrics.map(m => { const at = {x: r2((W - width) / 2), y}; y = r2(y + m.height + gap); return at; });
  } else {
    const tallest = Math.max(...metrics.map(m => m.height));
    place = metrics.map((m, i) => ({x: r2(i * (m.width + gap)), y: r2((H - tallest) / 2)}));
  }
  const content = {variant: b.variant, prefix: b.id, posts, metrics, palettes: posts.map(post => palette(b, look, post.platform)), focus, order, enter, place, peek, step, phrases,
    highlighted: [...hl.byWord.entries()], focusAt, buildAt, buildEnd, width, source: {text: sourcesLine(posts, focus), ...src}};
  return b.finish(content, {minTextPx: metrics[focus].bs});
}

/** A cascade card's pose `d` cards behind the front. */
function slot(d, u, peek) {
  if (d === 0) return {opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1, blur: 0};
  const scale = r2((1 - 0.07 * d) * 1e4) / 1e4;
  return {opacity: r2(Math.max(0.32, 0.78 - 0.16 * d)), x: 0, y: r2(-d * peek), scaleX: scale, scaleY: scale, blur: r2((3 + 2.5 * d) * u)};
}

function stackView(model) {
  const {id, rect} = model;
  const c = model.content;
  const vb = viewBase(model);
  // Cascade: deepest first, the focused card last (on top); list: in order.
  const paint = c.variant === 'cascade' ? c.order : [...c.posts.keys()];
  const kids = paint.map(i => cardOf(vb, c, i, {highlighted: i === c.focus ? new Map(c.highlighted) : new Map(), style: {position: 'absolute', left: c.place[i].x, top: c.place[i].y, transformOrigin: c.variant === 'cascade' ? '50% 0%' : '50% 50%'}}));
  kids.push(sourceNode(vb, c.source.text, c.source.size, model.theme.muted, `${id}-src`, {position: 'absolute', left: 0, top: r2(rect.height - c.source.size * 1.3), width: rect.width, textAlign: 'center'}));
  return kids;
}

function stackTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  const n = c.posts.length;
  const cascade = c.variant === 'cascade';
  c.posts.forEach((post, i) => {
    const card = `${id}-p${i}`;
    cardBuildOps(ops, card, start, c.enter[i], u, {has: partsOf(post), from: cascade ? {y: r2(90 * u)} : {}});
    set(ops, `${card}-glow`, start, {opacity: 0});
    if (cascade) {
      // Each later arrival pushes this card one step back.
      const k = c.order.indexOf(i);
      for (let j = k + 1; j < n; j++) {
        const t = c.enter[c.order[j]];
        tw(ops, card, rt(t + 0.05), 0.55, 'power3.out', slot(j - 1 - k, u, c.peek), slot(j - k, u, c.peek));
      }
    } else if (i !== c.focus) {
      tw(ops, card, c.focusAt, 0.5, 'power2.out', {opacity: 1, blur: 0}, {opacity: 0.42, blur: r2(3 * u)});
    } else {
      tw(ops, card, c.focusAt, 0.6, 'power2.out', {scaleX: 1, scaleY: 1}, {scaleX: 1.04, scaleY: 1.04});
    }
  });
  tw(ops, `${id}-p${c.focus}-glow`, c.focusAt, 0.5, 'power2.out', {opacity: 0}, {opacity: 1});
  highlightOps(ops, `${id}-p${c.focus}`, start, c.phrases);
  set(ops, `${id}-src`, start, {opacity: 0});
  tw(ops, `${id}-src`, rt(c.buildEnd - 0.2), 0.4, 'power1.out', {opacity: 0}, {opacity: 1});
}

const POSTS_PARAM = `[post] each a social-post's post fields (platform, name, handle, verified, avatar, text, media, quote, time, date, metrics, source, demo…)`;

export const socialStack = {
  id: 'social-stack',
  describe: '2–5 real posts cascading in, one after another: the focused one lands in front with a rim glow while the others step back, blurred and dimmed (cascade), or a vertical list whose focused card steps forward (list). The focused post can sweep a highlight across a phrase.',
  params: {posts: `${POSTS_PARAM} 2–5`, focus: 'index of the post in front (default the last)', focusAt: `the focus: ${at}`, highlight: 'a phrase of the focused post, or [{text, at?}] 1–3 (events highlight, highlight-2, highlight-3)',
    look: LOOK_PARAM, stagger: 'seconds between cards (0.15–1.2, default 0.45)', at: `first card: ${at}`, variant: VARIANT_PARAM, rect: rectParam},
  events: ['build', 'focus', 'highlight', 'highlight-2', 'highlight-3'],
  timing: timingRules({rules: ['cards land stagger s apart from at (default 0.2 s, 0.45 s apart)', 'focus follows the last card; the highlight 0.5 s after the focus']}),
  variants: STACK_VARIANTS,
  resolve: stackResolve, view: stackView, timeline: stackTimeline
};

// ---------------------------------------------------------------------------
// social-sort

const SORT_VARIANTS = Object.freeze(['columns']);

function sortResolve(params, ctx) {
  const b = createHBase('social-sort', params, ctx, {allowed: ['posts', 'columns', 'sortAt', 'look', 'at'], required: ['posts', 'columns'], variants: SORT_VARIANTS, hidesCaptions: true});
  const {check, u, rect, params: p} = b;
  check.arr(p.columns, 'params.columns', 2, 3);
  const tones = ['accent', 'paper', 'primary'];
  const posts = postsOf(b, p.posts, 'params.posts', 2, 6, ['column']);
  const cols = p.columns.map((col, i) => {
    const entry = typeof col === 'string' ? {label: col} : check.obj(col, `params.columns[${i}]`, ['label', 'tone'], ['label']);
    return {label: check.str(entry.label, `params.columns[${i}]${typeof col === 'string' ? '' : '.label'}`, 24), color: toneColor(b, entry.tone, `params.columns[${i}].tone`, tones[i])};
  });
  const column = p.posts.map((entry, i) => check.int(entry.column, `params.posts[${i}].column`, 0, cols.length - 1));
  const look = lookOf(b);
  const src = sourceBlock(b);
  const W = rect.width, H = rect.height - src.h;
  const G = cols.length;
  const side = !b.portrait;
  const gapX = r2(u(64)), gapY = r2(u(24));
  const colW = r2(side ? (W - gapX * (G - 1)) / G : W);
  const labelSize = Math.min(...cols.map((col, i) => fitText(check, `params.columns[${i}].label`, col.label, {family: 'display', width: colW, preferred: u(side ? 64 : 58), min: b.min.key}).size));
  const labelH = r2(labelSize * 1.2 + u(20));
  let metrics = null;
  for (let bs = Math.floor(u(side ? 44 : 46)); bs >= Math.ceil(secondaryFloor(b)) && !metrics; bs -= 2) {
    const list = posts.map(post => cardMetrics(b, post, colW, bs, {compact: true}));
    const colH = cols.map((_, g) => list.filter((_, i) => column[i] === g).reduce((a, m, k) => a + m.height + (k ? gapY : 0), 0));
    const need = side ? labelH + Math.max(...colH) : colH.reduce((a, h) => a + labelH + h, 0) + u(40) * (G - 1);
    if (need <= H) metrics = list;
  }
  if (!metrics) check.fail('params.posts', `do not fit their columns at ${Math.ceil(secondaryFloor(b))} px text; give fewer posts or shorter excerpts (mark cuts with …)`);

  // Slots: landscape columns side by side; portrait bands top to bottom.
  const heads = [], place = [], dividers = [];
  let bandY = 0;
  if (!side) {
    const used = cols.reduce((a, _, g) => a + labelH + metrics.filter((_, i) => column[i] === g).reduce((s2, m, k) => s2 + m.height + (k ? gapY : 0), 0), 0) + u(40) * (G - 1);
    bandY = r2((H - used) / 2);
  }
  const colTop = side ? r2((H - labelH - Math.max(...cols.map((_, g) => metrics.filter((_, i) => column[i] === g).reduce((a, m, k) => a + m.height + (k ? gapY : 0), 0)))) / 2) : 0;
  cols.forEach((col, g) => {
    const x = side ? r2(g * (colW + gapX)) : 0;
    let y = side ? colTop : bandY;
    heads.push({...col, x, y, size: labelSize});
    y = r2(y + labelH);
    posts.forEach((_, i) => { if (column[i] === g) { place[i] = {x, y}; y = r2(y + metrics[i].height + gapY); } });
    if (!side) {
      bandY = r2(y - gapY + u(40));
      if (g < G - 1) dividers.push({x: 0, y: r2(bandY - u(20)), width: W, height: 0});
    } else if (g < G - 1) dividers.push({x: r2(x + colW + gapX / 2), y: colTop, width: 0, height: r2(H - colTop * 2)});
  });

  // Pile: every card in the middle, slightly turned, before the sort.
  const pileX = r2((W - colW) / 2), pileTop = r2(H / 2 - Math.max(...metrics.map(m => m.height)) / 2 - (posts.length - 1) * u(9));
  const pile = posts.map((_, i) => ({dx: r2(pileX - place[i].x), dy: r2(pileTop + i * u(18) - place[i].y), rotation: [-2.2, 1.6, -1.1, 2.4, -1.8, 1.2][i]}));
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.2, {min: 0});
  const enter = posts.map((_, i) => rt(buildAt + i * 0.3));
  const buildEnd = rt(enter.at(-1) + 0.7);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: buildEnd, role: 'emphasis', cue: 'whoosh-soft'});
  const sortAt = b.timeOf('sort', p.sortAt, 'params.sortAt', Math.min(buildEnd - b.start + 0.5, b.lastEvent), {min: 0});
  const moves = posts.map((_, i) => rt(sortAt + 0.25 + i * 0.14));
  b.events.push({id: `${b.id}-sort`, name: 'sort', time: sortAt, endTime: rt(moves.at(-1) + 0.75), role: 'emphasis', cue: 'whoosh'});
  const content = {variant: b.variant, prefix: b.id, posts, metrics, palettes: posts.map(post => palette(b, look, post.platform)), column, heads, labelSize, place, pile, dividers, side, colW,
    enter, moves, sortAt, buildAt, buildEnd, source: {text: sourcesLine(posts), ...src}, divider: hex2(b.colors.paper, 0.3)};
  // The column labels are the key text; the sorted cards are context (secondaryFloor).
  return b.finish(content, {minTextPx: labelSize});
}

function sortView(model) {
  const {id, rect, fonts} = model;
  const c = model.content;
  const vb = viewBase(model);
  const kids = [];
  c.dividers.forEach((d, i) => kids.push(el('div', `${id}-div-${i}`, {position: 'absolute', left: d.x, top: d.y, width: d.width || 0, height: d.height || 0,
    ...(c.side ? {borderLeft: `${r2(3 * model.unit)}px dashed ${c.divider}`} : {borderTop: `${r2(3 * model.unit)}px dashed ${c.divider}`})})));
  c.heads.forEach((h, g) => kids.push(el('div', `${id}-head-${g}`, {position: 'absolute', left: h.x, top: h.y, width: c.colW, textAlign: 'center', fontFamily: fonts.display, fontSize: h.size, lineHeight: '1.2', color: h.color, whiteSpace: 'nowrap'}, [h.label])));
  c.posts.forEach((_, i) => kids.push(cardOf(vb, c, i, {style: {position: 'absolute', left: c.place[i].x, top: c.place[i].y, transformOrigin: '50% 50%'}})));
  kids.push(sourceNode(vb, c.source.text, c.source.size, model.theme.muted, `${id}-src`, {position: 'absolute', left: 0, top: r2(rect.height - c.source.size * 1.3), width: rect.width, textAlign: 'center'}));
  return kids;
}

function sortTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  c.posts.forEach((post, i) => {
    const card = `${id}-p${i}`, pl = c.pile[i];
    const pose = {x: pl.dx, y: pl.dy, rotation: pl.rotation};
    cardBuildOps(ops, card, start, c.enter[i], u, {has: partsOf(post), from: {...pose, y: r2(pl.dy + 60 * u)}, to: pose});
    tw(ops, card, c.moves[i], 0.75, 'power3.inOut', pose, {x: 0, y: 0, rotation: 0});
    set(ops, `${card}-glow`, start, {opacity: 0});
  });
  c.heads.forEach((_, g) => {
    set(ops, `${id}-head-${g}`, start, {opacity: 0, x: 0, y: r2(18 * u)});
    tw(ops, `${id}-head-${g}`, rt(c.sortAt + g * 0.1), 0.45, 'power3.out', {opacity: 0, y: r2(18 * u)}, {opacity: 1, y: 0});
  });
  c.dividers.forEach((_, i) => {
    const from = c.side ? {opacity: 1, clipT: 0, clipR: 0, clipB: 100, clipL: 0} : {opacity: 1, clipT: 0, clipR: 100, clipB: 0, clipL: 0};
    set(ops, `${id}-div-${i}`, start, {...from, opacity: 0});
    tw(ops, `${id}-div-${i}`, rt(c.sortAt + 0.1), 0.6, 'power2.out', from, {opacity: 1, clipT: 0, clipR: 0, clipB: 0, clipL: 0});
  });
  set(ops, `${id}-src`, start, {opacity: 0});
  tw(ops, `${id}-src`, rt(c.buildEnd - 0.2), 0.4, 'power1.out', {opacity: 0}, {opacity: 1});
}

export const socialSort = {
  id: 'social-sort',
  describe: '2–6 real posts pile up in the middle, then fly into 2–3 labelled columns ("Can\'t wait" / "Tired"): side by side in 16:9, stacked bands in 9:16, with dashed dividers.',
  params: {posts: `${POSTS_PARAM} 2–6, each with column (index into columns)`, columns: '[label ≤ 24 | {label, tone? (primary | accent | paper | #rrggbb)}] 2–3', sortAt: `the sort: ${at}`,
    look: LOOK_PARAM, at: `first card: ${at}`, variant: VARIANT_PARAM, rect: rectParam},
  events: ['build', 'sort'],
  timing: timingRules({rules: ['cards pile in 0.3 s apart from at (default 0.2 s)', 'the sort follows the pile by 0.5 s; cards fly 0.14 s apart']}),
  variants: SORT_VARIANTS,
  resolve: sortResolve, view: sortView, timeline: sortTimeline
};

// ---------------------------------------------------------------------------
// social-wall: a depth field of posts through a pinhole camera computed in
// the model (scale, blur and parallax drift by depth), so it is seek-safe and
// both renderers draw it with plain 2D ops.

const WALL_VARIANTS = Object.freeze(['field']);
const DRIFT = {left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1]};

/** Deterministic 0–1 value for (i, k). */
function hash(i, k) {
  const x = Math.sin((i + 1) * 12.9898 + (k + 1) * 78.233) * 43758.5453;
  return r2((x - Math.floor(x)) * 1e4) / 1e4;
}

function wallResolve(params, ctx) {
  const b = createHBase('social-wall', params, ctx, {allowed: ['posts', 'focus', 'pullAt', 'highlight', 'tiles', 'drift', 'look', 'at'], required: ['posts'], variants: WALL_VARIANTS, hidesCaptions: true});
  const {check, u, rect, params: p, canvas} = b;
  const posts = postsOf(b, p.posts, 'params.posts', 2, 16);
  const focusList = p.focus === undefined ? [0] : Array.isArray(p.focus) ? check.arr(p.focus, 'params.focus', 1, 2) : [p.focus];
  const focus = focusList.map((v, i) => check.int(v, `params.focus${Array.isArray(p.focus) ? `[${i}]` : ''}`, 0, posts.length - 1));
  if (new Set(focus).size !== focus.length) check.fail('params.focus', 'must name two different posts');
  const tiles = p.tiles === undefined ? 18 : check.int(p.tiles, 'params.tiles', 6, 24);
  const drift = DRIFT[p.drift === undefined ? 'left' : check.oneOf(p.drift, 'params.drift', Object.keys(DRIFT))];
  const look = lookOf(b);
  const src = sourceBlock(b);
  const W = rect.width, H = rect.height - src.h;
  const tileW = r2(u(720)), tileBs = r2(Math.max(b.min.key, u(44)));
  const metrics = posts.map(post => cardMetrics(b, post, tileW, tileBs));

  // Front poses for the pulled posts, scaled so they fit.
  const two = focus.length === 2;
  const frontW = b.portrait ? W * (two ? 0.9 : 0.96) : two ? W * 0.45 : Math.min(W * 0.6, u(1080));
  let scale = frontW / tileW;
  // A portrait pair overlaps a little, the second in front.
  const room = two && b.portrait ? H * 0.58 : H;
  scale = r2(Math.min(scale, ...focus.map(i => room / metrics[i].height)) * 1e3) / 1e3;
  if (tileBs * scale < b.min.key - 1e-6) check.fail(`params.posts[${focus[0]}].text`, 'is too long to pull forward at a readable size; quote a shorter excerpt (mark cuts with …)');
  const front = focus.map((i, k) => {
    const cx = two && !b.portrait ? W * (k ? 0.74 : 0.26) : W / 2;
    const cy = two && b.portrait ? H * (k ? 0.71 : 0.29) : two ? H / 2 + (k ? u(50) : -u(50)) : H / 2;
    return {i, cx: r2(cx), cy: r2(cy)};
  });

  // The field covers the whole canvas (and a margin), around the rect.
  const fx0 = -rect.x - u(120), fy0 = -rect.y - u(80), fw = canvas.width + u(240), fh = canvas.height + u(160);
  const cols = Math.max(2, Math.round(Math.sqrt(tiles * fw / fh))), rows = Math.ceil(tiles / cols);
  const others = posts.map((_, i) => i).filter(i => !focus.includes(i));
  const pool = others.length ? others : posts.map((_, i) => i);
  const field = [];
  for (let k = 0; k < tiles; k++) {
    const col = k % cols, rowN = Math.floor(k / cols);
    const z = r2(((k * 7) % tiles) / Math.max(1, tiles - 1) * 0.85 + hash(k, 1) * 0.15);
    field.push({post: pool[k % pool.length], z,
      cx: r2(fx0 + (col + 0.5 + (hash(k, 2) - 0.5) * 0.5 + (rowN % 2 ? 0.25 : -0.25)) * fw / cols), cy: r2(fy0 + (rowN + 0.5 + (hash(k, 3) - 0.5) * 0.45) * fh / rows)});
  }
  // The pulled posts start near the camera, close to the middle, so they sit over the field.
  const pulled = front.map((f, k) => ({post: f.i, z: 0.06, cx: r2(W * (k ? 0.68 : 0.36)), cy: r2(H * (k ? 0.62 : 0.4)), front: f}));
  const pose = t => {
    const s = r2((0.5 - 0.3 * t.z) * 1e4) / 1e4;
    // The blur is drawn before the scale, so it is divided by it to read on screen.
    return {scale: s, blur: r2((2.5 + t.z * 7) * b.unit / s), opacity: r2(0.72 - 0.42 * t.z), travel: r2((240 - 170 * t.z) * b.unit)};
  };
  const all = [...field.sort((a, c2) => c2.z - a.z), ...pulled].map(t => ({...t, ...pose(t), h: metrics[t.post].height}));
  for (const t of pulled.map(pt => all.find(a => a.front === pt.front))) { t.blur = r2(1.5 * b.unit / t.scale); t.opacity = 0.9; }

  const buildAt = b.timeOf('build', p.at, 'params.at', 0, {min: 0});
  const buildEnd = rt(buildAt + 1.4);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: buildEnd, role: 'emphasis', cue: 'whoosh-soft'});
  const pullAt = b.timeOf('pull', p.pullAt, 'params.pullAt', Math.min(buildEnd - b.start + 0.6, b.lastEvent), {min: 0});
  b.events.push({id: `${b.id}-pull`, name: 'pull', time: pullAt, endTime: rt(pullAt + 1.1), role: 'emphasis', cue: 'whoosh'});
  const hl = highlightsOf(b, posts[focus[0]], p.highlight, 'params.highlight');
  const phrases = timeHighlights(b, hl, pullAt - b.start + 1.2);

  // Bokeh: soft orbs of light in front of and behind the field.
  const orbs = Array.from({length: 12}, (_, k) => ({size: r2(u(40 + hash(k, 5) * 180)), cx: r2(fx0 + hash(k, 6) * fw), cy: r2(fy0 + hash(k, 7) * fh), z: hash(k, 8), opacity: r2(0.14 + hash(k, 9) * 0.32), tone: k % 3 === 2 ? 'paper' : 'accent'}));
  const content = {variant: b.variant, prefix: b.id, posts, metrics, palettes: posts.map(post => palette(b, look, post.platform)), tiles: all, tileW, focus, front, frontScale: scale, drift,
    orbs, buildAt, buildEnd, pullAt, phrases, highlighted: [...hl.byWord.entries()], source: {text: sourcesLine(posts.filter((_, i) => focus.includes(i)).concat(), 0), ...src},
    colors: {accent: b.colors.accent, paper: b.colors.paper}};
  return b.finish(content, {minTextPx: r2(tileBs * scale)});
}

function wallView(model) {
  const {id, rect} = model;
  const c = model.content;
  const vb = viewBase(model);
  const kids = c.orbs.map((o, k) => el('div', `${id}-orb-${k}`, {position: 'absolute', left: r2(o.cx - o.size / 2), top: r2(o.cy - o.size / 2), width: o.size, height: o.size, borderRadius: '50%',
    background: `radial-gradient(circle, ${hex2(c.colors[o.tone], 0.9)} 0%, ${hex2(c.colors[o.tone], 0.35)} 45%, ${hex2(c.colors[o.tone], 0)} 70%)`}));
  c.tiles.forEach((t, k) => {
    const lead = t.front && t.front.i === c.focus[0];
    kids.push(el('div', `${id}-t${k}`, {position: 'absolute', left: r2(t.cx - c.tileW / 2), top: r2(t.cy - t.h / 2), width: c.tileW, transformOrigin: '50% 50%'}, [
      cardNode(vb, c.posts[t.post], c.metrics[t.post], c.palettes[t.post], `${id}-t${k}-c`, {highlighted: lead ? new Map(c.highlighted) : new Map()})]));
  });
  kids.push(sourceNode(vb, c.source.text, c.source.size, model.theme.muted, `${id}-src`, {position: 'absolute', left: 0, top: r2(rect.height - c.source.size * 1.3), width: rect.width, textAlign: 'center'}));
  return kids;
}

function wallTimeline(model, ops) {
  const {id, start, end, unit: u} = model;
  const c = model.content;
  const [dx, dy] = c.drift;
  const span = rt(end - start);
  c.orbs.forEach((o, k) => {
    const travel = r2((60 + 160 * (1 - o.z)) * u);
    const from = {opacity: 0, x: r2(-dx * travel / 2), y: r2(-dy * travel / 2), scaleX: 1, scaleY: 1};
    set(ops, `${id}-orb-${k}`, start, from);
    tw(ops, `${id}-orb-${k}`, start, span, 'none', {x: from.x, y: from.y}, {x: r2(dx * travel / 2), y: r2(dy * travel / 2)});
    tw(ops, `${id}-orb-${k}`, rt(c.buildAt + hash(k, 4) * 0.8), 0.9, 'power1.out', {opacity: 0}, {opacity: o.opacity});
  });
  c.tiles.forEach((t, k) => {
    const target = `${id}-t${k}`;
    const x0 = r2(-dx * t.travel / 2), y0 = r2(-dy * t.travel / 2), x1 = r2(dx * t.travel / 2), y1 = r2(dy * t.travel / 2);
    set(ops, target, start, {opacity: 0, x: x0, y: y0, scaleX: t.scale, scaleY: t.scale, blur: r2(t.blur + 6 * u)});
    const appear = rt(c.buildAt + (t.front ? 0.35 : hash(k, 10) * 0.9));
    tw(ops, target, appear, 0.9, 'power2.out', {opacity: 0, blur: r2(t.blur + 6 * u)}, {opacity: t.opacity, blur: t.blur});
    if (!t.front) {
      tw(ops, target, start, span, 'none', {x: x0, y: y0}, {x: x1, y: y1});
      tw(ops, target, c.pullAt, 0.8, 'power2.out', {opacity: t.opacity, blur: t.blur}, {opacity: r2(t.opacity * 0.55), blur: r2(t.blur + 3 * u / t.scale)});
      return;
    }
    // Drift until the pull, then come forward to the front pose, sharp.
    const p = (c.pullAt - start) / span;
    const xp = r2(x0 + (x1 - x0) * p), yp = r2(y0 + (y1 - y0) * p);
    tw(ops, target, start, rt(c.pullAt - start), 'none', {x: x0, y: y0}, {x: xp, y: yp});
    tw(ops, target, c.pullAt, 1.1, 'power3.inOut', {x: xp, y: yp, scaleX: t.scale, scaleY: t.scale, opacity: t.opacity, blur: t.blur},
      {x: r2(t.front.cx - t.cx), y: r2(t.front.cy - t.cy), scaleX: c.frontScale, scaleY: c.frontScale, opacity: 1, blur: 0});
    set(ops, `${target}-c-glow`, start, {opacity: 0});
    tw(ops, `${target}-c-glow`, rt(c.pullAt + 0.8), 0.5, 'power2.out', {opacity: 0}, {opacity: 1});
    if (t.front.i === c.focus[0]) highlightOps(ops, `${target}-c`, start, c.phrases);
  });
  set(ops, `${id}-src`, start, {opacity: 0});
  tw(ops, `${id}-src`, rt(c.pullAt + 0.9), 0.4, 'power1.out', {opacity: 0}, {opacity: 1});
}

export const socialWall = {
  id: 'social-wall',
  describe: 'A wall of real posts in depth: many cards drift with parallax across the frame, smaller and blurrier further back, among soft bokeh orbs; then one or two are pulled forward, sharp and in focus, while the field dims. The first pulled post can sweep a highlight across a phrase.',
  params: {posts: `${POSTS_PARAM} 2–16 (the field repeats them)`, focus: 'index or [index, index]: the post(s) pulled forward (default 0)', pullAt: `the pull: ${at}`,
    highlight: 'a phrase of the first pulled post, or [{text, at?}] 1–3 (events highlight…)', tiles: 'cards in the field, 6–24 (default 18)', drift: '"left" | "right" | "up" | "down" (default left)',
    look: LOOK_PARAM, at: `field build: ${at}`, variant: VARIANT_PARAM, rect: rectParam},
  events: ['build', 'pull', 'highlight', 'highlight-2', 'highlight-3'],
  timing: timingRules({rules: ['the field fades in over about 1.4 s from at (default 0 s) and drifts for the whole scene', 'the pull follows the build by 0.6 s and takes 1.1 s; the highlight 1.2 s after the pull']}),
  variants: WALL_VARIANTS,
  resolve: wallResolve, view: wallView, timeline: wallTimeline
};

export const SOCIAL_MODULES = [socialPost, socialStack, socialSort, socialWall];

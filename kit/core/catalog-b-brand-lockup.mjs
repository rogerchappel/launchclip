// Catalogue B module `brand-lockup`: a title or end card built from the
// brand's own artwork. Registered in kit/core/catalog-b.mjs; conventions are
// documented there.
//
//   variant "title"  optional eyebrow, then the mark beside the wordmark (or
//                    stacked), then an optional headline below.
//   variant "end"    the mark above the wordmark, an optional headline, a
//                    badge image (e.g. an app-store badge) and a URL pill.
//
// Images are project-local assets/ files. A wordmark's width comes from its
// aspect ratio (width / height; images are not read at resolve time), and
// object-fit: contain keeps a wrong ratio from distorting it. `tint` recolours
// a mark or wordmark (every opaque pixel, alpha kept) with an SVG
// feColorMatrix filter, so a dark wordmark reads on a dark background. Hides
// captions, like hook-title and cta.

import {contrastRatio, createBase, fitText, r2, rt, textWidth, timingRules} from './catalog-b-base.mjs';
import {abs, el, set, text, tw} from './catalog-b-view.mjs';
import {grammarEase, grammarStagger} from './grammar.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const VARIANTS = ['title', 'end'];
const LAYOUTS = ['row', 'stack'];
const TINT_ROLES = ['paper', 'ink', 'primary', 'accent'];
const HEX6 = /^#[0-9a-fA-F]{6}$/;

// Beat defaults (seconds from the scene start) and how long each element takes to land.
export const BRAND_LOCKUP_TIMING = Object.freeze({mark: 0, stagger: 0.35, land: 0.6, bloom: 0.75, sweep: 0.9, shine: 0.8, shineGap: 0.2});
const T = BRAND_LOCKUP_TIMING;

// ---------------------------------------------------------------------------
// Model

function image(check, value, path, {ratio: fallback = 1} = {}) {
  if (typeof value === 'string') return {src: check.asset(value, path), ratio: fallback};
  check.obj(value, path, ['src', 'ratio'], ['src']);
  return {src: check.asset(value.src, `${path}.src`), ratio: value.ratio === undefined ? fallback : check.num(value.ratio, `${path}.ratio`, 0.2, 12)};
}

function tintColor(check, value, path, colors) {
  if (value === undefined || value === 'none') return null;
  if (TINT_ROLES.includes(value)) return colors[value];
  if (typeof value === 'string' && HEX6.test(value)) return value.toLowerCase();
  return check.fail(path, `must be none, ${TINT_ROLES.join(', ')} or a six-digit hex colour`);
}

// feColorMatrix values that paint every pixel `hex`, keeping its alpha.
function tintMatrix(hex) {
  const [r, g, b] = [1, 3, 5].map(i => Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 1e4) / 1e4);
  return `0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 1 0`;
}

function resolve(params, ctx) {
  const b = createBase('brand-lockup', params, ctx, {allowed: ['variant', 'layout', 'mark', 'wordmark', 'tint', 'markTint', 'eyebrow', 'headline', 'badge', 'url', 'glow', 'shine', 'background', 'sfx', 'at', 'stagger'], hidesCaptions: true});
  const {check, u, rect, id, start, colors, theme} = b;
  const p = b.params;
  const variant = p.variant === undefined ? 'title' : check.oneOf(p.variant, 'params.variant', VARIANTS);
  const layout = p.layout === undefined ? (variant === 'end' ? 'stack' : 'row') : check.oneOf(p.layout, 'params.layout', LAYOUTS);
  if (p.mark === undefined && p.wordmark === undefined) check.fail('params.mark', 'or params.wordmark is required: the lockup is built from the brand\'s artwork');
  const mark = p.mark === undefined ? null : image(check, p.mark, 'params.mark');
  const wordmark = p.wordmark === undefined ? null : image(check, p.wordmark, 'params.wordmark', {ratio: 4});
  const tint = tintColor(check, p.tint, 'params.tint', colors);
  const markTint = tintColor(check, p.markTint, 'params.markTint', colors);
  const eyebrow = p.eyebrow === undefined ? null : check.str(p.eyebrow, 'params.eyebrow', 40);
  const headline = p.headline === undefined ? null : check.str(p.headline, 'params.headline', 80);
  if (variant === 'title' && (p.badge !== undefined || p.url !== undefined)) check.fail(p.badge !== undefined ? 'params.badge' : 'params.url', 'is for the end variant (variant: "end")');
  const badge = p.badge === undefined ? null : image(check, p.badge, 'params.badge', {ratio: 3});
  const url = p.url === undefined ? null : check.str(p.url, 'params.url', 64);
  if (url && /\s/.test(url)) check.fail('params.url', 'must not contain spaces');
  // A light card: the scene behind the lockup is one solid colour (paper or a
  // hex), the artwork keeps its own colours and the text turns to ink.
  let backdrop = null;
  if (p.background !== undefined) {
    backdrop = p.background === 'paper' ? colors.paper : typeof p.background === 'string' && HEX6.test(p.background) ? p.background.toLowerCase() : check.fail('params.background', 'must be paper or a six-digit hex colour');
    if (tint && contrastRatio(tint, backdrop) < 1.5) check.fail('params.tint', `would draw the wordmark in ${tint} on the ${backdrop} background, where it vanishes; drop the tint so it keeps its own colours`);
    if (markTint && contrastRatio(markTint, backdrop) < 1.5) check.fail('params.markTint', `would draw the mark in ${markTint} on the ${backdrop} background, where it vanishes`);
  }
  // One sound by default: a soft whoosh as the mark lands. The story's own
  // cue on a hit replaces it, so the opener never doubles up.
  const ownCue = p.sfx === undefined ? 'whoosh-soft' : p.sfx === false ? null : check.str(p.sfx, 'params.sfx', 40);
  const storyCue = (ctx.hits ?? []).some(hit => hit && typeof hit.cue === 'string');
  const glow = p.glow === undefined ? 'primary' : p.glow === false ? null : check.oneOf(p.glow, 'params.glow', ['primary', 'accent']);
  const shine = p.shine === undefined ? true : check.bool(p.shine, 'params.shine');
  const stagger = p.stagger === undefined ? grammarStagger(ctx.grammar, T.stagger, {min: 0.15, max: 0.9}) : check.num(p.stagger, 'params.stagger', 0.1, 1);

  const W = rect.width, H = rect.height;
  const gapY = u(34);
  const blocks = [];
  // Mark and wordmark: the lockup. Row: side by side, the wordmark 62% of the
  // mark's height; stack: the mark above a wider wordmark. Both shrink
  // together until the lockup fits the width.
  let markSize = u(variant === 'end' ? 190 : 170);
  let wordH = layout === 'row' ? markSize * 0.62 : u(96);
  const gapX = u(36);
  const lockupWidth = () => (layout === 'row' ? (mark ? markSize : 0) + (mark && wordmark ? gapX : 0) + (wordmark ? wordH * wordmark.ratio : 0) : Math.max(mark ? markSize : 0, wordmark ? wordH * wordmark.ratio : 0));
  const maxLockup = W * (variant === 'end' ? 0.62 : 0.86);
  if (lockupWidth() > maxLockup) {
    const k = maxLockup / lockupWidth();
    markSize *= k; wordH *= k;
  }
  if ((mark && markSize < u(72)) || (wordmark && wordH < u(40))) check.fail('params.wordmark.ratio', 'makes the lockup too wide to read; use a narrower wordmark or layout "stack"');
  markSize = r2(markSize); wordH = r2(wordH);

  const eyebrowFit = eyebrow ? fitText(check, 'params.eyebrow', eyebrow.toUpperCase(), {family: 'meta', width: W, preferred: Math.max(b.min.key, u(34)), min: b.min.key}) : null;
  const headlineFit = headline ? fitText(check, 'params.headline', headline, {family: 'display', width: W * 0.9, preferred: u(variant === 'end' ? 64 : 76), min: b.min.key, maxLines: 2}) : null;
  const urlFit = url ? fitText(check, 'params.url', url, {family: 'body', width: W * 0.7 - u(80), preferred: u(46), min: b.min.key}) : null;
  const badgeH = badge ? r2(Math.min(u(92), (W * 0.5) / badge.ratio)) : 0;

  if (eyebrowFit) blocks.push({key: 'eyebrow', height: eyebrowFit.size * 1.3});
  if (layout === 'row') blocks.push({key: 'lockup', height: Math.max(mark ? markSize : 0, wordmark ? wordH : 0)});
  else {
    if (mark) blocks.push({key: 'mark', height: markSize});
    if (wordmark) blocks.push({key: 'wordmark', height: wordH});
  }
  if (headlineFit) blocks.push({key: 'headline', height: headlineFit.lines * headlineFit.size * 1.08});
  if (badge) blocks.push({key: 'badge', height: badgeH});
  if (urlFit) blocks.push({key: 'url', height: urlFit.size * 1.2 + u(36)});
  const total = blocks.reduce((sum, block) => sum + block.height, 0) + gapY * (blocks.length - 1);
  if (total > H) check.fail('params', `the lockup is ${Math.round(total)} px tall and the frame has ${Math.round(H)} px; drop the eyebrow or shorten the headline`);
  let y = (H - total) / 2;
  const top = {};
  for (const block of blocks) { top[block.key] = r2(y); y += block.height + gapY; }

  // Geometry, rect-local.
  const centreX = W / 2;
  const onCard = colour => (backdrop ? contrastRatio(colour, backdrop) : Infinity);
  let ink = theme.foreground;
  if (backdrop) {
    ink = [colors.ink, colors.bg, '#111111'].find(colour => onCard(colour) >= 4.5) ?? check.fail('params.background', `leaves no brand colour with 4.5:1 contrast for the text on ${backdrop}`);
    b.requireContrast('text/background', ink, backdrop, `text (${ink}) on params.background`);
  }
  const content = {variant, layout, tint, markTint, filters: [], ink, muted: theme.muted, backdrop: backdrop ? {color: backdrop, bleed: u(96)} : null};
  if (tint) content.filters.push({id: `${id}-tint`, values: tintMatrix(tint)});
  if (markTint) content.filters.push({id: `${id}-mark-tint`, values: tintMatrix(markTint)});
  if (layout === 'row') {
    const w = lockupWidth(), x0 = centreX - w / 2, row = top.lockup, rowH = Math.max(mark ? markSize : 0, wordmark ? wordH : 0);
    if (mark) content.mark = {src: mark.src, x: r2(x0), y: r2(row + (rowH - markSize) / 2), width: markSize, height: markSize};
    if (wordmark) {
      const wx = x0 + (mark ? markSize + gapX : 0);
      content.wordmark = {src: wordmark.src, x: r2(wx), y: r2(row + (rowH - wordH) / 2), width: r2(wordH * wordmark.ratio), height: wordH, slide: r2(wordH * wordmark.ratio * 0.5)};
    }
  } else {
    if (mark) content.mark = {src: mark.src, x: r2(centreX - markSize / 2), y: top.mark, width: markSize, height: markSize};
    if (wordmark) {
      const ww = r2(wordH * wordmark.ratio);
      content.wordmark = {src: wordmark.src, x: r2(centreX - ww / 2), y: top.wordmark, width: ww, height: wordH, slide: r2(ww * 0.5)};
    }
  }
  if (eyebrowFit) content.eyebrow = {text: eyebrow.toUpperCase(), size: eyebrowFit.size, y: top.eyebrow, color: backdrop ? [colors.accent, colors.primary, ink].find(colour => onCard(colour) >= 3) : b.resolveColor('accent', 'eyebrow colour', 'accent')};
  if (headlineFit) content.headline = {text: headline, size: headlineFit.size, lines: headlineFit.lines, y: top.headline, width: r2(W * 0.9), x: r2(W * 0.05)};
  if (badge) {
    const bw = r2(badgeH * badge.ratio);
    content.badge = {src: badge.src, x: r2(centreX - bw / 2), y: top.badge, width: bw, height: badgeH};
  }
  if (urlFit) {
    const padX = u(40), height = r2(urlFit.size * 1.2 + u(36));
    const width = r2(textWidth(url, urlFit.size, 'body') + padX * 2);
    const fill = colors.primary;
    const inkOnFill = b.requireContrast('url/primary', colors.ink, fill, 'brand.colors.ink on brand.colors.primary (URL pill)') >= 3 ? colors.ink : colors.paper;
    content.url = {text: url, size: urlFit.size, x: r2(centreX - width / 2), y: top.url, width, height, padX, fill, ink: inkOnFill, radius: r2(height / 2)};
  }

  // The light bloom: a soft brand-colour glow behind the lockup that blooms in
  // with the first beat and keeps widening slowly while the card rests.
  if (glow) {
    const parts = [content.mark, content.wordmark].filter(Boolean);
    const top = Math.min(...parts.map(part => part.y)), bottom = Math.max(...parts.map(part => part.y + part.height));
    const size = r2(Math.min(W, H) * 1.3);
    content.glow = {color: colors[glow], size, x: r2(centreX - size / 2), y: r2((top + bottom) / 2 - size / 2)};
  }
  // Beats: the mark first (the hook), then the rest top to bottom, `stagger` apart.
  const order = ['mark', 'wordmark', 'eyebrow', 'headline', 'badge', 'url'].filter(key => content[key]);
  // The card is the scene: its first beat may land before a catalogue enter would settle.
  const bounds = {min: 0};
  const first = b.timeOf(order[0], p.at, 'params.at', T.mark, bounds);
  // A beat timed by a hit moves the ones after it: each default lands `stagger` after the previous beat.
  let previous = first - stagger;
  content.beats = order.map((key, i) => {
    const time = i === 0 ? first : b.timeOf(key, undefined, `params (${key})`, Math.max(first + i * stagger, previous + stagger) - start, bounds);
    previous = time;
    // silent: a timing-only hit on this beat adds no default sound (finish bindCues).
    const cue = i === 0 && ownCue && !storyCue ? ownCue : undefined;
    b.events.push({id: `${id}-${key}`, name: key, time, endTime: rt(time + T.land), role: key === 'mark' || key === 'url' ? 'emphasis' : 'beat', ...(cue ? {cue} : {silent: true})});
    return {key, time};
  });
  // Shine: two soft bands of paper-coloured light. A sweep crosses the whole
  // card as the first beat lands, so the opening moves at once whatever the
  // brand colours (the motion gate's hook wants motion by 0.35 s, and a
  // slow → fast → slow entrance alone starts too gently). A glint then
  // crosses the mark and wordmark once they have landed: a second distinct
  // beat for an opener with no headline.
  content.sweeps = [];
  const lockupBeats = content.beats.filter(beat => beat.key === 'mark' || beat.key === 'wordmark');
  if (shine && lockupBeats.length) {
    const exitAt = b.end - b.motion.exitDuration;
    const sweepW = u(360), sweepH = r2(H + u(240));
    if (first + T.sweep <= exitAt) content.sweeps.push({key: 'sweep', time: first, x: r2(-sweepW * 1.5), y: r2(-u(120)), width: sweepW, height: sweepH, travel: r2(W + sweepW * 3), alpha: '40', duration: T.sweep});
    const parts = [content.mark, content.wordmark].filter(Boolean);
    const left = Math.min(...parts.map(part => part.x)), right = Math.max(...parts.map(part => part.x + part.width));
    const top = Math.min(...parts.map(part => part.y)), bottom = Math.max(...parts.map(part => part.y + part.height));
    const time = rt(Math.max(...lockupBeats.map(beat => beat.time)) + T.land * 1.3 + T.shineGap);
    if (time + T.shine <= exitAt) {
      const width = u(220), height = r2(bottom - top + u(200));
      content.sweeps.push({key: 'shine', time, x: r2(left - width), y: r2((top + bottom) / 2 - height / 2), width, height, travel: r2(right - left + width * 2), alpha: '73', duration: T.shine});
      b.events.push({id: `${id}-shine`, name: 'shine', time, endTime: rt(time + T.shine), role: 'beat', silent: true});
    }
  }

  // On a light card the light is the brand colour, laid over the card.
  content.light = backdrop ? colors.primary : colors.paper;
  content.lightBlend = backdrop ? 'normal' : 'screen';
  // On a light card the bands sit behind the artwork, so the glint is taller and stronger to read around it.
  if (backdrop) for (const sweep of content.sweeps) {
    sweep.alpha = sweep.key === 'sweep' ? '2e' : '59';
    if (sweep.key === 'shine') { const grow = Math.min(H, sweep.height * 2) - sweep.height; sweep.y = r2(sweep.y - grow / 2); sweep.height = r2(sweep.height + grow); }
  }
  if (content.glow && backdrop) content.glow.soft = true;
  // The card moves as one: a slow push-in of the whole lockup (the hold drift would move the card's edges).
  if (backdrop) content.push = {scale: 1.035, origin: {x: r2(W / 2), y: r2(H / 2)}};
  content.land = T.land;
  content.bloom = T.bloom;
  content.rise = r2(u(28));
  content.enterEase = grammarEase(ctx.grammar, 'power3.out', {props: ['y', 'scaleX']});
  content.fadeEase = grammarEase(ctx.grammar, 'power2.out', {props: ['opacity']});
  const texts = [eyebrowFit?.size, headlineFit?.size, urlFit?.size].filter(Boolean);
  b.model.motion.enterFrom = {opacity: 1, x: 0, y: 0, scale: 1};
  const model = b.finish(content, {minTextPx: texts.length ? Math.min(...texts) : b.min.key});
  if (backdrop) {
    model.layout.drift = false;
    model.layout.bleed = content.backdrop.bleed;
  }
  return model;
}

// ---------------------------------------------------------------------------
// View

function view(model) {
  const {id, fonts} = model;
  const c = model.content;
  const kids = [];
  const backdrop = c.backdrop ? el('div', `${id}-backdrop`, abs(-model.rect.x - c.backdrop.bleed, -model.rect.y - c.backdrop.bleed, model.canvas.width + 2 * c.backdrop.bleed, model.canvas.height + 2 * c.backdrop.bleed, {background: c.backdrop.color})) : null;
  if (c.filters.length) {
    kids.push(el('svg', null, {position: 'absolute', left: 0, top: 0, width: 0, height: 0, overflow: 'hidden'}, c.filters.map(filter =>
      el('filter', filter.id, null, [el('feColorMatrix', null, null, [], {type: 'matrix', values: filter.values})], {colorInterpolationFilters: 'sRGB'})), {width: 0, height: 0, 'aria-hidden': 'true'}));
  }
  if (c.glow) {
    const G = c.glow;
    kids.push(el('div', `${id}-glow`, abs(G.x, G.y, G.size, G.size, {borderRadius: '50%', background: G.soft ? `radial-gradient(closest-side, ${G.color}38, ${G.color}14 42%, ${G.color}00 74%)` : `radial-gradient(closest-side, ${G.color}b3, ${G.color}47 42%, ${G.color}00 74%)`, opacity: 0, transformOrigin: '50% 50%', pointerEvents: 'none'})));
  }
  const imageNode = (key, box, filterId) => el('img', `${id}-${key}`, abs(box.x, box.y, box.width, box.height, {objectFit: 'contain', opacity: 0,
    transformOrigin: '50% 50%', ...(filterId ? {filter: `url(#${filterId})`} : {})}), [], {src: box.src, alt: ''});
  if (c.eyebrow) kids.push(text(`${id}-eyebrow`, abs(0, c.eyebrow.y, model.rect.width, undefined, {textAlign: 'center', fontFamily: fonts.meta, fontSize: c.eyebrow.size, lineHeight: '1.3', letterSpacing: '0.16em', color: c.eyebrow.color, opacity: 0}), c.eyebrow.text));
  if (c.mark) kids.push(imageNode('mark', c.mark, c.markTint ? `${id}-mark-tint` : null));
  if (c.wordmark) {
    // The wordmark slides out from behind its left edge (a clip) as it fades in.
    const W = c.wordmark;
    kids.push(el('div', null, abs(W.x, W.y, W.width, W.height, {overflow: 'hidden'}), [
      el('img', `${id}-wordmark`, abs(0, 0, W.width, W.height, {objectFit: 'contain', opacity: 0, ...(c.tint ? {filter: `url(#${id}-tint)`} : {})}), [], {src: W.src, alt: ''})
    ]));
  }
  if (c.headline) kids.push(el('div', `${id}-headline`, abs(c.headline.x, c.headline.y, c.headline.width, undefined, {margin: 0, textAlign: 'center', fontFamily: fonts.display, fontSize: c.headline.size, lineHeight: '1.08', color: c.ink, opacity: 0}), [c.headline.text]));
  if (c.badge) kids.push(imageNode('badge', c.badge, null));
  if (c.url) {
    const U = c.url;
    kids.push(el('div', `${id}-url`, abs(U.x, U.y, U.width, U.height, {boxSizing: 'border-box', borderRadius: U.radius, background: U.fill, color: U.ink, fontFamily: fonts.body, fontWeight: 700,
      fontSize: U.size, lineHeight: `${U.height}px`, textAlign: 'center', whiteSpace: 'nowrap', opacity: 0, transformOrigin: '50% 50%', boxShadow: `0 ${14 * model.unit}px ${40 * model.unit}px #00000066`}), [U.text]));
    kids.push(el('div', `${id}-url-ring`, abs(U.x, U.y, U.width, U.height, {boxSizing: 'border-box', borderRadius: U.radius, border: `${3 * model.unit}px solid ${U.fill}`, opacity: 0, transformOrigin: '50% 50%'})));
  }
  // Bands of light above everything, faded at both ends so they read as light, not as a card.
  const fade = 'linear-gradient(0deg, transparent, #000 28%, #000 72%, transparent)';
  for (const S of c.sweeps) {
    kids.push(el('div', `${id}-${S.key}`, abs(S.x, S.y, S.width, S.height, {background: `linear-gradient(90deg, ${c.light}00, ${c.light}${S.alpha} 50%, ${c.light}00)`,
      WebkitMaskImage: fade, maskImage: fade, mixBlendMode: c.lightBlend, opacity: 0, transformOrigin: '50% 50%', pointerEvents: 'none'})));
  }
  if (!backdrop) return kids;
  // A light card: the backdrop first, then everything else in one group that
  // pushes in slowly. The light passes behind the artwork here: over dark
  // type on a light card it would read as a smudge.
  const defs = kids.filter(kid => kid.tag === 'svg');
  const bands = new Set(c.sweeps.map(S => `${id}-${S.key}`));
  const rest = kids.filter(kid => kid.tag !== 'svg' && !bands.has(kid.id)), light = kids.filter(kid => bands.has(kid.id));
  const glowAt = rest.findIndex(kid => kid.id === `${id}-glow`) + 1;
  return [backdrop, ...defs, el('div', `${id}-group`, abs(0, 0, model.rect.width, model.rect.height, {transformOrigin: `${c.push.origin.x}px ${c.push.origin.y}px`}), [...rest.slice(0, glowAt), ...light, ...rest.slice(glowAt)])];
}

// ---------------------------------------------------------------------------
// Timeline

function timeline(model, ops) {
  const {id, start, end} = model;
  const c = model.content, rise = c.rise;
  if (c.push) {
    set(ops, `${id}-group`, start, {x: 0, y: 0, scaleX: 1, scaleY: 1});
    tw(ops, `${id}-group`, start, rt(end - start), 'none', {scaleX: 1, scaleY: 1}, {scaleX: c.push.scale, scaleY: c.push.scale});
  }
  if (c.glow) {
    const at = c.beats[0].time, g = `${id}-glow`;
    set(ops, g, start, {opacity: 0, x: 0, y: 0, scaleX: 0.55, scaleY: 0.55});
    tw(ops, g, at, c.bloom * 0.7, c.fadeEase, {opacity: 0}, {opacity: 1});
    tw(ops, g, at, c.bloom, c.enterEase, {scaleX: 0.55, scaleY: 0.55}, {scaleX: 1, scaleY: 1});
    // Then it keeps widening, linearly, until the scene ends.
    if (end - at - c.bloom > 0.05) tw(ops, g, rt(at + c.bloom), rt(end - at - c.bloom), 'none', {scaleX: 1, scaleY: 1}, {scaleX: 1.18, scaleY: 1.18});
  }
  for (const S of c.sweeps) {
    const s = `${id}-${S.key}`;
    set(ops, s, start, {opacity: 0, x: 0, y: 0, rotation: 16, scaleX: 1, scaleY: 1});
    tw(ops, s, S.time, S.duration, c.enterEase, {x: 0}, {x: S.travel});
    tw(ops, s, S.time, S.duration * 0.25, c.fadeEase, {opacity: 0}, {opacity: 1});
    tw(ops, s, rt(S.time + S.duration * 0.65), S.duration * 0.35, 'power2.in', {opacity: 1}, {opacity: 0});
  }
  for (const {key, time} of c.beats) {
    if (key === 'wordmark') {
      const slide = -c.wordmark.slide;
      set(ops, `${id}-wordmark`, start, {opacity: 0, x: slide, y: 0, scaleX: 1, scaleY: 1});
      tw(ops, `${id}-wordmark`, time, c.land * 0.8, c.fadeEase, {opacity: 0}, {opacity: 1});
      tw(ops, `${id}-wordmark`, time, c.land * 1.3, c.enterEase, {x: slide}, {x: 0});
      continue;
    }
    const target = `${id}-${key}`;
    // The mark and the pill scale up into place; text and the badge rise.
    // The headline, the biggest type, rises furthest.
    const from = key === 'mark' ? {x: 0, y: rise * 1.5, scaleX: 0.6, scaleY: 0.6} : key === 'url' ? {x: 0, y: 0, scaleX: 0.86, scaleY: 0.86} : {x: 0, y: key === 'headline' ? rise * 2 : rise, scaleX: 1, scaleY: 1};
    set(ops, target, start, {opacity: 0, ...from});
    tw(ops, target, time, c.land * 0.6, c.fadeEase, {opacity: 0}, {opacity: 1});
    tw(ops, target, time, c.land, c.enterEase, from, {x: 0, y: 0, scaleX: 1, scaleY: 1});
  }
  const url = c.beats.find(beat => beat.key === 'url');
  if (url) {
    // One soft ring pulse once the pill has landed.
    const ring = `${id}-url-ring`, pulse = rt(url.time + c.land);
    set(ops, ring, start, {opacity: 0, scaleX: 1, scaleY: 1});
    tw(ops, ring, pulse, 0.08, 'none', {opacity: 0}, {opacity: 0.7});
    tw(ops, ring, rt(pulse + 0.08), 0.9, 'power2.out', {opacity: 0.7, scaleX: 1, scaleY: 1}, {opacity: 0, scaleX: 1.12, scaleY: 1.5});
  }
}

export const brandLockup = {
  id: 'brand-lockup',
  describe: 'Title or end card built from the brand\'s own artwork: the logo mark beside or above the wordmark image, an optional eyebrow and headline; the end variant stacks them over a badge image (e.g. an app-store badge) and a URL pill. Hides captions.',
  params: {
    variant: 'title|end (default title)',
    layout: 'row|stack (mark beside or above the wordmark; default row for title, stack for end)',
    mark: '"assets/…" square logo image (.svg|.png|.jpg|.webp), or {src, ratio}',
    wordmark: '"assets/…" wide wordmark image, or {src, ratio: width ÷ height (default 4)}; mark or wordmark is required',
    tint: 'none|paper|ink|primary|accent|#rrggbb — recolour the wordmark, e.g. paper for a dark wordmark on a dark background (default none)',
    markTint: 'the same for the mark (default none)',
    eyebrow: 'string ≤ 40, small caps above the lockup (optional)',
    headline: 'string ≤ 80, two lines at most, below the lockup (optional)',
    badge: 'end only: "assets/…" badge image, or {src, ratio (default 3, an app-store badge)}',
    url: 'end only: URL or handle ≤ 64, no spaces, in a pill',
    glow: 'primary|accent|false — the soft light that blooms behind the mark and keeps widening (default primary)',
    shine: 'true|false — soft light: a sweep across the card as the mark lands, and a glint across the mark and wordmark once they have (default true)',
    background: 'paper|#rrggbb — a light card: the whole scene in one colour, the artwork in its own colours (no tint), text in ink, a slow push-in instead of the hold drift (default none: the story background)',
    sfx: 'the one sound as the mark lands, a cue name (default "whoosh-soft"), or false; a hit with its own cue on this scene replaces it',
    at: `first beat (${at}; default 0.15 s)`,
    stagger: 'seconds between beats (default 0.35, scaled by the grammar)'
  },
  events: ['mark', 'wordmark', 'eyebrow', 'headline', 'badge', 'url', 'shine'],
  timing: timingRules({rules: [`elements land in this order: mark, wordmark, eyebrow, headline, badge, url, stagger apart (default ${T.stagger} s), the first at ${T.mark} s; a hit on one moves the defaults after it`]}),
  resolve,
  view,
  timeline
};

// Catalogue B module `end-card`: the library of endings (docs/END_CARDS_RFC.md).
// Registered in kit/core/catalog-b.mjs; conventions are documented there.
//
// An ending is action × ground × layout × dress. `params.layout` names one of
// the layouts in kit/core/end-card-layouts-*.mjs, or is left out and picked by
// pickEndCard() from what the ending has to say, what it sits on, the logo and
// the seed. Every layout is dressed in the brand's fonts and colours, and
// draws the logo by its measured class (tone, see-through or boxed):
//
//   native  shown as supplied (it already reads on the ground)
//   tint    every opaque pixel recoloured (alpha kept), paper or ink
//   plate   shown whole on a tile (a boxed logo, or an unmeasured one)
//   color   recoloured to a named colour by the layout (a knockout in a block)
//
// Layouts build with the kit below (ground, text, logo, scrim, …) and give
// each element a motion; the timeline here turns those into the shared op
// list, so both renderers animate the same way. Footage layouts sit over the
// last shot (track 2): with params.still (the last frame as an image) they
// hold it and push in, without it the shot keeps playing under them.

import {createBase, fitText, isUrlish, r2, rt, textWidth, contrastRatio, timingRules} from './catalog-b-base.mjs';
import {abs, el, set, tw} from './catalog-b-view.mjs';
import {grammarEase, grammarStagger} from './grammar.mjs';
import {TYPE_LAYOUTS} from './end-card-layouts-type.mjs';
import {BRAND_LAYOUTS} from './end-card-layouts-brand.mjs';
import {FOOTAGE_LAYOUTS} from './end-card-layouts-footage.mjs';
import {GRAPHIC_LAYOUTS} from './end-card-layouts-graphic.mjs';
import {LOOP_LAYOUTS} from './end-card-layouts-loop.mjs';

export const END_CARD_LAYOUTS = Object.freeze([...TYPE_LAYOUTS, ...BRAND_LAYOUTS, ...FOOTAGE_LAYOUTS, ...GRAPHIC_LAYOUTS, ...LOOP_LAYOUTS]);
const BY_ID = Object.fromEntries(END_CARD_LAYOUTS.map(layout => [layout.id, layout]));
export const END_CARD_ACTIONS = Object.freeze(['url', 'keyword', 'follow', 'save', 'subscribe', 'download', 'visit', 'book', 'launch', 'loop']);
export const END_CARD_GROUNDS = Object.freeze(['card', 'paper', 'split', 'footage']);
export const END_CARD_TAGS = Object.freeze(['calm', 'loud', 'editorial', 'playful', 'premium', 'technical']);
const TEXT_FIELDS = {headline: 80, emphasis: 40, url: 48, handle: 32, keyword: 16, offer: 60, reason: 60, next: 60, date: 16, place: 40, slot: 32, app: 28, hook: 70, issue: 12, rating: 3};
const HEX6 = /^#[0-9a-fA-F]{6}$/;

// Beats (seconds from the scene start): arrive, land, ask; how long an element takes to land.
export const END_CARD_TIMING = Object.freeze({first: 0.1, stagger: 0.28, land: 0.62});
const T = END_CARD_TIMING;

// ---------------------------------------------------------------------------
// Picking a layout

function hashSeed(value) {
  let h = 2166136261;
  for (const ch of String(value)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** The logo's class for fitting: 'none', 'boxed', or `${tone}-clear`; unmeasured counts as boxed (it goes on a plate). */
export function logoClass(logo) {
  if (!logo) return 'none';
  if (logo.clear !== true || !['dark', 'light', 'mixed'].includes(logo.tone)) return 'boxed';
  return `${logo.tone}-clear`;
}

/** A layout's content fits: every `needs` field, and one of each `needsAny` group. */
const fits = (layout, have) => layout.needs.every(field => have.has(field)) && (layout.needsAny ?? []).every(group => group.some(field => have.has(field)));

/** The fields a layout can fill from: a layout fits when every `needs` field is present. */
const present = fields => new Set(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== '').map(([key]) => key));

/**
 * Layouts that fit: the action, the grounds this video has (footage when it
 * has a shot under the ending), the logo, the aspect and the content.
 * → [{id, weight}] with the style's tags and recent endings weighed in.
 */
export function endCardCandidates({action, footage = false, onFootage = false, logo = null, aspect = '9:16', fields = {}, tags = [], avoid = []} = {}) {
  // onFootage: the scene's own plate is footage, so only a layout drawn on footage alone lets it show (else any that fits).
  if (onFootage) {
    const over = endCardCandidates({action, footage: true, logo, aspect, fields, tags, avoid}).filter(entry => BY_ID[entry.id].grounds.every(ground => ground === 'footage'));
    if (over.length) return over;
  }
  const have = present(fields), cls = logoClass(logo);
  return END_CARD_LAYOUTS.filter(layout => (!action || layout.actions.includes(action) || layout.actions.includes('any'))
    && (footage || !layout.grounds.every(ground => ground === 'footage'))
    && (!layout.logo || layout.logo.includes(cls))
    && (!layout.aspects || layout.aspects.includes(aspect))
    && fits(layout, have))
    .map(layout => {
      let weight = 1 + layout.tags.filter(tag => tags.includes(tag)).length;
      // Over footage, the ending that stays in the video comes first.
      if (footage && layout.grounds.includes('footage')) weight *= 2;
      const recent = avoid.indexOf(layout.id);
      if (recent >= 0) weight *= recent < 2 ? 0.02 : 0.25;
      return {id: layout.id, weight};
    });
}

/** One layout id for this ending, the same for the same inputs and seed; null when nothing fits. */
export function pickEndCard(options = {}) {
  const list = endCardCandidates(options);
  if (!list.length) return null;
  const total = list.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = (hashSeed(options.seed ?? 'end-card') % 100000) / 100000 * total;
  for (const entry of list) { roll -= entry.weight; if (roll < 0) return entry.id; }
  return list.at(-1).id;
}

// ---------------------------------------------------------------------------
// Model

function image(check, value, path, fallbackRatio) {
  if (typeof value === 'string') return {src: check.asset(value, path), ratio: fallbackRatio};
  check.obj(value, path, ['src', 'ratio', 'tone', 'clear', 'box'], ['src']);
  const out = {src: check.asset(value.src, `${path}.src`), ratio: value.ratio === undefined ? fallbackRatio : check.num(value.ratio, `${path}.ratio`, 0.2, 12)};
  if (value.tone !== undefined) out.tone = check.oneOf(value.tone, `${path}.tone`, ['dark', 'light', 'mixed']);
  if (value.clear !== undefined) out.clear = check.bool(value.clear, `${path}.clear`);
  if (value.box !== undefined) {
    if (typeof value.box !== 'string' || !HEX6.test(value.box)) check.fail(`${path}.box`, 'must be a six-digit hex colour (the logo\'s own background)');
    out.box = value.box.toLowerCase();
  }
  return out;
}

// feColorMatrix values that paint every pixel `hex`, keeping its alpha.
function tintMatrix(hex) {
  const [r, g, b] = [1, 3, 5].map(i => Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 1e4) / 1e4);
  return `0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 1 0`;
}

const isDarkHex = hex => hex === 'footage' || contrastRatio('#ffffff', hex) >= contrastRatio('#000000', hex);

/** How a logo is drawn on `ground` (a hex, or 'footage'): {mode, color?}. */
export function logoTreatment(logo, ground, colors) {
  if (!logo) return {mode: 'none'};
  const cls = logoClass(logo), dark = isDarkHex(ground);
  if (cls === 'boxed') return {mode: 'plate'};
  if (cls === 'dark-clear') return dark ? {mode: 'tint', color: colors.paper} : {mode: 'native'};
  if (cls === 'light-clear') return dark ? {mode: 'native'} : {mode: 'tint', color: colors.ink};
  return {mode: 'tint', color: dark ? colors.paper : colors.ink};
}

function resolve(params, ctx) {
  const allowed = ['layout', 'action', ...Object.keys(TEXT_FIELDS), 'logo', 'still', 'badges', 'avoid', 'seed', 'at', 'stagger'];
  const b = createBase('end-card', params, ctx, {allowed, hidesCaptions: true});
  const {check, u, rect, id, start, colors, canvas} = b;
  const p = b.params;

  const fields = {};
  for (const [key, max] of Object.entries(TEXT_FIELDS)) if (p[key] !== undefined) fields[key] = check.str(p[key], `params.${key}`, max);
  if (fields.url && /\s/.test(fields.url)) check.fail('params.url', 'must not contain spaces');
  if (fields.handle && /\s/.test(fields.handle)) check.fail('params.handle', 'must not contain spaces');
  if (fields.keyword) {
    if (!/^[\p{L}\p{N}-]+$/u.test(fields.keyword)) check.fail('params.keyword', 'must be one word (the word viewers comment)');
    fields.keyword = fields.keyword.toUpperCase();
  }
  if (fields.emphasis && !(fields.headline ?? '').includes(fields.emphasis)) check.fail('params.emphasis', 'must be words of params.headline (set in italic)');
  const logo = p.logo === undefined ? null : image(check, p.logo, 'params.logo', 1);
  const still = p.still === undefined ? null : image(check, p.still, 'params.still', canvas.width / canvas.height);
  const badges = p.badges === undefined ? [] : (Array.isArray(p.badges) && p.badges.length <= 2 ? p.badges.map((badge, i) => image(check, badge, `params.badges[${i}]`, 3)) : check.fail('params.badges', 'must be a list of one or two badge images'));
  const avoid = p.avoid === undefined ? [] : (Array.isArray(p.avoid) ? p.avoid.map((value, i) => check.oneOf(value, `params.avoid[${i}]`, Object.keys(BY_ID))) : check.fail('params.avoid', 'must be a list of layout ids (the endings used recently)'));
  const action = p.action === undefined ? null : check.oneOf(p.action, 'params.action', END_CARD_ACTIONS);
  const stagger = p.stagger === undefined ? grammarStagger(ctx.grammar, T.stagger, {min: 0.15, max: 0.6}) : check.num(p.stagger, 'params.stagger', 0.1, 0.8);
  const firstRel = p.at === undefined ? T.first : check.num(p.at, 'params.at', 0, 1.5);

  // The layout: stated, else the style's choice, else picked.
  const styled = ctx.variants && typeof ctx.variants === 'object' ? ctx.variants['end-card'] : undefined;
  let layoutId = p.layout ?? (BY_ID[styled] ? styled : undefined);
  if (layoutId === undefined) {
    layoutId = pickEndCard({action, footage: !!still || ctx.footage === true || !!ctx.base, onFootage: ctx.footage === true && !still, logo, aspect: b.portrait ? '9:16' : '16:9', fields: {...fields, logo, still, badges: badges.length ? badges : undefined},
      tags: Array.isArray(ctx.tags) ? ctx.tags : [], avoid, seed: p.seed ?? `${id}:${colors.primary}:${fields.headline ?? fields.url ?? ''}`});
    if (!layoutId) check.fail('params', `no end-card layout fits ${action ? `action "${action}"` : 'this ending'} with these fields; set params.layout or add a headline, url or handle`);
  }
  const layout = BY_ID[layoutId] ?? check.fail('params.layout', `must be one of ${Object.keys(BY_ID).join(', ')}`);
  const have = present({...fields, logo, still, badges: badges.length ? badges : undefined});
  const missing = layout.needs.filter(field => !have.has(field));
  if (missing.length) check.fail(`params.${missing[0]}`, `is required by layout "${layout.id}" (it needs ${layout.needs.join(', ')})`);
  const group = (layout.needsAny ?? []).find(options => !options.some(field => have.has(field)));
  if (group) check.fail(`params.${group[0]}`, `or ${group.slice(1).map(field => `params.${field}`).join(' or ')} is required by layout "${layout.id}"`);

  // ---- the kit a layout builds with (geometry is rect-local px)
  const W = rect.width, H = rect.height;
  const full = {x: r2(-rect.x), y: r2(-rect.y), width: canvas.width, height: canvas.height};
  const nodes = [], motions = [], filters = new Map(), keyText = [];
  const beat = index => rt(start + firstRel + index * stagger);
  const readable = (hex, prefer) => {
    const options = [prefer, colors.paper, colors.ink, '#ffffff', '#000000'].filter(Boolean);
    return options.find(c => contrastRatio(c, hex === 'footage' ? '#151515' : hex) >= 4.5) ?? options.find(c => contrastRatio(c, hex === 'footage' ? '#151515' : hex) >= 3) ?? '#ffffff';
  };
  const k = {
    id, W, H, full, u, colors, fonts: b.fonts, fields, logo, still, badges, portrait: b.portrait, canvas, rect,
    beat, land: T.land, duration: b.duration,
    on: readable,
    tintFilter(hex) {
      const fid = `${id}-tint-${hex.slice(1)}`;
      if (!filters.has(fid)) filters.set(fid, tintMatrix(hex));
      return `url(#${fid})`;
    },
    node(tag, key, style, children, attrs, motion) {
      const nodeId = key ? `${id}-${key}` : null;
      nodes.push(el(tag, nodeId, style, children, attrs));
      if (motion && nodeId) motions.push({target: nodeId, ...motion});
      return nodeId;
    },
    motion(key, motion) { motions.push({target: `${id}-${key}`, ...motion}); },
    /** A full-bleed ground: a colour, or the still (held, pushing in) / nothing (live footage). → the ground for contrast. */
    ground(kind, color) {
      if (kind === 'footage') {
        if (still) {
          k.node('div', 'still', abs(full.x, full.y, full.width, full.height, {overflow: 'hidden'}), [
            el('img', `${id}-still-img`, abs(0, 0, full.width, full.height, {objectFit: 'cover', transformOrigin: '50% 50%'}), [], {src: still.src, alt: ''})
          ]);
          motions.push({target: `${id}-still-img`, kind: 'push'});
        }
        return 'footage';
      }
      const hex = color ?? (kind === 'paper' ? colors.paper : colors.bg);
      k.node('div', null, abs(full.x, full.y, full.width, full.height, {background: hex}));
      return hex;
    },
    /** The still, blurred deep as a colour field (or the brand bg when there is none). */
    blurGround() {
      if (!still) return k.ground('card');
      k.node('div', null, abs(full.x, full.y, full.width, full.height, {overflow: 'hidden', background: colors.bg}), [
        el('img', null, abs(-full.width * 0.15, -full.height * 0.15, full.width * 1.3, full.height * 1.3, {objectFit: 'cover', filter: `blur(${r2(48 * b.unit)}px) saturate(1.2)`}), [], {src: still.src, alt: ''})
      ]);
      k.node('div', null, abs(full.x, full.y, full.width, full.height, {background: '#00000040'}));
      return 'footage';
    },
    /** A dark gradient from one side (to top | to bottom | to right | to left), so type reads on footage. */
    scrim(direction = 'to top', alpha = 0.88, reach = 0.75) {
      const a = Math.round(alpha * 255).toString(16).padStart(2, '0'), m = Math.round(alpha * 0.55 * 255).toString(16).padStart(2, '0');
      k.node('div', null, abs(full.x, full.y, full.width, full.height, {background: `linear-gradient(${direction}, #08090a${a} 0%, #08090a${m} ${Math.round(reach * 60)}%, #08090a00 ${Math.round(reach * 100)}%)`}));
    },
    /** Fit `value` without drawing it: → {size, lines, height, width}. */
    measure(value, {width = W, family = 'display', preferred = 96, min, maxLines = 2, lineHeight = 1.05, upper = false, spacing = 0, meta = false, key = 'text'} = {}) {
      const shown = upper ? value.toUpperCase() : value;
      const fit = fitText(check, `params (${key})`, shown, {family, width, preferred: u(preferred), min: min ?? (meta ? b.min.meta : b.min.key), maxLines, spacing});
      return {size: fit.size, lines: fit.lines, rows: fit.rows, height: r2(fit.lines * fit.size * lineHeight), width: r2(Math.min(width, textWidth(shown, fit.size, family, spacing) * 1.02))};
    },
    /** Count a size drawn by hand toward the key-text floor. */
    keyText(size) { keyText.push(size); },
    hasLogo: !!logo,
    // The logo's data ({src, ratio, tone, clear, box}); k.logo is the drawing method.
    logoInfo: logo,
    logoClass: logoClass(logo),
    /** Fit `value` and place it: → {key, size, lines, height, width}. key text counts toward the 44 px floor. */
    text(key, value, {x = 0, y = 0, width = W, family = 'display', preferred = 96, min, maxLines = 2, lineHeight = 1.05, color = colors.paper, align = 'left', weight, upper = false, spacing = 0, italic = false, meta = false, style = {}} = {}, motion = {kind: 'rise'}) {
      const shown = upper ? value.toUpperCase() : value;
      const fit = k.measure(value, {width, family, preferred, min, maxLines, lineHeight, upper, spacing, meta, key});
      if (!meta) keyText.push(fit.size);
      const family_ = b.fonts[family] ?? b.fonts.body;
      const height = fit.height;
      // A URL is set line by line as measured (shrunk to fit, else broken after a "/"), never wrapped by the browser mid-word.
      const url = shown.split(/\s+/).some(isUrlish);
      const children = url ? fit.rows.map(row => el('span', null, {display: 'block'}, [row]))
        : italic && fields.emphasis && value.includes(fields.emphasis)
        ? (() => { const at = shown.indexOf(upper ? fields.emphasis.toUpperCase() : fields.emphasis), e = shown.slice(at, at + fields.emphasis.length); return [shown.slice(0, at), el('em', null, {fontStyle: 'italic'}, [e]), shown.slice(at + e.length)].filter(part => part !== ''); })()
        : [shown];
      k.node('div', key, abs(r2(x), r2(y), r2(width), undefined, {margin: 0, fontFamily: family_, fontSize: fit.size, lineHeight: String(lineHeight), color, textAlign: align,
        ...(spacing ? {letterSpacing: `${spacing}em`} : {}), ...(weight ? {fontWeight: weight} : {}), whiteSpace: maxLines === 1 || url ? 'nowrap' : 'normal', textWrap: 'balance', transformOrigin: align === 'center' ? '50% 50%' : '0% 50%', ...style}), children, undefined, motion);
      return {key, size: fit.size, lines: fit.lines, height, width: fit.width};
    },
    /**
     * The logo at height h, placed by its left (align left), centre or right
     * edge at x; on `ground` for its treatment, or `force` ({mode:'color', color} | {mode:'plate'}).
     * → {width, height} of what was drawn, or null without a logo.
     */
    logo(key, {x, y, h, align = 'left', ground, force, maxWidth} = {}, motion = {kind: 'rise'}) {
      if (!logo) return null;
      let height = h, width = h * logo.ratio;
      if (maxWidth && width > maxWidth) { width = maxWidth; height = width / logo.ratio; }
      const treat = force ?? logoTreatment(logo, ground, colors);
      const pad = treat.mode === 'plate' ? r2(height * 0.28) : 0;
      const outerW = r2(width + pad * 2), outerH = r2(height + pad * 2);
      const left = align === 'center' ? x - outerW / 2 : align === 'right' ? x - outerW : x;
      const filter = treat.mode === 'tint' || treat.mode === 'color' ? k.tintFilter(treat.color) : undefined;
      const img = el('img', null, abs(pad, pad, r2(width), r2(height), {objectFit: 'contain', ...(filter ? {filter} : {})}), [], {src: logo.src, alt: ''});
      k.node('div', key, abs(r2(left), r2(y), outerW, outerH, {transformOrigin: '50% 50%', ...(treat.mode === 'plate' ? {background: logo.box ?? colors.paper, borderRadius: r2(height * 0.14)} : {})}), [img], undefined, motion);
      k.treatments.push(treat.mode);
      return {width: outerW, height: outerH, x: r2(left)};
    },
    treatments: [],
    event(name, time, role = 'beat', cue) { b.events.push({id: `${id}-${name}`, name, time: rt(time), role, ...(cue ? {cue} : {})}); },
    fail: (path, message) => check.fail(path, message)
  };

  const ground = layout.build(k);
  const content = {layout: layout.id, family: layout.family, ground: ground ?? null, logo: k.treatments[0] ?? 'none', action, nodes, motions,
    filters: [...filters].map(([fid, values]) => ({id: fid, values})),
    beats: {first: firstRel, stagger}, enterEase: grammarEase(ctx.grammar, 'power3.out', {props: ['y', 'scaleX']}), fadeEase: grammarEase(ctx.grammar, 'power2.out', {props: ['opacity']}), land: T.land, rise: r2(u(34))};
  if (!b.events.some(event => event.name === 'ask')) {
    const last = motions.reduce((at, m) => Math.max(at, m.beat === undefined ? at : beat(m.beat)), start);
    k.event('ask', Math.min(last, b.lastEvent + start), 'emphasis', 'pop');
  }
  for (const event of b.events) if (event.time > b.motion.exitStart) event.time = b.motion.exitStart;
  b.model.motion.enterFrom = {opacity: 1, x: 0, y: 0, scale: 1};
  return b.finish(content, {minTextPx: keyText.length ? Math.min(...keyText) : b.min.key});
}

// ---------------------------------------------------------------------------
// View

function view(model) {
  const c = model.content;
  const kids = [];
  if (c.filters.length) {
    kids.push(el('svg', null, {position: 'absolute', left: 0, top: 0, width: 0, height: 0, overflow: 'hidden'}, c.filters.map(filter =>
      el('filter', filter.id, null, [el('feColorMatrix', null, null, [], {type: 'matrix', values: filter.values})], {colorInterpolationFilters: 'sRGB'})), {width: 0, height: 0, 'aria-hidden': 'true'}));
  }
  return [...kids, ...c.nodes];
}

// ---------------------------------------------------------------------------
// Timeline: each element's motion → ops. Eases go slow, fast, slow; nothing overshoots.
//
//   rise    fade up and rise into place (the default)
//   fade    opacity only
//   scale   fade and grow from 0.86 (pills, tiles)
//   wipe    revealed left to right by a clip
//   bar     a bar that wipes across and away (reveals what is under it)
//   stamp   slams down from 1.5× at its rotation
//   draw    an SVG stroke draws on (the path has pathLength 100)
//   type    the text types on, one character at a time (m.text)
//   push    a slow push-in over the whole scene (the held frame)
//   spin    turns slowly over the whole scene
//   ticker  scrolls left (or right) forever (m.distance, m.reverse)
//   blink   a cursor blinking
//   count   the text steps through m.values

function timeline(model, ops) {
  const {start, end} = model;
  const c = model.content, rise = c.rise, land = c.land;
  for (const m of c.motions) {
    const at = m.beat === undefined ? start : rt(Math.max(start, beatTime(model, m.beat) + (m.offset ?? 0)));
    const r = m.rotation ?? 0;
    switch (m.kind) {
      case 'fade':
        set(ops, m.target, start, {opacity: 0});
        tw(ops, m.target, at, land * 0.8, c.fadeEase, {opacity: 0}, {opacity: m.to ?? 1});
        break;
      case 'scale': {
        const from = {x: 0, y: 0, scaleX: 0.86, scaleY: 0.86, rotation: r};
        set(ops, m.target, start, {opacity: 0, ...from});
        tw(ops, m.target, at, land * 0.5, c.fadeEase, {opacity: 0}, {opacity: 1});
        tw(ops, m.target, at, land, c.enterEase, from, {x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: r});
        break;
      }
      case 'wipe':
        set(ops, m.target, start, {clipR: 100});
        tw(ops, m.target, at, land * 1.2, 'power3.inOut', {clipR: 100}, {clipR: 0});
        break;
      case 'bar':
        set(ops, m.target, start, {clipR: 100, clipL: 0});
        tw(ops, m.target, at, land * 0.7, 'power3.inOut', {clipR: 100}, {clipR: 0});
        tw(ops, m.target, rt(at + land * 0.7), land * 0.7, 'power3.inOut', {clipL: 0}, {clipL: 100});
        break;
      case 'stamp': {
        const from = {x: 0, y: 0, scaleX: 1.5, scaleY: 1.5, rotation: r};
        set(ops, m.target, start, {opacity: 0, ...from});
        tw(ops, m.target, at, 0.12, 'power1.out', {opacity: 0}, {opacity: 1});
        tw(ops, m.target, at, 0.38, 'power3.in', from, {x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: r});
        break;
      }
      case 'draw':
        set(ops, m.target, start, {strokeDashoffset: 100});
        tw(ops, m.target, at, m.duration ?? 1, 'power2.inOut', {strokeDashoffset: 100}, {strokeDashoffset: 0});
        break;
      case 'type': {
        const value = String(m.text), per = Math.min(0.06, 1 / Math.max(1, value.length));
        // Starts from the first character, hidden: an empty string does not seek back cleanly in GSAP.
        set(ops, m.target, start, {text: value.slice(0, 1), opacity: 0});
        set(ops, m.target, at, {opacity: 1});
        for (let i = 2; i <= value.length; i++) set(ops, m.target, rt(at + (i - 1) * per), {text: value.slice(0, i)});
        break;
      }
      case 'push':
        set(ops, m.target, start, {scaleX: 1, scaleY: 1});
        tw(ops, m.target, start, rt(end - start), 'sine.inOut', {scaleX: 1, scaleY: 1}, {scaleX: 1.06, scaleY: 1.06});
        break;
      case 'spin':
        set(ops, m.target, start, {rotation: 0});
        tw(ops, m.target, start, rt(end - start), 'none', {rotation: 0}, {rotation: m.degrees ?? 40});
        break;
      case 'ticker': {
        const d = m.distance, from = {x: m.reverse ? -d : 0}, to = {x: m.reverse ? 0 : -d};
        set(ops, m.target, start, from);
        ops.push({type: 'loop', target: m.target, start, cycle: m.cycle ?? 6, repeats: Math.ceil((end - start) / (m.cycle ?? 6)) + 1, from, to});
        break;
      }
      case 'blink':
        set(ops, m.target, start, {opacity: 1});
        for (let t = at + 0.5, on = false; t < end; t += 0.5, on = !on) set(ops, m.target, rt(t), {opacity: on ? 1 : 0});
        break;
      case 'count': {
        const values = m.values;
        set(ops, m.target, start, {text: values[0]});
        values.slice(1).forEach((value, i) => set(ops, m.target, rt(at + (i + 1) * (m.step ?? 0.08)), {text: value}));
        break;
      }
      default: { // rise
        const from = {x: m.dx ?? 0, y: m.dy ?? rise, scaleX: 1, scaleY: 1, rotation: r};
        set(ops, m.target, start, {opacity: 0, ...from});
        tw(ops, m.target, at, land * 0.6, c.fadeEase, {opacity: 0}, {opacity: 1});
        tw(ops, m.target, at, land, c.enterEase, from, {x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: r});
      }
    }
  }
}

// Beat i's absolute time, as the resolver placed it (kept on the model so the timeline needs no params).
function beatTime(model, index) {
  return rt(model.start + model.content.beats.first + index * model.content.beats.stagger);
}

export const endCard = {
  id: 'end-card',
  describe: 'The ending, from a library of designed end cards (docs/END_CARDS_RFC.md): a layout (or one picked from the action, the ground, the logo and the seed) dressed in the brand\'s fonts, colours and logo, which is tinted, plated or recoloured so it reads. Over footage it holds params.still or lets the shot play under it. Hides captions.',
  params: {
    layout: `one of ${END_CARD_LAYOUTS.map(layout => layout.id).join(', ')} (default: picked from the action, the ground, the logo and the seed)`,
    action: `${END_CARD_ACTIONS.join('|')} — what the ending asks for; narrows the pick`,
    headline: 'string ≤ 80, the closing line', emphasis: 'words of the headline set in italic (optional)',
    url: 'address ≤ 48, no spaces', handle: '@handle ≤ 32', keyword: 'one word viewers comment (shown in capitals)', offer: 'what they get for it ≤ 60',
    reason: 'why follow ≤ 60', next: 'the next video\'s title ≤ 60', date: 'launch or event date ≤ 16', place: 'where ≤ 40', slot: 'the booking action ≤ 32',
    app: 'app name ≤ 28', hook: 'the video\'s opening line, for loop endings ≤ 70', issue: 'issue or episode number ≤ 12', rating: 'stars, e.g. "4.8"',
    logo: '"assets/…" or {src, ratio, tone: dark|light|mixed, clear: see-through?, box: "#rrggbb"} (tone and clear are measured when the story is read)',
    still: '"assets/…" the last frame as an image: footage layouts hold it; without it the shot plays under the ending',
    badges: 'download: one or two store badge images (handed in)',
    avoid: 'layout ids used by recent videos; the pick avoids them',
    seed: 'string or number for the pick (default: from the scene and brand)',
    at: 'first beat, seconds from the scene start (default 0.1)', stagger: 'seconds between beats (default 0.28, scaled by the grammar)'
  },
  events: ['enter', 'ask'],
  timing: timingRules({rules: ['elements land beat by beat, stagger apart (default 0.28 s), the ask (the action) last; holds until the scene ends']}),
  resolve,
  view,
  timeline
};

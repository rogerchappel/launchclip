// The brand frame (docs/VIDEO_QUALITY_RFC.md §9.2): a kicker (the logo, a
// short label and its underline), section labels and an optional progress
// line, drawn by the compilers around scenes rather than by each module, so
// a whole video hangs together. story.frame holds it (a style's brand_frame
// fills it, kit/core/style.mjs applyStyle).
//
// brandFramePlan() returns the same plan shape as a caption plan
// (kit/core/captions.mjs): a DOM tree of nodes, static CSS and a GSAP tween
// list. HyperFrames mounts it with brandFrameRuntime(); Remotion's BrandFrame
// evaluates each tween from the frame alone with captionElementStateAt. So
// one plan, two renderers, no drift.
//
// brandFrameSafe() is the area modules may use without colliding with the
// frame: {x, y, width, height} in canvas px, the same shape as layout-check's
// profileGeometry().safeZone (resolveModule attaches it as model.frame.safe;
// footage layout panels intersect their own panel rect with it).
//
// frameColorSpans() lets the frame follow what is behind it: one colour for
// the whole video disappears when a scene's backdrop is close to it (paper
// text on a cast set's cream wall). Per track-0 scene it keeps frame.color
// while that reaches FRAME_MIN_CONTRAST against the scene's backdrop, else
// takes the brand colour with the most contrast; a frame.labels entry's
// `color` overrides it while that label shows. The changes are colour tweens
// in the same plan, so both renderers switch on the same frame.
//
// Canonical copy: kit/core/brand-frame.mjs.

import { profileGeometry } from './layout-check.mjs';
import { storyBase, storyChapters } from './story.mjs';
import { brandFontStacks } from './fonts.mjs';
import { contrastRatio } from './catalog-b-base.mjs';
import { setColors } from './characters/sets.mjs';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const HEX = /^#[0-9a-fA-F]{6}$/;
const ROLE_FALLBACK = Object.freeze({ bg: '#000000', paper: '#ffffff', ink: '#0b0b0f', primary: '#ffd23f', accent: '#46d4ff' });
const r2 = (value) => Math.round(value * 100) / 100;
const r4 = (value) => Math.round(value * 10000) / 10000;

// Sizes at k = 1 (the short side is 1080 px).
export const BRAND_FRAME_METRICS = Object.freeze({ label: 30, section: 24, logo: 40, gap: 12, underline: 4, underlineGap: 10, band: 78, progress: 6 });

/** A hex colour, else a brand role (`value`, then `role`), else the role's fallback. */
function color(value, brand, role) {
  for (const candidate of [value, brand?.colors?.[value], brand?.colors?.[role]]) if (typeof candidate === 'string' && HEX.test(candidate)) return candidate.toLowerCase();
  return ROLE_FALLBACK[role] ?? '#ffffff';
}

const part = (value, defaults) => (value === false ? null : { ...defaults, ...(isObject(value) ? value : {}) });

/**
 * The frame in force for a story: null when it has none (no frame, frame:
 * false or enabled: false), else {kicker, sections, progress, show, logo,
 * color} with defaults filled and the kicker label falling back to a short
 * story title.
 */
export function storyFrame(story) {
  const frame = story?.frame;
  if (!isObject(frame) || frame.enabled === false) return null;
  const kicker = part(frame.kicker ?? true, { underline: true, position: 'top-left', logo: true });
  if (kicker && !nonEmpty(kicker.label) && nonEmpty(story.title) && story.title.trim().length <= 32) kicker.label = story.title.trim();
  if (kicker && !nonEmpty(kicker.label) && !(kicker.logo !== false && nonEmpty(frame.logo))) kicker.empty = true;
  const sections = part(frame.sections ?? true, { position: kicker?.position === 'top-right' ? 'top-left' : 'top-right' });
  const progress = part(frame.progress ?? false, { position: 'bottom' });
  return {
    kicker: kicker && !kicker.empty ? kicker : null,
    sections,
    progress: frame.progress === true || isObject(frame.progress) ? progress : null,
    show: frame.show === 'scenes' ? 'scenes' : 'always',
    logo: nonEmpty(frame.logo) ? frame.logo : null,
    color: frame.color ?? 'paper',
    labels: Array.isArray(frame.labels) ? frame.labels : []
  };
}

/**
 * Section labels on the timeline: [{start, end, label}], sorted, from
 * frame.labels (seconds or a scene's start), else the story's chapters.
 */
export function frameLabels(story, frame = storyFrame(story)) {
  if (!frame?.sections) return [];
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration) || 0;
  const scenes = new Map((story?.scenes ?? []).map((scene) => [scene?.id, scene]));
  const entries = frame.labels.length ? frame.labels : storyChapters(story).map((chapter) => ({ start: chapter.start, label: chapter.title.slice(0, 40) }));
  const starts = entries.map((entry) => {
    const start = typeof entry.start === 'number' ? entry.start : Number(scenes.get(entry.scene)?.start);
    return Number.isFinite(start) && start >= 0 && start < duration && nonEmpty(entry.label) ? { start, label: entry.label.trim(), ...(typeof entry.color === 'string' ? { color: entry.color } : {}) } : null;
  }).filter(Boolean).sort((a, b) => a.start - b.start);
  return starts.map((entry, i) => ({ ...entry, end: i + 1 < starts.length ? starts[i + 1].start : duration }));
}

const isTop = (position) => String(position).startsWith('top');

/**
 * Frame geometry for a canvas: the kicker and section-label rects, the
 * progress line, and the safe area left for modules. → null when the story has
 * no frame.
 */
export function brandFrameLayout(story, format = story?.format) {
  const frame = storyFrame(story);
  if (!frame) return null;
  const canvas = { width: Number(format?.width), height: Number(format?.height) };
  const zone = profileGeometry(canvas).safeZone;
  const k = Math.min(canvas.width, canvas.height) / 1080;
  const M = BRAND_FRAME_METRICS;
  const band = M.band * k;
  const corner = (position, width) => ({
    x: r2(String(position).endsWith('left') ? zone.x : zone.x + zone.width - width),
    y: r2(isTop(position) ? zone.y : zone.y + zone.height - band),
    width: r2(width),
    height: r2(band)
  });
  // The kicker and labels claim up to half the safe width each.
  const half = zone.width / 2 - M.gap * k;
  const regions = [];
  if (frame.kicker) regions.push({ id: 'frame-kicker', rect: corner(frame.kicker.position, half) });
  const labels = frameLabels(story, frame);
  if (frame.sections && labels.length) regions.push({ id: 'frame-section', rect: corner(frame.sections.position, half) });
  let top = zone.y, bottom = zone.y + zone.height;
  for (const region of regions) {
    if (region.rect.y <= zone.y + 1e-6) top = Math.max(top, region.rect.y + region.rect.height);
    else bottom = Math.min(bottom, region.rect.y);
  }
  const thickness = (isObject(frame.progress) && typeof frame.progress.thickness === 'number' ? frame.progress.thickness : M.progress) * k;
  // Chapter ticks: a mark on the progress line at each chapter start after the first.
  const duration = Number(story?.resolved?.duration ?? format?.duration) || 0;
  const ticks = frame.progress && frame.progress.ticks !== false && duration > 0 ? storyChapters(story).slice(1).map((chapter) => r4(chapter.start / duration)) : [];
  const progress = frame.progress ? { position: frame.progress.position === 'top' ? 'top' : 'bottom', thickness: r2(thickness), ticks } : null;
  if (progress) {
    const edge = progress.position === 'top' ? thickness : canvas.height - thickness;
    if (progress.position === 'top') top = Math.max(top, edge);
    else bottom = Math.min(bottom, edge);
  }
  return { frame, k, zone, regions, labels, progress, safe: { x: r2(zone.x), y: r2(top), width: r2(zone.width), height: r2(Math.max(0, bottom - top)) } };
}

/** The area modules may draw in without colliding with the frame, or null when the story has no frame. */
export function brandFrameSafe(story, format = story?.format) {
  return brandFrameLayout(story, format)?.safe ?? null;
}

/** The overlap of two {x, y, width, height} rects (null when either is missing; zero size when they do not meet). */
export function intersectRects(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}

/** Time windows the frame shows in: the whole video, or (show: "scenes") each run of scenes. */
export function frameWindows(story, frame = storyFrame(story)) {
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration) || 0;
  if (!frame) return [];
  if (frame.show !== 'scenes') return [[0, duration]];
  const spans = (story?.scenes ?? []).map((scene) => [Number(scene.start), Number(scene.end)]).filter(([a, b]) => Number.isFinite(a) && b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of spans) {
    const last = out.at(-1);
    if (last && a <= last[1] + 0.05) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

// Contrast the frame's text keeps against a scene's backdrop (WCAG large-text
// AA), and the lower bar for its marks (underline, section dots, ticks).
export const FRAME_MIN_CONTRAST = 3;
export const FRAME_MARK_CONTRAST = 1.6;
const FRAME_ROLES = ['ink', 'bg', 'paper', 'primary', 'accent'];

/**
 * The colour behind the frame's bands during a scene: a cast set's wall, the
 * brand background behind a plate (or a footage-led insert), or null over
 * the recording (unknown: the frame keeps its colour and shadow there).
 */
export function frameBackdrop(scene, story) {
  const brand = story?.brand ?? {};
  if (scene?.module === 'cast-scene') return setColors(Object.fromEntries(FRAME_ROLES.map((role) => [role, color(role, brand, role)]))).wall;
  if (storyBase(story) && scene?.insert !== true) return null;
  return color('bg', brand, 'bg');
}

/**
 * The frame's colours over time: [{start, backdrop, text, underline, dot}],
 * one entry per change (the first at 0). A single entry means the frame never
 * changes colour.
 */
export function frameColorSpans(story, frame = storyFrame(story)) {
  if (!frame) return [];
  const brand = story?.brand ?? {};
  const roles = FRAME_ROLES.map((role) => color(role, brand, role));
  const base = { text: color(frame.color, brand, 'paper'), underline: color(frame.kicker?.color, brand, 'primary'), dot: color(frame.sections?.color, brand, 'accent') };
  const best = (backdrop) => roles.reduce((top, hex) => (contrastRatio(hex, backdrop) > contrastRatio(top, backdrop) ? hex : top), roles[0]);
  const keep = (hex, backdrop, min) => (!backdrop || contrastRatio(hex, backdrop) >= min ? hex : null);
  const scenes = (story?.scenes ?? []).filter((scene) => (scene?.track ?? 0) === 0 && Number.isFinite(Number(scene?.start)) && Number(scene?.end) > Number(scene?.start))
    .map((scene) => ({ start: Number(scene.start), end: Number(scene.end), backdrop: frameBackdrop(scene, story) })).sort((a, b) => a.start - b.start);
  const labels = frameLabels(story, frame).filter((entry) => entry.color);
  const times = [...new Set([0, ...scenes.map((scene) => scene.start), ...labels.flatMap((entry) => [entry.start, entry.end])])].filter((t) => t >= 0).sort((a, b) => a - b);
  const spans = [];
  for (const t of times) {
    const scene = scenes.filter((entry) => entry.start <= t + 1e-6).at(-1) ?? scenes[0] ?? null;
    const backdrop = scene?.backdrop ?? null;
    const label = labels.find((entry) => entry.start <= t + 1e-6 && t < entry.end - 1e-6);
    const text = label ? color(label.color, brand, 'paper') : keep(base.text, backdrop, FRAME_MIN_CONTRAST) ?? best(backdrop);
    const state = { backdrop, text, underline: keep(base.underline, backdrop, FRAME_MARK_CONTRAST) ?? text, dot: keep(base.dot, backdrop, FRAME_MARK_CONTRAST) ?? text };
    const last = spans.at(-1);
    if (last && last.text === state.text && last.underline === state.underline && last.dot === state.dot) continue;
    spans.push({ start: r4(t), ...state });
  }
  if (spans.length && (spans[0].text !== base.text || spans[0].underline !== base.underline || spans[0].dot !== base.dot)) spans.unshift({ start: 0, backdrop: null, ...base, initial: true });
  return spans;
}

/**
 * The frame plan for a resolved story: {css, nodes, tweens, layout} or null.
 * Tweens follow the caption plan rules: per element and property only the
 * first may render immediately, and a `to` always follows an earlier tween.
 */
export function brandFramePlan(story, { format = story?.format } = {}) {
  const layout = brandFrameLayout(story, format);
  if (!layout) return null;
  const { frame, k, regions, labels, progress } = layout;
  const brand = story?.brand ?? {};
  const fonts = brandFontStacks(brand);
  const M = BRAND_FRAME_METRICS;
  const ink = color(frame.color, brand, 'paper');
  const nodes = [];
  const tweens = [];
  const tw = (id, at, dur, ease, to, from, ir) => tweens.push({ id, at: r4(Math.max(0, at)), dur: r4(dur), ease, to, ...(from ? { from } : {}), ...(from && ir ? { ir: true } : {}) });
  const px = (value) => `${r2(value)}px`;
  const place = (rect, position) => {
    const side = String(position).endsWith('left') ? `left: ${px(rect.x)};` : `left: ${px(rect.x)}; justify-content: flex-end;`;
    return `${side} top: ${px(rect.y)}; width: ${px(rect.width)}; height: ${px(rect.height)};`;
  };
  const css = [
    '.lc-frame { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; opacity: 0; }',
    '.lc-frame-corner { position: absolute; display: flex; align-items: center; }',
    `.lc-frame-text { color: ${ink}; text-shadow: 0 2px 10px rgba(0,0,0,.45); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`
  ];

  const root = { tag: 'div', id: 'lc-frame', cls: 'lc-frame', children: [] };
  nodes.push(root);
  frameWindows(story, frame).forEach(([start, end], i) => {
    tw('lc-frame', start, 0.4, 'power2.out', { opacity: 1 }, { opacity: 0 }, i === 0);
    if (end < Number(story?.resolved?.duration ?? format?.duration ?? end) - 1e-3) tw('lc-frame', Math.max(start + 0.4, end - 0.3), 0.3, 'power1.in', { opacity: 0 });
  });

  const kickerRegion = regions.find((region) => region.id === 'frame-kicker');
  if (frame.kicker && kickerRegion) {
    const underline = color(frame.kicker.color, brand, 'primary');
    css.push(`.lc-frame-kicker { ${place(kickerRegion.rect, frame.kicker.position)} }`);
    css.push(`.lc-frame-kicker-inner { position: relative; display: inline-flex; align-items: center; gap: ${px(M.gap * k)}; max-width: 100%; padding-bottom: ${px((M.underline + M.underlineGap) * k)}; }`);
    css.push(`.lc-frame-logo { height: ${px(M.logo * k)}; width: auto; display: block; flex: none; }`);
    css.push(`.lc-frame-label { font: 700 ${px(M.label * k)}/1.1 ${fonts.body}; letter-spacing: 0.01em; }`);
    css.push(`.lc-frame-underline { position: absolute; left: 0; right: 0; bottom: 0; height: ${px(M.underline * k)}; border-radius: ${px(M.underline * k)}; background: ${underline}; transform-origin: 0% 50%; transform: scaleX(0); }`);
    const inner = { tag: 'div', id: 'lc-frame-kicker-inner', cls: 'lc-frame-kicker-inner', children: [] };
    if (frame.logo && frame.kicker.logo !== false) inner.children.push({ tag: 'img', id: 'lc-frame-logo', cls: 'lc-frame-logo', src: frame.logo });
    if (nonEmpty(frame.kicker.label)) inner.children.push({ tag: 'span', id: 'lc-frame-label', cls: 'lc-frame-text lc-frame-label', text: frame.kicker.label.trim() });
    if (frame.kicker.underline !== false) {
      inner.children.push({ tag: 'div', id: 'lc-frame-underline', cls: 'lc-frame-underline' });
      tw('lc-frame-underline', 0.25, 0.6, 'power3.out', { scaleX: 1 }, { scaleX: 0 }, true);
    }
    root.children.push({ tag: 'div', id: 'lc-frame-kicker', cls: 'lc-frame-corner lc-frame-kicker', children: [inner] });
  }

  const sectionRegion = regions.find((region) => region.id === 'frame-section');
  if (sectionRegion) {
    const tint = color(frame.sections.color, brand, 'accent');
    css.push(`.lc-frame-section { ${place(sectionRegion.rect, frame.sections.position)} }`);
    css.push(`.lc-frame-sec { position: absolute; display: flex; align-items: center; gap: ${px(M.gap * 0.75 * k)}; ${String(frame.sections.position).endsWith('left') ? 'left: 0;' : 'right: 0;'} top: 0; height: 100%; max-width: 100%; opacity: 0; font: 600 ${px(M.section * k)}/1.1 ${fonts.meta}; letter-spacing: 0.04em; }`);
    css.push(`.lc-frame-dot { width: ${px(10 * k)}; height: ${px(10 * k)}; border-radius: 50%; background: ${tint}; flex: none; }`);
    const holder = { tag: 'div', id: 'lc-frame-section', cls: 'lc-frame-corner lc-frame-section', children: [] };
    labels.forEach((entry, i) => {
      const id = `lc-frame-sec-${String(i + 1).padStart(2, '0')}`;
      holder.children.push({ tag: 'div', id, cls: 'lc-frame-sec', children: [{ tag: 'span', id: `${id}-dot`, cls: 'lc-frame-dot' }, { tag: 'span', id: `${id}-t`, cls: 'lc-frame-text', text: entry.label }] });
      tw(id, entry.start, 0.35, 'power2.out', { opacity: 1, y: 0 }, { opacity: 0, y: 10 * k }, true);
      if (entry.end - entry.start > 0.6 && i + 1 < labels.length) tw(id, entry.end - 0.2, 0.2, 'power1.in', { opacity: 0 });
    });
    root.children.push(holder);
  }

  if (progress) {
    const fill = color(isObject(frame.progress) ? frame.progress.color : undefined, brand, 'primary');
    const duration = Number(story?.resolved?.duration ?? format?.duration) || 1;
    css.push(`.lc-frame-progress { position: absolute; left: 0; right: 0; ${progress.position}: 0; height: ${px(progress.thickness)}; background: ${ink}33; }`);
    css.push(`.lc-frame-progress-fill { position: absolute; left: 0; top: 0; width: 100%; height: 100%; background: ${fill}; transform-origin: 0% 50%; transform: scaleX(0); }`);
    const ticks = progress.ticks.map((at, i) => ({ tag: 'div', id: `lc-frame-tick-${String(i + 1).padStart(2, '0')}`, cls: 'lc-frame-tick', style: `left: ${r2(at * 100)}%;` }));
    if (ticks.length) {
      css.push(`.lc-frame-tick { position: absolute; top: ${px(-progress.thickness)}; width: ${px(Math.max(2, progress.thickness * 0.6))}; height: ${px(progress.thickness * 3)}; margin-left: ${px(-Math.max(2, progress.thickness * 0.6) / 2)}; background: ${ink}; border-radius: ${px(progress.thickness)}; opacity: 0.85; }`);
      for (const tick of ticks) css.push(`#${tick.id} { ${tick.style} }`);
    }
    root.children.push({ tag: 'div', id: 'lc-frame-progress', cls: 'lc-frame-progress', children: [{ tag: 'div', id: 'lc-frame-progress-fill', cls: 'lc-frame-progress-fill' }, ...ticks.map(({ style, ...node }) => node)] });
    tw('lc-frame-progress-fill', 0, duration, 'none', { scaleX: 1 }, { scaleX: 0 }, true);
  }

  // Per-scene colours (frameColorSpans): a colour tween per element at each
  // change, the first a fromTo from the CSS colour (immediate only at 0).
  const spans = frameColorSpans(story, frame);
  if (spans.length > 1) {
    const ids = new Set();
    const walk = (node) => { ids.add(node.id); (node.children ?? []).forEach(walk); };
    nodes.forEach(walk);
    const targets = [
      ['text', 'color', ['lc-frame-label', ...labels.map((_, i) => `lc-frame-sec-${String(i + 1).padStart(2, '0')}-t`)]],
      ['underline', 'backgroundColor', ['lc-frame-underline']],
      ['dot', 'backgroundColor', labels.map((_, i) => `lc-frame-sec-${String(i + 1).padStart(2, '0')}-dot`)],
      ['text', 'backgroundColor', progress ? progress.ticks.map((_, i) => `lc-frame-tick-${String(i + 1).padStart(2, '0')}`) : []]
    ];
    for (const [key, prop, list] of targets) {
      for (const id of list.filter((entry) => ids.has(entry))) {
        let previous = spans[0][key], started = false;
        for (const span of spans.slice(1)) {
          if (span[key] === previous) continue;
          if (!started) tw(id, span.start, FRAME_COLOR_SWITCH, 'none', { [prop]: span[key] }, { [prop]: previous }, span.start === 0);
          else tw(id, span.start, FRAME_COLOR_SWITCH, 'none', { [prop]: span[key] });
          started = true;
          previous = span[key];
        }
      }
    }
  }

  return { css: `${css.join('\n')}\n`, nodes, tweens, layout };
}

// How long the frame's colour takes to switch at a cut (s).
export const FRAME_COLOR_SWITCH = 0.1;

/** The HyperFrames runtime for a frame plan: mountBrandFrame(tl, container) builds the nodes and adds the tweens. */
export function brandFrameRuntime(plan) {
  return `// Generated by kit/core/brand-frame.mjs. Call mountBrandFrame(tl, container)
// while building the paused root timeline; everything is created synchronously.
(function () {
  var NODES = ${JSON.stringify(plan.nodes).replace(/</g, '\\u003c')};
  var TWEENS = ${JSON.stringify(plan.tweens)};
  function build(node, parent) {
    var el = document.createElement(node.tag || 'div');
    if (node.id) el.id = node.id;
    if (node.cls) el.className = node.cls;
    if (node.src) { el.src = node.src; el.alt = ''; }
    if (node.text != null) el.appendChild(document.createTextNode(node.text));
    (node.children || []).forEach(function (child) { build(child, el); });
    parent.appendChild(el);
  }
  window.mountBrandFrame = function (tl, container) {
    NODES.forEach(function (node) { build(node, container); });
    TWEENS.forEach(function (w) {
      var el = document.getElementById(w.id);
      if (!el) return;
      var to = Object.assign({}, w.to, { duration: w.dur, ease: w.ease, force3D: false });
      if (w.from) {
        if (!w.ir) to.immediateRender = false;
        tl.fromTo(el, Object.assign({}, w.from), to, w.at);
      } else tl.to(el, to, w.at);
    });
  };
})();
`;
}

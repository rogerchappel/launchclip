// Unified module registry: scene → resolved model, for editorial kinds and
// catalogue modules alike. Both compilers (kit/hyperframes/story-compiler.mjs
// and kit/remotion/StoryComposition.tsx) and the parity harness call
// resolveModule(), so a scene resolves to the same model in both renderers.
// Plain ESM; imports only sibling kit/core files. Contract:
// docs/KIT_CONTRACTS.md, "Unified module registry".
//
// Canonical copy: kit/core/modules.mjs.

import { EDITORIAL_KINDS, resolveEditorialModule } from './editorial-core.mjs';
import { fontStack } from './fonts.mjs';
import { MODULES as CATALOG_A } from './catalog-a.mjs';
import { MODULES as CATALOG_B } from './catalog-b.mjs';

const EDITORIAL_CANVAS = { '9:16': { width: 1080, height: 1920 }, '16:9': { width: 1920, height: 1080 } };
const DOM_ID = /^[a-z][a-z0-9-]{0,59}$/;

/** Every catalogue module definition, keyed by id (catalogue A, then B). */
export function catalogModules() {
  const merged = {};
  for (const [label, table] of [['catalog-a', CATALOG_A], ['catalog-b', CATALOG_B]]) {
    for (const [id, definition] of Object.entries(table ?? {})) {
      if (EDITORIAL_KINDS.includes(id)) throw new Error(`${label} module "${id}" collides with an editorial kind`);
      if (merged[id]) throw new Error(`${label} module "${id}" is defined twice`);
      merged[id] = definition;
    }
  }
  return merged;
}

/** Editorial kinds plus catalogue ids. */
export function knownModules() {
  return [...EDITORIAL_KINDS, ...Object.keys(catalogModules())];
}

export function isEditorialKind(id) {
  return EDITORIAL_KINDS.includes(id);
}

/** Scene id → a DOM-safe module id (scene ids may contain "_"). */
export function moduleDomId(sceneId) {
  return String(sceneId ?? '').toLowerCase().replace(/_/g, '-');
}

/** "9:16" | "16:9" | "1:1" | "4:5" | null */
export function formatAspect(format) {
  const ratio = Number(format?.width) / Number(format?.height);
  const table = [['9:16', 9 / 16], ['16:9', 16 / 9], ['1:1', 1], ['4:5', 4 / 5]];
  const match = table.find(([, value]) => Math.abs(ratio - value) / value < 0.01);
  return match ? match[0] : null;
}

/** Mix two #rrggbb colours: `amount` of `top` over `bottom`. */
export function mixHex(top, bottom, amount) {
  const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = parse(top), b = parse(bottom);
  return `#${a.map((value, i) => Math.round(value * amount + b[i] * (1 - amount)).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrastRatio(a, b) {
  const luminance = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Brand → editorial defaults ({accent?, theme?}); params set explicitly win.
 * accent = brand.colors.primary. theme = {surface: bg, foreground: paper,
 * muted: paper 62% over bg, border: paper 18% over bg, accentText}, where
 * accentText is the primary colour when it reaches 3:1 on bg, else paper.
 */
export function brandModuleDefaults(brand) {
  const colors = brand && typeof brand.colors === 'object' && brand.colors ? brand.colors : {};
  const defaults = {};
  if (HEX.test(colors.primary ?? '')) defaults.accent = colors.primary;
  if (HEX.test(colors.bg ?? '') && HEX.test(colors.paper ?? '')) {
    const accentText = HEX.test(colors.primary ?? '') && contrastRatio(colors.primary, colors.bg) >= 3 ? colors.primary : colors.paper;
    defaults.theme = { surface: colors.bg, foreground: colors.paper, muted: mixHex(colors.paper, colors.bg, 0.62), border: mixHex(colors.paper, colors.bg, 0.18), accentText };
  }
  return defaults;
}

function scenePath(scene, story) {
  const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
  let index = scenes.indexOf(scene);
  if (index < 0) index = scenes.findIndex((entry) => entry?.id === scene?.id);
  return `${index >= 0 ? `scenes[${index}]` : 'scene'}${scene?.id ? ` (${scene.id})` : ''}`;
}

/**
 * Resolve one (resolved) scene to its module model.
 * options.track: HyperFrames track index for the model root (compilers set it);
 * options.end: render-window end, when a compiler holds the scene on screen
 * through the next scene's transition (default scene.end).
 * Throws with a "scenes[i] (id)…" prefixed message on unknown modules or
 * invalid params.
 */
export function resolveModule(scene, story, { track, end } = {}) {
  const where = scenePath(scene, story);
  try {
    return resolveModuleInner(scene, story, { track, end });
  } catch (error) {
    throw new Error(`${where}: ${error.message}`);
  }
}

function resolveModuleInner(scene, story, { track, end }) {
  if (!scene || typeof scene !== 'object') throw new Error('scene must be an object');
  const id = moduleDomId(scene.id);
  if (!DOM_ID.test(id)) throw new Error(`id "${scene.id}" is not a valid module id`);
  const start = Number(scene.start);
  const finish = Number(end ?? scene.end);
  if (!Number.isFinite(start) || !Number.isFinite(finish)) throw new Error('start and end must be resolved seconds (run resolveStory first)');
  const duration = round(finish - start);
  if (!(duration > 0)) throw new Error('end must be after start');
  const params = scene.params && typeof scene.params === 'object' ? scene.params : {};
  const format = { width: story?.format?.width, height: story?.format?.height, fps: story?.resolved?.fps ?? story?.format?.fps, duration: story?.resolved?.duration ?? story?.format?.duration };
  const aspect = formatAspect(format);
  const module = scene.module;

  if (isEditorialKind(module)) {
    const canvas = EDITORIAL_CANVAS[aspect];
    if (!canvas || canvas.width !== format.width || canvas.height !== format.height) {
      throw new Error(`module "${module}": editorial modules need a 1080x1920 (9:16) or 1920x1080 (16:9) format; got ${format.width}x${format.height}`);
    }
    const spec = { ...brandModuleDefaults(story?.brand), ...params, id, kind: module, aspect, start, duration };
    if (track !== undefined) spec.track = track;
    let model;
    try { model = resolveEditorialModule(spec); }
    catch (error) { throw new Error(`module "${module}" params: ${error.message}`); }
    return finishModel(model, { module, scene });
  }

  const definition = catalogModules()[module];
  if (!definition) throw new Error(`module "${module}" is not a known module`);
  if (typeof definition.resolve !== 'function') throw new Error(`module "${module}" has no resolve()`);
  let model;
  try { model = definition.resolve(params, { id, start, duration, format, brand: story?.brand ?? {}, aspect, hits: Array.isArray(scene.hits) ? scene.hits : [] }); }
  catch (error) { throw new Error(`module "${module}" params: ${error.message}`); }
  if (!model || typeof model !== 'object') throw new Error(`module "${module}" resolve() returned no model`);
  const finished = finishModel(model, { module, scene });
  if (track !== undefined) finished.track = track;
  return finished;
}

function finishModel(model, { module, scene }) {
  model.module = model.module ?? module;
  model.sceneId = scene.id;
  if (typeof model.hidesCaptions !== 'boolean') model.hidesCaptions = false;
  return model;
}

// Placeholder for a scene whose module is unknown, invalid, or has no emitter
// or component in a renderer. Both renderers draw it from this model and
// PLACEHOLDER_STYLE, so a missing module is equally visible in each.
export const PLACEHOLDER_STYLE = Object.freeze({
  surface: '#1b1d24', foreground: '#f7f7f8', muted: '#c4c7cf', border: '#ff5a36', borderWidth: 4, radius: 24,
  labelSize: 52, detailSize: 28, padding: 40, fontFamily: fontStack(null, 'body')
});

export function placeholderModel(scene, story, reason = '', { end } = {}) {
  const width = Number(story?.format?.width ?? 1080), height = Number(story?.format?.height ?? 1920);
  const start = Number(scene?.start ?? 0), finish = Number(end ?? scene?.end ?? start + 1);
  // The scene's own params.rect when it declares one (so the placeholder
  // occupies the intended footprint), else a safe-zone box.
  const declared = scene?.params?.rect;
  const valid = declared && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(declared[key])) && declared.width >= 200 && declared.height >= 120;
  const x = Math.round(width * 0.08);
  const rect = valid ? { x: declared.x, y: declared.y, width: declared.width, height: declared.height } : { x, y: Math.round(height * 0.3), width: width - 2 * x, height: Math.round(height * 0.3) };
  const still = { opacity: 1, x: 0, y: 0, scale: 1 };
  const S = PLACEHOLDER_STYLE;
  return {
    id: moduleDomId(scene?.id ?? 'scene'), module: scene?.module ?? null, sceneId: scene?.id ?? null, placeholder: true,
    canvas: { width, height }, start, duration: round(finish - start), end: finish, rect,
    motion: { enterStart: start, enterEnd: start, exitStart: finish, end: finish, enterFrom: still, exitTo: still, enterEase: 'none', exitEase: 'none' },
    content: { label: `Missing module: ${scene?.module ?? '(none)'}`, detail: String(reason ?? '').slice(0, 240) },
    events: [], layout: { canvas: { width, height }, rect, motion: { enterEnd: start, exitStart: finish, end: finish } },
    hidesCaptions: false, theme: { surface: S.surface, foreground: S.foreground, muted: S.muted, border: S.border, accentText: S.border }
  };
}

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

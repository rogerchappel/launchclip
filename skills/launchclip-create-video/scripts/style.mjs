// Style pack v2 (launchclip.style.v2): a channel's reusable look and feel —
// palette and bundled fonts, motion grammar, camera, ambient motion, caption
// preset, sound density and music hints, module preferences and defaults,
// layout rules, an optional intro/outro and loop — merged into a storyboard by
// applyStyle(). Explicit story values always win; the pack fills gaps.
//
// Pure ESM that imports only its kit/core siblings, so the merge is identical
// in the CLI, the renderer adapters, the eval and the skills. File lookup
// (project, home, built-in) lives in src/style_store.js. See
// docs/KIT_CONTRACTS.md ("Style pack v2").
//
// Canonical copy: kit/core/style.mjs.

import { CAPTION_PRESET_NAMES } from './captions.mjs';
import { FONT_REGISTRY, fontFamilyName, registeredFamily } from './fonts.mjs';

export const STYLE_SCHEMA = 'launchclip.style.v2';
export const STYLE_V1_SCHEMA = 'launchclip.style-pack.v1';
export const STYLE_SFX_DENSITIES = Object.freeze(['low', 'normal', 'high']);
export const STYLE_AMBIENT_LEVELS = Object.freeze(['off', 'subtle', 'standard', 'lively']);
export const STYLE_GRAMMARS = Object.freeze(['editorial', 'snappy', 'smooth', 'playful', 'documentary', 'cinematic']);
export const STYLE_COLOR_ROLES = Object.freeze(['bg', 'paper', 'ink', 'primary', 'accent']);
const HEX = /^#[0-9a-fA-F]{6}$/;
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const TOP = new Set(['schema', 'name', 'description', 'brand', 'motion', 'camera', 'ambient', 'captions', 'sound', 'modules', 'layout', 'intro', 'outro', 'loop', 'references', 'reference_stats', 'notes', 'created_at', 'upgraded_from']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const clone = (value) => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------------------
// Colour maths

export function hexToRgb(hex) {
  const value = String(hex).replace('#', '');
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
}

export function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG relative luminance of a hex colour. */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours (1–21). */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** {h: 0–360, s: 0–1, l: 0–1} of a hex colour. */
export function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToHex({ h, s, l }) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

/** Lighten or darken a colour until it reaches `min` contrast against `against` (or gives up). */
export function ensureContrast(hex, against, min) {
  if (contrastRatio(hex, against) >= min) return hex;
  const hsl = hexToHsl(hex);
  const up = luminance(against) < 0.4;
  for (let step = 1; step <= 40; step += 1) {
    const candidate = hslToHex({ ...hsl, l: Math.max(0, Math.min(1, hsl.l + (up ? 1 : -1) * step * 0.02)) });
    if (contrastRatio(candidate, against) >= min) return candidate;
  }
  return up ? '#ffffff' : '#000000';
}

/** Euclidean distance between two colours in RGB, normalised to 0–1. */
export function colorDistance(a, b) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return Math.sqrt(x.reduce((sum, c, i) => sum + (c - y[i]) ** 2, 0)) / (255 * Math.sqrt(3));
}

/**
 * Palette roles from weighted colour clusters [{hex, weight}] (weights sum ≈ 1):
 * bg = the dominant cluster; paper = the cluster with most contrast against bg
 * (text); ink = the darkest of bg/paper; primary = the most saturated, weighted
 * cluster that is not bg or paper; accent = the next saturated cluster with a
 * clearly different hue. Text and primary are pushed to readable contrast.
 * → {colors: {bg, paper, ink, primary, accent}, confidence: {role: 0–1}, notes: []}
 */
export function assignPaletteRoles(clusters) {
  const list = (clusters ?? []).filter((entry) => HEX.test(entry?.hex)).map((entry) => ({ hex: entry.hex.toLowerCase(), weight: Number(entry.weight) || 0 })).sort((a, b) => b.weight - a.weight);
  const notes = [];
  if (!list.length) return { colors: { bg: '#0b0b0f', paper: '#f5f3ee', ink: '#0b0b0f', primary: '#ffd23f', accent: '#46d4ff' }, confidence: { bg: 0, paper: 0, ink: 0, primary: 0, accent: 0 }, notes: ['no colours sampled; defaults used'] };
  const bg = list[0];
  const rest = list.slice(1);
  // Text: a near-neutral colour with strong contrast (captions and copy are
  // rarely saturated); saturated colours only when nothing neutral reads.
  const textScore = (entry) => contrastRatio(entry.hex, bg.hex) * (hexToHsl(entry.hex).s < 0.35 ? 1.6 : 1) * (entry.weight >= 0.002 ? 1 : 0.6);
  const textCandidates = rest.filter((entry) => entry.weight >= 0.0005).sort((a, b) => textScore(b) - textScore(a));
  let paper = textCandidates[0]?.hex ?? (luminance(bg.hex) < 0.4 ? '#f5f3ee' : '#111111');
  const paperFound = contrastRatio(paper, bg.hex);
  if (paperFound < 4.5) {
    notes.push(`text colour ${paper} has ${paperFound.toFixed(2)}:1 against the background; raised to 4.5:1`);
    paper = ensureContrast(paper, bg.hex, 4.5);
  }
  const ink = luminance(bg.hex) <= luminance(paper) ? bg.hex : paper;
  const chroma = (entry) => { const { s, l } = hexToHsl(entry.hex); return s * (1 - Math.abs(l - 0.5) * 1.2) * Math.sqrt(entry.weight + 0.002); };
  const vivid = rest.filter((entry) => entry.hex !== paper && colorDistance(entry.hex, bg.hex) > 0.12 && hexToHsl(entry.hex).s > 0.18).sort((a, b) => chroma(b) - chroma(a));
  let primary = vivid[0]?.hex ?? null;
  if (!primary) { primary = luminance(bg.hex) < 0.4 ? '#ffd23f' : '#d63a1f'; notes.push('no saturated colour found; primary is a neutral default'); }
  const primaryContrast = contrastRatio(primary, bg.hex);
  if (primaryContrast < 3) { notes.push(`primary ${primary} has ${primaryContrast.toFixed(2)}:1 against the background; adjusted to 3:1`); primary = ensureContrast(primary, bg.hex, 3); }
  const hueGap = (a, b) => { const d = Math.abs(hexToHsl(a).h - hexToHsl(b).h) % 360; return d > 180 ? 360 - d : d; };
  let accent = vivid.slice(1).find((entry) => hueGap(entry.hex, primary) > 40)?.hex ?? null;
  if (!accent) {
    const hsl = hexToHsl(primary);
    accent = hslToHex({ h: (hsl.h + 150) % 360, s: Math.max(0.55, hsl.s), l: Math.min(0.62, Math.max(0.45, hsl.l)) });
    notes.push('no second distinct hue found; accent is the primary rotated 150°');
  }
  accent = ensureContrast(accent, bg.hex, 3);
  const share = (hex) => list.find((entry) => entry.hex === hex)?.weight ?? 0;
  return {
    colors: { bg: bg.hex, paper, ink, primary, accent },
    confidence: {
      bg: Math.min(1, 0.4 + bg.weight),
      paper: paperFound >= 4.5 ? Math.min(1, 0.5 + share(paper) * 5) : 0.35,
      ink: 0.6,
      primary: vivid[0] ? Math.min(0.95, 0.4 + share(vivid[0].hex) * 6) : 0.15,
      accent: vivid.slice(1).some((entry) => entry.hex === accent) ? Math.min(0.85, 0.3 + share(accent) * 6) : 0.2
    },
    notes
  };
}

/** Contrast findings for a pack's palette: text 4.5:1, primary and accent 3:1 against bg. */
export function checkPackContrast(pack) {
  const colors = pack?.brand?.colors ?? {};
  const findings = [];
  const check = (a, b, min) => {
    if (!HEX.test(colors[a] ?? '') || !HEX.test(colors[b] ?? '')) return;
    const ratio = contrastRatio(colors[a], colors[b]);
    findings.push({ pair: `${a}/${b}`, ratio: Math.round(ratio * 100) / 100, min, ok: ratio >= min });
  };
  check('paper', 'bg', 4.5);
  check('primary', 'bg', 3);
  check('accent', 'bg', 3);
  if (colors.ink && colors.ink !== colors.bg) check('ink', 'paper', 3);
  check('ink', 'primary', 3);
  return findings;
}

// ---------------------------------------------------------------------------
// Fonts

// Common families → the nearest bundled family by role and shape. LaunchClip
// never downloads or copies a reference's fonts; it suggests a registry family.
const NEAREST_FONT = [
  [/bebas|oswald|anton|impact|league gothic|teko|barlow condensed|fjalla|condensed|compressed/i, 'Anton'],
  [/archivo black|montserrat black|poppins black|black|heavy|ultra/i, 'Archivo Black'],
  [/unbounded|druk wide|wide|extended|clash|monument/i, 'Unbounded'],
  [/syne|grotesk display|editorial new/i, 'Syne'],
  [/bricolage|cooper|recoleta|playful|rounded|nunito|quicksand/i, 'Bricolage Grotesque'],
  [/space grotesk|dm sans|manrope|satoshi|general sans|outfit|sora|grotesk|geist(?! mono)/i, 'Space Grotesk'],
  [/inter|helvetica|arial|roboto|sf pro|san francisco|open sans|lato|source sans|noto sans|ibm plex sans|segoe|poppins|montserrat|work sans|sans/i, 'Inter'],
  [/mono|code|courier|consol|menlo|fira|jetbrains|plex mono|space mono|geist mono/i, 'JetBrains Mono'],
  [/instrument serif|playfair|didot|bodoni|georgia|garamond|times|caslon|serif display|dm serif|libre baskerville|baskerville|lora|merriweather|serif/i, 'Instrument Serif']
];

/** The nearest bundled family for any font name (or the role default when nothing matches). */
export function nearestBundledFont(name, role = 'body') {
  const registered = registeredFamily(fontFamilyName(name) ?? '');
  if (registered && FONT_REGISTRY[registered]) return registered;
  for (const [pattern, family] of NEAREST_FONT) if (pattern.test(String(name ?? ''))) return family;
  return role === 'display' ? 'Anton' : role === 'meta' ? 'JetBrains Mono' : 'Inter';
}

const slugOf = (family) => FONT_REGISTRY[family]?.slug ?? String(family).toLowerCase().replace(/[^a-z0-9]+/g, '-');

// ---------------------------------------------------------------------------
// Validation

/** Validate a launchclip.style.v2 pack. → {ok, errors, warnings} */
export function validateStylePack(pack, { modules } = {}) {
  const errors = [];
  const warnings = [];
  const err = (message) => errors.push(message);
  if (!isObject(pack)) return { ok: false, errors: ['style pack must be a JSON object'], warnings };
  if (pack.schema !== STYLE_SCHEMA) err(pack.schema === STYLE_V1_SCHEMA || pack.schema_version === STYLE_V1_SCHEMA ? `this is a v1 style pack; run launchclip style upgrade ${pack.name ?? '<name>'}` : `schema must be "${STYLE_SCHEMA}"`);
  if (!nonEmpty(pack.name) || !NAME.test(pack.name)) err('name must be 1-64 letters, numbers, hyphens or underscores');
  for (const key of Object.keys(pack)) if (!TOP.has(key)) warnings.push(`${key} is not a style pack v2 field and is ignored`);
  if (pack.description !== undefined && typeof pack.description !== 'string') err('description must be a string');
  if (pack.brand !== undefined) {
    if (!isObject(pack.brand)) err('brand must be an object with colors and fonts');
    else {
      if (pack.brand.colors !== undefined) {
        if (!isObject(pack.brand.colors)) err('brand.colors must be an object of hex colours');
        else for (const [role, value] of Object.entries(pack.brand.colors)) if (!HEX.test(value)) err(`brand.colors.${role} must be a six-digit hex colour`);
      }
      if (pack.brand.fonts !== undefined) {
        if (!isObject(pack.brand.fonts)) err('brand.fonts must be an object of font families');
        else for (const [role, value] of Object.entries(pack.brand.fonts)) {
          if (!nonEmpty(value)) err(`brand.fonts.${role} must be a font family name`);
          else if (!registeredFamily(fontFamilyName(value) ?? '')) warnings.push(`brand.fonts.${role} "${value}" is not a bundled family; projects must freeze its files under assets/fonts/ or the role default is drawn`);
        }
      }
    }
  }
  if (pack.motion !== undefined) {
    if (!isObject(pack.motion)) err('motion must be an object');
    else if (pack.motion.grammar !== undefined) {
      const grammar = pack.motion.grammar;
      if (typeof grammar === 'string') { if (!nonEmpty(grammar)) err('motion.grammar must be a grammar name'); else if (!STYLE_GRAMMARS.includes(grammar)) warnings.push(`motion.grammar "${grammar}" is not one of ${STYLE_GRAMMARS.join(', ')}`); }
      else if (!isObject(grammar) || !nonEmpty(grammar.base)) err('motion.grammar must be a name or {base, ...overrides}');
    }
  }
  if (pack.camera !== undefined) {
    // story.camera (kit/core/camera-world.mjs): the storyboard validator rejects other modes and layouts.
    if (!isObject(pack.camera)) err('camera must be an object');
    else {
      if (pack.camera.mode !== undefined && !['cuts', 'world'].includes(pack.camera.mode)) err('camera.mode must be cuts or world');
      if (pack.camera.layout !== undefined && !['row', 'column', 'grid', 'path', 'auto'].includes(pack.camera.layout)) err('camera.layout must be one of row, column, grid, path, auto');
    }
  }
  if (pack.ambient !== undefined) {
    if (!isObject(pack.ambient)) err('ambient must be an object');
    else if (pack.ambient.level !== undefined && !STYLE_AMBIENT_LEVELS.includes(pack.ambient.level)) err(`ambient.level must be one of ${STYLE_AMBIENT_LEVELS.join(', ')}`);
  }
  if (pack.captions !== undefined) {
    if (!isObject(pack.captions)) err('captions must be an object');
    else if (pack.captions.preset !== undefined && pack.captions.preset !== 'none' && !CAPTION_PRESET_NAMES.includes(pack.captions.preset)) err(`captions.preset must be one of ${CAPTION_PRESET_NAMES.join(', ')} or "none"`);
  }
  if (pack.sound !== undefined) {
    const sound = pack.sound;
    if (!isObject(sound)) err('sound must be an object');
    else {
      if (sound.sfx_density !== undefined && !STYLE_SFX_DENSITIES.includes(sound.sfx_density)) err(`sound.sfx_density must be one of ${STYLE_SFX_DENSITIES.join(', ')}`);
      if (sound.sfx_library !== undefined && !nonEmpty(sound.sfx_library)) err('sound.sfx_library must be a path');
      if (sound.music !== undefined) {
        if (!isObject(sound.music)) err('sound.music must be an object');
        else {
          const range = sound.music.bpm_range;
          if (range !== undefined && !(Array.isArray(range) && range.length === 2 && range.every((v) => typeof v === 'number' && v > 0 && v <= 300) && range[0] <= range[1])) err('sound.music.bpm_range must be [min, max] beats per minute');
          if (sound.music.prompt_hints !== undefined && !(Array.isArray(sound.music.prompt_hints) && sound.music.prompt_hints.every(nonEmpty)) && !nonEmpty(sound.music.prompt_hints)) err('sound.music.prompt_hints must be a string or a list of strings');
          if (sound.music.energy_curve !== undefined && !(Array.isArray(sound.music.energy_curve) && sound.music.energy_curve.every((v) => typeof v === 'number')) && !nonEmpty(sound.music.energy_curve)) err('sound.music.energy_curve must be a name or a list of numbers');
        }
      }
    }
  }
  if (pack.modules !== undefined) {
    const m = pack.modules;
    if (!isObject(m)) err('modules must be an object');
    else {
      const known = modules == null ? null : new Set(modules instanceof Set ? [...modules] : modules);
      for (const key of ['prefer', 'avoid']) {
        if (m[key] === undefined) continue;
        if (!Array.isArray(m[key]) || !m[key].every(nonEmpty)) err(`modules.${key} must be a list of module ids`);
        else if (known) for (const id of m[key]) if (!known.has(id)) warnings.push(`modules.${key}: "${id}" is not a known module`);
      }
      if (m.params !== undefined) {
        if (!isObject(m.params)) err('modules.params must be {module: {param: default}}');
        else for (const [id, params] of Object.entries(m.params)) if (!isObject(params)) err(`modules.params.${id} must be an object`);
      }
    }
  }
  if (pack.layout !== undefined) {
    if (!isObject(pack.layout)) err('layout must be an object');
    else {
      if (pack.layout.safe_profile !== undefined && !['shorts', 'landscape'].includes(pack.layout.safe_profile)) err('layout.safe_profile must be shorts or landscape');
      if (pack.layout.title_case !== undefined && typeof pack.layout.title_case !== 'boolean') err('layout.title_case must be true or false');
    }
  }
  for (const key of ['intro', 'outro']) {
    if (pack[key] === undefined) continue;
    const entry = pack[key];
    if (!isObject(entry)) { err(`${key} must be {module, params, duration}`); continue; }
    if (!nonEmpty(entry.module)) err(`${key}.module must be a module id`);
    if (entry.params !== undefined && !isObject(entry.params)) err(`${key}.params must be an object`);
    if (!(typeof entry.duration === 'number' && entry.duration > 0 && entry.duration <= 10)) err(`${key}.duration must be seconds between 0 and 10`);
  }
  if (pack.loop !== undefined && typeof pack.loop !== 'boolean') err('loop must be true or false');
  if (pack.references !== undefined && !Array.isArray(pack.references)) err('references must be a list');
  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Merge

/** {name, intro, outro, loop: boolean | null} from a story's `style` value (string or object). */
export function storyStyleRequest(story) {
  const value = story?.style;
  if (typeof value === 'string' && value.trim()) return { name: value.trim(), intro: false, outro: false, loop: null };
  if (isObject(value) && nonEmpty(value.name)) return { name: value.name.trim(), intro: value.intro === true, outro: value.outro === true, loop: typeof value.loop === 'boolean' ? value.loop : null };
  return null;
}

function usesAnchors(story) {
  const anchor = (value) => typeof value === 'string';
  for (const scene of story.scenes ?? []) {
    if (anchor(scene.start) || anchor(scene.end)) return true;
    for (const hit of scene.hits ?? []) if (anchor(hit.at)) return true;
  }
  for (const overlay of story.overlays ?? []) {
    if (anchor(overlay.start) || anchor(overlay.end)) return true;
    for (const range of overlay.hide ?? []) if (range.some(anchor)) return true;
  }
  return false;
}

function uniqueId(story, base) {
  const ids = new Set((story.scenes ?? []).map((scene) => scene.id));
  if (!ids.has(base)) return base;
  for (let i = 2; ; i += 1) if (!ids.has(`${base}-${i}`)) return `${base}-${i}`;
}

/**
 * Merge a style pack into a story. Explicit story values always win.
 * options: {intro, outro, loop} (default: the story's style object). Returns
 * {story, applied: ["brand.colors.primary", ...], warnings}. The merged story
 * carries meta.style = {name, applied}; a story that already has it is
 * returned unchanged (the merge is idempotent).
 */
export function applyStyle(story, pack, options = {}) {
  if (!isObject(story)) throw new Error('story must be a JSON object');
  if (!isObject(pack)) throw new Error('style pack must be a JSON object');
  if (isObject(story.meta?.style) && Array.isArray(story.meta.style.applied)) return { story, applied: [], warnings: [] };
  const out = clone(story);
  const applied = [];
  const warnings = [];
  const request = storyStyleRequest(story) ?? { intro: false, outro: false, loop: null };
  const wantIntro = options.intro ?? request.intro;
  const wantOutro = options.outro ?? request.outro;
  const fill = (target, source, path) => {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (target[key] === undefined) { target[key] = clone(value); applied.push(`${path}.${key}`); }
      else if (isObject(target[key]) && isObject(value)) fill(target[key], value, `${path}.${key}`);
    }
  };

  // Brand: colours and fonts per role.
  if (isObject(pack.brand)) {
    if (!isObject(out.brand)) { out.brand = {}; }
    for (const part of ['colors', 'fonts']) {
      if (!isObject(pack.brand[part])) continue;
      if (!isObject(out.brand[part])) out.brand[part] = {};
      fill(out.brand[part], pack.brand[part], `brand.${part}`);
    }
  }

  // Motion grammar, camera, ambient, layout: pass-through data filled per key.
  for (const key of ['motion', 'camera', 'ambient', 'layout']) {
    if (!isObject(pack[key])) continue;
    if (out[key] === undefined) { out[key] = clone(pack[key]); applied.push(key); }
    else if (isObject(out[key])) fill(out[key], pack[key], key);
  }

  // Captions: the pack's preset and options fill the story's captions overlay
  // (added when the story declares no overlays at all).
  if (isObject(pack.captions) && pack.captions.preset !== 'none') {
    if (out.overlays === undefined) {
      out.overlays = [{ type: 'captions', ...clone(pack.captions) }];
      applied.push('overlays[0] (captions)');
    } else if (Array.isArray(out.overlays)) {
      const index = out.overlays.findIndex((entry) => entry?.type === 'captions');
      const overlay = index >= 0 ? out.overlays[index] : null;
      if (overlay && overlay.style !== 'none' && overlay.preset !== 'none') {
        for (const [key, value] of Object.entries(pack.captions)) {
          if (key === 'preset') {
            if (overlay.preset === undefined && overlay.style === undefined) { overlay.preset = value; applied.push(`overlays[${index}].preset`); }
          } else if (overlay[key] === undefined) { overlay[key] = clone(value); applied.push(`overlays[${index}].${key}`); }
        }
      }
    }
  }

  // Sound: SFX density/library and music hints ride on audio (finish reads them).
  if (isObject(pack.sound) && out.audio !== null) {
    if (!isObject(out.audio)) out.audio = {};
    if (pack.sound.sfx_density !== undefined && out.audio.sfx_density === undefined) { out.audio.sfx_density = pack.sound.sfx_density; applied.push('audio.sfx_density'); }
    if (pack.sound.sfx_library !== undefined && out.audio.sfx_library === undefined) { out.audio.sfx_library = pack.sound.sfx_library; applied.push('audio.sfx_library'); }
    if (isObject(pack.sound.music) && out.audio.music_hints === undefined) { out.audio.music_hints = clone(pack.sound.music); applied.push('audio.music_hints'); }
  }

  // Module param defaults, per scene.
  const defaults = isObject(pack.modules?.params) ? pack.modules.params : {};
  for (const scene of Array.isArray(out.scenes) ? out.scenes : []) {
    const own = defaults[scene?.module];
    if (!isObject(own)) continue;
    if (!isObject(scene.params)) scene.params = {};
    for (const [key, value] of Object.entries(own)) {
      if (scene.params[key] === undefined) { scene.params[key] = clone(value); applied.push(`scenes.${scene.id}.params.${key}`); }
    }
  }

  // Loop: when the story declares no ending. options.loop, then the story's
  // style.loop, then the pack's loop decide; false is honoured too, written
  // as ending {loop: false} so the story says it does not loop (and its last
  // scene holds, see ending.final in story.mjs).
  const loop = typeof options.loop === 'boolean' ? options.loop : typeof request.loop === 'boolean' ? request.loop : typeof pack.loop === 'boolean' ? pack.loop : null;
  if (out.ending === undefined && loop === true && out.scenes?.[0]?.id) { out.ending = { loop_to: out.scenes[0].id }; applied.push('ending.loop_to'); }
  else if (out.ending === undefined && loop === false) { out.ending = { loop: false }; applied.push('ending.loop'); }

  // Intro/outro scenes, only when the story asks for them.
  const duration = Number(out.format?.duration);
  if (wantIntro && isObject(pack.intro)) {
    const audio = out.audio ?? {};
    if (audio.voice || audio.words || audio.narration || audio.mix || out.base) warnings.push('style intro skipped: the story has a timed voice, mix or base recording, and LaunchClip does not shift audio');
    else if (usesAnchors(out)) warnings.push('style intro skipped: the story uses word or beat anchors, which an intro cannot shift');
    else if (Number.isFinite(duration)) {
      const d = pack.intro.duration;
      for (const scene of out.scenes ?? []) {
        scene.start += d; scene.end += d;
        for (const hit of scene.hits ?? []) hit.at += d;
      }
      for (const overlay of out.overlays ?? []) {
        if (typeof overlay.start === 'number') overlay.start += d;
        if (typeof overlay.end === 'number') overlay.end += d;
        if (Array.isArray(overlay.hide)) overlay.hide = overlay.hide.map(([a, b]) => [a + d, b + d]);
      }
      const id = uniqueId(out, 'intro');
      const next = out.scenes?.[0];
      if (next && !next.in) next.in = { type: 'fade', dur: Math.min(0.4, d / 2) };
      out.scenes.unshift({ id, module: pack.intro.module, start: 0, end: d, params: clone(pack.intro.params ?? {}) });
      out.format.duration = Math.round((duration + d) * 1000) / 1000;
      applied.push(`scenes.${id} (intro)`);
    }
  }
  if (wantOutro && isObject(pack.outro)) {
    const start = Number(out.format?.duration);
    if (Number.isFinite(start)) {
      const d = pack.outro.duration;
      const id = uniqueId(out, 'outro');
      out.scenes.push({ id, module: pack.outro.module, start, end: Math.round((start + d) * 1000) / 1000, in: { type: 'fade', dur: Math.min(0.4, d / 2) }, params: clone(pack.outro.params ?? {}) });
      out.format.duration = Math.round((start + d) * 1000) / 1000;
      applied.push(`scenes.${id} (outro)`);
    }
  }

  out.meta = { ...(isObject(out.meta) ? out.meta : {}), style: { name: pack.name, applied } };
  return { story: out, applied, warnings };
}

// ---------------------------------------------------------------------------
// v1 → v2 and prompt text

/**
 * Draft a v2 pack from a v1 pack (frame.md / DESIGN.md text, optional audio
 * notes and caption skin). Hex colours and font names are read from the
 * specification; anything not found is left to the merge defaults.
 * → {pack, notes: []}
 */
export function upgradeV1Pack({ name, specification = '', audio = '', captionSkin = null } = {}) {
  const notes = [];
  const text = String(specification);
  const hexes = [...text.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((match) => ({ hex: match[0].toLowerCase(), index: match.index }));
  const roleNear = (pattern) => hexes.find((entry) => pattern.test(text.slice(Math.max(0, entry.index - 48), entry.index + 8)))?.hex;
  const counts = new Map();
  for (const entry of hexes) counts.set(entry.hex, (counts.get(entry.hex) ?? 0) + 1);
  const total = hexes.length || 1;
  const assigned = assignPaletteRoles([...counts].map(([hex, count]) => ({ hex, weight: count / total })));
  const colors = { ...assigned.colors };
  const labelled = { bg: roleNear(/background|\bbg\b|canvas|base/i), paper: roleNear(/text|foreground|paper|light/i), primary: roleNear(/primary|brand|highlight/i), accent: roleNear(/accent|secondary/i), ink: roleNear(/ink|dark|shadow/i) };
  for (const [role, hex] of Object.entries(labelled)) if (hex) colors[role] = hex;
  if (hexes.length) notes.push(`palette: ${counts.size} hex colours found in the specification; roles ${Object.entries(labelled).filter(([, hex]) => hex).map(([role]) => role).join(', ') || 'assigned by luminance and saturation'}`);
  else notes.push('palette: the specification names no hex colours; review brand.colors');
  const fonts = {};
  const fontLine = (pattern) => (text.split('\n').find((line) => pattern.test(line)) ?? '');
  const familyIn = (line) => {
    for (const family of Object.keys(FONT_REGISTRY)) if (line.toLowerCase().includes(family.toLowerCase())) return family;
    const quoted = /["'`]([A-Z][A-Za-z0-9 ]{2,40})["'`]/.exec(line)?.[1] ?? /:\s*([A-Z][A-Za-z0-9 ]{2,40})/.exec(line)?.[1];
    return quoted ? nearestBundledFont(quoted) : null;
  };
  const display = familyIn(fontLine(/display|headline|heading|title/i));
  const body = familyIn(fontLine(/body|text font|paragraph|copy/i));
  const meta = familyIn(fontLine(/mono|meta|label|code/i));
  if (display) fonts.display = slugOf(display);
  if (body) fonts.body = slugOf(body);
  if (meta) fonts.meta = slugOf(meta);
  notes.push(Object.keys(fonts).length ? `fonts: ${Object.entries(fonts).map(([role, slug]) => `${role} → ${slug}`).join(', ')} (nearest bundled families)` : 'fonts: none recognised; role defaults apply');
  const motionWords = text.toLowerCase();
  const grammar = /snappy|punchy|fast cuts|energetic/.test(motionWords) ? 'snappy' : /smooth|calm|gentle|slow/.test(motionWords) ? 'smooth' : /playful|bouncy|fun/.test(motionWords) ? 'playful' : /cinematic|filmic|ken burns/.test(motionWords) ? 'cinematic' : /documentary|archival/.test(motionWords) ? 'documentary' : 'editorial';
  const pack = {
    schema: STYLE_SCHEMA,
    name,
    description: `Upgraded from the v1 style pack ${name}.`,
    brand: { colors, ...(Object.keys(fonts).length ? { fonts } : {}) },
    motion: { grammar },
    captions: { preset: captionSkin ? 'word-highlight' : 'minimal-line' },
    sound: { sfx_density: /no sfx|minimal sound|sparse/i.test(audio) ? 'low' : /lots of sfx|dense|punchy/i.test(audio) ? 'high' : 'normal', ...(audio.trim() ? { music: { prompt_hints: [audio.trim().split('\n').find((line) => line.trim())?.trim().slice(0, 200)].filter(Boolean) } } : {}) },
    upgraded_from: STYLE_V1_SCHEMA
  };
  notes.push(`motion.grammar: ${grammar} (from the specification's wording)`);
  notes.push(captionSkin ? 'captions: the v1 caption skin (HTML) is kept in the pack for the HyperFrames route; the storyboard uses word-highlight' : 'captions: no caption skin; minimal-line');
  return { pack, notes: [...notes, ...assigned.notes] };
}

/** Planner prompt lines for a style pack (preferences, avoid list, caption preset). */
export function stylePromptLines(pack) {
  if (!isObject(pack)) return [];
  const lines = [`style pack: ${pack.name}${pack.description ? ` — ${pack.description}` : ''}`];
  lines.push('Set "style": "' + pack.name + '" at the top level. The pack fills brand, captions, motion, camera, ambient and sound; do not restate them unless the brief demands an exception.');
  if (pack.modules?.prefer?.length) lines.push(`Prefer these modules where the script allows: ${pack.modules.prefer.join(', ')}.`);
  if (pack.modules?.avoid?.length) lines.push(`Avoid these modules: ${pack.modules.avoid.join(', ')}.`);
  if (pack.captions?.preset) lines.push(`Captions use the ${pack.captions.preset} preset: write {"type": "captions"} without a style or preset.`);
  const grammar = typeof pack.motion?.grammar === 'string' ? pack.motion.grammar : pack.motion?.grammar?.base;
  if (grammar) lines.push(`Motion grammar: ${grammar}${grammar === 'snappy' ? ' (short scenes, fast push/whip transitions)' : grammar === 'smooth' || grammar === 'documentary' || grammar === 'cinematic' ? ' (longer holds, fades and slow pushes)' : ''}.`);
  if (pack.ambient?.level) lines.push(`Ambient motion level: ${pack.ambient.level}.`);
  if (pack.sound?.sfx_density) lines.push(`SFX density: ${pack.sound.sfx_density}${pack.sound.sfx_density === 'low' ? ' (cue only the biggest hits)' : pack.sound.sfx_density === 'high' ? ' (cue most hits)' : ''}.`);
  if (pack.layout?.title_case) lines.push('Write headlines and titles in Title Case.');
  if (pack.intro || pack.outro) lines.push(`The pack has ${[pack.intro ? 'an intro' : null, pack.outro ? 'an outro' : null].filter(Boolean).join(' and ')}; they are added by "style": {"name": "${pack.name}", "intro": true, "outro": true}, never authored as scenes.`);
  return lines;
}

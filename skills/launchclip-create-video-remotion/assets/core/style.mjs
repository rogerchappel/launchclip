// Style pack v3 (launchclip.style.v3): a channel's reusable look and feel —
// palette and bundled fonts, motion grammar, camera, ambient motion, caption
// preset, sound density and music hints, module preferences and defaults,
// layout rules, an optional intro/outro and loop (all from v2), plus footage
// layout rules, vocabulary choices, a cadence profile, a cast, the brand
// frame, caption defaults per lane and the four dials (docs/VIDEO_QUALITY_RFC.md
// §9) — merged into a storyboard by applyStyle(). Explicit story values
// always win; the pack fills gaps. v2 packs still load: upgradeV2Pack() fills
// the v3 fields in memory.
//
// Pure ESM that imports only its kit/core siblings, so the merge is identical
// in the CLI, the renderer adapters, the eval and the skills. File lookup
// (project, home, built-in) lives in src/style_store.js. See
// docs/KIT_CONTRACTS.md ("Style pack v2").
//
// Canonical copy: kit/core/style.mjs.

import { CAPTION_PRESET_NAMES } from './captions.mjs';
import { FONT_REGISTRY, fontFamilyName, registeredFamily } from './fonts.mjs';
import { CADENCE_PROFILE_SCHEMA, validateProfile } from './profiles.mjs';

export const STYLE_SCHEMA = 'launchclip.style.v3';
export const STYLE_V2_SCHEMA = 'launchclip.style.v2';
export const STYLE_V1_SCHEMA = 'launchclip.style-pack.v1';
export const STYLE_SFX_DENSITIES = Object.freeze(['low', 'normal', 'high']);
export const STYLE_AMBIENT_LEVELS = Object.freeze(['off', 'subtle', 'standard', 'lively']);
export const STYLE_GRAMMARS = Object.freeze(['editorial', 'snappy', 'smooth', 'playful', 'documentary', 'cinematic']);
export const STYLE_COLOR_ROLES = Object.freeze(['bg', 'paper', 'ink', 'primary', 'accent']);
const HEX = /^#[0-9a-fA-F]{6}$/;
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const TOP = new Set(['schema', 'name', 'description', 'brand', 'motion', 'camera', 'ambient', 'captions', 'sound', 'modules', 'layout', 'intro', 'outro', 'loop', 'references', 'reference_stats', 'notes', 'created_at', 'upgraded_from']);
// v3 fields (docs/VIDEO_QUALITY_RFC.md §9.1–9.3).
const TOP_V3 = new Set(['layouts', 'vocabulary', 'profile', 'cast', 'brand_frame', 'dials']);
// Footage layouts (RFC §7.1). The layouts session owns their geometry; a
// style only names them, so an unknown name is a warning, not an error.
export const STYLE_LAYOUTS = Object.freeze(['full', 'split-left', 'split-right', 'framed', 'stacked', 'insert']);
export const STYLE_PANEL_TREATMENTS = Object.freeze(['solid', 'glass', 'paper']);
export const STYLE_DIALS = Object.freeze(['energy', 'density', 'playfulness', 'polish']);
export const STYLE_CAPTION_LANES = Object.freeze(['motion', 'voiceover-motion', 'footage-led']);
export const STYLE_FRAME_POSITIONS = Object.freeze(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
export { CADENCE_PROFILE_SCHEMA };

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
  const v2 = pack.schema === STYLE_V2_SCHEMA;
  if (pack.schema !== STYLE_SCHEMA && !v2) err(pack.schema === STYLE_V1_SCHEMA || pack.schema_version === STYLE_V1_SCHEMA ? `this is a v1 style pack; run launchclip style upgrade ${pack.name ?? '<name>'}` : `schema must be "${STYLE_SCHEMA}" (or "${STYLE_V2_SCHEMA}", upgraded on load)`);
  if (!nonEmpty(pack.name) || !NAME.test(pack.name)) err('name must be 1-64 letters, numbers, hyphens or underscores');
  for (const key of Object.keys(pack)) {
    if (TOP_V3.has(key)) { if (v2) warnings.push(`${key} is a style v3 field; set schema to "${STYLE_SCHEMA}" (run launchclip style upgrade ${pack.name ?? '<name>'})`); }
    else if (!TOP.has(key)) warnings.push(`${key} is not a style pack field and is ignored`);
  }
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
    else {
      if (pack.captions.preset !== undefined && pack.captions.preset !== 'none' && !CAPTION_PRESET_NAMES.includes(pack.captions.preset)) err(`captions.preset must be one of ${CAPTION_PRESET_NAMES.join(', ')} or "none"`);
      if (pack.captions.lanes !== undefined) {
        if (!isObject(pack.captions.lanes)) err('captions.lanes must be {lane: {preset, ...options}}');
        else for (const [lane, entry] of Object.entries(pack.captions.lanes)) {
          if (!STYLE_CAPTION_LANES.includes(lane)) err(`captions.lanes.${lane} is not a lane (${STYLE_CAPTION_LANES.join(', ')})`);
          else if (!isObject(entry)) err(`captions.lanes.${lane} must be an object of caption options`);
          else if (entry.preset !== undefined && entry.preset !== 'none' && !CAPTION_PRESET_NAMES.includes(entry.preset)) err(`captions.lanes.${lane}.preset must be one of ${CAPTION_PRESET_NAMES.join(', ')} or "none"`);
        }
      }
    }
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
  validateV3Fields(pack, { err, warn: (message) => warnings.push(message), modules });
  return { ok: errors.length === 0, errors, warnings };
}

const isColorRef = (value) => typeof value === 'string' && (HEX.test(value) || STYLE_COLOR_ROLES.includes(value));
const isUnit = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * A style's cadence profile: a shipped profile id (src/profile_store.js
 * resolves it), or an inline measured profile, which must be a valid
 * launchclip.cadence-profile.v1 (kit/core/profiles.mjs validateProfile).
 * → error messages
 */
export function cadenceProfileErrors(profile, where = 'profile') {
  if (typeof profile === 'string') return NAME.test(profile) ? [] : [`${where} must be a profile id or a measured profile object`];
  if (!isObject(profile)) return [`${where} must be a profile id or a measured profile object`];
  return validateProfile(profile).errors.map((message) => `${where}: ${message}`);
}

/** The brand frame's shape (RFC §9.2), shared by style.brand_frame and story.frame. → error messages */
export function brandFrameErrors(frame, where = 'brand_frame') {
  if (frame === false) return [];
  if (!isObject(frame)) return [`${where} must be an object (or false)`];
  const errors = [];
  const keys = new Set(['enabled', 'logo', 'kicker', 'sections', 'progress', 'show', 'labels', 'color']);
  for (const key of Object.keys(frame)) if (!keys.has(key)) errors.push(`${where}.${key} is not a brand frame field (${[...keys].join(', ')})`);
  if (frame.enabled !== undefined && typeof frame.enabled !== 'boolean') errors.push(`${where}.enabled must be true or false`);
  if (frame.logo !== undefined && frame.logo !== null && !nonEmpty(frame.logo)) errors.push(`${where}.logo must be an image path in the project (assets/...)`);
  if (frame.color !== undefined && !isColorRef(frame.color)) errors.push(`${where}.color must be a brand role or a hex colour`);
  const part = (name, allowed) => {
    const value = frame[name];
    if (value === undefined || typeof value === 'boolean') return;
    if (!isObject(value)) { errors.push(`${where}.${name} must be true, false or an object`); return; }
    for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${where}.${name}.${key} is not supported (${allowed.join(', ')})`);
    if (value.position !== undefined && !STYLE_FRAME_POSITIONS.includes(value.position) && !(name === 'progress' && ['top', 'bottom'].includes(value.position))) errors.push(`${where}.${name}.position must be one of ${name === 'progress' ? 'top, bottom' : STYLE_FRAME_POSITIONS.join(', ')}`);
    if (value.color !== undefined && !isColorRef(value.color)) errors.push(`${where}.${name}.color must be a brand role or a hex colour`);
  };
  part('kicker', ['label', 'underline', 'position', 'color', 'logo']);
  part('sections', ['position', 'color']);
  part('progress', ['position', 'color', 'thickness']);
  if (isObject(frame.kicker)) {
    if (frame.kicker.label !== undefined && !(nonEmpty(frame.kicker.label) && frame.kicker.label.length <= 40)) errors.push(`${where}.kicker.label must be 1-40 characters`);
    if (frame.kicker.underline !== undefined && typeof frame.kicker.underline !== 'boolean') errors.push(`${where}.kicker.underline must be true or false`);
    if (frame.kicker.logo !== undefined && typeof frame.kicker.logo !== 'boolean') errors.push(`${where}.kicker.logo must be true or false (show the frame logo in the kicker)`);
  }
  if (isObject(frame.progress) && frame.progress.thickness !== undefined && !(typeof frame.progress.thickness === 'number' && frame.progress.thickness >= 2 && frame.progress.thickness <= 16)) errors.push(`${where}.progress.thickness must be 2-16 px`);
  if (frame.show !== undefined && !['always', 'scenes'].includes(frame.show)) errors.push(`${where}.show must be always or scenes`);
  if (frame.labels !== undefined) {
    if (!Array.isArray(frame.labels)) errors.push(`${where}.labels must be a list of {start | scene, label}`);
    else frame.labels.forEach((entry, i) => {
      if (!isObject(entry) || !(nonEmpty(entry.label) && entry.label.length <= 40)) errors.push(`${where}.labels[${i}].label must be 1-40 characters`);
      else if ((typeof entry.start === 'number') === (typeof entry.scene === 'string')) errors.push(`${where}.labels[${i}] needs exactly one of start (seconds) or scene (a scene id)`);
      else if (typeof entry.start === 'number' && !(entry.start >= 0)) errors.push(`${where}.labels[${i}].start must be seconds ≥ 0`);
    });
  }
  return errors;
}

function validateV3Fields(pack, { err, warn, modules }) {
  const known = modules == null ? null : new Set(modules instanceof Set ? [...modules] : modules);
  const layoutName = (value, where) => {
    if (!nonEmpty(value)) err(`${where} must be a layout name`);
    else if (!STYLE_LAYOUTS.includes(value)) warn(`${where} "${value}" is not one of ${STYLE_LAYOUTS.join(', ')}`);
  };
  if (pack.layouts !== undefined) {
    const l = pack.layouts;
    if (!isObject(l)) err('layouts must be {by_intent, by_section, panel}');
    else {
      for (const key of Object.keys(l)) if (!['by_intent', 'by_section', 'panel'].includes(key)) err(`layouts.${key} is not supported (by_intent, by_section, panel)`);
      for (const key of ['by_intent', 'by_section']) {
        if (l[key] === undefined) continue;
        if (!isObject(l[key])) err(`layouts.${key} must be {name: layout}`);
        else for (const [name, value] of Object.entries(l[key])) layoutName(value, `layouts.${key}.${name}`);
      }
      if (l.panel !== undefined) {
        if (!isObject(l.panel)) err('layouts.panel must be {treatment, radius}');
        else {
          if (l.panel.treatment !== undefined && !STYLE_PANEL_TREATMENTS.includes(l.panel.treatment)) err(`layouts.panel.treatment must be one of ${STYLE_PANEL_TREATMENTS.join(', ')}`);
          if (l.panel.radius !== undefined && !(typeof l.panel.radius === 'number' && l.panel.radius >= 0 && l.panel.radius <= 120)) err('layouts.panel.radius must be 0-120 px');
        }
      }
    }
  }
  if (pack.vocabulary !== undefined) {
    const v = pack.vocabulary;
    if (!isObject(v)) err('vocabulary must be {icon_tint, illustration, prefer}');
    else {
      for (const key of Object.keys(v)) if (!['icon_tint', 'illustration', 'prefer'].includes(key)) err(`vocabulary.${key} is not supported (icon_tint, illustration, prefer)`);
      if (v.icon_tint !== undefined && !isColorRef(v.icon_tint)) err('vocabulary.icon_tint must be a brand role or a hex colour');
      if (v.illustration !== undefined && typeof v.illustration !== 'boolean') err('vocabulary.illustration must be true or false');
      if (v.prefer !== undefined) {
        if (!isObject(v.prefer)) err('vocabulary.prefer must be {intent: [module ids]}');
        else for (const [intent, ids] of Object.entries(v.prefer)) {
          if (!Array.isArray(ids) || !ids.every(nonEmpty)) err(`vocabulary.prefer.${intent} must be a list of module ids`);
          else if (known) for (const id of ids) if (!known.has(id)) warn(`vocabulary.prefer.${intent}: "${id}" is not a known module`);
        }
      }
    }
  }
  if (pack.profile !== undefined) for (const message of cadenceProfileErrors(pack.profile)) err(message);
  if (pack.cast !== undefined) {
    // The characters kit (kit/core/characters/) fills the cast in; only its shape is checked here.
    const c = pack.cast;
    if (!isObject(c)) err('cast must be {drawing_style, colors, characters}');
    else {
      for (const key of Object.keys(c)) if (!['drawing_style', 'colors', 'characters'].includes(key)) err(`cast.${key} is not supported (drawing_style, colors, characters)`);
      if (c.drawing_style !== undefined && !(nonEmpty(c.drawing_style) && NAME.test(c.drawing_style))) err('cast.drawing_style must be a drawing style name');
      if (c.colors !== undefined) {
        if (!isObject(c.colors)) err('cast.colors must be {slot: brand role or hex}');
        else for (const [slot, value] of Object.entries(c.colors)) if (!isColorRef(value)) err(`cast.colors.${slot} must be a brand role or a hex colour`);
      }
      if (c.characters !== undefined && !(Array.isArray(c.characters) && c.characters.every((id) => nonEmpty(id) && NAME.test(id)))) err('cast.characters must be a list of character ids');
    }
  }
  if (pack.brand_frame !== undefined) {
    for (const message of brandFrameErrors(pack.brand_frame)) err(message);
    if (isObject(pack.brand_frame) && pack.brand_frame.labels !== undefined) warn('brand_frame.labels belong to a story (story.frame.labels); a style\'s labels are ignored');
  }
  if (pack.dials !== undefined) {
    if (!isObject(pack.dials)) err(`dials must be {${STYLE_DIALS.join(', ')}}, each 0-1`);
    else for (const [key, value] of Object.entries(pack.dials)) {
      if (!STYLE_DIALS.includes(key)) err(`dials.${key} is not a dial (${STYLE_DIALS.join(', ')})`);
      else if (!isUnit(value)) err(`dials.${key} must be a number from 0 to 1`);
    }
  }
}

// ---------------------------------------------------------------------------
// Merge

/** {name, intro, outro, loop: boolean | null} from a story's `style` value (string or object). */
export function storyStyleRequest(story) {
  const value = story?.style;
  if (typeof value === 'string' && value.trim()) return { name: value.trim(), intro: false, outro: false, loop: null };
  if (isObject(value) && nonEmpty(value.name)) return { name: value.name.trim(), intro: value.intro === true, outro: value.outro === true, loop: typeof value.loop === 'boolean' ? value.loop : null, ...(isObject(value.dials) ? { dials: { ...value.dials } } : {}) };
  return null;
}

/** A pack's caption defaults for a lane: captions without lanes, then captions.lanes[lane] on top. Null when the pack has none. */
export function packCaptionsFor(pack, lane) {
  if (!isObject(pack?.captions)) return null;
  const { lanes, ...base } = pack.captions;
  const own = isObject(lanes) && isObject(lanes[lane]) ? lanes[lane] : {};
  const merged = { ...base, ...own };
  return Object.keys(merged).length ? merged : null;
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
  // A story's motion holds only the grammar (story.mjs validateMotion), so
  // other motion keys a pack carries (a reference draft's
  // transition_preference) stay in the pack for the planner.
  for (const key of ['motion', 'camera', 'ambient', 'layout']) {
    if (!isObject(pack[key])) continue;
    const source = key === 'motion' ? (pack.motion.grammar === undefined ? null : { grammar: pack.motion.grammar }) : pack[key];
    if (!source) continue;
    if (out[key] === undefined) { out[key] = clone(source); applied.push(key); }
    else if (isObject(out[key])) fill(out[key], source, key);
  }

  // Polish dial (v3): the ambient level when neither the pack nor the story sets one.
  if (isObject(pack.dials) && pack.ambient?.level === undefined && out.ambient?.level === undefined && out.ambient !== null) {
    out.ambient = { ...(isObject(out.ambient) ? out.ambient : {}), level: dialChoices(styleDials(pack, story)).ambient };
    applied.push('ambient.level (polish dial)');
  }

  // Captions: the pack's preset and options, with its defaults for the
  // story's lane on top (v3 captions.lanes), fill the story's captions overlay
  // (added when the story declares no overlays at all).
  const captions = packCaptionsFor(pack, out.lane);
  if (captions && captions.preset !== 'none') {
    if (out.overlays === undefined) {
      out.overlays = [{ type: 'captions', ...clone(captions) }];
      applied.push('overlays[0] (captions)');
    } else if (Array.isArray(out.overlays)) {
      const index = out.overlays.findIndex((entry) => entry?.type === 'captions');
      const overlay = index >= 0 ? out.overlays[index] : null;
      if (overlay && overlay.style !== 'none' && overlay.preset !== 'none') {
        for (const [key, value] of Object.entries(captions)) {
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

  // Brand frame (v3): the story's frame, filled per key; a story with
  // "frame": false keeps none.
  if (isObject(pack.brand_frame) && pack.brand_frame.enabled !== false && out.frame !== false) {
    const { labels, ...frame } = pack.brand_frame;
    if (out.frame === undefined) { out.frame = clone(frame); applied.push('frame'); }
    else if (isObject(out.frame)) fill(out.frame, frame, 'frame');
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
// v2 → v3

/** Defaults the v3 fields take when a pack leaves them out (and what an upgrade writes). */
export const STYLE_V3_DEFAULTS = Object.freeze({
  layouts: Object.freeze({ by_intent: Object.freeze({}), by_section: Object.freeze({}), panel: Object.freeze({ treatment: 'solid', radius: 24 }) }),
  vocabulary: Object.freeze({ icon_tint: 'primary', illustration: true, prefer: Object.freeze({}) }),
  brand_frame: Object.freeze({ enabled: true, kicker: Object.freeze({ underline: true, position: 'top-left', logo: true }), sections: true, progress: false, show: 'always' }),
  caption_lanes: Object.freeze({ 'footage-led': Object.freeze({ preset: 'quiet-accent' }) }),
  dials: Object.freeze({ energy: 0.5, density: 0.5, playfulness: 0.5, polish: 0.5 })
});

/**
 * A v3 pack from a v2 pack. The v3 fields the pack lacks are filled from
 * STYLE_V3_DEFAULTS; the pack's own values are kept. With render: "same" (how
 * a v2 pack is upgraded on load) the brand frame is off and no lane caption
 * default and no dials are added, so a v2 pack renders exactly as before;
 * the written upgrade (launchclip style upgrade) adds all three. A v3 pack
 * is returned as it is. → {pack, notes: []}
 */
export function upgradeV2Pack(pack, { render = 'new' } = {}) {
  if (!isObject(pack)) throw new Error('style pack must be a JSON object');
  if (pack.schema === STYLE_SCHEMA) return { pack, notes: [] };
  if (pack.schema !== STYLE_V2_SCHEMA) throw new Error(`upgradeV2Pack needs a "${STYLE_V2_SCHEMA}" pack`);
  const same = render === 'same';
  const out = { ...clone(pack), schema: STYLE_SCHEMA, upgraded_from: pack.upgraded_from ?? STYLE_V2_SCHEMA };
  const notes = [];
  const fill = (key, value, note) => { if (out[key] === undefined) { out[key] = clone(value); notes.push(note); } };
  fill('layouts', STYLE_V3_DEFAULTS.layouts, 'layouts: no layout preferences; solid panels with a 24 px radius');
  fill('vocabulary', STYLE_V3_DEFAULTS.vocabulary, 'vocabulary: icons tinted primary, illustration on');
  if (!same) fill('dials', STYLE_V3_DEFAULTS.dials, 'dials: all at 0.5 (the middle of the profile band)');
  if (same) fill('brand_frame', { enabled: false }, 'brand_frame: off (a v2 pack loaded as v3 renders as before; run launchclip style upgrade to turn it on)');
  else fill('brand_frame', STYLE_V3_DEFAULTS.brand_frame, 'brand_frame: kicker with underline top left, section labels on, no progress line');
  if (!same && out.captions?.preset === undefined && out.captions?.lanes === undefined) {
    out.captions = { ...(isObject(out.captions) ? out.captions : {}), lanes: clone(STYLE_V3_DEFAULTS.caption_lanes) };
    notes.push('captions.lanes: footage-led stories use the quiet-accent preset');
  }
  return { pack: out, notes };
}

// ---------------------------------------------------------------------------
// Dials (RFC §9.3)

// Which dial moves each cadence measure, and which way: +1 raises the target
// as the dial rises, -1 lowers it. Measures no dial names hold their p50.
export const DIAL_MEASURES = Object.freeze({
  shot_seconds: Object.freeze(['energy', -1]),
  visual_changes_per_min: Object.freeze(['energy', 1]),
  layout_changes_per_min: Object.freeze(['energy', 1]),
  flow_velocity_p90: Object.freeze(['energy', 1]),
  text_hold_seconds: Object.freeze(['energy', -1]),
  first_visual_seconds: Object.freeze(['energy', -1]),
  coverage: Object.freeze(['density', 1]),
  longest_undressed_seconds: Object.freeze(['density', -1]),
  caption_words_on_screen: Object.freeze(['density', 1]),
  face_time: Object.freeze(['density', -1])
});

const clamp01 = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5);

/**
 * The dials in force: STYLE_V3_DEFAULTS.dials, then the pack's, then the
 * story's (`"style": {"name", "dials": {...}}`), each clamped to 0–1.
 */
export function styleDials(pack, story) {
  const own = isObject(story?.style) && isObject(story.style.dials) ? story.style.dials : {};
  const merged = { ...STYLE_V3_DEFAULTS.dials, ...(isObject(pack?.dials) ? pack.dials : {}), ...own };
  return Object.fromEntries(STYLE_DIALS.map((key) => [key, clamp01(merged[key])]));
}

/**
 * Cadence targets for a measured profile under the dials. Each measure's band
 * runs from its lowest to its highest given percentile (p10..p90, or p50..p90
 * when p10 is absent); the target moves piecewise-linearly through p50 (the
 * target at dial 0.5) and stays inside the band whatever the dial, which
 * keeps customisation inside what the reference set shows works.
 * → {<measure>: {target, band: [lo, hi], dial: name | null}}
 */
export function dialTargets(profile, dials = {}) {
  const measures = isObject(profile?.measures) ? profile.measures : {};
  const out = {};
  for (const [name, range] of Object.entries(measures)) {
    const points = ['p10', 'p50', 'p90'].map((key) => range?.[key]).filter((value) => typeof value === 'number' && Number.isFinite(value));
    if (!points.length) continue;
    const lo = Math.min(...points), hi = Math.max(...points);
    const mid = typeof range.p50 === 'number' ? range.p50 : (lo + hi) / 2;
    const [dial, direction] = DIAL_MEASURES[name] ?? [null, 0];
    let target = mid;
    if (dial) {
      const t = direction > 0 ? clamp01(dials[dial]) : 1 - clamp01(dials[dial]);
      target = t <= 0.5 ? lo + (mid - lo) * (t / 0.5) : mid + (hi - mid) * ((t - 0.5) / 0.5);
    }
    out[name] = { target: Math.round(Math.max(lo, Math.min(hi, target)) * 1000) / 1000, band: [lo, hi], dial };
  }
  return out;
}

/**
 * What the dials choose outside the cadence band: playfulness picks the
 * mood of the vocabulary and polish the ambient motion level. Each choice is
 * a suggestion the pack's own explicit fields override.
 */
export function dialChoices(dials = {}) {
  const playfulness = clamp01(dials.playfulness), polish = clamp01(dials.polish);
  return {
    mood: playfulness >= 0.67 ? 'playful' : playfulness <= 0.33 ? 'serious' : 'balanced',
    ambient: polish >= 0.75 ? 'standard' : polish >= 0.4 ? 'subtle' : 'off'
  };
}

// ---------------------------------------------------------------------------
// v1 → v3 and prompt text

/**
 * Draft a v3 pack from a v1 pack (frame.md / DESIGN.md text, optional audio
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
    layouts: clone(STYLE_V3_DEFAULTS.layouts),
    vocabulary: clone(STYLE_V3_DEFAULTS.vocabulary),
    brand_frame: clone(STYLE_V3_DEFAULTS.brand_frame),
    dials: clone(STYLE_V3_DEFAULTS.dials),
    upgraded_from: STYLE_V1_SCHEMA
  };
  notes.push(`motion.grammar: ${grammar} (from the specification's wording)`);
  notes.push(captionSkin ? 'captions: the v1 caption skin (HTML) is kept in the pack for the HyperFrames route; the storyboard uses word-highlight' : 'captions: no caption skin; minimal-line');
  return { pack, notes: [...notes, ...assigned.notes] };
}

/** Planner prompt lines for a style pack (preferences, avoid list, caption preset, v3 layouts, vocabulary, frame and cast). */
export function stylePromptLines(pack, { lane, story } = {}) {
  if (!isObject(pack)) return [];
  const lines = [`style pack: ${pack.name}${pack.description ? ` — ${pack.description}` : ''}`];
  lines.push('Set "style": "' + pack.name + '" at the top level. The pack fills brand, captions, motion, camera, ambient and sound; do not restate them unless the brief demands an exception.');
  if (pack.modules?.prefer?.length) lines.push(`Prefer these modules where the script allows: ${pack.modules.prefer.join(', ')}.`);
  if (pack.modules?.avoid?.length) lines.push(`Avoid these modules: ${pack.modules.avoid.join(', ')}.`);
  const captions = packCaptionsFor(pack, lane);
  if (captions?.preset) lines.push(`Captions use the ${captions.preset} preset${pack.captions?.lanes?.[lane]?.preset ? ` (the pack's ${lane} default)` : ''}: write {"type": "captions"} without a style or preset.`);
  const layouts = pack.layouts;
  const named = (map) => Object.entries(map ?? {}).map(([key, value]) => `${key} → ${value}`).join(', ');
  if (lane === 'footage-led' && (named(layouts?.by_intent) || named(layouts?.by_section))) lines.push(`Preferred footage layouts: ${[named(layouts.by_intent) && `by intent ${named(layouts.by_intent)}`, named(layouts.by_section) && `by section ${named(layouts.by_section)}`].filter(Boolean).join('; ')}.`);
  if (layouts?.panel) lines.push(`Panels: ${layouts.panel.treatment ?? 'solid'}${layouts.panel.radius !== undefined ? `, ${layouts.panel.radius} px corners` : ''}.`);
  const vocabulary = pack.vocabulary;
  if (Object.keys(vocabulary?.prefer ?? {}).length) lines.push(`Preferred modules by intent: ${Object.entries(vocabulary.prefer).map(([intent, ids]) => `${intent} → ${ids.join(' or ')}`).join('; ')}.`);
  if (vocabulary?.illustration === false) lines.push('No illustrated objects: use icons, type and real media only.');
  if (pack.cast?.characters?.length) lines.push(`Default cast: ${pack.cast.characters.join(', ')}${pack.cast.drawing_style ? ` (${pack.cast.drawing_style})` : ''}; reuse them rather than inventing characters.`);
  if (isObject(pack.dials)) {
    const dials = styleDials(pack, story);
    const choices = dialChoices(dials);
    lines.push(`Dials: ${STYLE_DIALS.map((key) => `${key} ${dials[key]}`).join(', ')} (0-1; they move the targets inside the profile band, never outside it). Vocabulary mood: ${choices.mood}.`);
    if (isObject(pack.profile)) {
      const targets = Object.entries(dialTargets(pack.profile, dials)).map(([name, entry]) => `${name} ${entry.target} (band ${entry.band[0]}-${entry.band[1]})`);
      if (targets.length) lines.push(`Cadence targets from the style's measured profile: ${targets.join('; ')}.`);
    } else if (typeof pack.profile === 'string') lines.push(`Cadence profile: ${pack.profile}.`);
  }
  if (isObject(pack.brand_frame) && pack.brand_frame.enabled !== false) lines.push('The pack draws a brand frame (kicker, section labels, progress line) around every scene: do not author kickers or brand labels as scenes. Name sections with "frame": {"labels": [{"scene": "<id>", "label": "<2-4 words>"}]}.');
  const grammar = typeof pack.motion?.grammar === 'string' ? pack.motion.grammar : pack.motion?.grammar?.base;
  if (Array.isArray(pack.motion?.transition_preference) && pack.motion.transition_preference.length) lines.push(`Preferred transitions: ${pack.motion.transition_preference.join(', ')}.`);
  if (grammar) lines.push(`Motion grammar: ${grammar}${grammar === 'snappy' ? ' (short scenes, fast push/whip transitions)' : grammar === 'smooth' || grammar === 'documentary' || grammar === 'cinematic' ? ' (longer holds, fades and slow pushes)' : ''}.`);
  if (pack.ambient?.level) lines.push(`Ambient motion level: ${pack.ambient.level}.`);
  if (pack.sound?.sfx_density) lines.push(`SFX density: ${pack.sound.sfx_density}${pack.sound.sfx_density === 'low' ? ' (cue only the biggest hits)' : pack.sound.sfx_density === 'high' ? ' (cue most hits)' : ''}.`);
  if (pack.layout?.title_case) lines.push('Write headlines and titles in Title Case.');
  if (pack.intro || pack.outro) lines.push(`The pack has ${[pack.intro ? 'an intro' : null, pack.outro ? 'an outro' : null].filter(Boolean).join(' and ')}; they are added by "style": {"name": "${pack.name}", "intro": true, "outro": true}, never authored as scenes.`);
  return lines;
}

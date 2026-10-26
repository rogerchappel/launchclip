// Seeded styles (docs/SEEDED_STYLES_RFC.md): a complete launchclip.style.v3
// pack from an 8-hex seed, so two projects made from bare prompts look
// different and one project looks the same every time.
//
//   generateStyle({seed, tone, constraints, at}) → pack
//
// Art direction sets the constraints (tone, theme, world, drawing style,
// character set, background, panel); the seed picks among the options that
// fit them. Every dimension draws from its own stream (the seed hashed with
// the dimension's name), so pinning one constraint never reshuffles the
// others. Palettes are built in OKLCH from a harmony scheme and pushed to
// readable contrast; type comes from a curated pairing table; motion,
// captions, ambient, camera and dials follow the tone (§3.3). A candidate
// whose fingerprint sits too close to a starter pack (kit/styles) or to the
// renderers' fallback look is redrawn from the next seed state (§3.6).
//
// The option lists (SEED_*) hold what the kits draw today; the sessions that
// build backgrounds, module variants, characters and worlds widen them.
// Raising GENERATOR_VERSION never changes a saved project: its pack is what
// renders, and only a reroll uses the new mapping.
//
// Pure ESM that imports only kit/core siblings. Canonical copy:
// kit/core/style-seed.mjs.

import { seededRandom } from './ambient.mjs';
import { CAPTION_PRESETS } from './captions.mjs';
import { DRAWING_STYLES } from './characters/cues.mjs';
import { CHARACTER_SET_NAMES, generateCast } from './characters/generate.mjs';
import { moduleVariants } from './modules.mjs';
import { AMBIENCE_BEDS, GENRE_SPECS, MUSIC_GENRES, SOUND_PALETTES, TONE_SOUND } from './sound/options.mjs';
import { BACKGROUND_MOTIFS } from './backgrounds.mjs';
import { PANEL_TREATMENTS } from './panels.mjs';
import { WORLD_KINDS } from './worlds/index.mjs';
import { FONT_REGISTRY, registeredFamily } from './fonts.mjs';
import { STYLE_FRAME_POSITIONS, STYLE_ICON_STYLES, STYLE_ILLUSTRATIONS, STYLE_SCHEMA, STYLE_V3_DEFAULTS, STYLE_WORLD_TIMES, contrastRatio, validateStylePack } from './style.mjs';

export const GENERATOR_VERSION = 'launchclip.style-seed.v1';
export const SEED_PATTERN = /^[0-9a-f]{8}$/;

// ---------------------------------------------------------------------------
// Option lists. Each is what the seed may pick today.

export const TONES = Object.freeze(['calm', 'serious', 'warm', 'energetic', 'playful', 'premium', 'technical']);
export const THEMES = Object.freeze(['dark', 'light', 'tinted']);
export const PALETTE_SCHEMES = Object.freeze(['complementary', 'split-complementary', 'analogous', 'triadic', 'monochrome', 'duotone']);
export const SEED_PANEL_TREATMENTS = PANEL_TREATMENTS;
// Plain flat fills look poor, so subtle patterns and textures carry most of
// the weight; flat and the blobs field stay possible. Every kit kind is drawn
// except logo-pattern, which needs a brand logo a seeded style does not have.
// Each entry is [kind, weight].
export const SEED_BACKGROUND_KINDS = Object.freeze([['texture', 3], ['grain-gradient', 3], ['dot-grid', 2], ['topographic', 2], ['halftone', 2], ['mesh', 2], ['gradient', 2], ['geometric', 1], ['stripes', 1], ['paper', 1], ['light-rays', 1], ['icon-pattern', 1], ['icon-scatter', 1], ['motif', 1], ['blobs', 1], ['flat', 1]].map(Object.freeze));
// Fills inside cards and footage panels: quiet textures only.
export const SEED_PANEL_FILLS = Object.freeze(['texture', 'grain-gradient', 'dot-grid', 'halftone', 'topographic']);
// Per-kind param subranges that read well (from the backgrounds kit; every
// value inside kit/core/backgrounds.mjs BACKGROUND_PARAMS is contrast-safe).
// Panel fills take the low quarter of intensity and amount, so card text
// stays calm. `color` goes only on the kinds that take it (BACKGROUND_OPTIONS
// in kit/core/backgrounds.mjs); texture also draws its type.
export const SEED_BACKGROUND_PARAMS = Object.freeze({
  texture: { amount: [0.3, 0.8], scale: [0.8, 1.4] },
  'grain-gradient': { angle: [0, 360], intensity: [0.25, 0.7], grain: [0.2, 0.6] },
  gradient: { angle: [0, 360], intensity: [0.25, 0.7] },
  'dot-grid': { scale: [0.7, 1.5], density: [0.2, 0.7], intensity: [0.3, 0.7] },
  topographic: { density: [0.3, 0.8], scale: [0.8, 1.4], intensity: [0.3, 0.6] },
  halftone: { angle: [0, 360], scale: [0.7, 1.4], intensity: [0.3, 0.7] },
  mesh: { intensity: [0.3, 0.7], scale: [0.7, 1.6] },
  geometric: { density: [0.3, 0.7], scale: [0.8, 1.5], intensity: [0.3, 0.6] },
  stripes: { angle: [0, 180], scale: [0.8, 1.6], density: [0.2, 0.45], intensity: [0.2, 0.5] },
  paper: { grain: [0.3, 0.7], intensity: [0.2, 0.6] }
});
const COLOR_KINDS = new Set(['gradient', 'grain-gradient', 'geometric', 'dot-grid', 'stripes', 'topographic', 'halftone', 'light-rays', 'icon-pattern', 'icon-scatter', 'motif']);
export const SEED_TEXTURES = Object.freeze(['noise', 'fibre', 'canvas', 'linen']);
const CALM_PARAMS = new Set(['intensity', 'amount']);

/** Seeded params for a background kind (a panel fill keeps intensity low). */
function drawBackgroundParams(s, kind, { fill = false } = {}) {
  const params = {};
  for (const [name, [lo, hi]] of Object.entries(SEED_BACKGROUND_PARAMS[kind] ?? {})) {
    const top = fill && CALM_PARAMS.has(name) ? lo + (hi - lo) * 0.25 : hi;
    params[name] = name === 'angle' ? Math.round(s.range(lo, top)) : round(s.range(lo, top), 2);
  }
  const color = s.pick(['primary', 'accent', 'paper']);
  const texture = s.pick(SEED_TEXTURES);
  const shape = s.pick(BACKGROUND_MOTIFS);
  if (COLOR_KINDS.has(kind)) params.color = color;
  if (kind === 'texture') params.type = texture;
  if (kind === 'motif') params.shape = shape;
  return params;
}

export const SEED_FADES = Object.freeze(['none', 'center', 'top', 'bottom', 'left', 'right']);
export const PANEL_FILL_CHANCE = 0.6;
// Sound (kit/core/sound/options.mjs): a tone narrows the palettes and genres
// (TONE_SOUND); the genre sets the bpm range, keys and progressions.
export const SEED_SOUND_PALETTES = SOUND_PALETTES;
export const SEED_MUSIC_GENRES = MUSIC_GENRES;
export const SEED_ICON_STYLES = STYLE_ICON_STYLES;
export const SEED_ILLUSTRATIONS = STYLE_ILLUSTRATIONS;
// Ambience under the music: "auto" (the world's own bed, kit/core/sound
// ambienceForWorld) most of the time, else none or any bed. [value, weight].
export const SEED_AMBIENCE = Object.freeze([['auto', 6], ['none', 1], ...AMBIENCE_BEDS.map((bed) => [bed, 1])].map(Object.freeze));
export const SEED_DRAWING_STYLES = DRAWING_STYLES;
// Every set in the characters kit (kit/core/characters/generate.mjs), the
// everyday ones twice as often as the themed ones (family, kids, seniors,
// chefs, medical, athletes, ...); art direction pins one with character_set.
// generateCast builds the people from the seed. [set, weight].
export const NEUTRAL_CHARACTER_SETS = Object.freeze(['office-team', 'startup-founders', 'students', 'creators', 'city-crowd']);
export const SEED_CHARACTER_SETS = Object.freeze(CHARACTER_SET_NAMES.map((name) => Object.freeze([name, NEUTRAL_CHARACTER_SETS.includes(name) ? 2 : 1])));
// Topic-neutral worlds (from the worlds kit) the seed may draw for any prompt;
// topical ones (kitchen, gym, server-room, ...) are left to art direction.
// Props stay empty: a world dresses itself, and props are for direction.
export const SEED_WORLDS = Object.freeze(['abstract-stage', 'skyline', 'rooftop', 'park', 'city-street', 'home-desk']);
// [time, weight]: day and dusk above night, except for night-friendly tones.
export const SEED_WORLD_TIMES = Object.freeze([['day', 2], ['dusk', 2], ['night', 1]].map(Object.freeze));
const NIGHT_TONES = new Set(['premium', 'energetic']);
// Modules with designed variants → their names, default first
// (kit/core/modules.mjs moduleVariants: catalogue G, editorial and the rest).
export const SEED_MODULE_VARIANTS = Object.freeze(Object.fromEntries(Object.entries(moduleVariants()).map(([id, names]) => [id, Object.freeze(names)])));
export const CONSTRAINT_KEYS = Object.freeze(['tone', 'theme', 'world', 'drawing_style', 'character_set', 'background', 'panel']);

/**
 * Curated type pairings over the bundled fonts (kit/core/fonts.mjs): display
 * plus body plus meta, with the display case and weight. `tones` are the
 * tones a pairing suits; a tone narrows the table to its pairings.
 */
export const FONT_PAIRINGS = Object.freeze([
  { id: 'anton-inter', display: 'anton', body: 'inter', case: 'upper', weight: 400, tones: ['energetic', 'serious', 'technical'] },
  { id: 'anton-space', display: 'anton', body: 'space-grotesk', case: 'upper', weight: 400, tones: ['energetic', 'technical'] },
  { id: 'archivo-inter', display: 'archivo-black', body: 'inter', case: 'upper', weight: 400, tones: ['energetic', 'playful'] },
  { id: 'archivo-space', display: 'archivo-black', body: 'space-grotesk', case: 'title', weight: 400, tones: ['energetic', 'technical'] },
  { id: 'unbounded-inter', display: 'unbounded', body: 'inter', case: 'title', weight: 700, tones: ['playful', 'energetic', 'technical'] },
  { id: 'unbounded-space', display: 'unbounded', body: 'space-grotesk', case: 'upper', weight: 800, tones: ['playful', 'energetic'] },
  { id: 'syne-inter', display: 'syne', body: 'inter', case: 'title', weight: 700, tones: ['premium', 'calm', 'warm'] },
  { id: 'syne-space', display: 'syne', body: 'space-grotesk', case: 'upper', weight: 800, tones: ['energetic', 'technical', 'premium'] },
  { id: 'bricolage-inter', display: 'bricolage-grotesque', body: 'inter', case: 'title', weight: 700, tones: ['warm', 'playful', 'calm'] },
  { id: 'bricolage-space', display: 'bricolage-grotesque', body: 'space-grotesk', case: 'title', weight: 800, tones: ['playful', 'warm'] },
  { id: 'space-inter', display: 'space-grotesk', body: 'inter', case: 'title', weight: 700, tones: ['technical', 'calm', 'serious'] },
  { id: 'instrument-inter', display: 'instrument-serif', body: 'inter', case: 'title', weight: 400, tones: ['premium', 'calm', 'warm', 'serious'] },
  { id: 'instrument-space', display: 'instrument-serif', body: 'space-grotesk', case: 'title', weight: 400, tones: ['premium', 'warm'] },
  { id: 'stix-space', display: 'stix-two-text', body: 'space-grotesk', case: 'title', weight: 600, tones: ['serious', 'calm', 'premium'] },
  { id: 'stix-bricolage', display: 'stix-two-text', body: 'bricolage-grotesque', case: 'title', weight: 600, tones: ['warm', 'serious'] },
  { id: 'anton-manrope', display: 'anton', body: 'manrope', case: 'upper', weight: 400, tones: ['energetic', 'serious'] },
  { id: 'bebas-dm', display: 'bebas-neue', body: 'dm-sans', case: 'upper', weight: 400, tones: ['energetic', 'technical', 'serious'] },
  { id: 'bebas-manrope', display: 'bebas-neue', body: 'manrope', case: 'upper', weight: 400, tones: ['energetic', 'playful'] },
  { id: 'oswald-jakarta', display: 'oswald', body: 'plus-jakarta-sans', case: 'upper', weight: 600, tones: ['energetic', 'serious'] },
  { id: 'oswald-dm', display: 'oswald', body: 'dm-sans', case: 'upper', weight: 600, tones: ['technical', 'serious'] },
  { id: 'shoulders-outfit', display: 'big-shoulders-display', body: 'outfit', case: 'upper', weight: 800, tones: ['energetic', 'playful'] },
  { id: 'shoulders-manrope', display: 'big-shoulders-display', body: 'manrope', case: 'upper', weight: 800, tones: ['technical', 'energetic'], meta: 'fira-code' },
  { id: 'fraunces-dm', display: 'fraunces', body: 'dm-sans', case: 'title', weight: 600, tones: ['warm', 'playful', 'calm'] },
  { id: 'fraunces-manrope', display: 'fraunces', body: 'manrope', case: 'title', weight: 700, tones: ['warm', 'premium'] },
  { id: 'playfair-dm', display: 'playfair-display', body: 'dm-sans', case: 'title', weight: 700, tones: ['premium', 'serious'] },
  { id: 'playfair-lexend', display: 'playfair-display', body: 'lexend', case: 'title', weight: 600, tones: ['premium', 'calm'] },
  { id: 'dmserif-jakarta', display: 'dm-serif-display', body: 'plus-jakarta-sans', case: 'title', weight: 400, tones: ['premium', 'warm', 'calm'] },
  { id: 'dmserif-outfit', display: 'dm-serif-display', body: 'outfit', case: 'title', weight: 400, tones: ['calm', 'warm'] },
  { id: 'young-dm', display: 'young-serif', body: 'dm-sans', case: 'title', weight: 400, tones: ['warm', 'playful'] },
  { id: 'young-lexend', display: 'young-serif', body: 'lexend', case: 'title', weight: 400, tones: ['warm', 'calm'] },
  { id: 'sora-dm', display: 'sora', body: 'dm-sans', case: 'title', weight: 700, tones: ['technical', 'calm'], meta: 'fira-code' },
  { id: 'lexend-manrope', display: 'lexend', body: 'manrope', case: 'title', weight: 700, tones: ['technical', 'playful'] },
  { id: 'outfit-sora', display: 'outfit', body: 'sora', case: 'title', weight: 800, tones: ['playful', 'energetic'] },
  { id: 'jakarta-dm', display: 'plus-jakarta-sans', body: 'dm-sans', case: 'title', weight: 800, tones: ['technical', 'calm', 'premium'], meta: 'fira-code' },
  { id: 'unbounded-outfit', display: 'unbounded', body: 'outfit', case: 'title', weight: 700, tones: ['playful'] },
  { id: 'syne-dm', display: 'syne', body: 'dm-sans', case: 'title', weight: 700, tones: ['premium', 'technical'] },
  { id: 'space-fira', display: 'space-grotesk', body: 'inter', case: 'title', weight: 700, tones: ['technical'], meta: 'fira-code' }
].map((entry) => Object.freeze({ meta: 'jetbrains-mono', ...entry, tones: Object.freeze(entry.tones) })));

// Tone → the families it narrows to (§3.3). `null` (no tone words) leaves
// every family open, with dials around the middle.
const ALL_GRAMMARS = ['editorial', 'snappy', 'smooth', 'playful', 'documentary', 'cinematic'];
export const TONE_TABLE = Object.freeze({
  calm: { grammars: ['smooth', 'documentary'], ambient: ['subtle', 'standard'], themes: ['light', 'tinted', 'dark'], chroma: [0.07, 0.14], dials: { energy: 0.25, density: 0.35, playfulness: 0.3, polish: 0.7 }, sfx: 'low', music: ['soft piano', 'warm pads', 'slow ambient'], bpm: [64, 86] },
  serious: { grammars: ['documentary', 'editorial'], ambient: ['off', 'subtle'], themes: ['dark', 'light'], chroma: [0.06, 0.13], dials: { energy: 0.35, density: 0.5, playfulness: 0.1, polish: 0.6 }, sfx: 'low', music: ['sparse strings', 'low drones', 'restrained percussion'], bpm: [70, 92] },
  warm: { grammars: ['smooth', 'documentary', 'editorial'], ambient: ['subtle', 'standard'], themes: ['tinted', 'light', 'dark'], chroma: [0.1, 0.17], dials: { energy: 0.4, density: 0.45, playfulness: 0.45, polish: 0.6 }, sfx: 'normal', music: ['acoustic guitar', 'warm keys', 'brushed drums'], bpm: [80, 104] },
  energetic: { grammars: ['snappy', 'playful'], ambient: ['standard', 'lively'], themes: ['dark', 'tinted', 'light'], chroma: [0.15, 0.24], dials: { energy: 0.8, density: 0.6, playfulness: 0.55, polish: 0.55 }, sfx: 'high', music: ['driving synth bass', 'punchy drums', 'bright stabs'], bpm: [112, 132] },
  playful: { grammars: ['playful', 'snappy'], ambient: ['standard', 'lively'], themes: ['light', 'tinted', 'dark'], chroma: [0.14, 0.22], dials: { energy: 0.7, density: 0.5, playfulness: 0.85, polish: 0.5 }, sfx: 'high', music: ['bouncy marimba', 'plucky synths', 'handclaps'], bpm: [100, 124] },
  premium: { grammars: ['cinematic', 'smooth'], ambient: ['subtle', 'standard'], themes: ['dark', 'tinted'], chroma: [0.06, 0.13], dials: { energy: 0.35, density: 0.3, playfulness: 0.2, polish: 0.9 }, sfx: 'low', music: ['cinematic swells', 'deep pulses', 'airy textures'], bpm: [72, 96] },
  technical: { grammars: ['editorial', 'snappy'], ambient: ['off', 'subtle'], themes: ['dark', 'light'], chroma: [0.1, 0.18], dials: { energy: 0.55, density: 0.7, playfulness: 0.25, polish: 0.55 }, sfx: 'normal', music: ['minimal electronic', 'clean arpeggios', 'tight beats'], bpm: [96, 120] }
});
const NO_TONE = Object.freeze({ grammars: ALL_GRAMMARS, ambient: ['off', 'subtle', 'standard', 'lively'], themes: THEMES, chroma: [0.09, 0.21], dials: { energy: 0.5, density: 0.5, playfulness: 0.5, polish: 0.5 }, sfx: 'normal', music: ['modern electronic', 'light percussion'], bpm: [90, 118] });

// Art-direction words → tone (the same kind of words suggestMotion() and
// suggestModuleMoods() read in kit/core/planning-prompt.mjs).
export const TONE_WORDS = Object.freeze({
  playful: ['\\bplayful\\b', '\\bfun\\b', '\\bbouncy\\b', '\\bquirky\\b', '\\bkids?\\b', '\\bcartoon', '\\bwhimsical\\b', '\\bcheeky\\b'],
  energetic: ['\\benergetic\\b', '\\bpunchy\\b', '\\bhype\\b', '\\bbold\\b', '\\bfast[- ]paced\\b', '\\bhigh[- ]energy\\b', '\\bsporty\\b', '\\blaunch', '\\bexciting\\b'],
  premium: ['\\bpremium\\b', '\\bluxur', '\\belegant\\b', '\\bcinematic\\b', '\\bhigh[- ]end\\b', '\\bpolished\\b'],
  serious: ['\\bserious\\b', '\\bsober\\b', '\\bdocumentary\\b', '\\binvestigative\\b', '\\bnews\\b', '\\bsolemn\\b', '\\bsecurity\\b', '\\bfinance\\b'],
  technical: ['\\btechnical\\b', '\\bdevelopers?\\b', '\\bapi\\b', '\\bcli\\b', '\\bcode\\b', '\\bengineering\\b', '\\bdev ?tools?\\b', '\\binfrastructure\\b'],
  calm: ['\\bcalm\\b', '\\bgentle\\b', '\\bsoft\\b', '\\bwellness\\b', '\\bmindful', '\\brelax', '\\bminimal'],
  warm: ['\\bwarm\\b', '\\bcosy\\b', '\\bcozy\\b', '\\bfriendly\\b', '\\bcooking\\b', '\\bfamily\\b', '\\bcommunity\\b', '\\bhuman\\b']
});

/** The tone a prompt or art direction names (the first that matches, in TONE_WORDS order), or null. */
export function toneFromText(text) {
  const value = String(text ?? '');
  for (const [tone, patterns] of Object.entries(TONE_WORDS)) if (patterns.some((source) => new RegExp(source, 'i').test(value))) return tone;
  return null;
}

const GRAMMAR_TRANSITIONS = Object.freeze({
  editorial: ['cut', 'fade', 'push'],
  snappy: ['push', 'whip', 'whip-pan', 'zoom'],
  smooth: ['fade', 'pan', 'morph', 'pull'],
  playful: ['push', 'iris', 'whip-pan', 'zoom'],
  documentary: ['cut', 'fade', 'pull'],
  cinematic: ['fade', 'pull', 'pan', 'orbit']
});
const WORLD_GRAMMARS = new Set(['playful', 'snappy', 'smooth', 'cinematic']);
const GRAMMAR_CAPTIONS = Object.freeze({
  editorial: ['minimal-line', 'underline-sweep', 'word-highlight', 'box-highlight', 'split-color'],
  snappy: ['word-highlight', 'pop-word', 'kinetic-stack', 'box-highlight', 'outline-heavy', 'karaoke-fill'],
  smooth: ['minimal-line', 'underline-sweep', 'glow', 'karaoke-fill', 'quiet-accent'],
  playful: ['bounce', 'pop-word', 'bubble', 'box-highlight', 'split-color'],
  documentary: ['lower-band', 'minimal-line', 'typewriter', 'quiet-accent'],
  cinematic: ['minimal-line', 'glow', 'lower-band', 'underline-sweep']
});
// On a light background the bold presets' black stroke fights dark text, so
// light themes keep the stroke-free presets with a soft shadow, a plate or a band.
const LIGHT_CAPTIONS = new Set(Object.entries(CAPTION_PRESETS).filter(([, spec]) => spec.stroke === 0 && spec.word !== 'glow').map(([name]) => name));

// ---------------------------------------------------------------------------
// Seeds and streams

/** "7F3A91C2" / 0x7f3a91c2 → "7f3a91c2". Throws on anything else. */
export function normalizeSeed(seed) {
  if (typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff) return seed.toString(16).padStart(8, '0');
  const value = String(seed ?? '').trim().toLowerCase().replace(/^0x/, '').replace(/^seed-/, '');
  if (!SEED_PATTERN.test(value)) throw new Error(`seed must be 8 hex characters (e.g. 7f3a91c2); got ${JSON.stringify(seed)}`);
  return value;
}

/** A fresh seed from a [0, 1) source (Math.random by default; the CLI passes crypto). */
export function randomSeed(random = Math.random) {
  return Math.floor(random() * 0x100000000).toString(16).padStart(8, '0');
}

function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** One dimension's stream: the seed hashed with the dimension's name. */
function stream(seed, name) {
  const random = seededRandom((parseInt(seed, 16) ^ hash32(name)) >>> 0);
  return {
    random,
    range: (lo, hi) => lo + (hi - lo) * random(),
    pick: (list) => list[Math.floor(random() * list.length) % list.length],
    chance: (p) => random() < p
  };
}

const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

// ---------------------------------------------------------------------------
// OKLCH (Björn Ottosson's OKLab, sRGB D65)

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

/** #rrggbb → [L, a, b] in OKLab. */
export function hexToOklab(hex) {
  const value = String(hex).replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => toLinear(parseInt(value.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** #rrggbb → {l, c, h} in OKLCH (h in degrees). */
export function hexToOklch(hex) {
  const [L, a, b] = hexToOklab(hex);
  return { l: L, c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

const inGamut = (rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);
const lchToLab = ({ l, c, h }) => [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];

/** {l, c, h} → #rrggbb, lowering chroma (never lightness or hue) until the colour fits sRGB. */
export function oklchToHex({ l, c, h }) {
  const L = Math.max(0, Math.min(1, l));
  let lo = 0, hi = Math.max(0, c);
  if (!inGamut(oklabToLinear(lchToLab({ l: L, c: hi, h })))) {
    for (let i = 0; i < 24; i += 1) { const mid = (lo + hi) / 2; if (inGamut(oklabToLinear(lchToLab({ l: L, c: mid, h })))) lo = mid; else hi = mid; }
    hi = lo;
  }
  const rgb = oklabToLinear(lchToLab({ l: L, c: hi, h })).map((v) => Math.round(Math.max(0, Math.min(1, toGamma(Math.max(0, v)))) * 255));
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Move a colour's OKLCH lightness away from `against` (up from a dark colour, down from a light one) until the pair reaches `min` contrast. → hex or null */
function fitContrast(lch, against, min) {
  const up = hexToOklch(against).l < 0.6;
  for (let step = 0; step <= 100; step += 1) {
    const l = lch.l + (up ? 1 : -1) * step * 0.01;
    if (l < 0 || l > 1) break;
    const hex = oklchToHex({ ...lch, l });
    if (contrastRatio(hex, against) >= min) return hex;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Palette (§3.2): harmony scheme in OKLCH, then contrast

/** The pairs a generated palette must pass: text 4.5:1, large type and marks 3:1. */
export const PALETTE_CONTRAST = Object.freeze([
  Object.freeze({ pair: ['paper', 'bg'], min: 4.5, use: 'text' }),
  Object.freeze({ pair: ['ink', 'primary'], min: 4.5, use: 'text' }),
  Object.freeze({ pair: ['ink', 'paper'], min: 4.5, use: 'text', unless: 'ink-is-bg' }),
  Object.freeze({ pair: ['primary', 'bg'], min: 3, use: 'large' }),
  Object.freeze({ pair: ['accent', 'bg'], min: 3, use: 'large' }),
  Object.freeze({ pair: ['ink', 'accent'], min: 3, use: 'large' })
]);

/** Contrast findings for brand colours against PALETTE_CONTRAST. → [{pair, ratio, min, use, ok}] */
export function paletteContrast(colors) {
  return PALETTE_CONTRAST.filter((rule) => !(rule.unless === 'ink-is-bg' && colors.ink === colors.bg)).map((rule) => {
    const ratio = contrastRatio(colors[rule.pair[0]], colors[rule.pair[1]]);
    return { pair: rule.pair.join('/'), ratio: round(ratio, 2), min: rule.min, use: rule.use, ok: ratio >= rule.min };
  });
}

const MIN_HUE_GAP = 30;

function schemeHues(s, scheme, base) {
  const side = s.chance(0.5) ? 1 : -1;
  switch (scheme) {
    case 'complementary': return base + 180 + s.range(-15, 15);
    case 'split-complementary': return base + 180 + side * s.range(25, 40);
    case 'analogous': return base + side * s.range(35, 55);
    case 'triadic': return base + side * s.range(112, 128);
    case 'duotone': return base + side * s.range(70, 110);
    default: return base;
  }
}

function drawPalette(s, { theme, scheme, tone }) {
  const t = TONE_TABLE[tone] ?? NO_TONE;
  const base = s.range(0, 360);
  const accentHue = (schemeHues(s, scheme, base) + 360) % 360;
  const tint = theme === 'tinted' ? (s.chance(0.6) ? 'deep' : 'pale') : null;
  const dark = theme === 'dark' || tint === 'deep';
  const bgHue = scheme === 'duotone' || s.chance(0.7) ? base : accentHue;
  const bg = theme === 'dark' ? { l: s.range(0.13, 0.22), c: s.range(0.006, 0.03), h: bgHue }
    : theme === 'light' ? { l: s.range(0.955, 0.985), c: s.range(0.004, 0.018), h: bgHue }
    : tint === 'deep' ? { l: s.range(0.2, 0.3), c: s.range(0.04, 0.08), h: bgHue }
    : { l: s.range(0.88, 0.93), c: s.range(0.025, 0.05), h: bgHue };
  const paper = dark ? { l: s.range(0.93, 0.985), c: s.range(0.005, 0.025), h: bgHue } : { l: s.range(0.17, 0.27), c: s.range(0.01, 0.04), h: bgHue };
  const chroma = s.range(...t.chroma);
  const primary = { l: dark ? s.range(0.72, 0.86) : s.range(0.48, 0.58), c: chroma, h: base };
  const accent = scheme === 'monochrome'
    ? { l: primary.l + (dark ? -1 : 1) * s.range(0.08, 0.14), c: chroma * s.range(0.45, 0.7), h: base + s.range(-8, 8) }
    : { l: dark ? s.range(0.68, 0.84) : s.range(0.45, 0.58), c: chroma * s.range(0.8, 1.1), h: accentHue };
  const bgHex = oklchToHex(bg);
  const colors = { bg: bgHex };
  colors.paper = fitContrast(paper, bgHex, 4.5);
  colors.ink = dark ? bgHex : oklchToHex({ l: s.range(0.985, 1), c: s.range(0, 0.01), h: bgHue });
  // primary must read on bg (3:1) and carry ink text (4.5:1); both push it the same way.
  colors.primary = fitContrast(primary, bgHex, 3);
  if (colors.primary && contrastRatio(colors.ink, colors.primary) < 4.5) colors.primary = fitContrast(hexToOklch(colors.primary), colors.ink, 4.5);
  colors.accent = fitContrast({ ...accent, h: (accent.h + 360) % 360 }, bgHex, 3);
  if (colors.accent && contrastRatio(colors.ink, colors.accent) < 3) colors.accent = fitContrast(hexToOklch(colors.accent), colors.ink, 3);
  if (Object.values(colors).some((hex) => !hex)) return null;
  if (!paletteContrast(colors).every((entry) => entry.ok)) return null;
  if (scheme !== 'monochrome' && hueGap(hexToOklch(colors.primary).h, hexToOklch(colors.accent).h) < MIN_HUE_GAP) return null;
  if (colors.primary === colors.accent) return null;
  return { colors, dark };
}

// ---------------------------------------------------------------------------
// Fingerprint (§3.6)

const slug = (family) => (registeredFamily(family) ? FONT_REGISTRY[registeredFamily(family)].slug : String(family ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-'));
const grammarOf = (pack) => (typeof pack?.motion?.grammar === 'string' ? pack.motion.grammar : pack?.motion?.grammar?.base ?? 'editorial');

/** The parts of a look a viewer recognises: palette in OKLab, type pairing, panel, grammar and caption preset. */
export function styleFingerprint(pack) {
  const colors = { ...FALLBACK_LOOK.colors, ...(pack?.brand?.colors ?? {}) };
  const fonts = pack?.brand?.fonts ?? {};
  return {
    palette: Object.fromEntries(['bg', 'paper', 'primary', 'accent'].map((role) => [role, hexToOklab(colors[role]).map((v) => round(v, 4))])),
    theme: hexToOklch(colors.bg).l < 0.6 ? 'dark' : 'light',
    fonts: `${slug(fonts.display ?? 'anton')}/${slug(fonts.body ?? 'inter')}`,
    panel: pack?.layouts?.panel?.treatment ?? 'solid',
    grammar: grammarOf(pack),
    caption: pack?.captions?.preset ?? 'word-highlight'
  };
}

/** A short string for a fingerprint; equal strings mean the same look. */
export function fingerprintKey(fingerprint) {
  const p = fingerprint.palette;
  const lch = (lab) => `${Math.round(lab[0] * 50)}.${Math.round(Math.hypot(lab[1], lab[2]) * 50)}.${Math.round(((Math.atan2(lab[2], lab[1]) * 180) / Math.PI + 360) % 360 / 10)}`;
  return [fingerprint.theme, ...['bg', 'paper', 'primary', 'accent'].map((role) => lch(p[role])), fingerprint.fonts, fingerprint.panel, fingerprint.grammar, fingerprint.caption].join('|');
}

const labDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The mean OKLab distance of the four palette roles (0 = the same palette). */
export function paletteDistance(a, b) {
  return ['bg', 'paper', 'primary', 'accent'].reduce((sum, role) => sum + labDistance(a.palette[role], b.palette[role]), 0) / 4;
}

/**
 * How different two looks are, 0–1: the palette counts for half (its mean
 * OKLab distance over 0.25, capped), then fonts, panel, grammar and caption
 * preset for an eighth each.
 */
export function styleDistance(a, b) {
  const palette = Math.min(1, paletteDistance(a, b) / 0.25);
  const parts = ['fonts', 'panel', 'grammar', 'caption'].reduce((sum, key) => sum + (a[key] === b[key] ? 0 : 0.125), 0);
  return round(palette * 0.5 + parts, 4);
}

// The looks a generated style must not resemble: the five starters in
// kit/styles (test/style_seed.test.js checks this table against the files)
// and the renderers' fallback when a story names no brand.
const FALLBACK_LOOK = Object.freeze({ name: 'fallback', colors: Object.freeze({ bg: '#0b0b0f', paper: '#f5f3ee', ink: '#0b0b0f', primary: '#ffd23f', accent: '#46d4ff' }), fonts: Object.freeze({ display: 'anton', body: 'inter' }), panel: 'solid', grammar: 'editorial', caption: 'word-highlight' });
export const AVOID_LOOKS = Object.freeze([
  Object.freeze({ name: 'bold-creator', colors: { bg: '#0b0b0b', paper: '#ffffff', ink: '#0b0b0b', primary: '#ffe14d', accent: '#ff3d7f' }, fonts: { display: 'anton', body: 'archivo-black' }, panel: 'solid', grammar: 'snappy', caption: 'outline-heavy' }),
  Object.freeze({ name: 'editorial-dark', colors: { bg: '#0e0f12', paper: '#f1ede4', ink: '#0e0f12', primary: '#e8b04a', accent: '#7fb8a4' }, fonts: { display: 'stix-two-text', body: 'inter' }, panel: 'solid', grammar: 'editorial', caption: 'minimal-line' }),
  Object.freeze({ name: 'minimal-tech', colors: { bg: '#f4f5f7', paper: '#0f1720', ink: '#ffffff', primary: '#2257e8', accent: '#00866a' }, fonts: { display: 'space-grotesk', body: 'inter' }, panel: 'glass', grammar: 'smooth', caption: 'underline-sweep' }),
  Object.freeze({ name: 'neon-explainer', colors: { bg: '#07051a', paper: '#f4f1ff', ink: '#07051a', primary: '#19f0ff', accent: '#ff4fd8' }, fonts: { display: 'bricolage-grotesque', body: 'space-grotesk' }, panel: 'glass', grammar: 'playful', caption: 'glow' }),
  Object.freeze({ name: 'warm-documentary', colors: { bg: '#1c1612', paper: '#f3e6d0', ink: '#1c1612', primary: '#e08a34', accent: '#9cbf86' }, fonts: { display: 'instrument-serif', body: 'stix-two-text' }, panel: 'paper', grammar: 'documentary', caption: 'lower-band' }),
  FALLBACK_LOOK
]);
const lookPack = (look) => ({ brand: { colors: look.colors, fonts: look.fonts }, layouts: { panel: { treatment: look.panel } }, motion: { grammar: look.grammar }, captions: { preset: look.caption } });
const AVOID_FINGERPRINTS = AVOID_LOOKS.map((look) => ({ name: look.name, fingerprint: styleFingerprint(lookPack(look)) }));

/** A generated look must sit at least this far (styleDistance) from every starter, with a palette at least MIN_PALETTE_DISTANCE away. */
export const MIN_STARTER_DISTANCE = 0.3;
export const MIN_PALETTE_DISTANCE = 0.06;

/** The nearest starter (or fallback) look to a pack. → {name, distance, palette, close} */
export function nearestStarter(pack) {
  const fingerprint = styleFingerprint(pack);
  let best = null;
  for (const entry of AVOID_FINGERPRINTS) {
    const distance = styleDistance(fingerprint, entry.fingerprint);
    if (!best || distance < best.distance) best = { name: entry.name, distance, palette: round(paletteDistance(fingerprint, entry.fingerprint), 4) };
  }
  return { ...best, close: best.distance < MIN_STARTER_DISTANCE || best.palette < MIN_PALETTE_DISTANCE };
}

// ---------------------------------------------------------------------------
// The pack

// Categorical choices: each dimension cuts the seed line into blocks of n
// (its option count, weights repeating an option) and gives every block its
// own shuffled order, from an independent hash of (dimension, block). Inside
// a block every option appears once, so any 2n consecutive seeds cover all n
// options; across blocks the orders are unrelated, so two dimensions never
// move in lockstep and every combination of them stays reachable. A plain
// (seed × k) mod n would tie dimensions of the same n together.
function spread(hex, name, entries) {
  const list = entries.flatMap((entry) => (Array.isArray(entry) ? Array(entry[1]).fill(entry[0]) : [entry]));
  const n = list.length;
  const seed = parseInt(hex, 16);
  const block = Math.floor(seed / n), slot = seed % n;
  const random = seededRandom(hash32(`${name}:${block}`));
  const order = list.map((_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) { const k = Math.floor(random() * (i + 1)); [order[i], order[k]] = [order[k], order[i]]; }
  return list[order[slot]];
}

const asObject = (value, key) => (value == null ? null : typeof value === 'string' ? { [key]: value } : value);

/** Clean constraints: only CONSTRAINT_KEYS, strings trimmed, empty values dropped. Throws on a tone or theme it does not know. */
export function normalizeConstraints(constraints = {}) {
  const out = {};
  for (const key of CONSTRAINT_KEYS) {
    const value = constraints?.[key];
    if (value === undefined || value === null || value === '') continue;
    out[key] = typeof value === 'string' ? value.trim().toLowerCase() : value;
  }
  if (out.tone !== undefined && !TONES.includes(out.tone)) throw new Error(`tone must be one of ${TONES.join(', ')}`);
  if (out.theme !== undefined && !THEMES.includes(out.theme)) throw new Error(`theme must be one of ${THEMES.join(', ')}`);
  if (out.character_set !== undefined && !CHARACTER_SET_NAMES.includes(out.character_set)) throw new Error(`character_set must be one of ${CHARACTER_SET_NAMES.join(', ')}`);
  const worlds = out.world === undefined ? [] : Array.isArray(out.world) ? out.world : [typeof out.world === 'string' ? out.world : out.world?.kind];
  for (const kind of worlds) if (!WORLD_KINDS.includes(kind)) throw new Error(`world must be one of ${WORLD_KINDS.join(', ')}`);
  if (Array.isArray(out.world) && !out.world.length) delete out.world;
  return out;
}

const MAX_REDRAWS = 24;

/**
 * A complete launchclip.style.v3 pack for a seed. `tone` (or
 * constraints.tone) narrows the families; the other constraints pin their
 * dimension. `at` (an ISO date) is recorded in the provenance block when
 * given, so the same seed, tone and constraints always give the same pack
 * apart from it.
 */
export function generateStyle({ seed, tone = null, constraints = {}, at } = {}) {
  const hex = normalizeSeed(seed ?? randomSeed());
  const fixed = normalizeConstraints({ ...constraints, ...(tone ? { tone } : {}) });
  const toneName = fixed.tone ?? null;
  const t = TONE_TABLE[toneName] ?? NO_TONE;

  let pack = null;
  let redraws = 0;
  for (; redraws <= MAX_REDRAWS; redraws += 1) {
    const candidate = buildPack(hex, toneName, t, fixed, redraws);
    if (!candidate) continue;
    if (nearestStarter(candidate).close) continue;
    pack = candidate;
    break;
  }
  if (!pack) throw new Error(`seed ${hex} found no palette that passes contrast and starter distance; try another seed`);
  pack.generated = {
    seed: hex, generator: GENERATOR_VERSION, tone: toneName, ...(at ? { at } : {}),
    ...(Object.keys(fixed).length ? { constraints: fixed } : {}),
    ...pack.generated, ...(redraws ? { redraws } : {})
  };
  const order = ['schema', 'name', 'description', 'generated', 'brand', 'motion', 'camera', 'ambient', 'captions', 'sound', 'layout', 'layouts', 'background', 'vocabulary', 'variants', 'cast', 'world', 'brand_frame', 'dials'];
  const sorted = Object.fromEntries(order.filter((key) => pack[key] !== undefined).map((key) => [key, pack[key]]));
  const validation = validateStylePack(sorted);
  if (!validation.ok) throw new Error(`generated style ${sorted.name} is invalid:\n- ${validation.errors.join('\n- ')}`);
  return sorted;
}

function buildPack(hex, toneName, t, fixed, attempt) {
  const draw = (name) => stream(hex, attempt ? `${name}#${attempt}` : name);
  // Categorical choices are fixed per seed (a redraw only redraws the palette,
  // which is half the starter distance), so consecutive seeds keep stepping
  // through every option.
  const choose = (name, entries) => spread(hex, name, entries);
  const theme = fixed.theme ?? choose('theme', t.themes);
  const scheme = choose('scheme', PALETTE_SCHEMES);
  let palette = null;
  const paletteStream = draw('palette');
  for (let i = 0; i < 12 && !palette; i += 1) palette = drawPalette(paletteStream, { theme, scheme, tone: toneName });
  if (!palette) return null;

  const pairings = toneName ? FONT_PAIRINGS.filter((entry) => entry.tones.includes(toneName)) : FONT_PAIRINGS;
  const pairing = choose('type', pairings);

  const motion = draw('motion');
  const grammar = choose('grammar', t.grammars);
  const transitions = [...GRAMMAR_TRANSITIONS[grammar]];
  const preference = [];
  while (preference.length < 2 + Math.floor(motion.random() * 2) && transitions.length) preference.push(transitions.splice(Math.floor(motion.random() * transitions.length), 1)[0]);
  const camera = WORLD_GRAMMARS.has(grammar) && motion.chance(0.5) ? { mode: 'world', layout: 'auto' } : { mode: 'cuts' };

  const panelStream = draw('panel');
  const panelFixed = asObject(fixed.panel, 'treatment') ?? {};
  const treatment = choose('panel', SEED_PANEL_TREATMENTS);
  const radius = 2 * Math.round(panelStream.range(0, 16));
  const panel = { treatment: panelFixed.treatment ?? treatment, radius: panelFixed.radius ?? radius };
  const backgroundFixed = asObject(fixed.background, 'kind') ?? {};
  const drawn = choose('background', SEED_BACKGROUND_KINDS);
  const fade = choose('fade', SEED_FADES);
  const kind = backgroundFixed.kind ?? drawn;
  const drawnParams = drawBackgroundParams(draw('background-params'), kind);
  const background = { kind, params: backgroundFixed.params ?? (kind === 'blobs' ? {} : { ...drawnParams, fade }) };
  const fillStream = draw('panel-fill');
  const fillKind = choose('panel-fill', SEED_PANEL_FILLS);
  const fillFade = choose('panel-fill-fade', SEED_FADES);
  const fillParams = drawBackgroundParams(fillStream, fillKind, { fill: true });
  if (panelFixed.fill === undefined && panel.treatment !== 'glass' && fillStream.chance(PANEL_FILL_CHANCE)) panel.fill = { kind: fillKind, params: { ...fillParams, fade: fillFade } };
  else if (panelFixed.fill) panel.fill = panelFixed.fill;
  let level = choose('ambient', t.ambient);
  if (kind === 'blobs' && level === 'off') level = 'subtle';

  const presets = GRAMMAR_CAPTIONS[grammar].filter((name) => palette.dark || LIGHT_CAPTIONS.has(name));
  const caption = choose('captions', presets.length ? presets : ['minimal-line']);

  const vocab = draw('vocabulary');
  const vocabulary = { icon_tint: vocab.pick(['primary', 'accent']), icon_stroke: 1.25 + 0.25 * Math.floor(vocab.random() * 6), icon_style: choose('icon-style', SEED_ICON_STYLES), illustration: choose('illustration', SEED_ILLUSTRATIONS), prefer: {} };
  const variants = Object.fromEntries(Object.entries(SEED_MODULE_VARIANTS).map(([id, list]) => [id, choose(`variant:${id}`, list)]));

  const cast = {
    drawing_style: fixed.drawing_style ?? choose('drawing-style', SEED_DRAWING_STYLES),
    set: fixed.character_set ?? choose('character-set', SEED_CHARACTER_SETS),
    colors: { fill: 'primary', accent: 'accent', line: palette.dark ? 'paper' : 'ink' },
    members: []
  };
  const castStream = draw('cast');
  cast.members = generateCast({ seed: `${hex}${attempt ? `#${attempt}` : ''}`, set: cast.set, count: 2 + Math.floor(castStream.random() * 3), palette: palette.colors });
  // A list (suggestWorld's fitting worlds) is a constraint the seed picks within.
  const worldPick = Array.isArray(fixed.world) ? choose('world', fixed.world) : null;
  const worldFixed = worldPick ? { kind: worldPick } : asObject(fixed.world, 'kind');
  const worldKind = SEED_WORLDS.length ? choose('world', SEED_WORLDS) : null;
  const worldTime = choose('world-time', NIGHT_TONES.has(toneName) ? STYLE_WORLD_TIMES.map((time) => [time, 1]) : SEED_WORLD_TIMES);
  const world = worldFixed ? { kind: worldFixed.kind, time: worldFixed.time ?? worldTime } : worldKind ? { kind: worldKind, time: worldTime } : undefined;

  const frame = draw('frame');
  // Off by default: a generated style has no brand name to put in a kicker.
  const brand_frame = {
    enabled: false,
    kicker: { underline: frame.chance(0.6), position: frame.pick(STYLE_FRAME_POSITIONS.filter((p) => p.startsWith('top'))), logo: false },
    sections: frame.chance(0.6),
    progress: frame.chance(0.5) ? { position: frame.pick(['top', 'bottom']), thickness: 3 + Math.floor(frame.random() * 4), ticks: frame.chance(0.5) } : false,
    show: 'always'
  };

  const dialStream = draw('dials');
  const dials = Object.fromEntries(Object.entries(t.dials).map(([key, centre]) => [key, round(Math.max(0.05, Math.min(0.95, centre + dialStream.range(-0.12, 0.12))), 2)]));
  const music = draw('sound');
  const fits = TONE_SOUND[toneName] ?? { palettes: SEED_SOUND_PALETTES, genres: SEED_MUSIC_GENRES };
  const soundPalette = choose('sound-palette', fits.palettes);
  const genre = choose('genre', fits.genres);
  const spec = GENRE_SPECS[genre];

  const fonts = { display: pairing.display, body: pairing.body, meta: pairing.meta };
  const pack = {
    schema: STYLE_SCHEMA,
    name: `seed-${hex}`,
    brand: { colors: palette.colors, fonts },
    motion: { grammar, transition_preference: preference },
    camera,
    ambient: { level, background: kind === 'blobs' },
    captions: { preset: caption, position: 'auto', lanes: { 'footage-led': { ...STYLE_V3_DEFAULTS.caption_lanes['footage-led'] } } },
    sound: {
      palette: soundPalette,
      music: { genre, bpm: Math.round(music.range(spec.bpm[0], spec.bpm[1])), key: music.pick(spec.keys), progression: Math.floor(music.random() * spec.progressions), prompt_hints: [music.pick(t.music), music.pick(t.music)].filter((v, i, list) => list.indexOf(v) === i), bpm_range: [...spec.bpm] },
      ambience: choose('ambience', SEED_AMBIENCE),
      sfx_density: t.sfx
    },
    layout: { title_case: pairing.case === 'title' },
    layouts: { by_intent: {}, by_section: {}, panel },
    background,
    vocabulary,
    variants,
    cast,
    ...(world ? { world } : {}),
    brand_frame,
    dials,
    generated: { theme, scheme, pairing: pairing.id }
  };
  pack.description = `Generated from seed ${hex}: ${styleSummary(pack, { seed: false })}.`;
  return pack;
}

const familyName = (value) => registeredFamily(value) ?? value;

/** "dark, playful, Unbounded / Inter" — or, with seed (the default), "seed 7f3a91c2 (dark, playful, Unbounded / Inter)". */
export function styleSummary(pack, { seed = true } = {}) {
  const theme = pack?.generated?.theme ?? styleFingerprint(pack).theme;
  const fonts = pack?.brand?.fonts ?? {};
  const inner = `${theme}, ${grammarOf(pack)}, ${familyName(fonts.display ?? 'anton')} / ${familyName(fonts.body ?? 'inter')}`;
  return seed && pack?.generated?.seed ? `seed ${pack.generated.seed} (${inner})` : inner;
}

/** The one line make and story plan print (§4). */
export function seedSummaryLine(pack) {
  return `style: ${styleSummary(pack)}. Reroll with launchclip style reroll`;
}

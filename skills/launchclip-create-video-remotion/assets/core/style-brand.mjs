// Brand inputs for generated styles (docs/SEEDED_STYLES_RFC.md §3.7): what a
// host product knows about a brand, normalised into one canonical record the
// seeded generator (style-seed.mjs) conditions on. Every field is optional;
// whatever is missing is left to the seed.
//
//   brand = {
//     name?:       "Northwind"                      the kicker label and lockup
//     colors?:     ["#0b3d91", ...]                 colours without roles, most important first
//                | {primary: "#0b3d91", background: "#fff", ...}   colours with roles
//                | [{hex: "#0b3d91", role?: "primary"}, ...]
//     logo?:       "assets/logo.svg" | "<svg …>" | {src?, svg?, colors?}
//     fonts?:      {display?, body?, meta?} | ["Display", "Body"] | "Display"
//     tone?:       "warm, friendly" | ["warm", "friendly"]   tone words
//     industry?:   "coffee roasting"
//     references?: ["assets/still.jpg", {src?, colors?}, ...]   reference stills
//   }
//
// Colours keep the roles they were given. Colours without one, then the
// logo's and the stills' colours, fill the roles still open: the first
// chromatic colour is primary, the next one at least 30° of hue away is
// accent, and a near-neutral very dark or very light colour the host listed
// is bg. Roles still open after that are drawn by the seed around the brand's
// hue. A logo or still given as a file carries only the colours the host
// extracted from it (the CLI extracts them; this module never reads files).
//
// Fonts: only the bundled OFL families (kit/core/fonts.mjs) are ever drawn. A
// brand font outside them maps to the nearest bundled family, and the swap is
// reported (substituted) so a host can show it.
//
// Pure ESM that imports only kit/core siblings. Canonical copy:
// kit/core/style-brand.mjs.

import { FONT_REGISTRY, fontFamilyName, registeredFamily } from './fonts.mjs';
import { hexToOklch, hueGap } from './oklch.mjs';
import { nearestBundledFont } from './style.mjs';

export const BRAND_ROLES = Object.freeze(['bg', 'paper', 'ink', 'primary', 'accent']);
// Role names hosts use → the style's roles. In a style, paper is the text
// colour on bg and ink the text colour on primary.
export const BRAND_ROLE_ALIASES = Object.freeze({
  bg: 'bg', background: 'bg', base: 'bg', canvas: 'bg',
  paper: 'paper', text: 'paper', foreground: 'paper', fg: 'paper',
  ink: 'ink', 'on-primary': 'ink', on_primary: 'ink', 'text-on-primary': 'ink',
  primary: 'primary', brand: 'primary', main: 'primary',
  accent: 'accent', secondary: 'accent', highlight: 'accent'
});
export const BRAND_MAX_COLORS = 16;
const MIN_ACCENT_GAP = 30;
const CHROMATIC = 0.04;

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value, max, where) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`${where} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`${where} must be at most ${max} characters`);
  return trimmed || undefined;
};

/** "#ABC" / "abc" / "#aabbcc" → "#aabbcc". Throws on anything else. */
export function normalizeHex(value, where = 'colour') {
  const raw = String(value ?? '').trim().toLowerCase().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${[...raw].map((c) => c + c).join('')}`;
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`;
  throw new Error(`${where} must be a hex colour such as #0b3d91; got ${JSON.stringify(value)}`);
}

/** The colours an SVG draws with (fill, stroke, stop-color; hex or rgb()), most used first. */
export function svgColors(svg) {
  const counts = new Map();
  const add = (hex) => counts.set(hex, (counts.get(hex) ?? 0) + 1);
  const source = String(svg ?? '');
  for (const match of source.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) add(normalizeHex(match[1]));
  for (const match of source.matchAll(/rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/g)) {
    add(`#${match.slice(1, 4).map((v) => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('')}`);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
}

const unique = (list) => list.filter((value, i) => list.indexOf(value) === i);

function normalizeColors(colors) {
  const roles = {};
  const extra = [];
  const assign = (role, hex, where) => {
    const key = BRAND_ROLE_ALIASES[String(role).trim().toLowerCase()];
    if (!key) { extra.push(normalizeHex(hex, where)); return; }
    if (roles[key] !== undefined) throw new Error(`brand.colors gives ${key} twice`);
    roles[key] = normalizeHex(hex, where);
  };
  if (colors === undefined || colors === null) return { roles, extra };
  // A record normalizeBrand already made ({roles, extra}) reads back as itself.
  if (isObject(colors) && Object.keys(colors).every((key) => key === 'roles' || key === 'extra') && (isObject(colors.roles) || Array.isArray(colors.extra))) {
    for (const [role, hex] of Object.entries(colors.roles ?? {})) assign(role, hex, `brand.colors.roles.${role}`);
    for (const [i, hex] of (colors.extra ?? []).entries()) extra.push(normalizeHex(hex, `brand.colors.extra[${i}]`));
    return { roles, extra: unique(extra) };
  }
  if (Array.isArray(colors)) {
    colors.forEach((entry, i) => {
      if (typeof entry === 'string') extra.push(normalizeHex(entry, `brand.colors[${i}]`));
      else if (isObject(entry)) { if (entry.role) assign(entry.role, entry.hex, `brand.colors[${i}].hex`); else extra.push(normalizeHex(entry.hex, `brand.colors[${i}].hex`)); }
      else throw new Error(`brand.colors[${i}] must be a hex colour or {hex, role?}`);
    });
  } else if (isObject(colors)) {
    // Unknown role names keep the host's order of keys (sorted, so the record is canonical).
    for (const key of Object.keys(colors).sort()) assign(key, colors[key], `brand.colors.${key}`);
  } else throw new Error('brand.colors must be a list of hex colours or {role: hex}');
  if (Object.keys(roles).length + extra.length > BRAND_MAX_COLORS) throw new Error(`brand.colors takes at most ${BRAND_MAX_COLORS} colours`);
  return { roles, extra: unique(extra) };
}

function normalizeImage(value, where) {
  if (value === undefined || value === null) return undefined;
  const entry = typeof value === 'string' ? (value.trim().startsWith('<svg') ? { svg: value } : { src: value }) : value;
  if (!isObject(entry)) throw new Error(`${where} must be a path, SVG markup or {src?, svg?, colors?}`);
  const colors = [...(Array.isArray(entry.colors) ? entry.colors.map((hex, i) => normalizeHex(hex, `${where}.colors[${i}]`)) : []), ...svgColors(entry.svg)];
  const src = text(entry.src, 512, `${where}.src`);
  return { ...(src ? { src } : {}), colors: unique(colors).slice(0, BRAND_MAX_COLORS) };
}

function normalizeFonts(fonts) {
  if (fonts === undefined || fonts === null) return {};
  const entries = typeof fonts === 'string' ? { display: fonts } : Array.isArray(fonts) ? { display: fonts[0], body: fonts[1], meta: fonts[2] } : fonts;
  if (!isObject(entries)) throw new Error('brand.fonts must be {display?, body?, meta?}, a list or one family name');
  const out = {};
  for (const role of ['display', 'body', 'meta']) { const name = text(entries[role], 64, `brand.fonts.${role}`); if (name) out[role] = name; }
  return out;
}

const words = (value) => (Array.isArray(value) ? value : String(value ?? '').split(/[,;/]+/)).map((word) => String(word).trim().toLowerCase()).filter(Boolean);

/**
 * A brand input → the canonical record the generator conditions on and
 * stores in its provenance: {name?, colors: {roles, extra}, logo?, fonts,
 * tone_words, industry?, references}. Throws on a malformed colour or field.
 */
export function normalizeBrand(brand = {}) {
  if (brand === undefined || brand === null) brand = {};
  if (!isObject(brand)) throw new Error('brand must be an object');
  const known = new Set(['name', 'colors', 'logo', 'fonts', 'tone', 'tone_words', 'industry', 'references']);
  for (const key of Object.keys(brand)) if (!known.has(key)) throw new Error(`brand.${key} is not a brand input (allowed: ${[...known].join(', ')})`);
  const name = text(brand.name, 40, 'brand.name');
  const logo = normalizeImage(brand.logo, 'brand.logo');
  const industry = text(brand.industry, 80, 'brand.industry');
  const references = (Array.isArray(brand.references) ? brand.references : brand.references ? [brand.references] : []).slice(0, 8).map((entry, i) => normalizeImage(entry, `brand.references[${i}]`));
  return {
    ...(name ? { name } : {}),
    colors: normalizeColors(brand.colors),
    ...(logo ? { logo } : {}),
    fonts: normalizeFonts(brand.fonts),
    tone_words: unique(words([...words(brand.tone), ...words(brand.tone_words)])).slice(0, 12),
    ...(industry ? { industry } : {}),
    references
  };
}

/** Whether a normalised brand gives anything at all. */
export function brandIsEmpty(brand) {
  return !brand || (!brand.name && !Object.keys(brand.colors.roles).length && !brand.colors.extra.length && !brand.logo && !Object.keys(brand.fonts).length && !brand.tone_words.length && !brand.industry && !brand.references.length);
}

/**
 * The style roles a normalised brand fixes → {bg?, paper?, ink?, primary?,
 * accent?}. Given roles first; then the first chromatic colour of the host's
 * list, the logo and the stills is primary, and the next at least 30° of hue
 * away is accent; a near-neutral very dark or very light colour the host
 * listed (never a logo's, which is usually the logo's own ground) is bg.
 */
export function brandRoles(brand) {
  const roles = { ...brand.colors.roles };
  const used = new Set(Object.values(roles));
  const pool = unique([...brand.colors.extra, ...(brand.logo?.colors ?? []), ...brand.references.flatMap((entry) => entry.colors)]).filter((hex) => !used.has(hex));
  const lch = new Map(pool.map((hex) => [hex, hexToOklch(hex)]));
  const chromatic = pool.filter((hex) => lch.get(hex).c >= CHROMATIC);
  if (!roles.primary && chromatic.length) roles.primary = chromatic[0];
  if (!roles.accent && roles.primary) {
    const hue = hexToOklch(roles.primary).h;
    const next = chromatic.find((hex) => hex !== roles.primary && hueGap(lch.get(hex).h, hue) >= MIN_ACCENT_GAP);
    if (next) roles.accent = next;
  }
  if (!roles.bg) {
    const ground = brand.colors.extra.find((hex) => hex !== roles.primary && hex !== roles.accent && lch.get(hex)?.c < 0.05 && (lch.get(hex).l < 0.3 || lch.get(hex).l > 0.93));
    if (ground) roles.bg = ground;
  }
  return roles;
}

const slugOf = (family) => FONT_REGISTRY[family].slug;

// Popular brand families outside the bundled set → the bundled OFL family
// that sets closest to them, by role (a display face keeps its character; a
// body face keeps its texture). Anything else falls to style.mjs
// nearestBundledFont.
export const BRAND_FONT_NEAREST = Object.freeze([
  [/montserrat|poppins|gotham|futura|avenir|proxima|circular|gilroy|nunito|raleway|josefin|quicksand|urbanist|figtree/i, { display: 'Outfit', body: 'Plus Jakarta Sans' }],
  [/bebas|league gothic|barlow condensed|din condensed|impact|anton|fjalla|teko|saira condensed|roboto condensed/i, { display: 'Oswald', body: 'DM Sans' }],
  [/rubik|varela|m plus rounded|nunito sans|comfortaa|baloo|fredoka/i, { display: 'Lexend', body: 'Lexend' }],
  [/space mono|ibm plex mono|roboto mono|source code|courier|menlo|consolas|sf mono|geist mono/i, { display: 'Space Grotesk', body: 'Inter', meta: 'JetBrains Mono' }],
  [/helvetica|neue haas|aktiv|graphik|sf pro|san francisco|roboto|arial|open sans|lato|source sans|noto sans|ibm plex sans|geist|segoe|work sans/i, { display: 'Plus Jakarta Sans', body: 'Inter' }],
  [/merriweather|lora|libre baskerville|baskerville|garamond|georgia|times|caslon|crimson|spectral|source serif|noto serif|pt serif/i, { display: 'Fraunces', body: 'Inter' }],
  [/didot|bodoni|abril|vogue|canela|ogg|gt sectra|tiempos|domaine|freight/i, { display: 'Playfair Display', body: 'DM Sans' }]
]);

function nearestFamily(name, role) {
  for (const [pattern, families] of BRAND_FONT_NEAREST) if (pattern.test(String(name ?? '')) && families[role]) return families[role];
  return nearestBundledFont(name, role);
}

/**
 * Brand fonts → bundled slugs {display?, body?, meta?} plus the swaps made:
 * substituted [{role, from, to}] for every family outside the bundled OFL set.
 */
export function brandFonts(brand) {
  const fonts = {};
  const substituted = [];
  for (const [role, name] of Object.entries(brand.fonts ?? {})) {
    const registered = registeredFamily(fontFamilyName(name) ?? '');
    const family = registered && FONT_REGISTRY[registered] ? registered : nearestFamily(name, role);
    fonts[role] = slugOf(family);
    if (family !== registered) substituted.push({ role, from: name, to: family });
  }
  return { fonts, substituted };
}

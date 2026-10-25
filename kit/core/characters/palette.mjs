// Character colours: the rig's colour slots and how they resolve.
//
// A character names its colours by slot (skin, hair, top, bottom, shoes,
// accent). Each value is a palette name (a skin tone, a hair colour or a
// clothing neutral below), a brand role (primary, accent, paper, ink, bg),
// or a six-digit hex. Brand roles come from the story brand, overridden by
// the cast's colour mapping (story.cast.colors or a style's cast mapping),
// so one cast dresses in each brand's colours without changing who they are.
//
// Imports only sibling kit/core files.

import {mixColor} from '../catalog-b-base.mjs';

export const SKIN_TONES = Object.freeze({
  'porcelain': '#f7dcc8',
  'fair': '#f0c7a8',
  'light': '#e4b08a',
  'medium': '#cf9668',
  'tan': '#b47a4e',
  'brown': '#91593a',
  'deep': '#6e4029',
  'ebony': '#4b2a1b',
  'ivory': '#f9e4d0',
  'rosy': '#efc0a4',
  'beige': '#e8bf98',
  'almond': '#d9a57a',
  'golden': '#c58a55',
  'bronze': '#a5683f',
  'umber': '#7e4a2f',
  'mahogany': '#5e3423'
});

export const HAIR_COLORS = Object.freeze({
  'black': '#1f1a1c',
  'espresso': '#35251c',
  'brown': '#624330',
  'chestnut': '#7d4325',
  'auburn': '#9a3f1f',
  'copper': '#c26a2c',
  'blonde': '#d8b06a',
  'platinum': '#ece0c2',
  'grey': '#a9a5a2',
  'silver': '#d7d4d0',
  'jet': '#121012',
  'ash': '#8a7e72',
  'honey': '#c08a3e',
  'strawberry': '#d58a5b',
  'snow': '#f1efea',
  'pink-dye': '#e97fb2',
  'blue-dye': '#4f7fd8',
  'violet-dye': '#8a5cc8',
  'green-dye': '#3fae8a'
});

export const NEUTRALS = Object.freeze({
  'white': '#f7f5f0',
  'cream': '#efe4cf',
  'sand': '#d8c3a0',
  'stone': '#a59d92',
  'slate': '#5d6675',
  'charcoal': '#34373f',
  'navy': '#26324f',
  'denim': '#3f5a86',
  'olive': '#64693d',
  'forest': '#2f5b47',
  'brick': '#a2442e',
  'mustard': '#d39a2a',
  'teal': '#1f7a7a',
  'plum': '#6b3a5e',
  'rose': '#d9828a',
  'sky': '#7fb2dc',
  'black': '#1d1c21',
  'tan': '#a87a52',
  'burgundy': '#6e2433',
  'coral': '#e9765e',
  'lavender': '#b6a4d8',
  'mint': '#9fd8bf',
  'khaki': '#b9a878',
  'ochre': '#c58b2c',
  'indigo': '#3a3f8f',
  'sage': '#9cad8a',
  'ceil': '#7aa9c9',
  'red': '#c83a32',
  'tangerine': '#e98a2c',
  'lemon': '#ecd05a'
});

/** Skin tones from lightest to deepest, for generators that spread a cast across the range. */
export const SKIN_ORDER = Object.freeze(Object.entries(SKIN_TONES).sort((a, b) => luma(b[1]) - luma(a[1])).map(([name]) => name));
/** Hair colours that read as grey or white (seniors; brows drawn darker). */
export const GREY_HAIR = Object.freeze(['grey', 'silver', 'platinum', 'snow']);

function luma(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

export const BRAND_ROLES = Object.freeze(['primary', 'accent', 'paper', 'ink', 'bg']);
export const COLOR_SLOTS = Object.freeze(['skin', 'hair', 'top', 'bottom', 'shoes', 'accent']);
const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** Default outline: near-black with a little warmth. */
export const OUTLINE = '#231e28';

/** True when `value` names a colour this palette or a brand can resolve. */
export function isColorName(value) {
  return typeof value === 'string' && (HEX6.test(value) || BRAND_ROLES.includes(value) || Object.hasOwn(SKIN_TONES, value) || Object.hasOwn(HAIR_COLORS, value) || Object.hasOwn(NEUTRALS, value));
}

/**
 * Brand roles for a cast: the story brand's colours, overridden by the cast
 * mapping ({role: palette name | hex}). → {primary, accent, paper, ink, bg}.
 */
export function castRoles(brand, mapping = null) {
  const colors = brand?.colors ?? {};
  const roles = {primary: '#3d6fd8', accent: '#f0a531', paper: '#f7f5f0', ink: '#14161c', bg: '#14161c'};
  for (const role of BRAND_ROLES) if (HEX6.test(colors[role] ?? '')) roles[role] = colors[role].toLowerCase();
  for (const [role, value] of Object.entries(mapping ?? {})) {
    if (!BRAND_ROLES.includes(role)) continue;
    const hex = lookup(value, null);
    if (hex) roles[role] = hex;
  }
  return roles;
}

function lookup(value, roles) {
  if (typeof value !== 'string') return null;
  if (HEX6.test(value)) return value.toLowerCase();
  if (roles && BRAND_ROLES.includes(value)) return roles[value];
  return SKIN_TONES[value] ?? HAIR_COLORS[value] ?? NEUTRALS[value] ?? null;
}

/** One colour name → #rrggbb with these roles. Throws on an unknown name. */
export function resolveColor(value, roles, path = 'colour') {
  const hex = lookup(value, roles);
  if (!hex) throw new Error(`${path} ${JSON.stringify(value)} is not a palette colour, brand role (${BRAND_ROLES.join(', ')}) or six-digit hex`);
  return hex;
}

const shade = (hex, amount = 0.18) => mixColor(OUTLINE, hex, amount);
const light = (hex, amount = 0.22) => mixColor('#ffffff', hex, amount);

/**
 * Every colour the drawing uses, from a character's colour slots: the slots
 * themselves plus derived shades (shadows under the hair, inside the mouth).
 */
export function characterColors(colors, roles) {
  const out = {};
  for (const slot of COLOR_SLOTS) out[slot] = resolveColor(colors[slot], roles, `colors.${slot}`);
  return {
    ...out,
    outline: OUTLINE,
    skinShade: shade(out.skin, 0.2),
    skinLight: light(out.skin, 0.18),
    blush: mixColor('#e5575f', out.skin, 0.28),
    hairShade: shade(out.hair, 0.25),
    hairLight: light(out.hair, 0.16),
    topShade: shade(out.top, 0.2),
    topLight: light(out.top, 0.16),
    bottomShade: shade(out.bottom, 0.2),
    accentShade: shade(out.accent, 0.2),
    mouth: mixColor(OUTLINE, '#7a2b33', 0.55),
    tongue: '#e0787a',
    teeth: '#fbf8f2',
    eyeWhite: '#fbf9f5'
  };
}

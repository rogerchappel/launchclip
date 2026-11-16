// The working palette: what a story's brand colours become on screen. A
// brand's colours are inputs, not surfaces. A pale brand ground (a mint or
// blush tint, near-white paper) laid raw under every full-frame scene washes a
// video out, so a story derives a tonal ramp from its brand hue and places
// each surface by rule:
//
//   tonalRamp(colors)            → {deep, mid, light}: deep and mid are the
//                                  full-frame grounds, light the card and text
//                                  tone. The hue is the brand's (primary,
//                                  else accent, else any given colour); the
//                                  deep step is the brand's own darkest
//                                  colour when it gives one (L ≤ 0.3).
//   workingColors(colors, mode)  → the colours a story renders with. "auto"
//                                  (default): a pale bg (OKLCH L ≥ 0.85,
//                                  chroma < 0.1)
//                                  moves to paper (cards, type) and the deep
//                                  step becomes bg; a story with no bg gets
//                                  the deep step (a one-colour brand). Dark
//                                  and mid grounds stay as given. primary and
//                                  accent then keep 3:1 on the new bg, and an
//                                  ink lost on the new paper becomes bg. The
//                                  ramp is added as colors.deep / mid / light
//                                  when anything moved. "as-given": untouched.
//   paleSurfaceFindings(...)     → a plan warning when most of the frame
//                                  area, over the runtime, sits on a pale bg.
//
// Plain ESM that imports only oklch.mjs (also import-free), so story.mjs can
// resolve the palette in both renderers. Canonical copy: kit/core/palette.mjs.

import { contrastRatio, fitContrast, hexToOklch, oklchToHex } from './oklch.mjs';

export const BRAND_PALETTE_MODES = Object.freeze(['auto', 'as-given']);
// OKLCH: a ground at or above this lightness and under this chroma is pale
// (a tint or paper). A saturated light ground (a yellow) is a loud brand
// colour, not a washed-out one, and stays.
export const PALE_SURFACE_L = 0.85;
export const PALE_SURFACE_C = 0.1;
// The ramp's lightness steps, and the chroma a surface may carry (a ground
// tinted past this reads as a coloured slab, not a surface).
export const TONAL_RAMP = Object.freeze({ deep: 0.22, mid: 0.36, light: 0.95, chroma: 0.06, lightChroma: 0.03, ownDeep: 0.3 });
// Share of frame area × runtime on a pale bg that the plan check warns at.
export const PALE_SURFACE_SHARE = 0.6;

const HEX = /^#[0-9a-fA-F]{6}$/;
const CHROMATIC = 0.04;
const given = (colors) => Object.values(colors ?? {}).filter((hex) => HEX.test(String(hex)));
const lightness = (hex) => hexToOklch(hex).l;

/** Whether a colour is a pale ground (OKLCH L ≥ PALE_SURFACE_L, chroma under PALE_SURFACE_C). */
export const isPale = (hex) => { if (!HEX.test(String(hex))) return false; const { l, c } = hexToOklch(hex); return l >= PALE_SURFACE_L && c < PALE_SURFACE_C; };

// The hue the ramp takes: the first chromatic of primary, accent, bg, paper, else the first colour given.
function anchor(colors) {
  const order = [colors?.primary, colors?.accent, colors?.bg, colors?.paper, ...given(colors)].filter((hex) => HEX.test(String(hex)));
  const lch = order.map(hexToOklch);
  return lch.find((entry) => entry.c >= CHROMATIC) ?? lch[0] ?? { l: 0.5, c: 0, h: 0 };
}

/** The brand's tonal ramp → {deep, mid, light} hex. */
export function tonalRamp(colors) {
  const { c, h } = anchor(colors);
  const own = given(colors).map((hex) => ({ hex, l: lightness(hex) })).filter((entry) => entry.l <= TONAL_RAMP.ownDeep).sort((a, b) => a.l - b.l)[0]?.hex;
  const tint = Math.min(c, TONAL_RAMP.chroma);
  return {
    deep: own ?? oklchToHex({ l: TONAL_RAMP.deep, c: tint, h }),
    mid: oklchToHex({ l: TONAL_RAMP.mid, c: tint, h }),
    light: oklchToHex({ l: TONAL_RAMP.light, c: Math.min(c, TONAL_RAMP.lightChroma), h })
  };
}

/** The colours a story renders with (see the header). Returns the same object when nothing moves. */
export function workingColors(colors, mode = 'auto') {
  if (mode === 'as-given' || !colors || typeof colors !== 'object') return colors;
  const bg = HEX.test(String(colors.bg)) ? colors.bg : null;
  if (bg && !isPale(bg)) return colors;
  if (!given(colors).length) return colors;
  const ramp = tonalRamp(colors);
  const out = { ...colors, bg: ramp.deep };
  // The pale ground becomes the light tone (type and cards) when it reads on deep.
  out.paper = bg && contrastRatio(bg, ramp.deep) >= 4.5 ? bg : HEX.test(String(colors.paper)) && contrastRatio(colors.paper, ramp.deep) >= 4.5 ? colors.paper : ramp.light;
  // ink (type on primary and on paper cards) follows the swap: the deep ground when the old ink vanishes on the new paper.
  if (HEX.test(String(out.ink)) && contrastRatio(out.ink, out.paper) < 4.5) out.ink = out.bg;
  for (const role of ['primary', 'accent']) {
    if (HEX.test(String(out[role])) && contrastRatio(out[role], out.bg) < 3) out[role] = fitContrast(hexToOklch(out[role]), out.bg, 3) ?? out[role];
  }
  for (const [step, hex] of Object.entries(ramp)) if (out[step] === undefined) out[step] = hex;
  return out;
}

/** A brand with its working colours: the same object when nothing moves. */
export function workingBrand(brand) {
  if (!brand || typeof brand !== 'object') return brand;
  const colors = workingColors(brand.colors, brand.palette ?? 'auto');
  return colors === brand.colors ? brand : { ...brand, colors };
}

/**
 * Plan check: how much of the frame, over the runtime, sits bare on a pale
 * bg. media: [{start, end, area}] with area the share of the canvas the
 * footage covers (0–1). → [{rule: "pale-surface", severity: "warning", at,
 * ids, detail}] when the share reaches PALE_SURFACE_SHARE.
 * shortcut: overlapping media add their areas (capped at 1) rather than
 * taking their union; take the union when split layouts stack media.
 */
export function paleSurfaceFindings({ colors, duration, media = [], step = 0.25 }) {
  if (!isPale(colors?.bg) || !(duration > 0)) return [];
  let bare = 0, samples = 0;
  for (let t = step / 2; t < duration; t += step) {
    const covered = media.filter((entry) => t >= entry.start && t < entry.end).reduce((sum, entry) => sum + Math.max(0, Number(entry.area) || 0), 0);
    bare += 1 - Math.min(1, covered);
    samples += 1;
  }
  const share = samples ? bare / samples : 0;
  if (share < PALE_SURFACE_SHARE) return [];
  return [{
    rule: 'pale-surface',
    severity: 'warning',
    at: 0,
    ids: [],
    detail: `${Math.round(share * 100)}% of the frame over the runtime sits on the pale ground ${colors.bg} (OKLCH L ${lightness(colors.bg).toFixed(2)}), so the video reads washed out and flat. Leave brand.palette on "auto" (a deep ground from the brand hue, the pale colour for cards and type) or put footage behind more scenes`
  }];
}

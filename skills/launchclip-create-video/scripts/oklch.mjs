// OKLCH colour maths (Björn Ottosson's OKLab, sRGB D65) for generated
// styles: hex ↔ OKLab / OKLCH, gamut mapping by chroma, and a lightness walk
// to a contrast target. Shared by the seeded generator (style-seed.mjs) and
// its brand inputs (style-brand.mjs).
//
// Pure ESM that imports only kit/core siblings. Canonical copy:
// kit/core/oklch.mjs.

import { contrastRatio } from './style.mjs';

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

export const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Move a colour's OKLCH lightness away from `against` (up from a dark colour, down from a light one) until the pair reaches `min` contrast. → hex or null */
export function fitContrast(lch, against, min) {
  const up = hexToOklch(against).l < 0.6;
  for (let step = 0; step <= 100; step += 1) {
    const l = lch.l + (up ? 1 : -1) * step * 0.01;
    if (l < 0 || l > 1) break;
    const hex = oklchToHex({ ...lch, l });
    if (contrastRatio(hex, against) >= min) return hex;
  }
  return null;
}

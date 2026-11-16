// One-bit: the frame in two inks through an 8 × 8 ordered (Bayer) dither on
// its brightness, like an early Mac screen. Ordered dither, never error
// diffusion: the pattern is fixed to the screen, so motion does not crawl.
//
// Grade: luminance, lightly contrast-stretched, plus the Bayer tile (each
// threshold a dot `dot` px square), then a discrete two-step transfer and a
// two-stop ramp from ink to paper. No furniture.
//
// The 8 × 8 Bayer matrix is the standard recursive one (docs/FINISHING_AND_ELEMENTS_RFC.md §E.10).

import { arithmetic, fe, grey, image, linear, ramp } from './parts.mjs';

const INK = '#1b1b1f', PAPER = '#f1eee4';
// The 8 × 8 Bayer index matrix, row by row; threshold = (i + 0.5) / 64.
export const BAYER8 = Object.freeze([
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21
]);

/** The dither dot for a canvas: whole pixels, 2 px at 1080p so the pattern survives an encode. */
export const oneBitDot = (unit) => Math.max(1, Math.round(2 * unit));

export const LOOK = {
  describe: 'the frame in two inks (near-black on warm white) through an 8 × 8 ordered dither, like an early one-bit computer screen; the pattern holds still under motion',
  words: ['\\bone[- ]bit\\b', '\\b1[- ]bit\\b', '\\bdither(?:ed)? (?:look|style)\\b', '\\bbayer dither\\b', '\\bearly mac\\b'],
  defaults: { strength: 1, step: 0 },
  presets: () => ({ colors: { bg: PAPER, primary: INK, accent: '#5a5a66', ink: PAPER, paper: INK } }),
  variants: 1,
  grade(plan) {
    const c = oneBitDot(plan.unit);
    const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="${8 * c}" height="${8 * c}" shape-rendering="crispEdges">${BAYER8.map((v, i) => { const g = Math.round(((v + 0.5) / 64) * 255); return `<rect x="${(i % 8) * c}" y="${Math.floor(i / 8) * c}" width="${c}" height="${c}" fill="rgb(${g},${g},${g})"/>`; }).join('')}</svg>`;
    return [
      grey('l', 'SourceGraphic'),
      // A little contrast so flat brand fills land on solid ink or paper, not on a pattern.
      linear('lc', 'l', 1.15, -0.075),
      image('bayer-cell', tile, 0, 0, 8 * c, 8 * c),
      fe('feTile', { in: 'bayer-cell', x: 0, y: 0, width: plan.width, height: plan.height, result: 'bayer' }),
      // l + threshold − 0.5, then ≥ 0.5 is paper: a pixel is paper where its brightness beats its threshold.
      arithmetic('d', 'lc', 'bayer', 0, 1, 1, -0.5),
      fe('feComponentTransfer', { in: 'd', result: 'bit' }, ['R', 'G', 'B'].map((ch) => fe(`feFunc${ch}`, { type: 'discrete', tableValues: '0 1' })).join('')),
      ramp('out', 'bit', [INK, PAPER])
    ];
  }
};

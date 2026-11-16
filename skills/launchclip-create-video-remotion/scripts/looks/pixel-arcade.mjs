// Pixel arcade: the whole frame as a retro game screen. The picture is cut to
// the VFX layer's art grid (180 art pixels on the short side, a 6 px cell at
// 1080p), each cell one flat colour, posterised to four levels a channel
// with a 4 × 4 ordered dither, under faint scanlines.
//
// Grade: a light blur averages each cell; its corner pixel is kept (a tile of
// one dot a cell) and spread over the cell by a cell-sized box convolution
// whose window holds exactly one dot, so cells never overlap or leave seams.
// A 4 × 4 Bayer tile of cells is added before a discrete transfer snaps every
// channel to four levels, so smooth gradients become ordered dither rather
// than bands. The VFX layer's pixels sit on the same grid, so effects and
// picture share one pixel size.
// Furniture: scanlines one art row apart.
//
// What it costs: text smaller than about four cells breaks up. Captions sit
// above the look and stay crisp. It posterises per channel (64 colours), not
// to a fixed 16-colour palette: a filter cannot pick the nearest of 16.

import { arithmetic, blur, composite, fe, flood, image, scanlines } from './parts.mjs';

const LEVELS = 4;
// The 4 × 4 Bayer order, thresholds (i + 0.5) / 16.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** The cell for a canvas: whole pixels, the VFX art grid (6 px at 1080p). */
export function arcadeCell(unit) {
  return Math.max(2, Math.round(6 * unit));
}

export const LOOK = {
  describe: 'the whole frame as a retro game screen: cut to big square pixels on the VFX art grid, posterised with ordered dither, under faint scanlines',
  words: ['\\bpixel[- ]?art\\b', '\\b(?:8|16)[- ]?bit\\b', '\\bretro[- ](?:game|arcade|pixel)\\b', '\\barcade (?:look|style|screen)\\b', '\\bpixel[- ]arcade\\b'],
  defaults: { strength: 1, step: 0 },
  // A dark arcade cabinet: deep violet ground, a gold and a cyan that survive four levels a channel.
  presets: () => ({ colors: { bg: '#140c28', primary: '#ffd23f', accent: '#3ee6ff', ink: '#140c28', paper: '#fff4e0' } }),
  variants: 1,
  grade(plan) {
    const c = arcadeCell(plan.unit), step = 1 / (LEVELS - 1);
    const dot = `<svg xmlns="http://www.w3.org/2000/svg" width="${c}" height="${c}"><rect width="1" height="1" fill="#fff"/></svg>`;
    const bayer = `<svg xmlns="http://www.w3.org/2000/svg" width="${4 * c}" height="${4 * c}" shape-rendering="crispEdges">${BAYER.map((v, i) => { const g = Math.round(((v + 0.5) / 16) * 255); return `<rect x="${(i % 4) * c}" y="${Math.floor(i / 4) * c}" width="${c}" height="${c}" fill="rgb(${g},${g},${g})"/>`; }).join('')}</svg>`;
    return [
      blur('soft', 'SourceGraphic', c * 0.3),
      image('dot', dot, 0, 0, c, c),
      fe('feTile', { in: 'dot', x: 0, y: 0, width: plan.width, height: plan.height, result: 'dots' }),
      composite('points', 'soft', 'dots', 'in'),
      // Each pixel sums the window up and left of it: the one dot at its cell's corner.
      fe('feConvolveMatrix', { in: 'points', order: c, kernelMatrix: Array(c * c).fill(1).join(' '), divisor: 1, targetX: c - 1, targetY: c - 1, edgeMode: 'none', preserveAlpha: 'false', result: 'cells' }),
      image('bayer-cell', bayer, 0, 0, 4 * c, 4 * c),
      fe('feTile', { in: 'bayer-cell', x: 0, y: 0, width: plan.width, height: plan.height, result: 'bayer' }),
      // Shift each cell by its threshold across one bin of the discrete transfer (1 / LEVELS wide), centred, then snap.
      arithmetic('dithered', 'cells', 'bayer', 0, 1, 1 / LEVELS, -0.5 / LEVELS),
      fe('feComponentTransfer', { in: 'dithered', result: 'snapped' }, ['R', 'G', 'B'].map((ch) => fe(`feFunc${ch}`, { type: 'discrete', tableValues: Array.from({ length: LEVELS }, (_, i) => Math.round(i * step * 1000) / 1000).join(' ') })).join('')),
      flood('black', '#000000'),
      composite('out', 'snapped', 'black', 'over')
    ];
  },
  furniture(plan) {
    const c = arcadeCell(plan.unit);
    const scan = scanlines({ period: c, color: '#000000', alpha: 0.22, thickness: 1 / 3 });
    return { html: scan.html, css: scan.css };
  }
};

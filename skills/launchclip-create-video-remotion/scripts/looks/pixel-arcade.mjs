// Pixel arcade: the whole frame as a retro game screen. The picture is cut to
// the VFX layer's art grid (180 art pixels on the short side, a 6 px cell at
// 1080p), each cell one flat colour, posterised to four levels a channel
// with a 4 × 4 ordered dither, under faint scanlines.
//
// Grade: a light blur averages each cell; its corner pixel is kept (a tile of
// one dot a cell) and spread over the cell by dilating it, in four groups of
// cells by parity so no two squares meet, each clipped to its own cells: no
// overlap, no seams, and only cheap primitives (a convolution was exact too,
// but far too slow in Chromium).
// A 4 × 4 Bayer tile of cells is added before a discrete transfer snaps every
// channel to four levels, so smooth gradients become ordered dither rather
// than bands. The VFX layer's pixels sit on the same grid, so effects and
// picture share one pixel size.
// Furniture: scanlines one art row apart.
//
// What it costs: text smaller than about four cells breaks up. Captions sit
// above the look and stay crisp. It posterises per channel (64 colours), not
// to a fixed 16-colour palette: a filter cannot pick the nearest of 16.

import { arithmetic, blur, composite, fe, flood, image, offset, scanlines } from './parts.mjs';

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
    const c = arcadeCell(plan.unit), step = 1 / (LEVELS - 1), r = Math.ceil(c / 2);
    const dot = `<svg xmlns="http://www.w3.org/2000/svg" width="${c}" height="${c}"><rect width="1" height="1" fill="#fff"/></svg>`;
    const bayer = `<svg xmlns="http://www.w3.org/2000/svg" width="${4 * c}" height="${4 * c}" shape-rendering="crispEdges">${BAYER.map((v, i) => { const g = Math.round(((v + 0.5) / 16) * 255); return `<rect x="${(i % 4) * c}" y="${Math.floor(i / 4) * c}" width="${c}" height="${c}" fill="rgb(${g},${g},${g})"/>`; }).join('')}</svg>`;
    return [
      blur('soft', 'SourceGraphic', c * 0.3),
      image('dot', dot, 0, 0, c, c),
      fe('feTile', { in: 'dot', x: 0, y: 0, width: plan.width, height: plan.height, result: 'dots' }),
      composite('points', 'soft', 'dots', 'in'),
      // Spread each cell's corner dot over its cell: the cells in four groups by the parity of their column and row,
      // so a group's dots sit two cells apart and a dilated square (2r + 1 wide) never meets its neighbour's; each
      // square is moved onto its cell and clipped to its group's cells, and the four groups are laid together.
      ...[[0, 0], [1, 0], [0, 1], [1, 1]].flatMap(([px, py], k) => [
        image(`g${k}-cell`, `<svg xmlns="http://www.w3.org/2000/svg" width="${2 * c}" height="${2 * c}" shape-rendering="crispEdges"><rect x="${px * c}" y="${py * c}" width="${c}" height="${c}" fill="#fff"/></svg>`, 0, 0, 2 * c, 2 * c),
        fe('feTile', { in: `g${k}-cell`, x: 0, y: 0, width: plan.width, height: plan.height, result: `g${k}` }),
        composite(`g${k}-dots`, 'points', `g${k}`, 'in'),
        fe('feMorphology', { in: `g${k}-dots`, operator: 'dilate', radius: r, result: `g${k}-wide` }),
        offset(`g${k}-placed`, `g${k}-wide`, r, r),
        composite(`g${k}-cells`, `g${k}-placed`, `g${k}`, 'in')
      ]),
      composite('cells-01', 'g0-cells', 'g1-cells', 'over'),
      composite('cells-23', 'g2-cells', 'g3-cells', 'over'),
      composite('cells', 'cells-01', 'cells-23', 'over'),
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

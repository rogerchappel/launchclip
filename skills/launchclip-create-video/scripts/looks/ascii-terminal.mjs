// ASCII terminal: the rendered scene converted to green monospace characters
// on black by brightness, with a screen glow, scanlines, a vignette and a
// typed command line.
//
// This is a real conversion, done as a pixel pass in the grade: the frame is
// sampled into character cells, each cell's brightness picks one of nine
// characters (" .-:+=*%#@", sparse to dense), and that character is drawn in
// the cell from a 5 × 7 bitmap font carried in this file (so it is the same
// on every machine and in both renderers). Brighter cells are also a
// brighter green, and a faint ghost of the picture stays under the
// characters, as a phosphor screen holds one.
// Furniture: scanlines, a vignette, the screen's inner glow, and a prompt
// line that types its command at the start of each shot, with a blinking
// cursor.
//
// What it costs: scene text smaller than a few character cells does not
// survive the conversion. Captions sit above the look and stay readable.

import { arithmetic, blend, blur, composite, curve, fe, flood, glow, grey, image, linear, ramp, rgba, scanlines, shotAt, text, vignette, zones } from './parts.mjs';

const GREEN = '#39ff7a', PALE = '#d9ffe6', BLACK = '#020a04';
const RAMP = ['#00140a', '#0a5a26', '#1fbf58', GREEN, PALE];
// 5 × 7 bitmaps, sparse to dense; level 0 is an empty cell.
const GLYPHS = [
  ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'], // .
  ['.....', '.....', '.....', '#####', '.....', '.....', '.....'], // -
  ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'], // :
  ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'], // +
  ['.....', '.....', '#####', '.....', '#####', '.....', '.....'], // =
  ['.....', '#.#.#', '.###.', '#####', '.###.', '#.#.#', '.....'], // *
  ['##..#', '##.#.', '...#.', '..#..', '.#...', '.#.##', '#..##'], // %
  ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'], // #
  ['.###.', '#...#', '#.###', '#.#.#', '#.###', '#....', '.####']  // @
];
const TYPE_DELAY = 0.2, TYPE_RATE = 24;

/** The character cell for a canvas: {p (px per font pixel), rx, ry, cw, ch}; odd sizes, so a cell has a centre pixel. */
export function asciiCell(unit) {
  const p = Math.max(1, Math.round(3 * unit));
  const rx = Math.round((5 * p + 3 * unit) / 2), ry = Math.round((7 * p + 5 * unit) / 2);
  return { p, rx, ry, cw: 2 * rx + 1, ch: 2 * ry + 1 };
}

/** One glyph as an SVG tile the size of a cell: white on nothing. */
function glyphTile(rows, cell) {
  const x0 = Math.floor((cell.cw - 5 * cell.p) / 2), y0 = Math.floor((cell.ch - 7 * cell.p) / 2);
  const rects = rows.flatMap((row, y) => [...row].map((bit, x) => (bit === '#' ? `<rect x="${x0 + x * cell.p}" y="${y0 + y * cell.p}" width="${cell.p}" height="${cell.p}"/>` : ''))).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cell.cw}" height="${cell.ch}" viewBox="0 0 ${cell.cw} ${cell.ch}" shape-rendering="crispEdges" fill="#fff">${rects}</svg>`;
}

export const LOOK = {
  describe: 'the rendered scene converted to green monospace characters on black by brightness, with a screen glow, scanlines, a vignette and a typed command line',
  words: ['\\bascii\\b', '\\bterminal (?:look|style|art|screen)\\b', '\\bgreen[- ]screen terminal\\b', '\\btext[- ]mode\\b'],
  defaults: { strength: 1, step: 0 },
  // Night: a dark room leaves most cells empty, so the cast reads as characters on black.
  presets: () => ({ colors: { bg: BLACK, primary: GREEN, accent: '#b6ffcf', ink: BLACK, paper: PALE }, world: { time: 'night' } }),
  variants: 1,
  grade(plan) {
    const cell = asciiCell(plan.unit);
    const levels = GLYPHS.length;
    // Level i's band of brightness → white, everything else black.
    const band = (i) => Array.from({ length: levels + 1 }, (_, k) => (k === i ? 1 : 0)).join(' ');
    const picks = GLYPHS.flatMap((rows, i) => {
      const n = i + 1;
      return [
        image(`g${n}`, glyphTile(rows, cell), 0, 0, cell.cw, cell.ch),
        fe('feTile', { in: `g${n}`, x: 0, y: 0, width: plan.width, height: plan.height, result: `t${n}` }),
        fe('feComponentTransfer', { in: 'cells', result: `m${n}` }, ['R', 'G', 'B'].map((c) => fe(`feFunc${c}`, { type: 'discrete', tableValues: band(n) })).join('')),
        arithmetic(`c${n}`, `t${n}`, `m${n}`, 1, 0, 0, 0),
        blend(`s${n}`, `c${n}`, n === 1 ? 'black' : `s${n - 1}`, 'lighten')
      ];
    });
    return [
      grey('l', 'SourceGraphic'),
      // The darkest eighth stays empty (a dim backdrop glow draws nothing); above it the tones spread over the nine characters.
      curve('tone', 'l', [0, 0.06, 0.22, 0.38, 0.52, 0.65, 0.77, 0.89, 1]),
      // Each cell's brightness, softened, read at its centre pixel and spread over the cell.
      // (A light blur only: the renderers' browsers approximate a wide one differently, and a cell
      // near a band's edge would then pick different characters.)
      blur('avg', 'tone', cell.rx * 0.25, cell.ry * 0.25),
      fe('feFlood', { 'flood-color': '#ffffff', x: cell.rx, y: cell.ry, width: 1, height: 1, result: 'dot' }),
      fe('feOffset', { in: 'dot', dx: 0, dy: 0, x: 0, y: 0, width: cell.cw, height: cell.ch, result: 'dot-cell' }),
      fe('feTile', { in: 'dot-cell', x: 0, y: 0, width: plan.width, height: plan.height, result: 'dots' }),
      composite('points', 'avg', 'dots', 'in'),
      fe('feMorphology', { in: 'points', operator: 'dilate', radius: `${cell.rx} ${cell.ry}`, result: 'spread' }),
      flood('black', '#000000'),
      composite('cells', 'spread', 'black', 'over'),
      ...picks,
      // The characters in the cell's green, over black, with a ghost of the picture under them.
      ramp('green', 'cells', RAMP),
      arithmetic('typed', `s${levels}`, 'green', 1, 0, 0, 0),
      ramp('ghost-full', 'tone', RAMP),
      linear('ghost', 'ghost-full', 0.16, 0),
      blend('screen', 'typed', 'ghost', 'screen'),
      composite('flat', 'screen', 'black', 'over'),
      glow('out', 'flat', 7 * plan.unit, 0.6, 0.25)
    ];
  },
  furniture(plan) {
    const { width: W, height: H, unit: u } = plan;
    const z = zones(plan);
    const scan = scanlines({ period: Math.max(3, Math.round(4 * u)), color: '#000000', alpha: 0.3 });
    // Under 0.6, so the layout audit does not read the corners as covered.
    const dark = vignette({ color: '#000000', amount: 0.55, inner: 50 });
    const font = Math.round(28 * u);
    const slug = (plan.title || 'scene').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 18) || 'scene';
    const command = (plan.labels[0] ?? `play ${slug} --ascii`).slice(0, 28);
    const mid = z.top.y + Math.round(z.top.h / 2);
    return {
      html: `${scan.html}${dark.html}<div class="lc-look-ascii-glow"></div><div class="lc-look-ascii-prompt" style="left:${z.top.x}px;top:${mid}px"><span>&gt;&nbsp;</span><span class="lc-look-ascii-typed" style="--n:${command.length}">${text(command)}</span><span class="lc-look-ascii-cursor"></span></div>`,
      css: [
        scan.css,
        dark.css,
        `.lc-look-ascii-glow { position: absolute; inset: 0; box-shadow: inset 0 0 ${Math.round(120 * u)}px ${rgba(GREEN, 0.22)}; }`,
        `.lc-look-ascii-prompt { position: absolute; display: flex; align-items: center; transform: translateY(-50%); color: ${PALE}; font-size: ${font}px; line-height: 1.3; white-space: pre; background: ${rgba('#000000', 0.78)}; padding: ${Math.round(6 * u)}px ${Math.round(14 * u)}px; text-shadow: 0 0 ${Math.round(10 * u)}px ${rgba(GREEN, 0.9)}; }`,
        `.lc-look-ascii-typed { display: inline-block; overflow: hidden; width: calc(min(var(--lc-look-typed, 0), var(--n)) * 1ch); }`,
        `.lc-look-ascii-cursor { display: inline-block; width: 0.6em; height: 1.05em; margin-left: 0.1em; background: ${GREEN}; box-shadow: 0 0 ${Math.round(10 * u)}px ${GREEN}; opacity: var(--lc-look-cursor, 1); }`
      ].join('\n')
    };
  },
  vars(plan, frame) {
    const t = frame / plan.fps;
    const { index, age } = shotAt(plan, t);
    // The command types at the start of each shot; the cursor blinks twice a second; the scanlines roll slowly.
    return {
      '--lc-look-typed': index < 0 ? 99 : Math.max(0, Math.floor((age - TYPE_DELAY) * TYPE_RATE + 1e-6)),
      '--lc-look-cursor': t % 0.5 < 0.25 ? 1 : 0,
      '--lc-look-scan': (frame % 8) / 8
    };
  }
};

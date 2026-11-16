// Pen plotter: the frame as ink lines on paper, plotted in. Edges become one
// line weight, darker areas take hatching (crosshatch in the darkest), and at
// each cut a gantry pen plots the new shot row by row across the frame:
// pen down at a trapezoidal speed (speeds up, cruises, slows), pen up while
// it travels to the next row.
//
// Grade: a morphological outline plus two hatch screens masked by darkness,
// through an ink-on-paper ramp.
// Furniture: a paper cover per row that the pen uncovers (scaleX from the far
// side), the gantry rail and the pen carriage; all moved by CSS variables.
//
// Technique rewritten from the reference demo's description (docs/FINISHING_AND_ELEMENTS_RFC.md §E.10).

import { arithmetic, blend, curve, grey, outline, ramp, rgba, rules, shotAt } from './parts.mjs';

const PAPER = '#f5f1e6', INK = '#1f2a6b';
const ROWS = 10, DRAW = 0.86, ACCEL = 0.2;
// The cover leaves a faint ghost of the frame ahead of the pen.
const COVER = 0.92;

/** Pen position along a row, 0..1, at time share s of its stroke: trapezoidal speed (ACCEL of the time to speed up, ACCEL to slow). */
export function trapezoid(s) {
  const t = Math.min(1, Math.max(0, s)), v = 1 / (1 - ACCEL);
  if (t < ACCEL) return (v * t * t) / (2 * ACCEL);
  if (t <= 1 - ACCEL) return v * (t - ACCEL / 2);
  return 1 - (v * (1 - t) ** 2) / (2 * ACCEL);
}

/** How long the plot of one shot takes, seconds. */
const plotTime = (shot) => Math.min(1.6, Math.max(0.4, (shot.end - shot.start) * 0.6));

export const LOOK = {
  describe: 'the frame as blue ink lines and hatching on paper, plotted in at each cut by a gantry pen that sweeps the frame row by row, speeding up and slowing at each row end',
  honest: 'the plot is a row-by-row sweep over the drawing, not each stroke traced along its own path',
  words: ['\\bpen[- ]plotter\\b', '\\bplotter (?:drawing|look|style|art)\\b', '\\bplotted (?:drawing|line art)\\b', '\\baxidraw\\b'],
  defaults: { strength: 1, step: 0 },
  presets: () => ({ colors: { bg: PAPER, primary: INK, accent: '#c4402f', ink: PAPER, paper: INK } }),
  variants: 1,
  grade(plan) {
    const u = plan.unit, cell = Math.max(4, Math.round(9 * u)), line = Math.max(1, Math.round(1.6 * u));
    return [
      grey('l', 'SourceGraphic'),
      outline('edge', 'SourceGraphic', 2.4 * u, 1.6, 0.05),
      // Darkness masks: mid-tones and below take the first screen, the darkest the second.
      curve('dark', 'l', [1, 1, 0.8, 0.2, 0, 0, 0, 0, 0]),
      curve('darker', 'l', [1, 0.6, 0, 0, 0, 0, 0, 0, 0]),
      rules('h1', 'y', cell, line, plan),
      rules('h2', 'x', cell, line, plan),
      arithmetic('hatch1', 'h1', 'dark', 1, 0, 0),
      arithmetic('hatch2', 'h2', 'darker', 1, 0, 0),
      blend('hatch', 'hatch1', 'hatch2', 'screen'),
      blend('lines', 'edge', 'hatch', 'screen'),
      ramp('out', 'lines', [PAPER, INK])
    ];
  },
  furniture(plan) {
    const { width: W, height: H, unit: u } = plan;
    const rowH = H / ROWS, rail = Math.max(2, Math.round(4 * u)), pen = Math.round(26 * u);
    const rows = Array.from({ length: ROWS }, (_, k) => {
      const top = Math.floor(k * rowH), bottom = Math.floor((k + 1) * rowH);
      // Even rows plot left to right (the cover shrinks toward the right), odd rows back.
      return `<div class="lc-look-pp-row" style="top:${top}px;height:${bottom - top}px;transform-origin:${k % 2 ? 'left' : 'right'} center;transform:scaleX(calc(1 - var(--lc-look-p${k}, 1)))"></div>`;
    }).join('');
    const carriage = `<div class="lc-look-pp-gantry"><div class="lc-look-pp-rail"></div><div class="lc-look-pp-pen"></div></div>`;
    return {
      html: `${rows}${carriage}`,
      css: [
        `.lc-look-pp-row { position: absolute; left: 0; width: ${W}px; background: ${rgba(PAPER, COVER)}; }`,
        `.lc-look-pp-gantry { position: absolute; left: 0; top: 0; width: ${W}px; height: 0; opacity: var(--lc-look-pen, 0); transform: translateY(calc(var(--lc-look-py, 0) * 1px)); }`,
        `.lc-look-pp-rail { position: absolute; left: 0; top: ${-Math.round(rail / 2)}px; width: ${W}px; height: ${rail}px; background: ${rgba('#6b6f7a', 0.55)}; }`,
        // The pen: a holder block with a nib, lifted (smaller shadow) between strokes.
        `.lc-look-pp-pen { position: absolute; left: ${-Math.round(pen / 2)}px; top: ${-pen}px; width: ${pen}px; height: ${pen}px; border-radius: ${Math.round(4 * u)}px ${Math.round(4 * u)}px 50% 50%; background: ${INK}; box-shadow: 0 calc(var(--lc-look-lift, 0) * ${Math.round(10 * u)}px) ${Math.round(6 * u)}px ${rgba('#000000', 0.35)}; transform: translate(calc(var(--lc-look-px, 0) * 1px), calc(var(--lc-look-lift, 0) * ${-Math.round(8 * u)}px)); }`
      ].join('\n')
    };
  },
  vars(plan, frame) {
    const t = frame / plan.fps, { index, age } = shotAt(plan, t);
    const vars = {};
    const span = index >= 0 ? plotTime(plan.shots[index]) : 0;
    const done = index < 0 || age >= span;
    const per = span / ROWS;
    for (let k = 0; k < ROWS; k += 1) {
      if (done) { vars[`--lc-look-p${k}`] = 1; continue; }
      const s = (age - k * per) / (per * DRAW);
      vars[`--lc-look-p${k}`] = s <= 0 ? 0 : s >= 1 ? 1 : trapezoid(s);
    }
    if (done) return { ...vars, '--lc-look-pen': 0, '--lc-look-px': 0, '--lc-look-py': 0, '--lc-look-lift': 0 };
    const k = Math.min(ROWS - 1, Math.floor(age / per)), s = (age - k * per) / per;
    const rowY = (row) => (row + 0.5) * (plan.height / ROWS);
    const drawing = s < DRAW;
    const along = drawing ? trapezoid(s / DRAW) : 1;
    // Pen up: the carriage travels to the next row's start while the stroke ends.
    const travel = drawing ? 0 : (s - DRAW) / (1 - DRAW);
    const x = (k % 2 ? 1 - along : along) * plan.width;
    const y = rowY(k) + (k < ROWS - 1 ? travel * (rowY(k + 1) - rowY(k)) : 0);
    return { ...vars, '--lc-look-pen': 1, '--lc-look-px': x, '--lc-look-py': y, '--lc-look-lift': drawing ? 0 : 1 };
  }
};

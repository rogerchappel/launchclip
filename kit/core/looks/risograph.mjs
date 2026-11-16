// Risograph: the frame printed in three spot inks (fluorescent pink, blue and
// yellow) on warm paper. Each colour is an ink density per plate, the plates
// overprint by multiplying, and each plate sits a few pixels off register,
// jumping to a new seeded offset at every cut and holding between. Paper
// tooth and a fine ink grain on top.
//
// Grade: each plate is one matrix from the frame (an ink that absorbs green
// prints where green is missing, and so on), grained by its own noise,
// nudged by its whole-pixel offset, and the three are multiplied onto the
// paper. The drawing is the shot's index, so the offsets hold within a shot.
// No furniture: the print is the look.
//
// Technique rewritten from the reference demo's description (docs/FINISHING_AND_ELEMENTS_RFC.md §E.10).

import { arithmetic, blend, channel, flood, freq, matrix, noise, nudge, rand, rgb, shotAt } from './parts.mjs';

const PAPER = '#f4ecdc';
// Each ink and the channel it absorbs (0 red, 1 green, 2 blue): the plate prints where that channel is missing.
const INKS = [['#ff48b0', 1], ['#0078bf', 0], ['#ffe800', 2]];
const DRAWINGS = 8;

/** One plate as printed colour: paper white where the absorbed channel is full, the ink where it is empty. */
const plate = (result, input, hex, absorbs) => {
  const ink = rgb(hex), row = (c) => { const v = [0, 0, 0, 0, ink[c]]; v[absorbs] = 1 - ink[c]; return v; };
  return matrix(result, input, [...row(0), ...row(1), ...row(2), 0, 0, 0, 0, 1]);
};

export const LOOK = {
  describe: 'the frame printed in three risograph spot inks (fluorescent pink, blue, yellow) on warm paper; the plates overprint, sit a few pixels off register and jump to a new offset at each cut',
  words: ['\\brisograph\\b', '\\briso[- ]?print(?:ed)?\\b', '\\briso (?:look|style)\\b'],
  defaults: { strength: 1, step: 0 },
  // Paper ground, the blue as the text-safe primary and the pink as the accent.
  presets: () => ({ colors: { bg: PAPER, primary: '#0067a6', accent: '#e8338f', ink: PAPER, paper: '#1d1a2e' } }),
  variants: DRAWINGS,
  // A new registration at each cut.
  variantAt: (plan, frame) => Math.max(0, shotAt(plan, frame / plan.fps).index),
  grade(plan, v) {
    const u = plan.unit;
    const primitives = [];
    INKS.forEach(([hex, absorbs], i) => {
      // 1 to 3 px off register in a seeded direction, whole pixels.
      const a = rand(plan.seed, v * 7 + i) * Math.PI * 2, d = (1 + 2 * rand(plan.seed, v * 7 + i + 3)) * u;
      primitives.push(
        plate(`p${i}`, 'SourceGraphic', hex, absorbs),
        // Ink grain: a little paper shows through the solids.
        noise(`p${i}-n`, freq(0.9 / u), 37 + i * 13, 1),
        channel(`p${i}-g`, `p${i}-n`, 0, 1.4),
        arithmetic(`p${i}-gr`, `p${i}`, `p${i}-g`, 0, 1, 0.1, -0.05),
        nudge(`p${i}-o`, `p${i}-gr`, Math.cos(a) * d, Math.sin(a) * d)
      );
    });
    primitives.push(
      blend('p01', 'p0-o', 'p1-o', 'multiply'),
      blend('inks', 'p01', 'p2-o', 'multiply'),
      flood('paper', PAPER),
      blend('printed', 'inks', 'paper', 'multiply'),
      // Paper tooth: a coarse, faint fibre under everything.
      noise('tooth-n', freq(0.35 / u, 0.6 / u), 211, 2),
      channel('tooth', 'tooth-n', 0, 1.2),
      arithmetic('out', 'printed', 'tooth', 0, 1, 0.07, -0.035)
    );
    return primitives;
  }
};

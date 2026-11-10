// Paper cutout: layered craft paper with rough cut edges, paper fibre and a
// soft shadow between layers, the cast as jointed paper puppets with pin
// fasteners, animated on twos with a tiny jitter at every step.
//
// Presets: the `paper` drawing style (kit/core/characters/style-paper.mjs)
// with pin joints, a paper backdrop and a craft palette.
// Grade: every edge is roughened like a hand cut (the same cut in every
// drawing), each darker area takes a soft shadow from the lighter one up and
// to its left (dark reads as the deeper layer, as in layered paper art), and
// fibre and tooth lie over the whole sheet. Each step picks one of six
// drawings that nudge the frame by a pixel or two and bend it very slightly,
// so held frames breathe like repositioned paper.
// No furniture.

import { arithmetic, blend, blur, channel, displace, filled, freq, grey, linear, noise, nudge, offset, rand, stepPick } from './parts.mjs';

const VARIANTS = 6;

export const LOOK = {
  describe: 'layered craft paper: rough cut edges, paper fibre and soft shadows between layers, the cast as jointed puppets with pin fasteners, animated on twos with a tiny jitter at every step',
  words: ['\\bpaper[- ]?cut[- ]?outs?\\b', '\\bcut[- ]?out (?:animation|style|paper)\\b', '\\bcut[- ]paper\\b', '\\bpaper (?:craft|puppets?)\\b', '\\bconstruction paper\\b'],
  defaults: { strength: 1, step: 12 },
  presets: () => ({
    // A light sheet: paper is the dark lettering, ink the light text on the primary.
    colors: { bg: '#eadcc0', primary: '#c8432a', accent: '#2a6c8a', ink: '#fbf4e2', paper: '#2b2118' },
    cast: { style: 'paper' },
    background: { kind: 'paper', params: { grain: 0.7, intensity: 0.5 } }
  }),
  cast: Object.freeze({ pins: true }),
  variants: VARIANTS,
  // A seeded drawing per step, never the one before it.
  variantAt: (plan, frame) => stepPick(`${plan.seed}:jitter`, Math.floor((frame * (plan.step || 12)) / plan.fps + 1e-9), VARIANTS),
  grade(plan, v) {
    const u = plan.unit, s = plan.strength;
    const dx = (rand('paper-cutout:dx', v) - 0.5) * 3.2 * u, dy = (rand('paper-cutout:dy', v) - 0.5) * 3.2 * u;
    return [
      // The hand cut: fine, and the same in every drawing.
      noise('cut', freq(0.045 / u), 17, 2),
      displace('rough-raw', 'SourceGraphic', 'cut', 7 * u),
      filled('rough', 'rough-raw', 'SourceGraphic'),
      // The per-step jitter: a slow bend and a nudge, different in each drawing.
      noise('bend', freq(0.0016 / u), 71 + v * 13, 1),
      displace('bent-raw', 'rough', 'bend', 5 * u),
      filled('bent', 'bent-raw', 'rough'),
      nudge('placed', 'bent', dx, dy),
      // The shadow between layers: where the picture is darker than what lies up and to the left.
      grey('l', 'placed'),
      offset('l-off', 'l', 9 * u, 11 * u),
      blur('l-soft', 'l-off', 7 * u),
      arithmetic('drop', 'l-soft', 'l', 0, 1.6, -1.6, 0),
      linear('shade', 'drop', -0.5 * s, 1),
      blend('shadowed', 'shade', 'placed', 'multiply'),
      // Fibre (long, faint) and tooth (fine) over the whole sheet.
      noise('fibre-raw', freq(0.012 / u, 0.16 / u), 5, 2),
      channel('fibre', 'fibre-raw', 0, 0.22),
      noise('tooth-raw', freq(0.5 / u), 9, 1),
      channel('tooth', 'tooth-raw', 0, 0.3),
      blend('fibred', 'fibre', 'shadowed', 'overlay'),
      blend('out', 'tooth', 'fibred', 'overlay')
    ];
  }
};

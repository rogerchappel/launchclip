// Watercolour: soft washes that bleed at the edges with darker pooled
// borders and paper grain, loose pencil lines slightly off register, and
// washes that shift every few frames like hand-painted frames.
//
// Presets: the watercolour medium (kit/core/medium.mjs: the bleed, the
// pooled pigment, the uneven washes, the paper and the boil on threes), the
// soft-shade drawing style (no outline of its own) and a light palette (the
// medium brings the paper). The picture is held at ten drawings a second,
// the rate the medium boils at, so each frame reads as one painting.
// Grade (under the medium, as pencil lies under a wash): every colour edge
// becomes a thin graphite line, gone over twice and laid a few pixels off the
// shape it outlines; the wash then bleeds over it. It is redrawn with the boil.
// No furniture.

import { blend, linear, nudge, outline } from './parts.mjs';

const BOIL_EVERY = 3;
// Where the two pencil passes sit, in px at 1080, for each drawing of the boil: [firm x, firm y, faint x, faint y].
const REGISTER = [[3.5, 2.5, -2, 4], [-3, 3, 3.5, -1.5], [2.5, -3.5, -3.5, -2]];

export const LOOK = {
  describe: 'soft washes that bleed at the edges with darker pooled borders and paper grain, loose pencil lines slightly off register, and washes that shift every few frames like hand-painted frames',
  // The medium's own words (medium.mjs MEDIUM_WORDS) name the medium; these name the whole look.
  words: ['\\bwater[- ]?colou?r (?:and|with) pencil\\b', '\\bpencil (?:and|with) water[- ]?colou?r\\b', '\\bhand[- ]painted water[- ]?colou?r\\b', '\\bwater[- ]?colou?r (?:look|animation)\\b'],
  defaults: { strength: 1, step: 10 },
  presets: (look) => ({
    // A light sheet: paper is the dark lettering, ink the light text on the primary.
    colors: { bg: '#f4efe3', primary: '#3a75a6', accent: '#c2533b', ink: '#fbf7ee', paper: '#2b2a33' },
    cast: { style: 'soft-shade' },
    // A lighter tooth than the medium's own default: on this light sheet the full grain reads as dirt.
    medium: { kind: 'watercolour', strength: Math.round(0.6 * look.strength * 100) / 100, grain: 0.3 }
  }),
  under: true,
  variants: 3,
  variantAt: (plan, frame) => Math.floor(frame / BOIL_EVERY),
  grade(plan, v) {
    const u = plan.unit;
    const [ax, ay, bx, by] = REGISTER[v % REGISTER.length];
    return [
      // Loose: two passes of the pencil, a firm line and a fainter one beside it, as a sketch
      // is gone over twice. Off register: neither sits on the shape it outlines. Each drawing
      // of the boil lays them a little differently.
      outline('edge', 'SourceGraphic', 2.2 * u, 2.3, 0.3),
      nudge('first', 'edge', ax * u, ay * u),
      nudge('second-raw', 'edge', bx * u, by * u),
      linear('second', 'second-raw', 0.45, 0),
      blend('lines', 'first', 'second', 'lighten'),
      // Graphite: a soft dark grey, lighter where the line is faint.
      linear('pencil', 'lines', -0.52, 1),
      blend('out', 'pencil', 'SourceGraphic', 'multiply')
    ];
  }
};

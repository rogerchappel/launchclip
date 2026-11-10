// Clay 2D: a flat drawing shaded to suggest plasticine. Every shape gets a
// soft rounded rim, as if pressed from clay, under a warm light; a fine
// fingerprint ridge lies over the fills; the picture is held on twos and
// wobbles a little at each step; and the top and bottom of the frame fall
// out of focus, like a shallow depth of field.
//
// It is named for what it is. A filter pass sees pixels, not objects: it
// cannot give a shape real thickness, an underside, or a cast shadow that
// knows what is in front of what, and its rim follows colour edges, so a
// pattern inside a shape gets a rim too. Real claymation needs real 3D
// materials and lights, which this pipeline does not render.
//
// Presets: the chibi drawing style (chunky rounded shapes, a big round
// head), a warm palette, the studio light.
// Grade: the frame bent slightly (a different bend each step), a height map
// that dips at every colour edge and carries the fingerprint ridges, lit
// from the upper left and laid over the picture as soft light, warmed, and
// blurred toward the top and bottom edges.
// No furniture.

import { arithmetic, blend, blur, channel, composite, curve, displace, fadeDown, fe, filled, freq, linear, matrix, noise, outline, r, stepPick } from './parts.mjs';

const VARIANTS = 5;

export const LOOK = {
  describe: 'a flat drawing shaded to suggest plasticine: soft rounded rims, a fingerprint texture, warm studio light, held on twos with a slight wobble, the top and bottom of the frame out of focus. Not real clay: the shading follows colour edges',
  honest: 'a 2D shading pass, not 3D clay: no real thickness, undersides or object-aware shadows',
  words: ['\\bclaymation\\b', '\\bplasticine\\b', '\\bclay (?:animation|look|style)\\b', '\\bstop[- ]motion clay\\b'],
  defaults: { strength: 1, step: 12 },
  presets: () => ({
    // A light sheet: paper is the dark lettering, ink the light text on the primary.
    colors: { bg: '#f1e4d0', primary: '#d2552c', accent: '#2f7f86', ink: '#fff7ea', paper: '#33261d' },
    cast: { style: 'chibi' },
    light: { preset: 'studio' }
  }),
  variants: VARIANTS,
  // A seeded drawing per step, never the one before it.
  variantAt: (plan, frame) => stepPick(`${plan.seed}:wobble`, Math.floor((frame * (plan.step || 12)) / plan.fps + 1e-9), VARIANTS),
  grade(plan, v) {
    const u = plan.unit, s = plan.strength, H = plan.height;
    return [
      // The wobble: hand-moved clay never lands in quite the same place.
      noise('bend', freq(0.0022 / u), 311 + v * 19, 1),
      displace('bent-raw', 'SourceGraphic', 'bend', 6 * u),
      filled('bent', 'bent-raw', 'SourceGraphic'),
      // Height: flat on a fill, dipping at every colour edge, so each shape reads as a rounded slab.
      outline('edge', 'bent', 3 * u, 2, 0.25),
      blur('dip', 'edge', 5 * u),
      linear('slab', 'dip', -0.9, 1),
      // Fingerprints: the contour lines of a slow noise, which swirl and loop as ridges do; the
      // same in every drawing. (Contours, not bent lines: they stay smooth, so both renderers agree.)
      noise('print', freq(0.007 / u), 29, 1),
      channel('print-grey', 'print', 0, 1),
      curve('ridges-raw', 'print-grey', Array.from({ length: 57 }, (_, i) => i % 2)),
      blur('ridges', 'ridges-raw', 1.2 * u),
      arithmetic('height-grey', 'slab', 'ridges', 0, 1, 0.045, -0.0225),
      // A lighting filter reads its height from alpha.
      matrix('height', 'height-grey', [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0]),
      // Lit from the upper left; flat reads mid-grey, so soft light leaves a fill's colour alone.
      fe('feDiffuseLighting', { in: 'height', surfaceScale: r(u * 7 * s, 2), diffuseConstant: 1, 'lighting-color': '#ffffff', result: 'relief' }, fe('feDistantLight', { azimuth: 225, elevation: 30 })),
      blend('moulded', 'relief', 'bent', 'soft-light'),
      // Warm studio light: a little more red and less blue, matte.
      matrix('warm', 'moulded', [1.05, 0.02, 0, 0, 0.012, 0, 1.0, 0, 0, 0.004, 0, 0.02, 0.92, 0, 0, 0, 0, 0, 1, 0]),
      // Shallow depth of field: the top and the bottom of the frame soften.
      blur('far-raw', 'warm', 7 * u),
      filled('far', 'far-raw', 'warm'),
      fadeDown('low', plan, 0.8 * H, 0.98 * H),
      fadeDown('not-high', plan, 0.04 * H, 0.2 * H),
      arithmetic('high', 'not-high', 'not-high', 0, -1, 0, 1),
      composite('far-low', 'far', 'low', 'in'),
      composite('far-high', 'far', 'high', 'in'),
      composite('focus-a', 'far-low', 'warm', 'over'),
      composite('out', 'far-high', 'focus-a', 'over')
    ];
  }
};

// Anime cel: thin dark outlines, two-tone cel shading with hard shadow
// edges, big shiny eyes, light rays across a painted backdrop, and speed
// lines when a character is surprised.
//
// Presets: the soft-shade drawing style with the cute face (large glossy
// eyes; kit/core/characters/toon.mjs `face: "cute"`), a bright palette.
// Grade: brightness is cut into bands, so every soft gradient (a shaded
// arm, a sky, a wall) becomes flat tones with a hard edge between them, and
// every colour edge takes a thin dark line. The cast and the world are
// inked and shaded by the same pass, so they match.
// Furniture: soft light rays from the upper left, and a burst of speed
// lines around the edges of the frame for half a second whenever a cast cue
// turns a character surprised, flickering on twos.
//
// Not here: the sweat drop belongs to the expression marks, and a punch-in
// on the face is the cast scene's own cue (`{at, shot: "close"}`).

import { arithmetic, blend, fe, grey, linear, outline, rand, rgba } from './parts.mjs';

const INK = '#1a1730';
const BANDS = 7;
const BURST = 0.55;
const REACTIONS = ['surprised'];

/** The reaction (a cast cue that turns a character surprised) playing at `t`, or null: {index, age}. */
function reactionAt(plan, t) {
  let found = null;
  plan.cues.forEach((cue, index) => { if (REACTIONS.includes(cue.expression) && cue.at > 0 && t >= cue.at - 1e-6 && t < cue.at + BURST) found = { index, age: t - cue.at }; });
  return found;
}

export const LOOK = {
  describe: 'thin dark outlines and two-tone cel shading with hard shadow edges on the cast and the world alike, big shiny eyes, light rays, and speed lines when a character is surprised',
  words: ['\\banime\\b', '\\bcel[- ]shad(?:ed|ing)\\b', '\\bcel animation\\b', '\\bmanga[- ]style\\b'],
  defaults: { strength: 1, step: 0 },
  presets: () => ({
    // A light sheet: paper is the dark lettering, ink the light text on the primary.
    colors: { bg: '#eaf4ff', primary: '#e0316a', accent: '#2c69d8', ink: '#ffffff', paper: '#1d2340' },
    cast: { style: 'soft-shade' },
    // The painted backdrop: light rays, which the bands cut into hard shafts.
    background: { kind: 'light-rays' }
  }),
  cast: Object.freeze({ face: 'cute' }),
  variants: 1,
  grade(plan) {
    const u = plan.unit;
    // Each band is a plateau with a short ramp to the next: a hard edge that is still anti-aliased.
    const steps = Array.from({ length: BANDS }, (_, i) => i / (BANDS - 1)).flatMap((level) => [level, level, level, level]);
    return [
      grey('l', 'SourceGraphic'),
      // Brightness cut into bands; the difference from the smooth brightness is added to every channel, so hue holds.
      fe('feComponentTransfer', { in: 'l', result: 'banded' }, ['R', 'G', 'B'].map((c) => fe(`feFunc${c}`, { type: 'table', tableValues: steps.map((v) => Math.round(v * 1000) / 1000).join(' ') })).join('')),
      arithmetic('lift', 'banded', 'l', 0, 1, -1, 0),
      arithmetic('drop', 'l', 'banded', 0, 1, -1, 0),
      arithmetic('up', 'SourceGraphic', 'lift', 0, 1, 1, 0),
      arithmetic('cel', 'up', 'drop', 0, 1, -1, 0),
      // The ink: thin and dark on every colour edge.
      outline('edge', 'SourceGraphic', 2.4 * u, 2.6, 0.3),
      linear('line', 'edge', -0.88, 1),
      blend('out', 'line', 'cel', 'multiply')
    ];
  },
  furniture(plan) {
    const { width: W, height: H, unit: u } = plan;
    // Light rays: soft shafts fanning from above the upper left corner.
    const rays = [14, 23, 31, 42, 54].map((angle, i) => `<div class="lc-look-cel-ray" style="transform:rotate(${angle}deg);width:${Math.round((60 + 46 * rand('anime-cel:ray', i)) * u)}px;opacity:${Math.round((0.5 + 0.5 * rand('anime-cel:ray-a', i)) * 100) / 100}"></div>`).join('');
    // Speed lines: wedges from the edge of the frame toward the middle, which they leave clear. Two drawings.
    const cx = W / 2, cy = H * 0.45, reach = Math.hypot(W, H) * 0.62;
    const burst = (variant) => {
      const count = 46;
      const wedges = Array.from({ length: count }, (_, i) => {
        const a = ((i + rand(`anime-cel:line-${variant}`, i) * 0.8) / count) * Math.PI * 2;
        const inner = reach * (0.5 + 0.16 * rand(`anime-cel:in-${variant}`, i)), half = (0.006 + 0.012 * rand(`anime-cel:w-${variant}`, i));
        const p = (angle, radius) => `${Math.round(cx + Math.cos(angle) * radius)} ${Math.round(cy + Math.sin(angle) * radius)}`;
        return `M${p(a, inner)}L${p(a - half, reach * 1.25)}L${p(a + half, reach * 1.25)}Z`;
      }).join('');
      return `<svg class="lc-look-cel-speed lc-look-cel-speed-${variant}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><path d="${wedges}" fill="${INK}"/></svg>`;
    };
    return {
      html: `<div class="lc-look-cel-rays">${rays}</div>${burst(0)}${burst(1)}`,
      css: [
        `.lc-look-cel-rays { position: absolute; left: ${-Math.round(W * 0.12)}px; top: ${-Math.round(H * 0.1)}px; width: 0; height: 0; opacity: calc(0.75 + 0.25 * sin(var(--lc-look-rays, 0) * 6.2832rad)); }`,
        `.lc-look-cel-ray { position: absolute; left: 0; top: 0; height: ${Math.round(Math.hypot(W, H) * 1.3)}px; transform-origin: 0 0; background: linear-gradient(to bottom, ${rgba('#fff8dc', 0.34)}, ${rgba('#fff8dc', 0.1)} 55%, transparent); filter: blur(${Math.round(14 * u)}px); }`,
        `.lc-look-cel-speed { position: absolute; left: 0; top: 0; }`,
        `.lc-look-cel-speed-0 { opacity: var(--lc-look-speed-a, 0); }`,
        `.lc-look-cel-speed-1 { opacity: var(--lc-look-speed-b, 0); }`
      ].join('\n')
    };
  },
  vars(plan, frame) {
    const t = frame / plan.fps;
    const reaction = reactionAt(plan, t);
    // The two drawings alternate on twos; the burst fades over its last third.
    const level = reaction ? Math.min(1, (BURST - reaction.age) / (BURST / 3)) * 0.85 : 0;
    const first = reaction ? Math.floor((reaction.age * plan.fps) / 2 + 1e-6) % 2 === 0 : true;
    return { '--lc-look-rays': (t / 8) % 1, '--lc-look-speed-a': first ? level : 0, '--lc-look-speed-b': first ? 0 : level };
  }
};

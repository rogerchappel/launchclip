// Neon night: a dark scene lit by pink and cyan neon, with a rim light of
// each colour on everything that stands out of the dark, glow on the bright
// areas, long reflections on a wet floor, haze, and rain outdoors.
//
// Presets: night, a pink and cyan palette on near-black.
// Grade: a deeper, more saturated night; a pink rim on edges facing left and
// a cyan rim on edges facing right; bloom; and the bright parts of the frame
// drawn out into long vertical streaks over the lower part of the frame, the
// reflections of a wet floor, which shimmer between three drawings.
// Furniture: two drifting pools of coloured haze, and rain (outdoor worlds
// and stories without a world; an indoor world keeps its windows' city
// lights and gets no rain in the room).
//
// The streaks fall wherever the lower frame is, not on a floor the pass can
// see: under a close shot they read as glare rather than a floor.

import { arithmetic, blend, blur, curve, displace, fadeDown, filled, freq, glow, grey, linear, matrix, noise, rand, rgba, rim } from './parts.mjs';

const PINK = '#ff2e88', CYAN = '#22e3ff', NIGHT = '#07051a';
const INSIDE = ['office', 'home-desk', 'kitchen', 'living-room', 'classroom', 'cafe', 'workshop', 'server-room', 'studio', 'gym'];
const SHIMMER_EVERY = 3;

export const LOOK = {
  describe: 'a dark scene lit by pink and cyan neon: a rim light of each colour, glow on bright areas, long reflections on a wet floor, haze, and rain outdoors',
  words: ['\\bneon\\b', '\\bcyberpunk\\b', '\\bsynthwave\\b', '\\bblade ?runner\\b', '\\brain[- ]slicked\\b'],
  defaults: { strength: 1, step: 0 },
  presets: () => ({
    colors: { bg: NIGHT, primary: PINK, accent: CYAN, ink: NIGHT, paper: '#f4f0ff' },
    world: { kind: 'city-street', time: 'night' }
  }),
  variants: 3,
  variantAt: (plan, frame) => Math.floor(frame / SHIMMER_EVERY),
  grade(plan, v) {
    const u = plan.unit, H = plan.height;
    return [
      // A deeper night: more colour, the shadows pulled toward violet.
      matrix('night', 'SourceGraphic', [1.12, -0.06, 0.02, 0, 0.01, -0.05, 1.04, 0.03, 0, -0.01, 0.0, -0.02, 1.2, 0, 0.035, 0, 0, 0, 1, 0]),
      curve('deep', 'night', [0, 0.05, 0.12, 0.22, 0.35, 0.5, 0.68, 0.87, 1]),
      grey('l', 'deep'),
      rim('rim-pink', 'l', PINK, 9 * u, 2 * u, 3.6),
      rim('rim-cyan', 'l', CYAN, -9 * u, 2 * u, 3.6),
      blend('rims', 'rim-pink', 'rim-cyan', 'screen'),
      blur('rims-soft', 'rims', 1.1 * u),
      blend('lit', 'rims-soft', 'deep', 'screen'),
      glow('bloom', 'lit', 22 * u, 0.7, 0.55),
      // The wet floor: the bright parts, drawn out downward and shimmering, over the lower frame.
      linear('bright', 'bloom', 2.4, -0.8),
      blur('streak-raw', 'bright', 2 * u, 0.085 * H),
      noise('ripple', freq(0.004 / u, 0.05 / u), 211 + v * 9, 1),
      displace('streak-bent', 'streak-raw', 'ripple', 26 * u, 'R', 'A'),
      filled('streak', 'streak-bent', 'streak-raw'),
      fadeDown('floor', plan, 0.6 * H, 0.86 * H),
      arithmetic('wet-all', 'streak', 'floor', 1.25, 0, 0, 0),
      // A reflection shows on a dark floor and washes out on a light one.
      grey('ground', 'bloom', -1.5, 1),
      arithmetic('wet', 'ground', 'wet-all', 1, 0, 0, 0),
      blend('out', 'wet', 'bloom', 'screen')
    ];
  },
  furniture(plan) {
    const { width: W, height: H, unit: u } = plan;
    const rains = !INSIDE.includes(plan.world);
    // Rain: seeded streaks on a tile twice the canvas tall, so sliding it one canvas height loops.
    const drops = (count, seed, length, alpha) => Array.from({ length: count }, (_, i) => {
      const x = Math.round(rand(`${seed}:x`, i) * W), y = Math.round(rand(`${seed}:y`, i) * H), len = Math.round(length * (0.6 + rand(`${seed}:l`, i) * 0.8));
      return [0, H].map((dy) => `<path d="M${x} ${y + dy}l${-Math.round(len * 0.16)} ${len}" opacity="${Math.round((alpha * (0.5 + rand(`${seed}:a`, i) * 0.5)) * 100) / 100}"/>`).join('');
    }).join('');
    const layer = (name, count, length, width, alpha) => `<svg class="lc-look-neon-rain lc-look-neon-rain-${name}" width="${W}" height="${H * 2}" viewBox="0 0 ${W} ${H * 2}" fill="none" stroke="#cfe6ff" stroke-width="${width}" stroke-linecap="round">${drops(count, `neon-rain-${name}`, length, alpha)}</svg>`;
    const rain = rains ? `${layer('far', 90, 46 * u, Math.max(1, Math.round(1.5 * u)), 0.3)}${layer('near', 46, 92 * u, Math.max(2, Math.round(2.5 * u)), 0.42)}` : '';
    return {
      html: `<div class="lc-look-neon-haze lc-look-neon-haze-a"></div><div class="lc-look-neon-haze lc-look-neon-haze-b"></div>${rain}`,
      css: [
        `.lc-look-neon-haze { position: absolute; left: -20%; top: 0; width: 140%; height: 100%; }`,
        `.lc-look-neon-haze-a { background: radial-gradient(ellipse 55% 34% at 22% 78%, ${rgba(PINK, 0.26)}, transparent 70%); transform: translateX(calc(sin(var(--lc-look-haze, 0) * 6.2832rad) * ${Math.round(46 * u)}px)); }`,
        `.lc-look-neon-haze-b { background: radial-gradient(ellipse 52% 30% at 80% 24%, ${rgba(CYAN, 0.2)}, transparent 70%); transform: translateX(calc(sin((var(--lc-look-haze, 0) + 0.4) * 6.2832rad) * ${-Math.round(46 * u)}px)); }`,
        `.lc-look-neon-rain { position: absolute; left: 0; top: ${-H}px; }`,
        `.lc-look-neon-rain-far { transform: translateY(calc(var(--lc-look-rain-far, 0) * ${H}px)); }`,
        `.lc-look-neon-rain-near { transform: translateY(calc(var(--lc-look-rain-near, 0) * ${H}px)); }`
      ].join('\n')
    };
  },
  vars(plan, frame) {
    const t = frame / plan.fps;
    // The far rain falls one canvas height in 0.9 s, the near in 0.6 s; the haze drifts over 9 s.
    return { '--lc-look-rain-far': (t / 0.9) % 1, '--lc-look-rain-near': (t / 0.6) % 1, '--lc-look-haze': (t / 9) % 1 };
  }
};

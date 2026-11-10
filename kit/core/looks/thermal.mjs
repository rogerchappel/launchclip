// Thermal camera: the scene mapped through a black, purple, red, orange,
// yellow, white heat palette with a slight blur and sensor noise, under a
// camera overlay: crosshair, scale bar, record dot and a running clock.
//
// Grade: the frame softened, its brightness stretched and mapped through the
// heat ramp, with fine noise that changes every two frames. Brightness
// stands in for heat: a pixel pass cannot know what is warm, so the look sets
// the world to night, where the cast is the brightest thing in the room.
// Furniture: the overlay; the dot blinks once a second and the clock counts
// the story's seconds.

import { DIGIT_CSS, blur, clockVars, curve, digit, filled, grey, ramp, rgba, sensor, zones } from './parts.mjs';

const RAMP = ['#000004', '#1b0c4a', '#5a1280', '#b5173b', '#ee4a1c', '#ff9a17', '#ffe23a', '#fffbe6'];
const WHITE = '#ffffff', NOISE_EVERY = 2;

export const LOOK = {
  describe: 'the scene through a black, purple, red, orange, yellow, white heat palette with slight blur and sensor noise, under a camera overlay (crosshair, scale bar, record dot, clock)',
  words: ['\\bthermal\\b', '\\binfra[- ]?red\\b', '\\bheat[- ]?(?:map|vision|camera)\\b', '\\bFLIR\\b'],
  defaults: { strength: 1, step: 0 },
  presets: () => ({
    colors: { bg: '#0a0420', primary: '#ff9a17', accent: '#ffe23a', ink: '#0a0420', paper: '#fff7d6' },
    world: { time: 'night' }
  }),
  variants: 4,
  variantAt: (plan, frame) => Math.floor(frame / NOISE_EVERY),
  grade(plan, v) {
    const u = plan.unit;
    return [
      blur('soft-raw', 'SourceGraphic', 2.4 * u),
      filled('soft', 'soft-raw', 'SourceGraphic'),
      grey('l', 'soft'),
      // A sensor's response: the darks open up, the top rolls off.
      curve('heat', 'l', [0.02, 0.2, 0.36, 0.5, 0.62, 0.73, 0.83, 0.92, 1]),
      sensor('noisy', 'heat', 401 + v * 11, 0.09, 0.55 / u),
      ramp('out', 'noisy', RAMP)
    ];
  },
  furniture(plan) {
    const { width: W, height: H, unit: u } = plan;
    const z = zones(plan);
    const line = Math.max(2, Math.round(2.5 * u)), font = Math.round(26 * u), cx = Math.round(W / 2), cy = Math.round(z.safe.y + z.safe.height * 0.4);
    const arm = Math.round(54 * u), gap = Math.round(16 * u), box = Math.round(150 * u);
    const cross = `<svg class="lc-look-th-cross" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" stroke="${WHITE}" stroke-width="${line}" stroke-linecap="square"><path d="M${cx - gap - arm} ${cy}H${cx - gap}M${cx + gap} ${cy}H${cx + gap + arm}M${cx} ${cy - gap - arm}V${cy - gap}M${cx} ${cy + gap}V${cy + gap + arm}"/><path d="${[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => `M${cx + sx * box} ${cy + sy * (box - arm * 0.6)}V${cy + sy * box}H${cx + sx * (box - arm * 0.6)}`).join('')}" opacity="0.8"/></svg>`;
    // The scale bar: down the right edge of the safe zone, hot at the top.
    const barW = Math.round(22 * u), barH = Math.round(Math.min(z.safe.height * 0.34, 420 * u));
    const barX = z.safe.x + z.safe.width - barW, barY = z.safe.y + Math.round(z.safe.height * 0.08) + font + Math.round(10 * u);
    const [hot, cold] = [plan.labels[0] ?? '36.6°C', plan.labels[1] ?? '18.0°C'];
    const bar = `<div class="lc-look-th-temp" style="right:${W - barX - barW}px;top:${barY - font - Math.round(10 * u)}px">${hot}</div><div class="lc-look-th-bar" style="left:${barX}px;top:${barY}px;width:${barW}px;height:${barH}px"></div><div class="lc-look-th-temp" style="right:${W - barX - barW}px;top:${barY + barH + Math.round(10 * u)}px">${cold}</div>`;
    const top = z.top, mid = top.y + Math.round(top.h / 2);
    const rec = `<div class="lc-look-th-row" style="left:${top.x}px;top:${mid}px"><span class="lc-look-th-dot"></span><span>REC</span></div><div class="lc-look-th-row" style="right:${W - top.x - top.w}px;top:${mid}px"><span>${digit('--lc-look-c0')}${digit('--lc-look-c1')}:${digit('--lc-look-c2')}${digit('--lc-look-c3')}</span></div>`;
    return {
      html: `${cross}${bar}${rec}`,
      css: [
        DIGIT_CSS,
        `.lc-look-th-cross { position: absolute; left: 0; top: 0; filter: drop-shadow(0 0 ${Math.round(2 * u)}px ${rgba('#000000', 0.8)}); }`,
        `.lc-look-th-bar { position: absolute; border: ${line}px solid ${WHITE}; background: linear-gradient(to top, ${RAMP.join(', ')}); }`,
        `.lc-look-th-temp, .lc-look-th-row { position: absolute; color: ${WHITE}; font-size: ${font}px; line-height: 1; letter-spacing: 0.06em; white-space: nowrap; text-shadow: 0 0 ${Math.round(4 * u)}px ${rgba('#000000', 0.9)}, 0 ${Math.round(2 * u)}px ${Math.round(2 * u)}px ${rgba('#000000', 0.9)}; }`,
        `.lc-look-th-row { display: flex; align-items: center; gap: ${Math.round(12 * u)}px; transform: translateY(-50%); }`,
        `.lc-look-th-dot { width: ${Math.round(20 * u)}px; height: ${Math.round(20 * u)}px; border-radius: 50%; background: #ff2a2a; box-shadow: 0 0 ${Math.round(10 * u)}px #ff2a2a; opacity: var(--lc-look-rec, 1); }`
      ].join('\n')
    };
  },
  vars(plan, frame) {
    const t = frame / plan.fps;
    return { '--lc-look-rec': t % 1 < 0.5 ? 1 : 0.15, ...clockVars('--lc-look-c', t) };
  }
};

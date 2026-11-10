// Hologram: everything as translucent cyan light on black, with a glowing
// rim, additive glow, rolling scanlines, a faint wireframe, small glitch
// flickers, a glowing grid floor and floating technical labels.
//
// Grade: brightness becomes light (dark is empty space), every colour edge
// becomes a bright rim, a fine wireframe shows only where a shape is lit,
// the sum goes through a black-to-cyan-to-white ramp, and its bright parts
// glow. Three more drawings tear a few rows sideways: the glitch, fired in
// seeded bursts a few frames long.
// Furniture: scanlines that roll down, a slow band of brighter light, a
// perspective grid floor, and labels on leader lines that bob.

import { arithmetic, blend, blur, burstAt, curve, glow, grey, linear, outline, ramp, rand, rgba, rules, scanlines, tear, text, zones } from './parts.mjs';

const CYAN = '#3ff0ff', PALE = '#c9fbff', VOID = '#01060a';
const RAMP = [VOID, '#032a3a', '#0a7f9c', CYAN, PALE, '#ffffff'];
const LABELS = ['SIG 98.2%', 'NODE 07', 'LAT 0.4 MS', 'SYNC OK'];
const GLITCH = { rate: 0.6, frames: 3 };

export const LOOK = {
  describe: 'everything as translucent cyan light on black: a glowing rim, rolling scanlines, a faint wireframe, small glitch flickers, a glowing grid floor and floating technical labels',
  words: ['\\bholograms?\\b', '\\bholographic\\b', '\\bholo[- ]?(?:display|projection)\\b'],
  defaults: { strength: 1, step: 0 },
  presets: () => ({
    colors: { bg: VOID, primary: CYAN, accent: PALE, ink: VOID, paper: '#e9feff' },
    world: { time: 'night' }
  }),
  variants: 4,
  variantAt(plan, frame) {
    const burst = burstAt(`${plan.seed}:glitch`, frame, plan.fps, GLITCH.rate, GLITCH.frames);
    return burst ? 1 + (burst.index % 3) : 0;
  },
  grade(plan, v) {
    const u = plan.unit;
    return [
      ...(v > 0 ? [tear('src', 'SourceGraphic', 300 + v * 7, 46 * u, 0.012 / u)] : [linear('src', 'SourceGraphic', 1, 0)]),
      grey('l', 'src'),
      // Light, not paint: the dark half of the scene falls away to empty space.
      curve('body', 'l', [0, 0.03, 0.12, 0.3, 0.5, 0.68, 0.82, 0.92, 1]),
      linear('dim', 'body', 0.62, 0),
      outline('rim', 'src', 3 * u, 1.3),
      // The wireframe: a fine mesh, seen only on lit shapes.
      rules('mesh-h', 'y', 14 * u, Math.max(1, 1.4 * u), plan),
      rules('mesh-v', 'x', 14 * u, Math.max(1, 1.4 * u), plan),
      blend('mesh', 'mesh-h', 'mesh-v', 'lighten'),
      arithmetic('wire', 'mesh', 'body', 0.22, 0, 0, 0),
      blend('lit', 'wire', 'dim', 'screen'),
      blend('sum', 'rim', 'lit', 'screen'),
      ramp('light', 'sum', RAMP),
      // v > 0 flickers brighter.
      linear('level', 'light', v > 0 ? 1.18 : 1, 0),
      glow('glowed', 'level', 16 * u, 0.75, 0.35),
      blur('halo', 'glowed', 46 * u),
      arithmetic('out', 'glowed', 'halo', 0, 1, 0.28, 0)
    ];
  },
  furniture(plan) {
    const { width: W, height: H, unit: u } = plan;
    const z = zones(plan);
    const scan = scanlines({ period: Math.round(6 * u), color: '#000000', alpha: 0.26 });
    // The grid floor: lines to a vanishing point on the horizon, and rows that close up toward it.
    const horizon = Math.round(H * 0.74), cx = W / 2, rows = 9, cols = 14;
    const lines = [];
    for (let i = 0; i <= cols; i += 1) {
      const x = (i / cols - 0.5) * W * 3.2 + cx;
      lines.push(`M${Math.round(cx + (x - cx) * 0.08)} ${horizon}L${Math.round(x)} ${H}`);
    }
    for (let j = 1; j <= rows; j += 1) {
      const y = Math.round(horizon + (H - horizon) * (j / rows) ** 2.1);
      lines.push(`M0 ${y}H${W}`);
    }
    const stroke = Math.max(2, Math.round(2.5 * u));
    const floor = `<svg class="lc-look-holo-floor" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none"><defs><linearGradient id="lc-look-holo-fade" x1="0" y1="${horizon}" x2="0" y2="${H}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${CYAN}" stop-opacity="0"/><stop offset="0.35" stop-color="${CYAN}" stop-opacity="0.55"/><stop offset="1" stop-color="${PALE}" stop-opacity="0.95"/></linearGradient></defs><path d="${lines.join('')}" stroke="url(#lc-look-holo-fade)" stroke-width="${stroke}"/></svg>`;
    // Labels: on the edges of the safe zone, each on a leader line toward the middle.
    const font = Math.round(24 * u), names = plan.labels.length ? plan.labels : LABELS;
    const spots = [
      { x: z.safe.x, y: z.safe.y + Math.round(z.safe.height * 0.1), side: 1 },
      { x: z.safe.x + z.safe.width, y: z.safe.y + Math.round(z.safe.height * 0.24), side: -1 },
      { x: z.safe.x, y: z.safe.y + Math.round(z.safe.height * 0.52), side: 1 },
      { x: z.safe.x + z.safe.width, y: z.band.y - Math.round(70 * u), side: -1 },
      { x: z.safe.x + z.safe.width, y: z.top.y + Math.round(z.top.h * 0.5), side: -1 },
      { x: z.safe.x, y: z.top.y + Math.round(z.top.h * 0.5), side: 1 }
    ];
    const lead = Math.round(64 * u);
    const labels = names.slice(0, spots.length).map((name, i) => {
      const spot = spots[i], phase = r2(rand(`${plan.seed}:label`, i));
      const anchor = spot.side > 0 ? `left:${spot.x}px` : `right:${W - spot.x}px`;
      return `<div class="lc-look-holo-label" style="${anchor};top:${spot.y}px;flex-direction:${spot.side > 0 ? 'row' : 'row-reverse'};--p:${phase}"><span class="lc-look-holo-tag">${text(name.toUpperCase())}</span><span class="lc-look-holo-lead" style="width:${lead}px"></span><span class="lc-look-holo-dot"></span></div>`;
    }).join('');
    return {
      html: `${floor}<div class="lc-look-holo-sweep"></div>${scan.html}${labels}`,
      css: [
        scan.css,
        `.lc-look-holo-floor { position: absolute; left: 0; top: 0; filter: drop-shadow(0 0 ${Math.round(6 * u)}px ${rgba(CYAN, 0.9)}); }`,
        `.lc-look-holo-sweep { position: absolute; left: 0; right: 0; top: ${-Math.round(H * 0.25)}px; height: ${Math.round(H * 0.25)}px; background: linear-gradient(to bottom, transparent, ${rgba(PALE, 0.13)} 70%, ${rgba(PALE, 0.22)} 96%, transparent); transform: translateY(calc(var(--lc-look-sweep, 0) * ${Math.round(H * 1.25)}px)); }`,
        `.lc-look-holo-label { position: absolute; display: flex; align-items: center; color: ${PALE}; font-size: ${font}px; line-height: 1; letter-spacing: 0.1em; white-space: nowrap; transform: translateY(calc(-50% + sin((var(--lc-look-bob, 0) + var(--p)) * 6.2832rad) * ${Math.round(7 * u)}px)); text-shadow: 0 0 ${Math.round(10 * u)}px ${rgba(CYAN, 0.95)}; opacity: var(--lc-look-flick, 1); }`,
        `.lc-look-holo-tag { border: ${Math.max(1, Math.round(2 * u))}px solid ${rgba(CYAN, 0.85)}; background: ${rgba(VOID, 0.6)}; padding: ${Math.round(8 * u)}px ${Math.round(12 * u)}px; }`,
        `.lc-look-holo-lead { height: ${Math.max(1, Math.round(2 * u))}px; background: ${rgba(CYAN, 0.85)}; }`,
        `.lc-look-holo-dot { width: ${Math.round(10 * u)}px; height: ${Math.round(10 * u)}px; border-radius: 50%; background: ${PALE}; box-shadow: 0 0 ${Math.round(12 * u)}px ${CYAN}; }`
      ].join('\n')
    };
  },
  vars(plan, frame) {
    const t = frame / plan.fps;
    const burst = burstAt(`${plan.seed}:glitch`, frame, plan.fps, GLITCH.rate, GLITCH.frames);
    return {
      // One scanline period every 4 frames; the bright band crosses every 5 s; labels bob every 4 s.
      '--lc-look-scan': (frame % 4) / 4,
      '--lc-look-sweep': (t / 5) % 1,
      '--lc-look-bob': (t / 4) % 1,
      '--lc-look-flick': burst ? 0.55 : 1
    };
  }
};

function r2(value) { return Math.round(value * 100) / 100; }

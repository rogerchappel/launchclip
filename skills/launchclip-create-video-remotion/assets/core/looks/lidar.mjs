// LiDAR scan: the frame as a point cloud on a dark ground, each point
// coloured by height (brightness stands in for it: a pixel pass cannot know
// depth), through a blue, green, yellow, red ramp, with a soft glow. At each
// cut a scan plane sweeps down the frame: ahead of it the ground is dark,
// behind it the returns show, brightest just behind the plane, then settle.
//
// Grade: luminance through the height ramp, kept only on a square point
// lattice (dots tiled and dilated), a glow, over the ground colour.
// Furniture: the cover ahead of the plane, the plane's bright line and its
// afterglow, and a scanner label (channel count, a running sweep counter).
//
// Technique rewritten from the reference demo's description (docs/FINISHING_AND_ELEMENTS_RFC.md §E.10).

import { DIGIT_CSS, composite, digit, easeOut, fe, flood, glow, grey, image, linear, ramp, rgba, shotAt, zones } from './parts.mjs';

const GROUND = '#04060c', LINE = '#7cf7ff';
const HEIGHT = ['#0b1a5c', '#1546d6', '#11b5c9', '#2fdc6a', '#e8e23a', '#ff8a1f', '#ff3b2f'];
const SWEEP = 1.1, GLOW = 0.5;

/** The point lattice for a canvas: whole pixels, 7 px at 1080p. */
export const lidarCell = (unit) => Math.max(3, Math.round(7 * unit));

export const LOOK = {
  describe: 'the frame as a LiDAR point cloud on a dark ground, points coloured by height (blue low, red high) with a soft glow; at each cut a scan plane sweeps down and the returns light up behind it, then settle',
  honest: 'height is the picture\'s brightness, not measured depth: the points are a lattice over the frame, not a 3D scan',
  words: ['\\blidar\\b', '\\bpoint[- ]cloud (?:look|style|scan)\\b', '\\b3d scan(?:ner)? (?:look|style)\\b', '\\blaser scan(?:ner)? look\\b'],
  defaults: { strength: 1, step: 0 },
  presets: () => ({
    colors: { bg: GROUND, primary: '#2fdc6a', accent: LINE, ink: GROUND, paper: '#e9fbff' },
    world: { time: 'night' }
  }),
  variants: 1,
  grade(plan) {
    const u = plan.unit, c = lidarCell(u), r = Math.max(1, Math.round(1.2 * u));
    const dot = `<svg xmlns="http://www.w3.org/2000/svg" width="${c}" height="${c}"><rect width="1" height="1" fill="#fff"/></svg>`;
    return [
      grey('l', 'SourceGraphic'),
      // Open the darks a little, so dim surfaces still return points.
      linear('lift', 'l', 0.85, 0.12),
      ramp('col', 'lift', HEIGHT),
      image('dot', dot, 0, 0, c, c),
      fe('feTile', { in: 'dot', x: 0, y: 0, width: plan.width, height: plan.height, result: 'dots' }),
      fe('feMorphology', { in: 'dots', operator: 'dilate', radius: r, result: 'lattice' }),
      composite('pts', 'col', 'lattice', 'in'),
      glow('lit', 'pts', 3 * u, 0.7, 0.2),
      flood('ground', GROUND),
      composite('out', 'lit', 'ground', 'over')
    ];
  },
  furniture(plan) {
    const { width: W, height: H, unit: u } = plan;
    const z = zones(plan), font = Math.round(24 * u), line = Math.max(2, Math.round(3 * u)), after = Math.round(H * 0.18);
    const top = z.top, mid = top.y + Math.round(top.h / 2);
    return {
      html: `<div class="lc-look-li-cover"></div><div class="lc-look-li-plane"><div class="lc-look-li-after"></div><div class="lc-look-li-line"></div></div><div class="lc-look-li-label" style="left:${top.x}px;top:${mid}px">LIDAR · 128 CH · SWEEP ${digit('--lc-look-s0')}${digit('--lc-look-s1')}</div>`,
      css: [
        DIGIT_CSS,
        // The cover hangs below the plane; the plane rides at --lc-look-y px.
        `.lc-look-li-cover { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; background: ${GROUND}; transform: translateY(calc(var(--lc-look-y, ${H}) * 1px)); }`,
        `.lc-look-li-plane { position: absolute; left: 0; top: 0; width: ${W}px; height: 0; opacity: var(--lc-look-on, 0); transform: translateY(calc(var(--lc-look-y, ${H}) * 1px)); }`,
        `.lc-look-li-line { position: absolute; left: 0; top: ${-Math.round(line / 2)}px; width: ${W}px; height: ${line}px; background: ${LINE}; box-shadow: 0 0 ${Math.round(12 * u)}px ${LINE}, 0 0 ${Math.round(30 * u)}px ${rgba(LINE, 0.6)}; }`,
        `.lc-look-li-after { position: absolute; left: 0; top: ${-after}px; width: ${W}px; height: ${after}px; background: linear-gradient(to bottom, ${rgba(LINE, 0)}, ${rgba(LINE, 0.22)}); opacity: var(--lc-look-glow, 0); }`,
        `.lc-look-li-label { position: absolute; color: ${LINE}; font-size: ${font}px; line-height: 1; letter-spacing: 0.12em; white-space: nowrap; transform: translateY(-50%); text-shadow: 0 0 ${Math.round(6 * u)}px ${rgba(LINE, 0.7)}; }`
      ].join('\n')
    };
  },
  vars(plan, frame) {
    const t = frame / plan.fps, { index, age } = shotAt(plan, t);
    const sweep = Math.max(0, index) + 1;
    const counter = { '--lc-look-s0': Math.floor(sweep / 10) % 10, '--lc-look-s1': sweep % 10 };
    // Before the first shot, and after each sweep, the plane is gone and every return shows.
    if (index < 0 || age >= SWEEP + GLOW) return { ...counter, '--lc-look-y': plan.height, '--lc-look-on': 0, '--lc-look-glow': 0 };
    const p = easeOut(Math.min(1, age / SWEEP));
    // The afterglow fades over GLOW seconds once the plane reaches the bottom.
    const fade = age <= SWEEP ? 1 : 1 - (age - SWEEP) / GLOW;
    return { ...counter, '--lc-look-y': Math.round(p * plan.height), '--lc-look-on': fade, '--lc-look-glow': fade };
  }
};

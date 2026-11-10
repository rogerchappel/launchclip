// Blueprint: deep blue paper with a fine grid, the scene as white and cyan
// line drawing, dimension lines with measurements, and a title block. Each
// shot wipes in from the left behind a drawing line.
//
// Grade: brightness edges become lines (a morphological outline, so every
// line has one weight) and fills keep only a faint lift of the paper, all
// through one blue ramp. Text is outlined like drafting lettering.
// Furniture: the grid, the sheet border, the wipe, two dimension lines that
// draw in and carry the safe zone's real size in pixels, and the title block
// (the story's title, the scale and the sheet number, one sheet per shot).

import { blend, easeOut, grey, linear, outline, ramp, rgba, shotAt, text, zones } from './parts.mjs';

const PAPER = '#0a2a66', LINE = '#a9e2ff', WHITE = '#ffffff';
const RAMP = [PAPER, '#12408f', '#3f86c9', LINE, WHITE];
const DRAW = 0.8, DIM_DELAY = 0.25, DIM = 0.7;

export const LOOK = {
  describe: 'deep blue paper and a fine grid, the scene as white and cyan line drawing with dimension lines and a title block; each shot wipes in behind a drawing line',
  words: ['\\bblueprint (?:style|look|drawing|aesthetic|animation)\\b', '\\b(?:as|like) (?:a |an )?(?:architect\'s )?blueprints?\\b', '\\btechnical drawing\\b', '\\bcyanotype\\b'],
  defaults: { strength: 1, step: 0 },
  presets: () => ({
    colors: { bg: PAPER, primary: '#8fd8ff', accent: WHITE, ink: PAPER, paper: '#f2fbff' },
    cast: { style: 'line' }
  }),
  variants: 1,
  grade(plan) {
    const u = plan.unit;
    return [
      grey('l', 'SourceGraphic'),
      outline('edge', 'SourceGraphic', 2.6 * u, 1.5),
      // Fills keep a faint lift of the paper, lighter where the scene was lighter.
      linear('fill', 'l', 0.26, 0),
      blend('sum', 'edge', 'fill', 'screen'),
      ramp('out', 'sum', RAMP)
    ];
  },
  furniture(plan) {
    const { width: W, height: H, unit: u } = plan;
    const z = zones(plan);
    const minor = Math.round(36 * u), major = minor * 5, m = Math.round(Math.min(W, H) * 0.022);
    const grid = (alphaMinor, alphaMajor) => ['to right', 'to bottom'].flatMap((dir) => [
      `repeating-linear-gradient(${dir}, ${rgba(LINE, alphaMajor)} 0, ${rgba(LINE, alphaMajor)} ${Math.max(1, Math.round(2 * u))}px, transparent ${Math.max(1, Math.round(2 * u))}px, transparent ${major}px)`,
      `repeating-linear-gradient(${dir}, ${rgba(LINE, alphaMinor)} 0, ${rgba(LINE, alphaMinor)} 1px, transparent 1px, transparent ${minor}px)`
    ]).join(', ');
    const stroke = Math.max(2, Math.round(2.5 * u)), font = Math.round(24 * u), tick = Math.round(14 * u);
    // Dimension lines: across the top of the safe zone and down its left edge.
    const hx0 = z.safe.x, hx1 = z.safe.x + z.safe.width, hy = z.top.y + z.top.h - tick;
    const vx = Math.round(z.safe.x * 0.5), vy0 = z.safe.y, vy1 = z.band.y - Math.round(12 * u);
    const dim = (d) => `<path d="${d}" pathLength="1" class="lc-look-bp-dim"/>`;
    const arrow = (x, y, dx, dy) => `M${x + dx * tick + dy * tick * 0.4} ${y + dy * tick + dx * tick * 0.4}L${x} ${y}L${x + dx * tick - dy * tick * 0.4} ${y + dy * tick - dx * tick * 0.4}`;
    const svg = `<svg class="lc-look-bp-dims" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" stroke="${LINE}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${[
      dim(`M${hx0} ${hy - tick}V${hy + tick}`), dim(`M${hx1} ${hy - tick}V${hy + tick}`), dim(`M${hx0} ${hy}H${hx1}`), dim(arrow(hx0, hy, 1, 0)), dim(arrow(hx1, hy, -1, 0)),
      dim(`M${vx - tick} ${vy0}H${vx + tick}`), dim(`M${vx - tick} ${vy1}H${vx + tick}`), dim(`M${vx} ${vy0}V${vy1}`), dim(arrow(vx, vy0, 0, 1)), dim(arrow(vx, vy1, 0, -1))
    ].join('')}</svg>`;
    const labels = `<div class="lc-look-bp-label" style="left:${Math.round((hx0 + hx1) / 2)}px;top:${hy - Math.round(font * 0.62)}px;transform:translate(-50%,-50%)"><span>${z.safe.width}</span></div><div class="lc-look-bp-label" style="left:${vx}px;top:${Math.round((vy0 + vy1) / 2)}px;transform:translate(-50%,-50%) rotate(-90deg)"><span>${vy1 - vy0}</span></div>`;
    // Title block: under the caption band when the format leaves room, else at the top right.
    const zone = z.bottom ?? z.top;
    const bw = Math.round(Math.min(zone.w * 0.6, 520 * u)), bh = Math.round(font * 3.3);
    const bx = zone.x + zone.w - bw, by = z.bottom ? zone.y : Math.max(m + stroke, zone.y - Math.round(bh * 0.55));
    const [title, scale] = [plan.labels[0] ?? (plan.title.length > 26 ? `${plan.title.slice(0, 25)}…` : plan.title || 'UNTITLED'), plan.labels[1] ?? 'SCALE 1:1'];
    const total = Math.max(1, plan.shots.length);
    const pad = (n) => String(n).padStart(2, '0');
    const sheets = Array.from({ length: total }, (_, i) => `<span class="lc-look-bp-sheet" style="opacity:clamp(0, calc(1 - max(var(--lc-look-shot, 0) - ${i}, ${i} - var(--lc-look-shot, 0))), 1)">SHEET ${pad(i + 1)}/${pad(total)}</span>`).join('');
    const block = `<div class="lc-look-bp-block" style="left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px"><div class="lc-look-bp-row">${text(title.toUpperCase())}</div><div class="lc-look-bp-row lc-look-bp-split"><span>${text(scale.toUpperCase())}</span><span class="lc-look-bp-sheets">${sheets}</span></div></div>`;
    return {
      html: `<div class="lc-look-bp-grid"></div><div class="lc-look-bp-cover"><div class="lc-look-bp-grid"></div></div><div class="lc-look-bp-pen"></div><div class="lc-look-bp-border"></div>${svg}${labels}${block}`,
      css: [
        `.lc-look-bp-grid { position: absolute; inset: 0; background: ${grid(0.07, 0.14)}; }`,
        // The wipe: paper over the part of the sheet not drawn yet, and the drawing line at its edge.
        `.lc-look-bp-cover { position: absolute; inset: 0; background: ${PAPER}; clip-path: inset(0 0 0 calc(var(--lc-look-draw, 1) * 100%)); }`,
        `.lc-look-bp-pen { position: absolute; top: 0; bottom: 0; left: calc(var(--lc-look-draw, 1) * 100%); width: ${Math.max(3, Math.round(5 * u))}px; background: ${WHITE}; box-shadow: 0 0 ${Math.round(22 * u)}px ${Math.round(4 * u)}px ${rgba(LINE, 0.7)}; opacity: var(--lc-look-drawing, 0); }`,
        `.lc-look-bp-border { position: absolute; left: ${m}px; top: ${m}px; right: ${m}px; bottom: ${m}px; border: ${stroke}px solid ${rgba(LINE, 0.75)}; }`,
        `.lc-look-bp-dims { position: absolute; left: 0; top: 0; }`,
        `.lc-look-bp-dim { stroke-dasharray: 1; stroke-dashoffset: calc(1 - var(--lc-look-dim, 1)); opacity: var(--lc-look-dim-on, 1); }`,
        `.lc-look-bp-label { position: absolute; color: ${WHITE}; font-size: ${font}px; line-height: 1; letter-spacing: 0.08em; opacity: var(--lc-look-dim, 1); white-space: nowrap; }`,
        `.lc-look-bp-label span { background: ${PAPER}; padding: 0 ${Math.round(10 * u)}px; }`,
        `.lc-look-bp-block { position: absolute; border: ${stroke}px solid ${LINE}; background: ${rgba(PAPER, 0.92)}; color: ${WHITE}; font-size: ${font}px; line-height: 1; letter-spacing: 0.08em; display: flex; flex-direction: column; }`,
        `.lc-look-bp-row { flex: 1; display: flex; align-items: center; padding: 0 ${Math.round(14 * u)}px; white-space: nowrap; overflow: hidden; }`,
        `.lc-look-bp-row + .lc-look-bp-row { border-top: ${stroke}px solid ${LINE}; }`,
        `.lc-look-bp-split { justify-content: space-between; gap: ${Math.round(14 * u)}px; }`,
        `.lc-look-bp-sheets { position: relative; flex: 1; align-self: stretch; }`,
        `.lc-look-bp-sheet { position: absolute; right: 0; top: 50%; transform: translateY(-50%); }`
      ].join('\n')
    };
  },
  vars(plan, frame) {
    const { index, age } = shotAt(plan, frame / plan.fps);
    const draw = index < 0 ? 1 : easeOut(age / DRAW);
    const dim = index < 0 ? 1 : easeOut((age - DIM_DELAY) / DIM);
    return { '--lc-look-draw': draw, '--lc-look-drawing': draw < 1 ? 1 : 0, '--lc-look-dim': dim, '--lc-look-dim-on': dim > 0 ? 1 : 0, '--lc-look-shot': Math.max(0, index) };
  }
};

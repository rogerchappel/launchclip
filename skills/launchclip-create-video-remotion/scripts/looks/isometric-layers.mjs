// Isometric layers: the scene's layers standing as flat cut-outs on a pastel
// floor, seen from a 45-degree orthographic camera, each casting a soft
// shadow on the one behind, with small icon cards floating around them.
//
// It is named for what it is. The projection is a true isometric one (an
// orthographic camera turned 45 degrees and tilted 35.26), but what it
// projects is the story's flat layers (the world on track 0, the cast and
// the cards on the tracks above), spaced apart in depth like a toy theatre.
// Nothing is modelled in 3D: a desk does not gain a top, and a character
// does not turn. For objects with real depth use the kit's 3D modules.
//
// Presets: a pastel palette, the soft-shade drawing style, day, camera cuts.
// Stage (no grade): one 2D affine transform per scene layer (an orthographic
// projection of a plane is affine, so no 3D context is needed and both
// renderers agree), a drop shadow per layer, and the floor under them all.
// Furniture: up to three icon cards (the story's own icons, else defaults),
// drawn in the same projection, bobbing slowly.
//
// The stage needs the scenes in screen space: with a world camera (or a
// camera transition) the layers stay flat and only the palette and the cards
// apply. Scene text is drawn at about half its size on the 9:16 canvas and
// about a third on 16:9, because the tilted plane has to fit the frame.

import { rgba } from './parts.mjs';

// cos 45°, sin 35.264° × sin 45°, cos 35.264°: where a plane's x and y axes land on screen.
const AX = 0.7071, BX = -0.4082, DY = 0.8165;
// Each track above the world stands this far in front of the one below, as a share of the canvas width.
const DEPTH = 0.1;
const FLOOR = '#d3dbf0', FLOOR_EDGE = '#b7c2e3', CARD = '#ffffff';
const ICONS = ['sparkles', 'check', 'heart'];

/** The projection for a canvas: the scale that fits the tilted plane, and where its top-left corner lands. */
export function isometricFit({ width: W, height: H }, tracks = 2) {
  const reach = DEPTH * W * Math.max(0, tracks - 1);
  const s = Math.min(0.9 * W / (AX * W + AX * reach), 0.88 * H / (DY * H - BX * W - BX * reach));
  const w = AX * s * (W + reach), h = s * (DY * H - BX * W - BX * reach);
  // The world plane's top-left corner: the box of every layer is centred, a little above the middle.
  const x = (W - w) / 2 + AX * s * reach, y = (H - h) / 2 - H * 0.02 - BX * s * W;
  return { s, x, y, reach };
}

const round = (value, digits = 4) => { const f = 10 ** digits; return Math.round(value * f) / f + 0; };

export const LOOK = {
  describe: 'the scene\'s layers standing as flat cut-outs on a pastel floor, seen from a 45-degree orthographic camera, with soft shadows between them and small floating icon cards. Layers, not modelled objects',
  honest: 'flat layers in an isometric projection, not 3D models: nothing gains depth of its own',
  words: ['\\bisometric\\b', '\\bdiorama\\b', '\\btoy theatre\\b'],
  defaults: { strength: 1, step: 0 },
  presets: () => ({
    // A light sheet: paper is the dark lettering, ink the light text on the primary.
    colors: { bg: '#eef1f8', primary: '#5b6ee1', accent: '#d9567f', ink: '#ffffff', paper: '#2a2d43' },
    cast: { style: 'soft-shade' },
    world: { time: 'day' },
    camera: { mode: 'cuts' }
  }),
  /** → {planes: {sceneId: {transform, filter}}, under: html, css} for the scenes the plan lists. */
  stage(plan) {
    const { width: W, height: H, unit: u } = plan;
    const tracks = Math.min(4, 1 + Math.max(0, ...plan.scenes.map((scene) => scene.track)));
    const fit = isometricFit(plan, tracks);
    const { s } = fit;
    // A track's layer stands toward the viewer: left and down on screen.
    const at = (track) => ({ x: fit.x - AX * s * DEPTH * W * track, y: fit.y - BX * s * DEPTH * W * track });
    const shadow = `drop-shadow(${round(AX * 26 * u, 1)}px ${round(-BX * 26 * u + 10 * u, 1)}px ${round(22 * u, 1)}px ${rgba('#1f2547', 0.3)})`;
    const planes = Object.fromEntries(plan.scenes.map((scene) => {
      const p = at(Math.min(scene.track, tracks - 1));
      return [scene.id, { transform: `matrix(${round(AX * s)}, ${round(BX * s)}, 0, ${round(DY * s)}, ${round(p.x, 2)}, ${round(p.y, 2)})`, filter: shadow }];
    }));
    // The floor: from the world plane's bottom edge toward the viewer, past the front layer.
    const left = { x: fit.x, y: fit.y + DY * s * H }, right = { x: fit.x + AX * s * W, y: fit.y + BX * s * W + DY * s * H };
    const depth = DEPTH * W * (tracks + 1.2), out = { x: -AX * s * depth, y: -BX * s * depth };
    const back = 0.06 * W, behind = { x: AX * s * back, y: BX * s * back };
    const pt = (p, d, k = 1) => `${round(p.x + d.x * k, 1)},${round(p.y + d.y * k, 1)}`;
    const floor = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;left:0;top:0"><defs><linearGradient id="lc-look-iso-floor" x1="${round(left.x, 1)}" y1="${round(left.y, 1)}" x2="${round(left.x + out.x, 1)}" y2="${round(left.y + out.y, 1)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${FLOOR_EDGE}"/><stop offset="0.25" stop-color="${FLOOR}"/><stop offset="1" stop-color="${FLOOR}"/></linearGradient></defs><polygon points="${pt(left, behind)} ${pt(right, behind)} ${pt(right, out)} ${pt(left, out)}" fill="url(#lc-look-iso-floor)" stroke="${FLOOR_EDGE}" stroke-width="${Math.max(2, Math.round(3 * u))}" stroke-linejoin="round"/></svg>`;
    return { planes, under: floor };
  },
  furniture(plan) {
    const { width: W, height: H, unit: u } = plan;
    const fit = isometricFit(plan, 2);
    const size = Math.round(150 * u), icon = Math.round(size * 0.52);
    const names = [...new Set([...plan.icons, ...ICONS])].slice(0, 3);
    // In the corners the tilted plane leaves empty: upper left, lower right, and above its high right end.
    const spots = [
      { x: 0.07 * W, y: Math.max(0.05 * H, fit.y - 0.02 * H - size) },
      { x: 0.93 * W - size * 0.8, y: Math.min(0.86 * H, fit.y + DY * fit.s * H + 0.02 * H) },
      { x: 0.74 * W - size * 0.4, y: Math.max(0.03 * H, fit.y + BX * fit.s * W - size * 1.25) }
    ];
    const tints = [plan.colors.primary ?? '#5b6ee1', plan.colors.accent ?? '#d9567f', '#3aa58a'];
    const cards = names.map((name, i) => `<div class="lc-look-iso-card" style="left:${Math.round(spots[i].x)}px;top:${Math.round(spots[i].y)}px;--p:${round((i * 0.37) % 1, 2)}"><svg width="${icon}" height="${icon}" viewBox="0 0 24 24" fill="none" stroke="${tints[i]}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${plan.iconPaths[name] ?? ''}"/></svg></div>`).join('');
    return {
      html: cards,
      css: `.lc-look-iso-card { position: absolute; width: ${size}px; height: ${size}px; border-radius: ${Math.round(size * 0.22)}px; background: ${CARD}; display: flex; align-items: center; justify-content: center; transform-origin: 0 0; transform: translateY(calc(sin((var(--lc-look-bob, 0) + var(--p)) * 6.2832rad) * ${Math.round(12 * u)}px)) matrix(${AX}, ${BX}, 0, ${DY}, 0, 0); box-shadow: ${round(AX * 16 * u, 1)}px ${round(-BX * 16 * u + 12 * u, 1)}px ${Math.round(20 * u)}px ${rgba('#1f2547', 0.24)}; }`
    };
  },
  vars: (plan, frame) => ({ '--lc-look-bob': (frame / plan.fps / 5) % 1 })
};

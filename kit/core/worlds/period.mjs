// Filled storytelling worlds for character stories: a period parlour and a
// European café terrace. Each fills the frame edge to edge (patterned
// wallpaper, panelling, stone facades, cobbles) and is lit from inside the
// picture (a fire, a lamp, café windows, string lights), so a flat stick
// figure stands in a designed place rather than on a plain backdrop. The
// centre band stays open for the cast; text sits in the named quiet area.
//
// Same contract as the other worlds: {group, label, describe, geo, back,
// mid, front, fx, light?}; colours come from the world palette (graded for
// the time), emissive light (fire, lamps, lit windows) is never graded.

import {mixColor} from '../catalog-b-base.mjs';
import {f, pts} from './pen.mjs';
import {span, wall, floor, interiorWindow, sky, haze, lampPost, tree} from './common.mjs';
import {curtains} from './furniture.mjs';
import {PROPS} from './props.mjs';

const G = {glow: true};

// ---------------------------------------------------------------------------
// Parlour

/** Room geometry as the inside worlds lay it out: floor line, ground, anchors. */
function parlourGeo(k) {
  const {W, H, ppm, portrait} = k;
  const floorY = Math.round(H * (portrait ? 0.74 : 0.7));
  const groundY = Math.round(floorY + (H - floorY) * 0.42);
  const fire = portrait ? {x: W * 0.58, w: W * 0.36} : {x: W * 0.66, w: W * 0.2};
  return {
    floorY, groundY, fire,
    win: portrait ? {x: W * 0.08, y: H * 0.2, w: W * 0.3, h: H * 0.28} : {x: W * 0.07, y: H * 0.14, w: W * 0.15, h: H * 0.42},
    anchors: {
      ground: {y: groundY, x0: W * 0.04, x1: W * 0.96, ppm},
      floor: {y: floorY + 6, x0: W * 0.04, x1: W * 0.96, ppm: ppm * 0.86, layer: 'mid'},
      wall: {y: Math.round(floorY * 0.46), x0: W * 0.06, x1: W * 0.94, ppm: ppm * 0.86, layer: 'back'},
      surface: {y: Math.round(floorY - ppm * 0.86 * 1.15), x0: fire.x + fire.w * 0.15, x1: fire.x + fire.w * 0.85, ppm: ppm * 0.86, layer: 'back'}
    },
    quiet: portrait
      ? {x: Math.round(W * 0.06), y: Math.round(H * 0.04), width: Math.round(W * 0.88), height: Math.round(H * 0.12)}
      : {x: Math.round(W * 0.27), y: Math.round(H * 0.07), width: Math.round(W * 0.34), height: Math.round(H * 0.2)}
  };
}

const paper = k => k.pal.g(mixColor(k.pal.brand.primary, '#6e3b39', 0.1));
const gilt = k => k.pal.g('#b8903e');

/** Damask wallpaper: paired stripes and a lozenge motif in rows, over the plain wall. */
function wallpaper(k, top, bottom) {
  const {p, u, d} = k;
  const {x0, x1} = span(k);
  const base = paper(k);
  const lineC = mixColor('#ffffff', base, 0.14), motif = mixColor('#ffffff', base, 0.1);
  const out = [];
  const step = 120 * u;
  for (let x = x0; x < x1; x += step) {
    out.push(p.rect(x, top, 3 * u, bottom - top, lineC, {stroke: false, opacity: 0.7}), p.rect(x + 9 * u, top, 2 * u, bottom - top, lineC, {stroke: false, opacity: 0.5}));
    if (d.n < 1 && !d.outline) continue;
    for (let y = top + 50 * u, row = 0; y < bottom - 40 * u; y += 130 * u, row++) {
      const cx = x + step / 2 + (row % 2 ? step / 2 : 0), r = 20 * u;
      out.push(p.path(pts([[cx, y - r * 1.5], [cx + r, y], [cx, y + r * 1.5], [cx - r, y]]), motif, {stroke: false, opacity: 0.75}));
      out.push(p.circle(cx, y, r * 0.35, base, {stroke: false}));
    }
  }
  return out;
}

/** A gilt frame (oval or square) round a portrait or a mirror. */
function giltFrame(k, cx, cy, rx, ry, {oval = true, inner = null} = {}) {
  const {p, u, pal} = k;
  const g = gilt(k);
  const fill = inner ?? mixColor('#000000', pal.g('#6b5a48'), 0.2);
  if (oval) return [p.ellipse(cx + 6 * u, cy + 8 * u, rx, ry, pal.shadow, {opacity: pal.shadowAlpha, stroke: false}), p.ellipse(cx, cy, rx, ry, g, {}), p.ellipse(cx, cy, rx - 12 * u, ry - 12 * u, fill, {})];
  return [p.rect(cx - rx + 6 * u, cy - ry + 8 * u, rx * 2, ry * 2, pal.shadow, {opacity: pal.shadowAlpha, stroke: false}), p.rect(cx - rx, cy - ry, rx * 2, ry * 2, g, {rx: 4 * u}), p.rect(cx - rx + 14 * u, cy - ry + 14 * u, rx * 2 - 28 * u, ry * 2 - 28 * u, fill, {})];
}

/** A small head-and-shoulders silhouette in a portrait. */
function sitter(k, cx, cy, s) {
  const {p, pal} = k;
  const c = mixColor('#000000', pal.g('#3b2e2a'), 0.1);
  return [p.circle(cx, cy - s * 0.25, s * 0.22, c, {stroke: false}), p.path(`M${f(cx - s * 0.45)} ${f(cy + s * 0.55)}Q${f(cx)} ${f(cy - s * 0.2)} ${f(cx + s * 0.45)} ${f(cy + s * 0.55)}Z`, c, {stroke: false})];
}

/** Fire in a grate: flames, embers and the glow round them (bright at dusk and night). */
function fire(k, cx, y, w) {
  const {p, u, time} = k;
  const bright = time === 'day' ? 0.55 : 1;
  const out = [p.ellipse(cx, y, w * 0.9, w * 0.5, p.rad([[0, '#ffb347', 0.7 * bright], [1, '#ff6a1a', 0]], cx, y, w * 0.9, {force: true, glow: true}), G)];
  out.push(p.rect(cx - w * 0.5, y - 10 * u, w, 14 * u, '#2a1a14', {rx: 4 * u}));
  for (const [dx, h, c] of [[-0.28, 0.6, '#ff7a1f'], [0, 0.95, '#ffb547'], [0.26, 0.7, '#ff8a2a'], [-0.1, 0.5, '#ffd27a'], [0.12, 0.45, '#fff0b8']]) {
    const x = cx + dx * w, hh = h * w * 0.8;
    out.push(p.path(`M${f(x - w * 0.12)} ${f(y - 8 * u)}Q${f(x - w * 0.1)} ${f(y - hh * 0.6)} ${f(x)} ${f(y - hh)}Q${f(x + w * 0.1)} ${f(y - hh * 0.6)} ${f(x + w * 0.12)} ${f(y - 8 * u)}Z`, c, {glow: true, opacity: bright}));
  }
  return out;
}

/** A wingback armchair standing on floorY, centred on cx. */
function armchair(k, cx, floorY, s, color) {
  const {p, u} = k;
  const w = 0.9 * s, h = 1.15 * s;
  const top = floorY - h;
  const dark = mixColor('#000000', color, 0.25);
  return [
    p.shadow(cx, floorY + 4 * u, w * 0.6, 16 * u),
    p.path(`M${f(cx - w * 0.42)} ${f(floorY - h * 0.35)}L${f(cx - w * 0.4)} ${f(top + h * 0.12)}Q${f(cx)} ${f(top - h * 0.06)} ${f(cx + w * 0.4)} ${f(top + h * 0.12)}L${f(cx + w * 0.42)} ${f(floorY - h * 0.35)}Z`, color, {}),
    p.path(`M${f(cx - w * 0.5)} ${f(top + h * 0.22)}Q${f(cx - w * 0.62)} ${f(top + h * 0.3)} ${f(cx - w * 0.52)} ${f(floorY - h * 0.3)}L${f(cx - w * 0.36)} ${f(floorY - h * 0.3)}L${f(cx - w * 0.36)} ${f(top + h * 0.2)}Z`, dark, {}),
    p.path(`M${f(cx + w * 0.5)} ${f(top + h * 0.22)}Q${f(cx + w * 0.62)} ${f(top + h * 0.3)} ${f(cx + w * 0.52)} ${f(floorY - h * 0.3)}L${f(cx + w * 0.36)} ${f(floorY - h * 0.3)}L${f(cx + w * 0.36)} ${f(top + h * 0.2)}Z`, dark, {}),
    p.rect(cx - w * 0.5, floorY - h * 0.4, w, h * 0.26, mixColor('#ffffff', color, 0.08), {rx: 14 * u}),
    p.rect(cx - w * 0.46, floorY - h * 0.16, w * 0.92, h * 0.1, dark, {rx: 6 * u}),
    ...[-0.4, 0.4].map(dx => p.rect(cx + dx * w - 5 * u, floorY - h * 0.07, 10 * u, h * 0.07 + 2, mixColor('#000000', k.pal.woodShade, 0.2), {}))
  ];
}

/** A Persian-style rug: border, field and medallion. */
function persianRug(k, cx, cy, w, h) {
  const {p, pal, u} = k;
  const red = pal.g('#8c2f2b'), border = pal.g('#2f3a5a'), cream = pal.cream;
  const quad = (inset, c) => p.path(pts([[cx - w / 2 + inset * 1.6, cy - h / 2 + inset * 0.4], [cx + w / 2 - inset * 1.6, cy - h / 2 + inset * 0.4], [cx + w / 2 + 40 * u - inset * 1.6, cy + h / 2 - inset * 0.4], [cx - w / 2 - 40 * u + inset * 1.6, cy + h / 2 - inset * 0.4]]), c, {stroke: inset ? false : undefined});
  return [quad(0, border), quad(22 * u, mixColor(cream, border, 0.4)), quad(32 * u, red),
    p.path(pts([[cx, cy - h * 0.32], [cx + w * 0.16, cy], [cx, cy + h * 0.32], [cx - w * 0.16, cy]]), border, {stroke: false}),
    p.path(pts([[cx, cy - h * 0.18], [cx + w * 0.08, cy], [cx, cy + h * 0.18], [cx - w * 0.08, cy]]), mixColor(cream, red, 0.5), {stroke: false})];
}

const parlour = {
  group: 'inside', label: 'Parlour',
  describe: 'a period parlour: damask wallpaper over panelling, a tall draped window, a fireplace with a gilt mirror and candles, a wingback armchair, a fringed lamp and a Persian rug; the fire glows at dusk and night',
  light: {night: {dir: {x: 0.62, y: 0.78}, color: '#ffc27a', intensity: 0.5}},
  geo(k) {
    const g = parlourGeo(k);
    g.quiet.under = [paper(k), mixColor('#ffffff', paper(k), 0.14), mixColor('#000000', paper(k), 0.1)];
    return g;
  },
  back(k, g) {
    const {W, H, u, p, pal} = k;
    const {x0, w} = span(k);
    const out = [wall(k, g.floorY, {color: paper(k), dado: true, panel: true})];
    const dadoY = g.floorY - Math.min(260 * u, H * 0.18);
    out.push(wallpaper(k, H * 0.2, dadoY - 8 * u));
    // Picture rail and cornice.
    out.push(p.rect(x0, H * 0.19, w, 10 * u, gilt(k), {stroke: false}), p.rect(x0, -2, w, H * 0.05, mixColor('#000000', paper(k), 0.3), {}), p.rect(x0, H * 0.05, w, 8 * u, gilt(k), {stroke: false}));
    // The tall window and its heavy drapes, with a pelmet.
    const {x, y, w: ww, h} = g.win;
    out.push(interiorWindow(k, x, y, ww, h, {view: 'trees', cols: 2, rows: 3, frame: pal.cream}));
    const drape = pal.g('#5c1f24');
    out.push(curtains(k, x, y, ww, h, {color: drape}));
    out.push(p.rect(x - 70 * u, y - 60 * u, ww + 140 * u, 46 * u, drape, {}));
    for (let i = 0; i < 6; i++) out.push(p.path(`M${f(x - 70 * u + i * (ww + 140 * u) / 6)} ${f(y - 14 * u)}q${f((ww + 140 * u) / 12)} ${f(26 * u)} ${f((ww + 140 * u) / 6)} 0Z`, drape, {}));
    out.push(p.rect(x - 70 * u, y - 60 * u, ww + 140 * u, 6 * u, gilt(k), {stroke: false}));
    // Portraits on the wallpaper.
    const portraits = k.portrait ? [[0.82, 0.3, 0.09]] : [[0.3, 0.42, 0.045], [0.93, 0.36, 0.04]];
    for (const [px, py, r] of portraits) {
      out.push(giltFrame(k, W * px, H * py, W * r, W * r * 1.3, {inner: pal.g('#4a5546')}));
      out.push(sitter(k, W * px, H * py + W * r * 0.2, W * r * 0.9));
    }
    // The fireplace: marble surround, mantel shelf, the grate and a mirror above.
    const {x: fx, w: fw} = g.fire;
    const mantelY = g.anchors.surface.y;
    const marble = pal.g('#e6dccb');
    const mirrorTop = mantelY - fw * 0.95;
    out.push(giltFrame(k, fx + fw / 2, mirrorTop + fw * 0.42, fw * 0.36, fw * 0.42, {oval: false, inner: mixColor(pal.view, paper(k), 0.25)}));
    out.push(p.path(pts([[fx + fw * 0.2, mirrorTop + fw * 0.8], [fx + fw * 0.45, mirrorTop + fw * 0.08], [fx + fw * 0.55, mirrorTop + fw * 0.08], [fx + fw * 0.3, mirrorTop + fw * 0.8]]), '#ffffff', {opacity: 0.12, stroke: false}));
    out.push(p.rect(fx, mantelY + 14 * u, fw, g.floorY - mantelY - 14 * u, marble, {}));
    out.push(p.rect(fx - 24 * u, mantelY, fw + 48 * u, 22 * u, mixColor('#ffffff', marble, 0.3), {rx: 4 * u}));
    const bx = fx + fw * 0.2, bw = fw * 0.6, by = mantelY + (g.floorY - mantelY) * 0.3;
    out.push(p.path(`M${f(bx)} ${f(g.floorY)}V${f(by + bw * 0.3)}Q${f(bx + bw / 2)} ${f(by - bw * 0.12)} ${f(bx + bw)} ${f(by + bw * 0.3)}V${f(g.floorY)}Z`, '#1a1210', {}));
    out.push(fire(k, bx + bw / 2, g.floorY - 16 * u, bw * 0.5));
    out.push(p.rect(fx - 40 * u, g.floorY - 10 * u, fw + 80 * u, 14 * u, mixColor('#000000', marble, 0.3), {}));
    // On the mantel: candlesticks and a clock.
    const s = g.anchors.surface.ppm;
    out.push(PROPS.candle.draw(k, fx + fw * 0.12, mantelY, s * 1.4, 'surface'), PROPS.candle.draw(k, fx + fw * 0.88, mantelY, s * 1.4, 'surface'));
    const cx = fx + fw / 2, cr = fw * 0.08;
    out.push(p.rect(cx - cr * 1.3, mantelY - cr * 2.2, cr * 2.6, cr * 2.2, pal.woodShade, {rx: cr}), p.circle(cx, mantelY - cr * 1.25, cr * 0.75, pal.cream, {}), p.line(cx, mantelY - cr * 1.25, cx, mantelY - cr * 1.8, pal.ink, 2), p.line(cx, mantelY - cr * 1.25, cx + cr * 0.4, mantelY - cr * 1.15, pal.ink, 2));
    return out;
  },
  mid(k, g) {
    const {W, u, p, pal, time} = k;
    const out = [floor(k, g.floorY, {kind: 'wood', color: pal.woodShade})];
    out.push(persianRug(k, W * 0.5, g.groundY + 34 * u, W * (k.portrait ? 0.84 : 0.56), 120 * u));
    const s = k.ppm * 0.86;
    out.push(armchair(k, W * (k.portrait ? 0.16 : 0.2), g.floorY + 8 * u, s, pal.g('#3f5a4c')));
    // A side table and a fringed lamp between the chair and the fire.
    const tx = W * (k.portrait ? 0.5 : 0.56);
    const ty = g.floorY - s * 0.62;
    out.push(p.shadow(tx, g.floorY + 6 * u, 60 * u, 12 * u), p.rect(tx - 4 * u, ty, 8 * u, g.floorY - ty, pal.woodShade, {}), p.ellipse(tx, ty, 60 * u, 12 * u, pal.wood, {}), p.path(`M${f(tx - 50 * u)} ${f(g.floorY)}L${f(tx)} ${f(g.floorY - 30 * u)}L${f(tx + 50 * u)} ${f(g.floorY)}`, null, {stroke: pal.woodShade, sw: 2}));
    const on = time !== 'day';
    const shadeC = on ? '#ffcf8a' : pal.g('#c9a46a');
    const ly = ty - s * 0.42;
    if (on) out.push(p.ellipse(tx, ly + 20 * u, 220 * u, 200 * u, p.rad([[0, '#ffc27a', time === 'night' ? 0.45 : 0.25], [1, '#ffc27a', 0]], tx, ly + 20 * u, 220 * u, {force: true, glow: true}), {glow: true, blend: 'screen'}));
    out.push(p.rect(tx - 3 * u, ly + 30 * u, 6 * u, ty - ly - 30 * u, gilt(k), {}), p.ellipse(tx, ty - 6 * u, 26 * u, 8 * u, gilt(k), {}));
    out.push(p.path(pts([[tx - 30 * u, ly], [tx + 30 * u, ly], [tx + 54 * u, ly + 46 * u], [tx - 54 * u, ly + 46 * u]]), shadeC, {glow: on}));
    for (let i = 0; i <= 10; i++) out.push(p.line(tx - 54 * u + i * 10.8 * u, ly + 46 * u, tx - 54 * u + i * 10.8 * u, ly + 58 * u, gilt(k), 2));
    // Firelight on the floor in front of the hearth.
    if (on) out.push(p.ellipse(g.fire.x + g.fire.w / 2, g.floorY + 50 * u, g.fire.w * 1.1, 60 * u, p.rad([[0, '#ff9a40', time === 'night' ? 0.42 : 0.24], [1, '#ff9a40', 0]], g.fire.x + g.fire.w / 2, g.floorY + 50 * u, g.fire.w * 1.1, {force: true, glow: true}), {glow: true, blend: 'screen'}));
    return out;
  },
  fx(k, g) {
    const {p, time} = k;
    if (time === 'day') return [];
    // The fire lights the wall round the hearth.
    const cx = g.fire.x + g.fire.w / 2;
    return [p.ellipse(cx, g.floorY - 40, g.fire.w * 1.6, g.fire.w * 1.2, p.rad([[0, '#ff9a40', time === 'night' ? 0.3 : 0.16], [1, '#ff9a40', 0]], cx, g.floorY - 40, g.fire.w * 1.6, {force: true, glow: true}), {glow: true, blend: 'screen'})];
  }
};

// ---------------------------------------------------------------------------
// Café terrace

// The terrace is seen closer than a street: people stand a little larger.
const TERRACE_SCALE = 0.74;

function terraceGeo(k) {
  const {W, H, portrait} = k;
  const ppm = k.ppm * TERRACE_SCALE;
  const baseY = Math.round(H * (portrait ? 0.66 : 0.62));
  const groundY = Math.round(H * (portrait ? 0.8 : 0.84));
  return {
    baseY, groundY, ppm,
    anchors: {
      ground: {y: groundY, x0: W * 0.04, x1: W * 0.96, ppm},
      floor: {y: Math.round(baseY + (groundY - baseY) * 0.3), x0: W * 0.04, x1: W * 0.96, ppm: ppm * 0.85, layer: 'mid'},
      wall: {y: Math.round(baseY - 0.9 * ppm), x0: W * 0.06, x1: W * 0.94, ppm: ppm * 0.9, layer: 'mid'}
    },
    quiet: portrait
      ? {x: Math.round(W * 0.06), y: Math.round(H * 0.03), width: Math.round(W * 0.88), height: Math.round(H * 0.12)}
      : {x: Math.round(W * 0.06), y: Math.round(H * 0.04), width: Math.round(W * 0.4), height: Math.round(H * 0.16)}
  };
}

const stone = k => k.pal.g('#e2d3b6');
const ochre = k => k.pal.g('#d9a85f');
const caféGreen = k => k.pal.g('#2f5a4a');
const awningRed = k => k.pal.g('#b0343c');

/** A tall window with shutters (and a wrought-iron balcony when asked). */
function frenchWindow(k, x, y, w, h, {balcony = false, lit = false, wallC}) {
  const {p, u, pal, time} = k;
  const glass = lit ? pal.lit : time === 'day' ? mixColor(pal.skyLow, '#3a4a5c', 0.5) : mixColor('#000000', wallC, 0.55);
  const shutter = pal.g('#5d7f86');
  const out = [p.rect(x - 4 * u, y - 10 * u, w + 8 * u, 10 * u, mixColor('#ffffff', wallC, 0.3), {stroke: false})];
  out.push(p.rect(x - w * 0.42, y, w * 0.4, h, shutter, {}), p.rect(x + w * 1.02, y, w * 0.4, h, shutter, {}));
  for (let i = 1; i < 6; i++) for (const sx of [x - w * 0.42, x + w * 1.02]) out.push(p.line(sx + 4 * u, y + h * i / 6, sx + w * 0.4 - 4 * u, y + h * i / 6, mixColor('#000000', shutter, 0.25), 1.6));
  out.push(p.rect(x, y, w, h, glass, {glow: lit}));
  out.push(p.line(x + w / 2, y, x + w / 2, y + h, mixColor('#ffffff', wallC, 0.4), 3), p.line(x, y + h * 0.4, x + w, y + h * 0.4, mixColor('#ffffff', wallC, 0.4), 3));
  if (lit && k.d.gradients) out.push(p.glow(x + w / 2, y + h / 2, w * 1.4, pal.lampWarm, 0.22));
  if (balcony) {
    const by = y + h * 0.66, iron = mixColor('#000000', pal.ink, 0.1);
    out.push(p.rect(x - w * 0.5, y + h - 2 * u, w * 2, 10 * u, mixColor('#000000', wallC, 0.25), {}));
    out.push(p.line(x - w * 0.46, by, x + w * 1.46, by, iron, 3));
    for (let i = 0; i <= 12; i++) out.push(p.line(x - w * 0.46 + i * w * 1.92 / 12, by, x - w * 0.46 + i * w * 1.92 / 12, y + h, iron, 1.6));
  } else {
    out.push(p.rect(x - 8 * u, y + h, w + 16 * u, 10 * u, mixColor('#ffffff', wallC, 0.3), {}));
    out.push(p.rect(x, y + h + 10 * u, w, 22 * u, pal.g('#7b4a34'), {stroke: false}));
    for (let i = 0; i < 5; i++) out.push(p.circle(x + w * (0.1 + i * 0.2), y + h + 6 * u, 9 * u, i % 2 ? pal.g('#d8505a') : pal.foliage, {stroke: false}));
  }
  return out;
}

/** A stone townhouse: floors of french windows, a cornice and a mansard roof with dormers. */
function townhouse(k, x, w, baseY, h, {color, floors = 3, balconies = [1], lit = 0}) {
  const {p, u, pal} = k;
  const top = baseY - h;
  const roof = pal.g('#5e6f80');
  const out = [p.rect(x, top, w, h + 2, color, {})];
  // Mansard roof and dormers.
  const rh = h * 0.16;
  out.push(p.path(pts([[x - 6 * u, top], [x + w + 6 * u, top], [x + w - 20 * u, top - rh], [x + 20 * u, top - rh]]), roof, {}));
  for (let i = 0; i < Math.max(1, Math.round(w / (160 * u))); i++) {
    const dx = x + (i + 0.5) * w / Math.max(1, Math.round(w / (160 * u))) - 22 * u;
    out.push(p.rect(dx, top - rh * 0.8, 44 * u, rh * 0.62, mixColor('#ffffff', roof, 0.2), {}), p.rect(dx + 8 * u, top - rh * 0.68, 28 * u, rh * 0.42, k.time === 'night' && p.rnd() < lit ? pal.lit : mixColor('#000000', roof, 0.3), {stroke: false, glow: k.time === 'night'}));
  }
  out.push(p.rect(x - 8 * u, top - 4 * u, w + 16 * u, 14 * u, mixColor('#ffffff', color, 0.35), {}));
  out.push(p.shade(x, top, w, h, 'right', 0.16));
  const cols = Math.max(1, Math.round(w / (170 * u)));
  const fh = (h - 30 * u) / floors;
  for (let r = 0; r < floors; r++) {
    out.push(p.rect(x, top + 20 * u + r * fh + fh - 6 * u, w, 5 * u, mixColor('#000000', color, 0.08), {stroke: false}));
    for (let c = 0; c < cols; c++) {
      const ww = Math.min(60 * u, w / cols * 0.36), wh = fh * 0.62;
      const wx = x + (c + 0.5) * w / cols - ww / 2, wy = top + 20 * u + r * fh + fh * 0.16;
      const on = k.time !== 'day' && p.rnd() < lit;
      out.push(frenchWindow(k, wx, wy, ww, wh, {balcony: balconies.includes(r), lit: on, wallC: color}));
    }
  }
  return out;
}

/** The café front: dark green woodwork, big paned windows lit warm, a striped awning, a blank sign. */
function cafeFront(k, x, w, baseY, h) {
  const {p, u, pal, time} = k;
  const green = caféGreen(k), red = awningRed(k), cream = pal.cream;
  const lit = time !== 'day';
  const inside = lit ? '#ffd79a' : mixColor(pal.skyLow, '#4b5a52', 0.55);
  const out = [p.rect(x, baseY - h, w, h, green, {})];
  // Windows either side of the door, with café curtains and warm light.
  const door = w * 0.16, panes = [[x + w * 0.04, (w - door) / 2 - w * 0.06], [x + (w + door) / 2 + w * 0.02, (w - door) / 2 - w * 0.06]];
  for (const [wx, ww] of panes) {
    const wy = baseY - h * 0.82, wh = h * 0.7;
    out.push(p.rect(wx, wy, ww, wh, inside, {glow: lit}));
    if (lit && k.d.gradients) out.push(p.glow(wx + ww / 2, wy + wh * 0.6, ww * 0.9, '#ffbf6a', 0.35));
    // Silhouettes of tables and lamps inside.
    for (let i = 0; i < 3; i++) {
      const tx = wx + ww * (0.2 + i * 0.3);
      out.push(p.circle(tx, wy + wh * 0.25, 10 * u, lit ? '#fff1c8' : mixColor('#000000', inside, 0.2), {glow: lit, stroke: false}));
      out.push(p.rect(tx - 26 * u, wy + wh * 0.72, 52 * u, 6 * u, mixColor('#000000', inside, 0.45), {stroke: false}));
    }
    out.push(p.rect(wx, wy + wh * 0.55, ww, wh * 0.45, mixColor('#ffffff', cream, 0.2), {opacity: 0.85, stroke: false}));
    for (let i = 1; i < 4; i++) out.push(p.line(wx + ww * i / 4, wy, wx + ww * i / 4, wy + wh, green, 5));
    out.push(p.line(wx, wy + wh * 0.55, wx + ww, wy + wh * 0.55, green, 5));
    out.push(p.rect(wx, wy, ww, wh, 'none', {stroke: mixColor('#000000', green, 0.3), sw: 2}));
  }
  const dx = x + (w - door) / 2;
  out.push(p.rect(dx, baseY - h * 0.86, door, h * 0.86, mixColor('#000000', green, 0.25), {}), p.rect(dx + door * 0.15, baseY - h * 0.8, door * 0.7, h * 0.45, inside, {glow: lit}));
  // Pilasters and a gold line.
  for (const px of [x, x + w - 16 * u, dx - 14 * u, dx + door]) out.push(p.rect(px, baseY - h, 16 * u, h, mixColor('#000000', green, 0.18), {stroke: false}));
  out.push(p.rect(x, baseY - h * 0.97, w, 4 * u, pal.g('#c9a24a'), {stroke: false}));
  // The awning: stripes in red and cream, a scalloped valance.
  const ay = baseY - h - 4 * u, ah = h * 0.3, n = Math.max(6, Math.round(w / (50 * u)));
  const sw = (w + 60 * u) / n;
  for (let i = 0; i < n; i++) {
    const sx = x - 30 * u + i * sw;
    const c = i % 2 ? red : mixColor('#ffffff', cream, 0.3);
    out.push(p.path(pts([[sx + 6 * u, ay], [sx + sw + 6 * u, ay], [sx + sw, ay + ah], [sx, ay + ah]]), c, {stroke: false}));
    out.push(p.path(`M${f(sx)} ${f(ay + ah)}Q${f(sx + sw / 2)} ${f(ay + ah + 22 * u)} ${f(sx + sw)} ${f(ay + ah)}Z`, c, {}));
  }
  out.push(p.rect(x - 30 * u, ay + ah, w + 60 * u, 14 * u, '#000000', {opacity: 0.14, stroke: false}));
  // The fascia sign above (left blank for a caption) and string lights at dusk and night.
  out.push(p.rect(x + w * 0.2, ay - 70 * u, w * 0.6, 58 * u, green, {rx: 4 * u}), p.rect(x + w * 0.22, ay - 64 * u, w * 0.56, 46 * u, 'none', {stroke: pal.g('#c9a24a'), sw: 2}));
  if (lit) for (let i = 0; i <= 14; i++) {
    const bx = x - 20 * u + i * (w + 40 * u) / 14, by = ay + ah + 26 * u + Math.sin(i * Math.PI / 3.5) * 10 * u;
    out.push(p.circle(bx, by, 5 * u, '#fff0c0', G));
    if (k.d.gradients) out.push(p.glow(bx, by, 30 * u, '#ffcf7a', 0.45));
  }
  return out;
}

/** A bistro table with two chairs, standing on y (the floor line), s px per metre. */
function bistro(k, cx, y, s) {
  const {p, u, pal} = k;
  const iron = mixColor('#000000', pal.g('#3d5a5e'), 0.1);
  const top = pal.g('#c9d9d0');
  const out = [p.shadow(cx, y + 4 * u, s * 0.55, 12 * u)];
  for (const dir of [-1, 1]) {
    const chx = cx + dir * s * 0.5;
    out.push(p.line(chx, y, chx, y - s * 0.45, iron, 3), p.line(chx + dir * s * 0.18, y, chx + dir * s * 0.18, y - s * 0.9, iron, 3), p.line(chx - dir * s * 0.02, y - s * 0.45, chx + dir * s * 0.2, y - s * 0.45, iron, 4));
    out.push(p.path(`M${f(chx + dir * s * 0.18)} ${f(y - s * 0.9)}Q${f(chx + dir * s * 0.1)} ${f(y - s * 0.66)} ${f(chx + dir * s * 0.18)} ${f(y - s * 0.5)}`, null, {stroke: iron, sw: 1.4}));
  }
  out.push(p.line(cx, y, cx, y - s * 0.72, iron, 5), p.path(`M${f(cx - s * 0.16)} ${f(y)}L${f(cx)} ${f(y - s * 0.1)}L${f(cx + s * 0.16)} ${f(y)}`, null, {stroke: iron, sw: 2}));
  out.push(p.ellipse(cx, y - s * 0.74, s * 0.34, s * 0.07, top, {}), p.rect(cx - s * 0.34, y - s * 0.74, s * 0.68, s * 0.03, mixColor('#000000', top, 0.2), {stroke: false}));
  out.push(PROPS['coffee-cup'].draw(k, cx - s * 0.12, y - s * 0.75, s, 'surface'));
  return out;
}

/** Cobbles from y0 down to the bottom, in rows that grow toward the camera. */
function cobbles(k, y0) {
  const {p, u, H, d} = k;
  const {x0, x1, w} = span(k);
  const base = stone(k), dark = mixColor('#000000', base, 0.18), light = mixColor('#ffffff', base, 0.2);
  const out = [p.rect(x0, y0, w, H - y0 + 2, p.lin([[0, mixColor('#000000', base, 0.1)], [1, base]], 0, y0, 0, H), {stroke: false})];
  let y = y0 + 4 * u, size = 14 * u, row = 0;
  while (y < H) {
    const sw = size * 2.1;
    for (let x = x0 + (row % 2 ? sw / 2 : 0); x < x1; x += sw) {
      if (p.rnd() < 0.55) out.push(p.rect(x + 2 * u, y, sw - 4 * u, size * 0.8, p.rnd() < 0.6 ? dark : light, {rx: size * 0.4, stroke: false, opacity: d.n >= 1 ? 0.28 : 0.22}));
    }
    y += size; size *= 1.12; row++;
  }
  return out;
}

const cafeTerrace = {
  group: 'street', label: 'Café terrace',
  describe: 'a European café terrace: stone townhouses with shutters and iron balconies, a green café front with a striped awning and lit windows, bistro tables on cobbles, a far square and a clock tower; string lights at dusk and night',
  geo(k) {
    const g = terraceGeo(k);
    g.quiet.under = [k.pal.skyTop, k.pal.skyMid, k.pal.skyLow];
    return g;
  },
  back(k, g) {
    const {W, H, u, p, pal} = k;
    const out = [sky(k, g.baseY - 80 * u, {})];
    // The far side of the square: low pale townhouses and a clock tower, in haze.
    const farC = mixColor(pal.skyLow, pal.g('#d8c6a4'), 0.4);
    const farY = g.baseY - 20 * u;
    // The tower stands in the gap between the townhouse and the café (landscape), or above the roofs.
    const tx = W * (k.portrait ? 0.3 : 0.42), tw = 70 * u, th = H * (k.portrait ? 0.4 : 0.36);
    out.push(p.rect(tx - tw / 2, farY - th, tw, th, mixColor('#000000', farC, 0.06), {}), p.path(pts([[tx - tw * 0.62, farY - th], [tx + tw * 0.62, farY - th], [tx, farY - th - 90 * u]]), mixColor(pal.skyLow, pal.g('#5e6f80'), 0.5), {}),
      p.circle(tx, farY - th + 40 * u, 20 * u, mixColor('#ffffff', farC, 0.4), {}));
    out.push(p.line(tx, farY - th - 90 * u, tx, farY - th - 120 * u, farC, 2));
    let x = span(k).x0;
    for (let i = 0; x < span(k).x1; i++) {
      const w = (120 + (i * 37) % 80) * u, h = H * 0.12 + ((i * 53) % 5) * 14 * u;
      out.push(p.rect(x, farY - h, w, h + 4, farC, {}), p.path(pts([[x, farY - h], [x + w, farY - h], [x + w - 12 * u, farY - h - 26 * u], [x + 12 * u, farY - h - 26 * u]]), mixColor(pal.skyLow, pal.g('#6d7c8c'), 0.45), {}));
      for (let c = 0; c < Math.floor(w / (34 * u)); c++) out.push(p.rect(x + 12 * u + c * 34 * u, farY - h + 16 * u, 12 * u, 20 * u, k.time === 'night' && p.rnd() < 0.5 ? pal.lit : mixColor('#000000', farC, 0.2), {stroke: false, glow: k.time === 'night'}));
      x += w + 6 * u;
    }
    for (const fx of [0.08, 0.44, 0.92]) out.push(tree(k, W * fx, farY, H * 0.2, {kind: 'round', tone: 1}));
    out.push(haze(k, farY - H * 0.3, farY, {alpha: 1}));
    return out;
  },
  mid(k, g) {
    const {W, H, u, p} = k;
    const out = [];
    const {x0, x1} = span(k);
    // Facades: townhouses either side, the café in the right half.
    const cafeX = W * (k.portrait ? 0.38 : 0.52), cafeW = W * (k.portrait ? 0.62 : 0.4) + x1 - W;
    const groundH = H * (k.portrait ? 0.14 : 0.2);
    out.push(townhouse(k, x0, cafeX - x0 - W * (k.portrait ? 0.02 : 0.2), g.baseY, H * (k.portrait ? 0.34 : 0.4), {color: stone(k), floors: 3, balconies: [0], lit: 0.6}));
    out.push(townhouse(k, cafeX, cafeW, g.baseY - groundH, H * (k.portrait ? 0.3 : 0.44) - groundH, {color: ochre(k), floors: 2, balconies: [1], lit: 0.5}));
    out.push(cafeFront(k, cafeX, x1 - cafeX, g.baseY, groundH));
    // The gap between the houses: a lane running back to the square.
    if (!k.portrait) {
      const gx = cafeX - W * 0.2, gw = W * 0.2;
      out.push(p.rect(gx, g.baseY - H * 0.06, gw, H * 0.06, stone(k), {stroke: false}));
    }
    out.push(cobbles(k, g.baseY));
    out.push(p.rect(x0, g.baseY - 2 * u, x1 - x0, 10 * u, mixColor('#000000', stone(k), 0.25), {stroke: false, opacity: 0.6}));
    // Terrace: bistro tables either side of the cast, a lamp post and planters.
    const s = g.ppm;
    const tables = k.portrait ? [[0.14, 0.04], [0.86, 0.02]] : [[0.12, 0.03], [0.82, 0.02], [0.96, 0.05]];
    for (const [fx, dy] of tables) out.push(bistro(k, W * fx, g.groundY - H * dy, s));
    out.push(lampPost(k, W * (k.portrait ? 0.3 : 0.32), g.baseY + 30 * u, H * 0.42));
    for (const fx of k.portrait ? [0.62] : [0.68]) out.push(PROPS.flowers.draw(k, W * fx, g.baseY + 20 * u, s * 1.6, 'ground'));
    return out;
  },
  front(k) {
    const {W, H, u, p, pal} = k;
    // A café chair back at the bottom corner, close to the camera.
    const iron = mixColor('#000000', pal.g('#3d5a5e'), 0.3);
    const cx = W * 0.93;
    return [p.line(cx - 60 * u, H + 10, cx - 50 * u, H - 230 * u, iron, 9), p.line(cx + 70 * u, H + 10, cx + 60 * u, H - 230 * u, iron, 9),
      p.path(`M${f(cx - 50 * u)} ${f(H - 230 * u)}Q${f(cx + 5 * u)} ${f(H - 270 * u)} ${f(cx + 60 * u)} ${f(H - 230 * u)}`, null, {stroke: iron, sw: 4}),
      p.line(cx - 52 * u, H - 150 * u, cx + 62 * u, H - 150 * u, iron, 6)];
  }
};

export const PERIOD = {parlour, 'cafe-terrace': cafeTerrace};

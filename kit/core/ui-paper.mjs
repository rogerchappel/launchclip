// The ui-scene paper kinds: a diorama of printed paper in real 3D. Cut-outs drawn
// from shapes, with a die-cut edge, halftone and engraving; a limb that grows from
// behind things and fills with colour; panels that fold like a map or open like a
// pop-up book; torn strips, tape and leader-line labels.
// Same rules as ui-paint.mjs: plain function declarations that call only each other
// and the helpers, listed in uiPaperTable. Everything is a pure function of t.
// Contract: docs/KIT_CONTRACTS.md, "UI scenes".

import {uiClamp, uiP, uiLerp, uiInOut, uiOutBack, uiHash, uiEsc, uiN, uiTone, uiTyped, uiRigAt, uiRigProject} from './ui-paint.mjs';

/** Kind → draw function for the paper kinds. */
function uiPaperTable() {
  return {cutout: uiCutout, limb: uiLimb, 'paper-fold': uiPaperFold, 'paper-sheet': uiPaperSheet, 'torn-strip': uiTornStrip, tape: uiTape, 'callout-pin': uiCalloutPin};
}

/** Paper and ink as the theme gives them: paper is its light colour, ink its ground. */
function uiPaperColour(c, name, fallback) {
  const value = name || fallback;
  if (value === 'none') return 'none';
  if (value === 'paper') return c.ink;
  if (value === 'ink') return c.bg;
  if (value === 'mid') return c.soft;
  return uiTone(c, value, 'accent');
}

/** The defs a paper piece needs: a die-cut edge with a shadow and paper tooth, and tooth alone. */
function uiPaperDefs(id, c, edge) {
  const e = edge === undefined ? 8 : edge;
  const tooth = '<feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 .1 0 0 0 0 .09 0 0 0 0 .06 0 0 0 .45 -.16" result="tooth"/>';
  return '<defs><filter id="' + id + '" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">'
    + '<feMorphology in="SourceAlpha" operator="dilate" radius="' + e + '" result="fat"/><feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="2" seed="4" result="wob"/><feDisplacementMap in="fat" in2="wob" scale="' + uiN(e * 0.8) + '" result="edge"/>'
    + '<feFlood flood-color="' + c.ink + '"/><feComposite in2="edge" operator="in" result="white"/><feOffset in="edge" dx="8" dy="14"/><feGaussianBlur stdDeviation="8" result="soft"/><feFlood flood-color="#000" flood-opacity=".58"/><feComposite in2="soft" operator="in" result="shadow"/>'
    + tooth + '<feComposite in="tooth" in2="edge" operator="in" result="grain"/><feMerge><feMergeNode in="shadow"/><feMergeNode in="white"/><feMergeNode in="SourceGraphic"/><feMergeNode in="grain"/></feMerge></filter>'
    + '<filter id="' + id + 't" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">' + tooth + '<feComposite in="tooth" in2="SourceAlpha" operator="in" result="grain"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="grain"/></feMerge></filter></defs>';
}

/** Halftone dots or engraved lines growing along an axis, clipped to a shape's markup. Drawn once per shade. */
function uiPaperShade(x, y, w, h, shade, colour, clip) {
  const cache = uiPaperShade.cache || (uiPaperShade.cache = {});
  const key = [x, y, w, h, JSON.stringify(shade), colour, clip].join('|');
  if (cache[key]) return cache[key];
  const step = shade.step || (shade.kind === 'lines' ? 9 : 10), from = shade.from === undefined ? 0.1 : shade.from, to = shade.to === undefined ? 0.9 : shade.to;
  const along = function (px, py) { const u = shade.dir === 'y' ? (py - y) / h : (px - x) / w; return from + (to - from) * uiClamp(u); };
  let marks = '';
  if (shade.kind === 'lines') {
    const vertical = shade.dir !== 'y', n = (vertical ? w : h) / step;
    for (let i = 0; i <= n; i++) {
      const weight = uiN(0.6 + 6 * along(x + (vertical ? i * step : 0), y + (vertical ? 0 : i * step)));
      marks += vertical
        ? '<line x1="' + uiN(x + i * step) + '" y1="' + uiN(y) + '" x2="' + uiN(x + i * step) + '" y2="' + uiN(y + h) + '" stroke-width="' + weight + '"/>'
        : '<line x1="' + uiN(x) + '" y1="' + uiN(y + i * step) + '" x2="' + uiN(x + w) + '" y2="' + uiN(y + i * step) + '" stroke-width="' + weight + '"/>';
    }
    marks = '<g stroke="' + colour + '">' + marks + '</g>';
  } else {
    const a = 28 * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a), reach = Math.ceil(Math.max(w, h) * 1.5 / step), cx = x + w / 2, cy = y + h / 2;
    for (let i = -reach; i < reach; i++) {
      for (let j = -reach; j < reach; j++) {
        const px = cx + (i * cos - j * sin) * step, py = cy + (i * sin + j * cos) * step;
        if (px < x - step || px > x + w + step || py < y - step || py > y + h + step) continue;
        const r = along(px, py) * step * 0.62;
        if (r > 0.4) marks += '<circle cx="' + uiN(px) + '" cy="' + uiN(py) + '" r="' + uiN(r) + '"/>';
      }
    }
    marks = '<g fill="' + colour + '">' + marks + '</g>';
  }
  const id = 'lcs' + Math.round(uiHash(key.length * 7 + x * 3 + y * 5 + w) * 1e9);
  const out = '<clipPath id="' + id + '">' + clip + '</clipPath><g clip-path="url(#' + id + ')">' + marks + '</g>';
  cache[key] = out;
  return out;
}

/** One cut-out part as SVG: its shape in its fill and stroke, with its shading on top. */
function uiPaperPart(part, c, fonts) {
  const fill = uiPaperColour(c, part.fill, 'paper'), stroke = uiPaperColour(c, part.stroke, 'ink');
  const line = part.stroke === 'none' ? 'stroke="none"' : 'stroke="' + stroke + '" stroke-width="' + uiN(part.weight === undefined ? 6 : part.weight) + '" stroke-linejoin="round" stroke-linecap="round"';
  const n = uiN;
  let geo = '', box = null;
  if (part.shape === 'rect') {
    geo = 'rect x="' + n(part.x) + '" y="' + n(part.y) + '" width="' + n(part.width) + '" height="' + n(part.height) + '" rx="' + n(part.r || 0) + '"';
    box = [part.x, part.y, part.width, part.height];
  } else if (part.shape === 'circle') {
    geo = 'circle cx="' + n(part.x) + '" cy="' + n(part.y) + '" r="' + n(part.r) + '"';
    box = [part.x - part.r, part.y - part.r, part.r * 2, part.r * 2];
  } else if (part.shape === 'ellipse') {
    geo = 'ellipse cx="' + n(part.x) + '" cy="' + n(part.y) + '" rx="' + n(part.rx) + '" ry="' + n(part.ry) + '"';
    box = [part.x - part.rx, part.y - part.ry, part.rx * 2, part.ry * 2];
  } else if (part.shape === 'path') {
    geo = 'path d="' + uiEsc(part.d) + '"';
    box = part.box || null;
  } else if (part.shape === 'text') {
    const family = part.font === 'mono' ? fonts.mono : part.font === 'serif' ? 'Georgia,serif' : fonts.display;
    return '<text x="' + n(part.x) + '" y="' + n(part.y) + '" text-anchor="' + (part.anchor || 'middle') + '" font-family="' + family + '" font-weight="' + (part.bold === false ? 500 : 800) + '" font-size="' + n(part.size) + '" letter-spacing="' + n(part.spacing || 0) + '" fill="' + uiPaperColour(c, part.fill, 'ink') + '">' + uiEsc(part.text) + '</text>';
  }
  if (!geo) return '';
  const shape = '<' + geo + ' fill="' + fill + '" ' + line + '/>';
  if (!part.shade || !box) return shape;
  return shape + uiPaperShade(box[0], box[1], box[2], box[3], part.shade, uiPaperColour(c, part.shade.tone, 'ink'), '<' + geo + '/>') + (part.stroke === 'none' ? '' : '<' + geo + ' fill="none" ' + line + '/>');
}

/**
 * cutout: an object drawn from shapes on a sheet of paper. {view [w, h], parts
 * [{shape rect|circle|ellipse|path|text, position fields, fill paper|ink|mid|
 * accent|alert|none|#hex, stroke, weight, shade {kind dots|lines, from, to, dir
 * x|y, step, tone}, at (s, a part pops on when its word is said)}], edge (px of
 * white die-cut, 8; 0 for none)}. Parts draw in order within view, fitted to the rect.
 */
function uiCutout(el, t, ctx) {
  const p = el.props, c = ctx.c, view = p.view || [el.rect.width, el.rect.height], edge = p.edge === undefined ? 8 : p.edge;
  const inset = edge ? edge * 2.2 : 0;
  const scale = Math.min((el.rect.width - inset * 2) / view[0], (el.rect.height - inset * 2) / view[1]);
  const id = 'lcc' + Math.round(uiHash(el.rect.x * 3 + el.rect.y * 7 + el.rect.width + el.at * 11) * 1e9);
  let art = '';
  const parts = p.parts || [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.at !== undefined && t < part.at) continue;
    const drawn = uiPaperPart(part, c, ctx.fonts);
    if (part.at === undefined || t >= part.at + 0.24) { art += drawn; continue; }
    const s = Math.max(0.01, uiOutBack(uiP(t, part.at, 0.24), 1.7));
    const cx = part.x === undefined ? view[0] / 2 : part.shape === 'rect' ? part.x + part.width / 2 : part.x, cy = part.y === undefined ? view[1] / 2 : part.shape === 'rect' ? part.y + part.height / 2 : part.y;
    art += '<g transform="translate(' + uiN(cx) + ' ' + uiN(cy) + ') scale(' + s.toFixed(3) + ') translate(' + uiN(-cx) + ' ' + uiN(-cy) + ')">' + drawn + '</g>';
  }
  const ox = (el.rect.width - view[0] * scale) / 2, oy = (el.rect.height - view[1] * scale) / 2;
  return '<svg style="position:absolute;left:0;top:0;overflow:visible" width="' + uiN(el.rect.width) + '" height="' + uiN(el.rect.height) + '">' + uiPaperDefs(id, c, edge ? edge : 1)
    + '<g' + (edge ? ' filter="url(#' + id + ')"' : '') + '><g transform="translate(' + uiN(ox) + ' ' + uiN(oy) + ') scale(' + scale.toFixed(4) + ')">' + art + '</g></g></svg>';
}

/** A smooth curve through points (Catmull-Rom), n samples. */
function uiPaperCurve(pts, n) {
  const out = [], last = pts.length - 1;
  const at = function (i) { return pts[Math.min(last, Math.max(0, i))]; };
  for (let k = 0; k <= n; k++) {
    const f = (k / n) * last, i = Math.floor(Math.min(f, last - 0.0001)), u = f - i;
    const a = at(i - 1), b = at(i), d = at(i + 1), e = at(i + 2);
    const axis = function (m) { return 0.5 * (2 * b[m] + (d[m] - a[m]) * u + (2 * a[m] - 5 * b[m] + 4 * d[m] - e[m]) * u * u + (3 * b[m] - a[m] - 3 * d[m] + e[m]) * u * u * u); };
    out.push([axis(0), axis(1)]);
  }
  return out;
}

/**
 * limb: a tapered paper limb that grows from its first point, tip first, and fills
 * with colour along its length. Put it behind a cut-out so it comes out from behind,
 * or in front so it wraps across. {path [[x, y], ...] (px in the rect), width (44),
 * tone (alert), growAt (el.at), growDur (0.85), fillAt, fillDur (0.9), sway (px, 24),
 * suckers (true), side (1 or -1)}. Before fillAt it is a white outline on dark; no
 * fillAt fills it as it grows.
 */
function uiLimb(el, t, ctx) {
  const p = el.props, c = ctx.c, a0 = p.growAt === undefined ? el.at : p.growAt;
  const grow = Math.min(1, uiOutBack(uiP(t, a0, p.growDur || 0.85), 1.15));
  if (grow <= 0.001 || !p.path || p.path.length < 2) return '';
  const raw = uiPaperCurve(p.path, 90);
  const last = Math.min(raw.length - 1, Math.max(2, Math.floor(grow * (raw.length - 1))));
  const seed = uiHash(p.path[0][0] + p.path[0][1] * 3) * 6, sway = p.sway === undefined ? 24 : p.sway, line = [];
  for (let i = 0; i <= last; i++) {
    const u = i / (raw.length - 1);
    line.push([raw[i][0] + Math.sin(t * 2.1 + u * 5 + seed) * sway * u * u, raw[i][1] + Math.cos(t * 1.7 + u * 4 + seed * 2) * sway * 0.8 * u * u]);
  }
  const base = p.width || 44, side = p.side || 1;
  const normal = function (i) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1;
    return [-dy / m, dx / m];
  };
  const width = function (i) { return base * Math.pow(1 - i / (line.length - 0.5), 0.68) + 2.5; };
  const strip = function (from, to, a, b) {
    const left = [], right = [];
    for (let i = from; i <= to; i++) {
      const n = normal(i), w = width(i);
      left.push(uiN(line[i][0] + n[0] * w * a) + ',' + uiN(line[i][1] + n[1] * w * a));
      right.unshift(uiN(line[i][0] - n[0] * w * b) + ',' + uiN(line[i][1] - n[1] * w * b));
    }
    return 'M ' + left.join(' L ') + ' L ' + right.join(' L ') + ' Z';
  };
  const colour = uiPaperColour(c, p.tone, 'alert');
  const fillP = p.fillAt === undefined ? 1 : uiP(t, p.fillAt, p.fillDur || 0.9);
  const filled = Math.min(line.length - 1, Math.floor(fillP * (line.length - 1)));
  let s = '<path d="' + strip(0, line.length - 1, 1, 1) + '" fill="' + c.bg + '" stroke="' + c.ink + '" stroke-width="10" stroke-linejoin="round"/>';
  if (filled > 1) s += '<path d="' + strip(0, filled, 1, 1) + '" fill="' + colour + '"/><path d="' + strip(0, filled, -0.15, 1) + '" fill="#000" opacity=".26"/><path d="' + strip(0, filled, 1, -0.72) + '" fill="#fff" opacity=".12"/>';
  if (p.suckers !== false) {
    for (let i = 7; i < line.length - 3; i += 6) {
      const n = normal(i), w = width(i);
      if (w < 9) break;
      const x = line[i][0] - n[0] * w * 0.5 * side, y = line[i][1] - n[1] * w * 0.5 * side, r = w * 0.24, lit = i <= filled;
      s += '<circle cx="' + uiN(x) + '" cy="' + uiN(y) + '" r="' + uiN(r) + '" fill="' + (lit ? '#ffffff' : 'none') + '" fill-opacity=".62" stroke="' + (lit ? '#000' : c.ink) + '" stroke-opacity="' + (lit ? 0.35 : 1) + '" stroke-width="2.2"/>';
      if (lit) s += '<circle cx="' + uiN(x) + '" cy="' + uiN(y) + '" r="' + uiN(r * 0.42) + '" fill="' + colour + '"/>';
    }
  }
  return '<svg style="position:absolute;left:0;top:0;overflow:visible" width="' + uiN(el.rect.width) + '" height="' + uiN(el.rect.height) + '">' + s + '</svg>';
}

/**
 * paper-fold: panels hinged edge to edge that open like a folded map, in true 3D.
 * {panels [{title, value, bar (0–1)}], openAt (el.at), openDur (0.9), closeAt, angle
 * (zigzag left when open, deg, 26)}. Light falls on one face of each pair. The open
 * strip fills the rect's width.
 */
function uiPaperFold(el, t, ctx) {
  const p = el.props, c = ctx.c, panels = p.panels || [], n = panels.length;
  if (!n) return '';
  const open = uiOutBack(uiP(t, p.openAt === undefined ? el.at : p.openAt, p.openDur || 0.9), 1.2) - (p.closeAt === undefined ? 0 : uiInOut(uiP(t, p.closeAt, 0.45)));
  const openAngle = p.angle === undefined ? 26 : p.angle, angle = uiLerp(158, openAngle, uiClamp(open));
  // The panels keep their full width; the strip is wider than its rect only by what the folds take up.
  const pw = el.rect.width / (n * Math.cos(openAngle * Math.PI / 360)), ph = el.rect.height;
  const shown = Math.cos(angle * Math.PI / 360) * pw * n;
  const colour = uiPaperColour(c, p.tone, 'alert');
  const faces = [];
  for (let k = 0; k < n; k++) {
    const panel = panels[k], bar = uiClamp(panel.bar === undefined ? 0 : panel.bar) * (ph - 96);
    const shade = (k % 2 ? 0.05 : 0.32) + 0.3 * (angle / 158);
    const dots = uiPaperShade(0, 0, pw, ph, {kind: 'dots', from: k % 2 ? 0.34 : 0.02, to: k % 2 ? 0.58 : 0.2, step: 8}, c.muted, '<rect width="' + uiN(pw) + '" height="' + uiN(ph) + '"/>');
    const lines = uiPaperShade(k % 2 ? pw - 18 : 0, 0, 18, ph, {kind: 'lines', dir: 'y', step: 15, from: 0.2, to: 0.7}, c.bg, '<rect x="' + uiN(k % 2 ? pw - 18 : 0) + '" width="18" height="' + uiN(ph) + '"/>');
    faces.push('<svg style="position:absolute;left:0;top:0;display:block" width="' + uiN(pw) + '" height="' + uiN(ph) + '"><rect width="' + uiN(pw) + '" height="' + uiN(ph) + '" fill="' + c.ink + '"/>' + dots + lines
      + '<text x="14" y="36" font-family="' + ctx.fonts.mono + '" font-weight="700" font-size="25" fill="' + c.bg + '">' + uiEsc(panel.title || '') + '</text><rect x="14" y="46" width="' + uiN(pw - 28) + '" height="3" fill="' + c.bg + '"/>'
      + (bar > 0 ? '<rect x="' + uiN(pw * 0.3) + '" y="' + uiN(ph - 22 - bar) + '" width="' + uiN(pw * 0.4) + '" height="' + uiN(bar) + '" fill="' + colour + '" stroke="' + c.bg + '" stroke-width="4"/>' : '')
      + (panel.value ? '<text x="' + uiN(pw / 2) + '" y="' + uiN(ph - 30 - bar) + '" text-anchor="middle" font-family="Georgia,serif" font-weight="900" font-size="19" fill="' + c.bg + '">' + uiEsc(panel.value) + '</text>' : '')
      + '<rect width="' + uiN(pw) + '" height="' + uiN(ph) + '" fill="none" stroke="' + c.bg + '" stroke-width="3"/><rect width="' + uiN(pw) + '" height="' + uiN(ph) + '" fill="#000" opacity="' + shade.toFixed(3) + '"/></svg>');
  }
  // Each panel hangs off the one before it, so one angle opens the whole strip.
  let html = '';
  for (let k = n - 1; k >= 0; k--) {
    const turn = k === 0 ? angle / 2 : (k % 2 ? -angle : angle);
    html = '<div style="position:absolute;left:' + uiN(k ? pw : 0) + 'px;top:0;width:' + uiN(pw) + 'px;height:' + uiN(ph) + 'px;transform-origin:left center;transform-style:preserve-3d;transform:rotateY(' + turn.toFixed(2) + 'deg)">' + faces[k] + html + '</div>';
  }
  return '<div style="position:absolute;left:' + uiN((el.rect.width - shown) / 2) + 'px;top:0;width:0;height:0;transform-style:preserve-3d">' + html + '</div>';
}

/**
 * paper-sheet: the page a diorama is built on, with optional hatched side flaps that
 * fold forward like a pop-up book. {title, meta [lines], rules (ruled lines, 18),
 * footer, flaps (width px, 0 for none; the page takes the rest of the rect), flapAt,
 * flapDur (0.55), flapAngle (78)}.
 */
function uiPaperSheet(el, t, ctx) {
  const p = el.props, c = ctx.c, W = el.rect.width, H = el.rect.height, fw = p.flaps || 0, pw = W - fw * 2;
  const id = 'lcp' + Math.round(uiHash(el.rect.x + el.rect.y * 3 + W) * 1e9);
  const rules = p.rules === undefined ? 18 : p.rules, meta = p.meta || [];
  const top = 40 + (p.title ? 76 : 0) + meta.length * 36;
  let lines = '';
  for (let k = 0; k < rules; k++) lines += '<rect x="44" y="' + uiN(top + k * 34) + '" width="' + uiN((0.25 + 0.65 * uiHash(k * 13 + 3)) * (pw - 88)) + '" height="9" fill="' + c.bg + '" opacity=".3"/>';
  const clip = '<rect width="' + uiN(pw) + '" height="' + uiN(H) + '"/>';
  const page = '<svg style="position:absolute;left:' + uiN(fw) + 'px;top:0;display:block" width="' + uiN(pw) + '" height="' + uiN(H) + '">' + uiPaperDefs(id, c, 1) + '<g filter="url(#' + id + 't)"><rect width="' + uiN(pw) + '" height="' + uiN(H) + '" fill="' + c.ink + '"/>'
    + uiPaperShade(0, 0, pw, H, {kind: 'dots', dir: 'y', step: 12, from: 0.02, to: 0.3}, c.muted, clip)
    + (p.title ? '<text x="44" y="82" font-family="' + ctx.fonts.mono + '" font-weight="700" font-size="50" fill="' + c.bg + '">' + uiEsc(p.title) + '</text><rect x="44" y="102" width="' + uiN(pw - 88) + '" height="4" fill="' + c.bg + '"/>' : '')
    + meta.map(function (line, k) { return '<text x="44" y="' + uiN(150 + k * 36) + '" font-family="' + ctx.fonts.mono + '" font-size="27" fill="' + c.bg + '">' + uiEsc(line) + '</text>'; }).join('')
    + lines + (p.footer ? '<text x="44" y="' + uiN(H - 22) + '" font-family="' + ctx.fonts.mono + '" font-size="20" fill="' + c.bg + '" opacity=".7">' + uiEsc(p.footer) + '</text>' : '')
    + '<rect width="' + uiN(pw) + '" height="' + uiN(H) + '" fill="none" stroke="' + c.ink + '" stroke-width="5"/></g></svg>';
  if (!fw) return page;
  const fold = uiOutBack(uiP(t, p.flapAt === undefined ? el.at : p.flapAt, p.flapDur || 0.55), 1.3), angle = uiLerp(0, p.flapAngle === undefined ? 78 : p.flapAngle, fold);
  const flap = function (side) {
    const art = uiPaperShade(0, 0, fw, H, {kind: 'lines', dir: 'y', step: 15, from: 0.25, to: 0.9}, c.bg, '<rect width="' + uiN(fw) + '" height="' + uiN(H) + '"/>') + uiPaperShade(0, 0, fw, H, {kind: 'dots', step: 9, from: 0.05, to: 0.55}, c.bg, '<rect width="' + uiN(fw) + '" height="' + uiN(H) + '"/>');
    return '<div style="position:absolute;left:' + uiN(side < 0 ? 0 : W - fw) + 'px;top:0;width:' + uiN(fw) + 'px;height:' + uiN(H) + 'px;transform-origin:' + (side < 0 ? 'right' : 'left') + ' center;transform:rotateY(' + (side < 0 ? angle : -angle).toFixed(2) + 'deg)"><svg style="display:block" width="' + uiN(fw) + '" height="' + uiN(H) + '"><rect width="' + uiN(fw) + '" height="' + uiN(H) + '" fill="' + c.ink + '"/>' + art + '</svg></div>';
  };
  return page + flap(-1) + flap(1);
}

/** A hand-torn outline: straight sides lightly nicked, ragged ends. */
function uiTornPath(w, h, seed, rough) {
  const rand = function (n) { return uiHash(seed * 31 + n); };
  let d = 'M 0 ' + uiN(rand(1) * rough);
  for (let x = 40; x < w; x += 40) d += ' L ' + uiN(x) + ' ' + uiN(rand(x) * rough * 0.5);
  d += ' L ' + uiN(w) + ' 0';
  for (let y = 0; y < h; y += 7) d += ' L ' + uiN(w - rand(y + 3) * rough * 1.6) + ' ' + uiN(y);
  d += ' L ' + uiN(w) + ' ' + uiN(h);
  for (let x = w - 40; x > 0; x -= 40) d += ' L ' + uiN(x) + ' ' + uiN(h - rand(x + 9) * rough * 0.5);
  for (let y = h; y > 0; y -= 7) d += ' L ' + uiN(rand(y + 5) * rough * 1.6) + ' ' + uiN(y);
  return d + ' Z';
}

/** torn-strip: a torn paper headline. {text (*word* in the accent), size (56), tone paper|ink, seed, typeAt, cps (14): type it out in mono, like a prompt}. */
function uiTornStrip(el, t, ctx) {
  const p = el.props, c = ctx.c, w = el.rect.width, h = el.rect.height, dark = p.tone === 'ink', size = p.size || 56;
  const id = 'lct' + Math.round(uiHash(el.rect.x + el.rect.y * 3 + w * 5) * 1e9);
  const typing = p.typeAt !== undefined;
  const shown = typing ? uiTyped(String(p.text || '').replace(/\*/g, ''), t, p.typeAt, p.cps || 14) + (Math.floor(t * 3) % 2 ? '' : '▌') : String(p.text || '');
  const words = shown.split(/(\*[^*]+\*)/).map(function (part) {
    return part.charAt(0) === '*' ? '<tspan fill="' + c.accent + '">' + uiEsc(part.slice(1, -1)) + '</tspan>' : uiEsc(part);
  }).join('');
  return '<svg style="position:absolute;left:0;top:0;overflow:visible" width="' + uiN(w) + '" height="' + uiN(h) + '">' + uiPaperDefs(id, c, 1)
    + '<path d="' + uiTornPath(w, h, p.seed || w % 13, 8) + '" fill="' + (dark ? c.bg : c.ink) + '" filter="url(#' + id + 't)" style="filter:url(#' + id + 't) drop-shadow(5px 9px 6px rgba(0,0,0,.6))"/>'
    + '<text ' + (typing ? '' : 'x="' + uiN(w / 2) + '" ') + 'y="' + uiN(h / 2 + size * 0.36) + '" ' + (typing ? 'x="30"' : 'text-anchor="middle"') + ' font-family="' + (typing ? ctx.fonts.mono : ctx.fonts.display) + '" font-weight="' + (typing ? 500 : 800) + '" font-size="' + uiN(size) + '" fill="' + (dark ? c.ink : c.bg) + '">' + words + '</text></svg>';
}

/** tape: a strip of translucent tape, torn at both ends. {tone (accent), seed, opacity (.82)}; turn it with props.rotate. */
function uiTape(el, t, ctx) {
  const p = el.props, c = ctx.c, w = el.rect.width, h = el.rect.height, seed = p.seed || w % 17;
  return '<svg style="position:absolute;left:0;top:0;overflow:visible" width="' + uiN(w) + '" height="' + uiN(h) + '"><path d="' + uiTornPath(w, h, seed, 6) + '" fill="' + uiPaperColour(c, p.tone, 'accent') + '" opacity="' + (p.opacity === undefined ? 0.82 : p.opacity) + '"/><path d="' + uiTornPath(w, h * 0.32, seed + 1, 3) + '" fill="#fff" opacity=".16"/></svg>';
}

/**
 * callout-pin: a numbered label with a leader line to a point on another element,
 * found where the 3D rig shows it at this moment. {no, text, target (element id),
 * point [x, y] (fraction of its rect, [0.5, 0.5])}. Set screen: true on it.
 */
function uiCalloutPin(el, t, ctx) {
  const p = el.props, c = ctx.c, w = el.rect.width, h = el.rect.height;
  const box = '<svg style="position:absolute;left:0;top:0;overflow:visible" width="' + uiN(w) + '" height="' + uiN(h) + '"><path d="' + uiTornPath(w, h, (p.no ? String(p.no).length : 1) + el.rect.y % 9, 5) + '" fill="' + c.ink + '"/>'
    + (p.no ? '<rect x="12" y="' + uiN(h * 0.18) + '" width="' + uiN(h * 0.74) + '" height="' + uiN(h * 0.64) + '" fill="' + c.accent + '"/><text x="' + uiN(12 + h * 0.37) + '" y="' + uiN(h * 0.64) + '" text-anchor="middle" font-family="' + ctx.fonts.mono + '" font-weight="700" font-size="' + uiN(h * 0.38) + '" fill="' + c.bg + '">' + uiEsc(p.no) + '</text>' : '')
    + '<text x="' + uiN((p.no ? h * 0.74 : 0) + 24) + '" y="' + uiN(h * 0.65) + '" font-family="' + ctx.fonts.mono + '" font-weight="700" font-size="' + uiN(h * 0.38) + '" fill="' + c.bg + '">' + uiEsc(p.text || '') + '</text></svg>';
  const target = (ctx.list || []).filter(function (other) { return other.id && other.id === p.target; })[0];
  if (!target || !ctx.stage || !ctx.stage.rig) return box;
  const point = p.point || [0.5, 0.5];
  const pose = uiRigAt(ctx.stage.rig, t);
  const spot = uiRigProject(target.rect.x + target.rect.width * point[0], target.rect.y + target.rect.height * point[1], uiPaperLift(target, pose), pose, ctx.width, ctx.height);
  const x = spot[0] - el.rect.x, y = spot[1] - el.rect.y, near = x < 0 ? 0 : w, mid = near + (x < 0 ? -40 : 40);
  return '<svg style="position:absolute;left:0;top:0;overflow:visible" width="' + uiN(w) + '" height="' + uiN(h) + '"><path d="M ' + uiN(x) + ' ' + uiN(y) + ' L ' + uiN(mid) + ' ' + uiN(h / 2) + ' L ' + uiN(near) + ' ' + uiN(h / 2) + '" fill="none" stroke="' + c.ink + '" stroke-width="2.5"/><circle cx="' + uiN(x) + '" cy="' + uiN(y) + '" r="7" fill="' + c.accent + '"/></svg>' + box;
}

/** How far off the base an element sits at this pose, spread by the rig's exploded view. */
function uiPaperLift(el, pose) {
  return (el.lift || 0) * (1 + 2 * pose.explode);
}

export {uiPaperTable, uiPaperColour, uiPaperDefs, uiPaperShade, uiPaperPart, uiCutout, uiPaperCurve, uiLimb, uiPaperFold, uiPaperSheet, uiTornPath, uiTornStrip, uiTape, uiCalloutPin, uiPaperLift};

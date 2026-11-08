// The ui-scene host: a small original pixel mascot drawn in code, a blocky
// creature with two ear nubs, in the style's accent colour (or props.tone).
// It keeps an interface explainer company: it hops in, idles with a bob and a
// blink so it is never static, and reacts on its beats (a pose change, word
// anchorable like every ui-scene time). Poses: idle, hop (hops on the spot),
// point-left, point-right, cheer (bounces with its arms up and sparkles),
// surprised (jumps, eyes wide, a "!" over its head). catalog-i-ui.mjs places
// it (a perch rests it on another element's top edge); this file only draws.
//
// The sprite is a 22 × 17 cell grid (one cell of outline round the
// silhouette), scaled to fit the element's rect and stood on its bottom
// edge, centred, as an inline SVG of crisp rects. Same rules as
// ui-paint.mjs: plain function declarations that call only each other and
// the painter's helpers, listed in ui-runtime.mjs; tables live inside the
// functions; a pure function of time.

import {uiClamp, uiP, uiOutCubic, uiHash, uiN, uiTone} from './ui-paint.mjs';

/** The poses a host draws (catalog-i-ui.mjs checks props.pose and beats against this list). */
function uiHostPoses() { return ['idle', 'hop', 'point-left', 'point-right', 'cheer', 'surprised']; }

/** #rgb or #rrggbb a toward b by k (0–1); other colours pass through. */
function uiHostMix(a, b, k) {
  const hex = function (s) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(s));
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].replace(/./g, function (ch) { return ch + ch; }) : m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const x = hex(a), y = hex(b);
  if (!x || !y) return a;
  let s = '#';
  for (let i = 0; i < 3; i++) s += Math.round(x[i] + (y[i] - x[i]) * k).toString(16).padStart(2, '0');
  return s;
}

/**
 * The sprite for a frame as rows of cell codes: . empty, a body, s shade,
 * h highlight, e eye, g glint, m mouth, k cheek, o outline. o: {pose, blink,
 * tuck (feet pulled up, in the air), wave (0/1, the two frames of a looped
 * gesture)}. Drawn in 20 × 16 inner cells, mirrored about x 9.5, then
 * outlined into the 22 × 17 grid.
 */
function uiHostGrid(o) {
  const W = 20, H = 16, g = [];
  for (let y = 0; y < H; y++) { const row = []; for (let x = 0; x < W; x++) row.push('.'); g.push(row); }
  const put = function (x, y, c) { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = c; };
  const both = function (x, y, c) { put(x, y, c); put(19 - x, y, c); };
  const pose = o.pose, wave = o.wave ? 1 : 0;
  // Body: a 10 × 10 block, corners knocked off, ear nubs on top.
  for (let y = 4; y <= 13; y++) for (let x = 5; x <= 14; x++) put(x, y, 'a');
  both(5, 4, '.'); both(5, 13, '.');
  for (let y = 2; y <= 3; y++) { both(6, y, 'a'); both(7, y, 'a'); }
  put(6, 2, 'h'); put(12, 2, 'h');
  // Light from the top left: a highlight there, shade down the right and along the base.
  put(6, 5, 'h'); put(7, 5, 'h'); put(6, 6, 'h');
  for (let y = 5; y <= 12; y++) put(14, y, 's');
  for (let x = 6; x <= 13; x++) put(x, 13, 's');
  put(13, 3, 's');
  // Feet: planted, or pulled in while airborne.
  if (o.tuck) { put(7, 14, 's'); put(8, 14, 's'); put(11, 14, 's'); put(12, 14, 's'); }
  else for (let x = 6; x <= 8; x++) both(x, 14, 's');
  // Eyes: look toward a point; wide when surprised; a line when blinking.
  const look = pose === 'point-left' ? -1 : pose === 'point-right' ? 1 : 0;
  const eye = function (x0) {
    const x = x0 + look;
    if (o.blink && pose !== 'surprised') { put(x, 8, 'e'); put(x + 1, 8, 'e'); return; }
    const top = pose === 'surprised' ? 6 : 7;
    for (let y = top; y <= 8; y++) { put(x, y, 'e'); put(x + 1, y, 'e'); }
    put(x, top, 'g');
  };
  eye(7); eye(11);
  // Mouth.
  if (pose === 'surprised') { put(9, 10, 'm'); put(10, 10, 'm'); put(9, 11, 'm'); put(10, 11, 'm'); }
  else if (pose === 'cheer' || pose === 'hop') { put(8, 10, 'm'); put(11, 10, 'm'); put(9, 11, 'm'); put(10, 11, 'm'); both(6, 10, 'k'); }
  else { put(9 + look, 11, 'm'); put(10 + look, 11, 'm'); }
  // Arms.
  const arm = function (side, cells) { for (let i = 0; i < cells.length; i++) { const c = cells[i]; put(side < 0 ? c[0] : 19 - c[0], c[1], c[2] || 'a'); } };
  const rest = [[4, 9], [4, 10]];
  if (pose === 'point-left' || pose === 'point-right') {
    const side = pose === 'point-left' ? -1 : 1;
    // The pointing arm reaches out, the finger taps one cell further on the beat of wave.
    arm(side, [[4, 8], [3, 8], [2, 8], [1, 8, 'h']].concat(wave ? [[0, 8, 'h']] : []));
    arm(-side, rest);
  } else if (pose === 'cheer') {
    const up = wave ? [[4, 7], [3, 6], [3, 5], [3, 4], [3, 3, 'h']] : [[4, 7], [3, 6], [2, 5], [2, 4, 'h']];
    arm(-1, up); arm(1, up);
  } else if (pose === 'surprised' || pose === 'hop') {
    const up = [[4, 7], [3, 6], [2, 5, 'h']];
    arm(-1, up); arm(1, up);
  } else { arm(-1, rest); arm(1, rest); }
  // Outline: every empty cell beside the silhouette, in a grid one cell wider each side.
  const out = [];
  for (let y = 0; y < H + 1; y++) {
    let row = '';
    for (let x = 0; x < W + 2; x++) {
      const cell = function (cx, cy) { const ix = cx - 1, iy = cy; return ix >= 0 && ix < W && iy >= 0 && iy < H ? g[iy][ix] : '.'; };
      const c = cell(x, y);
      if (c !== '.') { row += c; continue; }
      const near = cell(x - 1, y) !== '.' || cell(x + 1, y) !== '.' || cell(x, y - 1) !== '.' || cell(x, y + 1) !== '.';
      row += near ? 'o' : '.';
    }
    out.push(row);
  }
  return out;
}

/** A grid as SVG rects, runs of one code merged along each row, in the palette pal {code: colour}. */
function uiHostSvg(rows, pal, w, h) {
  let s = '';
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    let x = 0;
    while (x < row.length) {
      const c = row.charAt(x);
      let n = 1;
      while (x + n < row.length && row.charAt(x + n) === c) n++;
      if (c !== '.' && pal[c]) s += '<rect x="' + x + '" y="' + y + '" width="' + n + '" height="1" fill="' + pal[c] + '"/>';
      x += n;
    }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + uiN(w) + '" height="' + uiN(h) + '" viewBox="0 0 ' + rows[0].length + ' ' + rows.length + '" shape-rendering="crispEdges" style="display:block;overflow:visible">' + s + '</svg>';
}

/** The pose a host holds at t and when it took it: props.pose (merged from its beats) since the last beat that set one, else since it entered. */
function uiHostPoseAt(el, t) {
  const beats = el.beats || [];
  let since = el.at, pose = (el.props && el.props.pose) || 'idle';
  for (let i = 0; i < beats.length; i++) if (beats[i].set && beats[i].set.pose !== undefined && t >= beats[i].at) since = beats[i].at;
  return {pose: pose, since: since, changed: since > el.at};
}

/**
 * host: {pose idle|hop|point-left|point-right|cheer|surprised [idle], tone
 * [accent], from below|left|right (where a hop entrance comes from)
 * [below], perch (an element id; the module places the rect), along}. The
 * pose changes on beats ({at, set: {pose}}); every pose idles with a bob
 * and a blink.
 */
function uiHost(el, t, ctx) {
  const p = el.props, c = ctx.c, w = el.rect.width, h = el.rect.height, a0 = el.at;
  const cols = 22, rows = 17, px = Math.min(w / cols, h / rows), sw = px * cols, sh = px * rows;
  const body = uiTone(c, p.tone, 'accent');
  const pal = {a: body, s: uiHostMix(body, '#000000', 0.32), h: uiHostMix(body, '#ffffff', 0.45), e: uiHostMix(c.bg, '#000000', 0.3), g: '#ffffff', m: uiHostMix(c.bg, '#000000', 0.3), k: uiHostMix(c.alert, body, 0.35), o: uiHostMix(c.bg, '#000000', 0.55)};
  const state = uiHostPoseAt(el, t), since = t - state.since;
  // The hop entrance: in the air (feet tucked) until it lands, travelling in from its side.
  const hopping = el.enter === 'hop', d = el.enterDuration || 0.5;
  const airborne = hopping && t < a0 + d;
  const travel = airborne && (p.from === 'left' || p.from === 'right') ? (p.from === 'left' ? -1 : 1) * (1 - (t - a0) / d) * (el.dist || 140) * 1.4 : 0;
  let pose = airborne ? 'hop' : state.pose;
  let y = 0, sx = 1, sy = 1, tuck = airborne, wave = 0;
  // Idle life, under every pose: a two-step bob (whole cells, as pixel art moves) and a slow breath.
  const life = t - a0;
  y -= (Math.sin(life * Math.PI * 2 / 1.1) > 0.15 ? 1 : 0) * px * 0.5;
  sy *= 1 + 0.025 * Math.sin(life * Math.PI * 2 / 2.2);
  // A blink every ~3 s, its moment shifted per cycle so it never ticks like a metronome.
  const cycle = Math.floor((life + 0.9) / 3.1), inCycle = (life + 0.9) - cycle * 3.1;
  const blinkAt = 0.4 + 2.2 * uiHash(cycle + 7);
  const blink = !airborne && inCycle >= blinkAt && inCycle < blinkAt + 0.13;
  if (!airborne) {
    if (pose === 'hop' || pose === 'cheer') {
      // Looped hops: a parabola a period, a squash where it lands.
      const period = pose === 'hop' ? 0.62 : 0.5, height = pose === 'hop' ? 3.2 : 1.8;
      const q = (since % period) / period, air = 4 * q * (1 - q);
      y -= air * height * px;
      if (pose === 'hop') tuck = air > 0.25;
      const land = q < 0.12 ? 1 - q / 0.12 : 0;
      sx *= 1 + 0.1 * land; sy *= 1 - 0.12 * land;
      wave = Math.floor(since / (period / 2)) % 2;
    } else if (pose === 'surprised') {
      // One startled jump, then a fine tremble.
      const q = uiP(since, 0, 0.32);
      y -= Math.sin(Math.PI * q) * 2.6 * px;
      y += since > 0.32 ? Math.sin(since * 60) * px * 0.12 * Math.max(0, 1 - (since - 0.32) / 1.2) : 0;
    } else if (pose === 'point-left' || pose === 'point-right') {
      wave = Math.floor(since / 0.3) % 2;
    }
  }
  // A pose change pops: a quick stretch that settles.
  if (state.changed && !airborne && since < 0.26) { const k = 1 - since / 0.26; sy *= 1 + 0.14 * k * k; sx *= 1 - 0.08 * k * k; }
  const grid = uiHostGrid({pose: pose, blink: blink, tuck: tuck, wave: wave});
  let s = '';
  // A contact shadow on the edge it stands on, smaller while it is in the air.
  const lift = uiClamp(-y / (3.5 * px));
  s += '<div style="position:absolute;left:' + uiN((w - sw * 0.62 * (1 - 0.4 * lift)) / 2 + travel) + 'px;top:' + uiN(h - px * 0.9) + 'px;width:' + uiN(sw * 0.62 * (1 - 0.4 * lift)) + 'px;height:' + uiN(px * 1.4) + 'px;border-radius:50%;background:#000000;opacity:' + (0.38 * (1 - 0.6 * lift)).toFixed(3) + ';filter:blur(' + uiN(px * 0.4) + 'px)"></div>';
  s += '<div style="position:absolute;left:' + uiN((w - sw) / 2 + travel) + 'px;top:' + uiN(h - sh + y) + 'px;width:' + uiN(sw) + 'px;height:' + uiN(sh) + 'px;transform-origin:50% 100%;transform:scale(' + uiN(sx * 1000) / 1000 + ',' + uiN(sy * 1000) / 1000 + ')">' + uiHostSvg(grid, pal, sw, sh) + '</div>';
  // Reactions over its head: a "!" when surprised, sparkles when it cheers.
  const headY = h - sh + y + px * 1.5;
  if (pose === 'surprised' && !airborne) {
    const k = uiOutCubic(uiP(since, 0.05, 0.18));
    const mark = ['.oo.', 'oggo', 'oggo', 'oggo', '.oo.', 'oggo', '.oo.'];
    s += '<div style="position:absolute;left:' + uiN(w / 2 + sw * 0.34 + travel) + 'px;top:' + uiN(headY - px * 8.5) + 'px;transform-origin:50% 100%;transform:scale(' + uiN(k * 1000) / 1000 + ')">' + uiHostSvg(mark, {o: pal.o, g: pal.g}, px * 4, px * 7) + '</div>';
  }
  if (pose === 'cheer' && !airborne) {
    for (let i = 0; i < 4; i++) {
      const beat = Math.floor((since + i * 0.17) / 0.7), q = ((since + i * 0.17) % 0.7) / 0.7;
      const ang = (i / 4 + uiHash(beat * 4 + i) * 0.2) * Math.PI * 2, r = sw * (0.42 + 0.2 * q);
      const cx = w / 2 + Math.cos(ang) * r + travel, cy = headY + px * 4 - Math.abs(Math.sin(ang)) * r * 0.7;
      const star = ['.h.', 'hgh', '.h.'];
      s += '<div style="position:absolute;left:' + uiN(cx - px * 1.5) + 'px;top:' + uiN(cy - px * 1.5) + 'px;opacity:' + (1 - q).toFixed(3) + '">' + uiHostSvg(star, {h: pal.h, g: pal.g}, px * 3, px * 3) + '</div>';
    }
  }
  return s;
}

export {uiHostPoses, uiHostMix, uiHostGrid, uiHostSvg, uiHostPoseAt, uiHost};

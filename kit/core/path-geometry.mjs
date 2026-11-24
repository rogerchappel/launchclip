// Path geometry for the hand-drawn reveal: turns view-tree SVG shapes
// (path, rect, circle, ellipse, line, polygon, polyline) into flat absolute
// polylines, composes g/svg transforms, and measures them so a pen can
// redraw an illustration stroke by stroke. Pure functions, no DOM.

const ID = [1, 0, 0, 1, 0, 0];
const mul = (A, B) => [
  A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
  A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
  A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5],
];
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const num = (v, d = 0) => (v == null || v === "" || Number.isNaN(parseFloat(v)) ? d : parseFloat(v));
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const nums = (s) => String(s ?? "").match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)?.map(Number) ?? [];

// Parse an SVG transform list (translate/scale/rotate/matrix; skewX/skewY too) into [a,b,c,d,e,f].
export function parseTransform(str) {
  let m = ID;
  for (const [, fn, args] of String(str ?? "").matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = nums(args);
    const r = ((a[0] ?? 0) * Math.PI) / 180;
    let t = ID;
    if (fn === "translate") t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === "scale") t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === "matrix" && a.length === 6) t = a;
    else if (fn === "skewX") t = [1, 0, Math.tan(r), 1, 0, 0];
    else if (fn === "skewY") t = [1, Math.tan(r), 0, 1, 0, 0];
    else if (fn === "rotate") {
      const [cx = 0, cy = 0] = a.slice(1);
      t = mul(mul([1, 0, 0, 1, cx, cy], [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    }
    m = mul(m, t);
  }
  return m;
}

function bezier(out, pts, tol) {
  let ctrl = 0;
  for (let i = 1; i < pts.length; i++) ctrl += dist(pts[i - 1], pts[i]);
  const n = Math.min(128, Math.max(4, Math.ceil(2 * Math.sqrt(ctrl / tol))));
  for (let k = 1; k <= n; k++) {
    const t = k / n, u = 1 - t;
    const w = pts.length === 3 ? [u * u, 2 * u * t, t * t] : [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    out.push([0, 1].map((j) => w.reduce((s, wi, i) => s + wi * pts[i][j], 0)));
  }
}

// Endpoint → centre parameterisation, SVG spec F.6.5.
function arc(out, [x1, y1], rx, ry, deg, fA, fS, [x2, y2], tol) {
  if (x1 === x2 && y1 === y2) return;
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return void out.push([x2, y2]);
  const phi = (deg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const n1 = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const coef = (fA !== fS ? 1 : -1) * Math.sqrt(Math.max(0, n1 / (rx * rx * yp * yp + ry * ry * xp * xp)));
  const cxp = (coef * rx * yp) / ry, cyp = (-coef * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const ux = (xp - cxp) / rx, uy = (yp - cyp) / ry;
  const t1 = ang(1, 0, ux, uy);
  let dt = ang(ux, uy, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!fS && dt > 0) dt -= 2 * Math.PI;
  if (fS && dt < 0) dt += 2 * Math.PI;
  const r = Math.max(rx, ry), step = tol < r ? 2 * Math.acos(1 - tol / r) : Math.PI;
  // at least one segment per 15 degrees so small arcs still read round when scaled up
  const n = Math.max(Math.ceil(Math.abs(dt) / step), Math.ceil(Math.abs(dt) / (Math.PI / 12)), 1);
  for (let k = 1; k <= n; k++) {
    const t = t1 + (dt * k) / n;
    out.push(k === n ? [x2, y2] : [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
  }
}

const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

export function parsePath(d, { tolerance = 0.5 } = {}) {
  // shortcut: arc flags must be space/comma separated ("0 0 1"), not packed ("001"); upgrade if minified paths show up.
  const toks = String(d ?? "").match(/[MmZzLlHhVvCcSsQqTtAa]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const subs = [];
  let cur = [0, 0], start = [0, 0], sub = null, lastCtrl = null, lastCmd = "", i = 0, cmd = "";
  const begin = (p) => { sub = { points: [p], closed: false }; subs.push(sub); };
  while (i < toks.length) {
    if (/[a-z]/i.test(toks[i])) cmd = toks[i++];
    else if (!cmd) { i++; continue; }
    const C = cmd.toUpperCase(), rel = cmd !== C;
    const a = toks.slice(i, i + ARITY[C]).map(Number);
    if (a.length < ARITY[C] || a.some(Number.isNaN)) break;
    i += ARITY[C];
    const P = (x, y) => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
    if (C === "Z") {
      if (sub) { if (dist(cur, start) > 1e-9) sub.points.push([...start]); sub.closed = true; }
      cur = [...start]; sub = null; lastCtrl = null; lastCmd = C;
      continue;
    }
    if (C === "M") { cur = start = P(a[0], a[1]); begin(cur); cmd = rel ? "l" : "L"; lastCtrl = null; lastCmd = C; continue; }
    if (!sub) { begin([...cur]); start = [...cur]; }
    const pts = sub.points;
    let end, ctrl = null;
    if (C === "L") end = P(a[0], a[1]);
    else if (C === "H") end = [rel ? cur[0] + a[0] : a[0], cur[1]];
    else if (C === "V") end = [cur[0], rel ? cur[1] + a[0] : a[0]];
    else if (C === "A") { end = P(a[5], a[6]); arc(pts, cur, a[0], a[1], a[2], !!a[3], !!a[4], end, tolerance); }
    else {
      const refl = (types) => (lastCtrl && types.includes(lastCmd) ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : [...cur]);
      let c;
      if (C === "C") { c = [P(a[0], a[1]), P(a[2], a[3])]; end = P(a[4], a[5]); }
      else if (C === "S") { c = [refl("CS"), P(a[0], a[1])]; end = P(a[2], a[3]); }
      else if (C === "Q") { c = [P(a[0], a[1])]; end = P(a[2], a[3]); }
      else { c = [refl("QT")]; end = P(a[0], a[1]); }
      bezier(pts, [cur, ...c, end], tolerance);
      ctrl = c[c.length - 1];
    }
    if (C === "L" || C === "H" || C === "V") pts.push(end);
    cur = end; lastCtrl = ctrl; lastCmd = C;
  }
  return subs;
}

export function shapeSubpaths(node, matrix = ID, opts) {
  const A = node?.attrs ?? {};
  let subs;
  switch (node?.tag) {
    case "path": subs = parsePath(A.d, opts); break;
    case "rect": {
      const x = num(A.x), y = num(A.y), w = num(A.width), h = num(A.height);
      let rx = num(A.rx, num(A.ry)), ry = num(A.ry, rx);
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      subs = parsePath(rx && ry
        ? `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
        : `M${x} ${y}H${x + w}V${y + h}H${x}Z`, opts);
      break;
    }
    case "circle": case "ellipse": {
      const cx = num(A.cx), cy = num(A.cy), rx = num(node.tag === "circle" ? A.r : A.rx), ry = num(node.tag === "circle" ? A.r : A.ry);
      subs = rx && ry ? parsePath(`M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`, opts) : [];
      break;
    }
    case "line": subs = [{ points: [[num(A.x1), num(A.y1)], [num(A.x2), num(A.y2)]], closed: false }]; break;
    case "polygon": case "polyline": {
      const n = nums(A.points), points = [];
      for (let k = 0; k + 1 < n.length; k += 2) points.push([n[k], n[k + 1]]);
      const closed = node.tag === "polygon" && points.length > 2;
      if (closed) points.push([...points[0]]);
      subs = points.length ? [{ points, closed }] : [];
      break;
    }
    default: return [];
  }
  return subs.map((s) => ({ points: s.points.map((p) => apply(matrix, p)), closed: s.closed }));
}

const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polygon", "polyline"]);
const SKIP = new Set(["defs", "mask", "clipPath", "linearGradient", "radialGradient", "text", "pattern", "symbol"]);

function viewBoxMatrix(A) {
  const vb = nums(A.viewBox), w = num(A.width, NaN), h = num(A.height, NaN);
  if (vb.length !== 4 || !(vb[2] > 0 && vb[3] > 0) || !(w > 0 && h > 0) || /%/.test(`${A.width}${A.height}`)) return ID;
  // default preserveAspectRatio: xMidYMid meet
  const s = Math.min(w / vb[2], h / vb[3]);
  return [s, 0, 0, s, (w - vb[2] * s) / 2 - vb[0] * s, (h - vb[3] * s) / 2 - vb[1] * s];
}

export function walkShapes(node, matrix = ID, out = []) {
  if (!node || typeof node !== "object" || SKIP.has(node.tag)) return out;
  const A = node.attrs ?? {};
  let m = matrix;
  if (node.tag !== "div" && A.transform) m = mul(m, parseTransform(A.transform));
  if (node.tag === "svg") m = mul(m, viewBoxMatrix(A));
  if (SHAPES.has(node.tag)) out.push({ node, matrix: m });
  for (const c of node.children ?? []) walkShapes(c, m, out);
  return out;
}

export function polylineLength(points) {
  let L = 0;
  for (let k = 1; k < points.length; k++) L += dist(points[k - 1], points[k]);
  return L;
}

export function pointAt(points, s) {
  if (!points.length) return [0, 0];
  let left = Math.min(1, Math.max(0, s)) * polylineLength(points);
  for (let k = 1; k < points.length; k++) {
    const seg = dist(points[k - 1], points[k]);
    if (left <= seg && seg > 0) {
      const t = left / seg, [a, b] = [points[k - 1], points[k]];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    left -= seg;
  }
  return [...points[points.length - 1]];
}

const r1 = (v) => Math.round(v * 10) / 10 + 0; // + 0 turns -0 into 0
export function toPathD(points, closed = false) {
  if (!points.length) return "";
  const d = points.map((p, k) => `${k ? "L" : "M"}${r1(p[0])} ${r1(p[1])}`).join(" ");
  return closed ? `${d} Z` : d;
}

export function bounds(lists) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pts of lists) for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return x0 === Infinity ? { x: 0, y: 0, width: 0, height: 0 } : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// Open polylines (last point not back at the first) have no area.
export function area(points) {
  if (points.length < 4 || dist(points[0], points[points.length - 1]) > 1e-6) return 0;
  let s = 0;
  for (let k = 0; k < points.length; k++) { const [a, b] = [points[k], points[(k + 1) % points.length]]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}

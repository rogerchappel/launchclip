// Where a drawn character reaches: the bounding box of every shape in a
// drawing (drawFlat's tree, joints and all), with each joint's pivot,
// mirror and transform applied as view.mjs applies them, in rig units (the
// feet's centre at 0, 0; without a floor shadow a stick figure's feet end a few units above it). A path is bounded by its points and control
// points, so the box can only be a little generous, never short. Scenes
// scale and place it to check that a pointing hand, a raised arm or a held
// phone stays on the canvas (cast-scene, the cast gate).
//
// A floor shadow (a pen's ground(), marked with SHADOW) lies on the floor
// beside the feet; it is not part of the character's reach, so it is left out.
//
// Imports only sibling kit/core files.

/**
 * Marks a node as a floor shadow. The mark is a symbol, so it never reaches
 * a model's JSON or a renderer: drawings stay byte-identical.
 */
export const SHADOW = Symbol('character-shadow');
export const asShadow = nodes => nodes.map(node => (node && typeof node === 'object' ? Object.assign(node, {[SHADOW]: true}) : node));

const IDENTITY = [1, 0, 0, 1, 0, 0];
const multiply = ([a, b, c, d, e, f], [A, B, C, D, E, F]) => [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
const translate = (x, y) => [1, 0, 0, 1, x, y];
const scale = (x, y = x) => [x, 0, 0, y, 0, 0];
const rotate = deg => { const r = deg * Math.PI / 180; return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]; };
const apply = ([a, b, c, d, e, f], x, y) => [a * x + c * y + e, b * x + d * y + f];

/** An SVG transform attribute (translate, rotate, scale; space or comma separated) as a matrix. */
function svgMatrix(attr) {
  let m = IDENTITY;
  for (const [, fn, args] of String(attr ?? '').matchAll(/(translate|rotate|scale)\(([^)]*)\)/g)) {
    const v = args.trim().split(/[\s,]+/).map(Number);
    m = multiply(m, fn === 'translate' ? translate(v[0], v[1] ?? 0) : fn === 'rotate' ? rotate(v[0]) : scale(v[0], v[1] ?? v[0]));
  }
  return m;
}

function pathPoints(d) {
  if (/[^MLQCZmlqcz0-9.\-\s,eE]/.test(d)) throw new Error(`character bounds: unsupported path ${d}`);
  if (/[mlqcz]/.test(d.replace(/e-?\d/gi, ''))) throw new Error(`character bounds: relative path commands are not supported (${d})`);
  const numbers = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
  const points = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) points.push([numbers[i], numbers[i + 1]]);
  return points;
}

// The local points (and half stroke) that bound one shape.
function shapePoints(node) {
  const a = node.attrs ?? {};
  const pad = Number(a.strokeWidth ?? 0) / 2;
  const box = (x0, y0, x1, y1) => [[x0 - pad, y0 - pad], [x1 + pad, y0 - pad], [x1 + pad, y1 + pad], [x0 - pad, y1 + pad]];
  if (node.tag === 'ellipse') return box(+a.cx - +a.rx, +a.cy - +a.ry, +a.cx + +a.rx, +a.cy + +a.ry);
  if (node.tag === 'circle') return box(+a.cx - +a.r, +a.cy - +a.r, +a.cx + +a.r, +a.cy + +a.r);
  if (node.tag === 'rect') return box(+a.x, +a.y, +a.x + +a.width, +a.y + +a.height);
  if (node.tag === 'path') return pathPoints(String(a.d)).flatMap(([x, y]) => box(x, y, x, y));
  return [];
}

const UNDRAWN = new Set(['defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'pattern']);

// Visits every drawn shape the match covers: visit(node, matrix), the matrix
// placing the node's own coordinates in the drawing.
function eachShape(drawing, match, hidden, visit, {clipped = true} = {}) {
  const walk = (node, m, counted) => {
    if (!node || typeof node !== 'object') return;
    if ((!hidden && (node.style?.opacity === 0 || node.attrs?.opacity === 0)) || node[SHADOW]) return;
    if (!clipped && node.attrs?.clipPath) return;
    // Paint servers and clips draw nothing themselves.
    if (UNDRAWN.has(node.tag)) return;
    let here = m;
    if (node.tag === 'joint') {
      const {pivot, transform: t} = node;
      here = multiply(m, translate(pivot.x, pivot.y));
      if (pivot.mirror) here = multiply(here, scale(-1, 1));
      here = multiply(here, translate(t.x ?? 0, t.y ?? 0));
      here = multiply(here, rotate(t.rotation ?? 0));
      here = multiply(here, scale(t.scaleX ?? 1, t.scaleY ?? 1));
    } else if (node.attrs?.transform) here = multiply(m, svgMatrix(node.attrs.transform));
    const inside = counted || match(node);
    if (inside) visit(node, here);
    for (const child of node.children ?? []) walk(child, here, inside);
  };
  walk(drawing, IDENTITY, false);
}

/** {left, top, right, bottom} of a drawing in rig units. */
export function drawingBounds(drawing) {
  return partBounds(drawing, () => true);
}

/**
 * {left, top, right, bottom} in rig units of the parts of a drawing that
 * match (match(node) → boolean; a match counts with everything inside it),
 * placed by every joint and group above them. Nothing matched: infinite.
 * hidden: true counts parts hidden at the start too (an open mouth, the
 * other expressions' faces), as the op list may show them.
 */
export function partBounds(drawing, match, {hidden = false} = {}) {
  const out = {left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity};
  eachShape(drawing, match, hidden, (node, m) => {
    for (const [x, y] of shapePoints(node)) {
      const [px, py] = apply(m, x, y);
      out.left = Math.min(out.left, px); out.right = Math.max(out.right, px);
      out.top = Math.min(out.top, py); out.bottom = Math.max(out.bottom, py);
    }
  });
  return out;
}

/**
 * Points along a path's outline (absolute M, L, Q, C, Z): its corners and
 * each curve sampled. → [[x, y]]
 */
export function pathOutline(d, steps = 12) {
  const tokens = String(d).match(/[MLQCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const out = [];
  let i = 0, cmd = null, cur = [0, 0], start = [0, 0];
  const num = () => Number(tokens[i++]);
  const curve = (f) => { for (let k = 1; k <= steps; k++) out.push(f(k / steps)); };
  while (i < tokens.length) {
    if (/^[MLQCZ]$/i.test(tokens[i])) cmd = tokens[i++].toUpperCase();
    if (cmd === 'M') { cur = start = [num(), num()]; out.push(cur); cmd = 'L'; }
    else if (cmd === 'L') { cur = [num(), num()]; out.push(cur); }
    else if (cmd === 'Q') {
      const [p0, p1, p2] = [cur, [num(), num()], [num(), num()]];
      curve(t => [0, 1].map(k => (1 - t) ** 2 * p0[k] + 2 * (1 - t) * t * p1[k] + t * t * p2[k]));
      cur = p2;
    } else if (cmd === 'C') {
      const [p0, p1, p2, p3] = [cur, [num(), num()], [num(), num()], [num(), num()]];
      curve(t => [0, 1].map(k => (1 - t) ** 3 * p0[k] + 3 * (1 - t) ** 2 * t * p1[k] + 3 * (1 - t) * t * t * p2[k] + t ** 3 * p3[k]));
      cur = p3;
    } else if (cmd === 'Z') { cur = start; cmd = null; }
    else throw new Error(`character bounds: unsupported path ${d}`);
  }
  return out;
}

/**
 * The shapes of the matching parts, each with points along its drawn edge
 * placed in the drawing (an ellipse's edge or a path's outline, sampled,
 * with half its stroke; tighter than partBounds, which counts a curve's
 * control points). Clipped groups are left out: they draw only inside
 * their clip, a shape drawn beside them. matrix places the node's own
 * coordinates (placePoint). → [{node, points, matrix}]
 */
export function partShapes(drawing, match, {hidden = false} = {}) {
  const out = [];
  eachShape(drawing, match, hidden, (node, m) => {
    const a = node.attrs ?? {};
    const pad = a.stroke === 'none' ? 0 : Number(a.strokeWidth ?? 0) / 2;
    let local = [];
    if (node.tag === 'ellipse' || node.tag === 'circle') {
      const rx = +(a.rx ?? a.r) + pad, ry = +(a.ry ?? a.r) + pad;
      local = Array.from({length: 24}, (_, i) => [+a.cx + rx * Math.cos(i * Math.PI / 12), +a.cy + ry * Math.sin(i * Math.PI / 12)]);
    } else if (node.tag === 'path') {
      const ring = Array.from({length: 8}, (_, i) => [pad * Math.cos(i * Math.PI / 4), pad * Math.sin(i * Math.PI / 4)]);
      local = pathOutline(a.d).flatMap(([x, y]) => (pad ? ring.map(([dx, dy]) => [x + dx, y + dy]) : [[x, y]]));
    } else local = shapePoints(node);
    if (local.length) out.push({node, matrix: m, points: local.map(([x, y]) => apply(m, x, y))});
  }, {clipped: false});
  return out;
}

/** A point in a node's own coordinates placed by a partShapes matrix. → [x, y] */
export const placePoint = (matrix, x, y) => apply(matrix, x, y);


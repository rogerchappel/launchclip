// Where a drawn character reaches: the bounding box of every shape in a
// drawing (drawFlat's tree, joints and all), with each joint's pivot,
// mirror and transform applied as view.mjs applies them, in rig units (the
// feet's centre at 0, 0). A path is bounded by its points and control
// points, so the box can only be a little generous, never short. Scenes
// scale and place it to check that a pointing hand, a raised arm or a held
// phone stays on the canvas (cast-scene, the cast gate).
//
// Imports only sibling kit/core files.

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

/** {left, top, right, bottom} of a drawing in rig units. */
export function drawingBounds(drawing) {
  const out = {left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity};
  const walk = (node, m) => {
    if (!node || typeof node !== 'object') return;
    if (node.style?.opacity === 0 || node.attrs?.opacity === 0) return;
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
    for (const [x, y] of shapePoints(node)) {
      const [px, py] = apply(here, x, y);
      out.left = Math.min(out.left, px); out.right = Math.max(out.right, px);
      out.top = Math.min(out.top, py); out.bottom = Math.max(out.bottom, py);
    }
    for (const child of node.children ?? []) walk(child, here);
  };
  walk(drawing, IDENTITY);
  return out;
}

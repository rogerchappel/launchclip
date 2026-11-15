// Hand-drawn marks over a word or phrase: an underline, circle, box, pair of
// brackets or marker stroke with the wobble of a pen, as SVG paths. The
// wobble is seeded, so the same words get the same stroke in both renderers
// and on every render; the stroke draws on with a dash offset (a strokePath,
// kit/core/catalog-h-view.mjs). Plain ESM; imports only tactile.mjs for its
// seeded generator. Used by motion-title (kit/core/catalog-h-text.mjs).
//
//   roughMark(kind, {width, height, seed}) → {kind, width, height, paths}
//     width, height   the box of the words, px (the text's line box)
//     paths           [{d, width (stroke px), opacity?, cap?, share}], in
//                     drawing order; share is each path's part of the draw
import {seededRandom} from './tactile.mjs';

export const MARK_KINDS = Object.freeze(['underline', 'circle', 'box', 'bracket', 'marker']);

const r1 = value => Math.round(value * 10) / 10;
const pt = ([x, y]) => `${r1(x)} ${r1(y)}`;

// A smooth stroke through points: each point is a control, the curve passes through the midpoints.
function through(points) {
  let d = `M${pt(points[0])}`;
  for (let i = 1; i < points.length - 1; i += 1) d += ` Q${pt(points[i])} ${pt([(points[i][0] + points[i + 1][0]) / 2, (points[i][1] + points[i + 1][1]) / 2])}`;
  return `${d} L${pt(points[points.length - 1])}`;
}

/** The paths of one mark over a width × height box of words. */
export function roughMark(kind, {width, height, seed = ''} = {}) {
  if (!MARK_KINDS.includes(kind)) throw new Error(`unknown mark: ${kind}`);
  if (!(width > 0 && height > 0)) throw new Error('a mark needs a width and a height');
  const random = seededRandom(`${seed}|${kind}`);
  const w = width, h = height, pen = r1(h * 0.055), wobble = h * 0.03;
  const j = (amount = wobble) => (random() * 2 - 1) * amount;
  // A nearly straight stroke: its ends land close, its middle bows.
  const stroke = (x0, y0, x1, y1) => [[x0 + j(), y0 + j()], ...[0.3, 0.7].map(f => [x0 + (x1 - x0) * f + j(), y0 + (y1 - y0) * f + j(wobble * 1.6)]), [x1 + j(), y1 + j()]];
  let paths;
  if (kind === 'underline') {
    // Out and back, as a pen underlines twice.
    const y = h * 0.95;
    paths = [{d: through([...stroke(-w * 0.02, y, w * 1.02, y), ...stroke(w * 1.01, y + pen * 0.9, w * 0.04, y + pen * 0.7)]), width: pen}];
  } else if (kind === 'marker') {
    const y = h * 0.56;
    paths = [{d: through(stroke(-h * 0.08, y + j(), w + h * 0.08, y + j())), width: r1(h * 0.66), opacity: 0.45, cap: 'butt'}];
  } else if (kind === 'circle') {
    // One loop that overshoots its start and drifts inward, so the ends cross and do not meet.
    const cx = w / 2, cy = h * 0.54, rx = w / 2 + h * 0.3, ry = h * 0.68, from = -2.6 + j(0.25), turns = 6.9, count = 16;
    paths = [{d: through(Array.from({length: count + 1}, (_, i) => {
      const a = from + (turns * i) / count, k = 1 - 0.07 * (i / count) + j(0.025);
      return [cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)];
    })), width: pen}];
  } else if (kind === 'box') {
    const x0 = -h * 0.12, x1 = w + h * 0.12, y0 = h * 0.07, y1 = h * 1.01;
    const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0 + j(), y0 - h * 0.05]];
    let d = `M${pt([x0 + j(), y0 + j()])}`;
    for (let i = 1; i < corners.length; i += 1) {
      const [ax, ay] = corners[i - 1], [bx, by] = corners[i];
      d += ` Q${pt([(ax + bx) / 2 + j(wobble * 1.6), (ay + by) / 2 + j(wobble * 1.6)])} ${pt([bx + j(), by + j()])}`;
    }
    paths = [{d, width: pen}];
  } else {
    const gap = h * 0.16, arm = h * 0.2, y0 = h * 0.05, y1 = h * 1.0;
    const side = (x, dir) => `M${pt([x + dir * arm, y0 + j()])} L${pt([x + j(), y0 + j()])} L${pt([x + j(), y1 + j()])} L${pt([x + dir * arm, y1 + j()])}`;
    paths = [{d: side(-gap, 1), width: pen}, {d: side(w + gap, -1), width: pen}];
  }
  return {kind, width: r1(w), height: r1(h), paths: paths.map(path => ({...path, share: 1 / paths.length}))};
}

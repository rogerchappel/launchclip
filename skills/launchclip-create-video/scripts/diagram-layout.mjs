// Diagram layout: the geometry and timing the line-drawing modules share
// (line-diagram in catalog-i-diagram.mjs, feynman-diagram in
// catalog-i-math.mjs). Plain, deterministic functions:
//
//   fitDrawing     scale a drawing's bounding box (in its own units) to fill
//                  an area, keeping its proportions
//   placeLabel     put a label box beside a stroke or a point, clear of every
//                  stroke, dot and label already placed, inside the bounds
//   labelHold      how long a label must stay up to be read (1 s + reading)
//   scheduleDraw   when each stroke draws: walks forward from the build
//                  start, compressed so every stroke finishes before the
//                  exit and every label holds for its read; a label the
//                  scene has no time for is dropped rather than flashed
//
// Strokes are polylines with a half-width: {points: [[x, y]…], half}.

import {r2, rt} from './catalog-b-base.mjs';

// ---------------------------------------------------------------------------
// Timing

/** Seconds a label must stay readable: 1 s plus 0.3 s a word (about 200 words a minute). */
export const LABEL_HOLD = Object.freeze({base: 1, perWord: 0.3});

export function labelHold(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
  return rt(LABEL_HOLD.base + LABEL_HOLD.perWord * Math.max(1, words));
}

/**
 * The draw schedule for strokes drawn in order. items: [{hold}] (0 for a
 * stroke with no label to read). Times are scene-relative:
 *   first      when the first stroke starts
 *   lastEvent  every stroke finishes drawing by then
 *   readEnd    every label has had its hold by then (the exit start)
 *   gap, draw  the relaxed spacing between stroke starts and the draw length
 *   lag        a label shows at start + draw × lag (as its stroke lands)
 * Gaps compress first, then the draw shortens to minDraw, then labels the
 * scene still cannot hold are dropped, longest first.
 * Returns {starts: [rel], draw, labelAt: [rel | null], dropped: [index]}.
 */
export function scheduleDraw(items, {first, lastEvent, readEnd, gap = 0.5, draw = 0.6, minDraw = 0.3, lag = 0.8}) {
  const holds = items.map(item => Math.max(0, Number(item?.hold) || 0));
  const dropped = [];
  let d = draw;
  for (let guard = 0; guard < 64; guard++) {
    const latest = holds.map(hold => (hold > 0 ? readEnd - d * lag - hold : lastEvent - d));
    const failing = latest.map((value, i) => (value + 1e-9 < first ? i : -1)).filter(i => i >= 0);
    const failingLabels = failing.filter(i => holds[i] > 0);
    if (failingLabels.length && d > minDraw + 1e-9) { d = Math.max(minDraw, r2(d * 0.75)); continue; }
    if (failingLabels.length) {
      // Drop the longest read first: it frees the most time for the rest.
      const worst = failingLabels.reduce((a, b) => (holds[b] > holds[a] ? b : a));
      holds[worst] = 0;
      dropped.push(worst);
      continue;
    }
    // Every remaining stroke has room at `first`; compress the gaps to fit.
    let k = 1;
    holds.forEach((_, i) => { if (i > 0 && !failing.includes(i)) k = Math.min(k, (latest[i] - first) / (gap * i)); });
    k = Math.max(0, k);
    const starts = holds.map((_, i) => rt(Math.min(first + gap * i * k, Math.max(first, latest[i]))));
    const labelAt = starts.map((start, i) => (holds[i] > 0 ? rt(start + d * lag) : null));
    return {starts, draw: d, labelAt, dropped: dropped.sort((a, b) => a - b), latest: latest.map(rt)};
  }
  throw new Error('scheduleDraw: did not settle');
}

/** The latest scene-relative start a stroke may take and still give its label `hold` (0: no label). */
export function latestStart({hold, draw, lag = 0.8, lastEvent, readEnd}) {
  return rt(hold > 0 ? Math.min(lastEvent - draw, readEnd - draw * lag - hold) : lastEvent - draw);
}

// ---------------------------------------------------------------------------
// Geometry

/**
 * Scale and offset that fit `box` ({x, y, width, height} in drawing units)
 * inside `area` (px), keeping proportions and centring it. A box flat in one
 * direction (a single line) fits on the other.
 * Returns {s, ox, oy, map([x, y]) → [px, py]}.
 */
export function fitDrawing(box, area) {
  const sx = box.width > 1e-9 ? area.width / box.width : Infinity;
  const sy = box.height > 1e-9 ? area.height / box.height : Infinity;
  let s = Math.min(sx, sy);
  if (!Number.isFinite(s)) s = 1;
  const ox = area.x + (area.width - box.width * s) / 2 - box.x * s;
  const oy = area.y + (area.height - box.height * s) / 2 - box.y * s;
  return {s, ox, oy, map: ([x, y]) => [ox + x * s, oy + y * s]};
}

/**
 * A straight or bent line from P to Q: a quadratic whose control sits off
 * the midpoint by `bend` × the length (−1–1; 0 is straight).
 * {at(s), tangent(s) (unit), C (the control point), length (approximate)}.
 */
export function lineCurve(P, Q, bend = 0) {
  const mx = (P[0] + Q[0]) / 2, my = (P[1] + Q[1]) / 2, dx = Q[0] - P[0], dy = Q[1] - P[1];
  const len = Math.hypot(dx, dy) || 1;
  const C = [mx - dy / len * bend * len, my + dx / len * bend * len];
  const at = s => [(1 - s) ** 2 * P[0] + 2 * (1 - s) * s * C[0] + s * s * Q[0], (1 - s) ** 2 * P[1] + 2 * (1 - s) * s * C[1] + s * s * Q[1]];
  const tangent = s => { const tx = 2 * (1 - s) * (C[0] - P[0]) + 2 * s * (Q[0] - C[0]), ty = 2 * (1 - s) * (C[1] - P[1]) + 2 * s * (Q[1] - C[1]); const l = Math.hypot(tx, ty) || 1; return [tx / l, ty / l]; };
  return {at, tangent, C, length: len * (1 + 0.6 * bend * bend)};
}

/** `n` + 1 evenly spaced samples of a curve, as [x, y] points. */
export function sampleCurve(curve, n = 24) {
  return Array.from({length: n + 1}, (_, k) => curve.at(k / n));
}

/** The bounding box of a list of [x, y] points. */
export function boundsOf(points) {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return {x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y};
}

/** Does segment P→Q pass within `pad` of rect r ({x, y, width, height})? (Liang–Barsky on the padded rect.) */
export function segmentHitsRect(P, Q, r, pad = 0) {
  const x0 = r.x - pad, y0 = r.y - pad, x1 = r.x + r.width + pad, y1 = r.y + r.height + pad;
  const dx = Q[0] - P[0], dy = Q[1] - P[1];
  let t0 = 0, t1 = 1;
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, P[0] - x0) && clip(dx, x1 - P[0]) && clip(-dy, P[1] - y0) && clip(dy, y1 - P[1]) && t0 <= t1;
}

/** Does any stroke ({points, half}) come within its half-width plus `clearance` of rect r? */
export function strokesHitRect(strokes, r, clearance = 0) {
  for (const stroke of strokes) {
    const pts = stroke.points;
    for (let i = 1; i < pts.length; i++) if (segmentHitsRect(pts[i - 1], pts[i], r, stroke.half + clearance)) return true;
    if (pts.length === 1 && segmentHitsRect(pts[0], pts[0], r, stroke.half + clearance)) return true;
  }
  return false;
}

/** Does a disc ({x, y, r}) come within `clearance` of rect r? */
export function discHitsRect(disc, rect, clearance = 0) {
  const cx = Math.max(rect.x, Math.min(disc.x, rect.x + rect.width)), cy = Math.max(rect.y, Math.min(disc.y, rect.y + rect.height));
  return Math.hypot(disc.x - cx, disc.y - cy) < disc.r + clearance;
}

const rectsOverlap = (a, b, pad = 0) => a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad;
const inside = (r, bounds) => r.x >= bounds.x - 1e-6 && r.y >= bounds.y - 1e-6 && r.x + r.width <= bounds.x + bounds.width + 1e-6 && r.y + r.height <= bounds.y + bounds.height + 1e-6;

/**
 * Candidate label centres beside a stroke: at fractions `along` of a curve
 * (at(s) → [x, y], tangent(s) → unit [tx, ty]), the preferred side (away
 * from the drawing's centre) first, stepping outward. Each keeps its anchor on the
 * stroke for a leader line.
 */
export function strokeCandidates(curve, w, h, {along = [0.5, 0.38, 0.62, 0.26, 0.74, 0.15, 0.85], side = 1, offsets}) {
  const out = [];
  for (const sd of [side, -side]) for (const d of offsets) for (const s of along) {
    const [x, y] = curve.at(s), [tx, ty] = curve.tangent(s);
    const nx = -ty * sd, ny = tx * sd;
    const ext = Math.abs(nx) * w / 2 + Math.abs(ny) * h / 2;
    out.push({cx: x + nx * (d + ext), cy: y + ny * (d + ext), anchor: [x, y], d});
  }
  return out;
}

/** Candidate label centres round a point: right, left, above, below, then the diagonals, stepping outward. */
export function pointCandidates([x, y], w, h, {offsets}) {
  const dirs = [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]];
  const out = [];
  for (const d of offsets) for (const [dx, dy] of dirs) {
    const ex = dx ? w / 2 : 0, ey = dy ? h / 2 : 0;
    const k = dx && dy ? Math.SQRT1_2 : 1;
    out.push({cx: x + dx * (d * k + ex), cy: y + dy * (d * k + ey), anchor: [x, y], d});
  }
  return out;
}

/**
 * Far candidates for a label that cannot sit beside its stroke: centres on
 * rings round `anchor` (16 directions a ring), nearest ring first; the
 * label then hangs off a leader line.
 */
export function ringCandidates(anchor, w, h, {radii}) {
  const out = [];
  for (const radius of radii) for (let k = 0; k < 16; k++) {
    const a = k * Math.PI / 8, dx = Math.cos(a), dy = Math.sin(a);
    const ext = Math.abs(dx) * w / 2 + Math.abs(dy) * h / 2;
    out.push({cx: anchor[0] + dx * (radius + ext), cy: anchor[1] + dy * (radius + ext), anchor, d: radius});
  }
  return out;
}

/**
 * Candidates in the clear bands round the drawing (`box`, px), where a
 * technical drawing puts its callouts: above, below, left and right of it,
 * `gap` off its edge, lined up with each anchor. Each hangs off a leader.
 */
export function bandCandidates(anchors, box, w, h, {gap}) {
  const out = [];
  const clampX = x => Math.max(box.x + w / 2 - w, Math.min(box.x + box.width - w / 2 + w, x));
  const clampY = y => Math.max(box.y, Math.min(box.y + box.height, y));
  for (const anchor of anchors) {
    out.push({cx: clampX(anchor[0]), cy: box.y - gap - h / 2, anchor});
    out.push({cx: clampX(anchor[0]), cy: box.y + box.height + gap + h / 2, anchor});
    out.push({cx: box.x - gap - w / 2, cy: clampY(anchor[1]), anchor});
    out.push({cx: box.x + box.width + gap + w / 2, cy: clampY(anchor[1]), anchor});
  }
  return out.map(c => ({...c, d: Math.hypot(c.cx - c.anchor[0], c.cy - c.anchor[1])})).sort((a, b) => a.d - b.d);
}

/** Distance from point P to segment A→B. */
function pointSegment(P, A, B) {
  const dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / l2)) : 0;
  return Math.hypot(P[0] - A[0] - t * dx, P[1] - A[1] - t * dy);
}

/** Distance from rect r to a stroke's centre line (0 when it crosses the rect). */
export function rectStrokeDistance(r, stroke) {
  const pts = stroke.points;
  const corners = [[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height]];
  let best = Infinity;
  for (let k = 0; k < Math.max(1, pts.length - 1); k++) {
    const A = pts[k], B = pts[Math.min(k + 1, pts.length - 1)];
    if (segmentHitsRect(A, B, r, 0)) return 0;
    for (const P of [A, B]) { const q = nearestOnRect(P, r); best = Math.min(best, Math.hypot(P[0] - q[0], P[1] - q[1])); }
    for (const C of corners) best = Math.min(best, pointSegment(C, A, B));
  }
  return best;
}

/** Do segments P→Q and A→B cross (strictly)? */
export function segmentsCross(P, Q, A, B) {
  const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  return o(P, Q, A) * o(P, Q, B) < 0 && o(A, B, P) * o(A, B, Q) < 0;
}

/** How many strokes (other than index `own`) a leader from `anchor` to `box` crosses. */
export function leaderCrossings(anchor, box, strokes, own = -1) {
  const end = nearestOnRect(anchor, box);
  let n = 0;
  strokes.forEach((stroke, i) => {
    if (i === own) return;
    const pts = stroke.points;
    for (let k = 1; k < pts.length; k++) if (segmentsCross(anchor, end, pts[k - 1], pts[k])) { n++; return; }
  });
  return n;
}

/**
 * The best candidate whose box (w × h, centred on it) sits inside `bounds`
 * and clear of every stroke, dot and box by `clearance`: the first one in
 * order whose leader (needed past `leaderAt` from the anchor) crosses no
 * other stroke, else the first clear one. Without a clear one, the one
 * inside the bounds that touches the fewest strokes (the label's backing
 * then covers them). A label set close beside its stroke but nearer another
 * one would read as that one's, so it takes a leader too (leader: true).
 * Returns {x, y, width, height, anchor, d, clear, leader}.
 */
export function placeLabel({w, h, candidates, strokes = [], discs = [], boxes = [], bounds, clearance = 0, own = -1, leaderAt = Infinity}) {
  let fallback = null, fallbackHits = Infinity, crossing = null;
  for (const c of candidates) {
    const box = {x: c.cx - w / 2, y: c.cy - h / 2, width: w, height: h};
    if (bounds && !inside(box, bounds)) continue;
    if (boxes.some(other => rectsOverlap(box, other, clearance))) continue;
    const hits = strokes.filter(stroke => strokesHitRect([stroke], box, clearance)).length + discs.filter(disc => discHitsRect(disc, box, clearance)).length;
    if (!hits) {
      let leader = c.d > leaderAt;
      if (!leader && own >= 0 && strokes[own]) {
        const mine = rectStrokeDistance(box, strokes[own]);
        leader = strokes.some((stroke, i) => i !== own && rectStrokeDistance(box, stroke) <= mine + clearance);
      }
      const spot = {x: r2(box.x), y: r2(box.y), width: r2(w), height: r2(h), anchor: c.anchor, d: c.d, clear: true, leader};
      if (!leader || !leaderCrossings(c.anchor, box, strokes, own)) return spot;
      crossing ??= spot;
      continue;
    }
    if (hits < fallbackHits) { fallback = {...box, anchor: c.anchor, d: c.d}; fallbackHits = hits; }
  }
  if (crossing) return crossing;
  if (!fallback) {
    const c = candidates[0];
    fallback = {x: c.cx - w / 2, y: c.cy - h / 2, width: w, height: h, anchor: c.anchor, d: c.d};
    if (bounds) {
      fallback.x = Math.max(bounds.x, Math.min(bounds.x + bounds.width - w, fallback.x));
      fallback.y = Math.max(bounds.y, Math.min(bounds.y + bounds.height - h, fallback.y));
    }
  }
  return {x: r2(fallback.x), y: r2(fallback.y), width: r2(w), height: r2(h), anchor: fallback.anchor, d: fallback.d, clear: false, leader: fallback.d > leaderAt};
}

/** The point on rect r nearest to P (where a leader line meets the label). */
export function nearestOnRect(P, r) {
  return [Math.max(r.x, Math.min(P[0], r.x + r.width)), Math.max(r.y, Math.min(P[1], r.y + r.height))];
}

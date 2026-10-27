// Evidence capture, step 3: the beats as a frame-pure timeline.
//
// The capture (src/evidence/capture.js) freezes the page, measures every beat
// target (CSS px on the full page; a text target is one rect per line) and
// takes one full-page screenshot. buildTimeline() turns the beats and those
// rects into explicit segments: camera moves, cursor glides, selection and
// highlight sweeps, the focus ring's steps and date pins. stateAt(timeline,
// t) reads them at any time t, with no state carried between frames, so a
// frame is the same however often or in whatever order it is drawn, and a
// re-run of the same page gives the same clip.
//
// This file has no imports: the player page (src/evidence/player.js) inlines
// its source, so the browser and the tests run the same code.
//
// Camera. {cx, cy, s}: the page point at the centre of the window and the
// zoom (1 = the page at its own width). It eases between keys on
// easeInOutSine (still at both ends, no mid-move lurch), the scale in log
// space so a zoom reads at an even rate. scroll keeps the zoom and brings the
// target to the upper third; zoom frames the target (at most 0.62 of the
// window, 1–2.6×, or beat.zoom); every other targeted beat pans only when
// its target is not already well inside the window, and starts its effect
// once the pan lands.

const PAN = 0.6;          // s, the implicit pan before a beat whose target is off screen
const ZOOM_FILL = 0.62;   // zoom: the target fills at most this much of the window
const ZOOM_MAX = 2.6;
const MARGIN = 0.08;      // a target closer than this (fraction of the window) to its edge counts as off screen
const RING_PAD = 6;       // px round a focus-ring target (page CSS px)
const MARK_PAD = 2;

export const EVIDENCE_TIMELINE_CONSTANTS = Object.freeze({ PAN, ZOOM_FILL, ZOOM_MAX, MARGIN, RING_PAD });

const ease = (p) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, p)))) / 2;
const easeOutBack = (p) => { const c = 1.70158; const q = Math.min(1, Math.max(0, p)) - 1; return 1 + (c + 1) * q * q * q + c * q * q; };
const r2 = (v) => Math.round(v * 100) / 100;
const lerp = (a, b, p) => a + (b - a) * p;

/** The smallest box round a list of rects. */
export function unionRect(rects) {
  if (!rects?.length) return null;
  const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.width)), y1 = Math.max(...rects.map((r) => r.y + r.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Keep a camera inside the page: the window never shows past its edges. */
export function clampCamera(cam, win, page) {
  const s = Math.max(1, cam.s);
  const halfW = win.width / s / 2, halfH = win.height / s / 2;
  const cx = page.width <= halfW * 2 ? page.width / 2 : Math.min(Math.max(cam.cx, halfW), page.width - halfW);
  const cy = page.height <= halfH * 2 ? halfH : Math.min(Math.max(cam.cy, halfH), page.height - halfH);
  return { cx: r2(cx), cy: r2(cy), s: Math.round(s * 1e4) / 1e4 };
}

/** The page rect the window shows through a camera. */
export function viewOf(cam, win) {
  const w = win.width / cam.s, h = win.height / cam.s;
  return { x: cam.cx - w / 2, y: cam.cy - h / 2, width: w, height: h };
}

/** A page point → window px through a camera. */
export function toWindow(point, cam, win) {
  const v = viewOf(cam, win);
  return { x: (point.x - v.x) * cam.s, y: (point.y - v.y) * cam.s };
}

function inView(box, cam, win) {
  const v = viewOf(cam, win);
  const mx = v.width * MARGIN, my = v.height * MARGIN;
  return box.x >= v.x + mx * 0.25 && box.x + box.width <= v.x + v.width - mx * 0.25 && box.y >= v.y + my && box.y + box.height <= v.y + v.height - my;
}

/** A deterministic bend per beat (a hand never moves in a straight line). */
function bendFor(index) {
  const x = Math.sin((index + 1) * 12.9898) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2;
}

/**
 * Beats with measured rects → the timeline stateAt() reads.
 * input: {viewport: {width, height}, chrome: px of browser chrome above the
 * page, page: {width, height} of the screenshot in CSS px, beats: [{index,
 * action, at, dur, label?, zoom?, rects: [{x, y, width, height}]}], duration}.
 */
export function buildTimeline({ viewport, chrome = 0, page, beats, duration }) {
  const win = { width: viewport.width, height: viewport.height - chrome };
  let cam = clampCamera({ cx: page.width / 2, cy: 0, s: 1 }, win, page);
  const cameraKeys = [{ t0: 0, t1: 0, from: cam, to: cam }];
  const cursor = [];             // {t0, t1, from, to, bend} in window px
  const selections = [];         // {t0, t1, rects, until}
  const highlights = [];         // {t0, t1, rects}
  const ring = [];               // {t0, t1, from (rect | null), to}
  const pins = [];               // {t, label, rect | null (window corner)}
  const effects = [];            // per beat: {index, action, start, end, box}
  let cursorPos = null, lastRing = null, camFree = 0;

  const move = (t0, t1, to) => {
    const target = clampCamera(to, win, page);
    if (Math.abs(target.cx - cam.cx) < 0.5 && Math.abs(target.cy - cam.cy) < 0.5 && Math.abs(target.s - cam.s) < 1e-3) return t0;
    const start = Math.max(t0, camFree);
    const end = Math.max(start + 0.2, t1);
    cameraKeys.push({ t0: start, t1: end, from: cam, to: target });
    cam = target;
    camFree = end;
    return end;
  };

  for (const beat of beats) {
    const rects = (beat.rects ?? []).filter((r) => r.width > 0 && r.height > 0);
    const box = unionRect(rects);
    const at = beat.at, end = at + beat.dur;
    let start = at;
    if (beat.action === "scroll" && box) {
      // The target's top lands a quarter of the way down the window.
      move(at, end, { cx: cam.s > 1 ? box.x + box.width / 2 : cam.cx, cy: box.y + (win.height / cam.s) * 0.25, s: cam.s });
      start = end;
    } else if (beat.action === "zoom" && box) {
      const s = beat.zoom ?? Math.min(ZOOM_MAX, Math.max(1, Math.min((ZOOM_FILL * win.width) / box.width, (ZOOM_FILL * win.height) / box.height)));
      move(at, end, { cx: box.x + box.width / 2, cy: box.y + box.height / 2, s });
      start = end;
    } else if (box && !inView(box, cam, win)) {
      const panEnd = move(at, at + Math.min(PAN, beat.dur * 0.5), { cx: box.x + box.width / 2, cy: box.y + box.height / 2, s: cam.s });
      start = Math.min(panEnd, end - 0.2);
    }
    const effectEnd = Math.max(start + 0.2, end);
    if (beat.action === "cursor" && box) {
      const point = toWindow({ x: box.x + Math.min(box.width * 0.5, 40), y: box.y + box.height * 0.55 }, cam, win);
      const from = cursorPos ?? { x: point.x + win.width * 0.18, y: point.y + win.height * 0.22 };
      cursor.push({ t0: start, t1: effectEnd, from, to: point, bend: bendFor(beat.index), appear: cursorPos === null });
      cursorPos = point;
    } else if (beat.action === "select" && box) {
      if (selections.length) selections.at(-1).until = start;
      selections.push({ t0: start, t1: effectEnd, rects, until: Infinity });
      if (cursorPos) {
        // The cursor drags across the phrase with the selection's head.
        const first = rects[0], last = rects.at(-1);
        const a = toWindow({ x: first.x, y: first.y + first.height * 0.6 }, cam, win), b = toWindow({ x: last.x + last.width, y: last.y + last.height * 0.6 }, cam, win);
        cursor.push({ t0: Math.max(at, start - 0.35), t1: start, from: cursorPos, to: a, bend: bendFor(beat.index), appear: false });
        cursor.push({ t0: start, t1: effectEnd, from: a, to: b, bend: 0, appear: false, sweep: rects.map((r) => ({ ...r })), cam: { ...cam } });
        cursorPos = b;
      }
    } else if (beat.action === "highlight" && box) {
      highlights.push({ t0: start, t1: effectEnd, rects });
    } else if (beat.action === "focus-ring" && box) {
      const to = { x: box.x - RING_PAD, y: box.y - RING_PAD, width: box.width + RING_PAD * 2, height: box.height + RING_PAD * 2 };
      ring.push({ t0: start, t1: Math.min(effectEnd, start + Math.max(0.25, Math.min(0.7, beat.dur))), from: lastRing, to });
      lastRing = to;
    } else if (beat.action === "pin") {
      pins.push({ t: start, dur: Math.min(0.5, beat.dur), label: beat.label, rect: box });
    }
    effects.push({ index: beat.index, action: beat.action, start: r2(start), end: r2(effectEnd), box });
  }
  return { win, chrome, page, viewport, duration, cameraKeys, cursor, selections, highlights, ring, pins, effects };
}

/** The camera at time t. */
export function cameraAt(timeline, t) {
  const keys = timeline.cameraKeys;
  let k = keys[0];
  for (const key of keys) if (key.t0 <= t) k = key;
  if (t >= k.t1) return k.to;
  const p = ease((t - k.t0) / (k.t1 - k.t0));
  return { cx: r2(lerp(k.from.cx, k.to.cx, p)), cy: r2(lerp(k.from.cy, k.to.cy, p)), s: Math.round(Math.exp(lerp(Math.log(k.from.s), Math.log(k.to.s), p)) * 1e4) / 1e4 };
}

// How much of a list of line rects a sweep has covered at progress p: the
// lines fill in reading order at an even speed in px.
function sweepRects(rects, p) {
  const total = rects.reduce((sum, r) => sum + r.width, 0);
  let left = total * Math.min(1, Math.max(0, p));
  const out = [];
  for (const r of rects) {
    if (left <= 0) break;
    const w = Math.min(r.width, left);
    out.push({ x: r.x, y: r.y, width: w, height: r.height });
    left -= w;
  }
  return out;
}

/**
 * Everything on screen at time t: {camera, cursor: {x, y, opacity, down} |
 * null (window px), selection: [rect] (page px), highlights: [[rect]],
 * ring: {rect, opacity, scale} | null, pins: [{label, rect | null, opacity, scale}]}.
 */
export function stateAt(timeline, t) {
  const camera = cameraAt(timeline, t);
  let cursor = null;
  for (const seg of timeline.cursor) {
    if (t < seg.t0) break;
    if (seg.sweep) {
      // Ride the selection's head so the cursor stays on the text as it grows.
      const p = ease((t - seg.t0) / (seg.t1 - seg.t0));
      const shown = sweepRects(seg.sweep, Math.min(1, (t - seg.t0) / (seg.t1 - seg.t0)));
      const head = shown.at(-1) ?? seg.sweep[0];
      const point = toWindow({ x: head.x + head.width, y: head.y + head.height * 0.6 }, seg.cam, timeline.win);
      cursor = { x: r2(t >= seg.t1 ? seg.to.x : point.x), y: r2(t >= seg.t1 ? seg.to.y : point.y), opacity: 1, down: t < seg.t1 && p < 1 };
      continue;
    }
    const raw = Math.min(1, (t - seg.t0) / Math.max(1e-6, seg.t1 - seg.t0));
    const p = ease(raw);
    const dx = seg.to.x - seg.from.x, dy = seg.to.y - seg.from.y, d = Math.hypot(dx, dy) || 1;
    const arc = Math.sin(Math.PI * p) * seg.bend * Math.min(90, d * 0.16);
    cursor = { x: r2(seg.from.x + dx * p + (-dy / d) * arc), y: r2(seg.from.y + dy * p + (dx / d) * arc), opacity: seg.appear ? r2(Math.min(1, raw * 3)) : 1, down: false };
  }
  let selection = [];
  for (const sel of timeline.selections) {
    if (t < sel.t0 || t >= sel.until) continue;
    selection = sweepRects(sel.rects, (t - sel.t0) / (sel.t1 - sel.t0));
  }
  const highlights = timeline.highlights.filter((h) => t >= h.t0).map((h) => sweepRects(h.rects.map((r) => ({ x: r.x - MARK_PAD, y: r.y, width: r.width + MARK_PAD * 2, height: r.height })), ease((t - h.t0) / (h.t1 - h.t0))));
  let ring = null;
  for (const step of timeline.ring) {
    if (t < step.t0) break;
    const p = ease((t - step.t0) / (step.t1 - step.t0));
    if (!step.from) {
      const grow = Math.min(1, (t - step.t0) / Math.max(1e-6, step.t1 - step.t0));
      ring = { rect: step.to, opacity: r2(Math.min(1, grow * 2)), scale: r2(1.08 - 0.08 * ease(grow)) };
    } else {
      const f = step.from, g = step.to;
      ring = { rect: { x: r2(lerp(f.x, g.x, p)), y: r2(lerp(f.y, g.y, p)), width: r2(lerp(f.width, g.width, p)), height: r2(lerp(f.height, g.height, p)) }, opacity: 1, scale: 1 };
    }
  }
  const pins = timeline.pins.filter((pin) => t >= pin.t).map((pin) => {
    const p = Math.min(1, (t - pin.t) / pin.dur);
    return { label: pin.label, rect: pin.rect, opacity: r2(Math.min(1, p * 2)), scale: r2(0.6 + 0.4 * easeOutBack(p)) };
  });
  return { camera, cursor, selection, highlights, ring, pins };
}

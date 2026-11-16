// The before-and-after wipe: a handle drags across the frame and the other
// version (the incoming scene) is revealed behind it, with slow→fast→slow
// easing and no overshoot, optionally pausing mid-way so the two versions
// sit side by side. Used two ways:
//
// - as a transition, scene.in = {type: "before-after", dur, direction?,
//   pause?, labels?} (track-0 scenes, 1–2 s): the incoming plate is clipped
//   to the revealed side (kit/core/transitions.mjs, the wipe insets) and this
//   file draws the handle and the side labels over every scene. Both
//   renderers drive one custom property, --lc-ba (the revealed share, 0 → 1),
//   from beforeAfterSteps, so the clip, the handle and the labels agree.
// - in a scene, the before-after media layout
//   (kit/core/catalog-d-media-layouts.mjs): two sources, or one with a grade
//   on one side, and a handle that can pause and reverse (beforeAfterMoves).
//
// Plain ESM; imports only ./motion.mjs. Canonical copy: kit/core/before-after.mjs.
// Contract: docs/KIT_CONTRACTS.md, "Before-and-after wipe".
//
//   direction  where the handle travels (the content's way, as glow-wipe):
//              "left" (default: the after side opens from the right edge,
//              before stays on the left), "right", "up", "down"
//   pause      seconds the handle rests half-way (default 0), at most
//              half the transition
//   labels     {before?, after?}: a word on each side (≤ 24 characters)

import { getEase } from './motion.mjs';

export const BEFORE_AFTER = Object.freeze({
  // Slow → fast → slow, symmetric, no overshoot.
  ease: 'power2.inOut',
  // Where a pause rests (the revealed share).
  mid: 0.5,
  // The handle (px at 1080 on the short side): the line's width, the knob's
  // diameter, and how fast it fades in from either edge (share of the frame).
  line: 4, knob: 92, fadeEdge: 0.06,
  // The labels: size (px at 1080), the margin from the frame's edges and the
  // band they sit in (a share of the frame's height: the top, and just under
  // the middle for the lower side of a vertical wipe, above the captions).
  label: Object.freeze({ size: 44, margin: 64, top: 0.1, lower: 0.56 }),
  directions: Object.freeze(['left', 'right', 'up', 'down']),
  defaults: Object.freeze({ direction: 'left', pause: 0 }),
  // Over every scene, under the medium, the brand frame and the captions (as dot-wipe).
  z: Object.freeze({ hyperframes: 79000, remotion: 48 })
});

const round = (value, digits = 3) => { const f = 10 ** digits; return Math.round(value * f) / f + 0; };
const escape = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/**
 * The handle's legs over a transition of `dur` seconds with `pause` seconds
 * at the middle: one eased move 0 → 1, or 0 → mid, rest, mid → 1.
 * → [{start, duration, from, to}] (start relative to the transition)
 */
export function beforeAfterSteps(dur, pause = 0) {
  const rest = Math.min(Math.max(0, Number(pause) || 0), dur / 2);
  if (!(rest > 0)) return [{ start: 0, duration: round(dur, 6), from: 0, to: 1 }];
  const leg = round((dur - rest) / 2, 6), mid = BEFORE_AFTER.mid;
  return [{ start: 0, duration: leg, from: 0, to: mid }, { start: round(leg + rest, 6), duration: leg, from: mid, to: 1 }];
}

/**
 * The revealed share at time t (relative) along moves [{start, duration,
 * from, to}], as GSAP renders them: before the first, its from; between
 * two, the earlier's to; eased with BEFORE_AFTER.ease.
 */
export function moveValue(moves, t, ease = BEFORE_AFTER.ease) {
  let value = moves[0]?.from ?? 0;
  for (const move of moves) {
    if (t < move.start) break;
    const p = move.duration > 0 ? Math.min(1, (t - move.start) / move.duration) : 1;
    value = move.from + (move.to - move.from) * (p >= 1 ? 1 : getEase(ease)(p));
  }
  return round(value, 6);
}

/** The revealed share (0 → 1) of one transition wipe at absolute t. */
export function beforeAfterAt(wipe, t) {
  return moveValue(beforeAfterSteps(wipe.dur, wipe.pause), t - wipe.start);
}

/**
 * The geometry of a wipe in `direction` on a width × height frame: the axis
 * the handle travels, where it starts and its span (seam = start + share ×
 * span, px), the inset side the after side opens from and the opposite one.
 */
export function beforeAfterAxis(direction, width, height) {
  const x = direction !== 'up' && direction !== 'down';
  const span = x ? width : height;
  const back = direction === 'left' || direction === 'up';
  return { axis: x ? 'x' : 'y', origin: back ? span : 0, span: back ? -span : span,
    after: { left: 'left', right: 'right', up: 'top', down: 'bottom' }[direction] ?? 'left',
    before: { left: 'right', right: 'left', up: 'bottom', down: 'top' }[direction] ?? 'right' };
}

// clip-path inset() with one side driven by an expression (a CSS calc).
function insetCss(side, value) {
  const sides = { top: '0', right: '0', bottom: '0', left: '0' };
  sides[side] = value;
  return `inset(${sides.top} ${sides.right} ${sides.bottom} ${sides.left})`;
}

/**
 * The markup (a string both renderers parse the same) of the handle and the
 * labels over a width × height frame, all driven by --lc-ba (the revealed
 * share) on the element that holds it: each label is clipped to its side,
 * the handle sits on the seam and fades in off the edges.
 * opts: {direction, labels: {before?, after?}, prop: the custom property (default --lc-ba)}
 */
export function beforeAfterHtml(width, height, { direction = BEFORE_AFTER.defaults.direction, labels = null, prop = '--lc-ba' } = {}) {
  const u = Math.min(width, height) / 1080;
  const g = beforeAfterAxis(direction, width, height);
  const v = `var(${prop})`;
  const L = BEFORE_AFTER.label;
  const size = round(L.size * u, 2), margin = round(L.margin * u, 2);
  const label = (side, text) => {
    if (!text) return '';
    // Horizontal: both on the top band, before and after at their own edges.
    // Vertical: at the left margin, the first side on top, the other under the middle.
    const first = g.axis === 'x' ? (side === 'before') === (g.before === 'right') : (side === 'before') === (g.before === 'bottom');
    const pos = g.axis === 'x'
      ? (first ? `left:${margin}px;` : `right:${margin}px;text-align:right;`) + `top:${round(L.top * height, 2)}px;`
      : `left:${margin}px;top:${round((first ? L.top : L.lower) * height, 2)}px;`;
    const clip = side === 'after' ? insetCss(g.after, `calc((1 - ${v}) * 100%)`) : insetCss(g.before, `calc(${v} * 100%)`);
    return `<div class="lc-ba-side" data-side="${side}" style="position:absolute;left:0;top:0;width:${width}px;height:${height}px;clip-path:${clip}"><div class="lc-ba-label" style="position:absolute;${pos}margin:0;white-space:nowrap;font-family:var(--lc-font-display, sans-serif);font-size:${size}px;line-height:1.1;letter-spacing:0.06em;text-transform:uppercase;color:#ffffff;text-shadow:0 ${round(2 * u, 2)}px ${round(18 * u, 2)}px rgba(0,0,0,0.65)">${escape(text)}</div></div>`;
  };
  const line = round(BEFORE_AFTER.line * u, 2), knob = round(BEFORE_AFTER.knob * u, 2);
  const shadow = `0 0 ${round(14 * u, 2)}px rgba(0,0,0,0.45)`;
  const fade = `clamp(0, min(${v}, 1 - ${v}) / ${BEFORE_AFTER.fadeEdge}, 1)`;
  const move = `calc(${g.origin}px + ${v} * ${g.span}px)`;
  const handle = g.axis === 'x'
    ? `left:${round(-line / 2, 2)}px;top:0;width:${line}px;height:${height}px;transform:translate(${move}, 0)`
    : `left:0;top:${round(-line / 2, 2)}px;width:${width}px;height:${line}px;transform:translate(0, ${move})`;
  const knobPos = g.axis === 'x' ? `left:${round(line / 2 - knob / 2, 2)}px;top:${round(height / 2 - knob / 2, 2)}px` : `left:${round(width / 2 - knob / 2, 2)}px;top:${round(line / 2 - knob / 2, 2)}px`;
  // Two chevrons pointing along the axis.
  const chevrons = `<svg width="${knob}" height="${knob}" viewBox="0 0 92 92" style="position:absolute;left:0;top:0;display:block${g.axis === 'y' ? ';transform:rotate(90deg)' : ''}"><path d="M38 32 L24 46 L38 60 M54 32 L68 46 L54 60" fill="none" stroke="#111111" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `${label('before', labels?.before)}${label('after', labels?.after)}<div class="lc-ba-handle" style="position:absolute;${handle};background:#ffffff;box-shadow:${shadow};opacity:${fade}"><div class="lc-ba-knob" style="position:absolute;${knobPos};width:${knob}px;height:${knob}px;border-radius:50%;background:#ffffff;box-shadow:${shadow}">${chevrons}</div></div>`;
}

/**
 * The before-and-after wipes of a story: every track-0 window entry (and the
 * loop ending) that arrives with one, its options resolved.
 * windows: transitions.mjs sceneWindows.
 * → [{id, sceneId, start, dur, direction, pause, labels}]
 */
export function beforeAfterWipes(story, windows) {
  const options = (spec, dur) => {
    const own = spec && typeof spec === 'object' ? spec : {};
    const labels = own.labels && typeof own.labels === 'object' ? { before: own.labels.before ?? null, after: own.labels.after ?? null } : null;
    return { direction: own.direction ?? BEFORE_AFTER.defaults.direction, pause: round(Math.min(Math.max(0, Number(own.pause) || 0), dur / 2), 6), labels };
  };
  const out = [];
  for (const entry of windows?.scenes ?? []) {
    if (!entry.plate || entry.transitionIn?.type !== 'before-after' || !(entry.transitionIn.dur > 0)) continue;
    const dur = round(entry.transitionIn.dur, 6);
    out.push({ id: `lc-ba-${entry.id}`, sceneId: entry.id, start: round(entry.start, 6), dur, ...options(entry.scene?.in, dur) });
  }
  const loop = windows?.loop;
  if (loop?.transitionIn?.type === 'before-after' && loop.transitionIn.dur > 0) {
    const dur = round(loop.transitionIn.dur, 6);
    out.push({ id: `lc-ba-${loop.sceneId}-loop`, sceneId: `${loop.sceneId}-loop`, start: round(loop.start, 6), dur, ...options(story?.ending?.in, dur) });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * HyperFrames: the GSAP lines for one wipe on its element (#id): shown at its
 * start, --lc-ba tweened along beforeAfterSteps, hidden at its end.
 */
export function beforeAfterGsap(wipe) {
  const sel = JSON.stringify(`#${wipe.id}`);
  const n = (value) => round(value, 6);
  return [
    `tl.set(${sel}, { opacity: 1, "--lc-ba": 0 }, ${n(wipe.start)});`,
    ...beforeAfterSteps(wipe.dur, wipe.pause).map((s) => `tl.fromTo(${sel}, { "--lc-ba": ${s.from} }, { "--lc-ba": ${s.to}, duration: ${n(s.duration)}, ease: "${BEFORE_AFTER.ease}", immediateRender: false }, ${n(wipe.start + s.start)});`),
    `tl.set(${sel}, { opacity: 0 }, ${n(wipe.start + wipe.dur)});`
  ];
}

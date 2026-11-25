// Motion metrics for the per-frame rig R&D (docs/rd/per-frame-rig.md): the
// same measures on today's rig (joint positions by forward kinematics from
// the cast-scene op list, frameState at each frame) and on the per-frame rig
// prototype (rigFrame's joints), in canvas px at 30 fps.
//   node eval/per-frame-rig/metrics.mjs [today.resolved.json] [--json qa/per-frame-rig/metrics.json]
import {readFileSync, writeFileSync} from 'node:fs';
import {resolveModule} from '@launchclip/core/modules.mjs';
import {charactersTimeline} from '@launchclip/core/catalog-characters.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {hoseGeometry} from '@launchclip/core/characters/style-rubber-hose.mjs';
import {boneDrift, crossings, handCorners, jerk} from '@launchclip/core/characters/rig-metrics.mjs';
import {prototypePlan, rigScenePrepare, rigSceneState} from '@launchclip/core/characters/rig-scene.mjs';

const FPS = 30, DURATION = 8;
const THROW = [3.4, 5.4];
const WALK = [0.3, 1.9];
const RAD = Math.PI / 180;

// ---------------------------------------------------------------------------
// Skeletons per frame: {ankleL, ankleR, hipL, kneeL, …, wristL, …} in canvas px.

/** Today: forward kinematics over the op list's joint transforms (the drawing's own pivots, style-rubber-hose.mjs). */
export function todayFrames(story) {
  const model = resolveModule(story.scenes[0], story);
  const ops = charactersTimeline(model);
  const actor = model.content.actors[0];
  const cid = `${model.id}-c0`;
  const g = hoseGeometry(actor.params ?? actor.character?.params ?? actor.look?.params);
  const frames = [];
  for (let i = 0; i <= DURATION * FPS; i++) {
    const s = frameState(ops, i / FPS);
    const v = (part, key, d = 0) => s.get(`${cid}-${part}`)?.[key] ?? d;
    // A joint frame: translate(pivot), mirror, translate(x y) rotate(r) scale(sx sy) — as a 2×3 matrix.
    const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
    const T = (x, y) => [1, 0, 0, 1, x, y], R = d => [Math.cos(d * RAD), Math.sin(d * RAD), -Math.sin(d * RAD), Math.cos(d * RAD), 0, 0], S = (x, y) => [x, 0, 0, y, 0, 0];
    const joint = (parent, px, py, mirror, part) => [T(px, py), mirror ? S(-1, 1) : S(1, 1), T(v(part, 'x'), v(part, 'y')), R(v(part, 'rotation')), S(v(part, 'scaleX', 1), v(part, 'scaleY', 1))].reduce(mul, parent);
    const at = (M, x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
    const root = [T(actor.x + v('walk', 'x'), actor.floor), S(actor.scale, actor.scale)].reduce(mul);
    const body = joint(root, 0, 0, false, 'body');
    const out = {};
    for (const side of ['l', 'r']) {
      const S1 = side.toUpperCase(), mirror = side === 'r';
      const leg = joint(body, side === 'l' ? -g.legX : g.legX, g.hipY, mirror, `leg-${side}`);
      const shin = joint(leg, 0, g.thigh, false, `shin-${side}`);
      out[`hip${S1}`] = at(leg, 0, 0); out[`knee${S1}`] = at(shin, 0, 0); out[`ankle${S1}`] = at(shin, 0, g.shin);
      const torso = joint(body, 0, g.hipY, false, 'torso');
      const arm = joint(torso, side === 'l' ? -g.armX : g.armX, g.armY, mirror, `arm-${side}`);
      const fore = joint(arm, 0, g.upperArm, false, `fore-${side}`);
      out[`shoulder${S1}`] = at(arm, 0, 0); out[`elbow${S1}`] = at(fore, 0, 0); out[`wrist${S1}`] = at(fore, 0, g.foreArm);
    }
    frames.push(out);
  }
  return frames;
}

/** The per-frame rig: rigFrame's joints, placed as the prototype draws them. */
export function perFrameFrames(plan = prototypePlan()) {
  const prepared = rigScenePrepare(plan);
  const frames = [];
  for (let i = 0; i <= DURATION * FPS; i++) {
    const {actors: [{frame, at: {x, floor, scale}}]} = rigSceneState(plan, i / FPS, prepared);
    const out = {};
    for (const [k, p] of Object.entries(frame.joints)) out[k] = [x + p[0] * scale, floor + p[1] * scale];
    frames.push(out);
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Measures: the shipped ones (kit/core/characters/rig-metrics.mjs) over
// {joints} frames, plus two only this comparison needs (today has no planted
// flags, so its feet are judged by height; and the throw's bow).

const wrap = frames => frames.map(joints => ({joints}));

/**
 * Foot slide: horizontal travel of an ankle between frames while it is on the
 * ground (within 3 px of its lowest height) in both, during the walk window. → px
 */
export function footSlide(frames) {
  let total = 0;
  for (const k of ['ankleL', 'ankleR']) {
    const ground = Math.max(...frames.map(f => f[k][1]));
    for (let i = WALK[0] * FPS + 1; i <= WALK[1] * FPS; i++) {
      const a = frames[i - 1][k], b = frames[i][k];
      if (ground - a[1] < 3 && ground - b[1] < 3) total += Math.abs(b[0] - a[0]);
    }
  }
  return total;
}

/**
 * The throwing hand's path in the throw window: its travel, how far it bows
 * off the line between its two farthest points (sagitta / span; 0: a straight
 * line), and its corners (rig-metrics handCorners) in that window.
 */
export function handArc(frames, wrist) {
  const window = frames.slice(THROW[0] * FPS, THROW[1] * FPS + 1);
  const pts = window.map(f => f[wrist]);
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const {maxTurn, count: corners} = handCorners(wrap(window), [wrist]);
  let far = [pts[0], pts[0]], best = 0;
  for (const p of pts) for (const q of pts) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d > best) { best = d; far = [p, q]; } }
  const [p, q] = far, n = [-(q[1] - p[1]) / (best || 1), (q[0] - p[0]) / (best || 1)];
  const sag = Math.max(...pts.map(r => Math.abs((r[0] - p[0]) * n[0] + (r[1] - p[1]) * n[1])));
  return {travel: length, span: best, bow: best ? sag / best : 0, maxTurn, corners};
}

export function measure(frames) {
  const travel = k => frames.slice(THROW[0] * FPS, THROW[1] * FPS + 1).reduce((s, f, i, all) => (i ? s + Math.hypot(f[k][0] - all[i - 1][k][0], f[k][1] - all[i - 1][k][1]) : 0), 0);
  const wrist = travel('wristL') >= travel('wristR') ? 'wristL' : 'wristR';
  return {footSlide: footSlide(frames), jerk: jerk(wrap(frames), FPS), hand: {wrist, ...handArc(frames, wrist)}, crossings: crossings(wrap(frames)), boneDrift: boneDrift(wrap(frames)).px};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // The resolved storyboard render.sh writes (launchclip story resolve).
  const story = JSON.parse(readFileSync(process.argv.find(a => a.endsWith('.resolved.json')) ?? 'qa/per-frame-rig/today.resolved.json', 'utf8'));
  const today = measure(todayFrames(story)), perFrame = measure(perFrameFrames());
  const r = x => Math.round(x * 10) / 10;
  const rows = [
    ['foot slide while on the ground, walk (px)', r(today.footSlide), r(perFrame.footSlide)],
    ['joint jerk, RMS (deg/s³)', Math.round(today.jerk.rms), Math.round(perFrame.jerk.rms)],
    ['joint jerk per unit of motion (1/s²)', Math.round(today.jerk.perMotion), Math.round(perFrame.jerk.perMotion)],
    ['throw: hand travel (px)', r(today.hand.travel), r(perFrame.hand.travel)],
    ['throw: hand path bow (sagitta / span)', r(today.hand.bow * 100) / 100, r(perFrame.hand.bow * 100) / 100],
    ['throw: worst turn between frames (deg)', r(today.hand.maxTurn), r(perFrame.hand.maxTurn)],
    ['throw: corners (> 45° turn in a frame)', today.hand.corners, perFrame.hand.corners],
    ['frames with legs crossing (hips apart)', today.crossings.legs, perFrame.crossings.legs],
    ['frames with arms crossing (arm/arm, arm/leg)', `${today.crossings.arms}, ${today.crossings.armLeg}`, `${perFrame.crossings.arms}, ${perFrame.crossings.armLeg}`],
    ['bone length drift (px)', r(today.boneDrift), r(perFrame.boneDrift)]
  ];
  console.log('| measure | today | per-frame |\n|---|---|---|\n' + rows.map(row => `| ${row.join(' | ')} |`).join('\n'));
  const i = process.argv.indexOf('--json');
  if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify({today, perFrame}, null, 2) + '\n');
}


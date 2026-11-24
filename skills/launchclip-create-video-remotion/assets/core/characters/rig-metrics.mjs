// Motion metrics for the per-frame rig (docs/ANIMATION_MEASUREMENT.md,
// "Per-frame rig"; docs/rd/per-frame-rig.md §4). Pure: a rig-scene plan
// (content.rigScene, launchclip.rig-scene.v1) is sampled at the story's fps
// with rigFrame, and every measure reads those samples in canvas px.
//
//   sampleRigScene(plan, {fps, duration}) → {fps, actors: {id: [frame]}, props: {id: [sample]}}
//   measureRigScene(sampled)              → {actors: {id: measures}, props: {id: measures}}
//   rigFindings(measures, thresholds)     → [{rule, severity, actor|prop, at?, detail}]
//
// Imports only sibling kit/core files.

import {rigFrame} from './rig-frame.mjs';

const RAD = Math.PI / 180;
// Where a hand holds a prop: along the glove from the wrist (rig units), as the prototype's ball sits.
export const PALM = 50;

export const SEGMENTS = Object.freeze([['hipL', 'kneeL'], ['kneeL', 'ankleL'], ['hipR', 'kneeR'], ['kneeR', 'ankleR'], ['shoulderL', 'elbowL'], ['elbowL', 'wristL'], ['shoulderR', 'elbowR'], ['elbowR', 'wristR']]);
const LEG_SEGMENTS = 4;

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const angle = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]) / RAD;
const unwrap = list => list.reduce((out, a) => { const prev = out.at(-1); out.push(prev === undefined ? a : prev + ((a - prev + 540) % 360) - 180); return out; }, []);
const rms = xs => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / Math.max(1, xs.length));
const finite = p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const round = (v, k = 10) => Math.round(v * k) / k;
const xy = at => (Array.isArray(at) ? at : [at?.x, at?.y]).map(Number);

// ---------------------------------------------------------------------------
// Sampling

/**
 * One actor's frame in canvas px: joints, each foot's ground contact and
 * whether it is planted, each hand's palm (where it holds a prop).
 * frame: rigFrame's result; at: {x, floor, scale}.
 */
export function canvasFrame(frame, at) {
  const {x = 0, floor = 0, scale = 1} = at ?? {};
  const px = p => [x + p[0] * scale, floor + p[1] * scale];
  const joints = Object.fromEntries(Object.entries(frame.joints).map(([k, p]) => [k, px(p)]));
  // The foot's place on the ground plus whatever the leg missed its target by: a planted foot that slides moves this point.
  const feet = Object.fromEntries(['l', 'r'].map(s => {
    const leg = frame.legs?.[s];
    const miss = leg?.ankle && leg?.target ? [leg.ankle[0] - leg.target[0], leg.ankle[1] - leg.target[1]] : [0, 0];
    return [s, {planted: Boolean(leg?.planted), contact: px([(leg?.place ?? 0) + miss[0], miss[1]])}];
  }));
  const hands = Object.fromEntries(['l', 'r'].map(s => {
    const arm = frame.arms?.[s];
    const g = (arm?.glove ?? 0) * RAD;
    return [s, arm ? px([arm.wrist[0] + Math.sin(g) * PALM, arm.wrist[1] + Math.cos(g) * PALM]) : joints[`wrist${s.toUpperCase()}`]];
  }));
  return {joints, feet, hands};
}

/** Where a prop is at t (canvas px) and who holds it: its path's last key at or before t; between two `at` keys it moves in a line. */
export function propAt(prop, t, handOf) {
  const path = [...(prop.path ?? [])].sort((a, b) => a.t - b.t);
  if (!path.length) return {at: [NaN, NaN], holder: null};
  const i = Math.max(0, path.findLastIndex(k => k.t <= t + 1e-9));
  const k = path[i], next = path[i + 1];
  if (k.holder) return {at: handOf(k.holder), holder: k.holder};
  const a = xy(k.at);
  if (next?.at && next.t > k.t && t > k.t) {
    const b = xy(next.at), u = (t - k.t) / (next.t - k.t);
    return {at: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], holder: null, moving: true};
  }
  return {at: a, holder: null};
}

/**
 * A plan sampled at fps over [0, duration] (scene time).
 * options.frameOf(actor, t): the rig frame (default rigFrame(character, track, t)).
 */
export function sampleRigScene(plan, {fps = 30, duration, frameOf} = {}) {
  const actors = plan?.actors ?? [];
  const end = Number.isFinite(duration) ? duration : Math.max(0, ...actors.flatMap(a => [...(a.track?.walks ?? []).map(w => w.end), ...(a.track?.keys ?? []).map(k => k.t)]), ...(plan?.props ?? []).flatMap(p => (p.path ?? []).map(k => k.t)));
  const n = Math.floor(end * fps + 1e-6);
  const of = frameOf ?? ((actor, t) => rigFrame(actor.character, actor.track, t));
  const out = {fps, actors: {}, props: {}};
  for (const actor of actors) out.actors[actor.id] = Array.from({length: n + 1}, (_, i) => canvasFrame(of(actor, i / fps), actor.at));
  for (const prop of plan?.props ?? []) {
    out.props[prop.id] = Array.from({length: n + 1}, (_, i) => propAt(prop, i / fps, h => out.actors[h.actor]?.[i]?.hands[h.hand] ?? [NaN, NaN]));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Measures (frames: one actor's canvasFrame list)

/** Joints that are not finite numbers: [{at (frame), joint}]. */
export function nonFinite(frames) {
  const out = [];
  frames.forEach((f, i) => { for (const [k, p] of Object.entries(f.joints)) if (!finite(p)) out.push({frame: i, joint: k}); });
  return out;
}

/** Bone lengths: the largest change of any segment's length (px; 0 = rigid). → {px, bone} */
export function boneDrift(frames) {
  let worst = {px: 0, bone: null};
  for (const [a, b] of SEGMENTS) {
    const ls = frames.map(f => dist(f.joints[a], f.joints[b])).filter(Number.isFinite);
    const d = ls.length ? Math.max(...ls) - Math.min(...ls) : 0;
    if (d > worst.px) worst = {px: d, bone: `${a}-${b}`};
  }
  return worst;
}

/** Foot slide: per planted step (a run of planted frames of one foot), how far its ground contact moves from where it landed. → [{foot, from, to, px}] */
export function plantedSteps(frames) {
  const steps = [];
  for (const s of ['l', 'r']) {
    let run = null;
    frames.forEach((f, i) => {
      const foot = f.feet[s];
      if (!foot.planted) { run = null; return; }
      if (!run) steps.push(run = {foot: s, from: i, to: i, px: 0, start: foot.contact});
      run.to = i;
      run.px = Math.max(run.px, dist(foot.contact, run.start));
    });
  }
  return steps.map(({start, ...step}) => step);
}

/** Joint jerk: RMS third derivative of every segment's angle (deg/s³), and per unit of motion (÷ RMS angular speed, 1/s²). */
export function jerk(frames, fps) {
  const j3 = [], v1 = [];
  for (const [a, b] of SEGMENTS) {
    const th = unwrap(frames.map(f => angle(f.joints[a], f.joints[b])));
    for (let i = 3; i < th.length; i++) j3.push((th[i] - 3 * th[i - 1] + 3 * th[i - 2] - th[i - 3]) * fps ** 3);
    for (let i = 1; i < th.length; i++) v1.push((th[i] - th[i - 1]) * fps);
  }
  const speed = rms(v1);
  return {rms: rms(j3), perMotion: speed > 1e-9 ? rms(j3) / speed : 0};
}

/** Hand-path corners: frames where a moving wrist (> 2 px a frame) turns > 45°. → {count, maxTurn, frames: [i]} */
export function handCorners(frames, wrists = ['wristL', 'wristR']) {
  const out = {count: 0, maxTurn: 0, frames: []};
  for (const k of wrists) {
    const pts = frames.map(f => f.joints[k]);
    for (let i = 2; i < pts.length; i++) {
      if (dist(pts[i], pts[i - 1]) <= 2 || dist(pts[i - 1], pts[i - 2]) <= 2) continue;
      const turn = Math.abs(((angle(pts[i - 1], pts[i]) - angle(pts[i - 2], pts[i - 1]) + 540) % 360) - 180);
      out.maxTurn = Math.max(out.maxTurn, turn);
      if (turn > 45) { out.count++; out.frames.push(i); }
    }
  }
  return out;
}

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const intersects = (p1, p2, q1, q2) => cross(p1, p2, q1) * cross(p1, p2, q2) < 0 && cross(q1, q2, p1) * cross(q1, q2, p2) < 0;

/**
 * Frames where two limb segments cross (segments sharing a joint never
 * count). Legs passing each other side-on (both legs from one hip point) are
 * a walk, not a tangle, so legs/legs counts only when the hips are apart.
 * → {legs, arms, armLeg, first: frame of the first arm crossing}
 */
export function crossings(frames) {
  const out = {legs: 0, arms: 0, armLeg: 0, first: null};
  frames.forEach((f, n) => {
    const hit = {legs: false, arms: false, armLeg: false};
    const sideOn = dist(f.joints.hipL, f.joints.hipR) < 1;
    for (let i = 0; i < SEGMENTS.length; i++) for (let j = i + 1; j < SEGMENTS.length; j++) {
      const [a, b] = SEGMENTS[i], [c, d] = SEGMENTS[j];
      if (new Set([a, b, c, d]).size < 4) continue;
      const legI = i < LEG_SEGMENTS, legJ = j < LEG_SEGMENTS;
      if (legI && legJ && sideOn) continue;
      if (!intersects(f.joints[a], f.joints[b], f.joints[c], f.joints[d])) continue;
      hit[legI && legJ ? 'legs' : !legI && !legJ ? 'arms' : 'armLeg'] = true;
    }
    for (const k of ['legs', 'arms', 'armLeg']) if (hit[k]) out[k]++;
    if ((hit.arms || hit.armLeg) && out.first === null) out.first = n;
  });
  return out;
}

/**
 * A prop's path: grip loss (how far the prop jumps when a hand takes it or
 * lets it go: the hand was not where the prop was) and teleports (a jump of
 * more than teleportPx in one frame while nobody holds it, except a move
 * between two `at` keys slower than that). → {grip: [{frame, px}], teleports: [{frame, px}]}
 */
export function propMeasures(samples, {teleportPx = 120} = {}) {
  const grip = [], teleports = [];
  const same = (a, b) => (a?.actor ?? null) === (b?.actor ?? null) && (a?.hand ?? null) === (b?.hand ?? null);
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const jump = dist(a.at, b.at);
    if (!same(a.holder, b.holder)) grip.push({frame: i, px: jump});
    else if (!b.holder && !(jump <= teleportPx)) teleports.push({frame: i, px: jump});
  }
  return {grip, teleports};
}

/** Every measure for a sampled scene. */
export function measureRigScene(sampled, thresholds = {}) {
  const {fps} = sampled;
  const actors = {}, props = {};
  for (const [id, frames] of Object.entries(sampled.actors)) {
    const steps = plantedSteps(frames);
    actors[id] = {frames: frames.length, nonFinite: nonFinite(frames), boneDrift: boneDrift(frames), steps, footSlide: Math.max(0, ...steps.map(s => s.px)), jerk: jerk(frames, fps), corners: handCorners(frames), crossings: crossings(frames)};
  }
  for (const [id, samples] of Object.entries(sampled.props)) props[id] = {nonFinite: samples.filter(s => !finite(s.at)).length, ...propMeasures(samples, {teleportPx: thresholds.errors?.prop_teleport_px})};
  return {fps, actors, props};
}

// ---------------------------------------------------------------------------
// Findings

/**
 * Findings from the measures against thresholds (src/rig_thresholds.json):
 * errors for NaN, bone drift, foot slide per planted step, grip loss and prop
 * teleports; warnings for jerk, corners and crossings. `at` is scene seconds.
 */
export function rigFindings(measures, thresholds) {
  const {errors: E, warnings: W} = thresholds;
  const {fps} = measures;
  const s = frame => round(frame / fps, 100);
  const out = [];
  for (const [id, m] of Object.entries(measures.actors)) {
    if (m.nonFinite.length) out.push({rule: 'rig-nan', severity: 'error', actor: id, at: s(m.nonFinite[0].frame), detail: `${id}: ${m.nonFinite.length} joint position(s) are not numbers (first ${m.nonFinite[0].joint} at ${s(m.nonFinite[0].frame)} s)`});
    if (m.boneDrift.px > E.bone_drift_px) out.push({rule: 'rig-bone-drift', severity: 'error', actor: id, detail: `${id}: the ${m.boneDrift.bone} bone changes length by ${round(m.boneDrift.px)} px (limit ${E.bone_drift_px} px)`});
    for (const step of m.steps.filter(st => st.px > E.foot_slide_px)) out.push({rule: 'rig-foot-slide', severity: 'error', actor: id, at: s(step.from), detail: `${id}: the planted ${step.foot === 'l' ? 'left' : 'right'} foot slides ${round(step.px)} px between ${s(step.from)} and ${s(step.to)} s (limit ${E.foot_slide_px} px)`});
    if (m.jerk.perMotion > W.jerk_per_motion) out.push({rule: 'rig-jerk', severity: 'warning', actor: id, detail: `${id}: joint jerk per unit of motion is ${Math.round(m.jerk.perMotion)}/s² (guide ${W.jerk_per_motion}): moves start and stop abruptly`});
    const seconds = Math.max(1 / fps, (m.frames - 1) / fps);
    if (m.corners.count / seconds > W.hand_corners_per_s) out.push({rule: 'rig-hand-corners', severity: 'warning', actor: id, at: s(m.corners.frames[0]), detail: `${id}: the hands turn a corner (> 45° in a frame) ${m.corners.count} times in ${round(seconds)} s (guide ${W.hand_corners_per_s} a second): add breakdowns so the path arcs`});
    const crossed = (m.crossings.arms + m.crossings.armLeg) / Math.max(1, m.frames);
    if (crossed > W.limb_cross_share) out.push({rule: 'rig-limb-crossing', severity: 'warning', actor: id, at: s(m.crossings.first), detail: `${id}: limbs cross in ${Math.round(crossed * 100)}% of frames (guide ${Math.round(W.limb_cross_share * 100)}%)`});
    if (m.crossings.legs / Math.max(1, m.frames) > W.limb_cross_share) out.push({rule: 'rig-limb-crossing', severity: 'warning', actor: id, detail: `${id}: the legs cross in ${m.crossings.legs} frames while the hips are apart`});
  }
  for (const [id, m] of Object.entries(measures.props)) {
    if (m.nonFinite) out.push({rule: 'rig-nan', severity: 'error', prop: id, detail: `prop ${id}: ${m.nonFinite} frame(s) with no position (a holder that is not in the scene?)`});
    for (const g of m.grip.filter(g => g.px > E.grip_loss_px)) out.push({rule: 'rig-grip-loss', severity: 'error', prop: id, at: s(g.frame), detail: `prop ${id}: the hand is ${round(g.px)} px from it when it is taken or let go at ${s(g.frame)} s (limit ${E.grip_loss_px} px)`});
    for (const j of m.teleports) out.push({rule: 'rig-prop-teleport', severity: 'error', prop: id, at: s(j.frame), detail: `prop ${id}: jumps ${round(j.px)} px in one frame at ${s(j.frame)} s with nobody throwing it (limit ${E.prop_teleport_px} px)`});
  }
  return out;
}

/** A compact per-actor summary for reports (review-motion): rounded numbers only. */
export function rigSummary(measures) {
  return {
    actors: Object.fromEntries(Object.entries(measures.actors).map(([id, m]) => [id, {
      foot_slide_px: round(m.footSlide), planted_steps: m.steps.length, bone_drift_px: round(m.boneDrift.px, 100),
      jerk_rms: Math.round(m.jerk.rms), jerk_per_motion: Math.round(m.jerk.perMotion),
      hand_corners: m.corners.count, max_hand_turn: round(m.corners.maxTurn),
      crossing_frames: {legs: m.crossings.legs, arms: m.crossings.arms, arm_leg: m.crossings.armLeg}, non_finite: m.nonFinite.length
    }])),
    props: Object.fromEntries(Object.entries(measures.props).map(([id, m]) => [id, {grip_loss_px: round(Math.max(0, ...m.grip.map(g => g.px))), teleports: m.teleports.length}]))
  };
}

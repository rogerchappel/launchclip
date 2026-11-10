// Transition frames: what the two plates of a transition put on screen, frame
// by frame, from the same windows, tweens and camera plan both renderers play
// (kit/core/transitions.mjs sceneWindows, kit/core/camera-world.mjs
// cameraPlan). No rendering: each plate is its layer rect carried through its
// layer state (x, y, scale, opacity, iris, wipes), its world placement and
// the camera, and sampled on a grid of screen points. Plain ESM.
// Canonical copy: kit/core/transition-frames.mjs.
//
// transitionFrames(story, sceneId) → the frames of the transition into that
// plate: per frame the share of the screen the two plates cover together, how
// much the picture changes to the next frame, and each plate's pose.
// transitionFindings(story) → what a viewer sees as a stutter, for every
// transition between two full-frame plates (FULL_FRAME_PLATES):
//   cover  a frame where the two plates together leave part of the screen to
//          the background (TRANSITION_CHECK.cover; a pan, whip-pan or orbit
//          shows the gap between two plates side by side, so it may show
//          TRANSITION_CHECK.gap of it);
//   stall  a plate on screen and not yet where it rests (the incoming plate:
//          where it ends; the outgoing one: where it starts or ends) that
//          does not change from one frame to the next;
//   pop    a frame-to-frame change that jumps (to at least half as much again
//          as the one before it) and is followed by a nearly still frame (a tenth of
//          it or less) before the transition ends.
// An overview pulls back to the map of the shots and holds there, so only
// its pops are reported.
// A plate here is whole for its render window: what its module draws inside
// (a clip's own fade, a card's entrance) is not part of the check.

import { cameraPlan, cameraStateAt, sceneObjectLookup, worldPoint } from './camera-world.mjs';
import { dotWipeCover, dotWipes } from './dot-wipe.mjs';
import { resolveModule } from './modules.mjs';
import { getEase } from './motion.mjs';
import { CAMERA_TRANSITION_TYPES, FULL_FRAME_PLATES, layerStateAt, sceneWindows } from './transitions.mjs';

/**
 * cover: the least share of the screen the two plates cover together; gap:
 * the same while the camera travels between two plates side by side; still:
 * a plate that moves less than this (px, at its corners) and changes less
 * than `fade` in opacity or filters has not changed; pop / calm: a change (a
 * share of the picture) of at least `pop` and `rise` times the one before it,
 * followed by one of at most `calm`, or of at most `drop` of it; columns:
 * the sample grid's width in points.
 */
export const TRANSITION_CHECK = Object.freeze({ cover: 0.95, gap: 0.8, still: 0.5, fade: 0.002, pop: 0.12, rise: 1.5, calm: 0.03, drop: 0.1, columns: 24 });

const FILTER_PROPS = ['blur', 'glow', 'rackIn', 'veil', 'dip', 'focus', 'smearX', 'smearY'];
const rad = (deg) => (deg * Math.PI) / 180;
const rotate = (p, deg) => { const r = rad(deg), c = Math.cos(r), s = Math.sin(r); return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }; };

// One plate at absolute time t → {opacity, state, toScreen(local), toLocal(screen)} or null outside its render window.
function plateAt(entry, t, { width, height, plan }) {
  if (!entry || t < entry.start - 1e-6 || t >= entry.renderEnd - 1e-6) return null;
  const state = layerStateAt(t, entry.tweens, getEase);
  const C = { x: width / 2, y: height / 2 };
  const placement = plan?.placements?.[entry.id] ?? null;
  const camera = plan ? cameraStateAt(plan, t) : null;
  // Layer transform about the canvas centre, then the world placement, then the camera.
  const toScreen = (q) => {
    let p = { x: C.x + state.scale * (q.x - C.x) + state.x, y: C.y + state.scale * (q.y - C.y) + state.y };
    if (placement) p = worldPoint(placement, p);
    if (camera) { const v = rotate({ x: (p.x - camera.x) * camera.zoom, y: (p.y - camera.y) * camera.zoom }, camera.rotation); p = { x: C.x + v.x, y: C.y + v.y }; }
    return p;
  };
  const toLocal = (s) => {
    let p = s;
    if (camera) { const v = rotate({ x: s.x - C.x, y: s.y - C.y }, -camera.rotation); p = { x: camera.x + v.x / camera.zoom, y: camera.y + v.y / camera.zoom }; }
    if (placement) { const v = rotate({ x: p.x - placement.x, y: p.y - placement.y }, -placement.rotation); p = { x: v.x / placement.scale, y: v.y / placement.scale }; }
    return { x: C.x + (p.x - C.x - state.x) / state.scale, y: C.y + (p.y - C.y - state.y) / state.scale };
  };
  const inside = (q) => {
    if (q.x < 0 || q.y < 0 || q.x > width || q.y > height) return false;
    if (state.iris !== null && Math.hypot(q.x - C.x, q.y - C.y) > state.iris) return false;
    if (q.x < (width * (state.wipeL ?? 0)) / 100 || q.x > width * (1 - (state.wipeR ?? 0) / 100)) return false;
    if (q.y < (height * (state.wipeT ?? 0)) / 100 || q.y > height * (1 - (state.wipeB ?? 0) / 100)) return false;
    return true;
  };
  const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: 0, y: height }, { x: width, y: height }].map(toScreen);
  // The clip in px: the iris radius, then the wipe insets (top, right, bottom, left); null = none.
  const px = (prop, span) => (state[prop] === null ? null : (state[prop] * span) / 100);
  const clip = [state.iris, px('wipeT', height), px('wipeR', width), px('wipeB', height), px('wipeL', width)];
  return { opacity: Math.min(1, Math.max(0, state.opacity)), state, corners, clip, toLocal, inside };
}

// Whether a plate's pose is the same in a and b (both on screen), within the check's tolerances.
function samePose(a, b, check) {
  if (!a || !b) return a === b;
  if (Math.abs(a.opacity - b.opacity) > check.fade) return false;
  if (a.corners.some((corner, i) => Math.hypot(corner.x - b.corners[i].x, corner.y - b.corners[i].y) > check.still)) return false;
  if (a.clip.some((edge, i) => (edge === null) !== (b.clip[i] === null) || Math.abs((edge ?? 0) - (b.clip[i] ?? 0)) > check.still)) return false;
  return FILTER_PROPS.every((prop) => Math.abs(a.state[prop] - b.state[prop]) <= check.fade);
}

/**
 * The frames of the transition into plate `sceneId` of a resolved story.
 * → {sceneId, from (the outgoing plate's id | null), type, camera, start,
 *    dur, frames: [{frame, t, cover, change, in, out}]} | null (no typed
 * transition). cover: the share of the screen the two plates (and a dot
 * wipe's cover) hide; change: the share of the picture that differs in the
 * next frame (0 on the last); in / out: {opacity, share (of the screen the
 * plate is on), corners (screen px), clip (px), state} | null.
 */
export function transitionFrames(story, sceneId, { windows = sceneWindows(story), plan, check = TRANSITION_CHECK } = {}) {
  const width = Number(story?.format?.width), height = Number(story?.format?.height);
  const fps = Number(story?.resolved?.fps ?? story?.format?.fps ?? 30);
  const plates = windows.scenes.filter((entry) => entry.plate).sort((a, b) => a.start - b.start || a.index - b.index);
  const entry = plates.find((item) => item.id === sceneId);
  if (!entry?.transitionIn || !(entry.transitionIn.dur > 0)) return null;
  const camera = plan === undefined ? cameraPlan(story, { windows, objects: sceneObjectLookup(story, (scene, value) => resolveModule(scene, value)) }) : plan;
  // The outgoing plate: the one the transition carries (its window runs into this one).
  const previous = plates.filter((item) => item !== entry && item.start < entry.start - 1e-6 && item.renderEnd > entry.start + 1e-6).at(-1) ?? null;
  const wipe = dotWipes(story, windows).find((item) => item.sceneId === entry.id) ?? null;
  const first = Math.round(entry.start * fps), last = Math.round((entry.start + entry.transitionIn.dur) * fps);
  const columns = check.columns, rows = Math.max(1, Math.round((columns * height) / width));
  const points = [];
  for (let j = 0; j < rows; j += 1) for (let i = 0; i < columns; i += 1) points.push({ x: ((i + 0.5) * width) / columns, y: ((j + 0.5) * height) / rows });
  const diagonal = Math.hypot(width, height);
  const options = { width, height, plan: camera };
  const sample = (frame) => {
    const t = frame / fps;
    const incoming = plateAt(entry, t, options), outgoing = plateAt(previous, t, options);
    const dots = wipe ? Math.min(1, dotWipeCover(wipe, t) * (wipe.cover ?? 1)) : 0;
    // Per point: the weight of the incoming plate (on top), the outgoing one and the background, and where each plate is read from.
    const cells = points.map((point) => {
      const qi = incoming ? incoming.toLocal(point) : null, qo = outgoing ? outgoing.toLocal(point) : null;
      const a = incoming && incoming.inside(qi) ? incoming.opacity : 0, b = outgoing && outgoing.inside(qo) ? outgoing.opacity : 0;
      return { in: a, out: (1 - a) * b, qi, qo, onIn: a > 0, onOut: b > 0 };
    });
    // The share of the screen each plate is on (whatever its opacity).
    const share = (key) => cells.filter((cell) => cell[key]).length / cells.length;
    const cover = cells.reduce((sum, cell) => sum + 1 - (1 - cell.in - cell.out) * (1 - dots), 0) / cells.length;
    return { frame, t, incoming, outgoing, cells, cover, dots, shares: { in: share('onIn'), out: share('onOut') } };
  };
  const samples = [];
  for (let frame = first; frame <= last; frame += 1) samples.push(sample(frame));
  const frames = samples.map((now, k) => {
    const next = samples[k + 1];
    let change = 0;
    if (next) {
      const moved = (a, b) => (a && b ? Math.min(1, Math.hypot(a.x - b.x, a.y - b.y) / (diagonal * 0.05)) : 0);
      for (let n = 0; n < now.cells.length; n += 1) {
        const a = now.cells[n], b = next.cells[n];
        // What the point shows changes by its weights, and by how far each plate's picture travels under it.
        const weights = (Math.abs(a.in - b.in) + Math.abs(a.out - b.out) + Math.abs(a.in + a.out - b.in - b.out)) / 2;
        const travel = Math.min(a.in, b.in) * moved(a.qi, b.qi) + Math.min(a.out, b.out) * moved(a.qo, b.qo);
        change += Math.min(1, weights + travel);
      }
      // A dot wipe hides its share of the picture, and its own dots change the frame.
      change = (change / now.cells.length) * (1 - Math.min(now.dots, next.dots)) + Math.abs(now.dots - next.dots);
    }
    const pose = (plate, share) => (plate ? { opacity: plate.opacity, share, corners: plate.corners, clip: plate.clip, state: plate.state } : null);
    return { frame: now.frame, t: now.t, cover: now.cover, change, in: pose(now.incoming, now.shares.in), out: pose(now.outgoing, now.shares.out) };
  });
  return { sceneId: entry.id, from: previous?.id ?? null, type: entry.transitionIn.type, camera: Boolean(entry.transitionIn.camera), start: entry.start, dur: entry.transitionIn.dur, frames };
}

/**
 * Findings for one transition's frames (transitionFrames).
 * → [{sceneId, type, kind: "cover" | "stall" | "pop", frame, t, detail}]
 */
export function transitionFrameFindings(transition, { check = TRANSITION_CHECK } = {}) {
  if (!transition) return [];
  const { frames, type, sceneId } = transition;
  const out = [];
  const add = (kind, at, detail) => out.push({ sceneId, type, kind, frame: at.frame, t: at.t, detail });
  const least = type === 'overview' ? 0 : CAMERA_TRANSITION_TYPES.includes(type) && type !== 'pull' ? check.gap : check.cover;
  const low = frames.filter((at) => at.cover < least - 1e-9);
  if (low.length) {
    const worst = low.reduce((a, b) => (b.cover < a.cover ? b : a));
    add('cover', worst, `the two plates cover ${Math.round(worst.cover * 100)}% of the frame at ${worst.t.toFixed(3)} s (${low.length} frame${low.length === 1 ? '' : 's'} under ${Math.round(least * 100)}%): the background shows through`);
  }
  for (const side of type === 'overview' ? [] : ['in', 'out']) {
    const poses = frames.map((at) => at[side]);
    // Where the plate rests: the incoming one where it ends, the outgoing one where it starts or ends.
    const rests = side === 'in' ? [poses.findLast(Boolean)] : [poses.find(Boolean), poses.findLast(Boolean)];
    const flying = (pose) => Boolean(pose) && pose.opacity > 0.02 && pose.share > 0 && !rests.some((rest) => samePose(pose, rest, check));
    for (let k = 0; k + 1 < frames.length; k += 1) {
      if (!flying(poses[k]) || !flying(poses[k + 1]) || !samePose(poses[k], poses[k + 1], check)) continue;
      add('stall', frames[k], `the ${side === 'in' ? 'incoming' : 'outgoing'} plate is on screen at ${frames[k].t.toFixed(3)} s, not yet where it rests, and does not change in the next frame`);
      break;
    }
  }
  for (let k = 0; k + 2 < frames.length; k += 1) {
    // A jump (well over the step before it: an ease that is slowing down is not one), then calm.
    if (!(frames[k].change >= check.pop && frames[k].change >= check.rise * (frames[k - 1]?.change ?? 0) && frames[k + 1].change <= Math.max(check.calm, frames[k].change * check.drop))) continue;
    add('pop', frames[k + 1], `${Math.round(frames[k].change * 100)}% of the picture changes into ${frames[k + 1].t.toFixed(3)} s and then almost nothing moves: a pop`);
    break;
  }
  return out;
}

/**
 * Findings for every transition between two full-frame plates of a resolved
 * story (transitionFrameFindings). → [{sceneId, type, kind, frame, t, detail}]
 */
export function transitionFindings(story, { windows = sceneWindows(story), check = TRANSITION_CHECK } = {}) {
  const plan = cameraPlan(story, { windows, objects: sceneObjectLookup(story, (scene, value) => resolveModule(scene, value)) });
  const byId = new Map(windows.scenes.map((entry) => [entry.id, entry]));
  const out = [];
  for (const entry of windows.scenes) {
    if (!entry.plate || !FULL_FRAME_PLATES.includes(entry.scene.module)) continue;
    const transition = transitionFrames(story, entry.id, { windows, plan, check });
    if (!transition?.from || !FULL_FRAME_PLATES.includes(byId.get(transition.from)?.scene.module)) continue;
    out.push(...transitionFrameFindings(transition, { check }));
  }
  return out;
}

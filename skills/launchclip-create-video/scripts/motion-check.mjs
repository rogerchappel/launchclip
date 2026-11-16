// Motion check: rules of good motion decided from a story's grammar and each
// scene's timeline ops, so a plan with a motion fault fails before it renders.
// Frame-pure data in, findings out; nothing is drawn. Plain ESM; imports only
// ./grammar.mjs, ./motion.mjs and ./catalog-b-view.mjs (frameState). Canonical copy: kit/core/motion-check.mjs.
// Contract: docs/DIRECTION_GUARDRAILS.md §8.
//
// The rules come from the checklist in LottieFiles' motion-design-skill (MIT,
// https://github.com/LottieFiles/motion-design-skill). Its numbers are for
// interfaces, in milliseconds; the thresholds here are set from the shipped
// grammars and the example stories instead (see MOTION_CHECK).
//
// Each finding: {rule, severity: "error" | "warning", at, ids, detail}.

import { GRAMMARS, easeRole } from './grammar.mjs';
import { getEase } from './motion.mjs';
import { frameState } from './catalog-b-view.mjs';

// staggerSpan: the longest a cascade may run from its first element starting
//   to its last (s). The longest shipped cascade is 1.05 s (sixteen lines of
//   an archive card), 1.68 s under the widest preset stagger (playful, ×1.6)
//   and 1.8 s at the largest stagger a grammar may set (×3), where the module
//   clamps it. The budget sits just above that, so it catches a module that
//   does not clamp its own cascade.
// staggerCount: a cascade is at least this many elements.
// exitRatio: an exit may take at most this many times its entrance. Every
//   preset grammar's exit is shorter than its entrance, and that is what the
//   grammar rule asks for; the shipped modules have a few devices that leave
//   slower than they arrive (a zoom-through, a cut-out hole: 2×), so the
//   element rule only fails beyond those.
// pulse: an element that appears and is gone again within this long (s) is a
//   flash (a bloom, a ring, a sweep), not an entrance and an exit.
// gesture: a tween at most this long (s) is a move the eye follows; a longer
//   one is continuous motion (a turn, a sway, a scroll) and may be linear.
// crowdShare: the share of a scene's elements that may be in a gesture at one
//   moment once the scene has settled. The source says a third; shipped
//   builds move up to two thirds of a chart at once, so the line is above that.
// crowdElements: scenes with fewer elements are not measured.
// crowdSettle: seconds after the entrance before crowding is measured.
// beatRest: the least time between two shot states (s): a state's bloom is
//   gone after 0.92 s (shot-states.mjs STATE_BLOOM), plus one editorial
//   entrance (0.28 s) of stillness before the next one lands.
// frame: a grammar's exit may outlast its entrance by less than one frame at
//   30 fps (a feel over a slow preset leaves 0.03 s longer than it arrives).
// anticipation: a move that starts on a state or a hit may reach half its
//   travel at most this many frames after it (docs/PLAN_AND_PACE_RFC.md §2;
//   long form allows 2, cadence.mjs pace.anticipation_frames).
// holdScene, hold: a scene longer than holdScene (s) may not have a settled
//   stretch over hold (s) where nothing in its ops moves
//   (docs/FLUID_MOTION_RFC.md §9). hold is the gesture line: idle half-cycles
//   are at least 1.6 s, so one breath always breaks a hold.
// shakeStep: the longest tween read as one step of an impact shake (s). The
//   RFC's steps are 0.05–0.08 s; 0.1 s (three frames) leaves room for a
//   slower grammar without catching a quick snap of two steps.
// shakeSteps: a shake is at least this many abutting steps that reverse.
// shakeWindow: a shake is over within this long (s; RFC §8).
// seamPx, seamUnit: how far a prop may differ between a loop's first and last
//   frame: half a pixel (or degree) for positions, 1 % for opacity and scale.
export const MOTION_CHECK = Object.freeze({ frame: 1 / 30, staggerSpan: 2, staggerCount: 3, exitRatio: 2, pulse: 1.5, gesture: 1.5, crowdShare: 0.75, crowdElements: 6, crowdSettle: 0.5, beatRest: 1.2, anticipation: 1, holdScene: 3, hold: 1.5, shakeStep: 0.1, shakeSteps: 3, shakeWindow: 0.3, seamPx: 0.5, seamUnit: 0.01 });

/** The share of a tween's duration at which its ease reaches half its travel (power3.out: 0.206). */
export function halfTravel(name) {
  let curve;
  try { curve = getEase(name); } catch { return 0.5; }
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i += 1) { const mid = (lo + hi) / 2; if (curve(mid) < 0.5) lo = mid; else hi = mid; }
  return Math.round(((lo + hi) / 2) * 1000) / 1000;
}

const EPS = 1e-6;
const LINEAR = /^(none|linear|power0)\b/;
const SCALE = ['scale', 'scaleX', 'scaleY'];
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const IDLE = /-idle$/;
const linear = (name) => typeof name === 'string' && LINEAR.test(name.trim());
const finding = (rule, severity, at, ids, detail) => ({ rule, severity, at: Number.isFinite(at) ? round(at, 3) : null, ids, detail });

const ENTER_FIX = 'entrances ease out, or in and out, so they slow into place: use an ease such as "power3.out"';
const EXIT_FIX = 'exits ease in, so they leave quickly: use an ease such as "power2.in"';
const LINEAR_FIX = 'a linear move starts and stops dead: give it an eased curve such as "power3.inOut"';

/**
 * The grammar rules (story.motion.grammar, resolved): no role is linear, the
 * enter ease does not speed up into place, the exit ease does not slow down on
 * the way out, and the exit is no longer than the entrance.
 */
export function grammarMotionFindings(grammar, { check = MOTION_CHECK } = {}) {
  const findings = [];
  const ease = grammar?.ease ?? {}, duration = grammar?.duration ?? {};
  for (const role of ['enter', 'exit', 'move', 'camera']) {
    if (linear(ease[role])) findings.push(finding('linear-move', 'error', null, [], `motion.grammar.ease.${role} is linear ("${ease[role]}"); ${LINEAR_FIX} (editorial uses "${GRAMMARS.editorial.ease[role]}")`));
  }
  if (ease.enter !== undefined && easeRole(ease.enter) === 'exit') findings.push(finding('entrance-ease', 'error', null, [], `motion.grammar.ease.enter is "${ease.enter}", which speeds up into the resting place; ${ENTER_FIX}`));
  if (ease.exit !== undefined && ['enter', 'emphasis'].includes(easeRole(ease.exit))) findings.push(finding('exit-ease', 'error', null, [], `motion.grammar.ease.exit is "${ease.exit}", which lingers on the way out; ${EXIT_FIX}`));
  if (duration.exit > duration.enter + check.frame) findings.push(finding('exit-longer', 'error', null, [], `motion.grammar.duration.exit (${duration.exit} s) is longer than duration.enter (${duration.enter} s); something leaving should take less time than it took to arrive`));
  return findings;
}

const changedKeys = (op) => Object.keys(op.to ?? {}).filter((key) => op.from?.[key] !== op.to[key]);
const travels = (keys) => keys.includes('x') || keys.includes('y');
const grows = (op, keys) => keys.some((key) => SCALE.includes(key) && (op.from?.[key] ?? 1) < op.to[key]);
const scales = (keys) => keys.some((key) => SCALE.includes(key));
const displaced = (state) => Boolean(state) && (Math.abs(state.x ?? 0) > EPS || Math.abs(state.y ?? 0) > EPS || SCALE.some((key) => state[key] !== undefined && Math.abs(state[key] - 1) > EPS));

/**
 * The scene rules, from one resolved module model's timing and op list:
 *   id      the scene id (its root target)
 *   motion  model.motion {enterDuration, exitDuration, enterEase, exitEase, enterFrom, exitTo, enterEnd, exitStart}
 *   ops     the timeline ops both renderers play ({type: "tween", target, start, duration, ease, from, to}); [] when the module has none
 *   states  the seconds at which the scene's shot states land
 *   hits    the seconds of the scene's hits
 *   loop    {start, end} when the scene must loop: its first frame (start) and
 *           its last (end − one frame) must match; null otherwise
 */
export function sceneMotionFindings({ id, motion = null, ops = [], states = [], hits = [], loop = null, check = MOTION_CHECK } = {}) {
  const findings = [];
  const m = motion ?? {};

  // The scene's own entrance and exit.
  if (displaced(m.enterFrom) && linear(m.enterEase)) findings.push(finding('linear-move', 'error', m.enterStart, [id], `${id} arrives on a linear ease ("${m.enterEase}"); ${LINEAR_FIX}`));
  else if (displaced(m.enterFrom) && m.enterEase !== undefined && easeRole(m.enterEase) === 'exit') findings.push(finding('entrance-ease', 'error', m.enterStart, [id], `${id} arrives on "${m.enterEase}", which speeds up into the resting place; ${ENTER_FIX}`));
  if (displaced(m.exitTo) && linear(m.exitEase)) findings.push(finding('linear-move', 'error', m.exitStart, [id], `${id} leaves on a linear ease ("${m.exitEase}"); ${LINEAR_FIX}`));
  else if (displaced(m.exitTo) && m.exitEase !== undefined && ['enter', 'emphasis'].includes(easeRole(m.exitEase))) findings.push(finding('exit-ease', 'error', m.exitStart, [id], `${id} leaves on "${m.exitEase}", which lingers on the way out; ${EXIT_FIX}`));
  if (m.enterDuration > 0 && m.exitDuration > check.exitRatio * m.enterDuration + EPS) findings.push(finding('exit-longer', 'error', m.exitStart, [id], `${id} takes ${round(m.exitDuration)} s to leave and ${round(m.enterDuration)} s to arrive; an exit should be shorter than its entrance (at most ${check.exitRatio}× here): shorten the exit`));

  // The elements inside it.
  const tweens = [];
  for (const op of Array.isArray(ops) ? ops : []) {
    if (op?.type !== 'tween' || !(op.duration > 0) || !op.target) continue;
    const keys = changedKeys(op);
    if (keys.length) tweens.push({ op, keys, end: op.start + op.duration });
  }
  // Each element's fade in (the first) and fade out (the last).
  const lives = new Map();
  for (const tween of tweens) {
    if (!tween.keys.includes('opacity')) continue;
    const life = lives.get(tween.op.target) ?? lives.set(tween.op.target, {}).get(tween.op.target);
    const flashes = life.flashes ?? (life.flashes = []);
    if ((tween.op.from?.opacity ?? 1) < 0.05 && tween.op.to.opacity > 0.05) { if (!life.enter) life.enter = tween; flashes.push({ enter: tween }); }
    if (tween.op.to.opacity < 0.05) { life.exit = tween; if (flashes.length) flashes.at(-1).exit ??= tween; }
  }
  // A flash: every fade in is gone again within `pulse` (a node that lights on each beat flashes many times).
  const isPulse = (life) => Boolean(life?.enter && life?.exit) && life.flashes.every((f) => f.exit && f.exit.end - f.enter.op.start <= check.pulse + EPS);
  const during = (tween, fade) => Boolean(fade) && tween.op.start >= fade.op.start - EPS && tween.op.start <= fade.end + EPS;

  for (const tween of tweens) {
    const { op, keys } = tween;
    if (op.target === id) continue;
    const life = lives.get(op.target);
    if (travels(keys) && linear(op.ease) && op.duration <= check.gesture + EPS) { findings.push(finding('linear-move', 'error', op.start, [id, op.target], `${op.target} moves on a linear ease ("${op.ease}") for ${round(op.duration)} s; ${LINEAR_FIX}`)); continue; }
    if (isPulse(life)) continue;
    // A slam (scaling down into place) accelerates on purpose; a slide or a grow does not.
    if (during(tween, life?.enter) && (travels(keys) || grows(op, keys)) && easeRole(op.ease) === 'exit') findings.push(finding('entrance-ease', 'error', op.start, [id, op.target], `${op.target} arrives on "${op.ease}", which speeds up into the resting place; ${ENTER_FIX}`));
    else if (during(tween, life?.exit) && tween !== life.enter && (travels(keys) || scales(keys)) && ['enter', 'emphasis'].includes(easeRole(op.ease))) findings.push(finding('exit-ease', 'error', op.start, [id, op.target], `${op.target} leaves on "${op.ease}", which lingers on the way out; ${EXIT_FIX}`));
  }
  for (const [target, life] of lives) {
    if (target === id || !life.enter || !life.exit || isPulse(life)) continue;
    const enter = life.enter.op.duration, exit = life.exit.op.duration;
    if (exit > check.exitRatio * enter + EPS) findings.push(finding('exit-longer', 'error', life.exit.op.start, [id, target], `${target} takes ${round(exit)} s to leave and ${round(enter)} s to arrive; an exit should be shorter than its entrance (at most ${check.exitRatio}× here): shorten the exit`));
  }

  // Cascades: the same tween on several elements, each starting before the one before it has finished.
  const groups = new Map();
  for (const tween of tweens) {
    const key = `${tween.op.duration}|${tween.op.ease}|${tween.keys.join()}`;
    (groups.get(key) ?? groups.set(key, []).get(key)).push(tween);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.op.start - b.op.start);
    let run = [];
    const flush = () => {
      const span = run.length ? run.at(-1).op.start - run[0].op.start : 0;
      if (new Set(run.map((tween) => tween.op.target)).size >= check.staggerCount && span > check.staggerSpan + EPS) findings.push(finding('long-stagger', 'error', run[0].op.start, [id], `${run.length} elements of ${id} arrive one after another over ${round(span)} s; a cascade should be over within ${check.staggerSpan} s: lower motion.grammar.stagger, or show fewer items at once`));
    };
    for (const tween of group) {
      const gap = run.length ? tween.op.start - run.at(-1).op.start : 0;
      if (run.length && gap > EPS && gap < tween.op.duration - EPS) run.push(tween);
      else if (run.length && gap <= EPS) continue;
      else { flush(); run = [tween]; }
    }
    flush();
  }

  // Crowding: once the scene has settled, how many of its elements are in a gesture at one moment.
  // An `-idle` wrapper is its element's breath, not an element of its own (RFC §9).
  const elements = new Set((Array.isArray(ops) ? ops : []).map((op) => op?.target).filter((target) => target && !IDLE.test(target)));
  if (elements.size >= check.crowdElements) {
    const gestures = tweens.filter((tween) => tween.op.duration <= check.gesture + EPS && !IDLE.test(tween.op.target));
    const from = (m.enterEnd ?? 0) + check.crowdSettle, to = m.exitStart ?? Infinity;
    let worst = null;
    for (const tween of gestures) {
      const t = tween.op.start;
      if (t < from - EPS || t >= to - EPS) continue;
      const moving = new Set(gestures.filter((other) => other.op.start <= t + EPS && t < other.end - EPS).map((other) => other.op.target)).size;
      if (!worst || moving > worst.moving) worst = { t, moving };
    }
    if (worst && worst.moving / elements.size > check.crowdShare + EPS) findings.push(finding('crowded-move', 'warning', worst.t, [id], `${worst.moving} of ${id}'s ${elements.size} elements move at once at ${round(worst.t)} s; the eye follows one thing at a time: change fewer of them in one beat, or split the change across two states`));
  }

  // Anticipation: a move that starts on its beat lands late; it should start
  // early by its ease's half-travel time so the eye reads it on the beat.
  const beatTimes = [...states, ...hits].filter(Number.isFinite);
  const late = [];
  for (const { op, keys } of tweens) {
    if (op.target === id || !(travels(keys) || scales(keys)) || !beatTimes.some((t) => Math.abs(op.start - t) < 1e-3)) continue;
    const lag = halfTravel(op.ease) * op.duration;
    if (lag > check.anticipation * check.frame + EPS) late.push({ op, lag });
  }
  if (late.length) {
    const worst = late.reduce((a, b) => (b.lag > a.lag ? b : a));
    const what = late.length === 1 ? `1 move in ${id} starts on its beat and reaches half its travel` : `${late.length} moves in ${id} start on their beats and reach half their travel`;
    findings.push(finding('late-beat', 'warning', worst.op.start, [id, ...new Set(late.map((entry) => entry.op.target))], `${what} up to ${round(worst.lag / check.frame, 1)} frames after it (${worst.op.target}, "${worst.op.ease ?? 'default'}" over ${round(worst.op.duration)} s); start a move early by its half-travel time so it lands on the beat`));
  }

  // A still moment between beats.
  const beats = [...states].filter(Number.isFinite).sort((a, b) => a - b);
  for (let i = 1; i < beats.length; i += 1) {
    const gap = beats[i] - beats[i - 1];
    if (gap < check.beatRest - EPS) findings.push(finding('no-rest', 'warning', beats[i], [id], `${id}'s state ${i + 1} lands ${round(gap)} s after state ${i}, before that one has settled; leave at least ${check.beatRest} s between states so there is a still moment to read`));
  }

  findings.push(...staticHold(id, m, tweens, ops, beatTimes, check), ...shakeOvershoot(id, tweens, check), ...loopSeam(id, ops, loop, check));
  return findings;
}

// Static hold (RFC §9): between the entrance and the exit, the longest stretch
// where no op moves anything and no state or hit lands. A scene with no op
// list is not measured: its motion is not visible here.
function staticHold(id, m, tweens, ops, beatTimes, check) {
  const from = m.enterEnd, to = m.exitStart;
  if (!tweens.length || !Number.isFinite(from) || !Number.isFinite(to) || to + (m.exitDuration ?? 0) - (m.enterStart ?? 0) <= check.holdScene + EPS) return [];
  const loops = ops.filter((op) => op?.type === 'loop' && op.cycle > 0).map((op) => [op.start, op.start + op.cycle * (op.repeats ?? Infinity)]);
  const spans = [...tweens.filter((t) => t.op.target !== id).map((t) => [t.op.start, t.end]), ...loops, ...beatTimes.map((t) => [t, t])].sort((a, b) => a[0] - b[0]);
  let cursor = from, worst = { at: from, gap: 0 };
  for (const [start, end] of [...spans, [to, to]]) {
    const gap = Math.min(start, to) - cursor;
    if (gap > worst.gap) worst = { at: cursor, gap };
    cursor = Math.max(cursor, end);
    if (cursor >= to) break;
  }
  if (worst.gap <= check.hold + EPS) return [];
  return [finding('static-hold', 'warning', worst.at, [id], `${id} holds still for ${round(worst.gap)} s (${round(worst.at)}–${round(worst.at + worst.gap)} s) once it has settled; a settled frame should never be still: give its parts an idle breath, or a slow camera push (docs/FLUID_MOTION_RFC.md §4, §8)`)];
}

// Shake overshoot (RFC §8): abutting short x/y steps on one target that reverse
// are an impact shake; each step must land no further from rest than the one
// before, end at rest, and be over within the window.
function shakeOvershoot(id, tweens, check) {
  const findings = [];
  const steps = new Map();
  for (const tween of tweens) {
    if (!travels(tween.keys) || tween.op.duration > check.shakeStep + EPS) continue;
    (steps.get(tween.op.target) ?? steps.set(tween.op.target, []).get(tween.op.target)).push(tween);
  }
  const off = (props, rest) => Math.hypot((props?.x ?? rest.x) - rest.x, (props?.y ?? rest.y) - rest.y);
  for (const [target, list] of steps) {
    list.sort((a, b) => a.op.start - b.op.start);
    const runs = [];
    for (const tween of list) {
      const run = runs.at(-1);
      if (run && Math.abs(tween.op.start - run.at(-1).end) < 1e-3) run.push(tween); else runs.push([tween]);
    }
    for (const run of runs) {
      if (run.length < check.shakeSteps) continue;
      const rest = { x: run[0].op.from?.x ?? 0, y: run[0].op.from?.y ?? 0 };
      const sign = (t) => Math.sign((t.op.to.x ?? rest.x) - rest.x || (t.op.to.y ?? rest.y) - rest.y);
      if (!run.some((t, i) => i > 0 && sign(t) * sign(run[i - 1]) < 0)) continue;
      const span = run.at(-1).end - run[0].op.start;
      const grows = run.findIndex((t, i) => i > 0 && off(t.op.to, rest) > off(run[i - 1].op.to, rest) + check.seamPx);
      const last = off(run.at(-1).op.to, rest);
      const why = [];
      if (grows > 0) why.push(`step ${grows + 1} lands ${round(off(run[grows].op.to, rest), 1)} px from rest, further than step ${grows} (${round(off(run[grows - 1].op.to, rest), 1)} px)`);
      if (last > check.seamPx) why.push(`it ends ${round(last, 1)} px from rest`);
      if (span > check.shakeWindow + EPS) why.push(`it runs ${round(span)} s`);
      if (why.length) findings.push(finding('shake-overshoot', 'error', run[0].op.start, [id, target], `${target} shakes in ${run.length} steps and ${why.join(', and ')}; an impact shake decays: each step halves, the last lands at rest, all within ${check.shakeWindow} s (fluid-motion.mjs shakeOps)`));
    }
  }
  return findings;
}

// Loop seam (RFC §8): a scene that loops shows the same frame at its start and its end.
function loopSeam(id, ops, loop, check) {
  if (!loop || !Number.isFinite(loop.start) || !Number.isFinite(loop.end)) return [];
  const first = frameState(ops, loop.start), last = frameState(ops, loop.end - check.frame);
  const diffs = [];
  for (const target of new Set([...first.keys(), ...last.keys()])) {
    const a = first.get(target) ?? {}, b = last.get(target) ?? {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (typeof (a[key] ?? b[key]) !== 'number') continue;
      const rest = key === 'opacity' || SCALE.includes(key) ? 1 : 0;
      const tolerance = key === 'opacity' || SCALE.includes(key) ? check.seamUnit : check.seamPx;
      if (Math.abs((a[key] ?? rest) - (b[key] ?? rest)) > tolerance + EPS) diffs.push({ target, key, a: a[key] ?? rest, b: b[key] ?? rest });
    }
  }
  if (!diffs.length) return [];
  const shown = diffs.slice(0, 4).map((d) => `${d.target} ${d.key} ${round(d.a)} → ${round(d.b)}`).join(', ');
  return [finding('loop-seam', 'error', loop.end, [id, ...new Set(diffs.map((d) => d.target))], `${id} loops but its last frame differs from its first (${shown}${diffs.length > 4 ? `, and ${diffs.length - 4} more` : ''}); end every layer where it began: fit idle to whole cycles and make the exit return to the entrance pose (docs/FLUID_MOTION_RFC.md §8)`)];
}

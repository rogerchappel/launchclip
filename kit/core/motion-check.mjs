// Motion check: rules of good motion decided from a story's grammar and each
// scene's timeline ops, so a plan with a motion fault fails before it renders.
// Frame-pure data in, findings out; nothing is drawn. Plain ESM; imports only
// ./grammar.mjs and ./motion.mjs. Canonical copy: kit/core/motion-check.mjs.
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
export const MOTION_CHECK = Object.freeze({ frame: 1 / 30, staggerSpan: 2, staggerCount: 3, exitRatio: 2, pulse: 1.5, gesture: 1.5, crowdShare: 0.75, crowdElements: 6, crowdSettle: 0.5, beatRest: 1.2, anticipation: 1 });

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
 */
export function sceneMotionFindings({ id, motion = null, ops = [], states = [], hits = [], check = MOTION_CHECK } = {}) {
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
  const elements = new Set((Array.isArray(ops) ? ops : []).map((op) => op?.target).filter(Boolean));
  if (elements.size >= check.crowdElements) {
    const gestures = tweens.filter((tween) => tween.op.duration <= check.gesture + EPS);
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
  return findings;
}

// Pace check (docs/PLAN_AND_PACE_RFC.md §2): how fast a plan moves, from its
// event times and its frozen spans. Frame-pure data in, findings out, in the
// motion check's shape {rule, severity, at, ids, detail}. The thresholds are
// each cadence format's `pace` band (kit/core/cadence.mjs CADENCE_TARGETS).
//
//   paceFormat({duration, footage, profile}) → a CADENCE_TARGETS key
//   paceFindings({events, duration, frozen, pace, maxStill}) → findings
//
// Rules (severity on a render; on a plan see below):
//   slow-hook    (error)   fewer than hook_events events in the opening hook_window
//   flat-hook    (error)   the hook's event rate is under hook_ratio × the body's
//   event-gap    (warning over gap_warn, error over gap_fail) a stretch after the hook with no new event
//   frozen-frame (error)   nothing on screen moves for longer than max_still
// On a plan (source "plan") slow-hook, flat-hook and frozen-frame warn: a
// plan's element builds saturate the merged event rate, and a clip's or a
// still's own motion is only known on the render (RFC §2, phase 7). A
// frozen frame past the treatment's own `hold>N` is an error either way.
// Opaque spans (playing footage, a travelling camera) make events the plan
// cannot see: they do not count as gaps, and a hook that is mostly opaque is
// left to the render.
// The anticipation rule (a move lands on its beat) reads ops, so it lives in
// kit/core/motion-check.mjs.
//
// Pure ESM; imports only kit/core siblings.

import { mergeEvents } from './cadence.mjs';
import { LONG_FORM_SECONDS } from './long-form.mjs';

// Events closer than this are one event (cadence.mjs merges visual changes the same way).
export const PACE_MERGE_SECONDS = 0.25;
// Profiles cut to the short-motion band (the reel profiles); other motion stories take the explainer band.
export const SHORT_MOTION_PROFILES = Object.freeze(['short-motion', 'animated-explainer-reel']);
const CHARACTER_PROFILES = /character/;

const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const finding = (rule, severity, at, ids, detail) => ({ rule, severity, at: Number.isFinite(at) ? round(at, 3) : null, ids, detail });

/** The cadence format whose pace band a story is held to. profile: the cadence profile id or object. */
export function paceFormat({ duration = 0, footage = false, profile = null } = {}) {
  const id = typeof profile === 'string' ? profile : profile?.id ?? '';
  if (id === 'youtube-long-form' || duration >= LONG_FORM_SECONDS) return 'long-form';
  if (footage) return 'talking-head';
  if (SHORT_MOTION_PROFILES.includes(id)) return 'short-form';
  if (CHARACTER_PROFILES.test(id)) return 'animated';
  return 'motion-graphics';
}

/**
 * events: event times in seconds (scene entrances, states, module events,
 * camera moves); duration: the runtime; frozen: [[from, to]] spans where
 * nothing on screen moves, with the ids on screen ([[from, to, ids]]); pace:
 * cadenceTarget(format, style).pace; maxStill: overrides pace.max_still
 * (the treatment's banned `hold>N`); opaque: [[from, to]] spans whose own
 * events only the render shows; source: "plan" or "render" (the severities).
 */
export function paceFindings({ events = [], opaque = [], duration, frozen = [], pace, maxStill = null, source = 'plan' } = {}) {
  const findings = [];
  const hard = source === 'render' ? 'error' : 'warning';
  if (!(duration > 0) || !pace) return findings;
  const times = mergeEvents(events.filter((t) => t >= 0 && t < duration), PACE_MERGE_SECONDS);
  const window = Math.min(pace.hook_window, duration);

  // The hook: dense, and denser than what follows.
  const hook = times.filter((t) => t < window - 1e-6);
  const hidden = (from, to) => opaque.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, to) - Math.max(a, from)), 0);
  if (hook.length < pace.hook_events && hidden(0, window) < window / 2) findings.push(finding('slow-hook', hard, 0, [], `the opening ${window} s has ${hook.length} event${hook.length === 1 ? '' : 's'} (${hook.map((t) => `${round(t)} s`).join(', ') || 'none'}); a hook needs at least ${pace.hook_events}: build the first shot in steps, add a state or a second shot`));
  const body = duration - window;
  if (body >= window) {
    const hookRate = hook.length / window, bodyRate = (times.length - hook.length) / body;
    if (bodyRate > 0 && hookRate < pace.hook_ratio * bodyRate - 1e-9) findings.push(finding('flat-hook', hard, 0, [], `the hook runs ${round(hookRate * 60, 1)} events a minute and the body ${round(bodyRate * 60, 1)}; open at least ${pace.hook_ratio}× faster than the rest`));
  }

  // The longest stretch after the hook with nothing new.
  const edges = [window, ...times.filter((t) => t > window), duration];
  for (let i = 1; i < edges.length; i += 1) {
    const gap = edges[i] - edges[i - 1] - hidden(edges[i - 1], edges[i]);
    if (gap > pace.gap_fail + 1e-6) findings.push(finding('event-gap', 'error', edges[i - 1], [], `nothing new for ${round(gap, 1)} s (${round(edges[i - 1])}–${round(edges[i])} s); the longest gap is ${pace.gap_fail} s: add a state, a build or a cut`));
    else if (gap > pace.gap_warn + 1e-6) findings.push(finding('event-gap', 'warning', edges[i - 1], [], `nothing new for ${round(gap, 1)} s (${round(edges[i - 1])}–${round(edges[i])} s), over the ${pace.gap_warn} s this format holds to`));
  }

  // Frozen pixels.
  const still = maxStill ?? pace.max_still;
  if (still !== null && still !== undefined) {
    for (const [from, to, ids = []] of frozen) {
      if (to - from > still + 1e-6) findings.push(finding('frozen-frame', maxStill !== null ? 'error' : hard, from, ids, `nothing moves for ${round(to - from, 2)} s (${round(from)}–${round(to)} s)${ids.length ? ` on ${ids.join(', ')}` : ''}; hold still for at most ${still} s: keep a slow push-in or drift under the shot`));
    }
  }
  return findings;
}

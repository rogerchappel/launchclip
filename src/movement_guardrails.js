// Movement guardrails (docs/DIRECTION_GUARDRAILS.md §7): finish gates for the
// movement grammar, measured like the density and variety gates on the
// resolved story and the op lists both renderers play.
//
//   holdGate(story)    nothing holds still: no span over 3 s without motion
//   stateGate(story)   builds, not holds: no shot over 10 s without a change
//
// Each gate → {status, findings: [{rule, severity, at, ids, detail}]}.

import { catalogBTimeline } from "@launchclip/core/catalog-b.mjs";
import { catalogCTimeline } from "@launchclip/core/catalog-c.mjs";
import { catalogETimeline } from "@launchclip/core/catalog-e.mjs";
import { catalogFTimeline } from "@launchclip/core/catalog-f.mjs";
import { catalogGTimeline } from "@launchclip/core/catalog-g.mjs";
import { catalogHTimeline } from "@launchclip/core/catalog-h.mjs";
import { charactersTimeline } from "@launchclip/core/catalog-characters.mjs";
import { worldTimeline } from "@launchclip/core/catalog-world.mjs";
import { productDemoTimeline } from "@launchclip/core/catalog-d.mjs";
import { photoSceneTimeline } from "@launchclip/core/catalog-d-photo-scene.mjs";
import { MODULES as B } from "@launchclip/core/catalog-b.mjs";
import { MODULES as C } from "@launchclip/core/catalog-c.mjs";
import { MODULES as E } from "@launchclip/core/catalog-e.mjs";
import { MODULES as F } from "@launchclip/core/catalog-f.mjs";
import { MODULES as G } from "@launchclip/core/catalog-g.mjs";
import { MODULES as H } from "@launchclip/core/catalog-h.mjs";
import { MODULES as CHARACTERS } from "@launchclip/core/catalog-characters.mjs";
import { MODULES as WORLD } from "@launchclip/core/catalog-world.mjs";
import { driftEligible } from "@launchclip/core/ambient.mjs";
import { stateTimes } from "@launchclip/core/shot-states.mjs";
import { renderedModels } from "./direction_guardrails.js";

// Thresholds (docs/DIRECTION_GUARDRAILS.md §7).
export const MOVEMENT = Object.freeze({ step: 0.25, still: 3, shot: 10 });

const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

// Op-list timelines by module id; other modules (editorial kinds, catalogue A)
// count their entrance, exit and events as motion.
const TIMELINES = new Map([
  ...Object.keys(B ?? {}).map((id) => [id, catalogBTimeline]), ...Object.keys(C ?? {}).map((id) => [id, catalogCTimeline]),
  ...Object.keys(E ?? {}).map((id) => [id, catalogETimeline]), ...Object.keys(F ?? {}).map((id) => [id, catalogFTimeline]),
  ...Object.keys(G ?? {}).map((id) => [id, catalogGTimeline]), ...Object.keys(H ?? {}).map((id) => [id, catalogHTimeline]),
  ...Object.keys(CHARACTERS ?? {}).map((id) => [id, charactersTimeline]), ...Object.keys(WORLD ?? {}).map((id) => [id, worldTimeline]),
  ["product-demo", productDemoTimeline], ["photo-scene", photoSceneTimeline]
]);

/** [from, to] spans in which a model's ops change something on screen. */
function opSpans(model) {
  const timeline = TIMELINES.get(model.module);
  const spans = [];
  if (timeline) {
    let ops = [];
    try { ops = timeline(model); } catch { ops = []; }
    for (const op of Array.isArray(ops) ? ops : []) {
      if (op.type === "tween" && op.duration > 0 && Object.keys(op.to ?? {}).some((key) => op.from?.[key] !== op.to[key])) spans.push([op.start, op.start + op.duration]);
      else if (op.type === "loop") spans.push([op.start, op.start + op.cycle * (op.repeats ?? 1)]);
      else if (op.type === "set" && op.props && "text" in op.props) spans.push([op.time - 0.05, op.time + 0.05]);
    }
    if (spans.length) return spans;
  }
  const m = model.motion ?? {};
  if (Number.isFinite(m.enterStart)) spans.push([m.enterStart, m.enterEnd ?? m.enterStart + (m.enterDuration ?? 0.5)]);
  if (Number.isFinite(m.exitStart)) spans.push([m.exitStart, m.end ?? m.exitStart + (m.exitDuration ?? 0.4)]);
  for (const event of Array.isArray(model.events) ? model.events : []) if (Number.isFinite(event?.time)) spans.push([event.time, Math.max(event.time + 0.5, Number(event.endTime) || 0)]);
  return spans;
}

/** Sampled runs of `t` where predicate(t) holds, longer than `limit` seconds. */
function runs(duration, predicate, limit) {
  const out = [];
  let from = null;
  for (let t = 0; t <= duration + 1e-9; t += MOVEMENT.step) {
    const on = t < duration - 1e-6 && predicate(t);
    if (on && from === null) from = t;
    if (!on && from !== null) { if (t - from > limit + 1e-6) out.push([round(from), round(Math.min(t, duration))]); from = null; }
  }
  return out;
}

function gateResult(findings, extra = {}) {
  const errors = findings.filter((finding) => finding.severity === "error").length;
  return { status: errors ? "failed" : "passed", errors, warnings: findings.length - errors, findings: findings.slice(0, 40), ...extra };
}

/**
 * Nothing static (§7.1), sampled every 0.25 s:
 * - static-hold (error): over 3 s in which nothing moves: no hold drift or
 *   world camera, no transition, no module tween, loop, count or state;
 * - drift-only (warning): over 3 s in which only the hold drift moves; give
 *   the hold a live mover (a state, a counter, a sweep, a cursor).
 */
export function holdGate(story) {
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration) || 0;
  const { windows, entries } = renderedModels(story);
  const live = [], drift = [];
  for (const entry of windows.scenes) {
    for (const tw of entry.tweens) if (tw.duration > 0) live.push([tw.at, tw.at + tw.duration]);
    const model = entries.get(entry.id)?.model;
    if (!model) { live.push([entry.start, entry.renderEnd]); continue; }
    if (model.camera || entry.transitionIn?.camera) live.push([entry.start, entry.renderEnd]);
    else if (driftEligible(story, entry.scene, model)) drift.push([entry.start, entry.renderEnd]);
    live.push(...opSpans(model));
  }
  const inside = (list, t) => list.some(([a, b]) => a <= t + 1e-6 && t < b - 1e-6);
  const shown = (t) => windows.scenes.some((entry) => entry.start <= t + 1e-6 && t < entry.renderEnd - 1e-6);
  const findings = [];
  for (const [from, to] of runs(duration, (t) => shown(t) && !inside(live, t) && !inside(drift, t), MOVEMENT.still)) {
    const ids = windows.scenes.filter((entry) => entry.start < to && entry.renderEnd > from).map((entry) => entry.id);
    findings.push({ rule: "static-hold", severity: "error", at: from, ids, detail: `nothing moves for ${round(to - from, 1)} s (${from}–${to} s) on ${ids.join(", ")}; give the hold a slow dolly (ambient drift) and a live mover, or add a state` });
  }
  for (const [from, to] of runs(duration, (t) => shown(t) && !inside(live, t) && inside(drift, t), MOVEMENT.still)) {
    const ids = windows.scenes.filter((entry) => entry.start < to && entry.renderEnd > from).map((entry) => entry.id);
    findings.push({ rule: "drift-only", severity: "warning", at: from, ids, detail: `only the hold drift moves for ${round(to - from, 1)} s (${from}–${to} s) on ${ids.join(", ")}; add a live mover: a state, a counter, a sweeping highlight or a cursor` });
  }
  return gateResult(findings);
}

/**
 * Builds, not holds (§7.2): a shot (a track-0 plate, from its start to where
 * the next plate takes over) runs over 10 s without a state change. Changes
 * are the shot's start, its states, an overlay arriving or leaving, and the
 * module events (a build, a highlight, a count) of anything on screen.
 */
export function stateGate(story) {
  const { windows, entries } = renderedModels(story);
  const plates = windows.scenes.filter((entry) => entry.plate).sort((a, b) => a.start - b.start);
  const findings = [];
  let states = 0;
  for (const plate of plates) {
    const end = plate.end;
    const changes = [plate.start];
    for (const entry of windows.scenes) {
      if (entry.start >= end || entry.renderEnd <= plate.start) continue;
      const times = stateTimes(entry.scene);
      states += entry === plate ? times.length : 0;
      changes.push(...times);
      if (entry !== plate) changes.push(entry.start, entry.end);
      for (const event of entries.get(entry.id)?.model?.events ?? []) if (Number.isFinite(event?.time)) changes.push(event.time);
    }
    const sorted = [...new Set(changes.filter((t) => t >= plate.start - 1e-6 && t <= end + 1e-6).map((t) => round(t, 3)))].sort((a, b) => a - b);
    sorted.push(end);
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = sorted[i] - sorted[i - 1];
      if (gap > MOVEMENT.shot + 1e-6) findings.push({ rule: "still-shot", severity: "error", at: sorted[i - 1], ids: [plate.id], detail: `${plate.id} holds one state for ${round(gap, 1)} s (${round(sorted[i - 1])}–${round(sorted[i])} s); split it into states timed to the narration (scene.states) or cut` });
    }
  }
  return gateResult(findings, { shots: plates.length, states });
}

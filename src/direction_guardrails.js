// Direction guardrails (docs/DIRECTION_GUARDRAILS.md): finish gates that make
// bad direction fail before review, measured on the resolved story and the
// renderer-neutral op lists both renderers play.
//
//   physicsGate(story)   anchored world elements move only with the camera
//
// Each gate → {status: "passed" | "failed" | "skipped", findings: [{rule,
// severity, at?, ids, detail}]}. Errors fail the gate; warnings do not.

import { frameState } from "../kit/core/catalog-b-view.mjs";
import { charactersTimeline } from "../kit/core/catalog-characters.mjs";
import { worldTimeline } from "../kit/core/catalog-world.mjs";
import { rideWorldPlates } from "../kit/core/camera-world.mjs";
import { driftEligible } from "../kit/core/ambient.mjs";
import { resolveModule } from "../kit/core/modules.mjs";
import { TRANSFORM_KEYS } from "../kit/core/physics.mjs";
import { samePlaceCuts } from "../kit/core/story.mjs";
import { sceneWindows } from "../kit/core/transitions.mjs";

// Sampling step (s) and tolerances for "moves with its layer".
export const PHYSICS = Object.freeze({ step: 0.1, px: 0.5, scale: 0.001, fadeLow: 0.02, fadeHigh: 0.98 });

const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;
const scenesOf = (story) => (Array.isArray(story?.scenes) ? story.scenes : []);

function gateResult(findings, extra = {}) {
  const errors = findings.filter((finding) => finding.severity === "error").length;
  return { status: errors ? "failed" : "passed", errors, warnings: findings.length - errors, findings: findings.slice(0, 40), ...extra };
}

/**
 * Windows and models as the compilers build them: sceneWindows with riders
 * joined to their plates, each scene resolved to its render end. Scenes that
 * do not resolve are left out (the placeholder gate reports them).
 * → {windows, entries: Map id → {entry, model}}
 */
export function renderedModels(story) {
  const windows = rideWorldPlates(story, sceneWindows(story));
  const entries = new Map();
  for (const entry of windows.scenes) {
    let model = null;
    try { model = resolveModule(entry.scene, story, { end: entry.renderEnd }); } catch { model = null; }
    if (model) entries.set(entry.id, { entry, model });
  }
  return { windows, entries };
}

function times(start, end, step) {
  const out = [];
  for (let t = start; t <= end + 1e-9; t += step) out.push(round(t, 4));
  return out;
}

const transformed = (props) => TRANSFORM_KEYS.some((key) => props && props[key] !== undefined && Math.abs(props[key] - (key.startsWith("scale") ? 1 : 0)) > 1e-6);

/**
 * World physics (docs/DIRECTION_GUARDRAILS.md §1):
 * - same-place-cut: two plates of one place joined by a cut;
 * - anchored-moves: a world plate's ops move something other than its
 *   camera layers, or a set anchored to a plate moves apart from the
 *   plate's front layer;
 * - set-pops: a set standing in a plate covers only part of its window;
 * - set-fades: an anchored set fades over a plate that is already there;
 * - set-drifts: an anchored set takes the ambient hold drift.
 */
export function physicsGate(story) {
  const findings = [];
  for (const pair of samePlaceCuts(story)) {
    const scene = scenesOf(story).find((entry) => entry.id === pair.to);
    findings.push({ rule: "same-place-cut", severity: "error", at: scene?.start ?? null, ids: [pair.from, pair.to], detail: `a cut between two plates of the same place (${pair.place}) makes its furniture jump; make them one world scene or cut to a different place` });
  }
  const { entries } = renderedModels(story);
  const fps = Number(story?.resolved?.fps ?? story?.format?.fps ?? 30);
  const frame = 1 / fps + 1e-6;
  const worldOps = new Map();
  for (const [id, { model }] of entries) {
    if (model.module !== "world") continue;
    const ops = worldTimeline(model);
    worldOps.set(id, ops);
    const layers = new Set(["back", "mid", "front", "fx"].map((layer) => `${id}-${layer}`));
    for (const op of ops) {
      const props = op.type === "set" ? op.props : op.to;
      if (op.target === id && transformed(props)) findings.push({ rule: "anchored-moves", severity: "error", at: op.time ?? op.start, ids: [id], detail: `the world plate ${id} itself moves (${Object.keys(props).join(", ")}); only its camera layers may move` });
      else if (op.target !== id && !layers.has(op.target)) findings.push({ rule: "anchored-moves", severity: "error", at: op.time ?? op.start, ids: [id], detail: `the world ${id} animates ${op.target}, which is anchored to its layer; only the camera moves anchored things` });
    }
  }
  for (const [id, { entry, model }] of entries) {
    if (model.module !== "cast-scene") continue;
    const c = model.content;
    if (c.backdrop !== "world" || c.drawWorld) continue;
    const plateId = model.content.follow?.plate ?? null;
    const beneath = plateId ?? null;
    const plate = beneath ? entries.get(beneath) : null;
    if (!plate) {
      findings.push({ rule: "anchored-moves", severity: "error", at: entry.start, ids: [id], detail: `the set of ${id} stands in a world but follows no plate camera` });
      continue;
    }
    const scene = entry.scene, plateScene = plate.entry.scene;
    if (Math.abs(scene.start - plateScene.start) > frame || Math.abs(scene.end - plateScene.end) > frame) {
      findings.push({ rule: "set-pops", severity: "error", at: scene.start, ids: [id, beneath], detail: `${id} (${scene.start}–${scene.end} s) covers only part of the plate ${beneath} (${plateScene.start}–${plateScene.end} s), so its ${c.set} pops in or out over the world; give the cast-scene the plate's window (characters can arrive with a walk-to cue) or split the world scene at the cut` });
    }
    if (driftEligible(story, scene, model)) findings.push({ rule: "set-drifts", severity: "error", at: scene.start, ids: [id], detail: `${id}'s set would take the ambient hold drift, sliding over the world it stands in` });
    const ops = charactersTimeline(model);
    for (const op of ops) {
      if (op.target === id && transformed(op.type === "set" ? op.props : op.to)) findings.push({ rule: "anchored-moves", severity: "error", at: op.time ?? op.start, ids: [id], detail: `${id}'s set moves on its own; only the plate camera moves it` });
    }
    const plateOps = worldOps.get(beneath) ?? [];
    // Inside both render windows, the set's wrapper and the plate's front layer agree.
    const from = Math.max(entry.start, plate.entry.start), to = Math.min(entry.renderEnd, plate.entry.renderEnd);
    // Transitions on the plate (its own in, the next plate's in) may fade the set with it.
    const passing = [];
    const pIn = plate.entry.transitionIn;
    if (pIn && pIn.type !== "cut") passing.push([plate.entry.start, plate.entry.start + pIn.dur]);
    if (plate.entry.renderEnd > plate.entry.end + 1e-6) passing.push([plate.entry.end, plate.entry.renderEnd]);
    const inPassage = (t) => passing.some(([a, b]) => t >= a - 1e-6 && t <= b + 1e-6);
    let moved = null, faded = null;
    for (const t of times(from, to - 1e-3, PHYSICS.step)) {
      const world = frameState(plateOps, t).get(`${beneath}-front`) ?? {};
      const state = frameState(ops, t);
      const cam = state.get(`${id}-cam`) ?? {};
      const dx = Math.abs((world.x ?? 0) - (cam.x ?? 0));
      const ds = Math.abs((world.scaleX ?? 1) - (cam.scaleX ?? 1));
      if (!moved && (dx > PHYSICS.px || ds > PHYSICS.scale)) moved = { t, dx: round(dx, 2), ds: round(ds, 4) };
      const opacity = state.get(id)?.opacity;
      if (!faded && Number.isFinite(opacity) && opacity > PHYSICS.fadeLow && opacity < PHYSICS.fadeHigh && !inPassage(t)) faded = { t, opacity: round(opacity, 2) };
    }
    if (moved) findings.push({ rule: "anchored-moves", severity: "error", at: moved.t, ids: [id, beneath], detail: `${id}'s ${c.set} slides ${moved.dx} px (scale ${moved.ds}) against the plate ${beneath}'s front layer; an anchored set moves only with the plate camera` });
    if (faded) findings.push({ rule: "set-fades", severity: "error", at: faded.t, ids: [id, beneath], detail: `${id}'s ${c.set} is at ${faded.opacity} opacity over the plate ${beneath}, which is already there; it should arrive and leave with the plate (a cut, or the plate's own transition)` });
  }
  return gateResult(findings);
}

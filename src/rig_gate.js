// The rig gate (docs/ANIMATION_MEASUREMENT.md, "Per-frame rig"): scenes drawn
// by the per-frame rig (a resolved model with content.rigScene) are sampled at
// the story's fps and measured (kit/core/characters/rig-metrics.mjs) against
// src/rig_thresholds.json. Skipped when no scene uses the per-frame rig.
//
//   rigScenes(story)            → [{id, start, end, plan}]
//   rigGate(story, {scenes?})   → {status, errors, warnings, findings, scenes, measured, next}

import { readFileSync } from "node:fs";
import { measureRigScene, rigFindings, rigSummary, sampleRigScene } from "@launchclip/core/characters/rig-metrics.mjs";
import { renderedModels } from "./direction_guardrails.js";

export const RIG_THRESHOLDS = JSON.parse(readFileSync(new URL("./rig_thresholds.json", import.meta.url), "utf8"));

const NEXT = "Fix the scene's rig plan (content.rigScene): a sliding foot or a stretched bone is a walk or hand path the legs or arms cannot reach (shorter steps, a closer target); a grip loss or a jumping prop is a prop path whose holder key does not meet the hand (move the key to when the hand arrives, or add the throw's flight as `at` keys). Then run finish again.";

export const storyFps = (story) => Number(story?.resolved?.fps ?? story?.format?.fps ?? 30) || 30;

/** The scenes whose resolved model carries a per-frame rig plan. */
export function rigScenes(story) {
  const out = [];
  for (const [id, { entry, model }] of renderedModels(story).entries) {
    const plan = model?.content?.rigScene;
    if (plan && Array.isArray(plan.actors)) out.push({ id, start: Number(entry.start) || 0, end: Number(entry.renderEnd ?? entry.end), plan });
  }
  return out;
}

/** Each rig scene measured: [{id, start, end, measures}]. */
export function measureRigScenes(scenes, { fps = 30, thresholds = RIG_THRESHOLDS } = {}) {
  return scenes.map((scene) => ({ ...scene, measures: measureRigScene(sampleRigScene(scene.plan, { fps, duration: scene.end - scene.start }), thresholds) }));
}

export function rigGate(story, { scenes = rigScenes(story), thresholds = RIG_THRESHOLDS } = {}) {
  if (!scenes.length) return { status: "skipped", reason: "no scene uses the per-frame rig" };
  const findings = [];
  const measured = {};
  for (const scene of measureRigScenes(scenes, { fps: storyFps(story), thresholds })) {
    measured[scene.id] = rigSummary(scene.measures);
    for (const finding of rigFindings(scene.measures, thresholds)) {
      findings.push({ ...finding, ids: [scene.id], ...(finding.at === undefined ? {} : { at: Math.round((scene.start + finding.at) * 100) / 100 }), detail: `${scene.id}: ${finding.detail}` });
    }
  }
  findings.sort((a, b) => (a.severity === "error" ? 0 : 1) - (b.severity === "error" ? 0 : 1));
  const errors = findings.filter((finding) => finding.severity === "error").length;
  return { status: errors ? "failed" : "passed", errors, warnings: findings.length - errors, findings: findings.slice(0, 40), scenes: scenes.length, measured, ...(findings.length ? { next: NEXT } : {}) };
}

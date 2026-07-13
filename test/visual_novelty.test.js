import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  compareVisualFingerprints,
  deriveCreativeInputSignature,
  fingerprintProductionPlan,
  loadVisualNoveltyContext,
  writeVisualFingerprint
} from "../src/visual_novelty.js";

test("derives a stable creative seed from content and brand inputs", () => {
  const intake = sampleIntake("Explain the release cycle");
  const evidence = sampleEvidence("Models ship in a weekly cycle.");
  const first = deriveCreativeInputSignature(intake, evidence);
  const second = deriveCreativeInputSignature(structuredClone(intake), structuredClone(evidence));
  const changed = deriveCreativeInputSignature(sampleIntake("Explain how teams filter releases"), evidence);
  assert.equal(first, second);
  assert.notEqual(first, changed);
});

test("measures plan similarity from concepts, constructs, motion, and presenter rhythm", () => {
  const transit = fingerprintProductionPlan(samplePlan("transit"), "input-a");
  const transitAgain = fingerprintProductionPlan(samplePlan("transit"), "input-a");
  const workshop = fingerprintProductionPlan(samplePlan("workshop"), "input-b");
  assert.equal(compareVisualFingerprints(transit, transitAgain), 1);
  assert.ok(compareVisualFingerprints(transit, workshop) < 0.45);
});

test("reproduces exact inputs, differentiates new scripts, and freezes history for retries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-novelty-"));
  const historyDir = path.join(root, ".launchclip");
  const firstWorkspace = path.join(historyDir, "first");
  await mkdir(path.join(firstWorkspace, "production"), { recursive: true });
  const intake = sampleIntake("Explain the release cycle");
  const evidence = sampleEvidence("Models ship in a weekly cycle.");
  const first = await loadVisualNoveltyContext(firstWorkspace, { intake, evidence, historyDir });
  assert.equal(first.mode, "differentiate");
  await writeVisualFingerprint(firstWorkspace, samplePlan("transit"), first);

  const repeatedWorkspace = path.join(historyDir, "repeated");
  const repeated = await loadVisualNoveltyContext(repeatedWorkspace, { intake, evidence, historyDir });
  assert.equal(repeated.mode, "reproduce");
  assert.equal(repeated.reproduce_from.episode_concept, "A release transit system");

  const differentWorkspace = path.join(historyDir, "different");
  const differentIntake = sampleIntake("Explain how teams filter releases");
  const different = await loadVisualNoveltyContext(differentWorkspace, { intake: differentIntake, evidence, historyDir });
  assert.equal(different.mode, "differentiate");
  assert.equal(different.avoid_recent.length, 1);
  assert.equal(different.avoid_recent[0].episode_concept, "A release transit system");

  await writeVisualFingerprint(repeatedWorkspace, samplePlan("workshop"), repeated);
  const frozen = await loadVisualNoveltyContext(differentWorkspace, { intake: differentIntake, evidence, historyDir });
  assert.deepEqual(frozen, different, "a workspace keeps one novelty contract across retries");
});

function sampleIntake(prompt) {
  return {
    source: { kind: "voiceover" },
    brief: { prompt, audience: "builders", language: "en", style: { family: "soft-editorial", source: "preset" } },
    resources: [{ id: "presenter", role: "presenter", type: "video", sha256: "presenter-sha" }]
  };
}

function sampleEvidence(content) {
  return { items: [{ id: "evidence-1", role: "primary", claims_allowed: true, sha256: null, content }] };
}

function samplePlan(kind) {
  const transit = kind === "transit";
  return {
    design: {
      concept: transit ? "A release transit system" : "A toolmaker's filtering workbench",
      style_dna: { family: "soft-editorial", transition_vocabulary: transit ? ["track push", "route wipe"] : ["bench rotation", "material fold"] }
    },
    shots: [
      {
        presenter: { mode: transit ? "anchor" : "voiceover" },
        transition_out: transit ? "follow the route" : "rotate the workbench",
        visual: {
          representation: transit ? "network" : "process",
          concept: transit ? "Releases branch through a transit map" : "Tools are tested and sorted on a workbench",
          world: transit ? "A living metro system" : "A tactile maker studio",
          composition: transit ? "Radial interchange" : "Layered assembly line",
          objects: [{ kind: transit ? "connector" : "container" }, { kind: transit ? "diagram-node" : "metric" }],
          events: [{ motion_verb: transit ? "routes" : "stamps", visible_change: transit ? "connect" : "transform" }]
        }
      },
      {
        presenter: { mode: transit ? "companion" : "anchor" },
        transition_out: transit ? "platform pass" : "tool rack reveal",
        visual: {
          representation: transit ? "timeline" : "comparison",
          concept: transit ? "The week travels station by station" : "Useful tools separate from noise",
          world: transit ? "A moving platform" : "A sorting bench",
          composition: transit ? "Longitudinal track" : "Asymmetric work surface",
          objects: [{ kind: transit ? "timeline" : "metric" }],
          events: [{ motion_verb: transit ? "travels" : "locks", visible_change: transit ? "move" : "fill" }]
        }
      }
    ]
  };
}

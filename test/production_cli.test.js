import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runProduction, runProductionStage } from "../src/production_cli.js";

test("runs the delegated production DAG in dependency order and stops for approval", async () => {
  const calls = [];
  const adapters = {
    withProductionLease: async (_workspace, operation) => { calls.push("lease"); return operation(); },
    buildIntake: async () => { calls.push("normalize"); return { workspace: "/tmp/workspace" }; },
    writeIntake: async () => { calls.push("intake"); return { workspace: "/tmp/workspace" }; },
    collectEvidence: async () => { calls.push("evidence"); return { items: 3 }; },
    analyzeSourceMedia: async () => { calls.push("source-media"); return { analyses: 1 }; },
    planProduction: async () => { calls.push("plan"); return { shots: 2 }; },
    produceAudio: async (_workspace, options) => { calls.push(["audio", options]); return { status: "ready", voiceover: "/tmp/voice.mp3", music: "/tmp/music.mp3", sfx: "/tmp/sfx.json", warnings: [] }; },
    directFrames: async () => { calls.push("frames"); return { generated: 2, cached: 0 }; },
    assembleHyperFrames: async (_workspace, options) => { calls.push(["assemble", options]); return { index: "/tmp/workspace/production/hyperframes/index.html" }; },
    renderDraftProduction: async () => { calls.push("draft"); return { status: "ready", video: "/tmp/draft.mp4", verification: { snapshots: "/tmp/workspace/production/qa/snapshots" }, critique: { verdict: "ship" } }; }
  };
  const result = await runProduction("owner/repo", { "no-audio": true, concurrency: "2" }, adapters);
  assert.equal(result.status, "awaiting-approval");
  assert.deepEqual(calls.map((entry) => Array.isArray(entry) ? entry[0] : entry), ["normalize", "lease", "intake", "evidence", "source-media", "plan", "audio", "frames", "assemble", "draft"]);
  assert.equal(calls[6][1].noVoice, true);
  assert.equal(calls[6][1].noMusic, true);
  assert.equal(calls[6][1].noSfx, true);
  assert.equal(calls[8][1].voiceover, "/tmp/voice.mp3");
  assert.match(result.next, /production-render/);
});

test("runs bounded critic-directed repairs before asking for human approval", async () => {
  const calls = [];
  let drafts = 0;
  const adapters = {
    withProductionLease: async (_workspace, operation) => operation(),
    buildIntake: async () => ({ workspace: "/tmp/workspace" }),
    writeIntake: async () => ({ workspace: "/tmp/workspace" }),
    collectEvidence: async () => ({}), analyzeSourceMedia: async () => ({}), planProduction: async () => ({}),
    produceAudio: async () => ({ status: "ready", voiceover: null, music: null, sfx: null, warnings: [] }),
    directFrames: async () => ({ generated: 2, cached: 0 }),
    assembleHyperFrames: async () => { calls.push("assemble"); return { index: "/tmp/index.html" }; },
    renderDraftProduction: async () => {
      calls.push("draft"); drafts += 1;
      const verdict = drafts === 1 ? "repair" : "ship";
      return { status: verdict === "ship" ? "ready" : "needs-repair", video: "/tmp/draft.mp4", verification: { snapshots: "/tmp/snapshots" }, critique: { verdict } };
    },
    repairProduction: async () => { calls.push("repair"); return { status: "repaired", repaired: [{ shot_id: "shot-2" }] }; }
  };
  const result = await runProduction("owner/repo", {}, adapters);
  assert.equal(result.status, "awaiting-approval");
  assert.deepEqual(calls, ["assemble", "draft", "repair", "assemble", "draft"]);
  assert.equal(result.repairs.length, 1);
  assert.equal(result.repairs[0].pass, 1);
  assert.equal(result.repairs[0].trigger, "critique");
});

test("automatically repairs deterministic verification failures before rendering a draft", async () => {
  const calls = [];
  let repairOptions;
  let drafts = 0;
  const adapters = {
    withProductionLease: async (_workspace, operation) => operation(),
    buildIntake: async () => ({ workspace: "/tmp/workspace" }),
    writeIntake: async () => ({ workspace: "/tmp/workspace" }),
    collectEvidence: async () => ({}), analyzeSourceMedia: async () => ({}), planProduction: async () => ({}),
    produceAudio: async () => ({ status: "ready", voiceover: null, music: null, sfx: null, warnings: [] }),
    directFrames: async () => ({ generated: 2, cached: 0 }),
    assembleHyperFrames: async () => { calls.push("assemble"); return { index: "/tmp/index.html" }; },
    renderDraftProduction: async () => {
      calls.push("draft"); drafts += 1;
      if (drafts === 1) {
        throw Object.assign(new Error("native QA failed"), {
          code: "LAUNCHCLIP_PRODUCTION_VERIFICATION_FAILED",
          verification: { stage: "production-verify", status: "failed", failed: ["inspect:shot-2"], qa: "/tmp/qa" }
        });
      }
      return { status: "ready", video: "/tmp/draft.mp4", verification: { status: "ready", snapshots: "/tmp/snapshots" }, critique: { verdict: "ship" } };
    },
    fallbackFramesForVerification: async (_workspace, options) => { calls.push("local-fallback"); repairOptions = options; return { status: "repaired", repaired: [{ shot_id: "shot-2" }] }; },
    repairProduction: async () => { calls.push("paid-repair"); return { status: "repaired", repaired: [] }; }
  };
  const result = await runProduction("owner/repo", {}, adapters);
  assert.equal(result.status, "awaiting-approval");
  assert.deepEqual(calls, ["assemble", "draft", "local-fallback", "assemble", "draft"]);
  assert.equal(result.repairs.length, 0);
  assert.equal(result.local_repairs.length, 1);
  assert.deepEqual(repairOptions.failed, ["inspect:shot-2"]);
});

test("stops infrastructure verification failures without fallback or paid repair calls", async () => {
  const calls = [];
  const adapters = {
    withProductionLease: async (_workspace, operation) => operation(),
    buildIntake: async () => ({ workspace: "/tmp/workspace" }),
    writeIntake: async () => ({ workspace: "/tmp/workspace" }),
    collectEvidence: async () => ({}), analyzeSourceMedia: async () => ({}), planProduction: async () => ({}),
    produceAudio: async () => ({ status: "ready", voiceover: null, music: null, sfx: null, warnings: [] }),
    directFrames: async () => ({ generated: 1, cached: 0 }),
    assembleHyperFrames: async () => { calls.push("assemble"); return {}; },
    renderDraftProduction: async () => {
      calls.push("draft");
      throw Object.assign(new Error("verifier contract mismatch"), {
        code: "LAUNCHCLIP_PRODUCTION_INFRASTRUCTURE_FAILED",
        verification: { status: "failed", failed: ["inspect:shot-1"], infrastructure_failed: ["inspect:shot-1"], qa: "/tmp/qa" }
      });
    },
    fallbackFramesForVerification: async () => { calls.push("local-fallback"); return { repaired: [] }; },
    repairProduction: async () => { calls.push("paid-repair"); return { repaired: [] }; }
  };
  await assert.rejects(() => runProduction("owner/repo", {}, adapters), (error) => error.code === "LAUNCHCLIP_PRODUCTION_INFRASTRUCTURE_FAILED");
  assert.deepEqual(calls, ["assemble", "draft"]);
});

test("blocks standalone paid repair for a recorded infrastructure failure", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-infrastructure-repair-"));
  await mkdir(path.join(workspace, "production", "qa"), { recursive: true });
  await writeFile(path.join(workspace, "production", "qa", "verification.json"), JSON.stringify({
    status: "failed",
    failed: ["inspect:shot-1"],
    infrastructure_failed: ["inspect:shot-1"]
  }));
  let repairCalls = 0;
  await assert.rejects(() => runProductionStage("production-repair", workspace, {}, {
    withProductionLease: async (_workspace, operation) => operation(),
    repairProduction: async () => { repairCalls += 1; }
  }), (error) => error.code === "LAUNCHCLIP_PRODUCTION_INFRASTRUCTURE_FAILED");
  assert.equal(repairCalls, 0);
});

test("stops a persistent verification repair loop at the configured bound", async () => {
  const calls = [];
  const adapters = {
    withProductionLease: async (_workspace, operation) => operation(),
    buildIntake: async () => ({ workspace: "/tmp/workspace" }), writeIntake: async () => ({ workspace: "/tmp/workspace" }),
    collectEvidence: async () => ({}), analyzeSourceMedia: async () => ({}), planProduction: async () => ({}),
    produceAudio: async () => ({ status: "ready", voiceover: null, music: null, sfx: null, warnings: [] }),
    directFrames: async () => ({ generated: 1, cached: 0 }),
    assembleHyperFrames: async () => { calls.push("assemble"); return {}; },
    renderDraftProduction: async () => {
      calls.push("draft");
      throw Object.assign(new Error("still failing"), { code: "LAUNCHCLIP_PRODUCTION_VERIFICATION_FAILED", verification: { status: "failed", failed: ["inspect:shot-1"], qa: "/tmp/qa" } });
    },
    fallbackFramesForVerification: async () => ({ status: "not-applicable", repaired: [] }),
    repairProduction: async () => { calls.push("repair"); return { status: "repaired", repaired: [{ shot_id: "shot-1" }] }; }
  };
  const result = await runProduction("owner/repo", { "max-repair-passes": "1" }, adapters);
  assert.equal(result.status, "needs-repair");
  assert.equal(result.draft, null);
  assert.equal(result.repairs.length, 1);
  assert.deepEqual(calls, ["assemble", "draft", "repair", "assemble", "draft"]);
  assert.match(result.next, /\/tmp\/qa/);
});

test("executes the full audio, frame, assembly, and draft closure after a replan verdict", async () => {
  const calls = [];
  let drafts = 0;
  const adapters = {
    withProductionLease: async (_workspace, operation) => operation(),
    buildIntake: async () => ({ workspace: "/tmp/workspace" }), writeIntake: async () => ({ workspace: "/tmp/workspace" }),
    collectEvidence: async () => ({}), analyzeSourceMedia: async () => ({}),
    planProduction: async () => { calls.push("plan"); return { revision: 0 }; },
    produceAudio: async () => { calls.push("audio"); return { status: "ready", voiceover: "/tmp/voice.mp3", music: "/tmp/music.mp3", sfx: "/tmp/sfx.json", warnings: [] }; },
    directFrames: async () => { calls.push("frames"); return { generated: 2, cached: 0 }; },
    assembleHyperFrames: async () => { calls.push("assemble"); return {}; },
    renderDraftProduction: async () => {
      calls.push("draft"); drafts += 1;
      const verdict = drafts === 1 ? "replan" : "ship";
      return { status: verdict === "ship" ? "ready" : "needs-repair", video: "/tmp/draft.mp4", verification: { status: "ready", snapshots: "/tmp/snapshots" }, critique: { verdict } };
    },
    repairProduction: async () => { calls.push("repair-plan"); return { status: "replanned", repaired: [], plan: { revision: 1 }, actions: { plan_revised: true, audio: "regenerate", frames: "all", assemble: true } }; }
  };
  const result = await runProduction("owner/repo", {}, adapters);
  assert.equal(result.status, "awaiting-approval");
  assert.deepEqual(calls, ["plan", "audio", "frames", "assemble", "draft", "repair-plan", "audio", "frames", "assemble", "draft"]);
  assert.equal(result.plan.revision, 1);
  assert.equal(result.repairs[0].trigger, "critique");
});

test("fast eval keeps full QA while lowering provider and sampling budgets", async () => {
  const received = {};
  const adapters = {
    withProductionLease: async (_workspace, operation) => operation(),
    buildIntake: async (_source, flags) => { received.intake = flags; return { workspace: "/tmp/workspace" }; },
    writeIntake: async () => ({ workspace: "/tmp/workspace" }),
    collectEvidence: async () => ({}),
    analyzeSourceMedia: async (_workspace, options) => { received.media = options; return {}; },
    planProduction: async (_workspace, options) => { received.plan = options; return {}; },
    produceAudio: async () => ({ status: "ready", voiceover: null, music: null, sfx: null, warnings: [] }),
    directFrames: async (_workspace, options) => { received.frames = options; return { generated: 1, cached: 0 }; },
    assembleHyperFrames: async () => ({ index: "/tmp/index.html" }),
    renderDraftProduction: async (_workspace, options) => { received.draft = options; return { status: "ready", video: "/tmp/draft.mp4", verification: { snapshots: "/tmp/snapshots" }, critique: { verdict: "ship" } }; }
  };
  await runProduction("owner/repo", { "fast-eval": true, "no-audio": true }, adapters);
  assert.equal(received.intake.reasoning, "high");
  assert.equal(received.media.samples, 8);
  assert.equal(received.media.reasoning, "medium");
  assert.equal(received.plan.maxOutputTokens, 32000);
  assert.equal(received.plan.planningMode, "auto");
  assert.equal(received.plan.hierarchicalThresholdSeconds, 180);
  assert.equal(received.plan.outlineMaxOutputTokens, 18000);
  assert.equal(received.plan.chapterMaxOutputTokens, 28000);
  assert.equal(received.plan.chapterConcurrency, 3);
  assert.equal(received.plan.semanticAttempts, 2);
  assert.deepEqual({ reasoning: received.frames.reasoning, max: received.frames.maxOutputTokens, attempts: received.frames.semanticAttempts, concurrency: received.frames.concurrency }, { reasoning: "medium", max: 20000, attempts: 1, concurrency: 3 });
  assert.equal(received.draft.snapshotFrames, 6);
  assert.equal(received.draft.inspectSamples, 9);
  assert.equal(received.draft.shotInspectConcurrency, 3);
  assert.equal(received.draft.criticReasoning, "high");
});

test("routes explicit hierarchical, repair, and visual novelty planning controls", async () => {
  let received;
  const result = await runProductionStage("creative-plan", "/tmp/workspace", { "planning-mode": "hierarchical", "hierarchical-threshold": "120", "chapter-concurrency": "4", "outline-max-output-tokens": "22000", "chapter-max-output-tokens": "36000", "plan-semantic-attempts": "3", "visual-history-dir": "/tmp/brand-history", "visual-history-limit": "12", "visual-similarity-limit": "0.42" }, {
    withProductionLease: async (_workspace, operation) => operation(),
    planProduction: async (_workspace, options) => { received = options; return { status: "ready" }; }
  });
  assert.equal(result.status, "ready");
  assert.equal(received.planningMode, "hierarchical");
  assert.equal(received.hierarchicalThresholdSeconds, 120);
  assert.equal(received.chapterConcurrency, 4);
  assert.equal(received.outlineMaxOutputTokens, 22000);
  assert.equal(received.chapterMaxOutputTokens, 36000);
  assert.equal(received.semanticAttempts, 3);
  assert.equal(received.visualHistoryDir, "/tmp/brand-history");
  assert.equal(received.visualHistoryLimit, 12);
  assert.equal(received.visualSimilarityLimit, 0.42);
});

test("blocks assembly when measured narration timing requires a replan", async () => {
  let framesCalled = false;
  const adapters = {
    withProductionLease: async (_workspace, operation) => operation(),
    buildIntake: async () => ({ workspace: "/tmp/workspace" }),
    writeIntake: async () => ({ workspace: "/tmp/workspace" }),
    collectEvidence: async () => ({}),
    analyzeSourceMedia: async () => ({}),
    planProduction: async () => ({}),
    produceAudio: async () => ({ status: "needs-retiming", warnings: ["Narration is four seconds long."] }),
    directFrames: async () => { framesCalled = true; }
  };
  await assert.rejects(() => runProduction("owner/repo", {}, adapters), /Re-run creative planning/);
  assert.equal(framesCalled, false);
});

test("routes production repair with scoped model controls", async () => {
  let received;
  const result = await runProductionStage("production-repair", "/tmp/workspace", { "repair-model": "gpt-5.6", "repair-reasoning": "xhigh", "repair-semantic-attempts": "3", "repair-snapshots": "6", concurrency: "2" }, {
    withProductionLease: async (_workspace, operation) => operation(),
    repairProduction: async (workspace, options) => { received = { workspace, options }; return { status: "repaired" }; }
  });
  assert.equal(result.status, "repaired");
  assert.equal(received.workspace, "/tmp/workspace");
  assert.equal(received.options.reasoning, "xhigh");
  assert.equal(received.options.semanticAttempts, 3);
  assert.equal(received.options.maxSnapshots, 6);
  assert.equal(received.options.concurrency, 2);
});

test("routes an independently rerunnable analyzed draft stage", async () => {
  let received;
  const result = await runProductionStage("production-draft", "/tmp/workspace", { "draft-quality": "draft", "reference-video": "/tmp/reference.mp4", "shot-inspect-concurrency": "4" }, {
    withProductionLease: async (_workspace, operation) => operation(),
    renderDraftProduction: async (workspace, options) => { received = { workspace, options }; return { status: "ready", video: "/tmp/draft.mp4" }; }
  });
  assert.equal(result.status, "ready");
  assert.equal(received.workspace, "/tmp/workspace");
  assert.equal(received.options.draftQuality, "draft");
  assert.equal(received.options.references, "/tmp/reference.mp4");
  assert.equal(received.options.shotInspectConcurrency, 4);
});

test("infers fresh verification context for standalone production repair", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-standalone-repair-"));
  const qa = path.join(workspace, "production", "qa");
  await mkdir(qa, { recursive: true });
  const verification = {
    schema_version: "launchclip.production-verification.v2",
    status: "failed",
    failed: ["inspect:shot-1"],
    inputs: { options: { strict_all: true, validate_timeout_ms: 12_000, inspect_samples: 17, snapshot_frames: 9 } }
  };
  await writeFile(path.join(qa, "verification.json"), `${JSON.stringify(verification)}\n`);
  let received;
  let freshnessChecked = false;
  await runProductionStage("production-repair", workspace, {}, {
    withProductionLease: async (_workspace, operation) => operation(),
    assertVerificationFresh: async (_workspace, value, options) => {
      freshnessChecked = true;
      assert.deepEqual(value.failed, ["inspect:shot-1"]);
      assert.deepEqual(options, { strictAll: true, timeoutMs: 12_000, inspectSamples: 17, snapshotFrames: 9 });
    },
    repairProduction: async (_workspace, options) => { received = options; return { status: "repaired" }; }
  });
  assert.equal(freshnessChecked, true);
  assert.equal(received.trigger, "verification");
  assert.deepEqual(received.verification.failed, ["inspect:shot-1"]);
});

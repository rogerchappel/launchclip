import assert from "node:assert/strict";
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
    repairProduction: async () => { calls.push("repair"); return { status: "repaired", repaired: [{ shot_id: "shot-2" }] }; }
  };
  const result = await runProduction("owner/repo", {}, adapters);
  assert.equal(result.status, "awaiting-approval");
  assert.deepEqual(calls, ["assemble", "draft", "repair", "assemble", "draft"]);
  assert.equal(result.repairs[0].trigger, "verification");
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
    repairProduction: async () => { calls.push("repair"); return { status: "repaired", repaired: [{ shot_id: "shot-1" }] }; }
  };
  const result = await runProduction("owner/repo", { "max-repair-passes": "1" }, adapters);
  assert.equal(result.status, "needs-repair");
  assert.equal(result.draft, null);
  assert.equal(result.repairs.length, 1);
  assert.deepEqual(calls, ["assemble", "draft", "repair", "assemble", "draft"]);
  assert.match(result.next, /\/tmp\/qa/);
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
  assert.deepEqual({ reasoning: received.frames.reasoning, max: received.frames.maxOutputTokens, attempts: received.frames.semanticAttempts, concurrency: received.frames.concurrency }, { reasoning: "medium", max: 20000, attempts: 1, concurrency: 3 });
  assert.equal(received.draft.snapshotFrames, 6);
  assert.equal(received.draft.inspectSamples, 9);
  assert.equal(received.draft.shotInspectConcurrency, 3);
  assert.equal(received.draft.criticReasoning, "high");
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

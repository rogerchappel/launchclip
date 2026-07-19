import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runProduction, runProductionStage } from "../src/production_cli.js";
import { FREE_VISION_UNAVAILABLE_CODE } from "../src/production_critic.js";
import { prepareSourceMedia } from "../src/production_source_media.js";
import { launchHyperFramesStudio, openProductionPreview } from "../src/production_preview.js";

test("prepares authoritative media before downstream timing and keeps the original derivation", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-source-preprocess-"));
  const production = path.join(workspace, "production");
  const input = path.join(workspace, "source.mov");
  await mkdir(production, { recursive: true });
  await writeFile(input, "source-media");
  await writeFile(path.join(production, "intake.json"), JSON.stringify({
    source: { kind: "voiceover", value: input, location: input },
    brief: { duration_seconds: 60 },
    resources: [
      { id: "01-source", role: "voiceover", type: "video", location: input, source: input, is_remote: false, sha256: null },
      { id: "02-source", role: "presenter", type: "video", location: input, source: input, is_remote: false, sha256: null }
    ]
  }));
  const result = await prepareSourceMedia(workspace, {}, {
    trimMediaSilence: async (_source, output) => {
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, "trimmed-media");
      return { changed: true, output, trim: { start: 0.4, end: 9.6 }, source_duration_seconds: 10, rendered_duration_seconds: 9.2 };
    }
  });
  const intake = JSON.parse(await readFile(path.join(production, "intake.json"), "utf8"));
  assert.equal(result.changed, true);
  assert.equal(intake.brief.duration_seconds, 9.2);
  assert.equal(intake.resources[0].location, result.output);
  assert.equal(intake.resources[1].location, result.output);
  assert.equal(intake.resources[0].derived_from, input);
  assert.equal(intake.source.derived_from, input);
});

test("runs the delegated production DAG in dependency order and stops for approval", async () => {
  const calls = [];
  const adapters = {
    withProductionLease: async (_workspace, operation) => { calls.push("lease"); return operation(); },
    buildIntake: async () => { calls.push("normalize"); return { workspace: "/tmp/workspace" }; },
    writeIntake: async () => { calls.push("intake"); return { workspace: "/tmp/workspace" }; },
    prepareSourceMedia: async () => { calls.push("source-preprocess"); return { status: "ready" }; },
    collectEvidence: async () => { calls.push("evidence"); return { items: 3 }; },
    analyzeSourceMedia: async () => { calls.push("source-media"); return { analyses: 1 }; },
    resolveProductionEntities: async () => { calls.push("entities"); return { matches: 2 }; },
    planProduction: async () => { calls.push("plan"); return { shots: 2 }; },
    produceAudio: async (_workspace, options) => { calls.push(["audio", options]); return { status: "ready", voiceover: "/tmp/voice.mp3", music: "/tmp/music.mp3", sfx: "/tmp/sfx.json", warnings: [] }; },
    directFrames: async () => { calls.push("frames"); return { generated: 2, cached: 0 }; },
    assembleHyperFrames: async (_workspace, options) => { calls.push(["assemble", options]); return { index: "/tmp/workspace/production/hyperframes/index.html" }; },
    renderDraftProduction: async () => { calls.push("draft"); return { status: "ready", video: "/tmp/draft.mp4", verification: { snapshots: "/tmp/workspace/production/qa/snapshots" }, critique: { verdict: "ship" } }; }
  };
  const result = await runProduction("owner/repo", { "no-audio": true, concurrency: "2" }, adapters);
  assert.equal(result.status, "awaiting-approval");
  assert.deepEqual(calls.map((entry) => Array.isArray(entry) ? entry[0] : entry), ["normalize", "lease", "intake", "source-preprocess", "evidence", "source-media", "entities", "plan", "audio", "frames", "assemble", "draft"]);
  assert.equal(calls[8][1].noVoice, true);
  assert.equal(calls[8][1].noMusic, true);
  assert.equal(calls[8][1].noSfx, true);
  assert.equal(calls[10][1].voiceover, "/tmp/voice.mp3");
  assert.equal(calls[10][1].musicVolume, 0.15);
  assert.match(result.next, /production-render/);
});

test("runs the cinematic creative funnel and premium frame contract in one command", async () => {
  const calls = [];
  const profile = { id: "cinematic", readiness: { maximum_repair_passes: 3 } };
  const adapters = {
    withProductionLease: async (_workspace, operation) => operation(),
    buildIntake: async () => ({ workspace: "/tmp/cinematic-workspace", profile }),
    writeIntake: async () => ({ workspace: "/tmp/cinematic-workspace" }),
    prepareSourceMedia: async () => { calls.push("source-preprocess"); return {}; },
    collectEvidence: async () => { calls.push("evidence"); return {}; },
    analyzeSourceMedia: async () => { calls.push("source-media"); return {}; },
    resolveProductionEntities: async () => { calls.push("entities"); return {}; },
    planConceptTournament: async (_workspace, options) => { calls.push(["concepts", options]); return { selected_id: "concept-1" }; },
    writeRetentionStory: async (_workspace, options) => { calls.push(["story", options]); return { concept_id: "concept-1" }; },
    produceCinematicNarration: async (_workspace, options) => { calls.push(["narration", options]); return { duration_seconds: 44.2 }; },
    planProduction: async () => { calls.push("plan"); return { shots: 4 }; },
    produceAudio: async (_workspace, options) => { calls.push(["audio", options]); return { status: "ready", voiceover: null, music: null, sfx: null, warnings: [] }; },
    directFrames: async (_workspace, options) => { calls.push(["frames", options]); return { generated: 4, cached: 0 }; },
    assembleHyperFrames: async () => { calls.push("assemble"); return {}; },
    renderDraftProduction: async () => { calls.push("draft"); return { status: "ready", video: "/tmp/draft.mp4", verification: { status: "passed", snapshots: "/tmp/snapshots" }, readiness: { ok: true, status: "ready", repair_findings: [] }, critique: { verdict: "ship" } }; }
  };
  const result = await runProduction("A cinematic idea", { profile: "cinematic", "no-audio": true }, adapters);
  assert.equal(result.status, "awaiting-approval");
  assert.deepEqual(calls.map((entry) => Array.isArray(entry) ? entry[0] : entry), ["source-preprocess", "evidence", "source-media", "entities", "concepts", "story", "narration", "plan", "audio", "frames", "assemble", "draft"]);
  assert.equal(calls[6][1].noVoice, true);
  assert.equal(calls[8][1].noVoice, true);
  assert.equal(calls[9][1].sceneBlueprint, true);
  assert.equal(calls[9][1].allowFallback, false);
  assert.equal(calls[9][1].routes[0], "openai:gpt-5.6@high");
  assert.equal(result.creative_funnel.concepts.selected_id, "concept-1");
});

test("repairs critic-approved cinematic motion failure before approval", async () => {
  let drafts = 0;
  let receivedRepair;
  const readinessFinding = {
    id: "readiness-motion-1", severity: "major", category: "motion", shot_ids: [], start_seconds: null, end_seconds: null,
    evidence: "Opening motion is too sparse.", repair_scope: "plan", instruction: "Replan the opening cadence.", preserve: ["approved narration"]
  };
  const adapters = {
    withProductionLease: async (_workspace, operation) => operation(),
    buildIntake: async () => ({ workspace: "/tmp/cinematic-repair", profile: { id: "cinematic" } }),
    writeIntake: async () => ({ workspace: "/tmp/cinematic-repair" }),
    prepareSourceMedia: async () => ({}), collectEvidence: async () => ({}), analyzeSourceMedia: async () => ({}), resolveProductionEntities: async () => ({}),
    planConceptTournament: async () => ({}), writeRetentionStory: async () => ({}), produceCinematicNarration: async () => ({}), planProduction: async () => ({}),
    produceAudio: async () => ({ status: "ready", voiceover: null, music: null, sfx: null, warnings: [] }),
    directFrames: async () => ({ generated: 2, cached: 0 }), assembleHyperFrames: async () => ({}),
    renderDraftProduction: async () => {
      drafts += 1;
      return drafts === 1
        ? { status: "needs-repair", verification: { status: "passed" }, critique: { verdict: "ship" }, readiness: { ok: false, status: "needs-repair", repair_findings: [readinessFinding], receipt: "/tmp/readiness.json" } }
        : { status: "ready", verification: { status: "passed" }, critique: { verdict: "ship" }, readiness: { ok: true, status: "ready", repair_findings: [] } };
    },
    repairProduction: async (_workspace, options) => { receivedRepair = options; return { status: "replanned", repaired: [], actions: { plan_revised: true } }; }
  };
  const result = await runProduction("Cinematic idea", { profile: "cinematic", "no-audio": true }, adapters);
  assert.equal(result.status, "awaiting-approval");
  assert.equal(result.repairs[0].trigger, "readiness");
  assert.deepEqual(receivedRepair.renderQualityFindings, [readinessFinding]);
  assert.equal(drafts, 2);
});

test("review status cannot approve a cinematic task with failed readiness", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-cinematic-review-status-"));
  const qa = path.join(workspace, "production", "qa");
  await mkdir(qa, { recursive: true });
  await writeFile(path.join(workspace, "production", "intake.json"), JSON.stringify({ profile: { id: "cinematic" } }));
  await writeFile(path.join(qa, "verification.json"), JSON.stringify({ status: "passed", failed: [] }));
  await writeFile(path.join(qa, "critique.json"), JSON.stringify({ verdict: "ship", findings: [] }));
  await writeFile(path.join(qa, "cinematic-readiness.json"), JSON.stringify({ status: "needs-repair", ok: false, blockers: [{ id: "motion" }] }));
  const result = await runProductionStage("production-review", workspace, {}, {
    withProductionLease: async (_workspace, operation) => operation(),
    runProductionReview: async (target, _options, controls) => controls.getStatus(target)
  });
  assert.equal(result.status, "needs-repair");
  assert.equal(result.readiness.ok, false);
});

test("continues produce into review only when explicitly requested", async () => {
  const calls = [];
  const adapters = {
    withProductionLease: async (_workspace, operation) => { calls.push("lease"); return operation(); },
    buildIntake: async () => ({ workspace: "/tmp/workspace" }),
    writeIntake: async () => ({ workspace: "/tmp/workspace" }),
    prepareSourceMedia: async () => ({}), collectEvidence: async () => ({}), analyzeSourceMedia: async () => ({}), resolveProductionEntities: async () => ({}), planProduction: async () => ({}),
    produceAudio: async () => ({ status: "ready", voiceover: null, music: null, sfx: null, warnings: [] }),
    directFrames: async () => ({ generated: 1, cached: 0 }),
    assembleHyperFrames: async () => ({}),
    renderDraftProduction: async () => ({ status: "ready", video: "/tmp/draft.mp4", verification: { snapshots: "/tmp/snapshots" }, critique: { verdict: "ship" } }),
    runProductionReview: async (workspace, options) => {
      calls.push("review");
      assert.equal(workspace, "/tmp/workspace");
      assert.equal(options.initial.status, "awaiting-approval");
      return { stage: "production-review", status: "awaiting-approval", action: "saved" };
    }
  };
  const result = await runProduction("owner/repo", { review: true }, adapters);
  assert.equal(result.stage, "production-review");
  assert.deepEqual(calls, ["lease", "review"]);
});

test("wires review changes through critique, repair, rebuild, and approved render", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-production-review-"));
  const calls = [];
  const result = await runProductionStage("production-review", workspace, { port: "3555", "critic-route": "openrouter:openrouter/free@none" }, {
    withProductionLease: async (_workspace, operation) => { calls.push("lease"); return operation(); },
    runProductionReview: async (target, options, controls) => {
      assert.equal(options.initial, null);
      assert.equal((await controls.getStatus(target)).status, "needs-repair");
      await controls.openPreview(target);
      const revision = await controls.revise(target, { humanReviewRequest: "Increase the title size." });
      assert.equal(revision.status, "awaiting-approval");
      return controls.approve(target);
    },
    openProductionPreview: async (_target, options) => { calls.push(["preview", options]); return { status: "awaiting-approval" }; },
    critiqueProduction: async (_target, options) => { assert.equal(options.route, "openrouter:openrouter/free@none"); calls.push(["critique", options.humanReviewRequest]); return { verdict: "repair", findings: 1 }; },
    repairProduction: async (_target, options) => { calls.push(["repair", options.trigger]); return { status: "repaired", repaired: [{ shot_id: "shot-1" }] }; },
    assembleHyperFrames: async () => { calls.push("assemble"); return { status: "ready" }; },
    renderDraftProduction: async () => { calls.push("draft"); return { status: "ready", critique: { verdict: "ship", findings: 0 } }; },
    renderProduction: async (_target, options) => { assert.equal(options.criticRoute, "openrouter:openrouter/free@none"); calls.push(["render", options.approve]); return { status: "awaiting-human-review", video: "/tmp/final.mp4" }; }
  });
  assert.equal(result.status, "awaiting-human-review");
  assert.deepEqual(calls, [
    ["preview", { port: "3555", open: true }],
    "lease",
    ["critique", "Increase the title size."],
    ["repair", "critique"],
    "assemble",
    "draft",
    "lease",
    ["render", true]
  ]);
});

test("blocks a human-request critic call when review verification failed in infrastructure", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-review-infrastructure-"));
  const qa = path.join(workspace, "production", "qa");
  await mkdir(qa, { recursive: true });
  await writeFile(path.join(qa, "verification.json"), JSON.stringify({
    status: "failed",
    failed: ["inspect:shot-1"],
    infrastructure_failed: ["inspect:shot-1"]
  }));
  let criticCalls = 0;
  await assert.rejects(() => runProductionStage("production-review", workspace, {}, {
    withProductionLease: async (_workspace, operation) => operation(),
    runProductionReview: async (target, _options, controls) => controls.revise(target, { humanReviewRequest: "Make the title larger." }),
    critiqueProduction: async () => { criticCalls += 1; }
  }), (error) => error.code === "LAUNCHCLIP_PRODUCTION_INFRASTRUCTURE_FAILED");
  assert.equal(criticCalls, 0);
});

test("runs bounded critic-directed repairs before asking for human approval", async () => {
  const calls = [];
  let drafts = 0;
  const adapters = {
    withProductionLease: async (_workspace, operation) => operation(),
    buildIntake: async () => ({ workspace: "/tmp/workspace" }),
    writeIntake: async () => ({ workspace: "/tmp/workspace" }),
    prepareSourceMedia: async () => ({ status: "not-applicable" }),
    collectEvidence: async () => ({}), analyzeSourceMedia: async () => ({}), resolveProductionEntities: async () => ({}), planProduction: async () => ({}),
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

test("automatically routes verification failures through model-authored repair", async () => {
  const calls = [];
  let repairOptions;
  let drafts = 0;
  const adapters = {
    withProductionLease: async (_workspace, operation) => operation(),
    buildIntake: async () => ({ workspace: "/tmp/workspace" }),
    writeIntake: async () => ({ workspace: "/tmp/workspace" }),
    prepareSourceMedia: async () => ({ status: "not-applicable" }),
    collectEvidence: async () => ({}), analyzeSourceMedia: async () => ({}), resolveProductionEntities: async () => ({}), planProduction: async () => ({}),
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
    fallbackFramesForVerification: async () => { throw new Error("must not replace authored frames with deterministic fallbacks"); },
    repairProduction: async (_workspace, options) => { calls.push("model-repair"); repairOptions = options; return { status: "repaired", repaired: [{ shot_id: "shot-2" }] }; }
  };
  const result = await runProduction("owner/repo", {}, adapters);
  assert.equal(result.status, "awaiting-approval");
  assert.deepEqual(calls, ["assemble", "draft", "model-repair", "assemble", "draft"]);
  assert.equal(result.repairs.length, 1);
  assert.equal(result.local_repairs.length, 0);
  assert.deepEqual(repairOptions.verification.failed, ["inspect:shot-2"]);
});

test("stops infrastructure verification failures without fallback or paid repair calls", async () => {
  const calls = [];
  const adapters = {
    withProductionLease: async (_workspace, operation) => operation(),
    buildIntake: async () => ({ workspace: "/tmp/workspace" }),
    writeIntake: async () => ({ workspace: "/tmp/workspace" }),
    prepareSourceMedia: async () => ({ status: "not-applicable" }),
    collectEvidence: async () => ({}), analyzeSourceMedia: async () => ({}), resolveProductionEntities: async () => ({}), planProduction: async () => ({}),
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

test("renders a vision-supervised draft at the persistent repair bound", async () => {
  const calls = [];
  const adapters = {
    withProductionLease: async (_workspace, operation) => operation(),
    buildIntake: async () => ({ workspace: "/tmp/workspace" }), writeIntake: async () => ({ workspace: "/tmp/workspace" }), prepareSourceMedia: async () => ({ status: "not-applicable" }),
    collectEvidence: async () => ({}), analyzeSourceMedia: async () => ({}), resolveProductionEntities: async () => ({}), planProduction: async () => ({}),
    produceAudio: async () => ({ status: "ready", voiceover: null, music: null, sfx: null, warnings: [] }),
    directFrames: async () => ({ generated: 1, cached: 0 }),
    assembleHyperFrames: async () => { calls.push("assemble"); return {}; },
    renderDraftProduction: async (_workspace, options) => {
      calls.push(options.allowContentVerificationFailures ? "supervised-draft" : "draft");
      if (options.allowContentVerificationFailures) return { status: "ready", video: "/tmp/draft.mp4", verification: { status: "failed", failed: ["inspect:shot-1"], snapshots: "/tmp/snapshots" }, critique: { verdict: "ship" } };
      throw Object.assign(new Error("still failing"), { code: "LAUNCHCLIP_PRODUCTION_VERIFICATION_FAILED", verification: { status: "failed", failed: ["inspect:shot-1"], qa: "/tmp/qa" } });
    },
    fallbackFramesForVerification: async () => ({ status: "not-applicable", repaired: [] }),
    repairProduction: async () => { calls.push("repair"); return { status: "repaired", repaired: [{ shot_id: "shot-1" }] }; }
  };
  const result = await runProduction("owner/repo", { "max-repair-passes": "1" }, adapters);
  assert.equal(result.status, "awaiting-approval");
  assert.equal(result.draft.video, "/tmp/draft.mp4");
  assert.equal(result.repairs.length, 1);
  assert.deepEqual(calls, ["assemble", "draft", "repair", "assemble", "draft", "supervised-draft"]);
  assert.match(result.next, /\/tmp\/draft\.mp4/);
});

test("uses visual critique to direct the final bounded repair pass", async () => {
  const calls = [];
  const repairTriggers = [];
  let drafts = 0;
  const adapters = {
    withProductionLease: async (_workspace, operation) => operation(),
    buildIntake: async () => ({ workspace: "/tmp/workspace" }), writeIntake: async () => ({ workspace: "/tmp/workspace" }), prepareSourceMedia: async () => ({ status: "not-applicable" }),
    collectEvidence: async () => ({}), analyzeSourceMedia: async () => ({}), resolveProductionEntities: async () => ({}), planProduction: async () => ({}),
    produceAudio: async () => ({ status: "ready", voiceover: null, music: null, sfx: null, warnings: [] }),
    directFrames: async () => ({ generated: 1, cached: 0 }),
    assembleHyperFrames: async () => { calls.push("assemble"); return {}; },
    renderDraftProduction: async () => {
      calls.push("draft"); drafts += 1;
      if (drafts <= 2) throw Object.assign(new Error("browser QA finding"), { code: "LAUNCHCLIP_PRODUCTION_VERIFICATION_FAILED", verification: { status: "failed", failed: ["inspect:shot-1"], qa: "/tmp/qa" } });
      return { status: "ready", video: "/tmp/draft.mp4", verification: { status: "ready", snapshots: "/tmp/snapshots" }, critique: { verdict: "ship" } };
    },
    critiqueProduction: async () => { calls.push("vision-critique"); return { verdict: "repair", findings: 1 }; },
    repairProduction: async (_workspace, options) => { calls.push("repair"); repairTriggers.push(options.trigger); return { status: "repaired", repaired: [{ shot_id: "shot-1" }] }; }
  };
  const result = await runProduction("owner/repo", { "max-repair-passes": "2" }, adapters);
  assert.equal(result.status, "awaiting-approval");
  assert.deepEqual(repairTriggers, ["verification", "critique"]);
  assert.deepEqual(calls, ["assemble", "draft", "repair", "assemble", "draft", "vision-critique", "repair", "assemble", "draft"]);
});

test("encodes the best free draft when every vision critic route is unavailable", async () => {
  const calls = [];
  let drafts = 0;
  const unavailable = new Error("all free vision routes timed out");
  unavailable.code = FREE_VISION_UNAVAILABLE_CODE;
  const adapters = {
    withProductionLease: async (_workspace, operation) => operation(),
    buildIntake: async () => ({ workspace: "/tmp/workspace" }), writeIntake: async () => ({ workspace: "/tmp/workspace" }), prepareSourceMedia: async () => ({ status: "not-applicable" }),
    collectEvidence: async () => ({}), analyzeSourceMedia: async () => ({}), resolveProductionEntities: async () => ({}), planProduction: async () => ({}),
    produceAudio: async () => ({ status: "ready", voiceover: null, music: null, sfx: null, warnings: [] }),
    directFrames: async () => ({ generated: 1, cached: 0 }),
    assembleHyperFrames: async () => { calls.push("assemble"); return {}; },
    renderDraftProduction: async (_workspace, options) => {
      calls.push(options.visionUnavailableError ? "vision-unavailable-draft" : "draft");
      drafts += 1;
      if (!options.visionUnavailableError) throw Object.assign(new Error("browser QA finding"), { code: "LAUNCHCLIP_PRODUCTION_VERIFICATION_FAILED", verification: { status: "failed", failed: ["inspect:shot-1"], qa: "/tmp/qa" } });
      assert.equal(options.allowContentVerificationFailures, true);
      assert.equal(options.allowFreeVisionUnavailable, true);
      return { status: "needs-repair", video: "/tmp/draft.mp4", verification: { status: "failed", failed: ["inspect:shot-1"] }, critique: { verdict: "unavailable" } };
    },
    critiqueProduction: async () => { calls.push("vision-critique"); throw unavailable; },
    repairProduction: async () => { calls.push("repair"); return { status: "repaired", repaired: [{ shot_id: "shot-1" }] }; }
  };
  const result = await runProduction("owner/repo", {
    "model-policy": "free",
    "frame-route": "openrouter:test/free@none",
    "repair-route": "openrouter:test/free@none",
    "max-repair-passes": "2"
  }, adapters);
  assert.equal(drafts, 3);
  assert.equal(result.status, "needs-repair");
  assert.equal(result.draft.video, "/tmp/draft.mp4");
  assert.equal(result.critique.verdict, "unavailable");
  assert.deepEqual(calls, ["assemble", "draft", "repair", "assemble", "draft", "vision-critique", "vision-unavailable-draft"]);
});

test("executes the full audio, frame, assembly, and draft closure after a replan verdict", async () => {
  const calls = [];
  let drafts = 0;
  const adapters = {
    withProductionLease: async (_workspace, operation) => operation(),
    buildIntake: async () => ({ workspace: "/tmp/workspace" }), writeIntake: async () => ({ workspace: "/tmp/workspace" }), prepareSourceMedia: async () => ({ status: "not-applicable" }),
    collectEvidence: async () => ({}), analyzeSourceMedia: async () => ({}), resolveProductionEntities: async () => ({}),
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
    prepareSourceMedia: async () => ({ status: "not-applicable" }),
    collectEvidence: async () => ({}),
    analyzeSourceMedia: async (_workspace, options) => { received.media = options; return {}; },
    resolveProductionEntities: async () => ({}),
    planProduction: async (_workspace, options) => { received.plan = options; return {}; },
    produceAudio: async () => ({ status: "ready", voiceover: null, music: null, sfx: null, warnings: [] }),
    directFrames: async (_workspace, options) => { received.frames = options; return { generated: 1, cached: 0 }; },
    assembleHyperFrames: async () => ({ index: "/tmp/index.html" }),
    renderDraftProduction: async (_workspace, options) => { received.draft = options; return { status: "ready", video: "/tmp/draft.mp4", verification: { snapshots: "/tmp/snapshots" }, critique: { verdict: "ship" } }; }
  };
  await runProduction("owner/repo", { "fast-eval": true, "no-audio": true, "pending-frame-reasoning": "medium" }, adapters);
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
  assert.deepEqual({
    reasoning: received.frames.reasoning,
    routes: received.frames.routes,
    pendingReasoning: received.frames.pendingReasoning,
    max: received.frames.maxOutputTokens,
    attempts: received.frames.semanticAttempts,
    concurrency: received.frames.concurrency,
    maxCost: received.frames.maxFrameCostUsd,
    allowFallback: received.frames.allowFallback
  }, {
    reasoning: "medium",
    routes: ["openai:gpt-5.6-luna@medium", "openai:gpt-5.6-terra@high", "openai:gpt-5.6@high"],
    pendingReasoning: "medium", max: 20000, attempts: 1, concurrency: 1, maxCost: 5, allowFallback: false
  });
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

test("uses a compact bounded planning capsule for free models", async () => {
  let received;
  await runProductionStage("creative-plan", "/tmp/workspace", { "model-policy": "free" }, {
    withProductionLease: async (_workspace, operation) => operation(),
    planProduction: async (_workspace, options) => { received = options; return { status: "ready" }; }
  });
  assert.equal(received.maxOutputTokens, 20_000);
  assert.equal(received.evidenceChars, 48_000);
  assert.equal(received.freeModelRequestTimeoutMs, 180_000);
  assert.equal(received.freeSemanticFallbacks, 1);
});

test("blocks assembly when measured narration timing requires a replan", async () => {
  let framesCalled = false;
  const adapters = {
    withProductionLease: async (_workspace, operation) => operation(),
    buildIntake: async () => ({ workspace: "/tmp/workspace" }),
    writeIntake: async () => ({ workspace: "/tmp/workspace" }),
    prepareSourceMedia: async () => ({ status: "not-applicable" }),
    collectEvidence: async () => ({}),
    analyzeSourceMedia: async () => ({}),
    resolveProductionEntities: async () => ({}),
    planProduction: async () => ({}),
    produceAudio: async () => ({ status: "needs-retiming", warnings: ["Narration is four seconds long."] }),
    directFrames: async () => { framesCalled = true; }
  };
  await assert.rejects(() => runProduction("owner/repo", {}, adapters), /Re-run creative planning/);
  assert.equal(framesCalled, false);
});

test("routes production repair with scoped model controls", async () => {
  let received;
  const result = await runProductionStage("production-repair", "/tmp/workspace", { "repair-model": "gpt-5.6", "repair-reasoning": "xhigh", "repair-semantic-attempts": "3", "repair-snapshots": "6", "repair-text-only": true, "repair-scoped-source": true, concurrency: "2" }, {
    withProductionLease: async (_workspace, operation) => operation(),
    repairProduction: async (workspace, options) => { received = { workspace, options }; return { status: "repaired" }; }
  });
  assert.equal(result.status, "repaired");
  assert.equal(received.workspace, "/tmp/workspace");
  assert.equal(received.options.reasoning, "xhigh");
  assert.equal(received.options.semanticAttempts, 3);
  assert.equal(received.options.maxSnapshots, 6);
  assert.equal(received.options.concurrency, 2);
  assert.deepEqual(received.options.routes, ["openai:gpt-5.6@xhigh"]);
  assert.equal(received.options.maxPatchRatio, .35);
  assert.equal(received.options.maxIssuesPerShot, 4);
  assert.equal(received.options.supportsImages, false);
  assert.equal(received.options.sourceMode, "scoped");
});

test("routes local-first generation and bounded local patch repair explicitly", async () => {
  const received = {};
  await runProductionStage("direct-frames", "/tmp/workspace", { "model-policy": "local-first", "local-model": "qwen2.5-coder:latest" }, {
    withProductionLease: async (_workspace, operation) => operation(),
    directFrames: async (_workspace, options) => { received.frames = options; return { status: "ready" }; }
  });
  await runProductionStage("production-repair", "/tmp/workspace", { "repair-route": "ollama:qwen2.5-coder:latest@none", "max-patch-ratio": "0.2" }, {
    withProductionLease: async (_workspace, operation) => operation(),
    repairProduction: async (_workspace, options) => { received.repair = options; return { status: "repaired" }; }
  });
  assert.deepEqual(received.frames.routes, [
    "ollama:qwen2.5-coder:latest@none",
    "openai:gpt-5.6-luna@medium",
    "openai:gpt-5.6-terra@high",
    "openai:gpt-5.6@high"
  ]);
  assert.deepEqual(received.repair.routes, "ollama:qwen2.5-coder:latest@none");
  assert.equal(received.repair.maxPatchRatio, .2);
  assert.equal(received.repair.maxIssuesPerShot, 4);
});

test("discovers ranked free frame models, clamps output, and records the accepted author", async () => {
  let frameOptions;
  let probeOptions;
  let recordedOutcome;
  const selection = {
    source: "ranked",
    state_path: "/tmp/free-model-state.json",
    selected_model: "tencent/hy3:free",
    verified_free_at: "2026-07-17T00:00:00.000Z",
    max_completion_tokens: 32_768,
    routes: ["openrouter:tencent/hy3:free@none", "openrouter:google/gemma-code:free@none"],
    candidates: [{ id: "tencent/hy3:free", score: 40, coverage: .9 }, { id: "google/gemma-code:free", score: 34, coverage: .1 }],
    warnings: []
  };
  const result = await runProductionStage("direct-frames", "/tmp/workspace", {
    "model-policy": "free",
    "free-model-candidates": "5",
    "frame-max-output-tokens": "36000"
  }, {
    withProductionLease: async (_workspace, operation) => operation(),
    selectOpenRouterFreeModels: async (options) => {
      assert.equal(options.topK, "5");
      assert.equal(options.role, "visual-code-author");
      return selection;
    },
    probeOpenRouterFreeModels: async (received, options) => {
      assert.equal(received, selection);
      probeOptions = options;
      return { ...selection, source: "live-probe" };
    },
    directFrames: async (_workspace, options) => {
      frameOptions = options;
      return { status: "ready", generated: 1, cached: 0, frames: [{ provider: "openrouter", model: "google/gemma-code:free" }] };
    },
    recordOpenRouterFreeModelOutcome: async (_selection, outcome) => {
      recordedOutcome = outcome;
      return { ...selection, source: "observed-winner", selected_model: "google/gemma-code:free" };
    }
  });
  assert.deepEqual(frameOptions.routes, selection.routes);
  assert.equal(frameOptions.stableRouteCache, true);
  assert.equal(probeOptions.timeoutMs, 15_000);
  assert.equal(frameOptions.leanPrompt, true);
  assert.equal(frameOptions.sceneBlueprint, true);
  assert.equal(frameOptions.failClosedConcurrency, 3);
  assert.equal(frameOptions.blueprintSemanticAttempts, 2);
  assert.equal(frameOptions.blueprintMaxOutputTokens, 3_000);
  assert.equal(frameOptions.blueprintTemperature, .45);
  assert.equal(frameOptions.blueprintRepairTemperature, .15);
  assert.equal(frameOptions.frameTemperature, .4);
  assert.equal(frameOptions.frameRepairTemperature, .1);
  assert.equal(frameOptions.maxOutputTokens, 32_768);
  assert.equal(frameOptions.fallbackMode, "error");
  assert.equal(frameOptions.allowFallback, false);
  assert.equal(recordedOutcome.result.frames[0].model, "google/gemma-code:free");
  assert.equal(result.free_model_selection.selected_model, "google/gemma-code:free");
  assert.equal(result.free_model_selection.source, "observed-winner");
});

test("probes untried free frame candidates after a partial pool failure in the same command", async () => {
  const first = {
    source: "live-probe", state_path: "/tmp/free-model-state.json", selected_model: "tencent/hy3:free", verified_free_at: "2026-07-17T00:00:00.000Z",
    routes: ["openrouter:tencent/hy3:free@none", "openrouter:google/gemma-code:free@none"],
    candidates: [{ id: "tencent/hy3:free" }, { id: "google/gemma-code:free" }, { id: "qwen/qwen3-coder:free" }], warnings: []
  };
  const next = { ...first, source: "live-probe", selected_model: "qwen/qwen3-coder:free", routes: ["openrouter:qwen/qwen3-coder:free@none"] };
  const directRoutes = [];
  const outcomes = [];
  let probes = 0;
  const result = await runProductionStage("direct-frames", "/tmp/workspace", { "model-policy": "free" }, {
    withProductionLease: async (_workspace, operation) => operation(),
    selectOpenRouterFreeModels: async () => first,
    probeOpenRouterFreeModels: async (_selection, options) => {
      probes += 1;
      if (probes === 1) return first;
      assert.deepEqual(options.excludeIds.sort(), ["google/gemma-code:free", "tencent/hy3:free"]);
      assert.equal(options.stopAfterFirstSuccess, true);
      return next;
    },
    directFrames: async (_workspace, options) => {
      directRoutes.push([...options.routes]);
      if (directRoutes.length === 1) throw new Error("Frame s8 exhausted model routes");
      return { status: "ready", frames: [{ provider: "openrouter", model: "tencent/hy3:free", recovered: true }, { provider: "openrouter", model: "qwen/qwen3-coder:free" }] };
    },
    recordOpenRouterFreeModelOutcome: async (selection, outcome) => {
      outcomes.push(outcome);
      return outcome.error ? { ...selection, source: "rotated-after-failure" } : next;
    }
  });
  assert.deepEqual(directRoutes, [first.routes, next.routes]);
  assert.equal(outcomes[0].error.message, "Frame s8 exhausted model routes");
  assert.deepEqual(outcomes[1].result.frames.map((frame) => frame.model), ["qwen/qwen3-coder:free"]);
  assert.equal(result.free_model_selection.selected_model, "qwen/qwen3-coder:free");
});

test("keeps critic and repair routes on OpenRouter free under the free policy", async () => {
  const received = {};
  const selection = {
    source: "sticky-state",
    state_path: "/tmp/free-model-state.json",
    selected_model: "tencent/hy3:free",
    verified_free_at: "2026-07-17T00:00:00.000Z",
    routes: ["openrouter:tencent/hy3:free@none", "openrouter:google/gemma-code:free@none"],
    candidates: [{ id: "tencent/hy3:free", score: 40, coverage: .9 }, { id: "google/gemma-code:free", score: 34, coverage: .1 }],
    warnings: []
  };
  await runProductionStage("production-critique", "/tmp/workspace", { "model-policy": "free" }, {
    withProductionLease: async (_workspace, operation) => operation(),
    critiqueProduction: async (_workspace, options) => { received.critic = options; return { status: "approved" }; }
  });
  await runProductionStage("production-repair", "/tmp/workspace", { "model-policy": "free" }, {
    withProductionLease: async (_workspace, operation) => operation(),
    selectOpenRouterFreeModels: async (options) => {
      assert.equal(options.role, "visual-code-author");
      assert.equal(options.refresh, false);
      return selection;
    },
    probeOpenRouterFreeModels: async (receivedSelection) => {
      assert.equal(receivedSelection, selection);
      return { ...selection, source: "cached-live-probe" };
    },
    repairProduction: async (_workspace, options) => {
      received.repair = options;
      return { status: "repaired", repaired: [{ provider: "openrouter", model: "tencent/hy3:free" }] };
    },
    recordOpenRouterFreeModelOutcome: async () => { throw new Error("repair outcomes must not change the frame-author ranking"); }
  });
  assert.equal(received.critic.route, "openrouter:openrouter/free@none");
  assert.equal(received.critic.selectFreeVision, true);
  assert.equal(received.critic.freeVisionCandidates, 3);
  assert.equal(received.critic.freeVisionProbeTimeoutMs, 15_000);
  assert.deepEqual(received.repair.routes, [...selection.routes, "openrouter:openrouter/free@none"]);
  assert.equal(received.repair.provider, "openrouter");
  assert.equal(received.repair.model, "tencent/hy3:free");
  assert.equal(received.repair.reasoning, "none");
  assert.equal(received.repair.supportsImages, false);
  assert.equal(received.repair.sourceMode, "scoped");
});

test("automatically uses the lean repair capsule for pinned OpenRouter free routes", async () => {
  let received;
  await runProductionStage("production-repair", "/tmp/workspace", { "repair-route": "openrouter:tencent/hy3:free@none" }, {
    withProductionLease: async (_workspace, operation) => operation(),
    selectOpenRouterFreeModels: async () => { throw new Error("explicit repair routes must not trigger discovery"); },
    repairProduction: async (_workspace, options) => { received = options; return { status: "repaired" }; }
  });
  assert.equal(received.routes, "openrouter:tencent/hy3:free@none");
  assert.equal(received.supportsImages, false);
  assert.equal(received.sourceMode, "scoped");
});

test("refreshes the free-model ranking when every sticky candidate stops probing", async () => {
  const selections = [];
  let frameOptions;
  const sticky = {
    source: "sticky-state",
    state_path: "/tmp/free-model-state.json",
    selected_model: "retired/model:free",
    routes: ["openrouter:retired/model:free@none"],
    candidates: [{ id: "retired/model:free", score: 40, coverage: .9 }],
    warnings: []
  };
  const refreshed = {
    ...sticky,
    source: "ranked",
    selected_model: "google/gemma-code:free",
    routes: ["openrouter:google/gemma-code:free@none"],
    candidates: [{ id: "google/gemma-code:free", score: 36, coverage: .8 }]
  };
  await runProductionStage("direct-frames", "/tmp/workspace", { "model-policy": "free" }, {
    withProductionLease: async (_workspace, operation) => operation(),
    selectOpenRouterFreeModels: async (options) => {
      selections.push(options);
      return options.refresh ? refreshed : sticky;
    },
    probeOpenRouterFreeModels: async (selection) => {
      if (selection === sticky) throw new Error("the sticky candidate is no longer available");
      return { ...refreshed, source: "live-probe" };
    },
    directFrames: async (_workspace, options) => {
      frameOptions = options;
      return { status: "ready", generated: 1, cached: 0, frames: [{ provider: "openrouter", model: "google/gemma-code:free" }] };
    },
    recordOpenRouterFreeModelOutcome: async (selection) => selection
  });
  assert.deepEqual(selections.map((options) => options.refresh), [false, true]);
  assert.deepEqual(frameOptions.routes, refreshed.routes);
});

test("routes an independently rerunnable analyzed draft stage", async () => {
  let received;
  const result = await runProductionStage("production-draft", "/tmp/workspace", { "draft-quality": "draft", "reference-video": "/tmp/reference.mp4", "critic-route": "openrouter:openrouter/free@none", "shot-inspect-concurrency": "4" }, {
    withProductionLease: async (_workspace, operation) => operation(),
    renderDraftProduction: async (workspace, options) => { received = { workspace, options }; return { status: "ready", video: "/tmp/draft.mp4" }; }
  });
  assert.equal(result.status, "ready");
  assert.equal(received.workspace, "/tmp/workspace");
  assert.equal(received.options.draftQuality, "draft");
  assert.equal(received.options.references, "/tmp/reference.mp4");
  assert.equal(received.options.criticRoute, "openrouter:openrouter/free@none");
  assert.equal(received.options.selectFreeVision, false);
  assert.equal(received.options.shotInspectConcurrency, 4);
});

test("enables discovered vision critique for a free draft without an explicit critic", async () => {
  let received;
  await runProductionStage("production-draft", "/tmp/workspace", {
    "model-policy": "free",
    "free-vision-model-candidates": "2",
    "free-vision-model-state": "/tmp/vision-state.json",
    "refresh-free-vision-models": true
  }, {
    withProductionLease: async (_workspace, operation) => operation(),
    renderDraftProduction: async (_workspace, options) => {
      received = options;
      return { status: "ready", video: "/tmp/draft.mp4" };
    }
  });
  assert.equal(received.selectFreeVision, true);
  assert.equal(received.freeVisionCandidates, 2);
  assert.equal(received.freeVisionStatePath, "/tmp/vision-state.json");
  assert.equal(received.refreshFreeVisionModels, true);
});

test("rejects multiple critic routes because an independent verdict must be pinned", async () => {
  await assert.rejects(() => runProductionStage("production-critique", "/tmp/workspace", {
    "critic-route": ["openrouter:first/free@none", "openrouter:second/free@none"]
  }, {
    withProductionLease: async (_workspace, operation) => operation(),
    critiqueProduction: async () => ({ status: "approved" })
  }), /--critic-route accepts one pinned route/);
});

test("opens the assembled project in Studio and returns an explicit approval handoff", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-production-preview-"));
  const project = path.join(workspace, "production", "hyperframes");
  await mkdir(project, { recursive: true });
  await writeFile(path.join(project, "index.html"), "<!doctype html>");
  let received;
  const result = await openProductionPreview(workspace, { port: "3111", open: false }, {
    launchStudio: async (projectPath, options) => {
      received = { projectPath, options };
      return { port: 3111, project_name: "hyperframes", url: "http://localhost:3111/#project/hyperframes", opened_browser: false, reused_server: false };
    }
  });
  assert.equal(result.status, "awaiting-approval");
  assert.equal(received.projectPath, project);
  assert.deepEqual(received.options, { port: 3111, open: false, timeoutMs: 15_000 });
  assert.match(result.next, /Do not use Studio Export/);
  assert.match(result.final_render_command, /production-render .* --approve --quality high/);
});

test("waits for the matching registered Studio server", async () => {
  const calls = [];
  const child = {
    exitCode: null,
    once: (event) => calls.push(["once", event]),
    unref: () => calls.push(["unref"]),
    kill: () => calls.push(["kill"])
  };
  let reads = 0;
  const result = await launchHyperFramesStudio("/tmp/project", { port: 3222, open: false, timeoutMs: 1_000 }, {
    spawnProcess: (project, options) => { calls.push(["spawn", project, options]); return child; },
    readContext: async () => {
      reads += 1;
      return reads === 1 ? null : { port: 3223, projectName: "project", projectDir: "/tmp/project" };
    },
    wait: async (milliseconds) => calls.push(["wait", milliseconds])
  });
  assert.deepEqual(result, { port: 3223, project_name: "project", url: "http://localhost:3223/#project/project", opened_browser: false, reused_server: false });
  assert.equal(reads, 2);
  assert.deepEqual(calls[0], ["spawn", "/tmp/project", { port: 3222, open: false, timeoutMs: 1_000 }]);
  assert.ok(calls.some((entry) => entry[0] === "unref"));
  assert.ok(!calls.some((entry) => entry[0] === "kill"));
});

test("reuses a matching Studio server without starting another one", async () => {
  let openedUrl;
  const result = await launchHyperFramesStudio("/tmp/project", { port: 3333 }, {
    spawnProcess: () => { throw new Error("should not spawn"); },
    readContext: async () => ({ port: 3222, projectName: "project", projectDir: "/tmp/project" }),
    openUrl: async (url) => { openedUrl = url; }
  });
  assert.equal(openedUrl, "http://localhost:3222/#project/project");
  assert.deepEqual(result, { port: 3222, project_name: "project", url: openedUrl, opened_browser: true, reused_server: true });
});

test("routes production preview controls without granting render approval", async () => {
  let received;
  const result = await runProductionStage("production-preview", "/tmp/workspace", { port: "3444", "no-open": true }, {
    withProductionLease: async (_workspace, operation) => operation(),
    openProductionPreview: async (workspace, options) => { received = { workspace, options }; return { status: "awaiting-approval" }; }
  });
  assert.equal(result.status, "awaiting-approval");
  assert.deepEqual(received, { workspace: "/tmp/workspace", options: { port: "3444", open: false } });
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

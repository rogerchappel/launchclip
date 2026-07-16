import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProductionJobStore, semanticHash } from "../src/job_store.js";
import { modelRouteKey, parseModelRoute } from "../src/model_provider.js";
import { FRAME_BUNDLE_VERSION } from "../src/production_contracts.js";
import { applyFramePatch, buildRepairInput, collectDeterministicRepairFindings, FRAME_PATCH_VERSION, repairProduction } from "../src/production_repair.js";

test("repairs only criticised frames, preserves the frame contract, and invalidates assembly", async () => {
  const workspace = await fixture();
  let request;
  const client = { runStructured: async (options) => {
    request = options;
    return { response_id: "resp_repair", model: "gpt-5.6-luna", status: "completed", usage: { total_tokens: 500 }, value: framePatch("shot-2", "Proof", "Repaired proof hierarchy") };
  } };
  const result = await runRepair(workspace, { background: false, concurrency: 2 }, { client });
  assert.equal(result.status, "repaired");
  assert.deepEqual(result.repaired.map((entry) => entry.shot_id), ["shot-2"]);
  assert.equal(repairContext(request.input).findings[0].id, "f-1");
  assert.match(JSON.stringify(repairContext(request.input).findings[0].preserve), /exact copy/);
  assert.match(request.input, /<launchclip-source target="html">\n<!doctype html>/i);
  assert.equal(request.images.length, 1);
  assert.match(await readFile(result.repaired[0].html, "utf8"), /Repaired proof hierarchy/);
  const store = await ProductionJobStore.open(workspace, { create: false });
  assert.equal(store.get("frame:shot-1").status, "succeeded");
  assert.equal(store.get("frame:shot-2").status, "succeeded");
  assert.equal(store.get("frame:shot-2").attempt, 1);
  assert.equal(store.get("frame:shot-2").input_hash, semanticHash({ id: "shot-2" }));
  assert.equal(store.get("repair:shot-2").status, "succeeded");
  assert.equal((await store.verifyOutputs("frame:shot-2")).ok, true);
  assert.equal(store.get("hyperframes-assembly").status, "stale");
});

test("routes script and plan findings through a full constrained plan revision", async () => {
  const workspace = await fixture({ repairScope: "script" });
  let received;
  const result = await runRepair(workspace, {}, { repairProductionPlan: async (...args) => { received = args; return { status: "ready", plan: "/tmp/plan.json" }; } });
  assert.equal(result.status, "replanned");
  assert.equal(received[1][0].repair_scope, "script");
  assert.deepEqual(result.actions, { plan_revised: true, audio: "regenerate", frames: "all", assemble: true });
});

test("routes audio findings through plan revision and media regeneration before frame repair", async () => {
  const workspace = await fixture({ includeAudio: true, repairScope: "assembly" });
  let findings;
  const result = await runRepair(workspace, {}, { repairProductionPlan: async (_workspace, entries) => { findings = entries; return { status: "ready" }; } });
  assert.equal(result.status, "replanned");
  assert.deepEqual(findings.map((entry) => entry.repair_scope), ["audio"]);
  assert.equal(result.actions.audio, "regenerate");
});

test("routes a replan verdict through the full plan revision even for frame-scoped findings", async () => {
  const workspace = await fixture({ verdict: "replan" });
  let calls = 0;
  const result = await runRepair(workspace, {}, { repairProductionPlan: async () => { calls += 1; return { status: "ready" }; } });
  assert.equal(result.status, "replanned");
  assert.equal(calls, 1);
  assert.equal(result.actions.frames, "all");
});

test("resumes a persisted background repair response without another submission", async () => {
  const workspace = await fixture();
  const store = await ProductionJobStore.open(workspace, { create: false });
  const plan = JSON.parse(await readFile(path.join(workspace, "production", "plan.json"), "utf8"));
  const prior = JSON.parse(await readFile(path.join(workspace, "production", "frames", "shot-2.json"), "utf8"));
  const critique = JSON.parse(await readFile(path.join(workspace, "production", "qa", "critique.json"), "utf8"));
  const repairInputHash = semanticHash({ worker: "frame-repair.v11", candidate_verification: "browser-snapshot.v3", repair_context: "selector-capsule.v4", routes: [modelRouteKey(parseModelRoute({ provider: "openai", model: "gpt-5.6-luna", reasoning: "medium" }))], source_mode: "provider-default", max_output_tokens: 8_000, max_patch_ratio: .35, shot: plan.shots[1], findings: critique.findings, prior });
  await store.add({ id: "repair:shot-2", kind: "frame-repair", depends_on: ["creative-plan"], input_hash: repairInputHash });
  await store.markRunning("repair:shot-2", { provider: "openai", response_id: "repair_saved", status: "in_progress" });
  let resumed = 0;
  const client = {
    runStructured: async () => { throw new Error("must not submit a duplicate repair"); },
    resumeStructured: async (responseId) => { resumed += 1; assert.equal(responseId, "repair_saved"); return { response_id: responseId, model: "gpt-5.6-luna", status: "completed", value: framePatch("shot-2", "Proof", "Resumed repair"), usage: {} }; }
  };
  const result = await runRepair(workspace, {}, { client, store });
  assert.equal(result.repaired.length, 1);
  assert.equal(resumed, 1);
});

test("repairs native shot inspection failures even when the visual critic ships", async () => {
  const workspace = await fixture({ verdict: "ship" });
  const reportPath = path.join(workspace, "production", "qa", "shot-inspect", "shot-1", "inspect.json");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({
    ok: false,
    stdout: {
      motion: { findings: [{ code: "motion_frozen", severity: "error", message: "The asserted node is static", selector: "#shot-1-proof", fixHint: "Animate the asserted node" }] },
      layout: { findings: [{ code: "content_overlap", severity: "warning", message: "Possible overlap", selector: "#shot-1-proof" }] }
    },
    stderr: ""
  })}\n`);
  const client = { runStructured: async (request) => {
    const finding = repairContext(request.input).findings[0];
    assert.equal(finding.id, "native-shot-1");
    assert.match(finding.instruction, /Motion assertions must describe motion on the asserted element itself/);
    assert.deepEqual(finding.repair_targets, [{ code: "motion_frozen", selector: "#shot-1-proof", message: "The asserted node is static", fix_hint: "Animate the asserted node" }]);
    assert.match(request.instructions, /set must_remain_live false/);
    assert.match(request.instructions, /Do not add imperceptible drift/);
    assert.doesNotMatch(finding.instruction, /content_overlap/);
    return { response_id: "native_repair", model: "gpt-5.6-luna", status: "completed", usage: {}, value: framePatch("shot-1", "Proof", "Native repair") };
  } };
  const result = await runRepair(workspace, {}, { client });
  assert.equal(result.status, "repaired");
  assert.equal(result.deterministic_findings, 1);
  assert.deepEqual(result.repaired.map((entry) => entry.shot_id), ["shot-1"]);
});

test("batches native repair findings by blocking priority", async () => {
  const workspace = await fixture({ verdict: "ship" });
  const plan = JSON.parse(await readFile(path.join(workspace, "production", "plan.json"), "utf8"));
  const reportPath = path.join(workspace, "production", "qa", "shot-inspect", "shot-1", "inspect.json");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({
    ok: false,
    stdout: {
      runtime: { findings: [{ code: "console_error", severity: "error", message: "Runtime failed" }] },
      motion: { findings: [{ code: "motion_out_of_order", severity: "error", message: "Order failed" }] },
      layout: { findings: [{ code: "text_occluded", severity: "error", message: "Text hidden" }] },
      contrast: { findings: [{ code: "contrast_aa_failure", severity: "error", message: "Contrast failed" }] },
      findings: [{ code: "panel_out_of_canvas", severity: "warning", message: "Panel warning" }]
    }
  })}\n`);
  const findings = await collectDeterministicRepairFindings(workspace, plan, { maxIssuesPerShot: 2 });
  assert.equal(findings.length, 1);
  assert.match(findings[0].evidence, /contains 2 of 4 unique blocking issues/);
  assert.match(findings[0].instruction, /console_error/);
  assert.match(findings[0].instruction, /motion_out_of_order/);
  assert.doesNotMatch(findings[0].instruction, /contrast_aa_failure/);
});

test("preserves native geometry and contrast evidence for a scoped repair", async () => {
  const workspace = await fixture({ verdict: "ship" });
  const plan = JSON.parse(await readFile(path.join(workspace, "production", "plan.json"), "utf8"));
  const reportPath = path.join(workspace, "production", "qa", "shot-inspect", "shot-1", "inspect.json");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({
    ok: false,
    stdout: { layout: { findings: [{
      code: "text_occluded", severity: "error", selector: ".frame-title", containerSelector: ".evidence-chip",
      text: "Evidence-backed script", coveredFraction: .33, rect: { left: 20, top: 30, width: 300, height: 40 },
      message: "Text is hidden beneath an opaque element.", fixHint: "Give the text its own zone."
    }] } }
  })}\n`);
  const [finding] = await collectDeterministicRepairFindings(workspace, plan, { maxIssuesPerShot: 1 });
  assert.match(finding.instruction, /covered by \.evidence-chip/);
  assert.match(finding.instruction, /Evidence-backed script/);
  assert.deepEqual(finding.repair_targets[0].rect, { left: 20, top: 30, width: 300, height: 40 });
  assert.equal(finding.repair_targets[0].covered_fraction, .33);
  assert.equal(finding.repair_targets[0].container_selector, ".evidence-chip");
});

test("rejects infrastructure inspection failures before any paid repair call", async () => {
  const workspace = await fixture({ verdict: "ship" });
  const reportPath = path.join(workspace, "production", "qa", "shot-inspect", "shot-1", "inspect.json");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({
    ok: false,
    failure_kind: "infrastructure",
    stderr: "spec version 2 is not supported — upgrade the HyperFrames CLI"
  })}\n`);
  let providerCalls = 0;
  await assert.rejects(() => runRepair(workspace, { trigger: "verification" }, {
    client: { runStructured: async () => { providerCalls += 1; } }
  }), (error) => error.code === "LAUNCHCLIP_PRODUCTION_INFRASTRUCTURE_FAILED");
  assert.equal(providerCalls, 0);
});

test("repairs deterministic failures before the first visual critique exists", async () => {
  const workspace = await fixture({ omitCritique: true });
  const reportPath = path.join(workspace, "production", "qa", "shot-inspect", "shot-1", "inspect.json");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({
    ok: false,
    stdout: { issues: [{ code: "motion_selector_missing", severity: "error", message: "Missing target", selector: "#shot-1-proof" }] }
  })}\n`);
  const client = { runStructured: async () => ({ response_id: "precritic_repair", model: "gpt-5.6-luna", status: "completed", usage: {}, value: framePatch("shot-1", "Proof", "Pre-critic repair") }) };
  const result = await runRepair(workspace, {}, { client });
  assert.equal(result.status, "repaired");
  assert.equal(result.deterministic_findings, 1);
  assert.deepEqual(result.repaired.map((entry) => entry.shot_id), ["shot-1"]);
});

test("ignores an older visual critique during verification-triggered repair", async () => {
  const workspace = await fixture({ verdict: "replan" });
  const reportPath = path.join(workspace, "production", "qa", "shot-inspect", "shot-1", "inspect.json");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({
    ok: false,
    stdout: { issues: [{ code: "motion_selector_missing", severity: "error", message: "Missing target", selector: "#shot-1-proof" }] }
  })}\n`);
  const result = await runRepair(workspace, { trigger: "verification" }, {
    repairProductionPlan: async () => { throw new Error("must not replay the older critique"); },
    client: { runStructured: async () => ({ response_id: "verification_repair", model: "gpt-5.6-luna", status: "completed", usage: {}, value: framePatch("shot-1", "Proof", "Current verification repair") }) }
  });
  assert.equal(result.status, "repaired");
  assert.deepEqual(result.repaired.map((entry) => entry.shot_id), ["shot-1"]);
});

test("ignores shot inspection reports older than the frame they describe", async () => {
  const workspace = await fixture({ verdict: "ship" });
  const reportPath = path.join(workspace, "production", "qa", "shot-inspect", "shot-1", "inspect.json");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({ ok: false, stdout: { issues: [{ code: "motion_frozen", severity: "error", message: "Old issue" }] } })}\n`);
  const old = new Date(Date.now() - 60_000);
  const fresh = new Date();
  await utimes(reportPath, old, old);
  await utimes(path.join(workspace, "production", "frames", "shot-1.html"), fresh, fresh);
  const result = await runRepair(workspace, {}, { client: { runStructured: async () => { throw new Error("must not repair stale findings"); } } });
  assert.equal(result.status, "not-needed");
  assert.equal(result.deterministic_findings, 0);
});

test("feeds semantic validation errors back into a bounded repair retry", async () => {
  const workspace = await fixture();
  let calls = 0;
  const client = { runStructured: async (request) => {
    calls += 1;
    if (calls === 1) {
      assert.equal(request.metadata.attempt, 1);
      return {
        response_id: "invalid_repair", model: "gpt-5.6", status: "completed", usage: {},
        value: {
          schema_version: FRAME_PATCH_VERSION,
          shot_id: "shot-2",
          summary: "Introduce an invalid root for the retry contract",
          edits: [
            { target: "html", find: 'id="root"', replace: 'id="wrong-root"' },
            { target: "html", find: "#root{", replace: "#wrong-root{" }
          ]
        }
      };
    }
    const input = repairContext(request.input);
    assert.equal(request.metadata.attempt, 2);
    assert.match(input.validation_errors_to_repair.join(" "), /root id must be/);
    assert.match(request.input, /wrong-root/);
    return {
      response_id: "valid_repair", model: "gpt-5.6-luna", status: "completed", usage: {},
      value: {
        schema_version: FRAME_PATCH_VERSION,
        shot_id: "shot-2",
        summary: "Restore the root and repair the copy",
        edits: [
          { target: "html", find: 'id="wrong-root"', replace: 'id="root"' },
          { target: "html", find: "#wrong-root{", replace: "#root{" },
          { target: "html", find: ">Proof</div>", replace: ">Valid retry</div>" },
          { target: "visible_copy", find: '"Proof"', replace: '"Valid retry"' }
        ]
      }
    };
  } };
  const result = await runRepair(workspace, { semanticAttempts: 2 }, { client });
  assert.equal(result.status, "repaired");
  assert.equal(calls, 2);
  assert.match(await readFile(result.repaired[0].html, "utf8"), /Valid retry/);
});

test("preserves the canonical frame when candidate snapshots reject a repair", async () => {
  const workspace = await fixture();
  const canonicalPath = path.join(workspace, "production", "frames", "shot-2.html");
  const original = await readFile(canonicalPath, "utf8");
  let verifiedCandidate;
  await assert.rejects(() => repairProduction(workspace, { semanticAttempts: 1 }, {
    client: { runStructured: async () => ({
      response_id: "blank_repair", model: "qwen2.5-coder", status: "completed", usage: {},
      value: framePatch("shot-2", "Proof", "Rejected blank repair")
    }) },
    verifyCandidate: async (_workspace, candidate, verificationOptions) => {
      verifiedCandidate = candidate;
      assert.equal(verificationOptions.baseline.html, original.trim());
      return { ok: false, failure_kind: "content", error: "All sampled candidate frames are visually blank" };
    }
  }), /visually blank/);
  assert.match(verifiedCandidate.html, /Rejected blank repair/);
  assert.equal(await readFile(canonicalPath, "utf8"), original);
  const store = await ProductionJobStore.open(workspace, { create: false });
  assert.equal(store.get("frame:shot-2").status, "succeeded");
  assert.equal(store.get("repair:shot-2").status, "failed");
  assert.equal(store.get("hyperframes-assembly").status, "succeeded");
});

test("treats a larger repair output budget as a fresh bounded attempt", async () => {
  const workspace = await fixture();
  await assert.rejects(() => runRepair(workspace, {
    semanticAttempts: 1,
    maxAttempts: 1,
    maxOutputTokens: 800
  }, {
    client: { runStructured: async () => { throw new Error("output budget exhausted"); } }
  }), /output budget exhausted/);

  const failedStore = await ProductionJobStore.open(workspace, { create: false });
  assert.equal(failedStore.get("repair:shot-2").attempt, 1);
  assert.equal(failedStore.get("repair:shot-2").status, "failed");

  let receivedBudget;
  const result = await runRepair(workspace, {
    semanticAttempts: 1,
    maxAttempts: 1,
    maxOutputTokens: 4_000
  }, {
    client: { runStructured: async (request) => {
      receivedBudget = request.maxOutputTokens;
      return {
        response_id: "larger_budget_repair",
        model: "gpt-5.6-luna",
        status: "completed",
        usage: {},
        value: framePatch("shot-2", "Proof", "Recovered proof")
      };
    } }
  });

  assert.equal(receivedBudget, 4_000);
  assert.equal(result.repaired.length, 1);
  const recoveredStore = await ProductionJobStore.open(workspace, { create: false });
  assert.equal(recoveredStore.get("repair:shot-2").attempt, 1);
  assert.equal(recoveredStore.get("repair:shot-2").status, "succeeded");
});

test("converts fresh strict lint warnings into shot-scoped repair findings", async () => {
  const workspace = await fixture({ verdict: "ship" });
  const lintPath = path.join(workspace, "production", "qa", "lint.json");
  await writeFile(lintPath, `${JSON.stringify({
    ok: false,
    stdout: { findings: [{ severity: "warning", file: path.join(workspace, "production", "hyperframes", "compositions", "shot-2.html"), message: 'GSAP tweens overlap on "#shot-2-proof" for x.' }] }
  })}\n`);
  const client = { runStructured: async (request) => {
    const finding = repairContext(request.input).findings[0];
    assert.equal(finding.shot_ids[0], "shot-2");
    assert.match(finding.instruction, /motion_tween_overlap/);
    return { response_id: "lint_repair", model: "gpt-5.6-luna", status: "completed", usage: {}, value: framePatch("shot-2", "Proof", "Lint repair") };
  } };
  const result = await runRepair(workspace, {}, { client });
  assert.equal(result.deterministic_findings, 1);
  assert.deepEqual(result.repaired.map((entry) => entry.shot_id), ["shot-2"]);
});

test("presents exact repair sources unescaped outside the JSON context", () => {
  const prior = bundle("shot-1");
  const input = buildRepairInput({
    plan: { design: { concept: "Proof" }, format: { width: 1080, height: 1920 } },
    shot: { id: "shot-1" },
    findings: [{ id: "layout-1" }],
    prior
  });
  assert.equal(repairContext(input).findings[0].id, "layout-1");
  assert.match(input, /<launchclip-source target="html">\n<!doctype html>/i);
  assert.match(input, /<div id="root"/);
  assert.doesNotMatch(input, /<launchclip-source target="html">\n"<!doctype html>/i);
});

test("presents preferred exact anchors to scoped local repairs", () => {
  const prior = bundle("shot-1");
  const input = buildRepairInput({
    plan: { design: { concept: "Proof" }, format: { width: 1080, height: 1920 } },
    shot: { id: "shot-1", visual: { objects: [], events: [] } },
    findings: [{ repair_targets: [{ code: "text_box_overflow", selector: "#shot-1-proof", message: "Text extends outside its box" }] }],
    prior,
    sourceMode: "scoped"
  });
  assert.match(input, /<launchclip-anchor target="html" role="markup" index="1">/);
  assert.match(input, /<div id="shot-1-proof" class="clip" data-start="0" data-duration="5">/);
  assert.match(input, /Preferred exact anchors follow/);
});

test("applies exact small edits without replacing the frame bundle", () => {
  const prior = bundle("shot-1");
  const result = applyFramePatch(prior, framePatch("shot-1", "Proof", "Focused proof"));
  assert.match(result.bundle.html, />Focused proof<\/div>/);
  assert.deepEqual(result.bundle.visible_copy, ["Focused proof"]);
  assert.ok(result.changedRatio < .1);
  assert.equal(prior.visible_copy[0], "Proof");
});

test("rejects a repair that rewrites the complete HTML target", () => {
  const prior = bundle("shot-1");
  assert.throws(() => applyFramePatch(prior, {
    schema_version: FRAME_PATCH_VERSION,
    shot_id: "shot-1",
    summary: "Broad rewrite",
    edits: [{ target: "html", find: prior.html, replace: prior.html.replace("Proof", "Different") }]
  }), (error) => error.code === "LAUNCHCLIP_INVALID_FRAME_PATCH" && /maximum is 35\.0%/.test(error.message));
});

test("rejects oversized individual source edits", () => {
  const prior = bundle("shot-1");
  assert.throws(() => applyFramePatch(prior, {
    schema_version: FRAME_PATCH_VERSION,
    shot_id: "shot-1",
    summary: "Oversized edit",
    edits: [{ target: "html", find: "x".repeat(1_001), replace: "small" }]
  }), /find exceeds 1000 characters/);
  assert.throws(() => applyFramePatch(prior, {
    schema_version: FRAME_PATCH_VERSION,
    shot_id: "shot-1",
    summary: "Oversized replacement",
    edits: [{ target: "html", find: ">Proof</div>", replace: "x".repeat(1_201) }]
  }), /replace exceeds 1200 characters/);
});

test("salvages independently valid local edits and records rejected anchors", () => {
  const prior = bundle("shot-1");
  const result = applyFramePatch(prior, {
    schema_version: FRAME_PATCH_VERSION,
    shot_id: "shot-1",
    summary: "Apply the valid edit only",
    edits: [
      { target: "html", find: ">Proof</div>", replace: ">Focused proof</div>" },
      { target: "html", find: "missing local anchor", replace: "unused" }
    ]
  }, { allowPartial: true });
  assert.match(result.bundle.html, />Focused proof<\/div>/);
  assert.equal(result.edits, 1);
  assert.deepEqual(result.rejectedEdits, [{ index: 1, target: "html", reason: "find string must occur exactly once in html; found 0" }]);
});

test("reports a bounded rejected anchor preview when no local edit applies", () => {
  const prior = bundle("shot-1");
  assert.throws(() => applyFramePatch(prior, {
    schema_version: FRAME_PATCH_VERSION,
    shot_id: "shot-1",
    summary: "Missed local anchor",
    edits: [{ target: "html", find: "missing local anchor", replace: "unused" }]
  }, { allowPartial: true }), /edit 0 html .*find="missing local anchor"/);
});

test("retargets a uniquely matched local edit without weakening exact anchors", () => {
  const prior = bundle("shot-1");
  const result = applyFramePatch(prior, {
    schema_version: FRAME_PATCH_VERSION,
    shot_id: "shot-1",
    summary: "Correct a locally mislabeled target",
    edits: [{ target: "motion", find: ">Proof</div>", replace: ">Focused proof</div>" }]
  }, { allowPartial: true, allowRetarget: true });
  assert.match(result.bundle.html, />Focused proof<\/div>/);
  assert.equal(result.edits, 1);
});

test("escalates from a local structural attempt to the next pinned repair route", async () => {
  const workspace = await fixture();
  const calls = [];
  const result = await runRepair(workspace, {
    routes: ["ollama:qwen2.5-coder:latest@none", "openai:gpt-5.6-terra@high"],
    semanticAttempts: 1
  }, {
    createClient: (route) => ({
      supportsImages: route.provider !== "ollama",
      runStructured: async (request) => {
        calls.push({ provider: route.provider, model: route.model, images: request.images.length, sourceMode: repairContext(request.input).source_scope.mode, keepAlive: request.keepAlive });
        return {
          response_id: `${route.provider}_repair`, model: route.model, status: "completed", usage: {},
          value: route.provider === "ollama"
            ? { ...framePatch("shot-2", "Proof", "Local proof"), edits: [{ target: "html", find: "missing source", replace: "nothing" }] }
            : framePatch("shot-2", "Proof", "Escalated proof")
        };
      }
    })
  });
  assert.deepEqual(calls, [
    { provider: "ollama", model: "qwen2.5-coder:latest", images: 0, sourceMode: "scoped", keepAlive: 0 },
    { provider: "openai", model: "gpt-5.6-terra", images: 1, sourceMode: "full", keepAlive: undefined }
  ]);
  assert.equal(result.repaired[0].provider, "openai");
  assert.equal(result.repaired[0].model, "gpt-5.6-terra");
  assert.match(await readFile(result.repaired[0].html, "utf8"), /Escalated proof/);
});

test("uses scoped source capsules for remote repair routes when requested", async () => {
  const workspace = await fixture();
  let sourceMode;
  const result = await runRepair(workspace, {
    routes: ["openrouter:tencent/hy3:free@none"],
    sourceMode: "scoped",
    semanticAttempts: 1
  }, {
    createClient: () => ({
      supportsImages: false,
      runStructured: async (request) => {
        sourceMode = repairContext(request.input).source_scope.mode;
        return {
          response_id: "scoped_remote_repair",
          model: "tencent/hy3:free",
          status: "completed",
          usage: {},
          value: {
            ...framePatch("shot-2", "Proof", "Scoped proof"),
            edits: [
              ...framePatch("shot-2", "Proof", "Scoped proof").edits,
              { target: "motion", find: "true", replace: "false" }
            ]
          }
        };
      }
    })
  });
  assert.equal(sourceMode, "scoped");
  assert.equal(result.repaired[0].provider, "openrouter");
  assert.equal(result.repaired[0].patch.rejected_edits, 1);
  assert.match(await readFile(result.repaired[0].html, "utf8"), /Scoped proof/);
});

function runRepair(workspace, options = {}, adapters = {}) {
  return repairProduction(workspace, options, {
    verifyCandidate: async () => ({ ok: true, report: "/tmp/candidate-report.json", snapshots: "/tmp/candidate-snapshots" }),
    ...adapters
  });
}

function framePatch(id, before, after) {
  return {
    schema_version: FRAME_PATCH_VERSION,
    shot_id: id,
    summary: `Replace ${before} with ${after}`,
    edits: [
      { target: "html", find: `>${before}</div>`, replace: `>${after}</div>` },
      { target: "visible_copy", find: JSON.stringify(before), replace: JSON.stringify(after) }
    ]
  };
}

function repairContext(input) {
  const match = String(input).match(/<launchclip-context-json>\n([\s\S]*?)\n<\/launchclip-context-json>/);
  assert.ok(match, "repair input must contain a context JSON marker");
  return JSON.parse(match[1]);
}

function bundle(id, copy = "Proof") {
  return {
    schema_version: FRAME_BUNDLE_VERSION, shot_id: id,
    html: `<!doctype html><html><head></head><body><template><style>#root{position:absolute;inset:0}</style><div id="root" data-composition-id="${id}" data-start="0" data-duration="5" data-width="1080" data-height="1920"><div id="${id}-proof" class="clip" data-start="0" data-duration="5">${copy}</div></div><script>window.__timelines=window.__timelines||{};const timeline=gsap.timeline({paused:true});window.__timelines["${id}"]=timeline;</script></template></body></html>`,
    motion: {
      assertions: [{ selector: `#${id}-proof`, appears_by_seconds: 1, order: 1, must_stay_in_frame: true, must_remain_live: true }],
      events: [{ event_id: `${id}-proof-lock`, object_id: "proof-node", selector: `#${id}-proof`, at_seconds: 1, property: "opacity", visible_change: true }]
    },
    root_media_requests: [], evidence_ids: ["ev-1"], visible_copy: [copy], preserve: ["exact copy"]
  };
}

async function fixture(options = {}) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-repair-"));
  const production = path.join(workspace, "production");
  const frames = path.join(production, "frames");
  const snapshots = path.join(production, "qa", "snapshots");
  await Promise.all([mkdir(frames, { recursive: true }), mkdir(snapshots, { recursive: true })]);
  const shot = (id, start, end) => ({
    id, start_seconds: start, end_seconds: end, evidence_ids: ["ev-1"], resource_ids: [],
    visual: {
      representation: "diagram",
      objects: [
        { id: "proof-field", kind: "decoration", layer: "background", asset_resource_id: null },
        { id: "proof-node", kind: "diagram-node", layer: "midground", asset_resource_id: null },
        { id: "proof-label", kind: "text", layer: "foreground", asset_resource_id: null }
      ],
      events: [{ id: `${id}-proof-lock`, at_seconds: 1, target_ids: ["proof-node"], sfx_eligible: false }],
      continuity: { sequence_id: "proof-sequence", handoff: end < 10 ? "continue" : "resolve", inherits_object_ids: start ? ["proof-node"] : [], hands_off_object_ids: end < 10 ? ["proof-node"] : [], entry_velocity: start ? 320 : 0, exit_velocity: end < 10 ? 320 : 0 }
    }
  });
  const plan = { design: { concept: "Proof" }, format: { width: 1080, height: 1920 }, shots: [shot("shot-1", 0, 5), shot("shot-2", 5, 10)] };
  await writeFile(path.join(production, "intake.json"), `${JSON.stringify({ resources: [] })}\n`);
  await writeFile(path.join(production, "evidence.json"), `${JSON.stringify({ items: [{ id: "ev-1", title: "README", provenance: "README.md" }] })}\n`);
  await writeFile(path.join(production, "plan.json"), `${JSON.stringify(plan)}\n`);
  for (const id of ["shot-1", "shot-2"]) {
    const prior = bundle(id);
    await writeFile(path.join(frames, `${id}.json`), `${JSON.stringify(prior)}\n`);
    await writeFile(path.join(frames, `${id}.html`), prior.html);
    await writeFile(path.join(frames, `${id}.motion.json`), `${JSON.stringify(prior.motion)}\n`);
  }
  const findings = [{ id: "f-1", severity: "major", category: "composition", shot_ids: ["shot-2"], repair_scope: options.repairScope ?? "frame", instruction: "Make proof dominant", preserve: ["exact copy"] }];
  if (options.includeAudio) findings.push({ id: "f-audio", severity: "major", category: "audio", shot_ids: ["shot-1", "shot-2"], repair_scope: "audio", instruction: "Measure the mix", preserve: [] });
  if (!options.omitCritique) {
    await writeFile(path.join(production, "qa", "critique.json"), `${JSON.stringify({
      verdict: options.verdict ?? "repair",
      findings
    })}\n`);
  }
  await writeFile(path.join(snapshots, "001.png"), "snapshot");
  const store = await ProductionJobStore.open(workspace);
  await store.add({ id: "creative-plan", kind: "creative-plan", depends_on: [], input_hash: semanticHash(plan) });
  await store.markRunning("creative-plan"); await store.markSucceeded("creative-plan");
  for (const id of ["shot-1", "shot-2"]) {
    await store.add({ id: `frame:${id}`, kind: "frame", depends_on: ["creative-plan"], input_hash: semanticHash({ id }) });
    await store.markRunning(`frame:${id}`); await store.markSucceeded(`frame:${id}`);
  }
  await store.add({ id: "hyperframes-assembly", kind: "assembly", depends_on: ["frame:shot-1", "frame:shot-2"], input_hash: semanticHash({ assembly: true }) });
  await store.markRunning("hyperframes-assembly"); await store.markSucceeded("hyperframes-assembly");
  return workspace;
}

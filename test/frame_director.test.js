import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildFallbackFrame, buildFrameInput, directFrames, fallbackFramesForVerification, safeShotFile, sanitizeFrameBundle, validateHyperFramesRoot } from "../src/frame_director.js";
import { ProductionJobStore, semanticHash } from "../src/job_store.js";
import { EVIDENCE_VERSION, FRAME_BUNDLE_SCHEMA, FRAME_BUNDLE_VERSION, PRODUCTION_PLAN_VERSION } from "../src/production_contracts.js";

test("gives each delegated frame only its shot, neighbors, grounded evidence, and resources", () => {
  const context = fixture();
  const input = JSON.parse(buildFrameInput({ ...context, shot: context.plan.shots[0], index: 0, narrationTiming: { duration_seconds: 10, words: [{ word: "Proof", start: 1.5, end: 2 }, { word: "Next", start: 5.2, end: 5.7 }] } }));
  assert.equal(input.shot.id, "shot-1");
  assert.deepEqual(input.neighbors.map((entry) => entry.id), ["shot-2"]);
  assert.deepEqual(input.evidence.map((entry) => entry.id), ["ev-1"]);
  assert.deepEqual(input.resources.map((entry) => entry.id), ["screen"]);
  assert.equal(input.global_design.concept, "Evidence choreography");
  assert.deepEqual(input.narration_timing.words, [{ word: "Proof", global_start_seconds: 1.5, global_end_seconds: 2, shot_start_seconds: 1.5, shot_end_seconds: 2 }]);
});

test("delegates shots concurrently, repairs invalid HTML, and writes modular frame artifacts", async () => {
  const context = fixture();
  const workspace = await workspaceFixture(context);
  let active = 0;
  let peak = 0;
  let frameInstructions;
  const attempts = new Map();
  const client = {
    runStructured: async (options) => {
      frameInstructions = options.instructions;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const input = JSON.parse(options.input);
      const count = (attempts.get(input.shot.id) ?? 0) + 1;
      attempts.set(input.shot.id, count);
      active -= 1;
      const bundle = frameBundle(input.shot.id, input.shot.duration_seconds);
      if (input.shot.id === "shot-1" && count === 1) bundle.html = bundle.html.replace('data-start="0"', 'data-start="1"');
      if (input.shot.id === "shot-2" && count === 1) bundle.html = bundle.html.replace(`window.__timelines["${input.shot.id}"]=timeline;`, "");
      await options.onSubmitted({ id: `resp_${input.shot.id}_${count}`, status: "in_progress" });
      return { response_id: `resp_${input.shot.id}_${count}`, model: "gpt-5.6-sol", status: "completed", value: bundle, usage: { total_tokens: 100 } };
    }
  };

  const result = await directFrames(workspace, { concurrency: 2, background: false, allowFallback: true }, { client });
  assert.equal(result.generated, 2);
  assert.equal(peak, 2);
  assert.equal(attempts.get("shot-1"), 2);
  assert.match(frameInstructions, /Motion assertions are executable test contracts/);
  assert.match(frameInstructions, /must_remain_live means/);
  assert.match(frameInstructions, /Render the declared semantic representation/);
  assert.match(frameInstructions, /Materialize every shot\.visual\.events entry/);
  assert.match(frameInstructions, /never cross text or numeric values/);
  assert.match(frameInstructions, /Never approximate a logo/);
  assert.match(frameInstructions, /Never apply non-uniform scaleX\/scaleY to text/);
  assert.match(frameInstructions, /Every text-bearing box needs an explicit readable text zone/);
  assert.match(frameInstructions, /filenames such as light or dark are hints/);
  assert.match(await readFile(result.frames[0].html, "utf8"), /data-composition-id="shot-1"/);
  assert.match(await readFile(result.frames[0].motion, "utf8"), /#shot-1-proof/);
  assert.match(await readFile(result.frames[1].html, "utf8"), /window\.__timelines\["shot-2"\] = timeline/);

  const cached = await directFrames(workspace, { concurrency: 2 }, { client });
  assert.equal(cached.cached, 2);
  assert.equal(attempts.get("shot-1"), 2);

  const redirected = await directFrames(workspace, { concurrency: 2, reasoning: "xhigh" }, { client });
  assert.equal(redirected.generated, 2);
  assert.equal(attempts.get("shot-1"), 3);
  assert.equal(attempts.get("shot-2"), 2);
});

test("rejects a frame root with wrong identity, time, or dimensions", () => {
  const { plan } = fixture();
  const errors = validateHyperFramesRoot('<template><style>#root{position:absolute}</style><div id="root" data-composition-id="wrong" data-start="1" data-duration="3" data-width="100" data-height="100"></div><script>window.__timelines["wrong"]={}</script></template>', plan.shots[0], plan.format);
  assert.ok(errors.some((entry) => entry.includes("shot-1")));
  assert.ok(errors.some((entry) => entry.includes("data-start")));
  assert.ok(errors.some((entry) => entry.includes("data-duration")));
  assert.ok(errors.some((entry) => entry.includes("data-width")));
});

test("contains model-authored shot artifact paths", () => {
  assert.equal(safeShotFile("/tmp/frames", "shot-1", ".json"), "/tmp/frames/shot-1.json");
  assert.throws(() => safeShotFile("/tmp/frames", "../outside", ".json"), /Unsafe shot ID/);
  assert.throws(() => safeShotFile("/tmp/frames", "shot-1", "/outside"), /Unsafe shot artifact suffix/);
});

test("removes event-handler attributes locally without changing visible button copy", () => {
  const bundle = frameBundle("shot-1", 5);
  bundle.html = bundle.html.replace(">Proof</div>", ' onclick="doSomething()">Do something</div>');
  const sanitized = sanitizeFrameBundle(bundle);
  assert.doesNotMatch(sanitized.bundle.html, /onclick=/i);
  assert.match(sanitized.bundle.html, />Do something<\/div>/);
  assert.deepEqual(sanitized.repairs, [{ kind: "remove-event-handler-attributes", count: 1 }]);
});

test("removes authoritative voiceover requests from the frame bundle locally", () => {
  const bundle = frameBundle("shot-1", 5);
  bundle.root_media_requests[0] = { ...bundle.root_media_requests[0], resource_id: "voiceover", kind: "audio", volume: 1 };
  const sanitized = sanitizeFrameBundle(bundle, {
    shot: { presenter: { mode: "voiceover" } },
    resourceRoles: { voiceover: "voiceover" }
  });
  assert.deepEqual(sanitized.bundle.root_media_requests, []);
  assert.deepEqual(sanitized.repairs, [{
    kind: "remove-authoritative-voiceover-root-media",
    resource_id: "voiceover",
    presenter_mode: "voiceover"
  }]);
});

test("adds missing authoritative root contract attributes locally without overwriting authored values", () => {
  const context = fixture();
  const bundle = frameBundle("shot-1", 5);
  bundle.html = bundle.html.replace(' data-start="0" data-duration="5" data-width="1080" data-height="1920"', "");

  const sanitized = sanitizeFrameBundle(bundle, { shot: context.plan.shots[0], format: context.plan.format });

  assert.match(sanitized.bundle.html, /id="root" data-composition-id="shot-1" data-start="0" data-duration="5" data-width="1080" data-height="1920"/);
  assert.deepEqual(sanitized.repairs, [{
    kind: "add-missing-root-contract-attributes",
    attributes: ["data-start", "data-duration", "data-width", "data-height"]
  }]);
  assert.deepEqual(validateHyperFramesRoot(sanitized.bundle.html, context.plan.shots[0], context.plan.format), []);

  const incorrect = frameBundle("shot-1", 5).html.replace('data-width="1080"', 'data-width="100"');
  const preserved = sanitizeFrameBundle({ ...bundle, html: incorrect }, { shot: context.plan.shots[0], format: context.plan.format });
  assert.match(preserved.bundle.html, /data-width="100"/);
  assert.ok(validateHyperFramesRoot(preserved.bundle.html, context.plan.shots[0], context.plan.format).some((error) => error.includes("data-width")));
});

test("builds a deterministic presenter fallback that satisfies the frame contract", () => {
  const context = fixture();
  const shot = { ...context.plan.shots[0], presenter: { mode: "companion", visible: true }, resource_ids: ["presenter"] };
  const intake = { ...context.intake, resources: [{ id: "presenter", role: "presenter", type: "video", location: "/tmp/presenter.mp4", is_remote: false }] };
  const fallback = buildFallbackFrame({ intake, plan: context.plan, shot });
  assert.match(fallback.html, /local-deterministic-fallback|fallback-card/);
  assert.match(fallback.html, /fallback-grid/);
  assert.match(fallback.html, /fallback-rail/);
  assert.match(fallback.html, /stagger:\.16/);
  assert.equal(fallback.root_media_requests[0].resource_id, "presenter");
  assert.equal(fallback.root_media_requests[0].source_start_seconds, 0);
  assert.equal(fallback.root_media_requests[0].source_end_seconds, 5);
  assert.equal(fallback.root_media_requests[0].presentation.mode, "companion");
  assert.equal(fallback.root_media_requests[0].presentation.frame, "desktop-window");
  assert.equal(fallback.root_media_requests[0].placement.width, fallback.root_media_requests[0].placement.height);
  assert.ok(fallback.root_media_requests[0].placement.width < context.plan.format.width);
  assert.equal(validateHyperFramesRoot(fallback.html, shot, context.plan.format).length, 0);
});

test("recovers a previously rejected frame with a local fallback and does not buy another response", async () => {
  const context = fixture();
  const workspace = await workspaceFixture(context);
  const store = await ProductionJobStore.open(workspace, { create: false });
  const inputHash = semanticHash({
    input: buildFrameInput({ ...context, shot: context.plan.shots[0], index: 0 }),
    model: context.intake.model,
    reasoning: "high",
    schema: FRAME_BUNDLE_SCHEMA,
    worker: "frame-director.v3"
  });
  await store.add({ id: "frame:shot-1", kind: "frame", depends_on: ["creative-plan"], input_hash: inputHash });
  await store.markRunning("frame:shot-1", { provider: "openai", response_id: "resp_spent", status: "completed" });
  await store.markFailed("frame:shot-1", new Error("Frame shot-1 failed semantic validation: frame HTML must not contain event-handler attributes"));
  const calls = [];
  const client = { runStructured: async (options) => {
    const input = JSON.parse(options.input);
    calls.push(input.shot.id);
    return { response_id: "resp_fresh", model: "gpt-5.6", status: "completed", value: frameBundle(input.shot.id, input.shot.duration_seconds), usage: {} };
  } };
  const result = await directFrames(workspace, { concurrency: 2, background: false, allowFallback: true }, { client });
  assert.deepEqual(calls, ["shot-2"]);
  assert.equal(result.fallbacks, 1);
  assert.equal(result.frames[0].fallback, true);
  assert.match(await readFile(path.join(workspace, "production", "fallbacks", "shot-1.json"), "utf8"), /deterministic fallback/);
  for (let index = 0; index < 4; index += 1) {
    const local = await fallbackFramesForVerification(workspace, { failed: ["inspect:shot-1"], qa: path.join(workspace, "missing-qa") });
    assert.equal(local.repaired.length, 1);
  }
  const canonicalPath = path.join(workspace, "production", "frames", "shot-2.json");
  const canonicalBeforeFallback = await readFile(canonicalPath, "utf8");
  const verificationFallback = await fallbackFramesForVerification(workspace, { failed: ["inspect:shot-2"], qa: path.join(workspace, "missing-qa") });
  assert.equal(verificationFallback.repaired.length, 1);
  assert.equal(await readFile(canonicalPath, "utf8"), canonicalBeforeFallback, "verification fallback preserves the paid model frame");
  assert.match(await readFile(path.join(workspace, "production", "fallbacks", "shot-2.fallback.json"), "utf8"), /"source": "verification"/);
  assert.deepEqual(calls, ["shot-2"], "repeated local QA passes never submit another provider response");
});

test("promotes a paid frame attempt after a deterministic media-role repair", async () => {
  const context = fixture();
  context.intake.resources.push({ id: "voiceover", role: "voiceover", type: "video", location: "/tmp/voiceover.mp4", is_remote: false, sha256: "v" });
  context.plan.shots[0].resource_ids = ["voiceover"];
  const workspace = await workspaceFixture(context);
  const store = await ProductionJobStore.open(workspace, { create: false });
  const inputHash = semanticHash({
    input: buildFrameInput({ ...context, shot: context.plan.shots[0], index: 0 }),
    model: context.intake.model,
    reasoning: "high",
    schema: FRAME_BUNDLE_SCHEMA,
    worker: "frame-director.v3"
  });
  await store.add({ id: "frame:shot-1", kind: "frame", depends_on: ["creative-plan"], input_hash: inputHash });
  await store.markRunning("frame:shot-1", { provider: "openai", response_id: "resp_spent", status: "completed" });
  await store.markFailed("frame:shot-1", new Error("Frame shot-1 failed semantic validation: root_media_requests[0] must not mount the authoritative voiceover resource as visual media; use the presenter resource"));
  const candidate = frameBundle("shot-1", 5);
  candidate.root_media_requests[0] = { ...candidate.root_media_requests[0], resource_id: "voiceover", kind: "audio", volume: 1 };
  const attempts = path.join(workspace, "production", "frames", ".attempts");
  await mkdir(attempts, { recursive: true });
  await writeFile(path.join(attempts, "shot-1-attempt-1.json"), `${JSON.stringify({ input_hash: inputHash, response_id: "resp_spent", model: "gpt-5.6-sol", usage: { total_tokens: 100 }, candidate })}\n`);
  const calls = [];
  const client = { runStructured: async (options) => {
    const input = JSON.parse(options.input);
    calls.push(input.shot.id);
    return { response_id: "resp_fresh", model: "gpt-5.6", status: "completed", value: frameBundle(input.shot.id, input.shot.duration_seconds), usage: {} };
  } };

  const result = await directFrames(workspace, { concurrency: 2, background: false }, { client });

  assert.deepEqual(calls, ["shot-2"]);
  assert.equal(result.frames[0].recovered, true);
  assert.equal(result.frames[0].fallback, undefined);
  assert.deepEqual(JSON.parse(await readFile(path.join(workspace, "production", "frames", "shot-1.json"), "utf8")).root_media_requests, []);
  assert.equal((await ProductionJobStore.open(workspace, { create: false })).get("frame:shot-1").status, "succeeded");
});

test("waits for sibling frame jobs to settle before reporting a delegated failure", async () => {
  const context = fixture();
  const workspace = await workspaceFixture(context);
  let siblingFinished = false;
  const client = { runStructured: async (options) => {
    const input = JSON.parse(options.input);
    if (input.shot.id === "shot-1") throw new Error("worker failed");
    await new Promise((resolve) => setTimeout(resolve, 20));
    siblingFinished = true;
    return { response_id: "sibling", model: "gpt-5.6", status: "completed", value: frameBundle(input.shot.id, input.shot.duration_seconds), usage: {} };
  } };
  await assert.rejects(() => directFrames(workspace, { concurrency: 2, allowFallback: true }, { client }), /worker failed/);
  assert.equal(siblingFinished, true);
  const store = await ProductionJobStore.open(workspace, { create: false });
  assert.equal(store.get("frame:shot-2").status, "succeeded");
});

test("resumes a persisted background frame response without submitting it twice", async () => {
  const context = fixture();
  const workspace = await workspaceFixture(context);
  const store = await ProductionJobStore.open(workspace, { create: false });
  const baseInput = buildFrameInput({ ...context, shot: context.plan.shots[0], index: 0 });
  const inputHash = semanticHash({ input: baseInput, model: context.intake.model, reasoning: "high", schema: FRAME_BUNDLE_SCHEMA, worker: "frame-director.v3" });
  await store.add({ id: "frame:shot-1", kind: "frame", depends_on: ["creative-plan"], input_hash: inputHash });
  await store.markRunning("frame:shot-1", { provider: "openai", response_id: "resp_saved", status: "in_progress" });
  let resumed = 0;
  let submitted = 0;
  const client = {
    resumeStructured: async (responseId) => { resumed += 1; assert.equal(responseId, "resp_saved"); return { response_id: responseId, model: "gpt-5.6", status: "completed", value: frameBundle("shot-1", 5), usage: {} }; },
    runStructured: async (options) => { submitted += 1; const input = JSON.parse(options.input); return { response_id: "fresh", model: "gpt-5.6", status: "completed", value: frameBundle(input.shot.id, input.shot.duration_seconds), usage: {} }; }
  };
  await directFrames(workspace, { concurrency: 2 }, { client });
  assert.equal(resumed, 1);
  assert.equal(submitted, 1, "only the second shot needs a new response");
});

test("fails closed on fallback and does not start a later frame", async () => {
  const context = fixture();
  const workspace = await workspaceFixture(context);
  const calls = [];
  const client = { runStructured: async (options) => {
    const input = JSON.parse(options.input);
    calls.push(input.shot.id);
    const bundle = frameBundle(input.shot.id, input.shot.duration_seconds);
    bundle.html = bundle.html.replace('data-start="0"', 'data-start="1"');
    return { response_id: `resp_${input.shot.id}`, model: "gpt-5.6-sol", status: "completed", value: bundle, usage: { input_tokens: 100, output_tokens: 100 } };
  } };

  let error;
  try {
    await directFrames(workspace, { concurrency: 2, semanticAttempts: 1, background: false }, { client });
    assert.fail("expected fallback to stop production");
  } catch (caught) {
    error = caught;
  }
  assert.match(error.message, /selected a deterministic fallback/);
  assert.equal(error.code, "LAUNCHCLIP_FRAME_FALLBACK_BLOCKED");
  assert.deepEqual(calls, ["shot-1"]);
});

test("stops before the next frame after the observed dollar limit is reached", async () => {
  const context = fixture();
  const workspace = await workspaceFixture(context);
  const calls = [];
  const client = { runStructured: async (options) => {
    const input = JSON.parse(options.input);
    calls.push(input.shot.id);
    return { response_id: `resp_${input.shot.id}`, model: "gpt-5.6-sol", status: "completed", value: frameBundle(input.shot.id, input.shot.duration_seconds), usage: { input_tokens: 100, output_tokens: 100, reasoning_tokens: 20 } };
  } };

  let error;
  try {
    await directFrames(workspace, { concurrency: 4, maxFrameCostUsd: .001, background: false }, { client });
    assert.fail("expected frame cost guard to stop production");
  } catch (caught) {
    error = caught;
  }
  assert.match(error.message, /Observed frame cost reached/);
  assert.equal(error.code, "LAUNCHCLIP_FRAME_COST_LIMIT");
  assert.equal(error.frame_cost.estimated_usd, .0035);
  assert.deepEqual(calls, ["shot-1"]);
});

test("uses a reasoning override only for unfinished frames", async () => {
  const context = fixture();
  const workspace = await workspaceFixture(context);
  const initialClient = { runStructured: async (options) => {
    const input = JSON.parse(options.input);
    if (input.shot.id === "shot-2") throw new Error("stop after the first frame");
    return { response_id: "resp_high", model: "gpt-5.6-sol", status: "completed", value: frameBundle(input.shot.id, input.shot.duration_seconds), usage: {} };
  } };
  await assert.rejects(
    () => directFrames(workspace, { concurrency: 1, reasoning: "high", allowFallback: true, background: false }, { client: initialClient }),
    /stop after the first frame/
  );
  const before = (await ProductionJobStore.open(workspace, { create: false })).get("frame:shot-1");
  const calls = [];
  const resumeClient = { runStructured: async (options) => {
    const input = JSON.parse(options.input);
    calls.push({ shot: input.shot.id, reasoning: options.reasoningEffort });
    return { response_id: "resp_medium", model: "gpt-5.6-sol", status: "completed", value: frameBundle(input.shot.id, input.shot.duration_seconds), usage: {} };
  } };

  const result = await directFrames(workspace, {
    concurrency: 1,
    reasoning: "high",
    pendingReasoning: "medium",
    allowFallback: true,
    background: false
  }, { client: resumeClient });

  assert.deepEqual(calls, [{ shot: "shot-2", reasoning: "medium" }]);
  assert.equal(result.frames[0].cached, true);
  assert.equal(result.frames[1].cached, false);
  assert.equal((await ProductionJobStore.open(workspace, { create: false })).get("frame:shot-1").input_hash, before.input_hash);
});

test("replaces a cancelled persisted response in the same run", async () => {
  const context = fixture();
  const workspace = await workspaceFixture(context);
  const store = await ProductionJobStore.open(workspace, { create: false });
  const baseInput = buildFrameInput({ ...context, shot: context.plan.shots[0], index: 0 });
  const inputHash = semanticHash({ input: baseInput, model: context.intake.model, reasoning: "high", schema: FRAME_BUNDLE_SCHEMA, worker: "frame-director.v3" });
  await store.add({ id: "frame:shot-1", kind: "frame", depends_on: ["creative-plan"], input_hash: inputHash });
  await store.markRunning("frame:shot-1", { provider: "openai", response_id: "resp_cancelled", status: "in_progress" });
  let resumed = 0;
  const submitted = [];
  const client = {
    resumeStructured: async () => { resumed += 1; throw new Error("OpenAI response resp_cancelled cancelled: cancelled"); },
    runStructured: async (options) => {
      const input = JSON.parse(options.input);
      submitted.push(input.shot.id);
      return { response_id: `resp_${input.shot.id}`, model: "gpt-5.6-sol", status: "completed", value: frameBundle(input.shot.id, input.shot.duration_seconds), usage: {} };
    }
  };

  await directFrames(workspace, { background: false }, { client });

  assert.equal(resumed, 1);
  assert.deepEqual(submitted, ["shot-1", "shot-2"]);
  assert.equal((await ProductionJobStore.open(workspace, { create: false })).get("frame:shot-1").attempt, 2);
});

function frameBundle(id, duration) {
  return {
    schema_version: FRAME_BUNDLE_VERSION,
    shot_id: id,
    html: `<!doctype html><html><head></head><body><template><style>#root{position:absolute;inset:0}</style><div id="root" data-composition-id="${id}" data-start="0" data-duration="${duration}" data-width="1080" data-height="1920"><div id="${id}-proof" class="clip" data-start="0" data-duration="${duration}">Proof</div></div><script>window.__timelines=window.__timelines||{};const timeline=gsap.timeline({paused:true});window.__timelines["${id}"]=timeline;</script></template></body></html>`,
    motion: {
      assertions: [{ selector: `#${id}-proof`, appears_by_seconds: 1, order: 1, must_stay_in_frame: true, must_remain_live: true }],
      events: [{ event_id: `${id}-reveal`, object_id: "proof-node", selector: `#${id}-proof`, at_seconds: 1, property: "opacity", visible_change: true }]
    },
    root_media_requests: [{
      resource_id: "screen", kind: "video", start_seconds: 0, end_seconds: duration,
      source_start_seconds: 0, source_end_seconds: duration, volume: 0,
      presentation: { mode: "companion", frame: "desktop-window", enter: "slide-up", exit: "slide-down", motion_blur_px: 12 },
      placement: { x: 80, y: 180, width: 920, height: 720, object_fit: "cover", border_radius: 32, z_index: 2, treatment: "proof window" }
    }],
    evidence_ids: ["ev-1"], visible_copy: ["Proof"], preserve: ["proof hierarchy"]
  };
}

function fixture() {
  const intake = {
    source: { kind: "product" }, model: { id: "gpt-5.6" },
    resources: [{ id: "screen", role: "supporting", type: "video", location: "/tmp/screen.mp4", is_remote: false, sha256: "s" }]
  };
  const evidence = {
    schema_version: EVIDENCE_VERSION,
    items: [{ id: "ev-1", title: "Proof", content: "Grounded proof", provenance: "https://example.com", claims_allowed: true }]
  };
  const shot = (id, start, end) => ({
    id, start_seconds: start, end_seconds: end, purpose: "Show proof", voiceover: "Proof.", on_screen_text: ["Proof"], evidence_ids: ["ev-1"], resource_ids: ["screen"],
    presenter: { mode: "voiceover", visible: false, placement: "offstage", size: "none", treatment: "none" },
    visual: {
      description: "Proof develops", concept: "Proof connects to the result", world: "A moving evidence field", representation: "diagram",
      composition: "Asymmetric", typography: "Display", background: "Field", foreground: "Proof", motion: "Reveal then settle",
      objects: [
        { id: "evidence-grid", kind: "decoration", meaning: "spatial field", layer: "background", asset_resource_id: null, lifecycle: "persist" },
        { id: "proof-node", kind: "diagram-node", meaning: "grounded proof", layer: "midground", asset_resource_id: null, lifecycle: start ? "persist" : "enter" },
        { id: "proof-label", kind: "text", meaning: "proof label", layer: "foreground", asset_resource_id: null, lifecycle: "enter" }
      ],
      events: [{ id: `${id}-reveal`, at_seconds: 1, target_ids: ["proof-node"], action: "reveal proof", motion_verb: "locks in", visible_change: "reveal", easing_intent: "fast settle", sfx_eligible: false }],
      continuity: { sequence_id: "proof-sequence", handoff: end < 10 ? "continue" : "resolve", inherits_object_ids: start ? ["proof-node"] : [], hands_off_object_ids: end < 10 ? ["proof-node"] : [], camera_direction: "rightward", entry_velocity: start ? 320 : 0, exit_velocity: end < 10 ? 320 : 0, motion_blur_px: 12 },
      internal_reveals: [{ at_seconds: 1, action: "reveal", easing_intent: "fast settle", emphasis: "proof" }]
    },
    transition_out: "match", sfx: []
  });
  const plan = {
    schema_version: PRODUCTION_PLAN_VERSION,
    project: { title: "Test", thesis: "Proof", audience_promise: "Understand", angle: "Evidence", hook: "Look" },
    format: { aspect: "9:16", width: 1080, height: 1920, duration_seconds: 10, language: "en" },
    design: {
      concept: "Evidence choreography", art_direction: "Original", palette_roles: [], typography: "Display", texture: "Subtle", composition_logic: "Proof first", motion_character: "Purposeful", density: "Measured",
      style_dna: { family: "soft-grid-editorial", source: "auto", canvas: "light", colors: { background: "#F4F0E8", foreground: "#20231F", accent: "#E58B72", supporting: ["#A8D8C7"] }, typography: { display: "Newsreader", body: "Inter", metadata: "DM Mono" }, shape_language: "soft windows", background_system: "moving grid", diagram_language: "causal nodes", presenter_frame: "warm outline", motion_physics: { tempo: "measured", camera_behavior: "rightward", primary_ease: "power3.inOut", secondary_ease: "expo.out", motion_blur_px: 12 }, transition_vocabulary: ["velocity push"], forbidden_motifs: ["cyan on black"] }
    },
    shots: [shot("shot-1", 0, 5), shot("shot-2", 5, 10)]
  };
  return { intake, evidence, plan };
}

async function workspaceFixture(context) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-frames-"));
  await mkdir(path.join(workspace, "production"), { recursive: true });
  await writeFile(path.join(workspace, "production", "intake.json"), `${JSON.stringify(context.intake)}\n`);
  await writeFile(path.join(workspace, "production", "evidence.json"), `${JSON.stringify(context.evidence)}\n`);
  await writeFile(path.join(workspace, "production", "plan.json"), `${JSON.stringify(context.plan)}\n`);
  const store = await ProductionJobStore.open(workspace);
  await store.add({ id: "creative-plan", kind: "creative-plan", depends_on: [], input_hash: semanticHash(context.plan) });
  await store.markRunning("creative-plan");
  await store.markSucceeded("creative-plan");
  return workspace;
}

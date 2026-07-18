import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FRAME_BLUEPRINT_VERSION } from "../src/frame_blueprint.js";
import { buildFallbackFrame, buildFrameInput, directFrames, fallbackFramesForVerification, safeShotFile, sanitizeFrameBundle, validateHyperFramesRoot } from "../src/frame_director.js";
import { describeJobOutput, ProductionJobStore, semanticHash } from "../src/job_store.js";
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

test("builds a compact free-model brief without dropping shot or style truth", () => {
  const context = fixture();
  context.evidence.items[0].content = "Grounded proof ".repeat(500);
  const full = buildFrameInput({ ...context, shot: context.plan.shots[0], index: 0 });
  const lean = buildFrameInput({ ...context, shot: context.plan.shots[0], index: 0, lean: true });
  const parsed = JSON.parse(lean);

  assert.ok(lean.length < full.length / 2);
  assert.equal(parsed.shot.id, "shot-1");
  assert.equal(parsed.global_design.style_dna.family, "soft-grid-editorial");
  assert.equal(parsed.evidence[0].id, "ev-1");
  assert.ok(parsed.evidence[0].content.length <= 1_800);
  assert.equal(parsed.neighbors[0].objects, undefined);
});

test("delegates shots concurrently, repairs invalid HTML, and writes modular frame artifacts", async () => {
  const context = fixture();
  const workspace = await workspaceFixture(context);
  let active = 0;
  let peak = 0;
  let frameInstructions;
  const attempts = new Map();
  const initialWaiters = [];
  const client = {
    runStructured: async (options) => {
      frameInstructions = options.instructions;
      const input = JSON.parse(options.input);
      const count = (attempts.get(input.shot.id) ?? 0) + 1;
      attempts.set(input.shot.id, count);
      active += 1;
      peak = Math.max(peak, active);
      if (count === 1) {
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 250);
          initialWaiters.push(() => {
            clearTimeout(timeout);
            resolve();
          });
          if (initialWaiters.length === 2) initialWaiters.splice(0).forEach((release) => release());
        });
      }
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
  assert.match(frameInstructions, /Use an 8px spacing rhythm/);
  assert.match(frameInstructions, /data-launchclip-safe-padding/);
  assert.match(frameInstructions, /data-launchclip-max-lines="1"/);
  assert.match(frameInstructions, /text touching a border/);
  assert.match(frameInstructions, /filenames such as light or dark are hints/);
  assert.match(frameInstructions, /Treat every family named in global_design\.style_dna\.typography as an available, compiler-resolved family/);
  assert.match(frameInstructions, /never add a remote stylesheet/);
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
  bundle.html = bundle.html.replace("const timeline", "const one=(s)=>root.querySelector(s);const timeline");
  const sanitized = sanitizeFrameBundle(bundle);
  assert.doesNotMatch(sanitized.bundle.html, /onclick=/i);
  assert.match(sanitized.bundle.html, />Do something<\/div>/);
  assert.match(sanitized.bundle.html, /const one=\(s\)=>root\.querySelector\(s\)/);
  assert.deepEqual(sanitized.repairs, [{ kind: "remove-document-wrapper" }, { kind: "remove-event-handler-attributes", count: 1 }]);
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
    kind: "remove-document-wrapper"
  }, {
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
  assert.deepEqual(sanitized.repairs, [{ kind: "remove-document-wrapper" }, {
    kind: "add-missing-root-contract-attributes",
    attributes: ["data-start", "data-duration", "data-width", "data-height"]
  }]);
  assert.deepEqual(validateHyperFramesRoot(sanitized.bundle.html, context.plan.shots[0], context.plan.format), []);

  const incorrect = frameBundle("shot-1", 5).html.replace('data-width="1080"', 'data-width="100"');
  const preserved = sanitizeFrameBundle({ ...bundle, html: incorrect }, { shot: context.plan.shots[0], format: context.plan.format });
  assert.match(preserved.bundle.html, /data-width="100"/);
  assert.ok(validateHyperFramesRoot(preserved.bundle.html, context.plan.shots[0], context.plan.format).some((error) => error.includes("data-width")));
});

test("adds host root styling and removes only a redundant frame type locally", () => {
  const context = fixture();
  const bundle = frameBundle("shot-1", 5);
  bundle.type = bundle.schema_version;
  bundle.html = bundle.html.replace("<style>#root{position:absolute;inset:0}</style>", "");

  const sanitized = sanitizeFrameBundle(bundle, { shot: context.plan.shots[0], format: context.plan.format });

  assert.equal(sanitized.bundle.type, undefined);
  assert.match(sanitized.bundle.html, /<template><style>#root\{position:relative;overflow:hidden\}<\/style>/);
  assert.deepEqual(sanitized.repairs, [{ kind: "remove-document-wrapper" }, { kind: "remove-redundant-frame-type" }, { kind: "add-missing-root-style" }]);
  assert.deepEqual(validateHyperFramesRoot(sanitized.bundle.html, context.plan.shots[0], context.plan.format), []);
});

test("wraps an unambiguous live scene and converts a global shot start to local zero", () => {
  const context = fixture();
  const shot = context.plan.shots[1];
  const bundle = frameBundle(shot.id, 5);
  const live = bundle.html.match(/<template>([\s\S]*)<\/template>/)[1];
  bundle.html = `<html><head></head><body>${live.replace("</div><script>", "<template></template></div><script>").replace('data-start="0"', 'data-start="5"')}</body></html>`;

  const sanitized = sanitizeFrameBundle(bundle, { shot, format: context.plan.format });

  assert.match(sanitized.bundle.html, /^<template><style>#root/);
  assert.match(sanitized.bundle.html, /data-start="0"/);
  assert.deepEqual(sanitized.repairs, [
    { kind: "wrap-live-frame-in-template" },
    { kind: "normalize-root-contract-attributes", attributes: ["data-start"] }
  ]);
  assert.deepEqual(validateHyperFramesRoot(sanitized.bundle.html, shot, context.plan.format), []);
});

test("salvages a framed scene with an external font import and live head styles", () => {
  const context = fixture();
  const shot = context.plan.shots[0];
  const bundle = frameBundle(shot.id, 5);
  const remoteFont = "https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,400;1,700&display=swap";
  bundle.html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@import url('${remoteFont}');#shot-1-proof{color:#fff}</style></head><body>${bundle.html}</body></html>`;

  const sanitized = sanitizeFrameBundle(bundle, { shot, format: context.plan.format });

  assert.doesNotMatch(sanitized.bundle.html, /@import|fonts\.googleapis\.com/i);
  assert.doesNotMatch(sanitized.bundle.html, /<\/?(?:html|head|body)\b/i);
  assert.match(sanitized.bundle.html, /<template><style>#shot-1-proof\{color:#fff\}<\/style><style>#root/);
  assert.deepEqual(sanitized.repairs, [
    { kind: "remove-external-stylesheet-imports", count: 1 },
    { kind: "move-live-blocks-into-template", styles: 1, scripts: 0 },
    { kind: "remove-document-wrapper" }
  ]);
  assert.deepEqual(validateHyperFramesRoot(sanitized.bundle.html, shot, context.plan.format), []);
});

test("removes only visually neutral CSS transforms before GSAP owns the element", () => {
  const bundle = frameBundle("shot-1", 5);
  bundle.html = bundle.html.replace("#root{", ".mask{transform:translateX(0)}.scaled{transform:scale(.9)}#root{");

  const sanitized = sanitizeFrameBundle(bundle);

  assert.doesNotMatch(sanitized.bundle.html, /transform:translateX\(0\)/);
  assert.match(sanitized.bundle.html, /\.scaled\{transform:scale\(\.9\)\}/);
  assert.deepEqual(sanitized.repairs, [{ kind: "remove-neutral-css-transforms", count: 1 }, { kind: "remove-document-wrapper" }]);
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
    worker: "frame-director.v4"
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

test("promotes the newest matching frame attempt past a different route attempt", async () => {
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
    worker: "frame-director.v4"
  });
  await store.add({ id: "frame:shot-1", kind: "frame", depends_on: ["creative-plan"], input_hash: inputHash });
  await store.markRunning("frame:shot-1", { provider: "openai", response_id: "resp_spent", status: "completed" });
  await store.markFailed("frame:shot-1", new Error("Frame shot-1 failed semantic validation: root_media_requests[0] must not mount the authoritative voiceover resource as visual media; use the presenter resource"));
  const candidate = frameBundle("shot-1", 5);
  candidate.root_media_requests[0] = { ...candidate.root_media_requests[0], resource_id: "voiceover", kind: "audio", volume: 1 };
  const attempts = path.join(workspace, "production", "frames", ".attempts");
  await mkdir(attempts, { recursive: true });
  await writeFile(path.join(attempts, "shot-1-attempt-1.json"), `${JSON.stringify({ input_hash: inputHash, response_id: "resp_spent", model: "gpt-5.6-sol", usage: { total_tokens: 100 }, candidate })}\n`);
  await writeFile(path.join(attempts, "shot-1-attempt-2.json"), `${JSON.stringify({ input_hash: "different-route-hash", response_id: "resp_other", model: "other-model", usage: {}, candidate: frameBundle("shot-1", 5) })}\n`);
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
  const inputHash = semanticHash({ input: baseInput, model: context.intake.model, reasoning: "high", schema: FRAME_BUNDLE_SCHEMA, worker: "frame-director.v4" });
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

test("retries an interrupted frame job that has no resumable response id", async () => {
  const context = fixture();
  const workspace = await workspaceFixture(context);
  const store = await ProductionJobStore.open(workspace, { create: false });
  const baseInput = buildFrameInput({ ...context, shot: context.plan.shots[0], index: 0 });
  const inputHash = semanticHash({ input: baseInput, model: context.intake.model, reasoning: "high", schema: FRAME_BUNDLE_SCHEMA, worker: "frame-director.v4" });
  await store.add({ id: "frame:shot-1", kind: "frame", depends_on: ["creative-plan"], input_hash: inputHash });
  await store.markRunning("frame:shot-1", { provider: "openrouter", response_id: null, status: "running" });
  const calls = [];
  const client = { runStructured: async (options) => {
    const input = JSON.parse(options.input);
    calls.push(input.shot.id);
    return { response_id: `fresh_${input.shot.id}`, model: "example/free:free", status: "completed", value: frameBundle(input.shot.id, input.shot.duration_seconds), usage: {} };
  } };

  await directFrames(workspace, { concurrency: 2, background: false }, { client });

  assert.deepEqual(calls.sort(), ["shot-1", "shot-2"]);
  const recovered = (await ProductionJobStore.open(workspace, { create: false })).get("frame:shot-1");
  assert.equal(recovered.status, "succeeded");
  assert.equal(recovered.attempt, 2);
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

test("runs fail-closed scenes concurrently but stops scheduling after the first failure", async () => {
  const context = fixture();
  const third = structuredClone(context.plan.shots[1]);
  third.id = "shot-3";
  third.start_seconds = 10;
  third.end_seconds = 15;
  third.visual.events[0].id = "shot-3-reveal";
  third.transition_out = "cut";
  context.plan.shots.push(third);
  context.plan.format.duration_seconds = 15;
  const workspace = await workspaceFixture(context);
  const calls = [];
  let siblingFinished = false;
  const client = { runStructured: async (options) => {
    const input = JSON.parse(options.input);
    calls.push(input.shot.id);
    if (input.shot.id === "shot-1") {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error("first parallel worker failed");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    siblingFinished = true;
    return { response_id: `resp_${input.shot.id}`, model: "free-coder", status: "completed", value: frameBundle(input.shot.id, input.shot.duration_seconds), usage: {} };
  } };

  await assert.rejects(
    () => directFrames(workspace, { concurrency: 3, failClosedConcurrency: 2, fallbackMode: "error", background: false }, { client }),
    /first parallel worker failed/
  );

  assert.deepEqual(calls.sort(), ["shot-1", "shot-2"]);
  assert.equal(siblingFinished, true);
  const store = await ProductionJobStore.open(workspace, { create: false });
  assert.equal(store.get("frame:shot-2").status, "succeeded");
  assert.equal(store.get("frame:shot-3"), null);
});

test("authors parallel scenes from compact LLM blueprints and preserves their receipts", async () => {
  const context = fixture();
  const workspace = await workspaceFixture(context);
  const calls = [];
  const blueprintAttempts = new Map();
  const client = { runStructured: async (options) => {
    const input = JSON.parse(options.input);
    calls.push({ schema: options.schemaName, shot: input.shot?.id ?? input.shot_contract?.id, temperature: options.temperature, input, instructions: options.instructions, prompt_cache_key: options.promptCacheKey });
    if (options.schemaName === "launchclip_frame_blueprint") {
      const shot = input.shot;
      const attempt = (blueprintAttempts.get(shot.id) ?? 0) + 1;
      blueprintAttempts.set(shot.id, attempt);
      if (shot.id === "shot-1" && attempt === 2) {
        assert.ok(input.prior_blueprint);
        assert.match(input.validation_errors_to_repair.join(" "), /proof-label/);
      }
      const elements = shot.visual.objects.map((object, index) => ({
        object_id: object.id,
        selector: `#${shot.id}-${object.id}`,
        zone_id: index === 0 ? "field" : "hero",
        visual_form: `${object.kind} expressed as a concrete editorial game object`,
        priority: object.kind === "diagram-node" ? "primary" : "supporting"
      }));
      if (shot.id === "shot-1" && attempt === 1) elements.pop();
      const event = shot.visual.events[0];
      const target = elements.find((entry) => entry.object_id === event.target_ids[0]);
      const semanticTargets = shot.visual.objects.filter((entry) => entry.kind !== "decoration");
      const supportingMotionBeats = input.supporting_motion_contract.windows.map((window, index) => {
        const object = semanticTargets[index % semanticTargets.length];
        const element = elements.find((entry) => entry.object_id === object.id);
        return {
          window_id: window.id,
          object_id: object.id,
          selector: element?.selector ?? `#${shot.id}-${object.id}`,
          at_seconds: window.start_seconds,
          duration_seconds: window.minimum_duration_seconds,
          intent: index === 0 ? "entrance" : "emphasis",
          changes: index === 0
            ? [{ property: "opacity", from_value: 0, to_value: 1 }, { property: "scale", from_value: .86, to_value: 1 }]
            : [{ property: "y", from_value: 64, to_value: 0 }, { property: "opacity", from_value: .5, to_value: 1 }],
          action: index === 0 ? "Spring the semantic proof into its authored state" : "Lift and emphasize the next semantic label"
        };
      });
      return {
        response_id: `blueprint_${shot.id}`,
        model: "google/gemma-code:free",
        status: "completed",
        value: {
          schema_version: FRAME_BLUEPRINT_VERSION,
          shot_id: shot.id,
          composition_strategy: "A dense editorial game board resolves the proof across the full phone canvas.",
          zones: [
            { id: "field", purpose: "Background evidence field", x_percent: 0, y_percent: 0, width_percent: 100, height_percent: 100, layer: "background" },
            { id: "hero", purpose: "Primary proof and labels", x_percent: 8, y_percent: 14, width_percent: 84, height_percent: 72, layer: "foreground" }
          ],
          elements,
          typography: { display_px: 112, body_px: 42, metadata_px: 24, maximum_text_lines: 2 },
          motion_beats: [{ event_id: event.id, object_id: event.target_ids[0], selector: target.selector, at_seconds: event.at_seconds, action: "Reveal and lock the proof into place" }],
          supporting_motion_beats: supportingMotionBeats,
          visible_copy: shot.on_screen_text,
          density: { target_occupied_percent: 68, minimum_semantic_objects: 2, focal_element_selector: target.selector },
          implementation_notes: ["Use the canvas instead of floating a small card in empty space"]
        },
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }
      };
    }
    const shot = input.shot_contract;
    assert.equal(input.scene_blueprint.shot_id, shot.id);
    assert.equal(input.scene_blueprint.supporting_motion_beats.length, 2);
    assert.equal(input.shot, undefined);
    assert.ok(input.narration_anchors.length <= 8);
    return {
      response_id: `frame_${shot.id}`,
      model: "google/gemma-code:free",
      status: "completed",
      value: frameBundle(shot.id, shot.duration_seconds),
      usage: { input_tokens: 200, output_tokens: 100, total_tokens: 300 }
    };
  } };

  const runOptions = {
    concurrency: 3,
    failClosedConcurrency: 2,
    sceneBlueprint: true,
    leanPrompt: true,
    fallbackMode: "error",
    routes: ["openrouter:google/gemma-code:free@none"],
    background: false
  };
  const result = await directFrames(workspace, runOptions, { client });

  assert.equal(result.generated, 2);
  assert.equal(calls.filter((entry) => entry.schema === "launchclip_frame_blueprint").length, 3);
  assert.equal(calls.filter((entry) => entry.schema === "launchclip_frame_bundle").length, 2);
  assert.equal(calls.length, 5);
  assert.deepEqual(calls.filter((entry) => entry.schema === "launchclip_frame_blueprint").map((entry) => entry.temperature).sort(), [.15, .45, .45]);
  assert.deepEqual(calls.filter((entry) => entry.schema === "launchclip_frame_bundle").map((entry) => entry.temperature), [.4, .4]);
  assert.ok(calls.filter((entry) => entry.schema === "launchclip_frame_bundle").every((entry) => /Never declare CSS transform on an element that GSAP animates/.test(entry.instructions)));
  assert.ok(calls.filter((entry) => entry.schema === "launchclip_frame_bundle").every((entry) => /Set must_remain_live=false for reveal-then-settle elements/.test(entry.instructions)));
  assert.ok(calls.filter((entry) => entry.schema === "launchclip_frame_bundle").every((entry) => /Implement every scene_blueprint\.supporting_motion_beats entry/.test(entry.instructions)));
  assert.ok(calls.filter((entry) => entry.schema === "launchclip_frame_bundle").every((entry) => /as one tl\.fromTo/.test(entry.instructions)));
  assert.ok(calls.filter((entry) => entry.schema === "launchclip_frame_bundle").every((entry) => /opening beat begins by 0\.1s/.test(entry.instructions)));
  assert.ok(calls.filter((entry) => entry.schema === "launchclip_frame_bundle").every((entry) => /not new semantic timeline events/.test(entry.instructions)));
  assert.ok(calls.filter((entry) => entry.schema === "launchclip_frame_bundle").every((entry) => /at least 4\.5:1 for normal text and 3:1 for large text/.test(entry.instructions)));
  assert.ok(calls.filter((entry) => entry.schema === "launchclip_frame_bundle").every((entry) => /Do not use negative top offsets/.test(entry.instructions)));
  assert.ok(calls.filter((entry) => entry.schema === "launchclip_frame_bundle").every((entry) => /must never cross or cover a label/.test(entry.instructions)));
  assert.ok(calls.filter((entry) => entry.schema === "launchclip_frame_bundle").every((entry) => entry.prompt_cache_key === "launchclip:frame-director:v8"));
  assert.deepEqual(result.frames.map((entry) => entry.usage.total_tokens), [450, 450]);
  assert.ok(result.frames.every((entry) => entry.blueprint.cached === false));
  const blueprintRecord = JSON.parse(await readFile(result.frames[0].blueprint.path, "utf8"));
  const frameStore = await ProductionJobStore.open(workspace, { create: false });
  assert.equal(blueprintRecord.blueprint.schema_version, FRAME_BLUEPRINT_VERSION);
  assert.notEqual(blueprintRecord.input_hash, frameStore.get("frame:shot-1").input_hash);

  const storedBundle = JSON.parse(await readFile(result.frames[0].bundle, "utf8"));
  storedBundle.html = `<!doctype html><html><head></head><body>${storedBundle.html}</body></html>`;
  await writeFile(result.frames[0].bundle, `${JSON.stringify(storedBundle, null, 2)}\n`);
  await writeFile(result.frames[0].html, `${storedBundle.html}\n`);
  const refreshedOutputs = await Promise.all([result.frames[0].bundle, result.frames[0].html, result.frames[0].motion].map((filePath) => describeJobOutput(workspace, filePath)));
  await frameStore.replaceSucceededOutputs("frame:shot-1", refreshedOutputs);
  const callsBeforeCacheRecovery = calls.length;

  const recovered = await directFrames(workspace, runOptions, { client });

  assert.equal(calls.length, callsBeforeCacheRecovery);
  assert.equal(recovered.frames[0].recovered, true);
  assert.deepEqual(recovered.frames[0].repairs, [{ kind: "remove-document-wrapper" }]);
  assert.equal(recovered.frames[1].cached, true);
});

test("can exhaust LLM routes without writing a deterministic visual fallback", async () => {
  const context = fixture();
  const workspace = await workspaceFixture(context);
  const calls = [];
  const client = { runStructured: async (options) => {
    const input = JSON.parse(options.input);
    calls.push(input.shot.id);
    const bundle = frameBundle(input.shot.id, input.shot.duration_seconds);
    bundle.html = bundle.html.replace('data-start="0"', 'data-start="1"');
    return { response_id: `resp_${input.shot.id}`, model: "free-coder", status: "completed", value: bundle, usage: {} };
  } };

  await assert.rejects(
    () => directFrames(workspace, { concurrency: 2, semanticAttempts: 1, fallbackMode: "error", background: false }, { client }),
    (error) => error.code === "LAUNCHCLIP_FRAME_MODEL_ROUTES_EXHAUSTED" && /shot-1/.test(error.message)
  );
  assert.deepEqual(calls, ["shot-1"]);
  await assert.rejects(() => readFile(path.join(workspace, "production", "fallbacks", "shot-1.json")), (error) => error.code === "ENOENT");
});

test("rotates after provider failures and reports every attempted model", async () => {
  const context = fixture();
  const workspace = await workspaceFixture(context);
  const routes = ["openrouter:first/free:free@none", "openrouter:second/free:free@none"];
  const attempted = [];
  await assert.rejects(
    () => directFrames(workspace, { routes, concurrency: 1, semanticAttempts: 2, fallbackMode: "error", background: false }, {
      createClient: (route) => ({ runStructured: async () => {
        attempted.push(route.model);
        throw new Error(`${route.model} unavailable`);
      } })
    }),
    (error) => error.code === "LAUNCHCLIP_FRAME_MODEL_ROUTES_EXHAUSTED"
      && /first\/free:free unavailable/.test(error.message)
      && /second\/free:free unavailable/.test(error.message)
  );
  assert.deepEqual(attempted, ["first/free:free", "second/free:free"], "transport failures rotate routes without consuming semantic-repair attempts");
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

test("treats explicitly pinned OpenRouter free routes as zero observed frame cost", async () => {
  const context = fixture();
  const workspace = await workspaceFixture(context);
  const client = { runStructured: async (options) => {
    const input = JSON.parse(options.input);
    return { response_id: `free_${input.shot.id}`, model: "vendor/free-coder", status: "completed", value: frameBundle(input.shot.id, input.shot.duration_seconds), usage: { input_tokens: 100, output_tokens: 100 } };
  } };
  const result = await directFrames(workspace, {
    routes: ["openrouter:vendor/free-coder:free@none"],
    maxFrameCostUsd: .001,
    allowFallback: true,
    background: false
  }, { client });
  assert.equal(result.generated, 2);
  assert.equal(result.frame_cost.estimated_usd, 0);
  assert.equal(result.frame_cost.complete, true);
  assert.equal(result.frame_cost.provider_calls_observed, 2);
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
  const inputHash = semanticHash({ input: baseInput, model: context.intake.model, reasoning: "high", schema: FRAME_BUNDLE_SCHEMA, worker: "frame-director.v4" });
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

test("escalates an invalid local frame to the next pinned generation route", async () => {
  const context = fixture();
  const workspace = await workspaceFixture(context);
  const calls = [];
  const result = await directFrames(workspace, {
    concurrency: 1,
    semanticAttempts: 1,
    routes: ["ollama:qwen2.5-coder:latest@none", "openai:gpt-5.6-terra@high"],
    background: false
  }, {
    createClient: (route) => ({
      runStructured: async (options) => {
        const input = JSON.parse(options.input);
        calls.push({ shot: input.shot.id, provider: route.provider, reasoning: options.reasoningEffort, errors: input.validation_errors_to_repair });
        const value = frameBundle(input.shot.id, input.shot.duration_seconds);
        if (route.provider === "ollama") value.html = value.html.replace('id="root"', 'id="wrong-root"').replace("#root{", "#wrong-root{");
        return { response_id: `${route.provider}_${input.shot.id}`, model: route.model, status: "completed", value, usage: {} };
      }
    })
  });
  assert.equal(result.generated, 2);
  assert.deepEqual(calls.map(({ shot, provider, reasoning }) => ({ shot, provider, reasoning })), [
    { shot: "shot-1", provider: "ollama", reasoning: "none" },
    { shot: "shot-1", provider: "openai", reasoning: "high" },
    { shot: "shot-2", provider: "ollama", reasoning: "none" },
    { shot: "shot-2", provider: "openai", reasoning: "high" }
  ]);
  assert.match(calls[1].errors.join(" "), /root id must be/);
  assert.deepEqual(result.frames.map((frame) => frame.provider), ["openai", "openai"]);
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

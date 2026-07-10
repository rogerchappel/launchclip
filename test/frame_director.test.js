import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildFrameInput, directFrames, validateHyperFramesRoot } from "../src/frame_director.js";
import { ProductionJobStore, semanticHash } from "../src/job_store.js";
import { EVIDENCE_VERSION, FRAME_BUNDLE_VERSION, PRODUCTION_PLAN_VERSION } from "../src/production_contracts.js";

test("gives each delegated frame only its shot, neighbors, grounded evidence, and resources", () => {
  const context = fixture();
  const input = JSON.parse(buildFrameInput({ ...context, shot: context.plan.shots[0], index: 0 }));
  assert.equal(input.shot.id, "shot-1");
  assert.deepEqual(input.neighbors.map((entry) => entry.id), ["shot-2"]);
  assert.deepEqual(input.evidence.map((entry) => entry.id), ["ev-1"]);
  assert.deepEqual(input.resources.map((entry) => entry.id), ["screen"]);
  assert.equal(input.global_design.concept, "Evidence choreography");
});

test("delegates shots concurrently, repairs invalid HTML, and writes modular frame artifacts", async () => {
  const context = fixture();
  const workspace = await workspaceFixture(context);
  let active = 0;
  let peak = 0;
  const attempts = new Map();
  const client = {
    runStructured: async (options) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const input = JSON.parse(options.input);
      const count = (attempts.get(input.shot.id) ?? 0) + 1;
      attempts.set(input.shot.id, count);
      active -= 1;
      const bundle = frameBundle(input.shot.id, input.shot.duration_seconds);
      if (input.shot.id === "shot-1" && count === 1) bundle.html = bundle.html.replace('data-start="0"', 'data-start="1"');
      return { response_id: `resp_${input.shot.id}_${count}`, model: "gpt-5.6-sol", status: "completed", value: bundle, usage: { total_tokens: 100 } };
    }
  };

  const result = await directFrames(workspace, { concurrency: 2, background: false }, { client });
  assert.equal(result.generated, 2);
  assert.equal(peak, 2);
  assert.equal(attempts.get("shot-1"), 2);
  assert.match(await readFile(result.frames[0].html, "utf8"), /data-composition-id="shot-1"/);
  assert.match(await readFile(result.frames[0].motion, "utf8"), /#proof/);

  const cached = await directFrames(workspace, { concurrency: 2 }, { client });
  assert.equal(cached.cached, 2);
  assert.equal(attempts.get("shot-1"), 2);
});

test("rejects a frame root with wrong identity, time, or dimensions", () => {
  const { plan } = fixture();
  const errors = validateHyperFramesRoot('<div data-composition-id="wrong" data-start="1" data-duration="3" data-width="100" data-height="100"></div>', plan.shots[0], plan.format);
  assert.ok(errors.some((entry) => entry.includes("shot-1")));
  assert.ok(errors.some((entry) => entry.includes("data-start")));
  assert.ok(errors.some((entry) => entry.includes("data-duration")));
  assert.ok(errors.some((entry) => entry.includes("data-width")));
});

function frameBundle(id, duration) {
  return {
    schema_version: FRAME_BUNDLE_VERSION,
    shot_id: id,
    html: `<!doctype html><html><body><div data-composition-id="${id}" data-start="0" data-duration="${duration}" data-width="1080" data-height="1920"><div id="proof" class="clip" data-start="0" data-duration="${duration}">Proof</div></div></body></html>`,
    motion: { assertions: [{ selector: "#proof", appears_by_seconds: 1, order: 1, must_stay_in_frame: true, must_remain_live: true }] },
    root_media_requests: [{ resource_id: "screen", kind: "video", start_seconds: 0, end_seconds: duration, volume: 0, placement: "proof window" }],
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
    presenter: { visible: false, placement: "offstage", size: "none", treatment: "none" },
    visual: { description: "Proof develops", composition: "Asymmetric", typography: "Display", background: "Field", foreground: "Proof", motion: "Reveal then settle", internal_reveals: [{ at_seconds: 1, action: "reveal", easing_intent: "fast settle", emphasis: "proof" }] },
    transition_out: "match", sfx: []
  });
  const plan = {
    schema_version: PRODUCTION_PLAN_VERSION,
    project: { title: "Test", thesis: "Proof", audience_promise: "Understand", angle: "Evidence", hook: "Look" },
    format: { aspect: "9:16", width: 1080, height: 1920, duration_seconds: 10, language: "en" },
    design: { concept: "Evidence choreography", art_direction: "Original", palette_roles: [], typography: "Display", texture: "Subtle", composition_logic: "Proof first", motion_character: "Purposeful", density: "Measured" },
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

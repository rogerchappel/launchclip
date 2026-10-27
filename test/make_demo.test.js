// launchclip make --repo (src/make/demo.js): demo autopilot as a make stage,
// with a stub autopilot (copies the recorded fixture flow), a fake model and a
// stub finish.
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_BRAND } from "../kit/core/planning-prompt.mjs";
import { runMake } from "../src/make/index.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const NARRATION = "Pulseboard puts every launch in one place. Sign in, and your numbers are waiting. Try it free today.";

// A stand-in for runAutopilot: one recorded flow, pending review.
function stubAutopilot(calls) {
  return async (repo, flags, { log }) => {
    calls.push({ repo, flags });
    await mkdir(flags.out, { recursive: true });
    await copyFile(path.join(ROOT, "test/fixtures/parity/assets/demo-sign-in.mp4"), path.join(flags.out, "sign-in.mp4"));
    const record = JSON.parse(await readFile(path.join(ROOT, "test/fixtures/demo-sign-in.actions.json"), "utf8"));
    await writeFile(path.join(flags.out, "sign-in.actions.json"), JSON.stringify(record));
    const receipt = { schema: "launchclip.demo-record.v1", out: flags.out, app: { repo, url: "http://localhost:4310" }, flows: [{ id: "sign-in", title: "Sign in", duration: record.duration, review: "pending", video: "sign-in.mp4", log: "sign-in.actions.json", sheet: null, actions: [] }] };
    await writeFile(path.join(flags.out, "demo-record.json"), JSON.stringify(receipt));
    await writeFile(path.join(flags.out, "REVIEW.md"), "# review\n");
    log("recorded sign-in");
    return receipt;
  };
}

// The model: the script pass returns NARRATION; the storyboard pass copies the
// product-demo params from the manifest line, as the prompt tells it to.
function fakeModel() {
  const calls = [];
  const client = {
    provider: "openai",
    async runStructured(request) {
      calls.push(request);
      const usage = { input_tokens: 100, output_tokens: 100 };
      if (request.schemaName === "launchclip_make_script") return { model: "m", value: { title: "Pulseboard", narration: NARRATION }, usage };
      const duration = Number(/"duration":([\d.]+)/.exec(request.input)[1]);
      const line = /assets\/demo\/sign-in\.mp4 — product demo recording[^\n]*?exactly these params \(copy unchanged[^)]*\): (\{.*\})/.exec(request.input);
      assert.ok(line, "the manifest offers the recorded flow with its params");
      const params = JSON.parse(line[1]);
      const end = Math.min(duration - 2, 2 + 9);
      params.actions = params.actions.filter((action) => action.at <= end - 2 - 0.2);
      params.callouts = (params.callouts ?? []).filter((callout) => callout.at <= end - 2 - 1);
      if (!params.callouts.length) delete params.callouts;
      const board = { schema: "launchclip.story.v1", lane: "motion", format: { width: 1920, height: 1080, fps: 30, duration }, brand: DEFAULT_BRAND, audio: { words: "NARRATION.json" },
        scenes: [
          { id: "s1", module: "object-card", start: 0, end: 2, params: { object: "rocket", caption: "One place for every launch" } },
          { id: "s2", module: "product-demo", start: 2, end, in: { type: "fade", dur: 0.3 }, params },
          { id: "s3", module: "cta", start: end, end: duration, in: { type: "fade", dur: 0.3 }, params: { action: "Try Pulseboard free" } }
        ], overlays: [{ type: "captions", style: "word-highlight" }] };
      return { model: "m", value: { storyboard_json: JSON.stringify(board) }, usage };
    }
  };
  return { calls, model: { client, provider: "openai", model: "m", spec: "openai:m", vision: false } };
}

const fakeFinish = async (project) => {
  await mkdir(path.join(project, "renders"), { recursive: true });
  await writeFile(path.join(project, "renders/draft.mp4"), "video");
  return { status: "ready-for-review", seconds: 1, final: path.join(project, "renders/draft.mp4"), warnings: [], stages: [{ name: "render", status: "done", seconds: 1 }], gates: {} };
};

test("make --repo records the app, stops for review headless, and edits approved flows in as product-demo scenes", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-demo-"));
  try {
    const autopilotCalls = [];
    const { calls, model } = fakeModel();
    const base = { env: {}, client: model, autopilot: stubAutopilot(autopilotCalls), finish: fakeFinish, notice() {} };
    const options = { repo: path.join(ROOT, "examples/demo-app"), voice: "test", music: "synth", cwd, out: "pulse", duration: 14 };

    // Headless, nothing approved: the demo stage stops with the review as the next step.
    const first = await runMake("A launch video for Pulseboard", options, { ...base, ask: async () => false });
    assert.equal(first.status, "failed");
    assert.equal(first.failed_stage, "demo");
    assert.match(first.next_steps[0], /no approved demo flows: look at the contact sheets in assets\/demo\/REVIEW\.md, run launchclip demo approve .*assets\/demo/);
    assert.equal(autopilotCalls.length, 1);
    assert.equal(autopilotCalls[0].flags.approve, false, "the repo's commands need their own consent");

    // A yes on review: the recording is reused and the flow is edited in.
    const second = await runMake("A launch video for Pulseboard", options, { ...base, ask: async () => true });
    assert.equal(second.status, "ready", JSON.stringify(second.stages));
    assert.equal(autopilotCalls.length, 1, "the recording is reused");
    assert.equal(second.stages.demo.status, "cached");
    assert.deepEqual(second.demo.flows.map((flow) => flow.id), ["sign-in"]);
    const scriptCall = calls.find((call) => call.schemaName === "launchclip_make_script");
    assert.match(scriptCall.input, /product demo recording "Sign in"/);
    const story = JSON.parse(await readFile(path.join(cwd, "pulse", "storyboard.json"), "utf8"));
    const demo = story.scenes.find((scene) => scene.module === "product-demo");
    assert.equal(demo.params.media.src, "assets/demo/sign-in.mp4");
    // The boxes come from the action log unchanged.
    const record = JSON.parse(await readFile(path.join(ROOT, "test/fixtures/demo-sign-in.actions.json"), "utf8"));
    assert.ok(demo.params.actions.length >= 1);
    assert.deepEqual(demo.params.actions[0].box, record.actions.find((action) => action.type === "type").box);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("make --repo --approve-demo consents to the commands and the flows up front", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-demo-"));
  try {
    const autopilotCalls = [];
    const { model } = fakeModel();
    const report = await runMake("A launch video for Pulseboard", { repo: path.join(ROOT, "examples/demo-app"), approveDemo: true, voice: "test", music: "synth", cwd, out: "pulse", duration: 14 },
      { env: {}, client: model, autopilot: stubAutopilot(autopilotCalls), finish: fakeFinish, notice() {}, ask: async () => { throw new Error("should not ask"); } });
    assert.equal(report.status, "ready", JSON.stringify(report.stages));
    assert.equal(autopilotCalls[0].flags.approve, true);
    const receipt = JSON.parse(await readFile(path.join(cwd, "pulse/assets/demo/demo-record.json"), "utf8"));
    assert.equal(receipt.flows[0].review, "approved");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

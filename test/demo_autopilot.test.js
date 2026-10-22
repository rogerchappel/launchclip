// Demo autopilot end to end (src/demo/autopilot.js): consent, plan-only, and
// a real recording of examples/demo-app (skipped when Playwright or a
// Chromium is not available; it never downloads one).
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { productDemoParams } from "../kit/core/catalog-d.mjs";
import { resolveModule } from "../kit/core/modules.mjs";
import { resolveStory } from "../kit/core/story.mjs";
import { runCli } from "../src/cli.js";
import { approveFlows, approvedFlows, runAutopilot } from "../src/demo/autopilot.js";
import { recorderAvailability } from "../src/demo/record.js";

const FIXTURE = path.resolve(import.meta.dirname, "..", "examples", "demo-app");
const available = await recorderAvailability();

async function workspace() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-autopilot-"));
  // A copy, so the seed's data/db.json never lands in the repo.
  await cp(FIXTURE, path.join(dir, "app"), { recursive: true, filter: (source) => !source.includes(`${path.sep}data`) });
  return { dir, app: path.join(dir, "app"), out: path.join(dir, "assets", "demo") };
}

async function freePort() {
  return new Promise((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

test("autopilot asks before running the seed and start commands, and refuses without consent", async (t) => {
  const { dir, app, out } = await workspace();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const asked = [];
  await assert.rejects(runAutopilot(app, { out }, { log: (line) => asked.push(line), ask: async () => false }), /not approved: demo autopilot runs `npm run seed` and `npm run dev`/);
  assert.match(asked.join("\n"), /seed {2}npm run seed\n {2}start npm run dev\nand record http:\/\/localhost:4310/);
  assert.ok(!existsSync(path.join(app, "data", "db.json")), "nothing ran");
  await assert.rejects(runAutopilot(app, { out, url: "https://app.pulseboard.com", approve: true }), /production host/);
});

test("--plan-only writes DEMO-PLAN.json from the code and runs nothing", async (t) => {
  const { dir, app, out } = await workspace();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const receipt = await runAutopilot(app, { out, "plan-only": true }, { ask: async () => { throw new Error("should not ask"); } });
  assert.equal(receipt.recorded, false);
  const plan = JSON.parse(await readFile(path.join(out, "DEMO-PLAN.json"), "utf8"));
  assert.deepEqual(plan.flows.map((flow) => flow.id), ["sign-in", "analytics", "dashboard"]);
  assert.ok(!existsSync(path.join(app, "data", "db.json")));
});

test("demo record and approve through the CLI usage table", async () => {
  const out = [];
  await runCli(["demo", "record", "--help"], { stdout: { write: (value) => out.push(value) } });
  assert.match(out.join(""), /launchclip demo record <repo>/);
  await assert.rejects(runCli(["demo", "approve", "/nonexistent-dir"], { stdout: { write: () => {} }, stderr: { write: () => {} } }), /no demo-record\.json/);
});

test("records the demo-app fixture: clip, action log, contact sheet, review, product-demo params", { skip: !available.ok && `recorder unavailable: ${available.reasons.join("; ")}`, timeout: 180000 }, async (t) => {
  const { dir, app, out } = await workspace();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const port = await freePort();
  const receipt = await runAutopilot(app, { out, approve: true, start: `node server.js --port ${port}`, url: `http://127.0.0.1:${port}`, flows: "sign-in,analytics" }, {});
  assert.deepEqual(receipt.flows.map((flow) => [flow.id, flow.review]), [["sign-in", "pending"], ["analytics", "pending"]]);
  assert.equal(receipt.account.email, "demo@pulseboard.test");
  assert.deepEqual(receipt.commands.map((entry) => entry.kind), ["seed", "start"]);
  for (const flow of receipt.flows) for (const file of [flow.video, flow.log, flow.poster, flow.sheet]) assert.ok(existsSync(path.join(out, file)), file);
  const log = JSON.parse(await readFile(path.join(out, "sign-in.actions.json"), "utf8"));
  const click = log.actions.find((action) => action.type === "click");
  assert.ok(click.box.width > 100 && click.box.height > 20, JSON.stringify(click.box));
  assert.ok(click.at > 0 && click.at < log.duration);
  const typed = log.actions.filter((action) => action.type === "type");
  assert.deepEqual(typed.map((action) => action.value), ["{account: email}", "{account: password}"]);
  assert.equal(typed[1].keys.length, "demo-pass-123".length);
  assert.ok(!JSON.stringify(log).includes("demo-pass-123"), "the password is never logged");
  assert.ok(!(await readFile(path.join(out, "REVIEW.md"), "utf8")).includes("demo-pass-123"));
  // The app was stopped after recording.
  await assert.rejects(fetch(`http://127.0.0.1:${port}`));

  // Nothing is usable until approved.
  assert.deepEqual(await approvedFlows(out), []);
  await approveFlows(out, { flows: ["sign-in"] });
  const [approved] = await approvedFlows(out);
  assert.equal(approved.id, "sign-in");

  // The log drives a product-demo scene that resolves.
  const params = productDemoParams(approved.record, { src: "assets/demo/sign-in.mp4", sourceStart: 0.5, duration: Math.min(8, approved.record.duration - 0.5) });
  const story = resolveStory({ schema: "launchclip.story.v1", lane: "motion", format: { width: 1920, height: 1080, fps: 30, duration: 9 }, brand: { colors: { bg: "#0b0d12", primary: "#5b4dff", accent: "#22c3ee", paper: "#f4efe6", ink: "#0b0d12" } }, scenes: [{ id: "demo", module: "product-demo", start: 0.5, end: 0.5 + Math.min(8, approved.record.duration - 0.5), params }] });
  const model = resolveModule(story.scenes[0], story);
  assert.ok(model.events.some((event) => event.cue === "click"));
  assert.ok(model.content.samples.some((sample) => sample.scale > 1.5));
});

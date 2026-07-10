import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { renderProduction, verifyProduction } from "../src/production_render.js";

test("runs lint, browser validation, transition-aware inspection, and assembled snapshots", async () => {
  const workspace = await fixture();
  const commands = [];
  const run = async (command, args) => { commands.push([command, args]); return { stdout: args.includes("--json") ? '{"findings":[]}' : "snapshots written", stderr: "" }; };
  const result = await verifyProduction(workspace, { inspectSamples: 17, snapshotFrames: 9 }, { run });
  assert.equal(result.status, "ready");
  assert.deepEqual(commands.map((entry) => entry[1][1]), ["lint", "validate", "inspect", "snapshot"]);
  assert.ok(commands[2][1].includes("--at-transitions"));
  assert.ok(commands[3][1].includes("9"));
  assert.deepEqual((JSON.parse(await readFile(path.join(result.qa, "verification.json"), "utf8"))).failed, []);
});

test("blocks final rendering without approval and records failed HyperFrames checks", async () => {
  const workspace = await fixture();
  await assert.rejects(() => renderProduction(workspace), /requires explicit --approve/);
  const run = async (_command, args) => {
    if (args[1] === "inspect") { const error = new Error("overflow"); error.code = 1; error.stdout = '{"findings":[{"severity":"error"}]}'; throw error; }
    return { stdout: "{}", stderr: "" };
  };
  await assert.rejects(() => verifyProduction(workspace, {}, { run }), /inspect/);
  const inspect = JSON.parse(await readFile(path.join(workspace, "production", "qa", "inspect.json"), "utf8"));
  assert.equal(inspect.ok, false);
});

test("renders only after verification then runs frame-by-frame motion gates", async () => {
  const workspace = await fixture();
  const commands = [];
  const run = async (_command, args) => { commands.push(args[1]); return { stdout: args.includes("--json") ? "{}" : "ok", stderr: "" }; };
  let motionInput;
  const result = await renderProduction(workspace, { approve: true, references: ["/tmp/reference.mp4"] }, {
    run,
    writeMotionReport: async (video, output, options) => {
      motionInput = { video, output, options };
      await writeFile(output, "{}\n");
      return { quality: { ok: true }, family: "rapid-hybrid" };
    },
    critiqueProduction: async () => ({ verdict: "ship", status: "approved" })
  });
  assert.equal(result.status, "awaiting-human-review");
  assert.equal(commands.at(-1), "render");
  assert.equal(motionInput.options.expected.width, 1080);
  assert.deepEqual(motionInput.options.references, ["/tmp/reference.mp4"]);
});

test("returns a targeted repair state when the independent critic does not approve", async () => {
  const workspace = await fixture();
  const result = await renderProduction(workspace, { approve: true }, {
    run: async (_command, args) => ({ stdout: args.includes("--json") ? "{}" : "ok", stderr: "" }),
    writeMotionReport: async (_video, output) => { await writeFile(output, "{}\n"); return { quality: { ok: true }, family: "developing-card" }; },
    critiqueProduction: async () => ({ verdict: "repair", status: "needs-repair", findings: 2 })
  });
  assert.equal(result.status, "needs-repair");
  assert.equal(result.critique.findings, 2);
});

async function fixture() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-render-"));
  await mkdir(path.join(workspace, "production", "hyperframes"), { recursive: true });
  await writeFile(path.join(workspace, "production", "plan.json"), `${JSON.stringify({ format: { duration_seconds: 10, width: 1080, height: 1920 } })}\n`);
  await writeFile(path.join(workspace, "production", "hyperframes", "index.html"), '<div data-composition-id="main" data-duration="10" data-width="1080" data-height="1920"></div>');
  return workspace;
}

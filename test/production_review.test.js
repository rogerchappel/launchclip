import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isProductionReviewWorkspace, runProductionReview } from "../src/production_review.js";

test("keeps Studio and terminal review actions in one resumable session", async () => {
  const workspace = "/tmp/launchclip-review";
  const answers = ["invalid", "c", "Make the supporting text larger.", "r", "o", "a"];
  const calls = [];
  const output = [];
  const result = await runProductionReview(workspace, {
    initial: { status: "awaiting-approval", critique: { verdict: "ship", findings: 0 } }
  }, {
    ask: async () => answers.shift(),
    output: { write: (value) => output.push(value) },
    openPreview: async () => {
      calls.push("preview");
      return { studio: { url: "http://localhost:3002/#project/video" } };
    },
    revise: async (_target, request) => {
      calls.push(["revise", request.humanReviewRequest ?? null]);
      return { status: "awaiting-approval", critique: { verdict: "ship", findings: 0 } };
    },
    approve: async () => {
      calls.push("approve");
      return { stage: "production-render", status: "awaiting-human-review", video: "/tmp/final.mp4", critique: { verdict: "ship", findings: 0 } };
    }
  });
  assert.equal(result.action, "approved-and-rendered");
  assert.equal(result.render.video, "/tmp/final.mp4");
  assert.deepEqual(calls, [
    "preview",
    ["revise", "Make the supporting text larger."],
    ["revise", null],
    "preview",
    "approve"
  ]);
  assert.match(output.join(""), /Choose A, C, R, O, or Q/);
  assert.match(output.join(""), /Running final verification and render/);
});

test("saves an unfinished review for a later resume", async () => {
  const result = await runProductionReview("/tmp/review-later", {}, {
    ask: async () => "q",
    output: { write: () => {} },
    getStatus: async () => ({ status: "needs-repair", critique: { verdict: "repair", findings: 2 } }),
    openPreview: async () => ({ studio: { url: "http://localhost:3002" } })
  });
  assert.equal(result.status, "needs-repair");
  assert.equal(result.action, "saved");
  assert.match(result.next, /launchclip review \/tmp\/review-later/);
});

test("refuses to hang when interactive review has no terminal", async () => {
  let opened = false;
  await assert.rejects(() => runProductionReview("/tmp/non-interactive", {}, {
    input: { isTTY: false },
    output: { isTTY: false, write: () => {} },
    openPreview: async () => { opened = true; }
  }), (error) => error.code === "LAUNCHCLIP_INTERACTIVE_REVIEW_REQUIRES_TTY");
  assert.equal(opened, false);
});

test("distinguishes production workspaces from legacy packet workspaces", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-review-kind-"));
  assert.equal(await isProductionReviewWorkspace(workspace), false);
  await mkdir(path.join(workspace, "production"));
  await writeFile(path.join(workspace, "production", "intake.json"), "{}\n");
  assert.equal(await isProductionReviewWorkspace(workspace), true);
});

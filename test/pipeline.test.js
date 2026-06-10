import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initWorkspace, planVideo, renderDryRun, runDemo, runPacket, submitReview, validateWorkspace, writeCaptions, writeReview } from "../src/pipeline.js";

const fixtureRepo = path.resolve("test/fixtures/sample-tool");

test("creates a complete dry-run promotion packet", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  try {
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, { out, "demo-cmd": "npm run smoke", capture: "terminal" });
    await planVideo(out, { format: "short-30", renderer: "none" });
    await writeCaptions(out, { platforms: "x,linkedin,tiktok,bluesky" });
    await renderDryRun(out, { provider: "product-videogen", "dry-run": true });
    await submitReview(out, { provider: "product-videogen", "dry-run": true });
    await writeReview(out);

    const manifest = JSON.parse(await readFile(path.join(out, "launchclip.json"), "utf8"));
    const reviewPayload = JSON.parse(await readFile(path.join(out, "review/product-videogen-review.dry-run.json"), "utf8"));
    const review = await readFile(path.join(out, "REVIEW.md"), "utf8");

    assert.equal(manifest.source_repo.name, "sample-tool");
    assert.equal(manifest.stages.submit_review.approval_status, "pending");
    assert.equal(reviewPayload.approval_status, "pending");
    assert.equal(reviewPayload.metadata_json.claim_status, "evidence_backed");
    assert.match(review, /Product-Videogen Follow-Up/);
    assert.match(review, /Social readiness: ready/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("runs and validates a social-ready packet in one command", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  try {
    const result = await runPacket(fixtureRepo, {
      out,
      "demo-cmd": "npm run smoke",
      angle: "turns demo proof into launch content",
      audience: "developers shipping small OSS tools",
      "cta-url": "https://github.com/rogerchappel/sample-tool"
    });
    const readiness = await validateWorkspace(out);
    const xCaption = await readFile(path.join(out, "captions/x.md"), "utf8");

    assert.equal(result.status, "ready");
    assert.equal(readiness.status, "ready");
    assert.ok(xCaption.length <= 280);
    assert.match(xCaption, /Claim status:/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("rejects live submit in V1", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  try {
    await initWorkspace(fixtureRepo, { out });
    await assert.rejects(
      submitReview(out, { provider: "product-videogen", submit: true }),
      /Live product-videogen submission is intentionally disabled/
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

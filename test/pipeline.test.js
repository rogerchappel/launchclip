import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, access, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { initWorkspace, planVideo, renderDryRun, renderVideo, runDemo, runPacket, submitReview, validateWorkspace, writeCaptions, writeReview } from "../src/pipeline.js";

const execFileAsync = promisify(execFile);

const fixtureRepo = path.resolve("test/fixtures/sample-tool");

test("creates a complete dry-run promotion packet", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  const screenshot = path.join(temp, "demo.png");
  try {
    await writeFile(screenshot, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwq3GQAAAABJRU5ErkJggg==", "base64"));
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, { out, "demo-cmd": "npm run smoke", capture: "terminal", "demo-media": screenshot });
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
      audience: "maintainers who want trustworthy docs without CI drama",
      "cta-url": "https://github.com/rogerchappel/sample-tool"
    });
    const readiness = await validateWorkspace(out);
    const xCaption = await readFile(path.join(out, "captions/x.md"), "utf8");
    const video = JSON.parse(await readFile(path.join(out, "video/video.json"), "utf8"));

    assert.equal(result.status, "ready");
    assert.equal(readiness.status, "ready");
    assert.equal(video.format, "short-15");
    assert.equal(video.duration_seconds, 15);
    assert.match(video.structure.map((beat) => beat.beat).join(","), /usage/);
    assert.ok(xCaption.length <= 280);
    assert.match(xCaption, /Claim status:/);
    assert.doesNotMatch(xCaption, /wit\./);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("plans ugc split-screen creative recipe for product-videogen handoff", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  try {
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, { out, "demo-cmd": "npm run smoke", capture: "terminal" });
    await planVideo(out, { format: "short-30", renderer: "product-videogen", style: "ugc-split", "talking-head": "heygen", "avatar-id": "avatar_launchclip_demo" });
    await writeCaptions(out, { platforms: "x,linkedin,tiktok,bluesky" });
    await renderDryRun(out, { provider: "product-videogen", "dry-run": true });

    const video = JSON.parse(await readFile(path.join(out, "video/video.json"), "utf8"));
    const renderPlan = JSON.parse(await readFile(path.join(out, "video/render-plan.json"), "utf8"));
    const payload = JSON.parse(await readFile(path.join(out, "video/product-videogen.dry-run.json"), "utf8"));

    assert.equal(video.style, "ugc-split");
    assert.equal(video.duration_seconds, 30);
    assert.equal(video.creative_recipe.preset, "ugc-split");
    assert.equal(video.talking_head.provider, "heygen");
    assert.equal(video.talking_head.avatar_id, "avatar_launchclip_demo");
    assert.equal(video.talking_head.adapter_contract, "launchclip.talking-head.v1");
    assert.equal(video.script.schema_version, "launchclip.script.v1");
    assert.equal(video.script_visual_alignment.length, 5);
    assert.equal(video.script_visual_alignment[0].beat, "hook");
    assert.match(video.script_visual_alignment[0].voiceover, /sample-tool/);
    assert.match(video.script_visual_alignment[1].visual, /split-screen/i);
    assert.equal(video.script_visual_alignment[4].caption, "Review before posting");
    assert.match(video.structure.map((beat) => beat.beat).join(","), /split-screen-proof/);
    assert.match(renderPlan.adapters.heygen, /First talking-head adapter target/);
    assert.equal(renderPlan.script_visual_alignment.length, 5);
    assert.equal(renderPlan.creative_recipe.visual_language.pacing, "scene change every 1-3 seconds; avoid long static terminal shots");
    assert.equal(payload.recipe_json.creative_recipe.preset, "ugc-split");
    assert.equal(payload.recipe_json.talking_head.provider, "heygen");
    assert.equal(payload.recipe_json.script_visual_alignment[2].caption, "Demo -> plan -> captions -> review");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("plans and renders punchy social-ready UGC preview", async (t) => {
  if (!(await hasCommand("ffmpeg"))) {
    t.skip("ffmpeg is not installed");
    return;
  }
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  try {
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, { out, "demo-cmd": "npm run smoke", capture: "terminal" });
    await planVideo(out, { format: "short-30", renderer: "local-ffmpeg", style: "ugc-demo-punchy", "talking-head": "heygen" });
    await writeCaptions(out, { platforms: "x,linkedin,tiktok,bluesky" });
    await renderDryRun(out, { provider: "product-videogen", "dry-run": true });
    await submitReview(out, { provider: "product-videogen", "dry-run": true });
    const result = await renderVideo(out, { provider: "local-ffmpeg", duration: "4", fps: "6" });
    const readiness = await validateWorkspace(out);

    const video = JSON.parse(await readFile(path.join(out, "video/video.json"), "utf8"));
    await access(result.video);
    await access(result.thumbnail);
    assert.equal(video.style, "ugc-demo-punchy");
    assert.equal(video.creative_recipe.renderer_contract.adapter, "launchclip.social-render.v1");
    assert.equal(video.script_visual_alignment.length, 7);
    assert.equal(video.script_visual_alignment[0].beat, "cold-open");
    assert.equal(video.script_visual_alignment[0].caption, "Repo -> Short");
    assert.match(video.script_visual_alignment[3].visual, /Split-screen/i);
    assert.match(video.script_visual_alignment[5].motion, /file cards flash/i);
    assert.equal(readiness.status, "ready");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("validation catches missing script and visual alignment fields", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  try {
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, { out, "demo-cmd": "npm run smoke", capture: "terminal" });
    await planVideo(out, { format: "short-30", renderer: "product-videogen", style: "ugc-split", "talking-head": "heygen" });
    await writeCaptions(out, { platforms: "x,linkedin,tiktok,bluesky" });
    await renderDryRun(out, { provider: "product-videogen", "dry-run": true });
    await submitReview(out, { provider: "product-videogen", "dry-run": true });

    const videoPath = path.join(out, "video/video.json");
    const video = JSON.parse(await readFile(videoPath, "utf8"));
    delete video.script_visual_alignment[0].visual;
    video.script_visual_alignment[1].beat = "unmapped";
    await writeFile(videoPath, `${JSON.stringify(video, null, 2)}\n`);

    const readiness = await validateWorkspace(out);
    assert.equal(readiness.status, "needs-work");
    assert.match(readiness.issues.join("\n"), /missing visual/);
    assert.match(readiness.issues.join("\n"), /no matching visual structure beat/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("copies optional UI demo media into the packet receipt", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  const screenshot = path.join(temp, "demo.png");
  try {
    await writeFile(screenshot, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwq3GQAAAABJRU5ErkJggg==", "base64"));
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, { out, "demo-cmd": "npm run smoke", capture: "terminal", "demo-media": screenshot });

    const receipt = JSON.parse(await readFile(path.join(out, "demo/command-receipt.json"), "utf8"));

    assert.deepEqual(receipt.artifacts.map((artifact) => artifact.type), ["terminal", "screenshot"]);
    await access(path.join(out, "demo/media.png"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("redacts obvious secrets from demo evidence", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  try {
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, {
      out,
      "demo-cmd": "node -e \"console.log('API_KEY=sk-testsecret1234567890'); console.error('token=ghp_abcdefghijklmnop')\"",
      capture: "terminal"
    });

    const terminal = await readFile(path.join(out, "demo/terminal.txt"), "utf8");
    const receipt = JSON.parse(await readFile(path.join(out, "demo/command-receipt.json"), "utf8"));

    assert.doesNotMatch(terminal, /sk-testsecret/);
    assert.doesNotMatch(terminal, /ghp_abcdefghijklmnop/);
    assert.doesNotMatch(receipt.command, /sk-testsecret/);
    assert.match(terminal, /\[REDACTED_SECRET\]/);
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

test("renders a local uploadable video when ffmpeg is available", async (t) => {
  if (!(await hasCommand("ffmpeg"))) {
    t.skip("ffmpeg is not installed");
    return;
  }
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  const screenshot = path.join(temp, "demo.png");
  try {
    await writeFile(screenshot, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwq3GQAAAABJRU5ErkJggg==", "base64"));
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, { out, "demo-cmd": "npm run smoke", capture: "terminal", "demo-media": screenshot });
    await planVideo(out, { format: "short-15", renderer: "local-ffmpeg" });
    await writeCaptions(out, { platforms: "x,linkedin,tiktok,bluesky" });
    await renderDryRun(out, { provider: "product-videogen", "dry-run": true });
    await submitReview(out, { provider: "product-videogen", "dry-run": true });
    const result = await renderVideo(out, { provider: "local-ffmpeg", duration: "6" });
    const readiness = await validateWorkspace(out);

    await access(result.video);
    await access(result.thumbnail);
    assert.equal(readiness.status, "ready");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

async function hasCommand(command) {
  try {
    await execFileAsync("which", [command]);
    return true;
  } catch {
    return false;
  }
}

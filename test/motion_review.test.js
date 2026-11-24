import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildMotionReviewPack, checkMotionReview, SHOT_CHECKS, unresolvedFindings } from "../eval/motion-review.mjs";

// Two-shot fixture (a hard cut at 1s) and a 2s reference, tiny and fast to make.
async function fixtures() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "motion-review-"));
  const video = path.join(dir, "video.mp4");
  const reference = path.join(dir, "reference.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=160x120:r=30:d=1", "-f", "lavfi", "-i", "color=c=white:s=160x120:r=30:d=1", "-filter_complex", "[1:v]drawbox=x=70:y=20:w=20:h=80:c=black:t=fill[b];[0:v][b]concat=n=2:v=1[v]", "-map", "[v]", "-pix_fmt", "yuv420p", video]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "smptebars=s=160x120:r=30:d=2", "-pix_fmt", "yuv420p", reference]);
  return { dir, video, reference };
}

const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const save = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

function fill(review, status = "pass") {
  const row = { status, observation: "watched at speed; the arm leads, the hand lands, the body settles", evidence: ["shot-01-m0.png", "0.2-0.8s"], reason: "" };
  review.checks.limb_weight = { ...review.checks.limb_weight, ...row, comparison_basis: "middle frames, scaled so both heads are 40 px wide" };
  for (const shot of review.shots) for (const key of Object.keys(SHOT_CHECKS)) shot.checks[key] = { ...row };
  review.decisions.motion = { status, reviewer: "test", method: "playback and frame strips", reviewed_at: "2026-11-25" };
  return review;
}

test("review-motion makes a pack bound to the video and reference, every check pending", async (t) => {
  const { dir, video, reference } = await fixtures();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out = path.join(dir, "pack");
  const { file, review } = await buildMotionReviewPack(video, { reference, referenceRanges: "0-1,1-2", out });
  assert.equal(review.shots.length, 2, "the cut at 1s splits the video");
  assert.ok(Math.abs(review.shots[1].start - 1) < 0.05);
  assert.equal(review.reference.segments.length, 2);
  assert.match(review.video.sha256, /^[0-9a-f]{64}$/);
  assert.match(review.reference.sha256, /^[0-9a-f]{64}$/);
  for (const shot of review.shots) {
    assert.ok(existsSync(path.join(out, shot.clip)));
    assert.deepEqual(shot.moments.map((moment) => moment.why).at(0), "cut in");
    for (const moment of shot.moments) assert.ok(existsSync(path.join(out, moment.strip)));
    for (const key of Object.keys(SHOT_CHECKS)) assert.equal(shot.checks[key].status, "pending");
  }
  // The second shot is a black bar on white: a figure with no head, so no ratio, and a reason.
  assert.ok(review.shots[1].limb_weight.every((entry) => entry.ratio === null && entry.reason));
  assert.deepEqual(Object.values(review.decisions).map((decision) => decision.status), ["pending", "pending", "pending"]);
  assert.ok(existsSync(path.join(out, "index.html")) && review.artifacts["index.html"]);
  await assert.rejects(buildMotionReviewPack(video, { out }), /exists/);

  const fresh = await checkMotionReview(out);
  assert.equal(fresh.ok, false);
  assert.ok(fresh.pending > 0);
  assert.ok(fresh.errors.some((error) => /decisions\.motion is pending/.test(error)));

  await save(file, fill(await read(file)));
  const filled = await checkMotionReview(file);
  assert.deepEqual(filled.errors, []);
  assert.equal(filled.ok, true);
});

test("check refuses a pass with gaps, a missing comparison basis, a bad n/a or a changed video", async (t) => {
  const { dir, video, reference } = await fixtures();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const copy = path.join(dir, "copy.mp4");
  await copyFile(video, copy);
  const { file } = await buildMotionReviewPack(copy, { reference, out: path.join(dir, "pack") });
  const review = fill(await read(file));
  review.shots[0].checks.gesture.status = "needs_repair";
  review.shots[1].checks.reaction = { status: "not_applicable", observation: "", evidence: [], reason: "" };
  review.checks.limb_weight.comparison_basis = "";
  review.shots[0].checks.rhythm.evidence = ["nope.png"];
  await save(file, review);
  const result = await checkMotionReview(file);
  assert.equal(result.ok, false);
  const all = result.errors.join("\n");
  assert.match(all, /open: .*shot-1\.gesture/);
  assert.match(all, /shot-2\.reaction: not_applicable needs a reason/);
  assert.match(all, /limb_weight: a pass needs comparison_basis/);
  assert.match(all, /nope\.png is not a file in the pack/);

  await appendFile(copy, Buffer.from([0]));
  assert.match((await checkMotionReview(file)).errors.join("\n"), /video .* changed since the pack was made/);
});

test("a model's first pass is a suggestion and never a verdict", async (t) => {
  const { dir, video } = await fixtures();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const seen = [];
  const judge = async ({ shot, frames }) => {
    seen.push({ id: shot.id, frames: frames.length });
    return { checks: Object.fromEntries(Object.keys(SHOT_CHECKS).map((key) => [key, { verdict: "pass", observation: `looks fine (${key})` }])) };
  };
  const { file, review } = await buildMotionReviewPack(video, { out: path.join(dir, "pack"), judge, model: "stub:vision" });
  assert.equal(seen.length, 2);
  assert.ok(seen.every((entry) => entry.frames >= 3));
  assert.equal(review.shots[0].checks.gesture.status, "pending");
  assert.deepEqual(review.shots[0].checks.gesture.suggested, { verdict: "pass", observation: "looks fine (gesture)", by: "stub:vision" });
  const result = await checkMotionReview(file);
  assert.match(result.errors.join("\n"), /pending \(a model's suggestion is not a verdict\)/);
});

test("earlier failures are carried into the repair log and each needs a resolution", async (t) => {
  const { dir, video } = await fixtures();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const first = await buildMotionReviewPack(video, { out: path.join(dir, "review-01") });
  const rejected = fill(await read(first.file), "pass");
  rejected.shots[0].checks.gesture = { status: "needs_repair", observation: "the arm swings with no anticipation", evidence: ["0.3-0.6s"], reason: "" };
  rejected.remaining_gaps = ["captions sit lower than the reference"];
  rejected.decisions.motion.status = "needs_repair";
  await save(first.file, rejected);
  const firstCheck = await checkMotionReview(first.file);
  assert.equal(firstCheck.verdict, "needs_repair");
  assert.deepEqual(firstCheck.errors, [], "a complete needs_repair review is valid, just not a pass");
  assert.deepEqual(unresolvedFindings(rejected).map((finding) => finding.issue), ["shot-1.gesture", "gap-1"]);

  // The repaired render is a different file.
  const repaired = path.join(dir, "repaired.mp4");
  await copyFile(video, repaired);
  await appendFile(repaired, Buffer.from([0]));
  const second = await buildMotionReviewPack(repaired, { out: path.join(dir, "review-02"), previous: first.file });
  assert.deepEqual(second.review.repair_log.map((repair) => [repair.issue, repair.status]), [["shot-1.gesture", "pending"], ["gap-1", "pending"]]);

  const next = fill(await read(second.file));
  await save(second.file, next);
  assert.match((await checkMotionReview(second.file)).errors.join("\n"), /repair shot-1\.gesture: pending/);

  next.repair_log = next.repair_log.map((repair) => ({ ...repair, status: "resolved", change: "added a wind-up pose before the swing", observation: "the arm now pulls back first", evidence: ["shot-01-m1.png"] }));
  await save(second.file, next);
  assert.deepEqual((await checkMotionReview(second.file)).errors, []);

  // Dropping a carried failure is caught against the previous review itself.
  await save(second.file, { ...next, repair_log: next.repair_log.slice(1) });
  assert.match((await checkMotionReview(second.file)).errors.join("\n"), /repair log dropped shot-1\.gesture/);

  // An "implementation change" on the same video is not a repair.
  const same = await buildMotionReviewPack(video, { out: path.join(dir, "review-03"), previous: first.file });
  const sameFilled = fill(await read(same.file));
  sameFilled.repair_log = sameFilled.repair_log.map((repair) => ({ ...repair, status: "resolved", change: "fixed", observation: "fine", evidence: ["0-1s"] }));
  await save(same.file, sameFilled);
  assert.match((await checkMotionReview(same.file)).errors.join("\n"), /same file as before/);
});

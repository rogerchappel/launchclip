import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/cli.js";
import { projectBriefs } from "../src/generate/brief.js";
import { ledgerCosts, readLedger } from "../src/generate/ledger.js";
import { recordShot } from "../src/generate/record.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "generate-brief");

async function withProject(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-record-"));
  try {
    const project = path.join(dir, "project");
    await cp(FIXTURE, project, { recursive: true });
    const png = path.join(dir, "made.png");
    const mp4 = path.join(dir, "made.mp4");
    await writeFile(png, "png bytes");
    await writeFile(mp4, "mp4 bytes");
    const briefs = Object.fromEntries((await projectBriefs(project)).map((entry) => [entry.request.scene_id, entry]));
    await fn({ project, png, mp4, briefs });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const story = async (project) => JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
const base = { madeWith: "image-tool/model-x", licence: "commercial use allowed by the tool's terms" };

test("an accepted still is copied, logged and placed in the storyboard; other requests stay", () => withProject(async ({ project, png, briefs }) => {
  const { request, brief } = briefs.s3;
  const result = await recordShot(project, { ...base, shot: "s3", step: "image", file: png, cost: "0.04usd", seed: "7", briefHash: brief.brief_hash });
  const [line] = await readLedger(project);
  assert.equal(line.shot, request.id);
  assert.equal(line.step, "image");
  assert.equal(line.tier, "final");
  assert.equal(line.attempt, 1);
  assert.equal(line.provider, "agent");
  assert.equal(line.model, base.madeWith);
  assert.equal(line.seed, 7);
  assert.equal(line.brief_hash, brief.brief_hash);
  assert.deepEqual(line.cost, { amount: 0.04, unit: "usd" });
  assert.equal(line.cost_unknown, undefined);
  assert.equal(line.licence, base.licence);
  assert.equal(line.verdict, "accepted");
  assert.ok(line.at);
  assert.equal(line.file, `assets/shots/generated/${request.id}/image-agent-1.png`);
  assert.equal(await readFile(path.join(project, line.file), "utf8"), "png bytes");

  assert.equal(result.placed, true);
  assert.equal(result.shot.source.generated, true);
  const after = await story(project);
  assert.deepEqual(after.scenes[2].params.media, { kind: "image", src: line.file });
  // Every other request is still a request.
  const before = await story(FIXTURE);
  for (const index of [0, 1, 3, 4]) assert.deepEqual(after.scenes[index], before.scenes[index]);
}));

test("a video brief: the keyframe waits, the clip is placed with the edge pad; no cost is cost_unknown", () => withProject(async ({ project, png, mp4, briefs }) => {
  const { brief } = briefs.s1;
  const key = await recordShot(project, { ...base, shot: brief.id, step: "image", file: png });
  assert.equal(key.placed, false);
  assert.deepEqual((await story(project)).scenes[0], (await story(FIXTURE)).scenes[0]);
  assert.equal(key.entry.cost_unknown, true);
  assert.deepEqual(key.entry.cost, { amount: 0, unit: "usd" });

  const clip = await recordShot(project, { ...base, madeWith: "video-tool/model-y", shot: "s1", step: "video", file: mp4, cost: "20credits" });
  assert.equal(clip.placed, true);
  assert.deepEqual((await story(project)).scenes[0].params.media, { kind: "video", src: clip.entry.file, sourceStart: brief.video.pad_seconds });
  assert.deepEqual(clip.entry.cost, { amount: 20, unit: "credits" });

  // Unknown spend is reported as unknown in the costs, not as free.
  const [unknown] = (await ledgerCosts(project)).line_items;
  assert.equal(unknown.estimated_usd, null);
  assert.match(unknown.warning, /no cost/);
}));

test("a card's still slot is filled and the scene's other request is kept", () => withProject(async ({ project, png }) => {
  const { entry } = await recordShot(project, { ...base, shot: "s2", step: "image", file: png });
  const after = await story(project);
  assert.equal(after.scenes[1].params.image, entry.file);
  assert.deepEqual(after.scenes[4].backdrop, (await story(FIXTURE)).scenes[4].backdrop);
}));

test("a rejected attempt is logged and placed nowhere", () => withProject(async ({ project, png }) => {
  const result = await recordShot(project, { ...base, shot: "s3", step: "image", file: png, verdict: "rejected", reason: "shows a logo" });
  assert.equal(result.placed, false);
  assert.equal(result.entry.reason, "shows a logo");
  assert.deepEqual(await story(project), await story(FIXTURE));
  const again = await recordShot(project, { ...base, shot: "s3", step: "image", file: png });
  assert.equal(again.entry.attempt, 2);
}));

test("a stale brief hash, a refused request, a wrong step or file is refused before anything is written", () => withProject(async ({ project, png, mp4 }) => {
  await assert.rejects(recordShot(project, { ...base, shot: "s3", step: "image", file: png, briefHash: "sha256:old" }), /not the current brief/);
  await assert.rejects(recordShot(project, { ...base, shot: "s4", step: "image", file: png }), /not generated.*names a real product/);
  await assert.rejects(recordShot(project, { ...base, shot: "s3", step: "video", file: mp4 }), /still; its brief has no video step/);
  await assert.rejects(recordShot(project, { ...base, shot: "s3", step: "image", file: mp4 }), /must be \.jpg, \.png or \.webp/);
  await assert.rejects(recordShot(project, { ...base, licence: undefined, shot: "s3", step: "image", file: png }), /--licence/);
  await assert.rejects(recordShot(project, { ...base, shot: "s3", step: "image", file: png, cost: "a lot" }), /--cost/);
  assert.deepEqual(await readLedger(project), []);
  assert.ok(!existsSync(path.join(project, "assets")));
  assert.deepEqual(await story(project), await story(FIXTURE));
}));

test("generate record on the CLI", () => withProject(async ({ project, png }) => {
  let out = "";
  await runCli(["generate", "record", project, "--shot", "s3", "--step", "image", "--file", png, "--made-with", base.madeWith, "--licence", base.licence, "--json"], { stdout: { write: (chunk) => { out += chunk; } }, stderr: { write() {} } });
  const result = JSON.parse(out);
  assert.equal(result.placed, true);
  assert.equal(result.entry.cost_unknown, true);
}));

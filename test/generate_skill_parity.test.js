// The skill path runs make --generate's gates as commands (docs/GENERATED_FOOTAGE_RFC.md
// §5 provider class 4): the same spend gate, the same keyframe check, reuse of
// accepted steps, and story shots and plates into HANDIN.json. Offline.
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { projectBriefs } from "../src/generate/brief.js";
import { spendGate } from "../src/generate/ledger.js";
import { acceptedSteps, allowCall, checkKeyframe, recordShot } from "../src/generate/record.js";
import { PNG, storyProject } from "./helpers/hand_in_project.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "generate-brief");
const base = { madeWith: "image-tool/model-x", licence: "the tool's output terms" };

async function withProject(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-skill-"));
  try {
    const project = path.join(dir, "project");
    await cp(FIXTURE, project, { recursive: true });
    const png = path.join(dir, "made.png");
    await writeFile(png, "png bytes");
    await writeFile(png.replace(/png$/, "mp4"), "mp4 bytes");
    await fn({ project, png });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("spendGate: the gate make --generate and generate allow share", async () => withProject(async ({ project }) => {
  assert.equal((await spendGate({ project, provider: "agent", quote: { amount: 1, unit: "usd" }, budget: { usd: 2 } })).ok, true);
  assert.match((await spendGate({ project, provider: "agent", quote: { amount: 3, unit: "usd" }, budget: { usd: 2 } })).reasons[0], /budget is reached/);
  assert.match((await spendGate({ project, provider: "agent", quote: { amount: null, unit: "credits" } })).reasons[0], /no call cap/);
  assert.equal((await spendGate({ project, provider: "agent", quote: { amount: null, unit: "seconds" } })).ok, true, "local time is not money");
}));

test("generate allow: priced calls need a budget and stop at it", async () => withProject(async ({ project, png }) => {
  assert.match((await allowCall(project, { shot: "s3", step: "image", quote: "0.5usd" })).reasons[0], /needs --budget/);
  const first = await allowCall(project, { shot: "s3", step: "image", quote: "0.5usd", budget: "1usd" });
  assert.equal(first.ok, true);
  assert.equal(first.attempt, 1);
  await recordShot(project, { ...base, shot: "s3", step: "image", file: png, cost: "0.8usd", verdict: "rejected", reason: "blurry" });
  // 0.8 spent + 0.5 quoted passes 1usd.
  const second = await allowCall(project, { shot: "s3", step: "image", quote: "0.5usd", budget: "1usd" });
  assert.equal(second.ok, false);
  assert.match(second.reasons[0], /budget is reached/);
}));

test("generate allow: an unpriced tool needs --max-generations, counted across runs", async () => withProject(async ({ project, png }) => {
  assert.match((await allowCall(project, { shot: "s3", step: "image", quote: "unknown" })).reasons[0], /no call cap/);
  assert.equal((await allowCall(project, { shot: "s3", step: "image", maxGenerations: "1" })).ok, true);
  await recordShot(project, { ...base, shot: "s3", step: "image", file: png, verdict: "rejected", reason: "off brief" });
  const capped = await allowCall(project, { shot: "s3", step: "image", maxGenerations: "1" });
  assert.equal(capped.ok, false);
  assert.match(capped.reasons[0], /cap of 1 unpriced call/);
}));

test("generate allow: an accepted step is reused, and three attempts is the cap", async () => withProject(async ({ project, png }) => {
  // A video brief's keyframe waits in the ledger (the storyboard waits for the clip), so a re-run must reuse it.
  const [{ request, brief }] = (await projectBriefs(project)).filter(({ brief: b }) => b?.steps.includes("video"));
  await recordShot(project, { ...base, shot: request.id, step: "image", file: png, cost: "0.1usd" });
  const reused = await allowCall(project, { shot: request.id, step: "image", quote: "0.1usd", budget: "5usd" });
  assert.equal(reused.ok, false);
  assert.match(reused.reasons[0], /already accepted/);
  assert.ok((await acceptedSteps(project, brief)).image);
  assert.equal((await allowCall(project, { shot: request.id, step: "video", quote: "0.4usd", budget: "5usd" })).ok, true);

  for (let i = 0; i < 3; i += 1) await recordShot(project, { ...base, shot: request.id, step: "video", file: png.replace(/png$/, "mp4"), cost: "0.1usd", verdict: "rejected", reason: "no" });
  assert.match((await allowCall(project, { shot: request.id, step: "video", quote: "0.1usd", budget: "5usd" })).reasons[0], /3 video attempts/);
}));

test("generate check: a footage keyframe goes through make's vision check", async () => withProject(async ({ project, png }) => {
  const seen = [];
  const client = { runStructured: async (call) => { seen.push(call.input); return { value: { shows_subject: true, has_text_or_logo: true, finding: "a logo on the cup", change: "Plain cup, no marks." } }; } };
  const verdict = await checkKeyframe(project, { shot: "s3", file: png }, { client });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.change, "Plain cup, no marks.");
  assert.match(seen[0], /Requested subject:/);
  await assert.rejects(checkKeyframe(project, { shot: "s3", file: png }), /needs --model/);
}));

test("story shots and plates: allow, check against the bible, record into HANDIN.json", async () => {
  const { dir } = await storyProject({ animatic: true });
  const hooks = { frame: async () => {} };
  try {
    const entries = await projectBriefs(dir, hooks);
    const plate = entries.find(({ request }) => request.role === "plate");
    const shot = entries.find(({ request, brief }) => request.role === "story" && brief);
    assert.equal((await allowCall(dir, { shot: plate.request.id, step: "image", quote: "0.1usd", budget: "1usd" }, hooks)).ok, true);

    // The plate's still is judged as a plate against the bible (the hand-in judge).
    const client = { runStructured: async () => ({ value: { ok: true, findings: [], checks: [] } }) };
    const judged = await checkKeyframe(dir, { shot: plate.request.id, file: PNG.pathname }, { ...hooks, client });
    assert.equal(typeof judged.ok, "boolean");

    const still = path.join(dir, "plate.png");
    await cp(PNG, still);
    const recorded = await recordShot(dir, { ...base, shot: plate.request.id, step: "image", file: still, cost: "0.1usd" }, hooks);
    assert.equal(recorded.placed, true);
    const clip = path.join(dir, "clip.mp4");
    await writeFile(clip, "mp4 bytes");
    await recordShot(dir, { ...base, shot: shot.request.id, step: "video", file: clip, cost: "0.4usd" }, hooks);
    const handIn = JSON.parse(await readFile(path.join(dir, "HANDIN.json"), "utf8"));
    assert.equal(handIn.places.length, 1);
    assert.equal(handIn.places[0].place, plate.place);
    assert.equal(handIn.places[0].source.generated, true);
    assert.equal(handIn.shots.length, 1);
    assert.equal(handIn.shots[0].shot, shot.shot.id);
    assert.equal(handIn.shots[0].source_start, shot.brief.video.pad_seconds);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

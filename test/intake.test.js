import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildIntake, inferSourceKind, resolveAspect, resolveReasoningEffort, writeIntake } from "../src/intake.js";
import { parseFlags } from "../src/cli.js";

test("collects repeated resource and reference flags", () => {
  assert.deepEqual(parseFlags(["--resource", "one.png", "--resource", "two.mp4", "--reference", "https://example.com"]), {
    resource: ["one.png", "two.mp4"],
    reference: "https://example.com"
  });
});

test("accepts authoritative transcripts and voiceover video sources", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-voice-video-"));
  const video = path.join(directory, "presenter.mp4");
  const transcript = path.join(directory, "transcript.txt");
  await writeFile(video, "video");
  await writeFile(transcript, "Exact supplied words.");
  assert.equal(inferSourceKind(video), "voiceover");
  const intake = await buildIntake("A topic", { voiceover: video, transcript, out: path.join(directory, "out") });
  assert.deepEqual(intake.resources.map((entry) => entry.role), ["voiceover", "voiceover-transcript"]);
  assert.equal(intake.policies.supplied_voiceover_is_authoritative, true);
});

test("infers supported source kinds", () => {
  assert.equal(inferSourceKind("https://github.com/openai/openai-node"), "repository");
  assert.equal(inferSourceKind("openai/openai-node"), "repository");
  assert.equal(inferSourceKind("https://example.com"), "product");
  assert.equal(inferSourceKind("Compare local coding models"), "topic");
  assert.equal(inferSourceKind("anything", "saas"), "product");
  assert.throws(() => inferSourceKind("anything", "unknown"), /Unsupported --kind/);
});

test("resolves aspect ratios and GPT-5.6 reasoning controls", () => {
  assert.deepEqual(resolveAspect("portrait"), { id: "9:16", width: 1080, height: 1920, orientation: "portrait" });
  assert.deepEqual(resolveAspect("16:9"), { id: "16:9", width: 1920, height: 1080, orientation: "landscape" });
  assert.equal(resolveReasoningEffort("MAX"), "max");
  assert.throws(() => resolveAspect("4:3"), /Unsupported --aspect/);
  assert.throws(() => resolveReasoningEffort("ultra"), /Unsupported --reasoning/);
});

test("builds a normalized multi-resource intake", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-intake-"));
  const notes = path.join(temp, "notes.md");
  const voiceover = path.join(temp, "voice.wav");
  const presenter = path.join(temp, "presenter.mp4");
  await writeFile(notes, "Evidence-backed notes\n");
  await writeFile(voiceover, "voice fixture");
  await writeFile(presenter, "video fixture");

  const intake = await buildIntake("Compare the models", {
    kind: "topic",
    resource: [notes, "https://example.com/paper"],
    voiceover,
    presenter,
    prompt: "Focus on practical tradeoffs",
    cta: "Read the comparison",
    aspect: "9:16",
    duration: "75",
    reasoning: "max",
    pro: true,
    out: path.join(temp, "workspace")
  }, {});

  assert.equal(intake.schema_version, "launchclip.intake.v1");
  assert.equal(intake.source.kind, "topic");
  assert.equal(intake.brief.duration_seconds, 75);
  assert.equal(intake.model.id, "gpt-5.6");
  assert.equal(intake.model.reasoning_effort, "max");
  assert.equal(intake.model.reasoning_mode, "pro");
  assert.deepEqual(intake.resources.map((entry) => entry.role), ["supporting", "supporting", "voiceover", "presenter"]);
  assert.equal(intake.resources[0].type, "text");
  assert.match(intake.resources[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(intake.resources[1].type, "url");
  assert.equal(intake.policies.supplied_voiceover_is_authoritative, true);
  assert.equal(intake.policies.presenter_requires_authorized_likeness, true);
});

test("writes production/intake.json", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-intake-write-"));
  const out = path.join(temp, "workspace");
  const result = await writeIntake("owner/repo", { out, aspect: "16:9" }, {});
  const written = JSON.parse(await readFile(result.intake, "utf8"));

  assert.equal(result.status, "ready");
  assert.equal(written.source.kind, "repository");
  assert.equal(written.workspace, out);
  assert.equal(written.brief.aspect.width, 1920);
});

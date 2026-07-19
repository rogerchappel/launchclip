import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildIntake, inferSourceKind, resolveAspect, resolveModelPolicy, resolveReasoningEffort, writeIntake } from "../src/intake.js";
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
  const direct = await buildIntake(video, { transcript, out: path.join(directory, "direct") });
  assert.deepEqual(direct.resources.map((entry) => entry.role), ["voiceover", "voiceover-transcript", "presenter"]);
  assert.equal(direct.policies.supplied_voiceover_is_authoritative, true);
  const intake = await buildIntake("A topic", { voiceover: video, transcript, out: path.join(directory, "out") });
  assert.deepEqual(intake.resources.map((entry) => entry.role), ["voiceover", "voiceover-transcript", "presenter"]);
  assert.equal(intake.policies.supplied_voiceover_is_authoritative, true);
  assert.equal(intake.policies.presenter_requires_authorized_likeness, true);
});

test("promotes a supplied HeyGen avatar video to authoritative voiceover and presenter media", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-heygen-avatar-"));
  const avatar = path.join(directory, "heygen-avatar.mp4");
  const transcript = path.join(directory, "heygen-avatar.txt");
  const audioOnly = path.join(directory, "heygen-avatar.wav");
  await writeFile(avatar, "avatar video fixture");
  await writeFile(transcript, "The generated presenter narration.");
  await writeFile(audioOnly, "audio fixture");

  const intake = await buildIntake("Product workflow", {
    "heygen-avatar": avatar,
    transcript,
    out: path.join(directory, "out")
  }, {});

  assert.equal(intake.source.kind, "topic");
  assert.deepEqual(intake.resources.map((entry) => entry.role), ["voiceover", "voiceover-transcript", "presenter"]);
  assert.deepEqual(intake.resources.filter((entry) => entry.type === "video").map((entry) => entry.location), [avatar, avatar]);
  assert.equal(intake.policies.supplied_voiceover_is_authoritative, true);
  assert.equal(intake.policies.presenter_requires_authorized_likeness, true);
  await assert.rejects(
    buildIntake("Product workflow", { "heygen-avatar": avatar, presenter: avatar }, {}),
    /replaces --voiceover and --presenter/
  );
  await assert.rejects(
    buildIntake("Product workflow", { "heygen-avatar": audioOnly }, {}),
    /must be one local video file/
  );
});

test("infers supported source kinds", () => {
  assert.equal(inferSourceKind("https://github.com/openai/openai-node"), "repository");
  assert.equal(inferSourceKind("openai/openai-node"), "repository");
  assert.equal(inferSourceKind("https://example.com"), "product");
  assert.equal(inferSourceKind("Compare local coding models"), "topic");
  assert.equal(inferSourceKind("anything", "saas"), "product");
  assert.throws(() => inferSourceKind("anything", "unknown"), /Unsupported --kind/);
});

test("automatically treats a local paper or text source as topic evidence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-paper-source-"));
  const paper = path.join(directory, "research.pdf");
  await writeFile(paper, "pdf fixture");
  assert.equal(inferSourceKind(paper), "topic");
  const intake = await buildIntake(paper, { out: path.join(directory, "out") }, {});
  assert.equal(intake.source.kind, "topic");
  assert.equal(intake.resources.length, 1);
  assert.equal(intake.resources[0].role, "supporting");
  assert.equal(intake.resources[0].type, "document");
  assert.equal(intake.resources[0].location, paper);
});

test("resolves aspect ratios and GPT-5.6 reasoning controls", () => {
  assert.deepEqual(resolveAspect("portrait"), { id: "9:16", width: 1080, height: 1920, orientation: "portrait" });
  assert.deepEqual(resolveAspect("16:9"), { id: "16:9", width: 1920, height: 1080, orientation: "landscape" });
  assert.equal(resolveReasoningEffort("MAX"), "max");
  assert.throws(() => resolveAspect("4:3"), /Unsupported --aspect/);
  assert.throws(() => resolveReasoningEffort("ultra"), /Unsupported --reasoning/);
  assert.equal(resolveModelPolicy("LOCAL-FIRST"), "local-first");
  assert.equal(resolveModelPolicy("FREE"), "free");
  assert.throws(() => resolveModelPolicy("mystery"), /Unsupported --model-policy/);
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
  assert.equal(intake.model.id, "gpt-5.6-terra");
  assert.equal(intake.model.reasoning_effort, "max");
  assert.equal(intake.model.reasoning_mode, "pro");
  assert.deepEqual(intake.resources.map((entry) => entry.role), ["supporting", "supporting", "voiceover", "presenter"]);
  assert.equal(intake.resources[0].type, "text");
  assert.match(intake.resources[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(intake.resources[1].type, "url");
  assert.equal(intake.policies.supplied_voiceover_is_authoritative, true);
  assert.equal(intake.policies.presenter_requires_authorized_likeness, true);
});

test("uses Terra for planning unless quality or an explicit model is requested", async () => {
  const costAware = await buildIntake("A product", { kind: "product" }, {});
  const quality = await buildIntake("A product", { kind: "product", "model-policy": "quality" }, {});
  const explicit = await buildIntake("A product", { kind: "product", model: "custom-model", reasoning: "low" }, {});
  assert.deepEqual(costAware.model, { provider: "openai", id: "gpt-5.6-terra", reasoning_effort: "high", reasoning_mode: "standard" });
  assert.deepEqual(quality.model, { provider: "openai", id: "gpt-5.6", reasoning_effort: "xhigh", reasoning_mode: "standard" });
  assert.equal(explicit.model.id, "custom-model");
  assert.equal(explicit.model.reasoning_effort, "low");
});

test("enables an opt-in cinematic portrait profile with quality planning defaults", async () => {
  const intake = await buildIntake("A product", {
    kind: "product",
    profile: "cinematic",
    aspect: "9:16",
    duration: 45
  }, {});

  assert.equal(intake.profile.id, "cinematic");
  assert.equal(intake.profile.lane, "portrait-short");
  assert.equal(intake.profile.planning.concept_candidates, 5);
  assert.equal(intake.profile.planning.narration_timing_before_edit, true);
  assert.equal(intake.profile.planning.require_frame_blueprints, true);
  assert.equal(intake.profile.craft.minimum_hook_material_changes, 3);
  assert.equal(intake.profile.craft.maximum_material_change_gap_seconds, 2);
  assert.deepEqual(intake.profile.readiness.required_receipts, ["concepts", "story", "narration", "plan", "frames", "motion", "audio", "verification", "critic"]);
  assert.deepEqual(intake.model, { provider: "openai", id: "gpt-5.6", reasoning_effort: "xhigh", reasoning_mode: "standard" });
});

test("keeps the standard profile behavior unchanged and rejects unknown profiles", async () => {
  const intake = await buildIntake("A product", { kind: "product" }, {});
  assert.equal(intake.profile.id, "standard");
  assert.equal(intake.profile.one_shot, false);
  assert.equal(intake.model.id, "gpt-5.6-terra");
  await assert.rejects(buildIntake("A product", { kind: "product", profile: "viral" }, {}), /Unsupported --profile/);
});

test("keeps free-policy planning on OpenRouter's free router", async () => {
  const intake = await buildIntake("A product", { kind: "product", "model-policy": "free" }, {});
  assert.deepEqual(intake.model, { provider: "openrouter", id: "openrouter/free", reasoning_effort: "none", reasoning_mode: "standard" });
});

test("expands a resource directory into stable file-level resources", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-directory-intake-"));
  const recordings = path.join(temp, "screen-recordings");
  await mkdir(path.join(recordings, "flow"), { recursive: true });
  await writeFile(path.join(recordings, "cover.png"), "image");
  await writeFile(path.join(recordings, "flow", "demo.mp4"), "video");
  await writeFile(path.join(recordings, "assets.json"), JSON.stringify({ assets: { "cover.png": { usage: "logo", entities: ["Launchclip"], tags: ["identity"], priority: 90, license: "project-owned" } } }));
  await writeFile(path.join(recordings, ".DS_Store"), "ignored");

  const intake = await buildIntake("A SaaS launch", { kind: "product", resource: recordings, out: path.join(temp, "out") }, {});
  assert.deepEqual(intake.resources.map((entry) => entry.type), ["image", "video"]);
  assert.deepEqual(intake.resources.map((entry) => path.basename(entry.location)), ["cover.png", "demo.mp4"]);
  assert.equal(new Set(intake.resources.map((entry) => entry.id)).size, 2);
  assert.deepEqual(intake.resources[0].catalog, { collection: "screen-recordings", relative_path: "cover.png", usage: "logo", entity_hints: ["launchclip"], tags: ["identity"], priority: 90, license: "project-owned", source: "manifest" });
  assert.equal(intake.resources[1].catalog.usage, "product-demo");
  assert.equal(intake.resources[1].catalog.source, "auto");
});

test("accepts an assets alias and a reusable style specification", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-style-intake-"));
  const assets = path.join(temp, "assets");
  const style = path.join(temp, "frame.md");
  await mkdir(path.join(assets, "logos"), { recursive: true });
  await writeFile(path.join(assets, "logos", "anthropic.svg"), "<svg></svg>");
  await writeFile(style, "---\ncolors:\n  background: '#f4f0e8'\n---\nSoft grid editorial.\n");
  const intake = await buildIntake("AI update", { kind: "topic", assets, style: "soft-grid-editorial", "style-file": style, out: path.join(temp, "out") }, {});
  assert.equal(intake.resources.length, 1);
  assert.equal(intake.resources[0].catalog.usage, "logo");
  assert.deepEqual(intake.resources[0].catalog.entity_hints, ["anthropic"]);
  assert.equal(intake.brief.style.family, "soft-grid-editorial");
  assert.equal(intake.brief.style.source, "file");
  assert.match(intake.brief.style.specification, /Soft grid editorial/);
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

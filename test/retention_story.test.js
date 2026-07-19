import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CINEMATIC_STORY_EDIT_VERSION, CINEMATIC_STORY_VERSION } from "../src/cinematic_contracts.js";
import { writeRetentionStory } from "../src/retention_story.js";

test("writes and independently edits a retention story before production planning", async () => {
  const workspace = await tempWorkspace();
  const calls = [];
  const client = { runStructured: async (request) => {
    const input = JSON.parse(request.input);
    calls.push({ job: request.metadata.job_id, input });
    const value = request.metadata.job_id === "retention-story-draft" ? sampleStory() : sampleEdit(input.draft_story);
    return { response_id: `story-${calls.length}`, model: "gpt-5.6", status: "completed", value, usage: { total_tokens: 100 } };
  } };

  const result = await writeRetentionStory(workspace, { background: false }, { writerClient: client, editorClient: client });
  assert.deepEqual(calls.map((entry) => entry.job), ["retention-story-draft", "retention-story"]);
  assert.equal(calls[0].input.selected_concept.id, "concept-1");
  assert.deepEqual(calls[1].input.required_improvements, ["Sharpen proof."]);
  assert.equal(result.concept_id, "concept-1");
  const story = JSON.parse(await readFile(result.story, "utf8"));
  assert.equal(story.narration.beats[4].role, "rehook");
  assert.match(story.narration.full_text, /Try cinematic/);
});

test("repairs an editor result that misses the fixed cinematic quality floor", async () => {
  const workspace = await tempWorkspace();
  const editorInputs = [];
  const writerClient = { runStructured: async () => ({ response_id: "writer", model: "gpt-5.6", status: "completed", value: sampleStory(), usage: {} }) };
  const editorClient = { runStructured: async (request) => {
    const input = JSON.parse(request.input);
    editorInputs.push(input);
    const value = sampleEdit(input.draft_story);
    if (editorInputs.length === 1) value.scores.hook = 6;
    return { response_id: `editor-${editorInputs.length}`, model: "gpt-5.6", status: "completed", value, usage: {} };
  } };
  await writeRetentionStory(workspace, { semanticAttempts: 2 }, { writerClient, editorClient });
  assert.equal(editorInputs.length, 2);
  assert.equal(editorInputs[1].prior_attempt.scores.hook, 6);
  assert.match(editorInputs[1].validation_errors_to_repair.join(" "), /hook must be at least 8/);
});

test("reuses verified story artifacts without additional writer or editor calls", async () => {
  const workspace = await tempWorkspace();
  let calls = 0;
  const client = { runStructured: async (request) => {
    calls += 1;
    const input = JSON.parse(request.input);
    return { response_id: `cached-${calls}`, model: "gpt-5.6", status: "completed", value: request.metadata.job_id === "retention-story-draft" ? sampleStory() : sampleEdit(input.draft_story), usage: {} };
  } };
  await writeRetentionStory(workspace, {}, { client });
  const second = await writeRetentionStory(workspace, {}, { client: { runStructured: async () => { throw new Error("cache miss"); } } });
  assert.equal(calls, 2);
  assert.equal(second.cached, true);
});

test("passes authoritative supplied narration through unchanged", async () => {
  const transcript = "Exact supplied words demonstrate grounded proof and finish with a useful payoff.";
  const workspace = await tempWorkspace({ transcript, duration: 10 });
  const client = { runStructured: async (request) => {
    const input = JSON.parse(request.input);
    if (request.metadata.job_id === "retention-story-draft") {
      assert.deepEqual(input.narration_authority, { source: "supplied", transcript, duration_seconds: 10 });
      return { response_id: "supplied-writer", model: "gpt-5.6", status: "completed", value: suppliedStory(transcript), usage: {} };
    }
    return { response_id: "supplied-editor", model: "gpt-5.6", status: "completed", value: sampleEdit(input.draft_story), usage: {} };
  } };
  const result = await writeRetentionStory(workspace, {}, { client });
  const story = JSON.parse(await readFile(result.story, "utf8"));
  assert.equal(story.narration.source, "supplied");
  assert.equal(story.narration.full_text, transcript);
});

async function tempWorkspace(options = {}) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-story-"));
  await mkdir(path.join(workspace, "production"), { recursive: true });
  const supplied = options.transcript != null;
  const resources = supplied ? [{ id: "voice-1", role: "voiceover", type: "audio", location: "/tmp/voice.wav" }] : [{ id: "resource-1", role: "supporting", type: "image", location: "/tmp/proof.png" }];
  await writeFile(path.join(workspace, "production", "intake.json"), `${JSON.stringify({
    workspace,
    source: { kind: "topic", value: "Cinematic orchestration" },
    brief: { prompt: "Show why causal motion beats slides", audience: "video creators", cta: "Try cinematic", language: "en", duration_seconds: options.duration ?? 45, aspect: { id: "9:16", width: 1080, height: 1920, orientation: "portrait" } },
    model: { provider: "openai", id: "gpt-5.6", reasoning_effort: "xhigh", reasoning_mode: "standard" },
    profile: { id: "cinematic", craft: { target_wpm_minimum: 165, target_wpm_maximum: 180 } },
    policies: { supplied_voiceover_is_authoritative: supplied },
    resources
  }, null, 2)}\n`);
  const evidence = [{ id: "evidence-1", kind: "brief", role: "primary", title: "Evidence", content: "Causal motion helps the explanation.", provenance: "user", claims_allowed: true }];
  if (supplied) {
    evidence.push({ id: "voice-transcript", kind: "voiceover-transcript", role: "voiceover", title: "Transcript", content: options.transcript, provenance: "user", claims_allowed: false, metadata: [] });
    evidence.push({ id: "resource:voice-1", kind: "audio", role: "voiceover", title: "Voice", content: JSON.stringify({ duration_seconds: options.duration }), provenance: "user", claims_allowed: false, metadata: [] });
  }
  await writeFile(path.join(workspace, "production", "evidence.json"), `${JSON.stringify({ items: evidence }, null, 2)}\n`);
  await writeFile(path.join(workspace, "production", "concepts.json"), `${JSON.stringify({
    selected_id: "concept-1",
    selection: { required_improvements: ["Sharpen proof."] },
    candidates: [{ id: "concept-1", title: "One causal world", hook: { spoken_line: "Slides are losing your audience." }, narrative_engine: "transformation", causal_beats: [], art_direction_seed: { visual_metaphor: "A machine that compounds", spatial_world: "One continuous table", motion_language: "Weighted", transition_logic: "Shared objects", sound_world: "Tactile" } }]
  }, null, 2)}\n`);
  return workspace;
}

function sampleStory() {
  const roles = ["hook", "promise", "mechanism", "proof", "rehook", "escalation", "payoff", "cta_or_loop"];
  const text = [
    "Most launch videos lose instantly before the idea arrives because every beat looks exactly like the last one.",
    "Here is a cinematic path that earns attention with one clear promise and immediate visual proof.",
    "It turns the source into a causal world where objects accumulate instead of resetting between slides.",
    "Evidence appears visually inside that world so each claim has a visible source and transformation.",
    "Halfway through the same object changes scale and opens a second more valuable question.",
    "Music lifts camera velocity increases and each reveal lands against measured speech with tactile sound.",
    "The result is a strong hook coherent motion grounded proof and a payoff viewers remember.",
    "Try cinematic and make the final frame resolve the opening while inviting the next view."
  ];
  const ends = [5, 10, 16, 22, 27, 33, 39, 45];
  const beats = roles.map((role, index) => ({ id: `story-${index + 1}`, role, target_start_seconds: index ? ends[index - 1] : 0, target_end_seconds: ends[index], spoken_text: text[index], narrative_turn: `${role} turn`, viewer_question: `Question after ${role}?`, visual_noun: `object-${index + 1}`, desired_emotion: index < 2 ? "curiosity" : "momentum", evidence_ids: role === "proof" ? ["evidence-1"] : [], resource_ids: [] }));
  const fullText = text.join(" ");
  return {
    schema_version: CINEMATIC_STORY_VERSION,
    concept_id: "concept-1",
    project: { title: "One causal world", thesis: "Continuity creates retention.", audience_promise: "See an idea become a film." },
    format: { aspect: "9:16", width: 1080, height: 1920, duration_seconds: 45, language: "en" },
    narration: { source: "generated", full_text: fullText, target_wpm: Math.round(fullText.split(/\s+/).length * 60 / 45), delivery: "Fast, precise, controlled.", beats },
    open_loop: { question: "How does an idea become a film?", resolved_by_beat_id: "story-7", midpoint_rehook_beat_id: "story-5" },
    claims: [{ text: "Evidence appears in the visual world.", evidence_ids: ["evidence-1"], confidence: "verified", qualifier: null }]
  };
}

function sampleEdit(story) {
  return {
    schema_version: CINEMATIC_STORY_EDIT_VERSION,
    verdict: "ready",
    scores: { hook: 9, compression: 8, curiosity: 9, clarity: 9, proof: 8, payoff: 9, speakability: 8, visuality: 9 },
    findings: [{ category: "compression", severity: "minor", instruction: "Keep the final cadence clipped." }],
    story
  };
}

function suppliedStory(transcript) {
  const text = ["Exact supplied words", "demonstrate grounded proof", "and finish with", "a useful payoff."];
  const roles = ["hook", "mechanism", "proof", "payoff"];
  const beats = roles.map((role, index) => ({ id: `supplied-${index + 1}`, role, target_start_seconds: index * 2.5, target_end_seconds: (index + 1) * 2.5, spoken_text: text[index], narrative_turn: `${role} turn`, viewer_question: `${role} question`, visual_noun: `${role}-object`, desired_emotion: "clarity", evidence_ids: role === "proof" ? ["evidence-1"] : [], resource_ids: [] }));
  return {
    schema_version: CINEMATIC_STORY_VERSION,
    concept_id: "concept-1",
    project: { title: "Supplied story", thesis: "Preserve authority.", audience_promise: "See the supplied story." },
    format: { aspect: "9:16", width: 1080, height: 1920, duration_seconds: 10, language: "en" },
    narration: { source: "supplied", full_text: transcript, target_wpm: 72, delivery: "Use the supplied performance.", beats },
    open_loop: { question: "What is the proof?", resolved_by_beat_id: "supplied-4", midpoint_rehook_beat_id: null },
    claims: [{ text: "Grounded proof", evidence_ids: ["evidence-1"], confidence: "verified", qualifier: null }]
  };
}

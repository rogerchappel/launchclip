import test from "node:test";
import assert from "node:assert/strict";
import { edgeScore, measureFrameLevels, mergeConsensusTranscripts, pcmFrameLevels } from "../src/recording_consensus.js";
import { normalizeRecordingTranscript } from "../src/recording_edit.js";
import { assessRecordingQa, recordingQaEvidenceHash } from "../src/recording_qa.js";

const RATE = 16000;
/** Synthetic mono float PCM: quiet room tone with voiced (sine) spans. */
function pcm(seconds, voiced) {
  const buffer = Buffer.alloc(Math.round(seconds * RATE) * 4);
  for (let index = 0; index < buffer.length / 4; index++) {
    const time = index / RATE;
    let value = 0.0005 * Math.sin(index * 1.7);
    for (const span of voiced) {
      if (time < span.start || time >= span.end) continue;
      const decay = span.decay ? Math.exp(-(time - span.start) / span.decay) : 1;
      value += (span.amplitude ?? 0.2) * decay * Math.sin(2 * Math.PI * 180 * time);
    }
    buffer.writeFloatLE(value, index * 4);
  }
  return buffer;
}
function edges(transcript) { return new Set(normalizeRecordingTranscript(transcript).flatMap((word) => [word.start, word.end])); }

test("10ms frame levels follow synthetic PCM, and the streaming reader uses the same frames", async () => {
  const audio = pcm(1, [{ start: 0.3, end: 0.6 }]);
  const levels = pcmFrameLevels(audio);
  assert.equal(levels.step_seconds, 0.01);
  assert.equal(levels.levels_db.length, 100);
  assert.ok(levels.levels_db[10] < -60 && levels.levels_db[45] > -20);
  assert.ok(edgeScore(levels, 0.3, "start") > 30 && edgeScore(levels, 0.6, "end") > 30);
  assert.ok(Math.abs(edgeScore(levels, 0.45, "start")) < 3);
  assert.deepEqual(await measureFrameLevels("take.mov", { durationSeconds: 1 }, { pcm: async () => audio }), levels);
  assert.throws(() => pcmFrameLevels(Buffer.alloc(3)), /float PCM/);
});

test("the envelope breaks a first-word timing disagreement towards the real onset", () => {
  // A rejected "stuck" decays into quiet; the chosen "And" starts at 2.0s.
  const levels = pcmFrameLevels(pcm(3, [{ start: 0.5, end: 1.0 }, { start: 1.0, end: 1.15, decay: 0.03 }, { start: 2.0, end: 2.4 }]));
  const base = { words: [{ word: "stuck.", start: 0.5, end: 1.0 }, { word: "And", start: 1.0, end: 2.4 }] };
  const small = { words: [{ word: "stuck.", start: 0.5, end: 1.04 }, { word: "And", start: 2.0, end: 2.38 }] };
  const merged = mergeConsensusTranscripts(base, small, { models: ["base.en", "small.en"], levels });
  assert.deepEqual(normalizeRecordingTranscript(merged).map(({ word, start, end }) => [word, start, end]), [["stuck.", 0.5, 1.0], ["And", 2.0, 2.4]]);
  assert.deepEqual(merged.words[1].timing, { start: "small.en", end: "agree" });
  const timing = merged.consensus.disagreements.find((entry) => entry.kind === "timing");
  assert.equal(timing.word, "And");
  assert.equal(timing.resolution.start.by, "envelope");
  assert.equal(timing.resolution.start.chosen, "small.en");
  assert.ok(timing.resolution.start.envelope_scores_db["small.en"] > timing.resolution.start.envelope_scores_db["base.en"]);
});

test("words either recogniser heard are kept with that recogniser's own timing", () => {
  const base = { segments: [{ words: [
    { word: " I", start: 0.2, end: 0.35 }, { word: " need", start: 0.4, end: 0.7 },
    { word: " Founding", start: 1.0, end: 1.6 }, { word: " access", start: 1.6, end: 2.0 },
  ] }] };
  const small = { segments: [{ words: [
    { word: " need", start: 0.42, end: 0.71 },
    { word: " Founding", start: 1.66, end: 1.66 }, { word: " access", start: 1.66, end: 2.02 }, { word: " now.", start: 2.1, end: 2.4 },
  ] }] };
  const merged = mergeConsensusTranscripts(base, small, { models: ["base.en", "small.en"] });
  assert.equal(merged.text, "I need Founding access now.");
  assert.deepEqual(merged.words.map((word) => [word.start, word.end]), [[0.2, 0.35], [0.4, 0.7], [1.0, 1.6], [1.6, 2.0], [2.1, 2.4]]);
  const kinds = merged.consensus.disagreements.map((entry) => `${entry.kind}:${entry.word.trim()}`);
  assert.deepEqual(kinds, ["presence:I", "untimed:Founding", "presence:now."]);
  const allowed = new Set([...edges(base), ...edges({ words: small.segments[0].words.filter((word) => word.end > word.start) })]);
  for (const word of merged.words) assert.ok(allowed.has(word.start) && allowed.has(word.end), `${word.word} uses a recogniser edge`);
});

test("without decisive envelope evidence the primary timing stays and the disagreement is recorded", () => {
  const flat = pcmFrameLevels(pcm(3, [{ start: 0.2, end: 2.8 }]));
  const base = { words: [{ word: "Shipping", start: 1.0, end: 1.5 }, { word: "matters.", start: 1.5, end: 2.0 }] };
  const small = { words: [{ word: "Shipping", start: 1.2, end: 1.5 }, { word: "matters", start: 1.52, end: 2.0 }] };
  for (const levels of [flat, undefined]) {
    const merged = mergeConsensusTranscripts(base, small, { models: ["base.en", "small.en"], levels });
    assert.equal(merged.words[0].start, 1.0);
    const timing = merged.consensus.disagreements.find((entry) => entry.kind === "timing");
    assert.equal(timing.resolution.start.by, "primary-fallback");
  }
  // Within the tolerance both recognisers agree; the primary edge is used.
  assert.equal(mergeConsensusTranscripts(base, small, { toleranceSeconds: 0.25 }).consensus.disagreements.length, 0);
});

test("wording disagreements keep the primary word and every timing remains a recogniser edge", () => {
  const base = { words: [{ word: "so", start: 0.1, end: 0.3 }, { word: "AI", start: 0.35, end: 0.6 }, { word: "does", start: 0.6, end: 0.9 }] };
  const small = { words: [{ word: "so", start: 0.1, end: 0.3 }, { word: "I", start: 0.4, end: 0.6 }, { word: "does", start: 0.62, end: 0.9 }] };
  const merged = mergeConsensusTranscripts(base, small, { models: ["base.en", "small.en"] });
  assert.equal(merged.text, "so AI does");
  assert.equal(merged.consensus.disagreements[0].kind, "wording");
  assert.deepEqual(merged.consensus.disagreements[0].heard["small.en"], { word: "I", start: 0.4, end: 0.6 });
});

test("overlapping single-recogniser words are not kept rather than retimed", () => {
  const base = { words: [{ word: "we", start: 0.1, end: 0.5 }, { word: "ship", start: 0.5, end: 0.9 }] };
  const small = { words: [{ word: "we", start: 0.1, end: 0.3 }, { word: "really", start: 0.3, end: 0.6 }, { word: "ship", start: 0.6, end: 0.9 }] };
  const merged = mergeConsensusTranscripts(base, small);
  assert.equal(merged.text, "we ship");
  assert.ok(merged.consensus.disagreements.some((entry) => entry.kind === "overlap" && entry.word === "really"));
  assert.throws(() => mergeConsensusTranscripts(base, { words: [{ word: "x", start: 1, end: 1 }] }), /no timed words/);
  assert.throws(() => mergeConsensusTranscripts(base, small, { levels: { step_seconds: 0.1, levels_db: [] } }), /10ms/);
});

test("QA lists recogniser disagreements on retained speech as nonblocking observations", () => {
  const plan = { schema_version: "launchclip.recording-edit.v1", source_duration_seconds: 4, duration_seconds: 2, kept_segments: [{ source_start_seconds: 2, source_end_seconds: 4, start_seconds: 0, end_seconds: 2 }], removed_segments: [{ source_start_seconds: 0, source_end_seconds: 2, reason: "semantic-retake" }], words: [{ word: "And", start: 0, end: 0.4 }],
    transcript_consensus: { models: ["base.en", "small.en"], disagreements: [
      { kind: "timing", word: "And", start_seconds: 1, end_seconds: 2.4, explanation: "Timings differ." },
      { kind: "presence", word: "stuck", start_seconds: 0.5, end_seconds: 1, explanation: "Only base.en heard it." },
    ] } };
  const sha = "a".repeat(64);
  const acoustic = { checked: true, issues: [] };
  const semantic = { evidence_hash: recordingQaEvidenceHash(plan, plan.words, sha, undefined, acoustic), coverage_complete: true, findings: [], transcript_resolutions: [], acoustic_resolutions: [] };
  const qa = assessRecordingQa(plan, plan.words, { acoustic, semantic, mediaSha256: sha });
  assert.equal(qa.status, "passed");
  const observed = qa.issues.filter((issue) => issue.kind === "recogniser-disagreement");
  assert.equal(observed.length, 1);
  assert.equal(observed[0].blocking, false);
  assert.equal(observed[0].start_seconds, 0);
  assert.match(observed[0].explanation, /base\.en and small\.en/);
});

test("edit-recording transcribes with both local models by default and keeps the consensus receipts", async () => {
  const { mkdtemp, readFile, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { prepareRecording, recordingOptions } = await import("../src/recording_workflow.js");
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-consensus-"));
  const input = path.join(directory, "take.mov");
  await writeFile(input, "original recording");
  const said = (shift) => "We build reliable products for people.".split(" ").map((word, index) => ({ word, start: 1 + index * 0.3 + (index === 0 ? shift : 0), end: 1 + index * 0.3 + 0.2 }));
  const models = [];
  let renderedPlan;
  const adapters = {
    probe: async () => ({ format: { duration: 4 }, streams: [{ codec_type: "video" }, { codec_type: "audio" }] }),
    transcribe: async (_input, options) => { models.push(options.model); return { words: options.model === "small.en" ? said(0.1) : said(0) }; },
    measureFrameLevels: async () => ({ step_seconds: 0.01, levels_db: Array(400).fill(-30) }),
    analyzeRecordingAudio: async () => ({ schema_version: "launchclip.recording-audio.v1", source_duration_seconds: 4, threshold_db: -40, silence_intervals: [{ start_seconds: 0, end_seconds: 0.9 }, { start_seconds: 3.1, end_seconds: 4 }], waveform: [] }),
    transcribeRendered: async () => ({ words: renderedPlan.words }),
    analyzeRecordingJoins: async () => ({ checked: true, issues: [] }),
    identifyRecordingCoherence: async (plan, actual, options) => ({ evidence_hash: recordingQaEvidenceHash(plan, actual, options.mediaSha256, options.sourceTranscript, options.acoustic), coverage_complete: true, findings: [], transcript_resolutions: [], acoustic_resolutions: [] }),
    editRecording: async (_input, output, plan) => { renderedPlan = plan; await writeFile(output, "edited recording"); return { rendered_duration_seconds: plan.duration_seconds }; },
  };
  const result = await prepareRecording(input, { ...recordingOptions({ out: path.join(directory, "edit"), enhance: "off" }) }, adapters);
  assert.deepEqual(models, ["base.en", "small.en"]);
  assert.deepEqual(result.transcript_consensus, { models: ["base.en", "small.en"], agreed_words: 5, disagreements: 1 });
  const inputs = JSON.parse(await readFile(result.files.consensus_inputs, "utf8"));
  assert.equal(inputs.transcripts.length, 2);
  const plan = JSON.parse(await readFile(result.files.edit_plan, "utf8"));
  assert.equal(plan.transcript_consensus.disagreements[0].resolution.start.by, "primary-fallback");
  assert.ok(JSON.parse(await readFile(result.files.qa_report, "utf8")).issues.some((issue) => issue.kind === "recogniser-disagreement"));
  const cached = await prepareRecording(input, { ...recordingOptions({ out: path.join(directory, "edit"), enhance: "off" }) }, adapters);
  assert.equal(cached.cached, true);
  assert.equal(models.length, 2);
  await assert.rejects(prepareRecording(input, { ...recordingOptions({ out: path.join(directory, "same"), "consensus-model": "base.en" }) }, adapters), /different model/);
  const single = await prepareRecording(input, { ...recordingOptions({ out: path.join(directory, "single"), "consensus-model": "none", enhance: "off" }) }, adapters);
  assert.equal(single.transcript_consensus, undefined);
  assert.equal(models.length, 3);
});

test("QA leaves envelope-settled timing disagreements in the consensus receipt", () => {
  const plan = { source_duration_seconds: 2, duration_seconds: 2, kept_segments: [{ source_start_seconds: 0, source_end_seconds: 2, start_seconds: 0, end_seconds: 2 }], removed_segments: [], words: [{ word: "And", start: 1, end: 1.4 }],
    transcript_consensus: { models: ["base.en", "small.en"], disagreements: [{ kind: "timing", word: "And", start_seconds: 0.8, end_seconds: 1.4, resolution: { start: { by: "envelope" } }, explanation: "Settled." }] } };
  assert.equal(assessRecordingQa(plan, plan.words).issues.filter((issue) => issue.kind === "recogniser-disagreement").length, 0);
});

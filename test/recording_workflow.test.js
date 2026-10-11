import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareRecording, recordingOptions, writeBrollPlan } from "../src/recording_workflow.js";
import { runCli } from "../src/cli.js";
import { recordingQaEvidenceHash } from "../src/recording_qa.js";

function phrase(text, start) {
  return text.split(" ").map((word, index) => ({ word, start: start + index * 0.3, end: start + index * 0.3 + 0.2 }));
}
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-recording-workflow-"));
  const input = path.join(directory, "take.mov");
  await writeFile(input, "original recording");
  const words = [...phrase("Engineering principles help us build reliable products.", 1), ...phrase("Engineering principles help us build reliable products.", 6)];
  let renders = 0;
  let renderedPlan;
  let transcripts = 0;
  const adapters = {
    probe: async () => ({ format: { duration: 10 }, streams: [{ codec_type: "video" }, { codec_type: "audio" }] }),
    transcribe: async () => { transcripts++; return { words }; },
    analyzeRecordingAudio: async () => ({ schema_version: "launchclip.recording-audio.v1", source_duration_seconds: 10, threshold_db: -40, silence_intervals: [{ start_seconds: 0, end_seconds: 1 }, { start_seconds: 3, end_seconds: 6 }, { start_seconds: 8, end_seconds: 10 }], waveform: [] }),
    transcribeRendered: async () => ({ words: renderedPlan.words }),
    analyzeRecordingJoins: async () => ({ checked: true, issues: [] }),
    identifyRecordingCoherence: async (plan, actual, options) => ({ evidence_hash: recordingQaEvidenceHash(plan, actual, options.mediaSha256, options.sourceTranscript, options.acoustic), coverage_complete: true, findings: [], transcript_resolutions: [], acoustic_resolutions: [] }),
    editRecording: async (_input, output, plan) => { renderedPlan = plan; renders++; await writeFile(output, "edited recording"); return { rendered_duration_seconds: plan.duration_seconds }; }
  };
  return { directory, input, words, adapters, renders: () => renders, transcripts: () => transcripts };
}

test("local recording edit caches immutable outputs and preserves capture progress on reruns", async () => {
  const f = await fixture();
  const first = await prepareRecording(f.input, { out: path.join(f.directory, "edit") }, f.adapters);
  const transcript = JSON.parse(await readFile(first.files.transcript, "utf8"));
  assert.equal(transcript.text, "Engineering principles help us build reliable products.");
  assert.ok(transcript.words[0].start < 1);
  assert.equal((await readFile(f.input, "utf8")), "original recording");
  const captures = JSON.parse(await readFile(first.files.broll_plan, "utf8"));
  assert.ok(captures.cards.length);
  captures.cards[0].status = "recorded";
  captures.cards[0].media_path = "my-real-demo.mp4";
  await writeFile(first.files.broll_plan, JSON.stringify(captures));
  await writeFile(first.files.broll_checklist, "My completed capture notes\n");
  const second = await prepareRecording(f.input, { out: path.join(f.directory, "edit") }, f.adapters);
  assert.equal(second.cached, true);
  assert.equal(f.renders(), 1);
  assert.equal(f.transcripts(), 1);
  assert.equal(JSON.parse(await readFile(first.files.broll_plan, "utf8")).cards[0].media_path, "my-real-demo.mp4");
  assert.equal(await readFile(first.files.broll_checklist, "utf8"), "My completed capture notes\n");
});

test("CLI supplied word transcript never calls a transcription provider or asks for take approval", async () => {
  const f = await fixture();
  const transcript = path.join(f.directory, "words.json");
  await writeFile(transcript, JSON.stringify({ words: f.words }));
  const output = [];
  await runCli(["edit-recording", f.input, "--recording-transcript", transcript, "--out", path.join(f.directory, "cli-edit")], {
    stdout: { write: (text) => output.push(text) },
    productionAdapters: { recording: { ...f.adapters, transcribe: async () => { throw new Error("must not transcribe"); } } }
  });
  const result = JSON.parse(output.join(""));
  assert.equal(result.status, "ready");
  assert.equal(result.take_policy, "last");
  assert.equal(result.costs.total_usd, 0);
});

test("invalid supplied timings and source collisions fail before editing", async () => {
  const f = await fixture();
  const transcript = path.join(f.directory, "invalid.json");
  await writeFile(transcript, JSON.stringify({ words: [{ word: "Hello" }] }));
  await assert.rejects(() => prepareRecording(f.input, { out: path.join(f.directory, "edit"), transcript }, f.adapters), /timestamps/);
  assert.equal(f.renders(), 0);
  const namedInput = path.join(f.directory, "base-edit.mp4");
  await writeFile(namedInput, "source");
  await assert.rejects(() => prepareRecording(namedInput, { out: f.directory }, f.adapters), /overwrite source/);
  assert.equal(await readFile(namedInput, "utf8"), "source");
});

test("standalone capture planning preserves user state and refuses a changed timeline", async () => {
  const f = await fixture();
  const transcript = path.join(f.directory, "words.json");
  await writeFile(transcript, JSON.stringify({ words: f.words, duration_seconds: 10 }));
  const first = await writeBrollPlan(transcript, { out: path.join(f.directory, "captures") });
  const plan = JSON.parse(await readFile(first.plan, "utf8"));
  plan.cards[0].status = "approved";
  await writeFile(first.plan, JSON.stringify(plan));
  await writeBrollPlan(transcript, { out: path.join(f.directory, "captures") });
  assert.equal(JSON.parse(await readFile(first.plan, "utf8")).cards[0].status, "approved");
  await writeFile(transcript, JSON.stringify({ words: f.words, duration_seconds: 11 }));
  await assert.rejects(() => writeBrollPlan(transcript, { out: path.join(f.directory, "captures") }), /different transcript or timeline/);
  assert.equal(JSON.parse(await readFile(first.plan, "utf8")).cards[0].status, "approved");
});

test("recording options keep local transcription model separate from provider transcription flags", () => {
  const options = recordingOptions({ "transcription-model": "scribe_v2", "no-trim-silence": true });
  assert.equal(options.model, "base.en");
  assert.equal(options.trimSilence, false);
  assert.equal(options.takePolicy, "last");
});

test("capture conflicts and incomplete prior exports fail before rendering or changing artifacts", async () => {
  const f = await fixture();
  const out = path.join(f.directory, "existing");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(out);
  await writeFile(path.join(out, "BROLL.md"), "Keep my capture notes");
  await assert.rejects(() => prepareRecording(f.input, { out }, f.adapters), /checklist already exists/);
  assert.equal(f.renders(), 0);
  assert.equal(await readFile(path.join(out, "BROLL.md"), "utf8"), "Keep my capture notes");
  await writeFile(path.join(out, "base-edit.mp4"), "Previous export");
  await assert.rejects(() => prepareRecording(f.input, { out }, f.adapters), /matching complete cache/);
  assert.equal(await readFile(path.join(out, "base-edit.mp4"), "utf8"), "Previous export");
  assert.equal(f.renders(), 0);
});

test("pending QA withholds base edit and resumes automatically from bound agent evidence", async () => {
  const f = await fixture();
  delete f.adapters.identifyRecordingCoherence;
  const options = { out: path.join(f.directory, "qa-edit") };
  const pending = await prepareRecording(f.input, options, f.adapters);
  assert.equal(pending.status, "needs-semantic-review");
  assert.equal(pending.output, undefined);
  await assert.rejects(() => readFile(path.join(options.out, "base-edit.mp4")), { code: "ENOENT" });
  assert.equal(await readFile(pending.candidate, "utf8"), "edited recording");
  const reviews = path.join(f.directory, "qa-reviews.json");
  await writeFile(reviews, JSON.stringify({ reviews: [{ evidence_hash: pending.qa.evidence_hash, coverage_complete: true, findings: [], transcript_resolutions: [], acoustic_resolutions: [] }] }));
  const accepted = await prepareRecording(f.input, { ...options, qaDecisions: reviews }, f.adapters);
  assert.equal(accepted.status, "ready");
  assert.equal(accepted.qa_status, "passed");
  assert.equal(f.renders(), 1);
  assert.equal(f.transcripts(), 1);
  assert.ok(accepted.files.rendered_transcript.endsWith("rendered-transcript.json"));
  assert.equal((await prepareRecording(f.input, { ...options, qaDecisions: reviews }, f.adapters)).cached, true);
});

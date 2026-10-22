import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareRecording, recordingOptions } from "../src/recording_workflow.js";
import { runCli } from "../src/cli.js";
import { recordingQaEvidenceHash } from "../src/recording_qa.js";

function phrase(text, start) {
  return text.split(" ").map((word, index) => ({ word, start: start + index * 0.3, end: start + index * 0.3 + 0.2 }));
}

async function fixture({ enhancedJoinIssue = false, enhancedDuration = null } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-enhance-wiring-"));
  const input = path.join(directory, "take.mov");
  await writeFile(input, "original recording");
  const words = [...phrase("Engineering principles help us build reliable products.", 1), ...phrase("We ship small changes every single day.", 6)];
  let renderedPlan;
  const enhanceCalls = [];
  const joinChecks = [];
  const adapters = {
    probe: async (file) => ({ format: { duration: file.includes(".base-edit.enhanced-") ? enhancedDuration ?? renderedPlan.duration_seconds : 10 }, streams: [{ codec_type: "video" }, { codec_type: "audio" }] }),
    transcribe: async () => ({ words }),
    analyzeRecordingAudio: async () => ({ schema_version: "launchclip.recording-audio.v1", source_duration_seconds: 10, threshold_db: -40, silence_intervals: [{ start_seconds: 0, end_seconds: 1 }, { start_seconds: 3.4, end_seconds: 6 }, { start_seconds: 8.4, end_seconds: 10 }], waveform: [] }),
    transcribeRendered: async () => ({ words: renderedPlan.words }),
    analyzeRecordingJoins: async (media) => {
      joinChecks.push(media);
      const enhanced = media.includes(".base-edit.enhanced-");
      return { checked: true, total_joins: 1, issues: enhanced && enhancedJoinIssue ? [{ segment_index: 1, kind: "join-click-candidate" }] : [] };
    },
    identifyRecordingCoherence: async (plan, actual, options) => ({ evidence_hash: recordingQaEvidenceHash(plan, actual, options.mediaSha256, options.sourceTranscript, options.acoustic), coverage_complete: true, findings: [], transcript_resolutions: [], acoustic_resolutions: [] }),
    editRecording: async (_input, output, plan) => { renderedPlan = plan; await writeFile(output, "accepted candidate"); return { rendered_duration_seconds: plan.duration_seconds }; },
    enhanceRecordingAudio: async (source, output, options) => {
      enhanceCalls.push({ source, output, options });
      await writeFile(output, "enhanced candidate");
      return { status: "enhanced", preset: options.preset, voice_isolation: { requested: options.voiceIsolation, status: options.voiceIsolation === "elevenlabs" ? "applied" : "not-requested", paid_call: options.voiceIsolation === "elevenlabs" }, metrics: { change: { snr_db: 9 } } };
    },
    notice: () => {}
  };
  return { directory, input, words, adapters, enhanceCalls, joinChecks };
}

test("edit-recording options default to the light preset with no voice isolation", () => {
  const defaults = recordingOptions({});
  assert.equal(defaults.enhance, "light");
  assert.equal(defaults.voiceIsolation, "none");
  const chosen = recordingOptions({ enhance: "podcast", "voice-isolation": "elevenlabs" });
  assert.equal(chosen.enhance, "podcast");
  assert.equal(chosen.voiceIsolation, "elevenlabs");
});

test("the base edit is the enhanced accepted candidate, re-checked by join QA", async () => {
  const f = await fixture();
  const result = await prepareRecording(f.input, { out: path.join(f.directory, "edit"), enhance: "podcast" }, f.adapters);
  assert.equal(result.status, "ready");
  assert.equal(f.enhanceCalls.length, 1);
  assert.match(f.enhanceCalls[0].source, /qa[\\/]attempt-1[\\/]video\.mp4$/, "enhancement runs on the QA-accepted candidate, after the cuts");
  assert.equal(f.enhanceCalls[0].options.preset, "podcast");
  assert.equal(f.enhanceCalls[0].options.voiceIsolation, "none");
  assert.equal(await readFile(result.output, "utf8"), "enhanced candidate");
  assert.ok(f.joinChecks.some((media) => media.includes(".base-edit.enhanced-")), "join QA re-ran on the enhanced media");
  assert.deepEqual({ preset: result.audio_enhancement.preset, status: result.audio_enhancement.status }, { preset: "podcast", status: "enhanced" });
  const report = JSON.parse(await readFile(result.files.audio_enhance, "utf8"));
  assert.equal(report.status, "enhanced");
  assert.equal(report.join_qa.checked, true);
  assert.equal(report.output, result.output);
  assert.equal(result.checksums.audio_enhance.length, 64);
  // The candidate itself is untouched.
  assert.equal(await readFile(path.join(f.directory, "edit", "qa", "attempt-1", "video.mp4"), "utf8"), "accepted candidate");
  const rerun = await prepareRecording(f.input, { out: path.join(f.directory, "edit"), enhance: "podcast" }, f.adapters);
  assert.equal(rerun.cached, true);
  assert.equal(f.enhanceCalls.length, 1);
});

test("a join regression or duration change after enhancement publishes the unenhanced candidate", async () => {
  const clicks = await fixture({ enhancedJoinIssue: true });
  const reverted = await prepareRecording(clicks.input, { out: path.join(clicks.directory, "edit") }, clicks.adapters);
  assert.equal(reverted.audio_enhancement.status, "reverted");
  assert.match(reverted.audio_enhancement.revert_reason, /introduced 1 join issue/);
  assert.equal(await readFile(reverted.output, "utf8"), "accepted candidate");
  const report = JSON.parse(await readFile(reverted.files.audio_enhance, "utf8"));
  assert.equal(report.status, "reverted");

  const longer = await fixture({ enhancedDuration: 99 });
  const timing = await prepareRecording(longer.input, { out: path.join(longer.directory, "edit") }, longer.adapters);
  assert.equal(timing.audio_enhancement.status, "reverted");
  assert.match(timing.audio_enhancement.revert_reason, /duration/);
});

test("--enhance off links the accepted candidate and never calls the enhancer", async () => {
  const f = await fixture();
  const result = await prepareRecording(f.input, { out: path.join(f.directory, "edit"), enhance: "off" }, f.adapters);
  assert.equal(f.enhanceCalls.length, 0);
  assert.equal(result.audio_enhancement.status, "off");
  assert.equal(await readFile(result.output, "utf8"), "accepted candidate");
  assert.equal(JSON.parse(await readFile(result.files.audio_enhance, "utf8")).status, "off");
});

test("an unknown preset fails before transcription or rendering", async () => {
  const f = await fixture();
  let rendered = false;
  await assert.rejects(() => prepareRecording(f.input, { out: path.join(f.directory, "edit"), enhance: "studio" }, { ...f.adapters, editRecording: async () => { rendered = true; } }), /--enhance must be one of light, podcast, off/);
  assert.equal(rendered, false);
});

test("CLI flags reach the enhancer and isolation is reported", async () => {
  const f = await fixture();
  const transcript = path.join(f.directory, "words.json");
  await writeFile(transcript, JSON.stringify({ words: f.words }));
  const output = [];
  await runCli(["edit-recording", f.input, "--recording-transcript", transcript, "--out", path.join(f.directory, "cli"), "--enhance", "light", "--voice-isolation", "elevenlabs"], {
    stdout: { write: (text) => output.push(text) },
    productionAdapters: { recording: f.adapters }
  });
  const result = JSON.parse(output.join(""));
  assert.equal(f.enhanceCalls[0].options.voiceIsolation, "elevenlabs");
  assert.equal(result.audio_enhancement.voice_isolation, "elevenlabs");
  assert.equal(result.audio_enhancement.voice_isolation_status, "applied");
  assert.equal(result.audio_enhancement.paid_isolation_call, true);
});

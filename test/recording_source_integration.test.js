import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareSourceMedia } from "../src/production_source_media.js";
import { buildEvidence } from "../src/evidence.js";
import { produceAudio } from "../src/production_audio.js";
import { ProductionJobStore } from "../src/job_store.js";

test("recording mode survives omitted flags and keeps presenter, narration and word timings together", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-recording-source-"));
  await mkdir(path.join(workspace, "production"));
  const input = path.join(workspace, "take.mov");
  const output = path.join(workspace, "clean.mp4");
  const transcript = path.join(workspace, "edited.json");
  await writeFile(input, "original");
  await writeFile(output, "clean");
  await writeFile(transcript, JSON.stringify({ words: [{ word: "Ship.", start: 0.15, end: 0.5 }] }));
  const intakePath = path.join(workspace, "production", "intake.json");
  await writeFile(intakePath, JSON.stringify({
    source: { kind: "voiceover", value: input, location: input }, brief: { duration_seconds: 10 },
    resources: ["voiceover", "presenter"].map((role) => ({ id: role, role, type: "video", is_remote: false, location: input }))
  }));
  const calls = [];
  const adapters = {
    prepareRecording: async (source, options) => {
      calls.push({ source, options });
      return { output, output_sha256: "edited-sha", rendered_duration_seconds: 0.65, manifest: "recording.json", files: { transcript } };
    },
    trimMediaSilence: async () => { throw new Error("must not restore raw recording"); }
  };
  await prepareSourceMedia(workspace, { editRecording: true, recording: { retakeWindow: 90, silenceDuration: 0.8 }, trimSilence: true }, adapters);
  await prepareSourceMedia(workspace, {}, adapters);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].source, input);
  assert.equal(calls[1].options.retakeWindow, 90);
  const intake = JSON.parse(await readFile(intakePath, "utf8"));
  assert.equal(intake.brief.duration_seconds, 0.65);
  assert.equal(intake.resources.find((entry) => entry.role === "presenter").location, output);
  assert.equal(intake.resources.find((entry) => entry.role === "voiceover").derived_from, input);
  assert.equal(intake.resources.find((entry) => entry.role === "voiceover-transcript").media_location, output);
  assert.equal(await readFile(input, "utf8"), "original");
});

test("word-timed supplied JSON becomes spoken evidence and reaches audio production without a provider", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-recording-evidence-"));
  const production = path.join(workspace, "production");
  await mkdir(production);
  const media = path.join(workspace, "clean.mp4");
  const transcript = path.join(workspace, "transcript.json");
  const words = [{ word: "Less", start: 0.15, end: 0.4 }, { word: "consuming.", start: 0.4, end: 0.9 }];
  await writeFile(media, "clean media");
  await writeFile(transcript, JSON.stringify({ text: "Misleading raw text", words }));
  const intake = {
    workspace, source: { kind: "voiceover", value: media, location: media }, brief: { language: "en" },
    resources: [{ id: "video", role: "voiceover", type: "video", is_remote: false, location: media }, { id: "words", role: "voiceover-transcript", type: "text", location: transcript }]
  };
  const evidence = await buildEvidence(intake, {}, { probe: async () => ({ format: { duration: 1 } }) });
  const speech = evidence.items.find((entry) => entry.kind === "voiceover-transcript");
  assert.equal(speech.content, "Less consuming.");
  assert.equal(speech.provenance, media);
  assert.equal(speech.metadata.find((entry) => entry.key === "words_path").value, transcript);
  await writeFile(path.join(production, "intake.json"), JSON.stringify(intake));
  await writeFile(path.join(production, "evidence.json"), JSON.stringify(evidence));
  await writeFile(path.join(production, "plan.json"), JSON.stringify({ format: { duration_seconds: 1 }, narration: { source: "supplied", full_text: "Less consuming." }, shots: [], audio: {} }));
  const store = await ProductionJobStore.open(workspace);
  await store.add({ id: "creative-plan", kind: "creative-plan", depends_on: [], input_hash: "plan" });
  await store.markRunning("creative-plan");
  await store.markSucceeded("creative-plan");
  const result = await produceAudio(workspace, { noMusic: true, noSfx: true }, { probeDuration: async () => 1 });
  const manifest = JSON.parse(await readFile(result.manifest, "utf8"));
  assert.deepEqual(JSON.parse(await readFile(manifest.voiceover.words_path, "utf8")), words);
  assert.equal(await readFile(result.voiceover, "utf8"), "clean media");
});

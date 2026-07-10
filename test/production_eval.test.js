import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PRODUCTION_EVALUATION_SCENARIOS,
  PRODUCTION_EVALUATION_VERSION,
  evaluationScenarioDefinitions,
  runProductionEvaluationMatrix
} from "../src/production_eval.js";

test("defines the five required source-to-video evaluation modes", () => {
  const fixtures = {
    screenVideo: "/fixtures/screen.mp4",
    voiceoverAudio: "/fixtures/voice.wav",
    presenterVideo: "/fixtures/presenter.mp4",
    paperPdf: "/fixtures/paper.pdf",
    voiceoverTranscript: "/fixtures/voice.txt",
    presenterTranscript: "/fixtures/presenter.txt",
    longformNotes: "/fixtures/long.md"
  };
  const definitions = evaluationScenarioDefinitions(fixtures, "/eval");
  assert.deepEqual(definitions.map((entry) => entry.id), PRODUCTION_EVALUATION_SCENARIOS);
  assert.equal(definitions.find((entry) => entry.id === "saas-16x9").expected.aspect, "16:9");
  assert.equal(definitions.find((entry) => entry.id === "topic-pdf").source, fixtures.paperPdf);
  assert.equal(definitions.find((entry) => entry.id === "supplied-audio").expected.narration, "supplied");
  assert.equal(definitions.find((entry) => entry.id === "presenter-video").expected.presenter, true);
  assert.equal(definitions.find((entry) => entry.id === "hierarchical-longform").planningMode, "hierarchical");
});

test("writes a selected frozen-provider matrix report without requiring credentials", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "launchclip-eval-matrix-"));
  const output = path.join(parent, "matrix");
  const executed = [];
  const progress = [];
  const result = await runProductionEvaluationMatrix(output, { scenarios: ["saas-16x9", "presenter-video"] }, {
    createFixtures: async () => ({
      screenVideo: "/fixtures/screen.mp4", voiceoverAudio: "/fixtures/voice.wav", presenterVideo: "/fixtures/presenter.mp4",
      paperPdf: "/fixtures/paper.pdf", voiceoverTranscript: "/fixtures/voice.txt", presenterTranscript: "/fixtures/presenter.txt", longformNotes: "/fixtures/long.md"
    }),
    executeScenario: async (definition) => {
      executed.push(definition.id);
      return { id: definition.id, status: "passed", snapshots: [`scenarios/${definition.id}/snapshot.png`] };
    },
    onProgress: async (event) => progress.push(`${event.scenario}:${event.status}`)
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(executed, ["saas-16x9", "presenter-video"]);
  assert.deepEqual(progress, ["saas-16x9:started", "saas-16x9:passed", "presenter-video:started", "presenter-video:passed"]);
  const report = JSON.parse(await readFile(result.report, "utf8"));
  assert.equal(report.schema_version, PRODUCTION_EVALUATION_VERSION);
  assert.equal(report.provider_mode, "frozen-no-openai-or-elevenlabs-credentials");
  assert.match(report.network_boundary, /keyless, not fully network-isolated/);
  assert.deepEqual(report.scenarios.map((entry) => entry.id), executed);
  await assert.rejects(
    () => runProductionEvaluationMatrix(output, {}, { createFixtures: async () => ({}), executeScenario: async () => ({ status: "passed", snapshots: [] }) }),
    /already exists/
  );
});

test("rejects unknown evaluation scenarios before executing work", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "launchclip-eval-unknown-"));
  await assert.rejects(
    () => runProductionEvaluationMatrix(path.join(parent, "matrix"), { scenarios: ["unknown"] }, {
      createFixtures: async () => ({
        screenVideo: "screen", voiceoverAudio: "voice", presenterVideo: "presenter", paperPdf: "paper",
        voiceoverTranscript: "voice-text", presenterTranscript: "presenter-text", longformNotes: "notes"
      }),
      executeScenario: async () => { throw new Error("must not execute"); }
    }),
    /Unknown evaluation scenario/
  );
});

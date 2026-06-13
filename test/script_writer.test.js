import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildViralScript,
  buildVoiceoverFromViralScript,
  countWords,
  readEvidenceBank,
  VIRAL_SCRIPT_SCHEMA,
  writeViralScript
} from "../src/script_writer.js";

test("buildViralScript follows the reference short-form structure", () => {
  const script = buildViralScript({
    repoName: "sample-tool",
    summary: "proves launchclip can create a grounded launch packet",
    command: "npm run smoke",
    prompt: "your demo passes",
    artifacts: ["demo/terminal.txt"]
  });
  assert.equal(script.schema_version, VIRAL_SCRIPT_SCHEMA);
  assert.equal(script.beats[0].role, "hook");
  assert.ok(countWords(script.beats[0].text) <= 14);
  assert.equal(script.beats.filter((beat) => beat.role === "step").length, 5);
  assert.ok(script.beats.some((beat) => beat.role === "payoff"));
  assert.ok(script.word_count >= 130 && script.word_count <= 165, `word count ${script.word_count}`);
  assert.deepEqual(script.warnings, []);
  assert.match(script.full_text, /npm run smoke/);
  assert.doesNotMatch(script.full_text, /\$6,000|10x|30 minutes/);
});

test("buildVoiceoverFromViralScript creates teleprompter-compatible segments", () => {
  const script = buildViralScript({
    repoName: "sample-tool",
    summary: "proves launchclip can create a grounded launch packet",
    command: "npm run smoke",
    prompt: "your demo passes",
    artifacts: ["demo/terminal.txt"]
  });
  const voiceover = buildVoiceoverFromViralScript(script);
  assert.equal(voiceover.schema_version, "launchclip.voiceover.v1");
  assert.equal(voiceover.segments.length, script.beats.length);
  assert.equal(voiceover.segments[0].beat, "hook");
  assert.match(voiceover.full_text, /launch proof build itself/);
});

test("writeViralScript reads workspace evidence and writes script artifacts", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-script-"));
  try {
    await mkdir(path.join(temp, "demo"), { recursive: true });
    await writeFile(
      path.join(temp, "launchclip.json"),
      `${JSON.stringify({
        source_repo: {
          name: "sample-tool",
          summary: "proves launchclip can create a grounded launch packet from a local OSS repo"
        }
      })}\n`
    );
    await writeFile(path.join(temp, "demo", "terminal.txt"), "$ npm run smoke\n\nsample-tool smoke passed\n");
    await writeFile(
      path.join(temp, "demo", "command-receipt.json"),
      `${JSON.stringify({ command: "npm run smoke", status: "passed", artifacts: [{ type: "terminal", path: "demo/terminal.txt" }] })}\n`
    );
    const evidence = await readEvidenceBank(temp, { prompt: "your demo passes" });
    assert.equal(evidence.command, "npm run smoke");

    const result = await writeViralScript(temp, { prompt: "your demo passes" });
    const script = JSON.parse(await readFile(result.script, "utf8"));
    const voiceover = JSON.parse(await readFile(result.voiceover, "utf8"));
    const teleprompter = await readFile(result.teleprompter, "utf8");

    assert.equal(script.schema_version, VIRAL_SCRIPT_SCHEMA);
    assert.equal(voiceover.segments.length, script.beats.length);
    assert.match(teleprompter, /Energy one notch above/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

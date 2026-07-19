import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("CLI skill routes premium one-shot work through cinematic readiness", async () => {
  const skill = await text("skills/launchclip-cli/SKILL.md");
  const reference = await text("skills/launchclip-cli/references/cli-reference.md");
  assert.match(skill, /produce <source> --profile cinematic/);
  assert.match(skill, /cinematic-readiness\.json` with `ok: true/);
  assert.match(reference, /five distinct\s+concepts/);
  assert.match(reference, /narration production plus measured word\/beat timing/);
  assert.match(reference, /critic `ship` verdict alone is insufficient/);
});

test("subscription skill requires the cinematic funnel and local output gate", async () => {
  const skill = await text("skills/launchclip-create-video/SKILL.md");
  const reference = await text("skills/launchclip-create-video/references/cinematic-production.md");
  const runtime = await text("skills/launchclip-create-video/references/standalone-hyperframes.md");
  const metadata = await text("skills/launchclip-create-video/agents/openai.yaml");
  for (const artifact of ["CONCEPTS.json", "STORY.json", "NARRATION.json", "AUDIO-MANIFEST.json", "CINEMATIC-READINESS.json"]) {
    assert.match(skill, new RegExp(artifact.replace(".", "\\.")));
  }
  assert.match(skill, /Do not run `launchclip produce`/);
  assert.match(skill, /Use `launchclip cinematic-check`/);
  assert.match(reference, /Generate exactly five complete treatments/);
  assert.match(reference, /fresh-context retention edit/);
  assert.match(reference, /Allow at most ±2% final conformance/);
  assert.match(skill, /data-launchclip-cinematic-contract="phase-2"/);
  assert.match(skill, /persistent 8–20 second shared worlds/);
  assert.match(skill, /stable object IDs, cumulative state/);
  assert.match(reference, /Compare actual pixels and motion at delivery size/);
  assert.match(reference, /Candidate B must not repair, imitate, or average candidate A/);
  assert.match(skill, /qa\/rendered-candidates\.json/);
  assert.match(skill, /qa\/temporal-evidence\/manifest\.json/);
  assert.match(runtime, /hook: `0,0\.25,0\.5,0\.75,1,1\.5,2,3,4`/);
  assert.match(runtime, /shared-world move: before, departure, 20%, 50%, 80%, settle, and after/);
  assert.match(runtime, /Capture both HyperFrames snapshots and frames extracted from the encoded draft/);
  assert.match(runtime, /stable\s+evidence ID, role, timestamp, sequence or\s+boundary ID, filename, and file hash/);
  assert.match(reference, /Use at most three bounded passes/);
  assert.match(metadata, /cinematic, locally verified HyperFrames video/);
});

async function text(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

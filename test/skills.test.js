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
  const metadata = await text("skills/launchclip-create-video/agents/openai.yaml");
  for (const artifact of ["CONCEPTS.json", "STORY.json", "NARRATION.json", "AUDIO-MANIFEST.json", "CINEMATIC-READINESS.json"]) {
    assert.match(skill, new RegExp(artifact.replace(".", "\\.")));
  }
  assert.match(skill, /Do not run `launchclip produce`/);
  assert.match(skill, /Use `launchclip cinematic-check`/);
  assert.match(reference, /Generate exactly five complete treatments/);
  assert.match(reference, /fresh-context retention edit/);
  assert.match(reference, /Allow at most ±2% final conformance/);
  assert.match(reference, /Use at most three bounded passes/);
  assert.match(metadata, /cinematic, locally verified HyperFrames video/);
});

async function text(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

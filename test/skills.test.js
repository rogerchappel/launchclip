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
  // SKILL.md carries the quick path; references/workflow.md the full workflow.
  const quick = await text("skills/launchclip-create-video/SKILL.md");
  const skill = `${quick}\n${await text("skills/launchclip-create-video/references/workflow.md")}`;
  for (const artifact of ["CONCEPTS.json", "STORY.json", "NARRATION.json", "AUDIO-MANIFEST.json", "CINEMATIC-READINESS.json", "qa/rendered-candidates.json", "qa/temporal-evidence/manifest.json"]) {
    assert.ok(quick.includes(artifact), `SKILL.md names ${artifact}`);
  }
  assert.match(quick, /Do not run `launchclip produce`/);
  assert.match(quick, /data-launchclip-cinematic-contract="phase-2"/);
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
  assert.match(reference, /launchclip\.subscription-rendered-candidates\.v2/);
  assert.match(reference, /requires four admissible candidates across the opening and transition\s+comparisons/);
  assert.match(reference, /one encoded candidate clip or at least three lifecycle images per candidate/);
  assert.match(reference, /velocity_blur_shape/);
  assert.match(runtime, /hook: `0,0\.25,0\.5,0\.75,1,1\.5,2,3,4`/);
  assert.match(runtime, /shared-world move: 0\.05 seconds before, departure, 20%, 50%, 80%, settle,\s+and 0\.05 seconds after/);
  assert.match(runtime, /Capture both a HyperFrames snapshot and a frame extracted from the encoded\s+draft for every required sample/);
  assert.match(runtime, /launchclip\.subscription-temporal-evidence\.v1/);
  assert.match(runtime, /exactly two uniquely named\s+evidence entries, one for each source/);
  assert.match(runtime, /data-launchclip-transition-from/);
  assert.match(runtime, /ordinary boundary: 0\.05 seconds before, midpoint, and 0\.05 seconds after/);
  assert.match(runtime, /ffmpeg .*renders\/draft\.mp4/s);
  assert.doesNotMatch(runtime, /HOOKS\.md/);
  assert.match(reference, /entry, peak\s+motion, and settled frames/);
  assert.match(reference, /severity: "blocking\|major\|minor"/);
  assert.match(reference, /A clean `ship` verdict without complete evidence coverage\s+fails the phase-2 gate/);
  assert.match(reference, /Use at most three bounded passes/);
  assert.match(metadata, /cinematic, locally verified HyperFrames video/);
});

async function text(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("both create-video skills open with a concise quick path in gate order", async () => {
  for (const [dir, renderer] of [["skills/launchclip-create-video", "hyperframes"], ["skills/launchclip-create-video-remotion", "remotion"]]) {
    const skill = await text(`${dir}/SKILL.md`);
    assert.ok(Buffer.byteLength(skill) < 12_000, `${dir}/SKILL.md stays short (${Buffer.byteLength(skill)} bytes)`);
    const quick = skill.slice(skill.indexOf("## Quick path"));
    assert.ok(skill.indexOf("## Quick path") > 0 && skill.indexOf("## Quick path") < 2500, "the quick path comes first");
    const order = ["BRIEF.md", "CONCEPTS.json", "launchclip voice", "storyboard-modules.md", "--candidate", `launchclip finish <project> --renderer ${renderer}`, "qa/critic.json", "launchclip cinematic-check"];
    let at = -1;
    for (const step of order) {
      const next = quick.indexOf(step, at + 1);
      assert.ok(next > at, `${dir}: ${step} follows the previous step`);
      at = next;
    }
    for (const reference of ["workflow.md", "cinematic-production.md", "storyboard-modules.md", "shorts-delivery.md"]) {
      assert.ok(skill.includes(`references/${reference}`), `${dir} links ${reference}`);
      await text(`${dir}/references/${reference}`);
    }
    const workflow = await text(`${dir}/references/workflow.md`);
    assert.doesNotMatch(workflow, /\]\(references\//, "workflow.md links its siblings directly");
    assert.match(workflow, /## Author and repair/);
    assert.match(workflow, /## Preserve the cost boundary/);
  }
});

import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runStoryCommand } from "../src/story_cli.js";
import { checkLayoutProject } from "../src/layout_check.js";

// Golden storyboards double as renderer regression tests (RFC §8,
// npm run eval:renderers). Each must validate with zero warnings and pass the
// geometric layout check with zero errors.
const ROOT = path.resolve(import.meta.dirname, "..");
const STORY = path.join(ROOT, "examples", "story");
const GOLDEN = [
  { id: "cooling", story: path.join(STORY, "cooling.story.json"), narration: path.join(STORY, "cooling.NARRATION.json") },
  { id: "minimal", dir: path.join(STORY, "minimal") }
];

async function projectFor(entry) {
  if (entry.dir) return { project: entry.dir, cleanup: async () => {} };
  // A loose story file: stage it as <tmp>/storyboard.json next to its narration.
  const project = await mkdtemp(path.join(os.tmpdir(), `launchclip-golden-${entry.id}-`));
  await cp(entry.story, path.join(project, "storyboard.json"));
  await cp(entry.narration, path.join(project, path.basename(entry.narration)));
  return { project, cleanup: () => rm(project, { recursive: true, force: true }) };
}

for (const entry of GOLDEN) {
  test(`golden story ${entry.id} validates with zero warnings and passes layout-check`, async () => {
    const storyFile = entry.story ?? path.join(entry.dir, "storyboard.json");
    const result = await runStoryCommand("validate", storyFile, {});
    assert.equal(result.status, "passed", result.errors.join("\n"));
    assert.deepEqual(result.warnings, []);
    assert.equal(result.anchors_resolved, true);
    const { project, cleanup } = await projectFor(entry);
    try {
      const layout = await checkLayoutProject(project);
      assert.equal(layout.errors, 0, layout.findings.filter((finding) => finding.severity === "error").map((finding) => `${finding.rule}: ${finding.detail}`).join("\n"));
    } finally {
      await cleanup();
    }
  });
}

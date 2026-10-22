import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runStoryCommand } from "../src/story_cli.js";
import { checkLayoutProject } from "../src/layout_check.js";
import { deriveBoundaries, resolveStory } from "../kit/core/story.mjs";

// Golden storyboards double as renderer regression tests (RFC §8,
// npm run eval:renderers). Each must validate with zero warnings and pass the
// geometric layout check with zero errors.
const ROOT = path.resolve(import.meta.dirname, "..");
const STORY = path.join(ROOT, "examples", "story");
const GOLDEN = [
  { id: "cooling", story: path.join(STORY, "cooling.story.json"), narration: path.join(STORY, "cooling.NARRATION.json") },
  { id: "minimal", dir: path.join(STORY, "minimal") },
  { id: "promo-16x9", dir: path.join(STORY, "promo-16x9") },
  { id: "explainer-9x16", dir: path.join(STORY, "explainer-9x16") },
  { id: "data-story-9x16", dir: path.join(STORY, "data-story-9x16") }
];

// Full-catalogue goldens: each covers its modules, phase 2 with a shared-world
// morph, hits on real narration words, captions and a small committed mix.
const CATALOGUE = [
  { id: "promo-16x9", aspect: [1920, 1080], modules: ["hook-title", "logo-row", "process-steps", "count-up", "media-window", "cta"] },
  { id: "explainer-9x16", aspect: [1080, 1920], modules: ["kinetic-words", "function-chart", "flow-compare", "archive-card", "equation-lockup"] },
  { id: "data-story-9x16", aspect: [1080, 1920], modules: ["trend-chart", "growth-chart", "checklist", "step-rail", "code-snippet", "excerpt-window", "focus-flow"] }
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

for (const entry of CATALOGUE) {
  test(`golden story ${entry.id} covers its modules with phase-2 boundaries, word hits, captions and a mix`, async () => {
    const dir = path.join(STORY, entry.id);
    const story = JSON.parse(await readFile(path.join(dir, "storyboard.json"), "utf8"));
    const words = JSON.parse(await readFile(path.join(dir, "NARRATION.json"), "utf8")).words;
    assert.deepEqual([story.format.width, story.format.height], entry.aspect);
    assert.deepEqual(story.scenes.map((scene) => scene.module), entry.modules);
    assert.equal(story.phase, 2);
    assert.ok(story.overlays.some((overlay) => overlay.type === "captions"));
    const boundaries = deriveBoundaries(resolveStory(story, { words }));
    assert.ok(boundaries.some((boundary) => boundary.kind === "shared-world"), "a shared-world morph");
    for (const scene of story.scenes) {
      assert.ok(scene.hits?.length, `${scene.id} has hits`);
      for (const hit of scene.hits) assert.match(String(hit.at), /^word:/, `${scene.id} ${hit.event} is anchored to a word`);
    }
    for (const word of words) assert.ok(word.end > word.start, word.text);
    const mix = await stat(path.join(dir, story.audio.mix));
    assert.ok(mix.size > 50_000 && mix.size < 600_000, `mix is ${mix.size} bytes`);
    for (const scene of story.scenes) {
      const src = scene.params?.media?.src;
      if (src) assert.ok((await stat(path.join(dir, src))).size < 400_000, `${src} stays small`);
    }
  });
}

import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getRenderer } from "../src/renderers/index.js";
import { compileStoryCommand } from "../src/story_cli.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples/story/minimal");

async function chromeAvailable() {
  try {
    const { ensureBrowser } = await import("@remotion/renderer");
    await ensureBrowser();
    return null;
  } catch (error) {
    return error.message;
  }
}

test("kit/remotion renders a real LaunchclipStory still of examples/story/minimal", { timeout: 240_000 }, async (t) => {
  const missing = await chromeAvailable();
  if (missing) { t.skip(`Chrome Headless Shell is unavailable: ${missing}`); return; }
  // Work on a copy: the adapter writes .launchclip/story.resolved.json into the project.
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-remotion-story-"));
  try {
    await cp(MINIMAL, project, { recursive: true });
    const adapter = getRenderer("remotion");
    const stillFile = path.join(project, "qa", "still-3.2.png");
    const still = await adapter.still(project, 3.2, stillFile);
    assert.equal(still.frame, 96);
    const png = await readFile(stillFile);
    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
    assert.equal(png.readUInt32BE(16), 1080);
    assert.equal(png.readUInt32BE(20), 1920);
    assert.ok(png.length > 20_000, "the frame has content (plates, modules or placeholders, captions)");

    const props = JSON.parse(await readFile(path.join(project, ".launchclip/story.resolved.json"), "utf8"));
    assert.deepEqual(props.resolved, { duration: 6, fps: 30, frames: 180 });

    const compiled = await compileStoryCommand(project, { renderer: "remotion" });
    assert.equal(compiled.status, "compiled");
    assert.ok(compiled.compositions.includes("LaunchclipStory"));
    assert.ok(compiled.compositions.includes("ModuleReview"));
    assert.deepEqual(compiled.boundaries.map((entry) => entry.boundary_id), ["s2-in"]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

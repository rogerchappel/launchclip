import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { remotionBundleDir, remotionMemoryOptions, renderRemotionSegments, renderRemotionStills } from "../src/renderers/remotion_segments.js";

// A stubbed @remotion/renderer that records what each call receives, and a
// bundle already in place so nothing is bundled.
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-remotion-memory-"));
  const project = path.join(root, "project");
  await mkdir(project, { recursive: true });
  const args = { entry: path.join(root, "entry.tsx"), project, kitHash: "kit-1", bundleRoot: path.join(root, "bundles") };
  const { dir } = await remotionBundleDir(args);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "index.html"), "");
  await writeFile(path.join(dir, "bundle.js"), "");
  const calls = [];
  const renderer = {
    openBrowser: async () => ({ close: async () => {} }),
    selectComposition: async (options) => { calls.push(["selectComposition", options]); return { id: "LaunchclipStory" }; },
    renderMedia: async (options) => { calls.push(["renderMedia", options]); },
    renderStill: async (options) => { calls.push(["renderStill", options]); }
  };
  return { root, args, calls, renderer };
}

test("the video cache is sized from the render budget, not Remotion's host-memory default", () => {
  assert.deepEqual(remotionMemoryOptions({ tabs: 4, ram_gb: 7.5, video_cache_bytes: 1234 }), { offthreadVideoCacheSizeInBytes: 1234 });
  assert.ok(remotionMemoryOptions().offthreadVideoCacheSizeInBytes <= 2 * 1024 ** 3);
});

test("renderMedia and selectComposition receive the cache budget and the tab count", async () => {
  const { root, args, calls, renderer } = await fixture();
  try {
    const memory = remotionMemoryOptions({ tabs: 4, ram_gb: 7.5, video_cache_bytes: 1.125 * 1024 ** 3 });
    await renderRemotionSegments({ ...args, props: {}, segments: [{ startFrame: 0, endFrame: 30, output: path.join(root, "out", "0.mov") }], concurrency: 4, memory, renderer });
    const media = calls.find(([name]) => name === "renderMedia")[1];
    assert.equal(media.offthreadVideoCacheSizeInBytes, 1.125 * 1024 ** 3);
    assert.equal(media.concurrency, 4);
    assert.equal(calls.find(([name]) => name === "selectComposition")[1].offthreadVideoCacheSizeInBytes, 1.125 * 1024 ** 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stills take the same cache budget, measured from the machine by default", async () => {
  const { root, args, calls, renderer } = await fixture();
  try {
    await renderRemotionStills({ ...args, props: {}, stills: [{ frame: 0, output: path.join(root, "out", "0.png") }], renderer });
    const still = calls.find(([name]) => name === "renderStill")[1];
    assert.equal(still.offthreadVideoCacheSizeInBytes, remotionMemoryOptions().offthreadVideoCacheSizeInBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

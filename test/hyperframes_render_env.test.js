import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HYPERFRAMES_FFMPEG_TIMEOUT_MS, createHyperframesRenderer, hyperframesRenderEnv } from "../src/renderers/hyperframes.js";

test("HyperFrames renders give ffmpeg extraction 30 minutes unless the caller set a timeout", async (t) => {
  assert.equal(hyperframesRenderEnv({ PATH: "/bin" }).FFMPEG_PROCESS_TIMEOUT_MS, String(HYPERFRAMES_FFMPEG_TIMEOUT_MS));
  assert.equal(hyperframesRenderEnv({ FFMPEG_PROCESS_TIMEOUT_MS: "1000" }).FFMPEG_PROCESS_TIMEOUT_MS, "1000");
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-hf-env-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  const renderer = createHyperframesRenderer({ run: async (command, args, options) => { calls.push(options); return { stdout: "", stderr: "" }; } });
  await renderer.render(dir, path.join(dir, "out.mp4"));
  assert.ok(Number(calls[0].env.FFMPEG_PROCESS_TIMEOUT_MS) >= HYPERFRAMES_FFMPEG_TIMEOUT_MS);
  assert.equal(calls[0].env.PATH, process.env.PATH, "the rest of the environment passes through");
});

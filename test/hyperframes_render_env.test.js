import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HYPERFRAMES_FFMPEG_TIMEOUT_MS, createHyperframesRenderer, hyperframesRenderEnv } from "../src/renderers/hyperframes.js";
import { HYPERFRAMES_NAVIGATION_TIMEOUT_MS, hyperframesEnv } from "../src/renderers/hyperframes_env.js";
import { runHyperframes } from "../src/toolchain.js";

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

test("HyperFrames snapshots and checks give a long composition's page 3 minutes to load unless the caller set a timeout", async (t) => {
  assert.equal(hyperframesEnv({ PATH: "/bin" }).PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS, String(HYPERFRAMES_NAVIGATION_TIMEOUT_MS));
  assert.equal(hyperframesEnv({ PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS: "5000" }).PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS, "5000");
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-hf-env-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  const run = async (command, args, options) => {
    calls.push({ args, options });
    if (args.includes("--output")) await writeFile(path.join(args[args.indexOf("--output") + 1], "frame-00-at-1.0s.png"), "");
    return { stdout: "{\"ok\":true}", stderr: "" };
  };
  const renderer = createHyperframesRenderer({ run });
  await renderer.still(dir, 1, path.join(dir, "still.png"));
  await renderer.check(dir);
  await runHyperframes(run, ["snapshot", "--at", "1", dir], { cwd: dir });
  assert.equal(calls.length, 4);
  for (const call of calls) assert.equal(call.options.env.PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS, String(HYPERFRAMES_NAVIGATION_TIMEOUT_MS), call.args.join(" "));
});

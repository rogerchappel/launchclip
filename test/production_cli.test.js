import assert from "node:assert/strict";
import test from "node:test";
import { runProduction, runProductionStage } from "../src/production_cli.js";

test("runs the delegated production DAG in dependency order and stops for approval", async () => {
  const calls = [];
  const adapters = {
    writeIntake: async () => { calls.push("intake"); return { workspace: "/tmp/workspace" }; },
    collectEvidence: async () => { calls.push("evidence"); return { items: 3 }; },
    analyzeSourceMedia: async () => { calls.push("source-media"); return { analyses: 1 }; },
    planProduction: async () => { calls.push("plan"); return { shots: 2 }; },
    produceAudio: async (_workspace, options) => { calls.push(["audio", options]); return { status: "ready", voiceover: "/tmp/voice.mp3", music: "/tmp/music.mp3", sfx: "/tmp/sfx.json", warnings: [] }; },
    directFrames: async () => { calls.push("frames"); return { generated: 2, cached: 0 }; },
    assembleHyperFrames: async (_workspace, options) => { calls.push(["assemble", options]); return { index: "/tmp/workspace/production/hyperframes/index.html" }; }
  };
  const result = await runProduction("owner/repo", { "no-audio": true, concurrency: "2" }, adapters);
  assert.equal(result.status, "awaiting-approval");
  assert.deepEqual(calls.map((entry) => Array.isArray(entry) ? entry[0] : entry), ["intake", "evidence", "source-media", "plan", "audio", "frames", "assemble"]);
  assert.equal(calls[4][1].noVoice, true);
  assert.equal(calls[4][1].noMusic, true);
  assert.equal(calls[4][1].noSfx, true);
  assert.equal(calls[6][1].voiceover, "/tmp/voice.mp3");
  assert.match(result.next, /production-render/);
});

test("blocks assembly when measured narration timing requires a replan", async () => {
  let framesCalled = false;
  const adapters = {
    writeIntake: async () => ({ workspace: "/tmp/workspace" }),
    collectEvidence: async () => ({}),
    analyzeSourceMedia: async () => ({}),
    planProduction: async () => ({}),
    produceAudio: async () => ({ status: "needs-retiming", warnings: ["Narration is four seconds long."] }),
    directFrames: async () => { framesCalled = true; }
  };
  await assert.rejects(() => runProduction("owner/repo", {}, adapters), /Re-run creative planning/);
  assert.equal(framesCalled, false);
});

test("routes production repair with scoped model controls", async () => {
  let received;
  const result = await runProductionStage("production-repair", "/tmp/workspace", { "repair-model": "gpt-5.6", "repair-reasoning": "xhigh", "repair-snapshots": "6", concurrency: "2" }, {
    repairProduction: async (workspace, options) => { received = { workspace, options }; return { status: "repaired" }; }
  });
  assert.equal(result.status, "repaired");
  assert.equal(received.workspace, "/tmp/workspace");
  assert.equal(received.options.reasoning, "xhigh");
  assert.equal(received.options.maxSnapshots, 6);
  assert.equal(received.options.concurrency, 2);
});

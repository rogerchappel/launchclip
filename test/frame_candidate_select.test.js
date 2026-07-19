import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FRAME_CANDIDATE_JUDGMENT_VERSION, FRAME_CANDIDATE_SELECTION_VERSION, judgeRenderedFrameCandidates, selectCinematicCandidateShots } from "../src/frame_candidate_select.js";

test("selects the hook and the highest-value proof or continuity shot", () => {
  const plan = fixturePlan();
  const story = {
    narration: {
      beats: [
        { role: "hook", target_start_seconds: 0, target_end_seconds: 4 },
        { role: "setup", target_start_seconds: 4, target_end_seconds: 9 },
        { role: "proof", target_start_seconds: 9, target_end_seconds: 12 },
        { role: "payoff", target_start_seconds: 12, target_end_seconds: 16 }
      ]
    }
  };
  const selected = selectCinematicCandidateShots(plan, story);
  assert.deepEqual(selected.map((entry) => entry.shot_id), ["shot-1", "shot-3"]);
  assert.equal(selected[0].kind, "hook");
  assert.equal(selected[1].kind, "payoff");
  assert.ok(selected[1].reasons.includes("story-proof"));
  assert.ok(selected[1].reasons.includes("story-payoff"));
  assert.equal(selected[1].transition.kind, "shared-world");
});

test("falls back to the closing shot and respects the tournament bound", () => {
  const selected = selectCinematicCandidateShots(fixturePlan(), null, { maxShots: 2 });
  assert.deepEqual(selected.map((entry) => entry.shot_id), ["shot-1", "shot-3"]);
  assert.ok(selected[1].reasons.includes("closing-payoff-frame"));
  assert.deepEqual(selectCinematicCandidateShots(fixturePlan(), null, { maxShots: 1 }).map((entry) => entry.shot_id), ["shot-1"]);
});

test("judges actual rendered candidates and applies deterministic score selection", async () => {
  const workspace = await candidateWorkspace();
  const candidates = await candidateFixtures(workspace);
  let received;
  const client = {
    runStructured: async (request) => {
      received = request;
      return {
        response_id: "judge-1",
        model: "gpt-5.6",
        usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 },
        value: judgment([
          scorecard("candidate-a", 7),
          scorecard("candidate-b", 9)
        ], "candidate-a")
      };
    }
  };
  const result = await judgeRenderedFrameCandidates(workspace, {
    shot: fixturePlan().shots[0],
    candidates,
    trigger: { kind: "hook", reasons: ["opening-hook"] }
  }, {}, { client });
  assert.equal(result.winner.id, "candidate-b");
  assert.equal(result.calls, 1);
  assert.equal(received.reasoningContext, "current_turn");
  assert.equal(received.images.length, 6);
  assert.ok(received.images.every((entry) => entry.detail === "high" && entry.url.startsWith("data:image/png;base64,")));
  const input = JSON.parse(received.input);
  assert.deepEqual(input.candidate_order, ["candidate-a", "candidate-b"]);
  assert.deepEqual(input.rendered_evidence.map((entry) => entry.candidate_id), ["candidate-a", "candidate-b"]);
  const receipt = JSON.parse(await readFile(result.receipt, "utf8"));
  assert.equal(receipt.schema_version, FRAME_CANDIDATE_SELECTION_VERSION);
  assert.equal(receipt.selected_candidate_id, "candidate-b");
  assert.equal(receipt.judge.recommended_id, "candidate-a");
  assert.equal(receipt.method, "fresh-vision-scorecard");
});

test("accepts the sole rendered candidate without inventing a comparison", async () => {
  const workspace = await candidateWorkspace();
  const [candidate] = await candidateFixtures(workspace);
  const result = await judgeRenderedFrameCandidates(workspace, {
    shot: fixturePlan().shots[0], candidates: [candidate], trigger: { kind: "hook" }
  }, {}, { client: { runStructured: async () => { throw new Error("must not run"); } } });
  assert.equal(result.winner.id, "candidate-a");
  assert.equal(result.calls, 0);
  assert.equal(JSON.parse(await readFile(result.receipt, "utf8")).method, "sole-admissible");
});

test("fails closed when the judge omits or invents a candidate", async () => {
  const workspace = await candidateWorkspace();
  const candidates = await candidateFixtures(workspace);
  await assert.rejects(() => judgeRenderedFrameCandidates(workspace, {
    shot: fixturePlan().shots[0], candidates
  }, {}, {
    client: { runStructured: async () => ({ value: judgment([scorecard("candidate-a", 8), scorecard("candidate-c", 9)], "candidate-c") }) }
  }), /must score exactly/);
});

function fixturePlan() {
  const visual = (sequenceId, handoff, inherits = [], hands = []) => ({
    description: "A dimensional proof world",
    representation: "diagram",
    continuity: {
      sequence_id: sequenceId,
      handoff,
      inherits_object_ids: inherits,
      hands_off_object_ids: hands,
      camera_direction: "right",
      motion_blur_px: 12
    }
  });
  return {
    format: { width: 1080, height: 1920 },
    design: { style_dna: { motion_physics: { motion_blur_px: 12 } } },
    shots: [
      { id: "shot-1", start_seconds: 0, end_seconds: 5, purpose: "Stop the scroll", voiceover: "Look", on_screen_text: ["Look"], transition_out: "hard cut", visual: visual("world-a", "cut") },
      { id: "shot-2", start_seconds: 5, end_seconds: 10, purpose: "Build", voiceover: "Build", on_screen_text: ["Build"], transition_out: "continuous canvas handoff", visual: visual("world-b", "continue", [], ["proof"]) },
      { id: "shot-3", start_seconds: 10, end_seconds: 16, purpose: "Prove and resolve", voiceover: "Proof", on_screen_text: ["Proof"], transition_out: "resolve", visual: visual("world-b", "resolve", ["proof"], []) }
    ]
  };
}

async function candidateWorkspace() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-candidate-select-"));
  await mkdir(path.join(workspace, "production", "qa", "candidate-verify", "shot-1"), { recursive: true });
  return workspace;
}

async function candidateFixtures(workspace) {
  const candidates = [];
  for (const [candidateIndex, id] of ["candidate-a", "candidate-b"].entries()) {
    const frames = [];
    for (let frameIndex = 0; frameIndex < 3; frameIndex += 1) {
      const file = path.join("production", "qa", "candidate-verify", "shot-1", `${id}-${frameIndex}.png`);
      await writeFile(path.join(workspace, file), Buffer.from(`png-${candidateIndex}-${frameIndex}`));
      frames.push({ file, foreground_ratio: .2 + candidateIndex * .1, edge_ratio: .1, luma_standard_deviation: 30 });
    }
    candidates.push({
      id,
      response_id: `response-${id}`,
      provider: "openai",
      model: "gpt-5.6",
      bundle: { shot_id: "shot-1" },
      verification: { ok: true, report: path.join(workspace, "production", "qa", "candidate-verify", "shot-1", `${id}.json`), snapshots: "snapshots", frames }
    });
  }
  return candidates;
}

function scorecard(candidateId, value) {
  return {
    candidate_id: candidateId,
    scroll_stop: value,
    promise_or_proof_clarity: value,
    composition: value,
    art_direction_specificity: value,
    depth_and_materiality: value,
    mobile_readability: value,
    temporal_development: value,
    continuity_readiness: value,
    rationale: `${candidateId} rationale`
  };
}

function judgment(scores, recommendedId) {
  return {
    schema_version: FRAME_CANDIDATE_JUDGMENT_VERSION,
    recommended_id: recommendedId,
    scores,
    selection_rationale: "Choose the strongest rendered lifecycle.",
    preserve: ["The dimensional proof object"]
  };
}

// Density and variety (docs/DIRECTION_GUARDRAILS.md §5).
import test from "node:test";
import assert from "node:assert/strict";
import { compositionPromptLines } from "@launchclip/core/composition.mjs";
import { densityGate, varietyGate } from "../src/direction_guardrails.js";

const brand = { colors: { bg: "#101820", primary: "#2a9d8f", accent: "#e9c46a", ink: "#101820", paper: "#f4f1ea" }, fonts: { display: "anton", body: "space-grotesk", meta: "jetbrains-mono" } };
const story = (scenes) => ({ schema: "launchclip.story.v1", lane: "motion", brand, format: { width: 1080, height: 1920, fps: 30, duration: 12 }, cast: { characters: [{ id: "maya" }, { id: "theo" }] }, scenes });
const world = (id, start, end, kind = "office") => ({ id, module: "world", start, end, params: { kind, camera: "still" } });
const bench = (id, start, end, cast, extra = {}) => ({ id, module: "cast-scene", track: 1, start, end, params: { set: "park-bench", cast, ...extra } });
const rect = (id, role, y, height, start, end) => ({ id, role, rect: { x: 80, y, width: 920, height }, start, end });

test("density: a lone card over an empty set, and an empty third, fail past their limits", () => {
  const s = story([world("w", 0, 12)]);
  const lone = densityGate(s, { rects: [rect("quote", "text", 290, 1500, 2, 8)], profile: "shorts" });
  assert.ok(lone.findings.some((finding) => finding.rule === "lone-card" && finding.ids[0] === "quote"), JSON.stringify(lone.findings));
  // The same card with a character in the set below it is fine for the card.
  const together = densityGate(s, { rects: [rect("quote", "text", 290, 560, 2, 8), rect("cast", "media", 900, 900, 0, 12), rect("card", "text", 290, 560, 0, 2), rect("card2", "text", 290, 560, 8, 12)], profile: "shorts" });
  assert.equal(together.status, "passed", JSON.stringify(together.findings));
  const empty = densityGate(s, { rects: [rect("cast", "media", 1200, 600, 0, 12)], profile: "shorts" });
  assert.ok(empty.findings.some((finding) => finding.rule === "empty-region" && /top third/.test(finding.detail)));
  assert.equal(densityGate(s, {}).status, "skipped");
});

test("variety: the same pair on the same bench back to back fails, even over a new world", () => {
  const pair = [{ id: "maya", pose: "sit" }, { id: "theo", pose: "sit" }];
  const repeat = varietyGate(story([world("a", 0, 6, "city-street"), bench("c1", 0, 6, pair), world("b", 6, 12, "park"), bench("c2", 6, 12, [{ id: "theo" }, { id: "maya" }])]));
  assert.equal(repeat.status, "failed");
  assert.match(repeat.findings[0].detail, /c2 repeats c1's shot.*over a new world/);
  // A different action is a different shot.
  const varied = varietyGate(story([world("a", 0, 6, "city-street"), bench("c1", 0, 6, pair), world("b", 6, 12, "park"), bench("c2", 6, 12, [{ id: "maya", pose: "sit", cues: [{ at: 1, action: "look-far" }] }, { id: "theo", pose: "point" }].map((entry) => entry.id === "theo" ? { id: "theo", cues: [{ at: 0.5, action: "point-at", target: "left" }] } : entry))]));
  assert.equal(varied.status, "passed", JSON.stringify(varied.findings));
});

test("the planner gets the composition rules", () => {
  const lines = compositionPromptLines().join("\n");
  assert.match(lines, /never repeat a shot back to back/);
  assert.match(lines, /at most two seated characters in 9:16/);
});

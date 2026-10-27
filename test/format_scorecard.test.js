import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CADENCE_FORMATS } from "../kit/core/cadence.mjs";
import { parseArguments, reportMarkdown } from "../eval/formats.mjs";
import { avSync, captionHygiene, evidenceCoverage, formatScorecard, moduleVariety, motionOnHold, parseFreezes, parseSceneTimes, renderedCadence, scoreBrief } from "../eval/scorecard.mjs";

const briefs = JSON.parse(readFileSync("eval/formats.json", "utf8")).briefs;

test("scorecard: six golden briefs, one per cadence format", () => {
  assert.deepEqual(briefs.map((brief) => brief.format).sort(), [...CADENCE_FORMATS].sort());
  for (const brief of briefs) assert.ok(brief.brief && brief.sample?.kind, brief.id);
  assert.deepEqual(parseArguments(["--formats", "short-form,long-form", "--no-render"]), { render: false, formats: ["short-form", "long-form"] });
  assert.throws(() => parseArguments(["--fast"]), /unknown argument/);
});

test("scorecard: ffmpeg output parses into scene times and freezes", () => {
  const showinfo = "[Parsed_showinfo_1 @ 0x1] n:   0 pts:  90000 pts_time:3.0 duration:3000\n[Parsed_showinfo_1 @ 0x1] n:   1 pts: 150000 pts_time:5.5 duration\n";
  assert.deepEqual(parseSceneTimes(showinfo), [3, 5.5]);
  const freeze = "lavfi.freezedetect.freeze_start: 10\nlavfi.freezedetect.freeze_duration: 2\nlavfi.freezedetect.freeze_end: 12\nlavfi.freezedetect.freeze_start: 50\n";
  assert.deepEqual(parseFreezes(freeze, 60), [[10, 12], [50, 60]]);
  assert.deepEqual(motionOnHold([[10, 12], [50, 60]], 60), { share: 0.8, frozen_seconds: 12, longest_freeze: 10 });
});

test("scorecard: rendered cadence at three thresholds, merged like the reference", () => {
  const every = (step, until) => Array.from({ length: Math.floor(until / step) }, (_, i) => +(step * (i + 1)).toFixed(2));
  const scenes = { 0.04: every(2.5, 60), 0.08: [...every(5, 60), 5.4], 0.15: every(20, 60) };
  const cadence = renderedCadence(scenes, { duration: 60, format: "long-form" });
  assert.equal(cadence.merge_seconds, 1.5);
  assert.equal(cadence.thresholds[0.08].events, 11);
  assert.equal(cadence.thresholds[0.08].gap.p50, 5);
  assert.equal(cadence.thresholds[0.04].gap.p50, 2.5);
  assert.equal(cadence.gate.ok, true);
});

test("scorecard: evidence, variety, captions and sync", () => {
  const story = { scenes: [{ id: "a", module: "stat-card", start: 0, end: 3, params: { source: "Lab, 2026" } }, { id: "b", module: "bar-chart", start: 3, end: 6, params: {} }, { id: "c", module: "concept-card", start: 6, end: 9, params: {} }], overlays: [{ type: "captions" }] };
  assert.deepEqual(evidenceCoverage(story), { claims: 2, sourced: 1, coverage: 0.5 });
  assert.equal(evidenceCoverage({ ...story, frame: { sources: [{ text: "Lab", scene: "b" }] } }).coverage, 1);
  const map = { chapters: [{ shots: [{ states: [{ kind: "stat", intent: "number", evidence: { source: { url: "https://x" } } }, { kind: "concept", intent: "claim" }] }] }] };
  assert.deepEqual(evidenceCoverage(story, { map }), { claims: 1, sourced: 1, coverage: 1 });
  assert.deepEqual(moduleVariety(story), { scenes: 3, modules: 3, distinct_share: 1, top: { id: "stat-card", share: 0.333 }, entropy: 1 });
  const fast = Array.from({ length: 12 }, (_, i) => ({ text: `w${i}`, start: i * 0.2, end: i * 0.2 + 0.15 }));
  assert.match(captionHygiene(story, fast).problems.join(), /peak at 5.5 words/);
  assert.equal(captionHygiene({ overlays: [] }, [], { required: true }).ok, false);
  const sync = avSync([3, 6, 9], [3.05, 6.4, 9.1], { probe: { video_duration: 12, audio: { duration: 12.1 } }, duration: 12 });
  assert.deepEqual(sync, { planned: 3, matched: 2, matched_share: 0.667, offset_ms_p50: 75, audio: { duration_delta_ms: 100 } });
});

test("scorecard: a brief scores pass, warn and fail, and prints a row", () => {
  const brief = briefs.find((entry) => entry.format === "long-form");
  const row = scoreBrief(brief, {
    plan: { ok: true, checks: [] },
    motion: { share: 0.8 },
    evidence: { coverage: 0.9 },
    variety: { distinct_share: 0.2, top: { share: 0.6 } },
    layout: { errors: 0, warnings: 0 },
    captions: { ok: true, required: true, on: true, problems: [] }
  });
  const status = Object.fromEntries(row.checks.map((check) => [check.id, check.status]));
  assert.deepEqual(status, { plan_cadence: "pass", motion_on_hold: "warn", evidence: "pass", variety: "fail", layout: "pass", captions: "pass" });
  assert.equal(row.status, "fail");
  assert.equal(row.score, 75);
  const table = formatScorecard([row]);
  assert.match(table, /long-form\s+75/);
  assert.match(table, /variety 0.2 \(want/);
  assert.match(reportMarkdown({ renderer: null, quality: "draft", finished_at: "now", rows: [row], results: [{ ...brief, score: row, measures: {} }] }), /# Format scorecard/);
});

test("scorecard: per-frame scene scores, thresholds and change peaks", async () => {
  const { parseSceneScores, scenesAbove, changePeaks } = await import("../eval/scorecard.mjs");
  const text = [0, 0.001, 0.002, 0.03, 0.002, 0.001, 0.12, 0.001, 0.002, 0.001].map((score, i) => `[m] frame:${i} pts:${i} pts_time:${i / 10}\n[m] lavfi.scene_score=${score}`).join("\n");
  const scores = parseSceneScores(text);
  assert.equal(scores.length, 10);
  assert.deepEqual(scenesAbove(scores, 0.08), [0.6]);
  assert.deepEqual(scenesAbove(scores, 0.02), [0.3, 0.6]);
  assert.deepEqual(changePeaks(scores), [0.3, 0.6]);
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  VISUAL_HISTORY_INDEX,
  assessVariety,
  checkHistory,
  compareStories,
  fingerprintStory,
  formatHistoryCheck,
  historyAvoid,
  historyPrompt,
  readHistoryIndex,
  recordHistoryEntry,
  structureSimilarity,
  varyStory
} from "../src/visual_history.js";

function story({ headline = "Payouts never match", modules = ["hook-title", "media-window", "cta"], background = null, captions = "word-highlight", cover = null, narration = "Payouts never match your books. Ledgerly matches each one." } = {}) {
  return {
    schema: "launchclip.story.v1",
    title: "Ledgerly",
    lane: "motion",
    format: { width: 1080, height: 1920, fps: 30, duration: 12 },
    brand: { colors: { bg: "#000000", primary: "#ff0000", accent: "#00ff00" } },
    audio: { narration: { text: narration } },
    ...(background ? { background } : {}),
    ...(cover ? { cover } : {}),
    scenes: modules.map((module, index) => ({ id: `s${index + 1}`, module, start: index * 4, end: index * 4 + 4, ...(index ? { in: { type: "fade", dur: 0.3 } } : {}), params: index === 0 ? { headline } : {} })),
    overlays: [{ type: "captions", style: captions }]
  };
}

test("fingerprintStory records the hook, opening, modules, background, captions, palette and cover", () => {
  const fingerprint = fingerprintStory(story({ cover: { text: "Books never match?" }, background: { kind: "mesh", params: { intensity: 0.5 } } }), { project: "/x/a" });
  assert.equal(fingerprint.hook.text, "Payouts never match your books.");
  assert.equal(fingerprint.hook.headline, "Payouts never match");
  assert.deepEqual(fingerprint.opening, { module: "hook-title", headline: "Payouts never match" });
  assert.deepEqual(fingerprint.modules, ["hook-title", "media-window", "cta"]);
  assert.deepEqual(fingerprint.background, { kind: "mesh", color: null });
  assert.equal(fingerprint.captions, "word-highlight");
  assert.equal(fingerprint.aspect, "portrait");
  assert.deepEqual(fingerprint.palette, { bg: "#000000", primary: "#ff0000", accent: "#00ff00" });
  assert.deepEqual(fingerprint.cover, { text: "Books never match?", number: null, kicker: null, frame: "first", file: null });
  // A style pack's background applies when the story sets none.
  assert.equal(fingerprintStory(story(), { style: { background: { kind: "paper" } } }).background.kind, "paper");
  assert.equal(fingerprintStory(story()).background.kind, "default");
});

test("compareStories is 1 for the same video and low for a different one; structure uses the longest common subsequence", () => {
  const a = fingerprintStory(story());
  assert.equal(compareStories(a, a), 1);
  const b = fingerprintStory(story({ headline: "Close the month in minutes", narration: "Month end takes a week. Not any more.", modules: ["stat-card", "process-steps", "media-window", "logo-lockup", "cta"], background: { kind: "topographic" }, captions: "pop-word" }));
  assert.ok(compareStories(a, b) < 0.4, String(compareStories(a, b)));
  assert.equal(structureSimilarity(["a", "b", "c"], ["a", "x", "b", "c"]), 0.75);
  assert.equal(structureSimilarity([], ["a"]), 0);
});

test("the index records entries newest first and replaces a project's earlier entry", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-history-"));
  try {
    assert.deepEqual((await readHistoryIndex(dir)).entries, []);
    await recordHistoryEntry(dir, fingerprintStory(story(), { project: "/p/one" }), { clock: () => "2026-01-01T00:00:00Z" });
    await recordHistoryEntry(dir, fingerprintStory(story({ headline: "Second" }), { project: "/p/two" }), { clock: () => "2026-01-02T00:00:00Z" });
    await recordHistoryEntry(dir, fingerprintStory(story({ headline: "One again" }), { project: "/p/one" }), { clock: () => "2026-01-03T00:00:00Z" });
    const index = await readHistoryIndex(dir);
    assert.deepEqual(index.entries.map((entry) => [entry.project, entry.hook.headline]), [["/p/one", "One again"], ["/p/two", "Second"]]);
    assert.ok(index.entries[0].id);
    const raw = JSON.parse(await readFile(path.join(dir, VISUAL_HISTORY_INDEX), "utf8"));
    assert.equal(raw.schema_version, "launchclip.visual-history.v1");
    await writeFile(path.join(dir, VISUAL_HISTORY_INDEX), JSON.stringify({ schema_version: "other.v1", entries: [] }));
    await assert.rejects(readHistoryIndex(dir), /expected launchclip\.visual-history\.v1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("historyAvoid and historyPrompt list recent choices, leaving out the project's own entry", () => {
  const entries = [
    { ...fingerprintStory(story({ background: { kind: "mesh" } }), { project: "/p/a" }), recorded_at: "2026-01-02" },
    { ...fingerprintStory(story({ captions: "pop-word" }), { project: "/p/b" }), recorded_at: "2026-01-01" }
  ];
  const avoid = historyAvoid(entries, { project: "/p/b" });
  assert.equal(avoid.total, 1);
  assert.deepEqual(avoid.dials, { background: ["mesh"], captions: ["word-highlight"], opening: ["hook-title"] });
  const prompt = historyPrompt(avoid);
  assert.match(prompt, /series of 1 earlier video/);
  assert.match(prompt, /hook "Payouts never match your books\."; opens on hook-title; modules hook-title → media-window → cta; background mesh; captions word-highlight/);
  assert.equal(historyPrompt(historyAvoid([])), null);
});

test("varyStory moves a repeated background and caption preset deterministically, and leaves locked dials alone", () => {
  const entries = [{ ...fingerprintStory(story()), recorded_at: "2026-01-01" }];
  const avoid = historyAvoid(entries);
  const first = story();
  const { changes } = varyStory(first, avoid, { seed: "ledgerly" });
  assert.deepEqual(changes.map((change) => [change.dial, change.from]), [["background", "default"], ["captions", "word-highlight"]]);
  assert.notEqual(first.background.kind, "default");
  assert.notEqual(first.overlays[0].style, "word-highlight");
  const second = story();
  varyStory(second, avoid, { seed: "ledgerly" });
  assert.deepEqual([second.background, second.overlays], [first.background, first.overlays], "the same seed picks the same values");
  const locked = story();
  assert.deepEqual(varyStory(locked, avoid, { seed: "ledgerly", locked: { background: true, captions: true } }).changes, []);
  const fresh = story({ background: { kind: "halftone" }, captions: "glow" });
  assert.deepEqual(varyStory(fresh, avoid).changes, [], "nothing repeats, nothing moves");
  assert.deepEqual(varyStory(story(), historyAvoid([])).changes, [], "no history, no changes");
});

test("assessVariety flags a near-duplicate, weights recent entries more, and flags a repeated hook", () => {
  const same = fingerprintStory(story());
  const recent = [{ ...same, project: "/p/a", recorded_at: "2026-02-01" }];
  const result = assessVariety(same, recent);
  assert.equal(result.passes, false);
  assert.match(result.findings[0], /too close to a/);
  assert.equal(result.nearest.similarity, 1);
  // The same near-duplicate 40 videos back weighs less than one last week.
  const filler = Array.from({ length: 40 }, (_, index) => ({ ...fingerprintStory(story({ headline: `Other ${index}`, narration: `Different words ${index}.`, modules: ["stat-card", "process-steps"], background: { kind: "mesh" }, captions: "glow" })), project: `/p/f${index}`, recorded_at: `2026-03-${String(index + 1).padStart(2, "0")}` }));
  const old = assessVariety(same, [...recent, ...filler]);
  const nearOld = old.compared.find((entry) => entry.project === "/p/a");
  assert.ok(nearOld.weighted < result.nearest.weighted, `${nearOld.weighted} < ${result.nearest.weighted}`);
  const different = fingerprintStory(story({ headline: "Close the month in minutes", narration: "Month end takes a week.", modules: ["stat-card", "process-steps", "cta"], background: { kind: "topographic" }, captions: "pop-word" }));
  assert.equal(assessVariety(different, recent).passes, true);
  assert.equal(assessVariety(same, recent, { project: "/p/a" }).entries, 0, "a project's own entry is not compared");
});

test("checkHistory flags a near-duplicate pair across the index and scanned projects", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-history-check-"));
  try {
    await recordHistoryEntry(dir, fingerprintStory(story({ headline: "Close the month in minutes", narration: "Month end takes a week. Not any more.", modules: ["stat-card", "process-steps", "media-window", "cta"], background: { kind: "mesh" } }), { project: path.join(dir, "indexed") }));
    for (const [name, headline, narration] of [["one", "Payouts never match", "Payouts never match your books. Ledgerly fixes it."], ["two", "Payouts never match!", "Your payouts never match your books. Ledgerly fixes that."]]) {
      await mkdir(path.join(dir, name));
      await writeFile(path.join(dir, name, "storyboard.json"), JSON.stringify(story({ headline, narration: null })));
      await writeFile(path.join(dir, name, "SCRIPT.json"), JSON.stringify({ narration }));
    }
    const report = await checkHistory(dir);
    assert.equal(report.videos, 3);
    assert.equal(report.from_index, 1);
    assert.equal(report.scanned, 2);
    assert.equal(report.ok, false);
    assert.equal(report.flagged.length, 1);
    assert.deepEqual([report.flagged[0].a, report.flagged[0].b].sort(), ["one (Ledgerly)", "two (Ledgerly)"]);
    assert.match(report.flagged[0].reasons.join("; "), /hooks .* alike/);
    assert.match(report.flagged[0].reasons.join("; "), /structure 1 alike/);
    assert.match(formatHistoryCheck(report), /1 pair too close\n- (one|two) \(Ledgerly\) ↔ (one|two) \(Ledgerly\): hooks/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

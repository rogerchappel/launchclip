// A brand whose captions sit in the middle of the frame, through make's
// storyboard stage. From a production run that failed: the style set the
// captions to kinetic-hierarchy, three words a line, position "middle",
// size 1.15, on 1080×1920; the plan missed a cadence band on every attempt
// and was kept as the closest one, its layout never checked; and the stage
// then failed with one finding per card, such as
//
//   layout: caption-band @0.25s [overhead-setup-text, captions]
//   overhead-setup-text sits in the caption band 65,845 853×230 while
//   captions are visible (0.25s–2.728s); move it or set hidesCaptions
//
// under "the storyboard failed its checks after make filled in audio".
//
// The stage then passed by hiding the captions under each card, and a
// delivered video had none for most of its narration. Now the card moves out
// of the band (or the captions move for that scene) and they stay on.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { STYLE_SCHEMA } from "@launchclip/core/style.mjs";
import { checkStoryboard } from "../src/storyboard_planner.js";
import { recordedRun } from "./helpers/make_recorded_run.js";

const SHORT_MOTION = JSON.parse(await readFile(new URL("../kit/profiles/short-motion.json", import.meta.url), "utf8"));
// The narration the recorded script returns, word by word: the map's lines index into it.
const MAP = {
  schema: "launchclip.direction-map.v1",
  profile: "tight",
  sections: [{ id: "a", title: "Payouts", lines: [
    { words: [0, 4], intent: "hook", treatment: "insert", scenes: ["s1"] },
    { words: [5, 11], intent: "claim", treatment: "insert", scenes: ["s2"] },
    { words: [12, 14], intent: "cta", treatment: "insert", scenes: ["s3"] }
  ] }]
};

async function brandRun({ position = "middle", size = 1.15 } = {}) {
  // The direction call answers with a map, as the production model did: with a drafted one the bands only warn.
  const fixture = await recordedRun({ screenshots: [], direction: MAP });
  const style = path.join(fixture.cwd, "brand-look.json");
  await writeFile(style, JSON.stringify({ schema: STYLE_SCHEMA, name: "brand-look", captions: { preset: "kinetic-hierarchy", max_words: 3, position, size } }));
  // A profile the recorded plan cannot land inside, so every attempt misses its coverage band.
  const profile = path.join(fixture.cwd, "tight.json");
  await writeFile(profile, JSON.stringify({ ...SHORT_MOTION, id: "tight", measures: { coverage: { p10: 0.2, p50: 0.4, p90: 0.5 } } }));
  return { fixture, options: { style, profile, aspect: "9:16", critic: false, candidates: "off", maxRepairs: 1 } };
}

for (const [position, size] of [["middle", 1.15], ["middle", 1.4], ["top", 1.15], ["low", 1.15], ["auto", 1.4]]) {
  test(`make: captions ${position} at size ${size} pass the storyboard stage, and what tooling adjusted is in the warnings`, async () => {
    const { fixture, options } = await brandRun({ position, size });
    try {
      const { report } = await fixture.run(options);
      assert.equal(report.stages.storyboard.status, "done", `${report.stages.storyboard.reason ?? ""}\n${report.warnings.join("\n")}`);
      assert.notEqual(report.status, "failed");
      const story = JSON.parse(await readFile(path.join(fixture.project, "storyboard.json"), "utf8"));
      const captions = story.overlays.find((overlay) => overlay.type === "captions");
      const hid = report.warnings.filter((line) => line.startsWith("layout: tooling hid captions"));
      assert.equal(Boolean(captions.hide?.length), hid.length > 0, "every hidden range is reported");
      assert.deepEqual(hid, [], "nothing is hidden: the card moves out of the band, or the captions move for that scene");
      if (position === "middle") {
        assert.ok(report.warnings.some((line) => /^layout: tooling cleared the caption band: .*s3 \(/.test(line)), report.warnings.join("\n"));
        assert.deepEqual(story.scenes.find((scene) => scene.id === "s3").fitted, ["rect"]);
        assert.ok(report.warnings.some((line) => /kept the storyboard closest to the profile/.test(line)) || report.repairs.attempts.some((attempt) => attempt.errors.some((line) => line.startsWith("cadence: "))), "the plan is the kept near miss of the production run");
      }
      const pack = JSON.parse(await readFile(options.style, "utf8"));
      const again = checkStoryboard(story, { words: JSON.parse(await readFile(path.join(fixture.project, "NARRATION.json"), "utf8")).words, tier: "structured", style: pack, bandErrors: false });
      assert.deepEqual(again.errors.filter((line) => line.includes("caption-band")), []);
    } finally {
      await fixture.cleanup();
    }
  });
}

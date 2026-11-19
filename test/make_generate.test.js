// make --generate: the footage generator answers the plan's shot requests,
// quoted against --budget (headless), logged in the ledger and summed into MAKE.json's costs.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readLedger } from "../src/generate/ledger.js";
import { recordedRun } from "./helpers/make_recorded_run.js";

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "parity", "assets");
const shotBoard = (board) => ({ ...board, scenes: board.scenes.map((scene, index) => (index === 0 ? { ...scene, params: { ...scene.params, media: { kind: "shot", shows: "a timber deck with an outdoor dining table, seen from above" } } } : scene)) });

// A generate command: a fixed price, the fixture still for a keyframe and the fixture clip for a video.
const COMMAND = `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, op, step } = JSON.parse(line);
  const file = step === "video" ? ${JSON.stringify(path.join(ASSETS, "shots", "blocks-static.mp4"))} : ${JSON.stringify(path.join(ASSETS, "testsrc.png"))};
  console.log(JSON.stringify(op === "quote" ? { id, amount: 0.25, unit: "usd" } : { id, file, model: "test-" + step, licence: "test fixture" }));
});`;

test("make --generate cmd:… --budget: the shot is generated, logged and costed", async () => {
  const fixture = await recordedRun({ screenshots: [], board: shotBoard });
  try {
    const script = path.join(fixture.cwd, "gen.mjs");
    await writeFile(script, COMMAND);
    const { report, lines } = await fixture.run({ critic: false, candidates: "off", generate: `cmd:${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`, budget: "2usd" });
    assert.notEqual(report.status, "failed", JSON.stringify(report.stages[report.failed_stage]));
    const shot = report.shots[0];
    assert.equal(shot.source.generated, true);
    assert.equal(shot.source.made_with, "cmd:test-image → cmd:test-video");
    assert.equal(shot.kind, "video");
    assert.ok(report.generate.quotes[0].totals.usd > 0);
    assert.ok(lines.some((line) => /generate: quote: 1 shot\(s\), 0\.5 usd; within the budget/.test(line)), lines.join("\n"));
    // The recorded model takes images, so the keyframe goes to it; it has no answer for the check, so the keyframe is kept unchecked.
    assert.ok(lines.some((line) => /the keyframe check failed .*accepted unchecked/.test(line)));
    const ledger = await readLedger(fixture.project);
    assert.deepEqual(ledger.map((entry) => [entry.step, entry.verdict]), [["image", "accepted"], ["video", "accepted"]]);
    const costs = report.costs.items.filter((item) => item.stage === "generate");
    assert.equal(costs.length, 2);
    assert.ok(costs.every((item) => item.estimated_usd === 0.25));
  } finally {
    await fixture.cleanup();
  }
});

test("make --generate with no budget and nobody to ask generates nothing", async () => {
  const fixture = await recordedRun({ screenshots: [], board: shotBoard });
  try {
    const script = path.join(fixture.cwd, "gen.mjs");
    await writeFile(script, COMMAND);
    const { report } = await fixture.run({ critic: false, candidates: "off", generate: `cmd:${JSON.stringify(process.execPath)} ${JSON.stringify(script)}` });
    assert.ok(report.warnings.some((line) => /generate: quote: .*refused: generating without a person to ask needs --budget/.test(line)), report.warnings.join("\n"));
    assert.deepEqual(await readLedger(fixture.project), []);
  } finally {
    await fixture.cleanup();
  }
});

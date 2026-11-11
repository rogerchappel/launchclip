// The script's own model (make --script-model, LAUNCHCLIP_SCRIPT_MODEL): the script stage's calls go to it, every other stage keeps the run's model.
import assert from "node:assert/strict";
import test from "node:test";
import { makeOptionsFromFlags, validateMakeOptions } from "../src/make/options.js";
import { scriptModelSpec } from "../src/make/models.js";
import { recordedRun } from "./helpers/make_recorded_run.js";

test("--script-model, else LAUNCHCLIP_SCRIPT_MODEL, else the run's model", () => {
  assert.equal(scriptModelSpec("openrouter:google/gemini-4-carbon@low", { LAUNCHCLIP_SCRIPT_MODEL: "openai:x" }), "openrouter:google/gemini-4-carbon@low");
  assert.equal(scriptModelSpec(undefined, { LAUNCHCLIP_SCRIPT_MODEL: " openai:gpt-6.1-terra " }), "openai:gpt-6.1-terra");
  assert.equal(scriptModelSpec(undefined, {}), null);
  assert.equal(makeOptionsFromFlags({ "script-model": "openrouter:google/gemini-4-carbon@low" }).scriptModel, "openrouter:google/gemini-4-carbon@low");
  assert.throws(() => validateMakeOptions({ scriptModel: "gemini" }), /--script-model must be provider:model/);
  assert.throws(() => validateMakeOptions({ scriptModel: true }), /--script-model must be provider:model/);
});

test("the script stage's calls go to the script model; the storyboard stays on the run's model", async () => {
  const fixture = await recordedRun({ screenshots: [] });
  try {
    const written = [];
    const scriptClient = { provider: "openrouter", model: "a-fast-writer", client: { provider: "openrouter", model: "a-fast-writer", runStructured: (request) => { written.push(request.schemaName); return fixture.model.client.runStructured(request); } } };
    const { report, calls } = await fixture.run({ critic: false, candidates: "off" }, { adapters: { scriptClient } });
    assert.equal(report.stages.storyboard.status, "done", JSON.stringify(report.stages));
    // The writers' room and the script went to the script model, and nothing else did.
    assert.ok(written.includes("launchclip_make_script"), written.join(", "));
    assert.ok(written.some((name) => name.startsWith("launchclip_cinematic_")), "the concepts and the story are part of the script");
    assert.ok(!written.some((name) => /storyboard|direction/.test(name)), written.join(", "));
    // The fixture's client sees every call (the script model's are passed on to it): the ones it was asked directly are the planner's.
    const direct = [...calls];
    for (const name of written) direct.splice(direct.indexOf(name), 1);
    assert.ok(direct.includes("launchclip_storyboard"));
    assert.ok(!direct.some((name) => name === "launchclip_make_script" || name.startsWith("launchclip_cinematic_")), direct.join(", "));
    // The report names both, and the script's cost is the script model's.
    assert.deepEqual([report.script_model.provider, report.script_model.model, report.script_model.source], ["openrouter", "a-fast-writer", "adapter"]);
    assert.notEqual(report.model.model, "a-fast-writer");
    assert.equal(report.costs.items.find((item) => item.stage === "script").provider, "openrouter");
    assert.notEqual(report.costs.items.find((item) => item.stage.startsWith("storyboard")).provider, "openrouter");
  } finally { await fixture.cleanup(); }
});

test("with no script model the run's model writes the script, as before", async () => {
  const fixture = await recordedRun({ screenshots: [] });
  try {
    const { report, calls } = await fixture.run({ critic: false, candidates: "off" });
    assert.equal(report.script_model, undefined);
    assert.ok(calls.includes("launchclip_storyboard"), calls.join(", "));
    assert.ok(calls.some((name) => /script/.test(name)), calls.join(", "));
  } finally { await fixture.cleanup(); }
});

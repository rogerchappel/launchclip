// make --comps (docs/VIDEO_TELLS_RFC.md §3): three structural comps of the hook, one pick, recorded in MAKE.json.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CANDIDATE_SCORE_FIELDS } from "../src/make/candidates.js";
import { COMP_SHAPES, compChoice, compNote, compsWanted, sameComp } from "../src/make/comps.js";
import { runMake } from "../src/make/index.js";
import { makeOptionsFromFlags, validateMakeOptions } from "../src/make/options.js";
import { makeExitCode } from "../src/cli.js";
import { PROMPT, assetsDir, fakeFinish, fakeInventory, fakeModel } from "./helpers/make_fakes.js";

const usage = { input_tokens: 2000, output_tokens: 400, total_tokens: 2400 };
const scores = (value) => Object.fromEntries(CANDIDATE_SCORE_FIELDS.map((field) => [field, value]));
const TITLES = ["Every payout, matched", "Three payouts, one ledger"];

// The fake model, plus the comp designs (a different card each call) and the judge (comp-3 wins).
function compsModel({ vision = true } = {}) {
  const fake = fakeModel({ vision });
  const inner = fake.model.client.runStructured.bind(fake.model.client);
  const designs = [];
  const judged = [];
  fake.model.client.runStructured = async (request) => {
    if (request.schemaName === "launchclip_make_opening_candidate") {
      designs.push(request);
      return { model: "gpt-5.6-luna", usage, value: { module: "media-window", params_json: JSON.stringify({ title: TITLES[(designs.length - 1) % 2], media: { kind: "video", src: "assets/ui.mp4" } }), why: `design ${designs.length}` } };
    }
    if (request.schemaName === "launchclip_make_candidate_judgment") {
      judged.push(request);
      return { model: "gpt-5.6-luna", usage, value: { rationale: "comp-3 leads with the proof.", candidates: ["comp-1", "comp-2", "comp-3"].map((id) => ({ id, admissible: true, weakness: "", scores: scores(id === "comp-3" ? 8 : 6) })) } };
    }
    return inner(request);
  };
  return { ...fake, designs, judged };
}

async function make(t, model, extra = {}) {
  const assets = await assetsDir();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-comps-"));
  t.after(() => Promise.all([rm(assets, { recursive: true, force: true }), rm(cwd, { recursive: true, force: true })]));
  const stills = [];
  const still = async (story, at, out, { dir }) => { stills.push({ dir: path.basename(dir), at, opening: story.scenes[0].module }); await mkdir(path.dirname(out), { recursive: true }); await writeFile(out, `${path.basename(dir)}@${at}`); };
  const critic = async () => ({ status: "written", verdict: "ship", findings: 0, reviewed: 1, unreviewed: 0, warnings: [], model: "gpt-5.6-luna", critique: { verdict: "ship", summary: "", findings: [] } });
  const project = path.join(cwd, "video");
  const run = (options = {}, adapters = {}) => runMake(PROMPT, { assets, voice: "test", music: "synth", concepts: "off", candidates: "off", cwd, out: "video", ...options }, { env: {}, client: model, inventory: fakeInventory, finish: fakeFinish([]), critic, candidateStill: still, notice() {}, ...extra, ...adapters });
  const story = async () => JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
  return { run, stills, project, story };
}

test("headless --comps makes three comps of the hook, one still each, and the judge's pick is recorded as delegated", async (t) => {
  const fake = compsModel();
  const { run, stills, project, story } = await make(t, fake.model);
  const report = await run({ comps: true });
  assert.notEqual(report.status, "failed", JSON.stringify(report.stages));
  assert.equal(report.stages.comps.status, "done", JSON.stringify(report.comps));
  assert.deepEqual(report.comps.comps.map((comp) => comp.id), ["comp-1", "comp-2", "comp-3"]);
  assert.deepEqual(stills.map((still) => still.dir), ["comp-1", "comp-2", "comp-3"]);
  assert.equal(new Set(stills.map((still) => still.at)).size, 1, "every comp is caught at the same moment of the hook");
  for (const comp of report.comps.comps) assert.ok(existsSync(path.join(project, comp.still)) && existsSync(path.join(project, comp.storyboard)), comp.id);
  // The second design is told the first and its shape; the judge sees one still per comp.
  assert.match(fake.designs[1].input, /Structural comp 3 of 3[\s\S]*Density: dense[\s\S]*- comp-2: media-window \(design 1\)/);
  assert.equal(fake.judged[0].images.length, 3);
  assert.deepEqual({ id: report.comps.picked.id, by: report.comps.picked.by, delegated: report.comps.picked.delegated, still: report.comps.picked.still }, { id: "comp-3", by: "critic", delegated: true, still: "comps/comp-3/still.png" });
  assert.equal((await story()).scenes[0].params.title, TITLES[1], "the picked comp's storyboard is the one rendered");
  const written = JSON.parse(await readFile(path.join(project, "MAKE.json"), "utf8"));
  assert.equal(written.comps.picked.id, "comp-3");
  assert.ok(report.costs.items.some((item) => item.stage === "comps-judge"));
});

test("an attended run stops for the pick, and --comp 2 keeps that comp without designing again", async (t) => {
  const fake = compsModel();
  const { run, story } = await make(t, fake.model);
  const first = await run({ comps: true }, { ask: async () => true });
  assert.equal(first.status, "awaiting-approval");
  assert.equal(first.stopped.after, "comps");
  assert.equal(makeExitCode(first), 3);
  assert.equal(first.comps.picked, null);
  assert.equal(first.stages.finish.status, "skipped");
  assert.match(first.next_steps.join("\n"), /--comp N/);
  const designs = fake.designs.length;
  const second = await run({ comps: true, comp: 2 });
  assert.notEqual(second.status, "failed", JSON.stringify(second.stages));
  assert.equal(fake.designs.length, designs, "the comps of the storyboard are reused");
  assert.deepEqual({ id: second.comps.picked.id, by: second.comps.picked.by, delegated: second.comps.picked.delegated }, { id: "comp-2", by: "user", delegated: false });
  assert.equal((await story()).scenes[0].params.title, TITLES[0]);
  assert.equal(fake.judged.length, 0, "nobody else picks when you do");
});

test("without a model that can see, a headless run keeps the planner's hook and says so", async (t) => {
  const fake = compsModel({ vision: false });
  const { run } = await make(t, fake.model);
  const report = await run({ comps: true });
  assert.deepEqual({ id: report.comps.picked.id, by: report.comps.picked.by }, { id: "comp-1", by: "default" });
  assert.ok(report.warnings.some((warning) => /comps: nobody could pick/.test(warning)));
});

test("the comps flags and their pure parts", () => {
  assert.deepEqual(makeOptionsFromFlags({ comps: true, comp: "2" }).comps, true);
  assert.equal(makeOptionsFromFlags({ comp: "2" }).comp, "2");
  assert.equal(makeOptionsFromFlags({}).comps, undefined);
  assert.throws(() => validateMakeOptions({ comp: "4" }), /--comp must be a whole number from 1 to 3/);
  assert.equal(compChoice("3"), "comp-3");
  assert.equal(compChoice(undefined), null);
  assert.equal(compsWanted({ comp: 1 }), true);
  assert.equal(compsWanted({}), false);
  assert.match(compNote(COMP_SHAPES[0], [{ id: "comp-1", module: "callout", why: "" }]), /Structural comp 2 of 3[\s\S]*- comp-1: callout$/);
  assert.equal(sameComp({ module: "callout", params: { a: 1 } }, [{ module: "callout", params: { a: 1 } }]), true);
  assert.equal(sameComp({ module: "callout", params: { a: 2 } }, [{ module: "callout", params: { a: 1 } }]), false);
});

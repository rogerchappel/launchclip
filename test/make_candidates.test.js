// Rendered candidates for the opening and one risky transition (docs/MAKE_SKILL_PARITY.md, phase 6).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateRenderedCandidateReceipt } from "../src/cinematic_evidence.js";
import { CANDIDATE_SCORE_FIELDS, alternativeTransition, candidatesMode, comparisonEntry, designOpening, judgeCandidates, meanScore, openingScene, renderCandidate, riskyBoundary, sceneTimes, selectCandidate, storyWith, transitionTimes, writeReceipt } from "../src/make/candidates.js";
import { runMake } from "../src/make/index.js";
import { PROMPT, assetsDir, fakeFinish, fakeInventory, fakeModel } from "./helpers/make_fakes.js";

const usage = { input_tokens: 2000, output_tokens: 400, total_tokens: 2400 };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
// A still stand-in: a PNG whose bytes name the candidate and the time, so every frame is its own file.
const fakeStill = (calls = []) => async (story, at, out, { dir }) => { calls.push({ dir: path.basename(dir), at, opening: story.scenes[0].module, second: story.scenes[1]?.in?.type ?? null }); await mkdir(path.dirname(out), { recursive: true }); await writeFile(out, Buffer.concat([PNG, Buffer.from(`${path.basename(dir)}@${at}`)])); };
const scores = (value) => Object.fromEntries(CANDIDATE_SCORE_FIELDS.map((field) => [field, value]));
const scene = (id, start, end, extra = {}) => ({ id, module: "callout", start, end, params: { title: id }, ...extra });

test("the opening is the first base scene, and the risky boundary is the hardest move in the opening stretch", () => {
  const story = { format: { duration: 60 }, camera: { mode: "world" }, scenes: [
    scene("over", 0, 2, { track: 1 }), scene("s1", 0, 4), scene("s2", 4, 9, { in: { type: "fade", dur: 0.6 } }), scene("s3", 9, 14, { in: { type: "whip-pan", dur: 0.4 } }), scene("s4", 14, 20, { in: { type: "cut" } }), scene("late", 40, 50, { in: { type: "orbit", dur: 0.8 } })
  ] };
  assert.equal(openingScene(story).id, "s1");
  const risky = riskyBoundary(story);
  assert.deepEqual({ id: risky.scene.id, boundary: risky.boundary_id, at: risky.at, risk: risky.risk }, { id: "s3", boundary: "s3-in", at: 9, risk: 3 }, "a camera move beats a longer fade; a move past 30 s is not in the opening stretch");
  assert.equal(riskyBoundary({ ...story, camera: { mode: "cuts" }, scenes: story.scenes.filter((entry) => entry.id !== "s3") }).scene.id, "s2", "with no camera move, the longest transition");
  assert.equal(riskyBoundary({ format: { duration: 5 }, scenes: [scene("only", 0, 5)] }), null);
  assert.deepEqual(alternativeTransition(story.scenes[2], story), { type: "push", dur: 0.6 });
  assert.deepEqual(alternativeTransition(scene("x", 4, 9, { in: { type: "push", dur: 0.5 } }), story), { type: "whip-pan", dur: 0.5 });
  assert.deepEqual(alternativeTransition(scene("x", 4, 9), { camera: { mode: "cuts" } }), { type: "push-blur", dur: 0.5 }, "a cut gets a move with a default length");
  assert.deepEqual(sceneTimes(story.scenes[1]), [0.6, 2, 3.6]);
  assert.deepEqual(transitionTimes(story.scenes[2], { dur: 0.6 }, 60), [4.12, 4.3, 4.48], "all three inside the move, where two candidates differ");
  assert.deepEqual(transitionTimes(scene("end", 9.8, 10), { dur: 0.6 }, 10), [9.92, 9.95, 9.95], "times stay inside the scene and the video");
  assert.equal(candidatesMode(undefined), "on");
  assert.equal(candidatesMode("off"), "off");
  assert.throws(() => candidatesMode("two"), /--candidates must be on or off/);
});

test("a candidate changes one scene: a new card drops the old card's states, a new move keeps the card", () => {
  const story = { scenes: [scene("s1", 0, 4, { states: [{ at: 2 }], zooms: [{}] }), scene("s2", 4, 9, { in: { type: "fade", dur: 0.3 } })] };
  const card = storyWith(story, "s1", { module: "stat-card", params: { value: "9" } });
  assert.deepEqual(card.scenes[0], { id: "s1", module: "stat-card", start: 0, end: 4, params: { value: "9" } });
  assert.equal(story.scenes[0].module, "callout", "the story it was made from is untouched");
  assert.deepEqual(storyWith(story, "s2", { in: { type: "push", dur: 0.3 } }).scenes[1].in, { type: "push", dur: 0.3 });
  assert.throws(() => storyWith(story, "nope", { in: {} }), /no scene nope/);
});

test("the winner is the highest mean among admissible candidates, ties to the first in order", () => {
  const judged = new Map([["a", { admissible: true, weakness: "", scores: scores(7) }], ["b", { admissible: true, weakness: "flat", scores: scores(7) }]]);
  assert.equal(meanScore(scores(7)), 7);
  assert.equal(selectCandidate(["a", "b"], judged), "a");
  judged.get("b").scores.scroll_stop = 9;
  assert.equal(selectCandidate(["a", "b"], judged), "b");
  judged.get("b").admissible = false;
  assert.equal(selectCandidate(["a", "b"], judged), "a", "an inadmissible candidate cannot win");
  judged.get("a").admissible = false;
  assert.equal(selectCandidate(["a", "b"], judged), null);
});

test("a second opening must be a real card: no title card, no unknown module, no made-up file", async () => {
  const answer = (value) => ({ provider: "openai", async runStructured() { return { model: "gpt-5.6-luna", usage, value }; } });
  const base = { prompt: "A video", line: "Payouts never match.", seconds: 3, format: { width: 1920, height: 1080 }, assets: [{ src: "assets/ui.mp4", line: "assets/ui.mp4 — video" }] };
  const good = await designOpening({ ...base, client: answer({ module: "media-window", params_json: JSON.stringify({ title: "Payouts", media: { kind: "video", src: "assets/ui.mp4" } }), why: "The product itself." }) });
  assert.equal(good.module, "media-window");
  assert.equal(typeof good.cost.cost_usd, "number");
  await assert.rejects(designOpening({ ...base, client: answer({ module: "motion-title", params_json: "{}", why: "" }) }), /is a title card \(motion-title\)/);
  await assert.rejects(designOpening({ ...base, client: answer({ module: "no-such-thing", params_json: "{}", why: "" }) }), /unknown module/);
  await assert.rejects(designOpening({ ...base, client: answer({ module: "media-window", params_json: JSON.stringify({ media: { src: "assets/made-up.png" } }), why: "" }) }), (error) => /a file the video does not have/.test(error.message) && typeof error.cost.cost_usd === "number");
  await assert.rejects(designOpening({ ...base, client: answer({ module: "media-window", params_json: "not json", why: "" }) }), /not a JSON object/);
});

test("rendered and judged candidates make a receipt cinematic-check accepts", async (t) => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-candidates-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const story = { scenes: [scene("s1", 0, 4), scene("s2", 4, 9, { in: { type: "fade", dur: 0.3 } })] };
  const render = (id) => renderCandidate({ project, id, story, times: [0.6, 2, 3.6], fps: 30, still: fakeStill() });
  const [openA, openB, transA, transB] = [await render("open-a"), await render("open-b"), await render("trans-a"), await render("trans-b")];
  assert.deepEqual(openA.frames, ["qa/rendered-candidates/open-a/frame-0018.png", "qa/rendered-candidates/open-a/frame-0060.png", "qa/rendered-candidates/open-a/frame-0108.png"]);
  assert.notEqual(openA.render_id, openB.render_id);
  // The judge sees every frame as an image, and only ids, never which candidate was the planner's.
  const requests = [];
  const client = { provider: "openai", async runStructured(request) { requests.push(request); return { model: "gpt-5.6-luna", usage, value: { rationale: "B shows the product sooner.", candidates: [{ id: "open-a", admissible: true, weakness: "The product arrives late.", scores: scores(6) }, { id: "open-b", admissible: true, weakness: "", scores: scores(8) }] } }; } };
  const judged = await judgeCandidates({ client, kind: "opening", candidates: [openA, openB], project, context: "The opening line is: Payouts never match." });
  assert.equal(requests[0].images.length, 6);
  assert.match(requests[0].images[0].url, /^data:image\/png;base64,/);
  assert.match(requests[0].input, /Candidate open-a: images 1 to 3[\s\S]*Candidate open-b: images 4 to 6/);
  assert.ok(!/planner/i.test(requests[0].input + requests[0].instructions));
  const opening = comparisonEntry({ id: "opening", kind: "opening", candidates: [{ ...openA, source: "the planner's opening" }, { ...openB, source: "a separately designed opening" }], judged: judged.scores, selected: selectCandidate(["open-a", "open-b"], judged.scores), rationale: judged.rationale });
  assert.equal(opening.selected_candidate_id, "open-b");
  assert.equal(opening.candidates[0].rejection_reason, "The product arrives late.");
  const flat = new Map([["trans-a", { admissible: true, weakness: "", scores: scores(7) }], ["trans-b", { admissible: true, weakness: "", scores: scores(5) }]]);
  const transition = comparisonEntry({ id: "transition-s2", kind: "transition", boundary: "s2-in", candidates: [{ ...transA, source: "fade" }, { ...transB, source: "push" }], judged: flat, selected: "trans-a", rationale: "" });
  assert.equal(transition.candidates[1].rejection_reason, "scored 5 against 7", "a loser with no stated weakness still says why it lost");
  assert.match(transition.selection_rationale, /Highest mean score/);
  const receipt = await writeReceipt(project, [opening, transition], { boundaryIds: ["s2-in"] });
  assert.deepEqual(receipt, { file: "qa/rendered-candidates.json", ok: true, errors: [] });
  const written = JSON.parse(await readFile(path.join(project, "qa/rendered-candidates.json"), "utf8"));
  assert.equal((await validateRenderedCandidateReceipt(project, written, { boundaryIds: ["s2-in"] })).candidate_count, 4);
  // A judge that leaves a candidate out, or scores out of range, is refused.
  const partial = { provider: "openai", async runStructured() { return { model: "gpt-5.6-luna", usage, value: { rationale: "", candidates: [{ id: "open-a", admissible: true, weakness: "", scores: { ...scores(6), crisp_settle: 14 } }] } }; } };
  await assert.rejects(judgeCandidates({ client: partial, kind: "opening", candidates: [openA, openB], project }), /no valid scores for open-a, open-b/);
});

// The fake model, plus the two calls the candidates stage makes: a second opening, and the judge.
function candidateModel({ opening = "b", transition = "a" } = {}) {
  const fake = fakeModel({ vision: true });
  const inner = fake.model.client.runStructured.bind(fake.model.client);
  const seen = [];
  fake.model.client.runStructured = async (request) => {
    if (request.schemaName === "launchclip_make_opening_candidate") {
      seen.push(request);
      return { model: "gpt-5.6-luna", usage, value: { module: "media-window", params_json: JSON.stringify({ title: "Every payout, matched", media: { kind: "video", src: "assets/ui.mp4" } }), why: "The product, with the promise as its title." } };
    }
    if (request.schemaName === "launchclip_make_candidate_judgment") {
      seen.push(request);
      const kind = /the opening of the video/.test(request.input) ? "open" : "trans";
      const wins = kind === "open" ? opening : transition;
      return { model: "gpt-5.6-luna", usage, value: { rationale: `Candidate ${kind}-${wins} reads sooner.`, candidates: ["a", "b"].map((letter) => ({ id: `${kind}-${letter}`, admissible: true, weakness: letter === wins ? "" : "Slower to read.", scores: scores(letter === wins ? 8 : 6) })) } };
    }
    return inner(request);
  };
  return { ...fake, seen };
}

async function make(t, model, options = {}, { still = null } = {}) {
  const assets = await assetsDir();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-candidates-make-"));
  t.after(() => Promise.all([rm(assets, { recursive: true, force: true }), rm(cwd, { recursive: true, force: true })]));
  const stills = [];
  const critic = async () => ({ status: "written", verdict: "ship", findings: 0, reviewed: 1, unreviewed: 0, warnings: [], model: "gpt-5.6-luna", critique: { verdict: "ship", summary: "", findings: [] } });
  const adapters = { env: {}, client: model, inventory: fakeInventory, finish: fakeFinish([]), critic, candidateStill: still ?? fakeStill(stills), notice() {} };
  const run = () => runMake(PROMPT, { assets, voice: "test", music: "synth", concepts: "off", cwd, out: "video", ...options }, adapters);
  return { run, stills, project: path.join(cwd, "video") };
}

test("make renders two openings and two transitions, scores them from the frames and keeps the winners", async (t) => {
  const fake = candidateModel({ opening: "b", transition: "a" });
  const { run, stills, project } = await make(t, fake.model);
  const report = await run();
  assert.notEqual(report.status, "failed", JSON.stringify(report.stages));
  assert.equal(report.stages.candidates.status, "done", JSON.stringify(report.candidates));
  assert.deepEqual(report.candidates.notes, []);
  assert.equal(report.candidates.receipt_ok, true, JSON.stringify(report.candidates.receipt_errors));
  // Twelve stills: three per candidate, the same times for both sides of a comparison.
  assert.equal(stills.length, 12);
  // (The two sides of a comparison render side by side, so the order their stills start in is not fixed.)
  assert.deepEqual([...new Set(stills.map((still) => still.dir))].sort(), ["open-a", "open-b", "trans-a", "trans-b"]);
  assert.deepEqual(stills.filter((still) => still.dir === "open-a").map((still) => still.at), stills.filter((still) => still.dir === "open-b").map((still) => still.at));
  const [opening, transition] = report.candidates.comparisons;
  assert.deepEqual({ id: opening.id, selected: opening.selected, means: opening.candidates.map((candidate) => candidate.mean) }, { id: "opening", selected: "open-b", means: [6, 8] });
  assert.deepEqual({ kind: transition.kind, boundary: transition.boundary_id, selected: transition.selected }, { kind: "transition", boundary: "s2-in", selected: "trans-a" });
  // The second opening was designed without the first: its request never carries the planner's headline or scene.
  const design = fake.seen.find((request) => request.schemaName === "launchclip_make_opening_candidate");
  assert.ok(!/Payouts never match your books"|hook-title|storyboard/.test(design.input), design.input);
  assert.match(design.input, /## The opening line \(spoken over this scene\)\n\nPayouts never match/);
  // The winning opening replaced the planner's; the transition the planner chose stood.
  const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
  assert.equal(story.scenes[0].params.title, "Every payout, matched");
  assert.equal(story.scenes[1].in.type, "fade");
  assert.deepEqual(report.candidates.applied, ["opening: media-window → media-window"]);
  // The transition candidates were rendered on the winning opening.
  assert.ok(stills.filter((still) => still.dir.startsWith("trans-")).every((still) => still.opening === "media-window"));
  assert.notEqual(stills.find((still) => still.dir === "trans-b").second, "fade");
  assert.deepEqual(report.costs.items.filter((item) => item.stage.startsWith("candidate-")).map((item) => item.stage), ["candidate-opening", "candidate-judge-opening", "candidate-judge-transition"]);
  const receipt = JSON.parse(await readFile(path.join(project, "qa/rendered-candidates.json"), "utf8"));
  assert.equal((await validateRenderedCandidateReceipt(project, receipt, { boundaryIds: ["s2-in"] })).ok, true);

  // A rerun keeps the chosen storyboard and renders, designs and judges nothing again.
  const before = [fake.seen.length, stills.length];
  const again = await run();
  assert.equal(again.candidates.status, "reused");
  assert.equal(again.candidates.comparisons.length, 2);
  assert.deepEqual([fake.seen.length, stills.length], before);
});

test("a transition that scores higher replaces the planner's", async (t) => {
  const fake = candidateModel({ opening: "a", transition: "b" });
  const { run, project } = await make(t, fake.model);
  const report = await run();
  assert.equal(report.stages.candidates.status, "done", JSON.stringify(report.candidates));
  const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
  assert.equal(story.scenes[0].params.title, "Payouts never match your books", "the planner's opening won");
  assert.notEqual(story.scenes[1].in.type, "fade");
  assert.match(report.candidates.applied[0], /^transition into s2: fade → /);
});

test("candidates are skipped, with the reason, when off or when the model cannot see; a failed comparison leaves the planner's cut", async (t) => {
  const off = await make(t, candidateModel().model, { candidates: "off" });
  assert.deepEqual((await off.run()).candidates, { status: "skipped", reason: "--candidates off" });
  assert.equal(off.stills.length, 0);
  const blind = await make(t, fakeModel().model);
  const blindReport = await blind.run();
  assert.match(blindReport.candidates.reason, /cannot take images/);
  assert.equal(blind.stills.length, 0);
  // A model that answers neither candidate call: no comparison, a warning, and the video is still made.
  const silent = await make(t, fakeModel({ vision: true }).model);
  const report = await silent.run();
  assert.notEqual(report.status, "failed", JSON.stringify(report.stages));
  assert.equal(report.candidates.status, "skipped");
  assert.equal(report.candidates.notes.length, 2);
  assert.ok(report.warnings.some((warning) => /candidates: none compared .* the planner's opening and transitions stand/.test(warning)));
  const story = JSON.parse(await readFile(path.join(silent.project, "storyboard.json"), "utf8"));
  assert.equal(story.scenes[0].params.title, "Payouts never match your books");
});

// A still that takes a moment, and a log of what was running when: which candidates rendered together, and whether a model call was open.
function tracedRun(t, { opening = "b", transition = "a", concurrency, failDesign = false } = {}) {
  const fake = candidateModel({ opening, transition });
  const events = [];
  const rendering = new Set();
  let designing = false;
  let peak = 0;
  const inner = fake.model.client.runStructured.bind(fake.model.client);
  fake.model.client.runStructured = async (request) => {
    if (request.schemaName !== "launchclip_make_opening_candidate") return inner(request);
    designing = true;
    await new Promise((resolve) => setTimeout(resolve, 25));
    designing = false;
    if (failDesign) throw new Error("the model is down");
    return inner(request);
  };
  const write = fakeStill();
  const still = async (story, at, out, extra) => {
    const id = path.basename(extra.dir);
    rendering.add(id);
    peak = Math.max(peak, rendering.size);
    events.push({ id, beside: [...rendering].filter((other) => other !== id).sort(), designing });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await write(story, at, out, extra);
    rendering.delete(id);
  };
  return make(t, fake.model, concurrency ? { concurrency } : {}, { still }).then((made) => ({ ...made, events, peak: () => peak }));
}

test("the planner's opening renders while the second is designed, and the two sides of a comparison render side by side", async (t) => {
  const side = await tracedRun(t, { concurrency: 2 });
  const report = await side.run();
  assert.equal(report.stages.candidates.status, "done", JSON.stringify(report.candidates));
  assert.equal(side.peak(), 2);
  assert.ok(side.events.some((event) => event.id === "open-a" && event.designing), "open-a was rendering while the design call was open");
  assert.ok(side.events.some((event) => event.id === "trans-b" && event.beside.includes("trans-a")), "the two transitions rendered together");
  assert.ok(side.events.filter((event) => event.id.startsWith("trans-")).every((event) => !event.beside.some((other) => other.startsWith("open-"))), "the transitions wait for the opening's verdict: they are rendered on the winner");
  assert.deepEqual(report.model_calls.stages.candidates.side_by_side, ["candidate stills: 2 at a time"]);

  // --concurrency 1 (a machine with room for one render): one candidate at a time, and the same result.
  const single = await tracedRun(t, { concurrency: 1 });
  const alone = await single.run();
  assert.equal(single.peak(), 1);
  assert.ok(single.events.every((event) => event.beside.length === 0));
  assert.ok(single.events.some((event) => event.id === "open-a" && event.designing), "the design call still overlaps the first render: it is not a render");
  assert.equal(alone.model_calls.stages.candidates.side_by_side, undefined);
  assert.deepEqual(alone.candidates, report.candidates);
  for (const file of ["storyboard.json", "qa/rendered-candidates.json"]) assert.equal(await readFile(path.join(single.project, file), "utf8"), await readFile(path.join(side.project, file), "utf8"), file);
  assert.deepEqual(alone.costs.items.map((item) => item.stage), report.costs.items.map((item) => item.stage));
});

test("a second opening that cannot be designed leaves no stills of the planner's opening behind", async (t) => {
  const failed = await tracedRun(t, { failDesign: true, concurrency: 2 });
  const report = await failed.run();
  assert.notEqual(report.status, "failed", JSON.stringify(report.stages));
  assert.deepEqual(report.candidates.notes, ["opening: the model is down"]);
  assert.equal(report.candidates.comparisons.length, 1, "the transition is still compared");
  assert.equal(existsSync(path.join(failed.project, "qa/rendered-candidates/open-a")), false);
  assert.equal(existsSync(path.join(failed.project, "qa/rendered-candidates/trans-a")), true);
  assert.ok(failed.events.filter((event) => event.id.startsWith("trans-")).every((event) => !event.beside.includes("open-a")), "the transition renders start once the opening's is over");
});

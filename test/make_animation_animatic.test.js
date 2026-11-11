// `launchclip make "<prompt>" --animation` from the prompt to a finished
// video (docs/ANIMATION_PIPELINE_RFC.md §9, phase 7): script, voice, show
// bible, shot list, animatic, staging review, retakes, delivery render and
// critic. Every model answer is recorded (test/fixtures/make-animation/); the
// real finish runs with a renderer that records the frame ranges it is asked
// for (test/helpers/finish_offline.js).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { readAnimatic } from "../src/animatic.js";
import { makeExitCode } from "../src/cli.js";
import { ANIMATIC_RETAKES_FILE } from "../src/make/index.js";
import { RETAKES_SCHEMA } from "../src/make/critic_repair.js";
import { animaticAdapters } from "./helpers/finish_offline.js";
import { fixture, room, schemas } from "./helpers/make_animation.js";

// The animatic's voice stage runs ffmpeg, so these run where it is installed (the media jobs in CI).
const needsFfmpeg = { skip: (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return false; } catch { return "ffmpeg is not installed"; } })() };

const finding = (id, severity, category, message, evidence) => ({ id, severity, category, message, evidence_ids: evidence });
const ship = { verdict: "ship", summary: "Reads well.", findings: [] };

// The plan the recorded model answers with: the shared fixture, with what
// finish's gates ask of it (Sam beside the desk so no third of the frame is
// empty, a closing card short enough to read, five title options), and one
// seeded bad shot: in "ask", Sam scowls as he asks his gentle question. Every
// deterministic gate passes it (the pose is the direction map's), so only a
// reviewer who looks at the frames can catch it.
async function seededStoryboard() {
  const story = await fixture("storyboard");
  const scene = (id) => story.scenes.find((entry) => entry.id === id);
  scene("desk").params.cast.push({ id: "sam", pose: "stand", expression: "neutral" });
  Object.assign(scene("close"), { end: 19.6 });
  scene("close").params.card = { title: "Run the check first" };
  const cue = story.scenes.find((scene) => scene.id === "ask").params.cast.find((member) => member.id === "sam").cues.find((entry) => entry.at === "word:Did");
  cue.expression = "frustrated";
  return story;
}
const badShot = finding("f1", "major", "acting", "Sam scowls as he asks whether she ran the check; the line is gentle, so a kind face, not a frustrated one.", ["ask-001-browser-still"]);
const repair = { verdict: "repair", summary: "One shot's acting is wrong.", findings: [badShot] };

// The retake the model answers: the scene it was sent, with Sam's face put right.
const fixSam = (request) => {
  const [ask] = JSON.parse(request.input.slice(request.input.indexOf("[\n", request.input.indexOf("as they are now"))));
  Object.assign(ask.params.cast.find((member) => member.id === "sam").cues.find((entry) => entry.at === "word:Did"), { expression: "happy" });
  return { scenes_json: JSON.stringify([ask]), note: "Sam asks with a kind face instead of a scowl." };
};
// A retake that changes the shot without answering the finding.
const missSam = (request) => {
  const [ask] = JSON.parse(request.input.slice(request.input.indexOf("[\n", request.input.indexOf("as they are now"))));
  ask.params.cast.find((member) => member.id === "sam").expression = "surprised";
  return { scenes_json: JSON.stringify([ask]), note: "Sam looks surprised." };
};

// The two finish gates that measure rendered pixels (the evidence frames'
// hashes, the palette of the video): the offline renderer writes no pixels,
// so they are passed here and proven by a real render instead.
const PIXEL_GATES = ["temporal_evidence", "style"];

// make with the real finish (offline stand-ins) and a model that can see.
async function studio(recorded, options = {}) {
  const finishAdapters = animaticAdapters();
  const { runFinish } = await import("../src/finish.js");
  const finish = async (...args) => {
    const report = await runFinish(...args);
    for (const name of PIXEL_GATES) if (report.gates?.[name]) report.gates[name] = { status: "passed", note: "not measured offline" };
    return report;
  };
  const script = await fixture("script");
  script.title_options = [...script.title_options, "One check, one fix", "The fix that kept failing"];
  const t = await room({ scripts: [script], storyboards: [await seededStoryboard()], vision: true, recorded, finish, ...options });
  t.adapters.finishAdapters = finishAdapters;
  const make = (extra = {}) => t.make({ renderer: "remotion", music: "synth", candidates: "off", ...extra });
  const sam = async () => (await t.read("storyboard.json")).scenes.find((scene) => scene.id === "ask").params.cast.find((member) => member.id === "sam");
  return { ...t, make, sam, segmentCalls: finishAdapters.segmentCalls };
}

test("one prompt to a finished character story: a seeded bad shot is caught at the animatic and fixed by a retake that renders only that shot", needsFfmpeg, async () => {
  const t = await studio({ launchclip_animatic_review: [repair, ship], launchclip_retake: [fixSam], launchclip_make_critic: [ship, ship] });
  try {
    const report = await t.make();
    assert.equal(report.status, "ready", JSON.stringify({ stages: report.stages, gates: report.gates, warnings: report.warnings }, null, 1));
    assert.equal(makeExitCode(report), 0);
    assert.equal(report.routing.kind, "animation");
    // Every stage ran, in order, on one prompt.
    assert.deepEqual(Object.entries(report.stages).map(([name, stage]) => `${name}:${stage.status}`), ["model:done", "inventory:skipped", "demo:skipped", "route:done", "prepare:done", "bible:done", "storyboard:done", "candidates:skipped", "animatic:done", "subject:skipped", "finish:done", "critic:done"]);
    const calls = schemas(t.calls);
    assert.deepEqual(calls.slice(calls.indexOf("bible")), ["bible", "direction", "storyboard", "animatic_review", "retake", "animatic_review", "make_critic"]);
    assert.ok(calls.indexOf("script") > 0 && calls.indexOf("script") < calls.indexOf("bible"));
    for (const file of ["SCRIPT.json", "NARRATION.json", "BIBLE.json", "DIRECTION.json", "storyboard.json", "ANIMATIC.json", "renders/animatic.mp4", "qa/animatic-critic.json", ANIMATIC_RETAKES_FILE, "qa/critic.json", "finish.json", "MAKE.json"]) assert.ok(existsSync(path.join(t.project, file)), file);

    // The renders: the whole animatic, then the one retaken shot, and nothing new for the video (it is the animatic's cut).
    const animatic = await t.read("ANIMATIC.json");
    const ask = animatic.shots.find((shot) => shot.id === "ask");
    assert.equal(animatic.shots.length, 5);
    assert.equal(t.segmentCalls.length, 2, JSON.stringify(t.segmentCalls));
    assert.ok(t.segmentCalls[0].length >= 5, "the animatic renders every shot");
    assert.deepEqual(t.segmentCalls[1], [[ask.first_frame, ask.last_frame + 1]], "the retake renders the failing shot's frames only");

    // The retake: recorded, kept, and the storyboard's shot is the fixed one.
    const retakes = await t.read(ANIMATIC_RETAKES_FILE);
    assert.deepEqual({ schema: retakes.schema, review: retakes.review, status: retakes.status, rounds: retakes.rounds.length }, { schema: RETAKES_SCHEMA, review: "animatic", status: "ship", rounds: 1 });
    assert.deepEqual({ step: retakes.rounds[0].step, shots: retakes.rounds[0].shots, rendered: retakes.rounds[0].rendered, kept: retakes.rounds[0].kept, segments: retakes.rounds[0].segments.rendered }, { step: "redirect", shots: ["ask"], rendered: ["ask"], kept: true, segments: 1 });
    assert.equal(existsSync(path.join(t.project, "qa/retakes.json")), false, "qa/retakes.json is the final critic's");
    assert.deepEqual((await t.sam()).cues[0], { at: "word:Did", pose: "think", expression: "happy" });
    const seeded = await seededStoryboard();
    assert.deepEqual((await t.read("storyboard.json")).scenes.filter((scene) => scene.id !== "ask").map((scene) => scene.params), seeded.scenes.filter((scene) => scene.id !== "ask").map((scene) => scene.params), "no other shot changed");
    // The model was shown the finding and that shot alone, and the reviews saw the reference sheets.
    const retake = t.calls.find((call) => call.schemaName === "launchclip_retake");
    assert.match(retake.input, /critic \(major acting, scene ask\): Sam scowls/);
    const review = t.calls.find((call) => call.schemaName === "launchclip_animatic_review");
    assert.match(review.input, /Reference sheets/);
    assert.match(review.input, /The shot list/);
    assert.match(t.calls.find((call) => call.schemaName === "launchclip_make_critic").input, /The shot list/);

    // The report.
    assert.deepEqual({ ...report.animatic, story_hash: null, bible_hash: null }, { file: "ANIMATIC.json", video: "renders/animatic.mp4", story_hash: null, bible_hash: null, shots: 5, gates_failed: PIXEL_GATES, review: { verdict: "ship", file: "qa/animatic-critic.json" }, retakes: { file: ANIMATIC_RETAKES_FILE, rounds: 1, kept: 1, status: "ship" }, approved: false });
    assert.equal(report.animatic.story_hash, animatic.story_hash);
    assert.equal(animatic.review.verdict, "ship");
    assert.equal((await readAnimatic(t.project)).fresh, true);
    assert.equal(report.final, "renders/draft.mp4");
    assert.equal(report.gates.critic.status, "passed");
    assert.equal(report.critic.verdict, "ship");
    assert.deepEqual(report.critic_repairs, []);
    assert.deepEqual(report.costs.items.map((item) => item.stage).filter((stage) => /animatic|retake|critic/.test(stage)), ["animatic-review", "animatic-review-1", "animatic-retake-1-redirect", "critic"]);
    assert.ok(t.notices.some((line) => /^retake 1 of 3: redirect ask/.test(line)));
    assert.equal((await t.read("MAKE.json")).status, "ready");

    // The same command again: nothing is written, voiced, designed, planned, rendered or reviewed twice, except the critic's look at the video.
    const before = t.calls.length;
    const again = await t.make();
    assert.equal(again.status, "ready");
    assert.equal(again.stages.animatic.status, "cached");
    assert.deepEqual(again.animatic.retakes, report.animatic.retakes);
    assert.equal(t.segmentCalls.length, 2);
    assert.deepEqual(schemas(t.calls).slice(before), ["make_critic"]);
  } finally {
    await t.done();
  }
});

test("a shot no retake fixes: the round is undone, the rounds are spent once, and the report is needs-repair", needsFfmpeg, async () => {
  const t = await studio({ launchclip_animatic_review: [repair, repair], launchclip_retake: [missSam], launchclip_make_critic: [repair] });
  try {
    const report = await t.make({ criticRepairs: 1 });
    assert.equal(report.status, "needs-repair", JSON.stringify({ stages: report.stages, gates: report.gates }, null, 1));
    assert.equal(makeExitCode(report), 2);
    assert.equal(makeExitCode(report, { allowNeedsRepair: true }), 0);
    // The animatic's round did not lower the findings: undone, the seeded shot is back.
    assert.deepEqual(report.animatic.retakes, { file: ANIMATIC_RETAKES_FILE, rounds: 1, kept: 0, status: "needs-repair" });
    assert.equal(report.animatic.review.verdict, "repair");
    assert.equal((await t.sam()).expression, "neutral");
    assert.equal((await t.sam()).cues[0].expression, "frustrated");
    assert.equal((await readAnimatic(t.project)).fresh, true, "the animatic is the kept cut's");
    assert.ok(report.warnings.some((warning) => /animatic: the staging review still asks for repair after 1 retake round/.test(warning)));
    // The video is still rendered and judged; the one round is not spent twice.
    assert.equal(report.final, "renders/draft.mp4");
    assert.equal(report.gates.critic.status, "failed");
    assert.deepEqual(report.critic_repairs, []);
    assert.ok(report.warnings.some((warning) => /critic retakes skipped: the 1 repair round was spent on the animatic/.test(warning)));
    assert.equal(schemas(t.calls).filter((name) => name === "retake").length, 1);
  } finally {
    await t.done();
  }
});

test("the final critic's rounds are retakes too: the failing shot renders again, alone, and the video is ready", needsFfmpeg, async () => {
  // The staging review passes the animatic; the critic catches the shot in the video.
  const t = await studio({ launchclip_animatic_review: [ship], launchclip_retake: [fixSam], launchclip_make_critic: [repair, ship] });
  try {
    const report = await t.make();
    assert.equal(report.status, "ready", JSON.stringify({ stages: report.stages, gates: report.gates, repairs: report.critic_repairs }, null, 1));
    assert.equal(report.animatic.retakes, undefined);
    assert.deepEqual(report.retakes, { file: "qa/retakes.json", review: "final", rounds: 1, kept: 1, status: "ship" });
    assert.deepEqual(report.critic_repairs.map((round) => ({ round: round.round, mode: round.mode, scenes: round.scenes, rendered: round.rendered, kept: round.kept, after: round.verdict_after })), [{ round: 1, mode: "redirect", scenes: ["ask"], rendered: ["ask"], kept: true, after: "ship" }]);
    const ask = (await t.read("ANIMATIC.json")).shots.find((shot) => shot.id === "ask");
    assert.deepEqual(t.segmentCalls.slice(1), [[[ask.first_frame, ask.last_frame + 1]]], "after the animatic, only the retaken shot renders");
    assert.equal((await t.sam()).cues[0].expression, "happy");
    assert.equal((await t.read("qa/retakes.json")).review, "final");
    assert.equal(report.gates.critic.status, "passed");
    assert.deepEqual(report.costs.items.map((item) => item.stage).filter((stage) => /retake|critic/.test(stage)), ["critic", "critic-1", "retake-1-redirect"]);
  } finally {
    await t.done();
  }
});

test("--stop-after animatic ends awaiting-approval before the delivery render, and --approve animatic resumes from there", needsFfmpeg, async () => {
  const t = await studio({ launchclip_animatic_review: [ship], launchclip_make_critic: [ship, ship] });
  try {
    const stopped = await t.make({ stopAfter: "animatic" });
    assert.equal(stopped.status, "awaiting-approval", JSON.stringify(stopped.stages));
    assert.equal(makeExitCode(stopped), 3);
    assert.deepEqual(stopped.stopped, { after: "animatic", reason: "stopped for approval of the animatic (--stop-after animatic)" });
    assert.equal(stopped.stages.animatic.status, "done");
    for (const stage of ["subject", "finish", "critic"]) assert.equal(stopped.stages[stage].status, "skipped");
    assert.equal(stopped.final, null);
    assert.equal(existsSync(path.join(t.project, "renders/animatic.mp4")), true);
    assert.equal(existsSync(path.join(t.project, "renders/draft.mp4")), false);
    assert.match(stopped.next_steps.at(-1), /Watch the animatic \(.*renders\/animatic\.mp4.*--approve animatic/);
    assert.equal(stopped.animatic.approved, false);

    const before = t.calls.length;
    const renders = t.segmentCalls.length;
    const resumed = await t.make({ approve: "animatic" });
    assert.equal(resumed.status, "ready", JSON.stringify({ stages: resumed.stages, gates: resumed.gates }, null, 1));
    assert.equal(resumed.stages.animatic.status, "cached");
    assert.equal(resumed.animatic.approved, true);
    assert.equal(resumed.final, "renders/draft.mp4");
    assert.deepEqual(schemas(t.calls).slice(before), ["make_critic"], "only the critic is new");
    assert.equal(t.segmentCalls.length, renders, "the video is the animatic's cut: no shot renders again");
    // Approved for this storyboard, it does not stop there again.
    assert.equal((await t.make({ stopAfter: "animatic" })).status, "ready");
  } finally {
    await t.done();
  }
});

test("an attended run asks before the delivery render; a no stops it there", needsFfmpeg, async () => {
  const t = await studio({ launchclip_animatic_review: [ship], launchclip_make_critic: [ship] });
  try {
    const asked = [];
    t.adapters.ask = async (question) => { asked.push(question); return !question.startsWith("animatic:"); };
    const no = await t.make();
    assert.equal(no.status, "awaiting-approval");
    assert.deepEqual(no.stopped, { after: "animatic", reason: "stopped for approval of the animatic (declined when asked)" });
    assert.match(asked.at(-1), /^animatic: watch .*renders\/animatic\.mp4 \(the staging review says ship\)\. Render the finished video from it\?$/);
    t.adapters.ask = async (question) => { asked.push(question); return true; };
    const yes = await t.make();
    assert.equal(yes.status, "ready");
    assert.equal(yes.animatic.approved, true);
    assert.equal(asked.filter((question) => question.startsWith("animatic:")).length, 2);
  } finally {
    await t.done();
  }
});

test("with a model that cannot see, the animatic is rendered unreviewed and the video is ready-for-review", needsFfmpeg, async () => {
  const t = await studio({}, { vision: false });
  try {
    const report = await t.make();
    assert.equal(report.status, "ready-for-review", JSON.stringify({ stages: report.stages, gates: report.gates }, null, 1));
    assert.equal(makeExitCode(report), 4);
    assert.deepEqual(report.animatic.review, { verdict: null, reason: "openai:gpt-5.6-luna cannot take images" });
    assert.equal(report.stages.animatic.status, "done");
    assert.equal(report.final, "renders/draft.mp4");
    assert.equal(schemas(t.calls).some((name) => /review|critic|retake/.test(name)), false);
  } finally {
    await t.done();
  }
});

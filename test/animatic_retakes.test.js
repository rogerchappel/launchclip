// The animatic, its staging review, the critic's reference sheets and the
// retake rounds (docs/ANIMATION_PIPELINE_RFC.md §4.4, §4.7), on the
// two-character example with recorded model responses and a fake renderer.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ANIMATIC_SCHEMA, animaticApproved, readAnimatic } from "../src/animatic.js";
import { freezeBible } from "../src/bible.js";
import { runCli } from "../src/cli.js";
import { PATHS, formatFinishSummary, runFinish } from "../src/finish.js";
import { CRITIC_CATEGORIES, STAGING_CATEGORIES, bibleReferenceSheets, reviewAnimatic, runHeadlessCritic } from "../src/make/critic.js";
import { RETAKES_SCHEMA } from "../src/make/critic_repair.js";
import { redirectShots, retakeProject, runRetakes } from "../src/make/retakes.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIALOGUE = path.join(ROOT, "examples/story/dialogue-9x16");
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const touch = async (file, content = "x") => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); };

// The dialogue example with a frozen bible (its sheets drawn by a stand-in),
// the measured words kept and no voice to synthesise. `seed` edits the storyboard.
async function dialogueProject(t, seed = null) {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-animatic-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  await cp(DIALOGUE, project, { recursive: true });
  const file = path.join(project, "storyboard.json");
  const story = await read(file);
  delete story.audio.narration;
  story.audio.voice = "assets/audio/voice.wav";
  await touch(path.join(project, "assets/audio/voice.wav"), "wav");
  seed?.(story);
  await writeFile(file, `${JSON.stringify(story, null, 2)}\n`);
  await freezeBible(project, {}, { render: async (html, png) => touch(png, "png") });
  return project;
}

// Offline stand-ins for finish: a segment renderer that records the frame
// ranges it is asked for, and evidence with one sample in the middle of
// every shot (so a finding can name a shot).
function animaticAdapters() {
  const adapters = {
    env: {},
    notice() {},
    segmentCalls: [],
    renderer: (name) => ({
      name,
      segmentEncoder: () => ({ fake: true }),
      async renderSegments(project, segments, options) {
        adapters.segmentCalls.push(segments.map((segment) => [segment.startFrame, segment.endFrame]));
        for (const segment of segments) await touch(segment.output, `${segment.startFrame}-${segment.endFrame} ${JSON.stringify(options.story.scenes.map((scene) => scene.params?.cast?.map((member) => member.pose)))}\n`);
        return { segments: segments.map(() => ({ seconds: 1 })) };
      },
      async encodeDelivery(input, output) { await touch(output, await readFile(input, "utf8")); },
      async render() { throw new Error("the segment path must not render whole videos"); }
    }),
    segmentTools: {
      async concat(files, output) { await touch(output, (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("")); },
      async encodeAudio({ output }) { await touch(output, "aac"); },
      async mux({ video, output }) { await touch(output, await readFile(video, "utf8")); },
      async countFrames() { return NaN; },
      async still(video, frame, output) { await touch(output, `${frame}`); },
      async sideBySide(left, right, output) { await touch(output, "pair"); }
    },
    async synthKit(outDir, bed) { await touch(path.join(outDir, "AUDIO-KIT.json"), "{}"); if (bed) await touch(path.join(outDir, "music", "bed.wav")); return {}; },
    async renderTyping(schedule, banks, { out }) { await touch(out, "typing"); return { file: out, keystrokes: [], counts: {} }; },
    async buildMix(options) { await touch(options.out, `mix ${options.cues.length}`); return { cues: options.cues.map((cue) => ({ ...cue, file: path.join(options.sfxDir, `${cue.cue}.wav`) })) }; },
    async hasAudio() { return true; },
    async master(input, output, target) { await touch(output, `mastered ${await readFile(input, "utf8")}`); return { target: { integrated_lufs: target.lufs, true_peak_dbtp: target.tp }, output: { integrated_lufs: -14.1, true_peak_dbtp: -1.4 }, compliant: true }; },
    async buildEvidence(project, options) {
      const shots = options.story.scenes.filter((scene) => (scene.track ?? 0) === 0);
      const entries = shots.flatMap((scene) => ["browser-still", "encoded-draft"].map((source) => ({ evidence_id: `${scene.id}-001-${source}`, sample_id: `${scene.id}-001`, source, role: "sample", at_seconds: Math.round(((scene.start + scene.end) / 2) * 1000) / 1000 })));
      await touch(path.join(project, PATHS.evidence), JSON.stringify({ schema_version: "launchclip.subscription-temporal-evidence.v1", entries }));
      await touch(path.join(project, "qa/critic-sheets/index.json"), JSON.stringify({ sheets: [{ sheet: "sheet-01.jpg", samples: shots.map((scene) => `${scene.id}-001`) }] }));
      await touch(path.join(project, "qa/critic-sheets/sheet-01.jpg"), "jpg");
      await touch(path.join(project, "qa/critic-sheets/overview-every-1.5s.jpg"), "strip");
      return { samples: shots.length, artifacts: entries.length, sheets: ["sheet-01.jpg"] };
    },
    async motion(video, out) { await touch(out, "{}"); return { quality: { ok: true, findings: [] } }; },
    async audio() { return { quality: { ok: true, findings: [] } }; }
  };
  return adapters;
}

// A model that answers from a list of recorded responses, by schema name.
function recordedModel(responses) {
  const requests = [];
  const queue = Object.fromEntries(Object.entries(responses).map(([name, list]) => [name, [...list]]));
  return {
    requests,
    provider: "openai",
    async runStructured(request) {
      requests.push(request);
      const value = queue[request.schemaName]?.shift();
      if (!value) throw new Error(`no recorded response left for ${request.schemaName}`);
      return { model: "gpt-5.6-luna", value, usage: { input_tokens: 2000, output_tokens: 300, total_tokens: 2300 } };
    }
  };
}

const finding = (id, severity, category, message, evidence) => ({ id, severity, category, message, evidence_ids: evidence });

test("finish --animatic renders the story to renders/animatic.mp4 and writes ANIMATIC.json with its shots, gates and hashes", async (t) => {
  const project = await dialogueProject(t);
  const adapters = animaticAdapters();
  const report = await runFinish(project, { renderer: "remotion", animatic: true, music: "synth" }, adapters);
  assert.notEqual(report.status, "failed", JSON.stringify(report.stages.filter((stage) => stage.status === "failed")));
  assert.equal(report.output, path.join(project, "renders/animatic.mp4"));
  assert.equal(report.final, null, "an animatic is not the final");
  assert.ok(existsSync(path.join(project, "renders/animatic.mp4")));
  assert.equal(report.publish, undefined, "no publish.json for an animatic");
  assert.deepEqual({ file: report.animatic.file, video: report.animatic.video, shots: report.animatic.shots }, { file: "ANIMATIC.json", video: "renders/animatic.mp4", shots: 5 });
  assert.match(formatFinishSummary(report), /animatic: renders\/animatic\.mp4 \(5 shots; ANIMATIC\.json/);
  assert.ok(report.next_steps.some((step) => /--animatic --review/.test(step)));

  const animatic = await read(path.join(project, "ANIMATIC.json"));
  const bible = await read(path.join(project, "BIBLE.json"));
  assert.equal(animatic.schema, ANIMATIC_SCHEMA);
  assert.equal(animatic.bible_hash, bible.hash);
  assert.match(animatic.story_hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(animatic.shots.map((shot) => shot.id), ["desk", "ask", "test", "saved", "close"]);
  assert.deepEqual({ start: animatic.shots[1].start, end: animatic.shots[1].end, frames: animatic.shots[1].frames, first: animatic.shots[1].first_frame, who: animatic.shots[1].who }, { start: 2.156, end: 8.524, frames: 191, first: 65, who: ["maya", "sam"] });
  assert.match(animatic.shots[1].segment, /^01-ask:[0-9a-f]{12}$/);
  assert.equal(animatic.gates.bible, "passed");
  assert.equal(animatic.gates.cast, "passed");
  assert.equal(animatic.gates.critic, undefined, "the review stands in for the critic gate");
  assert.deepEqual(animatic.gates_failed, Object.entries(animatic.gates).filter(([, status]) => status === "failed").map(([name]) => name));
  assert.deepEqual(animatic.review, { verdict: null, file: null });
  assert.equal((await readAnimatic(project)).fresh, true);
  assert.equal(animaticApproved(animatic), false, "not approved before a review");

  // A changed storyboard makes the animatic stale.
  const story = await read(path.join(project, "storyboard.json"));
  story.scenes[0].params.cast[0].expression = "happy";
  await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
  const stale = await readAnimatic(project);
  assert.equal(stale.fresh, false);
  assert.match(stale.reasons[0], /storyboard\.json changed/);

  await assert.rejects(runFinish(project, { animatic: true, quality: "high" }, adapters), /--animatic renders at draft quality/);
  await assert.rejects(runFinish(project, { animatic: true, prototype: true }, adapters), /--animatic renders the whole story/);
});

test("the critic is shown each character's reference sheet and can raise acting, character-consistency and lip-sync findings", async (t) => {
  const project = await dialogueProject(t);
  await runFinish(project, { renderer: "remotion", animatic: true, music: "synth" }, animaticAdapters());
  assert.deepEqual((await bibleReferenceSheets(project)).map((sheet) => [sheet.character, sheet.file]), [["maya", "bible/sheets/maya.png"], ["sam", "bible/sheets/sam.png"]]);
  for (const category of ["acting", "character-consistency", "lip-sync"]) {
    assert.ok(CRITIC_CATEGORIES.includes(category));
    assert.ok(STAGING_CATEGORIES.includes(category));
  }
  assert.equal(STAGING_CATEGORIES.includes("typography"), false);

  const client = recordedModel({ launchclip_make_critic: [{ verdict: "repair", summary: "Three character problems.", findings: [
    finding("f1", "major", "acting", "Maya shrugs while she gives in.", ["ask-001-browser-still"]),
    finding("f2", "major", "character-consistency", "Sam's sweater is not the one on his sheet.", ["saved-001"]),
    finding("f3", "minor", "lip-sync", "Maya's mouth is closed on her line.", ["test-001-encoded-draft"])
  ] }] });
  const shots = (await retakeProject(project)).shots;
  const result = await runHeadlessCritic({ project, client, shots });
  assert.equal(result.status, "written");
  assert.equal(result.file, path.join(project, "qa/critic.json"));
  assert.deepEqual(result.reference_sheets, ["bible/sheets/maya.png", "bible/sheets/sam.png"]);
  const [request] = client.requests;
  assert.equal(request.images.length, 4, "the contact sheet, the overview strip and two reference sheets");
  assert.match(request.input, /Reference sheets \(how each character must look in every shot; not evidence, never cite them\):\n {2}Image 3: Maya \(maya\); must keep: .*curly hair/);
  assert.match(request.input, /Image 4: Sam \(sam\)/);
  assert.match(request.input, /The shot list[^\n]*\n {2}desk {2}0–2\.156 s/);
  assert.match(request.input, /sam: "Did you test the rollback\?"/);
  assert.match(request.instructions, /lip-sync \(character stories only\)/);
  const critique = await read(path.join(project, "qa/critic.json"));
  assert.deepEqual(critique.findings.map((entry) => entry.category), ["acting", "character-consistency", "lip-sync"]);
  assert.deepEqual(critique.findings[1].evidence_ids, ["saved-001-browser-still", "saved-001-encoded-draft"], "a sample id expands to its evidence ids");
  assert.deepEqual(critique.reviewer.reference_sheets, [{ character: "maya", file: "bible/sheets/maya.png" }, { character: "sam", file: "bible/sheets/sam.png" }]);
  assert.equal(critique.reviewer.review, "final");

  // referenceSheets: false leaves them out.
  const plain = recordedModel({ launchclip_make_critic: [{ verdict: "ship", summary: "", findings: [] }] });
  await runHeadlessCritic({ project, client: plain, referenceSheets: false });
  assert.equal(plain.requests[0].images.length, 2);
});

test("the staging review judges story, staging and acting only, writes qa/animatic-critic.json and records its verdict in ANIMATIC.json", async (t) => {
  const project = await dialogueProject(t);
  await runFinish(project, { renderer: "remotion", animatic: true, music: "synth" }, animaticAdapters());
  const client = recordedModel({ launchclip_animatic_review: [{ verdict: "repair", summary: "One shot is staged wrong.", findings: [
    finding("f1", "major", "composition", "Sam asks the question with his back to Maya.", ["ask-001-browser-still"]),
    finding("f2", "minor", "typography", "The caption is small.", ["ask-001-browser-still"])
  ] }, { verdict: "ship", summary: "Reads well.", findings: [] }] });
  const result = await reviewAnimatic({ project, client });
  assert.equal(result.file, path.join(project, "qa/animatic-critic.json"));
  assert.equal(existsSync(path.join(project, "qa/critic.json")), false, "the final's critique is not written by the staging review");
  assert.match(client.requests[0].instructions, /reviewing an animatic/);
  assert.deepEqual(client.requests[0].schema.properties.findings.items.properties.category.enum, STAGING_CATEGORIES);
  const critique = await read(path.join(project, "qa/animatic-critic.json"));
  assert.deepEqual(critique.findings.map((entry) => entry.category), ["composition"], "a polish finding is dropped");
  assert.ok(result.warnings.some((warning) => /typography, which the staging review does not judge/.test(warning)));
  assert.equal(critique.reviewer.kind, "launchclip-animatic-staging-review");
  assert.deepEqual(result.animatic.review, { verdict: "repair", file: "qa/animatic-critic.json" });
  assert.equal(animaticApproved(result.animatic), false);

  const shipped = await reviewAnimatic({ project, client });
  assert.equal(shipped.animatic.review.verdict, "ship");
  assert.equal(animaticApproved({ ...shipped.animatic, gates_failed: [] }), true);
  assert.equal(animaticApproved({ ...shipped.animatic, gates_failed: ["motion"] }), false);
});

// The seeded bad shot: in "ask", Maya shrugs happily while she gives in.
const seedBadShot = (story) => {
  const maya = story.scenes.find((scene) => scene.id === "ask").params.cast.find((member) => member.id === "maya");
  maya.cues.find((cue) => cue.at === "word:Fine.").pose = "shrug";
  maya.cues.find((cue) => cue.at === "word:Fine.").expression = "happy";
};
const badShotFinding = finding("f1", "major", "acting", "Maya shrugs and smiles on \"Fine. One quick test.\"; she is giving in, so hands on hips and frustrated.", ["ask-001-browser-still"]);
// What the model answers: the "ask" scene with the cue fixed (and, wrongly, a retimed end and an edit to another scene).
function retakeAnswer(story) {
  const ask = structuredClone(story.scenes.find((scene) => scene.id === "ask"));
  const cue = ask.params.cast.find((member) => member.id === "maya").cues.find((entry) => entry.at === "word:Fine.");
  Object.assign(cue, { pose: "hands-on-hips", expression: "frustrated" });
  ask.end = "word:Oh.-0.5";
  const desk = structuredClone(story.scenes.find((scene) => scene.id === "desk"));
  desk.params.cast[0].expression = "happy";
  return { scenes_json: JSON.stringify([ask, desk]), note: "Maya puts her hands on her hips and frowns as she gives in." };
}

test("a seeded bad shot is fixed by a retake that re-renders only that shot", async (t) => {
  const project = await dialogueProject(t, seedBadShot);
  const adapters = animaticAdapters();
  const first = await runFinish(project, { renderer: "remotion", animatic: true, music: "synth" }, adapters);
  assert.equal(first.stages.find((stage) => stage.name === "render").details.segments.rendered, 6);
  const seeded = await read(path.join(project, "storyboard.json"));
  const client = recordedModel({
    launchclip_animatic_review: [{ verdict: "repair", summary: "One shot's acting is wrong.", findings: [badShotFinding] }, { verdict: "ship", summary: "The acting matches the line now.", findings: [] }],
    launchclip_retake: [retakeAnswer(seeded)]
  });
  const review = await reviewAnimatic({ project, client, shots: (await retakeProject(project)).shots });
  assert.equal(review.verdict, "repair");
  const calls = adapters.segmentCalls.length;
  const said = [];
  const result = await runRetakes({ project, review: "animatic", critique: review.critique, client, finish: { renderer: "remotion", music: "synth" }, finishAdapters: adapters, say: (line) => said.push(line) });

  assert.equal(result.status, "ship");
  assert.equal(result.rounds.length, 1);
  const [round] = result.rounds;
  assert.equal(round.error, undefined);
  assert.deepEqual({ step: round.step, shots: round.shots, rendered: round.rendered, changed: round.changed, kept: round.kept, before: round.verdict_before, after: round.verdict_after }, { step: "redirect", shots: ["ask"], rendered: ["ask"], changed: ["ask"], kept: true, before: "repair", after: "ship" });
  // Only the shot's own segment rendered again: frames 65–256 of 615.
  assert.equal(adapters.segmentCalls.length, calls + 1);
  assert.deepEqual(adapters.segmentCalls.at(-1), [[65, 256]]);
  assert.deepEqual(round.segments, { mode: "segments", total: 6, rendered: 1, reused: 5 });
  // The storyboard: the cue is fixed, the timing held, nothing else moved.
  const story = await read(path.join(project, "storyboard.json"));
  const cue = story.scenes[1].params.cast[0].cues.find((entry) => entry.at === "word:Fine.");
  assert.deepEqual({ pose: cue.pose, expression: cue.expression }, { pose: "hands-on-hips", expression: "frustrated" });
  assert.equal(story.scenes[1].end, seeded.scenes[1].end, "the animatic locked the timing");
  assert.deepEqual(story.scenes.filter((scene) => scene.id !== "ask"), seeded.scenes.filter((scene) => scene.id !== "ask"));
  assert.deepEqual(round.ignored, ["scene desk is outside the retake", "scene ask's start and end (the animatic locked the timing)"]);
  // The model was asked about that shot only, with the finding and what is said in it.
  const request = client.requests.find((entry) => entry.schemaName === "launchclip_retake");
  assert.match(request.input, /critic \(major acting, scene ask\): Maya shrugs and smiles/);
  assert.match(request.input, /maya: "Fine\. One quick test\."/);
  assert.equal(JSON.parse(request.input.slice(request.input.indexOf("[\n", request.input.indexOf("as they are now")))).length, 1);
  // qa/retakes.json, and the animatic now reviewed as ship.
  const retakes = await read(path.join(project, "qa/retakes.json"));
  assert.deepEqual({ schema: retakes.schema, review: retakes.review, status: retakes.status, limit: retakes.limit }, { schema: RETAKES_SCHEMA, review: "animatic", status: "ship", limit: 3 });
  assert.deepEqual(retakes.rounds[0].findings, [{ id: "f1", severity: "major", category: "acting", message: badShotFinding.message, shots: ["ask"] }]);
  assert.equal(retakes.rounds[0].tried, "Maya puts her hands on her hips and frowns as she gives in.");
  const animatic = await read(path.join(project, "ANIMATIC.json"));
  assert.equal(animatic.review.verdict, "ship");
  assert.equal((await readAnimatic(project)).fresh, true);
  assert.equal(existsSync(path.join(project, ".launchclip/retake")), false);
  assert.ok(said.some((line) => /retake 1 of 3: redirect ask/.test(line)));
});

test("a retake that does not help is undone, and a shot redirected once is replanned with its beat", async (t) => {
  const project = await dialogueProject(t, seedBadShot);
  const adapters = animaticAdapters();
  await runFinish(project, { renderer: "remotion", animatic: true, music: "synth" }, adapters);
  const seeded = await read(path.join(project, "storyboard.json"));
  const twoMajor = { verdict: "repair", summary: "", findings: [badShotFinding, finding("f2", "major", "composition", "Sam is cropped.", ["ask-001-encoded-draft"])] };
  const oneMajor = { verdict: "repair", summary: "", findings: [badShotFinding] };
  const steps = [];
  // Round 1 halves the findings (kept); round 2 escalates to the beat and does not help (undone).
  const critics = [{ status: "written", verdict: "repair", critique: oneMajor }, { status: "written", verdict: "repair", critique: oneMajor }];
  const result = await runRetakes({
    project, review: "animatic", critique: twoMajor, finish: { renderer: "remotion", music: "synth" }, finishAdapters: adapters,
    critic: async () => critics.shift(),
    redirect: async ({ step, shots, story, round }) => {
      steps.push([step, shots]);
      const next = structuredClone(story);
      next.scenes.find((scene) => scene.id === "ask").params.cast[1].expression = round === 1 ? "happy" : "surprised";
      return next;
    }
  });
  assert.deepEqual(steps, [["redirect", ["ask"]], ["replan-beat", ["ask"]]]);
  assert.deepEqual(result.rounds.map((round) => [round.step, round.kept]), [["redirect", true], ["replan-beat", false]]);
  assert.equal(result.rounds[1].reason, "the shot was redirected and still fails");
  assert.deepEqual(result.rounds[1].beats, ["problem", "attempt"]);
  assert.equal(result.status, "needs-repair");
  const story = await read(path.join(project, "storyboard.json"));
  assert.equal(story.scenes[1].params.cast[1].expression, "happy", "round 1 is kept, round 2 is undone");
  assert.notDeepEqual(story.scenes[1], seeded.scenes[1]);
  assert.equal((await read(path.join(project, "qa/retakes.json"))).status, "needs-repair");

  // A redirect that returns the storyboard unchanged is an error, recorded, not thrown.
  const idle = await runRetakes({ project, review: "animatic", critique: oneMajor, rounds: 1, finishAdapters: adapters, critic: async () => { throw new Error("not reached"); }, redirect: async ({ story }) => story });
  assert.equal(idle.rounds[0].error, "the retake changed no shot");
  // Findings that name no shot leave nothing to retake.
  const aimless = await runRetakes({ project, review: "animatic", critique: { verdict: "repair", findings: [finding("f9", "major", "narrative", "No hook.", [])] }, redirect: async () => { throw new Error("not reached"); } });
  assert.match(aimless.rounds[0].error, /name no shot; nothing to retake/);
});

test("redirectShots asks again when the answer does not validate, and gives up after that", async (t) => {
  const project = await dialogueProject(t, seedBadShot);
  const story = await read(path.join(project, "storyboard.json"));
  const state = await retakeProject(project);
  const bad = structuredClone(story.scenes[1]);
  bad.params.cast[0].pose = "moonwalk";
  const client = recordedModel({ launchclip_retake: [{ scenes_json: JSON.stringify([bad]), note: "" }, retakeAnswer(story)] });
  const fixed = await redirectShots({ client, project, story, words: state.loaded.words, shots: ["ask"], shotList: state.shots, problems: ["critic (major acting, scene ask): wrong pose"] });
  assert.equal(fixed.attempts, 2);
  assert.deepEqual(fixed.changed, ["ask"]);
  assert.match(client.requests[1].input, /Your last answer did not validate/);
  const stuck = recordedModel({ launchclip_retake: [{ scenes_json: "nope", note: "" }, { scenes_json: JSON.stringify([story.scenes[1]]), note: "" }] });
  await assert.rejects(redirectShots({ client: stuck, project, story, words: state.loaded.words, shots: ["ask"], shotList: state.shots }), /the retake did not validate: no scene was changed/);
});

test("launchclip finish --animatic --retake reviews the animatic and retakes the failing shot from the CLI", async (t) => {
  const project = await dialogueProject(t, seedBadShot);
  const adapters = animaticAdapters();
  const seeded = await read(path.join(project, "storyboard.json"));
  const client = recordedModel({
    launchclip_animatic_review: [{ verdict: "repair", summary: "", findings: [badShotFinding] }, { verdict: "ship", summary: "", findings: [] }],
    launchclip_retake: [retakeAnswer(seeded)]
  });
  const out = [];
  await runCli(["finish", project, "--animatic", "--retake", "--renderer", "remotion", "--music", "synth", "--json"], { stdout: { write: (text) => out.push(text) }, stderr: { write() {} }, productionAdapters: { finish: adapters, finishReview: { client: { client, provider: "openai", model: "gpt-5.6-luna", vision: true } } } });
  const report = JSON.parse(out.join("").slice(0, out.join("").lastIndexOf("}") + 1));
  assert.equal(report.review.verdict, "ship");
  assert.equal(report.review.file, "qa/animatic-critic.json");
  assert.deepEqual(report.review.reference_sheets, ["bible/sheets/maya.png", "bible/sheets/sam.png"]);
  assert.deepEqual({ status: report.retakes.status, file: report.retakes.file, rendered: report.retakes.rounds[0].rendered }, { status: "ship", file: "qa/retakes.json", rendered: ["ask"] });
  assert.deepEqual(adapters.segmentCalls.at(-1), [[65, 256]]);
  await assert.rejects(runCli(["finish", project, "--animatic", "--review", "--renderer", "remotion", "--music", "synth"], { stdout: { write() {} }, stderr: { write() {} }, productionAdapters: { finish: adapters, finishReview: { client: { client, provider: "ollama", model: "llama", vision: false } } } }), /needs a model that takes images/);
});

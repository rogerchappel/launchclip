// Plan-only mode: `launchclip make --stop-after storyboard` stops with the
// video planned and playable in a browser player, nothing rendered, and
// `--approve storyboard` renders that story. From a host whose 30-second video
// took 32 minutes, 17 of them in two full renders: the planning is what a
// person waits for, and a render is only needed on approve, publish or download.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { MAKE_EXIT_CODES, makeExitCode, parseFlags, runCli } from "../src/cli.js";
import { RENDER_ONLY_GATES, runFinish } from "../src/finish.js";
import { formatMakeSummary } from "../src/make/index.js";
import { MAKE_STOP_POINTS, makeOptionsFromFlags, validateMakeOptions } from "../src/make/options.js";
import { PLAYER_MANIFEST_FILE, PLAYER_MANIFEST_VERSION, storyFilePaths } from "../src/player_manifest.js";
import { animaticAdapters } from "./helpers/finish_offline.js";
import { progressEvents, projectFiles, recordedRun } from "./helpers/make_recorded_run.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
// The real finish, offline. A plan-only run gets a renderer and a still that fail the test if anything asks for them.
const real = (finishAdapters) => ({ adapters: { finish: undefined, finishAdapters } });
const noRender = () => ({
  ...real({ ...animaticAdapters(), renderer: () => { throw new Error("plan-only asked for a renderer"); }, withSlot: () => { throw new Error("plan-only asked for a render slot"); }, master: () => { throw new Error("plan-only mastered"); }, buildEvidence: () => { throw new Error("plan-only built evidence"); } })
});
const PLAN = { stopAfter: "storyboard", critic: false };

async function planned() {
  const fixture = await recordedRun({ screenshots: [] });
  const hooks = noRender();
  hooks.adapters.candidateStill = () => { throw new Error("plan-only rendered a candidate still"); };
  const first = await fixture.run(PLAN, hooks);
  return { fixture, first };
}

test("--stop-after storyboard: the run ends awaiting-approval with the video planned and nothing rendered", async () => {
  const { fixture, first } = await planned();
  try {
    const { report, lines } = first;
    assert.equal(report.status, "awaiting-approval", JSON.stringify(report.stages));
    assert.equal(report.stopped.after, "storyboard");
    assert.match(report.stopped.reason, /nothing rendered/);
    assert.equal(makeExitCode(report), MAKE_EXIT_CODES["awaiting-approval"], "the exit code awaiting-approval already has");
    assert.deepEqual(Object.entries(report.stages).map(([name, stage]) => `${name}:${stage.status}`), ["model:done", "inventory:done", "demo:skipped", "route:done", "prepare:done", "bible:skipped", "storyboard:done", "candidates:skipped", "animatic:skipped", "subject:skipped", "plan:done", "finish:skipped", "critic:skipped"]);
    assert.equal(report.final, null);
    assert.equal(report.gates, null, "gates are the rendered video's; the plan's checks are under plan.checks");
    assert.ok(!existsSync(path.join(fixture.project, "renders")), "no render was written");
    assert.ok(!existsSync(path.join(fixture.project, "qa", "temporal-evidence")), "no evidence was built");
    // How to render, both ways.
    assert.match(report.next_steps.join("\n"), /--approve storyboard/);
    assert.match(report.next_steps.join("\n"), new RegExp(`launchclip finish ${fixture.project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} --renderer remotion`));
    assert.match(formatMakeSummary(report), /launchclip make: awaiting-approval/);
    assert.match(formatMakeSummary(report), /plan: PLAYER-MANIFEST\.json \(\d+ files for a player\); checks (passed|failed)/);
    // The progress lines name the stage and its steps; none is a render.
    const events = progressEvents(lines);
    assert.deepEqual(events.filter((event) => event.stage === "plan" && event.step).map((event) => event.step), ["voice", "validate", "captions", "sound", "plan"]);
    assert.ok(!events.some((event) => event.stage === "finish" && event.step), "finish did not start");
  } finally {
    await fixture.cleanup();
  }
});

test("a planned project holds what a player needs, and the manifest lists each file with its role, size and hash", async () => {
  const { fixture, first } = await planned();
  try {
    const { report } = first;
    const project = fixture.project;
    const manifest = await json(path.join(project, PLAYER_MANIFEST_FILE));
    assert.equal(manifest.schema_version, PLAYER_MANIFEST_VERSION);
    assert.equal(manifest.story, report.plan.story);
    assert.deepEqual(manifest.missing, []);
    const resolved = await json(path.join(project, manifest.story));
    // The resolved story, as the renderers read it: numeric scene times, the audio and the captions filled in.
    assert.ok(resolved.scenes.every((scene) => typeof scene.start === "number" && typeof scene.end === "number"));
    assert.equal(resolved.audio.voice, "assets/audio/narration.wav");
    assert.equal(resolved.audio.words, "NARRATION.json");
    assert.equal(resolved.audio.mix, "assets/audio/mix.wav");
    assert.equal(resolved.overlays.find((overlay) => overlay.type === "captions").src, "assets/captions/captions.json");
    const roles = Object.fromEntries(manifest.files.map((file) => [file.path, file.role]));
    assert.deepEqual(roles, {
      [manifest.story]: "story",
      "NARRATION.json": "words",
      "assets/audio/mix.wav": "mix",
      "assets/audio/narration.wav": "narration",
      "assets/captions/captions.json": "captions",
      "assets/ui.mp4": "media",
      "assets/audio/kit/music/bed.wav": "music",
      "assets/audio/cues.json": "sfx-cues"
    });
    // The music bed and the cue list are inside the mix: listed for a host, not fetched by the player.
    assert.deepEqual(manifest.files.filter((file) => !file.player).map((file) => file.role), ["music", "sfx-cues"]);
    for (const file of manifest.files) {
      const bytes = await readFile(path.join(project, file.path));
      assert.equal(file.bytes, (await stat(path.join(project, file.path))).size, file.path);
      assert.equal(file.sha256, createHash("sha256").update(bytes).digest("hex"), file.path);
    }
    assert.equal(manifest.bytes, manifest.files.filter((file) => file.player).reduce((sum, file) => sum + file.bytes, 0));
    // Every file the story names is in the project and in the manifest.
    for (const file of storyFilePaths(resolved)) assert.ok(file in roles && existsSync(path.join(project, file)), file);
    // The word timings and the captions the renderers draw.
    const words = (await json(path.join(project, "NARRATION.json"))).words;
    assert.ok(words.length > 10 && words.every((word) => word.end >= word.start));
    const captions = await json(path.join(project, "assets/captions/captions.json"));
    assert.equal(captions.chunks.reduce((sum, chunk) => sum + chunk.words.length, 0), words.length);
    // What the audio is, and what the preview will not match.
    assert.deepEqual(manifest.audio, { track: "assets/audio/mix.wav", narration: "assets/audio/narration.wav", words: "NARRATION.json", music: { provider: "synth", file: "assets/audio/kit/music/bed.wav" }, sfx: { mode: "kit", cues: manifest.audio.sfx.cues }, mastered: false });
    assert.ok(manifest.audio.sfx.cues > 0);
    assert.match(manifest.not_in_preview.join("\n"), /unmastered mix/);
    assert.match(manifest.not_in_preview.join("\n"), /pixel gates/);
    assert.deepEqual(report.plan.audio, manifest.audio);
    assert.equal(report.plan.files, manifest.files.filter((file) => file.player).length);
  } finally {
    await fixture.cleanup();
  }
});

test("the checks that need no rendered pixels run at plan time, and the report says which wait for the render and how long planning took", async () => {
  const { fixture, first } = await planned();
  try {
    const { plan } = first.report;
    const names = Object.keys(plan.checks.gates);
    for (const name of ["placeholders", "layout", "physics", "ghosting", "density", "variety", "holds", "states", "direction", "acting", "coverage", "structure", "hook"]) assert.ok(names.includes(name), `${name} ran at plan time`);
    for (const name of RENDER_ONLY_GATES) assert.ok(!names.includes(name), `${name} needs the render`);
    assert.deepEqual(plan.checks.needs_render, [...RENDER_ONLY_GATES]);
    assert.equal(plan.checks.gates.layout.status, "passed");
    assert.equal(plan.checks.script.ok, true, "the script's own checks (reading time, the brief) are recorded");
    assert.deepEqual(plan.checks.storyboard, { valid_first_attempt: false, repairs: 1 });
    // A failing check does not fail the run: it is reported, with the finding, before any render.
    assert.deepEqual(plan.checks.failed, names.filter((name) => plan.checks.gates[name].status === "failed"));
    assert.equal(plan.checks.status, plan.checks.failed.length ? "failed" : "passed");
    for (const name of plan.checks.failed) {
      assert.ok(plan.checks.gates[name].findings?.length || plan.checks.gates[name].errors?.length || plan.checks.gates[name].error, `${name} says what failed`);
      assert.ok(first.report.warnings.some((line) => line.startsWith(`plan: the ${name} check fails`)));
    }
    // Timings: every make stage that ran, and the steps of the plan stage.
    assert.deepEqual(Object.keys(plan.timings.stages), ["model", "inventory", "demo", "route", "prepare", "bible", "storyboard", "candidates", "animatic", "subject", "plan"]);
    assert.deepEqual(Object.keys(plan.timings.steps), ["voice", "validate", "captions", "sound", "plan"]);
    assert.ok(Object.values({ ...plan.timings.stages, ...plan.timings.steps }).every((seconds) => typeof seconds === "number" && seconds >= 0));
    assert.equal(typeof plan.timings.seconds, "number");
    // finish.json says the same, with status planned.
    const finish = await json(path.join(fixture.project, "finish.json"));
    assert.equal(finish.status, "planned");
    assert.equal(finish.final, null);
    assert.deepEqual(finish.stages.map((stage) => `${stage.name}:${stage.status}`), ["voice:done", "validate:done", "captions:done", "sound:done", "plan:done", "render:skipped", "master:skipped", "evidence:skipped", "gates:skipped"]);
  } finally {
    await fixture.cleanup();
  }
});

// What differs between two runs of the same story by design: reports with timings and clocks, and the plan's own manifest.
const VOLATILE = new Set(["MAKE.json", "finish.json", ".launchclip/make-state.json", ".launchclip/finish-state.json", PLAYER_MANIFEST_FILE]);
// Wall-clock stamps aside (used_at, created_at, elapsed_ms) and the flags that say what a rerun took from a cache: the segment keys hash the story and its assets.
const stable = (files) => Object.fromEntries(Object.entries(files).filter(([name]) => !VOLATILE.has(name) && !name.startsWith(".launchclip/tmp")).map(([name, text]) => [name, text.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, "<clock>").replace(/"elapsed_ms": \d+/g, '"elapsed_ms": 0').replace(/"cached": (true|false)/g, '"cached": "<run>"')]));

test("--approve storyboard renders the planned story, reusing every finished step: the video is the uninterrupted run's", async () => {
  // The uninterrupted run, on the same recorded answers (candidates off: a planned story is rendered as it was shown).
  const whole = await recordedRun({ screenshots: [] });
  const { fixture, first } = await planned();
  try {
    const straight = await whole.run({ critic: false, candidates: "off" }, real(animaticAdapters()));
    assert.equal(straight.report.stages.finish.status, "done", JSON.stringify(straight.report.stages));

    // The same command again, still without the approval: it stops again, and asks the model nothing.
    const still = await fixture.run(PLAN, noRender());
    assert.equal(still.report.status, "awaiting-approval");
    assert.equal(still.report.stages.storyboard.status, "cached");
    assert.deepEqual(still.calls, first.calls, "no model call on a rerun");

    const adapters = animaticAdapters();
    const resumed = await fixture.run({ ...PLAN, approve: "storyboard" }, real(adapters));
    const { report } = resumed;
    assert.equal(report.status, straight.report.status);
    assert.equal(report.stopped, undefined);
    assert.equal(report.stages.plan.status, "skipped");
    assert.match(report.stages.plan.reason, /approved/);
    assert.equal(report.stages.finish.status, "done");
    assert.deepEqual(resumed.calls, first.calls, "the render asks the model nothing: the script and the storyboard are reused");
    // finish reused the plan's voice, captions and sound, and rendered once.
    const stages = Object.fromEntries(report.finish.stages.map((stage) => [stage.name, stage.status]));
    assert.deepEqual([stages.voice, stages.captions, stages.sound, stages.render, stages.master], ["cached", "cached", "cached", "done", "done"]);
    assert.equal(adapters.segmentCalls.length, 1);
    assert.equal(report.final, straight.report.final);
    assert.deepEqual(report.gates, straight.report.gates);

    // The rendered video and everything beside it are the uninterrupted run's.
    const a = stable(await projectFiles(whole.project, whole));
    const b = stable(await projectFiles(fixture.project, fixture));
    assert.deepEqual(Object.keys(b), Object.keys(a));
    for (const name of Object.keys(a)) assert.equal(b[name], a[name], name);
    assert.ok(a["renders/draft.mp4"].length > 0);
    // The manifest of the plan is still there after the render.
    assert.ok(existsSync(path.join(fixture.project, PLAYER_MANIFEST_FILE)));
  } finally {
    await Promise.all([fixture.cleanup(), whole.cleanup()]);
  }
});

test("the finish command prints its progress on stderr: each step as it starts, then how it ended", async () => {
  const { fixture } = await planned();
  try {
    const lines = [];
    const io = { stdout: { write: () => {} }, stderr: { write: (text) => lines.push(...String(text).split("\n").filter(Boolean)) }, productionAdapters: { finish: noRender().adapters.finishAdapters } };
    await runCli(["finish", fixture.project, "--plan-only", "--renderer", "remotion", "--music", "synth", "--sfx", "kit", "--json"], io);
    const events = progressEvents(lines);
    assert.ok(events.every((event) => event.stage === "finish"), JSON.stringify(events));
    assert.deepEqual(events.filter((event) => event.step).map((event) => event.step), ["voice", "validate", "captions", "sound", "plan"]);
    assert.equal(events.at(-1).status, "planned");
    assert.match(lines.filter((line) => line.startsWith("launchclip:progress ")).at(-1), /"status":"planned","seconds":[\d.]+\}$/);
  } finally {
    await fixture.cleanup();
  }
});

test("launchclip finish renders a planned project too, and --plan-only refreshes the plan after an edit without rendering", async () => {
  const { fixture } = await planned();
  try {
    const project = fixture.project;
    const before = await json(path.join(project, PLAYER_MANIFEST_FILE));
    // An edit to the storyboard after the preview: the plan and the manifest follow it, and nothing renders.
    const story = await json(path.join(project, "storyboard.json"));
    story.scenes[1].params.headline = "Ledgerly matches every single payout";
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story, null, 2));
    const options = { renderer: "remotion", music: "synth", sfx: "kit", musicFallback: true };
    const again = await runFinish(project, { ...options, planOnly: true }, noRender().adapters.finishAdapters);
    assert.equal(again.status, "planned", JSON.stringify(again.stages));
    const after = await json(path.join(project, PLAYER_MANIFEST_FILE));
    assert.notEqual(after.files[0].sha256, before.files[0].sha256, "the resolved story changed");
    assert.equal((await json(path.join(project, after.story))).scenes[1].params.headline, "Ledgerly matches every single payout");
    assert.ok(!existsSync(path.join(project, "renders")));
    // The render, from the planned project.
    const finished = await runFinish(project, options, animaticAdapters());
    assert.ok(["ready-for-review", "needs-repair"].includes(finished.status), finished.status);
    assert.ok(existsSync(path.join(project, "renders/draft.mp4")));
    const stages = Object.fromEntries(finished.stages.map((stage) => [stage.name, stage.status]));
    assert.deepEqual([stages.voice, stages.captions, stages.render], ["cached", "cached", "done"]);
    await assert.rejects(() => runFinish(project, { ...options, planOnly: true, animatic: true }, noRender().adapters.finishAdapters), /--plan-only renders nothing/);
  } finally {
    await fixture.cleanup();
  }
});

test("an approval is of a storyboard that exists: a run that has to plan stops again", async () => {
  const fixture = await recordedRun({ screenshots: [] });
  try {
    const { report } = await fixture.run({ ...PLAN, approve: "storyboard" }, noRender());
    assert.equal(report.stages.storyboard.status, "done");
    assert.equal(report.status, "awaiting-approval");
    assert.equal(report.stopped.after, "storyboard");
  } finally {
    await fixture.cleanup();
  }
});

test("storyPlayerProps takes the planned story, and every path it reads is in the manifest", async () => {
  const { fixture } = await planned();
  const out = await mkdtemp(path.join(os.tmpdir(), "launchclip-kit-bundle-"));
  const realFetch = globalThis.fetch;
  try {
    // The kit as a host bundles it (TypeScript and JSX), for Node.
    const bundle = path.join(out, "kit.mjs");
    await build({ entryPoints: [path.join(ROOT, "kit", "remotion", "index.ts")], bundle: true, format: "esm", platform: "node", outfile: bundle, logLevel: "silent" });
    const kit = await import(pathToFileURL(bundle).href);
    const project = fixture.project;
    const manifest = await json(path.join(project, PLAYER_MANIFEST_FILE));
    const listed = new Map(manifest.files.map((file) => [file.path, file]));
    // A host uploads the manifest's files and swaps in URLs with the asset resolver.
    const HOST = "https://media.example.test/project-1/";
    const fetched = [];
    kit.setAssetResolver((src) => `${HOST}${src}`);
    globalThis.fetch = async (url) => {
      const file = String(url).slice(HOST.length);
      assert.ok(String(url).startsWith(HOST), `${url} went through the resolver`);
      fetched.push(file);
      assert.ok(listed.has(file), `${file} is in the manifest`);
      const text = await readFile(path.join(project, file), "utf8");
      return { ok: true, json: async () => JSON.parse(text), text: async () => text };
    };
    const story = await json(path.join(project, manifest.story));
    const props = await kit.storyPlayerProps(story);
    assert.equal(props.component, kit.StoryComposition);
    assert.equal(props.fps, manifest.format.fps);
    assert.equal(props.compositionWidth, manifest.format.width);
    assert.equal(props.compositionHeight, manifest.format.height);
    assert.equal(props.durationInFrames, Math.round(manifest.format.duration * manifest.format.fps));
    // The captions were loaded from the planned captions file, through the resolver.
    assert.deepEqual(fetched, ["assets/captions/captions.json"]);
    assert.ok(props.inputProps.__captions.length > 0);
    assert.equal(props.inputProps.__captions.reduce((sum, chunk) => sum + chunk.words.length, 0), (await json(path.join(project, "NARRATION.json"))).words.length);
    // Every file the Player's props name is a manifest file the player fetches.
    const named = storyFilePaths(props.inputProps);
    assert.ok(named.includes("assets/audio/mix.wav") && named.includes("assets/ui.mp4"));
    for (const file of named) assert.equal(listed.get(file)?.player, true, `${file} is in the manifest`);
    assert.equal(kit.assetUrl("assets/audio/mix.wav"), `${HOST}assets/audio/mix.wav`);
    kit.setAssetResolver(null);
  } finally {
    globalThis.fetch = realFetch;
    await rm(out, { recursive: true, force: true });
    await fixture.cleanup();
  }
});

test("--stop-after storyboard and --approve storyboard: the flags, their values and the exit code", () => {
  assert.ok(MAKE_STOP_POINTS.includes("storyboard"));
  assert.deepEqual(parseFlags(["--stop-after", "storyboard", "--approve", "storyboard"]), { "stop-after": "storyboard", approve: "storyboard" });
  assert.deepEqual(parseFlags(["--approve", "bible,storyboard"]), { approve: "bible,storyboard" });
  const options = makeOptionsFromFlags({ "stop-after": "storyboard", approve: "storyboard" });
  assert.deepEqual([options.stopAfter, options.approve], ["storyboard", "storyboard"]);
  assert.doesNotThrow(() => validateMakeOptions(options));
  assert.equal(parseFlags(["--plan-only"])["plan-only"], true);
  // An ordinary video that waits for its approval exits 3; its other statuses keep their codes.
  assert.equal(makeExitCode({ status: "awaiting-approval", stopped: { after: "storyboard" }, routing: { kind: "motion" } }), 3);
  assert.equal(makeExitCode({ status: "ready-for-review", routing: { kind: "motion" } }), 0);
  assert.equal(makeExitCode({ status: "ready", routing: { kind: "motion" } }), 0);
  assert.equal(makeExitCode({ status: "needs-repair", routing: { kind: "motion" } }), 2);
});

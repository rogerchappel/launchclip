// Retake rounds for a character story (docs/ANIMATION_PIPELINE_RFC.md §4.7).
//
// The critic (or the animatic's staging review) names shots through its
// evidence. While it does not say ship and rounds remain (three at most), a
// round fixes the failing shots by the cheapest step that could work
// (retakeStep in critic_repair.js): step 1 redirects the shot (its cues,
// framing or set); step 3 replans every shot of the story beat. Only the
// scenes the retake changed render again (finish --scene), then the critic
// looks again. A round that fails, changes nothing or does not lower the
// blocking and major findings is undone and the rounds stop. A retake the
// validator turns down goes back to the model once with its messages before
// the round gives up. Every round is recorded in qa/retakes.json
// (launchclip.retakes.v1), with each attempt's messages (attempts, rejected).
//
// Step 2 (drop a shot's handed-in art) belongs to the hand-in phases.
//
//   runRetakes(options)   the rounds, on an existing project
//   redirectShots(options) the default step: one small, validated model call
//
// Everything a round touches is a hook (redirect, render, critic), so make
// can pass its own planner and its own finish and critic stages.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { directionCastLines } from "@launchclip/core/planning-prompt.mjs";
import { ACTIONS, NAMED_TARGETS } from "@launchclip/core/characters/actions.mjs";
import { ANIMATIC_FILE, ANIMATIC_REVIEW_FILE } from "../animatic.js";
import { readProjectStory } from "../story_loader.js";
import { applyProjectStyle } from "../story_style.js";
import { resolveStory } from "../story.js";
import { directionFileFor, moduleParamErrors, readScriptBeside, validateStory } from "../story_cli.js";
import { shotList } from "../story_shots.js";
import { CRITIC_FILE, reviewAnimatic, runHeadlessCritic } from "./critic.js";
import { RETAKES_FILE, changedScenes, criticImproved, criticRepairBudget, criticScore, findingScenes, retakeProblems, retakeRound, retakeStep, retakesDocument, scopedRetake } from "./critic_repair.js";

// What a round may overwrite, so a round that does not help can be undone.
const ROUND_FILES = ["storyboard.json", "DIRECTION.json", "finish.json", "publish.json", ANIMATIC_FILE, "AUDIO-MANIFEST.json", "qa", "renders", ".launchclip/finish", ".launchclip/finish-state.json"];
const SNAPSHOT_DIR = path.join(".launchclip", "retake", "before");

export const REDIRECT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["scenes_json", "note"],
  properties: {
    // A JSON array of the scenes named, each complete.
    scenes_json: { type: "string" },
    // One sentence: what was changed and why it answers the findings.
    note: { type: "string" }
  }
});

const REDIRECT_INSTRUCTIONS = `You are directing a retake of a character story drawn in code by a character rig. A reviewer watched the last cut and found problems in the shots below. Return those scenes again, changed so the problems are gone.

You may change, inside each scene's params: each character's opening pose and expression, the cues (a pose or expression change at a word anchor), the set, the framing (params.shot), and which characters of the cast are in the shot.
You may not change: a scene's id, module, start, end or track; who speaks ("says"); the narration; anything outside the scenes named. The timing is locked.

Rules:
- A character who speaks during the shot stays in it, and so does a character an action below names.
- Keep every action listed as "must still happen" under a shot: the same character, the same action, on a word of that line. You may change its target and everything around it.
- Use only the poses, expressions and sets listed, and only characters of the cast.
- A cue's "at" is a word said during the shot ("word:<text>": the word as it is said in this shot, even when the narration says it earlier too), or seconds from the shot's start. Never seconds from the start of the video.
- A walk-to goes as far toward its target as the shot leaves time for; give it at least half a second before the shot ends.
- Change as little as answers the findings. Do not return a scene unchanged.

Return scenes_json (a JSON array holding every scene named, each complete) and note (one sentence: what you changed).`;

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

/** The project as a retake reads it: {raw (storyboard.json as written), loaded (readProjectStory), shots, map, script}. */
export async function retakeProject(project) {
  const storyFile = path.join(project, "storyboard.json");
  const raw = await readJson(storyFile);
  if (!raw) throw new Error(`a retake needs ${storyFile}`);
  const loaded = await readProjectStory(project);
  const map = await readJson(directionFileFor(storyFile));
  const script = await readScriptBeside(project);
  return { raw, loaded, map, script, shots: shotList(loaded.resolved, { map, words: loaded.words, script }).shots };
}

// The errors a retaken storyboard would fail finish's validate stage on.
async function storyErrors(project, story, words) {
  try {
    const styled = (await applyProjectStyle(structuredClone(story), { projectDir: project })).story;
    const check = validateStory(styled);
    if (!check.ok) return check.errors;
    return moduleParamErrors(resolveStory(styled, { words }));
  } catch (error) {
    return [String(error?.message ?? error).split("\n")[0]];
  }
}

/**
 * The default retake step: the model re-directs the scenes named and nothing
 * else. One call, and one corrective call with the validator's messages if
 * the result does not validate.
 * options: {client (runStructured), project, story (storyboard.json as
 * written), words, step ("redirect"|"replan-beat"), shots (scene ids it may
 * change), shotList (the shot list's shots), problems (retakeProblems),
 * check(story) → [errors] (the caller's own checks on the retaken storyboard,
 * answered in the same corrective call)}
 * → {story, changed, ignored, note, attempts, rejected: [{attempt, errors}],
 * usage: [..], model}; throws when the result changes no shot or still does
 * not validate, with the same attempts, rejected and usage on the error.
 */
export async function redirectShots({ client, project, story, words = [], step = "redirect", shots = [], shotList: list = [], problems = [], maxRepairs = 1, check = null } = {}) {
  if (!client || typeof client.runStructured !== "function") throw new Error("a retake needs a model client with runStructured(), or its own redirect hook");
  const wanted = new Set(shots);
  const scenes = (story?.scenes ?? []).filter((scene) => wanted.has(scene.id));
  if (!scenes.length) throw new Error(`the storyboard has none of the shots named (${shots.join(", ")})`);
  const lines = [
    step === "replan-beat" ? `Replan this story beat: its ${scenes.length} shot(s) together. The findings say the beat does not read; restage it (who is in each shot, the set, the framing, the acting).` : `Redirect ${scenes.length === 1 ? "this shot" : `these ${scenes.length} shots`}: new cues, framing or set.`,
    "",
    "What the reviewer found:",
    ...problems.map((line) => `- ${line}`),
    "",
    "The cast:",
    ...directionCastLines(story?.cast).map((line) => `- ${line}`),
    "- framing (params.shot): one of wide, medium, close, or leave it out.",
    `- target (a character's, or a cue's): exactly one of ${NAMED_TARGETS.join(", ")}, {"character": "<id of someone else in the shot>"} or {"prop": "<id>"}. Nothing else: not "centre", not "front", not a description.`,
    "- position: left, centre or right; a shot with one character takes centre only.",
    "",
    "What is said during each shot:"
  ];
  for (const shot of list.filter((entry) => wanted.has(entry.id))) {
    lines.push(`  ${shot.id} (${shot.start}–${shot.end} s, who: ${(shot.who ?? []).join(", ") || "nobody"}):`);
    for (const line of shot.lines ?? []) lines.push(`    ${line.speaker ?? "?"}: "${line.text}"${line.playing ? `  [${line.playing}]` : ""}`);
    // The direction map's key actions: the checks hold the retake to them.
    for (const action of shot.actions ?? []) lines.push(`    must still happen in this shot: ${action.who} ${ACTIONS.includes(action.verb) ? `performs a cue with action "${action.verb}"` : `takes the pose "${action.verb}"`}${action.target ? ` (${typeof action.target === "string" ? action.target : JSON.stringify(action.target)})` : ""}, on a word of its line`);
  }
  lines.push("", "The scenes to return, as they are now:", JSON.stringify(scenes, null, 2));
  const usage = [];
  const rejected = [];
  let model = null;
  let errors = [];
  let attempts = 0;
  for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
    const input = errors.length ? `${lines.join("\n")}\n\nYour last answer did not validate. Fix these and return every scene again:\n${errors.map((error) => `- ${error}`).join("\n")}\n` : `${lines.join("\n")}\n`;
    const result = await client.runStructured({ instructions: REDIRECT_INSTRUCTIONS, input, schema: REDIRECT_SCHEMA, schemaName: "launchclip_retake", maxOutputTokens: 6000 });
    attempts = attempt + 1;
    usage.push({ usage: result?.usage ?? {}, model: result?.model ?? null });
    model = result?.model ?? model;
    let proposed = null;
    try { proposed = JSON.parse(result?.value?.scenes_json ?? ""); } catch { proposed = null; }
    if (proposed && !Array.isArray(proposed) && Array.isArray(proposed.scenes)) proposed = proposed.scenes;
    let scoped = null;
    if (!Array.isArray(proposed)) errors = ["scenes_json is not a JSON array of scenes"];
    else {
      scoped = scopedRetake(story, { scenes: proposed }, shots);
      if (!scoped.changed.length) errors = ["no scene was changed; change the acting, the framing or the set of the shots named"];
      else {
        errors = await storyErrors(project, scoped.story, words);
        if (!errors.length && typeof check === "function") errors = [...(check(scoped.story) ?? [])];
      }
    }
    if (!errors.length) return { ...scoped, note: String(result?.value?.note ?? "").trim() || null, attempts, rejected, usage, model };
    rejected.push({ attempt: attempts, errors: errors.slice(0, RETAKE_ERRORS) });
  }
  throw Object.assign(new Error(`the retake did not validate after ${attempts} attempt${attempts === 1 ? "" : "s"}: ${errors.slice(0, 3).join("; ")}`), { attempts, rejected, usage, model });
}

// How many of an attempt's validator messages go back to the model's record (qa/retakes.json).
const RETAKE_ERRORS = 8;

async function snapshot(project) {
  const dir = path.join(project, SNAPSHOT_DIR);
  await rm(dir, { recursive: true, force: true });
  const files = [];
  for (const rel of ROUND_FILES) {
    const from = path.join(project, rel);
    if (!existsSync(from)) continue;
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await cp(from, path.join(dir, rel), { recursive: true });
    files.push(rel);
  }
  return { dir, files };
}

async function restore(project, saved) {
  for (const rel of ROUND_FILES) {
    const to = path.join(project, rel);
    await rm(to, { recursive: true, force: true });
    if (saved.files.includes(rel)) await cp(path.join(saved.dir, rel), to, { recursive: true });
  }
}

/**
 * Run retake rounds on a project that has been rendered and reviewed.
 *
 * options:
 *   project
 *   review: "final" (qa/critic.json; default) or "animatic"
 *     (qa/animatic-critic.json; renders go to renders/animatic.mp4)
 *   critique: the review to start from (default: read from the review's file)
 *   rounds: how many rounds at most (0–3, default 3; criticRepairBudget)
 *   client, model, provider: the model for the default redirect and critic
 *   finish: options for the default render (runFinish), e.g. {renderer, music}
 *   finishAdapters: runFinish adapters for the default render
 *   redirect({project, round, step, shots, failing, beats, problems, findings, story, words, shotList})
 *     → a storyboard, or {story, note?, usage?}: the retaken storyboard.
 *     Only the scenes in `shots` are taken from it (scopedRetake).
 *   render({project, scenes, round}) → a finish report
 *   critic({project, round, shots}) → runHeadlessCritic's result
 *   say(line), now()
 * → {status: "ship"|"needs-repair", verdict, critique, rounds, file, usage}
 * Never throws for a round that fails: the round is recorded and undone.
 */
export async function runRetakes(options = {}) {
  const project = path.resolve(options.project);
  const review = options.review ?? "final";
  const staging = review === "animatic";
  const budget = criticRepairBudget(options.rounds);
  const say = options.say ?? (() => {});
  const now = options.now ?? (() => performance.now());
  const critiqueFile = path.join(project, staging ? ANIMATIC_REVIEW_FILE : CRITIC_FILE);
  let critique = options.critique ?? await readJson(critiqueFile);
  if (!critique?.verdict) throw new Error(`a retake starts from a review: ${critiqueFile} is missing or has no verdict (run the ${staging ? "staging review" : "critic"} first)`);
  const usage = [];
  const redirect = options.redirect ?? ((args) => redirectShots({ client: options.client, ...args }));
  const render = options.render ?? (async ({ scenes }) => (await import("../finish.js")).runFinish(project, { ...(options.finish ?? {}), ...(staging ? { animatic: true } : {}), scenes }, options.finishAdapters ?? {}));
  const critic = options.critic ?? (({ shots }) => (staging ? reviewAnimatic : runHeadlessCritic)({ project, client: options.client, model: options.model ?? null, provider: options.provider ?? null, shots, ...(staging ? {} : { review: "final" }) }));
  const rounds = [];
  for (let round = 1; round <= budget; round += 1) {
    if (critique.verdict === "ship") break;
    const before = criticScore(critique);
    const state = await retakeProject(project);
    const manifest = await readJson(path.join(project, "qa/temporal-evidence/manifest.json"));
    const findings = findingScenes(critique.findings, manifest?.entries ?? [], state.loaded.resolved?.scenes ?? []);
    const plan = retakeStep(critique, findings, state.shots, rounds);
    const entry = retakeRound({ round, plan, findings, before });
    rounds.push(entry);
    if (!plan.step) {
      entry.error = `${plan.reason}; nothing to retake`;
      say(`retake ${round}: ${entry.error}`);
      break;
    }
    say(`retake ${round} of ${budget}: ${plan.step} ${plan.shots.join(", ")} (${plan.reason}; ${before.blocking} blocking, ${before.major} major)`);
    const started = now();
    const saved = await snapshot(project);
    let next = critique;
    try {
      const answer = await redirect({ project, round, step: plan.step, shots: plan.shots, failing: plan.failing, beats: plan.beats, problems: retakeProblems(findings, plan.failing), findings, story: state.raw, words: state.loaded.words, shotList: state.shots });
      if (Array.isArray(answer?.usage)) usage.push(...answer.usage.map((item) => ({ stage: `retake-${round}-${plan.step}`, ...item })));
      if (Number.isInteger(answer?.attempts)) entry.attempts = answer.attempts;
      if (Array.isArray(answer?.rejected) && answer.rejected.length) entry.rejected = answer.rejected;
      const proposed = answer?.story?.scenes ? answer.story : answer;
      const scoped = scopedRetake(state.raw, proposed, plan.shots);
      if (!scoped.changed.length) throw new Error("the retake changed no shot");
      await writeFile(path.join(project, "storyboard.json"), `${JSON.stringify(scoped.story, null, 2)}\n`);
      const after = await readProjectStory(project);
      const changed = changedScenes(state.loaded.resolved, after.resolved);
      if (changed === null) throw new Error("the retake moved the timeline; a retake may not change when a shot starts or ends");
      const scenes = changed.length ? changed : scoped.changed;
      const ignored = [...new Set([...(Array.isArray(answer?.ignored) ? answer.ignored : []), ...scoped.ignored])];
      Object.assign(entry, { tried: answer?.note ?? `${plan.step} of ${scoped.changed.join(", ")}`, changed: scoped.changed, ...(ignored.length ? { ignored } : {}) });
      const report = await render({ project, scenes, round });
      if (report?.status === "failed") {
        const failed = (report.stages ?? []).find((stage) => stage.status === "failed");
        throw new Error(`the render failed at the ${failed?.name ?? "unknown"} stage: ${String(failed?.error ?? "").split("\n")[0]}`);
      }
      const segments = (report?.stages ?? []).find((stage) => stage.name === "render")?.details?.segments ?? null;
      entry.rendered = scenes;
      if (segments) entry.segments = { mode: segments.mode, total: segments.segments ?? null, rendered: segments.rendered ?? null, reused: segments.reused ?? null };
      const result = await critic({ project, round, shots: (await retakeProject(project)).shots });
      if (result?.usage) usage.push({ stage: `retake-${round}-critic`, usage: result.usage, model: result.model ?? null, cost_usd: result.cost_usd });
      if (result?.status !== "written") throw new Error(`the critic did not run again (${result?.reason ?? result?.status})`);
      next = result.critique ?? await readJson(critiqueFile) ?? { verdict: result.verdict, findings: [] };
      const score = criticScore(next);
      Object.assign(entry, { verdict_after: score.verdict, findings_after: score, kept: criticImproved(before, score) });
    } catch (error) {
      entry.error = String(error?.message ?? error).split("\n")[0];
      // A retake the validator turned down: what each attempt was told, and what the calls cost.
      if (Number.isInteger(error?.attempts)) entry.attempts = error.attempts;
      if (Array.isArray(error?.rejected) && error.rejected.length) entry.rejected = error.rejected;
      if (Array.isArray(error?.usage)) usage.push(...error.usage.map((item) => ({ stage: `retake-${round}-${plan.step}`, ...item })));
    }
    entry.seconds = Math.round((now() - started) / 100) / 10;
    if (entry.kept) {
      critique = next;
      say(`retake ${round}: kept (${entry.verdict_before} → ${entry.verdict_after}; blocking + major ${before.blocking + before.major} → ${entry.findings_after.blocking + entry.findings_after.major}); rendered ${entry.rendered.join(", ")}`);
      continue;
    }
    await restore(project, saved);
    say(`retake ${round}: undone, the earlier cut is kept (${entry.error ?? `no better: ${entry.verdict_after}`})`);
    break;
  }
  await rm(path.join(project, ".launchclip", "retake"), { recursive: true, force: true });
  const document = retakesDocument(rounds, { review, limit: budget, verdict: critique.verdict });
  const file = path.join(project, RETAKES_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(document, null, 2)}\n`);
  return { status: document.status, verdict: critique.verdict, critique, rounds, file, usage };
}

// The skill path and `launchclip make --animation` are two routes to one set
// of contracts (docs/ANIMATION_PIPELINE_RFC.md §6): the same files, in the
// same schemas, checked by the same commands. This test keeps the skill from
// drifting away from make, as test/direction_paths.test.js does for the
// direction map.
//
// The contract table is src/animation_paths.js; the skills'
// references/animation.md is generated from it. Here it is held to the code:
//   - every file name and schema is the constant its module exports;
//   - every command the reference tells an agent to run is in the CLI usage
//     table, with every flag it uses;
//   - the validator behind each command is the one make calls;
//   - a project written the skill's way and a project written by make pass
//     the same checks.
//
// Parts of the animation path arrive in their own changes (the animatic, the
// retake record, make's bible stage). A check whose module is not in this
// checkout yet is skipped with a note saying which, and runs as soon as the
// module is there.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as paths from "../src/animation_paths.js";
import { ANIMATION_CONTRACTS, APPROVAL_POINTS, MIRRORED_CONSTANTS, animationReference } from "../src/animation_paths.js";
import { freezeBible, readBible } from "../src/bible.js";
import { USAGE } from "../src/cli_usage.js";
import { MODEL_ROLES } from "../src/make/models.js";
import { runScriptCheck } from "../src/script_check_cli.js";
import { runStoryCommand } from "../src/story_cli.js";
import { storyShotsCommand } from "../src/story_shots.js";
import { GENERATED_REFERENCES, SKILLS } from "../scripts/sync-skills.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const at = (relative) => path.join(ROOT, relative);
const has = (relative) => existsSync(at(relative));
const source = (relative) => readFile(at(relative), "utf8");
const load = (relative) => import(pathToFileURL(at(relative)).href);
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const SKILL_DIRS = SKILLS.map((skill) => `skills/${skill.name}`);
const COMMAND_NAMES = [...new Set(USAGE.map(([name]) => name))].sort((a, b) => b.length - a.length);
const usageFor = (name) => USAGE.filter(([row]) => row === name).map(([, usage]) => usage).join("\n");
const commands = (entry) => [entry.write, entry.check, entry.view].filter(Boolean);
/** The module that names an entry's file and schema, or null while it (or one of those names) is not in this checkout. */
async function named(entry) {
  if (!entry.source || !has(entry.source.module)) return null;
  const module = await load(entry.source.module);
  return [entry.source.file, entry.source.schema].filter(Boolean).every((name) => name in module) ? module : null;
}
/** Whether everything an entry's values come from is in this checkout. */
const landed = async (entry) => (!entry.source || Boolean(await named(entry))) && (!entry.validator || (has(entry.validator.cli) && has(entry.validator.make)));
async function arrivingFlags() {
  const flags = new Set();
  for (const entry of ANIMATION_CONTRACTS) if (!(await landed(entry))) for (const command of commands(entry)) for (const flag of command.flags ?? []) flags.add(flag);
  return flags;
}

test("the contract table is the code's: every file name and schema is the constant its module exports", async (t) => {
  assert.deepEqual(ANIMATION_CONTRACTS.map((entry) => entry.file), ["SCRIPT.json", "BIBLE.json", "NARRATION.json", "DIRECTION.json", "storyboard.json", "ANIMATIC.json", "qa/animatic-critic.json", "qa/critic.json", "qa/retakes.json"], "the contract files, in pipeline order");
  for (const entry of ANIMATION_CONTRACTS) {
    assert.ok(entry.role === null || entry.role in MODEL_ROLES, `${entry.id}: ${entry.role} is a role of the model check`);
    if (!entry.source) continue;
    const module = await named(entry);
    if (!module) { t.diagnostic(`${entry.file}: ${entry.source.module} does not name it in this checkout yet; not compared`); continue; }
    if (entry.source.file) assert.equal(module[entry.source.file], entry.file, `${entry.source.module} ${entry.source.file}`);
    if (entry.source.schema) assert.equal(module[entry.source.schema], entry.schema, `${entry.source.module} ${entry.source.schema}`);
  }
  for (const [ours, file, theirs] of MIRRORED_CONSTANTS) {
    if (!has(file)) { t.diagnostic(`${ours}: ${file} is not in this checkout; not compared`); continue; }
    const module = await load(file);
    if (!(theirs in module)) { t.diagnostic(`${ours}: ${file} does not export ${theirs} yet; not compared`); continue; }
    assert.deepEqual([...[paths[ours]].flat()], [...[module[theirs]].flat()], `${ours} is ${file} ${theirs}`);
  }
  // The narration file's schema has no exported constant: the voice module writes it.
  assert.match(await source("src/voice/narrate.js") + await source("src/voice/dialogue.js"), new RegExp(ANIMATION_CONTRACTS.find((entry) => entry.id === "narration").schema.replaceAll(".", "\\.")));
});

test("both routes check a contract with the same code: the validator behind the command is the one make calls", async (t) => {
  for (const entry of ANIMATION_CONTRACTS) {
    if (!entry.validator) continue;
    if (!(await landed(entry))) { t.diagnostic(`${entry.file}: its writer is not in this checkout yet; validator not compared`); continue; }
    for (const file of [entry.validator.cli, entry.validator.make]) {
      assert.match(await source(file), new RegExp(`\\b${entry.validator.name}\\(`), `${file} calls ${entry.validator.name} for ${entry.file}`);
    }
  }
  // make's stages: every contract is written by a stage runMake runs. The two
  // stages the animation path adds may still be arriving.
  const make = await source("src/make/index.js");
  const missing = [...new Set(ANIMATION_CONTRACTS.map((entry) => entry.stage))].filter((stage) => !make.includes(`["${stage}", `));
  assert.deepEqual(missing.filter((stage) => !APPROVAL_POINTS.includes(stage)), [], "every stage but the two new ones is a make stage today");
  if (missing.length) t.diagnostic(`make has no ${missing.join(" or ")} stage in this checkout yet`);
});

test("the two approval points are make's stop points", async (t) => {
  assert.deepEqual([...APPROVAL_POINTS], ["bible", "animatic"]);
  if (!has("src/make/options.js")) return;
  const { MAKE_STOP_POINTS } = await load("src/make/options.js");
  if (!MAKE_STOP_POINTS) { t.diagnostic("src/make/options.js has no MAKE_STOP_POINTS in this checkout; not compared"); return; }
  for (const point of MAKE_STOP_POINTS) assert.ok(APPROVAL_POINTS.includes(point), `make stops after ${point}; the skill must stop there too`);
  const pending = APPROVAL_POINTS.filter((point) => !MAKE_STOP_POINTS.includes(point));
  if (pending.length) t.diagnostic(`make does not stop after ${pending.join(", ")} in this checkout yet`);
});

/** Every `launchclip …` invocation in a text: [{name, flags, line}]. */
function invocations(text) {
  const found = [];
  const joined = text.replace(/\\\n\s*/g, " ");
  for (const match of joined.matchAll(/launchclip ([a-z][^`\n]*)/g)) {
    const rest = match[1].replace(/\s+#.*$/, "");
    const name = COMMAND_NAMES.find((candidate) => rest === candidate || rest.startsWith(`${candidate} `));
    found.push({ name: name ?? null, flags: [...rest.matchAll(/(?<![\w-])--[a-z][a-z-]*/g)].map((flag) => flag[0]), line: `launchclip ${rest}` });
  }
  return found;
}

test("every command the skill names exists, with every flag it uses", async (t) => {
  // Flags of commands whose module is still arriving are allowed to be missing from the usage table.
  const arriving = await arrivingFlags();
  for (const entry of ANIMATION_CONTRACTS) {
    for (const command of commands(entry)) {
      assert.ok(usageFor(command.command), `${entry.file}: launchclip ${command.command} is a command`);
      for (const flag of command.flags ?? []) {
        if (usageFor(command.command).includes(flag)) continue;
        assert.ok(arriving.has(flag), `launchclip ${command.command} has no ${flag}`);
        t.diagnostic(`launchclip ${command.command} ${flag} is not in this checkout yet`);
      }
    }
  }
  const reference = animationReference();
  const quickPath = await source("skills-src/shared/quick-path.md");
  const used = [...invocations(reference), ...invocations(quickPath).filter((entry) => /--animation|--animatic/.test(entry.line))];
  assert.ok(used.length > 15, "the reference names its commands");
  for (const { name, flags, line } of used) {
    assert.ok(name, `"${line}" names a launchclip command`);
    const usage = usageFor(name);
    for (const flag of flags) {
      if (flag === "--help" || usage.includes(flag)) continue;
      assert.ok(arriving.has(flag), `"${line}": launchclip ${name} has no ${flag}`);
    }
  }
  // Every validating command of the table is one the reference tells the agent to run.
  for (const entry of ANIMATION_CONTRACTS) {
    for (const command of commands(entry)) assert.ok(reference.includes(`launchclip ${command.command} ${command.args}`), `the reference runs launchclip ${command.command} for ${entry.file}`);
  }
});

test("both create-video skills carry the generated reference and the animation branch", async () => {
  assert.equal(GENERATED_REFERENCES["animation.md"], animationReference);
  const reference = animationReference();
  assert.equal(await source("skills-src/references/animation.md"), reference, "run npm run skills:sync");
  for (const dir of SKILL_DIRS) {
    assert.equal(await source(`${dir}/references/animation.md`), reference, `${dir}: run npm run skills:sync`);
    const skill = await source(`${dir}/SKILL.md`);
    assert.match(skill, /animation branch/);
    assert.match(skill, /\(references\/animation\.md\)/);
    assert.match(skill, /make "<prompt>" --animation/);
    for (const file of ["SCRIPT.json", "BIBLE.json", "ANIMATIC.json"]) assert.ok(skill.includes(file), `${dir}/SKILL.md names ${file}`);
    assert.match(skill, /after the bible[\s\S]{0,80}after the animatic/, "the quick path names both stops");
  }
  // The reference names every contract file and schema, both stops, and the links it makes resolve.
  for (const entry of ANIMATION_CONTRACTS) {
    assert.ok(reference.includes(`\`${entry.file}\``), `the reference names ${entry.file}`);
    if (entry.schema) assert.ok(reference.includes(entry.schema), `the reference names ${entry.schema}`);
  }
  assert.match(reference, /\*\*Stop 1: the cast\.\*\*/);
  assert.match(reference, /\*\*Stop 2: the animatic\.\*\*/);
  for (const [, link] of reference.matchAll(/\]\(([a-z-]+\.md)\)/g)) assert.ok(has(`${SKILL_DIRS[0]}/references/${link}`), `the reference links ${link}`);
  // No paid flag is ever an instruction: each is named once, as something this path does not use.
  assert.equal(invocations(reference).filter((entry) => entry.flags.includes("--review") || entry.flags.includes("--retake") || entry.flags.includes("--model")).length, 0);
});

/**
 * The checks the reference tells an agent to run, on a project folder:
 * `script check`, `bible show`, `story validate` and `story shots`. → what
 * each contract file on disk says its schema is.
 */
async function checkContracts(project) {
  const script = await runScriptCheck(project, {});
  assert.deepEqual(script.errors, [], "script check");
  const { bible, check } = await readBible(project);
  assert.deepEqual(check.errors, [], "bible show");
  assert.equal(bible.frozen, true);
  const validation = await runStoryCommand("validate", path.join(project, "storyboard.json"));
  assert.equal(validation.status, "passed", JSON.stringify(validation.errors ?? validation));
  const shots = await storyShotsCommand(project, { json: true });
  assert.ok(shots.shots.length > 0, "story shots lists the shots");
  const story = await json(path.join(project, "storyboard.json"));
  const direction = await json(path.join(project, "DIRECTION.json"));
  assert.deepEqual(story.bible, { file: "BIBLE.json", hash: bible.hash }, "the story names the frozen bible");
  assert.deepEqual(direction.bible, story.bible, "and so does the direction map");
  assert.deepEqual(story.cast.characters.map((entry) => entry.id).sort(), bible.cast.characters.map((entry) => entry.id).sort(), "the story's cast is the bible's");
  return { script: (await json(path.join(project, "SCRIPT.json"))).schema_version, bible: bible.schema, direction: direction.schema, storyboard: story.schema, speakers: shots.shots.flatMap((shot) => shot.who) };
}

const expected = () => Object.fromEntries(["script", "bible", "direction", "storyboard"].map((id) => [id, ANIMATION_CONTRACTS.find((entry) => entry.id === id).schema]));
const drawSheet = async (_html, png) => { await writeFile(png, "png"); };

test("a project written the skill's way passes the commands the reference names", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-animation-paths-"));
  try {
    // The reference's order: the script, then the cast frozen into a bible,
    // then the map and the storyboard pinned to it by a second freeze.
    const project = path.join(dir, "short");
    await cp(at("examples/story/dialogue-9x16"), project, { recursive: true });
    // The reference's framing rule: a character at a desk is framed medium or close.
    const storyFile = path.join(project, "storyboard.json");
    const story = await json(storyFile);
    for (const scene of story.scenes) if (scene.params?.set === "desk-laptop") scene.params.shot = "medium";
    await writeFile(storyFile, `${JSON.stringify(story, null, 2)}\n`);
    const first = await freezeBible(project, { characters: ["maya", "sam"], style: paths.ANIMATION_DRAWING_STYLE, world: "office", time: "day", sets: ["desk-laptop", "standing"], positions: { maya: "left", sam: "right" }, home: path.join(dir, "home"), pin: false }, { render: drawSheet });
    assert.equal(first.frozen, true);
    const again = await freezeBible(project, { home: path.join(dir, "home") }, { render: drawSheet });
    assert.equal(again.changed, false, "a second freeze changes nothing in the bible");
    assert.deepEqual([...again.pinned].sort(), ["DIRECTION.json", "storyboard.json"], "and pins the story and the map");
    const { speakers, ...schemas } = await checkContracts(project);
    assert.deepEqual(schemas, expected());
    assert.ok(speakers.includes("maya") && speakers.includes("sam"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a project written by make --animation passes the same checks and carries the same schemas", async (t) => {
  if (!has("test/helpers/make_animation.js") || !has("src/make/show_bible.js")) { t.skip("make's bible and planning stages are not in this checkout yet"); return; }
  const { room } = await load("test/helpers/make_animation.js");
  const run = await room();
  try {
    const report = await run.make();
    assert.equal(report.routing.kind, "animation");
    assert.ok(["ready", "ready-for-review", "needs-repair"].includes(report.status), `make ran to a render (${report.status})`);
    const { speakers, ...schemas } = await checkContracts(run.project);
    assert.deepEqual(schemas, expected(), "make writes the schemas the skill writes");
    assert.ok(speakers.length > 0);
    const { bible } = await readBible(run.project);
    assert.equal(bible.cast.style, paths.ANIMATION_DRAWING_STYLE, "both routes draw a new cast in the same default style");
  } finally {
    await run.done();
  }
});

// The CLI and the skills plan subject effects from one source of truth
// (docs/SUBJECT_EFFECTS_RFC.md §8.3). The footage fixture goes through both
// paths: headless `story plan --base` with a recorded model response, and the
// skill's documented steps (probe, read subject-effects.md, plan, validate,
// matte the planned ranges). Both must offer the same subject modules and end
// on the same module choices and matte ranges.
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { catalogModules } from "../kit/core/modules.mjs";
import { DEFAULT_BRAND, subjectEffectsReference } from "../kit/core/planning-prompt.mjs";
import { planStoryCommand, runStoryCommand } from "../src/story_cli.js";
import { readProjectStory } from "../src/story_loader.js";
import { plannedSubjectRanges } from "../src/subject/plan.js";

const FIXTURE = fileURLToPath(new URL("../examples/story/footage", import.meta.url));
const SKILLS = ["launchclip-create-video", "launchclip-create-video-remotion"].map((name) => fileURLToPath(new URL(`../skills/${name}/references/subject-effects.md`, import.meta.url)));
const PROBE = { usable: true, reasons: [], framing: "medium", headroom: 0.22, head: { x: 0.5, y: 0.3, w: 0.2, h: 0.15 }, people: "one" };

// The recorded model response: a masthead on the product name, a punch-in later.
const RESPONSE = {
  schema: "launchclip.story.v1",
  lane: "footage-led",
  format: { width: 1080, height: 1920, fps: 30, duration: 20 },
  brand: DEFAULT_BRAND,
  audio: { words: "NARRATION.json" },
  base: "assets/recording.mp4",
  scenes: [
    { id: "name", module: "masthead", track: 1, start: "word:i'm", end: "word:it#2", params: { word: "Launch" } },
    { id: "push", module: "punch-in", track: 2, start: "word:captions,", end: "word:come", params: {} }
  ],
  overlays: [{ type: "captions", style: "word-highlight" }]
};

const headings = (text) => new Set([...text.matchAll(/^### ([a-z0-9-]+) \(/gm)].map((match) => match[1]));
const subjectIds = () => Object.entries(catalogModules()).filter(([, def]) => def.needs?.includes("subject")).map(([id]) => id).sort();

async function project(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-subject-paths-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(path.join(FIXTURE, "assets"), path.join(dir, "assets"), { recursive: true });
  await cp(path.join(FIXTURE, "NARRATION.json"), path.join(dir, "NARRATION.json"));
  await writeFile(path.join(dir, "brief.md"), "A Short for LaunchClip from Ada's recording: name the product behind her, and punch in on the features.\n");
  return dir;
}

function recordedClient(prompts, response = RESPONSE) {
  return {
    provider: "openai",
    async runStructured(request) {
      // The direction-map call gets no map, so story plan drafts one from the storyboard.
      if (request.schemaName === "launchclip_direction") return { model: "recorded", value: { direction_json: "" }, usage: { input_tokens: 1, output_tokens: 1 } };
      prompts.push(request.instructions);
      return { model: "recorded", value: { storyboard_json: JSON.stringify(response) }, usage: { input_tokens: 1, output_tokens: 1 } };
    }
  };
}

test("both paths offer the same subject modules for a usable presenter", async (t) => {
  const dir = await project(t);
  const prompts = [];
  const result = await planStoryCommand({ brief: path.join(dir, "brief.md"), narration: path.join(dir, "NARRATION.json"), base: "assets/recording.mp4", tier: "guided", out: path.join(dir, "storyboard.json") }, { client: recordedClient(prompts), subjectProbe: async () => ({ probe: PROBE }) });
  assert.equal(result.status, "passed", JSON.stringify(result.warnings));
  assert.deepEqual(result.subject, { usable: true, framing: "medium" });
  // The CLI prompt's module headings and each skill's reference cover the same subject modules.
  const offered = headings(prompts[0]);
  assert.match(prompts[0], /## Presenter \(subject\)/);
  for (const file of SKILLS) {
    const reference = await readFile(file, "utf8");
    assert.equal(reference, subjectEffectsReference(), `${file} is the generated reference`);
    const documented = headings(reference);
    for (const id of subjectIds()) {
      assert.ok(offered.has(id), `the CLI prompt offers ${id}`);
      assert.ok(documented.has(id), `${path.basename(path.dirname(path.dirname(file)))} documents ${id}`);
    }
    assert.match(reference, /launchclip subject probe/);
    assert.match(reference, /Plan subject effects only when `usable` is true/);
  }
});

test("an unusable presenter: the CLI prompt drops them, as the skill reference tells the agent to", async (t) => {
  const dir = await project(t);
  const prompts = [];
  const unusable = { ...PROBE, usable: false, reasons: ["more than one person is in frame"], people: "several" };
  const result = await planStoryCommand({ brief: path.join(dir, "brief.md"), narration: path.join(dir, "NARRATION.json"), base: "assets/recording.mp4", tier: "guided", out: path.join(dir, "storyboard.json") }, { client: recordedClient(prompts, { ...RESPONSE, scenes: RESPONSE.scenes.filter((scene) => scene.module !== "masthead") }), subjectProbe: async () => ({ probe: unusable }) });
  assert.deepEqual(result.subject, { usable: false, framing: "medium", reasons: ["more than one person is in frame"] });
  assert.match(prompts[0], /No subject modules: more than one person is in frame/);
  for (const id of subjectIds()) assert.ok(!headings(prompts[0]).has(id), `the CLI prompt does not offer ${id}`);
});

test("the recorded plan lands on the same modules and matte ranges through either path", async (t) => {
  // Headless: story plan writes the storyboard.
  const cli = await project(t);
  await planStoryCommand({ brief: path.join(cli, "brief.md"), narration: path.join(cli, "NARRATION.json"), base: "assets/recording.mp4", tier: "guided", out: path.join(cli, "storyboard.json") }, { client: recordedClient([]), subjectProbe: async () => ({ probe: PROBE }) });
  // Skill: the agent writes the same storyboard by hand, then runs the documented checks.
  const skill = await project(t);
  await writeFile(path.join(skill, "storyboard.json"), `${JSON.stringify(RESPONSE, null, 2)}\n`);
  await writeFile(path.join(skill, "DIRECTION.json"), await readFile(path.join(cli, "DIRECTION.json")));
  const checked = await runStoryCommand("validate", path.join(skill, "storyboard.json"), {});
  assert.equal(checked.status, "passed", JSON.stringify(checked.errors));
  const [a, b] = await Promise.all([readProjectStory(cli), readProjectStory(skill)]);
  const choices = (story) => story.resolved.scenes.map((scene) => [scene.module, scene.start, scene.end]);
  assert.deepEqual(choices(a), choices(b));
  assert.deepEqual(choices(a).map(([module]) => module), ["masthead", "punch-in"]);
  // Both would matte the same stretch: the masthead's window, padded.
  const ranges = plannedSubjectRanges(a.resolved, { sourceDuration: 20 });
  assert.deepEqual(ranges, plannedSubjectRanges(b.resolved, { sourceDuration: 20 }));
  assert.equal(ranges.length, 1);
});

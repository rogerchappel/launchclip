// The CLI and the skills plan the direction map from one source of truth
// (docs/VIDEO_QUALITY_RFC.md §6.4 and §12), as test/subject_paths.test.js does
// for subject effects. One fixture per format goes through both paths:
// headless `story plan` with a recorded model response (the map first, then
// the storyboard), and the skill's documented steps (write DIRECTION.json from
// references/direction-map.md, write the storyboard, `story validate`). Both
// must classify the same intents, pick the same cadence profile and measure the
// same coverage.
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { INTENT_RULES, intentHints } from "@launchclip/core/direction.mjs";
import { directionMapReference, profilesReference } from "@launchclip/core/planning-prompt.mjs";
import { shippedProfiles } from "../src/profile_store.js";
import { planStoryCommand, runStoryCommand } from "../src/story_cli.js";
import { DEFAULT_BRAND } from "@launchclip/core/planning-prompt.mjs";

const EXAMPLES = fileURLToPath(new URL("../examples/story/", import.meta.url));
const SKILLS = ["launchclip-create-video", "launchclip-create-video-remotion"].map((name) => fileURLToPath(new URL(`../skills/${name}/references/`, import.meta.url)));
const PROBE = { usable: false, reasons: ["no matte needed for this test"], framing: "medium", headroom: 0.2, head: null, people: "one" };

const FIXTURES = [
  { name: "footage", lane: "footage-led", base: "assets/recording.mp4", format: "1080x1920", duration: "20", profile: "short-talking-head" },
  { name: "explainer-9x16", lane: "motion", format: "1080x1920", duration: "26", profile: "short-motion" },
  { name: "cinematic-16x9", lane: "voiceover-motion", format: "1920x1080", duration: "31", profile: "explainer-motion" }
];

async function fixture(t, name) {
  const dir = await mkdtemp(path.join(os.tmpdir(), `launchclip-direction-paths-${name}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(path.join(EXAMPLES, name), dir, { recursive: true });
  await rm(path.join(dir, "storyboard.json"));
  await rm(path.join(dir, "DIRECTION.json"));
  await writeFile(path.join(dir, "brief.md"), `The ${name} example, planned again.\n`);
  return dir;
}

function recordedClient(map, storyboard, seen) {
  return {
    provider: "openai",
    async runStructured(request) {
      seen.push(request);
      if (request.schemaName === "launchclip_direction") return { model: "recorded", value: { direction_json: JSON.stringify(map) }, usage: { input_tokens: 1, output_tokens: 1 } };
      return { model: "recorded", value: { storyboard_json: JSON.stringify(storyboard) }, usage: { input_tokens: 1, output_tokens: 1 } };
    }
  };
}

test("the skills ship the generated direction-map and profiles references", async () => {
  for (const dir of SKILLS) {
    assert.equal(await readFile(path.join(dir, "direction-map.md"), "utf8"), directionMapReference());
    assert.equal(await readFile(path.join(dir, "profiles.md"), "utf8"), profilesReference(shippedProfiles()));
  }
  const reference = directionMapReference();
  for (const rule of INTENT_RULES) assert.ok(reference.includes(`| ${rule.intent} | ${rule.when.replace(/\|/g, "\\|")} |`), `the reference documents the ${rule.intent} rule`);
  for (const profile of shippedProfiles()) assert.match(profilesReference(shippedProfiles()), new RegExp(`## ${profile.id}`));
});

for (const entry of FIXTURES) {
  test(`${entry.name} (${entry.lane}): both paths share intents, profile and coverage`, async (t) => {
    const map = JSON.parse(await readFile(path.join(EXAMPLES, entry.name, "DIRECTION.json"), "utf8"));
    const words = JSON.parse(await readFile(path.join(EXAMPLES, entry.name, "NARRATION.json"), "utf8")).words;
    const source = JSON.parse(await readFile(path.join(EXAMPLES, entry.name, "storyboard.json"), "utf8"));

    // Headless: story plan asks for the map, then the storyboard against it.
    const cli = await fixture(t, entry.name);
    const seen = [];
    // The fixture's own brand, so the plan does not draw a seeded style (the
    // recorded storyboard is fitted to these fonts).
    await writeFile(path.join(cli, "brand.json"), JSON.stringify(source.brand ?? DEFAULT_BRAND));
    const flags = { brand: path.join(cli, "brand.json"), brief: path.join(cli, "brief.md"), narration: path.join(cli, "NARRATION.json"), tier: "guided", lane: entry.lane, out: path.join(cli, "storyboard.json"), format: entry.format, duration: entry.duration, ...(entry.base ? { base: entry.base } : {}) };
    const planned = await planStoryCommand(flags, { client: recordedClient(map, source, seen), subjectProbe: async () => ({ probe: PROBE }) });
    assert.equal(planned.status, "passed", JSON.stringify(planned.warnings));
    assert.equal(planned.lane, entry.lane);
    assert.equal(planned.profile, entry.profile);
    assert.equal(planned.direction.source, "model");
    // The direction call gives the model the lines with the shared rules' intents.
    const prompt = seen.find((request) => request.schemaName === "launchclip_direction").instructions;
    for (const hint of intentHints(words)) assert.ok(prompt.includes(`- [${hint.words[0]}, ${hint.words[1]}] ${hint.intent}:`), `${entry.name}: the CLI hints [${hint.words.join(", ")}] as ${hint.intent}`);
    const written = JSON.parse(await readFile(path.join(cli, "DIRECTION.json"), "utf8"));
    const storyboard = JSON.parse(await readFile(path.join(cli, "storyboard.json"), "utf8"));

    // Skill: the agent writes the map (the same intents, by the documented rules) and the storyboard, then validates.
    const skill = await fixture(t, entry.name);
    await writeFile(path.join(skill, "DIRECTION.json"), `${JSON.stringify(map, null, 2)}\n`);
    await writeFile(path.join(skill, "storyboard.json"), `${JSON.stringify(storyboard, null, 2)}\n`);
    const checked = await runStoryCommand("validate", path.join(skill, "storyboard.json"), {});
    assert.equal(checked.status, "passed", JSON.stringify(checked.errors));
    const intents = (doc) => doc.sections.flatMap((section) => section.lines.map((line) => [line.words.join("-"), line.intent]));
    assert.deepEqual(intents(written), intents(map));
    assert.deepEqual(intents(map).map(([, intent]) => intent), intentHints(words).map((hint) => hint.intent), "the map's intents follow the shared rules");
    assert.equal(checked.direction.profile, planned.profile);
    assert.equal(checked.direction.coverage, planned.direction.coverage);
    assert.equal(checked.direction.longest_undressed_seconds, planned.direction.longest_undressed_seconds);
  });
}

test("story validate requires the map in a narrated lane and only warns without words", async (t) => {
  const dir = await fixture(t, "explainer-9x16");
  const story = JSON.parse(await readFile(path.join(EXAMPLES, "explainer-9x16", "storyboard.json"), "utf8"));
  await writeFile(path.join(dir, "storyboard.json"), JSON.stringify(story));
  const missing = await runStoryCommand("validate", path.join(dir, "storyboard.json"), {});
  assert.equal(missing.status, "failed");
  assert.match(missing.errors.join("\n"), /the motion lane needs DIRECTION\.json/);
  const silent = { ...story, audio: { ...story.audio } };
  delete silent.audio.words;
  delete silent.overlays;
  for (const scene of silent.scenes) { delete scene.hits; }
  await writeFile(path.join(dir, "storyboard.json"), JSON.stringify(silent));
  const warned = await runStoryCommand("validate", path.join(dir, "storyboard.json"), { narration: path.join(dir, "NARRATION.json") });
  assert.ok(!warned.errors.some((error) => /DIRECTION\.json/.test(error)), warned.errors.join("\n"));
  assert.ok(warned.warnings.some((warning) => /no DIRECTION\.json/.test(warning)));
});

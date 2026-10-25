// launchclip style generate | reroll | keep, and story plan's seeded default
// (docs/SEEDED_STYLES_RFC.md §4).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { generateStyle } from "../kit/core/style-seed.mjs";
import { runCli } from "../src/cli.js";
import { generateProjectStyle, styleKeepCommand, styleRerollCommand } from "../src/style_seed_store.js";
import { planStoryCommand } from "../src/story_cli.js";
import { resolveStyleV2 } from "../src/style_store.js";

async function cli(argv) {
  const out = [];
  await runCli(argv, { stdout: { write: (value) => out.push(value) }, stderr: { write: () => {} } });
  return JSON.parse(out.join(""));
}

async function seededProject(seed = "7f3a91c2", constraints = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-seed-project-"));
  const made = await generateProjectStyle(dir, { seed, constraints });
  await writeFile(path.join(dir, "storyboard.json"), JSON.stringify({ schema: "launchclip.story.v1", style: made.name, scenes: [] }));
  return { dir, made };
}

const storyStyle = async (dir) => JSON.parse(await readFile(path.join(dir, "storyboard.json"), "utf8")).style;

test("style generate writes one seed's pack, the same every time", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-seed-gen-"));
  try {
    const result = await cli(["style", "generate", "--seed", "7F3A91C2", "--tone", "warm", "--theme", "light", "--out", path.join(dir, "look")]);
    assert.equal(result.status, "ready");
    assert.equal(result.name, "seed-7f3a91c2");
    const file = path.join(dir, "look", "style.json");
    assert.equal(result.path, file);
    const pack = JSON.parse(await readFile(file, "utf8"));
    const { at, ...provenance } = pack.generated;
    assert.ok(at);
    const again = generateStyle({ seed: "7f3a91c2", constraints: { tone: "warm", theme: "light" } });
    assert.deepEqual({ ...pack, generated: provenance }, again);
    assert.match(result.summary, /^seed 7f3a91c2 \(light, /);
    await assert.rejects(cli(["style", "generate", "--seed", "7f3a91c2", "--out", path.join(dir, "look")]), /already exists/);
    const fitted = await cli(["style", "generate", "--seed", "00000003", "--world", "kitchen,cafe", "--world", "home-desk"]);
    assert.ok(["kitchen", "cafe", "home-desk"].includes(fitted.pack.world.kind));
    assert.deepEqual(fitted.pack.generated.constraints.world, ["kitchen", "cafe", "home-desk"]);
    const printed = await cli(["style", "generate", "--seed", "00000001"]);
    assert.equal(printed.pack.name, "seed-00000001");
    await assert.rejects(cli(["style", "generate", "--seed", "nothex"]), /8 hex characters/);
    const project = await cli(["style", "generate", "--seed", "00000002", "--tone", "premium", "--project", path.join(dir, "video")]);
    assert.equal(project.path, path.join(dir, "video", ".launchclip", "styles", "seed-00000002", "style.json"));
    assert.match(project.line, /^style: seed 00000002 \(/);
    assert.equal((await resolveStyleV2("seed-00000002", { projectDir: path.join(dir, "video") })).pack.generated.tone, "premium");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("style reroll swaps in a new seed, keeps the direction, and undoes once", async () => {
  const { dir, made } = await seededProject("7f3a91c2", { tone: "calm", world: "kitchen" });
  try {
    const result = await styleRerollCommand(dir, {}, { cwd: dir });
    assert.equal(result.status, "ready");
    assert.equal(result.previous, made.name);
    assert.notEqual(result.name, made.name);
    assert.equal(await storyStyle(dir), result.name);
    const next = (await resolveStyleV2(result.name, { projectDir: dir })).pack;
    assert.equal(next.generated.tone, "calm", "the old tone carries over");
    assert.equal(next.world.kind, "kitchen", "the art-direction constraints carry over");
    assert.ok(existsSync(path.join(dir, ".launchclip", "styles", made.name, "style.json")), "the old pack stays");

    const undone = await styleRerollCommand(dir, { undo: true }, { cwd: dir });
    assert.equal(undone.status, "undone");
    assert.equal(await storyStyle(dir), made.name);
    await assert.rejects(styleRerollCommand(dir, { undo: true }, { cwd: dir }), /nothing to undo/);

    const toned = await styleRerollCommand(dir, { tone: "playful", seed: "0badc0de" }, { cwd: dir });
    assert.equal(toned.name, "seed-0badc0de");
    assert.equal((await resolveStyleV2(toned.name, { projectDir: dir })).pack.generated.tone, "playful");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("style reroll refuses a named style; style keep saves a personal style", async () => {
  const { dir, made } = await seededProject();
  const home = await mkdtemp(path.join(os.tmpdir(), "launchclip-seed-home-"));
  try {
    const kept = await styleKeepCommand(dir, { as: "my-look" }, { cwd: dir, home });
    assert.equal(kept.path, path.join(home, "styles", "my-look", "style.json"));
    const pack = JSON.parse(await readFile(kept.path, "utf8"));
    assert.equal(pack.name, "my-look");
    assert.equal(pack.generated.seed, made.pack.generated.seed);
    const other = await mkdtemp(path.join(os.tmpdir(), "launchclip-seed-other-"));
    try {
      const resolved = await resolveStyleV2("my-look", { projectDir: other, home });
      assert.equal(resolved.source, "home");
    } finally {
      await rm(other, { recursive: true, force: true });
    }
    await assert.rejects(styleKeepCommand(dir, { as: "my-look" }, { cwd: dir, home }), /already exists/);
    await assert.rejects(styleKeepCommand(dir, {}, { cwd: dir, home }), /--as <name>/);

    await writeFile(path.join(dir, "storyboard.json"), JSON.stringify({ schema: "launchclip.story.v1", style: "editorial-dark", scenes: [] }));
    await assert.rejects(styleRerollCommand(dir, {}, { cwd: dir }), /not generated from a seed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("story plan with no style or brand plans for a seeded style and names it", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-seed-plan-"));
  try {
    await writeFile(path.join(dir, "brief.md"), "A calm explainer about saving water at home.\n");
    const requests = [];
    const client = {
      provider: "openai",
      async runStructured(request) {
        requests.push(request);
        if (request.schemaName === "launchclip_direction") return { model: "m", value: { direction_json: "" }, usage: { input_tokens: 1, output_tokens: 1 } };
        const board = { schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 4 }, motion: { grammar: "snappy" },
          scenes: [{ id: "s1", module: "hook-title", start: 0, end: 4, params: { headline: "Save water at home" } }], overlays: [{ type: "captions", style: "word-highlight" }] };
        return { model: "m", value: { storyboard_json: JSON.stringify(board) }, usage: { input_tokens: 1, output_tokens: 1 } };
      }
    };
    const notices = [];
    const out = path.join(dir, "storyboard.json");
    const summary = await planStoryCommand({ brief: path.join(dir, "brief.md"), out, format: "1080x1920", duration: "4", seed: "7f3a91c2", "no-direction": true }, { client, notice: (line) => notices.push(line) });
    assert.equal(summary.status, "passed", JSON.stringify(summary.attempts));
    assert.equal(summary.style.name, "seed-7f3a91c2");
    assert.equal(summary.style.source, "generated");
    assert.match(notices[0], /^style: seed 7f3a91c2 \(.*\)\. Reroll with launchclip style reroll$/);
    assert.match(requests.at(-1).instructions ?? requests.at(-1).input, /seed-7f3a91c2/);
    const story = JSON.parse(await readFile(out, "utf8"));
    const pack = JSON.parse(await readFile(path.join(dir, ".launchclip", "styles", "seed-7f3a91c2", "style.json"), "utf8"));
    assert.equal(pack.generated.tone, "calm");
    assert.equal(story.style, "seed-7f3a91c2");
    assert.equal(story.motion.grammar, pack.motion.grammar);
    assert.equal(story.overlays[0].preset, pack.captions.preset);
    assert.equal(story.overlays[0].style, undefined);

    // A second plan in the same folder reuses the storyboard's style.
    const again = await planStoryCommand({ brief: path.join(dir, "brief.md"), out, format: "1080x1920", duration: "4", "no-direction": true }, { client, notice: () => {} });
    assert.equal(again.style.name, "seed-7f3a91c2");
    assert.equal(again.style.source, "project");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

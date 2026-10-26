import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { collectionNewCommand, collectionShowCommand, formatCollectionShow, makeInCollection, recipeNewCommand } from "../src/collection_cli.js";
import { loadCollection } from "../src/collection.js";
import { slugify } from "../src/make/index.js";
import { assetsDir, fakeFinish, fakeInventory, fakeModel } from "./helpers/make_fakes.js";

const FIRST = "A 6-second launch video for a fictional SaaS called Ledgerly that reconciles Stripe payouts automatically";
const SECOND = "A 6-second feature clip for Ledgerly showing payout matching";
const AT = () => "2026-10-27T00:00:00.000Z";

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
// The fake classifier for the --assets folder; the collection's brand/ folder is empty.
const inventoryFor = (assets) => async (dir) => (dir === assets ? fakeInventory(dir) : { schema_version: "launchclip.make-assets.v1", dir, entries: [], counts: {}, summary: [] });

test("collection new writes the folder, one seeded style for every video, and refuses to overwrite", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-collection-new-"));
  try {
    const result = await collectionNewCommand("acme", { root, kind: "client", seed: "7f3a91c2", title: "Acme Corp" }, { clock: AT });
    const dir = path.join(root, "acme");
    assert.equal(result.dir, dir);
    assert.deepEqual(result.style, { name: "seed-7f3a91c2", source: "collection", seed: "7f3a91c2" });
    const collection = await loadCollection(dir);
    assert.deepEqual(collection.doc, { schema: "launchclip.collection.v1", id: "acme", kind: "client", title: "Acme Corp", style: "seed-7f3a91c2", brand_assets: "brand/", voice: null, rules: "RULES.md", isolation: "strict", recipes: [] });
    for (const file of ["styles/seed-7f3a91c2/style.json", "RULES.md", "brand", "recipes"]) assert.ok(existsSync(path.join(dir, file)), file);
    await assert.rejects(collectionNewCommand("acme", { root }), /already exists/);
    await assert.rejects(collectionNewCommand("Acme", { root }), /collection id must be lowercase/);
    await assert.rejects(collectionNewCommand("beta", { root, kind: "brand" }), /--kind must be one of/);
    // A named style must exist.
    await assert.rejects(collectionNewCommand("beta", { root, style: "no-such-style" }), /Style pack "no-such-style" was not found/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a recipe made from a finished video makes a second video with the same settings; editing it marks both stale", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-collection-e2e-"));
  const assets = await assetsDir();
  try {
    await collectionNewCommand("acme", { root, seed: "7f3a91c2" }, { clock: AT });
    const dir = path.join(root, "acme");
    await writeFile(path.join(dir, "RULES.md"), "# Rules\n\nNever claim Ledgerly is SOC 2 certified.\n");
    const { calls, model } = fakeModel();
    const adapters = { cwd: root, clock: AT, env: {}, client: model, inventory: inventoryFor(assets), finish: fakeFinish([]), notice() {} };

    // 1. One video by hand, inside the collection.
    const first = await makeInCollection(FIRST, { collection: dir, assets, aspect: "9:16", duration: "6", goal: "convert", voice: "test", music: "synth", renderer: "hyperframes" }, adapters);
    assert.equal(first.status, "ready-for-review", JSON.stringify(first.stages));
    const firstProject = path.join(dir, "videos", slugify(FIRST));
    assert.equal(first.project, firstProject);
    assert.equal(first.style.name, "seed-7f3a91c2", "the collection's style, not a new seed per video");
    assert.ok(calls.find((call) => call.schemaName === "launchclip_make_script").input.includes("Never claim Ledgerly is SOC 2 certified."), "the script pass reads RULES.md");
    const firstResolved = await readJson(path.join(firstProject, ".launchclip/resolved.json"));
    assert.equal(firstResolved.sources.style, "collection");
    assert.equal(firstResolved.sources.aspect, "video");
    assert.equal(firstResolved.prompt, FIRST);
    let video = await readJson(path.join(firstProject, "video.json"));
    assert.equal(video.recipe, null);
    assert.equal(video.status, "ready-for-review");
    assert.equal(video.style, "seed-7f3a91c2");
    assert.equal(video.style_from, "collection");

    // 2. Turn it into a recipe.
    const recipe = await recipeNewCommand(`${dir}/feature-clip`, { "from-video": firstProject, title: "Feature clip" }, { cwd: root });
    assert.deepEqual(recipe.recipe.make, { aspect: "9:16", duration: 6, format: first.script.plan.format, goal: "convert", awareness: first.script.plan.awareness, voice: "test", music: "synth", renderer: "hyperframes", quality: "draft" });
    assert.equal(recipe.recipe.make.style, undefined, "the collection's own style is inherited, not copied");
    assert.equal(recipe.recipe.profile, first.profile.id);
    assert.equal(recipe.recipe.from_video, `videos/${slugify(FIRST)}`);
    assert.deepEqual((await loadCollection(dir)).doc.recipes, ["feature-clip"]);
    video = await readJson(path.join(firstProject, "video.json"));
    assert.equal(video.recipe, "feature-clip");
    assert.equal(video.recipe_version, recipe.version);
    await assert.rejects(recipeNewCommand(`${dir}/feature-clip`, {}, { cwd: root }), /already exists/);

    // 3. A second make from the recipe, with no settings flags, gets the same settings.
    const second = await makeInCollection(SECOND, { collection: dir, recipe: "feature-clip", assets }, adapters);
    assert.equal(second.status, "ready-for-review", JSON.stringify(second.stages));
    const secondProject = path.join(dir, "videos", "feature-clip", slugify(SECOND));
    assert.equal(second.project, secondProject);
    const secondResolved = await readJson(path.join(secondProject, ".launchclip/resolved.json"));
    for (const flag of ["aspect", "duration", "goal", "voice", "music", "renderer", "quality", "style"]) assert.equal(String(secondResolved.make[flag]), String(firstResolved.make[flag] ?? recipe.recipe.make[flag]), flag);
    for (const key of ["aspect", "renderer", "quality", "voice", "music"]) assert.equal(second.options[key], first.options[key], key);
    assert.equal(second.routing.aspect, first.routing.aspect);
    assert.equal(second.routing.format.duration, first.routing.format.duration);
    assert.deepEqual([second.script.plan.format, second.script.plan.goal, second.script.plan.awareness], [first.script.plan.format, first.script.plan.goal, first.script.plan.awareness]);
    assert.equal(second.style.name, first.style.name);
    assert.equal(second.profile.id, first.profile.id);
    assert.equal(second.collection.recipe, "feature-clip");
    let show = await collectionShowCommand(dir, {});
    assert.equal(show.videos.length, 2);
    assert.equal(show.stale, 0);

    // 4. Editing the recipe marks both videos stale (computed on read).
    const file = path.join(dir, "recipes", "feature-clip.json");
    const doc = await readJson(file);
    await writeFile(file, `${JSON.stringify({ ...doc, make: { ...doc.make, duration: 8 } }, null, 2)}\n`);
    show = await collectionShowCommand(dir, {});
    assert.equal(show.stale, 2);
    assert.ok(show.videos.every((entry) => entry.reasons.includes("recipe feature-clip changed since this video was made")));
    assert.match(formatCollectionShow(show), /videos \(2, 2 stale\):\n {2}STALE ready-for-review/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(assets, { recursive: true, force: true });
  }
});

test("the CLI runs collection new, recipe new with make flags, collection show and make --collection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-collection-cli-"));
  const assets = await assetsDir();
  try {
    const io = () => { const out = []; return { out, stdout: { write: (text) => out.push(text) }, stderr: { write() {} } }; };
    let run = io();
    await runCli(["collection", "new", "acme", "--root", root, "--seed", "7f3a91c2"], run);
    const dir = path.join(root, "acme");
    assert.equal(JSON.parse(run.out.join("")).style.name, "seed-7f3a91c2");

    run = io();
    await runCli(["recipe", "new", `${dir}/short`, "--aspect", "9:16", "--duration", "6", "--seed", "0badc0de", "--no-critic", "--voice", "test", "--music", "synth"], run);
    assert.deepEqual(JSON.parse(run.out.join("")).recipe.make, { aspect: "9:16", duration: 6, seed: "0badc0de", "no-critic": true, voice: "test", music: "synth" });
    await assert.rejects(runCli(["recipe", "new", `${dir}/bad`, "--renderer", "blender"], io()), /make: --renderer must be remotion or hyperframes/);
    await assert.rejects(runCli(["recipe", "new", "no-slash"], io()), /<collection>\/<id>/);
    await assert.rejects(runCli(["make", "A video", "--recipe", "short"], io()), /--recipe needs --collection/);

    const { model } = fakeModel();
    run = io();
    await runCli(["make", FIRST, "--collection", dir, "--recipe", "short", "--assets", assets, "--json"], { ...run, productionAdapters: { make: { env: {}, client: model, inventory: inventoryFor(assets), finish: fakeFinish([]), clock: AT } } });
    const report = JSON.parse(run.out.join(""));
    assert.equal(report.collection.recipe, "short");
    assert.equal(report.style.name, "seed-0badc0de", "the recipe's seed replaces the collection's style");
    const video = await readJson(path.join(report.project, "video.json"));
    assert.equal(video.style_from, "make");
    assert.equal(report.critic.status, "pending");

    run = io();
    await runCli(["collection", "show", dir], run);
    const text = run.out.join("");
    assert.match(text, /^collection acme \(product\): acme/);
    assert.match(text, /short {2}short {2}--aspect 9:16 --duration 6 --seed 0badc0de --voice test --music synth --no-critic/);
    assert.match(text, /videos \(1, 0 stale\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(assets, { recursive: true, force: true });
  }
});

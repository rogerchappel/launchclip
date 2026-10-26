import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateStyle } from "../kit/core/style-seed.mjs";
import {
  COLLECTION_SCHEMA, RECIPE_SCHEMA, VIDEO_SCHEMA, layerFlags, listCollectionVideos, loadCollection, loadRecipe, makeOptionsFor,
  resolveVideoSettings, staleReasons, validateCollection, validateRecipe, validateVideo, versionOf, videoProjectDir, writeVideoRecord
} from "../src/collection.js";

const AT = "2026-10-27T00:00:00.000Z";

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-collection-"));
  const pack = generateStyle({ seed: "7f3a91c2", at: AT });
  await mkdir(path.join(dir, "styles", pack.name), { recursive: true });
  await writeFile(path.join(dir, "styles", pack.name, "style.json"), `${JSON.stringify(pack, null, 2)}\n`);
  await mkdir(path.join(dir, "brand"), { recursive: true });
  await writeFile(path.join(dir, "RULES.md"), "Never promise a launch date.\n");
  const doc = { schema: COLLECTION_SCHEMA, id: "acme", kind: "product", title: "Acme", style: pack.name, brand_assets: "brand/", voice: { engine: "kokoro", id: "af_heart" }, rules: "RULES.md", isolation: "strict", recipes: ["feature-clip"] };
  await writeFile(path.join(dir, "collection.json"), `${JSON.stringify(doc, null, 2)}\n`);
  await mkdir(path.join(dir, "recipes"), { recursive: true });
  const recipe = { schema: RECIPE_SCHEMA, id: "feature-clip", title: "60-second feature clip", make: { format: "promo", aspect: "9:16", duration: 60, goal: "convert", renderer: "hyperframes" }, profile: "shorts", destinations: ["youtube-shorts"], fixed: { brand_frame: true }, vary: ["hook_type"], children: [{ recipe: "feature-clip-landscape", via: "reframe" }] };
  await writeFile(path.join(dir, "recipes", "feature-clip.json"), `${JSON.stringify(recipe, null, 2)}\n`);
  return { dir, pack, doc, recipe };
}

test("collection, recipe and video documents validate, with the field named in each error", () => {
  assert.equal(validateCollection({ schema: COLLECTION_SCHEMA, id: "acme" }).ok, true);
  const bad = validateCollection({ schema: COLLECTION_SCHEMA, id: "Acme Co", kind: "brand", isolation: "loose", brand_assets: "../other/brand", voice: { engine: "siri" }, recipes: ["ok", "Not OK"], extra: 1 });
  assert.equal(bad.ok, false);
  for (const pattern of [/^id must be lowercase/, /^kind must be one of product/, /^isolation must be one of strict, shared/, /^brand_assets must be a path inside the collection folder/, /^voice\.engine/, /^recipes\[1\]/]) assert.ok(bad.errors.some((error) => pattern.test(error)), `${pattern} in ${bad.errors.join("; ")}`);
  assert.deepEqual(bad.warnings, ["unknown field extra (ignored)"]);
  assert.match(validateCollection({ schema: COLLECTION_SCHEMA, id: "acme", style: 7 }).errors.join(), /style must be a string or null/);

  // A recipe's make block is checked by make's own validation.
  const recipe = (make, extra = {}) => validateRecipe({ schema: RECIPE_SCHEMA, id: "clip", make, ...extra }, { id: "clip" });
  assert.equal(recipe({ format: "promo", aspect: "9:16", duration: 60, "no-critic": true }).ok, true);
  assert.match(recipe({ aspect: "4:3" }).errors.join(), /make: --aspect must be one of/);
  assert.match(recipe({ renderer: "blender" }).errors.join(), /make: --renderer/);
  assert.match(recipe({ out: "x" }).errors.join(), /make\.out is not a make setting a recipe can save/);
  assert.match(recipe({ style: "a", seed: "7f3a91c2" }).errors.join(), /not both/);
  assert.match(validateRecipe({ schema: RECIPE_SCHEMA, id: "clip" }, { id: "other" }).errors.join(), /does not match the file name/);
  // Phase 6 fields are validated even though nothing uses them yet.
  assert.match(recipe({}, { children: [{ recipe: "x", via: "teleport" }] }).errors.join(), /children\[0\]\.via must be one of cutdown, reframe/);
  assert.match(recipe({}, { destinations: [""] }).errors.join(), /destinations/);

  const video = { schema: VIDEO_SCHEMA, collection: "acme", recipe: "clip", recipe_version: versionOf({}), style: null, style_version: null, parent: null, children: [], topic: "SSO", status: "approved-script" };
  assert.equal(validateVideo(video).ok, true);
  assert.match(validateVideo({ ...video, status: "stale" }).errors.join(), /status must be one of/, "stale is computed, never stored");
  assert.match(validateVideo({ ...video, recipe_version: "v2" }).errors.join(), /recipe_version/);
});

test("versions ignore formatting and key order, and change with the content", () => {
  assert.equal(versionOf({ a: 1, b: [1, { c: 2, d: 3 }] }), versionOf({ b: [1, { d: 3, c: 2 }], a: 1 }));
  assert.notEqual(versionOf({ a: 1 }), versionOf({ a: 2 }));
  assert.match(versionOf({}), /^sha256:[0-9a-f]{64}$/);
});

test("settings resolve library → collection → recipe → the video's flags, and --style and --seed replace each other", async () => {
  const { dir, pack } = await fixture();
  try {
    const collection = await loadCollection(dir);
    const recipe = await loadRecipe(collection, "feature-clip");
    const library = { make: { quality: "high", aspect: "16:9", music: "synth" }, storage: { projects: path.join(dir, "projects") } };
    const resolved = await resolveVideoSettings({ library, collection, recipe, flags: { duration: "45", out: "ignored", assets: "ignored" } });
    assert.deepEqual(resolved.make, { quality: "high", aspect: "9:16", music: "synth", style: pack.name, voice: "kokoro", "voice-id": "af_heart", format: "promo", duration: "45", goal: "convert", renderer: "hyperframes", profile: "shorts" });
    assert.deepEqual(resolved.sources, { quality: "library", aspect: "recipe", music: "library", style: "collection", voice: "collection", "voice-id": "collection", format: "recipe", duration: "video", goal: "recipe", renderer: "recipe", profile: "recipe" });
    assert.equal(resolved.style.source, "collection");
    assert.equal(resolved.style.file, path.join(dir, "styles", pack.name, "style.json"));
    assert.equal(resolved.versions.style, versionOf(pack));
    assert.equal(resolved.versions.recipe, recipe.version);
    assert.deepEqual(resolved.rules, { file: "RULES.md", version: resolved.rules.version });
    assert.equal(resolved.brand_assets, path.join(dir, "brand"));
    assert.equal(resolved.isolation, "strict");
    assert.equal(resolved.projects_root, path.join(dir, "projects", "acme"));
    assert.equal(videoProjectDir({ library, collection, recipe: "feature-clip", slug: "sso" }), path.join(dir, "projects", "acme", "feature-clip", "sso"));
    assert.equal(videoProjectDir({ collection, slug: "sso" }), path.join(dir, "videos", "sso"));

    // A video's --seed replaces the collection's style.
    const seeded = await resolveVideoSettings({ collection, recipe, flags: { seed: "0badc0de" } });
    assert.equal(seeded.make.style, undefined);
    assert.equal(seeded.make.seed, "0badc0de");
    assert.equal(seeded.style, null);

    // runMake gets the style as its file, the rules' text and the brand folder; per-video flags pass through.
    const options = await makeOptionsFor(resolved, collection, { out: "/tmp/x", assets: "./assets" });
    assert.equal(options.style, resolved.style.file);
    assert.equal(options.out, "/tmp/x");
    assert.equal(options.assets, "./assets");
    assert.equal(options.duration, "45");
    assert.equal(options.voiceId, "af_heart");
    assert.equal(options.profile, "shorts");
    assert.equal(options.rules, "Never promise a launch date.");
    assert.equal(options.brandAssets, path.join(dir, "brand"));

    // An invalid value from any layer is refused with make's own message.
    await assert.rejects(resolveVideoSettings({ collection, recipe, flags: { renderer: "blender" } }), /--renderer must be remotion or hyperframes/);
    assert.deepEqual(layerFlags({ collection, flags: {} }).recipe, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a video goes stale when its recipe or its collection style changes, and not when only formatting does", async () => {
  const { dir, pack, recipe: recipeDoc } = await fixture();
  try {
    const collection = await loadCollection(dir);
    const recipe = await loadRecipe(collection, "feature-clip");
    const resolved = await resolveVideoSettings({ collection, recipe });
    const project = path.join(dir, "videos", "feature-clip", "sso");
    await writeVideoRecord(project, { collection: "acme", recipe: "feature-clip", recipe_version: resolved.versions.recipe, style: resolved.style.name, style_from: resolved.style.from, style_version: resolved.style.version, topic: "SSO", status: "ready" }, { clock: () => AT });
    let [entry] = await listCollectionVideos(collection);
    assert.equal(entry.project, project);
    assert.equal(entry.stale, false);
    assert.equal(entry.video.created_at, AT);

    // Reformatting the recipe is not an edit.
    await writeFile(recipe.file, JSON.stringify(recipeDoc));
    assert.deepEqual(await staleReasons(entry.video, collection), []);
    // Changing it is.
    await writeFile(recipe.file, JSON.stringify({ ...recipeDoc, make: { ...recipeDoc.make, duration: 45 } }));
    [entry] = await listCollectionVideos(collection);
    assert.deepEqual(entry.reasons, ["recipe feature-clip changed since this video was made"]);
    await writeFile(recipe.file, JSON.stringify(recipeDoc));

    const styleFile = path.join(dir, "styles", pack.name, "style.json");
    await writeFile(styleFile, JSON.stringify({ ...pack, description: "edited" }));
    [entry] = await listCollectionVideos(collection);
    assert.deepEqual(entry.reasons, [`style ${pack.name} changed since this video was made`]);

    // A per-video style is not the collection's to track.
    assert.deepEqual(await staleReasons({ ...entry.video, style_from: "video" }, collection), []);
    // Rewriting the record keeps created_at, parent and children.
    const again = await writeVideoRecord(project, { collection: "acme", recipe: "feature-clip", status: "approved" }, { clock: () => "2026-10-28T00:00:00.000Z" });
    assert.equal(again.created_at, AT);
    assert.equal(again.topic, "SSO");
    assert.equal(JSON.parse(await readFile(path.join(project, "video.json"), "utf8")).status, "approved");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a collection's rules and brand folder must stay inside it", async () => {
  const { dir, doc } = await fixture();
  try {
    await writeFile(path.join(dir, "collection.json"), JSON.stringify({ ...doc, rules: "MISSING.md" }));
    const collection = await loadCollection(dir);
    await assert.rejects(resolveVideoSettings({ collection }), /rules file .*MISSING\.md does not exist/);
    await writeFile(path.join(dir, "collection.json"), JSON.stringify({ ...doc, brand_assets: "/etc" }));
    await assert.rejects(loadCollection(dir), /brand_assets must be a path inside the collection folder/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// launchclip collection new | show, launchclip recipe new and
// launchclip make --collection (docs/COLLECTIONS_RFC.md §3.2–3.4, §4.2).
//
// A collection is a folder: `collection new acme` writes ./acme/ (or
// <--root>/acme/) with collection.json, a seeded style in styles/ that every
// video shares unless one is named, brand/, recipes/ and a RULES.md to fill
// in. `make --collection ./acme [--recipe feature-clip]` resolves the
// settings, writes the project's .launchclip/resolved.json, runs make and
// records video.json.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateStyle, normalizeSeed } from "../kit/core/style-seed.mjs";
import {
  COLLECTION_FILE, COLLECTION_KINDS, COLLECTION_SCHEMA, RECIPE_SCHEMA, RESOLVED_FILE, checkIdOrThrow, listCollectionVideos, listRecipeIds,
  loadCollection, loadRecipe, makeOptionsFor, recipeFile, resolveCollectionStyle, resolveVideoSettings, validateCollection, validateRecipe,
  VIDEO_FILE, versionOf, videoProjectDir, videoStatusFor, writeJsonAtomic, writeVideoRecord
} from "./collection.js";
import { MAKE_SETTING_FLAGS, settingsFromMakeReport } from "./make/options.js";
import { checkStorage } from "./storage_check.js";
import { freshSeed, promptTone } from "./style_seed_store.js";

const RULES_TEMPLATE = `# Rules

<!-- Every video in this collection follows these rules: the script pass, the
storyboard planner and the critic all read this file. Write them in your own
words, for example:

- Audience: who watches, and what they already know.
- Tone: how the videos sound.
- Claims: what the videos may and may not say (numbers, certifications, dates).
- Words to avoid.
- Things the videos never show.

Text inside these comment markers is ignored. -->
`;

/** <dir> when it holds a collection.json, else <root>/<value>. */
export function collectionDir(value, { root = null, cwd = process.cwd() } = {}) {
  if (!value) throw new Error("Missing collection: a collection folder or id");
  const direct = path.resolve(cwd, String(value));
  if (existsSync(path.join(direct, COLLECTION_FILE))) return direct;
  return root ? path.resolve(cwd, String(root), String(value)) : direct;
}

/** launchclip collection new <id> [--kind] [--title] [--style <name> | --seed <hex>] [--tone] [--root <dir>] */
export async function collectionNewCommand(id, flags = {}, { cwd = process.cwd(), clock = () => new Date().toISOString() } = {}) {
  checkIdOrThrow(id, "collection id");
  const kind = flags.kind ?? "product";
  if (!COLLECTION_KINDS.includes(kind)) throw new Error(`--kind must be one of ${COLLECTION_KINDS.join(", ")}; got ${kind}`);
  if (flags.style && flags.seed) throw new Error("--seed generates the collection's style; pass --seed or --style, not both");
  const dir = path.resolve(cwd, String(flags.root ?? "."), id);
  const file = path.join(dir, COLLECTION_FILE);
  if (existsSync(file)) throw new Error(`${file} already exists`);
  const doc = { schema: COLLECTION_SCHEMA, id, kind, title: flags.title ? String(flags.title) : id, style: null, brand_assets: "brand/", voice: null, rules: "RULES.md", isolation: "strict", recipes: [] };
  const collection = { dir, file, doc, id, isolation: "strict" };
  let style;
  if (flags.style) {
    style = await resolveCollectionStyle(collection, String(flags.style));
    doc.style = style.name;
  } else {
    style = await seedCollectionStyle(collection, { seed: flags.seed, tone: flags.tone, clock });
  }
  const check = validateCollection(doc);
  if (!check.ok) throw new Error(`the collection would be invalid:\n- ${check.errors.join("\n- ")}`);
  await mkdir(path.join(dir, "recipes"), { recursive: true });
  await mkdir(path.join(dir, "brand"), { recursive: true });
  await writeFile(path.join(dir, "RULES.md"), RULES_TEMPLATE);
  await writeJsonAtomic(file, doc);
  return {
    stage: "collection", action: "new", status: "ready", id, dir, file,
    style: { name: style.name, source: style.source, ...(style.seed ? { seed: style.seed } : {}) },
    next: [`write the collection's rules in ${path.join(dir, "RULES.md")} and put its logo and brand.json in ${path.join(dir, "brand")}/`, `launchclip make "<prompt>" --collection ${path.relative(cwd, dir) || "."}`, `launchclip recipe new ${path.relative(cwd, dir) || id}/<recipe-id> --from-video <project> (or with make flags)`]
  };
}

// The one seeded style a collection's videos share when none is named
// (docs/SEEDED_STYLES_RFC.md), saved as <collection>/styles/seed-<hex>/ and
// named in collection.json. Mutates collection.doc.
async function seedCollectionStyle(collection, { seed, tone = null, clock }) {
  const pack = generateStyle({ seed: seed ? normalizeSeed(seed) : freshSeed(), tone: tone ?? null, at: clock() });
  const file = path.join(collection.dir, "styles", pack.name, "style.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(pack, null, 2)}\n`);
  collection.doc.style = pack.name;
  return { name: pack.name, file, source: "collection", seed: pack.generated.seed };
}

/** launchclip collection show <id|dir> [--root <dir>] [--json] */
export async function collectionShowCommand(value, flags = {}, { cwd = process.cwd(), library = null } = {}) {
  const collection = await loadCollection(collectionDir(value, { root: flags.root, cwd }));
  const recipes = [];
  for (const id of await listRecipeIds(collection)) {
    const recipe = await loadRecipe(collection, id).catch((error) => ({ id, error: error.message.split("\n").slice(0, 2).join(" ") }));
    recipes.push(recipe.error ? { id, error: recipe.error } : { id, title: recipe.doc.title ?? null, make: recipe.doc.make ?? {}, profile: recipe.doc.profile ?? null, version: recipe.version });
  }
  const videos = (await listCollectionVideos(collection, { library })).map((entry) => ({
    project: entry.project, recipe: entry.video.recipe, topic: entry.video.topic, status: entry.video.status, stale: entry.stale, reasons: entry.reasons, updated_at: entry.video.updated_at ?? null
  }));
  return {
    stage: "collection", action: "show", status: "ready",
    id: collection.id, dir: collection.dir, kind: collection.doc.kind ?? "product", title: collection.doc.title ?? collection.id,
    style: collection.doc.style ?? null, voice: collection.doc.voice ?? null, brand_assets: collection.doc.brand_assets ?? null, rules: collection.doc.rules ?? null, isolation: collection.isolation,
    recipes, videos, stale: videos.filter((video) => video.stale).length, warnings: collection.warnings
  };
}

export function formatCollectionShow(report) {
  const lines = [`collection ${report.id} (${report.kind}): ${report.title}`, `  folder     ${report.dir}`, `  style      ${report.style ?? "none"}`, `  voice      ${report.voice ? `${report.voice.engine}${report.voice.id ? ` ${report.voice.id}` : ""}` : "make's default"}`, `  brand      ${report.brand_assets ?? "none"}`, `  rules      ${report.rules ?? "none"}`, `  isolation  ${report.isolation}`];
  lines.push("", `recipes (${report.recipes.length}):`);
  for (const recipe of report.recipes) lines.push(recipe.error ? `  ${recipe.id}  INVALID: ${recipe.error}` : `  ${recipe.id}${recipe.title ? `  ${recipe.title}` : ""}  ${Object.entries(recipe.make).map(([flag, value]) => (value === true ? `--${flag}` : `--${flag} ${value}`)).join(" ")}${recipe.profile ? ` (profile ${recipe.profile})` : ""}`.trimEnd());
  lines.push("", `videos (${report.videos.length}, ${report.stale} stale):`);
  for (const video of report.videos) {
    lines.push(`  ${video.stale ? "STALE " : ""}${video.status.padEnd(16)} ${video.recipe ?? "-"}  ${video.topic ?? ""}`.trimEnd(), `    ${video.project}`);
    for (const reason of video.reasons) lines.push(`    ${reason}; make it again to update`);
  }
  for (const warning of report.warnings ?? []) lines.push(`warning: ${warning}`);
  return `${lines.join("\n")}\n`;
}

/**
 * launchclip recipe new <collection>/<id> [--from-video <project>] [--title] [--force] [make setting flags]:
 * the settings of a finished video (its MAKE.json) and/or the given flags,
 * saved as <collection>/recipes/<id>.json. The flags win over the video's.
 */
export async function recipeNewCommand(spec, flags = {}, { cwd = process.cwd() } = {}) {
  const slash = String(spec ?? "").lastIndexOf("/");
  if (slash <= 0) throw new Error("recipe new needs <collection>/<id>, e.g. launchclip recipe new acme/feature-clip");
  const id = checkIdOrThrow(String(spec).slice(slash + 1), "recipe id");
  const collection = await loadCollection(collectionDir(String(spec).slice(0, slash), { root: flags.root, cwd }));
  const file = recipeFile(collection, id);
  if (existsSync(file) && !flags.force) throw new Error(`${file} already exists. Pass --force to replace it (videos made with it become stale)`);
  const make = {};
  let profile = null;
  let fromVideo = null;
  const notes = [];
  if (flags["from-video"]) {
    const project = path.resolve(cwd, String(flags["from-video"]));
    const report = await readJsonFile(path.join(project, "MAKE.json"), `${project} has no MAKE.json; --from-video takes a project made by launchclip make`);
    const settings = settingsFromMakeReport(report);
    Object.assign(make, settings.flags);
    profile = settings.profile;
    const style = await adoptVideoStyle(collection, project, settings.style, { force: Boolean(flags.force) });
    if (style.flag) make.style = style.flag;
    if (style.note) notes.push(style.note);
    fromVideo = path.relative(collection.dir, project) || ".";
  }
  for (const flag of MAKE_SETTING_FLAGS) {
    if (flags[flag] === undefined) continue;
    if (flag === "style" || flag === "seed") { delete make.style; delete make.seed; }
    if (flag === "profile") profile = String(flags.profile);
    else make[flag] = coerce(flag, flags[flag]);
  }
  if (flags["no-critic"]) delete make.critic;
  if (flags.critic) delete make["no-critic"];
  const doc = { schema: RECIPE_SCHEMA, id, title: flags.title ? String(flags.title) : id, make, ...(profile ? { profile } : {}), ...(fromVideo ? { from_video: fromVideo } : {}) };
  const check = validateRecipe(doc, { id });
  if (!check.ok) throw new Error(`the recipe would be invalid:\n- ${check.errors.join("\n- ")}`);
  await writeJsonAtomic(file, doc);
  if (!(collection.doc.recipes ?? []).includes(id)) await writeJsonAtomic(collection.file, { ...collection.doc, recipes: [...(collection.doc.recipes ?? []), id] });
  // The video the recipe came from was made with exactly these settings: it
  // joins the recipe, so editing the recipe marks it stale like the rest.
  const linked = flags["from-video"] ? await linkSourceVideo(path.resolve(cwd, String(flags["from-video"])), collection, id, versionOf(doc)) : false;
  if (linked) notes.push(`${path.relative(cwd, linked) || "."} is now recorded as made with recipe ${id}`);
  return { stage: "recipe", action: "new", status: "ready", collection: collection.id, id, file, recipe: doc, version: versionOf(doc), notes, next: `launchclip make "<prompt>" --collection ${path.relative(cwd, collection.dir) || "."} --recipe ${id}` };
}

// The style a finished video used, made nameable by the recipe: the
// collection's own style needs nothing (the recipe inherits it); a user or
// built-in style is named; a style that lives only in the project (a seeded
// or path-loaded pack) is copied to <collection>/styles/<name>/.
async function adoptVideoStyle(collection, project, style, { force }) {
  if (!style?.name) return {};
  if (style.name === collection.doc.style) return {};
  if (style.source === "home" || style.source === "builtin") return { flag: style.name };
  const source = path.join(project, ".launchclip", "styles", style.name, "style.json");
  if (!existsSync(source)) return { note: `the video's style ${style.name} was not found in ${path.dirname(source)}; the recipe uses the collection's style` };
  const target = path.join(collection.dir, "styles", style.name, "style.json");
  const text = await readFile(source, "utf8");
  if (existsSync(target) && (await readFile(target, "utf8")) !== text && !force) throw new Error(`${target} already exists with a different pack. Pass --force to replace it`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text);
  return { flag: style.name, note: `copied the video's style ${style.name} to ${path.relative(collection.dir, target)}` };
}

async function linkSourceVideo(project, collection, recipe, version) {
  const file = path.join(project, VIDEO_FILE);
  if (!existsSync(file)) return false;
  const video = JSON.parse(await readFile(file, "utf8"));
  if (video.collection !== collection.id) return false;
  await writeVideoRecord(project, { ...video, recipe, recipe_version: version });
  return project;
}

/**
 * launchclip make "<prompt>" --collection <dir> [--recipe <id>] [make flags]:
 * resolve the settings, write <project>/.launchclip/resolved.json, run make
 * and record <project>/video.json. adapters: runMake's, plus runMake (a
 * replacement), library (phase 1's parsed library file; null until it is
 * wired in) and clock.
 */
export async function makeInCollection(prompt, flags = {}, adapters = {}) {
  const { cwd = process.cwd(), library = null, clock = () => new Date().toISOString() } = adapters;
  const { runMake, slugify } = await import("./make/index.js");
  const collection = await loadCollection(collectionDir(flags.collection, { cwd }));
  const recipe = flags.recipe ? await loadRecipe(collection, String(flags.recipe)) : null;
  // A hand-written collection.json with no style still shares one seeded style.
  if (!collection.doc.style && !hasStyleFlag(flags) && !hasStyleFlag(recipe?.doc.make)) {
    const made = await seedCollectionStyle(collection, { tone: promptTone(prompt), clock });
    await writeJsonAtomic(collection.file, collection.doc);
    adapters.notice?.(`collection: no style named; seeded ${made.name} for every video in ${collection.id} (styles/${made.name})`);
  }
  const resolved = await resolveVideoSettings({ library, collection, recipe, flags: videoFlags(flags, cwd) });
  const project = flags.out ? path.resolve(cwd, String(flags.out)) : videoProjectDir({ library, collection, recipe: recipe?.id, slug: slugify(prompt) });
  // Inside a library the project's drive is checked before anything is written (src/storage_check.js).
  if (library) await checkStorage(project, { minFreeGb: library.storage.min_free_gb, label: flags.out ? "--out" : "storage.projects", source: library.file });
  await writeJsonAtomic(path.join(project, RESOLVED_FILE), { ...resolved, project, prompt: String(prompt).trim(), resolved_at: clock() });
  const options = { ...(await makeOptionsFor(resolved, collection, { ...flags, out: project })), cwd, library };
  const report = await (adapters.runMake ?? runMake)(prompt, options, adapters);
  const style = resolved.style ?? await projectStyle(project, report, resolved);
  report.collection = { id: collection.id, dir: collection.dir, recipe: recipe?.id ?? null, resolved: RESOLVED_FILE, video: "video.json" };
  await writeVideoRecord(project, {
    collection: collection.id,
    recipe: recipe?.id ?? null,
    recipe_version: recipe?.version ?? null,
    style: style?.name ?? null,
    style_from: style?.from ?? null,
    style_version: style?.version ?? null,
    topic: String(prompt).trim(),
    status: videoStatusFor(report)
  }, { clock });
  return report;
}

// The video's own --style path is relative to where the command ran, not to the collection.
function videoFlags(flags, cwd) {
  const style = flags.style;
  if (typeof style === "string" && (style.startsWith(".") || style.includes("/") || style.endsWith(".json"))) return { ...flags, style: path.resolve(cwd, style) };
  return flags;
}

// A style make chose itself (a seed from the video's flags): its version is
// recorded for the record, but it belongs to the video, not the collection.
async function projectStyle(project, report, resolved) {
  const name = report?.style?.name;
  if (!name) return null;
  const pack = await readJsonFile(path.join(project, ".launchclip", "styles", name, "style.json"), null).catch(() => null);
  return { name, from: resolved.sources.seed === "video" ? "video" : "make", version: pack ? versionOf(pack) : null };
}

function hasStyleFlag(make) {
  return Boolean(make && (make.style || make.seed));
}

// CLI values arrive as strings; a recipe stores its numbers as numbers.
const NUMERIC_FLAGS = new Set(["duration", "max-repairs"]);

function coerce(flag, value) {
  return NUMERIC_FLAGS.has(flag) && typeof value === "string" && /^\d+(\.\d+)?$/.test(value) ? Number(value) : value;
}

async function readJsonFile(file, missing) {
  if (!existsSync(file)) throw new Error(missing ?? `${file} not found`);
  return JSON.parse(await readFile(file, "utf8"));
}

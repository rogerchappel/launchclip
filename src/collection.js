// Collections, recipes and video provenance (docs/COLLECTIONS_RFC.md §3.2–3.4).
//
//   <collection>/collection.json     launchclip.collection.v1: kind, style, voice, brand_assets, rules, isolation
//   <collection>/recipes/<id>.json   launchclip.recipe.v1: a saved set of `launchclip make` flags
//   <collection>/styles/<name>/      the collection's own style packs (its seeded style lives here)
//   <video project>/video.json       launchclip.video.v1: where a video came from, and on which versions
//   <video project>/.launchclip/resolved.json   the settings the video was made with
//
// Settings resolve library → collection → recipe → the video's own flags; a
// later layer wins flag by flag (and --style and --seed replace each other,
// being one setting). The library layer is the parsed launchclip.library.json
// passed in by the caller (phase 1's findLibrary); with none, videos live in
// <collection>/videos/. Stale is computed on read: a video whose recipe or
// style has changed since it was made is stale until it is made again.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAKE_SETTING_FLAGS, MAKE_VOICES, makeOptionsFromFlags, validateMakeOptions } from "./make/options.js";
import { resolveStyleV2 } from "./style_store.js";

export const COLLECTION_SCHEMA = "launchclip.collection.v1";
export const RECIPE_SCHEMA = "launchclip.recipe.v1";
export const VIDEO_SCHEMA = "launchclip.video.v1";
export const RESOLVED_SCHEMA = "launchclip.resolved.v1";
export const COLLECTION_FILE = "collection.json";
export const VIDEO_FILE = "video.json";
export const RESOLVED_FILE = ".launchclip/resolved.json";
export const COLLECTION_KINDS = Object.freeze(["product", "channel", "client", "campaign", "course"]);
export const ISOLATION_MODES = Object.freeze(["strict", "shared"]);
export const VIDEO_STATUSES = Object.freeze(["planned", "approved-script", "rendering", "ready-for-review", "needs-repair", "ready", "approved", "failed"]);
export const CHILD_VIA = Object.freeze(["cutdown", "reframe"]);
export const LAYERS = Object.freeze(["library", "collection", "recipe", "video"]);

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const COLLECTION_KEYS = new Set(["schema", "id", "kind", "title", "style", "brand_assets", "voice", "rules", "isolation", "recipes", "template"]);
const RECIPE_KEYS = new Set(["schema", "id", "title", "make", "profile", "destinations", "fixed", "vary", "children", "from_video"]);
const VIDEO_KEYS = new Set(["schema", "collection", "recipe", "recipe_version", "style", "style_from", "style_version", "parent", "children", "topic", "status", "created_at", "updated_at"]);

// ---------------------------------------------------------------------------
// Validation: {ok, errors, warnings}

export function validateCollection(doc) {
  const errors = [];
  const warnings = [];
  if (!isObject(doc)) return { ok: false, errors: ["collection.json must be a JSON object"], warnings };
  if (doc.schema !== COLLECTION_SCHEMA) errors.push(`schema must be "${COLLECTION_SCHEMA}"`);
  checkId(doc.id, "id", errors);
  if (doc.kind !== undefined && !COLLECTION_KINDS.includes(doc.kind)) errors.push(`kind must be one of ${COLLECTION_KINDS.join(", ")}; got ${JSON.stringify(doc.kind)}`);
  optionalString(doc, "title", errors);
  optionalString(doc, "style", errors);
  if (typeof doc.style === "string" && doc.style.trim() === "") errors.push("style must name a style pack, or be null");
  optionalRelativePath(doc, "brand_assets", errors);
  optionalRelativePath(doc, "rules", errors);
  if (doc.voice != null) {
    if (!isObject(doc.voice)) errors.push("voice must be an object {engine, id} or null");
    else {
      if (!MAKE_VOICES.includes(doc.voice.engine)) errors.push(`voice.engine must be one of ${MAKE_VOICES.join(", ")}; got ${JSON.stringify(doc.voice.engine)}`);
      if (doc.voice.id != null && (typeof doc.voice.id !== "string" || !doc.voice.id.trim())) errors.push("voice.id must be a voice id string or null");
    }
  }
  if (doc.isolation !== undefined && !ISOLATION_MODES.includes(doc.isolation)) errors.push(`isolation must be one of ${ISOLATION_MODES.join(", ")}; got ${JSON.stringify(doc.isolation)}`);
  if (doc.recipes !== undefined) {
    if (!Array.isArray(doc.recipes)) errors.push("recipes must be an array of recipe ids");
    else doc.recipes.forEach((id, index) => checkId(id, `recipes[${index}]`, errors));
  }
  // Phase 6 (collection templates): validated, not used yet.
  optionalString(doc, "template", errors);
  for (const key of Object.keys(doc)) if (!COLLECTION_KEYS.has(key)) warnings.push(`unknown field ${key} (ignored)`);
  return { ok: !errors.length, errors, warnings };
}

export function validateRecipe(doc, { id = null } = {}) {
  const errors = [];
  const warnings = [];
  if (!isObject(doc)) return { ok: false, errors: ["the recipe must be a JSON object"], warnings };
  if (doc.schema !== RECIPE_SCHEMA) errors.push(`schema must be "${RECIPE_SCHEMA}"`);
  checkId(doc.id, "id", errors);
  if (id && doc.id !== id) errors.push(`id ${JSON.stringify(doc.id)} does not match the file name (${id}.json)`);
  optionalString(doc, "title", errors);
  if (doc.make !== undefined) {
    if (!isObject(doc.make)) errors.push("make must be an object of launchclip make flags, e.g. {\"aspect\": \"9:16\", \"duration\": 60}");
    else {
      for (const key of Object.keys(doc.make)) if (!MAKE_SETTING_FLAGS.includes(key)) errors.push(`make.${key} is not a make setting a recipe can save (${MAKE_SETTING_FLAGS.join(", ")})`);
      try { validateMakeOptions(makeOptionsFromFlags(doc.make)); } catch (error) { errors.push(`make: ${error.message}`); }
    }
  }
  optionalString(doc, "profile", errors);
  // Phase 5 (vary dials) and phase 6 (destinations, children): validated, not used yet.
  if (doc.destinations !== undefined && !(Array.isArray(doc.destinations) && doc.destinations.every((item) => typeof item === "string" && item.trim()))) errors.push("destinations must be an array of destination names");
  if (doc.fixed !== undefined && !isObject(doc.fixed)) errors.push("fixed must be an object");
  if (doc.vary !== undefined && !(Array.isArray(doc.vary) && doc.vary.every((item) => typeof item === "string" && item.trim()))) errors.push("vary must be an array of dial names");
  if (doc.children !== undefined) {
    if (!Array.isArray(doc.children)) errors.push("children must be an array of {recipe, via}");
    else doc.children.forEach((child, index) => {
      if (!isObject(child)) { errors.push(`children[${index}] must be {recipe, via}`); return; }
      checkId(child.recipe, `children[${index}].recipe`, errors);
      if (!CHILD_VIA.includes(child.via)) errors.push(`children[${index}].via must be one of ${CHILD_VIA.join(", ")}`);
    });
  }
  for (const key of Object.keys(doc)) if (!RECIPE_KEYS.has(key)) warnings.push(`unknown field ${key} (ignored)`);
  return { ok: !errors.length, errors, warnings };
}

export function validateVideo(doc) {
  const errors = [];
  const warnings = [];
  if (!isObject(doc)) return { ok: false, errors: ["video.json must be a JSON object"], warnings };
  if (doc.schema !== VIDEO_SCHEMA) errors.push(`schema must be "${VIDEO_SCHEMA}"`);
  checkId(doc.collection, "collection", errors);
  if (doc.recipe != null) checkId(doc.recipe, "recipe", errors);
  for (const key of ["recipe_version", "style_version"]) if (doc[key] != null && !/^sha256:[0-9a-f]{64}$/.test(doc[key])) errors.push(`${key} must be "sha256:<hex>" or null`);
  optionalString(doc, "style", errors);
  if (doc.style_from != null && !LAYERS.includes(doc.style_from) && doc.style_from !== "make") errors.push(`style_from must be one of ${[...LAYERS, "make"].join(", ")}`);
  optionalString(doc, "parent", errors);
  if (doc.children !== undefined && !(Array.isArray(doc.children) && doc.children.every((item) => typeof item === "string"))) errors.push("children must be an array of project paths");
  optionalString(doc, "topic", errors);
  if (!VIDEO_STATUSES.includes(doc.status)) errors.push(`status must be one of ${VIDEO_STATUSES.join(", ")}; got ${JSON.stringify(doc.status)}`);
  for (const key of Object.keys(doc)) if (!VIDEO_KEYS.has(key)) warnings.push(`unknown field ${key} (ignored)`);
  return { ok: !errors.length, errors, warnings };
}

// ---------------------------------------------------------------------------
// Loading

/** → {dir, file, doc, id, isolation} or throws with every error. */
export async function loadCollection(dir) {
  const root = path.resolve(dir);
  const file = path.join(root, COLLECTION_FILE);
  if (!existsSync(file)) throw new Error(`${file} not found; create the collection with launchclip collection new <id>`);
  const doc = await readJsonStrict(file);
  const check = validateCollection(doc);
  if (!check.ok) throw new Error(`${file} is invalid:\n- ${check.errors.join("\n- ")}`);
  return { dir: root, file, doc, id: doc.id, isolation: doc.isolation ?? "strict", warnings: check.warnings };
}

export function recipeFile(collection, id) {
  return path.join(collection.dir, "recipes", `${id}.json`);
}

/** → {id, file, doc, version} or throws. */
export async function loadRecipe(collection, id) {
  checkIdOrThrow(id, "recipe id");
  const file = recipeFile(collection, id);
  if (!existsSync(file)) {
    const known = await listRecipeIds(collection);
    throw new Error(`recipe ${id} not found in ${collection.dir}/recipes/ (${known.length ? `known: ${known.join(", ")}` : "the collection has none yet; launchclip recipe new"})`);
  }
  const doc = await readJsonStrict(file);
  const check = validateRecipe(doc, { id });
  if (!check.ok) throw new Error(`${file} is invalid:\n- ${check.errors.join("\n- ")}`);
  return { id, file, doc, version: versionOf(doc), warnings: check.warnings };
}

export async function listRecipeIds(collection) {
  const dir = path.join(collection.dir, "recipes");
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)).sort();
}

/**
 * A style named by the collection or a recipe: the collection's own
 * styles/<name>/ first, then the user's and the built-in styles.
 * → {name, file, pack, version, source: "collection"|"home"|"builtin"|"path"}
 */
export async function resolveCollectionStyle(collection, name) {
  const loaded = await resolveStyleV2(name, { root: path.join(collection.dir, "styles"), projectDir: collection.dir });
  const source = loaded.source === "project" ? "collection" : loaded.source;
  return { name: loaded.name, file: loaded.file ?? null, pack: loaded.pack, version: versionOf(loaded.pack), source };
}

// ---------------------------------------------------------------------------
// Resolution

/**
 * The make flags each layer sets. library: its `make` block, if it has one
 * (phase 1's library file); collection: style, voice; recipe: its make block
 * and profile; video: the setting flags given on the command line.
 */
export function layerFlags({ library = null, collection, recipe = null, flags = {} }) {
  const fromCollection = {};
  if (collection.doc.style) fromCollection.style = collection.doc.style;
  if (collection.doc.voice?.engine) fromCollection.voice = collection.doc.voice.engine;
  if (collection.doc.voice?.id) fromCollection["voice-id"] = collection.doc.voice.id;
  const fromRecipe = { ...(recipe?.doc.make ?? {}), ...(recipe?.doc.profile ? { profile: recipe.doc.profile } : {}) };
  const fromVideo = Object.fromEntries(Object.entries(flags).filter(([flag, value]) => MAKE_SETTING_FLAGS.includes(flag) && value !== undefined));
  return { library: { ...(isObject(library?.make) ? library.make : {}) }, collection: fromCollection, recipe: fromRecipe, video: fromVideo };
}

/**
 * Resolve one video's settings: library → collection → recipe → the video's
 * flags. → the resolved.json document: {schema, collection, recipe, make
 * (flags), sources (flag → layer), style, rules, brand_assets, isolation,
 * versions, project_root}.
 */
export async function resolveVideoSettings({ library = null, collection, recipe = null, flags = {} }) {
  const layers = layerFlags({ library, collection, recipe, flags });
  const make = {};
  const sources = {};
  for (const layer of LAYERS) {
    for (const [flag, value] of Object.entries(layers[layer])) {
      // --style and --seed are one setting: a layer that sets either replaces both.
      if (flag === "style" || flag === "seed") for (const other of ["style", "seed"]) { delete make[other]; delete sources[other]; }
      make[flag] = value;
      sources[flag] = layer;
    }
  }
  validateMakeOptions(makeOptionsFromFlags(make));
  let style = null;
  if (make.style) {
    const resolved = await resolveCollectionStyle(collection, String(make.style));
    style = { name: resolved.name, file: resolved.file, source: resolved.source, from: sources.style, version: resolved.version };
  }
  const rules = await readRules(collection);
  const brandAssets = collection.doc.brand_assets ? insideCollection(collection, collection.doc.brand_assets, "brand_assets") : null;
  if (brandAssets && !existsSync(brandAssets)) throw new Error(`brand_assets ${brandAssets} does not exist; create it or set "brand_assets": null in ${collection.file}`);
  return {
    schema: RESOLVED_SCHEMA,
    collection: collection.id,
    recipe: recipe?.id ?? null,
    make,
    sources,
    style,
    rules: rules ? { file: path.relative(collection.dir, rules.file), version: rules.version } : null,
    brand_assets: brandAssets,
    isolation: collection.isolation,
    versions: { recipe: recipe?.version ?? null, style: style?.version ?? null },
    projects_root: videosRoot({ library, collection })
  };
}

/**
 * runMake's options for a resolved video: the resolved flags over the
 * video's own per-video flags (assets, out, repo, …), the style as the file
 * it resolved to, plus the collection's rules text and brand folder.
 */
export async function makeOptionsFor(resolved, collection, flags = {}) {
  const options = makeOptionsFromFlags({ ...flags, ...resolved.make, ...(resolved.style?.file ? { style: resolved.style.file } : {}) });
  const rules = await readRules(collection);
  return { ...options, ...(rules ? { rules: rules.text } : {}), ...(resolved.brand_assets ? { brandAssets: resolved.brand_assets } : {}) };
}

/** Where a collection's videos go: <library projects>/<collection>/, else <collection>/videos/. */
export function videosRoot({ library = null, collection }) {
  const projects = library?.storage?.projects;
  return projects ? path.join(path.resolve(String(projects)), collection.id) : path.join(collection.dir, "videos");
}

/** <videos root>/<recipe>/<slug>, or <videos root>/<slug> for a video with no recipe. */
export function videoProjectDir({ library = null, collection, recipe = null, slug }) {
  return path.join(videosRoot({ library, collection }), ...(recipe ? [recipe] : []), slug);
}

// ---------------------------------------------------------------------------
// video.json and staleness

/** Write (or update) a project's video.json; the existing record's parent, children and created_at are kept. */
export async function writeVideoRecord(project, record, { clock = () => new Date().toISOString() } = {}) {
  const file = path.join(project, VIDEO_FILE);
  const previous = await readJson(file);
  const now = clock();
  const doc = {
    schema: VIDEO_SCHEMA,
    collection: record.collection,
    recipe: record.recipe ?? null,
    recipe_version: record.recipe_version ?? null,
    style: record.style ?? null,
    style_from: record.style_from ?? null,
    style_version: record.style_version ?? null,
    parent: record.parent ?? previous?.parent ?? null,
    children: record.children ?? previous?.children ?? [],
    topic: record.topic ?? previous?.topic ?? null,
    status: record.status,
    created_at: previous?.created_at ?? now,
    updated_at: now
  };
  const check = validateVideo(doc);
  if (!check.ok) throw new Error(`video.json would be invalid:\n- ${check.errors.join("\n- ")}`);
  await writeJsonAtomic(file, doc);
  return doc;
}

/** make's report status → the video's status. */
export function videoStatusFor(report) {
  const status = report?.status;
  return VIDEO_STATUSES.includes(status) ? status : status === "running" ? "rendering" : "failed";
}

/**
 * Why a video is stale, from what it recorded against the collection as it
 * is now: [] when it is current. A style is followed by name; a style the
 * video's own flags or make chose (a per-video seed) is not tracked.
 */
export async function staleReasons(video, collection, { recipes = new Map() } = {}) {
  const reasons = [];
  if (video.recipe) {
    let recipe = recipes.get(video.recipe);
    if (recipe === undefined) {
      recipe = await loadRecipe(collection, video.recipe).catch(() => null);
      recipes.set(video.recipe, recipe);
    }
    if (!recipe) reasons.push(`recipe ${video.recipe} no longer exists`);
    else if (video.recipe_version && recipe.version !== video.recipe_version) reasons.push(`recipe ${video.recipe} changed since this video was made`);
  }
  if (video.style && video.style_version && ["library", "collection", "recipe"].includes(video.style_from)) {
    const style = await resolveCollectionStyle(collection, video.style).catch(() => null);
    if (!style) reasons.push(`style ${video.style} no longer exists`);
    else if (style.version !== video.style_version) reasons.push(`style ${video.style} changed since this video was made`);
  }
  return reasons;
}

/**
 * Every video of a collection: the projects under its videos root (two
 * levels: <recipe>/<slug> and <slug>) that have a video.json naming it.
 * → [{project, video, stale, reasons}], sorted by project.
 */
export async function listCollectionVideos(collection, { library = null } = {}) {
  const root = videosRoot({ library, collection });
  const projects = [];
  for (const first of await subdirectories(root)) {
    if (existsSync(path.join(first, VIDEO_FILE))) projects.push(first);
    else for (const second of await subdirectories(first)) if (existsSync(path.join(second, VIDEO_FILE))) projects.push(second);
  }
  const recipes = new Map();
  const out = [];
  for (const project of projects.sort()) {
    const video = await readJson(path.join(project, VIDEO_FILE));
    if (!video || video.collection !== collection.id) continue;
    const reasons = await staleReasons(video, collection, { recipes });
    out.push({ project, video, stale: reasons.length > 0, reasons });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers

/** "sha256:<hex>" of a JSON value with its keys sorted, so formatting never counts as an edit. */
export function versionOf(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

async function readRules(collection) {
  if (!collection.doc.rules) return null;
  const file = insideCollection(collection, collection.doc.rules, "rules");
  if (!existsSync(file)) throw new Error(`rules file ${file} does not exist; write it or set "rules": null in ${collection.file}`);
  // HTML comments are notes to the writer (collection new's template); headings alone are no rules.
  const text = (await readFile(file, "utf8")).replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!text.replace(/^#.*$/gm, "").trim()) return null;
  return { file, text, version: `sha256:${createHash("sha256").update(text).digest("hex")}` };
}

// brand_assets and rules are paths inside the collection folder: under
// isolation "strict" nothing of another collection's can be pulled in, and
// "shared" still keeps the files with the collection that names them.
function insideCollection(collection, relative, field) {
  const resolved = path.resolve(collection.dir, relative);
  const back = path.relative(collection.dir, resolved);
  if (back.startsWith("..") || path.isAbsolute(back)) throw new Error(`${field} ${relative} is outside the collection folder ${collection.dir}`);
  return resolved;
}

async function subdirectories(dir) {
  if (!existsSync(dir)) return [];
  return (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => path.join(dir, entry.name));
}

function checkId(value, label, errors) {
  if (typeof value !== "string" || !ID.test(value)) errors.push(`${label} must be lowercase letters, digits and hyphens (up to 64); got ${JSON.stringify(value)}`);
}

export function checkIdOrThrow(value, label) {
  const errors = [];
  checkId(value, label, errors);
  if (errors.length) throw new Error(errors[0]);
  return value;
}

function optionalString(doc, key, errors) {
  if (doc[key] != null && typeof doc[key] !== "string") errors.push(`${key} must be a string or null`);
}

function optionalRelativePath(doc, key, errors) {
  if (doc[key] == null) return;
  if (typeof doc[key] !== "string" || !doc[key].trim()) errors.push(`${key} must be a path inside the collection, or null`);
  else if (path.isAbsolute(doc[key]) || doc[key].split(/[\\/]/).includes("..")) errors.push(`${key} must be a path inside the collection folder; got ${doc[key]}`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readJsonStrict(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch (error) { throw new Error(`${file} is not valid JSON: ${error.message}`); }
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

export async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const staging = `${file}.${process.pid}.tmp`;
  await writeFile(staging, `${JSON.stringify(value, null, 2)}\n`);
  await rename(staging, file);
}

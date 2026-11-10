// Designing characters: `launchclip cast create / edit / options / export /
// import`, the sheet of one saved character, and a show bible's reference
// sheets (referenceSheet; src/bible.js).
//
//   cast create <id> [--describe "…"] [--set path=value …] [--from <id>]
//   cast edit <id> [--instruction "…"] [--set path=value …]
//   cast options [path]
//   cast export [ids…] --out <folder | pack.json>
//   cast import <folder | pack.json | character.json> [--to project|library]
//
// A description or an instruction is mapped onto the rig's options with no
// model (kit/core/characters/describe.mjs). --model provider:model (or
// LAUNCHCLIP_CAST_MODEL) asks a model for the same set paths instead; its
// answer goes through the same validation, so it can only choose options
// the rig has. Either way the result is a list of set paths, the one edit
// language: everything an instruction does, --set can do.
//
// The character is saved to <project>/cast/<id>.character.json (or the user
// library with --to library) and its sheet is drawn beside it
// (<id>.sheet.png): a few poses and every expression, in its drawing style.
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { CHARACTER_PATHS, CHARACTER_SCHEMA, applyCharacterSets, characterCastEntry, characterPaths, normalizeCharacter, parseSet } from "@launchclip/core/characters/character.mjs";
import { describeCharacter, newCharacterDefaults, pickVoice } from "@launchclip/core/characters/describe.mjs";
import { isStarterId, starterCharacter, STARTER_IDS } from "@launchclip/core/characters/cast.mjs";
import { EXPRESSIONS, POSES } from "@launchclip/core/characters/rig.mjs";
import { listCharacters, loadCharacter, projectCastRoot, readCastPack, saveCharacter, writeCastPack } from "./character_store.js";

// The poses a design sheet shows unless --poses names others (those the rig still has).
const SHEET_POSES = ["stand", "wave", "point", "think", "arms-crossed", "sit"];

const list = (value) => (value === undefined || value === null || value === true ? [] : Array.isArray(value) ? value : [value]);
const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const titleCase = (id) => id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");

function storeOptions(flags, hooks = {}) {
  return { projectDir: path.resolve(String(flags.project ?? ".")), home: hooks.home };
}

/** --set values (the flag repeats) → [{path, op, value}]. */
function flagSets(flags) {
  return list(flags.set).map((entry) => parseSet(entry));
}

/** The top-level flags that are shorthand for set paths. */
function shorthandSets(flags) {
  return ["name", "personality", "voice", "style"].filter((key) => text(flags[key])).map((key) => ({ path: key, op: "=", value: text(flags[key]) }));
}

// ---------------------------------------------------------------------------
// Words → set paths

const MODEL_SCHEMA = () => ({
  type: "object",
  additionalProperties: false,
  required: ["sets", "personality"],
  properties: {
    sets: { type: "array", items: { type: "object", additionalProperties: false, required: ["path", "op", "value"], properties: { path: { type: "string", enum: [...CHARACTER_PATHS] }, op: { type: "string", enum: ["=", "+=", "-="] }, value: { type: "string" } } } },
    personality: { type: ["string", "null"] }
  }
});

/** One prompt line per set path with the options the rig has for it (only: the paths to list; all of them by default). */
export function characterOptionLines(only = null) {
  return Object.entries(characterPaths()).filter(([name]) => !only || only.includes(name)).map(([name, spec]) => `- ${name}: ${spec.values ? spec.values.join(", ") : spec.describe}${spec.hex ? " (or a six-digit hex)" : ""}${spec.list ? " (a list: use += to add one and -= to remove one)" : ""}${spec.clear ? ' ("none" clears it)' : ""}`);
}

function modelInstructions() {
  const lines = characterOptionLines();
  return [
    "You design an illustrated character for an animated explainer by choosing options of a drawing rig.",
    "Answer with set paths only. Each value must be one of the options listed for its path; choose the nearest option when the words name something the rig lacks, and leave a trait out when nothing is close.",
    "Set only what the text asks for. For an edit, change only what the instruction names.",
    "The character is an illustrative person. If the text names a real person, do not try to reproduce their likeness: use only the plain traits it states (hair, clothes, build) and ignore the name.",
    "personality: one line of at most 160 characters when the text describes one, else null.",
    "",
    "Paths and options:",
    ...lines
  ].join("\n");
}

/** Keep the sets whose path and value the rig knows; name the rest. The door every model-chosen look goes through (make's show bible stage uses it too). */
export function checkedSets(sets) {
  const paths = characterPaths();
  const kept = [], rejected = [];
  for (const set of Array.isArray(sets) ? sets : []) {
    const spec = paths[set?.path];
    const value = String(set?.value ?? "").trim();
    const op = ["=", "+=", "-="].includes(set?.op) ? set.op : "=";
    const names = spec?.list ? value.split(",").map((name) => name.trim()).filter(Boolean) : [value];
    const ok = spec && (op === "=" || spec.list) && (value === "none" ? Boolean(spec.clear)
      : spec.free || names.every((name) => spec.values?.includes(name) || (spec.hex && /^#[0-9a-fA-F]{6}$/.test(name)) || (spec.other && name.length > 0)));
    if (ok) kept.push({ path: set.path, op, value, from: "model" }); else rejected.push({ path: set?.path ?? null, op, value });
  }
  return { kept, rejected };
}

/**
 * Words → {sets, voice, accent, unmatched, personality, via}. With a model
 * (options.client, --model or LAUNCHCLIP_CAST_MODEL) the model chooses the
 * set paths; without one the description is matched on the rig's own words.
 */
export async function mapWords(words, { current = null, model, client, env = process.env } = {}) {
  const spec = text(model) ?? text(env.LAUNCHCLIP_CAST_MODEL);
  const local = describeCharacter(words, { current: current?.params ?? null });
  if (!client && !spec) return { ...local, personality: null, via: "words" };
  let structured = client;
  if (!structured) {
    const { createMakeClient } = await import("./make/models.js");
    structured = createMakeClient(spec).client;
  }
  const input = [current ? `The character now:\n${JSON.stringify(current, null, 2)}\n\nInstruction:` : "Description:", words].join("\n");
  const result = await structured.runStructured({ instructions: modelInstructions(), input: `${input}\n`, schema: MODEL_SCHEMA(), schemaName: "launchclip_character_sets", maxOutputTokens: 2000 });
  const { kept, rejected } = checkedSets(result?.value?.sets);
  const personality = text(result?.value?.personality);
  return { sets: kept, voice: local.voice, accent: local.accent, unmatched: [], rejected, personality: personality && personality.length <= 160 ? personality : null, via: `model ${structured.model ?? spec ?? ""}`.trim() };
}

// ---------------------------------------------------------------------------
// Create and edit

async function baseCharacter(from, options) {
  if (!from) return null;
  const starter = starterCharacter(from);
  if (starter) {
    const { skin: _skin, hair: _hair, ...colors } = starter.params.colors;
    return { style: "flat", voice: starter.voice, params: { ...starter.params, colors } };
  }
  const saved = await loadCharacter(from, options);
  if (!saved) throw new Error(`--from "${from}" is not a starter or a saved character (see launchclip cast list)`);
  const { id: _id, name: _name, schema: _schema, ...rest } = saved.character;
  return rest;
}

/** `cast create <id>`: a new saved character from a description and set paths. */
export async function castCreate(id, flags = {}, hooks = {}) {
  if (!id) throw new Error("cast create needs an id: launchclip cast create <id> --describe \"…\" [--set path=value]");
  if (isStarterId(id)) throw new Error(`"${id}" is a starter character; choose another id (or start from it: launchclip cast create <new-id> --from ${id})`);
  const options = storeOptions(flags, hooks);
  const to = text(flags.to) ?? "project";
  const existing = await loadCharacter(id, { ...options, only: to });
  if (existing && !flags.force) throw new Error(`${existing.file} already exists; change it with launchclip cast edit ${id}, or pass --force to replace it`);
  const base = await baseCharacter(text(flags.from), options);
  const words = text(flags.describe) ?? text(flags.instruction);
  const mapped = words ? await mapWords(words, { model: flags.model, client: hooks.client }) : { sets: [], voice: null, accent: null, unmatched: [], personality: null, via: null };
  const sets = [...mapped.sets, ...shorthandSets(flags), ...flagSets(flags)];
  let draft = applyCharacterSets({ schema: CHARACTER_SCHEMA, id, name: titleCase(id), ...(base ?? {}), params: { ...(base?.params ?? {}) } }, sets);
  if (mapped.personality && !draft.personality) draft.personality = mapped.personality;
  // What nobody said: a skin tone, a hair and a voice chosen by the id, and reported.
  const assumed = [];
  const defaults = newCharacterDefaults(id, { age: draft.params.age });
  if (draft.params.skin === undefined) { draft.params.skin = defaults.skin; assumed.push(`skin=${defaults.skin}`); }
  if (draft.params.hair?.style === undefined) {
    draft.params.hair = { ...defaults.hair, ...(draft.params.hair ?? {}) };
    assumed.push(`hair.style=${draft.params.hair.style}`);
  }
  if (!draft.voice) {
    draft.voice = pickVoice(id, { voice: mapped.voice, accent: mapped.accent });
    assumed.push(`voice=${draft.voice}`);
  }
  const saved = await saveCharacter(normalizeCharacter(draft, id), { ...options, to });
  return finish("create", saved, { flags, options, sets, mapped, assumed, hooks });
}

/** `cast edit <id>`: change a saved character with set paths and a plain instruction. */
export async function castEdit(id, flags = {}, hooks = {}) {
  if (!id) throw new Error("cast edit needs an id: launchclip cast edit <id> --instruction \"…\" [--set path=value]");
  const options = storeOptions(flags, hooks);
  const loaded = await loadCharacter(id, options);
  if (!loaded) throw new Error(isStarterId(id) ? `"${id}" is a starter character and is not edited; copy it first: launchclip cast create <new-id> --from ${id}` : `no saved character "${id}" in ${projectCastRoot(options.projectDir)} or the library (see launchclip cast list)`);
  const words = text(flags.instruction) ?? text(flags.describe);
  const mapped = words ? await mapWords(words, { current: loaded.character, model: flags.model, client: hooks.client }) : { sets: [], voice: null, accent: null, unmatched: [], personality: null, via: null };
  const sets = [...mapped.sets, ...shorthandSets(flags), ...flagSets(flags)];
  if (!sets.length && !mapped.personality) throw new Error(words ? `nothing in ${JSON.stringify(words)} matched a character option; use --set path=value (launchclip cast options lists them)` : "cast edit needs --set path=value or --instruction \"…\"");
  const draft = applyCharacterSets(loaded.character, sets);
  if (mapped.personality) draft.personality = mapped.personality;
  const next = normalizeCharacter(draft, id);
  const changed = JSON.stringify(next) !== JSON.stringify(loaded.character);
  const saved = await saveCharacter(next, { ...options, to: loaded.source, file: loaded.file });
  return finish("edit", saved, { flags, options, sets, mapped, assumed: [], hooks, changed });
}

async function finish(action, saved, { flags, options, sets, mapped, assumed, hooks, changed }) {
  let sheet = null, sheetError = null;
  if (!flags["no-sheet"]) {
    try { sheet = (await characterSheet(saved.character, { ...options, file: saved.file, poses: flags.poses, render: hooks.render })).png; }
    catch (error) { sheetError = error.message; }
  }
  return {
    stage: "cast", action, status: "ready", id: saved.character.id, file: saved.file, source: saved.source,
    ...(changed === undefined ? {} : { changed }),
    character: saved.character,
    applied: sets.map((set) => `${set.path}${set.op ?? "="}${set.value}`),
    ...(mapped.via ? { mapped_by: mapped.via } : {}),
    ...(assumed.length ? { assumed } : {}),
    ...(mapped.unmatched?.length ? { unmatched: mapped.unmatched } : {}),
    ...(mapped.rejected?.length ? { rejected: mapped.rejected } : {}),
    sheet,
    ...(sheetError ? { sheet_error: sheetError } : {}),
    next: sheet ? `Look at ${sheet}; change it with launchclip cast edit ${saved.character.id} --set path=value` : `launchclip cast sheet ${saved.character.id}`
  };
}

// ---------------------------------------------------------------------------
// The sheet of one character

/**
 * Draw a saved character's sheet beside its file: the design poses and every
 * expression, in its own drawing style. A project's storyboard.json lends its
 * brand colours, so clothes that wear a brand role show in them.
 */
export async function characterSheet(character, { projectDir, file, out, poses, render } = {}) {
  const { castSheetHtml, screenshotHtml } = await import("./cast.js");
  const normal = normalizeCharacter(character);
  let brand = null, colors = null;
  const storyFile = projectDir ? path.join(projectDir, "storyboard.json") : null;
  if (storyFile && existsSync(storyFile)) {
    try {
      const { applyProjectStyle } = await import("./story_style.js");
      const story = (await applyProjectStyle(JSON.parse(await readFile(storyFile, "utf8")), { projectDir })).story;
      brand = story.brand ?? null;
      colors = story.cast && !Array.isArray(story.cast) ? story.cast.colors ?? null : null;
    } catch { /* a broken storyboard does not stop a character sheet */ }
  }
  const wanted = text(poses) ? text(poses).split(",").map((pose) => pose.trim()).filter(Boolean) : SHEET_POSES.filter((pose) => POSES.includes(pose));
  for (const pose of wanted) if (!POSES.includes(pose)) throw new Error(`--poses: "${pose}" is not a pose (${POSES.join(", ")})`);
  const story = { ...(brand ? { brand } : {}), cast: { style: normal.style, ...(colors ? { colors } : {}), characters: [characterCastEntry(normal)] } };
  const usage = new Map([[normal.id, { poses: wanted, expressions: [...EXPRESSIONS] }]]);
  const { html, rows } = castSheetHtml(story, usage, { title: `${normal.name}${normal.personality ? `: ${normal.personality}` : ""}` });
  const png = path.resolve(out ?? path.join(path.dirname(file ?? path.join(projectCastRoot(projectDir), "x")), `${normal.id}.sheet.png`));
  await (render ?? screenshotHtml)(html, png);
  return { png, rows, style: normal.style };
}

/**
 * A bible character's reference sheet (docs/ANIMATION_PIPELINE_RFC.md §4.2):
 * every pose the rig has and a face close-up of every expression, drawn in
 * the bible's drawing style and colours with the same view tree the scenes
 * render, so the sheet is the character. entry: a story cast entry with its
 * params (a bible cast entry without the bible's own fields).
 */
export async function referenceSheet(entry, { style, colors = null, brand = null, out, render, chromium } = {}) {
  if (!out) throw new Error("referenceSheet needs out: the PNG to write");
  const { castSheetHtml, screenshotHtml } = await import("./cast.js");
  const story = { ...(brand ? { brand } : {}), cast: { style, ...(colors ? { colors } : {}), characters: [entry] } };
  const usage = new Map([[entry.id, { poses: [...POSES], expressions: [...EXPRESSIONS] }]]);
  const { html, rows } = castSheetHtml(story, usage, { title: `${entry.name ?? entry.id}: reference sheet (${style})` });
  const png = path.resolve(out);
  await mkdir(path.dirname(png), { recursive: true });
  await (render ?? ((page, file) => screenshotHtml(page, file, { chromium })))(html, png);
  return { png, rows, style };
}

/** `cast sheet <id>` for a saved character. */
export async function castCharacterSheet(id, flags = {}, hooks = {}) {
  const options = storeOptions(flags, hooks);
  const loaded = await loadCharacter(id, options);
  if (!loaded) throw new Error(`no saved character "${id}" (see launchclip cast list)`);
  const sheet = await characterSheet(loaded.character, { ...options, file: loaded.file, out: flags.out ? path.resolve(String(flags.out)) : undefined, poses: flags.poses, render: hooks.render });
  return { stage: "cast", action: "sheet", status: "ready", id, source: loaded.source, png: sheet.png, style: sheet.style, characters: sheet.rows.map((row) => ({ id: row.id, poses: row.poses, expressions: row.expressions })) };
}

// ---------------------------------------------------------------------------
// Options, export, import

/** `cast options [path]`: every set path and its values, read from the rig. */
export function castOptions(only) {
  const paths = characterPaths();
  if (only && !paths[only]) throw new Error(`"${only}" is not a character path (paths: ${CHARACTER_PATHS.join(", ")})`);
  const rows = Object.entries(paths).filter(([name]) => !only || name === only).map(([name, spec]) => ({
    path: name,
    ...(spec.values ? { values: spec.values } : {}),
    ...(spec.describe ? { describe: spec.describe } : {}),
    ...(spec.hex ? { hex: true } : {}),
    ...(spec.list ? { list: true } : {}),
    ...(spec.clear ? { clear: "none" } : {})
  }));
  return { stage: "cast", action: "options", status: "ready", paths: rows, poses: [...POSES], expressions: [...EXPRESSIONS], set: "--set path=value (repeat it); accessories+=name adds one, accessories-=name removes one, path=none clears an optional path" };
}

/** `cast export [ids…] --out <folder | pack.json>`: the named saved characters (all of them when none is named). */
export async function castExport(ids, flags = {}, hooks = {}) {
  const out = text(flags.out);
  if (!out) throw new Error("cast export needs --out <folder | pack.json>");
  const options = storeOptions(flags, hooks);
  const wanted = ids.length ? ids : (await listCharacters(options)).filter((row) => !row.shadowed && !row.error).map((row) => row.id);
  if (!wanted.length) throw new Error("there are no saved characters to export (make one with launchclip cast create)");
  const characters = [];
  for (const id of wanted) {
    const loaded = await loadCharacter(id, options);
    if (!loaded) throw new Error(`no saved character "${id}" (see launchclip cast list)`);
    characters.push(loaded.character);
  }
  const pack = await writeCastPack(characters, out, { name: text(flags.name) ?? undefined });
  return { stage: "cast", action: "export", status: "ready", pack: pack.path, kind: pack.kind, name: pack.name, characters: characters.map((character) => character.id), files: pack.files };
}

/** `cast import <pack>`: validate a pack's characters and save them to the project or the library. */
export async function castImport(source, flags = {}, hooks = {}) {
  if (!source) throw new Error("cast import needs a pack: a folder, a pack .json or one character file");
  const options = storeOptions(flags, hooks);
  const to = text(flags.to) ?? "project";
  const pack = await readCastPack(source);
  const only = text(flags.ids) ? text(flags.ids).split(",").map((id) => id.trim()).filter(Boolean) : null;
  const chosen = only ? pack.characters.filter((character) => only.includes(character.id)) : pack.characters;
  for (const id of only ?? []) if (!pack.characters.some((character) => character.id === id)) throw new Error(`the pack has no character "${id}" (${pack.characters.map((character) => character.id).join(", ")})`);
  const clashes = [];
  for (const character of chosen) {
    const existing = await loadCharacter(character.id, { ...options, only: to });
    if (existing && JSON.stringify(existing.character) !== JSON.stringify(character)) clashes.push(character.id);
  }
  if (clashes.length && !flags.force) throw new Error(`${clashes.join(", ")} already exist${clashes.length === 1 ? "s" : ""} in the ${to} with different traits; pass --force to replace, or --ids to import the others`);
  const imported = [];
  for (const character of chosen) imported.push((await saveCharacter(character, { ...options, to })).file);
  return { stage: "cast", action: "import", status: "ready", pack: pack.name, to, characters: chosen.map((character) => character.id), files: imported, next: `launchclip cast sheet ${chosen[0].id}` };
}

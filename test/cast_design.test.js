// Saved characters and `launchclip cast create / edit / options / export /
// import` (kit/core/characters/character.mjs, describe.mjs,
// src/character_store.js, src/cast_design.js).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CAST_PACK_SCHEMA, CHARACTER_PATHS, CHARACTER_SCHEMA, applyCharacterSets, characterCastEntry, characterErrors, characterPaths, normalizeCharacter, parseSet, savedCharacterRequests, withSavedCharacters } from "@launchclip/core/characters/character.mjs";
import { describeCharacter, newCharacterDefaults, pickVoice } from "@launchclip/core/characters/describe.mjs";
import { ACCESSORIES, BOTTOMS, BUILDS, EXPRESSIONS, HAIR_STYLES, HEADWEAR, MOBILITY, TOPS } from "@launchclip/core/characters/rig.mjs";
import { DRAWING_STYLES, KOKORO_VOICES, resolveStoryCast } from "@launchclip/core/characters/cues.mjs";
import { validateStory } from "@launchclip/core/story.mjs";
import { castCharacterSheet, castCreate, castEdit, castExport, castImport, castOptions, mapWords } from "../src/cast_design.js";
import { castGate, castList, castShow, runCastCommand } from "../src/cast.js";
import { applySavedCharacters, homeCastRoot, loadCharacter, projectCastRoot, readCastPack } from "../src/character_store.js";
import { applyProjectStyle } from "../src/story_style.js";
import { parseFlags } from "../src/cli.js";
import { USAGE } from "../src/cli_usage.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const EXAMPLE = path.join(ROOT, "examples/story/characters-16x9");
const example = () => JSON.parse(readFileSync(path.join(EXAMPLE, "storyboard.json"), "utf8"));
const nova = () => ({ schema: CHARACTER_SCHEMA, id: "nova", name: "Nova", personality: "calm under pressure", style: "paper", voice: "bf_emma", params: { build: "slim", height: "tall", skin: "deep", hair: { style: "locs", color: "silver" }, outfit: { top: "blazer" }, accessories: ["round-glasses"], colors: { top: "red" } } });

async function workspace(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-cast-design-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const project = path.join(dir, "project"), home = path.join(dir, "home");
  await mkdir(project, { recursive: true });
  // The sheet is drawn in Chromium; these tests stand in a writer that keeps the HTML.
  const sheets = [];
  const render = async (html, file) => { sheets.push({ html, file }); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, html); };
  return { dir, project, home, hooks: { home, render }, sheets };
}

test("a character file validates with the rig and comes back in canonical form", () => {
  const normal = normalizeCharacter(nova());
  assert.deepEqual(Object.keys(normal), ["schema", "id", "name", "personality", "style", "voice", "params"]);
  assert.deepEqual(normal.params.outfit, { top: "blazer", bottom: "trousers" });
  assert.deepEqual(normal.params.colors, { top: "red", bottom: "charcoal", shoes: "black", accent: "accent" }, "skin and hair stay in their own fields");
  assert.deepEqual(normalizeCharacter(normal), normal, "normalising twice changes nothing");
  assert.deepEqual(characterErrors(normal), []);
  assert.match(characterErrors({ ...nova(), id: "maya" })[0], /starter character/);
  assert.match(characterErrors({ ...nova(), params: { ...nova().params, hair: { style: "mullet" } } })[0], /hair\.style must be one of/);
  assert.match(characterErrors({ ...nova(), style: "oil" })[0], /style must be one of/);
  assert.match(characterErrors({ ...nova(), voice: "af_nobody" })[0], /not a local Kokoro voice/);
  assert.deepEqual(characterErrors({ ...nova(), voice: "elevenlabs:Rachel" }), [], "another provider's voice id is kept as given");
  assert.match(characterErrors({ ...nova(), likeness: "someone" })[0], /likeness is not supported/);
  assert.match(characterErrors({ ...nova(), personality: "a\nb" })[0], /one line/);
  assert.match(characterErrors({ ...nova(), schema: "launchclip.character.v0" })[0], /schema must be/);
  const entry = characterCastEntry(nova());
  assert.equal(entry.id, "nova");
  assert.equal(resolveStoryCast({ cast: { characters: [entry] } }).members.get("nova").voice, "bf_emma", "the entry is a full story cast entry");
});

test("set paths change one option each, and the path list follows the rig", () => {
  assert.deepEqual(parseSet("hair.style=locs"), { path: "hair.style", op: "=", value: "locs" });
  assert.deepEqual(parseSet("accessories+=glasses"), { path: "accessories", op: "+=", value: "glasses" });
  assert.throws(() => parseSet("hair.style"), /path=value/);
  const edited = normalizeCharacter(applyCharacterSets(nova(), [
    parseSet("hair.style=bob"), parseSet("colors.top=#112233"), parseSet("accessories+=glasses"), parseSet("accessories+=beard"),
    parseSet("headwear=beanie"), parseSet("outfit.over=apron"), parseSet("name=Nova Reyes"), parseSet("style=line"), parseSet("personality=none")
  ]));
  assert.equal(edited.params.hair.style, "bob");
  assert.equal(edited.params.hair.color, "silver", "a new style keeps the colour");
  assert.equal(edited.params.colors.top, "#112233");
  assert.deepEqual(edited.params.accessories, ["beard", "glasses"], "new glasses replace the pair worn");
  assert.equal(edited.params.headwear, "beanie");
  assert.equal(edited.name, "Nova Reyes");
  assert.equal(edited.style, "line");
  assert.equal(edited.personality, undefined);
  const cleared = normalizeCharacter(applyCharacterSets(edited, [parseSet("headwear=none"), parseSet("outfit.over=none"), parseSet("accessories-=beard")]));
  assert.equal(cleared.params.headwear, undefined);
  assert.equal(cleared.params.outfit.over, undefined);
  assert.deepEqual(cleared.params.accessories, ["glasses"]);
  assert.throws(() => applyCharacterSets(nova(), [parseSet("hair.length=long")]), /not a character path/);
  assert.throws(() => applyCharacterSets(nova(), [parseSet("build+=slim")]), /only accessories is a list/);
  assert.throws(() => applyCharacterSets(nova(), [parseSet("skin=none")]), /cannot be cleared/);
  // The vocabulary is the rig's and the styles' own lists, not a copy.
  const paths = characterPaths();
  assert.deepEqual(paths["hair.style"].values, [...HAIR_STYLES]);
  assert.deepEqual(paths.style.values, [...DRAWING_STYLES]);
  assert.deepEqual(paths.accessories.values, [...ACCESSORIES]);
  assert.deepEqual(Object.keys(paths), [...CHARACTER_PATHS]);
  const options = castOptions();
  assert.deepEqual(options.expressions, [...EXPRESSIONS]);
  assert.deepEqual(castOptions("build").paths, [{ path: "build", values: [...BUILDS] }]);
  assert.throws(() => castOptions("nose"), /not a character path/);
});

test("a description maps onto the rig's options with no model", () => {
  const sets = (text, current) => describeCharacter(text, { current }).sets.map((set) => `${set.path}${set.op}${set.value}`);
  assert.deepEqual(sets("A tall woman with long silver locs, round glasses, deep skin and a red lab coat over blue jeans, white sneakers."),
    ["height=tall", "hair.style=locs", "hair.color=silver", "accessories+=round-glasses", "skin=deep", "outfit.top=lab-coat", "colors.top=red", "outfit.bottom=trousers", "colors.bottom=denim", "colors.shoes=white"]);
  assert.deepEqual(sets("short black hair, a beard, navy hoodie, 30 years old, wheelchair user"), ["hair.style=short", "hair.color=black", "accessories+=beard", "outfit.top=hoodie", "colors.top=navy", "mobility=wheelchair"]);
  assert.deepEqual(sets("a short man in a t-shirt"), ["height=short", "outfit.top=tee"]);
  assert.deepEqual(sets("swap the hoodie for a mustard blazer, remove the glasses, make her taller and give her a beanie", { height: "tall" }),
    ["outfit.top=blazer", "colors.top=mustard", "accessories-=glasses", "height=very-tall", "headwear=beanie"]);
  assert.deepEqual(sets("a blazer instead of the hoodie, no hat, without the apron"), ["outfit.top=blazer", "headwear=none", "outfit.over=none"]);
  assert.deepEqual(sets("an elderly man with balding grey hair, a cardigan and a walking stick, drawn in paper style"), ["age=senior", "hair.style=balding", "hair.color=grey", "outfit.top=cardigan", "mobility=cane", "style=paper"]);
  assert.deepEqual(sets("younger", { age: "adult" }), ["age=teen"]);
  const described = describeCharacter("a British woman who loves kayaking, green hijab");
  assert.equal(described.voice, "f");
  assert.equal(described.accent, "b");
  assert.deepEqual(described.sets.map((set) => `${set.path}=${set.value}`), ["hair.style=headscarf", "hair.color=forest"]);
  assert.deepEqual(described.unmatched, ["loves", "kayaking"], "words nothing matched are reported, not guessed");
  // A name is not a trait: "Bob" mid-sentence is not the bob haircut.
  assert.deepEqual(sets("Her friend Bob has a quiff"), ["hair.style=quiff"]);
  // Every option of the rig is understood by its own name, so new ones need no table.
  const reads = (path, name, text) => assert.ok(describeCharacter(text).sets.some((set) => set.path === path && set.value === name), `${path} ${name}`);
  for (const name of HAIR_STYLES) reads("hair.style", name, `${name.replaceAll("-", " ")} hair`);
  for (const name of TOPS) reads("outfit.top", name, `wearing a ${name.replaceAll("-", " ")}`);
  for (const name of BOTTOMS) reads("outfit.bottom", name, `wearing a ${name.replaceAll("-", " ")}`);
  for (const name of ACCESSORIES) reads("accessories", name, `with a ${name.replaceAll("-", " ")}`);
  for (const name of HEADWEAR) reads("headwear", name, `in a ${name.replaceAll("-", " ")}`);
  for (const name of MOBILITY) reads("mobility", name, `uses a ${name.replaceAll("-", " ")}`);
  for (const name of BUILDS.filter((build) => build !== "average")) reads("build", name, `a ${name} person`);
  for (const name of DRAWING_STYLES) reads("style", name, `in ${name.replaceAll("-", " ")} style`);
  // Defaults are the same for the same seed and valid for the rig.
  assert.deepEqual(newCharacterDefaults("nova"), newCharacterDefaults("nova"));
  assert.ok(KOKORO_VOICES.includes(pickVoice("nova", { voice: "f", accent: "b" })));
  assert.match(pickVoice("nova", { voice: "m" }), /^[ab]m_/);
});

test("a story uses a saved character by id, and stories without one resolve as before", async (t) => {
  const { project, home } = await workspace(t);
  const find = (id) => (id === "nova" ? nova() : null);
  const story = { ...example(), cast: { characters: [{ id: "maya" }, { id: "nova" }, { id: "lead", from: "nova", voice: "af_sky", colors: { top: "teal" }, hair: { color: "black" } }, { id: "own", skin: "tan", hair: { style: "bob" } }, { id: "ghost" }] } };
  assert.deepEqual(savedCharacterRequests(story), ["nova", "ghost"]);
  const filled = withSavedCharacters(story, find);
  assert.deepEqual(filled.used, [{ id: "nova", from: "nova" }, { id: "lead", from: "nova" }]);
  const [maya, saved, lead, own, ghost] = filled.story.cast.characters;
  assert.deepEqual(maya, { id: "maya" }, "a starter entry is left alone");
  assert.deepEqual(own, story.cast.characters[3], "an entry with its own params is left alone");
  assert.deepEqual(ghost, { id: "ghost" }, "an unknown id is left for validation to name");
  assert.equal(saved.hair.style, "locs");
  assert.equal(saved.voice, "bf_emma");
  assert.deepEqual([lead.id, lead.from, lead.voice, lead.colors.top, lead.hair.color, lead.hair.style, lead.name], ["lead", undefined, "af_sky", "teal", "black", "locs", "Nova"], "the entry's own fields win");
  const resolved = resolveStoryCast({ ...filled.story, cast: { characters: filled.story.cast.characters.slice(0, 4) } });
  assert.equal(resolved.members.get("nova").params.build, "slim");
  // No saved character asked for: the very same story object.
  assert.equal(withSavedCharacters(example(), find).story.cast.characters[0].id, "maya");
  const untouched = example();
  assert.equal(withSavedCharacters(untouched, find).story, untouched);
  assert.equal((await applySavedCharacters(untouched, { projectDir: project, home })).story, untouched);
  assert.equal((await applyProjectStyle(example(), { projectDir: EXAMPLE, home })).characters, undefined);

  // On disk: the project's cast/ folder first, then the library.
  await mkdir(projectCastRoot(project), { recursive: true });
  await mkdir(homeCastRoot({ home }), { recursive: true });
  await writeFile(path.join(homeCastRoot({ home }), "nova.character.json"), JSON.stringify({ ...nova(), name: "Library Nova" }));
  await writeFile(path.join(homeCastRoot({ home }), "rae.character.json"), JSON.stringify({ ...nova(), id: "rae", name: "Rae" }));
  await writeFile(path.join(projectCastRoot(project), "nova.character.json"), JSON.stringify(nova()));
  assert.equal((await loadCharacter("nova", { projectDir: project, home })).source, "project");
  assert.equal((await loadCharacter("nova", { projectDir: project, home, only: "library" })).character.name, "Library Nova");
  assert.equal(await loadCharacter("../nova", { projectDir: project, home }), null);
  const base = { schema: "launchclip.story.v1", lane: "motion", format: { width: 1920, height: 1080, fps: 30, duration: 4 }, brand: example().brand, cast: { style: "flat", characters: [{ id: "nova" }, { id: "rae" }] }, scenes: [{ id: "s1", module: "cast-scene", start: 0, end: 4, params: { set: "phone", cast: [{ id: "nova" }, { id: "rae" }] } }] };
  assert.match(castGate(base).findings.map((finding) => finding.detail).join("\n"), /\(nova\) is not a starter character/, "without the read step the id is unknown");
  const read = await applyProjectStyle(base, { projectDir: project, home });
  assert.deepEqual(read.characters, [{ id: "nova", from: "nova", source: "project" }, { id: "rae", from: "rae", source: "library" }]);
  assert.deepEqual(validateStory(read.story).errors, []);
  assert.equal(castGate(read.story).status, "passed");
  assert.equal((await applyProjectStyle(read.story, { projectDir: project, home })).characters, undefined, "a filled story is not filled twice");
  const list = await castList(null, { project, home });
  assert.deepEqual(list.saved.map((row) => [row.id, row.source, Boolean(row.shadowed)]), [["nova", "project", false], ["nova", "library", true], ["rae", "library", false]]);
  const shown = await castShow("nova", { project, home });
  assert.deepEqual([shown.saved, shown.style, shown.personality, shown.params.hair.style], ["project", "paper", "calm under pressure", "locs"]);
});

test("cast create saves a character from a description and set paths, and cast edit changes it", async (t) => {
  const { project, hooks, sheets } = await workspace(t);
  const made = await castCreate("nova", { project, describe: "A tall woman with silver locs, round glasses and a red blazer. British.", personality: "calm under pressure", set: ["accessories+=earrings", "colors.top=teal"] }, hooks);
  assert.equal(made.file, path.join(project, "cast", "nova.character.json"));
  assert.deepEqual(JSON.parse(readFileSync(made.file, "utf8")), made.character);
  assert.equal(made.character.schema, CHARACTER_SCHEMA);
  assert.equal(made.character.params.hair.style, "locs");
  assert.equal(made.character.params.colors.top, "teal", "--set wins over the description");
  assert.deepEqual(made.character.params.accessories, ["earrings", "round-glasses"]);
  assert.equal(made.character.personality, "calm under pressure");
  assert.match(made.character.voice, /^bf_/, "a British woman's voice");
  assert.equal(made.mapped_by, "words");
  assert.ok(made.assumed.some((entry) => entry.startsWith("skin=")) && made.assumed.some((entry) => entry.startsWith("voice=")), "what nobody said is reported");
  assert.equal(made.sheet, path.join(project, "cast", "nova.sheet.png"));
  for (const expression of EXPRESSIONS) assert.match(sheets[0].html, new RegExp(`<figcaption>${expression}</figcaption>`));
  const again = await castCreate("nova", { project, describe: "A tall woman with silver locs, round glasses and a red blazer. British.", personality: "calm under pressure", set: ["accessories+=earrings", "colors.top=teal"], force: true, "no-sheet": true }, hooks);
  assert.deepEqual(again.character, made.character, "the same words make the same character");
  assert.equal(again.sheet, null);
  await assert.rejects(castCreate("nova", { project, describe: "a man" }, hooks), /already exists; change it with launchclip cast edit nova/);
  await assert.rejects(castCreate("maya", { project }, hooks), /starter character/);
  await assert.rejects(castCreate("zed", { project, set: "hair.style=mullet" }, hooks), /hair\.style must be one of/);
  assert.equal(existsSync(path.join(project, "cast", "zed.character.json")), false, "an invalid character is not saved");

  const edited = await castEdit("nova", { project, instruction: "swap the blazer for a mustard hoodie, remove the earrings, make her shorter", set: "style=paper" }, hooks);
  assert.equal(edited.changed, true);
  assert.deepEqual(edited.applied, ["outfit.top=hoodie", "colors.top=mustard", "accessories-=earrings", "height=average", "style=paper"]);
  assert.deepEqual([edited.character.params.outfit.top, edited.character.params.colors.top, edited.character.params.height, edited.character.style], ["hoodie", "mustard", "average", "paper"]);
  assert.deepEqual(edited.character.params.accessories, ["round-glasses"]);
  assert.equal(edited.character.voice, made.character.voice, "an edit keeps what it does not name");
  assert.equal(sheets.at(-1).file, made.sheet, "the sheet is redrawn in place");
  await assert.rejects(castEdit("nova", { project, set: "build=huge" }, hooks), /build must be one of/);
  assert.equal(JSON.parse(readFileSync(made.file, "utf8")).params.build, "average", "a failed edit leaves the file as it was");
  await assert.rejects(castEdit("nova", { project, instruction: "make it pop" }, hooks), /nothing in "make it pop" matched/);
  await assert.rejects(castEdit("nova", { project }, hooks), /needs --set path=value or --instruction/);
  await assert.rejects(castEdit("theo", { project }, hooks), /starter character and is not edited/);
  await assert.rejects(castEdit("nobody", { project, set: "build=slim" }, hooks), /no saved character "nobody"/);

  // From a starter, into the library.
  const rae = await castCreate("rae", { project, from: "theo", describe: "a beard and a green cardigan", to: "library", name: "Rae" }, hooks);
  assert.equal(rae.source, "library");
  assert.equal(rae.file, path.join(hooks.home, "cast", "rae.character.json"));
  assert.deepEqual([rae.character.params.height, rae.character.params.hair.style, rae.character.params.outfit.top, rae.character.voice], ["tall", "short", "cardigan", "am_michael"]);
  assert.deepEqual(rae.character.params.accessories, ["beard", "glasses"]);
  assert.equal(rae.assumed, undefined);
  const sheet = await castCharacterSheet("rae", { project, poses: "stand,cheer" }, hooks);
  assert.deepEqual(sheet.characters, [{ id: "rae", poses: ["stand", "cheer"], expressions: [...EXPRESSIONS] }]);
  await assert.rejects(castCharacterSheet("rae", { project, poses: "moonwalk" }, hooks), /not a pose/);
});

test("a model, when asked for, chooses set paths that pass the same validation", async (t) => {
  const { project, hooks } = await workspace(t);
  const calls = [];
  const client = { model: "test-model", async runStructured(request) {
    calls.push(request);
    return { value: { personality: "dry wit", sets: [{ path: "hair.style", op: "=", value: "afro" }, { path: "hair.style", op: "=", value: "mullet" }, { path: "accessories", op: "+=", value: "scarf" }, { path: "nose", op: "=", value: "big" }, { path: "colors.top", op: "=", value: "#aa3355" }, { path: "headwear", op: "=", value: "none" }] } };
  } };
  const mapped = await mapWords("an afro and a scarf", { client });
  assert.deepEqual(mapped.sets.map((set) => `${set.path}${set.op}${set.value}`), ["hair.style=afro", "accessories+=scarf", "colors.top=#aa3355", "headwear=none"]);
  assert.deepEqual(mapped.rejected.map((set) => set.path), ["hair.style", "nose"], "an option the rig lacks is refused, not saved");
  assert.equal(mapped.via, "model test-model");
  assert.equal(calls[0].schemaName, "launchclip_character_sets");
  for (const style of HAIR_STYLES) assert.ok(calls[0].instructions.includes(style), "the model is told the rig's own options");
  assert.match(calls[0].instructions, /do not try to reproduce their likeness/);
  const made = await castCreate("kit", { project, describe: "an afro and a scarf" }, { ...hooks, client });
  assert.deepEqual([made.character.params.hair.style, made.character.personality, made.mapped_by], ["afro", "dry wit", "model test-model"]);
  assert.equal((await mapWords("an afro", { env: {} })).via, "words", "no model is called unless one is named");
});

test("cast export and import share characters as a pack", async (t) => {
  const { dir, project, hooks } = await workspace(t);
  await castCreate("nova", { project, describe: "silver locs, red blazer", "no-sheet": true }, hooks);
  await castCreate("rae", { project, from: "theo", "no-sheet": true }, hooks);
  const folder = await castExport([], { project, out: path.join(dir, "pack"), name: "Night shift" }, hooks);
  assert.deepEqual([folder.kind, folder.characters], ["folder", ["nova", "rae"]]);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "pack", "cast-pack.json"), "utf8")), { schema: CAST_PACK_SCHEMA, name: "Night shift", characters: ["nova", "rae"] });
  const single = await castExport(["nova"], { project, out: path.join(dir, "nova.cast-pack.json") }, hooks);
  assert.deepEqual([single.kind, single.characters], ["file", ["nova"]]);
  await assert.rejects(castExport(["ghost"], { project, out: path.join(dir, "x") }, hooks), /no saved character "ghost"/);
  await assert.rejects(castExport([], { project }, hooks), /needs --out/);

  const other = path.join(dir, "other");
  const imported = await castImport(path.join(dir, "pack"), { project: other }, hooks);
  assert.deepEqual(imported.characters, ["nova", "rae"]);
  for (const id of ["nova", "rae"]) assert.equal(readFileSync(path.join(other, "cast", `${id}.character.json`), "utf8"), readFileSync(path.join(project, "cast", `${id}.character.json`), "utf8"), `${id} round-trips byte for byte`);
  assert.deepEqual((await castImport(path.join(dir, "pack"), { project: other }, hooks)).characters, ["nova", "rae"], "importing the same pack again is fine");
  await castEdit("nova", { project: other, set: "build=round", "no-sheet": true }, hooks);
  await assert.rejects(castImport(path.join(dir, "nova.cast-pack.json"), { project: other }, hooks), /nova already exists in the project with different traits; pass --force/);
  assert.deepEqual((await castImport(path.join(dir, "nova.cast-pack.json"), { project: other, force: true }, hooks)).characters, ["nova"]);
  const library = await castImport(path.join(dir, "pack", "cast-pack.json"), { project: other, to: "library", ids: "rae" }, hooks);
  assert.deepEqual(library.files, [path.join(hooks.home, "cast", "rae.character.json")]);
  assert.deepEqual((await castImport(path.join(project, "cast", "nova.character.json"), { project: path.join(dir, "third") }, hooks)).characters, ["nova"], "one character file imports too");
  await assert.rejects(castImport(path.join(dir, "pack"), { project: other, ids: "zed" }, hooks), /the pack has no character "zed"/);

  // A pack is data: every character is validated, and nothing unknown gets in.
  const bad = path.join(dir, "bad.json");
  await writeFile(bad, JSON.stringify({ schema: CAST_PACK_SCHEMA, name: "bad", characters: [{ ...nova(), id: "../../x" }] }));
  await assert.rejects(readCastPack(bad), /characters\[0\]\.id must be a lowercase id/);
  await writeFile(bad, JSON.stringify({ schema: CAST_PACK_SCHEMA, name: "bad", characters: [{ ...nova(), script: "run me" }] }));
  await assert.rejects(castImport(bad, { project: other }, hooks), /script is not supported/);
  await writeFile(path.join(dir, "pack", "cast-pack.json"), JSON.stringify({ schema: CAST_PACK_SCHEMA, name: "x", characters: ["../nova"] }));
  await assert.rejects(readCastPack(path.join(dir, "pack")), /is not a character id/);
});

test("the CLI knows the design actions and repeats --set", async () => {
  for (const action of ["create", "edit", "options", "export", "import"]) assert.ok(USAGE.some(([name]) => name === `cast ${action}`), action);
  assert.deepEqual(parseFlags(["--set", "hair.style=locs", "--set", "accessories-=beard", "--no-sheet"]), { set: ["hair.style=locs", "accessories-=beard"], "no-sheet": true });
  assert.deepEqual((await runCastCommand("options", "headwear")).paths[0].values, [...HEADWEAR]);
  await assert.rejects(runCastCommand("dance"), /use list, show, sheet, create, edit, options, export, import or sprites/);
});

test("cast create draws the sheet as a PNG with Chromium", { timeout: 120_000 }, async (t) => {
  const { findChromium, loadPlaywright } = await import("../src/demo/record.js");
  if (!(await loadPlaywright()) || !(await findChromium())) { t.skip("no Chromium for Playwright"); return; }
  const { project, home } = await workspace(t);
  const made = await castCreate("nova", { project, describe: "silver locs, round glasses, a red blazer", style: "avatar" }, { home });
  assert.equal(made.sheet_error, undefined);
  assert.ok(readFileSync(made.sheet).length > 20_000);
  const again = await runCastCommand("sheet", "nova", { project, out: path.join(project, "qa", "nova.png") });
  assert.ok(existsSync(again.png));
});

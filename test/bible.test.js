// The show bible (docs/ANIMATION_PIPELINE_RFC.md §4.2): the contract
// (kit/core/bible.mjs), `launchclip bible freeze | show` and the finish gate
// (src/bible.js), and the `bible` key on the story and the direction map.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BIBLE_CHARACTER_FIELDS, BIBLE_FILE, BIBLE_SCHEMA, bibleCast, bibleCastFindings, bibleHash, bibleRefErrors, mustKeep, validateBible, withBible } from "@launchclip/core/bible.mjs";
import { CHARACTER_SCHEMA } from "@launchclip/core/characters/character.mjs";
import { DRAWING_STYLES, resolveStoryCast, storyCastErrors } from "@launchclip/core/characters/cues.mjs";
import { EXPRESSIONS, POSES, normalizeRigParams } from "@launchclip/core/characters/rig.mjs";
import { DIRECTION_SCHEMA, validateDirection } from "@launchclip/core/direction.mjs";
import { STORY_REVISION, validateStory } from "@launchclip/core/story.mjs";
import { migrateStory, migrationProblems } from "@launchclip/core/story-migrations.mjs";
import { bibleGate, freezeBible, runBibleCommand, showBible } from "../src/bible.js";
import { saveCharacter } from "../src/character_store.js";
import { parseFlags, runCli } from "../src/cli.js";
import { USAGE, commandHelp } from "../src/cli_usage.js";
import { runFinish } from "../src/finish.js";
import { applyProjectStyle } from "../src/story_style.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MINIMAL = path.join(ROOT, "examples/story/minimal");
const STYLE = DRAWING_STYLES.includes("outlined") ? "outlined" : DRAWING_STYLES[0];
const nova = () => ({ schema: CHARACTER_SCHEMA, id: "nova", name: "Nova", style: STYLE, voice: "bf_emma", params: { build: "slim", height: "tall", skin: "deep", hair: { style: "locs", color: "silver" }, outfit: { top: "blazer" }, accessories: ["round-glasses"], colors: { top: "red" } } });
const rae = () => ({ schema: CHARACTER_SCHEMA, id: "rae", name: "Rae", style: STYLE, voice: "am_adam", params: { height: "short", skin: "medium", hair: { style: "headscarf", color: "plum" }, outfit: { top: "hoodie" }, mobility: "wheelchair", colors: { top: "forest" } } });
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const write = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

// A project with two saved characters. The sheets are drawn in Chromium;
// these tests stand in a writer that keeps the HTML.
async function workspace(t, { characters = [nova(), rae()] } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-bible-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const project = path.join(dir, "project"), home = path.join(dir, "home");
  await mkdir(project, { recursive: true });
  for (const character of characters) await saveCharacter(character, { projectDir: project, home });
  const sheets = [];
  const render = async (html, file) => { sheets.push({ html, file }); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, html); };
  return { dir, project, home, hooks: { home, render }, sheets };
}

const story = (extra = {}) => ({
  schema: "launchclip.story.v1", lane: "motion",
  format: { width: 1920, height: 1080, fps: 30, duration: 6 },
  brand: { colors: { bg: "#14122b", primary: "#6d5dfc", accent: "#ffb547", ink: "#14122b", paper: "#f6f3ee" }, fonts: { display: "anton" } },
  scenes: [{ id: "s1", module: "hook-title", start: 0, end: 6, params: { headline: "Ship faster" } }],
  ...extra
});
const applied = async (project) => (await applyProjectStyle(json(path.join(project, "storyboard.json")), { projectDir: project })).story;

test("must_keep reads what a viewer would notice from the rig params", () => {
  const params = (extra) => normalizeRigParams({ skin: "brown", hair: { style: "curly", color: "espresso" }, outfit: { top: "hoodie" }, colors: { top: "teal" }, ...extra });
  assert.deepEqual(mustKeep(params({ accessories: ["round-glasses", "earrings", "freckles"] })), ["espresso curly hair", "brown skin", "teal hoodie", "charcoal trousers", "round glasses"], "jewellery and freckles are left to the sheet");
  assert.deepEqual(mustKeep(params({ hair: { style: "headscarf", color: "plum" } })).slice(0, 2), ["plum headscarf", "brown skin"], "a headscarf is kept as a headscarf");
  const more = mustKeep(params({ hair: { style: "bald" }, outfit: { top: "dress", over: "apron" }, accessories: ["beard", "hearing-aid", "stubble"], headwear: "turban", mobility: "white-cane", age: "senior", colors: { top: "primary" } }));
  assert.deepEqual(more, ["bald head", "brown skin", "dress in the brand's primary colour", "apron", "beard", "hearing aid", "turban", "white cane", "a senior"]);
  assert.deepEqual(mustKeep(null), []);
});

test("freezing a bible from two saved characters writes sheets and a hash", async (t) => {
  const { project, hooks, sheets } = await workspace(t);
  const result = await freezeBible(project, { characters: "nova,rae", position: ["nova=left", "rae=right"], world: "office", time: "day", sets: "desk-laptop,standing", rule: "Rae never raises his voice." }, hooks);
  assert.equal(result.status, "ready");
  assert.equal(result.frozen, true);
  assert.equal(result.changed, true);
  assert.match(result.hash, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(result.pinned, [], "no storyboard to pin");

  const bible = json(path.join(project, BIBLE_FILE));
  assert.deepEqual(Object.keys(bible), ["schema", "frozen", "hash", "cast", "world", "style", "rules"]);
  assert.equal(bible.schema, BIBLE_SCHEMA);
  assert.equal(bible.hash, result.hash);
  assert.equal(bible.hash, bibleHash(bible), "the hash is of the content");
  assert.equal(bible.cast.style, STYLE, "the style the characters were designed in");
  assert.deepEqual(bible.style, { drawing_style: STYLE });
  assert.deepEqual(bible.world, { kind: "office", time: "day", sets: ["desk-laptop", "standing"] });
  const [first, second] = bible.cast.characters;
  assert.deepEqual([first.id, first.voice, first.position, first.character_file, first.sheet], ["nova", "bf_emma", "left", "cast/nova.character.json", "bible/sheets/nova.png"]);
  assert.deepEqual(first.must_keep, ["silver locs hair", "deep skin", "red blazer", "charcoal trousers", "round glasses"]);
  assert.deepEqual(second.must_keep, ["plum headscarf", "medium skin", "forest hoodie", "charcoal trousers", "wheelchair"]);
  assert.match(first.fingerprint, /^[0-9a-f]{16}$/);
  assert.notEqual(first.fingerprint, second.fingerprint);
  // The cast is the story.cast shape: without the four bible fields it is a valid story cast.
  assert.deepEqual(storyCastErrors(bibleCast(bible)), []);
  for (const key of BIBLE_CHARACTER_FIELDS) assert.equal(bibleCast(bible).characters[0][key], undefined);
  assert.equal(resolveStoryCast({ cast: bibleCast(bible) }).members.get("rae").params.mobility, "wheelchair");

  // A sheet per character: every pose and a face close-up of every expression.
  assert.deepEqual(sheets.map((sheet) => path.relative(project, sheet.file)), ["bible/sheets/nova.png", "bible/sheets/rae.png"]);
  for (const pose of POSES) assert.ok(sheets[0].html.includes(`<figcaption>${pose}</figcaption>`), `the sheet shows ${pose}`);
  for (const expression of EXPRESSIONS) assert.ok(sheets[0].html.includes(`<figcaption>${expression}</figcaption>`), `the sheet shows ${expression}`);
  assert.equal((sheets[0].html.match(/class="face"/g) ?? []).length, EXPRESSIONS.length);
  assert.match(sheets[0].html, new RegExp(`reference sheet \\(${STYLE}\\)`));

  const shown = await showBible(project);
  assert.equal(shown.valid, true);
  assert.deepEqual(shown.errors, []);
  assert.deepEqual(shown.characters.map((row) => row.id), ["nova", "rae"]);
  assert.equal(shown.story, undefined);
});

test("frozen means pinned: the same bible freezes again, a changed one needs --force", async (t) => {
  const { project, hooks, home } = await workspace(t);
  const first = await freezeBible(project, {}, hooks);
  assert.deepEqual(first.characters.map((row) => row.id), ["nova", "rae"], "with nothing named, every character saved in the project");
  const again = await freezeBible(project, {}, hooks);
  assert.equal(again.changed, false);
  assert.equal(again.hash, first.hash);
  // Editing the saved character does not move a frozen bible by itself…
  await saveCharacter({ ...nova(), params: { ...nova().params, hair: { style: "bob", color: "silver" } } }, { projectDir: project, home });
  assert.equal((await freezeBible(project, {}, hooks)).hash, first.hash, "entries kept from the bible are not read from their files again");
  // …naming the characters reads the files as they are, which changes the bible.
  await assert.rejects(freezeBible(project, { characters: "nova,rae" }, hooks), /is frozen \([0-9a-f]{12}\) and this would change its cast.*--force/s);
  await assert.rejects(freezeBible(project, { style: DRAWING_STYLES.find((name) => name !== STYLE) }, hooks), /would change its cast, style/);
  const forced = await freezeBible(project, { characters: "nova,rae", force: true }, hooks);
  assert.notEqual(forced.hash, first.hash);
  assert.ok(forced.characters[0].must_keep.includes("silver bob hair"));
});

test("a bible is frozen from starters, the library and a storyboard's cast", async (t) => {
  const { project, hooks, home } = await workspace(t, { characters: [] });
  await saveCharacter(nova(), { projectDir: project, home, to: "library" });
  await write(path.join(project, "storyboard.json"), story({ cast: { style: "flat", characters: [{ id: "maya", position: "left" }, { id: "nova" }] } }));
  await write(path.join(project, "DIRECTION.json"), { schema: DIRECTION_SCHEMA, sections: [] });
  const result = await freezeBible(project, {}, hooks);
  assert.deepEqual(result.characters.map((row) => [row.id, row.voice, row.character_file]), [["maya", "af_heart", null], ["nova", "bf_emma", "cast/nova.character.json"]], "a starter speaks in its own voice and has no file");
  assert.deepEqual(result.copied, ["cast/nova.character.json"], "a library character is copied into the project");
  assert.ok(existsSync(path.join(project, "cast/nova.character.json")));
  assert.equal(result.style, "flat", "the storyboard's drawing style");
  assert.deepEqual(result.pinned, ["storyboard.json", "DIRECTION.json"]);
  const pinned = json(path.join(project, "storyboard.json"));
  assert.deepEqual(pinned.bible, { file: BIBLE_FILE, hash: result.hash });
  assert.deepEqual(pinned.cast, bibleCast(json(path.join(project, BIBLE_FILE))), "the story's cast is copied from the bible");
  assert.deepEqual(json(path.join(project, "DIRECTION.json")).bible, { file: BIBLE_FILE, hash: result.hash });
  assert.equal(validateStory(pinned).ok, true, validateStory(pinned).errors.join("; "));
  assert.equal((await bibleGate(project, await applied(project), { direction: json(path.join(project, "DIRECTION.json")) })).status, "passed");
  assert.equal((await showBible(project)).story.gate, "passed");

  await assert.rejects(freezeBible(project, { characters: "nobody", force: true }, hooks), /"nobody" is not a saved character or a starter/);
  await assert.rejects(freezeBible(project, { position: "ghost=left" }, hooks), /"ghost" is not in the cast/);
  await assert.rejects(freezeBible(project, { world: "moon", force: true }, hooks), /world\.kind must be one of/);
  const empty = await workspace(t, { characters: [] });
  await assert.rejects(freezeBible(empty.project, {}, empty.hooks), /no characters to freeze/);
  // --no-pin leaves the storyboard alone.
  const loose = await workspace(t);
  await write(path.join(loose.project, "storyboard.json"), story());
  assert.deepEqual((await runBibleCommand("freeze", loose.project, parseFlags(["--no-pin"]), loose.hooks)).pinned, []);
  assert.equal(json(path.join(loose.project, "storyboard.json")).bible, undefined);
});

test("a character with no voice, or a sheet that cannot be drawn, stops the freeze before anything is written", async (t) => {
  const { voice: _voice, ...mute } = rae();
  const { project, hooks } = await workspace(t, { characters: [nova(), mute] });
  await assert.rejects(freezeBible(project, {}, hooks), /rae has no voice; give it one: launchclip cast edit rae --voice/);
  const failing = await workspace(t);
  await assert.rejects(freezeBible(failing.project, {}, { ...failing.hooks, render: async () => { throw new Error("no Chromium found"); } }), /could not draw nova's reference sheet: no Chromium found[\s\S]*--chromium <path> or LAUNCHCLIP_CHROMIUM[\s\S]*was not written/);
  assert.equal(existsSync(path.join(failing.project, BIBLE_FILE)), false);
});

test("validateBible checks the cast, the script's characters, the sheets, the world and the hash", async (t) => {
  const { project, hooks } = await workspace(t);
  await freezeBible(project, { world: "office", sets: "desk-laptop" }, hooks);
  const bible = json(path.join(project, BIBLE_FILE));
  const exists = (relative) => existsSync(path.join(project, relative));
  const rehash = (changed) => ({ ...changed, hash: bibleHash(changed) });
  const errors = (changed, options = { exists }) => validateBible(changed, options).errors.join("\n");
  assert.deepEqual(validateBible(bible, { exists }), { ok: true, errors: [], warnings: [] });

  assert.match(errors({ ...bible, rules: ["Nova never runs."] }), /hash does not match the bible's content/);
  assert.match(errors({ ...bible, hash: undefined }), /a frozen bible needs its hash/);
  assert.match(errors(bible, { exists: (relative) => !relative.endsWith("rae.png") }), /cast\.characters\[1\]\.sheet bible\/sheets\/rae\.png does not exist/);
  assert.match(errors(bible, { exists: (relative) => !relative.endsWith(".character.json") }), /character_file cast\/nova\.character\.json does not exist/);
  assert.match(errors(bible, { exists, script: { characters: [{ id: "nova" }, { id: "sam" }] } }), /the script's character "sam" has no entry/);
  assert.equal(validateBible(bible, { exists, script: { characters: [{ id: "nova" }, { id: "rae" }, { id: "narrator" }] } }).ok, true);

  const edit = (index, change) => rehash({ ...bible, cast: { ...bible.cast, characters: bible.cast.characters.map((entry, i) => (i === index ? change(entry) : entry)) } });
  // The rig params are what the fingerprint and must_keep are made from.
  assert.match(errors(edit(0, (entry) => ({ ...entry, skin: "porcelain" }))), /fingerprint does not match nova's rig params[\s\S]*must_keep leaves out "porcelain skin"/);
  assert.match(errors(edit(1, (entry) => ({ ...entry, must_keep: entry.must_keep.filter((feature) => feature !== "plum headscarf") }))), /must_keep leaves out "plum headscarf"; it may add features but not drop/);
  assert.equal(validateBible(edit(0, (entry) => ({ ...entry, must_keep: [...entry.must_keep, "a red scarf, always"] })), { exists }).ok, true, "must_keep may add features");
  assert.match(errors(edit(0, ({ voice: _voice, ...entry }) => entry)), /\(nova\) needs a voice/);
  assert.match(errors(edit(0, ({ sheet: _sheet, ...entry }) => entry)), /\(nova\) needs its reference sheet/);
  assert.match(errors(edit(0, (entry) => ({ ...entry, sheet: "../nova.png" }))), /sheet must be a path inside the project/);
  assert.match(errors(edit(0, (entry) => ({ ...entry, voice: "af_nobody" }))), /not a local Kokoro voice/);
  assert.match(errors(edit(0, (entry) => ({ ...entry, hair: { style: "mullet" } }))), /hair\.style must be one of/);
  assert.match(errors(rehash({ ...bible, cast: { ...bible.cast, characters: [...bible.cast.characters, { id: "lou", voice: "af_sky", art: "assets/cast/lou" }] } })), /lou\) is an illustrated character \(art\); a bible character needs rig params/);
  assert.deepEqual(validateBible(edit(1, (entry) => ({ ...entry, voice: "bf_emma" })), { exists }).warnings, ["rae and nova share the voice bf_emma; give each speaking character its own"]);

  assert.match(errors(rehash({ ...bible, world: { kind: "moon" } })), /world\.kind must be one of/);
  assert.match(errors(rehash({ ...bible, world: { kind: "office", sets: ["bridge"] } })), /"bridge" is not a set/);
  assert.match(errors(rehash({ ...bible, style: { drawing_style: DRAWING_STYLES.find((name) => name !== STYLE) } })), /must be the cast's style/);
  assert.match(errors(rehash({ ...bible, style: { palette: "x" } })), /style\.palette is not supported/);
  assert.match(errors(rehash({ ...bible, likeness: "someone" })), /unknown field "likeness"/);
  assert.match(errors(rehash({ ...bible, inputs: { story_hash: "x" } })), /inputs\.story_hash is not supported/);
  assert.match(errors({ ...bible, schema: "launchclip.show-bible.v0" }), /schema must be/);

  // A draft needs no hash, sheets or fingerprints, and carries no hash.
  const draft = { schema: BIBLE_SCHEMA, frozen: false, cast: { style: STYLE, characters: [{ id: "maya" }, { id: "theo" }] }, world: { kind: "office" } };
  assert.deepEqual(validateBible(draft), { ok: true, errors: [], warnings: [] });
  assert.match(errors({ ...draft, hash: bible.hash }, {}), /a draft bible \(frozen: false\) carries no hash/);
  assert.match(errors({ ...draft, cast: { characters: [] } }, {}), /at least one character/);
  assert.throws(() => withBible(story(), draft), /freeze it first/);
});

test("a story whose cast differs from its bible fails the gate", async (t) => {
  const { project, hooks, home } = await workspace(t);
  await write(path.join(project, "storyboard.json"), story({ cast: { characters: [{ id: "nova" }, { id: "rae" }] } }));
  const frozen = await freezeBible(project, { position: "nova=left" }, hooks);
  const bible = json(path.join(project, BIBLE_FILE));
  const pinned = json(path.join(project, "storyboard.json"));
  const gate = async (changed, options) => { await write(path.join(project, "storyboard.json"), changed); return bibleGate(project, await applied(project), options); };
  const details = (result) => result.findings.map((finding) => finding.detail).join("\n");

  const passed = await gate(pinned);
  assert.deepEqual(passed, { status: "passed", file: BIBLE_FILE, hash: frozen.hash, characters: ["nova", "rae"], findings: [] });
  assert.deepEqual(bibleCastFindings(pinned, bible), []);
  // A cast that names the saved characters by id is the same cast while their files are unchanged.
  assert.equal((await gate({ ...pinned, cast: { style: STYLE, characters: [{ id: "nova", position: "left" }, { id: "rae" }] } })).status, "passed");

  const cast = (change) => ({ ...pinned, cast: { ...pinned.cast, characters: change(pinned.cast.characters) } });
  let failed = await gate(cast((list) => list.map((entry) => (entry.id === "nova" ? { ...entry, hair: { style: "bob", color: "silver" }, accessories: [] } : entry))));
  assert.equal(failed.status, "failed");
  assert.equal(details(failed), "nova's hair, accessories in story.cast differ from the bible");
  failed = await gate(cast((list) => list.map((entry) => (entry.id === "rae" ? { ...entry, voice: "am_puck", position: "left" } : entry))));
  assert.match(details(failed), /rae's voice is am_puck in story\.cast; the bible's is am_adam\nrae's position is left in story\.cast; the bible's is not set/);
  assert.match(details(await gate(cast((list) => list.slice(0, 1)))), /rae is in the bible but not in story\.cast/);
  assert.match(details(await gate(cast((list) => [...list, { id: "maya" }]))), /maya is in story\.cast but not in the bible/);
  assert.match(details(await gate({ ...pinned, cast: { ...pinned.cast, style: DRAWING_STYLES.find((name) => name !== STYLE) } })), /story\.cast\.style is \S+; the bible's is/);
  assert.match(details(await gate({ ...pinned, cast: { ...pinned.cast, colors: { primary: "teal" } } })), /story\.cast\.colors differs/);
  const { cast: _cast, ...castless } = pinned;
  assert.match(details(await gate(castless)), /the story has no cast; the bible's is nova, rae/);

  // The story must name the frozen bible, by the hash it has now.
  const { bible: _bible, ...unnamed } = pinned;
  failed = await gate(unnamed);
  assert.equal(failed.status, "failed", "dropping the bible key is not a way around the pin");
  assert.match(details(failed), /storyboard\.json does not name the project's frozen bible/);
  assert.match(details(await gate({ ...pinned, bible: { file: BIBLE_FILE, hash: `sha256:${"0".repeat(64)}` } })), /was planned against bible 000000000000; the frozen bible is [0-9a-f]{12}/);
  assert.match(details(await gate({ ...pinned, bible: { file: "OTHER.json", hash: frozen.hash } })), /names the show bible OTHER\.json, which does not exist/);
  assert.match(details(await gate(pinned, { direction: { bible: { file: BIBLE_FILE, hash: `sha256:${"1".repeat(64)}` } } })), /DIRECTION\.json was planned against bible 111111111111/);
  assert.equal((await gate(pinned, { direction: { bible: { file: BIBLE_FILE, hash: frozen.hash } } })).status, "passed");

  // A saved character edited after the freeze no longer matches a cast that names it by id.
  await saveCharacter({ ...nova(), params: { ...nova().params, skin: "porcelain" } }, { projectDir: project, home });
  assert.match(details(await gate({ ...pinned, cast: { style: STYLE, characters: [{ id: "nova", position: "left" }, { id: "rae" }] } })), /nova's skin, colors in story\.cast differ from the bible/);

  // A missing sheet and a changed bible fail it too.
  await gate(pinned);
  await rm(path.join(project, "bible/sheets/rae.png"));
  failed = await bibleGate(project, await applied(project));
  assert.match(details(failed), /BIBLE\.json: cast\.characters\[1\]\.sheet bible\/sheets\/rae\.png does not exist/);
  assert.equal((await showBible(project)).valid, false);
  await freezeBible(project, {}, hooks);
  assert.equal((await bibleGate(project, await applied(project))).status, "passed", "freezing again redraws the sheet");
  await write(path.join(project, BIBLE_FILE), { ...bible, rules: ["Nova never runs."] });
  assert.match(details(await bibleGate(project, await applied(project))), /hash does not match the bible's content/);
  await write(path.join(project, BIBLE_FILE), { ...bible, frozen: false, hash: undefined });
  assert.match(details(await bibleGate(project, await applied(project))), /BIBLE\.json is a draft; freeze it/);
});

test("a story with no bible still validates, and the gate is skipped", async (t) => {
  const { project } = await workspace(t);
  const plain = story({ cast: { characters: [{ id: "maya" }] } });
  assert.deepEqual(validateStory(plain).errors, []);
  assert.deepEqual(await bibleGate(project, plain), { status: "skipped", reason: "this story names no show bible", findings: [] });
  // A draft bible nobody froze does not gate a story that does not name it.
  await write(path.join(project, BIBLE_FILE), { schema: BIBLE_SCHEMA, frozen: false, cast: { style: "flat", characters: [{ id: "maya" }] } });
  assert.equal((await bibleGate(project, plain)).status, "skipped");
  // The bible key is additive: the story revision is unchanged, so no story needs a migration.
  assert.equal(STORY_REVISION, 0);
  assert.deepEqual(migrationProblems(), []);
  for (const stamped of [plain, { ...plain, engine: { version: "0.2.0", revision: 0 } }]) {
    assert.deepEqual(migrateStory(stamped).applied, []);
    assert.deepEqual(validateStory(stamped).errors, []);
  }
  for (const example of ["characters-16x9", "minimal"]) {
    const result = validateStory(json(path.join(ROOT, "examples/story", example, "storyboard.json")));
    assert.deepEqual(result.errors, [], example);
    assert.equal(result.warnings.some((warning) => /bible/.test(warning)), false);
  }
});

test("the story and the direction map take bible: {file, hash} and check its shape", () => {
  const hash = `sha256:${"a".repeat(64)}`;
  const named = validateStory(story({ bible: { file: BIBLE_FILE, hash } }));
  assert.deepEqual(named.errors, []);
  assert.equal(named.warnings.some((warning) => /bible/.test(warning)), false, "bible is a story field");
  assert.match(validateStory(story({ bible: "BIBLE.json" })).errors.join(), /bible must be \{file, hash\}/);
  assert.match(validateStory(story({ bible: { file: "../BIBLE.json", hash } })).errors.join(), /bible\.file must be the bible's path inside the project/);
  assert.match(validateStory(story({ bible: { file: BIBLE_FILE, hash: "abc" } })).errors.join(), /bible\.hash must be the frozen bible's hash/);
  assert.match(validateStory(story({ bible: { file: BIBLE_FILE, hash, frozen: true } })).errors.join(), /bible\.frozen is not supported/);
  assert.deepEqual(bibleRefErrors({ file: "bible/BIBLE.json", hash }), []);

  const words = [{ text: "Hello", start: 0, end: 0.4 }, { text: "there.", start: 0.4, end: 0.9 }];
  const map = (extra) => ({ schema: DIRECTION_SCHEMA, sections: [{ id: "a", lines: [{ words: [0, 1], intent: "hook", treatment: "dress", scenes: ["s1"], why: "the opening line" }] }], ...extra });
  const base = validateDirection(map(), { words, deferScenes: true, lane: "motion" });
  const withRef = validateDirection(map({ bible: { file: BIBLE_FILE, hash } }), { words, deferScenes: true, lane: "motion" });
  assert.deepEqual(withRef.errors, base.errors, "a bible reference adds no error");
  assert.equal(withRef.errors.some((message) => /unknown field/.test(message)), false);
  assert.match(validateDirection(map({ bible: { file: BIBLE_FILE } }), { words, deferScenes: true, lane: "motion" }).errors.join(), /bible\.hash must be the frozen bible's hash/);
  assert.match(validateDirection(map({ bibel: {} }), { words, deferScenes: true, lane: "motion" }).errors.join(), /unknown field "bibel"/);
});

test("finish runs the bible gate in validate, and stops there when the story and its bible disagree", async (t) => {
  const { project, hooks } = await workspace(t);
  await cp(MINIMAL, project, { recursive: true });
  const minimal = json(path.join(project, "storyboard.json"));
  await write(path.join(project, "storyboard.json"), minimal);
  await freezeBible(project, {}, hooks);
  const pinned = json(path.join(project, "storyboard.json"));
  assert.deepEqual(pinned.cast.characters.map((entry) => entry.id), ["nova", "rae"]);
  // Pinned, the story passes validate with the gate recorded (the stand-in renderer stops the run after it).
  const stop = { env: {}, notice() {}, renderer: () => ({ name: "remotion", async render() { throw new Error("stop here"); } }) };
  const through = await runFinish(project, { renderer: "remotion" }, stop);
  const validated = through.stages.find((stage) => stage.name === "validate");
  assert.equal(validated.status, "done", validated.error);
  assert.equal(validated.details.bible.status, "passed");
  await write(path.join(project, "storyboard.json"), { ...pinned, cast: { ...pinned.cast, characters: pinned.cast.characters.map((entry) => (entry.id === "rae" ? { ...entry, mobility: undefined } : entry)) } });
  const report = await runFinish(project, { renderer: "remotion" }, { env: {}, notice() {} });
  assert.equal(report.status, "failed");
  const failed = report.stages.find((stage) => stage.status === "failed");
  assert.equal(failed.name, "validate");
  assert.match(failed.error, /bible check failed:\n- rae's mobility in story\.cast differs from the bible/);
});

test("the CLI runs bible freeze and show, and lists them in the usage", async (t) => {
  const { project, home } = await workspace(t);
  const run = async (args) => {
    let out = "";
    const io = { stdout: { write: (chunk) => { out += chunk; } }, stderr: { write() {} }, productionAdapters: { bible: { home, render: async (html, file) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, html); } } } };
    await runCli(args, io);
    return JSON.parse(out);
  };
  const frozen = await run(["bible", "freeze", project, "--characters", "nova,rae", "--world", "office", "--rule", "Nova never runs.", "--rule", "Rae never raises his voice."]);
  assert.equal(frozen.action, "freeze");
  assert.deepEqual(json(path.join(project, BIBLE_FILE)).rules, ["Nova never runs.", "Rae never raises his voice."]);
  const shown = await run(["bible", "show", project]);
  assert.equal(shown.valid, true);
  assert.equal(shown.hash, frozen.hash);
  await rm(path.join(project, "bible/sheets/nova.png"));
  await assert.rejects(run(["bible", "show", project]), /bible show: 1 error\(s\)/);
  await assert.rejects(run(["bible", "thaw", project]), /Unknown bible action: thaw; use freeze or show/);
  assert.deepEqual(USAGE.filter(([name]) => name.startsWith("bible ")).map(([name]) => name), ["bible freeze", "bible show"]);
  assert.match(commandHelp("bible"), /bible freeze <project>[\s\S]*bible show <project>/);
  assert.equal(JSON.parse(await readFile(path.join(project, BIBLE_FILE), "utf8")).frozen, true);
});

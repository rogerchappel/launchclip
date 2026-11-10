// The show bible on disk: `launchclip bible freeze | show`, and the `bible`
// gate `launchclip finish` runs (docs/ANIMATION_PIPELINE_RFC.md §4.2, §8.2).
// The contract and its validation are kit/core/bible.mjs.
//
//   bible freeze <project> [--characters nova,rae] [--style outlined] …
//       resolve the cast (saved characters, starters, or the entries of a
//       draft BIBLE.json or the storyboard), draw a reference sheet per
//       character to bible/sheets/<id>.png, write BIBLE.json with its hash,
//       and pin storyboard.json and DIRECTION.json to it when they exist
//   bible show <project>
//       the bible, checked: its hash, its sheets on disk, the script's
//       characters, and whether the storyboard agrees with it
//
// Frozen means pinned: freezing again with different content is refused
// without --force, and a story planned against the old hash then fails the
// gate until it is pinned again.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BIBLE_FILE, BIBLE_SCHEMA, BIBLE_SHEETS, bibleCast, bibleCastFindings, bibleCharacter, bibleHash, bibleRefErrors, directionWithBible, validateBible, withBible } from "@launchclip/core/bible.mjs";
import { savedCharacterRequests, withSavedCharacters } from "@launchclip/core/characters/character.mjs";
import { starterCharacter } from "@launchclip/core/characters/cast.mjs";
import { DRAWING_STYLES, resolveStoryCast, storyCastErrors } from "@launchclip/core/characters/cues.mjs";
import { DIRECTION_FILE } from "@launchclip/core/direction.mjs";
import { storyStyleRequest } from "@launchclip/core/style.mjs";
import { applySavedCharacters, listCharacters, loadCharacter, projectCharacterRef, saveCharacter } from "./character_store.js";
import { mapLimit } from "./concurrency.js";

const STORY_FILE = "storyboard.json";
const SCRIPT_FILE = "SCRIPT.json";
const ID = /^[a-z][a-z0-9-]{0,23}$/;
const isObj = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const list = (value) => (value === undefined || value === null || value === true ? [] : Array.isArray(value) ? value : [value]);
const commas = (value) => list(value).flatMap((entry) => String(entry).split(",")).map((entry) => entry.trim()).filter(Boolean);
const short = (hash) => String(hash ?? "").replace(/^sha256:/, "").slice(0, 12);

async function readJsonIf(file) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(await readFile(file, "utf8")); } catch (error) { throw new Error(`${file} is not readable JSON: ${error.message}`); }
}

const writeJson = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

/** The hash of a file's bytes, as a bible records the script it was made from. */
async function fileHash(file) {
  return `sha256:${createHash("sha256").update(await readFile(file)).digest("hex")}`;
}

const entriesOf = (cast) => (Array.isArray(cast) ? cast : Array.isArray(cast?.characters) ? cast.characters : []);

/** --position nova=left (repeatable, or comma-separated) → Map id → side. */
function positions(value) {
  const out = new Map();
  for (const entry of commas(value)) {
    const match = /^([a-z][a-z0-9-]*)=(left|centre|center|right)$/.exec(entry);
    if (!match) throw new Error(`--position takes <id>=left|centre|right; got ${JSON.stringify(entry)}`);
    out.set(match[1], match[2]);
  }
  return out;
}

/**
 * Freeze a project's show bible. options: characters (ids, comma-separated
 * or a list), style, position, world, time, sets, rule, pack, seed, force,
 * pin (false leaves storyboard.json and DIRECTION.json alone). hooks: home
 * (the character library's root), render(html, png) (stands in for
 * Chromium), chromium (an executable path).
 */
export async function freezeBible(projectDir, options = {}, hooks = {}) {
  const project = path.resolve(String(projectDir ?? "."));
  const file = path.join(project, BIBLE_FILE);
  const store = { projectDir: project, home: hooks.home };
  const existing = await readJsonIf(file);
  if (existing && existing.schema !== BIBLE_SCHEMA) throw new Error(`${file} is not a show bible (schema must be "${BIBLE_SCHEMA}")`);
  const storyFile = path.join(project, STORY_FILE);
  const story = await readJsonIf(storyFile);
  const storyCast = isObj(story?.cast) || Array.isArray(story?.cast) ? story.cast : null;

  // Who is in it: the ids given, else the bible already there, else the
  // storyboard's cast, else every character saved in the project.
  const named = commas(options.characters);
  for (const id of named) if (!ID.test(id)) throw new Error(`--characters: ${JSON.stringify(id)} is not a character id`);
  const before = new Map([...entriesOf(storyCast), ...entriesOf(bibleCast(existing))].filter((entry) => isObj(entry) && typeof entry.id === "string").map((entry) => [entry.id, entry]));
  let entries = named.length ? named.map((id) => ({ id, ...(before.get(id)?.position ? { position: before.get(id).position } : {}) }))
    : entriesOf(bibleCast(existing)).length ? entriesOf(bibleCast(existing))
    : entriesOf(storyCast).length ? entriesOf(storyCast)
    : (await listCharacters({ ...store, only: "project" })).filter((row) => !row.error && !row.shadowed).map((row) => ({ id: row.id }));
  if (!entries.length) throw new Error(`no characters to freeze: name them (launchclip bible freeze ${projectDir} --characters <id>,<id>), list them in ${STORY_FILE}'s cast, or design one first (launchclip cast create <id> --describe "…" --project ${projectDir})`);
  const side = positions(options.position);
  for (const id of side.keys()) if (!entries.some((entry) => entry?.id === id)) throw new Error(`--position: "${id}" is not in the cast (${entries.map((entry) => entry?.id).join(", ")})`);
  entries = entries.map((entry) => (isObj(entry) && side.has(entry.id) ? { ...entry, position: side.get(entry.id) } : entry));

  // Saved characters fill their entries; one from the library is copied into
  // the project, so the bible names a file the project carries.
  const saved = new Map();
  for (const id of savedCharacterRequests({ cast: { characters: entries } })) {
    let loaded = await loadCharacter(id, store);
    if (!loaded) throw new Error(`"${id}" is not a saved character or a starter (launchclip cast list ${projectDir}); design it first: launchclip cast create ${id} --describe "…" --project ${projectDir}`);
    if (loaded.source === "library") loaded = { ...(await saveCharacter(loaded.character, { ...store, to: "project" })), copied: true };
    saved.set(id, loaded);
  }
  const filled = withSavedCharacters({ cast: { characters: entries } }, (id) => saved.get(id)?.character ?? null);
  const from = new Map(filled.used.map((use) => [use.id, use.from]));
  // An entry kept from the bible already there is not read from its saved file again (it is pinned);
  // it keeps the file it names. --characters reads the saved files as they are now.
  const keptFile = new Map(named.length ? [] : entriesOf(existing?.cast).filter((entry) => isObj(entry) && typeof entry.character_file === "string").map((entry) => [entry.id, entry.character_file]));
  // A starter speaks in its own voice unless the entry names another.
  const characters = entriesOf(filled.story.cast).map((entry) => {
    if (!isObj(entry) || entry.voice || entry.art !== undefined) return entry;
    const starter = starterCharacter(entry.from ?? entry.id);
    return starter?.voice ? { ...entry, voice: starter.voice } : entry;
  });

  // One drawing style for the whole cast: the flag, the bible's, the
  // storyboard's, else the style the first saved character was designed in.
  const style = text(options.style) ?? existing?.cast?.style ?? (isObj(storyCast) ? storyCast.style : undefined) ?? [...saved.values()][0]?.character.style ?? "flat";
  if (!DRAWING_STYLES.includes(style)) throw new Error(`--style must be one of ${DRAWING_STYLES.join(", ")}; got ${JSON.stringify(style)}`);
  const colors = existing?.cast?.colors ?? (isObj(storyCast) ? storyCast.colors : undefined);
  const cast = { style, ...(isObj(colors) ? { colors } : {}), characters };
  const castErrors = storyCastErrors(cast);
  if (castErrors.length) throw new Error(`the cast does not resolve:\n- ${castErrors.join("\n- ")}`);
  const resolved = resolveStoryCast({ cast });
  const sheetOf = (id) => `${BIBLE_SHEETS}/${id}.png`;
  const frozenCast = {
    style, ...(isObj(colors) ? { colors } : {}),
    characters: [...resolved.members.values()].map((member) => {
      if (member.sprite) throw new Error(`${member.id} is an illustrated character (art); a bible character needs rig params (the rig draws the animatic and is the fallback for handed-in art)`);
      if (!member.voice) throw new Error(`${member.id} has no voice; give it one: launchclip cast edit ${from.get(member.id) ?? member.id} --voice <voice> --project ${projectDir}`);
      return bibleCharacter(member, { character_file: from.has(member.id) ? projectCharacterRef(from.get(member.id)) : keptFile.get(member.id) ?? null, sheet: sheetOf(member.id) });
    })
  };

  // World, style, rules and the script the bible was made from.
  const world = { ...(isObj(existing?.world) ? existing.world : isObj(story?.world) ? story.world : {}) };
  if (text(options.world)) { world.kind = text(options.world); }
  if (text(options.time)) world.time = text(options.time);
  if (options.sets !== undefined) world.sets = commas(options.sets);
  const pack = text(options.pack) ?? existing?.style?.pack ?? storyStyleRequest(story)?.name ?? null;
  const seedIn = options.seed ?? existing?.style?.seed;
  const seed = seedIn === undefined || seedIn === null ? null : /^\d+$/.test(String(seedIn)) ? Number(seedIn) : String(seedIn);
  const rules = [...new Set([...(Array.isArray(existing?.rules) ? existing.rules : []), ...list(options.rule).map((rule) => String(rule).trim()).filter(Boolean)])];
  const scriptFile = path.join(project, SCRIPT_FILE);
  const script = await readJsonIf(scriptFile);
  let bible = {
    schema: BIBLE_SCHEMA, frozen: true,
    cast: frozenCast,
    ...(Object.keys(world).length ? { world } : {}),
    style: { ...(pack ? { pack } : {}), ...(seed !== null ? { seed } : {}), drawing_style: style },
    ...(rules.length ? { rules } : {}),
    ...(script ? { inputs: { script_hash: await fileHash(scriptFile) } } : {})
  };
  const warnings = [];
  // The same bible made from an edited script keeps its hash: a reworded
  // line does not unpin the cast. --force freezes it against the new script.
  if (existing?.frozen === true && !options.force) {
    const { inputs: _a, hash: _h, ...was } = existing;
    const { inputs: _b, ...now } = bible;
    if (bibleHash(was) === bibleHash(now)) {
      if (existing.inputs?.script_hash !== bible.inputs?.script_hash) warnings.push(`${SCRIPT_FILE} changed since the bible was frozen; --force freezes it against the script as it is now`);
      bible = { ...now, ...(existing.inputs ? { inputs: existing.inputs } : {}) };
    }
  }
  bible = { schema: bible.schema, frozen: true, hash: bibleHash(bible), ...Object.fromEntries(Object.entries(bible).filter(([key]) => !["schema", "frozen"].includes(key))) };
  const check = validateBible(bible, { script });
  if (!check.ok) throw new Error(`the bible is not valid:\n- ${check.errors.join("\n- ")}`);
  warnings.push(...check.warnings);
  const changed = !existing || existing.frozen !== true || existing.hash !== bible.hash;
  if (existing?.frozen === true && changed && !options.force) {
    const parts = ["cast", "world", "style", "rules"].filter((key) => JSON.stringify(existing[key]) !== JSON.stringify(bible[key]));
    throw new Error(`${file} is frozen (${short(existing.hash)}) and this would change its ${parts.join(", ") || "content"}. Frozen means pinned: pass --force to freeze the new bible; a storyboard planned against the old one is pinned again here, and anything drawn from the old one (hand-in art) must be checked against the new sheets`);
  }

  // The sheets: drawn before the file is written, so a frozen bible always has them.
  const { referenceSheet } = await import("./cast_design.js");
  const brand = isObj(story?.brand) ? story.brand : null;
  // options.sheetConcurrency: how many sheets are drawn side by side (default 1; make passes what the render budget has room for). Each is its own file.
  await mapLimit(bibleCast(bible).characters, options.sheetConcurrency ?? 1, async (entry) => {
    try {
      await referenceSheet(entry, { style, colors: isObj(colors) ? colors : null, brand, out: path.join(project, sheetOf(entry.id)), render: hooks.render, chromium: text(options.chromium) ?? hooks.chromium });
    } catch (error) {
      throw new Error(`could not draw ${entry.id}'s reference sheet: ${error.message}\nThe sheets are drawn in Chromium: install one (npx playwright install chromium), or name one with --chromium <path> or LAUNCHCLIP_CHROMIUM. ${BIBLE_FILE} was not written.`);
    }
  });
  await mkdir(project, { recursive: true });
  await writeJson(file, bible);

  // Pin the storyboard and the direction map: the story's cast becomes the bible's.
  const pinned = [];
  if (options.pin !== false) {
    if (story) {
      const next = withBible(story, bible);
      if (JSON.stringify(next) !== JSON.stringify(story)) { await writeJson(storyFile, next); pinned.push(STORY_FILE); }
    }
    const directionFile = path.join(project, DIRECTION_FILE);
    const direction = await readJsonIf(directionFile);
    if (isObj(direction)) {
      const next = directionWithBible(direction, bible);
      if (JSON.stringify(next) !== JSON.stringify(direction)) { await writeJson(directionFile, next); pinned.push(DIRECTION_FILE); }
    }
  }
  return {
    stage: "bible", action: "freeze", status: "ready", project, file, frozen: true, hash: bible.hash, changed,
    style, characters: summary(bible),
    ...(bible.world ? { world: bible.world } : {}),
    ...([...saved.values()].some((entry) => entry.copied) ? { copied: [...saved.values()].filter((entry) => entry.copied).map((entry) => path.relative(project, entry.file)) } : {}),
    pinned,
    ...(warnings.length ? { warnings } : {}),
    next: `Look at the sheets in ${path.join(project, BIBLE_SHEETS)}; a story is pinned to this bible by "bible": {"file": "${BIBLE_FILE}", "hash": "${bible.hash}"} and a cast copied from it (launchclip bible freeze pins ${STORY_FILE} when it exists)`
  };
}

const summary = (bible) => entriesOf(bible?.cast).filter(isObj).map((entry) => ({ id: entry.id, name: entry.name ?? entry.id, voice: entry.voice ?? null, position: entry.position ?? null, character_file: entry.character_file ?? null, sheet: entry.sheet ?? null, must_keep: entry.must_keep ?? [] }));

/** A project's bible, read and checked against the disk and the script. → {bible, file, check} | null when there is none. */
export async function readBible(projectDir, { file = BIBLE_FILE, home } = {}) {
  const project = path.resolve(String(projectDir ?? "."));
  const target = path.join(project, file);
  const bible = await readJsonIf(target);
  if (bible === null) return null;
  const script = await readJsonIf(path.join(project, SCRIPT_FILE)).catch(() => null);
  // A draft may name saved characters by id alone; they are filled before it is checked, as freeze fills them.
  let checked = bible;
  if (isObj(bible) && bible.frozen !== true && isObj(bible.cast)) {
    const filled = await applySavedCharacters({ cast: bibleCast(bible) }, { projectDir: project, home });
    if (filled.used.length) checked = { ...bible, cast: filled.story.cast };
  }
  const check = validateBible(checked, { script, exists: (relative) => existsSync(path.join(project, relative)) });
  return { bible, file: target, check };
}

/** `bible show <project>`: the bible, whether it is valid, and whether the storyboard agrees with it. */
export async function showBible(projectDir, hooks = {}) {
  const project = path.resolve(String(projectDir ?? "."));
  const read = await readBible(project, { home: hooks.home });
  if (!read) throw new Error(`${path.join(project, BIBLE_FILE)} does not exist; make one with launchclip bible freeze ${projectDir} --characters <id>,<id>`);
  const { bible, file, check } = read;
  let story = null;
  if (existsSync(path.join(project, STORY_FILE))) {
    try {
      const { applyProjectStyle } = await import("./story_style.js");
      const applied = (await applyProjectStyle(await readJsonIf(path.join(project, STORY_FILE)), { projectDir: project })).story;
      const gate = await bibleGate(project, applied, { direction: await readJsonIf(path.join(project, DIRECTION_FILE)) });
      story = { file: STORY_FILE, gate: gate.status, ...(gate.reason ? { reason: gate.reason } : {}), findings: gate.findings.map((finding) => finding.detail) };
    } catch (error) {
      story = { file: STORY_FILE, gate: "failed", findings: [error.message] };
    }
  }
  return {
    stage: "bible", action: "show", status: check.ok ? "ready" : "invalid", project, file,
    frozen: bible?.frozen === true, hash: bible?.hash ?? null, valid: check.ok, errors: check.errors, warnings: check.warnings,
    style: bible?.cast?.style ?? null, characters: summary(bible),
    ...(isObj(bible?.world) ? { world: bible.world } : {}),
    ...(isObj(bible?.style) ? { look: bible.style } : {}),
    ...(Array.isArray(bible?.rules) ? { rules: bible.rules } : {}),
    ...(isObj(bible?.inputs) ? { inputs: bible.inputs } : {}),
    ...(story ? { story } : {})
  };
}

export async function runBibleCommand(action, project, flags = {}, hooks = {}) {
  if (action === "freeze") {
    return freezeBible(project ?? flags.project ?? ".", {
      characters: flags.characters, style: flags.style, position: flags.position, world: flags.world, time: flags.time, sets: flags.sets,
      rule: flags.rule, pack: flags.pack, seed: flags.seed, chromium: flags.chromium, force: Boolean(flags.force), pin: !flags["no-pin"]
    }, hooks);
  }
  if (action === "show") return showBible(project ?? flags.project ?? ".", hooks);
  throw new Error(`Unknown bible action: ${action ?? "(none)"}; use freeze or show`);
}

// ---------------------------------------------------------------------------
// The finish gate

/**
 * The bible gate for a story (after the saved-character step, so its cast
 * entries are filled): the story names the project's frozen bible by its
 * hash, the bible is valid (its hash matches its content, every sheet is on
 * disk, every script character has an entry), the direction map names the
 * same bible, and the story's cast is the bible's.
 * → {status: "passed" | "failed" | "skipped", reason?, file?, hash?, findings: [{detail}]}
 *
 * It is skipped for a story that names no bible in a project with no frozen
 * BIBLE.json. A frozen BIBLE.json the story does not name fails: dropping
 * the `bible` key must not be a way around the pin.
 */
export async function bibleGate(projectDir, story, { direction = null } = {}) {
  const project = path.resolve(String(projectDir ?? "."));
  const ref = story?.bible;
  const refErrors = ref === undefined ? [] : bibleRefErrors(ref, `${STORY_FILE} bible`);
  const relative = ref !== undefined && !refErrors.length ? ref.file : BIBLE_FILE;
  const findings = [];
  const fail = (detail) => findings.push({ detail });
  let read = null;
  try { read = await readBible(project, { file: relative }); } catch (error) { fail(error.message); }
  if (ref === undefined && direction?.bible === undefined) {
    if (!read && !findings.length) return { status: "skipped", reason: "this story names no show bible", findings: [] };
    if (read && read.bible?.frozen !== true) return { status: "skipped", reason: `${BIBLE_FILE} is a draft (not frozen) and the story does not name it`, findings: [] };
  }
  for (const message of refErrors) fail(message);
  if (!read && !findings.length) fail(`${STORY_FILE} names the show bible ${relative}, which does not exist`);
  if (read) {
    const { bible, check } = read;
    if (bible?.frozen !== true) fail(`${relative} is a draft; freeze it (launchclip bible freeze) before a story is planned against it`);
    for (const message of check.errors) fail(`${relative}: ${message}`);
    const hash = typeof bible?.hash === "string" ? bible.hash : null;
    if (ref === undefined) fail(`${STORY_FILE} does not name the project's frozen bible; pin it with launchclip bible freeze (it writes "bible": {"file": "${relative}", "hash": "${hash}"} and the bible's cast)`);
    else if (!refErrors.length && hash && ref.hash !== hash) fail(`${STORY_FILE} was planned against bible ${short(ref.hash)}; the frozen bible is ${short(hash)}. Pin the story to it again (launchclip bible freeze) and check its scenes against the new cast`);
    if (direction?.bible !== undefined) {
      const errors = bibleRefErrors(direction.bible, `${DIRECTION_FILE} bible`);
      for (const message of errors) fail(message);
      if (!errors.length && hash && direction.bible.hash !== hash) fail(`${DIRECTION_FILE} was planned against bible ${short(direction.bible.hash)}; the frozen bible is ${short(hash)}`);
    }
    if (isObj(bible?.cast)) for (const detail of bibleCastFindings(story, bible)) fail(detail);
    return { status: findings.length ? "failed" : "passed", file: relative, hash, characters: entriesOf(bible?.cast).map((entry) => entry?.id).filter(Boolean), findings };
  }
  return { status: "failed", file: relative, hash: null, findings };
}

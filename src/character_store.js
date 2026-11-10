// Where saved characters live (kit/core/characters/character.mjs has the
// file's schema), and character packs.
//
//   <project>/cast/<id>.character.json     a project's own characters
//   ~/.launchclip/cast/<id>.character.json the user library ($LAUNCHCLIP_HOME/cast)
//
// A story names a saved character by id in story.cast; the project's folder
// is searched first, then the library. applySavedCharacters is the step every
// storyboard read runs (src/story_style.js).
//
// A character pack shares several characters: a folder holding
// cast-pack.json ({schema: "launchclip.cast-pack.v1", name, characters:
// [ids]}) beside each <id>.character.json, or one .json file with the
// characters inside ({schema, name, characters: [character files]}).
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CAST_PACK_SCHEMA, characterFileName, normalizeCharacter, savedCharacterRequests, withSavedCharacters } from "@launchclip/core/characters/character.mjs";
import { pinnedHome } from "./state_dirs.js";

const SUFFIX = ".character.json";
export const CAST_PACK_FILE = "cast-pack.json";

/** <project>/cast */
export const projectCastRoot = (projectDir = process.cwd()) => path.join(path.resolve(projectDir), "cast");

/** A project character's file as a show bible names it: cast/<id>.character.json, relative to the project. */
export const projectCharacterRef = (id) => `cast/${characterFileName(id)}`;

/** ~/.launchclip/cast, or $LAUNCHCLIP_HOME/cast. */
export function homeCastRoot(options = {}) {
  if (!options.home && pinnedHome("cast")) return pinnedHome("cast");
  const home = options.home ?? process.env.LAUNCHCLIP_HOME ?? path.join(os.homedir(), ".launchclip");
  return path.join(path.resolve(home), "cast");
}

const roots = ({ projectDir, home, only } = {}) => [
  { source: "project", root: projectCastRoot(projectDir) },
  { source: "library", root: homeCastRoot({ home }) }
].filter((entry) => !only || entry.source === only);

async function readCharacter(file) {
  let data;
  try { data = JSON.parse(await readFile(file, "utf8")); } catch (error) { throw new Error(`${file} is not readable JSON: ${error.message}`); }
  return normalizeCharacter(data, path.basename(file));
}

/** A saved character by id: the project's, else the library's (only: "project" | "library" searches one). → {character, file, source} | null */
export async function loadCharacter(id, options = {}) {
  if (typeof id !== "string" || !/^[a-z][a-z0-9-]{0,23}$/.test(id)) return null;
  for (const { source, root } of roots(options)) {
    const file = path.join(root, characterFileName(id));
    if (!existsSync(file)) continue;
    const character = await readCharacter(file);
    if (character.id !== id) throw new Error(`${file} holds the character "${character.id}"; its file name must be ${characterFileName(character.id)}`);
    return { character, file, source };
  }
  return null;
}

/** Every saved character: [{id, name, personality, style, voice, source, file} | {id, source, file, error}], the project's first. */
export async function listCharacters(options = {}) {
  const out = [];
  const seen = new Set();
  for (const { source, root } of roots(options)) {
    const files = (await readdir(root).catch(() => [])).filter((name) => name.endsWith(SUFFIX)).sort();
    for (const name of files) {
      const id = name.slice(0, -SUFFIX.length);
      const file = path.join(root, name);
      if (seen.has(id)) { out.push({ id, source, file, shadowed: true }); continue; }
      seen.add(id);
      try {
        const character = await readCharacter(file);
        out.push({ id: character.id, name: character.name, personality: character.personality ?? null, style: character.style, voice: character.voice ?? null, build: character.params.build ?? null, hair: character.params.hair?.style ?? null, ...(character.params.kind ? { kind: character.params.kind } : {}), source, file });
      } catch (error) {
        out.push({ id, source, file, error: error.message });
      }
    }
  }
  return out;
}

/** Write a character to the project (default) or the library. → {character, file, source} */
export async function saveCharacter(character, { projectDir, home, to = "project", file: target } = {}) {
  if (!["project", "library"].includes(to)) throw new Error(`--to must be project or library; got ${JSON.stringify(to)}`);
  const normal = normalizeCharacter(character);
  const file = target ?? path.join(to === "library" ? homeCastRoot({ home }) : projectCastRoot(projectDir), characterFileName(normal.id));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(normal, null, 2)}\n`);
  return { character: normal, file, source: to };
}

/**
 * The saved-character step of a storyboard read: story cast entries that name
 * a saved character are filled from its file. → {story, used: [{id, from, source}]}
 * (the input story when it asks for none).
 */
export async function applySavedCharacters(story, options = {}) {
  const ids = savedCharacterRequests(story);
  if (!ids.length) return { story, used: [] };
  const found = new Map();
  for (const id of ids) {
    const loaded = await loadCharacter(id, options);
    if (loaded) found.set(id, loaded);
  }
  if (!found.size) return { story, used: [] };
  const filled = withSavedCharacters(story, (id) => found.get(id)?.character ?? null);
  return { story: filled.story, used: filled.used.map((entry) => ({ ...entry, source: found.get(entry.from).source })) };
}

// ---------------------------------------------------------------------------
// Packs

/** Write a pack: a folder (cast-pack.json and one file per character), or one .json file. */
export async function writeCastPack(characters, out, { name } = {}) {
  if (!characters.length) throw new Error("a character pack needs at least one character");
  const target = path.resolve(out);
  const packName = String(name ?? path.basename(target).replace(/(\.cast-pack)?\.json$/, "")).trim() || "cast";
  const normal = characters.map((character) => normalizeCharacter(character));
  if (target.endsWith(".json")) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify({ schema: CAST_PACK_SCHEMA, name: packName, characters: normal }, null, 2)}\n`);
    return { path: target, kind: "file", name: packName, files: [target] };
  }
  await mkdir(target, { recursive: true });
  const files = [];
  for (const character of normal) {
    const file = path.join(target, characterFileName(character.id));
    await writeFile(file, `${JSON.stringify(character, null, 2)}\n`);
    files.push(file);
  }
  const manifest = path.join(target, CAST_PACK_FILE);
  await writeFile(manifest, `${JSON.stringify({ schema: CAST_PACK_SCHEMA, name: packName, characters: normal.map((character) => character.id) }, null, 2)}\n`);
  return { path: target, kind: "folder", name: packName, files: [manifest, ...files] };
}

/**
 * Read a pack (a folder, its cast-pack.json, a single-file pack, or one
 * character file). Every character is validated; nothing else in the pack is
 * read or run. → {name, characters}
 */
export async function readCastPack(source) {
  const target = path.resolve(source);
  const info = await stat(target).catch(() => null);
  if (!info) throw new Error(`${source} does not exist`);
  const folder = info.isDirectory() ? target : path.basename(target) === CAST_PACK_FILE ? path.dirname(target) : null;
  if (folder) {
    const manifestFile = path.join(folder, CAST_PACK_FILE);
    let ids, name = path.basename(folder);
    if (existsSync(manifestFile)) {
      const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
      if (manifest?.schema !== CAST_PACK_SCHEMA || !Array.isArray(manifest.characters)) throw new Error(`${manifestFile} must be {schema: "${CAST_PACK_SCHEMA}", name, characters: [ids]}`);
      ids = manifest.characters;
      if (typeof manifest.name === "string" && manifest.name.trim()) name = manifest.name.trim();
    } else {
      ids = (await readdir(folder)).filter((file) => file.endsWith(SUFFIX)).sort().map((file) => file.slice(0, -SUFFIX.length));
    }
    if (!ids.length) throw new Error(`${source} holds no character files (*${SUFFIX})`);
    const characters = [];
    for (const id of ids) {
      if (typeof id !== "string" || !/^[a-z][a-z0-9-]{0,23}$/.test(id)) throw new Error(`${manifestFile}: ${JSON.stringify(id)} is not a character id`);
      const character = await readCharacter(path.join(folder, characterFileName(id)));
      if (character.id !== id) throw new Error(`${characterFileName(id)} holds the character "${character.id}"`);
      characters.push(character);
    }
    return { name, characters };
  }
  let data;
  try { data = JSON.parse(await readFile(target, "utf8")); } catch (error) { throw new Error(`${source} is not readable JSON: ${error.message}`); }
  if (data?.schema === CAST_PACK_SCHEMA) {
    if (!Array.isArray(data.characters) || !data.characters.length) throw new Error(`${source} has no characters`);
    const characters = data.characters.map((character, i) => normalizeCharacter(character, `characters[${i}]`));
    const twice = characters.find((character, i) => characters.findIndex((other) => other.id === character.id) !== i);
    if (twice) throw new Error(`${source} lists "${twice.id}" twice`);
    return { name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : path.basename(target, ".json"), characters };
  }
  return { name: path.basename(target, ".json"), characters: [normalizeCharacter(data, path.basename(target))] };
}

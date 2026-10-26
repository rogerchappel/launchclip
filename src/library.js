// A library is a folder with a launchclip.library.json at its root
// (docs/COLLECTIONS_RFC.md §3.1). It says where video projects, finished files
// and caches go, so `make` and `intake` stop needing --out per job. With no
// library, every command behaves as before.
//
// The library is found from --library <path>, else LAUNCHCLIP_LIBRARY, else by
// walking up from the current folder. Relative storage paths resolve against
// the library folder; "~" expands to the home folder.
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const LIBRARY_FILE = "launchclip.library.json";
export const LIBRARY_SCHEMA = "launchclip.library.v1";
// The free space a job needs on its drive when the library does not say.
export const DEFAULT_MIN_FREE_GB = 10;

/**
 * The library file in use, or null.
 * options: {cwd, library (the --library flag), env}
 * An explicit --library or LAUNCHCLIP_LIBRARY that names nothing is an error;
 * the walk up from cwd quietly finds nothing.
 */
export function findLibrary({ cwd = process.cwd(), library, env = process.env } = {}) {
  const explicit = library ?? env.LAUNCHCLIP_LIBRARY;
  if (explicit) {
    const source = library ? "--library" : "LAUNCHCLIP_LIBRARY";
    const target = path.resolve(cwd, expandHome(String(explicit), env));
    const file = isDirectory(target) ? path.join(target, LIBRARY_FILE) : target;
    if (!existsSync(file)) throw new Error(`${source} ${explicit}: no ${LIBRARY_FILE} there; create one with launchclip library init <path>`);
    return file;
  }
  let dir = path.resolve(cwd);
  for (;;) {
    const file = path.join(dir, LIBRARY_FILE);
    if (existsSync(file)) return file;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Read and validate a library file.
 * → {file, root, name, storage: {projects, finals, archive, min_free_gb}, cache, collections}
 * Every path is absolute; finals, archive and cache are null when unset.
 */
export async function readLibrary(file, env = process.env) {
  const absolute = path.resolve(file);
  let raw;
  try { raw = JSON.parse(await readFile(absolute, "utf8")); }
  catch (error) { throw new Error(`${absolute}: ${error.code === "ENOENT" ? "not found" : `not valid JSON (${error.message})`}`); }
  return resolveLibrary(raw, absolute, env);
}

/** Validate a parsed library document and resolve its paths against the file's folder. */
export function resolveLibrary(raw, file, env = process.env) {
  const fail = (message) => { throw new Error(`${file}: ${message}`); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("must be a JSON object");
  if (raw.schema !== LIBRARY_SCHEMA) fail(`schema must be "${LIBRARY_SCHEMA}"; got ${JSON.stringify(raw.schema ?? null)}`);
  if (raw.name != null && typeof raw.name !== "string") fail("name must be a string");
  const storage = raw.storage ?? {};
  if (typeof storage !== "object" || Array.isArray(storage)) fail("storage must be an object");
  const root = path.dirname(file);
  const location = (value, key) => {
    if (value == null) return null;
    if (typeof value !== "string" || !value.trim()) fail(`${key} must be a path or null`);
    return path.resolve(root, expandHome(value.trim(), env));
  };
  const minFree = storage.min_free_gb ?? DEFAULT_MIN_FREE_GB;
  if (typeof minFree !== "number" || !Number.isFinite(minFree) || minFree < 0) fail("storage.min_free_gb must be a number of gigabytes, 0 or more");
  const collections = raw.collections ?? [];
  if (!Array.isArray(collections) || collections.some((entry) => typeof entry !== "string" || !entry)) fail("collections must be a list of folder names");
  return {
    file,
    root,
    name: raw.name ?? path.basename(root),
    storage: {
      projects: location(storage.projects, "storage.projects") ?? root,
      finals: location(storage.finals, "storage.finals"),
      archive: location(storage.archive, "storage.archive"),
      min_free_gb: minFree
    },
    cache: location(raw.cache, "cache"),
    collections
  };
}

/** findLibrary + readLibrary: the resolved library in use, or null. */
export async function loadLibrary(options = {}) {
  const file = findLibrary(options);
  return file ? readLibrary(file, options.env ?? process.env) : null;
}

/** A path under the library's projects folder. */
export function projectRoot(library, ...segments) {
  return path.join(library.storage.projects, ...segments);
}

/**
 * The environment with the library's cache as LAUNCHCLIP_CACHE, unless the
 * shell already set one (the shell wins, as with .env).
 */
export function libraryEnv(library, env = process.env) {
  if (!library?.cache || env.LAUNCHCLIP_CACHE) return env;
  return { ...env, LAUNCHCLIP_CACHE: library.cache };
}

/** "~" and "~/x" → the home folder. */
export function expandHome(value, env = process.env) {
  if (value !== "~" && !value.startsWith("~/") && !value.startsWith(`~${path.sep}`)) return value;
  return path.join(env.HOME || os.homedir(), value.slice(1));
}

/**
 * launchclip library init <path> [--projects <dir>] [--finals <dir>] [--cache <dir>] [--name <name>] [--force]
 * Writes <path>/launchclip.library.json; paths are stored as given.
 */
export async function initLibrary(target, options = {}, env = process.env) {
  if (!target) throw new Error("launchclip library init needs a folder: launchclip library init ~/Videos/launchclip [--projects /Volumes/Footage/launchclip]");
  const root = path.resolve(expandHome(String(target), env));
  const file = path.join(root, LIBRARY_FILE);
  if (existsSync(file) && !options.force) throw new Error(`${file} already exists; pass --force to replace it`);
  const document = {
    schema: LIBRARY_SCHEMA,
    name: options.name ?? path.basename(root),
    storage: {
      projects: options.projects ?? ".",
      finals: options.finals ?? null,
      archive: options.archive ?? null,
      min_free_gb: options.minFreeGb == null ? DEFAULT_MIN_FREE_GB : Number(options.minFreeGb)
    },
    cache: options.cache ?? null,
    collections: []
  };
  // Validate before anything is written.
  const library = resolveLibrary(document, file, env);
  await mkdir(root, { recursive: true });
  await writeFile(file, `${JSON.stringify(document, null, 2)}\n`);
  return { stage: "library", action: "init", status: "ready", file, library };
}

function isDirectory(target) {
  try { return statSync(target).isDirectory(); } catch { return false; }
}

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_MIN_FREE_GB, findLibrary, initLibrary, LIBRARY_FILE, LIBRARY_SCHEMA, loadLibrary, projectRoot, readLibrary, useLibraryCache } from "../src/library.js";

const tempDir = () => mkdtemp(path.join(os.tmpdir(), "launchclip-library-"));

async function writeLibraryFile(dir, document) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, LIBRARY_FILE);
  await writeFile(file, `${JSON.stringify(document, null, 2)}\n`);
  return file;
}

test("finds the library by walking up from the current folder", async () => {
  const root = await tempDir();
  const file = await writeLibraryFile(root, { schema: LIBRARY_SCHEMA });
  const nested = path.join(root, "acme", "launch");
  await mkdir(nested, { recursive: true });
  assert.equal(findLibrary({ cwd: nested, env: {} }), file);
  assert.equal(findLibrary({ cwd: root, env: {} }), file);
});

test("finds no library outside one", async () => {
  const outside = await tempDir();
  assert.equal(findLibrary({ cwd: outside, env: {} }), null);
  assert.equal(await loadLibrary({ cwd: outside, env: {} }), null);
});

test("--library wins over LAUNCHCLIP_LIBRARY, which wins over the walk up", async () => {
  const walked = await tempDir();
  await writeLibraryFile(walked, { schema: LIBRARY_SCHEMA });
  const fromEnv = await tempDir();
  const envFile = await writeLibraryFile(fromEnv, { schema: LIBRARY_SCHEMA });
  const fromFlag = await tempDir();
  const flagFile = await writeLibraryFile(fromFlag, { schema: LIBRARY_SCHEMA });
  const env = { LAUNCHCLIP_LIBRARY: fromEnv };
  assert.equal(findLibrary({ cwd: walked, env }), envFile);
  assert.equal(findLibrary({ cwd: walked, env, library: fromFlag }), flagFile);
  // The flag may name the file itself.
  assert.equal(findLibrary({ cwd: walked, env, library: flagFile }), flagFile);
});

test("an explicit library that names nothing is an error", async () => {
  const empty = await tempDir();
  assert.throws(() => findLibrary({ cwd: empty, env: {}, library: empty }), /--library .*no launchclip\.library\.json/);
  assert.throws(() => findLibrary({ cwd: empty, env: { LAUNCHCLIP_LIBRARY: empty } }), /LAUNCHCLIP_LIBRARY .*library init/);
});

test("resolves storage paths against the library folder and expands ~", async () => {
  const root = await tempDir();
  const home = await tempDir();
  const file = await writeLibraryFile(root, {
    schema: LIBRARY_SCHEMA,
    name: "Roger's videos",
    storage: { projects: "/Volumes/Footage/launchclip", finals: "finals", archive: null, min_free_gb: 40 },
    cache: "~/.cache/launchclip",
    collections: ["acme"]
  });
  const library = await readLibrary(file, { HOME: home });
  assert.equal(library.name, "Roger's videos");
  assert.equal(library.root, root);
  assert.deepEqual(library.storage, {
    projects: "/Volumes/Footage/launchclip",
    finals: path.join(root, "finals"),
    archive: null,
    min_free_gb: 40
  });
  assert.equal(library.cache, path.join(home, ".cache", "launchclip"));
  assert.deepEqual(library.collections, ["acme"]);
  assert.equal(projectRoot(library, "acme", "launch"), "/Volumes/Footage/launchclip/acme/launch");
});

test("an empty storage block keeps projects in the library folder", async () => {
  const root = await tempDir();
  const library = await readLibrary(await writeLibraryFile(root, { schema: LIBRARY_SCHEMA }), {});
  assert.equal(library.storage.projects, root);
  assert.equal(library.storage.finals, null);
  assert.equal(library.storage.min_free_gb, DEFAULT_MIN_FREE_GB);
  assert.equal(library.cache, null);
  assert.equal(library.name, path.basename(root));
});

test("rejects a library with the wrong schema or bad storage values", async () => {
  const root = await tempDir();
  const cases = [
    [{ schema: "launchclip.library.v0" }, /schema must be "launchclip\.library\.v1"/],
    [{ schema: LIBRARY_SCHEMA, storage: { projects: 3 } }, /storage\.projects must be a path or null/],
    [{ schema: LIBRARY_SCHEMA, storage: { min_free_gb: -1 } }, /min_free_gb must be a number/],
    [{ schema: LIBRARY_SCHEMA, storage: { min_free_gb: "40" } }, /min_free_gb must be a number/],
    [{ schema: LIBRARY_SCHEMA, collections: "acme" }, /collections must be a list/],
    [[], /must be a JSON object/]
  ];
  for (const [document, pattern] of cases) {
    const file = await writeLibraryFile(root, document);
    await assert.rejects(readLibrary(file, {}), pattern);
  }
  await writeFile(path.join(root, LIBRARY_FILE), "{ not json");
  await assert.rejects(readLibrary(path.join(root, LIBRARY_FILE), {}), /not valid JSON/);
});

test("the library cache becomes LAUNCHCLIP_CACHE unless the shell set one", () => {
  const library = { cache: "/cache/here" };
  const env = {};
  const restore = useLibraryCache(library, env);
  assert.equal(env.LAUNCHCLIP_CACHE, "/cache/here");
  restore();
  assert.equal(Object.hasOwn(env, "LAUNCHCLIP_CACHE"), false);
  const mine = { LAUNCHCLIP_CACHE: "/mine" };
  useLibraryCache(library, mine)();
  assert.equal(mine.LAUNCHCLIP_CACHE, "/mine");
  const none = {};
  useLibraryCache({ cache: null }, none);
  useLibraryCache(null, none);
  assert.deepEqual(none, {});
});

test("library init writes a valid library and refuses to overwrite one", async () => {
  const root = path.join(await tempDir(), "videos");
  const result = await initLibrary(root, { projects: "/Volumes/Footage/launchclip", finals: "/Volumes/Footage/launchclip/_finals", cache: "~/.cache/launchclip" }, { HOME: "/home/test" });
  assert.equal(result.file, path.join(root, LIBRARY_FILE));
  const written = JSON.parse(await readFile(result.file, "utf8"));
  assert.equal(written.schema, LIBRARY_SCHEMA);
  assert.equal(written.name, "videos");
  assert.equal(written.storage.projects, "/Volumes/Footage/launchclip");
  assert.equal(written.cache, "~/.cache/launchclip");
  assert.equal(result.library.cache, "/home/test/.cache/launchclip");
  await assert.rejects(initLibrary(root, {}), /already exists; pass --force/);
  const replaced = await initLibrary(root, { force: true });
  assert.equal(replaced.library.storage.projects, root);
});

test("launchclip library init writes the file from the CLI", async () => {
  const { runCli } = await import("../src/cli.js");
  const root = path.join(await tempDir(), "lib");
  const out = [];
  await runCli(["library", "init", root, "--projects", "projects", "--min-free-gb", "25"], { stdout: { write: (value) => out.push(value) } });
  const result = JSON.parse(out.join(""));
  assert.equal(result.status, "ready");
  assert.equal(result.library.storage.projects, path.join(root, "projects"));
  assert.equal(result.library.storage.min_free_gb, 25);
  await assert.rejects(runCli(["library", "nope"], { stdout: { write: () => {} } }), /Unknown library action: nope/);
  await assert.rejects(runCli(["library", "init"], { stdout: { write: () => {} } }), /needs a folder/);
});

test("make, finish and intake read --library", async () => {
  const { runCli } = await import("../src/cli.js");
  const empty = await tempDir();
  const io = { stdout: { write: () => {} }, stderr: { write: () => {} } };
  await assert.rejects(runCli(["finish", empty, "--library", empty], io), /--library .*no launchclip\.library\.json/);
  await assert.rejects(runCli(["make", "a video", "--library", empty], io), /--library .*no launchclip\.library\.json/);
  await assert.rejects(runCli(["intake", "owner/repo", "--library", empty], io), /--library .*no launchclip\.library\.json/);
});

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkStorage, interruptedByStorage, mountPoint, StorageError, storageGone } from "../src/storage_check.js";

const tempDir = () => mkdtemp(path.join(os.tmpdir(), "launchclip-storage-"));
const plenty = { statfs: async () => ({ bavail: 500e9 / 4096, bsize: 4096 }) };

test("knows where removable drives mount", () => {
  assert.equal(mountPoint("/Volumes/Footage/launchclip/acme"), "/Volumes/Footage");
  assert.equal(mountPoint("/media/roger/Footage/x"), "/media/roger/Footage");
  assert.equal(mountPoint("/run/media/roger/Footage/x"), "/run/media/roger/Footage");
  assert.equal(mountPoint("/mnt/footage/x"), "/mnt/footage");
  assert.equal(mountPoint("/Users/roger/Videos"), null);
  assert.equal(mountPoint("/Volumes"), null);
});

test("passes a writable folder with room, creating it", async () => {
  const target = path.join(await tempDir(), "projects");
  const result = await checkStorage(target, { minFreeGb: 40 }, plenty);
  assert.equal(result.target, target);
  assert.equal(result.free_gb, 500);
  assert.ok(existsSync(target));
  assert.deepEqual(await readdir(target), [], "the write probe is removed");
});

test("fails on an unmounted drive without creating anything", async () => {
  const target = `/Volumes/launchclip-missing-${process.pid}/projects`;
  await assert.rejects(checkStorage(target, { label: "storage.projects", source: "/lib/launchclip.library.json" }, plenty), (error) => {
    assert.ok(error instanceof StorageError);
    assert.equal(error.code, "LAUNCHCLIP_STORAGE");
    assert.match(error.message, /^storage\.projects: \/Volumes\/launchclip-missing-\d+ is not mounted; connect the drive/);
    assert.match(error.message, /\/lib\/launchclip\.library\.json/);
    assert.doesNotMatch(error.message, /\n/);
    return true;
  });
});

test("fails when the folder cannot be written", { skip: process.getuid?.() === 0 }, async () => {
  const parent = await tempDir();
  await chmod(parent, 0o500);
  try {
    await assert.rejects(checkStorage(path.join(parent, "projects"), {}, plenty), /is not writable \(EACCES\)/);
  } finally {
    await chmod(parent, 0o700);
  }
});

test("fails when the drive has less than min_free_gb", async () => {
  const target = await tempDir();
  const tight = { statfs: async () => ({ bavail: 12.4e9 / 4096, bsize: 4096 }) };
  await assert.rejects(checkStorage(target, { minFreeGb: 40, source: "lib.json" }, tight), /has 12 GB free; a job needs 40 GB \(storage\.min_free_gb in lib\.json\)/);
  assert.equal((await checkStorage(target, { minFreeGb: 12 }, tight)).free_gb, 12.4);
});

test("reads real free space when no adapter is given", async () => {
  const result = await checkStorage(await tempDir());
  assert.ok(result.free_gb > 0);
});

test("notices a folder that disappears mid-job", async () => {
  const target = await tempDir();
  assert.equal(storageGone(target), null);
  assert.equal(interruptedByStorage(target, { command: "launchclip finish", stage: "render" }), null);
  await rm(target, { recursive: true });
  assert.match(storageGone(target), /disappeared$/);
  const error = interruptedByStorage(target, { command: "launchclip finish", stage: "render" });
  assert.ok(error instanceof StorageError);
  assert.match(error.message, /^launchclip finish stopped during render: .* disappeared\. Reconnect it and run the same command again/);
  assert.match(storageGone(`/Volumes/launchclip-missing-${process.pid}/x`), /was disconnected$/);
});

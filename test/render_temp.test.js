import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { systemTempDir, TEMP_FOLDER, useProjectTemp } from "../src/render_temp.js";

test("a render's temporary files go beside the project and are removed after", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "launchclip-render-temp-"));
  const project = path.join(parent, "launch");
  await mkdir(project);
  const env = { TMPDIR: "/system/tmp" };
  const temp = await useProjectTemp(project, env);
  assert.equal(path.dirname(temp.dir), path.join(parent, TEMP_FOLDER));
  assert.equal(env.TMPDIR, temp.dir);
  assert.equal(env.TMP, temp.dir);
  assert.equal(env.TEMP, temp.dir);
  await writeFile(path.join(temp.dir, "frame.png"), "x");
  await temp.release();
  assert.deepEqual(env, { TMPDIR: "/system/tmp" });
  assert.equal(existsSync(path.join(parent, TEMP_FOLDER)), false);
  assert.deepEqual(await readdir(parent), ["launch"]);
  await temp.release();
});

test("os.tmpdir() follows it while the system temp folder stays known", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "launchclip-render-temp-"));
  const project = path.join(parent, "launch");
  const before = os.tmpdir();
  const temp = await useProjectTemp(project);
  try {
    assert.equal(os.tmpdir(), temp.dir);
    assert.equal(systemTempDir(), before);
  } finally {
    await temp.release();
  }
  assert.equal(os.tmpdir(), before);
});

test("folders left by processes that are gone are removed; live ones are kept", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "launchclip-render-temp-"));
  const root = path.join(parent, TEMP_FOLDER);
  const child = spawn(process.execPath, ["-e", ""]);
  const deadPid = child.pid;
  await new Promise((resolve) => child.on("exit", resolve));
  await mkdir(path.join(root, `${deadPid}-abc`), { recursive: true });
  const live = path.join(root, `${process.ppid}-def`);
  await mkdir(live);
  const temp = await useProjectTemp(path.join(parent, "launch"), {});
  assert.equal(existsSync(path.join(root, `${deadPid}-abc`)), false);
  assert.ok(existsSync(live));
  await temp.release();
  assert.ok(existsSync(live), "another process's folder survives the release");
});

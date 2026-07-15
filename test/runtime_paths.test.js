import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stageBundledPublicAssets, workspacePublicRoot } from "../src/runtime_paths.js";

test("stages bundled public assets without overwriting workspace media", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-runtime-paths-"));
  const source = path.join(temp, "bundled-public");
  const workspace = path.join(temp, "workspace");
  const target = workspacePublicRoot(workspace);
  try {
    await mkdir(path.join(source, "icons"), { recursive: true });
    await mkdir(path.join(target, "icons"), { recursive: true });
    await writeFile(path.join(source, "icons", "bundled.svg"), "bundled");
    await writeFile(path.join(source, "icons", "preserved.svg"), "package-version");
    await writeFile(path.join(target, "icons", "preserved.svg"), "workspace-version");

    assert.equal(await stageBundledPublicAssets(workspace, { sourceRoot: source }), target);
    assert.equal(await readFile(path.join(target, "icons", "bundled.svg"), "utf8"), "bundled");
    assert.equal(await readFile(path.join(target, "icons", "preserved.svg"), "utf8"), "workspace-version");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

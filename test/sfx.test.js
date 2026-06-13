import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { REQUIRED_SFX_FILES, prepareSfxPack, validateSfxPack } from "../src/sfx.js";

test("SFX pack validation fails without required named files unless placeholders are allowed", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-sfx-"));
  try {
    const publicDir = path.join(temp, "public");
    await assert.rejects(
      prepareSfxPack({ publicDir }),
      /Missing required SFX/
    );

    const prepared = await prepareSfxPack({ publicDir, allowPlaceholder: true });
    assert.equal(prepared.generated.length, REQUIRED_SFX_FILES.length);
    const check = await validateSfxPack(path.join(publicDir, "sfx"));
    assert.equal(check.ok, true, check.missing.join(", "));
    const sample = await readFile(path.join(publicDir, "sfx", REQUIRED_SFX_FILES[0]));
    assert.equal(sample.subarray(0, 4).toString("ascii"), "RIFF");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("SFX pack validation copies a complete named pack into public/sfx", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-sfx-"));
  try {
    const packDir = path.join(temp, "pack");
    const publicDir = path.join(temp, "public");
    await mkdir(packDir, { recursive: true });
    for (const file of REQUIRED_SFX_FILES) {
      await writeFile(path.join(packDir, file), `fixture ${file}`);
    }

    const prepared = await prepareSfxPack({ sfxDir: packDir, publicDir });
    assert.equal(prepared.copied.length, REQUIRED_SFX_FILES.length);
    assert.deepEqual(prepared.generated, []);
    const check = await validateSfxPack(path.join(publicDir, "sfx"));
    assert.equal(check.ok, true, check.missing.join(", "));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

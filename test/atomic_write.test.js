// Collections RFC §5.4: cache files are written to a temporary name in the
// same folder and renamed, so concurrent processes see whole files or none.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { copyFileAtomic, temporaryBeside, writeFileAtomic } from "../src/atomic_write.js";
import { createTestVoiceProvider } from "../src/voice/index.js";
import { narrationRequest, synthesizeNarration } from "../src/voice/narrate.js";

const tempDir = () => mkdtemp(path.join(os.tmpdir(), "launchclip-atomic-"));

test("the temporary name sits in the same folder, keeps the extension and is unique", () => {
  const one = temporaryBeside("/cache/voice/abc.wav");
  const two = temporaryBeside("/cache/voice/abc.wav");
  assert.equal(path.dirname(one), "/cache/voice");
  assert.match(path.basename(one), /^abc\.[0-9a-f-]{36}\.tmp\.wav$/);
  assert.notEqual(one, two);
});

test("writeFileAtomic and copyFileAtomic leave only the final file", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "nested", "entry.json");
  await writeFileAtomic(file, "{}\n");
  assert.equal(await readFile(file, "utf8"), "{}\n");
  const copy = path.join(dir, "nested", "copy.json");
  await copyFileAtomic(file, copy);
  assert.deepEqual((await readdir(path.join(dir, "nested"))).sort(), ["copy.json", "entry.json"]);
});

test("a failed write leaves neither a partial file nor a temporary one", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "entry.wav");
  await assert.rejects(copyFileAtomic(path.join(dir, "missing.wav"), file));
  assert.deepEqual(await readdir(dir), []);
});

test("concurrent writers of one entry each land a whole file", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "take.wav");
  const bodies = Array.from({ length: 8 }, (_, index) => String(index).repeat(256 * 1024));
  await Promise.all(bodies.map((body) => writeFileAtomic(file, body)));
  assert.ok(bodies.includes(await readFile(file, "utf8")));
  assert.deepEqual(await readdir(dir), ["take.wav"]);
});

test("the voice cache is written whole: wav and metadata, no temporary files", async () => {
  const dir = await tempDir();
  const cacheDir = path.join(dir, "cache");
  const request = narrationRequest({ text: "One two three.", provider: "test" });
  const voiceProvider = () => createTestVoiceProvider();
  const take = await synthesizeNarration(request, { outFile: path.join(dir, "voice.wav"), cacheDir, voiceProvider });
  assert.equal(take.cached, false);
  assert.deepEqual((await readdir(cacheDir)).sort(), [`${take.cache_key}.json`, `${take.cache_key}.wav`]);
  await writeFile(path.join(dir, "voice.wav"), "");
  const again = await synthesizeNarration(request, { outFile: path.join(dir, "voice.wav"), cacheDir, voiceProvider });
  assert.equal(again.cached, true);
  assert.ok(existsSync(path.join(dir, "voice.wav")));
});

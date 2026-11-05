// A failed ffmpeg render in the audio kit leads with ffmpeg's own reason, not
// the (very long) command: a host's log line is cut before the reason otherwise.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SYNTH = path.resolve(import.meta.dirname, "../src/scripts/synth-audio-kit.mjs");

test("a failed kit render reports ffmpeg's reason up front", { skip: process.platform === "win32" }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lc-synth-error-"));
  try {
    const bin = path.join(dir, "bin");
    await execFileAsync("mkdir", [bin]);
    const fake = path.join(bin, "ffmpeg");
    await writeFile(fake, '#!/bin/sh\nfor a in "$@"; do [ "$a" = "-h" ] && exit 0; done\necho "Error initializing filters: Invalid argument" >&2\nexit 234\n');
    await chmod(fake, 0o755);
    const run = execFileAsync(process.execPath, [SYNTH, path.join(dir, "kit"), "--bed", "4", "--bpm", "96", "--key", "A"], { env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
    await assert.rejects(run, (error) => {
      const message = String(error.stderr).trim();
      assert.match(message, /^ffmpeg failed rendering .+ \(exit 234\): Error initializing filters: Invalid argument$/);
      assert.doesNotMatch(message, /aevalsrc/);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

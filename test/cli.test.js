import assert from "node:assert/strict";
import test from "node:test";
import { parseFlags } from "../src/cli.js";

test("parses boolean and value flags", () => {
  assert.deepEqual(parseFlags(["--provider", "hyperframes", "--dry-run", "--allow-placeholder-sfx", "--no-music", "--strict-all", "--inspect-samples", "15"]), {
    provider: "hyperframes",
    "dry-run": true,
    "allow-placeholder-sfx": true,
    "no-music": true,
    "strict-all": true,
    "inspect-samples": "15"
  });
});

test("requires flag values", () => {
  assert.throws(() => parseFlags(["--out"]), /Missing value/);
});

test("parses model-directed production control flags", () => {
  assert.deepEqual(parseFlags(["--no-audio", "--allow-timing-drift", "--foreground", "--concurrency", "4", "--voice-id", "voice_1"]), {
    "no-audio": true,
    "allow-timing-drift": true,
    foreground: true,
    concurrency: "4",
    "voice-id": "voice_1"
  });
});

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

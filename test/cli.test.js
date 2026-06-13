import assert from "node:assert/strict";
import test from "node:test";
import { parseFlags } from "../src/cli.js";

test("parses boolean and value flags", () => {
  assert.deepEqual(parseFlags(["--provider", "product-videogen", "--dry-run", "--allow-placeholder-sfx"]), {
    provider: "product-videogen",
    "dry-run": true,
    "allow-placeholder-sfx": true
  });
});

test("requires flag values", () => {
  assert.throws(() => parseFlags(["--out"]), /Missing value/);
});

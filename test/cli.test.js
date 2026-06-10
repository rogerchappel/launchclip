import assert from "node:assert/strict";
import test from "node:test";
import { parseFlags } from "../src/cli.js";

test("parses boolean and value flags", () => {
  assert.deepEqual(parseFlags(["--provider", "product-videogen", "--dry-run"]), {
    provider: "product-videogen",
    "dry-run": true
  });
});

test("requires flag values", () => {
  assert.throws(() => parseFlags(["--out"]), /Missing value/);
});

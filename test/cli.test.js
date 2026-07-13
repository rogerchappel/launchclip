import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseFlags, runCli } from "../src/cli.js";

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
  assert.deepEqual(parseFlags(["--no-audio", "--fast-eval", "--allow-timing-drift", "--allow-frame-fallback", "--foreground", "--approve", "--concurrency", "4", "--max-frame-cost-usd", "7.5", "--voice-id", "voice_1", "--assets", "./brand", "--style", "soft-grid-editorial", "--style-file", "./frame.md"]), {
    "no-audio": true,
    "fast-eval": true,
    "allow-timing-drift": true,
    "allow-frame-fallback": true,
    foreground: true,
    approve: true,
    concurrency: "4",
    "max-frame-cost-usd": "7.5",
    "voice-id": "voice_1",
    assets: "./brand",
    style: "soft-grid-editorial",
    "style-file": "./frame.md"
  });
});

test("includes a zero-cost tally in successful command JSON", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-cli-costs-"));
  const output = [];
  try {
    await runCli(["init", path.resolve("test/fixtures/sample-tool"), "--out", path.join(temp, "packet")], {
      stdout: { write: (value) => output.push(value) }
    });
    const result = JSON.parse(output.join(""));
    assert.equal(result.stage, "init");
    assert.deepEqual(result.costs, {
      schema_version: "launchclip.costs.v1",
      currency: "USD",
      pricing_basis: "public-pay-as-you-go-estimate",
      pricing_as_of: "2026-07-13",
      total_usd: 0,
      complete: true,
      calls: 0,
      by_provider: {},
      line_items: [],
      warnings: []
    });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("attaches the accrued cost tally to command failures", async () => {
  await assert.rejects(
    () => runCli(["init"], { stdout: { write: () => {} } }),
    (error) => {
      assert.match(error.message, /Missing repo path/);
      assert.equal(error.costs.total_usd, 0);
      assert.equal(error.costs.complete, true);
      return true;
    }
  );
});

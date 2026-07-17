import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseFlags, runCli } from "../src/cli.js";
import { diagnoseInstallation, VERSION } from "../src/doctor.js";

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

test("prints the package version without initializing runtime services", async () => {
  const output = [];
  await runCli(["--version"], { stdout: { write: (value) => output.push(value) } });
  assert.equal(output.join(""), `${VERSION}\n`);
});

test("doctor reports package, tool, and credential readiness without exposing secrets", async () => {
  const report = await diagnoseInstallation({
    nodeVersion: "v21.9.0",
    env: { OPENAI_API_KEY: "do-not-print-this" },
    commandAvailable: async (command) => command === "ffmpeg",
    fileAvailable: async () => true
  });
  assert.equal(report.status, "not-ready");
  assert.equal(report.runtime.supported, false);
  assert.equal(report.tools.ffmpeg.available, true);
  assert.equal(report.tools.ffprobe.available, false);
  assert.equal(report.credentials.openai_api_key, true);
  assert.equal(report.modes.subscription_agent.requires_api_key, false);
  assert.equal(JSON.stringify(report).includes("do-not-print-this"), false);

  const output = [];
  await runCli(["doctor"], {
    stdout: { write: (value) => output.push(value) },
    doctor: async () => report
  });
  assert.equal(JSON.parse(output.join("")).stage, "doctor");
});

test("parses model-directed production control flags", () => {
  assert.deepEqual(parseFlags(["--no-audio", "--fast-eval", "--allow-timing-drift", "--allow-frame-fallback", "--repair-scoped-source", "--refresh-free-models", "--free-model-candidates", "5", "--free-model-state", "./free-models.json", "--foreground", "--approve", "--concurrency", "4", "--max-frame-cost-usd", "7.5", "--voice-id", "voice_1", "--assets", "./brand", "--style", "soft-grid-editorial", "--style-file", "./frame.md"]), {
    "no-audio": true,
    "fast-eval": true,
    "allow-timing-drift": true,
    "allow-frame-fallback": true,
    "repair-scoped-source": true,
    "refresh-free-models": true,
    "free-model-candidates": "5",
    "free-model-state": "./free-models.json",
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

test("parses Studio preview controls", () => {
  assert.deepEqual(parseFlags(["--port", "3111", "--no-open", "--review"]), {
    port: "3111",
    "no-open": true,
    review: true
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

test("documents independently rerunnable source and entity preparation stages", async () => {
  const output = [];
  await runCli(["--help"], { stdout: { write: (value) => output.push(value) } });
  const help = output.join("");
  assert.match(help, /source-preprocess <workspace>/);
  assert.match(help, /resolve-entities <workspace>/);
  assert.match(help, /--brand-assets-dir path/);
  assert.match(help, /--no-trim-silence/);
});

test("documents the Studio preview approval stage", async () => {
  const output = [];
  await runCli(["--help"], { stdout: { write: (value) => output.push(value) } });
  assert.match(output.join(""), /production-preview <workspace> \[--port 3002\] \[--no-open\]/);
  assert.match(output.join(""), /production-repair <workspace>.*\[--repair-scoped-source\]/);
  assert.match(output.join(""), /produce <source>.*\[--review\]/);
  assert.match(output.join(""), /produce <source>.*\[--critic-route provider:model@reasoning\]/);
  assert.match(output.join(""), /review <workspace> \[--port 3002\]/);
  assert.match(output.join(""), /production-critique <workspace> \[--critic-route provider:model@reasoning\]/);
});

test("routes review to the interactive production flow for production workspaces", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-cli-review-"));
  await mkdir(path.join(workspace, "production"));
  await writeFile(path.join(workspace, "production", "intake.json"), "{}\n");
  const output = [];
  const result = { stage: "production-review", status: "awaiting-approval", action: "saved" };
  await runCli(["review", workspace, "--no-open"], {
    stdout: { write: (value) => output.push(value) },
    productionAdapters: { runProductionReview: async (_target, _options, controls) => {
      assert.equal(typeof controls.openPreview, "function");
      return result;
    } }
  });
  assert.equal(JSON.parse(output.join("")).stage, "production-review");
});

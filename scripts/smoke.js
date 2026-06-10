import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../src/cli.js";

const fixtureRepo = path.resolve("test/fixtures/sample-tool");
const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-smoke-"));
const out = path.join(temp, "sample-tool");

try {
  await runCli([
    "run",
    fixtureRepo,
    "--out",
    out,
    "--demo-cmd",
    "npm run smoke",
    "--angle",
    "turns demo proof into launch content",
    "--audience",
    "developers shipping small OSS tools",
    "--cta-url",
    "https://github.com/rogerchappel/sample-tool"
  ], quietIo());
  await runCli(["validate", out], quietIo());

  const review = await readFile(path.join(out, "REVIEW.md"), "utf8");
  if (!review.includes("Product-Videogen Follow-Up")) {
    throw new Error("Smoke review packet missing product-videogen follow-up");
  }
  if (!review.includes("Social readiness: ready")) {
    throw new Error("Smoke review packet is not social-ready");
  }
  console.log(`smoke ok: ${out}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}

function quietIo() {
  return { stdout: { write() {} } };
}

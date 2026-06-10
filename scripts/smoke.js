import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../src/cli.js";

const fixtureRepo = path.resolve("test/fixtures/sample-tool");
const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-smoke-"));
const out = path.join(temp, "sample-tool");

try {
  await runCli(["init", fixtureRepo, "--out", out], quietIo());
  await runCli(["demo", fixtureRepo, "--out", out, "--demo-cmd", "npm run smoke", "--capture", "terminal"], quietIo());
  await runCli(["plan", out, "--format", "short-30", "--renderer", "none"], quietIo());
  await runCli(["captions", out, "--platforms", "x,linkedin,tiktok,bluesky"], quietIo());
  await runCli(["render", out, "--provider", "product-videogen", "--dry-run"], quietIo());
  await runCli(["submit-review", out, "--provider", "product-videogen", "--dry-run"], quietIo());
  await runCli(["review", out], quietIo());

  const review = await readFile(path.join(out, "REVIEW.md"), "utf8");
  if (!review.includes("Product-Videogen Follow-Up")) {
    throw new Error("Smoke review packet missing product-videogen follow-up");
  }
  console.log(`smoke ok: ${out}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}

function quietIo() {
  return { stdout: { write() {} } };
}

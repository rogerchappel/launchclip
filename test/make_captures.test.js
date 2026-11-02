// make records research's capture requests (src/make/captures.js): through an
// app's command (JSON lines, concurrent, answers in any order) or the local
// recorder; a clip already on disk is kept, and a failure never fails make.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { captureFiles, readCaptureRequests, recordCaptures } from "../src/make/captures.js";

const request = (id, extra = {}) => ({ schema: "launchclip.capture.v1", id, url: `https://example.com/${id}`, kind: "page", out: `assets/evidence/${id}.mp4`, ...extra });

// A fake app recorder: answers in reverse order of arrival, writes the files where it was told, refuses "blocked", never answers "silent".
const COMMAND = `
const fs = require("node:fs"), path = require("node:path");
const pending = [];
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, request, out_dir } = JSON.parse(line);
  if (id === "silent") return;
  pending.push({ id, out_dir });
  if (id === "blocked") { process.stdout.write(JSON.stringify({ id, ok: false, reason: "a sign-in wall" }) + "\\n"); return; }
  if (pending.filter((entry) => entry.id !== "blocked").length < 2) return;
  for (const entry of pending.reverse()) {
    if (entry.id === "blocked") continue;
    const files = {};
    for (const [key, name] of [["clip", entry.id + ".mp4"], ["poster", entry.id + ".poster.png"], ["sidecar", entry.id + ".evidence.json"]]) {
      files[key] = path.join(entry.out_dir, name);
      fs.writeFileSync(files[key], key === "sidecar" ? JSON.stringify({ id: entry.id }) : "x");
    }
    process.stdout.write(JSON.stringify({ id: entry.id, ok: true, files, usage: { seconds: 2.5 } }) + "\\n");
  }
  pending.length = 0;
});
`;

async function project() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-captures-"));
  await writeFile(path.join(dir, "recorder.cjs"), COMMAND);
  return dir;
}

test("the app's capture command records requests concurrently, answers matched by id in any order", async () => {
  const dir = await project();
  try {
    const lines = [];
    const result = await recordCaptures([request("a"), request("b"), request("blocked")], { project: dir, command: `node ${path.join(dir, "recorder.cjs")}`, concurrency: 3, say: (line) => lines.push(line) });
    assert.deepEqual(result.recorded.map((entry) => entry.id), ["a", "b"]);
    assert.deepEqual(result.failed, [{ id: "blocked", url: "https://example.com/blocked", reason: "a sign-in wall" }]);
    assert.deepEqual(result.usage, { seconds: 5 });
    for (const id of ["a", "b"]) assert.equal(JSON.parse(await readFile(path.join(dir, captureFiles(request(id)).sidecar), "utf8")).id, id);
    assert.ok(lines.some((line) => /recording 3 source pages \(app recorder, 3 at a time\)/.test(line)), lines.join("\n"));
    // A second run keeps what is on disk and records nothing.
    const again = await recordCaptures([request("a"), request("b")], { project: dir, command: "exit 1" });
    assert.equal(again.reused, 2);
    assert.deepEqual(again.failed, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a request the command never answers times out; a command that exits fails what is open", async () => {
  const dir = await project();
  try {
    const silent = await recordCaptures([request("silent")], { project: dir, command: `node ${path.join(dir, "recorder.cjs")}`, timeoutMs: 300 });
    assert.match(silent.failed[0].reason, /no answer from the capture command/);
    const gone = await recordCaptures([request("c")], { project: dir, command: "exit 3" });
    assert.match(gone.failed[0].reason, /exited/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the local recorder writes into the project; requests are read from research/captures", async () => {
  const dir = await project();
  try {
    await mkdir(path.join(dir, "research", "captures"), { recursive: true });
    for (const id of ["two", "one"]) await writeFile(path.join(dir, "research", "captures", `${id}.json`), JSON.stringify(request(id)));
    await writeFile(path.join(dir, "research", "captures", "broken.json"), "{");
    const requests = await readCaptureRequests(dir);
    assert.deepEqual(requests.map((entry) => entry.id), ["one", "two"]);
    const seen = [];
    const capture = async (input, { root }) => {
      seen.push(input.id);
      if (input.id === "two") throw new Error("HTTP 403");
      const files = captureFiles(input);
      await mkdir(path.join(root, "assets", "evidence"), { recursive: true });
      for (const file of [files.clip, files.sidecar]) await writeFile(path.join(root, file), "{}");
    };
    const result = await recordCaptures(requests, { project: dir, capture });
    assert.deepEqual(seen.sort(), ["one", "two"]);
    assert.deepEqual(result.recorded.map((entry) => entry.id), ["one"]);
    assert.equal(result.failed[0].reason, "HTTP 403");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("every capture opens with the same desktop Chrome profile: real version, no headless mark, US English, UTC", async () => {
  const { captureProfile } = await import("../src/evidence/capture.js");
  const viewport = { width: 1280, height: 800 };
  const linux = captureProfile("131.0.6778.33", { platform: "linux", viewport, theme: "dark" });
  assert.equal(linux.userAgent, "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
  assert.doesNotMatch(linux.userAgent, /Headless/);
  assert.deepEqual({ locale: linux.locale, timezoneId: linux.timezoneId, deviceScaleFactor: linux.deviceScaleFactor, colorScheme: linux.colorScheme, screen: linux.screen }, { locale: "en-US", timezoneId: "UTC", deviceScaleFactor: 2, colorScheme: "dark", screen: viewport });
  assert.equal(linux.extraHTTPHeaders["Accept-Language"], "en-US,en;q=0.9");
  assert.equal(linux.acceptDownloads, false);
  assert.match(captureProfile("131.0.6778.33", { platform: "darwin", viewport }).userAgent, /Macintosh; Intel Mac OS X 10_15_7/);
});

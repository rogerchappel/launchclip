import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { verifyFrameCandidate } from "../src/frame_candidate_verify.js";

test("passes a checked candidate with meaningful snapshots", async () => {
  const workspace = await fixture();
  const result = await verifyFrameCandidate(workspace, bundle(), context("pass-1"), { run: snapshotRun("detailed") });
  assert.equal(result.ok, true);
  assert.equal(result.frames.length, 3);
  assert.ok(result.frames.every((frame) => frame.blank === false));
  const report = JSON.parse(await readFile(result.report, "utf8"));
  assert.equal(report.status, "passed");
});

test("rejects a candidate when every real timeline snapshot is flat", async () => {
  const workspace = await fixture();
  const result = await verifyFrameCandidate(workspace, bundle(), context("blank-1"), { run: snapshotRun("blank") });
  assert.equal(result.ok, false);
  assert.equal(result.failure_kind, "content");
  assert.match(result.error, /visually blank/);
  assert.ok(result.frames.every((frame) => frame.blank));
});

test("fails before snapshots when HyperFrames reports a browser defect", async () => {
  const workspace = await fixture();
  let snapshots = 0;
  const run = async (_command, args) => {
    if (args[1] === "check") return { stdout: JSON.stringify({ ok: false, findings: [{ severity: "error", message: "mount failed" }] }), stderr: "" };
    snapshots += 1;
    return { stdout: "", stderr: "" };
  };
  const result = await verifyFrameCandidate(workspace, bundle(), context("invalid-1"), { run });
  assert.equal(result.ok, false);
  assert.match(result.error, /mount failed/);
  assert.equal(snapshots, 0);
});

test("reports the actionable nested HyperFrames finding", async () => {
  const workspace = await fixture();
  const run = async () => {
    const error = new Error("check failed");
    error.code = 1;
    error.stdout = JSON.stringify({ ok: false, motion: { findings: [{ severity: "error", code: "motion_spec_invalid", message: "motion assertion is invalid" }] } });
    throw error;
  };
  const result = await verifyFrameCandidate(workspace, bundle(), context("nested-1"), { run });
  assert.equal(result.ok, false);
  assert.equal(result.error, "motion assertion is invalid");
});

function context(attempt) {
  return { attempt, shot: { id: "shot-1", start_seconds: 0, end_seconds: 5 }, format: { width: 1080, height: 1920, language: "en" } };
}

function bundle() {
  return {
    shot_id: "shot-1",
    html: '<!doctype html><html><body><template><style>#root{background:#eee}</style><div id="root" data-composition-id="shot-1"></div><script></script></template></body></html>',
    motion: { assertions: [], events: [] }
  };
}

async function fixture() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-candidate-"));
  await mkdir(path.join(workspace, "production", "hyperframes", "assets"), { recursive: true });
  return workspace;
}

function snapshotRun(kind) {
  return async (_command, args) => {
    const command = args[1];
    if (command === "check") return { stdout: JSON.stringify({ ok: true, findings: [] }), stderr: "" };
    if (command === "snapshot") {
      const output = args[args.indexOf("--output") + 1];
      await mkdir(output, { recursive: true });
      for (let index = 0; index < 3; index += 1) {
        const image = kind === "blank"
          ? png(30, 50, () => [238, 232, 216, 255])
          : png(30, 50, (x, y) => x > 4 && x < 25 && y > 10 && y < 40 ? [20, 24, 30, 255] : [238, 232, 216, 255]);
        await writeFile(path.join(output, `frame-0${index}-at-${index}s.png`), image);
      }
      return { stdout: "snapshots saved", stderr: "" };
    }
    throw new Error(`Unexpected command: ${command}`);
  };
}

function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) Buffer.from(pixel(x, y)).copy(raw, row + 1 + x * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type), data, Buffer.alloc(4)]);
}

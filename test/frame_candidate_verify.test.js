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

test("rejects an incremental candidate that does not improve a baseline finding", async () => {
  const workspace = await fixture();
  const run = comparativeRun((role) => role === "baseline" || role === "candidate"
    ? [{ severity: "error", code: "motion_frozen", selector: "#proof", message: "proof is static" }]
    : []);
  const result = await verifyFrameCandidate(workspace, bundle(), { ...context("incremental-1"), baseline: bundle() }, { run });
  assert.equal(result.ok, false);
  assert.match(result.error, /did not resolve or reduce/);
  assert.match(result.error, /motion_frozen on #proof: proof is static/);
  const comparison = JSON.parse(await readFile(result.report, "utf8")).comparison;
  assert.deepEqual(comparison.new_findings, []);
  assert.deepEqual(comparison.remaining_findings, ["motion_frozen on #proof: proof is static"]);
});

test("accepts an incremental candidate that resolves one baseline finding", async () => {
  const workspace = await fixture();
  const run = comparativeRun((role) => role === "baseline"
    ? [
        { severity: "error", code: "motion_frozen", selector: "#proof", message: "proof is static" },
        { severity: "error", code: "text_occluded", selector: "#copy", message: "copy is hidden" }
      ]
    : [{ severity: "error", code: "text_occluded", selector: "#copy", message: "copy is hidden" }]);
  const result = await verifyFrameCandidate(workspace, bundle(), { ...context("incremental-improved-1"), baseline: bundle() }, { run });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(await readFile(result.report, "utf8")).comparison.improved_findings, ["motion_frozen|#proof"]);
});

test("stages candidates with assembled fonts and native HyperFrames motion", async () => {
  const workspace = await fixture();
  const assembled = path.join(workspace, "production", "hyperframes", "compositions");
  await mkdir(assembled, { recursive: true });
  await writeFile(path.join(assembled, "shot-1.html"), '<style>@font-face { font-family: "Proof Sans"; src: url("assets/proof.woff2") format("woff2"); }</style>');
  await writeFile(path.join(workspace, "production", "hyperframes", "assets", "proof.woff2"), "font");
  const candidate = { ...bundle(), motion: { assertions: [{ selector: "#proof", appears_by_seconds: 1, order: null, must_stay_in_frame: true, must_remain_live: false }], events: [] } };
  const run = async (_command, args) => {
    if (args[1] === "check") {
      const project = String(args.at(-1));
      const [html, motion] = await Promise.all([
        readFile(path.join(project, "compositions", "shot.html"), "utf8"),
        readFile(path.join(project, "index.motion.json"), "utf8").then(JSON.parse)
      ]);
      assert.match(html, /font-family: "Proof Sans"/);
      assert.match(html, /data-launchclip-text-containment="v6"/);
      assert.deepEqual(motion.assertions.map((entry) => entry.kind), ["appearsBy", "staysInFrame"]);
      return { stdout: JSON.stringify({ ok: true, findings: [] }), stderr: "" };
    }
    return snapshotRun("detailed")(_command, args);
  };
  const result = await verifyFrameCandidate(workspace, candidate, context("assembled-contract-1"), { run });
  assert.equal(result.ok, true);
});

test("rejects an incremental candidate that introduces a browser finding", async () => {
  const workspace = await fixture();
  const run = comparativeRun((role) => role === "baseline"
    ? [{ severity: "error", code: "motion_frozen", selector: "#proof", message: "proof is static" }]
    : [
        { severity: "error", code: "motion_frozen", selector: "#proof", message: "proof is static" },
        { severity: "error", code: "console_error", selector: "[data-composition-id]", message: "runtime failed" }
      ]);
  const result = await verifyFrameCandidate(workspace, bundle(), { ...context("regression-1"), baseline: bundle() }, { run });
  assert.equal(result.ok, false);
  assert.match(result.error, /introduced or worsened/);
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

function comparativeRun(findingsFor) {
  return async (_command, args) => {
    const command = args[1];
    const project = String(args.at(-1));
    const role = project.includes(`${path.sep}baseline${path.sep}`) ? "baseline" : "candidate";
    if (command === "check") return { stdout: JSON.stringify({ ok: false, motion: { findings: findingsFor(role) } }), stderr: "" };
    if (command === "snapshot") {
      const output = args[args.indexOf("--output") + 1];
      await mkdir(output, { recursive: true });
      for (let index = 0; index < 3; index += 1) {
        await writeFile(path.join(output, `frame-0${index}-at-${index}s.png`), png(30, 50, (x, y) => x > 4 && x < 25 && y > 10 && y < 40 ? [20, 24, 30, 255] : [238, 232, 216, 255]));
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

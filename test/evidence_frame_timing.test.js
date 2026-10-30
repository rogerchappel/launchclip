// Evidence pairs show the same frame (blind test 2: the encoded draft ran 1–5
// frames ahead of the browser stills at transition midpoints). The encoded
// frame came from `ffmpeg -ss t`, which returns ceil(t × fps), while Remotion
// stills used round(t × fps) and HyperFrames snapshots floor(t × fps). Both
// sides now take frame round(t × fps): Remotion --frame=N, HyperFrames a
// snapshot time inside frame N, and ffmpeg select=eq(n,N).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { encodedFrameArgs, evidenceFrame, remotionStillArgs, snapshotTime } from "../src/scripts/build-evidence.mjs";

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();

test("one frame index per sample, shared by every still and the encoded frame", () => {
  assert.equal(evidenceFrame(1.705, 30), 51);
  assert.equal(evidenceFrame(4.916, 30), 147);
  assert.equal(evidenceFrame(0.25, 30), 8);
  assert.equal(evidenceFrame(22.9, 30, 22.8), 683, "clamped to the last frame");
  // HyperFrames snapshot floors seconds × fps: the snapshot time lands inside frame N.
  for (let frame = 0; frame < 2000; frame += 7) assert.equal(Math.floor(snapshotTime(frame, 30) * 30), frame);
  for (let frame = 0; frame < 2000; frame += 11) assert.equal(Math.floor(snapshotTime(frame, 24) * 24), frame);
  assert.ok(remotionStillArgs({ serveUrl: "b", propsFile: "p", project: ".", frame: 51, output: "o" }).includes("--frame=51"));
  const args = encodedFrameArgs("draft.mp4", 51, "out.png");
  assert.ok(args.includes("select=eq(n\\,51)"));
  assert.ok(!args.includes("-ss"), "never seek by time");
  assert.equal(args[args.indexOf("-threads") + 1], "1", "one encoder thread for one PNG");
});

test("the encoded frame is exactly frame N, where -ss picked the next frame", { skip: hasFfmpeg ? false : "needs ffmpeg" }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lc-evidence-frames-"));
  try {
    // 20 frames at 30 fps, frame n a distinct flat grey (lossless).
    const video = path.join(dir, "draft.mp4");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:r=30:d=0.6667", "-vf", "geq=lum='10+12*N':cb=128:cr=128", "-c:v", "libx264", "-qp", "0", "-pix_fmt", "yuv444p", "-frames:v", "20", "-y", video]);
    const luma = (args) => execFileSync("ffmpeg", [...args.slice(0, -2), "-f", "rawvideo", "-pix_fmt", "gray", "-"].filter((arg) => arg !== "-y"), { maxBuffer: 1 << 20 })[64 * 32 + 32];
    // Every frame's level, from one full decode (distinct per frame).
    const all = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", video, "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 1 << 22 });
    const level = (n) => all[n * 64 * 64 + 64 * 32 + 32];
    assert.equal(new Set(Array.from({ length: 20 }, (_, n) => level(n))).size, 20);
    for (const t of [0.1, 0.2, 0.25, 0.3167, 0.4]) {
      const n = evidenceFrame(t, 30);
      assert.equal(luma(encodedFrameArgs(video, n, "x.png")), level(n), `t=${t}: frame ${n}`);
    }
    // The old path: -ss 0.31 (9.3 frames) returns frame 10, the first frame at
    // or after t, one ahead of round(t × fps) = 9.
    const seek = (t) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", video, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 1 << 20 })[64 * 32 + 32];
    assert.equal(seek(0.31), level(10));
    assert.equal(luma(encodedFrameArgs(video, evidenceFrame(0.31, 30), "x.png")), level(9));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

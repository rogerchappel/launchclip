import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ffmpegMissing, mediaSkip } from "./helpers/media.js";
import { masterFilter, masterLoudness, nextLimit, preGain } from "../src/scripts/master-loudness.mjs";

test("the master chain runs loudnorm, then a 4x oversampled limiter that keeps sounds on their frames", () => {
  const chain = masterFilter({ loudnorm: "loudnorm=I=-14", limit: -1.6, pad: 4 });
  assert.match(chain, /^loudnorm=I=-14,aresample=192000,alimiter=limit=0\.831764:attack=10:release=200:level=disabled:latency=1,aresample=48000,apad=whole_dur=4$/);
  assert.match(masterFilter({ gain: -24.2, limit: -1.6 }), /^volume=-24\.2dB,aresample=192000/);
});

test("a peak over the ceiling lowers the limiter by the overshoot plus a margin; a compliant peak stops", () => {
  assert.equal(nextLimit(-1.6, -0.8, -1), -2.1);
  assert.equal(nextLimit(-1.6, -1.2, -1), null);
});

test("a silent mix is not normalised and a mix over 0 LUFS is turned down to the target first", () => {
  assert.deepEqual(preGain(-Infinity, -14), { silent: true, gain: 0 });
  assert.deepEqual(preGain(-75, -14), { silent: true, gain: 0 });
  assert.deepEqual(preGain(4.5, -14), { silent: false, gain: -18.5 });
  assert.deepEqual(preGain(-20, -14), { silent: false, gain: 0 });
});

test("delivery measures -14 ± 1 LUFS and at most -1 dBTP after AAC, for a peaky, a too-loud, a short and a silent mix", { skip: mediaSkip(ffmpegMissing()) }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-master-"));
  try {
    const clip = (name, audio) => {
      const file = path.join(dir, `${name}.mov`);
      execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=6:r=30", "-f", "lavfi", "-i", audio, "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "pcm_f32le", file]);
      return file;
    };
    // Square-ish clicks over a tone: inter-sample peaks the limiter must catch.
    const peaky = clip("peaky", "aevalsrc=0.25*sin(2*PI*220*t)+0.7*lt(mod(t\\,0.5)\\,0.004)*sin(2*PI*5000*t):s=48000:d=6");
    const loud = clip("loud", "anoisesrc=a=1:d=6:r=48000,volume=12dB");
    const short = clip("short", "aevalsrc=0.3*sin(2*PI*330*t):s=48000:d=3");
    const silent = clip("silent", "anullsrc=r=48000:cl=stereo");
    for (const [name, file] of Object.entries({ peaky, loud, short })) {
      const result = await masterLoudness(file, path.join(dir, `${name}.mp4`));
      assert.ok(Math.abs(result.output.integrated_lufs + 14) <= 1, `${name}: ${result.output.integrated_lufs} LUFS`);
      assert.ok(result.output.true_peak_dbtp <= -1, `${name}: ${result.output.true_peak_dbtp} dBTP`);
      assert.equal(result.compliant, true);
    }
    const loudResult = await masterLoudness(loud, path.join(dir, "loud.mp4"));
    assert.ok(loudResult.pre_gain_db < -20 && loudResult.warnings.some((line) => /louder than 0/.test(line)));
    const shortResult = await masterLoudness(short, path.join(dir, "short.mp4"));
    assert.equal(shortResult.padded_to_seconds, 6);
    const audioSeconds = Number(execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=duration", "-of", "csv=p=0", path.join(dir, "short.mp4")]).toString());
    assert.ok(audioSeconds >= 5.95, `the audio is padded to the picture (${audioSeconds} s)`);
    const silentResult = await masterLoudness(silent, path.join(dir, "silent.mp4"));
    assert.equal(silentResult.skipped, "silent");
    assert.ok(silentResult.warnings.some((line) => /silent/.test(line)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

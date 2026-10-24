import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { flatRatio, inventoryAssets, isUiLike, speechFromSilence, wordsFromTranscript } from "../src/make/assets.js";
import { createTestVoiceProvider } from "../src/voice/index.js";

const run = promisify(execFile);

async function ffmpegAvailable() {
  try { await run("ffmpeg", ["-version"]); await run("ffprobe", ["-version"]); return true; } catch { return false; }
}

const ff = (...args) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

// Three test-voice phrases with 0.7 s pauses between them: speech-shaped audio
// (voiced, with phrase pauses) and no network or model.
async function speechWav(dir, name) {
  const voice = createTestVoiceProvider();
  const parts = [];
  for (const [i, text] of ["Ledgerly matches every payout", "to the invoices it pays", "so month end takes minutes"].entries()) {
    const file = path.join(dir, `phrase-${name}-${i}.wav`);
    await voice.synthesize({ text, outFile: file });
    parts.push(file);
  }
  const out = path.join(dir, name);
  await ff(...parts.flatMap((file) => ["-i", file]), "-filter_complex", `${parts.map((_, i) => `[${i}]apad=pad_dur=0.7[p${i}]`).join(";")};${parts.map((_, i) => `[p${i}]`).join("")}concat=n=${parts.length}:v=0:a=1`, "-ar", "24000", out);
  for (const file of parts) await rm(file);
  return out;
}

// A fake Whisper: about 2.5 words a second of plausible words.
async function fakeTranscribe(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  const duration = Number(stdout);
  const words = [];
  for (let t = 0.2; t < duration - 0.4; t += 0.4) words.push({ word: ` w${words.length}`, start: t, end: t + 0.3 });
  return { text: words.map((word) => word.word).join(""), segments: [{ words }] };
}

test("inventory classifies a logo, a UI-like silent clip, a speech clip and a voiceover", { timeout: 120_000 }, async (t) => {
  if (!(await ffmpegAvailable())) { t.skip("ffmpeg is unavailable"); return; }
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-assets-"));
  try {
    // Logo: small, square, transparent, and no filename hint (the pixel rule decides).
    await ff("-f", "lavfi", "-i", "color=c=black@0.0:s=512x512,format=rgba", "-vf", "drawbox=x=96:y=96:w=320:h=320:color=0x2e7dff@1:t=fill", "-frames:v", "1", path.join(dir, "acme.png"));
    // Screenshot: large and wide.
    await ff("-f", "lavfi", "-i", "testsrc=s=1600x900", "-frames:v", "1", path.join(dir, "home.png"));
    // UI-like silent clip with no filename hint.
    await ff("-f", "lavfi", "-i", "testsrc=s=1280x720:r=30", "-t", "4", "-pix_fmt", "yuv420p", path.join(dir, "clip.mp4"));
    // Speech clip: test-voice phrases over noisy, camera-like video.
    const speech = await speechWav(dir, "speech.wav");
    await ff("-f", "lavfi", "-i", "color=c=0x806040:s=640x360:r=30,noise=alls=40:allf=t", "-i", speech, "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(dir, "take.mp4"));
    await rm(speech);
    // Voiceover WAV with no filename hint, and a music bed (a steady tone).
    await speechWav(dir, "take-02.wav");
    await ff("-f", "lavfi", "-i", "sine=f=220:d=8", path.join(dir, "bed-loop.wav"));
    await writeFile(path.join(dir, "notes.md"), "# Ledgerly\nReconciles Stripe payouts against invoices.\n");
    await writeFile(path.join(dir, "brand.json"), JSON.stringify({ name: "Ledgerly", colors: { primary: "#2e7dff" } }));

    let transcribed = 0;
    const inventory = await inventoryAssets(dir, { transcribe: async (file) => { transcribed += 1; return fakeTranscribe(file); } });
    const by = Object.fromEntries(inventory.entries.map((entry) => [entry.path, entry]));
    assert.equal(by["acme.png"].role, "logo", JSON.stringify(by["acme.png"]));
    assert.ok(by["acme.png"].signals.includes("alpha"));
    assert.equal(by["home.png"].role, "screenshot");
    assert.equal(by["clip.mp4"].role, "screen-recording", JSON.stringify(by["clip.mp4"]));
    assert.equal(by["clip.mp4"].speech.present, false);
    assert.equal(by["clip.mp4"].visual.ui_like, true);
    assert.equal(by["take.mp4"].role, "talking-head", JSON.stringify(by["take.mp4"]));
    assert.equal(by["take.mp4"].speech.present, true);
    assert.ok(by["take.mp4"].transcript.words.length > 5);
    assert.equal(by["take-02.wav"].role, "voiceover", JSON.stringify(by["take-02.wav"]));
    assert.equal(by["bed-loop.wav"].role, "music");
    assert.equal(by["notes.md"].kind, "notes");
    assert.equal(by["brand.json"].kind, "brand");
    assert.equal(transcribed, 2, "only the speech clip and the voiceover are transcribed");
    for (const entry of inventory.entries) {
      assert.ok(entry.confidence > 0 && entry.confidence <= 1, entry.path);
      assert.ok(entry.description.length > 8, entry.path);
    }
    assert.equal(by["take.mp4"].media.duration > 3, true);
    assert.equal(by["home.png"].media.width, 1600);

    // A second inventory reuses unchanged entries (no new transcription).
    const again = await inventoryAssets(dir, { cache: inventory, transcribe: async () => { transcribed += 1; return null; } });
    assert.equal(transcribed, 2);
    assert.deepEqual(again.entries.map((entry) => entry.role), inventory.entries.map((entry) => entry.role));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("speech, flatness and transcript helpers", () => {
  // 10 s clip, voiced except three pauses: speech.
  const speech = speechFromSilence("silence_start: 2.1\nsilence_end: 2.6 | silence_duration: 0.5\nsilence_start: 5\nsilence_end: 5.6 | silence_duration: 0.6\nsilence_start: 7.5\nsilence_end: 8 | silence_duration: 0.5\n", 10);
  assert.equal(speech.speech, true);
  assert.equal(speech.pauses, 3);
  // A steady bed: voiced throughout.
  assert.equal(speechFromSilence("", 10).speech, false);
  // Silent: one silence covering everything.
  assert.equal(speechFromSilence("silence_start: 0\nsilence_end: 10 | silence_duration: 10\n", 10).speech, false);
  const flat = new Uint8Array(16).fill(10);
  assert.equal(flatRatio(flat, 4, 4), 1);
  assert.equal(isUiLike({ flat_ratio: 0.9, edge_ratio: 0.03 }), false, "a soft, flat set is not UI");
  assert.equal(isUiLike({ flat_ratio: 0.7, edge_ratio: 0.14 }), true);
  assert.deepEqual(wordsFromTranscript({ segments: [{ words: [{ word: " Hi", start: 0.1, end: 0.3 }] }] }), [{ text: "Hi", start: 0.1, end: 0.3 }]);
});

test("inventory follows symlinks to files and folders, and skips broken ones", { timeout: 60_000 }, async (t) => {
  if (!(await ffmpegAvailable())) { t.skip("ffmpeg is unavailable"); return; }
  const real = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-assets-real-"));
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-assets-links-"));
  try {
    await ff("-f", "lavfi", "-i", "testsrc=s=1600x900", "-frames:v", "1", path.join(real, "home.png"));
    await mkdir(path.join(real, "shots"));
    await ff("-f", "lavfi", "-i", "testsrc=s=1600x900", "-frames:v", "1", path.join(real, "shots", "pricing.png"));
    await symlink(path.join(real, "home.png"), path.join(dir, "home.png"));
    await symlink(path.join(real, "shots"), path.join(dir, "shots"));
    await symlink(path.join(real, "missing.mp4"), path.join(dir, "missing.mp4"));
    const inventory = await inventoryAssets(dir, { transcribe: async () => null });
    assert.deepEqual(inventory.entries.map((entry) => entry.path).sort(), ["home.png", "shots/pricing.png"]);
  } finally {
    await rm(real, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});

// `launchclip finish --candidate <id>`: cheap rendered candidates with no paid
// calls (blind test 2: the skill required rendered candidates but gave no
// cheap path, and a careless candidate run could pay for music).
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { candidateAudio, lifecycleTimes, recordCandidate } from "../src/candidate_receipt.js";
import { validateRenderedCandidateReceipt } from "../src/cinematic_evidence.js";
import { runCli } from "../src/cli.js";
import { runFinish } from "../src/finish.js";
import { createTestVoiceProvider } from "../src/voice/index.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples/story/minimal");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const mp4 = (tag) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from(String(tag).padEnd(16, "."))]);
const fakeExtract = async (video, frame, output) => { await writeFile(output, Buffer.concat([PNG, Buffer.from(`${path.basename(path.dirname(output))}:${frame}`)])); };

test("candidateAudio never picks a paid provider", () => {
  assert.deepEqual(candidateAudio({ narrationProvider: "elevenlabs", cachedTake: false, musicSpecProvider: "elevenlabs" }).voice, "test");
  assert.equal(candidateAudio({ narrationProvider: "elevenlabs", cachedTake: false, musicSpecProvider: "elevenlabs" }).music, "synth");
  assert.equal(candidateAudio({ narrationProvider: "elevenlabs", cachedTake: true }).voice, undefined, "a cached take is reused");
  assert.equal(candidateAudio({ narrationProvider: "kokoro", cachedTake: false }).voice, undefined, "kokoro is local and free");
  assert.equal(candidateAudio({ musicFlag: "none" }).music, "none");
  assert.equal(candidateAudio({ musicSpecProvider: "file" }).music, "file");
  assert.throws(() => candidateAudio({ musicFlag: "elevenlabs" }), /no paid calls/);
});

test("lifecycle times default to entry, peak and settle, and --at overrides them", () => {
  assert.deepEqual(lifecycleTimes(4), [0.6, 2, 3.6]);
  assert.deepEqual(lifecycleTimes(4, "0.4,1.2,3"), [0.4, 1.2, 3]);
  assert.throws(() => lifecycleTimes(4, "1,2"), /three or more/);
  assert.throws(() => lifecycleTimes(4, "1,2,9"), /within the clip/);
});

test("recordCandidate writes a receipt cinematic-check accepts once the candidates are scored", async () => {
  const into = await mkdtemp(path.join(os.tmpdir(), "lc-candidates-"));
  try {
    const clip = async (name) => { const file = path.join(into, `${name}.mp4`); await writeFile(file, mp4(name)); return file; };
    const record = async (id, extra) => recordCandidate({ into, id, video: await clip(id), fps: 30, duration: 3, extract: fakeExtract, ...extra });
    const a = await record("open-a");
    assert.equal(a.comparison, "opening");
    assert.deepEqual(a.artifacts, ["qa/rendered-candidates/open-a/candidate.mp4", "qa/rendered-candidates/open-a/frame-0014.png", "qa/rendered-candidates/open-a/frame-0045.png", "qa/rendered-candidates/open-a/frame-0081.png"]);
    await record("open-b");
    await record("trans-a", { boundary: "s3" });
    await record("trans-b", { boundary: "s3" });
    await assert.rejects(record("bad", { kind: "transition" }), /needs --boundary/);
    const file = path.join(into, "qa/rendered-candidates.json");
    let receipt = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(receipt.comparisons.map((entry) => [entry.id, entry.kind, entry.candidate_order]), [["opening", "opening", ["open-a", "open-b"]], ["transition-s3", "transition", ["trans-a", "trans-b"]]]);
    const pending = await validateRenderedCandidateReceipt(into, receipt, { boundaryIds: ["s3"] });
    assert.equal(pending.ok, false, "unscored candidates are not a finished receipt");
    assert.ok(pending.errors.some((error) => /invalid scroll_stop score/.test(error)));
    // The critic scores them; the receipt then passes.
    for (const comparison of receipt.comparisons) {
      comparison.candidates.forEach((candidate, index) => {
        for (const key of Object.keys(candidate.scores)) candidate.scores[key] = index === 0 ? 8 : 6;
        if (index) candidate.rejection_reason = "weaker hierarchy";
      });
      comparison.selected_candidate_id = comparison.candidates[0].id;
      comparison.selection_rationale = "clearer first frame";
    }
    await writeFile(file, JSON.stringify(receipt));
    const done = await validateRenderedCandidateReceipt(into, receipt, { boundaryIds: ["s3"] });
    assert.deepEqual(done.errors, []);
    // A rerender keeps the scores and refreshes the hashes.
    await recordCandidate({ into, id: "open-a", video: await clip("open-a2"), fps: 30, duration: 3, extract: fakeExtract });
    receipt = JSON.parse(await readFile(file, "utf8"));
    const again = receipt.comparisons[0].candidates.find((entry) => entry.id === "open-a");
    assert.equal(again.scores.scroll_stop, 8);
    assert.notEqual(again.render_id, a.candidate.render_id);
  } finally {
    await rm(into, { recursive: true, force: true });
  }
});

function adapters(seen) {
  const touch = async (file, content) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); };
  return {
    env: { ELEVENLABS_API_KEY: "sk_test_never_sent" },
    fetch: async () => { throw new Error("no network call may be made"); },
    notice() {},
    voiceProvider: (name) => { seen.voices.push(name); if (name !== "test") throw new Error(`paid voice ${name} requested`); return createTestVoiceProvider(); },
    renderer: (name) => ({ name, async render(project, out) { seen.renders += 1; await touch(out, mp4(`render${seen.renders}`)); return { output: out }; } }),
    async compileHyperFrames(resolved, options) { await touch(path.join(options.projectDir, "index.html"), "<html></html>"); return { warnings: [] }; },
    async synthKit(outDir, bed) { seen.synth += 1; await touch(path.join(outDir, "AUDIO-KIT.json"), "{}"); if (bed) await touch(path.join(outDir, "music", "bed.wav"), "x"); return {}; },
    async buildMix(options) { await touch(options.out, "mix"); return { cues: [] }; },
    async hasAudio() { return true; },
    async master(input, output, target) { await touch(output, await readFile(input)); return { target: { integrated_lufs: target.lufs, true_peak_dbtp: target.tp }, output: { integrated_lufs: -14, true_peak_dbtp: -1.2 }, compliant: true }; },
    async buildEvidence() { seen.evidence += 1; return {}; },
    async motion(video, out) { await touch(out, "{}"); return { quality: { ok: true, findings: [] } }; },
    async audio() { return { quality: { ok: true, findings: [] } }; },
    recordCandidate: (options) => recordCandidate({ ...options, extract: fakeExtract })
  };
}

test("finish --candidate renders a draft with no paid calls and records it into the receipt", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "lc-finish-candidate-"));
  const main = await mkdtemp(path.join(os.tmpdir(), "lc-finish-main-"));
  try {
    await cp(MINIMAL, project, { recursive: true });
    await rm(path.join(project, "assets/audio/mix.wav"), { force: true });
    await rm(path.join(project, "NARRATION.json"), { force: true });
    const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
    delete story.audio.mix;
    story.audio.narration = { text: "Builds took forty-eight minutes. Now twelve. Three changes did it. Watch again.", provider: "elevenlabs" };
    story.audio.music = { provider: "elevenlabs" };
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
    const seen = { voices: [], renders: 0, synth: 0, evidence: 0 };
    const report = await runFinish(project, { renderer: "remotion", candidate: "open-a", into: main }, adapters(seen));
    const stage = (name) => report.stages.find((entry) => entry.name === name);
    assert.equal(report.status, "candidate", JSON.stringify(report.stages.filter((entry) => entry.error)));
    assert.deepEqual(seen.voices, ["test"], "uncached ElevenLabs narration falls back to the test voice");
    assert.equal(stage("sound").details.music.provider, "synth");
    assert.equal(stage("evidence").status, "skipped");
    assert.equal(stage("gates").status, "skipped");
    assert.equal(seen.evidence, 0);
    assert.equal(report.output, path.join(project, "renders/candidate.mp4"));
    assert.ok(report.warnings.some((line) => /offline test voice/.test(line)));
    assert.equal(report.candidate.comparison, "opening");
    const receipt = JSON.parse(await readFile(path.join(main, "qa/rendered-candidates.json"), "utf8"));
    assert.deepEqual(receipt.comparisons[0].candidates.map((entry) => entry.id), ["open-a"]);
    assert.ok(report.next_steps.some((step) => /Score candidate open-a/.test(step)));
    await assert.rejects(runFinish(project, { candidate: "x", music: "elevenlabs" }, adapters(seen)), /no paid calls/);
    await assert.rejects(runFinish(project, { candidate: "x", voice: "elevenlabs" }, adapters(seen)), /no paid calls/);
    await assert.rejects(runFinish(project, { candidate: "x", quality: "high" }, adapters(seen)), /drafts only/);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(main, { recursive: true, force: true });
  }
});

test("finish --help documents --candidate", async () => {
  const out = [];
  await runCli(["finish", "--help"], { stdout: { write: (value) => out.push(value) } });
  assert.match(out.join(""), /--candidate <id> \[--into <project>\]/);
});

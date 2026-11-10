// finish without a browser, ffmpeg or a model, for tests that run the real
// runFinish: a segment renderer that records the frame ranges it is asked
// for, and evidence with one sample in the middle of every shot (so a
// critic's finding can name a shot).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PATHS } from "../../src/finish.js";

export const touch = async (file, content = "x") => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); };

/** runFinish adapters; `segmentCalls` lists the frame ranges of every render call. */
export function animaticAdapters() {
  const adapters = {
    env: {},
    notice() {},
    segmentCalls: [],
    renderer: (name) => ({
      name,
      segmentEncoder: () => ({ fake: true }),
      async renderSegments(project, segments, options) {
        adapters.segmentCalls.push(segments.map((segment) => [segment.startFrame, segment.endFrame]));
        for (const segment of segments) await touch(segment.output, `${segment.startFrame}-${segment.endFrame} ${JSON.stringify(options.story.scenes.map((scene) => scene.params?.cast?.map((member) => member.pose)))}\n`);
        return { segments: segments.map(() => ({ seconds: 1 })) };
      },
      async encodeDelivery(input, output) { await touch(output, await readFile(input, "utf8")); },
      async render() { throw new Error("the segment path must not render whole videos"); }
    }),
    segmentTools: {
      async concat(files, output) { await touch(output, (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("")); },
      async encodeAudio({ output }) { await touch(output, "aac"); },
      async mux({ video, output }) { await touch(output, await readFile(video, "utf8")); },
      async countFrames() { return NaN; },
      async still(video, frame, output) { await touch(output, `${frame}`); },
      async sideBySide(left, right, output) { await touch(output, "pair"); }
    },
    async synthKit(outDir, bed) { await touch(path.join(outDir, "AUDIO-KIT.json"), "{}"); if (bed) await touch(path.join(outDir, "music", "bed.wav")); return {}; },
    async renderTyping(schedule, banks, { out }) { await touch(out, "typing"); return { file: out, keystrokes: [], counts: {} }; },
    async buildMix(options) { await touch(options.out, `mix ${options.cues.length}`); return { cues: options.cues.map((cue) => ({ ...cue, file: path.join(options.sfxDir, `${cue.cue}.wav`) })) }; },
    async hasAudio() { return true; },
    async master(input, output, target) { await touch(output, `mastered ${await readFile(input, "utf8")}`); return { target: { integrated_lufs: target.lufs, true_peak_dbtp: target.tp }, output: { integrated_lufs: -14.1, true_peak_dbtp: -1.4 }, compliant: true }; },
    async buildEvidence(project, options) {
      const shots = options.story.scenes.filter((scene) => (scene.track ?? 0) === 0);
      const entries = shots.flatMap((scene) => ["browser-still", "encoded-draft"].map((source) => ({ evidence_id: `${scene.id}-001-${source}`, sample_id: `${scene.id}-001`, source, role: "sample", at_seconds: Math.round(((scene.start + scene.end) / 2) * 1000) / 1000 })));
      await touch(path.join(project, PATHS.evidence), JSON.stringify({ schema_version: "launchclip.subscription-temporal-evidence.v1", entries }));
      await touch(path.join(project, "qa/critic-sheets/index.json"), JSON.stringify({ sheets: [{ sheet: "sheet-01.jpg", samples: shots.map((scene) => `${scene.id}-001`) }] }));
      await touch(path.join(project, "qa/critic-sheets/sheet-01.jpg"), "jpg");
      await touch(path.join(project, "qa/critic-sheets/overview-every-1.5s.jpg"), "strip");
      return { samples: shots.length, artifacts: entries.length, sheets: ["sheet-01.jpg"] };
    },
    async motion(video, out) { await touch(out, "{}"); return { quality: { ok: true, findings: [] } }; },
    async audio() { return { quality: { ok: true, findings: [] } }; }
  };
  return adapters;
}

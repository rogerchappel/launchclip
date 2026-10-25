import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadProjectStory, probeMedia, runExport, transcodeMatte } from "../src/nle/export.js";
import { readFcpxml } from "../src/nle/fcpxml.js";
import { readOtio } from "../src/nle/otio.js";
import { overlayPlan } from "../src/nle/timeline.js";
import { readXmeml } from "../src/nle/xmeml.js";
import { mediaSkip } from "./helpers/media.js";

const ROOT = path.resolve(import.meta.dirname, "..");

// Fakes for ffprobe, the overlay renders, the matte transcode and the Python
// check; mattes are 720x1280 at 30 fps, like the examples' recordings.
function fakeAdapters(log = []) {
  return {
    probe: async (file) => {
      const name = path.basename(file);
      if (name === "recording.mp4") return { duration: 12, frames: 360, width: 720, height: 1280, pixFmt: "yuv420p", hasVideo: true, hasAudio: true, audioChannels: 1, audioRate: 48000 };
      if (file.includes(`${path.sep}subject${path.sep}`)) return { duration: 12, frames: 360, width: 720, height: 1280, pixFmt: "yuva444p12le", hasVideo: true, hasAudio: false };
      return { duration: 3, frames: null, width: 1080, height: 1920, pixFmt: "yuva444p12le", hasVideo: true, hasAudio: false };
    },
    overlayRenderer: () => ({
      async prepare() {},
      async render(entry, story, outFile) {
        log.push(`render ${entry.key}${entry.part ? ` part=${entry.part}` : ""}`);
        await writeFile(outFile, "mov");
        return { kind: "mov", source: outFile, frames: Math.round((entry.end - entry.start) * story.resolved.fps) };
      }
    }),
    transcodeMatte: async (source, outFile) => {
      log.push(`matte ${path.basename(source)}`);
      await writeFile(outFile, "matte");
      return { kind: "mov", source: outFile };
    },
    makePlate: async (file) => { await writeFile(file, "plate"); },
    otioCheck: async () => null
  };
}

async function copyExample(name, edit) {
  const dir = await mkdtemp(path.join(os.tmpdir(), `launchclip-subject-export-`));
  await cp(path.join(ROOT, "examples", "story", name), dir, { recursive: true });
  if (edit) {
    const file = path.join(dir, "storyboard.json");
    const story = JSON.parse(await readFile(file, "utf8"));
    edit(story);
    await writeFile(file, `${JSON.stringify(story, null, 2)}\n`);
  }
  return dir;
}

const exportDir = (project) => path.join(project, "exports", path.basename(project));

test("overlayPlan: behind scenes carry their layer, split scenes become a behind and a front part", async () => {
  const { resolved } = await loadProjectStory(path.join(ROOT, "examples", "story", "subject-creative"));
  const plan = overlayPlan(resolved);
  assert.deepEqual(plan.clips.map((clip) => [clip.key, clip.layer ?? "front", clip.part ?? null]), [
    ["glass", "behind", null],
    ["orbit-behind", "behind", "behind"],
    ["orbit-front", "front", "front"],
    ["proof-behind", "behind", "behind"],
    ["proof-front", "front", "front"],
    ["scrap-behind", "behind", "behind"],
    ["scrap-front", "front", "front"]
  ]);
  assert.deepEqual(plan.subject.windows, [[0.3, 3], [3.2, 6.4], [6.6, 9.2], [9.4, 12]]);
  assert.deepEqual(plan.subject.scenes.map((scene) => [scene.sceneId, scene.layer, scene.animated]), [
    ["glass", "behind", []],
    ["orbit", "split", []],
    ["proof", "split", []],
    ["scrap", "split", ["subjectCamera", "subjectStyle"]]
  ]);
});

test("overlayPlan: a story without subject scenes has no subject plan and unchanged clips", async () => {
  const { resolved } = await loadProjectStory(path.join(ROOT, "examples", "story", "footage"));
  const plan = overlayPlan(resolved);
  assert.equal(plan.subject, undefined);
  for (const clip of plan.clips) {
    assert.equal(clip.layer, undefined);
    assert.equal(clip.part, undefined);
    assert.equal(clip.key, clip.sceneId);
  }
});

test("export stacks base, behind overlays, the subject, front overlays and captions in every format", async (t) => {
  const project = await copyExample("subject-creative");
  t.after(() => rm(project, { recursive: true, force: true }));
  const log = [];
  const report = await runExport(project, { format: "all" }, fakeAdapters(log));
  assert.equal(report.status, "exported");
  for (const key of ["fcpxml", "premiere", "edl", "otio"]) assert.equal(report.validation[key].status, "passed", `${key}: ${JSON.stringify(report.validation[key])}`);
  assert.ok(log.includes("render orbit-behind part=behind") && log.includes("render orbit-front part=front"));
  assert.deepEqual(log.filter((entry) => entry.startsWith("matte")), ["matte 0.000-12.000.webm"]);

  const dir = exportDir(project);
  const timeline = JSON.parse(await readFile(path.join(dir, "timeline.json"), "utf8"));
  const video = timeline.tracks.filter((track) => track.kind === "video");
  assert.deepEqual(video.map((track) => [track.id, track.name, track.layer ?? null]), [
    ["V1", "Base footage", null],
    ["V2", "Behind subject 1", "behind"],
    ["V3", "Subject (presenter cut-out)", "subject"],
    ["V4", "Overlays 1", null]
  ]);
  // One subject clip per layered scene window, in the matte at the base's source time.
  assert.deepEqual(video[2].clips.map((clip) => [clip.start, clip.duration, clip.in]), [[9, 81, 9], [96, 96, 96], [198, 78, 198], [282, 78, 282]]);
  assert.deepEqual(video[1].clips.map((clip) => clip.name), ["glass · glass-word", "orbit · orbit-cards (behind)", "proof · proof-wall (behind)", "scrap · scrapbook (behind)"]);
  assert.deepEqual(video[3].clips.map((clip) => clip.name), ["orbit · orbit-cards (front)", "proof · proof-wall (front)", "scrap · scrapbook (front)"]);
  assert.equal(timeline.assets.find((asset) => asset.role === "subject").path, "media/subject/0.000-12.000.mov");

  // OTIO: tracks bottom to top in the same order.
  const otio = readOtio(await readFile(path.join(dir, report.files.otio), "utf8"));
  assert.deepEqual(otio.tracks.filter((track) => track.kind === "Video").map((track) => track.name), ["V1 Base footage", "V2 Behind subject 1", "V3 Subject (presenter cut-out)", "V4 Overlays 1"]);

  // FCPXML (Final Cut Pro, Resolve): behind lanes under the subject lane, front lanes over it, captions on top.
  const fcp = readFcpxml(await readFile(path.join(dir, report.files.fcpxml), "utf8"));
  const lanesOf = (match) => [...new Set(fcp.clips.filter((clip) => match(clip.name)).map((clip) => clip.lane))];
  assert.deepEqual(lanesOf((name) => name.startsWith("recording")), [0]);
  assert.deepEqual(lanesOf((name) => name === "glass · glass-word" || name.endsWith("(behind)")), [1]);
  assert.deepEqual(lanesOf((name) => name.startsWith("subject ")), [2]);
  assert.deepEqual(lanesOf((name) => name.endsWith("(front)")), [3]);
  for (const caption of fcp.captions) assert.ok(caption.lane > 3);

  // Premiere: video tracks in the same order, the subject clips with straight alpha.
  const xml = await readFile(path.join(dir, report.files.premiere), "utf8");
  const premiere = readXmeml(xml);
  assert.deepEqual(premiere.video.map((track) => track.clips.length), [1, 4, 4, 3]);
  assert.deepEqual(premiere.video[2].clips.map((clip) => clip.name), ["subject 1", "subject 2", "subject 3", "subject 4"]);

  // The report: the subject track, scenes kept static, and the EDL limit.
  assert.deepEqual(report.subject, { mattes: [{ src: "assets/subject/0.000-12.000.webm", status: "transcoded", file: "media/subject/0.000-12.000.mov", frames: 360 }], track: "V3", clips: 4, static: ["scrap"] });
  assert.ok(report.warnings.some((warning) => /scene scrap \(scrapbook\) moves the presenter on its own \(subjectCamera\), outlines or shadows the presenter \(subjectStyle\); the export keeps its static layering only/.test(warning)), report.warnings.join("\n"));
  assert.ok(report.notes.some((note) => /EDL carries V1 only, so the presenter's depth/.test(note)));

  // Second run: the matte copy is reused.
  const again = [];
  const second = await runExport(project, { format: "otio" }, fakeAdapters(again));
  assert.deepEqual(again, []);
  assert.equal(second.subject.mattes[0].status, "cached");
});

test("export maps subject clips through the base's cuts", async (t) => {
  const project = await copyExample("subject", (story) => {
    story.format.duration = 5;
    story.base.trim = [[0, 1.5], [2.5, 6]];
    story.scenes = story.scenes.filter((scene) => scene.id !== "push");
    Object.assign(story.scenes.find((scene) => scene.id === "dolly"), { start: 2.95, end: 5, params: { scale: 1.35, at: 0.1, move: 1 } });
  });
  t.after(() => rm(project, { recursive: true, force: true }));
  const report = await runExport(project, { format: "fcpxml,otio" }, fakeAdapters());
  assert.equal(report.status, "exported", JSON.stringify(report.validation));
  const timeline = JSON.parse(await readFile(path.join(exportDir(project), "timeline.json"), "utf8"));
  const base = timeline.tracks.find((track) => track.id === "V1");
  const subject = timeline.tracks.find((track) => track.layer === "subject");
  assert.deepEqual(base.clips.map((clip) => [clip.start, clip.duration, clip.in]), [[0, 45, 0], [45, 105, 75]]);
  // masthead 0.4–2.9 s spans the cut at 1.5 s: source 0.4–1.5, then from 2.5.
  assert.deepEqual(subject.clips.map((clip) => [clip.start, clip.duration, clip.in]), [[12, 33, 12], [45, 42, 75], [89, 61, 119]]);
  // Each subject frame shows the matte of the source frame the base shows.
  for (const clip of subject.clips) {
    const under = base.clips.find((entry) => clip.start >= entry.start && clip.start < entry.start + entry.duration);
    assert.equal(clip.in, under.in + (clip.start - under.start));
    assert.ok(clip.start + clip.duration <= under.start + under.duration);
  }
  assert.ok(report.warnings.some((warning) => /scene dolly \(dolly-zoom\) moves the presenter on its own \(subjectCamera\)/.test(warning)));
});

test("--overlays none exports no subject track", async (t) => {
  const project = await copyExample("subject");
  t.after(() => rm(project, { recursive: true, force: true }));
  const log = [];
  const report = await runExport(project, { format: "otio", overlays: "none" }, fakeAdapters(log));
  assert.equal(report.status, "exported");
  assert.deepEqual(log, []);
  assert.equal(report.subject.track, null);
  const timeline = JSON.parse(await readFile(path.join(exportDir(project), "timeline.json"), "utf8"));
  assert.ok(!timeline.tracks.some((track) => track.layer));
});

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-hide_banner", "-decoders"], { stdio: "pipe" }).toString().includes("libvpx-vp9") || (() => { throw new Error("no libvpx-vp9"); })(); return true; } catch { return false; } })();

test("transcodeMatte keeps the matte's alpha in ProRes 4444", { skip: mediaSkip(!hasFfmpeg && "ffmpeg with libvpx-vp9 is not installed") }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-matte-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out = path.join(dir, "matte.mov");
  const render = await transcodeMatte(path.join(ROOT, "examples", "story", "subject", "assets", "subject", "0.000-6.000.webm"), out);
  assert.equal(render.kind, "mov");
  assert.ok(existsSync(out));
  const info = await probeMedia(out);
  assert.match(info.pixFmt, /^yuva444p/);
  assert.equal(info.frames, 180);
  assert.deepEqual([info.width, info.height], [720, 1280]);
});

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { hasAlpha, parseFormats, runExport } from "../src/nle/export.js";
import { overlayRenderArgs } from "../src/nle/overlays.js";

const ROOT = path.resolve(import.meta.dirname, "..");

// Fakes for ffprobe, the Remotion overlay renders and the Python check, so the
// export pipeline runs without rendering anything.
function fakeAdapters(log = []) {
  return {
    probe: async (file) => {
      const name = path.basename(file);
      if (name === "recording.mp4") return { duration: 22, frames: 660, width: 720, height: 1280, pixFmt: "yuv420p", hasVideo: true, hasAudio: true, audioChannels: 1, audioRate: 48000 };
      if (name.endsWith(".mov")) return { duration: 3, frames: null, width: 1080, height: 1920, pixFmt: "yuva444p12le", hasVideo: true, hasAudio: false };
      return { duration: 20, frames: 600, width: 1080, height: 1920, pixFmt: "yuv420p", hasVideo: true, hasAudio: true, audioChannels: 2, audioRate: 48000 };
    },
    overlayRenderer: () => ({
      async prepare() { log.push("prepare"); },
      async render(entry, story, outFile) {
        log.push(`render ${entry.key}`);
        await writeFile(outFile, "mov");
        return { kind: "mov", source: outFile, frames: Math.round((entry.end - entry.start) * story.resolved.fps) };
      }
    }),
    makePlate: async (file) => { await writeFile(file, "plate"); },
    otioCheck: async () => null
  };
}

async function footageProject() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-export-"));
  await cp(path.join(ROOT, "examples", "story", "footage"), dir, { recursive: true });
  return dir;
}

test("parseFormats and hasAlpha", () => {
  assert.deepEqual(parseFormats("all"), ["fcpxml", "premiere", "edl", "otio"]);
  assert.deepEqual(parseFormats("fcpxml, xmeml,edl"), ["fcpxml", "premiere", "edl"]);
  assert.throws(() => parseFormats("aaf"), /Unknown --format aaf/);
  assert.throws(() => parseFormats(undefined), /--format is required/);
  assert.equal(hasAlpha("yuva444p10le"), true);
  assert.equal(hasAlpha("yuva444p12le"), true);
  assert.equal(hasAlpha("rgba"), true);
  assert.equal(hasAlpha("yuv420p"), false);
});

test("overlay render arguments ask Remotion for ProRes 4444 with alpha or a PNG sequence", () => {
  const prores = overlayRenderArgs({ bundle: "/b", propsFile: "/p.json", outFile: "/o/s1.mov", mode: "prores4444" });
  assert.deepEqual(prores.slice(0, 4), ["render", "/b", "SceneOverlay", "/o/s1.mov"]);
  for (const pair of [["--codec", "prores"], ["--prores-profile", "4444"], ["--pixel-format", "yuva444p10le"], ["--image-format", "png"]]) {
    assert.equal(prores[prores.indexOf(pair[0]) + 1], pair[1]);
  }
  const png = overlayRenderArgs({ bundle: "/b", propsFile: "/p.json", outFile: "/o/s1", mode: "png" });
  assert.ok(png.includes("--sequence"));
  assert.ok(!png.includes("--codec"));
});

test("runExport writes every format, copies media, validates and reuses overlay renders", async (t) => {
  const project = await footageProject();
  t.after(() => rm(project, { recursive: true, force: true }));
  const log = [];
  const report = await runExport(project, { format: "all" }, fakeAdapters(log));
  assert.equal(report.status, "exported");
  const dir = path.join(project, "exports", path.basename(project));
  for (const file of Object.values(report.files)) assert.ok(existsSync(path.join(dir, file)), file);
  assert.deepEqual(Object.keys(report.files).sort(), ["captions", "edl", "fcpxml", "otio", "premiere", "timeline"]);
  for (const key of ["fcpxml", "premiere", "edl", "otio"]) assert.equal(report.validation[key].status, "passed", `${key}: ${JSON.stringify(report.validation[key])}`);
  assert.equal(report.validation.fcpxml.dtd.status === "skipped" || report.validation.fcpxml.dtd.status === "passed", true);
  assert.ok(existsSync(path.join(dir, "media", "recording.mp4")));
  assert.deepEqual(report.overlays.cameras, ["punch-demo", "punch-recording", "punch-callouts"]);
  assert.deepEqual(log, ["prepare", "render twelve", "render builder", "render name", "render captions-note", "render try-it"]);
  // V1: the edit plan's two kept segments, the second from source 10 s.
  const timeline = JSON.parse(await readFile(path.join(dir, "timeline.json"), "utf8"));
  assert.deepEqual(timeline.tracks[0].clips.map((clip) => [clip.start, clip.duration, clip.in]), [[0, 240, 0], [240, 360, 300]]);
  assert.ok(!JSON.stringify(timeline).includes(project), "timeline.json holds no absolute source paths");
  const exportJson = JSON.parse(await readFile(path.join(dir, "EXPORT.json"), "utf8"));
  assert.equal(exportJson.schema_version, "launchclip.export.v1");

  // Second run: the overlay renders are reused.
  const again = [];
  const second = await runExport(project, { format: "fcpxml" }, fakeAdapters(again));
  assert.deepEqual(again, []);
  assert.ok(second.overlays.clips.every((clip) => clip.status === "cached"));
});

test("launchclip export CLI: --overlays none and --json", async (t) => {
  const project = await footageProject();
  t.after(() => rm(project, { recursive: true, force: true }));
  let out = "";
  await runCli(["export", project, "--format", "premiere,edl", "--overlays", "none", "--name", "cut", "--json"], {
    stdout: { write: (text) => { out += text; } },
    stderr: { write: () => {} },
    productionAdapters: { export: fakeAdapters() }
  });
  const report = JSON.parse(out);
  assert.equal(report.status, "exported");
  assert.equal(report.overlays.mode, "none");
  assert.deepEqual(report.formats, ["premiere", "edl"]);
  assert.ok(existsSync(path.join(project, "exports", "cut", "cut.xml")));
  assert.ok(existsSync(path.join(project, "exports", "cut", "cut.edl")));
  await assert.rejects(runCli(["export", project, "--format", "fcpxml", "--overlays", "alpha"], { stdout: { write() {} }, stderr: { write() {} }, productionAdapters: { export: fakeAdapters() } }), /--overlays must be one of/);
});

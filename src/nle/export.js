// launchclip export <project>: a finished project → an editable NLE timeline
// (Final Cut Pro, Premiere Pro, DaVinci Resolve, any OTIO host).
//
//   load    the finish copy of storyboard.json (else storyboard.json), resolved
//           with NARRATION.json words, BEATS.json and base.edl
//   media   the base recording or a generated plate, the voice, music bed,
//           SFX cues (AUDIO-MANIFEST.json → sfx_manifest), the mix, captions,
//           the finished render; probed with ffprobe
//   render  each overlay scene as an alpha clip (overlays.js), unless
//           --overlays none (a split scene renders its behind and front parts
//           as two clips); unchanged renders are reused
//   subject the presenter mattes the layered scenes need (VP9 alpha WebM),
//           transcoded to ProRes 4444 (or PNG frames) so editors read their
//           alpha; unchanged copies are reused
//   build   the timeline model (timeline.js)
//   write   <name>.fcpxml / <name>.xml / <name>.edl / <name>.otio, captions.srt,
//           timeline.json and EXPORT.json into <out>/<name>/, with every media
//           file copied (APFS clone where possible) into <out>/<name>/media/
//   check   each file parsed back and compared with the model frame for frame;
//           FCPXML also against Apple's DTD when one is available offline
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { captionChunksFrom, chunkWords, narrationWords } from "../../kit/core/captions.mjs";
import { resolveStory, storyBase, validateStory } from "../../kit/core/story.mjs";
import { subjectSegments } from "../../kit/core/subject-layer.mjs";
import { VERSION } from "../doctor.js";
import { narrationFile, readStoryEdl } from "../story_loader.js";
import { writeEdl, writeSrt } from "./edl.js";
import { writeFcpxml } from "./fcpxml.js";
import { createOverlayRenderer, sequencePattern } from "./overlays.js";
import { writeOtio } from "./otio.js";
import { parseRate } from "./time.js";
import { OVERLAY_MODES, buildTimeline, checkTimeline, overlayPlan, timelineSummary } from "./timeline.js";
import { checkEdlRoundTrip, checkFcpxmlRoundTrip, checkOtioRoundTrip, checkXmemlRoundTrip } from "./validate.js";
import { writeXmeml } from "./xmeml.js";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..", "..");

export const EXPORT_FORMATS = ["fcpxml", "premiere", "edl", "otio"];
export const EXPORT_REPORT_VERSION = "launchclip.export.v1";
const EXTENSIONS = { fcpxml: "fcpxml", premiere: "xml", edl: "edl", otio: "otio" };
// Apple's DTD ships inside Final Cut Pro; also honoured: --dtd and LAUNCHCLIP_FCPXML_DTD.
const FCPXML_DTD_CANDIDATES = [
  "/Applications/Final Cut Pro.app/Contents/Frameworks/Interchange.framework/Versions/A/Resources/FCPXMLv1_10.dtd",
  "/Applications/Final Cut Pro Trial.app/Contents/Frameworks/Interchange.framework/Versions/A/Resources/FCPXMLv1_10.dtd"
];

/** "fcpxml", "fcpxml,edl", "all" → ["fcpxml", "edl"]. */
export function parseFormats(value) {
  const list = String(value ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (!list.length) throw new Error(`--format is required: ${EXPORT_FORMATS.join(", ")} or all`);
  if (list.includes("all")) return [...EXPORT_FORMATS];
  const aliases = { xmeml: "premiere", fcp7: "premiere", xml: "premiere", resolve: "fcpxml", cmx3600: "edl" };
  const formats = [...new Set(list.map((entry) => aliases[entry] ?? entry))];
  const unknown = formats.filter((entry) => !EXPORT_FORMATS.includes(entry));
  if (unknown.length) throw new Error(`Unknown --format ${unknown.join(", ")}; use ${EXPORT_FORMATS.join(", ")} or all`);
  return formats;
}

function defaultAdapters() {
  return {
    probe: (file) => probeMedia(file),
    overlayRenderer: () => createOverlayRenderer(),
    makePlate: (file, options) => makePlate(file, options),
    transcodeMatte: (source, outFile, options) => transcodeMatte(source, outFile, options),
    xmllint: (file, dtd) => execFileAsync("xmllint", ["--noout", "--dtdvalid", dtd, file], { maxBuffer: 1 << 24 }),
    otioCheck: (files) => otioPythonCheck(files),
    log: () => {}
  };
}

/**
 * options: {format, overlays, out, fps, absolute, name, force, dtd, concurrency}
 * Returns the EXPORT.json report.
 */
export async function runExport(projectPath, options = {}, adapterOverrides = {}) {
  const adapters = { ...defaultAdapters(), ...adapterOverrides };
  const project = path.resolve(projectPath);
  const formats = parseFormats(options.format);
  const mode = String(options.overlays ?? "prores4444").toLowerCase();
  if (!OVERLAY_MODES.includes(mode)) throw new Error(`--overlays must be one of ${OVERLAY_MODES.join(", ")}; got ${options.overlays}`);
  const loaded = await loadProjectStory(project);
  const story = loaded.resolved;
  const rate = parseRate(options.fps ?? story.resolved.fps);
  // Overlays render at the export rate (29.97 exports render at 30000/1001).
  const renderStory = rate.fps === story.resolved.fps ? story : { ...story, resolved: { ...story.resolved, fps: rate.fps, frames: Math.round(story.resolved.duration * rate.fps) } };
  const name = safeName(options.name ?? path.basename(project));
  const outRoot = path.resolve(project, options.out ?? "exports");
  const exportDir = path.join(outRoot, name);
  const mediaDir = path.join(exportDir, "media");
  await mkdir(mediaDir, { recursive: true });
  const warnings = [...loaded.warnings];
  const notes = [];

  // ---- media
  const media = await collectMedia(project, story, adapters, warnings);
  if (story.lane !== "footage-led") {
    const color = story.brand?.colors?.bg ?? "#000000";
    const plate = path.join(project, ".launchclip", "export", `plate-${color.slice(1)}-${story.format.width}x${story.format.height}-${rate.num}_${rate.den}-${story.resolved.duration}.mp4`);
    if (!existsSync(plate)) await adapters.makePlate(plate, { color, width: story.format.width, height: story.format.height, rate, duration: story.resolved.duration });
    // makePlate writes ceil(duration × fps) frames, which covers the timeline's rounded length.
    media.plate = { source: plate, duration: Math.ceil(story.resolved.duration * rate.num / rate.den) * rate.den / rate.num, color };
  }

  // ---- overlays
  const plan = overlayPlan(renderStory);
  media.overlays = {};
  const overlayReport = [];
  if (mode !== "none" && plan.clips.length) {
    const cacheFile = path.join(mediaDir, "overlays", ".renders.json");
    const cache = (await readOptionalJson(cacheFile)) ?? {};
    const kit = await treeFingerprint([path.join(ROOT, "kit", "remotion"), path.join(ROOT, "kit", "core")]);
    let renderer = null;
    for (const entry of plan.clips) {
      const outFile = path.join(mediaDir, "overlays", mode === "png" ? entry.key : `${entry.key}.mov`);
      const key = hashValue({ story: renderStory, entry, mode, kit, version: VERSION });
      if (!options.force && cache[entry.key]?.key === key && existsSync(outFile)) {
        media.overlays[entry.key] = cache[entry.key].render;
        overlayReport.push({ key: entry.key, status: "cached", file: rel(exportDir, outFile) });
        continue;
      }
      if (!renderer) {
        renderer = adapters.overlayRenderer();
        adapters.log(`bundling the Remotion kit for ${plan.clips.length} overlay clip${plan.clips.length === 1 ? "" : "s"}`);
        await renderer.prepare(project, path.join(project, ".launchclip", "export"));
      }
      adapters.log(`rendering overlay ${entry.key} (${round3(entry.end - entry.start)}s, ${mode})`);
      const started = performance.now();
      await mkdir(path.dirname(outFile), { recursive: true });
      const render = await renderer.render(entry, renderStory, outFile, { mode, concurrency: options.concurrency });
      if (render.kind === "mov") {
        const probed = await adapters.probe(outFile);
        render.frames = probed.frames ?? Math.round(probed.duration * rate.fps);
        render.pix_fmt = probed.pixFmt ?? null;
        if (probed.pixFmt && !hasAlpha(probed.pixFmt)) warnings.push(`overlay ${entry.key} rendered without alpha (${probed.pixFmt})`);
      }
      media.overlays[entry.key] = render;
      cache[entry.key] = { key, render };
      overlayReport.push({ key: entry.key, status: "rendered", seconds: round3((performance.now() - started) / 1000), file: rel(exportDir, outFile), frames: render.frames, pix_fmt: render.pix_fmt ?? null });
    }
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, `${JSON.stringify(cache, null, 2)}\n`);
  } else if (mode === "none") {
    notes.push("--overlays none: the finished render is the one picture clip above V1");
  }

  // ---- subject mattes
  const subjectReport = plan.subject ? { mattes: [], track: null, clips: 0, static: plan.subject.scenes.filter((scene) => scene.animated.length).map((scene) => scene.sceneId) } : null;
  if (plan.subject && mode !== "none") {
    media.subject = { mattes: {} };
    const sources = [...new Set(subjectSegments(story, plan.subject.windows).map((segment) => segment.src))];
    const cacheFile = path.join(mediaDir, "subject", ".renders.json");
    const cache = (await readOptionalJson(cacheFile)) ?? {};
    for (const src of sources) {
      const source = path.resolve(project, src);
      if (!existsSync(source)) { warnings.push(`subject matte ${src} was not found`); continue; }
      const stem = path.basename(src).replace(/\.[^.]+$/, "");
      const outFile = path.join(mediaDir, "subject", mode === "png" ? stem : `${stem}.mov`);
      const info = await stat(source);
      const key = hashValue({ src, size: info.size, mtime: Math.round(info.mtimeMs), mode, version: VERSION });
      if (!options.force && cache[src]?.key === key && existsSync(outFile)) {
        media.subject.mattes[src] = cache[src].render;
        subjectReport.mattes.push({ src, status: "cached", file: rel(exportDir, outFile) });
        continue;
      }
      adapters.log(`transcoding subject matte ${src} (${mode})`);
      await mkdir(path.dirname(outFile), { recursive: true });
      const render = await adapters.transcodeMatte(source, outFile, { mode });
      if (render.kind === "mov") {
        const probed = await adapters.probe(outFile);
        Object.assign(render, { frames: probed.frames ?? Math.floor(probed.duration * rate.num / rate.den + 1e-6), width: probed.width, height: probed.height, pix_fmt: probed.pixFmt ?? null });
        if (probed.pixFmt && !hasAlpha(probed.pixFmt)) warnings.push(`subject matte ${src} transcoded without alpha (${probed.pixFmt})`);
      }
      media.subject.mattes[src] = render;
      cache[src] = { key, render };
      subjectReport.mattes.push({ src, status: "transcoded", file: rel(exportDir, outFile), frames: render.frames });
    }
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, `${JSON.stringify(cache, null, 2)}\n`);
  }

  // ---- timeline
  const timeline = buildTimeline(story, media, { name, rate, overlays: mode, plan });
  if (subjectReport) {
    const track = timeline.tracks.find((entry) => entry.layer === "subject");
    subjectReport.track = track?.id ?? null;
    subjectReport.clips = track?.clips.length ?? 0;
    if (formats.includes("edl")) notes.push("the EDL carries V1 only, so the presenter's depth (behind overlays, the subject track, front overlays) is left out; use fcpxml, premiere or otio for it");
  }
  warnings.push(...timeline.warnings);
  const problems = checkTimeline(timeline);
  if (problems.length) throw new Error(`the timeline model is inconsistent:\n- ${problems.join("\n- ")}`);

  // ---- media copies
  const copied = [];
  for (const asset of timeline.assets) {
    const target = path.join(exportDir, asset.path);
    if (path.resolve(asset.source) === path.resolve(target)) continue;
    if (asset.kind === "image-sequence") continue;
    await mkdir(path.dirname(target), { recursive: true });
    if (!(await sameFile(asset.source, target))) {
      await copyFile(asset.source, target, constants.COPYFILE_FICLONE);
      copied.push(asset.path);
    }
  }

  // ---- write + validate
  const absolute = options.absolute ? exportDir : undefined;
  const files = {};
  const validation = {};
  const writeText = async (relative, text) => { await writeFile(path.join(exportDir, relative), text); return relative; };
  const srt = timeline.captions.clips.length ? writeSrt(timeline) : null;
  if (srt) files.captions = await writeText("captions.srt", srt);
  for (const format of formats) {
    const file = `${name}.${EXTENSIONS[format]}`;
    if (format === "fcpxml") {
      const { xml, warnings: notesOut } = writeFcpxml(timeline, { absolute, event: "LaunchClip", project: name });
      warnings.push(...notesOut);
      files.fcpxml = await writeText(file, xml);
      const problemsOut = checkFcpxmlRoundTrip(timeline, xml, { absolute });
      const dtd = options.dtd ?? process.env.LAUNCHCLIP_FCPXML_DTD ?? FCPXML_DTD_CANDIDATES.find((candidate) => existsSync(candidate));
      let dtdResult = { status: "skipped", reason: "Apple's FCPXML 1.10 DTD is not available offline (Final Cut Pro is not installed); structural checks only" };
      if (dtd && existsSync(dtd)) {
        try { await adapters.xmllint(path.join(exportDir, file), dtd); dtdResult = { status: "passed", dtd }; }
        catch (error) { dtdResult = { status: "failed", dtd, error: String(error.stderr ?? error.message).trim().split("\n").slice(0, 12).join("\n") }; }
      }
      validation.fcpxml = { status: problemsOut.length || dtdResult.status === "failed" ? "failed" : "passed", structural: problemsOut, dtd: dtdResult };
    } else if (format === "premiere") {
      const { xml, warnings: notesOut } = writeXmeml(timeline, { absolute });
      warnings.push(...notesOut);
      files.premiere = await writeText(file, xml);
      const problemsOut = checkXmemlRoundTrip(timeline, xml, { absolute });
      validation.premiere = { status: problemsOut.length ? "failed" : "passed", round_trip: problemsOut };
    } else if (format === "edl") {
      const { edl, warnings: notesOut } = writeEdl(timeline, { title: name });
      warnings.push(...notesOut);
      files.edl = await writeText(file, edl);
      const problemsOut = checkEdlRoundTrip(timeline, edl, srt);
      validation.edl = { status: problemsOut.length ? "failed" : "passed", round_trip: problemsOut };
    } else if (format === "otio") {
      const { otio } = writeOtio(timeline, { absolute });
      files.otio = await writeText(file, otio);
      const problemsOut = checkOtioRoundTrip(timeline, otio);
      validation.otio = { status: problemsOut.length ? "failed" : "passed", round_trip: problemsOut };
    }
  }
  const python = await adapters.otioCheck(Object.fromEntries(Object.entries(files).filter(([key]) => key === "otio" || key === "fcpxml").map(([key, file]) => [key, path.join(exportDir, file)])));
  if (python) validation.opentimelineio = python;
  files.timeline = await writeText("timeline.json", `${JSON.stringify(stripSources(timeline), null, 2)}\n`);

  const failed = Object.entries(validation).filter(([, entry]) => entry.status === "failed").map(([key]) => key);
  const report = {
    schema_version: EXPORT_REPORT_VERSION,
    status: failed.length ? "failed" : "exported",
    project,
    export_dir: exportDir,
    name,
    formats,
    overlays: { mode, renderer: mode === "none" ? null : "remotion", clips: overlayReport, cameras: plan.cameras.map((camera) => camera.sceneId) },
    ...(subjectReport ? { subject: subjectReport } : {}),
    rate: { num: rate.num, den: rate.den, fps: rate.label, drop_frame: rate.dropFrame },
    duration_frames: timeline.duration,
    files,
    media: timeline.assets.map((asset) => ({ path: asset.path, kind: asset.kind, role: asset.role, frames: asset.duration })),
    copied,
    tracks: [...timeline.tracks, timeline.captions].map((track) => ({ id: track.id, name: track.name, kind: track.kind, role: track.role ?? null, enabled: track.enabled !== false, clips: track.clips.length })),
    markers: timeline.markers.length,
    validation,
    warnings: [...new Set(warnings)],
    notes,
    summary: timelineSummary(timeline)
  };
  await writeFile(path.join(exportDir, "EXPORT.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

/** Human summary of an export report. */
export function formatExportSummary(report) {
  const lines = [`launchclip export: ${report.status} → ${report.export_dir}`];
  for (const [key, file] of Object.entries(report.files)) lines.push(`  ${key.padEnd(9)} ${file}`);
  lines.push(`overlays: ${report.overlays.mode}${report.overlays.clips.length ? ` (${report.overlays.clips.filter((clip) => clip.status === "rendered").length} rendered, ${report.overlays.clips.filter((clip) => clip.status === "cached").length} reused)` : ""}`);
  for (const [key, entry] of Object.entries(report.validation)) {
    const detail = entry.dtd ? ` (DTD ${entry.dtd.status})` : entry.reason ? ` (${entry.reason})` : "";
    lines.push(`  check ${key.padEnd(15)} ${entry.status}${detail}`);
    for (const problem of [...(entry.structural ?? []), ...(entry.round_trip ?? [])].slice(0, 6)) lines.push(`    - ${problem}`);
  }
  lines.push(report.summary.trimEnd());
  for (const warning of report.warnings) lines.push(`warning: ${warning}`);
  lines.push(`report: ${path.join(report.export_dir, "EXPORT.json")}`);
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Project loading and media discovery

export async function loadProjectStory(project) {
  const finishCopy = path.join(project, ".launchclip", "finish", "storyboard.json");
  const storyFile = existsSync(finishCopy) ? finishCopy : path.join(project, "storyboard.json");
  if (!existsSync(storyFile)) throw new Error(`launchclip export needs ${path.join(project, "storyboard.json")}`);
  const story = JSON.parse(await readFile(storyFile, "utf8"));
  const validation = validateStory(story);
  if (!validation.ok) throw new Error(`storyboard is invalid:\n- ${validation.errors.join("\n- ")}`);
  const words = narrationWords((await readOptionalJson(narrationFile(project, story))) ?? []);
  const beats = await readOptionalJson(path.join(project, "BEATS.json"));
  const edl = await readStoryEdl(project, story);
  const resolved = resolveStory(story, { words, beats, edl });
  const warnings = [];
  if (storyFile !== finishCopy) warnings.push("no launchclip finish copy found; exporting storyboard.json as authored (run launchclip finish first for the voice, mix, SFX and captions)");
  return { file: storyFile, story, resolved, words, warnings };
}

async function collectMedia(project, story, adapters, warnings) {
  const media = {};
  const projectPath = (value) => (typeof value === "string" ? path.resolve(project, value) : null);
  const located = (file) => {
    if (!file) return null;
    if (existsSync(file)) return file;
    // AUDIO-MANIFEST.json holds absolute paths; fall back to the same file under this project.
    const marker = file.lastIndexOf("/assets/");
    const local = marker >= 0 ? path.join(project, file.slice(marker + 1)) : null;
    return local && existsSync(local) ? local : null;
  };
  const probe = async (file) => {
    try { return await adapters.probe(file); }
    catch (error) { warnings.push(`cannot probe ${rel(project, file)}: ${error.message}`); return null; }
  };

  const base = storyBase(story);
  if (base) {
    const file = projectPath(base.src);
    const info = existsSync(file) ? await probe(file) : null;
    if (info) media.base = { source: file, duration: info.duration, hasAudio: info.hasAudio, audioChannels: info.audioChannels, audioRate: info.audioRate, width: info.width, height: info.height };
  }

  const manifest = await readOptionalJson(path.join(project, "AUDIO-MANIFEST.json"));
  const voiceFile = located(manifest?.voiceover?.path) ?? (story.lane !== "footage-led" ? existingProjectFile(project, story.audio?.voice) : null);
  if (voiceFile) {
    const info = await probe(voiceFile);
    if (info) media.voice = { source: voiceFile, duration: info.duration, audioChannels: info.audioChannels, audioRate: info.audioRate };
  }
  const musicFile = located(manifest?.music?.path);
  if (musicFile) {
    const info = await probe(musicFile);
    if (info) media.music = { source: musicFile, duration: info.duration, volume: Number(manifest.music.volume ?? 1), ducked: Boolean(manifest.mix?.ducking), audioChannels: info.audioChannels, audioRate: info.audioRate };
  }
  const sfxManifest = await readOptionalJson(located(manifest?.sfx_manifest) ?? path.join(project, "qa", "sfx.json"));
  if (manifest && Array.isArray(sfxManifest?.cues)) {
    media.sfx = [];
    const durations = new Map();
    for (const cue of sfxManifest.cues) {
      // Typing cues mark lines of the typing track, which is one timeline-length file (below).
      if (cue.cue === "typing" || cue.source === "typing") continue;
      const file = located(cue.file);
      if (!file) { warnings.push(`SFX ${cue.id ?? cue.cue} file not found: ${cue.file}`); continue; }
      if (!durations.has(file)) durations.set(file, await probe(file));
      const info = durations.get(file);
      if (!info) continue;
      media.sfx.push({ id: cue.id, cue: cue.cue, source: file, at: Number(cue.at_seconds), volume: Number(cue.volume ?? 1), duration: info.duration, shot: cue.shot_id ?? null, audioChannels: info.audioChannels, audioRate: info.audioRate });
    }
  }
  const typingFile = manifest ? located(sfxManifest?.typing?.file) : null;
  if (typingFile) {
    const info = await probe(typingFile);
    if (info) media.typing = { source: typingFile, duration: info.duration, keystrokes: Array.isArray(sfxManifest.typing.keystrokes) ? sfxManifest.typing.keystrokes.length : null, audioChannels: info.audioChannels, audioRate: info.audioRate };
  }
  const mixFile = located(manifest?.mix?.path) ?? existingProjectFile(project, story.audio?.mix);
  if (mixFile) {
    const info = await probe(mixFile);
    if (info) media.mix = { source: mixFile, duration: info.duration, audioChannels: info.audioChannels, audioRate: info.audioRate };
  }

  const overlay = (story.overlays ?? []).find((entry) => entry?.type === "captions" && entry.style !== "none");
  if (overlay) {
    const captionsFile = existingProjectFile(project, overlay.src);
    if (captionsFile) media.captions = captionChunksFrom(JSON.parse(await readFile(captionsFile, "utf8")));
    else {
      const words = narrationWords((await readOptionalJson(narrationFile(project, story))) ?? []);
      if (words.length) media.captions = chunkWords(words);
    }
  }

  const finish = await readOptionalJson(path.join(project, "finish.json"));
  const renderFile = [finish?.final, path.join(project, "renders", "final.mp4"), path.join(project, "renders", "draft.mp4")].find((file) => file && existsSync(file));
  if (renderFile) {
    const info = await probe(renderFile);
    if (info) media.render = { source: renderFile, duration: info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio };
  } else warnings.push("no finished render found (renders/final.mp4 or renders/draft.mp4); the timeline has no reference track");
  return media;
}

function existingProjectFile(project, value) {
  if (typeof value !== "string") return null;
  const file = path.resolve(project, value);
  return existsSync(file) ? file : null;
}

// ---------------------------------------------------------------------------
// Tools

/** ffprobe a media file → {duration, frames, width, height, pixFmt, hasVideo, hasAudio, audioChannels, audioRate}. */
export async function probeMedia(file) {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,pix_fmt,nb_frames,channels,sample_rate,duration", "-of", "json", file], { maxBuffer: 1 << 24 });
  const data = JSON.parse(stdout);
  const video = data.streams?.find((stream) => stream.codec_type === "video");
  const audio = data.streams?.find((stream) => stream.codec_type === "audio");
  return {
    duration: Number(data.format?.duration ?? video?.duration ?? audio?.duration ?? 0),
    frames: video?.nb_frames ? Number(video.nb_frames) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    pixFmt: video?.pix_fmt ?? null,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    audioChannels: audio?.channels ?? null,
    audioRate: audio?.sample_rate ? Number(audio.sample_rate) : null
  };
}

/** A solid-colour H.264 plate for motion lanes (V1). */
export async function makePlate(file, { color, width, height, rate, duration }) {
  await mkdir(path.dirname(file), { recursive: true });
  const frames = Math.ceil(duration * rate.num / rate.den);
  await execFileAsync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=0x${color.slice(1)}:s=${width}x${height}:r=${rate.num}/${rate.den}`, "-frames:v", String(frames), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-tune", "stillimage", "-crf", "18", file], { maxBuffer: 1 << 24 });
}

/**
 * A presenter matte (VP9 WebM with alpha) as ProRes 4444 with alpha, or a PNG
 * sequence for --overlays png. libvpx-vp9 must decode it: ffmpeg's native VP9
 * decoder drops the alpha plane.
 */
export async function transcodeMatte(source, outFile, { mode = "prores4444" } = {}) {
  const decode = ["-y", "-v", "error", "-c:v", "libvpx-vp9", "-i", source, "-an"];
  if (mode === "png") {
    await rm(outFile, { recursive: true, force: true });
    await mkdir(outFile, { recursive: true });
    await execFileAsync("ffmpeg", [...decode, "-c:v", "png", "-pix_fmt", "rgba", "-start_number", "0", path.join(outFile, "frame-%05d.png")], { maxBuffer: 1 << 24 });
    return { kind: "png-sequence", source: outFile, ...(await sequencePattern(outFile)) };
  }
  await execFileAsync("ffmpeg", [...decode, "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-alpha_bits", "16", "-vendor", "apl0", outFile], { maxBuffer: 1 << 24 });
  return { kind: "mov", source: outFile };
}

// When the Python OpenTimelineIO package is installed, read the .otio (and the
// FCPXML through its adapter, when that plugin is present) as an extra check.
async function otioPythonCheck(files) {
  if (!files.otio && !files.fcpxml) return null;
  const script = [
    "import json, sys",
    "try:",
    "    import opentimelineio as otio",
    "except ImportError:",
    "    print(json.dumps({'status': 'skipped', 'reason': 'Python opentimelineio is not installed'})); sys.exit(0)",
    "out = {'status': 'passed', 'version': otio.__version__, 'files': {}}",
    "for key, path in json.loads(sys.argv[1]).items():",
    "    try:",
    "        t = otio.adapters.read_from_file(path)",
    "        out['files'][key] = {'tracks': len(t.tracks), 'clips': len(list(t.find_clips())), 'duration': t.duration().to_seconds()}",
    "    except Exception as e:",
    "        out['files'][key] = {'error': str(e)[:300]}",
    "        if key == 'otio': out['status'] = 'failed'",
    "print(json.dumps(out))"
  ].join("\n");
  try {
    const { stdout } = await execFileAsync("python3", ["-I", "-c", script, JSON.stringify(files)], { maxBuffer: 1 << 22, timeout: 60_000 });
    return JSON.parse(stdout.trim().split("\n").at(-1));
  } catch (error) {
    return { status: "skipped", reason: `python3 is not available (${String(error.message).split("\n")[0]})` };
  }
}

// ---------------------------------------------------------------------------
// Helpers

function stripSources(timeline) {
  return { ...timeline, assets: timeline.assets.map(({ source, ...asset }) => asset) };
}

/** ffprobe pix_fmt names that carry an alpha channel (yuva444p10le, rgba, gbrap, …). */
export function hasAlpha(pixFmt) {
  return /^(yuva|rgba|argb|bgra|abgr|gbrap|ya\d|pal8)/.test(String(pixFmt ?? ""));
}

// A copy is current when it has the source's size and is not older than it.
async function sameFile(a, b) {
  try {
    const [left, right] = await Promise.all([stat(a), stat(b)]);
    return left.size === right.size && right.mtimeMs >= left.mtimeMs;
  } catch { return false; }
}

async function treeFingerprint(directories) {
  const entries = [];
  const walk = async (dir) => {
    let names;
    try { names = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of names.sort((x, y) => x.name.localeCompare(y.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) { const info = await stat(full); entries.push(`${full}:${info.size}:${Math.round(info.mtimeMs)}`); }
    }
  };
  for (const directory of directories) await walk(directory);
  return hashValue(entries.join("\n"));
}

function hashValue(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function safeName(value) {
  return String(value).trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "launchclip";
}

function rel(from, file) {
  return path.relative(from, file) || ".";
}

function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

async function readOptionalJson(file) {
  if (!file) return null;
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT" || error.code === "EISDIR") return null; throw error; }
}

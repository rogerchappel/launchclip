import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, realpath, link, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { probeMedia } from "./media_trim.js";
import { RECORDING_EDIT_VERSION } from "./recording_edit.js";
const execute = promisify(execFile);

/** Render accepted keep ranges with synchronized A/V; never overwrite source media. */
export async function editRecording(inputPath, outputPath, plan, options = {}, adapters = {}) {
  const input = await realpath(path.resolve(inputPath));
  const output = path.resolve(outputPath);
  let existing = null;
  try { existing = await realpath(output); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (input === output || input === existing) throw new Error("Recording edit output must differ from source");
  if (existing) throw new Error("Recording edit output already exists");
  const probe = await (adapters.probeMedia ?? probeMedia)(input);
  const duration = Number(probe.format?.duration);
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
  if (!video || !audio) throw new Error("Recording edit requires video and audio streams");
  validate(plan, duration);
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = await mkdtemp(path.join(path.dirname(output), ".launchclip-edit-"));
  try {
    const run = adapters.run ?? execute;
    const crf = options.crf ?? 18;
    if (!Number.isInteger(crf) || crf < 0 || crf > 51) throw new Error("crf must be an integer between 0 and 51");
    const frameRate = video.r_frame_rate && video.r_frame_rate !== "0/0" ? video.r_frame_rate : video.avg_frame_rate;
    if (typeof frameRate !== "string" || !/^\d+(?:\/\d+)?$/.test(frameRate) || frameRate.startsWith("0")) throw new Error("Recording video requires a known frame rate");
    const entries = [];
    // Decode one range at a time. A fan-out trim graph can retain future ranges
    // in memory while concat consumes the first, especially for UHD recordings.
    for (const [index, segment] of plan.kept_segments.entries()) {
      const name = `segment-${index}.mkv`;
      const file = path.join(temporary, name);
      await run("ffmpeg", ["-hide_banner", "-nostdin", "-ss", String(segment.source_start_seconds), "-i", input,
        "-t", String(segment.source_end_seconds - segment.source_start_seconds), "-map", "0:v:0", "-map", "0:a:0",
        "-c:v", "libx264", "-crf", String(crf), "-preset", "medium", "-threads", "2", "-pix_fmt", "yuv420p",
        "-c:a", "pcm_s16le", file], { maxBuffer: 16 * 1024 * 1024 });
      // Matroska's duration includes the rounded final video frame. Use the
      // planned speech interval for the next segment's origin rather than
      // accumulating that frame rounding at every cut.
      entries.push(`file '${name}'`, `duration ${segment.source_end_seconds - segment.source_start_seconds}`);
    }
    const list = path.join(temporary, "segments.txt");
    await writeFile(list, `${entries.join("\n")}\n`);
    const rendered = path.join(temporary, "edited.mp4");
    // PCM intermediates avoid separate AAC encoder priming at every join.
    // Resolve sub-frame video joins onto one continuous source-rate frame grid;
    // packet copying would preserve overlapping frames as a faster VFR stream.
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-f", "concat", "-safe", "1", "-i", list,
      "-map", "0:v:0", "-map", "0:a:0", "-c:v", "libx264", "-crf", String(crf), "-preset", "medium", "-threads", "2",
      "-r", frameRate, "-fps_mode", "cfr", "-t", String(plan.duration_seconds), "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart", rendered], { maxBuffer: 16 * 1024 * 1024 });
    await stat(rendered);
    const renderedProbe = await (adapters.probeMedia ?? probeMedia)(rendered);
    const renderedDuration = Number(renderedProbe.format?.duration);
    if (!Number.isFinite(renderedDuration) || Math.abs(renderedDuration - plan.duration_seconds) > 0.15) throw new Error(`Rendered recording edit duration differs from plan: planned ${plan.duration_seconds.toFixed(6)}s, rendered ${renderedDuration.toFixed(6)}s`);
    // A final existence check protects files created while rendering.
    try { await stat(output); throw new Error("Recording edit output was created while rendering"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    await link(rendered, output);
    return { input, output, source_duration_seconds: duration, duration_seconds: plan.duration_seconds, rendered_duration_seconds: renderedDuration, kept_segments: plan.kept_segments.length, changed: plan.removed_segments.length > 0 };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

function validate(plan, duration) {
  if (plan?.schema_version !== RECORDING_EDIT_VERSION || !Array.isArray(plan.kept_segments) || !plan.kept_segments.length) throw new Error("Invalid recording edit plan");
  if (!Number.isFinite(duration) || Math.abs(plan.source_duration_seconds - duration) > 0.1) throw new Error("Recording edit plan does not match source duration");
  let prior = 0;
  let clock = 0;
  for (const segment of plan.kept_segments) {
    const { source_start_seconds: start, source_end_seconds: end, start_seconds: editStart, end_seconds: editEnd } = segment;
    if (![start, end, editStart, editEnd].every(Number.isFinite) || start < prior || end <= start || end > duration + 0.001 || Math.abs(editStart - clock) > 0.001 || Math.abs(editEnd - (clock + end - start)) > 0.001) throw new Error("Invalid recording edit segment timing");
    prior = end;
    clock = editEnd;
  }
  if (!Number.isFinite(plan.duration_seconds) || Math.abs(clock - plan.duration_seconds) > 0.001 || !Array.isArray(plan.removed_segments)) throw new Error("Invalid recording edit duration");
}

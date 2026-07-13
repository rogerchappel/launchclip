import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_SILENCE_DURATION = 0.45;
export const DEFAULT_SILENCE_PADDING = 0.12;

export function parseSilenceDetect(stderr, duration, padding = DEFAULT_SILENCE_PADDING) {
  const segments = [];
  let pendingStart = null;
  for (const line of String(stderr).split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*([0-9.]+)/);
    if (start) {
      pendingStart = Number(start[1]);
      continue;
    }
    const end = line.match(/silence_end:\s*([0-9.]+)/);
    if (end && pendingStart !== null) {
      segments.push({ start: pendingStart, end: Number(end[1]) });
      pendingStart = null;
    }
  }
  if (pendingStart !== null) segments.push({ start: pendingStart, end: duration });

  const first = segments[0];
  const last = segments[segments.length - 1];
  const leadingSilence = first && first.start <= 0.2 ? first : null;
  const trailingSilence = last && last.end >= duration - 0.25 ? last : null;
  return {
    // Padding is a speech handle: preserve a small amount of room around the
    // detected voice instead of cutting farther into it.
    start: leadingSilence ? Math.max(0, leadingSilence.end - padding) : 0,
    end: trailingSilence ? Math.min(duration, trailingSilence.start + padding) : duration,
    leadingSilence,
    trailingSilence
  };
}

export async function probeMedia(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    filePath
  ], { maxBuffer: 1024 * 1024 * 4 });
  return JSON.parse(stdout);
}

export async function detectSilenceTrim(inputPath, options = {}) {
  const input = path.resolve(inputPath);
  const probe = options.probe ?? await probeMedia(input);
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(options.duration ?? probe.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not determine media duration for ${input}`);
  if (!audio) {
    return { start: 0, end: duration, leadingSilence: null, trailingSilence: null, thresholdDb: null };
  }
  const silenceDuration = positiveNumber(options.silenceDuration, DEFAULT_SILENCE_DURATION, "silence-duration");
  const silencePadding = nonNegativeNumber(options.silencePadding, DEFAULT_SILENCE_PADDING, "silence-padding");
  const thresholdDb = options.thresholdDb ?? await loudnessThreshold(input);
  const { stderr } = await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-nostats",
    "-i",
    input,
    "-map",
    "0:a:0",
    "-af",
    `silencedetect=noise=${thresholdDb}dB:d=${silenceDuration}`,
    "-f",
    "null",
    "-"
  ], { maxBuffer: 1024 * 1024 * 8 });
  return { ...parseSilenceDetect(stderr, duration, silencePadding), thresholdDb };
}

export async function trimMediaSilence(inputPath, outputPath, options = {}) {
  const input = path.resolve(inputPath);
  const output = path.resolve(outputPath);
  const probe = await probeMedia(input);
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
  const sourceDuration = Number(probe.format?.duration ?? video?.duration ?? audio?.duration);
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) throw new Error(`Could not determine media duration for ${input}`);
  if (!audio) throw new Error(`No audio stream found for silence trimming: ${input}`);

  const trim = await detectSilenceTrim(input, { ...options, duration: sourceDuration, probe });
  if (trim.end <= trim.start) throw new Error(`Invalid trim range ${trim.start.toFixed(3)}-${trim.end.toFixed(3)} for ${input}`);
  const changed = trim.start > 0.001 || trim.end < sourceDuration - 0.001;
  if (!changed) {
    return {
      input,
      output: input,
      changed: false,
      trim,
      source_duration_seconds: sourceDuration,
      rendered_duration_seconds: sourceDuration
    };
  }

  await mkdir(path.dirname(output), { recursive: true });
  const args = [
    "-y",
    "-ss",
    trim.start.toFixed(3),
    "-t",
    (trim.end - trim.start).toFixed(3),
    "-i",
    input
  ];
  if (video) {
    args.push("-map", "0:v:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", String(options.crf ?? 18));
  } else {
    args.push("-vn");
  }
  args.push("-map", "0:a:0", "-c:a", "aac", "-b:a", String(options.audioBitrate ?? "192k"), "-movflags", "+faststart", output);
  await execFileAsync("ffmpeg", args, { maxBuffer: 1024 * 1024 * 16 });
  const renderedProbe = await probeMedia(output);
  return {
    input,
    output,
    changed: true,
    trim,
    source_duration_seconds: sourceDuration,
    rendered_duration_seconds: Number(renderedProbe.format?.duration ?? 0)
  };
}

async function loudnessThreshold(input) {
  const { stderr } = await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-nostats",
    "-i",
    input,
    "-map",
    "0:a:0",
    "-af",
    "loudnorm=print_format=json",
    "-f",
    "null",
    "-"
  ], { maxBuffer: 1024 * 1024 * 8 });
  const match = stderr.match(/\{[\s\S]*"input_thresh"\s*:\s*"(-?[0-9.]+)"[\s\S]*\}/);
  if (!match) return -35;
  return Math.max(-60, Math.min(-20, Number(match[1])));
}

function positiveNumber(value, fallback, label) {
  const parsed = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${label} must be a positive number`);
  return parsed;
}

function nonNegativeNumber(value, fallback, label) {
  const parsed = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--${label} must be a non-negative number`);
  return parsed;
}

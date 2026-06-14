import { mkdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_WIDTH = 720;
const DEFAULT_HEIGHT = 1280;
const DEFAULT_SPEED = 1.08;
const DEFAULT_SILENCE_DURATION = 0.45;
const DEFAULT_SILENCE_PADDING = 0.12;

export async function preprocessPresenter(inputPath, flags = {}) {
  const input = path.resolve(inputPath);
  const output = path.resolve(flags.out ?? defaultOutput(input));
  const outputWidth = positiveInt(flags.width, DEFAULT_WIDTH, "width");
  const outputHeight = positiveInt(flags.height, DEFAULT_HEIGHT, "height");
  const speed = positiveNumber(flags.speed, DEFAULT_SPEED, "speed");
  const silenceDuration = positiveNumber(flags["silence-duration"], DEFAULT_SILENCE_DURATION, "silence-duration");
  const silencePadding = nonNegativeNumber(flags["silence-padding"], DEFAULT_SILENCE_PADDING, "silence-padding");

  const probe = await probeMedia(input);
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  if (!video) throw new Error(`No video stream found in ${input}`);
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  const sourceDuration = Number(probe.format?.duration ?? video.duration);
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    throw new Error(`Could not determine media duration for ${input}`);
  }

  const manualTrim = {
    start: flags["trim-start"] === undefined ? null : nonNegativeNumber(flags["trim-start"], 0, "trim-start"),
    end: flags["trim-end"] === undefined ? null : positiveNumber(flags["trim-end"], sourceDuration, "trim-end")
  };
  const detectedTrim = flags["no-trim-silence"] || !audio
    ? { start: 0, end: sourceDuration, leadingSilence: null, trailingSilence: null, thresholdDb: null }
    : await detectSilenceTrim(input, sourceDuration, { silenceDuration, silencePadding });
  const trim = {
    ...detectedTrim,
    start: manualTrim.start ?? detectedTrim.start,
    end: manualTrim.end ?? detectedTrim.end
  };
  if (trim.end <= trim.start) {
    throw new Error(`Invalid trim range ${trim.start.toFixed(3)}-${trim.end.toFixed(3)} for ${input}`);
  }

  const videoFilter = buildVideoFilter({
    inputWidth: Number(video.width),
    inputHeight: Number(video.height),
    outputWidth,
    outputHeight,
    cropX: flags["crop-x"] ?? "center",
    cropY: flags["crop-y"] ?? "center",
    speed
  });
  const audioFilter = audio ? atempoFilter(speed) : null;
  await mkdir(path.dirname(output), { recursive: true });
  await execFileAsync("ffmpeg", buildFfmpegArgs({
    input,
    output,
    start: trim.start,
    duration: trim.end - trim.start,
    videoFilter,
    audioFilter,
    hasAudio: Boolean(audio),
    crf: flags.crf ?? "20"
  }), { maxBuffer: 1024 * 1024 * 16 });

  const outputProbe = await probeMedia(output);
  return {
    stage: "preprocess-presenter",
    input,
    output,
    speed,
    trim,
    source: {
      width: Number(video.width),
      height: Number(video.height),
      duration_seconds: sourceDuration,
      has_audio: Boolean(audio)
    },
    rendered: {
      width: outputWidth,
      height: outputHeight,
      duration_seconds: Number(outputProbe.format?.duration ?? 0)
    },
    filters: {
      video: videoFilter,
      audio: audioFilter
    }
  };
}

export function buildVideoFilter({ inputWidth, inputHeight, outputWidth = DEFAULT_WIDTH, outputHeight = DEFAULT_HEIGHT, cropX = "center", cropY = "center", speed = DEFAULT_SPEED }) {
  const sourceW = positiveInt(inputWidth, 0, "inputWidth");
  const sourceH = positiveInt(inputHeight, 0, "inputHeight");
  const targetAspect = outputWidth / outputHeight;
  let cropW = sourceW;
  let cropH = Math.round(sourceW / targetAspect);
  if (cropH > sourceH) {
    cropH = sourceH;
    cropW = Math.round(sourceH * targetAspect);
  }
  cropW = even(Math.min(sourceW, cropW));
  cropH = even(Math.min(sourceH, cropH));
  const x = cropOffset(cropX, sourceW, cropW, "x");
  const y = cropOffset(cropY, sourceH, cropH, "y");
  return `crop=${cropW}:${cropH}:${x}:${y},scale=${outputWidth}:${outputHeight},setpts=PTS/${formatSpeed(speed)}`;
}

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
    start: leadingSilence ? Math.min(duration, leadingSilence.end + padding) : 0,
    end: trailingSilence ? Math.max(0, trailingSilence.start - padding) : duration,
    leadingSilence,
    trailingSilence
  };
}

export function atempoFilter(speed) {
  const filters = [];
  let remaining = positiveNumber(speed, DEFAULT_SPEED, "speed");
  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining.toFixed(4)}`);
  return filters.join(",");
}

async function detectSilenceTrim(input, duration, { silenceDuration, silencePadding }) {
  const thresholdDb = await loudnessThreshold(input);
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

async function probeMedia(filePath) {
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

function buildFfmpegArgs({ input, output, start, duration, videoFilter, audioFilter, hasAudio, crf }) {
  const args = [
    "-y",
    "-ss",
    start.toFixed(3),
    "-t",
    duration.toFixed(3),
    "-i",
    input,
    "-map",
    "0:v:0",
    "-vf",
    videoFilter,
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "medium",
    "-crf",
    String(crf)
  ];
  if (hasAudio) {
    args.push("-map", "0:a:0", "-filter:a", audioFilter, "-c:a", "aac", "-b:a", "160k");
  } else {
    args.push("-an");
  }
  args.push("-movflags", "+faststart", output);
  return args;
}

function cropOffset(value, source, crop, axis) {
  const max = Math.max(0, source - crop);
  const raw = String(value ?? "center");
  if (raw === "center" || raw === "middle") return even(Math.round(max / 2));
  if (raw === "left" || raw === "top") return 0;
  if (raw === "right" || raw === "bottom") return even(max);
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) return even(Math.max(0, Math.min(max, Math.round(parsed))));
  throw new Error(`Invalid crop-${axis}: ${value}`);
}

function positiveInt(value, fallback, label) {
  const parsed = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--${label} must be a positive integer`);
  return parsed;
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

function even(value) {
  return Math.max(0, Math.floor(value / 2) * 2);
}

function formatSpeed(speed) {
  return Number(speed).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function defaultOutput(input) {
  const ext = path.extname(input) || ".mp4";
  const stem = path.basename(input, ext);
  return path.join(path.dirname(input), `${stem}-preprocessed.mp4`);
}

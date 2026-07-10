import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function analyzeProductionAudio(videoPath, manifestPath, options = {}, adapters = {}) {
  const run = adapters.run ?? runCommand;
  const manifest = manifestPath ? JSON.parse(await readFile(path.resolve(manifestPath), "utf8")) : { voiceover: null, music: null, sfx_manifest: null };
  const probe = JSON.parse((await run("ffprobe", ["-v", "error", "-show_entries", "stream=index,codec_type,codec_name,channels,sample_rate:format=duration", "-of", "json", path.resolve(videoPath)])).stdout);
  const audioStream = (probe.streams ?? []).find((entry) => entry.codec_type === "audio") ?? null;
  const expectedAudio = Boolean(manifest.voiceover || manifest.music || manifest.sfx_manifest);
  const output = audioStream ? await loudnessAndPeaks(path.resolve(videoPath), run) : null;
  const [voiceover, music] = await Promise.all([
    manifest.voiceover?.path ? loudnessAndPeaks(path.resolve(manifest.voiceover.path), run) : null,
    manifest.music?.path ? loudnessAndPeaks(path.resolve(manifest.music.path), run) : null
  ]);
  const sfx = manifest.sfx_manifest ? JSON.parse(await readFile(path.resolve(manifest.sfx_manifest), "utf8")) : { cues: [] };
  const cues = (sfx.cues ?? []).map((cue) => cueEvidence(cue, output?.peaks ?? []));
  const report = {
    schema_version: "launchclip.render-audio.v1",
    video: path.resolve(videoPath),
    duration_seconds: Number(probe.format?.duration ?? 0),
    expected_audio: expectedAudio,
    stream: audioStream,
    output,
    sources: { voiceover, music, music_gain_db: round(20 * Math.log10(Number(options.musicVolume ?? .16))) },
    cues,
  };
  report.quality = evaluateAudioQuality(report, options);
  return report;
}

export async function writeAudioReport(videoPath, manifestPath, outputPath, options = {}, adapters = {}) {
  const report = await analyzeProductionAudio(videoPath, manifestPath, options, adapters);
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await writeFile(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function evaluateAudioQuality(report, options = {}) {
  const findings = [];
  if (report.expected_audio && !report.stream) findings.push(finding("audio-stream", "blocking", "Rendered video has no audio stream despite a produced audio manifest."));
  if (report.output?.true_peak_dbfs != null && report.output.true_peak_dbfs > Number(options.maximumTruePeakDbfs ?? -.1)) {
    findings.push(finding("clipping", "major", `Rendered true peak is ${report.output.true_peak_dbfs} dBFS.`));
  }
  if (report.sources.voiceover && report.sources.music) {
    const adjustedMusic = report.sources.music.integrated_lufs + report.sources.music_gain_db;
    const margin = report.sources.voiceover.integrated_lufs - adjustedMusic;
    if (margin < Number(options.minimumVoiceMusicMarginDb ?? 6)) findings.push(finding("masking", "major", `Estimated voice-to-music margin is ${round(margin)} dB; expected at least ${options.minimumVoiceMusicMarginDb ?? 6} dB.`));
  }
  if (report.sources.voiceover && report.output?.silence_ratio > Number(options.maximumNarratedSilenceRatio ?? .25)) {
    findings.push(finding("silence", "major", `Rendered audio is near-silent for ${(report.output.silence_ratio * 100).toFixed(1)}% of analyzed windows while narration is expected.`));
  }
  if (report.cues.length && report.cues.filter((cue) => cue.transient_delta_db >= Number(options.minimumCueTransientDb ?? 1)).length / report.cues.length < .5) {
    findings.push(finding("sfx-sync", "minor", "Fewer than half of planned SFX cues have a measurable transient at their scheduled time."));
  }
  return { ok: !findings.some((entry) => entry.severity === "blocking" || entry.severity === "major"), findings };
}

async function loudnessAndPeaks(filePath, run) {
  const loudness = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", filePath, "-filter_complex", "ebur128=peak=true", "-f", "null", "-"]);
  const peakFrames = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", filePath, "-af", "asetnsamples=n=2048,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.Peak_level:file=-", "-f", "null", "-"]);
  const text = `${loudness.stdout ?? ""}\n${loudness.stderr ?? ""}`;
  const integrated = [...text.matchAll(/\bI:\s*(-?(?:\d+(?:\.\d+)?|inf))\s+LUFS/g)].at(-1)?.[1];
  const truePeak = [...text.matchAll(/\bPeak:\s*(-?(?:\d+(?:\.\d+)?|inf))\s+dBFS/g)].at(-1)?.[1];
  const peaks = parsePeakSeries(`${peakFrames.stdout ?? ""}\n${peakFrames.stderr ?? ""}`);
  const finitePeaks = peaks.map((entry) => entry.peak_dbfs).filter(Number.isFinite);
  return {
    integrated_lufs: numeric(integrated),
    true_peak_dbfs: numeric(truePeak),
    silence_ratio: peaks.length ? round(peaks.filter((entry) => !Number.isFinite(entry.peak_dbfs) || entry.peak_dbfs <= -50).length / peaks.length, 4) : null,
    median_peak_dbfs: finitePeaks.length ? round(quantile(finitePeaks.sort((a, b) => a - b), .5)) : null,
    peaks
  };
}

export function parsePeakSeries(text) {
  const output = [];
  let time = null;
  for (const line of String(text).split(/\r?\n/)) {
    const frame = line.match(/\bpts_time:([-+0-9.eE]+)/);
    if (frame) time = Number(frame[1]);
    const peak = line.match(/^lavfi\.astats\.Overall\.Peak_level=(-?(?:\d+(?:\.\d+)?|inf))/);
    if (peak && Number.isFinite(time)) output.push({ at_seconds: round(time, 4), peak_dbfs: numeric(peak[1]) });
  }
  return output;
}

function cueEvidence(cue, peaks) {
  const at = Number(cue.at_seconds);
  const near = peaks.filter((entry) => Math.abs(entry.at_seconds - at) <= .12).map((entry) => entry.peak_dbfs).filter(Number.isFinite);
  const baseline = peaks.filter((entry) => Math.abs(entry.at_seconds - at) > .2 && Math.abs(entry.at_seconds - at) <= .7).map((entry) => entry.peak_dbfs).filter(Number.isFinite);
  const peak = near.length ? Math.max(...near) : null;
  const background = baseline.length ? quantile(baseline.sort((a, b) => a - b), .5) : null;
  return { id: cue.id, shot_id: cue.shot_id, at_seconds: at, intent: cue.intent, peak_dbfs: peak, baseline_dbfs: background, transient_delta_db: peak != null && background != null ? round(peak - background) : 0 };
}

function numeric(value) {
  if (value == null || /inf/i.test(String(value))) return String(value).startsWith("-") ? -Infinity : Infinity;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finding(category, severity, message) { return { category, severity, message }; }
function round(value, places = 3) { const factor = 10 ** places; return Math.round(Number(value) * factor) / factor; }
function quantile(sorted, q) { const position = (sorted.length - 1) * q; const lower = Math.floor(position); const upper = Math.ceil(position); return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower); }
async function runCommand(command, args) { return execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 128 }); }

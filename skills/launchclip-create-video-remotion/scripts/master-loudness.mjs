#!/usr/bin/env node
// Two-pass EBU R128 master of a rendered video's audio to the platform target
// (default -14 LUFS integrated, -1 dBTP), copying the video stream untouched.
// loudnorm aims a little under the ceiling (-1.2 dBTP) and a 4x oversampled
// limiter (-1.6 dBFS) catches the inter-sample peaks the AAC encode adds, so
// loudnorm stays in linear mode. A miss lowers the limiter, not loudnorm.
// The limiter chain, the retry and the edge cases (a mix louder than 0 LUFS,
// a silent mix, audio shorter than the picture) follow lemo-opuscar's
// core/render/mux.sh (MIT); the code here is our own.
// Usage: node master-loudness.mjs <input.mp4> <output.mp4> [--lufs -14] [--tp -1] [--lra 11]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

// loudnorm's own aim and the limiter's ceiling, relative to the delivery ceiling (-1 dBTP).
export const LOUDNORM_TP_UNDER = 0.2;
export const LIMITER_UNDER = 0.6;
// A retry lowers the limiter by the overshoot plus this margin.
export const LIMITER_RETRY_MARGIN = 0.3;
// Below this a mix is treated as silent (loudnorm cannot measure it).
export const SILENT_LUFS = -70;
export const TOLERANCE_LU = 1;

export function parseLoudnormJson(stderr) {
  const match = String(stderr).match(/\{\s*"input_i"[\s\S]*?\}/);
  if (!match) throw new Error('FFmpeg loudnorm did not report measurements');
  return JSON.parse(match[0]);
}

export function parseEbur128Summary(stderr) {
  const text = String(stderr);
  const integrated = [...text.matchAll(/\bI:\s*(-?[\d.]+|-?inf)\s+LUFS/g)].at(-1)?.[1];
  const peak = [...text.matchAll(/\bPeak:\s*(-?[\d.]+|-?inf)\s+dBFS/g)].at(-1)?.[1];
  const value = (raw) => (raw === undefined ? NaN : /inf/.test(raw) ? (raw.startsWith('-') ? -Infinity : Infinity) : Number(raw));
  return { integrated_lufs: value(integrated), true_peak_dbtp: value(peak) };
}

const round1 = (value) => Math.round(value * 10) / 10;
const dbToLinear = (db) => Math.min(1, Math.max(0.0625, 10 ** (db / 20)));

/** The audio chain of one pass: optional pre-gain, loudnorm (linear), the 4x oversampled limiter, padding to the picture. */
export function masterFilter({ gain = 0, loudnorm = null, limit, pad = null }) {
  return [
    gain ? `volume=${round1(gain)}dB` : null,
    loudnorm,
    `aresample=192000,alimiter=limit=${dbToLinear(limit).toFixed(6)}:attack=10:release=200:level=disabled:latency=1,aresample=48000`,
    pad ? `apad=whole_dur=${pad}` : null
  ].filter(Boolean).join(',');
}

/** The limiter ceiling for the next pass after an encoded peak, or null when the peak complies. */
export function nextLimit(limit, peak, tp) {
  return peak > tp ? round1(limit - (peak - tp + LIMITER_RETRY_MARGIN)) : null;
}

/** What to do before loudnorm: a silent mix is not normalised, a mix over 0 LUFS is turned down first. */
export function preGain(inputLufs, lufs) {
  if (!(inputLufs > SILENT_LUFS)) return { silent: true, gain: 0 };
  if (inputLufs > 0) return { silent: false, gain: round1(lufs - inputLufs) };
  return { silent: false, gain: 0 };
}

async function probeDuration(file, stream) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', stream, '-show_entries', 'stream=duration:format=duration', '-of', 'json', file]);
  const json = JSON.parse(stdout);
  const value = Number(json.streams?.[0]?.duration ?? (json.streams?.length ? json.format?.duration : NaN));
  return Number.isFinite(value) ? value : null;
}

async function measureEncoded(file) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], { maxBuffer: 1 << 26 });
  return parseEbur128Summary(stderr);
}

async function measureLoudnorm(input, prefix, { lufs, tp, lra }) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', input, '-map', '0:a:0', '-af', `${prefix ? `${prefix},` : ''}loudnorm=I=${lufs}:TP=${tp}:LRA=${lra}:print_format=json`, '-f', 'null', '-'], { maxBuffer: 1 << 26 });
  return parseLoudnormJson(stderr);
}

const encode = (input, output, filter) => run('ffmpeg', ['-hide_banner', '-nostats', '-y', '-i', input, '-map', '0:v?', '-map', '0:a:0', '-c:v', 'copy', '-af', filter, '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', output], { maxBuffer: 1 << 26 });

export async function masterLoudness(input, output, { lufs = -14, tp = -1, lra = 11, attempts = 3 } = {}) {
  const warnings = [];
  const aimTp = round1(tp - LOUDNORM_TP_UNDER);
  let limit = round1(tp - LIMITER_UNDER);
  const [video, audio] = await Promise.all([probeDuration(input, 'v:0'), probeDuration(input, 'a:0')]);
  // Never cut the picture: audio shorter than the video is padded with silence.
  const pad = video && audio && audio < video - 0.01 ? Math.round(video * 1000) / 1000 : null;
  if (pad) warnings.push(`the audio (${audio.toFixed(2)} s) is shorter than the picture (${video.toFixed(2)} s); padded with silence`);
  let measured = await measureLoudnorm(input, '', { lufs, tp: aimTp, lra });
  const pre = preGain(Number(measured.input_i), lufs);
  if (pre.silent) {
    warnings.push(`the mix measures ${measured.input_i} LUFS (silent or under ${SILENT_LUFS}); delivered without normalisation`);
    await encode(input, output, masterFilter({ limit, pad }));
    const encoded = await measureEncoded(output);
    return { target: { integrated_lufs: lufs, true_peak_dbtp: tp, lra }, input: { integrated_lufs: Number(measured.input_i), true_peak_dbtp: Number(measured.input_tp) }, output: encoded, limiter_dbfs: limit, normalization: 'skipped', skipped: 'silent', warnings, compliant: !(encoded.true_peak_dbtp > tp) };
  }
  const prefix = pre.gain ? `volume=${pre.gain}dB` : '';
  if (pre.gain) {
    warnings.push(`the mix measures ${measured.input_i} LUFS (louder than 0, which loudnorm refuses); turned down ${-pre.gain} dB first`);
    measured = await measureLoudnorm(input, prefix, { lufs, tp: aimTp, lra });
  }
  const loudnorm = `loudnorm=I=${lufs}:TP=${aimTp}:LRA=${lra}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true:print_format=json`;
  let encoded;
  let result;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const second = await encode(input, output, masterFilter({ gain: pre.gain, loudnorm, limit, pad }));
    result = parseLoudnormJson(second.stderr);
    encoded = await measureEncoded(output);
    const lower = nextLimit(limit, encoded.true_peak_dbtp, tp);
    if (lower === null || attempt === attempts - 1) break;
    limit = lower;
  }
  return {
    target: { integrated_lufs: lufs, true_peak_dbtp: tp, lra },
    input: { integrated_lufs: Number(measured.input_i), true_peak_dbtp: Number(measured.input_tp) },
    output: encoded,
    loudnorm_tp_dbtp: aimTp,
    limiter_dbfs: limit,
    ...(pre.gain ? { pre_gain_db: pre.gain } : {}),
    ...(pad ? { padded_to_seconds: pad } : {}),
    normalization: result.normalization_type,
    warnings,
    compliant: Math.abs(encoded.integrated_lufs - lufs) <= TOLERANCE_LU && !(encoded.true_peak_dbtp > tp)
  };
}

async function main(argv) {
  const [input, output, ...rest] = argv;
  if (!input || !output) throw new Error('usage: master-loudness.mjs <input> <output> [--lufs -14] [--tp -1] [--lra 11]');
  const flag = (name, fallback) => { const index = rest.indexOf(name); return index >= 0 ? Number(rest[index + 1]) : fallback; };
  console.log(JSON.stringify(await masterLoudness(input, output, { lufs: flag('--lufs', -14), tp: flag('--tp', -1), lra: flag('--lra', 11) }), null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exit(1); });

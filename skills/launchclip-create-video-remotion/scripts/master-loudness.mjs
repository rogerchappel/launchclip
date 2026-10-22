#!/usr/bin/env node
// Two-pass EBU R128 master of a rendered video's audio to the platform target
// (default -14 LUFS integrated, -1 dBTP), copying the video stream untouched.
// Usage: node master-loudness.mjs <input.mp4> <output.mp4> [--lufs -14] [--tp -1] [--lra 11]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

export function parseLoudnormJson(stderr) {
  const match = String(stderr).match(/\{\s*"input_i"[\s\S]*?\}/);
  if (!match) throw new Error('FFmpeg loudnorm did not report measurements');
  return JSON.parse(match[0]);
}

export function parseEbur128Summary(stderr) {
  const text = String(stderr);
  const integrated = [...text.matchAll(/\bI:\s*(-?[\d.]+)\s+LUFS/g)].at(-1)?.[1];
  const peak = [...text.matchAll(/\bPeak:\s*(-?[\d.]+|-?inf)\s+dBFS/g)].at(-1)?.[1];
  return { integrated_lufs: Number(integrated), true_peak_dbtp: Number(peak) };
}

async function measureEncoded(file) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], { maxBuffer: 1 << 26 });
  return parseEbur128Summary(stderr);
}

// The AAC encode can push inter-sample peaks above loudnorm's ceiling, so the
// encoded file is re-measured and the ceiling tightened until it complies.
export async function masterLoudness(input, output, { lufs = -14, tp = -1, lra = 11, attempts = 3 } = {}) {
  const first = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', input, '-af', `loudnorm=I=${lufs}:TP=${tp}:LRA=${lra}:print_format=json`, '-f', 'null', '-'], { maxBuffer: 1 << 26 });
  const measured = parseLoudnormJson(first.stderr);
  let ceiling = tp;
  let encoded;
  let result;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const filter = `loudnorm=I=${lufs}:TP=${ceiling}:LRA=${lra}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true:print_format=json`;
    const second = await run('ffmpeg', ['-hide_banner', '-nostats', '-y', '-i', input, '-map', '0:v?', '-map', '0:a:0', '-c:v', 'copy', '-af', filter, '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', output], { maxBuffer: 1 << 26 });
    result = parseLoudnormJson(second.stderr);
    encoded = await measureEncoded(output);
    if (!(encoded.true_peak_dbtp > tp)) break;
    ceiling = Math.round((ceiling - (encoded.true_peak_dbtp - tp) - 0.2) * 10) / 10;
  }
  return { target: { integrated_lufs: lufs, true_peak_dbtp: tp, lra }, input: { integrated_lufs: Number(measured.input_i), true_peak_dbtp: Number(measured.input_tp) }, output: encoded, limiter_ceiling_dbtp: ceiling, normalization: result.normalization_type, compliant: Math.abs(encoded.integrated_lufs - lufs) <= 1.5 && encoded.true_peak_dbtp <= tp };
}

async function main(argv) {
  const [input, output, ...rest] = argv;
  if (!input || !output) throw new Error('usage: master-loudness.mjs <input> <output> [--lufs -14] [--tp -1] [--lra 11]');
  const flag = (name, fallback) => { const index = rest.indexOf(name); return index >= 0 ? Number(rest[index + 1]) : fallback; };
  console.log(JSON.stringify(await masterLoudness(input, output, { lufs: flag('--lufs', -14), tp: flag('--tp', -1), lra: flag('--lra', 11) }), null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exit(1); });

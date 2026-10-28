#!/usr/bin/env node
// Rebuilds a golden story's premixed audio (assets/audio/mix.m4a) from its
// NARRATION.json and storyboard.json, using only local tools:
//   - voice: each narration word spoken by macOS `say`, trimmed and fitted to
//     the word's [start, end] window, so the audio matches the word timings;
//   - music and SFX: skills/launchclip-create-video/scripts/synth-audio-kit.mjs
//     (procedural bed + cue kit);
//   - mix: build-mix.mjs (bed ducked under the voice, one SFX per hit `cue`),
//     then a loudness-normalised mono AAC encode to keep the file small.
//
//   node scripts/golden-story-audio.mjs <story-dir> [--voice Samantha] [--bpm 96] [--key A] [--keep]
//
// Requires macOS `say` and ffmpeg. The golden stories under examples/story/
// commit the result, so the renderer eval never needs to run this.
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { resolveStory } from '@launchclip/core/story.mjs';
import { buildMix, normalizeCues } from '../skills/launchclip-create-video/scripts/build-mix.mjs';
import { SFX } from '../skills/launchclip-create-video/scripts/synth-audio-kit.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SYNTH = path.join(ROOT, 'skills', 'launchclip-create-video', 'scripts', 'synth-audio-kit.mjs');
const RATE = 48000;

async function ffmpeg(args) {
  return run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 1 << 26 });
}

async function duration(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(stdout.trim());
}

async function loudness(file) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], { maxBuffer: 1 << 26 });
  const integrated = Number([...stderr.matchAll(/\bI:\s*(-?[\d.]+)\s+LUFS/g)].at(-1)?.[1]);
  const truePeak = Number([...stderr.matchAll(/\bPeak:\s*(-?[\d.]+|-?inf)\s+dBFS/g)].at(-1)?.[1]);
  return { integrated, truePeak };
}

// atempo accepts 0.5..100 per instance; chain for larger slow-downs.
export function atempoChain(ratio) {
  const filters = [];
  let r = ratio;
  while (r < 0.5) { filters.push('atempo=0.5'); r /= 0.5; }
  while (r > 100) { filters.push('atempo=100'); r /= 100; }
  filters.push(`atempo=${r.toFixed(5)}`);
  return filters.join(',');
}

// Speaks one word and fits it to `seconds` (trimmed, tempo-matched, padded).
async function speakWord(text, seconds, file, voice, work) {
  const raw = `${file}.aiff`;
  const trimmed = `${file}.trim.wav`;
  const spoken = text.replace(/[^\p{L}\p{N}'’-]+/gu, ' ').trim() || text;
  await run('say', ['-v', voice, '-o', raw, spoken]);
  await ffmpeg(['-i', raw, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse', '-ar', String(RATE), '-ac', '2', trimmed]);
  const natural = await duration(trimmed);
  const ratio = natural / seconds;
  const fade = Math.min(0.03, seconds / 4).toFixed(3);
  await ffmpeg(['-i', trimmed, '-af', `${atempoChain(ratio)},apad=whole_dur=${seconds},atrim=0:${seconds},afade=t=out:st=${(seconds - Number(fade)).toFixed(3)}:d=${fade}`, '-ar', String(RATE), '-ac', '2', file]);
  await rm(raw, { force: true });
  await rm(trimmed, { force: true });
  return { natural, ratio };
}

export async function buildGoldenAudio(storyDir, { voice = 'Samantha', bpm = 96, key = 'A', keep = false } = {}) {
  const dir = path.resolve(storyDir);
  const story = JSON.parse(await readFile(path.join(dir, 'storyboard.json'), 'utf8'));
  const narration = JSON.parse(await readFile(path.join(dir, story.audio?.words ?? 'NARRATION.json'), 'utf8'));
  const words = narration.words ?? narration;
  const total = Number(story.format.duration);
  const mixTarget = story.audio?.mix;
  if (!mixTarget) throw new Error(`${dir}/storyboard.json has no audio.mix`);
  const work = await mkdtemp(path.join(os.tmpdir(), 'launchclip-golden-audio-'));
  try {
    // 1. Voice: one fitted clip per word, placed at its start.
    const wordDir = path.join(work, 'words');
    await mkdir(wordDir, { recursive: true });
    const wordCues = [];
    for (const [index, word] of words.entries()) {
      const file = path.join(wordDir, `w${String(index).padStart(3, '0')}.wav`);
      await speakWord(word.text, Number(word.end) - Number(word.start), file, voice, work);
      wordCues.push({ file, at: Number(word.start), volume: 1 });
    }
    const voiceFile = path.join(work, 'voice.wav');
    buildMix({ cues: normalizeCues(wordCues, wordDir), duration: total, out: voiceFile });

    // 2. Music bed and SFX kit.
    await run(process.execPath, [SYNTH, work, '--bed', String(total), '--bpm', String(bpm), '--key', key], { maxBuffer: 1 << 26 });

    // 3. SFX cues from the resolved hits.
    const resolved = resolveStory(story, { words });
    const sfx = [];
    const skipped = [];
    for (const scene of resolved.scenes) {
      for (const hit of scene.hits ?? []) {
        if (!hit.cue) continue;
        if (!SFX[hit.cue]) { skipped.push(`${scene.id}:${hit.cue}`); continue; }
        sfx.push({ cue: hit.cue, at: Math.max(0, hit.at - (hit.cue === 'riser' ? SFX.riser.duration : 0)), volume: hit.cue === 'impact' || hit.cue === 'riser' ? 0.3 : 0.35, shot: scene.id });
      }
    }
    const mixFile = path.join(work, 'mix.wav');
    buildMix({ voice: voiceFile, music: path.join(work, 'music', 'bed.wav'), cues: normalizeCues(sfx, path.join(work, 'sfx')), duration: total, out: mixFile, musicVolume: 0.3 });

    // 4. Small mono AAC, loudness-normalised.
    const out = path.join(dir, mixTarget);
    await mkdir(path.dirname(out), { recursive: true });
    // Static gain toward -16 LUFS; the AAC encode can overshoot, so re-measure
    // and back the gain off until the true peak sits at or below -2 dBTP.
    let gain = -16 - (await loudness(mixFile)).integrated;
    let measured;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await ffmpeg(['-i', mixFile, '-af', `volume=${gain.toFixed(2)}dB`, '-ar', '44100', '-ac', '1', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-t', String(total), out]);
      measured = await loudness(out);
      if (measured.truePeak <= -2) break;
      gain -= measured.truePeak + 2.3;
    }
    return { out, words: words.length, sfx: sfx.length, skipped, integrated_lufs: measured.integrated, true_peak_dbfs: measured.truePeak, work: keep ? work : null };
  } finally {
    if (!keep) await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : fallback; };
  const dir = argv.find((arg, index) => !arg.startsWith('--') && !['--voice', '--bpm', '--key'].includes(argv[index - 1]));
  if (!dir) { console.error('usage: golden-story-audio.mjs <story-dir> [--voice Samantha] [--bpm 96] [--key A] [--keep]'); process.exit(2); }
  buildGoldenAudio(dir, { voice: flag('--voice', 'Samantha'), bpm: Number(flag('--bpm', 96)), key: flag('--key', 'A'), keep: argv.includes('--keep') })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(error.message); process.exit(1); });
}

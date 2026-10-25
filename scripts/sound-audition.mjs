#!/usr/bin/env node
// Audition the procedural sound libraries (RFC seeded styles, phase 5b) and
// check them by ear-proxy and by the production gates. Everything is local
// FFmpeg synthesis: no samples, no network.
//
//   node scripts/sound-audition.mjs [--out .launchclip/audition] [--seed 7f3a91c2]
//     [--palettes a,b] [--genres a,b] [--beds a,b] [--seconds 20] [--no-mixes]
//
// Writes:
//   palettes/<palette>.wav   every effect family (variant 1) in sequence
//   genres/<genre>.wav       a bed with the drums in from 4 s to the last 4 s
//   ambience/<bed>.wav       the loop played twice, so the seam can be heard
//   mixes/<genre>.m4a        a narrated mix (speech-like test voice, a palette's
//                            cues, an ambience bed) mastered like finish does
//   AUDITION.json, AUDITION.md   the measurements and gate results
// and exits 1 when a sound has a listener problem (clipping, a cut tail, a
// harsh top) or a mix fails the loudness or audio gate.
import { execFile } from 'node:child_process';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { AMBIENCE_BEDS, GENRE_SPECS, MUSIC_GENRES, SFX_FAMILY_NAMES, SOUND_PALETTES } from '../kit/core/sound/options.mjs';
import { synthAmbience, synthGenreBed } from '../skills/launchclip-create-video/scripts/synth-audio-kit.mjs';
import { buildMix, normalizeCues } from '../skills/launchclip-create-video/scripts/build-mix.mjs';
import { masterLoudness } from '../skills/launchclip-create-video/scripts/master-loudness.mjs';
import { analyseFile, decodePcm, effectProblems, loudness } from './sound-analysis.mjs';
import { analyzeBeatsFile } from '../src/music/beats.js';
import { analyzeProductionAudio } from '../src/render_audio_analysis.js';
import { normalizeLoudness } from '../src/voice/supplied.js';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KIT = path.join(ROOT, 'skills', 'launchclip-create-video', 'scripts', 'synth-audio-kit.mjs');
const GAP = 0.4;

async function ffmpeg(args) {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 1 << 26 });
}

async function pool(items, limit, job) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await job(items[index], index);
    }
  }));
  return results;
}

/** Files joined with `gap` seconds of silence between them (48 kHz stereo). */
async function sequence(files, output, gap = GAP) {
  const inputs = files.flatMap((file) => ['-i', file]);
  const parts = files.map((_, i) => `[${i}]aformat=sample_rates=48000:channel_layouts=stereo,apad=pad_dur=${gap}[s${i}]`);
  parts.push(`${files.map((_, i) => `[s${i}]`).join('')}concat=n=${files.length}:v=0:a=1[o]`);
  await ffmpeg([...inputs, '-filter_complex', parts.join(';'), '-map', '[o]', '-c:a', 'pcm_s16le', output]);
}

// A speech-like test narration: a breathy glottal pulse through three
// formants, gated into syllables and words with pauses, then levelled the way
// finish levels a voice. It stands in for a real voice in the gate mixes.
async function speechLike(output, seconds) {
  const raw = `${output}.raw.wav`;
  const syllables = 'pow(max(0,sin(2*PI*4.3*t)),0.7)*gt(sin(2*PI*0.41*t)+0.35*sin(2*PI*1.3*t),-0.35)';
  const pitch = '2*PI*(118*t+6*sin(2*PI*0.7*t)/(2*PI*0.7)+3*sin(2*PI*0.23*t)/(2*PI*0.23))';
  const glottal = `(sin(${pitch})+0.6*sin(2*${pitch})+0.4*sin(3*${pitch})+0.3*sin(4*${pitch})+0.2*sin(5*${pitch})+0.15*sin(6*${pitch})+0.12*sin(7*${pitch})+0.1*sin(8*${pitch})+0.3*(2*random(0)-1))`;
  const graph = [
    `aevalsrc=exprs='${glottal}*${syllables}':s=48000:d=${seconds},asplit=3[a][b][c]`,
    '[a]bandpass=f=650:width_type=q:w=3,volume=2[f1]',
    '[b]bandpass=f=1250:width_type=q:w=4,volume=1.2[f2]',
    '[c]bandpass=f=2700:width_type=q:w=5,volume=0.7[f3]',
    '[f1][f2][f3]amix=inputs=3:normalize=0,highpass=f=90,lowpass=f=7000[o]'
  ].join(';');
  await ffmpeg(['-filter_complex', graph, '-map', '[o]', '-ac', '1', raw]);
  await normalizeLoudness(raw, output);
  await rm(raw, { force: true });
}

const flags = (argv) => {
  const get = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
  const list = (name, all) => get(name)?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? all;
  return {
    out: path.resolve(get('--out', path.join(ROOT, '.launchclip', 'audition'))),
    seed: get('--seed', '7f3a91c2'),
    seconds: Number(get('--seconds', 20)),
    palettes: list('--palettes', SOUND_PALETTES),
    genres: list('--genres', MUSIC_GENRES),
    beds: list('--beds', AMBIENCE_BEDS),
    mixes: !argv.includes('--no-mixes')
  };
};

export async function audition(options) {
  const { out, seed, seconds } = options;
  for (const dir of ['palettes', 'genres', 'ambience', 'mixes', '.work']) await mkdir(path.join(out, dir), { recursive: true });
  const work = path.join(out, '.work');
  const result = { schema_version: 'launchclip.sound-audition.v1', seed, palettes: {}, genres: {}, ambience: {}, mixes: {}, problems: [] };

  // Palettes: every family, every variant analysed; variant 1 of each in the sheet.
  await pool(options.palettes, 3, async (id) => {
    const dir = path.join(work, `kit-${id}`);
    await run(process.execPath, [KIT, dir, '--palette', id, '--seed', seed], { maxBuffer: 1 << 26 });
    const files = (await readdir(path.join(dir, 'sfx'))).filter((file) => file.endsWith('.wav')).sort();
    const stats = {};
    for (const file of files) {
      const family = file.replace(/(-\d+)?\.wav$/, '');
      const s = await analyseFile(path.join(dir, 'sfx', file));
      const problems = effectProblems(s, { family });
      stats[file.replace(/\.wav$/, '')] = { duration: s.duration, centroid_hz: s.centroid_hz, rms_db: s.rms_db, hf_ratio: s.hf_ratio, harsh_ratio: s.harsh_ratio, problems };
      for (const problem of problems) result.problems.push(`palette ${id}: ${file}: ${problem}`);
    }
    const sheet = path.join(out, 'palettes', `${id}.wav`);
    await sequence(SFX_FAMILY_NAMES.map((family) => path.join(dir, 'sfx', `${family}.wav`)), sheet);
    result.palettes[id] = { file: path.relative(out, sheet), families: SFX_FAMILY_NAMES.length, files: files.length, problems: Object.values(stats).reduce((sum, entry) => sum + entry.problems.length, 0), stats };
  });

  // Genres: one bed each, drums in for the middle; level, peaks, grid.
  await pool(options.genres, 3, async (genre) => {
    const dir = path.join(work, `genre-${genre}`);
    await mkdir(dir, { recursive: true });
    const spec = GENRE_SPECS[genre];
    const from = 4, to = seconds - 4;
    const bed = await synthGenreBed(dir, { seconds, genre, bpm: Math.round((spec.bpm[0] + spec.bpm[1]) / 2), kickFrom: from, kickTo: to, seed });
    const file = path.join(out, 'genres', `${genre}.wav`);
    await ffmpeg(['-i', bed.file, '-c:a', 'pcm_s16le', file]);
    const level = await loudness(file);
    const s = await analyseFile(file);
    const grid = await analyzeBeatsFile(file, { bpmHint: bed.bpm });
    // Every analysed beat inside the drum window sits on the bed's eighth-note grid.
    const eighth = bed.beat_seconds / 2;
    const inside = grid.beats.filter((t) => t > from + 0.5 && t < to - 0.5);
    const off = inside.map((t) => { const r = t % eighth; return Math.min(r, eighth - r); });
    const worst = off.length ? Math.max(...off) * 1000 : null;
    const entry = { file: path.relative(out, file), bpm: bed.bpm, key: bed.key, progression: bed.progression, analysed_bpm: grid.bpm, grid_error_ms: worst === null ? null : Math.round(worst), lufs: level.lufs, true_peak_db: level.true_peak_db, clipped: s.clipped, centroid_hz: s.centroid_hz, bands: s.bands };
    if (Math.abs(grid.bpm - bed.bpm) > 1) result.problems.push(`genre ${genre}: analysed ${grid.bpm} BPM for a ${bed.bpm} BPM bed`);
    if (worst !== null && worst > 25) result.problems.push(`genre ${genre}: beats ${Math.round(worst)} ms off the grid`);
    if (s.clipped > 0) result.problems.push(`genre ${genre}: clips`);
    if (level.true_peak_db > -1) result.problems.push(`genre ${genre}: true peak ${level.true_peak_db} dBTP is above -1`);
    if (level.lufs < -24 || level.lufs > -12) result.problems.push(`genre ${genre}: ${level.lufs} LUFS is outside -24..-12`);
    result.genres[genre] = entry;
  });

  // Ambience: the loop twice; the seam's step against the typical step.
  await pool(options.beds, 4, async (name) => {
    const made = await synthAmbience(name, path.join(work, 'ambience'), { seed });
    const file = path.join(out, 'ambience', `${name}.wav`);
    await ffmpeg(['-stream_loop', '1', '-i', made.file, '-c:a', 'pcm_s16le', file]);
    // The seam's sample step against the bed's own steps: a click would stand
    // far above the 99.9th percentile of them.
    const { left } = await decodePcm(made.file);
    const steps = new Float32Array(left.length - 1);
    for (let i = 1; i < left.length; i++) steps[i - 1] = Math.abs(left[i] - left[i - 1]);
    steps.sort();
    const typical = steps[Math.floor(steps.length * 0.999)];
    const seam = Math.abs(left[0] - left[left.length - 1]);
    const level = await loudness(made.file);
    const s = await analyseFile(made.file);
    result.ambience[name] = { file: path.relative(out, file), loop_seconds: made.loop_seconds, lufs: level.lufs, seam_step: Number(seam.toFixed(5)), p999_step: Number(typical.toFixed(5)), bands: s.bands };
    if (seam > typical * 1.5) result.problems.push(`ambience ${name}: the loop seam steps ${seam.toFixed(4)} (99.9th percentile step ${typical.toFixed(4)})`);
  });

  // Mixes: each genre with a palette's cues and a bed, through build-mix and
  // master-loudness, then the finish audio gate.
  if (options.mixes) {
    const voice = path.join(work, 'voice.wav');
    await speechLike(voice, seconds);
    const palettes = Object.keys(result.palettes);
    const beds = Object.keys(result.ambience);
    await pool(options.genres.filter((genre) => result.genres[genre]), 2, async (genre, index) => {
      const id = palettes[index % Math.max(1, palettes.length)];
      const bed = beds[index % Math.max(1, beds.length)];
      const dir = path.join(work, `mix-${genre}`);
      await mkdir(dir, { recursive: true });
      const sfxDir = path.join(work, `kit-${id}`, 'sfx');
      const cueNames = ['whoosh', 'pop', 'tick', 'impact', 'chime', 'success', 'swipe', 'ding', 'notification', 'subdrop'];
      const cues = id ? normalizeCues(cueNames.map((cue, i) => ({ cue, at: 1 + i * ((seconds - 3) / cueNames.length), volume: 0.35 })), sfxDir) : [];
      const mix = path.join(dir, 'mix.wav');
      const music = path.join(out, 'genres', `${genre}.wav`);
      const ambience = bed ? path.join(work, 'ambience', `${bed}.wav`) : null;
      buildMix({ voice, music, ambience, cues, duration: seconds, out: mix, musicVolume: 0.3, ambienceVolume: 0.5 });
      const mastered = path.join(out, 'mixes', `${genre}.m4a`);
      const loud = await masterLoudness(mix, mastered, { lufs: -14, tp: -1 });
      const sfxManifest = path.join(dir, 'sfx.json');
      await writeFile(sfxManifest, JSON.stringify({ cues: cues.map((cue, i) => ({ id: `sfx-${i}`, cue: cue.cue, at_seconds: cue.at, volume: cue.volume, file: cue.file })) }));
      const manifest = path.join(dir, 'AUDIO-MANIFEST.json');
      await writeFile(manifest, JSON.stringify({ voiceover: { path: voice }, music: { path: music }, sfx_manifest: sfxManifest }));
      const report = await analyzeProductionAudio(mastered, manifest, { musicVolume: 0.3 });
      const margin = report.sources.voiceover.integrated_lufs - (report.sources.music.integrated_lufs + report.sources.music_gain_db);
      result.mixes[genre] = { file: path.relative(out, mastered), palette: id ?? null, ambience: bed ?? null, loudness_compliant: Boolean(loud.compliant), integrated_lufs: report.output.integrated_lufs, true_peak_db: report.output.true_peak_dbfs, voice_music_margin_db: Number(margin.toFixed(1)), audio_gate: report.quality.ok ? 'passed' : 'failed', findings: report.quality.findings.map((entry) => `${entry.severity}: ${entry.message ?? entry.detail ?? entry.code}`) };
      if (!loud.compliant) result.problems.push(`mix ${genre}: the loudness gate failed (${JSON.stringify(loud.output)})`);
      if (!report.quality.ok) result.problems.push(`mix ${genre}: the audio gate failed: ${result.mixes[genre].findings.join('; ')}`);
    });
  }
  await rm(work, { recursive: true, force: true });
  await writeFile(path.join(out, 'AUDITION.json'), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(path.join(out, 'AUDITION.md'), markdown(result));
  return result;
}

function markdown(result) {
  const lines = [`# Sound audition (seed ${result.seed})`, ''];
  lines.push('## Palettes', '', '| Palette | Files | Problems | Sheet |', '|---|---|---|---|');
  for (const [id, entry] of Object.entries(result.palettes)) lines.push(`| ${id} | ${entry.files} | ${entry.problems} | ${entry.file} |`);
  lines.push('', '## Genres', '', '| Genre | BPM | Key | Prog | Analysed BPM | Grid error | LUFS | True peak | Sheet |', '|---|---|---|---|---|---|---|---|---|');
  for (const [id, e] of Object.entries(result.genres)) lines.push(`| ${id} | ${e.bpm} | ${e.key} | ${e.progression} | ${e.analysed_bpm} | ${e.grid_error_ms} ms | ${e.lufs} | ${e.true_peak_db} | ${e.file} |`);
  lines.push('', '## Ambience', '', '| Bed | Loop | LUFS | Seam step / 99.9th pct step | File |', '|---|---|---|---|---|');
  for (const [id, e] of Object.entries(result.ambience)) lines.push(`| ${id} | ${e.loop_seconds} s | ${e.lufs} | ${e.seam_step} / ${e.p999_step} | ${e.file} |`);
  if (Object.keys(result.mixes).length) {
    lines.push('', '## Gate mixes', '', '| Genre | Palette | Ambience | LUFS | True peak | Voice–music margin | Loudness gate | Audio gate |', '|---|---|---|---|---|---|---|---|');
    for (const [id, e] of Object.entries(result.mixes)) lines.push(`| ${id} | ${e.palette} | ${e.ambience} | ${e.integrated_lufs} | ${e.true_peak_db} | ${e.voice_music_margin_db} dB | ${e.loudness_compliant ? 'passed' : 'failed'} | ${e.audio_gate} |`);
  }
  lines.push('', result.problems.length ? `## Problems\n\n${result.problems.map((problem) => `- ${problem}`).join('\n')}` : 'No problems found.', '');
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = flags(process.argv.slice(2));
  audition(options).then((result) => {
    console.log(`audition written to ${options.out} (${Object.keys(result.palettes).length} palettes, ${Object.keys(result.genres).length} genres, ${Object.keys(result.ambience).length} beds, ${Object.keys(result.mixes).length} mixes)`);
    if (result.problems.length) {
      console.error(result.problems.join('\n'));
      process.exit(1);
    }
  }).catch((error) => { console.error(error.stack ?? error.message); process.exit(1); });
}

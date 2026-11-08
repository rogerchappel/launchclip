#!/usr/bin/env node
// Deterministic offline mix: narration + music bed ducked under the voice +
// an optional ambience loop (looped to length, ducked too) + SFX cues placed
// on their visible events. Mount the result as the single root <audio>
// track, then master the render with master-loudness.mjs.
// Usage:
//   node build-mix.mjs --cues <cues.json> --out <mix.wav> --duration <s>
//     [--voice narration.wav] [--music bed.wav] [--sfx-dir assets/audio/sfx]
//     [--music-volume 0.42] [--ambience loop.wav] [--ambience-volume 0.5]
//     [--sfx-manifest qa/sfx.json] [--key footage.mp4] [--music-duck 0.42]
// --music-duck: the bed's level under speech as a share of its level in the
// pauses (0–1; 1 = no ducking). Unset: MUSIC_DUCK.
// --key: speech that plays outside this mix (a talking-head recording's own
// audio): it ducks the bed and ambience like --voice but is not mixed in.
// cues.json: [{ "cue": "whoosh", "at": 5.72, "volume": 0.5, "shot": "B1", "intent": "pan" }]
// A cue may name a file instead: { "file": "assets/audio/hit.wav", "at": 1.2 }.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function normalizeCues(cues, sfxDir) {
  if (!Array.isArray(cues)) throw new Error('cues must be an array');
  return cues.map((cue, index) => {
    const at = Number(cue.at ?? cue.at_seconds);
    if (!Number.isFinite(at) || at < 0) throw new Error(`cue ${index + 1} needs a non-negative "at"`);
    const file = cue.file ?? (cue.cue ? path.join(sfxDir, `${cue.cue}.wav`) : null);
    if (!file) throw new Error(`cue ${index + 1} needs "cue" or "file"`);
    // offset: seconds into the file to start from (a tally fitted to a short count skips its first blips).
    const offset = Number(cue.offset ?? 0);
    return { cue: cue.cue ?? path.basename(file, path.extname(file)), at, volume: Number(cue.volume ?? 0.35), shot: cue.shot ?? null, intent: cue.intent ?? '', file: path.resolve(file), ...(offset > 0 ? { offset } : {}) };
  });
}

// Key segments: [{ sourceStart, duration }] — the stretches of the key file
// the video plays, in order (a trimmed footage base); none plays it from 0.
function keySource(index, segments) {
  if (!segments?.length) return `[${index}]anull`;
  const cuts = segments.map((segment, i) => `[${index}]atrim=start=${segment.sourceStart}:duration=${segment.duration},asetpts=PTS-STARTPTS[kc${i}]`);
  return segments.length === 1 ? cuts[0].replace(/\[kc0\]$/, '') : `${cuts.join(';')};${segments.map((_, i) => `[kc${i}]`).join('')}concat=n=${segments.length}:v=0:a=1`;
}

// How far speech pushes the beds down. The music sits about 12 dB under a
// voice and comes back up in the pauses; a harder duck (threshold 0.03,
// ratio 6) left it about 22 dB down, which is silent on a phone speaker.
// Ambience ducks a little less: it is a room tone, not a tune.
export const MUSIC_DUCK = Object.freeze({ threshold: 0.1, ratio: 3, attack: 30, release: 400 });
export const AMBIENCE_DUCK = Object.freeze({ threshold: 0.1, ratio: 2.5, attack: 40, release: 600 });

function duck({ threshold, ratio, attack, release }) {
  return `sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${attack}:release=${release}:makeup=1`;
}

// --music-duck as compressor settings. The duck's depth depends on how far
// the voice sits over the threshold: the threshold is set that far under a
// typical narration (its detector level, about DUCK_VOICE_DB) that the ratio
// takes the asked-for dB off the bed. Checked against a real narration and
// bed, it lands within about 1 dB (0.42 → -8.5 dB for -7.5 asked).
const DUCK_VOICE_DB = -13;
const DUCK_RATIO = 4;
export function duckSettings(depth) {
  if (depth === null || depth === undefined) return MUSIC_DUCK;
  const share = Math.min(1, Math.max(0.03, Number(depth)));
  if (share >= 1) return null;
  const cut = -20 * Math.log10(share);
  const thresholdDb = DUCK_VOICE_DB - cut / (1 - 1 / DUCK_RATIO);
  const threshold = Math.min(0.5, Math.max(0.0005, Math.round(10 ** (thresholdDb / 20) * 100000) / 100000));
  return Object.freeze({ threshold, ratio: DUCK_RATIO, attack: MUSIC_DUCK.attack, release: MUSIC_DUCK.release });
}

export function mixGraph({ cues, duration, hasVoice, hasMusic, musicVolume = 0.42, musicDuck = null, hasAmbience = false, ambienceVolume = 0.5, hasKey = false, keySegments = null, mono = [] }) {
  const parts = [];
  const mixInputs = [];
  let index = 0;
  const keys = (hasMusic ? 1 : 0) + (hasAmbience ? 1 : 0);
  if (hasVoice) {
    parts.push(keys === 2 ? `[${index}]asplit=3[vo][key][akey]` : keys === 1 ? `[${index}]asplit=2[vo][${hasMusic ? 'key' : 'akey'}]` : `[${index}]anull[vo]`);
    mixInputs.push({ label: '[vo]', input: index });
    index += 1;
  }
  // A key without a voice: the speech is heard elsewhere, so it only feeds
  // the sidechains. With a voice the voice keys, and the key is ignored.
  const keyed = hasVoice || (hasKey && keys > 0);
  if (keyed && !hasVoice) {
    parts.push(`${keySource(index, keySegments)},aformat=channel_layouts=stereo${keys === 2 ? ',asplit=2[key][akey]' : `[${hasMusic ? 'key' : 'akey'}]`}`);
    index += 1;
  } else if (hasKey && !hasVoice) {
    index += 1;
  }
  if (hasMusic) {
    parts.push(`[${index}]volume=${musicVolume}[bedraw]`);
    // Duck the bed under speech; with no voice the bed plays as is. The key is
    // padded to the full duration because sidechaincompress stops when its
    // sidechain ends, which would cut the bed off after the last word.
    const settings = duckSettings(musicDuck);
    // --music-duck 1: the key still has to be read, so it feeds a null sink.
    parts.push(!keyed ? '[bedraw]anull[bed]' : settings ? `[key]apad=whole_dur=${duration}[keypad];[bedraw][keypad]${duck(settings)}[bed]` : '[key]anullsink;[bedraw]anull[bed]');
    mixInputs.push({ label: '[bed]', input: index });
    index += 1;
  }
  if (hasAmbience) {
    // The loop arrives endless (-stream_loop -1): cut it to length first.
    parts.push(`[${index}]atrim=0:${duration},asetpts=PTS-STARTPTS,afade=t=in:d=1,volume=${ambienceVolume}[ambraw]`);
    parts.push(keyed ? `[akey]apad=whole_dur=${duration}[akeypad];[ambraw][akeypad]${duck(AMBIENCE_DUCK)}[amb]` : '[ambraw]anull[amb]');
    mixInputs.push({ label: '[amb]', input: index });
    index += 1;
  }
  cues.forEach((cue, i) => {
    const trim = cue.offset > 0 ? `atrim=start=${cue.offset},asetpts=PTS-STARTPTS,afade=t=in:d=0.004,` : '';
    parts.push(`[${index + i}]${trim}adelay=${Math.round(cue.at * 1000)}:all=1,volume=${cue.volume}[s${i}]`);
    mixInputs.push({ label: `[s${i}]`, input: index + i });
  });
  if (!mixInputs.length) throw new Error('nothing to mix: pass --voice, --music or cues');
  const fadeStart = Math.max(0, duration - 0.25);
  // amix settles on one channel layout, and a mono input (a narration, usually)
  // makes that layout mono: every stereo cue would fold to the centre. So each
  // input goes in as stereo. A mono one is copied to both sides at full level,
  // because aformat's upmix would drop it 3 dB against the stereo inputs.
  mixInputs.forEach(({ label, input }, i) => parts.push(`${label}${mono.includes(input) ? 'pan=stereo|c0=c0|c1=c0' : 'aformat=channel_layouts=stereo'}[mix${i}]`));
  parts.push(`${mixInputs.map((_, i) => `[mix${i}]`).join('')}amix=inputs=${mixInputs.length}:normalize=0,apad=whole_dur=${duration},atrim=0:${duration},afade=t=out:st=${fadeStart}:d=0.25,alimiter=limit=0.89:level=0[out]`);
  return parts.join(';');
}

/** A level over time as an ffmpeg expression: straight lines between [seconds, level] points. */
export function levelExpression(points) {
  if (!points.length) return '1';
  let expression = String(points[points.length - 1][1]);
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const [a, levelA] = points[i];
    const [b, levelB] = points[i + 1];
    expression = `if(lt(t,${b}),${levelA}+(${levelB}-(${levelA}))*(t-${a})/(${b}-${a}),${expression})`;
  }
  return points[0][0] > 0 ? `if(lt(t,${points[0][0]}),${points[0][1]},${expression})` : expression;
}

/**
 * The sound score's mix (src/sfx/score.js). Each cue has a place in the stereo
 * field: a pan with a few milliseconds between the sides (the way a room tells
 * the ears where a sound is), or a sweep across it. The cues share a decaying
 * stereo room, so they sit in one space. Under them, a low room tone with a
 * different noise in each ear follows the score's levels. The voice stays
 * centred and on top: it ducks everything but never moves.
 */
export function scoreGraph({ cues, duration, hasVoice, hasMusic = false, musicVolume = 0.42, room = [], mono = [] }) {
  const parts = [];
  let index = 0;
  const voiceInput = hasVoice ? index++ : null;
  const musicInput = hasMusic ? index++ : null;
  const labels = [];
  cues.forEach((cue, i) => {
    const input = index + i;
    const trim = cue.offset > 0 ? `atrim=start=${cue.offset},asetpts=PTS-STARTPTS,` : '';
    const stereo = mono.includes(input) ? 'pan=stereo|c0=c0|c1=c0' : 'aformat=channel_layouts=stereo';
    let place;
    let delay;
    const ms = cue.at * 1000;
    if (Array.isArray(cue.sweep)) {
      const [from, to] = cue.sweep;
      const span = cue.sweep_seconds ?? 1.4;
      const position = `(${from}+(${to}-(${from}))*min(t/${span},1))`;
      place = `aeval='val(0)*min(1,1-${position})|val(1)*min(1,1+${position})':c=stereo`;
      delay = `adelay=${ms.toFixed(1)}:all=1`;
    } else {
      const pan = Number(cue.pan) || 0;
      const gap = Math.abs(pan) * 12;
      place = `pan=stereo|c0=${Math.min(1, 1 - pan).toFixed(3)}*c0|c1=${Math.min(1, 1 + pan).toFixed(3)}*c1`;
      delay = `adelay=${(ms + (pan < 0 ? gap : 0)).toFixed(1)}|${(ms + (pan > 0 ? gap : 0)).toFixed(1)}`;
    }
    parts.push(`[${input}]${trim}${stereo},${place},${delay},volume=${cue.volume}[s${i}]`);
    labels.push(`[s${i}]`);
  });
  if (!labels.length) throw new Error('a score needs cues');
  for (const [seed, tag] of [[11, 'ra'], [23, 'rb']]) parts.push(`anoisesrc=d=${duration}:c=brown:r=48000:s=${seed}:a=0.95,lowpass=f=95,highpass=f=26,tremolo=f=0.11:d=0.4,volume=0.3[${tag}]`);
  parts.push('[ra][rb]join=inputs=2:channel_layout=stereo[low]');
  for (const [seed, tag] of [[31, 'aa'], [37, 'ab']]) parts.push(`anoisesrc=d=${duration}:c=pink:r=48000:s=${seed}:a=0.5,highpass=f=7000,lowpass=f=17000,tremolo=f=0.23:d=0.6,volume=0.018[${tag}]`);
  parts.push('[aa][ab]join=inputs=2:channel_layout=stereo[air]');
  parts.push(`[low][air]amix=inputs=2:normalize=0,volume='${levelExpression(room)}':eval=frame[roomraw]`);
  for (const [seed, tag] of [[3, 'irl'], [5, 'irr']]) parts.push(`anoisesrc=d=1.4:c=pink:r=48000:s=${seed},afade=t=out:st=0:d=1.4:curve=exp,highpass=f=200,lowpass=f=9000[${tag}]`);
  parts.push('[irl][irr]join=inputs=2:channel_layout=stereo[ir]');
  parts.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0,asplit=2[dry][wetin]`);
  parts.push('[wetin][ir]afir=dry=0:wet=1:gtype=none,volume=0.07[wet]');
  parts.push('[dry][wet]amix=inputs=2:normalize=0,alimiter=limit=0.85:level=0[fxraw]');
  const mixed = [];
  if (hasVoice) {
    const voice = mono.includes(voiceInput) ? 'pan=stereo|c0=c0|c1=c0' : 'aformat=channel_layouts=stereo';
    const keys = hasMusic ? 3 : 2;
    parts.push(`[${voiceInput}]highpass=f=70,acompressor=threshold=0.12:ratio=2.5:attack=8:release=120:makeup=1.3,${voice},asplit=2[voice][keyraw]`);
    parts.push(`[keyraw]apad=whole_dur=${duration},asplit=${keys}${Array.from({ length: keys }, (_, k) => `[k${k}]`).join('')}`);
    parts.push('[fxraw][k0]sidechaincompress=threshold=0.1:ratio=2:attack=6:release=180:makeup=1[fx]');
    parts.push('[roomraw][k1]sidechaincompress=threshold=0.07:ratio=1.8:attack=30:release=350:makeup=1[room]');
    mixed.push('[voice]', '[fx]', '[room]');
  } else {
    parts.push('[fxraw]anull[fx];[roomraw]anull[room]');
    mixed.push('[fx]', '[room]');
  }
  if (hasMusic) {
    parts.push(`[${musicInput}]aformat=channel_layouts=stereo,volume=${musicVolume}[bedraw]`);
    parts.push(hasVoice ? `[bedraw][k2]${duck(duckSettings(null))}[bed]` : '[bedraw]anull[bed]');
    mixed.push('[bed]');
  }
  const fadeStart = Math.max(0, duration - 0.25);
  // One gain would keep the dips and the hits apart; the master's loudnorm then
  // only has to level the whole, and the limiter takes the very tops of the kicks.
  parts.push(`${mixed.join('')}amix=inputs=${mixed.length}:normalize=0:duration=longest,atrim=0:${duration},afade=t=out:st=${fadeStart}:d=0.25,alimiter=limit=0.89:level=0[out]`);
  return parts.join(';');
}

/** The score's mix: too many inputs for a command line's filter, so the graph goes in a file. */
function buildScoreMix({ voice, music, cues, duration, out, musicVolume, room }) {
  const inputs = [];
  if (voice) inputs.push('-i', voice);
  if (music) inputs.push('-i', music);
  for (const cue of cues) inputs.push('-i', cue.file);
  const files = inputs.flatMap((value, i) => (inputs[i - 1] === '-i' ? [value] : []));
  const filter = scoreGraph({ cues, duration, hasVoice: Boolean(voice), hasMusic: Boolean(music), musicVolume, room, mono: monoInputs(files) });
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const dir = mkdtempSync(path.join(os.tmpdir(), 'score-mix-'));
  try {
    const script = path.join(dir, 'graph.txt');
    writeFileSync(script, filter);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-/filter_complex', script, '-map', '[out]', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', out]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The indexes of the inputs with one channel. An input that can't be read is left for ffmpeg to report. */
function monoInputs(files) {
  const channels = new Map();
  const channelsOf = (file) => {
    if (!channels.has(file)) {
      try {
        channels.set(file, Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim()));
      } catch {
        channels.set(file, null);
      }
    }
    return channels.get(file);
  };
  return files.flatMap((file, index) => (channelsOf(file) === 1 ? [index] : []));
}

export function buildMix({ voice, music, ambience = null, cues = [], duration, out, musicVolume = 0.42, musicDuck = null, ambienceVolume = 0.5, key = null, keySegments = null, score = null }) {
  if (score) return buildScoreMix({ voice, music, cues, duration, out, musicVolume, room: score.room ?? [] });
  const inputs = [];
  const useKey = Boolean(key) && !voice && Boolean(music || ambience);
  if (voice) inputs.push('-i', voice);
  else if (useKey) inputs.push('-vn', '-i', key);
  if (music) inputs.push('-i', music);
  if (ambience) inputs.push('-stream_loop', '-1', '-i', ambience);
  for (const cue of cues) inputs.push('-i', cue.file);
  const files = inputs.flatMap((value, i) => (inputs[i - 1] === '-i' ? [value] : []));
  const filter = mixGraph({ mono: monoInputs(files), cues, duration, hasVoice: Boolean(voice), hasMusic: Boolean(music), musicVolume, musicDuck, hasAmbience: Boolean(ambience), ambienceVolume, hasKey: useKey, keySegments });
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filter, '-map', '[out]', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', out]);
}

async function main(argv) {
  const flag = (name, fallback) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : fallback; };
  const out = flag('--out');
  const duration = Number(flag('--duration'));
  if (!out || !Number.isFinite(duration) || duration <= 0) throw new Error('usage: build-mix.mjs --cues <cues.json> --out <mix.wav> --duration <s> [--voice v.wav] [--music bed.wav] [--sfx-dir dir] [--music-volume 0.42] [--ambience loop.wav] [--ambience-volume 0.5] [--sfx-manifest qa/sfx.json] [--key footage.mp4] [--music-duck 0-1]');
  const cuesPath = flag('--cues');
  const cues = cuesPath ? normalizeCues(JSON.parse(readFileSync(cuesPath, 'utf8')), flag('--sfx-dir', 'assets/audio/sfx')) : [];
  buildMix({ voice: flag('--voice'), music: flag('--music'), ambience: flag('--ambience'), cues, duration, out, musicVolume: Number(flag('--music-volume', 0.42)), musicDuck: flag('--music-duck') == null ? null : Number(flag('--music-duck')), ambienceVolume: Number(flag('--ambience-volume', 0.5)), key: flag('--key') });
  const manifest = flag('--sfx-manifest');
  if (manifest) {
    mkdirSync(path.dirname(path.resolve(manifest)), { recursive: true });
    // Same shape cinematic-check reads through AUDIO-MANIFEST.json → sfx_manifest.
    writeFileSync(manifest, `${JSON.stringify({ cues: cues.map((cue, i) => ({ id: `sfx-${String(i + 1).padStart(2, '0')}-${cue.cue}`, cue: cue.cue, shot_id: cue.shot, at_seconds: cue.at, volume: cue.volume, intent: cue.intent, file: cue.file })) }, null, 2)}\n`);
  }
  console.log(JSON.stringify({ out, cues: cues.length, voice: Boolean(flag('--voice')), music: Boolean(flag('--music')) }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exit(1); });

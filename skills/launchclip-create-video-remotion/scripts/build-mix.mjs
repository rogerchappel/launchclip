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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

export function mixGraph({ cues, duration, hasVoice, hasMusic, musicVolume = 0.42, musicDuck = null, hasAmbience = false, ambienceVolume = 0.5, hasKey = false, keySegments = null }) {
  const parts = [];
  const mixInputs = [];
  let index = 0;
  const keys = (hasMusic ? 1 : 0) + (hasAmbience ? 1 : 0);
  if (hasVoice) {
    parts.push(keys === 2 ? `[${index}]asplit=3[vo][key][akey]` : keys === 1 ? `[${index}]asplit=2[vo][${hasMusic ? 'key' : 'akey'}]` : `[${index}]anull[vo]`);
    mixInputs.push('[vo]');
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
    mixInputs.push('[bed]');
    index += 1;
  }
  if (hasAmbience) {
    // The loop arrives endless (-stream_loop -1): cut it to length first.
    parts.push(`[${index}]atrim=0:${duration},asetpts=PTS-STARTPTS,afade=t=in:d=1,volume=${ambienceVolume}[ambraw]`);
    parts.push(keyed ? `[akey]apad=whole_dur=${duration}[akeypad];[ambraw][akeypad]${duck(AMBIENCE_DUCK)}[amb]` : '[ambraw]anull[amb]');
    mixInputs.push('[amb]');
    index += 1;
  }
  cues.forEach((cue, i) => {
    const trim = cue.offset > 0 ? `atrim=start=${cue.offset},asetpts=PTS-STARTPTS,afade=t=in:d=0.004,` : '';
    parts.push(`[${index + i}]${trim}adelay=${Math.round(cue.at * 1000)}:all=1,volume=${cue.volume}[s${i}]`);
    mixInputs.push(`[s${i}]`);
  });
  if (!mixInputs.length) throw new Error('nothing to mix: pass --voice, --music or cues');
  const fadeStart = Math.max(0, duration - 0.25);
  parts.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:normalize=0,apad=whole_dur=${duration},atrim=0:${duration},afade=t=out:st=${fadeStart}:d=0.25,alimiter=limit=0.89:level=0[out]`);
  return parts.join(';');
}

export function buildMix({ voice, music, ambience = null, cues = [], duration, out, musicVolume = 0.42, musicDuck = null, ambienceVolume = 0.5, key = null, keySegments = null }) {
  const inputs = [];
  const useKey = Boolean(key) && !voice && Boolean(music || ambience);
  if (voice) inputs.push('-i', voice);
  else if (useKey) inputs.push('-vn', '-i', key);
  if (music) inputs.push('-i', music);
  if (ambience) inputs.push('-stream_loop', '-1', '-i', ambience);
  for (const cue of cues) inputs.push('-i', cue.file);
  const filter = mixGraph({ cues, duration, hasVoice: Boolean(voice), hasMusic: Boolean(music), musicVolume, musicDuck, hasAmbience: Boolean(ambience), ambienceVolume, hasKey: useKey, keySegments });
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

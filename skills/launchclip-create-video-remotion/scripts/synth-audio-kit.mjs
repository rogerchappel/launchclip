#!/usr/bin/env node
// Synthesize an original, license-free SFX kit and an optional ambient music
// bed with local FFmpeg only. Nothing is downloaded and no provider is called,
// so the output can ship inside any project.
// Usage:
//   node synth-audio-kit.mjs <out-dir> [--bed <seconds>] [--bpm 100]
//     [--kick-from <s>] [--kick-to <s>] [--key A|C|D|E|F|G]
// Writes <out-dir>/sfx/*.wav, optional <out-dir>/music/bed.wav, and
// <out-dir>/AUDIO-KIT.json (+ BEATS.json when a bed is made).
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const RATE = 48000;

// Each cue: duration, per-channel aevalsrc expression, extra filter chain.
// random(n) is FFmpeg's seeded generator, so renders are reproducible.
export const SFX = {
  whoosh: {
    duration: 0.62,
    intent: 'spatial travel, push, whip pan',
    expr: [
      '(random(0)*2-1)*pow(sin(PI*min(t/0.62,1)),3)*(1.15-t/0.62)',
      '(random(1)*2-1)*pow(sin(PI*min(t/0.62,1)),3)*(0.15+t/0.62)'
    ],
    filter: 'highpass=f=380,lowpass=f=5200,aphaser=type=t:speed=1.6:decay=0.5'
  },
  impact: {
    duration: 1.3,
    intent: 'big reveal, law/headline lock, scene slam',
    expr: [
      '0.9*sin(2*PI*(42*t+70*(1-exp(-18*t))/18))*exp(-3.6*t)+0.5*(random(0)*2-1)*exp(-55*t)',
      '0.9*sin(2*PI*(42*t+70*(1-exp(-18*t))/18))*exp(-3.6*t)+0.5*(random(1)*2-1)*exp(-55*t)'
    ],
    filter: 'lowpass=f=5000,aecho=0.8:0.55:45|90:0.25|0.14'
  },
  riser: {
    duration: 1.4,
    intent: 'tension into a payoff or rehook (ends on the hit)',
    expr: [
      '0.55*sin(2*PI*180*(exp(1.4652*t)-1)/1.4652)*pow(t/1.4,2)+0.35*(random(0)*2-1)*pow(t/1.4,3)',
      '0.55*sin(2*PI*181.5*(exp(1.4652*t)-1)/1.4652)*pow(t/1.4,2)+0.35*(random(1)*2-1)*pow(t/1.4,3)'
    ],
    filter: 'highpass=f=160,lowpass=f=9000'
  },
  tick: {
    duration: 0.14,
    intent: 'counter step, data point lands, small UI state change',
    expr: ['sin(2*PI*2200*t)*exp(-55*t)+0.4*sin(2*PI*3300*t)*exp(-80*t)'],
    filter: 'highpass=f=600'
  },
  pop: {
    duration: 0.2,
    intent: 'object or label appears',
    expr: ['sin(2*PI*(260*t+340*(1-exp(-30*t))/30))*exp(-24*t)'],
    filter: 'highpass=f=120'
  },
  shimmer: {
    duration: 1.6,
    intent: 'insight, equilibrium, satisfying resolve',
    expr: [
      '0.5*sin(2*PI*1046.5*t)*exp(-2.6*t)+0.32*sin(2*PI*1567.98*t)*exp(-3.4*t)+0.2*sin(2*PI*2093*t)*exp(-4.5*t)',
      '0.5*sin(2*PI*1047.5*t)*exp(-2.6*t)+0.32*sin(2*PI*1569*t)*exp(-3.4*t)+0.2*sin(2*PI*2094.5*t)*exp(-4.5*t)'
    ],
    filter: 'aecho=0.8:0.6:70|130:0.3|0.2'
  },
  subdrop: {
    duration: 1.8,
    intent: 'final payoff weight under the last line',
    expr: ['0.95*sin(2*PI*(30*t+45*(1-exp(-2.2*t))/2.2))*min(t/0.02,1)*exp(-1.6*t)'],
    filter: 'lowpass=f=180'
  }
};

const KEYS = { C: 130.81, D: 146.83, E: 164.81, F: 174.61, G: 196, A: 110 };
// i - VI - III - VII in a minor key, written as semitone offsets from the tonic.
const PROGRESSION = [[0, 3, 7, 10], [-4, 0, 3, 7], [3, 7, 10, 14], [-2, 2, 5, 10]];

export function bedExpressions({ seconds, bpm = 100, key = 'A', kickFrom = 0, kickTo = seconds }) {
  const root = KEYS[key] ?? KEYS.A;
  const beat = 60 / bpm;
  const chordLength = beat * 8;
  const cycle = chordLength * PROGRESSION.length;
  const terms = [];
  PROGRESSION.forEach((chord, index) => {
    const start = index * chordLength;
    // Smooth 0.35s cross-fade window for this chord inside each progression cycle.
    const local = `mod(t,${cycle.toFixed(4)})-${start.toFixed(4)}`;
    const window = `(clip((${local})/0.35+1,0,1)*clip((${chordLength.toFixed(4)}-(${local}))/0.35,0,1))`;
    const voices = chord.map((semi) => {
      const f = root * 2 ** (semi / 12);
      return `sin(2*PI*${f.toFixed(3)}*t)+sin(2*PI*${(f * 1.0045).toFixed(3)}*t)+0.35*sin(2*PI*${(f * 2.002).toFixed(3)}*t)`;
    }).join('+');
    terms.push(`${window}*(${voices})`);
  });
  const swell = `(0.55+0.45*sin(2*PI*t/${(beat * 4).toFixed(4)}-PI/2)*0.5+0.225)`;
  const fade = `min(t/1.2,1)*clip((${seconds}-t)/1.6,0,1)`;
  const pad = `0.11*${fade}*${swell}*(${terms.join('+')})`;
  const tb = `mod(t,${beat.toFixed(5)})`;
  const gate = `between(t,${kickFrom},${kickTo})`;
  const kick = `0.5*${gate}*sin(2*PI*(48*${tb}+90*(1-exp(-28*${tb}))/28))*exp(-8*${tb})*min(${tb}/0.003,1)`;
  const th = `mod(t+${(beat / 2).toFixed(5)},${beat.toFixed(5)})`;
  const hat = `0.16*${gate}*(random(0)*2-1)*exp(-70*${th})`;
  return { pad, kick, hat, beat };
}

async function ffmpeg(args) {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 1 << 26 });
}

async function peakNormalize(input, output, peakDb) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', input, '-af', 'astats=measure_overall=Peak_level:measure_perchannel=0', '-f', 'null', '-'], { maxBuffer: 1 << 26 });
  const peak = Number(stderr.match(/Peak level dB:\s*(-?[\d.]+)/)?.[1] ?? 0);
  await ffmpeg(['-i', input, '-af', `volume=${(peakDb - peak).toFixed(2)}dB`, '-ar', String(RATE), '-ac', '2', '-c:a', 'pcm_s16le', output]);
  return peakDb;
}

async function synthCue(name, spec, directory) {
  const raw = path.join(directory, `.${name}.raw.wav`);
  const output = path.join(directory, `${name}.wav`);
  const expr = spec.expr.join('|');
  await ffmpeg(['-f', 'lavfi', '-i', `aevalsrc=exprs='${expr}':s=${RATE}:d=${spec.duration}`, '-af', `${spec.filter},afade=t=out:st=${(spec.duration * 0.85).toFixed(3)}:d=${(spec.duration * 0.15).toFixed(3)}`, '-ac', '2', raw]);
  await peakNormalize(raw, output, -3);
  await run('rm', ['-f', raw]);
  return { name, file: output, duration_seconds: spec.duration, intent: spec.intent };
}

async function synthBed(directory, options) {
  const { pad, kick, hat, beat } = bedExpressions(options);
  const output = path.join(directory, 'bed.wav');
  const d = options.seconds;
  await ffmpeg([
    '-f', 'lavfi', '-i', `aevalsrc=exprs='${pad}':s=${RATE}:d=${d}`,
    '-f', 'lavfi', '-i', `aevalsrc=exprs='${kick}':s=${RATE}:d=${d}`,
    '-f', 'lavfi', '-i', `aevalsrc=exprs='${hat}':s=${RATE}:d=${d}`,
    '-filter_complex',
    '[0]lowpass=f=2400,aecho=0.8:0.7:120|240:0.25|0.15[p];[1]lowpass=f=900[k];[2]highpass=f=7000[h];[p][k][h]amix=inputs=3:normalize=0,alimiter=limit=0.7:level=0,pan=stereo|c0=c0|c1=c0[o]',
    '-map', '[o]', '-ar', String(RATE), '-c:a', 'pcm_s16le', output
  ]);
  const beats = [];
  for (let t = 0; t < d; t += beat) beats.push(Math.round(t * 1000) / 1000);
  return { file: output, bpm: options.bpm, beat_seconds: beat, beats, downbeats: beats.filter((_, i) => i % 4 === 0), kick_from: options.kickFrom, kick_to: options.kickTo };
}

async function main(argv) {
  const [outDir, ...rest] = argv;
  if (!outDir) throw new Error('usage: synth-audio-kit.mjs <out-dir> [--bed seconds] [--bpm N] [--kick-from s] [--kick-to s] [--key A]');
  const flag = (name) => { const index = rest.indexOf(name); return index >= 0 ? rest[index + 1] : undefined; };
  const sfxDir = path.join(outDir, 'sfx');
  await mkdir(sfxDir, { recursive: true });
  const cues = [];
  for (const [name, spec] of Object.entries(SFX)) cues.push(await synthCue(name, spec, sfxDir));
  const kit = { schema_version: 'launchclip.synth-audio-kit.v1', license: 'Original procedural synthesis; no third-party samples.', sample_rate: RATE, sfx: cues, music: null };
  if (flag('--bed')) {
    const seconds = Number(flag('--bed'));
    const musicDir = path.join(outDir, 'music');
    await mkdir(musicDir, { recursive: true });
    const bed = await synthBed(musicDir, { seconds, bpm: Number(flag('--bpm') ?? 100), key: flag('--key') ?? 'A', kickFrom: Number(flag('--kick-from') ?? 0), kickTo: Number(flag('--kick-to') ?? seconds) });
    kit.music = { file: bed.file, bpm: bed.bpm };
    await writeFile(path.join(outDir, 'BEATS.json'), `${JSON.stringify({ schema_version: 'launchclip.beats.v1', source: bed.file, ...bed }, null, 2)}\n`);
  }
  await writeFile(path.join(outDir, 'AUDIO-KIT.json'), `${JSON.stringify(kit, null, 2)}\n`);
  console.log(JSON.stringify({ sfx: cues.map((cue) => cue.name), music: kit.music?.file ?? null }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exit(1); });

#!/usr/bin/env node
// Generate the stand-in talking-head recording for examples/story/footage/.
//
//   node scripts/make-footage-example.mjs [--out examples/story/footage]
//
// Writes, deterministically (ffmpeg and a synthesised voice-like track; no
// network, no models):
//   assets/recording.mp4        22 s 720x1280 30 fps source "recording": a
//                               gradient set, a sway-animated presenter
//                               silhouette, a drifting accent light, and a
//                               2 s red-tinted false start at 8–10 s that the
//                               edit removes
//   recording/edit-plan.json    the edit-recording plan (launchclip.recording-edit.v1)
//                               whose kept segments cut the false start
//   NARRATION.json              word timings on the edited (story) timeline
//
// The storyboard (storyboard.json) is authored by hand and points base.edl at
// recording/edit-plan.json, so the story resolves the cut into base.trim.
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE_DURATION = 22, CUT = [8, 10], RATE = 48000;

// Edited-timeline words (seconds). None straddles the cut at 8 s.
export const WORDS = [
  ['Most', 0.3, 0.55], ['launch', 0.6, 0.92], ['videos', 0.96, 1.38], ['bury', 1.44, 1.74], ['the', 1.78, 1.88], ['demo.', 1.92, 2.45],
  ['This', 2.9, 3.1], ['one', 3.14, 3.36], ['starts', 3.4, 3.78], ['with', 3.82, 3.98], ['the', 4.0, 4.1], ['person', 4.14, 4.56], ['who', 4.6, 4.76], ['built', 4.8, 5.08], ['it.', 5.12, 5.4],
  ["I'm", 5.9, 6.12], ['Ada', 6.16, 6.46], ['Park,', 6.5, 6.9], ['and', 7.0, 7.14], ['I', 7.18, 7.24], ['make', 7.26, 7.38], ['LaunchClip.', 7.4, 7.92],
  ['It', 8.3, 8.42], ['turns', 8.46, 8.76], ['one', 8.8, 9.0], ['recording', 9.04, 9.6], ['into', 9.64, 9.84], ['a', 9.88, 9.94], ['finished', 9.98, 10.36], ['Short.', 10.4, 10.86],
  ['Edits', 11.2, 11.6], ['take', 11.64, 11.86], ['twelve', 11.9, 12.3], ['minutes,', 12.34, 12.84], ['not', 12.98, 13.18], ['two', 13.22, 13.46], ['days.', 13.5, 13.98],
  ['Captions,', 14.4, 14.98], ['punch-ins', 15.04, 15.6], ['and', 15.64, 15.8], ['callouts', 15.84, 16.34], ['come', 16.38, 16.56], ['straight', 16.6, 16.94], ['from', 16.98, 17.14], ['the', 17.18, 17.26], ['words.', 17.3, 17.8],
  ['Try', 18.2, 18.46], ['it', 18.5, 18.62], ['on', 18.66, 18.78], ['your', 18.82, 18.98], ['next', 19.02, 19.3], ['launch.', 19.34, 19.86]
];
// The false start inside the removed range (source seconds).
const FALSE_START = [['So', 8.4, 8.62], ['it', 8.7, 8.82], ['turns—', 8.9, 9.4]];

const toSource = t => (t >= CUT[0] ? t + (CUT[1] - CUT[0]) : t);

function voiceWav(words) {
  const samples = new Float32Array(SOURCE_DURATION * RATE);
  words.forEach(([text, from, to], index) => {
    const start = Math.round(from * RATE), end = Math.round(to * RATE);
    const syllables = Math.max(1, Math.round(text.replace(/[^aeiouy]/gi, '').length * 0.8));
    const pitch0 = 150 + 25 * Math.sin(index * 1.7);
    for (let i = start; i < end && i < samples.length; i++) {
      const p = (i - start) / (end - start);
      const env = Math.sin(Math.PI * p) ** 0.6 * (0.55 + 0.45 * Math.abs(Math.sin(Math.PI * p * syllables)));
      const f = pitch0 * (1 + 0.08 * Math.sin(Math.PI * p) - 0.05 * p);
      const t = i / RATE;
      let v = 0;
      // A few harmonics with crude formant weights (a voice-like buzz).
      for (const [h, w] of [[1, 0.5], [2, 0.32], [3, 0.24], [4, 0.12], [6, 0.08], [9, 0.05]]) v += w * Math.sin(2 * Math.PI * f * h * t + h);
      samples[i] += 0.32 * env * v;
    }
  });
  // Room tone so silence is not digital zero (deterministic LCG noise).
  let seed = 7;
  for (let i = 0; i < samples.length; i++) { seed = (seed * 1103515245 + 12345) % 2147483648; samples[i] += ((seed / 2147483648) - 0.5) * 0.004; }
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, i) => data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(value * 32767))), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export async function makeFootageExample(out = path.join(ROOT, 'examples/story/footage')) {
  await mkdir(path.join(out, 'assets'), {recursive: true});
  await mkdir(path.join(out, 'recording'), {recursive: true});
  const work = await mkdtemp(path.join(os.tmpdir(), 'launchclip-footage-'));
  try {
    const sourceWords = [...WORDS.map(([text, a, b]) => [text, toSource(a), toSource(b)]), ...FALSE_START];
    await writeFile(path.join(work, 'voice.wav'), voiceWav(sourceWords));
    // Presenter silhouette: one RGBA still (head, neck, shoulders), swayed by overlay.
    const inside = (cx, cy, rx, ry) => `lte(pow((X-${cx})/${rx},2)+pow((Y-${cy})/${ry},2),1)`;
    const head = inside(360, 470, 118, 150), torso = inside(360, 1180, 310, 330), neck = `between(X,318,402)*between(Y,580,880)`;
    const body = `max(max(${head},${neck}),${torso})`;
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=720x1280:d=1,format=rgba',
      '-vf', `geq=r='if(${torso},38,224)':g='if(${torso},52,176)':b='if(${torso},84,146)':a='if(${body},255,0)'`, '-frames:v', '1', path.join(work, 'presenter.png')]);
    const graph = [
      `[0:v]format=yuv420p[bg]`,
      `[bg]drawbox=x='420+90*sin(t*0.6)':y='190+40*cos(t*0.45)':w=110:h=110:color=0xfdb022@0.55:t=fill[lit]`,
      `[1:v]format=rgba[who]`,
      `[lit][who]overlay=x='14*sin(t*1.1)':y='6*cos(t*0.8)':format=auto[pre]`,
      `[pre]drawbox=x=0:y=0:w=iw:h=ih:color=0xff2a2a@0.35:t=fill:enable='between(t,${CUT[0]},${CUT[1]})',format=yuv420p[v]`
    ].join(';');
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `gradients=s=720x1280:r=30:d=${SOURCE_DURATION}:c0=0x15233f:c1=0x3b1f4a:c2=0x0f3b45:n=3:speed=0.004:seed=3`,
      '-loop', '1', '-framerate', '30', '-t', String(SOURCE_DURATION), '-i', path.join(work, 'presenter.png'),
      '-i', path.join(work, 'voice.wav'),
      '-filter_complex', graph, '-map', '[v]', '-map', '2:a', '-t', String(SOURCE_DURATION),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-g', '30', '-pix_fmt', 'yuv420p', '-r', '30',
      '-c:a', 'aac', '-b:a', '96k', '-ar', String(RATE), '-ac', '1', '-movflags', '+faststart', '-metadata', 'creation_time=2026-10-22T00:00:00Z', '-fflags', '+bitexact',
      path.join(out, 'assets/recording.mp4')]);
  } finally {
    await rm(work, {recursive: true, force: true});
  }
  const kept = [{source_start_seconds: 0, source_end_seconds: CUT[0], start_seconds: 0, end_seconds: CUT[0]},
    {source_start_seconds: CUT[1], source_end_seconds: SOURCE_DURATION, start_seconds: CUT[0], end_seconds: SOURCE_DURATION - (CUT[1] - CUT[0])}];
  const plan = {schema_version: 'launchclip.recording-edit.v1', source_duration_seconds: SOURCE_DURATION, duration_seconds: SOURCE_DURATION - (CUT[1] - CUT[0]),
    kept_segments: kept, removed_segments: [{source_start_seconds: CUT[0], source_end_seconds: CUT[1], reason: 'false-start'}],
    words: WORDS.map(([word, start, end]) => ({word, start, end})), text: WORDS.map(([word]) => word).join(' ')};
  await writeFile(path.join(out, 'recording/edit-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  await writeFile(path.join(out, 'NARRATION.json'), `${JSON.stringify({words: WORDS.map(([text, start, end]) => ({text, start, end}))}, null, 2)}\n`);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const out = await makeFootageExample(i > 0 ? path.resolve(process.argv[i + 1]) : undefined);
  console.log(`wrote ${path.relative(process.cwd(), out)}/assets/recording.mp4, recording/edit-plan.json and NARRATION.json`);
}

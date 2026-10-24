#!/usr/bin/env node
// Generate the stand-in recording and its exact matte for examples/story/subject/.
//
//   node scripts/make-subject-example.mjs [--out examples/story/subject] [--duration 6] [--product]
//
// Writes, deterministically (no models, no network):
//   assets/recording.mp4                  6 s 720x1280 30 fps: a still striped
//                                         "room" and a swaying presenter silhouette
//   assets/subject/0.000-6.000.webm       the same frames with the presenter's
//                                         exact alpha (VP9, yuva420p)
//   assets/subject/0.000-6.000.json       launchclip.subject.v1 for the range,
//                                         measured from that alpha
//   assets/subject/0.000-6.000.plate.jpg  the room alone (the exact plate)
//
// --product also writes stand-in product media for catalogue E:
//   assets/app.png          a 1280x800 app screenshot (sidebar, cards, chart)
//   assets/demo/flow.mp4    a 4 s 540x1170 phone screen recording (a list
//                           scrolling under a moving highlight)
//
// The matte is exact, so renderer parity measures the compilers, not a
// segmentation model. storyboard.json is authored by hand.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SUBJECT_SCHEMA, maskStats, summarizeSamples, validateSubjectInfo} from '../kit/core/subject.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) && args[args.indexOf(name) + 1] ? args[args.indexOf(name) + 1] : fallback);
const out = path.resolve(ROOT, flag('--out', 'examples/story/subject'));
const W = 720, H = 1280, FPS = 30, DURATION = Number(flag('--duration', 6));
const FRAMES = FPS * DURATION;
const STATS_W = 180, STATS_H = 320;
const RANGE = `0.000-${DURATION.toFixed(3)}`;

// Coverage of the presenter at (x, y) in frame `index`, 0–1 with a 1.5 px
// soft edge: a round head, a neck and a torso with sloped shoulders.
function presenter(x, y, index) {
  const sway = Math.sin((index / FPS) * 1.6) * 22;
  const cx = W / 2 + sway;
  const head = 1.5 - (Math.hypot(x - cx, (y - 330) * 0.92) - 96);
  const neck = Math.min(1.5 - (Math.abs(x - cx) - 40), 1.5 - (Math.abs(y - 475) - 60));
  const shoulder = 520 + Math.max(0, Math.abs(x - cx) - 70) * 0.35;
  const torso = Math.min(1.5 - (Math.abs(x - cx) - 250), y - shoulder + 1.5);
  return Math.max(0, Math.min(1, Math.max(head, neck, torso) / 3));
}

// The room: warm stripes and a cool panel. It holds still, as a real room
// does, so the plate matches it on every frame; the presenter's sway shows
// a frozen frame.
function room(x, y) {
  const stripe = Math.floor((x + y * 0.35) / 64) % 2;
  const panel = x > 470 && x < 690 && y > 160 && y < 620;
  if (panel) return [40, 92, 150];
  const shade = 1 - y / H * 0.45;
  return stripe ? [Math.round(196 * shade), Math.round(150 * shade), Math.round(102 * shade)] : [Math.round(168 * shade), Math.round(122 * shade), Math.round(84 * shade)];
}

function person(y) {
  if (y < 432) return [214, 168, 138];
  if (y < 500) return [190, 146, 118];
  return [36, 54, 82];
}

function encoder(file, pixFmt, codecArgs) {
  const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', pixFmt, '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0', ...codecArgs, file], {stdio: ['pipe', 'ignore', 'inherit']});
  const done = once(child, 'close');
  return {
    async write(buffer) { if (!child.stdin.write(buffer)) await once(child.stdin, 'drain'); },
    async close() { child.stdin.end(); const [code] = await done; if (code !== 0) throw new Error(`ffmpeg failed writing ${file}`); }
  };
}

await mkdir(path.join(out, 'assets/subject'), {recursive: true});
const recordingFile = path.join(out, 'assets/recording.mp4');
const matteFile = path.join(out, `assets/subject/${RANGE}.webm`);
const recording = encoder(recordingFile, 'rgb24', ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-g', '30', '-an']);
const matte = encoder(matteFile, 'rgba', ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '24', '-auto-alt-ref', '0', '-row-mt', '1', '-an']);
const frames = [];
for (let index = 0; index < FRAMES; index += 1) {
  const rgb = Buffer.alloc(W * H * 3);
  const rgba = Buffer.alloc(W * H * 4);
  const small = new Uint8Array(STATS_W * STATS_H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const a = presenter(x + 0.5, y + 0.5, index);
      const bg = room(x, y);
      const fg = person(y);
      const i = y * W + x;
      for (let c = 0; c < 3; c += 1) {
        rgb[i * 3 + c] = Math.round(fg[c] * a + bg[c] * (1 - a));
        rgba[i * 4 + c] = Math.round(fg[c] * a + bg[c] * (1 - a));
      }
      rgba[i * 4 + 3] = Math.round(a * 255);
      if (x % 4 === 0 && y % 4 === 0) small[(y / 4) * STATS_W + x / 4] = Math.round(a * 255);
    }
  }
  await recording.write(rgb);
  await matte.write(rgba);
  frames.push({t: Math.round((index / FPS) * 1e4) / 1e4, ...maskStats(small, STATS_W, STATS_H)});
}
await recording.close();
await matte.close();

const plate = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) plate.set(room(x, y), (y * W + x) * 3);
const plateWriter = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', 'pipe:0', '-frames:v', '1', '-q:v', '2', path.join(out, `assets/subject/${RANGE}.plate.jpg`)], {stdio: ['pipe', 'ignore', 'inherit']});
plateWriter.stdin.end(plate);
const [plateCode] = await once(plateWriter, 'close');
if (plateCode !== 0) throw new Error('ffmpeg failed writing the plate');

const sha256 = createHash('sha256').update(await readFile(recordingFile)).digest('hex');
const info = {schema: SUBJECT_SCHEMA, source: {sha256, width: W, height: H, fps: FPS, duration: DURATION}, model: 'synthetic', range: {in: 0, out: DURATION}, matte: `${RANGE}.webm`, matte_size: {width: W, height: H}, plate: `${RANGE}.plate.jpg`, plate_size: {width: W, height: H}, plate_seen: 1, ...summarizeSamples(frames), frames};
const {ok, errors} = validateSubjectInfo(info);
if (!ok) throw new Error(`subject.json failed its schema: ${errors.join('; ')}`);
await writeFile(path.join(out, `assets/subject/${RANGE}.json`), `${JSON.stringify(info)}\n`);
if (args.includes('--product')) await writeProductMedia();
console.log(`wrote ${path.relative(ROOT, out)}: recording.mp4, subject/${RANGE}.{webm,json,plate.jpg}${args.includes('--product') ? ', app.png, demo/flow.mp4' : ''} (${info.framing}, head ${JSON.stringify(info.head)})`);

// Stand-in product media: flat UI shapes, no text, deterministic.
async function writeProductMedia() {
  const fill = (buffer, width, x0, y0, w, h, color) => {
    const rows = buffer.length / (width * 3);
    for (let y = Math.max(0, y0); y < Math.min(rows, y0 + h); y += 1) for (let x = Math.max(0, x0); x < Math.min(width, x0 + w); x += 1) buffer.set(color, (y * width + x) * 3);
  };
  const UI = {bg: [245, 243, 238], side: [30, 34, 48], card: [255, 255, 255], line: [222, 220, 214], accent: [253, 176, 34], cool: [70, 212, 255], ink: [60, 64, 80]};
  const appW = 1280, appH = 800;
  const app = Buffer.alloc(appW * appH * 3);
  fill(app, appW, 0, 0, appW, appH, UI.bg);
  fill(app, appW, 0, 0, 240, appH, UI.side);
  for (let i = 0; i < 6; i += 1) fill(app, appW, 36, 120 + i * 64, i === 1 ? 168 : 140, 18, i === 1 ? UI.accent : [80, 86, 104]);
  for (let i = 0; i < 3; i += 1) {
    fill(app, appW, 290 + i * 320, 60, 290, 180, UI.card);
    fill(app, appW, 320 + i * 320, 96, 120, 16, UI.line);
    fill(app, appW, 320 + i * 320, 140, 180, 44, i === 0 ? UI.accent : UI.ink);
  }
  fill(app, appW, 290, 280, 930, 460, UI.card);
  for (let i = 0; i < 12; i += 1) {
    const h = 60 + ((i * 37) % 9) * 32 + i * 10;
    fill(app, appW, 340 + i * 72, 700 - h, 44, h, i === 11 ? UI.accent : UI.cool);
  }
  await writeRgb(path.join(out, 'assets/app.png'), app, appW, appH);

  await mkdir(path.join(out, 'assets/demo'), {recursive: true});
  const fw = 540, fh = 1170, fFrames = FPS * 4;
  const flow = encoderSized(path.join(out, 'assets/demo/flow.mp4'), fw, fh);
  for (let index = 0; index < fFrames; index += 1) {
    const frame = Buffer.alloc(fw * fh * 3);
    fill(frame, fw, 0, 0, fw, fh, UI.bg);
    fill(frame, fw, 0, 0, fw, 140, UI.side);
    const scroll = Math.round(index * 3.2);
    for (let row = 0; row < 14; row += 1) {
      const y = 170 + row * 150 - scroll;
      if (y < 140 || y > fh) continue;
      const active = row === 3 + Math.floor(index / 30);
      fill(frame, fw, 30, y, fw - 60, 120, active ? UI.accent : UI.card);
      fill(frame, fw, 60, y + 30, 64, 64, active ? UI.side : UI.line);
      fill(frame, fw, 150, y + 40, 240, 16, active ? UI.side : UI.ink);
      fill(frame, fw, 150, y + 72, 160, 12, UI.line);
    }
    await flow.write(frame);
  }
  await flow.close();
}

async function writeRgb(file, rgb, width, height) {
  const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-i', 'pipe:0', '-frames:v', '1', file], {stdio: ['pipe', 'ignore', 'inherit']});
  child.stdin.end(rgb);
  const [code] = await once(child, 'close');
  if (code !== 0) throw new Error(`ffmpeg failed writing ${file}`);
}

function encoderSized(file, width, height) {
  const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-r', String(FPS), '-i', 'pipe:0', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', file], {stdio: ['pipe', 'ignore', 'inherit']});
  const done = once(child, 'close');
  return {
    async write(buffer) { if (!child.stdin.write(buffer)) await once(child.stdin, 'drain'); },
    async close() { child.stdin.end(); const [code] = await done; if (code !== 0) throw new Error(`ffmpeg failed writing ${file}`); }
  };
}

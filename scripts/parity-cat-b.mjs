#!/usr/bin/env node
// Throwaway parity verifier for catalogue B (until scripts/parity.mjs lands).
//
//   node scripts/parity-cat-b.mjs [fixture.json ...] [--out .tmp/parity-cat-b] [--threshold 0.97]
//
// For each fixture {story, sceneId}: resolves the scene with
// kit/core/catalog-b.mjs, builds a one-module HyperFrames project (root
// data-composition-id/duration/width/height, GSAP 3.14.2 paused timeline on
// window.__timelines) and snapshots it with `hyperframes snapshot`, renders the
// same frames through the test-only Remotion entry (ModuleReview, bundled once,
// renderStill per frame), then compares each pair with ffmpeg ssim and writes
// side-by-side PNGs plus report.json. Times: enter-mid, settle, each event
// + 0.4 s, exit-mid, all snapped to the frame grid.

import {execFile} from 'node:child_process';
import {copyFile, cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {MODULES} from '@launchclip/core/catalog-b.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-b.mjs';
import {injectParityFonts} from './parity-fonts.mjs';
import {bundleForRun} from './remotion-bundle.mjs';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE_DIR = path.join(ROOT, 'test/fixtures/parity');
const ENTRY = path.join(ROOT, 'test/fixtures/parity-entry-cat-b/entry.tsx');
const HYPERFRAMES = require.resolve('hyperframes/dist/cli.js');
const GSAP = require.resolve('gsap/dist/gsap.min.js');

export function sceneContext(story, scene) {
  const format = story.format;
  return {id: scene.id, start: scene.start, duration: scene.end - scene.start, format, brand: story.brand,
    aspect: format.height > format.width ? '9:16' : '16:9', hits: (scene.hits ?? []).filter(hit => typeof hit.at === 'number')};
}

export function resolveFixture(fixture) {
  const scene = fixture.story.scenes.find(entry => entry.id === fixture.sceneId);
  if (!scene) throw new Error(`fixture scene ${fixture.sceneId} not found`);
  if (!MODULES[scene.module]) throw new Error(`${scene.module} is not a catalogue B module`);
  return {scene, model: MODULES[scene.module].resolve(scene.params ?? {}, sceneContext(fixture.story, scene))};
}

export function sampleTimes(model) {
  const m = model.motion, fps = model.fps;
  const snap = t => Math.round(t * fps) / fps;
  const list = [['enter-mid', m.enterStart + m.enterDuration / 2], ['settle', m.exitStart - 0.2]];
  for (const event of model.events) if (event.name !== 'enter') list.push([`${event.name}+0.4`, Math.min(event.time + 0.4, m.exitStart - 0.05)]);
  list.push(['exit-mid', m.exitStart + m.exitDuration / 2]);
  const seen = new Set();
  return list.map(([label, t]) => ({label, t: snap(t), frame: Math.round((snap(t) - model.start) * fps)}))
    .filter(entry => (seen.has(entry.frame) ? false : seen.add(entry.frame))).sort((a, b) => a.t - b.t);
}

export function hyperframesHtml(story, model) {
  const out = EMITTERS[model.module](model);
  const {width, height} = story.format;
  return `<!doctype html>
<html><head><meta charset="utf-8"><script src="assets/gsap.min.js"></script>
<style>html,body{margin:0;background:${story.brand.colors.bg}}#main{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:${story.brand.colors.bg}}${out.css}</style></head>
<body><div id="main" data-composition-id="main" data-start="0" data-duration="${model.end}" data-width="${width}" data-height="${height}">
${out.html}
</div>
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({paused: true});
${out.motion}
tl.set({}, {}, ${model.end});
window.__timelines.main = tl;
</script></body></html>
`;
}

async function hyperframesStills(story, model, times, dir) {
  const project = path.join(dir, 'hf-project');
  await rm(project, {recursive: true, force: true});
  await mkdir(path.join(project, 'assets'), {recursive: true});
  if (existsSync(path.join(FIXTURE_DIR, 'assets'))) await cp(path.join(FIXTURE_DIR, 'assets'), path.join(project, 'assets'), {recursive: true});
  await copyFile(GSAP, path.join(project, 'assets/gsap.min.js'));
  await writeFile(path.join(project, 'index.html'), hyperframesHtml(story, model));
  await injectParityFonts(story, project);
  const frames = path.join(dir, 'hf-frames');
  await rm(frames, {recursive: true, force: true});
  // The HyperFrames player floors seek times to its frame grid, so nudge each
  // time 1 µs past its frame boundary (4.8333 would otherwise land on 4.8).
  await run(process.execPath, [HYPERFRAMES, 'snapshot', '--at', times.map(entry => (entry.t + 1e-6).toFixed(6)).join(','), '--no-end', '--output', frames, '--describe', 'false', project], {cwd: project, maxBuffer: 1 << 24});
  const files = (await readdir(frames)).filter(name => /^frame-.*\.png$/.test(name)).sort();
  if (files.length !== times.length) throw new Error(`hyperframes produced ${files.length} frames for ${times.length} times`);
  return files.map(name => path.join(frames, name));
}

let bundled = null;
async function remotionBundle() {
  if (!bundled) {
    bundled = await bundleForRun({entryPoint: ENTRY, publicDir: FIXTURE_DIR});
  }
  return bundled;
}

async function remotionStills(fixture, scene, times, dir) {
  const {selectComposition, renderStill} = await import('@remotion/renderer');
  const serveUrl = await remotionBundle();
  const inputProps = {scene, story: fixture.story};
  const composition = await selectComposition({serveUrl, id: 'ModuleReview', inputProps});
  const out = [];
  for (const entry of times) {
    const file = path.join(dir, `rm-${String(entry.frame).padStart(4, '0')}.png`);
    await renderStill({serveUrl, composition, inputProps, frame: Math.min(entry.frame, composition.durationInFrames - 1), output: file, imageFormat: 'png'});
    out.push(file);
  }
  return out;
}

async function ssim(a, b) {
  const {stderr} = await run('ffmpeg', ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'ssim', '-f', 'null', '-'], {maxBuffer: 1 << 24});
  const match = /All:([0-9.]+)/.exec(stderr);
  if (!match) throw new Error(`ffmpeg ssim gave no score for ${a}`);
  return Number(match[1]);
}

async function sideBySide(a, b, file) {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', a, '-i', b, '-filter_complex', '[0][1]hstack=inputs=2,scale=iw/2:-1', file]);
}

export async function verifyFixture(file, {out, threshold = 0.97} = {}) {
  const fixture = JSON.parse(await readFile(file, 'utf8'));
  const {scene, model} = resolveFixture(fixture);
  const dir = path.join(out, path.basename(file, '.json'));
  await mkdir(dir, {recursive: true});
  const times = sampleTimes(model);
  const hf = await hyperframesStills(fixture.story, model, times, dir);
  const rm = await remotionStills(fixture, scene, times, dir);
  const limit = fixture.threshold?.ssim ?? threshold;
  const rows = [];
  for (let i = 0; i < times.length; i++) {
    const score = await ssim(hf[i], rm[i]);
    const side = path.join(dir, `side-${times[i].label.replace(/[^a-z0-9+.-]/gi, '_')}.png`);
    await sideBySide(hf[i], rm[i], side);
    rows.push({...times[i], ssim: score, pass: score >= limit, hyperframes: hf[i], remotion: rm[i], side});
  }
  const report = {fixture: path.relative(ROOT, file), module: model.module, sceneId: scene.id, threshold: limit, pass: rows.every(row => row.pass), min: Math.min(...rows.map(row => row.ssim)), rows};
  await writeFile(path.join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const out = path.resolve(option('--out') ?? path.join(ROOT, '.tmp/parity-cat-b'));
  const threshold = Number(option('--threshold') ?? 0.97);
  const files = args.length ? args.map(arg => path.resolve(arg)) : (await readdir(FIXTURE_DIR)).filter(name => /^b-cat-.*\.json$/.test(name)).sort().map(name => path.join(FIXTURE_DIR, name));
  let failed = false;
  for (const file of files) {
    const report = await verifyFixture(file, {out, threshold});
    failed ||= !report.pass;
    console.log(`${report.pass ? 'PASS' : 'FAIL'} ${report.module} (min SSIM ${report.min.toFixed(4)})`);
    for (const row of report.rows) console.log(`  ${row.label.padEnd(18)} t=${row.t.toFixed(3).padStart(7)} frame ${String(row.frame).padStart(4)}  ssim ${row.ssim.toFixed(4)}${row.pass ? '' : '  <'}`);
  }
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

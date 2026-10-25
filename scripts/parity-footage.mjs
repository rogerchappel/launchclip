#!/usr/bin/env node
// Footage-led parity (docs/KIT_CONTRACTS.md, "Footage-led lane").
//
//   node scripts/parity-footage.mjs [fixture.json ...] [--out .tmp/parity-footage]
//
// A fixture is {project, sceneId?, mode?: "module"|"story", times?: [seconds],
// threshold?: {ssim}, patch?: {...}, files?: {path: text}}. `project` is a
// storyboard project (relative to the repo root) holding storyboard.json,
// NARRATION.json, base.edl and assets/; it is resolved exactly as the CLI does
// (story_loader.readProjectStory). With `patch` (top-level storyboard keys,
// for example a brand `frame`) or `files` (extra text files such as an SVG
// logo), a copy of the project in the output directory is used instead.
//
// - module: the scene over the footage. HyperFrames compiles the story with
//   sceneFilter (absolute times, base videos and that scene's camera, no
//   captions or audio); Remotion renders ModuleReview ({scene, story}), which
//   draws the same muted base under the module. Default times: enter-mid,
//   settle, each event + 0.4 s, exit-mid.
// - story: the whole story (base, cameras, inserts, captions) through the
//   full HyperFrames compile and LaunchclipStory.
//
// Both sides use the real compilers and kit/remotion/entry.tsx; Remotion's
// public dir is the project, so staticFile() finds assets/ and captions.
// Writes report.json and side-by-side PNGs (HyperFrames left, Remotion right).
import {execFile} from 'node:child_process';
import {cp, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {readProjectStory} from '../src/story_loader.js';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';
import {resolveModule} from '../kit/core/modules.mjs';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const FIXTURE_DIR = path.join(ROOT, 'test/fixtures/parity-footage');
const ENTRY = path.join(ROOT, 'kit/remotion/entry.tsx');
const HYPERFRAMES = require.resolve('hyperframes/dist/cli.js');

export function moduleTimes(model, fps) {
  const m = model.motion;
  const snap = t => Math.round(t * fps) / fps;
  const list = [['enter-mid', m.enterStart + (m.enterEnd - m.enterStart) / 2], ['settle', m.enterEnd + Math.max(0, (m.exitStart - m.enterEnd) / 2)]];
  for (const event of model.events) list.push([`${event.name ?? event.id}+0.4`, Math.min(event.time + 0.4, m.exitStart - 0.05)]);
  list.push(['exit-mid', m.exitStart + (m.end - m.exitStart) / 2]);
  const seen = new Set();
  return list.map(([label, t]) => ({label, t: snap(Math.min(Math.max(t, model.start), model.end - 1 / fps))}))
    .filter(entry => (seen.has(entry.t) ? false : seen.add(entry.t))).sort((a, b) => a.t - b.t);
}

async function hyperframesStills(story, project, sceneFilter, times, dir) {
  const out = path.join(dir, 'hf-project');
  await rm(out, {recursive: true, force: true});
  const compiled = await compileStoryToHyperFrames(story, {projectDir: out, sourceDir: project, sceneFilter});
  const frames = path.join(dir, 'hf-frames');
  await rm(frames, {recursive: true, force: true});
  // The player floors seek times to its frame grid; nudge 1 µs past the boundary.
  await run(process.execPath, [HYPERFRAMES, 'snapshot', '--at', times.map(entry => (entry.t + 1e-6).toFixed(6)).join(','), '--no-end', '--output', frames, '--describe', 'false', out], {cwd: out, maxBuffer: 1 << 26});
  const files = (await readdir(frames)).filter(name => /^frame-.*\.png$/.test(name)).sort();
  if (files.length !== times.length) throw new Error(`hyperframes produced ${files.length} frames for ${times.length} times`);
  return {files: files.map(name => path.join(frames, name)), warnings: compiled.warnings};
}

const bundles = new Map();
async function remotionBundle(publicDir) {
  if (!bundles.has(publicDir)) {
    const {bundle} = await import('@remotion/bundler');
    bundles.set(publicDir, await bundle({entryPoint: ENTRY, publicDir, onProgress: () => {}}));
  }
  return bundles.get(publicDir);
}

async function remotionStills({id, inputProps, frames, dir, publicDir}) {
  const {selectComposition, renderStill} = await import('@remotion/renderer');
  const serveUrl = await remotionBundle(publicDir);
  const composition = await selectComposition({serveUrl, id, inputProps});
  const out = [];
  for (const frame of frames) {
    const file = path.join(dir, `rm-${String(frame).padStart(4, '0')}.png`);
    await renderStill({serveUrl, composition, inputProps: composition.props ?? inputProps, frame: Math.min(frame, composition.durationInFrames - 1), output: file, imageFormat: 'png'});
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

// A copy of the fixture's project with its storyboard patched and extra files written.
async function patchedProject(source, fixture, dir) {
  const copy = path.join(dir, 'project');
  await rm(copy, {recursive: true, force: true});
  await cp(source, copy, {recursive: true});
  const storyFile = path.join(copy, 'storyboard.json');
  await writeFile(storyFile, `${JSON.stringify({...JSON.parse(await readFile(storyFile, 'utf8')), ...(fixture.patch ?? {})}, null, 2)}\n`);
  for (const [name, text] of Object.entries(fixture.files ?? {})) {
    await mkdir(path.dirname(path.join(copy, name)), {recursive: true});
    await writeFile(path.join(copy, name), text);
  }
  return copy;
}

export async function verifyFixture(file, {out = path.join(ROOT, '.tmp/parity-footage')} = {}) {
  const fixture = JSON.parse(await readFile(file, 'utf8'));
  const dir = path.join(out, path.basename(file, '.json'));
  await mkdir(dir, {recursive: true});
  const source = path.resolve(ROOT, fixture.project);
  const project = fixture.patch || fixture.files ? await patchedProject(source, fixture, dir) : source;
  const {resolved: story} = await readProjectStory(project);
  const fps = story.resolved.fps;
  const mode = fixture.mode ?? (fixture.sceneId ? 'module' : 'story');
  let times, hf, rmFiles, label;
  if (mode === 'module') {
    const scene = story.scenes.find(entry => entry.id === fixture.sceneId);
    if (!scene) throw new Error(`${file}: scene ${fixture.sceneId} not found`);
    const model = resolveModule(scene, story);
    label = `${model.module} (${scene.id})`;
    times = fixture.times ? fixture.times.map(t => ({label: `t${t}`, t})) : moduleTimes(model, fps);
    hf = await hyperframesStills(story, project, scene.id, times, dir);
    rmFiles = await remotionStills({id: 'ModuleReview', inputProps: {scene, story}, frames: times.map(entry => Math.round((entry.t - scene.start) * fps)), dir, publicDir: project});
  } else {
    label = `story ${fixture.project}`;
    times = (fixture.times ?? [1, 5, 9, 13, 16, 19]).map(t => ({label: `t${t}`, t: Math.round(t * fps) / fps}));
    hf = await hyperframesStills(story, project, undefined, times, dir);
    rmFiles = await remotionStills({id: 'LaunchclipStory', inputProps: story, frames: times.map(entry => Math.round(entry.t * fps)), dir, publicDir: project});
  }
  const limit = fixture.threshold?.ssim ?? 0.97;
  const rows = [];
  for (let i = 0; i < times.length; i++) {
    const score = await ssim(hf.files[i], rmFiles[i]);
    const side = path.join(dir, `side-${times[i].label.replace(/[^a-z0-9+.-]/gi, '_')}.png`);
    await sideBySide(hf.files[i], rmFiles[i], side);
    rows.push({...times[i], ssim: score, pass: score >= limit, side});
  }
  const report = {fixture: path.relative(ROOT, file), label, mode, threshold: limit, pass: rows.every(row => row.pass), min: Math.min(...rows.map(row => row.ssim)), warnings: hf.warnings, rows};
  await writeFile(path.join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--out');
  const out = path.resolve(i >= 0 ? args.splice(i, 2)[1] : path.join(ROOT, '.tmp/parity-footage'));
  const files = args.length ? args.map(arg => path.resolve(arg)) : (await readdir(FIXTURE_DIR)).filter(name => name.endsWith('.json')).sort().map(name => path.join(FIXTURE_DIR, name));
  let failed = false;
  for (const file of files) {
    const report = await verifyFixture(file, {out});
    failed ||= !report.pass;
    console.log(`${report.pass ? 'PASS' : 'FAIL'} ${report.label} (min SSIM ${report.min.toFixed(4)}, threshold ${report.threshold})`);
    for (const row of report.rows) console.log(`  ${row.label.padEnd(20)} t=${row.t.toFixed(3).padStart(7)}  ssim ${row.ssim.toFixed(4)}${row.pass ? '' : '  <'}`);
  }
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

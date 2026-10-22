#!/usr/bin/env node
// Local parity check for the batch B editorial components (to be merged into
// scripts/parity.mjs). For a fixture {story, sceneId, threshold?} it renders
// the one editorial scene with the HyperFrames emitter (a one-module project,
// `hyperframes snapshot`) and with the Remotion component (the test entry in
// test/fixtures/parity-entry-b, `renderStill`), compares the stills with
// ffmpeg ssim, and writes side-by-side PNGs plus report.json.
//
//   node scripts/parity-b.mjs <fixture.json>... [--out qa/parity-b] [--dense]
//
// Sample times: enter-mid, settle (enter end), every event + 0.4s, exit-mid,
// each snapped to the frame grid so both renderers draw the same instant.
import { execFile } from 'node:child_process';
import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { resolveEditorialModule } from '../kit/core/editorial-core.mjs';
import { buildEditorialModule } from '../skills/launchclip-create-video/scripts/editorial-ui-modules.mjs';
import { injectParityFonts } from './parity-fonts.mjs';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'test', 'fixtures', 'parity-entry-b', 'entry.tsx');
const HYPERFRAMES = path.join(ROOT, 'node_modules', '.bin', 'hyperframes');
const GSAP = path.join(path.dirname(require.resolve('gsap/package.json')), 'dist', 'gsap.min.js');
export const DEFAULT_THRESHOLD = 0.97;

export function sceneSpec({ story, sceneId }) {
  const scene = story.scenes.find((entry) => entry.id === sceneId);
  if (!scene) throw new Error(`scene ${sceneId} not found`);
  const { width, height } = story.format;
  return { scene, spec: { ...scene.params, id: scene.id, kind: scene.module, aspect: width > height ? '16:9' : '9:16', start: scene.start, duration: scene.end - scene.start } };
}

// dense adds a mid-tween sample 0.1s before every event (events are settle
// times), to check in-module motion while it is moving.
export function sampleTimes(model, fps, { dense = false } = {}) {
  const m = model.motion, snap = (t) => Math.round(t * fps) / fps;
  const last = snap(model.end) - 1 / fps;
  const raw = [['enter-mid', m.enterStart + m.enterDuration / 2], ['settle', m.enterEnd]];
  for (const event of model.events) if (!event.id.endsWith('-enter')) {
    raw.push([`${event.id}+0.4`, event.time + 0.4]);
    if (dense) raw.push([`${event.id}-0.1`, event.time - 0.1]);
  }
  raw.push(['exit-mid', m.exitStart + m.exitDuration / 2]);
  const seen = new Set();
  return raw.map(([label, t]) => ({ label, t: Math.min(last, Math.max(model.start, snap(t))) }))
    .filter(({ t }) => (seen.has(t) ? false : seen.add(t)))
    .sort((a, b) => a.t - b.t);
}

function hyperframesHtml(story, model, module) {
  const { width, height, duration } = story.format;
  const bg = story.brand?.colors?.bg ?? '#000000';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>parity</title>
<style>html,body{margin:0;padding:0;background:#000}#parity{position:relative;width:${width}px;height:${height}px;overflow:hidden}#parity-bg{position:absolute;left:0;top:0;width:${width}px;height:${height}px;background:${bg}}${module.css}</style>
</head><body>
<div id="parity" data-composition-id="parity" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
<div id="parity-bg" class="clip" data-start="0" data-duration="${duration}" data-track-index="0"></div>
${module.html}
</div>
<script src="gsap.min.js"></script>
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
${module.motion}
window.__timelines["parity"] = tl;
</script>
</body></html>
`;
}

async function hyperframesStills(project, times, outDir) {
  const frames = path.join(project, '.snapshots');
  await rm(frames, { recursive: true, force: true });
  await run(HYPERFRAMES, ['snapshot', '--at', times.map((t) => String(t)).join(','), '--no-end', '--output', frames, '--describe', 'false', project], { cwd: project, maxBuffer: 1 << 26 });
  const files = (await readdir(frames)).filter((name) => /^frame-.*\.png$/i.test(name)).sort();
  if (files.length !== times.length) throw new Error(`hyperframes snapshot wrote ${files.length} frames for ${times.length} times: ${files.join(', ')}`);
  const out = [];
  for (const [i, t] of times.entries()) {
    const file = path.join(outDir, `hf-${t.toFixed(3)}.png`);
    await copyFile(path.join(frames, files[i]), file);
    out.push(file);
  }
  return out;
}

let bundled = null;
async function remotionBundle(publicDir) {
  if (bundled?.publicDir === publicDir) return bundled.serveUrl;
  const { bundle } = await import('@remotion/bundler');
  const serveUrl = await bundle({ entryPoint: ENTRY, publicDir, onProgress: () => {} });
  bundled = { publicDir, serveUrl };
  return serveUrl;
}

async function remotionStills(fixture, scene, times, outDir, publicDir) {
  const { selectComposition, renderStill } = await import('@remotion/renderer');
  const serveUrl = await remotionBundle(publicDir);
  const inputProps = { scene, story: fixture.story };
  const composition = await selectComposition({ serveUrl, id: 'ModuleReview', inputProps });
  const out = [];
  for (const t of times) {
    const file = path.join(outDir, `rm-${t.toFixed(3)}.png`);
    const frame = Math.min(composition.durationInFrames - 1, Math.round((t - scene.start) * composition.fps));
    await renderStill({ composition, serveUrl, output: file, frame, inputProps, imageFormat: 'png', overwrite: true });
    out.push(file);
  }
  return out;
}

// crop: optional {x,y,width,height} region (the module rect plus a margin),
// a stricter view than the whole frame, where the background dominates.
async function ssim(a, b, crop = null) {
  const filter = crop ? `[0:v]crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}[a];[1:v]crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}[b];[a][b]ssim` : 'ssim';
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', a, '-i', b, '-lavfi', filter, '-f', 'null', '-'], { maxBuffer: 1 << 24 });
  const match = /All:([0-9.]+)/.exec(stderr);
  if (!match) throw new Error(`no ssim in ffmpeg output: ${stderr.slice(-400)}`);
  return Number(match[1]);
}

async function sideBySide(a, b, out) {
  await run('ffmpeg', ['-v', 'error', '-y', '-i', a, '-i', b, '-filter_complex', 'hstack=inputs=2', out]);
}

export async function parity(fixturePath, { out, dense = false } = {}) {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const name = path.basename(fixturePath, '.json');
  const outDir = path.resolve(out ?? path.join(ROOT, 'qa', 'parity-b'), name);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const { scene, spec } = sceneSpec(fixture);
  const model = resolveEditorialModule(spec);
  const module = buildEditorialModule(spec);
  const fps = fixture.story.format.fps;
  const samples = sampleTimes(model, fps, { dense });
  const threshold = fixture.threshold?.ssim ?? DEFAULT_THRESHOLD;

  const publicDir = path.dirname(path.resolve(fixturePath));
  const project = path.join(outDir, 'hf-project');
  await mkdir(project, { recursive: true });
  await writeFile(path.join(project, 'index.html'), hyperframesHtml(fixture.story, model, module));
  await injectParityFonts(fixture.story, project);
  await copyFile(GSAP, path.join(project, 'gsap.min.js'));
  if (existsSync(path.join(publicDir, 'assets'))) await cp(path.join(publicDir, 'assets'), path.join(project, 'assets'), { recursive: true });

  const times = samples.map((sample) => sample.t);
  const hf = await hyperframesStills(project, times, outDir);
  const rm_ = await remotionStills(fixture, scene, times, outDir, publicDir);
  const { width, height } = fixture.story.format, r = model.rect, margin = 64;
  const x = Math.max(0, Math.floor(r.x - margin)), y = Math.max(0, Math.floor(r.y - margin));
  const crop = { x, y, width: Math.min(width, Math.ceil(r.x + r.width + margin)) - x, height: Math.min(height, Math.ceil(r.y + r.height + margin)) - y };
  const results = [];
  for (const [i, sample] of samples.entries()) {
    const score = await ssim(hf[i], rm_[i]);
    const rectSsim = await ssim(hf[i], rm_[i], crop);
    const pair = path.join(outDir, `pair-${sample.t.toFixed(3)}.png`);
    await sideBySide(hf[i], rm_[i], pair);
    results.push({ ...sample, ssim: score, rectSsim, pass: score >= threshold, pair });
  }
  const report = { fixture: path.relative(ROOT, path.resolve(fixturePath)), kind: model.kind, threshold, pass: results.every((r) => r.pass), min: Math.min(...results.map((r) => r.ssim)), samples: results };
  await writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const out = outIndex >= 0 ? args.splice(outIndex, 2)[1] : undefined;
  const dense = args.includes('--dense');
  if (dense) args.splice(args.indexOf('--dense'), 1);
  if (!args.length) {
    process.stderr.write('Usage: node scripts/parity-b.mjs <fixture.json>... [--out dir]\n');
    process.exit(2);
  }
  let failed = false;
  for (const file of args) {
    try {
      const report = await parity(file, { out, dense });
      failed ||= !report.pass;
      process.stdout.write(`${report.pass ? 'PASS' : 'FAIL'} ${path.basename(file)} min ${report.min.toFixed(4)} (threshold ${report.threshold})\n`);
      for (const s of report.samples) process.stdout.write(`  ${s.pass ? ' ' : '!'} ${s.t.toFixed(3)}s ${s.label.padEnd(40)} ${s.ssim.toFixed(4)}  rect ${s.rectSsim.toFixed(4)}\n`);
    } catch (error) {
      failed = true;
      process.stdout.write(`ERROR ${path.basename(file)}: ${error.stack}\n`);
    }
  }
  process.exit(failed ? 1 : 0);
}

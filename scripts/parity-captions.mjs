#!/usr/bin/env node
// Caption preset parity (docs/KIT_CONTRACTS.md, "Caption presets").
//
//   node scripts/parity-captions.mjs [preset ...] [--out qa/parity-captions]
//
// Each fixture in test/fixtures/parity-captions/<preset>.json is
// {preset, overlay?, times, threshold?}. The harness takes the minimal golden
// story (examples/story/minimal: two modules and its NARRATION.json), sets its
// captions overlay to the fixture's preset and options, compiles it with the
// HyperFrames story compiler and snapshots the sampled times (word boundaries
// and mid-animation), renders the same frames of the LaunchclipStory
// composition with Remotion (one bundle and one browser for every preset), and
// compares each pair with ffmpeg SSIM (threshold 0.97).
import {existsSync} from 'node:fs';
import {copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {DEFAULT_ENTRY, DEFAULT_THRESHOLD, bundleRemotion, compareStills, hyperframesStills, sideBySide} from './parity.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const CAPTION_FIXTURES = path.join(ROOT, 'test', 'fixtures', 'parity-captions');
const BASE_STORY = path.join(ROOT, 'examples', 'story', 'minimal');

export async function captionFixtures() {
  const files = (await readdir(CAPTION_FIXTURES)).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(files.map(async (file) => ({file: path.join(CAPTION_FIXTURES, file), ...JSON.parse(await readFile(path.join(CAPTION_FIXTURES, file), 'utf8'))})));
}

/** The minimal golden story with the fixture's captions overlay, resolved; plus its words and chunks. */
export async function captionStory(fixture) {
  const {resolveStory} = await import(pathToFileURL(path.join(ROOT, 'kit', 'core', 'story.mjs')).href);
  const {chunkWords} = await import(pathToFileURL(path.join(ROOT, 'kit', 'core', 'captions.mjs')).href);
  const story = JSON.parse(await readFile(path.join(BASE_STORY, 'storyboard.json'), 'utf8'));
  const words = JSON.parse(await readFile(path.join(BASE_STORY, 'NARRATION.json'), 'utf8')).words;
  delete story.audio.mix;
  story.overlays = [{type: 'captions', preset: fixture.preset, ...(fixture.overlay ?? {})}];
  return {story: resolveStory(story, {words}), words, chunks: chunkWords(words)};
}

/**
 * Compare one preset. options: {out, bundle (prebuilt Remotion bundle), browser}.
 * → {preset, threshold, minSsim, pass, samples, outDir}
 */
export async function runCaptionParity(fixture, {out, bundle, browser} = {}) {
  const {compileStoryToHyperFrames} = await import(pathToFileURL(path.join(ROOT, 'kit', 'hyperframes', 'story-compiler.mjs')).href);
  const {selectComposition, renderStill} = await import('@remotion/renderer');
  const threshold = {...DEFAULT_THRESHOLD, ...(fixture.threshold ?? {})};
  const outDir = path.resolve(out ?? path.join(ROOT, 'qa', 'parity-captions', fixture.preset));
  await mkdir(outDir, {recursive: true});
  const work = await mkdtemp(path.join(os.tmpdir(), `launchclip-caption-parity-${fixture.preset}-`));
  try {
    const {story, chunks} = await captionStory(fixture);
    const source = path.join(work, 'source');
    await mkdir(source, {recursive: true});
    await copyFile(path.join(BASE_STORY, 'NARRATION.json'), path.join(source, 'NARRATION.json'));
    const hfDir = path.join(work, 'hyperframes');
    const compiled = await compileStoryToHyperFrames(story, {projectDir: hfDir, sourceDir: source});
    const fps = story.resolved.fps;
    const samples = fixture.times.map((time) => ({name: `t${time}`, time: Math.round(time * fps) / fps}));
    const hf = await hyperframesStills(hfDir, samples, outDir);
    const inputProps = {...story, __captions: chunks};
    const composition = await selectComposition({serveUrl: bundle, id: 'LaunchclipStory', inputProps, puppeteerInstance: browser, logLevel: 'error'});
    const results = [];
    for (const [i, sample] of samples.entries()) {
      const rm = path.join(outDir, `${sample.name}.remotion.png`);
      await renderStill({serveUrl: bundle, composition, inputProps, frame: Math.round(sample.time * fps), output: rm, imageFormat: 'png', puppeteerInstance: browser, logLevel: 'error'});
      const metrics = await compareStills(hf[i], rm);
      const side = path.join(outDir, `${sample.name}.side-by-side.png`), diff = path.join(outDir, `${sample.name}.diff.png`);
      await sideBySide(hf[i], rm, side, diff);
      results.push({name: sample.name, time: sample.time, ssim: metrics.ssim, psnr: metrics.psnr, pass: metrics.ssim >= threshold.ssim, sideBySide: path.basename(side)});
    }
    const report = {preset: fixture.preset, fixture: path.relative(ROOT, fixture.file ?? ''), threshold, warnings: compiled.warnings, minSsim: Math.min(...results.map((entry) => entry.ssim)), pass: results.every((entry) => entry.pass), samples: results};
    await writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, (key, value) => (value === Infinity ? 'inf' : value), 2)}\n`);
    return {...report, outDir};
  } finally {
    await rm(work, {recursive: true, force: true});
  }
}

/** Bundle once, open one browser, run every given fixture. */
export async function runCaptionParitySuite(fixtures, {out = path.join(ROOT, 'qa', 'parity-captions'), onReport} = {}) {
  const {openBrowser} = await import('@remotion/renderer');
  const work = await mkdtemp(path.join(os.tmpdir(), 'launchclip-caption-parity-'));
  const publicDir = path.join(work, 'public');
  await mkdir(publicDir, {recursive: true});
  const bundle = await bundleRemotion(DEFAULT_ENTRY, path.join(work, 'bundle'), {publicDir});
  const browser = await openBrowser('chrome');
  const reports = [];
  try {
    for (const fixture of fixtures) {
      const report = await runCaptionParity(fixture, {out: path.join(out, fixture.preset), bundle, browser});
      reports.push(report);
      onReport?.(report);
    }
  } finally {
    await browser.close({silent: true}).catch(() => {});
    await rm(work, {recursive: true, force: true});
  }
  return reports;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const out = outIndex >= 0 ? path.resolve(args[outIndex + 1]) : undefined;
  const wanted = args.filter((arg, index) => !arg.startsWith('--') && index !== outIndex + 1);
  const all = await captionFixtures();
  const fixtures = wanted.length ? all.filter((fixture) => wanted.includes(fixture.preset)) : all;
  if (!existsSync(DEFAULT_ENTRY)) throw new Error(`Remotion entry not found: ${DEFAULT_ENTRY}`);
  const reports = await runCaptionParitySuite(fixtures, {out, onReport: (report) => process.stdout.write(`${report.pass ? 'PASS' : 'FAIL'} ${report.preset.padEnd(16)} min ssim ${report.minSsim.toFixed(4)}\n`)});
  process.exitCode = reports.every((report) => report.pass) ? 0 : 1;
}

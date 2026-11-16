#!/usr/bin/env node
// Contact sheet for the CSS transitions, behaviours and backgrounds
// (docs/FINISHING_AND_ELEMENTS_RFC.md E.3, phase 3): HyperFrames and Remotion
// stills side by side, mid-transition and at rest, from the parity runs.
//
//   node scripts/css-sheet.mjs [--out qa/finishing/css-transitions.png] [--tile 216]
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {loadPlaywright} from '../src/demo/record.js';
import {runStoryParity} from './parity.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STORY = path.join(ROOT, 'examples', 'story', 'css-transitions-9x16');
const MINIMAL = path.join(ROOT, 'examples', 'story', 'minimal');

// [label, time] on the story; [label, background] on the minimal story at 1.2 s.
export const STORY_TILES = Object.freeze([
  ['orbit (rest)', 1.5], ['wipe 135° mid', 2.45], ['pendulum', 3.4], ['clock-wipe mid', 4.45], ['heartbeat', 5.4],
  ['clock fan ×3 mid', 6.45], ['card-flip out', 8.25], ['card-flip in', 8.6], ['hard wipe up mid', 10.45],
  ['flicker', 11.5], ['card-flip right in', 12.6], ['spin', 13.5]
]);
export const BACKGROUND_TILES = Object.freeze([
  ['bg rings', {kind: 'rings'}], ['bg bokeh', {kind: 'bokeh'}], ['bg motif checker', {kind: 'motif', params: {shape: 'checker'}}],
  ['bg motif grid', {kind: 'motif', params: {shape: 'grid'}}], ['bg light-rays sweep', {kind: 'light-rays', params: {sweep: 1}}]
]);

const value = (argv, flag, fallback) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback);

async function main(argv) {
  const out = path.resolve(value(argv, '--out', path.join(ROOT, 'qa', 'finishing', 'css-transitions.png')));
  const tile = Number(value(argv, '--tile', 216));
  await mkdir(path.dirname(out), {recursive: true});
  const work = await mkdtemp(path.join(os.tmpdir(), 'launchclip-css-sheet-'));
  try {
    const pairs = [];
    const story = await runStoryParity(STORY, {times: STORY_TILES.map(([, t]) => t), out: path.join(work, 'story')});
    STORY_TILES.forEach(([text], i) => pairs.push({text: `${text} ssim ${story.samples[i].ssim.toFixed(3)}`, dir: story.outDir, name: story.samples[i].name}));
    for (const [text, background] of BACKGROUND_TILES) {
      const report = await runStoryParity(MINIMAL, {times: [1.2], patch: {background}, out: path.join(work, text.replace(/\W+/g, '-'))});
      pairs.push({text: `${text} ssim ${report.samples[0].ssim.toFixed(3)}`, dir: report.outDir, name: report.samples[0].name});
    }
    // One cell: HyperFrames | Remotion, labelled; five cells a row (an HTML page screenshotted, as finish-sheet.mjs).
    const h = Math.round((tile * 16) / 9), cols = 5, cell = 2 * tile + 4;
    const html = path.join(work, 'sheet.html');
    const img = (file) => `<img src="${pathToFileURL(file).href}">`;
    await writeFile(html, `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#111;color:#eee;font:600 14px/1.2 system-ui,sans-serif;display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:12px;padding:12px;width:max-content}figure{margin:0}img{width:${tile}px;height:${h}px}div{display:flex;gap:4px}figcaption{padding:6px 2px 0}</style>
<p style="grid-column:1/-1;margin:0">HyperFrames left, Remotion right in each pair</p>
${pairs.map((pair) => `<figure><div>${img(path.join(pair.dir, `${pair.name}.hyperframes.png`))}${img(path.join(pair.dir, `${pair.name}.remotion.png`))}</div><figcaption>${pair.text}</figcaption></figure>`).join('\n')}`);
    const chromium = await loadPlaywright();
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({viewport: {width: cols * (cell + 12) + 12, height: 400}});
      await page.goto(pathToFileURL(html).href);
      await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
      await page.screenshot({path: out, fullPage: true});
    } finally {
      await browser.close();
    }
    process.stdout.write(`${path.relative(ROOT, out)}: ${pairs.length} pairs (HyperFrames left, Remotion right)\n`);
  } finally {
    await rm(work, {recursive: true, force: true});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
}

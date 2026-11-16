#!/usr/bin/env node
// Contact sheet for the finish passes (src/finish_pass.js): one Remotion
// still of a story, then that still through each pass in SHEET, tiled with
// labels. The caption band and brand frame stay crisp (the protect mask).
//
//   node scripts/finish-sheet.mjs [--story examples/story/explainer-9x16]
//     [--at 3.2] [--out qa/finishing/finish-passes.png] [--tile 360]
import {cp, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolveFinish} from '@launchclip/core/finish.mjs';
import {finishChain, runFinishPass} from '../src/finish_pass.js';
import {storyFinishProtect, storyFrames} from '../src/render_segments.js';
import {getRenderer} from '../src/renderers/index.js';
import {readProjectStory} from '../src/story_loader.js';
import {loadPlaywright} from '../src/demo/record.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Each tile: a label and the story.finish (and story.grade) it shows.
export const SHEET = Object.freeze([
  {label: 'none', finish: []},
  {label: 'grade teal-amber', finish: [{pass: 'grade', preset: 'teal-amber'}]},
  {label: 'grade warm-film, brand tint', finish: [{pass: 'grade', preset: 'warm-film', tint: 'brand'}]},
  {label: 'grain 0.12', finish: [{pass: 'grain', amount: 0.12}]},
  {label: 'aberration 3 px', finish: [{pass: 'aberration', px: 3}]},
  {label: 'aberration + grade + grain', finish: [{pass: 'aberration', px: 2}, {pass: 'grade', preset: 'cool-tech'}, {pass: 'grain', amount: 0.08}]},
  {label: 'bloom 0.65 / 1.2', finish: [{pass: 'bloom', threshold: 0.65, strength: 1.2}]},
  {label: 'zoom-blur 0.18 (on a hit)', finish: [{pass: 'zoom-blur', amount: 0.18, at: 'here'}]},
  {label: 'burn (mid-hit)', finish: [{pass: 'burn', at: 'here', frames: 14}], offset: -3},
  {label: 'crt', finish: [{pass: 'crt', scan: 0.5, grille: 0.3, curvature: 0.06, tracking: 0.5}]},
  {label: 'halftone dot', finish: [{pass: 'halftone', cell: 12}]},
  {label: 'halftone line', finish: [{pass: 'halftone', cell: 10, mode: 'line', angle: 30}]},
  {label: 'halftone duotone', finish: [{pass: 'halftone', cell: 10, mode: 'duotone'}]},
  {label: 'crt + bloom + grain', finish: [{pass: 'crt', scan: 0.45, grille: 0.25}, {pass: 'bloom', threshold: 0.7, strength: 0.8}, {pass: 'grain', amount: 0.06}]}
]);

function args(argv) {
  const out = {story: 'examples/story/explainer-9x16', at: 3.2, out: 'qa/finishing/finish-passes.png', tile: 300};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return {...out, at: Number(out.at), tile: Number(out.tile)};
}

const opts = args(process.argv.slice(2));
const work = await mkdtemp(path.join(os.tmpdir(), 'launchclip-finish-sheet-'));
try {
  // A copy: the Remotion adapter writes .launchclip/ into the project.
  const project = path.join(work, 'project');
  await cp(path.resolve(ROOT, opts.story), project, {recursive: true});
  const {resolved: story} = await readProjectStory(project);
  const {width, height, fps} = storyFrames(story);
  const frame = Math.round(opts.at * fps);
  const still = path.join(work, 'still.png');
  await getRenderer('remotion').still(project, frame / fps, still);
  const rects = await storyFinishProtect(project, story);
  const tiles = [];
  for (const [i, entry] of SHEET.entries()) {
    const file = path.join(work, `tile-${i}.png`);
    // A grade alone is the ffmpeg path in a render; the sheet shows it through the chain with a zero grain.
    const finish = entry.finish.length && entry.finish.every((e) => e.pass === 'grade') ? [...entry.finish, {pass: 'grain', amount: 0}] : entry.finish;
    // at: 'here' puts the tile's hit on the still's own time (offset frames before it).
    const chain = resolveFinish({...story, grade: undefined, finish: finish.map((e) => (e.at === 'here' ? {...e, at: [(frame - (entry.offset ?? 0)) / fps]} : e))});
    if (chain) await runFinishPass({input: still, output: file, ...(await finishChain(project, story, chain)), width, height, fps, frameStart: frame, rects, kind: 'image'});
    tiles.push({label: entry.label, file: chain ? file : still});
  }
  const tileH = Math.round(opts.tile * height / width), cols = 4;
  const html = path.join(work, 'sheet.html');
  await writeFile(html, `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#111;color:#eee;font:600 15px/1.2 system-ui,sans-serif;display:grid;grid-template-columns:repeat(${cols},${opts.tile}px);gap:12px;padding:12px;width:max-content}figure{margin:0}img{width:${opts.tile}px;height:${tileH}px;display:block}figcaption{padding:6px 2px 0}</style>
${tiles.map((t) => `<figure><img src="${pathToFileURL(t.file).href}"><figcaption>${t.label}</figcaption></figure>`).join('\n')}`);
  const chromium = await loadPlaywright();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport: {width: cols * (opts.tile + 12) + 12, height: 400}});
    await page.goto(pathToFileURL(html).href);
    await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
    await page.screenshot({path: path.resolve(ROOT, opts.out), fullPage: true});
  } finally {
    await browser.close();
  }
  console.log(path.relative(ROOT, path.resolve(ROOT, opts.out)));
} finally {
  await rm(work, {recursive: true, force: true});
}

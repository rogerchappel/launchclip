#!/usr/bin/env node
// State events without a full render: does each state change read as a
// visual event? Compiles a storyboard to HyperFrames, seeks its timeline frame
// by frame in Chromium around every state change (eval/scorecard.mjs
// stateMarks: scene.states and in-shot swaps), encodes each window and reads
// ffmpeg's scene score, the measure the scorecard's cadence uses. Prints each
// change's peak and the median against STATE_EVENT.min (0.08); exits 1 when
// the median is under it.
//
//   node scripts/state-events.mjs <storyboard.json | project dir> [--narration NARRATION.json] [--out dir] [--json]
import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {resolveStory} from '../kit/core/story.mjs';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';
import {STATE_EVENT, parseSceneScores, stateEvents, stateMarks} from '../eval/scorecard.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GSAP = path.join(ROOT, 'node_modules', 'gsap', 'dist', 'gsap.min.js');

/**
 * Seek-measure a resolved story. → stateEvents() plus {frames}
 * options: {sourceDir (assets), out (keep the frames there), chromium}
 */
export async function measureStateEvents(story, {sourceDir, out = null, chromium = null} = {}) {
  const work = out ?? await mkdtemp(path.join(os.tmpdir(), 'launchclip-state-events-'));
  const project = path.join(work, 'hyperframes');
  await compileStoryToHyperFrames(story, {projectDir: project, sourceDir: sourceDir ?? project});
  const {width, height} = story.format;
  const fps = Number(story.resolved?.fps ?? story.format.fps ?? 30);
  const browserType = chromium ?? (await import('playwright')).chromium;
  const browser = await browserType.launch({headless: true});
  const scores = [];
  let frames = 0;
  try {
    const page = await browser.newPage({viewport: {width, height}});
    // The compiled page loads GSAP from the CDN; serve the pinned local copy.
    await page.route(/cdn\.jsdelivr\.net\/npm\/gsap/, route => route.fulfill({path: GSAP, contentType: 'text/javascript'}));
    await page.goto(`file://${path.join(project, 'index.html')}`);
    for (let i = 0; i < 150 && !(await page.evaluate(() => Boolean(window.__timelines?.['launchclip-story']))); i += 1) await new Promise(resolve => setTimeout(resolve, 200));
    await page.evaluate(() => document.fonts.ready.then(() => true));
    for (const [k, mark] of stateMarks(story).entries()) {
      const dir = path.join(work, `mark-${k}`);
      await mkdir(dir, {recursive: true});
      // One frame before the window, so the first change frame has a previous frame.
      const first = Math.max(0, Math.round((mark.t - STATE_EVENT.before) * fps) - 1);
      const last = Math.round((mark.t + STATE_EVENT.after) * fps);
      for (let f = first; f <= last; f += 1) {
        await page.evaluate(t => { const tl = window.__timelines['launchclip-story']; tl.pause(); tl.seek(t, false); }, f / fps + 0.0005);
        await page.screenshot({path: path.join(dir, `${String(f - first).padStart(4, '0')}.png`)});
        frames += 1;
      }
      const video = path.join(dir, 'window.mp4');
      await run('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(fps), '-i', path.join(dir, '%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', video]);
      const {stderr} = await run('ffmpeg', ['-hide_banner', '-i', video, '-vf', "select='gte(scene,0)',metadata=print:key=lavfi.scene_score", '-an', '-f', 'null', '-'], {maxBuffer: 1 << 26}).catch(error => error);
      // The window's first frame has no previous frame: skip it.
      for (const frame of parseSceneScores(stderr).slice(1)) scores.push({t: Math.round(((first) / fps + frame.t) * 1000) / 1000, score: frame.score});
    }
  } finally {
    await browser.close();
    if (!out) await rm(work, {recursive: true, force: true});
  }
  return {...stateEvents(scores, story), frames};
}

function args(argv) {
  const out = {input: null, narration: null, out: null, json: false};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--narration') out.narration = argv[++i];
    else if (argv[i] === '--out') out.out = path.resolve(argv[++i]);
    else if (argv[i] === '--json') out.json = true;
    else out.input = argv[i];
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = args(process.argv.slice(2));
  if (!options.input) { console.error('usage: node scripts/state-events.mjs <storyboard.json | project dir> [--narration NARRATION.json] [--out dir] [--json]'); process.exit(2); }
  const file = existsSync(path.join(options.input, 'storyboard.json')) ? path.join(options.input, 'storyboard.json') : options.input;
  const dir = path.dirname(path.resolve(file));
  const narration = options.narration ?? (existsSync(path.join(dir, 'NARRATION.json')) ? path.join(dir, 'NARRATION.json') : null);
  const words = narration ? JSON.parse(await readFile(narration, 'utf8')) : [];
  const story = resolveStory(JSON.parse(await readFile(file, 'utf8')), {words: Array.isArray(words) ? words : words.words ?? []});
  const result = await measureStateEvents(story, {sourceDir: dir, out: options.out});
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const mark of result.marks) console.log(`${mark.t.toFixed(2).padStart(7)} s  ${mark.peak.toFixed(3)}  ${mark.peak >= result.min ? 'event' : 'UNDER'}  ${mark.id}  ${mark.label}`);
    console.log(`median ${result.median} (want ≥ ${result.min}); ${result.under.length} of ${result.marks.length} under`);
  }
  process.exit(result.median !== null && result.median < result.min ? 1 : 0);
}

#!/usr/bin/env node
// Background contact sheet (docs/KIT_CONTRACTS.md, "Backgrounds and panels").
//
//   node scripts/background-sheet.mjs [--out qa/background-sheet] [--time 5.5] [--project examples/story/minimal]
//
// Renders one HyperFrames still of the project for every background kind
// (kit/core/backgrounds.mjs BACKGROUND_KINDS), on a dark and a light palette,
// and tiles them into sheet.png: one row per palette, one column per kind,
// labelled when a system font is available. Each still keeps the project's
// content and captions, so the sheet shows text over every background.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {BACKGROUND_KINDS} from '../kit/core/backgrounds.mjs';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';
import {getRenderer} from '../src/renderers/index.js';
import {readProjectStory} from '../src/story_loader.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SHEET_PALETTES = Object.freeze({
  dark: Object.freeze({bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}),
  light: Object.freeze({bg: '#f5f1e8', primary: '#c2410c', accent: '#0e7490', ink: '#f5f1e8', paper: '#1c1917'})
});
const FONTS = ['/System/Library/Fonts/Supplemental/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', 'ignore', 'pipe']});
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr.slice(-2000)}`))));
  });
}

async function main(argv) {
  const value = (flag, fallback) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback);
  const out = path.resolve(value('--out', path.join(ROOT, 'qa', 'background-sheet')));
  const time = Number(value('--time', '5.5'));
  const project = path.resolve(value('--project', path.join(ROOT, 'examples', 'story', 'minimal')));
  await mkdir(out, {recursive: true});
  const loaded = await readProjectStory(project);
  const hyperframes = getRenderer('hyperframes');
  const work = await mkdtemp(path.join(os.tmpdir(), 'launchclip-background-sheet-'));
  const cells = [];
  try {
    for (const [palette, colors] of Object.entries(SHEET_PALETTES)) {
      for (const kind of BACKGROUND_KINDS) {
        const story = {...loaded.resolved, brand: {...loaded.resolved.brand, colors: {...colors}}, background: {kind}};
        const dir = path.join(work, `${palette}-${kind}`);
        await compileStoryToHyperFrames(story, {projectDir: dir, sourceDir: project});
        const file = path.join(out, `${palette}-${kind}.png`);
        await hyperframes.still(dir, time, file);
        cells.push({palette, kind, file});
        process.stdout.write(`${palette} ${kind}\n`);
      }
    }
  } finally {
    await rm(work, {recursive: true, force: true});
  }
  // Tile: each still scaled to 360 px wide, labelled, one row per palette.
  const font = FONTS.find(file => existsSync(file));
  const columns = BACKGROUND_KINDS.length;
  const filters = cells.map((cell, i) => {
    const label = font ? `,drawbox=x=0:y=ih-44:w=iw:h=44:color=black@0.6:t=fill,drawtext=fontfile=${font}:text='${cell.palette} ${cell.kind}':x=12:y=h-32:fontsize=22:fontcolor=white` : '';
    return `[${i}:v]scale=360:-2${label}[c${i}]`;
  });
  const layout = cells.map((_, i) => `${(i % columns) === 0 ? '0' : Array.from({length: i % columns}, () => 'w0').join('+')}_${Math.floor(i / columns) === 0 ? '0' : 'h0'}`).join('|');
  const sheet = path.join(out, 'sheet.png');
  await run('ffmpeg', ['-y', '-loglevel', 'error', ...cells.flatMap(cell => ['-i', cell.file]), '-filter_complex', `${filters.join(';')};${cells.map((_, i) => `[c${i}]`).join('')}xstack=inputs=${cells.length}:layout=${layout}[out]`, '-map', '[out]', '-frames:v', '1', sheet]);
  process.stdout.write(`${sheet}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 2; });
}

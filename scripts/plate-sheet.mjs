#!/usr/bin/env node
// Backdrop plate sheet (docs/KIT_CONTRACTS.md, "Backdrop plates").
//
//   node scripts/plate-sheet.mjs [--out qa/plate-sheet] [--renderer hyperframes|remotion] [--time 3]
//
// Renders one still per backdrop plate (kit/core/plates.mjs PLATE_KINDS) under
// each of three glass card types (stat-card, excerpt, window-chrome) in the
// glass-explainer look (kit/styles/glass-explainer.json: rim-glass panels),
// and tiles them into sheet.png: one row per plate, one column per card,
// labelled when ffmpeg has drawtext and a system font is available.
import {spawn} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PLATE_KINDS} from '../kit/core/plates.mjs';
import {resolveStory} from '../kit/core/story.mjs';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';
import {getRenderer} from '../src/renderers/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACK = JSON.parse(readFileSync(path.join(ROOT, 'kit', 'styles', 'glass-explainer.json'), 'utf8'));
const FONTS = ['/System/Library/Fonts/Supplemental/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'];
export const SHEET_CARDS = Object.freeze([
  {name: 'stat-card', module: 'stat-card', params: {value: '1.05M', label: 'tokens of context, about ten novels', source: 'Example figure', surface: 'card'}},
  {name: 'excerpt', module: 'excerpt', params: {type: 'code', title: 'policy.json', lines: ['"review": {', '  "model": "glass-6",', '  "reasoningEffort": "high"', '}'], source: 'Example config', surface: 'card'}},
  {name: 'window-chrome', module: 'window-chrome', params: {title: 'eval.yaml', variant: 'terminal', lines: ['judge: glass-6', 'reasoning_effort: high', 'timeout: 10m']}}
]);

/** The one-scene story for a plate and a card, in the glass-explainer look. */
export function sheetStory(kind, card) {
  return {schema: 'launchclip.story.v1', lane: 'motion', title: `${kind} · ${card.name}`, format: {width: 1920, height: 1080, fps: 30, duration: 5},
    brand: {colors: {...PACK.brand.colors}, fonts: {...PACK.brand.fonts}}, panel: {...PACK.layouts.panel}, plate: {kind, params: {...PACK.plate.params}}, ambient: 'standard',
    scenes: [{id: 'card', module: card.module, start: 0, end: 5, params: card.params}], ending: {loop: false, final: 'hold'}};
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', 'ignore', 'pipe']});
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr.slice(-2000)}`))));
  });
}

function hasDrawtext() {
  return new Promise(resolve => {
    const child = spawn('ffmpeg', ['-hide_banner', '-filters'], {stdio: ['ignore', 'pipe', 'ignore']});
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('error', () => resolve(false));
    child.on('close', () => resolve(/\sdrawtext\s/.test(out)));
  });
}

async function tile(cells, columns, width, file) {
  const font = (await hasDrawtext()) ? FONTS.find(entry => existsSync(entry)) : null;
  const filters = cells.map((cell, i) => {
    const label = font ? `,drawbox=x=0:y=ih-40:w=iw:h=40:color=black@0.6:t=fill,drawtext=fontfile=${font}:text='${cell.label}':x=12:y=h-29:fontsize=20:fontcolor=white` : '';
    return `[${i}:v]scale=${width}:-2${label}[c${i}]`;
  });
  const layout = cells.map((_, i) => `${(i % columns) === 0 ? '0' : Array.from({length: i % columns}, () => 'w0').join('+')}_${Math.floor(i / columns) === 0 ? '0' : Array.from({length: Math.floor(i / columns)}, () => 'h0').join('+')}`).join('|');
  await run('ffmpeg', ['-y', '-loglevel', 'error', ...cells.flatMap(cell => ['-i', cell.file]), '-filter_complex', `${filters.join(';')};${cells.map((_, i) => `[c${i}]`).join('')}xstack=inputs=${cells.length}:layout=${layout}[out]`, '-map', '[out]', '-frames:v', '1', file]);
}

async function main(argv) {
  const value = (flag, fallback) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback);
  const out = path.resolve(value('--out', path.join(ROOT, 'qa', 'plate-sheet')));
  const rendererName = value('--renderer', 'hyperframes');
  const time = Number(value('--time', '3'));
  const renderer = getRenderer(rendererName);
  await mkdir(out, {recursive: true});
  const work = await mkdtemp(path.join(os.tmpdir(), 'launchclip-plate-sheet-'));
  const cells = [];
  try {
    for (const kind of PLATE_KINDS) for (const card of SHEET_CARDS) {
      const dir = path.join(work, `${kind}-${card.name}`);
      const story = sheetStory(kind, card);
      await mkdir(dir, {recursive: true});
      await writeFile(path.join(dir, 'storyboard.json'), `${JSON.stringify(story, null, 2)}\n`);
      const file = path.join(out, `${rendererName}-${kind}-${card.name}.png`);
      if (rendererName === 'hyperframes') {
        const html = path.join(dir, 'hf');
        await compileStoryToHyperFrames(resolveStory(story), {projectDir: html, sourceDir: dir});
        await renderer.still(html, time, file);
      } else await renderer.still(dir, time, file);
      cells.push({label: `${kind} · ${card.name}`, file});
      process.stdout.write(`${kind} ${card.name}\n`);
    }
  } finally {
    await rm(work, {recursive: true, force: true});
  }
  const sheet = path.join(out, `${rendererName === 'hyperframes' ? 'sheet' : `sheet-${rendererName}`}.png`);
  await tile(cells, SHEET_CARDS.length, 640, sheet);
  process.stdout.write(`${sheet}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 2; });
}

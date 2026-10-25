#!/usr/bin/env node
// Background contact sheet (docs/KIT_CONTRACTS.md, "Backgrounds and panels").
//
//   node scripts/background-sheet.mjs [--out qa/background-sheet] [--time 5.5] [--project examples/story/minimal]
//
// Renders one HyperFrames still of the project for every background kind
// (kit/core/backgrounds.mjs BACKGROUND_KINDS), on a dark and a light palette,
// and tiles them into sheet.png: one row per palette, one column per kind,
// labelled when a system font is available. Each still keeps the project's
// content and captions, so the sheet shows text over every background. The
// logo pattern tiles a small sample mark (SHEET_LOGO).
//
// panels.png: panel fills (story.panel.fill): a split-layout panel
// (examples/story/layouts-wide) carrying an icon pattern and a linen texture,
// on both palettes. Card fills are in the parity fixtures (panel-fill-card-*).
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
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
export const SHEET_LOGO = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect x="6" y="6" width="52" height="52" rx="14" fill="#fdb022"/><path d="M20 44V20h8l8 14 8-14v24" fill="none" stroke="#06070d" stroke-width="6" stroke-linejoin="round"/></svg>\n';
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

// Stills tiled `columns` across, each scaled to `width`, labelled when a font exists.
async function tile(cells, columns, width, file) {
  const font = FONTS.find(entry => existsSync(entry));
  const filters = cells.map((cell, i) => {
    const label = font ? `,drawbox=x=0:y=ih-44:w=iw:h=44:color=black@0.6:t=fill,drawtext=fontfile=${font}:text='${cell.label}':x=12:y=h-32:fontsize=22:fontcolor=white` : '';
    return `[${i}:v]scale=${width}:-2${label}[c${i}]`;
  });
  const layout = cells.map((_, i) => `${(i % columns) === 0 ? '0' : Array.from({length: i % columns}, () => 'w0').join('+')}_${Math.floor(i / columns) === 0 ? '0' : Array.from({length: Math.floor(i / columns)}, () => 'h0').join('+')}`).join('|');
  await run('ffmpeg', ['-y', '-loglevel', 'error', ...cells.flatMap(cell => ['-i', cell.file]), '-filter_complex', `${filters.join(';')};${cells.map((_, i) => `[c${i}]`).join('')}xstack=inputs=${cells.length}:layout=${layout}[out]`, '-map', '[out]', '-frames:v', '1', file]);
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
  const panels = [];
  try {
    for (const [palette, colors] of Object.entries(SHEET_PALETTES)) {
      for (const kind of BACKGROUND_KINDS) {
        const story = {...loaded.resolved, brand: {...loaded.resolved.brand, colors: {...colors}}, background: {kind}, ...(kind === 'logo-pattern' ? {frame: {logo: 'assets/sheet-logo.svg', kicker: {logo: false, label: 'Logo pattern'}}} : {})};
        const dir = path.join(work, `${palette}-${kind}`);
        await compileStoryToHyperFrames(story, {projectDir: dir, sourceDir: project});
        await writeFile(path.join(dir, 'assets', 'sheet-logo.svg'), SHEET_LOGO);
        const file = path.join(out, `${palette}-${kind}.png`);
        await hyperframes.still(dir, time, file);
        cells.push({label: `${palette} ${kind}`, file});
        process.stdout.write(`${palette} ${kind}\n`);
      }
    }
    // Panel fills: a split-layout panel on both palettes.
    const layouts = path.join(ROOT, 'examples', 'story', 'layouts-wide');
    const wide = (await readProjectStory(layouts)).resolved;
    const fills = [
      ['icon pattern', {kind: 'icon-pattern', params: {icons: ['rocket', 'chart-up', 'users', 'sparkle', 'shield'], opacity: 0.08}}],
      ['linen texture', {kind: 'texture', params: {type: 'linen', amount: 0.8}}]
    ];
    for (const [palette, colors] of Object.entries(SHEET_PALETTES)) {
      for (const [name, fill] of fills) {
        const dir = path.join(work, `layout-${palette}-${fill.kind}`);
        await compileStoryToHyperFrames({...wide, brand: {...wide.brand, colors: {...colors}}, panel: {treatment: 'solid', fill}}, {projectDir: dir, sourceDir: layouts});
        const file = path.join(out, `layout-${palette}-${fill.kind}.png`);
        await hyperframes.still(dir, 3.5, file);
        panels.push({label: `split panel, ${palette}, ${name}`, file});
        process.stdout.write(`split panel ${palette} ${name}\n`);
      }
    }
  } finally {
    await rm(work, {recursive: true, force: true});
  }
  const sheet = path.join(out, 'sheet.png');
  await tile(cells, BACKGROUND_KINDS.length, 360, sheet);
  await tile(panels, 2, 960, path.join(out, 'panels.png'));
  process.stdout.write(`${sheet}\n${path.join(out, 'panels.png')}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 2; });
}

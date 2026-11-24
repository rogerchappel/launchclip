#!/usr/bin/env node
// Stills of worlds with a cast standing in them, for the void stage, the
// filled worlds and the depth pass (kit/core/worlds/void-stage.mjs,
// period.mjs, depth.mjs): one row per world, one column per time, each a
// cast scene drawing story.world itself, so the cast takes the world's grade
// (the void stage flips the classic stick figure's ink to white) and the
// edge occluders stay in front of the floor. Look at it by eye after
// changing a stage, a filled world or the depth pass.
//
//   node scripts/depth-sheet.mjs [--out qa/depth] [--kinds void-stage,city-street]
//     [--times day,dusk,night] [--style stick-classic] [--depth on|off|both]
//     [--portrait] [--set standing] [--chromium <path>]
//
// Writes <out>/<kind>[-depth][-portrait].png, one row of times per world.
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WORLD_TIMES} from '@launchclip/core/worlds/index.mjs';
import {sceneStill} from './racing-sheet.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BRAND = {colors: {bg: '#101218', primary: '#3d6fd8', accent: '#f0a531', ink: '#14161c', paper: '#f2eee6'}};

/** A one-scene story: two of the cast standing in a world the scene draws itself. */
export function depthStory(kind, time, {style = 'stick-classic', depth = false, portrait = false, set = 'standing'} = {}) {
  const format = portrait ? {width: 1080, height: 1920} : {width: 1920, height: 1080};
  const cast = [{id: 'maya', pose: 'point', expression: 'happy'}, {id: 'theo', expression: 'surprised'}];
  return {format: {...format, fps: 30, duration: 4}, brand: BRAND, cast: {style, characters: [{id: 'maya'}, {id: 'theo'}]},
    world: {kind, time, ...(depth ? {depth: true} : {})},
    // One scene id per world and time: gradient ids derive from it, and a sheet holds many stills on one page.
    scenes: [{id: `${kind}-${time}${depth ? '-depth' : ''}`, module: 'cast-scene', start: 0, end: 4, params: {set, shot: 'wide', cast}}]};
}

const page = body => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:12px;background:#1a1a1a;font:14px Helvetica,Arial,sans-serif;color:#ddd}.row{display:inline-flex;gap:12px}.st{position:relative;overflow:hidden;flex:none}figure{margin:0}figcaption{padding:4px 0 0;text-align:center}</style></head><body>${body}</body></html>`;

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
  const out = path.resolve(ROOT, flag('--out', 'qa/depth'));
  const kinds = flag('--kinds', 'void-stage,city-street,living-room,park').split(',').filter(Boolean);
  const times = flag('--times', WORLD_TIMES.join(',')).split(',').filter(Boolean);
  const style = flag('--style', 'stick-classic'), set = flag('--set', 'standing');
  const portrait = argv.includes('--portrait');
  const depths = {on: [true], off: [false], both: [false, true]}[flag('--depth', 'on')];
  const {findChromium, loadPlaywright} = await import('../src/demo/record.js');
  const chromium = await loadPlaywright();
  if (!chromium) throw new Error('depth-sheet needs Playwright (npm i playwright)');
  const executablePath = flag('--chromium', null) ?? (await findChromium());
  const browser = await chromium.launch(executablePath ? {executablePath} : {});
  await mkdir(out, {recursive: true});
  const k = portrait ? 0.3 : 0.4;
  try {
    for (const kind of kinds) for (const depth of depths) {
      const cells = times.map(time => `<figure>${sceneStill(depthStory(kind, time, {style, depth, portrait, set}), `${kind}-${time}${depth ? '-depth' : ''}`, 2, k)}<figcaption>${kind} ${time}${depth ? ' depth' : ''}</figcaption></figure>`);
      const tab = await browser.newPage({viewport: {width: 2600, height: 1400}, deviceScaleFactor: 1});
      await tab.setContent(page(`<div class="row">${cells.join('')}</div>`), {waitUntil: 'load'});
      const file = path.join(out, `${kind}${depth ? '-depth' : ''}${portrait ? '-portrait' : ''}.png`);
      await (await tab.$('.row')).screenshot({path: file});
      await tab.close();
      console.log(file);
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack ?? error.message); process.exit(1); });
}

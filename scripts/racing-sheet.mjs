#!/usr/bin/env node
// Stills of the racing worlds (kit/core/worlds/racing.mjs) with a foal and a
// mare standing in them, in landscape and portrait, and of the starting gate
// closed and then open: the same view trees and op list the cast-scene
// module renders, at a chosen time, in Chromium. Look at them by eye after
// changing a racing world, a story prop or the gate.
//
//   node scripts/racing-sheet.mjs [--out qa/racing] [--style chibi] [--time day|dusk|night] [--chromium <path>]
//
// Writes <out>/<world>-<aspect>.png (the world, then the gate closed and
// open in it) and <out>/props.png (every story prop).
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveModule} from '@launchclip/core/modules.mjs';
import {charactersTimeline, charactersView} from '@launchclip/core/catalog-characters.mjs';
import {frameState, propsToStyle, el} from '@launchclip/core/catalog-b-view.mjs';
import {RACING_WORLDS, STORY_PROP_IDS, PROP_STATES, drawProp} from '@launchclip/core/worlds/index.mjs';
import {renderNode} from '../kit/hyperframes/catalog-b.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BRAND = {colors: {bg: '#101218', primary: '#3d6fd8', accent: '#f0a531', ink: '#14161c', paper: '#f2eee6'}};
export const RACING_CAST = Object.freeze([
  {id: 'foal', name: 'Foal', position: 'left', kind: 'foal', size: 'small', marks: ['socks'], colors: {body: 'chestnut', detail: 'cream'}},
  {id: 'mare', name: 'Mare', position: 'right', kind: 'mare', size: 'large', marks: ['blaze'], colors: {body: 'grey', detail: 'charcoal'}}
]);
const FORMATS = {'16x9': {width: 1920, height: 1080}, '9x16': {width: 1080, height: 1920}};

const apply = (node, state) => {
  if (typeof node === 'string') return node;
  const props = node.id ? state.get(node.id) : null;
  return {...node, style: props ? {...(node.style ?? {}), ...propsToStyle(props)} : node.style, children: (node.children ?? []).map(child => apply(child, state))};
};

/** A two-scene story in one racing world: the world as it is, then the starting gate, which opens at 2s of its scene. */
export function racingStory(kind, format, {style = 'chibi', time = 'day'} = {}) {
  const cast = [{id: 'foal', pose: 'look', expression: 'happy'}, {id: 'mare', expression: 'happy'}];
  return {format: {...format, fps: 30, duration: 8}, brand: BRAND, cast: {style, characters: RACING_CAST}, world: {kind, time},
    scenes: [
      {id: 'plain', module: 'cast-scene', start: 0, end: 4, params: {set: 'standing', shot: 'wide', cast}},
      {id: 'gate', module: 'cast-scene', start: 4, end: 8, params: {set: 'standing', shot: 'wide', cast, props: [{id: 'starting-gate', cues: [{at: 2, state: 'open'}]}]}}
    ]};
}

/** One scene of a story at time t (absolute seconds), as HTML at scale k. */
export function sceneStill(story, sceneId, t, k) {
  const scene = story.scenes.find(entry => entry.id === sceneId);
  const model = resolveModule(scene, story);
  const view = charactersView(model);
  const state = frameState(charactersTimeline(model), t);
  const {width, height} = story.format;
  return `<div class="st" style="width:${Math.round(width * k)}px;height:${Math.round(height * k)}px"><div style="position:absolute;left:0;top:0;width:${width}px;height:${height}px;transform:scale(${k});transform-origin:0 0">${renderNode(apply(view.front, state))}</div></div>`;
}

function propsHtml(style) {
  const CELL = 260, ids = STORY_PROP_IDS.flatMap(id => (PROP_STATES[id] ?? [undefined]).map(state => ({id, state})));
  const width = CELL * 6, height = CELL * Math.ceil(ids.length / 6);
  const nodes = [], defs = [], labels = [];
  ids.forEach(({id, state}, i) => {
    const box = {x: (i % 6) * CELL, y: Math.floor(i / 6) * CELL, width: CELL, height: CELL - 26};
    const drawn = drawProp({id, colors: BRAND.colors, style, box, key: `p${i}`, state});
    nodes.push(...drawn.nodes); defs.push(...drawn.defs);
    labels.push(`<div style="position:absolute;left:${box.x}px;top:${box.y + CELL - 22}px;width:${CELL}px;text-align:center">${id}${state ? ` (${state})` : ''}</div>`);
  });
  return `<div class="st" style="width:${width}px;height:${height}px;background:#e9efe2">${renderNode(el('svg', null, {position: 'absolute', left: 0, top: 0, overflow: 'visible'}, [el('defs', null, null, defs), ...nodes], {width, height, viewBox: `0 0 ${width} ${height}`, fill: 'none'}))}${labels.join('')}</div>`;
}

const page = body => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:12px;background:#ece7dd;font:14px Helvetica,Arial,sans-serif;color:#231e28}.row{display:inline-flex;gap:12px}.st{position:relative;overflow:hidden;flex:none}figure{margin:0}figcaption{padding:4px 0 0;text-align:center}</style></head><body>${body}</body></html>`;

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
  const out = path.resolve(ROOT, flag('--out', 'qa/racing'));
  const style = flag('--style', 'chibi'), time = flag('--time', 'day');
  const {findChromium, loadPlaywright} = await import('../src/demo/record.js');
  const chromium = await loadPlaywright();
  if (!chromium) throw new Error('racing-sheet needs Playwright (npm i playwright)');
  const executablePath = flag('--chromium', null) ?? (await findChromium());
  const browser = await chromium.launch(executablePath ? {executablePath} : {});
  await mkdir(out, {recursive: true});
  try {
    const shoot = async (html, file) => {
      const tab = await browser.newPage({viewport: {width: 3200, height: 1400}, deviceScaleFactor: 1});
      await tab.setContent(html, {waitUntil: 'load'});
      await (await tab.$('.row')).screenshot({path: file});
      await tab.close();
      console.log(file);
    };
    for (const kind of RACING_WORLDS) for (const [aspect, format] of Object.entries(FORMATS)) {
      const story = racingStory(kind, format, {style, time});
      const k = aspect === "16x9" ? 0.34 : 0.4;
      const cells = [['plain', 2, kind], ['gate', 5, 'gate closed'], ['gate', 7, 'gate open']].map(([id, t, caption]) => `<figure>${sceneStill(story, id, t, k)}<figcaption>${caption}</figcaption></figure>`);
      await shoot(page(`<div class="row">${cells.join('')}</div>`), path.join(out, `${kind}-${aspect}.png`));
    }
    await shoot(page(`<div class="row">${propsHtml(style)}</div>`), path.join(out, 'props.png'));
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack ?? error.message); process.exit(1); });
}

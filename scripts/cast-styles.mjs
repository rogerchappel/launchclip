#!/usr/bin/env node
// Cast sheets for every drawing style (docs/SEEDED_STYLES_RFC.md §3.5):
// one PNG per style with a line-up of a cast in poses, face close-ups in
// several expressions, and the cast acting in a few sets, drawn with the
// same view trees and op list the modules render (frame-pure state at a
// chosen time), in Chromium.
//
//   node scripts/cast-styles.mjs [--out qa/cast-styles] [--styles flat,lifelike]
//     [--sets phone,sofa,kitchen-counter] [--seed 7f3a91c2] [--set office-team]
//     [--ids maya,theo,...] [--chromium <path>]
//
// Without --ids the cast is a mix of starter characters and a generated
// cast (generateCast with the seed and character set), so the sheet shows
// the rig's range. Writes <out>/<style>.png and <out>/index.json.
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DRAWING_STYLES, drawCharacter, styleGeometry, styleHeight} from '../kit/core/characters/styles.mjs';
import {sceneJoints} from '../kit/core/characters/acting.mjs';
import {characterView} from '../kit/core/characters/view.mjs';
import {castMember, resolveStoryCast} from '../kit/core/characters/cues.mjs';
import {generateCast} from '../kit/core/characters/generate.mjs';
import {resolveModule} from '../kit/core/modules.mjs';
import {charactersTimeline, charactersView} from '../kit/core/catalog-characters.mjs';
import {frameState, propsToStyle} from '../kit/core/catalog-b-view.mjs';
import {renderNode} from '../kit/hyperframes/catalog-b.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BRAND = {colors: {bg: '#101218', primary: '#3d6fd8', accent: '#f0a531', ink: '#14161c', paper: '#f2eee6'}};
const POSES = ['stand', 'wave', 'point', 'cheer', 'think', 'shrug', 'stand', 'wave'];
const EXPRESSIONS = ['happy', 'delighted', 'surprised', 'focused', 'confused', 'frustrated'];
const DEFAULT_SETS = ['phone', 'sofa', 'kitchen-counter', 'video-call'];

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
  return out;
}

/** The sheet's cast: starters across the range plus a generated cast. */
export function sheetCast({ids, seed = '7f3a91c2', set = 'office-team'} = {}) {
  if (ids) return ids.map(id => ({id}));
  const starters = ['maya', 'oliver', 'fatima', 'ruth', 'lily'].map(id => ({id}));
  return [...starters, ...generateCast({seed, set, count: 3, palette: BRAND.colors})];
}

const apply = (node, state) => {
  if (typeof node === 'string') return node;
  const props = node.id ? state.get(node.id) : null;
  return {...node, style: props ? {...(node.style ?? {}), ...propsToStyle(props)} : node.style, children: (node.children ?? []).map(child => apply(child, state))};
};

function figure(stage, caption, width, height) {
  return `<figure><div class="st" style="width:${width}px;height:${height}px">${stage}</div><figcaption>${caption}</figcaption></figure>`;
}

/** One style's sheet as HTML: line-up, faces, scenes. */
export function styleSheetHtml(style, cast, {sets = DEFAULT_SETS} = {}) {
  const story = {format: {width: 1920, height: 1080, fps: 30, duration: 4}, brand: BRAND, cast: {style, characters: cast}};
  const resolved = resolveStoryCast(story);
  const members = cast.map(entry => castMember(resolved, entry.id));
  let n = 0;
  const lineup = members.map((member, i) => {
    const geometry = styleGeometry(style, member.params);
    const pose = POSES[i % POSES.length];
    const joints = sceneJoints(pose, {facing: 'right', geometry, params: member.params});
    const drawing = drawCharacter(style, member.params, member.colors, {id: `l${n++}`, joints, expression: 'happy', expressions: ['happy'], static: true});
    const scale = 360 / Math.max(1150, styleHeight(style, member.params));
    return figure(renderNode(characterView(drawing, {id: `lv${n}`, x: 110, y: 400, scale})), `${member.name} · ${pose}`, 220, 420);
  }).join('');
  const faces = members.slice(0, 6).map((member, i) => {
    const geometry = styleGeometry(style, member.params);
    const expression = EXPRESSIONS[i % EXPRESSIONS.length];
    const joints = sceneJoints('stand', {facing: 'right', geometry, params: member.params});
    const drawing = drawCharacter(style, member.params, member.colors, {id: `f${n++}`, joints, expression, expressions: [expression], static: true});
    const scale = 75 / geometry.head.ry;
    const headY = geometry.hipY - geometry.torso - geometry.neck * 0.6 + geometry.head.cy;
    return figure(renderNode(characterView(drawing, {id: `fv${n}`, x: 110, y: 112 - headY * scale, scale})), expression, 220, 220);
  }).join('');
  const scenes = sets.map((set, k) => {
    const ids = members.slice(k % 3, (k % 3) + (set === 'podium' ? 2 : 3)).map(member => member.id);
    const scene = {id: `s${k}`, module: 'cast-scene', start: 0, end: 4, params: {set, cast: ids.map((id, i) => ({id, expression: 'happy', ...(i === 0 ? {cues: [{at: 0.5, pose: set === 'video-call' || set === 'sofa' ? 'wave' : 'point'}]} : {})}))}};
    const model = resolveModule(scene, story);
    const view = charactersView(model);
    const state = frameState(charactersTimeline(model), 2);
    const k2 = 0.36;
    const stage = `<div style="position:absolute;left:0;top:0;width:1920px;height:1080px;transform:scale(${k2});transform-origin:0 0">${renderNode(apply(view.front, state))}${view.overlay ? renderNode(apply(view.overlay, state)) : ''}</div>`;
    return figure(stage, set, Math.round(1920 * k2), Math.round(1080 * k2));
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${style}</title><style>
body{margin:0;padding:24px 28px;background:#ece7dd;font-family:Helvetica,Arial,sans-serif;color:#231e28}
h1{font-size:30px;margin:0 0 6px}p{margin:0 0 16px;opacity:.7}h2{font-size:18px;margin:18px 0 8px}
.row{display:flex;flex-wrap:wrap;gap:10px}figure{margin:0;background:#f8f5ef;border-radius:12px;overflow:hidden}
.st{position:relative;overflow:hidden}figcaption{font-size:13px;text-align:center;padding:5px 0 7px;opacity:.75}
</style></head><body><h1>Drawing style: ${style}</h1><p>The same cast, rig, poses and expressions as every other style.</p>
<h2>Line-up</h2><div class="row">${lineup}</div><h2>Faces</h2><div class="row">${faces}</div><h2>Sets</h2><div class="row">${scenes}</div></body></html>`;
}

async function main() {
  const flags = args(process.argv.slice(2));
  const out = path.resolve(ROOT, flags.out ?? 'qa/cast-styles');
  const styles = flags.styles ? String(flags.styles).split(',') : DRAWING_STYLES;
  const sets = flags.sets ? String(flags.sets).split(',') : DEFAULT_SETS;
  const cast = sheetCast({ids: flags.ids ? String(flags.ids).split(',') : null, seed: flags.seed ?? '7f3a91c2', set: flags.set ?? 'office-team'});
  const {findChromium, loadPlaywright} = await import('../src/demo/record.js');
  const chromium = await loadPlaywright();
  if (!chromium) throw new Error('cast-styles needs Playwright (npm i playwright)');
  const executablePath = flags.chromium ?? (await findChromium());
  const browser = await chromium.launch(executablePath ? {executablePath} : {});
  await mkdir(out, {recursive: true});
  const written = [];
  try {
    for (const style of styles) {
      const page = await browser.newPage({viewport: {width: 1980, height: 900}, deviceScaleFactor: 1});
      await page.setContent(styleSheetHtml(style, cast, {sets}), {waitUntil: 'load'});
      const file = path.join(out, `${style}.png`);
      await page.screenshot({path: file, fullPage: true});
      await page.close();
      written.push({style, png: path.relative(ROOT, file)});
      console.log(file);
    }
  } finally {
    await browser.close();
  }
  await writeFile(path.join(out, 'index.json'), `${JSON.stringify({schema: 'launchclip.cast-styles.v1', cast: cast.map(entry => entry.id), sets, sheets: written}, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exit(1); });
}

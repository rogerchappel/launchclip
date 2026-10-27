#!/usr/bin/env node
// Contact sheet for the element library (kit/core/catalog-h.mjs): every
// variant of every module, drawn from the sample params
// (scripts/element-samples.mjs), one row per module, written as a PNG.
//
// Each tile is the module's frame-pure state (the view tree plus frameState,
// exactly what the Remotion components draw) at a chosen time: "settled"
// (just before the exit, the default), "build" (mid-build) or seconds from
// the scene start. With --parity <dir>, the tiles are instead the
// HyperFrames stills of a parity run (scripts/parity.mjs reports under
// <dir>/<fixture>/), labelled with their SSIM.
//
//   node scripts/element-sheet.mjs [--modules bar-chart,pie-chart]
//     [--aspects 9:16,16:9] [--at settled|build|2.4] [--out qa/elements/sheet.png]
//     [--parity qa/parity --prefix h-] [--sample mid-hold] [--tile 420]
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {MODULES, VARIANTS, catalogHStyle, catalogHTimeline, catalogHView} from '../kit/core/catalog-h.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
import {renderNode} from '../kit/hyperframes/catalog-b.mjs';
import {copyProjectFonts, projectFontFaces} from '../kit/hyperframes/story-compiler.mjs';
import {SAMPLES} from './element-samples.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const BRAND = Object.freeze({colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}});
export const FORMATS = Object.freeze({'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}});
export const SCENE = 4;

function args(argv) {
  const out = {modules: null, aspects: ['9:16', '16:9'], at: 'settled', out: path.join(ROOT, 'qa', 'elements', 'sheet.png'), parity: null, prefix: 'h-', tile: 420, sample: 'mid-hold'};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--modules') out.modules = argv[++i].split(',');
    else if (a === '--aspects') out.aspects = argv[++i].split(',');
    else if (a === '--at') out.at = argv[++i];
    else if (a === '--out') out.out = path.resolve(argv[++i]);
    else if (a === '--parity') out.parity = path.resolve(argv[++i]);
    else if (a === '--prefix') out.prefix = argv[++i];
    else if (a === '--tile') out.tile = Number(argv[++i]);
    else if (a === '--sample') out.sample = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

/** The resolved model of one module variant at one aspect. */
export function sampleModel(id, variant, aspect, {params = SAMPLES[id], duration = SCENE, sceneId = 's1'} = {}) {
  return {...MODULES[id].resolve({...params, variant}, {id: sceneId, start: 0, duration, format: FORMATS[aspect], brand: BRAND, aspect, hits: []}), module: id};
}

function timeFor(model, at) {
  if (at === 'settled') return model.motion.exitStart - 0.05;
  if (at === 'build') return (model.content.buildAt ?? model.motion.enterEnd) + 0.5;
  return Number(at);
}

/** The view tree with the frame state at t applied (Remotion's rendering). */
function stateTree(node, state) {
  if (typeof node === 'string') return node;
  const props = node.id ? state.get(node.id) : undefined;
  const style = props ? {...(node.style ?? {}), ...catalogHStyle(props)} : node.style;
  const children = props && props.text !== undefined ? [String(props.text)] : node.children ?? [];
  return {...node, ...(style ? {style} : {}), children: children.map(child => stateTree(child, state))};
}

async function screenshot(html, file, viewport) {
  const {chromium} = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport});
    await page.goto(pathToFileURL(html).href);
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.screenshot({path: file, fullPage: true});
  } finally { await browser.close(); }
}

const escape = value => String(value).replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));

async function main(argv) {
  const opts = args(argv);
  const TILE_H = opts.tile;
  const ids = opts.modules ?? Object.keys(MODULES);
  const work = await mkdtemp(path.join(os.tmpdir(), 'launchclip-elements-'));
  try {
    const rows = [];
    let maxWidth = 0;
    for (const id of ids) {
      if (!MODULES[id]) throw new Error(`unknown catalogue H module ${id}`);
      const tiles = [];
      for (const variant of VARIANTS[id]) for (const aspect of opts.aspects) {
        const {width, height} = FORMATS[aspect];
        const scale = TILE_H / height;
        const name = `${variant} · ${aspect}`;
        if (opts.parity) {
          const dir = path.join(opts.parity, `${opts.prefix}${id}-${variant}-${aspect === '9:16' ? 'portrait' : 'landscape'}`);
          let report = null;
          try { report = JSON.parse(await readFile(path.join(dir, 'report.json'), 'utf8')); } catch { /* not rendered */ }
          // Only variants the run rendered (every variant in portrait, the default in landscape).
          if (!report) continue;
          const still = report.samples.find(s => s.name === opts.sample) ?? report.samples.find(s => s.name === 'mid-hold') ?? report.samples.at(-2);
          tiles.push({name: `${name} · ssim ${report.minSsim.toFixed(3)}`, width: width * scale, html: `<img src="${pathToFileURL(path.join(dir, still.hyperframes)).href}" style="width:${width * scale}px;height:${TILE_H}px">`});
          continue;
        }
        let body;
        try {
          // A scene id per tile, so ids (and the masks they name) never repeat in one page.
          const model = sampleModel(id, variant, aspect, {sceneId: `s${tiles.length + 1}`});
          const state = frameState(catalogHTimeline(model), timeFor(model, opts.at));
          body = renderNode(stateTree(catalogHView(model), state));
        } catch (error) { body = `<div style="color:#ff6b6b;padding:40px;font:28px monospace;white-space:normal">${escape(error.message)}</div>`; }
        tiles.push({name, width: width * scale, html: `<div style="position:relative;width:${width}px;height:${height}px;transform:scale(${scale});transform-origin:0 0;background:${BRAND.colors.bg};overflow:hidden">${body}</div>`});
      }
      const rowWidth = tiles.reduce((sum, tile) => sum + tile.width + 16, 16);
      maxWidth = Math.max(maxWidth, rowWidth);
      rows.push(`<section><h2>${escape(id)}</h2><div class="row">${tiles.map(tile => `<figure style="width:${tile.width}px"><div class="tile" style="width:${tile.width}px">${tile.html}</div><figcaption>${escape(tile.name)}</figcaption></figure>`).join('')}</div></section>`);
    }
    const fonts = await projectFontFaces(BRAND, {sourceDir: work});
    await copyProjectFonts(fonts.copies, work);
    const html = `<!doctype html><meta charset="utf-8"><style>${fonts.css}
body{margin:0;padding:16px;background:#14151c;color:#f2eee6;font:18px/1.3 ui-monospace,Menlo,monospace;width:${Math.ceil(maxWidth)}px}
h2{margin:18px 0 8px;font-size:22px} .row{display:flex;gap:16px;align-items:flex-start}
figure{margin:0} .tile{height:${TILE_H}px;overflow:hidden;border-radius:8px;background:${BRAND.colors.bg}} figcaption{opacity:.7;margin-top:6px}
svg{display:block}</style><body>${rows.join('')}</body>`;
    const file = path.join(work, 'sheet.html');
    await writeFile(file, html);
    await mkdir(path.dirname(opts.out), {recursive: true});
    await screenshot(file, opts.out, {width: Math.ceil(maxWidth) + 32, height: 800});
    process.stdout.write(`${ids.length} modules → ${opts.out}\n`);
  } finally {
    await rm(work, {recursive: true, force: true});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
}

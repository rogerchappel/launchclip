#!/usr/bin/env node
// Contact sheet for the worlds (kit/core/worlds/): every world at day, dusk
// and night, one row per world, plus one full-size PNG per still. Look at it
// by eye after adding or changing a world or a prop.
//
//   node scripts/world-sheet.mjs [--out qa/worlds] [--kinds office,kitchen]
//     [--times day,dusk,night] [--portrait] [--style flat] [--detail rich]
//     [--props laptop,mug,plant] [--scrim] [--thumb 480]
//
// Writes <out>/<kind>-<time>.png and <out>/sheet.png (and sheet-<n>.png
// pages when there are many worlds). With --scrim each still shows the
// world's quiet area and its text scrim, with a sample title on it.

import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {WORLD_KINDS, WORLD_TIMES, renderWorld} from '@launchclip/core/worlds/index.mjs';
import {worldLayerNodes} from '@launchclip/core/worlds/view.mjs';
import {scrimFor} from '@launchclip/core/worlds/readable.mjs';
import {renderNode} from '../kit/hyperframes/catalog-b.mjs';
import {luminance} from '@launchclip/core/catalog-b-base.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const has = name => args.includes(name);
const out = resolve(flag('--out', 'qa/worlds'));
const kinds = flag('--kinds', WORLD_KINDS.join(',')).split(',').filter(Boolean);
const times = flag('--times', WORLD_TIMES.join(',')).split(',').filter(Boolean);
const portrait = has('--portrait');
const style = flag('--style', null);
const detail = flag('--detail', null);
const props = flag('--props', '').split(',').filter(Boolean);
const thumb = Number(flag('--thumb', portrait ? 300 : 480));
const showScrim = has('--scrim');
const brand = JSON.parse(flag('--brand', '{"bg":"#06070d","primary":"#fdb022","accent":"#46d4ff","ink":"#06070d","paper":"#f2eee6"}'));
const canvas = portrait ? {width: 1080, height: 1920} : {width: 1920, height: 1080};

const page = body => `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}body{position:relative;width:${canvas.width}px;height:${canvas.height}px;overflow:hidden}</style><body>${body}</body>`;

/**
 * The text contrast actually rendered under the quiet area: the brand text
 * colour against the 2nd-percentile-worst pixel (the brightest for light
 * text, the darkest for dark text).
 */
async function measuredContrast(png, rect, text) {
  const {data, info} = await sharp(png).extract({left: rect.x, top: rect.y, width: rect.width, height: rect.height}).raw().toBuffer({resolveWithObject: true});
  const lums = [];
  for (let i = 0; i < data.length; i += info.channels * 3) {
    const lin = c => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    lums.push(0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]));
  }
  lums.sort((a, b) => a - b);
  const t = luminance(text);
  const worst = t > 0.5 ? lums[Math.floor(lums.length * 0.98)] : lums[Math.floor(lums.length * 0.02)];
  return Math.round(((Math.max(t, worst) + 0.05) / (Math.min(t, worst) + 0.05)) * 100) / 100;
}

function stillHtml(kind, time, {label = true} = {}) {
  const world = renderWorld({id: 'w', kind, time, colors: brand, canvas, style, detail, props});
  let body = worldLayerNodes(world, 'w').map(node => renderNode(node)).join('');
  if (showScrim) {
    const scrim = scrimFor(world, {text: brand.paper, bg: brand.bg});
    const q = world.quiet;
    body += `<div style="position:absolute;left:0;top:0;width:${canvas.width}px;height:${canvas.height}px;background:${scrim.css}"></div>`;
    if (label) body += `<div style="position:absolute;left:${q.x}px;top:${q.y}px;width:${q.width}px;height:${q.height}px;outline:3px dashed #ff3b6b88;display:flex;align-items:center;justify-content:center;font:700 ${Math.round(canvas.width / 26)}px system-ui;color:${brand.paper}">Text sits here</div>`;
  }
  return page(body);
}

async function main() {
  await mkdir(out, {recursive: true});
  const browser = await chromium.launch();
  const ctx = await browser.newContext({viewport: canvas, deviceScaleFactor: 1});
  const tab = await ctx.newPage();
  const cells = [];
  for (const kind of kinds) {
    for (const time of times) {
      const file = join(out, `${kind}-${time}${portrait ? '-portrait' : ''}.png`);
      const cell = {kind, time, file};
      if (showScrim) {
        await tab.setContent(stillHtml(kind, time, {label: false}), {waitUntil: 'load'});
        const world = renderWorld({id: 'w', kind, time, colors: brand, canvas, style, detail, props});
        cell.contrast = await measuredContrast(await tab.screenshot(), world.quiet, brand.paper);
      }
      await tab.setContent(stillHtml(kind, time), {waitUntil: 'load'});
      await tab.screenshot({path: file});
      cells.push(cell);
    }
  }
  // The sheet: one row per world, one column per time, labelled.
  const perPage = portrait ? 6 : 8;
  const tw = thumb, th = Math.round(thumb * canvas.height / canvas.width);
  const pages = [];
  for (let i = 0; i < kinds.length; i += perPage) pages.push(kinds.slice(i, i + perPage));
  for (const [n, group] of pages.entries()) {
    const rows = [];
    for (const kind of group) {
      const figures = [];
      for (const time of times) {
        const cell = cells.find(c => c.kind === kind && c.time === time);
        const data = (await readFile(cell.file)).toString('base64');
        figures.push(`<figure><img src="data:image/png;base64,${data}" width="${tw}" height="${th}"><figcaption>${time}</figcaption></figure>`);
      }
      rows.push(`<div class="row"><div class="label">${kind}</div>${figures.join('')}</div>`);
    }
    const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:16px;background:#111;color:#ddd;font:14px/1.2 ui-monospace,Menlo,monospace;width:max-content}
.row{display:flex;gap:10px;align-items:center;margin-bottom:10px}.label{width:120px}figure{margin:0;position:relative}figcaption{position:absolute;left:6px;top:4px;background:#000a;padding:2px 6px;border-radius:4px}img{display:block;border-radius:4px}</style>${rows.join('')}`;
    const sheet = await ctx.newPage();
    await sheet.setViewportSize({width: 160 + times.length * (tw + 10) + 32, height: 400});
    await sheet.setContent(html, {waitUntil: 'load'});
    const name = pages.length === 1 ? 'sheet' : `sheet-${n + 1}`;
    await sheet.screenshot({path: join(out, `${name}${portrait ? '-portrait' : ''}.png`), fullPage: true});
    await sheet.close();
  }
  await browser.close();
  await writeFile(join(out, 'index.json'), JSON.stringify({canvas, style, detail, props, cells: cells.map(c => ({...c, file: c.file.slice(out.length + 1)}))}, null, 2));
  if (showScrim) {
    const low = cells.filter(c => c.contrast < 4.5);
    for (const c of cells) console.log(`${c.contrast >= 4.5 ? 'ok  ' : 'LOW '} ${c.kind} ${c.time}: text ${c.contrast}:1 under the scrim`);
    if (low.length) process.exitCode = 1;
  }
  console.log(`world sheet: ${cells.length} stills → ${out}`);
}

main().catch(error => { console.error(error); process.exit(1); });

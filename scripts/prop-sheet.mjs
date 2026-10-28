#!/usr/bin/env node
// Contact sheet for the world props (kit/core/worlds/props.mjs): every prop
// at simple, standard and rich detail, by day and by night. Look at it by
// eye after adding or changing a prop.
//
//   node scripts/prop-sheet.mjs [out.png] [--styles line,flat,lifelike] [--times day,night]

import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {PROP_IDS, drawProp} from '@launchclip/core/worlds/index.mjs';
import {el} from '@launchclip/core/catalog-b-view.mjs';
import {renderNode} from '../kit/hyperframes/catalog-b.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const styles = flag('--styles', 'line,flat,lifelike').split(',');
const times = flag('--times', 'day,night').split(',');
const out = resolve(args[0] ?? 'prop-sheet.png');
const brand = {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'};
const CELL = 150, COLS = 16;
const rows = Math.ceil(PROP_IDS.length / COLS);
const band = rows * CELL + 30;
const width = COLS * CELL, height = band * styles.length * times.length;

const parts = [];
let n = 0;
for (const time of times) for (const style of styles) {
  const top = n++ * band;
  const bg = time === 'night' ? '#1b2238' : '#ece6da';
  parts.push(`<div style="position:absolute;left:0;top:${top}px;width:${width}px;height:${band}px;background:${bg}"></div><div class="h" style="top:${top + 4}px;color:${time === 'night' ? '#ddd' : '#333'}">${style} · ${time}</div>`);
  const nodes = [], defs = [];
  PROP_IDS.forEach((id, i) => {
    const box = {x: (i % COLS) * CELL, y: top + 26 + Math.floor(i / COLS) * CELL, width: CELL, height: CELL - 18};
    const drawn = drawProp({id, time, colors: brand, style, box, key: `p${n}-${i}`});
    nodes.push(...drawn.nodes); defs.push(...drawn.defs);
    parts.push(`<div class="n" style="left:${box.x}px;top:${box.y + CELL - 20}px;color:${time === 'night' ? '#bbb' : '#555'}">${id}</div>`);
  });
  parts.push(renderNode(el('svg', null, {position: 'absolute', left: 0, top: 0, overflow: 'visible'}, [el('defs', null, null, defs), ...nodes], {width, height, viewBox: `0 0 ${width} ${height}`, fill: 'none'})));
}
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;position:relative;width:${width}px;height:${height}px;font:12px/1 ui-monospace,Menlo,monospace}.h{position:absolute;left:8px;font-weight:700}.n{position:absolute;width:${CELL}px;text-align:center}</style><body>${parts.join('')}</body>`;
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width, height}});
await page.setContent(html, {waitUntil: 'load'});
await page.screenshot({path: out});
await browser.close();
console.log(`prop sheet: ${PROP_IDS.length} props → ${out}`);

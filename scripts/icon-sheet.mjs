#!/usr/bin/env node
// Contact sheet for the icon set (kit/core/icons.mjs): every icon at 96 px
// with its name, plus a row of each at 24 px, written as a PNG (or HTML with
// --html). Look at it by eye after adding or changing an icon.
//
//   node scripts/icon-sheet.mjs [out.png] [--html] [--color '#fdb022'] [--bg '#06070d']

import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ICON_NAMES, iconNode} from '../kit/core/icons.mjs';
import {renderNode} from '../kit/hyperframes/catalog-b.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const asHtml = args.includes('--html') && Boolean(args.splice(args.indexOf('--html'), 1));
const color = flag('--color', '#f2eee6');
const bg = flag('--bg', '#06070d');
const out = resolve(args[0] ?? (asHtml ? 'icon-sheet.html' : 'icon-sheet.png'));

const COLS = 12, CELL = 150, ICON = 96;
const rows = Math.ceil(ICON_NAMES.length / COLS);
const width = COLS * CELL, small = Math.ceil(ICON_NAMES.length / 48) * 40 + 40;
const height = rows * CELL + small;

const cells = ICON_NAMES.map((name, i) => {
  const x = (i % COLS) * CELL, y = Math.floor(i / COLS) * CELL;
  return `<div class="cell" style="left:${x}px;top:${y}px">${renderNode(iconNode(name, {x: (CELL - ICON) / 2, y: 14, size: ICON, color}))}<div class="name">${name}</div></div>`;
}).join('');
const tiny = ICON_NAMES.map((name, i) => renderNode(iconNode(name, {x: 20 + (i % 48) * 37, y: rows * CELL + 20 + Math.floor(i / 48) * 40, size: 24, color}))).join('');

const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:${bg};width:${width}px;height:${height}px;position:relative;font:14px/1.2 ui-monospace,Menlo,monospace;color:${color}}
.cell{position:absolute;width:${CELL}px;height:${CELL}px;box-sizing:border-box;border:1px solid #ffffff14}
.name{position:absolute;left:0;right:0;bottom:12px;text-align:center;opacity:.7}
svg{display:block}
</style><body>${cells}${tiny}</body>`;

if (asHtml) {
  await writeFile(out, html);
} else {
  const {chromium} = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width, height}});
  await page.setContent(html);
  await page.screenshot({path: out, fullPage: true});
  await browser.close();
}
console.log(`${ICON_NAMES.length} icons → ${out}`);

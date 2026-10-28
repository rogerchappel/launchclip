#!/usr/bin/env node
// Contact sheet for the icon set (kit/core/icons.mjs): every icon with its
// name, plus a row of each at 24 px, written as a PNG (or HTML with --html).
// Look at it by eye after adding or changing an icon.
//
//   node scripts/icon-sheet.mjs [out.png] [--html] [--color '#fdb022'] [--bg '#06070d']
//     [--mode stroke|duotone] [--source launchclip|lucide] [--cols 12] [--cell 150]

import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ICON_NAMES, ICON_SOURCES, iconNode} from '@launchclip/core/icons.mjs';
import {renderNode} from '../kit/hyperframes/catalog-b.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const asHtml = args.includes('--html') && Boolean(args.splice(args.indexOf('--html'), 1));
const color = flag('--color', '#f2eee6');
const bg = flag('--bg', '#06070d');
const mode = flag('--mode', 'stroke');
const source = flag('--source', null);
const COLS = Number(flag('--cols', 12)), CELL = Number(flag('--cell', 150)), ICON = Math.round(CELL * 0.64);
const out = resolve(args[0] ?? (asHtml ? 'icon-sheet.html' : 'icon-sheet.png'));
const names = ICON_NAMES.filter(name => !source || ICON_SOURCES[name] === source);

const rows = Math.ceil(names.length / COLS);
const perRow = Math.max(1, Math.floor((COLS * CELL - 40) / 37));
const width = COLS * CELL, small = Math.ceil(names.length / perRow) * 40 + 40;
const height = rows * CELL + small;

const cells = names.map((name, i) => {
  const x = (i % COLS) * CELL, y = Math.floor(i / COLS) * CELL;
  return `<div class="cell" style="left:${x}px;top:${y}px">${renderNode(iconNode(name, {x: (CELL - ICON) / 2, y: CELL * 0.09, size: ICON, color, mode}))}<div class="name">${name}</div></div>`;
}).join('');
const tiny = names.map((name, i) => renderNode(iconNode(name, {x: 20 + (i % perRow) * 37, y: rows * CELL + 20 + Math.floor(i / perRow) * 40, size: 24, color, mode}))).join('');

const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:${bg};width:${width}px;height:${height}px;position:relative;font:14px/1.2 ui-monospace,Menlo,monospace;color:${color}}
.cell{position:absolute;width:${CELL}px;height:${CELL}px;box-sizing:border-box;border:1px solid #ffffff14}
.name{position:absolute;left:0;right:0;bottom:8%;text-align:center;opacity:.7;font-size:${Math.max(9, Math.round(CELL / 11))}px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
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
console.log(`${names.length} icons → ${out}`);

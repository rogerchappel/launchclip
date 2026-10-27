#!/usr/bin/env node
// Contact sheet for the social cards (kit/core/catalog-i-social.mjs): each
// module's demo samples (scripts/element-samples.mjs) at chosen times, over a
// soft blurred backdrop like the one a story puts behind glass panels, so the
// glass look reads as it will in a video. Tiles are the frame-pure state
// (the view tree plus frameState: what the Remotion components draw).
//
//   node scripts/social-sheet.mjs [--out qa/social/sheet.png] [--tile 420]
import {cp, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {catalogHStyle, catalogHTimeline, catalogHView} from '../kit/core/catalog-h.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
import {renderNode} from '../kit/hyperframes/catalog-b.mjs';
import {copyProjectFonts, projectFontFaces} from '../kit/hyperframes/story-compiler.mjs';
import {BRAND, FORMATS, sampleModel} from './element-sheet.mjs';
import {SAMPLES, SOCIAL_SAMPLES} from './element-samples.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Sample media (demo images) live with the parity fixtures.
const ASSETS = path.join(ROOT, 'test', 'fixtures', 'parity', 'assets');

function args(argv) {
  const out = {out: path.join(ROOT, 'qa', 'social', 'sheet.png'), tile: 420};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out.out = path.resolve(argv[++i]);
    else if (argv[i] === '--tile') out.tile = Number(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return out;
}

function stateTree(node, state) {
  if (typeof node === 'string') return node;
  const props = node.id ? state.get(node.id) : undefined;
  const style = props ? {...(node.style ?? {}), ...catalogHStyle(props)} : node.style;
  const children = props && props.text !== undefined ? [String(props.text)] : node.children ?? [];
  return {...node, ...(style ? {style} : {}), children: children.map(child => stateTree(child, state))};
}

/** A soft backdrop: brand-tinted blurred shapes on the background colour. */
export function backdrop({width, height}, colors = BRAND.colors) {
  const m = Math.min(width, height);
  return `<div style="position:absolute;inset:0;background:${colors.bg};overflow:hidden">
<div style="position:absolute;left:${-0.2 * width}px;top:${0.1 * height}px;width:${1.1 * m}px;height:${0.9 * m}px;border-radius:50%;background:${colors.accent};opacity:.18;filter:blur(${0.16 * m}px)"></div>
<div style="position:absolute;left:${0.55 * width}px;top:${0.45 * height}px;width:${0.9 * m}px;height:${0.8 * m}px;border-radius:50%;background:#8fa3b8;opacity:.16;filter:blur(${0.14 * m}px)"></div>
<div style="position:absolute;left:${0.25 * width}px;top:${-0.25 * height}px;width:${0.8 * m}px;height:${0.6 * m}px;border-radius:50%;background:#dfe7ee;opacity:.08;filter:blur(${0.12 * m}px)"></div></div>`;
}

const escape = value => String(value).replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));

async function main(argv) {
  const opts = args(argv);
  const work = await mkdtemp(path.join(os.tmpdir(), 'launchclip-social-'));
  try {
    await cp(ASSETS, path.join(work, 'assets'), {recursive: true});
    const rows = [];
    let maxWidth = 0;
    for (const group of SOCIAL_SAMPLES) {
      const tiles = [];
      for (const tile of group.tiles) {
        const {width, height} = FORMATS[tile.aspect];
        const scale = opts.tile / height;
        let body;
        try {
          const model = sampleModel(tile.module, tile.variant, tile.aspect, {params: tile.params ?? SAMPLES[tile.module], duration: tile.duration ?? 8});
          const t = typeof tile.at === 'number' ? tile.at : model.motion.exitStart - 0.05;
          body = renderNode(stateTree(catalogHView(model), frameState(catalogHTimeline(model), t)));
        } catch (error) { body = `<div style="color:#ff6b6b;padding:40px;font:28px monospace;white-space:normal">${escape(error.message)}</div>`; }
        tiles.push({name: tile.name, width: width * scale, html: `<div style="position:relative;width:${width}px;height:${height}px;transform:scale(${scale});transform-origin:0 0;overflow:hidden">${backdrop({width, height})}${body}</div>`});
      }
      maxWidth = Math.max(maxWidth, tiles.reduce((sum, tile) => sum + tile.width + 16, 16));
      rows.push(`<section><h2>${escape(group.title)}</h2><div class="row">${tiles.map(tile => `<figure style="width:${tile.width}px"><div class="tile" style="width:${tile.width}px">${tile.html}</div><figcaption>${escape(tile.name)}</figcaption></figure>`).join('')}</div></section>`);
    }
    const fonts = await projectFontFaces(BRAND, {sourceDir: work});
    await copyProjectFonts(fonts.copies, work);
    const html = `<!doctype html><meta charset="utf-8"><style>${fonts.css}
body{margin:0;padding:16px;background:#14151c;color:#f2eee6;font:18px/1.3 ui-monospace,Menlo,monospace;width:${Math.ceil(maxWidth)}px}
h2{margin:18px 0 8px;font-size:22px} .row{display:flex;gap:16px;align-items:flex-start}
figure{margin:0} .tile{height:${opts.tile}px;overflow:hidden;border-radius:8px} figcaption{opacity:.7;margin-top:6px}
svg{display:block}</style><body>${rows.join('')}</body>`;
    const file = path.join(work, 'sheet.html');
    await writeFile(file, html);
    await mkdir(path.dirname(opts.out), {recursive: true});
    const {chromium} = await import('playwright');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({viewport: {width: Math.ceil(maxWidth) + 32, height: 800}});
      await page.goto(pathToFileURL(file).href);
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(img => img.decode().catch(() => {}))); });
      await page.screenshot({path: opts.out, fullPage: true});
    } finally { await browser.close(); }
    process.stdout.write(`${SOCIAL_SAMPLES.length} rows → ${opts.out}\n`);
  } finally {
    await rm(work, {recursive: true, force: true});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
}

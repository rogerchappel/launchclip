// A quick look at the per-frame rig prototype without a render: frames drawn
// to PNG with sharp and tiled into a strip (docs/rd/per-frame-rig.md).
//   node eval/per-frame-rig/preview.mjs --from 0 --to 8 --fps 15 --out strip.png [--crop x,y,w,h] [--width 180] [--cols 15]
import sharp from 'sharp';
import {prototypeTree} from '@launchclip/core/characters/rig-frame-draw.mjs';

const KEEP = new Set(['viewBox']);
const attr = key => (KEEP.has(key) ? key : key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`));
const esc = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** An el() tree (catalog-b-view.mjs) as SVG markup. */
export function svgMarkup(node) {
  if (typeof node === 'string') return esc(node);
  const attrs = Object.entries(node.attrs ?? {}).map(([k, v]) => ` ${attr(k)}="${esc(v)}"`).join('');
  const xmlns = node.tag === 'svg' ? ' xmlns="http://www.w3.org/2000/svg"' : '';
  return `<${node.tag}${xmlns}${attrs}>${(node.children ?? []).map(svgMarkup).join('')}</${node.tag}>`;
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const from = Number(arg('from', 0)), to = Number(arg('to', 8)), fps = Number(arg('fps', 15));
  const crop = arg('crop', '0,1000,1080,920').split(',').map(Number);
  const width = Number(arg('width', 180)), cols = Number(arg('cols', 15));
  const tiles = [];
  for (let t = from; t <= to + 1e-9; t += 1 / fps) {
    const svg = svgMarkup(prototypeTree(t));
    const png = await sharp(Buffer.from(svg)).flatten({background: '#e9e1cf'})
      .extract({left: crop[0], top: crop[1], width: crop[2], height: crop[3]}).resize({width}).png().toBuffer();
    tiles.push(png);
  }
  const h = Math.round(crop[3] * width / crop[2]);
  const rows = Math.ceil(tiles.length / cols);
  await sharp({create: {width: cols * width, height: rows * h, channels: 3, background: '#ffffff'}})
    .composite(tiles.map((input, i) => ({input, left: (i % cols) * width, top: Math.floor(i / cols) * h})))
    .png().toFile(arg('out', 'strip.png'));
  console.log(`${tiles.length} frames → ${arg('out', 'strip.png')}`);
}

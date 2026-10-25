#!/usr/bin/env node
// Vendor the Lucide icon set (ISC; some icons MIT, from Feather) into
// kit/core/icons-lucide.mjs, as path data in the same 24-unit, 2-unit-stroke
// grammar as LaunchClip's own icons (kit/core/icons.mjs).
//
//   npm pack lucide-static@<version>   (in an empty folder; unpack it)
//   node scripts/vendor-lucide.mjs <unpacked>/package [--out kit/core/icons-lucide.mjs]
//
// Reads only <package>/icon-nodes.json ({name: [[tag, attrs], …]}),
// <package>/package.json (the version) and <package>/LICENSE. Every element
// becomes path data: circles, ellipses and rects as closed subpaths (ending
// in Z, so a duotone tint can fill them), lines and polylines as open ones.
// Elements Lucide fills (small dots with fill="currentColor") go to a
// separate solid layer. Nothing is executed from the package.
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const NUMBER = /^-?\d*\.?\d+$/;

const num = (attrs, key, fallback) => {
  const raw = attrs[key] ?? fallback;
  if (raw === undefined) throw new Error(`missing ${key}`);
  const text = String(raw);
  if (!NUMBER.test(text)) throw new Error(`${key} is not a number: ${text}`);
  return Number(text);
};
const n = value => String(Math.round(value * 1000) / 1000);

/** One SVG element of an icon → path data. */
export function elementPath(tag, attrs) {
  if (tag === 'path') {
    const d = String(attrs.d ?? '');
    if (!/^[MmLlHhVvCcSsQqTtAaZz\d.,\s-]+$/.test(d) || !/^\s*[Mm]/.test(d)) throw new Error(`path data has unexpected characters: ${d.slice(0, 40)}`);
    // A leading relative moveto's first point is absolute (it starts from
    // 0 0), but the pairs after it are relative linetos: keep them so.
    return d.trim().replace(/^m\s*(-?(?:\d+\.?\d*|\.\d+))[\s,]*(-?(?:\d+\.?\d*|\.\d+))\s*(?=[-.\d])/, 'M$1 $2l').replace(/^m/, 'M');
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const cx = num(attrs, 'cx', 0), cy = num(attrs, 'cy', 0);
    const rx = tag === 'circle' ? num(attrs, 'r') : num(attrs, 'rx'), ry = tag === 'circle' ? rx : num(attrs, 'ry');
    return `M${n(cx - rx)} ${n(cy)}a${n(rx)} ${n(ry)} 0 1 0 ${n(2 * rx)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-2 * rx)} 0Z`;
  }
  if (tag === 'rect') {
    const x = num(attrs, 'x', 0), y = num(attrs, 'y', 0), w = num(attrs, 'width'), h = num(attrs, 'height');
    let rx = attrs.rx === undefined ? (attrs.ry === undefined ? 0 : num(attrs, 'ry')) : num(attrs, 'rx');
    let ry = attrs.ry === undefined ? rx : num(attrs, 'ry');
    rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
    if (!rx || !ry) return `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
    return `M${n(x + rx)} ${n(y)}h${n(w - 2 * rx)}a${n(rx)} ${n(ry)} 0 0 1 ${n(rx)} ${n(ry)}v${n(h - 2 * ry)}a${n(rx)} ${n(ry)} 0 0 1 ${n(-rx)} ${n(ry)}h${n(-(w - 2 * rx))}a${n(rx)} ${n(ry)} 0 0 1 ${n(-rx)} ${n(-ry)}v${n(-(h - 2 * ry))}a${n(rx)} ${n(ry)} 0 0 1 ${n(rx)} ${n(-ry)}Z`;
  }
  if (tag === 'line') return `M${n(num(attrs, 'x1', 0))} ${n(num(attrs, 'y1', 0))}L${n(num(attrs, 'x2', 0))} ${n(num(attrs, 'y2', 0))}`;
  if (tag === 'polyline' || tag === 'polygon') {
    const values = String(attrs.points ?? '').trim().split(/[\s,]+/).map(Number);
    if (values.length < 4 || values.length % 2 || values.some(v => !Number.isFinite(v))) throw new Error(`bad points: ${attrs.points}`);
    const pts = [];
    for (let i = 0; i < values.length; i += 2) pts.push(`${n(values[i])} ${n(values[i + 1])}`);
    return `M${pts.join('L')}${tag === 'polygon' ? 'Z' : ''}`;
  }
  throw new Error(`unsupported element <${tag}>`);
}

/** Lucide icon nodes → {d, solid?}: solid holds the elements Lucide fills. */
export function iconEntry(nodes) {
  const stroke = [], solid = [];
  for (const [tag, attrs] of nodes) {
    const d = elementPath(tag, attrs);
    if (attrs.fill && attrs.fill !== 'none') solid.push(d); else stroke.push(d);
  }
  return solid.length ? {d: stroke.join(''), solid: solid.join('')} : {d: stroke.join('')};
}

function main(argv) {
  const pkg = argv[0];
  if (!pkg) throw new Error('usage: vendor-lucide.mjs <unpacked lucide-static package> [--out file]');
  const outIndex = argv.indexOf('--out');
  const out = path.resolve(outIndex >= 0 ? argv[outIndex + 1] : path.join(ROOT, 'kit', 'core', 'icons-lucide.mjs'));
  const meta = JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8'));
  if (meta.name !== 'lucide-static' || meta.license !== 'ISC') throw new Error(`expected lucide-static (ISC), got ${meta.name} (${meta.license})`);
  const nodes = JSON.parse(readFileSync(path.join(pkg, 'icon-nodes.json'), 'utf8'));
  const license = readFileSync(path.join(pkg, 'LICENSE'), 'utf8').trim();
  const entries = [];
  for (const name of Object.keys(nodes).sort()) {
    if (!NAME.test(name)) throw new Error(`unexpected icon name ${JSON.stringify(name)}`);
    const entry = iconEntry(nodes[name]);
    entries.push(`  ${JSON.stringify(name)}: ${entry.solid ? `[${JSON.stringify(entry.d)}, ${JSON.stringify(entry.solid)}]` : JSON.stringify(entry.d)}`);
  }
  const header = [
    `// Lucide icons ${meta.version} (https://lucide.dev), vendored by scripts/vendor-lucide.mjs.`,
    '// Generated: do not edit by hand. Each entry is path data in a 24-unit box,',
    '// stroked at 2 units with round caps and joins (the grammar of',
    '// kit/core/icons.mjs), or [stroke, solid] when Lucide fills part of it.',
    '//',
    ...license.split('\n').map(line => `// ${line}`.trimEnd())
  ].join('\n');
  writeFileSync(out, `${header}\n\nexport const LUCIDE_VERSION = ${JSON.stringify(meta.version)};\n\nexport const LUCIDE = Object.freeze({\n${entries.join(',\n')}\n});\n`);
  process.stdout.write(`${entries.length} Lucide ${meta.version} icons → ${path.relative(ROOT, out)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

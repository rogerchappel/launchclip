#!/usr/bin/env node
// Vendor world country shapes for map-highlight (kit/core/catalog-h-map.mjs)
// from the world-atlas package (ISC, Mike Bostock): Natural Earth 1:110m
// Admin 0 countries (public domain), projected with Equal Earth into a
// 1000-unit-wide box and written as SVG path data.
//
//   npm pack world-atlas@<version>   (in an empty folder; unpack it)
//   node scripts/vendor-world.mjs <unpacked>/package [--out kit/core/world-110m.mjs]
//
// Reads only <package>/countries-110m.json, <package>/package.json and
// <package>/LICENSE; nothing is executed from the package. Each country
// gets its path, the centroid of its largest polygon (for labels and pins)
// and the bounds of its main polygons (for zooming; far-off territories
// are left out of the bounds).
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const WIDTH = 1000;

// Equal Earth (Šavrič, Patterson and Jenny, 2018).
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
export function equalEarth(lon, lat) {
  const l = lon * Math.PI / 180, t = Math.asin(M * Math.sin(lat * Math.PI / 180));
  const t2 = t * t, t6 = t2 * t2 * t2;
  return [2 * Math.sqrt(3) * l * Math.cos(t) / (3 * (9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1)), A4 * t6 * t2 * t + A3 * t6 * t + A2 * t2 * t + A1 * t];
}
const [XMAX] = equalEarth(180, 0), [, YMAX] = equalEarth(0, 90);
const SCALE = WIDTH / (2 * XMAX);
export const HEIGHT = Math.round(2 * YMAX * SCALE * 10) / 10;
const project = (lon, lat) => { const [x, y] = equalEarth(lon, lat); return [(x + XMAX) * SCALE, (YMAX - y) * SCALE]; };
const r1 = v => Math.round(v * 10) / 10;

/** TopoJSON arcs (quantized, delta-encoded) → arrays of [lon, lat]. */
function decodeArcs(topology) {
  const [sx, sy] = topology.transform.scale, [tx, ty] = topology.transform.translate;
  return topology.arcs.map(arc => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; });
  });
}

function ring(arcs, indices) {
  const out = [];
  for (const index of indices) {
    const points = index < 0 ? [...arcs[~index]].reverse() : arcs[index];
    out.push(...(out.length ? points.slice(1) : points));
  }
  return out;
}

/**
 * A ring that crosses the antimeridian jumps from 180° to −180°. Unwrap its
 * longitudes so it stays continuous, and shift it so most of it is in range;
 * the sliver past ±180° falls outside the map box, which the module clips. A
 * ring that circles a pole (net turn of 360°) is left as it is.
 */
export function unwrapRing(points) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    let [lon, lat] = points[i];
    const prev = out[i - 1][0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    out.push([lon, lat]);
  }
  if (Math.abs(out.at(-1)[0] - out[0][0]) > 180) return points;
  const mean = out.reduce((sum, p) => sum + p[0], 0) / out.length;
  const shift = mean > 180 ? -360 : mean < -180 ? 360 : 0;
  return shift ? out.map(([lon, lat]) => [lon + shift, lat]) : out;
}

const area = pts => pts.reduce((sum, [x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return sum + x * y2 - x2 * y; }, 0) / 2;
function centroid(pts) {
  let cx = 0, cy = 0;
  const a = area(pts);
  pts.forEach(([x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; const f = x * y2 - x2 * y; cx += (x + x2) * f; cy += (y + y2) * f; });
  return [cx / (6 * a), cy / (6 * a)];
}

function main(argv) {
  const pkg = argv[0];
  if (!pkg) throw new Error('usage: vendor-world.mjs <unpacked world-atlas package> [--out file]');
  const outIndex = argv.indexOf('--out');
  const out = path.resolve(outIndex >= 0 ? argv[outIndex + 1] : path.join(ROOT, 'kit', 'core', 'world-110m.mjs'));
  const meta = JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8'));
  if (meta.name !== 'world-atlas' || meta.license !== 'ISC') throw new Error(`expected world-atlas (ISC), got ${meta.name} (${meta.license})`);
  const license = readFileSync(path.join(pkg, 'LICENSE'), 'utf8').trim();
  const topology = JSON.parse(readFileSync(path.join(pkg, 'countries-110m.json'), 'utf8'));
  const arcs = decodeArcs(topology);
  const entries = [];
  for (const geometry of topology.objects.countries.geometries) {
    const name = String(geometry.properties?.name ?? '');
    if (!name || /[<>"\\]/.test(name)) throw new Error(`unexpected country name ${JSON.stringify(name)}`);
    const id = geometry.id ? String(geometry.id) : `x-${name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`;
    const polygons = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.type === 'MultiPolygon' ? geometry.arcs : [];
    const projected = polygons.map(rings => rings.map(indices => unwrapRing(ring(arcs, indices)).map(([lon, lat]) => project(lon, lat))));
    const d = projected.map(rings => rings.map(pts => {
      const kept = [];
      for (const [x, y] of pts) { const p = [r1(x), r1(y)]; const last = kept.at(-1); if (!last || last[0] !== p[0] || last[1] !== p[1]) kept.push(p); }
      return kept.length >= 3 ? `M${kept.map(p => p.join(' ')).join(' ')}Z` : '';
    }).join('')).join('');
    const outers = projected.map(rings => ({pts: rings[0], area: Math.abs(area(rings[0]))})).sort((a, b) => b.area - a.area);
    const main = outers[0];
    const [cx, cy] = centroid(main.pts);
    const bounds = outers.filter(o => o.area >= main.area * 0.3).flatMap(o => o.pts);
    const xs = bounds.map(p => p[0]), ys = bounds.map(p => p[1]);
    entries.push(`  ${JSON.stringify(id)}: {name: ${JSON.stringify(name)}, c: [${r1(cx)}, ${r1(cy)}], b: [${r1(Math.min(...xs))}, ${r1(Math.min(...ys))}, ${r1(Math.max(...xs))}, ${r1(Math.max(...ys))}], d: ${JSON.stringify(d)}}`);
  }
  const header = [
    `// World countries for map-highlight: Natural Earth 1:110m Admin 0 (public domain,`,
    `// https://www.naturalearthdata.com) via world-atlas ${meta.version}, projected with`,
    `// Equal Earth into a ${WIDTH} × ${HEIGHT} box by scripts/vendor-world.mjs. Generated: do not edit.`,
    '// Keyed by ISO 3166-1 numeric code (or x-<name> where Natural Earth has none):',
    '// name, c (label centroid), b (bounds of the main polygons: x0, y0, x1, y1), d.',
    '//',
    '// world-atlas licence:',
    ...license.split('\n').map(line => `// ${line}`.trimEnd())
  ].join('\n');
  writeFileSync(out, `${header}\n\nexport const WORLD_SIZE = Object.freeze({width: ${WIDTH}, height: ${HEIGHT}});\nexport const WORLD_SOURCE = ${JSON.stringify(`Natural Earth 1:110m via world-atlas ${meta.version}`)};\n\nexport const COUNTRIES = Object.freeze({\n${entries.join(',\n')}\n});\n`);
  process.stdout.write(`${entries.length} countries → ${path.relative(ROOT, out)} (${WIDTH} × ${HEIGHT})\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

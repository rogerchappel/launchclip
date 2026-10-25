#!/usr/bin/env node
// Parity fixtures and runs for the element library (kit/core/catalog-h.mjs).
//
//   node scripts/element-parity.mjs fixtures [--modules a,b]
//     writes test/fixtures/parity/h-<module>-<variant>-<portrait|landscape>.json
//     from scripts/element-samples.mjs: every variant in portrait, the
//     default variant in landscape too.
//   node scripts/element-parity.mjs run [--modules a,b] [--out qa/parity]
//     renders those fixtures with both renderers (one Remotion bundle) and
//     prints a summary table; exits 1 when a sample is below its threshold.
//
// The contact sheet of a run: node scripts/element-sheet.mjs --parity qa/parity
import {mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MODULES, VARIANTS} from '../kit/core/catalog-h.mjs';
import {SAMPLES} from './element-samples.mjs';
import {BRAND, SCENE} from './element-sheet.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = path.join(ROOT, 'test', 'fixtures', 'parity');
const FORMATS = {portrait: {width: 1080, height: 1920, fps: 30, duration: SCENE, platform: 'youtube-shorts'}, landscape: {width: 1920, height: 1080, fps: 30, duration: SCENE, platform: 'youtube'}};

export function fixtureName(id, variant, shape) { return `h-${id}-${variant}-${shape}`; }

/** {name, fixture} for every module variant (portrait) and default (landscape). */
export function elementFixtures(ids = Object.keys(MODULES)) {
  const out = [];
  for (const id of ids) for (const [i, variant] of VARIANTS[id].entries()) for (const shape of i === 0 ? ['portrait', 'landscape'] : ['portrait']) {
    const name = fixtureName(id, variant, shape);
    out.push({name, fixture: {story: {schema: 'launchclip.story.v1', title: `Catalogue H parity: ${name}`, lane: 'motion', format: FORMATS[shape], brand: BRAND, base: null,
      scenes: [{id: 'el', module: id, start: 0, end: SCENE, params: {...SAMPLES[id], variant}}]}, sceneId: 'el', threshold: {ssim: 0.97}}});
  }
  return out;
}

function args(argv) {
  const out = {command: argv[0], modules: null, out: path.join(ROOT, 'qa', 'parity')};
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--modules') out.modules = argv[++i].split(',');
    else if (argv[i] === '--out') out.out = path.resolve(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return out;
}

async function main(argv) {
  const opts = args(argv);
  const ids = opts.modules ?? Object.keys(MODULES);
  if (opts.command === 'fixtures') {
    for (const {name, fixture} of elementFixtures(ids)) await writeFile(path.join(FIXTURES, `${name}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
    process.stdout.write(`${elementFixtures(ids).length} fixtures → ${path.relative(ROOT, FIXTURES)}\n`);
    return 0;
  }
  if (opts.command !== 'run') throw new Error('usage: element-parity.mjs fixtures|run [--modules a,b] [--out dir]');
  const {DEFAULT_ENTRY, bundleRemotion, runParity} = await import('./parity.mjs');
  const files = (await readdir(FIXTURES)).filter(file => ids.some(id => file.startsWith(`h-${id}-`) && VARIANTS[id].some(v => file === `${fixtureName(id, v, 'portrait')}.json` || file === `${fixtureName(id, v, 'landscape')}.json`))).sort();
  const work = await mkdtemp(path.join(os.tmpdir(), 'launchclip-element-parity-'));
  const rows = [];
  try {
    const bundle = await bundleRemotion(DEFAULT_ENTRY, path.join(work, 'bundle'), {publicDir: FIXTURES});
    for (const file of files) {
      try {
        const report = await runParity(path.join(FIXTURES, file), {bundle, out: path.join(opts.out, file.replace(/\.json$/, ''))});
        rows.push({file, min: report.minSsim, pass: report.pass, worst: report.samples.reduce((a, s) => (s.ssim < a.ssim ? s : a))});
      } catch (error) { rows.push({file, min: 0, pass: false, error: error.message.split('\n')[0]}); }
      const row = rows.at(-1);
      process.stdout.write(`${row.pass ? 'ok  ' : 'FAIL'} ${file} ${row.error ?? `min ssim ${row.min.toFixed(4)} (${row.worst.name})`}\n`);
    }
  } finally { await rm(work, {recursive: true, force: true}); }
  const table = ['| Fixture | Min SSIM | Result |', '|---|---|---|', ...rows.map(r => `| ${r.file.replace(/\.json$/, '')} | ${r.min.toFixed(4)} | ${r.pass ? 'pass' : 'FAIL'} |`)].join('\n');
  await writeFile(path.join(opts.out, 'element-parity.md'), `${table}\n`);
  process.stdout.write(`\n${rows.filter(r => r.pass).length}/${rows.length} pass → ${path.join(opts.out, 'element-parity.md')}\n`);
  return rows.every(r => r.pass) ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 2; });
}

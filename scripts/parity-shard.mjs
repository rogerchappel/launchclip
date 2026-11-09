#!/usr/bin/env node
// A slice of the per-module parity corpus (test/fixtures/parity/*.json), for
// CI (.github/workflows/ci.yml "parity-sample", parity-full.yml).
//
//   node scripts/parity-shard.mjs --shard 2/8                 # one of eight equal parts
//   node scripts/parity-shard.mjs --rotate 417 --every 12     # every 12th fixture, offset by 417
//   node scripts/parity-shard.mjs --rotate 417 --every 12 --times settle,mid --out qa/parity-shard
//   node scripts/parity-shard.mjs --shard 2/8 --list          # print the slice, render nothing
//
// --shard i/n takes the fixtures whose position in the sorted corpus is i - 1
// modulo n, so the n shards split the corpus and a module's variants (which
// sort together) spread across them. --rotate s --every k takes every k-th
// fixture starting at s modulo k: k runs with consecutive s render the whole
// corpus, which is how a pull request samples it (s is the CI run number).
// --times is passed to the harness (default: every sample time). The
// Remotion entry is bundled once. Writes summary.md, timings.json and each
// fixture's report under --out, and exits 1 when a sample is below its
// threshold.
import {readdirSync} from 'node:fs';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = path.join(ROOT, 'test', 'fixtures', 'parity');

/** The corpus: fixture file names, sorted. */
export function corpus(dir = FIXTURES) {
  return readdirSync(dir).filter(name => name.endsWith('.json')).sort();
}

/** "2/8" → {index: 2, total: 8}. */
export function parseShard(text) {
  const match = /^(\d+)\/(\d+)$/.exec(String(text ?? ''));
  const index = Number(match?.[1]), total = Number(match?.[2]);
  if (!match || total < 1 || index < 1 || index > total) throw new Error(`--shard must look like 2/8, got "${text}"`);
  return {index, total};
}

/**
 * The slice of `files` (sorted names) to render. {shard: {index, total}}
 * takes position ≡ index - 1 (mod total); {rotate, every} takes position ≡
 * rotate (mod every). With neither, every file.
 */
export function selectFixtures(files, {shard = null, rotate = null, every = null} = {}) {
  if (shard && rotate != null) throw new Error('pass --shard or --rotate, not both');
  if (shard) return files.filter((_, i) => i % shard.total === shard.index - 1);
  if (rotate != null) {
    if (!Number.isInteger(every) || every < 1) throw new Error('--rotate needs --every <n>, a whole number of runs that cover the corpus');
    if (!Number.isInteger(rotate) || rotate < 0) throw new Error('--rotate must be a whole number (the CI run number)');
    return files.filter((_, i) => i % every === rotate % every);
  }
  return [...files];
}

function parseArgs(argv) {
  const options = {out: path.join(ROOT, 'qa', 'parity-shard'), times: undefined, list: false, shard: null, rotate: null, every: null};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => { if (argv[i + 1] === undefined) throw new Error(`${arg} needs a value`); return argv[++i]; };
    if (arg === '--shard') options.shard = parseShard(value());
    else if (arg === '--rotate') options.rotate = Number(value());
    else if (arg === '--every') options.every = Number(value());
    else if (arg === '--times') options.times = value();
    else if (arg === '--out') options.out = path.resolve(value());
    else if (arg === '--list') options.list = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  const files = selectFixtures(corpus(), options);
  const label = options.shard ? `shard ${options.shard.index}/${options.shard.total}` : options.rotate != null ? `rotation ${options.rotate % options.every} of ${options.every}` : 'whole corpus';
  if (options.list) { process.stdout.write(`${files.join('\n')}\n`); return 0; }
  const {DEFAULT_ENTRY, bundleRemotion, runParity} = await import('./parity.mjs');
  await mkdir(options.out, {recursive: true});
  const started = Date.now();
  const rows = [];
  const work = await mkdtemp(path.join(os.tmpdir(), 'launchclip-parity-shard-'));
  let bundleSeconds = 0;
  try {
    const bundle = await bundleRemotion(DEFAULT_ENTRY, path.join(work, 'bundle'), {publicDir: FIXTURES});
    bundleSeconds = (Date.now() - started) / 1000;
    for (const file of files) {
      const t0 = Date.now();
      try {
        const report = await runParity(path.join(FIXTURES, file), {times: options.times, bundle, out: path.join(options.out, file.replace(/\.json$/, ''))});
        rows.push({name: file, samples: report.samples.length, minSsim: report.minSsim, threshold: report.threshold.ssim, pass: report.pass, seconds: (Date.now() - t0) / 1000, failures: report.samples.filter(sample => !sample.pass).map(sample => `${sample.name} t=${sample.time}: ssim ${sample.ssim.toFixed(4)}`)});
      } catch (error) {
        rows.push({name: file, samples: 0, minSsim: null, threshold: null, pass: false, seconds: (Date.now() - t0) / 1000, failures: [String(error.message ?? error).split('\n')[0]]});
      }
      const row = rows.at(-1);
      process.stdout.write(`${row.pass ? 'pass' : 'FAIL'} ${row.name} ${row.minSsim == null ? 'error' : row.minSsim.toFixed(4)} ${row.seconds.toFixed(1)} s\n`);
    }
  } finally {
    await rm(work, {recursive: true, force: true});
  }
  const total = (Date.now() - started) / 1000;
  const failed = rows.filter(row => !row.pass);
  const rendering = rows.reduce((sum, row) => sum + row.seconds, 0);
  const lines = [`${rows.length} of ${corpus().length} fixtures (${label}, times: ${options.times ?? 'all'}): ${rows.length - failed.length} pass, ${failed.length} fail.`,
    `Total ${total.toFixed(1)} s on ${process.platform}-${process.arch}: bundle ${bundleSeconds.toFixed(1)} s, fixtures ${rendering.toFixed(1)} s (${rows.length ? (rendering / rows.length).toFixed(1) : '0'} s each).`];
  if (failed.length) lines.push('', '| Fixture | Min SSIM | Threshold | Failing samples |', '|---|---|---|---|', ...failed.map(row => `| ${row.name} | ${row.minSsim == null ? 'error' : row.minSsim.toFixed(4)} | ${row.threshold ?? ''} | ${row.failures.join('; ')} |`));
  const summary = lines.join('\n');
  process.stdout.write(`\n${summary}\n`);
  await writeFile(path.join(options.out, 'summary.md'), `${summary}\n`);
  await writeFile(path.join(options.out, 'timings.json'), `${JSON.stringify({label, times: options.times ?? 'all', platform: `${process.platform}-${process.arch}`, total, bundle: bundleSeconds, fixtures: rows.map(({name, samples, seconds, pass, minSsim}) => ({name, samples, seconds, pass, minSsim}))}, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `## Renderer parity, ${label}\n\n${summary}\n`, {flag: 'a'});
  return failed.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 2; });
}

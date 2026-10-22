#!/usr/bin/env node
// Cross-OS parity smoke for CI (the "parity" job in .github/workflows/ci.yml).
//
//   node scripts/parity-ci.mjs [--out qa/parity-ci]
//
// A handful of representative fixtures, chosen so every default registry font
// is drawn (Anton, Inter, JetBrains Mono, Space Grotesk, STIX Two Text and
// Math, Instrument Serif), at two sampled times each, plus full-frame stills
// of examples/story/minimal through both renderer adapters (captions,
// transitions and plates included). The Remotion entry is bundled once. Exits 1
// when any sample is below its SSIM threshold. The full corpus stays in
// `LAUNCHCLIP_PARITY=1 node --test test/parity.test.js`.
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEFAULT_ENTRY, bundleRemotion, runParity, runStoryParity} from './parity.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = path.join(ROOT, 'test', 'fixtures', 'parity');

export const CI_FIXTURES = Object.freeze([
  {file: 'a-cat-hook-title.json', fonts: 'Anton, JetBrains Mono'},
  {file: 'a-cat-equation-lockup.json', fonts: 'STIX Two Text, STIX Two Math, Space Grotesk'},
  {file: 'b-cat-archive-card.json', fonts: 'Instrument Serif italic, Anton'},
  {file: 'callout-treated-portrait.json', fonts: 'Inter, JetBrains Mono (editorial)'},
  {file: 'b-code-snippet-typing.json', fonts: 'JetBrains Mono (editorial code)'}
]);
export const CI_TIMES = 'settle,mid';
// Story times: a settled hold (ambient field and drift well under way), the
// s1→s2 fade, and late in s2's hold.
export const CI_STORY = Object.freeze({project: path.join(ROOT, 'examples', 'story', 'minimal'), times: [1.2, 2.6, 3.6, 5.5]});

async function main(argv) {
  const outIndex = argv.indexOf('--out');
  const out = path.resolve(outIndex >= 0 ? argv[outIndex + 1] : path.join(ROOT, 'qa', 'parity-ci'));
  await mkdir(out, {recursive: true});
  const started = Date.now();
  const rows = [];
  const work = await mkdtemp(path.join(os.tmpdir(), 'launchclip-parity-ci-'));
  try {
    const bundle = await bundleRemotion(DEFAULT_ENTRY, path.join(work, 'bundle'), {publicDir: FIXTURES});
    for (const {file, fonts} of CI_FIXTURES) {
      const t0 = Date.now();
      const report = await runParity(path.join(FIXTURES, file), {times: CI_TIMES, bundle, out: path.join(out, file.replace(/\.json$/, ''))});
      rows.push({name: file, fonts, minSsim: report.minSsim, threshold: report.threshold.ssim, pass: report.pass, seconds: (Date.now() - t0) / 1000, failures: report.samples.filter(sample => !sample.pass)});
    }
    const t0 = Date.now();
    const story = await runStoryParity(CI_STORY.project, {times: CI_STORY.times, out: path.join(out, 'story-minimal')});
    rows.push({name: 'story: examples/story/minimal', fonts: 'brand roles + captions + ambient', minSsim: story.minSsim, threshold: story.threshold.ssim, pass: story.pass, seconds: (Date.now() - t0) / 1000, failures: story.samples.filter(sample => !sample.pass)});
  } finally {
    await rm(work, {recursive: true, force: true});
  }
  const total = (Date.now() - started) / 1000;
  const lines = ['| Check | Fonts | Min SSIM | Threshold | Result | Seconds |', '|---|---|---|---|---|---|',
    ...rows.map(row => `| ${row.name} | ${row.fonts} | ${row.minSsim.toFixed(4)} | ${row.threshold} | ${row.pass ? 'pass' : 'FAIL'} | ${row.seconds.toFixed(1)} |`),
    '', `Total ${total.toFixed(1)} s on ${process.platform}-${process.arch}.`];
  const summary = lines.join('\n');
  process.stdout.write(`${summary}\n`);
  await writeFile(path.join(out, 'summary.md'), `${summary}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `## Renderer parity (${process.platform})\n\n${summary}\n`, {flag: 'a'});
  for (const row of rows) for (const sample of row.failures) process.stderr.write(`FAIL ${row.name} ${sample.name} t=${sample.time}: ssim ${sample.ssim.toFixed(4)} < ${row.threshold}\n`);
  return rows.every(row => row.pass) ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 2; });
}

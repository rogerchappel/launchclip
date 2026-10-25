#!/usr/bin/env node
// Background and panel parity (docs/KIT_CONTRACTS.md, "Backgrounds and panels").
//
//   node scripts/parity-backgrounds.mjs [--only bg-mesh,panel-glass-light] [--out qa/parity-backgrounds]
//
// Every fixture in test/fixtures/parity-backgrounds/ is {describe, project,
// times, patch, files?}: a story project with top-level storyboard keys replaced (a
// background kind, a panel treatment, a light palette), rendered as whole
// stills through both renderer adapters (scripts/parity.mjs runStoryParity).
// Writes summary.md; exits 1 when any sample is below its SSIM threshold.
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runStoryParity} from './parity.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const BACKGROUND_FIXTURES = path.join(ROOT, 'test', 'fixtures', 'parity-backgrounds');

/** The fixtures as [{name, describe, project, times, patch}], sorted by name. */
export async function backgroundFixtures() {
  const files = (await readdir(BACKGROUND_FIXTURES)).filter(name => name.endsWith('.json')).sort();
  return Promise.all(files.map(async file => ({name: file.replace(/\.json$/, ''), ...JSON.parse(await readFile(path.join(BACKGROUND_FIXTURES, file), 'utf8'))})));
}

/** Story parity for one fixture → runStoryParity's report. */
export function runBackgroundParity(fixture, {out} = {}) {
  return runStoryParity(path.join(ROOT, fixture.project), {times: fixture.times, patch: fixture.patch, files: fixture.files, out: out ?? path.join(ROOT, 'qa', 'parity-backgrounds', fixture.name)});
}

async function main(argv) {
  const value = flag => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
  const only = value('--only')?.split(',') ?? null;
  const out = path.resolve(value('--out') ?? path.join(ROOT, 'qa', 'parity-backgrounds'));
  await mkdir(out, {recursive: true});
  const rows = [];
  for (const fixture of (await backgroundFixtures()).filter(entry => !only || only.includes(entry.name))) {
    const t0 = Date.now();
    const report = await runBackgroundParity(fixture, {out: path.join(out, fixture.name)});
    rows.push({fixture, report, seconds: (Date.now() - t0) / 1000});
    process.stdout.write(`${fixture.name}: min SSIM ${report.minSsim.toFixed(4)} ${report.pass ? 'pass' : 'FAIL'}\n`);
  }
  const summary = ['| Fixture | Min SSIM | Threshold | Result | Seconds |', '|---|---|---|---|---|',
    ...rows.map(({fixture, report, seconds}) => `| ${fixture.name} | ${report.minSsim.toFixed(4)} | ${report.threshold.ssim} | ${report.pass ? 'pass' : 'FAIL'} | ${seconds.toFixed(1)} |`)].join('\n');
  await writeFile(path.join(out, 'summary.md'), `${summary}\n`);
  process.stdout.write(`${summary}\n`);
  return rows.every(row => row.report.pass) ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 2; });
}

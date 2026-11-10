#!/usr/bin/env node
// The animation parity table (docs/ANIMATION_PIPELINE_RFC.md §8.3): compares
// the scorecard's make report with its skill report, brief by brief, and
// writes benchmarks/ANIMATION_PARITY.md.
//
//   npm run eval:animation-parity [-- --make <report.json>] [--skill <report.json>]
//     [--out benchmarks/ANIMATION_PARITY.md] [--json] [--strict]
//
// The reports come from `npm run eval:formats -- --animation --path make|skill
// --runs <dir>` (default qa/animation-eval/<path>/report.json). A report that
// is missing, or a brief either path has not finished, is written as "not
// run": the table never holds a number nobody measured. --strict exits 1
// unless every brief is at parity.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANIMATION_SCORECARD_SCHEMA, compareAnimation, parityMarkdown } from './animation-metrics.mjs';
import { ANIMATION_OUT, loadAnimationSuite } from './formats.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const PARITY_TABLE = path.join(ROOT, 'benchmarks', 'ANIMATION_PARITY.md');

export function parseArguments(argv) {
  const options = { make: path.join(ANIMATION_OUT, 'make', 'report.json'), skill: path.join(ANIMATION_OUT, 'skill', 'report.json'), out: PARITY_TABLE, json: false, strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--strict') options.strict = true;
    else if (['--make', '--skill', '--out'].includes(arg)) {
      if (!argv[i + 1]) throw new Error(`${arg} needs a file`);
      options[arg.slice(2)] = argv[++i];
    } else throw new Error(`unknown argument ${arg}; use --make report.json --skill report.json --out file --json --strict`);
  }
  return options;
}

/** A path's scorecard report, or null when it has not been run. Throws on a file that is not one, or is the other path's. */
export async function readReport(file, route) {
  if (!existsSync(file)) return null;
  const report = JSON.parse(await readFile(file, 'utf8'));
  if (report.schema !== ANIMATION_SCORECARD_SCHEMA) throw new Error(`${file} is not an animation scorecard report (${ANIMATION_SCORECARD_SCHEMA})`);
  if (report.path !== route) throw new Error(`${file} is a report for ${report.path ? `the ${report.path} path` : 'the stand-in examples'}, not for ${route}: run npm run eval:formats -- --animation --path ${route} --runs <dir>`);
  return report;
}

/** Both reports → {briefs: [{id, comparison | null}], markdown, parity}. */
export async function runAnimationParity({ make, skill, generated = new Date().toISOString() } = {}) {
  const suite = await loadAnimationSuite();
  const [a, b] = [await readReport(make, 'make'), await readReport(skill, 'skill')];
  const find = (report, id) => (report?.results ?? []).find((result) => result.id === id && result.metrics) ?? null;
  const briefs = suite.briefs.map((brief) => {
    const x = find(a, brief.id), y = find(b, brief.id);
    return { id: brief.id, comparison: x && y ? compareAnimation(x.metrics, y.metrics) : null };
  });
  const ran = briefs.filter((entry) => entry.comparison);
  return {
    briefs,
    ran: ran.length,
    parity: ran.length === briefs.length && ran.every((entry) => entry.comparison.parity === true),
    markdown: parityMarkdown({ briefs: suite.briefs, make: a, skill: b, generated, suite })
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = await runAnimationParity(options);
    await mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
    await writeFile(path.resolve(options.out), result.markdown);
    if (options.json) process.stdout.write(`${JSON.stringify({ ran: result.ran, parity: result.parity, briefs: result.briefs }, null, 2)}\n`);
    else process.stdout.write(`${result.ran ? `${result.ran} of ${result.briefs.length} briefs run on both paths; ${result.parity ? 'make is at parity' : 'make is not at parity, or the run is incomplete'}` : 'neither path has been run: the table is written as not yet run'}\ntable: ${path.relative(process.cwd(), path.resolve(options.out))}\n`);
    process.exit(options.strict && !result.parity ? 1 : 0);
  } catch (error) {
    process.stderr.write(`eval:animation-parity: ${error.message}\n`);
    process.exit(2);
  }
}

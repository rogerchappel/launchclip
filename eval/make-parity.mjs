#!/usr/bin/env node
// The make-vs-skill parity harness (docs/MAKE_SKILL_PARITY.md, "Measuring
// parity"): scores two finished projects made from the same brief, one by
// `launchclip make` and one through the create-video skill, and says whether
// make is at parity.
//
//   npm run eval:make-parity -- <make-project> <skill-project> [--kind news|research|product]
//     [--format long-form|short-form|…] [--json] [--strict]
//   npm run eval:make-parity -- <project>          one project's metrics
//   npm run eval:make-parity                       the fixture pair in eval/fixtures/make-parity
//
// It reads what a finished project already has: storyboard.json (resolved
// against NARRATION.json's words), the narration (NARRATION.json, else
// SCRIPT.json, else SCRIPT.md) and qa/critic.json. Nothing is rendered and no
// model is called, so it runs offline. --strict exits 1 when make is not at
// parity; without it the exit code is 0 and the table says so.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CADENCE_FORMATS } from '@launchclip/core/cadence.mjs';
import { resolveStory } from '@launchclip/core/story.mjs';
import { compareProjects, formatComparison, projectMetrics } from './make-parity-metrics.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const FIXTURE_PAIR = Object.freeze({ make: path.join(ROOT, 'eval', 'fixtures', 'make-parity', 'make'), skill: path.join(ROOT, 'eval', 'fixtures', 'make-parity', 'skill'), kind: 'news' });
const KINDS = ['news', 'research', 'product'];

export function parseArguments(argv) {
  const options = { projects: [], kind: null, format: null, json: false, strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--kind' || arg === '--format') {
      const value = argv[i += 1];
      const allowed = arg === '--kind' ? KINDS : CADENCE_FORMATS;
      if (!allowed.includes(value)) throw new Error(`${arg} must be one of ${allowed.join(', ')}; got ${value}`);
      options[arg.slice(2)] = value;
    } else if (arg.startsWith('--')) throw new Error(`unknown argument ${arg}`);
    else options.projects.push(arg);
  }
  if (options.projects.length > 2) throw new Error('give one project, or a make project and a skill project');
  return options;
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}

// SCRIPT.md's spoken text: its lines, less headings, tables, comments and stage notes.
function markdownNarration(text) {
  return text.split('\n').map((line) => line.trim()).filter((line) => line && !/^(#|\||>|<!--|---|```|- \[|\*\*[^*]+:\*\*$)/.test(line)).join(' ');
}

/** A finished project's inputs: the resolved story, the narration and the critique (null when it has none). */
export async function readProject(dir) {
  const project = path.resolve(dir);
  const story = await readJson(path.join(project, 'storyboard.json'));
  if (!story) throw new Error(`${project} has no readable storyboard.json`);
  const narrationDoc = await readJson(path.join(project, 'NARRATION.json'));
  const words = Array.isArray(narrationDoc?.words) ? narrationDoc.words : [];
  const beats = await readJson(path.join(project, 'BEATS.json'));
  const script = await readJson(path.join(project, 'SCRIPT.json'));
  const scriptMd = existsSync(path.join(project, 'SCRIPT.md')) ? markdownNarration(await readFile(path.join(project, 'SCRIPT.md'), 'utf8')) : '';
  const narration = String(narrationDoc?.text ?? '').trim() || words.map((word) => word.text ?? word.word).join(' ').trim() || String(script?.narration ?? '').trim() || scriptMd;
  return { project, story: resolveStory(story, { words, beats }), narration, critique: await readJson(path.join(project, 'qa', 'critic.json')) };
}

/** Metrics for one project directory. */
export async function measureProject(dir, { format = null } = {}) {
  const { project, ...inputs } = await readProject(dir);
  return { project, ...projectMetrics({ ...inputs, format }) };
}

/** Both projects' metrics and their comparison. */
export async function runParity({ make, skill, kind = null, format = null }) {
  const a = await measureProject(make, { format });
  // Both are judged against one cadence profile: the named one, else the one make's video infers.
  const b = await measureProject(skill, { format: format ?? a.story.cadence.format });
  return { make: a, skill: b, comparison: compareProjects(a, b, { kind }) };
}

async function main(argv) {
  const options = parseArguments(argv);
  if (options.projects.length === 1) {
    const metrics = await measureProject(options.projects[0], { format: options.format });
    process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
    return 0;
  }
  const pair = options.projects.length === 2 ? { make: options.projects[0], skill: options.projects[1], kind: options.kind } : { ...FIXTURE_PAIR, kind: options.kind ?? FIXTURE_PAIR.kind };
  const result = await runParity({ ...pair, format: options.format });
  process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatComparison(result.comparison, { make: result.make.project, skill: result.skill.project }));
  return options.strict && !result.comparison.parity ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => { process.stderr.write(`make-parity: ${error.message}\n`); process.exit(2); });
}

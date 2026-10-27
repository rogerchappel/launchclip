#!/usr/bin/env node
// A beat-map dry run: a markdown script (SCRIPT.md: `# Title`, `## Chapter`
// headings) with no voice yet gets steady-pace word timings, and the beat
// director plans the whole transcript against the research ledger and
// captures beside it. Writes, into the fixture folder:
//
//   NARRATION.json   the dry-run word timings
//   BEATS.json       the beat map (launchclip.beat-map.v1)
//   DIRECTION.json   the same plan as a direction map
//   CADENCE.md       the planning report (cadence gate, variety, evidence)
//
//   node eval/beat-map-dry-run.mjs [folder] [--wpm 155] [--style default] [--fresh]
//
// A BEATS.json already there is passed back as `previous`, so chunks whose
// words, history and settings are unchanged are reused (--fresh plans all).

import { existsSync, readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beatMapReportText, beatMapToDirection, directLongForm, dryRunWords } from '../kit/core/beat-director.mjs';
import { directionJson, validateDirection } from '../kit/core/direction.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DEFAULT_FIXTURE = path.join(ROOT, 'eval', 'fixtures', 'long-form-16min');

/** Load SCRIPT.md, research/evidence.json and research/captures/*.json from a folder. */
export async function loadFixture(folder) {
  const script = await readFile(path.join(folder, 'SCRIPT.md'), 'utf8');
  const ledgerFile = path.join(folder, 'research', 'evidence.json');
  const ledger = existsSync(ledgerFile) ? JSON.parse(await readFile(ledgerFile, 'utf8')) : null;
  const captureDir = path.join(folder, 'research', 'captures');
  const captures = existsSync(captureDir) ? await Promise.all(readdirSync(captureDir).filter((name) => name.endsWith('.json')).sort().map(async (name) => JSON.parse(await readFile(path.join(captureDir, name), 'utf8')))) : [];
  return { script, ledger, captures };
}

export async function dryRun(folder = DEFAULT_FIXTURE, { wpm = 155, style = 'default', fresh = false, format = { width: 1920, height: 1080 } } = {}) {
  const { script, ledger, captures } = await loadFixture(folder);
  const timed = dryRunWords(script, { wpm });
  const beatsFile = path.join(folder, 'BEATS.json');
  const previous = !fresh && existsSync(beatsFile) ? JSON.parse(await readFile(beatsFile, 'utf8')) : null;
  const map = directLongForm({ words: timed.words, chapters: timed.chapters, ledger, captures, title: timed.title, format }, { style, previous });
  const direction = beatMapToDirection(map);
  const check = validateDirection(direction, { words: timed.words, lane: 'motion', deferScenes: true });
  if (!check.ok) throw new Error(`the direction map does not validate:\n${check.errors.slice(0, 5).join('\n')}`);
  const report = beatMapReportText(map);
  await writeFile(path.join(folder, 'NARRATION.json'), `${JSON.stringify({ words: timed.words }, null, 0).replace(/\},\{/g, '},\n{')}\n`);
  await writeFile(beatsFile, `${JSON.stringify(map, null, 1)}\n`);
  await writeFile(path.join(folder, 'DIRECTION.json'), directionJson(direction));
  await writeFile(path.join(folder, 'CADENCE.md'), `# Beat map dry run\n\n${timed.words.length} words at ${wpm} wpm (dry-run timings, no voice), \`node eval/beat-map-dry-run.mjs\`.\n\n\`\`\`text\n${report}\n\`\`\`\n`);
  return { map, report };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
  const folder = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? DEFAULT_FIXTURE;
  const { report } = await dryRun(path.resolve(folder), { wpm: Number(flag('wpm', 155)), style: flag('style', 'default'), fresh: args.includes('--fresh') });
  console.log(report);
}

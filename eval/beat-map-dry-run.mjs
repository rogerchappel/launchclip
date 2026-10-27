#!/usr/bin/env node
// A beat-map dry run: a markdown script (SCRIPT.md: `# Title`, `## Chapter`
// headings) with no voice yet gets steady-pace word timings, and the beat
// director plans the whole transcript against the research ledger and
// captures beside it. Writes, into the fixture folder:
//
//   NARRATION.json   the dry-run word timings
//   BEATMAP.json     the beat map (launchclip.beat-map.v1)
//   DIRECTION.json   the same plan as a direction map
//   CADENCE.md       the planning report (cadence gate, variety, evidence),
//                    and the Shorts cut from it
//   SHORTS.json      3–5 Shorts (9:16) cut from the map: windows, skeletons,
//                    short-form cadence and each state's module
//
//   node eval/beat-map-dry-run.mjs [folder] [--wpm 155] [--style default] [--fresh]
//     [--ctas 210,580,900] [--no-stings]
//
// The fixture's structure: mid-roll subscribe calls at 3:30, 9:40 and 15:00
// and a logo sting at the open and the close (the reference's).
//
// A BEATMAP.json already there is passed back as `previous`, so chunks whose
// words, history and settings are unchanged are reused (--fresh plans all).
// Exits 1 when the plan misses its cadence gate.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beatMapReportText, beatMapToDirection, directLongForm, dryRunWords } from '../kit/core/beat-director.mjs';
import { cutShorts } from '../kit/core/cutdown.mjs';
import { directionJson, validateDirection } from '../kit/core/direction.mjs';
import { loadResearchEvidence } from '../src/research/evidence_data.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DEFAULT_FIXTURE = path.join(ROOT, 'eval', 'fixtures', 'long-form-16min');

/**
 * Load SCRIPT.md, research/evidence.json and research/captures/*.json from a
 * folder, with the module-ready evidence data attached in memory
 * (src/research/evidence_data.js: GitHub cards from assets/evidence/github-*.json,
 * posts from capture sidecars, series from research/data/, people, tokens).
 */
export async function loadFixture(folder, adapters = {}) {
  const script = await readFile(path.join(folder, 'SCRIPT.md'), 'utf8');
  const { ledger, captures, report } = await loadResearchEvidence(path.join(folder, 'research'), { root: folder }, adapters);
  return { script, ledger, captures, evidenceData: report };
}

export const DEFAULT_CTAS = Object.freeze([210, 580, 900]);

export async function dryRun(folder = DEFAULT_FIXTURE, { wpm = 155, style = 'default', fresh = false, format = { width: 1920, height: 1080 }, ctas = DEFAULT_CTAS, stings = true } = {}) {
  const { script, ledger, captures } = await loadFixture(folder);
  const timed = dryRunWords(script, { wpm });
  const beatsFile = path.join(folder, 'BEATMAP.json');
  const previous = !fresh && existsSync(beatsFile) ? JSON.parse(await readFile(beatsFile, 'utf8')) : null;
  const map = directLongForm({ words: timed.words, chapters: timed.chapters, ledger, captures, title: timed.title, format }, { style, previous, ctas: ctas.map((at) => ({ at, action: 'Subscribe for the next breakdown' })), stings });
  const direction = beatMapToDirection(map);
  const check = validateDirection(direction, { words: timed.words, lane: 'motion', deferScenes: true });
  if (!check.ok) throw new Error(`the direction map does not validate:\n${check.errors.slice(0, 5).join('\n')}`);
  const shorts = cutShorts(map, timed.words, { count: 4 });
  const report = `${beatMapReportText(map)}\n\n${shortsReportText(shorts)}`;
  await writeFile(path.join(folder, 'SHORTS.json'), `${JSON.stringify(shorts.map(shortSummary), null, 1)}\n`);
  await writeFile(path.join(folder, 'NARRATION.json'), `${JSON.stringify({ words: timed.words }, null, 0).replace(/\},\{/g, '},\n{')}\n`);
  await writeFile(beatsFile, `${JSON.stringify(map, null, 1)}\n`);
  await writeFile(path.join(folder, 'DIRECTION.json'), directionJson(direction));
  await writeFile(path.join(folder, 'CADENCE.md'), `# Beat map dry run\n\n${timed.words.length} words at ${wpm} wpm (dry-run timings, no voice), \`node eval/beat-map-dry-run.mjs\`.\n\n\`\`\`text\n${report}\n\`\`\`\n`);
  return { map, shorts, report };
}

/** A Short as SHORTS.json lists it: where it comes from and what it shows. */
export function shortSummary(short) {
  const states = short.map.chapters.flatMap((chapter) => chapter.shots.flatMap((shot) => shot.states.map((state) => ({ shot: shot.id, start: state.start, module: state.module, change: state.change, text: state.text }))));
  return { id: short.id, title: short.title, window: short.window, skeleton: short.skeleton, duration: short.map.duration, cadence: { events: short.report.cadence.events, per_min: short.report.cadence.per_min, gap: short.report.cadence.gap, cuts: short.report.cadence.cuts, ok: short.report.gate.ok }, states };
}

export function shortsReportText(shorts) {
  const lines = [`shorts: ${shorts.length} cut for 9:16 at short-form cadence`];
  for (const short of shorts) {
    const c = short.report.cadence;
    lines.push(`  ${short.report.gate.ok ? 'ok  ' : 'FAIL'} ${short.id.padEnd(44)} ${String(short.window.start).padStart(8)}–${String(short.window.end).padEnd(8)} ${String(short.map.duration).padStart(6)} s  ${c.events} events, p50 ${c.gap.p50} s, ${c.cuts} cuts  skeleton ${short.skeleton?.id ?? 'none'}  opens on ${short.story.scenes[0]?.module}`);
  }
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
  const folder = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? DEFAULT_FIXTURE;
  const { map, report } = await dryRun(path.resolve(folder), { wpm: Number(flag('wpm', 155)), style: flag('style', 'default'), fresh: args.includes('--fresh'), ctas: flag('ctas', null) ? flag('ctas').split(',').map(Number) : DEFAULT_CTAS, stings: !args.includes('--no-stings') });
  console.log(report);
  // The planning gate: a plan that misses its cadence target fails the run.
  if (!map.report.cadence.gate.ok) process.exitCode = 1;
}

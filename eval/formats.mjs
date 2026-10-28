#!/usr/bin/env node
// The six-format quality harness: renders a short sample per format (the
// golden briefs in eval/formats.json), measures it and prints the scorecard.
//
//   npm run eval:formats [-- --formats short-form,long-form] [--renderer hyperframes|remotion]
//     [--no-render] [--reuse] [--quality draft] [--out qa/format-eval]
//
// Per brief: stage the sample project (an example, a window of the long-form
// beat-map fixture, or a Short cut from it), validate it, run the layout
// check, compile and render it, then measure the video with ffmpeg: scene
// detection at 0.04, 0.08 and 0.15 (the reference's thresholds, on every
// frame, so the numbers compare with the benchmark) for the event cadence,
// the same on frames 0.25 s apart as a soft-event diagnostic (a fade or a
// build on a quiet frame), per-frame change peaks for the a/v sync check,
// freezedetect for motion on every hold, ffprobe for the audio. Evidence coverage, module variety and caption
// hygiene come from the storyboard (and the beat map when there is one).
// --no-render scores what the plan alone can answer; --reuse keeps a render
// whose storyboard has not changed since it was made. Writes
// <out>/report.json, <out>/report.md and a contact sheet per format.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beatMapToStory, windowWords } from '@launchclip/core/beat-director.mjs';
import { cadenceGate, cadenceTarget, eventStats } from '@launchclip/core/cadence.mjs';
import { cutShorts } from '@launchclip/core/cutdown.mjs';
import { SCENE_THRESHOLDS, SCORECARD_SCHEMA, SOFT_EVENT_FPS, CAPTIONS_REQUIRED, avSync, captionHygiene, changePeaks, evidenceCoverage, formatScorecard, moduleVariety, motionOnHold, parseFreezes, parseSceneScores, renderedCadence, scenesAbove, scoreBrief, stateEvents } from './scorecard.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const BRIEFS_FILE = path.join(ROOT, 'eval', 'formats.json');
export const DEFAULT_OUT = path.join('qa', 'format-eval');

const run = (command, args, options = {}) => execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 256, ...options });

export async function loadBriefs(file = BRIEFS_FILE) {
  const data = JSON.parse(await readFile(file, 'utf8'));
  return data.briefs;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

/**
 * Stage a brief's sample as a project folder. → {project, story, words, map,
 * plan (the plan's cadence gate, for beat-map samples)}
 */
export async function stageSample(brief, project) {
  await rm(project, { recursive: true, force: true });
  await mkdir(project, { recursive: true });
  const sample = brief.sample;
  if (sample.kind === 'dir') {
    const { stageStory } = await import('../src/renderer_eval.js');
    const staged = await stageStory({ id: brief.id, dir: sample.dir }, project, { root: ROOT });
    const story = await readJson(staged.storyFile);
    const wordsFile = path.join(project, typeof story.audio?.words === 'string' ? story.audio.words : 'NARRATION.json');
    const words = existsSync(wordsFile) ? (await readJson(wordsFile)).words ?? [] : [];
    return { project, story, words, map: null, plan: null, warnings: staged.warnings };
  }
  const fixture = path.join(ROOT, sample.fixture);
  const map = await readJson(path.join(fixture, 'BEATMAP.json'));
  const allWords = (await readJson(path.join(fixture, 'NARRATION.json'))).words;
  let story, words, plan, sampleMap;
  if (sample.kind === 'beat-map') {
    const chapter = map.chapters.find((entry) => entry.id === sample.chapter) ?? map.chapters[0];
    const from = chapter.start, to = Math.min(chapter.end, from + (sample.seconds ?? 60));
    story = beatMapToStory(map, { from, to, title: `${map.title}: ${chapter.title}` });
    words = windowWords(allWords, from, to);
    const states = map.chapters.flatMap((entry) => entry.shots.flatMap((shot) => shot.states.map((state) => ({ ...state, shotStart: shot.start })))).filter((state) => state.start >= from && state.start < to);
    const stats = eventStats(states.map((state) => state.start - from).filter((t) => t > 0), { duration: to - from, cuts: [...new Set(states.map((state) => state.shotStart))].filter((t) => t > from).map((t) => t - from) });
    plan = cadenceGate(stats, cadenceTarget(brief.format));
    sampleMap = { ...map, chapters: map.chapters.map((entry) => ({ ...entry, shots: entry.shots.map((shot) => ({ ...shot, states: shot.states.filter((state) => state.start >= from && state.start < to) })).filter((shot) => shot.states.length) })).filter((entry) => entry.shots.length) };
  } else if (sample.kind === 'short') {
    const short = cutShorts(map, allWords, { count: Math.max(3, (sample.index ?? 0) + 1) })[sample.index ?? 0];
    story = short.story;
    words = short.words;
    plan = short.report.gate;
    sampleMap = short.map;
  } else throw new Error(`unknown sample kind "${sample.kind}"`);
  await writeFile(path.join(project, 'storyboard.json'), `${JSON.stringify(story, null, 2)}\n`);
  await writeFile(path.join(project, 'NARRATION.json'), `${JSON.stringify({ words }, null, 1)}\n`);
  return { project, story, words, map: sampleMap, plan, warnings: [] };
}

// Every frame's scene score in one pass (fps: sample first, for the soft-event diagnostic).
async function sceneScores(video, fps = null) {
  const filter = `${fps ? `fps=${fps},` : ''}select='gte(scene,0)',metadata=print:key=lavfi.scene_score`;
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', video, '-vf', filter, '-an', '-f', 'null', '-']);
  return parseSceneScores(stderr);
}

async function freezes(video, duration) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', video, '-vf', 'freezedetect=n=0.002:d=1', '-an', '-f', 'null', '-']);
  return parseFreezes(stderr, duration);
}

async function contactSheet(video, file, { duration, portrait }) {
  const every = Math.max(1, duration / 12);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-vf', `fps=1/${every.toFixed(3)},scale=${portrait ? '-2:400' : '480:-2'},tile=${portrait ? '6x2' : '4x3'}:padding=6:color=0x111111`, '-frames:v', '1', file]);
  return file;
}

/** Evaluate one brief: stage, check, render, measure, score. */
export async function evaluateBrief(brief, { out = DEFAULT_OUT, renderer = 'hyperframes', quality = 'draft', render = true, reuse = false, onProgress = () => {} } = {}) {
  const dir = path.resolve(out, brief.id);
  await mkdir(dir, { recursive: true });
  const result = { id: brief.id, format: brief.format, label: brief.label, brief: brief.brief, renderer: render ? renderer : null, warnings: [] };
  try {
    onProgress(brief.id, 'stage');
    const staged = await stageSample(brief, path.join(dir, 'project'));
    result.warnings.push(...(staged.warnings ?? []));
    const { runStoryCommand, compileStoryCommand } = await import('../src/story_cli.js');
    const { checkLayoutProject } = await import('../src/layout_check.js');
    const validation = await runStoryCommand('validate', path.join(staged.project, 'storyboard.json'), {});
    result.validation = { status: validation.status, errors: validation.errors ?? [] };
    onProgress(brief.id, 'layout');
    const layout = await checkLayoutProject(staged.project);
    const measures = {
      plan: staged.plan,
      evidence: evidenceCoverage(staged.story, { map: staged.map }),
      variety: moduleVariety(staged.story),
      layout: { errors: layout.errors, warnings: (layout.warnings ?? []).length, findings: (layout.findings ?? []).filter((finding) => finding.severity === 'error').slice(0, 5).map((finding) => finding.message) },
      captions: captionHygiene(staged.story, staged.words, { required: CAPTIONS_REQUIRED.includes(brief.format) })
    };
    if (render) {
      onProgress(brief.id, 'render');
      const { getRenderer } = await import('../src/renderers/index.js');
      const { probeVideo } = await import('../src/renderer_eval.js');
      const { readProjectStory } = await import('../src/story_loader.js');
      const video = path.join(dir, `${renderer}.mp4`);
      const storyKey = JSON.stringify(staged.story);
      const keyFile = path.join(dir, `${renderer}.story.json`);
      if (reuse && existsSync(video) && existsSync(keyFile) && (await readFile(keyFile, 'utf8')) === storyKey) result.reused = true;
      else {
        await compileStoryCommand(staged.project, { renderer, ...(renderer === 'hyperframes' ? { out: path.join(staged.project, 'hyperframes') } : {}) });
        const started = Date.now();
        await getRenderer(renderer).render(renderer === 'hyperframes' ? path.join(staged.project, 'hyperframes') : staged.project, video, { quality });
        result.render_seconds = Math.round((Date.now() - started) / 100) / 10;
        await writeFile(keyFile, storyKey);
      }
      result.video = path.relative(path.resolve(out), video);
      onProgress(brief.id, 'measure');
      const probe = await probeVideo(video);
      const duration = probe.video_duration;
      const scores = await sceneScores(video);
      const sampled = await sceneScores(video, SOFT_EVENT_FPS);
      const scenes = {}, soft = {};
      for (const threshold of SCENE_THRESHOLDS) { scenes[threshold] = scenesAbove(scores, threshold); soft[threshold] = scenesAbove(sampled, threshold); }
      measures.cadence = renderedCadence(scenes, { duration, format: brief.format });
      measures.soft_cadence = renderedCadence(soft, { duration, format: brief.format });
      measures.motion = motionOnHold(await freezes(video, duration), duration);
      const loaded = await readProjectStory(staged.project);
      const planned = (loaded?.resolved?.scenes ?? []).filter((scene) => scene.track === undefined || scene.track === 0 || scene.insert === true).map((scene) => Number(scene.start));
      measures.sync = avSync(planned, changePeaks(scores), { probe, duration });
      if (loaded?.resolved) measures.states = stateEvents(scores, loaded.resolved);
      result.probe = { duration, fps: probe.fps, frames: probe.frames, width: probe.width, height: probe.height, audio: Boolean(probe.audio) };
      result.scenes = { native: Object.fromEntries(Object.entries(scenes).map(([key, value]) => [key, value.length])), [`${SOFT_EVENT_FPS}fps`]: Object.fromEntries(Object.entries(soft).map(([key, value]) => [key, value.length])) };
      result.contact_sheet = path.relative(path.resolve(out), await contactSheet(video, path.join(dir, 'sheet.jpg'), { duration, portrait: probe.height > probe.width }));
    }
    result.measures = measures;
    result.score = scoreBrief(brief, measures);
  } catch (error) {
    result.error = String(error?.message ?? error).split('\n').slice(0, 8).join('\n');
    result.score = { id: brief.id, format: brief.format, label: brief.label, checks: [], score: 0, status: 'fail' };
  }
  return result;
}

export async function runFormatEval({ formats = null, out = DEFAULT_OUT, renderer = 'hyperframes', quality = 'draft', render = true, reuse = false, onProgress } = {}) {
  const briefs = (await loadBriefs()).filter((brief) => !formats || formats.includes(brief.id) || formats.includes(brief.format));
  if (!briefs.length) throw new Error(`no brief matches ${formats?.join(', ')}`);
  const startedAt = new Date().toISOString();
  const results = [];
  for (const brief of briefs) results.push(await evaluateBrief(brief, { out, renderer, quality, render, reuse, onProgress }));
  const report = { schema: SCORECARD_SCHEMA, started_at: startedAt, finished_at: new Date().toISOString(), renderer: render ? renderer : null, quality, results, rows: results.map((result) => result.score) };
  await mkdir(path.resolve(out), { recursive: true });
  await writeFile(path.resolve(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.resolve(out, 'report.md'), reportMarkdown(report));
  return report;
}

export function reportMarkdown(report) {
  const lines = ['# Format scorecard', '', `Renderer: ${report.renderer ?? 'none (plan only)'}, quality ${report.quality}. ${report.finished_at}.`, '', '```text', formatScorecard(report.rows), '```', ''];
  for (const result of report.results) {
    lines.push(`## ${result.label} (${result.format})`, '', `> ${result.brief}`, '');
    if (result.error) lines.push(`**Error:** ${result.error}`, '');
    if (result.contact_sheet) lines.push(`![${result.id}](${result.contact_sheet})`, '');
    const c = result.measures?.cadence;
    if (c) {
      lines.push('| threshold | events | per min | gap p10 | gap p50 | gap p90 | longest static |', '|---|---|---|---|---|---|---|');
      for (const [threshold, s] of Object.entries(c.thresholds)) lines.push(`| ${threshold} | ${s.events} | ${s.per_min} | ${s.gap.p10 ?? '–'} | ${s.gap.p50 ?? '–'} | ${s.gap.p90 ?? '–'} | ${s.longest_static.seconds} s |`);
      for (const [threshold, s] of Object.entries(result.measures.soft_cadence?.thresholds ?? {})) lines.push(`| ${threshold} at ${SOFT_EVENT_FPS} fps (soft) | ${s.events} | ${s.per_min} | ${s.gap.p10 ?? '–'} | ${s.gap.p50 ?? '–'} | ${s.gap.p90 ?? '–'} | ${s.longest_static.seconds} s |`);
      lines.push('');
    }
    const states = result.measures?.states;
    if (states?.marks?.length) {
      lines.push(`State events (peak scene score per change; median ${states.median}, want ≥ ${states.min}):`, '', '| at | change | peak |', '|---|---|---|');
      for (const mark of states.marks) lines.push(`| ${mark.t} s | ${mark.label} | ${mark.peak >= states.min ? '' : '✗ '}${mark.peak} |`);
      lines.push('');
    }
    for (const check of result.score?.checks ?? []) lines.push(`- ${check.status === 'pass' ? '✓' : check.status === 'warn' ? '~' : check.status === 'fail' ? '✗' : '·'} **${check.id}**: ${typeof check.value === 'object' ? JSON.stringify(check.value) : check.value} (want ${check.want})`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

export function parseArguments(argv) {
  /** @type {{render: boolean, reuse?: boolean, formats?: string[], renderer?: string, quality?: string, out?: string}} */
  const options = { render: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-render') options.render = false;
    else if (arg === '--reuse') options.reuse = true;
    else if (arg === '--formats') options.formats = argv[++i].split(',').map((value) => value.trim()).filter(Boolean);
    else if (arg === '--renderer') options.renderer = argv[++i];
    else if (arg === '--quality') options.quality = argv[++i];
    else if (arg === '--out') options.out = argv[++i];
    else throw new Error(`unknown argument ${arg}; use --formats a,b --renderer hyperframes|remotion --no-render --reuse --quality draft --out dir`);
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const report = await runFormatEval({ ...options, onProgress: (id, step) => process.stderr.write(`  ${id}: ${step}\n`) });
  console.log(formatScorecard(report.rows));
  console.log(`\nreport: ${path.join(options.out ?? DEFAULT_OUT, 'report.md')}`);
  process.exitCode = report.results.some((result) => result.error) ? 1 : 0;
}

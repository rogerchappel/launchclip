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
//
// The animation briefs (docs/ANIMATION_PIPELINE_RFC.md §8.3) are scored from
// finished projects, with no render and no model:
//
//   npm run eval:formats -- --animation --path make|skill --runs <dir>
//     [--project <brief>=<dir>]... [--formats product-fix,pov] [--out dir]
//   npm run eval:formats -- --animation               the stand-in example only
//   npm run eval:formats -- --animation --commands --runs <dir>
//                                                     the six make commands
//
// --runs holds one finished project per brief, in <dir>/<brief id>/;
// --project names one brief's project. A brief with no project is "not run".
// Writes <out>/report.json and report.md (default qa/animation-eval/<path>);
// npm run eval:animation-parity compares the make and skill reports.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beatMapToStory, windowWords } from '@launchclip/core/beat-director.mjs';
import { cadenceGate, cadenceTarget, eventStats } from '@launchclip/core/cadence.mjs';
import { cutShorts } from '@launchclip/core/cutdown.mjs';
import { ANIMATION_SCORECARD_SCHEMA, animationMetrics, formatAnimationScorecard, scoreAnimation } from './animation-metrics.mjs';
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

// ---------------------------------------------------------------------------
// The animation briefs: finished projects, scored from their files.

export const ANIMATION_OUT = path.join('qa', 'animation-eval');
export const ANIMATION_PATHS = Object.freeze(['make', 'skill']);

/** The animation suite in eval/formats.json: {profile, aspect, duration_seconds, briefs}. */
export async function loadAnimationSuite(file = BRIEFS_FILE) {
  const suite = JSON.parse(await readFile(file, 'utf8')).animation;
  if (!suite?.briefs?.length) throw new Error(`${file} has no animation briefs`);
  return suite;
}

// Paths in a report are written from the working directory, so a report can be shared.
const relative = (target) => path.relative(process.cwd(), path.resolve(target)) || '.';

async function readJsonIf(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}

/**
 * Everything the animation metrics read from one finished project: the
 * resolved story and its shot list, the script, the bible, the direction map,
 * and what make, finish and the critic recorded. Throws when the folder has
 * no valid storyboard.json; every other file is optional and read as null.
 */
export async function readAnimationProject(dir) {
  const project = path.resolve(dir);
  const { readProjectStory } = await import('../src/story_loader.js');
  const loaded = await readProjectStory(project);
  if (!loaded) throw new Error(`${project} has no storyboard.json: it is not a finished project`);
  const { runStoryCommand, directionFileFor } = await import('../src/story_cli.js');
  const { shotList } = await import('../src/story_shots.js');
  const { scriptGate } = await import('../src/script_gate.js');
  const { bibleGate } = await import('../src/bible.js');
  const { profileForStory } = await import('../src/profile_store.js');
  const { directionMeasures } = await import('@launchclip/core/direction.mjs');
  const { storyboardMeasures } = await import('@launchclip/core/cadence.mjs');
  const resolved = loaded.resolved, words = loaded.words ?? [];
  const map = await readJsonIf(directionFileFor(loaded.file));
  const script = await readJsonIf(path.join(project, 'SCRIPT.json'));
  const validated = await runStoryCommand('validate', loaded.file, {});
  let profile = null;
  try { profile = profileForStory(resolved, { direction: map, projectDir: project }).profile; } catch { profile = null; }
  let storyMeasures = null;
  try { storyMeasures = map && words.length ? directionMeasures(map, resolved, { words }) : storyboardMeasures(resolved); } catch { storyMeasures = null; }
  return {
    project,
    script,
    shots: shotList(resolved, { map, words, script }).shots,
    duration: Number(resolved?.resolved?.duration ?? resolved?.format?.duration) || null,
    words,
    format: resolved?.format ?? null,
    skeleton: resolved?.skeleton?.id ?? null,
    profile,
    storyMeasures,
    validation: { status: validated.status, errors: validated.errors ?? [], direction: Boolean(map) },
    scriptGate: await scriptGate({ project, resolved, words, profile, script }),
    bibleGate: await bibleGate(project, resolved, { direction: map }),
    bible: await readJsonIf(path.join(project, 'BIBLE.json')),
    make: await readJsonIf(path.join(project, 'MAKE.json')),
    gates: await readJsonIf(path.join(project, 'qa', 'finish', 'gates.json')),
    critic: await readJsonIf(path.join(project, 'qa', 'critic.json')),
    retakes: await readJsonIf(path.join(project, 'qa', 'retakes.json'))
  };
}

/** Score one finished project against one animation brief. */
export async function evaluateAnimationProject(brief, dir, suite = {}) {
  const { project, ...inputs } = await readAnimationProject(dir);
  const metrics = animationMetrics(inputs);
  return { project, metrics, score: scoreAnimation(brief, metrics, suite) };
}

/**
 * The animation scorecard. runs: a folder with one finished project per brief
 * (<runs>/<brief id>/); projects: {<brief id>: dir}, which wins over runs.
 * With neither, the briefs that have a stand-in example are scored from it
 * and marked so. path: "make" or "skill", recorded in the report.
 */
export async function runAnimationEval({ runs = null, projects = {}, path: route = null, formats = null, out = null, file = BRIEFS_FILE, onProgress = () => {} } = {}) {
  if (route && !ANIMATION_PATHS.includes(route)) throw new Error(`--path must be one of ${ANIMATION_PATHS.join(', ')}; got ${route}`);
  const suite = await loadAnimationSuite(file);
  const briefs = suite.briefs.filter((brief) => !formats || formats.includes(brief.id));
  if (!briefs.length) throw new Error(`no animation brief matches ${formats?.join(', ')}; use ${suite.briefs.map((brief) => brief.id).join(', ')}`);
  for (const id of Object.keys(projects)) if (!suite.briefs.some((brief) => brief.id === id)) throw new Error(`--project names the brief "${id}"; use ${suite.briefs.map((brief) => brief.id).join(', ')}`);
  const standIns = !runs && !Object.keys(projects).length;
  if (standIns && route) throw new Error(`--path ${route} needs that path's finished projects: pass --runs <dir> or --project <brief>=<dir>`);
  const startedAt = new Date().toISOString();
  const results = [];
  for (const brief of briefs) {
    const result = { id: brief.id, format: brief.format ?? 'animated', label: brief.label, brief: brief.brief, exercises: brief.exercises ?? [] };
    const named = projects[brief.id] ?? (runs ? path.join(runs, brief.id) : null);
    const dir = named ?? (standIns && brief.stand_in ? path.join(ROOT, brief.stand_in) : null);
    if (!dir || !existsSync(path.join(dir, 'storyboard.json'))) {
      results.push({ ...result, status: 'not-run', reason: dir ? `no finished project at ${relative(dir)} (no storyboard.json)` : 'no project given for this brief' });
      continue;
    }
    onProgress(brief.id, 'measure');
    try {
      const scored = await evaluateAnimationProject(brief, dir, suite);
      results.push({ ...result, status: 'scored', ...(standIns ? { stand_in: brief.stand_in } : {}), project: relative(scored.project), metrics: scored.metrics, score: scored.score });
    } catch (error) {
      results.push({ ...result, status: 'error', project: relative(dir), error: String(error?.message ?? error).split('\n').slice(0, 8).join('\n') });
    }
  }
  const report = { schema: ANIMATION_SCORECARD_SCHEMA, path: route, source: standIns ? 'stand-in examples' : runs ? relative(runs) : 'named projects', profile: suite.profile, aspect: suite.aspect, duration_seconds: suite.duration_seconds, started_at: startedAt, finished_at: new Date().toISOString(), results, rows: results.filter((result) => result.score).map((result) => result.score) };
  const target = path.resolve(out ?? path.join(ANIMATION_OUT, route ?? 'stand-in'));
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(target, 'report.md'), animationReportMarkdown(report));
  return { ...report, out: target };
}

export function animationReportMarkdown(report) {
  const show = (value) => (value === null || value === undefined ? '–' : typeof value === 'object' ? JSON.stringify(value) : String(value));
  const lines = ['# Animation scorecard', '', `Path: ${report.path ?? 'none (stand-in examples, not a run of either path)'}. Projects: ${report.source}. ${report.finished_at}.`, '', `Each brief is a ${report.duration_seconds.join('–')} second ${report.aspect} Short, judged against the ${report.profile} profile. Scored from the finished project's files; nothing was rendered.`, ''];
  lines.push('```text', formatAnimationScorecard(report.results), '```', '');
  for (const result of report.results) {
    lines.push(`## ${result.label} (\`${result.id}\`)`, '', `> ${result.brief}`, '', `Exercises: ${result.exercises.join('; ')}.`, '');
    if (result.status === 'not-run') { lines.push(`**Not run:** ${result.reason}.`, ''); continue; }
    if (result.status === 'error') { lines.push(`**Error:** ${result.error}`, ''); continue; }
    if (result.stand_in) lines.push(`**Stand-in:** scored from the hand-authored example \`${result.stand_in}\`, not from a run of this brief. It shows the scorecard working; it says nothing about either path.`, '');
    const m = result.metrics;
    lines.push(`Project: \`${result.project}\`. ${show(m.video.duration_seconds)} s, ${show(m.video.aspect)}${m.video.skeleton ? `, skeleton ${m.video.skeleton}` : ''}.`, '');
    lines.push('| | |', '|---|---|');
    lines.push(`| contracts | ${Object.entries(m.contracts).map(([name, entry]) => `${name} ${entry.status}${entry.repairs ? ` (${entry.repairs} repair${entry.repairs === 1 ? '' : 's'})` : ''}`).join(', ')} |`);
    if (m.story) lines.push(`| story | ${m.story.characters} characters; ${m.story.spoken_lines} spoken and ${m.story.silent_lines} silent lines (${show(m.story.silent_share)} silent); lines ${Object.entries(m.story.lines_per_character).map(([id, count]) => `${id} ${count}`).join(', ')}; problem lands at ${show(m.story.problem_lands_seconds)} s |`);
    lines.push(`| design | ${m.design ? `${m.design.characters} characters in the bible; must_keep ${m.design.must_keep_distinct === null ? 'n/a' : m.design.must_keep_distinct ? 'differs for each' : 'shared by two characters'}` : 'no show bible'} |`);
    if (m.direction) lines.push(`| direction | ${m.direction.shots} shots; ${m.direction.actions_per_min} actions/min; ${m.direction.poses} poses, ${m.direction.expressions} expressions; framings ${m.direction.framings_used.join(', ') || 'none'}; ${show(m.direction.reaction_line_share)} of lines on a reaction |`);
    lines.push(`| gates | ${m.gates ? `${m.gates.passed.length} passed${m.gates.failed.length ? `; failed: ${m.gates.failed.join(', ')}` : ''}` : 'not recorded (no qa/finish/gates.json)'} |`);
    lines.push(`| critic | ${m.critic ? `${show(m.critic.verdict)}; ${m.critic.blocking} blocking, ${m.critic.major} major; retake rounds ${show(m.critic.retake_rounds)}` : 'not recorded (no qa/critic.json)'} |`);
    lines.push(`| cost | ${m.cost ? `${show(m.cost.estimated_usd)} USD${m.cost.complete === false ? ' (incomplete)' : ''}; ${show(m.cost.seconds)} s` : 'not recorded (no MAKE.json)'} |`, '');
    if (m.cadence) {
      lines.push(`Cadence against ${show(m.cadence.profile)}${m.cadence.provenance === 'seed' ? ' (a seed profile: hand-set bands, not measured)' : ''}:`, '', '| measure | value | band | |', '|---|---|---|---|');
      for (const band of m.cadence.bands) lines.push(`| ${band.measure} | ${show(band.value)} | ${band.band[0] ?? ''}–${band.band[1] ?? ''} | ${band.status === 'inside' ? '' : band.status} |`);
      lines.push('');
    }
    for (const check of result.score.checks) lines.push(`- ${check.status === 'pass' ? '✓' : check.status === 'warn' ? '~' : check.status === 'fail' ? '✗' : '·'} **${check.id}**: ${show(check.value)} (want ${check.want})`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/** The make command for each brief, writing its project where --runs will read it. */
export function animationCommands(suite, runs) {
  return suite.briefs.map((brief) => `launchclip make ${JSON.stringify(brief.brief)} --animation --aspect ${suite.aspect} --out ${path.join(runs, brief.id)}`);
}

export function parseArguments(argv) {
  /** @type {{render: boolean, reuse?: boolean, formats?: string[], renderer?: string, quality?: string, out?: string, animation?: boolean, commands?: boolean, runs?: string, path?: string, projects?: Record<string, string>}} */
  const options = { render: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-render') options.render = false;
    else if (arg === '--animation') options.animation = true;
    else if (arg === '--commands') options.commands = true;
    else if (arg === '--runs') options.runs = argv[++i];
    else if (arg === '--path') options.path = argv[++i];
    else if (arg === '--project') {
      const [id, ...rest] = String(argv[++i] ?? '').split('=');
      if (!id || !rest.length) throw new Error('--project takes <brief id>=<project dir>');
      options.projects = { ...(options.projects ?? {}), [id]: rest.join('=') };
    }
    else if (arg === '--reuse') options.reuse = true;
    else if (arg === '--formats') options.formats = argv[++i].split(',').map((value) => value.trim()).filter(Boolean);
    else if (arg === '--renderer') options.renderer = argv[++i];
    else if (arg === '--quality') options.quality = argv[++i];
    else if (arg === '--out') options.out = argv[++i];
    else throw new Error(`unknown argument ${arg}; use --formats a,b --renderer hyperframes|remotion --no-render --reuse --quality draft --out dir, or --animation [--path make|skill] [--runs dir] [--project brief=dir] [--commands]`);
  }
  if (!options.animation && (options.runs || options.path || options.projects || options.commands)) throw new Error('--runs, --path, --project and --commands go with --animation');
  return options;
}

async function animationMain(options) {
  if (options.commands) {
    if (!options.runs) throw new Error('--commands needs --runs <dir>: where the six projects are written');
    console.log(animationCommands(await loadAnimationSuite(), options.runs).join('\n'));
    return 0;
  }
  const report = await runAnimationEval({ runs: options.runs, projects: options.projects, path: options.path, formats: options.formats, out: options.out, onProgress: (id, step) => process.stderr.write(`  ${id}: ${step}\n`) });
  console.log(formatAnimationScorecard(report.results));
  for (const result of report.results) if (result.status === 'error') console.log(`${result.id}: error: ${result.error}`);
  if (report.results.some((result) => result.stand_in)) console.log('\nstand-in examples only: this is not a run of either path');
  console.log(`\nreport: ${path.join(path.relative(process.cwd(), report.out), 'report.md')}`);
  return report.results.some((result) => result.status === 'error') ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  if (options.animation) process.exit(await animationMain(options).catch((error) => { process.stderr.write(`eval:formats --animation: ${error.message}\n`); return 2; }));
  const report = await runFormatEval({ ...options, onProgress: (id, step) => process.stderr.write(`  ${id}: ${step}\n`) });
  console.log(formatScorecard(report.rows));
  console.log(`\nreport: ${path.join(options.out ?? DEFAULT_OUT, 'report.md')}`);
  process.exitCode = report.results.some((result) => result.error) ? 1 : 0;
}

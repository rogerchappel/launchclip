#!/usr/bin/env node
// Renderer parity harness (docs/KIT_CONTRACTS.md, "Parity harness").
//
//   node scripts/parity.mjs <fixture.json> [--out qa/parity/<id>]
//     [--times enter,settle,mid,events,exit | 1.2,3.4] [--entry <remotion entry>]
//     [--compiler auto|story|internal] [--keep]
//
// A fixture is {story, sceneId, threshold?: {ssim: 0.97}}. The harness renders
// that one scene with HyperFrames (`hyperframes snapshot` of a temporary
// project) and with Remotion (`remotion still` of ModuleReview), compares each
// sampled time with ffmpeg ssim and psnr, and writes report.json plus
// side-by-side PNGs (HyperFrames left, Remotion right) and difference PNGs.
//
// HyperFrames project: kit/hyperframes/story-compiler.mjs when it is present
// (the story filtered to the one scene), otherwise a small internal builder
// that places the module's emitter html/css/motion on a GSAP 3.14.2 timeline.
// Pass `compileHyperFrames` to runParity() to plug in another compiler.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {injectParityFonts} from './parity-fonts.mjs';
import {editorialSpecFromScene, sceneDuration} from './parity-scene.mjs';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HYPERFRAMES_CLI = path.join(path.dirname(require.resolve('hyperframes/package.json')), require('hyperframes/package.json').bin?.hyperframes ?? 'dist/cli.js');
const REMOTION_CLI = path.join(path.dirname(require.resolve('@remotion/cli/package.json')), 'remotion-cli.js');
const GSAP_MIN = path.join(path.dirname(require.resolve('gsap/package.json')), 'dist', 'gsap.min.js');
export const DEFAULT_THRESHOLD = {ssim: .97};
export const DEFAULT_ENTRY = path.join(ROOT, 'kit', 'remotion', 'entry.tsx');
const STORY_COMPILER = path.join(ROOT, 'kit', 'hyperframes', 'story-compiler.mjs');
const MODULES = path.join(ROOT, 'kit', 'core', 'modules.mjs');

// ---------------------------------------------------------------------------
// Process helpers

function run(command, args, {cwd = ROOT, env} = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, {cwd, env: {...process.env, ...env}, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => resolve({code: -1, stdout, stderr: stderr + error.message}));
    child.on('close', code => resolve({code, stdout, stderr}));
  });
}
async function must(label, command, args, options) {
  const result = await run(command, args, options);
  if (result.code !== 0) throw new Error(`${label} failed (exit ${result.code}):\n${(result.stderr || result.stdout).slice(-4000)}`);
  return result;
}
const tryImport = async file => (existsSync(file) ? import(pathToFileURL(file).href) : null);

// ---------------------------------------------------------------------------
// Story, scene and model

export async function loadFixture(fixturePath) {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  if (!fixture.story || !fixture.sceneId) throw new Error(`${fixturePath}: a parity fixture needs {story, sceneId}`);
  return fixture;
}

/** Resolve anchors (when kit/core/story.mjs can) and keep only the reviewed scene. */
export async function sceneStory(story, sceneId) {
  let resolved = story;
  const storyModule = await tryImport(path.join(ROOT, 'kit', 'core', 'story.mjs'));
  if (storyModule?.resolveStory) {
    try { resolved = storyModule.resolveStory(story); } catch { resolved = structuredClone(story); }
  }
  const scene = resolved.scenes?.find(item => item.id === sceneId);
  if (!scene) throw new Error(`scene ${sceneId} not found in the fixture story`);
  // One module on the background: no captions, audio or ending, so the lane's
  // audio requirements (voiceover-motion needs audio.words) no longer apply.
  // Ambient motion is off: ModuleReview draws the bare module, and story
  // parity (runStoryParity) covers the ambient field and drift.
  const filtered = {...structuredClone(resolved), lane: 'motion', ambient: 'off', scenes: [structuredClone(scene)], overlays: []};
  delete filtered.ending;
  delete filtered.audio;
  return {story: filtered, scene: filtered.scenes[0]};
}

export async function resolveSceneModel(scene, story) {
  const modules = await tryImport(MODULES);
  if (modules?.resolveModule) return modules.resolveModule(scene, story);
  const {resolveEditorialModule} = await import(pathToFileURL(path.join(ROOT, 'kit', 'core', 'editorial-core.mjs')).href);
  return resolveEditorialModule(editorialSpecFromScene(scene, story));
}

// ---------------------------------------------------------------------------
// Sample times

const GROUPS = ['enter', 'settle', 'mid', 'events', 'exit'];

/**
 * Default samples: enter-mid, enterEnd, the mid hold, each event + 0.4 s, exit
 * mid and end - 0.05, quantized to whole frames and kept inside the scene.
 */
export function sampleTimes(model, {fps = 30, times} = {}) {
  const m = model.motion;
  const quantize = time => Math.round(time * fps) / fps;
  const wanted = times ? String(times).split(',').map(token => token.trim()).filter(Boolean) : GROUPS;
  const samples = [];
  const add = (name, time) => samples.push({name, time});
  for (const token of wanted) {
    if (/^\d+(\.\d+)?$/.test(token)) { add(`t${token}`, Number(token)); continue; }
    if (token === 'enter') add('enter-mid', m.enterStart + (m.enterEnd - m.enterStart) / 2);
    else if (token === 'settle') add('enter-end', m.enterEnd);
    else if (token === 'mid') add('mid-hold', m.enterEnd + (m.exitStart - m.enterEnd) / 2);
    else if (token === 'events') for (const event of model.events ?? []) add(`event-${event.id}`, event.time + .4);
    else if (token === 'exit') { add('exit-mid', m.exitStart + (m.end - m.exitStart) / 2); add('end', m.end - .05); }
    else throw new Error(`unknown --times entry ${token}; use ${GROUPS.join(', ')} or seconds`);
  }
  const lastFrame = Math.ceil(model.end * fps) - 1;
  const seen = new Set();
  return samples
    .map(sample => ({...sample, time: quantize(Math.min(Math.max(sample.time, model.start), lastFrame / fps))}))
    .filter(sample => (seen.has(sample.time) ? false : seen.add(sample.time)))
    .sort((a, b) => a.time - b.time);
}

// ---------------------------------------------------------------------------
// HyperFrames

async function emitterFor(model, spec) {
  const kit = await tryImport(path.join(ROOT, 'kit', 'hyperframes', 'editorial-ui-modules.mjs'));
  if (kit?.EMITTERS?.[model.kind ?? model.module]) return kit.EMITTERS[model.kind ?? model.module](model);
  const skill = await import(pathToFileURL(path.join(ROOT, 'skills', 'launchclip-create-video', 'scripts', 'editorial-ui-modules.mjs')).href);
  return skill.buildEditorialModule(spec);
}

/** Minimal single-module HyperFrames project (standalone-hyperframes.md assembly). */
export async function buildInternalProject({story, scene, model, projectDir}) {
  const {width, height, duration} = story.format;
  const bg = story.brand?.colors?.bg ?? '#000000';
  const fragment = await emitterFor(model, editorialSpecFromScene(scene, story));
  await mkdir(projectDir, {recursive: true});
  await copyFile(GSAP_MIN, path.join(projectDir, 'gsap.min.js'));
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${width}, initial-scale=1">
<title>parity ${scene.id}</title>
<script src="gsap.min.js"></script>
<style>html,body{margin:0;padding:0;background:${bg}}#main{position:relative;width:${width}px;height:${height}px;overflow:hidden}#main>.parity-bg{position:absolute;inset:0;background:${bg}}${fragment.css}</style>
</head>
<body>
<div id="main" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
<div class="parity-bg"></div>
${fragment.html}
</div>
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({paused: true});
${fragment.motion}
window.__timelines["main"] = tl;
</script>
</body>
</html>
`;
  await writeFile(path.join(projectDir, 'index.html'), html);
  await injectParityFonts(story, projectDir);
  return {compiler: 'internal', projectDir};
}

/** Default compileHyperFrames: kit/hyperframes/story-compiler.mjs when present, else the internal builder. */
export async function defaultCompileHyperFrames(context, {compiler = 'auto'} = {}) {
  if (compiler !== 'internal') {
    const module = await tryImport(STORY_COMPILER);
    const compile = module && ['compileStoryToHyperFrames', 'compileStoryProject', 'compileStoryToProject', 'writeStoryProject', 'compileProject', 'compileStory', 'default'].map(name => module[name]).find(fn => typeof fn === 'function');
    if (compile) {
      try {
        await mkdir(context.projectDir, {recursive: true});
        await writeFile(path.join(context.projectDir, 'storyboard.json'), `${JSON.stringify(context.story, null, 2)}\n`);
        const result = await compile(context.story, {projectDir: context.projectDir, outDir: context.projectDir, dir: context.projectDir});
        const html = typeof result === 'string' ? result : result?.html;
        if (typeof html === 'string' && !existsSync(path.join(context.projectDir, 'index.html'))) await writeFile(path.join(context.projectDir, 'index.html'), html);
        if (existsSync(path.join(context.projectDir, 'index.html'))) {
          const assets = path.join(path.dirname(context.fixturePath ?? ROOT), 'assets');
          if (existsSync(assets)) await must('copy assets', 'cp', ['-R', assets, context.projectDir]);
          return {compiler: 'story-compiler', projectDir: context.projectDir};
        }
        throw new Error('story compiler did not produce index.html');
      } catch (error) {
        if (compiler === 'story') throw error;
        context.warnings.push(`story-compiler failed, used the internal builder: ${error.message}`);
      }
    } else if (compiler === 'story') throw new Error(`no usable story compiler at ${STORY_COMPILER}`);
  }
  return buildInternalProject(context);
}

export async function hyperframesStills(projectDir, samples, outDir) {
  const frames = await mkdtemp(path.join(os.tmpdir(), 'launchclip-parity-hf-'));
  try {
    const at = samples.map(sample => String(Math.round((sample.time + 1e-4) * 1e6) / 1e6)).join(','); // snapshot floors seconds × fps
    await must('hyperframes snapshot', process.execPath, [HYPERFRAMES_CLI, 'snapshot', '--at', at, '--no-end', '--output', frames, '--describe', 'false', projectDir], {cwd: projectDir});
    const files = (await readdir(frames)).filter(name => /^frame-\d+.*\.(png|jpe?g|webp)$/i.test(name)).sort((a, b) => a.localeCompare(b, 'en', {numeric: true}));
    if (files.length !== samples.length) throw new Error(`hyperframes snapshot wrote ${files.length} frames for ${samples.length} times: ${files.join(', ')}`);
    const outputs = [];
    for (const [i, sample] of samples.entries()) {
      const target = path.join(outDir, `${sample.name}.hyperframes.png`);
      await copyFile(path.join(frames, files[i]), target);
      outputs.push(target);
    }
    return outputs;
  } finally {
    await rm(frames, {recursive: true, force: true});
  }
}

// ---------------------------------------------------------------------------
// Remotion

/**
 * Bundle a Remotion entry once. publicDir is the directory staticFile()
 * resolves against (the fixture directory, so assets/… resolve as in
 * HyperFrames). Pass the result to runParity({bundle}) to reuse it.
 */
export async function bundleRemotion(entry, outDir, {publicDir} = {}) {
  const args = [REMOTION_CLI, 'bundle', entry, '--out-dir', outDir, '--log', 'error'];
  if (publicDir) args.push('--public-dir', publicDir);
  await must('remotion bundle', process.execPath, args);
  return outDir;
}

export async function remotionStills({entry, scene, story, samples, outDir, workDir, bundle: prebuilt, publicDir}) {
  await writeFile(path.join(workDir, 'props.json'), JSON.stringify({scene, story}));
  const bundle = prebuilt ?? await bundleRemotion(entry, path.join(workDir, 'bundle'), {publicDir});
  // One browser for the composition lookup and every still (the same
  // renderStill() that `remotion still` runs, without a launch per frame).
  const {openBrowser, selectComposition, renderStill} = await import('@remotion/renderer');
  const inputProps = {scene, story};
  const browser = await openBrowser('chrome');
  try {
    const composition = await selectComposition({serveUrl: bundle, id: 'ModuleReview', inputProps, puppeteerInstance: browser, logLevel: 'error'});
    // ModuleReview may span the scene (frame 0 = scene start) or the story.
    const fps = composition.fps;
    const base = composition.durationInFrames === Math.round(sceneDuration(scene) * fps) ? scene.start : 0;
    const outputs = [];
    for (const sample of samples) {
      const frame = Math.min(Math.round((sample.time - base) * fps), composition.durationInFrames - 1);
      const target = path.join(outDir, `${sample.name}.remotion.png`);
      await renderStill({serveUrl: bundle, composition, inputProps, frame, output: target, imageFormat: 'png', puppeteerInstance: browser, logLevel: 'error'});
      outputs.push({file: target, frame});
    }
    return {outputs, frameBase: base, fps};
  } finally {
    await browser.close({silent: true}).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Compare

export async function compareStills(a, b) {
  const result = await must('ffmpeg compare', 'ffmpeg', ['-hide_banner', '-nostats', '-i', a, '-i', b, '-filter_complex',
    '[0:v]format=rgb24,split[a0][a1];[1:v]format=rgb24,split[b0][b1];[a0][b0]ssim;[a1][b1]psnr', '-f', 'null', '-']);
  const text = result.stderr;
  const ssim = Number(/SSIM .*All:([0-9.]+)/.exec(text)?.[1]);
  const psnrRaw = /PSNR .*average:([0-9.]+|inf)/.exec(text)?.[1];
  const psnr = psnrRaw === 'inf' ? Infinity : Number(psnrRaw);
  if (!Number.isFinite(ssim)) throw new Error(`could not read ffmpeg ssim output:\n${text.slice(-2000)}`);
  return {ssim, psnr};
}

async function sideBySide(a, b, sideFile, diffFile) {
  await must('ffmpeg hstack', 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', a, '-i', b, '-filter_complex', '[0:v]format=rgb24[a];[1:v]format=rgb24[b];[a][b]hstack=inputs=2', '-frames:v', '1', sideFile]);
  await must('ffmpeg difference', 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', a, '-i', b, '-filter_complex', '[0:v]format=gbrp[a];[1:v]format=gbrp[b];[a][b]blend=all_mode=difference,lutrgb=r=val*4:g=val*4:b=val*4', '-frames:v', '1', diffFile]);
}

// ---------------------------------------------------------------------------
// Orchestration

export async function runParity(fixturePath, {out, times, entry, compiler = 'auto', keep = false, compileHyperFrames, bundle} = {}) {
  const fixture = await loadFixture(fixturePath);
  const {story, scene} = await sceneStory(fixture.story, fixture.sceneId);
  const model = await resolveSceneModel(scene, story);
  const fps = story.resolved?.fps ?? story.format.fps ?? 30;
  const threshold = {...DEFAULT_THRESHOLD, ...(fixture.threshold ?? {})};
  const id = path.basename(fixturePath).replace(/\.json$/, '');
  const outDir = path.resolve(out ?? path.join(ROOT, 'qa', 'parity', id));
  const remotionEntry = path.resolve(entry ?? DEFAULT_ENTRY);
  if (!existsSync(remotionEntry)) throw new Error(`Remotion entry not found: ${remotionEntry}. Pass --entry <file> until kit/remotion/entry.tsx exists.`);
  await mkdir(outDir, {recursive: true});
  const workDir = await mkdtemp(path.join(os.tmpdir(), `launchclip-parity-${id}-`));
  const warnings = [];
  try {
    const samples = sampleTimes(model, {fps, times});
    const context = {fixturePath: path.resolve(fixturePath), story, scene, model, projectDir: path.join(workDir, 'hyperframes'), warnings};
    const compiled = compileHyperFrames ? await compileHyperFrames(context) : await defaultCompileHyperFrames(context, {compiler});
    const hf = await hyperframesStills(compiled.projectDir ?? context.projectDir, samples, outDir);
    const rm = await remotionStills({entry: remotionEntry, scene, story, samples, outDir, workDir, bundle, publicDir: path.dirname(path.resolve(fixturePath))});
    const results = [];
    for (const [i, sample] of samples.entries()) {
      const metrics = await compareStills(hf[i], rm.outputs[i].file);
      const sideFile = path.join(outDir, `${sample.name}.side-by-side.png`), diffFile = path.join(outDir, `${sample.name}.diff.png`);
      await sideBySide(hf[i], rm.outputs[i].file, sideFile, diffFile);
      results.push({name: sample.name, time: sample.time, remotionFrame: rm.outputs[i].frame, ssim: metrics.ssim, psnr: metrics.psnr, pass: metrics.ssim >= threshold.ssim,
        hyperframes: path.relative(outDir, hf[i]), remotion: path.relative(outDir, rm.outputs[i].file), sideBySide: path.relative(outDir, sideFile), diff: path.relative(outDir, diffFile)});
    }
    const report = {fixture: path.relative(ROOT, path.resolve(fixturePath)), sceneId: scene.id, module: model.kind ?? model.module, threshold,
      hyperframes: {compiler: compiled.compiler ?? 'custom'}, remotion: {entry: path.relative(ROOT, remotionEntry), frameBase: rm.frameBase, fps: rm.fps},
      minSsim: Math.min(...results.map(item => item.ssim)), minPsnr: Math.min(...results.map(item => item.psnr)),
      pass: results.every(item => item.pass), warnings, samples: results};
    await writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, (key, value) => (value === Infinity ? 'inf' : value), 2)}\n`);
    if (keep) report.workDir = workDir;
    return {...report, outDir};
  } finally {
    if (!keep) await rm(workDir, {recursive: true, force: true});
  }
}

// ---------------------------------------------------------------------------
// Whole-story parity: a storyboard project through both renderer adapters

/**
 * Compile a storyboard project (storyboard.json + assets/) with both
 * renderers and compare full-frame stills at the given story times: captions,
 * transitions, plates and every module together.
 *   → {project, threshold, minSsim, pass, samples:[{name, time, ssim, psnr, pass, …}], outDir}
 */
export async function runStoryParity(projectDir, {times = [1, 3.2], out, threshold = DEFAULT_THRESHOLD.ssim, keep = false} = {}) {
  const {getRenderer} = await import(pathToFileURL(path.join(ROOT, 'src', 'renderers', 'index.js')).href);
  const {compileStoryToHyperFrames} = await import(pathToFileURL(STORY_COMPILER).href);
  const {readProjectStory} = await import(pathToFileURL(path.join(ROOT, 'src', 'story_loader.js')).href);
  const source = path.resolve(projectDir);
  const id = path.basename(source);
  const outDir = path.resolve(out ?? path.join(ROOT, 'qa', 'parity', `story-${id}`));
  await mkdir(outDir, {recursive: true});
  const workDir = await mkdtemp(path.join(os.tmpdir(), `launchclip-parity-story-${id}-`));
  try {
    // Work on a copy: the Remotion adapter writes .launchclip/ into the project.
    const project = path.join(workDir, 'project');
    await must('copy project', 'cp', ['-R', source, project]);
    const loaded = await readProjectStory(project);
    const hfDir = path.join(workDir, 'hyperframes');
    const compiled = await compileStoryToHyperFrames(loaded.resolved, {projectDir: hfDir, sourceDir: project});
    const hyperframes = getRenderer('hyperframes'), remotion = getRenderer('remotion');
    const samples = [];
    for (const time of times) {
      const name = `t${time}`;
      const hf = path.join(outDir, `${name}.hyperframes.png`), rmFile = path.join(outDir, `${name}.remotion.png`);
      await hyperframes.still(hfDir, time, hf);
      await remotion.still(project, time, rmFile);
      const metrics = await compareStills(hf, rmFile);
      const sideFile = path.join(outDir, `${name}.side-by-side.png`), diffFile = path.join(outDir, `${name}.diff.png`);
      await sideBySide(hf, rmFile, sideFile, diffFile);
      samples.push({name, time, ssim: metrics.ssim, psnr: metrics.psnr, pass: metrics.ssim >= threshold,
        hyperframes: path.basename(hf), remotion: path.basename(rmFile), sideBySide: path.basename(sideFile), diff: path.basename(diffFile)});
    }
    const report = {project: path.relative(ROOT, source), threshold: {ssim: threshold}, warnings: compiled.warnings,
      minSsim: Math.min(...samples.map(item => item.ssim)), pass: samples.every(item => item.pass), samples};
    await writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, (key, value) => (value === Infinity ? 'inf' : value), 2)}\n`);
    return {...report, outDir};
  } finally {
    if (!keep) await rm(workDir, {recursive: true, force: true});
  }
}

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith('--') ? arg.split(/=(.*)/s) : [arg];
    const value = () => inline ?? argv[++i];
    if (flag === '--out') options.out = value();
    else if (flag === '--times') options.times = value();
    else if (flag === '--entry') options.entry = value();
    else if (flag === '--compiler') options.compiler = value();
    else if (flag === '--keep') options.keep = true;
    else if (flag.startsWith('--')) throw new Error(`unknown option ${flag}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) throw new Error('Usage: node scripts/parity.mjs <fixture.json> [--out dir] [--times enter,settle,mid,events,exit] [--entry file] [--compiler auto|story|internal] [--keep]');
  return {fixture: positional[0], options};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const {fixture, options} = parseArgs(process.argv.slice(2));
    const report = await runParity(fixture, options);
    for (const sample of report.samples) process.stdout.write(`${sample.pass ? 'ok  ' : 'FAIL'} ${sample.name.padEnd(36)} t=${sample.time.toFixed(3)} ssim=${sample.ssim.toFixed(4)} psnr=${Number.isFinite(sample.psnr) ? sample.psnr.toFixed(2) : 'inf'}\n`);
    process.stdout.write(`${report.pass ? 'PASS' : 'FAIL'} ${report.fixture} min ssim ${report.minSsim.toFixed(4)} (threshold ${report.threshold.ssim}) → ${path.relative(process.cwd(), report.outDir)}/report.json\n`);
    for (const warning of report.warnings) process.stderr.write(`warning: ${warning}\n`);
    process.exitCode = report.pass ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

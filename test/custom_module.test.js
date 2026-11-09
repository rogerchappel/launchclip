// Custom modules in both renderers (docs/KIT_CONTRACTS.md, "Custom modules"):
// the story contract, the HyperFrames HTML form (kit/hyperframes/custom-module.mjs),
// the check before a render, and a real render of one module through both
// renderers (a media test).
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {CUSTOM_RENDERERS, customModuleGaps, customSource, customSources} from '@launchclip/core/custom-modules.mjs';
import {validateStory} from '@launchclip/core/story.mjs';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';
import {customModuleProblems, emitCustom, customModel, lintCustomFragment, parseCustomFragment} from '../kit/hyperframes/custom-module.mjs';
import {readProjectStory} from '../src/story_loader.js';
import {mediaSkip} from './helpers/media.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROJECT = path.join(ROOT, 'test', 'fixtures', 'custom-module', 'project');
const ENTRY = path.join(ROOT, 'test', 'fixtures', 'custom-module', 'entry.tsx');
const base = () => ({schema: 'launchclip.story.v1', lane: 'motion', format: {width: 1080, height: 1920, fps: 30, duration: 4},
  brand: {colors: {bg: '#0b1116', primary: '#5fc4c4', paper: '#f2eee6', ink: '#0b1116'}, fonts: {display: 'anton'}},
  scenes: [{id: 's1', module: 'custom', start: 0, end: 4, source: {remotion: 'remotion/Hero.tsx', hyperframes: 'hyperframes/hero.html'}, params: {component: 'Hero'}}]});

test('story contract: a custom scene names one source, or one per renderer', () => {
  assert.deepEqual(CUSTOM_RENDERERS, ['remotion', 'hyperframes']);
  const story = base();
  const both = validateStory(story);
  assert.equal(both.ok, true, both.errors.join('\n'));
  assert.match(both.warnings.join('\n'), /uses a custom module \(remotion: remotion\/Hero\.tsx, hyperframes: hyperframes\/hero\.html\)/);
  assert.deepEqual(customSources(story.scenes[0].source), {remotion: 'remotion/Hero.tsx', hyperframes: 'hyperframes/hero.html'});
  // The original form, one path, is the Remotion component.
  assert.deepEqual(customSources('modules/Hero.tsx'), {remotion: 'modules/Hero.tsx', hyperframes: null});
  assert.equal(customSource({module: 'metric', source: 'x'}, 'remotion'), null);
  const bad = (source) => validateStory({...story, scenes: [{...story.scenes[0], source}]}).errors.join('\n');
  assert.match(bad({}), /scenes\[0\]\.source needs a path for remotion or hyperframes/);
  assert.match(bad({web: 'x.html'}), /scenes\[0\]\.source has unknown key web; use remotion and hyperframes/);
  assert.match(bad({hyperframes: '../hero.html'}), /scenes\[0\]\.source\.hyperframes must be a project-relative path/);
  assert.match(bad({hyperframes: 'hyperframes/hero.mjs'}), /scenes\[0\]\.source\.hyperframes must be an \.html fragment/);
});

test('a custom scene with no form for the renderer is a named gap, in either direction', () => {
  const story = base();
  assert.deepEqual(customModuleGaps(story, 'hyperframes'), []);
  assert.deepEqual(customModuleGaps(story, 'remotion'), []);
  story.scenes[0].source = 'remotion/Hero.tsx';
  const [gap] = customModuleGaps(story, 'hyperframes');
  assert.equal(gap.id, 's1');
  assert.match(gap.reason, /^scene "s1": the custom module "Hero" has no hyperframes form \(only a remotion one, remotion\/Hero\.tsx\); add an HTML fragment at source\.hyperframes, render with --renderer remotion, or use a catalogue module$/);
  story.scenes[0].source = {hyperframes: 'hyperframes/hero.html'};
  assert.match(customModuleGaps(story, 'remotion')[0].reason, /has no remotion form \(only a hyperframes one, hyperframes\/hero\.html\); add a React component at source\.remotion, render with --renderer hyperframes/);
});

test('a fragment splits into markup, nested styles and timeline scripts', () => {
  const fragment = parseCustomFragment('<!-- note --><style>.a { color: red; }</style>\n<div class="a"></div>\n<script>tl.to(root, {opacity: 1}, scene.start);</script>');
  assert.deepEqual(fragment, {html: '<div class="a"></div>', css: '.a { color: red; }', scripts: ['tl.to(root, {opacity: 1}, scene.start);']});
  const story = base();
  const model = customModel(story.scenes[0], story, {track: 3});
  assert.deepEqual([model.module, model.start, model.end, model.duration, model.track, model.hidesCaptions], ['custom', 0, 4, 4, 3, false]);
  assert.deepEqual(model.rect, {x: 0, y: 0, width: 1080, height: 1920});
  assert.equal(model.layout.drift, false);
  const out = emitCustom(model, fragment, {scene: story.scenes[0], story});
  assert.match(out.html, /^<section id="lc-custom-s1" class="clip lc-custom" data-start="0" data-duration="4" data-track-index="3" data-launchclip-custom="Hero" style="position:absolute;left:0;top:0;width:1080px;height:1920px;overflow:hidden;--lc-bg:#0b1116;--lc-primary:#5fc4c4;--lc-paper:#f2eee6;--lc-ink:#0b1116;--lc-font-display:[^"]*Anton[^"]*"><div class="a"><\/div><\/section>$/);
  // Nested under the scene root, so the rules cannot reach the rest of the story.
  assert.equal(out.css, '#lc-custom-s1 {\n.a { color: red; }\n}');
  assert.match(out.motion, /^\(\(root, scene, params, brand, format, model\) => \{\ntl\.to\(root, \{opacity: 1\}, scene\.start\);\n\}\)\(document\.getElementById\("lc-custom-s1"\), \{"id":"s1","start":0,"end":4,"duration":4\}, \{"component":"Hero"\}, /);
  assert.deepEqual(out.events, []);
});

test('a fragment that is not a pure function of time, or reaches outside the project, is refused', () => {
  const ok = '<div class="a"></div><script>tl.fromTo(root.querySelector(".a"), {x: 0}, {x: 10, duration: 1}, scene.start);</script>';
  assert.deepEqual(lintCustomFragment(ok), []);
  const cases = [
    ['<script>root.style.left = Math.random() + "px";</script>', /Math\.random/],
    ['<script>const now = Date.now();</script>', /a clock/],
    ['<script>setTimeout(() => {}, 100);</script>', /a timer/],
    ['<script>requestAnimationFrame(() => {});</script>', /a timer/],
    ['<script>fetch("data.json");</script>', /a network request/],
    ['<script src="https://example.com/x.js"></script>', /an external script/],
    ['<img src="https://example.com/a.png">', /a remote URL/],
    ['<style>.a { background: url(//example.com/a.png); }</style><p class="a"></p>', /a remote url\(\)/],
    ['<style>.a { transition: opacity 1s; }</style><p class="a"></p>', /a CSS animation or transition/],
    ['<style>@keyframes spin { to { rotate: 1turn; } }</style><p></p>', /a CSS animation or transition/],
    ['<iframe></iframe>', /an <iframe>/],
    ['<html><body><p>x</p></body></html>', /a whole document/],
    ['<!-- nothing -->', /is empty/]
  ];
  for (const [text, pattern] of cases) assert.match(lintCustomFragment(text).join('; '), pattern, text);
  // A project asset is fine.
  assert.deepEqual(lintCustomFragment('<img src="assets/logo.svg" alt="">'), []);
});

test('the check before a render names the scene, the renderer and what is wrong', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'launchclip-custom-'));
  try {
    const story = base();
    assert.match((await customModuleProblems(story, {sourceDir: dir}))[0].reason, /^scene "s1": the hyperframes form of its custom module \(hyperframes\/hero\.html\) was not found in the project$/);
    await mkdir(path.join(dir, 'hyperframes'));
    await writeFile(path.join(dir, 'hyperframes', 'hero.html'), '<p>x</p><script>Math.random()</script>');
    assert.match((await customModuleProblems(story, {sourceDir: dir}))[0].reason, /^scene "s1": the hyperframes form of its custom module \(hyperframes\/hero\.html\) uses Math\.random/);
    await writeFile(path.join(dir, 'hyperframes', 'hero.html'), '<p>x</p>');
    assert.deepEqual(await customModuleProblems(story, {sourceDir: dir}), []);
    story.scenes[0].source = 'remotion/Hero.tsx';
    assert.match((await customModuleProblems(story, {sourceDir: dir}))[0].reason, /has no hyperframes form/);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('the HyperFrames compiler draws a custom scene from its fragment, and still marks one without a form', async () => {
  const {resolved} = await readProjectStory(PROJECT);
  const compiled = await compileStoryToHyperFrames(resolved, {projectDir: path.join(os.tmpdir(), 'unused'), sourceDir: PROJECT, write: false, copyAssets: false});
  assert.deepEqual(compiled.warnings.filter(message => /placeholder/.test(message)), []);
  assert.match(compiled.html, /<section id="lc-custom-signal" class="clip lc-custom" data-start="3" data-duration="3"/);
  assert.match(compiled.html, /#lc-custom-signal \{\n\.card \{/);
  assert.match(compiled.html, /\}\)\(document\.getElementById\("lc-custom-signal"\), \{"id":"signal","start":3,"end":6,"duration":3\}, \{"component":"SignalLabel","text":"Signal locked"\}/);
  assert.doesNotMatch(compiled.html, /data-launchclip-placeholder="custom"/);
  const gap = {...resolved, scenes: resolved.scenes.map(scene => (scene.id === 'signal' ? {...scene, source: 'remotion/SignalLabel.tsx'} : scene))};
  const fallback = await compileStoryToHyperFrames(gap, {projectDir: path.join(os.tmpdir(), 'unused'), sourceDir: PROJECT, write: false, copyAssets: false});
  assert.match(fallback.warnings.join('\n'), /signal: scene "signal": the custom module "SignalLabel" has no hyperframes form \(only a remotion one, remotion\/SignalLabel\.tsx\).*; rendering a placeholder/);
  assert.match(fallback.html, /data-launchclip-placeholder="custom"/);
});

// One custom module drawn by both renderers: its HTML fragment through the
// HyperFrames compiler, its React component through a project entry that
// registers it. The module alone (ModuleReview) while it enters, holds and
// ends, then inside the whole story, in its fade and in its hold.
test('a custom module renders the same in HyperFrames and Remotion', {skip: mediaSkip(), timeout: 900_000}, async () => {
  const {bundleRemotion, compareStills, hyperframesStills, remotionStills, samplePasses, sideBySide} = await import('../scripts/parity.mjs');
  const {openBrowser, renderStill, selectComposition} = await import('@remotion/renderer');
  const {resolved: story} = await readProjectStory(PROJECT);
  const scene = story.scenes.find(entry => entry.id === 'signal');
  const work = await mkdtemp(path.join(os.tmpdir(), 'launchclip-custom-parity-'));
  const out = path.join(ROOT, 'qa', 'parity', 'custom-module');
  await mkdir(out, {recursive: true});
  try {
    const bundle = await bundleRemotion(ENTRY, path.join(work, 'bundle'), {publicDir: PROJECT});
    const scores = [];
    // The module alone.
    const samples = [['enter', 3.4], ['settled', 3.8], ['hold', 4.5], ['late', 5.9]].map(([name, time]) => ({name: `module-${name}`, time}));
    const moduleDir = path.join(work, 'hf-module');
    await compileStoryToHyperFrames(story, {projectDir: moduleDir, sourceDir: PROJECT, sceneFilter: 'signal'});
    const hfModule = await hyperframesStills(moduleDir, samples, out);
    const rmModule = await remotionStills({entry: ENTRY, scene, story, samples, outDir: out, workDir: work, bundle, publicDir: PROJECT});
    for (const [i, sample] of samples.entries()) {
      scores.push({...sample, ...(await compareStills(hfModule[i], rmModule.outputs[i].file))});
      await sideBySide(hfModule[i], rmModule.outputs[i].file, path.join(out, `${sample.name}.side-by-side.png`), path.join(out, `${sample.name}.diff.png`));
    }
    // Inside the whole story.
    const storySamples = [['fade', 3.1], ['hold', 4.5]].map(([name, time]) => ({name: `story-${name}`, time}));
    const storyDir = path.join(work, 'hf-story');
    const compiled = await compileStoryToHyperFrames(story, {projectDir: storyDir, sourceDir: PROJECT});
    assert.deepEqual(compiled.warnings.filter(message => /placeholder/.test(message)), []);
    const hfStory = await hyperframesStills(storyDir, storySamples, out);
    const browser = await openBrowser('chrome');
    try {
      const composition = await selectComposition({serveUrl: bundle, id: 'LaunchclipStory', inputProps: story, puppeteerInstance: browser, logLevel: 'error'});
      for (const [i, sample] of storySamples.entries()) {
        const file = path.join(out, `${sample.name}.remotion.png`);
        await renderStill({serveUrl: bundle, composition, inputProps: composition.props ?? story, frame: Math.round(sample.time * composition.fps), output: file, imageFormat: 'png', puppeteerInstance: browser, logLevel: 'error'});
        scores.push({...sample, ...(await compareStills(hfStory[i], file))});
      }
    } finally {
      await browser.close({silent: true}).catch(() => {});
    }
    for (const score of scores) assert.ok(samplePasses(score), `${score.name} t=${score.time}: ssim ${score.ssim} psnr ${score.psnr} (stills in ${out})`);
    // Matching placeholders would pass too, so check the card itself: paper (#f2eee6) inside it, in both stills.
    for (const file of [hfModule[2], rmModule.outputs[2].file]) {
      const {stdout} = await promisify(execFile)('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'crop=40:40:900:640,scale=1:1:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {encoding: 'buffer'});
      assert.deepEqual([...stdout].map(value => Math.abs(value - [0xf2, 0xee, 0xe6][0]) < 20), [true, true, true], `${path.basename(file)}: rgb ${[...stdout]}`);
    }
  } finally {
    await rm(work, {recursive: true, force: true});
  }
});

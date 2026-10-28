// @launchclip/engine (packages/engine): the Node engine staged from src/ at
// pack time. The stage reaches every file the engine loads and declares every
// package it imports; the packed package installs into an empty app, loads
// each method's module graph from the install (never the repository) and
// plans a storyboard on the app's adapters.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {cp, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {DEFAULT_BRAND} from '@launchclip/core/planning-prompt.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENGINE = path.join(ROOT, 'packages/engine');
const run = promisify(execFile);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));

test('@launchclip/engine is versioned in step with launchclip and pins its kit packages', () => {
  const root = json(path.join(ROOT, 'package.json'));
  const engine = json(path.join(ENGINE, 'package.json'));
  assert.equal(engine.name, '@launchclip/engine');
  assert.equal(engine.version, root.version);
  assert.equal(engine.dependencies['@launchclip/core'], root.version);
  assert.ok(root.workspaces.includes('packages/engine'));
  for (const [name, version] of Object.entries(engine.dependencies)) {
    if (name !== '@launchclip/core') assert.equal(version, root.dependencies[name], `${name} matches the root's pin`);
  }
  for (const name of ['remotion', '@remotion/renderer', '@remotion/bundler', 'react']) assert.ok(engine.peerDependencies[name], `${name} is a peer`);
  assert.equal(engine.exports['.'], './src/engine/index.js');
});

test('the stage declares every package the engine imports', async () => {
  const {stdout} = await run(process.execPath, [path.join(ENGINE, 'scripts/stage.mjs'), '--check'], {cwd: ROOT});
  const report = JSON.parse(stdout);
  assert.ok(report.files > 150, `${report.files} files`);
  for (const name of ['@launchclip/core', 'hyperframes', '@remotion/renderer', 'kokoro-js']) assert.ok(report.packages.includes(name), name);
});

test('the packed engine installs and runs from the install', {timeout: 600_000}, async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'launchclip-engine-package-'));
  t.after(() => rm(temp, {recursive: true, force: true}));
  // Copies, so neither prepack writes into the repository (kit/core/types,
  // packages/engine/src) while other tests read the kit fingerprint.
  const core = path.join(temp, 'core');
  const engine = path.join(temp, 'engine');
  await cp(path.join(ROOT, 'kit/core'), core, {recursive: true, filter: (source) => !/[\\/](types|node_modules)$/.test(source)});
  await run(process.execPath, [path.join(ROOT, 'kit/core/scripts/build-types.js'), core]);
  await cp(ENGINE, engine, {recursive: true, filter: (source) => !/[\\/](node_modules|src|kit|public)$/.test(source) || source === ENGINE});
  await run(process.execPath, [path.join(ENGINE, 'scripts/stage.mjs'), engine], {cwd: ROOT});
  const pack = async (dir) => JSON.parse((await run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], {cwd: dir, maxBuffer: 1 << 26})).stdout)[0];
  const [corePacked, enginePacked] = [await pack(core), await pack(engine)];
  const listed = new Set(enginePacked.files.map((file) => file.path));
  for (const file of ['package.json', 'README.md', 'LICENSE', 'src/engine/index.js', 'src/engine/adapters.js', 'src/asset_provider.js', 'src/finish.js', 'src/scripts/build-mix.mjs', 'src/scripts/synth-audio-kit.mjs', 'src/voice/kokoro.js', 'kit/remotion/entry.tsx', 'kit/hyperframes/story-compiler.mjs', 'kit/styles']) {
    assert.ok(listed.has(file) || [...listed].some((entry) => entry.startsWith(`${file}/`)), `${file} is missing from the tarball`);
  }
  assert.equal([...listed].filter((file) => /^(skills|test|kit\/core|bin)\//.test(file) || file === 'src/cli.js').length, 0, 'no CLI, skills, tests or kit/core copy');
  assert.match(readFileSync(path.join(engine, 'kit/hyperframes/story-compiler.mjs'), 'utf8'), /from ['"]@launchclip\/core\//);

  const app = path.join(temp, 'app');
  await mkdir(app, {recursive: true});
  await writeFile(path.join(app, 'package.json'), `${JSON.stringify({name: 'engine-app', private: true, type: 'module'}, null, 2)}\n`);
  await run(npm, ['install', '--prefer-offline', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund', path.join(temp, corePacked.filename), path.join(temp, enginePacked.filename)], {cwd: app, maxBuffer: 1 << 26});
  await writeFile(path.join(app, 'run.mjs'), `
import { createEngine, ADAPTER_KEYS } from '@launchclip/engine';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const [work, cache, story] = process.argv.slice(2);
await mkdir(path.join(work, 'empty'), { recursive: true });
await writeFile(path.join(cache, 'shot.jpg'), 'jpeg');
const llm = { async runStructured() { return { value: { storyboard_json: story }, usage: { input_tokens: 1, output_tokens: 1 } }; } };
const engine = createEngine({ workDir: work, cacheDir: cache, adapters: { llm, assets: { findShot: async () => ({ file: path.join(cache, 'shot.jpg') }) } } });
const loads = {};
// Each method loads its module graph from the install, then fails on the empty project.
for (const [name, call] of Object.entries({
  finish: () => engine.finish('empty'),
  renderSegments: () => engine.renderSegments({ project: 'empty', story: null }),
  exportNle: () => engine.exportNle('empty'),
  critique: () => engine.critique('empty'),
  prepareRecording: () => engine.prepareRecording('empty/missing.mp4', { out: 'empty/out' }),
  subjectProbe: () => engine.subject.probe('empty/missing.mp4')
})) {
  try { await call(); loads[name] = 'ran'; } catch (error) { loads[name] = /Cannot find (module|package)|ERR_MODULE_NOT_FOUND/.test(String(error?.code ?? '') + error?.message) ? 'MISSING: ' + error.message : 'loaded'; }
}
const words = [['Every', 0.2], ['morning', 0.6], ['starts', 1.1], ['here', 1.5], ['with', 3.2], ['coffee', 3.6], ['first', 4.0]].map(([text, start]) => ({ text, start, end: start + 0.3 }));
const parsed = JSON.parse(story);
const report = await engine.planStoryboard({ brief: 'A calm morning coffee short.', words, lane: parsed.lane, format: parsed.format, audio: parsed.audio, tier: 'structured', model: 'app-model', project: 'coffee' });
const { synthAmbience } = await import(new URL('./node_modules/@launchclip/engine/src/scripts/synth-audio-kit.mjs', import.meta.url));
console.log(JSON.stringify({ resolved: import.meta.resolve('@launchclip/engine'), keys: ADAPTER_KEYS, loads, status: report.status, errors: report.errors, shots: report.shots.length, synth: typeof synthAmbience }));
`);
  const story = {
    schema: 'launchclip.story.v1', title: 'Morning', lane: 'voiceover-motion',
    format: {width: 1080, height: 1920, fps: 30, duration: 6, platform: 'youtube-shorts'},
    brand: DEFAULT_BRAND,
    audio: {voice: 'assets/audio/narration.wav', words: 'NARRATION.json', music: {source: 'synth', bpm: 96}, sfx: 'auto'},
    scenes: [
      {id: 's1', module: 'photo-scene', start: 0, end: 'word:with', energy: 1, params: {media: {kind: 'shot', shows: 'a barista pouring latte art'}, title: 'Every morning'}},
      {id: 's2', module: 'cta', start: 'word:with', end: 6, energy: 1, in: {type: 'fade', dur: 0.3}, params: {action: 'Coffee first', loop: true}}
    ],
    overlays: [{type: 'captions', style: 'word-highlight'}],
    ending: {loop_to: 's1'}
  };
  const work = path.join(temp, 'work');
  const cache = path.join(temp, 'cache');
  await mkdir(cache, {recursive: true});
  const {stdout} = await run(process.execPath, ['run.mjs', work, cache, JSON.stringify(story)], {cwd: app, env: {...process.env, HOME: path.join(temp, 'no-home')}, maxBuffer: 1 << 24});
  const result = JSON.parse(stdout.trim().split('\n').at(-1));
  assert.match(result.resolved, /node_modules\/@launchclip\/engine\/src\/engine\/index\.js$/);
  assert.deepEqual(Object.entries(result.loads).filter(([, value]) => value.startsWith('MISSING')), []);
  assert.equal(result.status, 'passed', result.errors.join('\n'));
  assert.equal(result.shots, 1);
  assert.equal(result.synth, 'function');
  assert.equal(existsSync(path.join(temp, 'no-home')), false, 'nothing was written under the home folder');
  assert.ok(existsSync(path.join(work, 'coffee', 'assets', 'shots')), 'the shot landed in the project');
});

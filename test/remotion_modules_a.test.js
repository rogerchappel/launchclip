import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveEditorialModule} from '../kit/core/editorial-core.mjs';
import {editorialSpecFromScene, mixHex, brandTheme} from '../scripts/parity-scene.mjs';
import {sampleTimes} from '../scripts/parity.mjs';
import {mediaSkip} from './helpers/media.js';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REMOTION_CLI = path.join(path.dirname(require.resolve('@remotion/cli/package.json')), 'remotion-cli.js');
const ENTRY = path.join(ROOT, 'test', 'fixtures', 'parity-entry', 'entry.tsx');
const KINDS = ['metric', 'progress', 'growth-chart', 'trend-chart', 'checklist', 'step-rail', 'callout'];
const FIXTURES = ['metric-portrait', 'progress-portrait', 'growth-chart-portrait', 'trend-chart-portrait', 'checklist-portrait', 'step-rail-portrait', 'callout-portrait', 'callout-treated-portrait', 'metric-landscape'];
const fixture = name => JSON.parse(readFileSync(path.join(ROOT, 'test', 'fixtures', 'parity', `${name}.json`), 'utf8'));

function run(args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [REMOTION_CLI, ...args], {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']});
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { out += chunk; });
    child.on('close', code => resolve({code, out}));
  });
}

test('registry-a exports a component for each owned editorial kind', () => {
  const source = readFileSync(path.join(ROOT, 'kit', 'remotion', 'modules', 'registry-a.ts'), 'utf8');
  assert.match(source, /export const COMPONENTS: Record<string, React\.FC<\{model: any\}>>/);
  for (const kind of KINDS) assert.match(source, new RegExp(`(^|\\s)'?${kind}'?: [A-Z]\\w+`, 'm'), kind);
  for (const file of ['shared', 'Metric', 'Progress', 'GrowthChart', 'TrendChart', 'Checklist', 'StepRail', 'Callout']) assert.ok(existsSync(path.join(ROOT, 'kit', 'remotion', 'modules', `${file}.tsx`)), file);
});

test('scene specs follow the brand-to-module defaults', () => {
  const {story} = fixture('metric-portrait');
  const spec = editorialSpecFromScene(story.scenes[0], story);
  assert.equal(spec.id, 'metric');
  assert.equal(spec.kind, 'metric');
  assert.equal(spec.aspect, '9:16');
  assert.equal(spec.duration, 6);
  assert.equal(spec.accent, '#ff6a00');
  assert.deepEqual(spec.theme, {surface: '#0b0d12', foreground: '#f2eee6', muted: mixHex('#f2eee6', '#0b0d12', .62), border: mixHex('#f2eee6', '#0b0d12', .18), accentText: '#ffb37a'});
  assert.equal(mixHex('#ffffff', '#000000', .5), '#808080');
  assert.equal(brandTheme({colors: {bg: '#000000'}}), undefined);
  const model = resolveEditorialModule(spec);
  const samples = sampleTimes(model, {fps: 30});
  assert.deepEqual(samples.map(sample => sample.name).slice(0, 2), ['enter-mid', 'enter-end']);
  for (const sample of samples) {
    assert.ok(sample.time >= model.start && sample.time < model.end, sample.name);
    assert.equal(Math.round(sample.time * 30), sample.time * 30);
  }
});

test('every registry-a kind renders through a real remotion still', {skip: mediaSkip(), timeout: 600_000}, async t => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'launchclip-remotion-a-'));
  try {
    const bundle = path.join(work, 'bundle');
    const bundled = await run(['bundle', ENTRY, '--out-dir', bundle, '--log', 'error']);
    assert.equal(bundled.code, 0, bundled.out);
    const jobs = [];
    for (const name of FIXTURES) {
      const {story, sceneId} = fixture(name);
      const scene = story.scenes.find(item => item.id === sceneId);
      const props = path.join(work, `${name}.json`);
      await writeFile(props, JSON.stringify({scene, story}));
      const frames = (scene.end - scene.start) * story.format.fps;
      for (const frame of [4, Math.round(frames / 2), frames - 2]) jobs.push({name, props, frame, out: path.join(work, `${name}-${frame}.png`)});
    }
    const first = jobs.shift();
    const probe = await run(['still', bundle, 'ModuleReview', first.out, `--props=${first.props}`, `--frame=${first.frame}`, '--log', 'error']);
    if (probe.code !== 0 && /browser|chrome|executable/i.test(probe.out) && !/Error: .*(module|component|resolve)/i.test(probe.out)) {
      t.skip(`Chrome is unavailable for Remotion: ${probe.out.slice(-300)}`);
      return;
    }
    assert.equal(probe.code, 0, probe.out);
    const queue = [...jobs];
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const result = await run(['still', bundle, 'ModuleReview', job.out, `--props=${job.props}`, `--frame=${job.frame}`, '--log', 'error']);
        assert.equal(result.code, 0, `${job.name} frame ${job.frame}: ${result.out}`);
        assert.ok(statSync(job.out).size > 1000, `${job.name} frame ${job.frame} wrote an image`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  } finally {
    await rm(work, {recursive: true, force: true});
  }
});

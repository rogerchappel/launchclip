import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {buildEditorialModule} from '../skills/launchclip-create-video/scripts/editorial-ui-modules.mjs';

const base = {id: 'learn', kind: 'checklist', aspect: '16:9', start: 70, duration: 28, title: 'What you will learn', rect: {x: 70, y: 130, width: 850, height: 820}};
const row = {label: 'Engineering principles', status: 'active', at: 2.79, doneAt: 6.72};
function commands(result) {
  const calls = [];
  runInNewContext(result.motion, {tl: {fromTo: (...args) => calls.push(['fromTo', ...args]), to: (...args) => calls.push(['to', ...args])}});
  return calls;
}

test('checklist states wait for speech cues and covered ticks follow active state', () => {
  const input = {...base, rows: [row, {label: 'Security', status: 'active', at: 6.72, doneAt: 10.1}, {label: 'AI workflows', status: 'active', at: 10.1, doneAt: 16.14}, {label: 'Hands-free agent', status: 'active', at: 16.14, doneAt: 19.2}, {label: 'Content and video', status: 'active', at: 19.2}]};
  const result = buildEditorialModule(input);
  assert.deepEqual(result, buildEditorialModule(input));
  assert.match(result.html, /status-0-active" style="opacity:0/);
  assert.match(result.html, /status-0-done" style="opacity:0/);
  const calls = commands(result);
  assert.ok(calls.some(call => call[1] === '#learn-status-0-active' && call.at(-1) === 72.79 && call[2].opacity === 1));
  assert.ok(calls.some(call => call[1] === '#learn-row-0 svg' && call.at(-1) === 76.72 && call[2].opacity === 1));
  assert.ok(result.events.every(event => event.time >= 70 && event.time < 98));
  assert.equal(result.events.find(event => event.id === 'learn-row-0-covered').time, 76.88);
});

test('media playback is a direct root sibling with synchronized higher chrome track', () => {
  const result = buildEditorialModule({...base, kind: 'media-window', track: 8, media: {kind: 'video', src: 'assets/demo.mp4', sourceStart: 12}});
  assert.match(result.html, /^<video[^>]*data-track-index="8"[^>]*data-media-start="12"[^>]*muted[^>]*><\/video><section[^>]*data-track-index="9"/);
  assert.match(result.html, /data-layout-allow-occlusion="true"/);
  const calls = commands(result);
  for (const target of ['#learn', '#learn-media']) assert.ok(calls.some(call => call[1] === target && call.at(-1) === 70));
  assert.match(result.html, /#ff6258/);
});

test('portrait image window and callout use target-specific bounded layouts', () => {
  const window = buildEditorialModule({...base, aspect: '9:16', rect: undefined, kind: 'media-window', media: {kind: 'image', src: 'assets/readable.png'}});
  assert.deepEqual(window.layout.canvas, {width: 1080, height: 1920});
  assert.match(window.html, /^<img/);
  const callout = buildEditorialModule({...base, aspect: '9:16', rect: undefined, kind: 'callout', body: 'Focus on the next useful step.'});
  assert.match(callout.html, /Focus on the next useful step/);
  assert.ok(callout.layout.rect.y + callout.layout.rect.height <= 1920);
});

test('bar stages are explicit chronological events without fabricated percentages or detached dots', () => {
  const result = buildEditorialModule({...base, kind: 'step-rail', steps: [{label: 'Plan', at: 1}, {label: 'Build', at: 3}, {label: 'Share', at: 5}]});
  assert.doesNotMatch(result.html, /ui-step-dot|%/);
  assert.match(result.motion, /scaleX:1/);
  assert.equal(result.events.at(-1).time, 75.3);
  assert.throws(() => buildEditorialModule({...base, kind: 'step-rail', steps: [{label: 'Plan', at: 2}, {label: 'Build', at: 1}]}), /strictly increase/);
});

test('untrusted copy is escaped and generated animation never executes it', () => {
  const result = buildEditorialModule({...base, kind: 'callout', title: '</script><script>alert(1)</script>', body: '<img src=x onerror="bad()"> & text'});
  assert.doesNotMatch(result.html, /<script|<img/);
  assert.match(result.html, /&lt;script&gt;/);
  assert.doesNotMatch(result.motion, /alert|bad\(/);
  commands(result);
  for (const bad of [{id: 'x";bad()'}, {accent: 'red;bad()'}, {percent: 95}, {track: 1.5}, {duration: NaN}]) assert.throws(() => buildEditorialModule({...base, rows: [row], ...bad}));
});

test('invalid paths, times and layouts fail before emitting a composition', () => {
  for (const src of ['https://example.com/video.mp4', '/private/video.mp4', 'assets/../secret.mp4', 'assets/a"bad.mp4']) assert.throws(() => buildEditorialModule({...base, kind: 'media-window', media: {kind: 'video', src}}), /assets/);
  assert.throws(() => buildEditorialModule({...base, rows: [{...row, at: 28}]}), /row.at/);
  assert.throws(() => buildEditorialModule({...base, rows: [{...row, doneAt: 2}]}), /doneAt/);
  assert.throws(() => buildEditorialModule({...base, rows: [row], rect: {...base.rect, x: 1600}}), /rect.x/);
  assert.throws(() => buildEditorialModule({...base, rows: [{...row,label: 'Engineering principles and production foundations'}], rect: {x: 0, y: 0, width: 420, height: 300}}), /label too long/);
  assert.throws(() => buildEditorialModule({...base, rows: Array(6).fill(row), rect: {...base.rect, height: 160}}), /too short/);
  assert.throws(() => buildEditorialModule({...base, kind: 'callout', rect: {...base.rect, height: 160}, body: 'word '.repeat(30)}), /too short/);
});

test('local CLI emits the same module and fails clearly for invalid input', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'launchclip-ui-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const path = join(dir, 'module.json');
  const script = new URL('../skills/launchclip-create-video/scripts/editorial-ui-modules.mjs', import.meta.url);
  const input = {...base, rows: [row]};
  await writeFile(path, JSON.stringify(input));
  const success = spawnSync(process.execPath, [script.pathname, path], {encoding: 'utf8'});
  assert.equal(success.status, 0, success.stderr);
  assert.deepEqual(JSON.parse(success.stdout), buildEditorialModule(input));
  await writeFile(path, '{"kind":"factory"}');
  const failure = spawnSync(process.execPath, [script.pathname, path], {encoding: 'utf8'});
  assert.equal(failure.status, 1);
  assert.equal(failure.stdout, '');
  assert.match(failure.stderr, /id/);
});

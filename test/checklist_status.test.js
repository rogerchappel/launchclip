// Checklist status labels before a row's `at`: a row that turns active or done
// at its time shows no status label before it (the pending label would read
// as a state the row never has; a "Waiting" or "Stalled" flash before "Done"),
// and a pending row shows its pending label throughout. Both renderers.
// status-rack has no such pre-state: a rack row stays hidden until its first
// state, which sets its lights as it enters.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';
import {resolveEditorialModule} from '@launchclip/core/editorial-core.mjs';
import {buildEditorialModule} from '../kit/hyperframes/editorial-ui-modules.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const spec = {id: 'list', kind: 'checklist', aspect: '16:9', start: 2, duration: 5, title: 'Release checklist', rect: {x: 160, y: 160, width: 900, height: 640},
  statusLabels: {pending: 'Waiting', active: 'Stalled', done: 'Done'},
  rows: [{label: 'Tests pass', status: 'done', at: 0.3}, {label: 'Launch video', status: 'active', at: 0.9, doneAt: 2}, {label: 'Blog post', status: 'pending', at: 1.2}]};

function commands(result) {
  const calls = [];
  runInNewContext(result.motion, {tl: {fromTo: (...args) => calls.push(['fromTo', ...args]), to: (...args) => calls.push(['to', ...args]), set: (...args) => calls.push(['set', ...args])}});
  return calls;
}

test('HyperFrames checklist: no pending label before a done/active row turns on', () => {
  const built = buildEditorialModule(spec);
  // Rows 0 and 1 start with their pending label hidden; row 2 (pending) shows it.
  assert.match(built.html, /<span id="list-status-0-pending" style="opacity:0">Waiting<\/span>/);
  assert.match(built.html, /<span id="list-status-1-pending" style="opacity:0">Waiting<\/span>/);
  assert.match(built.html, /<span id="list-status-2-pending">Waiting<\/span>/);
  const calls = commands(built);
  // Nothing ever animates a pending label, and the active/done labels only rise at the row's time.
  assert.ok(!calls.some(call => /-pending$/.test(call[1])));
  const rises = calls.filter(call => /^#list-status-\d-(active|done)$/.test(call[1]) && call[2].opacity === 1).map(call => [call[1], call.at(-1)]);
  assert.deepEqual(rises, [['#list-status-0-done', 2.3], ['#list-status-1-active', 2.9], ['#list-status-1-done', 4]]);
});

test('Remotion checklist rowState matches: hidden before at, then the declared label', async () => {
  const dir = path.join(ROOT, '.tmp', 'checklist-status-test');
  await mkdir(dir, {recursive: true});
  const out = path.join(dir, `checklist-${process.pid}.mjs`);
  try {
    await build({entryPoints: [path.join(ROOT, 'kit/remotion/modules/Checklist.tsx')], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'silent', jsx: 'automatic'});
    const {rowState} = await import(pathToFileURL(out).href);
    const model = resolveEditorialModule(spec);
    const [done, active, pending] = model.content.rows;
    for (const t of [2, 2.29]) {
      const s = rowState(model, done, t);
      assert.equal(s.pending, 0, `done row pending at ${t}`); assert.equal(s.done, 0); assert.equal(s.active, 0);
    }
    assert.equal(rowState(model, done, 2.5).done, 1);
    assert.equal(rowState(model, active, 2.8).pending, 0);
    assert.equal(rowState(model, active, 2.8).active, 0);
    assert.equal(rowState(model, active, 3.2).active, 1);
    assert.equal(rowState(model, active, 4.3).done, 1);
    for (const t of [2, 3, 6]) assert.equal(rowState(model, pending, t).pending, 1);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('status-rack rows stay hidden until their first state', () => {
  const rack = buildEditorialModule({id: 'rack', kind: 'status-rack', aspect: '16:9', start: 0, duration: 5, title: 'Finish', rect: {x: 160, y: 160, width: 900, height: 500},
    rack: {mode: 'illustration', rows: [{label: 'Voice', states: [{at: 0.3, lights: [true, false, false]}, {at: 1.25, lights: [true, true, true]}]}]}});
  assert.match(rack.css, /\.ui-rack-row\{[^}]*opacity:0\}/);
  const enter = commands(rack).find(call => call[1] === '#rack-rack-0');
  assert.deepEqual([enter[0], enter[2].opacity, enter.at(-1)], ['fromTo', 0, 0.3]);
});

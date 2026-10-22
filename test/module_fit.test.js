// Rect sizing errors name the size that fits: whether content fits depends on
// the rect's width, so "rect too short" says the minimum height at that width
// and the width that fits the given height; `launchclip module fit` prints
// the same for a spec.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {moduleFit, rectFitHint, resolveModule} from '../kit/core/modules.mjs';
import {runCli} from '../src/cli.js';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'inter', meta: 'jetbrains-mono'}};
const rows = [{label: 'Tests pass', status: 'done', at: .3}, {label: 'Tag pushed', status: 'done', at: .45}, {label: 'Changelog written', status: 'done', at: .6}, {label: 'Launch video', status: 'active', at: .9}];
const storyWith = (scene) => ({format: {width: 1920, height: 1080, fps: 30, duration: 20}, brand, scenes: [scene]});
const checklist = (rect) => ({id: 's2', module: 'checklist', start: 0, end: 4, params: {title: 'Release checklist', rect, rows}});
const resolves = (scene) => { try { resolveModule(scene, storyWith(scene)); return true; } catch { return false; } };

test('a too-short editorial rect names the minimum height at its width, and the width that fits its height', () => {
  const scene = checklist({x: 500, y: 190, width: 900, height: 500});
  let message = '';
  try { resolveModule(scene, storyWith(scene)); } catch (error) { message = error.message; }
  const match = message.match(/checklist rect too short; use fewer rows or a taller rect; checklist needs (\d+) px height at width 900 \(or width ([≥≤]) (\d+) at this height\)/);
  assert.ok(match, message);
  const height = Number(match[1]), width = Number(match[3]);
  // The named sizes are exact: they fit, one pixel less does not.
  assert.ok(resolves(checklist({x: 500, y: 190, width: 900, height})));
  assert.ok(!resolves(checklist({x: 500, y: 190, width: 900, height: height - 1})));
  assert.ok(resolves(checklist({x: 500, y: 190, width, height: 500})));
});

test('the hint covers catalogue modules and widths that do not fit at any height', () => {
  const scene = {id: 's9', module: 'process-steps', start: 0, end: 4, params: {title: 'How it works', rect: {x: 200, y: 200, width: 1000, height: 500}, steps: ['Brief', 'storyboard.json', 'launchclip finish', 'Video']}};
  assert.throws(() => resolveModule(scene, storyWith(scene)), /process-steps fits no height at width 1000; it needs width ≥ \d+ at height 500/);
  // Errors that are not about geometry get no hint.
  const bad = checklist({x: 500, y: 190, width: 900, height: 700});
  bad.params.rows = [{label: 'X', status: 'nope', at: .3}];
  assert.equal(rectFitHint(bad, storyWith(bad), 'row.status must be pending, active or done'), '');
  assert.throws(() => resolveModule(bad, storyWith(bad)), (error) => !/needs \d+ px height/.test(error.message));
});

test('moduleFit reports the least height at a width', () => {
  const scene = checklist({x: 500, y: 190, width: 900, height: 500});
  const fit = moduleFit(scene, storyWith(scene), {width: 900});
  assert.ok(fit.minHeight > 500 && fit.minHeight < 800);
});

test('launchclip module fit prints the natural size, or the minimal rect for a given rect', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lc-module-fit-'));
  try {
    const out = (chunks) => ({write: (text) => chunks.push(text)});
    const withRect = path.join(dir, 'rect.json'), noRect = path.join(dir, 'none.json');
    await writeFile(withRect, JSON.stringify({title: 'Release checklist', rect: {x: 500, y: 190, width: 900, height: 500}, rows}));
    await writeFile(noRect, JSON.stringify({title: 'Release checklist', rows}));
    const a = [];
    await runCli(['module', 'fit', 'checklist', '--params', withRect, '--aspect', '16:9'], {stdout: out(a)});
    assert.match(a.join(''), /rect 900×500 does not fit/);
    assert.match(a.join(''), /needs \d+ px height at width 900/);
    assert.match(a.join(''), /width 1000 → \d+ px/);
    const b = [];
    await runCli(['module', 'fit', 'checklist', '--params', noRect, '--aspect', '16:9'], {stdout: out(b)});
    assert.match(b.join(''), /natural size 1000×\d+ at scale [\d.]+; default rect 460,\d+ 1000×\d+/);
    const c = [];
    await runCli(['module', 'fit', 'checklist', '--params', noRect, '--aspect', '16:9', '--json'], {stdout: out(c)});
    const report = JSON.parse(c.join(''));
    assert.equal(report.fits, true);
    assert.equal(report.natural.width, 1000);
    await assert.rejects(() => runCli(['module', 'fit', 'nope', '--aspect', '16:9'], {stdout: out([])}), /Unknown module "nope"/);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

// Catalogue I calendars (kit/core/catalog-i-calendar.mjs): date-carousel and
// month-grid dates, timing, settled frames and validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, catalogHTimeline} from '@launchclip/core/catalog-h.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const resolve = (id, params = SAMPLES[id], aspect = '16:9', overrides = {}) => ({...MODULES[id].resolve(params, {id: 'scene', start: 1, duration: 6, format: FORMATS[aspect], brand, aspect, hits: [], ...overrides}), module: id});
const at = (model, t) => frameState(catalogHTimeline(model), t);

test('date-carousel: lands on the start day, rewinds to the focus day, then lights it', () => {
  const model = resolve('date-carousel');
  const c = model.content;
  assert.equal(c.rewind, true);
  assert.equal(c.sign.text, 'REWIND');
  assert.deepEqual(model.events.map(e => e.name), ['enter', 'build', 'move', 'focus']);
  const centre = x => c.days.find(d => Math.abs(d.x + x - c.centerX) < 1);
  assert.equal(centre(at(model, c.moveAt - 0.01).get('scene-strip').x).date, 26, 'Oct 26 in the centre before the move');
  const end = at(model, model.motion.exitStart - 0.01);
  const day = centre(end.get('scene-strip').x);
  assert.deepEqual([day.date, day.weekdayName], [5, 'Mon'], 'Monday Oct 5 in the centre after it');
  assert.equal(end.get('scene-lens').opacity, 1);
  assert.equal(end.get('scene-chip').opacity, 1);
  assert.equal(end.get('scene-schip').opacity, 0, 'the start chip cleared');
  assert.equal(resolve('date-carousel', {from: '2026-10-01', to: '2026-10-09'}).content.sign.text, 'FAST FORWARD');
  assert.throws(() => resolve('date-carousel', {from: '2026-02-30', to: '2026-03-02'}), /params\.from is not a calendar date/);
  assert.throws(() => resolve('date-carousel', {from: '2026-10-01', to: '2026-10-01'}), /must differ/);
  assert.throws(() => resolve('date-carousel', {from: '2026-10-01', to: '2027-10-01'}), /within 120 days/);
});

test('month-grid: whole weeks around the run, days fill in order, marks land with their day', () => {
  const model = resolve('month-grid');
  const c = model.content;
  assert.equal(c.cells.length, 28, 'Mon Oct 5 to Sun Nov 1 is four weeks');
  assert.deepEqual([c.cells[0].date, c.cells[0].month, c.cells[27].date, c.cells[27].month], [5, 'Oct', 1, 'Nov']);
  const run = c.cells.filter(cell => cell.run);
  assert.equal(run.length, 28);
  assert.deepEqual(run.map(cell => cell.time), [...run.map(cell => cell.time)].sort((a, b) => a - b));
  assert.equal(c.cells.find(cell => cell.run === 9).mark.icon, 'wrench');
  const end = at(model, model.motion.exitStart - 0.01);
  assert.equal(end.get('scene-fill-27').opacity, 1);
  assert.equal(end.get('scene-legend-1').opacity, 1);
  // Sunday weeks and days outside the run.
  const sun = resolve('month-grid', {from: '2026-10-07', days: 10, weekStart: 'sun'});
  assert.equal(sun.content.heads[0].text, 'SUN');
  assert.equal(sun.content.cells[0].date, 4);
  assert.equal(sun.content.cells.filter(cell => cell.run).length, 10);
  // A mark too wide for a portrait cell keeps its icon; without one it fails.
  assert.equal(resolve('month-grid', SAMPLES['month-grid'], '9:16').content.cells[0].mark.text, null);
  assert.throws(() => resolve('month-grid', {from: '2026-10-05', days: 7, marks: [{day: 1, label: 'a very long mark'}]}, '9:16'), /too wide .* give an icon/);
  assert.throws(() => resolve('month-grid', {from: '2026-10-05', days: 43}), /params\.days/);
});

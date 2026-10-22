// Minimum-gap checks accept events exactly the minimum apart: authored times
// such as 0.4 and 0.75 differ by 0.35 only up to float rounding, so every
// "at least N s after the previous" rule allows a 1e-6 s tolerance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES as CATALOG_A} from '../kit/core/catalog-a.mjs';
import {MODULES as CATALOG_B} from '../kit/core/catalog-b.mjs';
import {resolveEditorialModule} from '../kit/core/editorial-core.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const format = {width: 1920, height: 1080, fps: 30, duration: 60};
const ctx = (start) => ({id: 'scene', start, duration: 4, format, brand, aspect: '16:9'});

test('process-steps accepts steps exactly 0.35 s apart (0.6 then 0.95) at any scene start', () => {
  for (const start of [0, 2.1, 32.15, 17.3]) {
    const model = CATALOG_B['process-steps'].resolve({steps: [{label: 'Brief', at: 0.6}, {label: 'Plan', at: 0.95}, {label: 'Ship', at: 1.3}]}, ctx(start));
    assert.equal(model.content.steps.length, 3, `start ${start}`);
  }
  assert.throws(() => CATALOG_B['process-steps'].resolve({steps: [{label: 'A', at: 0.6}, {label: 'B', at: 0.949}]}, ctx(0)), /must come at least 0\.35 s after the previous step/);
});

test('kinetic-words accepts beats exactly the minimum gap apart', () => {
  for (const start of [0, 20.95, 3.3]) {
    const model = CATALOG_A['kinetic-words'].resolve({words: [{text: 'One', at: 0.4}, {text: 'two', at: 0.7}, {text: 'three', at: 1.0}]}, ctx(start));
    assert.ok(model, `start ${start}`);
  }
});

test('editorial step, point, value, rack and code gaps tolerate float rounding', () => {
  const base = {id: 'mod', aspect: '16:9', start: 2.1, duration: 6, rect: {x: 160, y: 160, width: 1000, height: 600}};
  resolveEditorialModule({...base, kind: 'step-rail', title: 'Steps', steps: [{label: 'A', at: 0.4}, {label: 'B', at: 0.7}, {label: 'C', at: 1.0}]});
  resolveEditorialModule({...base, kind: 'status-rack', title: 'Rack', rack: {mode: 'illustration', rows: [{label: 'Build', states: [{at: 0.4, lights: [true, false, false]}, {at: 0.7, lights: [true, true, false]}, {at: 1.0, lights: [true, true, true]}]}]}});
  resolveEditorialModule({...base, kind: 'code-snippet', title: 'Code', code: {lines: [{at: 0.4, tokens: [{text: 'a', type: 'plain'}]}, {at: 0.7, tokens: [{text: 'b', type: 'plain'}]}, {at: 1.0, tokens: [{text: 'c', type: 'plain'}]}]}});
  resolveEditorialModule({...base, kind: 'trend-chart', title: 'Trend', chart: {mode: 'illustration', unit: 'views', points: [{label: 'A', value: 1, at: 0.4}, {label: 'B', value: 2, at: 0.9}, {label: 'C', value: 3, at: 1.4}]}});
  resolveEditorialModule({...base, kind: 'metric', title: 'Metric', metric: {mode: 'illustration', unit: 'u', format: 'number', values: [{value: 1, at: 0.45}, {value: 2, at: 1.1}, {value: 3, at: 1.75}]}});
});

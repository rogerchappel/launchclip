// Catalogue H icon-grid (kit/core/catalog-h-icons.mjs): Lucide and LaunchClip
// icons in stroke, duotone and tiles variants.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, VARIANTS, catalogHTimeline} from '@launchclip/core/catalog-h.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const resolve = (params, aspect = '9:16') => ({...MODULES['icon-grid'].resolve(params, {id: 'scene', start: 1, duration: 5, format: FORMATS[aspect], brand, aspect, hits: []}), module: 'icon-grid'});

test('icon-grid draws every variant, duotone with a tint under the stroke', () => {
  assert.deepEqual([...VARIANTS['icon-grid']], ['stroke', 'duotone', 'tiles']);
  for (const variant of VARIANTS['icon-grid']) for (const aspect of ['9:16', '16:9']) {
    const model = resolve({...SAMPLES['icon-grid'], variant}, aspect);
    const html = EMITTERS['icon-grid'](model).html;
    assert.doesNotMatch(html, /undefined|NaN/);
    assert.equal(/fill-opacity="0.28"/.test(html), variant === 'duotone', variant);
    const state = frameState(catalogHTimeline(model), model.motion.exitStart - 0.01);
    model.content.cells.forEach((_, i) => assert.equal(state.get(`scene-cell-${i}`).opacity, 1));
  }
  assert.throws(() => resolve({items: ['rocket', 'not-an-icon']}), /params\.items\[1\]\.icon/);
});

test('icon-grid: cells flock out of the middle of the grid, then breathe out of step and rest before the exit', () => {
  const model = {...MODULES['icon-grid'].resolve({...SAMPLES['icon-grid'], variant: 'tiles'}, {id: 'scene', start: 1, duration: 8, format: FORMATS['9:16'], brand, aspect: '9:16', hits: []}), module: 'icon-grid'};
  const c = model.content, ops = catalogHTimeline(model);
  const first = frameState(ops, c.cells[0].time + 0.01).get('scene-cell-0');
  const cx = c.cells[0].x + c.cellW / 2, cy = c.cells[0].y + c.cellH / 2;
  assert.ok(Math.abs(cx + first.x - c.origin.x) < 20 && Math.abs(cy + first.y - c.origin.y) < 20, 'launches from the middle');
  const mid = model.start + 4.5, still = frameState(ops, mid);
  const moving = c.cells.map((_, i) => still.get(`scene-cell-${i}-idle`)).filter(s => Math.abs(s.y) > 0.5 || Math.abs(s.rotation) > 0.05);
  assert.ok(moving.length >= c.cells.length - 1, 'settled cells breathe');
  assert.ok(new Set(moving.map(s => Math.sign(s.y))).size === 2, 'not in step');
  const rest = frameState(ops, model.motion.exitStart - 0.04);
  c.cells.forEach((_, i) => assert.deepEqual([rest.get(`scene-cell-${i}-idle`).y, rest.get(`scene-cell-${i}-idle`).rotation], [0, 0]));
});

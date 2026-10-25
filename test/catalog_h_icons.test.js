// Catalogue H icon-grid (kit/core/catalog-h-icons.mjs): Lucide and LaunchClip
// icons in stroke, duotone and tiles variants.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, VARIANTS, catalogHTimeline} from '../kit/core/catalog-h.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
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

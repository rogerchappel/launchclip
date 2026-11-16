// Catalogue H item-list (kit/core/catalog-h-list.mjs): items breathe once in.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, VARIANTS, catalogHTimeline} from '@launchclip/core/catalog-h.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const format = {width: 1080, height: 1920, fps: 30};

test('item-list: every layout breathes once its items are in, out of step and gently, and rests before the exit', () => {
  for (const variant of VARIANTS['item-list']) {
    const model = {...MODULES['item-list'].resolve({...SAMPLES['item-list'], variant, ...(variant === 'orbit' ? {subject: 'LaunchClip'} : {})}, {id: 'scene', start: 1, duration: 9, format, brand, aspect: '9:16', hits: []}), module: 'item-list'};
    const c = model.content, ops = catalogHTimeline(model);
    const mid = frameState(ops, model.motion.exitStart - 2.4);
    const poses = c.items.map(item => mid.get(`scene-item-${item.index}-idle`));
    assert.ok(poses.filter(s => Math.abs(s.y) > 0.5).length >= c.items.length - 1, `${variant}: items breathe`);
    assert.ok(poses.every(s => Math.abs(s.rotation) <= c.idle.tilt + 1e-6 && c.idle.tilt < 1.8), `${variant}: a gentle tilt`);
    assert.equal(new Set(poses.map(s => Math.sign(s.y)).filter(Boolean)).size, 2, `${variant}: out of step`);
    for (const item of c.items) assert.equal(frameState(ops, model.motion.exitStart - 0.01).get(`scene-item-${item.index}`).opacity, 1);
    const rest = frameState(ops, model.motion.exitStart - 0.04);
    c.items.forEach(item => assert.deepEqual([rest.get(`scene-item-${item.index}-idle`).y, rest.get(`scene-item-${item.index}-idle`).rotation], [0, 0]));
  }
});

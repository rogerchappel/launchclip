// Catalogue I (kit/core/catalog-i-explain.mjs): every explainer module is
// registered in the registry, both renderers and the samples, and every
// variant resolves in both aspects on dark and light brands, settles inside
// its rect, and carries the same element ids in the view and the HTML.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, VARIANTS, catalogHTimeline, catalogHView} from '@launchclip/core/catalog-h.mjs';
import {EXPLAIN_MODULES} from '@launchclip/core/catalog-i-explain.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {hyperframesEmitters} from '../kit/hyperframes/story-compiler.mjs';
import {knownModules} from '@launchclip/core/modules.mjs';
import {SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const light = {colors: {bg: '#f5f1e8', primary: '#b7791f', accent: '#1f6feb', ink: '#f5f1e8', paper: '#14161c'}, fonts: brand.fonts};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const IDS = EXPLAIN_MODULES.map(def => def.id);

test('catalogue I modules are registered in the registry, both renderers and the samples', () => {
  assert.ok(IDS.length >= 2);
  for (const id of IDS) {
    assert.ok(MODULES[id], id);
    assert.ok(knownModules().includes(id), id);
    assert.ok(EMITTERS[id] && hyperframesEmitters()[id], id);
    assert.ok(SAMPLES[id], `${id} has a sample`);
    assert.ok(MODULES[id].events.includes('build'), `${id} has a build event`);
  }
});

test('every catalogue I variant resolves in both aspects and brands and settles inside its rect', () => {
  for (const id of IDS) for (const variant of VARIANTS[id]) for (const aspect of ['9:16', '16:9']) for (const b of [brand, light]) {
    const label = `${id}/${variant} ${aspect} ${b.colors.bg}`;
    const model = {...MODULES[id].resolve({...SAMPLES[id], variant}, {id: 'scene', start: 1, duration: 6, format: FORMATS[aspect], brand: b, aspect, hits: []}), module: id};
    const out = EMITTERS[id](model);
    assert.doesNotMatch(out.html + out.motion, /undefined|NaN/, label);
    assert.ok(model.minTextPx >= 44 - 1e-6, `${label} key text ${model.minTextPx}`);
    const times = model.events.map(e => e.time);
    assert.ok(times.every(t => t >= model.start && t <= model.motion.exitStart), `${label}: events inside the scene`);
    const state = frameState(catalogHTimeline(model), model.motion.exitStart - 0.01);
    for (const [target, props] of state) if (props.clipR !== undefined) assert.equal(props.clipR + props.clipB + props.clipL + props.clipT, 0, `${label}: ${target} still clipped`);
    const ids = [];
    const walk = node => { if (node && typeof node === 'object') { if (node.id) ids.push(node.id); (node.children ?? []).forEach(walk); } else assert.equal(typeof node, 'string', `${label}: a child is ${node}`); };
    walk(catalogHView(model));
    assert.equal(new Set(ids).size, ids.length, `${label}: element ids are unique`);
    for (const target of new Set(catalogHTimeline(model).map(op => op.target))) assert.ok(ids.includes(target), `${label}: op target ${target} is in the view`);
    for (const nodeId of ids) assert.ok(out.html.includes(`id="${nodeId}"`), `${label}: ${nodeId} in the HyperFrames HTML`);
  }
});

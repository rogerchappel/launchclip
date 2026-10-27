// Catalogue I 3D data objects (kit/core/catalog-i-3d.mjs): registration,
// every variant in both aspects and on dark and light brands, the CSS 3D
// rig's rules (no animated element carries a static transform, nothing
// that fades has 3D children), the projection fit, and each module's params.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, VARIANTS, catalogHTimeline, catalogHView} from '../kit/core/catalog-h.mjs';
import {OBJECT_MODULES} from '../kit/core/catalog-i-3d.mjs';
import {camera, cameraStates, fitScene, project} from '../kit/core/catalog-i-3d-base.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {hyperframesEmitters} from '../kit/hyperframes/story-compiler.mjs';
import {knownModules} from '../kit/core/modules.mjs';
import {EXTRA_SAMPLES, SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const light = {colors: {bg: '#f5f1e8', primary: '#b7791f', accent: '#1f6feb', ink: '#f5f1e8', paper: '#14161c'}, fonts: brand.fonts};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const ctx = (aspect = '9:16', overrides = {}) => ({id: 'scene', start: 1, duration: 5, format: FORMATS[aspect], brand, aspect, hits: [], ...overrides});
const resolve = (id, params = SAMPLES[id], aspect, overrides) => ({...MODULES[id].resolve(params, ctx(aspect, overrides)), module: id});
const IDS = OBJECT_MODULES.map(def => def.id);
const walk = (node, fn, parents = []) => {
  if (!node || typeof node !== 'object') return;
  fn(node, parents);
  for (const child of node.children ?? []) walk(child, fn, [...parents, node]);
};
const cases = () => {
  const out = [];
  for (const id of IDS) for (const variant of VARIANTS[id]) for (const aspect of ['9:16', '16:9']) for (const b of [brand, light]) out.push({id, params: {...SAMPLES[id], variant}, aspect, b, label: `${id}/${variant} ${aspect} ${b.colors.bg}`});
  for (const extra of EXTRA_SAMPLES.filter(e => IDS.includes(e.module))) out.push({id: extra.module, params: {...extra.params, variant: extra.variant}, aspect: extra.shape === 'portrait' ? '9:16' : '16:9', b: brand, label: extra.name});
  return out;
};

test('catalogue I modules are registered in the registry, both renderers and the samples', () => {
  assert.ok(IDS.length >= 1);
  for (const id of IDS) {
    assert.ok(knownModules().includes(id), id);
    assert.ok(EMITTERS[id] && hyperframesEmitters()[id], id);
    assert.ok(SAMPLES[id], id);
    assert.ok(MODULES[id].events.includes('build'), id);
  }
});

test('every variant resolves in both aspects, on dark and light brands, with both renderers\' ids', () => {
  for (const {id, params, aspect, b, label} of cases()) {
    const model = resolve(id, params, aspect, {brand: b});
    const out = EMITTERS[id](model);
    assert.doesNotMatch(out.html + out.motion, /undefined|NaN|Infinity/, label);
    assert.ok(model.minTextPx >= 44 - 1e-6, `${label} key text ${model.minTextPx}`);
    const ids = [];
    walk(catalogHView(model), node => { if (node.id) ids.push(node.id); });
    assert.equal(new Set(ids).size, ids.length, `${label}: ids are unique`);
    for (const target of new Set(catalogHTimeline(model).map(op => op.target))) assert.ok(ids.includes(target), `${label}: op target ${target} is in the view`);
    for (const nodeId of ids) assert.ok(out.html.includes(`id="${nodeId}"`), `${label}: ${nodeId} in the HyperFrames HTML`);
  }
});

test('the CSS 3D rig: moved elements carry no static transform, and nothing that fades holds 3D children', () => {
  for (const {id, params, aspect, b, label} of cases()) {
    const model = resolve(id, params, aspect, {brand: b});
    const ops = catalogHTimeline(model);
    const keys = op => Object.keys(op.props ?? {...op.from, ...op.to});
    const moved = new Set(ops.filter(op => keys(op).some(k => ['x', 'y', 'scaleX', 'scaleY', 'rotation'].includes(k))).map(op => op.target));
    const faded = new Set(ops.filter(op => keys(op).includes('opacity')).map(op => op.target));
    walk(catalogHView(model), (node) => {
      if (!node.id) return;
      // GSAP owns a moved element's transform, so a static 3D transform there would be lost.
      if (moved.has(node.id) && node.id !== model.id) assert.ok(!node.style?.transform, `${label}: ${node.id} is moved and has transform ${node.style?.transform}`);
      // Opacity below 1 flattens preserve-3d, so a fading element must be a leaf of the 3D tree.
      if (faded.has(node.id) && node.id !== model.id) {
        let deep = false;
        walk(node, child => { if (child !== node && child.style?.transformStyle === 'preserve-3d') deep = true; });
        assert.ok(!deep, `${label}: ${node.id} fades but holds preserve-3d children`);
      }
    });
  }
});

test('the timeline is seek-safe: set and tween ops only, the same state from any seek order', () => {
  for (const id of IDS) {
    const model = resolve(id);
    const ops = catalogHTimeline(model);
    assert.ok(ops.every(op => op.type === 'set' || op.type === 'tween'), id);
    const times = [model.end - 0.2, model.start + 1.3, model.start + 0.4, model.start + 2.6];
    const forward = times.map(t => JSON.stringify([...frameState(ops, t)]));
    const back = [...times].reverse().map(t => JSON.stringify([...frameState(ops, t)])).reverse();
    assert.deepEqual(forward, back, id);
  }
});

test('project() mirrors the rig; fitScene keeps every point inside the box at every camera state', () => {
  const cam = camera({tilt: 60, perspective: 2000, orbit: [-10, 10], zoom: [1, 1.1]});
  const pts = [];
  for (const x of [-300, 300]) for (const y of [-200, 200]) for (const z of [0, 400]) pts.push([x, y, z]);
  const fit = fitScene(cam, 900, 700, k => ({points: pts.map(p => p.map(v => v * k)), labels: []}));
  for (const st of cameraStates(cam)) for (const p of pts) {
    const q = project(cam, p.map(v => v * fit.k), st.theta, st.zoom, st.pan, cam.zoomCentre);
    assert.ok(q.x >= -0.5 && q.x <= 900.5 && q.y >= -0.5 && q.y <= 700.5, `${q.x},${q.y}`);
  }
  // Up is up the screen; toward the viewer is down it and nearer.
  const base = project(cam, [0, 0, 0]), up = project(cam, [0, 0, 100]), near = project(cam, [0, 100, 0]);
  assert.ok(up.y < base.y && near.y > base.y && near.s > base.s);
});

test('glass-bars-3d: data, highlight, marker and reference are validated', () => {
  const r = (params, aspect) => resolve('glass-bars-3d', params, aspect);
  const data = SAMPLES['glass-bars-3d'].data;
  assert.throws(() => r({data: data.slice(0, 1)}), /params\.data/);
  assert.throws(() => r({data, highlight: 'Nope'}), /params\.highlight must be an index or one of the labels/);
  assert.throws(() => r({data, marker: {text: '59%', steps: [0]}}), /params\.marker is drawn by the staircase variant only/);
  assert.throws(() => r({data, reference: {value: 25}, variant: 'staircase'}), /params\.reference is drawn by the bars variant only/);
  const model = r({data, reference: {value: 25, label: 'half'}, highlight: 1});
  assert.ok(model.content.reference.h > 0);
  assert.ok(model.events.some(e => e.name === 'highlight'));
  const stairs = resolve('glass-bars-3d', {...EXTRA_SAMPLES.find(e => e.module === 'glass-bars-3d').params, variant: 'staircase'}, '16:9');
  const hs = stairs.content.bars.map(bar => bar.h);
  assert.deepEqual([...hs].sort((a, c) => c - a), hs, 'staircase steps descend');
  assert.deepEqual(stairs.events.filter(e => e.name.startsWith('marker-')).map(e => e.name), ['marker-0', 'marker-1', 'marker-2']);
});

test('coin-stack: counts follow per, are capped, and every coin lands on its stack', () => {
  const r = params => resolve('coin-stack', params);
  assert.throws(() => r({stacks: [{label: 'A', value: 1}, {label: 'B', value: 100}], per: 1}), /params\.per must be between 6\.25 and 100/);
  assert.throws(() => r({stacks: [{label: 'A', value: 1, count: 17}]}), /params\.stacks\[0\]\.count/);
  assert.throws(() => r({stacks: [{label: 'A', value: 0}]}), /params\.stacks needs at least one value above 0/);
  const model = r(SAMPLES['coin-stack']);
  assert.deepEqual(model.content.stacks.map(s => s.coins), [1, 10]);
  const state = frameState(catalogHTimeline(model), model.motion.exitStart - 0.01);
  for (const [i, s] of model.content.stacks.entries()) for (let k = 0; k < s.coins; k++) {
    const props = state.get(`scene-c${i}-${k}`);
    assert.equal(props.y, 0, `coin ${i}/${k} landed`);
    assert.equal(props.scaleY, 1);
  }
  assert.ok(model.events.some(e => e.name === 'callout'));
});

test('rack-shelf: trays stack top-down, the focus slides out; rail cubes glide to their values', () => {
  const r = (params, aspect) => resolve('rack-shelf', params, aspect);
  assert.throws(() => r({rows: [{label: 'A'}, {label: 'B'}], variant: 'rail'}), /params\.rows\[0\]\.value/);
  assert.throws(() => r({rows: [{label: 'A'}, {label: 'B'}], axis: 'x'}), /params\.axis is the rail variant's caption/);
  assert.throws(() => r({rows: [{label: 'A', icon: 'nope'}, {label: 'B'}]}), /params\.rows\[0\]\.icon must be an icon name/);
  const rack = r(SAMPLES['rack-shelf']);
  const e = rack.content.trays.map(t => t.e);
  assert.deepEqual([...e].sort((a, c) => c - a), e, 'the first row is the top tray');
  const end = frameState(catalogHTimeline(rack), rack.motion.exitStart - 0.01);
  assert.equal(end.get(`scene-s${rack.content.focus}`).y, rack.content.slide, 'the focus tray slid out');
  assert.ok(end.get('scene-cam').scaleX > 1, 'the camera dollied in');
  const rail = r({...EXTRA_SAMPLES.find(x => x.name === 'rack-shelf-rail').params, variant: 'rail'}, '16:9');
  const xs = rail.content.cubes.map(c => c.x);
  assert.deepEqual([...xs].sort((a, c) => a - c), xs, 'cubes sit in value order');
  const railEnd = frameState(catalogHTimeline(rail), rail.motion.exitStart - 0.01);
  for (const i of xs.keys()) assert.equal(railEnd.get(`scene-g${i}`).x, 0, `cube ${i} reached its value`);
  assert.throws(() => r({rows: [{label: 'A', value: 5}, {label: 'B', value: 5.2}], variant: 'rail'}, '16:9'), /sits too close/);
});

test('device-box: the readout counts to its value, the clock ticks on whole seconds, fans spin', () => {
  const r = params => resolve('device-box', params);
  assert.throws(() => r({readout: {label: 'requests', to: 5}, clock: {start: '3:7:42'}}), /params\.clock\.start must be H:MM:SS/);
  assert.throws(() => r({readout: {to: 5}}), /params\.readout/);
  const model = r(SAMPLES['device-box']);
  const ops = catalogHTimeline(model);
  const end = frameState(ops, model.end - 0.06);
  assert.equal(end.get('scene-read').text, 'requests: 1,284');
  // Scene starts at 1 s: at 3.5 s, 2 whole seconds have passed since 03:17:42.
  assert.equal(frameState(ops, 3.5).get('scene-clkt').text, '03:17:44');
  assert.ok(frameState(ops, 3).get('scene-fan0a').rotation > frameState(ops, 2).get('scene-fan0a').rotation);
  assert.ok(model.events.some(e => e.name === 'readout'));
});

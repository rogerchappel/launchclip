// Catalogue I graph (kit/core/catalog-i-graph.mjs) and the fluid motion
// patterns it is built on (kit/core/fluid-motion.mjs): layout, beat-grid
// timing, pulses, idle and shake, and validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, catalogHTimeline, catalogHView} from '@launchclip/core/catalog-h.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {MOTION_CHECK} from '@launchclip/core/motion-check.mjs';
import {GRAMMARS} from '@launchclip/core/grammar.mjs';
import {PULSE} from '@launchclip/core/catalog-i-graph.mjs';
import {SHAKE_STEPS, beatGrid, idleAmplitude, idleOps} from '@launchclip/core/fluid-motion.mjs';
import {suggestModules} from '@launchclip/core/planning-prompt.mjs';
import {SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const resolve = (params = SAMPLES['node-graph'], {aspect = '9:16', duration = 10, grammar = null, hits = []} = {}) =>
  ({...MODULES['node-graph'].resolve(params, {id: 'scene', start: 1, duration, format: FORMATS[aspect], brand, aspect, hits, grammar}), module: 'node-graph'});
const boxOf = (model, n) => ({x: n.cx - model.content.card.width / 2, y: n.cy - model.content.card.height / 2, width: model.content.card.width, height: model.content.card.height});

test('node-graph: seven nodes fan above the hub inside the rect, no card touching another or the hub', () => {
  for (const aspect of ['9:16', '16:9']) {
    const model = resolve(undefined, {aspect});
    const {nodes, hub, card} = model.content;
    assert.equal(nodes.length, 7);
    for (const n of nodes) {
      const box = boxOf(model, n);
      assert.ok(box.x >= -1e-6 && box.x + box.width <= model.rect.width + 1e-6 && box.y >= -1e-6, `${aspect} ${n.id} inside the rect`);
      assert.ok(n.cy < hub.y, `${aspect} ${n.id} above the hub`);
      assert.ok(Math.hypot(Math.max(0, Math.abs(n.cx - hub.x) - card.width / 2), Math.max(0, Math.abs(n.cy - hub.y) - card.height / 2)) > hub.r, `${aspect} ${n.id} clear of the hub`);
    }
    nodes.forEach((a, i) => nodes.slice(i + 1).forEach(b => assert.ok(Math.abs(a.cx - b.cx) >= card.width - 1e-6 || Math.abs(a.cy - b.cy) >= card.height - 1e-6, `${a.id} and ${b.id} overlap`)));
    assert.ok(hub.y + hub.r + hub.pillH < model.rect.height, 'the hub label fits');
    assert.ok(card.labelSize >= 26 * model.unit);
  }
});

test('node-graph: timing lands on the beat grid; nodes land middle-first, converge on a bar line', () => {
  const model = resolve();
  const c = model.content, beat = 0.5;
  const onBeat = t => Math.abs((t - model.start) / beat - Math.round((t - model.start) / beat)) < 1e-6;
  assert.ok(onBeat(c.buildAt) && onBeat(c.convergeAt), 'build and converge on beats');
  assert.equal(Math.abs(((c.convergeAt - c.buildAt) / (4 * beat)) % 1), 0, 'converge on a bar line from the build');
  const byLanding = [...c.nodes].sort((a, b) => a.landAt - b.landAt);
  assert.equal(byLanding[0].id, 'n3', 'the middle node lands first');
  assert.deepEqual(model.events.map(e => e.name).filter(name => !name.startsWith('node-')), ['enter', 'build', 'converge']);
  // Pulses land on beats, every wire fires at converge, and no wire carries two pulses at once.
  for (const p of c.pulses) assert.ok(onBeat(p.arrive), `pulse at ${p.arrive}`);
  assert.equal(c.pulses.filter(p => p.arrive === c.convergeAt).length, 7);
  for (let k = 0; k < 7; k++) {
    const mine = c.pulses.filter(p => p.node === k).map(p => p.arrive);
    mine.slice(1).forEach((t, i) => assert.ok(t - mine[i] >= c.travel, `wire ${k} busy`));
    assert.ok(mine[0] - c.travel >= c.nodes[k].wireAt + 0.45 - 1e-6, `wire ${k} drawn before its first pulse`);
  }
  assert.ok(c.pulses.filter(p => p.arrive > c.convergeAt).length >= 5, 'pulses keep running after converge');
  // A slower tempo spreads them; a hit moves converge.
  assert.ok(resolve({...SAMPLES['node-graph'], bpm: 90}).content.beat > 0.66);
  assert.equal(resolve(undefined, {hits: [{event: 'converge', at: 6}]}).content.convergeAt, 6);
});

test('node-graph: at each moment the frame is the designed one', () => {
  const model = resolve();
  const c = model.content, ops = catalogHTimeline(model);
  const at = t => frameState(ops, t);
  assert.ok(catalogHView(model));
  // Before the build nothing shows; the cards start at the hub and land in the fan.
  assert.equal(at(model.start + 0.2).get('scene-hub').opacity, 0);
  const n0 = c.nodes[0];
  const early = at(n0.launchAt - 0.001).get('scene-node-n0');
  assert.ok(Math.abs(early.x - (c.hub.x - n0.cx)) < 1 && Math.abs(early.y - (c.hub.y - n0.cy)) < 1, 'n0 leaves from the hub');
  const landed = at(n0.landAt + 0.5).get('scene-node-n0');
  assert.ok(Math.abs(landed.x) < 0.01 && Math.abs(landed.y) < 0.01 && landed.rotation === n0.rotation);
  // A pulse runs node → hub; the hub ring flashes as it lands.
  const p = c.pulses[0], id = c.nodes[p.node].id;
  assert.equal(at(p.arrive - c.travel - 0.01).get(`scene-pulse-${id}`).strokeDashoffset, PULSE.length);
  assert.ok(at(p.arrive - c.travel / 2).get(`scene-pulse-${id}`).strokeDashoffset < PULSE.length);
  assert.equal(at(p.arrive).get(`scene-pulse-${id}`).strokeDashoffset, -1);
  assert.ok(at(p.arrive + 0.05).get('scene-hub-ring').opacity > 0.5);
  // Converge: the camera shakes and is back at rest; the nodes ripple.
  const cam = at(c.convergeAt + 0.06).get('scene-cam');
  assert.ok(Math.abs(cam.x) > 1, 'the camera is displaced on impact');
  const rest = at(c.convergeAt + SHAKE_STEPS.length * 0.06 + 0.01).get('scene-cam');
  assert.equal(rest.x, 0); assert.equal(rest.y, 0);
  assert.ok(at(c.convergeAt + 0.2).get('scene-node-n0').y < 0, 'the wave lifts the first node');
  // A settled frame still breathes; every idle half-cycle is continuous motion, and it rests before the exit.
  assert.ok(Math.abs(at(c.convergeAt + 2.3).get('scene-node-n2-idle').y) > 0.5);
  for (const op of ops.filter(o => o.type === 'tween' && /-idle$/.test(o.target))) assert.ok(op.duration > MOTION_CHECK.gesture);
  assert.deepEqual(at(model.motion.exitStart).get('scene-node-n2-idle'), {y: 0, rotation: 0});
});

test('fluid motion: idle scales with the grammar, ends at rest, and the beat grid snaps forward', () => {
  assert.ok(idleAmplitude(GRAMMARS.playful, 1).bob > idleAmplitude(GRAMMARS.editorial, 1).bob);
  assert.ok(idleAmplitude(GRAMMARS.documentary, 1).bob < idleAmplitude(null, 1).bob);
  const ops = [];
  idleOps(ops, 'x-idle', 0, 1, 9, {bob: 6, tilt: 1});
  const last = ops.at(-1);
  assert.deepEqual(last.to, {y: 0, rotation: 0});
  assert.ok(last.start + last.duration <= 9 + 1e-6);
  const short = [];
  idleOps(short, 'y-idle', 0, 1, 2, {bob: 6, tilt: 1});
  assert.equal(short.length, 1, 'too short to breathe: only the rest set');
  const grid = beatGrid(120, 1);
  assert.equal(grid.snap(1.2), 1.5);
  assert.equal(grid.snap(1.5), 1.5);
  for (let i = 1; i < SHAKE_STEPS.length; i++) assert.ok(Math.abs(SHAKE_STEPS[i][0]) <= Math.abs(SHAKE_STEPS[i - 1][0]), 'shake decays');
});

test('node-graph: validation and the planner phrase table', () => {
  assert.throws(() => resolve({hub: 'Lead', nodes: ['A', 'B']}), /params\.nodes/);
  assert.throws(() => resolve({hub: 'Lead', nodes: ['A', 'B', {label: 'C', icon: 'not-an-icon'}]}), /must be an icon name/);
  assert.throws(() => resolve({hub: 'Lead', nodes: ['A', 'B', 'An overly long label']}), /params\.nodes\[2\]\.label/);
  assert.throws(() => resolve({hub: 'Lead', nodes: ['A', 'B', 'C'], bpm: 400}), /params\.bpm/);
  assert.throws(() => resolve(undefined, {duration: 3}), /lengthen the scene|must fall between/);
  const three = resolve({hub: 'Lead', nodes: ['Plan', 'Build', 'Ship']});
  assert.equal(three.content.nodes.length, 3);
  assert.ok(suggestModules('Seven agents work together and each one reports back to the director.').some(row => row.modules.includes('node-graph')));
});

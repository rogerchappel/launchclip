// The member hookup (kit/core/members.mjs, docs/FLUID_MOTION_RFC.md §10): a set
// module takes a member module in place of its default member, through the same
// calls that take a planner-drawn graphic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, catalogHTimeline, catalogHView} from '@launchclip/core/catalog-h.mjs';
import {el} from '@launchclip/core/catalog-b-view.mjs';
import {MEMBERS} from '@launchclip/core/members.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const resolve = (module, params) => ({...MODULES[module].resolve(params, {id: 's', start: 0, duration: 10, format: {width: 1080, height: 1920, fps: 30}, brand, aspect: '9:16', hits: []}), module});
const ids = node => [node.id, ...(Array.isArray(node.children) ? node.children : []).flatMap(child => typeof child === 'object' ? ids(child) : [])].filter(Boolean);

// A stand-in member: twice a card's height, glows, and fades its own dot in once landed.
const seen = {};
const stub = {
  id: 'test-member', describe: 'a stand-in', params: {label: 'string'}, face: 'glow',
  spec(check, raw, path, opts) { seen.base = Boolean(opts.base); return {label: check.str(raw.label, `${path}.label`, opts.labelMax ?? 14)}; },
  width: (spec, L) => (spec.label.length * 0.6 + 2) * L,
  height: (spec, I, L) => 2 * (I * 2 + L * 1.25),
  nodes: (spec, W, H, look) => [el('div', `${look.key}-dot`, {position: 'absolute', left: 0, top: 0, width: W, height: H})],
  timeline: (ops, spec, at) => ops.push({type: 'set', target: `${at.key}-dot`, time: at.landAt, props: {opacity: 1}})
};

test('members: a set module takes a member module through the graphic hookup', t => {
  MEMBERS[stub.id] = stub;
  t.after(() => delete MEMBERS[stub.id]);
  const member = {module: 'test-member', label: 'Proofing'};

  const graph = resolve('node-graph', {hub: 'Lead', nodes: ['Mix', {member, id: 'p'}, {graphic: {kind: 'chip', label: 'Bake'}}]});
  const p = graph.content.nodes[1];
  assert.equal(p.graphic.module, 'test-member');
  assert.equal(p.label, 'Proofing');
  assert.ok(seen.base, 'the member sees the set base');
  assert.ok(graph.content.card.height >= stub.height(p.graphic, graph.content.card.icon, graph.content.card.labelSize) - 1e-6, 'every node takes the tallest member');
  const all = ids(catalogHView(graph));
  for (const id of ['s-node-p', 's-node-p-idle', 's-node-p-lit', 's-g-p-dot']) assert.ok(all.includes(id), id);
  assert.ok(catalogHTimeline(graph).some(op => op.target === 's-g-p-dot' && op.time === p.landAt), 'its own ops land with it');

  const grid = resolve('icon-grid', {items: ['star', {member}]});
  const cell = grid.content.cells[1];
  assert.ok(cell.gh <= grid.content.cellH - 16 * grid.unit + 1e-6, 'a tall member takes a smaller icon to fit its cell');
  assert.ok(ids(catalogHView(grid)).includes('s-g-1-dot'));
  assert.ok(catalogHTimeline(grid).some(op => op.target === 's-g-1-dot'));

  assert.throws(() => resolve('node-graph', {hub: 'Lead', nodes: ['A', 'B', {member: {module: 'nope'}}]}), /nodes\[2\].member.module must be one of/);
  assert.throws(() => resolve('node-graph', {hub: 'Lead', nodes: ['A', 'B', {member, graphic: {kind: 'chip', label: 'x'}}]}), /nodes\[2\].member replaces the graphic/);
  assert.throws(() => resolve('icon-grid', {items: ['star', {member, label: 'x'}]}), /items\[1\].member replaces icon and label/);
});

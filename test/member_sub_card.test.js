// sub-card (kit/core/member-sub-card.mjs): a member module with a second line
// under its label, joining node-graph and icon-grid through kit/core/members.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, catalogHTimeline, catalogHView} from '@launchclip/core/catalog-h.mjs';
import {textWidth} from '@launchclip/core/catalog-b-base.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const resolve = (module, params, aspect = '9:16') => ({...MODULES[module].resolve(params, {id: 's', start: 0, duration: 10, format: FORMATS[aspect], brand, aspect, hits: []}), module});
const find = (node, id) => node.id === id ? node : (Array.isArray(node.children) ? node.children : []).filter(c => typeof c === 'object').map(c => find(c, id)).find(Boolean);
const sub = (label, line, icon) => ({member: {module: 'sub-card', label, sub: line, ...(icon ? {icon} : {})}});
const TEAM = [sub('Baker', '3 a.m. start', 'croissant'), sub('Proof', '90 min rise', 'timer'), sub('Oven', '230 °C', 'flame'), sub('Pastry', 'laminated'), 'Orders'];

test('sub-card: node-graph draws the second line inside every card, and the cards fit the line', () => {
  for (const aspect of ['9:16', '16:9']) {
    const model = resolve('node-graph', {hub: 'Head chef', nodes: TEAM}, aspect);
    const C = model.content.card;
    const view = catalogHView(model);
    model.content.nodes.slice(0, 4).forEach((n, i) => {
      assert.equal(n.graphic.module, 'sub-card');
      const line = find(view, `s-g-${n.id}-sub`);
      assert.ok(line, `${aspect} ${n.id} has its sub`);
      assert.equal(line.children[0], TEAM[i].member.sub);
      assert.ok(line.style.top + C.labelSize * 1.25 <= C.height + 1e-6, `${aspect} ${n.id} sub inside the card`);
      assert.ok(textWidth(n.graphic.sub, C.labelSize, 'meta') <= C.width, `${aspect} ${n.id} sub fits the card`);
      assert.ok(C.labelSize >= 26 * model.unit, `label size ${C.labelSize}`);
    });
    // The plain node takes the same (taller) card, and the sub-cards still light their rim and breathe.
    const ops = catalogHTimeline(model);
    for (const n of model.content.nodes) assert.ok(ops.some(op => op.target === `s-node-${n.id}-idle` && op.type === 'tween'));
  }
});

test('sub-card: icon-grid fits the second line in its cell', () => {
  const model = resolve('icon-grid', {items: TEAM.slice(0, 4).concat([{icon: 'coffee', label: 'Coffee'}])});
  const c = model.content;
  for (const cell of c.cells.filter(cell => cell.graphic)) {
    assert.ok(cell.gh <= c.cellH - 16 * model.unit + 1e-6, 'inside its cell');
    assert.ok(textWidth(cell.graphic.sub, cell.gL, 'meta') <= cell.gw + 1e-6, 'the sub fits');
  }
  assert.ok(find(catalogHView(model), 's-g-0-sub'));
});

test('sub-card: validation says what to change', () => {
  const nodes = extra => ({hub: 'Lead', nodes: ['A', 'B', {member: {module: 'sub-card', label: 'C', sub: 'x', ...extra}}]});
  assert.throws(() => resolve('node-graph', nodes({sub: undefined})), /member.sub is required/);
  assert.throws(() => resolve('node-graph', nodes({sub: 'a line that runs far too long'})), /member.sub must be a string of 1–24/);
  assert.throws(() => resolve('node-graph', nodes({color: 'red'})), /member.color is not supported/);
  assert.throws(() => resolve('node-graph', nodes({icon: 'chefhat'})), /member.icon must be an icon name/);
  assert.throws(() => resolve('icon-grid', {columns: 6, items: Array.from({length: 6}, () => sub('Pastry', '24 characters of detail'))}), /does not fit/);
});

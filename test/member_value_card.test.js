// value-card (kit/core/member-value-card.mjs): a member module whose face is a
// value too long for a badge, joining node-graph and icon-grid through
// kit/core/members.mjs without breaking their layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, catalogHTimeline, catalogHView} from '@launchclip/core/catalog-h.mjs';
import {textWidth} from '@launchclip/core/catalog-b-base.mjs';
import {graphicSpec} from '@launchclip/core/graphic.mjs';
import {makeCheck} from '@launchclip/core/catalog-b-base.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const resolve = (module, params, aspect = '9:16') => ({...MODULES[module].resolve(params, {id: 's', start: 0, duration: 10, format: FORMATS[aspect], brand, aspect, hits: []}), module});
const find = (node, id) => node.id === id ? node : (Array.isArray(node.children) ? node.children : []).filter(c => typeof c === 'object').map(c => find(c, id)).find(Boolean);
const value = (v, label) => ({member: {module: 'value-card', value: v, ...(label ? {label} : {})}});
const SET = [value('$7.15', 'Per task'), value('×3.2', 'Faster'), value('1,250', 'Runs'), value('$0.04'), 'Tokens'];

test('value-card: node-graph sizes every card to its longest value, in the display face and the member colour', () => {
  for (const aspect of ['9:16', '16:9']) {
    const model = resolve('node-graph', {hub: 'Model', nodes: SET}, aspect);
    const C = model.content.card;
    const view = catalogHView(model);
    model.content.nodes.slice(0, 4).forEach((n, i) => {
      const text = find(view, `s-g-${n.id}-value`);
      assert.equal(text.children[0], SET[i].member.value);
      assert.equal(text.style.fontFamily, model.fonts.display);
      assert.equal(text.style.color, n.color);
      assert.ok(textWidth(n.graphic.value, text.style.fontSize, 'display') <= C.width - C.labelSize + 1e-6, `${aspect} ${n.graphic.value} fits its card`);
      assert.ok(text.style.top + text.style.fontSize * 1.1 <= C.height + 1e-6, `${aspect} ${n.graphic.value} inside its card`);
    });
    assert.ok(C.labelSize >= 26 * model.unit);
    const ops = catalogHTimeline(model);
    for (const n of model.content.nodes) assert.ok(ops.some(op => op.target === `s-node-${n.id}-idle` && op.type === 'tween'));
  }
});

test('value-card: a long value keeps the icon-grid in its cells', () => {
  for (const aspect of ['9:16', '16:9']) {
    const model = resolve('icon-grid', {items: [value('$1,250.00', 'Saved'), value('×12.5', 'Faster'), 'star', {icon: 'coffee', label: 'Coffee'}]}, aspect);
    const c = model.content;
    for (const cell of c.cells.filter(cell => cell.graphic)) {
      assert.ok(cell.gw <= c.cellW - 16 * model.unit + 1e-6 && cell.gh <= c.cellH - 16 * model.unit + 1e-6, `${aspect} ${cell.graphic.value} inside its cell`);
      assert.ok(textWidth(cell.graphic.value, cell.gL * 1.9, 'display') <= cell.gw + 1e-6, `${aspect} ${cell.graphic.value} fits`);
    }
  }
  assert.throws(() => resolve('icon-grid', {columns: 6, items: Array.from({length: 6}, () => value('$1,250.00'))}), /does not fit/);
});

test('value-card: validation says what to change, and a badge past three characters points here', () => {
  const nodes = member => ({hub: 'Lead', nodes: ['A', 'B', {member: {module: 'value-card', ...member}}]});
  assert.throws(() => resolve('node-graph', nodes({label: 'x'})), /member.value is required/);
  assert.throws(() => resolve('node-graph', nodes({value: '$1,234,567.89'})), /member.value must be a string of 1–10/);
  assert.throws(() => resolve('node-graph', nodes({value: '$7', icon: 'star'})), /member.icon is not supported/);
  assert.equal(resolve('node-graph', nodes({value: 42})).content.nodes[2].graphic.value, '42');
  const check = makeCheck('');
  assert.throws(() => graphicSpec(check, {kind: 'card', label: 'Cost', badge: '$7.15'}, 'g'), /g.badge must be a string of 1–3 characters; that is the value-card member's job/);
  assert.throws(() => graphicSpec(check, {kind: 'card', label: 'Cost', value: '$7.15'}, 'g'), /g.value is not supported.*value-card member's job/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {PENS, PEN_INK, penNode, penTipLift} from '@launchclip/core/sketch-pens.mjs';

const walk = (node, out = []) => {
  if (node && typeof node === 'object') { out.push(node); for (const c of node.children ?? []) walk(c, out); }
  return out;
};
const strings = node => walk(node).flatMap(n => (n.children ?? []).filter(c => typeof c === 'string'));

test('every pen builds a tip-anchored node with unique prefixed ids', () => {
  for (const kind of PENS) {
    const node = penNode('pen', kind, {u: 1.5, ink: '#1f5fbf', barrel: {text: 'Acme'}});
    assert.equal(node.tag, 'div');
    assert.equal(node.id, 'pen');
    assert.equal(node.style.left, 0);
    assert.equal(node.style.top, 0);
    const ids = walk(node).map(n => n.id).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.ok(id === 'pen' || id.startsWith('pen-'), id);
    assert.ok(walk(node).some(n => n.tag === 'svg'));
    assert.ok(PEN_INK[kind].width > 0 && PEN_INK[kind].opacity > 0 && PEN_INK[kind].cap);
    assert.ok(penTipLift(kind) > 0);
  }
});

test('barrel text appears only when given and is refused past 24 chars', () => {
  for (const kind of PENS) {
    assert.deepEqual(strings(penNode('a', kind, {ink: '#000000'})), []);
    assert.deepEqual(strings(penNode('a', kind, {ink: '#000000', barrel: {text: 'Sponsor Name'}})), ['Sponsor Name']);
    assert.ok(walk(penNode('a', kind, {barrel: {text: 'x'.repeat(24)}})).some(n => n.id === 'a-label'));
    assert.throws(() => penNode('a', kind, {barrel: {text: 'x'.repeat(25)}}), /max 24/);
  }
});

test('no SVG text tags and unknown pens are refused', () => {
  for (const kind of PENS) {
    const tags = walk(penNode('a', kind, {barrel: {text: 'Label'}})).map(n => n.tag);
    assert.ok(!tags.includes('text') && !tags.includes('tspan'));
  }
  assert.throws(() => penNode('a', 'crayon', {}), /unknown pen/);
  assert.throws(() => penTipLift('crayon'), /unknown pen/);
});

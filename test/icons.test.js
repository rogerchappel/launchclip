// The icon set (kit/core/icons.mjs): stable names, valid path data, one stroke weight.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ICONS, ICON_BOX, ICON_NAMES, ICON_STROKE, iconNode, iconPath, isIcon} from '../kit/core/icons.mjs';
import {renderNode} from '../kit/hyperframes/catalog-b.mjs';

test('about 120 or more icons with stable kebab-case names', () => {
  assert.ok(ICON_NAMES.length >= 120, `${ICON_NAMES.length} icons`);
  for (const name of ICON_NAMES) assert.match(name, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, name);
  // Names the planner and the catalogue rely on.
  for (const name of ['shield', 'rocket', 'code', 'bolt', 'calendar', 'chart-up', 'users', 'lock', 'check', 'box', 'boat', 'laptop'])
    assert.ok(isIcon(name), name);
});

test('every icon is plain path data inside the 24-unit box', () => {
  for (const [name, d] of Object.entries(ICONS)) {
    assert.match(d, /^M[\d.\- ,MLHVCQAZmlhvcqaz]+$/, name);
    assert.doesNotMatch(d, /NaN|undefined/, name);
    // Absolute coordinates stay in the box (relative arcs and curves are local).
    for (const [, nums] of d.matchAll(/[MLHVCQ]([\d.\- ]+)/g))
      for (const value of nums.trim().split(/\s+/).map(Number)) assert.ok(value >= 0 && value <= ICON_BOX, `${name}: ${value}`);
  }
});

test('iconPath names close matches for an unknown icon', () => {
  assert.equal(iconPath('shield'), ICONS.shield);
  assert.throws(() => iconPath('chart'), /did you mean chart-up/);
  assert.throws(() => iconPath(undefined), /unknown icon/);
});

test('iconNode draws one round-capped stroked path, tinted, in both renderers\' view shape', () => {
  const node = iconNode('rocket', {id: 'x-icon', x: 10, y: 20, size: 96, color: '#fdb022'});
  assert.equal(node.tag, 'svg');
  assert.equal(node.attrs.viewBox, '0 0 24 24');
  const path = node.children[0];
  assert.equal(path.tag, 'path');
  assert.deepEqual({stroke: path.attrs.stroke, width: path.attrs.strokeWidth, cap: path.attrs.strokeLinecap, fill: path.attrs.fill}, {stroke: '#fdb022', width: ICON_STROKE, cap: 'round', fill: 'none'});
  const html = renderNode(node);
  assert.match(html, /^<svg id="x-icon" width="96" height="96" viewBox="0 0 24 24"/);
  assert.match(html, /stroke-linecap="round"/);
});

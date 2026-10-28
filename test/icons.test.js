// The icon set (kit/core/icons.mjs): stable names, valid path data, one stroke
// weight; LaunchClip's own drawings plus the vendored Lucide set.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ICONS, ICON_BOX, ICON_NAMES, ICON_SOLIDS, ICON_SOURCES, ICON_STROKE, ICON_STYLES, closedPath, iconNode, iconPath, isIcon} from '@launchclip/core/icons.mjs';
import {LUCIDE, LUCIDE_VERSION} from '@launchclip/core/icons-lucide.mjs';
import {renderNode} from '../kit/hyperframes/catalog-b.mjs';

test('over 1000 icons with stable kebab-case names', () => {
  assert.ok(ICON_NAMES.length >= 1000, `${ICON_NAMES.length} icons`);
  for (const name of ICON_NAMES) assert.match(name, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, name);
  // Names the planner and the catalogue rely on.
  for (const name of ['shield', 'rocket', 'code', 'bolt', 'calendar', 'chart-up', 'users', 'lock', 'check', 'box', 'boat', 'laptop'])
    assert.ok(isIcon(name), name);
});

// Every absolute point a path visits (endpoints and control points), for a
// box check. Arc flags may be packed ("a5 5 0 017.07 0": flags 0 and 1).
function pathPoints(d) {
  const src = String(d);
  const arity = {M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0};
  const points = [];
  let i = 0, cmd = null, x = 0, y = 0, sx = 0, sy = 0;
  const skip = () => { while (i < src.length && /[\s,]/.test(src[i])) i++; };
  const number = () => {
    skip();
    const match = /^-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/.exec(src.slice(i));
    if (!match) throw new Error(`expected a number at ${i} in ${src.slice(0, 40)}`);
    i += match[0].length;
    return Number(match[0]);
  };
  const flag = () => { skip(); const f = src[i++]; if (f !== '0' && f !== '1') throw new Error(`bad arc flag in ${src.slice(0, 40)}`); return Number(f); };
  for (skip(); i < src.length; skip()) {
    if (/[A-Za-z]/.test(src[i])) cmd = src[i++];
    const up = cmd.toUpperCase(), rel = cmd !== up;
    if (!(up in arity)) throw new Error(`unknown command ${cmd}`);
    if (up === 'Z') { x = sx; y = sy; continue; }
    const args = Array.from({length: arity[up]}, (_, k) => (up === 'A' && (k === 3 || k === 4) ? flag() : number()));
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (up === 'H') x = ox + args[0];
    else if (up === 'V') y = oy + args[0];
    else if (up === 'A') { x = ox + args[5]; y = oy + args[6]; }
    else {
      for (let k = 0; k < args.length; k += 2) points.push([ox + args[k], oy + args[k + 1]]);
      [x, y] = points.at(-1);
    }
    points.push([x, y]);
    if (up === 'M') { sx = x; sy = y; cmd = rel ? 'l' : 'L'; }
  }
  return points;
}

test('every icon is plain path data inside the 24-unit box', () => {
  for (const [name, d] of Object.entries(ICONS)) {
    assert.match(d, /^M[\d.\- ,MLHVCSQTAZmlhvcsqtaz]+$/, name);
    assert.doesNotMatch(d, /NaN|undefined/, name);
    for (const [px, py] of pathPoints(d)) assert.ok(px >= -0.01 && px <= ICON_BOX + 0.01 && py >= -0.01 && py <= ICON_BOX + 0.01, `${name}: ${px}, ${py}`);
  }
});

test('Lucide is vendored whole, and LaunchClip keeps its own drawings on a shared name', () => {
  assert.match(LUCIDE_VERSION, /^\d+\.\d+\.\d+$/);
  assert.ok(Object.keys(LUCIDE).length >= 1500);
  for (const name of Object.keys(LUCIDE)) assert.ok(isIcon(name), name);
  // A shared name draws LaunchClip's geometry; a Lucide-only name draws Lucide's.
  assert.equal(ICON_SOURCES.rocket, 'launchclip');
  assert.notEqual(ICONS.rocket, Array.isArray(LUCIDE.rocket) ? LUCIDE.rocket[0] : LUCIDE.rocket);
  assert.equal(ICON_SOURCES['a-arrow-down'], 'lucide');
  assert.deepEqual(ICON_NAMES.slice(0, 3), ['check', 'x', 'plus'], 'LaunchClip\'s own come first');
  for (const d of Object.values(ICON_SOLIDS)) assert.ok(pathPoints(d).length);
});

test('duotone tints the closed shapes under the stroke; stroke-only icons stay plain', () => {
  assert.deepEqual(ICON_STYLES, ['stroke', 'duotone']);
  const duo = iconNode('shield', {mode: 'duotone', color: '#fdb022'});
  assert.equal(duo.children.length, 2);
  assert.deepEqual({fill: duo.children[0].attrs.fill, opacity: duo.children[0].attrs.fillOpacity, stroke: duo.children[0].attrs.stroke}, {fill: '#fdb022', opacity: 0.28, stroke: 'none'});
  assert.equal(duo.children[1].attrs.fill, 'none', 'the stroke stays on top');
  assert.equal(iconNode('arrow-right', {mode: 'duotone'}).children.length, 1, 'an open icon has nothing to tint');
  assert.equal(closedPath('M1 1 L5 5 M2 2 h4 v4 Z'), 'M2 2 h4 v4 Z');
  assert.throws(() => iconNode('shield', {mode: 'filled'}), /icon mode/);
  const dots = Object.keys(ICON_SOLIDS)[0];
  assert.equal(iconNode(dots).children.at(-1).attrs.fill, '#ffffff', 'filled dots draw solid');
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

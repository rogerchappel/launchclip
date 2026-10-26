// Layers that overflow their box on purpose say so to layout audits
// (hyperframes check: data-layout-allow-overflow), so a strict check does not
// fail on a card's panel-fill pattern or a world's overscan.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cardSurface} from '../kit/core/catalog-g-base.mjs';
import {layerNode} from '../kit/core/worlds/view.mjs';
import {renderNode} from '../kit/hyperframes/catalog-b.mjs';

test('a card panel fill and a world layer mark their intended overflow', () => {
  const theme = {bg: '#0a0706', paper: '#fdfdfd', ink: '#0a0706', primary: '#fb6302', accent: '#fa9108', border: '#333333', foreground: '#fdfdfd'};
  const card = cardSurface({surface: 'card', theme, unit: 1, rect: {x: 0, y: 0, width: 400, height: 200},
    panel: {treatment: 'solid', radius: 24, fill: {styles: [{position: 'absolute', left: -100, top: -100, width: 600, height: 400}], mask: {}}}});
  assert.match(renderNode(card), /<div data-layout-allow-overflow="true" style="[^"]*overflow:\s*hidden/);
  assert.doesNotMatch(renderNode(cardSurface({surface: 'card', theme, unit: 1, rect: {x: 0, y: 0, width: 400, height: 200}, panel: {treatment: 'solid', radius: 24}})), /allow-overflow/, 'a card without a fill marks nothing');
  const world = {canvas: {width: 1920, height: 1080}, overscan: 120, defs: {}, layers: {back: []}, detail: {}};
  assert.match(renderNode(layerNode(world, 'back', 'w')), /^<div id="w-back" data-layout-allow-overflow="true"/);
});

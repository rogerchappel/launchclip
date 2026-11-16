// sprout (kit/core/catalog-i-graph.mjs; docs/FLUID_MOTION_RFC.md §6.4):
// labels branch out of another scene's anchor on node-graph's wires, in one
// scene and across a pinned cut.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveStory} from '@launchclip/core/story.mjs';
import {resolveModule, sceneAnchors} from '@launchclip/core/modules.mjs';
import {catalogHTimeline, catalogHView} from '@launchclip/core/catalog-h.mjs';

const sample = () => JSON.parse(readFileSync(new URL('../examples/story/sprout-ad-card-9x16/storyboard.json', import.meta.url), 'utf8'));
const model = (raw, id) => { const story = resolveStory(raw); return resolveModule(story.scenes.find(scene => scene.id === id), story); };
const withGrow = edit => { const raw = sample(); edit(raw.scenes.find(scene => scene.id === 'grow'), raw); return model(raw, 'grow'); };
const ids = node => [node.id, ...(node.children ?? []).flatMap(ids)].filter(Boolean);

test('Copy and Images grow out of the ad card\'s bottom edge, nearest first, each landing as its wire arrives', () => {
  const raw = sample(), story = resolveStory(raw);
  const card = sceneAnchors(story, 'ad').card, grow = model(raw, 'grow'), c = grow.content;
  assert.equal(c.side, 'below');
  const bottom = card.y + card.height / 2 - grow.rect.y;
  for (const n of c.branches) {
    assert.equal(n.sy, bottom, `${n.label} leaves the card's edge`);
    assert.ok(Math.abs(n.sx + grow.rect.x - card.x) <= card.width * 0.3 + 1e-6, `${n.label} leaves the card's middle`);
    assert.ok(n.ey > n.sy && n.cy > n.ey, `${n.label} hangs below its wire`);
    assert.ok(n.wireAt >= card.time && Math.abs(n.landAt - n.wireAt - 0.4) < 1e-6);
  }
  assert.deepEqual(c.branches.map(n => n.label), ['Copy', 'Images']);
  assert.ok(c.growAt >= card.time, 'grows once the card has landed');
  const ops = catalogHTimeline(grow), view = ids({children: catalogHView(grow).children ?? []});
  for (const n of c.branches) for (const part of ['wire', 'flow', 'pulse']) assert.ok(view.includes(`grow-${part}-${n.id}`), `node-graph's ${part} stroke`);
  // Every pulse's label lights as the pulse arrives.
  for (const pulse of c.pulses) {
    const n = c.branches[pulse.branch];
    assert.ok(ops.some(op => op.target === `grow-label-${n.id}-lit` && Math.abs(op.start + op.duration - pulse.arrive) < 1e-6), `${n.label} lit at ${pulse.arrive}`);
  }
  assert.deepEqual([...new Set(c.pulses.map(pulse => pulse.branch))].sort(), [0, 1], 'pulses take turns');
});

test('across the pinned cut: the wires stay attached, and Video grows from the previous scene\'s card', () => {
  const raw = sample(), story = resolveStory(raw);
  assert.ok(sceneAnchors(story, 'ad').card.until >= model(raw, 'grow').end, 'the pin keeps the card on screen');
  const held = model(raw, 'ad-held');
  assert.ok(held.carry.in.items.every(item => item.pin), 'the card is pinned, not rebuilt');
  const more = model(raw, 'grow-more');
  assert.equal(more.content.side, 'right');
  assert.ok(more.content.growAt > 3.5, 'grows in the next scene');
});

test('the root only fades, so the wires never slide off their source', () => {
  const grow = withGrow(() => {});
  assert.deepEqual(grow.motion.enterFrom, {opacity: 0, x: 0, y: 0, scale: 1});
  assert.deepEqual(grow.motion.exitTo, {opacity: 0, x: 0, y: 0, scale: 1});
});

test('errors: an unknown anchor or scene, a source that leaves first, growing before it lands, labels that do not fit', () => {
  assert.throws(() => withGrow(scene => { scene.params.from.anchor = 'logo'; }), /params\.from scene "ad" has no anchor "logo" \(anchors: card, icon\)/);
  assert.throws(() => withGrow(scene => { scene.params.from.scene = 'nope'; }), /params\.from scene "nope" is not in the story/);
  assert.throws(() => withGrow((scene, raw) => { delete raw.scenes[1].carry; }), /params\.from anchor "card" of scene "ad" leaves at 3\.5 s, before this scene ends at 9 s; pin ad-card into the next scene/);
  assert.throws(() => withGrow((scene, raw) => { raw.scenes[0].params.at = 0.6; scene.params.at = 0.55; }), /params\.at grows at 0\.55 s, before anchor "card" of scene "ad" lands at 0\.6 s/);
  assert.throws(() => withGrow(scene => { scene.params.side = 'above'; }), /params\.side do not fit above/);
  assert.throws(() => withGrow(scene => { scene.params.branches = ['a', 'b', 'c', 'd', 'e']; }), /params\.branches/);
});

test('sprout is registered in both renderers but skips the single-scene harnesses', async () => {
  const {MODULES} = await import('@launchclip/core/catalog-h.mjs');
  const {EMITTERS} = await import('../kit/hyperframes/catalog-h.mjs');
  assert.ok(MODULES.sprout && EMITTERS.sprout);
  assert.equal(MODULES.sprout.standalone, false);
  assert.equal(MODULES['node-graph'].standalone, true);
});

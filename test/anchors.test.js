// Anchors (kit/core/anchors.mjs; docs/FLUID_MOTION_RFC.md §7): node-graph
// publishes its hub, cards and converge; cast cues aim at them and default
// their time to the anchor's.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveStory} from '@launchclip/core/story.mjs';
import {resolveModule, sceneAnchors} from '@launchclip/core/modules.mjs';

const golden = () => JSON.parse(readFileSync(new URL('../examples/story/node-graph-9x16/storyboard.json', import.meta.url), 'utf8'));
const withCues = (cues, edit = story => story) => {
  const story = golden();
  story.scenes[0].params.cast[0].cues = cues;
  return resolveStory(edit(story));
};
const castModel = story => resolveModule(story.scenes.find(scene => scene.id === 'room'), story);

test('node-graph publishes hub, converge and node-<id> at their events, centred on their elements', () => {
  const story = resolveStory(golden());
  const graph = resolveModule(story.scenes.find(scene => scene.id === 'team'), story);
  const anchors = sceneAnchors(story, 'team');
  const {hub, nodes} = graph.content;
  const eventTime = name => graph.events.find(event => event.name === name).time;
  assert.deepEqual(Object.keys(anchors).sort(), ['converge', 'hub', ...nodes.map(n => `node-${n.id}`)].sort());
  assert.deepEqual([anchors.hub.x, anchors.hub.y], [graph.rect.x + hub.x, graph.rect.y + hub.y]);
  assert.equal(anchors.hub.time, eventTime('build'));
  assert.equal(anchors.converge.time, eventTime('converge'));
  for (const n of nodes) {
    const anchor = anchors[`node-${n.id}`];
    assert.ok(Math.abs(anchor.x - (graph.rect.x + n.cx)) < 0.02 && Math.abs(anchor.y - (graph.rect.y + n.cy)) < 0.02, `node-${n.id} at its card centre`);
    assert.equal(anchor.time, eventTime(`node-${n.id}`));
  }

// The topic fit table (kit/core/worlds/fit.mjs): prompts → the worlds,
// props and time that fit them, for art direction.
import test from 'node:test';
import assert from 'node:assert/strict';
import {WORLD_KINDS, PROP_IDS, TOPIC_FIT, suggestWorld} from '../kit/core/worlds/index.mjs';
import {planningPrompt} from '../kit/core/planning-prompt.mjs';

test('topic fit: suggestWorld maps prompts to fitting worlds, props and time', () => {
  const fit = prompt => suggestWorld(prompt);
  assert.equal(fit('A 30 second recipe video for a quick pasta dinner').kind, 'kitchen');
  assert.deepEqual(fit('Cooking for one').worlds, ['kitchen', 'cafe']);
  assert.equal(fit('Our new fitness tracker for your morning workout').kind, 'gym');
  assert.equal(fit('Launch video for our open source CLI for developers').topic, 'developer tools');
  assert.equal(fit('Launch video for our open source CLI for developers').kind, 'home-desk');
  assert.equal(fit('A late night coding session').time, 'night');
  assert.equal(fit('Hiking at sunset in the mountains').time, 'dusk');
  assert.equal(fit('Hiking at sunset in the mountains').kind, 'forest');
  assert.equal(fit('cookie consent banners explained'), null, 'whole words only');
  assert.equal(fit('Budgeting tips for the finance team').topic, 'finance');
  for (const row of TOPIC_FIT) {
    for (const kind of row.worlds) assert.ok(WORLD_KINDS.includes(kind), `${row.topic}: ${kind}`);
    for (const id of row.props) assert.ok(PROP_IDS.includes(id), `${row.topic}: ${id}`);
  }
});

test('the planner knows the world module and story.world', () => {
  const prompt = planningPrompt({tier: 'guided', lane: 'motion', format: {width: 1920, height: 1080, fps: 30, duration: 30}, brand: {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}}});
  assert.match(prompt, /world\? \(optional\): \{kind: office \|/);
  assert.match(prompt, /\| world\b/);
});

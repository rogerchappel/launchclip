// Catalogue I people (kit/core/catalog-i-people.mjs): person-id and
// lineage-graph layout, reveal order and validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, catalogHTimeline, catalogHView} from '@launchclip/core/catalog-h.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const resolve = (id, params = SAMPLES[id], aspect = '16:9') => ({...MODULES[id].resolve(params, {id: 'scene', start: 1, duration: 6, format: FORMATS[aspect], brand, aspect, hits: []}), module: id});
const end = model => frameState(catalogHTimeline(model), model.motion.exitStart - 0.01);
const find = (node, pred) => (pred(node) ? node : (node.children ?? []).map(child => (typeof child === 'object' ? find(child, pred) : null)).find(Boolean) ?? null);

test('person-id: a framed photo, the name in capitals in a pill across its foot, the role under it', () => {
  const model = resolve('person-id');
  const c = model.content;
  assert.equal(c.name, 'ANA RUIZ');
  assert.ok(c.pill.y < c.frame.y + c.frame.height && c.pill.y + c.pill.height > c.frame.y + c.frame.height, 'the pill straddles the frame foot');
  assert.ok(c.roleY >= c.pill.y + c.pill.height);
  assert.ok(find(catalogHView(model), node => node.children?.[0] === 'AR'), 'no photo: an initials tile');
  const photo = resolve('person-id', {...SAMPLES['person-id'], image: 'assets/people/ana.jpg'});
  assert.equal(find(catalogHView(photo), node => node.tag === 'img').attrs.src, 'assets/people/ana.jpg');
  assert.equal(end(model).get('scene-pill').opacity, 1);
  assert.equal(resolve('person-id', {...SAMPLES['person-id'], variant: 'card'}).content.name, 'Ana Ruiz', 'the card keeps the name as written');
  assert.throws(() => resolve('person-id', {name: 'Ana', image: 'https://example.com/a.jpg'}), /project-local assets/);
});

test('lineage-graph: generations in order, each link drawing into the next person', () => {
  for (const aspect of ['16:9', '9:16']) {
    const model = resolve('lineage-graph', SAMPLES['lineage-graph'], aspect);
    const c = model.content;
    assert.deepEqual(model.events.map(e => e.name), ['enter', 'build', 'node-p0', 'node-p1', 'node-p2']);
    const [a, b2, d] = c.people;
    if (aspect === '16:9') assert.ok(a.cx < b2.cx && b2.cx < d.cx, 'left to right');
    else assert.ok(a.cy < b2.cy && b2.cy < d.cy && c.list, 'top to bottom, as a list');
    c.links.forEach(link => assert.ok(link.time < c.people[link.to].time + 0.1 && link.time > c.people[link.from].time));
    const state = end(model);
    assert.equal(state.get('scene-link-1-m').strokeDashoffset, 0);
    assert.equal(state.get('scene-linkl-0').opacity, 1);
  }
  assert.throws(() => resolve('lineage-graph', {people: [{name: 'A'}, {name: 'B'}], links: [{from: 0, to: 1}, {from: 1, to: 0}]}), /form a loop/);
  assert.throws(() => resolve('lineage-graph', {people: [{name: 'A'}, {name: 'B'}], links: [{from: 0, to: 'x'}]}), /must name a person by index or id/);
  const byId = resolve('lineage-graph', {people: [{id: 'advisor', name: 'A'}, {id: 'student', name: 'B'}], links: [{from: 'advisor', to: 'student'}]});
  assert.ok(byId.events.some(e => e.name === 'node-student'));
});

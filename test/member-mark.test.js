// A brand mark as a member (kit/core/member-mark.mjs, docs/FLUID_MOTION_RFC.md
// §10): the spec, the painter, and a mark measured at import like an end-card logo.
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCheck} from '@launchclip/core/catalog-b-base.mjs';
import {markNodes, markSpec, markTreatment} from '@launchclip/core/member-mark.mjs';
import {withLockupTints} from '../src/logo_mark.js';

const check = makeCheck('');
const colors = {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'};
const look = {color: '#fdb022', ink: '#06070d', fg: '#f2eee6', panel: '#12141c', fonts: {body: 'space-grotesk', display: 'anton'}, unit: 1, labelSize: 28, ground: '#06070d', colors, key: 'k'};
const walk = node => [node, ...(Array.isArray(node?.children) ? node.children : []).flatMap(walk)];
const texts = nodes => nodes.flatMap(walk).filter(n => typeof n === 'string');
const tags = nodes => nodes.flatMap(walk).map(n => n?.tag).filter(Boolean);

test('mark: the end card\'s logo classes decide native, tint or plate', () => {
  const spec = raw => markSpec(check, raw, 'm');
  assert.deepEqual(spec('assets/a.svg'), {kind: 'mark', label: null, src: 'assets/a.svg', ratio: 1});
  assert.deepEqual(markTreatment(spec('assets/a.svg'), '#06070d', colors), {mode: 'plate'}, 'unmeasured goes on a plate');
  assert.deepEqual(markTreatment(spec({src: 'assets/a.svg', tone: 'dark', clear: true}), '#06070d', colors), {mode: 'tint', color: colors.paper});
  assert.deepEqual(markTreatment(spec({src: 'assets/a.svg', tone: 'light', clear: true}), '#06070d', colors), {mode: 'native'});
  assert.deepEqual(markTreatment(spec({src: 'assets/a.png', tone: 'dark', clear: false, box: '#4a154b'}), '#06070d', colors), {mode: 'plate'});
  assert.throws(() => spec({src: 'assets/a.svg', color: 'red'}), /m.color is not supported \(allowed: src, label/);
  assert.throws(() => spec('https://cdn.example.com/a.svg'), /project-local assets/);
  assert.throws(() => spec({src: 'assets/a.svg', box: 'purple'}), /m.box/);
});

test('mark: a tint carries its own filter; a boxed mark sits whole on its own colour', () => {
  const tinted = markNodes(markSpec(check, {src: 'assets/a.svg', label: 'Slack', tone: 'dark', clear: true}, 'm'), 200, 240, look);
  assert.ok(tags(tinted).includes('feColorMatrix'));
  assert.equal(tinted.flatMap(walk).find(n => n?.tag === 'img').style.filter, 'url(#k-tint)');
  assert.deepEqual(texts(tinted), ['Slack']);
  const boxed = markNodes(markSpec(check, {src: 'assets/a.png', tone: 'dark', clear: false, box: '#4a154b', ratio: 2}, 'm'), 200, 200, look);
  assert.ok(!tags(boxed).includes('feColorMatrix'));
  assert.equal(boxed[0].style.background, '#4a154b');
  const img = boxed.flatMap(walk).find(n => n?.tag === 'img');
  assert.ok(Math.abs(img.style.width / img.style.height - 2) < 0.02, 'the ratio is kept');
});

test('withLockupTints: a mark member is measured once at import; a module\'s own mark param is not', async () => {
  const story = {brand: {colors}, scenes: [
    {id: 'grid', module: 'icon-grid', start: 0, end: 3, params: {items: [{mark: 'assets/slack.svg'}, {mark: {src: 'assets/notion.png', label: 'Notion'}}, {icon: 'star'}]}},
    {id: 'title', module: 'motion-title', start: 3, end: 6, params: {text: 'x', mark: 'underline'}}
  ]};
  let calls = 0;
  const out = await withLockupTints(story, '/p', async () => { calls += 1; return {tone: 'dark', aspect: 2, clear: true}; });
  assert.equal(calls, 2);
  assert.deepEqual(out.scenes[0].params.items[0].mark, {ratio: 2, tone: 'dark', clear: true, src: 'assets/slack.svg'});
  assert.equal(out.scenes[0].params.items[1].mark.label, 'Notion');
  assert.equal(out.scenes[0].params.items[2], story.scenes[0].params.items[2]);
  assert.equal(out.scenes[1], story.scenes[1]);
  assert.equal(await withLockupTints(story, '/p', async () => null), story, 'unreadable files change nothing');
});

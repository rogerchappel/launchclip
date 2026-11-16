// A person as a member (kit/core/member-person.mjs, docs/FLUID_MOTION_RFC.md
// §10): the spec and the painter.
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCheck} from '@launchclip/core/catalog-b-base.mjs';
import {initials, personHeight, personNodes, personSpec} from '@launchclip/core/member-person.mjs';

const check = makeCheck('');
const colors = {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'};
const look = {color: '#fdb022', ink: '#06070d', fg: '#f2eee6', panel: '#12141c', fonts: {body: 'space-grotesk', display: 'anton'}, unit: 1, labelSize: 28, ground: '#06070d', colors, key: 'k'};
const walk = node => [node, ...(Array.isArray(node?.children) ? node.children : []).flatMap(walk)];
const texts = nodes => nodes.flatMap(walk).filter(n => typeof n === 'string');
const tags = nodes => nodes.flatMap(walk).map(n => n?.tag).filter(Boolean);

test('person: initials, validation and a local image only', () => {
  assert.equal(initials('ada  lovelace'), 'AL');
  assert.equal(initials('Grace'), 'G');
  assert.equal(initials('🙂'), '?');
  assert.deepEqual(personSpec(check, {name: 'Ada Lovelace'}, 'p'), {kind: 'person', name: 'Ada Lovelace', image: null, shape: 'avatar'});
  assert.equal(personSpec(check, {name: 'Ada', image: 'assets/ada.jpg', shape: 'photo'}, 'p').shape, 'photo');
  assert.throws(() => personSpec(check, {image: 'assets/a.jpg'}, 'p'), /p.name is required/);
  assert.throws(() => personSpec(check, {name: 'A', image: 'https://x.com/a.jpg'}, 'p'), /project-local assets/);
  assert.throws(() => personSpec(check, {name: 'A', shape: 'hex'}, 'p'), /p.shape/);
  assert.throws(() => personSpec(check, {name: 'A', role: 'CEO'}, 'p'), /p.role is not supported/);
});

test('person: a photo or avatar fills the face; no image is an initials tile', () => {
  const H = personHeight(160, 28);
  const tile = personNodes(personSpec(check, {name: 'Ada Lovelace'}, 'p'), 200, H, look);
  assert.deepEqual(texts(tile), ['AL', 'Ada Lovelace']);
  assert.ok(!tags(tile).includes('img'));
  const photo = personNodes(personSpec(check, {name: 'Ada', image: 'assets/ada.jpg', shape: 'photo'}, 'p'), 200, H, look);
  const img = photo.flatMap(walk).find(n => n?.tag === 'img');
  assert.equal(img.attrs?.src ?? img.src, 'assets/ada.jpg');
  assert.equal(img.style.width, 128, 'a photo is a 4:5 portrait of the 160 px face');
  assert.deepEqual(texts(photo), ['Ada']);
});

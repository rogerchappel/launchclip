// The CI slices of the per-module parity corpus (scripts/parity-shard.mjs):
// shards split it, and consecutive rotations cover it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {corpus, parseShard, selectFixtures} from '../scripts/parity-shard.mjs';

const files = corpus();

test('the shards split the corpus: every fixture is in exactly one', () => {
  for (const total of [1, 6, 8]) {
    const seen = [];
    for (let index = 1; index <= total; index++) seen.push(...selectFixtures(files, {shard: {index, total}}));
    assert.deepEqual(seen.sort(), files, `${total} shards`);
  }
  const sizes = Array.from({length: 8}, (_, i) => selectFixtures(files, {shard: {index: i + 1, total: 8}}).length);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `shard sizes ${sizes}`);
});

test('consecutive rotations cover the corpus, whatever run number they start at', () => {
  for (const first of [0, 7, 4183]) {
    const seen = new Set();
    for (let run = first; run < first + 12; run++) for (const file of selectFixtures(files, {rotate: run, every: 12})) seen.add(file);
    assert.equal(seen.size, files.length, `from run ${first}`);
  }
  assert.deepEqual(selectFixtures(files, {rotate: 5, every: 12}), selectFixtures(files, {rotate: 17, every: 12}));
});

test('a slice spreads a module\'s variants instead of taking them together', () => {
  const slice = selectFixtures(files, {rotate: 0, every: 12});
  const prefixes = new Set(slice.map(name => name.split('-').slice(0, 3).join('-')));
  assert.ok(prefixes.size >= slice.length * 0.8, `${prefixes.size} distinct prefixes in ${slice.length} fixtures`);
});

test('bad slices are refused', () => {
  assert.deepEqual(parseShard('2/8'), {index: 2, total: 8});
  for (const bad of ['0/8', '9/8', '2', 'a/b']) assert.throws(() => parseShard(bad), /--shard must look like 2\/8/);
  assert.throws(() => selectFixtures(files, {rotate: 3}), /--every/);
  assert.throws(() => selectFixtures(files, {shard: {index: 1, total: 2}, rotate: 1, every: 2}), /not both/);
  assert.deepEqual(selectFixtures(files), files);
});

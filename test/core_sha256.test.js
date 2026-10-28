// kit/core/sha256.mjs: render segment hashes are computed without Node, so
// its digest must be Node's exactly, or a browser would compute cache keys
// `finish` never wrote.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {sha256Hex} from '@launchclip/core/sha256.mjs';

const node = (text) => createHash('sha256').update(text).digest('hex');

test('sha256Hex matches node:crypto on padding edges, Unicode and long input', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const cases = ['', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'héllo 🎬 ✓ 日本', JSON.stringify({scenes: [1, 2, 3]}).repeat(4000)];
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 200; i += 1) cases.push(Array.from({length: Math.floor(next() * 200)}, () => String.fromCodePoint(next() < 0.8 ? 32 + Math.floor(next() * 90) : Math.floor(next() * 0xd7ff))).join(''));
  for (const text of cases) assert.equal(sha256Hex(text), node(text), JSON.stringify(text.slice(0, 40)));
});

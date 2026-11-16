// The fixed-step VFX driver (kit/core/vfx/driver.mjs): every vendored effect
// draws the same bytes at a time whether it got there by playing forward or
// by a cold seek, the same seed twice draws the same bytes, and no effect
// reaches for Math.random or Date.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {VFX_MODULES} from '@launchclip/core/vfx/catalog.mjs';
import {clearFrame, clearVfxCache, createFrame, drawVfx, painterFor, resolveOptions, vfxAt, vfxLocalTime} from '@launchclip/core/vfx/driver.mjs';

const VENDOR = fileURLToPath(new URL('../kit/core/vfx/vendor/', import.meta.url));

function frameHash(mod, opts, t, key) {
  const [w, h] = mod.meta.size, [ox, oy] = mod.meta.origin;
  const frame = createFrame(w, h);
  clearFrame(frame);
  const p = painterFor(frame).place(ox, oy);
  drawVfx(p, mod, opts, t, key);
  return createHash('sha256').update(frame.color).update(frame.light).digest('hex');
}

const timesFor = mod => {
  const D = mod.meta.duration;
  return [1 / 30, 0.1, D * 0.3, D * 0.6, D - 1 / 30].map(t => Math.round(t * 30) / 30);
};

for (const [name, mod] of Object.entries(VFX_MODULES)) {
  test(`${name}: forward play and a cold seek draw the same bytes`, () => {
    const opts = resolveOptions(mod.meta, {seed: 7});
    const times = timesFor(mod);
    // forward: every 30 fps frame through the cache, recording the asked times
    clearVfxCache();
    const forward = new Map();
    for (let f = 0; f / 30 < mod.meta.duration; f += 1) {
      const t = f / 30;
      const hash = frameHash(mod, opts, t, `fwd:${name}`);
      for (const asked of times) if (Math.abs(asked - t) < 1e-9) forward.set(asked, hash);
    }
    // cold seeks, latest first so the cache has to rebuild, then uncached replays
    for (const t of [...times].reverse()) assert.equal(frameHash(mod, opts, t, `seek:${name}`), forward.get(t), `${name} at ${t}s (cached seek)`);
    for (const t of times) assert.equal(frameHash(mod, opts, t, null), forward.get(t), `${name} at ${t}s (cold)`);
  });

  test(`${name}: the same seed twice draws the same bytes, another seed differs`, () => {
    const hashes = timesFor(mod).map(t => [3, 3, 4].map(seed => frameHash(mod, resolveOptions(mod.meta, {seed}), t, null)));
    for (const [a, b] of hashes) assert.equal(a, b);
    // some frames hold still between beats; another seed shows somewhere in its life
    if (mod.create) assert.ok(hashes.some(([a, , c]) => a !== c), `${name}: seed 4 draws like seed 3`);
  });
}

test('one-shots draw nothing at their duration and nothing before their start', () => {
  for (const [name, mod] of Object.entries(VFX_MODULES)) {
    assert.equal(vfxLocalTime(mod, -0.01), null, name);
    if (!mod.meta.loop) assert.equal(vfxAt(mod, resolveOptions(mod.meta, {}), mod.meta.duration), null, name);
  }
});

test('no vendored file uses Math.random or Date, and drawing never calls them', () => {
  const files = [];
  const walk = dir => { for (const entry of readdirSync(dir, {withFileTypes: true})) entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name.endsWith('.js') && files.push(path.join(dir, entry.name)); };
  walk(VENDOR);
  for (const file of files) assert.doesNotMatch(readFileSync(file, 'utf8'), /Math\.random|\bDate\b|performance\.now/, file);
  const random = Math.random, now = Date.now;
  Math.random = () => { throw new Error('Math.random called'); };
  Date.now = () => { throw new Error('Date.now called'); };
  try {
    clearVfxCache();
    for (const mod of Object.values(VFX_MODULES)) for (const t of timesFor(mod)) frameHash(mod, resolveOptions(mod.meta, {seed: 1}), t, null);
  } finally {
    Math.random = random;
    Date.now = now;
  }
});

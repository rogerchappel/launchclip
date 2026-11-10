// Renderer parity (docs/KIT_CONTRACTS.md, "Parity harness"). Slow: it renders
// every fixture in test/fixtures/parity/ with HyperFrames and Remotion, so it
// runs only with LAUNCHCLIP_PARITY=1. Reports land in qa/parity/<fixture>/.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import {DEFAULT_ENTRY, bundleRemotion, runParity, runStoryParity} from '../scripts/parity.mjs';
import {backgroundFixtures, runBackgroundParity} from '../scripts/parity-backgrounds.mjs';
import {CI_UI_STORY} from '../scripts/parity-ci.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = path.join(ROOT, 'test', 'fixtures', 'parity');
const enabled = process.env.LAUNCHCLIP_PARITY === '1';
// The real kit entry once it exists; the test-only ModuleReview entry until then.
const entry = process.env.LAUNCHCLIP_PARITY_ENTRY ?? (existsSync(DEFAULT_ENTRY) ? DEFAULT_ENTRY : path.join(ROOT, 'test', 'fixtures', 'parity-entry', 'entry.tsx'));

// LAUNCHCLIP_PARITY_MODULES=0 leaves the per-module fixtures out: CI renders
// those in shards (scripts/parity-shard.mjs) and the rest of this file apart.
const modules = process.env.LAUNCHCLIP_PARITY_MODULES !== '0';
// The Remotion entry is bundled once for every fixture.
let bundleDir = null, bundled = null;
const bundle = () => (bundled ??= (async () => {
  bundleDir = await mkdtemp(path.join(os.tmpdir(), 'launchclip-parity-bundle-'));
  return bundleRemotion(entry, path.join(bundleDir, 'bundle'), {publicDir: DIR});
})());
test.after(async () => { if (bundleDir) await rm(bundleDir, {recursive: true, force: true}); });

for (const file of readdirSync(DIR).filter(name => name.endsWith('.json')).sort()) {
  test(`parity: ${file}`, {skip: !enabled ? 'set LAUNCHCLIP_PARITY=1 to render parity fixtures' : modules ? false : 'LAUNCHCLIP_PARITY_MODULES=0', timeout: 900_000}, async () => {
    const report = await runParity(path.join(DIR, file), {entry, bundle: await bundle(), out: path.join(ROOT, 'qa', 'parity', file.replace(/\.json$/, ''))});
    for (const sample of report.samples) assert.ok(sample.pass, `${file} ${sample.name} t=${sample.time}: ssim ${sample.ssim} < ${report.threshold.ssim} (see ${report.outDir}/${sample.sideBySide})`);
  });
}

// Whole-story stills through both renderer adapters: plates, transitions,
// captions and ambient motion (kit/core/ambient.mjs). Times sit inside holds,
// where the background field glides and the hold drift has moved furthest,
// in portrait (push-in and pull-back drift) and landscape.
const STORY_PARITY = Object.freeze([
  {id: 'minimal', times: [1.2, 2.6, 5.5]},
  {id: 'explainer-9x16', times: [3.2, 9.5, 19.8]},
  {id: 'promo-16x9', times: [3.4, 12.6, 16.9]},
  // World mode: a cast-scene on track 1 over a track-0 world plate, then a pan.
  {id: 'world-cast-16x9', times: [2.2, 6.5]},
  // Captions over worlds: dark text with a light halo by day, the brand's light colour at night.
  {id: 'world-captions-9x16', times: [2.2, 5.4]},
  // World camera: each cast rides its world plate (at rest, mid-pan, at rest).
  {id: 'world-ride-9x16', times: [1.5, 3.5, 5.5]},
  // World camera: world plates bleed past their frame (at rest with drift, mid-pan, at rest).
  {id: 'world-travel-9x16', times: [1.5, 3.5, 5.5]},
  // Interface scenes on signal-ui (the CI smoke's times, scripts/parity-ci.mjs).
  {id: 'ui-parity-9x16', times: [...CI_UI_STORY.times]}
]);

for (const {id, times} of STORY_PARITY) {
  test(`parity: story ${id} (ambient)`, {skip: enabled ? false : 'set LAUNCHCLIP_PARITY=1 to render story parity', timeout: 600_000}, async () => {
    const report = await runStoryParity(path.join(ROOT, 'examples', 'story', id), {times, out: path.join(ROOT, 'qa', 'parity', `story-${id}`)});
    for (const sample of report.samples) assert.ok(sample.pass, `story ${id} t=${sample.time}: ssim ${sample.ssim} < ${report.threshold.ssim}`);
  });
}

// Background kinds and panel treatments (kit/core/backgrounds.mjs,
// kit/core/panels.mjs): one story fixture each, with the panels on a light
// and a dark palette (test/fixtures/parity-backgrounds/).
for (const fixture of await backgroundFixtures()) {
  test(`parity: background ${fixture.name}`, {skip: enabled ? false : 'set LAUNCHCLIP_PARITY=1 to render background parity', timeout: 600_000}, async () => {
    const report = await runBackgroundParity(fixture);
    for (const sample of report.samples) assert.ok(sample.pass, `${fixture.name} t=${sample.time}: ssim ${sample.ssim} < ${report.threshold.ssim}`);
  });
}

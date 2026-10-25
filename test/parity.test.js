// Renderer parity (docs/KIT_CONTRACTS.md, "Parity harness"). Slow: it renders
// every fixture in test/fixtures/parity/ with HyperFrames and Remotion, so it
// runs only with LAUNCHCLIP_PARITY=1. Reports land in qa/parity/<fixture>/.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEFAULT_ENTRY, runParity, runStoryParity} from '../scripts/parity.mjs';
import {backgroundFixtures, runBackgroundParity} from '../scripts/parity-backgrounds.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = path.join(ROOT, 'test', 'fixtures', 'parity');
const enabled = process.env.LAUNCHCLIP_PARITY === '1';
// The real kit entry once it exists; the test-only ModuleReview entry until then.
const entry = process.env.LAUNCHCLIP_PARITY_ENTRY ?? (existsSync(DEFAULT_ENTRY) ? DEFAULT_ENTRY : path.join(ROOT, 'test', 'fixtures', 'parity-entry', 'entry.tsx'));

for (const file of readdirSync(DIR).filter(name => name.endsWith('.json')).sort()) {
  test(`parity: ${file}`, {skip: enabled ? false : 'set LAUNCHCLIP_PARITY=1 to render parity fixtures', timeout: 600_000}, async () => {
    const report = await runParity(path.join(DIR, file), {entry, out: path.join(ROOT, 'qa', 'parity', file.replace(/\.json$/, ''))});
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
  {id: 'promo-16x9', times: [3.4, 12.6, 16.9]}
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

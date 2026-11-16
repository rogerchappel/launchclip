// Renderer parity (docs/KIT_CONTRACTS.md, "Parity harness"). Slow: it renders
// every fixture in test/fixtures/parity/ with HyperFrames and Remotion, so it
// runs only with LAUNCHCLIP_PARITY=1. Reports land in qa/parity/<fixture>/.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
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
  // The VFX layer (kit/core/vfx): crit-hit, hit-spark, ground-slam, collect-burst, poof and firework-burst over real scenes.
  {id: 'vfx-impacts-9x16', times: [0.93, 2.33, 3.3, 3.6, 4.3, 5.4]},
  // Celebration hits with brand-font words: level-up, firework-rocket, crit-number, combo-counter, confetti, achievement.
  {id: 'vfx-hits-9x16', times: [1.3, 2.4, 3.25, 4.4, 5.2]},
  // The nine VFX cover transitions (burn-away … pixel-dissolve), each mid-cover, turned a quarter for portrait.
  {id: 'vfx-transitions-9x16', times: [1.85, 3.4, 5, 6.75, 8.2, 9.8, 11.4, 13.1, 14.6]},
  // CSS transitions and behaviours (kit/core/transitions.mjs, kit/core/behaviours.mjs)
  // on a bokeh background: mid wipe, clock, fan, both halves of a card flip,
  // an upward hard wipe, a flip the other way; orbit, pendulum, heartbeat,
  // flicker and spin at rest between them.
  {id: 'css-transitions-9x16', times: [1.5, 2.45, 3.4, 4.45, 5.4, 6.45, 8.25, 8.6, 10.45, 11.5, 12.6, 13.5]},
  // The round-two sample: hits and cover transitions over crisp scenes.
  {id: 'vfx-arcade-9x16', times: [1.2, 3.5, 6.45, 10.9]},
  // VFX phase 9 batch 1: each of the twenty new effects on its peak (a loop just after it starts).
  {id: 'vfx-batch1-9x16', times: [0.8, 1.8, 2.8, 3.8, 4.6, 5.8, 6.8, 7.8, 8.8, 9.6, 10.8, 11.8, 12.8, 13.8, 14.6, 15.8, 16.8, 17.8, 18.9, 19.4]},
  // Silhouette effects: scanner and hit-flash on a card, frozen, electrified, stunned and halo on two cast members.
  {id: 'vfx-masks-9x16', times: [1.2, 2.3, 4.2, 6.5]},
  // Flow across scenes (docs/FLUID_MOTION_RFC.md §6): the pinned title held as the rest exits, the cards on their old rects on the first frame after the cut and mid-flight, and the same after a cutaway.
  {id: 'flow-carry-9x16', times: [3.9, 4, 4.35, 10, 10.4]},
  // The flow switch: the same story with no carry maps, flow on from the steady feel.
  {id: 'flow-auto-9x16', times: [4, 4.35, 10.4]},
  // Carry through a moving camera (docs/rd/carry-moving-camera.md): the last frame before a pan, its first frame, mid-pan, landed, mid-whip at peak blur, landed.
  {id: 'flow-camera-9x16', times: [3.95, 4, 4.45, 5, 8.17, 8.5]},
  // Interface scenes on signal-ui (the CI smoke's times, scripts/parity-ci.mjs).
  {id: 'ui-parity-9x16', times: [...CI_UI_STORY.times]},
  // Anchors (docs/FLUID_MOTION_RFC.md §7): a robot looks at each node-graph card as it lands and cheers at converge.
  {id: 'node-graph-anchors-9x16', times: [1.5, 2.7, 3.3, 4.8]},
  // Growth from existing elements (§6.4): wires drawing out of the ad card, the labels landed, a pulse on its way, the pinned cut, the next scene's wire growing, a label lit.
  {id: 'sprout-ad-card-9x16', times: [0.75, 1.3, 2.3, 3.5, 4.2, 5.5]}
]);

for (const {id, times} of STORY_PARITY) {
  test(`parity: story ${id} (ambient)`, {skip: enabled ? false : 'set LAUNCHCLIP_PARITY=1 to render story parity', timeout: 600_000}, async () => {
    const report = await runStoryParity(path.join(ROOT, 'examples', 'story', id), {times, out: path.join(ROOT, 'qa', 'parity', `story-${id}`)});
    for (const sample of report.samples) assert.ok(sample.pass, `story ${id} t=${sample.time}: ssim ${sample.ssim} < ${report.threshold.ssim}`);
  });
}

// Finish passes (src/finish_pass.js): each runs over both renderers' stills of
// one story, so a pass that is not seek-pure or reads anything but the frame
// shows up here (test/fixtures/parity-finish/). A fixture with patch and files
// (pack-*.json) sets its finish through a style pack written into the project.
const FINISH_DIR = path.join(ROOT, 'test', 'fixtures', 'parity-finish');
for (const file of readdirSync(FINISH_DIR).filter(name => name.endsWith('.json')).sort()) {
  const name = file.replace(/\.json$/, '');
  test(`parity: finish ${name}`, {skip: enabled ? false : 'set LAUNCHCLIP_PARITY=1 to render finish parity', timeout: 600_000}, async () => {
    const {story, times, finish, patch = {finish}, files = null} = JSON.parse(readFileSync(path.join(FINISH_DIR, file), 'utf8'));
    const report = await runStoryParity(path.join(ROOT, 'examples', 'story', story), {times, patch, files, out: path.join(ROOT, 'qa', 'parity', `finish-${name}`)});
    for (const sample of report.samples) assert.ok(sample.pass, `finish ${name} t=${sample.time}: ssim ${sample.ssim} < ${report.threshold.ssim}`);
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

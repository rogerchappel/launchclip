// Footage layouts (docs/VIDEO_QUALITY_RFC.md §7.1, kit/core/footage-layout.mjs):
// the sections contract, geometry, the reframing camera, layout-shift
// boundaries, both compilers and layout-check. Renderer parity is
// test/fixtures/parity-footage/s-layout-*.json (footage_lane.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deriveBoundaries, resolveStory, validateStory} from '../kit/core/story.mjs';
import {resolveModule} from '../kit/core/modules.mjs';
import {captionZone, captionZones, layoutAt, layoutFrameStyle, layoutGeometry, layoutPlan, layoutStateAt, panelSafeArea, storySections, withLayoutCameras} from '../kit/core/footage-layout.mjs';
import {captionPlan, captionZoneIndex} from '../kit/core/captions.mjs';
import {elementsFromStory, profileGeometry} from '../kit/core/layout-check.mjs';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';
import {readProjectStory} from '../src/story_loader.js';
import {checkLayoutProject} from '../src/layout_check.js';
import {plannedSubjectWindows} from '../src/subject/plan.js';
import {parseDeclaredSequenceBoundaries} from '../src/cinematic_evidence.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WIDE = join(ROOT, 'examples/story/layouts-wide');
const TALL = join(ROOT, 'examples/story/layouts-tall');
const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};

function story(sections, {width = 1920, height = 1080, scenes} = {}) {
  return {schema: 'launchclip.story.v1', lane: 'footage-led', format: {width, height, fps: 30, duration: 10}, brand, base: {src: 'assets/recording.mp4'},
    scenes: scenes ?? [{id: 'lt', module: 'lower-third', track: 1, start: 0, end: 2, params: {name: 'Ada Park'}}], sections};
}
const errors = (value) => validateStory(value).errors.join('\n');

test('sections validate: layouts, sides, panels, rooms, order and lane', () => {
  assert.deepEqual(validateStory(story([{id: 'a', start: 2, end: 5, layout: 'split-left'}, {id: 'b', start: 5, end: 8, layout: 'framed', side: 'right', panel: 'paper', room: 'dim', transition: {type: 'cut'}}])).errors, []);
  assert.match(errors(story([{id: 'a', start: 2, end: 5, layout: 'sideways'}])), /sections\[0\]\.layout must be one of full, split-left/);
  assert.match(errors(story([{id: 'a', start: 2, end: 5, layout: 'stacked'}])), /"stacked" is for 9:16/);
  assert.deepEqual(validateStory(story([{id: 'a', start: 2, end: 5, layout: 'stacked'}], {width: 1080, height: 1920})).errors, []);
  assert.match(errors(story([{id: 'a', start: 2, end: 5, layout: 'split-left', side: 'top'}])), /side applies only to framed and stacked/);
  assert.match(errors(story([{id: 'a', start: 2, end: 5, layout: 'framed', panel: 'blue'}])), /panel must be a brand colour/);
  assert.match(errors(story([{id: 'a', start: 2, end: 5, layout: 'framed', room: 'blur'}])), /room must be one of keep, dim, replace/);
  assert.match(errors(story([{id: 'a', start: 2, end: 5, layout: 'framed'}, {id: 'b', start: 4, end: 6, layout: 'full'}])), /sections may not overlap/);
  assert.match(errors(story([{id: 'a', start: 2, end: 5, layout: 'framed', transition: {type: 'fade'}}])), /transition must be/);
  assert.match(errors(story([{id: 'a', start: 2, end: 5, layout: 'framed', extra: 1}])), /sections\[0\]\.extra is not supported/);
  assert.match(errors({...story([{id: 'a', start: 2, end: 5, layout: 'framed'}]), lane: 'motion', base: null}), /need the footage-led lane/);
});

test('section anchors resolve like scene times', () => {
  const words = [{word: 'Hello', start: 0.5, end: 1}, {word: 'steps', start: 2.2, end: 2.6}, {word: 'done', start: 6, end: 6.4}];
  const resolved = resolveStory(story([{id: 'a', start: 'word:steps', end: 'word:done', layout: 'split-right'}]), {words});
  assert.deepEqual(storySections(resolved).map((section) => [section.start, section.end]), [[2.2, 6]]);
});

test('geometry: windows, panels and the panel safe area', () => {
  const wide = {width: 1920, height: 1080}, tall = {width: 1080, height: 1920};
  assert.deepEqual(layoutGeometry('split-left', null, wide), {window: {x: 0, y: 0, width: 883, height: 1080}, radius: 0, panel: {x: 883, y: 0, width: 1037, height: 1080}});
  assert.deepEqual(layoutGeometry('split-right', null, wide).window, {x: 1037, y: 0, width: 883, height: 1080});
  assert.deepEqual(layoutGeometry('stacked', 'bottom', tall), {window: {x: 0, y: 960, width: 1080, height: 960}, radius: 0, panel: {x: 0, y: 0, width: 1080, height: 960}});
  assert.equal(layoutGeometry('framed', 'left', wide).radius, 32);
  assert.deepEqual(layoutGeometry('insert', null, wide), {window: {x: 960, y: 540, width: 0, height: 0}, radius: 0, panel: {x: 0, y: 0, width: 1920, height: 1080}});
  assert.equal(layoutGeometry('full', null, wide).panel, null);
  // Inside the safe zone, a gutter off the window, above the caption band with captions.
  assert.deepEqual(panelSafeArea({x: 883, y: 0, width: 1037, height: 1080}, wide), {x: 926, y: 54, width: 898, height: 767});
  assert.deepEqual(panelSafeArea({x: 883, y: 0, width: 1037, height: 1080}, wide, {captions: false}), {x: 926, y: 54, width: 898, height: 972});
});

test('the plan reframes the tracked head into the window and shifts between layouts', async () => {
  const {resolved} = await readProjectStory(WIDE);
  const plan = layoutPlan(resolved);
  assert.deepEqual(plan.sections.map((section) => section.layout), ['split-left', 'framed', 'split-right']);
  const split = layoutStateAt(plan, 3.5);
  // The presenter's head (x ≈ 960 on the canvas) lands in the middle of the 883 px window.
  const head = resolved.base.subject.mattes[0].summary.head;
  const headX = head.x * 1920;
  assert.ok(Math.abs(960 + split.camera.scale * (headX - 960) + split.camera.x - 441.5) < 30, JSON.stringify(split.camera));
  const {scale, x} = split.camera;
  assert.ok(960 - scale * 960 + x <= 0 && 960 + scale * 960 + x >= 883, 'the footage still covers the window');
  // A shift runs 0.5 s (15 frames), eased, between two held states.
  const mid = layoutStateAt(plan, 2.25);
  assert.ok(mid.window.width < 1920 && mid.window.width > 883, `mid-shift window ${mid.window.width}`);
  assert.deepEqual(layoutStateAt(plan, 2.5), split);
  assert.equal(layoutStateAt(plan, 1).window.width, 1920, 'full before the first section');
  assert.deepEqual(layoutFrameStyle(layoutStateAt(plan, 6.5), plan.canvas), {left: 1071, top: 43, width: 806, height: 994, borderRadius: 32, boxShadow: '0px 0px 0px 6px #fdb022, 0px 0px 0px 3840px #06070d'});
  // The framed section dims the room behind the cut-out (its matte covers it).
  assert.deepEqual(plan.rooms, [{sceneId: 'layout:proof', start: 5, end: 7.5, room: {dim: 0.55}}]);
});

test('without a matte a room treatment is dropped with a warning', () => {
  const resolved = resolveStory(story([{id: 'a', start: 2, end: 5, layout: 'framed', room: 'replace'}]));
  const plan = layoutPlan(resolved);
  assert.deepEqual(plan.rooms, []);
  assert.match(plan.warnings[0], /section a: room "replace" needs a matte/);
  assert.equal(layoutPlan(resolveStory(story(undefined))), null, 'no sections, no plan');
});

test('layout-shift boundaries reach deriveBoundaries and the compiled HTML', async () => {
  const {resolved} = await readProjectStory(TALL);
  const boundaries = deriveBoundaries(resolved).filter((entry) => entry.type === 'layout-shift');
  assert.deepEqual(boundaries.map((entry) => [entry.boundary_id, entry.start_seconds, entry.duration_seconds, entry.from_id, entry.to_id]), [
    ['steps-layout', 2, 0.5, null, 'steps'], ['proof-layout', 5, 0.5, 'steps', 'proof'], ['number-layout', 7.5, 0.4, 'proof', 'number'], ['number-layout-out', 9, 0.5, 'number', null]
  ]);
  const {html, warnings} = await compileStoryToHyperFrames(resolved, {write: false, sourceDir: TALL});
  assert.deepEqual(warnings.filter((warning) => !/font/.test(warning)), []);
  const parsed = parseDeclaredSequenceBoundaries(html, 10);
  assert.ok(parsed.ok, parsed.errors.join('\n'));
  assert.deepEqual(parsed.boundaries.map((entry) => entry.boundary_id), ['steps-layout', 'proof-layout', 'number-layout', 'number-layout-out']);
});

test('HyperFrames: the frame sits above the subject and under the scenes, set per op', async () => {
  const {resolved} = await readProjectStory(WIDE);
  const {html} = await compileStoryToHyperFrames(resolved, {write: false, sourceDir: WIDE});
  const frame = html.match(/<div id="lc-layout-frame"[^>]*>/)[0];
  const z = Number(frame.match(/z-index:(\d+)/)[1]);
  const subjectZ = Number(html.match(/class="clip lc-subject-media"[^>]*z-index:(\d+)/)[1]);
  const sceneZ = Math.min(...[...html.matchAll(/class="lc-scene[^"]*" data-launchclip-scene="[^"]*"[^>]*style="z-index:(\d+)/g)].map((match) => Number(match[1])));
  assert.ok(subjectZ < z && z < sceneZ, `subject ${subjectZ} < frame ${z} < scenes ${sceneZ}`);
  const plan = layoutPlan(resolved);
  assert.equal((html.match(/tl\.set\("#lc-layout-frame"/g) ?? []).length, plan.ops.length);
  // The base camera carries the reframe; the room dims under the matte.
  assert.match(html, /\/\/ base camera \(layout\)/);
  assert.match(html, /tl\.set\('\.lc-base-media', \{"opacity":1,"filter":"brightness\(0\.45\)"\}, 5\);/);
  // A module review has no layout.
  const review = await compileStoryToHyperFrames(resolved, {write: false, sourceDir: WIDE, sceneFilter: 'list'});
  assert.doesNotMatch(review.html, /lc-layout-frame/);
});

test('a punch-in inside a section moves the footage within the reframe', () => {
  const resolved = resolveStory(story([{id: 'a', start: 0, end: 10, layout: 'split-right', transition: {type: 'cut'}}], {scenes: [{id: 'p', module: 'punch-in', track: 1, start: 2, end: 4, params: {at: 0.3}}]}));
  const plan = layoutPlan(resolved);
  const punch = resolveModule(resolved.scenes[0], resolved);
  const [composed, layout] = withLayoutCameras([punch], plan, {fps: 30, duration: 10});
  const reframe = layoutStateAt(plan, 3).camera;
  const sample = punch.camera.samples[20], out = composed.camera.samples[20];
  assert.equal(out.scale, Math.round(reframe.scale * sample.scale * 1e6) / 1e6);
  assert.equal(out.x, Math.round((reframe.scale * sample.x + reframe.x) * 1e6) / 1e6);
  // The layout's own camera fills in outside the punch-in, and restores the reframe after it.
  assert.equal(layout.sceneId, 'layout');
  const last = punch.camera.samples.at(-1).t;
  assert.ok(layout.camera.samples.some((entry) => entry.t > last && entry.t <= last + 1 / 30 + 1e-6 && entry.x === reframe.x));
  assert.ok(layout.camera.samples.every((entry) => entry.t < punch.camera.samples[0].t - 1e-6 || entry.t > last + 1e-6));
  assert.deepEqual(withLayoutCameras([punch], null), [punch]);
});

test('modules get ctx.layout; a checklist fits the panel safe area', async () => {
  const {resolved} = await readProjectStory(WIDE);
  const list = resolveModule(resolved.scenes.find((scene) => scene.id === 'list'), resolved);
  const safe = layoutAt(resolved, 3).safe;
  assert.equal(list.subjectPlacement, 'panel');
  assert.ok(list.rect.x >= safe.x - 1e-6 && list.rect.x + list.rect.width <= safe.x + safe.width + 1e-6 && list.rect.y >= safe.y - 1e-6 && list.rect.y + list.rect.height <= safe.y + safe.height + 1e-6, JSON.stringify({rect: list.rect, safe}));
  assert.equal(layoutAt(resolved, 1), null, 'no section, no layout');
  assert.deepEqual(Object.keys(layoutAt(resolved, 6)), ['section', 'layout', 'side', 'presenter', 'panel', 'safe', 'color']);
});

test('both examples layout-check clean; the face rule follows the reframe', async () => {
  for (const dir of [WIDE, TALL]) {
    const report = await checkLayoutProject(dir);
    assert.equal(report.status, 'passed', JSON.stringify(report.findings));
  }
  // A card over the reframed head (left half in split-left) fails; the same card in the panel passes.
  const value = JSON.parse(readFileSync(join(WIDE, 'storyboard.json'), 'utf8'));
  value.scenes.find((scene) => scene.id === 'list').params.rect = {x: 140, y: 120, width: 600, height: 520};
  const report = await checkLayoutProject(WIDE, {story: value});
  assert.deepEqual(report.findings.filter((finding) => finding.rule === 'subject-face').map((finding) => finding.ids[0]), ['list']);
});

test('make mattes the sections that treat the room', async () => {
  const {resolved} = await readProjectStory(TALL);
  assert.deepEqual(plannedSubjectWindows(resolved), [[5, 7.5]]);
});

test('Remotion kit: LayoutFrame from the same plan, cameras composed', () => {
  const source = readFileSync(join(ROOT, 'kit/remotion/StoryComposition.tsx'), 'utf8');
  assert.match(source, /const layout = React\.useMemo\(\(\) => \(base \? layoutPlan\(story\) : null\)/);
  assert.match(source, /withLayoutCameras\(models, layout/);
  assert.match(source, /\{layout \? <LayoutFrame plan=\{layout\} \/> : null\}/);
  assert.ok(source.indexOf('<SubjectLayer base={base}') < source.indexOf('<LayoutFrame'), 'the frame draws over the subject');
});

test('captions sit on the presenter side of a split, framed or stacked section', () => {
  const wide = {width: 1920, height: 1080}, tall = {width: 1080, height: 1920};
  const band = (canvas) => profileGeometry(canvas).captionBand;
  // Narrowed to the presenter's window, a gutter in, never wider than the band.
  assert.deepEqual(captionZone('split-left', null, wide, band(wide)), {x: 192, y: 864, width: 648, height: 140});
  assert.deepEqual(captionZone('split-right', null, wide, band(wide)), {x: 1080, y: 864, width: 648, height: 140});
  assert.deepEqual(captionZone('framed', 'left', wide, band(wide)), {x: 192, y: 854, width: 614, height: 140});
  // Moved up into a window above the band; unchanged where the band already sits inside the window.
  assert.deepEqual(captionZone('framed', 'top', tall, band(tall)), {x: 86, y: 653, width: 832, height: 230});
  assert.deepEqual(captionZone('stacked', 'top', tall, band(tall)), {x: 65, y: 687, width: 853, height: 230});
  assert.equal(captionZone('stacked', 'bottom', tall, band(tall)), null);
  assert.equal(captionZone('full', null, wide, band(wide)), null);
  assert.equal(captionZone('insert', null, wide, band(wide)), null);
  // With the captions beside the presenter, the panel's safe area runs past the band.
  const captioned = {...story([{id: 'a', start: 2, end: 5, layout: 'split-left'}]), overlays: [{type: 'captions'}]};
  assert.deepEqual(captionZones(captioned), [{section: 'a', start: 2, end: 5, rect: {x: 192, y: 864, width: 648, height: 140}}]);
  assert.deepEqual(layoutAt(captioned, 3).safe, {x: 926, y: 54, width: 898, height: 972});
});

test('a caption line takes the zone it is mostly spoken in; both renderers get the same CSS', () => {
  const zones = [{start: 2, end: 5, rect: {x: 192, y: 864, width: 648, height: 140}}, {start: 7.5, end: 10, rect: {x: 1080, y: 864, width: 648, height: 140}}];
  assert.equal(captionZoneIndex(zones, 3, 4), 0);
  assert.equal(captionZoneIndex(zones, 1.5, 3), 0, 'two thirds inside');
  assert.equal(captionZoneIndex(zones, 0.5, 2.6), -1, 'mostly before the section');
  assert.equal(captionZoneIndex(zones, 7, 8.2), 1);
  const words = (list, start) => list.map((text, i) => ({text, start: start + i * 0.3, end: start + i * 0.3 + 0.25}));
  const chunks = [
    {id: 'cap-001', start: 0.5, end: 1.6, words: words(['Before', 'the', 'split'], 0.5)},
    {id: 'cap-002', start: 3, end: 4, words: words(['Beside', 'the', 'presenter'], 3)},
    {id: 'cap-003', start: 8, end: 9, words: words(['Other', 'side'], 8)}
  ];
  const plan = captionPlan(chunks, {type: 'captions', preset: 'quiet-accent'}, {format: {width: 1920, height: 1080}, zones});
  assert.deepEqual(plan.nodes.map((node) => node.cls), ['lc-cap', 'lc-cap lc-cap-z1', 'lc-cap lc-cap-z2']);
  // Percentages of the caption container (x 192–1728): the left 42% and the right 42%.
  assert.match(plan.css, /\.lc-cap\.lc-cap-z1 \{ left: 0%; right: 57\.813%; top: 0%; bottom: 0%; width: fit-content; height: fit-content; max-width: 42\.188%; margin: auto; \}/);
  assert.match(plan.css, /\.lc-cap\.lc-cap-z2 \{ left: 57\.813%; right: 0%;/);
  // A narrow portrait zone sets smaller type so one long word still fits.
  const tall = captionPlan(chunks, {type: 'captions', preset: 'word-highlight'}, {format: {width: 1080, height: 1920}, zones: [{start: 2, end: 5, rect: {x: 583, y: 1190, width: 335, height: 230}}]});
  assert.match(tall.css, /\.lc-cap\.lc-cap-z1 \{[^}]* font-size: 51\.8px; \}/);
  // Without zones the plan is unchanged.
  assert.deepEqual(captionPlan(chunks, {type: 'captions'}, {format: {width: 1920, height: 1080}}).css, captionPlan(chunks, {type: 'captions'}, {format: {width: 1920, height: 1080}, zones: []}).css);
  // lower-band: a band never runs across a zone change.
  const band = captionPlan(chunks.map((chunk) => ({...chunk, end: chunk.end + 2})), {type: 'captions', preset: 'lower-band'}, {format: {width: 1920, height: 1080}, zones});
  assert.ok(band.nodes.filter((node) => node.cls?.startsWith('lc-cap-band')).some((node) => node.cls === 'lc-cap-band lc-cap-z1'));
});

test('the compiler and the layout check place captions in the zones', async () => {
  const {resolved} = await readProjectStory(WIDE);
  const captioned = {...resolved, overlays: [{type: 'captions', src: 'assets/captions.json'}]};
  const plan = layoutPlan(captioned);
  assert.deepEqual(plan.captions.map((zone) => zone.section), ['steps', 'proof', 'close']);
  const captions = elementsFromStory(captioned, {moduleLayout: () => [], captionZones: plan.captions});
  assert.deepEqual(captions.map((element) => element.id), ['captions', 'captions@steps', 'captions@proof', 'captions@close']);
  assert.deepEqual(captions[0].hide, [[2, 5], [5, 7.5], [7.5, 10]]);
  assert.deepEqual(captions[1].rect, {x: 192, y: 864, width: 648, height: 140});
  const source = readFileSync(join(ROOT, 'kit/remotion/StoryComposition.tsx'), 'utf8');
  assert.equal((source.match(/zones=\{layout\?\.captions\}/g) ?? []).length, 2, 'Remotion hands WordCaptions the same zones');
  assert.match(readFileSync(join(ROOT, 'kit/hyperframes/story-compiler.mjs'), 'utf8'), /zones: layout\?\.captions/);
});

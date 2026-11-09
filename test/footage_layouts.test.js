// Footage layouts (docs/VIDEO_QUALITY_RFC.md §7.1, kit/core/footage-layout.mjs):
// the sections contract, geometry, the reframing camera, layout-shift
// boundaries, both compilers and layout-check. Renderer parity is
// test/fixtures/parity-footage/s-layout-*.json (footage_lane.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deriveBoundaries, resolveStory, validateStory} from '@launchclip/core/story.mjs';
import {resolveModule} from '@launchclip/core/modules.mjs';
import {BREAKOUT_EDGE, breakoutNotch, breakoutWindows, captionZone, captionZones, layoutAt, sceneLayoutAt, layoutFrameStyle, layoutGeometry, layoutPlan, layoutStateAt, layoutUnderFrameStyle, panelSafeArea, storySections, withLayoutCameras} from '@launchclip/core/footage-layout.mjs';
import {captionPlan, captionZoneIndex} from '@launchclip/core/captions.mjs';
import {elementsFromStory, profileGeometry} from '@launchclip/core/layout-check.mjs';
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
  assert.ok(source.indexOf('<SubjectLayer base={base}') < source.indexOf('<LayoutFrame plan={layout} />'), 'the frame draws over the subject');
  // A breakout story draws a copy of the frame and the fill under the subject, and notches the fill above it.
  assert.ok(source.indexOf('{breakout ? <LayoutFrame plan={layout} under /> : null}') < source.indexOf('<SubjectLayer base={base}'), 'the under-frame draws below the subject');
  assert.match(source, /<LayoutFill layout=\{layout\} plan=\{layoutFill\} notch=\{breakout\} \/>/);
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

test('a scene that starts a moment before its section takes the section layout, with a warning', () => {
  const sections = [{id: 's5', start: 2, end: 8, layout: 'split-left'}];
  const list = (start, end) => ({id: 'inside', module: 'checklist', track: 1, start, end, params: {title: 'Inside', rows: [{label: 'Engineering', status: 'active', at: 0.3}, {label: 'Security', status: 'active', at: 0.6}]}});
  const early = story(sections, {scenes: [list(1.8, 6)]});
  assert.equal(layoutAt(early, 1.8), null, 'the start alone is outside the section');
  assert.equal(sceneLayoutAt(early, 1.8, 6).section, 's5');
  assert.equal(resolveModule(early.scenes[0], resolveStory(early)).subjectPlacement, 'panel');
  assert.deepEqual(validateStory(early).warnings.filter((w) => w.startsWith('scene inside')), ["scene inside: starts 0.2 s before section s5 (2 s); it is placed in s5's split-left layout; move its start to 2"]);
  // Mostly outside: the full frame, and the warning says why.
  const outside = story(sections, {scenes: [list(0.5, 2.5)]});
  assert.equal(sceneLayoutAt(outside, 0.5, 2.5), null);
  assert.match(validateStory(outside).warnings.join('\n'), /scene inside: starts 1\.5 s before section s5 \(2 s\) but is mostly outside it, so it is placed in the full frame, not s5's split-left panel; move it inside s5 \(2–8 s\) or out of it/);
  // Ending past a section, mostly inside.
  assert.match(validateStory(story(sections, {scenes: [list(5, 8.3)]})).warnings.join('\n'), /ends 0\.3 s after section s5 \(8 s\); it is placed in s5's split-left layout; move its end to 8/);
  // Inside a section, or an insert: no warning.
  assert.deepEqual(validateStory(story(sections, {scenes: [list(2, 8)]})).warnings.filter((w) => w.startsWith('scene ')), []);
  assert.deepEqual(validateStory(story(sections, {scenes: [{...list(1, 3), insert: true, track: 0}]})).warnings.filter((w) => w.startsWith('scene ')), []);
});

test('a fitting error names the section a scene fell outside', async () => {
  const {sectionFitHint} = await import('@launchclip/core/modules.mjs');
  const value = resolveStory(story([{id: 's5', start: 2, end: 8, layout: 'split-left'}], {scenes: [{id: 'card', module: 'lower-third', track: 1, start: 0.5, end: 2.5, params: {name: 'Ada'}}]}));
  assert.equal(sectionFitHint(value.scenes[0], value), '; it was placed in the full frame because it falls outside section s5 (split-left, 2–8 s): it starts 1.5 s before it; move it inside s5');
  assert.equal(sectionFitHint({...value.scenes[0], start: 1.9, end: 6}, value), '', 'snapped into the section: no hint');
});

// Breakout: the head rises over the top edge of the presenter's window.
const breakoutSections = [
  {id: 'steps', start: 2, end: 5, layout: 'stacked', share: 0.45, breakout: true},
  {id: 'proof', start: 5, end: 7.5, layout: 'framed', side: 'bottom', breakout: true}
];
async function breakoutStory(sections = breakoutSections) {
  const {resolved} = await readProjectStory(TALL);
  return {...structuredClone(resolved), sections};
}

test('breakout validates: a boolean, only where the presenter sits under the panel', () => {
  const tall = {width: 1080, height: 1920};
  assert.equal(errors(story([{id: 'a', start: 1, end: 4, layout: 'stacked', breakout: true}, {id: 'b', start: 4, end: 8, layout: 'framed', side: 'bottom', breakout: true}], tall)), '');
  assert.match(errors(story([{id: 'a', start: 1, end: 4, layout: 'framed', breakout: true}], tall)), /sections\[0\]\.breakout needs the presenter under the panel/);
  assert.match(errors(story([{id: 'a', start: 1, end: 4, layout: 'stacked', side: 'top', breakout: true}], tall)), /breakout needs the presenter under the panel/);
  assert.match(errors(story([{id: 'a', start: 1, end: 4, layout: 'split-left', breakout: true}])), /breakout needs the presenter under the panel/);
  assert.match(errors(story([{id: 'a', start: 1, end: 4, layout: 'stacked', breakout: 'yes'}], tall)), /breakout must be true or false/);
  // Off is the same as absent: the resolved section carries no key.
  const [off] = storySections(resolveStory(story([{id: 'a', start: 1, end: 4, layout: 'stacked', breakout: false}], tall)));
  assert.equal('breakout' in off, false);
});

test('breakout: the camera lifts the head over the edge and the plan mounts the cut-out', async () => {
  const value = await breakoutStory();
  const plan = layoutPlan(value);
  assert.deepEqual(plan.warnings, []);
  // The window runs through the layout-shift that leaves the last breakout.
  assert.deepEqual(plan.breakouts, [{id: 'steps', start: 2, end: 5}, {id: 'proof', start: 5, end: 8}]);
  assert.deepEqual(breakoutWindows(value), plan.breakouts);
  assert.deepEqual(plan.rooms, [{sceneId: 'layout:proof:breakout', start: 5, end: 8, room: {}}, {sceneId: 'layout:steps:breakout', start: 2, end: 5, room: {}}]);
  assert.deepEqual(plannedSubjectWindows(value), [[2, 8]]);
  const summary = value.base.subject.mattes[0].summary.head;
  for (const [t, id] of [[3.5, 'steps'], [6.5, 'proof']]) {
    const state = layoutStateAt(plan, t);
    assert.equal(state.breakout, true, id);
    // The window's top edge crosses the head BREAKOUT_EDGE of the way down it.
    // The matte summary's head is a centre and a size, as fractions of the source.
    const top = 960 + state.camera.scale * ((summary.y - summary.h / 2) * 1920 - 960) + state.camera.y;
    const height = state.camera.scale * summary.h * 1920;
    assert.ok(Math.abs((state.window.y - top) / height - BREAKOUT_EDGE) < 0.02, `${id}: the edge crosses ${(state.window.y - top) / height} of the way down the head`);
    const layout = layoutAt(value, t);
    assert.ok(Math.abs(layout.breakout - (state.window.y - top)) < 1, `${id}: layoutAt reports the rise`);
    // Panel graphics end a gutter above the head.
    assert.ok(layout.safe.y + layout.safe.height <= state.window.y - layout.breakout - 43 + 1e-6, `${id}: the panel safe area ends above the head`);
  }
  // The head stays out through the shifts between the sections and back to full.
  assert.equal(layoutStateAt(plan, 5.2).breakout, true);
  assert.equal(layoutStateAt(plan, 7.6).breakout, true);
  assert.equal(layoutStateAt(plan, 8).breakout, undefined);
  assert.equal(layoutStateAt(plan, 1).breakout, undefined);
  // Into an insert the window closes, so the breakout ends with the section.
  const closing = layoutPlan(await breakoutStory([...breakoutSections, {id: 'number', start: 7.5, end: 9, layout: 'insert'}]));
  assert.deepEqual(closing.breakouts[1], {id: 'proof', start: 5, end: 7.5});
  assert.equal(layoutStateAt(closing, 7.6).breakout, undefined);
});

test('breakout: the frame above the subject is cut away over the head, its copy below is whole', async () => {
  const plan = layoutPlan(await breakoutStory());
  const framed = layoutStateAt(plan, 6.5);
  assert.deepEqual(framed.window, {x: 43, y: 994, width: 994, height: 883});
  const under = layoutUnderFrameStyle(framed, plan.canvas);
  assert.equal('clipPath' in under, false);
  // The notch: the window's column with its 6 px ring, from the top of the canvas to the end of the top corners (y 994 + 32), in the frame's own box.
  assert.deepEqual(layoutFrameStyle(framed, plan.canvas), {...under, clipPath: 'polygon(-43px -994px, -6px -994px, -6px 32px, 1000px 32px, 1000px -994px, 1037px -994px, 1037px 926px, -43px 926px)'});
  assert.equal(breakoutNotch(framed, plan.canvas), 'polygon(0px 0px, 37px 0px, 37px 1026px, 1043px 1026px, 1043px 0px, 1080px 0px, 1080px 1920px, 0px 1920px)');
  assert.equal(breakoutNotch(layoutStateAt(plan, 1), plan.canvas), 'none');
  assert.equal(breakoutNotch(layoutStateAt(plan, 8.5), plan.canvas), 'none');
});

test('breakout: seam captions sit on top of the head, not across the face', async () => {
  const value = await breakoutStory();
  value.overlays = [{type: 'captions', preset: 'seam-word', position: 'seam'}];
  const zones = captionZones(value);
  const steps = zones.find((zone) => zone.section === 'steps');
  const rise = layoutAt(value, 3.5).breakout;
  assert.ok(Math.abs(steps.rect.y + steps.rect.height - (1056 - rise)) < 1e-6, JSON.stringify(steps));
  // Without the breakout the band is centred on the seam.
  const plain = captionZones({...value, sections: [{...breakoutSections[0], breakout: false}]})[0];
  assert.equal(plain.rect.y + plain.rect.height / 2, 1056);
});

test('breakout without a matte keeps the head inside the frame, with a warning', async () => {
  const value = await breakoutStory();
  delete value.base.subject;
  const plan = layoutPlan(value);
  assert.equal(plan.breakouts, undefined);
  assert.deepEqual(plan.rooms, []);
  assert.match(plan.warnings[0], /section steps: breakout needs a matte over 2–5 s/);
  assert.equal(layoutStateAt(plan, 3.5).breakout, undefined);
  assert.equal(layoutAt(value, 3.5).breakout, undefined);
});

test('HyperFrames: a breakout story stacks under-frame, subject, notched frame, scenes', async () => {
  const value = await breakoutStory();
  const {html, warnings} = await compileStoryToHyperFrames(value, {write: false, sourceDir: TALL});
  assert.deepEqual(warnings.filter((warning) => !/font/.test(warning)), []);
  const z = (pattern) => Number(html.match(pattern)[1]);
  const under = z(/<div id="lc-layout-frame-under"[^>]*z-index:(\d+)/);
  const subject = z(/class="clip lc-subject-media"[^>]*z-index:(\d+)/);
  const frame = z(/<div id="lc-layout-frame"[^>]*z-index:(\d+)/);
  const scene = Math.min(...[...html.matchAll(/class="lc-scene[^"]*" data-launchclip-scene="[^"]*"[^>]*style="z-index:(\d+)/g)].map((match) => Number(match[1])));
  assert.ok(under < subject && subject < frame && frame < scene, `under ${under} < subject ${subject} < frame ${frame} < scenes ${scene}`);
  const plan = layoutPlan(value);
  assert.equal((html.match(/tl\.set\("#lc-layout-frame-under"/g) ?? []).length, plan.ops.length);
  // Every frame op sets the clip, so it clears again outside the breakout.
  const sets = [...html.matchAll(/tl\.set\("#lc-layout-frame", (\{.*?\}), [\d.]+\);/g)].map((match) => JSON.parse(match[1]));
  assert.equal(sets.length, plan.ops.length);
  assert.ok(sets.every((style) => typeof style.clipPath === 'string'));
  assert.equal(sets[0].clipPath, 'none');
  assert.ok(sets.some((style) => style.clipPath.startsWith('polygon(')));
  // The cut-out is mounted over the breakout windows.
  assert.match(html, /class="clip lc-subject-media"[^>]*data-start="2" data-duration="6"/);
  // A story without a breakout is compiled as before: no copy, no clip.
  const {resolved} = await readProjectStory(TALL);
  const plainHtml = (await compileStoryToHyperFrames(resolved, {write: false, sourceDir: TALL})).html;
  assert.doesNotMatch(plainHtml, /lc-layout-frame-under|clip-path:none|"clipPath":"none"/);
});

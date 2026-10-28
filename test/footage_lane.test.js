// Footage-led lane (RFC §3, phase 6): base schema, edl trims, compilers,
// the example story and (with LAUNCHCLIP_PARITY=1) renderer parity.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateStory, resolveStory, storyBase, edlTrim, deriveBoundaries} from '@launchclip/core/story.mjs';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';
import {readProjectStory} from '../src/story_loader.js';
import {checkLayoutProject} from '../src/layout_check.js';
import {runStoryCommand} from '../src/story_cli.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXAMPLE = join(ROOT, 'examples/story/footage');
const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const PLAN = {schema_version: 'launchclip.recording-edit.v1', kept_segments: [{source_start_seconds: 0, source_end_seconds: 8.013}, {source_start_seconds: 10, source_end_seconds: 22}]};

function story(overrides = {}) {
  return {schema: 'launchclip.story.v1', lane: 'footage-led', format: {width: 1080, height: 1920, fps: 30, duration: 20}, brand,
    base: {src: 'assets/recording.mp4', fit: 'cover'},
    scenes: [
      {id: 'p1', module: 'punch-in', track: 2, start: 1, end: 3, params: {at: 0.3}},
      {id: 'lt', module: 'lower-third', track: 1, start: 3, end: 6, params: {name: 'Ada Park'}},
      {id: 'ins', module: 'count-up', insert: true, start: 6, end: 9, in: {type: 'fade', dur: 0.3}, params: {value: 12, label: 'minutes'}}
    ], ...overrides};
}

test('base schema: object form, legacy forms, and strict field checks', () => {
  assert.deepEqual(validateStory(story()).errors, []);
  assert.deepEqual(validateStory(story({base: 'assets/recording.mp4'})).errors, []);
  assert.deepEqual(validateStory(story({base: {source: 'assets/recording.mp4'}})).errors, []);
  const errors = base => validateStory(story({base})).errors.join('\n');
  assert.match(errors({src: 'assets/recording.png'}), /base\.src must be a video file/);
  assert.match(errors({src: '../x.mp4'}), /base\.src must be a project-relative path/);
  assert.match(errors({}), /base\.src is required/);
  assert.match(errors({src: 'assets/r.mp4', fit: 'stretch'}), /base\.fit must be one of cover, contain/);
  assert.match(errors({src: 'assets/r.mp4', volume: 2}), /base\.volume must be a number between 0 and 1/);
  assert.match(errors({src: 'assets/r.mp4', focus: {x: 1.5, y: 0}}), /base\.focus\.x must be a fraction/);
  assert.match(errors({src: 'assets/r.mp4', loop: true}), /base\.loop is not supported/);
  assert.match(errors({src: 'assets/r.mp4', trim: [[2, 1]]}), /base\.trim\[0\] out must be after its in/);
  assert.match(errors({src: 'assets/r.mp4', trim: [[0, 5], [4, 9]]}), /base\.trim\[1\] starts before the previous range ends/);
  assert.match(errors({src: 'assets/r.mp4', trim: [[0, 5]], start: 2}), /base\.start applies only without base\.trim/);
  assert.match(errors({src: 'assets/r.mp4', trim: [[0, 5]], edl: 'recording/edit-plan.json'}), /base\.trim and base\.edl both set the cuts/);
  assert.match(errors({src: 'assets/r.mp4', edl: 'recording/plan.txt'}), /base\.edl must point at an edit-recording plan/);
  assert.match(validateStory(story({base: {src: 'assets/r.mp4', trim: [[0, 5]]}})).warnings.join('\n'), /trimmed base runs 5s, shorter than format\.duration/);
  assert.match(validateStory(story({base: null})).errors.join('\n'), /base is required for the footage-led lane/);
  assert.match(validateStory(story({audio: {mix_volume: 3}})).errors.join('\n'), /audio\.mix_volume must be a number between 0 and 1/);
  assert.match(validateStory(story({audio: {voice: 'assets/v.wav'}})).warnings.join('\n'), /audio\.voice is not mounted in the footage-led lane/);
});

test('footage-led tracks: overlays on track >= 1, inserts on track 0, insert only in this lane', () => {
  const s = story();
  s.scenes[1].track = 0;
  assert.match(validateStory(s).errors.join('\n'), /scenes\[1\] sits on track 0, which is the base/);
  const t = story();
  t.scenes[2].track = 1;
  assert.match(validateStory(t).errors.join('\n'), /scenes\[2\]\.insert scenes cover the base on track 0/);
  const motion = story({lane: 'motion', base: null});
  assert.match(validateStory(motion).errors.join('\n'), /scenes\[2\]\.insert is only for the footage-led lane/);
  const bad = story();
  bad.scenes[2].insert = 'yes';
  assert.match(validateStory(bad).errors.join('\n'), /scenes\[2\]\.insert must be true or false/);
});

test('edl resolves into base.trim; storyBase maps timeline time to frame-snapped segments', () => {
  assert.deepEqual(edlTrim(PLAN), [[0, 8.013], [10, 22]]);
  assert.throws(() => edlTrim({kept_segments: []}), /no kept_segments/);
  assert.throws(() => edlTrim({schema_version: 'other.v2', kept_segments: [{source_start_seconds: 0, source_end_seconds: 1}]}), /unsupported edit plan schema/);
  const s = story({base: {src: 'assets/recording.mp4', edl: 'recording/edit-plan.json', volume: 0.8, focus: {x: 0.5, y: 0.36}}});
  assert.deepEqual(validateStory(s).errors, []);
  const resolved = resolveStory(s, {edl: PLAN});
  assert.deepEqual(resolved.base.trim, [[0, 8.013], [10, 22]]);
  assert.deepEqual(validateStory(resolved).errors, [], 'a resolved story may keep edl beside trim');
  assert.equal(resolveStory(s).base.trim, undefined, 'without the plan the trim stays unset');
  const base = storyBase(resolved);
  assert.deepEqual(base.segments, [
    {index: 0, start: 0, end: 8, duration: 8, sourceStart: 0},
    {index: 1, start: 8, end: 20, duration: 12, sourceStart: 10}
  ]);
  assert.equal(base.volume, 0.8);
  assert.deepEqual(base.focus, {x: 0.5, y: 0.36});
  // No trim: one segment from base.start; the base clips at format.duration.
  assert.deepEqual(storyBase(resolveStory(story({base: {src: 'assets/r.mp4', start: 1.5}}))).segments, [{index: 0, start: 0, end: 20, duration: 20, sourceStart: 1.5}]);
  assert.equal(storyBase(story({base: null})), null);
  assert.equal(storyBase(resolveStory(story({base: 'assets/r.mp4'}))).fit, 'cover');
});

test('an insert cuts in from the base: its boundary has no from scene', () => {
  const boundaries = deriveBoundaries(resolveStory(story()));
  assert.deepEqual(boundaries.map(b => [b.boundary_id, b.from_id, b.kind]), [['ins-in', null, 'ordinary']]);
});

test('HyperFrames: root base videos per segment, base audio, cameras on the base, inserts as plates', async () => {
  const s = resolveStory(story({base: {src: 'assets/recording.mp4', trim: [[0, 8], [10, 22]], volume: 0.7, focus: {x: 0.5, y: 0.4}}, audio: {mix: 'assets/audio/bed.wav', mix_volume: 0.3}}));
  const {html, warnings} = await compileStoryToHyperFrames(s, {write: false});
  const videos = html.match(/<video [^>]*>/g);
  assert.equal(videos.length, 2);
  assert.match(videos[0], /id="lc-base-0" class="clip lc-base-media" src="assets\/recording\.mp4" data-start="0" data-duration="8" data-media-start="0" data-track-index="2"/);
  assert.match(videos[1], /data-start="8" data-duration="12" data-media-start="10"/);
  assert.ok(videos.every(video => / muted playsinline /.test(video) && /object-fit:cover;object-position:50% 40%/.test(video)));
  const baseAudio = html.match(/<audio id="lc-base-audio-\d"[^>]*>/g);
  assert.equal(baseAudio.length, 2);
  assert.ok(baseAudio.every(tag => /data-volume="0\.7" data-track-index="3"/.test(tag)));
  assert.match(html, /<audio id="lc-audio" class="clip" src="assets\/audio\/bed\.wav"[^>]*data-volume="0\.3" data-track-index="0">/);
  // Scenes start above the base tracks.
  assert.match(html, /data-module="punch-in"[^>]*data-launchclip-camera="base"/);
  const tracks = [...html.matchAll(/class="clip[^"]*" data-start="[^"]*" data-duration="[^"]*" data-track-index="(\d+)"/g)].map(m => Number(m[1])).slice(1); // [0] is lc-bg
  assert.ok(tracks.length >= 3 && tracks.every(track => track >= 4), `scene tracks ${tracks}`);
  assert.match(html, /tl\.set\("\.lc-base-media", \{"x":0,"y":0,"scaleX":1,"scaleY":1\}, 0\);/);
  assert.ok((html.match(/tl\.set\("\.lc-base-media"/g) ?? []).length > 60);
  assert.match(html, /class="lc-scene lc-plate" data-launchclip-scene="ins"[^>]*data-launchclip-boundary-id="ins-in"/);
  assert.ok(html.indexOf('id="lc-base-0"') < html.indexOf('lc-scene-p1'), 'base mounts under the scenes');
  assert.deepEqual(warnings, []);
  // Isolated review: the base stays (muted, no audio), only that scene's camera.
  const review = await compileStoryToHyperFrames(s, {write: false, sceneFilter: 'lt'});
  assert.equal((review.html.match(/<video /g) ?? []).length, 2);
  assert.doesNotMatch(review.html, /<audio /);
  assert.doesNotMatch(review.html, /\.lc-base-media/);
});

test('HyperFrames: footage-led never mounts audio.voice; unresolved edl and baseless punch-ins warn', async () => {
  const voiced = resolveStory(story({audio: {voice: 'assets/v.wav'}}));
  assert.doesNotMatch((await compileStoryToHyperFrames(voiced, {write: false})).html, /id="lc-audio"/);
  const unresolved = resolveStory(story({base: {src: 'assets/recording.mp4', edl: 'recording/edit-plan.json'}}));
  assert.match((await compileStoryToHyperFrames(unresolved, {write: false})).warnings.join('\n'), /base\.edl recording\/edit-plan\.json was not resolved/);
  const motion = resolveStory({...story({lane: 'motion', base: null}), scenes: [{id: 'p', module: 'punch-in', track: 1, start: 1, end: 3}]});
  assert.match((await compileStoryToHyperFrames(motion, {write: false})).warnings.join('\n'), /punch-in moves the base recording, but the story has no base/);
});

test('Remotion kit: BaseLayer per segment with trimBefore, camera from the shared ops, bed audio', () => {
  const source = readFileSync(join(ROOT, 'kit/remotion/StoryComposition.tsx'), 'utf8');
  assert.match(source, /export const BaseLayer/);
  assert.match(source, /<OffthreadVideo src=\{staticFile\(base\.src\)\} trimBefore=\{Math\.round\(segment\.sourceStart \* fps\)\}/);
  assert.match(source, /cameraStyle\(cameraOps, t\)/);
  assert.match(source, /const audio = base \? story\.audio\?\.mix \?\? null/);
  assert.match(source, /const offset = Number\(scene\.start\);/);
  assert.match(source, /<BaseLayer base=\{base\} cameraOps=\{cameraOps\} offset=\{offset\} muted/);
});

test('the footage example validates, resolves its edl and layout-checks clean', async () => {
  const result = await runStoryCommand('validate', join(EXAMPLE, 'storyboard.json'));
  assert.equal(result.status, 'passed', result.errors.join('\n'));
  // The example's one quality finding: its hook is a lone punch-in, so the
  // first graphic lands at 2.9 s (VIDEO_QUALITY_RFC §10.1 wants a visual by ~1 s).
  assert.deepEqual(result.warnings, [
    'cadence: first_visual_seconds 2.9 s is above the profile band (at most 1.5 s, target 0.5 s) (profile short-talking-head)',
    'direction: words [0, 5] (hook) call for a visual but play on the camera alone: a missed opportunity unless the why says otherwise'
  ]);
  assert.equal(result.direction.status, 'valid');
  assert.equal(result.direction.profile, 'short-talking-head');
  const {resolved} = await readProjectStory(EXAMPLE);
  assert.deepEqual(resolved.base.trim, [[0, 8], [10, 22]]);
  const modules = resolved.scenes.map(scene => scene.module);
  assert.equal(modules.filter(id => id === 'punch-in').length, 3);
  assert.equal(modules.filter(id => id === 'footage-callout').length, 2);
  assert.ok(modules.includes('lower-third') && modules.includes('emphasis-caption'));
  assert.equal(resolved.scenes.filter(scene => scene.insert).length, 1);
  assert.ok(resolved.overlays.some(overlay => overlay.type === 'captions'));
  // Scene starts on the frame grid keep Remotion Sequences and GSAP in step.
  for (const scene of resolved.scenes) assert.ok(Math.abs(scene.start * 30 - Math.round(scene.start * 30)) < 1e-6, `${scene.id} start ${scene.start}`);
  const layout = await checkLayoutProject(EXAMPLE);
  assert.equal(layout.status, 'passed', JSON.stringify(layout.findings));
  assert.deepEqual(layout.findings, []);
  assert.deepEqual(layout.warnings, []);
  assert.ok(existsSync(join(EXAMPLE, 'assets/recording.mp4')));
  const {html, warnings} = await compileStoryToHyperFrames(resolved, {write: false, sourceDir: EXAMPLE});
  assert.deepEqual(warnings.filter(w => !/font/.test(w)), []);
  assert.match(html, /data-media-start="10"/);
});

// Renderer parity over footage (slow): LAUNCHCLIP_PARITY=1.
const enabled = process.env.LAUNCHCLIP_PARITY === '1';
const FIXTURES = join(ROOT, 'test/fixtures/parity-footage');
for (const file of readdirSync(FIXTURES).filter(name => name.endsWith('.json')).sort()) {
  test(`footage parity: ${file}`, {skip: enabled ? false : 'set LAUNCHCLIP_PARITY=1 to render footage parity fixtures', timeout: 600_000}, async () => {
    const {verifyFixture} = await import('../scripts/parity-footage.mjs');
    const report = await verifyFixture(join(FIXTURES, file), {out: join(ROOT, 'qa', 'parity-footage')});
    for (const row of report.rows) assert.ok(row.pass, `${file} ${row.label} t=${row.t}: ssim ${row.ssim} < ${report.threshold} (see ${row.side})`);
  });
}

// The subject layer in the compilers: HyperFrames markup order, tracks,
// subject camera and room sets; stories without a subject unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveStory} from '@launchclip/core/story.mjs';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const MATTE = {src: 'assets/subject/0.000-6.000.webm', in: 0, out: 6};

function story({subject = {mattes: [MATTE]}, scenes} = {}) {
  return resolveStory({schema: 'launchclip.story.v1', lane: 'footage-led', format: {width: 1080, height: 1920, fps: 30, duration: 6}, brand,
    base: {src: 'assets/recording.mp4', subject},
    scenes: scenes ?? [
      {id: 'word', module: 'emphasis-caption', track: 1, layer: 'behind', start: 1, end: 3, params: {text: 'FOCUS', position: 'upper'}},
      {id: 'name', module: 'lower-third', track: 2, start: 1, end: 4, params: {name: 'Ada Park'}},
      {id: 'push', module: 'punch-in', track: 3, start: 3.5, end: 5, params: {at: 0.2}}
    ]});
}
const compile = async (value) => compileStoryToHyperFrames(value, {write: false});
const zOf = (html, id) => Number(html.match(new RegExp(`id="${id}"[^>]*z-index:(\\d+)`))?.[1]);

test('HyperFrames stacks behind scenes, the subject matte, then front scenes', async () => {
  const {html, warnings} = await compile(story());
  assert.deepEqual(warnings.filter((warning) => /subject|matte/.test(warning)), []);
  const subject = html.match(/<video id="lc-subject-0"[^>]*>/)?.[0];
  assert.ok(subject, 'one matte clip');
  assert.match(subject, /src="assets\/subject\/0\.000-6\.000\.webm"/);
  assert.match(subject, /data-start="1" data-duration="2" data-media-start="1"/, 'mounted only while the behind scene runs');
  assert.match(subject, /data-track-index="4"/);
  const behind = zOf(html, 'lc-scene-word');
  const matte = Number(subject.match(/z-index:(\d+)/)[1]);
  const front = zOf(html, 'lc-scene-name');
  assert.ok(behind < matte && matte < front, `z: behind ${behind} < subject ${matte} < front ${front}`);
  // Scenes start above the subject track.
  assert.doesNotMatch(html.match(/<section[^>]*id="word[^"]*"[^>]*>/)?.[0] ?? '', /data-track-index="[0-4]"/);
});

test('the subject follows the punch-in only where it is mounted', async () => {
  const {html} = await compile(story({scenes: [
    {id: 'word', module: 'emphasis-caption', track: 1, layer: 'behind', start: 1, end: 3, params: {text: 'FOCUS'}},
    {id: 'push', module: 'punch-in', track: 2, start: 1, end: 2.5, params: {at: 0.2}}
  ]}));
  assert.match(html, /\/\/ subject camera/);
  assert.match(html, /tl\.set\("\.lc-subject-media"/);
  assert.match(html, /tl\.set\("\.lc-base-media"/);
});

test('a story with no subject scene compiles exactly as without base.subject', async () => {
  const plain = [{id: 'name', module: 'lower-third', track: 1, start: 1, end: 4, params: {name: 'Ada Park'}}];
  const withMattes = await compile(story({scenes: plain}));
  const without = await compile(resolveStory({...story({scenes: plain}), base: {src: 'assets/recording.mp4'}}));
  assert.equal(withMattes.html, without.html);
  assert.doesNotMatch(withMattes.html, /lc-subject/);
});

test('a behind scene without a matte warns and still compiles', async () => {
  const {html, warnings} = await compile(story({subject: 'auto'}));
  assert.doesNotMatch(html, /<video id="lc-subject/);
  assert.ok(warnings.some((warning) => /word: these scenes need the cut-out subject, but base\.subject has no matte/.test(warning)), warnings.join('\n'));
});

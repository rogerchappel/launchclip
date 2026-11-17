// The direction map's treatment block (docs/PLAN_AND_PACE_RFC.md §1): one
// pass and one fail per field, checked on the map and against a storyboard.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveStory} from '@launchclip/core/story.mjs';
import {validateDirection} from '@launchclip/core/direction.mjs';
import {BANNED_CHECKS, bannedFindings, bannedHold, validateTreatment} from '@launchclip/core/treatment.mjs';

const dir = 'examples/story/promo-16x9/';
const narration = JSON.parse(readFileSync(dir + 'NARRATION.json', 'utf8'));
const words = Array.isArray(narration) ? narration : narration.words;
const raw = JSON.parse(readFileSync(dir + 'storyboard.json', 'utf8'));
const story = resolveStory(raw, {words});
const map = JSON.parse(readFileSync(dir + 'DIRECTION.json', 'utf8'));
const sections = [{id: 's1', scenes: ['s1', 's2', 's3', 's4', 's5', 's6']}];
const check = (treatment, extra = {}) => validateTreatment(treatment, {sections, story, words, ...extra});
const errors = (treatment, extra) => check(treatment, extra).errors.join('\n');

test('a map without a treatment still validates; bespoke requires one', () => {
  assert.equal(validateDirection(map, {words, story}).ok, true);
  assert.match(validateDirection(map, {words, story, tier: 'bespoke'}).errors.join('\n'), /treatment is required on the bespoke tier/);
  assert.match(errors({concept: 'A dot becomes every tool the agent can reach.'}, {tier: 'bespoke'}), /throughline is required/);
  assert.match(errors({sound: {}}), /sound is not a treatment field/);
});

test('concept: one sentence of at most 20 words that is not the title', () => {
  assert.equal(errors({concept: 'One cursor blink grows into every tool the agent can reach.'}), '');
  assert.match(errors({concept: Array(21).fill('word').join(' ')}), /21 words/);
  assert.match(errors({concept: 'AI tools'}), /names a thing that changes/);
});

test('throughline: states name sections in the map and carry by a transition type', () => {
  assert.equal(errors({throughline: {object: 'dot', states: [{at: 's1', form: 'cursor', carry: 'card-to-card'}]}}), '');
  const bad = errors({throughline: {object: 'dot', states: [{at: 's9', form: 'cursor', carry: 'teleport'}]}});
  assert.match(bad, /"s9" is not a section/);
  assert.match(bad, /carry must be a transition type/);
  const warn = validateTreatment({throughline: {object: 'dot', states: [{at: 'a', form: 'x'}]}}, {sections: [{id: 'a'}, {id: 'b'}]}).warnings.join('\n');
  assert.match(warn, /no form in section b/);
});

test('banned tokens map to checks on the plan', () => {
  assert.deepEqual(Object.keys(BANNED_CHECKS), ['crossfade', 'bounce-ease', 'camera-shake', 'brand-before-end', 'particles', 'lens-flare', 'hold>N']);
  assert.equal(bannedHold({banned: ['crossfade', 'hold>1.5']}), 1.5);
  assert.equal(bannedHold({banned: ['crossfade']}), null);
  assert.match(errors({banned: ['hold>soon']}), /hold>N/);
  // promo-16x9 fades s3 in over s2 and shows a logo row at 4.4 s.
  assert.match(errors({banned: ['crossfade']}), /scene "s3" fades in over full-frame scene "s2"/);
  assert.match(errors({banned: ['brand-before-end']}), /scene "s2" \(logo-row\)/);
  assert.equal(errors({banned: ['camera-shake', 'particles', 'lens-flare', 'bounce-ease', 'something-for-the-critic']}), '');
  const bouncy = resolveStory({...raw, motion: {grammar: {ease: {enter: 'back.out(2.2)'}}}}, {words});
  assert.match(bannedFindings(['bounce-ease'], {story: bouncy}).join('\n'), /back\.out\(2\.2\)/);
  const gentle = resolveStory({...raw, motion: {grammar: {ease: {enter: 'back.out(1.2)'}}}}, {words});
  assert.deepEqual(bannedFindings(['bounce-ease'], {story: gentle}), []);
  const leak = {...story, scenes: story.scenes.map((scene) => (scene.id === 's6' ? {...scene, in: {type: 'light-leak'}} : scene))};
  assert.match(bannedFindings(['lens-flare'], {story: leak}).join('\n'), /light-leak/);
});

test('locked copy appears verbatim, in order, and is never reworded', () => {
  const title = story.scenes[0].params.headline;
  assert.ok(title, 'promo-16x9 s1 has a headline');
  assert.equal(errors({locked_copy: {lines: [title]}}), '');
  assert.match(errors({locked_copy: {lines: ['Words nobody wrote']}}), /appears in no scene text and is not spoken/);
  const reworded = {...story, scenes: story.scenes.map((scene, i) => (i === 0 ? {...scene, params: {...scene.params, headline: title.toUpperCase().replace('.', '!')}} : scene))};
  assert.match(validateTreatment({locked_copy: {lines: [title]}}, {sections, story: reworded, words}).errors.join('\n'), /reworded in scene "s1"/);
  const spoken = words.slice(0, 3).map((word) => word.text).join(' ');
  const later = words.slice(20, 23).map((word) => word.text).join(' ');
  assert.match(errors({locked_copy: {lines: [later, spoken]}}), /keep the locked lines in order/);
  const only = check({locked_copy: {only: true, lines: [title]}});
  assert.equal(only.errors.length, 0);
});

test('guardrails: no forbidden phrase in scene text or narration', () => {
  assert.equal(errors({guardrails: [{claim: 'release status', forbid: ['generally available']}]}), '');
  const said = words[2].text.replace(/[^\p{L}\p{N}]/gu, '');
  assert.match(errors({guardrails: [{claim: 'scope', forbid: [said]}]}), /overstates scope/);
  assert.match(errors({guardrails: [{claim: 'x'}]}), /must be \{claim, forbid/);
  // "#1" is a ranking claim, not any lone "1": it matches only as written.
  const sayOn = (text) => ({...story, scenes: story.scenes.map((scene, i) => (i === 0 ? {...scene, params: {...scene.params, headline: text}} : scene))});
  const rail = {guardrails: [{claim: 'market leadership', forbid: ['#1']}]};
  assert.equal(validateTreatment(rail, {sections, story: sayOn('Coming up: 1 question'), words}).errors.join('\n'), '');
  assert.equal(validateTreatment(rail, {sections, story: sayOn('Rated #10 in town'), words}).errors.join('\n'), '');
  assert.match(validateTreatment(rail, {sections, story: sayOn('The #1 deck oil'), words}).errors.join('\n'), /overstates market leadership/);
});

test('locked example: the scene numbers equal the fixed values', () => {
  const scene = {id: 'n', module: 'count-up', start: 0, end: 4, params: {product: 30030, data: [{label: 'plus one', value: 30031}]}};
  const local = {...story, scenes: [scene]};
  assert.equal(validateTreatment({locked_example: {label: 'primes', values: {product: 30030, plus_one: 30031}}}, {story: local}).errors.length, 0);
  const wrong = validateTreatment({locked_example: {label: 'primes', values: {product: 30031, plus_one: 30032}}}, {story: local}).errors.join('\n');
  assert.match(wrong, /sets product 30030/);
  assert.match(wrong, /shows "plus one" as 30031/);
});

test('transitions: every non-cut boundary says what it demonstrates', () => {
  const all = [
    {from: 's1', to: 's2', type: 'push', demonstrates: 'the list slides in from the hook'},
    {from: 's2', to: 's3', type: 'fade', demonstrates: 'the logos settle into steps'},
    {from: 's3', to: 's4', type: 'zoom', demonstrates: 'one step opens into its number'},
    {from: 's4', to: 's5', type: 'morph', demonstrates: 'the figure becomes the window'},
    {from: 's5', to: 's6', type: 'whip', demonstrates: 'the window throws to the ask'}
  ];
  assert.equal(errors({transitions: all}), '');
  assert.match(errors({transitions: all.slice(1)}), /no entry for the push into scene "s2"/);
  assert.match(errors({transitions: [{...all[0], demonstrates: 'push'}, ...all.slice(1)]}), /demonstrates must say/);
  assert.match(check({transitions: [{...all[0], type: 'whip'}, ...all.slice(1)]}).warnings.join('\n'), /says whip into "s2", but the storyboard plays push/);
});

test('signature: no effect names, and it lands between 25% and 85% of the runtime', () => {
  assert.equal(errors({signature: {at: 's4', describe: 'the count stops one short, then ticks over'}}), '');
  assert.match(errors({signature: {at: 's4', describe: 'a glow sweep over the count'}}), /names effects \(glow\)/);
  assert.match(errors({signature: {at: 's1', describe: 'the title lands'}}), /starts at 0 s \(0% of the runtime\)/);
});

test('validateDirection reports treatment errors with the map', () => {
  const result = validateDirection({...map, treatment: {banned: ['crossfade']}}, {words, story});
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /^treatment\.banned crossfade/);
  // Before the storyboard exists only the shape is checked.
  assert.equal(validateDirection({...map, treatment: {banned: ['crossfade']}}, {words, lane: 'motion', deferScenes: true}).ok, true);
});

test('the direction prompt asks for the treatment, starting banned from the style', async () => {
  const {directionPrompt, treatmentLines} = await import('@launchclip/core/planning-prompt.mjs');
  const prompt = directionPrompt({lane: 'motion', format: {width: 1080, height: 1920, duration: 30}, words, avoid: ['crossfade', 'camera-shake'], tier: 'bespoke'});
  assert.match(prompt, /## Treatment \(the film's idea and rules\)/);
  assert.match(prompt, /required on this tier/);
  assert.match(prompt, /Start from the style's list \(crossfade, camera-shake\)/);
  for (const token of Object.keys(BANNED_CHECKS)) assert.ok(prompt.includes(token), token);
  assert.match(treatmentLines().join('\n'), /\(optional\).*\n.*Start from the style's list \(crossfade, bounce-ease, lens-flare\)/s);
});

test('a style may set avoid tokens; they must be strings', async () => {
  const {validateStylePack} = await import('@launchclip/core/style.mjs');
  const pack = JSON.parse(readFileSync('kit/styles/editorial-dark.json', 'utf8'));
  assert.equal(validateStylePack({...pack, avoid: ['crossfade', 'hold>1.0']}).errors.filter((e) => /avoid/.test(e)).length, 0);
  assert.match(validateStylePack({...pack, avoid: 'crossfade'}).errors.join('\n'), /avoid must be a list/);
});

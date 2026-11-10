// Mouths (docs/ANIMATION_PIPELINE_RFC.md §4.6, phase 8): the voice's
// phonemes are kept on each narration word, a rig character's mouth takes a
// shape per phoneme in both renderers, and the lip-sync gate holds drawn
// mouths to the voice. A narration with no phonemes plays as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import gsap from 'gsap';
import {VISEMES, parsePhonemes, phonemeVisemes, speechChanges} from '@launchclip/core/characters/acting.mjs';
import {charactersTimeline} from '@launchclip/core/catalog-characters.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {resolveModule} from '@launchclip/core/modules.mjs';
import {resolveStory} from '@launchclip/core/story.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-characters.mjs';
import * as kokoro from '../src/voice/kokoro.js';
import {dialogueLayout} from '../src/voice/dialogue.js';
import {narrationDocument, narrationRequest, synthesizeNarration} from '../src/voice/narrate.js';
import {applyPronunciation, restoreWords} from '../src/voice/pronunciation.js';
import {finalizeWords, writeWav} from '../src/voice/words.js';
import {LIP_SYNC, lipSyncGate} from '../src/quality_gates.js';
import {loadWords} from '../src/finish.js';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const story = (scenes, extra = {}) => ({schema: 'launchclip.story.v1', lane: 'motion', format: {width: 1920, height: 1080, fps: 30, duration: 8}, brand, cast: {characters: [{id: 'maya'}, {id: 'theo'}]}, scenes, ...extra});

// A take as Kokoro times it (af_heart at 1.2): "My boat moves people." then "Why?".
const WORDS = [
  {text: 'My', start: 0.5, end: 0.64, speaker: 'maya', phonemes: 'm:45 a:50 ɪ:45'},
  {text: 'boat', start: 0.7, end: 1.0, speaker: 'maya', phonemes: 'b:60 ˈ:45 o:70 ʊ:70 t:55'},
  {text: 'moves', start: 1.05, end: 1.45, speaker: 'maya', phonemes: 'm:70 ˈ:30 u:90 ː:60 v:70 z:80'},
  {text: 'people.', start: 1.5, end: 2.1, speaker: 'maya', phonemes: 'p:70 ˈ:45 i:60 ː:45 p:70 ə:74 l:236'},
  {text: 'Why?', start: 2.6, end: 3.0, speaker: 'theo', phonemes: 'w:90 ˈ:60 a:130 ɪ:120'}
];
const shapeAt = (changes, t) => { let shape = 'closed'; for (const change of changes) if (change.time <= t + 1e-9) shape = change.shape; return shape; };
const talk = (cast, extra = {}) => ({id: 'talk', module: 'cast-scene', start: 0, end: 6, params: {set: 'phone', cast}, ...extra});

test('Kokoro keeps each word\'s phonemes and their lengths; a number read as two words keeps the pause between them', async () => {
  const phonemes = 'ɪt ɪz θɜːɾi faɪv dɪɡɹiːz.';
  const words = await kokoro.wordsFromPhonemeDurations(['It', 'is', '35', 'degrees.'], phonemes, Array.from(phonemes).map(() => 0.05), 0.1,
    {phonemize: async token => ({It: 'ɪt', is: 'ɪz', 35: 'θɜːɾi faɪv', 'degrees.': 'dɪɡɹiːz'})[token]});
  assert.deepEqual(words.map(word => word.phonemes), ['ɪ:50 t:50', 'ɪ:50 z:50', 'θ:50 ɜ:50 ː:50 ɾ:50 i:50 _:50 f:50 a:50 ɪ:50 v:50', 'd:50 ɪ:50 ɡ:50 ɹ:50 i:50 ː:50 z:50']);
  for (const word of words) assert.ok(Math.abs(parsePhonemes(word.phonemes).reduce((sum, [, seconds]) => sum + seconds, 0) - (word.end - word.start)) < 1e-6, `${word.text}: the lengths add up to the word`);
  assert.equal(kokoro.wordPhonemes('ab', [0, 0], 0, 2), null, 'nothing with a length is no phonemes');
  // Fewer phoneme words than script words: the timings are shared out, and no word claims phonemes.
  const shared = await kokoro.wordsFromPhonemeDurations(['a', 'b', 'c'], 'xx yy', [0.1, 0.1, 0.05, 0.1, 0.1], 0);
  assert.ok(shared.every(word => word.phonemes === undefined));
  assert.deepEqual(finalizeWords([{text: 'Hi', start: 0.1, end: 0.4, phonemes: 'h:100 a:100 ɪ:100'}, {text: 'you', start: 0.5, end: 0.8}], 1), [{text: 'Hi', start: 0.1, end: 0.4, phonemes: 'h:100 a:100 ɪ:100'}, {text: 'you', start: 0.5, end: 0.8}]);
});

test('NARRATION.json: words carry phonemes through the take cache, a dialogue join and a respelled term; a voice with none writes none', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lc-lipsync-'));
  const cacheDir = path.join(dir, 'cache');
  let calls = 0;
  const provider = phonemes => () => ({name: 'fake', async synthesize({outFile}) {
    calls += 1;
    await writeWav(outFile, new Float32Array(24000), 24000);
    return {file: outFile, sampleRate: 24000, duration: 1, words: [{text: 'Hi', start: 0.1, end: 0.4, ...(phonemes ? {phonemes: 'h:100 a:100 ɪ:100'} : {})}, {text: 'there.', start: 0.45, end: 0.9}]};
  }});
  const request = narrationRequest({text: 'Hi there.', provider: 'kokoro'});
  const take = await synthesizeNarration(request, {outFile: path.join(dir, 'voice.wav'), cacheDir, voiceProvider: provider(true)});
  assert.deepEqual(take.words, [{text: 'Hi', start: 0.1, end: 0.4, phonemes: 'h:100 a:100 ɪ:100'}, {text: 'there.', start: 0.45, end: 0.9}]);
  const again = await synthesizeNarration(request, {outFile: path.join(dir, 'voice.wav'), cacheDir, voiceProvider: provider(true)});
  assert.equal(again.cached, true);
  assert.equal(calls, 1);
  assert.deepEqual(again.words, take.words, 'the cached take keeps them');
  const doc = narrationDocument(request, again);
  assert.equal(doc.schema_version, 'launchclip.narration.v1', 'the same file version: phonemes are an optional field on a word');
  assert.equal(doc.words[0].phonemes, 'h:100 a:100 ɪ:100');
  // A take cached before phonemes were kept is still a hit, and has none.
  const metaFile = path.join(cacheDir, `${take.cache_key}.json`);
  const meta = JSON.parse(await readFile(metaFile, 'utf8'));
  await writeFile(metaFile, JSON.stringify({...meta, words: meta.words.map(({phonemes, ...word}) => word)}));
  const old = await synthesizeNarration(request, {outFile: path.join(dir, 'voice.wav'), cacheDir, voiceProvider: provider(true)});
  assert.equal(old.cached, true);
  assert.ok(old.words.every(word => !('phonemes' in word)));
  const plain = await synthesizeNarration(narrationRequest({text: 'Hi there.', provider: 'elevenlabs', voice: 'x'}), {outFile: path.join(dir, 'b.wav'), voiceProvider: provider(false)});
  assert.ok(plain.words.every(word => !('phonemes' in word)), 'a voice that reports no phonemes writes no field');
  // Dialogue: a line's words move to their place in the join; phonemes are lengths from the word's start, so they move with it.
  const line = (text, speaker) => ({speaker, request: {voice: 'af_heart', text}, take: {words: [{text, start: 0.2, end: 0.75, phonemes: 'w:90 a:230 ɪ:230'}], duration: 1, cached: true}});
  const layout = dialogueLayout([line('One.', 'maya'), line('Two.', 'theo')], [0.3]);
  assert.deepEqual(layout.words.map(word => [word.speaker, word.phonemes]), [['maya', 'w:90 a:230 ɪ:230'], ['theo', 'w:90 a:230 ɪ:230']]);
  // A term respelled into two spoken words is one script word again, with both words' phonemes and the pause between.
  const spoken = applyPronunciation('Try kubectl now.', {kubectl: 'cube control'});
  const restored = restoreWords([{text: 'Try', start: 0, end: 0.2, phonemes: 't:100 a:100'}, {text: 'cube', start: 0.25, end: 0.5, phonemes: 'k:250'}, {text: 'control', start: 0.54, end: 0.9, phonemes: 'k:360'}, {text: 'now.', start: 1, end: 1.2}], 'Try kubectl now.', spoken);
  assert.deepEqual(restored.map(word => word.phonemes), ['t:100 a:100', 'k:250 _:40 k:360', undefined]);
  assert.deepEqual([restored[1].text, restored[1].start, restored[1].end], ['kubectl', 0.25, 0.9]);
});

test('a word\'s mouth shapes follow its phonemes for as long as the voice holds each', () => {
  assert.deepEqual(parsePhonemes('b:60 ˈ:45 o:70'), [['b', 0.06], ['ˈ', 0.045], ['o', 0.07]]);
  assert.deepEqual(parsePhonemes('b:60 oops'), [], 'a malformed entry is no phonemes');
  // "boat": lips pressed on the b, round through the vowel (the stress mark is the vowel's), the short t gives way.
  assert.deepEqual(phonemeVisemes('b:60 ˈ:45 o:70 ʊ:70 t:55', 0.7, 1.0), [{time: 0.7, shape: 'closed'}, {time: 0.77, shape: 'o', until: 1.0}]);
  // "my": open then spread, as the vowel glides.
  assert.deepEqual(phonemeVisemes('m:100 a:100 ɪ:100', 0, 0.3).map(run => run.shape), ['closed', 'open', 'wide']);
  // The lengths are fitted to the word: the same shapes at twice the length.
  assert.deepEqual(phonemeVisemes('m:100 a:100 ɪ:100', 0, 0.6).map(run => run.time), [0, 0.2, 0.4]);
  // An h takes the shape of the vowel after it; a trailing consonant lets the mouth close before a long word end.
  const hello = phonemeVisemes('h:43 ə:56 l:43 ˈ:72 o:84 ʊ:311', 0, 0.609);
  assert.deepEqual(hello.map(run => run.shape), ['small', 'o']);
  assert.equal(hello[0].time, 0);
  const people = phonemeVisemes('p:70 ˈ:45 i:60 ː:45 p:70 ə:74 l:236', 1.5, 2.1);
  assert.deepEqual(people.map(run => run.shape), ['closed', 'wide', 'closed', 'small']);
  assert.ok(people.at(-1).until < 2.1 - 0.05, 'the l trails off and the mouth closes before the word\'s end');
  // A rest inside a word (a number read as two words) closes the mouth when it is long enough to see.
  assert.ok(phonemeVisemes('θ:60 ɜ:90 ɾ:60 i:90 _:120 f:60 a:90 ɪ:90 v:60', 0, 0.72).some(run => run.shape === 'closed'));
  // Kokoro's one-letter diphthongs glide too.
  assert.deepEqual(phonemeVisemes('n:80 W:200', 0, 0.28).map(run => run.shape), ['small', 'open', 'o']);
  assert.equal(phonemeVisemes('', 0, 1), null);
  assert.equal(phonemeVisemes('h:50 ˈ:20', 0, 1), null, 'nothing with a shape: the caller reads the spelling');
  for (const word of WORDS) {
    const runs = phonemeVisemes(word.phonemes, word.start, word.end);
    assert.ok(runs.every(run => run.shape in VISEMES), word.text);
    assert.ok(runs.every((run, i) => i === 0 || run.time - runs[i - 1].time >= 0.05 - 1e-9), `${word.text}: no shape shorter than a frame and a half`);
    assert.ok(runs.every((run, i) => i === 0 || run.shape !== runs[i - 1].shape), word.text);
  }
});

test('speechChanges: words with phonemes take them; words without keep the spelling path; the two differ where spelling guesses wrong', () => {
  const heard = WORDS.slice(0, 4).map(word => [word.start, word.end, word.text, word.phonemes]);
  const says = [{from: 0.5, to: 2.1, words: heard}];
  const changes = speechChanges(says);
  assert.deepEqual(changes, speechChanges(says), 'the same every time');
  assert.ok(changes.every((change, i) => i === 0 || change.time > changes[i - 1].time));
  assert.equal(shapeAt(changes, 0.4), 'closed');
  assert.equal(shapeAt(changes, 0.72), 'closed', 'the b of "boat"');
  assert.equal(shapeAt(changes, 0.9), 'o', 'its vowel, held to the word\'s end: the t is too short to see');
  assert.equal(shapeAt(changes, 1.08), 'closed', 'the m of "moves"');
  assert.equal(shapeAt(changes, 1.2), 'o');
  assert.equal(shapeAt(changes, 1.33), 'small', 'the v and z of "moves"');
  assert.equal(shapeAt(changes, 1.65), 'wide', 'the ee of "people", spelt eo');
  assert.equal(shapeAt(changes, 1.76), 'closed', 'its second p');
  assert.equal(shapeAt(changes, 2.3), 'closed', 'closed after the line');
  const spelt = speechChanges([{from: 0.5, to: 2.1, words: heard.map(word => word.slice(0, 3))}]);
  assert.notDeepEqual(changes, spelt);
  assert.equal(shapeAt(spelt, 1.33), 'wide', 'spelling reads the silent e of "moves"');
  assert.equal(shapeAt(spelt, 1.76), 'o', 'and the o of "people", which nobody says');
  // One word with phonemes beside one without: each takes its own path.
  const mixed = speechChanges([{from: 0, to: 1, words: [[0, 0.3, 'boat', 'b:60 ˈ:45 o:70 ʊ:70 t:55'], [0.5, 0.9, 'you']]}]);
  assert.deepEqual(mixed.map(change => change.shape), ['closed', 'o', 'closed', 'wide', 'o', 'closed']);
  // says: "auto" makes a range of every word: the mouth still runs on into a word that follows at once, and closes at a pause.
  const auto = speechChanges([{from: 0, to: 0.3, words: [[0, 0.3, 'you']]}, {from: 0.33, to: 0.6, words: [[0.33, 0.6, 'are']]}, {from: 1, to: 1.3, words: [[1, 1.3, 'you']]}]);
  assert.deepEqual(auto.filter(change => !change.open).map(change => change.time), [0.6, 1.3]);
  // Malformed phonemes fall back to the spelling.
  assert.deepEqual(speechChanges([{from: 0, to: 1, words: [[0.5, 0.9, 'you', 'nonsense']]}]), speechChanges([{from: 0, to: 1, words: [[0.5, 0.9, 'you']]}]));
});

test('the story resolver hands a narration word\'s phonemes to the scene; an older narration with none still plays', () => {
  const scene = talk([{id: 'maya', says: 'auto'}, {id: 'theo', says: [{from: 'word:Why', to: 'word:Why'}]}]);
  const resolved = resolveStory(story([scene]), {words: WORDS});
  const [maya, theo] = resolved.scenes[0].params.cast;
  assert.deepEqual(maya.says[1], {from: 0.7, to: 1, words: [[0.7, 1, 'boat', 'b:60 ˈ:45 o:70 ʊ:70 t:55']]});
  assert.deepEqual(theo.says[0].words, [[2.6, 3, 'Why?', 'w:90 ˈ:60 a:130 ɪ:120']]);
  const model = resolveModule(resolved.scenes[0], resolved);
  assert.equal(shapeAt(model.content.actors[0].speech, 0.9), 'o');
  // The same story over a narration written before phonemes were kept.
  const older = WORDS.map(({phonemes, ...word}) => word);
  const before = resolveStory(story([scene]), {words: older});
  assert.deepEqual(before.scenes[0].params.cast[0].says[1], {from: 0.7, to: 1, words: [[0.7, 1, 'boat']]});
  const played = resolveModule(before.scenes[0], before).content.actors[0].speech;
  assert.ok(played.length >= 6 && played.some(change => change.open), 'the mouth still moves, from the spelling');
  assert.equal(shapeAt(played, 0.92), 'small', 'the spelling path gives the t a third of the word');
  // A word cut by the scene's end keeps its text and drops its phonemes: the lengths no longer fit.
  const cut = resolveModule({...resolved.scenes[0], params: {set: 'phone', cast: [{id: 'maya', says: [{from: 5.8, to: 6.4, words: [[5.8, 6.4, 'boat', 'b:60 ˈ:45 o:70 ʊ:70 t:55']]}]}]}}, resolved);
  assert.deepEqual(cut.content.actors[0].says[0].words, [[5.8, 6, 'boat']]);
});

test('both renderers: a talking scene driven by phonemes reads the same through GSAP as through frameState, at every frame of the line and seeking in any order', () => {
  const scene = talk([{id: 'maya', says: 'auto', cues: [{at: 1.2, expression: 'happy'}]}, {id: 'theo', says: 'auto', cues: [{at: 2.5, pose: 'shrug'}]}]);
  const resolved = resolveStory(story([scene]), {words: WORDS});
  const model = resolveModule(resolved.scenes[0], resolved);
  const ops = charactersTimeline(model);
  const {motion} = EMITTERS['cast-scene'](model);
  assert.doesNotMatch(motion, /onUpdate|Math\.random|Date/);
  const objects = new Map();
  const real = gsap.timeline({paused: true});
  const target = selector => { if (!objects.has(selector)) objects.set(selector, {}); return objects.get(selector); };
  // GSAP animates only properties its target already has.
  for (const op of ops) for (const key of Object.keys(op.props ?? op.to ?? {})) target(`#${op.target}`)[key] ??= 0;
  runInNewContext(motion, {tl: {set: (s, v, p) => real.set(target(s), v, p), fromTo: (s, f, t, p) => real.fromTo(target(s), f, t, p)}});
  const mouths = [...frameState(ops, 0).keys()].filter(id => /-(mouth|open)-/.test(id));
  assert.ok(mouths.length >= 4, 'each face has a closed and an open mouth');
  // Every frame of the two lines at 30 fps, then the same frames backwards (a seek must not depend on what played before).
  const frames = Array.from({length: Math.round((3.3 - 0.3) * 30)}, (_, i) => Math.round((0.3 + i / 30) * 10000) / 10000);
  const seen = new Set();
  let checked = 0;
  for (const t of [...frames, ...[...frames].reverse()]) {
    real.seek(t, false);
    const state = frameState(ops, t);
    for (const id of mouths) {
      const want = state.get(id), got = objects.get(`#${id}`);
      for (const [key, value] of Object.entries(want)) {
        assert.ok(Math.abs(got[key] - value) < 1e-3, `${id}.${key} at ${t}: gsap ${got[key]} vs frameState ${value}`);
        checked++;
      }
    }
    // The mouth both renderers show is the phoneme's shape at that time.
    const shape = shapeAt(model.content.actors[0].speech, t), open = state.get('talk-c0-open-neutral'), closed = state.get('talk-c0-mouth-neutral');
    seen.add(shape);
    assert.equal(closed.opacity, shape === 'closed' ? 1 : 0, `closed mouth at ${t}`);
    assert.equal(open.opacity, shape === 'closed' ? 0 : 1, `open mouth at ${t}`);
    if (shape !== 'closed') assert.deepEqual([open.scaleX, open.scaleY], VISEMES[shape], `${shape} at ${t}`);
  }
  assert.ok(checked > 2000, `${checked} mouth values compared`);
  assert.deepEqual([...seen].sort(), ['closed', 'o', 'open', 'small', 'wide'], 'maya\'s line shows every shape: pressed lips, round, dropped and spread vowels, part-open consonants');
});

test('lip-sync gate: fails a scene whose speaking character\'s mouth does not move during its words, and passes one where it does', () => {
  const gate = cast => { const resolved = resolveStory(story([talk(cast)]), {words: WORDS}); return lipSyncGate({resolved, words: WORDS}); };
  const passed = gate([{id: 'maya', says: 'auto'}, {id: 'theo', says: 'auto'}]);
  assert.equal(passed.status, 'passed', passed.errors?.join('\n'));
  assert.deepEqual([passed.scenes, passed.lines, passed.findings], [1, 2, []]);
  // Theo's scene entry leaves `says` out: his mouth still moves on his own words.
  const left = gate([{id: 'maya', says: 'auto'}, {id: 'theo'}]);
  assert.equal(left.status, 'passed', left.errors?.join('\n'));
  // An empty `says` keeps his mouth shut: his line plays over a still mouth.
  const silent = gate([{id: 'maya', says: 'auto'}, {id: 'theo', says: []}]);
  assert.equal(silent.status, 'failed');
  assert.deepEqual(silent.findings.map(finding => [finding.rule, finding.scene, finding.character, finding.at, finding.end]), [['mouth-closed', 'talk', 'theo', 2.6, 3]]);
  assert.match(silent.errors[0], /talk: theo says "Why\?" \(2\.6–3 s\) with its mouth closed; give it says: "auto"/);
  // Nobody's mouth moves at all.
  const still = gate([{id: 'maya', says: []}, {id: 'theo', says: []}]);
  assert.deepEqual(still.findings.map(finding => [finding.rule, finding.character]), [['mouth-closed', 'maya'], ['mouth-closed', 'theo']]);
  // Maya's mouth is timed to Theo's line as well as her own: open with no speech of hers under it.
  const wrong = gate([{id: 'maya', says: [{from: 0.5, to: 3.6}]}, {id: 'theo', says: 'auto'}]);
  assert.equal(wrong.status, 'failed');
  assert.deepEqual(wrong.findings.map(finding => [finding.rule, finding.character]), [['mouth-open-silent', 'maya']]);
  assert.match(wrong.errors[0], /maya's mouth is open for .* s with no speech of its own under it .*while theo speaks/);
  // A mouth flapping through silence, in a narration with no speakers.
  const narrated = WORDS.map(({speaker, ...word}) => word);
  const flap = talk([{id: 'maya', says: [{from: 3.6, to: 5.6}]}]);
  const flapping = lipSyncGate({resolved: resolveStory(story([flap]), {words: narrated}), words: narrated});
  assert.deepEqual(flapping.findings.map(finding => finding.rule), ['mouth-open-silent']);
  // The same narration, the mouth on its words: any voice will do when the words carry no speaker.
  const anchored = talk([{id: 'maya', says: [{from: 'word:My', to: 'word:people'}]}]);
  assert.equal(lipSyncGate({resolved: resolveStory(story([anchored]), {words: narrated}), words: narrated}).status, 'passed');
  // The older narration (no phonemes) passes the same way.
  const older = WORDS.map(({phonemes, ...word}) => word);
  assert.equal(lipSyncGate({resolved: resolveStory(story([talk([{id: 'maya', says: 'auto'}, {id: 'theo', says: 'auto'}])]), {words: older}), words: older}).status, 'passed');
});

test('lip-sync gate: what it skips, and what it lets through', () => {
  const both = talk([{id: 'maya', says: 'auto'}, {id: 'theo', says: 'auto'}]);
  assert.equal(lipSyncGate({resolved: story([{id: 'card', module: 'hook-title', start: 0, end: 3, params: {}}]), words: WORDS}).status, 'skipped');
  const spoken = resolveStory(story([both]), {words: WORDS});
  assert.deepEqual(lipSyncGate({resolved: spoken, words: []}), {status: 'not-checked', scenes: 1, reason: 'mouths move but there are no narration words to check them against'});
  assert.equal(lipSyncGate({resolved: resolveStory(story([talk([{id: 'maya'}])]), {words: []}), words: null}).status, 'skipped');
  // Off-screen speech is not a mouth's fault: only Maya is in the scene, and Theo's line plays over it.
  assert.equal(lipSyncGate({resolved: resolveStory(story([talk([{id: 'maya', says: 'auto'}])]), {words: WORDS}), words: WORDS}).status, 'passed');
  // A line of pressed lips only keeps the mouth closed, rightly.
  const hum = [{text: 'Mmm.', start: 1, end: 1.6, speaker: 'maya', phonemes: 'm:600'}];
  const humming = resolveStory(story([talk([{id: 'maya', says: 'auto'}])]), {words: hum});
  assert.equal(resolveModule(humming.scenes[0], humming).content.actors[0].speech.some(change => change.open), false);
  assert.notEqual(lipSyncGate({resolved: humming, words: hum}).status, 'failed');
  // The mouth may lead or trail a word by the slack, no more.
  assert.ok(LIP_SYNC.slack <= 0.15 && LIP_SYNC.open <= 0.2);
});

test('finish hands the narration\'s phonemes to the scenes it renders', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lc-lipsync-finish-'));
  await writeFile(path.join(dir, 'NARRATION.json'), JSON.stringify({schema_version: 'launchclip.narration.v1', words: WORDS}));
  const board = story([talk([{id: 'maya', says: 'auto'}, {id: 'theo', says: 'auto'}])], {audio: {words: 'NARRATION.json'}});
  const words = await loadWords(dir, board);
  assert.deepEqual(words, WORDS, 'text, times, speaker and phonemes all reach the resolver');
  const resolved = resolveStory(board, {words});
  assert.deepEqual(resolved.scenes[0].params.cast[0].says[1].words, [[0.7, 1, 'boat', 'b:60 ˈ:45 o:70 ʊ:70 t:55']]);
  assert.equal(shapeAt(resolveModule(resolved.scenes[0], resolved).content.actors[0].speech, 0.9), 'o', 'the mouth is on the phoneme, not the spelling');
  // A narration with no phonemes loads as before.
  await writeFile(path.join(dir, 'NARRATION.json'), JSON.stringify({words: WORDS.map(({phonemes, ...word}) => word)}));
  assert.ok((await loadWords(dir, board)).every(word => !('phonemes' in word)));
});

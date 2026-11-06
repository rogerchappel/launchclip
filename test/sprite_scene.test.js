// Illustrated characters: sprite-scene (kit/core/catalog-sprites.mjs) and
// sprite casts (src/sprite_cast.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MODULES, charactersTimeline, charactersView} from '@launchclip/core/catalog-characters.mjs';
import {spriteStates, spriteSrc} from '@launchclip/core/catalog-sprites.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-characters.mjs';
import {knownModules, resolveModule} from '@launchclip/core/modules.mjs';
import {SPEAKING_MODULES, resolveStory} from '@launchclip/core/story.mjs';
import {resolveStoryCast, storyCastErrors} from '@launchclip/core/characters/cues.mjs';
import {chromaKey, encodePng, makeSpriteCast, normalizeSpriteCast, spriteCastCost, spriteRequests, storyCastEntries} from '../src/sprite_cast.js';
import {decodePng} from '../src/visual_snapshot.js';
import {dialogueRequests} from '../src/voice/dialogue.js';

const brand = {colors: {bg: '#14122b', primary: '#ffb547', accent: '#6d5dfc', ink: '#14122b', paper: '#f6f3ee'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const cast = {characters: [{id: 'dre', name: 'Dre', art: 'assets/cast/dre'}, {id: 'walt', name: 'Walt', art: 'assets/cast/walt', voice: 'el-walt-voice'}]};
const scene = (params = {}, extra = {}) => ({id: 'jackpot', module: 'sprite-scene', start: 0, end: 5, ...extra, params: {plate: 'assets/plates/casino.png',
  cast: [{id: 'dre', talk: true, blink: true, cues: [{at: 2, pose: 'shocked'}], says: [{from: 0.3, to: 1.5}]}, {id: 'walt', says: [{from: 2.5, to: 3.4}]}], ...params}});
const story = (scenes, more = {}) => ({schema: 'launchclip.story.v1', lane: 'motion', format: {width: 1080, height: 1920, fps: 30, duration: 5}, brand, cast, scenes, ...more});
const resolve = (s, more) => resolveModule(s, story([s], more));

test('sprite-scene is registered with the character modules, in both renderers', () => {
  assert.ok(knownModules().includes('sprite-scene'));
  assert.ok(MODULES['sprite-scene'].describe.includes('illustrated'));
  assert.equal(typeof EMITTERS['sprite-scene'], 'function');
  const registry = readFileSync(fileURLToPath(new URL('../kit/remotion/catalog/registry-characters.ts', import.meta.url)), 'utf8');
  assert.match(registry, /'sprite-scene': SpriteScene/);
  assert.ok(SPEAKING_MODULES.includes('sprite-scene'));
});

test('spriteStates: pose cues swap the sprite, the talk sprite shows on words, a blink never lands mid-word', () => {
  const speech = [{time: 1, open: true}, {time: 1.15, open: false}, {time: 1.3, open: true}, {time: 1.45, open: false}];
  const states = spriteStates({start: 0, end: 10, pose: 'idle', cues: [{time: 4, pose: 'shocked'}], speech, talk: true, blink: true});
  assert.deepEqual(states.slice(0, 1), [{time: 0, pose: 'idle', face: 'rest'}]);
  assert.ok(states.some(s => s.time === 1 && s.face === 'talk'));
  assert.ok(states.some(s => s.time === 4 && s.pose === 'shocked'));
  for (const s of states.filter(s => s.face === 'blink')) assert.ok(!(s.time >= 1 && s.time < 1.45), `blink at ${s.time} during speech`);
  assert.ok(states.filter(s => s.face === 'blink').length >= 2, 'blinks every few seconds');
  // No talk sprites: the face never swaps to talk (the jaw bounce stands in).
  assert.ok(spriteStates({start: 0, end: 3, pose: 'idle', cues: [], speech, talk: false, blink: false}).every(s => s.face === 'rest'));
});

test('sprite-scene: art from the story cast, two sprites side by side in a portrait frame, a name card off the face', () => {
  const model = resolve(scene({card: {name: 'Dre', role: 'the cousin'}}));
  const [dre, walt] = model.content.actors;
  assert.equal(dre.art, 'assets/cast/dre');
  assert.deepEqual(dre.poses, ['idle', 'shocked']);
  for (const a of [dre, walt]) assert.ok(a.box.x >= 0 && a.box.x + a.box.width <= 1080, `${a.id} on the canvas`);
  assert.ok(dre.box.x + dre.box.width / 2 < walt.box.x + walt.box.width / 2);
  const card = model.content.card.box;
  assert.ok(card.y + card.height <= dre.box.y + dre.box.height * 0.1 || card.x + card.width <= dre.box.x + dre.box.width * 0.3, 'card clear of the face');
  assert.equal(model.content.fade.enter, 0, 'the opening scene cuts in on frame 0');
  assert.deepEqual(model.events.map(e => e.name).filter(n => n !== 'enter'), ['cast', 'card', 'dre-cue-0']);
});

test('sprite-scene: one sprite visible per character at any time; the plate and cast move', () => {
  const model = resolve(scene());
  const ops = charactersTimeline(model);
  const view = charactersView(model);
  const ids = new Set(); const walk = n => { if (n?.id) ids.add(n.id); for (const k of n?.children ?? []) if (typeof k === 'object') walk(k); };
  walk(view.front);
  assert.ok(ids.has('jackpot-dre-shocked-talk') && ids.has('jackpot-dre-idle-blink') && !ids.has('jackpot-walt-idle-talk'));
  for (const actor of model.content.actors) {
    const sprites = [...ids].filter(id => id.startsWith(`jackpot-${actor.id}-`) && /-(rest|talk|blink)$/.test(id));
    for (const t of [0.05, 0.5, 1.0, 2.2, 3.0, 4.5]) {
      const visible = sprites.filter(id => { const last = ops.filter(op => op.target === id && op.type === 'set' && op.time <= t + 1e-6 && op.props.opacity !== undefined).at(-1); return last && last.props.opacity === 1; });
      assert.equal(visible.length, 1, `${actor.id} at ${t}: ${visible}`);
    }
  }
  const plate = ops.filter(op => op.target === 'jackpot-plate');
  assert.ok(plate.at(-1).props.scaleX > plate[0].props.scaleX, 'the plate pushes in');
  // Walt has no talk sprites: a jaw bounce while he speaks.
  const walt = ops.filter(op => op.target === 'jackpot-walt' && op.type === 'set');
  const at = t => walt.reduce((best, op) => (op.time <= t ? op : best), walt[0]).props;
  assert.ok(at(2.8).scaleY / at(2.8).scaleX > at(4.2).scaleY / at(4.2).scaleX + 0.008);
  assert.equal(spriteSrc('assets/cast/dre', 'idle', 'talk'), 'assets/cast/dre/idle-talk.png');
});

test('sprite-scene: says "auto" takes the character\'s own dialogue words, clipped at the cut', () => {
  const s = scene({cast: [{id: 'dre', says: 'auto', talk: true}]}, {end: 2});
  const words = [{text: 'One', start: 0.4, end: 0.7, speaker: 'dre'}, {text: 'spin.', start: 0.8, end: 1.2, speaker: 'dre'}, {text: 'Hit!', start: 1.8, end: 2.3, speaker: 'dre'}, {text: 'Then', start: 1.3, end: 1.5, speaker: 'walt'}];
  // Not the last scene (the last one holds on past its end), so its words stop at the cut.
  const next = {id: 'after', module: 'sprite-scene', start: 2, end: 4, params: {plate: 'assets/plates/casino.png', cast: [{id: 'walt'}]}};
  const resolved = resolveStory(story([s, next], {format: {width: 1080, height: 1920, fps: 30, duration: 4}}), {words});
  const model = resolveModule(resolved.scenes[0], resolved);
  const dre = model.content.actors[0];
  assert.equal(dre.says.length, 3);
  assert.ok(dre.says.every(range => range.to <= 2 + 1e-9));
  assert.ok(dre.states.some(st => st.face === 'talk' && st.time >= 0.4 && st.time < 0.5));
});

test('sprite characters in the story cast: no rig params, and only sprite-scene may stage them', () => {
  assert.deepEqual(storyCastErrors(cast), []);
  assert.match(storyCastErrors({characters: [{id: 'dre', art: 'assets/cast/dre', skin: 'tan'}]}).join(), /skin is not used by an illustrated character/);
  assert.match(storyCastErrors({characters: [{id: 'dre', art: 'https://x/y'}]}).join(), /art must be the character's sprite folder/);
  assert.equal(resolveStoryCast({cast}).members.get('dre').sprite, true);
  const desk = {id: 'desk', module: 'cast-scene', start: 0, end: 4, params: {set: 'standing', cast: [{id: 'dre'}]}};
  assert.throws(() => resolveModule(desk, story([desk])), /illustrated character .* acts in sprite-scene/);
  assert.throws(() => resolve(scene({cast: [{id: 'zed'}]})), /"zed" has no art in the story cast/);
  assert.throws(() => resolve(scene({cast: [{id: 'dre', pose: 'Big Smile'}]})), /must be a pose name/);
});

test('dialogue: a character keeps its own ElevenLabs voice; Kokoro ids still need Kokoro', () => {
  const s = {...story([]), cast: {characters: [{id: 'walt', art: 'assets/cast/walt', voice: 'el-walt-voice'}, {id: 'dre', art: 'assets/cast/dre', voice: 'am_michael'}]},
    audio: {narration: {provider: 'elevenlabs', voice: 'narrator-voice', lines: [{speaker: 'walt', text: 'Then we take it back.'}, {speaker: 'dre', text: 'One spin.'}, {speaker: 'narrator', text: 'Tonight.'}]}}};
  const [walt, dre, narrator] = dialogueRequests(s);
  assert.equal(walt.request.voice, 'el-walt-voice');
  assert.equal(dre.request.voice, 'narrator-voice', 'a Kokoro id is not an ElevenLabs voice');
  assert.equal(narrator.request.voice, 'narrator-voice');
});

// ---------------------------------------------------------------------------
// Sprite casts

const castFile = {style: 'flat cartoon', characters: [{id: 'dre', name: 'Dre', role: 'the cousin', design: 'a young man in a red bomber jacket and black beanie', poses: ['idle', 'shocked']}, {id: 'walt', design: 'an old night guard with round glasses and a brown cardigan', talk: false}]};

test('sprite cast: the anchor first, every other picture an edit of it, talk and blink edits of their pose', () => {
  const cast = normalizeSpriteCast(castFile);
  const requests = spriteRequests(cast);
  const dre = requests.filter(r => r.id === 'dre');
  assert.deepEqual(dre.map(r => `${r.pose}:${r.face}`), ['idle:rest', 'idle:talk', 'idle:blink', 'shocked:rest', 'shocked:talk', 'shocked:blink']);
  assert.equal(dre[0].edit, null);
  assert.deepEqual(dre[3].references, ['assets/cast/dre/idle.png']);
  assert.deepEqual(dre[4].references, ['assets/cast/dre/shocked.png']);
  assert.match(dre[0].prompt, /#00FF00/);
  assert.match(dre[1].prompt, /mouth is open/);
  assert.deepEqual(requests.filter(r => r.id === 'walt').map(r => r.face), ['rest', 'blink'], 'talk: false makes no talk sprite');
  assert.deepEqual(spriteCastCost(cast), {images: 8, per_image_usd: 0.063, usd: 0.504});
  assert.deepEqual(storyCastEntries(cast), [{id: 'dre', name: 'Dre'}, {id: 'walt', name: 'walt'}]);
  assert.throws(() => normalizeSpriteCast({characters: [{id: 'Dre', design: 'x'}]}), /id must be a lowercase id.*design must describe/);
});

test('chromaKey: flat green goes clear, the character stays, spill is pulled', () => {
  const w = 4, h = 1, px = Buffer.from([0, 255, 0, 255, 200, 40, 45, 255, 40, 200, 40, 255, 120, 200, 110, 255]);
  const out = decodePng(chromaKey(encodePng(w, h, px)));
  assert.equal(out.pixels[3], 0, 'pure green is clear');
  assert.equal(out.pixels[7], 255, 'red stays opaque');
  assert.equal(out.pixels[11], 0, 'a green-cast pixel goes clear');
  assert.ok(out.pixels[13] <= Math.max(out.pixels[12], out.pixels[14]) + 8, 'spill pulled from a kept pixel');
});

test('makeSpriteCast: draws through the adapter, cuts out, writes character.json, and resumes', async () => {
  const project = mkdtempSync(path.join(tmpdir(), 'sprite-cast-'));
  writeFileSync(path.join(project, 'cast.sprites.json'), JSON.stringify(castFile));
  const dry = await makeSpriteCast(project, {dryRun: true});
  assert.equal(dry.status, 'planned');
  assert.equal(dry.requests.length, 8);
  const calls = [];
  const green = encodePng(2, 2, Buffer.from(Array(4).fill([0, 255, 0, 255]).flat()));
  const generate = async ({prompt, references}) => { calls.push({prompt, references: references.map(r => r.path)}); return {buffer: green}; };
  const made = await makeSpriteCast(project, {generate});
  assert.equal(made.made.length, 8);
  assert.deepEqual(calls[3].references, ['assets/cast/dre/idle.png']);
  assert.ok(existsSync(path.join(project, 'assets/cast/dre/shocked-blink.png')));
  assert.equal(decodePng(readFileSync(path.join(project, 'assets/cast/dre/idle.png'))).pixels[3], 0, 'keyed');
  const json = JSON.parse(readFileSync(path.join(project, 'assets/cast/dre/character.json'), 'utf8'));
  assert.equal(json.art, 'assets/cast/dre');
  assert.equal(json.pictures.length, 6);
  const again = await makeSpriteCast(project, {generate});
  assert.equal(again.made.length, 0);
  assert.equal(again.kept.length, 8);
});

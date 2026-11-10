// Character kinds (kit/core/characters/kinds.mjs, kind-draw.mjs): animals,
// mascots and objects with faces act on the same rig as people. People keep
// the params, fingerprints and drawings they had; a kind takes its own small
// parameter set and refuses a person's; every kind draws in every style with
// every part id the op list animates; and a person, an animal and an object
// act one scene the same through both renderers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EXPRESSIONS, POSES, normalizeRigParams, poseJoints, rigFingerprint} from '@launchclip/core/characters/rig.mjs';
import {RETIRED_CAST, STARTER_CAST, STARTER_IDS, STARTER_KIND_IDS, characterLook, starterCharacter} from '@launchclip/core/characters/cast.mjs';
import {KINDS, KIND_GROUPS, KIND_NAMES, KIND_SIZES, KIND_STAGE, kindsOf} from '@launchclip/core/characters/kinds.mjs';
import {DRAWING_STYLES, drawCharacter, stageHeight, styleGeometry, styleHeight} from '@launchclip/core/characters/styles.mjs';
import {drawingBounds, partBounds} from '@launchclip/core/characters/bounds.mjs';
import {characterView} from '@launchclip/core/characters/view.mjs';
import {CHARACTER_SETS, PEOPLE_SET_NAMES, generateCast} from '@launchclip/core/characters/generate.mjs';
import {castMember, resolveStoryCast, storyCastErrors} from '@launchclip/core/characters/cues.mjs';
import {applyCharacterSets, characterCastEntry, characterPaths, normalizeCharacter, withSavedCharacters} from '@launchclip/core/characters/character.mjs';
import {describeCharacter} from '@launchclip/core/characters/describe.mjs';
import {mustKeep} from '@launchclip/core/bible.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {resolveModule} from '@launchclip/core/modules.mjs';
import {charactersTimeline, charactersView} from '@launchclip/core/catalog-characters.mjs';
import {castGate} from '../src/cast.js';
import {resolveStory} from '@launchclip/core/story.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
const ids = node => (node && typeof node === 'object' ? [...(node.id ? [node.id] : []), ...(node.children ?? []).flatMap(ids)] : []);

test('people are untouched: every starter person keeps its look in every style, and people sets generate the casts they did', () => {
  const people = [...STARTER_CAST, ...RETIRED_CAST].filter(entry => !entry.params.kind);
  assert.equal(people.length, 72);
  // Measured on main before kinds existed: params, style and colours of every person, in every style.
  assert.equal(sha(people.map(entry => DRAWING_STYLES.map(style => characterLook(starterCharacter(entry.id).params, {style}).look))), '330a5276ad3bff9d');
  assert.equal(sha(PEOPLE_SET_NAMES.map(set => [1, 3, 6, 12].map(count => generateCast({seed: '7f3a91c2', set, count})))), '1b172f5c6da1b047');
  for (const entry of people) assert.ok(!('kind' in starterCharacter(entry.id).params), `${entry.id}: a person stores no kind`);
  const params = {skin: 'brown', hair: {style: 'curly'}};
  assert.deepEqual(normalizeRigParams({...params, kind: 'person'}), normalizeRigParams(params), 'kind: person is the default and is not stored');
  assert.equal(rigFingerprint(normalizeRigParams({...params, kind: 'person'})), rigFingerprint(normalizeRigParams(params)));
});

test('a kind takes kind, size and three colours, in a fixed shape, and refuses a person\'s params by name', () => {
  assert.equal(KIND_NAMES.length, 20);
  assert.deepEqual(KIND_GROUPS.map(group => kindsOf(group).length), [8, 4, 8]);
  for (const kind of KIND_NAMES) {
    const params = normalizeRigParams({kind});
    assert.deepEqual(Object.keys(params), ['kind', 'colors'], `${kind}: medium is not stored`);
    assert.deepEqual(params.colors, KINDS[kind].colors, `${kind}: its own colours`);
    assert.deepEqual(Object.keys(KINDS[kind].slots), ['body', 'detail', 'accent']);
    assert.ok(KINDS[kind].describe);
  }
  assert.deepEqual(normalizeRigParams({colors: {accent: 'red'}, size: 'large', kind: 'cat'}), {kind: 'cat', size: 'large', colors: {body: KINDS.cat.colors.body, detail: KINDS.cat.colors.detail, accent: 'red'}});
  assert.equal(rigFingerprint(normalizeRigParams({kind: 'cat', size: 'medium'})), rigFingerprint(normalizeRigParams({kind: 'cat'})));
  assert.throws(() => normalizeRigParams({kind: 'cup', hair: {style: 'bob'}}), /\.hair does not apply to a cup \(a cup takes kind, size and colors \{body, detail, accent\}\)/);
  for (const key of ['skin', 'outfit', 'build', 'height', 'age', 'accessories', 'headwear', 'mobility']) assert.throws(() => normalizeRigParams({kind: 'owl', [key]: 'x'}), new RegExp(`\\.${key} does not apply to an owl`));
  assert.throws(() => normalizeRigParams({kind: 'cup', colors: {top: 'red'}}), /colors\.top is not a colour slot of a cup \(allowed: body, detail, accent\)/);
  assert.throws(() => normalizeRigParams({kind: 'cup', colors: {body: 'sparkly'}}), /colors\.body must be a palette colour/);
  assert.throws(() => normalizeRigParams({kind: 'cup', size: 'huge'}), /size must be one of small, medium, large/);
  assert.throws(() => normalizeRigParams({kind: 'dragon'}), /kind must be person or one of cat, dog/);
  // A person still refuses a kind's fields.
  assert.throws(() => normalizeRigParams({skin: 'tan', hair: {style: 'bob'}, size: 'small'}), /size is not a rig param/);
});

test('the starter cast has about two dozen animals, mascots and objects: every kind, a personality and a voice each, no id shared with a generated name', () => {
  assert.equal(STARTER_KIND_IDS.length, 24);
  const kinds = STARTER_KIND_IDS.map(id => starterCharacter(id).params.kind);
  assert.deepEqual([...new Set(kinds)].sort(), [...KIND_NAMES].sort(), 'every kind has a starter');
  assert.equal(STARTER_IDS.indexOf(STARTER_KIND_IDS[0]), STARTER_IDS.length - 24, 'they come after the people, so earlier ids keep their places');
  const generated = new Set(Object.keys(CHARACTER_SETS).flatMap(set => [1, 2, 3].flatMap(k => generateCast({seed: `s${k}`, set, count: 12}).map(member => member.id))));
  for (const id of STARTER_KIND_IDS) {
    const entry = STARTER_CAST.find(one => one.id === id);
    assert.match(entry.summary, /; /, `${id}: what it is; its personality`);
    assert.match(entry.voice, /^[ab][fm]_/);
    assert.ok(!generated.has(id), `${id} is not a generated name`);
  }
});

test('every kind draws in every style, size and pose: finite, feet on the floor, as tall as it says, the same every time', () => {
  for (const kind of KIND_NAMES) for (const size of KIND_SIZES) {
    const params = normalizeRigParams({kind, size});
    for (const style of DRAWING_STYLES) {
      const {colors} = characterLook(params, {style});
      const geometry = styleGeometry(style, params);
      assert.equal(styleHeight(style, params), styleHeight('flat', params), 'one body in every style');
      for (const pose of POSES) for (const isStatic of [false, true]) {
        const options = {id: 'c', joints: poseJoints(pose, {geometry, seated: pose === 'sit'}), expression: 'happy', expressions: isStatic ? ['happy'] : EXPRESSIONS, static: isStatic, gaze: !isStatic, turns: !isStatic};
        const drawing = drawCharacter(style, params, colors, options);
        const box = drawingBounds(drawing);
        for (const value of Object.values(box)) assert.ok(Number.isFinite(value), `${kind} ${style} ${pose}`);
        if (pose === 'stand') {
          assert.ok(box.bottom > -4 && box.bottom < 40, `${kind} ${size} ${style}: feet on the floor (${box.bottom})`);
          assert.ok(Math.abs(-box.top - styleHeight(style, params)) < 80, `${kind} ${size} ${style}: ${-box.top} tall, says ${styleHeight(style, params)}`);
        }
        if (pose === 'wave' && style === 'chibi') assert.equal(JSON.stringify(drawCharacter(style, params, colors, options)), JSON.stringify(drawing), 'deterministic');
      }
    }
  }
  // Sizes scale the drawing; medium is the kind's own measurements.
  for (const kind of KIND_NAMES) {
    const [small, medium, large] = KIND_SIZES.map(size => styleHeight('flat', normalizeRigParams({kind, size})));
    assert.ok(small < medium && medium < large, kind);
    assert.ok(medium > 520 && medium < 900, `${kind}: ${medium} rig units, beside a person of about 1000`);
  }
});

test('a kind has every part id the op list animates, as divs the renderers transform, with a face per expression', () => {
  for (const kind of KIND_NAMES) for (const style of ['chibi', 'line', 'soft-shade']) {
    const params = normalizeRigParams({kind});
    const {colors} = characterLook(params, {style});
    const view = characterView(drawCharacter(style, params, colors, {id: 'c', joints: {...poseJoints('point', {geometry: styleGeometry(style, params)}), gazeX: 20, gazeY: 0, gazeScale: 1}, expression: 'neutral', expressions: EXPRESSIONS, gaze: true, turns: true}), {id: 'c', x: 0, y: 0, scale: 1});
    const found = new Set(ids(view));
    const wanted = ['body', 'torso', 'breath', 'head', 'hb', 'headidle', 'hbidle', 'arm-l', 'arm-r', 'fore-l', 'fore-r', 'finger-l', 'finger-r', 'fingerwrap-l', 'fingerwrap-r', 'leg-l', 'leg-r', 'shin-l', 'shin-r', 'turn', 'gaze', 'back', 'front', 'face-front',
      ...EXPRESSIONS.flatMap(name => [`face-${name}`, `eyes-${name}`, `mouth-${name}`, `open-${name}`])];
    for (const part of wanted) assert.ok(found.has(`c-${part}`), `${kind} ${style}: c-${part}`);
    assert.equal(found.size, new Set([...found]).size);
    // An open mouth is a pivot div at the mouth's centre, so speech shapes it (view.mjs), as a person's.
    const open = [];
    const walk = (node, parent) => { if (node && typeof node === 'object') { if (/^c-open-/.test(node.id ?? '')) open.push({node, parent}); (node.children ?? []).forEach(child => walk(child, node)); } };
    walk(view, null);
    for (const {node, parent} of open) assert.ok(node.tag === 'div' && node.style.transformOrigin === '0px 0px' && parent.style.top !== 0, `${kind} ${style}: the open mouth pivots at its centre`);
  }
});

test('a size scales shapes and pivots but not joint values, so one op list moves every size alike', () => {
  const joints = poseJoints('cheer', {geometry: styleGeometry('chibi', normalizeRigParams({kind: 'bear'}))});
  const draw = size => { const params = normalizeRigParams({kind: 'bear', size}); return drawCharacter('chibi', params, characterLook(params, {}).colors, {id: 'c', joints, expression: 'neutral'}); };
  const jointsOf = node => (node && typeof node === 'object' ? [...(node.tag === 'joint' ? [node] : []), ...(node.children ?? []).flatMap(jointsOf)] : []);
  const medium = jointsOf(draw('medium')), large = jointsOf(draw('large'));
  assert.equal(medium.length, large.length);
  medium.forEach((joint, i) => {
    // (The eyes' joints sit inside the face, which is resized as one piece.)
    if (/-eyes-/.test(joint.id ?? '')) return;
    assert.deepEqual(large[i].transform, joint.transform, `${joint.id}: the same joint values`);
    assert.ok(Math.abs(large[i].pivot.y - joint.pivot.y * 1.14) < 0.11, `${joint.id}: the pivot scales`);
  });
});

test('a dark face takes light ink, and line art keeps its ink', () => {
  const eyes = (style, colors) => {
    const params = normalizeRigParams({kind: 'cat', colors});
    const drawing = drawCharacter(style, params, characterLook(params, {style}).colors, {id: 'c', joints: poseJoints('stand', {geometry: styleGeometry(style, params)}), expression: 'neutral'});
    const fills = [];
    const walk = (node, inEyes) => { if (!node || typeof node !== 'object') return; const here = inEyes || /^c-eyes-/.test(node.id ?? ''); if (here && node.tag === 'ellipse') fills.push(node.attrs.fill); (node.children ?? []).forEach(child => walk(child, here)); };
    walk(drawing, false);
    return fills[0];
  };
  assert.equal(eyes('chibi', {}), '#231e28');
  assert.equal(eyes('chibi', {body: '#2b2a33'}), '#fbf7ef', 'a black cat\'s eyes are light');
  assert.equal(eyes('line', {body: '#2b2a33'}), '#221d27', 'line art draws paper and ink');
});

test('a set sizes a kind as a person or further back: never blown up, and wide kinds fit a slot', () => {
  for (const id of STARTER_KIND_IDS) {
    const {params} = starterCharacter(id);
    const stage = stageHeight('flat', params), tight = stageHeight('flat', params, {tight: true});
    assert.equal(stage, Math.max(KIND_STAGE.height, styleHeight('flat', params)), `${id}: never blown up to a person's height`);
    assert.ok(stageHeight('chibi', params) >= 780 && stageHeight('chibi', params) <= stage, `${id}: beside a chibi person it stands as a chibi person does`);
    assert.ok(tight >= stage && tight < 1900, `${id}: ${tight} in a narrow slot`);
  }
  assert.equal(stageHeight('flat', starterCharacter('maya').params), styleHeight('flat', starterCharacter('maya').params), 'a person stands as before');
  assert.ok(stageHeight('flat', starterCharacter('byte').params, {tight: true}) > stageHeight('flat', starterCharacter('clover').params, {tight: true}), 'an open laptop is wider than a rabbit');
});

test('story casts: a starter by id, a new one by kind, overrides, and clear refusals', () => {
  const resolved = resolveStoryCast({brand: {colors: {primary: '#10b981', accent: '#f97316'}}, cast: {style: 'chibi', characters: [{id: 'mochi'}, {id: 'boss', from: 'rivet', size: 'large', colors: {accent: 'red'}}, {id: 'mug', name: 'Mug', voice: 'af_sky', kind: 'cup'}, {id: 'bloop'}, {id: 'maya'}]}});
  assert.deepEqual(castMember(resolved, 'mochi').params, starterCharacter('mochi').params);
  assert.deepEqual(castMember(resolved, 'boss').params, {kind: 'robot', size: 'large', colors: {...KINDS.robot.colors, accent: 'red'}});
  assert.equal(castMember(resolved, 'boss').name, 'Rivet');
  assert.equal(castMember(resolved, 'mug').params.kind, 'cup');
  assert.equal(castMember(resolved, 'bloop').colors.body, '#10b981', 'a mascot wears the brand\'s colour');
  assert.ok(Object.values(castMember(resolved, 'mochi').colors).every(value => /^#[0-9a-f]{6}$/i.test(value)), 'every colour is a hex (worlds grade them)');
  assert.notEqual(castMember(resolved, 'mochi').fingerprint, castMember(resolved, 'boss').fingerprint);
  const errors = entry => storyCastErrors({characters: [entry]}).join('; ');
  assert.match(errors({id: 'x', from: 'maya', kind: 'cat'}), /kind cat cannot start from maya, which is a person/);
  assert.match(errors({id: 'x', from: 'mochi', kind: 'person', skin: 'tan', hair: {style: 'bob'}}), /kind person cannot start from mochi, which is a cat/);
  assert.match(errors({id: 'x', from: 'mochi', hair: {style: 'bob'}}), /hair does not apply to a cat/);
  assert.match(errors({id: 'x', kind: 'coin', outfit: {top: 'tee'}}), /outfit does not apply to a coin/);
  assert.match(errors({id: 'x', kind: 'coin', colors: 'gold'}), /colors must be an object/);
  assert.equal(errors({id: 'x', kind: 'person', skin: 'tan', hair: {style: 'bob'}}), '');
});

test('saved characters: a kind validates, stores its three colours, edits by set path and fills a story entry', () => {
  const file = normalizeCharacter({schema: 'launchclip.character.v1', id: 'whiskers', name: 'Whiskers', personality: 'naps on the keyboard', style: 'chibi', voice: 'af_sky', params: {kind: 'cat', colors: {body: 'tangerine'}}});
  assert.deepEqual(file.params, {kind: 'cat', colors: {body: 'tangerine', detail: KINDS.cat.colors.detail, accent: KINDS.cat.colors.accent}});
  assert.deepEqual(characterCastEntry(file), {id: 'whiskers', name: 'Whiskers', voice: 'af_sky', ...file.params});
  const edited = normalizeCharacter(applyCharacterSets(file, [{path: 'size', op: '=', value: 'small'}, {path: 'colors.detail', op: '=', value: 'white'}]));
  assert.deepEqual([edited.params.size, edited.params.colors.detail], ['small', 'white']);
  assert.throws(() => normalizeCharacter(applyCharacterSets(file, [{path: 'hair.style', op: '=', value: 'bob'}])), /hair does not apply to a cat/);
  assert.throws(() => normalizeCharacter(applyCharacterSets(file, [{path: 'kind', op: '=', value: 'person'}])), /colors\.body is not a colour slot|skin/);
  const paths = characterPaths();
  assert.deepEqual(paths.kind.values, ['person', ...KIND_NAMES]);
  assert.deepEqual(paths.size.values, [...KIND_SIZES]);
  assert.ok(paths['colors.body'].hex && paths['colors.detail'].hex);
  const {story, used} = withSavedCharacters({cast: {characters: [{id: 'whiskers'}, {id: 'tiny', from: 'whiskers', size: 'small'}, {id: 'maya'}]}}, id => (id === 'whiskers' ? file : null));
  assert.deepEqual(used, [{id: 'whiskers', from: 'whiskers'}, {id: 'tiny', from: 'whiskers'}]);
  assert.deepEqual(storyCastErrors(story.cast), []);
  assert.equal(castMember(resolveStoryCast(story), 'tiny').params.size, 'small');
  assert.ok(!('hair' in story.cast.characters[0]) && !('outfit' in story.cast.characters[0]));
  // An entry that states its own kind needs no saved file.
  assert.deepEqual(withSavedCharacters({cast: {characters: [{id: 'zed', kind: 'coin'}]}}, () => { throw new Error('not asked'); }).used, []);
});

test('a description names a kind, its colour and its size; a person\'s traits on a kind are reported, not applied', () => {
  const sets = text => describeCharacter(text).sets.map(set => `${set.path}${set.op}${set.value}`);
  assert.deepEqual(sets('a small orange cat'), ['size=small', 'kind=cat', 'colors.body=tangerine']);
  assert.deepEqual(sets('a coffee cup'), ['kind=cup']);
  assert.deepEqual(sets('a friendly little robot'), ['size=small', 'kind=robot']);
  const blob = describeCharacter('a big blue blob with glasses and a hoodie');
  assert.deepEqual(blob.sets.map(set => `${set.path}=${set.value}`), ['size=large', 'kind=blob', 'colors.body=denim']);
  assert.deepEqual(blob.unmatched, ['glasses', 'hoodie']);
  assert.deepEqual(sets('a tall woman with silver locs'), ['height=tall', 'hair.style=locs', 'hair.color=silver'], 'people read as before');
  assert.deepEqual(mustKeep({kind: 'cat', size: 'small', colors: {body: 'tangerine'}}), ['tangerine cat', 'small size']);
  assert.deepEqual(mustKeep({kind: 'blob', colors: {body: 'primary'}}), ['blob in the brand\'s primary colour']);
});

test('generated casts: sets of animals, mascots and objects, a mixed set, and seeds that still choose people', async () => {
  const {SEED_CHARACTER_SETS} = await import('@launchclip/core/style-seed.mjs');
  assert.deepEqual(SEED_CHARACTER_SETS.map(([name]) => name), [...PEOPLE_SET_NAMES], 'a seed never picks a kinds set on its own');
  for (const [set, group] of [['animal-friends', 'animal'], ['mascots', 'mascot'], ['everyday-objects', 'object']]) {
    const cast = generateCast({seed: '7f3a91c2', set, count: 8});
    assert.deepEqual(cast, generateCast({seed: '7f3a91c2', set, count: 8}));
    assert.ok(cast.every(member => KINDS[member.kind].group === group && member.voice && member.name), set);
    assert.equal(new Set(cast.map(member => member.kind)).size, Math.min(8, kindsOf(group).length), `${set}: every kind before a repeat`);
    assert.equal(new Set(cast.map(member => member.id)).size, 8);
    assert.deepEqual(storyCastErrors({characters: cast}), []);
    assert.equal(generateCast({seed: 'z', set, count: 12}).length, 12);
  }
  const mixed = generateCast({seed: '7f3a91c2', set: 'mixed-company', count: 6});
  assert.deepEqual(mixed.map(member => Boolean(member.kind)), [false, true, false, true, false, true]);
  assert.deepEqual(storyCastErrors({characters: mixed}), []);
  const voices = new Set(mixed.filter(member => !member.kind).map(member => member.voice[1]));
  assert.ok(voices.has('f') && voices.has('m'), 'its people are still a woman and a man first');
});

const BRAND = {colors: {bg: '#06070d', primary: '#3d6fd8', accent: '#f0a531', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const MIXED_SCENE = {id: 'trio', module: 'cast-scene', start: 0, end: 7, params: {set: 'standing', shot: 'wide', cast: [
  {id: 'maya', cues: [{at: 1.5, pose: 'point', target: {character: 'mochi'}}, {at: 4, pose: 'cheer', expression: 'delighted'}]},
  {id: 'mochi', says: [{from: 0.5, to: 2.4, words: [[0.5, 0.9, 'Try'], [0.95, 1.6, 'Pulseboard'], [1.9, 2.4, 'now']]}], cues: [{at: 2.6, pose: 'wave', expression: 'happy'}, {at: 4.4, action: 'look-far', expression: 'surprised'}]},
  {id: 'ping', target: {character: 'mochi'}, cues: [{at: 1, pose: 'think', expression: 'confused'}, {at: 3.2, pose: 'arms-crossed', expression: 'frustrated'}, {at: 5, pose: 'point-self', expression: 'happy'}]}]}};

test('a person, an animal and an object act one scene: the gate passes, and GSAP reads it as frameState does, seeking in any order', async () => {
  const {default: gsap} = await import('gsap');
  const {runInNewContext} = await import('node:vm');
  const {EMITTERS} = await import('../kit/hyperframes/catalog-characters.mjs');
  for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
    const story = {schema: 'launchclip.story.v1', lane: 'motion', format: {width, height, fps: 30, duration: 8}, brand: BRAND, cast: {style: 'chibi', characters: [{id: 'maya'}, {id: 'mochi', acting: 'bouncy'}, {id: 'ping', acting: 'nervous'}]}, scenes: [MIXED_SCENE]};
    assert.deepEqual(castGate(resolveStory(story, {words: []})).findings, [], `${width}x${height}: the cast gate`);
    const model = resolveModule(MIXED_SCENE, story);
    assert.deepEqual(model.content.actors.map(actor => actor.params.kind ?? 'person'), ['person', 'cat', 'phone']);
    const ops = charactersTimeline(model);
    // Every op moves a part the view draws.
    const drawn = new Set(Object.values(charactersView(model)).flatMap(ids));
    const missing = [...new Set(ops.map(op => op.target))].filter(target => !drawn.has(target));
    assert.deepEqual(missing, [], 'every animated part is drawn');
    const {motion} = EMITTERS['cast-scene'](model);
    assert.doesNotMatch(motion, /onUpdate|Math\.random|Date/);
    const objects = new Map();
    const real = gsap.timeline({paused: true});
    const target = selector => { if (!objects.has(selector)) objects.set(selector, {}); return objects.get(selector); };
    runInNewContext(motion, {tl: {set: (s, v, p) => real.set(target(s), v, p), fromTo: (s, f, t, p) => real.fromTo(target(s), f, t, p)}});
    let checked = 0;
    for (const t of [0.3, 0.62, 1.2, 1.56, 1.7, 2.7, 3.3, 4.5, 5.2, 6.9, 5.0, 1.62, 0.97, 0.05]) {
      real.seek(t, false);
      for (const [id, props] of frameState(ops, t)) {
        const object = objects.get(`#${id}`);
        for (const [key, want] of Object.entries(props)) {
          if (object?.[key] === undefined) continue;
          assert.ok(Math.abs(object[key] - want) < 1e-3, `${id}.${key} at ${t}: gsap ${object[key]} vs frameState ${want}`);
          checked++;
        }
      }
    }
    assert.ok(checked > 1500, `${checked} values compared`);
    // The cat turned its back to look far: its face is hidden and nothing else stands in for it.
    const cat = `${model.id}-c1`;
    assert.equal(frameState(ops, 6.5).get(`${cat}-face-front`)?.opacity, 0);
  }
});

test('the face of a kind stays on its head or body at rest and in every pose\'s head tilt', () => {
  for (const id of STARTER_KIND_IDS) {
    const {params} = starterCharacter(id);
    const {colors} = characterLook(params, {style: 'chibi'});
    const geometry = styleGeometry('chibi', params);
    for (const pose of POSES) {
      const drawing = drawCharacter('chibi', params, colors, {id: 'c', joints: poseJoints(pose, {geometry, seated: pose === 'sit'}), expression: 'neutral', expressions: EXPRESSIONS});
      const whole = drawingBounds(drawing);
      const face = partBounds(drawing, node => /^c-face-/.test(node.id ?? ''), {hidden: true});
      assert.ok(face.left > whole.left && face.right < whole.right && face.top > whole.top && face.bottom < whole.bottom, `${id} ${pose}: the face is inside the drawing`);
    }
  }
});

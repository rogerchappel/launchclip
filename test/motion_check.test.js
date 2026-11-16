// The motion check (docs/DIRECTION_GUARDRAILS.md §8): eases, cascades, exits,
// crowding and rests, decided from the grammar and the timeline ops.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {resolveStory} from '@launchclip/core/story.mjs';
import {GRAMMARS, GRAMMAR_NAMES, resolveGrammar} from '@launchclip/core/grammar.mjs';
import {FEEL_NAMES} from '@launchclip/core/feel.mjs';
import {STATE_BLOOM} from '@launchclip/core/shot-states.mjs';
import {MOTION_CHECK, grammarMotionFindings, halfTravel, sceneMotionFindings} from '@launchclip/core/motion-check.mjs';
import {choreographyGate, modelOps} from '../src/movement_guardrails.js';
import {renderedModels} from '../src/direction_guardrails.js';
import {idleOps, shakeOps} from '@launchclip/core/fluid-motion.mjs';

const tween = (target, start, duration, ease, from, to) => ({type: 'tween', target, start, duration, ease, from, to});
const fadeIn = (target, start, duration = 0.4, ease = 'power3.out') => tween(target, start, duration, ease, {opacity: 0, y: 18}, {opacity: 1, y: 0});
const fadeOut = (target, start, duration = 0.3, ease = 'power2.in') => tween(target, start, duration, ease, {opacity: 1, y: 0}, {opacity: 0, y: -18});
const motion = {enterStart: 0, enterEnd: 0.5, exitStart: 9.6, enterDuration: 0.5, exitDuration: 0.35, enterEase: 'power3.out', exitEase: 'power2.in', enterFrom: {opacity: 1, x: 0, y: 40, scale: 0.97}, exitTo: {opacity: 0, x: 0, y: -28, scale: 1}};
const rules = (findings) => findings.map(f => f.rule);
// The rules before static-hold see only what they test; static-hold's own tests pass the real check.
const scene = (ops, extra = {}) => sceneMotionFindings({id: 'card', motion, ops, check: {...MOTION_CHECK, hold: Infinity}, ...extra});
const held = (ops, extra = {}) => scene(ops, {check: MOTION_CHECK, ...extra});

test('a well-moved scene has no findings', () => {
  const ops = [
    ...[0, 1, 2, 3, 4, 5].map(i => fadeIn(`card-row-${i}`, 0.2 + i * 0.08)),
    // A flash: lands in two frames, blooms out on an out ease, gone within a second.
    tween('card-ring', 3, 0.05, 'none', {opacity: 0}, {opacity: 0.8}),
    tween('card-ring', 3.05, 0.5, 'power2.out', {opacity: 0.8, scaleX: 1}, {opacity: 0, scaleX: 1.4}),
    // A slam accelerates into place on purpose.
    tween('card-stamp', 4, 0.08, 'power1.in', {opacity: 0}, {opacity: 1}),
    tween('card-stamp', 4, 0.2, 'power4.in', {scaleX: 2.6, scaleY: 2.6}, {scaleX: 1, scaleY: 1}),
    // Continuous motion may be linear.
    tween('card-ticker', 1, 6, 'none', {x: 0}, {x: -400}),
    tween('card-bar', 1, 1, 'none', {scaleX: 0}, {scaleX: 1}),
    fadeOut('card-row-0', 9)
  ];
  assert.deepEqual(scene(ops, {states: [3, 5, 7.5]}), []);
});

test('an entrance that speeds up, an exit that lingers and a linear move are errors', () => {
  const found = scene([fadeIn('card-a', 1, 0.4, 'power2.in'), fadeOut('card-b', 5, 0.3, 'power2.out'), tween('card-c', 2, 0.5, 'none', {x: 0}, {x: 200})]);
  assert.deepEqual(rules(found).sort(), ['entrance-ease', 'exit-ease', 'linear-move']);
  assert.ok(found.every(f => f.severity === 'error' && f.ids.includes('card')));
  assert.match(found.find(f => f.rule === 'entrance-ease').detail, /card-a arrives on "power2\.in".*power3\.out/);
  // The scene's own entrance and exit, from its timing alone (a module with no op list).
  assert.deepEqual(rules(sceneMotionFindings({id: 'card', motion: {...motion, enterEase: 'none', exitEase: 'back.out(1.7)'}})), ['linear-move', 'exit-ease']);
});

test('an exit over twice its entrance is an error, on the scene and on an element', () => {
  assert.deepEqual(rules(sceneMotionFindings({id: 'card', motion: {...motion, exitDuration: 1.2}})), ['exit-longer']);
  assert.deepEqual(rules(scene([fadeIn('card-a', 1, 0.3), fadeOut('card-a', 6, 0.6)])), [], 'twice is the shipped ceiling');
  const found = scene([fadeIn('card-a', 1, 0.3), fadeOut('card-a', 6, 0.9)]);
  assert.deepEqual(rules(found), ['exit-longer']);
  assert.match(found[0].detail, /card-a takes 0\.9 s to leave and 0\.3 s to arrive/);
});

test('a cascade over the budget is an error; steps timed apart are not a cascade', () => {
  const cascade = (each, count) => Array.from({length: count}, (_, i) => fadeIn(`card-row-${i}`, 1 + i * each));
  assert.deepEqual(scene(cascade(0.12, 16)), [], 'sixteen lines over 1.8 s, the longest a shipped module allows');
  const found = scene(cascade(0.2, 16));
  assert.deepEqual(rules(found), ['long-stagger']);
  assert.match(found[0].detail, /16 elements of card arrive one after another over 3 s/);
  assert.deepEqual(scene(cascade(0.45, 12)), [], 'each step has finished before the next starts');
});

test('most of a settled scene moving at once warns; the entrance is not counted', () => {
  const rows = [0, 1, 2, 3, 4, 5, 6, 7];
  const enter = rows.map(i => fadeIn(`card-row-${i}`, 0.1));
  const shift = (count) => rows.slice(0, count).map(i => tween(`card-row-${i}`, 4, 0.6, 'expo.out', {x: 0}, {x: 40}));
  assert.deepEqual(scene([...enter, ...shift(5)]), []);
  const found = scene([...enter, ...shift(7)]);
  assert.deepEqual(found.map(f => [f.rule, f.severity, f.at]), [['crowded-move', 'warning', 4]]);
  assert.match(found[0].detail, /7 of card's 8 elements move at once/);
});

test('two states with no still moment between them warn', () => {
  const found = scene([], {states: [3, 3.7, 6]});
  assert.deepEqual(found.map(f => [f.rule, f.severity, f.at]), [['no-rest', 'warning', 3.7]]);
  assert.equal(MOTION_CHECK.beatRest, Math.round((STATE_BLOOM.rise + STATE_BLOOM.decay + GRAMMARS.editorial.duration.enter) * 100) / 100);
});

test('every preset grammar passes, alone and under every feel; a faulty custom grammar fails with the fix', () => {
  for (const grammar of GRAMMAR_NAMES) for (const feel of [undefined, ...FEEL_NAMES]) {
    assert.deepEqual(grammarMotionFindings(resolveGrammar({motion: {grammar, ...(feel ? {feel} : {})}})), [], `${grammar} / ${feel}`);
  }
  const found = grammarMotionFindings(resolveGrammar({motion: {grammar: {ease: {enter: 'power2.in', exit: 'power2.out', move: 'none'}, duration: {enter: 0.2, exit: 0.5}}}}));
  assert.deepEqual(rules(found).sort(), ['entrance-ease', 'exit-ease', 'exit-longer', 'linear-move']);
  assert.match(found.find(f => f.rule === 'exit-longer').detail, /duration\.exit \(0\.5 s\) is longer than duration\.enter \(0\.2 s\)/);
});

const examples = readdirSync('examples/story').filter(name => existsSync(`examples/story/${name}/storyboard.json`));
const example = (name, change = raw => raw) => {
  const narrationFile = `examples/story/${name}/NARRATION.json`;
  const narration = existsSync(narrationFile) ? JSON.parse(readFileSync(narrationFile, 'utf8')) : [];
  return resolveStory(change(JSON.parse(readFileSync(`examples/story/${name}/storyboard.json`, 'utf8'))), {words: Array.isArray(narration) ? narration : narration.words ?? []});
};

// late-beat stays a warning until the compiler starts moves early by their
// half-travel time (docs/PLAN_AND_PACE_RFC.md §2); every state move lands late today.
// static-hold warns until the other catalogue modules carry idle motion
// (docs/FLUID_MOTION_RFC.md §11, phase 5); node-graph already passes it.
const settled = (findings) => findings.filter(f => f.rule !== 'late-beat' && f.rule !== 'static-hold');

test('the example stories pass the gate with no findings', () => {
  assert.ok(examples.length > 30);
  for (const name of examples) {
    const gate = choreographyGate(example(name));
    assert.equal(gate.status, 'passed', `${name}: ${JSON.stringify(gate.findings)}`);
    assert.deepEqual(settled(gate.findings), [], name);
  }
});

test('a move that starts on its beat lands late; one started early by its half-travel time does not', () => {
  // GSAP's power3 is a quartic: half the travel at 1 − 0.5^(1/4) of the duration.
  assert.equal(halfTravel('power3.out'), 0.159);
  assert.equal(halfTravel('power2.inOut'), 0.5);
  assert.equal(halfTravel('expo.out'), 0.101);
  const move = (start) => tween('card-mark', start, 0.6, 'power3.out', {y: 30}, {y: 0});
  const late = scene([move(4)], {states: [4]});
  assert.deepEqual(rules(late), ['late-beat']);
  assert.match(late[0].detail, /1 move in card starts on its beat and reaches half its travel up to 2\.9 frames after it/);
  assert.equal(late[0].severity, 'warning');
  assert.deepEqual(rules(scene([move(4 - 0.6 * halfTravel('power3.out'))], {states: [4]})), []);
  assert.deepEqual(rules(scene([move(4)], {hits: [4]})), ['late-beat'], 'a hit is a beat too');
  // A quick snap lands within a frame.
  assert.deepEqual(rules(scene([tween('card-mark', 4, 0.15, 'power3.out', {y: 30}, {y: 0})], {states: [4]})), []);
});

test('the gate fails a story whose grammar reverses its entrance ease, and names the scenes', () => {
  const reversed = choreographyGate(example('minimal', raw => ({...raw, motion: {...raw.motion, grammar: {ease: {enter: 'power3.in'}}}})));
  assert.equal(reversed.status, 'failed');
  assert.ok(reversed.findings.some(f => f.rule === 'entrance-ease' && f.ids.length === 0), JSON.stringify(reversed.findings));
  assert.ok(reversed.findings.some(f => f.rule === 'entrance-ease' && f.ids.length > 0), 'and the scenes that arrive on it are named');
  // The largest stagger a grammar may set stays inside the budget: modules clamp their own cascades.
  assert.deepEqual(settled(choreographyGate(example('explainer-9x16', raw => ({...raw, motion: {...raw.motion, grammar: {stagger: 3}}}))).findings), []);
});

test('an element that flashes on every beat is a flash, not a slow exit', () => {
  const flash = at => [
    {type: 'tween', target: 'card-lit', start: at, duration: 0.12, ease: 'power1.out', from: {opacity: 0}, to: {opacity: 1}},
    {type: 'tween', target: 'card-lit', start: at + 0.12, duration: 0.5, ease: 'power2.out', from: {opacity: 1}, to: {opacity: 0}}
  ];
  assert.deepEqual(rules(scene([...flash(1), ...flash(3), ...flash(5)])), []);
  // One fade in and a slow fade out much later is still a slow exit.
  assert.deepEqual(rules(scene([flash(1)[0], {type: 'tween', target: 'card-lit', start: 4, duration: 0.5, ease: 'power2.in', from: {opacity: 1}, to: {opacity: 0}}])), ['exit-longer']);
});

test('a settled scene that stops moving warns; an idle breath or a camera push keeps it alive', () => {
  const enter = [0, 1, 2].map(i => fadeIn(`card-row-${i}`, 0.1));
  const found = held([...enter, tween('card-row-0', 4, 0.5, 'power3.out', {x: 0}, {x: 20})]);
  assert.deepEqual(found.map(f => [f.rule, f.severity, f.at]), [['static-hold', 'warning', 4.5]]);
  assert.match(found[0].detail, /card holds still for 5\.1 s \(4\.5–9\.6 s\)/);
  const idle = [];
  idleOps(idle, 'card-row-0-idle', 0, 0.6, 9.6, {bob: 10, tilt: 1.8});
  assert.deepEqual(held([...enter, ...idle]), []);
  assert.deepEqual(held([...enter, tween('card-cam', 0.5, 9, 'power1.inOut', {scaleX: 1}, {scaleX: 1.05})]), []);
  // States land on the gaps: no stretch is over 1.5 s.
  assert.deepEqual(held(enter, {states: [1.8, 3.2, 4.6, 6, 7.4, 8.8]}), []);
  // A short scene, or one with no op list, is not measured.
  assert.deepEqual(sceneMotionFindings({id: 'card', motion: {...motion, exitStart: 2.2}, ops: enter}), []);
  assert.deepEqual(sceneMotionFindings({id: 'card', motion}), []);
});

test('an idle wrapper is not an element of its own for crowding', () => {
  const rows = [0, 1, 2, 3, 4, 5];
  const ops = [...rows.map(i => fadeIn(`card-row-${i}`, 0.1)), ...rows.slice(0, 4).map(i => tween(`card-row-${i}`, 4, 0.6, 'expo.out', {x: 0}, {x: 40}))];
  for (const i of rows) idleOps(ops, `card-row-${i}-idle`, 0, 0.6, 9.6, {bob: 10, tilt: 1.8});
  // Twelve targets, four moving, would pass on a third; six elements, four moving, is the real two thirds.
  assert.deepEqual(scene(ops), []);
  ops.push(tween('card-row-4', 4, 0.6, 'expo.out', {x: 0}, {x: 40}));
  assert.deepEqual(rules(scene(ops)), ['crowded-move'], 'five of six elements; the breaths are not counted');
});

test('an impact shake decays inside its window; one that grows, does not settle or runs long is an error', () => {
  const shake = (steps, each = 0.06) => steps.map(([x, y], i) => tween('card-cam', 3 + i * each, each, 'power1.inOut', i ? {x: steps[i - 1][0], y: steps[i - 1][1]} : {x: 0, y: 0}, {x, y}));
  const enter = [fadeIn('card-a', 0.1), tween('card-cam', 0.5, 9, 'power1.inOut', {scaleX: 1}, {scaleX: 1.05})];
  const good = [];
  shakeOps(good, 'card-cam', 3, 14);
  assert.deepEqual(scene([...enter, ...good]), [], 'shakeOps passes');
  const grows = scene([...enter, ...shake([[10, -6], [-12, 8], [3, -2], [0, 0]])]);
  assert.deepEqual(grows.map(f => [f.rule, f.severity, f.at]), [['shake-overshoot', 'error', 3]]);
  assert.match(grows[0].detail, /card-cam shakes in 4 steps and step 2 lands 14\.4 px from rest, further than step 1 \(11\.7 px\)/);
  assert.match(scene([...enter, ...shake([[10, -6], [-5, 3], [3, -2]])])[0].detail, /ends 3\.6 px from rest/);
  assert.match(scene([...enter, ...shake([[10, -6], [-5, 3], [3, -2], [-1, 1], [0, 0]], 0.08)])[0].detail, /runs 0\.4 s/);
  // Short steps that never reverse are a quick move, not a shake.
  assert.deepEqual(scene([...enter, ...shake([[4, 0], [8, 0], [12, 0]])]), []);
});

test('a looping scene must end where it began', () => {
  const loop = {start: 0, end: 4};
  const idle = [];
  idleOps(idle, 'card-a-idle', 0, 0, 4, {bob: 10, tilt: 1.8});
  assert.deepEqual(rules(sceneMotionFindings({id: 'card', ops: [tween('card-a', 0, 4, 'none', {x: 0}, {x: 0.2}), ...idle], loop})), [], 'idle returns to rest; a fifth of a pixel is not a seam');
  const found = sceneMotionFindings({id: 'card', ops: [{type: 'set', target: 'card-a', time: 0, props: {opacity: 0}}, tween('card-a', 0.2, 0.4, 'power3.out', {opacity: 0, y: 18}, {opacity: 1, y: 0})], loop});
  assert.deepEqual(found.map(f => [f.rule, f.severity, f.at, f.ids]), [['loop-seam', 'error', 4, ['card', 'card-a']]]);
  assert.match(found[0].detail, /card-a opacity 0 → 1\)/);
  assert.deepEqual(rules(sceneMotionFindings({id: 'card', ops: [tween('card-a', 1, 1, 'power3.out', {x: 0}, {x: 40})]})), [], 'no loop asked, no seam check');
});

test('the phase-1 node-graph sample passes the new checks: it breathes, its shake decays', () => {
  const story = example('node-graph-9x16');
  const scenes = [...renderedModels(story).entries];
  assert.ok(scenes.some(([, {model}]) => (modelOps(model) ?? []).some(op => /-idle$/.test(op.target))));
  for (const [id, {model}] of scenes) {
    const ops = modelOps(model) ?? [];
    assert.deepEqual(sceneMotionFindings({id, motion: model.motion, ops}).filter(f => ['static-hold', 'shake-overshoot', 'crowded-move'].includes(f.rule)), [], id);
  }
  assert.deepEqual(settled(choreographyGate(story).findings), []);
  assert.ok(!choreographyGate(story).findings.some(f => f.rule === 'static-hold'));
});

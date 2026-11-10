// A cast rides the plate it stands in through every camera move: pans,
// orbits and whip-pans carry it with its world (camera-world.mjs rideOf), a
// cast inside a photo plate rides it too, cuts mode gives it the plate's
// zooms, and a camera push into a full-frame plate never shows an empty frame.
import assert from 'node:assert/strict';
import test from 'node:test';
import {getEase} from '@launchclip/core/motion.mjs';
import {cameraPlan, rideOf, rideWorldPlates, screenPoint, worldPoint, sceneObjectLookup} from '@launchclip/core/camera-world.mjs';
import {resolveModule} from '@launchclip/core/modules.mjs';
import {resolveStory} from '@launchclip/core/story.mjs';
import {FULL_FRAME_PLATES, layerStateAt, sceneWindows, transitionTweens} from '@launchclip/core/transitions.mjs';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';

const W = 1080, H = 1920;
const brand = {colors: {bg: '#f4ead8', primary: '#a8572b', accent: '#2c6e63', ink: '#fffaf0', paper: '#1d1a17'}, fonts: {display: 'anton', body: 'inter', meta: 'jetbrains-mono'}};
const cast = {style: 'stick', characters: [{id: 'maya', position: 'left'}, {id: 'theo', position: 'right'}]};
const photo = {src: 'assets/plate.png', kind: 'image'};

function story({mode = 'world', move = {type: 'pan', dur: 0.6, direction: 'right'}, second = 'photo', zooms} = {}) {
  const plateTwo = second === 'photo'
    ? {id: 'p2', module: 'photo-scene', start: 3, end: 6, in: move, params: {media: photo, scrim: 'none'}}
    : {id: 'p2', module: 'world', start: 3, end: 6, in: move, params: {kind: 'kitchen', time: 'day'}};
  return resolveStory({schema: 'launchclip.story.v1', lane: 'motion', format: {width: W, height: H, fps: 30, duration: 6}, brand, cast, camera: {mode},
    scenes: [
      {id: 'p1', module: 'world', start: 0, end: 3, params: {kind: 'living-room', time: 'day'}, ...(zooms ? {zooms} : {})},
      {id: 'c1', module: 'cast-scene', track: 1, start: 0, end: 3, params: {set: 'standing', cast: [{id: 'maya'}, {id: 'theo'}]}},
      plateTwo,
      {id: 'c2', module: 'character-cameo', track: 1, start: 3, end: 6, params: {character: 'maya', panel: false}},
      {id: 'c3', module: 'character-cameo', track: 2, start: 3.5, end: 5.9, params: {character: 'theo', panel: false}}
    ]});
}

const planOf = s => cameraPlan(s, {windows: rideWorldPlates(s, sceneWindows(s)), objects: sceneObjectLookup(s, (scene, value) => resolveModule(scene, value))});

test('a cameo over a photo plate rides it: it takes the plate\'s window and its placement in the camera', () => {
  for (const type of ['pan', 'orbit', 'whip-pan']) {
    const s = story({move: {type, dur: 0.6, direction: 'right'}});
    assert.deepEqual(rideOf(s, s.scenes.find(scene => scene.id === 'c2')), {plate: 'p2', start: true, end: true}, type);
    const windows = rideWorldPlates(s, sceneWindows(s));
    const byId = Object.fromEntries(windows.scenes.map(entry => [entry.id, entry]));
    assert.equal(byId.c2.rides, 'p2');
    assert.equal(byId.c2.start, byId.p2.start);
    assert.equal(byId.c2.renderEnd, byId.p2.renderEnd);
    // The outgoing cast is held through the move with its plate.
    assert.equal(byId.c1.rides, 'p1');
    assert.equal(byId.c1.renderEnd, byId.p1.renderEnd);
    assert.ok(byId.p1.renderEnd > 3);
  }
});

test('camera follow: over a pan a riding character keeps its spot on its plate frame by frame, and enters and exits with the move', () => {
  for (const type of ['pan', 'orbit', 'whip-pan']) {
    const s = story({move: {type, dur: 0.6, direction: 'right'}});
    const plan = planOf(s);
    const placement = plan.placements.p2;
    // Mia's feet on the incoming plate (plate px).
    const feet = {x: 300, y: 1500};
    const xs = [];
    for (let t = 3; t <= 3.6 + 1e-9; t += 0.1) {
      const onPlate = screenPoint(plan, worldPoint(placement, feet), t);
      xs.push(onPlate.x);
    }
    // It arrives from off frame (right of the canvas) and settles where it stands.
    assert.ok(xs[0] > W, `${type}: starts off frame at ${xs[0]}`);
    assert.ok(Math.abs(xs.at(-1) - feet.x) < 16, `${type}: lands at ${xs.at(-1)}`);
    // Monotonic travel: no jump, no hold while the plate slides.
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] <= xs[i - 1] + 1e-6, `${type}: x goes back at step ${i}`);
  }
});

test('a cast inside its plate\'s window (not sharing its start) rides it with its own entrance', () => {
  const s = story();
  const ride = rideOf(s, s.scenes.find(scene => scene.id === 'c3'));
  assert.deepEqual(ride, {plate: 'p2', start: false, end: false});
  const byId = Object.fromEntries(rideWorldPlates(s, sceneWindows(s)).scenes.map(entry => [entry.id, entry]));
  assert.equal(byId.c3.rides, 'p2');
  assert.equal(byId.c3.start, 3.5);
  assert.equal(byId.c3.renderEnd, 5.9);
  // Its own passage (a short fade), not a cut at the plate's boundary.
  const model = resolveModule(s.scenes.find(scene => scene.id === 'c3'), s);
  assert.equal(model.content.entry, null);
});

test('compilers: riders sit inside the camera at their plate\'s placement, with no parallax wrapper', async () => {
  const s = story({move: {type: 'pan', dur: 0.6, direction: 'right'}, second: 'world'});
  const {html, warnings} = await compileStoryToHyperFrames(s, {write: false});
  assert.deepEqual(warnings.filter(w => /placeholder/.test(w)), []);
  const camera = html.slice(html.indexOf('id="lc-cam-pan"'));
  for (const id of ['c1', 'c2', 'c3']) {
    assert.match(camera, new RegExp(`data-launchclip-scene="${id}"`));
    assert.doesNotMatch(html, new RegExp(`id="lc-par-${id}"`));
  }
});

test('cuts mode: a pan carries the cast with its plate, and a cast takes its plate\'s zooms', async () => {
  const s = story({mode: 'cuts', second: 'world', zooms: [{at: 0.2, box: {x: 240, y: 900, width: 600, height: 720}, scale: 1.4, until: 2.2}]});
  // The pan into p2 is a camera move in cuts mode too: c1 leaves with it and c2 arrives with it.
  assert.deepEqual(rideOf(s, s.scenes.find(scene => scene.id === 'c1')), {plate: 'p1', start: false, end: true});
  assert.deepEqual(rideOf(s, s.scenes.find(scene => scene.id === 'c2')), {plate: 'p2', start: true, end: false});
  const {html, warnings} = await compileStoryToHyperFrames(s, {write: false});
  assert.deepEqual(warnings.filter(w => /placeholder/.test(w)), []);
  const motion = html;
  // Inside the camera, and zoomed by the same wrappers as its plate.
  const camera = html.slice(html.indexOf('id="lc-cam-pan"'));
  assert.match(camera, /data-launchclip-scene="c1"/);
  assert.match(html, /id="lc-zs-p1"/);
  assert.match(html, /id="lc-zs-c1"/);
  const zoomLines = id => motion.split('\n').filter(line => line.includes(`#lc-zs-${id}`) || line.includes(`#lc-zp-${id}`)).map(line => line.replaceAll(id, 'X'));
  assert.ok(zoomLines('c1').length > 0);
  assert.deepEqual(zoomLines('c1'), zoomLines('p1'));
});

test('a camera push into a full-frame plate never shows an empty frame', () => {
  assert.ok(FULL_FRAME_PLATES.includes('photo-scene') && FULL_FRAME_PLATES.includes('world'));
  const d = 0.6;
  const opaque = transitionTweens({type: 'push', dur: d}, {width: W, height: H, mode: 'world', opaque: true});
  // The incoming fade holds its first value from the transition's first frame.
  assert.deepEqual(opaque.in.map(tw => [tw.prop, tw.from, tw.to, tw.start]), [['opacity', 0, 0, 0], ['opacity', 0, 1, opaque.in[0].duration]]);
  const at = (list, t) => layerStateAt(t, list.map(tw => ({...tw, at: tw.start})), getEase).opacity;
  for (let t = 0; t <= d + 1e-9; t += d / 30) {
    const incoming = at(opaque.in, t), outgoing = at(opaque.out, t);
    // The incoming plate is on top: what shows is in + out × (1 − in).
    const cover = incoming + outgoing * (1 - incoming);
    assert.ok(cover > 0.97, `push at ${t.toFixed(2)} s covers only ${cover.toFixed(2)} of the frame`);
  }
  // A card plate keeps the clean hand-over (the two cards' text never shows at once).
  const card = transitionTweens({type: 'push', dur: d}, {width: W, height: H, mode: 'world'});
  assert.ok(card.in.at(-1).start > opaque.in.at(-1).start && card.out[0].start < opaque.out[0].start);
  // Out of a full-frame plate the outgoing picture stays whole under the incoming one.
  assert.deepEqual(transitionTweens({type: 'push', dur: d}, {width: W, height: H, mode: 'world', opaque: true, opaqueFrom: true}).out, []);
  // sceneWindows marks a photo plate's push as opaque.
  const s = story({move: {type: 'push', dur: 0.6}});
  const p2 = sceneWindows(s).scenes.find(entry => entry.id === 'p2');
  assert.ok(p2.tweens.some(tw => tw.role === 'in' && tw.prop === 'opacity' && tw.start < 0.1));
});

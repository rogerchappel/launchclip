// The kinetic feel (kit/core/feel.mjs, kit/core/kinetic.mjs) and the
// dot-wipe transition (kit/core/dot-wipe.mjs): one setting that turns on an
// ambient camera over every shot, zoom kicks, spring entrances and the tuned
// whips, drawn the same way by both renderers.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {STORY_FEELS, STORY_TRANSITIONS, resolveStory, validateStory} from '@launchclip/core/story.mjs';
import {FEEL_NAMES, feelErrors, kickErrors, resolveFeel} from '@launchclip/core/feel.mjs';
import {KICK, ambientPath, ambientSteps, kickTiming, feelBusy, feelCovers, feelGsap, feelKicks, feelPlan, feelSafeArea, feelSamples, feelStateAt, kickRest, kickValue} from '@launchclip/core/kinetic.mjs';
import {DOT_WIPE, dotRadius, dotWipeColor, dotWipeCover, dotWipeCss, dotWipeGrid, dotWipeGsap, dotWipePhases, dotWipes, resolveDotWipeColor} from '@launchclip/core/dot-wipe.mjs';
import {TRANSITION_TYPES, layerStateAt, sceneWindows, transitionTweens} from '@launchclip/core/transitions.mjs';
import {cameraPlan} from '@launchclip/core/camera-world.mjs';
import {easeOvershoot, resolveGrammar} from '@launchclip/core/grammar.mjs';
import {getEase, springEase} from '@launchclip/core/motion.mjs';
import {compileStoryToHyperFrames} from '../kit/hyperframes/story-compiler.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const paper = {colors: {bg: '#f2eee6', primary: '#e2412b', accent: '#1f6feb', ink: '#f2eee6', paper: '#151515'}, fonts: {display: 'bricolage-grotesque', body: 'inter', meta: 'jetbrains-mono'}};
const dark = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const card = (id, start, end, extra = {}) => ({id, module: 'stat-card', start, end, params: {value: '12', label: 'videos a week', source: 'Example log'}, ...extra});
const story = (extra = {}, scenes = [card('a', 0, 4), card('b', 4, 8, {in: {type: 'whip-pan', dur: 0.26, direction: 'left'}}), card('c', 8, 12, {in: {type: 'dot-wipe', dur: 0.5}})]) =>
  resolveStory({schema: 'launchclip.story.v1', lane: 'motion', brand: paper, format: {width: 1080, height: 1920, fps: 30, duration: 12}, motion: {feel: 'kinetic'}, camera: {mode: 'cuts'}, scenes, ...extra});
const planOf = (s, words = []) => { const windows = sceneWindows(s); return feelPlan(s, {windows, camera: cameraPlan(s, {windows}), words}); };
const size = {width: 1080, height: 1920};

test('the feel and the dot-wipe are part of the story contract, and story.mjs agrees with feel.mjs', () => {
  assert.deepEqual(STORY_FEELS, [...FEEL_NAMES]);
  assert.ok(STORY_TRANSITIONS.includes('dot-wipe') && TRANSITION_TYPES.includes('dot-wipe'));
  for (const feel of ['kinetic', {preset: 'kinetic', ambient: false, kicks: 'auto', spring: 0.2}, {ambient: {scale: [1.02, 1.04], shift: 0.004, period: [4, 8]}, kicks: {scale: 1.2, gap: 2}}]) {
    assert.deepEqual(feelErrors(feel), [], JSON.stringify(feel));
    assert.equal(validateStory(story({motion: {feel}})).ok, true, JSON.stringify(feel));
  }
  for (const feel of ['wobbly', {preset: 'x'}, {ambient: {scale: [1.1, 1.2]}}, {kicks: {gap: 0.5}}, {spring: 0.9}, {bounce: true}]) {
    assert.ok(feelErrors(feel).length > 0, JSON.stringify(feel));
    assert.equal(validateStory(story({motion: {feel}})).ok, false, JSON.stringify(feel));
  }
  assert.deepEqual(kickErrors([{at: 1.5}, {at: 'word:cache', scale: 1.2, origin: {x: 0.5, y: 0.4}}]), []);
  assert.ok(kickErrors([{at: 1, scale: 2}]).length && kickErrors([{at: 1, origin: {x: 2, y: 0}}]).length);
  assert.equal(validateStory(story({camera: {mode: 'cuts', kicks: [{at: 1, scale: 2}]}})).ok, false);
  // dot-wipe covers the frame: track-0 only.
  const overlay = story({}, [card('a', 0, 6), card('b', 2, 5, {track: 1, in: {type: 'dot-wipe', dur: 0.5}})]);
  assert.match(validateStory(overlay).errors.join('\n'), /dot-wipe/);
});

test('springs: springEase hits the overshoot it is asked for, and the kinetic grammar springs entrances and emphasis', () => {
  for (const overshoot of [0.1, 0.2, 0.27, 0.4]) assert.ok(Math.abs(easeOvershoot(springEase(overshoot)) - overshoot) < 0.005, String(overshoot));
  assert.equal(springEase(0), 'power3.out');
  const grammar = resolveGrammar(story());
  assert.equal(grammar.base, 'snappy');
  assert.equal(grammar.ease.enter, springEase(0.27));
  assert.equal(grammar.ease.emphasis, springEase(0.27));
  assert.ok(Math.abs(easeOvershoot(grammar.ease.enter) - 0.27) < 0.005);
  assert.equal(grammar.overshoot, 0.27);
  // The story's own grammar wins over the feel; the feel still lays under it.
  const own = resolveGrammar(story({motion: {feel: 'kinetic', grammar: {base: 'playful', ease: {enter: 'power2.out'}}}}));
  assert.equal(own.base, 'playful');
  assert.equal(own.ease.enter, 'power2.out');
  assert.equal(own.ease.emphasis, springEase(0.27));
  // Without a feel nothing changes.
  const plain = resolveStory({...story(), motion: {grammar: 'editorial'}});
  assert.equal(resolveGrammar(plain).ease.enter, 'power3.out');
});

test('the ambient camera is deterministic, never still, and never reveals an edge', () => {
  const s = story();
  const a = feelSamples(planOf(s)), b = feelSamples(planOf(story()));
  assert.equal(a.length, 360);
  assert.deepEqual(a, b, 'the same story gives the same frames');
  assert.ok(a.every((state) => feelCovers(state, size)), 'the wrapper always covers the canvas');
  const plan = planOf(s);
  // Within the spec: scale 1.02–1.045 at rest, x/y within ±0.9 % of the frame, periods 4–7 s dividing 12 s.
  for (const axis of ['x', 'y', 's']) assert.ok(plan.ambient[axis].period >= 4 && plan.ambient[axis].period <= 7 && Math.abs(12 / plan.ambient[axis].period - Math.round(12 / plan.ambient[axis].period)) < 1e-6, axis);
  const rest = a.filter((_, f) => !plan.kicks.some((kick) => f / 30 >= kick.at && f / 30 < kick.at + KICK.punch + KICK.settle + KICK.relax));
  assert.ok(rest.every((state) => state.scale >= 1.02 - 1e-6 && state.scale <= 1.045 + 1e-6));
  assert.ok(rest.every((state) => Math.abs(state.x) <= 0.009 * 1080 + 1e-3 && Math.abs(state.y) <= 0.009 * 1920 + 1e-3));
  // Never still: every frame moves the wrapper.
  for (let f = 1; f < a.length; f += 1) assert.ok(a[f].x !== a[f - 1].x || a[f].y !== a[f - 1].y || a[f].scale !== a[f - 1].scale, `frame ${f} repeats ${f - 1}`);
  // The loop seam matches: the frame after the last is frame 0.
  const end = feelStateAt(plan, 12);
  assert.ok(Math.abs(end.x - a[0].x) < 1e-3 && Math.abs(end.y - a[0].y) < 1e-3 && Math.abs(end.scale - a[0].scale) < 1e-5);
  // World mode keeps its own drift: no ambient on top.
  const world = story({camera: {mode: 'world'}}, [card('a', 0, 6), card('b', 6, 12, {in: {type: 'pan', dur: 0.8, direction: 'left'}})]);
  assert.equal(planOf(world)?.ambient ?? null, null);
  // Footage-led: the base camera owns the frame.
  assert.equal(resolveFeel({...s, lane: 'footage-led'}).camera, false);
});

test('a kick punches to its scale, springs back with 27 % overshoot and never dips under 1', () => {
  const kick = {at: 2, scale: 1.15, origin: {x: 540, y: 960}};
  const values = Array.from({length: 1201}, (_, i) => kickValue(kick, 2 + i * 0.001, 0.27));
  assert.equal(kickValue(kick, 1.99, 0.27), 1);
  assert.ok(Math.abs(kickValue(kick, 2 + KICK.punch, 0.27) - 1.15) < 1e-9, 'punched in by 0.12 s');
  const settle = values.slice(Math.round(KICK.punch * 1000));
  const rest = kickRest(1.15, 0.27), low = Math.min(...settle);
  assert.ok(Math.abs((rest - low) / (1.15 - rest) - 0.27) < 0.01, `overshoot ${(rest - low) / (1.15 - rest)}`);
  assert.ok(low >= 1 - 1e-3, `the spring bottoms out at 1 (${low})`);
  assert.equal(kickValue(kick, 2 + KICK.punch + KICK.settle + KICK.relax + 0.01, 0.27), 1);
  // An off-centre origin still covers the canvas on every frame.
  const s = story({camera: {mode: 'cuts', kicks: [{at: 1.5, scale: 1.4, origin: {x: 0, y: 1}}, {at: 6.5, origin: {x: 1, y: 0}}]}});
  const plan = planOf(s);
  const samples = feelSamples(plan);
  assert.ok(samples.every((state) => feelCovers(state, size)));
  // The 1.4 kick lands, reduced to what keeps the content in frame.
  assert.ok(Math.max(...samples.map((state) => state.scale)) > plan.safe.maxScale - 0.01, 'the reduced kick lands');
  assert.match(plan.warnings.join('\n'), /camera\.kicks\[0\] at 1\.5s reduced from 1\.4 to 1\.0\d+/);
});

// Where a canvas point lands through a wrapper state (scale about the centre, then translate).
const through = (state, px, py) => ({x: 540 + (px - 540) * state.scale + state.x, y: 960 + (py - 960) * state.scale + state.y});

test('kicks are content-safe: the content area (safe zone, headline and top-bar margin) stays in frame on every frame', () => {
  const area = feelSafeArea(size);
  // 9:16: the Shorts safe zone widened to a 60 px content margin left, right and top, plus 12 px of room.
  assert.deepEqual(area, {left: 48, top: 48, right: 1032, bottom: 1462, maxScale: 1.09756});
  assert.ok(feelSafeArea({width: 1920, height: 1080}).maxScale < area.maxScale);
  const inFrame = (state) => [[area.left, area.top], [area.right, area.top], [area.left, area.bottom], [area.right, area.bottom]]
    .every(([px, py]) => { const p = through(state, px, py); return p.x >= -1e-3 && p.x <= 1080 + 1e-3 && p.y >= -1e-3 && p.y <= 1920 + 1e-3; });
  // Big explicit kicks about off-centre origins on top of the ambient: reduced, and the area never leaves the frame.
  const big = story({camera: {mode: 'cuts', kicks: [{at: 1.5, scale: 1.3, origin: {x: 0.1, y: 0.1}}, {at: 6.5, scale: 1.15, origin: {x: 0.9, y: 0.6}}]}});
  const plan = planOf(big);
  for (const kick of plan.kicks) assert.ok(kick.scale < kick.requested, `${kick.source} reduced`);
  assert.equal(plan.warnings.filter((w) => /reduced from/.test(w)).length, 2);
  const samples = feelSamples(plan);
  samples.forEach((state, f) => { assert.ok(inFrame(state), `frame ${f}`); assert.ok(feelCovers(state, size), `edge ${f}`); });
  // A naive (unclamped) 1.15 kick on the ambient would crop a 66 px-margin headline.
  const naive = 1.045 * 1.15;
  assert.ok(540 + (66 - 540) * naive < 0);
  // The defaults (ambient up to 1.045, kicks 1.05) fit 9:16 untouched: no reduction, no warning.
  assert.ok(1.045 * 1.05 <= area.maxScale);
  const words = [{start: 1, end: 2, words: [{text: '12', start: 1.3, end: 1.6}]}, {start: 9, end: 10, words: [{text: '99', start: 9.2, end: 9.5}]}];
  const auto = planOf(story(), words);
  assert.deepEqual(auto.kicks.map((kick) => kick.scale), [1.05, 1.05]);
  assert.deepEqual(auto.warnings, []);
  feelSamples(auto).forEach((state, f) => assert.ok(inFrame(state), `default frame ${f}`));
  // A story that sets a bigger automatic kick is told it was reduced.
  const loud = planOf(story({motion: {feel: {preset: 'kinetic', kicks: {scale: 1.2}}}}), words);
  assert.match(loud.warnings.join('\n'), /motion\.feel\.kicks\.scale 1\.2 reduced to as low as 1\.0\d+ on 2 automatic kick/);
  // Kicks still read as a zoom: the scale rises by the kick on its frames.
  const all = feelSamples(auto), at = Math.round(auto.kicks[0].at * 30);
  const rise = Math.max(...all.slice(at, at + 6).map((state) => state.scale)) / all[at].scale;
  assert.ok(rise > 1.04, `the kick still punches (×${rise.toFixed(3)})`);
});

const round3 = (v) => Math.round(v * 1000) / 1000;

test('kicks never overlap each other or another camera move, and automatic kicks follow emphasis', () => {
  const s = story({camera: {mode: 'cuts', kicks: [{at: 1}, {at: 1.6}, {at: 4.1}, {at: 8.2}, {at: 10}]}});
  const windows = sceneWindows(s);
  const busy = feelBusy(s, windows, cameraPlan(s, {windows}));
  assert.ok(busy.some((span) => /whip-pan/.test(span.why)) && busy.some((span) => /dot-wipe/.test(span.why)));
  const {kicks, warnings} = feelKicks(s, resolveFeel(s), {busy});
  assert.deepEqual(kicks.map((kick) => kick.at), [1, 10]);
  assert.equal(warnings.length, 3);
  assert.ok(warnings.some((w) => /within 1.5s/.test(w)) && warnings.some((w) => /whip-pan/.test(w)) && warnings.some((w) => /dot-wipe/.test(w)));
  // A transition starts at its scene's start (no pre-roll); a kick just before it is refused because
  // its own punch and settle run into it, and the warning gives both windows and where to move it.
  const wipe = busy.find((span) => /dot-wipe/.test(span.why));
  const before = round3(wipe.start - 0.3);
  const single = story({camera: {mode: 'cuts', kicks: [{at: before}]}});
  const late = feelKicks(single, resolveFeel(single), {busy: [wipe]});
  assert.equal(late.kicks.length, 0);
  assert.match(late.warnings[0], new RegExp(`at ${before}s its punch and settle \\(${before}–${round3(before + 0.47)}s\\) would overlap .*dot-wipe \\(${wipe.start}–${wipe.end}s, the move ±0.06s\\); start it by ${round3(wipe.start - 0.47)}s or after ${wipe.end}s`));
  // Automatic: numbers and emphasis words in the narration, at most one per gap, never in a move.
  const words = [{start: 0.5, end: 0.8, words: [{text: 'Twelve', start: 0.5, end: 0.8}]}, {start: 1, end: 2, words: [{text: 'cut', start: 1, end: 1.2}, {text: '12', start: 1.3, end: 1.6}, {text: '40%', start: 2.0, end: 2.4}]},
    {start: 4, end: 5, words: [{text: '3', start: 4.05, end: 4.3}, {text: '7', start: 5.2, end: 5.4}]}, {start: 9, end: 10, words: [{text: '99', start: 9.2, end: 9.5}]}];
  const auto = planOf(story(), words);
  const ats = auto.kicks.map((kick) => kick.at);
  assert.deepEqual(ats, [1.3, 5.2, 9.2]);
  for (let i = 1; i < ats.length; i += 1) assert.ok(ats[i] - ats[i - 1] >= 1.5 - 1e-9);
  for (const kick of auto.kicks) for (const span of auto.busy) assert.ok(kick.at + KICK.punch + KICK.settle <= span.start || kick.at >= span.end, `${kick.at} in ${span.why}`);
  // kicks: false turns the automatic ones off; explicit ones stay.
  assert.equal(planOf(story({motion: {feel: {preset: 'kinetic', kicks: false}}}), words).kicks.length, 0);
});

test('dot-wipe: the incoming plate swaps in under the full cover, and the cover grows from the edges and shrinks from the centre', () => {
  const tw = transitionTweens({type: 'dot-wipe', dur: 0.5}, size);
  const at = (list, t) => layerStateAt(t, list.map((x) => ({...x, at: x.start})), getEase);
  assert.equal(at(tw.in, 0).opacity, 0);
  assert.equal(at(tw.in, 0.24).opacity, 0);
  assert.equal(at(tw.in, 0.25).opacity, 1);
  assert.equal(at(tw.out, 0.26).opacity, 0);
  const wipe = {start: 8, dur: 0.5};
  assert.equal(dotWipeCover(wipe, 7.99), 0);
  assert.equal(dotWipeCover(wipe, 8.25), 1, 'the peak at the swap');
  assert.equal(dotWipeCover(wipe, 8.5), 0);
  assert.ok(dotWipeCover(wipe, 8.1) > 0 && dotWipeCover(wipe, 8.1) < 1);
  const grid = dotWipeGrid(1080, 1920);
  assert.ok(grid.pitch > 40 && grid.pitch < 50);
  assert.equal(grid.groups[0].late, 0);
  assert.equal(grid.groups.at(-1).late, 1);
  // Half-way in, the corners are full and the centre is still clear.
  assert.equal(dotRadius(0.5, 0, grid.radius), grid.radius);
  assert.equal(dotRadius(0.5, 1, grid.radius), 0);
  // With cover 1 the dots overlap at the peak: the frame is closed.
  assert.ok(dotRadius(1, 1, grid.radius, 1) >= grid.pitch * Math.SQRT1_2);
  assert.match(dotWipeCss(1080, 1920), /r: calc\(\d+(\.\d+)?px \* var\(--lc-dc, 1\) \* clamp\(0, var\(--lc-dw\) \* 2\.4 - var\(--lc-dl\) \* 1\.4, 1\)\)/);
  // HyperFrames tweens the same cover with the same eases.
  const lines = dotWipeGsap({id: 'lc-dw-c', start: 8, dur: 0.5});
  assert.ok(lines.some((line) => line.includes(`ease: "${DOT_WIPE.coverEase}"`)) && lines.some((line) => line.includes(`ease: "${DOT_WIPE.revealEase}"`)));
});

// The share of a frame the dots cover (sampled on a 6 px lattice) at progress c.
function dotCoverage(c, cover, {width = 1080, height = 1920} = {}) {
  const grid = dotWipeGrid(width, height);
  const dots = grid.groups.flatMap((group) => group.dots.map((dot) => ({...dot, r: dotRadius(c, group.late, grid.radius, cover)})));
  let hit = 0, n = 0;
  for (let y = 0; y < height; y += 6) for (let x = 0; x < width; x += 6) {
    n += 1;
    if (dots.some((dot) => (dot.x - x) ** 2 + (dot.y - y) ** 2 <= dot.r * dot.r)) hit += 1;
  }
  return hit / n;
}

test('dot-wipe options: color, cover and hold validate, resolve and default to a wipe that does not blink', () => {
  const raw = (inOpts) => ({schema: 'launchclip.story.v1', lane: 'motion', brand: paper, format: {width: 1080, height: 1920, fps: 30, duration: 8}, scenes: [card('a', 0, 4), card('b', 4, 8, {in: {type: 'dot-wipe', dur: 0.5, ...inOpts}})]});
  const wipeOf = (inOpts) => { const s = resolveStory(raw(inOpts)); return dotWipes(s, sceneWindows(s))[0]; };
  assert.deepEqual(validateStory(raw({color: 'accent', cover: 0.7, hold: 2})).errors, []);
  assert.deepEqual(validateStory(raw({color: '#12ab34', cover: 1, hold: 0})).errors, []);
  assert.match(validateStory(raw({color: 'teal'})).errors.join('\n'), /scenes\[1\]\.in\.color must be one of accent, ink, paper or a #rrggbb hex/);
  assert.match(validateStory(raw({cover: 1.2})).errors.join('\n'), /scenes\[1\]\.in\.cover must be the peak dot size between 0\.3 and 1/);
  assert.match(validateStory(raw({hold: 1.5})).errors.join('\n'), /in\.hold must be a whole number of frames/);
  assert.match(validateStory(raw({hold: 8})).errors.join('\n'), /in\.hold \(8 frames\) must be at most half the wipe \(7 frames at 30 fps\)/);
  const fade = raw({}); fade.scenes[1].in = {type: 'fade', dur: 0.4, cover: 0.5};
  assert.match(validateStory(fade).errors.join('\n'), /in\.cover is a dot-wipe option; "fade" does not take it/);

  // Defaults: accent dots, peak at 0.65 of the closing size, no hold.
  assert.deepEqual(DOT_WIPE.defaults, {color: 'accent', cover: 0.65, hold: 0});
  const wipe = wipeOf({});
  assert.deepEqual({color: wipe.color, cover: wipe.cover, hold: wipe.hold}, {color: '#1f6feb', cover: 0.65, hold: 0});
  // Colours: ink is the contrasting text colour, paper the page (bg), a hex
  // is itself; an accent lost on the page falls back to ink.
  assert.equal(resolveDotWipeColor(paper, 'ink'), '#151515');
  assert.equal(resolveDotWipeColor(paper, 'paper'), '#f2eee6');
  assert.equal(resolveDotWipeColor(paper, '#AABBCC'), '#aabbcc');
  assert.equal(resolveDotWipeColor({colors: {...paper.colors, accent: '#efebe3'}}, 'accent'), '#151515');
  assert.equal(resolveDotWipeColor(dark, 'accent'), '#46d4ff');

  // The reference look at 30 fps: the dots grow, the scene swaps at the
  // peak, the dots shrink, and with the defaults no frame is closed (solid)
  // and no frame holds the peak.
  const frames = Array.from({length: 16}, (_, f) => 4 + f / 30);
  const progress = frames.map((t) => dotWipeCover(wipe, t));
  const peak = progress.indexOf(Math.max(...progress));
  assert.ok(Math.abs(frames[peak] - 4.25) <= 1 / 30 + 1e-9, 'the peak is at the swap (the midpoint)');
  for (let f = 1; f <= peak; f += 1) assert.ok(progress[f] >= progress[f - 1], `grows to the peak (frame ${f})`);
  for (let f = peak + 1; f < frames.length; f += 1) assert.ok(progress[f] <= progress[f - 1], `shrinks after the peak (frame ${f})`);
  assert.equal(progress.filter((c) => c >= 1 - 1e-9).length, 0, 'no frame holds the peak');
  const coverage = progress.map((c) => dotCoverage(c, wipe.cover));
  assert.ok(Math.max(...coverage) < 0.8, `the default peak leaves the cut showing through (max ${Math.max(...coverage).toFixed(3)})`);
  assert.ok(Math.max(...coverage) > 0.6, 'but it still reads as a wipe');
  // cover 1 with a hold is the closed look: solid frames held at the peak,
  // the hold centred on the swap.
  const closed = wipeOf({cover: 1, hold: 3});
  assert.equal(closed.hold, 0.1);
  // (3 frames held; a frame that lands exactly on either edge of the hold is at the peak too.)
  const atPeak = frames.map((t) => dotWipeCover(closed, t)).filter((c) => c >= 1 - 1e-9).length;
  assert.ok(atPeak >= 3 && atPeak <= 4, `${atPeak} frames at the peak`);
  assert.ok(dotCoverage(1, 1) > 0.999);
  const p = dotWipePhases(closed);
  assert.ok(Math.abs((p.coverEnd + p.revealStart) / 2 - 4.25) < 1e-6);
});

test('dot-wipe ink: dark dots on a light paper look, light dots on a dark look', () => {
  assert.equal(dotWipeColor(paper), '#151515');
  assert.equal(dotWipeColor({colors: {...paper.colors, ink: '#151515', paper: '#f2eee6'}}), '#151515');
  assert.equal(dotWipeColor(dark), '#f2eee6');
  const s = story();
  assert.deepEqual(dotWipes(s, sceneWindows(s)).map((wipe) => [wipe.sceneId, wipe.start, wipe.dur]), [['c', 8, 0.5]]);
});

test('HyperFrames: the feel wraps every scene under the dot wipes and captions; without a feel nothing changes', async () => {
  const dir = path.join(ROOT, 'examples/story/kinetic-feel-9x16');
  const s = resolveStory(JSON.parse(await readFile(path.join(dir, 'storyboard.json'), 'utf8')));
  const {html, warnings} = await compileStoryToHyperFrames(s, {write: false, sourceDir: dir});
  assert.deepEqual(warnings.filter((w) => /kick/.test(w)), []);
  const feel = html.indexOf('<div id="lc-feel" class="lc-feel">'), wipe = html.indexOf('<div id="lc-dw-s3"');
  assert.ok(feel > 0 && wipe > feel);
  for (const id of ['s1', 's2', 's3']) { const at = html.indexOf(`data-launchclip-scene="${id}"`); assert.ok(at > feel && at < wipe, id); }
  assert.match(html, /tl\.set\("#lc-feel", \{ x: F\[i\]\[1\]/);
  assert.match(html, /tl\.fromTo\("#lc-dw-s3", \{ "--lc-dw": 0 \}/);
  assert.match(html, /<div id="lc-dw-s3" class="lc-dot-wipe"[^>]*--lc-dc:0\.65;/);
  // The GSAP table is the frame-pure samples.
  const plan = planOf(s);
  const table = JSON.parse(/var F = (\[\[.*?\]\]);/.exec(html)[1]);
  const samples = feelSamples(plan);
  for (const [f, x, y, scale] of table) assert.deepEqual({x, y, scale}, samples[f]);
  assert.equal(feelGsap(plan, samples)[1], html.split('\n').map((line) => line.trim()).find((line) => line.startsWith('(function () { var F')));
  // A story without the feel compiles with no wrapper and no wipe.
  const plain = resolveStory({...JSON.parse(await readFile(path.join(dir, 'storyboard.json'), 'utf8')), motion: undefined, camera: {mode: 'cuts'}, scenes: s.scenes.map((scene) => ({...scene, in: scene.in?.type === 'dot-wipe' ? {type: 'fade', dur: 0.4} : scene.in}))});
  const {html: none} = await compileStoryToHyperFrames(plain, {write: false, sourceDir: dir});
  assert.ok(!none.includes('lc-feel') && !none.includes('lc-dot-wipe'));
});

test('Remotion draws the same feel and wipes: the wrapper reads feelStateAt per frame and the wipe the same SVG and CSS', async () => {
  const tsx = await readFile(path.join(ROOT, 'kit/remotion/StoryComposition.tsx'), 'utf8');
  assert.match(tsx, /feelStateAt\(plan, Math\.floor\(\(frame \* plan\.fps\) \/ fps \+ 1e-6\) \/ plan\.fps\)/);
  assert.match(tsx, /dotWipeSvg\(width, height, wipe\.color\)/);
  assert.match(tsx, /dotWipeCss\(width, height\)/);
  assert.match(tsx, /dotWipeCover\(wipe, t\)/);
  assert.match(tsx, /\["--lc-dc" as any\]: dotWipePeak\(wipe\)/);
  // feelStateAt at f / fps is exactly the HyperFrames sample for frame f.
  const plan = planOf(story({camera: {mode: 'cuts', kicks: [{at: 1}]}}));
  const samples = feelSamples(plan);
  for (const f of [0, 31, 33, 40, 200, 359]) assert.deepEqual(feelStateAt(plan, f / 30), samples[f]);
});

test('snap: the ambient camera holds still on a framing, then snaps to the next, and never reveals an edge', () => {
  const s = story({motion: {feel: 'snap'}});
  const plan = planOf(s);
  const a = feelSamples(plan);
  assert.deepEqual(a, feelSamples(planOf(story({motion: {feel: 'snap'}}))), 'the same story gives the same frames');
  assert.ok(a.every((state) => feelCovers(state, size)), 'the wrapper always covers the canvas');
  assert.equal(plan.ambient.mode, 'step');
  const {poses, move, creep} = plan.ambient;
  assert.deepEqual([move, creep], [0.28, 0]);
  // Holds of 1.6–4.5 s between moves, alternating wide and tight framings far enough apart to blur.
  for (let k = 1; k < poses.length; k += 1) {
    const hold = poses[k].at - poses[k - 1].at - move;
    assert.ok(hold >= 1.6 - 1e-6 && hold <= 4.5 + 1e-6, `hold ${k} is ${hold}`);
    assert.ok(Math.abs(poses[k].s - poses[k - 1].s) >= 0.25 * (1.05 - 1.012) - 1e-6, `move ${k} changes the framing`);
  }
  // The camera is exactly still through a hold, and the snap lands on the next framing in `move` seconds.
  const still = {...plan, kicks: []};
  const [p0, p1] = poses;
  const holdEnd = p1.at - move;
  const scaleAt = (t) => feelStateAt(still, t).scale;
  assert.equal(scaleAt(p0.at + 0.05), scaleAt(holdEnd - 0.001));
  assert.ok(Math.abs(scaleAt(p1.at) - p1.s) < 1e-4, 'the snap lands on the next framing');
  // With creep, a hold covers that share of the way slowly and the snap the rest.
  const creeping = {...still, ambient: {...still.ambient, creep: 0.3}};
  assert.ok(Math.abs(feelStateAt(creeping, holdEnd).scale - (p0.s + (p1.s - p0.s) * 0.3)) < 1e-4);
  // Kicks return fast with the preset's own timing; the grammar holds still.
  assert.deepEqual(kickTiming(resolveFeel(s)), {...KICK, punch: 0.1, settle: 0.22, relax: 0.2, relaxEase: 'expo.inOut'});
  assert.equal(resolveGrammar(s).hold.level, 'off');
  // A step mode on the kinetic preset takes the snap defaults for hold and move, with no creep.
  const custom = resolveFeel(story({motion: {feel: {preset: 'kinetic', ambient: {mode: 'step'}}}}));
  assert.deepEqual([custom.ambient.hold, custom.ambient.move, custom.ambient.creep], [[1.6, 4.5], 0.28, 0]);
  assert.equal(ambientSteps(custom.ambient, {width: 1080, height: 1920, duration: 12}).mode, 'step');
  for (const bad of [{ambient: {mode: 'jitter'}}, {ambient: {mode: 'step', hold: [0.35, 0.8]}}, {ambient: {move: 1}}, {ambient: {creep: 0.8}}]) {
    assert.ok(feelErrors(bad).length > 0, JSON.stringify(bad));
    assert.equal(validateStory(story({motion: {feel: bad}})).ok, false, JSON.stringify(bad));
  }
});

test('steady: a steadicam floats on one smooth path, never still, snapping or pumping, and never reveals an edge', () => {
  const s = story({motion: {feel: 'steady'}}, [card('a', 0, 20), card('b', 20, 40, {in: {type: 'whip-pan', dur: 0.26, direction: 'left'}})]);
  const s2 = {...s, format: {...s.format, duration: 40}};
  const plan = planOf(s2);
  const a = feelSamples(plan);
  assert.deepEqual(a, feelSamples(planOf(s2)), 'the same story gives the same frames');
  assert.ok(a.every((state) => feelCovers(state, size)), 'the wrapper always covers the canvas');
  assert.equal(plan.ambient.mode, 'steady');
  assert.equal(plan.kicks.length, 0, 'no automatic kicks');
  let reversals = 0, last = 0;
  for (let f = 1; f < a.length; f += 1) {
    const d = a[f].scale - a[f - 1].scale;
    const speed = Math.hypot(a[f].x - a[f - 1].x, a[f].y - a[f - 1].y);
    assert.ok(speed < 1.5, `frame ${f} moves ${speed} px: no snap`);
    assert.ok(Math.abs(d) < 0.001, `frame ${f} changes scale by ${d}: no zoom jump`);
    assert.ok(speed > 0 || d !== 0, `frame ${f} repeats: never still`);
    if (Math.abs(d) > 1e-6) { const sign = Math.sign(d); if (last && sign !== last) reversals += 1; last = sign; }
  }
  assert.ok(reversals / (a.length / 30 / 60) <= 16, `zoom turns ${reversals} times: not on a beat`);
  // Knots are unevenly spaced, so nothing repeats on a beat.
  const {knots} = plan.ambient;
  const gaps = new Set(knots.slice(1).map((knot, k) => Math.round((knot.at - knots[k].at) * 100)));
  assert.ok(gaps.size > knots.length / 2, 'the path has no period');
  assert.equal(ambientPath(resolveFeel(s2).ambient, {width: 1080, height: 1920, duration: 40}).mode, 'steady');
  assert.equal(validateStory(story({motion: {feel: {preset: 'steady', ambient: {period: [2.5, 5]}}}})).ok, true);
});

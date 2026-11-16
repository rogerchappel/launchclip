// Catalogue I layer stack: the breakdown reel's one scene. The finished shot
// fills the frame, a hook lands word by word on the beat, the shot plays,
// then the frame tilts into an isometric stack and its layers (the project's
// own artefacts, final on top) peel apart one per beat with their labels,
// hold while the camera drifts, snap back together on a beat with a short
// shake, settle flat under a payoff line, and end on exactly the frame they
// began on, so the reel loops.
//
// Everything is timed in beats (params.bpm, 120 by default: one beat every
// 0.5 s) and the scene is 20 beats (a longer one holds the opening frame after): hook 0–3, play 3–6, apart 6–16,
// snap at 16, payoff 17–19, clear by 20. Layer moves ease out and the snap
// eases in (power3); nothing overshoots, camera moves included.
//
// 2D only, so both renderers draw the same tree: a layer is three nested
// full-frame divs (screen offset > squash > rotation), which is an isometric
// plane without a CSS 3D context. The root never fades in or out, so the
// first and last frames are the same picture. Registered in
// kit/core/catalog-h.mjs.

import {frameSamples, timingRules} from './catalog-b-base.mjs';
import {sampleTime} from './catalog-b-view.mjs';
import {createHBase, fitText, mixColor, r2, rt} from './catalog-h-base.mjs';
import {abs, el, label, set, tw} from './catalog-h-view.mjs';

export const LAYER_KINDS = Object.freeze(['image', 'storyboard', 'style']);
export const MAX_LAYERS = 5;
export const MAX_PLAY_FRAMES = 48;
export const REEL_BEATS = 20;
const SQUASH = Math.tan(Math.PI / 6); // a plane at 45° seen from 30° above
const TURN = 45;
const SCRIM = 0.72; // enough to read display type over any finished frame
const PUSH = 1.06; // the hook eases out of it and the payoff back into it, so the seam is still
const DRIFT = 1.08, SPREAD = 1.22; // the hold: the camera eases in while the layers spread a little, so it never sits still
const SHAKE = {duration: 0.32, amp: 14, freq: 19, decay: 11};

/** The scene's beat times (seconds from scene start) for a tempo. */
export function reelBeats(bpm = 120) {
  const B = 60 / bpm;
  return {beat: B, hook: 0, play: 3 * B, tilt: 6 * B, apart: 7 * B, snap: 16 * B, payoff: 17 * B, clear: 19 * B, end: REEL_BEATS * B};
}

function layersOf(check, raw) {
  check.arr(raw, 'params.layers', 2, MAX_LAYERS);
  const layers = raw.map((layer, i) => {
    const at = `params.layers[${i}]`;
    check.obj(layer, at, ['label', 'kind', 'image', 'fit', 'panels'], ['label']);
    const kind = layer.kind === undefined ? 'image' : check.oneOf(layer.kind, `${at}.kind`, LAYER_KINDS);
    const out = {kind, label: check.str(layer.label, `${at}.label`, 18)};
    if (kind === 'image') {
      out.image = check.asset(layer.image, `${at}.image`);
      out.fit = layer.fit === undefined ? 'cover' : check.oneOf(layer.fit, `${at}.fit`, ['cover', 'contain']);
    } else if (layer.image !== undefined || layer.fit !== undefined) check.fail(at, `a ${kind} layer is drawn from the project; image and fit are for image layers`);
    if (kind === 'storyboard') out.panels = check.arr(layer.panels, `${at}.panels`, 2, 6).map((text, k) => check.str(text, `${at}.panels[${k}]`, 40));
    else if (layer.panels !== undefined) check.fail(`${at}.panels`, 'is for storyboard layers');
    return out;
  });
  if (layers[layers.length - 1].kind !== 'image') check.fail('params.layers', 'ends on the finished shot: the last (top) layer is an image');
  return layers;
}

function layerResolve(params, ctx) {
  const b = createHBase('layer-stack', params, ctx, {allowed: ['hook', 'payoff', 'layers', 'play', 'bpm'], required: ['hook', 'payoff', 'layers'], hidesCaptions: true});
  const {check, u} = b;
  const p = b.params;
  const bpm = p.bpm === undefined ? 120 : check.num(p.bpm, 'params.bpm', 90, 160);
  const beats = reelBeats(bpm);
  // A longer scene (a story's final hold) keeps the opening frame after beat 20.
  if (b.duration < beats.end - 1 / b.fps) check.fail('duration', `is at least ${REEL_BEATS} beats at ${bpm} BPM: ${r2(beats.end)} s; got ${b.duration} s`);
  const hook = check.str(p.hook, 'params.hook', 48), payoff = check.str(p.payoff, 'params.payoff', 48);
  const words = hook.split(/\s+/);
  if (words.length > 6) check.fail('params.hook', `lands on the beat a word or two at a time: at most 6 words; got ${words.length}`);
  const layers = layersOf(check, p.layers);
  const play = p.play === undefined ? [] : check.arr(p.play, 'params.play', 2, MAX_PLAY_FRAMES).map((src, i) => check.asset(src, `params.play[${i}]`));
  const n = layers.length;

  // The root holds still: the reel opens and closes on the same frame.
  const still = {opacity: 1, x: 0, y: 0, scale: 1};
  b.motion.enterFrom = still; b.motion.exitTo = still;

  const at = beat => rt(b.start + beat);
  const cw = b.canvas.width, ch = b.canvas.height, R = b.rect;
  // A card is the whole canvas, placed in rect coordinates.
  const card = {x: r2(-R.x), y: r2(-R.y), w: cw, h: ch, cx: r2(cw / 2 - R.x), cy: r2(ch / 2 - R.y)};

  // Labels: one column on the right; the stack fills the rest.
  const gap = u(32), colW = r2(R.width * (b.portrait ? 0.4 : 0.26));
  const size = Math.min(...layers.map((layer, i) => fitText(check, `params.layers[${i}].label`, layer.label, {family: 'body', width: colW, preferred: u(52), min: b.min.key}).size));
  const numSize = r2(Math.max(b.min.meta, size * 0.6)), lineH = r2(numSize * 1.3 + size * 1.25);
  const stackW = R.width - colW - gap - u(16);
  const diag = (cw + ch) / Math.SQRT2;
  // Diamond height D, layer step g (a little less than D, so each layer keeps an edge of the one under it showing).
  const kW = stackW / diag, kH = R.height / (SQUASH * diag * (1 + 0.7 * (n - 1)));
  const k = Math.min(kW, kH);
  const D = SQUASH * k * diag, step = Math.min(0.9 * D, (R.height - D) / Math.max(1, n - 1));
  const target = {x: r2(u(8) + k * diag / 2), y: r2(R.height / 2 + (n - 1) * step / 2)};
  const cam = {x: r2(target.x - card.cx), y: r2(target.y - card.cy)};
  const offsets = layers.map((_, i) => r2(-i * step));
  const colX = r2(R.width - colW);
  const labels = layers.map((layer, i) => ({i, text: layer.label, num: String(i + 1).padStart(2, '0'), x: colX, y: r2(target.y + offsets[i] - lineH / 2),
    at: rt(at(i === 0 ? beats.apart + (n - 1) * beats.beat : beats.apart + (n - 1 - i) * beats.beat) + 0.2)}));
  for (const l of labels) if (l.y < 0 || l.y + lineH > R.height) check.fail('params.layers', `has ${n} layers; ${l.text} does not fit beside the stack`);

  // Hook words: up to three beats, the words spread over them in order.
  const groups = Math.min(3, words.length);
  const hookSize = fitText(check, 'params.hook', hook, {family: 'display', width: R.width * 0.92, preferred: u(132), min: u(64), maxLines: 3}).size;
  const payoffSize = fitText(check, 'params.payoff', payoff, {family: 'display', width: R.width * 0.92, preferred: u(104), min: u(56), maxLines: 3}).size;
  const hookWords = words.map((word, i) => ({word, at: at(Math.floor(i * groups / words.length) * beats.beat)}));
  const flip = play.map((src, j) => ({src, at: at(beats.play + j * (beats.tilt - beats.play) / play.length)}));

  b.events.push({id: `${b.id}-hook`, name: 'hook', time: at(0), endTime: at(beats.play), role: 'emphasis', cue: 'pop'});
  b.events.push({id: `${b.id}-play`, name: 'play', time: at(beats.play), endTime: at(beats.tilt), role: 'emphasis'});
  b.events.push({id: `${b.id}-explode`, name: 'explode', time: at(beats.tilt), endTime: at(beats.apart + (n - 1) * beats.beat), role: 'emphasis', cue: 'pop'});
  b.events.push({id: `${b.id}-snap`, name: 'snap', time: at(beats.snap), endTime: rt(at(beats.snap) + SHAKE.duration), role: 'emphasis', cue: 'impact'});
  b.events.push({id: `${b.id}-payoff`, name: 'payoff', time: at(beats.payoff), endTime: at(beats.clear), role: 'emphasis', cue: 'pop'});

  const colors = b.colors;
  const content = {variant: b.variant, bpm, beats: Object.fromEntries(Object.entries(beats).map(([key, v]) => [key, key === 'beat' || key === 'end' ? v : at(v)])),
    layers, play: flip, card, cam, k: r2(k), offsets, step: r2(step), labels, labelSize: size, numSize, lineH, colW, hook: {words: hookWords, size: hookSize}, payoff: {text: payoff, size: payoffSize},
    paper: mixColor(colors.paper, colors.bg, 0.04), sheetInk: mixColor(colors.bg, colors.paper, 0.1), edge: mixColor(colors.paper, colors.bg, 0.35), edgeW: r2(Math.max(2, 3 * b.unit / k)),
    numColor: colors.accent, snapAt: at(beats.snap), buildEnd: at(beats.apart + (n - 1) * beats.beat)};
  const model = b.finish(content, {minTextPx: r2(Math.min(size, hookSize, payoffSize))});
  // No ambient drift (kit/core/ambient.mjs): the stage is its own camera, and a drift would break the seam.
  model.layout = {...model.layout, drift: false};
  return model;
}

// ---------------------------------------------------------------------------
// Views of the drawn layers (canvas-sized; they are seen scaled by k).

function storyboardSheet(model, layer) {
  const {fonts, unit: u, canvas: {width: W, height: H}} = model;
  const c = model.content;
  const n = layer.panels.length, cols = W > H ? 3 : 2, rows = Math.ceil(n / cols);
  const pad = 90 * u, gutter = 60 * u, capH = 120 * u;
  const pw = (W - 2 * pad - (cols - 1) * gutter) / cols, ph = Math.min((H - 2 * pad - (rows - 1) * gutter) / rows - capH, pw * (W > H ? 9 / 16 : 16 / 9));
  const line = {stroke: c.sheetInk, strokeWidth: 5 * u, fill: 'none', strokeLinecap: 'round'};
  return layer.panels.flatMap((caption, i) => {
    const x = r2(pad + (i % cols) * (pw + gutter)), y = r2(pad + Math.floor(i / cols) * (ph + capH + gutter));
    return [
      el('svg', null, abs(x, y, r2(pw), r2(ph), {overflow: 'visible'}), [
        el('rect', null, null, [], {x: 0, y: 0, width: r2(pw), height: r2(ph), rx: r2(12 * u), ...line}),
        el('path', null, null, [], {d: `M${r2(pw * 0.12)} ${r2(ph * 0.82)} L${r2(pw * 0.42)} ${r2(ph * 0.48)} L${r2(pw * 0.6)} ${r2(ph * 0.68)} L${r2(pw * 0.88)} ${r2(ph * 0.3)}`, ...line, stroke: mixColor(c.sheetInk, c.paper, 0.45)})
      ], {width: r2(pw), height: r2(ph), viewBox: `0 0 ${r2(pw)} ${r2(ph)}`}),
      label(null, x, r2(y + ph + 18 * u), r2(pw), `${String(i + 1).padStart(2, '0')}  ${caption}`, {size: r2(52 * u), family: fonts.body, color: c.sheetInk, weight: 600, lineHeight: 1.15, wrap: true})
    ];
  });
}

function styleSheet(model) {
  const {fonts, unit: u, theme, canvas: {width: W, height: H}} = model;
  const c = model.content;
  const swatches = [theme.bg, theme.primary, theme.accent, theme.paper];
  const pad = 110 * u, sw = (W - 2 * pad - 3 * 40 * u) / 4, sh = Math.min(sw * 1.4, H * 0.3);
  const out = swatches.map((color, i) => el('div', null, abs(r2(pad + i * (sw + 40 * u)), r2(pad), r2(sw), r2(sh), {background: color, borderRadius: r2(24 * u), boxShadow: `0 0 0 ${r2(4 * u)}px ${c.sheetInk}`})));
  const specimens = [['display', 'Aa Display', 170], ['body', 'Aa Body', 130], ['meta', 'Aa Meta', 100]];
  let y = pad + sh + 120 * u;
  for (const [role, sample, size] of specimens) {
    out.push(label(null, r2(pad), r2(y), r2(W - 2 * pad), sample, {size: r2(size * u), family: fonts[role], color: c.sheetInk, weight: role === 'display' ? 400 : 600, lineHeight: 1.1}));
    y += size * u * 1.35;
  }
  return out;
}

function cardNodes(model, layer, i) {
  const {id, theme} = model;
  const c = model.content;
  const {w, h} = c.card;
  const drawn = layer.kind !== 'image';
  const kids = [el('div', null, abs(0, 0, w, h, {background: drawn ? c.paper : theme.bg}))];
  if (layer.kind === 'image') kids.push(el('img', null, abs(0, 0, w, h, {objectFit: layer.fit, display: 'block'}), [], {src: layer.image, alt: ''}));
  else kids.push(...(layer.kind === 'storyboard' ? storyboardSheet(model, layer) : styleSheet(model)));
  // The finished shot plays on the top layer.
  if (i === c.layers.length - 1) for (const [j, f] of c.play.entries()) kids.push(el('img', `${id}-f${j}`, abs(0, 0, w, h, {objectFit: 'cover', display: 'block', opacity: 0}), [], {src: f.src, alt: ''}));
  kids.push(el('div', `${id}-L${i}-edge`, {...abs(0, 0, w, h), boxSizing: 'border-box', border: `${c.edgeW}px solid ${c.edge}`, opacity: 0}));
  return kids;
}

function layerView(model) {
  const {id, fonts, theme} = model;
  const c = model.content;
  const {x, y, w, h} = c.card;
  const full = extra => ({...abs(x, y, w, h), transformOrigin: '50% 50%', ...extra});
  const layers = c.layers.map((layer, i) => el('div', `${id}-L${i}`, full(), [
    el('div', `${id}-L${i}-sq`, abs(0, 0, w, h, {transformOrigin: '50% 50%'}), [
      el('div', `${id}-L${i}-rot`, abs(0, 0, w, h, {transformOrigin: '50% 50%', overflow: 'hidden'}), cardNodes(model, layer, i))])]));
  const stage = el('div', `${id}-cam`, full(), [el('div', `${id}-shake`, abs(0, 0, w, h, {transformOrigin: '50% 50%'}), layers.map(node => ({...node, style: {...node.style, left: 0, top: 0}})))]);
  const scrim = el('div', `${id}-scrim`, abs(x, y, w, h, {background: theme.bg, opacity: 0}));
  const R = model.rect;
  const words = el('div', `${id}-hook`, abs(0, 0, R.width, R.height, {display: 'flex', alignItems: 'center', justifyContent: 'center'}), [
    el('div', null, {width: '92%', textAlign: 'center', fontFamily: fonts.display, fontSize: c.hook.size, lineHeight: '1.05', color: theme.foreground, whiteSpace: 'normal'},
      c.hook.words.flatMap((w, i) => [...(i ? [' '] : []), el('span', `${id}-w${i}`, {display: 'inline-block', opacity: 0, transformOrigin: '50% 80%'}, [w.word])]))]);
  const pay = el('div', null, abs(0, 0, R.width, R.height, {display: 'flex', alignItems: 'center', justifyContent: 'center'}), [
    el('div', `${id}-payoff`, {width: '92%', textAlign: 'center', fontFamily: fonts.display, fontSize: c.payoff.size, lineHeight: '1.05', color: theme.foreground, whiteSpace: 'normal', opacity: 0, transformOrigin: '50% 50%'}, [c.payoff.text])]);
  const labels = c.labels.flatMap(l => [el('div', `${id}-l${l.i}`, abs(l.x, l.y, c.colW, c.lineH, {opacity: 0}), [
    label(null, 0, 0, c.colW, l.num, {size: c.numSize, family: fonts.meta, color: c.numColor, lineHeight: 1.3, spacing: '0.06em'}),
    label(null, 0, r2(c.numSize * 1.3), c.colW, l.text, {size: c.labelSize, family: fonts.body, color: theme.foreground, weight: 650, lineHeight: 1.25})])]);
  return [stage, scrim, words, pay, ...labels];
}

// ---------------------------------------------------------------------------
// Timeline

function layerTimeline(model, ops) {
  const {id, start, unit: u, fps} = model;
  const c = model.content, B = c.beats;
  const n = c.layers.length, flat = {scaleX: 1, scaleY: 1}, iso = {scaleX: c.k, scaleY: r2(c.k * SQUASH)};
  const home = {x: 0, y: 0}, aside = {x: c.cam.x, y: c.cam.y};

  // Hook: each word pops on its beat over a scrim; all clear on the play beat.
  set(ops, `${id}-scrim`, start, {opacity: 0});
  tw(ops, `${id}-scrim`, B.hook, 0.3, 'power2.out', {opacity: 0}, {opacity: SCRIM});
  for (const [i, w] of c.hook.words.entries()) {
    const from = {opacity: 0, y: r2(36 * u), scaleX: 0.6, scaleY: 0.6};
    set(ops, `${id}-w${i}`, start, from);
    tw(ops, `${id}-w${i}`, w.at, 0.35, 'power3.out', from, {opacity: 1, y: 0, scaleX: 1, scaleY: 1});
    tw(ops, `${id}-w${i}`, rt(B.play - 0.18), 0.18, 'power2.in', {opacity: 1}, {opacity: 0});
    set(ops, `${id}-w${i}`, sampleTime(B.play), from);
  }
  tw(ops, `${id}-scrim`, rt(B.play - 0.18), 0.18, 'power2.in', {opacity: SCRIM}, {opacity: 0});

  // Play: the frames of the finished shot, each on until the next.
  for (const [j, f] of c.play.entries()) {
    set(ops, `${id}-f${j}`, start, {opacity: 0});
    set(ops, `${id}-f${j}`, sampleTime(f.at), {opacity: 1});
    set(ops, `${id}-f${j}`, sampleTime(j + 1 < c.play.length ? c.play[j + 1].at : B.tilt), {opacity: 0});
  }

  // Tilt into the stack (slow → fast → slow, no overshoot).
  const tilt = 0.5, settle = 0.45;
  const push = {scaleX: PUSH, scaleY: PUSH};
  set(ops, `${id}-cam`, start, {...home, ...push});
  tw(ops, `${id}-cam`, start, rt(B.play - start), 'sine.inOut', push, flat);
  set(ops, `${id}-shake`, start, {x: 0, y: 0});
  tw(ops, `${id}-cam`, B.tilt, tilt, 'power2.inOut', home, aside);
  // The hold starts as the last layer lands.
  const held = rt(B.apart + (n - 2) * B.beat + 0.45), holdLen = rt(B.snap - 0.35 - held), labelLen = rt(B.snap - 0.6 - held);
  for (let i = 0; i < n; i++) {
    set(ops, `${id}-L${i}`, start, {x: 0, y: 0});
    set(ops, `${id}-L${i}-sq`, start, flat);
    set(ops, `${id}-L${i}-rot`, start, {rotation: 0});
    set(ops, `${id}-L${i}-edge`, start, {opacity: 0});
    tw(ops, `${id}-L${i}-sq`, B.tilt, tilt, 'power3.inOut', flat, iso);
    tw(ops, `${id}-L${i}-rot`, B.tilt, tilt, 'power3.inOut', {rotation: 0}, {rotation: TURN});
    tw(ops, `${id}-L${i}-edge`, B.tilt, tilt, 'power1.out', {opacity: 0}, {opacity: 1});
    // Apart: the top layer lifts first, one layer a beat, each easing into its slot.
    if (i > 0) tw(ops, `${id}-L${i}`, rt(B.apart + (n - 1 - i) * B.beat), 0.45, 'power3.out', {y: 0}, {y: c.offsets[i]});
    // Snap: every layer winds up and lands on the snap beat together.
    const spread = {y: r2(c.offsets[i] * SPREAD)};
    if (i > 0) tw(ops, `${id}-L${i}`, held, holdLen, 'power1.inOut', {y: c.offsets[i]}, spread);
    if (i > 0) tw(ops, `${id}-L${i}`, rt(B.snap - 0.35), 0.35, 'power3.in', spread, {y: 0});
    tw(ops, `${id}-L${i}-sq`, B.snap, settle, 'power3.out', iso, flat);
    tw(ops, `${id}-L${i}-rot`, B.snap, settle, 'power3.out', {rotation: TURN}, {rotation: 0});
    tw(ops, `${id}-L${i}-edge`, B.snap, rt(settle - 0.1), 'power1.in', {opacity: 1}, {opacity: 0});
  }
  for (const l of c.labels) {
    const from = {opacity: 0, x: r2(24 * u), y: 0};
    set(ops, `${id}-l${l.i}`, start, from);
    tw(ops, `${id}-l${l.i}`, l.at, 0.35, 'power3.out', from, {opacity: 1, x: 0});
    // Follows its layer through the drift and the spread.
    tw(ops, `${id}-l${l.i}`, held, labelLen, 'power1.inOut', {y: 0}, {y: r2((DRIFT * SPREAD - 1) * c.offsets[l.i])});
    tw(ops, `${id}-l${l.i}`, rt(B.snap - 0.6), 0.2, 'power1.in', {opacity: 1}, {opacity: 0});
    set(ops, `${id}-l${l.i}`, sampleTime(B.snap), from);
  }
  // The hold drifts in a touch, and is back by the snap.
  const drift = {scaleX: DRIFT, scaleY: DRIFT};
  tw(ops, `${id}-cam`, held, holdLen, 'power1.inOut', flat, drift);
  tw(ops, `${id}-cam`, rt(B.snap - 0.35), 0.35, 'power2.in', drift, flat);
  tw(ops, `${id}-cam`, B.snap, settle, 'power2.inOut', aside, home);
  tw(ops, `${id}-cam`, rt(B.snap + settle), rt(start + B.end - 0.1 - B.snap - settle), 'sine.inOut', flat, push);
  // Impact: a short, decaying shake.
  const t0 = B.snap, t1 = rt(B.snap + SHAKE.duration);
  for (const s of frameSamples(t0, t1, fps, t => {
    const k = (t - t0) / SHAKE.duration, amp = t >= t1 - 1e-9 ? 0 : SHAKE.amp * u * Math.exp(-SHAKE.decay * (t - t0)) * (1 - k);
    return {x: r2(amp * Math.sin(2 * Math.PI * SHAKE.freq * (t - t0))), y: r2(0.6 * amp * Math.cos(2 * Math.PI * SHAKE.freq * 1.3 * (t - t0)))};
  })) set(ops, `${id}-shake`, sampleTime(s.t), {x: s.x, y: s.y});
  set(ops, `${id}-shake`, sampleTime(t1), {x: 0, y: 0});

  // Payoff over the settled frame; clear before the end, so the last frame is the first.
  const pop = {opacity: 0, scaleX: 0.7, scaleY: 0.7};
  set(ops, `${id}-payoff`, start, pop);
  tw(ops, `${id}-scrim`, B.payoff, 0.25, 'power2.out', {opacity: 0}, {opacity: SCRIM});
  tw(ops, `${id}-payoff`, B.payoff, 0.4, 'power3.out', pop, {opacity: 1, scaleX: 1, scaleY: 1});
  tw(ops, `${id}-payoff`, B.clear, 0.25, 'power2.in', {opacity: 1, scaleX: 1, scaleY: 1}, {opacity: 0, scaleX: 1.04, scaleY: 1.04});
  tw(ops, `${id}-scrim`, B.clear, 0.3, 'power2.in', {opacity: SCRIM}, {opacity: 0});
  // Every element back in its opening state (the invisible ones too), so the seam check can be exact.
  set(ops, `${id}-payoff`, sampleTime(rt(B.clear + 0.3)), pop);
}

export const layerStackModule = {
  id: 'layer-stack',
  describe: 'The breakdown reel in one 20-beat scene: the finished shot with a hook landing word by word on the beat, the shot playing, then the frame tilting into an isometric stack whose layers (the project\'s own artefacts, final on top) peel apart one a beat with labels, snap back on a beat with a shake, and settle under a payoff line on the opening frame, so it loops.',
  params: {hook: 'string ≤ 48, at most 6 words (lands over beats 0–2)', payoff: 'string ≤ 48 (beats 17–19)',
    layers: `[{label ≤ 18, kind?: ${LAYER_KINDS.join(' | ')} (default image), image (image layers: assets/… still), fit?: cover | contain, panels (storyboard layers: [string ≤ 40] 2–6)}] 2–${MAX_LAYERS}, bottom first; the last is the finished shot (an image)`,
    play: `[assets/… still] 2–${MAX_PLAY_FRAMES} (optional): frames of the finished shot, played over beats 3–6 and ending on the top layer's image`,
    bpm: '90–160 (default 120); the scene is at least 20 beats', rect: '{x, y, width, height} canvas px inside the safe zone (optional; labels and words keep inside it, the layers fill the frame)'},
  events: ['hook', 'play', 'explode', 'snap', 'payoff'], variants: ['default'],
  timing: timingRules({rules: ['the scene is at least 20 beats at params.bpm (10 s at 120); after beat 20 it holds the opening frame', 'hook 0–3, play 3–6, tilt 6, one layer a beat from 7, snap 16, payoff 17–19, clear by 20']}),
  resolve: layerResolve, view: layerView, timeline: layerTimeline
};

export const LAYER_MODULES = [layerStackModule];

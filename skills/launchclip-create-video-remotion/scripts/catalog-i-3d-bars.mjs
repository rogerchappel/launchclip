// Catalogue I 3D data objects, bars: glass-bars-3d (extruded glass bars with
// value labels, or a staircase line-up of descending steps with a score
// marker hopping between them) and coin-stack (stacks of coins or glass
// cylinders sized by value, dropping in). Drawn on the CSS 3D rig in
// kit/core/catalog-i-3d-base.mjs; registered in kit/core/catalog-i-3d.mjs.

import {timingRules} from './catalog-b-base.mjs';
import {hex2} from './catalog-b-view.mjs';
import {VARIANT_PARAM, FORMAT_PARAM, createHBase, numberFormat, r2, rt, textWidth, toneColor} from './catalog-h-base.mjs';
import {chromeNodes, chromeOps, countOps, countSamples, el, abs, label, riseOps, set, tw} from './catalog-h-view.mjs';
import {ORBIT_PARAM, at3d, billboard, boxFaces, camera, cueTime, faceScale, fitScene, fitSize, floorGlow, glassFaces, group, itemIndex, minScale, orbitOf, project, rect3d, rigNodes, rigOps, sceneBox, slot, stand, up2} from './catalog-i-3d-base.mjs';

// ---------------------------------------------------------------------------
// glass-bars-3d

const BAR_VARIANTS = Object.freeze(['bars', 'staircase']);
const BAR_WORLD = {bars: {w: 100, gap: 46, d: 86, hMax: 340, tilt: 70, heading: 0}, staircase: {w: 170, gap: 0, d: 100, hMax: 300, tilt: 65, heading: -9}};

function barsResolve(params, ctx) {
  const b = createHBase('glass-bars-3d', params, ctx, {allowed: ['data', 'format', 'highlight', 'highlightAt', 'marker', 'reference', 'tone', 'highlightTone', 'orbit', 'title', 'source', 'at'], required: ['data'], variants: BAR_VARIANTS});
  const {check, u} = b;
  const p = b.params;
  const stairs = b.variant === 'staircase';
  check.arr(p.data, 'params.data', 2, 6);
  const fmt = numberFormat(check, p.format, 'params.format');
  const items = p.data.map((row, i) => {
    const path = `params.data[${i}]`;
    check.obj(row, path, ['label', 'value', 'display'], ['label', 'value']);
    const value = check.num(row.value, `${path}.value`, 0, 1e12);
    return {label: check.str(row.label, `${path}.label`, 24), value, display: row.display === undefined ? null : check.str(row.display, `${path}.display`, 10)};
  });
  const n = items.length;
  const tone = toneColor(b, p.tone, 'params.tone', 'accent');
  const hiTone = toneColor(b, p.highlightTone, 'params.highlightTone', 'primary');
  const highlight = p.highlight === undefined ? null : itemIndex(check, p.highlight, 'params.highlight', items);
  if (p.highlightAt !== undefined && highlight === null) check.fail('params.highlightAt', 'needs params.highlight');
  if (p.marker !== undefined && !stairs) check.fail('params.marker', 'is drawn by the staircase variant only');
  if (p.reference !== undefined && stairs) check.fail('params.reference', 'is drawn by the bars variant only');
  let marker = null;
  if (p.marker !== undefined) {
    check.obj(p.marker, 'params.marker', ['text', 'label', 'steps', 'at'], ['text', 'steps']);
    check.arr(p.marker.steps, 'params.marker.steps', 1, 4);
    const steps = p.marker.steps.map((s, i) => itemIndex(check, s, `params.marker.steps[${i}]`, items));
    if (p.marker.at !== undefined) { check.arr(p.marker.at, 'params.marker.at', steps.length, steps.length); }
    marker = {text: check.str(p.marker.text, 'params.marker.text', 12), label: p.marker.label === undefined ? null : check.str(p.marker.label, 'params.marker.label', 24), steps, at: p.marker.at};
  }
  const max = Math.max(...items.map(item => item.value));
  if (!(max > 0)) check.fail('params.data', 'needs at least one value above 0');
  let reference = null;
  if (p.reference !== undefined) {
    check.obj(p.reference, 'params.reference', ['value', 'label'], ['value']);
    reference = {value: check.num(p.reference.value, 'params.reference.value', 0, max), label: p.reference.label === undefined ? null : check.str(p.reference.label, 'params.reference.label', 12)};
  }

  const box = sceneBox(b, p);
  const world = BAR_WORLD[b.variant];
  const ranks = items.map((item, i) => items.filter((o, j) => o.value > item.value || (o.value === item.value && j < i)).length);
  // Staircase steps run from lo (the shortest, tall enough for its text) to hi by rank.
  let lo = world.hMax * 0.38, hi = world.hMax;
  const heightOf = i => stairs ? lo + (hi - lo) * (n - 1 - ranks[i]) / Math.max(1, n - 1) : world.hMax * Math.max(0.035, items[i].value / max);
  const cam = camera({tilt: world.tilt, perspective: r2(3.2 * Math.max(box.W, box.H)), orbit: orbitOf(check, p.orbit, stairs ? 10 : 14, world.heading), zoom: [1, 1.05]});
  const texts = items.map(item => item.display ?? fmt.format(item.value));

  // Label sizes: preferred, then raised so the smallest projection keeps key text.
  // Hero sizes: values read from across the room, names on one line over wide bars.
  const prefValue = u(b.portrait ? 92 : 84), prefName = u(b.portrait ? 50 : 46);
  const labelGap = u(22);
  const refSize = r2(Math.max(b.min.meta, u(34)));
  let sizes = items.map(() => ({value: prefValue, name: prefName, lines: 1}));
  let stepW = world.w;
  const geometry = k => {
    const pitch = (stepW + world.gap * stepW / world.w) * k;
    // Wide bars stay fairly shallow: their tops would otherwise take the height the bars need.
    return items.map((item, i) => ({x: (i - (n - 1) / 2) * pitch, w: stepW * k, h: heightOf(i) * k, d: world.d * (stairs ? 1 : Math.min(1.35, stepW / world.w)) * k}));
  };
  const labelBox = i => {
    const s = sizes[i];
    if (stairs) return null;
    const w = Math.max(textWidth(texts[i], s.value, 'display'), ...[items[i].label].map(t => textWidth(t, s.name, 'body') / s.lines)) + u(16);
    return {w, h: s.name * 1.2 * s.lines + s.value * 1.08 + u(14)};
  };
  // The score marker's chip, at its nominal size (the fit needs its box).
  const chip = marker ? (() => {
    const textSize = Math.max(b.min.key, u(b.portrait ? 64 : 56)), labelSize = marker.label ? Math.max(b.min.key, u(b.portrait ? 44 : 34)) : 0;
    const w = Math.max(textWidth(marker.text, textSize, 'display') + textSize * 0.9, marker.label ? textWidth(marker.label, labelSize, 'body') : 0) + u(40);
    return {textSize, labelSize, w, h: textSize * 1.25 + labelSize * 1.2 + u(24)};
  })() : null;
  const lift = u(70);
  const build = k => {
    const bars = geometry(k);
    const points = [];
    for (const bar of bars) for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const z of [0, bar.h]) points.push([bar.x + sx * bar.w / 2, sy * bar.d / 2, z]);
    const labels = [];
    bars.forEach((bar, i) => { const lb = labelBox(i); if (lb) labels.push({at: [bar.x, 0, bar.h + labelGap], w: lb.w, h: lb.h, ax: 0.5, ay: 1}); });
    // The reference label faces the camera at the dashed line's right end.
    if (reference?.label) {
      // The dashed line ends 0.7 bar widths past the last bar's centre.
      const right = bars.at(-1).x + bars.at(-1).w * 0.7 + u(10);
      labels.push({at: [right, bars[0].d / 2, world.hMax * k * reference.value / max], w: textWidth(reference.label, refSize, 'meta') + u(36), h: refSize * 1.5, ax: 0, ay: 0.5});
    }
    if (marker) {
      const top = Math.max(...bars.map(bar => bar.h)) + lift;
      for (const s of marker.steps) labels.push({at: [bars[s].x, 0, top], w: chip.w * 1.08, h: chip.h * 1.08, ax: 0.5, ay: 1});
    }
    return {points, labels};
  };
  let fit = fitScene(cam, box.W, box.avail, build, {centre: box.centre});
  // A height-limited frame gets wide bars rather than empty sides: two or
  // three bars span most of the rect, more stay slimmer.
  const spread = n <= 2 ? 3.2 : n === 3 ? 2.6 : n === 4 ? 2.2 : 1.6;
  const widen = () => {
    for (let i = 0; i < 4 && !stairs && fit.bounds.w < box.W * 0.86 && stepW < world.w * spread - 1e-6; i++) {
      stepW = Math.min(world.w * spread, stepW * box.W * 0.9 / fit.bounds.w);
      fit = fitScene(cam, box.W, box.avail, build, {centre: box.centre});
    }
  };
  widen();
  let bars = geometry(fit.k);
  // Text: fit each label to its bar pitch at its smallest projected scale.
  const pitch = bars.length > 1 ? bars[1].x - bars[0].x : bars[0].w * 2;
  let minText = Infinity;
  if (!stairs) {
    sizes = items.map((item, i) => {
      const s = minScale(cam, [bars[i].x, 0, bars[i].h]);
      const room = pitch * s * 0.96;
      const name = fitSize(check, `params.data[${i}].label`, item.label, {family: 'body', width: room, preferred: prefName * s, min: b.min.key, maxLines: 2});
      const value = fitSize(check, `params.data[${i}].value`, texts[i], {family: 'display', width: room, preferred: prefValue * s, min: b.min.key});
      return {value: up2(value.size / s), name: up2(name.size / s), lines: name.lines, scale: s};
    });
    fit = fitScene(cam, box.W, box.avail, build, {centre: box.centre});
    widen();
    bars = geometry(fit.k);
    items.forEach((item, i) => {
      const s = minScale(cam, [bars[i].x, 0, bars[i].h]);
      sizes[i].scale = s;
      sizes[i].name = Math.max(sizes[i].name, up2(b.min.key / s));
      sizes[i].value = Math.max(sizes[i].value, up2(b.min.key / s));
      minText = Math.min(minText, sizes[i].name * s, sizes[i].value * s);
    });
  } else for (let pass = 0; pass < 12; pass++) {
    // A frame with room to spare across (landscape) gets wider steps.
    if (fit.bounds.w < box.W * 0.9 && stepW < world.w * 2.6) {
      stepW = Math.min(world.w * 2.6, stepW * box.W * 0.94 / fit.bounds.w);
      fit = fitScene(cam, box.W, box.avail, build, {centre: box.centre});
      bars = geometry(fit.k);
    }
    // Steps wide enough for every name on one line (two lines would make the
    // shortest step, and so the whole staircase, taller than the frame).
    const wantW = Math.max(...items.map((item, i) => {
      const fs = faceScale(cam, [bars[i].x, bars[i].d / 2, bars[i].h]);
      return (Math.max(textWidth(item.label, b.min.key, 'body'), textWidth(texts[i], b.min.key, 'display')) / (fs * 0.98) + 2 * u(14) + u(6)) / fit.k;
    }));
    if (wantW > stepW + 1e-6 && stepW < world.w * 3.4) {
      stepW = Math.min(world.w * 3.4, wantW * 1.02);
      fit = fitScene(cam, box.W, box.avail, build, {centre: box.centre});
      bars = geometry(fit.k);
    }
    // Staircase: price and name on each step's front face, top left. A step
    // too narrow for its text widens; the shortest step grows until its text
    // fits; then the scene refits.
    let need = 0, narrow = false;
    minText = Infinity;
    const last = pass === 11;
    const fitOr = (path, text, opts) => {
      try { return fitSize(check, path, text, opts); } catch (error) { if (last || stepW >= world.w * 3.4) throw error; narrow = true; return {size: b.min.key, lines: opts.maxLines ?? 1}; }
    };
    sizes = items.map((item, i) => {
      const fs = faceScale(cam, [bars[i].x, bars[i].d / 2, bars[i].h]);
      const room = (bars[i].w - 2 * u(14)) * fs * 0.98;
      const value = fitOr(`params.data[${i}].value`, texts[i], {family: 'display', width: room, preferred: u(b.portrait ? 70 : 62), min: b.min.key});
      const name = fitOr(`params.data[${i}].label`, item.label, {family: 'body', width: room, preferred: u(b.portrait ? 44 : 34), min: b.min.key, maxLines: 2});
      need = Math.max(need, (value.size * 1.1 + name.size * 1.2 * name.lines + u(34)) / fs / fit.k);
      minText = Math.min(minText, value.size, name.size);
      return {value: up2(value.size / fs), name: up2(name.size / fs), lines: name.lines, scale: fs};
    });
    if (!narrow && need <= lo + 1e-6) break;
    if (last) check.fail('params.data', 'the shortest step is too short for its price and name; use fewer steps or shorter names');
    if (narrow) stepW = Math.min(world.w * 3.4, stepW * 1.15);
    if (need > lo) { lo = need * 1.04; hi = Math.max(world.hMax, lo * 1.45); }
    fit = fitScene(cam, box.W, box.avail, build, {centre: box.centre});
    bars = geometry(fit.k);
  }

  // Timing
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const grow = 0.75, step = Math.min(0.14, 0.9 / Math.max(1, n - 1));
  const buildEnd = rt(buildAt + step * (n - 1) + grow);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: buildEnd, role: 'emphasis', cue: 'whoosh-soft'});
  const settled = buildEnd - b.start;
  let highlightAt = null;
  if (highlight !== null) {
    highlightAt = cueTime(b, 'highlight', p.highlightAt, 'params.highlightAt', settled + 0.35, settled);
    b.events.push({id: `${b.id}-highlight`, name: 'highlight', time: highlightAt, endTime: rt(highlightAt + 0.6), role: 'emphasis', cue: 'hit-soft'});
  }
  const bk = fit.k;
  const out = bars.map((bar, i) => ({...bar, x: r2(bar.x), w: r2(bar.w), d: r2(bar.d), h: r2(bar.h), time: rt(buildAt + i * step), text: texts[i], label: items[i].label, value: items[i].value, display: items[i].display, size: sizes[i],
    samples: items[i].display ? null : countSamples(b.model, rt(buildAt + i * step), grow, 'power3.out', 0, items[i].value, fmt.format)}));
  let markerOut = null;
  if (marker) {
    const top = r2(Math.max(...out.map(bar => bar.h)) + lift);
    const first = settled + 0.25, last = Math.max(first, b.lastEvent - 0.3);
    const gap = marker.steps.length > 1 ? Math.min(1.1, (last - first) / (marker.steps.length - 1)) : 0;
    const ms = Math.min(...marker.steps.map(s => minScale(cam, [out[s].x, 0, top])));
    const textSize = up2(chip.textSize / ms), labelSize = up2(chip.labelSize / ms);
    const hops = marker.steps.map((s, k) => {
      const time = cueTime(b, `marker-${k}`, marker.at?.[k], `params.marker.at[${k}]`, first + k * gap, settled);
      b.events.push({id: `${b.id}-marker-${k}`, name: `marker-${k}`, time, endTime: rt(time + 0.5), role: 'emphasis', cue: k === 0 ? 'pop' : 'tick'});
      // The leader's length in the billboard plane: the screen gap from the chip to the step top over the chip's scale.
      const a = projectMid(cam, [out[s].x, 0, top]), c = projectMid(cam, [out[s].x, 0, out[s].h]);
      return {step: s, x: out[s].x, time, leader: r2(Math.max(u(12), (c.y - a.y) / a.s))};
    });
    markerOut = {text: marker.text, label: marker.label, top, textSize, labelSize, hops, leaderMax: Math.max(...hops.map(h => h.leader)), width: r2(chip.w / ms)};
    minText = Math.min(minText, b.min.key);
  }
  const content = {variant: b.variant, title: box.tb.title, source: box.tb.source, align: 'center', cam, W: box.W, H: box.H, k: bk, bars: out, tone, hiTone, highlight, highlightAt, marker: markerOut,
    reference: reference ? {...reference, h: r2(world.hMax * fit.k * reference.value / max), size: up2(refSize / Math.min(1, minScale(cam, [bars.at(-1).x + bars.at(-1).w * 0.7 + u(10), bars[0].d / 2, world.hMax * fit.k * reference.value / max])))} : null, buildAt, buildEnd, grow, labelGap: r2(labelGap), ink: b.theme.foreground, muted: b.theme.muted};
  return b.finish(content, {minTextPx: r2(Math.min(minText, box.tb.title ? box.tb.title.size : Infinity))});
}

/** project() at the middle of the orbit and zoom (leader lengths, label placement). */
function projectMid(cam, point) {
  const st = {theta: (cam.orbit[0] + cam.orbit[1]) / 2, zoom: (cam.zoom[0] + cam.zoom[1]) / 2};
  return projectAt(cam, point, st);
}
const projectAt = (cam, point, st) => project(cam, point, st.theta, st.zoom, [0, 0], cam.zoomCentre);

function barsView(model) {
  const {id, fonts, unit: u, theme} = model;
  const c = model.content;
  const stairs = c.variant === 'staircase';
  const floor = [];
  const spanX = c.bars.at(-1).x - c.bars[0].x + c.bars[0].w * 2;
  floor.push(floorGlow(`${id}-pool`, c.tone, 0, 0, r2(spanX * 1.25), r2(c.bars[0].d * 4.5), 0.26));
  c.bars.forEach((bar, i) => {
    const hi = c.highlight === i;
    const faces = glassFaces(theme, hi ? c.hiTone : c.tone, u, {strength: hi ? 1 : stairs ? 0.42 : 0.45, glow: hi ? 1 : 0});
    const kids = boxFaces(`${id}-b${i}`, {w: bar.w, h: bar.h, d: bar.d}, faces);
    const inner = [group(`${id}-g${i}`, kids)];
    if (stairs) {
      const s = bar.size, pad = r2(14 * u);
      const textBox = el('div', `${id}-ft${i}`, abs(0, 0, r2(bar.w - 2 * pad), r2(bar.h), {opacity: 0}), [
        label(null, 0, 0, r2(bar.w - 2 * pad), bar.text, {size: s.value, family: fonts.display, color: hi ? c.hiTone : theme.foreground, lineHeight: 1.1}),
        label(null, 0, r2(s.value * 1.1), r2(bar.w - 2 * pad), bar.label, {size: s.name, family: fonts.body, color: theme.foreground, weight: 650, wrap: s.lines > 1})
      ]);
      inner.push(el('div', null, abs(r2(-bar.w / 2 + pad), r2(-bar.h + pad), r2(bar.w - 2 * pad), r2(bar.h), {transform: `translateZ(${r2(bar.d / 2 + 1)}px)`, transformOrigin: '0px 0px'}), [textBox]));
    }
    floor.push(slot(null, bar.x, 0, [stand(inner)]));
    if (hi) floor.push(floorGlow(`${id}-hipool`, c.hiTone, bar.x, 0, r2(bar.w * 2.6), r2(bar.d * 2.6), 0.5));
    if (!stairs) {
      const s = bar.size;
      const w = r2(Math.max(textWidth(bar.text, s.value, 'display'), textWidth(bar.label, s.name, 'body') / s.lines) + 16 * u);
      const h = r2(s.name * 1.2 * s.lines + s.value * 1.08 + 14 * u);
      floor.push(billboard(`${id}-bb${i}`, c.cam, [bar.x, 0, r2(bar.h + c.labelGap)], {w, h}, [
        el('div', `${id}-lb${i}`, abs(0, 0, w, h, {opacity: 0}), [
          label(null, 0, 0, w, bar.label, {size: s.name, family: fonts.body, color: theme.foreground, align: 'center', weight: 600, wrap: s.lines > 1, lineHeight: 1.2}),
          label(`${id}-v${i}`, 0, r2(s.name * 1.2 * s.lines + 4 * u), w, bar.display ?? bar.text, {size: s.value, family: fonts.display, color: hi ? c.hiTone : c.tone === theme.accent ? theme.foreground : c.tone, align: 'center', lineHeight: 1.08})
        ])
      ]));
    }
  });
  if (c.reference) {
    const r = c.reference, w = r2(spanX - c.bars[0].w * 0.6);
    const line = el('div', `${id}-ref`, abs(r2(-w / 2), r2(-r.h), w, 0, {borderTop: `${r2(3 * u)}px dashed ${hex2(theme.foreground, 0.75)}`, opacity: 0}));
    floor.push(slot(null, 0, 0, [stand([el('div', null, abs(0, 0, 0, 0, {transform: `translateZ(${r2(c.bars[0].d / 2 + 2)}px)`, transformStyle: 'preserve-3d'}), [line])])]));
    if (r.label) {
      // The label faces the camera at the line's right end, on a dark chip so it reads over the glow.
      const lw = r2(textWidth(r.label, r.size, 'meta') + 28 * u), lh = r2(r.size * 1.5);
      floor.push(billboard(`${id}-refbb`, c.cam, [r2(c.bars.at(-1).x + c.bars.at(-1).w * 0.7 + 10 * u), r2(c.bars[0].d / 2), r.h], {w: lw, h: lh, ax: 0, ay: 0.5}, [
        el('div', `${id}-reft`, abs(0, 0, lw, lh, {opacity: 0, borderRadius: r2(lh / 2), background: hex2(theme.bg, 0.72), border: `${r2(2 * u)}px dashed ${hex2(theme.foreground, 0.5)}`, boxSizing: 'border-box'}), [
          label(null, 0, r2((lh - r.size * 1.2) / 2), lw, r.label, {size: r.size, family: fonts.meta, color: theme.foreground, align: 'center', spacing: '0.06em'})])
      ]));
    }
  }
  if (c.marker) {
    const m = c.marker, w = m.width, chipH = r2(m.textSize * 1.25 + (m.label ? m.labelSize * 1.2 : 0) + 24 * u), h = r2(chipH + m.leaderMax);
    const first = m.hops[0];
    const mark = r2(m.textSize * 0.62);
    floor.push(el('div', `${id}-mk`, abs(first.x, 0, 0, 0, {transformStyle: 'preserve-3d', transformOrigin: '0px 0px'}), [
      billboard(`${id}-mkbb`, c.cam, [0, 0, m.top], {w, h: chipH, ay: 1}, [
        el('div', `${id}-mkin`, abs(0, 0, w, h, {opacity: 0}), [
          el('div', null, abs(r2(12 * u), r2(12 * u + (m.textSize * 1.25 - mark) / 2), mark, mark, {background: c.hiTone, transform: 'rotate(45deg) scale(0.8)', boxShadow: `0 0 ${r2(18 * u)}px ${hex2(c.hiTone, 0.8)}`})),
          label(null, r2(24 * u + mark), r2(12 * u), r2(w - 24 * u - mark), m.text, {size: m.textSize, family: fonts.display, color: theme.foreground, lineHeight: 1.25}),
          ...(m.label ? [label(null, r2(12 * u), r2(12 * u + m.textSize * 1.25), r2(w - 24 * u), m.label, {size: m.labelSize, family: fonts.body, color: theme.muted, weight: 600})] : []),
          el('div', `${id}-mkline`, abs(r2(w / 2 - 1.5 * u), chipH, 0, m.leaderMax, {borderLeft: `${r2(4 * u)}px dashed ${c.hiTone}`, transformOrigin: '50% 0%'}))
        ])
      ])
    ]));
  }
  return [...chromeNodes(model), rigNodes(id, c.cam, c.W, c.H, floor)];
}

function barsTimeline(model, ops) {
  const {id, start, unit: u, motion} = model;
  const c = model.content;
  const stairs = c.variant === 'staircase';
  chromeOps(model, ops);
  const billboards = [...c.bars.map((_, i) => `${id}-bb${i}`).filter(() => !stairs), ...(c.marker ? [`${id}-mkbb`] : []), ...(c.reference?.label ? [`${id}-refbb`] : [])];
  rigOps(ops, id, c.cam, start, motion.enterStart, motion.end, billboards);
  set(ops, `${id}-pool`, start, {opacity: 0});
  tw(ops, `${id}-pool`, c.buildAt, 0.8, 'power1.out', {opacity: 0}, {opacity: 1});
  c.bars.forEach((bar, i) => {
    const g = `${id}-g${i}`;
    set(ops, g, start, {x: 0, y: 0, scaleX: 1, scaleY: 0.001});
    tw(ops, g, bar.time, c.grow, 'power3.out', {scaleY: 0.001}, {scaleY: 1});
    if (stairs) riseOps(ops, `${id}-ft${i}`, start, rt(bar.time + c.grow * 0.6), r2(16 * u), {duration: 0.4});
    else {
      riseOps(ops, `${id}-lb${i}`, start, rt(bar.time + 0.1), r2(18 * u), {duration: 0.4});
      if (bar.samples) countOps(ops, `${id}-v${i}`, start, bar.samples[0].text, bar.samples);
    }
  });
  if (c.highlight !== null) {
    set(ops, `${id}-hipool`, start, {opacity: 0});
    tw(ops, `${id}-hipool`, c.highlightAt, 0.5, 'power2.out', {opacity: 0}, {opacity: 1});
    // Everything else drops back so the lit bar carries the frame.
    c.bars.forEach((bar, i) => {
      if (i === c.highlight) return;
      for (const face of ['back', 'left', 'right', 'top', 'front']) tw(ops, `${id}-b${i}-${face}`, c.highlightAt, 0.45, 'power2.out', {opacity: 1}, {opacity: 0.42});
      const text = stairs ? `${id}-ft${i}` : `${id}-lb${i}`;
      tw(ops, text, c.highlightAt, 0.45, 'power2.out', {opacity: 1}, {opacity: 0.5});
    });
  }
  if (c.reference) {
    set(ops, `${id}-ref`, start, {opacity: 0});
    tw(ops, `${id}-ref`, rt(c.buildEnd - 0.1), 0.45, 'power1.out', {opacity: 0}, {opacity: 1});
    if (c.reference.label) {
      set(ops, `${id}-reft`, start, {opacity: 0});
      tw(ops, `${id}-reft`, rt(c.buildEnd), 0.45, 'power1.out', {opacity: 0}, {opacity: 1});
    }
  }
  if (c.marker) {
    const m = c.marker;
    const ratio = hop => r2(hop.leader / m.leaderMax * 1e4) / 1e4;
    set(ops, `${id}-mk`, start, {x: 0, y: 0});
    set(ops, `${id}-mkline`, start, {x: 0, y: 0, scaleX: 1, scaleY: ratio(m.hops[0])});
    riseOps(ops, `${id}-mkin`, start, m.hops[0].time, r2(-40 * u), {duration: 0.5, ease: 'back.out(1.8)'});
    m.hops.slice(1).forEach((hop, k) => {
      const prev = m.hops[k];
      tw(ops, `${id}-mk`, hop.time, 0.55, 'power3.inOut', {x: r2(prev.x - m.hops[0].x), y: 0}, {x: r2(hop.x - m.hops[0].x), y: 0});
      tw(ops, `${id}-mkline`, hop.time, 0.55, 'power3.inOut', {scaleY: ratio(prev)}, {scaleY: ratio(hop)});
    });
  }
}

export const glassBars3d = {
  id: 'glass-bars-3d',
  describe: 'Extruded glass bars in 3D under a slow orbiting camera: 2–6 values grow in with count-up labels, one bar can glow while the rest drop back, with an optional dashed reference ("half"). The staircase variant lines them up as descending glass steps, price and name on each front face, with a score marker that hops between steps on cue.',
  params: {data: '[{label ≤ 24, value ≥ 0, display? ≤ 10 (the label text instead of the formatted value, "$0.50")}] 2–6; for the staircase list them highest first (step heights follow the rank)',
    format: FORMAT_PARAM, highlight: 'index or label of the bar that glows (optional)', highlightAt: `the highlight: ${at3d}`,
    marker: `staircase only: {text ≤ 12 ("59.3%"), label? ≤ 24, steps: [index or label] 1–4 (the steps it visits, in order), at?: [seconds]} (events marker-<k>)`,
    reference: 'bars only: {value, label? ≤ 12} a dashed level across the bars ("half")', tone: 'glass tone: primary | accent | paper | #rrggbb (default accent)', highlightTone: 'the lit bar\'s tone (default primary)',
    orbit: ORBIT_PARAM, title: 'string ≤ 60 (optional)', source: 'string ≤ 80 (optional)', at: `build start: ${at3d}`, variant: VARIANT_PARAM, rect: rect3d},
  events: ['build', 'highlight', 'marker-0', 'marker-1', 'marker-2', 'marker-3'],
  timing: timingRules({rules: ['bars grow left to right within about 1.6 s from at', 'highlight and marker hops follow the build; the camera orbits for the whole scene']}), variants: BAR_VARIANTS,
  resolve: barsResolve, view: barsView, timeline: barsTimeline
};

export const BAR_MODULES = [glassBars3d];

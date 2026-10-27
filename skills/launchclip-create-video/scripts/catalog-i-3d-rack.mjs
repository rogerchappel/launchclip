// Catalogue I 3D data objects, shelves: rack-shelf (a stacked server shelf
// whose trays are labelled rows, "model · score · price", stacking in while
// the camera dollies in, then one tray slides out toward the viewer), and
// its rail variant (glass cubes gliding along a price rail to their values).
// Drawn on the CSS 3D rig in kit/core/catalog-i-3d-base.mjs; registered in
// kit/core/catalog-i-3d.mjs.

import {ticks, timingRules} from './catalog-b-base.mjs';
import {hex2} from './catalog-b-view.mjs';
import {VARIANT_PARAM, FORMAT_PARAM, createHBase, mixColor, numberFormat, r2, rt, textWidth, toneColor} from './catalog-h-base.mjs';
import {abs, chromeNodes, chromeOps, el, label, riseOps, set, tw} from './catalog-h-view.mjs';
import {iconNode, isIcon} from './icons.mjs';
import {ORBIT_PARAM, at3d, billboard, boxFaces, camera, cueTime, decal, faceScale, faceWidthScale, fitScene, fitSize, floorGlow, glassFaces, group, itemIndex, minScale, orbitOf, rect3d, rigNodes, rigOps, sceneBox, slot, stand, up2} from './catalog-i-3d-base.mjs';

const RACK_VARIANTS = Object.freeze(['rack', 'rail']);
const RACK = {w: 900, d: 250, h: 80, gap: 40, plinth: 20, tilt: 75, heading: -14};
const RAIL = {length: 1500, portraitLength: 1100, portraitCube: 320, d: 70, h: 34, cube: 230, tilt: 70, heading: -8};

function rackResolve(params, ctx) {
  const b = createHBase('rack-shelf', params, ctx, {allowed: ['rows', 'focus', 'focusAt', 'format', 'axis', 'tone', 'orbit', 'title', 'source', 'at'], required: ['rows'], variants: RACK_VARIANTS});
  const {check, u} = b;
  const p = b.params;
  const rail = b.variant === 'rail';
  check.arr(p.rows, 'params.rows', rail ? 1 : 2, rail ? 5 : 6);
  const rows = p.rows.map((row, i) => {
    const path = `params.rows[${i}]`;
    check.obj(row, path, ['label', 'cells', 'icon', 'value'], rail ? ['label', 'value'] : ['label']);
    const cells = row.cells === undefined ? [] : (check.arr(row.cells, `${path}.cells`, 0, rail ? 2 : 3), row.cells.map((cell, j) => check.str(cell, `${path}.cells[${j}]`, 10)));
    if (row.icon !== undefined && !isIcon(row.icon)) check.fail(`${path}.icon`, `must be an icon name from kit/core/icons.mjs (got ${JSON.stringify(row.icon)})`);
    return {label: check.str(row.label, `${path}.label`, 24), cells, icon: row.icon ?? null, value: row.value === undefined ? null : check.num(row.value, `${path}.value`, 0, 1e12)};
  });
  if (p.axis !== undefined && !rail) check.fail('params.axis', 'is the rail variant\'s caption');
  const focus = p.focus === undefined ? null : itemIndex(check, p.focus, 'params.focus', rows);
  if (p.focusAt !== undefined && focus === null) check.fail('params.focusAt', 'needs params.focus');
  const tone = toneColor(b, p.tone, 'params.tone', 'accent');
  const hiTone = b.colors.primary === tone ? b.colors.accent : b.colors.primary;
  const box = sceneBox(b, p);
  return rail ? railLayout(b, p, rows, focus, tone, hiTone, box) : rackLayout(b, p, rows, focus, tone, hiTone, box);
}

/** Front-face text: label (and icon) left, cells in right-aligned columns; sizes shrink together to fit `room` px. */
function rowText(b, rows, room, pref, path) {
  const {check, u} = b;
  for (let label = pref.label, cell = pref.cell; ; label -= 2, cell -= 2) {
    const ls = Math.max(label, b.min.key), cs = Math.max(cell, b.min.key);
    const cols = [0, 1, 2].map(j => Math.max(0, ...rows.map(row => row.cells[j] ? textWidth(row.cells[j], cs, 'display') : 0))).filter(w => w > 0);
    const icon = rows.some(row => row.icon) ? ls * 1.15 + u(16) : 0;
    const need = Math.max(...rows.map(row => textWidth(row.label, ls, 'body'))) + icon + cols.reduce((sum, w) => sum + w + u(40), 0) + u(48);
    if (need <= room) return {label: ls, cell: cs, cols, icon};
    if (ls <= b.min.key && cs <= b.min.key) return check.fail(path, `do not fit across ${Math.round(room)} px at ${b.min.key} px; shorten the labels and cells or use fewer cells`);
  }
}

function rackLayout(b, p, rows, focus, tone, hiTone, box) {
  const {check, u} = b;
  const n = rows.length;
  const cam = camera({tilt: RACK.tilt, perspective: r2(3.2 * Math.max(box.W, box.H)), orbit: orbitOf(check, p.orbit, 8, RACK.heading), zoom: [1, 1.1]});
  let trayH = RACK.h;
  const elevation = i => RACK.plinth + (n - 1 - i) * (trayH + RACK.gap);
  const total = () => RACK.plinth + n * trayH + (n - 1) * RACK.gap;
  const build = k => {
    const points = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const z of [0, total()]) points.push([sx * (RACK.w / 2 + 20) * k, sy * (RACK.d / 2 + 20) * k, z * k]);
    // The slid-out tray reaches toward the viewer.
    if (focus !== null) for (const sx of [-1, 1]) points.push([sx * RACK.w / 2 * k, (RACK.d / 2 + RACK.d * 0.55) * k, elevation(focus) * k]);
    return {points, labels: []};
  };
  let fit, text;
  for (let pass = 0; pass < 6; pass++) {
    fit = fitScene(cam, box.W, box.avail, build, {centre: box.centre});
    const k = fit.k;
    const front = [0, RACK.d / 2 * k, total() * k];
    const ws = faceWidthScale(cam, front), hs = faceScale(cam, front);
    text = rowText(b, rows, RACK.w * k * ws * 0.98, {label: u(b.portrait ? 46 : 40), cell: u(b.portrait ? 50 : 44)}, 'params.rows');
    const need = (Math.max(text.label, text.cell) * 1.3 + u(24)) / hs / k;
    text.ws = ws; text.hs = hs;
    if (need <= trayH + 1e-6) break;
    if (pass === 5) check.fail('params.rows', 'the trays are too thin for their text; use fewer rows');
    trayH = need * 1.03;
  }
  const k = fit.k;
  // Face text is set in face px: screen size over the face's smallest scale.
  const sx = text.ws, sy = text.hs;
  const face = {label: up2(text.label / Math.min(sx, sy)), cell: up2(text.cell / Math.min(sx, sy)), cols: text.cols.map(w => r2(w / sx)), icon: r2(text.icon / sx)};

  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const each = Math.min(0.16, 1.1 / Math.max(1, n - 1)), drop = 0.55;
  // Bottom tray first, so each one lands on the last.
  const order = rows.map((_, i) => n - 1 - i);
  const times = rows.map((_, i) => rt(buildAt + order[i] * each));
  const buildEnd = rt(buildAt + each * (n - 1) + drop);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: buildEnd, role: 'emphasis', cue: 'whoosh-soft'});
  let focusAt = null;
  if (focus !== null) {
    focusAt = cueTime(b, 'focus', p.focusAt, 'params.focusAt', buildEnd - b.start + 0.4, buildEnd - b.start);
    b.events.push({id: `${b.id}-focus`, name: 'focus', time: focusAt, endTime: rt(focusAt + 0.7), role: 'emphasis', cue: 'whoosh'});
  }
  const trays = rows.map((row, i) => ({...row, e: r2(elevation(i) * k), h: r2(trayH * k), time: times[i]}));
  const content = {variant: 'rack', title: box.tb.title, source: box.tb.source, align: 'center', cam, W: box.W, H: box.H, k, w: r2(RACK.w * k), d: r2(RACK.d * k), plinth: r2(RACK.plinth * k), total: r2(total() * k),
    trays, face, focus, focusAt, slide: r2(RACK.d * 0.55 * k), drop, dropH: r2(140 * u), tone, hiTone, buildAt, buildEnd};
  return b.finish(content, {minTextPx: r2(Math.min(text.label, text.cell, box.tb.title ? box.tb.title.size : Infinity))});
}

function railLayout(b, p, rows, focus, tone, hiTone, box) {
  const {check, u} = b;
  const n = rows.length;
  const fmt = numberFormat(check, p.format, 'params.format');
  const axis = p.axis === undefined ? null : check.str(p.axis, 'params.axis', 48);
  const top = Math.max(...rows.map(row => row.value));
  const scale = ticks(0, top > 0 ? top : 1, 5);
  const hi = scale.at(-1);
  const cam = camera({tilt: RAIL.tilt, perspective: r2(3.2 * Math.max(box.W, box.H)), orbit: orbitOf(check, p.orbit, 12, RAIL.heading), zoom: [1, 1.06]});
  const pad = RAIL.cube * 0.6;
  const L = b.portrait ? RAIL.portraitLength : RAIL.length, C = b.portrait ? RAIL.portraitCube : RAIL.cube;
  const xOf = (v, k) => (-L / 2 + pad + (v / hi) * (L - 2 * pad)) * k;
  const sorted = rows.map((row, i) => ({x: xOf(row.value, 1), i})).sort((a, c) => a.x - c.x);
  sorted.slice(1).forEach((s, j) => { if (s.x - sorted[j].x < C * 1.04) check.fail(`params.rows[${s.i}].value`, `sits too close to params.rows[${sorted[j].i}] on the rail for both cubes; use the rack variant or spread the values`); });
  const tickSize = Math.max(b.min.meta, u(b.portrait ? 40 : 34));
  const tickTexts = scale.map(v => fmt.format(v));
  const axisSize = axis ? Math.max(b.min.meta, u(30)) : 0;
  const build = k => {
    const points = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) points.push([sx * L / 2 * k, sy * RAIL.d / 2 * k, 0]);
    for (const row of rows) for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const z of [RAIL.h, RAIL.h + C]) points.push([xOf(row.value, k) + sx * C / 2 * k, sy * C / 2 * k, z * k]);
    const labels = scale.map((v, j) => ({at: [xOf(v, k), (C / 2 + 30) * k, 0], w: textWidth(tickTexts[j], tickSize, 'display') + u(12), h: tickSize * 1.25, ax: 0.5, ay: 0}));
    if (axis) labels.push({at: [0, (C / 2 + 30) * k, 0], w: textWidth(axis, axisSize, 'meta') + u(12), h: tickSize * 1.25 + axisSize * 1.4 + u(10), ax: 0.5, ay: 0});
    return {points, labels};
  };
  const fit = fitScene(cam, box.W, box.avail, build, {centre: box.centre});
  const k = fit.k;
  const cube = C * k;
  let minText = Infinity;
  const cubes = rows.map((row, i) => {
    const x = xOf(row.value, k);
    const front = [x, cube / 2, (RAIL.h * k + cube)];
    const ws = faceWidthScale(cam, front), hs = faceScale(cam, front);
    const room = (cube - 2 * u(16)) * ws * 0.98;
    const name = fitSize(check, `params.rows[${i}].label`, row.label, {family: 'body', width: room, preferred: u(b.portrait ? 44 : 38), min: b.min.key, maxLines: 2});
    const cells = row.cells.map((cell, j) => fitSize(check, `params.rows[${i}].cells[${j}]`, cell, {family: 'display', width: room, preferred: u(j === 0 ? (b.portrait ? 76 : 66) : (b.portrait ? 46 : 40)), min: b.min.key}));
    const need = name.size * 1.2 * name.lines + cells.reduce((sum, c) => sum + c.size * 1.1, 0) + u(30);
    if (need > cube * hs) check.fail(`params.rows[${i}]`, 'has more text than its cube face holds; shorten it or drop a cell');
    minText = Math.min(minText, name.size, ...cells.map(c => c.size));
    const s = Math.min(ws, hs);
    return {...row, x: r2(x), name: {size: up2(name.size / s), lines: name.lines}, cellSizes: cells.map(c => up2(c.size / s))};
  });

  // Cubes glide in from the rail's left end, the farthest first so none passes another.
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const each = Math.min(0.22, 1.2 / Math.max(1, n - 1)), glide = 0.9;
  const order = cubes.map((c, i) => i).sort((a, c) => cubes[c].x - cubes[a].x);
  order.forEach((i, j) => { cubes[i].time = rt(buildAt + 0.35 + j * each); });
  const buildEnd = rt(buildAt + 0.35 + each * (n - 1) + glide);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: buildEnd, role: 'emphasis', cue: 'whoosh-soft'});
  let focusAt = null;
  if (focus !== null) {
    focusAt = cueTime(b, 'focus', p.focusAt, 'params.focusAt', buildEnd - b.start + 0.35, buildEnd - b.start);
    b.events.push({id: `${b.id}-focus`, name: 'focus', time: focusAt, endTime: rt(focusAt + 0.6), role: 'emphasis', cue: 'hit-soft'});
  }
  const tickScale = Math.min(...scale.map(v => minScale(cam, [xOf(v, k), (C / 2 + 30) * k, 0])));
  const content = {variant: 'rail', title: box.tb.title, source: box.tb.source, align: 'center', cam, W: box.W, H: box.H, k, length: r2(L * k), railD: r2(RAIL.d * k), railH: r2(RAIL.h * k), cube: r2(cube),
    start: r2(-L / 2 * k), cubes, ticks: scale.map((v, j) => ({x: r2(xOf(v, k)), text: tickTexts[j]})), tickY: r2((C / 2 + 30) * k), tickSize: up2(tickSize / Math.min(1, tickScale)),
    axis: axis ? {text: axis, size: up2(axisSize / Math.min(1, tickScale))} : null, focus, focusAt, glide, tone, hiTone, buildAt, buildEnd};
  return b.finish(content, {minTextPx: r2(Math.min(minText, box.tb.title ? box.tb.title.size : Infinity))});
}

/** The tray's top: dark glass with vent slots. */
function ventTop(theme, tone, u) {
  const slotC = hex2(tone, 0.18), gapC = hex2(theme.bg, 0.5);
  return {background: `repeating-linear-gradient(90deg, ${slotC} 0px, ${slotC} ${r2(10 * u)}px, ${gapC} ${r2(10 * u)}px, ${gapC} ${r2(16 * u)}px), ${hex2(theme.bg, 0.9)}`,
    border: `${r2(Math.max(1, 1.6 * u))}px solid ${hex2(mixColor(theme.accent, theme.paper, 0.35), 0.7)}`, boxShadow: `inset 0 0 ${r2(26 * u)}px ${hex2(theme.bg, 0.9)}`};
}

/** One front-face text block (icon, label, cells) in face px. */
function rowFace(model, row, face, w, h, color, cellColor) {
  const {fonts, unit: u, theme} = model;
  const pad = r2(24 * u), kids = [];
  const mid = r2(h / 2);
  let x = pad;
  if (row.icon) {
    const s = r2(face.label * 1.15);
    kids.push(iconNode(row.icon, {x, y: r2(mid - s / 2), size: s, color: cellColor, mode: 'duotone', tintOpacity: 0.3}));
    x = r2(x + face.icon);
  }
  kids.push(label(null, x, r2(mid - face.label * 0.62), r2(w - x), row.label, {size: face.label, family: fonts.body, color, weight: 650}));
  let right = r2(w - pad);
  for (let j = face.cols.length - 1; j >= 0; j--) {
    const cw = face.cols[j];
    if (row.cells[j]) kids.push(label(null, r2(right - cw), r2(mid - face.cell * 0.6), cw, row.cells[j], {size: face.cell, family: fonts.display, color: j === face.cols.length - 1 ? cellColor : theme.foreground, align: 'right'}));
    right = r2(right - cw - 40 * u);
  }
  return kids;
}

function rackView(model) {
  const {id, unit: u, theme} = model;
  const c = model.content;
  if (c.variant === 'rail') return railView(model);
  const floor = [floorGlow(`${id}-pool`, c.tone, 0, 0, r2(c.w * 1.5), r2(c.d * 2), 0.28)];
  const plinth = glassFaces(theme, theme.bg, u, {strength: 0.2});
  floor.push(slot(null, 0, 0, [stand(boxFaces(null, {w: r2(c.w + 40 * c.k), h: c.plinth, d: r2(c.d + 40 * c.k)}, {...plinth, top: {background: hex2(c.tone, 0.12), border: plinth.front.border}}))]));
  c.trays.forEach((tray, i) => {
    const hi = c.focus === i;
    const faces = glassFaces(theme, c.tone, u, {strength: 0.35});
    faces.top = ventTop(theme, c.tone, u);
    const textPlane = el('div', null, abs(r2(-c.w / 2), r2(-(tray.e + tray.h)), c.w, tray.h, {transform: `translateZ(${r2(c.d / 2 + 2)}px)`, transformStyle: 'preserve-3d'}), [
      ...(hi ? [el('div', `${id}-glow`, abs(0, 0, c.w, tray.h, {opacity: 0, borderRadius: r2(4 * u), border: `${r2(3 * u)}px solid ${c.hiTone}`, boxShadow: `0 0 ${r2(40 * u)}px ${hex2(c.hiTone, 0.7)}, inset 0 0 ${r2(30 * u)}px ${hex2(c.hiTone, 0.35)}`, boxSizing: 'border-box'}))] : []),
      el('div', `${id}-ft${i}`, abs(0, 0, c.w, tray.h, {opacity: 0}), rowFace(model, tray, c.face, c.w, tray.h, theme.foreground, hi ? c.hiTone : c.tone))
    ]);
    const kids = [...boxFaces(`${id}-t${i}`, {w: c.w, h: tray.h, d: c.d, e: tray.e}, faces), textPlane];
    floor.push(slot(`${id}-s${i}`, 0, 0, [stand([group(`${id}-g${i}`, kids)])]));
  });
  return [...chromeNodes(model), rigNodes(id, c.cam, c.W, c.H, floor)];
}

function railView(model) {
  const {id, fonts, unit: u, theme} = model;
  const c = model.content;
  const floor = [floorGlow(`${id}-pool`, c.tone, 0, 0, r2(c.length * 1.1), r2(c.cube * 2.6), 0.25)];
  const railFaces = glassFaces(theme, c.tone, u, {strength: 0.3});
  railFaces.top = ventTop(theme, c.tone, u);
  floor.push(slot(null, 0, 0, [stand(boxFaces(null, {w: c.length, h: c.railH, d: c.railD}, railFaces))]));
  const mark = r2(Math.max(2, 4 * u)), markL = r2(34 * u);
  c.ticks.forEach((t, j) => {
    floor.push(decal(null, t.x, r2(c.tickY - markL / 2 - 6 * u), mark, markL, {background: hex2(theme.foreground, 0.8), borderRadius: mark}));
    const w = r2(textWidth(t.text, c.tickSize, 'display') + 12 * u), h = r2(c.tickSize * 1.25);
    floor.push(billboard(`${id}-tb${j}`, c.cam, [t.x, c.tickY, 0], {w, h, ay: 0}, [label(`${id}-tl${j}`, 0, 0, w, t.text, {size: c.tickSize, family: fonts.display, color: theme.foreground, align: 'center', extra: {opacity: 0}})]));
  });
  if (c.axis) {
    const w = r2(textWidth(c.axis.text, c.axis.size, 'meta') + 12 * u), h = r2(c.tickSize * 1.25 + c.axis.size * 1.4 + 10 * u);
    floor.push(billboard(`${id}-axb`, c.cam, [0, c.tickY, 0], {w, h, ay: 0}, [label(`${id}-ax`, 0, r2(c.tickSize * 1.25 + 10 * u), w, c.axis.text, {size: c.axis.size, family: fonts.meta, color: theme.muted, align: 'center', spacing: '0.06em', extra: {opacity: 0}})]));
  }
  c.cubes.forEach((cube, i) => {
    const hi = c.focus === i;
    const faces = glassFaces(theme, hi ? c.hiTone : c.tone, u, {strength: hi ? 0.9 : 0.5, glow: hi ? 0.8 : 0});
    const pad = r2(16 * u), w = c.cube;
    const lines = [label(null, 0, 0, r2(w - 2 * pad), cube.label, {size: cube.name.size, family: fonts.body, color: theme.foreground, weight: 650, wrap: cube.name.lines > 1, lineHeight: 1.2})];
    let y = r2(cube.name.size * 1.2 * cube.name.lines);
    cube.cells.forEach((cell, j) => {
      lines.push(label(null, 0, y, r2(w - 2 * pad), cell, {size: cube.cellSizes[j], family: fonts.display, color: j === 0 ? (hi ? c.hiTone : theme.foreground) : theme.muted, lineHeight: 1.1}));
      y = r2(y + cube.cellSizes[j] * 1.1);
    });
    const textPlane = el('div', null, abs(r2(-w / 2 + pad), r2(-(c.railH + w) + pad), r2(w - 2 * pad), r2(w - 2 * pad), {transform: `translateZ(${r2(w / 2 + 1)}px)`, transformStyle: 'preserve-3d'}), [
      el('div', `${id}-ft${i}`, abs(0, 0, r2(w - 2 * pad), r2(w - 2 * pad), {opacity: 0}), lines)]);
    floor.push(slot(`${id}-s${i}`, cube.x, 0, [stand([group(`${id}-g${i}`, [...boxFaces(`${id}-t${i}`, {w, h: w, d: w, e: c.railH}, faces), textPlane])])]));
  });
  return [...chromeNodes(model), rigNodes(id, c.cam, c.W, c.H, floor)];
}

function rackTimeline(model, ops) {
  const {id, start, unit: u, motion} = model;
  const c = model.content;
  chromeOps(model, ops);
  const rail = c.variant === 'rail';
  rigOps(ops, id, c.cam, start, motion.enterStart, motion.end, rail ? [...c.ticks.map((_, j) => `${id}-tb${j}`), ...(c.axis ? [`${id}-axb`] : [])] : []);
  set(ops, `${id}-pool`, start, {opacity: 0});
  tw(ops, `${id}-pool`, c.buildAt, 0.8, 'power1.out', {opacity: 0}, {opacity: 1});
  const items = rail ? c.cubes : c.trays;
  items.forEach((item, i) => {
    const g = `${id}-g${i}`;
    set(ops, g, start, {x: 0, y: 0, scaleX: 0.001, scaleY: 0.001});
    if (rail) {
      // Glide from the rail's left end.
      const from = r2(c.start - item.x);
      set(ops, g, item.time, {scaleX: 1, scaleY: 1, x: from});
      tw(ops, g, item.time, c.glide, 'power3.out', {x: from}, {x: 0});
      riseOps(ops, `${id}-ft${i}`, start, rt(item.time + c.glide - 0.3), r2(12 * u), {duration: 0.4});
    } else {
      set(ops, g, item.time, {scaleX: 1, scaleY: 1, y: -c.dropH});
      tw(ops, g, item.time, c.drop, 'power3.out', {y: -c.dropH}, {y: 0});
      riseOps(ops, `${id}-ft${i}`, start, rt(item.time + 0.3), r2(10 * u), {duration: 0.4});
    }
  });
  if (rail) {
    c.ticks.forEach((_, j) => riseOps(ops, `${id}-tl${j}`, start, rt(c.buildAt + j * 0.06), r2(10 * u), {duration: 0.35}));
    if (c.axis) riseOps(ops, `${id}-ax`, start, rt(c.buildAt + 0.3), r2(10 * u));
  }
  if (c.focus !== null) {
    if (!rail) {
      set(ops, `${id}-s${c.focus}`, start, {x: 0, y: 0});
      tw(ops, `${id}-s${c.focus}`, c.focusAt, 0.8, 'power3.inOut', {y: 0}, {y: c.slide});
      set(ops, `${id}-glow`, start, {opacity: 0});
      tw(ops, `${id}-glow`, rt(c.focusAt + 0.25), 0.5, 'power2.out', {opacity: 0}, {opacity: 1});
    }
    // The rest drops back.
    items.forEach((_, i) => {
      if (i === c.focus) return;
      for (const face of ['back', 'left', 'right', 'top', 'front']) tw(ops, `${id}-t${i}-${face}`, c.focusAt, 0.5, 'power2.out', {opacity: 1}, {opacity: 0.4});
      tw(ops, `${id}-ft${i}`, c.focusAt, 0.5, 'power2.out', {opacity: 1}, {opacity: 0.45});
    });
  }
}

export const rackShelf = {
  id: 'rack-shelf',
  describe: 'A stacked server shelf in 3D: 2–6 glass trays, each a labelled row ("model · score · price") with an optional icon, stack in from the bottom while the camera dollies in, then one tray slides out toward the viewer and lights up. The rail variant glides 1–5 glass cubes (name and price on the face) along a price rail to their values, with ticks and a caption under it.',
  params: {rows: '[{label ≤ 24, cells? [≤ 10 chars] up to 3 (rail: 2, the first set large), icon? (icon name), value? (the cube\'s place on the rail; required by the rail, unused by the rack)}] 2–6 (rail: 1–5)',
    focus: 'index or label of the tray that slides out (rail: the cube that lights) (optional)', focusAt: `the focus: ${at3d}`, format: `rail only: the tick format, ${FORMAT_PARAM}`, axis: 'rail only: a caption under the rail ≤ 48 ("Output price per 1M tokens")',
    tone: 'glass tone: primary | accent | paper | #rrggbb (default accent)', orbit: ORBIT_PARAM, title: 'string ≤ 60 (optional)', source: 'string ≤ 80 (optional)', at: `build start: ${at3d}`, variant: VARIANT_PARAM, rect: rect3d},
  events: ['build', 'focus'], timing: timingRules({rules: ['trays stack in bottom first (cubes glide in) within about 1.7 s from at', 'focus follows the build; the camera dollies in over the whole scene']}), variants: RACK_VARIANTS,
  resolve: rackResolve, view: rackView, timeline: rackTimeline
};

export const RACK_MODULES = [rackShelf];

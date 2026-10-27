// Catalogue I 3D data objects, paper: paper-stack (a stack of labelled
// document sections, "Chapter 3 · pp. 41–77", each getting a check or a red
// flag on its cue; a book-stack variant with titles on the spines; and a 3D
// folder whose front opens on a hinge to reveal its files rising out).
// Drawn on the CSS 3D rig in kit/core/catalog-i-3d-base.mjs; registered in
// kit/core/catalog-i-3d.mjs.

import {timingRules} from './catalog-b-base.mjs';
import {hex2} from './catalog-b-view.mjs';
import {VARIANT_PARAM, createHBase, mixColor, r2, rt, textWidth, toneColor} from './catalog-h-base.mjs';
import {abs, chromeNodes, chromeOps, el, label, popOps, riseOps, set, tw} from './catalog-h-view.mjs';
import {dataTone} from './catalog-h-data.mjs';
import {iconNode} from './icons.mjs';
import {ORBIT_PARAM, at3d, billboard, boxFaces, camera, cueTime, dropIn, faceScale, faceWidthScale, fitScene, floorGlow, glassFaces, group, hinge, minScale, orbitOf, rect3d, rigNodes, rigOps, sceneBox, slot, stand, up2} from './catalog-i-3d-base.mjs';

const PAPER_VARIANTS = Object.freeze(['sections', 'books', 'folder']);
const STATUSES = ['ok', 'flag', 'none'];
const WORLD = {sections: {w: 760, d: 480, t: 40, tilt: 64, heading: -12}, books: {w: 700, d: 470, t: 46, tilt: 66, heading: -10}, folder: {w: 1000, h: 400, tilt: 74, heading: -12}};
// Books: a fixed, gentle twist and size per book, so the stack looks hand-made but renders the same every time.
const TWIST = [0, 1.2, -1, 1.5, -1.2, 0.8, -0.8];
const SPREAD = [1, 0.93, 1.05, 0.9, 0.98, 1.02, 0.95];

function paperResolve(params, ctx) {
  const b = createHBase('paper-stack', params, ctx, {allowed: ['items', 'tone', 'openAt', 'orbit', 'title', 'source', 'at'], required: ['items'], variants: PAPER_VARIANTS});
  const {check, u} = b;
  const p = b.params;
  const folder = b.variant === 'folder';
  check.arr(p.items, 'params.items', folder ? 1 : 2, folder ? 5 : 7);
  const items = p.items.map((item, i) => {
    const path = `params.items[${i}]`;
    check.obj(item, path, ['label', 'detail', 'status', 'size', 'at'], ['label']);
    return {label: check.str(item.label, `${path}.label`, 28), detail: item.detail === undefined ? null : check.str(item.detail, `${path}.detail`, 14),
      status: item.status === undefined ? 'none' : check.oneOf(item.status, `${path}.status`, STATUSES), size: item.size === undefined ? 1 : check.num(item.size, `${path}.size`, 0.5, 4), at: item.at};
  });
  if (p.openAt !== undefined && !folder) check.fail('params.openAt', 'opens the folder variant');
  const tone = toneColor(b, p.tone, 'params.tone', 'accent');
  const colors = {ok: dataTone(b, 'good', 'params.items'), flag: dataTone(b, 'bad', 'params.items')};
  const box = sceneBox(b, p);
  const world = WORLD[b.variant];
  const cam = camera({tilt: world.tilt, perspective: r2(3 * Math.max(box.W, box.H)), orbit: orbitOf(check, p.orbit, 10, b.portrait ? world.heading / 2 : world.heading), zoom: [1, 1.06]});
  const labelSize = Math.max(b.min.key, u(b.portrait ? 46 : 40)), detailSize = Math.max(b.min.meta, u(b.portrait ? 32 : 28));
  const iconSize = r2(labelSize * 1.1);
  const n = items.length;
  const out = folder ? folderLayout(b, items, cam, box, world, {labelSize, detailSize, iconSize}) : stackLayout(b, items, cam, box, world, {labelSize, detailSize, iconSize});

  // Timing: the stack lands (or the folder lands and opens), then each status on its cue.
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const each = Math.min(0.14, 1 / Math.max(1, n - 1));
  let ready;
  if (folder) {
    const openAt = cueTime(b, 'open', p.openAt, 'params.openAt', buildAt - b.start + 0.8, buildAt - b.start + 0.6);
    b.events.push({id: `${b.id}-open`, name: 'open', time: openAt, endTime: rt(openAt + 0.8), role: 'emphasis', cue: 'whoosh-soft'});
    out.items.forEach((item, i) => { item.time = rt(openAt + 0.35 + i * 0.15); });
    out.openAt = openAt;
    ready = rt(openAt + 0.35 + (n - 1) * 0.15 + 0.6);
  } else {
    // Bottom first, so each lands on the one below.
    out.items.forEach((item, i) => { item.time = rt(buildAt + (n - 1 - i) * each); });
    ready = rt(buildAt + (n - 1) * each + 0.6);
  }
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: ready, role: 'emphasis', cue: 'whoosh-soft'});
  const marked = out.items.map((item, i) => ({item, i})).filter(({item}) => item.status !== 'none');
  const first = ready - b.start + 0.25, last = Math.max(first, b.lastEvent - 0.2);
  const gap = marked.length > 1 ? Math.min(0.8, (last - first) / (marked.length - 1)) : 0;
  marked.forEach(({item, i}, k) => {
    item.statusAt = cueTime(b, `status-${i}`, items[i].at, `params.items[${i}].at`, first + k * gap, ready - b.start);
    b.events.push({id: `${b.id}-status-${i}`, name: `status-${i}`, time: item.statusAt, endTime: rt(item.statusAt + 0.4), role: 'emphasis', cue: item.status === 'flag' ? 'error' : 'success'});
  });
  const content = {variant: b.variant, title: box.tb.title, source: box.tb.source, align: 'center', cam, W: box.W, H: box.H, tone, colors, series: b.series(n), buildAt, ready, dropH: r2(180 * u), ...out};
  return b.finish(content, {minTextPx: r2(Math.min(out.minText, box.tb.title ? box.tb.title.size : Infinity))});
}

/** Sections and books: slabs stacked bottom-up; thick enough on screen for their row of text. */
function stackLayout(b, items, cam, box, world, sizes) {
  const {check, u} = b;
  const books = b.variant === 'books';
  // Portrait has no room beside the stack: rows go on the slabs' front edges, like spines.
  const onFace = books || b.portrait;
  const n = items.length;
  let unit = world.t;
  const rowH = sizes.labelSize * 1.3 + u(14);
  const dims = k => {
    let e = 0;
    // The first item is the top of the stack.
    const slabs = items.map((item, i) => ({t: item.size * unit * k, w: world.w * (books ? SPREAD[i] : 1) * k, d: world.d * (books ? SPREAD[(i + 3) % 7] : 1) * k}));
    for (let i = n - 1; i >= 0; i--) { slabs[i].e = e; e += slabs[i].t; }
    return slabs;
  };
  const textW = item => textWidth(item.label, sizes.labelSize, 'body') + (item.detail ? textWidth(item.detail, sizes.detailSize, 'meta') + u(24) : 0) + sizes.iconSize + u(36);
  const build = k => {
    const slabs = dims(k), points = [];
    slabs.forEach(s => { for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const z of [s.e, s.e + s.t]) points.push([sx * s.w / 2, sy * s.d / 2, z]); });
    const labels = onFace ? [] : slabs.map((s, i) => ({at: [s.w / 2 + u(20), 0, s.e + s.t / 2], w: textW(items[i]) + u(60), h: rowH, ax: 0, ay: 0.5}));
    return {points, labels};
  };
  let fit, slabs, ok = false;
  for (let pass = 0; pass < 6 && !ok; pass++) {
    fit = fitScene(cam, box.W, box.avail, build, {centre: box.centre});
    slabs = dims(fit.k);
    ok = true;
    let need = 0;
    slabs.forEach((s, i) => {
      const hs = faceScale(cam, [0, s.d / 2, s.e + s.t / 2]);
      need = Math.max(need, (onFace ? rowH : rowH * 0.9) / hs / fit.k / items[i].size);
      if (onFace) {
        const ws = faceWidthScale(cam, [0, s.d / 2, s.e]);
        if (textW(items[i]) + (books ? 0 : u(64)) > s.w * ws * 0.96) check.fail(`params.items[${i}].label`, `does not fit the spine at ${sizes.labelSize} px; shorten it or its detail`);
      }
    });
    if (need > unit + 1e-6) { unit = need * 1.03; ok = false; }
  }
  if (!ok) check.fail('params.items', 'leave the slabs too thin for their text; use fewer items');
  let minText = sizes.labelSize;
  const scaleAt = (s) => onFace ? Math.min(faceScale(cam, [0, s.d / 2, s.e + s.t / 2]), faceWidthScale(cam, [0, s.d / 2, s.e])) : minScale(cam, [s.w / 2 + u(20), 0, s.e + s.t / 2]);
  const outItems = items.map((item, i) => {
    const s = slabs[i], m = scaleAt(s);
    minText = Math.min(minText, sizes.labelSize);
    const dMax = Math.max(...slabs.map(o => o.d));
    return {...item, w: r2(s.w), d: r2(s.d), t: r2(s.t), e: r2(s.e), y: r2((dMax - s.d) / 2), twist: books ? TWIST[i] : 0, label: item.label, size: {label: up2(sizes.labelSize / m), detail: up2(sizes.detailSize / m), icon: up2(sizes.iconSize / m)}};
  });
  return {items: outItems, k: fit.k, minText, onFace};
}

/** The folder: a back panel and a hinged front, files standing between them that rise when it opens. */
function folderLayout(b, items, cam, box, world, sizes) {
  const {u} = b;
  const n = items.length;
  const depth = 40 + n * 22;
  const fileH = world.h * 0.82;
  // A file's strip: icon, label, detail and status on one row, or the detail under the label when the row is too narrow.
  const details = items.some(item => item.detail);
  let result = null;
  for (const twoRows of details ? [false, true] : [false]) {
    const strip = sizes.labelSize * 1.3 + (twoRows ? sizes.detailSize * 1.3 : 0) + u(30);
    let rise = 1;
    const build = k => {
      const points = [];
      const top = (world.h + rise * (n - 1)) * k;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const z of [0, top]) points.push([sx * world.w / 2 * k, sy * depth / 2 * k, z]);
      // The open front lies forward of the folder.
      for (const sx of [-1, 1]) points.push([sx * world.w / 2 * k, (depth / 2 + world.h * 0.95) * k, world.h * 0.3 * k]);
      return {points, labels: []};
    };
    let fit;
    for (let pass = 0; pass < 5; pass++) {
      fit = fitScene(cam, box.W, box.avail, build, {centre: box.centre});
      const need = strip / faceScale(cam, [0, 0, world.h * fit.k]) / fit.k;
      if (need <= rise + 1e-6) break;
      rise = need * 1.03;
    }
    const k = fit.k;
    const ws = faceWidthScale(cam, [0, 0, world.h * k]), hs = faceScale(cam, [0, 0, world.h * k]);
    const room = (world.w * 0.94 * k) * ws - u(44) - sizes.labelSize * 1.3 - sizes.iconSize - u(14);
    const fits = items.every(item => {
      const label = textWidth(item.label, sizes.labelSize, 'body'), detail = item.detail ? textWidth(item.detail, sizes.detailSize, 'meta') : 0;
      return twoRows ? Math.max(label, detail) <= room : label + (detail ? detail + u(24) : 0) <= room;
    });
    if (fits) { result = {k, s: Math.min(ws, hs), rise, strip, twoRows}; break; }
  }
  if (!result) b.check.fail('params.items', `labels do not fit their files at ${sizes.labelSize} px; shorten them`);
  const {k, s, rise, strip, twoRows} = result;
  const out = items.map((item, i) => ({...item, z: r2((-depth / 2 + 20 + i * 22) * k), h: r2(fileH * k), lift: r2((n - 1 - i) * rise * k + world.h * 0.06 * k), size: {label: up2(sizes.labelSize / s), detail: up2(sizes.detailSize / s), icon: up2(sizes.iconSize / s)}}));
  return {items: out, k, w: r2(world.w * k), h: r2(world.h * k), depth: r2(depth * k), strip: r2(strip / s), twoRows, minText: sizes.labelSize};
}

// ---------------------------------------------------------------------------
// View

function statusIcon(id, status, colors, size, x, y) {
  if (status === 'none') return null;
  return iconNode(status === 'ok' ? 'check-circle' : 'flag', {id, x, y, size, color: colors[status], mode: 'duotone', tintOpacity: 0.3, style: {opacity: 0, transformOrigin: '50% 50%'}});
}

/** Paper: page edges on the sides, a sheet on top. */
function paperFaces(theme, tone, u) {
  const sheet = mixColor(theme.paper, '#ffffff', 0.5), edge = mixColor(theme.paper, '#8a8478', 0.45);
  const pages = `repeating-linear-gradient(180deg, ${sheet} 0px, ${sheet} ${r2(2.4 * u)}px, ${edge} ${r2(2.4 * u)}px, ${edge} ${r2(3.4 * u)}px)`;
  return {front: {background: pages}, back: {background: pages}, left: {background: pages}, right: {background: pages},
    top: {background: `repeating-linear-gradient(180deg, transparent 0px, transparent ${r2(22 * u)}px, ${hex2('#7d786e', 0.28)} ${r2(22 * u)}px, ${hex2('#7d786e', 0.28)} ${r2(25 * u)}px), ${sheet}`, boxShadow: `inset 0 0 ${r2(30 * u)}px ${hex2('#6b665c', 0.35)}`}, bottom: null};
}

function paperView(model) {
  const {id} = model;
  const c = model.content;
  const floor = [floorGlow(`${id}-pool`, c.tone, 0, 0, r2((c.w ?? c.items[0].w) * 1.8), r2((c.depth ?? c.items[0].d) * 2.4 + 200 * c.k), 0.26)];
  if (c.variant === 'folder') floor.push(...folderNodes(model));
  else c.items.forEach((item, i) => floor.push(...slabNodes(model, item, i)));
  return [...chromeNodes(model), rigNodes(id, c.cam, c.W, c.H, floor)];
}

function slabNodes(model, item, i) {
  const {id, fonts, unit: u, theme} = model;
  const c = model.content;
  const books = c.variant === 'books';
  const out = [];
  let faces;
  const front = [];
  if (books) {
    const cover = mixColor(c.series[i], theme.bg, 0.35);
    faces = {...glassFaces(theme, cover, u, {strength: 0.9}), ...Object.fromEntries(['back', 'left', 'right'].map(f => [f, {background: `repeating-linear-gradient(180deg, #efe9dc 0px, #efe9dc ${r2(2.4 * u)}px, #b9b2a3 ${r2(2.4 * u)}px, #b9b2a3 ${r2(3.4 * u)}px)`}]))};
    faces.front = {background: `linear-gradient(180deg, ${mixColor(cover, '#ffffff', 0.12)} 0%, ${cover} 50%, ${mixColor(cover, '#000000', 0.3)} 100%)`, border: `${r2(2 * u)}px solid ${hex2(mixColor(cover, '#ffffff', 0.4), 0.8)}`};
    faces.top = {background: `linear-gradient(135deg, ${mixColor(cover, '#ffffff', 0.18)} 0%, ${cover} 100%)`, border: faces.front.border};
  } else {
    faces = paperFaces(theme, c.tone, u);
    // A tone tab marks each section on its front edge.
    front.push(el('div', null, abs(r2(20 * u), r2(item.t * 0.2), r2(c.onFace ? 30 * u : 70 * u), r2(item.t * 0.6), {background: c.series[i], borderRadius: r2(4 * u)})));
    if (item.status === 'flag') front.push(el('div', `${id}-fl${i}`, abs(0, 0, item.w, item.t, {opacity: 0, background: hex2(c.colors.flag, 0.5), boxShadow: `0 0 ${r2(24 * u)}px ${hex2(c.colors.flag, 0.7)}`})));
  }
  if (c.onFace) {
    const s = item.size, mid = r2(item.t / 2), x0 = r2(books ? 24 * u : 76 * u);
    const ink = books ? theme.foreground : '#14161c';
    // Paper edges are busy, so a section's row sits on a dark pill.
    if (!books) front.push(el('div', null, abs(r2(x0 - 14 * u), r2(mid - s.label * 0.72), r2(item.w - x0 - 10 * u), r2(s.label * 1.44), {background: hex2(theme.bg, 0.82), borderRadius: r2(s.label * 0.72)})));
    front.push(label(null, x0, r2(mid - s.label * 0.62), r2(item.w * 0.7), item.label, {size: s.label, family: fonts.body, color: books ? ink : theme.foreground, weight: 700}));
    if (item.detail) front.push(label(null, r2(item.w * 0.5), r2(mid - s.detail * 0.6), r2(item.w * 0.5 - 30 * u - (item.status !== 'none' ? s.icon + 16 * u : 0)), item.detail, {size: s.detail, family: fonts.meta, color: theme.foreground, align: 'right', spacing: '0.06em'}));
    const icon = statusIcon(`${id}-st${i}`, item.status, c.colors, s.icon, r2(item.w - 24 * u - s.icon), r2(mid - s.icon / 2));
    if (icon) front.push(icon);
  }
  const kids = boxFaces(null, {w: item.w, h: item.t, d: item.d, e: item.e}, faces, {front});
  const body = stand([group(`${id}-g${i}`, kids)]);
  out.push(slot(null, 0, item.y, item.twist ? [el('div', null, abs(0, 0, 0, 0, {transform: `rotate(${item.twist}deg)`, transformStyle: 'preserve-3d', transformOrigin: '0px 0px'}), [body])] : [body]));
  if (!c.onFace) {
    const s = item.size;
    const lw = r2(textWidth(item.label, s.label, 'body') + 8 * u), dw = item.detail ? r2(textWidth(item.detail, s.detail, 'meta') + 8 * u) : 0;
    const lead = r2(48 * u), iconW = item.status !== 'none' ? r2(s.icon + 14 * u) : 0;
    const w = r2(lead + iconW + lw + (dw ? dw + 20 * u : 0) + 12 * u), h = r2(s.label * 1.3);
    const kidsBB = [el('div', `${id}-row${i}`, abs(0, 0, w, h, {opacity: 0}), [
      el('div', null, abs(0, r2(h / 2 - 1.5 * u), r2(lead - 10 * u), r2(3 * u), {background: hex2(theme.foreground, 0.5)})),
      label(null, r2(lead + iconW), r2(h / 2 - s.label * 0.62), lw, item.label, {size: s.label, family: fonts.body, color: theme.foreground, weight: 650}),
      ...(dw ? [label(null, r2(lead + iconW + lw + 20 * u), r2(h / 2 - s.detail * 0.6), dw, item.detail, {size: s.detail, family: fonts.meta, color: theme.muted, spacing: '0.06em'})] : [])
    ])];
    const icon = statusIcon(`${id}-st${i}`, item.status, c.colors, s.icon, lead, r2(h / 2 - s.icon / 2));
    if (icon) kidsBB.push(icon);
    out.push(billboard(`${id}-bb${i}`, c.cam, [r2(item.w / 2 + 20 * u), 0, r2(item.e + item.t / 2)], {w, h, ax: 0, ay: 0.5}, kidsBB));
  }
  return out;
}

function folderNodes(model) {
  const {id, fonts, unit: u, theme} = model;
  const c = model.content;
  const glass = glassFaces(theme, c.tone, u, {strength: 0.55});
  const back = boxFaces(null, {w: c.w, h: c.h, d: r2(12 * c.k), x: 0}, glass).map(face => ({...face, style: {...face.style, transform: `translateZ(${r2(-c.depth / 2)}px) ${face.style.transform}`}}));
  const tabW = r2(c.w * 0.3), tabH = r2(46 * c.k);
  back.push(el('div', null, abs(r2(-c.w / 2 + 30 * c.k), r2(-c.h - tabH + 2), tabW, tabH, {transform: `translateZ(${r2(-c.depth / 2 + 6 * c.k)}px)`, borderRadius: `${r2(12 * u)}px ${r2(12 * u)}px 0 0`, ...glass.front})));
  const files = c.items.map((item, i) => {
    const s = item.size, pad = r2(22 * u), fw = r2(c.w * 0.94);
    const lw = r2(fw - 2 * pad - (item.status !== 'none' ? s.icon + 14 * u : 0));
    const strip = [
      iconNode('file-text', {x: pad, y: r2(pad * 0.7), size: r2(s.label * 1.05), color: c.series[i], mode: 'duotone', tintOpacity: 0.3}),
      label(null, r2(pad + s.label * 1.3), r2(pad * 0.7), r2(lw - s.label * 1.3), item.label, {size: s.label, family: fonts.body, color: '#1a1d24', weight: 700}),
      ...(item.detail ? [label(null, r2(pad + s.label * 1.3), c.twoRows ? r2(pad * 0.7 + s.label * 1.28) : r2(pad * 0.7 + s.label * 0.62 - s.detail * 0.6), r2(lw - s.label * 1.3), item.detail, {size: s.detail, family: fonts.meta, color: '#4a4e58', spacing: '0.06em', align: c.twoRows ? 'left' : 'right'})] : [])
    ];
    const icon = statusIcon(`${id}-st${i}`, item.status, c.colors, s.icon, r2(fw - pad - s.icon), r2(pad * 0.7));
    if (icon) strip.push(icon);
    const sheet = el('div', null, abs(r2(-fw / 2), r2(-item.h), fw, item.h, {transform: `translateZ(${item.z}px)`, transformStyle: 'preserve-3d'}), [
      el('div', null, abs(0, 0, fw, item.h, {background: `repeating-linear-gradient(180deg, transparent 0px, transparent ${r2(30 * u)}px, ${hex2('#7d786e', 0.22)} ${r2(30 * u)}px, ${hex2('#7d786e', 0.22)} ${r2(33 * u)}px), ${mixColor(theme.paper, '#ffffff', 0.6)}`, borderRadius: r2(6 * u), boxShadow: `0 0 ${r2(14 * u)}px ${hex2('#000000', 0.35)}`}), strip)
    ]);
    return group(`${id}-f${i}`, [sheet]);
  });
  // The front: a hinge on the bottom front edge; it opens toward the viewer.
  const frontFaces = boxFaces(null, {w: c.w, h: r2(c.h * 0.78), d: r2(12 * c.k)}, glass);
  const front = hinge(`${id}-flap`, [0, r2(c.depth / 2)], frontFaces);
  return [slot(null, 0, 0, [stand([group(`${id}-g`, [...back, ...files, front])])])];
}

function paperTimeline(model, ops) {
  const {id, start, unit: u, motion} = model;
  const c = model.content;
  chromeOps(model, ops);
  const folder = c.variant === 'folder';
  rigOps(ops, id, c.cam, start, motion.enterStart, motion.end, c.variant === 'sections' && !c.onFace ? c.items.map((_, i) => `${id}-bb${i}`) : []);
  set(ops, `${id}-pool`, start, {opacity: 0});
  tw(ops, `${id}-pool`, c.buildAt, 0.8, 'power1.out', {opacity: 0}, {opacity: 1});
  if (folder) {
    dropIn(ops, `${id}-g`, start, c.buildAt, c.dropH);
    set(ops, `${id}-flap`, start, {x: 0, y: 0, rotation: 0});
    tw(ops, `${id}-flap`, c.openAt, 0.8, 'power3.inOut', {rotation: 0}, {rotation: -78});
    c.items.forEach((item, i) => {
      set(ops, `${id}-f${i}`, start, {x: 0, y: 0});
      tw(ops, `${id}-f${i}`, item.time, 0.7, 'back.out(1.4)', {y: 0}, {y: -item.lift});
    });
  } else {
    c.items.forEach((item, i) => {
      dropIn(ops, `${id}-g${i}`, start, item.time, c.dropH, {duration: 0.55});
      if (c.variant === 'sections' && !c.onFace) riseOps(ops, `${id}-row${i}`, start, rt(item.time + 0.3), 0, {dx: r2(-24 * u), duration: 0.4});
    });
  }
  c.items.forEach((item, i) => {
    if (item.status === 'none') return;
    popOps(ops, `${id}-st${i}`, start, item.statusAt, {from: 0.3, duration: 0.45, ease: 'back.out(2.2)'});
    if (item.status === 'flag' && c.variant === 'sections') {
      set(ops, `${id}-fl${i}`, start, {opacity: 0});
      tw(ops, `${id}-fl${i}`, item.statusAt, 0.35, 'power2.out', {opacity: 0}, {opacity: 1});
    }
  });
}

export const paperStack = {
  id: 'paper-stack',
  describe: 'Paper in 3D: a stack of labelled document sections ("Chapter 3 · pp. 41–77") landing one on another, then a check or a red flag per row on its cue; the books variant stacks books with their titles on the spines; the folder variant lands a glass folder whose front swings open on its hinge and its files rise out, labelled, each with its check or flag.',
  params: {items: '[{label ≤ 28, detail? ≤ 14 ("pp. 41–77"), status? ok | flag | none, size? 0.5–4 (relative thickness), at? (the status cue)}] 2–7 (folder: 1–5 files); the first is the top of the stack (or the front file)',
    openAt: `folder only: the front opens: ${at3d}`, tone: 'glow tone: primary | accent | paper | #rrggbb (default accent)', orbit: ORBIT_PARAM, title: 'string ≤ 60 (optional)', source: 'string ≤ 80 (optional)',
    at: `the stack starts landing: ${at3d}`, variant: VARIANT_PARAM, rect: rect3d},
  events: ['build', 'open', 'status-0', 'status-1', 'status-2', 'status-3', 'status-4', 'status-5', 'status-6'],
  timing: timingRules({rules: ['the stack lands bottom first within about 1.4 s (the folder lands, opens about 0.8 s later and its files rise)', 'statuses pop top to bottom after the build, up to 0.8 s apart']}), variants: PAPER_VARIANTS,
  resolve: paperResolve, view: paperView, timeline: paperTimeline
};

export const PAPER_MODULES = [paperStack];

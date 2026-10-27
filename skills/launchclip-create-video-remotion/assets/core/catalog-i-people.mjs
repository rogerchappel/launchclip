// Catalogue I people: person-id (a photo in a rounded frame with a glowing
// rim, the name in bold capitals in a glow pill across its foot and the
// role under it, or the same as a glass card) and lineage-graph (2–5
// people as photos linked by dashed connectors with role labels, advisor →
// student, drawn generation by generation). Without a photo a person is an
// initials tile. Registered through kit/core/catalog-i-explain.mjs.

import {timingRules} from './catalog-b-base.mjs';
import {hex2} from './catalog-b-view.mjs';
import {VARIANT_PARAM, createHBase, fitText, inkOn, mixColor, textWidth, titleBlock, toneColor} from './catalog-h-base.mjs';
import {abs, chromeNodes, chromeOps, el, label, popOps, riseOps, set, tw} from './catalog-h-view.mjs';
import {AT, RECT, dashedPath, drawMaskOps, pillNode, r2, revealId, rt, scheduleCues} from './catalog-i-base.mjs';

const initials = name => name.split(/\s+/).filter(Boolean).map(w => w[0]).filter(ch => /[\p{L}\p{N}]/u.test(ch)).slice(0, 2).join('').toUpperCase() || '?';

/** A photo (or an initials tile) filling w × h with radius `radius`. */
function portrait(model, image, name, w, h, radius, color) {
  if (image) return el('img', null, abs(0, 0, w, h, {objectFit: 'cover', borderRadius: radius, display: 'block'}), [], {src: image, alt: ''});
  const size = r2(Math.min(w, h) * 0.38);
  return el('div', null, abs(0, 0, w, h, {borderRadius: radius, background: `linear-gradient(160deg, ${mixColor(color, model.theme.bg, 0.55)}, ${mixColor(color, model.theme.bg, 0.18)})`, overflow: 'hidden'}), [
    label(null, 0, r2((h - size * 1.1) / 2), w, initials(name), {size, family: model.fonts.display, color: mixColor(model.theme.foreground, color, 0.85), align: 'center', lineHeight: 1.1})
  ]);
}

// ---------------------------------------------------------------------------
// person-id

const PERSON_VARIANTS = Object.freeze(['pill', 'card']);

function personResolve(params, ctx) {
  const b = createHBase('person-id', params, ctx, {allowed: ['name', 'role', 'image', 'align', 'tone', 'title', 'at', 'nameAt'], required: ['name'], variants: PERSON_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const name = check.str(p.name, 'params.name', 28), role = p.role === undefined ? null : check.str(p.role, 'params.role', 40);
  const image = p.image === undefined ? null : check.asset(p.image, 'params.image');
  const align = p.align === undefined ? 'center' : check.oneOf(p.align, 'params.align', ['left', 'center', 'right']);
  const color = toneColor(b, p.tone, 'params.tone', 'accent');
  const ink = inkOn(b.colors, color);
  b.requireContrast('name/pill', ink, color, 'params.name on its pill');
  const tb = titleBlock(b, {title: p.title});
  const W = rect.width, H = rect.height - tb.top;
  const card = b.variant === 'card';
  const caps = card ? name : name.toUpperCase();
  const nameFit = fitText(check, 'params.name', caps, {family: 'body', width: W - u(80), preferred: u(b.portrait ? 60 : 54), min: b.min.key});
  const roleFit = role ? fitText(check, 'params.role', role, {family: 'body', width: W - u(40), preferred: u(44), min: b.min.key}) : null;
  const pillH = r2(nameFit.size * 1.2 + u(28)), pillW = r2(textWidth(caps, nameFit.size, 'body', card ? 0 : 0.04) + u(64));
  const textH = card ? r2(u(24) + nameFit.size * 1.25 + (roleFit ? roleFit.size * 1.3 : 0) + u(28)) : r2(pillH / 2 + (roleFit ? u(18) + roleFit.size * 1.3 : 0));
  const frameH = r2(Math.min(H - textH - (card ? 0 : pillH / 2) - u(20), u(b.portrait ? 620 : 540)));
  if (frameH < u(240)) check.fail('params', 'leaves too little room for the photo; drop the title or enlarge rect');
  const frameW = r2(Math.min(frameH * 0.82, W));
  const blockW = card ? Math.max(frameW + u(48), pillW, roleFit ? textWidth(role, roleFit.size, 'body') + u(48) : 0) : Math.max(frameW, pillW, roleFit ? textWidth(role, roleFit.size, 'body') + u(8) : 0);
  const bx = r2(align === 'left' ? 0 : align === 'right' ? W - blockW : (W - blockW) / 2);
  const blockH = card ? r2(u(24) + frameH + textH) : r2(frameH + textH);
  const by = r2(tb.top + (H - blockH) / 2);
  const frame = {x: r2(bx + (blockW - frameW) / 2), y: r2(by + (card ? u(24) : 0)), width: frameW, height: frameH};
  const pill = card ? null : {x: r2(Math.min(Math.max(0, frame.x + (frameW - pillW) / 2), W - pillW)), y: r2(frame.y + frameH - pillH / 2), width: pillW, height: pillH};
  const nameY = card ? r2(frame.y + frameH + u(24)) : null;
  const roleY = role ? (card ? r2(nameY + nameFit.size * 1.25) : r2(pill.y + pillH + u(18))) : null;
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: rt(buildAt + 0.6), role: 'emphasis', cue: 'whoosh-soft'});
  const nameAt = b.timeOf('name', p.nameAt, 'params.nameAt', Math.min(buildAt - b.start + 0.45, b.lastEvent), {min: buildAt - b.start});
  b.events.push({id: `${b.id}-name`, name: 'name', time: nameAt, endTime: rt(nameAt + 0.5), role: 'title', cue: 'whoosh'});
  const content = {variant: b.variant, title: tb.title, align, name: caps, role, image, color, ink, frame, pill, card: card ? {x: bx, y: by, width: r2(blockW), height: blockH} : null, nameY, roleY, nameSize: nameFit.size, roleSize: roleFit?.size ?? null,
    buildAt, nameAt, buildEnd: rt(nameAt + 0.6), fg: b.theme.foreground, muted: b.theme.muted, bg: b.theme.bg};
  return b.finish(content, {minTextPx: Math.min(nameFit.size, roleFit?.size ?? Infinity, tb.title ? tb.title.size : Infinity)});
}

function personView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content, F = c.frame;
  const kids = chromeNodes(model);
  const W = model.rect.width;
  if (c.card) kids.push(el('div', `${id}-card`, {...abs(c.card.x, c.card.y, c.card.width, c.card.height), boxSizing: 'border-box', borderRadius: r2(26 * u), background: hex2(model.theme.panel, 0.86),
    border: `${r2(2 * u)}px solid ${hex2(c.color, 0.55)}`, boxShadow: `0 0 ${r2(32 * u)}px ${hex2(c.color, 0.2)}`, opacity: 0}));
  const radius = r2(22 * u);
  kids.push(el('div', `${id}-frame`, {...abs(F.x, F.y, F.width, F.height), boxSizing: 'border-box', borderRadius: radius, opacity: 0, transformOrigin: '50% 60%'}, [
    portrait(model, c.image, c.name, F.width, F.height, radius, c.color),
    el('div', null, {...abs(0, 0, F.width, F.height), boxSizing: 'border-box', borderRadius: radius, border: `${r2(3 * u)}px solid ${hex2(c.color, 0.85)}`, boxShadow: `0 0 ${r2(34 * u)}px ${hex2(c.color, 0.45)}, inset 0 0 ${r2(18 * u)}px ${hex2(c.color, 0.25)}`})
  ]));
  if (c.pill) kids.push(pillNode(`${id}-pill`, c.pill, c.name, {size: c.nameSize, family: fonts.body, color: c.ink, background: c.color, weight: 800, spacing: '0.04em', glow: {blur: r2(30 * u), color: hex2(c.color, 0.7)}, extra: {opacity: 0}}));
  else kids.push(label(`${id}-pill`, 0, c.nameY, W, c.name, {size: c.nameSize, family: fonts.body, color: c.fg, align: 'center', weight: 700, lineHeight: 1.25, extra: {opacity: 0, ...(c.card ? {left: c.card.x, width: c.card.width} : {})}}));
  if (c.role) {
    const box = c.card ? {x: c.card.x, width: c.card.width} : c.align === 'center' ? {x: 0, width: W} : {x: c.pill.x, width: r2(W - c.pill.x)};
    kids.push(label(`${id}-role`, box.x, c.roleY, box.width, c.role, {size: c.roleSize, family: fonts.body, color: c.card ? c.color : c.fg, align: c.card || c.align === 'center' ? 'center' : 'left', weight: 600, extra: {opacity: 0}}));
  }
  return kids;
}

function personTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  if (c.card) popOps(ops, `${id}-card`, start, rt(c.buildAt - 0.05), {from: 0.95, duration: 0.5, ease: 'power3.out', fade: 0.3});
  riseOps(ops, `${id}-frame`, start, c.buildAt, r2(30 * u), {duration: 0.6});
  if (c.pill) {
    set(ops, `${id}-pill`, start, {opacity: 0, x: r2(-50 * u), y: 0, scaleX: 1, scaleY: 1});
    tw(ops, `${id}-pill`, c.nameAt, 0.45, 'power3.out', {opacity: 0, x: r2(-50 * u)}, {opacity: 1, x: 0});
  } else riseOps(ops, `${id}-pill`, start, c.nameAt, r2(14 * u));
  if (c.role) riseOps(ops, `${id}-role`, start, rt(c.nameAt + 0.2), r2(12 * u));
}

export const personId = {
  id: 'person-id',
  describe: 'Who is speaking or being cited: a photo in a rounded frame with a glowing rim, the name in bold capitals inside a glow pill across its foot and the role under it ("Physics professor, ITU"); or the same as a glass card. Without a photo, an initials tile. Use real photos only of the real person named.',
  params: {name: 'string ≤ 28', role: 'string ≤ 40 (optional)', image: 'assets/… photo or video still of that person (optional; else an initials tile)', align: '"left" | "center" (default) | "right"',
    tone: 'the pill and rim: primary | accent (default) | paper | #rrggbb', nameAt: `the name: ${AT}`, title: 'string ≤ 60 (optional)', at: `build start: ${AT}`, variant: VARIANT_PARAM, rect: RECT},
  events: ['build', 'name'], timing: timingRules({rules: ['the frame rises from at; the name slides in 0.45 s later and the role follows']}), variants: PERSON_VARIANTS,
  resolve: personResolve, view: personView, timeline: personTimeline
};

// ---------------------------------------------------------------------------
// lineage-graph

const LINEAGE_VARIANTS = Object.freeze(['circles', 'frames']);

function lineageResolve(params, ctx) {
  const b = createHBase('lineage-graph', params, ctx, {allowed: ['people', 'links', 'tone', 'title', 'source', 'at'], required: ['people', 'links'], variants: LINEAGE_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const color = toneColor(b, p.tone, 'params.tone', 'accent');
  check.arr(p.people, 'params.people', 2, 5);
  const seen = new Set();
  const people = p.people.map((person, i) => {
    const path = `params.people[${i}]`;
    check.obj(person, path, ['id', 'name', 'role', 'image', 'at'], ['name']);
    return {id: revealId(check, person.id, `${path}.id`, `p${i}`, seen), name: check.str(person.name, `${path}.name`, 24), role: person.role === undefined ? null : check.str(person.role, `${path}.role`, 28),
      image: person.image === undefined ? null : check.asset(person.image, `${path}.image`), at: person.at, index: i};
  });
  const ref = (value, path) => {
    const k = typeof value === 'number' ? value : people.findIndex(person => person.id === value);
    if (!Number.isInteger(k) || k < 0 || k >= people.length) check.fail(path, `must name a person by index or id (got ${JSON.stringify(value)})`);
    return k;
  };
  check.arr(p.links, 'params.links', 1, 6);
  const links = p.links.map((link, i) => {
    const path = `params.links[${i}]`;
    check.obj(link, path, ['from', 'to', 'label'], ['from', 'to']);
    const from = ref(link.from, `${path}.from`), to = ref(link.to, `${path}.to`);
    if (from === to) check.fail(`${path}.to`, 'must differ from from');
    return {from, to, text: link.label === undefined ? null : check.str(link.label, `${path}.label`, 24)};
  });
  // Generations: a person's depth is one more than their deepest parent's.
  const depth = people.map(() => 0);
  for (let pass = 0; pass <= people.length; pass++) {
    let moved = false;
    for (const link of links) if (depth[link.to] < depth[link.from] + 1) { depth[link.to] = depth[link.from] + 1; moved = true; }
    if (moved && pass === people.length) check.fail('params.links', 'form a loop; a lineage runs one way');
  }
  const gens = Math.max(...depth) + 1;
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const W = rect.width, H = rect.height - tb.top - tb.bottom;
  const across = !b.portrait;
  const linkW = Math.max(0, ...links.map(link => (link.text ? textWidth(link.text, Math.max(b.min.meta, u(28)), 'body') + u(30) : 0)));
  const nameSize = r2(Math.max(b.min.key, u(40))), roleSize = r2(Math.max(b.min.meta, u(30))), linkSize = r2(Math.max(b.min.meta, u(28)));
  const rows = Array.from({length: gens}, (_, g) => people.filter((_, i) => depth[i] === g));
  const widest = Math.max(...rows.map(row => row.length));
  // A single chain in portrait reads as a list: photo on the left, name beside it.
  const list = !across && widest === 1;
  // Cell per person: photo, name and role under it.
  const textH = nameSize * 1.25 + roleSize * 1.3 + u(14);
  const gap = across ? Math.max(u(150), linkW + u(70)) : u(list ? 70 : 110);
  const photo = r2(list ? Math.min(u(230), (H - (gens - 1) * gap) / gens)
    : Math.min(u(across ? 230 : 210), across ? (H / widest - textH - u(20)) : (H - (gens - 1) * gap) / gens - textH, (across ? (W - (gens - 1) * gap) / gens : W / widest - u(30)) * 0.9));
  if (photo < u(110)) check.fail('params.people', 'do not fit the rect; use fewer people or generations, or drop the title');
  const cellW = r2(Math.max(photo, ...people.map(person => Math.max(textWidth(person.name, nameSize, 'body'), person.role ? textWidth(person.role, roleSize, 'body') : 0))) + u(10));
  people.forEach((person, i) => {
    fitText(check, `params.people[${i}].name`, person.name, {family: 'body', width: across ? (W - (gens - 1) * u(60)) / gens : W / widest, preferred: nameSize, min: nameSize});
  });
  const cellH = r2(list ? photo : photo + textH);
  const span = across ? gens * cellW + (gens - 1) * gap : gens * cellH + (gens - 1) * gap;
  if (list) people.forEach((person, i) => {
    const room = W - photo - u(36);
    if (textWidth(person.name, nameSize, 'body') > room || (person.role && textWidth(person.role, roleSize, 'body') > room)) check.fail(`params.people[${i}]`, 'name or role is too wide beside the photo; shorten it');
  });
  if (span > (across ? W : H) + 1e-6) check.fail('params.people', 'do not fit the rect; shorten names or roles, or use fewer generations');
  const start0 = across ? (W - span) / 2 : tb.top + (H - span) / 2;
  rows.forEach((row, g) => row.forEach((person, k) => {
    const main = start0 + g * ((across ? cellW : cellH) + gap);
    if (across) Object.assign(person, {cx: r2(main + cellW / 2), cy: r2(tb.top + H * (k + 0.5) / row.length - textH / 2)});
    else if (list) Object.assign(person, {cx: r2(u(20) + photo / 2), cy: r2(main + photo / 2)});
    else Object.assign(person, {cx: r2(W * (k + 0.5) / row.length), cy: r2(main + photo / 2)});
    person.depth = g;
  }));

  // Reveal order: generation by generation; each link draws into its child.
  const order = [...people].sort((a, c) => a.depth - c.depth || a.index - c.index);
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: rt(buildAt + 0.5), role: 'emphasis', cue: 'whoosh-soft'});
  const cues = order.map((person, k) => ({name: `node-${person.id}`, at: person.at, path: `params.people[${person.index}].at`, gap: k === 0 ? 0.6 : 0.9, person}));
  scheduleCues(b, cues, buildAt - b.start);
  cues.forEach(cue => { cue.person.time = cue.time; b.events.push({id: `${b.id}-node-${cue.person.id}`, name: cue.name, time: cue.time, endTime: rt(cue.time + 0.5), role: 'emphasis', cue: 'pop'}); });
  const r = photo / 2;
  const items = links.map((link, i) => {
    const a = people[link.from], c2 = people[link.to];
    const [x0, y0, x1, y1] = across ? [a.cx + r + u(14), a.cy, c2.cx - r - u(14), c2.cy] : [a.cx, a.cy + r + (list ? u(12) : textH + u(6)), c2.cx, c2.cy - r - u(12)];
    const d = across ? `M${r2(x0)} ${r2(y0)} C${r2((x0 + x1) / 2)} ${r2(y0)} ${r2((x0 + x1) / 2)} ${r2(y1)} ${r2(x1)} ${r2(y1)}` : `M${r2(x0)} ${r2(y0)} C${r2(x0)} ${r2((y0 + y1) / 2)} ${r2(x1)} ${r2((y0 + y1) / 2)} ${r2(x1)} ${r2(y1)}`;
    const time = rt(Math.max(a.time + 0.3, c2.time - 0.55));
    const pw = link.text ? r2(textWidth(link.text, linkSize, 'body') + u(30)) : 0, ph = r2(linkSize * 1.2 + u(16));
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const px = list ? r2(x0 + u(26)) : r2(Math.min(Math.max(0, mx - pw / 2), W - pw));
    return {d, time, from: link.from, to: link.to, text: link.text, pill: link.text ? {x: px, y: r2(my - ph / 2), width: pw, height: ph} : null};
  });
  const last = Math.max(...people.map(person => person.time));
  const content = {variant: b.variant, title: tb.title, source: tb.source, align: 'center', list, people, links: items, photo, cellW: list ? r2(W - u(20)) : cellW, textH, nameSize, roleSize, linkSize, color, buildAt, buildEnd: rt(last + 0.6),
    fg: b.theme.foreground, muted: b.theme.muted, panel: b.theme.panel};
  return b.finish(content, {minTextPx: Math.min(nameSize, tb.title ? tb.title.size : Infinity)});
}

function lineageView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const kids = chromeNodes(model);
  const W = model.rect.width, H = model.rect.height;
  c.links.forEach((link, i) => kids.push(dashedPath(`${id}-link-${i}`, W, H, link.d, hex2(c.color, 0.85), r2(3.5 * u), {dash: r2(10 * u), gap: r2(9 * u)})));
  const circle = c.variant === 'circles';
  const radius = circle ? r2(c.photo / 2) : r2(20 * u);
  c.people.forEach(person => {
    const x = r2(person.cx - c.photo / 2), y = r2(person.cy - c.photo / 2);
    const left = c.list ? x : r2(person.cx - c.cellW / 2);
    const tx = c.list ? r2(c.photo + 28 * u) : 0, ty = c.list ? r2((c.photo - c.nameSize * 1.25 - (person.role ? c.roleSize * 1.3 : 0)) / 2) : r2(c.photo + 14 * u);
    const tw2 = c.list ? r2(c.cellW - c.photo - 28 * u) : c.cellW, talign = c.list ? 'left' : 'center';
    kids.push(el('div', `${id}-person-${person.id}`, abs(left, y, c.cellW, r2(c.list ? c.photo : c.photo + c.textH), {opacity: 0, transformOrigin: c.list ? `${r2(c.photo / 2)}px 50%` : '50% 30%'}), [
      el('div', null, abs(c.list ? 0 : r2(x - left), 0, c.photo, c.photo, {borderRadius: radius}), [
        portrait(model, person.image, person.name, c.photo, c.photo, radius, c.color),
        el('div', null, {...abs(0, 0, c.photo, c.photo), boxSizing: 'border-box', borderRadius: radius, border: `${r2(3 * u)}px solid ${hex2(c.color, 0.8)}`, boxShadow: `0 0 ${r2(28 * u)}px ${hex2(c.color, 0.4)}`})
      ]),
      label(null, tx, ty, tw2, person.name, {size: c.nameSize, family: fonts.body, color: c.fg, align: talign, weight: 700, lineHeight: 1.25}),
      ...(person.role ? [label(null, tx, r2(ty + c.nameSize * 1.25), tw2, person.role, {size: c.roleSize, family: fonts.body, color: c.color, align: talign, weight: 600, lineHeight: 1.3})] : [])
    ]));
  });
  c.links.forEach((link, i) => {
    if (link.pill) kids.push(pillNode(`${id}-linkl-${i}`, link.pill, link.text, {size: c.linkSize, family: fonts.body, color: c.fg, background: hex2(c.panel, 0.95), border: `${r2(2 * u)}px solid ${hex2(c.color, 0.6)}`, weight: 600, extra: {opacity: 0}}));
  });
  return kids;
}

function lineageTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  chromeOps(model, ops);
  c.people.forEach(person => popOps(ops, `${id}-person-${person.id}`, start, person.time, {from: 0.8, duration: 0.5, ease: 'back.out(1.8)', fade: 0.25}));
  c.links.forEach((link, i) => {
    drawMaskOps(ops, `${id}-link-${i}`, start, link.time, 0.6);
    if (link.pill) popOps(ops, `${id}-linkl-${i}`, start, rt(link.time + 0.3), {from: 0.7, duration: 0.35});
  });
}

export const lineageGraph = {
  id: 'lineage-graph',
  describe: 'A lineage: 2–5 people as photos (or initials tiles) linked by dashed connectors with role labels ("doctoral advisor", "co-author"), laid out by generation (left to right in landscape, top to bottom in portrait) and drawn in order, each link drawing into the next person.',
  params: {people: '[{name ≤ 24, role? ≤ 28, image? (assets/… photo of that person), id? (a reveal id; default p<i>), at?}] 2–5 (events node-<id>)', links: '[{from, to (index or id), label? ≤ 24}] 1–6, parent → child, no loops',
    tone: 'connector and rim colour: primary | accent (default) | paper | #rrggbb', title: 'string ≤ 60 (optional)', source: 'string ≤ 80 (optional)', at: `build start: ${AT}`, variant: VARIANT_PARAM, rect: RECT},
  events: ['build', 'node-<id>'], timing: timingRules({rules: ['people land generation by generation about 0.9 s apart (squeezed to fit); each link draws in 0.6 s just before its child']}), variants: LINEAGE_VARIANTS,
  resolve: lineageResolve, view: lineageView, timeline: lineageTimeline
};

export const PEOPLE = [personId, lineageGraph];

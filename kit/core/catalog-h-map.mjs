// Catalogue H map-highlight: a world map (Natural Earth 1:110m, Equal Earth
// projection; kit/core/world-110m.mjs) that fades in, zooms to the countries
// it highlights when they sit close together, then fills them one by one
// with label pills. Registered in kit/core/catalog-h.mjs.

import {timingRules} from './catalog-b-base.mjs';
import {svgRoot} from './catalog-b-view.mjs';
import {VARIANT_PARAM, createHBase, inkOn, mixColor, r2, rt, textWidth, titleBlock, toneColor} from './catalog-h-base.mjs';
import {abs, chromeNodes, chromeOps, el, label, popOps, set, tw} from './catalog-h-view.mjs';
import {COUNTRIES, WORLD_SIZE} from './world-110m.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';
const MAP_VARIANTS = Object.freeze(['fill', 'pins', 'glow']);
const ANTARCTICA = '010';
// The map without Antarctica ends above this y (projected units).
const CROP_HEIGHT = 432;

const key = name => String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Common names and codes for the countries Natural Earth names differently.
const ALIASES = {
  'usa': '840', 'us': '840', 'united states': '840', 'america': '840', 'uk': '826', 'britain': '826', 'great britain': '826', 'england': '826', 'scotland': '826', 'wales': '826',
  'drc': '180', 'dr congo': '180', 'democratic republic of the congo': '180', 'republic of the congo': '178', 'czech republic': '203', 'korea': '410', 'south korea': '410', 'republic of korea': '410',
  'north korea': '408', 'ivory coast': '384', 'cote d ivoire': '384', 'uae': '784', 'emirates': '784', 'north macedonia': '807', 'bosnia': '070', 'bosnia and herzegovina': '070',
  'central african republic': '140', 'car': '140', 'dominican republic': '214', 'equatorial guinea': '226', 'south sudan': '728', 'solomon islands': '090', 'falkland islands': '238', 'falklands': '238',
  'western sahara': '732', 'swaziland': '748', 'holland': '528', 'the netherlands': '528', 'russian federation': '643', 'east timor': '626', 'burma': '104', 'persia': '364', 'turkiye': '792',
  'viet nam': '704', 'lao pdr': '418', 'brasil': '076', 'deutschland': '276', 'espana': '724', 'nz': '554', 'aotearoa': '554', 'oz': '036'
};
const BY_NAME = Object.fromEntries(Object.entries(COUNTRIES).map(([id, c]) => [key(c.name), id]));

/** A country name, alias or ISO 3166-1 numeric code → its id, or null. */
export function countryId(value) {
  if (typeof value === 'number' && Number.isInteger(value)) value = String(value).padStart(3, '0');
  if (typeof value !== 'string') return null;
  if (/^\d{1,3}$/.test(value.trim())) { const id = value.trim().padStart(3, '0'); return COUNTRIES[id] ? id : null; }
  const k = key(value);
  return BY_NAME[k] ?? ALIASES[k] ?? null;
}

function mapResolve(params, ctx) {
  const b = createHBase('map-highlight', params, ctx, {allowed: ['highlight', 'title', 'source', 'focus', 'at', 'tone'], required: ['highlight'], variants: MAP_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  check.arr(p.highlight, 'params.highlight', 1, 8);
  const base = toneColor(b, p.tone, 'params.tone');
  const items = p.highlight.map((raw, i) => {
    const item = typeof raw === 'string' || typeof raw === 'number' ? {country: raw} : check.obj(raw, `params.highlight[${i}]`, ['country', 'label', 'value', 'color'], ['country']);
    const id = countryId(item.country);
    if (!id) check.fail(`params.highlight[${i}].country`, `is not a country on the map (${JSON.stringify(item.country)}); use its name, a common alias or its ISO numeric code`);
    return {id, name: COUNTRIES[id].name, label: item.label === undefined ? COUNTRIES[id].name.replace(/\bUnited States of America\b/, 'United States') : check.str(item.label, `params.highlight[${i}].label`, 24),
      value: item.value === undefined ? null : check.str(String(item.value), `params.highlight[${i}].value`, 12), color: item.color === undefined ? base : toneColor(b, item.color, `params.highlight[${i}].color`)};
  });
  if (new Set(items.map(i => i.id)).size !== items.length) check.fail('params.highlight', 'names the same country twice');
  const focus = p.focus === undefined ? 'auto' : check.oneOf(p.focus, 'params.focus', ['auto', 'world']);
  const withPole = items.some(i => i.id === ANTARCTICA);
  const worldH = withPole ? WORLD_SIZE.height : CROP_HEIGHT;
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const W = rect.width, H = rect.height - tb.top - tb.bottom;
  // The map's box is the whole area; the world fits it at k = 1, centred.
  const s = Math.min(W / WORLD_SIZE.width, H / worldH);
  const box = {x: 0, y: r2(tb.top), width: r2(W), height: r2(H)};
  const origin = {x: r2((W - WORLD_SIZE.width * s) / 2), y: r2((H - worldH * s) / 2)};
  // Zoom: to the highlights' bounds (padded) when they cover little of the map.
  const bounds = items.map(i => COUNTRIES[i.id].b);
  let [x0, y0, x1, y1] = [Math.min(...bounds.map(b2 => b2[0])), Math.min(...bounds.map(b2 => b2[1])), Math.max(...bounds.map(b2 => b2[2])), Math.max(...bounds.map(b2 => b2[3]))];
  const padX = Math.max(30, (x1 - x0) * 0.3), padY = Math.max(24, (y1 - y0) * 0.3);
  x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
  let k = Math.min(8, W / (s * (x1 - x0)), H / (s * (y1 - y0)));
  if (focus === 'world' || k < 1.4) k = 1;
  // Translate so the bounds' centre sits mid-box; where the zoomed world is
  // larger than the box, keep it covering the box.
  const fit = (size, worldSize, start, centre) => {
    const t = size / 2 - start - centre * s * k;
    return worldSize * s * k >= size ? Math.min(-start, Math.max(size - start - worldSize * s * k, t)) : t;
  };
  const tx = r2(fit(W, WORLD_SIZE.width, origin.x, (x0 + x1) / 2)), ty = r2(fit(H, worldH, origin.y, (y0 + y1) / 2));
  const t0 = b.timeOf('build', p.at, 'params.at', 0.5);
  b.events.push({id: `${b.id}-build`, name: 'build', time: t0, endTime: rt(t0 + 0.5), role: 'emphasis', cue: 'whoosh-soft'});
  const zoom = k > 1 ? {k: r2(k), x: tx, y: ty, time: rt(t0 + 0.35), duration: 1.2} : null;
  if (zoom) b.events.push({id: `${b.id}-zoom`, name: 'zoom', time: zoom.time, endTime: rt(zoom.time + zoom.duration), role: 'emphasis', cue: 'whoosh'});
  const first = zoom ? rt(zoom.time + zoom.duration - 0.15) : rt(t0 + 0.45);
  const step = Math.min(0.35, Math.max(0.12, (b.start + b.lastEvent - first - 0.4) / Math.max(1, items.length)));
  const pillSize = r2(Math.max(b.min.meta, u(30)));
  const placed = [];
  const marks = items.map((item, i) => {
    const c = COUNTRIES[item.id].c;
    const px = r2(box.x + origin.x + (zoom ? tx : 0) + c[0] * s * k), py = r2(box.y + origin.y + (zoom ? ty : 0) + c[1] * s * k);
    const text = item.value ? `${item.label} · ${item.value}` : item.label;
    const w = r2(textWidth(text, pillSize, 'body') + u(36)), h = r2(pillSize * 1.3 + u(16));
    // Above the country, else below, right or left; the first spot that is
    // clear of the other labels and inside the box.
    const lift = u(b.variant === 'pins' ? 50 : 16);
    const spots = [[px - w / 2, py - h - lift], [px - w / 2, py + u(16)], [px + u(20), py - h / 2], [px - w - u(20), py - h / 2]];
    const inside = ([x, y]) => x >= box.x && x + w <= box.x + box.width && y >= box.y && y + h <= box.y + box.height;
    const clear = ([x, y]) => !placed.some(q => x < q.x + q.w + u(6) && q.x < x + w + u(6) && y < q.y + q.h + u(4) && q.y < y + h + u(4));
    let [lx, ly] = spots.find(spot => inside(spot) && clear(spot)) ?? spots.find(inside) ?? spots[0];
    lx = r2(Math.min(Math.max(lx, box.x), box.x + box.width - w)); ly = r2(Math.min(Math.max(ly, box.y), box.y + box.height - h));
    placed.push({x: lx, y: ly, w, h});
    const time = rt(first + i * step);
    b.events.push({id: `${b.id}-highlight-${i}`, name: `highlight-${i}`, time, role: 'emphasis', cue: 'pop'});
    return {...item, d: COUNTRIES[item.id].d, px, py, text, pill: {x: lx, y: ly, w, h}, time, ink: inkOn(b.colors, item.color)};
  });
  const highlighted = new Set(items.map(i => i.id));
  const rest = Object.entries(COUNTRIES).filter(([id]) => !highlighted.has(id) && (withPole || id !== ANTARCTICA)).map(([, c]) => c.d).join('');
  const content = {variant: b.variant, title: tb.title, source: tb.source, align: 'left', box, origin, s: r2(s * 1e4) / 1e4, worldH, rest, marks, zoom, t0, pillSize, buildEnd: rt(marks.at(-1).time + 0.4),
    land: mixColor(b.colors.paper, b.colors.bg, 0.16), border: b.colors.bg, ink: b.theme.foreground, panel: b.theme.panel};
  return b.finish(content, {minTextPx: tb.title ? tb.title.size : b.min.key});
}

function mapView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const B = c.box;
  const kids = chromeNodes(model);
  const k = c.zoom ? c.zoom.k : 1;
  // Borders stay about one pixel wide at the final zoom.
  const stroke = r2(0.9 / (c.s * k));
  const paths = [el('path', null, null, [], {d: c.rest, fill: c.land, stroke: c.border, strokeWidth: stroke, strokeLinejoin: 'round'})];
  c.marks.forEach((m, i) => {
    paths.push(el('path', null, null, [], {d: m.d, fill: c.land, stroke: c.border, strokeWidth: stroke}));
    paths.push(el('path', `${id}-country-${i}`, {opacity: 0, ...(c.variant === 'glow' ? {filter: `drop-shadow(0 0 ${r2(6 / (c.s * k))}px ${m.color})`} : {})}, [], {d: m.d, fill: m.color, stroke: c.variant === 'glow' ? mixColor('#ffffff', m.color, 0.5) : c.border, strokeWidth: r2(stroke * (c.variant === 'glow' ? 1.6 : 1))}));
  });
  const world = el('div', `${id}-world`, {...abs(c.origin.x, c.origin.y, r2(1000 * c.s), r2(c.worldH * c.s)), transformOrigin: '0px 0px', opacity: 0}, [
    el('svg', null, {position: 'absolute', left: 0, top: 0, overflow: 'visible'}, paths, {width: r2(1000 * c.s), height: r2(c.worldH * c.s), viewBox: `0 0 1000 ${c.worldH}`})
  ]);
  kids.push(el('div', null, {...abs(B.x, B.y, B.width, B.height), overflow: 'hidden'}, [world]));
  c.marks.forEach((m, i) => {
    if (c.variant === 'pins') {
      const d = r2(34 * u);
      kids.push(el('div', `${id}-pin-${i}`, abs(r2(m.px - d / 2), r2(m.py - d * 1.3), d, r2(d * 1.3), {opacity: 0, transformOrigin: '50% 100%'}), [
        svgRoot(d, r2(d * 1.3), [el('path', null, null, [], {d: `M${r2(d / 2)} ${r2(d * 1.3)} C${r2(d * 0.15)} ${r2(d * 0.75)} 0 ${r2(d * 0.6)} 0 ${r2(d / 2)} A${r2(d / 2)} ${r2(d / 2)} 0 1 1 ${d} ${r2(d / 2)} C${d} ${r2(d * 0.6)} ${r2(d * 0.85)} ${r2(d * 0.75)} ${r2(d / 2)} ${r2(d * 1.3)} Z`, fill: m.color, stroke: c.border, strokeWidth: r2(2 * u)}),
          el('circle', null, null, [], {cx: r2(d / 2), cy: r2(d / 2), r: r2(d * 0.17), fill: c.border})])
      ]));
    }
    const P = m.pill;
    kids.push(el('div', `${id}-label-${i}`, {...abs(P.x, P.y, P.w, P.h), boxSizing: 'border-box', borderRadius: 99, background: c.variant === 'fill' ? m.color : c.panel, border: `${r2(2 * u)}px solid ${m.color}`, opacity: 0}, [
      label(null, 0, r2(8 * u), P.w, m.text, {size: c.pillSize, family: fonts.body, color: c.variant === 'fill' ? m.ink : c.ink, align: 'center', weight: 650, lineHeight: 1.3})
    ]));
  });
  return kids;
}

function mapTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  set(ops, `${id}-world`, start, {opacity: 0, x: 0, y: 0, scaleX: 1, scaleY: 1});
  tw(ops, `${id}-world`, c.t0, 0.5, 'power2.out', {opacity: 0}, {opacity: 1});
  if (c.zoom) tw(ops, `${id}-world`, c.zoom.time, c.zoom.duration, 'power3.inOut', {x: 0, y: 0, scaleX: 1, scaleY: 1}, {x: c.zoom.x, y: c.zoom.y, scaleX: c.zoom.k, scaleY: c.zoom.k});
  c.marks.forEach((m, i) => {
    set(ops, `${id}-country-${i}`, start, {opacity: 0});
    tw(ops, `${id}-country-${i}`, m.time, 0.4, 'power2.out', {opacity: 0}, {opacity: 1});
    if (c.variant === 'pins') {
      set(ops, `${id}-pin-${i}`, start, {opacity: 0, x: 0, y: r2(-60 * u), scaleX: 1, scaleY: 1});
      tw(ops, `${id}-pin-${i}`, rt(m.time + 0.05), 0.1, 'power1.out', {opacity: 0}, {opacity: 1});
      tw(ops, `${id}-pin-${i}`, rt(m.time + 0.05), 0.55, 'bounce.out', {y: r2(-60 * u)}, {y: 0});
    }
    popOps(ops, `${id}-label-${i}`, start, rt(m.time + 0.15), {from: 0.6});
  });
}

export const mapHighlight = {
  id: 'map-highlight',
  describe: 'A world map that fades in, zooms to the highlighted countries when they sit close together, then fills them one by one with label pills: plain fills, pins that drop on each, or a glow.',
  params: {highlight: '[country | {country (name, common alias or ISO numeric code), label? ≤ 24, value? ≤ 12, color?}] 1–8', focus: '"auto" (zoom when the countries are close; default) | "world"',
    tone: 'primary | accent | paper | #rrggbb', title: 'string ≤ 60 (optional)', source: 'string ≤ 80 (optional)', at: `map lands: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['build', 'zoom', 'highlight-<i>'], timing: timingRules({rules: ['the zoom runs 1.2 s from at + 0.35; highlights follow 0.12–0.35 s apart']}), variants: MAP_VARIANTS,
  resolve: mapResolve, view: mapView, timeline: mapTimeline
};

export const MAPS = [mapHighlight];

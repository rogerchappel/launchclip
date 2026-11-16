// Catalogue H map-highlight: a world map (Natural Earth 1:110m, Equal Earth
// projection; kit/core/world-110m.mjs) that fades in, zooms to the countries
// and places it highlights when they sit close together, then fills the
// countries one by one with label pills (and ×multiplier badges), drops
// pins on places given by longitude and latitude, each with a label or a
// glass callout card (a photo card when it has an image), and draws a
// dashed travel route between the pins. Variants: plain fills, pins, glow,
// a glowing outline that traces itself, and a dot-matrix world.
// Registered in kit/core/catalog-h.mjs.

import {timingRules} from './catalog-b-base.mjs';
import {hex2, svgRoot} from './catalog-b-view.mjs';
import {VARIANT_PARAM, createHBase, inkOn, mixColor, r2, rt, textWidth, titleBlock, toneColor} from './catalog-h-base.mjs';
import {abs, chromeNodes, chromeOps, drawOps, el, label, popOps, riseOps, set, tw} from './catalog-h-view.mjs';
import {COUNTRIES, WORLD_SIZE} from './world-110m.mjs';
import {getEase} from './motion.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';
const MAP_VARIANTS = Object.freeze(['fill', 'pins', 'glow', 'outline', 'dots']);
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

// ---------------------------------------------------------------------------
// Projection and land dots

// Equal Earth (Šavrič, Patterson and Jenny, 2018), as scripts/vendor-world.mjs
// projects the countries: longitude and latitude → map units.
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
function equalEarth(lon, lat) {
  const l = lon * Math.PI / 180, t = Math.asin(M * Math.sin(lat * Math.PI / 180));
  const t2 = t * t, t6 = t2 * t2 * t2;
  return [2 * Math.sqrt(3) * l * Math.cos(t) / (3 * (9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1)), A4 * t6 * t2 * t + A3 * t6 * t + A2 * t2 * t + A1 * t];
}
const [XMAX] = equalEarth(180, 0), [, YMAX] = equalEarth(0, 90);
const SCALE = WORLD_SIZE.width / (2 * XMAX);
/** Longitude and latitude (degrees) → map units in the 1000 × 486.7 world. */
export function projectLonLat(lon, lat) {
  const [x, y] = equalEarth(lon, lat);
  return [r2((x + XMAX) * SCALE), r2((YMAX - y) * SCALE)];
}

const RINGS = new Map();
function ringsOf(id) {
  if (!RINGS.has(id)) RINGS.set(id, COUNTRIES[id].d.split('Z').filter(Boolean).map(part => {
    const nums = part.replace('M', '').trim().split(/\s+/).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    return pts;
  }));
  return RINGS.get(id);
}
/** Even-odd point-in-polygon over all of a country's rings. */
function inside(id, x, y) {
  let hit = false;
  for (const ring of ringsOf(id)) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
/** Land dots on a `pitch` grid inside a window [x0, y0, x1, y1] → {country id: [[x, y]…]}. */
function landDots(pitch, [x0, y0, x1, y1], ids) {
  const out = {};
  const boxes = ids.map(id => [id, COUNTRIES[id].b]);
  for (let y = Math.ceil(y0 / pitch) * pitch; y <= y1; y += pitch) for (let x = Math.ceil(x0 / pitch) * pitch; x <= x1; x += pitch) {
    for (const [id, bb] of boxes) {
      if (x < bb[0] - 1 || x > bb[2] + 1 || y < bb[1] - 1 || y > bb[3] + 1) continue;
      if (inside(id, x, y)) { (out[id] ??= []).push([r2(x), r2(y)]); break; }
    }
  }
  return out;
}
const dotPath = pts => pts.map(([x, y]) => `M${x} ${y}h0`).join('');

// ---------------------------------------------------------------------------
// Resolve

function pinList(b, raw) {
  const {check} = b;
  if (raw === undefined) return [];
  check.arr(raw, 'params.pins', 1, 4);
  return raw.map((pin, i) => {
    const path = `params.pins[${i}]`;
    check.obj(pin, path, ['lon', 'lat', 'label', 'sub', 'card', 'color'], ['lon', 'lat', 'label']);
    const lon = check.num(pin.lon, `${path}.lon`, -180, 180), lat = check.num(pin.lat, `${path}.lat`, -85, 85);
    let card = null;
    if (pin.card !== undefined) {
      check.obj(pin.card, `${path}.card`, ['title', 'sub', 'image'], ['title']);
      card = {title: check.str(pin.card.title, `${path}.card.title`, 28), sub: pin.card.sub === undefined ? null : check.str(pin.card.sub, `${path}.card.sub`, 32), image: pin.card.image === undefined ? null : check.asset(pin.card.image, `${path}.card.image`)};
    }
    const [wx, wy] = projectLonLat(lon, lat);
    return {lon, lat, wx, wy, label: check.str(pin.label, `${path}.label`, 28), sub: pin.sub === undefined ? null : check.str(pin.sub, `${path}.sub`, 20), card, color: pin.color === undefined ? b.colors.accent : toneColor(b, pin.color, `${path}.color`)};
  });
}

function mapResolve(params, ctx) {
  const b = createHBase('map-highlight', params, ctx, {allowed: ['highlight', 'pins', 'route', 'camera', 'title', 'source', 'focus', 'at', 'tone'], variants: MAP_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  if (p.highlight === undefined && p.pins === undefined) check.fail('params', 'needs highlight (countries) or pins (places)');
  if (p.highlight !== undefined) check.arr(p.highlight, 'params.highlight', 1, 8);
  const base = toneColor(b, p.tone, 'params.tone');
  const items = (p.highlight ?? []).map((raw, i) => {
    const item = typeof raw === 'string' || typeof raw === 'number' ? {country: raw} : check.obj(raw, `params.highlight[${i}]`, ['country', 'label', 'value', 'badge', 'color', 'arrive'], ['country']);
    const id = countryId(item.country);
    if (!id) check.fail(`params.highlight[${i}].country`, `is not a country on the map (${JSON.stringify(item.country)}); use its name, a common alias or its ISO numeric code`);
    return {id, name: COUNTRIES[id].name, label: item.label === undefined ? COUNTRIES[id].name.replace(/\bUnited States of America\b/, 'United States') : check.str(item.label, `params.highlight[${i}].label`, 24),
      value: item.value === undefined ? null : check.str(String(item.value), `params.highlight[${i}].value`, 12), badge: item.badge === undefined ? null : check.str(String(item.badge), `params.highlight[${i}].badge`, 8),
      color: item.color === undefined ? base : toneColor(b, item.color, `params.highlight[${i}].color`),
      arrive: item.arrive === undefined ? null : check.oneOf(item.arrive, `params.highlight[${i}].arrive`, ['route', 'order'])};
  });
  if (new Set(items.map(i => i.id)).size !== items.length) check.fail('params.highlight', 'names the same country twice');
  const pins = pinList(b, p.pins);
  // route: true (dashed legs drawn as each pin lands) or {head} (the journey: one route with a glowing head; RFC §E.5).
  const journey = p.route !== null && typeof p.route === 'object' && !Array.isArray(p.route);
  const route = p.route === undefined ? false : journey ? true : check.bool(p.route, 'params.route');
  const head = journey ? (check.obj(p.route, 'params.route', ['head']), p.route.head === undefined ? true : check.bool(p.route.head, 'params.route.head')) : false;
  if (route && pins.length < 2) check.fail('params.route', 'needs at least two pins');
  const camera = p.camera === undefined ? null : p.camera === 'follow' ? 'follow' : cameraList(b, p.camera);
  if (camera === 'follow' && !journey) check.fail('params.camera', '"follow" needs a journey route: route {head: true} and two or more pins');
  if (items.some(item => item.arrive === 'route') && !journey) check.fail('params.highlight', 'arrive "route" needs a journey route: route {head: true} and two or more pins');
  if (pins.filter(pin => pin.card).length > 2) check.fail('params.pins', 'at most two pins can carry a card');
  const focus = p.focus === undefined ? 'auto' : check.oneOf(p.focus, 'params.focus', ['auto', 'world']);
  const withPole = items.some(i => i.id === ANTARCTICA);
  const worldH = withPole ? WORLD_SIZE.height : CROP_HEIGHT;
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const W = rect.width, H = rect.height - tb.top - tb.bottom;
  // The map's box is the whole area; the world fits it at k = 1, centred.
  const s = Math.min(W / WORLD_SIZE.width, H / worldH);
  const box = {x: 0, y: r2(tb.top), width: r2(W), height: r2(H)};
  const origin = {x: r2((W - WORLD_SIZE.width * s) / 2), y: r2((H - worldH * s) / 2)};
  // Zoom: to the highlights' and pins' bounds (padded) when they cover little of the map.
  const bounds = [...items.map(i => COUNTRIES[i.id].b), ...pins.map(pin => [pin.wx - 6, pin.wy - 6, pin.wx + 6, pin.wy + 6])];
  let [x0, y0, x1, y1] = [Math.min(...bounds.map(b2 => b2[0])), Math.min(...bounds.map(b2 => b2[1])), Math.max(...bounds.map(b2 => b2[2])), Math.max(...bounds.map(b2 => b2[3]))];
  const cards = pins.some(pin => pin.card);
  const padX = Math.max(30, (x1 - x0) * (cards ? 0.6 : 0.3)), padY = Math.max(24, (y1 - y0) * 0.3);
  x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
  let k = Math.min(8, W / (s * (x1 - x0)), H / (s * (y1 - y0)));
  if (focus === 'world' || k < 1.4) k = 1;
  // Translate so the bounds' centre sits mid-box; where the zoomed world is
  // larger than the box, keep it covering the box.
  const fit = (size, worldSize, start, centre, kk = k) => {
    const t = size / 2 - start - centre * s * kk;
    return worldSize * s * kk >= size ? Math.min(-start, Math.max(size - start - worldSize * s * kk, t)) : t;
  };
  const tx = r2(fit(W, WORLD_SIZE.width, origin.x, (x0 + x1) / 2)), ty = r2(fit(H, worldH, origin.y, (y0 + y1) / 2));
  const t0 = b.timeOf('build', p.at, 'params.at', 0.5);
  b.events.push({id: `${b.id}-build`, name: 'build', time: t0, endTime: rt(t0 + 0.5), role: 'emphasis', cue: 'whoosh-soft'});
  // The dot matrix starts close to its final zoom and pushes in (dots are laid out for that zoom).
  const dots = b.variant === 'dots';
  const zoom = k > 1 ? {k: r2(k), x: tx, y: ty, time: rt(t0 + 0.35), duration: dots ? 2 : 1.2, fromK: dots ? r2(k * 0.9) : 1} : null;
  if (zoom) {
    if (dots) Object.assign(zoom, {fromX: r2(tx + (W / 2 - origin.x - tx) * (1 - 0.9)), fromY: r2(ty + (H / 2 - origin.y - ty) * (1 - 0.9))});
    b.events.push({id: `${b.id}-zoom`, name: 'zoom', time: zoom.time, endTime: rt(zoom.time + zoom.duration), role: 'emphasis', cue: 'whoosh'});
  }
  const first = zoom && !dots ? rt(zoom.time + zoom.duration - 0.15) : rt(t0 + 0.45);
  const cues = items.length + pins.length;
  const step = Math.min(0.5, Math.max(0.12, (b.start + b.lastEvent - first - 0.5) / Math.max(1, cues)));
  const pillSize = r2(Math.max(b.min.meta, u(30)));
  const placed = [];
  const screen = (wx, wy) => [r2(box.x + origin.x + (zoom ? tx : 0) + wx * s * k), r2(box.y + origin.y + (zoom ? ty : 0) + wy * s * k)];
  const clampBox = (x, y, w, h) => [r2(Math.min(Math.max(x, box.x), box.x + box.width - w)), r2(Math.min(Math.max(y, box.y), box.y + box.height - h))];
  const clear = ([x, y], w, h) => !placed.some(q => x < q.x + q.w + u(6) && q.x < x + w + u(6) && y < q.y + q.h + u(4) && q.y < y + h + u(4));
  const within = ([x, y], w, h) => x >= box.x && x + w <= box.x + box.width && y >= box.y && y + h <= box.y + box.height;
  const marks = items.map((item, i) => {
    const c = COUNTRIES[item.id].c;
    const [px, py] = screen(c[0], c[1]);
    const text = item.value ? `${item.label} · ${item.value}` : item.label;
    const badgeW = item.badge ? r2(textWidth(item.badge, pillSize, 'body') + u(30)) : 0;
    const w0 = r2(textWidth(text, pillSize, 'body') + u(36)), w = r2(w0 + (badgeW ? badgeW + u(8) : 0)), h = r2(pillSize * 1.3 + u(16));
    // Above the country, else below, right or left; the first spot that is
    // clear of the other labels and inside the box.
    const lift = u(b.variant === 'pins' ? 50 : 16);
    const spots = [[px - w / 2, py - h - lift], [px - w / 2, py + u(16)], [px + u(20), py - h / 2], [px - w - u(20), py - h / 2]];
    const spot = spots.find(sp => within(sp, w, h) && clear(sp, w, h)) ?? spots.find(sp => within(sp, w, h)) ?? spots[0];
    const [lx, ly] = clampBox(spot[0], spot[1], w, h);
    placed.push({x: lx, y: ly, w, h});
    const time = rt(first + i * step);
    b.events.push({id: `${b.id}-highlight-${i}`, name: `highlight-${i}`, time, role: 'emphasis', cue: 'pop'});
    return {...item, d: COUNTRIES[item.id].d, px, py, text, pill: {x: lx, y: ly, w: w0, h}, badgeBox: badgeW ? {x: r2(lx + w0 + u(8)), y: ly, w: badgeW, h} : null, time, ink: inkOn(b.colors, item.color)};
  });

  // Pins, their labels and cards, after the countries.
  const pinSize = r2(Math.max(b.min.meta, u(32)));
  const cardTitle = r2(Math.max(b.min.meta, u(32))), cardSub = r2(Math.max(b.min.meta, u(28)));
  const pinMarks = pins.map((pin, i) => {
    const [px, py] = screen(pin.wx, pin.wy);
    if (px < box.x || px > box.x + box.width || py < box.y || py > box.y + box.height) check.fail(`params.pins[${i}]`, 'falls outside the map view; drop the far pin or set focus "world"');
    const time = rt(first + (items.length + i) * step);
    b.events.push({id: `${b.id}-pin-${i}`, name: `pin-${i}`, time, role: 'emphasis', cue: 'pop'});
    const lw = r2(Math.max(textWidth(pin.label, pinSize, 'body'), pin.sub ? textWidth(pin.sub, pinSize, 'body') : 0) + u(20));
    const lh = r2(pinSize * 1.25 * (pin.sub ? 2 : 1) + u(8));
    const spots = [[px - lw / 2, py + u(22)], [px - lw / 2, py - u(66) - lh], [px + u(30), py - lh / 2], [px - lw - u(30), py - lh / 2]];
    const spot = spots.find(sp => within(sp, lw, lh) && clear(sp, lw, lh)) ?? spots.find(sp => within(sp, lw, lh)) ?? spots[0];
    const [lx, ly] = clampBox(spot[0], spot[1], lw, lh);
    placed.push({x: lx, y: ly, w: lw, h: lh});
    let card = null;
    if (pin.card) {
      const imgH = pin.card.image ? u(b.portrait ? 200 : 230) : 0;
      const cw = r2(Math.max(u(b.portrait ? 300 : 320), textWidth(pin.card.title, cardTitle, 'body') + u(40), pin.card.sub ? textWidth(pin.card.sub, cardSub, 'body') + u(40) : 0));
      const ch = r2(u(18) + (imgH ? imgH + u(16) : 0) + cardTitle * 1.25 + (pin.card.sub ? cardSub * 1.3 : 0) + u(20));
      if (cw > box.width || ch > box.height) check.fail(`params.pins[${i}].card`, 'does not fit the map; shorten its text or drop the image');
      // The side of the map away from the pin, level with it where it fits.
      const right = px < box.x + box.width / 2;
      const want = [right ? box.x + box.width - cw - u(10) : box.x + u(10), py - ch / 2];
      const spot2 = [want, [want[0], box.y + u(10)], [want[0], box.y + box.height - ch - u(10)]].find(sp => within(sp, cw, ch) && clear(sp, cw, ch)) ?? want;
      const [cx, cy] = clampBox(spot2[0], spot2[1], cw, ch);
      placed.push({x: cx, y: cy, w: cw, h: ch});
      card = {...pin.card, x: cx, y: cy, w: cw, h: ch, imgH, time: rt(time + 0.3)};
    }
    return {...pin, px, py, labelBox: {x: lx, y: ly, w: lw, h: lh}, time, card};
  });
  let routes = [];
  const travel = journey || camera ? travelPlan(b, {items, marks, pins: pinMarks, journey, head, camera, first, t0, zoom, box, origin, s, W, H, worldH, fit, tx, ty, k}) : null;
  if (route && !journey) {
    routes = pinMarks.slice(1).map((pin, i) => {
      const a = pinMarks[i];
      const mx = (a.px + pin.px) / 2, my = (a.py + pin.py) / 2, dx = pin.px - a.px, dy = pin.py - a.py;
      const len = Math.hypot(dx, dy) || 1;
      const bend = Math.min(len * 0.22, u(160));
      const cx = r2(mx + dy / len * bend), cy = r2(my - dx / len * bend);
      const time = rt(Math.max(a.time + 0.25, pin.time - 0.55));
      b.events.push({id: `${b.id}-route-${i}`, name: `route-${i}`, time, role: 'emphasis', cue: 'whoosh-soft'});
      return {d: `M${a.px} ${a.py} Q${cx} ${cy} ${pin.px} ${pin.py}`, time, color: pin.color};
    });
  }
  const highlighted = new Set(items.map(i => i.id));
  const shown = Object.keys(COUNTRIES).filter(id => withPole || id !== ANTARCTICA);
  const rest = shown.filter(id => !highlighted.has(id)).map(id => COUNTRIES[id].d).join('');
  // The dot matrix: a dot pitch of about 13 px at the final zoom, over the view.
  let matrix = null;
  if (dots) {
    const view = [(-origin.x - (zoom ? tx : 0)) / (s * k), (-origin.y - (zoom ? ty : 0)) / (s * k), (W - origin.x - (zoom ? tx : 0)) / (s * k), (H - origin.y - (zoom ? ty : 0)) / (s * k)];
    const span = [view[0] - (view[2] - view[0]) * 0.08, view[1] - (view[3] - view[1]) * 0.08, view[2] + (view[2] - view[0]) * 0.08, view[3] + (view[3] - view[1]) * 0.08];
    let pitch = u(13) / (s * k);
    pitch = Math.max(pitch, Math.sqrt((span[2] - span[0]) * (span[3] - span[1]) / 9000));
    pitch = Math.round(pitch * 100) / 100;
    const byCountry = landDots(pitch, span, shown);
    matrix = {pitch, dot: r2(pitch * 0.58), rest: dotPath(shown.filter(id => !highlighted.has(id)).flatMap(id => byCountry[id] ?? [])), lit: items.map(item => dotPath(byCountry[item.id] ?? []))};
  }
  const lastTime = Math.max(t0 + 0.5, ...marks.map(m => m.time), ...pinMarks.map(pin => pin.card?.time ?? pin.time), ...(travel ? [travel.end] : []));
  const content = {variant: b.variant, travel, title: tb.title, source: tb.source, align: 'left', box, origin, s: r2(s * 1e4) / 1e4, worldH, rest, marks, pins: pinMarks, routes, matrix, zoom, t0, pillSize, pinSize, cardTitle, cardSub,
    buildEnd: rt(lastTime + 0.4), land: mixColor(b.colors.paper, b.colors.bg, 0.16), border: b.colors.bg, ink: b.theme.foreground, muted: b.theme.muted, panel: b.theme.panel, accent: b.colors.accent};
  return b.finish(content, {minTextPx: tb.title ? tb.title.size : b.min.key});
}

// ---------------------------------------------------------------------------
// Journey: a route that draws with a glowing head, countries lit on arrival
// and a camera that moves the drawn map as one image (RFC §E.5).

// The share of the route the glowing head covers, and the constant
// per-country arrival sequence (s): the border draws, the fill blooms, the
// label rises. Never a slice of the reveal, so a long border never flashes by.
export const ROUTE_HEAD = 0.03;
export const ARRIVAL = Object.freeze({border: 1.6, bloom: 0.3, settle: 0.5, label: 0.3, settled: 0.8});
// Camera moves and route legs: slow → fast → slow, no overshoot.
export const TRAVEL_EASE = 'power2.inOut';
const LEG = [1.2, 2.4];
const PUSH = 1.0, PULL = 1.2, MOVE = 1.6;

function cameraList(b, raw) {
  const {check} = b;
  check.arr(raw, 'params.camera', 1, 6);
  let last = -Infinity;
  return raw.map((key, i) => {
    const path = `params.camera[${i}]`;
    check.obj(key, path, ['at', 'centre', 'zoom'], ['at', 'centre']);
    const at = b.timeOf(`camera-${i}`, key.at, `${path}.at`, 1);
    if (at <= last) check.fail(`${path}.at`, 'must come after the key before it');
    last = at;
    check.arr(key.centre, `${path}.centre`, 2, 2);
    const lon = check.num(key.centre[0], `${path}.centre[0]`, -180, 180), lat = check.num(key.centre[1], `${path}.centre[1]`, -85, 85);
    return {at, centre: projectLonLat(lon, lat), zoom: key.zoom === undefined ? null : check.num(key.zoom, `${path}.zoom`, 1, 8)};
  });
}

/** The journey's route through the pins in world units: one path of quadratic legs, sampled by arc length. */
export function routeGeometry(points) {
  const legs = [], samples = [];
  let total = 0, d = `M${r2(points[0][0])} ${r2(points[0][1])}`;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    const len = Math.hypot(bx - ax, by - ay) || 1e-6;
    const bend = len * 0.22;
    const cx = (ax + bx) / 2 + (by - ay) / len * bend, cy = (ay + by) / 2 - (bx - ax) / len * bend;
    d += ` Q${r2(cx)} ${r2(cy)} ${r2(bx)} ${r2(by)}`;
    const at = q => [(1 - q) ** 2 * ax + 2 * (1 - q) * q * cx + q * q * bx, (1 - q) ** 2 * ay + 2 * (1 - q) * q * cy + q * q * by];
    let prev = at(0), legLen = 0;
    if (!samples.length) samples.push({x: prev[0], y: prev[1], length: 0});
    for (let n = 1; n <= 48; n++) {
      const pt = at(n / 48);
      legLen += Math.hypot(pt[0] - prev[0], pt[1] - prev[1]);
      samples.push({x: pt[0], y: pt[1], length: total + legLen});
      prev = pt;
    }
    legs.push({from: total, to: total + legLen});
    total += legLen;
  }
  for (const sample of samples) sample.f = sample.length / total;
  return {d, total, legs: legs.map(leg => ({from: leg.from / total, to: leg.to / total})), samples};
}

/** The route's normalised arc length nearest a world point. */
export function routeStop(geometry, [x, y]) {
  let best = geometry.samples[0];
  for (const sample of geometry.samples) if (Math.hypot(sample.x - x, sample.y - y) < Math.hypot(best.x - x, best.y - y)) best = sample;
  return best.f;
}

// The time an eased move from t over d reaches progress q (bisection on the ease).
function easedTime(t, d, q, ease = TRAVEL_EASE) {
  const fn = getEase(ease);
  let lo = 0, hi = 1;
  for (let n = 0; n < 40; n++) { const mid = (lo + hi) / 2; if (fn(mid) < q) lo = mid; else hi = mid; }
  return t + d * (lo + hi) / 2;
}

function travelPlan(b, {items, marks, pins, journey, head, camera, first, t0, zoom, box, origin, s, W, H, worldH, fit, tx, ty, k}) {
  const {check, unit} = b;
  // The overview: the zoom the map lands on (the whole route in view).
  const overview = {x: zoom ? tx : 0, y: zoom ? ty : 0, k: zoom ? k : 1};
  const view = (centre, kk) => ({x: r2(fit(W, WORLD_SIZE.width, origin.x, centre[0], kk)), y: r2(fit(H, worldH, origin.y, centre[1], kk)), k: r2(kk)});
  // Close enough to read the leg, never so close the 1:110m borders turn coarse.
  const kFollow = r2(Math.max(overview.k, Math.min(6, Math.max(2, overview.k * 1.6))));
  const segments = [];
  // The dot matrix starts near its final zoom and pushes in (as without a camera).
  if (zoom) segments.push({start: zoom.time, duration: zoom.duration, from: zoom.fromK !== 1 ? {x: zoom.fromX, y: zoom.fromY, k: zoom.fromK} : {x: 0, y: 0, k: 1}, to: overview, ease: zoom.fromK !== 1 ? 'power2.out' : 'power3.inOut'});
  let time = first;
  let geometry = null, legs = [], routeStart = null, routeEnd = null;
  if (journey) {
    geometry = routeGeometry(pins.map(pin => [pin.wx, pin.wy]));
    const longest = Math.max(...geometry.legs.map(leg => leg.to - leg.from));
    // The first pin drops, the camera pushes in on it (follow), then each leg draws.
    pins[0].time = rt(time);
    time += camera === 'follow' ? PUSH + 0.2 : 0.5;
    if (camera === 'follow') segments.push({start: rt(first + 0.2), duration: PUSH, from: overview, to: view([pins[0].wx, pins[0].wy], kFollow), ease: TRAVEL_EASE});
    routeStart = rt(time);
    legs = geometry.legs.map((leg, i) => {
      const duration = rt(LEG[0] + (LEG[1] - LEG[0]) * (leg.to - leg.from) / longest);
      const out = {...leg, time: rt(time), duration};
      if (camera === 'follow') segments.push({start: out.time, duration, from: view([pins[i].wx, pins[i].wy], kFollow), to: view([pins[i + 1].wx, pins[i + 1].wy], kFollow), ease: TRAVEL_EASE});
      time += duration;
      pins[i + 1].time = rt(time - 0.15);
      if (pins[i + 1].card) pins[i + 1].card.time = rt(pins[i + 1].time + 0.3);
      b.events.push({id: `${b.id}-route-${i}`, name: `route-${i}`, time: out.time, endTime: rt(out.time + duration), role: 'emphasis', cue: 'whoosh-soft'});
      return out;
    });
    routeEnd = rt(time);
    if (camera === 'follow') segments.push({start: rt(routeEnd + 0.3), duration: PULL, from: view([pins.at(-1).wx, pins.at(-1).wy], kFollow), to: overview, ease: TRAVEL_EASE});
    // Pins land when the route reaches them (their events move with them).
    pins.forEach((pin, i) => { const event = b.events.find(e => e.id === `${b.id}-pin-${i}`); if (event) event.time = pin.time; });
  }
  if (Array.isArray(camera)) {
    let from = overview, last = zoom ? zoom.time + zoom.duration : t0;
    for (const key of camera) {
      const to = view(key.centre, key.zoom ?? from.k);
      const duration = rt(Math.min(MOVE, key.at - last));
      if (duration <= 0) check.fail('params.camera', `each key needs time to move after the map lands (${rt(last - b.start)} s)`);
      segments.push({start: rt(key.at - duration), duration, from, to, ease: TRAVEL_EASE});
      from = to; last = key.at;
    }
  }
  // Countries: those that arrive by the route light when its head reaches
  // them (arc-length order); the rest keep their turn after the first pin.
  const lit = [];
  items.forEach((item, i) => {
    const byRoute = journey && item.arrive !== 'order';
    if (!byRoute) return;
    const f = routeStop(geometry, COUNTRIES[item.id].c);
    const leg = legs.find(l => f <= l.to + 1e-9) ?? legs.at(-1);
    const q = Math.min(1, Math.max(0, (f - leg.from) / Math.max(1e-9, leg.to - leg.from)));
    const trigger = rt(easedTime(leg.time, leg.duration, q));
    marks[i].time = trigger;
    marks[i].stop = r2(f * 1e4) / 1e4;
    const event = b.events.find(e => e.id === `${b.id}-highlight-${i}`);
    Object.assign(event, {time: trigger, endTime: rt(trigger + ARRIVAL.border)});
    lit.push(i);
  });
  // Per-node camera offsets: a screen-space node anchored at world point p sits
  // at its overview position plus the camera's shift of p. Translate and scale
  // tween with one ease, so p's screen position is linear in it too.
  const shift = (cam, [wx, wy]) => ({x: r2(cam.x + wx * s * cam.k - (overview.x + wx * s * overview.k)), y: r2(cam.y + wy * s * cam.k - (overview.y + wy * s * overview.k))});
  const kMax = Math.max(overview.k, ...segments.map(seg => seg.to.k));
  // Motion blur only at peak speed: the screen centre's travel at the move's
  // fastest point (1.5× the mean for power2.inOut), a quarter-frame of it.
  for (const seg of segments) {
    const centre = [(W / 2 - origin.x - seg.from.x) / (s * seg.from.k), (H / 2 - origin.y - seg.from.y) / (s * seg.from.k)];
    const end = shift(seg.to, centre), startShift = shift(seg.from, centre);
    const peak = 1.5 * Math.hypot(end.x - startShift.x, end.y - startShift.y) / seg.duration;
    const blur = r2(Math.min(6 * unit, peak / b.fps * 0.25) / Math.max(seg.from.k, seg.to.k));
    seg.blur = blur * Math.max(seg.from.k, seg.to.k) >= 0.75 * unit ? blur : 0;
  }
  const end = Math.max(routeEnd ?? 0, ...segments.map(seg => seg.start + seg.duration), ...marks.filter((m, i) => lit.includes(i)).map(m => m.time + ARRIVAL.border));
  if (end > b.start + b.lastEvent + 1e-6) check.fail('params', `the journey needs ${rt(end - b.start + b.duration - b.lastEvent)} s; make the scene at least that long or drop a pin`);
  return {segments, overview, kMax: r2(kMax), geometry: geometry ? {d: geometry.d} : null, head, routeStart, routeEnd, legs: legs.map(l => ({from: r2(l.from * 1e4) / 1e4, to: r2(l.to * 1e4) / 1e4, time: l.time, duration: l.duration})), lit,
    anchors: {marks: marks.map(m => anchorOps(segments, shift, COUNTRIES[m.id].c)), pins: pins.map(pin => anchorOps(segments, shift, [pin.wx, pin.wy]))}, end: rt(end)};
}

// The camera's shift of one world point at each segment's ends.
function anchorOps(segments, shift, point) {
  return segments.map(seg => ({start: seg.start, duration: seg.duration, ease: seg.ease, from: shift(seg.from, point), to: shift(seg.to, point)}));
}

// ---------------------------------------------------------------------------
// View

function mapView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const B = c.box;
  const kids = chromeNodes(model);
  const k = c.zoom ? c.zoom.k : 1;
  // Borders stay about one pixel wide at the final zoom.
  const stroke = r2(0.9 / (c.s * k));
  const outline = c.variant === 'outline';
  const paths = [];
  if (c.matrix) {
    paths.push(el('path', null, null, [], {d: c.matrix.rest, stroke: mixColor(c.ink, c.border, 0.3), strokeWidth: c.matrix.dot, strokeLinecap: 'round', fill: 'none'}));
    c.marks.forEach((m, i) => paths.push(el('path', `${id}-country-${i}`, {opacity: 0, filter: `drop-shadow(0 0 ${r2(4 / (c.s * k))}px ${m.color})`}, [], {d: c.matrix.lit[i], stroke: m.color, strokeWidth: r2(c.matrix.dot * 1.15), strokeLinecap: 'round', fill: 'none'})));
  } else {
    const land = outline ? mixColor(c.land, c.border, 0.45) : c.land;
    paths.push(el('path', null, null, [], {d: c.rest, fill: land, stroke: outline ? mixColor(c.muted, c.border, 0.5) : c.border, strokeWidth: stroke, strokeLinejoin: 'round'}));
    c.marks.forEach((m, i) => {
      paths.push(el('path', null, null, [], {d: m.d, fill: land, stroke: c.border, strokeWidth: stroke}));
      if (outline) {
        paths.push(el('path', `${id}-tint-${i}`, {opacity: 0}, [], {d: m.d, fill: hex2(m.color, 0.18), stroke: 'none'}));
        paths.push(el('path', `${id}-country-${i}`, {strokeDasharray: 1, strokeDashoffset: 1, filter: `drop-shadow(0 0 ${r2(5 / (c.s * k))}px ${m.color})`}, [], {d: m.d, fill: 'none', stroke: m.color, strokeWidth: r2(stroke * 2.6), strokeLinejoin: 'round', pathLength: 1}));
      } else paths.push(el('path', `${id}-country-${i}`, {opacity: 0, ...(c.variant === 'glow' ? {filter: `drop-shadow(0 0 ${r2(6 / (c.s * k))}px ${m.color})`} : {})}, [], {d: m.d, fill: m.color, stroke: c.variant === 'glow' ? mixColor('#ffffff', m.color, 0.5) : c.border, strokeWidth: r2(stroke * (c.variant === 'glow' ? 1.6 : 1))}));
    });
  }
  const T = c.travel;
  if (T) {
    // Strokes are sized for the middle of the camera's zoom range.
    const kRef = (T.overview.k + T.kMax) / 2, px = v => r2(v * u / (c.s * kRef));
    // A border that draws on arrival, for the fills (outline draws its own).
    if (!c.matrix && !outline) for (const i of T.lit) paths.push(el('path', `${id}-border-${i}`, {strokeDasharray: 1, strokeDashoffset: 1}, [], {d: c.marks[i].d, fill: 'none', stroke: mixColor('#ffffff', c.marks[i].color, 0.35), strokeWidth: r2(stroke * 2.4), strokeLinejoin: 'round', pathLength: 1}));
    if (T.geometry) {
      const color = c.pins[1]?.color ?? c.accent, d = T.geometry.d;
      paths.push(el('defs', null, null, [el('mask', `${id}-jmask`, null, [el('path', `${id}-jm`, {strokeDasharray: 1, strokeDashoffset: 1}, [], {d, stroke: '#ffffff', strokeWidth: px(12), strokeLinecap: 'round', fill: 'none', pathLength: 1})], {maskUnits: 'userSpaceOnUse', x: -100, y: -100, width: 1200, height: r2(c.worldH + 200)})]));
      paths.push(el('path', null, null, [], {d, stroke: color, strokeWidth: px(3.5), strokeDasharray: `${px(10)} ${px(9)}`, strokeLinecap: 'round', fill: 'none', mask: `url(#${id}-jmask)`}));
      if (T.head) {
        // The head: a wide soft glow under a white core, each a dash window moved along the route. No dark casing.
        const dash = {strokeDasharray: `${ROUTE_HEAD} 2`, strokeDashoffset: ROUTE_HEAD, opacity: 0};
        paths.push(el('path', `${id}-glow`, dash, [], {d, stroke: color, strokeOpacity: 0.45, strokeWidth: px(16), strokeLinecap: 'round', fill: 'none', pathLength: 1}));
        paths.push(el('path', `${id}-core`, dash, [], {d, stroke: '#ffffff', strokeWidth: px(4.5), strokeLinecap: 'round', fill: 'none', pathLength: 1}));
      }
    }
  }
  const world = el('div', `${id}-world`, {...abs(c.origin.x, c.origin.y, r2(1000 * c.s), r2(c.worldH * c.s)), transformOrigin: '0px 0px', opacity: 0}, [
    el('svg', null, {position: 'absolute', left: 0, top: 0, overflow: 'visible'}, paths, {width: r2(1000 * c.s), height: r2(c.worldH * c.s), viewBox: `0 0 1000 ${c.worldH}`})
  ]);
  kids.push(el('div', null, {...abs(B.x, B.y, B.width, B.height), overflow: 'hidden'}, [world]));
  // With a camera, nodes pinned to a place ride in an anchor the timeline
  // moves with the map, inside a box that clips them like the map.
  const anchored = [];
  const holder = (kind, i) => {
    if (!T) return kids;
    const group = [];
    anchored.push(el('div', `${id}-anchor-${kind}${i}`, abs(0, 0, W, H), group));
    return group;
  };
  const W = model.rect.width, H = model.rect.height;
  c.marks.forEach((m, i) => {
    const kids = holder('m', i);
    if (c.variant === 'pins') kids.push(pinNode(`${id}-pin-${i}`, m.px, m.py, m.color, c.border, u));
    const P = m.pill;
    kids.push(el('div', `${id}-label-${i}`, {...abs(P.x, P.y, P.w, P.h), boxSizing: 'border-box', borderRadius: 99, background: c.variant === 'fill' ? m.color : c.panel, border: `${r2(2 * u)}px solid ${m.color}`, opacity: 0}, [
      label(null, 0, r2(8 * u), P.w, m.text, {size: c.pillSize, family: fonts.body, color: c.variant === 'fill' ? m.ink : c.ink, align: 'center', weight: 650, lineHeight: 1.3})
    ]));
    if (m.badgeBox) {
      const Q = m.badgeBox;
      kids.push(el('div', `${id}-badge-${i}`, {...abs(Q.x, Q.y, Q.w, Q.h), boxSizing: 'border-box', borderRadius: 99, background: c.accent, boxShadow: `0 0 ${r2(18 * u)}px ${hex2(c.accent, 0.55)}`, opacity: 0}, [
        label(null, 0, r2(8 * u), Q.w, m.badge, {size: c.pillSize, family: fonts.body, color: inkOn({ink: c.border, paper: c.ink, bg: c.border}, c.accent), align: 'center', weight: 800, lineHeight: 1.3})
      ]));
    }
  });
  c.routes.forEach((r, i) => kids.push(svgRoot(W, H, [el('defs', null, null, [el('mask', `${id}-rmask-${i}`, null, [el('path', `${id}-rm-${i}`, {strokeDasharray: 1, strokeDashoffset: 1}, [], {d: r.d, stroke: '#ffffff', strokeWidth: r2(10 * u), strokeLinecap: 'round', fill: 'none', pathLength: 1})], {maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: W, height: H})]),
    el('path', null, null, [], {d: r.d, stroke: r.color, strokeWidth: r2(3.5 * u), strokeDasharray: `${r2(10 * u)} ${r2(9 * u)}`, strokeLinecap: 'round', fill: 'none', mask: `url(#${id}-rmask-${i})`})])));
  const cards = [];
  c.pins.forEach((pin, i) => {
    const kids = holder('p', i);
    const d = r2(22 * u);
    kids.push(el('div', `${id}-pulse-${i}`, abs(r2(pin.px - d), r2(pin.py - d), r2(d * 2), r2(d * 2), {borderRadius: '50%', border: `${r2(3 * u)}px solid ${pin.color}`, boxSizing: 'border-box', opacity: 0})));
    kids.push(pinNode(`${id}-place-${i}`, pin.px, pin.py, pin.color, c.border, u, {glow: true}));
    const L = pin.labelBox;
    kids.push(el('div', `${id}-placel-${i}`, abs(L.x, L.y, L.w, L.h, {opacity: 0}), [
      label(null, 0, r2(4 * u), L.w, pin.label, {size: c.pinSize, family: fonts.body, color: c.ink, align: 'center', weight: 700, extra: {textShadow: `0 0 ${r2(10 * u)}px ${c.border}`}}),
      ...(pin.sub ? [label(null, 0, r2(4 * u + c.pinSize * 1.25), L.w, pin.sub, {size: c.pinSize, family: fonts.body, color: pin.color, align: 'center', weight: 800, extra: {textShadow: `0 0 ${r2(10 * u)}px ${c.border}`}})] : [])
    ]));
    if (pin.card) {
      const C = pin.card;
      const inner = [];
      let y = r2(18 * u);
      if (C.image) {
        inner.push(el('img', null, abs(r2(18 * u), y, r2(C.w - 36 * u), C.imgH, {objectFit: 'cover', borderRadius: r2(12 * u), display: 'block'}), [], {src: C.image, alt: ''}));
        y = r2(y + C.imgH + 16 * u);
      }
      inner.push(label(null, 0, y, C.w, C.title, {size: c.cardTitle, family: fonts.body, color: c.ink, align: 'center', weight: 700, lineHeight: 1.25}));
      if (C.sub) inner.push(label(null, 0, r2(y + c.cardTitle * 1.25), C.w, C.sub, {size: c.cardSub, family: fonts.body, color: pin.color, align: 'center', weight: 600, lineHeight: 1.3}));
      cards.push(el('div', `${id}-card-${i}`, {...abs(C.x, C.y, C.w, C.h), boxSizing: 'border-box', borderRadius: r2(20 * u), background: hex2(c.panel, 0.92), border: `${r2(2 * u)}px solid ${hex2(pin.color, 0.6)}`,
        boxShadow: `0 0 ${r2(30 * u)}px ${hex2(pin.color, 0.22)}`, opacity: 0}, inner));
    }
  });
  if (anchored.length) kids.push(el('div', null, {...abs(B.x, B.y, B.width, B.height), overflow: 'hidden'}, [el('div', null, abs(-B.x, -B.y, W, H), anchored)]));
  kids.push(...cards);
  return kids;
}

/** A teardrop pin whose tip sits on (x, y). */
function pinNode(nodeId, x, y, color, border, u, {glow = false} = {}) {
  const d = r2(34 * u);
  return el('div', nodeId, abs(r2(x - d / 2), r2(y - d * 1.3), d, r2(d * 1.3), {opacity: 0, transformOrigin: '50% 100%', ...(glow ? {filter: `drop-shadow(0 0 ${r2(8 * u)}px ${color})`} : {})}), [
    svgRoot(d, r2(d * 1.3), [el('path', null, null, [], {d: `M${r2(d / 2)} ${r2(d * 1.3)} C${r2(d * 0.15)} ${r2(d * 0.75)} 0 ${r2(d * 0.6)} 0 ${r2(d / 2)} A${r2(d / 2)} ${r2(d / 2)} 0 1 1 ${d} ${r2(d / 2)} C${d} ${r2(d * 0.6)} ${r2(d * 0.85)} ${r2(d * 0.75)} ${r2(d / 2)} ${r2(d * 1.3)} Z`, fill: color, stroke: border, strokeWidth: r2(2 * u)}),
      el('circle', null, null, [], {cx: r2(d / 2), cy: r2(d / 2), r: r2(d * 0.17), fill: border})])
  ]);
}

function dropOps(ops, nodeId, start, time, u) {
  set(ops, nodeId, start, {opacity: 0, x: 0, y: r2(-60 * u), scaleX: 1, scaleY: 1});
  tw(ops, nodeId, time, 0.1, 'power1.out', {opacity: 0}, {opacity: 1});
  tw(ops, nodeId, time, 0.55, 'power3.out', {y: r2(-60 * u)}, {y: 0});
}

// ---------------------------------------------------------------------------
// Timeline

function mapTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  const Z = c.zoom;
  const from = Z && c.matrix ? {x: Z.fromX, y: Z.fromY, scaleX: Z.fromK, scaleY: Z.fromK} : {x: 0, y: 0, scaleX: 1, scaleY: 1};
  const T = c.travel;
  set(ops, `${id}-world`, start, {opacity: 0, ...from, ...(T ? {blur: 0} : {})});
  tw(ops, `${id}-world`, c.t0, 0.5, 'power2.out', {opacity: 0}, {opacity: 1});
  if (T) travelOps(model, ops);
  else if (Z) tw(ops, `${id}-world`, Z.time, Z.duration, c.matrix ? 'power2.out' : 'power3.inOut', from, {x: Z.x, y: Z.y, scaleX: Z.k, scaleY: Z.k});
  c.marks.forEach((m, i) => {
    if (T?.lit.includes(i)) arrivalOps(model, ops, m, i);
    else if (c.variant === 'outline') {
      drawOps(ops, `${id}-country-${i}`, start, m.time, 0.9, 'power2.inOut');
      set(ops, `${id}-tint-${i}`, start, {opacity: 0});
      tw(ops, `${id}-tint-${i}`, rt(m.time + 0.5), 0.5, 'power2.out', {opacity: 0}, {opacity: 1});
    } else {
      set(ops, `${id}-country-${i}`, start, {opacity: 0});
      tw(ops, `${id}-country-${i}`, m.time, 0.4, 'power2.out', {opacity: 0}, {opacity: 1});
    }
    if (T?.lit.includes(i)) return;
    if (c.variant === 'pins') dropOps(ops, `${id}-pin-${i}`, start, rt(m.time + 0.05), u);
    popOps(ops, `${id}-label-${i}`, start, rt(m.time + 0.15), {from: 0.6});
    if (m.badgeBox) popOps(ops, `${id}-badge-${i}`, start, rt(m.time + 0.35), {from: 0.4, duration: 0.45, ease: 'power3.out'});
  });
  c.routes.forEach((r, i) => {
    set(ops, `${id}-rm-${i}`, start, {strokeDashoffset: 1});
    tw(ops, `${id}-rm-${i}`, r.time, 0.6, 'power2.inOut', {strokeDashoffset: 1}, {strokeDashoffset: 0});
  });
  c.pins.forEach((pin, i) => {
    dropOps(ops, `${id}-place-${i}`, start, pin.time, u);
    set(ops, `${id}-pulse-${i}`, start, {opacity: 0, x: 0, y: 0, scaleX: 0.3, scaleY: 0.3});
    tw(ops, `${id}-pulse-${i}`, rt(pin.time + 0.4), 0.9, 'power2.out', {opacity: 0.9, scaleX: 0.3, scaleY: 0.3}, {opacity: 0, scaleX: 1.6, scaleY: 1.6});
    riseOps(ops, `${id}-placel-${i}`, start, rt(pin.time + 0.2), r2(12 * u));
    if (pin.card) popOps(ops, `${id}-card-${i}`, start, pin.card.time, {from: 0.9, duration: 0.45, ease: 'power3.out', fade: 0.3});
  });
}

const camProps = v => ({x: v.x, y: v.y, scaleX: v.k, scaleY: v.k});

// The camera moves, the route and its head, and the anchors that ride with the map.
function travelOps(model, ops) {
  const {id, start} = model;
  const T = model.content.travel;
  for (const seg of T.segments) {
    tw(ops, `${id}-world`, seg.start, seg.duration, seg.ease, camProps(seg.from), camProps(seg.to));
    if (seg.blur) {
      const half = rt(seg.duration / 2);
      tw(ops, `${id}-world`, seg.start, half, 'power2.in', {blur: 0}, {blur: seg.blur});
      tw(ops, `${id}-world`, rt(seg.start + half), rt(seg.duration - half), 'power2.out', {blur: seg.blur}, {blur: 0});
    }
  }
  for (const [kind, list] of [['m', T.anchors.marks], ['p', T.anchors.pins]]) list.forEach((moves, i) => {
    set(ops, `${id}-anchor-${kind}${i}`, start, {x: moves[0]?.from.x ?? 0, y: moves[0]?.from.y ?? 0});
    for (const move of moves) tw(ops, `${id}-anchor-${kind}${i}`, move.start, move.duration, move.ease, move.from, move.to);
  });
  if (!T.geometry) return;
  set(ops, `${id}-jm`, start, {strokeDashoffset: 1});
  if (T.head) for (const part of ['glow', 'core']) set(ops, `${id}-${part}`, start, {opacity: 0, strokeDashoffset: ROUTE_HEAD});
  for (const leg of T.legs) {
    tw(ops, `${id}-jm`, leg.time, leg.duration, TRAVEL_EASE, {strokeDashoffset: r2(1 - leg.from)}, {strokeDashoffset: r2(1 - leg.to)});
    if (T.head) for (const part of ['glow', 'core']) tw(ops, `${id}-${part}`, leg.time, leg.duration, TRAVEL_EASE, {strokeDashoffset: r2(ROUTE_HEAD - leg.from)}, {strokeDashoffset: r2(ROUTE_HEAD - leg.to)});
  }
  if (T.head) for (const part of ['glow', 'core']) {
    tw(ops, `${id}-${part}`, T.routeStart, 0.15, 'power1.out', {opacity: 0}, {opacity: 1});
    tw(ops, `${id}-${part}`, T.routeEnd, 0.5, 'power1.inOut', {opacity: 1}, {opacity: 0});
  }
}

// A country the route reaches: the border draws, the fill blooms past its
// settled opacity and settles (elements may overshoot; the camera may not),
// the label rises. Constant durations.
function arrivalOps(model, ops, m, i) {
  const {id, start, unit: u} = model;
  const c = model.content;
  const t = m.time;
  if (c.variant === 'outline') {
    drawOps(ops, `${id}-country-${i}`, start, t, ARRIVAL.border, 'power2.inOut');
    set(ops, `${id}-tint-${i}`, start, {opacity: 0});
    tw(ops, `${id}-tint-${i}`, rt(t + ARRIVAL.label), ARRIVAL.bloom, 'power2.out', {opacity: 0}, {opacity: 1});
  } else {
    if (!c.matrix) drawOps(ops, `${id}-border-${i}`, start, t, ARRIVAL.border, 'power2.inOut');
    set(ops, `${id}-country-${i}`, start, {opacity: 0});
    tw(ops, `${id}-country-${i}`, rt(t + 0.1), ARRIVAL.bloom, 'power2.out', {opacity: 0}, {opacity: 1});
    tw(ops, `${id}-country-${i}`, rt(t + 0.1 + ARRIVAL.bloom), ARRIVAL.settle, 'power2.inOut', {opacity: 1}, {opacity: ARRIVAL.settled});
  }
  if (c.variant === 'pins') dropOps(ops, `${id}-pin-${i}`, start, rt(t + 0.05), u);
  riseOps(ops, `${id}-label-${i}`, start, rt(t + ARRIVAL.label), r2(14 * u));
  if (m.badgeBox) popOps(ops, `${id}-badge-${i}`, start, rt(t + ARRIVAL.label + 0.2), {from: 0.4, duration: 0.45, ease: 'power3.out'});
}

export const mapHighlight = {
  id: 'map-highlight',
  describe: 'A world map that fades in, zooms to the highlighted countries and pinned places when they sit close together, then fills the countries one by one with label pills and ×multiplier badges ("$20 · ×3.2"), drops pins on places by longitude and latitude with a label or a glass callout card (a photo card with an image), and draws a dashed travel route between the pins, or a journey: one route with a glowing head that lights each country as it arrives while the camera follows it. Variants: plain fills, pins, glow, a glowing outline that traces itself, and a dot-matrix world.',
  params: {highlight: '[country | {country (name, common alias or ISO numeric code), label? ≤ 24, value? ≤ 12, badge? ≤ 8 ("×3.2"), color?, arrive? "route" (default with a journey route: the country lights when the route reaches it, its border drawing over 1.6 s) | "order"}] 1–8 (one of highlight or pins, or both)',
    pins: '[{lon, lat, label ≤ 28, sub? ≤ 20 ("Ph.D. 2008"), card?: {title ≤ 28, sub? ≤ 32, image? (assets/… photo)}, color?}] 1–4 places; at most two cards (events pin-<i>)',
    route: 'true: a dashed travel path from pin to pin, in order, each leg drawn as its pin lands | {head?: boolean (default true)}: the journey, one route that draws leg by leg with a bright glowing head, each pin landing as the route reaches it (default false; events route-<i>)',
    camera: '"follow" (with a journey route: push in on the first pin, follow the head leg by leg, pull back to the whole route) | [{at, centre: [lon, lat], zoom? 1–8}] 1–6 keys the camera arrives at (optional; the drawn map moves as one image, slow → fast → slow, no overshoot)', focus: '"auto" (zoom when the places are close; default) | "world"',
    tone: 'primary | accent | paper | #rrggbb', title: 'string ≤ 60 (optional)', source: 'string ≤ 80 (optional)', at: `map lands: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['build', 'zoom', 'highlight-<i>', 'pin-<i>', 'route-<i>'], timing: timingRules({rules: ['the zoom runs 1.2 s from at + 0.35 (the dot matrix pushes in over 2 s); highlights, then pins, follow 0.12–0.5 s apart', 'each route leg draws as its pin lands', 'a journey route: legs take 1.2–2.4 s by length; a country lights when the head reaches it and its sequence takes 1.6 s, so the scene must run to the last arrival']}), variants: MAP_VARIANTS,
  resolve: mapResolve, view: mapView, timeline: mapTimeline
};

export const MAPS = [mapHighlight];

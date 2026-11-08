// ui-scene arrangements: a stack element with arrange "fan", "wall", "stack"
// or "orbit" lays its children out as a layered collage that fills the frame
// at several depths, the way the reference UI-explainer reels do: one sharp
// front panel (the first child, the hero) and the rest fanned, walled,
// cascaded or orbiting behind it, each tilted, smaller, dimmer and softer the
// deeper it sits (depth draws that; kit/core/ui-paint.mjs uiDepthAt).
//
// The arrangement works in screen space: it decides where each card should
// show (design px) and then places its rect so that, once its tilt, its
// depth and the stage's dolly have moved it, the card shows there, inside
// the arrangement's region (its rect, default the whole stage). The hero is
// kept out of the caption band when the region has room above or below it;
// the dim back layers may run behind the captions, as in the reference.
//
// expandArrangements turns each arranged stack into ordinary top-level
// elements (rect, tilt, depth, z, at), so validation, the layout checks and
// both painters see nothing new.

export const ARRANGEMENTS = Object.freeze(['fan', 'wall', 'stack', 'orbit']);
// Children each arrangement takes (the hero included).
export const ARRANGE_COUNT = Object.freeze({fan: [2, 5], wall: [3, 16], stack: [2, 5], orbit: [3, 7]});
// Keys an arranged stack takes; its children take any element key but these.
export const ARRANGE_KEYS = Object.freeze(['id', 'kind', 'arrange', 'rect', 'at', 'enter', 'enterDuration', 'out', 'exit', 'children', 'cue']);
const CHILD_FORBIDDEN = Object.freeze(['rect', 'depth', 'tilt']);
// Kinds an arrangement cannot place: text is checked against the safe zone
// and caption band on its own, and light is not a card.
const UNARRANGED = new Set(['headline', 'chip', 'bloom', 'burst', 'host', 'stack']);
// Seconds between children entering, front to back.
const STAGGER = 0.07;
// The z of an element listed after a stack: above the hero (z 40 at most).
const ABOVE_ARRANGED = 41;

const r2 = (value) => Math.round(value * 100) / 100;

/**
 * Where each child of an arrangement should show (design px, screen space):
 * [{rect, tilt, depth}], the hero first. region: {x, y, width, height};
 * band: the caption band {y, height} the hero keeps clear of.
 */
export function arrangementSlots(type, n, region, band) {
  const R = region, cx = R.x + R.width / 2;
  const box = (mx, my, w, h) => ({x: mx - w / 2, y: my - h / 2, width: w, height: h});
  // The hero's centre y and height: mid-region, moved above (or below) the
  // caption band when there is room, shortened to the larger side (down to
  // 60% of its height) when there is not quite.
  const heroY = (h, prefer) => {
    if (!band) return [prefer, h];
    const top = prefer - h / 2, bottom = prefer + h / 2, b0 = band.y, b1 = band.y + band.height;
    if (bottom <= b0 || top >= b1) return [prefer, h];
    const above = b0 - R.y, below = R.y + R.height - b1;
    if (above >= h) return [Math.min(prefer, b0 - h / 2), h];
    if (below >= h) return [Math.max(prefer, b1 + h / 2), h];
    const room = Math.max(above, below);
    if (room < h * 0.6) return [prefer, h];
    return above >= below ? [R.y + room / 2, room] : [b1 + room / 2, room];
  };
  const slots = [];
  if (type === 'fan') {
    // A hand of cards: the hero centred, the rest fanned out behind it on a
    // diagonal (left and up, right and down), so the fan runs top to bottom.
    const w = R.width * 0.8, h = R.height * 0.44;
    const [hy, hh] = heroY(h, R.y + R.height * 0.48);
    slots.push({rect: box(cx, hy, w, hh), tilt: {x: 6, y: -8, z: -1}, depth: 0});
    for (let k = 1; k < n; k++) {
      const side = k % 2 ? -1 : 1, ring = Math.ceil(k / 2), f = Math.pow(0.86, ring);
      slots.push({rect: box(cx + side * ring * R.width * 0.17, hy + side * ring * R.height * 0.27, w * f, h * f),
        tilt: {x: 8, y: side * -20, z: side * 5 * ring}, depth: Math.min(1, 0.4 * ring)});
    }
  } else if (type === 'wall') {
    // A main panel in front of a wall of small cards that fills the region,
    // curving away at the sides.
    const w = R.width * 0.84, h = R.height * 0.42;
    const [hy, hh] = heroY(h, R.y + R.height * 0.5);
    slots.push({rect: box(cx, hy, w, hh), tilt: {x: 6}, depth: 0});
    const m = n - 1, cols = m <= 4 ? 2 : m <= 9 ? 3 : 4, rows = Math.ceil(m / cols), gap = 22;
    const cw = (R.width - gap * (cols - 1)) / cols;
    const ch = Math.min((R.height - gap * (rows - 1)) / rows, cw * 1.1);
    const top = R.y + (R.height - (rows * ch + gap * (rows - 1))) / 2;
    for (let i = 0; i < m; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const off = cols > 1 ? (col - (cols - 1) / 2) / ((cols - 1) / 2) : 0;
      slots.push({rect: {x: R.x + col * (cw + gap), y: top + row * (ch + gap), width: cw, height: ch},
        tilt: {x: 10, y: off * -14}, depth: 0.85});
    }
  } else if (type === 'stack') {
    // A cascade: the hero at the top, each card behind it lower, smaller and
    // deeper, so the deck runs down to the region's foot.
    const w = R.width * 0.86, h = R.height * 0.4;
    const [hy, hh] = heroY(h, R.y + h / 2);
    slots.push({rect: box(cx, hy, w, hh), tilt: {x: 10}, depth: 0});
    const room = R.y + R.height - (hy + hh / 2);
    for (let k = 1; k < n; k++) {
      const f = Math.pow(0.9, k), ck = h * f;
      const bottom = hy + hh / 2 + room * (k / (n - 1));
      slots.push({rect: box(cx + (k % 2 ? -1 : 1) * R.width * 0.035 * k, bottom - ck / 2, w * f, ck), tilt: {x: 14, z: (k % 2 ? -1 : 1) * 2.5}, depth: Math.min(1, 0.3 * k)});
    }
  } else if (type === 'orbit') {
    // The hero at the centre, the rest on an ellipse around it: the top of
    // the orbit far, its foot near, each card turned toward the centre.
    const w = R.width * 0.62, h = R.height * 0.34;
    const [hy, hh] = heroY(h, R.y + R.height / 2);
    slots.push({rect: box(cx, hy, w, hh), tilt: {x: 6}, depth: 0});
    const m = n - 1, sw = R.width * 0.42, sh = R.height * 0.2;
    const rx = (R.width - sw) / 2, ry = (R.height - sh) / 2;
    const oy = R.y + R.height / 2;
    for (let i = 0; i < m; i++) {
      const a = -Math.PI / 2 + (i + 0.5) * (2 * Math.PI / m) - Math.PI / m;
      const sin = Math.sin(a), cos = Math.cos(a);
      slots.push({rect: box(cx + cos * rx, oy + sin * ry, sw, sh), tilt: {x: 8, y: -cos * 22}, depth: r2(0.6 - 0.3 * sin)});
    }
  }
  return slots.map((slot) => ({rect: rounded(slot.rect), tilt: Object.fromEntries(Object.entries(slot.tilt).map(([axis, deg]) => [axis, r2(deg) + 0])), depth: r2(slot.depth)}));
}

/**
 * Fit a slot: the rect whose footprint (footprint(rect, tilt, depth), as the
 * module checks it) shows at the slot, kept inside the bounds and no
 * smaller than min.
 */
export function fitSlot(slot, bounds, footprint, min) {
  let rect = {...slot.rect};
  const target = slot.rect;
  for (let pass = 0; pass < 8; pass++) {
    const shown = footprint(rect, slot.tilt, slot.depth);
    // Size: scale toward the slot's size, then into the bounds.
    let k = Math.min(target.width / shown.width, target.height / shown.height);
    k = Math.min(k, bounds.width / shown.width, bounds.height / shown.height);
    if (min) k = Math.max(k, min.width / rect.width, min.height / rect.height);
    const width = rect.width * k, height = rect.height * k;
    // Position: the shown centre on the slot's centre, then shifted into the bounds.
    const scx = shown.x + shown.width / 2, scy = shown.y + shown.height / 2;
    let x = rect.x + (target.x + target.width / 2 - scx) - (width - rect.width) / 2;
    let y = rect.y + (target.y + target.height / 2 - scy) - (height - rect.height) / 2;
    const next = footprint({x, y, width, height}, slot.tilt, slot.depth);
    if (next.x < bounds.x) x += bounds.x - next.x;
    else if (next.x + next.width > bounds.x + bounds.width) x -= next.x + next.width - bounds.x - bounds.width;
    if (next.y < bounds.y) y += bounds.y - next.y;
    else if (next.y + next.height > bounds.y + bounds.height) y -= next.y + next.height - bounds.y - bounds.height;
    const moved = Math.abs(x - rect.x) + Math.abs(y - rect.y) + Math.abs(width - rect.width) + Math.abs(height - rect.height);
    rect = {x, y, width, height};
    if (moved < 0.5) break;
  }
  // Round to 0.01 px, then nudge (or, for steep tilts, shrink) until the
  // footprint sits inside the bounds; a panel at its minimum size is left
  // for the module's own stage check to report.
  let out = {x: r2(rect.x), y: r2(rect.y), width: Math.floor(rect.width * 100) / 100, height: Math.floor(rect.height * 100) / 100};
  for (let pass = 0; pass < 6; pass++) {
    const shown = footprint(out, slot.tilt, slot.depth);
    const left = bounds.x - shown.x, top = bounds.y - shown.y;
    const right = shown.x + shown.width - bounds.x - bounds.width, bottom = shown.y + shown.height - bounds.y - bounds.height;
    if (Math.max(left, top, right, bottom) <= 0.01) break;
    const scale = shown.width > 0 ? out.width / shown.width : 1;
    const dx = left > 0 && right <= 0 ? left + 0.05 : right > 0 && left <= 0 ? -(right + 0.05) : 0;
    const dy = top > 0 && bottom <= 0 ? top + 0.05 : bottom > 0 && top <= 0 ? -(bottom + 0.05) : 0;
    if ((dx || dy) && !((left > 0 && right > 0) || (top > 0 && bottom > 0))) {
      out = {...out, x: r2(out.x + dx * scale), y: r2(out.y + dy * scale)};
      continue;
    }
    if (min && (out.width <= min.width + 0.5 || out.height <= min.height + 0.5)) break;
    const k = Math.min(1, bounds.width / shown.width, bounds.height / shown.height) * 0.995;
    out = {x: r2(out.x + out.width * (1 - k) / 2), y: r2(out.y + out.height * (1 - k) / 2), width: Math.floor(out.width * k * 100) / 100, height: Math.floor(out.height * k * 100) / 100};
  }
  return out;
}

/**
 * The scene's elements with every arranged stack replaced by its children,
 * placed: [{raw, path}]. check: the module's validator; stage: the stage
 * rect; band: the caption band; footprint(rect, tilt, depth): where a
 * top-level box shows; minSize: kind → {width, height}.
 */
export function expandArrangements(check, elements, {stage, band, footprint, minSize = {}}) {
  const out = [];
  elements.forEach((raw, index) => {
    const path = `params.elements[${index}]`;
    if (!raw || typeof raw !== 'object' || raw.arrange === undefined) {
      // List order is draw order: an element listed after an arranged stack
      // (a burst, a bloom, a chip on the hero) draws over the stack's z-indexed
      // cards unless it names its own z.
      const over = raw && typeof raw === 'object' && raw.z === undefined && elements.slice(0, index).some((item) => item?.arrange !== undefined);
      out.push({raw: over ? {...raw, z: ABOVE_ARRANGED} : raw, path});
      return;
    }
    check.obj(raw, path, ARRANGE_KEYS, ['kind', 'arrange', 'at', 'children']);
    if (raw.kind !== 'stack') check.fail(`${path}.arrange`, `arranges a stack's children; set kind "stack" (it is "${raw.kind}")`);
    const type = check.oneOf(raw.arrange, `${path}.arrange`, ARRANGEMENTS);
    const [lo, hi] = ARRANGE_COUNT[type];
    if (!Array.isArray(raw.children) || raw.children.length < lo || raw.children.length > hi) check.fail(`${path}.children`, `must list ${lo}–${hi} panels for arrange "${type}" (the first is the front, sharp hero)`);
    let region = stage;
    if (raw.rect !== undefined) {
      check.obj(raw.rect, `${path}.rect`, ['x', 'y', 'width', 'height'], ['x', 'y', 'width', 'height']);
      const r = {x: check.num(raw.rect.x, `${path}.rect.x`, -2000, 4000), y: check.num(raw.rect.y, `${path}.rect.y`, -2000, 4000), width: check.num(raw.rect.width, `${path}.rect.width`, 200, 4000), height: check.num(raw.rect.height, `${path}.rect.height`, 200, 4000)};
      const x0 = Math.max(r.x, stage.x), y0 = Math.max(r.y, stage.y), x1 = Math.min(r.x + r.width, stage.x + stage.width), y1 = Math.min(r.y + r.height, stage.y + stage.height);
      if (x1 - x0 < 200 || y1 - y0 < 200) check.fail(`${path}.rect`, `must overlap the stage {x: ${stage.x}, y: ${stage.y}, width: ${stage.width}, height: ${stage.height}} by at least 200×200 (design px)`);
      region = {x: x0, y: y0, width: x1 - x0, height: y1 - y0};
    }
    raw.children.forEach((child, k) => {
      const at = `${path}.children[${k}]`;
      if (!child || typeof child !== 'object') check.fail(at, 'must be an element object');
      for (const key of CHILD_FORBIDDEN) if (child[key] !== undefined) check.fail(`${at}.${key}`, `is set by arrange "${type}"; drop it, or take the element out of the arrangement to place it by hand`);
      if (UNARRANGED.has(child.kind)) check.fail(`${at}.kind`, `is ${child.kind}; an arrangement places panels (window, timeline, terminal, card-wall…). Put headlines, chips, hosts, blooms and bursts beside the stack as their own elements`);
    });
    const slots = arrangementSlots(type, raw.children.length, region, band);
    // Deeper cards draw behind; z breaks ties among cards at one depth, the hero on top.
    raw.children.forEach((child, k) => {
      const slot = slots[k];
      const rect = fitSlot(slot, region, footprint, minSize[child.kind]);
      const tilt = Object.fromEntries(Object.entries(slot.tilt).filter(([, v]) => v !== 0));
      const enterAt = child.at ?? (typeof raw.at === 'number' ? r2(raw.at + k * STAGGER) : raw.at);
      const placed = {...child, rect, ...(Object.keys(tilt).length ? {tilt} : {}), ...(slot.depth ? {depth: slot.depth} : {}),
        z: child.z ?? Math.max(0, 40 - Math.round(slot.depth * 30) - (k ? 1 : 0)),
        at: enterAt,
        ...(Array.isArray(child.children) ? {children: fitInside(child.children, rect, enterAt)} : {}),
        ...(child.enter === undefined && raw.enter !== undefined ? {enter: raw.enter} : {}),
        ...(child.enterDuration === undefined && raw.enterDuration !== undefined ? {enterDuration: raw.enterDuration} : {}),
        ...(child.out === undefined && raw.out !== undefined ? {out: raw.out} : {}),
        ...(child.exit === undefined && raw.exit !== undefined ? {exit: raw.exit} : {}),
        ...(child.id === undefined && raw.id !== undefined ? {id: `${raw.id}-${k}`} : {}),
        ...(k && child.cue === undefined ? {cue: null} : child.cue === undefined && raw.cue !== undefined ? {cue: raw.cue} : {})};
      out.push({raw: placed, path: `${path}.children[${k}]`});
    });
  });
  return out;
}

/**
 * An arranged panel's own children, laid out for whatever size the director
 * had in mind, scaled down (about the panel's origin) to fit the size the
 * arrangement gave it, and entering no earlier than it.
 */
function fitInside(children, rect, at) {
  const valid = children.filter((c) => c && typeof c === 'object' && c.rect && typeof c.rect === 'object');
  const extentW = Math.max(0, ...valid.map((c) => Number(c.rect.x) + Number(c.rect.width))) + 20;
  const extentH = Math.max(0, ...valid.map((c) => Number(c.rect.y) + Number(c.rect.height))) + 20;
  const k = Math.min(1, rect.width / extentW, rect.height / extentH);
  const walk = (list) => list.map((c) => {
    if (!c || typeof c !== 'object') return c;
    const next = {...c};
    if (k < 1 && c.rect && typeof c.rect === 'object' && [c.rect.x, c.rect.y, c.rect.width, c.rect.height].every(Number.isFinite)) {
      next.rect = {x: r2(c.rect.x * k), y: r2(c.rect.y * k), width: r2(c.rect.width * k), height: r2(c.rect.height * k)};
    }
    if (typeof at === 'number' && typeof c.at === 'number' && c.at < at) next.at = at;
    if (Array.isArray(c.children)) next.children = walk(c.children);
    return next;
  });
  return walk(children);
}

function rounded(rect) {
  return {x: r2(rect.x), y: r2(rect.y), width: r2(rect.width), height: r2(rect.height)};
}

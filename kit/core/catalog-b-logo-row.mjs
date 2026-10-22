// Catalogue B module `logo-row`: params → model (resolve), model → static
// element tree (view) and renderer-neutral animation ops (timeline).
// Registered in kit/core/catalog-b.mjs; conventions are documented there.

import {CATALOG_B_STYLE, alphaHex, createBase, decimalsOf, fitText, formatNumber, frameSamples, mixColor, niceStep, overlaps, parseExpression, progress, r2, rt, textWidth, ticks, withUnit} from './catalog-b-base.mjs';
import {abs, el, hex2, sampleTime, set, svgRoot, text, transformString, tw} from './catalog-b-view.mjs';

const color = 'primary | accent | paper | #rrggbb (contrast ≥ 3:1 on bg)';
const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';

// ---------------------------------------------------------------------------
// Model

function resolve(params, ctx) {
  const b = createBase('logo-row', params, ctx, {allowed: ['logos', 'title', 'at', 'stagger'], required: ['logos']});
  const {check, u, rect, id, start, portrait} = b;
  const p = b.params;
  const logosIn = check.arr(p.logos, 'params.logos', 2, 6);
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 48);
  const stagger = p.stagger === undefined ? 0.14 : check.num(p.stagger, 'params.stagger', 0.05, 0.6);
  const W = rect.width, H = rect.height;
  const n = logosIn.length;
  const cols = portrait ? (n <= 3 ? n : n === 4 ? 2 : 3) : n;
  const rows = Math.ceil(n / cols);
  const titleFit = title ? fitText(check, 'params.title', title, {family: 'body', width: W, preferred: u(54), min: b.min.key, maxLines: 2}) : null;
  const titleHeight = titleFit ? titleFit.lines * titleFit.size * 1.12 + u(48) : 0;
  const gapX = u(36), gapY = u(44);
  const labelPreferred = b.min.key + u(2);
  const labelBlock = labelPreferred * 1.2 + u(18);
  const tile = r2(Math.min(u(260), (W - gapX * (cols - 1)) / cols, (H - titleHeight - rows * labelBlock - gapY * (rows - 1)) / rows));
  if (tile < u(140)) check.fail('params.logos', 'too many logos for the rect');
  const gridW = cols * tile + (cols - 1) * gapX, gridH = rows * (tile + labelBlock) + (rows - 1) * gapY;
  // Title and grid travel as one group, centred in the rect.
  const groupTop = r2((H - titleHeight - gridH) / 2);
  const top = groupTop + titleHeight;
  const first = b.timeOf('logo-0', p.at, 'params.at', 0.65);
  const logos = logosIn.map((raw, i) => {
    const path = `params.logos[${i}]`;
    const entry = check.obj(raw, path, ['src', 'label', 'at'], ['src', 'label']);
    const src = check.asset(entry.src, `${path}.src`);
    const label = check.str(entry.label, `${path}.label`, 20);
    const fit = fitText(check, `${path}.label`, label, {family: 'body', width: tile + gapX - u(8), preferred: labelPreferred, min: b.min.key});
    const row = Math.floor(i / cols), col = i % cols;
    const inRow = Math.min(cols, n - row * cols);
    const rowW = inRow * tile + (inRow - 1) * gapX;
    const x = (W - rowW) / 2 + col * (tile + gapX);
    const y = top + row * (tile + labelBlock + gapY);
    const time = entry.at === undefined ? b.timeOf(`logo-${i}`, undefined, `${path}.at`, first - start + i * stagger) : b.timeOf(`logo-${i}`, entry.at, `${path}.at`, 0);
    b.events.push({id: `${id}-logo-${i}`, name: `logo-${i}`, time, endTime: rt(time + 0.5), role: 'emphasis', cue: 'pop'});
    return {index: i, src, label, labelSize: fit.size, tile: {x: r2(x), y: r2(y), size: tile}, image: {inset: r2(tile * 0.2)}, labelY: r2(y + tile + u(18)), time, duration: 0.5, ease: 'back.out(1.7)', endTime: rt(time + 0.5)};
  });
  const content = {title: titleFit ? {text: title, size: titleFit.size, lines: titleFit.lines, y: groupTop} : null, logos, tileRadius: r2(u(34)), tileFill: b.theme.panel, tileBorder: b.theme.border, tileBorderWidth: r2(u(2)),
    gridWidth: r2(gridW), popFrom: {opacity: 0, y: r2(u(30)), scale: 0.55}};
  return b.finish(content, {minTextPx: Math.min(...logos.map(l => l.labelSize), titleFit ? titleFit.size : Infinity)});
}

// ---------------------------------------------------------------------------
// View

function view(model) {
  const {id, theme, fonts, unit: u} = model;
  const c = model.content;
  const W = model.rect.width;
  const kids = [];
  if (c.title) kids.push(el('div', null, abs(0, c.title.y, W, undefined, {margin: 0, textAlign: 'center', fontFamily: fonts.body, fontWeight: 650, fontSize: c.title.size, lineHeight: '1.12', color: theme.foreground}), [c.title.text]));
  for (const logo of c.logos) {
    const T = logo.tile, inset = logo.image.inset;
    const labelW = T.size + 36 * u;
    kids.push(el('div', `${id}-logo-${logo.index}`, abs(T.x, T.y, T.size, logo.labelY - T.y + logo.labelSize * 1.2, {opacity: 0, transformOrigin: '50% 40%',
      transform: transformString({y: c.popFrom.y, scaleX: c.popFrom.scale, scaleY: c.popFrom.scale})}), [
      el('div', null, abs(0, 0, T.size, T.size, {boxSizing: 'border-box', borderRadius: c.tileRadius, background: c.tileFill, border: `${c.tileBorderWidth}px solid ${c.tileBorder}`, boxShadow: `0 ${16 * u}px ${40 * u}px #00000080`}), [
        el('img', null, abs(inset, inset, T.size - inset * 2, T.size - inset * 2, {objectFit: 'contain'}), [], {src: logo.src, alt: ''})
      ]),
      text(null, abs(T.size / 2 - labelW / 2, logo.labelY - T.y, labelW, undefined, {textAlign: 'center', fontFamily: fonts.body, fontWeight: 650, fontSize: logo.labelSize, lineHeight: '1.2', color: theme.foreground}), logo.label)
    ]));
  }
  return kids;
}

// ---------------------------------------------------------------------------
// Timeline

function timeline(model, ops) {
  const {id, start} = model;
  const c = model.content, f = c.popFrom;
  for (const logo of c.logos) {
    const target = `${id}-logo-${logo.index}`;
    set(ops, target, start, {opacity: 0, x: 0, y: f.y, scaleX: f.scale, scaleY: f.scale});
    tw(ops, target, logo.time, 0.25, 'power1.out', {opacity: 0}, {opacity: 1});
    tw(ops, target, logo.time, logo.duration, logo.ease, {y: f.y, scaleX: f.scale, scaleY: f.scale}, {y: 0, scaleX: 1, scaleY: 1});
  }
}

export const logoRow = {
  id: 'logo-row',
    describe: 'A row or grid of 2–6 local logos with labels that pop in with a stagger.',
    params: {logos: '[{src: "assets/…(.svg|.png|.jpg|.webp)", label ≤ 20, at?}] 2–6', title: 'string ≤ 48 (optional)', at: 'first pop time', stagger: 'seconds between pops (default 0.14)', rect},
    events: ['logo-<i>'],
  resolve,
  view,
  timeline
};

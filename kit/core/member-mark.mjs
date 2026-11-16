// A brand mark as a member (docs/FLUID_MOTION_RFC.md §10, past the closed
// graphic list): an integration's or partner's logo in place of an icon, with
// an optional label under it. Shaped like kit/core/graphic.mjs: markSpec
// validates, markWidth measures, markNodes paints into a width × height box
// at (0, 0), and the set module keeps its own wrappers.
//
// It reuses the end card's logo handling (kit/core/catalog-b-end-card.mjs):
// the file is measured once at import (src/logo_mark.js withLockupTints fills
// tone, clear and box), a dark mark on a see-through background is recoloured
// so it reads on the ground, a light one is kept, and a logo with its own
// solid background sits whole on a plate of that colour. An unmeasured mark
// goes on a plate. The file is a bring-your-own project file, never fetched.

import {abs, el, hex2} from './catalog-b-view.mjs';
import {image, logoTreatment, tintMatrix} from './catalog-b-end-card.mjs';
import {r2, textWidth} from './catalog-h-base.mjs';
import {label} from './catalog-h-view.mjs';

/** One line for a module's params: what a `mark` member may be. */
export const MARK_PARAM = '"assets/…(.svg|.png|.jpg|.webp)" | {src, label?, ratio? (width / height, default 1), tone? dark|light|mixed, clear?, box? "#rrggbb"} a brand mark member (tone, clear and box are measured at import)';

/** A validated mark spec, or a check.fail naming what to change. → {kind: 'mark', src, label, ratio, tone?, clear?, box?}. */
export function markSpec(check, raw, path, {labelMax = 18} = {}) {
  if (typeof raw === 'string') return {kind: 'mark', label: null, ...image(check, raw, path, 1)};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) check.fail(path, `must be a brand mark: ${MARK_PARAM}`);
  for (const key of Object.keys(raw)) if (!['src', 'label', 'ratio', 'tone', 'clear', 'box'].includes(key)) check.fail(`${path}.${key}`, 'is not supported (allowed: src, label, ratio, tone, clear, box)');
  const {label: text, ...logo} = raw;
  return {kind: 'mark', label: text === undefined ? null : check.str(text, `${path}.label`, labelMax), ...image(check, logo, path, 1)};
}

/** The width the label needs at size L (px), on its plate (0 without a label). */
export const markWidth = (spec, L) => (spec.label ? textWidth(spec.label, L, 'body') + 1.2 * L : 0);

/** How the mark is drawn on `ground` (a hex): {mode: native | tint | plate, color?}. */
export const markTreatment = (spec, ground, colors) => logoTreatment(spec, ground, colors);

/**
 * View nodes for a mark in a width × height box at (0, 0): the mark fitted to
 * the box above the label, drawn by its treatment on `ground`.
 * look: {ground (the hex it sits on), colors (brand roles: paper, ink), fg,
 * panel, fonts, unit, labelSize (px), key (a unique id prefix for its filter)}.
 */
export function markNodes(spec, width, height, look) {
  const {ground, colors, fg, panel, fonts, unit: u, labelSize: L, key} = look;
  const room = spec.label ? r2(L * 1.45 + L * 0.35) : 0;
  const treat = markTreatment(spec, ground, colors);
  const boxW = width, boxH = r2(height - room);
  // A plate adds 18% padding on each side; the mark fits inside what is left.
  const pad = treat.mode === 'plate' ? 0.18 : 0;
  const innerW = boxW / (1 + pad * 2), innerH = boxH / (1 + pad * 2);
  const h = r2(Math.min(innerH, innerW / spec.ratio)), w = r2(h * spec.ratio);
  const p = r2(h * pad), outerW = r2(w + p * 2), outerH = r2(h + p * 2);
  const kids = [];
  let filter;
  if (treat.mode === 'tint') {
    const fid = `${key}-tint`;
    filter = `url(#${fid})`;
    kids.push(el('svg', null, {position: 'absolute', left: 0, top: 0, width: 0, height: 0, overflow: 'hidden'}, [
      el('filter', fid, null, [el('feColorMatrix', null, null, [], {type: 'matrix', values: tintMatrix(treat.color)})], {colorInterpolationFilters: 'sRGB'})], {width: 0, height: 0, 'aria-hidden': 'true'}));
  }
  const img = el('img', null, abs(p, p, w, h, {objectFit: 'contain', ...(filter ? {filter} : {})}), [], {src: spec.src, alt: ''});
  kids.push(el('div', null, abs(r2((width - outerW) / 2), r2((boxH - outerH) / 2), outerW, outerH, treat.mode === 'plate'
    ? {background: spec.box ?? colors.paper, borderRadius: r2(h * 0.16), boxShadow: `0 ${r2(12 * u)}px ${r2(28 * u)}px ${hex2('#000000', 0.4)}`} : {}), [img]));
  if (spec.label) {
    const lw = r2(Math.min(width, markWidth(spec, L)));
    kids.push(el('div', null, abs(r2((width - lw) / 2), r2(height - L * 1.45), lw, r2(L * 1.45), {borderRadius: 999, background: hex2(panel, 0.88)})),
      label(null, 0, r2(height - L * 1.325), width, spec.label, {size: L, family: fonts.body, color: fg, align: 'center', weight: 700, lineHeight: 1.25}));
  }
  return kids;
}

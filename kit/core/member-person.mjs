// A person as a member (docs/FLUID_MOTION_RFC.md §10, past the closed graphic
// list): a photo, a round avatar, or, with no image, an initials tile in the
// brand palette, with the name under it. Shaped like kit/core/graphic.mjs:
// personSpec validates, personWidth measures, personNodes paints into a
// width × height box at (0, 0), and the set module keeps its own wrappers.
//
// The image is a bring-your-own project file (assets/…), never fetched.

import {abs, el, hex2} from './catalog-b-view.mjs';
import {mixColor, r2, textWidth} from './catalog-h-base.mjs';
import {label} from './catalog-h-view.mjs';

export const PERSON_SHAPES = Object.freeze(['avatar', 'photo']);
const KEYS = ['name', 'image', 'shape'];
// A photo is a 4:5 portrait; an avatar a circle.
const PHOTO_ASPECT = 0.8;

/** One line for a module's params: what a `person` member may be. */
export const PERSON_PARAM = '{name, image? (assets/… photo or avatar; else an initials tile), shape? avatar (round, default) | photo (4:5 portrait)} a person member';

/** Up to two initials from the name's words (letters and digits only), or "?". */
export const initials = name => String(name).split(/\s+/).filter(Boolean).map(w => [...w][0]).filter(ch => /[\p{L}\p{N}]/u.test(ch)).slice(0, 2).join('').toUpperCase() || '?';

/** A validated person spec, or a check.fail naming what to change. → {kind: 'person', name, image, shape}. */
export function personSpec(check, raw, path, {labelMax = 18} = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) check.fail(path, `must be a person: ${PERSON_PARAM}`);
  for (const key of Object.keys(raw)) if (!KEYS.includes(key)) check.fail(`${path}.${key}`, `is not supported (allowed: ${KEYS.join(', ')})`);
  if (raw.name === undefined) check.fail(`${path}.name`, 'is required (the initials come from it when there is no image)');
  return {
    kind: 'person',
    name: check.str(raw.name, `${path}.name`, labelMax),
    image: raw.image === undefined ? null : check.asset(raw.image, `${path}.image`),
    shape: raw.shape === undefined ? 'avatar' : check.oneOf(raw.shape, `${path}.shape`, PERSON_SHAPES)
  };
}

/** The face's width for a face height of F px. */
export const personFaceWidth = (spec, F) => r2(spec.shape === 'photo' ? F * PHOTO_ASPECT : F);

/** The width the name needs at size L (px), on its plate. */
export const personWidth = (spec, L) => textWidth(spec.name, L, 'body') + 1.2 * L;

/** The height a person needs for a face of F px and a name of L px. */
export const personHeight = (F, L) => r2(F + L * 0.35 + L * 1.45);

/**
 * View nodes for a person in a width × height box at (0, 0): the face on top,
 * centred, the name on a plate of the panel at the foot.
 * look: {color (the member's colour), ink (text on that colour), fg, panel,
 * fonts, unit, labelSize (px)}.
 */
export function personNodes(spec, width, height, look) {
  const {color, ink, fg, panel, fonts, unit: u, labelSize: L} = look;
  const room = r2(L * 1.45 + L * 0.35);
  const F = r2(Math.min(height - room, spec.shape === 'photo' ? width / PHOTO_ASPECT : width));
  const fw = personFaceWidth(spec, F), x = r2((width - fw) / 2);
  const radius = spec.shape === 'photo' ? r2(F * 0.12) : '50%';
  const rim = r2(Math.max(3 * u, F * 0.035));
  const face = spec.image
    ? el('img', null, abs(0, 0, fw, F, {objectFit: 'cover', borderRadius: radius, display: 'block'}), [], {src: spec.image, alt: ''})
    : el('div', null, abs(0, 0, fw, F, {borderRadius: radius, background: `linear-gradient(160deg, ${mixColor(color, '#ffffff', 0.18)}, ${color} 55%, ${mixColor(color, panel, 0.35)})`}), [
      label(null, 0, r2((F - F * 0.36 * 1.1) / 2), fw, initials(spec.name), {size: r2(F * 0.36), family: fonts.display, color: ink, align: 'center', lineHeight: 1.1, weight: 800})]);
  // The rim is a ring over the face in the member's colour, with its glow, so a photo reads as this set's member.
  const ring = el('div', null, abs(0, 0, fw, F, {boxSizing: 'border-box', borderRadius: radius, border: `${rim}px solid ${color}`, boxShadow: `0 ${r2(12 * u)}px ${r2(30 * u)}px ${hex2('#000000', 0.45)}, 0 0 ${r2(24 * u)}px ${hex2(color, 0.45)}`}));
  const w = r2(Math.min(width, personWidth(spec, L)));
  return [
    el('div', null, abs(x, 0, fw, F), [face, ring]),
    el('div', null, abs(r2((width - w) / 2), r2(height - L * 1.45), w, r2(L * 1.45), {borderRadius: 999, background: hex2(panel, 0.88)})),
    label(null, 0, r2(height - L * 1.325), width, spec.name, {size: L, family: fonts.body, color: fg, align: 'center', weight: 700, lineHeight: 1.25})
  ];
}

// Drawing styles: every style draws the same rig (rig.mjs) with the same
// poses, expressions and acting, so any cast works in any style and a
// character stays the same person when the style changes. A style is
//
//   draw(params, colors, options) → node   (options: toon.mjs drawToon, plus light)
//   height(params) → rig units             (drawn height above the feet, with hair)
//   geometry(params) → rig geometry        (the measurements the poses use: sitDrop, head)
//
// The drawing keeps the same part ids in every style (toon.mjs), so the op
// list from acting.mjs animates any of them.
//
// Imports only sibling kit/core files.

import {rigGeometry} from './rig.mjs';
import {normalizeLight} from './light.mjs';
import {drawFlat, drawnHeight} from './style-flat.mjs';

const STYLES = {
  flat: {draw: drawFlat, height: drawnHeight, geometry: rigGeometry, describe: 'flat fills, a dark outline and a friendly simple face (the default)'}
};

export const DRAWING_STYLES = Object.freeze(Object.keys(STYLES));
export const STYLE_INFO = Object.freeze(Object.fromEntries(Object.entries(STYLES).map(([name, style]) => [name, Object.freeze({describe: style.describe})])));

function styleOf(name) {
  const style = STYLES[name ?? 'flat'];
  if (!style) throw new Error(`unknown drawing style ${JSON.stringify(name)} (styles: ${DRAWING_STYLES.join(', ')})`);
  return style;
}

/** Draw a character in a drawing style. options.light: a light (light.mjs), normalised here. */
export function drawCharacter(style, params, colors, options) {
  const light = options?.light ? {dir: options.light.dir, color: options.light.color, intensity: options.light.intensity} : null;
  return styleOf(style).draw(params, colors, {...options, light: normalizeLight(light)});
}

/** Drawn height above the feet in rig units, with hair, for a style. */
export const styleHeight = (style, params) => styleOf(style).height(params);

/** The rig geometry a style draws and poses with. */
export const styleGeometry = (style, params) => styleOf(style).geometry(params);

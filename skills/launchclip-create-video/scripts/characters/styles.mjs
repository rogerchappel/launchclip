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
// A character of a kind other than a person (kinds.mjs: an animal, a mascot,
// an object with a face) has one body in every style; the style chooses the
// pen it is inked with (kind-draw.mjs).
//
// Imports only sibling kit/core files.

import {rigGeometry} from './rig.mjs';
import {normalizeLight} from './light.mjs';
import {drawFlat, drawnHeight} from './style-flat.mjs';
import {STYLE as line} from './style-line.mjs';
import {STYLE as outlined} from './style-outlined.mjs';
import {STYLE as paper} from './style-paper.mjs';
import {STYLE as softShade} from './style-soft-shade.mjs';
import {STYLE as stick, STYLE_CLASSIC as stickClassic} from './style-stick.mjs';
import {STYLE as lifelike} from './style-lifelike.mjs';
import {STYLE as cinematic} from './style-cinematic.mjs';
import {STYLE as avatar} from './style-avatar.mjs';
import {STYLE as chibi, STYLE_PLAIN as chibiPlain} from './style-chibi.mjs';
import {KIND_STAGE, isKind, kindColors, kindGeometry, kindHeight} from './kinds.mjs';
import {drawingBounds} from './bounds.mjs';
import {castRoles} from './palette.mjs';
import {poseJoints} from './rig.mjs';
import {drawKind} from './kind-draw.mjs';

// In order from the default to the newest; flat stays first.
const STYLES = {
  flat: {draw: drawFlat, height: drawnHeight, geometry: rigGeometry, describe: 'flat fills, a dark outline and a friendly simple face (the default)'},
  line,
  outlined,
  paper,
  'soft-shade': softShade,
  stick,
  'stick-classic': stickClassic,
  lifelike,
  cinematic,
  avatar,
  chibi,
  'chibi-plain': chibiPlain
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
  // A kind other than a person has its own body (kind-draw.mjs), inked with the style's pen.
  if (isKind(params)) { styleOf(style); return drawKind(style ?? 'flat', params, colors, {...options, light: normalizeLight(light)}); }
  return styleOf(style).draw(params, colors, {...options, light: normalizeLight(light)});
}

/** Drawn height above the feet in rig units, with hair, for a style. */
export const styleHeight = (style, params) => (isKind(params) ? kindHeight(params) : styleOf(style).height(params));

/** The rig geometry a style draws and poses with. */
export const styleGeometry = (style, params) => (isKind(params) ? kindGeometry(params) : styleOf(style).geometry(params));

const stageCache = new Map();
/**
 * The height a set sizes its cast by: a person's drawn height; for a kind
 * other than a person, no less than a person's and more the wider it
 * reaches standing or seated (kinds.mjs KIND_STAGE), so it fits a slot.
 */
export function stageHeight(style, params) {
  if (!isKind(params)) return styleOf(style).height(params);
  const key = `${params.kind}|${params.size ?? 'medium'}`;
  if (!stageCache.has(key)) {
    const geometry = kindGeometry(params);
    const colors = kindColors(params.colors, castRoles(null));
    let reach = 0;
    for (const pose of ['stand', 'sit']) {
      // The same box the cast gate measures a reach with (bounds.mjs drawingBounds).
      const box = drawingBounds(drawKind('flat', params, colors, {id: 'stage', joints: poseJoints(pose, {geometry})}));
      reach = Math.max(reach, -box.left, box.right);
    }
    stageCache.set(key, Math.round(Math.max(kindHeight(params), KIND_STAGE.height * Math.max(1, reach / KIND_STAGE.reach))));
  }
  return stageCache.get(key);
}

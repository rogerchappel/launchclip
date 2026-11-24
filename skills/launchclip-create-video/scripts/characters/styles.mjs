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
import {STYLE as rubberHose} from './style-rubber-hose.mjs';
import {STYLE as lifelike} from './style-lifelike.mjs';
import {STYLE as cinematic} from './style-cinematic.mjs';
import {STYLE as avatar} from './style-avatar.mjs';
import {STYLE as chibi, STYLE_PLAIN as chibiPlain} from './style-chibi.mjs';
import {KIND_STAGE, isKind, kindColors, kindGeometry, kindHeight} from './kinds.mjs';
import {drawingBounds} from './bounds.mjs';
import {castRoles} from './palette.mjs';
import {normalizeRigParams, poseJoints} from './rig.mjs';
import {drawKind} from './kind-draw.mjs';
import {HEAD} from './toon.mjs';
import {pathBox, pathPairs} from './pens.mjs';

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
  'chibi-plain': chibiPlain,
  'rubber-hose': rubberHose
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
/** The styles that draw a kind as a stick figure. */
export const STICK_STYLES = Object.freeze(['stick', 'stick-classic', 'rubber-hose']);
export const styleGeometry = (style, params) => (isKind(params) ? kindGeometry(params, {stick: STICK_STYLES.includes(style)}) : styleOf(style).geometry(params));

const stageCache = new Map();
/**
 * The height a set sizes its cast by: a person's drawn height; for a kind
 * other than a person, no less than kinds.mjs KIND_STAGE.height (less in
 * the same measure where a style draws people shorter), so a cat is never
 * blown up to a person's height. tight: the slots are narrow
 * (several characters across a portrait frame); a kind then also counts as
 * taller the wider it reaches standing or seated, so it fits its slot.
 * alone: one character in a portrait frame has the frame's width to itself.
 * shared: several characters across a landscape frame (wider slots).
 */
export function stageHeight(style, params, {tight = false, alone = false, shared = false} = {}) {
  if (!isKind(params)) return styleOf(style).height(params);
  if (!tight) return Math.max(personHeight(style), kindHeight(params), alone ? Math.round(KIND_STAGE.height * kindReach(params) / KIND_STAGE.alone) : 0, shared ? Math.round(KIND_STAGE.height * kindReach(params) / KIND_STAGE.shared) : 0);
  return Math.round(Math.max(kindHeight(params), KIND_STAGE.height * Math.max(1, kindReach(params) / KIND_STAGE.reach)));
}

// The least a kind counts as in a style: KIND_STAGE.height where people are drawn at the rig's
// proportions, and less in the same measure where they are drawn shorter (the cute family).
const PERSON = normalizeRigParams({skin: 'tan', hair: {style: 'short'}});
function personHeight(style) {
  const key = `person|${style ?? 'flat'}`;
  if (!stageCache.has(key)) stageCache.set(key, Math.round(KIND_STAGE.height * Math.min(1, styleOf(style).height(PERSON) / STYLES.flat.height(PERSON))));
  return stageCache.get(key);
}

/** How far a kind reaches to either side, standing or seated, in rig units (the box the cast gate measures). */
function kindReach(params) {
  const key = `${params.kind}|${params.size ?? 'medium'}`;
  if (!stageCache.has(key)) {
    const geometry = kindGeometry(params);
    const colors = kindColors(params.colors, castRoles(null));
    let reach = 0;
    for (const pose of ['stand', 'sit']) {
      const box = drawingBounds(drawKind('flat', params, colors, {id: 'stage', joints: poseJoints(pose, {geometry})}));
      reach = Math.max(reach, -box.left, box.right);
    }
    stageCache.set(key, reach);
  }
  return stageCache.get(key);
}

// ---------------------------------------------------------------------------
// Limb weight

/** The width a path is drawn at: its stroke, or for a filled ribbon (a pressure stroke) twice its area over its perimeter. */
function drawnWidth(node) {
  const a = node.attrs ?? {};
  if (a.stroke && a.stroke !== 'none' && (!a.fill || a.fill === 'none')) return Number(a.strokeWidth) || 0;
  const pts = pathPairs(a.d ?? '');
  let area = 0, perimeter = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    area += x0 * y1 - x1 * y0;
    perimeter += Math.hypot(x1 - x0, y1 - y0);
  }
  return perimeter ? Math.abs(area) / perimeter + (Number(a.strokeWidth) || 0) : 0;
}

/** The least limb weight (limbWeight ratio) a figure keeps before its limbs read as wire. */
export const MIN_LIMB_WEIGHT = 0.045;

/**
 * How heavy a character's limbs are drawn: the left forearm's stroke width
 * over the head's width, both in the drawing's own units, so a check can
 * catch a figure thinning into wire whatever its scale. drawing: a static
 * drawCharacter node; id: the id it was drawn with. The forearm is the
 * longest path under its joint (gloves, fingers and props are not it).
 * → {limb, head, ratio}, or null when the drawing has no forearm or head.
 */
export function limbWeight(drawing, id) {
  let head = 0, fore = null;
  const find = node => {
    if (!node || typeof node !== 'object') return;
    if (node[HEAD]) {
      const a = node.attrs ?? {};
      head = node.tag === 'path' ? (box => box.x1 - box.x0)(pathBox(a.d)) : node.tag === 'ellipse' || node.tag === 'circle' ? 2 * Number(a.rx ?? a.r) : (box => box.right - box.left)(drawingBounds(node));
    }
    // A static drawing carries joint ids as attributes; an animated one on the node.
    if ((node.id ?? node.attrs?.id) === `${id}-fore-l`) fore = node;
    (node.children ?? []).forEach(find);
  };
  find(drawing);
  if (!fore || !head) return null;
  const paths = [];
  const collect = node => {
    if (!node || typeof node !== 'object' || /-finger/.test(node.id ?? node.attrs?.id ?? '')) return;
    if (node.tag === 'path' && node.attrs?.d) {
      const box = pathBox(node.attrs.d);
      paths.push({node, long: Math.max(box.x1 - box.x0, box.y1 - box.y0)});
    }
    (node.children ?? []).forEach(collect);
  };
  collect(fore);
  const longest = Math.max(0, ...paths.map(p => p.long));
  const limb = Math.max(0, ...paths.filter(p => p.long >= longest * 0.6).map(p => drawnWidth(p.node)));
  return limb ? {limb: Math.round(limb * 10) / 10, head: Math.round(head * 10) / 10, ratio: Math.round(limb / head * 1000) / 1000} : null;
}

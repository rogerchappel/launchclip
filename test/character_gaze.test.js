// A look turns the head (toon.mjs turnJoint, gazeJoint): the head moves a
// little toward the target and the features a little further across the
// face, so in every drawing style, at every look at full reach, the eyes,
// mouths and every other feature stay inside the head's outline.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EXPRESSIONS, normalizeRigParams, poseJoints} from '@launchclip/core/characters/rig.mjs';
import {STARTER_CAST, characterLook, starterCharacter} from '@launchclip/core/characters/cast.mjs';
import {DRAWING_STYLES, drawCharacter, styleGeometry} from '@launchclip/core/characters/styles.mjs';
import {partShapes, pathOutline, placePoint} from '@launchclip/core/characters/bounds.mjs';
import {GAZE} from '@launchclip/core/characters/actions.mjs';
import {HEAD} from '@launchclip/core/characters/toon.mjs';

// Full reach (actions.mjs gazeOffset with the target far to the side), and
// the three-quarter turn (catalog-characters.mjs), which narrows the face.
const LOOKS = {
  left: {gazeX: -GAZE.x, gazeY: 0},
  right: {gazeX: GAZE.x, gazeY: 0},
  far: {gazeX: GAZE.x, gazeY: GAZE.lift},
  drop: {gazeX: -GAZE.x, gazeY: GAZE.drop},
  'three-quarter left': {gazeX: -GAZE.quarter, gazeY: GAZE.lift, gazeScale: GAZE.quarterScale},
  'three-quarter right': {gazeX: GAZE.quarter, gazeY: GAZE.drop, gazeScale: GAZE.quarterScale}
};

// The starter cast (children, seniors, every head shape and face) and two
// made-up people wearing the widest features: wrinkles, cat-eye glasses and
// sunglasses, freckles, every kind of facial hair, marks.
const PEOPLE = [
  ...STARTER_CAST.map((entry) => [entry.id, starterCharacter(entry.id).params]),
  ['wide-1', normalizeRigParams({build: 'average', age: 'senior', skin: 'light', hair: {style: 'short', color: 'grey'}, outfit: {top: 'tee'}, accessories: ['cat-eye-glasses', 'goatee', 'freckles', 'sideburns']})],
  ['wide-2', normalizeRigParams({build: 'round', skin: 'tan', hair: {style: 'bald', color: 'black'}, outfit: {top: 'shirt'}, accessories: ['sunglasses', 'moustache', 'long-beard', 'bindi', 'nose-stud']})]
];

// The head's drawn outline (the skin shape marked HEAD, without the paper
// style's offset shadow), as a polygon in rig units.
function headOutline(drawing) {
  const shape = partShapes(drawing, (node) => node[HEAD] === true).find(({node}) => ['path', 'ellipse'].includes(node.tag) && !node.attrs?.transform && node.attrs?.fill !== 'none');
  assert.ok(shape, 'the head outline is marked');
  const {node, matrix} = shape;
  const a = node.attrs;
  const local = node.tag === 'ellipse' ? Array.from({length: 96}, (_, i) => [+a.cx + +a.rx * Math.cos(i * Math.PI / 48), +a.cy + +a.ry * Math.sin(i * Math.PI / 48)]) : pathOutline(a.d);
  return local.map(([x, y]) => placePoint(matrix, x, y));
}

function inside(poly, [x, y]) {
  let odd = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) odd = !odd;
  }
  return odd;
}

function toEdge(poly, [x, y]) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

/** The closest a shape comes to the head's edge, in head widths: + inside, - outside. */
function clearance(poly, points) {
  const xs = poly.map(([x]) => x);
  const width = Math.max(...xs) - Math.min(...xs);
  return Math.min(...points.map((point) => (inside(poly, point) ? 1 : -1) * toEdge(poly, point) / width));
}

const id = (node) => String(node.id ?? '');

// Shading that fades to nothing at its edge (lifelike cheeks and eye
// sockets: a gradient whose last stop is clear) has no visible edge.
function fadingFills(drawing) {
  const out = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (/Gradient$/.test(node.tag ?? '') && node.children?.at(-1)?.attrs?.stopOpacity === 0) out.add(`url(#${node.id})`);
    for (const child of node.children ?? []) walk(child);
  };
  walk(drawing);
  return out;
}

function draw(style, params, look) {
  const {colors} = characterLook(params, {});
  const joints = {...poseJoints('stand', {geometry: styleGeometry(style, params)}), ...look};
  return drawCharacter(style, params, colors, {id: 'c', joints, expression: 'neutral', expressions: EXPRESSIONS, gaze: true});
}

for (const style of DRAWING_STYLES) {
  test(`${style}: at every look the eyes, mouths and features stay inside the head`, () => {
    const problems = [];
    for (const [who, params] of PEOPLE) {
      for (const [name, look] of Object.entries(LOOKS)) {
        const drawing = draw(style, params, look);
        const head = headOutline(drawing);
        const fades = fadingFills(drawing);
        const check = (part, match, margin) => {
          for (const {node, points} of partShapes(drawing, match, {hidden: true})) {
            if (fades.has(node.attrs?.fill)) continue;
            const m = clearance(head, points);
            if (m < margin) problems.push(`${who} looking ${name}: ${part} ${node.tag} ${JSON.stringify(node.attrs ?? {}).slice(0, 90)} is ${m < 0 ? 'outside' : 'too close to'} the head's edge (${m.toFixed(3)} head widths)`);
          }
        };
        // Eyes and mouths (every expression, open and closed) keep a clear margin.
        check('eye', (node) => id(node).startsWith('c-eyes-'), 0.04);
        check('mouth', (node) => /^c-(mouth|open)-/.test(id(node)), 0.02);
        // Every other feature that moves across the face (brows, glasses, moustache, marks) stays inside.
        check('feature', (node) => id(node) === 'c-gaze', 0);
      }
    }
    assert.deepEqual(problems, []);
  });
}

test('a look moves the head toward the target and the features further across the face', () => {
  const {params} = starterCharacter('maya');
  const centre = (poly) => poly.reduce((sum, [x]) => sum + x, 0) / poly.length;
  for (const style of DRAWING_STYLES) {
    const rest = draw(style, params, {gazeX: 0, gazeY: 0});
    const head0 = centre(headOutline(rest));
    const eyes0 = partShapes(rest, (node) => id(node) === 'c-eyes-neutral').flatMap(({points}) => points);
    for (const sign of [-1, 1]) {
      const drawing = draw(style, params, {gazeX: sign * GAZE.x, gazeY: 0});
      const headShift = centre(headOutline(drawing)) - head0;
      const eyes = partShapes(drawing, (node) => id(node) === 'c-eyes-neutral').flatMap(({points}) => points);
      const eyeShift = eyes.reduce((sum, [x]) => sum + x, 0) / eyes.length - eyes0.reduce((sum, [x]) => sum + x, 0) / eyes0.length;
      assert.ok(sign * headShift > 0, `${style}: the head turns toward the target`);
      assert.ok(sign * eyeShift > sign * headShift, `${style}: the eyes move further than the head`);
    }
  }
});

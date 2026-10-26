// Acting cues (docs/DIRECTION_GUARDRAILS.md §2): the words a planner uses to
// act out an idea, each expanded into poses, a facing, a gaze and, for
// walk-to, a walk across the floor. A character with a target faces it and
// turns its head and eyes toward it, so it attends to the world rather than
// the camera.
//
//   cue: {at, action?, target?, pose?, expression?, facing?}
//   action: look-far | turn-to-look | gaze-at | point-at | walk-to |
//           stand-up | stretch
//   target: far | window | horizon | street | skyline (world focus points)
//           | left | right | {prop: id} | {character: id} | {x, y} (canvas px)
//
// Imports only sibling kit/core files.

export const ACTIONS = Object.freeze(['look-far', 'turn-to-look', 'gaze-at', 'point-at', 'walk-to', 'stand-up', 'stretch']);
// Actions whose point is that the character looks at something.
export const LOOK_ACTIONS = Object.freeze(['look-far', 'turn-to-look', 'gaze-at']);

/** What each action does (planner vocabulary; the pose it takes, if any). */
export const ACTION_INFO = Object.freeze({
  'look-far': {pose: 'look', gaze: true, target: 'far', describe: 'shades the eyes and looks into the distance (default target: far)'},
  'turn-to-look': {pose: null, gaze: true, target: 'far', describe: 'turns to face the target and looks at it, keeping the pose'},
  'gaze-at': {pose: null, gaze: true, target: null, describe: 'looks at the target (head and eyes), keeping the pose and facing'},
  'point-at': {pose: 'point', gaze: true, target: null, describe: 'faces the target and points at it'},
  'walk-to': {pose: 'walk', gaze: true, target: null, describe: 'turns and walks to the target at a walking pace, then stands'},
  'stand-up': {pose: 'stand', gaze: false, target: null, describe: 'gets up from a seat (seated sets) and stands'},
  'stretch': {pose: 'stretch', gaze: false, target: null, describe: 'stretches both arms overhead'}
});

// Actions that need a target named (the rest have a default or none).
export const TARGET_REQUIRED = Object.freeze(['gaze-at', 'point-at', 'walk-to']);
export const NAMED_TARGETS = Object.freeze(['far', 'window', 'horizon', 'street', 'skyline', 'left', 'right']);

// How far the face turns toward a target, in rig units (a head is about 200
// across), and how far it lifts for a far target. A three-quarter turn
// also narrows the features (scaleX), as a head turned away does.
export const GAZE = Object.freeze({x: 32, lift: -8, drop: 6, quarter: 44, quarterScale: 0.84});

// Views: front (the camera), three-quarter (the face turned well toward a
// side target) and back (seen from behind, looking into the scene).
export const VIEWS = Object.freeze(['front', 'three-quarter', 'back']);

/**
 * The view a character takes to look at a point: a far point is in the
 * scene's depth (the window, the horizon, the skyline), so a standing
 * character turns its back to the camera to look at it; seated, for
 * anything nearer, or for a far point toward the camera (across a street),
 * it turns three-quarters. No point: front.
 */
export function viewFor(point, {seated = false} = {}) {
  if (!point) return 'front';
  // Toward the camera (across a street from its far pavement): look past the viewer.
  if (point.toward === 'camera') return 'three-quarter';
  return point.far && !seated ? 'back' : 'three-quarter';
}
// A walking pace, metres per second, and a rig of 1000 units ≈ 1.7 m.
export const WALK = Object.freeze({speed: 1.25, metresPerRig: 1.7 / 1000, minDuration: 0.6});

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Errors in a target value (shape only; names are resolved in the scene). → string | null */
export function targetError(target) {
  if (typeof target === 'string') return NAMED_TARGETS.includes(target) ? null : `must be one of ${NAMED_TARGETS.join(', ')}, {prop}, {character} or {x, y}; got ${JSON.stringify(target)}`;
  if (!isObject(target)) return `must be one of ${NAMED_TARGETS.join(', ')}, {prop}, {character} or {x, y}`;
  const keys = Object.keys(target);
  if (keys.length === 1 && typeof target.prop === 'string') return null;
  if (keys.length === 1 && typeof target.character === 'string') return null;
  if (keys.every(key => ['x', 'y'].includes(key)) && Number.isFinite(target.x) && (target.y === undefined || Number.isFinite(target.y))) return null;
  return 'must be {prop: id}, {character: id} or {x, y} (canvas px)';
}

/**
 * A target as a canvas point: {x, y, far} (x null = no side given; the
 * looker turns away from the frame centre). scene: {focus (worlds/index.mjs
 * worldFocus | null), actors: [{id, x, floor, scale, height}], canvas}.
 * Throws a message on an unknown prop or character.
 */
export function targetPoint(target, scene) {
  const {focus, canvas} = scene;
  if (target === 'left') return {x: 0, y: null, far: false};
  if (target === 'right') return {x: canvas.width, y: null, far: false};
  if (typeof target === 'string') {
    const point = focus?.[target] ?? null;
    if (point) return point;
    // No world: far things sit up and to the side.
    return {x: null, y: Math.round(canvas.height * 0.35), far: true};
  }
  if (target.prop !== undefined) {
    const prop = focus?.props?.find(entry => entry.id === target.prop);
    if (!prop) throw new Error(`target prop "${target.prop}" is not in the world beneath (props: ${(focus?.props ?? []).map(entry => entry.id).join(', ') || 'none'})`);
    return {x: prop.x, y: prop.y, far: false};
  }
  if (target.character !== undefined) {
    const other = scene.actors.find(actor => actor.id === target.character);
    if (!other) throw new Error(`target character "${target.character}" is not in this scene`);
    return {x: other.x, y: Math.round(other.floor - other.height * other.scale * 0.85), far: false};
  }
  return {x: target.x, y: target.y ?? null, far: false};
}

/** Which way a character at x looks for a point: 'left' | 'right'. */
export function sideOf(point, x, canvas) {
  if (point.x === null || point.x === undefined || Math.abs(point.x - x) < 1) return x > canvas.width / 2 ? 'left' : 'right';
  return point.x < x ? 'left' : 'right';
}

/**
 * The face offset for looking at a point from a character's head (rig
 * units): toward its side, lifted for a far point or one above the head,
 * lowered for one below it. → {x, y}
 */
export function gazeOffset(point, actor, canvas) {
  const side = sideOf(point, actor.x, canvas);
  const headY = actor.floor - actor.height * actor.scale * 0.85;
  const y = point.far ? GAZE.lift : point.y === null || point.y === undefined ? 0 : point.y < headY - 80 ? GAZE.lift * 0.6 : point.y > headY + 160 ? GAZE.drop : 0;
  // A point straight ahead (x close to the character) turns the face less.
  const reach = point.x === null || point.x === undefined ? 1 : Math.min(1, Math.abs(point.x - actor.x) / (actor.scale * 600));
  return {x: Math.round((side === 'left' ? -1 : 1) * GAZE.x * Math.max(0.5, reach) * 10) / 10, y};
}

/** Seconds a walk of dx canvas px takes at a walking pace for a character drawn at `scale` px per rig unit. */
export function walkDuration(dx, scale) {
  const metres = Math.abs(dx) / Math.max(1e-6, scale) * WALK.metresPerRig;
  return Math.max(WALK.minDuration, Math.round(metres / WALK.speed * 100) / 100);
}

/** Planner lines on acting (kit/core/planning-prompt.mjs, the skills). */
export function actingPromptLines() {
  return [
    `Acting cues (cast-scene cues[].action): ${ACTIONS.map(name => `${name} (${ACTION_INFO[name].describe})`).join('; ')}.`,
    `Targets (cue or actor \`target\`): ${NAMED_TARGETS.join(', ')}, {prop: id} (a prop in the world beneath), {character: id} or {x, y}. A character with a target faces it and turns its head toward it, not the camera: a standing character looking at something far (window, street, horizon, skyline) turns its back to the camera; seated or for nearer things it turns three-quarters. A cue may set view: ${VIEWS.join(' | ')}.`,
    'Never cover what a character looks at: a card must not sit over the window, street or skyline point while someone looks at it (the acting gate fails it). Put the card to one side, or bring it in after the look.',
    'If the idea is an action (look away, get up, walk over, point at the proof), a character performs it on screen on that line, toward what it is about: a bench sitter looking at the street turns toward the street.'
  ];
}

// TEMPORARY: the rig-scene contract (rigScenePrepare, rigSceneTree) over the
// per-frame rig prototype (rig-frame-draw.mjs prototypeTree), so the
// renderers' per-frame layer (rig-scene-layer.mjs) can be built before
// rig-scene.mjs lands. Once it does, rig-scene-layer.mjs imports from
// './rig-scene.mjs' and this file is deleted. A plan here is a prototype
// scene ({id, style, brand, track, expressions, at}, PROTOTYPE's shape).

import {prototypeCast, prototypeTree} from './rig-frame-draw.mjs';

/** What every frame shares (the cast, its colours, the walk plan); JSON-serialisable. */
export const rigScenePrepare = plan => prototypeCast(plan);

/** The scene at t seconds from its start, an el() SVG tree in canvas px on a transparent background. */
export const rigSceneTree = (plan, t, canvas, prepared = rigScenePrepare(plan)) => prototypeTree(t, canvas, plan, prepared);

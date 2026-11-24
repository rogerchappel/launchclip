// The per-frame rig painter HyperFrames inlines (bundled into RIG_RUNTIME,
// kit/hyperframes/rig-runtime.mjs, by scripts/rig-runtime.mjs): the frame
// at t seconds from the scene start, serialised as every other HyperFrames
// tree is (catalog-b.mjs renderNode), into the scene's rig layer. A pure
// function of (plan, prepared, t), so any seek, in any order, draws what
// Remotion draws for that frame. No DOM globals beyond the host it is given.

import {renderNode} from './hyperframes-catalog-b.mjs';
import {rigSceneTree} from './characters/rig-scene-layer.mjs';

/** The layer's markup at t (also what the parity tests compare). */
export const rigSceneHtml = (plan, prepared, t, canvas) => renderNode(rigSceneTree(plan, t, canvas, prepared));

/** Paint the layer at t; a frame equal to the last one (a hold) leaves the DOM alone. */
export function paintRigScene(host, plan, prepared, t, canvas) {
  const html = rigSceneHtml(plan, prepared, t, canvas);
  if (host.lcRigHtml !== html) { host.innerHTML = html; host.lcRigHtml = html; }
}

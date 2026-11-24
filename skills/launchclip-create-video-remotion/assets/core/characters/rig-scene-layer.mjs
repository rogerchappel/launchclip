// The per-frame rig layer of a cast scene (docs/rd/per-frame-rig.md). When
// a resolved cast-scene model carries content.rigScene, its characters are
// drawn per frame from rigSceneTree(plan, t) into one layer, `${id}-rig`,
// that charactersView (catalog-characters.mjs) puts where today's actors
// sit: over the set's back and any image screen, under its foreground,
// inside the camera wrappers (-cam, -overlay-cam, -punch), so framing and
// camera moves carry it as they carry the actors.
// Remotion fills the layer each frame (CatalogCharacters.tsx); HyperFrames
// fills it from a proxy tween with the same function inlined
// (kit/hyperframes/rig-runtime.mjs).
//
// Imports only kit/core files.

export {rigScenePrepare, rigSceneTree} from './rig-scene.mjs';

export const rigLayerId = model => `${model.id}-rig`;

/** The view with the rig layer holding `tree` (copies only the path down to it). */
export function fillRigLayer(view, model, tree) {
  const id = rigLayerId(model);
  const fill = node => {
    if (typeof node === 'string') return node;
    if (node.id === id) return {...node, children: [tree]};
    if (!find(node, id)) return node;
    return {...node, children: node.children.map(fill)};
  };
  return Object.fromEntries(Object.entries(view).map(([key, node]) => [key, node ? fill(node) : node]));
}

function find(node, id) {
  if (!node || typeof node === 'string') return null;
  if (node.id === id) return node;
  if (!node.tag) return Object.values(node).map(part => find(part, id)).find(Boolean) ?? null;
  for (const child of node.children ?? []) { const hit = find(child, id); if (hit) return hit; }
  return null;
}

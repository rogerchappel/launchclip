// The per-frame rig layer of a cast scene (docs/rd/per-frame-rig.md). When
// a resolved cast-scene model carries content.rigScene, its characters are
// drawn per frame from rigSceneTree(plan, t) into one layer, `${id}-rig`,
// where today's actor layer sits: over the set's back and any image screen,
// under its foreground, inside the camera wrappers (-cam, -overlay-cam,
// -punch), so framing and camera moves carry it as they carry the actors.
// Remotion fills the layer each frame (CatalogCharacters.tsx); HyperFrames
// fills it from a proxy tween with the same function inlined
// (kit/hyperframes/rig-runtime.mjs).
//
// Imports only kit/core files.

import {el, abs} from '../catalog-b-view.mjs';
// shortcut: the prototype behind the contract until rig-scene.mjs lands; then import from './rig-scene.mjs'.
export {rigScenePrepare, rigSceneTree} from './rig-scene-adapter.mjs';

export const rigLayerId = model => `${model.id}-rig`;

/**
 * The view with the empty rig layer in place (unchanged without
 * content.rigScene, or when the view already has the layer): in the overlay
 * when a video screen splits the scene, else in the scene's tree; through the
 * camera wrappers; just under the foreground (the last child).
 */
export function withRigLayer(model, view) {
  if (!model.content?.rigScene || find(view, rigLayerId(model))) return view;
  const {width, height} = model.canvas;
  const wrappers = new Set([`${model.id}-cam`, `${model.id}-overlay-cam`, `${model.id}-punch`]);
  const insert = node => {
    const kids = node.children;
    if (kids.length === 1 && wrappers.has(kids[0].id)) return {...node, children: [insert(kids[0])]};
    return {...node, children: [...kids.slice(0, -1), el('div', rigLayerId(model), abs(0, 0, width, height, {pointerEvents: 'none'})), ...kids.slice(-1)]};
  };
  return view.overlay ? {...view, overlay: insert(view.overlay)} : {...view, front: insert(view.front)};
}

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

// Remotion components for the character modules (cast-scene,
// character-cameo). The trees and op list are the ones the HyperFrames
// emitter uses (kit/core/catalog-characters.mjs), drawn by the shared
// catalogue E parts renderer: the module's layer, the screen media, then
// the cast overlay. A cast scene with content.rigScene draws its characters
// per frame into its rig layer (kit/core/characters/rig-scene-layer.mjs),
// the same function HyperFrames inlines.
import React, {useCallback, useMemo} from 'react';
// @ts-ignore plain ESM core module
import {charactersTimeline, charactersView} from '@launchclip/core/catalog-characters.mjs';
// @ts-ignore plain ESM core module
import {fillRigLayer, rigScenePrepare, rigSceneTree, withRigLayer} from '@launchclip/core/characters/rig-scene-layer.mjs';
import {PartsModule} from './CatalogE';

const rigView = (model: any) => withRigLayer(model, charactersView(model));

const RigScene: React.FC<{model: any}> = ({model}) => {
  const plan = model.content.rigScene;
  const prepared = useMemo(() => rigScenePrepare(plan), [plan]);
  const canvas = model.canvas;
  // The rig's time is the scene's own, held at the scene end as the HyperFrames proxy tween is.
  const perFrame = useCallback((view: any, t: number) => fillRigLayer(view, model, rigSceneTree(plan, Math.min(t, model.end) - model.start, {width: canvas.width, height: canvas.height}, prepared)), [model, plan, prepared, canvas]);
  return <PartsModule model={model} viewOf={rigView} timelineOf={charactersTimeline} perFrame={perFrame} />;
};

const typed = (id: string): React.FC<{model: any}> => {
  const Component: React.FC<{model: any}> = ({model}) => {
    if (model.module !== id) throw new Error(`${id} component got a ${model.module} model`);
    if (model.content?.rigScene) return <RigScene model={model} />;
    return <PartsModule model={model} viewOf={charactersView} timelineOf={charactersTimeline} />;
  };
  Component.displayName = id;
  return Component;
};

export const CastScene = typed('cast-scene');
export const CharacterCameo = typed('character-cameo');
export const SpriteScene = typed('sprite-scene');

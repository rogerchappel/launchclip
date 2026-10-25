// Remotion components for the character modules (cast-scene,
// character-cameo). The trees and op list are the ones the HyperFrames
// emitter uses (kit/core/catalog-characters.mjs), drawn by the shared
// catalogue E parts renderer: the module's layer, the screen media, then
// the cast overlay.
import React from 'react';
// @ts-ignore plain ESM core module
import {charactersTimeline, charactersView} from '../../core/catalog-characters.mjs';
import {PartsModule} from './CatalogE';

const typed = (id: string): React.FC<{model: any}> => {
  const Component: React.FC<{model: any}> = ({model}) => {
    if (model.module !== id) throw new Error(`${id} component got a ${model.module} model`);
    return <PartsModule model={model} viewOf={charactersView} timelineOf={charactersTimeline} />;
  };
  Component.displayName = id;
  return Component;
};

export const CastScene = typed('cast-scene');
export const CharacterCameo = typed('character-cameo');

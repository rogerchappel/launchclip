// EXPERIMENTAL (docs/rd/per-frame-rig.md): the per-frame rig prototype. Each
// frame draws the tree kit/core builds from rigFrame(t), a pure function of
// time, so any frame renders alone. Transparent background: the side-by-side
// lays it over the set. Not part of the storyboard schema; its own entry.
import React from 'react';
import {AbsoluteFill, Composition, registerRoot, useCurrentFrame, useVideoConfig} from 'remotion';
// @ts-ignore plain ESM core module
import {prototypePlan, rigScenePrepare, rigSceneTree} from '../../core/characters/rig-scene.mjs';
import {renderNode} from '../catalog/CatalogB';

const plan = prototypePlan();
const prepared = rigScenePrepare(plan);
const EMPTY = new Map();

export const PerFrameRig: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  return <AbsoluteFill>{renderNode(rigSceneTree(plan, frame / fps, {width, height}, prepared), EMPTY, 'rig')}</AbsoluteFill>;
};

const Root: React.FC = () => (
  <Composition id="ExperimentalPerFrameRig" component={PerFrameRig} width={1080} height={1920} fps={30} durationInFrames={240} />
);

registerRoot(Root);

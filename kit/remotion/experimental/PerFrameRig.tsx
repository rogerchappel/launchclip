// EXPERIMENTAL (docs/rd/per-frame-rig.md): the per-frame rig prototype. Each
// frame draws the tree kit/core builds from rigFrame(t), a pure function of
// time, so any frame renders alone. Transparent background: the side-by-side
// lays it over the set. Not part of the storyboard schema; its own entry.
import React from 'react';
import {AbsoluteFill, Composition, registerRoot, useCurrentFrame, useVideoConfig} from 'remotion';
// @ts-ignore plain ESM core module
import {prototypeCast, prototypeTree} from '@launchclip/core/characters/rig-frame-draw.mjs';
import {renderNode} from '../catalog/CatalogB';

const cast = prototypeCast();
const EMPTY = new Map();

export const PerFrameRig: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  return <AbsoluteFill>{renderNode(prototypeTree(frame / fps, {width, height}, undefined, cast), EMPTY, 'rig')}</AbsoluteFill>;
};

const Root: React.FC = () => (
  <Composition id="ExperimentalPerFrameRig" component={PerFrameRig} width={1080} height={1920} fps={30} durationInFrames={240} />
);

registerRoot(Root);

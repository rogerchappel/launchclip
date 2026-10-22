// Test-only Remotion entry for the parity harness and test/remotion_modules_a.test.js.
// It registers `ModuleReview` with the kit/remotion/Root.tsx contract
// (docs/KIT_CONTRACTS.md "Review compositions"): props {scene, story}, canvas
// from story.format, the module drawn on brand.colors.bg for its duration.
// Frame 0 is the scene start, so t = scene.start + frame / fps.
import React from 'react';
import {AbsoluteFill, Composition, registerRoot} from 'remotion';
// @ts-ignore plain ESM core shared with HyperFrames
import {resolveEditorialModule} from '../../../kit/core/editorial-core.mjs';
// @ts-ignore plain ESM helper shared with scripts/parity.mjs
import {editorialSpecFromScene, sceneDuration} from '../../../scripts/parity-scene.mjs';
import {COMPONENTS} from '../../../kit/remotion/modules/registry-a';

type ReviewProps = {scene: any; story: any};

const ModuleReview: React.FC<ReviewProps> = ({scene, story}) => {
  const Component = COMPONENTS[scene.module];
  if (!Component) throw new Error(`parity entry: no registry-a component for ${scene.module}`);
  const model = resolveEditorialModule(editorialSpecFromScene(scene, story));
  return (
    <AbsoluteFill style={{backgroundColor: story.brand?.colors?.bg ?? '#000000'}}>
      <Component model={model} />
    </AbsoluteFill>
  );
};

const Root: React.FC = () => (
  <Composition
    id="ModuleReview"
    component={ModuleReview}
    durationInFrames={30}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{scene: {id: 'review', module: 'callout', start: 0, end: 4, params: {title: 'Review', body: 'Module review.'}},
      story: {format: {width: 1080, height: 1920, fps: 30, duration: 4}, brand: {colors: {bg: '#101018'}}}} as ReviewProps}
    calculateMetadata={({props}) => {
      const format = props.story.format;
      const fps = Number(props.story.resolved?.fps ?? format.fps ?? 30);
      return {fps, width: format.width, height: format.height, durationInFrames: Math.max(1, Math.round(sceneDuration(props.scene) * fps))};
    }}
  />
);

registerRoot(Root);

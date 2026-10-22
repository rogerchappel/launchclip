// Test-only Remotion entry for catalogue B parity (scripts/parity-cat-b.mjs and
// test/catalog_b.test.js). Registers ModuleReview with props {scene, story}:
// it resolves the scene with kit/core/catalog-b.mjs and renders that one
// module on brand.colors.bg for the scene's duration (frame 0 = scene start).
import React from 'react';
import {AbsoluteFill, Composition, registerRoot} from 'remotion';
import { ensureFonts } from '../../../kit/remotion/fonts';
// @ts-ignore plain ESM core module
import {MODULES} from '../../../kit/core/catalog-b.mjs';
import {COMPONENTS} from '../../../kit/remotion/catalog/registry-b';

type Props = {scene: any; story: any};

export function resolveScene({scene, story}: Props) {
  const format = story.format;
  const ctx = {id: scene.id, start: scene.start, duration: scene.end - scene.start, format, brand: story.brand,
    aspect: format.height > format.width ? '9:16' : '16:9', hits: (scene.hits ?? []).filter((hit: any) => typeof hit.at === 'number')};
  return MODULES[scene.module].resolve(scene.params ?? {}, ctx);
}

const ModuleReview: React.FC<Props> = (props) => {
  ensureFonts(props.story?.brand);
  const model = React.useMemo(() => resolveScene(props), [props]);
  const Component = COMPONENTS[model.module];
  return (
    <AbsoluteFill style={{backgroundColor: props.story.brand.colors.bg}}>
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
    defaultProps={{scene: null, story: null} as unknown as Props}
    calculateMetadata={({props}) => {
      const {format} = props.story;
      const duration = props.scene.end - props.scene.start;
      return {fps: format.fps, width: format.width, height: format.height, durationInFrames: Math.max(1, Math.round(duration * format.fps))};
    }}
  />
);

registerRoot(Root);

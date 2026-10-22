// Test-only Remotion entry for the batch B editorial components. It registers
// a ModuleReview composition with props {scene, story} (the contract that
// kit/remotion/Root.tsx implements): the scene's editorial spec is resolved
// with resolveEditorialModule and drawn on story.brand.colors.bg. Frame 0 is
// the scene start and the composition lasts the scene's duration.
import React from "react";
import { AbsoluteFill, Composition, registerRoot } from "remotion";
// @ts-ignore plain ESM core, bundled by Remotion
import { resolveEditorialModule } from "../../../kit/core/editorial-core.mjs";
import { COMPONENTS } from "../../../kit/remotion/modules/registry-b";

type Props = { scene: any; story: any };

function sceneModel({ scene, story }: Props) {
  const { width, height } = story.format;
  return resolveEditorialModule({ ...scene.params, id: scene.id, kind: scene.module, aspect: width > height ? "16:9" : "9:16",
    start: scene.start, duration: scene.end - scene.start });
}

const ModuleReview: React.FC<Props> = (props) => {
  const model = sceneModel(props);
  const Component = COMPONENTS[model.kind];
  if (!Component) throw new Error(`no batch B component for ${model.kind}`);
  return (
    <AbsoluteFill style={{ backgroundColor: props.story.brand?.colors?.bg ?? "#000000" }}>
      <AbsoluteFill><Component model={model} /></AbsoluteFill>
    </AbsoluteFill>
  );
};

const Root: React.FC = () => (
  <Composition
    id="ModuleReview"
    component={ModuleReview}
    durationInFrames={30}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{ scene: null, story: null } as unknown as Props}
    calculateMetadata={({ props }) => {
      const { width, height, fps } = props.story.format;
      return { width, height, fps, durationInFrames: Math.max(1, Math.round((props.scene.end - props.scene.start) * fps)) };
    }}
  />
);

registerRoot(Root);

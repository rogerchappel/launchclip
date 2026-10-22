// Test-only Remotion entry for catalogue A parity (scripts/parity-cat-a.mjs
// and test/catalog_a.test.js). It registers `ModuleReview` with props
// {scene, story}, the same input as resolveModule(), and renders that one
// catalogue A module on brand.colors.bg for the scene's duration. The real
// ModuleReview lives in kit/remotion/Root.tsx (owned by the compiler work).
import React from "react";
import { AbsoluteFill, Composition, registerRoot } from "remotion";
// @ts-ignore plain ESM core without type declarations
import { MODULES } from "../../../kit/core/catalog-a.mjs";
import { COMPONENTS } from "../../../kit/remotion/catalog/registry-a";

type Props = { scene: any; story: any };

const aspect = (width: number, height: number) => (height > width ? "9:16" : "16:9");

export function resolveScene({ scene, story }: Props) {
  const format = story.format;
  const ctx = {
    id: scene.id,
    start: Number(scene.start),
    duration: Number(scene.end) - Number(scene.start),
    format: { width: format.width, height: format.height, fps: format.fps, duration: format.duration },
    brand: story.brand,
    aspect: aspect(format.width, format.height)
  };
  return MODULES[scene.module].resolve(scene.params ?? {}, ctx);
}

const ModuleReview: React.FC<Props> = (props) => {
  const model = resolveScene(props);
  const Component = COMPONENTS[model.module];
  return (
    <AbsoluteFill style={{ backgroundColor: props.story.brand.colors.bg }}>
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
    defaultProps={{ scene: null, story: null } as unknown as Props}
    calculateMetadata={({ props }) => {
      const format = props.story.format;
      const fps = Number(format.fps ?? 30);
      return { fps, width: format.width, height: format.height, durationInFrames: Math.max(1, Math.round((props.scene.end - props.scene.start) * fps)) };
    }}
  />
);

registerRoot(Root);

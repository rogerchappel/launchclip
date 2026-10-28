// Remotion twin of the HyperFrames brand-frame runtime (kit/core/brand-frame.mjs):
// the same frame plan (nodes, CSS and GSAP tween list), with every tween
// evaluated from the frame alone by captionElementStateAt, which reproduces
// GSAP's forward-seek semantics. Mount once, above the scenes and under the
// captions, for the whole composition (not inside a Sequence).
import React from "react";
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from "remotion";
import { assetUrl } from "../media";
// @ts-ignore plain ESM from kit/core
import { brandFramePlan } from "@launchclip/core/brand-frame.mjs";
// @ts-ignore plain ESM from kit/core
import { captionElementStateAt, captionInlineStyle, indexCaptionTweens } from "@launchclip/core/captions.mjs";

type PlanNode = { tag: string; id: string; cls?: string; text?: string; src?: string; children?: PlanNode[] };

function renderNode(node: PlanNode, index: Map<string, any>, t: number): React.ReactNode {
  const style = captionInlineStyle(captionElementStateAt(index, node.id, t)) as React.CSSProperties;
  if (node.tag === "img") return <Img key={node.id} id={node.id} className={node.cls} style={style} src={assetUrl(node.src ?? "")} alt="" />;
  return React.createElement(node.tag, { key: node.id, id: node.id, className: node.cls, style },
    node.text ?? null,
    ...(node.children ?? []).map((child) => renderNode(child, index, t)));
}

export const BrandFrame: React.FC<{ story: any }> = ({ story }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const plan = React.useMemo(() => brandFramePlan(story, { format: { width, height, duration: story?.resolved?.duration } }), [story, width, height]);
  const index = React.useMemo(() => (plan ? indexCaptionTweens(plan.tweens) : new Map()), [plan]);
  if (!plan) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 90000 }} aria-hidden>
      <style>{plan.css}</style>
      {(plan.nodes as PlanNode[]).map((node) => renderNode(node, index, t))}
    </AbsoluteFill>
  );
};

export default BrandFrame;

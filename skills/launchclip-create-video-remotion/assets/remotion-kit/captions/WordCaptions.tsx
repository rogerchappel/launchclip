// Remotion twin of the HyperFrames caption runtime (kit/core/captions.mjs):
// the same caption plan (nodes, CSS and GSAP tween list) for the overlay's
// preset, with every tween evaluated from the frame alone by
// captionElementStateAt, which reproduces GSAP's forward-seek semantics. Mount
// once, on the top layer, for the whole composition (not inside a Sequence):
// t = frame / fps.
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
// @ts-ignore plain ESM from kit/core
import { captionBandFor, captionElementStateAt, captionInlineStyle, captionPlan, CAPTION_DEFAULT_COLORS, indexCaptionTweens } from "../../core/captions.mjs";

export type CaptionWord = { text: string; start: number; end: number };
export type CaptionChunk = { id: string; start: number; end: number; words: CaptionWord[] };
type PlanNode = { tag: string; id: string; cls?: string; text?: string; children?: PlanNode[] };

export type WordCaptionsProps = {
  chunks: CaptionChunk[];
  hide?: Array<[number, number]>;
  /** The story's captions overlay ({type: "captions", preset|style, ...options}). */
  overlay?: any;
  /** The resolved story (brand colours and fonts, scene hits for auto emphasis). */
  story?: any;
  idle?: string;
  active?: string;
  spoken?: string;
  fontFamily?: string;
};

function renderNode(node: PlanNode, index: Map<string, any>, t: number): React.ReactNode {
  const style = captionInlineStyle(captionElementStateAt(index, node.id, t)) as React.CSSProperties;
  return React.createElement(node.tag, { key: node.id, id: node.id, className: node.cls, style },
    node.text ?? null,
    ...(node.children ?? []).map((child) => renderNode(child, index, t)));
}

export const WordCaptions: React.FC<WordCaptionsProps> = ({ chunks, hide = [], overlay, story, idle = CAPTION_DEFAULT_COLORS.idle, active = CAPTION_DEFAULT_COLORS.active, spoken, fontFamily }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const key = JSON.stringify({ chunks: chunks.length, overlay, brand: story?.brand, hits: story?.scenes?.map((scene: any) => scene?.hits ?? null), hide, idle, active, spoken, fontFamily, width, height });
  const plan = React.useMemo(() => {
    const brand = story?.brand ?? { colors: { paper: idle, primary: active }, fonts: {} };
    const own = overlay ?? { type: "captions", style: "word-highlight", colors: spoken ? { spoken } : undefined };
    return captionPlan(chunks, own, { brand, format: { width, height }, story, hide, fonts: fontFamily && !story ? { display: fontFamily } : undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunks, key]);
  const index = React.useMemo(() => indexCaptionTweens(plan.tweens), [plan]);
  // A top-level node is invisible until a tween gives it opacity (its CSS
  // starts at opacity 0 or scaleX 0), so only those are drawn.
  const shown = (plan.nodes as PlanNode[]).filter((node) => {
    const state = captionElementStateAt(index, node.id, t);
    return typeof state.opacity === "number" && state.opacity > 0;
  });
  const B = captionBandFor({ width, height });
  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: B.zIndex }}>
      <style>{plan.css}</style>
      <div className="lc-captions">{shown.map((node) => renderNode(node, index, t))}</div>
    </AbsoluteFill>
  );
};

export default WordCaptions;

// Labelled placeholder for a scene whose module is unknown, invalid or has no
// Remotion component. Drawn from kit/core/modules.mjs placeholderModel() and
// PLACEHOLDER_STYLE, exactly like the HyperFrames compiler's placeholder.
import React from "react";
import { AbsoluteFill } from "remotion";
// @ts-ignore plain ESM from kit/core
import { PLACEHOLDER_STYLE } from "../core/modules.mjs";

export const Placeholder: React.FC<{ model: any }> = ({ model }) => {
  const S = PLACEHOLDER_STYLE;
  const { rect, content } = model;
  return (
    <AbsoluteFill>
      <section data-launchclip-placeholder={model.module ?? ""} style={{
        position: "absolute", left: rect.x, top: rect.y, width: rect.width, height: rect.height, boxSizing: "border-box",
        display: "flex", flexDirection: "column", justifyContent: "center", gap: 16, padding: S.padding, overflow: "hidden",
        background: S.surface, color: S.foreground, border: `${S.borderWidth}px dashed ${S.border}`, borderRadius: S.radius, fontFamily: S.fontFamily
      }}>
        <div style={{ fontSize: S.labelSize, fontWeight: 800, lineHeight: 1.1, overflowWrap: "anywhere" }}>{content.label}</div>
        {content.detail ? <div style={{ fontSize: S.detailSize, lineHeight: 1.3, color: S.muted, overflowWrap: "anywhere" }}>{content.detail}</div> : null}
      </section>
    </AbsoluteFill>
  );
};

export default Placeholder;

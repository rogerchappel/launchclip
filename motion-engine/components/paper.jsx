import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { CARD, PAPER, SEMANTIC } from "../theme.js";

// The world: warm paper with a faint drawn grid. Behind every scene, always.
// offsetX parallaxes the grid during camera swipes so the table travels too.
export function PaperGround({ offsetX = 0 }) {
  return (
    <AbsoluteFill style={{ background: PAPER.ground }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${PAPER.grid} 1px, transparent 1px), linear-gradient(90deg, ${PAPER.grid} 1px, transparent 1px)`,
          backgroundSize: `${PAPER.gridSize}px ${PAPER.gridSize}px`,
          backgroundPosition: `${offsetX}px 0px`,
          // Reference: the grid lives in the middle of the frame and fades to
          // clean paper at the edges.
          WebkitMaskImage: "radial-gradient(90% 75% at 50% 45%, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 100%)",
          maskImage: "radial-gradient(90% 75% at 50% 45%, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 100%)"
        }}
      />
      <AbsoluteFill style={{ background: PAPER.vignette }} />
    </AbsoluteFill>
  );
}

// The living border for dark focal cards (ART_DIRECTION 4d.3): a bright
// gradient sweep travelling the card edge, with a soft glow trailing it.
// Wrap the Card; the sweep hugs whatever radius the card uses.
export function GlowBorder({ radius = CARD.radius, color = SEMANTIC.mint, thickness = 4, sweepDegreesPerSecond = 70, style, children }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const angle = ((frame / fps) * sweepDegreesPerSecond) % 360;
  const ring = `conic-gradient(from ${angle}deg, transparent 0deg, ${color} 30deg, #CFF5E4 42deg, ${color} 54deg, transparent 86deg)`;
  const edge = {
    position: "absolute",
    inset: -thickness,
    borderRadius: radius + thickness,
    background: ring
  };
  return (
    <div style={{ position: "relative", ...style }}>
      <div style={{ ...edge, inset: -thickness * 2, borderRadius: radius + thickness * 2, filter: `blur(${thickness * 5}px)`, opacity: 0.8 }} />
      <div
        style={{
          ...edge,
          padding: thickness,
          WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude"
        }}
      />
      {/* Positioned so the card paints above the glow layers, which would
          otherwise overlay it (statics paint below positioned siblings). */}
      <div style={{ position: "relative" }}>{children}</div>
    </div>
  );
}

// The universal physical object: rounded card with a believable soft shadow.
// `chip` adds drawn thickness (extruded edge) — for diagram nodes and steps.
export function Card({ dark = false, radius = CARD.radius, tilt = 0, elevation = "mid", chip = false, style, children }) {
  const shadow = elevation === "low" ? CARD.shadowLow : elevation === "high" ? CARD.shadowHigh : CARD.shadow;
  const edge = chip ? `0 5px 0 ${dark ? "#000000" : "#D8D3CA"}, ` : "";
  return (
    <div
      style={{
        background: dark ? CARD.dark : CARD.light,
        borderRadius: radius,
        boxShadow: `${edge}${shadow}`,
        transform: tilt ? `rotate(${tilt}deg)` : undefined,
        overflow: "hidden",
        ...style
      }}
    >
      {children}
    </div>
  );
}

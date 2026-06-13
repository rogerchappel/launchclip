import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { CARD, PAPER, SEMANTIC } from "../theme.js";

// The world: warm paper with a faint drawn grid. Behind every scene, always.
export function PaperGround() {
  return (
    <AbsoluteFill style={{ background: PAPER.ground }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${PAPER.grid} 1px, transparent 1px), linear-gradient(90deg, ${PAPER.grid} 1px, transparent 1px)`,
          backgroundSize: `${PAPER.gridSize}px ${PAPER.gridSize}px`,
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

// The living border for dark focal cards (ART_DIRECTION 4d.3, tuned in 4e):
// a long, bright rim-light sweep travelling the card edge — reference reads
// the reference reads as a light catching ONE edge of the card, not a halo
// around the whole thing: a thin, bright rim that travels the border with
// only a small bloom falling just past the edge. Wrap the Card; the sweep
// hugs its radius. (Tuned in the P4 teardown — was a wide diffuse 210° bloom,
// which read as mush; now a tight ~110° arc with a crisp rim line.)
export function GlowBorder({ radius = CARD.radius, color = SEMANTIC.mint, thickness = 3, sweepDegreesPerSecond = 80, style, children }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const angle = ((frame / fps) * sweepDegreesPerSecond) % 360;
  const ring = `conic-gradient(from ${angle}deg, transparent 0deg, ${color} 34deg, #E4FFF2 55deg, ${color} 76deg, transparent 110deg)`;
  const edge = {
    position: "absolute",
    inset: -thickness,
    borderRadius: radius + thickness,
    background: ring
  };
  return (
    <div style={{ position: "relative", ...style }}>
      <div style={{ ...edge, inset: -thickness * 1.5, borderRadius: radius + thickness * 1.5, filter: `blur(${thickness * 3}px)`, opacity: 0.55 }} />
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

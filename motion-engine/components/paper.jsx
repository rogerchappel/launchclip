import React from "react";
import { AbsoluteFill } from "remotion";
import { CARD, PAPER } from "../theme.js";

// The world: warm paper with a faint drawn grid. Behind every scene, always.
export function PaperGround() {
  return (
    <AbsoluteFill style={{ background: PAPER.ground }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${PAPER.grid} 1px, transparent 1px), linear-gradient(90deg, ${PAPER.grid} 1px, transparent 1px)`,
          backgroundSize: `${PAPER.gridSize}px ${PAPER.gridSize}px`,
          backgroundPosition: "center"
        }}
      />
      <AbsoluteFill style={{ background: PAPER.vignette }} />
    </AbsoluteFill>
  );
}

// The universal physical object: rounded card with a believable soft shadow.
// Everything that isn't typography sits in one of these.
export function Card({ dark = false, radius = CARD.radius, tilt = 0, elevation = "mid", style, children }) {
  const shadow = elevation === "low" ? CARD.shadowLow : elevation === "high" ? CARD.shadowHigh : CARD.shadow;
  return (
    <div
      style={{
        background: dark ? CARD.dark : CARD.light,
        borderRadius: radius,
        boxShadow: shadow,
        transform: tilt ? `rotate(${tilt}deg)` : undefined,
        overflow: "hidden",
        ...style
      }}
    >
      {children}
    </div>
  );
}

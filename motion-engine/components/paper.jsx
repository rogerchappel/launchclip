import React from "react";
import { AbsoluteFill } from "remotion";
import { CARD, PAPER } from "../theme.js";

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

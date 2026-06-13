import React from "react";
import { AbsoluteFill, Img, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Card } from "./paper.jsx";
import { FONTS, SPRINGS } from "../theme.js";

// A magnifying glass gliding over a real screenshot. The lens shows a TRUE
// magnified copy of the content beneath it (a scaled copy of the same
// screenshot, aligned so the point under the lens centre is what's enlarged) —
// not fixed text glued to the glass. A metal handle joins the rim; a faint
// chromatic fringe rides the edge. The card fits within the frame.
const MAG = 2.0; // magnification factor inside the lens

export function MagnifierScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t * t * (3 - 2 * t); // smoothstep
  const resolveSrc = (s) => (/^https?:\/\//.test(s) ? s : staticFile(s));

  const start = typeof scene?.start === "number" ? scene.start : 0;
  const end = typeof scene?.end === "number" ? scene.end : start + 4;
  const sceneFrames = Math.max(1, Math.round((end - start) * fps));
  const from = scene?.from || { x: 0.3, y: 0.3 };
  const to = scene?.to || { x: 0.65, y: 0.65 };
  const src = scene?.src;

  // Card geometry — fits below the chapter rail and inside the frame.
  const cardW = width * 0.82;
  const cardH = Math.min(height * 0.68, cardW * 1.4);
  const cardX = (width - cardW) / 2;
  const cardY = height * 0.15;

  // Entrance: card and lens settle in.
  const intro = clamp(spring({ frame, fps, config: SPRINGS.enter }));
  const lensIn = clamp(spring({ frame: frame - Math.round(fps * 0.2), fps, config: SPRINGS.enter }));

  // Lens travel — continuous smoothstep across the card (not a spring).
  const p = ease(clamp(frame / sceneFrames));
  const cxFrac = lerp(from.x, to.x, p);
  const cyFrac = lerp(from.y, to.y, p);

  const lensD = width * 0.32;
  const R = lensD / 2;
  // Lens centre in frame px, kept fully over the card.
  const cx = cardX + clamp(cxFrac, R / cardW, 1 - R / cardW) * cardW;
  const cy = cardY + clamp(cyFrac, R / cardH, 1 - R / cardH) * cardH;
  // Point of the card under the lens centre (card-local), for the magnified copy.
  const px = cx - cardX;
  const py = cy - cardY;

  const RIM = Math.round(lensD * 0.035);
  const handleLen = lensD * 0.5;
  const handleW = lensD * 0.12;

  const placeholder = (
    <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#EDEBE6,#E2DFD8)" }} />
  );

  return (
    <AbsoluteFill style={{ fontFamily: FONTS.sans }}>
      {/* The screenshot card. */}
      <div
        style={{
          position: "absolute",
          left: cardX,
          top: cardY,
          width: cardW,
          height: cardH,
          opacity: intro,
          transform: `scale(${lerp(0.94, 1, intro)})`,
          transformOrigin: "center"
        }}
      >
        <Card elevation="high" radius={24} style={{ width: "100%", height: "100%", background: "#FFFFFF" }}>
          {src ? <Img src={resolveSrc(src)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} /> : placeholder}
        </Card>
      </div>

      {/* The lens, above the card so it is never clipped. */}
      <div
        style={{
          position: "absolute",
          left: cx - R,
          top: cy - R,
          width: lensD,
          height: lensD,
          opacity: lensIn,
          transform: `scale(${lerp(0.85, 1, lensIn)})`,
          transformOrigin: "center"
        }}
      >
        {/* Handle — drawn first, from the lens centre outward at 45°, so the
            glass body covers its inner end and it reads as joined to the rim. */}
        <div
          style={{
            position: "absolute",
            left: R,
            top: R,
            width: R + handleLen,
            height: handleW,
            marginTop: -handleW / 2,
            borderRadius: handleW,
            transformOrigin: "0 50%",
            transform: "rotate(45deg)",
            background: "linear-gradient(180deg,#5A5A56,#2B2B28 55%,#44443F)",
            boxShadow: "2px 3px 5px rgba(26,26,24,0.34)"
          }}
        />

        {/* Glass: a circular window showing the magnified screenshot beneath. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            overflow: "hidden",
            boxShadow: "4px 7px 16px rgba(26,26,24,0.32)",
            background: "#FFFFFF"
          }}
        >
          {src ? (
            <Img
              src={resolveSrc(src)}
              style={{
                position: "absolute",
                left: R - px * MAG,
                top: R - py * MAG,
                width: cardW * MAG,
                height: cardH * MAG,
                objectFit: "cover",
                objectPosition: "top"
              }}
            />
          ) : (
            placeholder
          )}
          {/* Curved-glass sheen + edge vignette. */}
          <div style={{ position: "absolute", top: "8%", left: "12%", width: "46%", height: "30%", borderRadius: "50%", background: "linear-gradient(135deg,rgba(255,255,255,0.7),rgba(255,255,255,0))", filter: "blur(2px)" }} />
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", boxShadow: "inset 0 0 30px rgba(26,26,24,0.18)" }} />
        </div>

        {/* Chromatic fringe: faint cyan/red offset ring outlines at the rim. */}
        <div style={{ position: "absolute", inset: RIM, borderRadius: "50%", border: "1px solid rgba(0,190,255,0.45)", transform: "translate(-1px,-1px)" }} />
        <div style={{ position: "absolute", inset: RIM, borderRadius: "50%", border: "1px solid rgba(255,50,50,0.45)", transform: "translate(1px,1px)" }} />

        {/* Metal rim ring. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: `${RIM}px solid transparent`,
            background:
              "conic-gradient(from 220deg,#B9B9B2,#6E6E68 18%,#3A3A36 38%,#8C8C85 55%,#5A5A55 72%,#C7C7BF 90%,#B9B9B2) border-box",
            WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
            boxShadow: "inset 0 1px 1px rgba(255,255,255,0.4), inset 0 -2px 3px rgba(0,0,0,0.4)"
          }}
        />
      </div>
    </AbsoluteFill>
  );
}

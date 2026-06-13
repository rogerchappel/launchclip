import React from "react";
import {
  AbsoluteFill,
  Img,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";
import { FONTS, SPRINGS } from "../theme.js";
import { Card } from "./paper.jsx";

// A magnifying glass gliding over a product screenshot. The lens reveals a
// "magnified detail": the key phrase rendered in prism/rainbow text, with a
// believable glass body, chromatic fringing at the rim, and a metal handle.
//
// The travel uses smoothstep over scene progress (NOT a spring) so the glide
// reads as one continuous, eased pass rather than a settle-and-stop.
export function MagnifierScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // --- helpers -------------------------------------------------------------
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t * t * (3 - 2 * t); // smoothstep
  const resolveSrc = (s) => (/^https?:\/\//.test(s) ? s : staticFile(s));

  // --- scene config (robust to missing values) ----------------------------
  const start = scene && typeof scene.start === "number" ? scene.start : 0;
  const end = scene && typeof scene.end === "number" ? scene.end : start + 4;
  const sceneFrames = Math.max(1, Math.round((end - start) * fps));

  const from = (scene && scene.from) || { x: 0.3, y: 0.3 };
  const to = (scene && scene.to) || { x: 0.65, y: 0.65 };
  const text = (scene && scene.text) || "";
  const src = scene && scene.src;

  // --- card geometry -------------------------------------------------------
  const cardW = width * 0.86;
  const cardH = Math.min(height * 0.8, cardW * (16 / 9));
  const cardX = (width - cardW) / 2;
  const cardY = (height - cardH) / 2;

  // --- entrance ------------------------------------------------------------
  const intro = spring({ frame, fps, config: SPRINGS.enter });
  const cardOpacity = clamp(intro);
  const cardScale = lerp(0.92, 1, clamp(intro));

  // --- lens travel (continuous smoothstep) --------------------------------
  const progress = clamp(frame / sceneFrames);
  const p = ease(progress);
  const cxFrac = lerp(from.x, to.x, p);
  const cyFrac = lerp(from.y, to.y, p);

  // Lens center in absolute frame px, clamped so the lens stays over the card.
  const lensD = width * 0.34;
  const lensR = lensD / 2;
  const lensCx = clamp(
    cardX + cxFrac * cardW,
    cardX + lensR * 0.6,
    cardX + cardW - lensR * 0.6
  );
  const lensCy = clamp(
    cardY + cyFrac * cardH,
    cardY + lensR * 0.6,
    cardY + cardH - lensR * 0.6
  );

  // Lens fades in just after the card lands.
  const lensIn = clamp(spring({ frame: frame - Math.round(fps * 0.25), fps, config: SPRINGS.enter }));

  // --- rim / glass styling -------------------------------------------------
  const RIM = 7; // metallic ring thickness
  const handleLen = lensD * 0.62;
  const handleW = lensD * 0.13;

  return (
    <AbsoluteFill style={{ fontFamily: FONTS.sans }}>
      {/* The screenshot card */}
      <div
        style={{
          position: "absolute",
          left: cardX,
          top: cardY,
          width: cardW,
          height: cardH,
          opacity: cardOpacity,
          transform: `scale(${cardScale})`,
          transformOrigin: "center"
        }}
      >
        <Card
          elevation="high"
          radius={24}
          style={{ width: "100%", height: "100%", background: "#F1EFEA" }}
        >
          {src ? (
            <Img
              src={resolveSrc(src)}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: "top"
              }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                background:
                  "linear-gradient(135deg, #EDEBE6 0%, #E2DFD8 100%)"
              }}
            />
          )}
        </Card>
      </div>

      {/* The lens. Absolutely positioned by its top-left; centered on the
          travel point. Rendered above the card so it never gets clipped. */}
      <div
        style={{
          position: "absolute",
          left: lensCx - lensR,
          top: lensCy - lensR,
          width: lensD,
          height: lensD,
          opacity: lensIn,
          transform: `scale(${lerp(0.85, 1, lensIn)})`,
          transformOrigin: "center"
        }}
      >
        {/* Handle — sticks out lower-right at ~135° from center, drawn first
            so the lens body overlaps its inner end. */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: handleLen,
            height: handleW,
            borderRadius: handleW,
            transformOrigin: "left center",
            // 45° below horizontal, pointing to lower-right (≈135° clock-style).
            transform: `translate(${lensR * 0.62}px, ${-handleW / 2}px) rotate(45deg)`,
            background:
              "linear-gradient(180deg, #5A5A56 0%, #2B2B28 45%, #44443F 100%)",
            boxShadow:
              "3px 4px 6px rgba(26,26,24,0.32), inset 0 1px 0 rgba(255,255,255,0.25)"
          }}
        />

        {/* Drop shadow under the glass (bottom-right). */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            boxShadow: "5px 8px 18px rgba(26,26,24,0.34)"
          }}
        />

        {/* Glass body — clips the magnified content to the circle. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            overflow: "hidden",
            background:
              "radial-gradient(120% 120% at 30% 25%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.12) 28%, rgba(255,255,255,0.04) 55%, rgba(180,200,220,0.10) 100%)",
            backdropFilter: "saturate(1.05)"
          }}
        >
          {/* Faint scaled-up copy of the screenshot for depth. */}
          {src ? (
            <Img
              src={resolveSrc(src)}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: lensD * 1.6,
                height: lensD * 1.6,
                transform: "translate(-50%, -50%) scale(1.5)",
                objectFit: "cover",
                objectPosition: "top",
                opacity: 0.28,
                filter: "saturate(1.15)"
              }}
            />
          ) : null}

          {/* Prism / rainbow key phrase — the hero magnified detail. */}
          {text ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: lensD * 0.12,
                textAlign: "center",
                transform: "scale(1.12)"
              }}
            >
              <span
                style={{
                  fontFamily: FONTS.sans,
                  fontWeight: 800,
                  fontSize: lensD * 0.13,
                  lineHeight: 1.05,
                  letterSpacing: "-0.01em",
                  background:
                    "linear-gradient(95deg, #E0453B 0%, #E89B2E 18%, #E7D540 34%, #46B36A 52%, #3CA6D6 70%, #6E62D8 86%, #B85FD0 100%)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  color: "transparent",
                  textShadow: "0 1px 0 rgba(255,255,255,0.25)"
                }}
              >
                {text}
              </span>
            </div>
          ) : null}

          {/* Top-left glass highlight streak. */}
          <div
            style={{
              position: "absolute",
              top: "8%",
              left: "12%",
              width: "46%",
              height: "30%",
              borderRadius: "50%",
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0) 70%)",
              filter: "blur(2px)",
              pointerEvents: "none"
            }}
          />

          {/* Edge vignette / inner shadow — sells the curved glass. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              boxShadow:
                "inset 0 0 36px rgba(26,26,24,0.22), inset 6px 8px 22px rgba(26,26,24,0.18)",
              pointerEvents: "none"
            }}
          />
        </div>

        {/* Chromatic fringing — a thin conic R→G→B ring just inside the rim. */}
        <div
          style={{
            position: "absolute",
            inset: RIM,
            borderRadius: "50%",
            padding: 2,
            background:
              "conic-gradient(from 0deg, #ff0040, #00ff66, #2da8ff, #ff0040)",
            WebkitMask:
              "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
            opacity: 0.45,
            pointerEvents: "none"
          }}
        />
        {/* Offset cyan/red fringe outlines for a subtle aberration shimmer. */}
        <div
          style={{
            position: "absolute",
            inset: RIM,
            borderRadius: "50%",
            border: "1px solid rgba(0,200,255,0.5)",
            transform: "translate(-1px, -1px)",
            pointerEvents: "none"
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: RIM,
            borderRadius: "50%",
            border: "1px solid rgba(255,40,40,0.5)",
            transform: "translate(1px, 1px)",
            pointerEvents: "none"
          }}
        />

        {/* Metallic rim ring. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: `${RIM}px solid transparent`,
            background:
              "conic-gradient(from 220deg, #B9B9B2, #6E6E68 18%, #3A3A36 38%, #8C8C85 55%, #5A5A55 72%, #C7C7BF 90%, #B9B9B2 100%) border-box",
            WebkitMask:
              "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
            boxShadow:
              "inset 0 1px 1px rgba(255,255,255,0.4), inset 0 -2px 3px rgba(0,0,0,0.4)",
            pointerEvents: "none"
          }}
        />
      </div>
    </AbsoluteFill>
  );
}

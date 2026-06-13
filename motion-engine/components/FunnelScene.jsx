import React from "react";
import { AbsoluteFill, Img, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Card } from "./paper.jsx";
import { FONTS, INK, SEMANTIC, CARD, SPRINGS } from "../theme.js";
import { stackLayout } from "../reflow.js";

// A funnel: numbered step cards, CENTERED and narrowing symmetrically as they
// descend (both edges step inward, so it reads as a funnel — not a one-sided
// skew), threaded by a centre dotted spine and landing one per beat with
// reflow. One step may be a success colour. The whole figure sits below the
// chapter rail and stays within the frame (no edge bleed).
const TOP_SAFE = 0.15; // leave the chapter rail its room up top

export function FunnelScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const resolveSrc = (s) => (/^https?:\/\//.test(s) ? s : staticFile(s));
  const sem = (name) => SEMANTIC[name] ?? name;
  const lerp = (a, b, t) => a + (b - a) * t;

  const items = Array.isArray(scene.items) ? scene.items : [];
  const n = items.length;

  // Cards narrow from a wide top to a narrower bottom, but stay wide enough
  // that 2-word labels fit. Centered, so both edges taper symmetrically.
  const maxW = width * 0.84;
  const minW = width * 0.58;
  const cardH = Math.round(height * 0.088);
  const gap = Math.round(height * 0.02);
  const widthForIndex = (i) => (n <= 1 ? maxW : lerp(maxW, minW, i / (n - 1)));

  const presenceAt = (atSeconds, f) => {
    const local = f - (atSeconds - scene.start) * fps;
    if (local < 0) return 0;
    return spring({ frame: local, fps, config: SPRINGS.enter });
  };
  const presences = items.map((it) => presenceAt(it.at, frame));
  const presencesPrev = items.map((it) => presenceAt(it.at, frame - 1));

  // Reflow the stack: each slot grows with its presence so neighbours glide.
  const sizes = items.map(() => cardH + gap);
  const { centers, total } = stackLayout({ sizes, presences, gap: 0 });

  const landedCount = presences.reduce((acc, p) => acc + Math.min(1, p * 1.5), 0);
  const spineProgress = n > 0 ? Math.min(1, landedCount / n) : 0;

  const titlePresence = scene.title ? presenceAt(scene.start, frame) : 0;
  const titlePrev = scene.title ? presenceAt(scene.start, frame - 1) : 0;

  const blurFor = (now, prev) => {
    const b = Math.min(5, Math.max(0, now - prev) * 30);
    return b > 0.4 ? `blur(${b.toFixed(1)}px)` : undefined;
  };

  // Lay the figure out below the rail: title, then the centred card stack.
  const titleY = height * (TOP_SAFE + 0.02);
  const stackTop = height * (scene.title ? TOP_SAFE + 0.12 : TOP_SAFE + 0.04);
  const stackCenterY = stackTop + total / 2;
  const spineTop = stackCenterY - total / 2;

  return (
    <AbsoluteFill>
      {scene.title ? (
        <div
          style={{
            position: "absolute",
            top: titleY,
            left: 0,
            width: "100%",
            textAlign: "center",
            opacity: Math.min(1, titlePresence * 1.5),
            transform: `translateY(${(1 - Math.min(1, titlePresence)) * height * 0.04}px) rotate(-2deg) scale(${lerp(0.85, 1, Math.min(1, titlePresence))})`,
            filter: blurFor(titlePresence, titlePrev),
            fontFamily: FONTS.script,
            color: INK.primary,
            fontSize: width * 0.072,
            fontStyle: "italic",
            lineHeight: 1.05
          }}
        >
          {scene.title}
        </div>
      ) : null}

      {/* Centre dotted spine behind the cards, growing as they land. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: spineTop,
          width: 0,
          height: Math.max(0, total * spineProgress),
          transform: "translateX(-50%)",
          borderLeft: `3px dashed ${INK.muted}`,
          opacity: 0.45
        }}
      />

      {items.map((item, i) => {
        const enter = presences[i];
        const enterClamped = Math.min(1, enter);
        const w = widthForIndex(i);
        const ty = stackCenterY + centers[i] + (1 - enterClamped) * height * 0.045;
        const scale = lerp(0.85, 1, enterClamped);

        const highlighted = Boolean(item.color);
        const bg = highlighted ? sem(item.color) : CARD.light;
        const textColor = highlighted ? INK.onDark : INK.primary;
        const numColor = highlighted ? INK.onDark : SEMANTIC.mint;
        const dividerColor = highlighted ? "rgba(250,250,247,0.4)" : INK.muted;
        const badgeBg = highlighted ? "rgba(255,255,255,0.22)" : "rgba(26,26,24,0.07)";
        const badgeSize = cardH * 0.46;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: "50%",
              top: ty,
              transform: `translate(-50%, -50%) scale(${scale})`,
              opacity: Math.min(1, enter * 1.5),
              filter: blurFor(presences[i], presencesPrev[i]),
              zIndex: 2 + i
            }}
          >
            <Card
              elevation="high"
              radius={cardH * 0.32}
              style={{
                width: w,
                height: cardH,
                background: bg,
                display: "flex",
                alignItems: "center",
                paddingLeft: cardH * 0.26,
                paddingRight: cardH * 0.3,
                boxSizing: "border-box"
              }}
            >
              <div
                style={{
                  fontFamily: FONTS.serif,
                  fontWeight: 900,
                  color: numColor,
                  fontSize: cardH * 0.4,
                  lineHeight: 1,
                  marginRight: cardH * 0.18,
                  flexShrink: 0
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </div>
              <div
                style={{
                  width: badgeSize,
                  height: badgeSize,
                  borderRadius: "50%",
                  background: badgeBg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: cardH * 0.16,
                  flexShrink: 0
                }}
              >
                {item.icon ? (
                  <Img src={resolveSrc(item.icon)} style={{ width: badgeSize * 0.58, height: badgeSize * 0.58, objectFit: "contain" }} />
                ) : (
                  <div style={{ width: badgeSize * 0.32, height: badgeSize * 0.32, borderRadius: "50%", background: highlighted ? INK.onDark : SEMANTIC.mint }} />
                )}
              </div>
              <div style={{ width: 2, height: cardH * 0.5, background: dividerColor, opacity: highlighted ? 1 : 0.45, marginRight: cardH * 0.16, flexShrink: 0 }} />
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontFamily: FONTS.sans,
                  fontWeight: 800,
                  color: textColor,
                  fontSize: cardH * 0.26,
                  lineHeight: 1.08,
                  overflowWrap: "break-word",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden"
                }}
              >
                {item.text}
              </div>
            </Card>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

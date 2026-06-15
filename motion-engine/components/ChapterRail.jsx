import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { FONTS, INK, SEMANTIC } from "../theme.js";

// Persistent chapter rail across the top: numbered dots on a line with short
// titles, the current chapter highlighted. A table of contents the viewer
// rides — they always know where they are and what's left.
export function ChapterRail({ chapters, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!chapters?.length) return null;
  const now = frame / fps;
  const enter = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1)
  });
  const activeIndex = chapters.reduce((current, chapter, index) => (now >= chapter.at ? index : current), 0);
  const left = width * 0.07;
  const right = width * 0.07;
  const railWidth = width - left - right;
  const y = height * 0.045;
  const dot = Math.round(height * 0.009);
  const fontSize = Math.round(height * 0.0125);

  return (
    <div style={{ position: "absolute", left, top: y, width: railWidth, zIndex: 40, opacity: enter, transform: `translateY(${(1 - enter) * -12}px)` }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: dot, height: 2, background: "rgba(26,26,24,0.18)" }} />
      {chapters.map((chapter, index) => {
        const x = chapters.length === 1 ? 0 : (index / (chapters.length - 1)) * railWidth;
        const isActive = index === activeIndex;
        const isPast = index < activeIndex;
        const activeFrame = frame - chapter.at * fps;
        const activeScale = isActive
          ? interpolate(activeFrame, [0, 8, 20], [0.96, 1.14, 1.08], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1)
            })
          : 1;
        return (
          <div key={index} style={{ position: "absolute", left: x, top: 0, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div
              style={{
                width: dot * 2,
                height: dot * 2,
                borderRadius: 999,
                background: isActive ? SEMANTIC.mint : isPast ? INK.primary : "#FFFFFF",
                border: `2px solid ${isActive ? SEMANTIC.mint : INK.primary}`,
                transform: `scale(${activeScale})`,
                boxShadow: isActive ? "0 2px 10px rgba(79,174,133,0.5)" : "0 1px 4px rgba(26,26,24,0.2)"
              }}
            />
            <div
              style={{
                fontFamily: FONTS.sans,
                fontWeight: isActive ? 800 : 600,
                fontSize,
                whiteSpace: "nowrap",
                color: isActive ? INK.primary : INK.muted,
                letterSpacing: "0.04em"
              }}
            >
              {chapter.title}
            </div>
          </div>
        );
      })}
    </div>
  );
}

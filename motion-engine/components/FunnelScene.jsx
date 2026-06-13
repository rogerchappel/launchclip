import React from "react";
import { AbsoluteFill, Img, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Card } from "./paper.jsx";
import { FONTS, INK, SEMANTIC, CARD, SPRINGS } from "../theme.js";
import { stackLayout } from "../reflow.js";
// CARD is used for the funnel card light background.

// A sales funnel: numbered step cards that taper inward as they descend,
// forming a funnel silhouette, threaded by a center dotted spine and landing
// one per beat with reflow. One step may be a success color; an optional
// branch card loops off to the side via a curved dotted line.
export function FunnelScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const resolveSrc = (s) => (/^https?:\/\//.test(s) ? s : staticFile(s));
  const sem = (name) => SEMANTIC[name] ?? name;
  const lerp = (a, b, t) => a + (b - a) * t;

  const items = Array.isArray(scene.items) ? scene.items : [];
  const n = items.length;

  // Geometry. The funnel walls taper from a wide top card to a narrow bottom.
  // The taper stays mild and the bottom card stays wide enough that 2-3 word
  // labels still fit (they wrap to a second line rather than truncating).
  const maxW = width * 0.84;
  const minW = width * 0.72;
  const cardH = Math.round(height * 0.092);
  const gap = Math.round(height * 0.018);
  const taperCut = 16; // px the right wall angles inward, top→bottom of a card.

  const widthForIndex = (i) => (n <= 1 ? maxW : lerp(maxW, minW, i / (n - 1)));

  // One presence spring per item, every frame, so the layout never jumps.
  const presenceAt = (atSeconds, f) => {
    const local = f - (atSeconds - scene.start) * fps;
    if (local < 0) return 0;
    return spring({ frame: local, fps, config: SPRINGS.enter });
  };

  const presences = items.map((it) => presenceAt(it.at, frame));
  const presencesPrev = items.map((it) => presenceAt(it.at, frame - 1));

  // Stage the whole stack once via reflow. Each slot is a card + its gap.
  const sizes = items.map(() => cardH + gap);
  const { centers, total } = stackLayout({ sizes, presences, gap: 0 });

  // The spine grows as items land: how far down the lowest visible card sits.
  const landedCount = presences.reduce((acc, p) => acc + Math.min(1, p * 1.5), 0);
  const spineProgress = n > 0 ? Math.min(1, landedCount / n) : 0;
  const spineHeight = total * spineProgress;
  const spineTop = -total / 2;

  const branch = scene.branch;
  const branchPresence = branch ? presenceAt(branch.at, frame) : 0;
  const branchPrev = branch ? presenceAt(branch.at, frame - 1) : 0;

  // Title sits above the funnel; it is the first thing to land.
  const titlePresence = scene.title ? presenceAt(scene.start, frame) : 0;
  const titlePrev = scene.title ? presenceAt(scene.start, frame - 1) : 0;

  const blurFor = (now, prev) => {
    const b = Math.min(5, Math.max(0, now - prev) * 30);
    return b > 0.4 ? `blur(${b.toFixed(1)}px)` : undefined;
  };

  // Vertical anchor for the whole stack (centered, nudged down for the title).
  const stackCenterY = height * (scene.title ? 0.54 : 0.5);

  return (
    <AbsoluteFill>
      {/* Title kicker, scripted italic, above the funnel. */}
      {scene.title ? (
        (() => {
          const enter = titlePresence;
          const ty = (1 - Math.min(1, enter)) * height * 0.05;
          const scale = lerp(0.85, 1, Math.min(1, enter));
          return (
            <div
              style={{
                position: "absolute",
                top: height * 0.14,
                left: 0,
                width: "100%",
                textAlign: "center",
                opacity: Math.min(1, enter * 1.5),
                transform: `translateY(${ty}px) rotate(-2deg) scale(${scale})`,
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
          );
        })()
      ) : null}

      {/* Center dotted spine, behind the cards, growing downward. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: stackCenterY + spineTop,
          width: 0,
          height: Math.max(0, spineHeight),
          transform: "translateX(-50%)",
          borderLeft: `3px dashed ${INK.muted}`,
          opacity: 0.5
        }}
      />

      {/* Step cards. */}
      {items.map((item, i) => {
        const enter = presences[i];
        const enterClamped = Math.min(1, enter);
        const w = widthForIndex(i);
        const ty = stackCenterY + centers[i] + (1 - enterClamped) * height * 0.05;
        const scale = lerp(0.85, 1, enterClamped);
        const filter = blurFor(presences[i], presencesPrev[i]);

        const highlighted = Boolean(item.color);
        const bg = highlighted ? sem(item.color) : CARD.light;
        const textColor = highlighted ? INK.onDark : INK.primary;
        const numColor = highlighted ? INK.onDark : SEMANTIC.mint;
        const dividerColor = highlighted ? "rgba(250,250,247,0.35)" : INK.muted;
        const badgeBg = highlighted ? "rgba(255,255,255,0.22)" : "rgba(26,26,24,0.07)";

        const stepNum = String(i + 1).padStart(2, "0");
        const badgeSize = cardH * 0.46;

        // Trapezoid: the right wall cuts inward top→bottom so cards read as
        // funnel walls. Left edge stays vertical.
        const cutFrac = (taperCut / w) * 100;
        const clipPath = `polygon(0 0, 100% 0, ${(100 - cutFrac).toFixed(2)}% 100%, 0 100%)`;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: "50%",
              top: ty,
              transform: `translate(-50%, -50%) scale(${scale})`,
              opacity: Math.min(1, enter * 1.5),
              filter,
              zIndex: 2 + i
            }}
          >
            <Card
              elevation="high"
              style={{
                width: w,
                height: cardH,
                background: bg,
                clipPath,
                display: "flex",
                alignItems: "center",
                paddingLeft: cardH * 0.24,
                paddingRight: cardH * 0.24 + taperCut,
                boxSizing: "border-box"
              }}
            >
              {/* Step number */}
              <div
                style={{
                  fontFamily: FONTS.serif,
                  fontWeight: 900,
                  color: numColor,
                  fontSize: cardH * 0.4,
                  lineHeight: 1,
                  marginRight: cardH * 0.2,
                  flexShrink: 0
                }}
              >
                {stepNum}
              </div>

              {/* Circular badge with icon (or a filled dot) */}
              <div
                style={{
                  position: "relative",
                  width: badgeSize,
                  height: badgeSize,
                  borderRadius: "50%",
                  background: badgeBg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: cardH * 0.18,
                  flexShrink: 0
                }}
              >
                {item.icon ? (
                  <Img
                    src={resolveSrc(item.icon)}
                    style={{ width: badgeSize * 0.58, height: badgeSize * 0.58, objectFit: "contain" }}
                  />
                ) : (
                  <div
                    style={{
                      width: badgeSize * 0.32,
                      height: badgeSize * 0.32,
                      borderRadius: "50%",
                      background: highlighted ? INK.onDark : SEMANTIC.mint
                    }}
                  />
                )}
                {item.badge != null ? (
                  <div
                    style={{
                      position: "absolute",
                      top: -badgeSize * 0.12,
                      right: -badgeSize * 0.12,
                      minWidth: badgeSize * 0.42,
                      height: badgeSize * 0.42,
                      padding: "0 4px",
                      borderRadius: badgeSize * 0.42,
                      background: highlighted ? INK.onDark : SEMANTIC.coral,
                      color: highlighted ? sem(item.color) : INK.onDark,
                      fontFamily: FONTS.sans,
                      fontWeight: 800,
                      fontSize: badgeSize * 0.28,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxSizing: "border-box"
                    }}
                  >
                    {item.badge}
                  </div>
                ) : null}
              </div>

              {/* Divider */}
              <div
                style={{
                  width: 2,
                  height: cardH * 0.5,
                  background: dividerColor,
                  opacity: highlighted ? 1 : 0.45,
                  marginRight: cardH * 0.18,
                  flexShrink: 0
                }}
              />

              {/* Label — flexes to fill the remaining width and wraps to a
                  second line instead of truncating (the taper narrows lower
                  cards, so nowrap+ellipsis would eat short labels). */}
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontFamily: FONTS.sans,
                  fontWeight: 800,
                  color: textColor,
                  fontSize: cardH * 0.25,
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

      {/* Optional branch: a smaller coral card off to the right of its source
          row, connected from the spine by a curved dotted line that draws in. */}
      {branch && branch.fromIndex >= 0 && branch.fromIndex < n
        ? (() => {
            const enter = branchPresence;
            const enterClamped = Math.min(1, enter);
            const rowY = stackCenterY + (centers[branch.fromIndex] ?? 0);
            const branchW = width * 0.34;
            const branchH = cardH * 0.78;

            // The curved dotted connector lives in its own SVG layer, anchored
            // from the spine (center) out to the branch card on the right.
            const svgW = width;
            const svgH = height;
            const startX = width * 0.5;
            const startY = rowY;
            const endX = width * 0.78;
            const endY = rowY - cardH * 0.1;
            const pathD = `M ${startX} ${startY} C ${startX + width * 0.18} ${startY + height * 0.03}, ${endX - width * 0.02} ${endY + height * 0.04}, ${endX} ${endY}`;
            const dashTotal = 600;
            const dashOffset = dashTotal * (1 - enterClamped);

            const ty = (1 - enterClamped) * height * 0.04;
            const scale = lerp(0.85, 1, enterClamped);

            return (
              <>
                <svg
                  width={svgW}
                  height={svgH}
                  viewBox={`0 0 ${svgW} ${svgH}`}
                  style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 1 }}
                >
                  <path
                    d={pathD}
                    fill="none"
                    stroke={INK.muted}
                    strokeWidth={3}
                    strokeDasharray="2 12"
                    strokeLinecap="round"
                    style={{
                      strokeDasharray: "8 10",
                      strokeDashoffset: dashOffset,
                      opacity: 0.65
                    }}
                  />
                </svg>
                <div
                  style={{
                    position: "absolute",
                    left: width * 0.79,
                    top: rowY,
                    transform: `translateY(-50%) translateY(${ty}px) scale(${scale})`,
                    opacity: Math.min(1, enter * 1.5),
                    filter: blurFor(branchPresence, branchPrev),
                    zIndex: 3 + n
                  }}
                >
                  <Card
                    elevation="high"
                    style={{
                      width: branchW,
                      height: branchH,
                      background: sem(branch.color || "coral"),
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: `0 ${branchH * 0.3}px`,
                      boxSizing: "border-box"
                    }}
                  >
                    <div
                      style={{
                        fontFamily: FONTS.sans,
                        fontWeight: 800,
                        color: INK.onDark,
                        fontSize: branchH * 0.3,
                        lineHeight: 1.1,
                        textAlign: "center"
                      }}
                    >
                      {branch.text}
                    </div>
                  </Card>
                </div>
              </>
            );
          })()
        : null}
    </AbsoluteFill>
  );
}

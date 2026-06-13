import React from "react";
import { AbsoluteFill, Img, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Card } from "./paper.jsx";
import { FONTS, INK, SEMANTIC, SPRINGS } from "../theme.js";
import { stackLayout } from "../reflow.js";

// Person/profile cards in the paper world. Two modes:
//   "cascade" — 2-4 white cards staggered diagonally, each a horizontal pill
//               (avatar + name + role), landing one per beat with reflow.
//   "grid"    — compact cards in a 4-col grid that pop in, with an optional
//               wide summary card at the bottom whose number counts up.

const resolveSrc = (s) => (/^https?:\/\//.test(s) ? s : staticFile(s));

// First letters of the first two words of a name → "Maya Chen" → "MC".
function initialsOf(name) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const a = parts[0][0] ?? "";
  const b = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (a + b).toUpperCase();
}

const AVATAR_BG = [SEMANTIC.mint, SEMANTIC.coral, SEMANTIC.purple, "#2563EB"];

// Avatar: Img if a src is given, else a colored initials circle.
function Avatar({ avatar, name, size, index }) {
  const ring = AVATAR_BG[index % AVATAR_BG.length];
  const common = {
    width: size,
    height: size,
    borderRadius: "50%",
    flexShrink: 0,
    objectFit: "cover",
    overflow: "hidden"
  };
  if (avatar) {
    return <Img src={resolveSrc(avatar)} style={common} />;
  }
  return (
    <div
      style={{
        ...common,
        background: ring,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#FFFFFF",
        fontFamily: FONTS.sans,
        fontWeight: 800,
        fontSize: size * 0.4,
        letterSpacing: "0.02em"
      }}
    >
      {initialsOf(name)}
    </div>
  );
}

// Small rounded mint pill (e.g. "Hiring").
function Pill({ label, fontSize }) {
  return (
    <div
      style={{
        background: SEMANTIC.mint,
        color: "#FFFFFF",
        fontFamily: FONTS.sans,
        fontWeight: 800,
        fontSize,
        padding: `${fontSize * 0.4}px ${fontSize * 0.85}px`,
        borderRadius: 999,
        lineHeight: 1,
        whiteSpace: "nowrap"
      }}
    >
      {label}
    </div>
  );
}

// Count-up: parse the leading number out of "$6,000" and re-insert the eased
// value with grouping, preserving any non-digit prefix/suffix.
function countUpValue(raw, progress) {
  if (raw == null) return "";
  const str = String(raw);
  const match = str.match(/[\d.,]*\d/);
  if (!match) return str;
  const numStr = match[0];
  const target = parseFloat(numStr.replace(/,/g, ""));
  if (!isFinite(target)) return str;
  const decimals = numStr.includes(".") ? (numStr.split(".")[1] || "").length : 0;
  const eased = Math.max(0, Math.min(1, progress));
  const current = target * eased;
  const formatted = current.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  const start = match.index ?? 0;
  return str.slice(0, start) + formatted + str.slice(start + numStr.length);
}

export function ProfileCards({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const mode = scene.mode === "grid" ? "grid" : "cascade";
  const items = Array.isArray(scene.items) ? scene.items : [];

  // Per-item entrance presence (resolved every frame for ALL items).
  const localFrameOf = (at) => frame - (at - scene.start) * fps;
  const presenceOf = (at) => {
    const lf = localFrameOf(at);
    return lf < 0 ? 0 : spring({ frame: lf, fps, config: SPRINGS.enter });
  };
  // Previous-frame presence for motion blur while the card is moving.
  const presencePrevOf = (at) => {
    const lf = localFrameOf(at) - 1;
    return lf < 0 ? 0 : spring({ frame: lf, fps, config: SPRINGS.enter });
  };

  if (mode === "cascade") {
    return (
      <CascadeMode
        items={items}
        width={width}
        height={height}
        presenceOf={presenceOf}
        presencePrevOf={presencePrevOf}
      />
    );
  }
  return (
    <GridMode
      scene={scene}
      items={items}
      width={width}
      height={height}
      frame={frame}
      fps={fps}
      presenceOf={presenceOf}
      presencePrevOf={presencePrevOf}
    />
  );
}

// ── cascade ────────────────────────────────────────────────────────────────
function CascadeMode({ items, width, height, presenceOf, presencePrevOf }) {
  const count = Math.max(1, items.length);
  const cardWidth = width * 0.72;
  const cardHeight = Math.min(height * 0.18, 200);
  const gap = cardHeight * 0.22;
  const diagonalStep = width * 0.06; // each card nudges right of the previous

  const presences = items.map((it) => presenceOf(it.at));
  const { centers } = stackLayout({
    sizes: items.map(() => cardHeight),
    presences,
    gap
  });

  // Center the diagonal run horizontally: span grows with how many cards exist.
  const diagSpan = (count - 1) * diagonalStep;
  const baseLeft = width / 2 - cardWidth / 2 - diagSpan / 2;

  const avatarSize = cardHeight * 0.56;
  const nameSize = Math.min(cardWidth * 0.062, 40);
  const roleSize = nameSize * 0.7;
  const pillSize = nameSize * 0.5;

  return (
    <AbsoluteFill>
      {items.map((item, i) => {
        const enter = presences[i];
        const enterPrev = presencePrevOf(item.at);
        const opacity = Math.min(1, enter * 1.5);
        const scale = 0.85 + 0.15 * Math.min(1, enter);
        const slideY = (1 - Math.min(1, enter)) * cardHeight * 0.5;
        const blur = Math.min(5, Math.max(0, enter - enterPrev) * 30);

        const x = baseLeft + i * diagonalStep;
        const y = height / 2 + centers[i];

        const roleColor = SEMANTIC.purple;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y - cardHeight / 2,
              width: cardWidth,
              height: cardHeight,
              opacity,
              filter: blur > 0.1 ? `blur(${blur}px)` : undefined,
              transform: `translateY(${slideY}px) scale(${scale})`,
              transformOrigin: "center"
            }}
          >
            <Card elevation="high" style={{ width: "100%", height: "100%" }}>
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: cardHeight * 0.16,
                  padding: `0 ${cardWidth * 0.06}px`,
                  boxSizing: "border-box"
                }}
              >
                <Avatar avatar={item.avatar} name={item.name} size={avatarSize} index={i} />
                <div style={{ display: "flex", flexDirection: "column", gap: nameSize * 0.18, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: FONTS.sans,
                      fontWeight: 800,
                      fontSize: nameSize,
                      color: INK.primary,
                      lineHeight: 1.05,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis"
                    }}
                  >
                    {item.name}
                  </div>
                  {item.role != null && (
                    <div
                      style={{
                        fontFamily: FONTS.sans,
                        fontWeight: 600,
                        fontSize: roleSize,
                        color: INK.muted,
                        lineHeight: 1.1,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis"
                      }}
                    >
                      <span style={{ color: roleColor, fontWeight: 800 }}>{item.role}</span>
                    </div>
                  )}
                </div>
                {item.pill != null && (
                  <div style={{ position: "absolute", top: cardHeight * 0.12, right: cardWidth * 0.05 }}>
                    <Pill label={item.pill} fontSize={pillSize} />
                  </div>
                )}
              </div>
            </Card>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

// ── grid ─────────────────────────────────────────────────────────────────
function GridMode({ scene, items, width, height, frame, fps, presenceOf, presencePrevOf }) {
  const cols = 4;
  const count = items.length;
  const rows = Math.max(1, Math.ceil(count / cols));

  const total = scene.total;
  const hasTotal = total && total.value != null;

  // Reserve bottom band for the summary card when present.
  const topPad = height * 0.06;
  const sidePad = width * 0.05;
  const summaryBand = hasTotal ? height * 0.22 : 0;
  const gridAreaW = width - sidePad * 2;
  const gridAreaH = height - topPad * 2 - summaryBand;

  const colGap = gridAreaW * 0.04;
  const rowGap = colGap;
  const cellW = (gridAreaW - colGap * (cols - 1)) / cols;
  const cellH = Math.min((gridAreaH - rowGap * (rows - 1)) / rows, cellW * 1.35);

  // If items lack distinct `at` beats (or there are many), rapid auto-stagger.
  const autoStaggerSec = 0.06;

  const avatarSize = cellW * 0.42;
  const nameSize = Math.min(cellW * 0.16, 26);
  const valueSize = Math.min(cellW * 0.2, 34);

  // Grid block is vertically centered in its area.
  const gridBlockH = rows * cellH + (rows - 1) * rowGap;
  const gridTop = topPad + Math.max(0, (gridAreaH - gridBlockH) / 2);

  return (
    <AbsoluteFill>
      {items.map((item, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        // Auto-stagger fallback if items share/omit `at`.
        const at = (item.at != null ? item.at : scene.start) + i * autoStaggerSec;
        const effAt = item.at != null ? item.at : at;
        const enter = presenceOf(effAt);
        const enterPrev = presencePrevOf(effAt);
        const opacity = Math.min(1, enter * 1.5);
        const scale = 0.6 + 0.4 * Math.min(1, enter); // pop in 0.6 → 1
        const blur = Math.min(5, Math.max(0, enter - enterPrev) * 30);

        const x = sidePad + col * (cellW + colGap);
        const y = gridTop + row * (cellH + rowGap);

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: cellW,
              height: cellH,
              opacity,
              filter: blur > 0.1 ? `blur(${blur}px)` : undefined,
              transform: `scale(${scale})`,
              transformOrigin: "center"
            }}
          >
            <Card elevation="low" style={{ width: "100%", height: "100%" }}>
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: cellH * 0.07,
                  padding: cellW * 0.08,
                  boxSizing: "border-box"
                }}
              >
                <Avatar avatar={item.avatar} name={item.name} size={avatarSize} index={i} />
                <div
                  style={{
                    fontFamily: FONTS.sans,
                    fontWeight: 800,
                    fontSize: nameSize,
                    color: INK.primary,
                    lineHeight: 1.05,
                    textAlign: "center",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: "100%"
                  }}
                >
                  {item.name}
                </div>
                {item.value != null && (
                  <div
                    style={{
                      fontFamily: FONTS.sans,
                      fontWeight: 800,
                      fontSize: valueSize,
                      color: INK.primary,
                      lineHeight: 1.05,
                      textAlign: "center"
                    }}
                  >
                    {item.value}
                  </div>
                )}
              </div>
            </Card>
          </div>
        );
      })}

      {hasTotal && (
        <SummaryCard
          total={total}
          scene={scene}
          width={width}
          height={height}
          frame={frame}
          fps={fps}
          presenceOf={presenceOf}
          presencePrevOf={presencePrevOf}
          summaryBand={summaryBand}
        />
      )}
    </AbsoluteFill>
  );
}

function SummaryCard({ total, scene, width, height, frame, fps, presenceOf, presencePrevOf, summaryBand }) {
  const enter = presenceOf(total.at != null ? total.at : scene.start);
  const enterPrev = presencePrevOf(total.at != null ? total.at : scene.start);
  const opacity = Math.min(1, enter * 1.5);
  const scale = 0.85 + 0.15 * Math.min(1, enter);
  const slideY = (1 - Math.min(1, enter)) * summaryBand * 0.4;
  const blur = Math.min(5, Math.max(0, enter - enterPrev) * 30);

  // Count-up uses a slow, settling spring against the total's beat.
  const countLf = frame - ((total.at != null ? total.at : scene.start) - scene.start) * fps;
  const countProgress = countLf < 0 ? 0 : spring({ frame: countLf, fps, config: { damping: 30, stiffness: 60, mass: 1.2 } });
  const displayValue = countUpValue(total.value, countProgress);

  const cardW = width * 0.84;
  const cardH = summaryBand * 0.78;
  const labelSize = Math.min(width * 0.04, 30);
  const valueSize = Math.min(width * 0.12, 84);

  return (
    <div
      style={{
        position: "absolute",
        left: width / 2 - cardW / 2,
        bottom: height * 0.05,
        width: cardW,
        height: cardH,
        opacity,
        filter: blur > 0.1 ? `blur(${blur}px)` : undefined,
        transform: `translateY(${slideY}px) scale(${scale})`,
        transformOrigin: "center bottom"
      }}
    >
      <Card elevation="high" style={{ width: "100%", height: "100%" }}>
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: cardH * 0.06,
            padding: cardW * 0.04,
            boxSizing: "border-box"
          }}
        >
          {total.label != null && (
            <div
              style={{
                fontFamily: FONTS.sans,
                fontWeight: 600,
                fontSize: labelSize,
                color: INK.muted,
                textAlign: "center",
                lineHeight: 1.1,
                letterSpacing: "0.01em"
              }}
            >
              {total.label}
            </div>
          )}
          <div
            style={{
              fontFamily: FONTS.sans,
              fontWeight: 800,
              fontSize: valueSize,
              color: INK.primary,
              textAlign: "center",
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums"
            }}
          >
            {displayValue}
          </div>
        </div>
      </Card>
    </div>
  );
}

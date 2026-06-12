import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Card } from "./paper.jsx";
import { CARD, FONTS, INK, SEMANTIC, SPRINGS } from "../theme.js";

// Scene track for the paper-world grammar: scenes butt-joined on the global
// clock; the paper ground persists underneath (rendered by MotionLayer).
// Hard cuts are rare in this grammar — most life comes from builds inside
// each scene, so the shell settle is gentler than a punch.
export function SceneTrack({ scenes, width, height }) {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      {scenes.map((scene, index) => (
        <Sequence
          key={scene.id}
          from={Math.round(scene.start * fps)}
          durationInFrames={Math.max(1, Math.round((scene.end - scene.start) * fps))}
        >
          <SceneShell settle={index > 0}>
            <Scene scene={scene} width={width} height={height} />
          </SceneShell>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

function Scene({ scene, width, height }) {
  if (scene.type === "talking_head" || scene.type === "screen") return <FootageScene scene={scene} width={width} height={height} />;
  if (scene.type === "typography") return <TypographyScene scene={scene} width={width} height={height} />;
  if (scene.type === "prompt_card") return <PromptCardScene scene={scene} width={width} height={height} />;
  if (scene.type === "icon_flow") return <IconFlowScene scene={scene} width={width} height={height} />;
  if (scene.type === "card_steps") return <CardStepsScene scene={scene} width={width} height={height} />;
  if (scene.type === "screenshot_pile") return <ScreenshotPileScene scene={scene} width={width} height={height} />;
  return null;
}

function SceneShell({ settle, children }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = settle ? spring({ frame, fps, config: SPRINGS.settle }) : 1;
  return (
    <AbsoluteFill style={{ transform: `scale(${1.04 - enter * 0.04})`, transformOrigin: "50% 45%" }}>
      {children}
    </AbsoluteFill>
  );
}

// Talking head plays full-bleed (the hook/CTA pattern); screen recordings sit
// in a big card on the paper like every other object.
function FootageScene({ scene, width, height }) {
  const { fps } = useVideoConfig();
  const video = (
    <OffthreadVideo
      muted
      src={resolveSrc(scene.src)}
      trimBefore={Math.round((scene.offset ?? 0) * fps)}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
  if (scene.type === "talking_head") {
    return <AbsoluteFill>{video}</AbsoluteFill>;
  }
  return (
    <AbsoluteFill style={{ display: "grid", placeItems: "center", padding: `${height * 0.1}px ${width * 0.06}px` }}>
      <Card elevation="high" style={{ width: "100%", aspectRatio: "9 / 14", maxHeight: "100%" }}>{video}</Card>
    </AbsoluteFill>
  );
}

const WORD_ROTATIONS = [-3, 2, -2, 3, -1, 2.5];
const WORD_OFFSETS = [0, 0.06, -0.04, 0.08, -0.06, 0.03];

// Spoken phrases staged center-frame: chunky serif statements, script-italic
// emotional words, staggered baselines, key word oversized and colored.
function TypographyScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const base = Math.round(height * 0.045);
  return (
    <AbsoluteFill style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: `0 ${width * 0.1}px` }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "baseline", rowGap: base * 0.1, columnGap: base * 0.45, maxWidth: width * 0.84 }}>
        {scene.items.map((item, index) => {
          const localFrame = frame - (item.at - scene.start) * fps;
          if (localFrame < 0) return null;
          const enter = spring({ frame: localFrame, fps, config: SPRINGS.enter });
          const emphasised = Boolean(item.emphasis);
          const size = emphasised ? base * 1.9 : base;
          return (
            <span
              key={index}
              style={{
                display: "inline-block",
                fontFamily: emphasised ? FONTS.script : FONTS.serif,
                fontStyle: emphasised ? "italic" : "normal",
                fontWeight: 900,
                fontSize: size,
                lineHeight: 1.04,
                color: item.color ? semanticColor(item.color) : INK.primary,
                transform: [
                  `rotate(${WORD_ROTATIONS[index % WORD_ROTATIONS.length]}deg)`,
                  `translateY(${WORD_OFFSETS[index % WORD_OFFSETS.length] * base + (1 - enter) * base * 0.6}px)`,
                  `scale(${0.7 + enter * 0.3})`
                ].join(" "),
                opacity: Math.min(1, enter * 1.5)
              }}
            >
              {item.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

// Dark chat-input card with the real prompt typing on. For AI tools the
// prompt IS the console.
function PromptCardScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const sceneLength = scene.end - scene.start;
  const enter = spring({ frame, fps, config: SPRINGS.enter });
  const typeProgress = clamp((seconds - 0.35) / Math.max(0.6, sceneLength - 1.1));
  const text = scene.text.slice(0, Math.ceil(scene.text.length * typeProgress));
  const fontSize = Math.round(height * 0.026);
  return (
    <AbsoluteFill style={{ display: "grid", placeItems: "center", padding: `0 ${width * 0.07}px` }}>
      <div style={{ width: "100%", transform: `translateY(${(1 - enter) * height * 0.06}px)`, opacity: Math.min(1, enter * 1.4) }}>
        <Card
          dark
          radius={36}
          elevation="high"
          style={{ width: "100%", padding: `${fontSize * 1.3}px ${fontSize * 1.5}px`, boxShadow: `${CARD.shadowHigh}, 0 0 70px rgba(79,174,133,0.35)` }}
        >
          <div style={{ fontFamily: FONTS.sans, fontWeight: 600, fontSize, lineHeight: 1.5, color: SEMANTIC.mint, minHeight: fontSize * 4.5 }}>
            &ldquo;{text}
            <Caret fontSize={fontSize} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: fontSize * 0.9 }}>
            <div style={{ color: INK.onDarkMuted, fontSize: fontSize * 1.4, fontWeight: 300, lineHeight: 1 }}>+</div>
            <Mic size={fontSize} />
          </div>
        </Card>
      </div>
    </AbsoluteFill>
  );
}

function Caret({ fontSize }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const on = Math.floor((frame / fps) * 2.6) % 2 === 0;
  return <span style={{ display: "inline-block", width: 2.5, height: fontSize, marginLeft: 3, verticalAlign: "text-bottom", background: on ? SEMANTIC.mint : "transparent" }} />;
}

function Mic({ size }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <div style={{ width: size * 0.55, height: size * 0.9, borderRadius: 999, border: `2px solid ${INK.onDarkMuted}` }} />
      <div style={{ width: size * 0.9, height: size * 0.35, borderBottom: `2px solid ${INK.onDarkMuted}`, borderLeft: `2px solid ${INK.onDarkMuted}`, borderRight: `2px solid ${INK.onDarkMuted}`, borderRadius: "0 0 999px 999px" }} />
    </div>
  );
}

// Brand icons as characters: black rounded squares with the glyph, connected
// by a dotted line that draws in as each node lands.
function IconFlowScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const iconSize = Math.round(width * 0.24);
  const labelSize = Math.round(height * 0.034);
  return (
    <AbsoluteFill style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 0 }}>
      {scene.items.map((item, index) => {
        const localFrame = frame - (item.at - scene.start) * fps;
        if (localFrame < 0) return null;
        const enter = spring({ frame: localFrame, fps, config: SPRINGS.enter });
        return (
          <React.Fragment key={index}>
            {index > 0 ? (
              <div
                style={{
                  width: 0,
                  height: height * 0.045,
                  borderLeft: `3.5px dashed ${INK.primary}`,
                  opacity: Math.min(1, enter * 1.4),
                  transform: `scaleY(${enter})`,
                  transformOrigin: "top"
                }}
              />
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: labelSize * 0.4, transform: `scale(${0.6 + enter * 0.4})`, opacity: Math.min(1, enter * 1.5) }}>
              {item.src ? (
                <Card dark radius={iconSize * 0.24} elevation="mid" style={{ width: iconSize, height: iconSize, display: "grid", placeItems: "center", padding: iconSize * 0.2 }}>
                  <Img src={resolveSrc(item.src)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                </Card>
              ) : null}
              <div style={{ fontFamily: FONTS.serif, fontWeight: 900, fontSize: labelSize, color: item.color ? semanticColor(item.color) : INK.primary, transform: `rotate(${WORD_ROTATIONS[index % WORD_ROTATIONS.length] * 0.6}deg)` }}>
                {item.text}
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
}

// Small white cards with mint indices stacking into a list/funnel.
function CardStepsScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fontSize = Math.round(height * 0.028);
  return (
    <AbsoluteFill style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: height * 0.022, padding: `0 ${width * 0.1}px` }}>
      {scene.title ? (
        <div style={{ fontFamily: FONTS.script, fontStyle: "italic", fontWeight: 900, fontSize: fontSize * 1.5, color: INK.primary, marginBottom: height * 0.012, transform: "rotate(-2deg)" }}>
          {scene.title}
        </div>
      ) : null}
      {scene.items.map((item, index) => {
        const localFrame = frame - (item.at - scene.start) * fps;
        if (localFrame < 0) return null;
        const enter = spring({ frame: localFrame, fps, config: SPRINGS.enter });
        const tilt = WORD_ROTATIONS[index % WORD_ROTATIONS.length] * 0.4;
        return (
          <div key={index} style={{ width: "100%", transform: `translateY(${(1 - enter) * height * 0.05}px) rotate(${tilt}deg)`, opacity: Math.min(1, enter * 1.5) }}>
            <Card elevation="low" radius={20} style={{ display: "flex", alignItems: "center", gap: fontSize, padding: `${fontSize * 0.75}px ${fontSize * 1.1}px` }}>
              <div style={{ fontFamily: FONTS.serif, fontWeight: 900, fontSize: fontSize * 1.5, color: SEMANTIC.mint, minWidth: fontSize * 1.4, lineHeight: 1 }}>
                {index + 1}
              </div>
              <div style={{ fontFamily: FONTS.sans, fontWeight: 800, fontSize, lineHeight: 1.2, color: INK.primary }}>{item.text}</div>
            </Card>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

const PILE_SLOTS = [
  { x: 0, y: 0, rot: 0, scale: 1 },
  { x: -0.18, y: -0.08, rot: -7, scale: 0.82 },
  { x: 0.19, y: 0.07, rot: 6, scale: 0.86 },
  { x: 0.14, y: -0.16, rot: 4, scale: 0.74 },
  { x: -0.16, y: 0.15, rot: -5, scale: 0.78 },
  { x: 0.02, y: 0.2, rot: 2, scale: 0.7 }
];

// One real screenshot lands, then copies fan out behind and around it.
function ScreenshotPileScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cardWidth = width * 0.62;
  return (
    <AbsoluteFill style={{ display: "grid", placeItems: "center" }}>
      <div style={{ position: "relative", width: cardWidth, height: cardWidth * 1.4 }}>
        {scene.items.map((item, index) => {
          const slot = PILE_SLOTS[index % PILE_SLOTS.length];
          const localFrame = frame - (item.at - scene.start) * fps;
          if (localFrame < 0) return null;
          const enter = spring({ frame: localFrame, fps, config: SPRINGS.enter });
          return (
            <div
              key={index}
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 100 - index,
                transform: [
                  `translate(${slot.x * cardWidth * enter}px, ${slot.y * cardWidth * enter + (1 - enter) * height * 0.06}px)`,
                  `rotate(${slot.rot * enter}deg)`,
                  `scale(${slot.scale * (0.8 + enter * 0.2)})`
                ].join(" "),
                opacity: Math.min(1, enter * 1.5)
              }}
            >
              <Card elevation={index === 0 ? "high" : "mid"} radius={18} style={{ width: "100%", height: "100%" }}>
                <Img src={resolveSrc(item.src)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
              </Card>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function semanticColor(name) {
  return SEMANTIC[name] ?? name;
}

function resolveSrc(src) {
  if (/^https?:\/\//.test(src)) return src;
  return staticFile(src);
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

import React from "react";
import { AbsoluteFill, Easing, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Card, GlowBorder } from "./paper.jsx";
import { CARD, FONTS, INK, SEMANTIC, SPRINGS, TYPE_SHADOW } from "../theme.js";
import { focalDrift, stackLayout } from "../reflow.js";
import { FunnelScene } from "./FunnelScene.jsx";
import { ProfileCards } from "./ProfileCards.jsx";
import { MagnifierScene } from "./Magnifier.jsx";

// Scene track (ART_DIRECTION 4e): scene changes are hard cuts — the next
// composition is on screen immediately and its builds start at once. The
// motion lives INSIDE scenes (entrances, reflow, drift), not between them;
// travel transitions and the per-beat whoosh are retired. A gentle settle
// keeps the cut physical.
// Cross-hold (ART_DIRECTION 4g): a hard cut to an empty scene leaves a blank
// frame while the new scene's first build springs in. Instead each scene
// LINGERS a few frames into the next: the outgoing composition holds
// underneath (z-index below) while the incoming builds on top, so the frame
// is never blank and the previous content "just leaves" once the new one has
// arrived — no whoosh, no zoom, no fade.
// Cross-hold (ART_DIRECTION 4g): a hard cut to an empty scene leaves a blank
// frame while the new scene's first build springs in. Instead each scene
// LINGERS a few frames into the next (z-index below it) so the outgoing
// composition holds while the incoming builds on top — never blank, and the
// old content just leaves once the new has arrived. No whoosh/zoom/fade.
const CROSS_HOLD_SECONDS = 0.2;

export function SceneTrack({ scenes, width, height }) {
  const { fps } = useVideoConfig();
  const hold = Math.round(CROSS_HOLD_SECONDS * fps);
  return (
    <AbsoluteFill>
      {scenes.map((scene, index) => {
        const contentFrames = Math.max(1, Math.round((scene.end - scene.start) * fps));
        const hasNext = index < scenes.length - 1;
        return (
          <Sequence
            key={scene.id}
            from={Math.round(scene.start * fps)}
            durationInFrames={contentFrames + (hasNext ? hold : 0)}
          >
            <AbsoluteFill style={{ zIndex: index }}>
              <SettleShell settle={index > 0}>
                <Scene scene={scene} width={width} height={height} />
              </SettleShell>
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

function SettleShell({ settle, children }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const settleP = settle ? spring({ frame, fps, config: SPRINGS.settle }) : 1;
  return (
    <AbsoluteFill style={{ transform: `scale(${settle ? 1.04 - settleP * 0.04 : 1})`, transformOrigin: "50% 45%" }}>
      {children}
    </AbsoluteFill>
  );
}

function Scene({ scene, width, height }) {
  if (scene.type === "talking_head") return <TalkingHeadScene scene={scene} width={width} height={height} />;
  if (scene.type === "screen") return <ScreenScene scene={scene} width={width} height={height} />;
  if (scene.type === "typography") return <TypographyScene scene={scene} width={width} height={height} />;
  if (scene.type === "prompt_card") return <PromptCardScene scene={scene} width={width} height={height} />;
  if (scene.type === "icon_flow") return <IconFlowScene scene={scene} width={width} height={height} />;
  if (scene.type === "card_steps") return <CardStepsScene scene={scene} width={width} height={height} />;
  if (scene.type === "screenshot_pile") return <ScreenshotPileScene scene={scene} width={width} height={height} />;
  if (scene.type === "stat_counter") return <StatCounterScene scene={scene} width={width} height={height} />;
  if (scene.type === "quote_card") return <QuoteCardScene scene={scene} width={width} height={height} />;
  if (scene.type === "funnel") return <FunnelScene scene={scene} width={width} height={height} />;
  if (scene.type === "profile_cards") return <ProfileCards scene={scene} width={width} height={height} />;
  if (scene.type === "magnifier") return <MagnifierScene scene={scene} width={width} height={height} />;
  if (scene.type === "artifact_grid") return <ArtifactGridScene scene={scene} width={width} height={height} />;
  if (scene.type === "terminal_receipt") return <TerminalReceiptScene scene={scene} width={width} height={height} />;
  return null;
}

// The graphics are the protagonist; the face is the narrator. Default layout
// puts the face in the bottom half with the paper (and word builds) above.
function TalkingHeadScene({ scene, width, height }) {
  const { fps } = useVideoConfig();
  const video = (
    <OffthreadVideo
      muted
      src={resolveSrc(scene.src)}
      trimBefore={Math.round((scene.offset ?? 0) * fps)}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
  if (scene.layout === "full") {
    return <AbsoluteFill>{video}</AbsoluteFill>;
  }
  if (scene.layout === "overlay") {
    // Words land directly on the footage (the OpenClaw pattern) — white serif
    // with mint emphasis; a soft scrim keeps them legible.
    return (
      <AbsoluteFill>
        {video}
        <AbsoluteFill style={{ background: "radial-gradient(100% 60% at 50% 38%, rgba(10,10,8,0.34) 0%, rgba(10,10,8,0) 70%)" }} />
        <WordBuild scene={scene} width={width} height={height} region={{ top: 0.18, height: 0.45 }} onDark />
      </AbsoluteFill>
    );
  }
  if (scene.layout === "card") {
    return (
      <AbsoluteFill>
        <div style={{ position: "absolute", left: width * 0.07, bottom: height * 0.12, width: width * 0.52, height: width * 0.66 }}>
          <Card elevation="high" radius={26} tilt={-1.5} style={{ width: "100%", height: "100%" }}>{video}</Card>
        </div>
        <WordBuild scene={scene} width={width} height={height} region={{ top: 0.1, height: 0.42 }} />
      </AbsoluteFill>
    );
  }
  // split: face bottom ~52%, graphics unfold on the paper above.
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: height * 0.52, overflow: "hidden" }}>{video}</div>
      <WordBuild scene={scene} width={width} height={height} region={{ top: 0.05, height: 0.38 }} />
    </AbsoluteFill>
  );
}

function ScreenScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drift = focalDrift({ frame, fps, seconds: scene.end - scene.start, zoom: 0.045 });
  return (
    <AbsoluteFill style={{ display: "grid", placeItems: "center", padding: `${height * 0.1}px ${width * 0.06}px` }}>
      <div style={{ width: "100%", maxHeight: "100%", transform: `translateX(${drift.panX * width}px) scale(${drift.scale})` }}>
        <Card elevation="high" style={{ width: "100%", aspectRatio: "9 / 14", maxHeight: "100%" }}>
          <OffthreadVideo
            muted
            src={resolveSrc(scene.src)}
            trimBefore={Math.round((scene.offset ?? 0) * fps)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </Card>
      </div>
    </AbsoluteFill>
  );
}

const WORD_ROTATIONS = [-3, 2, -2, 3, -1, 2.5];
const WORD_OFFSETS = [0, 0.06, -0.04, 0.08, -0.06, 0.03];

// Shared word-cadenced type build; TypographyScene centers it full-frame,
// talking-head layouts stage it in the region above the face.
function WordBuild({ scene, width, height, region, onDark = false }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!scene.items?.length) return null;
  const base = Math.round(height * (region ? 0.036 : 0.045));
  return (
    <div
      style={{
        position: "absolute",
        left: width * 0.08,
        right: width * 0.08,
        top: region ? height * region.top : 0,
        height: region ? height * region.height : "100%",
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignContent: "center",
        alignItems: "baseline",
        rowGap: base * 0.12,
        columnGap: base * 0.45
      }}
    >
      {scene.items.map((item, index) => {
        // Words render from frame 0 at zero opacity so the collage's layout is
        // staged once and never rewraps — each word pops into its reserved
        // slot on its beat instead of shoving the others around.
        const localFrame = frame - (item.at - scene.start) * fps;
        const enter = localFrame < 0 ? 0 : spring({ frame: localFrame, fps, config: SPRINGS.enter });
        const enterPrev = localFrame < 1 ? 0 : spring({ frame: localFrame - 1, fps, config: SPRINGS.enter });
        const motionBlur = entranceBlur(enter, enterPrev);
        const emphasised = Boolean(item.emphasis);
        const size = emphasised ? base * 1.9 : base;
        // The accent word lands in ink, then SNAPS into its colour a beat later
        // with a small pulse — the reference's "gains its colour on the word"
        // (P4 teardown). Plain words just use their colour from the start.
        const colorDelay = Math.round(0.12 * fps);
        const colored = !item.color || !emphasised || localFrame >= colorDelay;
        const wordColor = item.color
          ? colored
            ? semanticColor(item.color)
            : onDark ? INK.onDark : INK.primary
          : onDark ? INK.onDark : INK.primary;
        const pulseP = item.color && emphasised ? clamp(spring({ frame: localFrame - colorDelay, fps, config: SPRINGS.enter })) : 0;
        const pulse = 1 + 0.09 * Math.sin(pulseP * Math.PI);
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
              color: wordColor,
              textShadow: onDark ? "0 4px 18px rgba(10,10,8,0.55)" : TYPE_SHADOW,
              transform: [
                `rotate(${WORD_ROTATIONS[index % WORD_ROTATIONS.length]}deg)`,
                `translateY(${WORD_OFFSETS[index % WORD_OFFSETS.length] * base + (1 - enter) * base * 0.6}px)`,
                `scale(${(0.7 + enter * 0.3) * pulse})`
              ].join(" "),
              opacity: Math.min(1, enter * 1.5),
              filter: motionBlur
            }}
          >
            {item.text}
          </span>
        );
      })}
    </div>
  );
}

function TypographyScene({ scene, width, height }) {
  return (
    <AbsoluteFill>
      <WordBuild scene={scene} width={width} height={height} region={null} />
    </AbsoluteFill>
  );
}

// The chat composer (ART_DIRECTION 4e): a dark pill that starts MINIMIZED —
// just the icon row, like a real input at rest — and springs open line by
// line as the prompt types. Brand icon chips sit left with the +, mic and an
// up-arrow send sit right; the arrow presses when typing completes. The pill
// is the focal object: a close push-in, a pan while it types, and the bright
// travelling rim glow.
function PromptCardScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const sceneLength = scene.end - scene.start;
  const enter = spring({ frame, fps, config: SPRINGS.enter });
  const typeStart = 0.35;
  const typeSpan = Math.max(0.6, sceneLength - 1.1);
  const typeProgress = clamp((seconds - typeStart) / typeSpan);
  const text = scene.text.slice(0, Math.ceil(scene.text.length * typeProgress));
  const fontSize = Math.round(height * 0.026);
  const lineHeight = fontSize * 1.5;
  // Deterministic wrap estimate so the pill's height needs no DOM measuring.
  const charsPerLine = Math.max(10, Math.floor((width * 0.86 - fontSize * 3.4) / (fontSize * 0.54)));
  const totalLines = Math.max(1, Math.ceil(scene.text.length / charsPerLine));
  // Each line opens on its own spring the moment its first character types.
  let textArea = 0;
  for (let line = 0; line < totalLines; line += 1) {
    const at = typeStart + ((line * charsPerLine) / scene.text.length) * typeSpan;
    const local = frame - at * fps;
    if (local >= 0) textArea += lineHeight * spring({ frame: local, fps, config: SPRINGS.settle });
  }
  // The send press: the arrow dips and rebounds the moment the prompt is done.
  const pressP = spring({ frame: frame - (typeStart + typeSpan + 0.12) * fps, fps, config: SPRINGS.enter });
  const arrowScale = 1 - 0.35 * Math.sin(clamp(pressP) * Math.PI);
  const radius = fontSize * 2.3;
  const drift = focalDrift({ frame, fps, seconds: sceneLength, zoom: 0.1, pan: 0.03 });
  return (
    <AbsoluteFill style={{ display: "grid", placeItems: "center", padding: `0 ${width * 0.07}px` }}>
      <div
        style={{
          width: "100%",
          transform: `translate(${drift.panX * width}px, ${(1 - enter) * height * 0.06}px) scale(${drift.scale})`,
          opacity: Math.min(1, enter * 1.4)
        }}
      >
        <GlowBorder radius={radius}>
          <Card dark radius={radius} elevation="high" style={{ width: "100%", padding: `${fontSize * 0.9}px ${fontSize * 1.4}px` }}>
            <div style={{ height: textArea, overflow: "hidden", display: "flex", alignItems: "flex-end" }}>
              <div style={{ fontFamily: FONTS.sans, fontWeight: 600, fontSize, lineHeight: `${lineHeight}px`, color: SEMANTIC.mint, paddingBottom: textArea > 0 ? fontSize * 0.2 : 0 }}>
                {text}
                {text.length ? <Caret fontSize={fontSize} /> : null}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: fontSize * 0.9, height: fontSize * 2.2 }}>
              <div style={{ color: INK.onDarkMuted, fontSize: fontSize * 1.5, fontWeight: 300, lineHeight: 1 }}>+</div>
              {(scene.icons ?? []).map((src, index) => (
                <Img key={index} src={resolveSrc(src)} style={{ width: fontSize * 1.6, height: fontSize * 1.6, objectFit: "contain" }} />
              ))}
              <div style={{ flex: 1 }} />
              <Mic size={fontSize} />
              <Paperclip size={fontSize} />
              {/* Send: a white filled circle with a dark enter glyph, like the
                  reference composer (t23). It presses on prompt completion. */}
              <div
                style={{
                  width: fontSize * 1.9,
                  height: fontSize * 1.9,
                  borderRadius: "50%",
                  background: INK.onDark,
                  display: "grid",
                  placeItems: "center",
                  transform: `scale(${arrowScale})`,
                  flexShrink: 0
                }}
              >
                <span style={{ fontFamily: FONTS.sans, fontWeight: 700, fontSize: fontSize * 1.15, lineHeight: 1, color: CARD.dark }}>↵</span>
              </div>
            </div>
          </Card>
        </GlowBorder>
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

// Simple attachment glyph for the composer row, matching the reference (t23).
function Paperclip({ size }) {
  return (
    <div
      style={{
        width: size * 0.62,
        height: size * 1.05,
        borderRadius: 999,
        border: `2px solid ${INK.onDarkMuted}`,
        borderBottom: "none",
        transform: "rotate(35deg)"
      }}
    />
  );
}

// Brand icons as characters, arriving from depth: near-zero scale flying
// toward the camera, blurred while small and fast. The flow reflows: each
// node's slot (connector included) grows with its spring, so earlier nodes
// glide up to make room as the chain extends downward.
function IconFlowScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const iconSize = Math.round(width * 0.24);
  const labelSize = Math.round(height * 0.034);
  const connectorHeight = height * 0.045;
  const sizes = scene.items.map((item, index) => {
    const node = (item.src ? iconSize + labelSize * 0.4 : 0) + labelSize * 1.2;
    return (index > 0 ? connectorHeight : 0) + node;
  });
  const presences = scene.items.map((item) => {
    const localFrame = frame - (item.at - scene.start) * fps;
    return localFrame < 0 ? 0 : spring({ frame: localFrame, fps, config: SPRINGS.enter });
  });
  const { centers } = stackLayout({ sizes, presences });
  return (
    <AbsoluteFill style={{ display: "grid", placeItems: "center" }}>
      <div style={{ position: "relative", width: "100%", height: 0 }}>
        {scene.items.map((item, index) => {
          const enter = presences[index];
          if (enter <= 0) return null;
          const depthBlur = enter < 0.75 ? (1 - enter) * 6 : 0;
          return (
            <div
              key={index}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: centers[index],
                transform: "translateY(-50%)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center"
              }}
            >
              {index > 0 ? (
                <div
                  style={{
                    width: 0,
                    height: connectorHeight,
                    borderLeft: `3.5px dashed ${INK.primary}`,
                    opacity: Math.min(1, enter * 1.4),
                    transform: `scaleY(${enter})`,
                    transformOrigin: "top"
                  }}
                />
              ) : null}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: labelSize * 0.4,
                  transform: `scale(${0.06 + enter * 0.94})`,
                  opacity: Math.min(1, enter * 2),
                  filter: depthBlur > 0.4 ? `blur(${depthBlur.toFixed(1)}px)` : undefined
                }}
              >
                {item.src ? (
                  <Card dark radius={iconSize * 0.24} elevation="mid" style={{ width: iconSize, height: iconSize, display: "grid", placeItems: "center", padding: iconSize * 0.2 }}>
                    <Img src={resolveSrc(item.src)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  </Card>
                ) : null}
                <div style={{ fontFamily: FONTS.serif, fontWeight: 900, fontSize: labelSize, color: item.color ? semanticColor(item.color) : INK.primary, transform: `rotate(${WORD_ROTATIONS[index % WORD_ROTATIONS.length] * 0.6}deg)` }}>
                  {item.text}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

// Numbered chips with drawn thickness, stacking as each is spoken. The stack
// reflows: every chip's slot grows with its entrance spring, so chips already
// on screen glide apart to make room instead of jumping when one lands.
function CardStepsScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fontSize = Math.round(height * 0.028);
  const gap = height * 0.022;
  // Slot heights are computed, not measured: padding + the taller of the
  // numeral and the (estimated) wrapped text. Long items get a second line.
  const chipHeight = (text) => fontSize * 1.5 + (text.length > 26 ? fontSize * 2.4 : fontSize * 1.5);
  const entries = [];
  if (scene.title) {
    entries.push({ kind: "title", size: fontSize * 1.5 * 1.2 + height * 0.012, at: scene.start });
  }
  scene.items.forEach((item, index) => {
    entries.push({ kind: "chip", item, index, size: chipHeight(item.text), at: item.at });
  });
  const presences = entries.map((entry) => {
    const localFrame = frame - (entry.at - scene.start) * fps;
    return localFrame < 0 ? 0 : spring({ frame: localFrame, fps, config: SPRINGS.enter });
  });
  const { centers } = stackLayout({ sizes: entries.map((entry) => entry.size), presences, gap });
  return (
    <AbsoluteFill style={{ display: "grid", placeItems: "center", padding: `0 ${width * 0.1}px` }}>
      <div style={{ position: "relative", width: "100%", height: 0 }}>
        {entries.map((entry, position) => {
          const enter = presences[position];
          if (enter <= 0) return null;
          const localFrame = frame - (entry.at - scene.start) * fps;
          const motionBlur = entranceBlur(enter, localFrame < 1 ? 0 : spring({ frame: localFrame - 1, fps, config: SPRINGS.enter }));
          if (entry.kind === "title") {
            return (
              <div
                key="title"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: centers[position],
                  textAlign: "center",
                  fontFamily: FONTS.script,
                  fontStyle: "italic",
                  fontWeight: 900,
                  fontSize: fontSize * 1.5,
                  color: INK.primary,
                  transform: `translateY(-50%) translateY(${(1 - enter) * height * 0.04}px) rotate(-2deg)`,
                  opacity: Math.min(1, enter * 1.5),
                  filter: motionBlur
                }}
              >
                {scene.title}
              </div>
            );
          }
          const tilt = WORD_ROTATIONS[entry.index % WORD_ROTATIONS.length] * 0.4;
          return (
            <div
              key={entry.index}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: centers[position],
                transform: `translateY(-50%) translateY(${(1 - enter) * height * 0.05}px) rotate(${tilt}deg)`,
                opacity: Math.min(1, enter * 1.5),
                filter: motionBlur
              }}
            >
              <Card chip elevation="low" radius={20} style={{ display: "flex", alignItems: "center", gap: fontSize, padding: `${fontSize * 0.75}px ${fontSize * 1.1}px` }}>
                <div style={{ fontFamily: FONTS.serif, fontWeight: 900, fontSize: fontSize * 1.5, color: SEMANTIC.mint, minWidth: fontSize * 1.4, lineHeight: 1 }}>
                  {entry.index + 1}
                </div>
                <div style={{ fontFamily: FONTS.sans, fontWeight: 800, fontSize, lineHeight: 1.2, color: INK.primary }}>{entry.item.text}</div>
              </Card>
            </div>
          );
        })}
      </div>
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

// pile: one screenshot lands, copies fan out around it.
// scroll: a feed of screenshots travels up through the frame like a timeline
// being scrolled — continuous, tactile motion for the whole scene.
function ScreenshotPileScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (scene.mode === "scroll") {
    const sceneFrames = Math.max(1, (scene.end - scene.start) * fps);
    const cardHeight = height * 0.34;
    const gap = height * 0.035;
    const totalHeight = scene.items.length * (cardHeight + gap);
    const travel = Math.max(0, totalHeight - height * 0.7);
    const progress = clamp(frame / sceneFrames);
    const eased = progress * progress * (3 - 2 * progress);
    return (
      <AbsoluteFill style={{ overflow: "hidden", padding: `0 ${width * 0.12}px` }}>
        <div style={{ position: "absolute", left: width * 0.12, right: width * 0.12, top: height * 0.15, transform: `translateY(${-eased * travel}px)` }}>
          {scene.items.map((item, index) => (
            <div key={index} style={{ marginBottom: gap, transform: `rotate(${WORD_ROTATIONS[index % WORD_ROTATIONS.length] * 0.35}deg)` }}>
              <Card elevation="mid" radius={18} style={{ width: "100%", height: cardHeight }}>
                <Img src={resolveSrc(item.src)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
              </Card>
            </div>
          ))}
        </div>
      </AbsoluteFill>
    );
  }
  const cardWidth = width * 0.62;
  return (
    <AbsoluteFill style={{ display: "grid", placeItems: "center" }}>
      <div style={{ position: "relative", width: cardWidth, height: cardWidth * 1.4 }}>
        {scene.items.map((item, index) => {
          const slot = PILE_SLOTS[index % PILE_SLOTS.length];
          const localFrame = frame - (item.at - scene.start) * fps;
          if (localFrame < 0) return null;
          const enter = spring({ frame: localFrame, fps, config: SPRINGS.enter });
          const motionBlur = entranceBlur(enter, spring({ frame: localFrame - 1, fps, config: SPRINGS.enter }));
          return (
            <div
              key={index}
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 100 - index,
                filter: motionBlur,
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

// Anything moving fast enough to streak gets a touch of blur; at rest, none.
function entranceBlur(enterNow, enterPrev) {
  const blur = Math.min(5, Math.max(0, enterNow - enterPrev) * 30);
  return blur > 0.4 ? `blur(${blur.toFixed(1)}px)` : undefined;
}

// One oversized number rolling up to its value, label beneath. The number is
// the focal element; nothing else shares the frame.
function StatCounterScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = frame - (scene.at - scene.start) * fps;
  if (localFrame < 0) return null;
  const enter = spring({ frame: localFrame, fps, config: SPRINGS.enter });
  const roll = spring({ frame: localFrame, fps, config: { damping: 30, stiffness: 60, mass: 1.2 } });
  const match = scene.value.match(/([\d.,]+)/);
  let display = scene.value;
  if (match) {
    const target = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(target)) {
      const current = target * roll;
      const rendered = Number.isInteger(target) && target < 1000
        ? String(Math.round(current))
        : Math.round(current).toLocaleString("en-US");
      display = scene.value.replace(match[1], rendered);
    }
  }
  const valueSize = Math.round(height * 0.11);
  const drift = focalDrift({ frame, fps, seconds: scene.end - scene.start, zoom: 0.03, pan: 0.006 });
  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: height * 0.02,
        padding: `0 ${width * 0.1}px`,
        transform: `translateX(${drift.panX * width}px) scale(${drift.scale})`
      }}
    >
      <div style={{ fontFamily: FONTS.script, fontStyle: "italic", fontWeight: 900, fontSize: valueSize, lineHeight: 1, color: semanticColor(scene.color), transform: `scale(${0.6 + enter * 0.4}) rotate(-2deg)`, opacity: Math.min(1, enter * 1.5) }}>
        {display}
      </div>
      {scene.label ? (
        <div style={{ fontFamily: FONTS.serif, fontWeight: 900, fontSize: Math.round(height * 0.032), lineHeight: 1.15, color: INK.primary, textAlign: "center", maxWidth: width * 0.8, transform: `translateY(${(1 - enter) * height * 0.02}px)`, opacity: Math.min(1, enter * 1.3) }}>
          {scene.label}
        </div>
      ) : null}
    </AbsoluteFill>
  );
}

// A principle or testimonial on a white card: serif quote, muted attribution.
function QuoteCardScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = frame - (scene.at - scene.start) * fps;
  if (localFrame < 0) return null;
  const enter = spring({ frame: localFrame, fps, config: SPRINGS.enter });
  const fontSize = Math.round(height * 0.034);
  const drift = focalDrift({ frame, fps, seconds: scene.end - scene.start, zoom: 0.03, pan: 0.006 });
  return (
    <AbsoluteFill style={{ display: "grid", placeItems: "center", padding: `0 ${width * 0.09}px` }}>
      <div
        style={{
          width: "100%",
          transform: `translate(${drift.panX * width}px, ${(1 - enter) * height * 0.05}px) rotate(-1deg) scale(${drift.scale})`,
          opacity: Math.min(1, enter * 1.4),
          filter: entranceBlur(enter, spring({ frame: localFrame - 1, fps, config: SPRINGS.enter }))
        }}
      >
        <Card elevation="high" radius={26} style={{ padding: `${fontSize * 1.4}px ${fontSize * 1.3}px` }}>
          <div style={{ fontFamily: FONTS.serif, fontWeight: 900, fontSize, lineHeight: 1.25, color: INK.primary }}>
            “{scene.text}”
          </div>
          {scene.attribution ? (
            <div style={{ marginTop: fontSize * 0.8, fontFamily: FONTS.sans, fontWeight: 600, fontSize: fontSize * 0.62, color: INK.muted }}>
              — {scene.attribution}
            </div>
          ) : null}
        </Card>
      </div>
    </AbsoluteFill>
  );
}

function ArtifactGridScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sceneFrames = Math.max(1, (scene.end - scene.start) * fps);
  const drift = interpolate(frame, [0, sceneFrames], [-0.012, 0.014], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.22, 0.8, 0.24, 1)
  });
  const titleSize = Math.round(height * 0.035);
  const labelSize = Math.round(height * 0.021);
  const columns = scene.items.length <= 3 ? 1 : 2;
  const gap = height * 0.02;
  const cardWidth = columns === 1 ? width * 0.72 : width * 0.38;
  const cardHeight = height * 0.132;
  const rows = Math.ceil(scene.items.length / columns);
  const boardWidth = columns * cardWidth + (columns - 1) * gap;
  const boardHeight = rows * cardHeight + (rows - 1) * gap;
  const titleEnter = spring({ frame, fps, config: SPRINGS.settle });

  return (
    <AbsoluteFill style={{ display: "grid", placeItems: "center", padding: `0 ${width * 0.07}px` }}>
      <div
        style={{
          width: boardWidth,
          height: boardHeight + (scene.title ? titleSize * 1.7 : 0),
          transform: `translate(${drift * width}px, 0) rotate(-0.6deg)`
        }}
      >
        {scene.title ? (
          <div
            style={{
              height: titleSize * 1.7,
              display: "grid",
              placeItems: "center",
              fontFamily: FONTS.script,
              fontStyle: "italic",
              fontWeight: 900,
              fontSize: titleSize,
              color: INK.primary,
              opacity: Math.min(1, titleEnter * 1.4),
              transform: `translateY(${(1 - titleEnter) * height * 0.035}px) rotate(-2deg)`
            }}
          >
            {scene.title}
          </div>
        ) : null}
        <div style={{ position: "relative", width: boardWidth, height: boardHeight }}>
          {scene.items.map((item, index) => {
            const col = index % columns;
            const row = Math.floor(index / columns);
            const localFrame = frame - (item.at - scene.start) * fps;
            if (localFrame < 0) return null;
            const enter = spring({ frame: localFrame, fps, config: SPRINGS.enter });
            const enterPrev = localFrame < 1 ? 0 : spring({ frame: localFrame - 1, fps, config: SPRINGS.enter });
            const accent = index % 3 === 0 ? SEMANTIC.mint : index % 3 === 1 ? SEMANTIC.coral : SEMANTIC.purple;
            const stamp = item.status || artifactKind(item.path || item.label);
            return (
              <div
                key={`${item.label}-${index}`}
                style={{
                  position: "absolute",
                  left: col * (cardWidth + gap),
                  top: row * (cardHeight + gap),
                  width: cardWidth,
                  height: cardHeight,
                  transform: [
                    `translateY(${(1 - enter) * height * 0.045}px)`,
                    `rotate(${WORD_ROTATIONS[index % WORD_ROTATIONS.length] * 0.25 * enter}deg)`,
                    `scale(${0.86 + enter * 0.14})`
                  ].join(" "),
                  opacity: Math.min(1, enter * 1.5),
                  filter: entranceBlur(enter, enterPrev)
                }}
              >
                <Card elevation="mid" radius={18} style={{ height: "100%", padding: `${labelSize * 0.75}px ${labelSize}px`, display: "flex", alignItems: "center", gap: labelSize * 0.72 }}>
                  <div style={{ width: labelSize * 2.35, height: labelSize * 2.35, borderRadius: 12, background: accent, color: INK.onDark, display: "grid", placeItems: "center", flexShrink: 0, fontFamily: FONTS.sans, fontSize: labelSize * 0.62, fontWeight: 800, letterSpacing: 0 }}>
                    {artifactKind(item.path || item.label)}
                  </div>
                  {item.src ? (
                    <div style={{ width: labelSize * 2.35, height: labelSize * 2.35, borderRadius: 10, overflow: "hidden", flexShrink: 0, boxShadow: "inset 0 0 0 1px rgba(26,26,24,0.12)" }}>
                      <Img src={resolveSrc(item.src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>
                  ) : null}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontFamily: FONTS.serif, fontWeight: 900, fontSize: labelSize * 1.04, lineHeight: 1.08, color: INK.primary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.label}
                    </div>
                    <div style={{ marginTop: labelSize * 0.24, fontFamily: FONTS.sans, fontWeight: 600, fontSize: labelSize * 0.62, lineHeight: 1.2, color: INK.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.path || stamp}
                    </div>
                  </div>
                  <div style={{ alignSelf: "flex-start", borderRadius: 999, padding: `${labelSize * 0.16}px ${labelSize * 0.45}px`, background: "rgba(79,174,133,0.14)", color: SEMANTIC.mint, fontFamily: FONTS.sans, fontSize: labelSize * 0.55, fontWeight: 800, textTransform: "uppercase" }}>
                    {stamp}
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function TerminalReceiptScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const sceneLength = scene.end - scene.start;
  const sceneFrames = Math.max(1, sceneLength * fps);
  const enter = spring({ frame, fps, config: SPRINGS.enter });
  const drift = interpolate(frame, [0, sceneFrames], [0.02, -0.016], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.33, 0, 0.17, 1)
  });
  const typeSpan = Math.max(0.5, Math.min(1.35, sceneLength * 0.38));
  const commandProgress = clamp((seconds - 0.2) / typeSpan);
  const typedCommand = scene.command.slice(0, Math.ceil(scene.command.length * commandProgress));
  const outputLines = String(scene.output ?? "").split(/\r?\n/).filter(Boolean).slice(0, 5);
  const outputProgress = clamp((seconds - 0.75) / Math.max(0.8, sceneLength * 0.42));
  const visibleLines = outputLines.slice(0, Math.ceil(outputLines.length * outputProgress));
  const statusFrame = frame - (scene.at - scene.start) * fps;
  const statusEnter = statusFrame < 0 ? 0 : spring({ frame: statusFrame, fps, config: SPRINGS.enter });
  const fontSize = Math.round(height * 0.022);
  const titleSize = Math.round(height * 0.03);

  return (
    <AbsoluteFill style={{ display: "grid", placeItems: "center", padding: `0 ${width * 0.07}px` }}>
      <div
        style={{
          width: "100%",
          transform: `translate(${drift * width}px, ${(1 - enter) * height * 0.045}px) scale(${0.92 + enter * 0.08}) rotate(0.8deg)`,
          opacity: Math.min(1, enter * 1.5),
          filter: entranceBlur(enter, spring({ frame: frame - 1, fps, config: SPRINGS.enter }))
        }}
      >
        <GlowBorder radius={24}>
          <Card dark radius={24} elevation="high" style={{ width: "100%", padding: `${fontSize * 1.25}px ${fontSize * 1.35}px`, minHeight: height * 0.42 }}>
            <div style={{ display: "flex", alignItems: "center", gap: fontSize * 0.48, marginBottom: fontSize * 1.1 }}>
              {[SEMANTIC.coral, SEMANTIC.mint, SEMANTIC.purple].map((color) => (
                <span key={color} style={{ width: fontSize * 0.7, height: fontSize * 0.7, borderRadius: "50%", background: color, display: "inline-block" }} />
              ))}
              <div style={{ flex: 1 }} />
              <div style={{ fontFamily: FONTS.sans, fontWeight: 800, fontSize: fontSize * 0.68, color: INK.onDarkMuted, textTransform: "uppercase" }}>
                terminal receipt
              </div>
            </div>
            <div style={{ fontFamily: FONTS.serif, fontWeight: 900, fontSize: titleSize, lineHeight: 1.05, color: INK.onDark, marginBottom: fontSize * 0.9 }}>
              Real command, real output
            </div>
            <div style={{ fontFamily: "SFMono-Regular, Menlo, Consolas, monospace", fontSize, lineHeight: 1.45, color: SEMANTIC.mint, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              <span style={{ color: SEMANTIC.purple }}>$ </span>
              {typedCommand}
              {commandProgress < 1 ? <Caret fontSize={fontSize} /> : null}
            </div>
            <div style={{ marginTop: fontSize * 0.8, minHeight: fontSize * 5.9, fontFamily: "SFMono-Regular, Menlo, Consolas, monospace", fontSize: fontSize * 0.82, lineHeight: 1.45, color: INK.onDarkMuted, whiteSpace: "pre-wrap", overflow: "hidden" }}>
              {visibleLines.map((line, index) => (
                <div key={index} style={{ opacity: 0.55 + outputProgress * 0.45 }}>{line}</div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div
                style={{
                  borderRadius: 999,
                  padding: `${fontSize * 0.34}px ${fontSize * 0.8}px`,
                  background: "rgba(79,174,133,0.18)",
                  color: SEMANTIC.mint,
                  fontFamily: FONTS.sans,
                  fontWeight: 800,
                  fontSize: fontSize * 0.72,
                  textTransform: "uppercase",
                  transform: `translateY(${(1 - statusEnter) * fontSize * 1.4}px) scale(${0.7 + statusEnter * 0.3})`,
                  opacity: Math.min(1, statusEnter * 1.5)
                }}
              >
                {scene.status}
              </div>
            </div>
          </Card>
        </GlowBorder>
      </div>
    </AbsoluteFill>
  );
}

function artifactKind(text) {
  const value = String(text || "").toLowerCase();
  if (value.endsWith(".mp4") || value.includes("video")) return "MP4";
  if (value.includes("thumb") || value.endsWith(".png") || value.endsWith(".jpg") || value.endsWith(".jpeg")) return "IMG";
  if (value.includes("caption") || value.endsWith(".srt") || value.endsWith(".vtt")) return "TXT";
  if (value.includes("plan") || value.endsWith(".json")) return "JSON";
  if (value.includes("review") || value.endsWith(".md")) return "MD";
  return "FILE";
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

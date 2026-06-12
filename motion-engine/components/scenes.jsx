import React from "react";
import { AbsoluteFill, Freeze, Img, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Card } from "./paper.jsx";
import { FONTS, INK, SEMANTIC, SPRINGS } from "../theme.js";
import { TRAVEL_SECONDS } from "../schema.js";
import { travelProgress } from "../travel.js";

// Scene track on a continuous canvas. Scenes whose transition is a travel
// move (swipe/zoom) fly in while the previous scene flies out — the camera
// crosses one tabletop. Hard cuts are chapter breaks. Blur is scoped to the
// motion: heavy while travelling, crisp at rest.
export function SceneTrack({ scenes, width, height }) {
  const { fps } = useVideoConfig();
  const travelFrames = Math.round(TRAVEL_SECONDS * fps);
  return (
    <AbsoluteFill>
      {scenes.map((scene, index) => {
        const enterTravel = scene.transition !== "cut";
        const exitTransition = scenes[index + 1] ? scenes[index + 1].transition : "cut";
        const contentFrames = Math.max(1, Math.round((scene.end - scene.start) * fps));
        const enterOffset = enterTravel ? travelFrames : 0;
        const from = Math.round(scene.start * fps) - enterOffset;
        // The camera move is shared: the incoming scene travels during the
        // outgoing scene's LAST travelFrames — one move, two passengers.
        const exitStartFrame = Math.max(enterOffset, enterOffset + contentFrames - (exitTransition !== "cut" ? travelFrames : 0));
        const content = <Scene scene={scene} width={width} height={height} travelled={enterTravel} />;
        return (
          <Sequence key={scene.id} from={from} durationInFrames={enterOffset + contentFrames}>
            <TravelShell
              transition={scene.transition}
              exitTransition={exitTransition}
              exitStartFrame={exitStartFrame}
              settle={index > 0 && !enterTravel}
              width={width}
              sceneId={scene.id}
            >
              {enterTravel ? (
                <Sequence from={0} durationInFrames={travelFrames}>
                  <Freeze frame={0}>{content}</Freeze>
                </Sequence>
              ) : null}
              <Sequence from={enterOffset} durationInFrames={contentFrames}>
                {content}
              </Sequence>
            </TravelShell>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

// Applies the camera-travel transform for a scene's entrance and exit, with
// motion blur proportional to velocity — directional for swipes, isotropic
// for zooms. Cut entrances keep the gentle scale settle.
function TravelShell({ transition, exitTransition, exitStartFrame, settle, width, sceneId, children }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const hasEnter = transition !== "cut";
  const enterP = hasEnter ? travelProgress(frame, fps) : 1;
  const enterV = hasEnter ? enterP - travelProgress(frame - 1, fps) : 0;
  const exitFrame = frame - exitStartFrame;
  const hasExit = exitTransition !== "cut" && exitFrame >= 0;
  const exitP = hasExit ? travelProgress(exitFrame, fps) : 0;
  const exitV = hasExit ? exitP - travelProgress(exitFrame - 1, fps) : 0;

  let translateX = 0;
  let scale = 1;
  let opacity = 1;
  if (transition === "swipe_left") translateX += (1 - enterP) * width;
  if (transition === "swipe_right") translateX += -(1 - enterP) * width;
  if (transition === "zoom_into") {
    scale *= 0.4 + 0.6 * enterP;
    opacity *= Math.min(1, enterP * 1.6);
  }
  if (exitTransition === "swipe_left") translateX += -exitP * width;
  if (exitTransition === "swipe_right") translateX += exitP * width;
  if (exitTransition === "zoom_into") {
    scale *= 1 + exitP * 1.5;
    opacity *= 1 - exitP;
  }

  const settleP = settle ? spring({ frame, fps, config: SPRINGS.settle }) : 1;
  scale *= settle ? 1.04 - settleP * 0.04 : 1;

  // Blur follows each phase's own move: swipes smear horizontally, zooms
  // blur isotropically — even when a scene swipes in and zooms out.
  const swipeSpeed = (transition.startsWith("swipe") ? Math.abs(enterV) : 0) + (exitTransition.startsWith("swipe") ? Math.abs(exitV) : 0);
  const zoomSpeed = (transition === "zoom_into" ? Math.abs(enterV) : 0) + (exitTransition === "zoom_into" ? Math.abs(exitV) : 0);
  const directionalBlur = Math.min(34, swipeSpeed * width * 0.55);
  const isotropicBlur = directionalBlur > 0.5 ? 0 : Math.min(16, zoomSpeed * 90);
  const filterId = `mb-${sceneId}`;
  const filter =
    directionalBlur > 0.5 ? `url(#${filterId})` : isotropicBlur > 0.5 ? `blur(${isotropicBlur.toFixed(1)}px)` : undefined;

  return (
    <>
      {directionalBlur > 0.5 ? (
        <svg style={{ position: "absolute", width: 0, height: 0 }}>
          <defs>
            <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation={`${directionalBlur.toFixed(1)},0`} edgeMode="duplicate" />
            </filter>
          </defs>
        </svg>
      ) : null}
      <AbsoluteFill
        style={{
          transform: `translateX(${translateX}px) scale(${scale})`,
          transformOrigin: "50% 45%",
          opacity,
          filter
        }}
      >
        {children}
      </AbsoluteFill>
    </>
  );
}

function Scene({ scene, width, height, travelled = false }) {
  if (scene.type === "talking_head") return <TalkingHeadScene scene={scene} width={width} height={height} />;
  if (scene.type === "screen") return <ScreenScene scene={scene} width={width} height={height} />;
  if (scene.type === "typography") return <TypographyScene scene={scene} width={width} height={height} />;
  if (scene.type === "prompt_card") return <PromptCardScene scene={scene} width={width} height={height} travelled={travelled} />;
  if (scene.type === "icon_flow") return <IconFlowScene scene={scene} width={width} height={height} />;
  if (scene.type === "card_steps") return <CardStepsScene scene={scene} width={width} height={height} />;
  if (scene.type === "screenshot_pile") return <ScreenshotPileScene scene={scene} width={width} height={height} />;
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
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ display: "grid", placeItems: "center", padding: `${height * 0.1}px ${width * 0.06}px` }}>
      <Card elevation="high" style={{ width: "100%", aspectRatio: "9 / 14", maxHeight: "100%" }}>
        <OffthreadVideo
          muted
          src={resolveSrc(scene.src)}
          trimBefore={Math.round((scene.offset ?? 0) * fps)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </Card>
    </AbsoluteFill>
  );
}

const WORD_ROTATIONS = [-3, 2, -2, 3, -1, 2.5];
const WORD_OFFSETS = [0, 0.06, -0.04, 0.08, -0.06, 0.03];

// Shared word-cadenced type build; TypographyScene centers it full-frame,
// talking-head layouts stage it in the region above the face.
function WordBuild({ scene, width, height, region }) {
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
  );
}

function TypographyScene({ scene, width, height }) {
  return (
    <AbsoluteFill>
      <WordBuild scene={scene} width={width} height={height} region={null} />
    </AbsoluteFill>
  );
}

// Dark chat-input card with the real prompt typing on. When the scene arrives
// by camera travel, the card comes fully formed — the travel IS its entrance.
function PromptCardScene({ scene, width, height, travelled = false }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const sceneLength = scene.end - scene.start;
  const enter = travelled ? 1 : spring({ frame, fps, config: SPRINGS.enter });
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
          style={{ width: "100%", padding: `${fontSize * 1.3}px ${fontSize * 1.5}px`, boxShadow: "0 30px 70px rgba(26,26,24,0.3), 0 0 70px rgba(79,174,133,0.35)" }}
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

// Brand icons as characters, arriving from depth: near-zero scale flying
// toward the camera, blurred while small and fast.
function IconFlowScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const iconSize = Math.round(width * 0.24);
  const labelSize = Math.round(height * 0.034);
  return (
    <AbsoluteFill style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
      {scene.items.map((item, index) => {
        const localFrame = frame - (item.at - scene.start) * fps;
        if (localFrame < 0) return null;
        const enter = spring({ frame: localFrame, fps, config: SPRINGS.enter });
        const depthBlur = enter < 0.75 ? (1 - enter) * 6 : 0;
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
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
}

// Numbered chips with drawn thickness, stacking as each is spoken.
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
            <Card chip elevation="low" radius={20} style={{ display: "flex", alignItems: "center", gap: fontSize, padding: `${fontSize * 0.75}px ${fontSize * 1.1}px` }}>
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

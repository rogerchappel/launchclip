import React from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

const INK = "#fafafa";
const MUTED = "rgba(255,255,255,0.64)";
const ACCENT = "#ffd60a";
const GREEN = "#22c55e";
const GROUND = "radial-gradient(120% 90% at 50% 20%, #10141c 0%, #0b0e14 70%)";
const CUT_SETTLE = { damping: 13, stiffness: 240, mass: 0.8 };
const BUILD_IN = { damping: 12, stiffness: 250, mass: 0.7 };

// The visual base: scenes butt-joined on the global clock, each entering with
// a hard cut + scale settle. Voice runs underneath, unbroken.
export function SceneTrack({ scenes, width, height }) {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: GROUND }}>
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
  if (scene.type === "talking_head" || scene.type === "screen") {
    return <FootageScene scene={scene} />;
  }
  if (scene.type === "console") return <ConsoleScene scene={scene} width={width} height={height} />;
  if (scene.type === "steps") return <StepsScene scene={scene} width={width} height={height} />;
  if (scene.type === "flow") return <FlowScene scene={scene} width={width} height={height} />;
  return null;
}

// Hard cut + settle: incoming scene starts at 107% with a breath of rotateX
// and springs to rest. Subliminal depth, not architecture.
function SceneShell({ settle, children }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = settle ? spring({ frame, fps, config: CUT_SETTLE }) : 1;
  return (
    <AbsoluteFill
      style={{
        transform: `perspective(1200px) rotateX(${(1 - enter) * 2.5}deg) scale(${1.07 - enter * 0.07})`,
        transformOrigin: "50% 45%"
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

// Footage is always muted here — the continuous voice track owns the audio.
function FootageScene({ scene }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drift = scene.type === "screen" ? 1 + Math.min(frame / fps, 5) * 0.006 : 1;
  return (
    <OffthreadVideo
      muted
      src={resolveSrc(scene.src)}
      trimBefore={Math.round((scene.offset ?? 0) * fps)}
      style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${drift})` }}
    />
  );
}

// Real captured output, restyled: type-on lines, blinking block cursor.
function ConsoleScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const sceneLength = scene.end - scene.start;
  const lineBudget = Math.max(0.5, (sceneLength - 0.6) / scene.lines.length);
  const fontSize = Math.round(height * 0.026);
  return (
    <AbsoluteFill style={{ background: GROUND, padding: `${height * 0.14}px ${width * 0.07}px` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: height * 0.03 }}>
        {["#f9736b", "#f5b84b", GREEN].map((color) => (
          <div key={color} style={{ width: 13, height: 13, borderRadius: 999, background: color }} />
        ))}
        {scene.title ? (
          <div style={{ marginLeft: 10, fontFamily: "Inter, Arial, sans-serif", fontSize: height * 0.016, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: MUTED }}>
            {scene.title}
          </div>
        ) : null}
      </div>
      <div style={{ fontFamily: "Menlo, Consolas, monospace", fontSize, lineHeight: 1.7 }}>
        {scene.lines.map((line, index) => {
          const lineStart = 0.3 + index * lineBudget;
          const progress = clamp((seconds - lineStart) / Math.max(0.25, lineBudget * 0.7));
          if (progress <= 0) return null;
          const isCommand = line.startsWith("$");
          const visible = line.slice(0, Math.ceil(line.length * progress));
          return (
            <div key={index} style={{ color: isCommand ? GREEN : MUTED, fontWeight: isCommand ? 700 : 500, whiteSpace: "pre-wrap" }}>
              {visible}
              {progress < 1 ? <Cursor fontSize={fontSize} /> : null}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function Cursor({ fontSize }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const on = Math.floor((frame / fps) * 3) % 2 === 0;
  return (
    <span style={{ display: "inline-block", width: fontSize * 0.55, height: fontSize * 1.1, marginLeft: 2, verticalAlign: "text-bottom", background: on ? GREEN : "transparent" }} />
  );
}

// Numbered cards landing on the spoken word that names them.
function StepsScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fontSize = Math.round(height * 0.032);
  return (
    <AbsoluteFill style={{ background: GROUND, padding: `${height * 0.14}px ${width * 0.08}px`, display: "flex", flexDirection: "column", justifyContent: "center", gap: height * 0.03 }}>
      {scene.title ? <SceneTitle title={scene.title} height={height} /> : null}
      {scene.items.map((item, index) => {
        const localFrame = frame - (item.at - scene.start) * fps;
        if (localFrame < 0) return null;
        const enter = spring({ frame: localFrame, fps, config: BUILD_IN });
        return (
          <div
            key={index}
            style={{
              display: "flex",
              alignItems: "center",
              gap: width * 0.045,
              // Tilt in from the top edge, settle flat.
              transform: `perspective(1000px) rotateX(${(1 - enter) * 55}deg) translateX(${(1 - enter) * width * 0.08}px)`,
              transformOrigin: "50% 0%",
              opacity: Math.min(1, enter * 1.4)
            }}
          >
            <div style={{ fontFamily: "Inter, Arial, sans-serif", fontWeight: 900, fontSize: fontSize * 2.2, lineHeight: 1, color: ACCENT, minWidth: fontSize * 2.4 }}>
              {index + 1}
            </div>
            <div style={{ fontFamily: "Inter, Arial, sans-serif", fontWeight: 850, fontSize, lineHeight: 1.15, color: INK }}>
              {item.text}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

// Vertical pipeline: node, arrow, node — each springing in on its word.
function FlowScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fontSize = Math.round(height * 0.028);
  const lastIndex = scene.items.length - 1;
  return (
    <AbsoluteFill style={{ background: GROUND, padding: `${height * 0.13}px ${width * 0.1}px`, display: "flex", flexDirection: "column", justifyContent: "center", gap: height * 0.012 }}>
      {scene.title ? <SceneTitle title={scene.title} height={height} /> : null}
      {scene.items.map((item, index) => {
        const localFrame = frame - (item.at - scene.start) * fps;
        if (localFrame < 0) return null;
        const enter = spring({ frame: localFrame, fps, config: BUILD_IN });
        const isLast = index === lastIndex;
        return (
          <React.Fragment key={index}>
            {index > 0 ? (
              <div style={{ alignSelf: "center", color: MUTED, fontSize: fontSize * 0.9, fontWeight: 900, opacity: Math.min(1, enter * 1.4), transform: `scaleY(${enter})` }}>
                ↓
              </div>
            ) : null}
            <div
              style={{
                alignSelf: "center",
                minWidth: width * 0.5,
                textAlign: "center",
                padding: `${fontSize * 0.55}px ${fontSize * 1.1}px`,
                borderRadius: 16,
                border: `3px solid ${isLast ? ACCENT : "rgba(255,255,255,0.22)"}`,
                background: isLast ? "rgba(255,214,10,0.12)" : "rgba(255,255,255,0.05)",
                fontFamily: "Inter, Arial, sans-serif",
                fontWeight: 850,
                fontSize,
                color: isLast ? ACCENT : INK,
                transform: `perspective(1000px) rotateX(${(1 - enter) * 40}deg) scale(${0.7 + enter * 0.3})`,
                transformOrigin: "50% 100%",
                opacity: Math.min(1, enter * 1.4)
              }}
            >
              {item.text}
            </div>
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
}

function SceneTitle({ title, height }) {
  return (
    <div
      style={{
        fontFamily: "Inter, Arial, sans-serif",
        fontWeight: 900,
        fontSize: Math.round(height * 0.02),
        textTransform: "uppercase",
        letterSpacing: "0.12em",
        color: MUTED,
        marginBottom: height * 0.015
      }}
    >
      {title}
    </div>
  );
}

function resolveSrc(src) {
  if (/^https?:\/\//.test(src)) return src;
  return staticFile(src);
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

import React from "react";
import { AbsoluteFill, Easing, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Card, GlowBorder } from "./paper.jsx";
import { CARD, FONTS, INK, SEMANTIC, TYPE_SHADOW } from "../theme.js";
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

export function SceneTrack({ scenes, objects = [], width, height }) {
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
                <LifecycleObjects objects={objectsForScene(objects, scene)} scene={scene} width={width} height={height} />
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
  const settleP = settle ? calmEnter(frame, fps, 0.22) : 1;
  return (
    <AbsoluteFill style={{ transform: `scale(${settle ? 1.018 - settleP * 0.018 : 1})`, transformOrigin: "50% 45%" }}>
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
  if (scene.type === "chart") return <ChartScene scene={scene} width={width} height={height} />;
  if (scene.type === "diagram") return <DiagramScene scene={scene} width={width} height={height} />;
  return null;
}

function objectsForScene(objects, scene) {
  return objects.filter((object) => {
    if (object.scene_id) return object.scene_id === scene.id;
    return (object.states ?? []).some((state) => state.at >= scene.start && state.at <= scene.end);
  });
}

function LifecycleObjects({ objects, scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!objects.length) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {objects.map((object, index) => {
        const pose = lifecyclePose(object, { frame, fps, scene, width, height, index, total: objects.length });
        if (pose.opacity <= 0.01) return null;
        const size = Math.max(118, Math.min(width * 0.25, height * 0.22));
        const label = objectLabel(object);
        const accent = objectAccent(object);
        return (
          <div
            key={object.id || index}
            style={{
              position: "absolute",
              left: pose.x * width - size / 2,
              top: pose.y * height - size * 0.36,
              width: size,
              transform: `translateY(${pose.yOffset}px) rotate(${pose.rotate}deg) scale(${pose.scale})`,
              transformOrigin: "50% 65%",
              opacity: pose.opacity,
              zIndex: object.z ?? 20 + index,
              filter: pose.blur > 0.25 ? `blur(${pose.blur.toFixed(2)}px)` : undefined
            }}
          >
            <Card
              elevation="mid"
              radius={18}
              style={{
                padding: `${height * 0.014}px ${width * 0.018}px`,
                background: "#fffdf8",
                border: `3px solid ${INK.primary}`,
                boxShadow: `10px 12px 0 rgba(26,26,24,0.15), 0 0 ${pose.glow * 26}px ${accent}`
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: height * 0.006 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: accent, flexShrink: 0 }} />
                <span style={{ fontFamily: FONTS.sans, fontSize: height * 0.011, fontWeight: 900, color: INK.muted, textTransform: "uppercase", letterSpacing: 0 }}>
                  {object.role || "object"}
                </span>
              </div>
              <div style={{ fontFamily: FONTS.serif, fontSize: height * 0.021, lineHeight: 1.05, fontWeight: 900, color: INK.primary, wordBreak: "break-word" }}>
                {label}
              </div>
              {object.ref ? (
                <div style={{ marginTop: height * 0.006, fontFamily: FONTS.sans, fontSize: height * 0.01, lineHeight: 1.1, fontWeight: 800, color: INK.muted, wordBreak: "break-word" }}>
                  {object.ref}
                </div>
              ) : null}
            </Card>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

function lifecyclePose(object, { frame, fps, scene, width, height, index, total }) {
  const base = defaultObjectPose(index, total);
  const pose = { ...base, opacity: 0, scale: 0.86, rotate: base.rotate, yOffset: height * 0.04, glow: 0, blur: 2.5 };
  const states = object.states ?? [];
  if (!states.length) return pose;

  for (const state of states) {
    const start = state.at - scene.start;
    if (frame < start * fps) break;
    const duration = state.duration ?? 0.35;
    const p = lifecycleProgress(frame, fps, start, duration, state.state);
    if (state.state === "enter") {
      pose.opacity = p;
      pose.scale = 0.86 + p * 0.14;
      pose.yOffset = (1 - p) * height * 0.04;
      pose.blur = (1 - p) * 2.5;
    } else if (state.state === "settle") {
      pose.opacity = 1;
      pose.scale *= 1 + Math.sin(p * Math.PI) * 0.018;
      pose.yOffset *= 1 - p;
      pose.blur *= 1 - p;
    } else if (state.state === "transform" || state.state === "connect") {
      const target = targetPose(state.to, pose);
      pose.x = mix(pose.x, target.x, p);
      pose.y = mix(pose.y, target.y, p);
      pose.scale = mix(pose.scale, target.scale, p);
      pose.rotate = mix(pose.rotate, target.rotate, p);
      pose.opacity = mix(pose.opacity || 1, target.opacity, p);
      pose.glow = Math.max(pose.glow, Math.sin(p * Math.PI) * (state.state === "connect" ? 0.55 : 0.35));
    } else if (state.state === "emphasize") {
      pose.opacity = Math.max(pose.opacity, 1);
      pose.scale *= 1 + Math.sin(p * Math.PI) * 0.08;
      pose.glow = Math.max(pose.glow, Math.sin(p * Math.PI));
    } else if (state.state === "exit") {
      pose.opacity = 1 - p;
      pose.scale *= 1 - p * 0.08;
      pose.yOffset = -p * height * 0.045;
      pose.blur = p * 1.8;
    }
  }
  return pose;
}

function lifecycleProgress(frame, fps, startSeconds, durationSeconds, state) {
  const easing = state === "exit" ? Easing.bezier(0.45, 0, 0.55, 1) : Easing.bezier(0.16, 1, 0.3, 1);
  return interpolate(frame, [startSeconds * fps, (startSeconds + durationSeconds) * fps], [0, 1], {
    easing,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
}

function defaultObjectPose(index, total) {
  const spread = total <= 1 ? 0 : (index / (total - 1) - 0.5) * 0.34;
  return {
    x: clampRange(0.5 + spread, 0.12, 0.88),
    y: 0.68 - (index % 2) * 0.08,
    scale: 1,
    rotate: (index % 2 === 0 ? -1 : 1) * (2 + index * 0.6),
    opacity: 1
  };
}

function targetPose(target, current) {
  const value = target && typeof target === "object" ? target : {};
  return {
    x: clampRange(numberOr(value.x, current.x), 0.08, 0.92),
    y: clampRange(numberOr(value.y, current.y), 0.12, 0.88),
    scale: clampRange(numberOr(value.scale, current.scale), 0.5, 1.8),
    rotate: numberOr(value.rotate, current.rotate),
    opacity: clampRange(numberOr(value.opacity, current.opacity || 1), 0, 1)
  };
}

function objectLabel(object) {
  const raw = object.label || object.object_type || object.ref || object.id || "motion object";
  return String(raw).replace(/[_-]+/g, " ");
}

function objectAccent(object) {
  const value = `${object.role ?? ""} ${object.ref ?? ""} ${object.object_type ?? ""}`.toLowerCase();
  if (value.includes("warning") || value.includes("risk")) return SEMANTIC.coral;
  if (value.includes("chart") || value.includes("proof") || value.includes("success")) return SEMANTIC.mint;
  if (value.includes("diagram") || value.includes("connector")) return SEMANTIC.purple;
  return SEMANTIC.mint;
}

function ChartScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = calmEnter(frame, fps, 0.38);
  const data = scene.data ?? [];
  const maxValue = Math.max(1, ...data.map((point) => Number(point.value) || 0));
  const cardW = width * 0.82;
  const cardH = height * 0.58;
  const plotH = cardH * 0.54;
  const labelSize = Math.round(height * 0.018);
  const titleSize = Math.round(height * 0.034);
  return (
    <AbsoluteFill style={{ display: "grid", placeItems: "center", paddingTop: height * 0.05 }}>
      <div style={{ width: cardW, transform: `translateY(${(1 - enter) * height * 0.035}px) scale(${0.96 + enter * 0.04})`, opacity: Math.min(1, enter * 1.2) }}>
        <Card elevation="high" radius={28} style={{ padding: width * 0.055, background: "#fffdf8" }}>
          <div style={{ fontFamily: FONTS.serif, fontWeight: 900, fontSize: titleSize, color: INK.primary, lineHeight: 1.05 }}>
            {scene.title || scene.chart_type}
          </div>
          <div style={{ marginTop: height * 0.018, fontFamily: FONTS.sans, fontSize: labelSize, fontWeight: 800, color: INK.muted }}>
            {scene.y_label || "value"} / {scene.x_label || "label"}
          </div>
          <ChartBody scene={scene} data={data} maxValue={maxValue} frame={frame} fps={fps} width={width} height={height} plotH={plotH} labelSize={labelSize} />
          <div style={{ marginTop: height * 0.02, display: "flex", justifyContent: "space-between", gap: 18, fontFamily: FONTS.sans, fontSize: labelSize * 0.82, fontWeight: 800, color: INK.muted }}>
            <span>{scene.chart_type}</span>
            <span>{scene.source || scene.claim_status}</span>
          </div>
        </Card>
      </div>
    </AbsoluteFill>
  );
}

function ChartBody({ scene, data, maxValue, frame, fps, width, height, plotH, labelSize }) {
  if (scene.chart_type === "donut") return <DonutChartBody scene={scene} data={data} frame={frame} fps={fps} width={width} height={height} plotH={plotH} labelSize={labelSize} />;
  if (scene.chart_type === "gauge") return <GaugeChartBody scene={scene} data={data} frame={frame} fps={fps} width={width} height={height} plotH={plotH} labelSize={labelSize} />;
  if (scene.chart_type === "line" || scene.chart_type === "area" || scene.chart_type === "sparkline" || scene.chart_type === "scatter") {
    return <PathChartBody scene={scene} data={data} maxValue={maxValue} frame={frame} fps={fps} width={width} height={height} plotH={plotH} labelSize={labelSize} />;
  }
  if (scene.chart_type === "comparison_table") return <ComparisonTableBody scene={scene} data={data} frame={frame} fps={fps} height={height} labelSize={labelSize} />;
  if (scene.chart_type === "stat_counter") return <StatChartBody scene={scene} data={data} frame={frame} fps={fps} height={height} plotH={plotH} labelSize={labelSize} />;
  if (scene.chart_type === "matrix") return <MatrixChartBody scene={scene} data={data} maxValue={maxValue} frame={frame} fps={fps} height={height} plotH={plotH} labelSize={labelSize} />;
  return <BarChartBody scene={scene} data={data} maxValue={maxValue} frame={frame} fps={fps} width={width} height={height} plotH={plotH} labelSize={labelSize} horizontal={scene.chart_type === "funnel"} />;
}

function BarChartBody({ scene, data, maxValue, frame, fps, width, height, plotH, labelSize, horizontal = false }) {
  if (horizontal) {
    return (
      <div style={{ height: plotH, marginTop: height * 0.038, display: "flex", flexDirection: "column", justifyContent: "center", gap: height * 0.014 }}>
        {data.map((point, index) => {
          const p = chartPointProgress(frame, fps, point.at, scene.start);
          const value = Number(point.value) || 0;
          const barWidth = `${Math.max(8, (value / maxValue) * 100 * p)}%`;
          return (
            <div key={index} style={{ display: "grid", gridTemplateColumns: "28% 1fr auto", alignItems: "center", gap: 10, opacity: Math.min(1, p * 1.2) }}>
              <span style={{ fontFamily: FONTS.sans, fontSize: labelSize * 0.78, fontWeight: 900, color: INK.muted, lineHeight: 1.1 }}>{point.label}</span>
              <span style={{ height: height * 0.034, borderRadius: 999, background: "rgba(26,26,24,0.08)", overflow: "hidden" }}>
                <span style={{ display: "block", width: barWidth, height: "100%", borderRadius: 999, background: point.color ? semanticColor(point.color) : SEMANTIC.mint, boxShadow: "6px 0 0 rgba(26,26,24,0.14)" }} />
              </span>
              <span style={{ fontFamily: FONTS.sans, fontSize: labelSize * 0.82, fontWeight: 900, color: INK.primary }}>{value}</span>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div style={{ height: plotH, marginTop: height * 0.038, display: "flex", alignItems: "flex-end", gap: Math.max(8, width * 0.012), borderLeft: `3px solid ${INK.primary}`, borderBottom: `3px solid ${INK.primary}`, padding: `${height * 0.018}px ${width * 0.018}px 0` }}>
      {data.map((point, index) => {
        const p = chartPointProgress(frame, fps, point.at, scene.start);
        const value = Number(point.value) || 0;
        const barHeight = Math.max(6, (value / maxValue) * (plotH * 0.82) * p);
        return (
          <div key={index} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div style={{ fontFamily: FONTS.sans, fontSize: labelSize * 0.95, fontWeight: 900, color: point.color ? semanticColor(point.color) : INK.primary, opacity: p }}>
              {value}
            </div>
            <div style={{ width: "100%", maxWidth: 72, height: barHeight, borderRadius: "12px 12px 4px 4px", background: point.color ? semanticColor(point.color) : SEMANTIC.mint, boxShadow: "8px 10px 0 rgba(26,26,24,0.16)", transform: `translateY(${(1 - p) * 16}px)` }} />
            <div style={{ fontFamily: FONTS.sans, fontSize: labelSize * 0.82, fontWeight: 800, color: INK.muted, textAlign: "center", minHeight: labelSize * 2.2, lineHeight: 1.1 }}>
              {point.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PathChartBody({ scene, data, maxValue, frame, fps, width, height, plotH, labelSize }) {
  const pad = { left: width * 0.04, right: width * 0.025, top: height * 0.018, bottom: height * 0.04 };
  const plotW = width * 0.68;
  const points = data.map((point, index) => ({
    ...point,
    x: pad.left + (data.length <= 1 ? 0.5 : index / (data.length - 1)) * (plotW - pad.left - pad.right),
    y: pad.top + (1 - (Number(point.value) || 0) / maxValue) * (plotH - pad.top - pad.bottom)
  }));
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const area = path ? `${path} L ${points[points.length - 1].x} ${plotH - pad.bottom} L ${points[0].x} ${plotH - pad.bottom} Z` : "";
  const firstAt = points[0]?.at ?? scene.start;
  const draw = chartPointProgress(frame, fps, firstAt, scene.start, 0.75);
  const clipId = `chart-clip-${scene.id}`;
  const isScatter = scene.chart_type === "scatter";
  return (
    <div style={{ height: plotH, marginTop: height * 0.038, borderLeft: `3px solid ${INK.primary}`, borderBottom: `3px solid ${INK.primary}`, position: "relative" }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${plotW} ${plotH}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <defs>
          <clipPath id={clipId}><rect x="0" y="0" width={plotW * draw} height={plotH} /></clipPath>
        </defs>
        {scene.chart_type === "area" && area ? <path d={area} clipPath={`url(#${clipId})`} fill="rgba(79,174,133,0.18)" /> : null}
        {!isScatter && path ? <path d={path} clipPath={`url(#${clipId})`} fill="none" stroke={SEMANTIC.mint} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" /> : null}
        {points.map((point, index) => {
          const p = chartPointProgress(frame, fps, point.at, scene.start);
          return <circle key={index} cx={point.x} cy={point.y} r={(isScatter ? 9 : 6) * p} fill={point.color ? semanticColor(point.color) : SEMANTIC.mint} stroke={INK.primary} strokeWidth={isScatter ? 2 : 0} opacity={Math.min(1, p * 1.2)} />;
        })}
      </svg>
      {points.map((point, index) => {
        const p = chartPointProgress(frame, fps, point.at, scene.start);
        return (
          <div key={index} style={{ position: "absolute", left: `${(point.x / plotW) * 100}%`, bottom: -labelSize * 2.5, transform: "translateX(-50%)", maxWidth: width * 0.13, textAlign: "center", fontFamily: FONTS.sans, fontSize: labelSize * 0.72, fontWeight: 800, color: INK.muted, lineHeight: 1.05, opacity: p }}>
            {point.label}
          </div>
        );
      })}
    </div>
  );
}

function DonutChartBody({ scene, data, frame, fps, width, height, plotH, labelSize }) {
  const total = Math.max(1, data.reduce((sum, point) => sum + (Number(point.value) || 0), 0));
  const size = Math.min(plotH, width * 0.46);
  const radius = size * 0.34;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div style={{ height: plotH, marginTop: height * 0.038, display: "grid", gridTemplateColumns: "1fr 1fr", alignItems: "center", gap: width * 0.03 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ justifySelf: "center" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(26,26,24,0.08)" strokeWidth={size * 0.12} />
        {data.map((point, index) => {
          const value = Number(point.value) || 0;
          const length = (value / total) * circumference;
          const p = chartPointProgress(frame, fps, point.at, scene.start);
          const stroke = point.color ? semanticColor(point.color) : [SEMANTIC.mint, SEMANTIC.purple, SEMANTIC.coral][index % 3];
          const dashOffset = -offset;
          offset += length;
          return <circle key={index} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={stroke} strokeWidth={size * 0.12} strokeLinecap="round" strokeDasharray={`${length * p} ${circumference}`} strokeDashoffset={dashOffset} transform={`rotate(-90 ${size / 2} ${size / 2})`} />;
        })}
        <text x="50%" y="51%" dominantBaseline="middle" textAnchor="middle" style={{ fontFamily: FONTS.serif, fontWeight: 900, fontSize: size * 0.18, fill: INK.primary }}>{total}</text>
      </svg>
      <ChartLegend scene={scene} data={data} frame={frame} fps={fps} labelSize={labelSize} />
    </div>
  );
}

function GaugeChartBody({ scene, data, frame, fps, width, height, plotH, labelSize }) {
  const point = data[0] ?? { label: "", value: 0, at: scene.start };
  const value = Number(point.value) || 0;
  const pct = clampRange(value / 100, 0, 1);
  const p = chartPointProgress(frame, fps, point.at, scene.start, 0.75);
  const size = Math.min(plotH * 1.15, width * 0.55);
  const radius = size * 0.34;
  const circumference = 2 * Math.PI * radius;
  return (
    <div style={{ height: plotH, marginTop: height * 0.038, display: "grid", placeItems: "center" }}>
      <svg width={size} height={size * 0.72} viewBox={`0 0 ${size} ${size * 0.72}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(26,26,24,0.1)" strokeWidth={size * 0.1} strokeDasharray={`${circumference * 0.5} ${circumference}`} strokeLinecap="round" transform={`rotate(180 ${size / 2} ${size / 2})`} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={point.color ? semanticColor(point.color) : SEMANTIC.mint} strokeWidth={size * 0.1} strokeDasharray={`${circumference * 0.5 * pct * p} ${circumference}`} strokeLinecap="round" transform={`rotate(180 ${size / 2} ${size / 2})`} />
        <text x="50%" y="66%" dominantBaseline="middle" textAnchor="middle" style={{ fontFamily: FONTS.serif, fontWeight: 900, fontSize: size * 0.18, fill: INK.primary }}>{value}</text>
        <text x="50%" y="84%" dominantBaseline="middle" textAnchor="middle" style={{ fontFamily: FONTS.sans, fontWeight: 800, fontSize: labelSize, fill: INK.muted }}>{point.label}</text>
      </svg>
    </div>
  );
}

function ComparisonTableBody({ scene, data, frame, fps, height, labelSize }) {
  return (
    <div style={{ marginTop: height * 0.032, display: "grid", gap: height * 0.012 }}>
      {data.slice(0, 6).map((point, index) => {
        const p = chartPointProgress(frame, fps, point.at, scene.start);
        return (
          <div key={index} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 14, alignItems: "center", padding: `${height * 0.014}px ${height * 0.016}px`, borderRadius: 14, background: index % 2 ? "rgba(26,26,24,0.04)" : "rgba(79,174,133,0.1)", transform: `translateY(${(1 - p) * 14}px)`, opacity: p }}>
            <span style={{ fontFamily: FONTS.sans, fontWeight: 900, fontSize: labelSize, color: INK.primary }}>{point.label}</span>
            <span style={{ fontFamily: FONTS.serif, fontWeight: 900, fontSize: labelSize * 1.35, color: point.color ? semanticColor(point.color) : SEMANTIC.mint }}>{point.value}</span>
          </div>
        );
      })}
    </div>
  );
}

function StatChartBody({ scene, data, frame, fps, height, plotH, labelSize }) {
  const point = data[0] ?? { label: scene.title, value: 0, at: scene.start };
  const p = chartPointProgress(frame, fps, point.at, scene.start, 0.7);
  return (
    <div style={{ height: plotH, marginTop: height * 0.026, display: "grid", placeItems: "center", textAlign: "center" }}>
      <div style={{ transform: `translateY(${(1 - p) * 18}px) scale(${0.92 + p * 0.08})`, opacity: p }}>
        <div style={{ fontFamily: FONTS.serif, fontWeight: 900, fontSize: height * 0.105, lineHeight: 0.9, color: point.color ? semanticColor(point.color) : SEMANTIC.mint, textShadow: TYPE_SHADOW }}>{point.value}</div>
        <div style={{ marginTop: height * 0.012, fontFamily: FONTS.sans, fontWeight: 900, fontSize: labelSize * 1.1, color: INK.muted }}>{point.label}</div>
      </div>
    </div>
  );
}

function MatrixChartBody({ scene, data, maxValue, frame, fps, height, plotH, labelSize }) {
  return (
    <div style={{ height: plotH, marginTop: height * 0.038, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: height * 0.012 }}>
      {data.slice(0, 16).map((point, index) => {
        const p = chartPointProgress(frame, fps, point.at, scene.start);
        const strength = clampRange((Number(point.value) || 0) / maxValue, 0.15, 1);
        return (
          <div key={index} style={{ borderRadius: 14, padding: height * 0.012, background: point.color ? semanticColor(point.color) : `rgba(79,174,133,${0.18 + strength * 0.55})`, border: `2px solid rgba(26,26,24,${0.2 + strength * 0.25})`, transform: `scale(${0.88 + p * 0.12})`, opacity: p }}>
            <div style={{ fontFamily: FONTS.sans, fontWeight: 900, fontSize: labelSize * 0.75, color: INK.primary, lineHeight: 1.05 }}>{point.label}</div>
            <div style={{ marginTop: 4, fontFamily: FONTS.serif, fontWeight: 900, fontSize: labelSize * 1.05, color: INK.primary }}>{point.value}</div>
          </div>
        );
      })}
    </div>
  );
}

function ChartLegend({ scene, data, frame, fps, labelSize }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {data.slice(0, 6).map((point, index) => {
        const p = chartPointProgress(frame, fps, point.at, scene.start);
        const color = point.color ? semanticColor(point.color) : [SEMANTIC.mint, SEMANTIC.purple, SEMANTIC.coral][index % 3];
        return (
          <div key={index} style={{ display: "flex", alignItems: "center", gap: 9, opacity: p, transform: `translateX(${(1 - p) * 12}px)` }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: color, flexShrink: 0 }} />
            <span style={{ fontFamily: FONTS.sans, fontWeight: 900, fontSize: labelSize * 0.84, color: INK.primary }}>{point.label}</span>
            <span style={{ marginLeft: "auto", fontFamily: FONTS.sans, fontWeight: 900, fontSize: labelSize * 0.84, color: INK.muted }}>{point.value}</span>
          </div>
        );
      })}
    </div>
  );
}

function chartPointProgress(frame, fps, at, sceneStart, seconds = 0.42) {
  return frame - (at - sceneStart) * fps < 0 ? 0 : calmEnter(frame - (at - sceneStart) * fps, fps, seconds);
}

function DiagramScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = calmEnter(frame, fps, 0.34);
  const board = { left: width * 0.08, top: height * 0.15, width: width * 0.84, height: height * 0.66 };
  const nodes = scene.nodes ?? [];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const point = (node) => ({ x: board.left + node.x * board.width, y: board.top + node.y * board.height });
  const nodeW = width * 0.24;
  const nodeH = height * 0.075;
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: board.left, top: height * 0.075, width: board.width, fontFamily: FONTS.serif, fontWeight: 900, fontSize: height * 0.038, color: INK.primary, transform: `translateY(${(1 - enter) * 20}px)`, opacity: enter }}>
        {scene.title || scene.diagram_type}
      </div>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        {(scene.connectors ?? []).map((connector, index) => {
          const from = nodeMap.get(connector.from);
          const to = nodeMap.get(connector.to);
          if (!from || !to) return null;
          const localFrame = frame - (connector.at - scene.start) * fps;
          const p = localFrame < 0 ? 0 : calmEnter(localFrame, fps, 0.46);
          const a = point(from);
          const b = point(to);
          const color = connector.style === "warning" ? SEMANTIC.coral : connector.style === "success" ? SEMANTIC.mint : INK.primary;
          const dash = connector.style === "dotted" || connector.style === "loopback" ? "10 10" : undefined;
          const x2 = a.x + (b.x - a.x) * p;
          const y2 = a.y + (b.y - a.y) * p;
          return (
            <g key={index} opacity={Math.min(1, p * 1.2)}>
              <line x1={a.x} y1={a.y} x2={x2} y2={y2} stroke={color} strokeWidth={5} strokeDasharray={dash} strokeLinecap="round" />
              <circle cx={x2} cy={y2} r={7 * p} fill={color} />
            </g>
          );
        })}
      </svg>
      {nodes.map((node, index) => {
        const localFrame = frame - (node.at - scene.start) * fps;
        const p = localFrame < 0 ? 0 : calmEnter(localFrame, fps, 0.42);
        const pos = point(node);
        const color = node.color ? semanticColor(node.color) : INK.primary;
        return (
          <div
            key={node.id}
            style={{
              position: "absolute",
              left: pos.x - nodeW / 2,
              top: pos.y - nodeH / 2,
              width: nodeW,
              minHeight: nodeH,
              transform: `translateY(${(1 - p) * 34}px) scale(${0.88 + p * 0.12})`,
              opacity: Math.min(1, p * 1.15)
            }}
          >
            <Card elevation="mid" radius={22} style={{ padding: `${height * 0.016}px ${width * 0.02}px`, background: node.color ? color : "#fffdf8", border: `3px solid ${INK.primary}` }}>
              <div style={{ fontFamily: FONTS.sans, fontSize: height * 0.019, lineHeight: 1.1, fontWeight: 900, textAlign: "center", color: node.color ? INK.primary : color }}>
                {node.label}
              </div>
            </Card>
          </div>
        );
      })}
    </AbsoluteFill>
  );
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
  if (scene.layout === "window") {
    return <PresenterWindowScene scene={scene} width={width} height={height} />;
  }
  // split: face bottom ~52%, graphics unfold on the paper above.
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: height * 0.52, overflow: "hidden" }}>{video}</div>
      <WordBuild scene={scene} width={width} height={height} region={{ top: 0.05, height: 0.38 }} />
    </AbsoluteFill>
  );
}

function PresenterWindowScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = calmEnter(frame, fps, 0.32);
  const sceneFrames = Math.max(1, (scene.end - scene.start) * fps);
  const exit = interpolate(frame, [Math.max(0, sceneFrames - fps * 0.28), sceneFrames], [0, 1], {
    easing: Easing.bezier(0.45, 0, 0.55, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const presence = enter * (1 - exit);
  const box = presenterWindowBox(scene.window, width, height);
  const drift = interpolate(frame, [0, sceneFrames], [-0.01, 0.012], {
    easing: Easing.bezier(0.45, 0, 0.55, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          transform: [
            `translate(${drift * width}px, ${(1 - presence) * height * 0.035}px)`,
            `scale(${0.94 + presence * 0.06})`
          ].join(" "),
          transformOrigin: "50% 70%",
          opacity: Math.min(1, presence * 1.35)
        }}
      >
        <Card elevation="high" radius={24} style={{ width: "100%", height: "100%", overflow: "hidden", background: CARD.dark }}>
          <OffthreadVideo
            muted
            src={resolveSrc(scene.src)}
            trimBefore={Math.round((scene.offset ?? 0) * fps)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </Card>
      </div>
      <WordBuild scene={scene} width={width} height={height} region={windowTextRegion(scene.window)} />
    </AbsoluteFill>
  );
}

function presenterWindowBox(config, width, height) {
  const window = config ?? { position: "lower", width: 0.82, x: null, y: null };
  const boxWidth = width * (window.width ?? 0.82);
  const boxHeight = boxWidth * 9 / 16;
  const fallback = {
    lower: { x: 0.5, y: 0.7 },
    upper: { x: 0.5, y: 0.28 },
    left: { x: 0.31, y: 0.56 },
    right: { x: 0.69, y: 0.56 },
    center: { x: 0.5, y: 0.5 }
  }[window.position ?? "lower"];
  const centerX = width * (window.x ?? fallback.x);
  const centerY = height * (window.y ?? fallback.y);
  return {
    width: boxWidth,
    height: boxHeight,
    left: Math.max(width * 0.04, Math.min(width - boxWidth - width * 0.04, centerX - boxWidth / 2)),
    top: Math.max(height * 0.1, Math.min(height - boxHeight - height * 0.05, centerY - boxHeight / 2))
  };
}

function windowTextRegion(config) {
  const position = config?.position ?? "lower";
  if (position === "upper") return { top: 0.54, height: 0.32 };
  if (position === "left" || position === "right") return { top: 0.12, height: 0.28 };
  return { top: 0.1, height: 0.34 };
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
        const enter = localFrame < 0 ? 0 : calmEnter(localFrame, fps, 0.46);
        const enterPrev = localFrame < 1 ? 0 : calmEnter(localFrame - 1, fps, 0.46);
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
        const pulseP = item.color && emphasised ? clamp(calmEnter(localFrame - colorDelay, fps, 0.28)) : 0;
        const pulse = 1 + 0.035 * Math.sin(pulseP * Math.PI);
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
                `translateY(${WORD_OFFSETS[index % WORD_OFFSETS.length] * base + (1 - enter) * base * 0.28}px)`,
                `scale(${(0.96 + enter * 0.04) * pulse})`
              ].join(" "),
              opacity: Math.min(1, enter * 1.12),
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
  const enter = calmEnter(frame, fps, 0.56);
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
    if (local >= 0) textArea += lineHeight * calmEnter(local, fps, 0.32);
  }
  // The send press: the arrow dips and rebounds the moment the prompt is done.
  const pressP = calmEnter(frame - (typeStart + typeSpan + 0.12) * fps, fps, 0.22);
  const arrowScale = 1 - 0.12 * Math.sin(clamp(pressP) * Math.PI);
  const radius = fontSize * 2.3;
  const drift = focalDrift({ frame, fps, seconds: sceneLength, zoom: 0.1, pan: 0.03 });
  return (
    <AbsoluteFill style={{ display: "grid", placeItems: "center", padding: `0 ${width * 0.07}px` }}>
      <div
        style={{
          width: "100%",
          transform: `translate(${drift.panX * width}px, ${(1 - enter) * height * 0.035}px) scale(${drift.scale})`,
          opacity: Math.min(1, enter * 1.08)
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
  if (scene.variant === "orbit") return <IconFlowOrbitScene scene={scene} width={width} height={height} />;
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
    return localFrame < 0 ? 0 : calmEnter(localFrame, fps, 0.48);
  });
  const { centers } = stackLayout({ sizes, presences });
  return (
    <AbsoluteFill style={{ display: "grid", placeItems: "center" }}>
      <div style={{ position: "relative", width: "100%", height: 0 }}>
        {scene.items.map((item, index) => {
          const enter = presences[index];
          if (enter <= 0) return null;
          const depthBlur = enter < 0.75 ? (1 - enter) * 2.4 : 0;
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
                    opacity: Math.min(1, enter * 1.12),
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
                  transform: `scale(${0.9 + enter * 0.1})`,
                  opacity: Math.min(1, enter * 1.15),
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

function IconFlowOrbitScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const slots = [
    { x: 0.5, y: 0.24 },
    { x: 0.24, y: 0.46 },
    { x: 0.76, y: 0.46 },
    { x: 0.34, y: 0.7 },
    { x: 0.66, y: 0.7 }
  ];
  const iconSize = Math.round(width * 0.16);
  const labelSize = Math.round(height * 0.025);
  const presences = scene.items.map((item) => {
    const localFrame = frame - (item.at - scene.start) * fps;
    return localFrame < 0 ? 0 : calmEnter(localFrame, fps, 0.56);
  });
  const drift = focalDrift({ frame, fps, seconds: scene.end - scene.start, zoom: 0.035, pan: 0.01 });
  return (
    <AbsoluteFill style={{ transform: `translateX(${drift.panX * width}px) scale(${drift.scale})` }}>
      {scene.items.map((item, index) => {
        if (index === 0) return null;
        const from = slots[(index - 1) % slots.length];
        const to = slots[index % slots.length];
        const enter = presences[index];
        if (enter <= 0) return null;
        return <FlowConnector key={`connector-${index}`} from={from} to={to} width={width} height={height} progress={enter} />;
      })}
      {scene.items.map((item, index) => {
        const slot = slots[index % slots.length];
        const enter = presences[index];
        if (enter <= 0) return null;
        const localFrame = frame - (item.at - scene.start) * fps;
        const blur = entranceBlur(enter, localFrame < 1 ? 0 : calmEnter(localFrame - 1, fps, 0.56));
        return (
          <div
            key={index}
            style={{
              position: "absolute",
              left: slot.x * width,
              top: slot.y * height,
              width: width * 0.28,
              transform: `translate(-50%, -50%) translateY(${(1 - enter) * height * 0.035}px) scale(${0.92 + enter * 0.08})`,
              opacity: Math.min(1, enter * 1.08),
              filter: blur,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: labelSize * 0.36
            }}
          >
            <Card dark radius={iconSize * 0.22} elevation="mid" style={{ width: iconSize, height: iconSize, display: "grid", placeItems: "center", padding: iconSize * 0.2 }}>
              {item.src ? <Img src={resolveSrc(item.src)} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <div style={{ width: iconSize * 0.28, height: iconSize * 0.28, borderRadius: "50%", background: INK.onDark }} />}
            </Card>
            <div style={{ fontFamily: FONTS.serif, fontWeight: 900, fontSize: labelSize, lineHeight: 1.04, color: item.color ? semanticColor(item.color) : INK.primary, textAlign: "center", textShadow: TYPE_SHADOW }}>
              {item.text}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

function FlowConnector({ from, to, width, height, progress }) {
  const x1 = from.x * width;
  const y1 = from.y * height;
  const x2 = to.x * width;
  const y2 = to.y * height;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  return (
    <div
      style={{
        position: "absolute",
        left: x1,
        top: y1,
        width: length * progress,
        borderTop: `3px dashed rgba(26,26,24,0.42)`,
        transform: `rotate(${angle}rad)`,
        transformOrigin: "0 50%",
        opacity: Math.min(1, progress * 1.2)
      }}
    />
  );
}

// Numbered chips with drawn thickness, stacking as each is spoken. The stack
// reflows: every chip's slot grows with its entrance spring, so chips already
// on screen glide apart to make room instead of jumping when one lands.
function CardStepsScene({ scene, width, height }) {
  if (scene.variant === "rail") return <CardStepsRailScene scene={scene} width={width} height={height} />;
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
    return localFrame < 0 ? 0 : calmEnter(localFrame, fps, 0.44);
  });
  const { centers } = stackLayout({ sizes: entries.map((entry) => entry.size), presences, gap });
  return (
    <AbsoluteFill style={{ display: "grid", placeItems: "center", padding: `0 ${width * 0.1}px` }}>
      <div style={{ position: "relative", width: "100%", height: 0 }}>
        {entries.map((entry, position) => {
          const enter = presences[position];
          if (enter <= 0) return null;
          const localFrame = frame - (entry.at - scene.start) * fps;
          const motionBlur = entranceBlur(enter, localFrame < 1 ? 0 : calmEnter(localFrame - 1, fps, 0.44));
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
                  transform: `translateY(-50%) translateY(${(1 - enter) * height * 0.026}px) rotate(-2deg)`,
                  opacity: Math.min(1, enter * 1.1),
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
                transform: `translateY(-50%) translateY(${(1 - enter) * height * 0.03}px) rotate(${tilt}deg)`,
                opacity: Math.min(1, enter * 1.1),
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

function CardStepsRailScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fontSize = Math.round(height * 0.023);
  const titleSize = Math.round(height * 0.034);
  const cardWidth = width * 0.43;
  const cardHeight = height * 0.082;
  const spineX = width * 0.5;
  const top = height * (scene.title ? 0.26 : 0.2);
  const available = height * 0.56;
  const stepGap = scene.items.length > 1 ? available / (scene.items.length - 1) : 0;
  const titleEnter = calmEnter(frame, fps, 0.52);
  return (
    <AbsoluteFill>
      {scene.title ? (
        <div
          style={{
            position: "absolute",
            left: width * 0.08,
            right: width * 0.08,
            top: height * 0.1,
            textAlign: "center",
            fontFamily: FONTS.script,
            fontStyle: "italic",
            fontWeight: 900,
            fontSize: titleSize,
            color: INK.primary,
            transform: `translateY(${(1 - titleEnter) * height * 0.018}px) rotate(-2deg)`,
            opacity: Math.min(1, titleEnter * 1.1)
          }}
        >
          {scene.title}
        </div>
      ) : null}
      <div
        style={{
          position: "absolute",
          left: spineX,
          top,
          height: available,
          borderLeft: `3px dashed rgba(26,26,24,0.34)`,
          transform: "translateX(-50%)",
          opacity: 0.9
        }}
      />
      {scene.items.map((item, index) => {
        const localFrame = frame - (item.at - scene.start) * fps;
        if (localFrame < 0) return null;
        const enter = calmEnter(localFrame, fps, 0.5);
        const enterPrev = localFrame < 1 ? 0 : calmEnter(localFrame - 1, fps, 0.5);
        const y = top + index * stepGap;
        const leftSide = index % 2 === 0;
        const cardX = leftSide ? width * 0.08 : width * 0.49;
        const lineStart = leftSide ? cardX + cardWidth : spineX;
        const lineWidth = Math.abs(spineX - (leftSide ? cardX + cardWidth : cardX));
        const accent = item.color ? semanticColor(item.color) : index === scene.items.length - 1 ? SEMANTIC.mint : INK.primary;
        return (
          <React.Fragment key={index}>
            <div
              style={{
                position: "absolute",
                left: lineStart,
                top: y,
                width: lineWidth * enter,
                borderTop: `3px solid rgba(26,26,24,0.26)`,
                transform: "translateY(-50%)",
                transformOrigin: leftSide ? "100% 50%" : "0 50%",
                opacity: Math.min(1, enter * 1.1)
              }}
            />
            <div
              style={{
                position: "absolute",
                left: spineX,
                top: y,
                width: fontSize * 1.55,
                height: fontSize * 1.55,
                borderRadius: "50%",
                background: accent,
                color: index === scene.items.length - 1 || item.color ? INK.onDark : CARD.paper,
                display: "grid",
                placeItems: "center",
                fontFamily: FONTS.sans,
                fontWeight: 900,
                fontSize: fontSize * 0.62,
                transform: `translate(-50%, -50%) scale(${0.86 + enter * 0.14})`,
                opacity: Math.min(1, enter * 1.15),
                boxShadow: "0 10px 20px rgba(26,26,24,0.18)"
              }}
            >
              {index + 1}
            </div>
            <div
              style={{
                position: "absolute",
                left: cardX,
                top: y,
                width: cardWidth,
                height: cardHeight,
                transform: `translate(${(leftSide ? -1 : 1) * (1 - enter) * width * 0.08}px, -50%) rotate(${(leftSide ? -1 : 1) * WORD_ROTATIONS[index % WORD_ROTATIONS.length] * 0.28 * enter}deg)`,
                opacity: Math.min(1, enter * 1.1),
                filter: entranceBlur(enter, enterPrev)
              }}
            >
              <Card chip elevation="mid" radius={18} style={{ height: "100%", padding: `${fontSize * 0.65}px ${fontSize * 0.8}px`, display: "flex", alignItems: "center" }}>
                <div style={{ fontFamily: FONTS.sans, fontWeight: 850, fontSize, lineHeight: 1.12, color: INK.primary }}>
                  {item.text}
                </div>
              </Card>
            </div>
          </React.Fragment>
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
                <Img src={resolveSrc(item.src)} style={{ width: "100%", height: "100%", objectFit: screenshotObjectFit(item.src), objectPosition: "top" }} />
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
          const enter = calmEnter(localFrame, fps, 0.5);
          const motionBlur = entranceBlur(enter, calmEnter(localFrame - 1, fps, 0.5));
          return (
            <div
              key={index}
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 100 + index,
                filter: motionBlur,
                transform: [
                  `translate(${slot.x * cardWidth * enter}px, ${slot.y * cardWidth * enter + (1 - enter) * height * 0.035}px)`,
                  `rotate(${slot.rot * enter}deg)`,
                  `scale(${slot.scale * (0.94 + enter * 0.06)})`
                ].join(" "),
                opacity: Math.min(1, enter * 1.12)
              }}
            >
              <Card elevation={index === 0 ? "high" : "mid"} radius={18} style={{ width: "100%", height: "100%" }}>
                <Img src={resolveSrc(item.src)} style={{ width: "100%", height: "100%", objectFit: screenshotObjectFit(item.src), objectPosition: "top" }} />
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
  const blur = Math.min(2.4, Math.max(0, enterNow - enterPrev) * 14);
  return blur > 0.25 ? `blur(${blur.toFixed(1)}px)` : undefined;
}

function calmEnter(frame, fps, seconds = 0.28) {
  return interpolate(frame, [0, fps * seconds], [0, 1], {
    easing: Easing.bezier(0.19, 1, 0.22, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
}

// One oversized number rolling up to its value, label beneath. The number is
// the focal element; nothing else shares the frame.
function StatCounterScene({ scene, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = frame - (scene.at - scene.start) * fps;
  if (localFrame < 0) return null;
  const enter = calmEnter(localFrame, fps, 0.55);
  const roll = calmEnter(localFrame, fps, 0.9);
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
      <div style={{ fontFamily: FONTS.script, fontStyle: "italic", fontWeight: 900, fontSize: valueSize, lineHeight: 1, color: semanticColor(scene.color), transform: `scale(${0.92 + enter * 0.08}) rotate(-2deg)`, opacity: Math.min(1, enter * 1.1) }}>
        {display}
      </div>
      {scene.label ? (
        <div style={{ fontFamily: FONTS.serif, fontWeight: 900, fontSize: Math.round(height * 0.032), lineHeight: 1.15, color: INK.primary, textAlign: "center", maxWidth: width * 0.8, transform: `translateY(${(1 - enter) * height * 0.014}px)`, opacity: Math.min(1, enter * 1.08) }}>
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
  const enter = calmEnter(localFrame, fps, 0.55);
  const fontSize = Math.round(height * 0.034);
  const drift = focalDrift({ frame, fps, seconds: scene.end - scene.start, zoom: 0.03, pan: 0.006 });
  return (
    <AbsoluteFill style={{ display: "grid", placeItems: "center", padding: `0 ${width * 0.09}px` }}>
      <div
        style={{
          width: "100%",
          transform: `translate(${drift.panX * width}px, ${(1 - enter) * height * 0.03}px) rotate(-1deg) scale(${drift.scale})`,
          opacity: Math.min(1, enter * 1.08),
          filter: entranceBlur(enter, calmEnter(localFrame - 1, fps, 0.55))
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
  const titleEnter = calmEnter(frame, fps, 0.52);

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
              opacity: Math.min(1, titleEnter * 1.08),
              transform: `translateY(${(1 - titleEnter) * height * 0.022}px) rotate(-2deg)`
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
            const enter = calmEnter(localFrame, fps, 0.46);
            const enterPrev = localFrame < 1 ? 0 : calmEnter(localFrame - 1, fps, 0.46);
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
                    `translateY(${(1 - enter) * height * 0.028}px)`,
                    `rotate(${WORD_ROTATIONS[index % WORD_ROTATIONS.length] * 0.25 * enter}deg)`,
                    `scale(${0.96 + enter * 0.04})`
                  ].join(" "),
                  opacity: Math.min(1, enter * 1.08),
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
  const enter = calmEnter(frame, fps, 0.55);
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
  const statusEnter = statusFrame < 0 ? 0 : calmEnter(statusFrame, fps, 0.34);
  const fontSize = Math.round(height * 0.022);
  const titleSize = Math.round(height * 0.03);

  return (
    <AbsoluteFill style={{ display: "grid", placeItems: "center", padding: `0 ${width * 0.07}px` }}>
      <div
        style={{
          width: "100%",
          transform: `translate(${drift * width}px, ${(1 - enter) * height * 0.028}px) scale(${0.96 + enter * 0.04}) rotate(0.8deg)`,
          opacity: Math.min(1, enter * 1.08),
          filter: entranceBlur(enter, calmEnter(frame - 1, fps, 0.55))
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
                  transform: `translateY(${(1 - statusEnter) * fontSize * 0.85}px) scale(${0.92 + statusEnter * 0.08})`,
                  opacity: Math.min(1, statusEnter * 1.1)
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
  if (value.includes("caption") || value.endsWith(".srt") || value.endsWith(".vtt")) return "TXT";
  if (value.includes("thumb") || value.endsWith(".png") || value.endsWith(".jpg") || value.endsWith(".jpeg")) return "IMG";
  if (value.endsWith(".mp4") || value.endsWith(".mov") || value.endsWith(".webm") || /\bvideo\b/.test(value)) return "MP4";
  if (value.includes("plan") || value.endsWith(".json")) return "JSON";
  if (value.includes("review") || value.endsWith(".md") || value.endsWith(".markdown")) return "MD";
  return "FILE";
}

function semanticColor(name) {
  return SEMANTIC[name] ?? name;
}

function resolveSrc(src) {
  if (/^https?:\/\//.test(src)) return src;
  return staticFile(src);
}

function screenshotObjectFit(src) {
  return String(src || "").toLowerCase().endsWith(".svg") ? "contain" : "cover";
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function clampRange(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function mix(from, to, progress) {
  return from + (to - from) * progress;
}

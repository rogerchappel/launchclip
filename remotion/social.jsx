import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const palette = {
  ink: "#10151f",
  paper: "#f8fafc",
  mint: "#35d0a3",
  coral: "#ff5964",
  amber: "#ffca3a",
  blue: "#4f7cff",
  violet: "#805ad5",
  line: "rgba(16, 21, 31, 0.14)"
};

export function LaunchclipSocial(props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const timeline = normalizedTimeline(props.timeline, props.durationSeconds ?? durationInFrames / fps);
  const beatIndex = activeBeatIndex(timeline, frame / fps);
  const beat = timeline[beatIndex] ?? fallbackBeat(props.repo?.name);
  const localSeconds = frame / fps - beat.start;
  const localFrames = Math.max(0, localSeconds * fps);
  const beatProgress = clamp(localSeconds / Math.max(0.1, beat.duration));
  const totalProgress = clamp(frame / Math.max(1, durationInFrames - 1));
  const intro = spring({ frame: localFrames, fps, config: { damping: 18, stiffness: 140 } });
  const captionPop = spring({ frame: Math.max(0, localFrames - 4), fps, config: { damping: 12, stiffness: 200 } });
  const paletteShift = interpolate(beatIndex % 4, [0, 1, 2, 3], [0, 1, 2, 3]);

  return (
    <AbsoluteFill style={{ backgroundColor: palette.paper, fontFamily: "Inter, Arial, sans-serif", color: palette.ink, overflow: "hidden" }}>
      <MovingBackdrop frame={frame} paletteShift={paletteShift} />
      <TopChrome repo={props.repo} beat={beat} beatIndex={beatIndex} total={timeline.length || 1} progress={totalProgress} />
      <Scene beat={beat} beatIndex={beatIndex} localFrames={localFrames} intro={intro} progress={beatProgress} props={props} />
      <KineticCaption beat={beat} progress={captionPop} />
      <BottomRail timeline={timeline} active={beatIndex} />
    </AbsoluteFill>
  );
}

function MovingBackdrop({ frame, paletteShift }) {
  const drift = Math.sin(frame / 36) * 42;
  const driftB = Math.cos(frame / 44) * 58;
  const colors = [
    ["#f8fafc", "#d7fff1", "#ffe3e6"],
    ["#f9fbff", "#dbe8ff", "#fff0bf"],
    ["#fffdf7", "#e8ddff", "#d7fff1"],
    ["#f8fbff", "#ffe4b8", "#dbe8ff"]
  ][Math.round(paletteShift) % 4];
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 48%, ${colors[2]} 100%)` }} />
      <div style={{ position: "absolute", left: -160 + drift, top: 80, width: 520, height: 520, borderRadius: "50%", background: "rgba(53, 208, 163, 0.34)", filter: "blur(18px)" }} />
      <div style={{ position: "absolute", right: -190 + driftB, bottom: 170, width: 560, height: 560, borderRadius: "50%", background: "rgba(79, 124, 255, 0.28)", filter: "blur(20px)" }} />
      <div style={{ position: "absolute", inset: 0, opacity: 0.18, backgroundImage: "linear-gradient(rgba(16,21,31,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(16,21,31,0.12) 1px, transparent 1px)", backgroundSize: "48px 48px", transform: `translate(${frame % 48}px, ${frame % 48}px)` }} />
    </AbsoluteFill>
  );
}

function TopChrome({ repo, beat, beatIndex, total, progress }) {
  return (
    <div style={{ position: "absolute", left: 42, right: 42, top: 38, display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 20 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: palette.ink, color: palette.paper, display: "grid", placeItems: "center", fontWeight: 900 }}>LC</div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1 }}>{repo?.name ?? "repo"}</div>
          <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.62, textTransform: "uppercase", letterSpacing: 0 }}>{beat.beat}</div>
        </div>
      </div>
      <div style={{ minWidth: 92, border: `2px solid ${palette.ink}`, borderRadius: 999, padding: "8px 12px", background: "rgba(248,250,252,0.72)", textAlign: "center", fontSize: 15, fontWeight: 900 }}>
        {beatIndex + 1}/{total}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 56, height: 6, borderRadius: 999, background: "rgba(16,21,31,0.12)", overflow: "hidden" }}>
        <div style={{ width: `${progress * 100}%`, height: "100%", background: palette.ink }} />
      </div>
    </div>
  );
}

function Scene({ beat, beatIndex, localFrames, intro, progress, props }) {
  if (beat.beat === "cold-open") return <ColdOpen beat={beat} repo={props.repo} intro={intro} progress={progress} />;
  if (beat.beat === "friction") return <Friction beat={beat} intro={intro} progress={progress} />;
  if (beat.beat === "demo-trigger") return <DemoTrigger beat={beat} terminal={props.terminal} intro={intro} progress={progress} localFrames={localFrames} />;
  if (beat.beat === "proof") return <Proof beat={beat} timeline={props.timeline} intro={intro} progress={progress} localFrames={localFrames} />;
  if (beat.beat === "transformation") return <Transformation beat={beat} intro={intro} progress={progress} />;
  if (beat.beat === "artifact-reveal") return <ArtifactReveal beat={beat} artifacts={props.artifacts} intro={intro} progress={progress} localFrames={localFrames} />;
  return <Cta beat={beat} repo={props.repo} intro={intro} progress={progress} beatIndex={beatIndex} />;
}

function ColdOpen({ repo, intro, progress }) {
  const scale = 0.88 + intro * 0.12 + progress * 0.04;
  return (
    <div style={{ position: "absolute", left: 44, right: 44, top: 148, bottom: 296, display: "grid", placeItems: "center", zIndex: 5 }}>
      <div style={{ transform: `scale(${scale}) rotate(${interpolate(progress, [0, 1], [-1.2, 0.6])}deg)`, textAlign: "center" }}>
        <div style={{ display: "inline-block", padding: "12px 18px", borderRadius: 999, background: palette.coral, color: "white", fontSize: 24, fontWeight: 950, marginBottom: 28, boxShadow: "0 20px 60px rgba(255,89,100,0.35)" }}>NEW RECEIPT</div>
        <div style={{ fontSize: 90, lineHeight: 0.92, fontWeight: 950, maxWidth: 620 }}>This repo made its own launch Short.</div>
        <div style={{ marginTop: 32, fontSize: 26, lineHeight: 1.18, fontWeight: 800, opacity: 0.72 }}>{repo?.summary ?? "proof to packet"}</div>
      </div>
      <PresenterOrb side="right" progress={progress} />
    </div>
  );
}

function Friction({ progress }) {
  const items = ["script", "record", "edit", "captions", "review"];
  return (
    <MainStage>
      <BigLabel label="The boring part" />
      <div style={{ display: "grid", gap: 18, marginTop: 36 }}>
        {items.map((item, index) => {
          const visible = clamp((progress * items.length - index) * 1.7);
          return <TaskCard key={item} label={item} index={index + 1} visible={visible} crossed={visible > 0.72} />;
        })}
      </div>
      <TimerPill progress={progress} label="manual launch work" />
    </MainStage>
  );
}

function DemoTrigger({ terminal, progress, localFrames }) {
  const lines = String(terminal ?? "").split("\n").filter(Boolean).slice(0, 5);
  return (
    <MainStage>
      <BigLabel label="Run the demo" />
      <div style={{ marginTop: 46, borderRadius: 28, background: "#111827", color: "#f8fafc", padding: 28, minHeight: 390, boxShadow: "0 28px 70px rgba(17,24,39,0.34)", transform: `translateY(${(1 - progress) * 22}px)` }}>
        <div style={{ display: "flex", gap: 9, marginBottom: 24 }}>
          <Dot color="#ff5964" /><Dot color="#ffca3a" /><Dot color="#35d0a3" />
        </div>
        {lines.map((line, index) => (
          <div key={`${line}-${index}`} style={{ fontFamily: "SFMono-Regular, Menlo, Consolas, monospace", fontSize: index === 0 ? 24 : 20, lineHeight: 1.45, opacity: clamp((localFrames - index * 8) / 10), color: index === 0 ? palette.mint : "#d9e4f2" }}>
            {line}
          </div>
        ))}
      </div>
      <ProofBadge progress={progress} />
    </MainStage>
  );
}

function Proof({ timeline, progress, localFrames }) {
  const visible = Math.min(4, Math.max(1, Math.floor(progress * 5)));
  const rows = (timeline ?? []).slice(0, 4);
  return (
    <MainStage>
      <BigLabel label="Script + visuals align" />
      <div style={{ marginTop: 42, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {rows.map((row, index) => (
          <React.Fragment key={row.beat ?? index}>
            <MiniPanel title={row.caption ?? row.beat} text={row.voiceover ?? ""} active={index < visible} side="script" />
            <MiniPanel title={row.beat ?? "visual"} text={row.visual ?? ""} active={index < visible} side="visual" />
          </React.Fragment>
        ))}
      </div>
      <div style={{ position: "absolute", left: 330, top: 260, bottom: 190, width: 7, borderRadius: 999, background: palette.ink, transform: `scaleY(${clamp(localFrames / 42)})`, transformOrigin: "top" }} />
    </MainStage>
  );
}

function Transformation({ progress }) {
  const tiles = ["clip plan", "captions", "thumbnail", "review packet"];
  return (
    <MainStage>
      <BigLabel label="One packet" />
      <div style={{ position: "relative", height: 610, marginTop: 52 }}>
        {tiles.map((tile, index) => {
          const enter = clamp((progress * 4.5 - index) * 1.4);
          return (
            <div key={tile} style={{ position: "absolute", left: 34 + index * 34, top: 60 + index * 82, width: 470, height: 126, borderRadius: 24, background: ["#10151f", "#35d0a3", "#4f7cff", "#ffca3a"][index], color: index === 3 ? palette.ink : "white", padding: 24, fontSize: 34, fontWeight: 950, boxShadow: "0 24px 58px rgba(16,21,31,0.22)", transform: `translateX(${(1 - enter) * 420}px) rotate(${(1 - enter) * 8}deg)`, opacity: enter }}>
              {index + 1}. {tile}
            </div>
          );
        })}
      </div>
    </MainStage>
  );
}

function ArtifactReveal({ artifacts = [], progress, localFrames }) {
  const current = Math.floor(localFrames / 18) % Math.max(1, artifacts.length);
  return (
    <MainStage>
      <BigLabel label="Receipts before posting" />
      <div style={{ position: "relative", height: 620, marginTop: 44 }}>
        {artifacts.slice(0, 6).map((artifact, index) => {
          const active = index === current;
          const angle = [-6, 5, -3, 7, -4, 3][index] ?? 0;
          return (
            <div key={`${artifact}-${index}`} style={{ position: "absolute", left: 42 + (index % 2) * 210, top: 30 + index * 86, width: 390, minHeight: 116, borderRadius: 22, background: active ? palette.ink : "rgba(255,255,255,0.82)", border: `3px solid ${active ? palette.ink : palette.line}`, color: active ? "white" : palette.ink, padding: 22, fontSize: 30, fontWeight: 950, boxShadow: active ? "0 28px 70px rgba(16,21,31,0.34)" : "0 14px 42px rgba(16,21,31,0.12)", transform: `rotate(${angle}deg) scale(${active ? 1.08 : 0.94})`, transition: "none" }}>
              {artifact}
            </div>
          );
        })}
      </div>
      <TimerPill progress={progress} label="approval-ready evidence" />
    </MainStage>
  );
}

function Cta({ repo, progress }) {
  return (
    <MainStage>
      <div style={{ marginTop: 80, fontSize: 78, lineHeight: 0.95, fontWeight: 950, maxWidth: 600 }}>Review it. Then approve it.</div>
      <div style={{ marginTop: 30, fontSize: 27, lineHeight: 1.25, fontWeight: 800, opacity: 0.72 }}>Claims, captions, visuals, and review payload stay visible before anything posts.</div>
      <div style={{ marginTop: 48, padding: "22px 24px", borderRadius: 24, background: palette.ink, color: "white", fontSize: 26, fontWeight: 900, maxWidth: 610, transform: `translateY(${(1 - progress) * 40}px)` }}>{repo?.url || repo?.name || "launchclip workspace"}</div>
      <PresenterOrb side="left" progress={progress} />
    </MainStage>
  );
}

function MainStage({ children }) {
  return <div style={{ position: "absolute", left: 44, right: 44, top: 150, bottom: 292, zIndex: 5 }}>{children}</div>;
}

function BigLabel({ label }) {
  return <div style={{ display: "inline-block", borderRadius: 999, background: palette.ink, color: "white", padding: "12px 18px", fontSize: 24, fontWeight: 950, boxShadow: "0 20px 50px rgba(16,21,31,0.22)" }}>{label}</div>;
}

function TaskCard({ label, index, visible, crossed }) {
  return (
    <div style={{ height: 84, borderRadius: 22, background: "rgba(255,255,255,0.82)", border: `3px solid ${palette.ink}`, display: "flex", alignItems: "center", padding: "0 24px", fontSize: 34, fontWeight: 950, opacity: visible, transform: `translateX(${(1 - visible) * -180}px) scale(${0.96 + visible * 0.04})`, boxShadow: "0 18px 48px rgba(16,21,31,0.12)" }}>
      <span style={{ color: palette.coral, marginRight: 16 }}>{index}</span>
      <span style={{ position: "relative" }}>
        {label}
        {crossed ? <span style={{ position: "absolute", left: -4, right: -4, top: "50%", height: 6, borderRadius: 999, background: palette.coral }} /> : null}
      </span>
    </div>
  );
}

function Dot({ color }) {
  return <div style={{ width: 14, height: 14, borderRadius: 999, background: color }} />;
}

function ProofBadge({ progress }) {
  return (
    <div style={{ position: "absolute", right: 8, bottom: 112, borderRadius: 26, background: palette.mint, border: `4px solid ${palette.ink}`, padding: "18px 22px", fontSize: 30, fontWeight: 950, transform: `rotate(-4deg) scale(${0.8 + progress * 0.24})`, boxShadow: "0 22px 54px rgba(16,21,31,0.22)" }}>
      proof captured
    </div>
  );
}

function TimerPill({ progress, label }) {
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 70, height: 70, borderRadius: 999, background: "rgba(255,255,255,0.82)", border: `3px solid ${palette.ink}`, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, width: `${progress * 100}%`, background: palette.amber }} />
      <div style={{ position: "relative", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 950 }}>{label}</div>
    </div>
  );
}

function MiniPanel({ title, text, active, side }) {
  return (
    <div style={{ minHeight: 124, borderRadius: 22, background: active ? (side === "script" ? palette.ink : palette.blue) : "rgba(255,255,255,0.72)", color: active ? "white" : palette.ink, border: `3px solid ${active ? "transparent" : palette.line}`, padding: 18, opacity: active ? 1 : 0.38, boxShadow: active ? "0 18px 46px rgba(16,21,31,0.18)" : "none" }}>
      <div style={{ fontSize: 21, fontWeight: 950, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 15, lineHeight: 1.22, fontWeight: 750 }}>{shorten(text, 118)}</div>
    </div>
  );
}

function PresenterOrb({ side, progress }) {
  const x = side === "right" ? 420 : -22;
  return (
    <div style={{ position: "absolute", [side]: 0, bottom: side === "right" ? 22 : 88, width: 230, height: 300, borderRadius: 30, background: "rgba(255,255,255,0.72)", border: `4px solid ${palette.ink}`, boxShadow: "0 28px 80px rgba(16,21,31,0.24)", overflow: "hidden", transform: `translateX(${(1 - progress) * x}px) scale(${0.92 + progress * 0.1})` }}>
      <div style={{ position: "absolute", inset: 12, borderRadius: 22, background: `linear-gradient(145deg, ${palette.blue}, ${palette.mint} 52%, ${palette.amber})` }} />
      <div style={{ position: "absolute", left: 38, right: 38, top: 42, height: 122, borderRadius: "50% 50% 42% 42%", background: "rgba(255,255,255,0.76)", border: `3px solid ${palette.ink}` }} />
      <div style={{ position: "absolute", left: 26, right: 26, bottom: 28, height: 94, borderRadius: "44px 44px 18px 18px", background: "rgba(16,21,31,0.88)" }} />
      <div style={{ position: "absolute", left: 24, right: 24, bottom: 12, display: "flex", alignItems: "end", justifyContent: "center", gap: 7 }}>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div key={index} style={{ width: 12, height: 18 + Math.sin(progress * 6 + index) * 12 + index * 4, borderRadius: 999, background: index % 2 ? palette.mint : "white", opacity: 0.82 }} />
        ))}
      </div>
    </div>
  );
}

function KineticCaption({ beat, progress }) {
  const words = String(beat.caption ?? beat.beat ?? "").split(/\s+/).filter(Boolean);
  return (
    <div style={{ position: "absolute", left: 36, right: 36, bottom: 114, minHeight: 148, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flexWrap: "wrap", zIndex: 30, transform: `scale(${0.86 + progress * 0.14})` }}>
      {words.map((word, index) => (
        <span key={`${word}-${index}`} style={{ display: "inline-block", padding: "12px 16px", borderRadius: 16, background: index % 2 ? palette.paper : palette.ink, color: index % 2 ? palette.ink : "white", border: `3px solid ${palette.ink}`, boxShadow: "0 16px 42px rgba(16,21,31,0.20)", fontSize: Math.max(34, 58 - words.length * 3), lineHeight: 1, fontWeight: 950, transform: `translateY(${(1 - progress) * (index % 2 ? 34 : -34)}px) rotate(${(1 - progress) * (index % 2 ? 5 : -5)}deg)`, opacity: progress }}>
          {word}
        </span>
      ))}
    </div>
  );
}

function BottomRail({ timeline, active }) {
  return (
    <div style={{ position: "absolute", left: 42, right: 42, bottom: 42, display: "grid", gridTemplateColumns: `repeat(${Math.max(1, timeline.length)}, 1fr)`, gap: 8, zIndex: 22 }}>
      {(timeline.length ? timeline : [fallbackBeat("repo")]).map((beat, index) => (
        <div key={`${beat.beat}-${index}`} style={{ height: 12, borderRadius: 999, background: index <= active ? palette.ink : "rgba(16,21,31,0.16)" }} />
      ))}
    </div>
  );
}

function normalizedTimeline(timeline = [], durationSeconds = 30) {
  if (!Array.isArray(timeline) || !timeline.length) return [fallbackBeat("repo", durationSeconds)];
  let cursor = 0;
  return timeline.map((beat) => {
    const parsed = parseRange(beat.time_range);
    const start = Number.isFinite(parsed.start) ? parsed.start : cursor;
    const end = Number.isFinite(parsed.end) ? parsed.end : start + Number(beat.target_seconds ?? 3);
    cursor = end;
    return { ...beat, start, end, duration: Math.max(0.1, end - start) };
  });
}

function activeBeatIndex(timeline, time) {
  const index = timeline.findIndex((beat, itemIndex) => time >= beat.start && (time < beat.end || itemIndex === timeline.length - 1));
  return index === -1 ? Math.max(0, timeline.length - 1) : index;
}

function parseRange(range) {
  const match = String(range ?? "").match(/([\d.]+)\s*-\s*([\d.]+)/);
  return { start: match ? Number(match[1]) : NaN, end: match ? Number(match[2]) : NaN };
}

function fallbackBeat(repoName = "repo", duration = 30) {
  return {
    beat: "cold-open",
    caption: "Repo -> Short",
    voiceover: `${repoName} made a launch Short.`,
    visual: "Full-screen launch clip hook.",
    start: 0,
    end: duration,
    duration
  };
}

function shorten(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

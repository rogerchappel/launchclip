import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const colors = {
  ink: "#121417",
  charcoal: "#1f242b",
  paper: "#f5f1e8",
  white: "#fbfbf8",
  mist: "#dce6ea",
  green: "#22c55e",
  blue: "#3b82f6",
  coral: "#f9736b",
  amber: "#f5b84b",
  plum: "#8057c7",
  line: "rgba(18,20,23,0.14)",
  softLine: "rgba(255,255,255,0.18)"
};

export function LaunchclipSocial(props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const timeline = normalizedTimeline(props.timeline, props.durationSeconds ?? durationInFrames / fps);
  const scenes = normalizeStoryboard(props.storyboard, timeline);
  const now = frame / fps;
  const activeIndex = activeSceneIndex(timeline, now);
  const beat = timeline[activeIndex] ?? fallbackBeat(props.repo?.name);
  const scene = scenes[activeIndex] ?? fallbackScene(beat, activeIndex);
  const localSeconds = Math.max(0, now - beat.start);
  const localFrame = localSeconds * fps;
  const progress = clamp(localSeconds / Math.max(0.1, beat.duration));
  const entrance = spring({ frame: localFrame, fps, config: { damping: 20, stiffness: 150 } });
  const cutEnergy = spring({ frame: Math.max(0, localFrame - 5), fps, config: { damping: 13, stiffness: 220 } });
  const totalProgress = clamp(frame / Math.max(1, durationInFrames - 1));
  const context = { props, beat, scene, activeIndex, progress, entrance, cutEnergy, fps, localFrame, totalProgress };

  return (
    <AbsoluteFill style={{ backgroundColor: colors.paper, color: colors.ink, fontFamily: "Inter, Arial, Helvetica, sans-serif", overflow: "hidden" }}>
      <EditorialBackdrop frame={frame} scene={scene} />
      <SceneSwitch context={context} />
      <BrandBar repo={props.repo} progress={totalProgress} scene={scene} />
      {!isCtaScene(scene) ? <CaptionStack beat={beat} progress={cutEnergy} scene={scene} /> : null}
      {!isCtaScene(scene) ? <StoryboardRail timeline={timeline} activeIndex={activeIndex} /> : null}
    </AbsoluteFill>
  );
}

function SceneSwitch({ context }) {
  const id = context.scene.id || context.beat.beat;
  if (id === "cold-open" || id === "hook") return <ColdOpen {...context} />;
  if (id === "friction") return <FrictionMontage {...context} />;
  if (id === "demo-trigger" || id === "split-screen-proof") return <DemoEvidence {...context} />;
  if (id === "proof") return <ProofTimeline {...context} />;
  if (id === "transformation" || id === "steps") return <PacketAssembly {...context} />;
  if (id === "artifact-reveal" || id === "artifacts") return <ArtifactBarrage {...context} />;
  return <CtaLockup {...context} />;
}

function EditorialBackdrop({ frame, scene }) {
  const palette = scenePalette(scene.id);
  const shift = Math.sin(frame / 48) * 16;
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", inset: 0, background: palette.background }} />
      <div style={{ position: "absolute", inset: 0, opacity: 0.62, backgroundImage: "linear-gradient(90deg, rgba(18,20,23,0.05) 1px, transparent 1px), linear-gradient(rgba(18,20,23,0.05) 1px, transparent 1px)", backgroundSize: "72px 72px", transform: `translate(${shift}px, ${-shift}px)` }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 180, background: palette.topWash }} />
    </AbsoluteFill>
  );
}

function ColdOpen({ props, beat, scene, progress, entrance }) {
  const palette = scenePalette(scene.id);
  const receiptScale = 0.92 + entrance * 0.08;
  return (
    <Stage>
      <div style={{ position: "absolute", left: 34, right: 34, top: 74 }}>
        <div style={{ transform: `translateY(${(1 - entrance) * 46}px) scale(${0.94 + entrance * 0.06})`, transformOrigin: "left top" }}>
          <Eyebrow color={palette.accent}>first frame proof</Eyebrow>
          <div style={{ marginTop: 18, fontSize: 78, lineHeight: 0.92, fontWeight: 900, maxWidth: 610 }}>
            This repo made its own launch Short.
          </div>
          <div style={{ marginTop: 22, fontSize: 25, lineHeight: 1.22, fontWeight: 760, maxWidth: 335, color: "rgba(18,20,23,0.72)" }}>
            {shorten(props.repo?.summary || beat.voiceover, 118)}
          </div>
        </div>
      </div>
      <CreatorFrame x={410} y={438} width={210} height={272} label="host" progress={progress} />
      <ReceiptStrip
        x={54}
        y={720}
        width={590}
        label={props.repo?.name || "repo"}
        items={["demo proof", "script", "captions", "review packet"]}
        progress={progress}
        scale={receiptScale}
      />
      <ThumbnailPreview x={78} y={875} width={520} height={190} progress={progress} label={scene.composition} />
    </Stage>
  );
}

function FrictionMontage({ beat, progress, entrance }) {
  const tasks = ["script", "record", "edit", "caption", "review"];
  return (
    <Stage>
      <TwoColumnHeader eyebrow="manual launch work" title={beat.caption || "The boring part"} copy={beat.voiceover} entrance={entrance} />
      <div style={{ position: "absolute", left: 52, right: 52, top: 330, height: 525 }}>
        <TimelineBoard progress={progress} />
        {tasks.map((task, index) => {
          const visible = clamp((progress * 5.6 - index) * 1.4);
          const collapsed = clamp((progress - 0.58 - index * 0.035) / 0.16);
          return (
            <TaskChip
              key={task}
              label={task}
              index={index}
              visible={visible}
              collapsed={collapsed}
              x={34 + (index % 2) * 258}
              y={52 + index * 78}
            />
          );
        })}
      </div>
      <CursorPath progress={progress} />
    </Stage>
  );
}

function DemoEvidence({ props, beat, scene, progress, entrance, localFrame }) {
  const lines = String(props.terminal || "$ npm run smoke\n\nSmoke OK").split("\n").filter(Boolean).slice(0, 6);
  const command = lines.find((line) => line.startsWith("$ ")) || lines[0] || "$ npm run smoke";
  const output = lines.filter((line) => line !== command).join("\n") || "Demo completed and evidence was captured.";
  return (
    <Stage>
      <DeviceFrame x={56} y={178} width={442} height={650} entrance={entrance}>
        <TerminalSurface command={command} output={output} progress={progress} localFrame={localFrame} />
      </DeviceFrame>
      <CreatorFrame x={434} y={540} width={202} height={270} label="guide" progress={progress} compact />
      <ProofStamp x={72} y={865} label="real demo captured" progress={progress} />
      <SideNote x={526} y={228} title={beat.caption || "Run the demo"} body={scene.composition || beat.visual} color={colors.green} />
    </Stage>
  );
}

function ProofTimeline({ props, beat, scene, progress, entrance }) {
  const rows = (props.timeline || []).slice(0, 5);
  return (
    <Stage>
      <TwoColumnHeader eyebrow="edit proof" title={beat.caption || "Script + visuals align"} copy={scene.composition || beat.voiceover} entrance={entrance} />
      <EditorPanel x={48} y={300} width={624} height={520} progress={progress} rows={rows} />
      <div style={{ position: "absolute", left: 74, right: 74, bottom: 250, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {["script lane", "visual lane", "playhead"].map((item, index) => (
          <StatusPill key={item} label={item} active={progress > 0.18 + index * 0.2} />
        ))}
      </div>
    </Stage>
  );
}

function PacketAssembly({ props, beat, progress, entrance }) {
  const cards = ["demo proof", "script", "captions", "thumbnail", "review"];
  return (
    <Stage>
      <TwoColumnHeader eyebrow="output assembly" title={beat.caption || "One packet"} copy={beat.voiceover} entrance={entrance} />
      <div style={{ position: "absolute", left: 58, right: 58, top: 310, bottom: 238 }}>
        {cards.map((card, index) => {
          const p = clamp((progress * 5.2 - index) * 1.2);
          const targetX = 142 + (index % 2) * 185;
          const targetY = 110 + Math.floor(index / 2) * 140;
          return (
            <OutputCard
              key={card}
              label={card}
              index={index + 1}
              x={interpolate(p, [0, 1], [index % 2 ? 450 : -170, targetX])}
              y={interpolate(p, [0, 1], [targetY + 80, targetY])}
              rotate={interpolate(p, [0, 1], [index % 2 ? 8 : -8, 0])}
              active={p > 0.94}
            />
          );
        })}
        <PacketFolder progress={progress} repoName={props.repo?.name} />
      </div>
    </Stage>
  );
}

function ArtifactBarrage({ props, beat, scene, progress, entrance, localFrame }) {
  const artifacts = props.artifacts?.length ? props.artifacts : ["video/brief.md", "render-plan.json", "captions/*.md", "REVIEW.md", "dry-run.json"];
  const active = Math.floor(localFrame / 14) % artifacts.length;
  return (
    <Stage>
      <TwoColumnHeader eyebrow="inspectable receipts" title={beat.caption || "Receipts before posting"} copy={scene.composition || beat.voiceover} entrance={entrance} />
      <div style={{ position: "absolute", left: 44, right: 44, top: 304, height: 595 }}>
        {artifacts.slice(0, 6).map((artifact, index) => {
          const p = clamp((progress * 7 - index) * 1.1);
          const isActive = index === active;
          return (
            <ArtifactCard
              key={`${artifact}-${index}`}
              label={artifact}
              x={index % 2 ? 332 : 22}
              y={36 + index * 76}
              active={isActive}
              visible={p}
            />
          );
        })}
      </div>
      <ProofStamp x={82} y={905} label="review before posting" progress={progress} color={colors.amber} />
    </Stage>
  );
}

function CtaLockup({ props, beat, progress, entrance }) {
  const repoLabel = shorten(props.repo?.url || props.repo?.name || "launchclip workspace", 54);
  return (
    <Stage>
      <CreatorFrame x={62} y={210} width={222} height={302} label="host" progress={progress} />
      <div style={{ position: "absolute", left: 330, right: 54, top: 216, transform: `translateY(${(1 - entrance) * 36}px)` }}>
        <Eyebrow color={colors.green}>approval boundary</Eyebrow>
        <div style={{ marginTop: 18, fontSize: 64, lineHeight: 0.92, fontWeight: 900 }}>{beat.caption || "Review, then approve"}</div>
      </div>
      <div style={{ position: "absolute", left: 58, right: 58, top: 608, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {["claims grounded", "visuals aligned"].map((item, index) => (
          <ChecklistRow key={item} label={item} checked={progress > 0.18 + index * 0.22} compact />
        ))}
      </div>
      <div style={{ position: "absolute", left: 58, right: 58, top: 760, padding: "28px 30px 30px", borderRadius: 26, background: colors.ink, color: colors.white, boxShadow: "0 28px 60px rgba(18,20,23,0.22)" }}>
        <div style={{ fontSize: 14, fontWeight: 850, textTransform: "uppercase", color: colors.green }}>next step</div>
        <div style={{ marginTop: 10, fontSize: 38, lineHeight: 0.98, fontWeight: 900 }}>Open the review packet.</div>
        <div style={{ marginTop: 18, fontSize: 20, lineHeight: 1.16, fontWeight: 760, color: "rgba(251,251,248,0.76)" }}>{repoLabel}</div>
      </div>
    </Stage>
  );
}

function Stage({ children }) {
  return <div style={{ position: "absolute", inset: 0, zIndex: 2 }}>{children}</div>;
}

function BrandBar({ repo, progress, scene }) {
  const palette = scenePalette(scene.id);
  const cta = isCtaScene(scene);
  return (
    <div style={{ position: "absolute", left: 34, right: 34, top: 32, zIndex: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: colors.ink, color: colors.paper, display: "grid", placeItems: "center", fontSize: 14, fontWeight: 900 }}>LC</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900, lineHeight: 1 }}>{repo?.name || "repo"}</div>
            <div style={{ marginTop: 3, fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "rgba(18,20,23,0.58)" }}>social preview</div>
          </div>
        </div>
        <div style={{ padding: "8px 12px", borderRadius: 999, background: palette.accent, color: palette.accentText, fontSize: 13, fontWeight: 900 }}>{cta ? "review gate" : "dry-run"}</div>
      </div>
      {!cta ? (
        <div style={{ marginTop: 16, height: 5, borderRadius: 999, background: "rgba(18,20,23,0.12)", overflow: "hidden" }}>
          <div style={{ width: `${progress * 100}%`, height: "100%", borderRadius: 999, background: colors.ink }} />
        </div>
      ) : null}
    </div>
  );
}

function CaptionStack({ beat, progress, scene }) {
  const words = splitCaption(beat.caption || scene.hook || beat.beat);
  const palette = scenePalette(scene.id);
  return (
    <div style={{ position: "absolute", left: 38, right: 38, bottom: 86, minHeight: 132, zIndex: 30, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 10 }}>
      {words.map((word, index) => {
        const p = clamp(progress - index * 0.04);
        return (
          <span key={`${word}-${index}`} style={{ display: "inline-block", padding: "10px 15px 12px", borderRadius: 10, background: index % 3 === 1 ? palette.accent : colors.ink, color: index % 3 === 1 ? palette.accentText : colors.white, fontSize: Math.max(34, 56 - words.length * 2), lineHeight: 0.96, fontWeight: 900, boxShadow: "0 18px 40px rgba(18,20,23,0.18)", transform: `translateY(${(1 - p) * 28}px) scale(${0.92 + p * 0.08})`, opacity: p }}>
            {word}
          </span>
        );
      })}
    </div>
  );
}

function StoryboardRail({ timeline, activeIndex }) {
  return (
    <div style={{ position: "absolute", left: 44, right: 44, bottom: 34, display: "grid", gridTemplateColumns: `repeat(${Math.max(1, timeline.length)}, 1fr)`, gap: 7, zIndex: 24 }}>
      {timeline.map((beat, index) => (
        <div key={`${beat.beat}-${index}`} style={{ height: 8, borderRadius: 999, background: index <= activeIndex ? colors.ink : "rgba(18,20,23,0.14)" }} />
      ))}
    </div>
  );
}

function TwoColumnHeader({ eyebrow, title, copy, entrance }) {
  return (
    <div style={{ position: "absolute", left: 48, right: 48, top: 140, display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 24, alignItems: "end", transform: `translateY(${(1 - entrance) * 34}px)`, opacity: entrance }}>
      <div>
        <Eyebrow color={colors.ink}>{eyebrow}</Eyebrow>
        <div style={{ marginTop: 16, fontSize: 58, lineHeight: 0.96, fontWeight: 900 }}>{title}</div>
      </div>
      <div style={{ fontSize: 18, lineHeight: 1.24, fontWeight: 700, color: "rgba(18,20,23,0.66)" }}>{shorten(copy, 118)}</div>
    </div>
  );
}

function Eyebrow({ children, color }) {
  return <div style={{ display: "inline-block", padding: "8px 11px", borderRadius: 8, background: color, color: color === colors.ink ? colors.white : colors.ink, fontSize: 13, lineHeight: 1, fontWeight: 900, textTransform: "uppercase" }}>{children}</div>;
}

function CreatorFrame({ x, y, width, height, label, progress, compact = false }) {
  const wave = Math.sin(progress * Math.PI * 4);
  return (
    <div style={{ position: "absolute", left: x, top: y, width, height, borderRadius: 26, overflow: "hidden", background: colors.charcoal, boxShadow: "0 28px 70px rgba(18,20,23,0.24)", transform: `translateY(${(1 - progress) * 22}px)` }}>
      <div style={{ position: "absolute", inset: 10, borderRadius: 20, background: `linear-gradient(160deg, ${colors.mist}, ${colors.paper} 45%, #b8d8d2)` }} />
      <div style={{ position: "absolute", left: width * 0.25, top: height * 0.12, width: width * 0.48, height: height * 0.25, borderRadius: "48% 48% 44% 44%", background: "rgba(18,20,23,0.82)" }} />
      <div style={{ position: "absolute", left: width * 0.17, right: width * 0.17, bottom: compact ? height * 0.2 : height * 0.18, height: height * 0.34, borderRadius: "46px 46px 18px 18px", background: colors.ink }} />
      <div style={{ position: "absolute", left: 16, right: 16, bottom: 14, display: "flex", alignItems: "end", justifyContent: "center", gap: 5 }}>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div key={index} style={{ width: 8, height: 14 + index * 3 + wave * (index % 2 ? 5 : -3), borderRadius: 999, background: index % 2 ? colors.green : colors.white, opacity: 0.9 }} />
        ))}
      </div>
      <div style={{ position: "absolute", left: 14, top: 14, padding: "5px 8px", borderRadius: 999, background: "rgba(255,255,255,0.76)", fontSize: 11, fontWeight: 900, textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

function ReceiptStrip({ x, y, width, label, items, progress, scale }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width, transform: `scale(${scale})`, transformOrigin: "left top", padding: 18, borderRadius: 22, background: colors.white, boxShadow: "0 24px 54px rgba(18,20,23,0.16)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>{label}</div>
        <div style={{ fontSize: 12, fontWeight: 900, color: colors.green, textTransform: "uppercase" }}>receipt</div>
      </div>
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 8 }}>
        {items.map((item, index) => (
          <div key={item} style={{ height: 42, borderRadius: 10, background: progress > index / items.length ? colors.ink : "rgba(18,20,23,0.08)", color: progress > index / items.length ? colors.white : colors.ink, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 850 }}>
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function ThumbnailPreview({ x, y, width, height, progress, label }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width, height, borderRadius: 24, overflow: "hidden", background: colors.ink, boxShadow: "0 28px 70px rgba(18,20,23,0.2)", transform: `translateY(${(1 - progress) * 28}px)` }}>
      <div style={{ position: "absolute", inset: 18, borderRadius: 16, background: colors.paper }} />
      <div style={{ position: "absolute", left: 42, top: 45, width: 210, height: 24, borderRadius: 999, background: colors.green }} />
      <div style={{ position: "absolute", left: 42, top: 86, right: 42, height: 18, borderRadius: 999, background: "rgba(18,20,23,0.18)" }} />
      <div style={{ position: "absolute", left: 42, top: 118, right: 132, height: 18, borderRadius: 999, background: "rgba(18,20,23,0.12)" }} />
      <div style={{ position: "absolute", right: 36, top: 40, width: 94, height: 112, borderRadius: 16, background: colors.charcoal }} />
      <div style={{ position: "absolute", left: 42, bottom: 24, right: 42, fontSize: 11, lineHeight: 1.2, fontWeight: 750, color: "rgba(251,251,248,0.76)" }}>{shorten(label, 94)}</div>
    </div>
  );
}

function TimelineBoard({ progress }) {
  return (
    <div style={{ position: "absolute", inset: 0, borderRadius: 28, background: colors.white, border: `1px solid ${colors.line}`, boxShadow: "0 28px 60px rgba(18,20,23,0.12)", overflow: "hidden" }}>
      <div style={{ height: 58, background: colors.ink, display: "flex", alignItems: "center", gap: 8, paddingLeft: 22 }}>
        {[colors.coral, colors.amber, colors.green].map((color) => <div key={color} style={{ width: 12, height: 12, borderRadius: 999, background: color }} />)}
      </div>
      <div style={{ position: "absolute", left: 44, right: 44, bottom: 54, height: 12, borderRadius: 999, background: "rgba(18,20,23,0.1)" }}>
        <div style={{ width: `${progress * 100}%`, height: "100%", borderRadius: 999, background: colors.coral }} />
      </div>
    </div>
  );
}

function TaskChip({ label, index, visible, collapsed, x, y }) {
  const finalY = 372;
  const finalX = 70 + index * 90;
  return (
    <div style={{ position: "absolute", left: interpolate(collapsed, [0, 1], [x, finalX]), top: interpolate(collapsed, [0, 1], [y, finalY]), minWidth: collapsed > 0.85 ? 70 : 190, height: 58, borderRadius: 14, background: collapsed > 0.85 ? colors.ink : colors.paper, color: collapsed > 0.85 ? colors.white : colors.ink, display: "flex", alignItems: "center", justifyContent: "center", fontSize: collapsed > 0.85 ? 12 : 20, fontWeight: 900, opacity: visible, boxShadow: "0 16px 32px rgba(18,20,23,0.14)", transform: `scale(${0.92 + visible * 0.08})` }}>
      {label}
    </div>
  );
}

function CursorPath({ progress }) {
  return (
    <div style={{ position: "absolute", left: 126 + progress * 410, top: 430 + Math.sin(progress * Math.PI * 2) * 85, width: 0, height: 0, borderLeft: "18px solid white", borderTop: "26px solid transparent", borderBottom: "8px solid transparent", filter: "drop-shadow(0 8px 14px rgba(18,20,23,0.22))" }} />
  );
}

function DeviceFrame({ x, y, width, height, entrance, children }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width, height, borderRadius: 38, background: colors.ink, padding: 14, boxShadow: "0 34px 80px rgba(18,20,23,0.27)", transform: `translateY(${(1 - entrance) * 42}px) rotate(${-2 + entrance * 2}deg)` }}>
      <div style={{ position: "absolute", left: "50%", top: 10, width: 96, height: 16, transform: "translateX(-50%)", borderRadius: 999, background: "#050608", zIndex: 3 }} />
      <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 28, overflow: "hidden", background: "#0a111a" }}>{children}</div>
    </div>
  );
}

function TerminalSurface({ command, output, progress, localFrame }) {
  return (
    <div style={{ position: "absolute", inset: 0, padding: "54px 26px 24px", color: colors.white }}>
      <div style={{ fontSize: 12, fontWeight: 900, textTransform: "uppercase", color: colors.green }}>live capture</div>
      <div style={{ marginTop: 22, fontFamily: "Menlo, Consolas, monospace", fontSize: 18, lineHeight: 1.45, color: colors.green }}>{reveal(command, clamp((localFrame - 4) / 28))}</div>
      <div style={{ marginTop: 28, fontFamily: "Menlo, Consolas, monospace", fontSize: 15, lineHeight: 1.42, color: "rgba(251,251,248,0.76)", whiteSpace: "pre-wrap" }}>{reveal(shorten(output, 210), clamp((progress - 0.35) / 0.5))}</div>
      <div style={{ position: "absolute", left: 26, right: 26, bottom: 26, height: 8, borderRadius: 999, background: "rgba(255,255,255,0.14)" }}>
        <div style={{ width: `${progress * 100}%`, height: "100%", borderRadius: 999, background: colors.green }} />
      </div>
    </div>
  );
}

function ProofStamp({ x, y, label, progress, color = colors.green }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, padding: "16px 20px", borderRadius: 18, background: color, color: colors.ink, fontSize: 24, lineHeight: 1, fontWeight: 900, boxShadow: "0 20px 48px rgba(18,20,23,0.18)", transform: `rotate(-3deg) scale(${0.82 + progress * 0.18})` }}>
      {label}
    </div>
  );
}

function SideNote({ x, y, title, body, color }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 138 }}>
      <div style={{ width: 44, height: 5, borderRadius: 999, background: color, marginBottom: 12 }} />
      <div style={{ fontSize: 22, lineHeight: 1.02, fontWeight: 900 }}>{title}</div>
      <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.24, fontWeight: 700, color: "rgba(18,20,23,0.62)" }}>{shorten(body, 82)}</div>
    </div>
  );
}

function EditorPanel({ x, y, width, height, progress, rows }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width, height, borderRadius: 28, overflow: "hidden", background: colors.charcoal, boxShadow: "0 30px 70px rgba(18,20,23,0.2)" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 54, background: "#161a20", display: "flex", alignItems: "center", padding: "0 20px", gap: 8 }}>
        {[colors.coral, colors.amber, colors.green].map((color) => <div key={color} style={{ width: 11, height: 11, borderRadius: 999, background: color }} />)}
      </div>
      <div style={{ position: "absolute", left: 26, right: 26, top: 86, bottom: 34 }}>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${8 + progress * 82}%`, width: 4, borderRadius: 999, background: colors.blue, boxShadow: "0 0 28px rgba(59,130,246,0.58)" }} />
        {(rows.length ? rows : [fallbackBeat("repo")]).map((row, index) => {
          const active = progress > index / Math.max(1, rows.length);
          return (
            <div key={`${row.beat}-${index}`} style={{ height: 67, marginBottom: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, opacity: active ? 1 : 0.42 }}>
              <LaneCard title={row.caption || row.beat} body={row.voiceover} color={active ? colors.blue : "rgba(255,255,255,0.14)"} />
              <LaneCard title={row.beat} body={row.visual} color={active ? colors.green : "rgba(255,255,255,0.14)"} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LaneCard({ title, body, color }) {
  return (
    <div style={{ borderRadius: 14, background: "rgba(255,255,255,0.08)", borderLeft: `5px solid ${color}`, padding: "10px 12px", color: colors.white, overflow: "hidden" }}>
      <div style={{ fontSize: 12, fontWeight: 900 }}>{shorten(title, 22)}</div>
      <div style={{ marginTop: 5, fontSize: 10, lineHeight: 1.18, fontWeight: 650, color: "rgba(251,251,248,0.64)" }}>{shorten(body, 72)}</div>
    </div>
  );
}

function StatusPill({ label, active }) {
  return <div style={{ height: 38, borderRadius: 999, background: active ? colors.ink : "rgba(18,20,23,0.1)", color: active ? colors.white : colors.ink, display: "grid", placeItems: "center", fontSize: 13, fontWeight: 900 }}>{label}</div>;
}

function OutputCard({ label, index, x, y, rotate, active }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 168, height: 116, borderRadius: 18, background: active ? colors.white : colors.paper, boxShadow: "0 20px 46px rgba(18,20,23,0.16)", padding: 18, transform: `rotate(${rotate}deg)` }}>
      <div style={{ width: 34, height: 28, borderRadius: 9, background: [colors.blue, colors.green, colors.coral, colors.amber, colors.plum][index - 1] }} />
      <div style={{ marginTop: 13, fontSize: 12, fontWeight: 900, color: "rgba(18,20,23,0.48)" }}>0{index}</div>
      <div style={{ marginTop: 2, fontSize: 18, lineHeight: 1.03, fontWeight: 900 }}>{label}</div>
    </div>
  );
}

function PacketFolder({ progress, repoName }) {
  return (
    <div style={{ position: "absolute", left: 102, bottom: 0, width: 386, height: 150, borderRadius: 24, background: colors.ink, color: colors.white, padding: 24, boxShadow: "0 30px 70px rgba(18,20,23,0.22)", transform: `translateY(${(1 - progress) * 64}px)` }}>
      <div style={{ fontSize: 13, fontWeight: 900, textTransform: "uppercase", color: colors.green }}>launch packet</div>
      <div style={{ marginTop: 12, fontSize: 32, lineHeight: 1.02, fontWeight: 900 }}>{repoName || "repo"} ready for review</div>
    </div>
  );
}

function ArtifactCard({ label, x, y, active, visible }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: active ? 302 : 280, minHeight: active ? 108 : 88, borderRadius: 18, background: active ? colors.ink : colors.white, color: active ? colors.white : colors.ink, padding: 18, opacity: visible, boxShadow: active ? "0 28px 64px rgba(18,20,23,0.28)" : "0 18px 36px rgba(18,20,23,0.12)", transform: `translateY(${(1 - visible) * 28}px) scale(${active ? 1.04 : 0.96})` }}>
      <div style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", color: active ? colors.amber : "rgba(18,20,23,0.46)" }}>artifact</div>
      <div style={{ marginTop: 8, fontSize: active ? 22 : 18, lineHeight: 1.05, fontWeight: 900 }}>{label}</div>
      {active ? <div style={{ marginTop: 12, height: 6, borderRadius: 999, background: colors.amber }} /> : null}
    </div>
  );
}

function ChecklistRow({ label, checked, compact = false }) {
  return (
    <div style={{ height: compact ? 82 : 70, borderRadius: 18, background: colors.white, display: "flex", alignItems: "center", gap: 14, padding: "0 18px", boxShadow: "0 16px 36px rgba(18,20,23,0.1)" }}>
      <div style={{ width: 32, height: 32, borderRadius: 10, background: checked ? colors.green : "rgba(18,20,23,0.12)", color: colors.ink, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 900 }}>{checked ? "OK" : ""}</div>
      <div style={{ fontSize: compact ? 19 : 24, lineHeight: 1, fontWeight: 900 }}>{label}</div>
    </div>
  );
}

function isCtaScene(scene) {
  return (scene.id || "").toLowerCase() === "cta";
}

function scenePalette(id) {
  const palettes = {
    "cold-open": { background: `linear-gradient(180deg, ${colors.paper} 0%, #e8eee9 100%)`, topWash: "rgba(34,197,94,0.12)", accent: colors.green, accentText: colors.ink },
    hook: { background: `linear-gradient(180deg, ${colors.paper} 0%, #e8eee9 100%)`, topWash: "rgba(34,197,94,0.12)", accent: colors.green, accentText: colors.ink },
    friction: { background: `linear-gradient(180deg, #f6efe9 0%, #e9eef3 100%)`, topWash: "rgba(249,115,107,0.12)", accent: colors.coral, accentText: colors.ink },
    "demo-trigger": { background: `linear-gradient(180deg, #edf5f4 0%, #f5f1e8 100%)`, topWash: "rgba(34,197,94,0.10)", accent: colors.green, accentText: colors.ink },
    "split-screen-proof": { background: `linear-gradient(180deg, #edf5f4 0%, #f5f1e8 100%)`, topWash: "rgba(34,197,94,0.10)", accent: colors.green, accentText: colors.ink },
    proof: { background: `linear-gradient(180deg, #eef3fb 0%, #f5f1e8 100%)`, topWash: "rgba(59,130,246,0.12)", accent: colors.blue, accentText: colors.white },
    transformation: { background: `linear-gradient(180deg, #f7f1df 0%, #ecf3ef 100%)`, topWash: "rgba(245,184,75,0.14)", accent: colors.amber, accentText: colors.ink },
    steps: { background: `linear-gradient(180deg, #f7f1df 0%, #ecf3ef 100%)`, topWash: "rgba(245,184,75,0.14)", accent: colors.amber, accentText: colors.ink },
    "artifact-reveal": { background: `linear-gradient(180deg, #eeeef7 0%, #f5f1e8 100%)`, topWash: "rgba(128,87,199,0.13)", accent: colors.plum, accentText: colors.white },
    artifacts: { background: `linear-gradient(180deg, #eeeef7 0%, #f5f1e8 100%)`, topWash: "rgba(128,87,199,0.13)", accent: colors.plum, accentText: colors.white },
    cta: { background: `linear-gradient(180deg, #eff5ef 0%, #f5f1e8 100%)`, topWash: "rgba(34,197,94,0.12)", accent: colors.green, accentText: colors.ink }
  };
  return palettes[id] || palettes.cta;
}

function normalizeStoryboard(storyboard, timeline) {
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  if (scenes.length) return scenes;
  return timeline.map((beat, index) => fallbackScene(beat, index));
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

function activeSceneIndex(timeline, time) {
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

function fallbackScene(beat, index = 0) {
  return {
    id: beat.beat || "cta",
    order: index + 1,
    hook: beat.caption || beat.beat,
    composition: beat.visual || beat.voiceover || "",
    media_slots: ["script", "visual", "evidence"],
    motion_grammar: ["cut", "push", "highlight"],
    typography: "large captions",
    color_grade: "neutral"
  };
}

function splitCaption(value) {
  const words = String(value || "")
    .replace(/->/g, "to")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= 4) return words;
  return words.slice(0, 5);
}

function reveal(text, progress) {
  const value = String(text || "");
  return value.slice(0, Math.max(0, Math.ceil(value.length * progress)));
}

function shorten(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const raw = text.slice(0, max).trimEnd();
  const boundary = raw.lastIndexOf(" ");
  return `${raw.slice(0, boundary > max * 0.62 ? boundary : max - 1)}...`;
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

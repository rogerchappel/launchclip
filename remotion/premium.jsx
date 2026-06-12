import React from "react";
import { ThreeCanvas } from "@remotion/three";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { slide } from "@remotion/transitions/slide";
import { AbsoluteFill, Audio, Easing, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

const colors = {
  ink: "#111411",
  graphite: "#222824",
  paper: "#f4f1e8",
  white: "#fffdf7",
  soft: "#dfe7dc",
  green: "#22c55e",
  moss: "#5f7f4e",
  blue: "#4267f5",
  purple: "#6d4cff",
  amber: "#f4b740",
  coral: "#f06f58",
  line: "rgba(17,20,17,0.14)",
  shadow: "rgba(17,20,17,0.22)"
};

const sfxSources = {
  tick: "data:audio/wav;base64,UklGRuQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YcADAAAAABMAQABkAF4AGwCp/zL/7/4N/5f/aQA7AbkBoQHnALz/gv6x/aL9cv7q/44ByQIcA1QCpACX/uX8MvzR/KD+CwE8A2gEEQRDAoz/2vwj+xD7vvyp/9UCJAW8BVIEUgG7/cz6l/mZ+Jn4A/tB/+EDRwc3CEwGHQIV/fD4Kvdy+Gf8uAGPBjgJtgglBbL/O/qr9kv2Tfm4/rEEJgl+CjMI/wKm/Fr3+vRp9jf7xgHUB0EL0AqXBgAATvnX9DL0qPcU/kUFugqHDP0J7wNt/A/2EfOL9Ab6qQHRCP4Msgz7B24ApPhS81ryHvZe/ZwF/gtGDp0L4wRl/BH1ePHj8uD4ZgGECWYOUw5GCfQAO/gi8s3wvPSe/LwF7wyzDwgN0gWK/GP0NvB88c73BAHvCXYPqQ9uCosBEvhK8ZPvjPPc+6gFiw3HEDUOswbV/AP0T+9e8Nr2igAUCisQrRBpCysCI/jL8LLulfIi+2YF1A1/ERwPfAc//e7zxe6Q7w32AAD5CYQQWhEvDMkCaPijDMkCaPij8Czu4PF5+v8EzQ3YEbcPJQjA/SD0me4X72/1b/+jCYIQrBG5DF8D2/jP8AXuc/Ho+XkEfA3UEQEQpghQ/pH0yO717gb14P4bCSsQoxECDeMDcvlJ8TruUPF5+d0D5gx1EfkP+Qjl/jr1Tu8r79j0W/5oCIUPQBEFDU8EJPoJ8sjufPEv+TUDFQzAEJ0PGQl4/xH2JPC27+j05/2UB5YOhxDCDJsE6voH86rv9PES+YoCEgu8D/EOAQkAAA/3QvGU8Dn1jP2oBmgNfQ83DMIEuPs69Nnwt/Il+eIB5wlxDvgNsAh2ACf4nvK+8cn1Tv2vBQYMKg5oC8EEh/yV9UvywfNq+UgBngjpDLcMJgjUAFD5LvQs85f2NP2yBHsKlwxZCpMETv0P9/fzDfXi+cAAQwcxCzgLZAcVAX/65vXW9KD3P/25A9IIzwoOCTkEBv6c+NL1kvaL+lEA4QVSCYIJbgY1Aaz7uvex9t74cv3NAhcH3AiPB7MDqP4w+s73SPhk+wAAgARbB6AHSAUxAcz8nfmx+Ev6zP32AVYFywblBQIDL//A++D5Jfpn/ND/LANXBZ4F+QMJAdr9hPvL+t77Tv44AZoDqgQZBCoClv9E/fr7HfyP/cL/7AFTA4cDiAK8AMz+Y/3x/I798/6aAO4BhAI2AjEB3P+x/hH+Jf7W/tb/yABbAWgB/QBNAJ//L/8X/1H/uP8dAFsAZQBHABwA//8=",
  hit: "data:audio/wav;base64,UklGRlQCAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YTACAAAAADsAjABEAFT/kv7+/p4AKwISAgAAev3E/N3+UwI7BKYChv4y+7H7AAC+BNUF+gEV/BL5xvtOAlYHcwYAACP5sfc5/W8Ffgm5Ber8RvaI9wAA3AijCocDJvkd9OH40AP0C1kKAABM9Tbzx/soCBYOZwiF+wTy8fMAAGEMvQ7ZBKr27+9y9hQFzg+WDQAAIvKJ75n6XwrPEZAKZvqd7hbxAAAoD/QR4AW99LXslfQLBrkSBxAAAMfv0ey7+f0LgRQdDJn5NewV7wAAEREmFJMGc/OR6lvzrAaZFJMRAABS7inrNvnyDBMWAQ0m+eHqAO4AAA4SQRXqBtbylOnP8vAGXhUvEgAAzu2c6g35Nw16FjUNEPmp6tztAAAaEkEV5gbn8sDp8vLaBgsV3REAADjuJus++dEMvxW+DFL5g+ui7gAAPhEyFIkGn/MG67rzbQauE6oQAACB77XsxPnMC/UTqQvo+VvtPfAAAI8PKxLdBe30TO0W9bIFZBGuDgAAj/Eq75T6Ogo+EQsKxfoO8JHyAAArDVIP7QS89mjw8Pa2BFQOCwwAAED0XPKg+zYIyQ3+B9z7b/N39QAAOArTC8gD7fgq9Cn5iQOvCuwIAABp9xn22fzgBckJoQUb/Uz3xPgAAOMG5QeAAmD7Wfih+zsCqQZ9BQAA3for+iz+WQN5BRcDcv5s+0n8AABcA74DJgHy/br8Nf7gAHwC8AEAAGv+Wf6I/8QAFQGCAM3/l//T/w=="
};

export function LaunchclipPremiumShort(props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const timeline = normalizedTimeline(props.timeline, props.durationSeconds ?? durationInFrames / fps);
  const scenes = normalizeStoryboard(props.storyboard, timeline);

  return (
    <AbsoluteFill style={{ backgroundColor: colors.paper, color: colors.ink, fontFamily: "Inter, Arial, Helvetica, sans-serif", overflow: "hidden" }}>
      <PremiumBackdrop frame={frame} />
      <TransitionSeries>
        {timeline.map((beat, index) => (
          <React.Fragment key={`${beat.beat}-${index}`}>
            <TransitionSeries.Sequence durationInFrames={Math.max(18, Math.round(beat.duration * fps))}>
              <SceneDirector props={props} beat={beat} scene={scenes[index] ?? fallbackScene(beat, index)} index={index} />
            </TransitionSeries.Sequence>
            {index < timeline.length - 1 ? (
              <TransitionSeries.Transition
                timing={linearTiming({ durationInFrames: Math.max(6, Math.round(fps * 0.28)) })}
                presentation={slide({ direction: index % 2 ? "from-left" : "from-right" })}
              />
            ) : null}
          </React.Fragment>
        ))}
      </TransitionSeries>
      <GlobalSoundDesign timeline={timeline} soundDesign={props.soundDesign} fps={fps} />
      <GlobalRail timeline={timeline} frame={frame} fps={fps} />
    </AbsoluteFill>
  );
}

function SceneDirector({ props, beat, scene, index }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = clamp(frame / Math.max(1, beat.duration * fps));
  const entrance = spring({ frame, fps, config: { damping: 18, stiffness: 130 } });
  const camera = cameraFromPath(scene.camera_path, progress, index);
  const context = { props, beat, scene, index, frame, fps, progress, entrance };
  const id = scene.id || beat.beat;

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <SceneWash id={id} progress={progress} frame={frame} />
      <div style={{ position: "absolute", inset: 0, transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.scale}) rotate(${camera.rotate}deg)`, transformOrigin: "50% 54%" }}>
        {id === "retro-terminal" ? <RetroTerminalScene {...context} /> : null}
        {id === "asset-orbit" ? <AssetOrbitScene {...context} /> : null}
        {id === "prompt-compose" ? <PromptComposeScene {...context} /> : null}
        {id === "collage-proof" ? <CollageProofScene {...context} /> : null}
        {id === "folder-stack" ? <FolderStackScene {...context} /> : null}
        {id === "type-demo" ? <TypeDemoScene {...context} /> : null}
        {id === "cta" ? <CtaScene {...context} /> : null}
        {!["retro-terminal", "asset-orbit", "prompt-compose", "collage-proof", "folder-stack", "type-demo", "cta"].includes(id) ? <ColdOpenScene {...context} /> : null}
      </div>
      <KineticCaption beat={beat} scene={scene} progress={progress} frame={frame} />
    </AbsoluteFill>
  );
}

function ColdOpenScene({ props, beat, progress, entrance, frame }) {
  return (
    <Stage>
      <HeaderLockup eyebrow="premium launchclip renderer" title={beat.caption || "Repo proof -> premium Short"} copy={beat.voiceover} entrance={entrance} />
      <PresenterWindow x={444} y={236} width={176} height={230} progress={progress} />
      <LogoToken props={props} alias="claude-code" label="Claude Code" x={76 + Math.sin(frame / 18) * 18} y={502} size={110} rotate={-8 + progress * 16} />
      <LogoToken props={props} alias="obsidian" label="Obsidian" x={292} y={428 + Math.sin(frame / 14) * 16} size={128} rotate={8 - progress * 12} />
      <LogoToken props={props} alias="github" label="GitHub" x={502} y={574} size={104} rotate={-4 + progress * 10} />
      <BlurredThrow progress={progress} fromX={-210} toX={52} y={760} rotateFrom={-13} rotateTo={-2}>
        <DepthCard title="local proof" body="demo, script, captions, review packet" accent={colors.green} />
      </BlurredThrow>
      <BlurredThrow progress={clamp(progress - 0.18)} fromX={820} toX={196} y={884} rotateFrom={12} rotateTo={3}>
        <DepthCard title="render plan" body="camera paths, type cues, SFX, assets" accent={colors.amber} />
      </BlurredThrow>
    </Stage>
  );
}

function RetroTerminalScene({ props, beat, progress, entrance, frame }) {
  return (
    <Stage>
      <HeaderLockup eyebrow="terminal proof" title={beat.caption} copy={beat.voiceover} entrance={entrance} compact />
      <RetroTerminal x={76} y={292} width={568} height={472} progress={progress} frame={frame} terminal={props.terminal} />
      <MotionObject progress={progress} delay={0.2} from={{ x: 150, y: 960, rotate: 10, scale: 0.86 }} to={{ x: 72, y: 818, rotate: -3, scale: 1 }}>
        <DepthCard title="receipt passed" body="real demo evidence captured" accent={colors.green} small />
      </MotionObject>
      <LogoToken props={props} alias="github" label="GitHub" x={498} y={812} size={96} rotate={4} />
    </Stage>
  );
}

function AssetOrbitScene({ props, beat, progress, entrance, frame }) {
  const centerX = 300;
  const centerY = 620;
  const aliases = [["claude-code", "Claude Code", colors.green], ["obsidian", "Obsidian", colors.purple], ["github", "GitHub", colors.ink]];
  return (
    <Stage>
      <HeaderLockup eyebrow="manifest assets" title={beat.caption} copy={beat.voiceover} entrance={entrance} compact />
      <ConnectorWeb progress={progress} />
      {aliases.map(([alias, label], index) => {
        const angle = frame / 18 + index * 2.05;
        const settle = clamp((progress - 0.58) / 0.28);
        const orbitX = centerX + Math.cos(angle) * (190 - settle * 56);
        const orbitY = centerY + Math.sin(angle) * (162 - settle * 50);
        return <LogoToken key={alias} props={props} alias={alias} label={label} x={orbitX} y={orbitY} size={126 - index * 8} rotate={Math.sin(angle) * 12} />;
      })}
      <PromptComposer x={82} y={766} width={560} height={236} progress={progress} text="Use local assets when the script says Claude Code, Obsidian, and GitHub." />
    </Stage>
  );
}

function PromptComposeScene({ props, beat, progress, entrance, frame }) {
  return (
    <Stage>
      <HeaderLockup eyebrow="prompt composer" title={beat.caption} copy={beat.voiceover} entrance={entrance} compact />
      <PromptComposer x={54} y={300} width={612} height={394} progress={progress} text="Create a premium product short. Use claude-code, obsidian, github. Add typing, blur throws, and review-safe proof." />
      <LogoToken props={props} alias="claude-code" label="Claude Code" x={92} y={738} size={86} rotate={-8 + Math.sin(frame / 10) * 4} />
      <LogoToken props={props} alias="obsidian" label="Obsidian" x={224} y={796} size={86} rotate={6 - Math.sin(frame / 13) * 5} />
      <MotionObject progress={progress} delay={0.42} from={{ x: 782, y: 828, rotate: 14, scale: 0.8 }} to={{ x: 354, y: 768, rotate: -2, scale: 1 }}>
        <DepthCard title="cursor timing" body="typed prompt + SFX cue" accent={colors.blue} small />
      </MotionObject>
    </Stage>
  );
}

function CollageProofScene({ props, beat, progress, entrance, frame }) {
  return (
    <Stage>
      <HeaderLockup eyebrow="proof board" title={beat.caption} copy={beat.voiceover} entrance={entrance} compact />
      <CollageBoard props={props} progress={progress} frame={frame} />
      <ProofBadge label="review before posting" progress={progress} />
    </Stage>
  );
}

function FolderStackScene({ props, beat, progress, entrance, frame }) {
  return (
    <Stage>
      <HeaderLockup eyebrow="physical packet" title={beat.caption} copy={beat.voiceover} entrance={entrance} compact />
      <FolderStack3D progress={progress} frame={frame} />
      {["brief.md", "captions/*.md", "render-plan.json"].map((label, index) => (
        <BlurredThrow key={label} progress={clamp(progress * 1.3 - index * 0.18)} fromX={index % 2 ? 820 : -240} toX={76 + index * 132} y={785 + index * 66} rotateFrom={index % 2 ? 20 : -18} rotateTo={index % 2 ? 5 : -4}>
          <DepthCard title={label} body="launch packet artifact" accent={[colors.green, colors.amber, colors.blue][index]} small />
        </BlurredThrow>
      ))}
      <LogoToken props={props} alias="github" label="GitHub" x={512 + Math.sin(frame / 15) * 10} y={896} size={92} rotate={-8} />
    </Stage>
  );
}

function TypeDemoScene({ props, beat, progress, entrance, frame }) {
  const terminalProgress = clamp((progress - 0.48) / 0.42);
  return (
    <Stage>
      <HeaderLockup eyebrow="editable typing" title={beat.caption} copy={beat.voiceover} entrance={entrance} compact />
      <TypewriterPanel x={54} y={282} width={612} height={248} title="prompt-example" progress={progress} text="Make the Claude Code moment feel physical. Add Obsidian context. Keep proof review-safe." />
      <RetroTerminal x={86} y={596} width={550} height={300} progress={terminalProgress} frame={frame} terminal={props.terminal} compact />
      <ProofBadge label="SFX cues aligned" progress={progress} />
    </Stage>
  );
}

function CtaScene({ props, beat, progress, entrance, frame }) {
  return (
    <Stage>
      <HeaderLockup eyebrow="approval boundary" title={beat.caption} copy={beat.voiceover} entrance={entrance} />
      <div style={{ position: "absolute", left: 60, right: 60, top: 548, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {["claims grounded", "assets swappable", "review packet", "no live post"].map((item, index) => (
          <CheckTile key={item} label={item} active={progress > 0.12 + index * 0.12} />
        ))}
      </div>
      <LogoToken props={props} alias="claude-code" label="Claude Code" x={106 + Math.sin(frame / 18) * 8} y={826} size={88} rotate={-5} />
      <LogoToken props={props} alias="obsidian" label="Obsidian" x={242} y={876 + Math.sin(frame / 20) * 9} size={88} rotate={4} />
      <LogoToken props={props} alias="github" label="GitHub" x={380 + Math.sin(frame / 16) * 7} y={828} size={88} rotate={-3} />
      <div style={{ position: "absolute", left: 60, right: 60, bottom: 150, padding: "28px 30px", borderRadius: 20, background: colors.ink, color: colors.white, boxShadow: `0 32px 80px ${colors.shadow}` }}>
        <div style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase", color: colors.green }}>open the packet</div>
        <div style={{ marginTop: 12, fontSize: 24, lineHeight: 1.05, fontWeight: 900 }}>{shorten(props.repo?.url || props.repo?.name || "launchclip workspace", 68)}</div>
      </div>
    </Stage>
  );
}

function MotionObject({ children, progress, from, to, delay = 0, duration = 0.38 }) {
  const p = ease(clamp((progress - delay) / duration));
  const x = interpolate(p, [0, 1], [from.x, to.x]);
  const y = interpolate(p, [0, 1], [from.y, to.y]);
  const rotate = interpolate(p, [0, 1], [from.rotate ?? 0, to.rotate ?? 0]);
  const scale = interpolate(p, [0, 1], [from.scale ?? 1, to.scale ?? 1]);
  const blur = Math.sin(p * Math.PI) * 10;
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: `rotate(${rotate}deg) scale(${scale})`, filter: `blur(${blur}px)`, opacity: p }}>
      {children}
    </div>
  );
}

function BlurredThrow({ children, progress, fromX, toX, y, rotateFrom, rotateTo }) {
  const p = ease(progress);
  const x = interpolate(p, [0, 1], [fromX, toX]);
  const rotate = interpolate(p, [0, 0.82, 1], [rotateFrom, rotateTo * 1.35, rotateTo]);
  const blur = Math.sin(p * Math.PI) * 14;
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: `rotate(${rotate}deg)`, opacity: p }}>
      {[2, 1].map((ghost) => (
        <div key={ghost} style={{ position: "absolute", inset: 0, transform: `translateX(${-ghost * 18}px)`, opacity: 0.16 / ghost, filter: `blur(${blur + ghost * 4}px)` }}>
          {children}
        </div>
      ))}
      <div style={{ position: "relative", filter: `blur(${blur * 0.18}px)` }}>{children}</div>
    </div>
  );
}

function LogoToken({ props, alias, label, x, y, size, rotate = 0 }) {
  const asset = props.publicAssets?.aliases?.[alias] ?? props.assets?.aliases?.[alias];
  const initials = label.split(/\s+/).map((part) => part[0]).join("").slice(0, 3).toUpperCase();
  const image = asset?.src && asset.type !== "text" && asset.type !== "audio" && asset.type !== "font";
  return (
    <div style={{ position: "absolute", left: x, top: y, width: size, height: size, borderRadius: 22, background: colors.white, border: `1px solid ${colors.line}`, boxShadow: `0 24px 62px ${colors.shadow}`, display: "grid", placeItems: "center", transform: `rotate(${rotate}deg)`, overflow: "hidden" }}>
      {image ? <Img src={staticFile(asset.src)} style={{ width: size * 0.68, height: size * 0.68, objectFit: "contain" }} /> : <div style={{ width: size * 0.58, height: size * 0.58, borderRadius: 18, background: colors.ink, color: colors.paper, display: "grid", placeItems: "center", fontSize: Math.max(18, size * 0.2), fontWeight: 900 }}>{initials}</div>}
      <div style={{ position: "absolute", left: 8, right: 8, bottom: 8, padding: "5px 6px", borderRadius: 8, background: "rgba(17,20,17,0.82)", color: colors.white, fontSize: 10, lineHeight: 1, fontWeight: 900, textAlign: "center" }}>{shorten(label, 18)}</div>
    </div>
  );
}

function TypewriterPanel({ x, y, width, height, title, text, progress }) {
  const frame = useCurrentFrame();
  const typed = reveal(text, clamp((progress - 0.08) / 0.78));
  const cursorOn = Math.floor(frame / 8) % 2 === 0;
  return (
    <div style={{ position: "absolute", left: x, top: y, width, height, borderRadius: 24, background: colors.ink, color: colors.white, boxShadow: `0 30px 86px ${colors.shadow}`, padding: 26, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 58, background: "#171d18", display: "flex", alignItems: "center", gap: 8, paddingLeft: 24 }}>
        {[colors.coral, colors.amber, colors.green].map((color) => <div key={color} style={{ width: 12, height: 12, borderRadius: 999, background: color }} />)}
        <div style={{ marginLeft: 10, fontSize: 12, fontWeight: 900, color: "rgba(255,255,255,0.58)" }}>{title}</div>
      </div>
      <div style={{ marginTop: 66, fontFamily: "Menlo, Consolas, monospace", fontSize: 24, lineHeight: 1.35, fontWeight: 750, color: colors.green }}>
        {typed}
        <span style={{ display: "inline-block", width: 11, height: 28, marginLeft: 6, transform: "translateY(5px)", background: colors.green, opacity: cursorOn ? 1 : 0.18 }} />
      </div>
    </div>
  );
}

function PromptComposer({ x, y, width, height, progress, text }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width, height }}>
      <TypewriterPanel x={0} y={0} width={width} height={height} title="prompt composer" text={text} progress={progress} />
      <div style={{ position: "absolute", left: 24, bottom: 24, display: "flex", gap: 8 }}>
        {["claude-code", "obsidian", "github"].map((chip, index) => (
          <div key={chip} style={{ padding: "8px 10px", borderRadius: 999, background: progress > 0.35 + index * 0.12 ? colors.green : "rgba(255,255,255,0.12)", color: progress > 0.35 + index * 0.12 ? colors.ink : colors.white, fontSize: 12, fontWeight: 900 }}>{chip}</div>
        ))}
      </div>
    </div>
  );
}

function RetroTerminal({ x, y, width, height, progress, frame, terminal, compact = false }) {
  const lines = String(terminal || "$ npm run smoke\n\nSmoke OK").split("\n").filter(Boolean);
  const command = lines.find((line) => line.startsWith("$ ")) || "$ npm run smoke";
  const output = lines.filter((line) => line !== command).join("\n") || "Demo completed and evidence was captured locally.";
  const typedCommand = reveal(command, clamp(progress / 0.45));
  const typedOutput = reveal(shorten(output, compact ? 108 : 210), clamp((progress - 0.42) / 0.48));
  const scanY = 78 + ((frame * 4) % Math.max(1, height - 110));
  const cursorOn = Math.floor(frame / 7) % 2 === 0;
  return (
    <div style={{ position: "absolute", left: x, top: y, width, height, borderRadius: compact ? 22 : 34, background: colors.graphite, boxShadow: `0 34px 90px ${colors.shadow}`, padding: compact ? 14 : 20, transform: `rotate(${interpolate(progress, [0, 1], [-3, 1])}deg)` }}>
      <div style={{ position: "relative", height: "100%", borderRadius: compact ? 16 : 26, overflow: "hidden", background: "#07120b", color: colors.green, padding: compact ? "42px 22px 18px" : "64px 30px 22px" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: scanY, height: 18, background: "linear-gradient(180deg, transparent, rgba(34,197,94,0.17), transparent)" }} />
        <div style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase" }}>launchclip demo</div>
        <div style={{ marginTop: 22, fontFamily: "Menlo, Consolas, monospace", fontSize: compact ? 17 : 22, lineHeight: 1.4, fontWeight: 800 }}>
          {typedCommand}
          <span style={{ display: "inline-block", width: 10, height: compact ? 19 : 25, marginLeft: 6, transform: "translateY(4px)", background: colors.green, opacity: cursorOn ? 1 : 0.2 }} />
        </div>
        <div style={{ marginTop: 22, fontFamily: "Menlo, Consolas, monospace", fontSize: compact ? 14 : 17, lineHeight: 1.38, color: "rgba(223,231,220,0.78)", whiteSpace: "pre-wrap" }}>{typedOutput}</div>
      </div>
    </div>
  );
}

function CollageBoard({ props, progress, frame }) {
  const items = [
    ["video/brief.md", colors.green],
    ["render-plan.json", colors.blue],
    ["captions/*.md", colors.amber],
    ["REVIEW.md", colors.coral],
    ["dry-run payload", colors.purple]
  ];
  const active = Math.floor(frame / 14) % items.length;
  return (
    <div style={{ position: "absolute", left: 48, top: 302, width: 624, height: 592, borderRadius: 30, background: colors.white, border: `1px solid ${colors.line}`, boxShadow: `0 34px 90px ${colors.shadow}`, transform: `rotate(${interpolate(progress, [0, 1], [2.5, -1])}deg)` }}>
      {items.map(([label, accent], index) => {
        const p = clamp(progress * 5.4 - index * 0.62);
        return (
          <div key={label} style={{ position: "absolute", left: 30 + (index % 2) * 290, top: 38 + Math.floor(index / 2) * 148, width: active === index ? 282 : 252, height: active === index ? 122 : 106, borderRadius: 18, background: active === index ? colors.ink : colors.paper, color: active === index ? colors.white : colors.ink, padding: 18, boxShadow: `0 20px 55px ${colors.shadow}`, opacity: p, transform: `translateY(${(1 - p) * 42}px) rotate(${active === index ? -2 : 1}deg)` }}>
            <div style={{ width: 46, height: 10, borderRadius: 999, background: accent }} />
            <div style={{ marginTop: 16, fontSize: active === index ? 25 : 21, lineHeight: 1, fontWeight: 900 }}>{label}</div>
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: 800, opacity: 0.62 }}>{index === active ? "inspection zoom" : "generated artifact"}</div>
          </div>
        );
      })}
      <LogoToken props={props} alias="github" label="GitHub" x={444} y={410} size={86} rotate={8} />
    </div>
  );
}

function FolderStack3D({ progress, frame }) {
  const rotation = progress * Math.PI * 1.2 + Math.sin(frame / 20) * 0.1;
  return (
    <div style={{ position: "absolute", left: 40, top: 312, width: 640, height: 430, filter: "drop-shadow(0 38px 60px rgba(17,20,17,0.28))" }}>
      <ThreeCanvas width={640} height={430} camera={{ position: [0, 0, 5.2], fov: 44 }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
        <ambientLight intensity={1.2} />
        <directionalLight position={[2, 3, 4]} intensity={2.2} />
        <mesh rotation={[0.38, rotation, -0.1]} position={[0, 0, 0]}>
          <boxGeometry args={[2.9, 1.72, 0.18]} />
          <meshStandardMaterial color={colors.green} roughness={0.55} metalness={0.08} />
        </mesh>
        <mesh rotation={[0.38, rotation + 0.18, -0.02]} position={[0.22, 0.14, -0.18]}>
          <boxGeometry args={[2.65, 1.46, 0.12]} />
          <meshStandardMaterial color={colors.paper} roughness={0.72} />
        </mesh>
        <mesh rotation={[0.38, rotation - 0.22, 0.08]} position={[-0.18, -0.08, 0.2]}>
          <boxGeometry args={[2.52, 1.34, 0.1]} />
          <meshStandardMaterial color={colors.amber} roughness={0.7} />
        </mesh>
      </ThreeCanvas>
    </div>
  );
}

function DepthCard({ title, body, accent, small = false }) {
  return (
    <div style={{ width: small ? 214 : 324, minHeight: small ? 110 : 152, borderRadius: small ? 18 : 24, background: colors.white, color: colors.ink, border: `1px solid ${colors.line}`, boxShadow: `0 24px 70px ${colors.shadow}`, padding: small ? 18 : 24 }}>
      <div style={{ width: small ? 42 : 58, height: 9, borderRadius: 999, background: accent }} />
      <div style={{ marginTop: 16, fontSize: small ? 22 : 31, lineHeight: 0.98, fontWeight: 900 }}>{title}</div>
      <div style={{ marginTop: 12, fontSize: small ? 12 : 15, lineHeight: 1.22, fontWeight: 760, color: "rgba(17,20,17,0.62)" }}>{body}</div>
    </div>
  );
}

function PresenterWindow({ x, y, width, height, progress }) {
  const mouth = 8 + Math.sin(progress * Math.PI * 7) * 4;
  return (
    <div style={{ position: "absolute", left: x, top: y, width, height, borderRadius: 24, background: colors.graphite, boxShadow: `0 26px 70px ${colors.shadow}`, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 10, borderRadius: 18, background: `linear-gradient(145deg, ${colors.soft}, ${colors.paper} 52%, #a8d1bb)` }} />
      <div style={{ position: "absolute", left: width * 0.28, top: height * 0.15, width: width * 0.44, height: height * 0.26, borderRadius: "48%", background: colors.ink }} />
      <div style={{ position: "absolute", left: width * 0.2, right: width * 0.2, bottom: height * 0.19, height: height * 0.36, borderRadius: "40px 40px 18px 18px", background: colors.ink }} />
      <div style={{ position: "absolute", left: width * 0.43, top: height * 0.32, width: width * 0.14, height: mouth, borderRadius: 999, background: colors.green }} />
      <div style={{ position: "absolute", left: 12, top: 12, padding: "5px 8px", borderRadius: 999, background: colors.white, fontSize: 10, fontWeight: 900 }}>host</div>
    </div>
  );
}

function HeaderLockup({ eyebrow, title, copy, entrance, compact = false }) {
  return (
    <div style={{ position: "absolute", left: 48, right: 48, top: compact ? 106 : 94, transform: `translateY(${(1 - entrance) * 38}px)`, opacity: entrance }}>
      <div style={{ display: "inline-block", padding: "8px 11px", borderRadius: 8, background: colors.green, color: colors.ink, fontSize: 12, lineHeight: 1, fontWeight: 900, textTransform: "uppercase" }}>{eyebrow}</div>
      <div style={{ marginTop: 16, fontSize: compact ? 54 : 72, lineHeight: 0.92, fontWeight: 900, maxWidth: compact ? 520 : 600 }}>{title}</div>
      <div style={{ marginTop: 16, fontSize: compact ? 17 : 20, lineHeight: 1.18, fontWeight: 760, maxWidth: compact ? 510 : 455, color: "rgba(17,20,17,0.68)" }}>{shorten(copy, compact ? 136 : 126)}</div>
    </div>
  );
}

function KineticCaption({ beat, scene, progress, frame }) {
  const words = splitCaption(beat.caption || scene.hook || beat.beat);
  return (
    <div style={{ position: "absolute", left: 34, right: 34, bottom: 76, zIndex: 20, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 9 }}>
      {words.map((word, index) => {
        const p = clamp(progress * 5 - index * 0.28);
        const tilt = Math.sin(frame / 8 + index) * 1.2;
        return (
          <span key={`${word}-${index}`} style={{ display: "inline-block", padding: "9px 13px 11px", borderRadius: 10, background: index % 2 ? colors.green : colors.ink, color: index % 2 ? colors.ink : colors.white, fontSize: Math.max(32, 52 - words.length * 2), lineHeight: 0.95, fontWeight: 900, boxShadow: `0 18px 42px ${colors.shadow}`, opacity: p, transform: `translateY(${(1 - p) * 24}px) rotate(${tilt}deg) scale(${0.9 + p * 0.1})` }}>
            {word}
          </span>
        );
      })}
    </div>
  );
}

function GlobalSoundDesign({ timeline, soundDesign, fps }) {
  const cues = Array.isArray(soundDesign?.cues) ? soundDesign.cues : [];
  return (
    <>
      {timeline.map((beat, index) => {
        const cue = cues[index] ?? {};
        const from = Math.max(0, Math.round((beat.start + 0.03) * fps));
        return (
          <Sequence key={`${beat.beat}-sfx-${index}`} from={from}>
            <Audio src={sfxSourceFor(cue, beat)} volume={cue.intensity === "high" ? 0.2 : 0.14} />
          </Sequence>
        );
      })}
    </>
  );
}

function PremiumBackdrop({ frame }) {
  const drift = Math.sin(frame / 64) * 18;
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(145deg, ${colors.paper}, #e8efdf 54%, #111411 155%)` }} />
      <div style={{ position: "absolute", inset: 0, opacity: 0.48, backgroundImage: "linear-gradient(90deg, rgba(17,20,17,0.055) 1px, transparent 1px), linear-gradient(rgba(17,20,17,0.055) 1px, transparent 1px)", backgroundSize: "74px 74px", transform: `translate(${drift}px, ${-drift}px)` }} />
    </AbsoluteFill>
  );
}

function SceneWash({ id, progress, frame }) {
  const accent = id === "asset-orbit" ? colors.purple : id === "folder-stack" ? colors.amber : colors.green;
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 0, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: -120 + progress * 260, top: 210 + Math.sin(frame / 30) * 24, width: 840, height: 340, borderRadius: 40, background: accent, opacity: 0.08, transform: "rotate(-8deg)" }} />
      <div style={{ position: "absolute", right: -90, bottom: 90, width: 320, height: 320, borderRadius: 38, background: colors.ink, opacity: 0.05, transform: `rotate(${frame / 18}deg)` }} />
    </div>
  );
}

function ConnectorWeb({ progress }) {
  return (
    <div style={{ position: "absolute", left: 76, right: 76, top: 470, height: 306, opacity: 0.78 }}>
      {[0, 1, 2, 3].map((index) => (
        <div key={index} style={{ position: "absolute", left: 24 + index * 114, top: 70 + Math.sin(index) * 40, width: 210, height: 4, borderRadius: 999, background: colors.green, transformOrigin: "left center", transform: `rotate(${index % 2 ? 28 : -22}deg) scaleX(${clamp(progress * 1.5 - index * 0.18)})` }} />
      ))}
    </div>
  );
}

function CheckTile({ label, active }) {
  return (
    <div style={{ height: 84, borderRadius: 18, background: active ? colors.ink : colors.white, color: active ? colors.white : colors.ink, border: `1px solid ${colors.line}`, display: "flex", alignItems: "center", gap: 14, padding: "0 18px", boxShadow: `0 18px 44px ${colors.shadow}` }}>
      <div style={{ width: 30, height: 30, borderRadius: 9, background: active ? colors.green : "rgba(17,20,17,0.12)", color: colors.ink, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 900 }}>{active ? "OK" : ""}</div>
      <div style={{ fontSize: 19, lineHeight: 1, fontWeight: 900 }}>{label}</div>
    </div>
  );
}

function ProofBadge({ label, progress }) {
  return (
    <div style={{ position: "absolute", left: 82, bottom: 246, padding: "15px 18px", borderRadius: 16, background: colors.green, color: colors.ink, fontSize: 23, lineHeight: 1, fontWeight: 900, boxShadow: `0 20px 54px ${colors.shadow}`, transform: `rotate(-3deg) scale(${0.82 + clamp(progress * 1.4) * 0.18})` }}>{label}</div>
  );
}

function GlobalRail({ timeline, frame, fps }) {
  const now = frame / fps;
  return (
    <div style={{ position: "absolute", left: 42, right: 42, bottom: 34, zIndex: 28, display: "grid", gridTemplateColumns: `repeat(${Math.max(1, timeline.length)}, 1fr)`, gap: 7 }}>
      {timeline.map((beat, index) => <div key={`${beat.beat}-${index}`} style={{ height: 8, borderRadius: 999, background: now >= beat.start ? colors.ink : "rgba(17,20,17,0.14)" }} />)}
    </div>
  );
}

function Stage({ children }) {
  return <div style={{ position: "absolute", inset: 0, zIndex: 2 }}>{children}</div>;
}

function cameraFromPath(path, progress, index) {
  if (!Array.isArray(path) || path.length < 2) {
    return { x: Math.sin(progress * Math.PI * 2 + index) * 12, y: interpolate(progress, [0, 1], [8, -10]), scale: 1 + progress * 0.04, rotate: 0 };
  }
  const points = [...path].sort((a, b) => a.t - b.t);
  let left = points[0];
  let right = points[points.length - 1];
  for (let i = 0; i < points.length - 1; i += 1) {
    if (progress >= points[i].t && progress <= points[i + 1].t) {
      left = points[i];
      right = points[i + 1];
      break;
    }
  }
  const local = ease(clamp((progress - left.t) / Math.max(0.001, right.t - left.t)));
  return {
    x: interpolate(local, [0, 1], [left.x ?? 0, right.x ?? 0]),
    y: interpolate(local, [0, 1], [left.y ?? 0, right.y ?? 0]),
    scale: interpolate(local, [0, 1], [left.scale ?? 1, right.scale ?? 1]),
    rotate: interpolate(local, [0, 1], [left.rotate ?? 0, right.rotate ?? 0])
  };
}

function normalizedTimeline(timeline, durationSeconds) {
  const raw = Array.isArray(timeline) && timeline.length ? timeline : [fallbackBeat("launchclip")];
  return raw.map((beat, index) => {
    const range = parseRange(beat.time_range);
    const start = Number.isFinite(range.start) ? range.start : raw.slice(0, index).reduce((sum, item) => sum + Number(item.target_seconds ?? 3), 0);
    const end = Number.isFinite(range.end) ? range.end : Math.min(durationSeconds, start + Number(beat.target_seconds ?? 3));
    return { ...beat, start, end, duration: Math.max(0.5, end - start) };
  });
}

function normalizeStoryboard(storyboard, timeline) {
  const scenes = storyboard?.scenes;
  if (!Array.isArray(scenes) || !scenes.length) return timeline.map((beat, index) => fallbackScene(beat, index));
  return timeline.map((beat, index) => scenes[index] ?? scenes.find((scene) => scene.id === beat.beat) ?? fallbackScene(beat, index));
}

function fallbackBeat(repoName) {
  return {
    beat: "cold-open",
    time_range: "0-4s",
    target_seconds: 4,
    caption: "Premium Short",
    voiceover: `${repoName} becomes a premium Launchclip product short.`,
    visual: "Moving product cards and typed proof.",
    start: 0,
    end: 4,
    duration: 4
  };
}

function fallbackScene(beat, index) {
  return {
    id: beat.beat,
    hook: beat.caption,
    camera_path: [
      { t: 0, scale: 1.02, x: index % 2 ? 18 : -18, y: 12, rotate: index % 2 ? 0.8 : -0.8 },
      { t: 1, scale: 1.06, x: 0, y: -12, rotate: 0 }
    ],
    sfx_cues: ["hit"],
    brand_moments: ["fallback token"]
  };
}

function parseRange(range) {
  const match = String(range ?? "").match(/([\d.]+)\s*-\s*([\d.]+)/);
  return { start: match ? Number(match[1]) : NaN, end: match ? Number(match[2]) : NaN };
}

function sfxSourceFor(cue, beat) {
  const text = `${beat.beat} ${cue.sound || ""} ${cue.trigger || ""}`.toLowerCase();
  if (text.includes("typing") || text.includes("keyboard") || text.includes("cursor") || text.includes("tick")) return sfxSources.tick;
  return sfxSources.hit;
}

function splitCaption(text) {
  const words = String(text ?? "").replace(/->/g, "to").split(/\s+/).filter(Boolean);
  return words.length > 4 ? [words.slice(0, 2).join(" "), words.slice(2, 4).join(" "), words.slice(4).join(" ")] : words;
}

function reveal(text, progress) {
  return String(text ?? "").slice(0, Math.max(1, Math.ceil(String(text ?? "").length * progress)));
}

function shorten(text, max) {
  const value = String(text ?? "");
  if (value.length <= max) return value;
  return value.slice(0, max).trimEnd().replace(/\s+\S*$/, "");
}

function ease(value) {
  return interpolate(value, [0, 1], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

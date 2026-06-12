import React from "react";
import { AbsoluteFill, Html5Audio, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { cameraAt } from "./camera.js";
import { KineticCaption } from "./components/KineticCaption.jsx";
import { LogoPop } from "./components/LogoPop.jsx";

// Renders a motion.timeline.v1 document: real base footage, whole-canvas
// punch-zoom camera, word-timed captions, asset pop-ins, and an SFX layer.
// The base layer is footage or nothing — this engine never draws fake media.
export function MotionLayer({ timeline, enableSfx = true }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const camera = cameraAt({ events: timeline.events, frame, fps });

  return (
    <AbsoluteFill style={{ backgroundColor: "#08090c", overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          transform: `scale(${camera.scale})`,
          transformOrigin: `${camera.originX * 100}% ${camera.originY * 100}%`
        }}
      >
        <BaseLayer base={timeline.base} width={width} height={height} />
      </AbsoluteFill>

      {timeline.events
        .filter((event) => event.type === "logo_pop")
        .map((event) => (
          <LogoPop key={event.id} event={event} width={width} height={height} />
        ))}

      <KineticCaption words={timeline.words} width={width} height={height} />

      {timeline.audio?.voiceover ? <Html5Audio src={resolveSrc(timeline.audio.voiceover)} /> : null}
      {timeline.audio?.music ? (
        <Html5Audio src={resolveSrc(timeline.audio.music)} volume={timeline.audio.music_volume ?? 0.08} />
      ) : null}
      {enableSfx ? <SfxLayer events={timeline.events} fps={fps} /> : null}
    </AbsoluteFill>
  );
}

function BaseLayer({ base, width, height }) {
  if (base?.type === "video" && base.src) {
    return <OffthreadVideo src={resolveSrc(base.src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />;
  }
  return (
    <AbsoluteFill
      style={{
        background: "radial-gradient(120% 90% at 50% 20%, #1c2433 0%, #0b0e14 70%)",
        display: "grid",
        placeItems: "center"
      }}
    >
      <div
        style={{
          maxWidth: width * 0.7,
          textAlign: "center",
          fontFamily: "Inter, Arial, sans-serif",
          color: "rgba(255,255,255,0.55)",
          fontWeight: 800,
          fontSize: Math.round(height * 0.024),
          lineHeight: 1.4
        }}
      >
        No base footage.
        <br />
        Drop your talking-head clip into public/base/ and set base.src in the timeline.
      </div>
    </AbsoluteFill>
  );
}

// Every event fires its sound at its start frame, ducked under the voiceover.
function SfxLayer({ events, fps }) {
  return (
    <>
      {events
        .filter((event) => event.sfx)
        .map((event) => (
          <Sequence key={`sfx-${event.id}`} from={Math.round(event.start * fps)} durationInFrames={Math.round(fps * 1.5)}>
            <Html5Audio src={staticFile(`sfx/${event.sfx}`)} volume={0.5} />
          </Sequence>
        ))}
    </>
  );
}

function resolveSrc(src) {
  if (/^https?:\/\//.test(src)) return src;
  return staticFile(src);
}

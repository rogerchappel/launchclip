import React from "react";
import { AbsoluteFill, Html5Audio, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { cameraAt } from "./camera.js";
import { LogoPop } from "./components/LogoPop.jsx";
import { PaperGround } from "./components/paper.jsx";
import { SceneTrack } from "./components/scenes.jsx";
import { FONTS, INK } from "./theme.js";
import { paperOffsetAt } from "./travel.js";

// Renders a motion.timeline.v1 document in the paper-world grammar: warm
// paper ground, scenes as physical objects on it, a gentle camera, and a
// continuous voice with SFX bound to events and cuts. There is no caption
// track — spoken words are staged by typography scenes.
export function MotionLayer({ timeline, enableSfx = true }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const camera = cameraAt({ events: timeline.events, frame, fps });
  const paperOffset = paperOffsetAt({ scenes: timeline.scenes ?? [], frame, fps, width });

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <PaperGround offsetX={paperOffset} />
      <AbsoluteFill
        style={{
          transform: `scale(${camera.scale})`,
          transformOrigin: `${camera.originX * 100}% ${camera.originY * 100}%`
        }}
      >
        {timeline.scenes?.length ? (
          <SceneTrack scenes={timeline.scenes} width={width} height={height} />
        ) : (
          <BaseLayer base={timeline.base} width={width} height={height} />
        )}
      </AbsoluteFill>

      {timeline.events
        .filter((event) => event.type === "logo_pop")
        .map((event) => (
          <LogoPop key={event.id} event={event} width={width} height={height} />
        ))}

      {timeline.audio?.voiceover ? <Html5Audio src={resolveSrc(timeline.audio.voiceover)} /> : null}
      {timeline.audio?.music ? (
        <Html5Audio src={resolveSrc(timeline.audio.music)} volume={timeline.audio.music_volume ?? 0.08} />
      ) : null}
      {enableSfx ? <SfxLayer events={timeline.events} scenes={timeline.scenes ?? []} fps={fps} /> : null}
    </AbsoluteFill>
  );
}

function BaseLayer({ base, width, height }) {
  if (base?.type === "video" && base.src) {
    return <OffthreadVideo src={resolveSrc(base.src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />;
  }
  return (
    <AbsoluteFill style={{ display: "grid", placeItems: "center" }}>
      <div
        style={{
          maxWidth: width * 0.7,
          textAlign: "center",
          fontFamily: FONTS.sans,
          color: INK.muted,
          fontWeight: 600,
          fontSize: Math.round(height * 0.022),
          lineHeight: 1.5
        }}
      >
        No scenes and no base footage.
        <br />
        Author scenes[] in the timeline, or drop a clip into public/base/.
      </div>
    </AbsoluteFill>
  );
}

// Every event fires its sound at its start frame, and every scene cut after
// the first fires a whoosh — bound automatically, never authored per-scene.
function SfxLayer({ events, scenes, fps }) {
  return (
    <>
      {events
        .filter((event) => event.sfx)
        .map((event) => (
          <Sequence key={`sfx-${event.id}`} from={Math.round(event.start * fps)} durationInFrames={Math.round(fps * 1.5)}>
            <Html5Audio src={staticFile(`sfx/${event.sfx}`)} volume={0.5} />
          </Sequence>
        ))}
      {scenes.slice(1).map((scene) => (
        <Sequence key={`cut-${scene.id}`} from={Math.round(scene.start * fps)} durationInFrames={Math.round(fps * 1.5)}>
          <Html5Audio src={staticFile("sfx/whoosh.wav")} volume={0.45} />
        </Sequence>
      ))}
    </>
  );
}

function resolveSrc(src) {
  if (/^https?:\/\//.test(src)) return src;
  return staticFile(src);
}

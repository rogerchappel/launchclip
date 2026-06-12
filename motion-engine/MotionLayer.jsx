import React from "react";
import { AbsoluteFill, Html5Audio, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { cameraAt } from "./camera.js";
import { LogoPop } from "./components/LogoPop.jsx";
import { PaperGround } from "./components/paper.jsx";
import { SceneTrack } from "./components/scenes.jsx";
import { ChapterRail } from "./components/ChapterRail.jsx";
import { FONTS, INK } from "./theme.js";
import { paperOffsetAt } from "./travel.js";
import { SCENE_SFX } from "./schema.js";

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

      {timeline.chapters?.length ? <ChapterRail chapters={timeline.chapters} width={width} height={height} /> : null}

      {timeline.events
        .filter((event) => event.type === "logo_pop")
        .map((event) => (
          <LogoPop key={event.id} event={event} width={width} height={height} />
        ))}

      {timeline.audio?.voiceover ? <Html5Audio src={resolveSrc(timeline.audio.voiceover)} /> : null}
      {timeline.audio?.music ? (
        <MusicBed
          src={resolveSrc(timeline.audio.music)}
          baseVolume={timeline.audio.music_volume ?? 0.08}
          durationSeconds={timeline.duration_seconds}
        />
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

// The music bed eases in, sits under the voice, and drops out entirely for
// the final beat so the CTA lands in (relative) silence.
function MusicBed({ src, baseVolume, durationSeconds }) {
  const { fps } = useVideoConfig();
  return (
    <Html5Audio
      src={src}
      volume={(frame) => {
        const seconds = frame / fps;
        const fadeIn = Math.min(1, seconds / 0.6);
        const tail = durationSeconds - seconds;
        const fadeOut = tail < 1.2 ? Math.max(0, tail / 1.2) : 1;
        return baseVolume * fadeIn * fadeOut;
      }}
    />
  );
}

// Sound design, bound automatically — never authored per-scene:
// every travel/cut whooshes, prompt cards type while their text types,
// step chips click as they land, the final icon node hits a retro success.
function SfxLayer({ events, scenes, fps }) {
  const sounds = [];
  for (const event of events) {
    if (!event.sfx) continue;
    sounds.push({ key: `sfx-${event.id}`, at: event.start, sfx: event.sfx, volume: 0.18 });
  }
  scenes.forEach((scene, index) => {
    // Whoosh only when the camera actually travels — hard cuts stay silent,
    // and the level sits well under the voice.
    if (index > 0 && scene.transition !== "cut") {
      sounds.push({ key: `cut-${scene.id}`, at: scene.start - 0.18, sfx: SCENE_SFX.cut, volume: 0.12 });
    }
    if (scene.type === "prompt_card") {
      const typingSeconds = Math.max(0.6, scene.end - scene.start - 1.1);
      sounds.push({ key: `type-${scene.id}`, at: scene.start + 0.35, sfx: SCENE_SFX.prompt_typing, volume: 0.2, holdSeconds: typingSeconds });
    }
    if (scene.type === "card_steps") {
      scene.items.forEach((item, itemIndex) => {
        sounds.push({ key: `step-${scene.id}-${itemIndex}`, at: item.at, sfx: SCENE_SFX.step_item, volume: 0.22 });
      });
    }
    if (scene.type === "icon_flow") {
      scene.items.forEach((item, itemIndex) => {
        const last = itemIndex === scene.items.length - 1;
        sounds.push({ key: `icon-${scene.id}-${itemIndex}`, at: item.at, sfx: last ? SCENE_SFX.icon_final : SCENE_SFX.icon_item, volume: last ? 0.3 : 0.22 });
      });
    }
  });
  return (
    <>
      {sounds.map((sound) => (
        <Sequence
          key={sound.key}
          from={Math.max(0, Math.round(sound.at * fps))}
          durationInFrames={Math.round(fps * (sound.holdSeconds ?? 1.5))}
        >
          <Html5Audio src={staticFile(`sfx/${sound.sfx}`)} volume={sound.volume} />
        </Sequence>
      ))}
    </>
  );
}

function resolveSrc(src) {
  if (/^https?:\/\//.test(src)) return src;
  return staticFile(src);
}

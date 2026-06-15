import React from "react";
import { AbsoluteFill, Html5Audio, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { cameraAt } from "./camera.js";
import { LogoPop } from "./components/LogoPop.jsx";
import { PaperGround } from "./components/paper.jsx";
import { SceneTrack } from "./components/scenes.jsx";
import { ChapterRail } from "./components/ChapterRail.jsx";
import { FONTS, INK } from "./theme.js";
import { SCENE_SFX } from "./schema.js";

// Renders a motion.timeline.v1 document in the paper-world grammar: warm
// paper ground, scenes as physical objects on it, a gentle camera, and a
// continuous voice with SFX bound to events and cuts. There is no caption
// track — spoken words are staged by typography scenes.
// The tabletop is viewed from slightly above (ART_DIRECTION 4f, P4 teardown):
// the whole world — grid and every scene — sits on one plane tilted back a
// few degrees, so cards higher on the table recede into depth and shadows
// fall onto the angled surface. A gentle rotateX with a soft perspective; a
// small rotateY adds the "looking from the side" feel seen in the reference.
// The plane is scaled up so the receded top edge still fills the frame.
// Tune by eye here; the lens and chapter rail stay screen-aligned (UI lives
// in front of the glass, not on the table).
// Gentle tabletop tilt. The CONTENT plane is NOT scaled up (scaling it cropped
// every edge — the P4-fit bug); instead the paper is oversized to cover the
// thin gap the tilt opens at the top, so content keeps its true frame and
// nothing bleeds off-screen.
const WORLD = { perspective: 2400, tiltX: 5, tiltY: -1.5, originY: 44 };

// Ambient drift: a barely-there scale breath so the canvas is never bit-for-
// bit frozen. Sub-pixel per frame — a slow living stillness, NOT a visible
// zoom or pan (the perceptible per-scene drift read as an aimless zoom over
// content that was itself being cropped, so it was removed).
function ambientDrift(frame, fps) {
  const t = frame / fps;
  return { scale: 1 + 0.004 * (0.5 + 0.5 * Math.sin(t * 0.2)) };
}

export function MotionLayer({ timeline, enableSfx = true }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const camera = cameraAt({ events: timeline.events, frame, fps });
  const drift = ambientDrift(frame, fps);

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ perspective: `${WORLD.perspective}px`, perspectiveOrigin: `50% ${WORLD.originY}%` }}>
        <AbsoluteFill
          style={{
            transform: `rotateX(${WORLD.tiltX}deg) rotateY(${WORLD.tiltY}deg) scale(${drift.scale})`,
            transformOrigin: "50% 50%"
          }}
        >
          {/* Oversized so the tilt never opens a paper gap, while content below
              keeps its true 100% frame and never crops. */}
          <div style={{ position: "absolute", inset: "-10%" }}>
            <PaperGround />
          </div>
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
        </AbsoluteFill>
      </AbsoluteFill>

      <LensEdge />

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
          beatTimes={musicBeatTimes(timeline.events, timeline.scenes ?? [])}
        />
      ) : null}
      {enableSfx ? <SfxLayer events={timeline.events} scenes={timeline.scenes ?? []} fps={fps} /> : null}
    </AbsoluteFill>
  );
}

// The lens (ART_DIRECTION 4e): the frame behaves like a macro lens focused on
// the middle of the table — the whole perimeter (sides and corners) falls off
// into a progressive gaussian blur, and ANY element travelling into that zone
// blurs with it. Three stacked backdrop-filter rings build the gradual
// falloff; each ring blurs the already-blurred output of the one behind it, so
// the strength compounds outward. The focus ellipse is WIDE so the left/right
// margins — where cards and text sit — stay crisp; the blur concentrates at
// the top/bottom and into the corners, like a tall lens. Only the very
// corners reach full strength.
const LENS_RINGS = [
  { blur: 2, mask: "radial-gradient(86% 58% at 50% 46%, rgba(0,0,0,0) 54%, #000 80%)" },
  { blur: 5, mask: "radial-gradient(86% 58% at 50% 46%, rgba(0,0,0,0) 72%, #000 92%)" },
  { blur: 9, mask: "radial-gradient(86% 58% at 50% 46%, rgba(0,0,0,0) 90%, #000 100%)" }
];

function LensEdge() {
  return (
    <>
      {LENS_RINGS.map((ring, index) => (
        <AbsoluteFill
          key={index}
          style={{
            backdropFilter: `blur(${ring.blur}px)`,
            WebkitBackdropFilter: `blur(${ring.blur}px)`,
            maskImage: ring.mask,
            WebkitMaskImage: ring.mask,
            pointerEvents: "none"
          }}
        />
      ))}
    </>
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
function MusicBed({ src, baseVolume, durationSeconds, beatTimes = [] }) {
  const { fps } = useVideoConfig();
  return (
    <Html5Audio
      src={src}
      volume={(frame) => {
        const seconds = frame / fps;
        const fadeIn = Math.min(1, seconds / 0.6);
        const tail = durationSeconds - seconds;
        const fadeOut = tail < 1.2 ? Math.max(0, tail / 1.2) : 1;
        const beatDuck = beatDucking(seconds, beatTimes);
        return baseVolume * fadeIn * fadeOut * beatDuck;
      }}
    />
  );
}

function musicBeatTimes(events, scenes) {
  const beats = [];
  for (const event of events) {
    if (event.type === "punch_zoom" || event.type === "logo_pop") beats.push(event.start);
  }
  for (const scene of scenes) {
    if (Array.isArray(scene.items)) {
      scene.items.forEach((item) => {
        if (Number.isFinite(item.at)) beats.push(item.at);
      });
    }
    if (scene.branch && Number.isFinite(scene.branch.at)) beats.push(scene.branch.at);
    if (scene.total && Number.isFinite(scene.total.at)) beats.push(scene.total.at);
    if (Number.isFinite(scene.at)) beats.push(scene.at);
  }
  return [...new Set(beats.map((beat) => Number(beat.toFixed(2))))].sort((a, b) => a - b);
}

function beatDucking(seconds, beatTimes) {
  let duck = 0;
  for (const beat of beatTimes) {
    const distance = seconds - beat;
    if (distance < 0 || distance > 0.28) continue;
    duck = Math.max(duck, 1 - distance / 0.28);
  }
  return 1 - duck * 0.18;
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
  scenes.forEach((scene) => {
    // No transition sound: the per-beat whoosh is retired (4e) — scene
    // changes are silent cuts; SFX belong to builds, not boundaries.
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
    if (scene.type === "funnel") {
      scene.items.forEach((item, itemIndex) => {
        sounds.push({ key: `funnel-${scene.id}-${itemIndex}`, at: item.at, sfx: SCENE_SFX.funnel_item, volume: 0.18 });
      });
      if (scene.branch?.at !== undefined) {
        sounds.push({ key: `funnel-branch-${scene.id}`, at: scene.branch.at, sfx: SCENE_SFX.funnel_branch, volume: 0.24 });
      }
    }
    if (scene.type === "profile_cards") {
      scene.items.forEach((item, itemIndex) => {
        sounds.push({ key: `profile-${scene.id}-${itemIndex}`, at: item.at, sfx: SCENE_SFX.profile_card, volume: 0.18 });
      });
      if (scene.total?.at !== undefined) {
        sounds.push({ key: `profile-total-${scene.id}`, at: scene.total.at, sfx: SCENE_SFX.profile_total, volume: 0.28 });
      }
    }
    if (scene.type === "magnifier") {
      const focusAt = scene.start + (scene.end - scene.start) * 0.58;
      sounds.push({ key: `magnifier-start-${scene.id}`, at: scene.start + 0.2, sfx: SCENE_SFX.magnifier_start, volume: 0.16 });
      sounds.push({ key: `magnifier-focus-${scene.id}`, at: focusAt, sfx: SCENE_SFX.magnifier_focus, volume: 0.22 });
    }
    if (scene.type === "artifact_grid") {
      scene.items.forEach((item, itemIndex) => {
        const last = itemIndex === scene.items.length - 1;
        sounds.push({ key: `artifact-${scene.id}-${itemIndex}`, at: item.at, sfx: last ? SCENE_SFX.artifact_final : SCENE_SFX.artifact_item, volume: last ? 0.28 : 0.2 });
      });
    }
    if (scene.type === "terminal_receipt") {
      sounds.push({ key: `terminal-type-${scene.id}`, at: scene.start + 0.2, sfx: SCENE_SFX.terminal_type, volume: 0.18, holdSeconds: Math.min(1.4, Math.max(0.5, scene.end - scene.start - 0.8)) });
      sounds.push({ key: `terminal-status-${scene.id}`, at: scene.at, sfx: SCENE_SFX.terminal_status, volume: 0.28 });
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

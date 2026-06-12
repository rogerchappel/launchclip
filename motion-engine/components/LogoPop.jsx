import React from "react";
import { Img, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Trail } from "@remotion/motion-blur";

const POP_IN = { damping: 11, stiffness: 240, mass: 0.7 };
const POP_OUT = { damping: 16, stiffness: 180, mass: 0.8 };

export function LogoPop({ event, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const startFrame = event.start * fps;
  const endFrame = event.end * fps;
  if (frame < startFrame) return null;

  const enter = spring({ frame: frame - startFrame, fps, config: POP_IN });
  const exit = frame >= endFrame ? spring({ frame: frame - endFrame, fps, config: POP_OUT }) : 0;
  if (exit > 0.98) return null;

  const size = Math.round(width * event.size);
  // Zoom-from-depth: the card flies in from near-zero toward the camera.
  const scale = (0.05 + enter * 0.95) * (1 - exit * 0.4);
  // 3D flip-in from 70deg, then a shallow idle float so the card never sits dead.
  const seconds = (frame - startFrame) / fps;
  const rotateY = (1 - enter) * -70 + Math.sin(seconds * 1.1) * 4 + exit * 30;
  const rotateX = Math.cos(seconds * 0.9) * 3;
  const card = (
    <div
      style={{
        position: "absolute",
        left: width * event.x - size / 2,
        top: height * event.y - size / 2,
        width: size,
        height: size,
        zIndex: 20,
        transform: `perspective(1100px) rotateY(${rotateY}deg) rotateX(${rotateX}deg) scale(${scale})`,
        opacity: Math.min(1, enter * 1.5) * (1 - exit),
        borderRadius: size * 0.22,
        background: "#121210",
        // Light follows tilt: shadow slides opposite the rotation.
        boxShadow: `${-rotateY * 0.9}px ${18 + rotateX * 2}px 50px rgba(0,0,0,0.38)`,
        display: "grid",
        placeItems: "center",
        padding: size * 0.14
      }}
    >
      <Img
        src={/^https?:\/\//.test(event.src) ? event.src : staticFile(event.src)}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
      {event.label ? (
        <div
          style={{
            position: "absolute",
            bottom: -size * 0.18,
            left: "50%",
            transform: "translateX(-50%)",
            padding: `${size * 0.05}px ${size * 0.1}px`,
            borderRadius: 999,
            background: "rgba(8,9,12,0.92)",
            color: "#fff",
            fontFamily: "Inter, Arial, sans-serif",
            fontWeight: 800,
            fontSize: size * 0.12,
            whiteSpace: "nowrap"
          }}
        >
          {event.label}
        </div>
      ) : null}
    </div>
  );

  // Trail only during the fast entrance; it multiplies layer renders.
  if (frame - startFrame < fps * 0.4) {
    return (
      <Trail layers={3} lagInFrames={0.6} trailOpacity={0.35}>
        {card}
      </Trail>
    );
  }
  return card;
}

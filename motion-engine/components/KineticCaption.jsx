import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { chunkWords } from "../schema.js";

const ACCENT = "#ffd60a";
const WORD_IN = { damping: 12, stiffness: 260, mass: 0.6 };

// One chunk (1-3 words) on screen at a time, each word springing in exactly
// on its spoken start. Sized for phone legibility: ~6% of height per line.
export function KineticCaption({ words, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const now = frame / fps;
  const chunks = chunkWords(words);
  const chunk = chunks.find((entry) => now >= entry.start && now < entry.end + 0.12);
  if (!chunk) return null;

  const fontSize = Math.round(height * 0.052);
  return (
    <div
      style={{
        position: "absolute",
        left: width * 0.06,
        right: width * 0.06,
        top: height * 0.68,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: Math.round(fontSize * 0.28),
        zIndex: 30,
        pointerEvents: "none"
      }}
    >
      {chunk.words.map((entry, index) => {
        const enter = spring({ frame: frame - entry.start * fps, fps, config: WORD_IN });
        if (now < entry.start) return null;
        return (
          <span
            key={`${entry.word}-${index}`}
            style={{
              display: "inline-block",
              fontFamily: "Inter, Arial, sans-serif",
              fontWeight: 900,
              fontSize: entry.emphasis ? fontSize * 1.12 : fontSize,
              lineHeight: 1,
              textTransform: "uppercase",
              letterSpacing: "-0.01em",
              color: entry.emphasis ? ACCENT : "#ffffff",
              WebkitTextStroke: `${Math.max(2, fontSize * 0.07)}px rgba(8,9,12,0.92)`,
              paintOrder: "stroke fill",
              textShadow: "0 6px 24px rgba(0,0,0,0.45)",
              transform: `translateY(${(1 - enter) * fontSize * 0.5}px) scale(${0.6 + enter * 0.4})`,
              opacity: Math.min(1, enter * 1.4)
            }}
          >
            {entry.word}
          </span>
        );
      })}
    </div>
  );
}

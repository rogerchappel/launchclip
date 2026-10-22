// Remotion twin of the word-captions GSAP runtime (kit/core/captions.mjs):
// same chunks, same caption band and type, same pop-in, per-word highlight
// and clear, computed from the frame alone. Mount once, on the top layer, for
// the whole composition (not inside a Sequence): t = frame / fps.
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
// @ts-ignore plain ESM from kit/core
import { CAPTION_BAND, CAPTION_DEFAULT_COLORS, CAPTION_MOTION, visibleChunks } from "../../core/captions.mjs";
// @ts-ignore plain ESM from kit/core
import { getEase, interpolateColor } from "../../core/motion.mjs";

export type CaptionWord = { text: string; start: number; end: number };
export type CaptionChunk = { id: string; start: number; end: number; words: CaptionWord[] };

export type WordCaptionsProps = {
  chunks: CaptionChunk[];
  hide?: Array<[number, number]>;
  idle?: string;
  active?: string;
  spoken?: string;
  fontFamily?: string;
};

const M = CAPTION_MOTION;
const B = CAPTION_BAND;

// GSAP fromTo/to progress at time t for a tween starting at `at`.
function progress(t: number, at: number, duration: number, ease: string): number | null {
  if (t < at) return null;
  if (duration <= 0 || t >= at + duration) return 1;
  return getEase(ease)((t - at) / duration);
}

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

function lineState(t: number, chunk: CaptionChunk) {
  const from = M.lineIn.from;
  const inState = (time: number) => {
    const p = progress(time, chunk.start, M.lineIn.duration, M.lineIn.ease);
    // fromTo renders its from-state immediately, so before start the line is hidden.
    const q = p ?? 0;
    return { opacity: lerp(from.opacity, 1, q), y: lerp(from.y, 0, q), scale: lerp(from.scale, 1, q) };
  };
  const state = inState(t);
  const outAt = Math.max(chunk.start + M.lineOut.minShow, chunk.end - M.lineOut.lead);
  const p = progress(t, outAt, M.lineOut.duration, M.lineOut.ease);
  if (p !== null) {
    // A GSAP .to() starts from the values present when it begins.
    const begin = inState(outAt);
    state.opacity = lerp(begin.opacity, M.lineOut.to.opacity, p);
    state.y = lerp(begin.y, M.lineOut.to.y, p);
  }
  return state;
}

function wordState(t: number, word: CaptionWord, colors: { idle: string; active: string; spoken: string }) {
  const onAt = Math.max(0, word.start - M.wordOn.lead);
  const offAt = Math.max(word.end, word.start + M.wordOff.minHold);
  let color = colors.idle;
  let scale = 1;
  const on = progress(t, onAt, M.wordOn.duration, M.wordOn.ease);
  if (on !== null) {
    color = interpolateColor(on, colors.idle, colors.active);
    scale = lerp(1, M.wordOn.scale, on);
  }
  const off = progress(t, offAt, M.wordOff.duration, M.wordOff.ease);
  if (off !== null) {
    const begin = { color: interpolateColor(progress(offAt, onAt, M.wordOn.duration, M.wordOn.ease) ?? 0, colors.idle, colors.active), scale: lerp(1, M.wordOn.scale, progress(offAt, onAt, M.wordOn.duration, M.wordOn.ease) ?? 0) };
    color = interpolateColor(off, begin.color, colors.spoken);
    scale = lerp(begin.scale, 1, off);
  }
  return { color, scale };
}

const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;

export const WordCaptions: React.FC<WordCaptionsProps> = ({ chunks, hide = [], idle = CAPTION_DEFAULT_COLORS.idle, active = CAPTION_DEFAULT_COLORS.active, spoken, fontFamily = "'Anton', 'STIX Two Math', sans-serif" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const colors = { idle, active, spoken: spoken ?? idle };
  const shown = (visibleChunks(chunks, hide) as CaptionChunk[]).filter((chunk) => t >= chunk.start - 0.001 && t <= chunk.end + 1);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: B.zIndex }}>
      <div style={{ position: "absolute", left: `${B.left * 100}%`, right: `${B.right * 100}%`, top: `${B.top * 100}%`, height: `${B.height * 100}%`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {shown.map((chunk) => {
          const line = lineState(t, chunk);
          if (line.opacity <= 0) return null;
          return (
            <div key={chunk.id} id={chunk.id} className="lc-cap" style={{
              position: "absolute", display: "flex", gap: `${B.gap}em`, flexWrap: "wrap", justifyContent: "center",
              font: `${B.fontWeight} ${B.fontSize}px/${B.lineHeight} ${fontFamily}`, letterSpacing: "-0.01em", textTransform: "uppercase",
              opacity: round(line.opacity), transform: `translate(0px, ${round(line.y, 3)}px) scale(${round(line.scale)})`
            }}>
              {chunk.words.map((word, index) => {
                const state = wordState(t, word, colors);
                return (
                  <span key={index} className="lc-cap-w" style={{
                    display: "inline-block", paintOrder: "stroke fill", WebkitTextStroke: `${B.stroke}px rgba(0,0,0,.92)`,
                    textShadow: "0 6px 0 rgba(0,0,0,.55), 0 12px 28px rgba(0,0,0,.45)", transformOrigin: "50% 70%",
                    color: state.color, transform: state.scale === 1 ? undefined : `scale(${round(state.scale)})`
                  }}>{word.text}</span>
                );
              })}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export default WordCaptions;

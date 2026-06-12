// Deterministic starter director: turns aligned words into a usable first-pass
// event timeline. The real Motion Director (LLM) lives in product-videogen;
// these heuristics exist so a fresh recording renders with life immediately.

import { MOTION_TIMELINE_VERSION, DEFAULT_SFX } from "./schema.js";

const MIN_ZOOM_SPACING_SECONDS = 3.5;
const ZOOM_HOLD_SECONDS = 1.2;
const EMPHASIS_PATTERN = /^\$?[\d,.]+[kKmMxX%]?$|^[A-Z]{2,}$/;

export function buildHeuristicTimeline({ words, durationSeconds, baseSrc, voiceoverSrc = "" }) {
  const flagged = flagEmphasis(words);
  return {
    version: MOTION_TIMELINE_VERSION,
    duration_seconds: durationSeconds,
    base: { type: baseSrc ? "video" : "placeholder", src: baseSrc ?? "" },
    audio: { voiceover: voiceoverSrc, music: "", music_volume: 0.08 },
    words: flagged,
    events: zoomEvents(flagged, durationSeconds)
  };
}

// Numbers, ALL-CAPS, and sentence-leading words after a pause carry stress.
export function flagEmphasis(words) {
  return words.map((entry, index) => {
    const previous = words[index - 1];
    const sentenceStart = !previous || /[.!?]$/.test(previous.word);
    const stressed =
      EMPHASIS_PATTERN.test(entry.word.replace(/[.!?,]$/, "")) ||
      (sentenceStart && index > 0 && entry.word.replace(/[.!?,]$/, "").length >= 4);
    return { ...entry, emphasis: Boolean(entry.emphasis) || stressed };
  });
}

// One punch-zoom per sentence start, spaced out so zooms never feel relentless.
export function zoomEvents(words, durationSeconds) {
  const events = [];
  let lastZoomEnd = -MIN_ZOOM_SPACING_SECONDS;
  words.forEach((entry, index) => {
    const previous = words[index - 1];
    const sentenceStart = index === 0 || (previous && /[.!?]$/.test(previous.word));
    if (!sentenceStart) return;
    if (entry.start - lastZoomEnd < MIN_ZOOM_SPACING_SECONDS) return;
    const end = Math.min(entry.start + ZOOM_HOLD_SECONDS, durationSeconds);
    if (end - entry.start < 0.4) return;
    events.push({
      id: `zoom-${events.length + 1}`,
      type: "punch_zoom",
      start: entry.start,
      end,
      scale: events.length % 2 === 0 ? 1.08 : 1.12,
      origin_x: 0.5,
      origin_y: 0.42,
      sfx: DEFAULT_SFX.punch_zoom
    });
    lastZoomEnd = end;
  });
  return events;
}

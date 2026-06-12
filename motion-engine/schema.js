// motion.timeline.v1 — the contract between any director (human, heuristic, LLM)
// and the MotionLayer renderer. Designed to be extracted into product-videogen
// unchanged: keep this file dependency-free and framework-free.

export const MOTION_TIMELINE_VERSION = "motion.timeline.v1";

export const EVENT_TYPES = new Set(["punch_zoom", "logo_pop"]);

export const DEFAULT_SFX = {
  punch_zoom: "whoosh.wav",
  logo_pop: "pop.wav",
  caption_chunk: "tick.wav"
};

// Hard constraints enforced in code, not prompts.
export const MIN_EVENT_GAP_SECONDS = 0.35;
export const MAX_EVENTS_PER_10_SECONDS = 8;

export function validateTimeline(input) {
  const errors = [];
  const warnings = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["timeline must be an object"], warnings, timeline: null };
  }
  if (input.version !== MOTION_TIMELINE_VERSION) {
    errors.push(`version must be "${MOTION_TIMELINE_VERSION}"`);
  }
  const duration = Number(input.duration_seconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    errors.push("duration_seconds must be a positive number");
  }

  const words = normalizeWords(input.words, errors);
  const events = normalizeEvents(input.events, duration, errors);
  checkDensity(events, warnings);
  checkOverlaps(events, errors);

  const base = normalizeBase(input.base);
  const timeline = {
    version: MOTION_TIMELINE_VERSION,
    duration_seconds: duration,
    base,
    audio: normalizeAudio(input.audio),
    words,
    events
  };
  return { ok: errors.length === 0, errors, warnings, timeline };
}

function normalizeBase(base) {
  if (!base || typeof base !== "object") return { type: "placeholder", src: "" };
  const type = base.type === "video" ? "video" : "placeholder";
  return { type, src: String(base.src ?? "") };
}

function normalizeAudio(audio) {
  if (!audio || typeof audio !== "object") return { voiceover: "", music: "", music_volume: 0.08 };
  return {
    voiceover: String(audio.voiceover ?? ""),
    music: String(audio.music ?? ""),
    music_volume: clampNumber(audio.music_volume, 0, 1, 0.08)
  };
}

function normalizeWords(words, errors) {
  if (!Array.isArray(words)) {
    errors.push("words must be an array of {word,start,end}");
    return [];
  }
  const normalized = [];
  let lastEnd = 0;
  words.forEach((entry, index) => {
    const word = String(entry?.word ?? "").trim();
    const start = Number(entry?.start);
    const end = Number(entry?.end);
    if (!word) errors.push(`words[${index}] missing word text`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      errors.push(`words[${index}] has invalid timing`);
      return;
    }
    if (start < lastEnd - 0.001) errors.push(`words[${index}] overlaps previous word`);
    lastEnd = end;
    normalized.push({ word, start, end, emphasis: Boolean(entry?.emphasis) });
  });
  return normalized;
}

function normalizeEvents(events, duration, errors) {
  if (!Array.isArray(events)) {
    errors.push("events must be an array");
    return [];
  }
  const normalized = events
    .map((event, index) => normalizeEvent(event, index, duration, errors))
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
  return normalized;
}

function normalizeEvent(event, index, duration, errors) {
  const type = String(event?.type ?? "");
  if (!EVENT_TYPES.has(type)) {
    errors.push(`events[${index}] has unknown type "${type}"`);
    return null;
  }
  const start = Number(event?.start);
  const end = Number(event?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    errors.push(`events[${index}] (${type}) has invalid timing`);
    return null;
  }
  if (Number.isFinite(duration) && end > duration + 0.25) {
    errors.push(`events[${index}] (${type}) ends after the video does`);
  }
  const base = {
    id: String(event?.id ?? `${type}-${index}`),
    type,
    start,
    end,
    sfx: event?.sfx === null ? null : String(event?.sfx ?? DEFAULT_SFX[type] ?? "")
  };
  if (type === "punch_zoom") {
    return {
      ...base,
      scale: clampNumber(event?.scale, 1.02, 1.35, 1.08),
      origin_x: clampNumber(event?.origin_x, 0, 1, 0.5),
      origin_y: clampNumber(event?.origin_y, 0, 1, 0.42)
    };
  }
  if (type === "logo_pop") {
    if (!event?.src) errors.push(`events[${index}] (logo_pop) requires src`);
    return {
      ...base,
      src: String(event?.src ?? ""),
      x: clampNumber(event?.x, 0, 1, 0.72),
      y: clampNumber(event?.y, 0, 1, 0.3),
      size: clampNumber(event?.size, 0.08, 0.5, 0.22),
      label: String(event?.label ?? "")
    };
  }
  return base;
}

function checkDensity(events, warnings) {
  for (const event of events) {
    const windowEnd = event.start + 10;
    const count = events.filter((other) => other.start >= event.start && other.start < windowEnd).length;
    if (count > MAX_EVENTS_PER_10_SECONDS) {
      warnings.push(`more than ${MAX_EVENTS_PER_10_SECONDS} events within 10s of t=${event.start.toFixed(1)} — pacing will feel frantic`);
      break;
    }
  }
}

function checkOverlaps(events, errors) {
  const zooms = events.filter((event) => event.type === "punch_zoom");
  for (let index = 1; index < zooms.length; index += 1) {
    if (zooms[index].start < zooms[index - 1].end - 0.001) {
      errors.push(`punch_zoom "${zooms[index].id}" overlaps "${zooms[index - 1].id}" — zooms cannot stack`);
    }
  }
}

// Snap event boundaries to the nearest spoken-word start so motion lands on speech.
export function snapEventsToWords(events, words) {
  if (!words.length) return events;
  return events.map((event) => {
    const start = nearestWordStart(words, event.start);
    const length = event.end - event.start;
    return { ...event, start, end: start + length };
  });
}

function nearestWordStart(words, time) {
  let best = words[0].start;
  let bestDistance = Math.abs(words[0].start - time);
  for (const entry of words) {
    const distance = Math.abs(entry.start - time);
    if (distance < bestDistance) {
      best = entry.start;
      bestDistance = distance;
    }
  }
  return best;
}

// Group words into caption chunks of 1-3 words, breaking on punctuation and pauses.
export function chunkWords(words, { maxWords = 3, pauseBreak = 0.45 } = {}) {
  const chunks = [];
  let current = [];
  for (const entry of words) {
    const previous = current[current.length - 1];
    const longPause = previous && entry.start - previous.end > pauseBreak;
    if (current.length >= maxWords || longPause) {
      chunks.push(buildChunk(current));
      current = [];
    }
    current.push(entry);
    if (/[.!?,—]$/.test(entry.word)) {
      chunks.push(buildChunk(current));
      current = [];
    }
  }
  if (current.length) chunks.push(buildChunk(current));
  return chunks;
}

function buildChunk(words) {
  return {
    start: words[0].start,
    end: words[words.length - 1].end,
    words: words.map((entry) => ({
      word: entry.word.replace(/[.!?,]$/, ""),
      start: entry.start,
      end: entry.end,
      emphasis: entry.emphasis
    }))
  };
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

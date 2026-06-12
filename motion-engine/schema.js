// motion.timeline.v1 — the contract between any director (human, heuristic, LLM)
// and the MotionLayer renderer. Designed to be extracted into product-videogen
// unchanged: keep this file dependency-free and framework-free.

export const MOTION_TIMELINE_VERSION = "motion.timeline.v1";

export const EVENT_TYPES = new Set(["punch_zoom", "logo_pop"]);

export const SCENE_TYPES = new Set([
  "talking_head",
  "screen",
  "typography",
  "prompt_card",
  "screenshot_pile",
  "icon_flow",
  "card_steps",
  "stat_counter",
  "quote_card"
]);

// Art direction: scenes persist while builds run inside them, but nothing
// should sit past this without transforming.
export const MAX_SCENE_SECONDS = 6;
export const MIN_SCENE_SECONDS = 0.8;

// How a scene enters: hard cuts are chapter breaks; travel (swipe/zoom) keeps
// the viewer on one continuous canvas. The camera spends this long in motion.
export const SCENE_TRANSITIONS = new Set(["cut", "swipe_left", "swipe_right", "zoom_into"]);
export const TRAVEL_SECONDS = 0.45;

export const TALKING_HEAD_LAYOUTS = new Set(["split", "card", "full", "overlay"]);

export const DEFAULT_SFX = {
  punch_zoom: "fast_whoosh.wav",
  logo_pop: "pop.wav",
  caption_chunk: "tick.wav"
};

// Scene-level sound design, bound automatically by the renderer:
// travel/cuts whoosh, prompt cards type, step chips click, the final icon
// node lands with a retro success hit.
export const SCENE_SFX = {
  cut: "fast_whoosh.wav",
  prompt_typing: "writing_prompt.wav",
  step_item: "single_type.wav",
  icon_item: "pop.wav",
  icon_final: "retro_success.wav"
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
  const scenes = normalizeScenes(input.scenes, duration, errors, warnings);
  const chapters = normalizeChapters(input.chapters, duration, errors);
  checkZoomsNearCuts(events, scenes, warnings);
  const timeline = {
    version: MOTION_TIMELINE_VERSION,
    duration_seconds: duration,
    base,
    scenes,
    chapters,
    audio: normalizeAudio(input.audio),
    words,
    events
  };
  return { ok: errors.length === 0, errors, warnings, timeline };
}

// Optional persistent chapter rail: 2-6 titled markers across the video.
function normalizeChapters(chapters, duration, errors) {
  if (chapters === undefined || chapters === null) return [];
  if (!Array.isArray(chapters)) {
    errors.push("chapters must be an array of {title, at}");
    return [];
  }
  const normalized = chapters
    .map((chapter, index) => {
      const title = String(chapter?.title ?? "").trim();
      const at = Number(chapter?.at);
      if (!title) errors.push(`chapters[${index}] missing title`);
      if (!Number.isFinite(at) || at < 0 || (Number.isFinite(duration) && at >= duration)) {
        errors.push(`chapters[${index}] has invalid at`);
        return null;
      }
      return { title: title.slice(0, 18), at };
    })
    .filter(Boolean)
    .sort((a, b) => a.at - b.at);
  if (normalized.length === 1) errors.push("chapters needs at least 2 entries (or none)");
  if (normalized.length > 6) errors.push("chapters: at most 6");
  return normalized;
}

// The visual base is a track of scenes; voice runs continuously underneath.
// When scenes are absent the renderer falls back to `base` for the full run.
function normalizeScenes(scenes, duration, errors, warnings) {
  if (scenes === undefined || scenes === null) return [];
  if (!Array.isArray(scenes)) {
    errors.push("scenes must be an array");
    return [];
  }
  const normalized = scenes
    .map((scene, index) => normalizeScene(scene, index, errors))
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  normalized.forEach((scene, index) => {
    const length = scene.end - scene.start;
    if (length > MAX_SCENE_SECONDS) {
      warnings.push(`scene "${scene.id}" runs ${length.toFixed(1)}s — art direction caps scenes at ${MAX_SCENE_SECONDS}s; split it`);
    }
    if (length < MIN_SCENE_SECONDS) {
      warnings.push(`scene "${scene.id}" is under ${MIN_SCENE_SECONDS}s — too quick to read`);
    }
    const next = normalized[index + 1];
    if (next && next.start < scene.end - 0.001) {
      errors.push(`scene "${next.id}" overlaps "${scene.id}"`);
    }
    if (next && next.start > scene.end + 0.05) {
      warnings.push(`gap between scenes "${scene.id}" and "${next.id}" — the placeholder backdrop will show`);
    }
  });
  if (normalized.length) {
    if (normalized[0].start > 0.05) warnings.push("first scene starts late — placeholder will show at t=0");
    const last = normalized[normalized.length - 1];
    if (Number.isFinite(duration) && last.end < duration - 0.25) {
      warnings.push("scenes end before the video does — placeholder will show at the tail");
    }
  }
  return normalized;
}

function normalizeScene(scene, index, errors) {
  const type = String(scene?.type ?? "");
  if (!SCENE_TYPES.has(type)) {
    errors.push(`scenes[${index}] has unknown type "${type}"`);
    return null;
  }
  const start = Number(scene?.start);
  const end = Number(scene?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    errors.push(`scenes[${index}] (${type}) has invalid timing`);
    return null;
  }
  const transitionRaw = String(scene?.transition ?? "cut");
  if (!SCENE_TRANSITIONS.has(transitionRaw)) {
    errors.push(`scenes[${index}] has unknown transition "${transitionRaw}"`);
  }
  // The first scene has nothing to travel from.
  const transition = index === 0 ? "cut" : transitionRaw;
  const base = { id: String(scene?.id ?? `${type}-${index}`), type, start, end, transition };
  if (type === "talking_head" || type === "screen") {
    if (!scene?.src) errors.push(`scenes[${index}] (${type}) requires src — footage scenes must be real recordings`);
    const layout = String(scene?.layout ?? "split");
    if (type === "talking_head" && !TALKING_HEAD_LAYOUTS.has(layout)) {
      errors.push(`scenes[${index}] (talking_head) has unknown layout "${layout}"`);
    }
    const footage = {
      ...base,
      src: String(scene?.src ?? ""),
      // Footage offset within the source file; talking_head defaults to the
      // global clock so one continuous take stays in sync with its own audio.
      offset: scene?.offset === undefined ? (type === "talking_head" ? start : 0) : Number(scene.offset)
    };
    if (type === "talking_head") {
      footage.layout = layout;
      // Optional word builds staged on the paper above a split-layout face.
      footage.items = Array.isArray(scene?.items)
        ? scene.items.map((item, itemIndex) => ({
            text: String(item?.text ?? ""),
            at: clampNumber(item?.at, start, end, start + itemIndex * 0.8),
            ...(item?.emphasis ? { emphasis: true } : {}),
            ...(item?.color ? { color: String(item.color) } : {})
          }))
        : [];
    }
    return footage;
  }
  if (type === "stat_counter") {
    if (!scene?.value) errors.push(`scenes[${index}] (stat_counter) requires value (e.g. "87%", "10x", "$2,000")`);
    return {
      ...base,
      value: String(scene?.value ?? ""),
      label: String(scene?.label ?? ""),
      color: scene?.color ? String(scene.color) : "mint",
      at: clampNumber(scene?.at, start, end, start + 0.3)
    };
  }
  if (type === "quote_card") {
    if (!scene?.text) errors.push(`scenes[${index}] (quote_card) requires text`);
    return {
      ...base,
      text: String(scene?.text ?? ""),
      attribution: String(scene?.attribution ?? ""),
      at: clampNumber(scene?.at, start, end, start + 0.2)
    };
  }
  if (type === "prompt_card") {
    if (!scene?.text) errors.push(`scenes[${index}] (prompt_card) requires text — the real prompt, never invented`);
    return { ...base, text: String(scene?.text ?? "") };
  }
  if (type === "typography" || type === "icon_flow" || type === "card_steps" || type === "screenshot_pile") {
    const raw = Array.isArray(scene?.items) ? scene.items : [];
    if (!raw.length) errors.push(`scenes[${index}] (${type}) requires items`);
    const items = raw.map((item, itemIndex) => {
      const entry = {
        text: String(item?.text ?? item?.label ?? ""),
        at: clampNumber(item?.at, start, end, start + itemIndex * 0.8)
      };
      if (item?.emphasis) entry.emphasis = true;
      if (item?.color) entry.color = String(item.color);
      if (item?.src) entry.src = String(item.src);
      return entry;
    });
    if (type === "screenshot_pile") {
      items.forEach((item, itemIndex) => {
        if (!item.src) errors.push(`scenes[${index}] (screenshot_pile) items[${itemIndex}] requires src — real screenshots only`);
      });
      const mode = String(scene?.mode ?? "pile");
      if (mode !== "pile" && mode !== "scroll") errors.push(`scenes[${index}] (screenshot_pile) has unknown mode "${mode}"`);
      return { ...base, title: String(scene?.title ?? ""), mode, items };
    }
    return { ...base, title: String(scene?.title ?? ""), items };
  }
  return base;
}

// The cut is already the accent — zooms hugging a boundary double-hit.
function checkZoomsNearCuts(events, scenes, warnings) {
  if (!scenes.length) return;
  for (const event of events) {
    if (event.type !== "punch_zoom") continue;
    for (const scene of scenes) {
      if (Math.abs(event.start - scene.start) < 0.5 && event.start !== scene.start) {
        warnings.push(`punch_zoom "${event.id}" lands within 0.5s of the cut into "${scene.id}" — move it or drop it`);
      }
    }
  }
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

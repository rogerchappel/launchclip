// Story → music brief: the scene energy arc, a tone from the brand and the
// story text, and the request bodies the ElevenLabs music API takes (a text
// prompt, or a music_v1 composition plan whose sections follow the story's
// energy segments).

export const SECTION_MIN_MS = 3000;
export const SECTION_MAX_MS = 120000;
export const MUSIC_MIN_MS = 3000;
export const MUSIC_MAX_MS = 600000;
// Requested music runs this much longer than the story so the start offset
// chosen by beat sync (and a little tempo change) still covers the whole video.
export const MUSIC_TAIL_SECONDS = 2;

export const NO_VOCALS = Object.freeze(["vocals", "singing", "lyrics", "spoken word", "choir", "vocal chops", "rap"]);

const ENERGY_STYLES = {
  0: { label: "calm", positive: ["calm", "sparse", "soft pads", "no drums", "spacious"], negative: ["heavy drums", "distorted bass"] },
  1: { label: "light", positive: ["light", "gentle pulse", "minimal percussion", "warm keys"], negative: ["heavy drums", "big drops"] },
  2: { label: "groove", positive: ["steady groove", "punchy drums", "driving bassline", "confident"], negative: ["ambient drift"] },
  3: { label: "full", positive: ["full energy", "big drums", "bright synth lead", "payoff", "anthemic"], negative: ["sparse", "quiet"] },
  build: { label: "build", positive: ["building tension", "rising synths", "snare build", "filter sweep up", "crescendo"], negative: ["static", "drop out"] }
};

function energyKey(energy) {
  if (energy === "build") return "build";
  return Number.isInteger(energy) && energy >= 0 && energy <= 3 ? energy : 1;
}

/**
 * Consecutive track-0 scenes with the same energy, as story-time segments:
 * [{energy, label, start, end, scenes: [ids]}]. Needs a resolved story.
 */
export function storyEnergySegments(story) {
  const all = Array.isArray(story?.scenes) ? story.scenes : [];
  const base = all.filter((scene) => (scene.track ?? 0) === 0);
  const scenes = (base.length ? base : all)
    .filter((scene) => Number.isFinite(Number(scene.start)) && Number.isFinite(Number(scene.end)))
    .slice()
    .sort((a, b) => Number(a.start) - Number(b.start));
  const segments = [];
  for (const scene of scenes) {
    const energy = energyKey(scene.energy);
    const last = segments.at(-1);
    if (last && last.energy === energy && Number(scene.start) <= last.end + 0.05) {
      last.end = Math.max(last.end, Number(scene.end));
      last.scenes.push(scene.id);
      continue;
    }
    segments.push({ energy, label: ENERGY_STYLES[energy].label, start: Number(scene.start), end: Number(scene.end), scenes: [scene.id] });
  }
  return segments;
}

/** "calm intro → build → payoff" style description of the energy arc. */
export function energyArc(segments) {
  if (!segments.length) return "steady";
  return segments.map((segment, index) => {
    const role = index === 0 ? "intro" : index === segments.length - 1 ? "payoff" : segment.energy === "build" ? "" : "section";
    return `${segment.label}${role && segment.label !== role ? ` ${role}` : ""}`.trim();
  }).join(" → ");
}

/** A few tone words from the story: lane, title/notes and the brand background. */
export function storyTone(story) {
  const text = `${story?.title ?? ""} ${story?.notes ?? ""} ${story?.format?.platform ?? ""}`.toLowerCase();
  const tone = [];
  if (/explain|rule|how|why|lesson|guide|science|math/.test(text)) tone.push("curious", "clear", "modern explainer");
  if (/promo|launch|product|ship|release|saas|app|try/.test(text)) tone.push("confident", "upbeat", "modern tech product launch");
  if (/data|stat|chart|report|numbers/.test(text) && !tone.length) tone.push("precise", "analytical");
  if (!tone.length) tone.push("modern", "polished", "tech");
  const bg = story?.brand?.colors?.bg ?? story?.brand?.colors?.background;
  if (typeof bg === "string" && /^#[0-9a-f]{6}$/i.test(bg)) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16) / 255);
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    tone.push(luminance < 0.35 ? "sleek electronic" : "bright and airy");
  }
  return [...new Set(tone)];
}

/**
 * Split total music length into composition-plan sections that follow the
 * story's energy segments: segments shorter than 3 s merge into a neighbour,
 * longer than 120 s split, and the tail after the story joins the last one.
 * Returns [{name, energy, start_ms, duration_ms, scenes}] summing to lengthMs.
 */
export function planSections(segments, lengthMs) {
  const total = Math.max(MUSIC_MIN_MS, Math.round(lengthMs));
  let parts = segments.map((segment) => ({ energy: segment.energy, scenes: [...segment.scenes], start: Math.round(segment.start * 1000), end: Math.round(segment.end * 1000) }));
  if (!parts.length) parts = [{ energy: 1, scenes: [], start: 0, end: total }];
  parts[0].start = 0;
  parts.at(-1).end = total;
  for (let i = 1; i < parts.length; i += 1) parts[i].start = parts[i - 1].end;
  // Merge short sections into the neighbour that is itself shorter (so the
  // merged section stays close to the story's cut).
  let merged = true;
  while (merged && parts.length > 1) {
    merged = false;
    const index = parts.findIndex((part) => part.end - part.start < SECTION_MIN_MS);
    if (index < 0) break;
    const left = index > 0 ? parts[index - 1] : null;
    const right = index < parts.length - 1 ? parts[index + 1] : null;
    const into = !left ? "right" : !right ? "left" : (left.end - left.start) <= (right.end - right.start) ? "left" : "right";
    const part = parts[index];
    if (into === "left") {
      left.end = part.end;
      left.scenes.push(...part.scenes);
      // A build absorbed into the next or previous section keeps the higher energy.
      left.energy = higherEnergy(left.energy, part.energy);
    } else {
      right.start = part.start;
      right.scenes.unshift(...part.scenes);
      right.energy = higherEnergy(right.energy, part.energy);
    }
    parts.splice(index, 1);
    merged = true;
  }
  const sections = [];
  for (const part of parts) {
    let start = part.start;
    const length = part.end - part.start;
    const pieces = Math.max(1, Math.ceil(length / SECTION_MAX_MS));
    for (let k = 0; k < pieces; k += 1) {
      const end = k === pieces - 1 ? part.end : start + Math.round(length / pieces);
      sections.push({ energy: part.energy, scenes: part.scenes, start_ms: start, duration_ms: end - start });
      start = end;
    }
  }
  return sections.map((section, index) => ({ name: sectionName(section, index, sections.length), ...section }));
}

function higherEnergy(a, b) {
  const value = (energy) => (energy === "build" ? 2.5 : Number(energy));
  return value(b) > value(a) ? b : a;
}

function sectionName(section, index, count) {
  const label = ENERGY_STYLES[section.energy]?.label ?? "section";
  const role = index === 0 ? "Intro" : index === count - 1 ? "Payoff" : section.energy === "build" ? "Build" : `Section ${index + 1}`;
  return `${role} (${label})`.slice(0, 100);
}

/**
 * The ElevenLabs request for a story.
 * options: {seconds (story duration), bpm, prompt? (user text: prompt mode),
 * model (default music_v1), seed?, narrated, tailSeconds, hints?}
 * hints: optional style-pack music hints (sound.music in a style pack v2):
 * {prompt_hints?: string | string[], bpm_range?: [min, max], energy_curve?:
 * string | array}. prompt_hints join the tone words, bpm_range clamps the
 * tempo, and a string energy_curve is added to the brief.
 * → {mode: "plan"|"prompt", body, length_ms, bpm, arc, tone, sections?, description}
 * A composition plan is used for music_v1 when the story has two or more
 * energy sections; otherwise (or with a user prompt) a text prompt with
 * force_instrumental. seed is only sent with a plan (the API rejects it with
 * a prompt).
 */
export function buildMusicRequest(story, { seconds, bpm, prompt, model = "music_v1", seed, narrated = false, tailSeconds = MUSIC_TAIL_SECONDS, hints = null } = {}) {
  const duration = Number(seconds ?? story?.resolved?.duration ?? story?.format?.duration);
  if (!(duration > 0)) throw new Error("buildMusicRequest needs the story duration in seconds");
  const style = normalizeHints(hints);
  let tempo = Math.round(Number(bpm) > 0 ? Number(bpm) : 100);
  if (style.bpmRange) tempo = clamp(tempo, style.bpmRange[0], style.bpmRange[1]);
  const lengthMs = clamp(Math.round((duration + tailSeconds) * 1000), MUSIC_MIN_MS, MUSIC_MAX_MS);
  const segments = storyEnergySegments(story);
  const arc = energyArc(segments);
  const tone = [...new Set([...style.promptHints, ...storyTone(story)])];
  const curve = style.energyCurve ? `; style energy curve: ${style.energyCurve}` : "";
  const bed = narrated ? "sits under a voiceover: leave the midrange clear, no busy lead melody" : "carries the video on its own: clear hooks and accents on the downbeats";
  const sections = planSections(segments, lengthMs);
  const usePlan = !prompt && model === "music_v1" && sections.length >= 2;
  if (usePlan) {
    const body = {
      composition_plan: {
        positive_global_styles: [...tone, `${tempo} BPM`, "steady 4/4 time", "instrumental", "tight, quantised rhythm", bed, ...(style.energyCurve ? [`energy curve: ${style.energyCurve}`] : [])],
        negative_global_styles: [...NO_VOCALS, "tempo changes", "rubato", "swing"],
        sections: sections.map((section) => ({
          section_name: section.name,
          positive_local_styles: [...ENERGY_STYLES[section.energy].positive],
          negative_local_styles: [...ENERGY_STYLES[section.energy].negative],
          duration_ms: section.duration_ms,
          lines: []
        }))
      },
      model_id: model
    };
    if (Number.isInteger(seed)) body.seed = seed;
    return { mode: "plan", body, length_ms: lengthMs, bpm: tempo, arc, tone, sections, description: `${tone.join(", ")}; ${tempo} BPM; ${arc}; instrumental` };
  }
  const text = [
    prompt ? String(prompt).trim().replace(/\.?$/, ".") : `${capitalize(tone.join(", "))} instrumental music for a ${Math.round(duration)}-second video.`,
    `${tempo} BPM, steady 4/4 time with a clear, quantised beat.`,
    `Energy arc: ${arc}${curve}${sections.length > 1 ? ` (changes at ${sections.slice(1).map((section) => `${(section.start_ms / 1000).toFixed(1)}s`).join(", ")})` : ""}.`,
    `It ${bed}.`,
    "Instrumental only, no vocals."
  ].join(" ");
  const body = { prompt: text.slice(0, 4100), music_length_ms: lengthMs, model_id: model, force_instrumental: true };
  return { mode: "prompt", body, length_ms: lengthMs, bpm: tempo, arc, tone, sections, description: `${tone.join(", ")}; ${tempo} BPM; ${arc}; instrumental` };
}

/** Style-pack music hints → {promptHints: string[], bpmRange: [min, max] | null, energyCurve: string | null}. */
export function normalizeHints(hints) {
  const result = { promptHints: [], bpmRange: null, energyCurve: null };
  if (!hints || typeof hints !== "object") return result;
  const raw = hints.prompt_hints ?? hints.promptHints;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;]\s*/) : [];
  result.promptHints = list.map((item) => String(item).trim()).filter(Boolean).slice(0, 12);
  const range = hints.bpm_range ?? hints.bpmRange;
  if (Array.isArray(range) && range.length === 2) {
    const [low, high] = range.map(Number);
    if (low > 0 && high >= low) result.bpmRange = [low, high];
  }
  const curve = hints.energy_curve ?? hints.energyCurve;
  if (typeof curve === "string" && curve.trim()) result.energyCurve = curve.trim().slice(0, 200);
  else if (Array.isArray(curve) && curve.length) result.energyCurve = curve.map(String).join(" → ").slice(0, 200);
  return result;
}

function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

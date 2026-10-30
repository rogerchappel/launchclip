// Deterministic lane routing for `launchclip make` (STORYBOARD_ENGINE_RFC.md §3).
//
//   routeLane(inventory, {aspect, duration, prompt}) → {lane, base, voiceover, media, ...}
//
// The model never chooses the lane. Rules, first match wins:
//   1. A video with speech (a talking head, podcast footage, or a narrated
//      screen recording) → footage-led. The recording is the base; the base
//      edit (silence, bad takes, fillers) runs first. A talking head beats a
//      narrated screen recording; ties go to the longest clip.
//   2. A voiceover audio file → voiceover-motion with the supplied voice.
//   3. Otherwise → motion, with narration written by the model and synthesised.
// Silent screen recordings, b-roll, screenshots and product images become
// media (media-window scenes, or full-frame inserts in footage-led). Logos,
// brand.json, a style pack and notes are carried as context. Format follows
// --aspect, else the base recording's orientation, else 16:9. Duration follows
// --duration, else a "45-second" style phrase in the prompt, else the base or
// voiceover length, else 30 s. A motion video longer than 180 s is long form
// (docs/LONG_FORM_MAKE_RFC.md): written and planned in chapters, up to 20 min.

export const MAKE_ROUTING_VERSION = "launchclip.make-routing.v1";
export const ASPECTS = Object.freeze({ "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080] });
export const DEFAULT_ASPECT = "16:9";
export const DEFAULT_DURATION = 30;
// Up to SHORT_MAX_SECONDS every lane plans the whole video at once; past it, a
// motion video is long form, up to LONG_FORM_MAX_SECONDS.
export const SHORT_MAX_SECONDS = 180;
export const LONG_FORM_MAX_SECONDS = 1200;

/** A routed motion video too long to plan at once: written, voiced and planned in chapters. */
export function isLongForm(routing) {
  return routing?.lane === "motion" && Number(routing?.format?.duration) > SHORT_MAX_SECONDS;
}

/**
 * Route an inventory. options: {aspect, duration (seconds), prompt}.
 * → {schema_version, lane, reasons: [..], base, voiceover, media: [..], logos,
 *    music, brand, style, notes, ignored: [{path, reason}], format, duration_source}
 */
export function routeLane(inventory, options = {}) {
  const entries = Array.isArray(inventory?.entries) ? inventory.entries : [];
  const reasons = [];
  const ignored = [];
  const byRole = (kind, role) => entries.filter((entry) => entry.kind === kind && (!role || entry.role === role));
  const longest = (list) => [...list].sort((a, b) => (b.media?.duration ?? 0) - (a.media?.duration ?? 0) || a.path.localeCompare(b.path));
  const spoken = entries.filter((entry) => entry.kind === "video" && entry.speech?.present);
  const heads = longest(spoken.filter((entry) => entry.role === "talking-head"));
  const narrated = longest(spoken.filter((entry) => entry.role !== "talking-head"));
  const voiceovers = longest(byRole("audio", "voiceover"));
  let lane;
  let base = null;
  let voiceover = null;

  if (heads.length || narrated.length) {
    base = heads[0] ?? narrated[0];
    lane = "footage-led";
    reasons.push(`${base.path} is ${base.role === "talking-head" ? "talking-head footage" : "a narrated recording"} with speech (${base.signals.join(", ")}), so it is the base: footage-led`);
    for (const other of [...heads, ...narrated].filter((entry) => entry !== base)) ignored.push({ path: other.path, reason: `a second speech recording; footage-led uses one base (${base.path})` });
    for (const entry of voiceovers) ignored.push({ path: entry.path, reason: "a voiceover is not mounted in the footage-led lane; the base recording carries the voice" });
  } else if (voiceovers.length) {
    voiceover = voiceovers[0];
    lane = "voiceover-motion";
    reasons.push(`${voiceover.path} is a voiceover (${voiceover.signals.join(", ")}), and no recording has speech: voiceover-motion with the supplied voice`);
    for (const other of voiceovers.slice(1)) ignored.push({ path: other.path, reason: `a second voiceover; the longest (${voiceover.path}) is used` });
  } else {
    lane = "motion";
    reasons.push("no recording or voiceover with speech: motion, with narration written from the prompt and synthesised");
  }

  const media = [];
  for (const entry of entries) {
    if (entry === base) continue;
    if (entry.kind === "image" && entry.role !== "logo") media.push(mediaItem(entry, "image"));
    else if (entry.kind === "video" && !entry.speech?.present) {
      if (entry.media?.mountable === false) ignored.push({ path: entry.path, reason: "this video container cannot be mounted by the renderers (use .mp4, .mov, .m4v or .webm)" });
      else media.push(mediaItem(entry, "video"));
    }
  }
  if (media.length) reasons.push(`${media.length} media file${media.length === 1 ? "" : "s"} (${media.map((item) => item.path).join(", ")}) ${lane === "footage-led" ? "can be full-frame inserts over the base" : "can be shown in media-window scenes"}`);
  const logos = byRole("image", "logo").map((entry) => mediaItem(entry, "image"));
  const music = longest(byRole("audio", "music"))[0] ?? null;
  const brand = entries.find((entry) => entry.kind === "brand" && entry.brand) ?? null;
  const style = entries.find((entry) => entry.kind === "style" && entry.style_name) ?? null;
  const notes = entries.filter((entry) => entry.kind === "notes");
  for (const entry of entries.filter((item) => item.kind === "other")) ignored.push({ path: entry.path, reason: "unrecognised file type" });

  const aspect = resolveAspect(options.aspect, base);
  const [width, height] = ASPECTS[aspect.value];
  const duration = resolveDuration(options, { lane, base, voiceover });
  reasons.push(`format ${width}×${height} (${aspect.reason}); duration ${duration.value}s (${duration.reason})`);
  return {
    schema_version: MAKE_ROUTING_VERSION,
    lane,
    reasons,
    base: base ? { path: base.path, role: base.role, duration: base.media?.duration ?? null, orientation: base.media?.orientation ?? null } : null,
    voiceover: voiceover ? { path: voiceover.path, duration: voiceover.media?.duration ?? null } : null,
    media,
    logos,
    music: music ? { path: music.path, duration: music.media?.duration ?? null } : null,
    brand: brand ? { path: brand.path } : null,
    style: style ? { path: style.path, name: style.style_name } : null,
    notes: notes.map((entry) => entry.path),
    ignored,
    aspect: aspect.value,
    format: { width, height, fps: 30, duration: duration.value },
    duration_source: duration.reason
  };
}

function mediaItem(entry, kind) {
  return { path: entry.path, kind, role: entry.role, description: entry.description, width: entry.media?.width ?? null, height: entry.media?.height ?? null, ...(kind === "video" ? { duration: entry.media?.duration ?? null } : {}) };
}

export function resolveAspect(flag, base) {
  if (flag !== undefined && flag !== null && flag !== true) {
    const value = String(flag).trim();
    if (!ASPECTS[value]) throw new Error(`--aspect must be one of ${Object.keys(ASPECTS).join(", ")}; got ${flag}`);
    return { value, reason: `--aspect ${value}` };
  }
  const orientation = base?.media?.orientation;
  if (orientation === "portrait") return { value: "9:16", reason: `the base recording ${base.path} is portrait` };
  if (orientation === "square") return { value: "1:1", reason: `the base recording ${base.path} is square` };
  if (orientation === "landscape") return { value: "16:9", reason: `the base recording ${base.path} is landscape` };
  return { value: DEFAULT_ASPECT, reason: "default" };
}

/** "A 45-second launch video" → 45; "a 2 minute explainer" → 120; else null. */
export function durationFromPrompt(prompt) {
  const text = String(prompt ?? "");
  const seconds = /(\d{1,3}(?:\.\d+)?)\s*-?\s*(?:seconds?|secs?|s)\b/i.exec(text);
  if (seconds) return Number(seconds[1]);
  const minutes = /(\d{1,2}(?:\.\d+)?)\s*-?\s*(?:minutes?|mins?)\b/i.exec(text);
  if (minutes) return Number(minutes[1]) * 60;
  return null;
}

export function resolveDuration(options, { lane, base, voiceover }) {
  if (options.duration !== undefined && options.duration !== null) {
    const value = Number(options.duration);
    if (!(value >= 3 && value <= LONG_FORM_MAX_SECONDS)) throw new Error(`--duration must be between 3 and ${LONG_FORM_MAX_SECONDS} seconds; got ${options.duration}`);
    // Only motion videos are written in chapters; a recording or a voiceover sets its own length.
    if (value > SHORT_MAX_SECONDS && lane && lane !== "motion") throw new Error(`--duration over ${SHORT_MAX_SECONDS} seconds is for motion videos (long form); the ${lane} lane takes its length from the recording`);
    return { value, reason: `--duration ${value}` };
  }
  const fromPrompt = durationFromPrompt(options.prompt);
  if (lane === "motion" && fromPrompt && fromPrompt >= 3 && fromPrompt <= LONG_FORM_MAX_SECONDS) return { value: fromPrompt, reason: "named in the prompt" };
  if (lane === "footage-led" && base?.media?.duration) return { value: round1(base.media.duration), reason: "the base recording's length (the base edit shortens it)" };
  if (lane === "voiceover-motion" && voiceover?.media?.duration) return { value: round1(voiceover.media.duration), reason: "the voiceover's length (the voice prep tightens it)" };
  if (fromPrompt && fromPrompt >= 3 && fromPrompt <= 180) return { value: fromPrompt, reason: "named in the prompt" };
  return { value: DEFAULT_DURATION, reason: "default" };
}

function round1(value) { return Math.round(value * 10) / 10; }

// Evidence capture, step 1: the capture request (launchclip.capture.v1).
//
// A request names one real public page and the beats to play on it: scroll,
// zoom, cursor, select, highlight, focus-ring, pin and wait. The research
// agent writes these; `launchclip evidence capture <request.json>` runs one
// (src/evidence/capture.js). Contract: docs/EVIDENCE_CAPTURE.md.
//
//   { "schema": "launchclip.capture.v1", "id": "pr-39217",
//     "url": "https://github.com/dotnet/efcore/pull/39217/files",
//     "kind": "page|post|repo|pr|diff|commit|model-card|chart|article",
//     "viewport": {"width": 1600, "height": 1000}, "theme": "dark",
//     "beats": [{"at": 0.0, "action": "scroll|zoom|cursor|select|highlight|focus-ring|pin|wait",
//                "target": "css selector" | {"text": "gpt-6.1-terra"}, "dur": 1.2, "label": "Oct 16, 2026"}],
//     "out": "assets/evidence/pr-39217.mp4",
//     "provenance": {"source_title": "…", "fetched_at": "ISO", "publisher": "…", "published_at": "ISO?"} }
//
// Additive extensions (all optional): target {text, nth?, within?, closest?}
// (closest: the ancestor matching a selector, such as a diff row) and
// {selector, nth?, within?}; beat.zoom (a fixed scale for zoom beats); request.chrome
// ("dark" | "none", the browser chrome drawn round the page), request.fps,
// request.tail (seconds held after the last beat), request.still
// ({target, pad?, scale?}, the default crop for --still) and request.wait_for
// (a selector the page must show before capture).
//
// The validator returns {errors, warnings, request}: the request with
// defaults filled, beats sorted by `at` and every target in object form.

export const CAPTURE_SCHEMA = "launchclip.capture.v1";
export const SIDECAR_SCHEMA = "launchclip.evidence.v1";
export const KINDS = ["page", "post", "repo", "pr", "diff", "commit", "model-card", "chart", "article"];
export const ACTIONS = ["scroll", "zoom", "cursor", "select", "highlight", "focus-ring", "pin", "wait"];
export const THEMES = ["dark", "light"];
export const CHROMES = ["dark", "none"];
export const DEFAULT_VIEWPORT = Object.freeze({ width: 1600, height: 1000 });

// Beats that point at something on the page; wait and pin may not.
const NEEDS_TARGET = new Set(["scroll", "zoom", "cursor", "select", "highlight", "focus-ring"]);
// Beats whose target must be text (a selection or highlight sweeps a phrase).
const TEXT_ONLY = new Set(["select", "highlight"]);
const DEFAULT_DUR = { scroll: 1.2, zoom: 1.2, cursor: 0.9, select: 0.9, highlight: 0.9, "focus-ring": 0.6, pin: 0.5, wait: 1 };
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** A target as written ("selector" | {text} | {selector}) → {selector} | {text}, with nth/within kept. */
export function normalizeTarget(target) {
  if (typeof target === "string") return { selector: target };
  if (!isObject(target)) return null;
  const out = {};
  if (typeof target.text === "string") out.text = target.text;
  if (typeof target.selector === "string") out.selector = target.selector;
  if (Number.isInteger(target.nth)) out.nth = target.nth;
  if (typeof target.within === "string") out.within = target.within;
  if (typeof target.closest === "string") out.closest = target.closest;
  return out;
}

/** A target as a short label for logs and the sidecar. */
export const targetLabel = (target) => (!target ? null : target.text !== undefined ? `"${target.text}"` : target.selector) + (target?.nth ? ` #${target.nth}` : "");

/**
 * Check a capture request. → {errors: [string], warnings: [string], request}
 * where request is normalised (defaults filled, beats sorted, targets as objects).
 */
export function validateCaptureRequest(input) {
  const errors = [], warnings = [];
  if (!isObject(input)) return { errors: ["the request must be a JSON object"], warnings, request: null };
  if (input.schema !== CAPTURE_SCHEMA) errors.push(`schema must be "${CAPTURE_SCHEMA}"`);
  if (typeof input.id !== "string" || !ID.test(input.id)) errors.push("id must be 1–64 letters, digits, dot, dash or underscore");
  let url = null;
  try {
    url = new URL(input.url);
    if (!/^https?:$/.test(url.protocol)) errors.push(`url must be http or https; got ${url.protocol}`);
    if (url.username || url.password) errors.push("url must not carry credentials");
  } catch { errors.push(`url ${JSON.stringify(input.url)} is not a valid URL`); }
  const kind = input.kind ?? "page";
  if (!KINDS.includes(kind)) errors.push(`kind must be one of ${KINDS.join(", ")}`);
  const viewport = { ...DEFAULT_VIEWPORT, ...(isObject(input.viewport) ? input.viewport : {}) };
  for (const key of ["width", "height"]) {
    if (!Number.isInteger(viewport[key]) || viewport[key] < 480 || viewport[key] > 3840) errors.push(`viewport.${key} must be a whole number 480–3840`);
    else if (viewport[key] % 2) errors.push(`viewport.${key} must be even (H.264 needs even frame sizes)`);
  }
  const theme = input.theme ?? "dark";
  if (!THEMES.includes(theme)) errors.push(`theme must be ${THEMES.join(" or ")}`);
  const chrome = input.chrome ?? "dark";
  if (!CHROMES.includes(chrome)) errors.push(`chrome must be ${CHROMES.join(" or ")}`);
  const fps = input.fps ?? 30;
  if (![24, 25, 30, 50, 60].includes(fps)) errors.push("fps must be 24, 25, 30, 50 or 60");
  const tail = input.tail ?? 1.2;
  if (typeof tail !== "number" || tail < 0 || tail > 10) errors.push("tail must be 0–10 seconds");
  if (input.wait_for !== undefined && typeof input.wait_for !== "string") errors.push("wait_for must be a CSS selector");

  if (!Array.isArray(input.beats)) errors.push("beats must be an array");
  const beats = (Array.isArray(input.beats) ? input.beats : []).map((beat, index) => {
    const where = `beats[${index}]`;
    if (!isObject(beat)) { errors.push(`${where} must be an object`); return null; }
    if (!ACTIONS.includes(beat.action)) errors.push(`${where}.action must be one of ${ACTIONS.join(", ")}`);
    if (typeof beat.at !== "number" || !(beat.at >= 0) || beat.at > 600) errors.push(`${where}.at must be 0–600 seconds`);
    const dur = beat.dur ?? DEFAULT_DUR[beat.action] ?? 1;
    if (typeof dur !== "number" || !(dur > 0) || dur > 30) errors.push(`${where}.dur must be over 0 and at most 30 seconds`);
    const target = beat.target === undefined ? null : normalizeTarget(beat.target);
    if (beat.target !== undefined && (!target || (target.text === undefined && target.selector === undefined))) errors.push(`${where}.target must be a CSS selector or {text} / {selector}`);
    if (target?.text !== undefined && !target.text.trim()) errors.push(`${where}.target.text must not be empty`);
    if (NEEDS_TARGET.has(beat.action) && !target) errors.push(`${where} (${beat.action}) needs a target`);
    if (TEXT_ONLY.has(beat.action) && target && target.text === undefined) errors.push(`${where} (${beat.action}) needs a {text} target: it sweeps a phrase`);
    if (beat.action === "pin" && (typeof beat.label !== "string" || !beat.label.trim())) errors.push(`${where} (pin) needs a label, the text on the pill`);
    if (beat.label !== undefined && (typeof beat.label !== "string" || beat.label.length > 48)) errors.push(`${where}.label must be a string of at most 48 characters`);
    if (beat.zoom !== undefined && (typeof beat.zoom !== "number" || beat.zoom < 1 || beat.zoom > 4)) errors.push(`${where}.zoom must be 1–4`);
    return { index, at: beat.at, action: beat.action, target, dur, ...(beat.label !== undefined ? { label: beat.label } : {}), ...(beat.zoom !== undefined ? { zoom: beat.zoom } : {}) };
  }).filter(Boolean);
  beats.sort((a, b) => a.at - b.at || a.index - b.index);
  if (!beats.length && Array.isArray(input.beats)) warnings.push("no beats: the clip holds the top of the page");

  const out = input.out ?? `assets/evidence/${input.id}.mp4`;
  if (typeof out !== "string" || !/\.(mp4|webm)$/i.test(out) || out.split(/[\\/]/).includes("..")) errors.push("out must be a .mp4 or .webm path without ..");

  const provenance = isObject(input.provenance) ? input.provenance : null;
  if (!provenance) errors.push("provenance must be an object with source_title, fetched_at and publisher");
  else {
    for (const key of ["source_title", "publisher"]) if (typeof provenance[key] !== "string" || !provenance[key].trim()) errors.push(`provenance.${key} must be a non-empty string`);
    for (const key of ["fetched_at", "published_at"]) {
      if (provenance[key] === undefined || provenance[key] === null) { if (key === "fetched_at") errors.push("provenance.fetched_at must be an ISO date"); continue; }
      if (typeof provenance[key] !== "string" || Number.isNaN(Date.parse(provenance[key]))) errors.push(`provenance.${key} must be an ISO date`);
    }
  }

  let still = null;
  if (input.still !== undefined) {
    if (!isObject(input.still)) errors.push("still must be {target, pad?, scale?}");
    else {
      still = { target: input.still.target === undefined ? null : normalizeTarget(input.still.target), pad: input.still.pad ?? 24, scale: input.still.scale ?? 3 };
      if (input.still.target !== undefined && !still.target) errors.push("still.target must be a CSS selector or {text}");
      if (typeof still.pad !== "number" || still.pad < 0 || still.pad > 400) errors.push("still.pad must be 0–400 CSS px");
      if (typeof still.scale !== "number" || still.scale < 1 || still.scale > 4) errors.push("still.scale must be 1–4");
    }
  }

  const request = { schema: CAPTURE_SCHEMA, id: input.id, url: url?.href ?? input.url, kind, viewport: { width: viewport.width, height: viewport.height }, theme, chrome, fps, tail, beats, out,
    provenance, ...(input.wait_for ? { wait_for: input.wait_for } : {}), ...(still ? { still } : {}) };
  return { errors, warnings, request };
}

/** The clip length a request asks for: the last beat's end plus the tail. */
export function requestDuration(request) {
  const last = request.beats.reduce((end, beat) => Math.max(end, beat.at + beat.dur), 0);
  return Math.round((Math.max(last, 1) + request.tail) * 1000) / 1000;
}

// Renderer-neutral layout check computed from declared geometry.
//
// Every element declares its canvas rect and its timing. The check reasons over
// those declarations only, so it works the same for HyperFrames and Remotion
// and needs no browser. Plain ESM with no imports: safe for Node, browsers and
// Remotion bundles.

const ROLES = new Set(["text", "hero", "media", "caption", "decor"]);
const EPSILON = 1e-6;

// Reference geometry. Shorts values come from STORYBOARD_ENGINE_RFC.md §5
// (key content within y 280–1450, x 80–940, centre of mass near y 860, key text
// at least 44 px) and the caption band from shorts-delivery.md (y 1190–1420,
// x 65–918). Everything scales linearly to other canvas sizes.
export const SAFE_ZONE_PROFILES = Object.freeze({
  shorts: Object.freeze({
    id: "shorts",
    reference: Object.freeze({ width: 1080, height: 1920 }),
    safeZone: Object.freeze({ x: 80, y: 280, width: 860, height: 1170 }),
    captionBand: Object.freeze({ x: 65, y: 1190, width: 853, height: 230 }),
    centerOfMassY: 860,
    centerOfMassTolerance: 0.15,
    minTextPx: 44,
    heroFill: Object.freeze([0.7, 0.9]),
    lowerThird: true,
    maxEmptySeconds: 3
  }),
  landscape: Object.freeze({
    id: "landscape",
    reference: Object.freeze({ width: 1920, height: 1080 }),
    // Title-safe: 5% margin on every edge.
    safeZone: Object.freeze({ x: 96, y: 54, width: 1728, height: 972 }),
    captionBand: Object.freeze({ x: 192, y: 864, width: 1536, height: 140 }),
    centerOfMassY: 540,
    centerOfMassTolerance: 0.2,
    minTextPx: 32,
    heroFill: null,
    lowerThird: false,
    maxEmptySeconds: 3
  })
});

export function resolveProfile(profile, canvas) {
  if (profile && typeof profile === "object") return profile;
  if (profile == null) return canvas && canvas.height > canvas.width ? SAFE_ZONE_PROFILES.shorts : SAFE_ZONE_PROFILES.landscape;
  const found = SAFE_ZONE_PROFILES[String(profile)];
  if (!found) throw new Error(`Unknown layout profile: ${profile}. Use ${Object.keys(SAFE_ZONE_PROFILES).join(" or ")}.`);
  return found;
}

// Profile geometry scaled to the given canvas.
export function profileGeometry(canvas, profile) {
  validCanvas(canvas);
  const resolved = resolveProfile(profile, canvas);
  const ref = resolved.reference ?? canvas;
  const sx = canvas.width / ref.width;
  const sy = canvas.height / ref.height;
  const scale = (rect) => rect && { x: rect.x * sx, y: rect.y * sy, width: rect.width * sx, height: rect.height * sy };
  return {
    profile: resolved,
    safeZone: scale(resolved.safeZone),
    captionBand: scale(resolved.captionBand),
    centerOfMassY: resolved.centerOfMassY == null ? canvas.height / 2 : resolved.centerOfMassY * sy,
    centerOfMassTolerance: (resolved.centerOfMassTolerance ?? 0.2) * canvas.height,
    minTextPx: resolved.minTextPx == null ? null : resolved.minTextPx * sy
  };
}

export function checkLayout({ canvas, elements, safeZone, captionBand, profile, sampleStep = 1 / 30, duration } = {}) {
  validCanvas(canvas);
  if (!Array.isArray(elements)) throw new Error("elements must be an array");
  if (!(Number(sampleStep) > 0)) throw new Error("sampleStep must be a positive number");
  const geometry = profileGeometry(canvas, profile);
  const resolvedProfile = geometry.profile;
  const safe = safeZone ? validRect(safeZone, "safeZone") : geometry.safeZone;
  const band = captionBand ? validRect(captionBand, "captionBand") : geometry.captionBand;
  const items = elements.map(normalizeElement);
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`Duplicate element id: ${item.id}`);
    ids.add(item.id);
  }
  const findings = [];
  const add = (rule, severity, idList, at, detail) => findings.push({ rule, severity, ids: idList, at: round(at), detail });

  const keyed = items.filter((item) => item.role === "text" || item.role === "hero");
  const solid = items.filter((item) => item.role !== "decor" && item.role !== "caption");
  const captions = items.filter((item) => item.role === "caption");

  // 1. Safe-zone containment for key content at rest.
  for (const item of keyed) {
    if (!item.settled) continue;
    if (!contains(safe, item.rect)) {
      add("safe-zone", "error", [item.id], item.settled[0],
        `${item.role} rect ${rectText(item.rect)} leaves the ${resolvedProfile.id ?? "profile"} safe zone ${rectText(safe)} (${overflowText(safe, item.rect)})`);
    }
  }

  // 2. Same-time collisions between non-decor elements at rest.
  for (let i = 0; i < solid.length; i += 1) {
    for (let j = i + 1; j < solid.length; j += 1) {
      const a = solid[i], b = solid[j];
      if (!a.settled || !b.settled) continue;
      if (allows(a, b) || allows(b, a)) continue;
      const window = overlap(a.settled, b.settled);
      if (!window) continue;
      const shared = intersectionArea(a.rect, b.rect);
      if (shared <= EPSILON) continue;
      const smaller = Math.max(EPSILON, Math.min(area(a.rect), area(b.rect)));
      add("collision", "error", [a.id, b.id], window[0],
        `${a.id} and ${b.id} overlap by ${Math.round(shared)} px² (${Math.round((shared / smaller) * 100)}% of the smaller element) from ${round(window[0])}s to ${round(window[1])}s`);
    }
  }

  // 3. Caption-band clashes while captions are visible.
  for (const caption of captions) {
    const captionRect = caption.rect ?? band;
    if (!captionRect) continue;
    const visible = subtractWindows([caption.start, caption.end], caption.hide);
    for (const item of keyed) {
      if (!item.settled || item.hidesCaptions) continue;
      if (intersectionArea(item.rect, captionRect) <= EPSILON) continue;
      const clash = visible.map((window) => overlap(window, item.settled)).find(Boolean);
      if (!clash) continue;
      add("caption-band", "error", [item.id, caption.id], clash[0],
        `${item.id} sits in the caption band ${rectText(captionRect)} while captions are visible (${round(clash[0])}s–${round(clash[1])}s); move it or set hidesCaptions`);
    }
  }

  // 4. Minimum key-text size.
  if (geometry.minTextPx != null) {
    for (const item of items) {
      if (item.minTextPx == null || !(item.role === "text" || item.role === "hero" || item.role === "caption")) continue;
      if (item.minTextPx + EPSILON < geometry.minTextPx) {
        add("min-text-size", "error", [item.id], item.start,
          `smallest key text is ${round(item.minTextPx)} px; ${resolvedProfile.id ?? "this profile"} needs at least ${round(geometry.minTextPx)} px`);
      }
    }
  }

  // 5. Hero fill (warning).
  const heroFill = resolvedProfile.heroFill;
  if (heroFill) {
    for (const item of items) {
      if (item.role !== "hero") continue;
      const fill = item.rect.width / safe.width;
      if (fill + EPSILON < heroFill[0] || fill - EPSILON > heroFill[1]) {
        add("hero-fill", "warning", [item.id], item.start,
          `hero fills ${Math.round(fill * 100)}% of the safe width; aim for ${Math.round(heroFill[0] * 100)}–${Math.round(heroFill[1] * 100)}%`);
      }
    }
  }

  // Sweep-based rules.
  const end = Math.max(Number(duration) || 0, ...items.map((item) => item.end), 0);
  const step = Number(sampleStep);
  const samples = Math.max(0, Math.ceil(end / step - EPSILON));
  const maxEmpty = resolvedProfile.maxEmptySeconds ?? 3;

  // 6. Lower third empty (Shorts).
  if (resolvedProfile.lowerThird && samples) {
    const midpoint = safe.y + safe.height / 2;
    sweepRuns(samples, step, (t) => !solid.some((item) => active(item, t) && centerY(item.rect) > midpoint), (start, length) => {
      if (length > maxEmpty + EPSILON) {
        add("lower-third-empty", "warning", [], start,
          `nothing but captions or decor below y ${Math.round(midpoint)} for ${round(length)}s (${round(start)}s–${round(start + length)}s)`);
      }
    });
  }

  // 7. Centre-of-mass drift (warning).
  const massItems = items.filter((item) => item.role === "text" || item.role === "hero" || item.role === "media");
  if (massItems.length && samples) {
    const target = geometry.centerOfMassY;
    const tolerance = geometry.centerOfMassTolerance;
    let worst = null;
    sweepRuns(samples, step, (t) => {
      const centre = centerOfMass(massItems.filter((item) => settledAt(item, t)));
      const drifted = centre != null && Math.abs(centre - target) > tolerance;
      if (drifted && (!worst || Math.abs(centre - target) > Math.abs(worst - target))) worst = centre;
      return drifted;
    }, (start, length) => {
      if (length > maxEmpty + EPSILON) {
        const ids = massItems.filter((item) => settledAt(item, start + step / 2)).map((item) => item.id);
        add("centre-of-mass", "warning", ids, start,
          `centre of mass sits near y ${Math.round(worst)} for ${round(length)}s; target y ${Math.round(target)} ± ${Math.round(tolerance)}`);
      }
      worst = null;
    });
  }

  findings.sort((a, b) => a.at - b.at || (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1) || a.rule.localeCompare(b.rule));
  return {
    status: findings.some((finding) => finding.severity === "error") ? "failed" : "passed",
    profile: resolvedProfile.id ?? null,
    safeZone: safe,
    captionBand: band ?? null,
    findings
  };
}

// Camera sweeps: key content carried through the caption band by a camera
// move while captions are on screen. A layout check at rest cannot see it
// (every plate is clear of the band once the camera settles), so the caller
// samples each move frame by frame and passes the screen rect of every
// visible plate element (src/layout_check.js transforms the declared rects by
// the world camera, kit/core/camera-world.mjs). A crossing is a warning, or an
// error once it lasts at least `errorSeconds`.
//   frames: [{t, move: {sceneId, type, start, duration}, rects: [{id, rect}]}]
//   captionVisible: [[from, to]] spans where captions are on screen
//   step: seconds between frames (1 / fps)
// minOverlap: the share of the band a rect must cover to count, so a panel
// edge grazing the band through the camera drift is not a crossing.
export const CAMERA_SWEEP = Object.freeze({ errorSeconds: 0.25, minOverlap: 0.05 });

export function checkCameraSweeps({ band, frames = [], captionVisible = [], step = 1 / 30, errorSeconds = CAMERA_SWEEP.errorSeconds, minOverlap = CAMERA_SWEEP.minOverlap } = {}) {
  if (!band) return [];
  const bandArea = Math.max(EPSILON, area(band));
  const visible = (t) => captionVisible.some(([from, to]) => t >= from - EPSILON && t < to - EPSILON);
  const runs = new Map();
  for (const frame of frames) {
    if (!visible(frame.t)) continue;
    for (const { id, rect } of frame.rects) {
      if (intersectionArea(rect, band) / bandArea < minOverlap) continue;
      const key = `${frame.move.sceneId}\u0000${id}`;
      const run = runs.get(key) ?? { id, move: frame.move, first: frame.t, last: frame.t, count: 0 };
      run.first = Math.min(run.first, frame.t); run.last = Math.max(run.last, frame.t); run.count += 1;
      runs.set(key, run);
    }
  }
  return [...runs.values()].map((run) => {
    const seconds = run.count * step;
    const direction = run.move.direction ? ` ${run.move.direction}` : "";
    return {
      rule: "camera-caption-band",
      severity: seconds + EPSILON >= errorSeconds ? "error" : "warning",
      ids: [run.id, run.move.sceneId],
      at: round(run.first),
      detail: `the ${run.move.type}${direction} into ${run.move.sceneId} carries ${run.id} through the caption band ${rectText(band)} while captions are on screen (${round(seconds)}s, ${round(run.first)}s–${round(run.last + step)}s); keep captions.hide_during_moves on ("auto" or true), use a horizontal pan, or move the panel`
    };
  });
}

// Adapts the `layout` object returned by editorial modules
// ({canvas, rect, motion?: {enterEnd, exitStart, end}}) into elements.
// Without motion the layout carries no timing, so pass start and end.
export function elementsFromEditorialLayout(layout, { id, role = "text", start, end, track, enterDuration = 0.36, canvas, minTextPx, allowOcclusion, hidesCaptions } = {}) {
  if (!layout || typeof layout !== "object" || !layout.rect) throw new Error("editorial layout must include rect");
  if (!id) throw new Error("editorial layout element needs an id");
  const motion = layout.motion;
  const from = start ?? (motion ? motion.enterEnd - enterDuration : undefined);
  const to = end ?? motion?.end;
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error(`editorial layout ${id} has no motion timing; pass start and end`);
  const source = layout.canvas;
  const sx = canvas && source ? canvas.width / source.width : 1;
  const sy = canvas && source ? canvas.height / source.height : 1;
  const element = {
    id,
    role,
    rect: { x: layout.rect.x * sx, y: layout.rect.y * sy, width: layout.rect.width * sx, height: layout.rect.height * sy },
    start: from,
    end: to
  };
  if (track !== undefined) element.track = track;
  if (motion) element.motion = { enterEnd: motion.enterEnd, exitStart: motion.exitStart };
  if (minTextPx !== undefined) element.minTextPx = minTextPx * sy;
  if (allowOcclusion) element.allowOcclusion = allowOcclusion;
  if (hidesCaptions) element.hidesCaptions = true;
  return [element];
}

// Builds elements for a resolved story. `moduleLayout(scene, story)` returns the
// scene's elements (or nothing to skip it), so this file never imports module
// code. A captions overlay becomes one caption element over the delivery band.
export function elementsFromStory(resolvedStory, { moduleLayout, profile, captionBand } = {}) {
  if (!resolvedStory || !Array.isArray(resolvedStory.scenes)) throw new Error("story must have scenes");
  if (typeof moduleLayout !== "function") throw new Error("moduleLayout callback is required");
  const format = resolvedStory.format ?? {};
  const canvas = { width: Number(format.width), height: Number(format.height) };
  validCanvas(canvas);
  const elements = [];
  for (const scene of resolvedStory.scenes) {
    const produced = moduleLayout(scene, resolvedStory) ?? [];
    for (const element of Array.isArray(produced) ? produced : [produced]) {
      if (!element) continue;
      elements.push({
        ...element,
        id: element.id ?? scene.id,
        start: element.start ?? Number(scene.start),
        end: element.end ?? Number(scene.end),
        ...(element.track === undefined && scene.track !== undefined ? { track: scene.track } : {})
      });
    }
  }
  const duration = Number(resolvedStory.resolved?.duration ?? format.duration ?? Math.max(0, ...elements.map((element) => element.end)));
  const overlays = Array.isArray(resolvedStory.overlays) ? resolvedStory.overlays : [];
  overlays.filter((overlay) => overlay?.type === "captions").forEach((overlay, index) => {
    const band = overlay.rect ?? captionBandAt(captionBand ?? profileGeometry(canvas, profile).captionBand, canvas, overlay.position);
    const hide = [
      ...(Array.isArray(overlay.hide) ? overlay.hide : []),
      ...resolvedStory.scenes.filter((scene) => scene.hides_captions === true).map((scene) => [Number(scene.start), Number(scene.end)])
    ];
    elements.push({
      id: index ? `captions-${index + 1}` : "captions",
      role: "caption",
      rect: band,
      start: Number(overlay.start ?? 0),
      end: Number(overlay.end ?? duration),
      ...(hide.length ? { hide } : {})
    });
  });
  return elements;
}

// Caption position (captions overlay `position`): the band moves up to the
// top or the middle of the frame; kept in step with captionBandTop() in
// kit/core/captions.mjs (test/caption_presets.test.js).
export const CAPTION_POSITION_TOP = Object.freeze({ portrait: 0.13, landscape: 0.08 });
export function captionBandAt(band, canvas, position) {
  if (!band || (position !== "top" && position !== "middle")) return band;
  const landscape = canvas.width > canvas.height;
  const y = position === "top" ? canvas.height * (landscape ? CAPTION_POSITION_TOP.landscape : CAPTION_POSITION_TOP.portrait) : canvas.height / 2 - band.height / 2;
  return { ...band, y };
}

function normalizeElement(element, index) {
  if (!element || typeof element !== "object") throw new Error(`element ${index} must be an object`);
  const id = String(element.id ?? "");
  if (!id) throw new Error(`element ${index} needs an id`);
  if (!ROLES.has(element.role)) throw new Error(`element ${id} role must be ${[...ROLES].join(", ")}`);
  const start = Number(element.start), end = Number(element.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error(`element ${id} needs finite start <= end`);
  const rect = element.rect == null && element.role === "caption" ? null : validRect(element.rect, `element ${id} rect`);
  const enterEnd = clamp(Number(element.motion?.enterEnd ?? start), start, end);
  const exitStart = clamp(Number(element.motion?.exitStart ?? end), start, end);
  return {
    id,
    role: element.role,
    rect,
    start,
    end,
    settled: exitStart - enterEnd > EPSILON ? [enterEnd, exitStart] : null,
    minTextPx: element.minTextPx == null ? null : Number(element.minTextPx),
    allowOcclusion: Array.isArray(element.allowOcclusion) ? element.allowOcclusion.map(String) : [],
    hidesCaptions: element.hidesCaptions === true,
    hide: Array.isArray(element.hide) ? element.hide.map(([a, b]) => [Number(a), Number(b)]) : []
  };
}

function validCanvas(canvas) {
  if (!canvas || !(Number(canvas.width) > 0) || !(Number(canvas.height) > 0)) throw new Error("canvas needs positive width and height");
}

function validRect(rect, label) {
  if (!rect || typeof rect !== "object") throw new Error(`${label} must be {x, y, width, height}`);
  const out = { x: Number(rect.x), y: Number(rect.y), width: Number(rect.width), height: Number(rect.height) };
  if (![out.x, out.y, out.width, out.height].every(Number.isFinite) || out.width < 0 || out.height < 0) throw new Error(`${label} must be {x, y, width, height} with non-negative size`);
  return out;
}

function allows(a, b) {
  return a.allowOcclusion.includes(b.id) || a.allowOcclusion.includes("*");
}

function contains(outer, inner) {
  return inner.x >= outer.x - EPSILON && inner.y >= outer.y - EPSILON
    && inner.x + inner.width <= outer.x + outer.width + EPSILON
    && inner.y + inner.height <= outer.y + outer.height + EPSILON;
}

function overflowText(outer, inner) {
  const parts = [];
  if (inner.x < outer.x) parts.push(`left ${Math.round(outer.x - inner.x)} px`);
  if (inner.y < outer.y) parts.push(`top ${Math.round(outer.y - inner.y)} px`);
  if (inner.x + inner.width > outer.x + outer.width) parts.push(`right ${Math.round(inner.x + inner.width - outer.x - outer.width)} px`);
  if (inner.y + inner.height > outer.y + outer.height) parts.push(`bottom ${Math.round(inner.y + inner.height - outer.y - outer.height)} px`);
  return parts.join(", ");
}

function area(rect) {
  return rect.width * rect.height;
}

function intersectionArea(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function overlap(a, b) {
  const start = Math.max(a[0], b[0]), end = Math.min(a[1], b[1]);
  return end - start > EPSILON ? [start, end] : null;
}

function subtractWindows(window, holes) {
  let pieces = [window];
  for (const [holeStart, holeEnd] of holes) {
    pieces = pieces.flatMap(([start, end]) => {
      if (holeEnd <= start || holeStart >= end) return [[start, end]];
      return [[start, holeStart], [holeEnd, end]].filter(([a, b]) => b - a > EPSILON);
    });
  }
  return pieces;
}

function active(item, t) {
  return t >= item.start - EPSILON && t < item.end - EPSILON;
}

function settledAt(item, t) {
  return item.settled && t >= item.settled[0] - EPSILON && t < item.settled[1] - EPSILON;
}

function centerY(rect) {
  return rect.y + rect.height / 2;
}

function centerOfMass(items) {
  let weight = 0, sum = 0;
  for (const item of items) {
    const w = area(item.rect);
    weight += w;
    sum += w * centerY(item.rect);
  }
  return weight > 0 ? sum / weight : null;
}

// Calls onRun(start, length) for every maximal run of samples where test(t) holds.
function sweepRuns(samples, step, test, onRun) {
  let runStart = null;
  for (let index = 0; index < samples; index += 1) {
    const t = index * step;
    if (test(t)) {
      if (runStart === null) runStart = index;
    } else if (runStart !== null) {
      onRun(runStart * step, (index - runStart) * step);
      runStart = null;
    }
  }
  if (runStart !== null) onRun(runStart * step, (samples - runStart) * step);
}

function rectText(rect) {
  return `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}×${Math.round(rect.height)}`;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

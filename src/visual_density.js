// Visual density over the whole timeline: how much of the frame shows
// something (footage, a picture, type) rather than a flat brand surface, and
// how much of it is footage. A short that runs footage in the top half over
// an empty brand panel, then ends on flat cards, reads as sparse and cheap
// even when every scene passes the per-region density gate (one short line
// "fills" a third). Read from the layout check's element rects and the
// scenes' plates, so the plan (before any render) and finish (on the rendered
// story) get the same verdict, and both renderers draw from the same models.
//
//   visualDensity(story, rects) → {samples, mean_fill, footage_share,
//     sparse_share, ending: {from, mean_fill, min_fill}, findings}
//   visualDensityGate(story, {rects}) → a guardrail gate result
//   visualDensityErrors(story, rects) → "density: …" planner repair notes
//
// At each moment the frame is a coarse grid. A cell is filled when a media,
// text or hero element covers it, or a scene's footage plate (a video or
// image backdrop) shows through its dim there (at least `seen`); else it is
// bare surface. Captions, decor panels and drawn plates do not fill: they are
// the surface. fill = the filled share; footage = the media share, a plate
// counted by how much of it shows (1 - dim).
// shortcut: a module that paints an opaque ground over its own footage plate
// (an end-card layout named with a solid ground) still counts the plate; read
// the model's ground here if plans start naming such layouts over footage.
import { platePlan, scenePlateSpec } from "@launchclip/core/plates.mjs";

export const VISUAL_DENSITY = Object.freeze({
  step: 0.5,
  // Below this fill a moment is sparse: more of the frame bare surface than not
  // (footage in 40% of the frame over a panel holding one line is sparse).
  floor: 0.55,
  // A footage plate fills its cells when at least this much of it shows through its dim.
  seen: 0.3,
  // At most this share of the timeline may be sparse.
  sparseShare: 0.25,
  // No sparse run longer than this (s) anywhere.
  run: 2,
  // The ending (the last `ending` share, at least `endingSeconds`) holds the floor to the last second: no sparse moment at all.
  ending: 0.25,
  endingSeconds: 5,
  grid: Object.freeze({ cols: 9, rows: 16 }),
  // Shorts only (src/short_form_checks.js SHORT_SECONDS).
  maxSeconds: 90
});

const FILLING = new Set(["media", "text", "hero"]);
const FOOTAGE = new Set(["video", "image"]);
const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

// A scene's footage plate → how much of it shows (1 - its dim), or 0.
function plateFootage(story, scene) {
  let spec = null;
  try { spec = scenePlateSpec(story, scene); } catch { return 0; }
  if (!spec || !FOOTAGE.has(spec.kind)) return 0;
  let dim = Number(spec.params?.dim);
  try { dim = Number(platePlan(story, spec)?.params?.dim ?? dim); } catch { /* the spec's own dim */ }
  return Math.max(0, 1 - (Number.isFinite(dim) ? dim : 0.62));
}

/**
 * The timeline's density. story: a resolved story; rects: [{id, role, rect,
 * start, end, hide?}] (checkLayoutProject().rects, or the planner's layout
 * elements).
 */
export function visualDensity(story, rects = [], options = {}) {
  const k = { ...VISUAL_DENSITY, ...options };
  const W = Number(story?.format?.width), H = Number(story?.format?.height);
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration) || 0;
  if (!(W > 0 && H > 0) || !(duration > 0)) return null;
  const { cols, rows } = H > W ? k.grid : { cols: k.grid.rows, rows: k.grid.cols };
  const plates = (story.scenes ?? []).filter((scene) => (scene?.track ?? 0) === 0 && Number(scene.end) > Number(scene.start))
    .map((scene) => ({ start: Number(scene.start), end: Number(scene.end), footage: plateFootage(story, scene) })).filter((entry) => entry.footage > 0);
  if (story.base) plates.push({ start: 0, end: duration, footage: 1 });
  const live = (entry, t) => entry.start <= t + 1e-6 && entry.end > t + 1e-6 && !(entry.hide ?? []).some(([a, b]) => a <= t + 1e-6 && b > t + 1e-6);
  const samples = [];
  for (let t = 0; t < duration - 1e-6; t += k.step) {
    const at = round(t, 2);
    const plate = Math.max(0, ...plates.filter((entry) => live(entry, at)).map((entry) => entry.footage));
    const active = rects.filter((entry) => FILLING.has(entry.role) && entry.rect && live(entry, at));
    let fill = 0, footage = 0;
    for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
      const x = ((c + 0.5) / cols) * W, y = ((r + 0.5) / rows) * H;
      const over = active.filter(({ rect }) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height);
      footage += over.some((entry) => entry.role === "media") ? 1 : plate;
      fill += over.length || plate >= k.seen ? 1 : 0;
    }
    samples.push({ t: at, fill: round(fill / (rows * cols)), footage: round(footage / (rows * cols)) });
  }
  // shortcut: footage shorts only (a drawn world or a character story fills the frame with decor this does not count); widen it once world and cast scenes report their fill.
  if (duration > k.maxSeconds || !samples.some((s) => s.footage > 0)) return null;
  const mean = (list, key) => (list.length ? round(list.reduce((sum, s) => sum + s[key], 0) / list.length) : 0);
  const sparse = samples.filter((s) => s.fill < k.floor);
  const from = round(Math.max(0, duration - Math.max(k.endingSeconds, duration * k.ending)), 2);
  const tail = samples.filter((s) => s.t >= from - 1e-6);
  const findings = [];
  // Sparse runs: anywhere over `run` s; in the ending, any at all.
  let runFrom = null;
  const close = (end) => {
    if (runFrom == null) return;
    const len = round(end - runFrom, 2);
    const inEnding = end > from + 1e-6;
    if (len > k.run + 1e-6 || inEnding) {
      const a = inEnding ? Math.max(runFrom, from) : runFrom;
      findings.push(inEnding
        ? { rule: "sparse-ending", severity: "error", at: round(a, 2), ids: [], detail: `the ending is sparse from ${round(a, 2)} s to ${round(end, 2)} s (fill under ${k.floor}); keep footage or full-bleed type on screen through the payoff and the call to action` }
        : { rule: "sparse-run", severity: "error", at: runFrom, ids: [], detail: `the frame is mostly flat surface for ${len} s (${runFrom}–${round(end, 2)} s, fill under ${k.floor}); put footage, a picture or full-bleed type there` });
    }
    runFrom = null;
  };
  for (const s of samples) {
    if (s.fill < k.floor) runFrom ??= s.t;
    else close(s.t);
  }
  close(duration);
  const sparseShare = samples.length ? round(sparse.length / samples.length) : 0;
  if (sparseShare > k.sparseShare + 1e-9) findings.push({ rule: "sparse-share", severity: "error", at: sparse[0]?.t ?? 0, ids: [], detail: `${Math.round(sparseShare * 100)}% of the video is mostly flat surface (aim for at most ${Math.round(k.sparseShare * 100)}%); give the sparse stretches footage, a picture or full-bleed type` });
  return {
    samples,
    mean_fill: mean(samples, "fill"),
    footage_share: mean(samples, "footage"),
    sparse_share: sparseShare,
    ending: { from, mean_fill: mean(tail, "fill"), min_fill: tail.length ? Math.min(...tail.map((s) => s.fill)) : 0 },
    findings: findings.sort((a, b) => a.at - b.at)
  };
}

/** The visual-density gate for finish: {status, findings, measures} (skipped without rects). */
export function visualDensityGate(story, { rects = [] } = {}) {
  if (!rects.length) return { status: "skipped", reason: "no layout rects" };
  const measured = visualDensity(story, rects);
  if (!measured) return { status: "skipped", reason: "not a footage short" };
  const { samples: _samples, findings, ...measures } = measured;
  return { status: findings.some((f) => f.severity === "error") ? "failed" : "passed", findings, measures };
}

/** The planner's repair notes: "density: <rule> @<t>s <detail>". */
export function visualDensityErrors(story, rects = []) {
  const measured = visualDensity(story, rects);
  return (measured?.findings ?? []).filter((f) => f.severity === "error").map((f) => `density: ${f.rule} @${f.at}s ${f.detail}`);
}

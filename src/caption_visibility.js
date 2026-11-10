// The captions-visible gate. A brand that turned captions on expects to see
// them: tooling may hide them under a card as a last resort
// (src/caption_band_fit.js), scene by scene, but a video whose captions are
// hidden for more than a small share of its narration does not ship. The
// gate names the scenes, so the plan can put their text clear of the band.
//
// Counted: the ranges the captions overlay hides (overlay.hide, which is
// where tooling writes them) and the scenes a plan flags hides_captions.
// Not counted: a module that carries the line itself and hides the captions
// while it is up (a hook title, kinetic words, a call to action); its share
// is reported beside the gate's (module_share).

import { captionsOverlayOf } from "@launchclip/core/captions.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { CAPTION_HIDDEN_MAX } from "@launchclip/core/planning-prompt.mjs";

// The share of the narration captions may be hidden for before the gate fails (the planner is told the same number).
export { CAPTION_HIDDEN_MAX };

const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

// The seconds of [start, end] inside any of the ranges.
function covered(start, end, ranges) {
  let total = 0, at = start;
  for (const [from, to] of ranges) {
    const a = Math.max(at, from), b = Math.min(end, to);
    if (b > a) { total += b - a; at = b; }
  }
  return total;
}

function merged(ranges) {
  const out = [];
  for (const [from, to] of ranges.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0])) {
    const last = out.at(-1);
    if (last && from <= last[1] + 1e-6) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/**
 * resolved: the resolved story; words: the narration's [{start, end}].
 * → {status: "passed" | "failed" | "skipped", reason?, share (of the spoken
 *    time the captions are hidden for), hidden_seconds, narration_seconds,
 *    max_share, module_share, scenes: [{id, module, start, end, seconds}]
 *    (worst first), errors: [one line naming the scenes]}
 */
export function captionVisibilityGate(resolved, words = [], { max = CAPTION_HIDDEN_MAX, band = null } = {}) {
  const overlay = captionsOverlayOf(resolved);
  if (!overlay) return { status: "skipped", reason: "the story has no captions" };
  const spoken = (words ?? []).map((word) => [Number(word.start), Number(word.end)]).filter(([a, b]) => b > a);
  const total = spoken.reduce((sum, [a, b]) => sum + b - a, 0);
  if (!(total > 0)) return { status: "skipped", reason: "no narration words to caption" };
  const scenes = Array.isArray(resolved?.scenes) ? resolved.scenes : [];
  const hidden = merged([
    ...(Array.isArray(overlay.hide) ? overlay.hide : []).map((range) => [Number(range?.[0]), Number(range?.[1])]),
    ...scenes.filter((scene) => scene?.hides_captions === true).map((scene) => [Number(scene.start), Number(scene.end)])
  ]);
  const own = merged(scenes.filter((scene) => {
    try { return resolveModule(scene, resolved)?.hidesCaptions === true; } catch { return false; }
  }).map((scene) => [Number(scene.start), Number(scene.end)]));
  const seconds = (ranges) => spoken.reduce((sum, [a, b]) => sum + covered(a, b, ranges), 0);
  const hiddenSeconds = seconds(hidden);
  const share = hiddenSeconds / total;
  const named = scenes.map((scene) => {
    const start = Number(scene.start), end = Number(scene.end);
    const inScene = hidden.map(([a, b]) => [Math.max(a, start), Math.min(b, end)]).filter(([a, b]) => b > a);
    return { id: scene.id, module: scene.module, start: round(start), end: round(end), seconds: round(seconds(inScene)) };
  }).filter((scene) => scene.seconds > 0.05).sort((a, b) => b.seconds - a.seconds);
  const failed = share > max + 1e-9;
  const where = band ? ` (y ${Math.round(band.y)}–${Math.round(band.y) + Math.round(band.height)})` : "";
  return {
    status: failed ? "failed" : "passed",
    share: round(share, 3),
    hidden_seconds: round(hiddenSeconds),
    narration_seconds: round(total),
    max_share: max,
    module_share: round(seconds(own) / total, 3),
    scenes: named.slice(0, 12),
    ...(failed ? { errors: [`captions are on but hidden for ${Math.round(share * 100)}% of the narration (${round(hiddenSeconds, 1)} of ${round(total, 1)} s; at most ${Math.round(max * 100)}%): under ${named.slice(0, 8).map((scene) => `${scene.id} (${scene.module}, ${scene.start}–${scene.end} s)`).join(", ")}. Plan those scenes' text clear of the caption band${where}, in the top or the bottom of the frame, or use a module that leaves the band free`] } : {})
  };
}

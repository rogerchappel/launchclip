// Tooling fits timing (docs/LONG_FORM_MAKE_RFC.md, phase 1): a storyboard that
// fails only because a scene's explicit event time sits just outside the
// window its module allows ("params.at must fall between 0.5 s and 1.37 s
// after the scene start; got 0.28 s") is moved to the nearest edge of that
// window by tooling, instead of spending a model repair on a number. The
// modules stay strict; this only rewrites the storyboard the planner returned.

const TIMING_ERROR = /scenes\[(\d+)\][^]*?\b(params(?:\.[A-Za-z_]\w*|\[\d+\])+) must fall between (-?[\d.]+) s and (-?[\d.]+) s after the scene start; got (-?[\d.]+) s/;

/** The fixable timing errors in a list of check errors: [{scene, path, min, max, got}]. */
export function timingErrors(errors) {
  const out = [];
  for (const error of errors ?? []) {
    const match = TIMING_ERROR.exec(String(error));
    if (!match) continue;
    const [, scene, path, min, max, got] = match;
    // An empty window (the scene is too short for the module) has no edge to move to.
    if (Number(min) > Number(max)) continue;
    out.push({ scene: Number(scene), path, min: Number(min), max: Number(max), got: Number(got) });
  }
  return out;
}

/**
 * A copy of the storyboard with each fixable timing moved into its window,
 * and what moved: {storyboard, moved: ["scene-id params.at 0.28 → 0.5 s"]}.
 * Only explicit numeric params move; a default time is the module's own.
 */
export function fitTimings(storyboard, errors) {
  const found = timingErrors(errors);
  if (!found.length) return { storyboard, moved: [] };
  const copy = structuredClone(storyboard);
  const moved = [];
  for (const { scene, path, min, max } of found) {
    const target = copy?.scenes?.[scene];
    if (!target) continue;
    const keys = path.replace(/\[(\d+)\]/g, ".$1").split(".");
    let holder = target;
    for (const key of keys.slice(0, -1)) holder = holder?.[key];
    const last = keys.at(-1);
    const value = holder?.[last];
    if (typeof value !== "number") continue;
    // A hair inside the edge, so rounding never lands it back outside.
    const inside = max - min < 0.02 ? (min + max) / 2 : Math.min(max - 0.01, Math.max(min + 0.01, value));
    const next = Math.round(inside * 100) / 100;
    if (next === value) continue;
    holder[last] = next;
    moved.push(`${target.id ?? `scenes[${scene}]`} ${path} ${value} → ${next} s`);
  }
  return { storyboard: moved.length ? copy : storyboard, moved };
}

// A whole short that loops (docs/FLUID_MOTION_RFC.md §8, phase 6): the last
// scene hands back to the first. `ending.loop_to` draws the target scene's
// first state, frozen, over the final window (transitions.mjs sceneWindows);
// this file holds the two story-level rules that make that a seam you cannot
// see:
//   - the hand-back lands on the last frame, so the last frame is the frozen
//     first state and nothing of the outgoing scene is left on it;
//   - the scene it hands back to is the opener, the scene frame 0 shows;
//     otherwise replay jumps from that scene to the opener.
// A scene that loops on its own is scene.loop (kit/core/loop.mjs).
//
// Plain ESM, no imports.

const round = (value) => Math.round(value * 1e6) / 1e6;

/** When a typed hand-back (ending.in) of `dur` s starts, so it lands on the last frame of a `duration` s story at `fps`. */
export function loopEndingStart(duration, dur, fps) {
  return round(duration - 1 / fps - dur);
}

/** The scene frame 0 shows: the earliest track-0 scene (the plate), else the earliest scene. */
function opener(scenes) {
  const starts = (list) => list.filter((scene) => Number.isFinite(Number(scene?.start))).sort((a, b) => Number(a.start) - Number(b.start));
  return starts(scenes.filter((scene) => (scene?.track ?? 0) === 0))[0] ?? starts(scenes)[0] ?? null;
}

/**
 * Story-level loop findings (same shape as kit/core/motion-check.mjs):
 * `loop-target` (warning) when ending.loop_to names a scene other than the
 * opener, so the last frame shows a different scene from the first.
 */
export function storyLoopFindings(story) {
  const target = story?.ending?.loop_to;
  const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
  if (typeof target !== 'string' || !scenes.some((scene) => scene?.id === target)) return [];
  const first = opener(scenes);
  if (!first || first.id === target) return [];
  return [{ rule: 'loop-target', severity: 'warning', at: Number(story?.format?.duration) || 0, ids: [target, first.id],
    detail: `ending.loop_to returns to "${target}" but the video opens on "${first.id}", so replay jumps from one to the other; loop to "${first.id}" for a seamless loop (docs/FLUID_MOTION_RFC.md §8)` }];
}

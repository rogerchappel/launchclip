// Talking-head layouts for `launchclip make --layout <name>`: how a footage-led
// (talking-head) short arranges the presenter and the graphics for the whole
// video.
//
//   full      today's behaviour: the planner picks footage layouts per section
//             (kit/core/footage-layout.mjs), overlays ride the full-frame take
//   stacked   the presenter stays on screen in the lower part, a graphics panel
//             above changes every sentence (src/stacked_layout.js)
//   overlay   one continuous full-frame take, graphics in the free space
//             around the presenter (some behind them, through the subject
//             matte), captions at the chest (src/overlay_layout.js)
//
// Each layout says where its captions go (captions), adds planner guidance
// (prompt), rebuilds the plan's sections (apply) and checks the result
// (check). presenterHead is the face and subject box every layout measures
// the presenter by.

import { OVERLAY_CAPTIONS, applyOverlayLayout, overlayLayoutErrors, overlayPrompt } from "./overlay_layout.js";
import { STACKED_CAPTIONS, applyStackedLayout, stackedFaceWarnings, stackedLayoutErrors, stackedPrompt } from "./stacked_layout.js";

export { cameraPoint, presenterHead } from "./presenter_box.js";

export const TALKING_HEAD_LAYOUTS = Object.freeze(["full", "stacked", "overlay"]);
export const DEFAULT_TALKING_HEAD_LAYOUT = "full";
// Layouts make can render today.
export const BUILT_TALKING_HEAD_LAYOUTS = Object.freeze(["full", "stacked", "overlay"]);

const LAYOUTS = Object.freeze({
  full: null,
  stacked: Object.freeze({
    captions: STACKED_CAPTIONS,
    prompt: stackedPrompt,
    apply: applyStackedLayout,
    check: (storyboard, options) => stackedLayoutErrors(storyboard, options),
    faces: stackedFaceWarnings
  }),
  overlay: Object.freeze({
    captions: OVERLAY_CAPTIONS,
    prompt: overlayPrompt,
    apply: applyOverlayLayout,
    // The face check is part of overlayLayoutErrors (it reads each overlay's rect).
    check: (storyboard) => overlayLayoutErrors(storyboard),
    faces: () => []
  })
});

/** The layout name a flag value means: full, stacked or overlay; null for an unknown name. */
export function talkingHeadLayout(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_TALKING_HEAD_LAYOUT;
  const name = String(value).trim().toLowerCase();
  return TALKING_HEAD_LAYOUTS.includes(name) ? name : null;
}

/** An error message for a --layout value make cannot use, else null. */
export function talkingHeadLayoutError(value) {
  const name = talkingHeadLayout(value);
  if (!name) return `--layout must be one of ${TALKING_HEAD_LAYOUTS.join(", ")}; got ${value}`;
  if (!BUILT_TALKING_HEAD_LAYOUTS.includes(name)) return `--layout ${name} is planned but not built yet; use ${BUILT_TALKING_HEAD_LAYOUTS.join(" or ")}`;
  return null;
}

/** The layout's spec ({captions, prompt, apply, check, faces}), or null for full. */
export function layoutSpec(name) {
  return LAYOUTS[name] ?? null;
}

/**
 * Where a layout puts the captions: {position, preset, max_words}, or null
 * where the story's own captions stand (full).
 */
export function layoutCaptions(name) {
  return layoutSpec(name)?.captions ?? null;
}

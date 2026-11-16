// The finishing chain (docs/FINISHING_AND_ELEMENTS_RFC.md §E.1): whole-frame
// shader passes that read the finished frame, run once after either renderer
// by src/finish_pass.js, so the finish is in parity by construction.
//
//   story.finish = [{pass: "grain", amount: 0.08}, {pass: "aberration", px: 2}]
//
// Passes run in STORY_FINISH_PASSES order whatever order the story lists
// them in. Every pass is off unless listed. The grade joins the chain (from a
// {pass: "grade"} entry, else story.grade) only when another pass is listed;
// a grade alone stays the ffmpeg lut3d pass (src/grade.js).
//
// The protect mask keeps text crisp: inside the caption band while a caption
// shows, and inside the brand frame's regions while the frame shows, every
// pass but the grade mixes back to its input pixel, feathered
// FINISH_PROTECT_FEATHER px.
//
// Pure ESM that imports only kit/core siblings. Canonical copy:
// kit/core/finish.mjs.

import { STORY_FINISH_PASSES } from './story.mjs';
import { brandFrameLayout, frameWindows } from './brand-frame.mjs';

export const FINISH_PASS_NAMES = Object.freeze(Object.keys(STORY_FINISH_PASSES));
export const FINISH_PROTECT_FEATHER = 12;
// Rects the shader takes at once; a frame showing more protects the first ones.
export const FINISH_PROTECT_MAX = 16;

/** One pass's params with defaults filled in. */
export function finishParams(pass, given = {}) {
  const spec = STORY_FINISH_PASSES[pass];
  if (!spec) return { ...given };
  const out = {};
  for (const [key, rule] of Object.entries(spec)) out[key] = given[key] ?? (Array.isArray(rule) ? rule[2] : rule);
  return out;
}

/**
 * The chain a story asks for, or null when it lists no shader pass.
 * → [{pass, params}] in chain order; grade's params are its grade value.
 */
export function resolveFinish(story) {
  const listed = Array.isArray(story?.finish) ? story.finish.filter((entry) => FINISH_PASS_NAMES.includes(entry?.pass)) : [];
  if (!listed.some((entry) => entry.pass !== 'grade')) return null;
  const byName = new Map(listed.map(({ pass, ...params }) => [pass, params]));
  if (!byName.has('grade') && story?.grade !== undefined) byName.set('grade', story.grade);
  const chain = [];
  for (const pass of FINISH_PASS_NAMES) {
    if (!byName.has(pass)) continue;
    const given = byName.get(pass);
    // grade: a {pass: "grade"} entry's fields, or story.grade as written.
    if (pass === 'grade') { if (given && given !== 'off') chain.push({ pass, params: given }); }
    else chain.push({ pass, params: finishParams(pass, given) });
  }
  return chain;
}

/**
 * The protect mask's rects (px, image space, y down), each with the seconds
 * it shows: the brand frame's regions over its windows, and `captionRect`
 * over each caption window ([start, end] seconds).
 * → [{x, y, width, height, start, end}]
 */
export function protectRects(story, { captions = [], captionRect = null, format = story?.format } = {}) {
  const rects = [];
  const layout = brandFrameLayout(story, format);
  if (layout) {
    for (const [start, end] of frameWindows(story, layout.frame)) for (const { rect } of layout.regions) rects.push({ ...rect, start, end });
  }
  if (captionRect) for (const [start, end] of captions) rects.push({ ...captionRect, start, end });
  return rects;
}

/** The rects showing at `t` seconds, at most FINISH_PROTECT_MAX. */
export const activeRects = (rects, t) => rects.filter((r) => t >= r.start && t < r.end).slice(0, FINISH_PROTECT_MAX);

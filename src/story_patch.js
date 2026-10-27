// Node-side entry for story patches (kit/core/story-patch.mjs): chat edits
// arrive as RFC 6902 JSON Patch, and diffSegments says which render segments
// an edit invalidates, from the same segment plan and hashes `finish` caches
// by (src/render_segments.js). Contract: docs/KIT_CONTRACTS.md, "Story patches".
import { gatherSegmentInputs, hashSegments, planSegments, sceneModels } from "./render_segments.js";

export { applyJsonPatch, applyStoryPatch, formatPointer, messagePointer, parsePointer } from "../kit/core/story-patch.mjs";

// Segment inputs without a project: captions and asset contents come from
// files, which both sides of an edit share, so only what the stories say can
// differ. The kit and fonts are the same engine on both sides.
function storyOnlyInputs(story, renderer) {
  return { renderer, kit: null, fonts: null, captions: null, assets: {}, base: null, models: sceneModels(story) };
}

/**
 * Which render segments an edit invalidates. oldStory and newStory are
 * resolved stories (applyStoryPatch's `resolved`). Both are planned and
 * hashed exactly as `finish` does; a segment of the new story whose hash the
 * old story already had is a cache hit, every other one must re-render.
 * options.project: also hash captions and asset files from that project, as
 * finish does (default: the stories alone). options.renderer: "remotion"
 * (default) or "hyperframes".
 * → {segments: [{index, id, label, kind, start, end, startFrame, endFrame,
 *    frames, scenes, status: "unchanged" | "changed" | "new", parts}],
 *    invalidated: [ids], removed: [old ids no longer used], global: boolean,
 *    frames: {total, invalidated}}.
 * status "changed": a segment with the same layers existed and `parts` names
 * what changed ("global", "layers", "captions", "overlays", "assets",
 * "camera", "frames"); "new": the edit moved a cut, so no segment had these
 * layers. global: the edit touched a setting every segment depends on.
 */
export async function diffSegments(oldStory, newStory, { project = null, renderer = "remotion" } = {}) {
  const hashed = async (story) => {
    const plan = planSegments(story);
    const inputs = project ? await gatherSegmentInputs(project, story, renderer) : storyOnlyInputs(story, renderer);
    return hashSegments(story, plan, inputs);
  };
  const [before, after] = [await hashed(oldStory), await hashed(newStory)];
  const oldHashes = new Set(before.map((segment) => segment.hash));
  const newHashes = new Set(after.map((segment) => segment.hash));
  const byLabel = new Map(before.map((segment) => [segment.label, segment]));
  const segments = after.map((segment) => {
    const { hash, parts, layers: _layers, ...shown } = segment;
    if (oldHashes.has(hash)) return { ...shown, status: "unchanged", parts: [] };
    const previous = byLabel.get(segment.label);
    if (!previous) return { ...shown, status: "new", parts: Object.keys(parts) };
    const changed = Object.keys({ ...parts, ...previous.parts }).filter((key) => parts[key] !== previous.parts[key]);
    if (previous.startFrame !== segment.startFrame || previous.endFrame !== segment.endFrame) changed.push("frames");
    return { ...shown, status: "changed", parts: changed };
  });
  const invalidated = segments.filter((segment) => segment.status !== "unchanged");
  return {
    segments,
    invalidated: invalidated.map((segment) => segment.id),
    removed: before.filter((segment) => !newHashes.has(segment.hash)).map((segment) => segment.id),
    global: Boolean(before[0] && after[0] && before[0].parts.global !== after[0].parts.global),
    frames: { total: after.reduce((sum, segment) => sum + segment.frames, 0), invalidated: invalidated.reduce((sum, segment) => sum + segment.frames, 0) }
  };
}

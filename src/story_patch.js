// Node-side entry for story patches (kit/core/story-patch.mjs): chat edits
// arrive as RFC 6902 JSON Patch, and diffSegments says which render segments
// an edit invalidates, from the same segment plan and hashes `finish` caches
// by. The pure diffSegments hashes the stories alone; this one can also hash
// a project's caption and asset files, as finish does. Contract:
// docs/KIT_CONTRACTS.md, "Story patches".
import { diffSegments as diffStorySegments } from "@launchclip/core/story-patch.mjs";
import { gatherSegmentInputs } from "./render_segments.js";

export { applyJsonPatch, applyStoryPatch, formatPointer, messagePointer, parsePointer } from "@launchclip/core/story-patch.mjs";

/**
 * diffSegments (kit/core/story-patch.mjs) for Node. options.project: also
 * hash captions and asset files from that project, as finish does (default:
 * the stories alone). options.renderer: "remotion" (default) or
 * "hyperframes". Same result shape as the pure one.
 */
export async function diffSegments(oldStory, newStory, { project = null, renderer = "remotion" } = {}) {
  return diffStorySegments(oldStory, newStory, { renderer, inputs: project ? (story) => gatherSegmentInputs(project, story, renderer) : null });
}

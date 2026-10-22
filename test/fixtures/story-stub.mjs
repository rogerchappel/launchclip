// Minimal stand-in for kit/core/story.mjs (docs/KIT_CONTRACTS.md), used only
// by tests until the real module lands. It implements just enough of
// resolveStory / deriveBoundaries / storyFormat for the renderer adapters and
// the cinematic gates.
export const STORY_SCHEMA = "launchclip.story.v1";

export function resolveAnchor(anchor, { words = [], beats = null } = {}) {
  if (typeof anchor === "number") return anchor;
  const text = String(anchor);
  const word = text.match(/^word:([^#]+)(?:#(\d+))?$/);
  if (word) {
    const matches = words.filter((entry) => String(entry.text).toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "") === word[1].toLowerCase());
    const hit = matches[Number(word[2] ?? 1) - 1];
    if (!hit) throw new Error(`unknown anchor ${text}`);
    return Number(hit.start);
  }
  const beat = text.match(/^beat:(\d+)$/);
  if (beat) {
    const value = beats?.beats?.[Number(beat[1])];
    if (value == null) throw new Error(`unknown anchor ${text}`);
    return Number(typeof value === "object" ? value.time ?? value.at : value);
  }
  const seconds = Number(text);
  if (Number.isFinite(seconds)) return seconds;
  throw new Error(`unknown anchor ${text}`);
}

export function resolveStory(story, { words = [], beats = null } = {}) {
  const copy = structuredClone(story);
  const context = { words, beats };
  copy.scenes = (copy.scenes ?? []).map((scene) => ({
    ...scene,
    start: resolveAnchor(scene.start, context),
    end: resolveAnchor(scene.end, context)
  })).sort((left, right) => left.start - right.start);
  const { duration, fps } = copy.format;
  copy.resolved = { duration, fps, frames: Math.round(duration * fps) };
  return copy;
}

export function deriveBoundaries(story) {
  const scenes = story.scenes ?? [];
  return scenes.flatMap((scene, index) => {
    if (!scene.in || index === 0) return [];
    const fromObject = scene.in.from_object ? String(scene.in.from_object).split(".")[0] : null;
    return [{
      boundary_id: `${scene.id}-in`,
      sequence_id: fromObject,
      kind: scene.in.type === "morph" || fromObject ? "shared-world" : "ordinary",
      start_seconds: scene.start,
      duration_seconds: Number(scene.in.dur),
      from_id: scenes[index - 1].id,
      to_id: scene.id
    }];
  });
}

export function storyFormat(story) {
  const { width, height, fps } = story.format;
  return { duration: Number(story.resolved?.duration ?? story.format.duration), width, height, fps: Number(story.resolved?.fps ?? fps) };
}

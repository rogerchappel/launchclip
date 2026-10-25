// The shared style step of every storyboard read: when storyboard.json sets
// "style", resolve the pack (src/style_store.js: project, home, built-in, or a
// path) and merge it (kit/core/style.mjs applyStyle) before validation and
// anchor resolution. story validate/resolve/compile, layout-check, finish, the
// renderer adapters, cinematic checks and the renderer eval all call this, so
// they see the same merged story.
import path from "node:path";
import { applyStyle, storyStyleRequest } from "../kit/core/style.mjs";
import { resolveStyleV2 } from "./style_store.js";

/**
 * story → {story: merged (or the input when it names no style), style: null |
 * {name, source, file, applied, warnings}}. projectDir resolves relative style
 * paths and the project style root. Throws when the named pack is missing or
 * invalid.
 */
export async function applyProjectStyle(story, { projectDir = process.cwd(), home, root } = {}) {
  const request = storyStyleRequest(story);
  if (!request) return { story, style: null };
  if (story?.meta?.style && Array.isArray(story.meta.style.applied)) {
    return { story, style: { name: story.meta.style.name, source: "merged", file: null, applied: story.meta.style.applied, warnings: [] } };
  }
  const loaded = await resolveStyleV2(request.name, { projectDir: path.resolve(projectDir), home, root });
  const merged = applyStyle(story, loaded.pack, { intro: request.intro, outro: request.outro });
  return {
    story: merged.story,
    style: { name: loaded.name, source: loaded.source, file: loaded.file, applied: merged.applied, warnings: [...loaded.warnings, ...merged.warnings], ...(Array.isArray(loaded.pack?.segments) ? { segments: loaded.pack.segments } : {}) }
  };
}

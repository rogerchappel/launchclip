import { hasExactFile } from "../story_loader.js";
import { createHyperframesRenderer, hyperframesRenderer } from "./hyperframes.js";
import { createRemotionRenderer, remotionRenderer } from "./remotion.js";

export const RENDERER_NAMES = ["hyperframes", "remotion"];

// getRenderer(name) returns the shared adapter; getRenderer(name, defaults)
// returns a fresh adapter with injected defaults ({run}, plus {entry,
// storyModule, layoutCheck} for remotion).
export function getRenderer(name, defaults) {
  const key = String(name ?? "").toLowerCase();
  if (key === "hyperframes") return defaults ? createHyperframesRenderer(defaults) : hyperframesRenderer;
  if (key === "remotion") return defaults ? createRemotionRenderer(defaults) : remotionRenderer;
  throw new Error(`Unknown renderer "${name}". Use one of: ${RENDERER_NAMES.join(", ")}`);
}

// Default renderer for a project: remotion when it holds story.json and no
// index.html, hyperframes otherwise.
export function detectRenderer(projectDir) {
  const hasStory = hasExactFile(projectDir, "story.json");
  const hasHtml = hasExactFile(projectDir, "index.html");
  return hasStory && !hasHtml ? "remotion" : "hyperframes";
}

export function resolveRendererName(projectDir, requested) {
  if (requested == null || requested === "" || requested === true) return detectRenderer(projectDir);
  const name = String(requested).toLowerCase();
  if (!RENDERER_NAMES.includes(name)) throw new Error(`Unknown renderer "${requested}". Use one of: ${RENDERER_NAMES.join(", ")}`);
  return name;
}

export { createHyperframesRenderer, createRemotionRenderer };

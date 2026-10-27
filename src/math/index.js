// Equation typesetting for project reads and finish: MathJax (1.6 MB) loads
// only when a story has an equation scene. See src/math/typeset.js.

/** Typeset a story's equation scenes in place; returns how many were typeset. */
export async function typesetProjectStory(story) {
  if (!Array.isArray(story?.scenes) || !story.scenes.some((scene) => scene?.module === "equation")) return 0;
  const { typesetStory } = await import("./typeset.js");
  return typesetStory(story);
}

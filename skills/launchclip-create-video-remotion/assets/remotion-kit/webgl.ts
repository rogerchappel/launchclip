// Modules that need WebGL (@remotion/three, three.js) to draw, so an app can
// gate them where WebGL is missing (some headless renderers, low-end players).
// The portable-module rule (docs/DUAL_RENDERER_PLAN.md) keeps every kit
// module on DOM, SVG and CSS 3D transforms, so the list is empty today; the
// 3D catalogue (catalog-i-3d-*) uses CSS 3D. test/remotion_package.test.js
// fails when a kit file imports three.js or @remotion/three without listing
// its modules here.
export const WEBGL_MODULES: readonly string[] = Object.freeze([]);

export function moduleNeedsWebGL(id: string): boolean {
  return WEBGL_MODULES.includes(id);
}

/** Module ids of a story's scenes that need WebGL (empty when none do). */
export function storyWebGLModules(story: { scenes?: Array<{ module?: string }> }): string[] {
  return [...new Set((story.scenes ?? []).map((scene) => String(scene.module ?? "")).filter(moduleNeedsWebGL))];
}

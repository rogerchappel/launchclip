// Custom modules (`"module": "custom"`, bespoke tier): which renderer a scene
// has a form for. Plain ESM with no imports. Contract: docs/KIT_CONTRACTS.md,
// "Custom modules".
//
// scene.source is a project-relative path (the Remotion component's file, the
// original form) or {remotion?, hyperframes?} with one path per renderer. The
// Remotion form is a React component registered in the project's Remotion
// entry; the HyperFrames form is an HTML fragment (kit/hyperframes/custom-module.mjs).

export const CUSTOM_RENDERERS = Object.freeze(['remotion', 'hyperframes']);

/** scene.source → {remotion: path | null, hyperframes: path | null}. */
export function customSources(source) {
  if (typeof source === 'string') return { remotion: source, hyperframes: null };
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    return { remotion: typeof source.remotion === 'string' ? source.remotion : null, hyperframes: typeof source.hyperframes === 'string' ? source.hyperframes : null };
  }
  return { remotion: null, hyperframes: null };
}

/** The scene's source file for `renderer`, or null when it has no form for it. */
export function customSource(scene, renderer) {
  return scene?.module === 'custom' ? customSources(scene.source)[renderer] ?? null : null;
}

/** Why a custom scene cannot render in `renderer`, as one sentence naming the scene, the module and the renderer. */
export function customGapMessage(scene, renderer) {
  const name = scene?.params?.component ? `custom module "${scene.params.component}"` : 'custom module';
  const other = CUSTOM_RENDERERS.find((entry) => entry !== renderer && customSource(scene, entry));
  const form = renderer === 'hyperframes' ? 'an HTML fragment at source.hyperframes' : 'a React component at source.remotion';
  return `scene "${scene?.id}": the ${name} has no ${renderer} form${other ? ` (only a ${other} one, ${customSource(scene, other)})` : ''}; add ${form}, render with ${other ? `--renderer ${other}` : 'the renderer it was written for'}, or use a catalogue module`;
}

/** Custom scenes with no form for `renderer`: [{id, module: "custom", component, reason}]. */
export function customModuleGaps(story, renderer) {
  const gaps = [];
  for (const scene of Array.isArray(story?.scenes) ? story.scenes : []) {
    if (scene?.module !== 'custom' || customSource(scene, renderer)) continue;
    gaps.push({ id: scene.id, module: 'custom', component: scene.params?.component ?? null, reason: customGapMessage(scene, renderer) });
  }
  return gaps;
}

// @launchclip/core: the public entry of LaunchClip's storyboard engine, for
// tools that embed it (editors that build settings panels from module schemas
// and apply chat edits as story patches). Every other file in this folder is
// importable too, as @launchclip/core/<file>.mjs (captions, transitions,
// camera, ...). Contract: docs/KIT_CONTRACTS.md; package notes: README.md.
//
// Pure ESM with no Node built-ins: it runs in browsers and Node
// alike (test/core_package.test.js checks a browser-like sandbox and Node).

export {
  STORY_SCHEMA,
  STORY_REVISION,
  STORY_LANES,
  STORY_TRANSITIONS,
  validateStory,
  resolveStory,
  resolveAnchor,
  deriveBoundaries,
  storyFormat,
  storyBase
} from './story.mjs';
export { catalogModules, knownModules, moduleVariants, moduleTiming, resolveModule } from './modules.mjs';
export {
  JSON_SCHEMA_DIALECT,
  EDITOR_CONTROLS,
  EDITOR_GROUPS,
  moduleSchemaId,
  moduleSchema,
  listModuleSchemas,
  validateAgainstSchema,
  validateModuleParams
} from './module-schemas.mjs';
export { STORY_MIGRATIONS, storyVersion, migrationProblems, migrateStory, stampStory } from './story-migrations.mjs';
export { applyJsonPatch, applyStoryPatch, diffSegments, parsePointer, formatPointer, messagePointer } from './story-patch.mjs';
export { SEGMENT_SCHEMA, planSegments, hashSegments } from './render-segments.mjs';
export { chunkWords, captionChunksFrom, narrationWords, visibleChunks, captionPlan, CAPTION_PRESETS, CAPTION_PRESET_NAMES } from './captions.mjs';
export { TRANSITION_TYPES, sceneWindows, layerStateAt, layerStyle } from './transitions.mjs';
export { resolveCamera, cameraPlan, cameraStateAt } from './camera-world.mjs';
export { SAFE_ZONE_PROFILES, checkLayout, elementsFromStory } from './layout-check.mjs';
export { CADENCE_TARGETS, storyboardMeasures, cadenceTarget, cadenceGate, cadenceReport } from './cadence.mjs';
export { CADENCE_PROFILE_SCHEMA, validateProfile, selectProfile, compareMeasures } from './profiles.mjs';

# @launchclip/core

The storyboard engine behind [LaunchClip](https://github.com/rogerchappel/launchclip),
packaged for tools that embed it: editors that build settings panels from
module schemas, apply chat edits as story patches, and check a storyboard
before anything renders.

- Pure ESM, no dependencies, no Node built-ins. It runs in browsers, workers,
  Remotion bundles and Node 22+.
- `sideEffects: false`, so bundlers drop what you don't import.
- TypeScript declarations ship in `types/` (generated from the sources).
- MIT licensed.

```sh
npm install --save-exact @launchclip/core
```

## The story contract

A storyboard is a `launchclip.story.v1` JSON document: format, brand, audio
and an ordered list of scenes, each naming one of ~130 typed modules with its
params. The full contract is in
[docs/KIT_CONTRACTS.md](https://github.com/rogerchappel/launchclip/blob/main/docs/KIT_CONTRACTS.md).

```js
import {
  validateStory, resolveStory, knownModules, validateModuleParams,
  listModuleSchemas, moduleSchema, migrateStory, applyStoryPatch
} from '@launchclip/core';

// Bring an older story up to this engine's revision, then check it.
const { story } = migrateStory(input);
const { ok, errors, warnings } = validateStory(story, { modules: knownModules(), moduleParams: validateModuleParams });

// Time anchors ("word:launch", "beat:3") resolved against narration words.
const resolved = resolveStory(story, { words });

// One JSON Schema (2020-12) per module, with editor hints for settings panels.
for (const { id, schema } of listModuleSchemas()) renderPanel(id, schema);
moduleSchema('hook-title'); // → schema | null

// A chat edit is an RFC 6902 JSON Patch, checked like a planned storyboard:
// migrate, validate, resolve, module params, layout.
const result = applyStoryPatch(story, [
  { op: 'replace', path: '/scenes/0/params/headline', value: 'Ship in minutes.' }
], { words });
if (!result.ok) showErrors(result.errors); // each error carries a JSON Pointer
```

## Public API

The package root (`@launchclip/core`) exports:

| Area | Exports |
| --- | --- |
| Story | `STORY_SCHEMA`, `STORY_REVISION`, `STORY_LANES`, `STORY_TRANSITIONS`, `validateStory`, `resolveStory`, `resolveAnchor`, `deriveBoundaries`, `storyFormat`, `storyBase` |
| Modules | `catalogModules`, `knownModules`, `moduleVariants`, `moduleTiming`, `resolveModule` |
| Module schemas | `JSON_SCHEMA_DIALECT`, `EDITOR_CONTROLS`, `EDITOR_GROUPS`, `moduleSchemaId`, `moduleSchema`, `listModuleSchemas`, `validateAgainstSchema`, `validateModuleParams` |
| Migrations | `STORY_MIGRATIONS`, `storyVersion`, `migrationProblems`, `migrateStory`, `stampStory` |
| Patches | `applyJsonPatch`, `applyStoryPatch`, `parsePointer`, `formatPointer`, `messagePointer` |
| Captions | `chunkWords`, `captionChunksFrom`, `narrationWords`, `visibleChunks`, `captionPlan`, `CAPTION_PRESETS`, `CAPTION_PRESET_NAMES` |
| Transitions | `TRANSITION_TYPES`, `sceneWindows`, `layerStateAt`, `layerStyle` |
| Camera | `resolveCamera`, `cameraPlan`, `cameraStateAt` |
| Layout check | `SAFE_ZONE_PROFILES`, `checkLayout`, `elementsFromStory` |
| Cadence | `CADENCE_TARGETS`, `storyboardMeasures`, `cadenceTarget`, `cadenceGate`, `cadenceReport` |
| Profiles | `CADENCE_PROFILE_SCHEMA`, `validateProfile`, `selectProfile`, `compareMeasures` |

Every source file is also importable on its own, with its full export list:

```js
import { captionPlanCss } from '@launchclip/core/captions.mjs';
import { zoomStateAt } from '@launchclip/core/zooms.mjs';
```

These deep imports are part of the package but less curated than the root: a
name can move between files in a minor release (the changelog says so). Prefer
the root export when there is one.

## Versions

`@launchclip/core` is released in lockstep with the `launchclip` CLI: the
same version number, from the same commit, so `@launchclip/core@0.2.0` is
exactly the engine inside `launchclip@0.2.0`. While the version is `0.x`, a
minor bump may break the API; pin an exact version (`--save-exact`). Stories
are versioned separately (`schema` plus `engine.revision`), and
`migrateStory` upgrades older ones. The full policy is in
[docs/KIT_CONTRACTS.md](https://github.com/rogerchappel/launchclip/blob/main/docs/KIT_CONTRACTS.md#the-launchclipcore-package).

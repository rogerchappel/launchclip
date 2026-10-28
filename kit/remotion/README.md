# @launchclip/remotion

The Remotion kit behind [LaunchClip](https://github.com/rogerchappel/launchclip),
packaged for apps that render LaunchClip stories in their own Remotion bundle
or `@remotion/player`: `StoryComposition`, every module component and its
registry, word captions, the brand frame and the bundled fonts.

- Renders a resolved `launchclip.story.v1` story from its props alone. It
  reads no LaunchClip CLI state (`.launchclip/`, `~/.launchclip`, project
  layout); media comes from your asset resolver or your public dir.
- Compiled ESM plus TypeScript declarations. React and Remotion are peer
  dependencies; `@launchclip/core` and the `@fontsource` packages are
  dependencies, so your bundler resolves one copy of each.
- MIT licensed.

```sh
npm install --save-exact @launchclip/remotion @launchclip/core
npm install remotion@^4.0.536 react@^19.3.0 react-dom@^19.3.0
```

`@launchclip/remotion` and `@launchclip/core` are released together at the
same version; pin both exactly (docs/KIT_CONTRACTS.md, "Versioning").

## In your Remotion bundle

```jsx
// src/index.jsx, your Remotion entry
import { registerRoot } from 'remotion';
import { LaunchclipCompositions } from '@launchclip/remotion';
import '@launchclip/remotion/fonts'; // every registry font, through your bundler
import { BrandBadge } from './BrandBadge';

registerRoot(() => <LaunchclipCompositions customModules={{ BrandBadge }} />);
```

That registers three compositions; size, fps and duration come from the
props (`calculateMetadata`):

| Composition | Props |
| --- | --- |
| `LaunchclipStory` | the resolved story (`resolveStory` from `@launchclip/core`) |
| `ModuleReview` | `{scene, story}`: one scene's module on `brand.colors.bg` |
| `SceneOverlay` | `{story, sceneId, loop?, plate?, part?}`: one scene on a transparent background |

To register them beside your own compositions, render
`<LaunchclipCompositions />` inside your root's fragment, or register
`StoryComposition` yourself with `calculateMetadata={calculateStoryMetadata}`.

```js
import { resolveStory, migrateStory, validateStory, knownModules, validateModuleParams } from '@launchclip/core';

const { story } = migrateStory(input);
const { ok, errors } = validateStory(story, { modules: knownModules(), moduleParams: validateModuleParams });
const inputProps = resolveStory(story, { words }); // words: [{text, start, end}] of the narration
// renderMedia({ serveUrl, composition, inputProps, ... }) with id "LaunchclipStory"
```

## In @remotion/player

The Player runs no `calculateMetadata`, so `storyPlayerProps` does it (size,
fps, duration, captions) and returns the Player's props:

```jsx
import { Player } from '@remotion/player';
import { storyPlayerProps } from '@launchclip/remotion';

const props = await storyPlayerProps(resolvedStory, { customModules: { BrandBadge } });
<Player {...props} controls style={{ width: '100%' }} />;
```

## Media: `setAssetResolver`

A story names its media as project-relative paths (`assets/clip.mp4`,
`audio.mix`, `audio.words`, captions, images in modules, SVG layers). Every
one goes through the asset resolver, which you install once, before
rendering, in the same bundle:

```js
import { setAssetResolver } from '@launchclip/remotion';

setAssetResolver((src) => src.startsWith('assets/') ? `https://media.example.com/${projectId}/${src}` : null);
```

Return `null` (or `undefined`) for the default: absolute URLs (`https:`,
`data:`, `blob:`, `//…`) pass through, anything else is `staticFile(src)`
from your Remotion public dir. Without a resolver, a public dir that holds the
story's files renders it as is.

## Fonts

The kit draws text in ~26 open-licence families (OFL-1.1) from pinned
`@fontsource` packages, loaded through the FontFace API inside
`delayRender`, so no frame is captured with a fallback face. Nothing is
fetched from Google Fonts.

- `import '@launchclip/remotion/fonts'` imports every woff2 and registers its
  URL. Use it where your bundler turns a `.woff2` import into a URL
  (Remotion's webpack does; so do Vite and webpack 5 asset modules).
- Elsewhere, register your own URLs: `registerFontFiles({[face.file]: url})`
  for each of `FONT_FACES` (`{family, package, file, module, weight, style,
  format}`; `module` is the import path, e.g.
  `@fontsource/anton/files/anton-latin-400-normal.woff2`). Preload those URLs
  as you like.
- Only the families a story uses (its `brand.fonts`, the role defaults and the
  symbol fallback) load. A family with no registered URL falls back to its
  role's stack, with one console warning.

## WebGL

`WEBGL_MODULES`, `moduleNeedsWebGL(id)` and `storyWebGLModules(story)` say
which modules need WebGL (`@remotion/three`), so you can gate them. Every
module is DOM, SVG or CSS 3D today (the portable-module rule), so the list is
empty and the package does not depend on three.js; a module that ever needs
WebGL is listed there first.

## Exports

| Area | Exports |
| --- | --- |
| Compositions | `LaunchclipCompositions`, `DEFAULT_STORY`, `StoryComposition`, `calculateStoryMetadata`, `loadStoryCaptions`, `ModuleReview`, `calculateModuleReviewMetadata`, `SceneOverlay`, `calculateSceneOverlayMetadata`, `sceneOverlayWindow`, `resolveSceneElement` |
| Player | `storyPlayerProps` |
| Modules | `MODULE_COMPONENTS` (module id → component), `moduleComponent(id)`, and the registries it merges: `EDITORIAL_COMPONENTS_A`/`_B`, `CATALOG_COMPONENTS_A`…`_H`, `CHARACTER_COMPONENTS`, `WORLD_COMPONENTS` |
| Pieces | `WordCaptions`, `BrandFrame`, `SceneStartFrame`, `sceneSeconds`, `useSceneTime` |
| Media | `setAssetResolver`, `assetUrl` |
| Fonts | `FONT_FACES`, `registerFontFiles`, `ensureFonts`; `@launchclip/remotion/fonts` exports `FONT_FILES` |
| WebGL | `WEBGL_MODULES`, `moduleNeedsWebGL`, `storyWebGLModules` |
| Types | `StoryProps`, `CustomModuleProps`, `ModuleReviewProps`, `SceneOverlayProps`, `StoryPlayerProps`, `AssetResolver`, `ModuleComponent`, `FontStacks`, `CaptionChunk`, `CaptionWord`, `WordCaptionsProps` |

A custom module is a scene with `module: "custom"` whose component (from
`customModules`) receives `{scene, params, brand, format, model}`.

## Building from the repository

The package is `kit/remotion/` in the LaunchClip repository (an npm
workspace). `npm pack` runs `scripts/build.mjs` (esbuild for `dist/*.js`, tsc
for `dist/types/`) and removes `dist/` afterwards. The LaunchClip CLI renders
the same TSX through `kit/remotion/entry.tsx`.

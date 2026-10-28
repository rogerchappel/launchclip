# @launchclip/engine

The Node engine behind [LaunchClip](https://github.com/rogerchappel/launchclip),
packaged for apps that embed it. It covers the storyboard planner, finish
(voice, music, SFX, mix, master), the gates and the vision critic, the segment
renderer, NLE export, and the footage-led lane (recording edit and subject
layer). The app supplies its own models, voices, music, transcription, matting
and media through adapters.

- **Adapters.** Every model and provider call goes through an adapter. Any
  adapter you leave out uses LaunchClip's own implementation.
- **Your folders.** State lives in the folders you pass: a working directory
  for projects and a cache/state folder for everything else. Nothing is
  written to `~/.launchclip` or `~/.cache/launchclip`, and `process.env` is
  never read for keys or changed.
- **Asset-provider hook.** The planner can ask your app for "a shot that shows
  X for this line" and gets back library media or a generated asset.
- **Licence.** MIT.

```sh
npm install --save-exact @launchclip/engine @launchclip/core
```

The engine renders with Remotion (`remotion`, `@remotion/renderer`,
`@remotion/bundler`, `@remotion/cli` ^4.0.536 and React ^19.3 are peer
dependencies) or HyperFrames (a dependency). FFmpeg and ffprobe must be on
`PATH`. Optional dependencies (`kokoro-js`, `onnxruntime-node`, `playwright`)
back the default local voice, the default matting and demo recording. Leave
them out when your adapters replace those.

`@launchclip/engine`, `@launchclip/core` and `@launchclip/remotion` are
released together at the same version, so pin all of them exactly.

## Quick start

```js
import { createEngine } from '@launchclip/engine';

const engine = createEngine({
  workDir: '/srv/videos',          // every project path resolves inside it
  cacheDir: '/srv/launchclip-cache', // voice/music/model caches; state in <cacheDir>/state
  adapters: { llm, tts, music, transcribe, matting, assets },
  env: {}                           // keys the *default* providers may read; default none
});

const plan = await engine.planStoryboard({
  brief: 'A 30 s launch short for our invoicing app',
  words,                            // narration word times [{text, start, end}], if known
  lane: 'voiceover-motion',
  format: { width: 1080, height: 1920, fps: 30, duration: 30 },
  project: 'launch-001'             // shots the app supplies are copied here
});
// write plan.storyboard to /srv/videos/launch-001/storyboard.json, then:
const report = await engine.finish('launch-001', { renderer: 'remotion', quality: 'high' });
```

## API

`createEngine(options)` returns:

| Member | Does |
| --- | --- |
| `planStoryboard(options)` | Plans a storyboard (`src/storyboard_planner.js`). It sends structured LLM calls through `llm` and fixes a failed plan with repair passes. Shots come from `assets` when you pass it. The report has `status`, `storyboard`, `errors`, `attempts`, `usage`, `cost` and `shots`. |
| `finish(project, options, overrides?)` | Runs `storyboard.json` through voice, captions, sound, render, master, evidence and gates (`src/finish.js runFinish`). Options: `renderer`, `quality`, `voice`, `music`, `scenes`, `chapter`, `previewScene`, `force` and the rest of the `launchclip finish` flags. Returns the `finish.json` report. |
| `renderSegments(options)` | Renders by segments (`src/render_segments.js renderWithSegments`). Only changed segments re-render. |
| `exportNle(project, options?)` | Exports FCPXML, xmeml, OTIO or EDL with overlay plates (`src/nle/export.js runExport`). |
| `critique(project, options?)` | Runs the headless vision critic on a finished project (`src/make/critic.js`). It needs a vision `llm`. |
| `prepareRecording(input, options)` | The footage-led lane (`src/recording_workflow.js`): it transcribes, finds retakes and pauses, and cleans up the audio. |
| `subject.probe(src)`, `subject.track(src)`, `subject.matte(src, range)` | The subject layer (`src/subject/stage.js`), using `matting`. |
| `project(name)` | The absolute project path inside `workDir`. It throws when a path escapes `workDir`. |
| `workDir`, `cacheDir`, `stateDir`, `adapters` | The resolved configuration. |

These pure exports need no engine: `planRecordingEdit`, `normalizeRecordingTranscript`,
`checkStoryboard`, the gates (`coverageGate`, `directionGate`, `faceGate`,
`gateProfile`, `qualityFindings`, `prototypeCut`, `prototypeScope`,
`readProjectDirection`), `FINISH_STAGES`, `formatFinishSummary`, `withStateDirs`,
`engineAdapters`, `defaultEngineAdapters` and `ADAPTER_KEYS`.

## Adapters

Every key is optional. A key you leave out uses the implementation the
LaunchClip CLI uses. The defaults read API keys and model routes only from the
engine's `env` option, never from `process.env`.

### `llm`: structured calls, with vision

The value is either a client or a function `({vision}) → client`. The engine
asks for `vision: true` before it sends images (the critic). A client with
`vision: false` then fails clearly instead of dropping the images.

```ts
interface LlmClient {
  vision?: boolean;
  runStructured(request: {
    instructions: string;            // system prompt
    input: string;                   // user content
    schema: object;                  // JSON Schema (strict)
    schemaName: string;              // e.g. "launchclip_storyboard"
    model?: string;
    images?: string[];               // data: URLs or URLs (vision calls)
    temperature?: number;
    maxOutputTokens?: number;
    reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    onSubmitted?(meta: { id: string; status: string; model: string }): void | Promise<void>;
  }): Promise<{
    value?: unknown;                 // the parsed JSON object (or `text` to be parsed)
    text?: string;
    usage?: { input_tokens: number; output_tokens: number; total_tokens?: number };
    model?: string;
    response_id?: string;
    status?: string;
  }>;
  resumeStructured?(responseId: string, request: object): Promise<object>; // optional, for background calls
}
```

Default: `env.LAUNCHCLIP_PLANNER_MODEL` (`provider:model`, for anthropic,
openai, openrouter, ollama or compatible) with that provider's key from `env`.
Without an adapter and without that variable, planning fails with a clear
error.

### `tts`: narration

The value is a provider, or a function `(name, options) → provider` that picks
by the story's `audio.narration.provider`. A provider object answers every
name except `supplied` (the presenter's own recording, which is prepared
locally and transcribed with `transcribe`).

```ts
interface VoiceProvider {
  name: string;
  synthesize(request: { text: string; voice?: string; speed?: number; outFile: string; signal?: AbortSignal }):
    Promise<{ file?: string; duration?: number; words?: { text: string; start: number; end: number }[] }>;
}
```

The provider writes audio to `outFile`. When it returns no `words`, finish
aligns the words itself. Default: `kokoro` (local, `kokoro-js`) or `elevenlabs`
(`env.ELEVENLABS_API_KEY`).

### `music`: generated music beds

The value is a provider, used wherever LaunchClip would call ElevenLabs Music.
The procedural synth bed and supplied files stay local.

```ts
interface MusicProvider {
  name: string;
  paid: boolean;
  request(story: object, params: object): object;                        // the request it would send (recorded in the music lock)
  cacheStatus(story: object, params: object): Promise<{ cached: boolean }>;
  generate(story: object, params: object, options: { outFile: string; force?: boolean }):
    Promise<{ file: string; cached: boolean }>;
}
```

### `transcribe`: speech to word times

```ts
type Transcribe = (file: string, options: { model?: string; language?: string; signal?: AbortSignal }) =>
  Promise<{ segments: { words: { word: string; start: number; end: number }[] }[] }   // Whisper JSON
        | { words: { text: string; start: number; end: number }[] }>;
```

It is used by the footage-led lane (`prepareRecording`) and by supplied
narration. Default: the local `whisper` CLI.

### `matting`: the subject layer

```ts
type Matting = (modelId: string, options: object) => Promise<{
  segment(rgb24: Uint8Array, width: number, height: number): Promise<Uint8Array>; // 0–255 alpha, same size
  release(): Promise<void>;
}>;
```

Default: the bundled ONNX models (`onnxruntime-node`), downloaded into
`<stateDir>/models`.

### `assets`: the asset-provider hook

With an `assets` provider, the planner tells the model it may ask for a shot
in a `photo-scene` or `media-window` scene instead of naming a file:

```json
{ "module": "photo-scene", "params": { "media": { "kind": "shot", "shows": "a barista pouring latte art, close up", "type": "image" } } }
```

Before the storyboard is checked, each request goes to `findShot`, along with
the line it sits under:

```ts
interface AssetProvider {
  findShot(request: {
    id: string;                      // stable per (shows, type, format): use it as a cache key
    scene_id: string; module: string;
    shows: string;                   // what the shot must show
    type: 'image' | 'video' | 'any';
    line: string | null;             // the narration under the scene
    start: number | null; end: number | null; duration: number | null;
    format: { width: number; height: number; aspect: 'portrait' | 'landscape' | 'square' };
    brief: string;
  }, options: { signal?: AbortSignal }): Promise<null | {
    kind?: 'image' | 'video';
    src?: string;                    // already in the project: "assets/…"
    file?: string;                   // absolute path; copied to <project>/assets/shots/<id>.<ext>
    url?: string;                    // you serve it; the story names assets/shots/<id>.<ext>
    sourceStart?: number;            // seconds into a video
    source?: object;                 // e.g. {provider, id, license, generated, prompt}: echoed in plan.shots
  }>;
}
```

The shot is written into the story as an `assets/` path, so the story contract
and both renderers are unchanged. For a `url`, map that path back to your URL
when rendering (in `@launchclip/remotion`, `setAssetResolver`). When
`findShot` returns `null`, the planner gets a repair note and designs that
scene as motion graphics. `plan.shots` lists what was used.

### `renderer` and `notice`

`renderer: (name) → renderer adapter` replaces the bundled HyperFrames and
Remotion adapters (`src/renderers`). `notice: (line) → void` receives progress
lines (default: stderr).

## State and folders

- **Projects.** Projects live under `workDir`. Each keeps its own working
  state in `<project>/.launchclip/` (finish state, segment cache, voice cache,
  music lock), like the CLI.
- **Engine calls.** Every engine call runs inside
  `withStateDirs({home: stateDir, cache: cacheDir})`. Under it, the folders the
  CLI keeps in `~/.launchclip` (queue, styles, skeletons, SFX library, matting
  models, brand assets, model-selection state) and in `~/.cache/launchclip`
  (Kokoro, voice, music, isolation) resolve into your folders. The scope is
  per async call, so concurrent engines with different folders stay apart.
- **Temporary files.** Inside an engine call, `TMPDIR` is left alone.
  Temporary files go to your process's temp folder.

## How the package is built

The engine's code is `src/` in the LaunchClip repository, and the CLI runs the
same files. `npm pack` (prepack: `scripts/stage.mjs`) copies two things into
the package, laid out as in the repository:

- every `src/` file reachable from `src/engine/index.js`;
- the kit files it reads: `kit/remotion`, `kit/hyperframes`, `kit/styles`,
  `kit/profiles` and `public/`.

The stage fails when the code imports a package this `package.json` does not
declare. `@launchclip/core` is a dependency, never a copy.

To build the tarballs from a pinned commit before the packages are on npm:

```sh
git clone https://github.com/rogerchappel/launchclip && cd launchclip && git checkout <sha>
npm ci
npm pack --workspace @launchclip/core --workspace @launchclip/remotion --workspace @launchclip/engine
```

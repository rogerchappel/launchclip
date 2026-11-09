# Contributing

Thanks for improving `launchclip`.

## Local Setup

```bash
nvm use 22
npm ci
node ./bin/launchclip.js doctor
npm run release:check
```

## Tests

`npm test` is the fast default run (about a minute). It skips the media
tests: real Remotion and HyperFrames renders, long FFmpeg chains, Playwright
recordings and real Kokoro synthesis. Run those when you change rendering,
recording, audio or anything they exercise:

```bash
npm run test:media                                # only the files with media tests
npm run test:media -- --test-name-pattern=remotion
LAUNCHCLIP_MEDIA_TESTS=1 node --test test/finish.test.js
npm run test:all                                  # everything, media tests included
```

Media tests need FFmpeg on `PATH`; the recorder tests also need Playwright's
Chromium or a system Chrome. Without them the tests skip and say why. CI runs
`npm run test:all` with FFmpeg on two ubuntu shards (the "Full suite with
media" jobs), so every test runs on each PR.

To make a new test a media test, import the helper and pass its skip value,
folding in any availability check of the test's own:

```js
import { mediaSkip } from "./helpers/media.js";

test("renders a real still", { skip: mediaSkip(!hasFfmpeg && "ffmpeg is not installed") }, async () => {});
```

Mark a test as a media test when it takes more than a few seconds because it
renders, encodes or drives a browser. The full renderer parity corpus is
separate again: `LAUNCHCLIP_PARITY=1 node --test test/parity.test.js`.

### Add a parity fixture

Every module needs at least one parity fixture: a small story that both
renderers draw, compared frame by frame. `npm test` fails
(`test/module_coverage.test.js`) when a module in `knownModules()` has no
HyperFrames emitter, no Remotion component or no fixture.

1. Write `test/fixtures/parity/<catalogue>-<module>[-<variant>].json` as
   `{"story": {...}, "sceneId": "<scene id>"}`: a complete `launchclip.story.v1`
   story with one scene for the module. Copy a neighbour and change the
   params. Keep it short (3 to 6 seconds) and add a fixture per variant or
   format only when it draws something the others do not.
2. Media goes in `test/fixtures/parity/assets/` and must be redistributable:
   generate it (FFmpeg test sources, drawn SVG) rather than using real
   footage, and keep it small. A module that sits over a recording belongs in
   `test/fixtures/parity-footage/` instead, as `{"project", "sceneId"}`
   pointing at an example story under `examples/story/`.
3. Run it and look at the side-by-side stills it writes:

   ```bash
   node scripts/parity.mjs test/fixtures/parity/<name>.json --out qa/parity/<name>
   node scripts/parity-footage.mjs test/fixtures/parity-footage/<name>.json
   ```

4. If a sample falls under the 0.97 SSIM threshold, fix the renderer that is
   wrong. Lower a fixture's `threshold` only when the stills differ
   invisibly, and say why in its `threshold_note`.
5. Take the module off `FIXTURE_ALLOWLIST` in `scripts/parity-coverage.mjs`.
   `node scripts/parity-coverage.mjs` prints what is still uncovered.

## Pull Requests

- Keep changes small and focused.
- Add or update tests when packet planning, rendering, or CLI behavior changes.
- Run `npm run release:check` before opening a PR.
- Run `npm audit --omit=dev` when dependencies change.
- Edit the create-video skills in `skills-src/`, then run `npm run skills:sync`.
  `skills/launchclip-create-video/{SKILL.md,references,agents}` and all of
  `skills/launchclip-create-video-remotion/` are generated; `npm run
  skills:check` fails when they drift. The renderer-neutral scripts live in
  `skills/launchclip-create-video/scripts/` and `kit/core/` is canonical for
  its copies.
- `npm run package:smoke` must install and execute the generated tarball, not
  merely list its contents.

See [`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md) for the npm release, source,
agent-skill, and Homebrew tap flow.

## Safety Expectations

Do not commit real API keys, private campaign assets, customer data, or generated media that cannot be redistributed.

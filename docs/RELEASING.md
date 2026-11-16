# Releasing to npm

LaunchClip publishes four packages, in this order (each depends only on the ones before it):

| Package | Folder | What it is |
|---|---|---|
| `@launchclip/core` | `kit/core` | The story schema, modules, styles and checks (pure ESM, no dependencies) |
| `@launchclip/remotion` | `kit/remotion` | The Remotion composition (`LaunchclipStory`), for apps that render or play stories |
| `@launchclip/engine` | `packages/engine` | The make/finish engine with injected adapters |
| `launchclip` | `.` | The CLI |

The packages pin each other exactly, so release them at the same version.

## Release (from GitHub)

1. Bump `version` in the four `package.json` files, and in the pinned sibling versions, to the same number. Add a `CHANGELOG.md` entry. Merge to `main`.
2. Actions → **Release** → **Run workflow** on `main`, listing the packages to publish (for example `core remotion`).
3. The workflow runs the tests, packs each package and scans the tarball, then publishes with an npm provenance statement. A version that's already on npm is skipped, so a failed run can simply be run again.
4. Tag the commit that was published, not whatever `main` has become. Take the commit from the workflow run, then publish the GitHub release on it: `gh release edit v<version> --target <commit> --draft=false`.

The scan (`scripts/release-check.mjs pack`) refuses a tarball that contains any of these:

- a credential-shaped string,
- a key, `.env` or `.npmrc` file,
- an install script,
- a sibling version mismatch,
- any term in the `RELEASE_FORBIDDEN_TERMS` repository variable (comma separated). That keeps names that must never ship out of the repo itself.

You can run it locally with `node scripts/release-check.mjs pack`.

## One-time setup

1. **npm:** an account with two-factor authentication on, an npm organisation named `launchclip` (for the `@launchclip/` scope), and the unscoped `launchclip` name.
2. **GitHub:** an environment named `npm` (Settings → Environments). Add yourself as a required reviewer so every publish waits for your approval.
3. **First publish:** trusted publishing can only be set up for a package that already exists. So the first run uses a token:
   - Create a granular access token on npmjs.com with **Read and write** on the four packages (or the `launchclip` organisation), and an expiry of 7 days or less.
   - Save it as the `NPM_TOKEN` secret in the `npm` environment.
   - Run the workflow.
4. **Switch to trusted publishing:**
   - For each package on npmjs.com, open Settings → Trusted publisher → GitHub Actions. Enter repository `rogerchappel/launchclip`, workflow `release.yml` and environment `npm`.
   - Delete the `NPM_TOKEN` secret and revoke the token. From then on, each run authenticates with a short-lived OIDC token and no stored secret.
5. Set the `RELEASE_FORBIDDEN_TERMS` repository variable.

## Known advisories

`npm audit --omit=dev` is clean for `@launchclip/core` and `@launchclip/remotion`.

`@launchclip/engine` and `launchclip` inherit one advisory from a dependency:

| Advisory | Comes from | Fix |
|---|---|---|
| `sharp` | `kokoro-js` → `@huggingface/transformers` | Not yet released upstream |

Checked on 2026-11-16 for 0.3.0 with `npm audit --omit=dev`, on `hyperframes` 0.7.111 and `onnxruntime-node` 1.31.1.

Run the media tests (`npm run test:media`) whenever these dependencies move. The move to `hyperframes` 0.7.111 showed three things only those tests and a measurement on Linux found:

- It copies a mono sound to both sides at full level, so the HyperFrames compiler declares a mono source 3 dB down to match Remotion.
- Its audio is less exact in the first 21 ms, and on FFmpeg 8.0.1 (Linux) it also differs from the source for about 50 ms at 1.2 s of `examples/story/minimal`. HyperFrames 0.7.58 on the same machine does neither, and Remotion's audio is the same on both systems. The cause inside HyperFrames is not known. The `minimal` story's audio residual limit is -26 dB for it (`eval/renderer-thresholds.json`); bring it back to -30 when a later HyperFrames no longer needs it.
- The older HyperFrames lane (`src/hyperframes_assembler.js`) is not compensated, so a mono sound there is 3 dB louder than on 0.7.58.

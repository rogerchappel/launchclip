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

`@launchclip/engine` and `launchclip` inherit advisories from their dependencies:

| Advisory | Comes from | Fix |
|---|---|---|
| `adm-zip` | `hyperframes` 0.7 and `onnxruntime-node` 1.27 | `hyperframes` 0.8 and `onnxruntime-node` 1.31 |
| `@hono/node-server` | `hyperframes` | `hyperframes` 0.8 |
| `sharp` | `kokoro-js` → `@huggingface/transformers` | Not yet released upstream |
| `zod` | Pinned by Remotion's studio packages, and the Anthropic SDK | Not yet released upstream |

Upgrade those dependencies, with the media tests (`npm run test:media`), before publishing the engine and CLI.

# Distribution

LaunchClip has four complementary distribution paths:

1. npm is the canonical CLI release.
2. A maintainer-owned Homebrew tap wraps the exact npm release tarball.
3. GitHub source releases support audited local builds.
4. The repository plugin and `skills/` directory support subscription-agent
   workflows that do not require a LaunchClip model API key.

The GitHub-only `v0.1.0` source preview was not published to npm. Version
`0.1.1` is the first npm release candidate and must be tagged from the exact
reviewed commit that is published.

## Release gates

Use Node.js 22 or newer and release only from a clean, reviewed commit:

```bash
npm ci
npm audit --omit=dev
npm run release:check
npm publish --dry-run
```

`release:check` runs the full test/smoke suite, packs the real npm artifact,
installs it into an empty consumer project, executes its bin link, and creates a
workspace. It also rejects a package that omits runtime assets or has a plugin
version that differs from `package.json`.

For every release:

1. Update `package.json`, `package-lock.json`, and
   `.codex-plugin/plugin.json` to the same semantic version.
2. Update `CHANGELOG.md`; keep its documentation commit separate from the
   three-file release-metadata commit.
3. Run the release gates above on the exact commit.
4. Tag that commit as `v<version>` and create a GitHub release.
5. Publish npm first. The first release requires an authorized maintainer:
   `npm publish --access public`.
6. After the package exists, configure npm trusted publishing for a dedicated
   GitHub Actions release workflow. Prefer OIDC and an approval-protected GitHub
   environment over a long-lived npm token. Trusted publishing currently needs
   npm 11.5.1+ and Node 22.14+ and automatically emits provenance for a public
   package from a public repository.
7. Generate the Homebrew formula from the published npm tarball and its SHA-256,
   then test it in the tap before announcing the release.

Do not reuse or overwrite a version. If a bad version escapes, deprecate it on
npm, publish a corrected patch, and update the tap. Avoid unpublishing unless
npm policy and incident severity make it necessary.

## npm and source installs

Published users install globally:

```bash
npm install --global launchclip
launchclip doctor
```

Source users get the same dependency graph from the lockfile:

```bash
git clone https://github.com/rogerchappel/launchclip.git
cd launchclip
npm ci
npm run release:check
npm link
launchclip doctor
```

The npm package contains source, not a platform-specific binary. Runtime code
uses the exact HyperFrames and Remotion versions in the lockfile/package
metadata and writes generated media only under the user's LaunchClip workspace.

## Subscription-agent skills

`.codex-plugin/plugin.json` exposes `./skills/` for plugin-aware Codex installs.
npm transports that manifest but does not register it with Codex by itself.
For a source checkout, load the repository as a plugin or link the desired skill:

```bash
mkdir -p "$HOME/.agents/skills"
ln -s "$PWD/skills/launchclip-create-video" "$HOME/.agents/skills/launchclip-create-video"
```

`launchclip-create-video` keeps creative orchestration in the active
subscription agent and does not invoke LaunchClip's metered model stages.
Optional voice, music, image, or other paid providers still require explicit
user approval and their own credentials.

## Homebrew tap

Start with `rogerchappel/homebrew-tap`; do not make `homebrew/core` the first
distribution target. Homebrew prefers the npm-hosted tarball for Node packages,
provides `std_npm_args`, and expects Node modules under `libexec` with their bins
symlinked. Replace the version and checksum below after npm publication:

```ruby
class Launchclip < Formula
  desc "Create reviewable launch videos and OSS promotion packets"
  homepage "https://github.com/rogerchappel/launchclip"
  url "https://registry.npmjs.org/launchclip/-/launchclip-0.1.1.tgz"
  sha256 "REPLACE_WITH_PUBLISHED_TARBALL_SHA256"
  license "MIT"

  depends_on "ffmpeg"
  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    assert_match '"stage": "doctor"', shell_output("#{bin}/launchclip doctor")
  end
end
```

Release and verify it in this order:

```bash
npm view launchclip@0.1.1 dist.tarball dist.integrity
curl -L "https://registry.npmjs.org/launchclip/-/launchclip-0.1.1.tgz" -o launchclip-0.1.1.tgz
shasum -a 256 launchclip-0.1.1.tgz
brew audit --strict --online rogerchappel/tap/launchclip
brew install --build-from-source rogerchappel/tap/launchclip
brew test rogerchappel/tap/launchclip
launchclip doctor
```

A future `homebrew/core` submission needs a stable tagged release, clean builds
on Homebrew's supported macOS and Linux platforms, no outstanding security
vulnerabilities, and meaningful adoption. Homebrew's current notability bar for
self-submitted software is three times its normal threshold, so the project tap
is the realistic initial channel.

## Policy references

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [Homebrew's Node formula guidance](https://docs.brew.sh/Node-for-Formula-Authors)
- [Homebrew acceptable formulae](https://docs.brew.sh/Acceptable-Formulae)

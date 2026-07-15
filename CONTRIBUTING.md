# Contributing

Thanks for improving `launchclip`.

## Local Setup

```bash
nvm use 22
npm ci
node ./bin/launchclip.js doctor
npm run release:check
```

## Pull Requests

- Keep changes small and focused.
- Add or update tests when packet planning, rendering, or CLI behavior changes.
- Run `npm run release:check` before opening a PR.
- Run `npm audit --omit=dev` when dependencies change.
- `npm run package:smoke` must install and execute the generated tarball, not
  merely list its contents.

See [`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md) for the npm release, source,
agent-skill, and Homebrew tap flow.

## Safety Expectations

Do not commit real API keys, private campaign assets, customer data, or generated media that cannot be redistributed.

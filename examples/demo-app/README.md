# Pulseboard (demo app fixture)

A tiny, fictional SaaS app ("launch analytics for small teams") that LaunchClip's demo autopilot records in its tests and its example video. It has no dependencies.

```bash
npm run seed
npm run dev
```

Then open http://localhost:4310. The seed writes `data/db.json` with one test account (`demo@pulseboard.test`, from `scripts/seed.js`) and four sample projects. Everything in it is made up.

Record it with LaunchClip:

```bash
launchclip demo record examples/demo-app --out .launchclip/pulseboard/assets/demo --approve
```

`demo/` shows how to record an app that has no seed data and signs in through SSO: `demo/DEMO-PLAN.json` answers the API from `demo/fixtures.mjs` and starts each flow signed in from a test session, so neither the seed script nor the sign-in page is needed:

```bash
launchclip demo record examples/demo-app --plan examples/demo-app/demo/DEMO-PLAN.json --no-seed --approve
```

The `create-project` flow also uploads a cover image and a PDF brief from `demo/sample-files/` with `upload` steps: one clicks a button that opens a hidden file input, the other points its selector at a hidden `input[type=file]`, and the recorder clicks that input's label.

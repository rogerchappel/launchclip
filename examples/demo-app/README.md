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

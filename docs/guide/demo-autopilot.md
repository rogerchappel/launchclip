# Demo autopilot: LaunchClip records your product for you

Point LaunchClip at your SaaS codebase and it records the product demo itself: no screen recording, no tidying your browser first, no retakes. It starts your app, signs in with your seed data, clicks through 2–4 key flows at a human pace, and edits them into the video. The zooms, highlights and sound effects land on what actually happened in your app.

## With your AI agent

> "Make a 45-second launch video for the app in `~/code/acme`. Show signing in, creating a project and the analytics page."

Your agent reads the repo, plans the flows (`DEMO-PLAN.json`) and shows you the plan and the commands it will run before running anything. Once you agree, it records each flow, shows you a contact sheet of every flow, and uses only the ones you approve.

## From the command line

```bash
launchclip demo record ~/code/acme --out assets/demo
```

What happens:

1. **Start your app.** LaunchClip reads your package scripts, README, `docker-compose.yml`, `Procfile` and `.env.example` to find the dev command and URL (override with `--start "npm run dev" --url http://localhost:3000`).
2. **Ask first.** It lists the commands it will run (your seed script and the dev server) and waits for a yes. Pass `--approve` once you're happy with them.
3. **Prepare a clean demo state.** It runs your seed or fixtures script (`npm run seed`, `prisma db seed`…), so the recording shows sample data, never real customers.
4. **Plan the flows.** It writes `DEMO-PLAN.json`: a tour of your main pages by default, or a plan from a model with `--model provider:model`. Edit it and re-run with `--plan assets/demo/DEMO-PLAN.json`. `--plan-only` writes the plan from the code without running anything.
5. **Record.** Each flow plays in a clean Chromium window at 1920×1080 (`--viewport 4k` for 2×), with smooth cursor movement and natural typing, and becomes its own clip, `assets/demo/<flow>.mp4`. Every click and keystroke is time-stamped in `<flow>.actions.json`.
6. **Review.** `assets/demo/REVIEW.md` shows a contact sheet per flow. Approve what you're happy with:

   ```bash
   launchclip demo approve assets/demo
   ```

7. **Edit it in.** `launchclip demo scene assets/demo --flow sign-in` prints the `product-demo` scene for a flow: the clip zooms into each click, outlines the element and adds your callouts, with a click or keystroke sound on each action.

A plan is a short list of steps per flow:

```json
{
  "schema": "launchclip.demo-plan.v1",
  "app": { "url": "http://localhost:3000" },
  "flows": [
    { "id": "sign-in", "title": "Sign in", "steps": [
      { "type": "goto", "path": "/login" },
      { "type": "type", "text": "Email", "value": { "account": "email" } },
      { "type": "type", "text": "Password", "value": { "account": "password" } },
      { "type": "click", "text": "Sign in", "callout": "Straight in" }
    ] },
    { "id": "create-project", "title": "Create a project", "setup": ["sign-in"], "steps": [
      { "type": "goto", "path": "/projects/new" },
      { "type": "type", "text": "Project name", "value": "Summer launch" },
      { "type": "click", "text": "Create project", "callout": "Live in one click" },
      { "type": "wait-for", "text": "Project created" }
    ] }
  ]
}
```

Steps are `goto`, `click`, `type`, `wait-for`, `assert-visible` and `pause`; target elements by their visible text (a button, link, label or placeholder) or a CSS `selector`. Only visible elements match, so a hidden duplicate in a responsive layout (a collapsed mobile menu) is skipped. `setup` replays another flow off camera first, so a flow can start signed in.

## Apps with no seed data or SSO sign-in

Some apps can't be seeded locally: their data comes from an outside API, or the interesting state (an upcoming sale, a full inbox) doesn't exist right now. And apps that sign in through SSO (WorkOS, Auth0, Okta…) have no password field for autopilot to fill. Give the plan two things instead, kept in a `demo/` folder in your repo:

- **Fixtures** answer the app's network requests with made-up data, so the recording never needs a database or a real API.
- **A ready session** starts every flow signed in, so there's no sign-in to record.

```
demo/
  DEMO-PLAN.json
  fixtures.mjs
```

```json
{
  "schema": "launchclip.demo-plan.v1",
  "app": {
    "url": "http://127.0.0.1:4173",
    "fixtures": "fixtures.mjs",
    "allowOrigins": ["https://fonts.googleapis.com", "https://fonts.gstatic.com"],
    "session": {
      "localStorage": { "auth_token": "demo.eyJleHAiOjE4OTM0NTYwMDB9.signature", "currentTeamId": "team-1" }
    }
  },
  "flows": [
    { "id": "mark-inspected", "title": "Mark lots as inspected", "steps": [
      { "type": "goto", "path": "/sales" },
      { "type": "wait-for", "selector": "[aria-label='Mark lot 103 inspected']" },
      { "type": "click", "selector": "[aria-label='Mark lot 103 inspected']", "callout": "Mark inspected" },
      { "type": "pause", "ms": 1500 }
    ] }
  ]
}
```

```js
// demo/fixtures.mjs: made-up data only.
const inspected = new Set();
const ok = (data) => ({ json: { success: true, data } });

export function route({ url, method }) {
  if (!url.href.startsWith("http://localhost:3000/api/v1/")) return undefined; // let it through
  if (url.pathname.endsWith("/users/profile")) return ok({ user: { id: "demo-user", full_name: "Demo Buyer" } });
  const lot = url.pathname.match(/\/lots\/(\d+)\/inspection$/);
  if (lot) {
    if (method === "PUT") inspected.add(Number(lot[1])); else inspected.delete(Number(lot[1]));
    return ok({ lot_number: Number(lot[1]) });
  }
  return ok([]);
}
```

Then record it as usual:

```bash
launchclip demo record ~/code/acme --plan ~/code/acme/demo/DEMO-PLAN.json --approve
```

**Fixtures.** `app.fixtures` is a module, relative to the plan file, that exports `route({ request, url, method, body })`. Return `{ status?, json }` (or `{ status?, body, contentType? }`) to answer a request, or `undefined` to let it through to your app. `url` is a `URL` and `body` is the parsed JSON body. Each flow gets a fresh copy of the module, so state such as `inspected` above starts over. If you'd rather replay real traffic you've captured, `app.har` takes a `.har` file instead (or as well: fixtures answer first, then the HAR).

**Nothing else is reached.** With fixtures or a HAR, requests to any other origin than your app's are blocked, so no analytics, error tracker or real API is touched during a recording. Allow what the page needs to look right, such as web fonts, with `app.allowOrigins`. Turn blocking off with `"blockOffOrigin": false`.

**A ready session.** `app.session` is either a Playwright storage state file, `{ "storageState": "state.json" }`, or the values your app keeps once signed in: `localStorage` (written for your app's origin before its scripts run) and `cookies` (for your app's URL unless they name a `domain`). Point your fixtures at whatever the app does with them, for example accept any token on `/users/profile`.

Session values must be **test values**. LaunchClip refuses a plan whose session holds anything that looks like a real credential:

- API keys (`sk-…`, `sk_live_…`, `ghp_…`, `xox…`, `AKIA…`) and bearer tokens;
- signed JWTs. Use an unsigned one (`"alg": "none"`) or a fake signature, like `demo.<payload>.signature` above;
- long random strings (40+ characters), unless the value says it's test data (`demo`, `test`, `fake`, `mock`…);
- cookies for a production host.

Session values never appear in the action logs; they're masked like test-account passwords. Don't copy a session out of a real browser: make one up and answer it from your fixtures.

[`examples/demo-app/demo`](../../examples/demo-app/demo) is a working example: Pulseboard recorded without its seed script or sign-in page.

```bash
launchclip demo record examples/demo-app --plan examples/demo-app/demo/DEMO-PLAN.json --no-seed --approve
```

## Recording from your own script

If you set up the browser yourself, `prepareContext` gives your context the same cursor, fixtures, blocking and session that `demo record` uses, and `recordFlow` records a flow on it:

```js
import { prepareContext, recordFlow } from "launchclip/src/demo/record.js";

const { secrets } = await prepareContext(context, { app: plan.app, url, planDir: "demo" });
await recordFlow(context, plan.flows[0], { url, out: "assets/demo", viewport: { width: 1920, height: 1080 }, secrets });
```

`CURSOR_SCRIPT` is exported too, if all you need is the cursor.

## Headless: `launchclip make --repo`

`launchclip make "<prompt>" --repo ~/code/acme` runs autopilot as its first step and edits the approved flows into the video it makes. See the [headless guide](headless.md#record-your-product-with---repo).

## Guardrails

- **Local or staging only.** It records `localhost`, private network addresses, `*.test` / `*.localhost` hosts, and hosts named like staging, dev, qa or preview. Anything that looks like production is refused unless you pass `--allow-host <host>`.
- **No real passwords.** Sign-in fields take `{"account": "password"}`, filled from your seed files or `LAUNCHCLIP_DEMO_EMAIL` / `LAUNCHCLIP_DEMO_PASSWORD`. The plan can't contain a literal password, and typed account values never reach the logs.
- **Test sessions only.** A plan's `app.session` can't hold API keys, signed JWTs, long random tokens or production cookies, and its values never reach the logs.
- **Fixtures stay local.** Fixtures are a module in your repo that runs on your machine; a plan written by a model can't name fixtures, a HAR or a session. With fixtures or a HAR, requests to other origins are blocked.
- **Secrets are redacted** from command output and action logs.
- **Nothing is used until you approve it.**

## What you need

Demo autopilot uses Playwright (an optional dependency, or the `playwright` / `@playwright/test` your app's repo already installs) and a Chromium that's already on your machine: `LAUNCHCLIP_CHROMIUM`, Playwright's own browser, or Google Chrome. It never downloads a browser itself; if none is found, run `npx playwright install chromium`. Video is encoded with your system `ffmpeg`.

Try it on the bundled sample app, [`examples/demo-app`](../../examples/demo-app) (Pulseboard, a made-up analytics SaaS):

```bash
launchclip demo record examples/demo-app --out assets/demo --approve
```

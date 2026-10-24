# Demo autopilot: LaunchClip records your product for you

Point LaunchClip at your SaaS codebase and it records the product demo itself: no screen recording, no tidying your browser first, no retakes. It starts your app, signs in with your seed data, clicks through 2–4 key flows at a human pace, and edits them into the video. The zooms, highlights and sound effects land on what actually happened in your app.

## With your AI agent

> "Make a 45-second launch video for the app in `~/code/acme`. Show signing in, creating a project and the analytics page."

Your agent reads the repo and plans the flows (`DEMO-PLAN.json`). Before it runs anything, it shows you the plan and the commands it will run. Once you agree, it records each flow, shows you a contact sheet for every flow, and uses only the ones you approve.

If your app is harder to record, your agent works out the setup for you. That covers apps that sign in with SSO, have no seed data, or load their data from another service:

1. It surveys the repo with `launchclip demo doctor`.
2. It picks the cheapest setup that works:
   - a plan alone, when there's a seed script and a password login;
   - a test session, for SSO;
   - fixtures, when there's no data. It reuses your e2e tests' mocks and sign-in before writing anything new.
3. It writes a small `demo/` folder in your repo and shows it to you.
4. It runs `demo doctor` until every check passes, then records.

You commit `demo/`, and from then on anyone (or CI) can record the same flows with one command, no agent needed. See [Check a recipe](#check-a-recipe-demo-doctor).

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

Some apps can't be seeded locally: their data comes from an outside API, or the interesting state (a full inbox, orders waiting to ship) doesn't exist right now. And apps that sign in through SSO (WorkOS, Auth0, Okta…) have no password field for autopilot to fill. Give the plan two things instead, kept in a `demo/` folder in your repo:

- **Fixtures** answer the app's network requests with made-up data, so the recording never needs a database or a real API.
- **A ready session** starts every flow signed in, so there's no sign-in to record.

```
demo/
  DEMO-PLAN.json
  fixtures.mjs
```

This is [`examples/sso-app/demo`](../../examples/sso-app/demo), trimmed. Orderdesk is a made-up app whose API lives on another origin that never runs:

```json
{
  "schema": "launchclip.demo-plan.v1",
  "app": {
    "url": "http://localhost:4320",
    "fixtures": "fixtures.mjs",
    "session": {
      "localStorage": { "auth_token": "demo.eyJzdWIiOiJkZW1vLXVzZXIiLCJleHAiOjE4OTM0NTYwMDB9.signature" }
    }
  },
  "flows": [
    { "id": "ship-an-order", "title": "Ship an order", "steps": [
      { "type": "goto", "path": "/#orders" },
      { "type": "wait-for", "text": "Harbor & Pine" },
      { "type": "click", "text": "Harbor & Pine", "callout": "Every order, one click away" },
      { "type": "click", "selector": "[role=dialog] button:has-text(\"Mark as shipped\")", "callout": "Shipped" },
      { "type": "pause", "ms": 1500 }
    ] }
  ]
}
```

```js
// demo/fixtures.mjs: made-up data only.
const API = "http://localhost:4321/api";
const shipped = new Set();

export function route({ url, method }) {
  if (!url.href.startsWith(`${API}/`)) return undefined; // let it through
  if (url.pathname === "/api/me") return { json: { name: "Avery Demo", onboarding_completed: true } };
  const ship = url.pathname.match(/\/orders\/(\d+)\/ship$/);
  if (ship && method === "PUT") { shipped.add(Number(ship[1])); return { json: { id: Number(ship[1]), status: "shipped" } }; }
  // …the orders list, filtered by ?status= the way the real API does
  return { status: 404, json: { error: `no fixture for ${method} ${url.pathname}` } };
}
```

Then record it as usual:

```bash
launchclip demo record examples/sso-app --plan examples/sso-app/demo/DEMO-PLAN.json --approve
```

**Fixtures.** `app.fixtures` is a module, relative to the plan file, that exports `route({ request, url, method, body })`. Return `{ status?, json }` (or `{ status?, body, contentType? }`) to answer a request, or `undefined` to let it through to your app. `url` is a `URL` and `body` is the parsed JSON body. Each flow gets a fresh copy of the module, so state such as `shipped` above starts over. If you'd rather replay real traffic you've captured, `app.har` takes a `.har` file instead (or as well: fixtures answer first, then the HAR). A HAR must be **scrubbed** before it's used. LaunchClip refuses one that still has `Authorization`, `Cookie` or `Set-Cookie` headers, token- or key-like values, or email addresses outside `example.com` and `.test`. A capture from staging can also hold copies of real customers, so prefer fixtures.

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

## Check a recipe: `demo doctor`

`demo doctor` tells you, or your agent, what a repo needs and what's wrong with a recipe, before anything is recorded.

```bash
launchclip demo doctor ~/code/acme
```

Without `--plan`, it only reads files. It lists:

- how the app starts and seeds, including your Playwright config's `webServer`;
- test accounts;
- auth providers;
- e2e `page.route` mocks and `addInitScript` sign-ins;
- MSW handlers, OpenAPI specs and HARs;
- the env vars for your API URL and analytics;
- first-run flags such as `onboarding_completed`;
- video placeholders in your docs.

Then it recommends a setup **rung**:

| Rung | When | What the recipe needs |
| --- | --- | --- |
| 1 | A seed script and a password login | `DEMO-PLAN.json` only |
| 2 | SSO sign-in | plus `app.session` |
| 3 | No seed data, or an external API | plus `app.fixtures` (or a scrubbed `app.har`) |

Production is never a rung.

```bash
launchclip demo doctor ~/code/acme --plan ~/code/acme/demo/DEMO-PLAN.json --approve
```

With `--plan`, it starts your app (asking first, like `record`) and plays every flow at full speed with no camera. Each check passes, warns or fails, and each one that doesn't pass comes with a fix:

- **Steps.** Every step's selector or text must reach a visible element. When one doesn't, doctor lists the closest texts on the page and saves a screenshot. A step that matches several visible elements gets a warning.
- **Sign-in.** A flow mustn't start on a sign-in page or an SSO redirect. Doctor tells "add a session" apart from "the server rejected the session".
- **Overlays.** A dialog, tour or onboarding screen covering the first frame is reported with its text.
- **Network.** Doctor keeps a ledger of every request and how it was answered (fixture, HAR, app, or blocked). API calls that got errors are flagged, and so is anything a recording would have let out to another origin. While doctor runs, other origins are always blocked.
- **Files.** The fixtures module loads, the HAR is scrubbed, and the session holds test values only.

`--json` prints the report for agents (`launchclip.demo-doctor.v1`), and the exit code is 1 when anything fails. When everything passes, `next` is the exact `demo record` command to run. [`examples/sso-app`](../../examples/sso-app) is a worked example: an SSO app with no seed data whose recipe reuses its e2e test's mocks and sign-in.

## Flows from your docs

If your help docs already mark where videos go, `demo shots` drafts a flow for each one. It reads these placeholders:

- `{/* video: open an order and mark it shipped */}` or `{/* VIDEO: V09 — … */}` in MDX;
- `<!-- video: … -->` in Markdown;
- shot-list tables with an id column and a description column.

```bash
launchclip demo shots docs/ --draft demo/DEMO-PLAN.json
```

Each video becomes a flow, with its description as the goal and a `shot` link back to the placeholder. Your agent then writes the steps and takes the plan through `demo doctor`. Running it again adds only new placeholders.

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
- **Fixtures stay local, and you approve them.** Fixtures are a module in your repo that runs on your machine. `record` and `doctor` name the module when they ask before running anything, even with `--no-seed --no-start`. A plan written by a model can't name fixtures, a HAR or a session. With fixtures or a HAR, requests to other origins are blocked, and `doctor` always blocks them.
- **Scrubbed HARs only.** A HAR with credential headers, cookies, tokens or real email addresses is refused.
- **Secrets are redacted** from command output and action logs.
- **Nothing is used until you approve it.**

## What you need

Demo autopilot uses Playwright (an optional dependency, or the `playwright` / `@playwright/test` your app's repo already installs) and a Chromium that's already on your machine: `LAUNCHCLIP_CHROMIUM`, Playwright's own browser, or Google Chrome. It never downloads a browser itself; if none is found, run `npx playwright install chromium`. Video is encoded with your system `ffmpeg`.

Try it on the bundled sample app, [`examples/demo-app`](../../examples/demo-app) (Pulseboard, a made-up analytics SaaS):

```bash
launchclip demo record examples/demo-app --out assets/demo --approve
```

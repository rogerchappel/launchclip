# Demo setup: writing a repo's demo recipe

Use this when demo autopilot needs more than `launchclip demo record <repo>`:
the app signs in through SSO, it has no seed data, or its data comes from an
external API. You write the recipe. The CLI checks it (`launchclip demo
doctor`) and records it. The recipe is a small `demo/` folder committed in the
app's repo, so anyone (CI included) can record again without an agent:

```
demo/
  DEMO-PLAN.json   # always
  fixtures.mjs     # only for rung 3
  state.json       # only when the session is a Playwright storage state
```

## 1. Survey, then pick the cheapest rung

```bash
launchclip demo doctor <repo> --json
```

This reads files only and runs nothing. It reports:

- start and seed commands, including the Playwright config's `webServer`;
- test accounts;
- auth providers, and SSO redirects in the code;
- e2e `page.route` mocks and `addInitScript` sign-ins;
- MSW handlers, OpenAPI specs and typed API contracts;
- HAR files;
- the API base-URL and analytics env vars;
- first-run flags (tour, onboarding, wizard);
- docs placeholders.

It ends with a recommended `rung`, its `reasons` and a `reuse` list. Take the
cheapest rung that works:

1. **Seed script and password login: a plan only.** Sign-in steps take
   `{"account": "email"}` / `{"account": "password"}`, filled from the seed
   data or `LAUNCHCLIP_DEMO_EMAIL` / `LAUNCHCLIP_DEMO_PASSWORD`.
2. **SSO: a test session.** Put `app.session` in the plan: the values the app
   keeps once signed in (`localStorage` or `cookies`), or a Playwright storage
   state file. Build it from the repo's e2e sign-in (`addInitScript`), and
   include whatever skips team or role selection.
3. **No seed data, or an external API: fixtures.** Write `app.fixtures`, a
   module exporting `route({ request, url, method, body })` that returns
   `{ status?, json }` or `undefined` to let the request through. Reuse what
   the repo already has, in this order:
   1. Playwright `page.route` mocks in e2e tests: lift each handler into
      `route()`.
   2. MSW handlers: same idea, request in, JSON out.
   3. Typed API contracts or an OpenAPI spec: build responses in those shapes.
   4. A HAR from staging (`app.har`). The person captures it, never you, and
      doctor refuses it until it's scrubbed.
4. **Production: refuse.** Never point a recipe at production, and never ask
   for `--allow-host` to get around the guardrail.

### Serving the app in demo mode (rung 3)

Prefer the e2e config's `webServer` command, because it usually already points
the API somewhere mocked. Otherwise:

- Do a production build with the API base-URL env var pointed at an origin
  where nothing runs (for example `http://localhost:3000/api`).
- Blank the analytics and error-tracking keys.
- Serve the build with the framework's `preview`. A production build has no
  hot reload or error overlays to get in the shot.

Suggest the person adds this as a `demo:serve` script. Don't change the build's
output folder: custom build plugins often assume the default.

### Writing fixtures

- **Echo what the flow changes.** If a click marks something done, remember it
  in module state. If the server applies a filter (it's in the request body or
  query), apply it in the fixture too. Each flow loads the module afresh.
- **Answer every endpoint the flow touches,** including ones the e2e tests
  never mocked. Doctor's ledger lists every request and how it was answered;
  read the app's API client for the response shapes.
- **Answer first-run state as done.** Tours, onboarding and wizards (doctor
  lists their flags) would otherwise cover the first frame.
- **Make up all the data.** Use fictional names and companies, `@example.com`
  addresses, dates relative to today, and totals that agree with the rows.
  Never use real customers.
- **Session values are test values.** Use an unsigned token such as
  `demo.<base64url payload>.signature`, with a far-future `exp` if the app
  checks it. The guardrails refuse API keys, signed JWTs, long random tokens
  and production cookies. Never copy a session out of a real browser.

### When the server checks the session

A made-up session works when the app only decodes it in the browser, or when
fixtures answer the API. If the app's own local server verifies it, as
NextAuth or Clerk do on the server, doctor reports "the server rejected the
session". Then, in this order:

1. Reuse the repo's own e2e sign-in: a test user, the provider's testing
   tokens, or a dev credentials provider.
2. Otherwise, sign in with a `setup` flow to a local test account, with the
   credentials from `LAUNCHCLIP_DEMO_EMAIL` / `LAUNCHCLIP_DEMO_PASSWORD`.
3. Only as a last resort, propose a dev-only sign-in shortcut. Gate it with an
   env var, keep it off by default, and show the person the diff before you
   write it. Never add one that could ship to production.

### Questions for the person, not for you

- Which plan or role each video shows. Free-plan screens suit features every
  plan has, and a paid plan suits paid features. That's a product decision.
- Anything the docs or brief don't settle about what the video should prove.

## 2. Show the person before anything runs

Before the first doctor check, show the person three things:

- **The commands** that will run: the start command, the seed command and the
  build if there is one.
- **The fixtures module.** It is code that runs on their machine.
- **The recipe:** `DEMO-PLAN.json` and a summary of the fixtures and session.

Wait for a yes. Doctor and record ask too; `--approve` is the person's yes, so
pass it only after they agree.

## 3. Check until clean

```bash
launchclip demo doctor <repo> --plan <repo>/demo/DEMO-PLAN.json --approve --json \
  [--start "<command>" --url http://localhost:<port>] [--no-seed]
```

Doctor starts the app, then runs every flow at full speed with no camera.
Requests that leave the app's origin are always blocked while it runs. Each
check has `id`, `status` (`pass` | `warn` | `fail` | `skip`), `message`, and
`fix` and `evidence` when it didn't pass. Act on each `fix`:

- **`flow.<id>.step.<n>` fails.** `evidence.closest` lists the visible texts
  nearest to what the step asked for, and `evidence.screenshot` shows the page.
  Use one of the closest texts, or a selector. Things that commonly need a
  selector:
  - hash routes go as they are (`"path": "/#orders"`);
  - ARIA widget options: `[role=option]:has-text("…")`;
  - tabs: `[role=tab]:has-text("…")`;
  - a table row is clicked by its cell's text;
  - a modal is scoped so it doesn't match the page behind it:
    `[role=dialog] button:has-text("…")`.
- **`….ambiguous` warns.** The step matched more than one visible element.
  Scope it.
- **`flow.<id>.signin` fails.** The flow started signed out. Add or fix
  `app.session` (see "When the server checks the session" above).
- **`flow.<id>.overlay` warns.** A first-run tour or dialog covers the page.
  Answer its flag as done in the fixtures.
- **`network.unanswered` warns.** Add a fixture route for that request, in the
  shape the app expects.
- **`network.offorigin` fails.** A recording would let requests leave the app.
  Set `app.blockOffOrigin: true`. List an origin in `app.allowOrigins` only for
  page assets such as web fonts.
- **`files.*` fails.** Fix the recipe file named. The HAR, session and
  fixtures messages say exactly what's wrong.

After the first step, `wait-for` the first thing the viewer should see before
the opening `pause`, so the clip doesn't start on a loading state. Iterate
until `ok` is true. If two rounds in a row fix nothing, stop and show the
person the failing checks and the screenshot.

## 4. Record and review

Doctor's `next` is the exact record command. Run it with `--out
<project>/assets/demo`, then open every `<flow>.sheet.png` contact sheet with
the person. Approve only what they accept: `launchclip demo approve
<project>/assets/demo [--flows a,b]`.

Tell the person which files to commit (`demo/DEMO-PLAN.json`, plus
`demo/fixtures.mjs` and a session file if there is one). Give them the one-line
record command for their README or CI.

## Flows from docs

When the docs already have video placeholders, such as `{/* video: … */}`,
`{/* VIDEO: V09 — … */}`, `<!-- video: … -->` or a shot-list table:

```bash
launchclip demo shots <docs-dir> --draft <repo>/demo/DEMO-PLAN.json --url http://localhost:<port>
```

This writes one flow per video, with `goal` set to the placeholder's
description and `shot` pointing back to it. Write each flow's steps from the
description and the app's code, then take the plan through doctor. Re-running
`--draft` adds only new placeholders and keeps the steps you wrote.

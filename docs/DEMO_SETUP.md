# Demo setup with zero config for the person

Status: design, for review before the build.

## Goal

A person says "record the checkout flow of this app" and gets clips, without
learning the plan format, fixtures or sessions. Their own agent (Claude Code or
Codex, through the LaunchClip skill) works out the setup. The CLI never guesses:
it validates, reports what's wrong in a form the agent can act on, and records
deterministically. What the agent writes is committed in the app's repo as a
`demo/` folder, so anyone, CI included, can record again without an agent.

| Who | Does | Never |
| --- | --- | --- |
| The agent, through the skill | Reads the repo, picks the cheapest setup rung, writes `demo/`, shows the person the commands and the recipe, then runs `doctor` until it's clean | Records before the person agrees; points at production |
| The CLI (`demo doctor`, `demo record`) | Surveys the repo, validates the recipe against the running app, records | Writes or guesses a recipe; reaches off-origin services during a check |
| The recipe (`demo/`) | Lives in the app's repo: `DEMO-PLAN.json`, plus `fixtures.mjs` and a session only when needed | Holds real credentials (the guardrails from #159 still apply) |

## The setup ladder

The skill teaches the agent to take the cheapest rung that works:

1. **Seed script and password login.** A plan alone: `{account: "email"}`
   steps, filled from seed files. Nothing else goes in `demo/`.
2. **SSO** (WorkOS, Auth0, Clerk, Okta, NextAuth providers). Add a test session
   in `app.session` (localStorage or cookies, or a `storageState` file) and
   fixtures for whatever validates it, such as `/me` or `/profile`.
3. **No seed data or external APIs.** Add fixtures. Reuse what the repo has
   before writing anything new, in this order:
   1. Playwright `page.route` mocks in e2e tests (lift the handlers into
      `route()`);
   2. MSW handlers (same idea: request → JSON);
   3. typed API contracts or an OpenAPI spec (generate shapes from the types);
   4. a one-off HAR from staging (`app.har`). The person records it, never the
      agent, and it gets scrubbed before it's committed.
4. **Production.** Refused, as today: the URL guardrail, plus doctor's checks.

## `launchclip demo doctor <repo> [--plan demo/DEMO-PLAN.json]`

Doctor runs in one of two modes.

**Without `--plan` (survey).** It reads files only and runs nothing. It reports
the repo signals that decide the rung:

- start and seed commands (from `detectApp`) and test accounts;
- auth providers, from dependencies and imports;
- Playwright `page.route` mocks, MSW handlers, OpenAPI files, `.har` files;
- an existing `demo/` folder;
- video placeholders in the docs (see "Flows from docs" below);
- the e2e setup:
  - the Playwright config's `webServer` command, often a ready "demo mode" server
    that points the API at a mocked origin;
  - `addInitScript` sign-ins, which are a ready-made `app.session`;
- the env vars that matter for a demo build:
  - the API base URL (`VITE_API_URL`, `NEXT_PUBLIC_API_URL`…);
  - analytics and error-tracking keys to blank (PostHog, Sentry, Segment…);
- first-run UI state in the code (tour, onboarding and wizard flags), for the
  fixtures to answer as done.

It ends with a recommended rung and the next command to run. This is the
agent's first call.

**With `--plan` (check).** It starts the app the same way `record` does: with
the same consent prompt and `--approve`, or with `--url` and `--no-start`. Then
it runs these checks in order. A check is skipped when an earlier one it
depends on failed.

| Check id | What it checks | Example fix it reports |
| --- | --- | --- |
| `plan.valid` | Runs `validateDemoPlan`: errors fail, warnings warn | the validator's own message |
| `url.safe` | The guardrail's host class; a production host fails | "point app.url at a local or staging host" |
| `files.fixtures` | The module imports and exports `route` | "fixtures.mjs must export route(...)" |
| `files.har` | The file exists and parses as a HAR | |
| `files.session` | The storage state reads, and its values are test-only | the guardrail's message |
| `recorder` | Playwright, Chromium and ffmpeg are present | "npx playwright install chromium" |
| `app.reachable` | The URL answers | start command or `--url` |
| `flow.<id>.step.<n>` | Each step's selector or text resolves to a visible element on its page | below |
| `flow.<id>.signin` | The flow didn't land on a sign-in page or an SSO host | "add app.session (rung 2)" |
| `network.offorigin` | Requests to origins outside the app and `allowOrigins` | "add https://fonts.gstatic.com to app.allowOrigins, or answer it in fixtures" |
| `network.unanswered` | App API requests that got 4xx or 5xx, or failed | "no fixture answered GET /api/v1/orders (404)" |
| `fixtures.threw` | A fixture handler threw | the stack's first line |
| `flow.<id>.overlay` | A dialog, tour or onboarding overlay covers the page at the first step | its text, plus "answer its flag as done in fixtures or the session" |
| `flow.<id>.step.<n>.ambiguous` (warn) | A step matched more than one visible element | "scope the selector (for example `[data-testid=…] …`)" |
| `page.errors` | Uncaught page errors and console errors, listed after the request that preceded them. Errors on `about:blank` are ignored. | the message |

Doctor runs each flow like `record` does: in a fresh context with the same
`prepareContext`, the steps performed for real (later targets often exist only
after an earlier click), and at full speed with no screencast. When a step
fails, it reports:

- how many elements matched, and how many of those were hidden;
- up to five visible buttons, links, labels or placeholders whose text is
  closest to what the step asked for;
- the URL it was on;
- a screenshot, `<out>/doctor/<flow>-step<n>.png`.

The flow stops at its first failing step, and the other flows still run.

Off-origin requests are always blocked during a doctor run, so a check never
reaches analytics or a real API. Doctor reports the origins that a real
recording would have let out: with `blockOffOrigin: false`, or with no fixtures
or HAR, where blocking is off by default. Each of those is a failure. Its fix is
"set app.blockOffOrigin: true" or "list it in app.allowOrigins".

The output is human-readable by default. With `--json`, it's
`{schema: "launchclip.demo-doctor.v1", ok, mode, rung?, checks: [{id, status: "pass"|"warn"|"fail"|"skip", flow?, step?, message, fix?, evidence?}], next}`.
The exit code is 1 when any check fails. `--flows a,b` limits the check to
those flows.

Each flow in the JSON output also carries a network ledger. Every request the
flow made is listed with how it was answered: `fixture`, `har`, `app`,
`blocked` or `failed`. The ledger is how the agent finds the response shapes
that the e2e mocks never covered.

When doctor starts the app, a start or build failure is reported verbatim. A
custom Vite plugin that assumes the default `outDir`, for example, fails
loudly rather than as a timeout.

Doctor's cost is one browser session per flow, with no ffmpeg and no model
call.

## Flows from docs

`launchclip demo shots <docs-dir-or-file> [--draft demo/DEMO-PLAN.json]` reads:

- MDX comment placeholders: `{/* video: <description> */}` and
  `{/* VIDEO: id — <description> */}`;
- Markdown comments: `<!-- video: … -->`;
- shot-list tables, meaning a Markdown table with an id column and a
  description column, where the rows are videos (the type column says video, or
  the id looks like `V01`).

It prints `[{id, description, file, line, page?}]`. With `--draft`, it writes a
plan with one flow per shot: the id is slugged from the shot id or the
description, `goal` is the description, and `steps` hold only a `goto` to the
page's route when that can be inferred, else `/`. That plan validates, but every
flow gets a "never clicks" warning, so the agent has to fill in the steps and
take them through doctor. Screenshot placeholders are listed but don't get a
flow.

## The skill

There's a new shared skill section, `skills-src/shared/demo-setup.md`, and
`demo-autopilot.md` points to it. It teaches this loop:

1. `launchclip demo doctor <repo> --json` (survey), then pick the rung.
2. Write `demo/`: the plan, plus fixtures and a session only if the rung needs
   them. Reuse the repo's mocks first.
3. **Show the person** the commands that will run (the start command and the
   seed command) and the recipe files. Then wait for a yes.
4. `launchclip demo doctor <repo> --plan demo/DEMO-PLAN.json --approve --json`.
   Fix what it reports and run it again until it's clean. Keep to a few rounds;
   if a round makes no progress, ask the person.
5. `launchclip demo record …`, then open each contact sheet with the person and
   approve only what they accept.
6. Optionally, `demo shots` to draft the flows from the docs' placeholders.

What the skill teaches comes from dogfooding on a real
SSO app with no seed data (it recorded on the first try):

- **Serve the app in demo mode.** Prefer the e2e config's server command, or a
  production build plus `preview` with the API URL pointed at a mocked origin
  and analytics keys blanked. Suggest a `demo:serve` script. Don't change the
  build's output dir.
- **Build the session** from the e2e `addInitScript`. Include whatever skips
  team or role selection.
- **Make fixtures stateful** when the flow changes things. If a filter is
  applied on the server, the fixture applies it too.
- **Use fictional data.** Use fictional names, dates relative to today, and
  counts that agree with the rows.
- **Clear first-run UI.** Answer tour, onboarding and wizard flags as done.
- **Ask the person** which plan or role each video shows. That's a product
  decision, not a setup one.
- **Selectors:**
  - Use hash routes as they are (`/#orders`).
  - Target ARIA widget options with `[role=option]:has-text(…)`.
  - Scope a modal so it doesn't match the page behind it.
  - `wait-for` the first actionable element before the opening pause.

The skill also says which `demo/` files to commit, and gives a one-line
`demo record` command for the README or CI.

## Examples and tests

- `examples/demo-app` already covers rung 1 (its seed script) and rungs 2–3
  (`demo/` with fixtures and a session).
- `examples/sso-app` is new and mirrors a real SSO app
  with no seed data. It's a static SPA served by a tiny no-dependency server. It calls its API on a different
  origin, which is never running, and it redirects to an SSO host when no token
  is set. It ships a Playwright-style e2e spec with `page.route` mocks, and its
  `demo/fixtures.mjs` is lifted from those mocks. It exercises cross-origin
  fixtures, the sign-in check, blocked origins and fonts in `allowOrigins`.
- `test/demo_doctor.test.js` covers:
  - survey signals on fixture repos (temp dirs);
  - each check against the demo apps with broken plans (a wrong text, a hidden
    duplicate, a missing fixture route, an off-origin escape, a missing
    session);
  - the JSON shape;
  - the exit code.

  The browser tests skip without Chromium, as the existing ones do.
- `test/demo_shots.test.js` covers placeholder and table parsing, and checks
  that the drafted plan validates.

## Out of scope

- Converting Playwright, MSW or OpenAPI sources into fixtures automatically.
  The agent does that with the skill's guidance; a generator is a possible
  follow-up once we've seen a few repos.
- Locale and timezone options in the plan, such as `en-AU` and `Australia/Sydney`.
- Narration anchored to action labels, with pauses sized from TTS durations, and
  captions built from them. These are a follow-up from the dogfood notes.
- Loading `.env` automatically for provider keys. For now this is documented
  only.
- Doctor fixing the plan itself. It reports fixes; the agent applies them.

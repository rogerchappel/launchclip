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

Steps are `goto`, `click`, `type`, `wait-for`, `assert-visible` and `pause`; target elements by their visible text (a button, link, label or placeholder) or a CSS `selector`. `setup` replays another flow off camera first, so a flow can start signed in.

## Guardrails

- **Local or staging only.** It records `localhost`, private network addresses, `*.test` / `*.localhost` hosts, and hosts named like staging, dev, qa or preview. Anything that looks like production is refused unless you pass `--allow-host <host>`.
- **No real passwords.** Sign-in fields take `{"account": "password"}`, filled from your seed files or `LAUNCHCLIP_DEMO_EMAIL` / `LAUNCHCLIP_DEMO_PASSWORD`. The plan can't contain a literal password, and typed account values never reach the logs.
- **Secrets are redacted** from command output and action logs.
- **Nothing is used until you approve it.**

## What you need

Demo autopilot uses Playwright (an optional dependency) and a Chromium that's already on your machine: `LAUNCHCLIP_CHROMIUM`, Playwright's own browser, or Google Chrome. It never downloads a browser itself; if none is found, run `npx playwright install chromium`. Video is encoded with your system `ffmpeg`.

Try it on the bundled sample app, [`examples/demo-app`](../../examples/demo-app) (Pulseboard, a made-up analytics SaaS):

```bash
launchclip demo record examples/demo-app --out assets/demo --approve
```

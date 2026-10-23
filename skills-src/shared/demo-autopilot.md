## Record the product (demo autopilot)

When the user points at a SaaS codebase and the video should show the product
in use, record the flows with demo autopilot before writing the storyboard.
Skip this step when they supplied their own screen recordings.

When the app signs in through SSO, has no seed data, or loads its data from an
external API, the plain flow below won't record it. Follow
[references/demo-setup.md](demo-setup.md) instead. In short:

1. Run `launchclip demo doctor <repo> --json` to get the recommended rung.
2. Write the `demo/` recipe, reusing the repo's e2e mocks and sign-in.
3. Show the person the commands and the recipe.
4. Run `launchclip demo doctor <repo> --plan demo/DEMO-PLAN.json --approve
   --json` until it's clean.
5. Record, then review the contact sheets.

1. **See how it runs.** `launchclip demo record <repo> --plan-only --out
   <project>/assets/demo` reads the repo (package scripts, README,
   docker-compose, Procfile, `.env.example`) and the code's routes and nav
   links, then writes a draft `DEMO-PLAN.json` without running anything.
2. **Plan the flows yourself.** You are the planner. Edit `DEMO-PLAN.json` to
   2–4 flows that sell the product for the brief, for example *sign up →
   create a project → see the result*. Use only routes, link and button text
   and field labels you found in the code. Start every flow with a `goto`, and
   list a sign-in flow in another flow's `setup` when that flow needs a
   signed-in user (setup runs off camera). Put a short `callout` (≤ 42 chars)
   on the step where a feature appears. Sign-in fields take
   `{"account": "email"}` / `{"account": "password"}`: the recorder fills them
   from the repo's seed data or `LAUNCHCLIP_DEMO_EMAIL` /
   `LAUNCHCLIP_DEMO_PASSWORD`. Never write a password, key or token in the plan.
   Check the plan before recording: `launchclip demo doctor <repo> --plan
   <project>/assets/demo/DEMO-PLAN.json --approve --json` runs every step and
   reports each problem with a fix.
3. **Ask before running anything.** Show the user the plan and the commands
   autopilot will run: the seed script (`npm run seed`, `prisma db seed`…)
   and the start command, plus the URL it will record. Run
   `launchclip demo record <repo> --plan <project>/assets/demo/DEMO-PLAN.json
   --out <project>/assets/demo --approve` only after they agree. Use `--start
   "<command>" --url http://localhost:<port>` when detection guessed wrong,
   `--no-seed` when there is no safe seed, and `--no-start --url …` for an
   app that is already running. Only local and staging URLs are recorded;
   `--allow-host <host>` is the user's explicit opt-in for anything else.
4. **Show every flow.** Open each `<flow>.sheet.png` contact sheet (and the
   clip when in doubt) with the user, and fix the plan and re-record anything
   that looks wrong: a missed click, an empty page, or private data. Approve
   only what the user accepts: `launchclip demo approve <project>/assets/demo
   [--flows a,b]`. Unapproved flows never go in a video.
5. **Edit them in.** For each approved flow, `launchclip demo scene
   <project>/assets/demo --flow <id> [--source-start s] [--duration s]` prints
   the `product-demo` params built from its action log: the clip window, the
   clicks and typing with their bounding boxes, and the callouts. Paste them
   into a `product-demo` scene unchanged, so the zooms, outlines and SFX land
   on what happened in the app. Shorten a flow with `--duration`; never edit
   the action boxes or times by hand. Narrate over the flow, and keep the
   motion-graphics scenes for the claims around it.

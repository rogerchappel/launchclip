# Orderdesk (SSO example)

A fictional SaaS front end that LaunchClip's demo doctor and recorder use in
tests and the docs. It has the parts that make a demo hard to record:

- It signs in through SSO. Without a token in `localStorage`, it redirects to
  an identity provider.
- All of its data comes from an API on another origin
  (`http://localhost:4321/api`), which never runs here. There's no seed data.
- It sends analytics to a third-party origin.
- It shows a first-run welcome tour.

The server only serves the static app:

```bash
npm run dev   # http://localhost:4320
```

The e2e test, `e2e/orders.spec.ts`, signs in by writing a test token with
`addInitScript` and answers the API with `page.route` mocks. The demo recipe in
`demo/` reuses both:

- `demo/fixtures.mjs` is lifted from the mocks. It adds a memory of shipped
  orders and the server-side status filter, and says onboarding is done.
- `app.session` in `demo/DEMO-PLAN.json` holds the same kind of made-up token.

Check the recipe, then record it:

```bash
launchclip demo doctor examples/sso-app
launchclip demo doctor examples/sso-app --plan examples/sso-app/demo/DEMO-PLAN.json --approve
launchclip demo record examples/sso-app --plan examples/sso-app/demo/DEMO-PLAN.json --approve
```

Everything in this app is made up.

// Demo autopilot plans (src/demo/plan.js): validation, route discovery on the
// examples/demo-app fixture, the heuristic plan and the model planner loop.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { findTestAccounts } from "../src/demo/app.js";
import { DEMO_PLAN_SCHEMA, discoverRoutes, fileRoute, heuristicPlan, planDemo, rebasePlanPaths, validateDemoPlan } from "../src/demo/plan.js";

const FIXTURE = path.resolve(import.meta.dirname, "..", "examples", "demo-app");
const plan = (flows, extra = {}) => ({ schema: DEMO_PLAN_SCHEMA, app: { url: "http://localhost:4310" }, flows, ...extra });
const flow = (id, steps) => ({ id, title: id, steps });

test("validateDemoPlan accepts a good plan and names each problem", () => {
  const good = plan([
    flow("create", [{ type: "goto", path: "/projects/new" }, { type: "type", text: "Project name", value: "Summer launch" }, { type: "click", text: "Create project", callout: "One click to track" }, { type: "wait-for", text: "Project created" }]),
    flow("sign-in", [{ type: "goto", path: "/login" }, { type: "type", selector: "#password", value: { account: "password" } }, { type: "pause", ms: 500 }])
  ]);
  assert.deepEqual(validateDemoPlan(good), { errors: [], warnings: [] });
  const bad = plan([
    flow("Bad Id", [{ type: "click", text: "Go" }]),
    flow("leak", [{ type: "goto", path: "https://evil.example.com/x" }, { type: "type", selector: "input[type=password]", value: "hunter22" }, { type: "hover", selector: "a" }, { type: "click" }, { type: "pause", ms: 20000 }])
  ], { schema: "nope" });
  const { errors } = validateDemoPlan(bad);
  for (const pattern of [/schema must be/, /flows\[0\]\.id must be lowercase/, /flows\[0\]\.steps\[0\] must be a goto/, /leaves the app/, /never type a literal into a password field/, /type must be one of/, /needs a selector or text/, /ms must be 0–10000/]) {
    assert.ok(errors.some((error) => pattern.test(error)), `${pattern} in ${errors.join(" | ")}`);
  }
  assert.match(validateDemoPlan(plan([flow("one", [{ type: "goto", path: "/" }])])).warnings.join(" "), /1 flow\(s\).*never clicks/);
});

test("validateDemoPlan checks app.fixtures, app.har and the off-origin allowlist", () => {
  const steps = [{ type: "goto", path: "/" }, { type: "click", text: "Go" }];
  const withApp = (app) => validateDemoPlan(plan([flow("one", steps), flow("two", steps)], { app: { url: "http://localhost:4310", ...app } })).errors;
  assert.deepEqual(withApp({ fixtures: "demo/fixtures.mjs", blockOffOrigin: true, allowOrigins: ["https://fonts.googleapis.com", "https://fonts.gstatic.com"] }), []);
  assert.deepEqual(withApp({ har: "demo/api.har" }), []);
  assert.deepEqual(withApp({ har: "demo/api.zip", fixtures: "fixtures.js", blockOffOrigin: false }), []);
  const errors = withApp({ fixtures: "https://cdn.example.com/fixtures.mjs", har: "api.json", blockOffOrigin: "yes", allowOrigins: ["https://fonts.gstatic.com/", "fonts.googleapis.com", "ftp://files.test"], extra: 1 });
  for (const pattern of [/app\.fixtures must be a local path to an ES module/, /app\.har must be a local path to a \.har or \.zip file/, /app\.blockOffOrigin must be true or false/, /"https:\/\/fonts\.gstatic\.com\/" must be an origin/, /"fonts\.googleapis\.com" must be an origin/, /"ftp:\/\/files\.test" must be an origin/, /app has unknown key "extra"/]) {
    assert.ok(errors.some((error) => pattern.test(error)), `${pattern} in ${errors.join(" | ")}`);
  }
  assert.match(withApp({ fixtures: "./fixtures.ts" }).join(" "), /app\.fixtures/);
  assert.match(withApp({ allowOrigins: "https://fonts.gstatic.com" }).join(" "), /must be an array/);
});

test("validateDemoPlan checks app.session: one form, test values only, local cookies", () => {
  const steps = [{ type: "goto", path: "/" }, { type: "click", text: "Go" }];
  const withSession = (session) => validateDemoPlan(plan([flow("one", steps), flow("two", steps)], { app: { url: "http://127.0.0.1:4173", session } })).errors;
  assert.deepEqual(withSession({ storageState: "demo/state.json" }), []);
  assert.deepEqual(withSession({ localStorage: { auth_token: "demo.eyJleHAiOjE4OTM0NTYwMDB9.signature", currentTeamId: "team-1" }, cookies: [{ name: "session", value: "demo-session" }, { name: "sso", value: "fake", domain: ".acme.test", path: "/", httpOnly: true }] }), []);
  assert.deepEqual(withSession({ cookies: [{ name: "s", value: "demo", url: "https://staging.acme.com" }] }), []);
  const real = withSession({ localStorage: { token: "sk_live_abcdef1234567890", user: { id: 1 } }, cookies: [{ name: "wos-session", value: "Fe26.2**Zx9Ky8Lw7Mv6Nu5Ot4Ps3Qr2aB1cD0eF9gH8iJ7kL6mN5oP4qR3sT2uV1wX0yZ**9" }, { name: "s", value: "demo", domain: ".acme.com" }, { name: "x", value: "demo", secret: true }, { value: "demo" }] });
  for (const pattern of [/localStorage\.token looks like a real API key/, /localStorage\.user must be a string/, /cookies\[0\] \(wos-session\) looks like a real session token/, /cookies\[1\] is for acme\.com, which looks like a production host/, /cookies\[2\] has unknown key "secret"/, /cookies\[3\] needs a string name and value/]) {
    assert.ok(real.some((error) => pattern.test(error)), `${pattern} in ${real.join(" | ")}`);
  }
  assert.match(withSession({ storageState: "state.json", localStorage: {} }).join(" "), /not both/);
  assert.match(withSession({ storageState: "https://x.test/state.json" }).join(" "), /local path to a Playwright storage state/);
  assert.match(withSession({}).join(" "), /needs storageState, localStorage or cookies/);
  assert.match(withSession({ localStorage: [], token: "x" }).join(" "), /unknown key "token"/);
});

test("rebasePlanPaths keeps fixtures and the HAR pointing at the same files from a copy", () => {
  const original = plan([], { app: { url: "http://localhost:4310", fixtures: "fixtures.mjs", har: "../recordings/api.har", session: { storageState: "state.json" } } });
  const copy = rebasePlanPaths(original, "/repo/demo", "/repo/assets/demo");
  assert.deepEqual(copy.app, { url: "http://localhost:4310", fixtures: "../../demo/fixtures.mjs", har: "../../recordings/api.har", session: { storageState: "../../demo/state.json" } });
  assert.equal(original.app.fixtures, "fixtures.mjs", "the original is untouched");
  assert.deepEqual(rebasePlanPaths(plan([]), "/a", "/b").app, { url: "http://localhost:4310" });
  assert.equal(rebasePlanPaths({ flows: [] }, "/a", "/b").app, undefined);
});

test("fileRoute maps file-based routing to paths", () => {
  assert.equal(fileRoute("app/page.tsx"), "/");
  assert.equal(fileRoute("src/app/(marketing)/pricing/page.tsx"), "/pricing");
  assert.equal(fileRoute("app/dashboard/settings/page.jsx"), "/dashboard/settings");
  assert.equal(fileRoute("pages/index.tsx"), "/");
  assert.equal(fileRoute("pages/billing/index.tsx"), "/billing");
  assert.equal(fileRoute("pages/_app.tsx"), null);
  assert.equal(fileRoute("src/routes/projects/+page.svelte"), "/projects");
  assert.equal(fileRoute("src/components/Button.tsx"), null);
});

test("discoverRoutes and heuristicPlan on the demo-app fixture", async () => {
  const { routes, nav } = await discoverRoutes(FIXTURE);
  assert.deepEqual(routes.map((entry) => entry.path), ["/", "/analytics", "/dashboard", "/login", "/projects/new"]);
  assert.deepEqual(nav.map((entry) => [entry.path, entry.label]), [["/analytics", "Analytics"], ["/dashboard", "Dashboard"], ["/projects/new", "New project"]]);
  const accounts = await findTestAccounts(FIXTURE, { env: {} });
  const result = heuristicPlan({ url: "http://localhost:4310", routes, nav, accounts });
  assert.deepEqual(result.flows.map((entry) => entry.id), ["sign-in", "analytics", "dashboard"]);
  assert.deepEqual(result.flows[0].steps[2], { type: "type", text: "Password", value: { account: "password" }, label: "Password", secret: true });
  assert.deepEqual(validateDemoPlan(result).errors, []);
  // No account: no sign-in flow.
  assert.ok(!heuristicPlan({ url: "http://localhost:4310", routes, nav, accounts: [] }).flows.some((entry) => entry.id === "sign-in"));
});

test("planDemo asks the model, repairs once, and falls back to the heuristic", async () => {
  const replies = [];
  const client = { runStructured: async (options) => { replies.push(options.input); return replies.length === 1 ? { text: JSON.stringify(plan([flow("x", [{ type: "click", text: "Go" }])])) } : { text: `\`\`\`json\n${JSON.stringify(plan([flow("create", [{ type: "goto", path: "/projects/new" }, { type: "click", text: "Create project" }]), flow("tour", [{ type: "goto", path: "/analytics" }, { type: "click", text: "Dashboard" }])], { app: { url: "http://localhost:4310", fixtures: "../../evil.mjs" } }))}\n\`\`\`` }; } };
  const result = await planDemo({ prompt: "Launch Pulseboard", repo: FIXTURE, url: "http://localhost:4310", client });
  assert.equal(result.source, "model");
  assert.deepEqual(result.plan.flows.map((entry) => entry.id), ["create", "tour"]);
  assert.equal(result.plan.viewport.width, 1920);
  assert.deepEqual(result.plan.app, { url: "http://localhost:4310" }, "a model never names fixtures, which are code that runs");
  assert.match(replies[0], /"\/projects\/new"/);
  assert.doesNotMatch(replies[0], /demo-pass-123/, "account values never reach the model");
  assert.match(replies[1], /must be a goto/);
  const broken = await planDemo({ repo: FIXTURE, url: "http://localhost:4310", client: { runStructured: async () => ({ text: "no idea" }) }, accounts: [] });
  assert.equal(broken.source, "heuristic");
  const none = await planDemo({ repo: FIXTURE, url: "http://localhost:4310" });
  assert.equal(none.source, "heuristic");
});

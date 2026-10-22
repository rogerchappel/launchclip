// Demo autopilot plans (src/demo/plan.js): validation, route discovery on the
// examples/demo-app fixture, the heuristic plan and the model planner loop.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { findTestAccounts } from "../src/demo/app.js";
import { DEMO_PLAN_SCHEMA, discoverRoutes, fileRoute, heuristicPlan, planDemo, validateDemoPlan } from "../src/demo/plan.js";

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
  const client = { runStructured: async (options) => { replies.push(options.input); return replies.length === 1 ? { text: JSON.stringify(plan([flow("x", [{ type: "click", text: "Go" }])])) } : { text: `\`\`\`json\n${JSON.stringify(plan([flow("create", [{ type: "goto", path: "/projects/new" }, { type: "click", text: "Create project" }]), flow("tour", [{ type: "goto", path: "/analytics" }, { type: "click", text: "Dashboard" }])]))}\n\`\`\`` }; } };
  const result = await planDemo({ prompt: "Launch Pulseboard", repo: FIXTURE, url: "http://localhost:4310", client });
  assert.equal(result.source, "model");
  assert.deepEqual(result.plan.flows.map((entry) => entry.id), ["create", "tour"]);
  assert.equal(result.plan.viewport.width, 1920);
  assert.match(replies[0], /"\/projects\/new"/);
  assert.doesNotMatch(replies[0], /demo-pass-123/, "account values never reach the model");
  assert.match(replies[1], /must be a goto/);
  const broken = await planDemo({ repo: FIXTURE, url: "http://localhost:4310", client: { runStructured: async () => ({ text: "no idea" }) }, accounts: [] });
  assert.equal(broken.source, "heuristic");
  const none = await planDemo({ repo: FIXTURE, url: "http://localhost:4310" });
  assert.equal(none.source, "heuristic");
});

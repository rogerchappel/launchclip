// Demo doctor (src/demo/doctor.js): the repo survey, the recipe checks and
// their fixes, the JSON report and the CLI. The browser checks run against
// examples/sso-app (SSO, no seed, fixtures) and examples/demo-app, and skip
// when no Chromium is available.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { checkRecipe, formatDoctor, similarity, surveyRepo } from "../src/demo/doctor.js";
import { waitForHealthy } from "../src/demo/app.js";
import { recorderAvailability } from "../src/demo/record.js";

const EXAMPLES = path.resolve(import.meta.dirname, "..", "examples");
const available = await recorderAvailability();
const needsBrowser = { skip: !available.ok && `recorder unavailable: ${available.reasons.join("; ")}`, timeout: 120000 };

async function freePort() {
  return new Promise((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

async function tempDir(t, prefix = "launchclip-doctor-") {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// A copy of examples/sso-app with its plan rewritten by `edit`, and the
// fixtures module by `fixtures` (text → text). → the plan path
async function ssoRecipe(t, { edit = (plan) => plan, fixtures = (text) => text } = {}) {
  const dir = await tempDir(t);
  await cp(path.join(EXAMPLES, "sso-app", "demo"), dir, { recursive: true });
  const plan = edit(JSON.parse(await readFile(path.join(dir, "DEMO-PLAN.json"), "utf8")));
  await writeFile(path.join(dir, "DEMO-PLAN.json"), JSON.stringify(plan, null, 2));
  await writeFile(path.join(dir, "fixtures.mjs"), fixtures(await readFile(path.join(dir, "fixtures.mjs"), "utf8")));
  return { plan: path.join(dir, "DEMO-PLAN.json"), dir };
}

const byId = (report, pattern) => report.checks.filter((check) => pattern.test(check.id));

test("survey: a seeded app with a test account needs a plan only", async () => {
  const report = await surveyRepo(path.join(EXAMPLES, "demo-app"));
  assert.equal(report.mode, "survey");
  assert.equal(report.rung, 1);
  assert.deepEqual(report.accounts, [{ email: "demo@pulseboard.test", source: "scripts/seed.js" }]);
  assert.deepEqual(report.app.seed, ["npm run seed"]);
  assert.equal(report.demo, "demo/DEMO-PLAN.json");
  assert.ok(!JSON.stringify(report).includes("demo-pass-123"), "account passwords never reach the report");
  assert.match(formatDoctor(report), /Rung 1: a seed script and a test account/);
});

test("survey: an SSO app with no seed gets fixtures and a session, reusing its e2e setup", async () => {
  const report = await surveyRepo(path.join(EXAMPLES, "sso-app"));
  assert.equal(report.rung, 3);
  assert.equal(report.app.start, "node server.js --port 4320");
  assert.equal(report.app.start_source, "playwright.config.ts");
  assert.ok(report.auth.some((entry) => entry.sso));
  assert.deepEqual(report.env, { api: ["PUBLIC_API_URL"], analytics: ["PUBLIC_ANALYTICS_KEY"] });
  assert.deepEqual(report.first_run.map((entry) => entry.flag), ["onboarding_completed"]);
  assert.deepEqual(report.reuse.map((entry) => entry.kind), ["server", "session", "fixtures"]);
  assert.deepEqual(report.e2e.initScripts, [{ file: "e2e/orders.spec.ts", localStorage: ["auth_token", "orderdesk-team"] }]);
});

test("survey: auth providers, MSW handlers, OpenAPI specs, HARs and docs placeholders", async (t) => {
  const repo = await tempDir(t);
  await writeFile(path.join(repo, "package.json"), JSON.stringify({ scripts: { dev: "vite", seed: "node seed.js" }, dependencies: { "@clerk/clerk-react": "5.0.0", vite: "6.0.0" }, devDependencies: { msw: "2.0.0" } }));
  await mkdir(path.join(repo, "src", "mocks"), { recursive: true });
  await writeFile(path.join(repo, "src", "mocks", "handlers.ts"), "import { http, HttpResponse } from 'msw';\nexport const handlers = [http.get('/api/projects', () => HttpResponse.json([]))];\n");
  await writeFile(path.join(repo, "openapi.yaml"), "openapi: 3.0.0\n");
  await writeFile(path.join(repo, "staging.har"), "{}");
  await mkdir(path.join(repo, "docs"), { recursive: true });
  await writeFile(path.join(repo, "docs", "guide.mdx"), "# Guide\n\n{/* video: create a project */}\n\n{/* screenshot: the dashboard */}\n");
  const report = await surveyRepo(repo);
  assert.deepEqual(report.auth.map((entry) => [entry.name, entry.sso]), [["Clerk", true]]);
  assert.equal(report.rung, 2, "seeded, but SSO with no test account");
  assert.deepEqual(report.msw, ["src/mocks/handlers.ts"]);
  assert.deepEqual(report.contracts, [{ file: "openapi.yaml", kind: "openapi" }]);
  assert.deepEqual(report.har, ["staging.har"]);
  assert.deepEqual(report.shots, { videos: 1, screenshots: 1, files: ["docs/guide.mdx"] });
  assert.deepEqual(report.reuse.map((entry) => entry.what), ["MSW handlers", "an OpenAPI spec", "a HAR (scrub it before use)"]);
});

test("similarity ranks near misses above unrelated labels", () => {
  assert.equal(similarity("Analytics", "analytics"), 1);
  assert.ok(similarity("Activaton", "Activation") > 0.7);
  assert.ok(similarity("Create project", "New project") > similarity("Create project", "Sign out"));
});

test("check: an invalid plan or a production URL fails before anything runs", async (t) => {
  const { plan } = await ssoRecipe(t, { edit: (value) => ({ ...value, flows: [{ id: "Bad Id", title: "x", steps: [{ type: "click", text: "Go" }] }] }) });
  const ask = async () => { throw new Error("should not ask"); };
  const invalid = await checkRecipe(path.join(EXAMPLES, "sso-app"), { plan }, { ask });
  assert.equal(invalid.ok, false);
  assert.ok(byId(invalid, /^plan\.valid$/).some((check) => check.status === "fail" && /lowercase/.test(check.message)));
  assert.ok(!invalid.checks.some((check) => check.id === "app.reachable"));
  const { plan: prod } = await ssoRecipe(t);
  const production = await checkRecipe(path.join(EXAMPLES, "sso-app"), { plan: prod, url: "https://app.orderdesk.com" }, { ask });
  assert.equal(byId(production, /^url\.safe$/)[0].status, "fail");
  assert.match(byId(production, /^url\.safe$/)[0].fix, /never record production/);
});

test("check: asks before importing the fixtures module and starting the app", async (t) => {
  const { plan } = await ssoRecipe(t);
  const asked = [];
  await assert.rejects(
    checkRecipe(path.join(EXAMPLES, "sso-app"), { plan, url: "http://localhost:9" }, { log: (line) => asked.push(line), ask: async () => false }),
    /not approved: demo doctor runs `npm run dev` and `.*fixtures\.mjs \(the plan's fixtures module\)`/
  );
  assert.match(asked.join("\n"), /start npm run dev\n {2}code {2}.*fixtures\.mjs/);
});

test("check: a HAR with credentials fails files.har with the entries to scrub", async (t) => {
  const { plan, dir } = await ssoRecipe(t, { edit: (value) => ({ ...value, app: { ...value.app, har: "staging.har" } }) });
  await writeFile(path.join(dir, "staging.har"), JSON.stringify({ log: { entries: [{ request: { url: "https://staging.orderdesk.example/api/me", headers: [{ name: "Cookie", value: "sid=1" }] }, response: { headers: [], content: { text: "{}" } } }] } }));
  const report = await checkRecipe(path.join(EXAMPLES, "sso-app"), { plan, url: "http://localhost:9", approve: true, "no-start": true });
  const [har] = byId(report, /^files\.har$/);
  assert.equal(har.status, "fail");
  assert.match(har.message, /entry 0 .*request header Cookie; remove it/);
  assert.ok(!report.checks.some((check) => /^flow\./.test(check.id)), "no flow runs with a bad recipe file");
});

test("check: the SSO example passes, with a ledger of fixture answers and blocked analytics", needsBrowser, async (t) => {
  const { url } = await ssoServer(t);
  const report = await checkRecipe(path.join(EXAMPLES, "sso-app"), { plan: path.join(EXAMPLES, "sso-app", "demo", "DEMO-PLAN.json"), url, approve: true, "no-start": true });
  assert.equal(report.ok, true, formatDoctor(report));
  assert.equal(report.schema, "launchclip.demo-doctor.v1");
  assert.deepEqual(report.flows.map((flow) => [flow.id, flow.ok, flow.reached]), [["ship-an-order", true, 7], ["shipped-orders", true, 6]]);
  const ledger = report.flows[0].ledger;
  assert.ok(ledger.some((entry) => entry.url === "http://localhost:4321/api/me" && entry.how === "fixture" && entry.status === 200), JSON.stringify(ledger));
  assert.ok(ledger.some((entry) => entry.method === "PUT" && /\/orders\/1042\/ship$/.test(entry.url) && entry.how === "fixture"));
  assert.ok(ledger.some((entry) => entry.how === "blocked" && /orderdesk-analytics/.test(entry.url)));
  assert.match(byId(report, /network\.offorigin/)[0].message, /as intended/);
  assert.match(report.next, /^launchclip demo record .*--plan .*--url http:\/\/localhost:\d+ --no-start --approve$/);
  for (const check of report.checks) for (const key of ["id", "status", "message"]) assert.ok(check[key], `${check.id} has ${key}`);
});

test("check: a flow with no session lands on SSO and is told to add app.session", needsBrowser, async (t) => {
  const { url } = await ssoServer(t);
  const { plan } = await ssoRecipe(t, { edit: (value) => { delete value.app.session; value.flows = value.flows.slice(0, 1); return value; } });
  const report = await checkRecipe(path.join(EXAMPLES, "sso-app"), { plan, url, approve: true, "no-start": true });
  const [signin] = byId(report, /signin$/);
  assert.equal(signin.status, "fail");
  assert.match(signin.message, /tried to go to https:\/\/auth\.orderdesk-idp\.example/);
  assert.match(signin.fix, /^add app\.session/);
  assert.ok(!byId(report, /step\.\d+$/).length, "the flow stops at the sign-in failure");
});

test("check: a session the server rejects is reported as rejected, with the 401", needsBrowser, async (t) => {
  const { url } = await ssoServer(t);
  const { plan } = await ssoRecipe(t, {
    edit: (value) => ({ ...value, flows: value.flows.slice(1) }),
    fixtures: (text) => text.replace('if (path === "/me") return { json:', 'if (path === "/me") return { status: 401, json:')
  });
  const report = await checkRecipe(path.join(EXAMPLES, "sso-app"), { plan, url, approve: true, "no-start": true });
  const [signin] = byId(report, /signin$/);
  assert.match(signin.fix, /^the server rejected the session \(GET http:\/\/localhost:4321\/api\/me → 401\)/);
  assert.match(signin.fix, /reuse the repo's e2e sign-in/);
});

test("check: a wrong text names the closest visible targets; an overlay is reported with its text", needsBrowser, async (t) => {
  const { url } = await ssoServer(t);
  const { plan } = await ssoRecipe(t, {
    edit: (value) => {
      value.flows[0].steps[3].text = "Harbour & Pine";
      value.flows = value.flows.slice(0, 1);
      return value;
    }
  });
  const out = await tempDir(t);
  const report = await checkRecipe(path.join(EXAMPLES, "sso-app"), { plan, url, approve: true, "no-start": true, out, "step-timeout": 1500 });
  const [step] = byId(report, /step\.3$/);
  assert.equal(step.status, "fail");
  assert.equal(step.evidence.closest[0].text, "Harbor & Pine");
  assert.match(step.fix, /closest on the page: "Harbor & Pine"/);
  assert.equal(step.evidence.screenshot, path.join(out, "ship-an-order-step3.png"));
  await readFile(step.evidence.screenshot);

  const { plan: welcome } = await ssoRecipe(t, {
    edit: (value) => ({ ...value, flows: value.flows.slice(1) }),
    fixtures: (text) => text.replace("onboarding_completed: true } };", "onboarding_completed: false } };")
  });
  const covered = await checkRecipe(path.join(EXAMPLES, "sso-app"), { plan: welcome, url, approve: true, "no-start": true, out, "step-timeout": 1500 });
  const [overlay] = byId(covered, /overlay$/);
  assert.equal(overlay.status, "warn");
  assert.match(overlay.message, /dialog covers the page at the start: "Welcome to Orderdesk/);
  assert.match(byId(covered, /step\.3$/)[0].fix, /answer its first-run flag as done/);
});

test("check: requests that would leave the app fail, ambiguous steps and missing fixtures warn", needsBrowser, async (t) => {
  const { url } = await ssoServer(t);
  const { plan } = await ssoRecipe(t, {
    edit: (value) => {
      value.app.blockOffOrigin = false;
      value.flows = [{ id: "customers", title: "Customers", steps: [
        { type: "goto", path: "/#orders" },
        { type: "wait-for", text: "Harbor & Pine" },
        { type: "click", selector: "tbody td" },
        { type: "click", selector: "[role=dialog] #close" },
        { type: "click", text: "Customers" },
        { type: "pause", ms: 300 }
      ] }];
      return value;
    },
    fixtures: (text) => text.replace('if (path === "/customers")', "if (false)")
  });
  const report = await checkRecipe(path.join(EXAMPLES, "sso-app"), { plan, url, approve: true, "no-start": true });
  const [offorigin] = byId(report, /network\.offorigin$/);
  assert.equal(offorigin.status, "fail");
  assert.match(offorigin.message, /https:\/\/events\.orderdesk-analytics\.example would leave the app when recording/);
  assert.match(offorigin.fix, /set app\.blockOffOrigin: true/);
  const [ambiguous] = byId(report, /step\.2\.ambiguous$/);
  assert.match(ambiguous.message, /matched \d+ visible elements/);
  const [unanswered] = byId(report, /network\.unanswered$/);
  assert.match(unanswered.message, /GET http:\/\/localhost:4321\/api\/customers: your fixture answered 404/);
  assert.equal(report.ok, false);
});

test("CLI: demo doctor prints the survey, and --json reports a failing check with exit 1", async (t) => {
  const out = [];
  await runCli(["demo", "doctor", path.join(EXAMPLES, "demo-app")], { stdout: { write: (value) => out.push(value) }, stderr: { write: () => {} } });
  assert.match(out.join(""), /demo doctor: survey of .*demo-app[\s\S]*Rung 1/);
  const { plan } = await ssoRecipe(t);
  const json = [];
  await assert.rejects(
    runCli(["demo", "doctor", path.join(EXAMPLES, "sso-app"), "--plan", plan, "--url", "https://app.orderdesk.com", "--json"], { stdout: { write: (value) => json.push(value) }, stderr: { write: () => {} } }),
    /launchclip demo doctor: 1 check\(s\) failed/
  );
  const report = JSON.parse(json.join(""));
  assert.equal(report.ok, false);
  assert.deepEqual(report.checks.map((check) => [check.id, check.status]), [["plan.valid", "pass"], ["url.safe", "fail"]]);
});

// The static Orderdesk server on a free port, stopped after the test.
async function ssoServer(t) {
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js", "--port", String(port)], { cwd: path.join(EXAMPLES, "sso-app"), stdio: "ignore" });
  t.after(() => child.kill());
  const url = `http://localhost:${port}`;
  const health = await waitForHealthy(`http://127.0.0.1:${port}`, { timeout: 10000 });
  assert.ok(health.ok, health.error);
  return { url };
}

// `launchclip demo doctor <repo> [--plan demo/DEMO-PLAN.json]`: tell the agent
// setting up a demo recipe what the repo has and what is wrong with the
// recipe, as checks it can act on (docs/DEMO_SETUP.md).
//
// Without --plan it surveys the repo (reads files, runs nothing): how the app
// starts and seeds, test accounts, auth providers, e2e route mocks and
// sign-ins, MSW handlers, API contracts, HARs, env vars that matter for a demo
// build, first-run UI flags and docs placeholders, then recommends the
// cheapest setup rung:
//   1  seed script and password login: a plan only
//   2  SSO: a test session (app.session)
//   3  no seed data or external APIs: fixtures (app.fixtures or app.har)
//   production is refused (guardrails.js)
//
// With --plan it checks the recipe against the running app: the plan
// validates, its files load (the fixtures module, a scrubbed HAR, the
// session), the app answers, and each flow runs at full speed with no
// screencast, step by step: every selector or text resolves to a visible
// element, nothing covers the page, the flow doesn't land on a sign-in page,
// the app's API requests are answered, and no request would leave the app's
// origin when recording. Off-origin requests are always blocked during a
// doctor run, whatever the plan says. Starting the app, seeding it and
// importing the fixtures module need consent (--approve), as for `record`.
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { askConsent, askYesNo, autopilotPreview, fixturesConsent } from "./autopilot.js";
import { detectApp, findTestAccounts, runCommand, startApp, waitForHealthy } from "./app.js";
import { assertSafeUrl, classifyHost, redactSecrets, redactWith } from "./guardrails.js";
import { DEFAULT_VIEWPORT, validateDemoPlan } from "./plan.js";
import { blocksOffOrigin, loadFixtures, locate, matches, prepareContext, readScrubbedHar, recorderAvailability, sessionState } from "./record.js";
import { findShots } from "./shots.js";

export const DOCTOR_SCHEMA = "launchclip.demo-doctor.v1";

const list = (value) => (value === undefined || value === true ? [] : String(value).split(",").map((item) => item.trim()).filter(Boolean));

// ---------------------------------------------------------------------------
// Survey (reads files only)

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".turbo", "coverage", ".launchclip", "vendor", ".vercel", ".output"]);
const SOURCE = /\.(m?[jt]sx?|vue|svelte|astro)$/;

async function walk(root, dir = "", depth = 0, out = []) {
  if (depth > 7 || out.length > 6000) return out;
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true }).catch(() => [])) {
    if (SKIP_DIRS.has(entry.name) || (entry.name.startsWith(".") && entry.name !== ".env.example")) continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(root, rel, depth + 1, out);
    else out.push(rel);
  }
  return out;
}

// [dependency prefix, name, hosted SSO?]
const AUTH_PROVIDERS = [
  ["@workos-inc/", "WorkOS", true], ["@auth0/", "Auth0", true], ["@clerk/", "Clerk", true], ["@okta/", "Okta", true],
  ["@azure/msal-", "Microsoft Entra ID", true], ["@kinde-oss/", "Kinde", true], ["@stytch/", "Stytch", true], ["firebase", "Firebase Auth", true],
  ["next-auth", "NextAuth", false], ["@auth/", "Auth.js", false], ["@supabase/supabase-js", "Supabase", false], ["better-auth", "Better Auth", false],
  ["passport-saml", "SAML (passport)", true], ["@node-saml/", "SAML", true], ["lucia", "Lucia", false]
];
const SSO_REDIRECT = /\b(?:api\.workos\.com|[a-z0-9-]+\.auth0\.com|clerk\.[a-z0-9.-]+|[a-z0-9-]+\.okta\.com|login\.microsoftonline\.com|accounts\.google\.com\/o\/oauth2)|\/oauth2?\/authorize\b|\/sso\/authorize\b/i;
const API_ENV = /(^|_)(API|BACKEND|SERVER|GRAPHQL)(_BASE)?_(URL|ORIGIN|HOST|ENDPOINT)$/;
const ANALYTICS_ENV = /POSTHOG|SENTRY|SEGMENT|MIXPANEL|AMPLITUDE|(^|_)GA_|GTAG|(^|_)GTM|DATADOG|INTERCOM|HOTJAR|(^|_)HEAP|LOGROCKET|FULLSTORY|PLAUSIBLE|BUGSNAG|ROLLBAR|HONEYBADGER|CRISP|HUBSPOT/;
const FIRST_RUN = /["'`]([A-Za-z_][A-Za-z0-9_-]*?(?:tour|onboarding|wizard|walkthrough|welcome|getting[_-]?started)[A-Za-z0-9_-]*?(?:completed|complete|dismissed|seen|done|shown|finished|skipped))["'`]/gi;

async function readText(file, limit = 400_000) {
  try {
    const text = await readFile(file, "utf8");
    return text.length > limit ? null : text;
  } catch { return null; }
}

function webServer(text) {
  const block = /webServer\s*:\s*[[{]([\s\S]{0,1500})/.exec(text)?.[1];
  if (!block) return null;
  const command = /command\s*:\s*["'`]([^"'`]+)["'`]/.exec(block)?.[1];
  if (!command) return null;
  const url = /\burl\s*:\s*["'`](https?:\/\/[^"'`]+)["'`]/.exec(block)?.[1] ?? null;
  const port = Number(/\bport\s*:\s*(\d{2,5})/.exec(block)?.[1]) || null;
  return { command, url: url ?? (port ? `http://localhost:${port}` : null) };
}

const push = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };

/**
 * What a repo has that decides its demo setup. Reads files only.
 * → {repo, app: {start, seed, url}, accounts, auth, e2e, msw, contracts, har,
 *    env, firstRun, shots, demo, rung, reasons, reuse, next}
 */
export async function surveyRepo(repoPath) {
  const repo = path.resolve(repoPath);
  const files = await walk(repo);
  const app = await detectApp(repo);
  const accounts = await findTestAccounts(repo);
  let pkg = {};
  try { pkg = JSON.parse(await readFile(path.join(repo, "package.json"), "utf8")); } catch { pkg = {}; }
  const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });

  const auth = [];
  for (const [prefix, name, sso] of AUTH_PROVIDERS) {
    const dep = deps.find((entry) => entry === prefix || entry.startsWith(prefix));
    if (dep) auth.push({ name, sso, source: `package.json ${dep}` });
  }
  const e2e = { webServer: null, routeMocks: [], initScripts: [], storageStates: [] };
  const msw = [], contracts = [], hars = [], ssoRedirects = [];
  const envNames = new Set(app.env.keys);
  const firstRun = new Map();
  for (const rel of files) {
    if (/\.har$/i.test(rel)) { hars.push(rel); continue; }
    if (/(^|\/)(openapi|swagger)[^/]*\.(json|ya?ml)$/i.test(rel)) { contracts.push({ file: rel, kind: "openapi" }); continue; }
    if (!SOURCE.test(rel)) continue;
    const text = await readText(path.join(repo, rel));
    if (!text) continue;
    if (/(^|\/)playwright\.config\.m?[jt]s$/.test(rel)) e2e.webServer ??= (webServer(text) && { ...webServer(text), source: rel });
    const spec = /\.(spec|test|e2e)\.[jt]sx?$/.test(rel) || /(^|\/)(e2e|tests?|playwright)\//.test(rel);
    if (spec) {
      const mocks = (text.match(/\b(?:page|context)\.route\(/g) ?? []).length;
      if (mocks) e2e.routeMocks.push({ file: rel, routes: mocks });
      if (/addInitScript/.test(text)) {
        const keys = [...new Set([...text.matchAll(/localStorage\.setItem\(\s*["'`]([^"'`]+)["'`]/g)].map((match) => match[1]))];
        if (keys.length) e2e.initScripts.push({ file: rel, localStorage: keys });
      }
      for (const match of text.matchAll(/storageState\s*:\s*["'`]([^"'`]+\.json)["'`]/g)) e2e.storageStates.push({ file: rel, path: match[1] });
    }
    if (/from\s+["']msw["']|require\(["']msw["']\)/.test(text) && /\b(?:http|rest|graphql)\.(?:get|post|put|patch|delete|all|query|mutation)\(/.test(text)) msw.push(rel);
    if (/(^|\/)(api[-_]?client|api[-_]?types|contracts?|api\/types)\.ts$/i.test(rel) || /(^|\/)types\/(src\/)?api\//.test(rel)) contracts.push({ file: rel, kind: "typed client or contract" });
    if (!spec && SSO_REDIRECT.test(text)) ssoRedirects.push(rel);
    for (const match of text.matchAll(/(?:import\.meta\.env|process\.env)\.([A-Z][A-Z0-9_]+)/g)) envNames.add(match[1]);
    if (!spec) for (const match of text.matchAll(FIRST_RUN)) push(firstRun, match[1], rel);
  }
  if (ssoRedirects.length && !auth.some((entry) => entry.sso)) auth.push({ name: "an SSO redirect in the code", sso: true, source: ssoRedirects[0] });
  const env = {
    api: [...envNames].filter((name) => API_ENV.test(name)).sort(),
    analytics: [...envNames].filter((name) => ANALYTICS_ENV.test(name)).sort()
  };
  let shots = [];
  try { shots = await findShots(repo); } catch { shots = []; }
  const demoPlan = ["demo/DEMO-PLAN.json", "DEMO-PLAN.json"].find((rel) => existsSync(path.join(repo, rel))) ?? null;

  // The cheapest rung that works.
  const sso = auth.some((entry) => entry.sso);
  const hasSeed = app.seed.length > 0;
  const reasons = [];
  let rung = 1;
  if (!hasSeed) { rung = 3; reasons.push("no seed script, so the app's data has to come from fixtures (or a scrubbed HAR)"); }
  if (sso && !accounts.length) { rung = Math.max(rung, 2); reasons.push(`it signs in through ${auth.filter((entry) => entry.sso).map((entry) => entry.name).join(", ")}, so flows start from a test session (app.session)`); }
  else if (auth.length && !accounts.length) { rung = Math.max(rung, 2); reasons.push(`no test account in the seed data for ${auth[0].name}; use a test session, or set LAUNCHCLIP_DEMO_EMAIL / LAUNCHCLIP_DEMO_PASSWORD for a local test user`); }
  if (rung === 1) reasons.push(accounts.length ? "a seed script and a test account: a plan is enough" : "a seed script and no sign-in: a plan is enough");
  if (env.api.length && rung === 3) reasons.push(`the API is reached through ${env.api.join(", ")}: point it at an origin where nothing runs and answer it from fixtures`);

  // What to reuse before writing anything new, cheapest first.
  const reuse = [];
  if (e2e.webServer) reuse.push({ kind: "server", what: `the e2e server command \`${e2e.webServer.command}\``, source: e2e.webServer.source });
  for (const entry of e2e.initScripts) reuse.push({ kind: "session", what: `the e2e sign-in (localStorage ${entry.localStorage.join(", ")})`, source: entry.file });
  for (const entry of e2e.storageStates) reuse.push({ kind: "session", what: `the e2e storage state ${entry.path}`, source: entry.file });
  for (const entry of e2e.routeMocks) reuse.push({ kind: "fixtures", what: `${entry.routes} Playwright route mock(s)`, source: entry.file });
  for (const file of msw) reuse.push({ kind: "fixtures", what: "MSW handlers", source: file });
  for (const entry of contracts) reuse.push({ kind: "fixtures", what: entry.kind === "openapi" ? "an OpenAPI spec" : "typed API contracts", source: entry.file });
  for (const file of hars) reuse.push({ kind: "fixtures", what: "a HAR (scrub it before use)", source: file });

  const rel = (file) => relPath(path.join(repo, file));
  const next = demoPlan
    ? `launchclip demo doctor ${rel(".")} --plan ${rel(demoPlan)}`
    : `write ${rel("demo/DEMO-PLAN.json")}${rung >= 3 ? " and demo/fixtures.mjs" : ""}${rung >= 2 ? " with app.session" : ""}, then run launchclip demo doctor ${rel(".")} --plan ${rel("demo/DEMO-PLAN.json")}`;
  return {
    schema: DOCTOR_SCHEMA,
    mode: "survey",
    repo,
    app: { start: e2e.webServer?.command ?? app.recommended?.command ?? null, start_source: e2e.webServer ? e2e.webServer.source : app.recommended?.source ?? null, url: e2e.webServer?.url ?? app.recommended?.url ?? null, seed: app.seed.map((entry) => entry.command), notes: app.notes },
    accounts: accounts.map(({ email, source }) => ({ email, source })),
    auth,
    e2e,
    msw,
    contracts,
    har: hars,
    env,
    first_run: [...firstRun.entries()].slice(0, 12).map(([flag, sources]) => ({ flag, source: sources[0] })),
    shots: { videos: shots.filter((shot) => shot.kind === "video").length, screenshots: shots.filter((shot) => shot.kind === "screenshot").length, files: [...new Set(shots.map((shot) => shot.file))].slice(0, 20) },
    demo: demoPlan,
    rung,
    reasons,
    reuse,
    ok: true,
    next
  };
}

// ---------------------------------------------------------------------------
// Check (runs the recipe against the app)

const AUTH_PATH = /\/(login|log-in|signin|sign-in|auth|sso|oauth2?)(\/|$|\?|#)/i;
const ASSET_HOST = /(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|rsms\.me)$/;
const API_TYPES = new Set(["fetch", "xhr", "eventsource", "websocket", "document", "other"]);

// Text a step looks for, also from a selector (has-text("…"), aria-label="…", text=…).
function wantedText(step) {
  if (step.text) return step.text;
  const selector = String(step.selector ?? "");
  return /has-text\(\s*["']([^"']+)["']/.exec(selector)?.[1] ?? /aria-label\s*[*^$~|]?=\s*["']([^"']+)["']/.exec(selector)?.[1] ?? /text\s*=\s*["']?([^"'\]]+)/.exec(selector)?.[1] ?? null;
}

const norm = (text) => String(text).toLowerCase().replace(/\s+/g, " ").trim();
function bigrams(text) {
  const out = new Map();
  for (let i = 0; i < text.length - 1; i++) out.set(text.slice(i, i + 2), (out.get(text.slice(i, i + 2)) ?? 0) + 1);
  return out;
}

/** Similarity of two labels, 0–1 (substring 0.9, else bigram Dice). */
export function similarity(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const ax = bigrams(x), by = bigrams(y);
  let shared = 0;
  for (const [gram, n] of ax) shared += Math.min(n, by.get(gram) ?? 0);
  const total = Math.max(1, x.length - 1 + y.length - 1);
  return (2 * shared) / total;
}

/** Visible, named things on the page a step could target: [{role, text}]. */
async function pageTargets(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const out = [];
    const add = (role, text) => {
      const value = String(text ?? "").replace(/\s+/g, " ").trim();
      if (value && value.length <= 80 && !out.some((entry) => entry.role === role && entry.text === value)) out.push({ role, text: value });
    };
    for (const el of document.querySelectorAll("button, [role=button], a[href], [role=link], [role=tab], [role=option], [role=menuitem], summary")) if (visible(el)) add(el.getAttribute("role") ?? el.tagName.toLowerCase(), el.getAttribute("aria-label") || el.innerText);
    for (const el of document.querySelectorAll("label")) if (visible(el)) add("label", el.innerText);
    for (const el of document.querySelectorAll("input[placeholder], textarea[placeholder]")) if (visible(el)) add("placeholder", el.getAttribute("placeholder"));
    for (const el of document.querySelectorAll("[aria-label]")) if (visible(el)) add("aria-label", el.getAttribute("aria-label"));
    for (const el of document.querySelectorAll("h1, h2, h3, [role=heading]")) if (visible(el)) add("heading", el.innerText);
    return out.slice(0, 400);
  });
}

/** Dialogs, tours and backdrops covering the page: [{kind, text}]. */
export async function overlays(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
    };
    const text = (el) => String(el.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    const out = [];
    const seen = new Set();
    const add = (kind, el) => { if (!seen.has(el) && visible(el)) { seen.add(el); out.push({ kind, text: text(el) }); } };
    for (const el of document.querySelectorAll("[role=dialog], [role=alertdialog], [aria-modal=true], dialog[open]")) add("dialog", el);
    for (const el of document.querySelectorAll(".shepherd-element, .introjs-tooltip, .driver-popover, .reactour__popover, [class*=joyride], [data-tour-step], [class*=tour-popover]")) add("tour", el);
    // A fixed, semi-transparent layer over most of the viewport is a backdrop.
    const area = innerWidth * innerHeight;
    for (const el of document.body ? document.body.querySelectorAll("*") : []) {
      if (el.id === "__lc_cursor" || el.classList.contains("__lc_ripple")) continue;
      const style = getComputedStyle(el);
      if (style.position !== "fixed") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width * rect.height < area * 0.6) continue;
      const alpha = /rgba?\([^)]*,\s*([\d.]+)\)$/.exec(style.backgroundColor)?.[1];
      if (alpha !== undefined && Number(alpha) > 0.05 && Number(alpha) < 0.95 && !out.length) add("backdrop", el);
    }
    return out.filter((entry) => entry.kind !== "backdrop" || out.length === 1).slice(0, 5);
  });
}

const short = (url) => {
  try { const parsed = new URL(url); return `${parsed.origin}${parsed.pathname}`.slice(0, 160); } catch { return String(url).slice(0, 160); }
};

/** Read and validate a plan file. → {plan, planDir, errors, warnings} */
async function loadPlan(file) {
  let plan;
  try { plan = JSON.parse(await readFile(file, "utf8")); } catch (error) { return { plan: null, planDir: path.dirname(file), errors: [`${file} is not readable JSON: ${error.message}`], warnings: [] }; }
  return { plan, planDir: path.dirname(file), ...validateDemoPlan(plan) };
}

/**
 * Check a recipe against the running app. Options: plan (path, required),
 * url, start, seed, no-start, no-seed, approve, allow-host, flows, out (where
 * failure screenshots go), step-timeout (ms), timeout (app start, ms).
 * → the report {schema, mode: "check", ok, checks, flows, summary, next}
 */
export async function checkRecipe(repoPath, flags = {}, { log = () => {}, ask = askYesNo } = {}) {
  const repo = path.resolve(repoPath);
  const planFile = path.resolve(flags.plan);
  const out = path.resolve(flags.out ?? path.join(".launchclip", "doctor"));
  const allowHosts = list(flags["allow-host"]);
  const stepTimeout = Number(flags["step-timeout"] ?? 5000);
  const checks = [];
  const add = (id, status, message, extra = {}) => { const check = { id, status, message, ...extra }; checks.push(check); return check; };
  const flowsReport = [];
  const report = () => finish({ repo, planFile, checks, flows: flowsReport, url, flags });

  // 1. The plan.
  const { plan, planDir, errors, warnings } = await loadPlan(planFile);
  for (const error of errors) add("plan.valid", "fail", error, { fix: "fix the plan file; the message names the field" });
  for (const warning of warnings) add("plan.valid", "warn", warning);
  if (!errors.length) add("plan.valid", "pass", `${plan.flows.length} flow(s) validate`);
  const preview = await autopilotPreview(repo, flags);
  let url = typeof flags.url === "string" ? flags.url : plan?.app?.url ?? preview.url;
  if (!plan || errors.length) return report();

  // 2. Where it points.
  if (!url) { add("url.safe", "fail", "no app URL", { fix: "set app.url in the plan, or pass --url http://localhost:<port>" }); return report(); }
  try {
    const kind = assertSafeUrl(url, { allowHosts });
    add("url.safe", "pass", `${url} is a ${kind} host`);
  } catch (error) {
    add("url.safe", "fail", error.message, { fix: "point app.url (or --url) at a local or staging copy of the app; demo recipes never record production" });
    return report();
  }

  // 3. Consent for anything that runs code from the repo.
  const start = flags["no-start"] ? null : (typeof flags.start === "string" ? flags.start : preview.start);
  const seed = flags["no-seed"] ? null : (typeof flags.seed === "string" ? flags.seed : preview.seed);
  const items = [seed && ["seed", seed], start && ["start", start], fixturesConsent(plan, planDir)].filter(Boolean);
  await askConsent(items, { repo, url, approve: Boolean(flags.approve), ask, log, tool: "demo doctor" });

  // 4. The recipe's files.
  const app = plan.app ?? {};
  let filesOk = true;
  if (app.fixtures) {
    const file = path.resolve(planDir, app.fixtures);
    try { await loadFixtures(file); add("files.fixtures", "pass", `${app.fixtures} exports route()`); }
    catch (error) { filesOk = false; add("files.fixtures", "fail", `${app.fixtures}: ${error.message.split("\n")[0]}`, { fix: existsSync(file) ? "export function route({ request, url, method, body }) from the module, and make sure it imports without errors" : `create ${file}, or fix app.fixtures (it is relative to the plan file)` }); }
  }
  if (app.har) {
    try {
      const har = await readScrubbedHar(path.resolve(planDir, app.har));
      add("files.har", har ? "pass" : "warn", har ? `${app.har}: ${har.log.entries.length} entries, scrubbed` : `${app.har} is zipped, so it can't be checked for credentials`, har ? {} : { fix: "save the HAR as a plain .har so doctor can check it" });
    } catch (error) { filesOk = false; add("files.har", "fail", error.message, { fix: "remove credential headers and cookies, replace tokens and real email addresses with fake ones, then run doctor again" }); }
  }
  if (app.session) {
    try {
      const state = await sessionState(app.session, { url, planDir });
      add("files.session", "pass", `session: ${state.cookies.length} cookie(s), ${state.origins.reduce((sum, entry) => sum + entry.localStorage.length, 0)} localStorage value(s), all test values`);
    } catch (error) { filesOk = false; add("files.session", "fail", error.message, { fix: "use made-up values (an unsigned token such as demo.<payload>.signature) and answer them from fixtures; never copy a session from a real browser" }); }
  }

  // 5. The recorder and the app.
  const available = await recorderAvailability({ repo });
  if (!available.chromium || !available.executablePath) {
    add("recorder", "fail", available.reasons.join("; "), { fix: "npm install playwright (or use the repo's @playwright/test), then npx playwright install chromium" });
    return report();
  }
  add("recorder", available.ffmpeg ? "pass" : "warn", available.ffmpeg ? `Chromium at ${available.executablePath}` : "Chromium found, but ffmpeg is not on PATH (doctor doesn't need it; record does)", available.ffmpeg ? {} : { fix: "install ffmpeg before recording" });
  if (!filesOk) { add("flows", "skip", "skipped: fix the recipe's files first"); return report(); }

  let server = null;
  try {
    if (seed) {
      const result = await runCommand(seed, { cwd: repo });
      if (result.code !== 0) { add("app.seed", "fail", `\`${result.command}\` exited ${result.code}`, { evidence: result.output.slice(-3000), fix: "fix the seed script, or pass --no-seed for a recipe that doesn't need one" }); return report(); }
      add("app.seed", "pass", `\`${result.command}\` ran`);
    }
    if (start) {
      try { server = await startApp({ command: start, cwd: repo, url, allowHosts, timeout: Number(flags.timeout ?? 90000), log }); add("app.reachable", "pass", `started \`${redactSecrets(start)}\`; ${url} answers`); }
      catch (error) {
        const [message, output = ""] = error.message.split("\n--- app output (redacted) ---\n");
        add("app.reachable", "fail", `\`${redactSecrets(start)}\` didn't serve ${url}: ${message}`, { evidence: output, fix: "read the app output in evidence; fix the build or pass the right --start and --url (a production build with `preview` and the API pointed at a mocked origin is a good demo server)" });
        return report();
      }
    } else {
      const health = await waitForHealthy(url, { timeout: 5000 });
      if (!health.ok) { add("app.reachable", "fail", health.error, { fix: `start the app first, or drop --no-start so doctor starts it` }); return report(); }
      add("app.reachable", "pass", `${url} answers (HTTP ${health.status})`);
    }

    // 6. Each flow, for real, at full speed.
    const accounts = await findTestAccounts(repo);
    const account = accounts[0] ? { email: accounts[0].email, password: accounts[0].password, username: accounts[0].email.split("@")[0] } : null;
    const viewport = { ...DEFAULT_VIEWPORT, ...(plan.viewport ?? {}) };
    const only = list(flags.flows);
    const browser = await available.chromium.launch({ executablePath: available.executablePath, headless: !flags.headed, args: ["--hide-scrollbars", "--no-first-run", "--no-default-browser-check"] });
    try {
      for (const flow of plan.flows) {
        if (only.length && !only.includes(flow.id)) continue;
        flowsReport.push(await checkFlow(browser, flow, { plan, planDir, url, out, viewport, account, allowHosts, stepTimeout, add, log }));
      }
    } finally {
      await browser.close().catch(() => {});
    }
  } finally {
    if (server) await server.stop();
  }
  return report();
}

async function checkFlow(browser, flow, { plan, planDir, url, out, viewport, account, allowHosts, stepTimeout, add, log }) {
  const app = plan.app ?? {};
  const origin = new URL(url).origin;
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1, locale: "en-US", timezoneId: "UTC", colorScheme: "light", acceptDownloads: false, serviceWorkers: "block" });
  const ledger = [], errors = [];
  const entries = new WeakMap();
  let masks = [];
  const result = { id: flow.id, ok: true, steps: flow.steps.length, reached: 0, ledger, errors };
  const at = (index) => `flow.${flow.id}.step.${index}`;
  try {
    context.on("request", (request) => {
      if (/^(data|blob):/.test(request.url())) return;
      const entry = { method: request.method(), url: short(redactWith(request.url(), masks)), type: request.resourceType(), how: null, status: null };
      entries.set(request, entry);
      ledger.push(entry);
    });
    context.on("response", (response) => { const entry = entries.get(response.request()); if (entry) entry.status = response.status(); });
    context.on("requestfailed", (request) => { const entry = entries.get(request); if (entry && entry.how !== "blocked") { entry.how = "failed"; entry.error = request.failure()?.errorText ?? null; } });
    const { secrets } = await prepareContext(context, {
      app, url, planDir, allowHosts, blockOffOrigin: true, log,
      onRoute: (request, how, error) => {
        const entry = entries.get(request);
        if (!entry) return;
        entry.how = how === "allowed" ? (new URL(request.url()).origin === origin ? "app" : "allowed") : how;
        if (error) entry.error = error.message;
      }
    });
    masks = [...secrets, ...(account ? Object.values(account) : [])];
    const page = await context.newPage();
    const lastRequest = () => ledger.findLast((entry) => API_TYPES.has(entry.type) && entry.type !== "document");
    page.on("pageerror", (error) => {
      if (page.url() === "about:blank" || /about:blank/.test(error.message)) return;
      errors.push({ kind: "pageerror", message: redactWith(error.message, masks).slice(0, 300), after: lastRequest() ? `${lastRequest().method} ${lastRequest().url}` : null });
    });
    page.on("console", (message) => {
      if (message.type() !== "error" || page.url() === "about:blank" || /^Failed to load resource/.test(message.text())) return;
      errors.push({ kind: "console", message: redactWith(message.text(), masks).slice(0, 300), after: lastRequest() ? `${lastRequest().method} ${lastRequest().url}` : null });
    });
    const resolveUrl = (target) => {
      const href = new URL(target, url).href;
      if (new URL(href).origin !== origin) assertSafeUrl(href, { allowHosts });
      return href;
    };
    const settle = async () => { await page.waitForLoadState("load").catch(() => {}); await page.waitForTimeout(400); };

    // Setup flows (sign-in) run first, as when recording.
    for (const id of flow.setup ?? []) {
      const setup = plan.flows.find((entry) => entry.id === id);
      for (const [index, step] of setup.steps.entries()) {
        const { problem } = await runStep(page, step, { resolveUrl, account, stepTimeout, settle });
        if (problem) {
          result.ok = false;
          add(`flow.${flow.id}.setup.${id}.step.${index}`, "fail", `setup flow ${id}, step ${index} (${step.type}${step.label ? ` "${step.label}"` : ""}): ${problem}`, { flow: flow.id, step: index, fix: `run doctor on ${id} by itself (--flows ${id}) and fix it first` });
          return result;
        }
      }
    }

    for (const [index, step] of flow.steps.entries()) {
      const { problem, visible } = await runStep(page, step, { resolveUrl, account, stepTimeout, settle });
      if (!problem) {
        result.reached = index + 1;
        if (index === 0) {
          await page.waitForTimeout(600);
          if (!(await checkLanding(page, flow, step, { app, add, ledger, origin }))) { result.ok = false; break; }
          const covering = await overlays(page);
          if (covering.length) add(`flow.${flow.id}.overlay`, "warn", `${covering[0].kind} covers the page at the start: "${covering[0].text || "(no text)"}"`, { flow: flow.id, step: 0, evidence: covering, fix: "if it is a first-run tour, onboarding or wizard, answer its flag as done in fixtures or the session (search the code for it); otherwise close it with a click step" });
        }
        if (step.type === "click" || step.type === "type") {
          if (visible > 1) add(`${at(index)}.ambiguous`, "warn", `step ${index} (${step.type} ${JSON.stringify(step.selector ?? step.text)}) matched ${visible} visible elements; the first is used`, { flow: flow.id, step: index, fix: "scope it, such as `[data-testid=…] <selector>` or `[role=dialog] >> text=…`, so it matches one element" });
        }
        continue;
      }
      result.ok = false;
      const shot = path.join(out, `${flow.id}-step${index}.png`);
      await mkdir(out, { recursive: true });
      await page.screenshot({ path: shot }).catch(() => {});
      const diagnosis = await diagnose(page, step, { app, ledger, origin });
      add(at(index), "fail", `step ${index} (${step.type}${step.selector ? ` ${step.selector}` : step.text ? ` "${step.text}"` : step.path ? ` ${step.path}` : ""}): ${problem}`, { flow: flow.id, step: index, fix: diagnosis.fix, evidence: { url: page.url(), screenshot: shot, ...diagnosis.evidence } });
      break;
    }
    // Nothing marked it: the HAR answered it (doctor's own origin guard sees every other request).
    for (const entry of ledger) entry.how ??= app.har ? "har" : "app";
    if (result.ok) add(`flow.${flow.id}`, "pass", `all ${flow.steps.length} steps ran`, { flow: flow.id });
    networkChecks(flow, ledger, { app, origin, add });
    for (const error of errors.slice(0, 5)) add(`flow.${flow.id}.page.errors`, "warn", `${error.kind}: ${error.message}`, { flow: flow.id, evidence: { after: error.after }, fix: error.after ? `check what the app expects from ${error.after}; a fixture may answer with the wrong shape` : "check the app's console" });
    return result;
  } catch (error) {
    result.ok = false;
    add(`flow.${flow.id}`, "fail", error.message.split("\n")[0], { flow: flow.id });
    return result;
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Run one step. → {problem: null | string, visible}: `visible` is how many
 * visible elements matched just before the step acted.
 */
async function runStep(page, step, { resolveUrl, account, stepTimeout, settle }) {
  const done = (problem = null, visible = 0) => ({ problem, visible });
  try {
    if (step.type === "goto") { await page.goto(resolveUrl(step.path ?? step.url), { waitUntil: "load", timeout: 30000 }); await settle(); return done(); }
    if (step.type === "pause") return done();
    const target = locate(page, step);
    const timeout = step.type === "wait-for" ? (step.timeout ?? 10000) : (step.timeout ?? stepTimeout);
    try { await target.waitFor({ state: "visible", timeout }); }
    catch { return done(`no visible element matched within ${timeout} ms`); }
    const visible = await matches(page, step).filter({ visible: true }).count().catch(() => 1);
    if (step.type === "click") { await target.click({ timeout }); await settle(); }
    if (step.type === "type") {
      const value = typeof step.value === "object" ? account?.[step.value.account] : step.value;
      if (typeof value !== "string") return done(`no test account for {account: "${step.value.account}"} (seed data, or LAUNCHCLIP_DEMO_EMAIL / LAUNCHCLIP_DEMO_PASSWORD)`, visible);
      await target.fill(value, { timeout });
    }
    return done(null, visible);
  } catch (error) {
    return done(error.message.split("\n")[0]);
  }
}

const isLoginStep = (step) => AUTH_PATH.test(step.path ?? step.url ?? "");

// After a flow's first page: did it end up signed out?
async function signedOut(page, { ledger, origin }) {
  let current;
  try { current = new URL(page.url()); } catch { return null; }
  const leftForSso = ledger.find((entry) => entry.type === "document" && entry.how === "blocked");
  if (leftForSso) return `the page tried to go to ${new URL(leftForSso.url).origin} (an SSO sign-in?)`;
  if (current.origin === origin && AUTH_PATH.test(`${current.pathname}${current.hash}`)) return `it landed on ${current.pathname}${current.hash}`;
  const password = await page.locator("input[type=password]").filter({ visible: true }).count().catch(() => 0);
  if (password) return "a password field is showing";
  return null;
}

// → false (and a failed check) when the flow starts signed out.
async function checkLanding(page, flow, step, { app, add, ledger, origin }) {
  if (isLoginStep(step)) return true;
  const reason = await signedOut(page, { ledger, origin });
  if (!reason) return true;
  return !add(`flow.${flow.id}.signin`, "fail", `flow ${flow.id} starts signed out: ${reason}`, { flow: flow.id, step: 0, fix: signinFix(app, flow, ledger, origin) });
}

function signinFix(app, flow, ledger, origin) {
  const rejected = ledger.filter((entry) => (entry.status === 401 || entry.status === 403) && entry.how !== "blocked").map((entry) => `${entry.method} ${entry.url} → ${entry.status}`);
  if (app.session) {
    return `the server rejected the session${rejected.length ? ` (${rejected.slice(0, 3).join("; ")})` : ""}. If fixtures should answer that request, add a route for it; if the app's own server checks the session, reuse the repo's e2e sign-in (a test user, the provider's testing tokens or a dev credentials provider), or sign in with a setup flow to a local test account from LAUNCHCLIP_DEMO_EMAIL / LAUNCHCLIP_DEMO_PASSWORD`;
  }
  if (flow.setup?.length) return `the setup flow (${flow.setup.join(", ")}) ran but the app is still signed out; check it signs in (run doctor with --flows ${flow.setup[0]})`;
  return `add app.session (rung 2): the values the app keeps once signed in (often in the repo's e2e addInitScript), with fixtures answering whatever validates them, or a setup sign-in flow for a password login`;
}

async function diagnose(page, step, { app, ledger, origin }) {
  const evidence = {};
  const fixes = [];
  if (step.type === "goto") return { fix: "check the path exists in the app's router and the app answers it", evidence };
  const total = await matches(page, step).count().catch(() => 0);
  const visible = await matches(page, step).filter({ visible: true }).count().catch(() => 0);
  evidence.matched = total;
  evidence.visible = visible;
  const reason = await signedOut(page, { ledger, origin });
  if (reason) fixes.push(`the page is signed out (${reason}): ${signinFix(app, { setup: [] }, ledger, origin)}`);
  const covering = await overlays(page).catch(() => []);
  if (covering.length) { evidence.overlay = covering; fixes.push(`a ${covering[0].kind} covers the page ("${covering[0].text}"): answer its first-run flag as done in fixtures or the session, or add a click step that closes it`); }
  if (total > 0 && visible === 0) fixes.push(`${total} element(s) match but none is visible: it may be a hidden duplicate, inside a closed menu or tab, or appear later; add a wait-for, or click what reveals it first`);
  const wanted = wantedText(step);
  const targets = await pageTargets(page).catch(() => []);
  const closest = wanted ? targets.map((target) => ({ ...target, score: similarity(wanted, target.text) })).filter((target) => target.score >= 0.3).sort((a, b) => b.score - a.score).slice(0, 5).map(({ role, text }) => ({ role, text })) : targets.slice(0, 5);
  evidence.closest = closest;
  if (total === 0) {
    if (closest.length) fixes.push(`nothing has ${wanted ? `the text "${wanted}"` : `the selector ${step.selector}`}; closest on the page: ${closest.map((target) => `"${target.text}" (${target.role})`).join(", ")}`);
    else fixes.push("nothing like it is on the page; check the flow reached the right page (see the screenshot) and that its data loaded");
    if (step.type === "type") fixes.push("a type step's text is the field's label or placeholder");
    if (step.type === "click" && step.text) fixes.push("click text matches a button or link name, or exact visible text; for a table cell or a custom widget use a selector such as `[role=option]:has-text(\"…\")`");
  }
  const unanswered = ledger.filter((entry) => API_TYPES.has(entry.type) && entry.type !== "document" && (entry.how === "failed" || (entry.status ?? 0) >= 400) && entry.how !== "blocked");
  if (unanswered.length) fixes.push(`the page's data may be missing: ${unanswered.slice(0, 3).map((entry) => `${entry.method} ${entry.url} → ${entry.status ?? entry.error ?? "failed"}`).join("; ")}`);
  return { fix: fixes.join(". ") || "see the screenshot", evidence };
}

function networkChecks(flow, ledger, { app, origin, add }) {
  const recordingBlocks = blocksOffOrigin(app);
  const allowed = new Set(app.allowOrigins ?? []);
  const offOrigin = new Map();
  for (const entry of ledger) {
    if (entry.how !== "blocked") continue;
    let target;
    try { target = new URL(entry.url).origin; } catch { continue; }
    if (target === origin || allowed.has(target)) continue;
    offOrigin.set(target, (offOrigin.get(target) ?? 0) + 1);
  }
  for (const [target, count] of offOrigin) {
    const host = new URL(target).hostname;
    if (!recordingBlocks) {
      add(`flow.${flow.id}.network.offorigin`, "fail", `${count} request(s) to ${target} would leave the app when recording (blocking is off for this plan)`, { flow: flow.id, fix: ASSET_HOST.test(host) ? `list ${target} in app.allowOrigins (the page needs it), and set app.blockOffOrigin: true` : `set app.blockOffOrigin: true, and answer ${target} in fixtures if the page needs it; list it in app.allowOrigins only for assets such as web fonts` });
    } else if (ASSET_HOST.test(host)) {
      add(`flow.${flow.id}.network.offorigin`, "warn", `blocked ${count} request(s) to ${target}, which looks like page assets (fonts, a CDN)`, { flow: flow.id, fix: `if the page looks wrong without it, add ${target} to app.allowOrigins` });
    } else {
      add(`flow.${flow.id}.network.offorigin`, "pass", `blocked ${count} request(s) to ${target}, as intended`, { flow: flow.id });
    }
  }
  if (!offOrigin.size) add(`flow.${flow.id}.network.offorigin`, "pass", "no request left the app's origin", { flow: flow.id });
  const seen = new Set();
  for (const entry of ledger) {
    if (!API_TYPES.has(entry.type) || entry.type === "document" || entry.how === "blocked") continue;
    if (entry.how === "fixture-error") { add(`flow.${flow.id}.fixtures.threw`, "fail", `fixtures threw on ${entry.method} ${entry.url}: ${entry.error}`, { flow: flow.id, fix: "fix the route() handler for that request (the app got a 500)" }); continue; }
    const failed = entry.how === "failed" || (entry.status ?? 0) >= 400;
    if (!failed) continue;
    const key = `${entry.method} ${entry.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const by = entry.how === "fixture" ? "your fixture answered" : entry.how === "har" ? "the HAR answered" : entry.how === "failed" ? "it failed" : "the app answered";
    add(`flow.${flow.id}.network.unanswered`, "warn", `${key}: ${by} ${entry.status ?? entry.error ?? ""}`.trim(), { flow: flow.id, fix: entry.how === "fixture" ? "check the fixture means to answer an error here" : app.fixtures ? "answer it in fixtures.mjs: return { json: … } from route() for this path, in the shape the app's API client expects" : "seed the data it needs, or add fixtures (rung 3) to answer it" });
  }
}

// The record command that repeats this doctor run's setup.
function recordCommand(repo, planFile, url, flags) {
  const quote = (text) => `"${String(text).replace(/"/g, '\\"')}"`;
  return [
    "launchclip demo record", rel(repo), "--plan", rel(planFile),
    url && `--url ${url}`,
    flags["no-start"] ? "--no-start" : typeof flags.start === "string" && `--start ${quote(flags.start)}`,
    flags["no-seed"] ? "--no-seed" : typeof flags.seed === "string" && `--seed ${quote(flags.seed)}`,
    ...list(flags["allow-host"]).map((host) => `--allow-host ${host}`),
    "--approve"
  ].filter(Boolean).join(" ");
}

function finish({ repo, planFile, checks, flows, url, flags = {} }) {
  const summary = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const check of checks) summary[check.status] += 1;
  const ok = summary.fail === 0;
  return {
    schema: DOCTOR_SCHEMA,
    mode: "check",
    ok,
    repo,
    plan: planFile,
    url: url ?? null,
    host: url ? (() => { try { return classifyHost(url); } catch { return null; } })() : null,
    checks,
    flows: flows.map((flow) => ({ ...flow, ledger: flow.ledger.filter((entry) => API_TYPES.has(entry.type) || entry.how === "blocked" || entry.how === "failed" || entry.how === "fixture").slice(0, 200) })),
    summary,
    next: ok
      ? recordCommand(repo, planFile, url, flags)
      : `fix the ${summary.fail} failing check(s) (each has a fix), then run launchclip demo doctor ${rel(repo)} --plan ${rel(planFile)} again`
  };
}

/** `launchclip demo doctor`: survey without --plan, check with it. */
export async function runDoctor(repoPath, flags = {}, options = {}) {
  if (!repoPath) throw new Error("launchclip demo doctor needs the app repo path");
  if (typeof flags.plan === "string") return checkRecipe(repoPath, flags, options);
  return surveyRepo(repoPath);
}

// A path as typed from the working directory: relative when it is inside it.
function relPath(file) {
  const relative = path.relative(process.cwd(), file);
  return !relative ? "." : relative.startsWith("..") || path.isAbsolute(relative) ? file : relative;
}
const rel = relPath;

const MARK = { pass: "✓", warn: "!", fail: "✗", skip: "-" };

/** A human-readable doctor report. */
export function formatDoctor(report) {
  const lines = [];
  if (report.mode === "survey") {
    lines.push(`demo doctor: survey of ${report.repo}`, "");
    lines.push(`Start: ${report.app.start ?? "not found (pass --start)"}${report.app.start_source ? ` (${report.app.start_source})` : ""}`);
    lines.push(`Seed: ${report.app.seed.join(", ") || "none"}`);
    lines.push(`Test accounts: ${report.accounts.map((entry) => `${entry.email} (${entry.source})`).join(", ") || "none"}`);
    lines.push(`Auth: ${report.auth.map((entry) => `${entry.name}${entry.sso ? " (SSO)" : ""}`).join(", ") || "none found"}`);
    if (report.env.api.length) lines.push(`API URL env: ${report.env.api.join(", ")}`);
    if (report.env.analytics.length) lines.push(`Analytics env (blank these for a demo build): ${report.env.analytics.join(", ")}`);
    if (report.first_run.length) lines.push(`First-run flags (answer as done): ${report.first_run.map((entry) => entry.flag).join(", ")}`);
    if (report.shots.videos || report.shots.screenshots) lines.push(`Docs placeholders: ${report.shots.videos} video(s), ${report.shots.screenshots} screenshot(s) (launchclip demo shots)`);
    if (report.demo) lines.push(`Recipe: ${report.demo}`);
    lines.push("", `Rung ${report.rung}: ${report.reasons.join("; ")}`);
    if (report.reuse.length) lines.push("", "Reuse first:", ...report.reuse.map((entry) => `  ${entry.kind.padEnd(8)} ${entry.what} (${entry.source})`));
    lines.push("", `Next: ${report.next}`);
    return `${lines.join("\n")}\n`;
  }
  lines.push(`demo doctor: ${report.plan} against ${report.url ?? "?"}`, "");
  for (const check of report.checks) {
    lines.push(`${MARK[check.status]} ${check.id}  ${check.message}`);
    if (check.fix && check.status !== "pass") lines.push(`    fix: ${check.fix}`);
    if (check.evidence?.screenshot) lines.push(`    screenshot: ${check.evidence.screenshot}`);
  }
  const { pass, warn, fail, skip } = report.summary;
  lines.push("", `${pass} passed, ${warn} warning(s), ${fail} failure(s)${skip ? `, ${skip} skipped` : ""}`, `Next: ${report.next}`);
  return `${lines.join("\n")}\n`;
}

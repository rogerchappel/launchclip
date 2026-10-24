// Demo autopilot, step 3: DEMO-PLAN.json, the declarative list of product
// flows to record.
//
//   {schema: "launchclip.demo-plan.v1", app: {url, fixtures?, har?, blockOffOrigin?, allowOrigins?, session?},
//    viewport: {width, height, deviceScaleFactor}, flows: [{id, title, goal?, setup?: [flowId], steps: [Step]}]}
//
// For an app with no seed data, `app.fixtures` (an ES module exporting
// route({request, url, method, body})) or `app.har` (a recorded HAR) answers
// its network requests; both paths are relative to the plan file. With either,
// requests to other origins are aborted (blockOffOrigin, default on) except
// `allowOrigins`, so a recording never reaches analytics or a real API.
//
// For an app that signs in through SSO, where nobody can type a password,
// `app.session` starts every flow signed in: {storageState: "state.json"} (a
// Playwright storage state, relative to the plan file) or {localStorage:
// {key: value}, cookies: [{name, value, domain?, path?}]}. Its values must be
// test values (sessionValueProblem in guardrails.js) and never reach the logs.
//
// A flow drafted from a docs placeholder (`launchclip demo shots`) keeps
// `shot: {id, file, line}`, which the recorder ignores.
//
// `setup` names flows (usually sign-in) that run first, off camera and at full
// speed, in the same clean browser profile, so a flow can start signed in.
//
// Step types (each may add `label`, the on-screen name used in logs and
// callouts, and `callout`, a short caption shown when that step lands):
//   {type: "goto", path: "/dashboard"}             same-origin path (or a URL on the app's host)
//   {type: "click", selector?: "css", text?: "Visible text"}
//   {type: "type", selector?, text?, value: "literal" | {account: "email"|"password"|"username"}}
//   {type: "wait-for", selector?, text?, timeout?: ms}
//   {type: "assert-visible", selector?, text?}
//   {type: "upload", selector?, text?, file: "assets/photo.jpg", timeout?: ms}
//                                                  clicks the control (a button, a drop zone, or an
//                                                  input[type=file] itself) and answers the file chooser
//                                                  with `file`, relative to the plan file and inside its folder
//   {type: "pause", ms}
//
// The planner is the active agent in the skill path (it writes the file and
// the user edits or approves it), or a model client in `launchclip make`
// (planDemo with a client from src/storyboard_planner.js). Without a model,
// heuristicPlan() builds a plain tour from the routes and nav links it finds.
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { extractStoryboard } from "../storyboard_planner.js";
import { classifyHost, sessionValueProblem, typeStepProblem } from "./guardrails.js";

export const DEMO_PLAN_SCHEMA = "launchclip.demo-plan.v1";
export const STEP_TYPES = Object.freeze(["goto", "click", "type", "wait-for", "assert-visible", "upload", "pause"]);
export const DEFAULT_VIEWPORT = Object.freeze({ width: 1920, height: 1080, deviceScaleFactor: 1 });
const FLOW_ID = /^[a-z][a-z0-9-]{0,39}$/;
const STEP_KEYS = { goto: ["path", "url"], click: ["selector", "text"], type: ["selector", "text", "value", "secret"], "wait-for": ["selector", "text", "timeout"], "assert-visible": ["selector", "text"], upload: ["selector", "text", "file", "timeout"], pause: ["ms"] };
const COMMON_KEYS = ["type", "label", "callout", "zoom"];
const APP_KEYS = ["url", "fixtures", "har", "blockOffOrigin", "allowOrigins", "session"];
const SESSION_KEYS = ["storageState", "localStorage", "cookies"];
const COOKIE_KEYS = ["name", "value", "url", "domain", "path", "expires", "httpOnly", "secure", "sameSite"];
// Plan keys that name files, resolved relative to the plan file.
const APP_FILES = ["fixtures", "har"];

function validateApp(app, errors) {
  if (app === undefined) return;
  if (!app || typeof app !== "object" || Array.isArray(app)) { errors.push("app must be an object"); return; }
  for (const key of Object.keys(app)) if (!APP_KEYS.includes(key)) errors.push(`app has unknown key "${key}" (app takes ${APP_KEYS.join(", ")}${/^(start|seed|command|port)$/.test(key) ? `; pass the ${key === "seed" ? "seed command as --seed" : "start command as --start"} on the command line` : ""})`);
  const file = (key, pattern, kind) => {
    if (app[key] === undefined) return;
    if (typeof app[key] !== "string" || !pattern.test(app[key]) || /^[a-z][a-z0-9+.-]*:/i.test(app[key])) errors.push(`app.${key} must be a local path to ${kind}, relative to the plan file`);
  };
  file("fixtures", /\.m?js$/, "an ES module (.js or .mjs)");
  file("har", /\.(har|zip)$/, "a .har or .zip file");
  if (app.blockOffOrigin !== undefined && typeof app.blockOffOrigin !== "boolean") errors.push("app.blockOffOrigin must be true or false");
  if (app.allowOrigins !== undefined) {
    if (!Array.isArray(app.allowOrigins)) errors.push("app.allowOrigins must be an array of origins");
    else for (const origin of app.allowOrigins) {
      let parsed = null;
      try { parsed = new URL(origin); } catch { /* reported below */ }
      if (!parsed || !/^https?:$/.test(parsed.protocol) || parsed.origin !== origin) errors.push(`app.allowOrigins entry ${JSON.stringify(origin)} must be an origin like "https://fonts.gstatic.com" (no path or trailing slash)`);
    }
  }
  if (app.session !== undefined) validateSession(app.session, app.url, errors);
}

/**
 * Problems with a signed-in session ({localStorage, cookies}, the shape of
 * app.session or of a Playwright storage state's entries): values that look
 * like real secrets, and cookies for hosts other than local or staging ones
 * (or the app's own). → [string]
 */
export function sessionProblems({ localStorage = {}, cookies = [] } = {}, appUrl = null, where = "app.session") {
  const errors = [];
  let appHost = null;
  try { appHost = new URL(appUrl).hostname; } catch { /* no app URL */ }
  for (const [key, value] of Object.entries(localStorage)) {
    if (typeof value !== "string") { errors.push(`${where}.localStorage.${key} must be a string (JSON.stringify an object)`); continue; }
    const problem = sessionValueProblem(value);
    if (problem) errors.push(`${where}.localStorage.${key} ${problem}`);
  }
  cookies.forEach((cookie, i) => {
    const at = `${where}.cookies[${i}]`;
    if (!cookie || typeof cookie !== "object" || typeof cookie.name !== "string" || typeof cookie.value !== "string") { errors.push(`${at} needs a string name and value`); return; }
    const problem = sessionValueProblem(cookie.value);
    if (problem) errors.push(`${at} (${cookie.name}) ${problem}`);
    let host = null;
    try { host = cookie.url ? new URL(cookie.url).hostname : cookie.domain ? String(cookie.domain).replace(/^\./, "") : null; } catch { errors.push(`${at}.url is not a URL`); }
    if (host && host !== appHost && classifyHost(`http://${host}`) === "production") errors.push(`${at} is for ${host}, which looks like a production host; session cookies are for the app's local or staging host`);
  });
  return errors;
}

function validateSession(session, appUrl, errors) {
  if (!session || typeof session !== "object" || Array.isArray(session)) { errors.push("app.session must be an object"); return; }
  for (const key of Object.keys(session)) if (!SESSION_KEYS.includes(key)) errors.push(`app.session has unknown key "${key}"`);
  if (session.storageState !== undefined) {
    if (typeof session.storageState !== "string" || !/\.json$/.test(session.storageState) || /^[a-z][a-z0-9+.-]*:/i.test(session.storageState)) errors.push("app.session.storageState must be a local path to a Playwright storage state .json, relative to the plan file");
    if (session.localStorage !== undefined || session.cookies !== undefined) errors.push("app.session takes storageState or localStorage/cookies, not both");
    return;
  }
  if (session.localStorage === undefined && session.cookies === undefined) { errors.push("app.session needs storageState, localStorage or cookies"); return; }
  if (session.localStorage !== undefined && (!session.localStorage || typeof session.localStorage !== "object" || Array.isArray(session.localStorage))) { errors.push("app.session.localStorage must be an object of key: string value"); return; }
  if (session.cookies !== undefined && !Array.isArray(session.cookies)) { errors.push("app.session.cookies must be an array"); return; }
  for (const [i, cookie] of (session.cookies ?? []).entries()) {
    for (const key of Object.keys(cookie ?? {})) if (!COOKIE_KEYS.includes(key)) errors.push(`app.session.cookies[${i}] has unknown key "${key}"`);
    if (cookie?.url !== undefined && (cookie.domain !== undefined || cookie.path !== undefined)) errors.push(`app.session.cookies[${i}] takes url, or domain and path, not both`);
  }
  errors.push(...sessionProblems(session, appUrl));
}

/**
 * The plan with its file paths (app.fixtures, app.har, app.session.storageState, upload files) rewritten from
 * `fromDir` to `toDir`, for a copy of the plan saved somewhere else.
 */
export function rebasePlanPaths(plan, fromDir, toDir) {
  const rebase = (file) => path.relative(toDir, path.resolve(fromDir, file)).split(path.sep).join("/");
  const flows = Array.isArray(plan.flows) ? plan.flows.map((flow) => (Array.isArray(flow?.steps) && flow.steps.some((step) => step?.type === "upload" && typeof step.file === "string")
    ? { ...flow, steps: flow.steps.map((step) => (step?.type === "upload" && typeof step.file === "string" ? { ...step, file: rebase(step.file) } : step)) }
    : flow)) : plan.flows;
  if (!plan.app) return { ...plan, flows };
  const app = { ...plan.app };
  for (const key of APP_FILES) if (typeof app[key] === "string") app[key] = rebase(app[key]);
  if (typeof app.session?.storageState === "string") app.session = { ...app.session, storageState: rebase(app.session.storageState) };
  return { ...plan, app, flows };
}

// An upload's file is a relative path. Whether it stays inside the plan's
// folder is checked on disk (uploadFileProblems), since a copy of the plan
// saved elsewhere (rebasePlanPaths) reaches it through "..".
function uploadPathProblem(file) {
  if (typeof file !== "string" || !file.trim()) return "must be a path to a sample file, relative to the plan file";
  if (/^[a-z][a-z0-9+.-]*:/i.test(file) || path.isAbsolute(file) || /^[\\/]/.test(file)) return `must be relative to the plan file (got ${JSON.stringify(file)})`;
  return null;
}

/**
 * Problems with the plan's upload files on disk: each, resolved from
 * `planDir`, must exist, be a file, and lead (symlinks followed) inside
 * `root`, the folder of the plan file the user wrote (planDir unless the plan
 * is a rebased copy). → [string]
 */
export async function uploadFileProblems(plan, planDir, { root = planDir } = {}) {
  const errors = [];
  const base = await realpath(path.resolve(root)).catch(() => path.resolve(root));
  for (const [f, flow] of (plan?.flows ?? []).entries()) {
    for (const [s, step] of (flow?.steps ?? []).entries()) {
      if (step?.type !== "upload" || uploadPathProblem(step.file)) continue;
      const at = `flows[${f}].steps[${s}].file`;
      const real = await realpath(path.resolve(planDir, step.file)).catch(() => null);
      if (!real) { errors.push(`${at} ${JSON.stringify(step.file)} does not exist next to the plan file`); continue; }
      if (path.relative(base, real).startsWith("..") || path.isAbsolute(path.relative(base, real))) { errors.push(`${at} ${JSON.stringify(step.file)} leads outside the plan's folder`); continue; }
      if (!(await stat(real)).isFile()) errors.push(`${at} ${JSON.stringify(step.file)} is not a file`);
    }
  }
  return errors;
}

/** Absolute path of an upload step's file, from the plan's folder. */
export const uploadPath = (step, root) => path.resolve(root, step.file);

/**
 * Validate a demo plan. → {errors: [string], warnings: [string]}. Errors block
 * recording; warnings (fewer than 2 or more than 4 flows, a flow that never
 * clicks or types) are advice.
 */
export function validateDemoPlan(plan) {
  const errors = [], warnings = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return { errors: ["the plan must be a JSON object"], warnings };
  if (plan.schema !== DEMO_PLAN_SCHEMA) errors.push(`schema must be "${DEMO_PLAN_SCHEMA}"`);
  validateApp(plan.app, errors);
  let origin = null;
  if (plan.app?.url !== undefined) {
    try { origin = new URL(plan.app.url).origin; } catch { errors.push(`app.url "${plan.app.url}" is not a URL`); }
  }
  const viewport = plan.viewport ?? {};
  for (const [key, min, max] of [["width", 640, 3840], ["height", 360, 2160], ["deviceScaleFactor", 1, 2]]) {
    if (viewport[key] !== undefined && !(Number.isFinite(viewport[key]) && viewport[key] >= min && viewport[key] <= max)) errors.push(`viewport.${key} must be ${min}–${max}`);
  }
  if (!Array.isArray(plan.flows) || !plan.flows.length) {
    errors.push("flows must be a non-empty array");
    return { errors, warnings };
  }
  if (plan.flows.length < 2 || plan.flows.length > 4) warnings.push(`${plan.flows.length} flow(s); 2–4 flows usually sell a product best`);
  const ids = new Set();
  plan.flows.forEach((flow, f) => {
    const where = `flows[${f}]`;
    if (!FLOW_ID.test(flow?.id ?? "")) errors.push(`${where}.id must be lowercase letters, digits and hyphens (got ${JSON.stringify(flow?.id)})`);
    else if (ids.has(flow.id)) errors.push(`${where}.id "${flow.id}" is used twice`);
    ids.add(flow?.id);
    if (typeof flow?.title !== "string" || !flow.title.trim() || flow.title.length > 60) errors.push(`${where}.title must be 1–60 characters`);
    if (flow?.setup !== undefined) {
      const known = plan.flows.map((entry) => entry?.id);
      if (!Array.isArray(flow.setup) || flow.setup.some((id) => !known.includes(id) || id === flow.id)) errors.push(`${where}.setup must list other flow ids from this plan`);
    }
    if (!Array.isArray(flow?.steps) || !flow.steps.length) { errors.push(`${where}.steps must be a non-empty array`); return; }
    if (flow.steps.length > 30) errors.push(`${where} has ${flow.steps.length} steps; keep a flow to 30 or fewer`);
    if (flow.steps[0]?.type !== "goto") errors.push(`${where}.steps[0] must be a goto, so each flow starts from a known page`);
    if (!flow.steps.some((step) => step?.type === "click" || step?.type === "type")) warnings.push(`${where} (${flow.id}) never clicks or types; it records as a page tour`);
    flow.steps.forEach((step, s) => {
      const at = `${where}.steps[${s}]`;
      if (!STEP_TYPES.includes(step?.type)) { errors.push(`${at}.type must be one of ${STEP_TYPES.join(", ")}`); return; }
      for (const key of Object.keys(step)) if (![...COMMON_KEYS, ...STEP_KEYS[step.type]].includes(key)) errors.push(`${at} (${step.type}) has unknown key "${key}"`);
      if (step.callout !== undefined && (typeof step.callout !== "string" || step.callout.length > 42)) errors.push(`${at}.callout must be a string of at most 42 characters`);
      if (["click", "type", "wait-for", "assert-visible", "upload"].includes(step.type) && !step.selector && !step.text) errors.push(`${at} needs a selector or text`);
      if (step.type === "upload") {
        const problem = uploadPathProblem(step.file);
        if (problem) errors.push(`${at}.file ${problem}`);
      }
      if (step.type === "goto") {
        const target = step.path ?? step.url;
        if (typeof target !== "string") errors.push(`${at} needs a path`);
        else if (/^https?:/i.test(target) && origin && new URL(target).origin !== origin) errors.push(`${at} leaves the app (${new URL(target).origin}); demo flows stay on ${origin}`);
        else if (!/^https?:/i.test(target) && !target.startsWith("/")) errors.push(`${at}.path must start with "/"`);
      }
      if (step.type === "type") {
        const problem = typeStepProblem(step);
        if (problem) errors.push(`${at}: ${problem}`);
      }
      if (step.type === "pause" && !(Number.isFinite(step.ms) && step.ms >= 0 && step.ms <= 10000)) errors.push(`${at}.ms must be 0–10000`);
      if ((step.type === "wait-for" || step.type === "upload") && step.timeout !== undefined && !(Number.isFinite(step.timeout) && step.timeout > 0 && step.timeout <= 60000)) errors.push(`${at}.timeout must be 1–60000 ms`);
    });
  });
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Route and nav discovery (read-only)

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".turbo", "coverage", ".launchclip", "vendor"]);
const SOURCE = /\.(m?[jt]sx?|vue|svelte|astro|html)$/;

async function walk(root, dir = "", depth = 0, out = []) {
  if (depth > 6 || out.length > 4000) return out;
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true }).catch(() => [])) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(root, rel, depth + 1, out);
    else if (SOURCE.test(entry.name)) out.push(rel);
  }
  return out;
}

/** Next.js app/ or pages/ file → route path, else null. */
export function fileRoute(rel) {
  const app = /(?:^|\/)app\/(.*?)\/?page\.(?:[jt]sx?|mdx)$/.exec(rel) ?? (/(?:^|\/)app\/page\.(?:[jt]sx?|mdx)$/.test(rel) ? [null, ""] : null);
  if (app) return `/${app[1].split("/").filter((part) => part && !/^\(.*\)$/.test(part) && !part.startsWith("@")).join("/")}`;
  const pages = /(?:^|\/)pages\/(.+)\.(?:[jt]sx?|vue|svelte|astro)$/.exec(rel);
  if (pages && !/^(_app|_document|_error|api\/)/.test(pages[1])) return `/${pages[1].replace(/(^|\/)index$/, "")}`.replace(/\/$/, "") || "/";
  const routes = /(?:^|\/)routes\/(.+?)\/?\+page\.svelte$/.exec(rel);
  if (routes) return `/${routes[1]}`;
  const html = /^(?:public\/)?([^/]+)\.html$/.exec(rel);
  if (html) return html[1] === "index" ? "/" : `/${html[1]}`;
  return null;
}

/**
 * Routes and nav links in a repo: {routes: [{path, source}], nav: [{path, label, source}]}.
 * Routes come from file-based routing (Next app/pages, SvelteKit, static
 * HTML), router declarations (path: "/x", <Route path="/x">) and server
 * handlers (app.get("/x")); nav links from anchors (href="/x">Label<) in any
 * component. Dynamic segments ([id], :id) are skipped.
 */
export async function discoverRoutes(repoPath) {
  const repo = path.resolve(repoPath);
  const files = await walk(repo);
  const routes = new Map(), nav = new Map();
  const add = (map, key, value) => { if (!map.has(key)) map.set(key, value); };
  const dynamic = (route) => /[[\]:*]/.test(route);
  for (const rel of files) {
    const fromFile = fileRoute(rel);
    if (fromFile && !dynamic(fromFile)) add(routes, fromFile, { path: fromFile, source: rel });
    let text;
    try { text = await readFile(path.join(repo, rel), "utf8"); } catch { continue; }
    if (text.length > 400_000) continue;
    for (const match of text.matchAll(/(?:\bpath\s*[:=]\s*|<Route[^>]*\bpath=)["'`](\/[A-Za-z0-9/_-]*)["'`]/g)) if (!dynamic(match[1])) add(routes, match[1], { path: match[1], source: rel });
    for (const match of text.matchAll(/\b(?:app|router|server)\.get\(\s*["'`](\/[A-Za-z0-9/_-]*)["'`]/g)) if (!match[1].startsWith("/api") && !dynamic(match[1])) add(routes, match[1], { path: match[1], source: rel });
    for (const match of text.matchAll(/<(?:a|Link|NavLink)\b[^>]*\b(?:href|to)=["'{`]+(\/[A-Za-z0-9/_-]*)["'`}]+[^>]*>\s*(?:<[^>]+>\s*)*([^<{]{2,40}?)\s*</g)) {
      if (!dynamic(match[1])) add(nav, match[1], { path: match[1], label: match[2].trim(), source: rel });
    }
  }
  const sort = (list) => list.sort((a, b) => (a.path === "/" ? -1 : b.path === "/" ? 1 : a.path.localeCompare(b.path)));
  return { routes: sort([...routes.values()]), nav: sort([...nav.values()]) };
}

// ---------------------------------------------------------------------------
// Planning

const AUTH_ROUTE = /\/(login|signin|sign-in|log-in)$/;
const SIGNUP_ROUTE = /\/(signup|sign-up|register|join)$/;
const BORING = /\/(privacy|terms|legal|cookies|404|500|error|logout|sign-?out|api)(\/|$)/;

const titleCase = (text) => text.replace(/[-_/]+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * A deterministic plan without a model: a sign-in flow when there is a login
 * route and a test account, then tours of the most linked pages, clicking the
 * nav link to reach each one. Returns a valid DEMO-PLAN.json object.
 */
export function heuristicPlan({ url, routes = [], nav = [], accounts = [], maxFlows = 3, viewport = DEFAULT_VIEWPORT } = {}) {
  const flows = [];
  const all = [...new Map([...nav, ...routes].map((entry) => [entry.path, entry])).values()].filter((entry) => !BORING.test(entry.path));
  const login = all.find((entry) => AUTH_ROUTE.test(entry.path));
  if (login && accounts.length) {
    flows.push({ id: "sign-in", title: "Sign in", goal: "Sign in with the demo account", steps: [
      { type: "goto", path: login.path },
      { type: "type", text: "Email", value: { account: "email" }, label: "Email" },
      { type: "type", text: "Password", value: { account: "password" }, label: "Password", secret: true },
      { type: "click", text: "Sign in", label: "Sign in", callout: "Straight in" },
      { type: "pause", ms: 1500 }
    ] });
  }
  const pages = all.filter((entry) => entry.path !== "/" && !AUTH_ROUTE.test(entry.path) && !SIGNUP_ROUTE.test(entry.path));
  const linked = pages.filter((entry) => nav.some((link) => link.path === entry.path));
  for (const page of [...linked, ...pages.filter((entry) => !linked.includes(entry))]) {
    if (flows.length >= maxFlows) break;
    const link = nav.find((entry) => entry.path === page.path);
    const name = link?.label ?? titleCase(page.path.split("/").filter(Boolean).at(-1) ?? "Home");
    const id = page.path.split("/").filter(Boolean).join("-").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40) || "home";
    if (flows.some((flow) => flow.id === id)) continue;
    const steps = [{ type: "goto", path: flows[0]?.id === "sign-in" ? "/dashboard" : "/" }, { type: "pause", ms: 800 }];
    if (link) steps.push({ type: "click", text: link.label, label: link.label, callout: name.slice(0, 42) });
    else steps.push({ type: "goto", path: page.path, label: name });
    steps.push({ type: "pause", ms: 2000 });
    flows.push({ id: /^[a-z]/.test(id) ? id : `page-${id}`.slice(0, 40), title: name.slice(0, 60), goal: `Show ${name}`, ...(flows[0]?.id === "sign-in" ? { setup: ["sign-in"] } : {}), steps });
  }
  if (!flows.length) flows.push({ id: "home", title: "Home", goal: "Show the home page", steps: [{ type: "goto", path: "/" }, { type: "pause", ms: 3000 }] });
  return { schema: DEMO_PLAN_SCHEMA, app: { url }, viewport: { ...viewport }, flows };
}

/** System instructions for a model that writes DEMO-PLAN.json. */
export function demoPlanInstructions() {
  return [
    "You plan product demo recordings for a SaaS launch video. Return one JSON object, a DEMO-PLAN.json, and nothing else.",
    `Schema: {"schema": "${DEMO_PLAN_SCHEMA}", "app": {"url": string}, "viewport": {"width": 1920, "height": 1080, "deviceScaleFactor": 1}, "flows": [{"id": "kebab-case", "title": "≤ 60 chars", "goal": string, "setup"?: ["sign-in"], "steps": [Step]}]}`,
    "Each flow is recorded in a fresh, signed-out browser. A flow that needs a signed-in user lists the sign-in flow's id in setup; setup flows run first, off camera.",
    "Step types: goto {path: \"/x\"}; click {selector? | text?}; type {selector? | text? (the field's label or placeholder), value: string | {account: \"email\"|\"password\"|\"username\"}}; wait-for {selector? | text?, timeout? ms}; assert-visible {selector? | text?}; upload {selector? | text? (the upload button, drop zone or file input), file: a path from sample_files, relative to the plan file}; pause {ms ≤ 10000}. Any step may add label (short on-screen name) and callout (≤ 42 chars, shown as the step lands).",
    "Plan 2–4 flows that sell the product for the prompt, e.g. sign up → create a project → see the result. Each flow starts with a goto, has 4–15 steps and lasts 8–20 seconds when played at human pace.",
    "Use only routes, links, button text and field labels that appear in the code context you are given; prefer visible text over CSS selectors. Stay on the app's own origin.",
    "Never put a password, API key or token in a step. Sign-in fields take {account: \"email\"} and {account: \"password\"}; the recorder fills them from the project's seed data. Use realistic but obviously fictional sample data (project names, notes)."
  ].join("\n");
}

/** Compact code context for the planner: routes, nav links, accounts available (never their values). */
export function planContext({ prompt, url, routes, nav, accounts, files = [], samples = [] }) {
  return JSON.stringify({
    prompt,
    app_url: url,
    routes: routes.slice(0, 60).map((entry) => entry.path),
    nav: nav.slice(0, 60).map((entry) => ({ path: entry.path, label: entry.label })),
    test_account: accounts.length ? "available ({account: \"email\"} and {account: \"password\"})" : "none (do not plan a sign-in)",
    sample_files: samples.length ? samples.slice(0, 20) : "none (do not plan an upload)",
    page_snippets: files.slice(0, 12)
  }, null, 2);
}

/**
 * Plan the demo flows. With `client` (a storyboard_planner client with
 * runStructured), ask the model, validate, and send the errors back once;
 * fall back to heuristicPlan when the model fails. → {plan, source, errors, warnings, usage}
 */
export async function planDemo({ prompt = "", repo, url, client = null, accounts = [], maxRepairs = 1, log = () => {} } = {}) {
  const { routes, nav } = await discoverRoutes(repo);
  const fallback = () => {
    const plan = heuristicPlan({ url, routes, nav, accounts });
    return { plan, source: "heuristic", ...validateDemoPlan(plan), usage: null };
  };
  if (!client) return fallback();
  const snippets = await pageSnippets(repo, [...routes, ...nav]);
  let input = planContext({ prompt, url, routes, nav, accounts, files: snippets });
  let last = null;
  for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
    let result;
    try { result = await client.runStructured({ instructions: demoPlanInstructions(), input, maxOutputTokens: 8000 }); }
    catch (error) { log(`planner failed: ${error.message}; using the heuristic plan`); return fallback(); }
    // extractStoryboard parses any one JSON object out of a model reply.
    const parsed = extractStoryboard(result);
    if (!parsed.ok) { last = { errors: [parsed.error] }; input = `${input}\n\nYour last reply was not JSON (${parsed.error}). Return only the JSON object.`; continue; }
    // Only the user's own plan file may name fixtures or a HAR: a fixtures module is code that runs.
    const plan = { ...parsed.storyboard, schema: DEMO_PLAN_SCHEMA, app: { url }, viewport: { ...DEFAULT_VIEWPORT, ...(parsed.storyboard.viewport ?? {}) } };
    const check = validateDemoPlan(plan);
    if (!check.errors.length) return { plan, source: "model", ...check, usage: result.usage ?? null };
    last = check;
    input = `${planContext({ prompt, url, routes, nav, accounts, files: snippets })}\n\nYour last plan:\n${JSON.stringify(plan)}\n\nFix these errors and return the whole plan:\n- ${check.errors.join("\n- ")}`;
  }
  log(`planner output failed validation (${last?.errors?.join("; ")}); using the heuristic plan`);
  return fallback();
}

async function pageSnippets(repo, entries) {
  const out = [];
  for (const source of [...new Set(entries.map((entry) => entry.source))].slice(0, 12)) {
    try {
      const text = await readFile(path.join(repo, source), "utf8");
      // Visible strings only: button/label/heading text and placeholders.
      const strings = [...text.matchAll(/(?:>\s*([A-Z][^<>{}\n]{1,40}?)\s*<|placeholder=["']([^"']{1,40})["']|aria-label=["']([^"']{1,40})["'])/g)].map((m) => (m[1] ?? m[2] ?? m[3]).trim());
      out.push({ file: source, text: [...new Set(strings)].slice(0, 40) });
    } catch { /* skip unreadable files */ }
  }
  return out;
}

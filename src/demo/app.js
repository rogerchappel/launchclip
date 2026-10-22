// Demo autopilot, step 1: find out how a SaaS repo runs, start it as a managed
// child process, wait until it answers, and stop it (and its children) after
// recording.
//
// detectApp() only reads files: package.json scripts and lockfile, README code
// blocks, docker-compose.yml, Procfile and .env.example. It never runs
// anything. startApp() runs the one command the caller passes, so the CLI asks
// before it (the same rule as `launchclip demo`: demo commands can have side
// effects inside the target repo).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { assertSafeUrl, redactSecrets } from "./guardrails.js";

// Default dev-server ports by framework (the dependency that names it).
const FRAMEWORK_PORTS = [
  ["next", 3000], ["nuxt", 3000], ["@remix-run/dev", 3000], ["@sveltejs/kit", 5173], ["vite", 5173],
  ["astro", 4321], ["@angular/cli", 4200], ["react-scripts", 3000], ["gatsby", 8000], ["express", 3000], ["fastify", 3000], ["hono", 3000]
];
const DEV_SCRIPTS = ["dev", "start:dev", "develop", "serve", "start", "preview"];
const SEED_SCRIPTS = ["seed", "db:seed", "seed:dev", "fixtures", "db:fixtures", "demo:seed"];
const URL_KEYS = ["APP_URL", "BASE_URL", "PUBLIC_URL", "SITE_URL", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SITE_URL", "VITE_APP_URL", "NEXTAUTH_URL"];

async function readText(file) {
  try { return await readFile(file, "utf8"); } catch { return null; }
}

/** npm | pnpm | yarn | bun, from the lockfile (npm when there is none). */
export function packageManager(files) {
  if (files.has("pnpm-lock.yaml")) return "pnpm";
  if (files.has("yarn.lock")) return "yarn";
  if (files.has("bun.lockb") || files.has("bun.lock")) return "bun";
  return "npm";
}

function runScript(manager, name) {
  return manager === "npm" ? (name === "start" ? "npm start" : `npm run ${name}`) : `${manager} ${name === "start" ? "start" : `run ${name}`}`;
}

/** Port a dev script pins: `--port 4000`, `-p 4000`, `PORT=4000`, `:4000`. */
export function scriptPort(script) {
  const text = String(script ?? "");
  const match = /(?:--port[= ]|-p\s+|\bPORT=)(\d{2,5})\b/.exec(text) ?? /localhost:(\d{2,5})\b/.exec(text);
  return match ? Number(match[1]) : null;
}

/** KEY=value pairs from a dotenv file (comments and blanks skipped). */
export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].replace(/\s+#.*$/, "").trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

/**
 * Published ports per service from a docker-compose file, without a YAML
 * dependency: [{service, host, container}] for "3000:3000" style entries.
 */
export function composePorts(text) {
  const out = [];
  let service = null, inServices = false, inPorts = false, serviceIndent = null;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (indent === 0) { inServices = line === "services:"; service = null; inPorts = false; continue; }
    if (!inServices) continue;
    if (serviceIndent === null || indent <= serviceIndent) {
      if (/^[A-Za-z0-9_.-]+:$/.test(line)) { serviceIndent = indent; service = line.slice(0, -1); inPorts = false; continue; }
    }
    if (line === "ports:") { inPorts = true; continue; }
    if (inPorts && line.startsWith("-")) {
      const spec = line.replace(/^-\s*/, "").replace(/['"]/g, "");
      const parts = spec.split(":");
      const host = Number(parts.length >= 2 ? parts.at(-2) : parts[0]);
      const container = Number(parts.at(-1).split("/")[0]);
      if (service && Number.isInteger(host) && Number.isInteger(container)) out.push({ service, host, container });
      continue;
    }
    if (/^[A-Za-z_]+:/.test(line)) inPorts = false;
  }
  return out;
}

/** Shell commands and localhost URLs a README shows in its code blocks. */
export function readmeHints(text) {
  const commands = [], urls = [];
  const blocks = String(text ?? "").match(/```[\s\S]*?```/g) ?? [];
  for (const block of blocks) {
    for (const line of block.split(/\r?\n/)) {
      const command = line.replace(/^\s*\$\s*/, "").trim();
      if (/^(npm run (dev|start|serve)|npm start|pnpm (run )?(dev|start)|yarn (dev|start)|bun (run )?dev|docker compose up|docker-compose up|make (dev|run|up))\b/.test(command)) commands.push(command);
    }
  }
  for (const match of String(text ?? "").matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d{2,5})?(?:\/[^\s)`'"]*)?/g)) urls.push(match[0].replace(/[.,;]+$/, ""));
  return { commands: [...new Set(commands)], urls: [...new Set(urls)] };
}

function frameworkPort(pkg) {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  return FRAMEWORK_PORTS.find(([name]) => deps[name])?.[1] ?? null;
}

/**
 * Read a repo and propose how to run it. Returns
 * {repo, manager, start: [{command, url, source, confidence}], seed: [{command, source}],
 *  env: {file, keys, values}, recommended: start[0] | null, notes: []}.
 * Candidates are sorted best first. Nothing is executed.
 */
export async function detectApp(repoPath) {
  const repo = path.resolve(repoPath);
  const files = new Set(await readdir(repo).catch(() => []));
  const manager = packageManager(files);
  const pkgText = files.has("package.json") ? await readText(path.join(repo, "package.json")) : null;
  let pkg = {};
  try { pkg = pkgText ? JSON.parse(pkgText) : {}; } catch { pkg = {}; }
  const scripts = pkg.scripts ?? {};
  const envFile = [".env.example", ".env.sample", ".env.template"].find((name) => files.has(name)) ?? null;
  const envValues = envFile ? parseEnvFile(await readText(path.join(repo, envFile))) : {};
  const envPort = Number(envValues.PORT) || null;
  const envUrl = URL_KEYS.map((key) => envValues[key]).find((value) => /^https?:\/\//.test(value ?? "")) ?? null;
  const readmeName = [...files].find((name) => /^readme(\.md)?$/i.test(name));
  const readme = readmeHints(readmeName ? await readText(path.join(repo, readmeName)) : "");
  const notes = [];
  const start = [];
  const defaultPort = envPort ?? frameworkPort(pkg) ?? 3000;
  const urlFor = (port) => (envUrl && (!port || envUrl.includes(`:${port}`)) ? envUrl : `http://localhost:${port ?? defaultPort}`);

  DEV_SCRIPTS.forEach((name, rank) => {
    if (typeof scripts[name] !== "string") return;
    const port = scriptPort(scripts[name]) ?? defaultPort;
    start.push({ command: runScript(manager, name), url: urlFor(port), source: `package.json scripts.${name}`, confidence: Math.round((0.9 - rank * 0.08) * 100) / 100 });
  });
  for (const command of readme.commands) {
    if (start.some((entry) => entry.command === command)) {
      const entry = start.find((item) => item.command === command);
      entry.confidence = Math.min(0.98, entry.confidence + 0.05);
      entry.source += " (also in the README)";
      continue;
    }
    start.push({ command, url: readme.urls[0] ?? urlFor(null), source: "README code block", confidence: 0.6 });
  }
  const composeName = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"].find((name) => files.has(name));
  if (composeName) {
    const ports = composePorts(await readText(path.join(repo, composeName)));
    const web = ports.find((entry) => /web|app|frontend|server|api/.test(entry.service)) ?? ports[0];
    start.push({ command: "docker compose up", url: urlFor(web?.host ?? null), source: composeName, confidence: start.length ? 0.5 : 0.7 });
    if (!web) notes.push(`${composeName} publishes no ports; pass --url`);
  }
  if (files.has("Procfile")) {
    const web = /^web:\s*(.+)$/m.exec(await readText(path.join(repo, "Procfile")) ?? "");
    if (web) start.push({ command: web[1].trim(), url: urlFor(scriptPort(web[1])), source: "Procfile web", confidence: 0.45 });
  }
  if (readme.urls.length) {
    for (const entry of start) if (entry.source.startsWith("package.json") && !scriptPort(scripts[entry.source.split(".").pop()]) && !envPort) entry.url = readme.urls[0].replace(/\/$/, "") || entry.url;
  }
  start.sort((a, b) => b.confidence - a.confidence);

  const seed = [];
  for (const name of SEED_SCRIPTS) if (typeof scripts[name] === "string") seed.push({ command: runScript(manager, name), source: `package.json scripts.${name}` });
  if (pkg.prisma?.seed || existsSync(path.join(repo, "prisma", "seed.ts")) || existsSync(path.join(repo, "prisma", "seed.js"))) {
    seed.push({ command: manager === "npm" ? "npx prisma db seed" : `${manager} prisma db seed`, source: pkg.prisma?.seed ? "package.json prisma.seed" : "prisma/seed" });
  }
  if (!start.length) notes.push("no start command found; pass --start \"<command>\" --url <http://localhost:port>");
  return {
    repo, manager, start, seed,
    env: { file: envFile, keys: Object.keys(envValues), values: envValues },
    recommended: start[0] ?? null,
    notes
  };
}

/**
 * Test accounts for the recording, never real ones: LAUNCHCLIP_DEMO_EMAIL /
 * LAUNCHCLIP_DEMO_PASSWORD from the environment first, then email/password
 * literals in the repo's seed files (seed scripts, prisma/seed.*, fixtures).
 * → [{email, password, source}]
 */
export async function findTestAccounts(repoPath, { env = process.env, seedFiles } = {}) {
  const accounts = [];
  if (env.LAUNCHCLIP_DEMO_EMAIL && env.LAUNCHCLIP_DEMO_PASSWORD) accounts.push({ email: env.LAUNCHCLIP_DEMO_EMAIL, password: env.LAUNCHCLIP_DEMO_PASSWORD, source: "env LAUNCHCLIP_DEMO_EMAIL" });
  const repo = path.resolve(repoPath);
  const candidates = seedFiles ?? await defaultSeedFiles(repo);
  for (const file of candidates) {
    const text = await readText(path.join(repo, file));
    if (!text) continue;
    const pattern = /email\s*[:=]\s*["'`]([^"'`\s]+@[^"'`\s]+)["'`][\s\S]{0,200}?password\s*[:=]\s*["'`]([^"'`]{4,64})["'`]/gi;
    for (const match of text.matchAll(pattern)) accounts.push({ email: match[1], password: match[2], source: file });
  }
  return accounts;
}

async function defaultSeedFiles(repo) {
  const out = [];
  const visit = async (dir, depth) => {
    for (const entry of await readdir(path.join(repo, dir), { withFileTypes: true }).catch(() => [])) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory() && depth < 3) await visit(rel, depth + 1);
      else if (entry.isFile() && /(^|[/_.-])(seed|seeds|fixtures?)([/_.-]|$)/i.test(rel) && /\.(m?[jt]s|json|sql)$/.test(entry.name)) out.push(rel);
    }
  };
  await visit("", 0);
  return out.sort();
}

/** Poll `url` until it answers below 500 (or `timeout` ms pass). → {ok, status, ms} */
export async function waitForHealthy(url, { timeout = 60000, interval = 250, fetchImpl = fetch, isAlive = () => true } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    if (!isAlive()) return { ok: false, status: null, ms: Date.now() - started, error: "the app process exited before it became healthy" };
    try {
      const response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(Math.max(1000, interval * 4)) });
      if (response.status < 500) return { ok: true, status: response.status, ms: Date.now() - started };
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error.cause?.code ?? error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return { ok: false, status: null, ms: Date.now() - started, error: `no healthy answer from ${url} within ${timeout} ms (${last})` };
}

/** Run a one-shot command (a seed script) in the repo; output is redacted. */
export function runCommand(command, { cwd, env = {}, timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.env.SHELL || "/bin/sh", ["-lc", command], { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("close", (code) => { clearTimeout(timer); resolve({ command: redactSecrets(command), code, output: redactSecrets(output.slice(-8000)) }); });
    child.on("error", (error) => { clearTimeout(timer); resolve({ command: redactSecrets(command), code: -1, output: redactSecrets(error.message) }); });
  });
}

/**
 * Start the app as a managed child process (its own process group, so stop()
 * ends the dev server and everything it spawned) and wait until `url` answers.
 * → {url, pid, logs(), stop()}. Throws (after stopping it) when it never gets
 * healthy. The URL must pass the guardrails (local or staging only).
 */
export async function startApp({ command, cwd, url, healthPath = "", env = {}, timeout = 90000, allowHosts = [], log = () => {} }) {
  if (!command) throw new Error("startApp needs a command");
  assertSafeUrl(url, { allowHosts });
  const child = spawn(process.env.SHELL || "/bin/sh", ["-lc", command], { cwd, env: { ...process.env, BROWSER: "none", ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let output = "";
  let exited = null;
  const keep = (chunk) => { output = (output + chunk).slice(-20000); };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  child.on("exit", (code, signal) => { exited = { code, signal }; });
  const stop = async () => {
    if (exited) return;
    for (const signal of ["SIGTERM", "SIGKILL"]) {
      try { process.kill(-child.pid, signal); } catch { /* already gone */ }
      const deadline = Date.now() + 4000;
      while (!exited && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
      if (exited) return;
    }
  };
  log(`started \`${redactSecrets(command)}\` (pid ${child.pid}); waiting for ${url}`);
  const health = new URL(healthPath || "", url).href;
  const result = await waitForHealthy(health, { timeout, isAlive: () => !exited });
  if (!result.ok) {
    await stop();
    throw new Error(`${result.error}\n--- app output (redacted) ---\n${redactSecrets(output.slice(-3000))}`);
  }
  log(`healthy after ${result.ms} ms (HTTP ${result.status})`);
  return { url, pid: child.pid, logs: () => redactSecrets(output), stop };
}

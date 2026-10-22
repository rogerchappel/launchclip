// Demo autopilot: app detection (src/demo/app.js) and guardrails
// (src/demo/guardrails.js). Detection only reads files; startApp runs a tiny
// node server to check the managed start, health wait and stop.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { composePorts, detectApp, findTestAccounts, parseEnvFile, readmeHints, scriptPort, startApp } from "../src/demo/app.js";
import { assertSafeUrl, classifyHost, redactSecrets, redactWith, typeStepProblem } from "../src/demo/guardrails.js";

async function repo(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-demo-app-"));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  return dir;
}

test("detectApp ranks package scripts, uses the framework port and finds seed scripts", async (t) => {
  const dir = await repo({
    "package.json": { scripts: { dev: "vite", start: "node server.js", seed: "node scripts/seed.js" }, devDependencies: { vite: "^6" } },
    "pnpm-lock.yaml": "lockfileVersion: 9\n"
  });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const app = await detectApp(dir);
  assert.equal(app.manager, "pnpm");
  assert.equal(app.recommended.command, "pnpm run dev");
  assert.equal(app.recommended.url, "http://localhost:5173");
  assert.deepEqual(app.start.map((entry) => entry.command), ["pnpm run dev", "pnpm start"]);
  assert.deepEqual(app.seed, [{ command: "pnpm run seed", source: "package.json scripts.seed" }]);
});

test("detectApp reads ports from the script, .env.example, the README and docker-compose", async (t) => {
  const dir = await repo({
    "package.json": { scripts: { dev: "next dev -p 4100" }, dependencies: { next: "15" }, prisma: { seed: "tsx prisma/seed.ts" } },
    ".env.example": "# local\nPORT=4100\nDATABASE_URL=postgres://demo:demo@localhost/db\nSTRIPE_KEY=\n",
    "README.md": "# App\n\n```bash\nnpm run dev\n```\n\nOpen http://localhost:4100/dashboard.\n",
    "docker-compose.yml": "services:\n  db:\n    image: postgres\n    ports:\n      - \"5432:5432\"\n  web:\n    build: .\n    ports:\n      - \"8080:3000\"\n",
    "Procfile": "web: node server.js --port 5000\n"
  });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const app = await detectApp(dir);
  assert.equal(app.recommended.command, "npm run dev");
  assert.match(app.recommended.source, /also in the README/);
  assert.equal(app.recommended.url, "http://localhost:4100");
  const compose = app.start.find((entry) => entry.source === "docker-compose.yml");
  assert.equal(compose.command, "docker compose up");
  assert.equal(compose.url, "http://localhost:8080");
  assert.equal(app.start.find((entry) => entry.source === "Procfile web").url, "http://localhost:5000");
  assert.deepEqual(app.seed.map((entry) => entry.command), ["npx prisma db seed"]);
  assert.deepEqual(app.env.keys, ["PORT", "DATABASE_URL", "STRIPE_KEY"]);
});

test("detectApp with nothing to run says to pass --start and --url", async (t) => {
  const dir = await repo({ "notes.txt": "hello" });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const app = await detectApp(dir);
  assert.equal(app.recommended, null);
  assert.match(app.notes[0], /--start/);
});

test("parsers: script ports, env files, compose ports and README hints", () => {
  assert.equal(scriptPort("vite --port 4321"), 4321);
  assert.equal(scriptPort("PORT=3999 node server.js"), 3999);
  assert.equal(scriptPort("next dev"), null);
  assert.deepEqual(parseEnvFile("export A=1\nB='two' # note\n# C=3\n"), { A: "1", B: "two" });
  assert.deepEqual(composePorts("services:\n  app:\n    ports:\n      - 127.0.0.1:3000:3000\n      - '9229:9229/tcp'\n"), [{ service: "app", host: 3000, container: 3000 }, { service: "app", host: 9229, container: 9229 }]);
  const hints = readmeHints("```\n$ docker compose up\n$ rm -rf /\n```\nthen http://localhost:3000.");
  assert.deepEqual(hints, { commands: ["docker compose up"], urls: ["http://localhost:3000"] });
});

test("findTestAccounts reads seed files and the LAUNCHCLIP_DEMO_* env", async (t) => {
  const dir = await repo({ "scripts/seed.js": "await db.user.create({ email: 'demo@acme.test', name: 'Demo', password: 'demo-pass-123' });\n", "src/app.js": "const email = 'real@corp.com', password = 'nope';" });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const accounts = await findTestAccounts(dir, { env: { LAUNCHCLIP_DEMO_EMAIL: "env@acme.test", LAUNCHCLIP_DEMO_PASSWORD: "env-pass" } });
  assert.deepEqual(accounts, [
    { email: "env@acme.test", password: "env-pass", source: "env LAUNCHCLIP_DEMO_EMAIL" },
    { email: "demo@acme.test", password: "demo-pass-123", source: "scripts/seed.js" }
  ]);
});

test("guardrails: local and staging hosts pass, production hosts need --allow-host", () => {
  for (const url of ["http://localhost:3000", "http://127.0.0.1:5173", "http://[::1]:3000", "http://app.localhost", "http://acme.test", "http://192.168.1.20:8080", "http://web:3000"]) assert.equal(classifyHost(url), "local", url);
  for (const url of ["https://staging.acme.com", "https://pr-12.preview.acme.io", "https://dev.app.acme.com", "https://qa-eu.acme.com"]) assert.equal(classifyHost(url), "staging", url);
  for (const url of ["https://acme.com", "https://app.acme.com", "https://www.example.org"]) assert.equal(classifyHost(url), "production", url);
  assert.throws(() => assertSafeUrl("https://app.acme.com"), /looks like a production host.*--allow-host app\.acme\.com/);
  assert.equal(assertSafeUrl("https://app.acme.com", { allowHosts: ["app.acme.com"] }), "allowed");
  assert.throws(() => assertSafeUrl("file:///etc/passwd"), /http or https/);
});

test("guardrails: redaction and the password rule", () => {
  assert.equal(redactSecrets("key sk-abcdefghijklmnop and ghp_abcdefghijklmnop1234"), "key [REDACTED_SECRET] and [REDACTED_SECRET]");
  assert.equal(redactSecrets("password=hunter22 token: abc123"), "password=[REDACTED_SECRET] token: [REDACTED_SECRET]");
  assert.equal(redactSecrets("postgres://demo:s3cret@localhost/db"), "postgres://demo:[REDACTED_SECRET]@localhost/db");
  assert.match(redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz"), /Bearer \[REDACTED_SECRET\]/);
  assert.equal(redactWith("typed demo-pass-123", ["demo-pass-123"]), "typed ••••••••••••");
  assert.equal(typeStepProblem({ type: "type", selector: "#project-name", value: "Q3 launch" }), null);
  assert.equal(typeStepProblem({ type: "type", selector: "input[type=password]", value: { account: "password" } }), null);
  assert.match(typeStepProblem({ type: "type", selector: "input[name=password]", value: "hunter2" }), /never type a literal/);
  assert.match(typeStepProblem({ type: "type", text: "Password", value: { account: "email" } }), /password field must take/);
  assert.match(typeStepProblem({ type: "type", selector: "#key", value: "sk-abcdefghijklmnopq" }), /looks like a secret/);
});

async function freePort() {
  return new Promise((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

test("startApp runs the command, waits for health and stops the process group", async () => {
  const port = await freePort();
  const script = `require('http').createServer((q,s)=>s.end('ok')).listen(${port},'127.0.0.1',()=>console.log('ready token=abcdef123'))`;
  const app = await startApp({ command: `node -e "${script}"`, cwd: os.tmpdir(), url: `http://127.0.0.1:${port}`, timeout: 15000 });
  assert.equal((await fetch(app.url)).status, 200);
  assert.match(app.logs(), /ready token=\[REDACTED_SECRET\]/);
  await app.stop();
  await assert.rejects(fetch(app.url));
});

test("startApp refuses a production URL and reports an app that never gets healthy", async () => {
  await assert.rejects(startApp({ command: "true", cwd: os.tmpdir(), url: "https://app.acme.com" }), /production host/);
  const port = await freePort();
  await assert.rejects(startApp({ command: "echo starting; exit 3", cwd: os.tmpdir(), url: `http://127.0.0.1:${port}`, timeout: 5000 }), /exited before it became healthy[\s\S]*starting/);
});

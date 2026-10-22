// Pulseboard: a tiny fictional SaaS app that demo autopilot records in tests
// and in the proof video. No dependencies: node:http, one HTML shell, a JSON
// file store. Run `npm run seed` first (writes data/db.json from
// scripts/seed.js), then `npm run dev`.
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(ROOT, "data", "db.json");
const portFlag = process.argv.indexOf("--port");
const PORT = Number(portFlag > 0 ? process.argv[portFlag + 1] : process.env.PORT ?? 4310);

// Client-side pages; the server answers each with the app shell.
const ROUTES = [
  { path: "/", title: "Pulseboard" },
  { path: "/login", title: "Sign in" },
  { path: "/dashboard", title: "Dashboard" },
  { path: "/projects/new", title: "New project" },
  { path: "/analytics", title: "Analytics" }
];

async function db() {
  if (!existsSync(DB)) return { users: [], projects: [], sessions: {} };
  return JSON.parse(await readFile(DB, "utf8"));
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readBody(req) {
  let text = "";
  for await (const chunk of req) text += chunk;
  try { return JSON.parse(text || "{}"); } catch { return {}; }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const data = await db();
  if (url.pathname === "/healthz") return send(res, 200, { ok: true });
  if (url.pathname === "/api/login" && req.method === "POST") {
    const { email, password } = await readBody(req);
    const user = data.users.find((entry) => entry.email === email && entry.password === password);
    return user ? send(res, 200, { name: user.name, team: user.team }) : send(res, 401, { error: "Wrong email or password" });
  }
  if (url.pathname === "/api/projects" && req.method === "GET") return send(res, 200, data.projects);
  if (url.pathname === "/api/projects" && req.method === "POST") {
    const body = await readBody(req);
    const name = String(body.name ?? "").trim().slice(0, 60);
    if (!name) return send(res, 400, { error: "Name your project" });
    const project = { id: `p${data.projects.length + 1}`, name, goal: String(body.goal ?? "Signups").slice(0, 30), status: "Live", visitors: 0, conversion: 0, created: "just now" };
    data.projects.unshift(project);
    await writeFile(DB, JSON.stringify(data, null, 2));
    return send(res, 201, project);
  }
  if (url.pathname === "/app.css" || url.pathname === "/app.js") {
    const file = path.join(ROOT, "public", url.pathname.slice(1));
    return send(res, 200, await readFile(file, "utf8"), url.pathname.endsWith(".css") ? "text/css" : "text/javascript");
  }
  if (ROUTES.some((route) => route.path === url.pathname)) return send(res, 200, await readFile(path.join(ROOT, "public", "index.html"), "utf8"), "text/html");
  send(res, 404, "Not found", "text/plain");
});

server.listen(PORT, "127.0.0.1", () => console.log(`Pulseboard on http://localhost:${PORT}`));

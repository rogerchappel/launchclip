// Orderdesk: a fictional SaaS front end that signs in through SSO and loads
// all of its data from a separate API origin, which is never running here.
// This server only serves the static app, so a recording needs fixtures for
// the API and a test session for the sign-in (see demo/). No dependencies.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const portFlag = process.argv.indexOf("--port");
const PORT = Number(portFlag > 0 ? process.argv[portFlag + 1] : process.env.PORT ?? 4320);
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" };

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  const file = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!/^[a-z-]+\.(js|css|html)$/.test(file)) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
  try {
    const body = await readFile(path.join(ROOT, file), "utf8");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)], "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`Orderdesk on http://localhost:${PORT}`));

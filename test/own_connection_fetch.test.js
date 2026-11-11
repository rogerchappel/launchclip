// Each model call takes its own connection, so calls in flight together are answered together (src/own_connection_fetch.js).
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { OWN_CONNECTION_HOSTS, ownConnectionFetch } from "../src/own_connection_fetch.js";

/** A server that answers a POST only when told to; it records each request's socket. */
async function holdingServer() {
  const seen = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const entry = { port: request.socket.remotePort, body: Buffer.concat(chunks).toString("utf8"), headers: request.headers, answer: (status = 200, text = "{\"ok\":true}") => { response.writeHead(status, { "content-type": "application/json", "x-request": String(seen.indexOf(entry)) }); response.end(status === 204 ? undefined : text); } };
      seen.push(entry);
      if (request.url === "/now") entry.answer();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const until = async (count) => { for (let tries = 0; seen.length < count && tries < 200; tries += 1) await new Promise((resolve) => setTimeout(resolve, 10)); return seen.length; };
  return { seen, until, url: (pathname) => `http://127.0.0.1:${port}${pathname}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

const local = (fallback = () => { throw new Error("the fallback was asked"); }) => ownConnectionFetch(fallback, { hosts: ["127.0.0.1"], insecure: true });

test("calls sent together are in flight together, each on its own connection, after an earlier call", async () => {
  const server = await holdingServer();
  try {
    const fetch = local();
    // The call that opens the run (in make: the director, before the scenes).
    const first = await fetch(server.url("/now"), { method: "POST", body: "{\"n\":0}", headers: { "Content-Type": "application/json", Authorization: "Bearer test" } });
    assert.deepEqual([first.status, await first.json()], [200, { ok: true }]);
    const calls = [1, 2, 3].map((n) => fetch(server.url("/hold"), { method: "POST", body: JSON.stringify({ n }), headers: new Headers({ "Content-Type": "application/json" }) }));
    assert.equal(await server.until(4), 4, "all three reached the server before any was answered");
    assert.equal(new Set(server.seen.map((entry) => entry.port)).size, 4, "no two calls shared a connection");
    // Answered in the reverse of the order sent: none waits on another.
    for (const entry of server.seen.slice(1).reverse()) entry.answer();
    const answers = await Promise.all(calls);
    assert.deepEqual(answers.map((answer) => answer.headers.get("x-request")), ["1", "2", "3"]);
    assert.deepEqual(server.seen.map((entry) => JSON.parse(entry.body).n), [0, 1, 2, 3]);
    assert.deepEqual([server.seen[0].headers.authorization, server.seen[0].headers["content-type"], server.seen[0].headers["content-length"], server.seen[0].headers["accept-encoding"]], ["Bearer test", "application/json", "7", "identity"]);
  } finally { await server.close(); }
});

test("an error status, an empty answer and a refused connection come back as fetch gives them", async () => {
  const server = await holdingServer();
  const fetch = local();
  try {
    const refused = fetch(server.url("/hold"), { method: "POST", body: "{}" });
    await server.until(1);
    server.seen[0].answer(404, "{\"error\":{\"message\":\"No endpoints found\"}}");
    const answer = await refused;
    assert.deepEqual([answer.ok, answer.status, (await answer.json()).error.message], [false, 404, "No endpoints found"]);
    const empty = fetch(server.url("/hold"), { method: "POST", body: "{}" });
    await server.until(2);
    server.seen[1].answer(204);
    assert.deepEqual([(await empty).status, (await empty).body], [204, null]);
  } finally { await server.close(); }
  await assert.rejects(fetch(server.url("/now"), { method: "POST", body: "{}" }), /ECONNREFUSED/);
});

test("a call is given up when its signal aborts, before or while it is in flight", async () => {
  const server = await holdingServer();
  try {
    const fetch = local();
    const gone = AbortSignal.abort(new Error("stopped early"));
    await assert.rejects(fetch(server.url("/hold"), { method: "POST", body: "{}", signal: gone }), /stopped early/);
    assert.equal(server.seen.length, 0, "nothing was sent");
    const controller = new AbortController();
    const call = fetch(server.url("/hold"), { method: "POST", body: "{}", signal: controller.signal });
    await server.until(1);
    controller.abort(new Error("timed out"));
    await assert.rejects(call, /timed out/);
  } finally { await server.close(); }
});

test("every other request goes to the fetch it wraps, unchanged", async () => {
  const asked = [];
  const fallback = (input, init) => { asked.push([String(input), init?.method ?? "GET"]); return Promise.resolve(new Response("fallback")); };
  const fetch = ownConnectionFetch(fallback);
  assert.deepEqual(OWN_CONNECTION_HOSTS, ["openrouter.ai"]);
  // Another host, a GET, a body that is not text, a Request object, plain http: none is taken.
  await fetch("https://api.example.com/v1/chat/completions", { method: "POST", body: "{}" });
  await fetch("https://openrouter.ai/api/v1/models");
  await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", body: new Uint8Array([1]) });
  await fetch(new Request("https://openrouter.ai/api/v1/chat/completions", { method: "POST", body: "{}" }));
  await fetch("http://openrouter.ai/api/v1/chat/completions", { method: "POST", body: "{}" });
  assert.deepEqual(asked.map(([, method]) => method), ["POST", "GET", "POST", "GET", "POST"]);
  assert.equal(asked.length, 5);
});

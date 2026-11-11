// A fetch that gives each model call its own connection.
//
// Node's fetch keeps one connection to a host and sends later requests down
// it. OpenRouter answers the requests on one connection in turn: four calls
// sent together on a connection an earlier call opened came back at 17 s,
// 34 s, 51 s and 67 s, where the same four on a connection each all came back
// at 17 s. So work the model gate had in flight together (a visual
// explainer's scenes, the long-form chunks, the asset descriptions) was being
// answered one call at a time from the second call of a run onwards.
//
// ownConnectionFetch(fallback) sends a POST with a text body to one of those
// hosts on a new connection, closed when the answer ends, and hands every
// other request to `fallback` unchanged. The answer is a standard Response
// whose body streams, so a streamed reply is still read as it arrives.
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

/** The hosts whose calls each take their own connection. */
export const OWN_CONNECTION_HOSTS = Object.freeze(["openrouter.ai"]);
const BODILESS = new Set([204, 205, 304]);

const headerPairs = (headers) => {
  if (!headers) return [];
  if (typeof headers.entries === "function") return [...headers.entries()];
  return Array.isArray(headers) ? headers : Object.entries(headers);
};

function send(url, init) {
  const signal = init.signal ?? null;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? new DOMException("This operation was aborted", "AbortError")); return; }
    const body = Buffer.from(init.body, "utf8");
    const headers = { "accept-encoding": "identity" };
    for (const [name, value] of headerPairs(init.headers)) headers[String(name).toLowerCase()] = String(value);
    headers["content-length"] = String(body.length);
    // agent: false opens a connection for this request alone and closes it afterwards.
    const request = (url.protocol === "http:" ? http : https).request(url, { method: "POST", agent: false, headers }, (response) => {
      const answer = new Headers();
      for (const [name, value] of Object.entries(response.headers)) for (const entry of Array.isArray(value) ? value : [value]) answer.append(name, String(entry));
      const status = response.statusCode ?? 502;
      if (BODILESS.has(status)) response.resume();
      resolve(new Response(BODILESS.has(status) ? null : Readable.toWeb(response), { status, statusText: response.statusMessage ?? "", headers: answer }));
    });
    const abort = () => request.destroy(signal.reason ?? new DOMException("This operation was aborted", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    request.on("close", () => signal?.removeEventListener("abort", abort));
    request.on("error", reject);
    request.end(body);
  });
}

/**
 * fallback: the fetch every other request uses. options: {hosts (default
 * OWN_CONNECTION_HOSTS), insecure (also take http: URLs; for tests)}.
 */
export function ownConnectionFetch(fallback, { hosts = OWN_CONNECTION_HOSTS, insecure = false } = {}) {
  return function fetchOnOwnConnection(input, init = {}) {
    let url = null;
    if (typeof input === "string" || input instanceof URL) { try { url = new URL(String(input)); } catch { url = null; } }
    const mine = url && String(init?.method ?? "GET").toUpperCase() === "POST" && typeof init.body === "string" && hosts.includes(url.hostname) && (url.protocol === "https:" || (insecure && url.protocol === "http:"));
    return mine ? send(url, init) : fallback(input, init);
  };
}

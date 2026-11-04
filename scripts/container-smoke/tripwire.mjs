// Preloaded into every Node process of the container smoke (NODE_OPTIONS
// --import). Any fetch() that is not to the local model stub is recorded in
// $SMOKE_TRIPWIRE and refused, and any other DNS lookup (http.get and the
// like, such as Remotion's browser download) is recorded. That catches model
// downloads (Whisper, ONNX subject mattes, Kokoro through
// @huggingface/transformers) and paid calls even when the caller swallows the
// error. The container also runs with --network none, so nothing gets out.
import dns from "node:dns";
import { appendFileSync } from "node:fs";
import net from "node:net";

const file = process.env.SMOKE_TRIPWIRE;
const allowed = new Set(["127.0.0.1", "localhost", "[::1]"]);
const original = globalThis.fetch;

if (file && original) {
  globalThis.fetch = async function tripwireFetch(resource, init) {
    const url = new URL(typeof resource === "string" || resource instanceof URL ? resource : resource.url);
    if (!allowed.has(url.hostname)) {
      appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), kind: "fetch", url: url.href, pid: process.pid, argv: process.argv.slice(1, 3) })}\n`);
      throw new Error(`container smoke: network fetch to ${url.host} is not allowed`);
    }
    return original(resource, init);
  };
}

if (file) {
  const lookup = dns.lookup;
  dns.lookup = function tripwireLookup(hostname, ...rest) {
    if (!allowed.has(hostname) && !net.isIP(String(hostname))) appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), kind: "dns", url: hostname, pid: process.pid, argv: process.argv.slice(1, 3) })}\n`);
    return lookup.call(this, hostname, ...rest);
  };
}

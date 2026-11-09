// The skill path: an agent with its own web tools hands in claims.json, and
// the CLI freezes, verifies and builds captures exactly as it does headless.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readClaims, runResearch } from "../src/research/index.js";

const NOW = "2026-11-10T00:00:00.000Z";
const PAGE = `<!doctype html><html><head><title>Nimbus-7B is now generally available | Nimbus AI</title><meta property="og:site_name" content="Nimbus AI"><meta property="article:published_time" content="2026-11-06T15:00:00Z"></head><body><article><h1>Nimbus-7B is now generally available</h1><p>Nimbus-7B scores 71.4 on HumanEval.</p><p>Anyone can download the weights and use them in a product without asking us.</p></article></body></html>`;
const fetch = async (url) => url === "https://nimbus.ai/blog/nimbus-7b-ga" ? new Response(PAGE, { status: 200, headers: { "content-type": "text/html" } }) : new Response("", { status: 404 });

test("claims.json: the sources an agent names are fetched and frozen, and its passage must be on the page word for word", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-claims-file-"));
  try {
    await writeFile(path.join(dir, "SCRIPT.md"), "Nimbus AI made Nimbus-7B generally available. The weights are open for commercial use. It was trained on 9 trillion tokens.\n");
    await writeFile(path.join(dir, "claims.json"), JSON.stringify({ claims: [
      { text: "The weights are open for commercial use.", source_url: "https://nimbus.ai/blog/nimbus-7b-ga", passage: "Anyone can download the weights and use them in a product without asking us." },
      // A passage the page does not hold never verifies, whatever the agent says.
      { text: "It was trained on 9 trillion tokens.", source_url: "https://nimbus.ai/blog/nimbus-7b-ga", passage: "Nimbus-7B was trained on 9 trillion tokens of licensed text." }
    ] }));
    const report = await runResearch("SCRIPT.md", { cwd: dir, out: "research", claims: "claims.json", now: NOW, news: "none", media: "none", people: "none", logos: "none", social: "none" }, { fetch, env: {} });
    const ledger = JSON.parse(await readFile(path.join(dir, "research", "evidence.json"), "utf8"));
    const open = ledger.claims.find((claim) => claim.text === "The weights are open for commercial use.");
    assert.equal(open.status, "verified");
    assert.equal(open.sources[0].url, "https://nimbus.ai/blog/nimbus-7b-ga");
    assert.equal(open.sources[0].matched_by, "passage");
    assert.equal(open.sources[0].quote.text, "Anyone can download the weights and use them in a product without asking us.");
    assert.match(open.sources[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(open.published_at, "2026-11-06T15:00:00.000Z");
    assert.ok(open.capture, "a verified claim from claims.json gets a capture request like any other");
    const trained = ledger.claims.find((claim) => claim.text === "It was trained on 9 trillion tokens.");
    assert.equal(trained.status, "unverified");
    assert.ok(trained.flag);
    assert.ok(report.flagged.some((claim) => claim.id === trained.id));
    const request = JSON.parse(await readFile(path.join(dir, "research", "captures", `${open.capture}.json`), "utf8"));
    assert.equal(request.url, "https://nimbus.ai/blog/nimbus-7b-ga");
    assert.ok(request.claims.includes(open.id));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("claims.json: a passage must carry the claim's numbers", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-claims-file-"));
  try {
    const claims = [{ text: "Nimbus-7B reaches 91.4 on its main benchmark.", source_url: "https://nimbus.ai/blog/nimbus-7b-ga", passage: "Nimbus-7B scores 71.4 on HumanEval." }];
    await runResearch("Nimbus-7B reaches 91.4 on its main benchmark.", { cwd: dir, out: "research", claims, now: NOW, news: "none", media: "none", people: "none", logos: "none", social: "none" }, { fetch, env: {} });
    const ledger = JSON.parse(await readFile(path.join(dir, "research", "evidence.json"), "utf8"));
    assert.notEqual(ledger.claims.find((claim) => /91\.4/.test(claim.text)).status, "verified");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("claims.json: the shape is checked, with the claim that is wrong named", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-claims-file-"));
  try {
    const write = (value) => writeFile(path.join(dir, "claims.json"), typeof value === "string" ? value : JSON.stringify(value));
    await write({ claims: [{ text: "A.", sources: ["https://a.example/x"] }, { text: " B. ", source_url: "https://b.example/y" }], urls: ["https://c.example/z", "ftp://nope"] });
    assert.deepEqual(await readClaims("claims.json", dir), { claims: [{ text: "A.", sources: ["https://a.example/x"], origin: "agent" }, { text: "B.", source_url: "https://b.example/y", origin: "agent" }], urls: ["https://c.example/z", "https://a.example/x", "https://b.example/y"] });
    await write([{ text: "Bare array." }]);
    assert.equal((await readClaims("claims.json", dir)).claims[0].origin, "agent");
    await write({ claims: [{ search: "no text" }] });
    await assert.rejects(readClaims("claims.json", dir), /claim 1 has no "text"/);
    await write({ claims: [{ text: "A.", source_url: "nimbus.ai/blog" }] });
    await assert.rejects(readClaims("claims.json", dir), /claim 1 names a source that is not an http\(s\) URL/);
    await write({ facts: [] });
    await assert.rejects(readClaims("claims.json", dir), /expected \{"claims"/);
    await write("{nope");
    await assert.rejects(readClaims("claims.json", dir), /is not JSON/);
    await assert.rejects(readClaims("missing.json", dir), /no such file/);
    assert.deepEqual(await readClaims(undefined, dir), { claims: [], urls: [] });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

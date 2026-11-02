import assert from "node:assert/strict";
import test from "node:test";
import { entityIndex, extractClaims } from "../src/research/claims.js";
import { createHttp } from "../src/research/http.js";
import { classifySnapshot, classifyUrl, findSources, primaryQueries } from "../src/research/sources.js";
import { buildLedger, verifyClaim } from "../src/research/verify.js";
import { buildCaptureRequests } from "../src/research/capture.js";
import { researchNotes, SOURCE_RULES } from "../src/research/index.js";
import { validateLedger } from "../src/research/schema.js";

// A roundup of the month's releases, the way an AI-news site writes one: it
// repeats the company's claim next to other companies' news.
const ROUNDUP = {
  url: "https://dailyainews.example/october-2026-ai-releases",
  title: "October AI releases · Daily AI News",
  text: "Nimbus AI released Nimbus-7B on October 14, 2026, an open model with a 128K context.\nRival Labs shipped Rival-8B the same week.\nTitan Corp cut prices on Titan 2."
};
// The company's own announcement.
const ANNOUNCEMENT = {
  url: "https://nimbus.ai/blog/nimbus-7b",
  title: "Introducing Nimbus-7B",
  text: "Today Nimbus AI released Nimbus-7B on October 14, 2026: an open-weights model with a 128K token context."
};
const CLAIM = "Nimbus AI released Nimbus-7B on October 14, 2026.";

function snapshot(fields, names) {
  return { fetched_at: "2026-10-27T00:00:00.000Z", sha256: "b".repeat(64), publisher: new URL(fields.url).hostname, ...fields, ...classifySnapshot(fields, names) };
}

test("classifyUrl: a company's own domain and official account are primary; roundups and lookalike domains are not", () => {
  const names = ["Nimbus AI", "Nimbus-7B"];
  assert.equal(classifyUrl("https://nimbus.ai/blog/nimbus-7b", names).source_class, "primary");
  assert.equal(classifyUrl("https://news.nimbusai.com/press/launch", names).source_class, "primary");
  assert.equal(classifyUrl("https://x.com/nimbusai/status/1", names).source_class, "primary");
  assert.equal(classifyUrl("https://x.com/aifan/status/2", names).source_class, "secondary");
  assert.deepEqual([classifyUrl(ROUNDUP.url, names).primary, classifyUrl(ROUNDUP.url, names).source_class], [false, "aggregator"]);
  assert.equal(classifyUrl("https://nimbus-news-digest.example/a", names).primary, false, "a lookalike domain is not the company's");
  assert.equal(classifyUrl("https://seoblog.example/nimbus-7b-review", names).source_class, "secondary");
  // A roundup stays a roundup even on a named domain.
  assert.equal(classifyUrl("https://nimbus.ai/blog/this-week-in-ai", names).primary, false);
});

test("classifySnapshot: a page covering many of the named companies is an aggregator; a first-hand report is primary", () => {
  const names = ["Nimbus AI", "Nimbus-7B", "Rival Labs", "Rival-8B", "Titan Corp", "Titan 2"];
  const covering = { url: "https://techpulse.example/ai/models", title: "The new models", text: ROUNDUP.text };
  assert.equal(classifySnapshot(covering, names).source_class, "aggregator");
  const report = { url: "https://bignews.example/tech/nimbus-7b", title: "Nimbus releases open model", text: "Nimbus AI released Nimbus-7B on October 14, 2026, a spokesperson for the company said in a statement." };
  assert.deepEqual([classifySnapshot(report, names).primary, classifySnapshot(report, names).report], [true, true]);
  assert.equal(classifySnapshot({ ...ANNOUNCEMENT }, names).source_class, "primary");
});

test("an aggregator alone never verifies a claim; it is marked for the script to drop", () => {
  const [claim] = extractClaims(CLAIM);
  const names = entityIndex([claim]).map((entity) => entity.name);
  const verdict = verifyClaim(claim, [snapshot(ROUNDUP, names)]);
  assert.equal(verdict.status, "unverified");
  assert.equal(verdict.no_primary_source, true);
  assert.equal(verdict.flag.action, "drop");
  assert.equal(verdict.sources[0].source_class, "aggregator");
});

test("the company page is promoted over the aggregator: it verifies the claim, leads the sources and is the capture", () => {
  const claims = extractClaims(CLAIM);
  const names = entityIndex(claims).map((entity) => entity.name);
  const ledger = buildLedger({ claims, snapshots: [snapshot(ROUNDUP, names), snapshot(ANNOUNCEMENT, names)], entities: entityIndex(claims), now: "2026-10-27T00:00:00.000Z", search: "brave", input: { kind: "topic", topic: "x" } });
  assert.deepEqual(validateLedger(ledger), []);
  const [entry] = ledger.claims;
  assert.equal(entry.status, "verified");
  assert.equal(entry.sources[0].url, ANNOUNCEMENT.url);
  assert.equal(entry.sources[0].primary, true);
  assert.equal(entry.sources.find((source) => source.url === ROUNDUP.url).primary, false);
  const { requests } = buildCaptureRequests(ledger);
  assert.deepEqual(requests.map((request) => request.url), [ANNOUNCEMENT.url]);
  assert.match(researchNotes(ledger), /\[c001\] .*\(source: nimbus\.ai\)/);
  // When the primary support is an API fact (checked, never shown), the aggregator does not go on screen instead.
  const apiOnly = structuredClone(ledger);
  apiOnly.claims[0].sources[0].quote.text = "GitHub API: Repository nimbus/nimbus-7b; Created: 2026-10-14.";
  assert.deepEqual(buildCaptureRequests(apiOnly).requests, []);
});

test("findSources searches again for the company's page when a search returns only an aggregator", async () => {
  const searches = [];
  const pages = { [ROUNDUP.url]: ROUNDUP.text, [ANNOUNCEMENT.url]: ANNOUNCEMENT.text };
  const fetch = async (url) => {
    const respond = (body) => ({ ok: body != null, status: body != null ? 200 : 404, url, headers: new Map(), text: async () => typeof body === "string" ? body : JSON.stringify(body ?? {}) });
    if (url.startsWith("https://api.search.brave.com/")) {
      const query = new URL(url).searchParams.get("q");
      searches.push(query);
      // The open query finds the roundup; asking for the company's announcement finds its page.
      const hit = /^Nimbus AI Nimbus-7B announcement/.test(query) ? ANNOUNCEMENT : ROUNDUP;
      return respond({ web: { results: [{ url: hit.url, title: hit.title }] } });
    }
    return respond(pages[url]);
  };
  const http = createHttp({ fetch, env: {}, now: () => "2026-10-27T00:00:00.000Z" });
  const claims = extractClaims(CLAIM);
  const { sources } = await findSources(http, entityIndex(claims), { env: { BRAVE_API_KEY: "test" } });
  assert.deepEqual(searches, ["Nimbus-7B announcement", "Nimbus AI Nimbus-7B announcement"]);
  const byUrl = Object.fromEntries(sources.map((source) => [source.url, source]));
  assert.equal(byUrl[ROUNDUP.url].source_class, "aggregator");
  assert.equal(byUrl[ANNOUNCEMENT.url].source_class, "primary");
  assert.equal(verifyClaim(claims[0], sources).sources[0].url, ANNOUNCEMENT.url);
});

test("primaryQueries restricts the follow-up to the company's domain once a page on it is known", () => {
  const owners = ["Nimbus AI", "Nimbus-7B"];
  assert.deepEqual(primaryQueries("Nimbus-7B context length", owners, [{ url: "https://www.nimbus.ai/pricing" }, { url: "https://github.com/nimbus/x" }]), [
    "Nimbus AI Nimbus-7B announcement site:nimbus.ai",
    "Nimbus AI Nimbus-7B announcement",
    "Nimbus AI Nimbus-7B blog"
  ]);
  assert.deepEqual(primaryQueries("open models this month", owners), ["open models this month official announcement"]);
});

test("the script notes forbid naming an aggregator or a report, and list the stories to drop", () => {
  const [claim] = extractClaims(CLAIM);
  const names = entityIndex([claim]).map((entity) => entity.name);
  const ledger = buildLedger({ claims: [claim], snapshots: [snapshot(ROUNDUP, names)], entities: [], now: "2026-10-27T00:00:00.000Z", input: { kind: "topic", topic: "x" } });
  const notes = researchNotes(ledger);
  for (const rule of SOURCE_RULES) assert.ok(notes.includes(rule));
  assert.match(notes, /Never name an aggregator/);
  assert.match(notes, /attributed to the company that made it/);
  assert.match(notes, /Drop these stories: no primary source[^\n]*\n- \[c001\] Nimbus AI released Nimbus-7B/);
  assert.doesNotMatch(notes, /Verified claims:/);
});

// Official X posts behind verified claims (src/research/social.js): found in
// the claim's sources and by x.com search, confirmed by the oEmbed record,
// kept only when the account is the entity's own, and emitted as an x-embed
// capture request plus social-post card params.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MODULES } from "@launchclip/core/catalog-h.mjs";
import { resolveRoute } from "../src/evidence/routes.js";
import { createHttp } from "../src/research/http.js";
import { runResearch } from "../src/research/index.js";
import { findSocialPosts, isOfficial, ownersOf, snowflakeDate } from "../src/research/social.js";
import { validateCapture, validateSocial } from "../src/research/schema.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "research", "social");
const OEMBED = JSON.parse(await readFile(path.join(FIXTURE, "oembed.json"), "utf8"));
const PAGE_HTML = await readFile(path.join(FIXTURE, "announcement.html"), "utf8");
const PAGE = "https://nimbus.ai/blog/nimbus-7b";
const NOW = "2026-11-03T00:00:00.000Z";
const OFFICIAL = "1849512345678901248";
const FAN = "1849600000000000000";

const CLAIM = {
  id: "c001",
  text: "Nimbus AI released Nimbus-7B with a 128K context window.",
  kind: "number",
  status: "verified",
  values: [{ raw: "128K context", value: 128000, unit: "context" }],
  entities: [{ name: "Nimbus-7B", kind: "model" }, { name: "Nimbus AI", kind: "org" }],
  sources: [{ url: PAGE, primary: true, supports: true, confidence: 0.9, fetched_at: NOW, quote: { text: "Nimbus-7B ships with open weights under the MIT License and a 128K context window." } }]
};
const LEDGER = { schema: "launchclip.evidence.v1", claims: [CLAIM] };
const SNAPSHOTS = [{ url: PAGE, kind: "article", primary: true, text: "Introducing Nimbus-7B\nNimbus-7B ships with open weights under the MIT License and a 128K context window." }];

/** A fake network: the announcement page, the recorded oEmbed records (unless `oembed` is false), 404 for the rest. */
function fakeFetch({ oembed = true, calls = [] } = {}) {
  return async (url) => {
    calls.push(url);
    if (url === PAGE) return new Response(PAGE_HTML, { status: 200, headers: { "content-type": "text/html" } });
    if (url.startsWith("https://publish.twitter.com/oembed?")) {
      const target = new URL(url).searchParams.get("url");
      const record = oembed && OEMBED[target.split("/").pop()];
      return record ? Response.json(record) : new Response("", { status: 404 });
    }
    return new Response("", { status: 404 });
  };
}

const ctx = { id: "scene", start: 1, duration: 8, format: { width: 1920, height: 1080, fps: 30 }, aspect: "16:9", hits: [],
  brand: { colors: { bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", ink: "#06070d", paper: "#f2eee6" }, fonts: { display: "anton", body: "space-grotesk", meta: "jetbrains-mono" } } };

test("the company's own post embedded on its announcement page is accepted; a tester's embedded post is rejected", async () => {
  const calls = [];
  const http = createHttp({ fetch: fakeFetch({ calls }), env: {} });
  const { manifest, requests } = await findSocialPosts(http, LEDGER, { snapshots: SNAPSHOTS, now: NOW });
  assert.deepEqual(validateSocial(manifest), []);
  assert.equal(manifest.posts.length, 1);
  const [post] = manifest.posts;
  assert.equal(post.url, `https://x.com/NimbusAI/status/${OFFICIAL}`);
  assert.equal(post.handle, "@NimbusAI");
  assert.equal(post.name, "Nimbus AI");
  assert.equal(post.entity, "Nimbus AI");
  assert.equal(post.confirmed_by, "oembed");
  assert.equal(post.found_via, `source:${PAGE}`);
  assert.deepEqual(post.claims, ["c001"]);
  // X's short links and media link are trimmed; the post's words stay verbatim.
  assert.equal(post.text, "Nimbus-7B is out today: open weights under the MIT License and a 128K context window.\n\nModel card and evals:");
  assert.equal(post.published_at, snowflakeDate(OFFICIAL));
  assert.equal(post.published_at.slice(0, 10), "2024-10-24");
  // The tester is named in the same page, but is not Nimbus AI.
  assert.deepEqual(manifest.rejected, [{ url: `https://x.com/dev_jane/status/${FAN}`, handle: "@dev_jane", reason: "@dev_jane is not an official account of Nimbus AI" }]);
  // Both posts were checked against publish.twitter.com, and x.com itself was never opened.
  assert.equal(calls.filter((url) => url.startsWith("https://publish.twitter.com/oembed")).length, 2);
  assert.ok(!calls.some((url) => /^https:\/\/(?:www\.)?(?:x|twitter)\.com\//.test(url)));

  // One capture request on the x-embed route, highlighting the claim's words.
  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.deepEqual(validateCapture(request), []);
  assert.equal(request.kind, "post");
  assert.equal(request.id, post.capture);
  assert.equal(resolveRoute(request).name, "x-embed");
  assert.equal(resolveRoute(request).post.id, OFFICIAL);
  const highlight = request.beats.find((beat) => beat.action === "highlight");
  assert.ok(highlight && post.text.includes(highlight.target.text) && /128K/.test(highlight.target.text));
  assert.equal(request.beats.at(-1).label, "@NimbusAI on X");

  // The card: social-post params the kit module resolves, with the capture as its source.
  assert.equal(post.card.module, "social-post");
  const { params } = post.card;
  assert.equal(params.platform, "x");
  assert.equal(params.date, "Oct 24, 2024");
  assert.deepEqual(params.source, { url: post.url, captured_at: NOW, schema: "launchclip.capture.v1", id: request.id });
  assert.equal(params.highlight, highlight.target.text);
  const model = MODULES["social-post"].resolve(params, ctx);
  assert.equal(model.content.post.handle, "NimbusAI");
  assert.equal(model.content.post.source.url, post.url);
  // The capture carries the post as evidence.data for the beat director (no highlight: the clause picks one).
  const { highlight: _phrase, ...data } = params;
  assert.deepEqual(request.data, data);
});

test("no oEmbed record: the entity's own embed markup confirms its post; a search hit with nothing to confirm it is left out", async () => {
  const http = createHttp({ fetch: fakeFetch({ oembed: false }), env: {} });
  const queries = [];
  const search = { name: "fake", async run(_http, query) { queries.push(query); return [{ url: "https://x.com/NimbusAI/status/1849700000000000000", title: "Nimbus AI on X" }]; } };
  const second = { ...CLAIM, id: "c002", text: "Nimbus-7B scores 72.5 on HumanEval.", values: [{ raw: "72.5", value: 72.5 }], entities: [{ name: "Nimbus-7B", kind: "model" }, { name: "HumanEval", kind: "benchmark" }], sources: [{ url: "https://huggingface.co/nimbus-ai/Nimbus-7B", primary: true, supports: true, confidence: 0.9, fetched_at: NOW, quote: { text: "HumanEval | 72.5" } }] };
  const ledger = { ...LEDGER, claims: [CLAIM, second] };
  const { manifest, requests } = await findSocialPosts(http, ledger, { snapshots: SNAPSHOTS, search, now: NOW });
  assert.deepEqual(validateSocial(manifest), []);
  assert.deepEqual(manifest.posts.map((post) => [post.handle, post.confirmed_by, post.claims]), [["@NimbusAI", "embed markup", ["c001"]]]);
  assert.equal(manifest.posts[0].card.params.text, "Nimbus-7B is out today: open weights under the MIT License and a 128K context window.\n\nModel card and evals:");
  assert.equal(requests.length, 1);
  // The second claim's owner comes from its Hugging Face repo (nimbus-ai), and its search stays on x.com.
  assert.deepEqual(queries, ["site:x.com/NimbusAI Nimbus-7B"]);
  const reasons = Object.fromEntries(manifest.rejected.map((entry) => [entry.url.split("/").pop(), entry.reason]));
  assert.match(reasons["1849700000000000000"], /no oEmbed record/);
  // The tester's embed is on Nimbus AI's page, but markup only vouches for the page owner's own post.
  assert.match(reasons[FAN], /not an official account/);
});

test("official means the entity's own handle: its name plus affix words, or one the caller names", () => {
  const owners = ["Nimbus AI"];
  for (const handle of ["NimbusAI", "nimbus_ai", "nimbus_hq", "AIatNimbus", "NimbusLabs"]) assert.equal(isOfficial(handle, owners).ok, true, handle);
  for (const handle of ["nimbusfan99", "dev_jane", "NimbusLeaks", "cumulonimbus"]) assert.equal(isOfficial(handle, owners).ok, false, handle);
  assert.equal(isOfficial("skyworks", owners, new Map([["nimbusai", ["skyworks"]]])).ok, true);
  assert.deepEqual(ownersOf({ entities: [{ name: "Nimbus AI", kind: "org" }], sources: [{ url: "https://github.com/nimbus-labs/n7b", primary: true }, { url: "https://nimbus.ai/blog", primary: true }, { url: "https://news.example.com/a", primary: false }] }), ["Nimbus AI", "nimbus-labs"]);
});

test("research writes social.json and an x-embed capture for the post behind a verified claim", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-social-"));
  const script = path.join(dir, "script.md");
  await writeFile(script, "Nimbus AI released Nimbus-7B with open weights under the MIT License and a 128K context window.\n");
  const out = path.join(dir, "research");
  const report = await runResearch(script, { out, urls: [PAGE], media: "none", people: "none", now: NOW, cwd: dir }, { fetch: fakeFetch(), env: {} });
  const social = JSON.parse(await readFile(report.files.social, "utf8"));
  assert.deepEqual(validateSocial(social), []);
  assert.deepEqual(social.posts.map((post) => post.handle), ["@NimbusAI"]);
  assert.equal(report.summary.posts, 1);
  const capture = JSON.parse(await readFile(path.join(out, "captures", `${social.posts[0].capture}.json`), "utf8"));
  assert.equal(capture.kind, "post");
  assert.equal(capture.data.handle, "@NimbusAI");
  const ledger = JSON.parse(await readFile(report.files.ledger, "utf8"));
  assert.deepEqual(ledger.claims.find((claim) => claim.posts)?.posts, [OFFICIAL]);
  assert.match(await readFile(report.files.digest, "utf8"), /## Posts on X\n\n- Nimbus AI \(@NimbusAI\)/);
});

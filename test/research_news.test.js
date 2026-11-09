import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHttp, robotsAllow, robotsRules } from "../src/research/http.js";
import { datedClaims, researchNotes, runResearch } from "../src/research/index.js";
import { currentEventItems, feedLinks, findNewsLeads, freshDaysOption, freshnessWindow, gdeltDate, headlineOf, newsQueries, outboundLinks, parseFeed, storyOwners } from "../src/research/news.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "research", "news", "recording.json");
const NOW = "2026-11-10T00:00:00.000Z";

// The recording, replayed: any URL it does not hold is a 404, so nothing here touches the network.
async function replay() {
  const recording = JSON.parse(await readFile(FIXTURE, "utf8"));
  const asked = [];
  const fetch = async (url, init = {}) => {
    asked.push(String(url));
    const key = /^https:\/\/hn\.algolia\.com\/api\/v1\/search\?query=Nimbus%20AI&/.test(url) ? "HN" : String(url);
    const hit = recording.responses.find((entry) => entry.url === key && entry.method === (init.method ?? "GET"));
    if (!hit) return new Response("", { status: 404 });
    return new Response(hit.body, { status: hit.status, headers: { "content-type": hit.content_type ?? "" } });
  };
  return { fetch, asked };
}

test("a keyless run on a news brief finds this week's stories and keeps only the ones a primary source states", async () => {
  const { fetch, asked } = await replay();
  const out = await mkdtemp(path.join(os.tmpdir(), "launchclip-research-news-"));
  try {
    const report = await runResearch("What did Nimbus AI announce this week?", { out, now: NOW, media: "none", people: "none", logos: "none", social: "none" }, { fetch, env: {}, sleep: async () => {} });
    const news = JSON.parse(await readFile(path.join(out, "news.json"), "utf8"));
    assert.equal(news.schema, "launchclip.research-news.v1");
    assert.deepEqual(news.queries, ["Nimbus AI"]);
    assert.deepEqual(news.freshness, { days: 10, asked_by: "this week" });
    assert.deepEqual(news.providers.map((provider) => [provider.id, provider.leads]), [["feeds", 2], ["hacker-news", 4], ["gdelt", 1], ["wikipedia", 1]]);
    const story = (url) => news.stories.find((entry) => entry.url === url);
    // The company's own post, found in its feed and on Hacker News: kept, and its headline is a verified claim.
    const ga = story("https://nimbus.ai/blog/nimbus-7b-ga");
    assert.deepEqual([ga.status, ga.primary, ga.via, ga.published_at], ["kept", true, ["feed:nimbus.ai", "hacker-news"], "2026-11-06T15:00:00.000Z"]);
    assert.equal(story("https://nimbus.ai/blog/series-b").status, "kept");
    // A report is not a primary source, but the company page it cites is followed and kept.
    assert.deepEqual([story("https://technewsdesk.example/2026/11/nimbus-series-b").status, story("https://technewsdesk.example/2026/11/nimbus-series-b").source_class], ["no-primary-source", "secondary"]);
    assert.equal(story("https://nimbus.ai/press/series-b-faq").from, "https://technewsdesk.example/2026/11/nimbus-series-b");
    // An outlet's first-hand report counts; a roundup never does.
    assert.equal(story("https://www.wirepost.example/2026/11/07/nimbus-ai-pauses-eu-rollout").status, "kept");
    assert.deepEqual([story("https://roundupweekly.example/this-week-in-ai").status, story("https://roundupweekly.example/this-week-in-ai").source_class], ["no-primary-source", "aggregator"]);
    // The page's own date beats the day it was reposted: a three-month-old post is not this week's news.
    assert.equal(story("https://nimbus.ai/blog/nimbus-5b").status, "stale");
    // robots.txt closes a page: it is not read, and the story says why.
    assert.deepEqual([story("https://paywalled.example/nimbus-quiet-year").status, story("https://paywalled.example/nimbus-quiet-year").reason], ["not-fetched", "its robots.txt does not allow this client"]);
    assert.ok(!asked.includes("https://paywalled.example/nimbus-quiet-year"));
    // A video host is never a lead, and GDELT is asked once.
    assert.ok(!asked.some((url) => /youtube\.com/.test(url)));
    assert.equal(asked.filter((url) => /api\.gdeltproject\.org/.test(url)).length, 1);

    const ledger = JSON.parse(await readFile(path.join(out, "evidence.json"), "utf8"));
    const headlines = ledger.claims.filter((claim) => claim.headline);
    assert.deepEqual(headlines.map((claim) => [claim.text, claim.status, String(claim.published_at).slice(0, 10)]), [
      ["Nimbus AI pauses EU rollout of Nimbus-7B", "verified", "2026-11-07"],
      ["Nimbus-7B is now generally available", "verified", "2026-11-06"],
      ["Series B: questions and answers", "verified", "2026-11-03"],
      ["Nimbus AI raises $40 million in Series B funding", "verified", "2026-11-03"]
    ]);
    assert.ok(headlines.every((claim) => claim.capture && claim.sources[0].primary));
    assert.deepEqual(ledger.freshness, { days: 10, asked_by: "this week" });
    assert.equal(ledger.summary.stale, 0);
    assert.equal(report.summary.stories, 4);
    assert.equal(ga.claim, headlines[1].id);
    // The script pass hears the stories and their dates, and never how they were found.
    const notes = researchNotes(ledger);
    assert.match(notes, /Nimbus-7B is now generally available \(source: Nimbus AI, published 2026-11-06\)/);
    assert.doesNotMatch(notes, /Hacker News|GDELT|Wikipedia|Roundup Weekly|Nimbus-5B for phones/);
    const digest = await readFile(path.join(out, "RESEARCH.md"), "utf8");
    assert.match(digest, /## News leads/);
    assert.match(digest, /\*\*too old\*\* 2026-08-01: Introducing Nimbus-5B for phones/);
    assert.match(digest, /\*\*dropped, no primary source\*\* 2026-11-08: This week in AI/);
  } finally { await rm(out, { recursive: true, force: true }); }
});

test("--news none skips the keyless news sources", async () => {
  const { fetch, asked } = await replay();
  const out = await mkdtemp(path.join(os.tmpdir(), "launchclip-research-news-"));
  try {
    const report = await runResearch("What did Nimbus AI announce this week?", { out, now: NOW, news: "none", media: "none", people: "none", logos: "none", social: "none" }, { fetch, env: {} });
    assert.equal(report.summary.stories, 0);
    assert.ok(!asked.some((url) => /algolia|gdelt|wikipedia\.org|firebaseio/.test(url)));
  } finally { await rm(out, { recursive: true, force: true }); }
});

test("a brief that asks for the latest flags a verified claim whose source is old or undated", () => {
  const claim = (id, published_at) => ({ id, text: `claim ${id}`, status: "verified", sources: [{ url: "https://nimbus.ai/blog", publisher: "Nimbus AI", primary: true, supports: true, published_at }] });
  const ledger = { summary: {}, claims: [claim("c001", "2026-11-06T00:00:00.000Z"), claim("c002", "2026-08-01T00:00:00.000Z"), claim("c003", null), { id: "c004", text: "x", status: "unverified", sources: [], flag: { action: "cut", message: "m" } }] };
  datedClaims(ledger, { now: NOW, window: { days: 10, asked_by: "this week" } });
  assert.equal(ledger.claims[0].published_at, "2026-11-06T00:00:00.000Z");
  assert.equal(ledger.claims[0].flag, undefined);
  assert.deepEqual(ledger.claims[1].stale, { published_at: "2026-08-01T00:00:00.000Z", age_days: 101, window_days: 10 });
  assert.match(ledger.claims[1].flag.message, /published this on 2026-08-01, 101 days before this run; the brief asks for the last 10 days \("this week"\)/);
  assert.equal(ledger.claims[2].undated, true);
  assert.deepEqual([ledger.summary.stale, ledger.summary.undated], [1, 1]);
  const notes = researchNotes({ ...ledger, summary: { sources_checked: 3 }, excerpts: [] });
  assert.match(notes, /Old news \(the brief asks for the last 10 days\)[^\n]*\n- \[c002\] claim c002 \(published 2026-08-01\)/);
  assert.doesNotMatch(notes.split("Old news")[0], /c002/);
  // With no window every claim still carries its date, and nothing is flagged.
  const plain = { summary: {}, claims: [claim("c001", "2026-08-01T00:00:00.000Z")] };
  datedClaims(plain, { now: NOW });
  assert.deepEqual([plain.claims[0].published_at, plain.claims[0].stale, plain.freshness], ["2026-08-01T00:00:00.000Z", undefined, undefined]);
});

test("the freshness window comes from the brief's own words, or --fresh-days", () => {
  assert.deepEqual(freshnessWindow("today's top stories"), { days: 3, asked_by: "today's" });
  assert.deepEqual(freshnessWindow("The latest AI news this week"), { days: 10, asked_by: "this week" });
  assert.deepEqual(freshnessWindow("the latest on fusion"), { days: 14, asked_by: "latest" });
  assert.equal(freshnessWindow("How does compound interest work?"), null);
  assert.equal(freshDaysOption(undefined), undefined);
  assert.equal(freshDaysOption("none"), null);
  assert.equal(freshDaysOption("30"), 30);
  assert.throws(() => freshDaysOption("soon"), /--fresh-days must be a number of days or none/);
});

test("news queries are what the brief names, else its subject, never its format words", () => {
  const entities = [{ name: "Nimbus AI", kind: "org" }, { name: "Nimbus-7B", kind: "model" }];
  assert.deepEqual(newsQueries("Why Nimbus AI released Nimbus-7B", entities), ["Nimbus-7B", "Nimbus AI"]);
  assert.deepEqual(newsQueries("# Brief\n\nA 60-second video on the latest in quantum computing", []), ["quantum computing"]);
  assert.deepEqual(newsQueries("today's top news", []), []);
});

test("feeds: the site's advertised feed is found, and RSS and Atom both parse newest first", () => {
  assert.deepEqual(feedLinks('<link rel="alternate" type="application/atom+xml" href="/feed.atom"><link rel="alternate" type="application/rss+xml" href="https://nimbus.ai/comments/feed"><link rel="stylesheet" href="/a.css">', "https://nimbus.ai/blog"), ["https://nimbus.ai/feed.atom"]);
  const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Older &amp; wiser</title><link rel="alternate" href="/a"/><updated>2026-11-01T00:00:00Z</updated><summary>One</summary></entry><entry><title>Newer</title><link href="https://nimbus.ai/b"/><published>2026-11-05T00:00:00Z</published></entry></feed>';
  assert.deepEqual(parseFeed(atom, "https://nimbus.ai/feed.atom").map((item) => [item.title, item.url, item.published_at]), [["Newer", "https://nimbus.ai/b", "2026-11-05T00:00:00.000Z"], ["Older & wiser", "https://nimbus.ai/a", "2026-11-01T00:00:00.000Z"]]);
  assert.deepEqual(parseFeed("not a feed"), []);
});

test("leads: Hacker News with no subject reads the front page from the official API", async () => {
  const fetch = async (url) => {
    if (url === "https://hacker-news.firebaseio.com/v0/topstories.json") return Response.json([101, 102]);
    if (url === "https://hacker-news.firebaseio.com/v0/item/101.json") return Response.json({ id: 101, type: "story", title: "Nimbus-7B is out", url: "https://nimbus.ai/blog/nimbus-7b-ga", score: 300, time: 1794064800 });
    if (url === "https://hacker-news.firebaseio.com/v0/item/102.json") return Response.json({ id: 102, type: "story", title: "Ask HN: what now?", score: 50, time: 1794064800 });
    return new Response("", { status: 404 });
  };
  const http = createHttp({ fetch, env: {}, now: () => NOW });
  const { leads, providers } = await findNewsLeads(http, { queries: [], now: NOW, windowDays: 3, providers: ["hacker-news", "gdelt"] });
  assert.deepEqual(leads.map((lead) => [lead.url, lead.via]), [["https://nimbus.ai/blog/nimbus-7b-ga", ["hacker-news"]]]);
  assert.deepEqual(providers.map((provider) => [provider.id, provider.leads]), [["hacker-news", 1], ["gdelt", 0]]);
});

test("small parsers: GDELT dates, current-events items, headlines, owners and citations", () => {
  assert.equal(gdeltDate("20261109T070000Z"), "2026-11-09T07:00:00.000Z");
  assert.equal(gdeltDate("soon"), null);
  const items = currentEventItems('<div class="current-events-main vevent"><span class="bday dtstart">2026-11-08</span><ul><li>Something <a rel="nofollow" class="external text" href="https://a.example/x?a=1&amp;b=2">(A)</a></li><li>No source here</li></ul></div>');
  assert.deepEqual(items, [{ date: "2026-11-08T00:00:00.000Z", text: "Something (A)", links: ["https://a.example/x?a=1&b=2"] }]);
  assert.equal(headlineOf("Nimbus-7B is now generally available | Nimbus AI"), "Nimbus-7B is now generally available");
  assert.equal(headlineOf("Nimbus AI pauses EU rollout of Nimbus-7B - Wirepost"), "Nimbus AI pauses EU rollout of Nimbus-7B");
  assert.equal(headlineOf("Nimbus AI"), "Nimbus AI");
  assert.ok(storyOwners("Nimbus Unveils New Model For Phones").includes("Nimbus"));
  assert.ok(!storyOwners("Tech News Today: Nimbus Unveils").includes("News"));
  assert.deepEqual(outboundLinks('<a href="/local">a</a><a href="https://nimbus.ai/press">b</a><a href="mailto:x@y.z">c</a><a href="#top">d</a>', "https://technewsdesk.example/story"), ["https://nimbus.ai/press"]);
});

test("robots.txt: this client's own group wins, the longest rule decides, and a closed page is never fetched", async () => {
  const rules = robotsRules("User-agent: *\nDisallow: /private/\nAllow: /private/open\nDisallow: /*.pdf$\n\nUser-agent: OtherBot\nDisallow: /\n", "launchclip-research");
  assert.deepEqual([robotsAllow(rules, "/private/x"), robotsAllow(rules, "/private/open/a"), robotsAllow(rules, "/a.pdf"), robotsAllow(rules, "/a.pdfx"), robotsAllow(rules, "/blog")], [false, true, false, true, true]);
  assert.equal(robotsAllow(robotsRules("User-agent: *\nAllow: /\nUser-agent: launchclip-research\nDisallow: /", "launchclip-research"), "/x"), false);
  assert.equal(robotsAllow(robotsRules("User-agent: *\nDisallow:", "launchclip-research"), "/x"), true);
  const asked = [];
  const fetch = async (url) => {
    asked.push(url);
    if (url === "https://closed.example/robots.txt") return new Response("User-agent: *\nDisallow: /", { status: 200 });
    if (url === "https://down.example/robots.txt") return new Response("", { status: 503 });
    return new Response("<html><title>Open</title><body><p>Hello there, this is a page.</p></body></html>", { status: url.endsWith("robots.txt") ? 404 : 200, headers: { "content-type": "text/html" } });
  };
  const http = createHttp({ fetch, env: {}, now: () => NOW });
  assert.equal(await http.snapshot("https://closed.example/story"), null);
  assert.equal(await http.snapshot("https://down.example/story"), null);
  assert.equal((await http.snapshot("https://open.example/story")).title, "Open");
  assert.deepEqual(asked, ["https://closed.example/robots.txt", "https://down.example/robots.txt", "https://open.example/robots.txt", "https://open.example/story"]);
  assert.equal(http.failure("https://closed.example/story"), "robots");
  // The client says who it is and where to read about it, with no personal contact.
  let agent = null;
  await createHttp({ fetch: async (url, init) => { agent = init.headers["user-agent"]; return new Response("{}"); }, env: {} }).json("https://example.com/api");
  assert.match(agent, /^launchclip-research\/\d+ \(\+https:\/\/github\.com\/[\w-]+\/launchclip\)$/);
  assert.doesNotMatch(agent, /@/);
});

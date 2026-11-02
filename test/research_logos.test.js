import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MODULES as CATALOG_B } from "@launchclip/core/catalog-b.mjs";
import { MODULES as CATALOG_H } from "@launchclip/core/catalog-h.mjs";
import { cleanSvg, findLogos, logoManifest, pageLogoCandidates, simpleIconsSlug, stageLogos } from "../src/research/logos.js";
import { runResearch } from "../src/research/index.js";
import { validateLogos } from "../src/research/schema.js";

const SITE_SVG = `<svg viewBox="0 0 120 24" class="wordmark"><title>Anthropic</title><path fill="#191919" d="M0 0h10v24H0z"/></svg>`;
const AMD_ICON = `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#ED1C24"><title>AMD</title><path d="M18.324 9.137l1.559 1.56h2.556v2.557L24 14.814V9.137zM2 9.137l-2 4.96h1.309l.37-.982H3.9l.408.982h1.338L3.432 9.137z"/></svg>`;

const wikidata = (name, id, website, description) => ({
  [`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&limit=5&format=json&origin=*`]: json({ search: [{ id, label: name }] }),
  [`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${id}&props=claims|descriptions&languages=en&format=json&origin=*`]: json({ entities: { [id]: { descriptions: { en: { value: description } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: "Q4830453" } } } }], P856: [{ mainsnak: { datavalue: { value: website } } }] } } } })
});

function json(value) { return { body: JSON.stringify(value), type: "application/json" }; }
function html(body) { return { body: `<!doctype html><html><head>${body.head ?? ""}</head><body>${body.body ?? ""}</body></html>`, type: "text/html" }; }

/** A fake fetch over a {url: {body, type, status, location}} table; every URL it is asked for is logged. */
function fakeFetch(routes) {
  const seen = [];
  const fetch = async (url) => {
    seen.push(url);
    const route = routes[url];
    if (!route) return new Response("", { status: 404 });
    if (route.location) return new Response(null, { status: 302, headers: { location: route.location } });
    return new Response(route.body, { status: route.status ?? 200, headers: { "content-type": route.type ?? "" } });
  };
  return { fetch, seen };
}

test("a site's header SVG is the logo, with its domain from Wikidata, colours and module params", async () => {
  const { fetch } = fakeFetch({
    ...wikidata("Anthropic", "Q116758847", "https://www.anthropic.com/", "American artificial intelligence company"),
    "https://www.anthropic.com/": html({ head: `<link rel="icon" href="/favicon.svg">`, body: `<header><button><svg viewBox="0 0 24 24"><path d="M0 0h24v2H0z"/></svg></button><a href="/" aria-label="Home">${SITE_SVG}</a></header>` })
  });
  const result = await findLogos([{ name: "Anthropic", kind: "name", claims: ["c001"] }], { now: "2026-11-03T00:00:00.000Z" }, { fetch, env: {} });
  assert.equal(result.logos.length, 1);
  const [logo] = result.logos;
  assert.equal(logo.kind, "site");
  assert.equal(logo.via, "header-svg");
  assert.equal(logo.domain, "anthropic.com");
  assert.equal(logo.wikidata, "Q116758847");
  assert.equal(logo.file, "logos/anthropic.svg");
  assert.equal(logo.asset, "assets/logos/anthropic.svg");
  assert.equal(logo.source_url, "https://www.anthropic.com/");
  assert.deepEqual(logo.colors, ["#191919"]);
  assert.deepEqual(logo.path, { d: "M0 0h10v24H0z", viewBox: "0 0 120 24" });
  assert.deepEqual(logo.claims, ["c001"]);
  assert.match(result.files[0].bytes.toString("utf8"), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 120 24"/);
  assert.deepEqual(validateLogos(logoManifest(result)), []);
});

test("a site with no usable logo falls back to Simple Icons by slug", async () => {
  const { fetch, seen } = fakeFetch({
    "https://amd.com/": html({ body: `<header><a href="/news">News</a></header>` }),
    "https://cdn.simpleicons.org/amd": { body: AMD_ICON, type: "image/svg+xml" }
  });
  const result = await findLogos([{ name: "AMD", kind: "org", claims: [] }], { domains: { AMD: "amd.com" } }, { fetch, env: {} });
  const [logo] = result.logos;
  assert.equal(logo.kind, "simple-icons");
  assert.equal(logo.simple_icons_slug, "amd");
  assert.equal(logo.source_url, "https://cdn.simpleicons.org/amd");
  assert.deepEqual(logo.colors, ["#ed1c24"]);
  assert.equal(logo.path.viewBox, "0 0 24 24");
  assert.ok(seen.indexOf("https://amd.com/") < seen.indexOf("https://cdn.simpleicons.org/amd"), "the site is tried first");
  // An org Wikidata does not know still gets a Simple Icon; a bare capitalised word does not.
  const other = fakeFetch({ "https://cdn.simpleicons.org/amd": { body: AMD_ICON, type: "image/svg+xml" } });
  const bare = await findLogos([{ name: "AMD", kind: "org" }, { name: "Terminal", kind: "name" }], {}, { fetch: other.fetch, env: {} });
  assert.deepEqual(bare.logos.map((entry) => [entry.name, entry.domain, entry.kind]), [["AMD", null, "simple-icons"]]);
  assert.ok(!other.seen.includes("https://cdn.simpleicons.org/terminal"));
  assert.equal(simpleIconsSlug("Hugging Face"), "huggingface");
  assert.equal(simpleIconsSlug("Dev.to"), "devdotto");
});

test("private and local hosts are refused: never fetched, redirects included", async () => {
  const { fetch, seen } = fakeFetch({
    "https://example-labs.com/": html({ head: `<link rel="icon" type="image/svg+xml" href="https://cdn.example-labs.com/mark.svg">`, body: `<header><img src="http://169.254.169.254/latest/logo.svg" alt="Example Labs logo"><img src="https://example-labs.com/r/logo.svg" class="logo"></header>` }),
    "https://example-labs.com/r/logo.svg": { location: "http://127.0.0.1:8080/logo.svg" },
    "https://cdn.example-labs.com/mark.svg": { body: SITE_SVG, type: "image/svg+xml" }
  });
  const result = await findLogos([
    { name: "Example Labs", kind: "org" },
    { name: "Intranet Co", kind: "org" },
    { name: "Signed Inc", kind: "org" }
  ], { domains: { "Example Labs": "example-labs.com", "Intranet Co": "http://10.1.2.3/", "Signed Inc": "https://user:pw@signed.example.com/" } }, { fetch, env: {} });
  assert.deepEqual(result.logos.map((logo) => [logo.name, logo.via, logo.source_url]), [["Example Labs", "icon-svg", "https://cdn.example-labs.com/mark.svg"]]);
  assert.deepEqual(result.missed.map((miss) => miss.name), ["Intranet Co", "Signed Inc"]);
  assert.match(result.missed[0].reason, /local or private address/);
  assert.match(result.missed[1].reason, /credentials/);
  for (const url of seen) assert.doesNotMatch(url, /169\.254|127\.0\.0\.1|10\.1\.2\.3|user:pw/, `fetched ${url}`);
});

test("the cache, keyed by domain, serves a repeat run with no fetches", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "launchclip-logo-cache-"));
  const routes = {
    ...wikidata("Anthropic", "Q116758847", "https://www.anthropic.com/", "American artificial intelligence company"),
    "https://www.anthropic.com/": html({ body: `<header><a href="/">${SITE_SVG}</a></header>` })
  };
  const entities = [{ name: "Anthropic", kind: "name", claims: [] }];
  const first = fakeFetch(routes);
  const one = await findLogos(entities, { now: "t" }, { fetch: first.fetch, env: { LAUNCHCLIP_LOGO_CACHE: cacheDir } });
  assert.equal(one.cache_hits, 0);
  assert.ok(first.seen.length >= 3);
  assert.ok(existsSync(path.join(cacheDir, "anthropic.com", "logo.svg")));
  const second = fakeFetch({});
  const two = await findLogos(entities, { now: "t", cacheDir }, { fetch: second.fetch, env: {} });
  assert.equal(second.seen.length, 0, "nothing refetched");
  assert.equal(two.cache_hits, 1);
  assert.deepEqual(two.logos, one.logos);
  assert.deepEqual(two.files[0].bytes, one.files[0].bytes);
});

test("candidates come in preference order, and an SVG is cleaned before it is kept", () => {
  const page = `<head><meta property="og:image" content="/og/brand-logo.png"><link rel="apple-touch-icon" sizes="120x120" href="/t120.png"><link rel="apple-touch-icon" sizes="180x180" href="/t180.png"><link rel="icon" href="/favicon.svg"></head><header><a href="/"><img src="/logo.svg" alt="Acme"></a></header>`;
  assert.deepEqual(pageLogoCandidates(page, "https://acme.com/", "Acme").map((candidate) => [candidate.via, candidate.url]), [
    ["header-img", "https://acme.com/logo.svg"], ["icon-svg", "https://acme.com/favicon.svg"],
    ["apple-touch-icon", "https://acme.com/t180.png"], ["apple-touch-icon", "https://acme.com/t120.png"], ["og-image", "https://acme.com/og/brand-logo.png"]
  ]);
  assert.deepEqual(pageLogoCandidates(`<meta property="og:image" content="/hero.jpg">`, "https://acme.com/", "Acme"), [], "an og:image that is not a logo is not one");
  const clean = cleanSvg(`<svg viewBox="0 0 10 10" onload="x()"><script>alert(1)</script><path d="M0 0h1z"/></svg>`);
  assert.doesNotMatch(clean, /script|onload/);
  assert.equal(cleanSvg(`<svg viewBox="0 0 10 10"><use href="#sprite-logo"/></svg>`), null, "a sprite reference draws nothing");
});

test("runResearch writes research/logos/ and logos.json, returns them, and the logos plug into the kit's logo modules", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-research-logos-"));
  await writeFile(path.join(root, "script.md"), "# News\n\nThis week, Anthropic and AMD shipped new hardware for 40% less.\n");
  const { fetch } = fakeFetch({
    ...wikidata("Anthropic", "Q116758847", "https://www.anthropic.com/", "American artificial intelligence company"),
    "https://www.anthropic.com/": html({ body: `<header><a href="/">${SITE_SVG}</a></header>` }),
    "https://cdn.simpleicons.org/amd": { body: AMD_ICON, type: "image/svg+xml" }
  });
  const out = path.join(root, "research");
  const report = await runResearch("script.md", { out, cwd: root, media: "none", people: "none", now: "2026-11-03T00:00:00.000Z" }, { fetch, env: {} });
  assert.deepEqual(report.logos.map((logo) => [logo.name, logo.kind]).sort(), [["AMD", "simple-icons"], ["Anthropic", "site"]]);
  assert.equal(report.summary.logos, 2);
  assert.equal(report.files.logos, path.join(out, "logos.json"));
  for (const file of report.files.logo_files) assert.ok(existsSync(file), file);
  const manifest = JSON.parse(await readFile(report.files.logos, "utf8"));
  assert.deepEqual(validateLogos(manifest), []);
  assert.ok(manifest.modules["logo-row"] && manifest.modules["brand-lockup"]);
  assert.match(await readFile(path.join(out, "RESEARCH.md"), "utf8"), /## Logos[\s\S]*Anthropic/);

  // Staged under assets/, each entry's params pass the modules' own validation.
  const staged = await stageLogos(manifest, out, root);
  for (const logo of staged) assert.ok(existsSync(logo.staged));
  const brand = { colors: { bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", ink: "#06070d", paper: "#f2eee6" }, fonts: { display: "anton", body: "space-grotesk", meta: "jetbrains-mono" } };
  const ctx = { id: "scene", start: 0, duration: 6, format: { width: 1920, height: 1080, fps: 30 }, brand, aspect: "16:9", hits: [] };
  const row = CATALOG_B["logo-row"].resolve({ logos: manifest.logos.map((logo) => logo.params["logo-row"]) }, ctx);
  assert.deepEqual(row.content.logos.map((logo) => logo.src).sort(), ["assets/logos/amd.svg", "assets/logos/anthropic.svg"]);
  const lockup = CATALOG_B["brand-lockup"].resolve(manifest.logos[0].params["brand-lockup"], ctx);
  assert.ok(lockup.content.mark.src.startsWith("assets/logos/"));
  const particles = CATALOG_H["particle-logo"].resolve({ logos: manifest.logos.map((logo) => logo.params["particle-logo"]) }, ctx);
  assert.equal(particles.content.logos.length, 2);

  // --logos none: no lookups, an empty manifest.
  const off = await runResearch("script.md", { out, cwd: root, media: "none", people: "none", logos: "none" }, { fetch: fakeFetch({}).fetch, env: {} });
  assert.deepEqual(off.logos, []);
  assert.ok(!existsSync(path.join(out, "logos")));
});

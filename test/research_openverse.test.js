import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHttp } from "../src/research/http.js";
import { findMedia, mediaProviders, openverseAsset } from "../src/research/media.js";
import { validateAssets } from "../src/research/schema.js";

// A live answer to q="lighthouse storm", recorded on 2026-11-16.
const recorded = JSON.parse(readFileSync(new URL("./fixtures/research/openverse/images-lighthouse-storm.json", import.meta.url), "utf8"));
const NOW = "2026-11-16T00:00:00.000Z";
const commonsPages = { query: { pages: { 1: { title: "File:Harbour.jpg", imageinfo: [{ url: "https://upload.wikimedia.org/Harbour.jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:Harbour.jpg", mime: "image/jpeg", extmetadata: { LicenseShortName: { value: "CC BY 4.0" }, Artist: { value: "Ada Byron" } } }] } } } };

/** openverse(url, init, count) → Response for each Openverse search; every request is kept in `seen`. */
function mock(openverse, token = null) {
  const seen = [];
  const fetch = async (url, init = {}) => {
    seen.push({ url, method: init.method ?? "GET", headers: init.headers, body: init.body ?? null });
    if (url.startsWith("https://api.openverse.org/v1/auth_tokens/token/")) return token ?? new Response("{}", { status: 404 });
    if (url.startsWith("https://api.openverse.org/v1/images/")) return openverse(url, init, seen.filter((call) => call.url.startsWith("https://api.openverse.org/v1/images/")).length);
    if (url.startsWith("https://commons.wikimedia.org/w/api.php")) return Response.json(commonsPages);
    return new Response("{}", { status: 404 });
  };
  return { seen, http: createHttp({ fetch, env: {}, now: () => NOW }), searches: () => seen.filter((call) => call.url.startsWith("https://api.openverse.org/v1/images/")) };
}

test("openverse: results become assets with the licence, the licence URL and the credit line Openverse wrote", async () => {
  const { http, searches } = mock(() => Response.json(recorded));
  const { assets, rejected, providers } = await findMedia(http, [{ query: "lighthouse storm", beat: null }], { env: {}, providers: ["openverse"], perQuery: 6, now: NOW });
  assert.deepEqual(providers, ["openverse"]);
  // Three of the six recorded results name no creator, so there is nobody to credit.
  assert.equal(assets.length, 3);
  assert.deepEqual(rejected.map((entry) => entry.reason), ["no author or credit line", "no author or credit line", "no author or credit line"]);
  const [first, second] = assets;
  assert.equal(first.type, "image");
  assert.equal(first.provider_name, "Openverse");
  assert.equal(first.author, "Scott McLeod");
  assert.deepEqual(first.licence, { id: "cc-by", name: "CC BY 2.0", url: "https://creativecommons.org/licenses/by/2.0/" });
  assert.equal(first.attribution, recorded.results[0].attribution);
  assert.match(first.attribution, /is licensed under CC BY 2\.0\. To view a copy of this license, visit https:\/\/creativecommons\.org\/licenses\/by\/2\.0\/\.$/);
  assert.match(first.source_url, /^https:\/\/www\.flickr\.com\/photos\//);
  assert.match(first.media_url, /\.jpg$/);
  assert.equal(second.licence.id, "cc0");
  assert.deepEqual(validateAssets({ schema: "launchclip.research-assets.v1", assets }), []);

  const [search] = searches();
  const params = new URL(search.url).searchParams;
  assert.equal(params.get("q"), "lighthouse storm");
  assert.equal(params.get("license_type"), "commercial,modification");
  assert.equal(params.get("excluded_source"), "wikimedia,nasa");
  assert.equal(search.headers.authorization, undefined);
  assert.match(search.headers["user-agent"], /^launchclip-research\//);
});

test("openverse: only licences a published, edited video may use get through", async () => {
  const base = recorded.results[0];
  const withLicence = (license, license_url, license_version = "4.0") => ({ ...base, license, license_version, license_url });
  assert.equal(openverseAsset(withLicence("by-sa", "https://creativecommons.org/licenses/by-sa/4.0/")).licence.id, "cc-by-sa");
  assert.equal(openverseAsset(withLicence("pdm", "https://creativecommons.org/publicdomain/mark/1.0/", "1.0")).licence.id, "public-domain");
  for (const [license, url] of [["by-nc", "https://creativecommons.org/licenses/by-nc/4.0/"], ["by-nd", "https://creativecommons.org/licenses/by-nd/4.0/"], ["by-nc-sa", "https://creativecommons.org/licenses/by-nc-sa/4.0/"], ["sampling+", "https://creativecommons.org/licenses/sampling+/1.0/"], [null, null]]) {
    assert.equal(openverseAsset(withLicence(license, url)).licence, null, String(license));
  }
  // An NC item the filter let through is dropped and counted, not placed.
  const { http } = mock(() => Response.json({ results: [withLicence("by-nc", "https://creativecommons.org/licenses/by-nc/4.0/"), base] }));
  const { assets, rejected } = await findMedia(http, [{ query: "lighthouse", beat: null }], { env: {}, providers: ["openverse"], now: NOW });
  assert.equal(assets.length, 1);
  assert.deepEqual(rejected.map((entry) => entry.reason), ["licence not clear"]);
});

test("openverse: an allowance at zero stops further requests and the other sources still answer", async () => {
  const { http, searches } = mock(() => Response.json(recorded, { headers: { "x-ratelimit-limit-anon_burst": "20/min", "x-ratelimit-available-anon_burst": "0", "x-ratelimit-available-anon_sustained": "150" } }));
  const queries = [{ query: "lighthouse storm", beat: null }, { query: "harbour", beat: null }];
  const { assets } = await findMedia(http, queries, { env: {}, providers: ["wikimedia-commons", "openverse"], now: NOW });
  assert.equal(searches().length, 1);
  assert.ok(http.calls.some((call) => call.status === "rate-limited"));
  const second = assets.filter((asset) => asset.query === "harbour");
  assert.deepEqual(second.map((asset) => asset.provider), ["wikimedia-commons"]);
  assert.ok(assets.some((asset) => asset.query === "lighthouse storm" && asset.provider === "openverse"));
});

test("openverse: a 429 is not an error; the run carries on with the other sources", async () => {
  const { http, searches } = mock(() => new Response("{\"detail\":\"Request was throttled.\"}", { status: 429, headers: { "retry-after": "3600" } }));
  const queries = [{ query: "lighthouse storm", beat: null }, { query: "harbour", beat: null }];
  const { assets, providers } = await findMedia(http, queries, { env: {}, providers: ["wikimedia-commons", "openverse"], now: NOW });
  assert.deepEqual(providers, ["wikimedia-commons", "openverse"]);
  assert.equal(searches().length, 1);
  assert.deepEqual(assets.map((asset) => asset.provider), ["wikimedia-commons", "wikimedia-commons"]);
});

test("openverse: a client id and secret are traded once for a token that every search carries", async () => {
  const env = { OPENVERSE_CLIENT_ID: "client-id", OPENVERSE_CLIENT_SECRET: "client-secret" };
  const { http, seen, searches } = mock(() => Response.json(recorded), Response.json({ access_token: "tok-123", expires_in: 36000 }));
  await findMedia(http, [{ query: "lighthouse storm", beat: null }, { query: "harbour", beat: null }], { env, providers: ["openverse"], now: NOW });
  const tokens = seen.filter((call) => call.url.includes("/auth_tokens/token/"));
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].method, "POST");
  assert.equal(tokens[0].body, "grant_type=client_credentials&client_id=client-id&client_secret=client-secret");
  assert.deepEqual(searches().map((call) => call.headers.authorization), ["Bearer tok-123", "Bearer tok-123"]);
  // The secret is in the request body only: never in a URL the run records.
  assert.ok(!JSON.stringify(http.calls).includes("client-secret"));
});

test("openverse: refused credentials, or only half of them, leave the search anonymous", async () => {
  const refused = mock(() => Response.json(recorded), Response.json({ error: "invalid_client" }, { status: 401 }));
  const { assets } = await findMedia(refused.http, [{ query: "lighthouse storm", beat: null }], { env: { OPENVERSE_CLIENT_ID: "x", OPENVERSE_CLIENT_SECRET: "y" }, providers: ["openverse"], now: NOW });
  assert.equal(assets.length, 3);
  assert.equal(refused.searches()[0].headers.authorization, undefined);

  const half = mock(() => Response.json(recorded));
  await findMedia(half.http, [{ query: "lighthouse storm", beat: null }], { env: { OPENVERSE_CLIENT_ID: "x" }, providers: ["openverse"], now: NOW });
  assert.equal(half.seen.filter((call) => call.url.includes("/auth_tokens/")).length, 0);
  assert.ok(mediaProviders({}).some((provider) => provider.id === "openverse"));
});

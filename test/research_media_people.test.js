import assert from "node:assert/strict";
import test from "node:test";
import { createHttp } from "../src/research/http.js";
import { findMedia, metaphorQueries, normaliseLicence } from "../src/research/media.js";
import { findPeople, roleFromScript } from "../src/research/people.js";
import { validateAssets } from "../src/research/schema.js";

function mockHttp(routes) {
  const fetch = async (url) => {
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    const body = key ? routes[key] : null;
    return { ok: body != null, status: body != null ? 200 : 404, url, headers: new Map(), text: async () => JSON.stringify(body ?? {}) };
  };
  return createHttp({ fetch, env: {}, now: () => "2026-10-27T00:00:00.000Z" });
}

const commonsPage = (title, licence, artist, extra = {}) => ({
  title: `File:${title}.jpg`,
  imageinfo: [{ url: `https://upload.wikimedia.org/${title}.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${title}.jpg`, mime: "image/jpeg", width: 4000, height: 3000, extmetadata: { LicenseShortName: { value: licence }, Artist: { value: artist }, ...extra } }]
});

test("licences: CC BY, BY-SA, CC0 and public domain pass; NC, ND and unknown do not", () => {
  assert.equal(normaliseLicence("CC BY-SA 4.0").id, "cc-by-sa");
  assert.equal(normaliseLicence("CC BY 2.0").name, "CC BY 2.0");
  assert.equal(normaliseLicence("CC0").id, "cc0");
  assert.equal(normaliseLicence("Public domain").id, "public-domain");
  assert.equal(normaliseLicence("", "http://creativecommons.org/licenses/publicdomain/").id, "public-domain");
  assert.equal(normaliseLicence("CC BY-NC 4.0"), null);
  assert.equal(normaliseLicence("CC BY-ND 3.0"), null);
  assert.equal(normaliseLicence("Fair use"), null);
  assert.equal(normaliseLicence("All rights reserved"), null);
});

test("media keeps only licence-clear assets with credit lines, footage first", async () => {
  const http = mockHttp({
    "https://commons.wikimedia.org/w/api.php?action=query&generator=search": { query: { pages: {
      1: commonsPage("Server racks", "CC BY-SA 4.0", "<a href=\"//commons.wikimedia.org/wiki/User:Ada\">Ada Byron</a>"),
      2: commonsPage("Movie still", "Fair use", "Studio"),
      3: commonsPage("Datacenter aisle", "CC BY-NC 2.0", "Someone")
    } } },
    "https://images-api.nasa.gov/search": { collection: { items: [{ href: "https://images-assets.nasa.gov/video/x/collection.json", data: [{ nasa_id: "earth-night", title: "Earth at Night", center: "GSFC", media_type: "video" }], links: [] }] } },
    "https://archive.org/advancedsearch.php": { response: { docs: [
      { identifier: "computers_1952", title: "Computers at Work", licenseurl: "http://creativecommons.org/licenses/publicdomain/", mediatype: "movies", collection: ["prelinger"] },
      { identifier: "no_licence", title: "Unknown Film", mediatype: "movies" }
    ] } },
    "https://www.loc.gov/photos/": { results: [{ title: "Telephone operators", url: "https://www.loc.gov/item/1/", image_url: ["https://tile.loc.gov/1.jpg"], rights_advisory: "No known restrictions on publication." }] }
  });
  const { assets, rejected, providers } = await findMedia(http, [{ query: "data center", beat: "Picture a warehouse of humming machines." }], { env: {}, perQuery: 4, now: "2026-10-27T00:00:00.000Z" });
  assert.deepEqual(providers, ["wikimedia-commons", "nasa", "internet-archive", "library-of-congress"]);
  assert.equal(assets.length, 4);
  assert.deepEqual(assets.slice(0, 2).map((asset) => asset.type), ["video", "video"]);
  const commons = assets.find((asset) => asset.provider === "wikimedia-commons");
  assert.equal(commons.author, "Ada Byron");
  assert.equal(commons.attribution, "“Server racks” by Ada Byron, CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/), via Wikimedia Commons");
  assert.equal(assets.find((asset) => asset.provider === "library-of-congress").licence.id, "public-domain");
  assert.deepEqual(rejected.map((entry) => entry.reason).sort(), ["licence not clear", "licence not clear", "licence not clear"]);
  assert.deepEqual(validateAssets({ schema: "launchclip.research-assets.v1", assets }), []);
});

test("YouTube and streaming hosts are rejected even with a clear licence", () => {
  const errors = validateAssets({ schema: "launchclip.research-assets.v1", assets: [{ id: "x", licence: { id: "cc-by" }, attribution: "a", author: "a", source_url: "https://www.youtube.com/watch?v=1" }] });
  assert.ok(errors.some((error) => /blocked host/.test(error)));
});

test("metaphor queries come from sentences that carry no claim", () => {
  const sentences = [{ text: "Nimbus-7B scores 72.5 on HumanEval." }, { text: "Picture a librarian who has read every book in the building." }];
  const queries = metaphorQueries(sentences, [{ text: "Nimbus-7B scores 72.5 on HumanEval." }]);
  assert.deepEqual(queries, [{ query: "librarian building", beat: "Picture a librarian who has read every book in the building." }]);
  assert.deepEqual(metaphorQueries(sentences, [], { queries: ["rocket launch"] }), [{ query: "rocket launch", beat: null }]);
});

test("a person gets role and affiliation from Wikidata and a portrait only when licence-clear", async () => {
  const http = mockHttp({
    "https://www.wikidata.org/w/api.php?action=wbsearchentities": { search: [{ id: "Q1", label: "Ada Byron" }, { id: "Q2", label: "Ada Byron" }] },
    "https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q1|Q2": { entities: {
      Q1: { id: "Q1", descriptions: { en: { value: "British poet" } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: "Q5" } } } }] } },
      Q2: { id: "Q2", descriptions: { en: { value: "computer scientist" } }, claims: { P31: [{ mainsnak: { datavalue: { value: { id: "Q5" } } } }], P108: [{ mainsnak: { datavalue: { value: { id: "Q9" } } } }], P106: [{ mainsnak: { datavalue: { value: { id: "Q8" } } } }], P18: [{ mainsnak: { datavalue: { value: "Ada Byron 2025.jpg" } } }] } }
    } },
    "https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q9": { entities: { Q9: { labels: { en: { value: "Nimbus AI" } } }, Q8: { labels: { en: { value: "computer scientist" } } } } },
    "https://commons.wikimedia.org/w/api.php?action=query&titles=": { query: { pages: { 5: commonsPage("Ada Byron 2025", "CC BY 4.0", "Grace Hopper") } } }
  });
  const entities = [{ name: "Ada Byron", kind: "person", claims: ["c001"] }, { name: "Nimbus AI", kind: "org", claims: ["c001"] }];
  const claims = [{ id: "c001", text: "\"Open weights compound,\" said Ada Byron, CEO of Nimbus AI." }];
  const { people, portraits } = await findPeople(http, entities, claims, { now: "2026-10-27T00:00:00.000Z" });
  assert.equal(people[0].wikidata.id, "Q2");
  assert.equal(people[0].affiliation, "Nimbus AI");
  assert.equal(people[0].role, "computer scientist");
  assert.equal(people[0].role_in_script, "CEO of Nimbus AI");
  assert.equal(portraits[0].licence.id, "cc-by");
  assert.equal(people[0].portrait, portraits[0].id);
  assert.match(portraits[0].attribution, /photo by Grace Hopper, CC BY 4\.0/);
});

test("the script's own role stands in when Wikidata has no confident match", () => {
  assert.deepEqual(roleFromScript("Liang Wenfeng", ["said Liang Wenfeng, CEO of DeepSeek."]), { role: "CEO", affiliation: "DeepSeek", text: "CEO of DeepSeek" });
});

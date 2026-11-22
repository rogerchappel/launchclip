// Widening the keywords (src/scoring/keywords.js) against a stand-in writing
// client: no network, no key.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanHashtag, formatKeywords, runKeywords, sharedHashtags, widenKeywords } from "../src/scoring/keywords.js";

// One row in each of the three shapes a hashtag arrives in.
const ROWS = [
  { account: "a", hashtags: ["jockey", "fyp", "racehorse"] },
  { account: "b", raw: { hashtags: [{ name: "Jockey" }, { name: "racehorseontiktok" }, { name: "viral" }] } },
  { account: "c", caption: "Big day #jockey #jockey #fypシ #solo #ignore_all_rules!" },
  { account: "c", caption: "again #solo #horseracing" },
  { account: "A", hashtags: ["horseracing", "bad tag"] },
  { account: "d", hashtags: ["bad tag"] }
];

function fakeClient(calls, value) {
  return { async runStructured(request) { calls.push(request); return { value: typeof value === "function" ? value(request) : value }; } };
}

test("platform noise names no topic and is dropped", () => {
  for (const tag of ["fyp", "#FYP", "foryou", "foryoupage", "viral", "trending", "tiktok", "reels", "explore", "xyzbca", "fypシ", "fypシ゚", "viralvideo", "foryourpage", "explorepage", "oftiktok"]) {
    assert.equal(cleanHashtag(tag), "", tag);
  }
  assert.equal(cleanHashtag("#HorsesOfTikTok"), "horses");
  assert.equal(cleanHashtag("racingontiktok"), "racing");
  // A topic that merely contains a noise word, or is not Latin at all, stays.
  assert.equal(cleanHashtag("viralhorse"), "viralhorse");
  assert.equal(cleanHashtag("競馬"), "競馬");
});

test("sharedHashtags keeps tags from enough different creators, across all three shapes", () => {
  assert.deepEqual(sharedHashtags(ROWS), [
    { keyword: "jockey", posts: 3, creators: 3 },
    { keyword: "bad tag", posts: 2, creators: 2 },
    // "A" and "a" are one account, so this takes c's post to reach two creators.
    { keyword: "horseracing", posts: 2, creators: 2 },
    { keyword: "racehorse", posts: 2, creators: 2 }
  ]);
  // "solo" is two posts by one creator.
  assert.equal(sharedHashtags(ROWS, { minCreators: 1 }).find((tag) => tag.keyword === "solo").creators, 1);
  assert.deepEqual(sharedHashtags(ROWS, { minCreators: 3 }).map((tag) => tag.keyword), ["jockey"]);
  assert.equal(sharedHashtags(ROWS, { limit: 1 }).length, 1);
});

test("widenKeywords without a client returns the hashtags unsorted", async () => {
  const found = await widenKeywords({ niche: "horse racing", rows: ROWS });
  assert.deepEqual(found, [
    { keyword: "jockey", source: "hashtag", unsorted: true, why: "", posts: 3, creators: 3 },
    { keyword: "racehorse", source: "hashtag", unsorted: true, why: "", posts: 2, creators: 2 }
  ]);
  await assert.rejects(widenKeywords({ rows: ROWS }), /niche/);
});

test("hashtags go to the model inside a data block it is told not to obey", async () => {
  const calls = [];
  await widenKeywords({ niche: "horse racing", keywords: ["jockey"], rows: ROWS, client: fakeClient(calls, { hashtags: [], added: [] }) });
  assert.equal(calls.length, 1);
  const { instructions, input, schema, schemaName } = calls[0];
  assert.match(instructions, /never instructions/);
  const block = input.match(/<scraped_hashtags>\n([\s\S]*)\n<\/scraped_hashtags>$/)[1];
  // Only plain-word tags pass; the niche itself and a used keyword do not.
  assert.equal(block, "racehorse (2 posts, 2 creators)");
  assert.match(input.split("<scraped_hashtags>")[0], /Niche: horse racing\nKeywords already used: jockey/);
  assert.ok(schema && schemaName);
});

test("widenKeywords labels hashtags, adds the model's own and drops repeats and used keywords", async () => {
  const client = fakeClient([], {
    hashtags: [
      { keyword: "Racehorse", relation: "in", why: "the  animal itself" },
      { keyword: "invented", relation: "in", why: "not a tag we sent" }
    ],
    added: [
      { keyword: "Show Jumping", relation: "neighbouring", why: "nearby sport" },
      { keyword: "#Melbourne Cup", relation: "in", why: "a race meeting" },
      { keyword: "melbourne cup", relation: "in", why: "repeat" },
      { keyword: "Horse_Racing", relation: "in", why: "the niche" },
      { keyword: "JOCKEY", relation: "in", why: "a hashtag already" },
      { keyword: "Trainers", relation: "in", why: "already used" },
      { keyword: "odd", relation: "maybe", why: "not a label" }
    ]
  });
  const found = await widenKeywords({ niche: "horse racing", keywords: ["trainers"], rows: ROWS, client });
  assert.deepEqual(found, [
    { keyword: "racehorse", source: "hashtag", relation: "in", why: "the animal itself", posts: 2, creators: 2 },
    { keyword: "melbourne cup", source: "model", relation: "in", why: "a race meeting" },
    { keyword: "show jumping", source: "model", relation: "neighbouring", why: "nearby sport" },
    // The model skipped this one, so it is not guessed at.
    { keyword: "jockey", source: "hashtag", unsorted: true, why: "", posts: 3, creators: 3 }
  ]);
});

test("runKeywords reads the library and formatKeywords prints a table", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-keywords-"));
  const file = path.join(dir, "library.jsonl");
  await writeFile(file, `${ROWS.map((row) => JSON.stringify(row)).join("\n")}\n`);
  const calls = [];
  const client = fakeClient(calls, { hashtags: [{ keyword: "racehorse", relation: "off", why: "too broad" }], added: [{ keyword: "trainers", relation: "in", why: "a role" }] });
  const result = await runKeywords(file, { niche: "horse racing", used: "jockey, Stud farms" }, { client });
  assert.equal(result.niche, "horse racing");
  assert.match(calls[0].input, /already used: jockey, Stud farms/);
  assert.deepEqual(result.keywords.map((entry) => [entry.keyword, entry.relation]), [["trainers", "in"], ["racehorse", "off"]]);
  const lines = formatKeywords(result).split("\n");
  assert.match(lines[1], /^keyword\s+relation\s+source\s+posts\/creators\s+why$/);
  assert.match(lines[2], /^trainers\s+in\s+model\s+-\s+a role$/);
  assert.match(lines[3], /^racehorse\s+off\s+hashtag\s+2\/2\s+too broad$/);
  await assert.rejects(runKeywords(file, {}), /usage/);
  assert.match(formatKeywords({ niche: "x", keywords: [] }), /No more keywords/);
});

// The niche command with a stand-in for every step: no network, no models.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatNiche, resolveRubric, runNiche } from "../src/scoring/niche.js";

const post = (id, account, views) => ({ id: String(id), platform: "tiktok", account, url: `https://example.test/${id}`, caption: `post ${id}`, metrics: { views }, raw: { big: "x".repeat(50) } });

function standIns(calls) {
  return {
    discover: async ({ keywords }) => {
      calls.push(`discover:${keywords[0]}`);
      if (keywords[0] === "empty") throw new Error("the search found no accounts");
      const account = keywords[0].replace(/\s+/g, "_");
      return { creators: [{ account, platform: "tiktok", hits: 2 }], rows: [1, 2, 3, 4, 5, 6].map((n) => post(`${account}-${n}`, account, n * 100)), warnings: [] };
    },
    widen: async ({ keywords }) => { calls.push(`widen:${keywords.join("+")}`); return [{ keyword: "jockey", source: "hashtag", relation: "in" }, { keyword: "dressage", source: "model", relation: "neighbouring" }]; },
    evidence: async (rows) => { calls.push("evidence"); return { rows: rows.map(({ raw, ...row }) => ({ ...row, facts: { has_speech: false }, evidence_at: "now" })), counts: { posts: rows.length, transcripts: 0, thumbs: 0 } }; },
    formats: async (rows) => ({ rows: rows.map((row) => ({ ...row, tags: { structure: "list" } })), cost_usd: 0.001 }),
    compare: () => [],
    draft: async (_library, flags) => { calls.push(`draft:${flags.niche}`); await writeFile(flags.out, JSON.stringify({ questions: {} })); return { cost_usd: { write: 0.001, score: 0.001, total: 0.002 }, status: { judging_posts: 6, kept: 0, ready: false }, questions: [{ key: "q", part: "written_hook", instructions: "Does it name a horse?", verdict: "unproven", rho: 0.1, yes_rate_hits: 0.5, yes_rate_rest: 0.25 }] }; }
  };
}

test("runNiche goes from a keyword to a folder with the library, the draft and the report, and resumes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-niche-"));
  const calls = [];
  const io = { steps: standIns(calls), stderr: { write() {} } };
  const first = await runNiche("horse racing, empty", { dir, niche: "horse racing" }, io);
  assert.deepEqual(calls, ["discover:horse racing", "discover:empty", "widen:horse racing+empty", "evidence", "draft:horse racing"]);
  assert.equal(first.name, "horse-racing");
  assert.equal(first.posts, 6);
  assert.match(first.warnings.join("\n"), /empty: the search found no accounts/);
  const rows = (await readFile(path.join(first.folder, "library.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(rows.every((row) => !row.raw && row.keyword === "horse racing" && row.tags));
  const report = await readFile(first.report, "utf8");
  assert.match(report, /\| jockey \| in \| hashtag \| not collected/);
  assert.match(report, /Does it name a horse\?.*unproven.*50% \/ 25%/);
  assert.match(report, /Nothing to compare against yet/);
  assert.match(formatNiche(first), /not yet collected: jockey\. Run again with --widen/);

  // Again with --widen: nothing is searched twice, and only the in-niche keyword is collected.
  calls.length = 0;
  const second = await runNiche("", { dir, name: "horse-racing", widen: true }, io);
  assert.deepEqual(calls, ["discover:jockey", "evidence", "draft:horse racing"]);
  assert.equal(second.posts, 12);
  assert.equal(second.cost_usd, 0.003);

  assert.equal(resolveRubric("horse-racing", { dir }), path.join(dir, "horse-racing", "rubric.draft.json"));
  assert.equal(resolveRubric("nope", { dir }), "nope");
});

import assert from "node:assert/strict";
import test from "node:test";
import { extractClaims, entityIndex } from "../src/research/claims.js";
import { createHttp, htmlToText } from "../src/research/http.js";
import { classifyUrl, findSources, parseArxiv } from "../src/research/sources.js";
import { buildLedger, dateAppears, numberAppears, verifyClaim } from "../src/research/verify.js";
import { validateLedger } from "../src/research/schema.js";

const CARD = `# Nimbus-7B

**Nimbus-7B** is an open-weights model with a 128K token context.

| Benchmark | Nimbus-7B | Rival-8B |
| :--- | :---: | :---: |
| MMLU-Pro | 61.2 | 64.0 |
| HumanEval | 72.5 | 70.1 |

This repository and the model weights are licensed under the MIT License.`;

function snapshot(fields) {
  return { fetched_at: "2026-10-27T00:00:00.000Z", sha256: "a".repeat(64), primary: true, kind: "model-card", publisher: "Hugging Face · nimbus", ...fields };
}

test("a number in the claim's own column verifies, with the row as the quote span", () => {
  const [claim] = extractClaims("Nimbus-7B scores 72.5 on HumanEval.");
  const verdict = verifyClaim(claim, [snapshot({ url: "https://huggingface.co/nimbus/Nimbus-7B", text: CARD })]);
  assert.equal(verdict.status, "verified");
  assert.equal(verdict.sources[0].quote.row.label, "HumanEval");
  assert.equal(verdict.sources[0].quote.row.column, "Nimbus-7B");
  assert.equal(CARD.slice(verdict.sources[0].quote.start, verdict.sources[0].quote.end), verdict.sources[0].quote.text);
});

test("another model's number is a contradiction, never support", () => {
  const [claim] = extractClaims("Nimbus-7B scores 64.0 on MMLU-Pro.");
  const verdict = verifyClaim(claim, [snapshot({ url: "https://huggingface.co/nimbus/Nimbus-7B", text: CARD })]);
  assert.equal(verdict.status, "contradicted");
  assert.match(verdict.flag.message, /61\.2/);
});

test("a claim no source states stays unverified with a flag", () => {
  const [claim] = extractClaims("Nimbus-7B was trained on 40 trillion tokens.");
  const verdict = verifyClaim(claim, [snapshot({ url: "https://huggingface.co/nimbus/Nimbus-7B", text: CARD })]);
  assert.equal(verdict.status, "unverified");
  assert.equal(verdict.flag.action, "soften-or-cite");
});

test("quotes verify only verbatim", () => {
  const source = snapshot({ url: "https://nimbus.ai/blog", primary: true, kind: "article", text: "Our founder said: \"Open weights are how research compounds.\" Then more." });
  const [good] = extractClaims("\"Open weights are how research compounds,\" said Ada Byron, founder of Nimbus.");
  const [bad] = extractClaims("\"Open weights always win in the end,\" said Ada Byron, founder of Nimbus.");
  assert.equal(verifyClaim(good, [source]).status, "verified");
  assert.equal(verifyClaim(bad, [source]).status, "unverified");
  assert.equal(verifyClaim(bad, [source]).flag.action, "cut");
});

test("number and date matching accept the source's own spelling", () => {
  assert.ok(numberAppears("It has 284 billion parameters", { value: 284e9, unit: "parameter" }));
  assert.ok(numberAppears("total 284,000,000,000", { value: 284e9, unit: null }));
  assert.ok(!numberAppears("GPT-5.5 is out", { value: 5.5, unit: null }));
  assert.ok(dateAppears("Created: 2026-10-17T02:40:38.000Z", "October 17, 2026"));
  assert.ok(dateAppears("Released 17 Oct 2026.", "October 17, 2026"));
  assert.ok(!dateAppears("Released Oct 18, 2026.", "October 17, 2026"));
});

test("the ledger validates, and an unverified claim always carries its flag", () => {
  const claims = extractClaims("Nimbus-7B scores 72.5 on HumanEval. Nimbus-7B was trained on 40 trillion tokens.");
  const ledger = buildLedger({ claims, snapshots: [snapshot({ url: "https://huggingface.co/nimbus/Nimbus-7B", text: CARD })], entities: entityIndex(claims), now: "2026-10-27T00:00:00.000Z", input: { kind: "script" } });
  assert.deepEqual(validateLedger(ledger), []);
  assert.equal(ledger.summary.verified, 1);
  assert.equal(ledger.summary.unverified, 1);
  delete ledger.claims[1].flag;
  assert.ok(validateLedger(ledger).some((error) => /flag/.test(error)));
});

test("findSources goes to the Hugging Face API first and prefers the named org's upload", async () => {
  const responses = {
    "https://huggingface.co/api/models?search=Nimbus-7B&sort=likes&direction=-1&limit=10": [{ id: "someone/Nimbus-7B-GGUF", likes: 900 }, { id: "fan/Nimbus-7B", likes: 50 }, { id: "nimbus-ai/Nimbus-7B", likes: 10 }],
    "https://huggingface.co/api/models/nimbus-ai/Nimbus-7B": { id: "nimbus-ai/Nimbus-7B", author: "nimbus-ai", createdAt: "2026-10-20T10:00:00.000Z", cardData: { license: "mit" } },
    "https://huggingface.co/nimbus-ai/Nimbus-7B/raw/main/README.md": CARD
  };
  const fetch = async (url) => {
    const body = responses[url];
    return { ok: body != null, status: body != null ? 200 : 404, url, headers: new Map(), text: async () => typeof body === "string" ? body : JSON.stringify(body ?? {}) };
  };
  const http = createHttp({ fetch, env: {}, now: () => "2026-10-27T00:00:00.000Z" });
  const claims = extractClaims("Nimbus AI released Nimbus-7B on October 20, 2026.");
  const { sources, search } = await findSources(http, entityIndex(claims), { env: {} });
  assert.equal(search, null);
  assert.deepEqual(sources.map((source) => source.url), ["https://huggingface.co/nimbus-ai/Nimbus-7B"]);
  assert.match(sources[0].text, /Created: 2026-10-20/);
  assert.match(sources[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(verifyClaim(claims[0], sources).status, "verified");
});

test("URL classes, HTML text and arXiv entries", () => {
  assert.deepEqual(classifyUrl("https://github.com/o/r/pull/12"), { kind: "pr", primary: true });
  assert.deepEqual(classifyUrl("https://github.com/o/r/commit/abcdef1"), { kind: "commit", primary: true });
  assert.deepEqual(classifyUrl("https://huggingface.co/o/m"), { kind: "model-card", primary: true });
  assert.deepEqual(classifyUrl("https://x.com/nimbus/status/1"), { kind: "post", primary: false });
  assert.equal(classifyUrl("https://nimbus.ai/news/launch", ["Nimbus AI"]).primary, true);
  const page = htmlToText("<html><head><title>Launch</title><meta property=\"article:published_time\" content=\"2026-10-20T08:00:00Z\"></head><body><script>x()</script><p>We shipped&nbsp;it.</p></body></html>");
  assert.equal(page.title, "Launch");
  assert.equal(page.published_at, "2026-10-20T08:00:00.000Z");
  assert.equal(page.text, "We shipped it.");
  const [entry] = parseArxiv("<feed><entry><id>http://arxiv.org/abs/2501.01234v2</id><title>A Paper</title><summary> About it. </summary><published>2026-01-02T00:00:00Z</published><author><name>Ada Byron</name></author></entry></feed>");
  assert.deepEqual([entry.id, entry.title, entry.authors], ["2501.01234", "A Paper", ["Ada Byron"]]);
});

test("each number is checked in the column of the model it belongs to", () => {
  const card = "| Benchmark | Nimbus-7B | Rival-8B | Titan 2 |\n| :--- | :---: | :---: | :---: |\n| HumanEval | 72.5 | 70.1 | 80.4 |";
  const source = snapshot({ url: "https://huggingface.co/nimbus/Nimbus-7B", text: card });
  const [comparison] = extractClaims("On HumanEval Nimbus-7B scores 72.5, ahead of Rival-8B at 70.1.");
  assert.equal(verifyClaim(comparison, [source]).status, "verified");
  // "X beats Titan 2 with 80.4" gives X the 80.4, which is Titan 2's.
  const [boast] = extractClaims("On HumanEval Nimbus-7B also beats Titan 2 with 80.4.");
  const verdict = verifyClaim(boast, [source]);
  assert.equal(verdict.status, "contradicted");
  assert.match(verdict.flag.message, /72\.5 \(Nimbus-7B; 80\.4 is Titan 2\)/);
});

test("a PR snapshot names its repo and number, so a claim citing the number verifies against it", async () => {
  const { githubPull } = await import("../src/research/sources.js");
  const pull = { html_url: "https://github.com/dotnet/efcore/pull/39217", title: "Make the evals more realistic", body: "Judge model update.", state: "closed", merged_at: "2026-10-16T17:45:34Z", created_at: "2026-10-10T00:00:00Z", changed_files: 112, additions: 10, deletions: 5, user: { login: "AndriySvyryd" } };
  const fetch = async (url) => ({ ok: true, status: 200, url, headers: new Map(), text: async () => JSON.stringify(pull) });
  const http = createHttp({ fetch, env: {}, now: () => "2026-10-27T00:00:00.000Z" });
  const snap = await githubPull(http, "dotnet/efcore", 39217);
  const [claim] = extractClaims("On October 16, 2026, the Entity Framework Core team merged pull request 39217 in dotnet/efcore.");
  assert.equal(verifyClaim(claim, [{ ...snap, primary: true }]).status, "verified");
});

import assert from "node:assert/strict";
import test from "node:test";
import { entityIndex, extractClaims, extractNumbers, mergeClaims, splitSentences } from "../src/research/claims.js";

const SCRIPT = `# Hook
DeepSeek just dropped DeepSeek-V4.1-Flash on October 17, 2026. It has 284B parameters with 13B active, and a 1M token context.
It scores 87.5% on MMLU-Pro, beating GPT-5.5 by 3 points. The weights live at deepseek-ai/DeepSeek-V4.1-Flash-1017 under an MIT licence.
"We believe open weights win in the long run," said Liang Wenfeng, CEO of DeepSeek.
Why does this matter? Two reasons.

- See arXiv:2412.19437 for the V3 paper.
- Price: $0.28 per million tokens.`;

test("splits sentences without breaking decimals or versions, keeping the heading", () => {
  const sentences = splitSentences(SCRIPT);
  assert.equal(sentences[0].section, "Hook");
  assert.ok(sentences.some((entry) => entry.text === "It scores 87.5% on MMLU-Pro, beating GPT-5.5 by 3 points."));
  assert.ok(sentences.some((entry) => entry.text === "Price: $0.28 per million tokens."));
});

test("numbers carry value and unit; dates, versions and ids are not quantities", () => {
  assert.deepEqual(extractNumbers("It has 284B parameters with 13B active.").map((entry) => [entry.value, entry.unit]), [[284e9, "parameter"], [13e9, null]]);
  assert.deepEqual(extractNumbers("It scores 87.5% on MMLU-Pro.").map((entry) => [entry.value, entry.unit]), [[87.5, "percent"]]);
  assert.deepEqual(extractNumbers("Released on October 17, 2026 as GPT-5.5 at arXiv:2412.19437."), []);
});

test("every checkable sentence becomes a claim; questions and filler do not", () => {
  const claims = extractClaims(SCRIPT);
  assert.ok(!claims.some((claim) => claim.text.endsWith("?")));
  const release = claims.find((claim) => claim.text.startsWith("DeepSeek just dropped"));
  assert.equal(release.kind, "date");
  assert.deepEqual(release.dates, ["October 17, 2026"]);
  const quote = claims.find((claim) => claim.kind === "quote");
  assert.equal(quote.quote, "We believe open weights win in the long run,");
  assert.ok(quote.entities.some((entity) => entity.name === "Liang Wenfeng" && entity.kind === "person"));
  const index = entityIndex(claims);
  for (const name of ["DeepSeek-V4.1-Flash", "DeepSeek", "deepseek-ai/DeepSeek-V4.1-Flash-1017", "arXiv:2412.19437"]) assert.ok(index.some((entity) => entity.name === name), name);
  assert.equal(index.find((entity) => entity.name === "deepseek-ai/DeepSeek-V4.1-Flash-1017").kind, "repo");
});

test("model or agent claims merge by text and keep their search hint", () => {
  const base = extractClaims("DeepSeek-V4.1-Flash has 284B parameters.");
  const merged = mergeClaims(base, [
    { text: "DeepSeek-V4.1-Flash has 284B parameters.", search: "DeepSeek V4.1 Flash parameters" },
    { text: "The weights are open.", search: "DeepSeek V4.1 Flash license" }
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].search, "DeepSeek V4.1 Flash parameters");
  assert.equal(merged[1].kind, "statement");
  assert.equal(merged[1].id, "c002");
});

test("benchmarks are not models, and a possessive is not part of the name", () => {
  const [claim] = extractClaims("On Terminal-Bench 4.0 DeepSeek's DeepSeek-V4.1-Flash-1017 scores 42.3 on MMLU-Pro.");
  const kinds = Object.fromEntries(claim.entities.map((entity) => [entity.name, entity.kind]));
  assert.equal(kinds["Terminal-Bench 4.0"], "benchmark");
  assert.equal(kinds["MMLU-Pro"], "benchmark");
  assert.equal(kinds["DeepSeek-V4.1-Flash-1017"], "model");
  assert.ok(!claim.entities.some((entity) => entity.name.startsWith("On ")));
});

import test from "node:test";
import assert from "node:assert/strict";
import { identifySemanticRetakes, validateSemanticRetakes, indexedPassages, semanticTranscriptHash } from "../src/semantic_retakes.js";
function phrase(text, start) { return text.split(" ").map((word, index) => ({ word, start: start + index * 0.3, end: start + index * 0.3 + 0.2 })); }
const words = [...phrase("Our garden needs regular water.", 1), ...phrase("The soil stays dry.", 4), ...phrase("We should water the garden often.", 7)];
function receipt(retakes, transcript = words) { return { transcript_hash: semanticTranscriptHash(transcript), retakes }; }
const pair = { earlier: { first_word: 0, last_word: 4 }, later: { first_word: 9, last_word: 14 }, later_complete: true, explanation: "The later complete passage restates the abandoned earlier recommendation." };

test("supplied semantic decisions retain final paraphrase and target only earlier words", async () => {
  const result = await identifySemanticRetakes(words, { decisions: receipt([pair]), durationSeconds: 10 });
  assert.deepEqual(result.retakes, [pair]);
  assert.deepEqual(result.removals.map(({ start, end, reason }) => ({ start, end, reason })), [{ start: 1, end: words[4].end, reason: "semantic-retake" }]);
  assert.ok(result.removals.every((range) => range.end < words[5].start));
});
test("model prompt contains canonical original indices and universal restart rules", async () => {
  let request;
  const result = await identifySemanticRetakes({ words }, {}, { infer: async (input) => { request = input; return JSON.stringify({ retakes: [pair] }); } });
  assert.equal(result.retakes.length, 1);
  assert.match(request.prompt, /Always keep the LAST take/);
  assert.match(request.prompt, /intentional summaries/);
  assert.match(request.prompt, /"index":14/);
  assert.equal(request.schema.properties.retakes.type, "array");
});
test("no model is contacted without opt-in; unique and contrasting passages can remain intact", async () => {
  await assert.rejects(identifySemanticRetakes(words), /explicitly selected/);
  assert.deepEqual(await identifySemanticRetakes(words, { decisions: receipt([]) }), { transcript_hash: semanticTranscriptHash(words), retakes: [], restarts: [], removals: [] });
  const contrasting = [...phrase("The short route saves time.", 1), ...phrase("The longer path avoids traffic.", 4)];
  assert.deepEqual((await identifySemanticRetakes(contrasting, {}, { infer: async () => ({ retakes: [] }) })).removals, []);
});
test("invalid JSON and missing arrays fail closed", async () => {
  await assert.rejects(identifySemanticRetakes(words, {}, { infer: async () => "not JSON" }), /invalid JSON/);
  assert.throws(() => validateSemanticRetakes({ transcript_hash: semanticTranscriptHash(words) }, words), /retakes array/);
});
test("invalid ranges, partial passages, reversed order and incomplete replacements fail closed", () => {
  for (const patch of [
    { earlier: { first_word: -1, last_word: 4 } },
    { earlier: { first_word: 0.5, last_word: 4 } },
    { later: { first_word: 9, last_word: 99 } },
    { earlier: { first_word: 1, last_word: 4 } },
    { earlier: { first_word: 9, last_word: 14 }, later: { first_word: 0, last_word: 4 } },
    { later_complete: false }, { explanation: "" },
  ]) assert.throws(() => validateSemanticRetakes(receipt([{ ...pair, ...patch }]), words), /no cuts applied/);
});
test("timing limits and source bounds reject distant repeated information", async () => {
  assert.throws(() => validateSemanticRetakes(receipt([pair]), words, { retakeWindow: 2 }), /window/);
  assert.throws(() => validateSemanticRetakes(receipt([pair]), words, { retakeWindow: 0 }), /positive/);
  await assert.rejects(identifySemanticRetakes(words, { decisions: [], durationSeconds: 3 }), /source duration/);
});
test("successive paraphrases allow only exact chains ending in the final take", () => {
  const chainWords = [...phrase("Plants need plenty of water.", 1), ...phrase("Keep your plants well watered.", 4), ...phrase("Give plants enough water daily.", 7)];
  const first = { ...pair, earlier: { first_word: 0, last_word: 4 }, later: { first_word: 5, last_word: 9 } };
  const second = { ...pair, earlier: { first_word: 5, last_word: 9 }, later: { first_word: 10, last_word: 14 } };
  assert.equal(validateSemanticRetakes(receipt([first, second], chainWords), chainWords).removals.length, 2);
  assert.throws(() => validateSemanticRetakes(receipt([first, { ...second, earlier: { first_word: 0, last_word: 9 } }], chainWords), chainWords), /overlap/);
});
test("duplicate earlier decisions select the latest replacement deterministically", () => {
  const chainWords = [...phrase("Plants need plenty of water.", 1), ...phrase("Keep your plants well watered.", 4), ...phrase("Give plants enough water daily.", 7)];
  const first = { ...pair, later: { first_word: 5, last_word: 9 } };
  const last = { ...pair, later: { first_word: 10, last_word: 14 } };
  const result = validateSemanticRetakes(receipt([last, first], chainWords), chainWords);
  assert.equal(result.retakes.length, 1);
  assert.deepEqual(result.retakes[0].later, last.later);
});
test("malformed later partial-overlap conflicts are rejected", () => {
  const chainWords = [...phrase("Plants need plenty of water.", 1), ...phrase("Keep your plants well watered.", 4), ...phrase("Give plants enough water daily.", 7), ...phrase("Healthy roots absorb moisture slowly.", 10)];
  const first = { ...pair, later: { first_word: 5, last_word: 14 } };
  const second = { ...pair, earlier: { first_word: 5, last_word: 9 }, later: { first_word: 15, last_word: 19 } };
  assert.throws(() => validateSemanticRetakes(receipt([first, second], chainWords), chainWords), /partially removed/);
});
test("indexed passages preserve full original word timing", () => {
  const passages = indexedPassages(words);
  assert.equal(passages.length, 3);
  assert.equal(passages[2].words[0].index, 9);
  assert.deepEqual(passages[2].words[0], { index: 9, ...words[9] });
});
test("built-in inference rejects remote base URLs before sending transcript", async () => {
  await assert.rejects(identifySemanticRetakes(words, { model: "local-model", baseUrl: "https://example.com" }), /local Ollama/);
  await assert.rejects(identifySemanticRetakes(words, { model: "local-model", baseUrl: "http://localhost:11434/remote" }), /local Ollama/);
});

test("supplied receipts are bound to original transcript wording and timing", () => {
  assert.throws(() => validateSemanticRetakes({ retakes: [pair] }, words), /transcript_hash/);
  const changed = words.map((word, index) => index === 0 ? { ...word, word: "Different" } : word);
  assert.throws(() => validateSemanticRetakes(receipt([pair]), changed), /transcript_hash/);
  const shifted = words.map((word) => ({ ...word, start: word.start + 1, end: word.end + 1 }));
  assert.throws(() => validateSemanticRetakes(receipt([pair]), shifted), /transcript_hash/);
  assert.equal(semanticTranscriptHash({ words }), semanticTranscriptHash(words));
});

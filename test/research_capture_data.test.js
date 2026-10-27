import assert from "node:assert/strict";
import test from "node:test";
import { extractClaims, entityIndex } from "../src/research/claims.js";
import { buildCaptureRequests, captureId, highlightSpan, plain } from "../src/research/capture.js";
import { extractData, parseCell, parseTables } from "../src/research/data.js";
import { buildLedger } from "../src/research/verify.js";
import { validateCapture } from "../src/research/schema.js";

const CARD = `# Nimbus-7B

## Evaluation

| Benchmark | Nimbus-7B | Rival-8B |
| :--- | :---: | :---: |
| MMLU-Pro | 61.2 (63.0†) | 64.0 |
| HumanEval | 72.5 | — |

*† with tools.*

This repository and the model weights are licensed under the **MIT License**, so anyone can build on Nimbus-7B without asking first or paying a fee.`;

const SOURCE = { url: "https://huggingface.co/nimbus-ai/Nimbus-7B", title: "nimbus-ai/Nimbus-7B · model card", publisher: "Hugging Face · nimbus-ai", published_at: "2026-10-20T10:00:00.000Z", fetched_at: "2026-10-27T00:00:00.000Z", sha256: "b".repeat(64), primary: true, kind: "model-card", text: CARD };

function ledgerFor(script) {
  const claims = extractClaims(script);
  return buildLedger({ claims, snapshots: [SOURCE], entities: entityIndex(claims), now: "2026-10-27T00:00:00.000Z", input: { kind: "script" } });
}

test("one capture per on-screen source, beats aimed at the verifying quote span", () => {
  const ledger = ledgerFor("Nimbus-7B scores 72.5 on HumanEval. Nimbus-7B weights are under the MIT License. Nimbus-7B was trained on 9 trillion tokens.");
  const { requests, byClaim } = buildCaptureRequests(ledger);
  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.deepEqual(validateCapture(request), []);
  assert.equal(request.id, "hf-nimbus-7b");
  assert.equal(request.kind, "model-card");
  assert.equal(request.out, "assets/evidence/hf-nimbus-7b.mp4");
  assert.deepEqual(request.viewport, { width: 1600, height: 1000 });
  const ring = request.beats.find((beat) => beat.action === "focus-ring");
  assert.deepEqual(ring.target, { text: "HumanEval" });
  assert.ok(request.beats.some((beat) => beat.action === "highlight" && beat.target.text === "72.5"));
  assert.ok(request.beats.some((beat) => beat.action === "highlight" && /MIT License/.test(beat.target.text) && !/\*\*/.test(beat.target.text)));
  // Beats run in order without overlapping.
  for (let index = 1; index < request.beats.length; index += 1) assert.ok(request.beats[index].at >= request.beats[index - 1].at + request.beats[index - 1].dur - 1e-9);
  // The unverified claim never reaches the screen.
  assert.deepEqual(Object.keys(byClaim).sort(), ["c001", "c002"]);
});

test("ids, plain text and highlight spans are page-findable", () => {
  assert.equal(captureId("https://github.com/o/r/pull/12"), "gh-o-r-pull-12");
  assert.equal(captureId("https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017"), "hf-deepseek-v4-1-flash-1017");
  assert.equal(plain("licensed under the [**MIT License**](LICENSE)."), "licensed under the MIT License.");
  assert.equal(plain("| `context_window` |"), "context_window");
  const span = highlightSpan({ values: [{ raw: "128K" }], entities: [] }, "We are releasing the weights today and the model has a context window of 128K tokens which is longer than anything we shipped before this year by far.");
  assert.ok(span.includes("128K"));
  assert.ok(span.split(" ").length <= 14);
});

test("a benchmark table becomes cited data with bar-chart views, footnotes and dashes kept", () => {
  const ledger = ledgerFor("Nimbus-7B scores 72.5 on HumanEval.");
  const [file] = extractData([SOURCE], ledger, { subject: "Nimbus-7B" });
  assert.equal(file.schema, "launchclip.research-data.v1");
  assert.equal(file.kind, "benchmark");
  assert.equal(file.title, "Evaluation");
  assert.equal(file.source.url, SOURCE.url);
  assert.equal(file.source.sha256, SOURCE.sha256);
  assert.deepEqual(file.claims, ["c001"]);
  assert.deepEqual(file.rows[0], { label: "MMLU-Pro", values: { "Nimbus-7B": 61.2, "Rival-8B": 64 }, raw: ["MMLU-Pro", "61.2 (63.0†)", "64.0"], notes: { "Nimbus-7B": "63.0†" } });
  assert.equal(file.rows[1].values["Rival-8B"], null);
  assert.deepEqual(file.notes, ["† with tools."]);
  assert.deepEqual(file.views[0], { module: "bar-chart", title: "MMLU-Pro", props: { data: [{ label: "Nimbus-7B", value: 61.2 }, { label: "Rival-8B", value: 64 }], highlight: "Nimbus-7B" } });
  // A row with one value is no chart.
  assert.equal(file.views.length, 1);
});

test("cells and tables parse the source's own spelling", () => {
  assert.deepEqual(parseCell("$0.28"), { raw: "$0.28", value: 0.28 });
  assert.deepEqual(parseCell("87.5%"), { raw: "87.5%", value: 87.5 });
  assert.deepEqual(parseCell("42.0†"), { raw: "42.0†", value: 42, note: "†" });
  assert.equal(parseCell("—").value, null);
  const [table] = parseTables("| a | b |\n|---|---|\n| x | 1 |\n| y | 2 |\n\nAfter.");
  assert.deepEqual(table.columns, ["a", "b"]);
  assert.equal(table.rows.length, 2);
});

test("a claim verified only by API facts is checked but never captured", () => {
  const ledger = { claims: [{ id: "c001", status: "verified", text: "Nimbus-7B was released on October 20, 2026.", values: [], entities: [], sources: [{ url: SOURCE.url, title: SOURCE.title, publisher: SOURCE.publisher, fetched_at: SOURCE.fetched_at, primary: true, supports: true, confidence: 0.9, kind: "model-card", quote: { text: "Hugging Face API: Model: nimbus-ai/Nimbus-7B; Created: 2026-10-20T10:00:00.000Z.", start: 0, end: 10 } }] }] };
  assert.deepEqual(buildCaptureRequests(ledger).requests, []);
});

test("found on the Terra run: highlight spans stay short and inside one table cell", () => {
  assert.equal(highlightSpan({ values: [], entities: [{ name: "Claude Opus 5.5" }] }, "A Anthropic | Anthropic: Claude Opus 5.5 | 2026-09-22 | 58 Intelligence"), "Anthropic: Claude Opus 5.5");
  const span = highlightSpan({ values: [{ raw: "50.3%" }], entities: [] }, "On Terminal-Bench 4.0 at max effort Terra solves 50.3% of tasks against GPT-5.6 Terra's published 21.5% score.");
  assert.ok(span.includes("50.3%"));
  assert.ok(span.split(" ").length <= 8);
});

test("a flattened table row is cut to its cell before the markup comes out", async () => {
  const { beatsFor } = await import("../src/research/capture.js");
  const beats = beatsFor({ text: "On Agents' Last Exam Terra is on par with GPT-6 Astra.", values: [], entities: [{ name: "Agents' Last Exam", kind: "benchmark" }] }, { text: "| Agents' Last Exam, medium effort | 15 points above GPT-5.6 Terra; on par with GPT-6 Astra |" });
  assert.equal(beats[1].target.text, "Agents' Last Exam, medium effort");
});

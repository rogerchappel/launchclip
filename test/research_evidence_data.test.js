import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { attachEvidenceData, loadResearchEvidence, postFromSidecar, seriesData, texOf } from "../src/research/evidence_data.js";

const SOURCE = { url: "https://huggingface.co/nimbus/Nimbus-7B", title: "nimbus/Nimbus-7B · model card", publisher: "Hugging Face · nimbus", fetched_at: "2026-10-27T00:00:00.000Z", primary: true, supports: true, confidence: 0.9 };
const TABLE = {
  schema: "launchclip.research-data.v1", id: "hf-nimbus-7b-benchmark", kind: "benchmark", title: "Evaluation",
  source: { url: SOURCE.url, title: SOURCE.title, publisher: SOURCE.publisher, published_at: "2026-10-20T10:00:00.000Z", fetched_at: SOURCE.fetched_at },
  columns: ["Benchmark", "Nimbus-7B", "Rival-8B"],
  rows: [{ label: "HumanEval", values: { "Nimbus-7B": 72.5, "Rival-8B": 70.1 } }, { label: "MMLU-Pro", values: { "Nimbus-7B": 61.2, "Rival-8B": null } }, { label: "GPQA", values: { "Nimbus-7B": 48, "Rival-8B": 45.5 } }]
};
const PULL = { number: 39217, title: "Use gpt-6.1-terra as the eval judge", state: "closed", merged_at: "2026-10-16T09:00:00Z", created_at: "2026-10-15T09:00:00Z", user: { login: "dev1" }, base: { repo: { full_name: "dotnet/efcore" } } };
const PULL_FILES = [{ filename: "test/Judge.cs", additions: 1, deletions: 1, patch: "@@ -10,3 +10,3 @@\n var client = Create();\n-var model = \"gpt-5.5\";\n+var model = \"gpt-6.1-terra\";\n Run(model);" }];
const COMMIT = { sha: "abcdef1234567890abcdef1234567890abcdef12", url: "https://api.github.com/repos/natefinch/council4/commits/abcdef1", author: { login: "Copilot" }, commit: { message: "Switch the council to gpt-6.1-terra\n\nCo-authored-by: Nate Finch <nate@example.com>", author: { name: "Copilot", date: "2026-10-18T12:00:00Z" }, verification: { verified: true } }, files: [{ filename: "council.yaml", additions: 1, deletions: 1, patch: "@@ -1,2 +1,2 @@\n name: council\n-model: gpt-5.5\n+model: gpt-6.1-terra" }] };

async function githubCache(root) {
  const dir = path.join(root, "assets", "evidence");
  await mkdir(dir, { recursive: true });
  const put = (name, data) => writeFile(path.join(dir, name), JSON.stringify({ url: "cached", fetchedAt: "2026-10-27T00:00:00Z", data }));
  await put("github-dotnet-efcore-pull-39217.json", PULL);
  await put("github-dotnet-efcore-pull-39217-files.json", PULL_FILES);
  await put("github-natefinch-council4-commit-abcdef123456.json", COMMIT);
}

const noNetwork = async () => { throw new Error("no network in tests"); };

test("PR and commit captures get github.js params from the cached API JSON; two GitHub sources make a chain", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-evidence-data-"));
  try {
    await githubCache(root);
    const pr = "https://github.com/dotnet/efcore/pull/39217";
    const commit = "https://github.com/natefinch/council4/commit/abcdef1234567890abcdef1234567890abcdef12";
    const captures = [
      { id: "gh-dotnet-efcore-pull-39217", url: pr, kind: "pr", beats: [{ action: "highlight", target: { text: "gpt-6.1-terra" } }] },
      // A highlight the patch does not contain still gets the card, without a token.
      { id: "gh-natefinch-council4-commit", url: commit, kind: "commit", beats: [{ action: "highlight", target: { text: "Switch the council" } }] }
    ];
    const ledger = { claims: [{ id: "c001", status: "verified", kind: "entity", text: "Two repos switched to gpt-6.1-terra before launch.", sources: [{ ...SOURCE, url: commit }, { ...SOURCE, url: pr }] }] };
    const out = await attachEvidenceData({ ledger, captures }, { root }, { fetch: noNetwork });
    assert.equal(out.captures[0].data.module, "repo-pr-card");
    assert.equal(out.captures[0].data.params.repo, "dotnet/efcore");
    assert.equal(out.captures[0].data.params.highlight, "gpt-6.1-terra");
    assert.equal(out.captures[1].data.module, "commit-card");
    assert.equal(out.captures[1].data.params.highlight, undefined);
    assert.deepEqual(out.captures[1].data.params.authors, ["Copilot", "Nate Finch"]);
    const chain = out.ledger.claims[0].data.sources;
    assert.deepEqual(chain.map((source) => [source.module, source.params.kind, source.params.date]), [["repo-pr-card", "pr", "2026-10-16"], ["commit-card", "commit", "2026-10-18"]]);
    assert.equal(chain[0].token, "gpt-6.1-terra");
    assert.equal(captures[0].data, undefined, "inputs are not mutated");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an uncached PR with no network is reported, not invented", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-evidence-data-"));
  try {
    const out = await attachEvidenceData({ ledger: { claims: [] }, captures: [{ id: "gh-x", url: "https://github.com/o/r/pull/1", kind: "pr", beats: [] }] }, { root }, { fetch: noNetwork });
    assert.equal(out.captures[0].data, undefined);
    assert.deepEqual(out.report.map((entry) => [entry.target, entry.status]), [["gh-x", "skipped"]]);
    assert.match(out.report[0].reason, /no network/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a post capture's fields come from its sidecar, and nothing the page did not show", () => {
  const capture = { id: "x-thsottiaux-1", url: "https://x.com/thsottiaux/status/1", kind: "post", provenance: { publisher: "X", published_at: "2026-10-25T18:00:00Z" } };
  const sidecar = { final_url: "https://x.com/thsottiaux/status/1", page_title: "Tibo on X: \"Terra is coming sooner than you think\" / X", captured_at: "2026-10-27T01:00:00Z", poster: "assets/evidence/x-thsottiaux-1.poster.png", spans: [] };
  assert.deepEqual(postFromSidecar(capture, sidecar, { id: "c004" }), {
    platform: "x", name: "Tibo", handle: "@thsottiaux", text: "Terra is coming sooner than you think", date: "2026-10-25",
    source: { url: "https://x.com/thsottiaux/status/1", captured_at: "2026-10-27T01:00:00Z", screenshot: "assets/evidence/x-thsottiaux-1.poster.png" }, claim: "c004"
  });
  // No title to parse: the highlighted span is the text.
  assert.equal(postFromSidecar(capture, { ...sidecar, page_title: "X", spans: [{ text: "Terra is close" }] }).text, "Terra is close");
  assert.equal(postFromSidecar({ ...capture, url: "https://example.com/a" }, { final_url: "https://example.com/a", page_title: "A" }), null);
});

test("claims get series from their quoted table row, people with clear portraits only, tokens and TeX", async () => {
  const claims = [
    { id: "c001", status: "verified", kind: "number", text: "Nimbus-7B scores 72.5 on HumanEval.", tables: [TABLE.id], sources: [{ ...SOURCE, quote: { text: "| HumanEval | 72.5 | 70.1 |", row: { label: "HumanEval", cell: "72.5", column: "Nimbus-7B" } } }] },
    { id: "c002", status: "verified", kind: "quote", quote: "Open weights compound.", text: "\"Open weights compound,\" said Ada Byron, CEO of Nimbus AI.", sources: [SOURCE] },
    { id: "c003", status: "verified", kind: "statement", text: "The loss falls as $L = aN^{-b}$ with scale.", sources: [SOURCE] },
    { id: "c004", status: "unverified", kind: "quote", quote: "Nobody said this.", text: "\"Nobody said this,\" said Ada Byron.", sources: [], flag: { action: "cut", message: "" } }
  ];
  const assets = {
    assets: [{ id: "portrait-adabyron", role: "portrait", media_url: "https://upload.wikimedia.org/ada.jpg", attribution: "Ada Byron, photo by G. Hopper, CC BY 4.0, via Wikimedia Commons", licence: { id: "cc-by" } }],
    people: [
      { name: "Ada Byron", claims: ["c002", "c004"], role: "computer scientist", affiliation: "Nimbus AI", portrait: "portrait-adabyron", wikidata: { id: "Q2", url: "https://www.wikidata.org/wiki/Q2" } },
      { name: "Charles Babbage", claims: ["c002"], role_in_script: "investor", portrait: null }
    ]
  };
  const tokenize = async (text) => ({ text, tokens: ["Open", " weights", " compound", "."], encoding: "o200k_base" });
  const tex = async (source) => `<svg data-tex="${source}"/>`;
  const out = await attachEvidenceData({ ledger: { claims }, tables: [TABLE], assets }, {}, { tokenize, tex });
  const [series, quote, equation, unverified] = out.ledger.claims;
  assert.deepEqual(series.data.series, [{ label: "Nimbus-7B", value: 72.5 }, { label: "Rival-8B", value: 70.1 }]);
  assert.deepEqual(series.data.panels.map((panel) => panel.title), ["HumanEval", "GPQA"], "the quoted row first; a row with one value is no panel");
  assert.equal(series.data.source, "Hugging Face · nimbus, 2026-10-20");
  assert.deepEqual(quote.data.people, [
    { name: "Ada Byron", role: "computer scientist, Nimbus AI", photo: "https://upload.wikimedia.org/ada.jpg", photo_credit: "Ada Byron, photo by G. Hopper, CC BY 4.0, via Wikimedia Commons", links: ["https://www.wikidata.org/wiki/Q2"] },
    { name: "Charles Babbage", role: "investor" }
  ]);
  assert.deepEqual(quote.data.tokens, ["Open", " weights", " compound", "."]);
  assert.deepEqual(equation.data, { tex: "L = aN^{-b}", svg: "<svg data-tex=\"L = aN^{-b}\"/>" });
  assert.equal(unverified.data, undefined, "only verified claims get data");
});

test("without mathjax-full the equation keeps its TeX and says why there is no SVG", async () => {
  const out = await attachEvidenceData({ ledger: { claims: [{ id: "c001", status: "verified", kind: "statement", text: "It obeys \\(E = mc^2\\).", sources: [SOURCE] }] } }, {}, { tex: async () => { throw new Error("mathjax-full is not installed"); } });
  assert.deepEqual(out.ledger.claims[0].data, { tex: "E = mc^2" });
  assert.match(out.report[0].reason, /mathjax-full is not installed/);
  assert.equal(texOf("no maths here"), null);
  assert.equal(seriesData({ tables: [] }, []), null);
});

test("loadResearchEvidence reads a research folder and finds sidecars under the root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-evidence-data-"));
  try {
    const research = path.join(root, "research");
    await mkdir(path.join(research, "captures"), { recursive: true });
    await mkdir(path.join(root, "assets", "evidence"), { recursive: true });
    const capture = { schema: "launchclip.capture.v1", id: "x-tibo-1", url: "https://x.com/thsottiaux/status/1", kind: "post", out: "assets/evidence/x-tibo-1.mp4", beats: [], provenance: { source_title: "Tibo on X", fetched_at: "2026-10-27T00:00:00Z" } };
    await writeFile(path.join(research, "captures", "x-tibo-1.json"), JSON.stringify(capture));
    await writeFile(path.join(research, "evidence.json"), JSON.stringify({ schema: "launchclip.evidence.v1", claims: [{ id: "c001", status: "verified", text: "Tibo said Terra is close.", capture: "x-tibo-1", sources: [] }] }));
    await writeFile(path.join(root, "assets", "evidence", "x-tibo-1.evidence.json"), JSON.stringify({ final_url: capture.url, page_title: "Tibo on X: \"Terra is close\" / X" }));
    const { ledger, captures, report } = await loadResearchEvidence(research);
    assert.equal(captures[0].data.text, "Terra is close");
    assert.equal(ledger.claims[0].id, "c001");
    assert.deepEqual(report.map((entry) => entry.status), ["attached"]);
    assert.deepEqual(await loadResearchEvidence(path.join(root, "missing")), { ledger: null, captures: [], report: [] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("launchclip research attach writes the data back into the ledger and capture requests", async () => {
  const { runCli } = await import("../src/cli.js");
  const { readFile } = await import("node:fs/promises");
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-evidence-attach-"));
  try {
    const research = path.join(root, "research");
    await mkdir(path.join(research, "captures"), { recursive: true });
    await mkdir(path.join(root, "assets", "evidence"), { recursive: true });
    await writeFile(path.join(research, "captures", "x-tibo-1.json"), JSON.stringify({ id: "x-tibo-1", url: "https://x.com/thsottiaux/status/1", kind: "post", out: "assets/evidence/x-tibo-1.mp4", beats: [] }));
    await writeFile(path.join(research, "evidence.json"), JSON.stringify({ schema: "launchclip.evidence.v1", claims: [] }));
    await writeFile(path.join(root, "assets", "evidence", "x-tibo-1.evidence.json"), JSON.stringify({ final_url: "https://x.com/thsottiaux/status/1", page_title: "Tibo on X: \"Terra is close\" / X" }));
    let out = "";
    await runCli(["research", "attach", research, "--root", root], { stdout: { write: (text) => { out += text; } } });
    assert.equal(JSON.parse(out).attached, 1);
    const written = JSON.parse(await readFile(path.join(research, "captures", "x-tibo-1.json"), "utf8"));
    assert.equal(written.data.handle, "@thsottiaux");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the beat-map dry run loads a folder with its evidence data attached", async () => {
  const { loadFixture } = await import("../eval/beat-map-dry-run.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-evidence-dryrun-"));
  try {
    await githubCache(root);
    await mkdir(path.join(root, "research", "captures"), { recursive: true });
    await writeFile(path.join(root, "SCRIPT.md"), "# Terra\n\n## Leak\n\nA PR swapped the judge model.\n");
    await writeFile(path.join(root, "research", "evidence.json"), JSON.stringify({ schema: "launchclip.evidence.v1", claims: [{ id: "c001", status: "verified", text: "A PR swapped the judge model.", capture: "gh-pr", sources: [] }] }));
    await writeFile(path.join(root, "research", "captures", "gh-pr.json"), JSON.stringify({ id: "gh-pr", url: "https://github.com/dotnet/efcore/pull/39217", kind: "pr", beats: [{ action: "highlight", target: { text: "gpt-6.1-terra" } }] }));
    const { captures, evidenceData } = await loadFixture(root, { fetch: noNetwork });
    assert.equal(captures[0].data.params.number, 39217);
    assert.deepEqual(evidenceData.map((entry) => entry.status), ["attached"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("found on the Terra run: a post X refuses to capture comes from its fetched page; a lone PR claim gets its card", async () => {
  const { postFromSource } = await import("../src/research/evidence_data.js");
  const capture = { id: "x-peterj-walker-1", url: "https://x.com/PeterJ_Walker/status/1", kind: "post", provenance: { publisher: "X" } };
  const claim = { id: "c019", status: "verified", sources: [{ url: capture.url, title: "Peter Walker (@PeterJ_Walker) on X", fetched_at: "2026-10-27T05:00:00Z", supports: true, quote: { text: "New from OpenRouter: 7-day average token volume for Anthropic models is up 3.6x" } }] };
  assert.deepEqual(postFromSource(capture, claim), {
    platform: "x", name: "Peter Walker", handle: "@PeterJ_Walker", text: "New from OpenRouter: 7-day average token volume for Anthropic models is up 3.6x",
    claim: "c019", source: { url: capture.url, captured_at: "2026-10-27T05:00:00Z", via: "page metadata" }
  });
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-evidence-data-"));
  try {
    await githubCache(root);
    const ledger = { claims: [{ id: "c001", status: "verified", text: "On October 16, 2026, pull request 39217 was merged in dotnet/efcore.", sources: [{ ...SOURCE, url: "https://github.com/dotnet/efcore/pull/39217" }] }] };
    const out = await attachEvidenceData({ ledger, captures: [capture] }, { root }, { fetch: noNetwork });
    assert.equal(out.ledger.claims[0].data.module, "repo-pr-card");
    assert.equal(out.ledger.claims[0].data.params.number, 39217);
    // The post capture has no claim pointing at it here, so no source: skipped, not invented.
    assert.equal(out.captures[0].data, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("found on the Terra run: prices are not TeX, and a model name is not a person", async () => {
  const { extractClaims } = await import("../src/research/claims.js");
  assert.equal(texOf("GPT-6.1 Terra costs $1 per million input tokens and $5 per million output tokens."), null);
  assert.equal(texOf("The loss falls as $L = aN^{-b}$."), "L = aN^{-b}");
  const [claim] = extractClaims("Andrew Curran posted that people are switching to Anthropic because of Claude Opus 5.5.");
  assert.ok(!claim.entities.some((entity) => entity.kind === "person" && /Opus/.test(entity.name)));
  assert.ok(claim.entities.some((entity) => entity.name === "Andrew Curran" && entity.kind === "person"));
});

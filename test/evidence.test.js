import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildEvidence, collectEvidence } from "../src/evidence.js";
import { EVIDENCE_SCHEMA, EVIDENCE_VERSION } from "../src/production_contracts.js";

test("collects grounded evidence from a local repository and resources", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-evidence-"));
  const repo = path.join(temp, "sample-repo");
  const docs = path.join(repo, "docs");
  const resources = path.join(temp, "resources");
  await mkdir(docs, { recursive: true });
  await mkdir(resources, { recursive: true });
  await writeFile(path.join(repo, "README.md"), "# Sample Repo\n\nTurns verified input into a useful result.\n");
  await writeFile(path.join(repo, "package.json"), JSON.stringify({ name: "sample-repo", description: "Evidence-backed sample" }));
  await writeFile(path.join(docs, "ARCHITECTURE.md"), "# Architecture\n\nA deterministic core surrounds creative planning.\n");
  const notes = path.join(resources, "notes.md");
  const video = path.join(resources, "demo.mp4");
  await writeFile(notes, "The supplied note is factual source material.\n");
  await writeFile(video, "fake video fixture");
  const evidence = await buildEvidence({
    source: { kind: "repository", value: repo, location: repo },
    resources: [
      { id: "01-notes", role: "supporting", type: "text", source: notes, location: notes, sha256: "notes-sha" },
      { id: "02-demo", role: "supporting", type: "video", source: video, location: video, sha256: "video-sha" }
    ]
  }, {}, {
    probe: async () => ({ format: { duration: "12.5" }, streams: [{ codec_type: "video", width: 1920, height: 1080, avg_frame_rate: "30/1" }] })
  });

  assert.equal(evidence.schema_version, EVIDENCE_VERSION);
  assert.equal(evidence.source.title, "sample-repo");
  assert.equal(evidence.source.summary, "Evidence-backed sample");
  assert.ok(evidence.items.some((entry) => entry.id === "source:readme" && entry.claims_allowed));
  assert.ok(evidence.items.some((entry) => entry.id.startsWith("source:docs:")));
  assert.ok(evidence.items.some((entry) => entry.id === "resource:01-notes" && /factual source/.test(entry.content)));
  assert.ok(evidence.items.some((entry) => entry.id === "resource:02-demo" && entry.kind === "video-metadata"));
});

test("reads GitHub repository metadata and README through injected gh runner", async () => {
  const calls = [];
  const evidence = await buildEvidence({
    source: { kind: "repository", value: "owner/repo", location: "owner/repo" },
    resources: []
  }, {}, {
    run: async (command, args) => {
      calls.push([command, ...args]);
      if (args[0] === "repo") return { stdout: JSON.stringify({ name: "repo", description: "Remote repository", url: "https://github.com/owner/repo", stargazerCount: 12, primaryLanguage: { name: "JavaScript" }, licenseInfo: { spdxId: "MIT" }, defaultBranchRef: { name: "main" } }) };
      return { stdout: "# Repo\n\nRemote README evidence.\n" };
    }
  });
  assert.equal(evidence.source.title, "repo");
  assert.equal(evidence.items[0].provenance, "https://github.com/owner/repo");
  assert.ok(calls.some((call) => call.includes("Accept: application/vnd.github.raw+json")));
});

test("extracts product and reference pages without treating references as claim evidence", async () => {
  const fetch = async (url) => ({
    ok: true,
    status: 200,
    text: async () => `<html><head><title>${url.includes("reference") ? "Reference" : "Product"}</title><meta name="description" content="Useful description"></head><body><script>ignore()</script><main>Visible evidence &amp; proof.</main></body></html>`
  });
  const evidence = await buildEvidence({
    source: { kind: "product", value: "https://product.example", location: "https://product.example" },
    resources: [{ id: "01-reference", role: "reference", type: "url", source: "https://reference.example", location: "https://reference.example", sha256: null }]
  }, {}, { fetch });
  assert.equal(evidence.source.title, "Product");
  assert.match(evidence.items[0].content, /Visible evidence & proof/);
  assert.doesNotMatch(evidence.items[0].content, /ignore/);
  assert.equal(evidence.items.find((entry) => entry.role === "reference").claims_allowed, false);
});

test("writes evidence JSON and a human-readable digest", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-evidence-write-"));
  const workspace = path.join(temp, "workspace");
  await mkdir(path.join(workspace, "production"), { recursive: true });
  await writeFile(path.join(workspace, "production", "intake.json"), `${JSON.stringify({
    source: { kind: "topic", value: "Explain motion cadence", location: "Explain motion cadence" },
    resources: []
  })}\n`);
  const result = await collectEvidence(workspace);
  const written = JSON.parse(await readFile(result.evidence, "utf8"));
  const digest = await readFile(result.digest, "utf8");
  assert.equal(result.items, 1);
  assert.equal(written.schema_version, EVIDENCE_VERSION);
  assert.match(digest, /source:topic/);
});

test("marks a supplied transcript as authoritative narration rather than factual evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-transcript-evidence-"));
  const transcript = path.join(root, "transcript.txt");
  await writeFile(transcript, "These words must stay exactly as spoken.");
  const evidence = await buildEvidence({
    source: { kind: "topic", value: "A narrated explainer", location: "A narrated explainer" },
    resources: [{ id: "transcript", role: "voiceover-transcript", type: "text", source: transcript, location: transcript, is_remote: false, size_bytes: 40, sha256: "hash" }]
  });
  const item = evidence.items.find((entry) => entry.kind === "voiceover-transcript");
  assert.equal(item.role, "voiceover");
  assert.equal(item.claims_allowed, false);
  assert.equal(item.content, "These words must stay exactly as spoken.");
});

test("evidence schema keeps nested object fields explicit", () => {
  assert.equal(EVIDENCE_SCHEMA.additionalProperties, false);
  assert.equal(EVIDENCE_SCHEMA.properties.source.additionalProperties, false);
  assert.equal(EVIDENCE_SCHEMA.properties.items.items.additionalProperties, false);
});

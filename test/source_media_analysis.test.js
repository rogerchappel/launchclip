import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeSourceMedia, MEDIA_ANALYSIS_SCHEMA } from "../src/source_media_analysis.js";

test("transcribes authoritative video narration and gives GPT-5.6 an ordered contact sheet", async () => {
  const workspace = await fixture();
  let request;
  const client = { runStructured: async (options) => {
    request = options;
    return { response_id: "resp_media", model: "gpt-5.6-sol", value: { resource_id: "take", summary: "A presenter demonstrates the workflow.", visible_text: ["Generate"], narrative_opportunities: ["Use the completed state as proof"], segments: [{ start_seconds: 0, end_seconds: 5, description: "Presenter opens the result", proof_value: "Shows the generated output", motion_or_interaction: "Cursor opens the result", recommended_usage: "proof beat" }], quality_warnings: [] } };
  } };
  const transcriber = { transcribe: async () => ({ provider: "elevenlabs", text: "Exact spoken words.", words: [{ word: "Exact", start: 0, end: .3 }], language_code: "en" }) };
  const result = await analyzeSourceMedia(workspace, { background: false }, {
    client, transcriber,
    contactSheet: async (_source, output) => writeFile(output, "contact-sheet")
  });
  assert.equal(result.analyses, 1);
  assert.equal(result.transcripts, 1);
  assert.equal(request.model, "gpt-5.6");
  assert.match(request.images[0].url, /^data:image\/jpeg;base64,/);
  assert.equal(request.schema, MEDIA_ANALYSIS_SCHEMA);
  const evidence = JSON.parse(await readFile(result.evidence, "utf8"));
  const transcript = evidence.items.find((entry) => entry.kind === "voiceover-transcript");
  assert.equal(transcript.content, "Exact spoken words.");
  assert.equal(transcript.claims_allowed, false);
  assert.equal(evidence.items.find((entry) => entry.kind === "visual-media-analysis").claims_allowed, true);
});

test("requires a transcript path or Scribe credentials before planning supplied narration", async () => {
  const workspace = await fixture();
  await assert.rejects(() => analyzeSourceMedia(workspace, {}, { client: {} }), /requires --transcript or ELEVENLABS_API_KEY/);
});

test("keeps reference visual analysis out of factual evidence", async () => {
  const workspace = await fixture({ role: "reference", authoritative: false });
  const client = { runStructured: async () => ({ response_id: "r", model: "gpt-5.6", value: { resource_id: "take", summary: "Reference", visible_text: [], narrative_opportunities: ["pacing"], segments: [], quality_warnings: [] } }) };
  const result = await analyzeSourceMedia(workspace, {}, { client, contactSheet: async (_source, output) => writeFile(output, "sheet") });
  const evidence = JSON.parse(await readFile(result.evidence, "utf8"));
  const item = evidence.items.find((entry) => entry.kind === "reference-visual-analysis");
  assert.equal(item.claims_allowed, false);
});

test("stages a remote YouTube reference for visual and transcript analysis", async () => {
  const workspace = await fixture({ role: "reference", authoritative: false, remote: true });
  const staged = path.join(workspace, "reference.mp4");
  const client = { runStructured: async () => ({ response_id: "r", model: "gpt-5.6", value: { resource_id: "take", summary: "Fast reference", visible_text: [], narrative_opportunities: ["hook, proof, CTA"], segments: [], quality_warnings: [] } }) };
  const transcriber = { transcribe: async () => ({ provider: "elevenlabs", text: "Hook proof call to action", words: [{ word: "Hook", start: 0, end: .5 }, { word: "proof", start: .5, end: 1 }], language_code: "en" }) };
  const result = await analyzeSourceMedia(workspace, {}, {
    client, transcriber,
    stageReference: async () => { await writeFile(staged, "video"); return staged; },
    contactSheet: async (_source, output) => writeFile(output, "sheet")
  });
  assert.deepEqual(result.reference_videos, [staged]);
  const report = JSON.parse(await readFile(result.report, "utf8"));
  assert.equal(report.staged_references[0].source_url, "https://www.youtube.com/shorts/example");
  const evidence = JSON.parse(await readFile(result.evidence, "utf8"));
  const transcript = evidence.items.find((entry) => entry.kind === "media-transcript");
  assert.equal(transcript.claims_allowed, false);
  assert.equal(transcript.metadata.find((entry) => entry.key === "word_count").value, "2");
});

async function fixture(options = {}) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-source-media-"));
  const production = path.join(workspace, "production");
  await mkdir(production, { recursive: true });
  const media = options.remote ? "https://www.youtube.com/shorts/example" : path.join(workspace, "take.mp4");
  if (!options.remote) await writeFile(media, "media");
  const role = options.role ?? "voiceover";
  await writeFile(path.join(production, "intake.json"), `${JSON.stringify({
    brief: { language: "en" }, model: { id: "gpt-5.6" },
    policies: { supplied_voiceover_is_authoritative: options.authoritative ?? role === "voiceover" },
    resources: [{ id: "take", role, type: options.remote ? "url" : "video", location: media, is_remote: Boolean(options.remote), sha256: options.remote ? null : "hash" }]
  })}\n`);
  await writeFile(path.join(production, "evidence.json"), `${JSON.stringify({
    items: [{ id: "resource:take", kind: "video-metadata", role, title: "take.mp4", content: "{}", provenance: media, sha256: "hash", claims_allowed: false, truncated: false, metadata: [{ key: "duration_seconds", value: "5" }] }], warnings: []
  })}\n`);
  return workspace;
}

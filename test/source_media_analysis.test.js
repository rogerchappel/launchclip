import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeSourceMedia, MEDIA_ANALYSIS_SCHEMA } from "../src/source_media_analysis.js";
import { ProductionJobStore, semanticHash } from "../src/job_store.js";

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
  await writeFile(result.evidence, `${JSON.stringify({ ...evidence, items: evidence.items.filter((entry) => !["voiceover-transcript", "visual-media-analysis"].includes(entry.kind)) })}\n`);
  const cached = await analyzeSourceMedia(workspace, { background: false }, { client, transcriber, contactSheet: async () => { throw new Error("cached analysis must not recapture"); } });
  assert.equal(cached.cached, true);
  const rehydrated = JSON.parse(await readFile(result.evidence, "utf8"));
  assert.ok(rehydrated.items.some((entry) => entry.kind === "voiceover-transcript"));
  assert.ok(rehydrated.items.some((entry) => entry.kind === "visual-media-analysis"));
});

test("creates the visual-analysis client from the intake provider route", async () => {
  const workspace = await fixture({ role: "supporting", authoritative: false });
  const intakePath = path.join(workspace, "production", "intake.json");
  const intake = JSON.parse(await readFile(intakePath, "utf8"));
  intake.model = { provider: "openrouter", id: "openrouter/free", reasoning_effort: "none" };
  await writeFile(intakePath, `${JSON.stringify(intake, null, 2)}\n`);
  let route;
  const selected = visionSelection(path.join(workspace, "vision-state.json"));
  const result = await analyzeSourceMedia(workspace, {}, {
    selectOpenRouterFreeVisionModels: async () => selected,
    probeOpenRouterFreeVisionModels: async () => ({ ...selected, source: "live-probe", routes: [selected.routes[0]] }),
    createClient: (received) => {
      route = received;
      return { runStructured: async () => ({ response_id: "free-media", model: "free-vision", value: { resource_id: "take", summary: "Visible product", visible_text: [], narrative_opportunities: [], segments: [], quality_warnings: [] } }) };
    },
    contactSheet: async (_source, output) => writeFile(output, "contact-sheet")
  });
  assert.equal(route.provider, "openrouter");
  assert.equal(route.model, "google/gemma-4-31b-it:free");
  assert.equal(route.reasoning, "none");
  assert.equal(result.free_model_selection.selected_model, "google/gemma-4-31b-it:free");
});

test("rotates visual source analysis when the selected free vision model fails", async () => {
  const workspace = await fixture({ role: "supporting", authoritative: false });
  const intakePath = path.join(workspace, "production", "intake.json");
  const intake = JSON.parse(await readFile(intakePath, "utf8"));
  intake.model = { provider: "openrouter", id: "openrouter/free", reasoning_effort: "none" };
  await writeFile(intakePath, `${JSON.stringify(intake, null, 2)}\n`);
  const selected = visionSelection(path.join(workspace, "vision-state.json"));
  const fallback = {
    ...selected,
    selected_model: "google/gemma-4-26b-a4b-it:free",
    routes: ["openrouter:google/gemma-4-26b-a4b-it:free@none"]
  };
  const routes = [];
  const result = await analyzeSourceMedia(workspace, {}, {
    selectOpenRouterFreeVisionModels: async () => selected,
    probeOpenRouterFreeVisionModels: async (_selection, options) => options.excludeIds ? fallback : { ...selected, routes: [selected.routes[0]] },
    recordOpenRouterFreeModelOutcome: async (_selection, outcome) => {
      assert.match(outcome.error.message, /vision endpoint failed/);
      return fallback;
    },
    createClient: (route) => ({ runStructured: async () => {
      routes.push(route.model);
      if (route.model.includes("31b")) throw new Error("vision endpoint failed");
      return { response_id: "free-media-fallback", model: route.model, value: { resource_id: "take", summary: "Visible product", visible_text: [], narrative_opportunities: [], segments: [], quality_warnings: [] } };
    } }),
    contactSheet: async (_source, output) => writeFile(output, "contact-sheet")
  });
  assert.deepEqual(routes, ["google/gemma-4-31b-it:free", "google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free"]);
  assert.equal(result.free_model_selection.selected_model, "google/gemma-4-26b-a4b-it:free");
});

test("keeps a proven free vision model when a transient source analysis retry succeeds", async () => {
  const workspace = await fixture({ role: "supporting", authoritative: false });
  const intakePath = path.join(workspace, "production", "intake.json");
  const intake = JSON.parse(await readFile(intakePath, "utf8"));
  intake.model = { provider: "openrouter", id: "openrouter/free", reasoning_effort: "none" };
  await writeFile(intakePath, `${JSON.stringify(intake, null, 2)}\n`);
  const selected = visionSelection(path.join(workspace, "vision-state.json"));
  let attempts = 0;
  let rotations = 0;
  const result = await analyzeSourceMedia(workspace, {}, {
    selectOpenRouterFreeVisionModels: async () => selected,
    probeOpenRouterFreeVisionModels: async () => ({ ...selected, source: "live-probe", routes: [selected.routes[0]] }),
    recordOpenRouterFreeModelOutcome: async () => {
      rotations += 1;
      return selected;
    },
    createClient: (route) => ({ runStructured: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary vision capacity failure");
      return { response_id: "free-media-retry", model: route.model, value: { resource_id: "take", summary: "Visible product", visible_text: [], narrative_opportunities: [], segments: [], quality_warnings: [] } };
    } }),
    contactSheet: async (_source, output) => writeFile(output, "contact-sheet")
  });
  assert.equal(attempts, 2);
  assert.equal(rotations, 0);
  assert.equal(result.free_model_selection.selected_model, "google/gemma-4-31b-it:free");
});

test("gives the visual analyst real hook, cut, and motion timing instead of placeholder seconds", async () => {
  const workspace = await fixture({ role: "reference", authoritative: false });
  let request;
  const result = await analyzeSourceMedia(workspace, {}, {
    client: { runStructured: async (options) => {
      request = options;
      return { response_id: "r", model: "gpt-5.6", value: { resource_id: "take", summary: "Temporal reference", visible_text: [], narrative_opportunities: ["front-load the promise"], segments: [{ start_seconds: 1.2, end_seconds: 3.8, description: "Hook changes register", proof_value: "Editorial reference only", motion_or_interaction: "Two fast cuts", recommended_usage: "hook cadence" }], quality_warnings: [] } };
    } },
    contactSheets: async (_source, directory) => {
      const sheets = [
        { kind: "overview", path: path.join(directory, "overview.jpg"), sample_count: 12, sampling: "even" },
        { kind: "hook", path: path.join(directory, "hook.jpg"), sample_count: 16, interval_seconds: .25, sampling: "dense-hook" },
        { kind: "cuts", path: path.join(directory, "cuts.jpg"), sample_count: 2, timestamps_seconds: [1.2, 2.7], sampling: "detected-cut-boundaries" }
      ];
      await Promise.all(sheets.map((sheet) => writeFile(sheet.path, sheet.kind)));
      return { sheets, temporal_profile: { duration_seconds: 5, cuts: [1.2, 2.7], cut_rate_per_minute: 24, motion_bursts: [{ start_seconds: 1.15, end_seconds: 1.3, peak_energy: 42 }], motion_bursts_per_minute: 36, hold_ratio: .42, family: "rapid-hybrid" } };
    }
  });
  const input = JSON.parse(request.input);
  assert.equal(request.images.length, 3);
  assert.equal(input.duration_seconds, 5);
  assert.deepEqual(input.contact_sheets[2].timestamps_seconds, [1.2, 2.7]);
  assert.equal(input.temporal_profile.motion_bursts[0].peak_energy, 42);
  const report = JSON.parse(await readFile(result.report, "utf8"));
  assert.equal(report.analyses[0].contact_sheets.length, 3);
  assert.equal(report.analyses[0].temporal_profile.family, "rapid-hybrid");
});

test("requires a transcript path or Scribe credentials before planning supplied narration", async () => {
  const workspace = await fixture();
  await assert.rejects(() => analyzeSourceMedia(workspace, {}, { client: {} }), /requires --transcript or ELEVENLABS_API_KEY/);
});

test("does not retranscribe authoritative voiceover when supplied transcript evidence exists", async () => {
  const workspace = await fixture();
  const evidencePath = path.join(workspace, "production", "evidence.json");
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  evidence.items.push({ id: "resource:take:transcript", kind: "voiceover-transcript", role: "voiceover", title: "Supplied transcript", content: "Exact supplied words.", provenance: "take.txt", claims_allowed: false, metadata: [] });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  const result = await analyzeSourceMedia(workspace, {}, {
    transcriber: { transcribe: async () => { throw new Error("supplied transcript must be reused"); } },
    client: { runStructured: async () => ({ response_id: "r", model: "gpt-5.6", value: { resource_id: "take", summary: "Visible product", visible_text: [], narrative_opportunities: [], segments: [], quality_warnings: [] } }) },
    contactSheet: async (_source, output) => writeFile(output, "contact-sheet")
  });
  assert.equal(result.transcripts, 0);
});

test("recovers an interrupted aggregate source-media job", async () => {
  const workspace = await fixture({ role: "supporting", authoritative: false });
  const intake = JSON.parse(await readFile(path.join(workspace, "production", "intake.json"), "utf8"));
  const evidence = JSON.parse(await readFile(path.join(workspace, "production", "evidence.json"), "utf8"));
  const inputHash = semanticHash({ intake, evidence, options: { samples: 12, columns: 4, hookSeconds: 4, hookFps: 4, reasoning: "high", transcriptionModel: "scribe_v2", transcribeAll: false, stageRemoteReferences: true }, stage: "source-media-analysis.v4" });
  const store = await ProductionJobStore.open(workspace);
  await store.add({ id: "source-media-analysis", kind: "source-media-analysis", depends_on: [], input_hash: inputHash });
  await store.markRunning("source-media-analysis");
  const result = await analyzeSourceMedia(workspace, {}, {
    store,
    client: { runStructured: async () => ({ response_id: "r", model: "gpt-5.6", value: { resource_id: "take", summary: "Recovered", visible_text: [], narrative_opportunities: [], segments: [], quality_warnings: [] } }) },
    contactSheet: async (_source, output) => writeFile(output, "sheet")
  });
  assert.equal(result.status, "ready");
  assert.equal(store.get("source-media-analysis").status, "succeeded");
});

test("keeps reference visual analysis out of factual evidence", async () => {
  const workspace = await fixture({ role: "reference", authoritative: false });
  const client = { runStructured: async () => ({ response_id: "r", model: "gpt-5.6", value: { resource_id: "take", summary: "Reference", visible_text: [], narrative_opportunities: ["pacing"], segments: [], quality_warnings: [] } }) };
  const result = await analyzeSourceMedia(workspace, {}, { client, contactSheet: async (_source, output) => writeFile(output, "sheet") });
  const evidence = JSON.parse(await readFile(result.evidence, "utf8"));
  const item = evidence.items.find((entry) => entry.kind === "reference-visual-analysis");
  assert.equal(item.claims_allowed, false);
});

test("rasterizes SVG resources before GPT vision upload", async () => {
  const workspace = await fixture({ role: "supporting", authoritative: false, type: "image", extension: ".svg" });
  let image;
  const result = await analyzeSourceMedia(workspace, {}, {
    client: { runStructured: async (options) => { image = options.images[0]; return { response_id: "r", model: "gpt-5.6", value: { resource_id: "take", summary: "Logo", visible_text: [], narrative_opportunities: [], segments: [], quality_warnings: [] } }; } },
    rasterizeImage: async (_source, output) => writeFile(output, "png")
  });
  assert.equal(result.analyses, 1);
  assert.match(image.url, /^data:image\/png;base64,/);
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

test("retries a YouTube reference with the compatible single-stream client", async () => {
  const workspace = await fixture({ role: "reference", authoritative: false, remote: true });
  const attempts = [];
  const result = await analyzeSourceMedia(workspace, {}, {
    client: { runStructured: async () => ({ response_id: "r", model: "vision", value: { resource_id: "take", summary: "Reference", visible_text: [], narrative_opportunities: [], segments: [], quality_warnings: [] } }) },
    transcriber: { transcribe: async () => ({ provider: "elevenlabs", text: "Reference", words: [], language_code: "en" }) },
    run: async (command, args) => {
      assert.equal(command, "yt-dlp");
      attempts.push(args);
      if (attempts.length === 1) throw new Error("HTTP Error 403: Forbidden");
      await writeFile(args[args.indexOf("--output") + 1], "video");
    },
    contactSheet: async (_source, output) => writeFile(output, "sheet")
  });
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1][attempts[1].indexOf("--extractor-args") + 1], "youtube:player_client=android_vr");
  assert.equal(result.reference_videos.length, 1);
});

test("continues without an unavailable creative reference", async () => {
  const workspace = await fixture({ role: "reference", authoritative: false, remote: true });
  const result = await analyzeSourceMedia(workspace, {}, { stageReference: async () => { throw new Error("reference host unavailable"); } });
  assert.equal(result.status, "ready");
  assert.equal(result.reference_warnings, 1);
  assert.deepEqual(result.reference_videos, []);
  const report = JSON.parse(await readFile(result.report, "utf8"));
  assert.match(report.reference_warnings[0].error, /reference host unavailable/);
});

function visionSelection(statePath) {
  return {
    source: "ranked",
    state_path: statePath,
    selected_model: "google/gemma-4-31b-it:free",
    verified_free_at: "2026-07-18T00:00:00.000Z",
    routes: ["openrouter:google/gemma-4-31b-it:free@none", "openrouter:google/gemma-4-26b-a4b-it:free@none"],
    candidates: [
      { id: "google/gemma-4-31b-it:free", score: 18.75, coverage: 0 },
      { id: "google/gemma-4-26b-a4b-it:free", score: 17.5, coverage: 0 }
    ],
    warnings: []
  };
}

async function fixture(options = {}) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-source-media-"));
  const production = path.join(workspace, "production");
  await mkdir(production, { recursive: true });
  const media = options.remote ? "https://www.youtube.com/shorts/example" : path.join(workspace, `take${options.extension ?? ".mp4"}`);
  if (!options.remote) await writeFile(media, "media");
  const role = options.role ?? "voiceover";
  await writeFile(path.join(production, "intake.json"), `${JSON.stringify({
    brief: { language: "en" }, model: { id: "gpt-5.6" },
    policies: { supplied_voiceover_is_authoritative: options.authoritative ?? role === "voiceover" },
    resources: [{ id: "take", role, type: options.remote ? "url" : options.type ?? "video", location: media, is_remote: Boolean(options.remote), sha256: options.remote ? null : "hash" }]
  })}\n`);
  await writeFile(path.join(production, "evidence.json"), `${JSON.stringify({
    items: [{ id: "resource:take", kind: "video-metadata", role, title: "take.mp4", content: "{}", provenance: media, sha256: "hash", claims_allowed: false, truncated: false, metadata: [{ key: "duration_seconds", value: "5" }] }], warnings: []
  })}\n`);
  return workspace;
}

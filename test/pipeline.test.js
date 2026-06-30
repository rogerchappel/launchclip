import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, access, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { initWorkspace, planVideo, renderDryRun, renderVideo, runDemo, runPacket, submitReview, validateWorkspace, writeCaptions, writeReview } from "../src/pipeline.js";

const execFileAsync = promisify(execFile);

const fixtureRepo = path.resolve("test/fixtures/sample-tool");

test("creates a complete dry-run promotion packet", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  const screenshot = path.join(temp, "demo.png");
  try {
    await writeFile(screenshot, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwq3GQAAAABJRU5ErkJggg==", "base64"));
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, { out, "demo-cmd": "npm run smoke", capture: "terminal", "demo-media": screenshot });
    await planVideo(out, { format: "short-30", renderer: "none" });
    await writeCaptions(out, { platforms: "x,linkedin,tiktok,bluesky" });
    await renderDryRun(out, { provider: "product-videogen", "dry-run": true });
    await submitReview(out, { provider: "product-videogen", "dry-run": true });
    await writeReview(out);

    const manifest = JSON.parse(await readFile(path.join(out, "launchclip.json"), "utf8"));
    const reviewPayload = JSON.parse(await readFile(path.join(out, "review/product-videogen-review.dry-run.json"), "utf8"));
    const review = await readFile(path.join(out, "REVIEW.md"), "utf8");

    assert.equal(manifest.source_repo.name, "sample-tool");
    assert.equal(manifest.stages.submit_review.approval_status, "pending");
    assert.equal(reviewPayload.approval_status, "pending");
    assert.equal(reviewPayload.metadata_json.claim_status, "evidence_backed");
    assert.match(review, /Product-Videogen Follow-Up/);
    assert.match(review, /Social readiness: ready/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("runs and validates a social-ready packet in one command", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  try {
    const result = await runPacket(fixtureRepo, {
      out,
      "demo-cmd": "npm run smoke",
      angle: "turns demo proof into launch content",
      audience: "maintainers who want trustworthy docs without CI drama",
      "cta-url": "https://github.com/rogerchappel/sample-tool"
    });
    const readiness = await validateWorkspace(out);
    const xCaption = await readFile(path.join(out, "captions/x.md"), "utf8");
    const video = JSON.parse(await readFile(path.join(out, "video/video.json"), "utf8"));

    assert.equal(result.status, "ready");
    assert.equal(readiness.status, "ready");
    assert.equal(video.format, "short-15");
    assert.equal(video.duration_seconds, 15);
    assert.match(video.structure.map((beat) => beat.beat).join(","), /usage/);
    assert.ok(xCaption.length <= 280);
    assert.match(xCaption, /Claim status:/);
    assert.doesNotMatch(xCaption, /wit\./);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("plans ugc split-screen creative recipe for product-videogen handoff", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  try {
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, { out, "demo-cmd": "npm run smoke", capture: "terminal" });
    await planVideo(out, { format: "short-30", renderer: "product-videogen", style: "ugc-split", "talking-head": "heygen", "avatar-id": "avatar_launchclip_demo" });
    await writeCaptions(out, { platforms: "x,linkedin,tiktok,bluesky" });
    await renderDryRun(out, { provider: "product-videogen", "dry-run": true });

    const video = JSON.parse(await readFile(path.join(out, "video/video.json"), "utf8"));
    const renderPlan = JSON.parse(await readFile(path.join(out, "video/render-plan.json"), "utf8"));
    const payload = JSON.parse(await readFile(path.join(out, "video/product-videogen.dry-run.json"), "utf8"));

    assert.equal(video.style, "ugc-split");
    assert.equal(video.duration_seconds, 30);
    assert.equal(video.creative_recipe.preset, "ugc-split");
    assert.equal(video.creative_storyboard.schema_version, "launchclip.storyboard.v1");
    assert.equal(video.creative_storyboard.scenes.length, 5);
    assert.match(video.creative_storyboard.non_goals.join("\n"), /retro terminal art/);
    assert.deepEqual(video.creative_storyboard.renderer_priority.slice(0, 2), ["remotion", "hyperframes"]);
    assert.equal(video.talking_head.provider, "heygen");
    assert.equal(video.talking_head.avatar_id, "avatar_launchclip_demo");
    assert.equal(video.talking_head.adapter_contract, "launchclip.talking-head.v1");
    assert.equal(video.script.schema_version, "launchclip.script.v1");
    assert.equal(video.voiceover.schema_version, "launchclip.voiceover.v1");
    assert.equal(video.voiceover.segments.length, 5);
    assert.equal(video.sound_design.schema_version, "launchclip.sound-design.v1");
    assert.equal(video.sound_design.cues.length, 5);
    assert.equal(video.script_visual_alignment.length, 5);
    assert.equal(video.script_visual_alignment[0].beat, "hook");
    assert.match(video.script_visual_alignment[0].voiceover, /sample-tool/);
    assert.match(video.script_visual_alignment[1].visual, /split-screen/i);
    assert.equal(video.script_visual_alignment[4].caption, "Review before posting");
    assert.match(video.structure.map((beat) => beat.beat).join(","), /split-screen-proof/);
    assert.match(renderPlan.adapters.heygen, /First talking-head adapter target/);
    assert.equal(renderPlan.script_visual_alignment.length, 5);
    assert.equal(renderPlan.sound_design.cues[0].duck_voiceover, true);
    assert.equal(renderPlan.creative_recipe.visual_language.pacing, "scene change every 1-3 seconds; avoid long static terminal shots");
    assert.equal(payload.recipe_json.creative_recipe.preset, "ugc-split");
    assert.equal(payload.recipe_json.voiceover.schema_version, "launchclip.voiceover.v1");
    assert.equal(payload.recipe_json.sound_design.schema_version, "launchclip.sound-design.v1");
    assert.equal(payload.recipe_json.creative_storyboard.scenes[0].layout, "full-screen editorial hook with creator picture-in-picture and repo receipt");
    assert.equal(payload.recipe_json.talking_head.provider, "heygen");
    assert.equal(payload.recipe_json.script_visual_alignment[2].caption, "Demo -> plan -> captions -> review");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("plans premium product short contract with deterministic asset warnings", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  const assetsDir = path.join(temp, "assets");
  try {
    await writePremiumAssetManifest(assetsDir, {
      "claude-code": "claude-code.png",
      "prompt-example": { path: "prompt-example.txt", type: "text", label: "Launch prompt" },
      "sfx-connector-pop": { path: "connector_pop.wav", type: "sfx", label: "Connector pop" },
      "sfx-single-type": { path: "single_type.wav", type: "sfx", label: "Single type" }
    });
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, { out, "demo-cmd": "npm run smoke", capture: "terminal" });
    await planVideo(out, { format: "short-30", renderer: "product-videogen", style: "premium-product-short", "assets-dir": assetsDir });
    await writeCaptions(out, { platforms: "x,linkedin,tiktok,bluesky" });
    await renderDryRun(out, { provider: "product-videogen", "dry-run": true });
    await submitReview(out, { provider: "product-videogen", "dry-run": true });

    const video = JSON.parse(await readFile(path.join(out, "video/video.json"), "utf8"));
    const payload = JSON.parse(await readFile(path.join(out, "video/product-videogen.dry-run.json"), "utf8"));
    const readiness = await validateWorkspace(out);
    const frame = await readFile(path.join(out, "video/frame.md"), "utf8");
    const storyboardHtml = await readFile(path.join(out, "video/storyboard.html"), "utf8");
    const hyperframesHtml = await readFile(path.join(out, "video/hyperframes/index.html"), "utf8");
    const hyperframesQaHtml = await readFile(path.join(out, "video/hyperframes/template-qa.html"), "utf8");
    const hyperframesAssetReadinessHtml = await readFile(path.join(out, "video/hyperframes/asset-readiness.html"), "utf8");
    const hyperframesChartDiagramQaHtml = await readFile(path.join(out, "video/hyperframes/chart-diagram-qa.html"), "utf8");
    const hyperframesQualityChecklist = await readFile(path.join(out, "video/hyperframes/QUALITY.md"), "utf8");
    const hyperframesSfxManifest = JSON.parse(await readFile(path.join(out, "video/hyperframes/sfx-manifest.json"), "utf8"));
    const hyperframesData = JSON.parse(await readFile(path.join(out, "video/hyperframes/launchclip-data.json"), "utf8"));

    assert.equal(video.style, "premium-product-short");
    assert.equal(video.duration_seconds, 48);
    assert.equal(video.art_direction.schema_version, "launchclip.art-direction.v1");
    assert.deepEqual(video.art_direction.renderer_targets.slice(0, 2), ["hyperframes", "remotion"]);
    assert.equal(video.art_direction.reusable_object_library.target_count, 100);
    assert.ok(video.art_direction.charts_diagrams.chart_types.length >= 8);
    assert.ok(video.art_direction.charts_diagrams.diagram_types.length >= 8);
    assert.equal(video.object_lifecycle.length, video.creative_storyboard.scenes.length);
    const allObjectStates = video.object_lifecycle.flatMap((object) => object.states.map((state) => state.state));
    assert.ok(allObjectStates.includes("connect"));
    assert.ok(allObjectStates.includes("drift"));
    assert.ok(allObjectStates.includes("pulse"));
    for (const object of video.object_lifecycle) {
      const objectStates = object.states.map((state) => state.state);
      assert.equal(objectStates.slice(0, 3).join(" -> "), "enter -> settle -> transform");
      assert.deepEqual(objectStates.slice(-2), ["emphasize", "exit"]);
      assert.ok(maxLifecycleGap(object.states) <= 1.2, `${object.id} has a static hold over 1.2s`);
    }
    assert.equal(video.art_direction.persistent_objects.count, video.object_lifecycle.length);
    const objectTemplates = new Set(video.object_lifecycle.map((object) => object.template));
    for (const template of ["brand_token", "terminal_ui", "diagram", "prompt_ui", "chart", "folder_stack", "cta_card"]) {
      assert.ok(objectTemplates.has(template), `missing HyperFrames object template ${template}`);
    }
    assert.equal(video.hyperframes.schema_version, "launchclip.hyperframes-handoff.v1");
    assert.equal(video.hyperframes.entrypoint, "video/hyperframes/index.html");
    assert.equal(video.hyperframes.template_qa_preview, "video/hyperframes/template-qa.html");
    assert.equal(video.hyperframes.sfx_manifest, "video/hyperframes/sfx-manifest.json");
    assert.equal(video.hyperframes.asset_readiness, "video/hyperframes/asset-readiness.html");
    assert.equal(video.hyperframes.chart_diagram_qa, "video/hyperframes/chart-diagram-qa.html");
    assert.equal(video.hyperframes.quality_checklist, "video/hyperframes/QUALITY.md");
    assert.deepEqual(video.hyperframes.render_command.slice(0, 4), ["npx", "hyperframes", "render", "."]);
    assert.equal(video.hyperframes.object_lifecycle.objects.length, video.object_lifecycle.length);
    assert.equal(video.creative_recipe.renderer_contract.composition_id, "LaunchclipPremiumShort");
    assert.deepEqual(video.assets.provided_aliases, ["claude-code", "prompt-example", "sfx-connector-pop", "sfx-single-type"]);
    assert.deepEqual(video.assets.missing_aliases, ["github", "obsidian", "terminal-demo"]);
    assert.equal(video.creative_storyboard.asset_manifest.expected_file, "launchclip-assets.json");
    assert.equal(video.creative_storyboard.scenes.length, 8);
    assert.deepEqual(video.creative_storyboard.scenes[2].asset_aliases, ["claude-code", "obsidian", "github"]);
    assert.ok(video.creative_storyboard.scenes[3].type_sequences.length >= 1);
    assert.ok(video.creative_storyboard.scenes[5].motion_blur.method.includes("ghost layers"));
    assert.ok(video.creative_storyboard.scenes[5].depth_layer.foreground.includes("cards"));
    assert.ok(video.creative_storyboard.scenes[6].sfx_cues.includes("typing-ticks"));
    assert.ok(video.creative_storyboard.scenes[7].brand_moments.length >= 1);
    assert.equal(payload.recipe_json.video_manifest.style, "premium-product-short");
    assert.equal(payload.recipe_json.art_direction.schema_version, "launchclip.art-direction.v1");
    assert.equal(payload.recipe_json.hyperframes.composition_id, "LaunchclipHyperframes");
    assert.equal(payload.recipe_json.assets.schema_version, "launchclip.assets.v1");
    assert.equal(payload.recipe_json.creative_storyboard.scenes[3].type_sequences[0].source_alias, "prompt-example");
    assert.match(frame, /Primary: HyperFrames/);
    assert.match(frame, /Target object count: 100\+/);
    assert.match(frame, /Persistent Object Timeline/);
    assert.match(frame, /connect -> drift -> pulse/);
    assert.match(frame, /template=diagram/);
    assert.match(storyboardHtml, /Receipts before posting|The proof board|Repo proof to premium Short/);
    assert.match(storyboardHtml, /Objects/);
    assert.match(hyperframesHtml, /data-composition-id="LaunchclipHyperframes"/);
    assert.match(hyperframesHtml, /id="grid-bg" class="clip grid-bg"/);
    assert.match(hyperframesHtml, /id="scene-1" class="clip scene/);
    assert.match(hyperframesHtml, /window\.__timelines = window\.__timelines \|\| \{\}/);
    assert.match(hyperframesHtml, /gsap\.timeline\(\{ paused: true/);
    assert.match(hyperframesHtml, /window\.__timelines\["LaunchclipHyperframes"\] = launchclipTimeline/);
    assert.match(hyperframesHtml, /data-object-id="hf-/);
    assert.match(hyperframesHtml, /data-template="diagram"/);
    assert.match(hyperframesHtml, /data-states=/);
    assert.match(hyperframesHtml, /lifecycle-object/);
    assert.match(hyperframesHtml, /object-terminal/);
    assert.match(hyperframesHtml, /object-diagram/);
    assert.match(hyperframesHtml, /chart-bar-fill/);
    assert.match(hyperframesHtml, /diagram-connector-line/);
    assert.match(hyperframesHtml, /data-polish="launchclip\.object-polish\.v1"/);
    assert.match(hyperframesHtml, /data-quality="review-ready"/);
    assert.match(hyperframesHtml, /data-source-status="source-declared"/);
    assert.match(hyperframesHtml, /data-sfx-count="[1-9]/);
    assert.match(hyperframesHtml, /aria-label="HyperFrames/);
    assert.match(hyperframesHtml, /object-chrome/);
    assert.match(hyperframesHtml, /object-state-strip/);
    assert.match(hyperframesHtml, /diagram-endpoint-count/);
    assert.match(hyperframesHtml, /chart-legend/);
    assert.match(hyperframesHtml, /chart-value/);
    assert.match(hyperframesHtml, /prefers-reduced-motion/);
    assert.match(hyperframesHtml, /motionDuration/);
    assert.match(hyperframesHtml, /@hyperframes\/core/);
    assert.match(hyperframesHtml, /state.state === "connect"/);
    assert.match(hyperframesHtml, /state.state === "drift"/);
    assert.match(hyperframesHtml, /state.state === "pulse"/);
    assert.match(hyperframesHtml, /launchclip-sfx-manifest/);
    assert.match(hyperframesHtml, /scheduleLifecycleSfx/);
    assert.match(hyperframesHtml, /data-sfx-runtime="launchclip\.hyperframes-audio-runtime\.v1"/);
    assert.match(hyperframesHtml, /data-sfx-manifest="sfx-manifest\.json"/);
    assert.match(hyperframesHtml, /data-sfx-available="(?:[3-9]|[1-9][0-9]+)"/);
    assert.match(hyperframesHtml, /data-sfx-storyboard-cues="/);
    assert.match(hyperframesHtml, /class="launchclip-sfx-audio"/);
    assert.match(hyperframesHtml, /data-sfx-id="connector-pop"/);
    assert.match(hyperframesHtml, /src="sfx\/connector_pop\.wav"/);
    assert.match(hyperframesHtml, /launchclipSfxAudio/);
    assert.match(hyperframesHtml, /gainToVolume/);
    assert.match(hyperframesHtml, /playSfxCue/);
    assert.match(hyperframesHtml, /scheduleSfxCue/);
    assert.match(hyperframesHtml, /scheduleStoryboardSfx/);
    assert.match(hyperframesHtml, /gsap\.delayedCall/);
    assert.match(hyperframesQaHtml, /HyperFrames Template QA/);
    assert.match(hyperframesQaHtml, /Template coverage/);
    assert.match(hyperframesQaHtml, /Static hold checks/);
    assert.match(hyperframesQaHtml, /Reusable Object Snapshots/);
    assert.match(hyperframesQaHtml, /data-template="brand_token"/);
    assert.match(hyperframesQaHtml, /data-template="terminal_ui"/);
    assert.match(hyperframesQaHtml, /data-template="diagram"/);
    assert.match(hyperframesQaHtml, /chart-bar-fill/);
    assert.match(hyperframesQaHtml, /Lifecycle Audit/);
    assert.match(hyperframesQaHtml, /QA flags<\/span><strong>0<\/strong>/);
    assert.match(hyperframesAssetReadinessHtml, /HyperFrames Asset Readiness/);
    assert.match(hyperframesAssetReadinessHtml, /Real assets/);
    assert.match(hyperframesAssetReadinessHtml, /Missing assets/);
    assert.match(hyperframesAssetReadinessHtml, /Storyboard Dependencies/);
    assert.match(hyperframesAssetReadinessHtml, /github/);
    assert.match(hyperframesAssetReadinessHtml, /sfx\/connector_pop\.wav/);
    assert.match(hyperframesAssetReadinessHtml, /available-local-asset/);
    assert.doesNotMatch(hyperframesAssetReadinessHtml, /<tr class="status-expected-local-asset"/);
    assert.match(hyperframesChartDiagramQaHtml, /HyperFrames Chart And Diagram QA/);
    assert.match(hyperframesChartDiagramQaHtml, /Chart Objects/);
    assert.match(hyperframesChartDiagramQaHtml, /Diagram Objects/);
    assert.match(hyperframesChartDiagramQaHtml, /Connector endpoints/);
    assert.match(hyperframesChartDiagramQaHtml, /Source status/);
    assert.match(hyperframesChartDiagramQaHtml, /Data table/);
    assert.match(hyperframesChartDiagramQaHtml, /matrix_chart/);
    assert.match(hyperframesChartDiagramQaHtml, /connector_graph/);
    assert.match(hyperframesQualityChecklist, /HyperFrames Quality Handoff/);
    assert.match(hyperframesQualityChecklist, /Gate Table/);
    assert.match(hyperframesQualityChecklist, /Template QA/);
    assert.match(hyperframesQualityChecklist, /Asset readiness/);
    assert.match(hyperframesQualityChecklist, /Chart and diagram QA/);
    assert.match(hyperframesQualityChecklist, /SFX runtime/);
    assert.match(hyperframesQualityChecklist, /Human Acceptance Checklist/);
    assert.match(hyperframesQualityChecklist, /npx hyperframes render \./);
    assert.equal(hyperframesSfxManifest.schema_version, "launchclip.hyperframes-sfx.v1");
    assert.equal(hyperframesSfxManifest.runtime.schema_version, "launchclip.hyperframes-audio-runtime.v1");
    assert.equal(hyperframesSfxManifest.runtime.scheduler, "gsap.delayedCall");
    assert.ok(hyperframesSfxManifest.assets.length >= 4);
    assert.ok(hyperframesSfxManifest.cues.length >= video.object_lifecycle.length);
    assert.ok(hyperframesSfxManifest.storyboard_cues.length >= video.creative_storyboard.scenes.length);
    assert.ok(hyperframesSfxManifest.assets.some((asset) => asset.id === "connector-pop" && asset.path === "sfx/connector_pop.wav"));
    assert.ok(hyperframesSfxManifest.assets.some((asset) => asset.id === "connector-pop" && asset.status === "available-local-asset" && asset.source_alias === "sfx-connector-pop"));
    assert.ok(hyperframesSfxManifest.assets.some((asset) => asset.id === "single-type" && asset.family === "typing-tick" && asset.status === "available-local-asset"));
    assert.ok(hyperframesSfxManifest.assets.some((asset) => asset.family === "typing-tick"));
    assert.ok(hyperframesSfxManifest.copied_assets.some((asset) => asset.asset_id === "connector-pop" && asset.path === "sfx/connector_pop.wav"));
    assert.ok(hyperframesSfxManifest.copied_assets.some((asset) => asset.asset_id === "paper-hit" && asset.alias === "generated-default-sfx"));
    assert.deepEqual(hyperframesSfxManifest.missing_assets, []);
    assert.ok(hyperframesSfxManifest.cues.some((cue) => cue.state === "connect" && cue.asset_id === "connector-pop"));
    assert.ok(hyperframesSfxManifest.cues.every((cue) => cue.duck_voiceover === true));
    assert.equal(hyperframesData.sfx_manifest.cues.length, hyperframesSfxManifest.cues.length);
    assert.equal(hyperframesData.asset_readiness.schema_version, "launchclip.hyperframes-asset-readiness.v1");
    assert.ok(hyperframesData.asset_readiness.summary.visual_real >= 2);
    assert.ok(hyperframesData.asset_readiness.summary.visual_missing >= 3);
    assert.ok(hyperframesData.asset_readiness.summary.audio_real >= 4);
    assert.equal(hyperframesData.asset_readiness.summary.audio_missing, 0);
    assert.ok(hyperframesData.asset_readiness.visual_assets.some((asset) => asset.alias === "github" && asset.status === "missing-required-asset"));
    assert.ok(hyperframesData.asset_readiness.audio_assets.some((asset) => asset.id === "connector-pop" && asset.status === "available-local-asset"));
    assert.equal(hyperframesData.chart_diagram_qa.schema_version, "launchclip.hyperframes-chart-diagram-qa.v1");
    assert.ok(hyperframesData.chart_diagram_qa.summary.chart_objects >= 1);
    assert.ok(hyperframesData.chart_diagram_qa.summary.diagram_objects >= 1);
    assert.equal(hyperframesData.chart_diagram_qa.summary.issues, 0);
    assert.ok(hyperframesData.chart_diagram_qa.chart_objects.some((object) => object.ref === "matrix_chart" && object.data_mark_count >= 2 && object.source_status === "source-declared"));
    assert.ok(hyperframesData.chart_diagram_qa.diagram_objects.some((object) => object.ref === "connector_graph" && object.endpoint_count >= 2 && object.source_status === "source-declared"));
    assert.equal(hyperframesData.quality_handoff.schema_version, "launchclip.hyperframes-quality-handoff.v1");
    assert.equal(hyperframesData.quality_handoff.summary.total, 5);
    assert.ok(hyperframesData.quality_handoff.checks.some((check) => check.gate === "Template QA" && check.status === "pass"));
    assert.ok(hyperframesData.quality_handoff.checks.some((check) => check.gate === "SFX runtime" && check.status === "pass"));
    assert.ok(hyperframesData.quality_handoff.review_order.length >= 5);
    assert.equal(hyperframesData.video.object_lifecycle.length, video.object_lifecycle.length);
    assert.equal(hyperframesData.video.object_lifecycle[2].template, "diagram");
    await access(path.join(out, "video/hyperframes/README.md"));
    await access(path.join(out, "video/hyperframes/template-qa.html"));
    await access(path.join(out, "video/hyperframes/asset-readiness.html"));
    await access(path.join(out, "video/hyperframes/chart-diagram-qa.html"));
    await access(path.join(out, "video/hyperframes/QUALITY.md"));
    await access(path.join(out, "video/hyperframes/sfx-manifest.json"));
    await access(path.join(out, "video/hyperframes/sfx/connector_pop.wav"));
    await access(path.join(out, "video/hyperframes/sfx/paper_hit.wav"));
    await access(path.join(out, "video/hyperframes/sfx/single_type.wav"));
    await access(path.join(out, "video/hyperframes/launchclip-data.json"));
    assert.equal(readiness.status, "ready");
    assert.deepEqual(readiness.warnings, [
      "Missing asset alias: github",
      "Missing asset alias: obsidian",
      "Missing asset alias: terminal-demo"
    ]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("plans original 150 second data-story benchmark contract", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  try {
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, { out, "demo-cmd": "npm run smoke", capture: "terminal" });
    await planVideo(out, { format: "short-150", renderer: "hyperframes", style: "data-story-benchmark" });
    await writeCaptions(out, { platforms: "x,linkedin,tiktok,bluesky" });
    await renderDryRun(out, { provider: "product-videogen", "dry-run": true });
    await submitReview(out, { provider: "product-videogen", "dry-run": true });

    const video = JSON.parse(await readFile(path.join(out, "video/video.json"), "utf8"));
    const renderPlan = JSON.parse(await readFile(path.join(out, "video/render-plan.json"), "utf8"));
    const payload = JSON.parse(await readFile(path.join(out, "video/product-videogen.dry-run.json"), "utf8"));
    const hyperframesData = JSON.parse(await readFile(path.join(out, "video/hyperframes/launchclip-data.json"), "utf8"));
    const frame = await readFile(path.join(out, "video/frame.md"), "utf8");
    const storyboardHtml = await readFile(path.join(out, "video/storyboard.html"), "utf8");
    const readiness = await validateWorkspace(out);
    const words = video.voiceover.full_text.split(/\s+/).filter(Boolean);

    assert.equal(video.style, "data-story-benchmark");
    assert.equal(video.duration_seconds, 150);
    assert.equal(video.talking_head.provider, "none");
    assert.equal(video.creative_recipe.preset, "data-story-benchmark");
    assert.equal(video.creative_recipe.duration_seconds, 150);
    assert.equal(video.creative_recipe.renderer_contract.primary_renderer, "hyperframes");
    assert.match(video.creative_recipe.benchmark_reference_observations.observed_pacing, /400 words/);
    assert.ok(words.length >= 350 && words.length <= 430, `expected benchmark voiceover word count near reference density, got ${words.length}`);
    assert.equal(video.script_visual_alignment.length, 20);
    assert.equal(video.creative_storyboard.scenes.length, 20);
    assert.equal(video.sound_design.cues.length, 20);
    assert.equal(video.object_lifecycle.length, 20);
    assert.equal(video.script_visual_alignment[0].beat, "data-hook");
    assert.equal(video.script_visual_alignment[19].beat, "benchmark-cta");
    assert.match(video.creative_storyboard.non_goals.join("\n"), /Do not download or reuse the reference transcript/);
    assert.match(video.creative_storyboard.quality_gates.join("\n"), /150 seconds/);
    assert.match(video.creative_storyboard.scenes[3].layout, /matrix chart/);
    assert.match(video.creative_storyboard.scenes[10].layout, /pipeline connector diagram/);
    assert.equal(payload.duration_seconds, 150);
    assert.equal(payload.recipe_json.video_manifest.style, "data-story-benchmark");
    assert.equal(renderPlan.hyperframes.duration_seconds, 150);
    assert.match(frame, /data marks/);
    assert.match(storyboardHtml, /Original benchmark/);
    assert.equal(hyperframesData.video.duration_seconds, 150);
    assert.equal(hyperframesData.video.timeline.length, 20);
    assert.ok(hyperframesData.chart_diagram_qa.summary.chart_objects >= 10);
    assert.ok(hyperframesData.chart_diagram_qa.summary.diagram_objects >= 4);
    assert.equal(hyperframesData.chart_diagram_qa.summary.issues, 0);
    assert.ok(hyperframesData.quality_handoff.checks.some((check) => check.gate === "Chart and diagram QA" && check.status === "pass"));
    for (const object of video.object_lifecycle) {
      assert.ok(maxLifecycleGap(object.states) <= 1.2, `${object.id} has a static hold over 1.2s`);
    }
    assert.equal(readiness.status, "ready");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("plans and renders punchy social-ready UGC preview", async (t) => {
  if (!(await hasCommand("ffmpeg"))) {
    t.skip("ffmpeg is not installed");
    return;
  }
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  try {
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, { out, "demo-cmd": "npm run smoke", capture: "terminal" });
    await planVideo(out, { format: "short-30", renderer: "local-ffmpeg", style: "ugc-demo-punchy", "talking-head": "heygen" });
    await writeCaptions(out, { platforms: "x,linkedin,tiktok,bluesky" });
    await renderDryRun(out, { provider: "product-videogen", "dry-run": true });
    await submitReview(out, { provider: "product-videogen", "dry-run": true });
    const result = await renderVideo(out, { provider: "local-ffmpeg", duration: "4", fps: "6" });
    const readiness = await validateWorkspace(out);

    const video = JSON.parse(await readFile(path.join(out, "video/video.json"), "utf8"));
    await access(result.video);
    await access(result.thumbnail);
    assert.equal(video.style, "ugc-demo-punchy");
    assert.equal(video.creative_recipe.renderer_contract.adapter, "launchclip.remotion-render.v1");
    assert.match(video.creative_recipe.visual_language.sound_design, /whooshes/);
    assert.equal(video.creative_storyboard.scenes.length, 7);
    assert.match(video.creative_storyboard.quality_gates.join("\n"), /terminal evidence is treated as proof/);
    assert.equal(video.creative_storyboard.scenes[2].layout, "device capture with command evidence");
    assert.match(video.creative_storyboard.scenes[2].camera_direction, /terminal text types/i);
    assert.match(video.creative_storyboard.scenes[5].sound_design, /file flips/i);
    assert.equal(video.script_visual_alignment.length, 7);
    assert.equal(video.voiceover.segments.length, 7);
    assert.equal(video.sound_design.cues.length, 7);
    assert.match(video.sound_design.cues[0].sound, /whoosh/i);
    assert.match(video.voiceover.full_text, /launch Short/);
    assert.equal(video.script_visual_alignment[0].beat, "cold-open");
    assert.equal(video.script_visual_alignment[0].caption, "Repo -> Short");
    assert.match(video.script_visual_alignment[3].visual, /Split-screen/i);
    assert.match(video.script_visual_alignment[5].motion, /file cards flash/i);
    assert.equal(video.script_visual_alignment[6].caption, "Review first");
    assert.match(video.script_visual_alignment[6].visual, /no progress bar/i);
    assert.equal(readiness.status, "ready");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("renders punchy social-ready UGC preview with Remotion", async (t) => {
  if (!(await hasCommand("ffmpeg")) || !(await hasCommand("npx"))) {
    t.skip("ffmpeg or npx is not installed");
    return;
  }
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  try {
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, { out, "demo-cmd": "npm run smoke", capture: "terminal" });
    await planVideo(out, { format: "short-30", renderer: "remotion", style: "ugc-demo-punchy", "talking-head": "heygen" });
    await writeCaptions(out, { platforms: "x,linkedin,tiktok,bluesky" });
    await renderDryRun(out, { provider: "product-videogen", "dry-run": true });
    await submitReview(out, { provider: "product-videogen", "dry-run": true });
    const result = await renderVideo(out, { provider: "remotion", duration: "2", fps: "15" });
    const manifest = JSON.parse(await readFile(path.join(out, "launchclip.json"), "utf8"));
    const props = JSON.parse(await readFile(path.join(out, "video/remotion-props.json"), "utf8"));
    const voiceover = JSON.parse(await readFile(path.join(out, "video/voiceover.json"), "utf8"));

    await access(result.video);
    await access(result.thumbnail);
    await access(path.join(out, "video/voiceover.json"));
    assert.equal(manifest.stages.render.provider, "remotion");
    assert.equal(props.schema_version, "launchclip.remotion-props.v1");
    assert.equal(props.voiceover.schema_version, "launchclip.voiceover.v1");
    assert.equal(props.soundDesign.schema_version, "launchclip.sound-design.v1");
    assert.equal(voiceover.segments[6].beat, "cta");
    assert.equal(props.timeline.length, 7);
    assert.equal(props.storyboard.scenes[3].layout, "editor timeline proof");
    assert.equal(props.fps, 15);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("renders premium product short sample with local manifest assets", async (t) => {
  if (!(await hasCommand("ffmpeg")) || !(await hasCommand("npx"))) {
    t.skip("ffmpeg or npx is not installed");
    return;
  }
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  const assetsDir = path.join(temp, "assets");
  try {
    await writePremiumAssetManifest(assetsDir, {
      "claude-code": "claude-code.png",
      github: "github.png",
      obsidian: "obsidian.png",
      "terminal-demo": "terminal-demo.png",
      "prompt-example": { path: "prompt-example.txt", type: "text", label: "Prompt Example" }
    });
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, { out, "demo-cmd": "npm run smoke", capture: "terminal" });
    await planVideo(out, { format: "short-30", renderer: "remotion", style: "premium-product-short", "assets-dir": assetsDir });
    await writeCaptions(out, { platforms: "x,linkedin,tiktok,bluesky" });
    await renderDryRun(out, { provider: "product-videogen", "dry-run": true });
    await submitReview(out, { provider: "product-videogen", "dry-run": true });
    const result = await renderVideo(out, { provider: "remotion", duration: "6", fps: "15", "assets-dir": assetsDir });

    const manifest = JSON.parse(await readFile(path.join(out, "launchclip.json"), "utf8"));
    const props = JSON.parse(await readFile(path.join(out, "video/remotion-props.json"), "utf8"));
    const readiness = await validateWorkspace(out);
    const stills = [1, 3, 5].map((second) => path.join(out, "video", `premium-still-${second}s.png`));
    for (const [index, still] of stills.entries()) {
      await execFileAsync("ffmpeg", ["-y", "-ss", String([1, 3, 5][index]), "-i", result.video, "-frames:v", "1", still], { maxBuffer: 1024 * 1024 * 8 });
      await access(still);
    }

    await access(result.video);
    await access(result.thumbnail);
    await access(path.join(out, "video/render-public/assets/claude-code.png"));
    await access(path.join(out, "video/render-public/assets/github.png"));
    await access(path.join(out, "video/render-public/assets/obsidian.png"));
    assert.equal(manifest.stages.render.composition, "LaunchclipPremiumShort");
    assert.equal(props.publicAssets.schema_version, "launchclip.assets.v1");
    assert.equal(props.publicAssets.missing_aliases.length, 0);
    assert.equal(Object.keys(props.publicAssets.aliases).length, 5);
    assert.equal(props.timeline.length, 8);
    assert.equal(props.storyboard.scenes[3].type_sequences[0].source_alias, "prompt-example");
    assert.equal(readiness.status, "ready");
    assert.deepEqual(readiness.warnings, []);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("validation catches missing script and visual alignment fields", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  try {
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, { out, "demo-cmd": "npm run smoke", capture: "terminal" });
    await planVideo(out, { format: "short-30", renderer: "product-videogen", style: "ugc-split", "talking-head": "heygen" });
    await writeCaptions(out, { platforms: "x,linkedin,tiktok,bluesky" });
    await renderDryRun(out, { provider: "product-videogen", "dry-run": true });
    await submitReview(out, { provider: "product-videogen", "dry-run": true });

    const videoPath = path.join(out, "video/video.json");
    const video = JSON.parse(await readFile(videoPath, "utf8"));
    delete video.script_visual_alignment[0].visual;
    video.script_visual_alignment[1].beat = "unmapped";
    await writeFile(videoPath, `${JSON.stringify(video, null, 2)}\n`);

    const readiness = await validateWorkspace(out);
    assert.equal(readiness.status, "needs-work");
    assert.match(readiness.issues.join("\n"), /missing visual/);
    assert.match(readiness.issues.join("\n"), /no matching visual structure beat/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("copies optional UI demo media into the packet receipt", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  const screenshot = path.join(temp, "demo.png");
  try {
    await writeFile(screenshot, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwq3GQAAAABJRU5ErkJggg==", "base64"));
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, { out, "demo-cmd": "npm run smoke", capture: "terminal", "demo-media": screenshot });

    const receipt = JSON.parse(await readFile(path.join(out, "demo/command-receipt.json"), "utf8"));

    assert.deepEqual(receipt.artifacts.map((artifact) => artifact.type), ["terminal", "screenshot"]);
    await access(path.join(out, "demo/media.png"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("redacts obvious secrets from demo evidence", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  try {
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, {
      out,
      "demo-cmd": "node -e \"console.log('API_KEY=sk-testsecret1234567890'); console.error('token=ghp_abcdefghijklmnop')\"",
      capture: "terminal"
    });

    const terminal = await readFile(path.join(out, "demo/terminal.txt"), "utf8");
    const receipt = JSON.parse(await readFile(path.join(out, "demo/command-receipt.json"), "utf8"));

    assert.doesNotMatch(terminal, /sk-testsecret/);
    assert.doesNotMatch(terminal, /ghp_abcdefghijklmnop/);
    assert.doesNotMatch(receipt.command, /sk-testsecret/);
    assert.match(terminal, /\[REDACTED_SECRET\]/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("rejects live submit in V1", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  try {
    await initWorkspace(fixtureRepo, { out });
    await assert.rejects(
      submitReview(out, { provider: "product-videogen", submit: true }),
      /Live product-videogen submission is intentionally disabled/
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("hyperframes render provider rejects dry-run mode", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  try {
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, { out, "demo-cmd": "npm run smoke", capture: "terminal" });
    await planVideo(out, { format: "short-30", renderer: "hyperframes", style: "premium-product-short" });

    await assert.rejects(
      renderVideo(out, { provider: "hyperframes", "dry-run": true }),
      /hyperframes renders a real media file/
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("fits local-say voiceover before the video ends", async (t) => {
  if (!(await hasCommand("ffmpeg")) || !(await hasCommand("ffprobe")) || !(await hasCommand("say"))) {
    t.skip("ffmpeg, ffprobe, or say is not installed");
    return;
  }
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  try {
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, { out, "demo-cmd": "npm run smoke", capture: "terminal" });
    await planVideo(out, { format: "short-30", renderer: "local-ffmpeg", style: "ugc-demo-punchy", "talking-head": "heygen" });
    await writeCaptions(out, { platforms: "x,linkedin,tiktok,bluesky" });

    const result = await renderVideo(out, { provider: "local-ffmpeg", duration: "8", fps: "6", voiceover: "local-say" });
    const videoDuration = await mediaDuration(path.join(out, "video/launchclip.mp4"));
    const audioDuration = await mediaDuration(path.join(out, result.voiceoverAudio));

    assert.equal(result.voiceoverAudio, "video/voiceover.aiff");
    assert.ok(audioDuration < videoDuration - 0.2, `expected voiceover ${audioDuration}s to finish before video ${videoDuration}s`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("renders a local uploadable video when ffmpeg is available", async (t) => {
  if (!(await hasCommand("ffmpeg"))) {
    t.skip("ffmpeg is not installed");
    return;
  }
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-test-"));
  const out = path.join(temp, "packet");
  const screenshot = path.join(temp, "demo.png");
  try {
    await writeFile(screenshot, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwq3GQAAAABJRU5ErkJggg==", "base64"));
    await initWorkspace(fixtureRepo, { out });
    await runDemo(fixtureRepo, { out, "demo-cmd": "npm run smoke", capture: "terminal", "demo-media": screenshot });
    await planVideo(out, { format: "short-15", renderer: "local-ffmpeg" });
    await writeCaptions(out, { platforms: "x,linkedin,tiktok,bluesky" });
    await renderDryRun(out, { provider: "product-videogen", "dry-run": true });
    await submitReview(out, { provider: "product-videogen", "dry-run": true });
    const result = await renderVideo(out, { provider: "local-ffmpeg", duration: "6" });
    const readiness = await validateWorkspace(out);

    await access(result.video);
    await access(result.thumbnail);
    assert.equal(readiness.status, "ready");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

async function hasCommand(command) {
  try {
    await execFileAsync("which", [command]);
    return true;
  } catch {
    return false;
  }
}

async function mediaDuration(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    filePath
  ]);
  return Number(stdout.trim());
}

function maxLifecycleGap(states) {
  const timedStates = states
    .map((state) => ({ at: Number(state.at), duration: Number(state.duration ?? 0) }))
    .filter((state) => Number.isFinite(state.at))
    .sort((a, b) => a.at - b.at);
  let maxGap = 0;
  for (let index = 1; index < timedStates.length; index += 1) {
    maxGap = Math.max(maxGap, timedStates[index].at - (timedStates[index - 1].at + Math.max(0, timedStates[index - 1].duration)));
  }
  return Math.round(maxGap * 100) / 100;
}

async function writePremiumAssetManifest(assetsDir, aliases) {
  await mkdir(assetsDir, { recursive: true });
  for (const value of Object.values(aliases)) {
    const assetPath = typeof value === "string" ? value : value.path;
    const target = path.join(assetsDir, assetPath);
    if (assetPath.endsWith(".txt")) {
      await writeFile(target, "Create a premium product short with Claude Code, Obsidian, GitHub, typing, and review-safe proof.\n");
    } else if (assetPath.endsWith(".wav")) {
      await writeFile(target, `RIFF fixture ${assetPath}`);
    } else {
      await writeFile(target, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwq3GQAAAABJRU5ErkJggg==", "base64"));
    }
  }
  await writeFile(path.join(assetsDir, "launchclip-assets.json"), `${JSON.stringify({ schema_version: "launchclip.assets.v1", assets: aliases }, null, 2)}\n`);
}

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assembleHyperFrames, ensureTimelineRegistration, renderRoot } from "../src/hyperframes_assembler.js";
import { ProductionJobStore, semanticHash } from "../src/job_store.js";
import { EVIDENCE_VERSION, FRAME_BUNDLE_VERSION, PRODUCTION_PLAN_VERSION } from "../src/production_contracts.js";

test("renders subcompositions while keeping timed media and SFX as direct root children", () => {
  const { plan, bundles } = fixture("/tmp/screen.mp4");
  const html = renderRoot({
    plan, bundles,
    assetMap: new Map([["screen", { file: "screen.mp4" }], ["sfx-001", { file: "sfx-001.wav" }]]),
    extraAudio: [{ id: "sfx-001", at_seconds: 2.25, duration_seconds: null, source_start_seconds: 0, volume: .3, track: 60 }]
  });
  assert.match(html, /data-composition-src="compositions\/shot-1.html"/);
  assert.match(html, /data-composition-src="compositions\/shot-1\.html" data-start="0" data-duration="4\.999"/);
  assert.match(html, /gsap@3\.14\.2/);
  assert.match(html, /window\.__timelines\["main"\] = gsap\.timeline\(\{ paused: true \}\)/);
  assert.match(html, /<video[^>]+data-start="1"[^>]+data-duration="3"[^>]+data-media-start="4"/);
  assert.match(html, /left:100px;top:200px;width:800px;height:600px/);
  assert.equal((html.match(/<video/g) ?? []).length, 1);
  assert.match(html, /<audio id="sfx-001"[^>]+data-start="2\.25"[^>]+data-volume="0\.3"/);
  assert.ok(html.indexOf("<video") > html.indexOf('data-composition-id="main"'));
});

test("canonicalizes model-authored GSAP timelines into the HyperFrames registry", () => {
  const source = '<html><body><div data-composition-id="shot-1"></div><script>(function(){const timeline = gsap.timeline({defaults:{ease:"power3.out"}});})();</script></body></html>';
  const normalized = ensureTimelineRegistration(source, "shot-1");
  assert.match(normalized, /timeline\.pause\(0\)/);
  assert.match(normalized, /window\.__timelines\["shot-1"\] = timeline/);
  assert.ok(normalized.indexOf('window.__timelines["shot-1"]') < normalized.indexOf("})();"));
  assert.equal(ensureTimelineRegistration(normalized, "shot-1"), normalized);
});

test("freezes assets, rewrites frame paths, assembles a resumable HyperFrames project", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-assembly-"));
  const source = path.join(workspace, "screen.mp4");
  await writeFile(source, "fake-media");
  const context = fixture(source);
  await writeFixture(workspace, context);

  const first = await assembleHyperFrames(workspace);
  const root = await readFile(first.index, "utf8");
  const frame = await readFile(path.join(first.project, "compositions", "shot-1.html"), "utf8");
  assert.equal(first.cached, false);
  assert.match(root, /src="assets\/screen\.mp4"/);
  assert.match(frame, /src="\.\.\/assets\/screen\.mp4"/);
  assert.doesNotMatch(frame, new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual((JSON.parse(await readFile(first.manifest, "utf8"))).shots.map((entry) => entry.id), ["shot-1"]);

  const second = await assembleHyperFrames(workspace);
  assert.equal(second.cached, true);
});

test("refuses remote or missing media requested by a delegated frame", () => {
  const { plan, bundles } = fixture("https://example.com/screen.mp4");
  assert.throws(() => renderRoot({ plan, bundles, assetMap: new Map() }), /unavailable local media/);
});

function fixture(source) {
  const intake = {
    source: { kind: "product" },
    resources: [{ id: "screen", role: "supporting", type: "video", location: source, is_remote: /^https:/.test(source), sha256: "screen-hash" }]
  };
  const evidence = { schema_version: EVIDENCE_VERSION, items: [{ id: "ev-1" }] };
  const shot = { id: "shot-1", start_seconds: 0, end_seconds: 5 };
  const plan = { schema_version: PRODUCTION_PLAN_VERSION, format: { aspect: "9:16", width: 1080, height: 1920, duration_seconds: 5, language: "en" }, shots: [shot] };
  const bundle = {
    schema_version: FRAME_BUNDLE_VERSION, shot_id: "shot-1",
    html: `<!doctype html><html><body><div data-composition-id="shot-1" data-start="0" data-duration="5" data-width="1080" data-height="1920"><img src="${source}"></div></body></html>`,
    motion: { assertions: [] },
    root_media_requests: [{
      resource_id: "screen", kind: "video", start_seconds: 1, end_seconds: 4,
      source_start_seconds: 4, source_end_seconds: 7, volume: 0,
      placement: { x: 100, y: 200, width: 800, height: 600, object_fit: "cover", border_radius: 24, z_index: 2, treatment: "screen proof" }
    }],
    evidence_ids: ["ev-1"], visible_copy: [], preserve: []
  };
  return { intake, evidence, plan, bundles: [bundle] };
}

async function writeFixture(workspace, context) {
  const production = path.join(workspace, "production");
  await mkdir(path.join(production, "frames"), { recursive: true });
  await writeFile(path.join(production, "intake.json"), `${JSON.stringify(context.intake)}\n`);
  await writeFile(path.join(production, "evidence.json"), `${JSON.stringify(context.evidence)}\n`);
  await writeFile(path.join(production, "plan.json"), `${JSON.stringify(context.plan)}\n`);
  await writeFile(path.join(production, "frames", "shot-1.json"), `${JSON.stringify(context.bundles[0])}\n`);
  const store = await ProductionJobStore.open(workspace);
  await store.add({ id: "creative-plan", kind: "creative-plan", depends_on: [], input_hash: semanticHash(context.plan) });
  await store.markRunning("creative-plan");
  await store.markSucceeded("creative-plan");
  await store.add({ id: "frame:shot-1", kind: "frame", depends_on: ["creative-plan"], input_hash: semanticHash(context.bundles[0]) });
  await store.markRunning("frame:shot-1");
  await store.markSucceeded("frame:shot-1");
}

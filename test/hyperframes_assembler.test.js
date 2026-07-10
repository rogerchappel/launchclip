import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyFrameCsp, assembleHyperFrames, ensureTimelineRegistration, renderRoot, rootMotionSpec, toHyperFramesMotionSpec } from "../src/hyperframes_assembler.js";
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
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /window\.__timelines\["main"\] = gsap\.timeline\(\{ paused: true \}\)/);
  assert.match(html, /<video[^>]+data-start="1"[^>]+data-duration="3"[^>]+data-media-start="4"/);
  assert.match(html, /<video[^>]+ muted playsinline>/);
  assert.match(html, /left:100px;top:200px;width:800px;height:600px/);
  assert.equal((html.match(/<video/g) ?? []).length, 1);
  assert.match(html, /<audio id="sfx-001"[^>]+data-start="2\.25"[^>]+data-volume="0\.3"/);
  assert.ok(html.indexOf("<video") > html.indexOf('data-composition-id="main"'));
});

test("moves presenter video between beat-specific avatar layouts at the host root", () => {
  const request = (x, y, width, height, sourceStart) => ({
    resource_id: "presenter", kind: "video", start_seconds: 0, end_seconds: 3,
    source_start_seconds: sourceStart, source_end_seconds: sourceStart + 3, volume: 0,
    placement: { x, y, width, height, object_fit: "cover", border_radius: 28, z_index: 8, treatment: "avatar cutout" }
  });
  const plan = { format: { language: "en", width: 1080, height: 1920, duration_seconds: 6 }, shots: [
    { id: "shot-1", start_seconds: 0, end_seconds: 3 },
    { id: "shot-2", start_seconds: 3, end_seconds: 6 }
  ] };
  const bundles = [
    { shot_id: "shot-1", root_media_requests: [request(80, 1120, 920, 720, 0)] },
    { shot_id: "shot-2", root_media_requests: [request(620, 120, 380, 600, 3)] }
  ];
  const html = renderRoot({ plan, bundles, assetMap: new Map([["presenter", { file: "presenter.mp4" }]]) });
  assert.match(html, /id="shot-1-media-1"[^>]+data-start="0"[^>]+left:80px;top:1120px;width:920px;height:720px/);
  assert.match(html, /id="shot-2-media-1"[^>]+data-start="3"[^>]+data-media-start="3"[^>]+left:620px;top:120px;width:380px;height:600px/);
});

test("applies a restrictive CSP to model-authored frame documents", () => {
  const html = applyFrameCsp(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *"><title>Shot</title></head><body><template><meta content="default-src https:" http-equiv='content-security-policy'><div></div></template></body></html>`);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /default-src \*|default-src https:/);
  assert.equal((applyFrameCsp(html).match(/Content-Security-Policy/g) ?? []).length, 1);
});

test("canonicalizes model-authored GSAP timelines into the HyperFrames registry", () => {
  const source = '<html><body><div data-composition-id="shot-1"></div><script>(function(){const timeline = gsap.timeline({defaults:{ease:"power3.out"}});})();</script></body></html>';
  const normalized = ensureTimelineRegistration(source, "shot-1");
  assert.match(normalized, /timeline\.pause\(0\)/);
  assert.match(normalized, /window\.__timelines\["shot-1"\] = timeline/);
  assert.ok(normalized.indexOf('window.__timelines["shot-1"]') < normalized.indexOf("})();"));
  assert.equal(ensureTimelineRegistration(normalized, "shot-1"), normalized);
});

test("translates model motion intent into discoverable HyperFrames assertions", () => {
  const bundle = { motion: { assertions: [
    { selector: "#headline", appears_by_seconds: .5, order: 1, must_stay_in_frame: true, must_remain_live: false },
    { selector: "#proof", appears_by_seconds: 1.5, order: 2, must_stay_in_frame: true, must_remain_live: true }
  ] } };
  const local = toHyperFramesMotionSpec(bundle, 4);
  assert.ok(local.assertions.some((entry) => entry.kind === "appearsBy" && entry.bySec === .5));
  assert.ok(local.assertions.some((entry) => entry.kind === "before" && entry.a === "#headline" && entry.b === "#proof"));
  assert.ok(local.assertions.some((entry) => entry.kind === "keepsMoving" && entry.withinSelector === "#proof"));
  const root = rootMotionSpec({ format: { duration_seconds: 6 }, shots: [{ id: "shot-1", start_seconds: 2, end_seconds: 6 }] }, [bundle]);
  assert.ok(root.assertions.some((entry) => entry.kind === "appearsBy" && entry.selector === "#mount-shot-1"));
  assert.ok(root.assertions.every((entry) => !["#headline", "#proof"].includes(entry.selector ?? entry.withinSelector)));
  assert.ok(root.assertions.every((entry) => entry.kind !== "keepsMoving"));
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
  assert.match(frame, /src="assets\/screen\.mp4"/);
  assert.match(frame, /default-src 'none'/);
  assert.match(frame, /<template>[\s\S]*<style>[\s\S]*#root/);
  assert.match(frame, /window\.__timelines\["shot-1"\]/);
  assert.doesNotMatch(frame, new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual((JSON.parse(await readFile(first.manifest, "utf8"))).shots.map((entry) => entry.id), ["shot-1"]);
  const rootMotion = JSON.parse(await readFile(path.join(first.project, "index.motion.json"), "utf8"));
  assert.equal(rootMotion.version, 1);
  const frameMotion = JSON.parse(await readFile(path.join(first.project, "compositions", "shot-1.motion.json"), "utf8"));
  assert.equal(frameMotion.duration, 5);

  const second = await assembleHyperFrames(workspace);
  assert.equal(second.cached, true);

  const frozenAsset = path.join(first.project, "assets", "screen.mp4");
  await writeFile(frozenAsset, "tampered");
  const rebuilt = await assembleHyperFrames(workspace);
  assert.equal(rebuilt.cached, false);
  assert.equal((await readFile(frozenAsset, "utf8")), "fake-media");
  const protectedOutputs = (await ProductionJobStore.open(workspace, { create: false })).get("hyperframes-assembly").outputs.map((entry) => entry.path);
  assert.ok(protectedOutputs.some((entry) => entry.endsWith("assets/screen.mp4")));
  assert.ok(protectedOutputs.some((entry) => entry.endsWith("compositions/shot-1.motion.json")));

});

test("recovers an interrupted HyperFrames assembly", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-assembly-recovery-"));
  const source = path.join(workspace, "screen.mp4");
  await writeFile(source, "fake-media");
  await writeFixture(workspace, fixture(source));
  await assembleHyperFrames(workspace);
  const interrupted = await ProductionJobStore.open(workspace, { create: false });
  await interrupted.markStaleFrom(["hyperframes-assembly"]);
  await interrupted.retry("hyperframes-assembly");
  await interrupted.markRunning("hyperframes-assembly");
  const recovered = await assembleHyperFrames(workspace);
  assert.equal(recovered.cached, false);
  assert.equal((await ProductionJobStore.open(workspace, { create: false })).get("hyperframes-assembly").status, "succeeded");
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
  const shot = { id: "shot-1", start_seconds: 0, end_seconds: 5, resource_ids: ["screen"] };
  const plan = { schema_version: PRODUCTION_PLAN_VERSION, format: { aspect: "9:16", width: 1080, height: 1920, duration_seconds: 5, language: "en" }, shots: [shot] };
  const bundle = {
    schema_version: FRAME_BUNDLE_VERSION, shot_id: "shot-1",
    html: `<!doctype html><html><head></head><body><template><style>#root{position:absolute;inset:0}</style><div id="root" data-composition-id="shot-1" data-start="0" data-duration="5" data-width="1080" data-height="1920"><img id="shot-1-proof" src="${source}"></div><script>window.__timelines=window.__timelines||{};const timeline=gsap.timeline({paused:true});window.__timelines["shot-1"]=timeline;</script></template></body></html>`,
    motion: { assertions: [{ selector: "#shot-1-proof", appears_by_seconds: 1, order: 1, must_stay_in_frame: true, must_remain_live: false }] },
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

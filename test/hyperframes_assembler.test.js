import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeFrameArtifacts } from "../src/frame_director.js";
import { applyFrameCsp, assembleHyperFrames, buildShotTransitions, ensureTimelineRegistration, renderRoot, rootMotionSpec, toHyperFramesMotionSpec } from "../src/hyperframes_assembler.js";
import { ensureTextContainment } from "../src/hyperframes_text.js";
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
  assert.match(html, /\.shot-mount \{[^}]+will-change: transform, opacity, filter/);
  assert.match(html, /const timeline = gsap\.timeline\(\{ paused: true \}\)/);
  assert.match(html, /window\.__timelines\["main"\] = timeline/);
  assert.match(html, /<video[^>]+data-start="1"[^>]+data-duration="3"[^>]+data-media-start="4"/);
  assert.match(html, /<video[^>]+data-track-index="10"/);
  assert.match(html, /<video[^>]+ muted playsinline>/);
  assert.match(html, /root-media-frame \{[^}]+border: 3px solid #20231F/);
  assert.match(html, /root-media-window-bar \{[^}]+background: #F4F0E8F2/);
  assert.match(html, /left:100px;top:200px;width:800px;height:600px/);
  assert.equal((html.match(/<video/g) ?? []).length, 1);
  assert.match(html, /<audio id="sfx-001"[^>]+data-start="2\.25"[^>]+data-volume="0\.3"/);
  assert.ok(html.indexOf("<video") > html.indexOf('data-composition-id="main"'));
  bundles[0].root_media_requests[0].volume = .65;
  const audible = renderRoot({ plan, bundles, assetMap: new Map([["screen", { file: "screen.mp4" }]]) });
  assert.match(audible, /<video[^>]+data-volume="0"[^>]+ muted playsinline>/);
  assert.doesNotMatch(audible, /data-has-audio="true"/);
});

test("moves presenter video between beat-specific avatar layouts at the host root", () => {
  const request = (x, y, width, height, sourceStart) => ({
    resource_id: "presenter", kind: "video", start_seconds: 0, end_seconds: 3,
    source_start_seconds: sourceStart, source_end_seconds: sourceStart + 3, volume: 0,
    presentation: { mode: "companion", frame: "desktop-window", enter: "slide-up", exit: "slide-down", motion_blur_px: 16 },
    placement: { x, y, width, height, object_fit: "cover", border_radius: 28, z_index: 8, treatment: "avatar cutout" }
  });
  const plan = { format: { language: "en", width: 1080, height: 1920, duration_seconds: 6 }, design: { style_dna: { colors: { background: "#F4F0E8" } } }, shots: [
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
  assert.match(html, /id="shot-1-media-1"[^>]+data-track-index="10"/);
  assert.match(html, /id="shot-2-media-1"[^>]+data-track-index="11"/);
  assert.match(html, /id="shot-1-media-1"[^>]+z-index:210[^>]+data-layer-role="presenter"/);
  assert.match(html, /id="shot-1-media-1-frame"[^>]+data-layer-role="presenter-chrome"[^>]+z-index:211/);
  assert.match(html, /id="mount-shot-2"[^>]+style="z-index:101"/);
  assert.match(html, /id="shot-1-media-1-frame"[^>]+root-media-frame/);
  assert.match(html, /root-media-window-dot--close/);
  assert.match(html, /timeline\.fromTo\("#shot-1-media-1,#shot-1-media-1-frame"/);
  assert.match(html, /"filter":"blur\(16px\)"/);
  assert.match(html, /data-composition-src="compositions\/shot-1\.html" data-start="0" data-duration="3\.33"/);
  assert.match(html, /timeline\.to\("#mount-shot-1"/);
  assert.match(html, /timeline\.fromTo\("#mount-shot-2"/);
  assert.match(html, /"opacity":0\.92,"x":-173,"y":0/);
  assert.match(html, /"opacity":0\.9,"x":173,"y":0/);
  assert.match(html, /ease:"power4\.in"/);
  assert.match(html, /"ease":"expo\.out"/);
  assert.match(html, /#launchclip-root \{[^}]+background: #F4F0E8/);
});

test("preserves explicit cuts and compiles directional transition physics", () => {
  const plan = { format: { width: 1080, height: 1920, duration_seconds: 9 }, shots: [
    { id: "one", start_seconds: 0, end_seconds: 3, transition_out: "velocity push", visual: { continuity: { camera_direction: "down", motion_blur_px: 18 } } },
    { id: "two", start_seconds: 3, end_seconds: 6, transition_out: "hard cut", visual: { continuity: { camera_direction: "down", motion_blur_px: 18 } } },
    { id: "three", start_seconds: 6, end_seconds: 9, visual: { continuity: { camera_direction: "right" } } }
  ] };
  assert.deepEqual(buildShotTransitions(plan).map((entry) => ({ kind: entry.kind, axis: entry.axis, duration: entry.duration_seconds, distance: entry.distance_pixels, exit: entry.exit_ease, entry: entry.entry_ease })), [
    { kind: "push", axis: "y", duration: .33, distance: 307, exit: "power4.in", entry: "expo.out" },
    { kind: "cut", axis: "x", duration: 0, distance: 0, exit: "none", entry: "none" }
  ]);
});

test("compiles stable continuity as slower full-canvas travel with velocity-shaped blur", () => {
  const presenter = { mode: "companion", visible: true, placement: "top-right", size: "small" };
  const continuity = (handoff) => ({
    sequence_id: "shared-proof-world", handoff,
    inherits_object_ids: ["proof-node"], hands_off_object_ids: ["proof-node"],
    camera_direction: "rightward", entry_velocity: 360, exit_velocity: 360, motion_blur_px: 14
  });
  const plan = { format: { language: "en", width: 1920, height: 1080, duration_seconds: 10 }, design: { style_dna: { colors: { background: "#000" } } }, shots: [
    { id: "one", start_seconds: 0, end_seconds: 5, transition_out: "semantic match across the same workspace", presenter, visual: { continuity: continuity("continue") } },
    { id: "two", start_seconds: 5, end_seconds: 10, presenter: { ...presenter }, visual: { continuity: continuity("resolve") } }
  ] };
  const transitions = buildShotTransitions(plan);
  assert.deepEqual(transitions.map((entry) => ({ kind: entry.kind, duration: entry.duration_seconds, distance: entry.distance_pixels, blur: entry.motion_blur_px, exit: entry.exit_ease, entry: entry.entry_ease })), [
    { kind: "shared-world", duration: 1.2, distance: 1920, blur: 24.5, exit: "power3.inOut", entry: "power3.inOut" }
  ]);
  const bundles = plan.shots.map((shot) => ({ shot_id: shot.id, root_media_requests: [] }));
  const rendered = renderRoot({ plan, bundles, assetMap: new Map(), transitions });
  assert.match(rendered, /data-composition-src="compositions\/one\.html" data-start="0" data-duration="6\.2"/);
  assert.match(rendered, /"opacity":1,"x":-1920,"y":0,"scale":1/);
  assert.match(rendered, /"opacity":1,"x":1920,"y":0,"scale":1,"filter":"blur\(0px\)"/);
  assert.match(rendered, /"filter":"blur\(24\.5px\)",duration:0\.6,ease:"power2\.in"/);
  assert.match(rendered, /"filter":"blur\(0px\)",duration:0\.6,ease:"power2\.out"/);
  assert.match(rendered, /"ease":"power3\.inOut","immediateRender":false/);
  assert.ok(rootMotionSpec(plan, bundles, transitions).assertions.every((entry) => entry.kind !== "staysInFrame"));

  const changedAnchor = structuredClone(plan);
  changedAnchor.shots[1].presenter.placement = "bottom-right";
  assert.equal(buildShotTransitions(changedAnchor)[0].kind, "push");
});

test("retains materially different zoom, morph, aperture, and whip handoffs", () => {
  const plan = { format: { width: 1080, height: 1920, duration_seconds: 18 }, shots: [
    { id: "one", start_seconds: 0, end_seconds: 3, transition_out: "Camera whips left into the next beat" },
    { id: "two", start_seconds: 3, end_seconds: 6, transition_out: "Camera zooms through the memory tunnel" },
    { id: "three", start_seconds: 6, end_seconds: 9, transition_out: "The panel folds and becomes the next machine" },
    { id: "four", start_seconds: 9, end_seconds: 12, transition_out: "A shipping-door aperture reveals the result" },
    { id: "five", start_seconds: 12, end_seconds: 15, transition_out: "hard cut" },
    { id: "six", start_seconds: 15, end_seconds: 18 }
  ] };
  assert.deepEqual(buildShotTransitions(plan).map((entry) => entry.kind), ["whip", "zoom", "morph", "aperture", "cut"]);
  const rendered = renderRoot({ plan: { ...plan, format: { ...plan.format, language: "en" }, design: { style_dna: { colors: { background: "#000" } } } }, bundles: plan.shots.map((shot) => ({ shot_id: shot.id, root_media_requests: [] })), assetMap: new Map() });
  assert.match(rendered, /clipPath":"circle\(0% at 50% 50%\)"/);
  assert.match(rendered, /clipPath":"circle\(150% at 50% 50%\)"/);
  assert.match(rendered, /clipPath":"inset\(11% 8% round 54px\)"/);
  assert.match(rendered, /ease:"expo\.in"/);
  assert.match(rendered, /"ease":"circ\.out"/);
});

test("applies a restrictive CSP to model-authored frame documents", () => {
  const html = applyFrameCsp(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *"><title>Shot</title></head><body><template><meta content="default-src https:" http-equiv='content-security-policy'><div></div></template></body></html>`);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /default-src \*|default-src https:/);
  assert.equal((applyFrameCsp(html).match(/Content-Security-Policy/g) ?? []).length, 1);
});

test("injects deterministic text containment into subcompositions", () => {
  const source = '<html><body><template><div id="root" data-composition-id="shot-1"><div class="label">A LONG LABEL</div></div><script>window.__timelines={};</script></template></body></html>';
  const contained = ensureTextContainment(source, "shot-1");
  assert.match(contained, /data-launchclip-text-containment="v2"/);
  assert.match(contained, /dataset\.launchclipFitText/);
  assert.match(contained, /dataset\.launchclipTextUnresolved/);
  assert.match(contained, /data-launchclip-max-lines/);
  assert.match(contained, /data-launchclip-safe-padding/);
  assert.match(contained, /text-collision/);
  assert.match(contained, /console\.error\('\[LaunchClip text containment\]/);
  assert.ok(contained.indexOf('data-launchclip-text-containment="v2"') < contained.indexOf("</template>"));
  assert.equal(ensureTextContainment(contained, "shot-1"), contained);

  const upgraded = ensureTextContainment(contained.replaceAll('v2', 'v1'), "shot-1");
  assert.equal((upgraded.match(/data-launchclip-text-containment=/g) ?? []).length, 1);
  assert.match(upgraded, /data-launchclip-text-containment="v2"/);
});

test("canonicalizes model-authored GSAP timelines into the HyperFrames registry", () => {
  const source = '<html><body><div data-composition-id="shot-1"></div><script>(function(){const timeline = gsap.timeline({defaults:{ease:"power3.out"}});})();</script></body></html>';
  const normalized = ensureTimelineRegistration(source, "shot-1");
  assert.match(normalized, /timeline\.pause\(0\)/);
  assert.match(normalized, /window\.__timelines\["shot-1"\] = timeline/);
  assert.ok(normalized.indexOf('window.__timelines["shot-1"]') < normalized.indexOf("})();"));
  assert.equal(ensureTimelineRegistration(normalized, "shot-1"), normalized);

  const aliased = '<html><body><template><div data-composition-id="shot-1"></div><script>const shot_id="shot-1";const timeline=gsap.timeline({paused:true});window.__timelines=window.__timelines||{};window.__timelines[shot_id]=timeline;</script></template></body></html>';
  assert.equal(ensureTimelineRegistration(aliased, "shot-1"), aliased);
  assert.equal((ensureTimelineRegistration(aliased, "shot-1").match(/<script>/g) ?? []).length, 1);

  const legacyDuplicate = aliased.replace("</template>", '<script>window.__timelines = window.__timelines || {};\ntimeline.pause(0);\nwindow.__timelines["shot-1"] = timeline;</script>\n</template>');
  const cleaned = ensureTimelineRegistration(legacyDuplicate, "shot-1");
  assert.equal((cleaned.match(/<script>/g) ?? []).length, 1);
  assert.doesNotMatch(cleaned, /timeline\.pause\(0\)/);

  const topLevel = '<html><body><template><div data-composition-id="shot-1"></div><script>const timeline=gsap.timeline({paused:true});</script></template></body></html>';
  const repairedTopLevel = ensureTimelineRegistration(topLevel, "shot-1");
  assert.equal((repairedTopLevel.match(/<script>/g) ?? []).length, 1);
  assert.ok(repairedTopLevel.indexOf('window.__timelines["shot-1"]') < repairedTopLevel.indexOf("</script>"));
});

test("translates model motion intent into discoverable HyperFrames assertions", () => {
  const bundle = { motion: { assertions: [
    { selector: "#headline", appears_by_seconds: .5, order: 1, must_stay_in_frame: true, must_remain_live: false },
    { selector: "#proof", appears_by_seconds: 1.5, order: 2, must_stay_in_frame: true, must_remain_live: true }
  ], events: [{ event_id: "shot-1-proof-lock", object_id: "proof-node", selector: "#proof", at_seconds: 1.5, property: "transform", visible_change: true }] } };
  const local = toHyperFramesMotionSpec(bundle, 4);
  assert.equal(local.version, 1);
  assert.equal(local.events[0].event_id, "shot-1-proof-lock");
  assert.ok(local.assertions.some((entry) => entry.kind === "appearsBy" && entry.bySec === .5));
  assert.ok(local.assertions.some((entry) => entry.kind === "before" && entry.a === "#headline" && entry.b === "#proof"));
  assert.ok(local.assertions.some((entry) => entry.kind === "keepsMoving" && entry.withinSelector === "#proof"));
  const root = rootMotionSpec({ format: { duration_seconds: 6 }, shots: [{ id: "shot-1", start_seconds: 2, end_seconds: 6 }] }, [bundle]);
  assert.ok(root.assertions.some((entry) => entry.kind === "appearsBy" && entry.selector === "#mount-shot-1"));
  assert.equal(root.assertions.find((entry) => entry.kind === "appearsBy").bySec, 2.3);
  assert.ok(root.assertions.every((entry) => !["#headline", "#proof"].includes(entry.selector ?? entry.withinSelector)));
  assert.ok(root.assertions.every((entry) => entry.kind !== "keepsMoving"));
  const longRoot = rootMotionSpec({ format: { duration_seconds: 90 }, shots: [{ id: "long-shot", start_seconds: 45, end_seconds: 90 }] }, [bundle]);
  assert.equal(longRoot.assertions.find((entry) => entry.kind === "appearsBy").bySec, 45.5);
  const shortRoot = rootMotionSpec({ format: { duration_seconds: .1 }, shots: [{ id: "short-shot", start_seconds: 0, end_seconds: .1 }] }, [bundle]);
  assert.equal(shortRoot.assertions.find((entry) => entry.kind === "appearsBy").bySec, .05);
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
  assert.equal(frameMotion.version, 1);
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

test("freezes unsupported planned Google fonts into local assembly assets", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-assembly-fonts-"));
  const source = path.join(workspace, "screen.mp4");
  await writeFile(source, "fake-media");
  const context = fixture(source);
  context.plan.design.style_dna.typography = {
    display: "Space Grotesk 700, tightly tracked",
    body: "Inter 500/600 with short labels",
    metadata: "IBM Plex Mono 500 for commands"
  };
  context.bundles[0].html = context.bundles[0].html.replace("#root{", '#root{font-family:"Space Grotesk";');
  await writeFixture(workspace, context);
  const requests = [];
  let cssUserAgent;
  const fetch = async (url, init = {}) => {
    requests.push(String(url));
    if (String(url).startsWith("https://fonts.googleapis.com/")) {
      cssUserAgent = init.headers["User-Agent"];
      return {
      ok: true,
      text: async () => '@font-face{font-family:"Space Grotesk";font-style:normal;font-weight:700;src:url(https://fonts.gstatic.com/s/spacegrotesk/v1/latin.woff2) format("woff2");unicode-range:U+0000-00FF;}'
      };
    }
    return { ok: true, arrayBuffer: async () => Buffer.from("frozen-space-grotesk") };
  };

  const result = await assembleHyperFrames(workspace, { fetch });
  const frame = await readFile(path.join(result.project, "compositions", "shot-1.html"), "utf8");
  assert.match(frame, /@font-face[\s\S]*font-family: "Space Grotesk"/);
  assert.match(frame, /src: url\("assets\/font-space-grotesk-700-normal-[a-f0-9]{12}\.woff2"\)/);
  const manifest = JSON.parse(await readFile(result.manifest, "utf8"));
  const font = manifest.assets.find((entry) => entry.id === "font:space-grotesk:1");
  assert.ok(font);
  assert.equal(await readFile(path.join(result.project, font.file), "utf8"), "frozen-space-grotesk");
  assert.match(cssUserAgent, /AppleWebKit\/537\.36[\s\S]*Chrome\/131/);
  assert.equal(requests.length, 2);

  const cached = await assembleHyperFrames(workspace, { fetch });
  assert.equal(cached.cached, true);
  assert.equal(requests.length, 2);
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

test("assembles a separately stored fallback without overwriting its canonical frame", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-assembly-fallback-"));
  const source = path.join(workspace, "screen.mp4");
  await writeFile(source, "fake-media");
  const context = fixture(source);
  await writeFixture(workspace, context);
  const canonicalPath = path.join(workspace, "production", "frames", "shot-1.json");
  const canonical = await readFile(canonicalPath, "utf8");
  const fallback = structuredClone(context.bundles[0]);
  fallback.html = fallback.html.replace("<img", '<div id="shot-1-fallback-proof">Fallback proof</div><img');
  await writeFrameArtifacts(workspace, fallback, { fallback: true, source: "verification", reason: "native inspection failed" });

  const result = await assembleHyperFrames(workspace);
  const manifest = JSON.parse(await readFile(result.manifest, "utf8"));
  assert.equal(result.fallback_count, 1);
  assert.equal(result.full_fallback, true);
  assert.equal(manifest.fallback_count, 1);
  assert.equal(manifest.full_fallback, true);
  assert.equal(manifest.fallbacks[0].source, "verification");
  assert.match(await readFile(result.index, "utf8"), /FALLBACK DRAFT • 1\/1 SHOTS/);
  assert.match(await readFile(path.join(result.project, "compositions", "shot-1.html"), "utf8"), /Fallback proof/);
  assert.equal(await readFile(canonicalPath, "utf8"), canonical);
});

test("reconfigures assembly dependencies when a repaired plan replaces shot ids", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-assembly-replan-"));
  const source = path.join(workspace, "screen.mp4");
  await writeFile(source, "fake-media");
  const context = fixture(source);
  await writeFixture(workspace, context);
  await assembleHyperFrames(workspace);

  const replacement = structuredClone(context.bundles[0]);
  replacement.shot_id = "shot-2";
  replacement.html = replacement.html.replaceAll("shot-1", "shot-2");
  replacement.motion.assertions[0].selector = "#shot-2-proof";
  replacement.motion.events[0].event_id = "shot-2-reveal";
  replacement.motion.events[0].selector = "#shot-2-proof";
  const revisedPlan = { ...context.plan, shots: [{ ...context.plan.shots[0], id: "shot-2", visual: { ...context.plan.shots[0].visual, events: [{ ...context.plan.shots[0].visual.events[0], id: "shot-2-reveal" }] } }] };
  await writeFile(path.join(workspace, "production", "plan.json"), `${JSON.stringify(revisedPlan)}\n`);
  await writeFile(path.join(workspace, "production", "frames", "shot-2.json"), `${JSON.stringify(replacement)}\n`);
  const store = await ProductionJobStore.open(workspace, { create: false });
  await store.add({ id: "frame:shot-2", kind: "frame", depends_on: ["creative-plan"], input_hash: semanticHash(replacement) });
  await store.markRunning("frame:shot-2");
  await store.markSucceeded("frame:shot-2");
  await store.markStaleFrom(["hyperframes-assembly"]);

  const result = await assembleHyperFrames(workspace);
  assert.equal(result.cached, false);
  const reopened = await ProductionJobStore.open(workspace, { create: false });
  assert.deepEqual(reopened.get("hyperframes-assembly").depends_on, ["frame:shot-2"]);
  assert.deepEqual((JSON.parse(await readFile(result.manifest, "utf8"))).shots.map((shot) => shot.id), ["shot-2"]);
  await assert.rejects(() => access(path.join(result.project, "compositions", "shot-1.html")), { code: "ENOENT" });
  await assert.rejects(() => access(path.join(result.project, "compositions", "shot-1.motion.json")), { code: "ENOENT" });
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
  const shot = {
    id: "shot-1", start_seconds: 0, end_seconds: 5, resource_ids: ["screen"],
    visual: {
      objects: [{ id: "proof-node", kind: "diagram-node" }],
      events: [{ id: "shot-1-reveal", at_seconds: 1, target_ids: ["proof-node"], sfx_eligible: false }]
    }
  };
  const plan = {
    schema_version: PRODUCTION_PLAN_VERSION,
    format: { aspect: "9:16", width: 1080, height: 1920, duration_seconds: 5, language: "en" },
    design: { style_dna: { colors: { background: "#F4F0E8", foreground: "#20231F", accent: "#E58B72" }, shape_language: "soft rounded windows", presenter_frame: "warm outlined window" } },
    shots: [shot]
  };
  const bundle = {
    schema_version: FRAME_BUNDLE_VERSION, shot_id: "shot-1",
    html: `<!doctype html><html><head></head><body><template><style>#root{position:absolute;inset:0}</style><div id="root" data-composition-id="shot-1" data-start="0" data-duration="5" data-width="1080" data-height="1920"><img id="shot-1-proof" src="${source}"></div><script>window.__timelines=window.__timelines||{};const timeline=gsap.timeline({paused:true});window.__timelines["shot-1"]=timeline;</script></template></body></html>`,
    motion: {
      assertions: [{ selector: "#shot-1-proof", appears_by_seconds: 1, order: 1, must_stay_in_frame: true, must_remain_live: false }],
      events: [{ event_id: "shot-1-reveal", object_id: "proof-node", selector: "#shot-1-proof", at_seconds: 1, property: "opacity", visible_change: true }]
    },
    root_media_requests: [{
      resource_id: "screen", kind: "video", start_seconds: 1, end_seconds: 4,
      source_start_seconds: 4, source_end_seconds: 7, volume: 0,
      presentation: { mode: "companion", frame: "none", enter: "cut", exit: "cut", motion_blur_px: 0 },
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

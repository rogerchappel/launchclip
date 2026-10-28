// The brand frame (kit/core/brand-frame.mjs, docs/VIDEO_QUALITY_RFC.md §9.2):
// the plan both renderers draw, its safe area for modules, the compilers'
// wiring and the layout-check warning. Rendered parity is in
// test/fixtures/parity-footage/f-frame-*.json (LAUNCHCLIP_PARITY=1).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { brandFrameLayout, brandFramePlan, brandFrameRuntime, brandFrameSafe, frameLabels, frameSources, frameWindows, intersectRects, storyFrame } from "@launchclip/core/brand-frame.mjs";
import { captionStateAt, indexCaptionTweens } from "@launchclip/core/captions.mjs";
import { profileGeometry } from "@launchclip/core/layout-check.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { resolveStory } from "@launchclip/core/story.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";
import { brandFrameFindings } from "../src/layout_check.js";

const require = createRequire(import.meta.url);
const { gsap } = require("gsap");
const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples", "story", "minimal");

const story = (frame, overrides = {}) => ({
  title: "Inside Ship Mode",
  format: { width: 1920, height: 1080, duration: 12 },
  resolved: { duration: 12, fps: 30 },
  brand: { colors: { bg: "#101010", paper: "#fafafa", primary: "#ffcc00", accent: "#33ccff" }, fonts: {} },
  scenes: [{ id: "a", start: 0, end: 4 }, { id: "b", start: 4, end: 8 }, { id: "c", start: 9, end: 12 }],
  frame,
  ...overrides
});

test("storyFrame: defaults, the short title as kicker, and off switches", () => {
  assert.equal(storyFrame(story(undefined)), null);
  assert.equal(storyFrame(story(false)), null);
  assert.equal(storyFrame(story({ enabled: false })), null);
  const frame = storyFrame(story({}));
  assert.equal(frame.kicker.label, "Inside Ship Mode", "a short title becomes the kicker");
  assert.equal(frame.kicker.position, "top-left");
  assert.equal(frame.sections.position, "top-right");
  assert.equal(frame.progress, null, "no progress line unless asked");
  assert.equal(storyFrame(story({}, { title: "A very long story title that will not fit in a kicker" })).kicker, null, "a long title is not a kicker");
  assert.equal(storyFrame(story({ kicker: { position: "top-right" } })).sections.position, "top-left", "labels take the other corner");
  assert.equal(storyFrame(story({ kicker: false, progress: true })).kicker, null);
});

test("section labels and show windows follow the story's scenes", () => {
  const frame = { labels: [{ scene: "b", label: "How" }, { start: 0, label: "Why" }, { scene: "missing", label: "Gone" }] };
  assert.deepEqual(frameLabels(story(frame)), [{ start: 0, label: "Why", end: 4 }, { start: 4, label: "How", end: 12 }]);
  assert.deepEqual(frameLabels(story({ ...frame, sections: false })), []);
  assert.deepEqual(frameWindows(story({})), [[0, 12]]);
  assert.deepEqual(frameWindows(story({ show: "scenes" })), [[0, 8], [9, 12]]);
});

test("the safe area leaves the kicker band and the progress line, inside the profile safe zone", () => {
  for (const format of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
    const zone = profileGeometry(format).safeZone;
    const s = story({ progress: true, labels: [{ start: 0, label: "Why" }] }, { format: { ...format, duration: 12 } });
    const layout = brandFrameLayout(s, format);
    const safe = brandFrameSafe(s, format);
    assert.deepEqual(safe, layout.safe);
    assert.ok(safe.y >= zone.y + 70 && safe.x === zone.x && safe.width === zone.width, JSON.stringify(safe));
    assert.ok(safe.y + safe.height <= zone.y + zone.height + 1e-6);
    for (const region of layout.regions) assert.equal(intersectRects(region.rect, safe).height, 0, `${region.id} is outside the safe area`);
    const bottom = brandFrameSafe(story({ kicker: { position: "bottom-left" }, sections: false }, { format: { ...format, duration: 12 } }), format);
    assert.equal(bottom.y, zone.y, "a bottom kicker leaves the top free");
    assert.ok(bottom.y + bottom.height < zone.y + zone.height);
  }
  assert.equal(brandFrameSafe(story(undefined)), null);
  assert.deepEqual(intersectRects({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }), { x: 5, y: 5, width: 5, height: 5 });
  assert.deepEqual(intersectRects(null, { x: 1, y: 1, width: 1, height: 1 }), { x: 1, y: 1, width: 1, height: 1 });
});

test("modules receive the frame's safe area as model.frame.safe only when the story has a frame", async () => {
  const base = JSON.parse(await readFile(path.join(MINIMAL, "storyboard.json"), "utf8"));
  const words = JSON.parse(await readFile(path.join(MINIMAL, "NARRATION.json"), "utf8")).words;
  const plain = resolveStory(base, { words });
  assert.equal(resolveModule(plain.scenes[0], plain).frame, undefined);
  const framed = resolveStory({ ...base, frame: { kicker: { label: "Minimal" } } }, { words });
  assert.deepEqual(resolveModule(framed.scenes[0], framed).frame, { safe: brandFrameSafe(framed) });
});

const PLANS = [
  story({ progress: true, logo: "assets/logo.svg", labels: [{ start: 0, label: "Why" }, { scene: "b", label: "How" }, { scene: "c", label: "Try it" }] }),
  story({ show: "scenes", kicker: { position: "top-right", underline: false }, progress: { position: "top", thickness: 8, color: "accent" }, labels: [{ scene: "c", label: "End" }] }),
  story({ kicker: false, sections: false, sources: [{ scene: "a", until: "b", text: "Morton et al., 2016 · J Appl Physiol" }, { start: 9, text: "Schoenfeld et al., 2017" }] })
];

test("the plan is seek-safe: unique ids, known targets, one immediate render, `to` after a prior tween", () => {
  for (const s of PLANS) {
    const plan = brandFramePlan(s);
    const ids = [];
    const walk = (node) => { ids.push(node.id); (node.children ?? []).forEach(walk); };
    plan.nodes.forEach(walk);
    assert.equal(new Set(ids).size, ids.length);
    const seen = new Set();
    for (const tween of [...plan.tweens].sort((a, b) => a.at - b.at)) {
      assert.ok(ids.includes(tween.id), tween.id);
      for (const prop of Object.keys(tween.to)) {
        const key = `${tween.id}.${prop}`;
        if (tween.ir) assert.ok(!seen.has(key), `${key} renders immediately after an earlier tween`);
        if (!tween.from) assert.ok(seen.has(key), `${key} is a to() without a prior tween`);
        seen.add(key);
      }
    }
    assert.doesNotMatch(brandFrameRuntime(plan), /autoAlpha|visibility|onUpdate|\.call\(|Math\.random|Date\.now/);
  }
  assert.ok(brandFramePlan(PLANS[0]).nodes[0].children[0].children[0].children.some((node) => node.tag === "img" && node.src === "assets/logo.svg"));
  assert.match(brandFramePlan(PLANS[1]).css, /\.lc-frame-progress \{[^}]*top: 0; height: 8px/);
});

test("the frame-pure evaluator (Remotion) matches a real GSAP timeline seeked to every frame", () => {
  for (const s of PLANS) {
    const plan = brandFramePlan(s);
    const targets = new Map();
    const target = (id) => { if (!targets.has(id)) targets.set(id, {}); return targets.get(id); };
    const seed = { opacity: 0, y: 0, scaleX: 0 };
    for (const tween of plan.tweens) for (const key of Object.keys(tween.to)) if (!(key in target(tween.id))) target(tween.id)[key] = seed[key];
    const tl = gsap.timeline({ paused: true });
    for (const tween of plan.tweens) {
      const vars = { ...tween.to, duration: tween.dur, ease: tween.ease };
      if (tween.from) { if (!tween.ir) vars.immediateRender = false; tl.fromTo(target(tween.id), { ...tween.from }, vars, tween.at); }
      else tl.to(target(tween.id), vars, tween.at);
    }
    const index = indexCaptionTweens(plan.tweens);
    let worst = 0;
    for (let frame = 0; frame <= 12 * 30; frame += 1) {
      const t = frame / 30;
      tl.seek(t, false);
      for (const [id, values] of captionStateAt(plan, t, index)) for (const [key, value] of Object.entries(values)) worst = Math.max(worst, Math.abs(value - targets.get(id)[key]) / (key === "y" ? 50 : 1));
    }
    tl.kill();
    assert.ok(worst < 0.002, `evaluator differs from GSAP by ${worst}`);
  }
});

test("the HyperFrames compiler mounts the frame under the captions, and the Remotion story draws the same plan", async () => {
  const base = JSON.parse(await readFile(path.join(MINIMAL, "storyboard.json"), "utf8"));
  const words = JSON.parse(await readFile(path.join(MINIMAL, "NARRATION.json"), "utf8")).words;
  const plain = await compileStoryToHyperFrames(resolveStory(base, { words }), { write: false, sourceDir: MINIMAL });
  assert.doesNotMatch(plain.html, /lc-frame/, "no frame, no frame markup");
  const framed = await compileStoryToHyperFrames(resolveStory({ ...base, frame: { kicker: { label: "Minimal" }, progress: true } }, { words }), { write: false, sourceDir: MINIMAL });
  assert.match(framed.html, /<div id="lc-frame-root" aria-hidden="true"><\/div>/);
  assert.match(framed.html, /window\.mountBrandFrame\(tl, document\.getElementById\("lc-frame-root"\)\);/);
  assert.match(framed.html, /#lc-frame-root \{[^}]*z-index: 90000; \}/);
  assert.ok(framed.html.indexOf("lc-frame-root") < framed.html.indexOf('id="lc-captions"'), "the frame sits under the captions");
  const isolated = await compileStoryToHyperFrames(resolveStory({ ...base, frame: { kicker: { label: "Minimal" } } }, { words }), { write: false, sourceDir: MINIMAL, sceneFilter: base.scenes[0].id });
  assert.doesNotMatch(isolated.html, /lc-frame-root/, "a module review has no frame");
  const component = await readFile(path.join(ROOT, "kit", "remotion", "frame", "BrandFrame.tsx"), "utf8");
  assert.match(component, /brandFramePlan\(story/);
  assert.match(component, /captionElementStateAt\(index, node\.id, t\)/);
  const composition = await readFile(path.join(ROOT, "kit", "remotion", "StoryComposition.tsx"), "utf8");
  assert.equal(composition.match(/<BrandFrame story=\{story\} \/>\s*\n\s*\{overlay && Array\.isArray\(__captions\)/g)?.length, 2, "both story layouts draw the frame just before the captions");
});

test("source notes: timed from scenes, a bottom band out of the safe area, validated, and a warning for unsourced data", async () => {
  const s = PLANS[2];
  assert.deepEqual(frameSources(s), [{ start: 0, end: 8, text: "Morton et al., 2016 · J Appl Physiol" }, { start: 9, end: 12, text: "Schoenfeld et al., 2017" }]);
  assert.deepEqual(frameSources(story({ sources: [{ scene: "b", text: "B" }, { start: 0, text: "A" }] })).map((entry) => [entry.start, entry.end]), [[0, 4], [4, 12]], "a note runs to the next");
  assert.deepEqual(frameSources(story({})), []);
  for (const format of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
    const zone = profileGeometry(format).safeZone;
    const layout = brandFrameLayout({ ...s, format: { ...format, duration: 12 } }, format);
    const band = layout.regions.find((region) => region.id === "frame-source").rect;
    assert.equal(band.y + band.height, zone.y + zone.height, "the note sits on the bottom of the safe zone");
    assert.equal(layout.safe.y + layout.safe.height, band.y, "modules stop above it");
    assert.equal(layout.safe.y, zone.y, "no kicker, no top band");
  }
  const plan = brandFramePlan(s);
  const holder = plan.nodes[0].children.find((node) => node.id === "lc-frame-source");
  assert.deepEqual(holder.children.map((node) => node.text), ["Morton et al., 2016 · J Appl Physiol", "Schoenfeld et al., 2017"]);
  const index = indexCaptionTweens(plan.tweens);
  const at = (t) => captionStateAt(plan, t, index);
  assert.ok(at(3).get("lc-frame-src-01").opacity > 0.8 && !(at(3).get("lc-frame-src-02")?.opacity > 0), "the first note shows over scenes a and b");
  assert.equal(at(8.5).get("lc-frame-src-01").opacity, 0, "and is gone after b");
  assert.ok(at(11).get("lc-frame-src-02").opacity > 0.8);
  // Validation: shape, scene ids, and the no-source warning for data modules.
  const { validateStory } = await import("@launchclip/core/story.mjs");
  const base = { schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 8 },
    scenes: [{ id: "a", module: "unit-grid", start: 0, end: 4, params: { count: 10 } }, { id: "b", module: "number-line", start: 4, end: 8, params: { from: 1, to: 25, ranges: [{ from: 8, to: 12, label: "Size" }] } }] };
  const check = (frame) => validateStory({ ...base, ...(frame === undefined ? {} : { frame }) });
  const unsourced = check().warnings.filter((w) => /shows data with no source/.test(w));
  assert.equal(unsourced.length, 2);
  assert.match(unsourced[0], /scene a \(unit-grid\).*frame\.sources/);
  assert.equal(check({ kicker: false, sections: false, sources: [{ start: 0, text: "Morton et al., 2016" }] }).warnings.filter((w) => /no source/.test(w)).length, 0, "one note from 0 covers both");
  assert.equal(check({ kicker: false, sections: false, sources: [{ scene: "a", until: "a", text: "Morton et al., 2016" }] }).warnings.filter((w) => /no source/.test(w)).length, 1, "a note over a only");
  const errors = check({ sources: [{ text: "", start: 0, scene: "a" }, { text: "x".repeat(91), start: 1, end: 0.5 }, { text: "Ok", scene: "zz", nope: 1 }] });
  const all = [...errors.errors, ...errors.warnings].join("\n");
  assert.match(all, /frame\.sources\[0\]\.text must be 1-90 characters/);
  assert.match(all, /frame\.sources\[0\] needs exactly one of start/);
  assert.match(all, /frame\.sources\[1\]\.end must be seconds after its start/);
  assert.match(all, /frame\.sources\[2\]\.nope is not supported/);
  assert.match(all, /frame\.sources\[2\]\.scene "zz" is not a scene id/);
  const { brandFrameErrors } = await import("@launchclip/core/style.mjs");
  assert.deepEqual(brandFrameErrors({ sources: [] }), [], "a style's sources are accepted (and ignored)");
});

test("layout-check warns when key text overlaps the frame", () => {
  const s = story({ labels: [{ start: 0, label: "Why" }] });
  const layout = brandFrameLayout(s);
  const kicker = layout.regions[0].rect;
  const findings = brandFrameFindings(s, [
    { id: "headline", role: "text", rect: { x: kicker.x + 10, y: kicker.y + 10, width: 400, height: 120 }, start: 1, end: 3 },
    { id: "photo", role: "media", rect: { x: 0, y: 0, width: 1920, height: 1080 }, start: 0, end: 12 },
    { id: "body", role: "text", rect: { ...layout.safe }, start: 0, end: 12 }
  ], { width: 1920, height: 1080 });
  assert.deepEqual(findings.map((finding) => [finding.rule, finding.severity, finding.ids]), [["brand-frame", "warning", ["headline", "frame-kicker"]]]);
  assert.deepEqual(brandFrameFindings(story(undefined), [{ id: "x", role: "text", rect: { x: 0, y: 0, width: 1920, height: 1080 } }], { width: 1920, height: 1080 }), []);
});

test("inside a footage layout panel, model.frame.safe is the panel safe area narrowed by the frame", async () => {
  const { readProjectStory } = await import("../src/story_loader.js");
  const { layoutAt } = await import("@launchclip/core/footage-layout.mjs");
  const { resolved } = await readProjectStory(path.join(ROOT, "examples/story/layouts-wide"));
  const framed = { ...resolved, frame: { kicker: { label: "Layouts" } } };
  const scene = framed.scenes.find((entry) => entry.id === "list");
  const panel = layoutAt(framed, Number(scene.start)).safe;
  assert.deepEqual(resolveModule(scene, framed).frame.safe, intersectRects(panel, brandFrameSafe(framed)));
  const outside = framed.scenes.find((entry) => !layoutAt(framed, Number(entry.start)));
  if (outside) assert.deepEqual(resolveModule(outside, framed).frame.safe, brandFrameSafe(framed), "no section: the frame's safe area alone");
});

test("per-scene colour: the frame swaps to a contrasting colour on light cast sets, a label colour overrides it, and both renderers agree", async () => {
  const { frameColorSpans, frameBackdrop, FRAME_MIN_CONTRAST } = await import("@launchclip/core/brand-frame.mjs");
  const { contrastRatio } = await import("@launchclip/core/catalog-b-base.mjs");
  const cast = (id, start, end) => ({ id, module: "cast-scene", start, end });
  const plate = (id, start, end) => ({ id, module: "hook-title", start, end });
  const s = story({ progress: true, labels: [{ start: 0, label: "Take 1" }, { scene: "c", label: "Take 2", color: "accent" }] }, {
    brand: { colors: { bg: "#0b0b0b", paper: "#ffffff", ink: "#0b0b0b", primary: "#ffe14d", accent: "#ff3d7f" }, fonts: {} },
    scenes: [cast("a", 0, 4), plate("b", 4, 8), cast("c", 9, 12)]
  });
  const wall = frameBackdrop(s.scenes[0], s);
  assert.ok(contrastRatio("#ffffff", wall) < 1.5, "paper on the cream wall is the bug");
  const spans = frameColorSpans(s);
  const at = (t) => spans.filter((span) => span.start <= t + 1e-6).at(-1);
  assert.ok(contrastRatio(at(1).text, wall) >= FRAME_MIN_CONTRAST, "a contrasting colour on the set");
  assert.notEqual(at(1).underline, "#ffe14d", "the yellow underline swaps too");
  assert.equal(at(5).text, "#ffffff", "paper again on the dark plate");
  assert.equal(at(10).text, "#ff3d7f", "frame.labels[].color overrides while its label shows");
  const { validateStory } = await import("@launchclip/core/story.mjs");
  const valid = (color) => validateStory({ schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 4 }, scenes: [{ id: "a", module: "hook-title", start: 0, end: 4, params: { headline: "Hi" } }], frame: { labels: [{ scene: "a", label: "Take 1", color }] } }).errors.join("\n");
  assert.doesNotMatch(valid("ink"), /frame\.labels/);
  assert.doesNotMatch(valid("#112233"), /frame\.labels/);
  assert.match(valid("dark"), /frame\.labels\[0\]\.color must be a brand role/);
  // No change anywhere: no colour tweens, the plan is as before.
  for (const plain of PLANS) assert.equal(brandFramePlan(plain).tweens.filter((tween) => "color" in tween.to || "backgroundColor" in tween.to).length, 0);
  assert.equal(frameColorSpans(story({})).length, 1);
  // Footage behind (no insert): unknown backdrop, the frame keeps its colour.
  assert.equal(frameBackdrop({ id: "x", module: "punch-in" }, { ...s, base: { src: "assets/base.mp4" } }), null);
  // Seek-safe and identical in the GSAP runtime and the frame-pure evaluator.
  const plan = brandFramePlan(s);
  const colourTweens = plan.tweens.filter((tween) => "color" in tween.to || "backgroundColor" in tween.to);
  assert.ok(colourTweens.length > 0);
  const seen = new Set();
  for (const tween of [...plan.tweens].sort((a, b) => a.at - b.at)) for (const prop of Object.keys(tween.to)) {
    const key = `${tween.id}.${prop}`;
    if (tween.ir) assert.ok(!seen.has(key), `${key} renders immediately after an earlier tween`);
    if (!tween.from) assert.ok(seen.has(key), `${key} is a to() without a prior tween`);
    seen.add(key);
  }
  const rgb = (value) => {
    if (typeof value !== "string") return null;
    if (value.startsWith("#")) return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
    return value.match(/[\d.]+/g).slice(0, 3).map(Number);
  };
  const targets = new Map();
  for (const tween of colourTweens) if (!targets.has(tween.id)) targets.set(tween.id, { ...(tween.from ?? {}) });
  const tl = gsap.timeline({ paused: true });
  for (const tween of colourTweens) {
    const vars = { ...tween.to, duration: tween.dur, ease: tween.ease };
    if (tween.from) { if (!tween.ir) vars.immediateRender = false; tl.fromTo(targets.get(tween.id), { ...tween.from }, vars, tween.at); }
    else tl.to(targets.get(tween.id), vars, tween.at);
  }
  const index = indexCaptionTweens(colourTweens);
  let worst = 0, compared = 0;
  for (let frame = 0; frame <= 12 * 30; frame += 1) {
    const t = frame / 30;
    tl.seek(t, false);
    for (const [id, values] of captionStateAt({ tweens: colourTweens }, t, index)) for (const [key, value] of Object.entries(values)) {
      const a = rgb(value), b = rgb(targets.get(id)[key]);
      if (a && b) { compared += 1; worst = Math.max(worst, ...a.map((c, i) => Math.abs(c - b[i]))); }
    }
  }
  tl.kill();
  assert.ok(compared > 300, `compared ${compared} colour samples`);
  assert.ok(worst <= 1, `evaluator colour differs from GSAP by ${worst}`);
});

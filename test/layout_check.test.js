import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkLayout, elementsFromEditorialLayout, elementsFromStory, profileGeometry, SAFE_ZONE_PROFILES } from "../kit/core/layout-check.mjs";
import { checkLayoutProject } from "../src/layout_check.js";
import { runCli } from "../src/cli.js";
import { buildEditorialModule } from "../skills/launchclip-create-video/scripts/editorial-ui-modules.mjs";

const SHORTS = { width: 1080, height: 1920 };
const LANDSCAPE = { width: 1920, height: 1080 };
const rules = (report) => report.findings.map((finding) => finding.rule);
// Fills the lower half of the safe zone so the lower-third rule stays quiet.
const anchor = (end = 10) => ({ id: "anchor", role: "media", rect: { x: 100, y: 900, width: 800, height: 280 }, start: 0, end });

test("exports shorts and landscape profiles that scale with the canvas", () => {
  assert.deepEqual(SAFE_ZONE_PROFILES.shorts.safeZone, { x: 80, y: 280, width: 860, height: 1170 });
  const big = profileGeometry({ width: 1440, height: 2560 }, "shorts");
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  for (const [key, value] of Object.entries({ x: 80, y: 280, width: 860, height: 1170 })) close(big.safeZone[key], value * 4 / 3);
  close(big.minTextPx, 44 * 4 / 3);
  const wide = profileGeometry(LANDSCAPE, "landscape");
  assert.deepEqual(wide.safeZone, { x: 96, y: 54, width: 1728, height: 972 });
  assert.equal(profileGeometry(SHORTS).profile.id, "shorts");
  assert.equal(profileGeometry(LANDSCAPE).profile.id, "landscape");
  assert.throws(() => profileGeometry(SHORTS, "square"), /Unknown layout profile/);
});

test("a clean shorts layout passes", () => {
  const report = checkLayout({
    canvas: SHORTS,
    elements: [
      { id: "title", role: "hero", rect: { x: 120, y: 320, width: 760, height: 400 }, start: 0, end: 10, minTextPx: 72 },
      anchor()
    ]
  });
  assert.equal(report.status, "passed", JSON.stringify(report.findings));
  assert.deepEqual(report.findings, []);
});

test("safe-zone containment only applies to settled windows", () => {
  const entering = { id: "title", role: "text", rect: { x: 40, y: 320, width: 600, height: 200 }, start: 0, end: 10 };
  const report = checkLayout({ canvas: SHORTS, elements: [entering, anchor()] });
  const finding = report.findings.find((entry) => entry.rule === "safe-zone");
  assert.equal(report.status, "failed");
  assert.deepEqual(finding.ids, ["title"]);
  assert.match(finding.detail, /left 40 px/);
  // No settled window at all (enters then exits immediately): not checked.
  const transient = checkLayout({ canvas: SHORTS, elements: [{ ...entering, motion: { enterEnd: 5, exitStart: 5 } }, anchor()] });
  assert.ok(!rules(transient).includes("safe-zone"));
  // Media and decor may bleed.
  const bleed = checkLayout({ canvas: SHORTS, elements: [{ ...entering, role: "decor" }, anchor()] });
  assert.ok(!rules(bleed).includes("safe-zone"));
});

test("collisions at rest fail unless allowOcclusion names the pair", () => {
  const a = { id: "a", role: "text", rect: { x: 100, y: 300, width: 400, height: 300 }, start: 0, end: 4, motion: { enterEnd: 0.4, exitStart: 3.6 } };
  const b = { id: "b", role: "text", rect: { x: 300, y: 400, width: 400, height: 300 }, start: 2, end: 6, motion: { enterEnd: 2.4, exitStart: 5.6 } };
  const report = checkLayout({ canvas: SHORTS, elements: [a, b, anchor(6)] });
  const finding = report.findings.find((entry) => entry.rule === "collision");
  assert.deepEqual(finding.ids, ["a", "b"]);
  assert.equal(finding.at, 2.4);
  assert.equal(finding.severity, "error");
  assert.ok(!rules(checkLayout({ canvas: SHORTS, elements: [a, { ...b, allowOcclusion: ["a"] }, anchor(6)] })).includes("collision"));
  // Overlap only during a's exit and b's entrance: no collision at rest.
  const handoff = checkLayout({ canvas: SHORTS, elements: [a, { ...b, start: 3.6, end: 8, motion: { enterEnd: 4, exitStart: 7.6 } }, anchor(8)] });
  assert.ok(!rules(handoff).includes("collision"));
  // Decor never collides.
  assert.ok(!rules(checkLayout({ canvas: SHORTS, elements: [a, { ...b, role: "decor" }, anchor(6)] })).includes("collision"));
});

test("caption-band clashes respect visibility windows and hidesCaptions", () => {
  const low = { id: "low", role: "text", rect: { x: 120, y: 1250, width: 600, height: 120 }, start: 2, end: 5 };
  const captions = { id: "captions", role: "caption", start: 0, end: 10 };
  const report = checkLayout({ canvas: SHORTS, elements: [low, captions, anchor()] });
  const clash = report.findings.find((entry) => entry.rule === "caption-band");
  assert.deepEqual(clash.ids, ["low", "captions"]);
  assert.equal(clash.at, 2);
  assert.ok(!rules(checkLayout({ canvas: SHORTS, elements: [{ ...low, hidesCaptions: true }, captions, anchor()] })).includes("caption-band"));
  assert.ok(!rules(checkLayout({ canvas: SHORTS, elements: [low, { ...captions, hide: [[1, 6]] }, anchor()] })).includes("caption-band"));
});

test("minimum key-text size is 44 px on shorts", () => {
  const small = { id: "small", role: "text", rect: { x: 120, y: 320, width: 600, height: 200 }, start: 0, end: 10, minTextPx: 30 };
  const report = checkLayout({ canvas: SHORTS, elements: [small, anchor()] });
  const finding = report.findings.find((entry) => entry.rule === "min-text-size");
  assert.equal(finding.severity, "error");
  assert.match(finding.detail, /30 px.*44 px/);
  assert.ok(!rules(checkLayout({ canvas: SHORTS, elements: [{ ...small, minTextPx: 44 }, anchor()] })).includes("min-text-size"));
});

test("hero fill, lower-third emptiness and centre-of-mass drift are warnings", () => {
  const narrowHero = { id: "hero", role: "hero", rect: { x: 300, y: 300, width: 300, height: 200 }, start: 0, end: 8 };
  const report = checkLayout({ canvas: SHORTS, elements: [narrowHero] });
  assert.equal(report.status, "passed");
  const byRule = Object.fromEntries(report.findings.map((entry) => [entry.rule, entry]));
  assert.equal(byRule["hero-fill"].severity, "warning");
  assert.match(byRule["hero-fill"].detail, /35%/);
  assert.equal(byRule["lower-third-empty"].severity, "warning");
  assert.equal(byRule["lower-third-empty"].at, 0);
  assert.equal(byRule["centre-of-mass"].severity, "warning");
  assert.deepEqual(byRule["centre-of-mass"].ids, ["hero"]);
  // Short empty spells (<= 3 s) are fine.
  const brief = checkLayout({ canvas: SHORTS, elements: [{ ...narrowHero, end: 2.5 }] });
  assert.ok(!rules(brief).includes("lower-third-empty"));
  // Landscape has no lower-third or hero-fill rule.
  const wide = checkLayout({ canvas: LANDSCAPE, elements: [{ ...narrowHero, rect: { x: 200, y: 400, width: 300, height: 200 } }] });
  assert.ok(!rules(wide).includes("lower-third-empty"));
  assert.ok(!rules(wide).includes("hero-fill"));
});

test("rejects malformed elements", () => {
  assert.throws(() => checkLayout({ canvas: SHORTS, elements: [{ id: "x", role: "blob", rect: { x: 0, y: 0, width: 1, height: 1 }, start: 0, end: 1 }] }), /role must be/);
  assert.throws(() => checkLayout({ canvas: SHORTS, elements: [{ id: "x", role: "text", start: 0, end: 1 }] }), /rect/);
  const ok = { id: "x", role: "text", rect: { x: 100, y: 300, width: 10, height: 10 }, start: 0, end: 1 };
  assert.throws(() => checkLayout({ canvas: SHORTS, elements: [ok, ok] }), /Duplicate element id/);
});

test("adapts editorial module layouts", () => {
  const built = buildEditorialModule({ id: "m1", kind: "metric", aspect: "9:16", start: 2, duration: 4, title: "Stars", rect: { x: 90, y: 400, width: 900, height: 600 }, metric: { mode: "illustration", unit: "stars", format: "number", values: [{ value: 12, at: 0.6 }, { value: 120, at: 2 }] }, motion: { enter: "up" } });
  const [element] = elementsFromEditorialLayout(built.layout, { id: "m1" });
  assert.equal(element.role, "text");
  assert.equal(element.start, 2);
  assert.equal(element.end, 6);
  assert.deepEqual(element.motion, { enterEnd: built.layout.motion.enterEnd, exitStart: built.layout.motion.exitStart });
  const [scaled] = elementsFromEditorialLayout(built.layout, { id: "m1", canvas: { width: 1440, height: 2560 } });
  assert.deepEqual(scaled.rect, { x: 120, y: 400 * (2560 / 1920), width: 1200, height: 800 });
  const still = buildEditorialModule({ id: "m2", kind: "metric", aspect: "9:16", start: 0, duration: 3, title: "Stars", metric: { mode: "illustration", unit: "stars", format: "number", values: [{ value: 12, at: 0.6 }, { value: 120, at: 2 }] } });
  assert.throws(() => elementsFromEditorialLayout(still.layout, { id: "m2" }), /pass start and end/);
  assert.equal(elementsFromEditorialLayout(still.layout, { id: "m2", start: 0, end: 3 })[0].end, 3);
});

test("builds story elements through an injected module layout and adds a caption band", () => {
  const story = {
    format: { width: 1080, height: 1920, fps: 30, duration: 10 },
    scenes: [
      { id: "s1", module: "hook-title", start: 0, end: 5, track: 1 },
      { id: "s2", module: "unknown", start: 5, end: 10, hides_captions: true }
    ],
    overlays: [{ type: "captions", style: "word-highlight" }],
    resolved: { duration: 10 }
  };
  const elements = elementsFromStory(story, {
    moduleLayout: (scene) => scene.module === "hook-title" ? [{ role: "hero", rect: { x: 100, y: 300, width: 800, height: 400 } }] : null
  });
  assert.equal(elements.length, 2);
  assert.deepEqual(elements[0], { role: "hero", rect: { x: 100, y: 300, width: 800, height: 400 }, id: "s1", start: 0, end: 5, track: 1 });
  assert.deepEqual(elements[1], { id: "captions", role: "caption", rect: { x: 65, y: 1190, width: 853, height: 230 }, start: 0, end: 10, hide: [[5, 10]] });
  assert.throws(() => elementsFromStory(story, {}), /moduleLayout/);
});

test("layout-check CLI reads storyboard.json and editorial specs", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-layout-"));
  const story = {
    schema: "launchclip.story.v1",
    format: { width: 1080, height: 1920, fps: 30, duration: 8 },
    scenes: [
      { id: "metric", module: "metric", start: 0, end: 8, params: { title: "Stars", rect: { x: 90, y: 400, width: 900, height: 600 }, metric: { mode: "illustration", unit: "stars", format: "number", values: [{ value: 12, at: 0.6 }, { value: 120, at: 2 }] } } },
      { id: "badge", module: "custom-badge", start: 0, end: 8, params: { rect: { x: 100, y: 1250, width: 400, height: 150 }, role: "text" } },
      { id: "mystery", module: "thermal-hero", start: 0, end: 8 },
      { id: "broken", module: "checklist", start: 0, end: 8, params: { title: "Steps" } }
    ],
    overlays: [{ type: "captions" }]
  };
  await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
  const storyCore = {
    validateStory: () => ({ ok: true, errors: [], warnings: [] }),
    resolveStory: (input) => ({ ...structuredClone(input), resolved: { duration: input.format.duration, fps: 30, frames: 240 } })
  };
  const report = await checkLayoutProject(project, { profile: "shorts" }, { storyCore });
  assert.equal(report.status, "failed");
  assert.equal(report.profile, "shorts");
  for (const rule of ["module-spec", "safe-zone", "caption-band"]) assert.ok(rules(report).includes(rule), rule);
  assert.ok(report.findings.some((entry) => entry.rule === "safe-zone" && entry.ids[0] === "metric"));
  assert.ok(report.findings.some((entry) => entry.rule === "caption-band" && entry.ids[0] === "badge"));
  assert.ok(report.findings.some((entry) => entry.rule === "module-spec" && entry.ids[0] === "broken"));
  assert.match(report.warnings[0], /mystery.*skipped/);

  const json = [];
  await runCli(["layout-check", project, "--profile", "shorts", "--json"], { stdout: { write: (value) => json.push(value) }, productionAdapters: { layoutCheck: { storyCore } } });
  assert.equal(JSON.parse(json.join("")).stage, "layout-check");
  const text = [];
  await runCli(["layout-check", project], { stdout: { write: (value) => text.push(value) }, productionAdapters: { layoutCheck: { storyCore } } });
  assert.match(text.join(""), /^layout-check failed \(shorts, 1080x1920, 3 elements\)/);
  assert.match(text.join(""), /note +scene mystery/);

  const help = [];
  await runCli(["--help"], { stdout: { write: (value) => help.push(value) } });
  assert.match(help.join(""), /layout-check <project> \[--profile shorts\|landscape\] \[--json\]/);
});

test("layout-check explains a missing storyboard.json", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-layout-empty-"));
  await assert.rejects(checkLayoutProject(project, {}, { storyCore: {} }), /needs .*storyboard\.json/);
});

test("layout-check explains a missing kit/core/story.mjs", { skip: existsSync(path.resolve(import.meta.dirname, "../kit/core/story.mjs")) }, async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-layout-core-"));
  await writeFile(path.join(project, "storyboard.json"), JSON.stringify({ format: { width: 1080, height: 1920 }, scenes: [] }));
  await assert.rejects(checkLayoutProject(project), /kit\/core\/story\.mjs/);
});

test("layout-check checks the ambient drift's largest extent, as the compilers draw it", async () => {
  const { driftExtent, sceneDrift } = await import("../kit/core/ambient.mjs");
  const { resolveModule } = await import("../kit/core/modules.mjs");
  const { resolveStory } = await import("../kit/core/story.mjs");
  const metric = { mode: "illustration", unit: "minutes", format: "number", values: [{ value: 48, at: 0.3 }] };
  // Two overlays 12 px apart: at rest they never touch.
  const story = (ambient) => ({
    schema: "launchclip.story.v1", lane: "motion", title: "Drift extent",
    format: { width: 1080, height: 1920, fps: 30, duration: 6 },
    brand: { colors: { bg: "#06070d", primary: "#fdb022", paper: "#f2eee6" }, fonts: { display: "anton" } },
    ...(ambient === undefined ? {} : { ambient }),
    scenes: [
      { id: "top", module: "metric", start: 0, end: 6, energy: 3, params: { title: "Before", rect: { x: 90, y: 300, width: 840, height: 420 }, metric } },
      { id: "low", module: "metric", start: 0, end: 6, track: 1, energy: 3, params: { title: "After", rect: { x: 90, y: 732, width: 840, height: 420 }, metric } }
    ]
  });
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-layout-drift-"));
  await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story(undefined)));
  const drifting = await checkLayoutProject(project);
  assert.deepEqual(drifting.drifted, ["top", "low"]);
  assert.ok(drifting.findings.some((entry) => entry.rule === "collision" && entry.ids.includes("top") && entry.ids.includes("low")), "the pushed-in extents meet");
  // The extent checked is exactly the drift both compilers draw.
  const resolved = resolveStory(story(undefined));
  const scene = resolved.scenes.find((entry) => entry.id === "top");
  const drift = sceneDrift(resolved, scene, resolveModule(scene, resolved, { end: 6 }), { window: { start: 0, end: 6 }, geometry: profileGeometry(SHORTS) });
  const extent = driftExtent(scene.params.rect, drift);
  assert.ok(extent.height > 420 && extent.y >= 280, "pushed in, but inside the safe zone");
  await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story("off")));
  const still = await checkLayoutProject(project);
  assert.deepEqual(still.drifted, []);
  assert.ok(!still.findings.some((entry) => entry.rule === "collision"), "with ambient off the rest rects do not touch");
});

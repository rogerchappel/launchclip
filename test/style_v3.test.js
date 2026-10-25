// Style pack v3 (docs/VIDEO_QUALITY_RFC.md §9): the new fields, v2 → v3
// upgrades, caption defaults per lane and the quiet-accent preset.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { applyStyle, brandFrameErrors, cadenceProfileErrors, packCaptionsFor, STYLE_SCHEMA, STYLE_V2_SCHEMA, STYLE_V3_DEFAULTS, upgradeV2Pack, validateStylePack } from "../kit/core/style.mjs";
import { captionDefaultPreset, captionPlan, captionPresetName, chunkWords } from "../kit/core/captions.mjs";
import { validateStory } from "../kit/core/story.mjs";
import { planningPrompt } from "../kit/core/planning-prompt.mjs";
import { listBuiltinStyles, resolveStyleV2, upgradeStylePack } from "../src/style_store.js";

const v2 = (overrides = {}) => ({
  schema: STYLE_V2_SCHEMA,
  name: "channel",
  brand: { colors: { bg: "#101010", paper: "#fafafa", ink: "#101010", primary: "#ffcc00", accent: "#33ccff" } },
  captions: { preset: "outline-heavy" },
  ...overrides
});

const story = (overrides = {}) => ({
  schema: "launchclip.story.v1",
  lane: "motion",
  format: { width: 1080, height: 1920, fps: 30, duration: 6 },
  brand: { colors: { bg: "#101010", paper: "#fafafa" }, fonts: { display: "anton" } },
  scenes: [{ id: "s1", module: "hook-title", start: 0, end: 3, params: { headline: "Hello there" } }, { id: "s2", module: "kinetic-words", start: 3, end: 6, params: { words: [{ text: "Fast", at: 0.3 }] } }],
  overlays: [{ type: "captions" }],
  ...overrides
});

test("validates the v3 fields", () => {
  const good = { ...upgradeV2Pack(v2()).pack, profile: "short-talking-head", cast: { drawing_style: "flat", colors: { fill: "primary", line: "#000000" }, characters: ["mira"] } };
  assert.equal(good.schema, STYLE_SCHEMA);
  assert.deepEqual(validateStylePack(good), { ok: true, errors: [], warnings: [] });
  const bad = validateStylePack({
    schema: STYLE_SCHEMA, name: "bad",
    layouts: { by_intent: { list: "diagonal" }, panel: { treatment: "chrome", radius: 500 } },
    vocabulary: { icon_tint: "pink", illustration: "yes", prefer: { claim: "concept-card" } },
    profile: { schema: "launchclip.cadence-profile.v1", id: "x", format: "footage-led", duration_seconds: [1, 2], references: 0, provenance: { kind: "seed", note: "n", sources: [] }, measures: { coverage: { p10: 0.8, p50: 0.5 } } },
    cast: { colors: { fill: "teal" }, characters: ["../x"] },
    brand_frame: { kicker: { label: "x".repeat(41), position: "middle" }, progress: { thickness: 40 }, show: "never" },
    dials: { energy: 2, chaos: 0.5 },
    captions: { lanes: { podcast: {}, "footage-led": { preset: "sparkle" } } }
  });
  assert.equal(bad.ok, false);
  for (const pattern of [/layouts\.panel\.treatment/, /layouts\.panel\.radius/, /vocabulary\.icon_tint/, /vocabulary\.illustration/, /vocabulary\.prefer\.claim/, /must not decrease/, /cast\.colors\.fill/, /cast\.characters/, /kicker\.label/, /kicker\.position/, /progress\.thickness/, /show/, /dials\.energy/, /dials\.chaos/, /lanes\.podcast/, /lanes\.footage-led\.preset/]) {
    assert.ok(bad.errors.some((error) => pattern.test(error)), `${pattern} in ${bad.errors.join("; ")}`);
  }
  assert.match(bad.warnings.join(" "), /layouts\.by_intent\.list "diagonal"/, "an unknown layout name is a warning");
  assert.match(validateStylePack(v2({ dials: { energy: 0.5 } })).warnings.join(" "), /dials is a style v3 field/);
});

test("a cadence profile is a shipped id or a valid measured profile", () => {
  const measured = { schema: "launchclip.cadence-profile.v1", id: "mine", format: "footage-led", duration_seconds: [30, 120], references: 1, provenance: { kind: "measured", sources: [{ id: "ref-01", rights: "own" }] }, measures: { shot_seconds: { p10: 1.6, p50: 3.8, p90: 9.5 }, first_visual_seconds: { p50: 0.4, p90: 1.2 } } };
  assert.deepEqual(cadenceProfileErrors("youtube-talking-head-launch"), []);
  assert.deepEqual(cadenceProfileErrors(measured), []);
  assert.match(cadenceProfileErrors({ ...measured, measures: {} }).join(" "), /profile: measures/);
  assert.match(cadenceProfileErrors({ ...measured, measures: { coverage: { p50: "high" } } }).join(" "), /coverage/);
  assert.match(cadenceProfileErrors({ ...measured, provenance: undefined }).join(" "), /provenance/);
  assert.match(cadenceProfileErrors(42).join(" "), /profile id/);
});

test("the brand frame shape is shared by style and story", () => {
  assert.deepEqual(brandFrameErrors(STYLE_V3_DEFAULTS.brand_frame), []);
  assert.deepEqual(brandFrameErrors(false), []);
  assert.match(brandFrameErrors({ labels: [{ label: "Why", start: 1, scene: "s1" }] }).join(" "), /exactly one/);
  const withFrame = story({ frame: { kicker: { label: "Inside Ship Mode" }, labels: [{ scene: "s2", label: "How" }, { scene: "nope", label: "Gone" }] } });
  const result = validateStory(withFrame);
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.match(result.warnings.join(" "), /frame\.labels\[1\]\.scene "nope"/);
  assert.match(validateStory(story({ frame: { glow: true } })).errors.join(" "), /frame\.glow/);
  assert.equal(validateStory(story({ frame: false })).ok, true);
});

test("a v2 pack loads as v3 and renders exactly as before", () => {
  const pack = v2();
  const { pack: same } = upgradeV2Pack(pack, { render: "same" });
  assert.equal(same.schema, STYLE_SCHEMA);
  assert.equal(same.brand_frame.enabled, false);
  assert.equal(same.captions.lanes, undefined);
  for (const lane of ["motion", "footage-led"]) {
    const input = story({ lane, ...(lane === "footage-led" ? { base: { src: "assets/recording.mp4" }, scenes: [{ id: "s1", module: "lower-third", track: 1, start: 0, end: 3, params: { name: "Ada", title: "Founder" } }] } : {}) });
    assert.deepEqual(applyStyle(input, same).story, applyStyle(input, pack).story, lane);
  }
  const { pack: upgraded, notes } = upgradeV2Pack(v2({ captions: undefined }));
  assert.equal(upgraded.brand_frame.enabled, true);
  assert.deepEqual(upgraded.captions.lanes, { "footage-led": { preset: "quiet-accent" } });
  assert.equal(upgraded.upgraded_from, STYLE_V2_SCHEMA);
  assert.ok(notes.some((note) => /brand_frame/.test(note)));
  assert.equal(upgradeV2Pack(upgraded).pack, upgraded, "a v3 pack is returned as it is");
  assert.equal(upgradeV2Pack(v2()).pack.captions.lanes, undefined, "a pack's own caption preset is kept for every lane");
});

test("style upgrade writes v3 over a v2 pack and keeps the v2 file; v2 packs still resolve", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-style-v3-"));
  try {
    const dir = path.join(root, ".launchclip", "styles", "channel");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "style.json"), JSON.stringify(v2()));
    const loaded = await resolveStyleV2("channel", { projectDir: root, home: path.join(root, "home") });
    assert.equal(loaded.pack.schema, STYLE_SCHEMA);
    assert.equal(loaded.pack.brand_frame.enabled, false);
    assert.equal(loaded.upgraded, true);
    assert.match(loaded.warnings.join(" "), /v2 pack, loaded as v3/);
    const result = await upgradeStylePack("channel", { root: path.join(root, ".launchclip", "styles") });
    assert.equal(result.status, "upgraded");
    assert.deepEqual(result.kept, ["style.v2.json"]);
    assert.equal(JSON.parse(await readFile(path.join(dir, "style.v2.json"), "utf8")).schema, STYLE_V2_SCHEMA);
    const written = JSON.parse(await readFile(path.join(dir, "style.json"), "utf8"));
    assert.equal(written.schema, STYLE_SCHEMA);
    assert.equal(written.brand_frame.enabled, true);
    assert.equal((await upgradeStylePack("channel", { root: path.join(root, ".launchclip", "styles") })).status, "unchanged");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("every starter is v3 and footage-led stories get its quiet caption default", async () => {
  for (const entry of await listBuiltinStyles()) {
    const starter = JSON.parse(await readFile(entry.file, "utf8"));
    assert.equal(starter.schema, STYLE_SCHEMA, entry.name);
    for (const key of ["layouts", "vocabulary", "cast", "brand_frame", "dials"]) assert.ok(starter[key], `${entry.name}.${key}`);
    assert.equal(packCaptionsFor(starter, "footage-led").preset, "quiet-accent", entry.name);
    assert.equal(packCaptionsFor(starter, "motion").preset, starter.captions.preset, entry.name);
    assert.equal(packCaptionsFor(starter, "motion").lanes, undefined);
    const merged = applyStyle(story({ style: entry.name }), starter).story;
    assert.equal(merged.overlays[0].preset, starter.captions.preset);
    assert.equal(merged.overlays[0].lanes, undefined);
    assert.deepEqual(Object.keys(merged.frame).sort(), ["enabled", "kicker", "progress", "sections", "show"]);
  }
});

test("applyStyle fills the frame per key and leaves frame: false alone", () => {
  const pack = upgradeV2Pack(v2()).pack;
  const merged = applyStyle(story({ frame: { kicker: { label: "Inside Ship Mode" }, labels: [{ scene: "s2", label: "How" }] } }), pack).story;
  assert.equal(merged.frame.kicker.label, "Inside Ship Mode");
  assert.equal(merged.frame.kicker.underline, true);
  assert.deepEqual(merged.frame.labels, [{ scene: "s2", label: "How" }]);
  assert.equal(applyStyle(story({ frame: false }), pack).story.frame, false);
  assert.equal(applyStyle(story(), upgradeV2Pack(v2(), { render: "same" }).pack).story.frame, undefined);
});

test("footage-led captions default to quiet-accent only when the story names no style", () => {
  assert.equal(captionDefaultPreset({ lane: "footage-led" }), "quiet-accent");
  assert.equal(captionDefaultPreset({ lane: "footage-led", style: "minimal-tech" }), "word-highlight");
  assert.equal(captionDefaultPreset({ lane: "footage-led", style: { name: "minimal-tech" } }), "word-highlight");
  assert.equal(captionDefaultPreset({ lane: "motion" }), "word-highlight");
  assert.equal(captionPresetName({ type: "captions" }, { lane: "footage-led" }), "quiet-accent");
  assert.equal(captionPresetName({ type: "captions", style: "word-highlight" }, { lane: "footage-led" }), "word-highlight", "word-highlight stays available");
  assert.equal(captionPresetName({ type: "captions" }), "word-highlight");
  const prompt = planningPrompt({ lane: "footage-led" });
  assert.match(prompt, /quiet-accent preset with one accent word/);
  assert.doesNotMatch(planningPrompt({ lane: "motion" }), /quiet-accent preset with one accent word/);
});

test("quiet-accent: sentence case, no stroke, at most one accent word per line", () => {
  const words = ["We", "shipped", "the", "release", "in", "12", "days", "and", "nobody", "noticed", "anything", "broken"].map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.3 }));
  const plan = captionPlan(chunkWords(words), { type: "captions" }, { story: { lane: "footage-led", scenes: [] }, format: { width: 1920, height: 1080 } });
  assert.equal(plan.preset, "quiet-accent");
  assert.equal(plan.options.case, "as-is");
  assert.equal(plan.options.stroke, 0);
  assert.match(plan.css, /text-transform: none/);
  const lines = plan.nodes.filter((node) => node.cls?.startsWith("lc-cap"));
  assert.ok(lines.length >= 2);
  for (const line of lines) assert.ok(line.children.filter((span) => span.cls.includes("lc-cap-em")).length <= 1, line.id);
  const accents = lines.flatMap((line) => line.children.filter((span) => span.cls.includes("lc-cap-em")).map((span) => span.text));
  assert.ok(accents.includes("12"), "a number is the accent of its line");
  assert.ok(accents.includes("anything") || accents.includes("noticed"), "a line with no emphasis word accents its longest word");
});

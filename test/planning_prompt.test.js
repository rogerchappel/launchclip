import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { EDITORIAL_KINDS } from "../kit/core/editorial-core.mjs";
import { catalogModules, knownModules, resolveModule } from "../kit/core/modules.mjs";
import { resolveStory, validateStory } from "../kit/core/story.mjs";
import {
  EDITORIAL_SPECS,
  PHRASE_MODULE_TABLE,
  PLANNER_TIERS,
  TUNING_PARAMS,
  exampleStoryboard,
  moduleCatalogue,
  phraseRowModule,
  planningPrompt,
  storyboardModulesReference,
  suggestModules
} from "../kit/core/planning-prompt.mjs";

const root = path.resolve(import.meta.dirname, "..");
const portrait = { width: 1080, height: 1920, fps: 30, duration: 30, platform: "youtube-shorts" };

test("every known module appears in the prompt for every tier", () => {
  const modules = knownModules();
  assert.ok(modules.length >= 25, `expected the full registry, got ${modules.length}`);
  for (const tier of PLANNER_TIERS) {
    const prompt = planningPrompt({ tier, lane: "motion", format: portrait });
    for (const id of modules) assert.match(prompt, new RegExp(`^### ${id} \\(`, "m"), `${tier} prompt is missing ${id}`);
  }
});

test("the catalogue is read from the registry, not a hand-kept list", () => {
  const catalogue = moduleCatalogue();
  assert.deepEqual(catalogue.map((entry) => entry.id), knownModules());
  for (const [id, definition] of Object.entries(catalogModules())) {
    const entry = catalogue.find((item) => item.id === id);
    assert.equal(entry.describe, definition.describe);
    assert.deepEqual(entry.events, definition.events);
    assert.deepEqual(entry.params.map((param) => param.name), Object.keys(definition.params));
  }
  assert.equal(catalogue.find((entry) => entry.id === "hook-title").hidesCaptions, true);
  assert.equal(catalogue.find((entry) => entry.id === "count-up").hidesCaptions, false);
});

test("every editorial kind has a spec summary", () => {
  for (const kind of EDITORIAL_KINDS) assert.ok(EDITORIAL_SPECS[kind], `EDITORIAL_SPECS is missing ${kind}`);
  for (const kind of Object.keys(EDITORIAL_SPECS)) assert.ok(EDITORIAL_KINDS.includes(kind), `EDITORIAL_SPECS has unknown kind ${kind}`);
});

test("the phrase table maps every row to a registry module and covers the RFC table", () => {
  const modules = knownModules();
  for (const row of PHRASE_MODULE_TABLE) {
    assert.ok(phraseRowModule(row, modules), `${row.module} has no registry module or fallback`);
    for (const source of row.patterns) assert.doesNotThrow(() => new RegExp(source, "i"));
  }
  const rfc = ["hook-title", "kinetic-words", "function-chart", "gauge-compare", "flow-compare", "count-up", "checklist", "process-steps", "equation-lockup", "archive-card", "ui-showcase", "logo-row", "cta", "punch-in", "callout"];
  for (const id of rfc) assert.ok(PHRASE_MODULE_TABLE.some((row) => row.module === id), `phrase table is missing RFC row ${id}`);
  const prompt = planningPrompt({ tier: "structured", lane: "motion", format: portrait });
  assert.match(prompt, /\| names a law or formula \| equation-lockup \|/);
  assert.match(prompt, /media-window \(planned module ui-showcase; use media-window\)/);
});

test("suggestModules matches sentences to modules", () => {
  const hints = suggestModules("Why does coffee cool so fast? Newton named the law in 1701. Follow for part two.");
  assert.deepEqual(hints[0], { sentence: "Why does coffee cool so fast?", modules: ["hook-title", "kinetic-words", "function-chart"] });
  assert.ok(hints[1].modules.includes("equation-lockup"));
  assert.ok(hints[2].modules.includes("cta"));
  // Lane-scoped rows: punch-in (→ kinetic-words) only applies to footage-led.
  assert.deepEqual(suggestModules("This is exactly it!", { lane: "motion" }), []);
  assert.deepEqual(suggestModules("This is exactly it!", { lane: "footage-led" })[0].modules, ["kinetic-words"]);
});

test("tiers differ: structured forbids tuning and custom, bespoke allows custom", () => {
  const structured = planningPrompt({ tier: "structured", lane: "motion", format: portrait });
  const guided = planningPrompt({ tier: "guided", lane: "motion", format: portrait });
  const bespoke = planningPrompt({ tier: "bespoke", lane: "motion", format: portrait });
  assert.doesNotMatch(structured, /^- rect:/m);
  assert.match(structured, /Never set params\.rect/);
  assert.match(structured, /Never use "module": "custom"/);
  assert.match(guided, /^- rect: .*\[guided and bespoke tiers only\]/m);
  assert.match(guided, /Never use "module": "custom"/);
  assert.match(bespoke, /^### custom \(bespoke tier only\)/m);
  for (const name of TUNING_PARAMS) assert.match(structured, new RegExp(`params\\.${name}`));
  assert.throws(() => planningPrompt({ tier: "flagship" }), /tier must be one of/);
});

test("the prompt carries lane rules, anchors, safe zone, captions, fixed inputs and narration", () => {
  const brand = { colors: { bg: "#101010", primary: "#ffcc00", paper: "#fafafa" }, fonts: { display: "anton" } };
  const words = [{ text: "Coffee", start: 0.1, end: 0.4 }, { text: "cools", start: 0.45, end: 0.8 }];
  const prompt = planningPrompt({ tier: "structured", lane: "voiceover-motion", format: portrait, brand, words });
  assert.match(prompt, /voiceover-motion: audio\.voice and audio\.words are fixed inputs/);
  assert.doesNotMatch(prompt, /^- footage-led:/m);
  assert.match(prompt, /"word:<text>#<n>"/);
  assert.match(prompt, /key content within x 80–940, y 280–1450/);
  assert.match(prompt, /caption band x 65–918, y 1190–1420/);
  assert.match(prompt, /"word-highlight"/);
  assert.match(prompt, new RegExp(JSON.stringify(brand).replace(/[{}[\]()*+?.\\^$|]/g, "\\$&")));
  assert.match(prompt, /Coffee@0\.1 cools@0\.45/);
  const landscape = planningPrompt({ tier: "guided", lane: "footage-led", format: { width: 1920, height: 1080, fps: 30, duration: 60 } });
  assert.match(landscape, /landscape \(1920x1080\)/);
  assert.match(landscape, /footage-led: base/);
});

test("the example storyboard validates and resolves through every module", () => {
  for (const format of [portrait, { width: 1920, height: 1080, fps: 30, duration: 30 }]) {
    const story = exampleStoryboard({ format });
    const validation = validateStory(story, { modules: knownModules() });
    assert.deepEqual(validation.errors, []);
    const resolved = resolveStory(story);
    for (const scene of resolved.scenes) {
      // checklist relies on the planner's safe rect; resolve it with one here.
      const params = scene.module === "checklist" ? { ...scene.params, rect: format.width > format.height ? { x: 160, y: 120, width: 1600, height: 700 } : { x: 90, y: 420, width: 850, height: 720 } } : scene.params;
      assert.doesNotThrow(() => resolveModule({ ...scene, params }, resolved), scene.id);
    }
  }
});

test("the skill reference is generated from the same registry and is in sync", async () => {
  const reference = storyboardModulesReference();
  for (const id of knownModules()) assert.match(reference, new RegExp(`^### ${id} \\(`, "m"));
  assert.match(reference, /Generated from kit\/core\/planning-prompt\.mjs/);
  assert.match(reference, /\| structured \|/);
  assert.equal(await readFile(path.join(root, "skills-src/references/storyboard-modules.md"), "utf8"), reference);
  for (const skill of ["launchclip-create-video", "launchclip-create-video-remotion"]) {
    assert.equal(await readFile(path.join(root, "skills", skill, "references/storyboard-modules.md"), "utf8"), reference);
  }
});

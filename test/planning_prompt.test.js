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
  subjectEffectsReference,
  suggestModuleMoods,
  suggestModules
} from "../kit/core/planning-prompt.mjs";

const root = path.resolve(import.meta.dirname, "..");
const portrait = { width: 1080, height: 1920, fps: 30, duration: 30, platform: "youtube-shorts" };

test("every known module appears in the prompt for every tier", () => {
  const modules = knownModules();
  assert.ok(modules.length >= 25, `expected the full registry, got ${modules.length}`);
  const needsSubject = new Set(moduleCatalogue().filter((module) => module.needs?.includes("subject")).map((module) => module.id));
  assert.deepEqual([...needsSubject].sort(), ["app-stage", "backdrop-swap", "dolly-zoom", "doodle-outline", "feed-frame", "glass-word", "growth-line", "masthead", "orbit-cards", "proof-wall", "scrapbook"]);
  const subject = { usable: true, reasons: [], framing: "medium", headroom: 0.2, head: { x: 0.5, y: 0.3, w: 0.2, h: 0.15 } };
  for (const tier of PLANNER_TIERS) {
    const prompt = planningPrompt({ tier, lane: "motion", format: portrait });
    for (const id of modules) {
      if (needsSubject.has(id)) assert.doesNotMatch(prompt, new RegExp(`^### ${id} \\(`, "m"), `${tier} motion prompt offers ${id}`);
      else assert.match(prompt, new RegExp(`^### ${id} \\(`, "m"), `${tier} prompt is missing ${id}`);
    }
    const footage = planningPrompt({ tier, lane: "footage-led", format: portrait, subject });
    for (const id of modules) assert.match(footage, new RegExp(`^### ${id} \\(`, "m"), `${tier} footage prompt with a subject is missing ${id}`);
  }
});

test("subject modules: offered with a usable subject, explained when not", () => {
  const subject = { usable: true, reasons: [], framing: "medium", headroom: 0.2, head: { x: 0.5, y: 0.3, w: 0.2, h: 0.15 } };
  const ready = planningPrompt({ lane: "footage-led", format: portrait, subject });
  assert.match(ready, /## Presenter \(subject\)/);
  assert.match(ready, /medium framing, 20% headroom/);
  assert.match(ready, /A masthead keeps 60% of every letter clear of the head[^\n]*about 20% headroom \(more with a kicker\)\./);
  const tight = planningPrompt({ lane: "footage-led", format: portrait, subject: { ...subject, headroom: 0.15 } });
  assert.match(tight, /this recording has 15%: use another module/);
  assert.match(ready, /^### masthead \(keeps captions, behind the presenter, needs the subject\)/m);
  assert.match(ready, /\| names the product or the one idea .*\| masthead \|/);
  const none = planningPrompt({ lane: "footage-led", format: portrait, subject: { usable: false, reasons: ["more than one person is in frame"] } });
  assert.match(none, /No subject modules: more than one person is in frame/);
  assert.doesNotMatch(none, /^### masthead/m);
  assert.doesNotMatch(none, /\| masthead \|/);
  assert.ok(!suggestModules("Meet LaunchClip.", { lane: "footage-led" }).some((hint) => hint.modules.includes("masthead")));
  assert.ok(suggestModules("Meet LaunchClip.", { lane: "footage-led", subject: true })[0].modules.includes("masthead"));
  assert.ok(suggestModules("And that's when it hit me.", { lane: "footage-led", subject: true })[0].modules.includes("dolly-zoom"));
});

test("the art direction favours modules by mood", () => {
  const subject = { usable: true, reasons: [], framing: "wide", headroom: 0.3 };
  const favoured = suggestModuleMoods("A cinematic, premium launch film").map((entry) => entry.id);
  for (const id of ["dolly-zoom", "masthead", "backdrop-swap", "pull-back"]) assert.ok(favoured.includes(id), `${id} in ${favoured}`);
  assert.ok(!favoured.includes("checklist"), "modules without moods are not favoured");
  assert.match(planningPrompt({ lane: "footage-led", format: portrait, subject, artDirection: "bold launch" }), /Favoured by the art direction[\s\S]*masthead \(bold, launch\)/);
  assert.doesNotMatch(planningPrompt({ lane: "motion", format: portrait, artDirection: "bold launch" }), /masthead \(bold/);
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
  // Lane-scoped rows: punch-in only applies to footage-led (it falls back to kinetic-words when the module is absent).
  assert.deepEqual(suggestModules("This is exactly it!", { lane: "motion" }), []);
  assert.deepEqual(suggestModules("This is exactly it!", { lane: "footage-led" })[0].modules, ["punch-in"]);
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
  // Ambient motion: the planner knows the control, the default and the per-scene override.
  assert.match(prompt, /ambient\? \(optional\): \{level: off \| subtle \| standard \| lively, background\?: boolean, drift\?: boolean\}/);
  assert.match(prompt, /the level follows each scene's energy \(0 → subtle, 1, 2 or "build" → standard, 3 → lively; every scene is lively under the cinematic grammar\)/);
  assert.match(prompt, /footage-led stories get no background field and drift overlays only/);
  assert.match(prompt, /A scene may set ambient to override the story/);
  assert.match(prompt, /params, hits\?, ambient\?, layer\? \(footage-led/);
  const landscape = planningPrompt({ tier: "guided", lane: "footage-led", format: { width: 1920, height: 1080, fps: 30, duration: 60 } });
  assert.match(landscape, /landscape \(1920x1080\)/);
  assert.match(landscape, /footage-led: base/);
  // Editorial panels: omit rect, or pair a 16:9 rect with density "fill" so the text fills it.
  assert.match(landscape, /omit rect unless the layout needs a specific position\. With a rect in 16:9, also set density: "fill"/);
  assert.match(landscape, /density: "fill" \(an explicit rect's text grows to fill it; recommended with rect in 16:9\)/);
});

test("the example storyboard validates and resolves through every module", () => {
  for (const format of [portrait, { width: 1920, height: 1080, fps: 30, duration: 30 }]) {
    const story = exampleStoryboard({ format });
    const validation = validateStory(story, { modules: knownModules() });
    assert.deepEqual(validation.errors, []);
    const resolved = resolveStory(story);
    for (const scene of resolved.scenes) {
      assert.doesNotThrow(() => resolveModule(scene, resolved), scene.id);
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

test("subject-effects.md is generated from the registry and shipped in both skills", async () => {
  const reference = subjectEffectsReference();
  assert.match(reference, /^# Subject effects/);
  assert.match(reference, /\| masthead \| behind \|/);
  assert.match(reference, /\| dolly-zoom \| behind \|/);
  assert.match(reference, /^### punch-in \(/m, "punch-in steps and blur are documented alongside");
  for (const skill of ["launchclip-create-video", "launchclip-create-video-remotion"]) {
    assert.equal(await readFile(path.join(root, "skills", skill, "references", "subject-effects.md"), "utf8"), reference);
  }
});

test("product moments around the presenter have phrase rows", () => {
  const first = (text) => suggestModules(text, { lane: "footage-led", subject: true })[0]?.modules ?? [];
  assert.ok(first("Here's the dashboard.").includes("app-stage"));
  assert.ok(first("On my phone it just works.").includes("phone-stage"));
  assert.ok(first("So we built Ledgerly.").includes("backdrop-swap"));
  assert.ok(first("This exact video went viral.").includes("feed-frame"));
  assert.ok(first("It transcribes, cuts and renders.").includes("pull-back"));
  // Without the cut-out, only the moments that do not need it are offered.
  const bare = suggestModules("This exact video went viral. On my phone it just works.", { lane: "footage-led" }).flatMap((hint) => hint.modules);
  assert.ok(!bare.includes("feed-frame"));
  assert.ok(bare.includes("phone-stage"));
  assert.match(subjectEffectsReference(), /\| feed-frame \| split \| yes \|/);
  assert.match(subjectEffectsReference(), /\| phone-stage \| front \| no \|/);
});

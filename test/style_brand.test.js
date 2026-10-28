// Brand-conditioned seeded styles (docs/SEEDED_STYLES_RFC.md §3.7–3.9):
// brand inputs, the motion feel, backdrop plates, provenance (regenerate,
// reroll, pin) and the style distance with avoid.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  GENERATOR_V1, GENERATOR_VERSION, MIN_AVOID_DISTANCE, NEAR_DUPLICATE, deriveSeed, generateStyle, nearestStarter,
  paletteContrast, pinStyle, regenerateStyle, rerollStyle, styleDistance, styleDistanceReport, styleInputs, styleTraits
} from "@launchclip/core/style-seed.mjs";
import { brandFonts, brandRoles, normalizeBrand, svgColors } from "@launchclip/core/style-brand.mjs";
import { FEEL_EASES } from "@launchclip/core/style-feel.mjs";
import { easeOvershoot, grammarErrors, resolveGrammar } from "@launchclip/core/grammar.mjs";
import { DARK_PLATE_KINDS, plateErrors } from "@launchclip/core/plates.mjs";
import { FONT_REGISTRY } from "@launchclip/core/fonts.mjs";
import { applyStyle, contrastRatio, validateStylePack } from "@launchclip/core/style.mjs";
import { validateStory } from "@launchclip/core/story.mjs";

const STYLES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "kit", "styles");
const seedAt = (i) => (Math.imul(i + 1, 2654435761) >>> 0).toString(16).padStart(8, "0");
const BUNDLED = new Set(Object.values(FONT_REGISTRY).map((entry) => entry.slug));
const NORTHWIND = { name: "Northwind", colors: ["#0b3d91", "#f2a900", "#ffffff"], fonts: { display: "Montserrat", body: "Inter" }, tone: "friendly", industry: "coffee roasting", logo: { src: "assets/logo.svg" } };

test("brand inputs normalise: roles by alias, hex forms, logo SVG colours, tone words", () => {
  const brand = normalizeBrand({ colors: { Background: "#FFF", secondary: "0b3d91", extra: "#123456" }, logo: '<svg><path fill="#E4002B"/><path fill="#e4002b"/><circle stroke="rgb(0, 0, 0)"/></svg>', tone: "Warm, friendly", references: ["assets/a.jpg"] });
  assert.deepEqual(brand.colors, { roles: { bg: "#ffffff", accent: "#0b3d91" }, extra: ["#123456"] });
  assert.deepEqual(brand.logo, { colors: ["#e4002b", "#000000"] });
  assert.deepEqual(brand.tone_words, ["warm", "friendly"]);
  assert.deepEqual(brand.references, [{ src: "assets/a.jpg", colors: [] }]);
  assert.deepEqual(normalizeBrand(brand), brand, "a normalised brand normalises to itself");
  assert.deepEqual(svgColors('<svg fill="#abc"/>'), ["#aabbcc"]);
  assert.throws(() => normalizeBrand({ colors: ["#12345"] }), /hex colour/);
  assert.throws(() => normalizeBrand({ colour: "#123456" }), /not a brand input/);
  assert.throws(() => normalizeBrand({ colors: { primary: "#111111", brand: "#222222" } }), /primary twice/);
});

test("brand roles: given roles stay, then the first chromatic colour is primary and the next distinct hue accent", () => {
  assert.deepEqual(brandRoles(normalizeBrand({ colors: ["#ffffff", "#0b3d91", "#1d4ed8", "#f2a900"] })), { primary: "#0b3d91", accent: "#f2a900", bg: "#ffffff" });
  assert.deepEqual(brandRoles(normalizeBrand({ colors: { accent: "#ff3366" }, logo: { colors: ["#ffffff", "#00a676"] } })), { accent: "#ff3366", primary: "#00a676" }, "a logo's white is never bg");
});

test("brand fonts map to bundled OFL families and report each swap", () => {
  const { fonts, substituted } = brandFonts(normalizeBrand({ fonts: { display: "Montserrat", body: "Space Grotesk", meta: "Consolas" } }));
  assert.deepEqual(fonts, { display: "outfit", body: "space-grotesk", meta: "jetbrains-mono" });
  assert.deepEqual(substituted.map((entry) => entry.role), ["display", "meta"]);
});

test("a brand conditions the pack: its colours, fonts, tone, worlds and lockup, readable and valid", () => {
  const pack = generateStyle({ seed: "7f3a91c2", brand: NORTHWIND });
  assert.deepEqual(validateStylePack(pack).errors, []);
  assert.equal(pack.brand.colors.primary, "#0b3d91");
  assert.equal(pack.brand.colors.bg, "#ffffff");
  assert.notEqual(pack.brand.colors.accent, "#f2a900", "the yellow accent is darkened to read on white");
  assert.deepEqual(pack.generated.adjusted, [{ role: "accent", from: "#f2a900", to: pack.brand.colors.accent }]);
  assert.ok(contrastRatio(pack.brand.colors.accent, "#ffffff") >= 3);
  for (const entry of paletteContrast(pack.brand.colors)) assert.ok(entry.ok, `${entry.pair} ${entry.ratio}`);
  assert.equal(pack.brand.fonts.display, "outfit");
  assert.equal(pack.brand.fonts.body, "inter");
  assert.equal(pack.generated.tone, "warm");
  assert.ok(["cafe", "kitchen", "shopfronts"].includes(pack.world.kind), pack.world.kind);
  assert.equal(pack.brand_frame.enabled, true);
  assert.equal(pack.brand_frame.kicker.label, "Northwind");
  assert.equal(pack.brand_frame.logo, "assets/logo.svg");
  assert.deepEqual(pack.generated.inputs.brand, normalizeBrand(NORTHWIND));
  assert.deepEqual(generateStyle({ seed: "7f3a91c2", brand: NORTHWIND }), pack, "deterministic");
  // Two seeds for one brand keep the brand and vary the rest.
  const other = generateStyle({ seed: "00c0ffee", brand: NORTHWIND });
  assert.equal(other.brand.colors.primary, "#0b3d91");
  assert.ok(styleDistance(pack, other) > NEAR_DUPLICATE);
});

test("partial brands fill the rest from the seed: a primary only, a dark ground, fonts only", () => {
  for (let i = 0; i < 40; i += 1) {
    const seed = seedAt(i);
    for (const brand of [{ colors: { primary: "#e4002b" } }, { colors: { bg: "#101418", primary: "#7c3aed" } }, { fonts: ["Playfair Display", "DM Sans"] }, { logo: { colors: ["#00a676", "#ffffff"] } }]) {
      const pack = generateStyle({ seed, brand });
      assert.deepEqual(validateStylePack(pack).errors, [], `${seed} ${JSON.stringify(brand)}`);
      for (const entry of paletteContrast(pack.brand.colors)) assert.ok(entry.ok, `${seed} ${JSON.stringify(brand)} ${entry.pair}`);
      for (const role of ["display", "body", "meta"]) assert.ok(BUNDLED.has(pack.brand.fonts[role]), pack.brand.fonts[role]);
      if (brand.colors?.bg) assert.equal(pack.generated.theme, "dark");
    }
  }
});

test("the motion feel is slow-fast-slow with no overshoot, valid for the renderers", () => {
  for (let i = 0; i < 200; i += 1) {
    const pack = generateStyle({ seed: seedAt(i) });
    const grammar = pack.motion.grammar;
    assert.deepEqual(grammarErrors(grammar), [], pack.name);
    const resolved = resolveGrammar({ motion: { grammar } });
    for (const role of ["enter", "exit", "move", "camera", "emphasis"]) assert.equal(easeOvershoot(resolved.ease[role]), 0, `${pack.name} ${role} ${resolved.ease[role]}`);
    assert.equal(easeOvershoot(resolved.camera.whip), 0);
    assert.match(resolved.ease.camera, /\.inOut$/);
    assert.match(resolved.ease.move, /\.inOut$/);
    assert.equal(resolved.camera.anticipation, false);
    assert.ok(resolved.camera.moveBlur > 0, "blur at peak speed");
    assert.ok(resolved.duration.camera >= 0.45 && resolved.duration.camera <= 1.6);
    assert.ok(FEEL_EASES.includes(pack.motion.feel.ease));
    assert.ok([0, 2, 3, 4, 6].includes(pack.motion.feel.focus_zooms.every));
    if (pack.camera.mode === "world") assert.ok(pack.camera.spacing >= 0.08 && pack.camera.spacing <= 0.22);
  }
  // overshoot: true keeps the base grammar's own entrances and emphasis.
  const bouncy = generateStyle({ seed: seedAt(3), tone: "playful", constraints: { overshoot: true } });
  assert.equal(bouncy.motion.grammar.ease.enter, undefined);
  assert.equal(bouncy.motion.grammar.overshoot, undefined);
  // Tone narrows the feel: calm is slower than energetic on average.
  const tempo = (tone) => Array.from({ length: 30 }, (_, i) => generateStyle({ seed: seedAt(i), tone }).motion.feel.tempo).reduce((a, b) => a + b) / 30;
  assert.ok(tempo("calm") > tempo("energetic") + 0.2);
});

test("dark looks often travel over a cycling set of seeded backdrop plates; light looks never", () => {
  const packs = Array.from({ length: 200 }, (_, i) => generateStyle({ seed: seedAt(i) }));
  const plated = packs.filter((pack) => pack.plate);
  assert.ok(plated.length > 40);
  for (const pack of plated) {
    assert.deepEqual(plateErrors(pack.plate, "plate", { allowCycle: true }), [], pack.name);
    assert.ok(pack.plate.cycle.plates.length >= 2 && pack.plate.cycle.plates.length <= 4);
    assert.ok(pack.plate.cycle.plates.every((entry) => DARK_PLATE_KINDS.includes(entry.kind)));
    assert.ok(contrastRatio(pack.brand.colors.bg, "#000000") < contrastRatio(pack.brand.colors.bg, "#ffffff"), `${pack.name} is dark`);
  }
  assert.ok(new Set(plated.map((pack) => pack.plate.cycle.plates.map((entry) => entry.kind).join())).size > 30, "the sets vary");
});

test("a v2 pack applies to a story that validates, plate and camera included", () => {
  for (let i = 0; i < 30; i += 1) {
    const pack = generateStyle({ seed: seedAt(i) });
    const story = { schema: "launchclip.story.v1", lane: "motion", format: { width: 1920, height: 1080, fps: 30, duration: 4 }, scenes: [{ id: "a", module: "hook-title", start: 0, end: 4, params: { text: "Hello" } }] };
    const { story: out } = applyStyle(story, pack);
    assert.deepEqual(out.motion.grammar, pack.motion.grammar);
    if (pack.plate) assert.deepEqual(out.plate, pack.plate);
    const result = validateStory(out);
    assert.deepEqual(result.errors ?? [], [], pack.name);
  }
});

test("provenance regenerates a pack exactly; v1 packs still regenerate; stepping replaces a seed with no palette", () => {
  for (const input of [{ seed: "7f3a91c2" }, { seed: "7f3a91c2", brand: NORTHWIND, at: "2026-10-28T00:00:00Z" }, { seed: "0badf00d", tone: "premium", constraints: { theme: "dark" } }]) {
    const pack = generateStyle(input);
    assert.deepEqual(regenerateStyle(pack), pack);
    assert.equal(pack.generated.generator, GENERATOR_VERSION);
  }
  const v1 = generateStyle({ seed: "7f3a91c2", generator: GENERATOR_V1 });
  assert.equal(v1.motion.feel, undefined);
  assert.equal(typeof v1.motion.grammar, "string");
  assert.deepEqual(regenerateStyle(v1), v1);
  assert.throws(() => generateStyle({ seed: "42dd7c0f", generator: GENERATOR_V1 }), /no palette/);
  const stepped = generateStyle({ seed: "42dd7c0f" });
  assert.deepEqual(stepped.generated.stepped, { from: "42dd7c0f", steps: 1 });
  assert.equal(stepped.generated.seed, deriveSeed("42dd7c0f", 1));
  assert.deepEqual(regenerateStyle(stepped), stepped);
  assert.deepEqual(styleInputs(stepped).seed, stepped.generated.seed);
});

test("reroll gives a different look for the same brand; pin refuses it", () => {
  const pack = generateStyle({ seed: "7f3a91c2", brand: NORTHWIND });
  const next = rerollStyle(pack, { seed: "11111111" });
  assert.equal(next.brand.colors.primary, "#0b3d91");
  assert.ok(styleDistance(pack, next) >= MIN_AVOID_DISTANCE);
  assert.equal(next.generated.tone, "warm");
  const pinned = pinStyle(pack);
  assert.equal(pinned.generated.pinned, true);
  assert.deepEqual(validateStylePack(pinned).warnings, []);
  assert.throws(() => rerollStyle(pinned), /pinned/);
  assert.ok(rerollStyle(pinned, { seed: "22222222", force: true }));
  assert.equal(pinStyle(pinned, false).generated.pinned, undefined);
});

test("1,000 seeds give no near-duplicates", () => {
  const traits = Array.from({ length: 1000 }, (_, i) => styleTraits(generateStyle({ seed: seedAt(i) })));
  let closest = { distance: 1 };
  for (let i = 0; i < traits.length; i += 1) {
    for (let j = i + 1; j < traits.length; j += 1) {
      const distance = styleDistance(traits[i], traits[j]);
      if (distance < closest.distance) closest = { distance, i, j };
    }
  }
  assert.ok(closest.distance >= NEAR_DUPLICATE, `${seedAt(closest.i)} ~ ${seedAt(closest.j)} at ${closest.distance}`);
});

test("styles made with no seed and no inputs never look like a starter", async () => {
  const starters = await Promise.all((await readdir(STYLES)).filter((file) => file.endsWith(".json")).map(async (file) => JSON.parse(await readFile(path.join(STYLES, file), "utf8"))));
  assert.equal(starters.length, 6);
  const starterTraits = starters.map(styleTraits);
  for (let i = 0; i < 300; i += 1) {
    const pack = generateStyle();
    assert.equal(nearestStarter(pack).close, false, pack.name);
    for (const [k, starter] of starterTraits.entries()) assert.ok(styleDistance(pack, starter) >= NEAR_DUPLICATE, `${pack.name} ~ ${starters[k].name}`);
  }
});

test("styleDistance: zero to itself, symmetric, by part; avoid keeps the distance", () => {
  const a = generateStyle({ seed: "7f3a91c2" });
  const b = generateStyle({ seed: "0badf00d" });
  assert.equal(styleDistance(a, a), 0);
  assert.equal(styleDistance(a, b), styleDistance(b, a));
  const report = styleDistanceReport(a, b);
  assert.deepEqual(Object.keys(report.parts), ["palette", "type", "motion", "backdrops", "variants"]);
  for (const value of Object.values(report.parts)) assert.ok(value >= 0 && value <= 1);
  // A seed asked to avoid styles that sit at its own look steps away from them.
  const near = [a, generateStyle({ seed: "7f3a91c3" }), generateStyle({ seed: "7f3a91c4" })];
  const kept = generateStyle({ seed: "7f3a91c2", avoid: near });
  for (const other of near) assert.ok(styleDistance(kept, other) >= MIN_AVOID_DISTANCE, `${kept.name} vs ${other.name}`);
  assert.ok(kept.generated.stepped.steps >= 1);
  assert.equal(kept.generated.avoided.styles, 3);
  // A brand's own palette holds while everything else steps away.
  const brandA = generateStyle({ seed: "7f3a91c2", brand: NORTHWIND });
  const brandB = generateStyle({ seed: "7f3a91c2", brand: NORTHWIND, avoid: [brandA] });
  assert.equal(brandB.brand.colors.primary, "#0b3d91");
  assert.ok(styleDistance(brandA, brandB) >= MIN_AVOID_DISTANCE);
});

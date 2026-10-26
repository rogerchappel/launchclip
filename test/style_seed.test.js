// Seeded styles (docs/SEEDED_STYLES_RFC.md): the generator, its contrast and
// starter-distance checks, constraints and the new style v3 fields.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AVOID_LOOKS, FONT_PAIRINGS, SEED_BACKGROUND_PARAMS, SEED_WORLDS, GENERATOR_VERSION, MIN_PALETTE_DISTANCE, MIN_STARTER_DISTANCE, TONE_TABLE,
  fingerprintKey, generateStyle, hexToOklch, nearestStarter, normalizeSeed, oklchToHex, paletteContrast,
  randomSeed, seedSummaryLine, styleDistance, styleFingerprint, toneFromText
} from "../kit/core/style-seed.mjs";
import { applyStyle, checkPackContrast, contrastRatio, validateStylePack } from "../kit/core/style.mjs";
import { FONT_REGISTRY, registeredFamily } from "../kit/core/fonts.mjs";
import { seededRandom } from "../kit/core/ambient.mjs";

const STYLES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "kit", "styles");
const seeds = Array.from({ length: 50 }, (_, i) => (Math.imul(i + 7, 2654435761) >>> 0).toString(16).padStart(8, "0"));

test("50 seeds give 50 valid, readable, pairwise distinct packs", () => {
  const packs = seeds.map((seed) => generateStyle({ seed }));
  for (const pack of packs) {
    const validation = validateStylePack(pack);
    assert.deepEqual(validation.errors, [], pack.name);
    assert.deepEqual(validation.warnings, [], pack.name);
    for (const entry of paletteContrast(pack.brand.colors)) assert.ok(entry.ok, `${pack.name} ${entry.pair} ${entry.ratio} < ${entry.min}`);
    for (const entry of checkPackContrast(pack)) assert.ok(entry.ok, `${pack.name} ${entry.pair} ${entry.ratio}`);
    assert.equal(nearestStarter(pack).close, false, pack.name);
    assert.equal(pack.generated.generator, GENERATOR_VERSION);
  }
  const fingerprints = packs.map(styleFingerprint);
  assert.equal(new Set(fingerprints.map(fingerprintKey)).size, 50);
  for (let i = 0; i < fingerprints.length; i += 1) {
    for (let j = i + 1; j < fingerprints.length; j += 1) assert.ok(styleDistance(fingerprints[i], fingerprints[j]) > 0.02, `${packs[i].name} ~ ${packs[j].name}`);
  }
  // Subtle patterns and textures most of the time, not flat fills.
  assert.ok(packs.filter((pack) => pack.background.kind === "flat").length <= 8);
  assert.ok(packs.filter((pack) => pack.layouts.panel.fill).length >= 15);
  const inRange = (kind, params, where, { fill = false } = {}) => {
    for (const [name, [lo, hi]] of Object.entries(SEED_BACKGROUND_PARAMS[kind] ?? {})) {
      const top = fill && ["intensity", "amount"].includes(name) ? lo + (hi - lo) * 0.25 : hi;
      assert.ok(params[name] >= lo && params[name] <= top + 0.01, `${where} ${kind}.${name} ${params[name]}`);
    }
  };
  for (const pack of packs) {
    inRange(pack.background.kind, pack.background.params, pack.name);
    for (const surface of [pack.background, pack.layouts.panel.fill].filter(Boolean)) {
      if (["mesh", "texture"].includes(surface.kind)) assert.equal(surface.params.color, undefined, `${pack.name} ${surface.kind} takes no color`);
      if (surface.kind === "texture") assert.ok(["noise", "fibre", "canvas", "linen"].includes(surface.params.type));
    }
    if (pack.layouts.panel.fill) inRange(pack.layouts.panel.fill.kind, pack.layouts.panel.fill.params, pack.name, { fill: true });
    if (pack.layouts.panel.fill) assert.notEqual(pack.layouts.panel.fill.kind, "blobs");
    assert.equal(pack.ambient.background, pack.background.kind === "blobs");
    const { palette, music, ambience } = pack.sound;
    assert.ok(palette && music.genre && music.key && Number.isInteger(music.progression) && ambience, pack.name);
    assert.ok(music.bpm >= music.bpm_range[0] && music.bpm <= music.bpm_range[1]);
  }
  // With no world in the direction, a topic-neutral world, mostly by day or dusk.
  for (const pack of packs) assert.ok(SEED_WORLDS.includes(pack.world.kind), pack.name);
  assert.ok(packs.filter((pack) => pack.world.time === "night").length < packs.filter((pack) => pack.world.time !== "night").length);
  assert.ok(new Set(packs.map((pack) => pack.world.kind)).size >= 4);
  // The families spread: every theme, several grammars and pairings.
  assert.equal(new Set(packs.map((pack) => pack.generated.theme)).size, 3);
  assert.ok(new Set(packs.map((pack) => pack.motion.grammar)).size >= 5);
  assert.ok(new Set(packs.map((pack) => pack.generated.pairing)).size >= 10);
});

test("one seed always gives one pack; at only stamps the provenance", () => {
  const a = generateStyle({ seed: "7f3a91c2", tone: "warm" });
  const b = generateStyle({ seed: "7F3A91C2", tone: "warm" });
  assert.deepEqual(a, b);
  const stamped = generateStyle({ seed: "7f3a91c2", tone: "warm", at: "2026-10-26T00:00:00Z" });
  assert.equal(stamped.generated.at, "2026-10-26T00:00:00Z");
  assert.deepEqual({ ...stamped, generated: { ...stamped.generated, at: undefined } }, { ...a, generated: { ...a.generated, at: undefined } });
  assert.equal(a.name, "seed-7f3a91c2");
  assert.notDeepEqual(generateStyle({ seed: "7f3a91c3" }).brand, generateStyle({ seed: "7f3a91c2" }).brand);
});

test("tone narrows the families; the seed picks inside them", () => {
  for (const tone of Object.keys(TONE_TABLE)) {
    for (const seed of seeds.slice(0, 8)) {
      const pack = generateStyle({ seed, tone });
      assert.ok(TONE_TABLE[tone].grammars.includes(pack.motion.grammar), `${tone}: ${pack.motion.grammar}`);
      assert.ok(TONE_TABLE[tone].themes.includes(pack.generated.theme), `${tone}: ${pack.generated.theme}`);
      assert.ok(FONT_PAIRINGS.find((entry) => entry.id === pack.generated.pairing).tones.includes(tone));
      assert.equal(pack.generated.tone, tone);
      for (const [dial, centre] of Object.entries(TONE_TABLE[tone].dials)) assert.ok(Math.abs(pack.dials[dial] - centre) <= 0.121, `${tone} ${dial}`);
    }
  }
  assert.equal(toneFromText("A playful explainer for kids"), "playful");
  assert.equal(toneFromText("Launch video for our new CLI"), "energetic");
  assert.equal(toneFromText("A security explainer"), "serious");
  assert.equal(toneFromText("A video about tables"), null);
});

test("constraints pass through to the fields the kits read", () => {
  const pack = generateStyle({
    seed: "0badc0de",
    constraints: { tone: "warm", theme: "light", world: "kitchen", drawing_style: "flat", character_set: "chefs", background: "grain-gradient", panel: { treatment: "outline", radius: 12 } }
  });
  assert.equal(pack.generated.theme, "light");
  assert.ok(hexToOklch(pack.brand.colors.bg).l > 0.9);
  assert.equal(pack.world.kind, "kitchen");
  assert.ok(["day", "dusk", "night"].includes(pack.world.time));
  assert.equal(pack.cast.set, "chefs");
  assert.equal(pack.cast.drawing_style, "flat");
  assert.equal(pack.background.kind, "grain-gradient");
  assert.ok(["none", "center", "top", "bottom", "left", "right"].includes(pack.background.params.fade));
  assert.equal(pack.layouts.panel.treatment, "outline");
  assert.equal(pack.layouts.panel.radius, 12);
  assert.deepEqual(pack.generated.constraints, { tone: "warm", theme: "light", world: "kitchen", drawing_style: "flat", character_set: "chefs", background: "grain-gradient", panel: { treatment: "outline", radius: 12 } });
  assert.equal(validateStylePack(pack).ok, true);
  // Pinning one dimension never reshuffles another: each draws its own stream.
  const free = generateStyle({ seed: "0badc0de", tone: "warm" });
  const pinned = generateStyle({ seed: "0badc0de", tone: "warm", constraints: { panel: "outline", background: "mesh", world: "park" } });
  for (const key of ["brand", "motion", "captions", "dials", "vocabulary", "sound"]) assert.deepEqual(pinned[key], free[key], key);
  assert.deepEqual(pinned.cast, free.cast);
  // A world list (suggestWorld's fits) is a constraint the seed picks within.
  const fits = ["kitchen", "cafe", "home-desk"];
  const picked = new Set(seeds.slice(0, 12).map((seed) => generateStyle({ seed, constraints: { world: fits } }).world.kind));
  for (const kind of picked) assert.ok(fits.includes(kind), kind);
  assert.ok(picked.size >= 2);
  assert.throws(() => generateStyle({ seed: "0badc0de", constraints: { world: "atlantis" } }), /world must be one of/);
  assert.throws(() => generateStyle({ seed: "0badc0de", constraints: { character_set: "pirates" } }), /character_set must be one of/);
  assert.equal(pinned.layouts.panel.radius, free.layouts.panel.radius);
  assert.throws(() => generateStyle({ seed: "0badc0de", tone: "grumpy" }), /tone must be one of/);
  assert.throws(() => generateStyle({ seed: "0badc0de", constraints: { theme: "sepia" } }), /theme must be one of/);
});

test("seeds normalise and summaries read as one line", () => {
  assert.equal(normalizeSeed("0x7F3A91C2"), "7f3a91c2");
  assert.equal(normalizeSeed("seed-7f3a91c2"), "7f3a91c2");
  assert.equal(normalizeSeed(255), "000000ff");
  assert.throws(() => normalizeSeed("xyz"), /8 hex characters/);
  assert.match(randomSeed(), /^[0-9a-f]{8}$/);
  assert.equal(randomSeed(() => 0.5), "80000000");
  const pack = generateStyle({ seed: "7f3a91c2" });
  assert.match(seedSummaryLine(pack), /^style: seed 7f3a91c2 \((dark|light|tinted), [a-z]+, [A-Za-z ]+ \/ [A-Za-z ]+\)\. Reroll with launchclip style reroll$/);
});

test("OKLCH round-trips and gamut-maps by chroma", () => {
  for (const hex of ["#ff3d7f", "#0b0b0f", "#f4f5f7", "#2257e8", "#19f0ff"]) {
    assert.equal(oklchToHex(hexToOklch(hex)), hex);
  }
  const wild = oklchToHex({ l: 0.7, c: 0.5, h: 140 });
  assert.match(wild, /^#[0-9a-f]{6}$/);
  assert.ok(Math.abs(hexToOklch(wild).l - 0.7) < 0.01);
});

test("the starter table matches kit/styles, and starters read as close to themselves", async () => {
  const files = (await readdir(STYLES)).filter((file) => file.endsWith(".json")).sort();
  const starters = await Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(STYLES, file), "utf8"))));
  for (const pack of starters) {
    const look = AVOID_LOOKS.find((entry) => entry.name === pack.name);
    assert.ok(look, `${pack.name} is missing from AVOID_LOOKS`);
    assert.deepEqual(look.colors, pack.brand.colors, pack.name);
    assert.deepEqual(look.fonts, { display: pack.brand.fonts.display, body: pack.brand.fonts.body }, pack.name);
    assert.equal(look.panel, pack.layouts.panel.treatment, pack.name);
    assert.equal(look.grammar, pack.motion.grammar, pack.name);
    assert.equal(look.caption, pack.captions.preset, pack.name);
    const nearest = nearestStarter(pack);
    assert.equal(nearest.name, pack.name);
    assert.equal(nearest.distance, 0);
    assert.equal(nearest.close, true);
  }
  assert.ok(MIN_STARTER_DISTANCE > 0 && MIN_PALETTE_DISTANCE > 0);
});

test("every pairing names bundled families", () => {
  const ids = new Set();
  for (const pairing of FONT_PAIRINGS) {
    assert.ok(!ids.has(pairing.id), pairing.id);
    ids.add(pairing.id);
    for (const role of ["display", "body", "meta"]) assert.ok(FONT_REGISTRY[registeredFamily(pairing[role])], `${pairing.id} ${role} ${pairing[role]}`);
    assert.ok(["upper", "title"].includes(pairing.case));
    assert.ok(pairing.tones.length > 0);
  }
  for (const tone of Object.keys(TONE_TABLE)) assert.ok(FONT_PAIRINGS.filter((entry) => entry.tones.includes(tone)).length >= 3, tone);
});

test("validation accepts the seeded fields and rejects bad shapes", () => {
  const base = { schema: "launchclip.style.v3", name: "x", brand: { colors: { bg: "#101010", paper: "#fafafa" } } };
  const good = validateStylePack({
    ...base,
    generated: { seed: "7f3a91c2", generator: GENERATOR_VERSION, tone: "warm", at: "2026-10-26T00:00:00Z" },
    layouts: { panel: { treatment: "soft-shadow", radius: 18, fill: { kind: "texture", params: { fade: "top" } } } },
    background: { kind: "grain-gradient", params: { angle: 30, fade: "center" } },
    sound: { palette: "cinematic", music: { genre: "synthwave", bpm: 96, key: "F#", progression: 2, bpm_range: [90, 110] }, ambience: "auto", sfx_density: 0.4 },
    vocabulary: { icon_stroke: 1.75, icon_style: "duotone", illustration: "flat-shadow" },
    variants: { "concept-card": "stacked" },
    cast: { drawing_style: "flat", set: "office-team", members: [{ id: "ada", skin: "tan", hair: { style: "bob", color: "black" } }] },
    world: { kind: "kitchen", time: "dusk" }
  });
  assert.deepEqual(good, { ok: true, errors: [], warnings: [] });
  const bad = validateStylePack({
    ...base,
    generated: { seed: "nope", tone: 3, at: "yesterday", extra: 1 },
    layouts: { panel: { treatment: "chrome", fill: { kind: "blobs" }, glow: 1 } },
    background: { kind: "Plaid!", params: 2, angle: 3 },
    sound: { palette: "Loud!", music: { bpm: 0, key: "H", progression: -1 }, ambience: "", sfx_density: "loud" },
    vocabulary: { icon_stroke: 9, icon_style: "filled", illustration: "watercolour" },
    variants: { "concept-card": "" },
    cast: { set: "Office Team", members: [{ id: "ada" }] },
    world: { kind: "", time: "noon" }
  });
  const text = bad.errors.join("\n");
  for (const pattern of [/generated\.seed/, /generated\.generator/, /generated\.tone/, /generated\.at/, /layouts\.panel\.treatment/, /layouts\.panel\.fill/, /layouts\.panel\.glow/, /sound\.palette/, /sound\.music\.bpm/, /sound\.music\.key/, /sound\.music\.progression/, /sound\.ambience/, /sound\.sfx_density/, /background\.kind/, /vocabulary\.icon_stroke/, /vocabulary\.icon_style/, /vocabulary\.illustration/, /variants\.concept-card/, /cast\.set/, /cast\.members\[0\]/, /world\.kind/, /world\.time/]) assert.match(text, pattern);
  assert.match(bad.warnings.join("\n"), /generated\.extra/);
  // The backgrounds kit's own check: unknown kinds, params and keys are errors.
  assert.match(validateStylePack({ ...base, background: { kind: "plaid" } }).errors.join("\n"), /background\.kind must be one of/);
  const params = validateStylePack({ ...base, background: { kind: "mesh", params: { color: "accent", intensity: 3 }, angle: 3 } }).errors.join("\n");
  for (const pattern of [/background\.params\.color is not supported for mesh/, /background\.params\.intensity must be a number/, /background\.angle is not supported/]) assert.match(params, pattern);
  assert.match(validateStylePack({ ...base, layouts: { panel: { treatment: "solid", radius: 80 } } }).warnings.join("\n"), /at most 48 px/);
  assert.match(validateStylePack({ ...base, background: { kind: "blobs", params: { fade: "top" } } }).errors.join("\n"), /fade/);
  assert.equal(contrastRatio("#000000", "#ffffff") > 20, true);
});

test("applyStyle hands the seeded fields to the story; the story's own values win", () => {
  const pack = generateStyle({ seed: "7f3a91c2", constraints: { world: "kitchen" } });
  const story = { schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 4 }, scenes: [], variants: { "concept-card": "stacked" } };
  const { story: out, applied } = applyStyle(story, pack);
  assert.deepEqual(out.background, pack.background);
  assert.deepEqual(out.panel, pack.layouts.panel);
  assert.deepEqual(out.world, pack.world);
  assert.equal(out.variants["concept-card"], "stacked");
  assert.equal(out.variants["icon-row"], pack.variants["icon-row"]);
  for (const key of ["background", "panel", "world", "variants.icon-row"]) assert.ok(applied.includes(key), key);
  assert.deepEqual(out.cast, { style: pack.cast.drawing_style, characters: pack.cast.members });
  assert.ok(applied.includes("cast"));
  const listed = applyStyle({ ...story, cast: { characters: [{ id: "maya" }] } }, pack).story;
  assert.deepEqual(listed.cast, { characters: [{ id: "maya" }], style: pack.cast.drawing_style }, "a story's own people stay; only the drawing style fills");
  assert.equal(applyStyle({ ...story, panel: undefined }, { ...pack, layouts: { panel: { treatment: "solid", radius: 80 } } }).story.panel.radius, 48);
  const own = applyStyle({ ...story, background: { kind: "flat" }, panel: { treatment: "solid" } }, pack).story;
  assert.deepEqual(own.background, { kind: "flat" });
  assert.deepEqual(own.panel, { treatment: "solid" });
});

test("seed runs cover every option of every dimension: 50 from 0, or any 100 in a row", async () => {
  const { WORLD_KINDS } = await import("../kit/core/worlds/index.mjs");
  const { SEED_AMBIENCE, SEED_CHARACTER_SETS, SEED_DRAWING_STYLES, SEED_ICON_STYLES, SEED_ILLUSTRATIONS, SEED_MODULE_VARIANTS, SEED_MUSIC_GENRES, SEED_PANEL_TREATMENTS, SEED_SOUND_PALETTES, SEED_BACKGROUND_KINDS, THEMES, PALETTE_SCHEMES } = await import("../kit/core/style-seed.mjs");
  // Each dimension of n options shuffles its options afresh in every block
  // of n seeds, so a run holding a whole block (50 seeds from 0, any 100 in a
  // row, for n up to 50) sees every option.
  for (const [base, length] of [[0, 50], [0x5eed0007, 100], [0xfffffe13, 100]]) {
    const run = Array.from({ length }, (_, i) => ((base + i) >>> 0).toString(16).padStart(8, "0"));
    const packs = run.map((seed) => generateStyle({ seed }));
    const names = (list) => list.map((entry) => (Array.isArray(entry) ? entry[0] : entry));
    const dimensions = {
      theme: [(p) => p.generated.theme, THEMES],
      scheme: [(p) => p.generated.scheme, PALETTE_SCHEMES],
      pairing: [(p) => p.generated.pairing, FONT_PAIRINGS.map((entry) => entry.id)],
      grammar: [(p) => p.motion.grammar, ["editorial", "snappy", "smooth", "playful", "documentary", "cinematic"]],
      panel: [(p) => p.layouts.panel.treatment, SEED_PANEL_TREATMENTS],
      background: [(p) => p.background.kind, names(SEED_BACKGROUND_KINDS)],
      "ambient level": [(p) => p.ambient.level, ["off", "subtle", "standard", "lively"]],
      "icon style": [(p) => p.vocabulary.icon_style, SEED_ICON_STYLES],
      illustration: [(p) => p.vocabulary.illustration, SEED_ILLUSTRATIONS],
      "drawing style": [(p) => p.cast.drawing_style, SEED_DRAWING_STYLES],
      "character set": [(p) => p.cast.set, names(SEED_CHARACTER_SETS)],
      world: [(p) => p.world.kind, SEED_WORLDS],
      "world time": [(p) => p.world.time, ["day", "dusk", "night"]],
      "sound palette": [(p) => p.sound.palette, SEED_SOUND_PALETTES],
      genre: [(p) => p.sound.music.genre, SEED_MUSIC_GENRES],
      ambience: [(p) => p.sound.ambience, names(SEED_AMBIENCE)]
    };
    for (const [id, list] of Object.entries(SEED_MODULE_VARIANTS)) dimensions[`variant ${id}`] = [(p) => p.variants[id], list];
    for (const [dimension, [get, options]] of Object.entries(dimensions)) {
      const seen = new Set(packs.map(get));
      assert.deepEqual(options.filter((option) => !seen.has(option)), [], `${dimension} from ${run[0]}`);
    }
    // With a topic, the fitting worlds; across every world, every one is drawn.
    const everywhere = new Set(run.map((seed) => generateStyle({ seed, constraints: { world: [...WORLD_KINDS] } }).world.kind));
    assert.deepEqual(WORLD_KINDS.filter((kind) => !everywhere.has(kind)), [], `every world from ${run[0]}`);
  }
  // The catalogue's modules with designed variants, catalogue H included, are all drawn.
  const { moduleVariants } = await import("../kit/core/modules.mjs");
  assert.deepEqual(Object.keys(SEED_MODULE_VARIANTS).sort(), Object.keys(moduleVariants()).sort());
});

test("no two dimensions move in lockstep: random seeds reach their combinations", async () => {
  const { SEED_MODULE_VARIANTS, randomSeed } = await import("../kit/core/style-seed.mjs");
  const random = seededRandom(0x5eed);
  const N = 600;
  const packs = Array.from({ length: N }, () => generateStyle({ seed: randomSeed(random) }));
  const dimensions = {
    theme: (p) => p.generated.theme, scheme: (p) => p.generated.scheme, pairing: (p) => p.generated.pairing, grammar: (p) => p.motion.grammar,
    panel: (p) => p.layouts.panel.treatment, background: (p) => p.background.kind, "icon style": (p) => p.vocabulary.icon_style,
    illustration: (p) => p.vocabulary.illustration, "drawing style": (p) => p.cast.drawing_style, "character set": (p) => p.cast.set,
    world: (p) => p.world.kind, "world time": (p) => p.world.time, "sound palette": (p) => p.sound.palette, genre: (p) => p.sound.music.genre,
    ambience: (p) => p.sound.ambience
  };
  for (const id of Object.keys(SEED_MODULE_VARIANTS)) dimensions[`variant ${id}`] = (p) => p.variants[id];
  const values = Object.fromEntries(Object.entries(dimensions).map(([name, get]) => [name, packs.map(get)]));
  const shares = (list) => { const counts = new Map(); for (const value of list) counts.set(value, (counts.get(value) ?? 0) + 1); return [...counts.values()].map((count) => count / N); };
  const names = Object.keys(dimensions);
  // Observed combinations against what independent choices with the same
  // marginals would show in N draws: a locked pair reaches about max(n, m).
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = values[names[i]], b = values[names[j]];
      const seen = new Set(a.map((value, k) => `${value}|${b[k]}`)).size;
      let expected = 0;
      for (const x of shares(a)) for (const y of shares(b)) expected += 1 - (1 - x * y) ** N;
      assert.ok(seen >= 0.85 * expected, `${names[i]} × ${names[j]}: ${seen} combinations, ${Math.round(expected)} expected`);
    }
  }
});

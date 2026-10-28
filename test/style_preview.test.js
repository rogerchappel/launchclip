// Style preview reels and the brand-style CLI: launchclip style generate
// (brand flags, --avoid) | reroll | pin | preview | distance
// (docs/SEEDED_STYLES_RFC.md §3.7–3.10).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { NEAR_DUPLICATE, generateStyle } from "@launchclip/core/style-seed.mjs";
import { PREVIEW_ASPECTS, stylePreviewStory } from "@launchclip/core/style-preview.mjs";
import { applyStyle } from "@launchclip/core/style.mjs";
import { resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { runCli } from "../src/cli.js";
import { brandFlags, generateProjectStyle, styleGenerateCommand } from "../src/style_seed_store.js";
import { renderStylePreview } from "../src/style_preview.js";

const seedAt = (i) => (Math.imul(i + 1, 2654435761) >>> 0).toString(16).padStart(8, "0");
const tmp = (name) => mkdtemp(path.join(os.tmpdir(), `launchclip-${name}-`));

async function cli(argv) {
  const out = [];
  await runCli(argv, { stdout: { write: (value) => out.push(value) }, stderr: { write: () => {} } });
  return JSON.parse(out.join(""));
}

const plateOf = (scene) => JSON.stringify(scene.backdrop ?? null);

test("the preview story: a title, a chart entered by a camera move, a card on a new backdrop, an end card", () => {
  const pack = generateStyle({ seed: "7f3a91c2", brand: { name: "Northwind", colors: ["#0b3d91"] } });
  const story = stylePreviewStory(pack);
  assert.equal(story.style, pack.name);
  assert.equal(story.format.duration, 10);
  assert.deepEqual(story.scenes.map((scene) => scene.module), ["hook-title", "bar-chart", "concept-card", "cta"]);
  assert.equal(story.scenes[0].params.eyebrow, "Northwind");
  assert.ok(story.scenes[1].in?.type, "the chart enters with a move");
  assert.notEqual(plateOf(story.scenes[1]), plateOf(story.scenes[2]), "the backdrop changes at the card");
  assert.equal(story.brand, undefined, "the look comes from the style alone");
  assert.throws(() => stylePreviewStory(pack, { duration: 20 }), /8 to 12/);
  assert.throws(() => stylePreviewStory(pack, { aspect: "4:3" }), /aspect/);
});

test("every seed's preview validates and resolves at every aspect and length", () => {
  for (let i = 0; i < 60; i += 1) {
    const pack = generateStyle({ seed: seedAt(i) });
    for (const aspect of Object.keys(PREVIEW_ASPECTS)) {
      for (const duration of [8, 10, 12]) {
        const { story } = applyStyle(stylePreviewStory(pack, { aspect, duration }), pack);
        const result = validateStory(story);
        assert.deepEqual(result.errors, [], `${pack.name} ${aspect} ${duration}`);
        const resolved = resolveStory(story, {});
        for (const scene of resolved.scenes) resolveModule(scene, resolved);
        if (pack.plate) assert.ok(story.scenes.every((scene) => scene.backdrop), "dark looks sit on their plates");
        if (story.scenes[1].zooms) assert.ok(pack.motion.feel.focus_zooms.every > 0);
      }
    }
  }
});

test("renderStylePreview stages a style project, compiles and renders it", async () => {
  const dir = await tmp("preview");
  try {
    const pack = generateStyle({ seed: "0badf00d" });
    const calls = [];
    const result = await renderStylePreview(pack, { out: path.join(dir, "look.mp4"), renderer: "remotion", aspect: "9:16" }, {
      compile: async (name, project) => { calls.push(["compile", name, project]); return { warnings: [] }; },
      render: async (name, project, file, options) => { calls.push(["render", name, file, options.quality]); }
    });
    assert.equal(result.status, "rendered");
    assert.equal(result.video, path.join(dir, "look.mp4"));
    const staged = JSON.parse(await readFile(path.join(result.project, ".launchclip", "styles", pack.name, "style.json"), "utf8"));
    assert.deepEqual(staged, pack);
    const story = JSON.parse(await readFile(path.join(result.project, "storyboard.json"), "utf8"));
    assert.equal(story.format.width, 1080);
    assert.deepEqual(calls.map((call) => call.slice(0, 2)), [["compile", "remotion"], ["render", "remotion"]]);
    await assert.rejects(renderStylePreview(pack, { out: path.join(dir, "x.mp4"), renderer: "flash" }), /renderer/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("brand flags: colours with roles, fonts, tone words, an SVG logo read from its markup, a raster still extracted", async () => {
  const dir = await tmp("brand-flags");
  try {
    await writeFile(path.join(dir, "logo.svg"), '<svg><rect fill="#E4002B"/></svg>');
    await writeFile(path.join(dir, "brand.json"), JSON.stringify({ name: "Base", industry: "bakery" }));
    const brand = await brandFlags({ brand: "brand.json", name: "Northwind", colors: "#0b3d91,accent=#f2a900", fonts: "Montserrat,Inter", "brand-tone": "warm, friendly", logo: "logo.svg", reference: ["shop.jpg"] }, { cwd: dir, colors: async () => ["#3b2a20"] });
    assert.equal(brand.name, "Northwind");
    assert.equal(brand.industry, "bakery");
    assert.deepEqual(brand.colors, ["#0b3d91", { role: "accent", hex: "#f2a900" }]);
    assert.deepEqual(brand.fonts, ["Montserrat", "Inter"]);
    assert.equal(brand.logo.src, "logo.svg");
    assert.match(brand.logo.svg, /E4002B/);
    assert.deepEqual(brand.references, [{ src: "shop.jpg", colors: ["#3b2a20"] }]);
    assert.equal(await brandFlags({}, { cwd: dir }), undefined);
    const result = await styleGenerateCommand({ seed: "7f3a91c2", name: "Northwind", colors: "primary=#0b3d91,bg=#ffffff,#f2a900", fonts: "Montserrat,Inter" }, { cwd: dir, clock: () => "2026-10-28T00:00:00Z" });
    assert.equal(result.pack.brand.colors.primary, "#0b3d91");
    assert.ok(result.adjusted.some((entry) => entry.role === "accent"));
    assert.ok(result.substituted.some((entry) => entry.from === "Montserrat"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI: generate with --avoid, distance between styles, pin blocks reroll, reroll keeps the brand", async () => {
  const dir = await tmp("brand-cli");
  try {
    const first = await cli(["style", "generate", "--seed", "7f3a91c2", "--name", "Northwind", "--colors", "#0b3d91", "--out", path.join(dir, "a")]);
    const second = await cli(["style", "generate", "--seed", "7f3a91c2", "--name", "Northwind", "--colors", "#0b3d91", "--avoid", path.join(dir, "a", "style.json"), "--out", path.join(dir, "b")]);
    assert.notEqual(second.seed, first.seed);
    const distance = await cli(["style", "distance", path.join(dir, "a", "style.json"), path.join(dir, "b", "style.json")]);
    assert.equal(distance.pairs.length, 1);
    assert.ok(distance.pairs[0].distance >= NEAR_DUPLICATE);
    assert.equal(distance.status, "distinct");
    assert.deepEqual(Object.keys(distance.pairs[0].parts), ["palette", "type", "motion", "backdrops", "variants"]);
    const same = await cli(["style", "distance", path.join(dir, "a", "style.json"), path.join(dir, "a", "style.json")]);
    assert.equal(same.status, "near-duplicate");

    const project = path.join(dir, "project");
    const made = await generateProjectStyle(project, { seed: "0badf00d", brand: { name: "Northwind", colors: { primary: "#0b3d91" } } });
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify({ schema: "launchclip.story.v1", style: made.name, scenes: [] }));
    const pinned = await cli(["style", "pin", project]);
    assert.equal(pinned.pinned, true);
    await assert.rejects(cli(["style", "reroll", project, "--seed", "11111111"]), /pinned/);
    assert.equal((await cli(["style", "pin", project, "--off"])).pinned, false);
    const rerolled = await cli(["style", "reroll", project, "--seed", "11111111"]);
    const next = JSON.parse(await readFile(path.join(project, ".launchclip", "styles", rerolled.name, "style.json"), "utf8"));
    assert.equal(next.brand.colors.primary, "#0b3d91");
    assert.equal(next.brand_frame.kicker.label, "Northwind");
    assert.ok(existsSync(path.join(project, ".launchclip", "styles", made.name, "style.json")), "the old look stays for --undo");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

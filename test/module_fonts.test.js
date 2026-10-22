import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { EDITORIAL_STYLE } from "../kit/core/editorial-core.mjs";
import { CATALOG_B_STYLE } from "../kit/core/catalog-b.mjs";
import { moduleFontFaces } from "../kit/core/fonts.mjs";
import { resolveStory } from "../kit/core/story.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

// Regression (npm run eval:renderers): editorial modules and the archive-card
// quote named system font stacks. HyperFrames substitutes bundled faces for
// system families while Remotion's Chrome uses the host's, so module text was
// ~10% wider in HyperFrames and the archive quote wrapped on different words
// (SSIM 0.964). Both now draw faces both compilers load from the same files.
test("editorial modules draw the story's brand stacks", () => {
  assert.match(EDITORIAL_STYLE.font.sans, /^var\(--lc-font-body, /);
  assert.match(EDITORIAL_STYLE.font.mono, /^var\(--lc-font-meta, /);
  assert.match(EDITORIAL_STYLE.font.display, /^var\(--lc-font-body, /);
});

test("archive-card's serif loads in both renderers, normal and italic", async () => {
  assert.match(CATALOG_B_STYLE.serif, /^'EB Garamond',/);
  assert.deepEqual(moduleFontFaces({ scenes: [{ module: "metric" }] }), []);
  assert.deepEqual(moduleFontFaces({ scenes: [{ module: "archive-card" }, { module: "archive-card" }] }), [{ family: "EB Garamond", styles: ["normal", "italic"] }]);

  const dir = path.join(ROOT, "examples", "story", "explainer-9x16");
  const story = JSON.parse(await readFile(path.join(dir, "storyboard.json"), "utf8"));
  const narration = JSON.parse(await readFile(path.join(dir, "NARRATION.json"), "utf8"));
  const { html } = await compileStoryToHyperFrames(resolveStory(story, { words: narration.words }), { sourceDir: dir, write: false });
  assert.match(html, /@font-face \{ font-family: 'EB Garamond'; src: url\("https:\/\/fonts\.gstatic\.com\/[^"]+"\) format\("woff2"\); font-weight: 400; font-style: italic;/);
  assert.match(html, /@font-face \{ font-family: 'EB Garamond'; [^}]*font-style: normal;/);

  const composition = await readFile(path.join(ROOT, "kit", "remotion", "StoryComposition.tsx"), "utf8");
  assert.match(composition, /ensureModuleFonts\(story\);/);
  const fonts = await readFile(path.join(ROOT, "kit", "remotion", "fonts.ts"), "utf8");
  assert.match(fonts, /module\.loadFont\(style, /);
});

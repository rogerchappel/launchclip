import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { EDITORIAL_STYLE } from "@launchclip/core/editorial-core.mjs";
import { CATALOG_B_STYLE } from "@launchclip/core/catalog-b.mjs";
import { fontFaceRule, fontStack, projectFontFamilies, registryFontFaces } from "@launchclip/core/fonts.mjs";
import { resolveStory } from "@launchclip/core/story.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

// Regression (npm run eval:renderers): editorial modules and the archive-card
// quote named system font stacks. HyperFrames substitutes bundled faces for
// system families while Remotion's Chrome uses the host's, so module text was
// ~10% wider in HyperFrames and the archive quote wrapped on different words
// (SSIM 0.964). Both now draw bundled registry faces (kit/core/fonts.mjs) that
// both renderers load from the same local files.
test("editorial modules draw the story's brand stacks over the bundled registry stacks", () => {
  assert.equal(EDITORIAL_STYLE.font.sans, `var(--lc-font-body, ${fontStack(null, "body")})`);
  assert.equal(EDITORIAL_STYLE.font.mono, `var(--lc-font-meta, ${fontStack(null, "meta")})`);
  assert.equal(EDITORIAL_STYLE.font.display, `var(--lc-font-body, ${fontStack(null, "body")})`);
  for (const stack of Object.values(EDITORIAL_STYLE.font)) assert.doesNotMatch(stack, /system-ui|-apple-system|ui-monospace|Segoe/);
});

test("archive-card's serif is a bundled face, loaded normal and italic in both renderers", async () => {
  assert.equal(CATALOG_B_STYLE.serif, fontStack(null, "serif"));
  assert.match(CATALOG_B_STYLE.serif, /^'Instrument Serif',/);
  assert.ok(projectFontFamilies({}).includes("Instrument Serif"), "every project loads the quote serif");

  const dir = path.join(ROOT, "examples", "story", "explainer-9x16");
  const story = JSON.parse(await readFile(path.join(dir, "storyboard.json"), "utf8"));
  const narration = JSON.parse(await readFile(path.join(dir, "NARRATION.json"), "utf8"));
  const { html } = await compileStoryToHyperFrames(resolveStory(story, { words: narration.words }), { sourceDir: dir, write: false });
  for (const face of registryFontFaces(["Instrument Serif"])) assert.ok(html.includes(fontFaceRule(face, `fonts/${face.file}`)), `${face.style} face is declared from a local file`);
  assert.doesNotMatch(html, /fonts\.gstatic\.com|fonts\.googleapis\.com/);

  const composition = await readFile(path.join(ROOT, "kit", "remotion", "StoryComposition.tsx"), "utf8");
  assert.match(composition, /ensureFonts\(story\.brand\);/);
});

// kit/remotion/fonts.ts imports exactly the registry's files (kit/core/fonts.mjs),
// so the Remotion bundle carries the same faces the HyperFrames compiler copies.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allFontFaces } from "../kit/core/fonts.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const source = readFileSync(path.join(ROOT, "kit/remotion/fonts.ts"), "utf8");

test("fonts.ts imports every registry face and nothing else", () => {
  const imports = new Map([...source.matchAll(/^import (\w+) from "([^"]+\.woff2)";$/gm)].map((match) => [match[1], match[2]]));
  const entries = new Map([...source.matchAll(/^ {2}"([^"]+\.woff2)": (\w+),?$/gm)].map((match) => [match[1], match[2]]));
  const faces = allFontFaces();
  assert.deepEqual([...imports.values()].sort(), faces.map((face) => face.module).sort());
  assert.deepEqual([...entries.keys()].sort(), faces.map((face) => face.file).sort());
  for (const face of faces) assert.equal(imports.get(entries.get(face.file)), face.module, `${face.file} maps to its own import`);
});

test("fonts.ts loads through the registry, FontFace and delayRender, never Google Fonts", () => {
  assert.doesNotMatch(source, /google-fonts|fonts\.googleapis|fonts\.gstatic/);
  assert.match(source, /projectFontFamilies\(brand\)/);
  assert.match(source, /frozenFontFaces\(family, local\)/);
  assert.match(source, /new FontFace\(/);
  assert.match(source, /delayRender\(/);
  assert.match(source, /continueRender\(handle\)/);
  assert.match(source, /document\.fonts\.ready/);
  assert.match(source, /staticFile\(`assets\/fonts\/\$\{face\.file\}`\)/);
});

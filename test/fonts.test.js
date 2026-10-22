// The font registry (kit/core/fonts.mjs): pinned packages, real files, stacks
// that only name bundled families, and the licence record.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FONT_REGISTRY, FONT_ROLE_DEFAULTS, SYMBOL_FALLBACK, allFontFaces, brandFontStacks, fontFaceRule, fontFamilyName,
  fontStack, fontWidthScale, frozenFontFaces, projectFontFamilies, registeredFamily, registryFontFaces
} from "../kit/core/fonts.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

test("every registered face is a pinned dependency file on disk", () => {
  for (const item of Object.values(FONT_REGISTRY)) {
    assert.equal(pkg.dependencies[item.package], item.version, `${item.package} is pinned to ${item.version} in package.json`);
    assert.equal(require(`${item.package}/package.json`).license, item.license);
    for (const face of item.faces) {
      const file = require.resolve(`${item.package}/files/${face.file}`);
      assert.ok(statSync(file).size > 10_000, `${face.file} is a real font file`);
      assert.match(face.weight, /^[1-9]00( [1-9]00)?$/);
      assert.ok(["normal", "italic"].includes(face.style));
    }
  }
  assert.equal(allFontFaces().length, Object.values(FONT_REGISTRY).reduce((sum, item) => sum + item.faces.length, 0));
});

test("the RFC families, the maths serif and the editorial defaults are registered", () => {
  for (const family of ["Anton", "Space Grotesk", "JetBrains Mono", "Unbounded", "Inter", "Syne", "Bricolage Grotesque", "Archivo Black", "Instrument Serif", "STIX Two Text", "STIX Two Math"]) {
    assert.ok(FONT_REGISTRY[family], family);
  }
  for (const family of [...Object.values(FONT_ROLE_DEFAULTS), SYMBOL_FALLBACK]) assert.ok(FONT_REGISTRY[family], family);
});

test("slugs and spellings resolve to the canonical registered family", () => {
  assert.equal(registeredFamily("jetbrains-mono"), "JetBrains Mono");
  assert.equal(registeredFamily("JETBRAINS MONO"), "JetBrains Mono");
  assert.equal(registeredFamily("'Space Grotesk'"), "Space Grotesk");
  assert.equal(registeredFamily("stix-two-text"), "STIX Two Text");
  assert.equal(registeredFamily("poppins"), null);
  assert.equal(fontFamilyName("space-grotesk"), "Space Grotesk");
  assert.equal(fontFamilyName("Jetbrains Mono"), "JetBrains Mono");
  assert.equal(fontFamilyName("ibm-plex-mono"), "IBM Plex Mono");
  assert.equal(fontFamilyName("Inter Tight"), "Inter Tight");
  assert.equal(fontFamilyName("system-ui"), "system-ui");
});

test("stacks name only bundled families before one generic family", () => {
  assert.equal(fontStack("space-grotesk", "body"), "'Space Grotesk', 'Inter', 'STIX Two Math', sans-serif");
  assert.equal(fontStack(null, "display"), "'Anton', 'STIX Two Math', sans-serif");
  assert.equal(fontStack(null, "meta"), "'JetBrains Mono', 'STIX Two Math', monospace");
  assert.equal(fontStack(null, "math"), "'STIX Two Text', 'STIX Two Math', serif");
  assert.equal(fontStack("poppins", "body"), "'Poppins', 'Inter', 'STIX Two Math', sans-serif", "an unregistered family degrades to the role's bundled family");
  assert.throws(() => fontStack("Inter", "caption"), /unknown font role/);
  const stacks = brandFontStacks({ fonts: { display: "anton", body: "space-grotesk" } });
  assert.deepEqual(stacks.families, ["Anton", "Space Grotesk"]);
  assert.equal(stacks.meta, fontStack(null, "meta"));
  for (const role of ["display", "body", "meta", "math", "serif"]) {
    const names = stacks[role].split(", ");
    assert.match(names.at(-1), /^(sans-serif|serif|monospace)$/);
    for (const name of names.slice(0, -1)) assert.ok(FONT_REGISTRY[name.replace(/'/g, "")], `${role}: ${name} is registered`);
  }
  assert.equal(brandFontStacks({ fonts: { body: "syne" } }).display, fontStack("Syne", "display"), "display falls back to the body family");
});

test("a project loads the role defaults, the symbol fallback and the brand families", () => {
  assert.deepEqual(projectFontFamilies({ fonts: { display: "unbounded", body: "inter" } }), ["Anton", "Inter", "JetBrains Mono", "STIX Two Text", "Instrument Serif", "STIX Two Math", "Unbounded"]);
  const faces = registryFontFaces(["Instrument Serif", "Poppins"]);
  assert.deepEqual(faces.map((face) => [face.file, face.style]), [["instrument-serif-latin-400-normal.woff2", "normal"], ["instrument-serif-latin-400-italic.woff2", "italic"]]);
  assert.equal(faces[0].module, "@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2");
});

test("width scales compare a family with its role default", () => {
  assert.equal(fontWidthScale("Anton", "display"), 1);
  assert.equal(fontWidthScale(null, "display"), 1);
  assert.equal(fontWidthScale("poppins", "display"), 1, "unregistered families keep the role calibration");
  assert.equal(fontWidthScale("Instrument Serif", "body"), 1, "narrower families never scale below 1");
  assert.ok(fontWidthScale("unbounded", "display") > 1.8);
  assert.ok(fontWidthScale("Syne", "body") > 1.1);
  for (const item of Object.values(FONT_REGISTRY)) {
    assert.ok(item.advance.upper > 0.3 && item.advance.upper < 1, item.family);
    assert.ok(item.advance.lower > 0.3 && item.advance.lower < 1, item.family);
  }
});

test("frozen files and @font-face rules", () => {
  const faces = frozenFontFaces("Poppins", ["assets/fonts/poppins-700-italic.woff2", "poppins-regular.ttf", "inter-400.woff2", "notes.txt"]);
  assert.deepEqual(faces, [
    { family: "Poppins", file: "poppins-700-italic.woff2", weight: "700", style: "italic", format: "woff2" },
    { family: "Poppins", file: "poppins-regular.ttf", weight: "400", style: "normal", format: "truetype" }
  ]);
  assert.equal(fontFaceRule({ family: "Inter", weight: "100 900", style: "normal", format: "woff2" }, "fonts/inter-latin-wght-normal.woff2"),
    "@font-face { font-family: 'Inter'; src: url(\"fonts/inter-latin-wght-normal.woff2\") format(\"woff2\"); font-weight: 100 900; font-style: normal; font-display: block; }");
});

test("THIRD_PARTY_NOTICES.md records every bundled font package and its licence", () => {
  const notices = readFileSync(path.join(ROOT, "THIRD_PARTY_NOTICES.md"), "utf8");
  for (const item of Object.values(FONT_REGISTRY)) {
    assert.match(notices, new RegExp(`${item.package.replace(/[/@-]/g, "\\$&")}@${item.version.replace(/\./g, "\\.")}`), item.package);
  }
  assert.match(notices, /SIL Open Font License/);
  assert.ok(existsSync(path.join(ROOT, "node_modules", "@fontsource", "anton", "LICENSE")));
});

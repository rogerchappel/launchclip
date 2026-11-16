import assert from "node:assert/strict";
import test from "node:test";
import { hexToOklch, contrastRatio } from "@launchclip/core/oklch.mjs";
import { PALE_SURFACE_L, TONAL_RAMP, isPale, paleSurfaceFindings, tonalRamp, workingColors } from "@launchclip/core/palette.mjs";
import { resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { applyStyle, validateStylePack } from "@launchclip/core/style.mjs";

const L = (hex) => hexToOklch(hex).l;
// A pale tint brand (a mint ground, deep teal text), a dark brand, a saturated mid ground, a white brand and a one-colour brand.
const MINT = { bg: "#e3fcfc", paper: "#041819", ink: "#f9fdfd", primary: "#8fd4d5", accent: "#001e03" };
const DARK = { bg: "#0b1020", paper: "#f5f3ee", ink: "#0b1020", primary: "#5ee6ff", accent: "#ffb347" };
const SATURATED = { bg: "#c2410c", paper: "#fff7ed", ink: "#1c0a02", primary: "#fde047", accent: "#1e1b4b" };
const WHITE = { bg: "#ffffff", paper: "#111111", ink: "#ffffff", primary: "#ff4f1f", accent: "#1d4ed8" };
const ONE = { primary: "#ff3355" };

test("the tonal ramp keeps the brand hue and a wide lightness range", () => {
  for (const colors of [MINT, DARK, SATURATED, WHITE, ONE]) {
    const ramp = tonalRamp(colors);
    assert.ok(L(ramp.deep) <= TONAL_RAMP.ownDeep + 0.01, `deep ${ramp.deep}`);
    assert.ok(L(ramp.light) >= PALE_SURFACE_L, `light ${ramp.light}`);
    assert.ok(L(ramp.deep) < L(ramp.mid) && L(ramp.mid) < L(ramp.light));
    assert.ok(L(ramp.light) - L(ramp.deep) >= 0.6, "minimum tonal range");
  }
  // A brand's own dark is its deep step; else the deep step takes the primary's hue.
  assert.equal(tonalRamp(MINT).deep, "#041819");
  assert.ok(Math.abs(hexToOklch(tonalRamp(ONE).mid).h - hexToOklch(ONE.primary).h) < 6);
});

test("a pale ground moves to paper over the deep step", () => {
  const out = workingColors(MINT);
  assert.equal(out.bg, "#041819");
  assert.equal(out.paper, MINT.bg);
  assert.ok(!isPale(out.bg));
  assert.ok(contrastRatio(out.paper, out.bg) >= 4.5);
  assert.ok(contrastRatio(out.accent, out.bg) >= 4.5, "the near-black accent is lifted to read on the deep ground");
  assert.ok(contrastRatio(out.ink, out.paper) >= 4.5, "ink still reads on paper cards");
  for (const step of ["deep", "mid", "light"]) assert.match(out[step], /^#[0-9a-f]{6}$/);
  // A white brand goes the same way; its own black is the ground.
  const white = workingColors(WHITE);
  assert.equal(white.bg, "#111111");
  assert.equal(white.paper, "#ffffff");
  assert.ok(contrastRatio(white.accent, white.bg) >= 3);
});

test("dark and saturated grounds stay as given, and as-given opts out", () => {
  assert.equal(workingColors(DARK), DARK);
  assert.equal(workingColors(SATURATED), SATURATED);
  const yellow = { ...SATURATED, bg: "#fde047" };
  assert.equal(workingColors(yellow), yellow, "a saturated light ground is not pale");
  assert.equal(workingColors(MINT, "as-given"), MINT);
  // Idempotent: a working palette resolves to itself.
  const once = workingColors(MINT);
  assert.equal(workingColors(once), once);
});

test("a one-colour brand gets a deep ground and a light paper", () => {
  const out = workingColors(ONE);
  assert.equal(out.primary, ONE.primary);
  assert.ok(L(out.bg) <= TONAL_RAMP.deep + 0.01);
  assert.ok(contrastRatio(out.paper, out.bg) >= 4.5);
  assert.ok(contrastRatio(out.primary, out.bg) >= 3);
});

const story = (brand) => ({ version: 1, format: { width: 1080, height: 1920, fps: 30, duration: 4 }, brand, scenes: [{ id: "a", module: "hook-title", start: 0, end: 4, params: { title: "Hello" } }] });

test("resolveStory renders with the working palette; validation knows brand.palette", () => {
  const fonts = { display: "anton", body: "manrope" };
  assert.equal(resolveStory(story({ colors: MINT, fonts })).brand.colors.bg, "#041819");
  assert.equal(resolveStory(story({ colors: MINT, fonts, palette: "as-given" })).brand.colors.bg, MINT.bg);
  assert.deepEqual(resolveStory(story({ colors: DARK, fonts })).brand.colors, DARK);
  assert.ok(validateStory(story({ colors: MINT, fonts, palette: "raw" })).errors.some((error) => /brand\.palette/.test(error)));
  assert.ok(!validateStory(story({ colors: MINT, fonts, palette: "as-given" })).errors.some((error) => /brand\.palette/.test(error)));
});

test("a style pack carries brand.palette into the story", () => {
  const pack = { schema: "launchclip.style.v3", name: "light-pack", brand: { colors: { bg: "#f4f5f7", paper: "#111111" }, palette: "as-given" } };
  assert.ok(validateStylePack(pack).ok);
  assert.ok(!validateStylePack({ ...pack, brand: { ...pack.brand, palette: "raw" } }).ok);
  assert.equal(applyStyle({ brand: { colors: {}, fonts: {} } }, pack).story.brand.palette, "as-given");
});

test("the plan check warns when most of the frame sits on a pale ground", () => {
  const [finding] = paleSurfaceFindings({ colors: MINT, duration: 10, media: [{ start: 0, end: 4, area: 0.5 }] });
  assert.equal(finding.rule, "pale-surface");
  assert.equal(finding.severity, "warning");
  assert.match(finding.detail, /80%/);
  // Footage over most of it, a dark ground, or the working palette: quiet.
  assert.deepEqual(paleSurfaceFindings({ colors: MINT, duration: 10, media: [{ start: 0, end: 10, area: 1 }] }), []);
  assert.deepEqual(paleSurfaceFindings({ colors: DARK, duration: 10 }), []);
  assert.deepEqual(paleSurfaceFindings({ colors: workingColors(MINT), duration: 10 }), []);
});

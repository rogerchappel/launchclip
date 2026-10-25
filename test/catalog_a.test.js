import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import gsap from "gsap";
import { CATALOG_A_IDS, MODULES, ANIMATED_PROPS, contrastRatio, cssFromProps, initialNodeProps, mixHex, sampleNode, textAt } from "../kit/core/catalog-a.mjs";
import { EMITTERS } from "../kit/hyperframes/catalog-a.mjs";
import { getEase } from "../kit/core/motion.mjs";
import { SAFE_ZONE_PROFILES } from "../kit/core/layout-check.mjs";
import { mediaSkip } from "./helpers/media.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BRAND = { colors: { bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", ink: "#06070d", paper: "#f2eee6" }, fonts: { display: "anton", body: "space-grotesk", meta: "jetbrains-mono" } };
const PORTRAIT = { width: 1080, height: 1920, fps: 30, duration: 30 };
const LANDSCAPE = { width: 1920, height: 1080, fps: 30, duration: 30 };
export const ctx = (overrides = {}) => ({ id: "m1", start: 2, duration: 4, format: PORTRAIT, brand: BRAND, aspect: "9:16", ...overrides });
const resolve = (id, params, overrides) => MODULES[id].resolve(params, ctx(overrides));

// Minimal valid params per module, extended by each module's own tests.
export const SAMPLES = {};

// ---------------------------------------------------------------------------
// Shared contract checks, applied to every registered sample.

function checkContract(model, { captions }) {
  for (const key of ["id", "module", "canvas", "start", "duration", "end", "rect", "motion", "content", "events", "layout", "hidesCaptions", "theme"]) assert.ok(key in model, `model.${key}`);
  for (const key of ["enterStart", "enterEnd", "exitStart", "end", "enterFrom", "exitTo", "enterEase", "exitEase"]) assert.ok(key in model.motion, `motion.${key}`);
  assert.deepEqual(Object.keys(model.layout.motion), ["enterEnd", "exitStart", "end"]);
  assert.equal(model.end, model.start + model.duration);
  assert.ok(model.motion.enterStart <= model.motion.enterEnd && model.motion.enterEnd <= model.motion.exitStart && model.motion.exitStart < model.end);
  getEase(model.motion.enterEase); getEase(model.motion.exitEase);
  // Safe zone (and above the caption band when captions stay visible).
  const profile = model.canvas.height > model.canvas.width ? SAFE_ZONE_PROFILES.shorts : SAFE_ZONE_PROFILES.landscape;
  const sx = model.canvas.width / profile.reference.width, sy = model.canvas.height / profile.reference.height;
  const zone = { x: profile.safeZone.x * sx, y: profile.safeZone.y * sy, right: (profile.safeZone.x + profile.safeZone.width) * sx, bottom: (profile.safeZone.y + profile.safeZone.height) * sy };
  const r = model.rect;
  assert.ok(r.x >= zone.x - .5 && r.y >= zone.y - .5 && r.x + r.width <= zone.right + .5 && r.y + r.height <= zone.bottom + .5, `rect ${JSON.stringify(r)} inside safe zone`);
  if (captions) assert.ok(r.y + r.height <= profile.captionBand.y * sy, "rect clears the caption band");
  assert.equal(model.hidesCaptions, !captions);
  // Key text floor.
  const k = Math.min(model.canvas.width, model.canvas.height) / 1080;
  for (const size of model.content.keyTextPx) assert.ok(size >= 44 * k - .01, `key text ${size}px`);
  // Contrast record: every pair at least 3:1.
  for (const [pair, ratio] of Object.entries(model.contrast)) assert.ok(ratio >= 3, `${pair} ${ratio}`);
  // Events sorted, ids prefixed, times inside the scene.
  assert.ok(model.events.length > 0);
  model.events.forEach((event, index) => {
    assert.ok(event.id.startsWith(`${model.id}-`), event.id);
    assert.ok(event.time >= model.start - 1e-9 && event.time <= model.end + 1e-9, `${event.id} at ${event.time}`);
    if (index) assert.ok(event.time >= model.events[index - 1].time);
  });
  checkAnimations(model);
}

// Per node and prop: tweens never overlap and each starts where the previous
// ended, blur is 0 at the end of the last tween, and static styles never set
// opacity/transform/filter on animated nodes (GSAP owns those).
function checkAnimations(model) {
  const tracks = new Map();
  for (const a of model.animations) {
    assert.ok(model.styles[a.node], `styles for animated node ${a.node}`);
    assert.ok(a.start >= model.start - 1e-9 && a.start + a.duration <= model.end + 1e-6, `${a.node} tween inside the scene`);
    getEase(a.ease);
    for (const prop of Object.keys(a.to)) {
      assert.ok(ANIMATED_PROPS.includes(prop), prop);
      const key = `${a.node}.${prop}`;
      if (!tracks.has(key)) tracks.set(key, []);
      tracks.get(key).push(a);
    }
  }
  for (const [key, list] of tracks) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) {
      const prop = key.split(".").pop();
      assert.ok(list[i].start >= list[i - 1].start + list[i - 1].duration - 1e-6, `${key} tweens overlap at ${list[i].start}`);
      assert.equal(list[i].from[prop], list[i - 1].to[prop], `${key} continuity at ${list[i].start}`);
    }
    // Blur resolves to 0 at settle; only a tween that fades the node out may end blurred.
    if (key.endsWith(".blur")) for (const a of list) assert.ok(a.to.blur === 0 || a.to.opacity === 0, `${key} settles sharp at ${a.start + a.duration}`);
  }
  for (const [key] of tracks) {
    const [node, prop] = [key.slice(0, key.lastIndexOf(".")), key.slice(key.lastIndexOf(".") + 1)];
    const css = prop === "blur" ? "filter" : prop === "opacity" || prop === "color" ? prop : "transform";
    if (css !== "color") assert.ok(!(css in model.styles[node]), `${node} sets static ${css} while ${prop} is animated`);
  }
}

// Evaluate the emitted GSAP code against a fake timeline (shape) and against a
// real paused GSAP timeline with fake targets (values), seeking forwards,
// backwards and out of order: every sample must match sampleNode().
function checkEmitter(model) {
  const out = EMITTERS[model.module](model);
  assert.deepEqual(Object.keys(out).sort(), ["css", "events", "html", "layout", "motion"]);
  assert.match(out.html, new RegExp(`<section id="${model.id}" class="clip" data-start="${model.start}" data-duration="${model.duration}"`));
  assert.equal(out.events, model.events);
  assert.equal(out.layout, model.layout);
  assert.doesNotMatch(out.motion, /onUpdate|onComplete|\.call\(|\.to\(|Proxy|Date\.now|Math\.random|requestAnimationFrame/);
  const calls = [];
  runInNewContext(out.motion, { tl: { fromTo: (...args) => calls.push(["fromTo", ...args]), set: (...args) => calls.push(["set", ...args]), to: () => assert.fail("tl.to is not seek-safe") } });
  for (const call of calls.filter((c) => c[0] === "fromTo")) {
    assert.equal(call[3].immediateRender, false);
    assert.equal(typeof call[4], "number");
  }
  for (const node of Object.keys(model.styles)) {
    const id = node === "root" ? model.id : `${model.id}-${node}`;
    assert.ok(out.html.includes(`id="${id}"`), `html has #${id}`);
    assert.ok(out.css.includes(`#${id}{`), `css has #${id}`);
  }
  // Real GSAP, fake targets: plain objects receive the tweened values.
  const targets = {};
  const target = (selector) => (targets[selector] ??= {});
  const tl = gsap.timeline({ paused: true });
  const proxyTl = {
    set: (sel, vars, at) => tl.set(target(sel), plain(vars), at),
    fromTo: (sel, from, to, at) => tl.fromTo(target(sel), plain(from), plain(to), at)
  };
  runInNewContext(out.motion, { tl: proxyTl });
  const times = [model.end - .01, model.start, ...model.events.map((e) => e.time + .07), model.motion.enterEnd, model.start + model.duration / 2, model.motion.exitStart + .1, model.start + .05];
  for (const t of times) {
    tl.seek(t, false);
    for (const node of new Set(model.animations.map((a) => a.node))) {
      const id = `#${node === "root" ? model.id : `${model.id}-${node}`}`;
      const expected = sampleNode(model, node, t);
      for (const [prop, value] of Object.entries(expected)) {
        const key = prop === "blur" ? "filterBlur" : prop;
        const actual = targets[id][key];
        if (typeof value === "number") assert.ok(Math.abs(actual - value) < 1e-3, `${id}.${prop} at ${t}: gsap ${actual} vs model ${value}`);
        else assert.ok(sameColor(actual, value), `${id}.${prop} at ${t}: gsap ${actual} vs model ${value}`);
      }
    }
    // GSAP coerces numeric strings on plain objects ("70" → 70); the DOM keeps text.
    for (const entry of model.texts) assert.equal(String(targets[`#${model.id}-${entry.node}`].textContent), textAt(model, entry.node, t), `text at ${t}`);
  }
  return out;
}

function rgb(value) {
  const text = String(value).trim().toLowerCase();
  if (text.startsWith("#")) return [1, 3, 5].map((i) => parseInt(text.slice(i, i + 2), 16));
  return text.match(/[0-9.]+/g).slice(0, 3).map(Number);
}
const sameColor = (a, b) => rgb(a).every((c, i) => Math.abs(c - rgb(b)[i]) <= 1);

// GSAP cannot tween filter strings on plain objects; map blur to a number.
function plain(vars) {
  const out = { ...vars };
  if ("filter" in out) { out.filterBlur = Number(/blur\(([-0-9.]+)px\)/.exec(out.filter)[1]); delete out.filter; }
  delete out.force3D;
  return out;
}

export function registerSample(id, params, { captions = false } = {}) {
  SAMPLES[id] = { params, captions };
}

// ---------------------------------------------------------------------------
// Shared helpers

test("contrastRatio follows WCAG 2 and mixHex blends in sRGB", () => {
  assert.equal(Number(contrastRatio("#000000", "#ffffff").toFixed(2)), 21);
  assert.equal(contrastRatio("#777777", "#777777"), 1);
  assert.ok(Math.abs(contrastRatio("#fdb022", "#06070d") - contrastRatio("#06070d", "#fdb022")) < 1e-12);
  assert.equal(mixHex("#ffffff", "#000000", .5), "#808080");
  assert.throws(() => contrastRatio("red", "#000000"), /#rrggbb/);
});

test("cssFromProps composes transforms in GSAP order", () => {
  assert.deepEqual(cssFromProps({ opacity: .5, x: 10, y: -4, scale: 1.2, blur: 3, color: "#ffffff" }),
    { opacity: "0.5", color: "#ffffff", filter: "blur(3px)", transform: "translate(10px, -4px) rotate(0deg) scale(1.2, 1.2)" });
  assert.deepEqual(cssFromProps({ scaleX: 0 }), { transform: "translate(0px, 0px) rotate(0deg) scale(0, 1)" });
  assert.deepEqual(cssFromProps({}), {});
});

test("every catalogue A id is registered with describe, params and resolve", () => {
  assert.deepEqual(Object.keys(MODULES).sort(), [...CATALOG_A_IDS].sort());
  for (const id of CATALOG_A_IDS) {
    assert.equal(typeof MODULES[id].describe, "string");
    assert.ok(MODULES[id].describe.length > 20);
    assert.equal(typeof MODULES[id].params, "object");
    assert.equal(typeof MODULES[id].resolve, "function");
    assert.ok(Object.isFrozen(MODULES[id]));
  }
});

test("ctx and brand are validated before params", () => {
  const id = "hook-title";
  assert.throws(() => resolve(id, { headline: "Hello" }, { id: "1bad" }), new RegExp(`${id}: ctx\\.id`));
  assert.throws(() => resolve(id, { headline: "Hello" }, { duration: 0 }), /ctx\.duration must be a number/);
  assert.throws(() => resolve(id, { headline: "Hello" }, { brand: { colors: { bg: "#000000", paper: "#ffffff" } } }), /brand\.colors\.primary is required/);
  assert.throws(() => resolve(id, { headline: "Hello" }, { brand: { colors: { bg: "#000", paper: "#ffffff", primary: "#ff0000" } } }), /brand\.colors\.bg must be a six-digit hex/);
  assert.throws(() => resolve(id, { headline: "Hello" }, { brand: { ...BRAND, fonts: { display: "x;}" } } }), /brand\.fonts\.display/);
});

// ---------------------------------------------------------------------------
// Module samples: contract, emitter, seek-safety, landscape.

test("every sample satisfies the model contract and seeks identically in GSAP", () => {
  for (const [id, { params, captions }] of Object.entries(SAMPLES)) {
    const model = resolve(id, params);
    assert.equal(model.module, id);
    checkContract(model, { captions });
    checkEmitter(model);
    // Initial node props equal the first tween's from values.
    for (const a of model.animations) for (const prop of Object.keys(a.from)) assert.ok(prop in initialNodeProps(model, a.node));
  }
});

test("every sample also lays out on a landscape and a 720p portrait canvas", () => {
  for (const [id, { params, captions }] of Object.entries(SAMPLES)) {
    for (const format of [LANDSCAPE, { width: 720, height: 1280, fps: 30, duration: 30 }]) {
      const model = resolve(id, params, { format, aspect: format.width > format.height ? "16:9" : "9:16" });
      checkContract(model, { captions });
    }
  }
});

test("a brand that fails 3:1 throws for every module", () => {
  const dull = { colors: { bg: "#202020", paper: "#f0f0f0", primary: "#3a3a3a" } };
  for (const [id, { params }] of Object.entries(SAMPLES)) {
    assert.throws(() => resolve(id, params, { brand: dull }), new RegExp(`${id}: brand contrast too low: primary on bg \\(#3a3a3a on #202020\\) is [0-9.]+:1; it needs at least 3:1`));
  }
});

test("a params.rect outside the safe zone is rejected and one inside is used", () => {
  for (const [id, { params }] of Object.entries(SAMPLES)) {
    assert.throws(() => resolve(id, { ...params, rect: { x: 0, y: 300, width: 900, height: 900 } }), new RegExp(`${id}: params\\.rect must stay inside the safe zone`));
  }
});

// ---------------------------------------------------------------------------
// Real Remotion stills, one per sample (skipped without Chrome Headless Shell).

const ENTRY = path.join(ROOT, "test", "fixtures", "parity-entry-cat-a", "entry.tsx");

test("each sample renders a real Remotion still through ModuleReview", { skip: mediaSkip(), timeout: 600_000 }, async (t) => {
  let renderer;
  try {
    renderer = await import("@remotion/renderer");
    await renderer.ensureBrowser();
  } catch (error) {
    t.skip(`Chrome Headless Shell is unavailable: ${error.message}`);
    return;
  }
  if (!Object.keys(SAMPLES).length) return;
  const { bundle } = await import("@remotion/bundler");
  const serveUrl = await bundle({ entryPoint: ENTRY, onProgress: () => {} });
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-cat-a-"));
  try {
    for (const [id, { params }] of Object.entries(SAMPLES)) {
      const story = { format: PORTRAIT, brand: BRAND };
      const scene = { id: "m1", module: id, start: 0, end: 4, params };
      const inputProps = { scene, story };
      const composition = await renderer.selectComposition({ serveUrl, id: "ModuleReview", inputProps, logLevel: "error" });
      assert.equal(composition.durationInFrames, 120);
      const output = path.join(dir, `${id}.png`);
      await renderer.renderStill({ composition, serveUrl, output, frame: 60, inputProps, imageFormat: "png", logLevel: "error" });
      const png = await readFile(output);
      assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
      assert.equal(png.readUInt32BE(16), 1080);
      assert.equal(png.readUInt32BE(20), 1920);
      assert.ok(png.length > 20_000, `${id} still has content (${png.length} bytes)`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(serveUrl, { recursive: true, force: true });
  }
});

test("the throwaway parity verifier and its Remotion entry exist", () => {
  assert.ok(existsSync(path.join(ROOT, "scripts", "parity-cat-a.mjs")));
  assert.ok(existsSync(ENTRY));
});

// Parity fixtures resolve and their scenes use catalogue A modules.
async function checkFixture(name) {
  const fixture = JSON.parse(await readFile(path.join(ROOT, "test", "fixtures", "parity", name), "utf8"));
  const scene = fixture.story.scenes.find((item) => item.id === fixture.sceneId);
  const format = fixture.story.format;
  const model = MODULES[scene.module].resolve(scene.params, { id: scene.id, start: scene.start, duration: scene.end - scene.start, format, brand: fixture.story.brand, aspect: "9:16" });
  checkContract(model, { captions: !model.hidesCaptions });
  checkEmitter(model);
  return model;
}

// ---------------------------------------------------------------------------
// hook-title

const HOOK = { eyebrow: "Physics in 30 seconds", headline: "Hot coffee cools fast, then crawls.", emphasis: [{ text: "fast", at: 1.2 }, { text: "crawls", at: 2.4, color: "accent" }], kicker: "Why?", kickerAt: 3 };
registerSample("hook-title", HOOK);

test("hook-title is readable on frame 0 and lights its emphasis words on time", () => {
  const model = resolve("hook-title", HOOK);
  assert.equal(model.hidesCaptions, true);
  const t0 = model.start;
  assert.equal(sampleNode(model, "root", t0).opacity ?? 1, 1);
  for (const line of model.content.lines) for (const word of line.words) assert.equal(sampleNode(model, `word-${word.index}`, t0).opacity ?? 1, 1);
  assert.equal(model.content.lines.flatMap((line) => line.words.map((word) => word.text)).join(" "), HOOK.headline);
  const [fast, crawls] = model.content.emphasis;
  assert.equal(fast.time, 3.2);
  assert.equal(crawls.color, BRAND.colors.accent);
  assert.equal(sampleNode(model, `word-${fast.word}-text`, fast.time - .01).color, BRAND.colors.paper);
  assert.equal(sampleNode(model, `word-${fast.word}-text`, fast.time + .5).color, BRAND.colors.primary);
  assert.equal(sampleNode(model, `word-${fast.word}-bar`, fast.time + 1).scaleX, 1);
  assert.deepEqual(model.events.map((e) => e.id), ["m1-title", "m1-emphasis-0", "m1-emphasis-1", "m1-kicker"]);
  assert.equal(model.events.find((e) => e.id === "m1-kicker").time, 5);
  assert.equal(sampleNode(model, "kicker", 4.9).opacity, 0);
  assert.equal(sampleNode(model, "kicker", 5.6).opacity, 1);
  assert.ok(model.content.size >= 120, `headline set large (${model.content.size}px)`);
  assert.ok(model.content.lines.length <= 4);
});

test("hook-title validates its params with path-prefixed messages", () => {
  const bad = (params, pattern) => assert.throws(() => resolve("hook-title", params), pattern);
  bad({}, /hook-title: params\.headline is required/);
  bad({ headline: "Hi", subtitle: "x" }, /params\.subtitle is not a known parameter \(allowed: headline/);
  bad({ headline: "" }, /params\.headline must be a string of 1–90 characters/);
  bad({ headline: "Hello there", emphasis: [{ text: "nope" }] }, /params\.emphasis\[0\]\.text "nope" must match whole words/);
  bad({ headline: "Hello there", emphasis: [{ text: "there", at: 9 }] }, /params\.emphasis\[0\]\.at must be seconds from the scene start between 0 and 3\.5/);
  bad({ headline: "Hello there", emphasis: [{ text: "there", wobble: 1 }] }, /params\.emphasis\[0\]\.wobble is not a known parameter/);
  bad({ headline: "Hello there", kickerAt: 1 }, /params\.kickerAt needs params\.kicker/);
  bad({ headline: "Hello there", color: "pink" }, /params\.color must be one of "primary", "accent"/);
  bad({ headline: "Hello there", align: "right" }, /params\.align must be one of "center", "left"/);
  bad({ headline: "Supercalifragilisticexpialidociously" }, /params\.headline is too long/);
  assert.throws(() => resolve("hook-title", { headline: "Hello" }, { duration: 1 }), /needs a scene of at least 1\.5 s/);
});

test("hook-title enforces kicker ink contrast on the emphasis fill", () => {
  const brand = { colors: { ...BRAND.colors, ink: "#f2eee6" } };
  assert.throws(() => resolve("hook-title", { headline: "Hello there", kicker: "Why?" }, { brand }), /brand contrast too low: ink on primary/);
  assert.ok(resolve("hook-title", { headline: "Hello there" }, { brand }));
});

// ---------------------------------------------------------------------------
// kinetic-words

const KINETIC = { words: [{ text: "Big gap", at: 0.15 }, { text: "cools", at: 0.75 }, { text: "fast", at: 1.3, emphasis: true }, { text: "small gap", at: 2.1 }, { text: "crawls", at: 2.75, emphasis: true, color: "accent" }] };
registerSample("kinetic-words", KINETIC);

test("kinetic-words replaces one beat with the next on its word time", () => {
  const model = resolve("kinetic-words", KINETIC);
  assert.equal(model.hidesCaptions, true);
  assert.deepEqual(model.events.map((e) => [e.id, e.time]), [["m1-beat-0", 2.15], ["m1-beat-1", 2.75], ["m1-beat-2", 3.3], ["m1-beat-3", 4.1], ["m1-beat-4", 4.75]]);
  const visible = (t) => model.content.beats.filter((beat) => (sampleNode(model, `beat-${beat.index}`, t).opacity ?? 0) > .5).map((beat) => beat.index);
  assert.deepEqual(visible(2.5), [0]);
  assert.deepEqual(visible(3.6), [2]);
  assert.deepEqual(visible(5.3), [4]);
  // Scale variant: blurred and large on entry, sharp at settle.
  const beat = model.content.beats[2];
  assert.ok(sampleNode(model, "beat-2", beat.time + .02).blur > 5);
  assert.deepEqual(sampleNode(model, "beat-2", beat.settleTime), { opacity: 1, scale: 1, blur: 0 });
  // Single words fill most of the safe width; emphasis beats carry a bar.
  assert.ok(beat.size >= 300, `single word set at ${beat.size}px`);
  assert.ok(model.styles["beat-2-bar"] && !model.styles["beat-1-bar"]);
  assert.equal(model.styles["beat-4-text"].color, BRAND.colors.accent);
});

test("kinetic-words stack layout keeps earlier beats and dims them", () => {
  const model = resolve("kinetic-words", { layout: "stack", variant: "rise", words: KINETIC.words.slice(0, 4) });
  const sizes = new Set(model.content.beats.map((beat) => beat.size));
  assert.equal(sizes.size, 1);
  assert.equal(sampleNode(model, "beat-0-text", 4).color, model.theme.muted);
  assert.equal(sampleNode(model, "beat-0", 4).opacity, 1);
  assert.equal(sampleNode(model, "beat-2", 4).opacity, 1, "emphasis beat stays");
  assert.ok(!("beat-2-text" in Object.fromEntries(model.animations.map((a) => [a.node, 1]))), "emphasis beat is not dimmed");
  assert.equal(sampleNode(model, "beat-3-line-0", model.content.beats[3].time).y, model.content.beats[3].size * 1.25);
  assert.equal(sampleNode(model, "beat-3-line-0", 5.5).y, 0);
  checkContract(model, { captions: false });
  checkEmitter(model);
});

test("kinetic-words: a beat at t <= one frame is settled on frame 0 with no enter, in every variant", () => {
  for (const variant of ["scale", "rise"]) for (const at of [0, 1 / 30]) for (const layout of ["replace", "stack"]) {
    const model = resolve("kinetic-words", { variant, layout, words: [{ text: "Ship it", at, emphasis: layout === "replace" }, { text: "today", at: 0.8 }] });
    const label = `${variant}/${layout}/at ${at}`;
    const start = model.start;
    // No tween animates beat 0 (or its lines and bar) in before or at frame 0.
    const enters = model.animations.filter((a) => /^beat-0(-|$)/.test(a.node) && a.start < start + 0.5);
    assert.deepEqual(enters, [], label);
    assert.equal(model.content.beats[0].settleTime, model.content.beats[0].time, label);
    const props = sampleNode(model, "beat-0", start);
    assert.ok(props.opacity === undefined || props.opacity === 1, label);
    checkEmitter(model);
  }
  // A later beat still enters with its animation.
  const later = resolve("kinetic-words", { words: [{ text: "Ship it", at: 0.1 }] });
  assert.ok(later.animations.some((a) => a.node === "beat-0" && a.from.opacity === 0), "beat at 0.1 s still enters");
});

test("kinetic-words validates beats", () => {
  const bad = (params, pattern) => assert.throws(() => resolve("kinetic-words", params), pattern);
  bad({}, /kinetic-words: params\.words is required/);
  bad({ words: [] }, /params\.words must list 1–12 beats for the replace layout/);
  bad({ words: [{ text: "one two three four", at: 0 }] }, /params\.words\[0\]\.text must be 1–3 words/);
  bad({ words: [{ text: "go" }] }, /params\.words\[0\]\.at is required/);
  bad({ words: [{ text: "go", at: 0.5 }, { text: "now", at: 0.6 }] }, /params\.words\[1\]\.at must be at least 0\.3 s after the previous beat/);
  bad({ words: [{ text: "go", at: 3.8 }] }, /params\.words\[0\]\.at must be seconds from the scene start between 0 and 3\.55/);
  bad({ words: [{ text: "go", at: 0, emphasis: "yes" }] }, /params\.words\[0\]\.emphasis must be true or false/);
  bad({ words: [{ text: "go", at: 0 }], variant: "spin" }, /params\.variant must be one of "scale", "rise"/);
  bad({ words: Array.from({ length: 6 }, (_, i) => ({ text: "go", at: i * .4 })), layout: "stack" }, /1–5 beats for the stack layout/);
  bad({ words: [{ text: "Pneumonoultramicroscopic", at: 0 }] }, /params\.words\[0\]\.text is too long/);
});

test("kinetic-words parity fixtures resolve", async () => {
  await checkFixture("a-cat-kinetic-words.json");
  await checkFixture("a-cat-kinetic-words-stack.json");
});

// ---------------------------------------------------------------------------
// count-up

const COUNT = { value: 1250000, prefix: "$", label: "raised in the first week", note: "Illustrative", hit: "both", countAt: .3, countDuration: 1.2 };
registerSample("count-up", COUNT, { captions: true });

test("count-up counts in discrete frames and hits when the count lands", () => {
  const model = resolve("count-up", COUNT);
  assert.equal(model.hidesCaptions, false);
  const c = model.content;
  assert.equal(c.countStart, 2.3);
  assert.equal(c.stateFrames, 36);
  assert.equal(c.countEnd, 3.5);
  assert.equal(c.initialText, "0");
  assert.equal(c.finalText, "1,250,000");
  const frames = model.texts[0].frames;
  assert.equal(frames.at(-1).text, "1,250,000");
  assert.ok(frames.every((frame, i) => !i || frame.time > frames[i - 1].time));
  assert.equal(textAt(model, "digits", 2.29), "0");
  assert.equal(textAt(model, "digits", 9), "1,250,000");
  assert.deepEqual(model.events.map((e) => [e.id, e.time, e.endTime]), [["m1-count", 2.3, 3.5], ["m1-hit", 3.5, undefined]]);
  assert.equal(sampleNode(model, "bar", 3.49).scaleX, 0);
  assert.equal(sampleNode(model, "bar", 4.2).scaleX, 1);
  assert.equal(sampleNode(model, "digits", 4).color, BRAND.colors.primary);
  assert.equal(c.sparks.length, 11);
  assert.ok(c.sparks.every((s) => s.angle >= 165 && s.angle <= 375), "sparks fan above the number");
  assert.equal(sampleNode(model, "spark-0-ray", 4.2).scaleX, 0, "sparks finish invisible");
  // Rect stays above the caption band.
  assert.ok(model.rect.y + model.rect.height <= 1150 + .5);
});

test("count-up formats decimals, separators, signs and affixes", async () => {
  const { formatNumber } = await import("../kit/core/catalog-a.mjs");
  assert.equal(formatNumber(1234567.891, { decimals: 2 }), "1,234,567.89");
  assert.equal(formatNumber(1234567, { separator: false }), "1234567");
  assert.equal(formatNumber(-42.5, { decimals: 1 }), "−42.5");
  assert.equal(formatNumber(-0.001, { decimals: 1 }), "0.0");
  const model = resolve("count-up", { value: 17.5, from: 70, decimals: 1, suffix: "°C", label: "the gap" });
  assert.equal(model.content.initialText, "70.0");
  assert.equal(model.content.finalText, "17.5");
  const out = EMITTERS["count-up"](model);
  assert.match(out.html, /<span id="m1-suffix">°C<\/span>/);
  assert.match(out.motion, /tl\.set\("#m1-digits", \{textContent:"\u206070\.0"\}, 2\);/);
});

test("count-up validates its params", () => {
  const bad = (params, pattern) => assert.throws(() => resolve("count-up", params), pattern);
  bad({ label: "x" }, /count-up: params\.value is required/);
  bad({ value: 5 }, /params\.label is required/);
  bad({ value: 5, from: 5, label: "x" }, /params\.from must differ from params\.value/);
  bad({ value: 5, label: "x", decimals: 1.5 }, /params\.decimals must be an integer between 0 and 3/);
  bad({ value: 5, label: "x", suffix: "percent" }, /params\.suffix must be a string of 1–6 characters/);
  bad({ value: 5, label: "x", countAt: 2, countDuration: 1.5 }, /must leave 0\.85 s before the scene ends/);
  bad({ value: 5, label: "x", hit: "boom" }, /params\.hit must be one of "underline", "spark", "both", "none"/);
  bad({ value: 1e12, decimals: 3, label: "x" }, /params\.value with its prefix and suffix is too wide/);
  bad({ value: 5, label: "a label that is far too long to sit on two lines at this size okay" }, /params\.label must be a string of 1–60 characters/);
});

test("count-up parity fixture resolves", async () => {
  await checkFixture("a-cat-count-up.json");
});

// ---------------------------------------------------------------------------
// equation-lockup

const EQUATION = { name: "Newton's law of cooling", equation: "dT/dt = −k (T − T_room)", note: "cooling rate ∝ the gap", highlight: "(T − T_room)" };
registerSample("equation-lockup", EQUATION);

test("equation-lockup typesets terms, fractions and scripts without MathJax", async () => {
  const { tokenizeMath } = await import("../kit/core/catalog-a.mjs");
  assert.deepEqual(tokenizeMath("dT/dt"), [{ type: "frac", num: [{ type: "var", text: "dT" }], den: [{ type: "var", text: "dt" }] }]);
  assert.deepEqual(tokenizeMath("T_room"), [{ type: "var", text: "T", sub: [{ type: "fn", text: "room" }] }]);
  assert.deepEqual(tokenizeMath("x^2"), [{ type: "var", text: "x", sup: [{ type: "num", text: "2" }] }]);
  assert.deepEqual(tokenizeMath("sin(θ)").map((a) => a.type), ["fn", "paren", "var", "paren"]);
  const minus = tokenizeMath("−k");
  assert.equal(minus[0].unary, true);
  assert.equal(tokenizeMath("a + b")[1].unary, false);
  const model = resolve("equation-lockup", EQUATION);
  assert.deepEqual(model.content.terms.map((term) => term.source), ["dT/dt", "=", "−k", "(T − T_room)"]);
  assert.equal(model.content.highlight, 3);
  const out = EMITTERS["equation-lockup"](model);
  assert.match(out.html, /<span class="a-frac"><span class="a-frac-num"><span class="a-var">dT<\/span><\/span><span class="a-frac-bar"><\/span>/);
  assert.match(out.html, /<span class="a-var">T<\/span><span class="a-sub"><span class="a-fn">room<\/span><\/span>/);
  assert.match(out.css, /#m1 \.a-var\{font-style:italic\}/);
  assert.match(model.fonts.math, /STIX Two Text/);
  assert.doesNotMatch(out.html + out.css, /mathjax|katex/i);
});

test("equation-lockup lands terms one by one, then boxes the highlight", () => {
  const model = resolve("equation-lockup", EQUATION);
  const times = model.content.terms.map((term) => term.time);
  assert.deepEqual(times, [2.35, 2.57, 2.79, 3.01]);
  for (const [index, time] of times.entries()) {
    assert.equal(sampleNode(model, `term-${index}`, time - .01).opacity, 0);
    assert.deepEqual(sampleNode(model, `term-${index}`, time + .6), { opacity: 1, y: 0, blur: 0 });
  }
  assert.equal(model.content.lockupTime, 3.43);
  const ids = model.events.map((e) => e.id);
  assert.deepEqual(ids, ["m1-term-0", "m1-term-1", "m1-term-2", "m1-term-3", "m1-lockup", "m1-highlight"]);
  const h = model.content.highlightTime;
  assert.equal(sampleNode(model, "term-3-box", h - .01).opacity, 0);
  assert.equal(sampleNode(model, "term-3-text", h + .5).color, BRAND.colors.primary);
  assert.equal(sampleNode(model, "note", model.content.lockupTime + .1).opacity, 0);
  assert.equal(sampleNode(model, "note", model.content.lockupTime + .8).opacity, 1);
});

test("equation-lockup validates its params", () => {
  const bad = (params, pattern) => assert.throws(() => resolve("equation-lockup", params), pattern);
  bad({}, /equation-lockup: params needs exactly one of params\.equation or params\.terms/);
  bad({ equation: "a = b", terms: ["a"] }, /exactly one of/);
  bad({ terms: [] }, /params\.terms must list 1–9 term strings/);
  bad({ equation: "a + b + c + d + e + f" }, /params\.equation must have 1–9 terms/);
  bad({ equation: "E = mc^2", highlight: "mc" }, /params\.highlight must be a term index or one of "E", "=", "mc\^2"/);
  bad({ equation: "E = mc^2", highlight: 3 }, /params\.highlight must be an integer between 0 and 2/);
  bad({ equation: "E = mc^2", highlightAt: 1 }, /params\.highlightAt needs params\.highlight/);
  bad({ equation: "E = mc^2", highlight: 2, highlightAt: .5 }, /params\.highlightAt must come after the highlighted term has landed/);
  bad({ equation: "E = mc^2", at: 2.9, stagger: 1 }, /too late for a 4 s scene/);
  bad({ terms: ["abcdefghijklmnopqrstuvwxyz", "abcdefghijklmnopqrstuvwxyz"] }, /too long to set at 64 px or more on one line/);
});

test("equation-lockup parity fixture and the golden story's s5 resolve", async () => {
  await checkFixture("a-cat-equation-lockup.json");
  const golden = JSON.parse(await readFile(path.join(ROOT, "examples", "story", "cooling.story.json"), "utf8"));
  const s5 = golden.scenes.find((scene) => scene.id === "s5");
  const model = MODULES["equation-lockup"].resolve(s5.params, { id: "s5", start: s5.start, duration: s5.end - s5.start, format: golden.format, brand: golden.brand });
  checkContract(model, { captions: false });
});

// ---------------------------------------------------------------------------
// cta

const CTA = { action: "Follow for part two", emphasis: "part two", detail: "New physics every week", handle: "@launchclip" };
registerSample("cta", CTA);

test("cta lands the action, pops the handle pill and pulses its ring seek-safely", () => {
  const model = resolve("cta", CTA);
  const c = model.content;
  assert.equal(model.hidesCaptions, true);
  assert.equal(c.icon, "arrow");
  assert.deepEqual(model.events.map((e) => e.id), ["m1-action", "m1-handle"]);
  assert.equal(c.pillTime, 2.6);
  assert.ok(c.pulses.length >= 2, "ring pulses repeat until the exit");
  const emphasisWords = c.lines.flatMap((line) => line.words).filter((word) => word.emphasis).map((word) => word.text);
  assert.deepEqual(emphasisWords, ["part two"]);
  // Ring: visible at the start of each pulse, gone at its end, never overlapping.
  for (const pulse of c.pulses) {
    assert.ok(sampleNode(model, "ring", pulse.time + .08).opacity > .8);
    assert.equal(sampleNode(model, "ring", pulse.time + .95).opacity, 0);
  }
  // Ordinary exit lifts out.
  assert.equal(model.motion.exitTo.y, -40);
  assert.deepEqual(sampleNode(model, "root", model.end), { opacity: 0, y: -40 });
});

test("cta loop ending fades in place to the background and spins the loop icon", () => {
  const model = resolve("cta", { ...CTA, loop: true });
  assert.equal(model.content.icon, "loop");
  assert.deepEqual(model.motion.exitTo, { opacity: 0 });
  assert.equal(model.motion.exit, .5);
  assert.deepEqual(sampleNode(model, "root", model.end), { opacity: 0 });
  assert.ok(model.events.some((e) => e.id === "m1-loop" && e.role === "loop" && e.time === model.motion.exitStart));
  assert.equal(sampleNode(model, "icon", model.end).rotation, 360);
  assert.match(EMITTERS.cta(model).html, /<span id="m1-icon" aria-hidden="true"><svg/);
});

test("cta validates its params and the pill contrast", () => {
  const bad = (params, pattern, overrides) => assert.throws(() => resolve("cta", params, overrides), pattern);
  bad({}, /cta: params\.action is required/);
  bad({ action: "Follow", handle: "@a b" }, /params\.handle must be one handle or URL without spaces/);
  bad({ action: "Follow", icon: "star", handle: "@a" }, /params\.icon must be one of "arrow", "plus", "loop", "bell", "none"/);
  bad({ action: "Follow", icon: "plus" }, /params\.icon needs params\.handle/);
  bad({ action: "Follow", loop: "yes" }, /params\.loop must be true or false/);
  bad({ action: "Follow", emphasis: "later" }, /params\.emphasis\[0\]\.text "later" must match whole words/);
  bad({ action: "Follow" }, /needs a scene of at least 2 s/, { duration: 1.5 });
  bad({ action: "Follow", handle: "@a" }, /brand contrast too low: ink on primary/, { brand: { colors: { ...BRAND.colors, ink: "#ffffff" } } });
  assert.ok(resolve("cta", { action: "Follow" }, { brand: { colors: { ...BRAND.colors, ink: "#ffffff" } } }), "no pill, no ink check");
});

test("cta fits repo URLs: a 64-character handle limit, and the pill and detail shrink to the 44 px floor before failing", () => {
  const repo = "github.com/rogerchappel/launchclip";
  // Landscape: the full repo URL fits at the default 50 px.
  const wide = resolve("cta", { action: "Star it on GitHub", handle: repo, detail: `Open source: ${repo}` }, { format: LANDSCAPE, aspect: "16:9" });
  assert.equal(wide.content.handle, repo);
  assert.equal(wide.styles["pill-body"].fontSize, "50px");
  assert.equal(wide.styles.detail.fontSize, "52px");
  assert.deepEqual(wide.content.detailLines, [`Open source: ${repo}`]);
  // Portrait: the detail that failed in the blind test ("too long for two lines") now resolves
  // at the floor or above, wrapping the URL after a slash when words alone cannot fit.
  const tall = resolve("cta", { action: "Star it on GitHub", detail: `Open source: ${repo}`, handle: "rogerchappel/launchclip" });
  assert.ok(tall.content.detailLines.length <= 2);
  assert.equal(tall.content.detailLines.join(" ").replace(/\/ /g, "/"), `Open source: ${repo}`.replace(/\/ /g, "/"));
  assert.ok(Math.min(...tall.content.keyTextPx) >= 44, `key text ${tall.content.keyTextPx}`);
  // A handle a little too wide at 50 px shrinks instead of failing.
  const shrunk = resolve("cta", { action: "Star it", handle: "rogerchappel/launchclip-cli", icon: "none" });
  assert.ok(Number.parseFloat(shrunk.styles["pill-body"].fontSize) < 50 && Number.parseFloat(shrunk.styles["pill-body"].fontSize) >= 44);
  // The default sample is untouched (50 px pill, 52 px detail).
  const sample = resolve("cta", CTA);
  assert.equal(sample.styles["pill-body"].fontSize, "50px");
  assert.equal(sample.styles["pill-body"].gap, "20px");
  assert.equal(sample.styles.detail.fontSize, "52px");
  // Past the floor it still fails, naming the floor and the github.com/ hint.
  assert.throws(() => resolve("cta", { action: "Star it", handle: repo }), /needs \d+ px even at the 44 px text floor.*drop the 'github\.com\/' prefix/);
  assert.throws(() => resolve("cta", { action: "Star it", handle: `https://${"x".repeat(60)}` }), /params\.handle must be a string of 1–64 characters/);
});

test("cta parity fixture resolves", async () => {
  await checkFixture("a-cat-cta.json");
});

test("hook-title parity fixture and the golden story's s1 resolve", async () => {
  await checkFixture("a-cat-hook-title.json");
  const golden = JSON.parse(await readFile(path.join(ROOT, "examples", "story", "cooling.story.json"), "utf8"));
  const s1 = golden.scenes.find((scene) => scene.id === "s1");
  const model = MODULES["hook-title"].resolve(s1.params, { id: "s1", start: s1.start, duration: s1.end - s1.start, format: golden.format, brand: golden.brand });
  checkContract(model, { captions: false });
});

test("text fit scales with the brand family width from the font registry", () => {
  const params = { headline: "Hot coffee cools fast, then crawls." };
  const anton = resolve("hook-title", params);
  const unbounded = resolve("hook-title", params, { brand: { ...BRAND, fonts: { ...BRAND.fonts, display: "unbounded" } } });
  assert.match(unbounded.fonts.display, /^'Unbounded', 'Anton'/);
  assert.ok(unbounded.content.size < anton.content.size * 0.8, `Unbounded sets about 1.9x wider than Anton, so its headline is smaller (${unbounded.content.size} vs ${anton.content.size})`);
  const poppins = resolve("hook-title", params, { brand: { ...BRAND, fonts: { ...BRAND.fonts, display: "poppins" } } });
  assert.equal(poppins.content.size, anton.content.size, "a family outside the registry keeps the role calibration");
});

test("HyperFrames: GSAP owns animated transforms (none in the stylesheet) and an exit at the clip end is hard-killed", () => {
  const model = resolve("hook-title", HOOK);
  const { css, motion } = EMITTERS["hook-title"](model);
  const animated = new Set(model.animations.map((a) => a.node));
  for (const node of animated) {
    const id = node === "root" ? model.id : `${model.id}-${node}`;
    const rule = css.match(new RegExp(`#${id}\\{([^}]*)\\}`))?.[1] ?? "";
    assert.doesNotMatch(rule, /(^|;)transform:/, id);
    assert.match(motion, new RegExp(`tl\\.set\\("#${id}", \\{[^}]*\\}, ${model.start}\\);`), `${id} starts from a tl.set`);
  }
  const end = model.start + model.duration;
  const exits = model.animations.filter((a) => Math.abs(a.start + a.duration - end) < 1e-3);
  assert.ok(exits.length > 0, "the sample exits at its clip end");
  for (const a of exits) assert.match(motion, new RegExp(`tl\\.set\\("#${a.node === "root" ? model.id : `${model.id}-${a.node}`}", \\{[^}]*"force3D":false\\}, ${end}\\);`));
});

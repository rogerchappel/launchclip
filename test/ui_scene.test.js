import assert from "node:assert/strict";
import test from "node:test";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { uiReadingWords } from "@launchclip/core/catalog-i-ui.mjs";
import { resolveAnchor, resolveUiAnchors, validateStory } from "@launchclip/core/story.mjs";
import { UI_KINDS, UI_RUNTIME, paintUi } from "@launchclip/core/ui-runtime.mjs";
import { emitCatalogH } from "../kit/hyperframes/catalog-h.mjs";
import { motionBlurArgs, motionBlurFilter, motionBlurSamples } from "../src/motion_blur.js";
import { createHyperframesRenderer } from "../src/renderers/hyperframes.js";

const BRAND = { colors: { bg: "#0a0b08", primary: "#c8ff3a", accent: "#c8ff3a", ink: "#0a0b08", paper: "#f4f6ee" }, fonts: { display: "inter", body: "inter", meta: "jetbrains-mono" } };
const PANEL = { kind: "timeline", rect: { x: 50, y: 400, width: 980, height: 760 }, at: 0, enter: "zoom", props: { title: "sequence_01", clipAt: 1.5, tracks: [{ label: "A1", kind: "audio" }, { label: "A2", kind: "sfx", clips: [{ label: "BOING!", x: 0.02, width: 0.3, tone: "alert", at: 0.6, flipAt: 3, flipLabel: "whoosh.wav" }] }] } };
const HEADLINE = { kind: "headline", rect: { x: 60, y: 250, width: 960, height: 130 }, at: 0.1, enter: "slam", props: { text: "SOUNDS CHEAP", tone: "alert", size: 118 }, beats: [{ at: 3, set: { text: "REAL SOUND", tone: "accent" }, cue: "success" }] };

function resolve(elements, { width = 1080, height = 1920, captions = null } = {}) {
  const story = { schema: "launchclip.story.v1", lane: "motion", format: { width, height, fps: 30, duration: 10 }, brand: BRAND, scenes: [], resolved: { duration: 10, fps: 30 }, ...(captions ? { overlays: [{ type: "captions", position: captions }] } : {}) };
  const scene = { id: "s1", module: "ui-scene", start: 1, end: 6, params: { elements } };
  return resolveModule(scene, { ...story, scenes: [scene] });
}

// A host that records what the painter writes.
const host = () => ({ innerHTML: "" });

test("ui-scene: resolves to a painted host spec with the brand's theme, and cues on slams and beats", () => {
  const model = resolve([HEADLINE, PANEL]);
  const spec = model.content.ui["s1-ui"];
  assert.equal(spec.start, 1);
  assert.deepEqual([spec.width, spec.height, spec.unit], [1080, 1920, 1]);
  assert.equal(spec.theme.accent, "#c8ff3a");
  assert.equal(spec.theme.ink, "#f4f6ee");
  assert.equal(spec.theme.alert, "#ff4b3e");
  assert.equal(spec.elements.length, 2);
  const cues = model.events.filter((event) => event.cue).map((event) => [event.name, event.time, event.cue]);
  assert.deepEqual(cues, [["enter", 1, "whoosh-soft"], ["enter", 1.1, "impact"], ["beat", 4, "success"]]);
});

test("ui-scene: elements stay on the stage and out of the caption band unless they bleed", () => {
  assert.throws(() => resolve([{ ...PANEL, rect: { x: 50, y: 400, width: 980, height: 900 } }]), /caption band/);
  assert.throws(() => resolve([{ ...PANEL, rect: { x: 0, y: 400, width: 980, height: 700 } }]), /must sit on the stage/);
  assert.doesNotThrow(() => resolve([{ ...PANEL, rect: { x: 0, y: 400, width: 1080, height: 900 }, bleed: true }]));
  // Mid-frame captions: the band moves to the middle, so the lower stage opens up.
  const low = { ...PANEL, rect: { x: 50, y: 1100, width: 980, height: 340 } };
  assert.throws(() => resolve([low]), /caption band \(y 1190/);
  assert.doesNotThrow(() => resolve([low], { captions: "middle" }));
  assert.throws(() => resolve([{ ...PANEL, rect: { x: 50, y: 700, width: 980, height: 300 } }], { captions: "middle" }), /caption band \(y 845/);
  // The layout checks see each element: the biggest as the module's rect, the rest as parts.
  const layout = resolve([HEADLINE, PANEL]).layout;
  assert.deepEqual(layout.rect, { x: 50, y: 400, width: 980, height: 760 });
  assert.deepEqual(layout.parts, [{ id: "el-0", rect: { x: 60, y: 250, width: 960, height: 130 }, role: "text", start: 1.1, end: 6 }]);
  // A scene that opens the video is built at frame 0 with enter: "cut".
  const opened = host();
  paintUi(opened, resolve([{ ...PANEL, enter: "cut" }]).content.ui["s1-ui"], 1);
  assert.doesNotMatch(opened.innerHTML, /^.{0,400}visibility:hidden/s);
  assert.match(opened.innerHTML, /sequence_01/);
  // 16:9: the landscape stage and band.
  assert.doesNotThrow(() => resolve([{ ...HEADLINE, rect: { x: 100, y: 60, width: 1200, height: 140 } }], { width: 1920, height: 1080 }));
});

test("ui-scene: refuses unknown kinds, late openings, headlines too wide and children before their parent", () => {
  assert.throws(() => resolve([{ ...PANEL, kind: "spaceship" }]), /kind must be one of/);
  assert.throws(() => resolve([{ ...PANEL, at: 1.2 }]), /put something on screen by 0.6 s/);
  assert.throws(() => resolve([{ ...HEADLINE, props: { text: "A HEADLINE FAR TOO LONG TO FIT", size: 140 } }]), /wider than its rect/);
  assert.throws(() => resolve([{ ...HEADLINE, beats: [{ at: 2, set: { text: "THIS ONE IS MUCH TOO LONG TOO" } }] }]), /wider than its rect/);
  assert.throws(() => resolve([{ kind: "window", rect: { x: 60, y: 300, width: 960, height: 700 }, at: 0.5, props: { title: "w" }, children: [{ kind: "chip", rect: { x: 10, y: 80, width: 200, height: 60 }, at: 0.2, props: { text: "x" } }] }]), /before its parent enters/);
  assert.throws(() => resolve([{ ...HEADLINE, props: { text: "<script>" } }]), /angle brackets/);
});

test("paintUi: a pure function of time, entrances hidden before their time, beats applied in order", () => {
  const spec = resolve([HEADLINE, PANEL]).content.ui["s1-ui"];
  const a = host(), b = host();
  paintUi(a, spec, 3.2);
  paintUi(b, spec, 3.2);
  assert.equal(a.innerHTML, b.innerHTML, "same t, same HTML");
  const before = host();
  paintUi(before, spec, 1.05);
  assert.doesNotMatch(before.innerHTML, /SOUNDS CHEAP/, "the headline enters at 0.1 s");
  const early = host(), late = host();
  paintUi(early, spec, 2.5);
  paintUi(late, spec, 4.5);
  assert.match(early.innerHTML, /SOUNDS CHEAP/);
  assert.match(late.innerHTML, /REAL SOUND/);
  assert.match(late.innerHTML, /whoosh\.wav/, "the clip flipped on its flipAt");
});

test("paintUi: every component kind draws, and user text is escaped", () => {
  const rect = { x: 60, y: 300, width: 960, height: 700 };
  for (const kind of UI_KINDS) {
    const out = host();
    paintUi(out, { start: 0, width: 1080, height: 1920, unit: 1, theme: resolve([HEADLINE]).content.ui["s1-ui"].theme, fonts: { display: "Inter", body: "Inter", mono: "\"JetBrains Mono\", monospace" }, elements: [{ kind, rect, at: 0, enter: "up", props: { text: "a & b", title: "t", query: "q", prompt: "p" }, beats: [], children: [] }] }, 2);
    assert.ok(out.innerHTML.length > 100, kind);
    assert.doesNotMatch(out.innerHTML, /style="[^"]*"JetBrains/, `${kind}: a quoted font family never ends a style attribute`);
    assert.doesNotMatch(out.innerHTML, /a & b/, `${kind}: text is escaped`);
  }
});

test("UI_RUNTIME: the painter's source runs on its own and draws what the module does", () => {
  const spec = resolve([HEADLINE, PANEL]).content.ui["s1-ui"];
  const window = {};
  new Function("window", UI_RUNTIME)(window);
  const page = host(), node = host();
  window.lcPaintUi(page, spec, 2.4);
  paintUi(node, spec, 2.4);
  assert.equal(page.innerHTML, node.innerHTML);
  assert.doesNotMatch(UI_RUNTIME, /Math\.random|Date\.now|new Date|setTimeout|setInterval/);
});

test("HyperFrames: the host is painted from a proxy tween over the scene", () => {
  const out = emitCatalogH(resolve([HEADLINE, PANEL]));
  assert.match(out.html, /id="s1-ui"/);
  assert.match(out.motion, /window\.lcPaintUi = window\.lcPaintUi \|\|/);
  assert.match(out.motion, /tl\.fromTo\(clock, \{t: 1\}, \{t: 6, duration: 5, ease: 'none', immediateRender: false, onUpdate: function \(\) \{ window\.lcPaintUi\(host, spec, clock\.t\); \}\}, 1\)/);
});

test("story: ui-scene times may be word anchors, resolved to seconds from the scene start", () => {
  const words = [{ text: "exact", start: 12.5, end: 12.9 }, { text: "frame", start: 13, end: 13.3 }];
  const params = resolveUiAnchors({ elements: [{ at: "word:exact-0.2", out: 3, props: { unlockAt: "word:frame", text: "word:exact", cards: [{ unlockAt: "word:exact" }], doneAt: ["word:exact", 2] }, beats: [{ at: "word:frame", set: { clipAt: "word:exact" } }] }] }, 10, (value) => resolveAnchor(value, { words }));
  assert.deepEqual(resolveUiAnchors({ elements: [{ at: 0, props: { meter: { level2At: "word:frame" } } }] }, 10, (value) => resolveAnchor(value, { words })).elements[0].props.meter.level2At, 3, "keys with digits (level2At) resolve too");
  assert.deepEqual(params.elements[0], { at: 2.3, out: 3, props: { unlockAt: 3, text: "word:exact", cards: [{ unlockAt: 2.5 }], doneAt: [2.5, 2] }, beats: [{ at: 3, set: { clipAt: 2.5 } }] });
});

test("story: motion.blur is true, false or {samples: 2–4}", () => {
  const base = { schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 6 }, brand: BRAND, scenes: [{ id: "s1", module: "hook-title", start: 0, end: 6, params: { title: "Hi" } }] };
  const errors = (blur) => validateStory({ ...base, motion: { blur } }).errors.filter((message) => /blur/.test(message));
  assert.deepEqual(errors(true), []);
  assert.deepEqual(errors({ samples: 4 }), []);
  assert.match(errors({ samples: 8 })[0], /samples must be 2, 3 or 4/);
  assert.match(errors({ shutter: 1 })[0], /motion\.blur\.shutter is not supported/);
});

test("motion blur: samples per frame, a centred blend and a renderer pass at samples × fps", async () => {
  assert.equal(motionBlurSamples({ motion: { blur: true } }), 3);
  assert.equal(motionBlurSamples({ motion: { blur: { samples: 2 } } }), 2);
  assert.equal(motionBlurSamples({ motion: { blur: false } }), 0);
  assert.equal(motionBlurSamples({}), 0);
  assert.equal(motionBlurFilter(3, 30), "tmix=frames=3:weights='1 1 1',select='eq(mod(n\\,3)\\,1)',setpts=N/(30*TB)");
  const blendArgs = motionBlurArgs("in.mp4", "out.mp4", { samples: 3, fps: 30 });
  assert.deepEqual([blendArgs[blendArgs.indexOf("-r") + 1], blendArgs[blendArgs.indexOf("-c:a") + 1], blendArgs.at(-1)], ["30", "copy", "out.mp4"]);
  const calls = [];
  const renderer = createHyperframesRenderer({ run: async (command, args) => { calls.push(args); return { ok: true, stdout: "", stderr: "", code: 0 }; } });
  const blends = [];
  const result = await renderer.render("/tmp/hf", "/tmp/out/final.mp4", { motionBlur: { samples: 3, fps: 30 }, blend: async (input, output, options) => blends.push({ input, output, ...options }) });
  const args = calls[0];
  assert.equal(args[args.indexOf("--fps") + 1], "90");
  assert.equal(args[args.indexOf("--output") + 1], "/tmp/out/final.mp4.subframes.mp4");
  assert.deepEqual(blends, [{ input: "/tmp/out/final.mp4.subframes.mp4", output: "/tmp/out/final.mp4", samples: 3, fps: 30 }]);
  assert.deepEqual(result.motionBlur, { samples: 3 });
  calls.length = 0;
  await renderer.render("/tmp/hf", "/tmp/out/plain.mp4", {});
  assert.equal(calls[0].includes("--fps"), false, "no blur: the composition's own fps");
});

test("text hold: a ui-scene is read by its headlines; panel labels are glanced at", () => {
  const params = { elements: [HEADLINE, PANEL, { kind: "window", rect: PANEL.rect, at: 0, props: { title: "toolkit" }, children: [{ kind: "headline", rect: { x: 0, y: 0, width: 900, height: 100 }, at: 0.2, props: { text: "TOOL ONE" } }] }] };
  // SOUNDS CHEAP / REAL SOUND (2) + TOOL ONE (2); track, clip and window labels do not count.
  assert.equal(uiReadingWords(params), 4);
});

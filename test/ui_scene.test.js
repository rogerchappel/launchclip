import assert from "node:assert/strict";
import test from "node:test";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { uiReadingWords } from "@launchclip/core/catalog-i-ui.mjs";
import { resolveAnchor, resolveStory, resolveUiAnchors, validateStory } from "@launchclip/core/story.mjs";
import { UI_KINDS, UI_RUNTIME, paintUi } from "@launchclip/core/ui-runtime.mjs";
import { emitCatalogH } from "../kit/hyperframes/catalog-h.mjs";
import { motionBlurArgs, motionBlurFilter, motionBlurOptions, motionBlurSamples } from "../src/motion_blur.js";
import { createHyperframesRenderer } from "../src/renderers/hyperframes.js";

const BRAND = { colors: { bg: "#0a0b08", primary: "#c8ff3a", accent: "#c8ff3a", ink: "#0a0b08", paper: "#f4f6ee" }, fonts: { display: "inter", body: "inter", meta: "jetbrains-mono" } };
const PANEL = { kind: "timeline", rect: { x: 50, y: 400, width: 980, height: 760 }, at: 0, enter: "zoom", props: { title: "sequence_01", clipAt: 1.5, tracks: [{ label: "A1", kind: "audio" }, { label: "A2", kind: "sfx", clips: [{ label: "BOING!", x: 0.02, width: 0.3, tone: "alert", at: 0.6, flipAt: 3, flipLabel: "whoosh.wav" }] }] } };
const HEADLINE = { kind: "headline", rect: { x: 60, y: 290, width: 960, height: 130 }, at: 0.1, enter: "slam", props: { text: "SOUNDS CHEAP", tone: "alert", size: 110 }, beats: [{ at: 3, set: { text: "REAL SOUND", tone: "accent" }, cue: "success" }] };

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

test("ui-scene: text stays in the safe zone clear of the captions; panels use the stage and may run under them", () => {
  // Panels: the whole stage, under the bottom caption band included.
  assert.doesNotThrow(() => resolve([{ ...PANEL, rect: { x: 40, y: 400, width: 1000, height: 1050 } }]));
  assert.throws(() => resolve([{ ...PANEL, rect: { x: 0, y: 400, width: 980, height: 700 } }]), /must sit on the stage/);
  assert.doesNotThrow(() => resolve([{ ...PANEL, rect: { x: 0, y: 400, width: 1080, height: 900 }, bleed: true }]));
  // A tilted panel is checked at its footprint.
  const plane = { kind: "scan-plane", rect: { x: 60, y: 900, width: 960, height: 520 }, at: 0, props: {} };
  assert.doesNotThrow(() => resolve([plane]));
  assert.throws(() => resolve([{ ...plane, tilt: { x: 38, z: -14, y: -12 } }]), /turned by its tilt/);
  // Text: the box it sets in, inside the safe zone and clear of the band.
  assert.throws(() => resolve([{ ...HEADLINE, rect: { x: 60, y: 240, width: 960, height: 130 } }]), /platform safe zone/);
  assert.throws(() => resolve([{ kind: "chip", rect: { x: 300, y: 1250, width: 400, height: 80 }, at: 0, props: { text: "CLIPPING" } }]), /caption band \(y 1190/);
  assert.doesNotThrow(() => resolve([{ kind: "chip", rect: { x: 300, y: 1250, width: 400, height: 80 }, at: 0, props: { text: "CLIPPING" } }], { captions: "middle" }));
  assert.throws(() => resolve([{ kind: "chip", rect: { x: 300, y: 900, width: 400, height: 80 }, at: 0, props: { text: "CLIPPING" } }], { captions: "middle" }), /caption band \(y 845/);
  // Panels too small to draw legibly.
  assert.throws(() => resolve([{ kind: "meter", rect: { x: 60, y: 400, width: 900, height: 225 }, at: 0, props: {} }]), /a meter needs at least 560×320/);
  assert.throws(() => resolve([{ kind: "lock-cards", rect: { x: 60, y: 400, width: 900, height: 380 }, at: 0, props: { cards: [{ name: "A" }, { name: "B" }, { name: "C" }] } }]), /a card needs at least 110 px/);
  assert.throws(() => resolve([{ kind: "pad-grid", rect: { x: 60, y: 400, width: 900, height: 400 }, at: 0, props: {} }]), /a pad-grid needs at least 600×480/);
  assert.throws(() => resolve([{ kind: "scan-plane", rect: { x: 60, y: 400, width: 500, height: 520 }, at: 0, props: {} }]), /a scan-plane needs at least 600×360/);
  // A comment scales its stacked parts to fit, to no less than 0.75: a reply with links stacks to 485 px.
  const comment = { kind: "comment", at: 0, props: { text: "SOUND", reply: "Here are the links", links: ["Open link"] } };
  assert.throws(() => resolve([{ ...comment, rect: { x: 130, y: 850, width: 820, height: 185 } }]), /stacks to 485 px .* height of 364 or more/);
  assert.doesNotThrow(() => resolve([{ ...comment, rect: { x: 130, y: 850, width: 820, height: 364 } }]));
  assert.doesNotThrow(() => resolve([{ ...comment, props: { text: "SOUND" }, rect: { x: 130, y: 850, width: 820, height: 195 } }]));
  // The layout checks: text boxes as text, panels as media; no hold drift.
  const layout = resolve([HEADLINE, PANEL]).layout;
  assert.equal(layout.drift, false);
  assert.deepEqual(layout.rect, { x: 144, y: 297.25, width: 792, height: 115.5 });
  assert.deepEqual(layout.parts, [{ id: "el-1", rect: { x: 50, y: 400, width: 980, height: 760 }, role: "media", start: 1, end: 6, over: ["self"] }]);
  // A scene's own elements may overlap (a chip on a panel); other scenes still collide.
  assert.deepEqual(layout.allowOcclusion, ["s1-el-1"]);
  assert.equal(resolve([PANEL]).layout.role, "media");
  // A scene that opens the video is built at frame 0 with enter: "cut".
  const opened = host();
  paintUi(opened, resolve([{ ...PANEL, enter: "cut" }]).content.ui["s1-ui"], 1);
  assert.doesNotMatch(opened.innerHTML, /^.{0,400}visibility:hidden/s);
  assert.match(opened.innerHTML, /sequence_01/);
  // 16:9: the landscape stage and band.
  assert.doesNotThrow(() => resolve([{ ...HEADLINE, rect: { x: 100, y: 80, width: 1200, height: 140 } }], { width: 1920, height: 1080 }));
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

test("story: motion.blur is true, false or {samples: 2–6, shutter: 0.25–1.5}", () => {
  const base = { schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 6 }, brand: BRAND, scenes: [{ id: "s1", module: "hook-title", start: 0, end: 6, params: { title: "Hi" } }] };
  const errors = (blur) => validateStory({ ...base, motion: { blur } }).errors.filter((message) => /blur/.test(message));
  assert.deepEqual(errors(true), []);
  assert.deepEqual(errors({ samples: 4 }), []);
  assert.deepEqual(errors({ samples: 6, shutter: 1.5 }), []);
  assert.match(errors({ samples: 8 })[0], /samples must be a whole number from 2 to 6/);
  assert.match(errors({ shutter: 2 })[0], /shutter must be the share of a frame the blur spans, 0\.25 to 1\.5/);
  assert.match(errors({ angle: 1 })[0], /motion\.blur\.angle is not supported/);
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

test("motion blur: a shutter sets the sub-frames per frame; over one frame the windows overlap", async () => {
  const { resolveMotionBlur, captionSnapOffset, windowOffsets } = await import("@launchclip/core/motion-blur.mjs");
  assert.equal(resolveMotionBlur({}), null);
  assert.equal(resolveMotionBlur({ motion: { blur: false } }), null);
  // true is the original blend: 3 sub-frames, 3 per frame.
  assert.deepEqual(resolveMotionBlur({ motion: { blur: true } }), { samples: 3, rate: 3, shutter: 1, centre: 1, overlap: false, cost: 3 });
  // Heavy: 6 samples over 1.5 frames from 4 sub-frames a frame (4× render).
  assert.deepEqual(resolveMotionBlur({ motion: { blur: { samples: 6, shutter: 1.5 } } }), { samples: 6, rate: 4, shutter: 1.5, centre: 3, overlap: true, cost: 4 });
  assert.equal(resolveMotionBlur({ motion: { blur: { samples: 4, shutter: 1.33 } } }).rate, 3);
  // A short shutter with many samples is clamped at 8 sub-frames a frame.
  assert.equal(resolveMotionBlur({ motion: { blur: { samples: 6, shutter: 0.25 } } }).rate, 8);
  assert.deepEqual(windowOffsets(3), [-1, 1]);
  assert.deepEqual(windowOffsets(6), [-2, 3]);
  assert.equal(captionSnapOffset({ rate: 3 }), 0.5);
  assert.equal(captionSnapOffset({ rate: 4 }), 0.625);
  assert.deepEqual(motionBlurOptions({ motion: { blur: { samples: 6, shutter: 1.5 } } }, 30), { samples: 6, rate: 4, shutter: 1.5, fps: 30 });
  // tmix over 6, keeping the sub-frame 3 past each frame's own (every 4th).
  assert.equal(motionBlurFilter(6, 30, { rate: 4 }), "tmix=frames=6:weights='1 1 1 1 1 1',select='eq(mod(n\\,4)\\,3)',setpts=N/(30*TB)");
  const calls = [];
  const blends = [];
  const renderer = createHyperframesRenderer({ run: async (command, args) => { calls.push(args); return { ok: true, stdout: "", stderr: "", code: 0 }; } });
  const result = await renderer.render("/tmp/hf-none", "/tmp/out/heavy.mp4", { motionBlur: { samples: 6, rate: 4, fps: 30 }, blend: async (input, output, options) => blends.push(options) });
  assert.equal(calls[0][calls[0].indexOf("--fps") + 1], "120");
  assert.deepEqual(blends, [{ samples: 6, fps: 30, rate: 4 }]);
  assert.deepEqual(result.motionBlur, { samples: 6, rate: 4 });
});

test("motion blur: for any shutter, no output frame shows two caption words", async () => {
  const { snapCaptionChunks } = await import("@launchclip/core/captions.mjs");
  const { resolveMotionBlur, captionSnapOffset, guardFrames, windowOffsets } = await import("@launchclip/core/motion-blur.mjs");
  const fps = 30;
  const raw = [{ start: 0.41, end: 1.234, words: [{ text: "when", start: 0.41, end: 0.7 }, { text: "the", start: 0.71, end: 1.234 }] }, { start: 1.3, end: 2.02, words: [{ text: "cut", start: 1.3, end: 2.02 }] }];
  for (const samples of [2, 3, 4, 5, 6]) {
    for (const shutter of [0.25, 0.5, 0.75, 1, 1.25, 1.5]) {
      const plan = resolveMotionBlur({ motion: { blur: { samples, shutter } } });
      const chunks = snapCaptionChunks(raw, fps, captionSnapOffset(plan));
      const changes = chunks.flatMap((chunk) => [chunk.start, chunk.end, ...chunk.words.flatMap((word) => [word.start, word.end])]);
      const guarded = new Set(guardFrames(plan, changes, fps));
      // The sub-frame times a frame blends: its heavy window, or on a guarded
      // frame (its caption band) the one-frame window of rate samples.
      const window = (frame, n) => { const [a, b] = windowOffsets(n); return Array.from({ length: b - a + 1 }, (_, k) => (frame * plan.rate + a + k) / (fps * plan.rate)); };
      for (const t of changes) {
        const f = Math.round(t * fps);
        for (let frame = Math.max(0, f - 2); frame <= f + 2; frame += 1) {
          const own = window(frame, guarded.has(frame) ? plan.rate : plan.samples);
          assert.ok(own.every((s) => s < t) || own.every((s) => s > t), `samples ${samples} shutter ${shutter} t=${t}: frame ${frame} blends across the change`);
        }
      }
      if (!plan.overlap) assert.equal(guarded.size, 0);
    }
  }
});

test("motion blur: guarded frames take the feathered caption band from the one-frame blend", async () => {
  const { guardRect, MOTION_BLUR_GUARD_FILE } = await import("@launchclip/core/motion-blur.mjs");
  const rect = guardRect({ bandTop: 0.52, band: { height: 0.12 } }, { width: 1080, height: 1920 });
  assert.deepEqual(rect, { x: 0, y: 922, width: 1080, height: 384 });
  assert.deepEqual(guardRect({ bandTop: 0.52, band: { height: 0.12 } }, { width: 1080, height: 1920 }, true), { x: 0, y: 0, width: 1080, height: 1920 });
  const filter = motionBlurFilter(6, 30, { rate: 4, guard: { frames: [3, 4, 5, 9], rect } });
  assert.match(filter, /^\[0:v\]split=2/);
  assert.match(filter, /tmix=frames=4:weights='1 1 1 1',select='eq\(mod\(n\\,4\)\\,2\)'/);
  assert.match(filter, /crop=1080:384:0:922,format=yuva420p,geq=/);
  assert.match(filter, /overlay=0:922:enable='between\(n\\,3\\,5\)\+eq\(n\\,9\)'\[v\]$/);
  const args = motionBlurArgs("in.mp4", "out.mp4", { samples: 6, rate: 4, fps: 30, guard: { frames: [3], rect } });
  assert.deepEqual(args.slice(args.indexOf("-filter_complex") + 2, args.indexOf("-filter_complex") + 6), ["-map", "[v]", "-map", "0:a?"]);
  // A shutter of one frame or less needs no guard: the plain filter.
  assert.equal(motionBlurFilter(3, 30, { guard: { frames: [3], rect } }), motionBlurFilter(3, 30));
  assert.equal(MOTION_BLUR_GUARD_FILE, "launchclip-motion-blur.json");
});

test("text hold: a ui-scene is read by its headlines; panel labels are glanced at", () => {
  const params = { elements: [HEADLINE, PANEL, { kind: "window", rect: PANEL.rect, at: 0, props: { title: "toolkit" }, children: [{ kind: "headline", rect: { x: 0, y: 0, width: 900, height: 100 }, at: 0.2, props: { text: "TOOL ONE" } }] }] };
  // SOUNDS CHEAP / REAL SOUND (2) + TOOL ONE (2); track, clip and window labels do not count.
  assert.equal(uiReadingWords(params), 4);
});

test("motion blur: caption changes land between two frames' sub-frames, so no frame blends two words", async () => {
  const { snapCaptionChunks } = await import("@launchclip/core/captions.mjs");
  const fps = 30, samples = 3;
  const chunks = snapCaptionChunks([{ start: 0.41, end: 1.234, words: [{ text: "when", start: 0.41, end: 0.7 }, { text: "the", start: 0.71, end: 1.234 }] }], fps);
  const changes = [chunks[0].start, chunks[0].end, ...chunks[0].words.flatMap((word) => [word.start, word.end])];
  for (const t of changes) {
    // Sub-frames of output frame f sit at f/fps + {-1, 0, 1}/(fps·samples).
    const f = Math.round(t * fps);
    for (let frame = f - 1; frame <= f + 1; frame += 1) {
      const own = [-1, 0, 1].map((k) => frame / fps + k / (fps * samples));
      assert.ok(own.every((s) => s < t) || own.every((s) => s > t), `t=${t}: frame ${frame} blends across the change`);
    }
  }
  assert.deepEqual(chunks[0].words.map((word) => word.start), [0.417, 0.717]);
});

test("word-chip captions: one bare uppercase word, low-centre, where the layout check puts the band", async () => {
  const { captionBandFor, captionBandTop, captionPlan, shownWords } = await import("@launchclip/core/captions.mjs");
  const { captionBandAt, profileGeometry } = await import("@launchclip/core/layout-check.mjs");
  assert.deepEqual(shownWords([{ text: "now," }, { text: '"timeline."' }, { text: "don't" }, { text: "…" }], { punctuation: false }).map((word) => word.text), ["now", "timeline", "don't", "…"]);
  const format = { width: 1080, height: 1920 };
  const band = captionBandAt(profileGeometry(format, "shorts").captionBand, format, "low");
  // The two band sources differ by under a pixel (230 px in the profile, 12% of 1920 in the captions).
  assert.ok(Math.abs(band.y - captionBandTop(format, "low") * 1920) < 1);
  assert.ok(Math.abs(band.y + band.height / 2 - 0.58 * 1920) < 1);
  assert.ok(Math.abs(captionBandFor(format).height * 1920 - band.height) < 1);
  const chunks = [{ id: "cap-001", start: 0.4, end: 1.2, words: [{ text: "now,", start: 0.4, end: 0.7 }] }];
  const plan = captionPlan(chunks, { type: "captions", preset: "word-chip", position: "low" }, { brand: BRAND, format });
  const texts = [];
  const walk = (node) => { if (node.text) texts.push(node.text); (node.children ?? []).forEach(walk); };
  plan.nodes.forEach(walk);
  assert.deepEqual(texts, ["now"]);
  assert.match(plan.css, /text-transform: uppercase/);
});

test("word-chip captions: one word at a time even when a word is shorter than the entrance", async () => {
  const { captionPlan, indexCaptionTweens, captionElementStateAt, snapCaptionChunks } = await import("@launchclip/core/captions.mjs");
  // "a" lasts 0.06 s, under the line's 0.12 s minimum before its exit.
  const chunks = snapCaptionChunks([{ start: 1.1, end: 1.16, words: [{ text: "a", start: 1.1, end: 1.16 }] }, { start: 1.17, end: 1.6, words: [{ text: "slick", start: 1.17, end: 1.6 }] }], 30);
  const plan = captionPlan(chunks, { type: "captions", preset: "word-chip", position: "low" }, { brand: BRAND, format: { width: 1080, height: 1920 } });
  const index = indexCaptionTweens(plan.tweens);
  for (let k = 90; k < 160; k += 1) {
    const t = k / 90;
    const shown = plan.nodes.filter((line) => (captionElementStateAt(index, line.id, t).opacity ?? 0) > 0.02);
    assert.ok(shown.length <= 1, `two words at ${t.toFixed(3)} s`);
  }
});

test("holds gate: a ui-scene's component changes (typing, lines, unlocks) count as motion", async () => {
  const { holdGate } = await import("../src/movement_guardrails.js");
  const terminal = (lines) => ({ kind: "terminal", rect: { x: 60, y: 400, width: 960, height: 700 }, at: 0, enter: "cut", props: { title: "t", prompt: "make a sound", typeAt: 0.2, lines } });
  const story = (lines) => resolveStory({ schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 8 }, brand: BRAND, scenes: [{ id: "s1", module: "ui-scene", start: 0, end: 8, params: { elements: [terminal(lines)] } }] });
  const still = holdGate(story([]));
  assert.ok(still.findings.some((finding) => finding.rule === "static-hold"), "a terminal that only types its prompt holds still");
  const typing = holdGate(story([1.5, 2.5, 3.5, 4.5, 5.5, 6.5].map((at, k) => ({ at, key: `k${k}`, text: "line" }))));
  assert.deepEqual(typing.findings.filter((finding) => finding.rule === "static-hold"), [], JSON.stringify(typing.findings));
});

// Rich headlines: a small setup line over a big payoff line, a huge
// counted stat over a small word, one accent word in a line.
const RICH = { kind: "headline", rect: { x: 80, y: 300, width: 860, height: 260 }, at: 0.2, props: { lines: [{ text: "RIGHT PLACE.", size: "s" }, { text: "RIGHT *LEVEL.*", size: "l" }] } };
const STAT = { kind: "headline", rect: { x: 80, y: 300, width: 860, height: 260 }, at: 0.2, props: { lines: [{ text: "1,250+", size: "xl", accent: true, count: true }, { text: "CREATORS", size: "s" }] } };

test("rich headline: lines of mixed sizes are measured as stacked, each at its own size", async () => {
  const { uiTextBox } = await import("@launchclip/core/catalog-i-ui.mjs");
  // RIGHT PLACE. (12 × 52 × 0.705, tracked out) over RIGHT LEVEL. (12 × 112 × 0.6, markup out): 52 + a 7 px gap + 112.
  assert.deepEqual(uiTextBox("headline", RICH.props, RICH.rect), { x: 106.8, y: 344.5, width: 806.4, height: 171 });
  const small = uiTextBox("headline", { lines: [{ text: "RIGHT PLACE.", size: "s" }, { text: "RIGHT LEVEL.", size: "m" }] }, RICH.rect);
  assert.deepEqual([small.width, small.height], [579.12, 52 + 5 + 76]);
  // The single-line headline keeps its measure.
  assert.deepEqual(uiTextBox("headline", { text: "ABC", size: 100 }, RICH.rect), { x: 420, y: 377.5, width: 180, height: 105 });
  // A stack is checked as a whole: tall enough to reach the caption band, it fails where one big line would pass.
  const low = { ...RICH, rect: { x: 80, y: 1000, width: 860, height: 200 }, props: { lines: [{ text: "RIGHT", size: "m" }, { text: "LEVEL", size: "l" }] } };
  assert.doesNotThrow(() => resolve([{ ...low, props: { text: "LEVEL", size: 112 } }]));
  assert.throws(() => resolve([low]), /clear of the caption band/);
});

test("rich headline: the schema refuses lines that do not fit or do not parse", () => {
  const bad = (props, pattern) => assert.throws(() => resolve([{ ...RICH, props }]), pattern);
  bad({ lines: [{ text: "RIGHT LEVEL.", size: "xl" }] }, /"RIGHT LEVEL\." at size xl sets about 1440 px wide, wider than its rect/);
  bad({ lines: [{ text: "ONE", size: "xl" }, { text: "TWO", size: "l" }] }, /stack about 319 px tall, taller than their rect \(260 px\)/);
  bad({ lines: [{ text: "RIGHT *LEVEL", size: "l" }] }, /opens an accent with \*/);
  bad({ lines: [{ text: "MILLIONS", count: true }] }, /has none/);
  bad({ lines: [{ text: "A", size: "xxl" }] }, /must be one of s, m, l, xl or px/);
  bad({ text: "A", lines: [{ text: "A" }] }, /sets text or lines, not both/);
  bad({ lines: [] }, /must be a list of 1–4 lines/);
  bad({ lines: [{ text: "A", at: 0.1 }] }, /is before its headline enters/);
  assert.throws(() => resolve([{ ...RICH, beats: [{ at: 2, set: { text: "NEW" } }] }]), /change them with set\.lines/);
  assert.doesNotThrow(() => resolve([{ ...RICH, beats: [{ at: 2, set: { lines: [{ text: "NEW", size: "l" }] } }] }]));
});

test("rich headline: lines stagger in, the accent word takes the accent, a stat counts up", () => {
  const spec = resolve([RICH, { ...STAT, rect: { x: 80, y: 600, width: 860, height: 260 } }]).content.ui["s1-ui"];
  const at = (t) => { const node = host(); paintUi(node, spec, 1 + t); return node.innerHTML; };
  // At 0.25 s the setup line is up and the payoff line (0.12 s later) has not landed.
  const early = at(0.25);
  assert.match(early, /RIGHT PLACE\./);
  assert.match(early, /font-size:112px;[^"]*visibility:hidden[^"]*">RIGHT <span style="color:#c8ff3a;">LEVEL\.<\/span>/);
  // The setup line is tracked out and lighter; the payoff tight and black.
  assert.match(at(1), /font-weight:700;letter-spacing:0\.06em;white-space:nowrap;font-size:52px/);
  assert.match(at(1), /font-weight:900;letter-spacing:-0\.045em;white-space:nowrap;font-size:112px/);
  assert.doesNotMatch(at(1), /\*/);
  // The stat: from 0 to its value, with its commas, in the accent.
  assert.match(at(0.22), />0\+</);
  const mid = at(0.55).match(/>([\d,]+)\+</)[1];
  assert.ok(Number(mid.replace(/,/g, "")) > 0 && Number(mid.replace(/,/g, "")) < 1250, mid);
  assert.match(at(2), /color:#c8ff3a;[^"]*">1,250\+</);
  // The page runtime draws the same.
  const window = {};
  new Function("window", UI_RUNTIME)(window);
  const page = host(), node = host();
  window.lcPaintUi(page, spec, 1.5);
  paintUi(node, spec, 1.5);
  assert.equal(page.innerHTML, node.innerHTML);
});

test("text hold: a rich headline is read by all its lines, markup out", () => {
  assert.equal(uiReadingWords({ elements: [RICH, { ...STAT, beats: [{ at: 2, set: { lines: [{ text: "ONE *TWO* THREE FOUR" }] } }] }] }), 4 + 4);
});

test("planning guide: rich headlines pair a small setup with a big payoff, one accent word, numbers huge; its examples resolve", async () => {
  const { interfaceLines } = await import("@launchclip/core/planning-prompt.mjs");
  const guide = interfaceLines().join("\n");
  assert.match(guide, /small setup line over a big payoff line/);
  assert.match(guide, /at most one accent word per headline/);
  assert.match(guide, /Put a number huge/);
  // The guide's own examples, as a planner would place them above a panel.
  const rect = { x: 80, y: 300, width: 860, height: 270 };
  assert.doesNotThrow(() => resolve([{ kind: "headline", rect, at: 0, props: { lines: [{ text: "RIGHT PLACE.", size: "s" }, { text: "RIGHT *LEVEL.*", size: "l" }] } }]));
  assert.doesNotThrow(() => resolve([{ kind: "headline", rect, at: 0, props: { lines: [{ text: "5M+", size: "xl", accent: true, count: true }, { text: "CREATORS", size: "s" }] } }]));
});

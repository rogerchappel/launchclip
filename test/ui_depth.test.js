import assert from "node:assert/strict";
import test from "node:test";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { uiStageBox, uiTextBox } from "@launchclip/core/catalog-i-ui.mjs";
import { resolveAnchor, resolveUiAnchors } from "@launchclip/core/story.mjs";
import { uiDepthAt, uiEnter, uiExit, uiFlash, uiStageProject } from "@launchclip/core/ui-paint.mjs";
import { UI_KINDS, UI_RUNTIME, paintUi } from "@launchclip/core/ui-runtime.mjs";
import { interfaceLines } from "@launchclip/core/planning-prompt.mjs";

const BRAND = { colors: { bg: "#0a0b08", primary: "#c8ff3a", accent: "#c8ff3a", ink: "#0a0b08", paper: "#f4f6ee" }, fonts: { display: "inter", body: "inter", meta: "jetbrains-mono" } };
const HEADLINE = { kind: "headline", rect: { x: 60, y: 330, width: 960, height: 130 }, at: 0.2, props: { text: "FIX IT", size: 110 } };
const PANEL = { kind: "window", rect: { x: 90, y: 560, width: 900, height: 560 }, at: 0, enter: "cut", props: { title: "PREVIEW" } };
const WALL = { kind: "card-wall", rect: { x: 0, y: 500, width: 1080, height: 900 }, at: 0, enter: "cut", bleed: true, depth: 1, props: { cards: [{ label: "a" }, { label: "b" }] } };

function resolve(elements, stage) {
  const story = { schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 10 }, brand: BRAND, scenes: [], resolved: { duration: 10, fps: 30 } };
  const scene = { id: "s1", module: "ui-scene", start: 1, end: 6, params: { elements, ...(stage ? { stage } : {}) } };
  return resolveModule(scene, { ...story, scenes: [scene] });
}
const paint = (spec, t) => { const host = { innerHTML: "" }; paintUi(host, spec, t); return host.innerHTML; };
const blurOf = (style) => Number(/blur\(([\d.]+)px\)/.exec(style)?.[1] ?? 0);

test("focus: arrives out of focus and pulls sharp, mostly in its first half; rack throws it back out", () => {
  const at = (t) => uiEnter(t, 1, "focus");
  assert.match(at(0.9), /visibility:hidden/);
  assert.equal(blurOf(at(1)), 14);
  assert.match(at(1), /scale\(1\.06\)/);
  assert.match(at(1), /opacity:0\.000/);
  const blurs = [1, 1.05, 1.1, 1.21, 1.3, 1.42].map((t) => blurOf(at(t)));
  for (let i = 1; i < blurs.length; i++) assert.ok(blurs[i] < blurs[i - 1] || blurs[i] === 0, `blur falls: ${blurs}`);
  assert.ok(blurs[3] < 2, "sharp to within 2 px by halfway");
  assert.doesNotMatch(at(1.5), /blur/);
  assert.match(at(1.5), /opacity:1\.000;transform: scale\(1\)/);
  // The rack exit: blur grows, scale rises, opacity falls; gone by 0.3 s.
  assert.equal(uiExit(1.9, 2, "rack"), "");
  assert.ok(blurOf(uiExit(2.15, 2, "rack")) > 5);
  assert.match(uiExit(2.31, 2, "rack"), /^opacity:0\.000;scale:1\.0400;$/);
  assert.match(uiExit(2.1, 2), /translate:0/, "lift stays the default exit");
});

test("focus: a headline racks into focus by default and out at its out; others keep their entrances", () => {
  const els = resolve([{ ...HEADLINE, out: 3 }, PANEL]).content.ui["s1-ui"].elements;
  assert.deepEqual([els[0].enter, els[0].exit], ["focus", "rack"]);
  assert.deepEqual([els[1].enter, els[1].exit], ["cut", undefined]);
  assert.equal(resolve([{ ...HEADLINE, enter: "slam" }]).content.ui["s1-ui"].elements[0].exit, undefined);
  assert.equal(resolve([{ ...HEADLINE, exit: "rack", enter: "up" }]).content.ui["s1-ui"].elements[0].exit, "rack");
  assert.throws(() => resolve([{ ...HEADLINE, exit: "spin" }]), /exit must be one of/);
  // No sound asked for a focus pull.
  assert.deepEqual(resolve([HEADLINE, PANEL]).events.filter((event) => event.cue), []);
  const spec = resolve([HEADLINE, PANEL]).content.ui["s1-ui"];
  assert.match(paint(spec, 1.21), /FIX IT/);
  assert.match(paint(spec, 1.21), /filter:blur\(1[34]\.\dpx\)/);
});

test("depth: far elements draw first, smaller, dimmer and softer; only top-level elements take it", () => {
  const spec = resolve([PANEL, WALL]).content.ui["s1-ui"];
  const html = paint(spec, 2);
  // The wall (depth 1) is listed second but drawn first, behind the panel.
  assert.ok(html.indexOf(">a<") < html.indexOf("PREVIEW"), "far layer drawn behind");
  assert.match(html, /scale\(0\.84\);filter:blur\(5\.00px\) brightness\(0\.580\)/);
  const near = uiDepthAt(0, null, 0, 1080, 1920), far = uiDepthAt(1, null, 0, 1080, 1920);
  assert.deepEqual([near.s, near.blur, near.dim], [1, 0, 1]);
  assert.ok(far.s < 0.9 && far.blur > 4 && far.dim < 0.6);
  assert.throws(() => resolve([{ ...PANEL, depth: 1.5 }]), /depth must be/);
  assert.throws(() => resolve([{ ...PANEL, children: [{ kind: "chip", rect: { x: 20, y: 100, width: 200, height: 60 }, at: 0, depth: 0.5, props: { text: "x" } }] }]), /only top-level elements take depth/);
  // A scene without depth or a stage paints as before: no layer wrappers.
  assert.doesNotMatch(paint(resolve([PANEL]).content.ui["s1-ui"], 2), /transform-origin:[\d.-]+px/);
});

test("stage: a dolly is a camera move scaled by depth (parallax), a pure function of scene time", () => {
  const stage = { dolly: { x: 100, y: -40, scale: 1.1 }, duration: 5 };
  const rest = uiDepthAt(0, stage, 0, 1080, 1920);
  assert.deepEqual([rest.x, rest.y, rest.s].map((v) => v + 0), [0, 0, 1], "at rest when the scene starts");
  const nearEnd = uiDepthAt(0, stage, 5, 1080, 1920), farEnd = uiDepthAt(1, stage, 5, 1080, 1920);
  assert.deepEqual([nearEnd.x, nearEnd.y], [100, -40]);
  assert.ok(Math.abs(farEnd.x - 35) < 1e-9, "far layers travel 35% as far");
  assert.ok(Math.abs(nearEnd.s - 1.1) < 1e-9 && farEnd.s < nearEnd.s);
  // Monotonic and smooth: no float, no overshoot.
  let last = -1;
  for (let t = 0; t <= 5; t += 0.25) { const x = uiDepthAt(0.5, stage, t, 1080, 1920).x; assert.ok(x >= last); last = x; }
  const spec = resolve([{ ...PANEL, rect: { x: 140, y: 560, width: 800, height: 560 } }, WALL], { tilt: 8, dolly: { x: 60, y: 30 } }).content.ui["s1-ui"];
  assert.deepEqual(spec.stage, { tilt: 8, dolly: { x: 60, y: 30, scale: 1 }, duration: 5 });
  assert.equal(paint(spec, 3.3), paint(spec, 3.3));
  assert.notEqual(paint(spec, 2), paint(spec, 4), "the camera moves");
  assert.match(paint(spec, 2), /perspective\(1600px\) rotateX\(8deg\)/);
  // The tilt: the top recedes (narrower), the foot comes forward (wider).
  const [topX] = uiStageProject(0, 0, 8, 1080, 1920), [footX] = uiStageProject(0, 1920, 8, 1080, 1920);
  assert.ok(topX > 0 && footX < 0);
});

test("stage: validated, and the stage and text checks see where depth and the stage put an element", () => {
  assert.throws(() => resolve([PANEL], { tilt: 30 }), /params\.stage\.tilt must be/);
  assert.throws(() => resolve([PANEL], { pan: 3 }), /params\.stage/);
  assert.throws(() => resolve([PANEL], { dolly: { x: 50, spin: 1 } }), /params\.stage\.dolly/);
  assert.throws(() => resolve([PANEL], { dolly: { scale: 2 } }), /scale must be/);
  // A panel on the stage at rest, pushed off it by the dolly.
  const edge = { ...PANEL, rect: { x: 40, y: 560, width: 1000, height: 560 } };
  assert.doesNotThrow(() => resolve([edge]));
  assert.throws(() => resolve([edge], { dolly: { x: 120 } }), /placed by its depth and the stage, it covers/);
  // A headline the dolly carries out of the safe zone.
  assert.throws(() => resolve([{ ...HEADLINE, rect: { x: 60, y: 300, width: 960, height: 130 } }, PANEL], { dolly: { y: -80 } }), /platform safe zone/);
  // The bounds cover the scene's start and end; the layout parts use them.
  const box = uiStageBox({ x: 100, y: 1000, width: 400, height: 200 }, 0.5, { tilt: 8, dolly: { x: 80, y: 0, scale: 1 }, duration: 5 }, 1080, 1920);
  assert.ok(box.width > 400 * 0.92 + 80 * 0.675 - 1);
  const layout = resolve([HEADLINE, PANEL], { dolly: { x: 40 } }).layout;
  assert.ok(layout.parts[0].rect.width > 900, "the panel's part covers its travel");
});

test("hero fill: a ui-scene's hero is its headline as drawn under the stage, the box the safe-zone check uses", () => {
  const stage = { tilt: 6, dolly: { x: 30, y: 20, scale: 1.05 } };
  const headline = { ...HEADLINE, rect: { x: 90, y: 330, width: 900, height: 130 }, props: { text: "EARSHOT", size: 130 } };
  const panel = { ...PANEL, rect: { x: 130, y: 560, width: 820, height: 560 } };
  const layout = resolve([headline, panel], stage).layout;
  const drawn = uiStageBox(uiTextBox("headline", headline.props, headline.rect), 0, { ...stage, duration: 5 }, 1080, 1920);
  assert.deepEqual(layout.rect, drawn);
  assert.ok(drawn.width > uiTextBox("headline", headline.props, headline.rect).width, "the dolly's zoom widens it");
  // With the guide's stage, a centred headline drawn at 87% of the safe width still sits in the safe zone.
  const wide = { ...headline, props: { text: "SEVENTEEN CHAR XX", size: 70 } };
  const box = uiStageBox(uiTextBox("headline", wide.props, wide.rect), 0, { ...stage, duration: 5 }, 1080, 1920);
  assert.ok(box.width / 860 > 0.85, `drawn at ${Math.round(box.width / 8.6)}%`);
  assert.doesNotThrow(() => resolve([wide, panel], stage));
});

test("flashAt: an exposure flash on each beat (anchors allowed): quick attack, slow decay", () => {
  assert.equal(uiFlash(1, 1), 0);
  assert.ok(uiFlash(1.05, 1) > 0.999);
  assert.ok(uiFlash(1.15, 1) > uiFlash(1.3, 1) && uiFlash(1.3, 1) > 0);
  assert.equal(uiFlash(1.36, 1), 0);
  assert.ok(uiFlash(2.05, [1, 2]) > 0.999);
  assert.equal(uiFlash(5, undefined), 0);
  const words = [{ text: "now", start: 12.5, end: 12.8 }, { text: "slick", start: 13, end: 13.3 }];
  const params = resolveUiAnchors({ elements: [{ ...PANEL, flashAt: ["word:now", "word:slick"] }] }, 10, (value) => resolveAnchor(value, { words }));
  assert.deepEqual(params.elements[0].flashAt, [2.5, 3]);
  const spec = resolve([{ ...PANEL, flashAt: [2.5, 3] }, { ...HEADLINE, flashAt: 2.5, flashTone: "accent" }]).content.ui["s1-ui"];
  assert.deepEqual(spec.elements[0].flashAt, [2.5, 3]);
  const lit = paint(spec, 3.55), dark = paint(spec, 3.2);
  assert.match(lit, /background:#ffffff;mix-blend-mode:screen;opacity:0\.420/, "the panel's surface lifts at the peak");
  assert.match(lit, /drop-shadow\(0 0 30px #c8ff3a\)/, "the headline glows in the accent");
  assert.doesNotMatch(dark, /mix-blend-mode:screen|drop-shadow/, "nothing before the beat");
  assert.throws(() => resolve([{ ...PANEL, flashAt: 9 }]), /flashAt must be/);
  assert.throws(() => resolve([{ ...PANEL, flashAt: [] }]), /a list of 1–12 times/);
  assert.throws(() => resolve([{ ...PANEL, flashAt: 1, flashTone: "red" }]), /flashTone must be one of/);
});

test("bloom: a soft light that swells and fades, screened over the scene, never counted as content", () => {
  assert.ok(UI_KINDS.includes("bloom"));
  const bloom = { kind: "bloom", rect: { x: 140, y: 500, width: 600, height: 600 }, at: 1, props: { duration: 1 } };
  const model = resolve([PANEL, bloom]);
  const spec = model.content.ui["s1-ui"];
  assert.equal(spec.elements[1].enter, "cut");
  const swell = paint(spec, 2.25);
  assert.match(swell, /mix-blend-mode:screen/);
  assert.equal((swell.match(/radial-gradient\(closest-side/g) ?? []).length, 4);
  assert.match(swell, /#c8ff3a/);
  const opacity = (html) => Number(/radial-gradient[^"]*;opacity:([\d.]+)/.exec(html)?.[1] ?? 0);
  assert.ok(opacity(paint(spec, 2.25)) > opacity(paint(spec, 2.8)), "fades after the swell");
  assert.doesNotMatch(paint(spec, 3.3), /radial-gradient/, "gone after its duration");
  assert.deepEqual(model.layout.parts, [], "light is not a layout part");
  assert.throws(() => resolve([PANEL, { ...bloom, rect: { x: 140, y: 500, width: 120, height: 120 } }]), /a bloom needs at least 200×200/);
  assert.doesNotThrow(() => resolve([PANEL, { ...bloom, rect: { x: -120, y: 1300, width: 700, height: 700 } }]), "light may run off the stage");
  assert.throws(() => resolve([{ ...bloom, at: 0 }, { ...PANEL, at: 1 }]), /put something on screen by 0.6 s/, "a bloom alone is not a built frame");
});

test("burst: thin rays and a flare core shoot out of a point on the hero beat, an emphasis, never content", () => {
  assert.ok(UI_KINDS.includes("burst"));
  const hero = { ...PANEL, id: "hero" };
  const burst = { kind: "burst", at: 1.5, props: { target: "hero", rays: 12 }, cue: "impact" };
  const model = resolve([hero, burst]);
  const spec = model.content.ui["s1-ui"];
  const placed = spec.elements[1];
  // Aimed without a rect: a 920 px square centred on the target's centre.
  assert.deepEqual(placed.rect, { x: 540 - 460, y: 840 - 460, width: 920, height: 920 });
  assert.equal(placed.enter, "cut");
  // The hero beat is an emphasis, with its cue, over the burst's 0.6 s.
  const event = model.events.find((e) => e.name === "burst");
  assert.deepEqual({ time: event.time, endTime: event.endTime, role: event.role, cue: event.cue }, { time: 2.5, endTime: 3.1, role: "emphasis", cue: "impact" });
  assert.deepEqual(model.layout.parts, [], "light is not a layout part");
  // An explicit rect keeps its size and is recentred on the target.
  const sized = resolve([hero, { ...burst, rect: { x: 0, y: 0, width: 600, height: 400 } }]).content.ui["s1-ui"].elements[1];
  assert.deepEqual(sized.rect, { x: 240, y: 640, width: 600, height: 400 });
  // A burst with a rect and no target fires from the rect's centre.
  assert.doesNotThrow(() => resolve([hero, { kind: "burst", rect: { x: -100, y: 1200, width: 800, height: 800 }, at: 1 }]), "light may run off the stage");
  // Rays: one crisp core and one glow copy each, screened, in the accent.
  const peak = paint(spec, 2.62);
  assert.match(peak, /mix-blend-mode:screen/);
  assert.equal((peak.match(/linear-gradient\(to right,#ffffff 0%,#c8ff3a/g) ?? []).length, 12, "12 crisp ray cores");
  assert.equal((peak.match(/linear-gradient\(to right,#c8ff3a 0%/g) ?? []).length, 12, "12 ray glows");
  assert.match(peak, /radial-gradient\(closest-side,#ffffff 0%,#c8ff3a/, "a white-hot flare core");
  // The rays race out, then the whole burst fades and is gone by 0.6 s.
  const widths = (html) => [...html.matchAll(/width:([\d.]+)px;height:[\d.]+px;transform-origin/g)].map((m) => Number(m[1]));
  const sum = (list) => list.reduce((a, b) => a + b, 0);
  assert.ok(sum(widths(paint(spec, 2.7))) > sum(widths(paint(spec, 2.53))), "the rays lengthen");
  const opacity = (html) => Number(/;opacity:([\d.]+);background:linear-gradient\(to right,#ffffff/.exec(html)?.[1] ?? 0);
  assert.ok(opacity(paint(spec, 2.6)) > opacity(paint(spec, 2.95)), "and fade");
  assert.doesNotMatch(paint(spec, 2.49), /linear-gradient\(to right,#ffffff/, "nothing before the beat");
  assert.doesNotMatch(paint(spec, 3.11), /linear-gradient\(to right,#ffffff/, "gone after its duration");
  assert.equal(paint(spec, 2.62), paint(spec, 2.62), "a pure function of t");
  // Options are checked; the target must be another element.
  assert.throws(() => resolve([hero, { ...burst, props: { target: "nope" } }]), /not the id of another element/);
  assert.throws(() => resolve([hero, { ...burst, props: { target: "hero", rays: 40 } }]), /rays/);
  assert.throws(() => resolve([hero, { ...burst, props: { target: "hero", duration: 3 } }]), /duration/);
  assert.throws(() => resolve([hero, { kind: "burst", at: 1 }]), /rect/, "no rect and no target");
  assert.throws(() => resolve([{ ...burst, at: 0, props: { rays: 12 }, rect: { x: 0, y: 400, width: 600, height: 600 } }, { ...PANEL, at: 1 }]), /put something on screen by 0.6 s/, "a burst alone is not a built frame");
  // Word anchors resolve in its at, as any element's.
  const words = [{ text: "unlocked", start: 13.2, end: 13.6 }];
  assert.equal(resolveUiAnchors({ elements: [{ ...burst, at: "word:unlocked" }] }, 10, (value) => resolveAnchor(value, { words })).elements[0].at, 3.2);
  // The guide puts it on the hero beat, once or twice a reel.
  const line = interfaceLines().find((text) => /burst element/.test(text));
  assert.match(line, /once or twice per reel/);
  assert.match(line, /props\.target/);
});

test("UI_RUNTIME: the serialised painter draws depth, stage, flashes and blooms as the module does, text escaped", () => {
  const spec = resolve([{ ...HEADLINE, id: 'a"b', flashAt: 2 }, { ...PANEL, rect: { x: 140, y: 560, width: 800, height: 560 }, flashAt: [1.5], props: { title: "<b>&</b>" } }, WALL, { kind: "bloom", rect: { x: 140, y: 500, width: 600, height: 600 }, at: 0.8, props: {} }, { kind: "burst", rect: { x: 140, y: 500, width: 700, height: 700 }, at: 2.4, props: { rays: 10 } }], { tilt: 8, dolly: { x: 40, scale: 1.04 } }).content.ui["s1-ui"];
  const window = {};
  new Function("window", UI_RUNTIME)(window);
  for (const t of [1.25, 2.6, 3.05, 3.6, 5.5]) {
    const page = { innerHTML: "" };
    window.lcPaintUi(page, spec, t);
    assert.equal(page.innerHTML, paint(spec, t));
  }
  const html = paint(spec, 3.05);
  assert.match(html, /data-ui="a&quot;b"/);
  assert.doesNotMatch(html, /<b>&<\/b>/);
  assert.doesNotMatch(UI_RUNTIME, /Math\.random|Date\.now|new Date|setTimeout|setInterval/);
});

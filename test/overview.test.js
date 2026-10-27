// The overview move (in: {type: "overview"}, docs/KIT_CONTRACTS.md "The
// overview move"): validation, the span, bounding-box framing and its cap,
// held windows in both compilers, and GSAP seek parity.
import assert from "node:assert/strict";
import test from "node:test";
import gsap from "gsap";
import {
  blurAt, cameraPlan, cameraStateAt, containerState, overviewFrame, restState, sceneObjectLookup, screenPoint, worldPoint
} from "../kit/core/camera-world.mjs";
import { resolveModule } from "../kit/core/modules.mjs";
import { resolveStory, validateStory } from "../kit/core/story.mjs";
import { OVERVIEW, holdTime, sceneWindows } from "../kit/core/transitions.mjs";
import { worldBackdrops } from "../kit/core/world-backdrops.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";

const W = 1080, H = 1920;
const SIZE = { width: W, height: H };

// Six plates, two chapters; an overview of the first chapter (s1–s4) into s5.
function overviewStory({ camera = { mode: "world" }, overview = { type: "overview", dur: 2.6, span: "chapter", hold: 0.6 }, mutate = (story) => story } = {}) {
  const headline = (i) => ({ headline: `Shot ${i}` });
  return resolveStory(mutate({
    schema: "launchclip.story.v1", lane: "motion",
    format: { width: W, height: H, fps: 30, duration: 30 },
    brand: { colors: { bg: "#0b1020", primary: "#ff7a59", accent: "#7ce7ff", ink: "#0b1020", paper: "#f5f1ea" }, fonts: { display: "anton", body: "inter", meta: "jetbrains-mono" } },
    motion: { grammar: "playful" }, camera,
    chapters: [{ id: "c1", title: "Setup", start: 0 }, { id: "c2", title: "Payoff", start: 16 }],
    plate: { kind: "starfield", cycle: { every: 2 } },
    scenes: [
      { id: "s1", module: "hook-title", start: 0, end: 4, params: headline(1) },
      { id: "s2", module: "hook-title", start: 4, end: 8, in: { type: "pan", dur: 0.8, direction: "right" }, params: headline(2) },
      { id: "s3", module: "hook-title", start: 8, end: 12, in: { type: "pan", dur: 0.8, direction: "down" }, params: headline(3) },
      { id: "s4", module: "bar-chart", start: 12, end: 16, in: { type: "pan", dur: 0.8, direction: "left" }, params: { title: "Score", data: [{ label: "A", value: 3 }, { label: "B", value: 5 }] } },
      { id: "s5", module: "hook-title", start: 16, end: 23, in: overview, params: headline(5) },
      { id: "s6", module: "hook-title", start: 23, end: 30, in: { type: "pan", dur: 0.8, direction: "right" }, params: headline(6) }
    ]
  }));
}

const planFor = (story) => cameraPlan(story, { windows: sceneWindows(story), objects: sceneObjectLookup(story, (scene, value) => resolveModule(scene, value)) });

test("overview validation: world mode, at least 2 s, never into the first shot, one a minute, span and hold", () => {
  assert.deepEqual(validateStory(overviewStory()).errors, []);
  const bad = (options) => validateStory(overviewStory(options)).errors.join("\n");
  assert.match(bad({ camera: { mode: "cuts" } }), /needs camera\.mode "world"/);
  assert.match(bad({ overview: { type: "overview", dur: 1.5 } }), /dur must be at least 2 s/);
  assert.match(bad({ overview: { type: "overview", dur: 2.6, span: 2 } }), /span must be "chapter" or a whole number of shots from 3 to 8/);
  assert.match(bad({ overview: { type: "overview", dur: 2.6, hold: 2 } }), /hold must be 0 or more seconds, leaving at least 1 s/);
  assert.match(bad({ mutate: (s) => { s.scenes[0].in = { type: "overview", dur: 2.5 }; return s; } }), /s1\) is the first shot/);
  assert.match(bad({ mutate: (s) => { s.scenes[5].in = { type: "overview", dur: 2.5, span: 3 }; return s; } }), /overviews at 16 s and 23 s are 7 s apart; use at most one per 60 s/);
  assert.match(bad({ mutate: (s) => { s.scenes.push({ id: "o1", module: "count-up", track: 1, start: 2, end: 6, in: { type: "overview", dur: 2.5 }, params: { value: 3, label: "x" } }); return s; } }), /overlays \(track ≥ 1\) cannot use it/);
});

test("the span: the ending chapter, or the last n shots; its shots are held, frozen, through the overview", () => {
  const story = overviewStory();
  const windows = sceneWindows(story);
  const byId = Object.fromEntries(windows.scenes.map((entry) => [entry.id, entry]));
  assert.deepEqual(byId.s5.transitionIn.span, ["s1", "s2", "s3", "s4"]);
  assert.equal(byId.s5.transitionIn.hold, 0.6);
  // s4 is the outgoing plate (held through the transition like any other);
  // the earlier ones are drawn again for the overview.
  assert.equal(byId.s4.renderEnd, 18.6);
  for (const id of ["s1", "s2", "s3"]) assert.deepEqual(byId[id].holds, [{ start: 16, end: 18.6, overview: "s5" }], id);
  assert.deepEqual(byId.s4.holds, []);
  assert.deepEqual(byId.s6.holds, []);
  // A number: the last n shots.
  assert.deepEqual(sceneWindows(overviewStory({ overview: { type: "overview", dur: 2.6, span: 3 } })).scenes.find((entry) => entry.id === "s5").transitionIn.span, ["s2", "s3", "s4"]);
  // The frozen frame: the settled state, one frame before the module exits.
  const model = resolveModule(story.scenes[0], story, { end: byId.s1.renderEnd });
  assert.ok(holdTime(byId.s1, model, 30) <= model.motion.exitStart - 1 / 30 + 1e-6 && holdTime(byId.s1, model, 30) > 2, String(holdTime(byId.s1, model, 30)));
});

test("framing: the camera pulls out to the span plus the incoming shot, holds, pushes in; the zoom-out is capped", () => {
  const story = overviewStory();
  const plan = planFor(story);
  const moves = plan.moves.filter((move) => move.type === "overview");
  assert.deepEqual(moves.map((move) => [move.start, move.duration]), [[16, 1], [17.6, 1]]);
  const [overview] = plan.overviews;
  assert.deepEqual(overview.framed, ["s1", "s2", "s3", "s4"]);
  // Every corner of every framed plate is on screen at the hold, with the margin.
  const still = { ...plan, drift: null };
  for (const id of [...overview.framed, "s5"]) {
    for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) {
      const p = screenPoint(still, worldPoint(plan.placements[id], { x, y }), 17.3);
      assert.ok(p.x >= W * OVERVIEW.margin - 1 && p.x <= W * (1 - OVERVIEW.margin) + 1 && p.y >= H * OVERVIEW.margin - 1 && p.y <= H * (1 - OVERVIEW.margin) + 1, `${id} corner ${x},${y} → ${p.x},${p.y}`);
    }
  }
  for (const [key, value] of Object.entries(overview.state)) assert.ok(Math.abs(cameraStateAt(plan, 17.3)[key] - value) < 1e-6, key);
  // Settled on the incoming shot after the push in.
  for (const [key, value] of Object.entries(restState(plan.placements.s5, SIZE))) assert.ok(Math.abs(cameraStateAt(plan, 19)[key] - value) < 1e-6, key);
  // The cap: a long row of plates past 6× drops the oldest from the frame.
  const row = Array.from({ length: 8 }, (_, i) => ({ x: i * W * 1.12, y: 0, scale: 1, rotation: 0 }));
  const capped = overviewFrame(row.slice(0, 7), row[7], SIZE);
  assert.ok(capped.framed < 7 && capped.ratio <= OVERVIEW.cap, JSON.stringify(capped));
  const near = overviewFrame(row.slice(4, 7), row[7], SIZE);
  assert.equal(near.framed, 3);
  assert.ok(near.ratio < OVERVIEW.cap);
  // The backdrop (a starfield cycle) changes with a crossfade during the pull-out, never a slide.
  const backdrops = worldBackdrops(story, plan, sceneWindows(story));
  const into = backdrops.segments.find((segment) => segment.shot === "s5");
  assert.equal(into.entry.type, "fade");
  assert.equal(into.entry.start, 16);
});

test("GSAP seeking the camera ops with an overview matches the frame-pure camera", () => {
  const plan = planFor(overviewStory());
  const targets = { pan: { x: 0, y: 0 }, zoom: { scale: 1, rotation: 0 }, drift: { x: 0, y: 0, scale: 1 }, background: { x: 0, y: 0, scale: 1, rotation: 0 }, blur: { x: 0, y: 0 } };
  const tl = gsap.timeline({ paused: true });
  for (const op of plan.ops) {
    if (op.type === "set") tl.set(targets[op.target], { ...op.props }, op.time);
    else tl.fromTo(targets[op.target], { ...op.from }, { ...op.to, duration: op.duration, ease: op.ease, immediateRender: false }, op.start);
  }
  tl.set({}, {}, plan.duration);
  for (const t of [17.3, 16.4, 29, 18.1, 3, 16.9, 17.8, 0.4, 18.55, 12.3]) {
    tl.seek(t, false);
    const state = containerState(plan, t);
    const expected = { pan: state.pan, zoom: state.zoom, drift: state.drift, background: state.background, blur: blurAt(plan, t) };
    for (const [name, values] of Object.entries(expected)) for (const [key, value] of Object.entries(values)) assert.ok(Math.abs(targets[name][key] - value) < 1e-3, `${name}.${key} at ${t}: GSAP ${targets[name][key]} vs ${value}`);
  }
});

test("HyperFrames draws each held shot again at its placement for the overview, its module on a timeline held at its last frame", async () => {
  const story = overviewStory();
  const { html, warnings } = await compileStoryToHyperFrames(story, { write: false });
  assert.deepEqual(warnings.filter((warning) => /held|overview/.test(warning)), []);
  for (const id of ["s1", "s2", "s3"]) {
    assert.match(html, new RegExp(`<div id="lc-scene-${id}-held" class="lc-scene lc-plate lc-held lc-world-plate" data-launchclip-scene="${id}-held" data-launchclip-held="${id}"`));
    assert.match(html, new RegExp(`// overview s5 → ${id} held at [\\d.]+s, 16–18\\.6s`));
  }
  assert.doesNotMatch(html, /lc-scene-s4-held/);
  assert.match(html, /const heldTl = gsap\.timeline\(\{ paused: true \}\);/);
  // The held copy sits at its plate's placement.
  const plan = planFor(story);
  assert.ok(html.includes(`data-launchclip-held="s2" data-launchclip-start="16" style="z-index:`) && html.includes(`translate(${plan.placements.s2.x}px, ${plan.placements.s2.y}px)`));
});

test("an overview lands on a free side: never on top of an earlier shot it frames", () => {
  // s1 → s2 right → s3 down → s4 left: "right of s4" is s3's spot.
  const plan = planFor(overviewStory());
  const centre = (id) => { const p = plan.placements[id]; return { x: p.x + (W / 2) * p.scale, y: p.y + (H / 2) * p.scale }; };
  for (const id of ["s1", "s2", "s3", "s4"]) {
    const a = centre(id), b = centre("s5");
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > W / 2, `s5 overlaps ${id}`);
  }
});

test("after a push into an object, the overview's shot lands beside the whole map at its largest scale, clear of every shot", () => {
  const story = overviewStory({ mutate: (s) => {
    s.scenes[3] = { id: "s4", module: "gauge-compare", start: 12, end: 16, in: { type: "pan", dur: 0.8, direction: "left" }, params: { left: { label: "Cold", value: 2400, unit: "ms" }, right: { label: "Warm", value: 300, unit: "ms" }, gap: { label: "Saved", value: 2100, unit: "ms" }, style: "column" } };
    s.scenes.splice(4, 0, { id: "s4b", module: "hook-title", start: 16, end: 18, in: { type: "push", dur: 0.9, from_object: "s4.gap-bracket" }, params: { headline: "Inside" } });
    s.scenes[5] = { ...s.scenes[5], start: 18, end: 23, in: { type: "overview", dur: 2.6, span: 5 } };
    s.chapters = undefined;
    return s;
  } });
  assert.deepEqual(validateStory(story).errors, []);
  const plan = planFor(story);
  assert.ok(plan.placements.s4b.scale < 1, "s4b is pushed inside s4");
  assert.equal(plan.placements.s5.scale, 1);
  const box = (p) => ({ x0: p.x, y0: p.y, x1: p.x + W * p.scale, y1: p.y + H * p.scale });
  const b = box(plan.placements.s5);
  for (const id of ["s1", "s2", "s3", "s4", "s4b"]) {
    const a = box(plan.placements[id]);
    assert.ok(b.x1 <= a.x0 + 1e-3 || b.x0 >= a.x1 - 1e-3 || b.y1 <= a.y0 + 1e-3 || b.y0 >= a.y1 - 1e-3, `s5 overlaps ${id}`);
  }
  assert.deepEqual(plan.overviews[0].framed, ["s1", "s2", "s3", "s4", "s4b"]);
});

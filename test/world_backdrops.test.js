// World backdrops (docs/KIT_CONTRACTS.md, "World backdrops"): in world mode
// the plates are the camera's backdrops and change with its moves: a slide
// in the move's direction for pans, whip-pans and orbits, a crossfade for
// push and pull, a switch on a cut. Each backdrop travels with the depth
// layer (parallax) and is drawn wherever its segment shows it.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import gsap from "gsap";
import { cameraPlan, opsStateAt } from "../kit/core/camera-world.mjs";
import { resolveStory, validateStory } from "../kit/core/story.mjs";
import { sceneWindows } from "../kit/core/transitions.mjs";
import { BACKDROP_FEATHER, worldBackdrops } from "../kit/core/world-backdrops.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";

const COLORS = Object.freeze({ bg: "#05070c", paper: "#f4f7fb", ink: "#05070c", primary: "#38e1ff", accent: "#ff8a3d" });
// One shot every 5 s: a pan right, a push, a pan down, a cut, a whip-pan left.
const INS = [null, { type: "pan", dur: 0.8 }, { type: "push", dur: 0.9 }, { type: "pan", dur: 0.8, direction: "down" }, null, { type: "whip-pan", dur: 0.4, direction: "left" }];

function story({ plate = { kind: "smoke", cycle: { every: 1, plates: ["smoke", "starfield", "wash", "silk", "bokeh", "hex-shell"] } }, ins = INS, extra = {} } = {}) {
  return {
    schema: "launchclip.story.v1", lane: "motion", title: "World backdrops",
    format: { width: 1920, height: 1080, fps: 30, duration: ins.length * 5 },
    brand: { colors: { ...COLORS }, fonts: { display: "inter" } },
    camera: { mode: "world" },
    ...(plate ? { plate } : {}),
    scenes: ins.map((transition, i) => ({ id: `s${i}`, module: "motion-title", start: i * 5, end: i * 5 + 5, ...(transition ? { in: transition } : {}), params: { text: `Shot ${i}` } })),
    ...extra
  };
}

function build(raw) {
  const s = resolveStory(raw);
  const windows = sceneWindows(s);
  const plan = cameraPlan(s, { windows });
  return { s, plan, backdrops: worldBackdrops(s, plan, windows) };
}

// Whether the plated segments visible at t cover the whole screen: the top
// one fully opaque over all of it, or (mid-change) the incoming and outgoing
// together, each over the part of the screen its canvas spans.
function covered({ plan, backdrops }, t) {
  const W = plan.width, H = plan.height;
  const shown = backdrops.segments.map((segment) => ({ segment, state: opsStateAt(backdrops.ops, segment.target, t) })).filter(({ segment, state }) => segment.plan && state.opacity > 0);
  const probes = [];
  for (let x = 0; x <= W; x += W / 16) for (let y = 0; y <= H; y += H / 9) probes.push([Math.min(x, W - 0.5), Math.min(y, H - 0.5)]);
  return probes.every(([x, y]) => shown.some(({ segment, state }) => {
    const c = segment.canvas, f = segment.mask ? BACKDROP_FEATHER * Math.max(W, H) : 0;
    const left = c.x + state.x, top = c.y + state.y;
    // Inside the canvas, and past the feathered band on the side it entered by.
    const inside = x >= left && x <= left + c.width && y >= top && y <= top + c.height;
    const side = segment.entry.side;
    const pastFeather = !side || (side === "right" ? x >= left + f : side === "left" ? x <= left + c.width - f : side === "bottom" ? y >= top + f : y <= top + c.height - f);
    return inside && (pastFeather || shown.length > 1);
  }));
}

test("world mode: each camera move into a new plate changes the backdrop its own way", () => {
  const { backdrops } = build(story());
  const summary = backdrops.segments.map((segment) => [segment.kind, segment.entry.type, segment.entry.side ?? null]);
  assert.deepEqual(summary, [
    ["smoke", "first", null],
    ["starfield", "slide", "right"], // the camera pans right: the new world slides in from the right
    ["wash", "fade", null], // a push crossfades over the move
    ["silk", "slide", "bottom"], // panning down: from below
    ["bokeh", "cut", null], // no camera move: it changes on the cut
    ["hex-shell", "slide", "left"] // a whip-pan left: from the left
  ]);
  const slide = backdrops.segments[1];
  assert.equal(slide.entry.start, 5);
  assert.equal(slide.entry.duration, 0.8);
  assert.match(slide.mask, /^linear-gradient\(to right, #00000000 0px, #000000 288px\)$/);
  // Before its move it is hidden; when the move ends the previous one is.
  assert.equal(opsStateAt(backdrops.ops, "backdrop-1", 4.99).opacity, 0);
  assert.equal(opsStateAt(backdrops.ops, "backdrop-0", 5.81).opacity, 0);
  // The slide starts with the feathered edge at the screen's right edge and lands on the screen.
  const start = opsStateAt(backdrops.ops, "backdrop-1", 5);
  assert.equal(start.x + slide.canvas.x, 1920);
  assert.deepEqual(opsStateAt(backdrops.ops, "backdrop-1", 5.8), { x: 0, y: 0, opacity: 1 });
  // A push crossfades.
  assert.ok(Math.abs(opsStateAt(backdrops.ops, "backdrop-2", 10.45).opacity - 0.5) < 0.25);
  // A cut switches at the cut.
  assert.equal(opsStateAt(backdrops.ops, "backdrop-4", 19.99).opacity, 0);
  assert.equal(opsStateAt(backdrops.ops, "backdrop-4", 20).opacity, 1);
  assert.equal(opsStateAt(backdrops.ops, "backdrop-3", 20).opacity, 0);
});

test("the backdrops cover the screen on every frame, mid-move included", () => {
  for (const raw of [story(), story({ plate: { kind: "silk", cycle: { every: 2 } } }), story({ ins: INS.map((t) => (t ? { ...t, type: t.type === "push" ? "push" : "orbit" } : t)) })]) {
    const built = build(raw);
    for (let f = 0; f < raw.format.duration * 30; f += 1) assert.ok(covered(built, f / 30), `uncovered at frame ${f} (${raw.plate.kind})`);
  }
});

test("a backdrop travels with the depth layer between changes (parallax)", () => {
  // Every 2 shots: the pan into s1 stays on smoke, so smoke follows it.
  const { plan, backdrops } = build(story({ plate: { kind: "smoke", cycle: { every: 2, plates: ["smoke", "starfield", "wash"] } } }));
  const first = backdrops.segments[0];
  assert.equal(first.kind, "smoke");
  const key = plan.background.keys[0];
  const after = opsStateAt(backdrops.ops, "backdrop-0", 6);
  assert.ok(Math.abs(after.x - (key.to.x - key.from.x)) < 1e-6, `${after.x} vs ${key.to.x - key.from.x}`);
  assert.ok(Math.abs(key.to.x - key.from.x) > 400, "a pan moves the depth layer by a good part of the screen");
  // Its plate covers the whole stretch the camera shows of it.
  assert.ok(first.plan.frame.width >= 1920 + Math.abs(key.to.x - key.from.x) - 1);
  // Five changes in 30 s with every: 1 (one per shot, 6 shots).
  assert.equal(build(story()).backdrops.segments.length - 1, 5);
});

test("chapters[j].plate and scenes[i].backdrop apply in world mode; none shows the story background", () => {
  const raw = story({ plate: "smoke", extra: { chapters: [{ id: "a", title: "A", start: 0 }, { id: "b", title: "B", start: 10, plate: "starfield" }] } });
  raw.scenes[4].backdrop = { kind: "wash", params: { tint: "accent" } };
  raw.scenes[5].backdrop = "none";
  assert.deepEqual(validateStory(raw).errors, []);
  const { backdrops } = build(raw);
  assert.deepEqual(backdrops.segments.map((segment) => segment.kind), ["smoke", "starfield", "wash", "none"]);
  assert.equal(backdrops.segments.at(-1).plan, null);
  assert.equal(backdrops.segments[2].spec.params.tint, "accent");
});

test("a non-camera transition crossfades the backdrop over its own duration", () => {
  const raw = story({ ins: [null, { type: "fade", dur: 0.6 }] });
  const { backdrops } = build(raw);
  assert.deepEqual(backdrops.segments[1].entry, { type: "fade", start: 5, duration: 0.6, ease: "power1.inOut" });
  assert.ok(Math.abs(opsStateAt(backdrops.ops, "backdrop-1", 5.3).opacity - 0.5) < 1e-9);
  assert.equal(opsStateAt(backdrops.ops, "backdrop-0", 5.6).opacity, 0);
});

test("no backdrops without a plate, and none in cuts mode", () => {
  assert.equal(build(story({ plate: null })).backdrops, null);
  const cuts = story();
  cuts.camera = { mode: "cuts" };
  assert.equal(build(cuts).backdrops, null);
});

test("HyperFrames draws one segment per backdrop and its GSAP seeks match the ops", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-world-backdrops-"));
  try {
    const raw = story();
    const { backdrops } = build(raw);
    const s = resolveStory(raw);
    await compileStoryToHyperFrames(s, { projectDir: dir, sourceDir: dir });
    const html = await readFile(path.join(dir, "index.html"), "utf8");
    assert.deepEqual([...html.matchAll(/class="lc-wb" data-launchclip-backdrop="([a-z-]+)"/g)].map((m) => m[1]), ["smoke", "starfield", "wash", "silk", "bokeh", "hex-shell"]);
    assert.match(html, /<div id="lc-wb-1" class="lc-wb" data-launchclip-backdrop="starfield" style="opacity:0;visibility:hidden">/);
    assert.match(html, /mask-image:linear-gradient\(to right, #00000000 0px, #000000 288px\)/);
    assert.equal((html.match(/lc-wb-vignette/g) ?? []).length, 1, "one vignette over the stack");
    assert.doesNotMatch(html, /id="lc-bg-field-world"/, "the plates are not fixed to the screen any more");
    // Play the backdrop calls on a paused GSAP timeline of plain objects.
    const targets = {};
    const calls = html.split("\n").map((line) => line.trim()).filter((line) => /^tl\.(set|fromTo)\("#lc-wb-\d+(-move)?"/.test(line));
    const code = calls.map((line) => line.replace(/^tl\.(set|fromTo)\("(#lc-wb-\d+(?:-move)?)"/, (_, verb, id) => { targets[id] ??= { x: 0, y: 0, autoAlpha: 0 }; return `tl.${verb}(T[${JSON.stringify(id)}]`; }).replace(/,\s*"?force3D"?:\s*false/g, "")).join("\n");
    const tl = gsap.timeline({ paused: true });
    new Function("tl", "T", code)(tl, targets);
    for (const t of [0.5, 5.2, 5.5, 10.3, 10.6, 15.4, 20.01, 25.2, 29.5, 3, 12, 0]) {
      tl.seek(t, false);
      for (const segment of backdrops.segments) {
        const want = opsStateAt(backdrops.ops, segment.target, t);
        const move = targets[`#lc-wb-${segment.index}-move`], show = targets[`#lc-wb-${segment.index}`];
        assert.ok(Math.abs(show.autoAlpha - want.opacity) < 1e-3, `${segment.target} opacity at ${t}: ${show.autoAlpha} vs ${want.opacity}`);
        if (want.opacity > 0) for (const axis of ["x", "y"]) assert.ok(Math.abs(move[axis] - want[axis]) < 0.05, `${segment.target}.${axis} at ${t}: ${move[axis]} vs ${want[axis]}`);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { resolveStory } from "@launchclip/core/story.mjs";
import { UI_KINDS, UI_RUNTIME, paintUi } from "@launchclip/core/ui-runtime.mjs";
import { uiHostGrid, uiHostPoses } from "@launchclip/core/ui-host.mjs";

const BRAND = { colors: { bg: "#0a0b08", primary: "#c8ff3a", accent: "#c8ff3a", ink: "#0a0b08", paper: "#f4f6ee" }, fonts: { display: "inter", body: "inter", meta: "jetbrains-mono" } };
const PANEL = { id: "panel", kind: "terminal", rect: { x: 60, y: 700, width: 960, height: 600 }, at: 0, enter: "cut", props: { title: "t", prompt: "render" } };
const HOST = { kind: "host", rect: { x: 700, y: 520, width: 176, height: 136 }, at: 0.3, props: {} };

function resolve(elements) {
  const story = { schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 10 }, brand: BRAND, scenes: [], resolved: { duration: 10, fps: 30 } };
  const scene = { id: "s1", module: "ui-scene", start: 1, end: 6, params: { elements } };
  return resolveModule(scene, { ...story, scenes: [scene] });
}
const paint = (spec, t) => { const host = { innerHTML: "" }; paintUi(host, spec, t); return host.innerHTML; };

test("host: a ui-scene kind with its poses, a hop-in by default and a pop cue", () => {
  assert.ok(UI_KINDS.includes("host"));
  assert.deepEqual(uiHostPoses(), ["idle", "hop", "point-left", "point-right", "cheer", "surprised"]);
  const model = resolve([PANEL, HOST]);
  const host = model.content.ui["s1-ui"].elements[1];
  assert.equal(host.enter, "hop");
  assert.deepEqual(model.events.filter((event) => event.name === "enter" && event.id !== "s1-enter").map((event) => [event.time, event.cue]), [[1.3, "pop-soft"]]);
});

test("host: schema: poses, props and beat sets are checked; it has a smallest size", () => {
  assert.doesNotThrow(() => resolve([PANEL, { ...HOST, props: { pose: "cheer", tone: "alert", from: "left" } }]));
  assert.throws(() => resolve([PANEL, { ...HOST, props: { pose: "dance" } }]), /pose must be one of/);
  assert.throws(() => resolve([PANEL, { ...HOST, props: { text: "hi" } }]), /props/);
  assert.throws(() => resolve([PANEL, { ...HOST, props: { tone: "pink" } }]), /tone must be ink, muted, accent, alert or #rrggbb/);
  assert.throws(() => resolve([PANEL, { ...HOST, props: { from: "above" } }]), /from must be one of/);
  assert.throws(() => resolve([PANEL, { ...HOST, beats: [{ at: 1, set: { pose: "wave" } }] }]), /beats\[0\]\.set\.pose must be one of/);
  assert.throws(() => resolve([PANEL, { ...HOST, beats: [{ at: 1, set: { text: "x" } }] }]), /beats\[0\]\.set/);
  assert.throws(() => resolve([PANEL, { ...HOST, rect: { ...HOST.rect, width: 120, height: 90 } }]), /a host needs at least 132×102/);
  assert.doesNotThrow(() => resolve([PANEL, { ...HOST, rect: { ...HOST.rect, width: 132, height: 102 } }]));
  // Unperched, a host needs its whole rect, on the stage like any panel.
  assert.throws(() => resolve([PANEL, { ...HOST, rect: { width: 176, height: 136 } }]), /rect/);
  assert.throws(() => resolve([PANEL, { ...HOST, rect: { ...HOST.rect, x: 990 } }]), /must sit on the stage/);
});

test("host: a perch stands it on an element's top edge, in that element's layer, leaving with it", () => {
  const deep = { ...PANEL, depth: 0.3, out: 4 };
  const model = resolve([{ ...HOST, rect: { width: 176, height: 136 }, props: { perch: "panel" } }, deep]);
  const host = model.content.ui["s1-ui"].elements[0];
  // along 0.8 of 960 from x 60 is 828; the feet (the rect's foot) on y 700.
  assert.deepEqual(host.rect, { x: 828 - 88, y: 700 - 136, width: 176, height: 136 });
  assert.equal(host.depth, 0.3);
  assert.equal(host.out, 4);
  const left = resolve([PANEL, { ...HOST, props: { perch: "panel", along: 0.1 } }]).content.ui["s1-ui"].elements[1];
  assert.deepEqual([left.rect.x, left.rect.y], [60 + 96 - 88, 564], "a perch replaces the rect's x and y");
  assert.throws(() => resolve([PANEL, { ...HOST, props: { perch: "nope" } }]), /names "nope", which is not a top-level element's id \(ids: panel\)/);
  assert.throws(() => resolve([{ ...PANEL, rect: { x: 240, y: 800, width: 600, height: 400 }, tilt: { x: 10 } }, { ...HOST, props: { perch: "panel" } }]), /tilted/);
  assert.throws(() => resolve([{ ...PANEL, at: 0.5 }, { ...HOST, at: 0.2, props: { perch: "panel" } }]), /before "panel", the element it perches on, enters \(0.5 s\)/);
  assert.throws(() => resolve([{ ...PANEL, rect: { ...PANEL.rect, y: 300 } }, { ...HOST, props: { perch: "panel" } }]), /must sit on the stage/, "a perch above the stage's top fails like any panel");
  assert.throws(() => resolve([{ kind: "window", rect: PANEL.rect, at: 0, props: { title: "w" }, children: [{ id: "c", ...PANEL, rect: { x: 0, y: 100, width: 600, height: 400 } }, { ...HOST, props: { perch: "c" } }] }]), /top-level host/);
  // The painter draws it standing there: the sprite's foot on the rect's foot.
  const html = paint(model.content.ui["s1-ui"], 3);
  assert.match(html, /left:740px;top:564px;width:176px;height:136px/);
});

test("host: pose changes are pose events, looping poses span their hold, a beat's cue rides along", () => {
  const model = resolve([PANEL, { ...HOST, out: 4.5, beats: [{ at: 1, set: { pose: "surprised" }, cue: "pop-soft" }, { at: 2, set: { pose: "cheer" } }, { at: 3.5, set: { pose: "point-left" } }, { at: 4, set: { tone: "alert" } }] }]);
  const poses = model.events.filter((event) => event.name === "pose").map(({ time, endTime, cue }) => ({ time, ...(endTime ? { endTime } : {}), ...(cue ? { cue } : {}) }));
  assert.deepEqual(poses, [{ time: 2, cue: "pop-soft" }, { time: 3, endTime: 4.5 }, { time: 4.5 }]);
  // A beat that only changes the tone is an ordinary beat.
  assert.deepEqual(model.events.filter((event) => event.name === "beat").map((event) => event.time), [5]);
  // A host that enters cheering moves from its entrance until its first change (or its out).
  const cheering = resolve([PANEL, { ...HOST, props: { pose: "cheer" }, out: 3 }]);
  assert.deepEqual(cheering.events.filter((event) => event.name === "pose").map(({ time, endTime }) => [time, endTime]), [[1.3, 4]]);
  // The resolved beats carry no cue (the painter only reads at and set).
  assert.deepEqual(model.content.ui["s1-ui"].elements[1].beats[0], { at: 1, set: { pose: "surprised" } });
});

test("host: beat times are word-anchorable, resolved to scene seconds", () => {
  const words = [{ text: "wait", start: 1.2, end: 1.5 }, { text: "what", start: 2.4, end: 2.7 }, { text: "done", start: 3.6, end: 4 }];
  const story = resolveStory({ schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 6 }, brand: BRAND, audio: { words },
    scenes: [{ id: "s1", module: "ui-scene", start: 1, end: 6, params: { elements: [PANEL, { ...HOST, at: "word:wait", beats: [{ at: "word:what", set: { pose: "surprised" } }, { at: "word:done-0.1", set: { pose: "cheer" } }] }] } }] }, { words });
  const host = story.scenes[0].params.elements[1];
  assert.equal(host.at, 0.2);
  assert.deepEqual(host.beats.map((beat) => beat.at), [1.4, 2.5]);
});

test("host: the painter draws every pose, bobs and blinks while idle, and hops in", () => {
  const spec = resolve([PANEL, { ...HOST, beats: [{ at: 2, set: { pose: "surprised" } }, { at: 2.6, set: { pose: "cheer" } }] }]).content.ui["s1-ui"];
  // Before it enters: nothing; mid-hop: in the air, partly visible; landed: on its feet.
  assert.doesNotMatch(paint(spec, 1.25), /<svg/);
  const midHop = paint(spec, 1.5);
  assert.match(midHop, /translateY\(-?\d/);
  assert.match(midHop, /<svg[^>]*viewBox="0 0 22 17"[^>]*shape-rendering="crispEdges"/);
  // Idle is never static: frames a short way apart differ (bob, breath or blink).
  const idle = [2, 2.2, 2.4, 2.6].map((t) => paint(spec, t - 0.6 + 1));
  assert.ok(new Set(idle).size > 1, "the idle host moves");
  // Same t, same frame.
  assert.equal(paint(spec, 2.73), paint(spec, 2.73));
  // Surprised shows its "!", cheer its sparkles.
  const surprised = paint(spec, 3.3), cheer = paint(spec, 4);
  assert.notEqual(surprised, cheer);
  assert.ok((cheer.match(/<svg/g) ?? []).length >= 5, "the cheer draws sparkles");
  assert.ok((surprised.match(/<svg/g) ?? []).length >= 2, "surprised draws its mark");
  // The source the page runs draws the same.
  const window = {};
  new Function("window", UI_RUNTIME)(window);
  const page = { innerHTML: "" };
  window.lcPaintUi(page, spec, 3.3);
  assert.equal(page.innerHTML, surprised);
});

test("host: the sprite: every pose an outlined 22 × 17 grid, symmetric where it should be", () => {
  for (const pose of uiHostPoses()) {
    for (const blink of [false, true]) {
      const rows = uiHostGrid({ pose, blink, tuck: pose === "hop", wave: 0 });
      assert.equal(rows.length, 17, pose);
      assert.ok(rows.every((row) => row.length === 22), pose);
      // Nothing touches the empty space without an outline between.
      for (let y = 0; y < rows.length; y++) for (let x = 0; x < 22; x++) {
        if (rows[y][x] === "." || rows[y][x] === "o") continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.notEqual(rows[y + dy]?.[x + dx] ?? ".", ".", `${pose} (${x}, ${y}) is outlined`);
      }
    }
  }
  const mirror = (rows) => rows.map((row) => [...row].reverse().join(""));
  const shape = (rows) => rows.map((row) => row.replace(/[^.]/g, "#"));
  assert.deepEqual(shape(uiHostGrid({ pose: "cheer" })), shape(mirror(uiHostGrid({ pose: "cheer" }))));
  assert.deepEqual(shape(uiHostGrid({ pose: "point-left" })), shape(mirror(uiHostGrid({ pose: "point-right" }))));
  assert.notDeepEqual(uiHostGrid({ pose: "idle" }), uiHostGrid({ pose: "idle", blink: true }));
});

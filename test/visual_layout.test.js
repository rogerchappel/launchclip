// The layout check of a visual explainer (src/make/visual_layout.js): what counts as a fault, and the redraw it leads to.
import assert from "node:assert/strict";
import test from "node:test";
import { REDRAW_FROM, faultLines, faultScore, layoutFaults, lookTimes, measureVisual } from "../src/make/visual_layout.js";
import { planVisualExplainer, visualArea, visualHelpers, visualPalette, sceneFragment, visualStoryboard } from "../src/make/visual_explainer.js";

const FORMAT = { width: 1080, height: 1920, duration: 12 };
const AREA = visualArea(FORMAT);
const OPTIONS = { canvas: AREA.canvas, zone: AREA.text, count: 40 };
const BRAND = { colors: { bg: "#f4ead9", primary: "#c8552b", accent: "#2f6f5e", paper: "#1d1a16", ink: "#f4ead9" }, fonts: { display: "young-serif", body: "dm-sans", meta: "jetbrains-mono" } };
// Enough ordinary shapes on screen that a scene is not "close to empty".
const filler = (from = 100) => Array.from({ length: 14 }, (_, n) => ({ i: from + n, o: 1, tag: "rect", fill: "rgb(1, 2, 3)", box: { x: 200 + n * 10, y: 600, w: 80, h: 80 } }));
const text = (i, words, box, more = {}) => ({ i, o: 1, tag: "text", fill: "rgb(0, 0, 0)", text: words, size: 40, box, ...more });
const looks = (...frames) => frames.map((leaves, n) => ({ t: 1 + n, leaves: [...leaves, ...filler()] }));
const kinds = (faults) => faults.map((fault) => fault.kind).sort();

test("a scene is looked at as it opens, after its beats, at its middle and near its end, away from the cuts", () => {
  assert.deepEqual(lookTimes({ start: 4, end: 8, beats: [{ at: 4.6 }, { at: 6.2 }, { at: 7.9 }] }), [4.45, 5.1, 6, 6.7, 7.55]);
  assert.equal(lookTimes({ start: 0, end: 20, beats: Array.from({ length: 30 }, (_, n) => ({ at: n * 0.6 })) }).length, 6);
  assert.deepEqual(lookTimes({ start: 4, end: 4.6 }), [4.3], "a scene too short to clear its cuts is looked at once");
});

test("clean measurements give no faults", () => {
  const heading = text(1, "Treated pine", { x: 300, y: 300, w: 480, h: 90 }, { size: 90 });
  assert.deepEqual(layoutFaults(looks([heading], [heading]), OPTIONS), []);
  assert.equal(faultScore([]), 0);
});

test("text off the frame or outside the readable area is a fault once it has settled there", () => {
  const cut = text(1, "Sub-frame", { x: -120, y: 600, w: 400, h: 60 });
  const low = text(2, "Budget", { x: 300, y: 1260, w: 300, h: 50 });
  const right = text(3, "Zero bend", { x: 900, y: 500, w: 160, h: 40 });
  const faults = layoutFaults(looks([cut, low, right], [cut, low, right]), OPTIONS);
  assert.deepEqual(kinds(faults), ["text-off-frame", "text-outside-zone", "text-outside-zone"]);
  assert.match(faults.find((fault) => fault.kind === "text-off-frame").what, /text "Sub-frame" is 30% off the frame at x -120 to 280/);
  // Flying in: off the frame at one look, in place at the next and last. Not a fault.
  const landed = { ...cut, box: { x: 300, y: 600, w: 400, h: 60 } };
  assert.deepEqual(layoutFaults(looks([cut], [landed]), OPTIONS), []);
  // Still there at its last look: a fault.
  assert.deepEqual(kinds(layoutFaults(looks([landed], [cut]), OPTIONS)), ["text-off-frame"]);
});

test("a heading that anything passes over is a fault at any look; smaller text only when most of it is covered and stays so", () => {
  const blade = { tag: "path", fill: "rgb(200, 200, 200)", box: { x: 380, y: 240, w: 300, h: 300 } };
  const heading = text(1, "Hardwood", { x: 340, y: 300, w: 400, h: 90 }, { size: 90 });
  const once = layoutFaults(looks([{ ...heading, covered: 1, coveredBy: blade }], [heading]), OPTIONS);
  assert.deepEqual(kinds(once), ["heading-covered"]);
  assert.match(once[0].what, /text "Hardwood" at x 340 to 740, y 300 to 390 is covered by a path \(fill rgb\(200, 200, 200\)\) drawn after it, which sits at x 380 to 680, y 240 to 540/);
  const label = text(2, "Dense", { x: 200, y: 700, w: 160, h: 40 });
  assert.deepEqual(layoutFaults(looks([{ ...label, covered: 1, coveredBy: blade }], [{ ...label, covered: 1, coveredBy: blade }]), OPTIONS), [], "one end of a small label under a shape is left");
  assert.deepEqual(layoutFaults(looks([{ ...label, covered: 3, coveredBy: blade }], [label]), OPTIONS), [], "covered in passing");
  assert.deepEqual(kinds(layoutFaults(looks([{ ...label, covered: 3, coveredBy: blade }], [{ ...label, covered: 2, coveredBy: blade }]), OPTIONS)), ["text-covered"]);
});

test("text on other text and a label wider than its plate are faults; a shadow copy of the same words is not", () => {
  const a = text(1, "Rich hardwood", { x: 200, y: 500, w: 400, h: 60 });
  const b = text(2, "Deep tannin", { x: 420, y: 510, w: 380, h: 60 });
  assert.deepEqual(kinds(layoutFaults(looks([a, b], [a, b]), OPTIONS)), ["text-overlap"]);
  const shadow = text(3, "Rich hardwood", { x: 206, y: 506, w: 400, h: 60 });
  assert.deepEqual(layoutFaults(looks([a, shadow], [a, shadow]), OPTIONS), []);
  const tag = text(4, "Composite click-lock", { x: 285, y: 800, w: 337, h: 32 }, { plate: { x: 300, y: 790, w: 320, h: 52 } });
  const faults = layoutFaults(looks([tag], [tag]), OPTIONS);
  assert.deepEqual(kinds(faults), ["label-overflow"]);
  assert.ok(faultScore(faults) < REDRAW_FROM, "one small overflow alone does not send a scene back");
});

test("a piece left at the top-left corner was never positioned; one parked off another edge may be waiting for a cut", () => {
  const board = [0, 1, 2].map((n) => ({ i: n, o: 1, tag: "rect", fill: "rgb(215, 201, 143)", box: { x: -400 + n * 30, y: -120, w: 300, h: 100 } }));
  const wipe = [{ i: 9, o: 1, tag: "path", fill: "rgb(9, 9, 9)", box: { x: 1140, y: 500, w: 520, h: 520 } }];
  const faults = layoutFaults(looks([...board, ...wipe], [...board, ...wipe]), OPTIONS);
  assert.deepEqual(kinds(faults), ["never-on-screen", "unplaced"]);
  const unplaced = faults.find((fault) => fault.kind === "unplaced");
  assert.equal(unplaced.shapes, 3, "the shapes of one piece are reported together");
  assert.match(unplaced.what, /a piece of 3 shapes \(fills rgb\(215, 201, 143\)\) sits at the top-left corner and never comes onto the screen/);
  assert.ok(faultScore([unplaced]) >= REDRAW_FROM);
  assert.ok(faultScore(faults.filter((fault) => fault.kind === "never-on-screen")) < REDRAW_FROM);
  // A scene with next to nothing on screen.
  assert.deepEqual(kinds(layoutFaults([{ t: 1, leaves: [text(1, "Board 3", { x: 300, y: 700, w: 400, h: 120 }, { size: 150 })] }], { ...OPTIONS, count: 2 })), ["sparse"]);
  assert.match(faultLines(faults)[0], /^- at 2 s: a piece of 3 shapes/, "the worst fault is listed first");
});

// The planner's redraw loop, with a stand-in for the browser.
const WORDS = "Three boards build a deck and the third one ends the upkeep argument for good".split(" ").map((word, index) => ({ text: word, start: index * 0.8, end: index * 0.8 + 0.6 }));
const scene = (id, start, end) => ({ id, heading: `${id} heading`, start, end, captions: "show", brief: `what ${id} shows`, beats: [{ at: start + 0.5, what: "lands" }], hits: [] });
const PLAN = { look: "Plain.", scenes: [scene("yard", 0, 4), scene("boards", 4, 8), scene("verdict", 8, 12)], props: "" };
const UNPLACED = [{ kind: "unplaced", at: 5, shapes: 6, what: "a piece of 6 shapes sits at the top-left corner and never comes onto the screen", box: { x: -60, y: -40, w: 300, h: 90 } }];

function client(answers = {}) {
  const calls = [];
  return {
    calls,
    provider: "openai",
    async runStructured(request) {
      calls.push(request);
      if (request.schemaName === "launchclip_visual_director") return { model: "m", usage: {}, value: PLAN };
      const id = request.input.match(/YOUR SCENE: (\S+) /)[1];
      const redraw = request.input.includes("You drew this scene already");
      const answer = (redraw ? answers[`${id}:redraw`] : answers[id]) ?? `S('rect', { x: 100, y: 300, width: 10, height: 10 }); // ${id}${redraw ? " redrawn" : ""}`;
      if (answer instanceof Error) throw answer;
      return { model: "m", usage: {}, value: { code: answer } };
    }
  };
}
const run = (fake, measure) => planVisualExplainer({ client: fake, model: "m", provider: "openai", brief: "decks", words: WORDS, narration: "n", format: FORMAT, brand: BRAND, measure });
// faults(html) → the faults of a scene, from what its fragment contains.
const measurer = (faults) => { const seen = []; const measure = async ({ fragments, scenes }) => { seen.push(fragments.map((fragment) => fragment.html)); return new Map(scenes.map((entry, index) => [entry.id, { faults: faults(entry.id, fragments[index].html) }])); }; measure.seen = seen; return measure; };

test("a scene with measured faults is drawn again with the measurements, and the redraw is kept when it measures better", async () => {
  const fake = client();
  const measure = measurer((id, html) => (id === "boards" && !html.includes("boards redrawn") ? UNPLACED : []));
  const result = await run(fake, measure);
  assert.equal(result.status, "passed");
  assert.deepEqual([result.layout.status, result.layout.faulty, result.layout.kept, result.layout.reverted, result.layout.left], ["checked", ["boards"], ["boards"], [], []]);
  assert.deepEqual(result.layout.scores.boards, { before: faultScore(UNPLACED), after: 0 });
  assert.equal(measure.seen.length, 2, "measured, then measured again with the redraw");
  const redraw = fake.calls.filter((call) => call.input.includes("You drew this scene already"));
  assert.equal(redraw.length, 1, "only the faulty scene was drawn again");
  assert.match(redraw[0].input, /YOUR SCENE: boards /);
  assert.match(redraw[0].input, /Here is your code:\nS\('rect', \{ x: 100, y: 300, width: 10, height: 10 \}\); \/\/ boards/);
  assert.match(redraw[0].input, /- at 5 s: a piece of 6 shapes sits at the top-left corner/);
  assert.match(redraw[0].input, /text can be read in x 80 to 940, y 280 to 1180/);
  assert.match(result.fragments[1].html, /boards redrawn/);
  assert.deepEqual(result.attempts.filter((attempt) => attempt.kind === "redraw").map((attempt) => [attempt.scene, attempt.ok]), [["boards", true]]);
  assert.deepEqual(result.warnings, []);
});

test("a redraw that measures no better, cannot be used or was refused leaves the first drawing in place", async () => {
  const worse = await run(client(), measurer((id) => (id === "boards" ? UNPLACED : [])));
  assert.deepEqual([worse.layout.kept, worse.layout.reverted, worse.layout.left], [[], ["boards"], ["boards"]]);
  assert.doesNotMatch(worse.fragments[1].html, /boards redrawn/);
  assert.match(worse.warnings.join("\n"), /the layout check still finds faults in boards/);
  const broken = await run(client({ "boards:redraw": "const a = ;" }), measurer((id) => (id === "boards" ? UNPLACED : [])));
  assert.deepEqual([broken.layout.kept, broken.layout.reverted], [[], []]);
  assert.match(broken.attempts.find((attempt) => attempt.kind === "redraw").error, /does not parse/);
  const refused = await run(client({ "boards:redraw": new Error("429 too many requests") }), measurer((id) => (id === "boards" ? UNPLACED : [])));
  assert.equal(refused.status, "passed");
  assert.match(refused.attempts.find((attempt) => attempt.kind === "redraw").error, /the call failed/);
});

test("clean scenes are not drawn again; with no browser the check is skipped and the video is still planned", async () => {
  const fake = client();
  const clean = await run(fake, measurer(() => []));
  assert.deepEqual([clean.layout.status, clean.layout.faulty], ["checked", []]);
  assert.equal(fake.calls.filter((call) => call.input.includes("You drew this scene already")).length, 0);
  const none = await run(client(), async () => null);
  assert.deepEqual([none.status, none.layout.status], ["passed", "skipped"]);
  const thrown = await run(client(), async () => { throw new Error("the browser crashed"); });
  assert.equal(thrown.status, "passed");
  assert.match(thrown.warnings.join("\n"), /the layout check could not run \(the browser crashed\)/);
  assert.equal((await planVisualExplainer({ client: client(), model: "m", brief: "decks", words: WORDS, narration: "n", format: FORMAT, brand: BRAND })).layout, null, "no measurer, no check");
});

test("in a real browser: a label off the frame and a piece left at the corner are found, a clean scene is not", async (t) => {
  const helpers = visualHelpers(visualPalette(BRAND));
  const scenes = [scene("clean", 0, 4), scene("faulty", 4, 8)];
  const dots = "for (let n = 0; n < 14; n += 1) S('circle', { cx: 200 + n * 50, cy: 900, r: 18, fill: PRIMARY });";
  const codes = [
    `${dots}\nS('text', { x: 540, y: 380, 'font-size': 90, 'text-anchor': 'middle', class: 'd' }, svg, 'Clean scene');`,
    `${dots}\nS('text', { x: 1040, y: 700, 'font-size': 60 }, svg, 'Cut off label');\nconst lost = G(svg); S('rect', { x: -400, y: -200, width: 300, height: 120, fill: ACCENT }, lost);`
  ];
  const fragments = scenes.map((entry, index) => ({ file: `hyperframes/visual/${entry.id}.html`, html: sceneFragment({ scene: entry, code: codes[index], helpers, props: "", area: AREA }) }));
  const storyboard = visualStoryboard({ base: { lane: "motion", format: { fps: 30, ...FORMAT, duration: 8 }, brand: BRAND, audio: {} }, scenes, area: AREA });
  const measured = await measureVisual({ storyboard, fragments, scenes, area: AREA, words: [] });
  if (!measured) { t.skip("no Chromium on this machine"); return; }
  assert.deepEqual(measured.get("clean").faults, []);
  assert.equal(measured.get("clean").shapes, 15);
  assert.deepEqual(kinds(measured.get("faulty").faults), ["text-off-frame", "unplaced"]);
  assert.match(measured.get("faulty").faults.find((fault) => fault.kind === "text-off-frame").what, /text "Cut off label"/);
});

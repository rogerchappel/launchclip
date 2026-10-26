// No ghosting (docs/DIRECTION_GUARDRAILS.md §4): one copy of a person at a
// time, casts change with a cut or a single-copy move, text fades are short.
import test from "node:test";
import assert from "node:assert/strict";
import { frameState } from "../kit/core/catalog-b-view.mjs";
import { charactersTimeline } from "../kit/core/catalog-characters.mjs";
import { TEXT_FADE, resolveModule } from "../kit/core/modules.mjs";
import { twoCopies, validateStory } from "../kit/core/story.mjs";
import { ghostingGate } from "../src/direction_guardrails.js";

const brand = { colors: { bg: "#101820", primary: "#2a9d8f", accent: "#e9c46a", ink: "#101820", paper: "#f4f1ea" }, fonts: { display: "anton", body: "space-grotesk", meta: "jetbrains-mono" } };
const story = (scenes, extra = {}) => ({ schema: "launchclip.story.v1", lane: "motion", brand, format: { width: 1080, height: 1920, fps: 30, duration: 8 }, cast: { characters: [{ id: "maya" }, { id: "theo" }] }, scenes, ...extra });
const world = (id, start, end, kind, extra = {}) => ({ id, module: "world", start, end, params: { kind, camera: "still" }, ...extra });
const bench = (id, start, end, cast, params = {}) => ({ id, module: "cast-scene", track: 1, start, end, params: { set: "park-bench", cast: cast.map((cid) => ({ id: cid })), ...params } });
const pan = { type: "pan", dur: 0.8, direction: "left" };

test("a character shared across a pan between places appears when the move ends: one copy at a time", () => {
  const s = story([world("a", 0, 4, "city-street"), bench("c1", 0, 4, ["maya", "theo"]), world("b", 4, 8, "park", { in: pan }), bench("c2", 4, 8, ["theo", "maya"])], { camera: { mode: "world" } });
  const incoming = resolveModule(s.scenes[3], s);
  assert.deepEqual(incoming.content.single.arrive, { ids: ["theo", "maya"], at: 4.8 });
  const ops = charactersTimeline(incoming);
  assert.equal(frameState(ops, 4.4).get("c2-c0").opacity, 0, "theo waits while the camera travels");
  assert.equal(frameState(ops, 4.9).get("c2-c0").opacity, 1);
  assert.equal(frameState(ops, 4.4).get("c2").opacity, 1, "the bench itself rides in with its world");
  const result = ghostingGate(s);
  assert.equal(result.status, "passed", JSON.stringify(result.findings));
});

test("over a dissolve between plates the shared character waits for the dissolve too", () => {
  const s = story([world("a", 0, 4, "city-street"), bench("c1", 0, 4, ["maya"]), world("b", 4, 8, "park", { in: { type: "fade", dur: 0.5 } }), bench("c2", 4, 8, ["maya"])]);
  const result = ghostingGate(s);
  assert.equal(result.status, "passed", JSON.stringify(result.findings));
  assert.equal(resolveModule(s.scenes[3], s).content.single.arrive.at, 4.5);
});

test("a see-through character and two copies at once fail", () => {
  // An explicit fade over a plate already there: half-transparent for half a second.
  const ghost = ghostingGate(story([world("a", 0, 2, "city-street"), world("b", 2, 8, "park"), bench("c", 2, 8, ["maya"], { enter: "fade" })], { motion: { grammar: "cinematic" } }));
  assert.ok(ghost.findings.some((finding) => finding.rule === "ghost-character"), JSON.stringify(ghost.findings));
  const overlap = story([world("w", 0, 8, "park"), bench("c1", 0, 5, ["maya"]), bench("c2", 4, 8, ["maya"], {}), ]);
  overlap.scenes[2].track = 2;
  assert.deepEqual(twoCopies(overlap), [{ character: "maya", a: "c1", b: "c2", from: 4, to: 5 }]);
  assert.match(validateStory(overlap).errors.join("\n"), /"maya" is in scenes "c1" and "c2" at once/);
  assert.ok(ghostingGate(overlap).findings.some((finding) => finding.rule === "two-copies"));
});

test("text fades are capped and text holds long enough to be read", () => {
  const card = (end, text) => ({ id: "card", module: "concept-card", track: 1, start: 0, end, params: { text, icon: "timer", sub: "from eye doctors" } });
  const slow = story([card(4, "A 20-second fix")], { motion: { grammar: "cinematic" } });
  const model = resolveModule(slow.scenes[0], slow);
  assert.ok(model.motion.enterDuration <= TEXT_FADE.max);
  assert.equal(ghostingGate(slow).status, "passed");
  const rushed = story([{ id: "quote", module: "quote-card", track: 1, start: 0, end: 2.5, params: { quote: "The best way to protect your eyes against eye strain is to take regular breaks", author: "AAO" } }]);
  const result = ghostingGate(rushed);
  assert.ok(result.findings.some((finding) => finding.rule === "text-hold"), JSON.stringify(result.findings));
});

test("a card ending at a plate change leaves with the cut; one arriving with a moving plate waits for it", () => {
  const s = story([world("a", 0, 4, "city-street"), world("b", 4, 8, "park", { in: { type: "pan", dur: 0.6, direction: "left" } }),
    { id: "k1", module: "concept-card", track: 2, start: 0, end: 4, params: { text: "Twenty feet", icon: "ruler" } },
    { id: "k2", module: "concept-card", track: 2, start: 4, end: 8, params: { text: "20 ft+ counts", icon: "ruler" } }], { camera: { mode: "world" } });
  const out = resolveModule(s.scenes[2], s), into = resolveModule(s.scenes[3], s);
  assert.equal(out.exitsWithCut, true);
  assert.ok(out.motion.end - out.motion.exitStart <= 1 / 30 + 1e-6, "one frame");
  assert.equal(into.waitsForPlate, 0.6);
  assert.ok(into.motion.enterStart >= 4.6 - 1e-6);
  // The last card of the video keeps its fade (a final hold or loop has its own rules).
  assert.equal(into.exitsWithCut, undefined);
});

test("a call to action clear of the caption band keeps the captions on", () => {
  const cta = (rect) => ({ id: "c", module: "cta", track: 1, start: 0, end: 4, params: { action: "Set a 20-minute timer", detail: "Then look 20+ ft away", variant: "boxed", rect } });
  const high = story([world("w", 0, 8, "park"), cta({ x: 80, y: 290, width: 860, height: 520 })]);
  assert.equal(resolveModule(high.scenes[1], high).hidesCaptions, false);
  const low = story([world("w", 0, 8, "park"), cta({ x: 80, y: 900, width: 860, height: 520 })]);
  assert.equal(resolveModule(low.scenes[1], low).hidesCaptions, true);
});

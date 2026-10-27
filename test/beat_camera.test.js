// The director's camera (kit/core/beat-camera.mjs, wave 3 part C): shot entries
// with the push-in balance, zooms into what a line names, an overview per
// chapter, the report, and the world-camera story beatMapToStory writes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { ENTRY, OVERVIEW, ZOOM, cameraSummary, mapCards, planCamera, spoken, zoomSpots } from "../kit/core/beat-camera.mjs";
import { beatMapReportText, beatMapToStory, directLongForm, dryRunWords, windowWords } from "../kit/core/beat-director.mjs";
import { resolveModule } from "../kit/core/modules.mjs";
import { STATE_MODULES } from "../kit/core/shot-states.mjs";
import { resolveStory, validateStory } from "../kit/core/story.mjs";
import { TRANSITION_TYPES } from "../kit/core/transitions.mjs";
import { shotZooms } from "../kit/core/zooms.mjs";

const script = readFileSync(path.resolve("test/fixtures/beat-camera-script.md"), "utf8");
const timed = dryRunWords(script, { wpm: 155 });
const plan = (options = {}) => directLongForm({ words: timed.words, chapters: timed.chapters, title: timed.title }, options);
const shotsOf = (map) => map.chapters.flatMap((chapter, c) => chapter.shots.map((shot, s) => ({ shot, chapter, c, s })));
const zoomsOf = (map) => mapCards(map).flatMap((card) => (card.state.zooms ?? []).map((zoom) => ({ zoom, card })));

test("camera: every shot after the first enters on a move, and never a third push-in in a row", () => {
  const map = plan();
  const shots = shotsOf(map);
  assert.equal(shots[0].shot.camera, undefined);
  let run = 0;
  for (const { shot, s } of shots.slice(1)) {
    assert.ok(["push", "pull", "whip-pan", "orbit", "overview"].includes(shot.camera?.type), JSON.stringify(shot.camera));
    if (shot.camera.type !== "overview") assert.equal(shot.camera.dur, ENTRY[shot.camera.type]);
    if (["whip-pan", "orbit"].includes(shot.camera.type)) assert.ok(["left", "right", "up", "down"].includes(shot.camera.direction));
    // A chapter opens stepping back: a pull, or its overview.
    if (s === 0) assert.ok(["pull", "overview"].includes(shot.camera.type), shot.id);
    run = shot.camera.type === "push" ? run + 1 : 0;
    assert.ok(run <= 2, `${shot.id}: three push-ins in a row`);
  }
  assert.ok(cameraSummary(map).entries.push > 0, "a same-topic shot pushes in");
});

test("camera: the balance rule turns the third push-in of a run into a pull", () => {
  const state = (id, start, kind) => ({ id, words: [0, 0], start, end: start + 15, text: "Revenue rose again.", kind, module: "stat-card", change: "enter", params: {} });
  const shots = [0, 15, 30, 45, 60].map((start, i) => ({ id: `s${i}`, start, end: start + 15, states: [state(`s${i}-1`, start, "stat")] }));
  const map = { duration: 75, chapters: [{ id: "one", start: 0, end: 75, shots }] };
  planCamera(map, []);
  assert.deepEqual(shots.map((shot) => shot.camera?.type ?? null), [null, "push", "push", "pull", "push"]);
  assert.equal(shots[3].camera.why, "balance: after two push-ins");
});

test("camera: one overview per chapter of 4+ shots, never in the cold open, at most one a minute", () => {
  const map = plan();
  const shots = shotsOf(map);
  const overviews = shots.filter(({ shot }) => shot.camera?.type === "overview");
  assert.ok(overviews.length >= 1, "a long chapter gets its overview");
  const chapters = new Set();
  let last = -Infinity;
  for (const { shot, c } of overviews) {
    const mapped = map.chapters.find((chapter) => chapter.id === shot.camera.chapter);
    assert.ok(mapped, shot.camera.chapter);
    assert.notEqual(mapped.id, map.chapters[0].id, "the cold open has no overview");
    assert.ok(mapped.shots.length >= OVERVIEW.minShots, `${mapped.id} has ${mapped.shots.length} shots`);
    assert.ok(!chapters.has(mapped.id), "one per chapter");
    chapters.add(mapped.id);
    assert.ok(shot.start - last >= OVERVIEW.gap, "at most one a minute");
    last = shot.start;
    assert.deepEqual({ dur: shot.camera.dur, span: shot.camera.span, hold: shot.camera.hold }, { dur: OVERVIEW.dur, span: "chapter", hold: OVERVIEW.hold });
    assert.ok(c >= 1 && map.chapters.indexOf(mapped) <= c);
  }
  // Short chapters (under 4 shots) get none.
  for (const chapter of map.chapters) if (chapter.shots.length < OVERVIEW.minShots) assert.ok(!overviews.some(({ shot }) => shot.camera.chapter === chapter.id), chapter.id);
});

test("camera: a recap line in the chapter's back half places the overview, else the next chapter's first shot", () => {
  const shot = (id, start, text, kind = "concept") => ({ id, start, end: start + 18, states: [{ id: `${id}-1`, words: [0, 0], start, end: start + 18, text, kind, module: "concept-card", change: "enter", params: {} }] });
  const cold = { id: "cold", start: 0, end: 72, shots: [0, 18, 36, 54].map((t, i) => shot(`c${i}`, t, "It started quietly.")) };
  const recap = { id: "recap", start: 72, end: 180, shots: [72, 90, 108, 126, 144, 162].map((t, i) => shot(`r${i}`, t, i === 4 ? "Either way, the number is a best case." : "Look at the chart.")) };
  const plain = { id: "plain", start: 180, end: 260, shots: [180, 200, 220, 240].map((t, i) => shot(`p${i}`, t, "Now the price.")) };
  const last = { id: "last", start: 260, end: 330, shots: [260, 280].map((t, i) => shot(`l${i}`, t, "Put it together.")) };
  const map = { duration: 330, chapters: [cold, recap, plain, last] };
  planCamera(map, []);
  const overviews = shotsOf(map).filter(({ shot: entry }) => entry.camera?.type === "overview").map(({ shot: entry }) => [entry.id, entry.camera.chapter]);
  // cold open: none (its chapter end, r0, pulls); recap: on the shot the recap opens; plain: the next chapter's first shot.
  assert.deepEqual(overviews, [["r4", "recap"], ["l0", "plain"]]);
  assert.match(recap.shots[4].camera.why, /recap line "Either way, the number…"/);
  assert.equal(recap.shots[0].camera.type, "pull");
  // Two overviews closer than a minute: the later one is dropped.
  const tight = { duration: 150, chapters: [cold, { ...recap, shots: recap.shots.slice(0, 4) }, { id: "next", start: 144, end: 200, shots: [shot("n0", 144, "Next."), shot("n1", 162, "More.")] }] };
  tight.chapters[1].shots[3] = shot("r3", 126, "So that is the score.");
  planCamera(tight, []);
  assert.deepEqual(shotsOf(tight).filter(({ shot: entry }) => entry.camera?.type === "overview").map(({ shot: entry }) => entry.id), ["r3"]);
});

test("zooms: a line naming a value or label on screen zooms to that element, timed to the word", () => {
  const map = plan();
  const zooms = zoomsOf(map);
  assert.ok(zooms.length >= 3, `${zooms.length} zooms`);
  for (const { zoom, card } of zooms) {
    const word = timed.words.find((w) => Math.abs(w.start - zoom.at) < 1e-3);
    assert.ok(word, `zoom at ${zoom.at} lands on a word`);
    assert.ok(zoom.word.startsWith(spoken(word.text).text) || zoom.word.toLowerCase().startsWith(spoken(word.text).text), `${zoom.word} / ${word.text}`);
    const spot = zoomSpots(card.state, { seconds: card.end - card.start }).find((entry) => entry.name === zoom.element);
    assert.ok(spot, `${card.state.module}: ${zoom.element}`);
    const said = spoken(word.text);
    assert.ok(spot.values.includes(said.value) || spot.labels.some((label) => label.toLowerCase().split(/\s+/).some((part) => spoken(part).text === said.text)), `${zoom.word} names ${zoom.element}`);
    // target on a state module (unless the kit's rect for it cannot fit the safe area), a box inside the card's rect elsewhere.
    if (zoom.target !== undefined) assert.ok(STATE_MODULES[card.state.module] && Number.isInteger(zoom.target), card.state.module);
    else {
      assert.equal(zoom.target, undefined);
      assert.ok(zoom.box.x >= 0 && zoom.box.y >= 0 && zoom.box.x + zoom.box.width <= 1920 && zoom.box.y + zoom.box.height <= 1080, JSON.stringify(zoom.box));
    }
  }
  const named = zooms.map(({ zoom, card }) => `${card.state.module}:${zoom.word}`);
  assert.ok(named.includes("number-line:49.8%"), named.join(", "));
  assert.ok(named.includes("bar-chart:Lyra"), named.join(", "));
  // Every zoom lands in the kit's safe area, so none is dropped at render.
  const story = beatMapToStory(map, { captions: false });
  const resolved = resolveStory(story, { words: windowWords(timed.words, 0, map.duration) });
  for (const scene of resolved.scenes.filter((entry) => entry.zooms)) {
    const out = shotZooms(resolved, { id: scene.id, scene }, resolveModule(scene, resolved).zoomRects);
    assert.deepEqual(out.warnings, []);
    assert.equal(out.zooms.length, scene.zooms.length);
  }
});

test("zooms: clear of the entry move, eased out before the next, none on cards under 3 s, at most 3 a minute", () => {
  const map = plan();
  const cards = mapCards(map);
  for (const card of cards) {
    const zooms = card.state.zooms ?? [];
    if (!zooms.length) continue;
    assert.ok(card.end - card.start >= ZOOM.minCard, `${card.state.id} is ${card.end - card.start} s`);
    const entry = card.shot.states[0] === card.state ? card.shot.camera?.dur ?? 0 : 0.4;
    assert.ok(zooms.length <= ZOOM.perCard);
    zooms.forEach((zoom, i) => {
      assert.ok(zoom.at >= card.start + entry + ZOOM.settle - 1e-6, `${card.state.id}: zoom during the entry`);
      assert.ok(zoom.until - zoom.at >= ZOOM.minHold - 1e-6 && zoom.until <= card.end - ZOOM.tail + 1e-6);
      if (i > 0) assert.ok(zoom.at >= zooms[i - 1].until + ZOOM.between - 1e-6, "zooms out between two zooms on one card");
    });
  }
  const times = zoomsOf(map).map(({ zoom }) => zoom.at).sort((a, b) => a - b);
  times.forEach((t, i) => {
    assert.ok(times.filter((u) => u <= t && t - u < 60).length <= ZOOM.perMinute, `more than ${ZOOM.perMinute} zooms in the minute to ${t}`);
    if (i > 0) assert.ok(t - times[i - 1] >= ZOOM.gap - 1e-6);
  });
});

test("zooms: the elements each module offers (targets on state modules, boxes from the view)", () => {
  const bars = zoomSpots({ module: "bar-chart", params: { data: [{ label: "Orion 3", value: 57.6 }, { label: "Vega 5", value: 52.1 }] } });
  assert.deepEqual(bars.map((spot) => [spot.target, spot.values[0]]), [[0, 57.6], [1, 52.1]]);
  assert.equal(zoomSpots({ module: "bar-chart", params: { data: [{ label: "Only", value: 1 }] } }).length, 0, "one bar is the whole card");
  const grid = zoomSpots({ module: "unit-grid", params: { count: 100, groups: [{ count: 62, label: "62 in 100", tone: "primary" }, { count: 38, label: "The rest", tone: "accent" }] } });
  assert.deepEqual(grid.map((spot) => spot.values), [[62, 62], [38]]);
  assert.ok(grid.every((spot) => spot.box && spot.target === undefined));
  const tokens = zoomSpots({ module: "tokenizer", params: { text: "gpt-6.1-terra", tokens: ["gpt", "-", "6", ".", "1", "-terra"], models: [{ label: "Terra", price: 5 }] } });
  assert.deepEqual(tokens.map((spot) => spot.labels[0]), ["gpt", "terra"]);
  const diff = zoomSpots({ module: "diff-view", params: { file: "eval.yaml", lines: [" model: a", "+judge_model: gpt-6.1-terra", "-x: 1"], focus: [{ row: 1 }] } });
  assert.equal(diff.length, 1);
  assert.ok(diff[0].labels.includes("judge_model") && diff[0].box.height < 200, JSON.stringify(diff[0]));
  // A label of filler words never matches a word.
  assert.equal(spoken("57.6%,").value, 57.6);
  assert.equal(spoken("$2,400.").value, 2400);
  assert.equal(spoken("3.6×").value, 3.6);
});

test("camera: the report lists zooms and overviews and counts them on the summary line", () => {
  const map = plan();
  const summary = cameraSummary(map);
  assert.deepEqual(map.report.camera.entries, summary.entries);
  const text = beatMapReportText(map);
  const lines = text.split("\n");
  assert.match(lines[0], new RegExp(`, ${summary.zooms} zooms, ${summary.overviews} overviews$`));
  assert.match(text, /^camera: .*longest push-in run [0-2]; \d+ zooms \([\d.]+\/min\), \d+ overviews$/m);
  assert.equal(lines.filter((line) => line.startsWith("  zoom ")).length, summary.zooms);
  assert.equal(lines.filter((line) => line.startsWith("  overview ")).length, summary.overviews);
  assert.match(text, /zoom\s+1:08 {2}number-line → marker 49\.8% on "49\.8%" \(box\)/);
  // camera: false plans no camera at all.
  const flat = plan({ camera: false });
  assert.ok(shotsOf(flat).every(({ shot }) => !shot.camera && shot.states.every((state) => !state.zooms)));
  assert.equal(flat.report.camera.zooms, 0);
  assert.doesNotMatch(beatMapReportText(flat), /^camera:/m);
});

test("camera: beatMapToStory writes a valid world-camera story with each shot's entry and its zooms", () => {
  const map = plan();
  const story = beatMapToStory(map, { captions: false });
  assert.deepEqual(story.camera, { mode: "world", layout: "path", spacing: 0.14, parallax: true });
  const validation = validateStory(story);
  assert.equal(validation.ok, true, validation.errors.join("\n"));
  const resolved = resolveStory(story, { words: windowWords(timed.words, 0, map.duration) });
  for (const scene of resolved.scenes) assert.doesNotThrow(() => resolveModule(scene, resolved), scene.id);
  const plates = story.scenes.filter((scene) => !scene.track);
  // Every shot's first scene enters on the shot's move; overviews need the kit's overview move.
  const firsts = shotsOf(map).slice(1).map(({ shot }) => [shot, plates.find((scene) => scene.id === shot.states[0].id)]).filter(([, scene]) => scene);
  assert.ok(firsts.length > 5);
  for (const [shot, scene] of firsts) {
    if (shot.camera.type !== "overview") assert.deepEqual(scene.in, { type: shot.camera.type, dur: shot.camera.dur, ...(shot.camera.direction ? { direction: shot.camera.direction } : {}) });
    else if (TRANSITION_TYPES.includes("overview")) assert.deepEqual(scene.in, { type: "overview", dur: OVERVIEW.dur, span: "chapter", hold: OVERVIEW.hold });
    else assert.deepEqual(scene.in, { type: "pull", dur: ENTRY.pull });
  }
  // Zooms ride on their card's scene, on the story clock, inside it and clear of its entry.
  const zoomed = plates.filter((scene) => scene.zooms);
  assert.ok(zoomed.length >= 3);
  for (const scene of zoomed) {
    assert.ok(scene.end - scene.start >= 3);
    for (const zoom of scene.zooms) {
      assert.ok(zoom.at >= scene.start + (scene.in?.dur ?? 0) && zoom.until <= scene.end, `${scene.id} ${JSON.stringify(zoom)}`);
      assert.deepEqual(Object.keys(zoom).filter((key) => key !== "scale").sort(), ["at", "until", "target" in zoom ? "target" : "box"].sort());
    }
  }
  // A window shifts the zooms onto its own clock and drops the overviews it cannot map.
  const from = map.chapters[2].start, to = from + 60;
  const window = beatMapToStory(map, { from, to, captions: false });
  assert.equal(validateStory(window).ok, true, validateStory(window).errors.join("\n"));
  for (const scene of window.scenes.filter((entry) => entry.zooms)) for (const zoom of scene.zooms) assert.ok(zoom.at >= scene.start && zoom.until <= scene.end);
  assert.ok(!window.scenes.some((scene) => scene.in?.type === "overview" && scene.in.span === "chapter" && !window.chapters));
  // camera: false keeps the hard cuts and no zooms.
  const cuts = beatMapToStory(map, { captions: false, camera: false });
  assert.equal(cuts.camera, undefined);
  assert.ok(cuts.scenes.every((scene) => !scene.zooms && (!scene.in || scene.in.type === "rack-focus")));
});

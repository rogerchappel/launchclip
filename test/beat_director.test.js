import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { BEAT_MAP_SCHEMA, beatMapEvents, beatMapReportText, beatMapToDirection, beatMapToStory, clauseBeats, directLongForm, dryRunWords, extractFacts, matchEvidence, parseScript, visualKind, windowWords } from "../kit/core/beat-director.mjs";
import { CADENCE_BENCHMARK, cadenceTarget } from "../kit/core/cadence.mjs";
import { validateDirection } from "../kit/core/direction.mjs";
import { longFormChunks } from "../kit/core/long-form.mjs";
import { knownModules, resolveModule } from "../kit/core/modules.mjs";
import { resolveStory, validateStory } from "../kit/core/story.mjs";

const FIXTURE = path.resolve("eval/fixtures/long-form-16min");
const script = readFileSync(path.join(FIXTURE, "SCRIPT.md"), "utf8");
const ledger = JSON.parse(readFileSync(path.join(FIXTURE, "research", "evidence.json"), "utf8"));
const captures = readdirSync(path.join(FIXTURE, "research", "captures")).sort().map((name) => JSON.parse(readFileSync(path.join(FIXTURE, "research", "captures", name), "utf8")));
const timed = dryRunWords(script, { wpm: 155 });
let cached = null;
// The fixture's structure (eval/beat-map-dry-run.mjs): subscribe calls at 3:30, 9:40 and 15:00, stings at both ends.
const STRUCTURE = { ctas: [210, 580, 900].map((at) => ({ at, action: "Subscribe for the next breakdown" })), stings: true };
const plan = () => (cached ??= directLongForm({ words: timed.words, chapters: timed.chapters, ledger, captures, title: timed.title }, STRUCTURE));

test("beat director: a script parses into chapters and dry-run timings", () => {
  const parsed = parseScript(script);
  assert.equal(parsed.chapters.length, 12);
  assert.equal(parsed.chapters[0].id, "the-launch-nobody-saw-coming");
  assert.ok(timed.duration > 900 && timed.duration < 1060, String(timed.duration));
  assert.equal(timed.chapters[0].start, 0);
  for (let i = 1; i < timed.words.length; i += 1) assert.ok(timed.words[i].start >= timed.words[i - 1].end);
});

test("beat director: clauses run 3–10 s and cover every word once", () => {
  const beats = clauseBeats(timed.words);
  let next = 0;
  for (const beat of beats) {
    assert.equal(beat.words[0], next);
    next = beat.words[1] + 1;
    assert.ok(beat.end - beat.start <= 10.01, `${beat.end - beat.start} s: ${beat.text}`);
  }
  assert.equal(next, timed.words.length);
  assert.ok(beats.filter((beat) => beat.end - beat.start < 3).length <= 3);
});

test("beat director: facts and kinds", () => {
  const facts = extractFacts("At 3 dollars per million tokens, down from $8, in March 2026, versus 62 percent.");
  assert.deepEqual(facts.numbers.map((entry) => entry.value), [3, 8, 62]);
  assert.equal(facts.numbers[1].prefix, "$");
  assert.equal(facts.numbers[2].unit, "%");
  assert.deepEqual(facts.dates.map((entry) => entry.label).sort(), ["2026", "Mar"]);
  assert.deepEqual(extractFacts("Faster, cheaper and better.").items, ["Faster", "cheaper", "better"]);
  assert.equal(extractFacts("viewed two million times").numbers[0].scaled, 2e6);
  const kind = (text, extra = {}) => visualKind({ text, facts: extractFacts(text), ...extra });
  assert.equal(kind("It scored 48 percent."), "share");
  assert.equal(kind("from 4.1 seconds to 1.8 seconds"), "compare");
  assert.equal(kind("The pull request collected comments."), "pr");
  assert.equal(kind("In 2023, then 2024."), "timeline");
  assert.equal(kind("anything", { evidence: { capture: { kind: "post" } } }), "social");
});

test("beat director: evidence first, by words and numbers, never by chance", () => {
  const beat = (text) => ({ text, facts: extractFacts(text) });
  const hit = matchEvidence(beat("Halcyon 2 scored 48 percent on the open test, compared with 39 percent."), { ledger, captures });
  assert.equal(hit.claim, "c-swe");
  assert.equal(hit.capture.id, "swe-leaderboard");
  assert.equal(hit.source.url, "https://leaderboard.example/swe");
  // As src/research writes it: the claim names its capture.
  const linked = { ...ledger, claims: ledger.claims.map((claim) => (claim.id === "c-latency" ? { ...claim, capture: "system-card-table-7" } : claim)) };
  assert.equal(matchEvidence(beat("answering a typical request in about 1.8 seconds instead of 4.1 seconds"), { ledger: linked, captures }).capture.id, "system-card-table-7");
  assert.equal(matchEvidence(beat("That second number is the one developers felt."), { ledger, captures }), null);
  assert.equal(matchEvidence(beat("Totally unrelated sentence about gardening."), { ledger, captures }), null);
});

test("beat director: the 16-minute dry run passes the long-form gate", () => {
  const map = plan();
  assert.equal(map.schema, BEAT_MAP_SCHEMA);
  assert.equal(map.chapters.length, 12);
  const { events, cuts } = beatMapEvents(map);
  const report = map.report;
  assert.equal(report.cadence.gate.ok, true, beatMapReportText(map));
  // Near the benchmark: ~170 events in 16 min, median ~5 s, a cut every 15–25 s.
  assert.ok(events.length > CADENCE_BENCHMARK.events * 0.85, String(events.length));
  assert.ok(Math.abs(report.cadence.gap.p50 - CADENCE_BENCHMARK.gap.p50) < 1.2, String(report.cadence.gap.p50));
  assert.ok(cuts.length >= 35 && cuts.length <= 70, String(cuts.length));
  const target = cadenceTarget("long-form");
  for (const chapter of map.chapters) for (const shot of chapter.shots) assert.ok(shot.states.length <= target.states.max + 1, shot.id);
  // States tile the runtime and every clause has a decision.
  const states = map.chapters.flatMap((chapter) => chapter.shots.flatMap((shot) => shot.states));
  for (let i = 1; i < states.length; i += 1) assert.ok(Math.abs(states[i].start - states[i - 1].end) < 1e-6, states[i].id);
  for (const state of states) { assert.ok(state.module && state.params && state.why, state.id); assert.ok(knownModules().includes(state.module), state.module); }
  // Builds inside shots, evidence on most claims, a plate per chapter that never repeats back to back.
  assert.ok(report.shots.changes.build >= 10, JSON.stringify(report.shots.changes));
  assert.ok(report.evidence.coverage >= 0.5, JSON.stringify(report.evidence));
  for (let i = 1; i < map.chapters.length; i += 1) assert.notEqual(map.chapters[i].plate.kind, map.chapters[i - 1].plate.kind);
  assert.ok(report.variety.modules >= 15 && report.variety.top[0].share < 0.25, JSON.stringify(report.variety));
  assert.ok(report.variety.longest_same_module_across_cuts <= 2);
});

test("beat director: mid-roll calls to action and logo stings, and words per event", () => {
  const map = plan();
  const states = map.chapters.flatMap((chapter) => chapter.shots.flatMap((shot) => shot.states));
  const ctas = states.filter((state) => state.kind === "cta");
  assert.deepEqual(ctas.map((state) => state.module), ["cta", "cta", "cta"]);
  for (const [i, at] of [210, 580, 900].entries()) assert.ok(ctas[i].start <= at + 0.6 && ctas[i].end > at, `${ctas[i].start}–${ctas[i].end} for ${at}`);
  assert.equal(states[0].kind, "sting");
  assert.equal(states.at(-1).kind, "sting");
  assert.equal(states[0].params.text, "Halcyon 2, explained");
  const wpe = map.report.cadence.words_per_event;
  assert.ok(wpe >= 10 && wpe <= 20, String(wpe));
  assert.ok(map.report.cadence.gate.checks.some((check) => check.id === "words_per_event" && check.ok));
});

test("beat director: the committed fixture is the planner's current output", () => {
  const committed = JSON.parse(readFileSync(path.join(FIXTURE, "BEATMAP.json"), "utf8"));
  const map = plan();
  assert.equal(committed.report.cadence.events, map.report.cadence.events, "re-run node eval/beat-map-dry-run.mjs --fresh");
  assert.deepEqual(committed.chunks.map((chunk) => chunk.key), map.chunks.map((chunk) => chunk.key), "re-run node eval/beat-map-dry-run.mjs --fresh");
});

test("beat director: chunks resume, and a changed chapter replans only from there", () => {
  const map = plan();
  const again = directLongForm({ words: timed.words, chapters: timed.chapters, ledger, captures, title: timed.title }, { ...STRUCTURE, previous: map });
  assert.equal(again.report.chunks.reused, map.chunks.length);
  assert.deepEqual(again.chapters, map.chapters);
  // Edit one word in chapter 7: chunks before it are reused, it and later ones replan.
  const words = timed.words.map((word) => ({ ...word }));
  const at = words.findIndex((word) => word.start >= map.chapters[6].start + 5);
  words[at].text = "remarkably";
  const edited = directLongForm({ words, chapters: timed.chapters, ledger, captures, title: timed.title }, { ...STRUCTURE, previous: map });
  const changed = edited.chunks.findIndex((chunk, i) => chunk.key !== map.chunks[i].key);
  assert.ok(changed > 0 && edited.report.chunks.reused === changed, `${changed} / ${edited.report.chunks.reused}`);
  assert.deepEqual(longFormChunks(timed.chapters, timed.words, { chunkSeconds: 40 }).every((chunk) => chunk.end - chunk.start <= 40), true);
});

test("beat director: an hour scales chapter by chapter", () => {
  const hour = { title: "An hour", chapters: [] };
  const parsed = parseScript(script);
  for (let k = 0; k < 4; k += 1) for (const chapter of parsed.chapters) hour.chapters.push({ ...chapter, id: `${chapter.id}-${k + 1}`, title: `${chapter.title} (${k + 1})` });
  const long = dryRunWords(hour, { wpm: 155 });
  assert.ok(long.duration > 3600 && long.duration < 4300, String(long.duration));
  const started = Date.now();
  const map = directLongForm({ words: long.words, chapters: long.chapters, ledger, captures, title: "An hour" });
  assert.ok(Date.now() - started < 30000);
  assert.equal(map.chapters.length, 48);
  assert.equal(map.report.cadence.gate.ok, true, beatMapReportText(map));
  // Visual memory spans the hour: the same chapter text later in the video does not get the same modules.
  const modules = (id) => map.chapters.find((chapter) => chapter.id === id).shots.flatMap((shot) => shot.states.map((state) => state.module));
  const first = modules("why-speed-changed-everything-1"), fourth = modules("why-speed-changed-everything-4");
  assert.notDeepEqual(first, fourth);
});

test("beat director: the map is a valid direction map and renders as a storyboard window", () => {
  const map = plan();
  const direction = beatMapToDirection(map);
  const check = validateDirection(direction, { words: timed.words, lane: "motion", deferScenes: true });
  assert.equal(check.ok, true, check.errors.join("\n"));
  const from = map.chapters[4].start, to = from + 45;
  const story = beatMapToStory(map, { from, to, title: "Speed sample" });
  const words = windowWords(timed.words, from, to);
  const validation = validateStory(story);
  assert.equal(validation.ok, true, validation.errors.join("\n"));
  const resolved = resolveStory(story, { words });
  for (const scene of resolved.scenes) assert.doesNotThrow(() => resolveModule(scene, resolved), scene.id);
  assert.equal(story.scenes[0].start, 0);
  assert.equal(story.scenes.at(-1).end, story.format.duration);
});

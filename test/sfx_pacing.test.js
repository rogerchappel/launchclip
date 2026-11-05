import assert from "node:assert/strict";
import test from "node:test";
import { CUE_LEVELS, cuePace, defaultSfxDensity, paceCues } from "../src/finish.js";
import { SFX_VARIANTS } from "../src/scripts/synth-audio-kit.mjs";

const AIR = new Set(["whoosh", "shimmer", "swipe", "slide", "sparkle", "riser"]);
const group = (cue) => (AIR.has(cue) ? "air" : cue);

// A busy edit: a module-event whoosh every 0.5 s, a pop between, and a
// narration hit every 3 s, over 30 s.
function busyCues() {
  const cues = [];
  for (let at = 0; at < 30; at += 0.5) {
    cues.push({ cue: "whoosh", at, volume: CUE_LEVELS.whoosh, shot: `s${Math.floor(at / 5)}`, source: "module-event", event: `title-${at}`, optional: true });
    cues.push({ cue: "pop", at: at + 0.25, volume: CUE_LEVELS.pop, shot: `s${Math.floor(at / 5)}`, source: "module-event", event: `point-${at}`, optional: true });
  }
  for (let at = 1; at < 30; at += 3) cues.push({ cue: "whoosh", at: at + 0.1, volume: CUE_LEVELS.whoosh, shot: "hits", source: "hit", event: `punch-${at}`, optional: false });
  return cues.sort((a, b) => a.at - b.at);
}

test("paceCues holds every 10 s window to the density's cap and keeps cues apart", () => {
  for (const density of ["low", "normal", "high", 0.4]) {
    const { per10, gap } = cuePace(density);
    const paced = paceCues(busyCues(), density, "story");
    assert.ok(paced.length > 0, `${density}: some cues survive`);
    for (const cue of paced) {
      const inWindow = paced.filter((other) => other.at >= cue.at && other.at < cue.at + 10);
      assert.ok(inWindow.length <= per10, `${density}: ${inWindow.length} cues from ${cue.at} s (cap ${per10})`);
    }
    for (let i = 1; i < paced.length; i++) assert.ok(paced[i].at - paced[i - 1].at >= gap - 1e-9, `${density}: ${paced[i - 1].at} → ${paced[i].at} closer than ${gap} s`);
  }
  // Lower density, fewer cues: low ≤ normal ≤ high.
  const counts = ["low", "normal", "high"].map((density) => paceCues(busyCues(), density, "story").length);
  assert.ok(counts[0] <= counts[1] && counts[1] <= counts[2], JSON.stringify(counts));
  assert.deepEqual(cuePace("low"), { per10: 2, gap: 2.6 });
  assert.deepEqual(cuePace("normal"), { per10: 3, gap: 1.76 });
  assert.deepEqual(cuePace("high"), { per10: 5, gap: 0.8 });
});

test("paceCues never plays the same family group twice running", () => {
  // Only whooshes and shimmers in: the bright sweeps must alternate with something else.
  const cues = Array.from({ length: 20 }, (_, i) => ({ cue: i % 3 ? "whoosh" : "shimmer", at: i * 1.5, volume: 0.4, shot: `s${i}`, source: i % 4 ? "module-event" : "hit", event: `e${i}`, optional: i % 4 !== 0 }));
  for (const density of ["low", "normal", "high"]) {
    const paced = paceCues(cues, density, "story");
    for (let i = 1; i < paced.length; i++) assert.notEqual(group(paced[i].cue), group(paced[i - 1].cue), `${density}: ${paced[i - 1].cue} at ${paced[i - 1].at} then ${paced[i].cue} at ${paced[i].at}`);
    // An air sweep is at most every 4 s.
    const air = paced.filter((cue) => group(cue.cue) === "air");
    for (let i = 1; i < air.length; i++) assert.ok(air[i].at - air[i - 1].at >= 4, `${density}: sweeps at ${air[i - 1].at} and ${air[i].at}`);
    assert.ok(paced.some((cue) => cue.swapped_from), `${density}: some repeats swap rather than drop`);
    for (const cue of paced.filter((entry) => entry.swapped_from)) assert.ok(["pop", "tick", "impact"].includes(cue.cue), cue.cue);
    // An impact only stands in for a narration hit.
    assert.ok(paced.filter((cue) => cue.cue === "impact").every((cue) => cue.source === "hit"));
  }
  // The busy edit too.
  const paced = paceCues(busyCues(), "high", "story");
  for (let i = 1; i < paced.length; i++) assert.notEqual(group(paced[i].cue), group(paced[i - 1].cue));
});

test("paceCues is deterministic, keeps explicit hits and passes typing through", () => {
  const cues = busyCues();
  assert.deepEqual(paceCues(cues, "normal", "a"), paceCues(structuredClone(cues), "normal", "a"));
  const typed = [
    ...cues,
    ...Array.from({ length: 12 }, (_, i) => ({ cue: "keystroke", at: 5 + i * 0.12, volume: 0.3, shot: "type", source: "module-event", event: `key-${i}`, optional: true })),
    { cue: "whoosh", at: 20.05, volume: 0.4, shot: "s4", source: "hit", event: "asked", optional: false, explicit: true },
    { cue: "whoosh", at: 20.3, volume: 0.4, shot: "s4", source: "hit", event: "asked-again", optional: false, explicit: true }
  ];
  const paced = paceCues(typed, "low", "a");
  assert.equal(paced.filter((cue) => cue.cue === "keystroke").length, 12, "typing is a texture, not an accent");
  assert.deepEqual(paced.filter((cue) => cue.explicit).map((cue) => [cue.cue, cue.at]), [["whoosh", 20.05], ["whoosh", 20.3]], "an explicit hit keeps its time and its sound");
  assert.equal(paceCues([], "normal", "a").length, 0);
});

test("defaultSfxDensity is low for footage-led and clip-led stories", () => {
  const story = (lane, clips) => ({ lane, resolved: { duration: 20 }, scenes: [
    ...Array.from({ length: clips }, (_, i) => ({ id: `c${i}`, module: "clip", track: 0, start: i * 4, end: i * 4 + 4 })),
    ...Array.from({ length: 5 - clips }, (_, i) => ({ id: `g${i}`, module: "concept-card", track: 0, start: (clips + i) * 4, end: (clips + i) * 4 + 4 }))
  ] });
  assert.equal(defaultSfxDensity(story("footage-led", 0)), "low");
  assert.equal(defaultSfxDensity(story("motion", 3)), "low", "60% of the runtime is footage");
  assert.equal(defaultSfxDensity(story("motion", 1)), "normal");
  assert.equal(defaultSfxDensity(story("voiceover-motion", 0)), "normal");
  assert.equal(defaultSfxDensity({}), "normal");
});

test("the synth whoosh stays low: bands under 2 kHz and a low-pass at or below 4.2 kHz", () => {
  const whooshes = SFX_VARIANTS.filter((entry) => entry.family === "whoosh");
  assert.equal(whooshes.length, 3);
  for (const { name, spec } of whooshes) {
    const lowpass = Math.min(...[...spec.master.matchAll(/lowpass=f=(\d+)/g)].map((match) => Number(match[1])));
    assert.ok(lowpass <= 4200, `${name}: master low-pass ${lowpass} Hz`);
    for (const layer of spec.layers) {
      const band = /bandpass=f=(\d+)/.exec(layer.filter ?? "");
      if (band) assert.ok(Number(band[1]) <= 2000, `${name}: a ${band[1]} Hz band`);
    }
  }
});

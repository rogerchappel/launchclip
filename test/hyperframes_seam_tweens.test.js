// The HyperFrames compiler closes the float seams between back-to-back
// tweens on one target (a blink's close and open, a drift's legs), which
// `hyperframes check --strict` reported as overlapping tweens on every cast
// or camera story; real overlaps stay as they are.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveStory } from "@launchclip/core/story.mjs";
import { SEAM_OVERLAP, compileStoryToHyperFrames, seamTweens } from "../kit/hyperframes/story-compiler.mjs";

const line = (selector, to, at, indent = "") => `${indent}tl.fromTo(${JSON.stringify(selector)}, {"scaleY":1}, ${JSON.stringify(to)}, ${at});`;

test("a seam overlap from rounding is trimmed to end where the next tween starts", () => {
  const blink = [
    line("#s1-cast-c1-eyes-confused", { scaleY: 0.12, duration: 0.06, ease: "power1.in", immediateRender: false }, 1.7875, "      "),
    line("#s1-cast-c1-eyes-confused", { scaleY: 1, duration: 0.09, ease: "power1.out", immediateRender: false }, 1.8475, "      ")
  ];
  assert.ok(1.7875 + 0.06 > 1.8475, "the float seam the check reported");
  const [first, second] = seamTweens(blink);
  const duration = Number(/"duration":([0-9.]+)/.exec(first)[1]);
  assert.ok(1.7875 + duration <= 1.8475 && 1.8475 - (1.7875 + duration) < 1e-5, String(duration));
  assert.match(first, /^      tl\.fromTo\("#s1-cast-c1-eyes-confused", \{"scaleY":1\}, \{"scaleY":0\.12,"duration":0\.059999,"ease":"power1\.in","immediateRender":false\}, 1\.7875\);$/);
  assert.equal(second, blink[1]);
  // A drift leg written with a 6-decimal duration from a 4-decimal start.
  const drift = [line("#lc-cam-drift", { x: -15.8, duration: 7.733334, ease: "sine.inOut" }, 0), line("#lc-cam-drift", { x: 0, duration: 7.733334, ease: "sine.inOut" }, 7.7333)];
  assert.match(seamTweens(drift)[0], /"duration":7\.7333,/);
});

test("real overlaps, other properties, other targets and other lines are left alone", () => {
  const lines = [
    line("#a", { x: 10, duration: 1 }, 0),
    line("#a", { x: 0, duration: 1 }, 0.5),
    line("#b", { x: 10, duration: 1.0004 }, 0),
    line("#b", { y: 0, duration: 1 }, 1),
    line("#c", { x: 10, duration: 1.0004 }, 0),
    line("#d", { x: 0, duration: 1 }, 1),
    'tl.set("#a", {"x":0}, 2);',
    "tl.fromTo(heldTl, { time: 1 }, { time: 1, duration: 2, ease: 'none', immediateRender: false }, 0.9995);"
  ];
  assert.deepEqual(seamTweens(lines), lines);
  assert.equal(SEAM_OVERLAP, 1e-3);
});

test("a compiled cast story has no seam overlaps left on any target", async () => {
  const brand = { colors: { bg: "#101820", primary: "#2a9d8f", accent: "#e9c46a", ink: "#101820", paper: "#f4f1ea" }, fonts: { display: "anton", body: "space-grotesk", meta: "jetbrains-mono" } };
  const story = { schema: "launchclip.story.v1", lane: "motion", brand, format: { width: 1080, height: 1920, fps: 30, duration: 12 }, cast: { characters: [{ id: "maya" }, { id: "theo" }] },
    scenes: [
      { id: "w", module: "world", start: 0, end: 12, params: { kind: "living-room", camera: "drift" } },
      { id: "c", module: "cast-scene", track: 1, start: 0, end: 12, params: { set: "standing", cast: [{ id: "maya", expression: "confused", cues: [{ at: 2, action: "point-at", target: { character: "theo" } }] }, { id: "theo", expression: "happy" }] } }
    ] };
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-seams-"));
  try {
    await compileStoryToHyperFrames(resolveStory(story, { words: [] }), { projectDir: dir });
    const html = await readFile(path.join(dir, "index.html"), "utf8");
    const tweens = [...html.matchAll(/tl\.fromTo\(("(?:[^"\\]|\\.)*"), \{[^{}]*\}, (\{"[^{}]*\}), (-?[0-9.e-]+)\);/g)].map((match) => {
      const to = JSON.parse(match[2]);
      return { selector: match[1], at: Number(match[3]), end: Number(match[3]) + Number(to.duration), props: Object.keys(to).filter((key) => !["duration", "ease", "immediateRender", "force3D"].includes(key)) };
    }).filter((tween) => tween.end > tween.at);
    assert.ok(tweens.length > 20, "the story compiles to tweens");
    const seams = [];
    for (const a of tweens) for (const b of tweens) {
      if (a === b || a.selector !== b.selector || !(b.at > a.at) || !a.props.some((prop) => b.props.includes(prop))) continue;
      const over = a.end - b.at;
      if (over > 0 && over <= SEAM_OVERLAP) seams.push(`${a.selector} ${a.at}→${a.end} into ${b.at}`);
    }
    assert.deepEqual(seams, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

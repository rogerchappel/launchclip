// Camera moves and the caption band (blind test 2): vertical pans and dollies
// swept panels through the captions mid-move, and layout-check, which only
// reasons about rects at rest, missed it. Now layout-check samples every frame
// of every camera move, and both renderers dip the captions out for sweeping
// moves by default (captions.hide_during_moves: "auto").
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import gsap from "gsap";
import { cameraPlan, captionDipWindows, sceneObjectLookup, sweepingMove } from "@launchclip/core/camera-world.mjs";
import { captionDipHidden, captionDipOpacity, captionDipTweens, captionMoveHide, CAPTION_DIP_RAMP } from "@launchclip/core/captions.mjs";
import { checkCameraSweeps } from "@launchclip/core/layout-check.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { sceneWindows } from "@launchclip/core/transitions.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";
import { checkLayoutProject } from "../src/layout_check.js";

const W = 1080, H = 1920;
const brand = { colors: { bg: "#0b1020", primary: "#ff7a59", accent: "#7ce7ff", ink: "#0b1020", paper: "#f5f1ea" }, fonts: { display: "anton", body: "inter", meta: "jetbrains-mono" } };

function story({ hide, moves = ["right", "down", "push", "orbit"] } = {}) {
  const transition = (move) => (move === "push" ? { type: "push", dur: 0.9 } : move === "orbit" ? { type: "orbit", dur: 0.8, direction: "right" } : { type: "pan", dur: 0.8, direction: move });
  return {
    schema: "launchclip.story.v1", lane: "motion",
    format: { width: W, height: H, fps: 30, duration: 20 }, brand,
    motion: { grammar: "editorial" }, camera: { mode: "world" },
    overlays: [{ type: "captions", ...(hide === undefined ? {} : { hide_during_moves: hide }) }],
    scenes: [
      { id: "s1", module: "count-up", start: 0, end: 4, params: { value: 1, label: "One" } },
      ...moves.map((move, index) => ({ id: `s${index + 2}`, module: "count-up", start: 4 * (index + 1), end: 4 * (index + 2), in: transition(move), params: { value: index + 2, label: "Next" } }))
    ]
  };
}
const planFor = (resolved) => cameraPlan(resolved, { windows: sceneWindows(resolved), objects: sceneObjectLookup(resolved, (scene, value) => resolveModule(scene, value)) });
// Words spoken across the whole story, so captions are on screen during every move.
const words = Array.from({ length: 100 }, (_, i) => ({ text: `w${i}`, start: i * 0.2, end: i * 0.2 + 0.18 }));

test("auto picks the moves that sweep content vertically: vertical pans, dollies and orbits, not horizontal pans", () => {
  const plan = planFor(resolveStory(story()));
  assert.deepEqual(plan.moves.map((move) => [move.type, sweepingMove(move)]), [["pan", false], ["pan", true], ["push", true], ["orbit", true]]);
  assert.deepEqual(captionDipWindows(plan, "auto").map((w) => w.start), [8, 12, 16]);
  assert.deepEqual(captionDipWindows(plan, true).map((w) => w.start), [4, 8, 12, 16]);
  assert.deepEqual(captionDipWindows(plan, false), []);
  assert.deepEqual(captionDipWindows(null, "auto"), []);
  assert.equal(captionMoveHide({}), "auto");
  assert.equal(captionMoveHide({ hide_during_moves: false }), false);
  assert.equal(captionMoveHide({ hide_during_moves: true }), true);
});

test("hide_during_moves validates", () => {
  for (const value of ["auto", true, false]) assert.deepEqual(validateStory(story({ hide: value })).errors, []);
  assert.match(validateStory(story({ hide: "vertical" })).errors.join("\n"), /hide_during_moves must be "auto"/);
});

test("the caption dip is fully out for the whole move, and the frame-pure opacity matches the GSAP tweens", () => {
  const windows = [{ start: 2, end: 2.8 }, { start: 3, end: 3.5 }, { start: 6, end: 6.4 }];
  const tweens = captionDipTweens(windows);
  // The first two windows are closer than two ramps, so they merge.
  assert.deepEqual(tweens.map((tw) => tw.at), [2 - CAPTION_DIP_RAMP, 3.5, 6 - CAPTION_DIP_RAMP, 6.4]);
  for (let t = 2; t <= 3.5; t += 0.05) assert.equal(captionDipOpacity(windows, t), 0, `out at ${t}`);
  assert.equal(captionDipOpacity(windows, 1), 1);
  assert.equal(captionDipOpacity(windows, 7), 1);
  assert.deepEqual(captionDipHidden(windows), [[2 - CAPTION_DIP_RAMP / 2, 3.5 + CAPTION_DIP_RAMP / 2], [6 - CAPTION_DIP_RAMP / 2, 6.4 + CAPTION_DIP_RAMP / 2]]);
  const target = { opacity: 1 };
  const tl = gsap.timeline({ paused: true });
  for (const tw of tweens) tl.fromTo(target, { opacity: tw.from }, { opacity: tw.to, duration: tw.dur, ease: "none", immediateRender: false }, tw.at);
  tl.set({}, {}, 10);
  for (const t of [0, 1.85, 1.9, 1.95, 2, 3, 3.5, 3.55, 3.6, 3.7, 5, 5.9, 6.2, 6.45, 6.5, 9]) {
    tl.seek(t, false);
    assert.ok(Math.abs(target.opacity - captionDipOpacity(windows, t)) < 1e-6, `t=${t}: gsap ${target.opacity} vs ${captionDipOpacity(windows, t)}`);
  }
});

test("checkCameraSweeps reports crossings while captions are visible: a warning, an error once it lasts", () => {
  const band = { x: 65, y: 1190, width: 853, height: 230 };
  const move = { sceneId: "s2", type: "pan", direction: "down", start: 1, duration: 0.8 };
  const frames = Array.from({ length: 12 }, (_, i) => ({ t: 1 + i / 30, move, rects: [{ id: "s1", rect: { x: 100, y: 1100 + i * 20, width: 800, height: 300 } }] }));
  const findings = checkCameraSweeps({ band, frames, captionVisible: [[0, 5]], step: 1 / 30 });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "camera-caption-band");
  assert.equal(findings[0].severity, "error");
  assert.match(findings[0].detail, /pan down into s2 carries s1 through the caption band/);
  assert.equal(checkCameraSweeps({ band, frames: frames.slice(0, 4), captionVisible: [[0, 5]], step: 1 / 30 })[0].severity, "warning");
  assert.deepEqual(checkCameraSweeps({ band, frames, captionVisible: [[3, 5]], step: 1 / 30 }), [], "captions off screen");
  // A panel edge grazing the band (drift) is not a crossing.
  const grazing = [{ t: 1, move, rects: [{ id: "s1", rect: { x: 100, y: 900, width: 800, height: 295 } }] }];
  assert.deepEqual(checkCameraSweeps({ band, frames: grazing, captionVisible: [[0, 5]] }), []);
});

test("layout-check flags a vertical pan through the captions only when the captions stay on for it", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lc-sweep-"));
  try {
    const check = async (hide) => {
      const own = story({ hide, moves: ["down", "up"] });
      await writeFile(path.join(dir, "storyboard.json"), JSON.stringify(own));
      return (await checkLayoutProject(dir, { story: own, words })).findings.filter((finding) => finding.rule === "camera-caption-band");
    };
    const on = await check(false);
    assert.ok(on.length > 0, "a vertical pan with captions on crosses the band");
    assert.ok(on.every((finding) => /pan (down|up) into s[23]/.test(finding.detail)), JSON.stringify(on));
    assert.deepEqual(await check(undefined), [], "auto dips the captions for vertical pans");
    assert.deepEqual(await check(true), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the HyperFrames compiler dips #lc-captions for sweeping moves", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lc-sweep-hf-"));
  try {
    await writeFile(path.join(dir, "NARRATION.json"), JSON.stringify({ words }));
    const compile = (own) => compileStoryToHyperFrames(resolveStory({ ...own, audio: { words: "NARRATION.json" } }, { words }), { write: false, sourceDir: dir });
    const html = (await compile(story())).html;
    const dips = html.match(/tl\.fromTo\('#lc-captions'/g) ?? [];
    assert.equal(dips.length, 6, "three sweeping moves, two ramps each");
    // Each dip out ends in a hard kill at its end (HyperFrames' StaticGuard asks for one at a shot's start).
    const outs = [...html.matchAll(/tl\.fromTo\('#lc-captions', \{ opacity: 1 \}, \{ opacity: 0, duration: ([\d.]+), ease: 'none', immediateRender: false \}, ([\d.]+)\);\n\s*tl\.set\('#lc-captions', \{ opacity: 0 \}, ([\d.]+)\);/g)];
    assert.equal(outs.length, 3);
    for (const [, dur, at, kill] of outs) assert.ok(Math.abs(Number(at) + Number(dur) - Number(kill)) < 1e-3);
    assert.equal((await compile(story({ hide: false }))).html.includes("tl.fromTo('#lc-captions'"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

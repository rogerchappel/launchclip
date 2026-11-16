// Per-element entrances (docs/PLAN_AND_PACE_RFC.md §4.2, phase 5): synthetic
// RGB frames with known eases, kinds and staggers, the profile stats, and
// the grammar the style drafter writes from them.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeEntrancesFile, classifyEntrances, ENTRANCE_EASE_ROLES, entranceStats, MODULE_STAGGER_SECONDS } from "../src/render_motion_analysis.js";
import { getRenderer } from "../src/renderers/index.js";
import { compileStoryCommand } from "../src/story_cli.js";
import { mediaSkip } from "./helpers/media.js";
import { grammarFromEntrances } from "../src/style_reference.js";
import { easeRole, grammarErrors } from "@launchclip/core/grammar.mjs";

const W = 96, H = 160, FPS = 30;
const EASES = {
  "power3.out": (p) => 1 - (1 - p) ** 3,
  "power2.in": (p) => p * p,
  "power2.inOut": (p) => (p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) ** 2),
  none: (p) => p
};
// A textured item: stripes, so it has detail the background lacks.
const ink = (x, y) => ((x >> 1) + (y >> 1)) % 2 ? [250, 200, 40] : [120, 60, 10];
const BG = [10, 12, 20];

/**
 * `seconds` of frames; items: [{x, y, w, h, at, dur, ease, kind}] where
 * kind is fade (opacity), slide (from 24 px below), scale (from 0.3 wide)
 * or wipe (revealed left to right). drift: a slowly breathing band.
 */
function render(seconds, items, { drift = false } = {}) {
  const frames = [];
  for (let f = 0; f < Math.round(seconds * FPS); f += 1) {
    const t = f / FPS, frame = new Uint8Array(W * H * 3);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      const k = (y * W + x) * 3;
      const glow = drift && y >= H - 24 ? 40 * (1 + Math.sin(t * 2 + x / 30)) : 0;
      frame[k] = BG[0] + glow; frame[k + 1] = BG[1] + glow; frame[k + 2] = BG[2] + glow;
    }
    for (const item of items) {
      const p = EASES[item.ease](Math.min(1, Math.max(0, (t - item.at) / item.dur)));
      if (p <= 0) continue;
      const kind = item.kind ?? "fade";
      const alpha = kind === "fade" ? p : 1;
      const dy = kind === "slide" ? Math.round(24 * (1 - p)) : 0;
      const sx = kind === "scale" ? 0.3 + 0.7 * p : 1;
      for (let y = 0; y < item.h; y += 1) for (let x = 0; x < item.w; x += 1) {
        if (kind === "wipe" && x > p * item.w) continue;
        const cx = kind === "scale" ? Math.round(item.x + item.w / 2 + (x - item.w / 2) * sx) : item.x + x;
        const cy = item.y + y + dy;
        if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
        const k = (cy * W + cx) * 3, c = ink(x, y);
        for (let j = 0; j < 3; j += 1) frame[k + j] = Math.round(frame[k + j] * (1 - alpha) + c[j] * alpha);
      }
    }
    frames.push(frame);
  }
  return Buffer.concat(frames);
}

// Four rows entering `interval` apart.
const rows = (interval, ease, kind = "fade", dur = 0.4) => [0, 1, 2, 3].map((i) => ({ x: 16, y: 12 + i * 34, w: 64, h: 20, at: 0.4 + i * interval, dur, ease, kind }));

test("each ease is read back with its grammar role", () => {
  const expected = { "power3.out": "ease-out", "power2.in": "ease-in", "power2.inOut": "in-out", none: "linear" };
  for (const [ease, measured] of Object.entries(expected)) {
    const { entrances } = classifyEntrances(render(2.4, rows(0.45, ease, "fade", 0.5)), W, H, FPS);
    assert.equal(entrances.length, 4, ease);
    assert.deepEqual(entrances.map((entry) => entry.ease), Array(4).fill(measured), ease);
    assert.equal(ENTRANCE_EASE_ROLES[measured], easeRole(ease), ease);
  }
});

test("a stagger's interval comes back within a frame", () => {
  for (const interval of [0.25, 0.4, 0.55]) {
    const { sequences } = classifyEntrances(render(0.8 + 4 * interval, rows(interval, "power3.out")), W, H, FPS);
    assert.equal(sequences.length, 1, String(interval));
    assert.equal(sequences[0].count, 4);
    assert.ok(Math.abs(sequences[0].interval - interval) <= 1 / FPS, `${sequences[0].interval} vs ${interval}`);
  }
  // Irregular gaps are not a stagger.
  const ragged = rows(0.3, "power3.out").map((item, i) => ({ ...item, at: [0.4, 0.55, 1.3, 1.45][i] }));
  assert.deepEqual(classifyEntrances(render(2.2, ragged), W, H, FPS).sequences, []);
});

test("how an element enters: fade, slide with direction, scale, draw-on with direction", () => {
  const one = (kind) => classifyEntrances(render(1.4, [{ x: 16, y: 60, w: 64, h: 20, at: 0.3, dur: 0.5, ease: "power3.out", kind }]), W, H, FPS).entrances.map(({ kind: k, direction }) => [k, direction]);
  assert.deepEqual(one("fade"), [["fade", undefined]]);
  assert.deepEqual(one("slide"), [["slide", "up"]]);
  assert.deepEqual(one("scale"), [["scale", undefined]]);
  assert.deepEqual(classifyEntrances(render(1.4, [{ x: 4, y: 60, w: 88, h: 20, at: 0.3, dur: 0.6, ease: "none", kind: "wipe" }]), W, H, FPS).entrances.map(({ kind, direction }) => [kind, direction]), [["draw-on", "right"]]);
});

test("an exit is not an entrance, and a drifting band is the continuous layer", () => {
  const frames = render(2.4, rows(0.4, "power3.out"), { drift: true });
  // Play it backwards: every item leaves.
  const size = W * H * 3, n = frames.length / size;
  const backwards = Buffer.concat(Array.from({ length: n }, (_, i) => frames.subarray((n - 1 - i) * size, (n - i) * size)));
  const reversed = classifyEntrances(backwards, W, H, FPS);
  assert.equal(reversed.entrances.length, 0);
  assert.ok(reversed.events.filter((event) => event.role === "exit").length >= 4);
  const { continuous, entrances } = classifyEntrances(frames, W, H, FPS);
  assert.equal(entrances.length, 4);
  assert.ok(continuous.share > 0.1 && continuous.share < 0.2, String(continuous.share));
  assert.ok(continuous.box.y >= 0.8, JSON.stringify(continuous.box));
});

test("entrance stats and the grammar drafted from them", () => {
  const stats = entranceStats(classifyEntrances(render(2.4, rows(0.42, "power2.inOut", "fade", 0.5)), W, H, FPS));
  assert.deepEqual(stats.entrance_ease_mix, { "in-out": 1 });
  assert.deepEqual(stats.entrance_kind_mix, { fade: 1 });
  assert.ok(Math.abs(stats.stagger_interval_seconds - 0.42) <= 1 / FPS);
  assert.ok(stats.entrance_seconds > 0.3 && stats.entrance_seconds <= 0.6, String(stats.entrance_seconds));
  assert.deepEqual(entranceStats(null), { entrance_seconds: null, stagger_interval_seconds: null, entrance_ease_mix: {}, entrance_kind_mix: {}, continuous_layer_share: 0 });
  const drafted = grammarFromEntrances({ ...stats, stagger_interval_seconds: 0.42 });
  assert.deepEqual(drafted.overrides, { duration: { enter: +stats.entrance_seconds.toFixed(2) }, stagger: +(0.42 / MODULE_STAGGER_SECONDS).toFixed(2), ease: { enter: "power2.inOut" } });
  assert.deepEqual(grammarErrors({ base: "editorial", ...drafted.overrides }), []);
  // Ease-out keeps the preset's ease; ease-in (the entrance-ease mistake) is never copied; no data, no overrides.
  assert.equal(grammarFromEntrances({ entrance_ease_mix: { "ease-out": 1 }, entrance_seconds: 0.3 }).overrides.ease, undefined);
  assert.equal(grammarFromEntrances({ entrance_ease_mix: { "ease-in": 1 }, entrance_seconds: null, stagger_interval_seconds: null }), null);
  assert.equal(grammarFromEntrances({}), null);
});

// The RFC's test: kinetic-words beats (the scale entrance: opacity, scale
// and blur on one ease) at three known staggers, with the grammar's enter
// ease set to each role, rendered by both renderers at 360×640. Each scene
// ends one stagger (plus the 0.3 s exit) after its last beat, so every beat
// in a scene enters for the same min(0.42, stagger − 0.12) s. The
// measured ease's role must match the planned one for at least 85% of the
// beats, and each scene's stagger interval must come back within a frame.
test("both renderers: entrance eases and stagger intervals from our own ops", { skip: mediaSkip(), timeout: 1_800_000 }, async (t) => {
  const work = await mkdtemp(path.join(os.tmpdir(), "launchclip-entrances-"));
  const staggers = [0.3, 0.45, 0.6], words = ["ONE", "TWO", "SIX", "TEN"];
  let at = 0;
  const scenes = staggers.map((gap, i) => {
    const length = 0.5 + gap * 4 + 0.3;
    const scene = { id: `s${i}`, module: "kinetic-words", start: +at.toFixed(3), end: +(at + length).toFixed(3), energy: 1, params: { layout: "stack", variant: "scale", words: words.map((text, k) => ({ text, at: +(0.5 + k * gap).toFixed(3), emphasis: true })) } };
    at += length;
    return scene;
  });
  const misses = [];
  const planned = scenes.flatMap((scene) => scene.params.words.map((word) => scene.start + word.at));
  try {
    for (const name of ["hyperframes", "remotion"]) {
      let right = 0, total = 0;
      for (const ease of Object.keys(EASES)) {
        const project = path.join(work, `${name}-${ease}`);
        await mkdir(project, { recursive: true });
        await writeFile(path.join(project, "storyboard.json"), JSON.stringify({
          schema: "launchclip.story.v1", title: "Entrances", lane: "motion", format: { width: 360, height: 640, fps: 30, duration: +at.toFixed(3), platform: "youtube-shorts" },
          brand: { colors: { bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", ink: "#06070d", paper: "#f2eee6" }, fonts: { display: "anton", body: "space-grotesk", meta: "jetbrains-mono" } },
          motion: { grammar: { base: "editorial", ease: { enter: ease } } }, scenes
        }));
        await compileStoryCommand(project, { renderer: name, ...(name === "hyperframes" ? { out: path.join(project, "hyperframes") } : {}) });
        const video = path.join(work, `${name}-${ease}.mp4`);
        await getRenderer(name).render(name === "hyperframes" ? path.join(project, "hyperframes") : project, video, { quality: "draft" });
        const { entrances, sequences } = await analyzeEntrancesFile(video);
        await rm(video, { force: true });
        const roles = planned.map((time) => { const found = entrances.find((entry) => entry.at >= time - 0.1 && entry.at <= time + 0.25); return found ? ENTRANCE_EASE_ROLES[found.ease] : "missed"; });
        right += roles.filter((role) => role === easeRole(ease)).length;
        total += planned.length;
        const intervals = scenes.map((scene, i) => sequences.find((entry) => entry.at >= scene.start + 0.4 && entry.at <= scene.start + 0.75)?.interval ?? null);
        t.diagnostic(`${name} ${ease}: roles ${roles.map((role) => role ?? "linear").join(" ")}; intervals ${intervals.join(", ")} (planned ${staggers.join(", ")})`);
        intervals.forEach((interval, i) => { if (!(interval !== null && Math.abs(interval - staggers[i]) <= 1 / 30 + 1e-9)) misses.push(`${name} ${ease}: scene ${i} interval ${interval} vs ${staggers[i]}`); });
      }
      t.diagnostic(`${name}: ease role right for ${right}/${total}`);
      assert.ok(right >= 0.85 * total, `${name}: ${right}/${total}`);
    }
    assert.deepEqual(misses, [], "every stagger interval within one 30 fps frame");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

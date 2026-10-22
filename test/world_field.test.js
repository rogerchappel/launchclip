// The world camera's background (docs/KIT_CONTRACTS.md, "World camera"): one
// continuous field across the whole world extent, with no tile edge anywhere
// the camera travels. Regression for the blind-test finding "hard vertical
// seams on settled frames": the field used to be a canvas-sized box with
// overflow hidden inside the 0.3× depth layer, so after a pan its edge sat in
// the frame (world-camera-9x16 at t = 8: x ≈ 717 px). And `parallax: false`
// used to drop the layer, leaving flat bg behind the transparent plates.
//
// The sampler composites the blobs' radial falloff over brand.colors.bg the
// way the CSS gradients draw them, along a horizontal line through the former
// seam, from each renderer's own math: Remotion's (backgroundFieldTiles +
// blobStateAt, per frame) and HyperFrames' (the tile wrappers parsed from the
// compiled page and the blob tweens played on a paused GSAP timeline).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import gsap from "gsap";
import { ambientField, blobStateAt, fieldTiles, luma } from "../kit/core/ambient.mjs";
import { backgroundExtent, backgroundFieldTiles, cameraPlan, opsStateAt, sceneObjectLookup } from "../kit/core/camera-world.mjs";
import { resolveModule } from "../kit/core/modules.mjs";
import { resolveStory } from "../kit/core/story.mjs";
import { sceneWindows } from "../kit/core/transitions.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const GOLDEN = path.join(ROOT, "examples/story/world-camera-9x16");

async function golden(mutate = (story) => story) {
  const story = JSON.parse(await readFile(path.join(GOLDEN, "storyboard.json"), "utf8"));
  const narration = JSON.parse(await readFile(path.join(GOLDEN, "NARRATION.json"), "utf8"));
  return resolveStory(mutate(story), { words: narration.words });
}
const landscape = (story) => ({ ...story, format: { ...story.format, width: 1920, height: 1080 } });
const planFor = (story) => cameraPlan(story, { windows: sceneWindows(story), objects: sceneObjectLookup(story, (scene, value) => resolveModule(scene, value)) });

// The CSS falloff of ambient.mjs blobBackground (stop %, alpha fraction).
const FALLOFF = [[0, 1], [15, 0.94], [30, 0.78], [45, 0.56], [60, 0.34], [75, 0.16], [88, 0.05], [100, 0]];
function falloff(r) {
  if (r >= 1) return 0;
  const p = r * 100;
  for (let i = 1; i < FALLOFF.length; i += 1) {
    const [s1, a1] = FALLOFF[i], [s0, a0] = FALLOFF[i - 1];
    if (p <= s1) return a0 + ((a1 - a0) * (p - s0)) / (s1 - s0);
  }
  return 0;
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * Luma along screen row y at x = 0…width−1 for a depth layer at translation
 * `layer` ({x, y}; the layer does not roll on these frames). copies: [{blob,
 * dx, dy, state: {x, y, scale}}]. clip: the old field box ([0, W] × [0, H] in
 * the layer frame, overflow hidden), to show the sampler sees that seam.
 */
function row(story, copies, layer, y, { clip = false } = {}) {
  const { width, height } = story.format;
  const bg = rgb(story.brand.colors.bg);
  const out = [];
  for (let x = 0; x < width; x += 1) {
    const lx = x - layer.x, ly = y - layer.y;
    let c = [...bg];
    if (!clip || (lx >= 0 && lx < width && ly >= 0 && ly < height)) {
      for (const { blob, dx, dy, state } of copies) {
        const radius = (blob.size * state.scale) / 2;
        const cx = dx + state.x + blob.size / 2, cy = dy + state.y + blob.size / 2;
        const a = blob.alpha * falloff(Math.hypot(lx - cx, ly - cy) / radius);
        if (a > 0) c = c.map((v, i) => v + (blob.rgb[i] - v) * a);
      }
    }
    out.push(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]);
  }
  return out;
}
const maxJump = (values) => values.slice(1).reduce((max, v, i) => Math.max(max, Math.abs(v - values[i])), 0);

// Remotion: per-frame state from the shared pure functions.
function remotionCopies(plan, field, t) {
  const byId = new Map(field.blobs.map((blob) => [blob.id, blob]));
  return backgroundFieldTiles(plan, field).map((tile) => ({ blob: byId.get(tile.blob), dx: tile.dx, dy: tile.dy, state: blobStateAt(byId.get(tile.blob), t) }));
}

// HyperFrames: the compiled page's tile wrappers and blob tweens, sought on GSAP.
function hyperframesCopies(html, field, t) {
  const byId = new Map(field.blobs.map((blob) => [blob.id, blob]));
  const tiles = [...html.matchAll(/<div class="lc-world-tile" style="transform:translate\(([-\d.]+)px, ([-\d.]+)px\)"><div class="lc-ambient-blob lc-amb-world-(b\d+)"/g)]
    .map(([, dx, dy, id]) => ({ id, dx: Number(dx), dy: Number(dy) }));
  const targets = new Map(field.blobs.map((blob) => [blob.id, { ...blobStateAt(blob, 0) }]));
  const tl = gsap.timeline({ paused: true });
  for (const [, id, from, to, at] of html.matchAll(/tl\.fromTo\("\.lc-amb-world-(b\d+)", (\{[^}]*\}), (\{[^}]*\}), ([\d.]+)\);/g)) {
    const { force3D, ...f } = JSON.parse(from);
    const { force3D: _ignored, ...v } = JSON.parse(to);
    tl.fromTo(targets.get(id), f, v, Number(at));
  }
  tl.set({}, {}, 30);
  tl.seek(t, false);
  return tiles.map((tile) => ({ blob: byId.get(tile.id), dx: tile.dx, dy: tile.dy, state: { ...targets.get(tile.id) } }));
}

// Settled after the first pan (the blind-test seam frame), mid-pan, mid-push and after the push.
const CASES = [
  { name: "9:16", mutate: (story) => story, times: [8.0, 3.0, 16.0, 18.0] },
  { name: "16:9", mutate: landscape, times: [8.0, 3.0, 16.0, 18.0] }
];

for (const { name, mutate, times } of CASES) {
  test(`world background ${name}: one continuous field, no seam, the same in both renderers`, async () => {
    const story = await golden(mutate);
    const plan = planFor(story);
    const field = ambientField(story);
    assert.equal(plan.depth, 0.3);
    const { html } = await compileStoryToHyperFrames(story, { write: false, sourceDir: GOLDEN });
    // Field only, never clipped: no canvas-sized overflow-hidden box, no glows under it.
    assert.match(html, /<div id="lc-world-bg" class="lc-world-bg" aria-hidden="true"><div id="lc-amb-field-world" class="lc-world-field"/);
    assert.doesNotMatch(html, /class="lc-world-glow"/);
    assert.match(html, /\.lc-world-field, \.lc-world-tile \{[^}]*overflow: visible;/);
    const { width, height } = story.format;
    for (const t of times) {
      const layer = opsStateAt(plan.ops, "background", t);
      assert.ok(Math.abs(layer.rotation ?? 0) < 1e-9, "no roll on these frames");
      const rm = remotionCopies(plan, field, t), hf = hyperframesCopies(html, field, t);
      assert.ok(rm.length > field.blobs.length, "the field is tiled across the world");
      assert.equal(hf.length, rm.length, "HyperFrames draws every copy Remotion draws");
      // The old seam: the field box's right edge in the frame (x = W + layer.x).
      const seam = Math.round(width + layer.x);
      for (const y of [Math.round(height * 0.3), Math.round(height * 0.5), Math.round(height * 0.75)]) {
        const a = row(story, rm, layer, y), b = row(story, hf, layer, y);
        // Soft blobs: the steepest real gradient is well under 1 luma level per px.
        assert.ok(maxJump(a) < 0.6, `Remotion row y=${y} t=${t}: luma jump ${maxJump(a).toFixed(3)}`);
        assert.ok(maxJump(b) < 0.6, `HyperFrames row y=${y} t=${t}: luma jump ${maxJump(b).toFixed(3)}`);
        assert.ok(a.every((v, i) => Math.abs(v - b[i]) < 0.25), `renderers agree on row y=${y} t=${t}`);
        if (seam > 2 && seam < width - 2) {
          const window = a.slice(seam - 3, seam + 3);
          assert.ok(maxJump(window) < 0.6, `no step across the former seam x=${seam}`);
        }
      }
    }
    // The sampler does see the old clipped box's edge on the blind-test frame.
    const t = 8.0, layer = opsStateAt(plan.ops, "background", t);
    const old = row(story, remotionCopies(plan, field, t).filter((copy) => copy.dx === 0 && copy.dy === 0), layer, Math.round(height * 0.5), { clip: true });
    assert.ok(maxJump(old) > 3, `the old clipped field showed a seam (${maxJump(old).toFixed(2)} levels)`);
  });
}

test("world background without parallax: the same continuous field, travelling 1× with the plates", async () => {
  const story = await golden((s) => ({ ...s, camera: { ...s.camera, parallax: false } }));
  const plan = planFor(story);
  assert.equal(plan.parallax, null, "no overlay parallax");
  assert.equal(plan.depth, 1);
  const { html } = await compileStoryToHyperFrames(story, { write: false, sourceDir: GOLDEN });
  assert.match(html, /<div id="lc-world-bg" class="lc-world-bg" aria-hidden="true"><div id="lc-amb-field-world" class="lc-world-field"/);
  // The layer moves exactly as far as the plates on screen.
  const pan = plan.moves[0];
  const before = opsStateAt(plan.ops, "background", pan.start - 0.1), after = opsStateAt(plan.ops, "background", pan.start + pan.duration + 0.1);
  assert.ok(Math.abs((after.x - before.x) - (pan.from.x - pan.to.x) * pan.to.zoom) < 1e-3);
  const field = ambientField(story);
  for (const t of [8.0, 12.5]) {
    const layer = opsStateAt(plan.ops, "background", t);
    const values = row(story, remotionCopies(plan, field, t), layer, 960);
    assert.ok(maxJump(values) < 0.6);
    assert.ok(Math.max(...values) - luma(story.brand.colors.bg) > 4, `t=${t}: the field shows (not flat bg)`);
  }
  // Ambient background off: the brand glows stand in, still 1×.
  const glows = await golden((s) => ({ ...s, camera: { ...s.camera, parallax: false }, ambient: { background: false } }));
  const compiled = await compileStoryToHyperFrames(glows, { write: false, sourceDir: GOLDEN });
  assert.match(compiled.html, /<div id="lc-world-bg"[^>]*><div class="lc-world-glow"/);
  assert.doesNotMatch(compiled.html, /lc-world-field"/);
});

test("fieldTiles: copies sit one wrap apart across and one canvas apart down, and cover the camera's extent", async () => {
  const story = await golden();
  const plan = planFor(story);
  const field = ambientField(story);
  const { width, height } = story.format;
  const region = backgroundExtent(plan);
  const tiles = fieldTiles(field, region, { width, height });
  for (const blob of field.blobs) {
    const own = tiles.filter((tile) => tile.blob === blob.id);
    const tileX = Math.abs(blob.x.to - blob.x.from);
    assert.ok(own.some((tile) => tile.dx === 0 && tile.dy === 0), `${blob.id} keeps its home copy`);
    assert.ok(own.every((tile) => Math.abs(tile.dx / tileX - Math.round(tile.dx / tileX)) < 1e-6));
    assert.ok(own.every((tile) => Math.abs(tile.dy / height - Math.round(tile.dy / height)) < 1e-6));
    // A copy beside the home one is fully off the home canvas at all times (the wrap stays unseen).
    const reach = (tileX - width) / 2;
    for (const tile of own.filter((entry) => entry.dx && !entry.dy)) {
      assert.ok(Math.min(blob.x.from, blob.x.to) + tile.dx >= width + reach - 1e-6 || Math.max(blob.x.from, blob.x.to) + tile.dx <= -reach + 1e-6, `${blob.id} copy ${tile.dx} stays off the home frame`);
    }
  }
  // The extent covers every rest framing of the layer.
  for (const key of plan.background.keys) {
    assert.ok(region.x0 <= -key.to.x && region.x1 >= -key.to.x + width && region.y0 <= -key.to.y && region.y1 >= -key.to.y + height);
  }
  // Cuts mode keeps the per-plate field: no depth layer, no tiles.
  const cuts = await golden((s) => ({ ...s, camera: { mode: "cuts" } }));
  const cutsPlan = planFor(cuts);
  assert.equal(cutsPlan?.background ?? null, null);
  assert.deepEqual(backgroundFieldTiles(cutsPlan, ambientField(cuts)), []);
});

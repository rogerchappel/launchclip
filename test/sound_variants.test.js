import assert from "node:assert/strict";
import test from "node:test";
import { SOUND_PALETTES } from "@launchclip/core/sound/options.mjs";
import { familySpec, keyboard } from "@launchclip/core/sound/families.mjs";
import { palette } from "@launchclip/core/sound/palettes.mjs";
import { rng } from "@launchclip/core/sound/dsp.mjs";
import { kitVariants } from "../src/scripts/synth-audio-kit.mjs";

const SEVEN = ["whoosh", "impact", "riser", "tick", "pop", "shimmer", "subdrop"];
const seeds = Array.from({ length: 24 }, (_, i) => `s${i}`);

test("the historic seven vary widely across seeds: every seed gives a different sound", () => {
  for (const id of ["organic", "glassy", "retro-8bit"]) {
    for (const family of SEVEN) {
      const specs = seeds.map((seed) => JSON.stringify(familySpec(family, palette(id), rng(`${seed}|${id}|${family}|1`), rng(`${seed}|${id}|kit`))));
      assert.equal(new Set(specs).size, seeds.length, `${id}/${family}`);
      // Constructions differ, not just numbers: the layer counts or chains vary across seeds.
      const shapes = new Set(seeds.map((seed) => { const spec = familySpec(family, palette(id), rng(`${seed}|${id}|${family}|1`)); return `${spec.layers.length}|${spec.master}`; }));
      assert.ok(shapes.size >= 2, `${id}/${family}: ${shapes.size} construction(s)`);
    }
  }
});

test("risers stay 1.4 s so finish lands them on their moment", () => {
  for (const id of SOUND_PALETTES) for (const seed of seeds.slice(0, 6)) {
    const entries = kitVariants({ palette: id, seed, families: ["riser"] });
    // A palette room adds its tail after the peak; the build itself is 1.4 s.
    for (const entry of entries) assert.ok(Math.abs(entry.spec.duration - (entry.spec.space ? Math.min(entry.spec.space.seconds * 0.6, 1.4) : 0) - 1.4) < 0.002, `${id}/${seed}/${entry.name}`);
  }
});

test("every key of a kit comes from one keyboard; another seed is another keyboard", () => {
  const boards = new Set(seeds.map((seed) => keyboard(rng(`${seed}|organic|kit`)).switchType));
  assert.equal(boards.size, 3, "clicky, tactile and linear boards all occur");
  assert.deepEqual(keyboard(rng("x|organic|kit")), keyboard(rng("x|organic|kit")));
  const keys = kitVariants({ palette: "organic", seed: "x", families: ["keystroke"] });
  assert.equal(keys.length, 6);
  // The board's switch type sets the click level, shared by every key of the kit.
  const clickGains = new Set(keys.map((entry) => entry.spec.layers[0].gain));
  assert.equal(clickGains.size, 1);
});

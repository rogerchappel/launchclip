// The SFX type classifier (src/sfx/classify.js), the family-name test and the
// VFX ↔ sound pairs (kit/core/sound/pairs.mjs), docs/IMMERSIVE_SOUND_RFC.md §3.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { FAMILY_TYPE, TYPE_FAMILIES, classifySfx, classifySfxFile, typingRuns } from "../src/sfx/classify.js";
import { SFX_FAMILY_NAMES, SOUND_PALETTES } from "@launchclip/core/sound/options.mjs";
import { IMPACT_CLASS, PAIRS, pairedSounds, pairsCheck, storyVisuals } from "@launchclip/core/sound/pairs.mjs";
import { VFX_EFFECTS } from "@launchclip/core/vfx/catalog.mjs";
import { cuePairNotes } from "../src/finish.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const RATE = 48000;

// Classifier fixtures: one short synthetic sound per type.
function sound(seconds, fn) {
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff) - 1;
  return Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => fn(i / RATE, noise));
}
const FIXTURES = {
  // A long bright noise sweep.
  whoosh: sound(0.8, (t, n) => n() * Math.sin(Math.PI * t / 0.8)),
  // One 2.4 kHz bell note.
  ding: sound(0.6, (t) => Math.sin(2 * Math.PI * 2400 * t) * Math.exp(-t / 0.2)),
  // A 60 Hz thump.
  impact: sound(0.5, (t) => Math.sin(2 * Math.PI * 60 * t) * Math.exp(-t / 0.12)),
  // A 20 ms burst of high noise (differenced white noise leans bright).
  click: sound(0.1, (t, n) => (t < 0.02 ? n() - n() : 0) * Math.exp(-t / 0.006)),
  // Two clean partials, 600 Hz and 900 Hz, a 100 ms tail (shorter reads as a click): tonal but not bright.
  pop: sound(0.25, (t) => (Math.sin(2 * Math.PI * 600 * t) + Math.sin(2 * Math.PI * 900 * t)) * Math.exp(-t / 0.06)),
  // A dull mid noise burst: white noise through two low-passes near 1 kHz, its lows taken out.
  hit: (() => { let a = 0, a2 = 0, b = 0; return sound(0.2, (t, n) => { a += 0.12 * (n() - a); a2 += 0.12 * (a - a2); b += 0.01 * (a2 - b); return (a2 - b) * Math.exp(-t / 0.05); }); })()
};

test("classifier fixtures: one synthetic sound per type gets its label", () => {
  for (const [type, samples] of Object.entries(FIXTURES)) assert.equal(classifySfx(samples, RATE).type, type, `${type}: ${JSON.stringify(classifySfx(samples, RATE).measures)}`);
  assert.equal(classifySfx(new Float32Array(RATE / 10)), null);
});

test("four click/pop/hit events inside 0.6 s are typing; whooshes and dings never are", () => {
  const events = [0, 0.1, 0.2, 0.3, 1.5, 1.6, 1.7].map((time, i) => ({ time, type: i === 2 ? "pop" : "click" }));
  assert.deepEqual(typingRuns(events).map((event) => event.type), ["typing", "typing", "typing", "typing", "click", "click", "click"]);
  assert.deepEqual(typingRuns([0, 0.1, 0.2, 0.3].map((time) => ({ time, type: "ding" }))).map((event) => event.type), ["ding", "ding", "ding", "ding"]);
});

test("every SFX family sits in at most one type row (null: no single type)", () => {
  assert.deepEqual(Object.keys(FAMILY_TYPE).sort(), [...SFX_FAMILY_NAMES].sort());
  assert.equal(Object.values(TYPE_FAMILIES).flat().length, Object.values(FAMILY_TYPE).filter(Boolean).length);
  assert.deepEqual([...IMPACT_CLASS], [...TYPE_FAMILIES.impact]);
});

// The family-name test. The coarse classifier puts only about a third of our
// own sounds in their row (synthetic keys and clicks read as tonal "ding"),
// so test/fixtures/sfx-classify-baseline.json records each sound's type today
// and this fails when a sound that lands in its row leaves it: a palette or
// builder change that turns an impact into a pop. Refresh the baseline when a
// change moves sounds into their rows.
// analog/whoosh-4 is recorded as pop: its tonality sits on the cut-off and the
// kit's ffmpeg filters push it over on Ubuntu's ffmpeg (whoosh on macOS).
test("family-name test: no family × palette × variant leaves its type row", { skip: !process.env.LAUNCHCLIP_MEDIA_TESTS && "media test: run with npm run test:media (LAUNCHCLIP_MEDIA_TESTS=1)", timeout: 900_000 }, async () => {
  const baseline = JSON.parse(await readFile(path.join(ROOT, "test/fixtures/sfx-classify-baseline.json"), "utf8"));
  assert.deepEqual(Object.keys(baseline).sort(), [...SOUND_PALETTES, "none"].sort());
  const dir = await mkdtemp(path.join(tmpdir(), "launchclip-classify-"));
  try {
    const left = [];
    for (const palette of Object.keys(baseline)) {
      const out = path.join(dir, palette);
      execFileSync(process.execPath, [path.join(ROOT, "src/scripts/synth-audio-kit.mjs"), out, ...(palette === "none" ? [] : ["--palette", palette])], { stdio: "ignore" });
      const files = (await readdir(path.join(out, "sfx"))).filter((name) => name.endsWith(".wav")).sort();
      assert.deepEqual(files.map((name) => name.replace(/\.wav$/, "")).sort(), Object.keys(baseline[palette]).sort(), `${palette}: the kit's sounds changed; refresh the baseline`);
      for (const file of files) {
        const name = file.replace(/\.wav$/, ""), family = name.replace(/-\d+$/, "");
        // The synth sometimes renders a variant silent (seen: analog success); that is not a type change.
        const { type } = (await classifySfxFile(path.join(out, "sfx", file))) ?? {};
        if (!type) continue;
        if (baseline[palette][name] === FAMILY_TYPE[family] && type !== FAMILY_TYPE[family]) left.push(`${palette}/${name}: ${FAMILY_TYPE[family]} → ${type}`);
      }
      await rm(out, { recursive: true, force: true });
    }
    assert.deepEqual(left, [], "these sounds left their type row");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pairs: every VFX effect's own sound is one of its pair", () => {
  for (const [effect, info] of Object.entries(VFX_EFFECTS)) assert.ok(pairedSounds(effect).includes(info.sfx), `${effect} plays ${info.sfx}; pairs: ${pairedSounds(effect)}`);
  for (const row of PAIRS) for (const family of row.sounds) assert.ok(SFX_FAMILY_NAMES.includes(family), family);
  assert.deepEqual(pairedSounds("nothing"), []);
});

test("pairs check: hits need a sound within 40 ms, impacts a change within 80 ms, the rest warn", () => {
  const hits = [{ at: 1, kind: "crit-hit", energy: 3 }, { at: 2, kind: "poof", energy: 1 }, { at: 3, kind: "sunburst", energy: 2 }];
  const ok = pairsCheck({ hits, changes: [0, 5], sounds: [{ at: 1.03, cue: "impact" }, { at: 3, cue: "shimmer" }] });
  assert.deepEqual(ok, { errors: [], warnings: [] });
  const bad = pairsCheck({ hits, changes: [0], sounds: [{ at: 1.05, cue: "impact" }, { at: 3, cue: "pop" }, { at: 4, cue: "thud" }, { at: 4.5, cue: "tick" }] });
  assert.deepEqual(bad.errors, ["crit-hit at 1s (energy 3) has no sound within 40 ms", "thud at 4s has no visual change within 80 ms"]);
  assert.deepEqual(bad.warnings, ["sunburst at 3s plays pop; it pairs with shimmer or ping or sparkle", "tick at 4.5s is unpaired (nothing changes on screen within 80 ms)"]);
});

test("pairs check on a story: VFX peaks are hits, cuts and module events are changes, transition whooshes are skipped", () => {
  const story = { scenes: [{ id: "s1", start: 0, end: 4, energy: 3, vfx: [{ effect: "smoke-bomb", at: 1, align: "start" }], hits: [{ at: 2.5 }] }, { id: "s2", start: 4, end: 8 }] };
  const { hits, changes } = storyVisuals(story, { peaks: { "smoke-bomb": 0.967 } });
  assert.deepEqual(hits, [{ at: 1.967, kind: "smoke-bomb", energy: 3, shot: "s1" }]);
  assert.deepEqual(changes, [0, 1.967, 2.5, 4]);
  const cues = [{ cue: "thud", at: 1.967, source: "hit" }, { cue: "whoosh", at: 3.8, source: "transition" }, { cue: "impact", at: 6, source: "module-event" }];
  assert.deepEqual(cuePairNotes(story, cues, (scene) => (scene.id === "s2" ? { events: [{ time: 6 }] } : null)), []);
  assert.deepEqual(cuePairNotes(story, cues), ["pairs: impact at 6s has no visual change within 80 ms"]);
});

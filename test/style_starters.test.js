// The starter styles' module choices (docs/SUBJECT_EFFECTS_RFC.md §8):
// which presenter effects each starter reaches for or keeps away from.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MODULES as CATALOG_F } from "../kit/core/catalog-f.mjs";
import { knownModules } from "../kit/core/modules.mjs";
import { stylePromptLines, validateStylePack } from "../kit/core/style.mjs";

const pack = (name) => JSON.parse(readFileSync(new URL(`../kit/styles/${name}.json`, import.meta.url), "utf8"));
const STARTERS = ["bold-creator", "editorial-dark", "minimal-tech", "neon-explainer", "warm-documentary"];
// The playful creative set: catalogue F modules tagged playful.
const PLAYFUL = Object.entries(CATALOG_F).filter(([, def]) => def.mood?.includes("playful")).map(([id]) => id).sort();

test("every starter's preferences name known modules, none both preferred and avoided", () => {
  for (const name of STARTERS) {
    const { modules } = pack(name);
    const { errors, warnings } = validateStylePack(pack(name), { modules: knownModules() });
    assert.deepEqual(errors, [], name);
    assert.deepEqual(warnings.filter((w) => w.startsWith("modules.")), [], name);
    assert.deepEqual(modules.prefer.filter((id) => modules.avoid.includes(id)), [], name);
  }
});

test("bold-creator reaches for the playful creative set", () => {
  assert.deepEqual(PLAYFUL, ["doodle-outline", "orbit-cards", "scrapbook"]);
  for (const id of PLAYFUL) assert.ok(pack("bold-creator").modules.prefer.includes(id), id);
});

test("minimal-tech and editorial-dark prefer the product effects and avoid the playful set", () => {
  for (const name of ["minimal-tech", "editorial-dark"]) {
    const { prefer, avoid } = pack(name).modules;
    for (const id of ["masthead", "phone-stage", "backdrop-swap"]) assert.ok(prefer.includes(id), `${name} prefers ${id}`);
    for (const id of PLAYFUL) assert.ok(avoid.includes(id), `${name} avoids ${id}`);
    assert.match(stylePromptLines(pack(name)).join("\n"), /Avoid these modules: .*scrapbook/);
  }
});

test("warm-documentary keeps to the quiet presenter effects", () => {
  const avoid = new Set(pack("warm-documentary").modules.avoid);
  const subjectEffects = knownModules().filter((id) => ["masthead", "dolly-zoom", "feed-frame", "backdrop-swap", "app-stage", "phone-stage", "pull-back", "growth-line", "punch-in", "zoom-through"].includes(id) || id in CATALOG_F);
  const allowed = subjectEffects.filter((id) => !avoid.has(id)).sort();
  assert.deepEqual(allowed, ["growth-line", "punch-in"]);
});

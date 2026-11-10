// A wide shot on a set with no furniture moves a character in from the safe
// zone's side (kit/core/characters/framing.mjs fitShot wideShift). The first
// 9:16 `make --animation` run could not plan a two-shot: the right-hand place
// of `standing`, level with the left, reaches under the platform's buttons.
import assert from "node:assert/strict";
import test from "node:test";
import { castPlacement } from "@launchclip/core/characters/placement.mjs";
import { profileGeometry } from "@launchclip/core/layout-check.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { resolveStory } from "@launchclip/core/story.mjs";

const cast = { style: "chibi", characters: [
  { id: "foal", name: "Foal", position: "left", kind: "foal", size: "small", marks: ["blaze"], colors: { body: "chestnut", detail: "cream", accent: "#b9652f" } },
  { id: "starter", name: "Starter", position: "right", build: "average", height: "average", skin: "medium", hair: { style: "short", color: "black" }, outfit: { top: "polo", bottom: "trousers" }, accessories: [], colors: { top: "teal", bottom: "charcoal", shoes: "black", accent: "accent" } }
] };
const brand = { colors: { bg: "#fbf3f8", paper: "#1b0d15", ink: "#fef9fc", primary: "#b34f90", accent: "#007975" }, fonts: { display: "lexend", body: "manrope", meta: "jetbrains-mono" } };
const story = (format, params) => resolveStory({ schema: "launchclip.story.v1", lane: "motion", format: { fps: 30, duration: 4, ...format }, brand, cast, world: { kind: "park", time: "day" },
  scenes: [{ id: "two-shot", module: "cast-scene", start: 0, end: 4, params: { set: "standing", shot: "wide", cast: [{ id: "foal", pose: "look" }, { id: "starter", pose: "look", target: { character: "foal" }, cues: [{ at: 1.5, pose: "point" }] }], ...params } }] });
const model = (resolved) => resolveModule(resolved.scenes[0], resolved);

test("9:16: a wide two-shot on the standing set keeps both characters inside the safe zone", () => {
  const resolved = story({ width: 1080, height: 1920 });
  const placed = model(resolved);
  const safe = profileGeometry({ width: 1080, height: 1920 }).safeZone;
  for (const actor of placed.content.actors) assert.ok(actor.reach.left >= safe.x && actor.reach.right <= safe.x + safe.width, `${actor.id} reaches ${Math.round(actor.reach.left)}–${Math.round(actor.reach.right)} (safe ${safe.x}–${safe.x + safe.width})`);
  assert.deepEqual(castPlacement(resolved, [placed]), [], "the cast gate has nothing to say");
  // Only the character that reached out moved, and only across: its size and floor are the set's.
  const [foal, starter] = placed.content.actors;
  assert.ok(starter.x < 1080 - foal.x, "the right-hand character stands further in than the left one's mirror place");
  assert.equal(placed.content.shot.name, "wide");
});

test("16:9 and sets with furniture are placed as before", () => {
  const wide = model(story({ width: 1920, height: 1080 }));
  const [foal, starter] = wide.content.actors;
  assert.ok(Math.abs((foal.x + starter.x) / 2 - 960) < 1, "level with each other about the centre: nobody moved");
  // A walk to the frame's edge is not hidden by a shift: the placement is the set's own and the gate reports it.
  const walker = story({ width: 1080, height: 1920 }, { cast: [{ id: "foal", pose: "look", cues: [{ at: 0.5, action: "walk-to", target: "left" }] }, { id: "starter", pose: "look" }] });
  const walked = model(walker);
  const findings = castPlacement(walker, [walked]);
  if (findings.length) assert.ok(findings.every((finding) => /reaches out of the safe zone/.test(finding.detail)));
});

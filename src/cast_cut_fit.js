// One copy of a character at a time (docs/DIRECTION_GUARDRAILS.md §4): tooling,
// not a repair call.
//
// Two character scenes back to back on track 0 that share a character, joined
// by a transition that shows both plates at once (a zoom, a push, a whip-pan,
// a dissolve), put two copies of that character on screen for the length of
// the transition, and the ghosting gate fails the render ("two copies of
// starter on screen at 3.4 s"). A character-led explainer is mostly such
// joins: the same jar in the hook and in the next beat. The join becomes a
// cut, which is how the guardrail says a cast changes; joins between scenes
// that share nobody keep their transition.
//
//   fitCastCuts(storyboard) → {storyboard, changed: ["<id> cuts in (starter is also in <id>)"]}
const CHARACTER_MODULES = ["cast-scene", "character-cameo", "sprite-scene"];
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** The characters a scene draws, by id. */
export function sceneCharacters(scene) {
  if (!isObject(scene) || !CHARACTER_MODULES.includes(scene.module)) return [];
  const params = isObject(scene.params) ? scene.params : {};
  const ids = scene.module === "character-cameo" ? [params.character] : Array.isArray(params.cast) ? params.cast.map((entry) => (isObject(entry) ? entry.id : entry)) : [];
  return ids.filter((id) => typeof id === "string" && id);
}

export function fitCastCuts(storyboard) {
  if (!isObject(storyboard) || !Array.isArray(storyboard.scenes)) return { storyboard, changed: [] };
  const story = JSON.parse(JSON.stringify(storyboard));
  // Plates in the order written: scenes are planned back to back, and anchors are not resolved yet.
  const plates = story.scenes.filter((scene) => isObject(scene) && (scene.track ?? 0) === 0 && scene.insert !== true);
  const changed = [];
  for (let index = 1; index < plates.length; index += 1) {
    const before = plates[index - 1], scene = plates[index];
    if (!isObject(scene.in) || scene.in.type === "cut") continue;
    const shared = sceneCharacters(scene).filter((id) => sceneCharacters(before).includes(id));
    if (!shared.length) continue;
    changed.push(`${scene.id} cuts in instead of ${scene.in.type} (${shared.join(", ")} ${shared.length === 1 ? "is" : "are"} also in ${before.id})`);
    scene.in = { type: "cut" };
  }
  return { storyboard: changed.length ? story : storyboard, changed };
}

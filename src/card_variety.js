// Cards that vary: repeats of a card or set module change their look within
// one video.
//
// A module draws params.variant, else the style's variants[module] (one per
// brand), so every concept-card in a video looked the same. varyCards() is the
// deterministic pass that runs beside varyInserts (src/insert_variety.js):
//
// - the first use of a module keeps the style's variant (no params written);
// - each later use takes the module's other variants in turn, in an order
//   shuffled from the story's seed (ambientSeed), so two stories differ but a
//   re-plan of one does not;
// - a stated params.variant always wins (and still counts as a use).
//
// It reads the module's live variant list (moduleVariants), so variants
// added to a module later join the rotation without a change here.
import { ambientSeed, hashString, seededRandom } from "@launchclip/core/ambient.mjs";
import { moduleVariants } from "@launchclip/core/modules.mjs";

/** The card and set modules whose repeats rotate their variant. */
export const CARD_VARIETY_MODULES = Object.freeze(["concept-card", "icon-row", "compare", "comparison-table", "section-card", "object-card",
  "stat-card", "quote-card", "checklist", "callout", "metric", "timeline"]);

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

// The module's other variants, shuffled from the story's seed and the module.
function rotation(names, first, seed, module) {
  const random = seededRandom((seed ^ hashString(module)) >>> 0);
  const rest = names.filter((name) => name !== first);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return rest;
}

/**
 * Vary repeated cards (see the header). style is the style pack (its
 * variants[module] is the first use's look; the storyboard's own variants
 * win). → {storyboard (a copy when anything changed), changed: ["scene <id>:
 * concept-card variant → banner (repeat 2)"]}.
 */
export function varyCards(storyboard, { style = null } = {}) {
  const scenes = storyboard?.scenes;
  if (!Array.isArray(scenes) || !scenes.length || storyboard.variants === null) return { storyboard, changed: [] };
  const live = moduleVariants();
  const styled = { ...(isObject(style?.variants) ? style.variants : {}), ...(isObject(storyboard.variants) ? storyboard.variants : {}) };
  const seed = ambientSeed(storyboard);
  const uses = new Map();
  const changed = [];
  const out = scenes.map((scene) => {
    const module = scene?.module;
    const names = CARD_VARIETY_MODULES.includes(module) ? live[module] : null;
    if (!names?.length) return scene;
    const count = (uses.get(module) ?? 0) + 1;
    uses.set(module, count);
    if (count === 1 || scene.params?.variant !== undefined) return scene;
    const first = names.includes(styled[module]) ? styled[module] : names[0];
    const others = rotation(names, first, seed, module);
    if (!others.length) return scene;
    const variant = others[(count - 2) % others.length];
    changed.push(`scene ${scene.id}: ${module} variant → ${variant} (repeat ${count})`);
    return { ...scene, params: { ...scene.params, variant } };
  });
  if (!changed.length) return { storyboard, changed };
  return { storyboard: { ...storyboard, scenes: out }, changed };
}

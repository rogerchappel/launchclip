// The scene looks (kit/core/look.mjs), in the order they are listed. Each is
// {describe, words?, defaults: {strength, step}, honest?, presets(look),
// variants?, variantAt?(plan, frame), under? (the grade sits under the
// medium), grade?(plan, variant) → primitives
// ending in "out", stage?(plan) → {planes, under} (a transform per scene
// layer and markup under them), furniture?(plan) → {html, css}, vars?(plan, frame),
// cast?: options for the cast's drawing (toon.mjs drawToon: pins)}.
//
// Imports only the look files, which import only parts.mjs, so the modules
// that draw (catalog-characters.mjs) can read a look's cast options.

import { LOOK as blueprint } from './blueprint.mjs';
import { LOOK as hologram } from './hologram.mjs';
import { LOOK as thermal } from './thermal.mjs';
import { LOOK as neonNight } from './neon-night.mjs';
import { LOOK as paperCutout } from './paper-cutout.mjs';
import { LOOK as watercolour } from './watercolour.mjs';
import { LOOK as animeCel } from './anime-cel.mjs';
import { LOOK as asciiTerminal } from './ascii-terminal.mjs';
import { LOOK as clay2d } from './clay-2d.mjs';
import { LOOK as isometricLayers } from './isometric-layers.mjs';

export const LOOKS = Object.freeze({
  blueprint,
  hologram,
  thermal,
  'neon-night': neonNight,
  'paper-cutout': paperCutout,
  watercolour,
  'anime-cel': animeCel,
  'ascii-terminal': asciiTerminal,
  'clay-2d': clay2d,
  'isometric-layers': isometricLayers
});

/** What a look (story.look: a name or {name}) asks of the cast's drawing, or null: {pins: true} for paper cutout, {face: "cute"} for anime cel. */
export function lookCastOptions(value) {
  const name = typeof value === 'string' ? value : value?.name;
  return (typeof name === 'string' && Object.hasOwn(LOOKS, name) && LOOKS[name].cast) || null;
}

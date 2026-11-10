// The scene looks (kit/core/look.mjs), in the order they are listed. Each is
// {describe, words?, defaults: {strength, step}, honest?, presets(look),
// variants?, variantAt?(plan, frame), grade?(plan, variant) → primitives
// ending in "out", furniture?(plan) → {html, css}, vars?(plan, frame)}.

import { LOOK as blueprint } from './blueprint.mjs';
import { LOOK as hologram } from './hologram.mjs';
import { LOOK as thermal } from './thermal.mjs';

export const LOOKS = Object.freeze({
  blueprint,
  hologram,
  thermal
});

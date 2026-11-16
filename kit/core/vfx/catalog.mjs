// The VFX catalogue: every vendored effect a story may cue, by name, with the
// SFX family it pairs with and its peak (docs/VFX_LAYER_RFC.md §1 and §3f).
import * as hitSpark from './vendor/fx/impacts/hit-spark.js';
import * as critHit from './vendor/fx/impacts/crit-hit.js';
import * as impactFrame from './vendor/fx/impacts/impact-frame.js';
import * as groundSlam from './vendor/fx/impacts/ground-slam.js';
import * as smallExplosion from './vendor/fx/explosions/small-explosion.js';
import * as smokeBomb from './vendor/fx/explosions/smoke-bomb.js';
import * as fireworkBurst from './vendor/fx/explosions/firework-burst.js';
import * as poof from './vendor/fx/spawn/poof.js';
import * as sunburst from './vendor/fx/holy/sunburst.js';
import * as collectBurst from './vendor/fx/pickups/collect-burst.js';

/** Effect name → its vendored module ({meta, create?} or {meta, draw}). */
export const VFX_MODULES = Object.freeze({
  'hit-spark': hitSpark,
  'crit-hit': critHit,
  'impact-frame': impactFrame,
  'ground-slam': groundSlam,
  'small-explosion': smallExplosion,
  'smoke-bomb': smokeBomb,
  'firework-burst': fireworkBurst,
  poof,
  sunburst,
  'collect-burst': collectBurst
});

export const VFX_EFFECT_NAMES = Object.freeze(Object.keys(VFX_MODULES));

/**
 * Per effect: the SFX family a cue with sfx "auto" plays (kit/core/sound),
 * and its peak, seconds from its start to its brightest frame, measured by
 * scripts/vfx-peaks.mjs (test/vfx_layer.test.js keeps them current). A cue
 * aligned on its peak starts that much early, and its sound lands there.
 */
export const VFX_EFFECTS = Object.freeze({
  'hit-spark': Object.freeze({sfx: 'impact', peak: 0}),
  'crit-hit': Object.freeze({sfx: 'impact', peak: 0}),
  'impact-frame': Object.freeze({sfx: 'impact', peak: 0.033}),
  'ground-slam': Object.freeze({sfx: 'thud', peak: 0}),
  'small-explosion': Object.freeze({sfx: 'impact', peak: 0}),
  'smoke-bomb': Object.freeze({sfx: 'thud', peak: 0.967}),
  'firework-burst': Object.freeze({sfx: 'sparkle', peak: 0.433}),
  poof: Object.freeze({sfx: 'pop', peak: 0}),
  sunburst: Object.freeze({sfx: 'sparkle', peak: 0.533}),
  'collect-burst': Object.freeze({sfx: 'pop', peak: 0})
});

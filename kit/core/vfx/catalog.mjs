// The VFX catalogue: every vendored effect a story may cue, by name
// (docs/VFX_LAYER_RFC.md §1 and §3).
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

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
import * as comboCounter from './vendor/fx/ui/combo-counter.js';
import * as critNumber from './vendor/fx/ui/crit-number.js';
import * as levelUp from './vendor/fx/ui/level-up.js';
import * as achievement from './vendor/fx/ui/achievement.js';
import * as confetti from './vendor/fx/ui/confetti.js';
import * as fireworkRocket from './vendor/fx/explosions/firework-rocket.js';
import * as burnAway from './vendor/fx/transitions/burn-away.js';
import * as slashWipe from './vendor/fx/transitions/slash-wipe.js';
import * as shatterWipe from './vendor/fx/transitions/shatter-wipe.js';
import * as crtOff from './vendor/fx/transitions/crt-off.js';
import * as glitchWipe from './vendor/fx/transitions/glitch-wipe.js';
import * as blinds from './vendor/fx/transitions/blinds.js';
import * as diamondWipe from './vendor/fx/transitions/diamond-wipe.js';
import * as starIris from './vendor/fx/transitions/star-iris.js';
import * as pixelDissolve from './vendor/fx/transitions/pixel-dissolve.js';
import * as mElectrified from './vendor/fx/lightning/electrified.js';
import * as mGlitch from './vendor/fx/scifi/glitch.js';
import * as mScanner from './vendor/fx/scifi/scanner.js';
import * as mHalo from './vendor/fx/holy/halo.js';
import * as mHitFlash from './vendor/fx/impacts/hit-flash.js';
import * as mConfused from './vendor/fx/status/confused.js';
import * as mSleep from './vendor/fx/status/sleep.js';
import * as mStunned from './vendor/fx/status/stunned.js';
import * as mCharmed from './vendor/fx/status/charmed.js';
import * as mRage from './vendor/fx/status/rage.js';
import * as mHaste from './vendor/fx/status/haste.js';
import * as mSlowed from './vendor/fx/status/slowed.js';
import * as mFrozen from './vendor/fx/status/frozen.js';
import * as mBurning from './vendor/fx/status/burning.js';

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
  'collect-burst': collectBurst,
  'combo-counter': comboCounter,
  'crit-number': critNumber,
  'level-up': levelUp,
  achievement,
  confetti,
  'firework-rocket': fireworkRocket,
  electrified: mElectrified,
  glitch: mGlitch,
  scanner: mScanner,
  halo: mHalo,
  'hit-flash': mHitFlash,
  confused: mConfused,
  sleep: mSleep,
  stunned: mStunned,
  charmed: mCharmed,
  rage: mRage,
  haste: mHaste,
  slowed: mSlowed,
  frozen: mFrozen,
  burning: mBurning
});

export const VFX_EFFECT_NAMES = Object.freeze(Object.keys(VFX_MODULES));

/**
 * The silhouette effects, (m) in docs/VFX_LAYER_RFC.md §1: each draws round
 * o.actor, a module's card or a cast member (a cue's `mask`, built by
 * kit/core/vfx/mask.mjs). Without one (sheets, peaks, tests) they draw round
 * a stand-in (kit/core/vfx/silhouette.mjs vfxStandIn).
 */
export const VFX_MASKED = Object.freeze(VFX_EFFECT_NAMES.filter(name => VFX_MODULES[name].meta.actor));

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
  'collect-burst': Object.freeze({sfx: 'pop', peak: 0}),
  'combo-counter': Object.freeze({sfx: 'tally', peak: 0.117}),
  'crit-number': Object.freeze({sfx: 'impact', peak: 0.017}),
  'level-up': Object.freeze({sfx: 'success', peak: 0.283}),
  achievement: Object.freeze({sfx: 'chime', peak: 0.333}),
  confetti: Object.freeze({sfx: 'pop', peak: 0.267}),
  'firework-rocket': Object.freeze({sfx: 'sparkle', peak: 1.067}),
  electrified: Object.freeze({sfx: 'glitch', peak: 0.133}),
  glitch: Object.freeze({sfx: 'glitch', peak: 1.7}),
  scanner: Object.freeze({sfx: 'shimmer', peak: 1.217}),
  halo: Object.freeze({sfx: 'chime', peak: 0.2}),
  'hit-flash': Object.freeze({sfx: 'impact', peak: 0}),
  confused: Object.freeze({sfx: 'boing', peak: 0.817}),
  sleep: Object.freeze({sfx: 'pop', peak: 0.25}),
  stunned: Object.freeze({sfx: 'boing', peak: 1.45}),
  charmed: Object.freeze({sfx: 'sparkle', peak: 1.25}),
  rage: Object.freeze({sfx: 'thud', peak: 0.05}),
  haste: Object.freeze({sfx: 'whoosh', peak: 0.483}),
  slowed: Object.freeze({sfx: 'tape-stop', peak: 1.633}),
  frozen: Object.freeze({sfx: 'shimmer', peak: 0}),
  burning: Object.freeze({sfx: 'riser', peak: 0.6})
});

/**
 * The celebration and retention hits that carry words (docs/VFX_LAYER_RFC.md
 * §3d). The effect still lays its bursts, rings and shines out round its
 * pixel word, but the layer draws the word as brand-font text instead
 * (kit/core/vfx/paint.mjs vfxWordAt), unless the story keeps pixel words.
 *
 *   fields: the cue fields a story may set, each with its default, and
 *           options(fields) → the effect's own options
 *   lines:  each word as text: its centre (dx, dy) and cap size in art pixels
 *           from the cue's point, when it comes in (enter over [in0, in1]) and
 *           goes (exit over [out0, out1]), in seconds of the effect's life,
 *           matched to when the effect draws its pixel word
 *
 * Enters: slam (big to size), drop (falls into place), from-left and
 * from-right (slides in); exits: pop (swells and goes), fade, to-right.
 * None of them overshoots.
 */
export const VFX_WORDS = Object.freeze({
  'combo-counter': Object.freeze({
    fields: Object.freeze({text: 'x5', label: 'COMBO'}),
    options: ({text, label}) => ({count: Number(String(text).replace(/[^0-9]/g, '')) || 5, label}),
    lines: Object.freeze([Object.freeze({text: '{text} {label}', dx: 0, dy: -2, size: 18, enter: 'from-left', in: [0, 0.1], shake: [0.1, 0.35], exit: 'to-right', out: [1.1, 1.3]})])
  }),
  'crit-number': Object.freeze({
    fields: Object.freeze({text: '128!', label: 'CRIT'}),
    options: ({text, label}) => ({text, label}),
    lines: Object.freeze([
      Object.freeze({text: '{text}', dx: 0, dy: 5, size: 30, enter: 'slam', in: [0, 0.12], shake: [0, 0.32], exit: 'pop', out: [1.06, 1.12]}),
      Object.freeze({text: '{label}', dx: -8, dy: -22, size: 11, enter: 'slam', in: [0.06, 0.13], exit: 'pop', out: [0.93, 0.98]})
    ])
  }),
  'level-up': Object.freeze({
    fields: Object.freeze({text: 'LEVEL UP!'}),
    options: ({text}) => ({text}),
    lines: Object.freeze([Object.freeze({text: '{text}', dx: 0, dy: -61, size: 16, enter: 'drop', in: [0.5, 1.06], exit: 'pop', out: [2.3, 2.5]})])
  }),
  achievement: Object.freeze({
    fields: Object.freeze({title: 'ACHIEVEMENT', text: 'UNLOCKED'}),
    options: ({title, text}) => ({title, text}),
    lines: Object.freeze([
      Object.freeze({text: '{title}', dx: 17, dy: -6, size: 8, enter: 'from-right', in: [0, 0.2], exit: 'to-right', out: [1.92, 2.16]}),
      Object.freeze({text: '{text}', dx: 17, dy: 6, size: 7, enter: 'from-right', in: [0, 0.2], exit: 'to-right', out: [1.92, 2.16]})
    ])
  })
});

/**
 * The screen transitions (kit/core/transitions.mjs VFX_COVER_TRANSITIONS),
 * by transition type: the module (a 320 × 180 screen covered in o.color, held,
 * uncovered), its paired SFX family, and `cover`, the span of its life when
 * every pixel is covered, measured by scripts/vfx-peaks.mjs. The plan runs
 * the effect at the speed that fits its whole life into the transition and
 * puts the middle of `cover` on the transition's midpoint, where the plates
 * swap. `brand`: its light (rims, glints, tiles) takes a ramp of the brand's
 * accent; the others keep their own fire, glitch and steel. pixel-dissolve is
 * retro only (docs/VFX_LAYER_RFC.md §1).
 */
export const VFX_TRANSITIONS = Object.freeze({
  'burn-away': Object.freeze({module: burnAway, sfx: 'whoosh', cover: [1.175, 1.792]}),
  'slash-wipe': Object.freeze({module: slashWipe, sfx: 'swipe', cover: [0.45, 1.075]}),
  shatter: Object.freeze({module: shatterWipe, sfx: 'snap', cover: [1.017, 1.617], brand: true}),
  'crt-off': Object.freeze({module: crtOff, sfx: 'tape-stop', cover: [0.567, 1.058], brand: true}),
  'glitch-wipe': Object.freeze({module: glitchWipe, sfx: 'glitch', cover: [0.783, 1.108]}),
  blinds: Object.freeze({module: blinds, sfx: 'slide', cover: [0.583, 1.192], brand: true}),
  'diamond-wipe': Object.freeze({module: diamondWipe, sfx: 'swipe', cover: [0.708, 1.233], brand: true}),
  'star-iris': Object.freeze({module: starIris, sfx: 'sparkle', cover: [0.858, 1.308], brand: true}),
  'pixel-dissolve': Object.freeze({module: pixelDissolve, sfx: 'glitch', cover: [0.842, 1.175], brand: true})
});

/** Every module the painter may draw, by plan name: the cue effects and the transitions. */
export const VFX_DRAWABLE = Object.freeze({...VFX_MODULES, ...Object.fromEntries(Object.entries(VFX_TRANSITIONS).map(([type, info]) => [type, info.module]))});

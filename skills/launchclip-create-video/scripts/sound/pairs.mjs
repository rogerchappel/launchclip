// VFX ↔ sound pairs (docs/IMMERSIVE_SOUND_RFC.md §3): which effect families
// a visual hit plays, and a check that hits and sounds land together.
//
// The check: every visual hit with energy ≥ 2 has a sound within 40 ms, and
// every impact-class sound has a visual change within 80 ms. Unpaired sounds
// and a hit whose sound is not one of its pair are warnings.

/** Rows: visuals (VFX effect names, transitions, module moments) → the families that pair with them, first is the default. */
export const PAIRS = Object.freeze([
  Object.freeze({ visuals: Object.freeze(['impact-shake', 'slam', 'stamp', 'sticker', 'hit-spark', 'crit-hit', 'impact-frame', 'small-explosion', 'ground-slam', 'smoke-bomb']), sounds: Object.freeze(['impact', 'thud', 'snap']), note: 'impact or thud when heavy, snap when light' }),
  // sparkle joins shimmer and ping: the VFX catalogue pairs the sunburst and firework with it.
  Object.freeze({ visuals: Object.freeze(['light-pulse', 'bloom', 'ring-flash', 'sunburst', 'firework-burst']), sounds: Object.freeze(['shimmer', 'ping', 'sparkle']), note: 'shimmer or ping' }),
  Object.freeze({ visuals: Object.freeze(['zoom-kick', 'whip', 'swipe-out', 'push', 'zoom']), sounds: Object.freeze(['whoosh', 'swipe']), note: 'a whoosh in the motion\'s direction' }),
  Object.freeze({ visuals: Object.freeze(['glitch']), sounds: Object.freeze(['glitch']), note: 'glitch' }),
  Object.freeze({ visuals: Object.freeze(['count-up', 'chart-build']), sounds: Object.freeze(['tally']), note: 'tally, or the chart\'s sonification' }),
  Object.freeze({ visuals: Object.freeze(['unlock', 'check-mark']), sounds: Object.freeze(['chime', 'success']), note: 'chime or success, each one higher' }),
  Object.freeze({ visuals: Object.freeze(['node-pulse']), sounds: Object.freeze(['ping']), note: 'ping, rising a step per node' }),
  Object.freeze({ visuals: Object.freeze(['poof', 'collect-burst']), sounds: Object.freeze(['pop']), note: 'pop' })
]);

/** The classifier's impact row (src/sfx/classify.js TYPE_FAMILIES.impact; a test keeps them equal). */
export const IMPACT_CLASS = Object.freeze(['impact', 'thud', 'subdrop', 'door', 'footstep']);

export const PAIR_WINDOW = Object.freeze({ hit: 0.04, impact: 0.08 });

/** The families a visual pairs with ([] when the table has no row for it). */
export function pairedSounds(visual) {
  return PAIRS.find((row) => row.visuals.includes(visual))?.sounds ?? [];
}

const energyOf = (value) => (value === 'build' ? 2 : Number(value) || 0);

/**
 * A resolved story's visual moments: hits [{at, kind, energy, shot}] (its
 * VFX cues at their peaks; pass `peaks` effect → seconds from the start) and
 * changes [seconds] (those hits, cuts and module hits), for pairsCheck.
 */
export function storyVisuals(story, { peaks = {} } = {}) {
  const hits = [], changes = [];
  for (const scene of Array.isArray(story?.scenes) ? story.scenes : []) {
    if (Number.isFinite(Number(scene.start))) changes.push(Number(scene.start));
    for (const cue of Array.isArray(scene.vfx) ? scene.vfx : []) {
      if (typeof cue?.at !== 'number') continue;
      const at = cue.align === 'start' ? cue.at + (peaks[cue.effect] ?? 0) : cue.at;
      hits.push({ at, kind: cue.effect, energy: energyOf(scene.energy), shot: scene.id });
      changes.push(at);
    }
    for (const hit of Array.isArray(scene.hits) ? scene.hits : []) if (typeof hit?.at === 'number') changes.push(hit.at);
  }
  return { hits, changes };
}

/**
 * Hits and sounds [{at, cue}] → {errors, warnings}: a hit with energy ≥ 2
 * and no sound within 40 ms, an impact-class sound with no visual change
 * within 80 ms (errors); a hit whose nearest sound is not one of its pair, a
 * sound with nothing on screen near it (warnings).
 */
export function pairsCheck({ hits = [], changes = [], sounds = [] }) {
  const errors = [], warnings = [];
  const near = (at, window) => sounds.filter((sound) => Math.abs(sound.at - at) <= window + 1e-9);
  for (const hit of hits) {
    const close = near(hit.at, PAIR_WINDOW.hit);
    const where = `${hit.shot ? `${hit.shot}: ` : ''}${hit.kind} at ${hit.at}s`;
    if (!close.length) { if (hit.energy >= 2) errors.push(`${where} (energy ${hit.energy}) has no sound within 40 ms`); continue; }
    const wanted = pairedSounds(hit.kind);
    if (wanted.length && !close.some((sound) => wanted.includes(sound.cue))) warnings.push(`${where} plays ${close.map((sound) => sound.cue).join(', ')}; it pairs with ${wanted.join(' or ')}`);
  }
  const moments = [...changes, ...hits.map((hit) => hit.at)];
  for (const sound of sounds) {
    if (moments.some((at) => Math.abs(at - sound.at) <= PAIR_WINDOW.impact + 1e-9)) continue;
    if (IMPACT_CLASS.includes(sound.cue)) errors.push(`${sound.cue} at ${sound.at}s has no visual change within 80 ms`);
    else warnings.push(`${sound.cue} at ${sound.at}s is unpaired (nothing changes on screen within 80 ms)`);
  }
  return { errors, warnings };
}

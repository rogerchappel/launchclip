// Clip-led planning: how much of a narrated video the supplied footage
// carries (full-frame `clip` scenes, kit/core/catalog-d-clip.mjs) and how much
// motion graphics do, from the style's density dial and the cadence profile.
// Contract: docs/KIT_CONTRACTS.md ("Clip-led planning").
//
//   clipLedPlan({lane, density, clips, provider, profile}) → the rule in force
//   clipShare(story)                 → share of the runtime under track-0 clips
//   clipLedLines(plan)               → planner prompt lines
//   clipLedFindings(plan, story)     → {errors, warnings} for a planned story
//
// The rule only turns on when there is footage to cut (clips from --assets or
// an asset provider that answers shot requests) and a density dial was set
// (a style pack's or story's dials.density, or the planner's density option).
// Low density is mostly clips with callouts; high density is the motion-
// graphics plan LaunchClip always made:
//
//   density < 0.35   clip-led   clips carry most of the runtime (an error below the band)
//   0.35 – 0.5       mixed      clips and graphics interleave (a warning off the band)
//   ≥ 0.5            graphics   no clip rule (today's behaviour)
//
// The clip share's band comes from the profile when it measures clip_share
// (p10–p90, the target moving down the band as density rises), else from the
// density itself (target 0.85 − density, ±0.15). The clip length follows the
// profile's shot_seconds (aim near p50, never over p90).
//
// Pure ESM; imports only kit/core siblings. Canonical copy: kit/core/clip-led.mjs.

export const CLIP_LED_LANES = Object.freeze(['motion', 'voiceover-motion']);
export const CLIP_LED_MODES = Object.freeze(['clip-led', 'mixed', 'graphics']);
// Density thresholds: below clipLed the plan is clip-led, below mixed it is mixed.
export const CLIP_LED_DENSITY = Object.freeze({ clipLed: 0.35, mixed: 0.5 });
// Seed shot lengths when the profile has no shot_seconds.
const SEED_SHOT = Object.freeze({ target: 3, max: 8 });

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const pct = (value) => `${Math.round(value * 100)}%`;

/** The clip-share target and band for a density, from the profile's clip_share when it has one. */
export function clipShareBand(density, profile = null) {
  const measured = profile?.measures?.clip_share;
  const points = ['p10', 'p50', 'p90'].map((key) => measured?.[key]).filter(finite);
  if (points.length) {
    const lo = Math.min(...points), hi = Math.max(...points);
    const mid = finite(measured.p50) ? measured.p50 : (lo + hi) / 2;
    // Density down → clips up: at density 0 the top of the band, at 0.5 its p50.
    const t = 1 - clamp01(density);
    const target = t <= 0.5 ? lo + (mid - lo) * (t / 0.5) : mid + (hi - mid) * ((t - 0.5) / 0.5);
    return { target: round(target), band: [round(lo), round(hi)], source: `profile ${profile.id ?? ''}`.trim() };
  }
  const target = clamp01(0.85 - density);
  return { target: round(target), band: [round(Math.max(0, target - 0.15)), round(Math.min(0.95, target + 0.15))], source: 'density' };
}

/**
 * The clip-led rule for one plan.
 * lane: the story lane; density: 0–1 or null (no dial set); densitySource:
 * where it came from (for the report); clips: the footage the plan may cut
 * ([{src, kind, duration?}] or a count); provider: true when an asset
 * provider answers shot requests; profile: the cadence profile.
 * → {mode, density, density_source, clips, provider, target, band, band_source,
 *    shot: {target, max}, reason}
 */
export function clipLedPlan({ lane, density = null, densitySource = null, clips = [], provider = false, profile = null } = {}) {
  const count = Array.isArray(clips) ? clips.length : Math.max(0, Number(clips) || 0);
  const base = { mode: 'graphics', density: finite(density) ? round(clamp01(density)) : null, density_source: densitySource, clips: count, provider: Boolean(provider) };
  if (!CLIP_LED_LANES.includes(lane)) return { ...base, reason: `the ${lane ?? 'unknown'} lane has its own footage rules` };
  if (!finite(density)) return { ...base, reason: 'no density dial is set, so the plan keeps the motion-graphics default' };
  if (!count && !provider) return { ...base, reason: 'no footage was supplied (no assets clips and no asset provider)' };
  const d = clamp01(density);
  if (d >= CLIP_LED_DENSITY.mixed) return { ...base, reason: `density ${round(d, 2)} is ${CLIP_LED_DENSITY.mixed} or more: motion graphics carry the video` };
  const mode = d < CLIP_LED_DENSITY.clipLed ? 'clip-led' : 'mixed';
  const share = clipShareBand(d, profile);
  const shots = profile?.measures?.shot_seconds;
  const shot = finite(shots?.p50) ? { target: shots.p50, max: finite(shots.p90) ? shots.p90 : Math.max(shots.p50 * 2, SEED_SHOT.max) } : { ...SEED_SHOT };
  return { ...base, mode, target: share.target, band: share.band, band_source: share.source, shot,
    reason: `density ${round(d, 2)} (${densitySource ?? 'given'}) with ${count ? `${count} clip${count === 1 ? '' : 's'}` : 'no clips'}${provider ? ' and an asset provider' : ''}: ${mode === 'clip-led' ? 'supplied footage carries the video' : 'clips and motion graphics interleave'}` };
}

/** Share of the runtime under track-0 `clip` scenes, for a story with numeric scene times. */
export function clipShare(story) {
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration);
  if (!(duration > 0)) return 0;
  const spans = (Array.isArray(story?.scenes) ? story.scenes : [])
    .filter((scene) => scene?.module === 'clip' && (scene.track ?? 0) === 0 && finite(Number(scene.start)) && finite(Number(scene.end)))
    .map((scene) => [Math.max(0, Number(scene.start)), Math.min(duration, Number(scene.end))])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0, cursor = 0;
  for (const [a, b] of spans) {
    const from = Math.max(a, cursor);
    if (b > from) total += b - from;
    cursor = Math.max(cursor, b);
  }
  return round(total / duration, 4);
}

/** Planner prompt lines for the rule ([] in graphics mode). */
export function clipLedLines(plan) {
  if (!plan || plan.mode === 'graphics') return [];
  const [lo, hi] = plan.band;
  const lines = [
    `${plan.mode === 'clip-led' ? 'Clip-led' : 'Mixed'} (${plan.reason}). Put full-frame clip scenes of the supplied footage on track 0 for about ${pct(plan.target)} of the runtime (between ${pct(lo)} and ${pct(hi)}); ${plan.mode === 'clip-led' ? 'the check fails a plan below that' : 'motion-graphics scenes take the rest'}.`,
    `Cut clips to the narration: start each clip on a word anchor where its line starts, about ${plan.shot.target} s a clip and never over ${plan.shot.max} s (the cadence profile); a new clip, or a new sourceStart in the same video, on each line. Consecutive clips of different footage are different shots, so the "never the same module three times in a row" rule does not apply to them.`,
    plan.mode === 'clip-led'
      ? 'Dress the footage instead of cutting away from it: the line\'s key words, a figure or a name go in the clip\'s callouts (1–3 short pills, one after another, each on screen for its reading time). Cut to a motion-graphics scene only for what footage cannot show (a number to compare, steps, a chart), keep it short, and come back to footage.'
      : 'Interleave: footage for the lines that show a place, a product or people doing something; motion graphics for numbers, comparisons, steps and lists. Clip callouts carry a short label when a line needs one.',
    'Crop for the frame: set focus to where the subject sits in the source when it is off centre (a 16:9 clip in 9:16 keeps only its middle third). Play a video from a sourceStart that shows the action, keep the scene inside the source (sourceEnd when you know it), and never reuse the same stretch of a video. Stills get a gentle Ken Burns push by default.',
    'Transitions: hard cuts between clips by default (omit in, or cut); the style\'s grammar sets the clip entrance (settle under snappy and playful). Use a fade, push or the grammar\'s camera move at a change of idea, not between every clip.'
  ];
  if (plan.provider) lines.push('Footage from the app\'s library: a clip scene\'s params.media may be a shot request {kind: "shot", shows: "<what the shot must show>", type: "video" | "image" | "any"}, found for the line it sits under.');
  return lines;
}

/**
 * Check a planned story (numeric scene times) against the rule:
 * {share, errors, warnings}. Clip-led: a share below the band is an error;
 * mixed: off the band is a warning; graphics: nothing.
 */
export function clipLedFindings(plan, story) {
  const out = { share: null, errors: [], warnings: [] };
  if (!plan || plan.mode === 'graphics') return out;
  const share = clipShare(story);
  out.share = share;
  const [lo, hi] = plan.band;
  const detail = `clip scenes cover ${pct(share)} of the runtime; the ${plan.mode} plan (density ${plan.density}) aims at ${pct(plan.target)} (${pct(lo)}–${pct(hi)})`;
  if (share + 1e-6 < lo) (plan.mode === 'clip-led' ? out.errors : out.warnings).push(`${detail}: give more lines full-frame clip scenes of the supplied footage, with callouts for the key words, and keep motion graphics for numbers, steps and comparisons`);
  else if (share - 1e-6 > hi) out.warnings.push(`${detail}: turn a line or two that names a number, steps or a comparison into motion graphics`);
  const long = (Array.isArray(story?.scenes) ? story.scenes : []).filter((scene) => scene?.module === 'clip' && (scene.track ?? 0) === 0 && Number(scene.end) - Number(scene.start) > plan.shot.max + 1e-6);
  for (const scene of long) out.warnings.push(`clip ${scene.id} runs ${round(Number(scene.end) - Number(scene.start), 2)} s, over the profile's ${plan.shot.max} s shot; cut it at a word into two clips (another source window or another clip)`);
  return out;
}

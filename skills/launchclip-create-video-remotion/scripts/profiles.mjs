// Cadence profiles (launchclip.cadence-profile.v1): what a strong video of one
// format and platform measures like, as ranges over a reference set
// (docs/VIDEO_QUALITY_RFC.md §5). The planner plans to a profile's bands and
// the gates measure renders against them.
//
//   validateProfile(profile)                → {ok, errors, warnings}
//   selectProfile(profiles, {lane, aspect, duration, platform, cast, demo, id})
//                                           → {profile, reason} (best match)
//   compareToBand(value, band)              → {status, value, band, target}
//   compareMeasures(measured, profile)      → [{measure, status, …}]
//
// Pure ESM that imports nothing, so the CLI, the planner prompt, the gates and
// the skills share it. The shipped profiles are JSON under kit/profiles/
// (src/profile_store.js loads them); a profile measured from a user's own
// references can live in their style.
//
// Canonical copy: kit/core/profiles.mjs.

export const CADENCE_PROFILE_SCHEMA = 'launchclip.cadence-profile.v1';

// The formats a profile describes. "demo-led" and "characters" are motion
// stories led by product-demo scenes or by a cast; the story lanes stay three.
export const PROFILE_FORMATS = Object.freeze(['footage-led', 'motion', 'demo-led', 'characters']);
export const PROFILE_PERCENTILES = Object.freeze(['p10', 'p50', 'p90']);

// Provenance (RFC §5.4). "seed": conservative hand-set ranges, no references
// measured yet. "measured": statistics over `sources`, which list only what a
// reference is and the right we have to analyse it — never frames, audio or text.
export const PROFILE_PROVENANCE_KINDS = Object.freeze(['seed', 'measured']);
export const REFERENCE_RIGHTS = Object.freeze(['own', 'licensed', 'public-statistics']);
const SOURCE_KEYS = new Set(['id', 'title', 'rights', 'url', 'sha256', 'duration_seconds', 'width', 'height', 'measured_at', 'note']);
// Keys that would carry the reference's content rather than its statistics.
const CONTENT_KEYS = new Set(['frames', 'frame', 'thumbnail', 'thumbnails', 'image', 'images', 'audio', 'transcript', 'text', 'words', 'captions_text', 'stills']);

// Every measure a profile may carry. `check` says which side of the band a
// gate holds: "band" both p10 and p90, "max" p90 only, "min" p10 only.
// `stat` says what a render contributes: a single value, or the p50 of a
// per-shot distribution compared with the band.
export const PROFILE_MEASURES = Object.freeze({
  shot_seconds: { unit: 's', check: 'band', stat: 'p50', describe: 'length of a shot between visual changes' },
  visual_changes_per_min: { unit: '/min', check: 'band', describe: 'changes in what is on screen (a scene starts or ends, a cut, a camera move)' },
  coverage: { unit: 'share', check: 'band', describe: 'share of the runtime with a designed graphic on screen' },
  face_time: { unit: 'share', check: 'band', describe: 'share of the runtime with the presenter\'s face visible' },
  longest_undressed_seconds: { unit: 's', check: 'max', describe: 'longest stretch with no graphic on screen' },
  first_visual_seconds: { unit: 's', check: 'max', describe: 'when the first designed graphic appears' },
  text_hold_seconds: { unit: 's', check: 'band', stat: 'p50', describe: 'how long a graphic holds on screen' },
  caption_words_on_screen: { unit: 'words', check: 'max', describe: 'caption words visible at once' },
  layout_changes_per_min: { unit: '/min', check: 'max', describe: 'switches between full, split, framed, stacked and insert layouts' },
  longest_without_reset_seconds: { unit: 's', check: 'max', describe: 'longest stretch with no attention reset (a layout change, an insert or a section card); long form plans a reset every p50' },
  subject_effect_share: { unit: 'share', check: 'max', describe: 'share of the runtime with a presenter (subject) effect' },
  flow_velocity_p90: { unit: 'px/s', check: 'min', describe: '90th-percentile optical-flow velocity of the render' },
  hold_ratio: { unit: 'share', check: 'max', describe: 'share of near-static frames' },
  motion_bursts_per_min: { unit: '/min', check: 'min', describe: 'meaningful motion bursts per minute' },
  change_energy_p50: { unit: 'energy', check: 'min', describe: 'median frame-change energy' },
  first_motion_seconds: { unit: 's', check: 'max', describe: 'when the first meaningful motion arrives' },
  hook_events: { unit: 'events', check: 'min', describe: 'distinct cuts or motion bursts inside the hook window' },
  scene_seconds: { unit: 's', check: 'band', stat: 'p50', describe: 'scene length (character stories)' },
  character_screen_time: { unit: 'share', check: 'band', describe: 'share of the runtime with a character on screen' },
  expression_changes_per_min: { unit: '/min', check: 'band', describe: 'pose or expression changes per minute' },
  problem_lands_seconds: { unit: 's', check: 'max', describe: 'how soon the problem beat lands' }
});

// The measures the motion gate reads (src/cinematic_check.js).
export const MOTION_MEASURES = Object.freeze(['flow_velocity_p90', 'hold_ratio', 'motion_bursts_per_min', 'change_energy_p50', 'first_motion_seconds', 'hook_events']);
// The measures the coverage gate reads from the storyboard and direction map.
export const COVERAGE_MEASURES = Object.freeze(['coverage', 'face_time', 'longest_undressed_seconds', 'first_visual_seconds', 'subject_effect_share', 'longest_without_reset_seconds']);

const TOP = new Set(['schema', 'id', 'title', 'description', 'format', 'match', 'duration_seconds', 'references', 'provenance', 'measures', 'notes']);
const MATCH = new Set(['lanes', 'aspects', 'platforms', 'cast', 'demo']);
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;

/** Validate one profile. Errors make it unusable; warnings are advice. */
export function validateProfile(profile) {
  const errors = [];
  const warnings = [];
  const err = (message) => errors.push(message);
  if (!isObject(profile)) return { ok: false, errors: ['a profile must be a JSON object'], warnings };
  if (profile.schema !== CADENCE_PROFILE_SCHEMA) err(`schema must be "${CADENCE_PROFILE_SCHEMA}"`);
  for (const key of Object.keys(profile)) if (!TOP.has(key)) err(`unknown field "${key}"`);
  if (!nonEmpty(profile.id) || !ID.test(profile.id)) err('id must be a lowercase slug (a-z, 0-9, -)');
  if (!PROFILE_FORMATS.includes(profile.format)) err(`format must be one of ${PROFILE_FORMATS.join(', ')}`);
  const range = profile.duration_seconds;
  if (!Array.isArray(range) || range.length !== 2 || !range.every(finite) || range[0] < 0 || range[1] <= range[0]) err('duration_seconds must be [min, max] seconds with min < max');
  if (!Number.isInteger(profile.references) || profile.references < 0) err('references must be a non-negative integer (the number of reference videos measured)');
  if (profile.match !== undefined) {
    if (!isObject(profile.match)) err('match must be an object');
    else {
      for (const key of Object.keys(profile.match)) if (!MATCH.has(key)) err(`match has unknown field "${key}"`);
      for (const key of ['lanes', 'aspects', 'platforms']) {
        const list = profile.match[key];
        if (list !== undefined && (!Array.isArray(list) || !list.length || !list.every(nonEmpty))) err(`match.${key} must be a non-empty list of strings`);
      }
      for (const key of ['cast', 'demo']) if (profile.match[key] !== undefined && typeof profile.match[key] !== 'boolean') err(`match.${key} must be true or false`);
    }
  }
  validateProvenance(profile, err);
  if (!isObject(profile.measures) || !Object.keys(profile.measures).length) err('measures must be an object with at least one measure');
  else {
    for (const [name, band] of Object.entries(profile.measures)) {
      if (!PROFILE_MEASURES[name]) { err(`measures.${name} is not a known measure (${Object.keys(PROFILE_MEASURES).join(', ')})`); continue; }
      if (!isObject(band)) { err(`measures.${name} must be {p10?, p50?, p90?}`); continue; }
      for (const key of Object.keys(band)) if (!PROFILE_PERCENTILES.includes(key)) err(`measures.${name}.${key} is not a percentile (p10, p50, p90)`);
      const values = PROFILE_PERCENTILES.filter((key) => band[key] !== undefined);
      if (!values.length) err(`measures.${name} needs at least one of p10, p50, p90`);
      for (const key of values) if (!finite(band[key]) || band[key] < 0) err(`measures.${name}.${key} must be a non-negative number`);
      const ordered = values.map((key) => band[key]).filter(finite);
      for (let i = 1; i < ordered.length; i += 1) if (ordered[i] < ordered[i - 1]) err(`measures.${name} percentiles must not decrease (p10 ≤ p50 ≤ p90)`);
      const { check } = PROFILE_MEASURES[name];
      if ((check === 'band' || check === 'min') && band.p10 === undefined) warnings.push(`measures.${name} has no p10, so nothing holds its floor`);
      if ((check === 'band' || check === 'max') && band.p90 === undefined) warnings.push(`measures.${name} has no p90, so nothing holds its ceiling`);
      if (PROFILE_MEASURES[name].unit === 'share') for (const key of values) if (finite(band[key]) && band[key] > 1) err(`measures.${name}.${key} is a share and must be at most 1`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

function validateProvenance(profile, err) {
  const provenance = profile.provenance;
  if (!isObject(provenance)) { err('provenance must be {kind: "seed" | "measured", sources, note?}'); return; }
  for (const key of Object.keys(provenance)) if (!['kind', 'sources', 'note', 'measured_at', 'tool'].includes(key)) err(`provenance has unknown field "${key}"`);
  if (!PROFILE_PROVENANCE_KINDS.includes(provenance.kind)) err(`provenance.kind must be one of ${PROFILE_PROVENANCE_KINDS.join(', ')}`);
  const sources = provenance.sources;
  if (!Array.isArray(sources)) { err('provenance.sources must be a list (empty for a seed profile)'); return; }
  if (provenance.kind === 'seed') {
    if (sources.length) err('a seed profile measured no references, so provenance.sources must be empty');
    if (profile.references !== 0) err('a seed profile has references: 0');
    if (!nonEmpty(provenance.note)) err('a seed profile needs provenance.note saying how its ranges were set');
  }
  if (provenance.kind === 'measured') {
    if (!sources.length) err('a measured profile lists the references it was measured from in provenance.sources');
    if (Number.isInteger(profile.references) && profile.references !== sources.length) err(`references (${profile.references}) must equal the number of provenance.sources (${sources.length})`);
  }
  const ids = new Set();
  sources.forEach((source, index) => {
    const where = `provenance.sources[${index}]`;
    if (!isObject(source)) { err(`${where} must be an object`); return; }
    for (const key of Object.keys(source)) {
      if (CONTENT_KEYS.has(key)) err(`${where}.${key}: profiles store measurements only, never a reference's frames, audio or text`);
      else if (!SOURCE_KEYS.has(key)) err(`${where} has unknown field "${key}"`);
    }
    if (!nonEmpty(source.id)) err(`${where}.id is required`);
    else if (ids.has(source.id)) err(`${where}.id "${source.id}" is listed twice`);
    else ids.add(source.id);
    if (!REFERENCE_RIGHTS.includes(source.rights)) err(`${where}.rights must be one of ${REFERENCE_RIGHTS.join(', ')} (only videos we have the right to analyse)`);
  });
}

/** "9:16" | "16:9" | "1:1" for a {width, height} (nearest named aspect). */
export function aspectOf(format) {
  const width = Number(format?.width), height = Number(format?.height);
  if (!(width > 0 && height > 0)) return null;
  const ratio = width / height;
  if (ratio < 0.85) return '9:16';
  if (ratio > 1.18) return '16:9';
  return '1:1';
}

/**
 * Pick the profile for a story. context: {lane, aspect ("9:16"…) or format
 * {width, height}, duration (seconds), platform, cast (a character story),
 * demo (led by product-demo scenes), id (an explicit choice: a style's or a
 * direction map's profile)}. An explicit id wins when it exists; otherwise
 * the best match by lane, then aspect, then duration, then platform.
 * → {profile, reason} or {profile: null, reason}.
 */
export function selectProfile(profiles, context = {}) {
  const list = (Array.isArray(profiles) ? profiles : []).filter(isObject);
  if (context.id) {
    const named = list.find((profile) => profile.id === context.id);
    if (named) return { profile: named, reason: `named profile ${named.id}` };
  }
  const aspect = context.aspect ?? aspectOf(context.format);
  const duration = Number(context.duration ?? context.format?.duration);
  const platform = context.platform ?? context.format?.platform ?? null;
  const format = context.cast ? 'characters' : context.demo ? 'demo-led' : context.lane === 'footage-led' ? 'footage-led' : 'motion';
  let best = null;
  for (const profile of list) {
    const match = profile.match ?? {};
    if (profile.format !== format) continue;
    if (match.lanes && context.lane && !match.lanes.includes(context.lane)) continue;
    let score = 0;
    // A profile that names the aspect beats one that takes any aspect.
    if (aspect && match.aspects?.includes(aspect)) score += 4;
    else if (!match.aspects) score += 3;
    const [min, max] = Array.isArray(profile.duration_seconds) ? profile.duration_seconds : [0, Infinity];
    if (Number.isFinite(duration)) {
      if (duration >= min && duration <= max) score += 3;
      else score -= Math.min(2, Math.abs(duration < min ? min - duration : duration - max) / Math.max(30, max - min));
    }
    if (platform && match.platforms?.includes(platform)) score += 1;
    if (!best || score > best.score) best = { profile, score };
  }
  if (!best) return { profile: null, reason: `no shipped profile for the ${format} format` };
  const facts = [context.lane ?? format, aspect, Number.isFinite(duration) ? `${Math.round(duration)} s` : null, platform].filter(Boolean).join(', ');
  return { profile: best.profile, reason: `${best.profile.id} fits ${facts}` };
}

/**
 * Compare one value with a band ({p10?, p50?, p90?}) under a check ("band",
 * "max", "min"). → {status: "inside" | "below" | "above" | "unmeasured",
 * value, band: [floor, ceiling], target}
 */
export function compareToBand(value, band = {}, check = 'band') {
  const floor = check === 'max' ? null : band.p10 ?? null;
  const ceiling = check === 'min' ? null : band.p90 ?? null;
  const target = band.p50 ?? null;
  if (!finite(value)) return { status: 'unmeasured', value: null, band: [floor, ceiling], target };
  const tolerance = 1e-6;
  const status = floor != null && value < floor - tolerance ? 'below' : ceiling != null && value > ceiling + tolerance ? 'above' : 'inside';
  return { status, value: round(value, 4), band: [floor, ceiling], target };
}

/**
 * Compare measured values ({coverage: 0.4, shot_seconds: {p50: 2.1}, …}) with
 * a profile. Measures the profile does not carry, or that were not measured,
 * are skipped. → [{measure, status, value, band, target, unit, detail}]
 */
export function compareMeasures(measured = {}, profile, { only = null } = {}) {
  const out = [];
  const measures = profile?.measures ?? {};
  for (const [name, band] of Object.entries(measures)) {
    if (only && !only.includes(name)) continue;
    const spec = PROFILE_MEASURES[name];
    if (!spec) continue;
    const raw = measured[name];
    const value = isObject(raw) ? raw[spec.stat ?? 'p50'] : raw;
    if (value === undefined || value === null) continue;
    const result = compareToBand(Number(value), band, spec.check);
    out.push({ measure: name, ...result, unit: spec.unit, detail: bandDetail(name, result, spec) });
  }
  return out;
}

function bandDetail(name, result, spec) {
  const show = (value) => (value == null ? '—' : spec.unit === 'share' ? `${Math.round(value * 100)}%` : `${round(value, 2)}${spec.unit === 's' ? ' s' : spec.unit === '/min' ? '/min' : ''}`);
  const [floor, ceiling] = result.band;
  const band = floor != null && ceiling != null ? `${show(floor)}–${show(ceiling)}` : floor != null ? `at least ${show(floor)}` : `at most ${show(ceiling)}`;
  if (result.status === 'inside') return `${name} ${show(result.value)} is inside the band (${band})`;
  return `${name} ${show(result.value)} is ${result.status} the profile band (${band}${result.target != null ? `, target ${show(result.target)}` : ''})`;
}

/**
 * The planner's targets: p50 and the p10–p90 band for each measure, as
 * prompt lines (RFC §5.5).
 */
export function profilePromptLines(profile, { only = null } = {}) {
  if (!profile?.measures) return [];
  const lines = [];
  for (const [name, band] of Object.entries(profile.measures)) {
    if (only && !only.includes(name)) continue;
    const spec = PROFILE_MEASURES[name];
    if (!spec || MOTION_MEASURES.includes(name)) continue;
    const show = (value) => (value == null ? null : spec.unit === 'share' ? `${Math.round(value * 100)}%` : `${value}${spec.unit === 's' ? ' s' : spec.unit === '/min' ? '/min' : ''}`);
    const parts = [];
    if (band.p50 != null) parts.push(`target ${show(band.p50)}`);
    if (spec.check === 'band' && band.p10 != null && band.p90 != null) parts.push(`band ${show(band.p10)}–${show(band.p90)}`);
    else if (spec.check !== 'max' && band.p10 != null) parts.push(`at least ${show(band.p10)}`);
    else if (spec.check !== 'min' && band.p90 != null) parts.push(`at most ${show(band.p90)}`);
    lines.push(`${name} (${spec.describe}): ${parts.join(', ')}`);
  }
  return lines;
}

/** Percentiles of a list of numbers (linear interpolation). */
export function percentiles(values, keys = PROFILE_PERCENTILES) {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  const out = {};
  if (!sorted.length) return out;
  for (const key of keys) {
    const p = Number(key.slice(1)) / 100;
    const position = (sorted.length - 1) * p;
    const lo = Math.floor(position), hi = Math.ceil(position);
    out[key] = round(sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo), 4);
  }
  return out;
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// Sound directing (docs/IMMERSIVE_SOUND_RFC.md §2, phase 6): a scene's
// `sound` block, written by the planner and carried out by the mixer.
//
//   scenes[i].sound: {
//     hush:   {at, for}   a near-silence of `for` s (0.2–0.8) ending on `at`, the line or hit it sets up
//     prelap: s           J-cut: this scene's sound arrives s (0.15–1) before its cut
//     tail:   s           L-cut: this scene's sound rings s (0.15–1) past the next cut
//     into:   riser | swell | tape-stop | hit | silence   the cut into this scene, made of sound
//     space:  dry | room | hall                          the scene's acoustic (cue reverb ×0, ×1, ×2)
//     focus:  voice | music | fx                         what leads (moves the bed under the voice)
//   }
//
// directSound turns the blocks into level curves the mixer multiplies in
// (src/scripts/build-mix.mjs), the transition sounds, and the windows the mix
// check measures (measureDirecting). Pure: no files, no ffmpeg.

import { SCENE_SOUND_FIELDS, SOUND_FOCUSES, SOUND_INTO, SOUND_SPACES, sceneSoundProblems } from '../story.mjs';

export { SCENE_SOUND_FIELDS, SOUND_FOCUSES, SOUND_INTO, SOUND_SPACES, sceneSoundProblems };

export const DIRECTING = Object.freeze({
  // Bed, ambience and room in a hush: −24 dB (RFC §2).
  hush: 10 ** (-24 / 20),
  // A hush fades in over 40 ms and lets go on its hit in 10 ms, so the hit lands out of quiet.
  hushIn: 0.04,
  hushOut: 0.01,
  // A plain cut still crossfades the beds over 0.1 s, so a level change never clicks.
  crossfade: 0.1,
  // The bed's gain against the default duck (about −13 dB under the voice):
  // music leads at −6 dB, fx sinks it to −16 dB. shortcut: a gain on the bed, not a
  // per-scene duck depth (sidechaincompress can't change over time); speech and pauses both move.
  focus: Object.freeze({ voice: 1, music: 10 ** (7 / 20), fx: 10 ** (-3 / 20) }),
  space: Object.freeze({ dry: 0, room: 1, hall: 2 }),
  // `into: silence` drops everything but the voice for two frames before the cut.
  silenceFrames: 2,
  // A cue within this much of a scene's start is its arrival sound: a prelap moves it early.
  arrival: 0.25,
  // Story counts (docs/PLAN_AND_PACE_RFC.md §1 sound.silences, sound.breath, sound.prelaps).
  hushEvery: [[20, 1], [45, 2]],
  breath: 0.4,
  earlyAfter: 30,
  // The mix check: a hush sits ≥ 18 dB under the mix median and a transient lands within 0.1 s of its end.
  hushDepthDb: 18,
  hitWindow: 0.1,
  // A prelap leads when the level change is half way across (in dB) a quarter of its lead before the cut;
  // it is only measured when the two scenes differ by this much.
  contrastDb: 3
});

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const inRange = (value, [lo, hi]) => typeof value === 'number' && Number.isFinite(value) && value >= lo - 1e-9 && value <= hi + 1e-9;
const round3 = (value) => Math.round(value * 1000) / 1000;

/** The track-0 scenes with numbers for start and end, in order. */
function cutScenes(story) {
  return (Array.isArray(story?.scenes) ? story.scenes : [])
    .filter((scene) => isObject(scene) && (scene.track ?? 0) === 0 && Number.isFinite(Number(scene.start)) && Number.isFinite(Number(scene.end)))
    .sort((a, b) => Number(a.start) - Number(b.start));
}

/**
 * Story-wide warnings for a resolved story that directs its sound (any scene
 * has a sound block): planned silences per length, one held breath, early
 * sound in a longer piece, and a hush with words in it. words: [{start, end}].
 */
export function storySoundWarnings(story, { words = [] } = {}) {
  const scenes = cutScenes(story);
  if (!scenes.some((scene) => scene.sound !== undefined)) return [];
  const warnings = [];
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration ?? scenes.at(-1)?.end ?? 0);
  const hushes = scenes.filter((scene) => isObject(scene.sound?.hush) && typeof scene.sound.hush.at === 'number');
  const wanted = DIRECTING.hushEvery.reduce((n, [seconds, count]) => (duration >= seconds ? count : n), 0);
  if (hushes.length < wanted) warnings.push(`sound: ${hushes.length} planned silence${hushes.length === 1 ? '' : 's'} (hush) in ${round3(duration)} s; plan ${wanted}: a near-silence before the turn`);
  if (duration >= DIRECTING.hushEvery[0][0] && !hushes.some((scene) => scene.sound.hush.for >= DIRECTING.breath)) warnings.push(`sound: no held breath; give one hush ${DIRECTING.breath} s or longer`);
  if (duration >= DIRECTING.earlyAfter && !scenes.some((scene) => scene.sound?.prelap !== undefined || scene.sound?.tail !== undefined)) warnings.push('sound: no early sound; let a scene arrive early (prelap) or ring over the cut (tail)');
  for (const scene of hushes) {
    const { at, for: span } = scene.sound.hush;
    const spoken = (Array.isArray(words) ? words : []).find((word) => Number(word?.start) < at - 0.02 && Number(word?.end) > at - span + 0.02);
    if (spoken) warnings.push(`${scene.id}: sound.hush ${round3(at - span)}–${at} s has the word "${spoken.text ?? ''}" in it; a hush needs a pause in the voice`);
  }
  return warnings;
}

/** A curve as [[t, level]] from a level function and its breakpoints; empty when it is 1 throughout. */
function curve(level, times, duration) {
  const points = [...new Set([0, duration, ...times.map(round3)])].filter((t) => t >= 0 && t <= duration).sort((a, b) => a - b).map((t) => [t, round3(level(t))]);
  return points.every(([, value]) => value === 1) ? [] : points;
}

/**
 * A resolved story's sound directing: {levels, wet, gate} as [[seconds,
 * level]] curves (empty: no change) for the beds (bed, ambience, score room),
 * the cue reverb and the cues; into [{type, cut, shot}]; hushes [{from, to,
 * shot}]; cuts [{cut, from, to, lead, kind: "prelap"|"tail"|null, before,
 * after, shot}] (bed levels either side). Null when no scene has a sound block.
 */
export function directSound(story, { fps = 30 } = {}) {
  const scenes = cutScenes(story);
  if (!scenes.some((scene) => scene.sound !== undefined)) return null;
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration ?? scenes.at(-1).end);
  const focus = (scene) => DIRECTING.focus[scene.sound?.focus] ?? 1;
  const space = (scene) => DIRECTING.space[scene.sound?.space] ?? 1;
  // Each cut crossfades the scene levels over [from, to]: before the cut with a prelap, after it with a tail.
  const cuts = scenes.slice(1).map((next, i) => {
    const scene = scenes[i];
    const cut = Number(next.start);
    const lead = next.sound?.prelap ?? null;
    const tail = scene.sound?.tail ?? null;
    const [from, to] = lead ? [cut - lead, cut] : tail ? [cut, cut + tail] : [cut - DIRECTING.crossfade / 2, cut + DIRECTING.crossfade / 2];
    return { cut, from: round3(from), to: round3(to), lead: lead ?? (tail ? -tail : 0), kind: lead ? 'prelap' : tail ? 'tail' : null, before: focus(scene), after: focus(next), shot: next.id, scene, next };
  });
  const stepped = (value) => (t) => {
    let level = value(scenes[0]);
    for (const cut of cuts) {
      if (t <= cut.from) break;
      const a = value(cut.scene), b = value(cut.next);
      level = t >= cut.to ? b : a + (b - a) * (t - cut.from) / (cut.to - cut.from);
    }
    return level;
  };
  const hushes = scenes.filter((scene) => isObject(scene.sound?.hush) && typeof scene.sound.hush.at === 'number' && typeof scene.sound.hush.for === 'number')
    .map((scene) => ({ from: round3(Math.max(0, scene.sound.hush.at - scene.sound.hush.for)), to: round3(scene.sound.hush.at), shot: scene.id }));
  const into = scenes.slice(1).filter((scene) => SOUND_INTO.includes(scene.sound?.into)).map((scene) => ({ type: scene.sound.into, cut: Number(scene.start), shot: scene.id }));
  const frame = 1 / (Number(fps) || 30);
  const drops = into.filter((entry) => entry.type === 'silence').map((entry) => ({ from: round3(entry.cut - DIRECTING.silenceFrames * frame), to: entry.cut }));
  const hushed = (t) => hushes.reduce((level, { from, to }) => {
    if (t <= from || t >= to) return level;
    if (t < from + DIRECTING.hushIn) return level * (1 + (DIRECTING.hush - 1) * (t - from) / DIRECTING.hushIn);
    if (t > to - DIRECTING.hushOut) return level * (DIRECTING.hush + (1 - DIRECTING.hush) * (t - (to - DIRECTING.hushOut)) / DIRECTING.hushOut);
    return level * DIRECTING.hush;
  }, 1);
  // A silence is a hard edge: 2 ms down, and back up on the cut itself.
  const dropped = (t) => (drops.some(({ from, to }) => t >= from && t < to) ? 0 : 1);
  const dropTimes = drops.flatMap(({ from, to }) => [from - 0.002, from, to - 0.001, to]);
  const bedLevel = stepped(focus);
  const cutTimes = cuts.flatMap((cut) => [cut.from, cut.to]);
  const hushTimes = hushes.flatMap(({ from, to }) => [from, from + DIRECTING.hushIn, to - DIRECTING.hushOut, to]);
  return {
    levels: curve((t) => bedLevel(t) * hushed(t) * dropped(t), [...cutTimes, ...hushTimes, ...dropTimes], duration),
    wet: curve(stepped(space), cutTimes, duration),
    gate: curve(dropped, dropTimes, duration),
    into,
    hushes,
    cuts: cuts.map(({ scene, next, ...cut }) => cut)
  };
}

/**
 * Cues after directing: nothing starts inside a hush but what lands on its end
 * (align "peak", a riser's lands_at, the typing track); a prelapped scene's
 * arrival sounds move early by its prelap. Returns new cue objects.
 */
export function directCues(cues, direct) {
  if (!direct) return cues;
  const leads = new Map(direct.cuts.filter((cut) => cut.kind === 'prelap').map((cut) => [cut.shot, cut]));
  // Prelaps first, so a sound moved early into a hush is then kept out of it like any other.
  const moved = cues.map((cue) => {
    const at = Number(cue.at);
    const lead = leads.get(cue.shot);
    if (!lead || cue.source === 'typing' || cue.source === 'directing' || at < lead.cut - 0.5 || at >= lead.cut + DIRECTING.arrival) return cue;
    return { ...cue, at: round3(Math.max(0, at - lead.lead)), ...(Number.isFinite(cue.lands_at) ? { lands_at: round3(cue.lands_at - lead.lead) } : {}), prelap: lead.lead };
  });
  return moved.filter((cue) => {
    const at = Number(cue.at);
    const lands = Number.isFinite(cue.lands_at) ? cue.lands_at : null;
    if (cue.source === 'typing' || cue.align === 'peak' || cue.source === 'directing') return true;
    return !direct.hushes.some((hush) => at >= hush.from && at < hush.to - 1e-9 && !(lands !== null && Math.abs(lands - hush.to) < 0.05));
  });
}

/** Short-term RMS in dB: one value per `hop` s over `win` s windows. */
export function rmsCurve(samples, rate, { win = 0.05, hop = 0.01 } = {}) {
  const size = Math.max(1, Math.round(win * rate)), step = Math.max(1, Math.round(hop * rate));
  const out = [];
  for (let start = 0; start + size <= samples.length; start += step) {
    let sum = 0;
    for (let k = start; k < start + size; k += 1) sum += samples[k] * samples[k];
    out.push(10 * Math.log10(sum / size + 1e-12));
  }
  return { db: out, hop: step / rate, win: size / rate };
}

const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : -120; };

/**
 * The mix check: each hush measured where it was planned (its RMS under the
 * mix median, a transient within 0.1 s of its end) and each prelap or tail
 * (where the change crosses half way, against the cut). samples: mono floats.
 * Returns {hushes: [{from, to, depth_db, hit_at, ok}], cuts: [{cut, kind,
 * planned, measured, ok}], errors: [string]}.
 */
export function measureDirecting(samples, rate, direct) {
  const result = { hushes: [], cuts: [], errors: [] };
  if (!direct) return result;
  const { db, hop, win } = rmsCurve(samples, rate);
  const index = (t) => Math.min(db.length - 1, Math.max(0, Math.round((t - win / 2) / hop)));
  const span = (from, to) => db.slice(index(from), index(to) + 1);
  const mixMedian = median(db.filter((value) => value > -90));
  for (const hush of direct.hushes) {
    // The hush's inside: past its fade in, before the hit's own attack.
    const inside = span(hush.from + DIRECTING.hushIn + win / 2, hush.to - win / 2 - 0.03);
    const level = inside.length ? Math.max(...inside) : -120;
    const depth = round3(mixMedian - level);
    // The hit: the largest rise in level from inside the hush to 0.1 s after its end.
    let best = 0, hitAt = null;
    for (let k = index(hush.to - DIRECTING.hitWindow); k <= index(hush.to + DIRECTING.hitWindow) && k < db.length; k += 1) {
      const rise = db[k] - (db[k - Math.round(0.03 / hop)] ?? db[k]);
      if (rise > best) { best = rise; hitAt = round3(k * hop + win / 2); }
    }
    const hit = best >= 10;
    const ok = depth >= DIRECTING.hushDepthDb && hit;
    result.hushes.push({ from: hush.from, to: hush.to, depth_db: depth, hit_at: hit ? hitAt : null, ok });
    if (!ok) result.errors.push(`hush ${hush.from}–${hush.to} s (${hush.shot}): ${depth < DIRECTING.hushDepthDb ? `${depth} dB under the mix median, wants ${DIRECTING.hushDepthDb}` : 'no hit lands within 0.1 s of its end'}`);
  }
  for (const cut of direct.cuts) {
    if (!cut.kind) continue;
    const contrast = 20 * Math.log10(cut.after / cut.before);
    if (Math.abs(contrast) < DIRECTING.contrastDb) { result.cuts.push({ cut: cut.cut, kind: cut.kind, planned: cut.lead, measured: null, ok: null }); continue; }
    const measured = changeLead(db, hop, win, cut);
    // The ramp is linear in gain, so it is half way in dB well before half its time (40% for +7 dB): ask for a quarter.
    const ok = measured !== null && (cut.kind === 'prelap' ? measured >= cut.lead / 4 : measured <= cut.lead / 4);
    result.cuts.push({ cut: cut.cut, kind: cut.kind, planned: cut.lead, measured, ok });
    if (!ok) result.errors.push(`${cut.kind} at ${cut.cut} s (${cut.shot}): planned ${Math.abs(cut.lead)} s ${cut.kind === 'prelap' ? 'early' : 'late'}, measured ${measured === null ? 'no change' : `${round3(Math.abs(measured))} s ${measured >= 0 ? 'early' : 'late'}`}`);
  }
  return result;
}

/** Seconds before the cut (negative: after) where the level crosses half way from the scene's level to the next's. */
export function changeLead(db, hop, win, { cut, from, to }) {
  const at = (t) => Math.round((t - win / 2) / hop);
  const before = median(db.slice(Math.max(0, at(from - 0.6)), Math.max(1, at(from - 0.1))));
  const after = median(db.slice(at(to + 0.1), at(to + 0.6)));
  if (Math.abs(after - before) < DIRECTING.contrastDb / 2) return null;
  const half = (before + after) / 2;
  const rising = after > before;
  for (let k = Math.max(0, at(from - 0.3)); k < Math.min(db.length, at(to + 0.3)); k += 1) {
    if (rising ? db[k] >= half : db[k] <= half) return round3(cut - (k * hop + win / 2));
  }
  return null;
}

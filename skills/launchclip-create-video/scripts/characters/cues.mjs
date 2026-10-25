// Story casts, cast cues and the consistency rules for character stories
// (docs/VIDEO_QUALITY_RFC.md §6.3, §10.5).
//
// Story cast (story.cast):
//   {style?: "flat", colors?: {primary?, accent?, paper?, ink?, bg?},
//    characters: [{id, from?, name?, voice?, build?, height?, age?, skin?, hair?,
//                  outfit?, accessories?, headwear?, mobility?, colors?}]}
// An entry whose id (or `from`) names a starter character starts from its
// params; the fields given override them. Any other id needs full params
// (skin and hair at least). `colors` maps brand roles for the whole cast, so
// clothes that say "primary" wear this mapping instead of the brand's.
// A character's params are fixed for the story: scenes name characters by
// id only, so every shot draws the same person.
//
// Cues on a narrative direction-map line:
//   {words: [12, 24], …, cast: [{id, pose?, expression?, at?}], set?}
// `at` is "word:<text>[#n]" (searched inside the line's words first), "start",
// "end", or a narration word index. validateCastCues checks names;
// resolveCastCues turns them into seconds.
//
// Imports only sibling kit/core files.

import {EXPRESSIONS, HAIR_STYLES, POSES, normalizeRigParams, rigFingerprint} from './rig.mjs';
import {STARTER_IDS, characterLook, starterCharacter} from './cast.mjs';
import {BRAND_ROLES, isColorName} from './palette.mjs';
import {SEATED_SETS, SETS} from './sets.mjs';
import {DRAWING_STYLES} from './styles.mjs';

export {DRAWING_STYLES};
export const KOKORO_VOICES = Object.freeze([
  'af_alloy', 'af_aoede', 'af_bella', 'af_heart', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky',
  'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa',
  'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily', 'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis'
]);
const ID = /^[a-z][a-z0-9-]{0,23}$/;
const ENTRY_KEYS = ['id', 'from', 'name', 'voice', 'build', 'height', 'age', 'skin', 'hair', 'outfit', 'accessories', 'headwear', 'mobility', 'colors', 'position'];
const isObj = value => value && typeof value === 'object' && !Array.isArray(value);

function castEntries(cast) {
  if (cast == null) return [];
  if (Array.isArray(cast)) return cast;
  return Array.isArray(cast.characters) ? cast.characters : [];
}

/**
 * Problems with a story cast, as strings (empty when it is valid). Checks
 * the shape, unique ids, known starters, rig params and voices.
 */
export function storyCastErrors(cast) {
  const errors = [];
  if (cast == null) return errors;
  if (!isObj(cast) && !Array.isArray(cast)) return ['cast must be {style?, colors?, characters: [...]}'];
  if (isObj(cast)) {
    for (const key of Object.keys(cast)) if (!['style', 'colors', 'characters'].includes(key)) errors.push(`cast.${key} is not supported (allowed: style, colors, characters)`);
    if (cast.style !== undefined && !DRAWING_STYLES.includes(cast.style)) errors.push(`cast.style must be one of ${DRAWING_STYLES.join(', ')}`);
    if (cast.colors !== undefined) {
      if (!isObj(cast.colors)) errors.push('cast.colors must map brand roles to colours');
      else for (const [role, value] of Object.entries(cast.colors)) {
        if (!BRAND_ROLES.includes(role)) errors.push(`cast.colors.${role} is not a brand role (${BRAND_ROLES.join(', ')})`);
        else if (!isColorName(value) || BRAND_ROLES.includes(value)) errors.push(`cast.colors.${role} must be a palette colour or six-digit hex`);
      }
    }
    if (!Array.isArray(cast.characters)) errors.push('cast.characters must be an array');
  }
  const seen = new Set();
  castEntries(cast).forEach((entry, i) => {
    const path = `cast.characters[${i}]`;
    if (!isObj(entry)) { errors.push(`${path} must be an object`); return; }
    for (const key of Object.keys(entry)) if (!ENTRY_KEYS.includes(key)) errors.push(`${path}.${key} is not supported (allowed: ${ENTRY_KEYS.join(', ')})`);
    if (typeof entry.id !== 'string' || !ID.test(entry.id)) { errors.push(`${path}.id must be a lowercase id (letters, digits, hyphens; ≤ 24)`); return; }
    if (seen.has(entry.id)) errors.push(`${path}.id "${entry.id}" is listed twice; each character appears once in a cast`);
    seen.add(entry.id);
    if (entry.voice !== undefined && (typeof entry.voice !== 'string' || !entry.voice.trim())) errors.push(`${path}.voice must be a voice id (Kokoro: ${KOKORO_VOICES.slice(0, 4).join(', ')}, …)`);
    if (entry.position !== undefined && !['left', 'centre', 'center', 'right'].includes(entry.position)) errors.push(`${path}.position must be left, centre or right (the side this character takes in every cast scene it shares)`);
    if (entry.name !== undefined && (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 40)) errors.push(`${path}.name must be a string of 1–40 characters`);
    try { castParams(entry, path); } catch (error) { errors.push(error.message); }
  });
  return errors;
}

function castParams(entry, path) {
  const baseId = entry.from ?? (STARTER_IDS.includes(entry.id) ? entry.id : null);
  if (entry.from !== undefined && !STARTER_IDS.includes(entry.from)) throw new Error(`${path}.from "${entry.from}" is not a starter character (${STARTER_IDS.join(', ')})`);
  const base = baseId ? starterCharacter(baseId).params : null;
  if (!base && (entry.skin === undefined || entry.hair === undefined)) throw new Error(`${path} (${entry.id}) is not a starter character, so it needs its own skin and hair (or from: a starter id)`);
  const merged = {
    build: entry.build ?? base?.build,
    height: entry.height ?? base?.height,
    skin: entry.skin ?? base?.skin,
    hair: {...(base?.hair ?? {}), ...(entry.hair ?? {})},
    outfit: {...(base?.outfit ?? {}), ...(entry.outfit ?? {})},
    accessories: entry.accessories ?? base?.accessories ?? [],
    ...((entry.age ?? base?.age) ? {age: entry.age ?? base.age} : {}),
    ...((entry.headwear ?? base?.headwear) ? {headwear: entry.headwear ?? base.headwear} : {}),
    ...((entry.mobility ?? base?.mobility) ? {mobility: entry.mobility ?? base.mobility} : {}),
    colors: {...(base ? {top: base.colors.top, bottom: base.colors.bottom, shoes: base.colors.shoes, accent: base.colors.accent} : {}), ...(entry.colors ?? {})}
  };
  // A new hair style keeps the starter's colour unless one is given.
  if (entry.hair && entry.hair.style && !HAIR_STYLES.includes(entry.hair.style)) throw new Error(`${path}.hair.style must be one of ${HAIR_STYLES.join(', ')}`);
  return normalizeRigParams(merged, path);
}

/**
 * The resolved cast of a story: Map id → {id, name, voice, params, style,
 * colors, fingerprint, look, starter: bool}. Starter characters not in the
 * cast resolve too (cameos in stories without a cast), with starter: true.
 * Throws on an invalid cast.
 */
export function resolveStoryCast(story) {
  const cast = story?.cast ?? null;
  const errors = storyCastErrors(cast);
  if (errors.length) throw new Error(errors.join('; '));
  const style = isObj(cast) && cast.style ? cast.style : 'flat';
  const mapping = isObj(cast) && isObj(cast.colors) ? cast.colors : null;
  const out = new Map();
  castEntries(cast).forEach((entry, i) => {
    const params = castParams(entry, `cast.characters[${i}]`);
    const starter = starterCharacter(entry.from ?? entry.id);
    out.set(entry.id, {id: entry.id, name: entry.name ?? starter?.name ?? entry.id, voice: entry.voice ?? null, position: entry.position ?? null, starter: false, ...characterLook(params, {style, brand: story?.brand, mapping})});
  });
  return {members: out, style, mapping, listed: out.size > 0, brand: story?.brand ?? null};
}

/**
 * One character for a scene: from the story cast when it lists characters
 * (then only those ids are allowed), else a starter by id.
 */
export function castMember(resolved, id, path = 'id') {
  if (typeof id !== 'string' || !id) throw new Error(`${path} must name a character`);
  if (resolved.members.has(id)) return resolved.members.get(id);
  if (resolved.listed) throw new Error(`${path} "${id}" is not in the story cast (${[...resolved.members.keys()].join(', ')}); add it to cast.characters`);
  const starter = starterCharacter(id);
  if (!starter) throw new Error(`${path} "${id}" is not a starter character (${STARTER_IDS.join(', ')}); define it in story.cast`);
  return {id, name: starter.name, voice: starter.voice, starter: true, ...characterLook(starter.params, {style: resolved.style, brand: resolved.brand ?? null, mapping: resolved.mapping})};
}

// ---------------------------------------------------------------------------
// Direction-map cues

/**
 * Problems with one narrative direction-map line's cast cues and set, as
 * strings. cast: the story cast (story.cast) or a resolved cast. Checks
 * every named character, pose, expression and set exists, and that cue
 * anchors are well formed.
 */
export function validateCastCues(line, cast, {path = 'line'} = {}) {
  const errors = [];
  if (!isObj(line)) return [`${path} must be an object`];
  const ids = castIds(cast);
  if (line.set !== undefined && !SETS.includes(line.set)) errors.push(`${path}.set "${line.set}" is not a set (${SETS.join(', ')})`);
  if (line.cast === undefined) return errors;
  if (!Array.isArray(line.cast) || !line.cast.length) return [...errors, `${path}.cast must be a non-empty array of {id, pose?, expression?, at?}`];
  line.cast.forEach((cue, i) => {
    const where = `${path}.cast[${i}]`;
    if (!isObj(cue)) { errors.push(`${where} must be an object`); return; }
    for (const key of Object.keys(cue)) if (!['id', 'pose', 'expression', 'at'].includes(key)) errors.push(`${where}.${key} is not supported (allowed: id, pose, expression, at)`);
    if (typeof cue.id !== 'string') errors.push(`${where}.id must name a character`);
    else if (!ids.has(cue.id)) errors.push(`${where}.id "${cue.id}" is not in the story cast (${[...ids].join(', ') || 'none'})`);
    if (cue.pose !== undefined && !POSES.includes(cue.pose)) errors.push(`${where}.pose "${cue.pose}" is not a pose (${POSES.join(', ')})`);
    if (cue.expression !== undefined && !EXPRESSIONS.includes(cue.expression)) errors.push(`${where}.expression "${cue.expression}" is not an expression (${EXPRESSIONS.join(', ')})`);
    if (cue.pose === undefined && cue.expression === undefined) errors.push(`${where} needs a pose or an expression`);
    if (cue.at !== undefined && !validAt(cue.at)) errors.push(`${where}.at must be "word:<text>[#n]", "start", "end" or a word index; got ${JSON.stringify(cue.at)}`);
    if (cue.pose === 'walk' && SEATED_SETS.includes(line.set)) errors.push(`${where}.pose walk does not fit the seated set ${line.set}`);
    if (cue.pose === 'sit' && line.set !== undefined && !SEATED_SETS.includes(line.set)) errors.push(`${where}.pose sit needs a seated set (${SEATED_SETS.join(', ')})`);
  });
  return errors;
}

function castIds(cast) {
  if (cast instanceof Map) return new Set(cast.keys());
  if (cast && cast.members instanceof Map) return new Set(cast.members.keys());
  const entries = castEntries(cast);
  return new Set(entries.map(entry => entry?.id).filter(Boolean));
}

const WORD_AT = /^word:([^#\s]+?)(?:#(\d+))?$/;
const validAt = at => at === 'start' || at === 'end' || (Number.isInteger(at) && at >= 0) || (typeof at === 'string' && WORD_AT.test(at));
const norm = text => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, '');

/** Word index for a cue's `at` on a line ([first, last] word indexes). */
export function cueWordIndex(at, line, words) {
  const [first, last] = Array.isArray(line?.words) ? line.words : [0, words.length - 1];
  if (at === undefined || at === 'start') return first;
  if (at === 'end') return last;
  if (Number.isInteger(at)) return at;
  const match = WORD_AT.exec(String(at));
  if (!match) throw new Error(`cue at ${JSON.stringify(at)} is not an anchor`);
  const target = norm(match[1]);
  const occurrence = Number(match[2] ?? 1);
  const find = (from, to) => {
    let seen = 0;
    for (let i = from; i <= to && i < words.length; i++) if (norm(words[i]?.text) === target && ++seen === occurrence) return i;
    return -1;
  };
  const inside = find(first, last);
  const index = inside >= 0 ? inside : find(0, words.length - 1);
  if (index < 0) throw new Error(`cue at ${at}: no narration word "${match[1]}"${occurrence > 1 ? ` (occurrence ${occurrence})` : ''}`);
  return index;
}

/**
 * A line's cues in seconds: [{id, pose, expression, time, word}] sorted by
 * time. words: narration words [{text, start, end}].
 */
export function resolveCastCues(line, {words = []} = {}) {
  if (!Array.isArray(line?.cast)) return [];
  return line.cast.map(cue => {
    const word = cueWordIndex(cue.at, line, words);
    const entry = words[word];
    if (!entry) throw new Error(`cue for ${cue.id}: word ${word} is outside the narration (${words.length} words)`);
    return {id: cue.id, ...(cue.pose ? {pose: cue.pose} : {}), ...(cue.expression ? {expression: cue.expression} : {}), time: Number(entry.start), word};
  }).sort((a, b) => a.time - b.time);
}

/**
 * Scene params cues for one scene from a direction map: every line naming
 * the scene contributes its cast cues, as scene-relative seconds.
 * → {set: string | null, cues: {[id]: [{at, pose?, expression?}]}}
 */
export function sceneCastCues(map, sceneId, {words = [], start = 0} = {}) {
  const cues = {};
  let set = null;
  for (const section of Array.isArray(map?.sections) ? map.sections : []) {
    for (const line of Array.isArray(section?.lines) ? section.lines : []) {
      if (!Array.isArray(line?.scenes) || !line.scenes.includes(sceneId)) continue;
      if (line.set && !set) set = line.set;
      for (const cue of resolveCastCues(line, {words})) {
        (cues[cue.id] ??= []).push({at: Math.max(0, Math.round((cue.time - start) * 1000) / 1000), ...(cue.pose ? {pose: cue.pose} : {}), ...(cue.expression ? {expression: cue.expression} : {})});
      }
    }
  }
  return {set, cues};
}

// ---------------------------------------------------------------------------
// The consistency gate (word anchors in scene params resolve in
// kit/core/story.mjs resolveCastAnchors)

/**
 * Consistency findings for a resolved story's character scenes: the cast
 * resolves, every scene's characters exist, and each character is drawn
 * from the same params (fingerprint) and colours in every scene. models:
 * resolved module models (kit/core/modules.mjs). → [{scene, id, detail}]
 */
export function castConsistency(story, models) {
  const findings = [];
  let resolved;
  try { resolved = resolveStoryCast(story); } catch (error) { return [{scene: null, id: null, detail: `story cast: ${error.message}`}]; }
  const seen = new Map();
  for (const model of models) {
    for (const actor of model?.content?.actors ?? []) {
      let expected;
      try { expected = castMember(resolved, actor.id); } catch (error) { findings.push({scene: model.sceneId, id: actor.id, detail: error.message}); continue; }
      if (actor.look !== expected.look) findings.push({scene: model.sceneId, id: actor.id, detail: `${actor.id} in ${model.sceneId} is drawn from different params or colours than the story cast defines`});
      const first = seen.get(actor.id);
      if (first && first.look !== actor.look) findings.push({scene: model.sceneId, id: actor.id, detail: `${actor.id} looks different in ${model.sceneId} than in ${first.scene}`});
      if (!first) seen.set(actor.id, {scene: model.sceneId, look: actor.look});
    }
  }
  return findings;
}

/** Identity of a character for comparisons (params and drawing style only). */
export const characterFingerprint = (params, style = 'flat') => rigFingerprint(params, style);

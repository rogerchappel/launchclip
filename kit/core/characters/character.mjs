// Saved characters: one designed character as a file, used by the CLI
// (`launchclip cast create / edit / export / import`), by agents and by every
// story reader.
//
//   {schema: "launchclip.character.v1", id, name, personality?, style, voice?,
//    params: {build, height, age?, skin, hair: {style, color},
//             outfit: {top, bottom, over?}, accessories, headwear?, mobility?,
//             colors: {top, bottom, shoes, accent}}}
//
// params are rig params (rig.mjs normalizeRigParams validates them). style is
// the drawing style the character was designed in (its sheet draws in it); in
// a story the cast's style decides, as for every character.
//
// A story uses a saved character by id: a story cast entry {id: "nova"} (or
// {id: "lead", from: "nova"}) that names no starter and carries no skin and
// hair of its own is filled from the saved file (withSavedCharacters); fields
// the entry gives override it, as they do for a starter. Entries that name a
// starter or carry their own params are left alone, so stories written before
// saved characters resolve as they did.
//
// Edits are set paths: "hair.style=locs", "accessories+=glasses",
// "headwear=none". CHARACTER_PATHS lists them; the values come from the rig's
// and the styles' own option lists, so new options are settable as they land.
//
// Imports only sibling kit/core files.

import {ACCESSORIES, AGES, BOTTOMS, BUILDS, GLASSES, HAIR_STYLES, HEADWEAR, HEIGHTS, MOBILITY, OVERS, TOPS, normalizeRigParams} from './rig.mjs';
import {BRAND_ROLES, HAIR_COLORS, NEUTRALS, SKIN_TONES} from './palette.mjs';
import {isStarterId} from './cast.mjs';
import {DRAWING_STYLES} from './styles.mjs';
import {KOKORO_VOICES} from './cues.mjs';

export const CHARACTER_SCHEMA = 'launchclip.character.v1';
export const CAST_PACK_SCHEMA = 'launchclip.cast-pack.v1';
/** The file name of a saved character. */
export const characterFileName = id => `${id}.character.json`;

// A voice shaped like a Kokoro id must be one of the local Kokoro voices.
const KOKORO = /^[ab][fm]_/;
const ID = /^[a-z][a-z0-9-]{0,23}$/;
const KEYS = ['schema', 'id', 'name', 'personality', 'style', 'voice', 'params'];
const isObj = value => value && typeof value === 'object' && !Array.isArray(value);
const clothing = () => [...Object.keys(NEUTRALS), ...BRAND_ROLES];

/**
 * Every set path and what it takes. values: the allowed names (read from the
 * rig, the palette and the drawing styles when called); free: any text;
 * hex: a six-digit hex is accepted too; list: takes += and -=; clear: "none"
 * removes it.
 */
export function characterPaths() {
  return {
    name: {free: true, describe: 'display name, 1–40 characters'},
    personality: {free: true, clear: true, describe: 'one line, at most 160 characters'},
    voice: {values: [...KOKORO_VOICES], other: true, clear: true, describe: 'a local Kokoro voice, or another provider\'s voice id'},
    style: {values: [...DRAWING_STYLES]},
    build: {values: [...BUILDS]},
    height: {values: [...HEIGHTS]},
    age: {values: [...AGES]},
    skin: {values: Object.keys(SKIN_TONES), hex: true},
    'hair.style': {values: [...HAIR_STYLES]},
    'hair.color': {values: [...Object.keys(HAIR_COLORS), ...clothing()], hex: true},
    'outfit.top': {values: [...TOPS]},
    'outfit.bottom': {values: [...BOTTOMS]},
    'outfit.over': {values: [...OVERS], clear: true},
    accessories: {values: [...ACCESSORIES], list: true, clear: true},
    headwear: {values: [...HEADWEAR], clear: true},
    mobility: {values: [...MOBILITY], clear: true},
    'colors.top': {values: clothing(), hex: true},
    'colors.bottom': {values: clothing(), hex: true},
    'colors.shoes': {values: clothing(), hex: true},
    'colors.accent': {values: clothing(), hex: true}
  };
}
export const CHARACTER_PATHS = Object.freeze(Object.keys(characterPaths()));

/** Rig params as a character file stores them: colours without the derived skin and hair slots. */
function storedParams(normal) {
  const {skin: _skin, hair: _hair, ...colors} = normal.colors;
  return {...normal, colors};
}

/**
 * Validate a character file and return it in canonical form (fixed key
 * order, normalised params). Throws an Error naming the first problem.
 */
export function normalizeCharacter(file, path = 'character') {
  if (!isObj(file)) throw new Error(`${path} must be an object`);
  for (const key of Object.keys(file)) if (!KEYS.includes(key)) throw new Error(`${path}.${key} is not supported (allowed: ${KEYS.join(', ')})`);
  if (file.schema !== CHARACTER_SCHEMA) throw new Error(`${path}.schema must be "${CHARACTER_SCHEMA}"`);
  if (typeof file.id !== 'string' || !ID.test(file.id)) throw new Error(`${path}.id must be a lowercase id (letters, digits, hyphens; ≤ 24)`);
  if (isStarterId(file.id)) throw new Error(`${path}.id "${file.id}" is a starter character; a saved character needs its own id`);
  const name = file.name ?? file.id;
  if (typeof name !== 'string' || !name.trim() || name.length > 40) throw new Error(`${path}.name must be a string of 1–40 characters`);
  const personality = file.personality ?? null;
  if (personality !== null && (typeof personality !== 'string' || !personality.trim() || personality.length > 160 || /[\r\n]/.test(personality))) throw new Error(`${path}.personality must be one line of 1–160 characters`);
  const style = file.style ?? 'flat';
  if (!DRAWING_STYLES.includes(style)) throw new Error(`${path}.style must be one of ${DRAWING_STYLES.join(', ')}; got ${JSON.stringify(style)}`);
  const voice = file.voice ?? null;
  if (voice !== null && (typeof voice !== 'string' || !voice.trim() || voice.length > 80)) throw new Error(`${path}.voice must be a voice id (Kokoro: af_heart, am_michael, …)`);
  if (voice !== null && KOKORO.test(voice.trim()) && !KOKORO_VOICES.includes(voice.trim())) throw new Error(`${path}.voice ${voice} is not a local Kokoro voice (${KOKORO_VOICES.join(', ')})`);
  const params = storedParams(normalizeRigParams(file.params, `${path}.params`));
  return {schema: CHARACTER_SCHEMA, id: file.id, name: name.trim(), ...(personality ? {personality: personality.trim()} : {}), style, ...(voice ? {voice: voice.trim()} : {}), params};
}

/** Problems with a character file, as strings (empty when it is valid). */
export function characterErrors(file) {
  try { normalizeCharacter(file); return []; } catch (error) { return [error.message]; }
}

/** A saved character as a story cast entry (story.cast.characters[]). */
export function characterCastEntry(character) {
  const normal = normalizeCharacter(character);
  return {id: normal.id, name: normal.name, ...(normal.voice ? {voice: normal.voice} : {}), ...normal.params};
}

// ---------------------------------------------------------------------------
// Stories

const entriesOf = cast => (Array.isArray(cast) ? cast : Array.isArray(cast?.characters) ? cast.characters : []);
/** The saved character a story cast entry asks for, or null when it resolves without one. */
function wanted(entry) {
  if (!isObj(entry) || typeof entry.id !== 'string' || entry.art !== undefined) return null;
  const base = entry.from ?? entry.id;
  if (typeof base !== 'string' || !ID.test(base) || isStarterId(base)) return null;
  if (entry.from === undefined && entry.skin !== undefined && entry.hair !== undefined) return null;
  return base;
}

/** Ids of the saved characters a story's cast asks for (to load before withSavedCharacters). */
export function savedCharacterRequests(story) {
  return [...new Set(entriesOf(story?.cast).map(wanted).filter(Boolean))];
}

/**
 * Fill a story's cast entries from saved characters. find(id) → a character
 * file or null. → {story, used: [{id, from}]}; the input story itself when no
 * entry asks for one (or none is found: validation then names the entry).
 */
export function withSavedCharacters(story, find) {
  const used = [];
  const fill = entry => {
    const base = wanted(entry);
    const saved = base ? find(base) : null;
    if (!saved) return entry;
    const from = characterCastEntry(saved);
    const {from: _from, ...own} = entry;
    used.push({id: entry.id, from: base});
    return {
      ...from, ...own, id: entry.id,
      hair: {...from.hair, ...(isObj(own.hair) ? own.hair : {})},
      outfit: {...from.outfit, ...(isObj(own.outfit) ? own.outfit : {})},
      colors: {...from.colors, ...(isObj(own.colors) ? own.colors : {})}
    };
  };
  const cast = story?.cast;
  if (!entriesOf(cast).length) return {story, used};
  const characters = entriesOf(cast).map(fill);
  if (!used.length) return {story, used};
  return {story: {...story, cast: Array.isArray(cast) ? characters : {...cast, characters}}, used};
}

// ---------------------------------------------------------------------------
// Set paths

/** "hair.style=locs" | "accessories+=glasses" | "headwear=none" → {path, op, value}. */
export function parseSet(text) {
  const match = /^\s*([a-z.]+)\s*(\+=|-=|=)\s*(.*?)\s*$/s.exec(String(text ?? ''));
  if (!match) throw new Error(`--set takes path=value (for example hair.style=locs, accessories+=glasses, headwear=none); got ${JSON.stringify(text)}`);
  return {path: match[1], op: match[2], value: match[3]};
}

const isNone = value => value === '' || value === 'none' || value === null || value === undefined;

/**
 * Apply set paths to a character (a full file, or a draft with partial
 * params). → a new draft; validate it with normalizeCharacter. Unknown paths
 * throw; option names are checked by normalizeCharacter, which lists them.
 */
export function applyCharacterSets(character, sets) {
  const paths = characterPaths();
  const out = {...character, params: {...(character.params ?? {})}};
  const p = out.params;
  for (const set of sets) {
    const {path, op = '=', value} = set;
    const spec = paths[path];
    if (!spec) throw new Error(`"${path}" is not a character path (paths: ${CHARACTER_PATHS.join(', ')})`);
    if (op !== '=' && !spec.list) throw new Error(`${path} takes =, not ${op} (only accessories is a list)`);
    if (isNone(value) && !spec.clear) throw new Error(`${path} cannot be cleared; set it to one of its options`);
    if (path === 'accessories') {
      const names = isNone(value) ? [] : String(value).split(',').map(name => name.trim()).filter(Boolean);
      let list = op === '=' ? [] : [...(Array.isArray(p.accessories) ? p.accessories : [])];
      if (op === '-=') list = list.filter(name => !names.includes(name));
      // A new pair of glasses replaces the pair already worn (the rig draws one).
      else for (const name of names) { if (GLASSES.includes(name)) list = list.filter(other => !GLASSES.includes(other)); if (!list.includes(name)) list.push(name); }
      p.accessories = list;
      continue;
    }
    const [head, leaf] = path.split('.');
    if (!leaf) {
      const target = ['name', 'personality', 'voice', 'style'].includes(head) ? out : p;
      if (isNone(value)) delete target[head]; else target[head] = String(value);
      continue;
    }
    const group = {...(isObj(p[head]) ? p[head] : {})};
    if (isNone(value)) delete group[leaf]; else group[leaf] = String(value);
    p[head] = group;
  }
  return out;
}

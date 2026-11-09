// The show bible (launchclip.show-bible.v1, BIBLE.json beside
// storyboard.json): who is in a character story, what each of them looks and
// sounds like, where it happens and how it is drawn, pinned so every later
// step draws the same people (docs/ANIMATION_PIPELINE_RFC.md §4.2).
//
//   {schema, frozen, hash,
//    cast: {style, colors?, characters: [{...a story cast entry with full rig
//           params, character_file?, sheet, fingerprint, must_keep}]},
//    world?: {kind, time?, props?, detail?, sets?},
//    style?: {pack?, seed?, drawing_style?},
//    rules?: [text], inputs?: {script_hash?}}
//
// `cast` is the story.cast shape (characters/cues.mjs) with four additions
// per character: the saved character file it came from, its reference sheet,
// its fingerprint and must_keep. Every character has rig params; an
// illustrated (`art`) entry is not a bible character, because the rig draws
// the animatic and is the fallback for handed-in art.
//
// A draft (frozen: false) carries the same fields without the hash, the
// sheets, the fingerprints and must_keep; `launchclip bible freeze`
// (src/bible.js) fills those in and writes the hash. Once frozen, a story's
// cast is the bible's cast (withBible), a story and its direction map name
// the bible as bible: {file, hash}, and the `bible` gate in `finish` fails
// when they disagree (bibleCastFindings).
//
//   validateBible(bible, {script, exists}) → {ok, errors, warnings}
//   bibleHash(bible)                       → "sha256:…" of the content
//   mustKeep(params)                       → what a viewer would notice changing
//   bibleCast(bible)                       → the bible's cast as story.cast
//   bibleCharacter(member, extra)          → one bible cast entry
//   withBible(story, bible, file)          → the story pinned to the bible
//   bibleRefErrors(ref, path)              → problems with a bible: {file, hash}
//   bibleCastFindings(story, bible)        → where a story's cast differs
//
// Pure ESM; imports only kit/core siblings. Canonical copy: kit/core/bible.mjs.

import {sha256Hex} from './sha256.mjs';
import {bibleRefErrors} from './story.mjs';
import {DRAWING_STYLES, KOKORO_VOICES, resolveStoryCast, storyCastErrors} from './characters/cues.mjs';
import {ACCESSORIES, FACIAL_HAIR, GLASSES} from './characters/rig.mjs';
import {BRAND_ROLES} from './characters/palette.mjs';
import {SETS} from './characters/sets.mjs';
import {storyWorldErrors} from './worlds/index.mjs';

export const BIBLE_SCHEMA = 'launchclip.show-bible.v1';
export const BIBLE_FILE = 'BIBLE.json';
/** Where a project keeps its reference sheets: bible/sheets/<id>.png. */
export const BIBLE_SHEETS = 'bible/sheets';
/** The four fields a bible character adds to a story cast entry. */
export {bibleRefErrors};
export const BIBLE_CHARACTER_FIELDS = Object.freeze(['character_file', 'sheet', 'fingerprint', 'must_keep']);

const TOP = ['schema', 'frozen', 'hash', 'cast', 'world', 'style', 'rules', 'inputs'];
const HASH = /^sha256:[0-9a-f]{64}$/;
const isObj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = value => typeof value === 'string' && value.trim().length > 0;
/** A path inside the project: relative, forward slashes, no "..". */
const insideProject = value => nonEmpty(value) && !/^([a-zA-Z]:|[\\/])/.test(value) && !value.includes('\\') && !value.split('/').includes('..');

/** JSON with every object's keys in order, so the same content always hashes the same. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObj(value)) return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

/** The hash of a bible's content: everything in the file but `hash` itself. */
export function bibleHash(bible) {
  const {hash: _hash, ...content} = isObj(bible) ? bible : {};
  return `sha256:${sha256Hex(canonical(content))}`;
}

/** What a story and a direction map carry to name their bible. */
export const bibleRef = (bible, file = BIBLE_FILE) => ({file, hash: bible.hash});

// ---------------------------------------------------------------------------
// must_keep

// Accessories a viewer would notice changing: glasses, facial hair, and what
// must never be erased from a person (a hearing aid, a bindi). Jewellery,
// bags and freckles are left to the sheet.
const KEPT_ACCESSORIES = [...GLASSES, ...FACIAL_HAIR.filter(name => name !== 'stubble'), 'hearing-aid', 'bindi'].filter(name => ACCESSORIES.includes(name));
const words = name => String(name).replace(/-/g, ' ');
const coloured = (color, thing) => (color === undefined || color === null ? thing
  : BRAND_ROLES.includes(color) ? `${thing} in the brand's ${color} colour`
  : `${words(color)} ${thing}`);

/**
 * The short list of features a viewer would notice changing, read from a
 * character's rig params: hair, skin tone, outfit, glasses and facial hair,
 * headwear, mobility aid, and age when not an adult. The hand-in check asks
 * for each of them (RFC §5.4); art that drops one is not this character.
 */
export function mustKeep(params) {
  if (!isObj(params)) return [];
  const out = [];
  const colors = isObj(params.colors) ? params.colors : {};
  const hair = isObj(params.hair) ? params.hair : {};
  if (hair.style === 'bald') out.push('bald head');
  else if (hair.style === 'headscarf') out.push(coloured(hair.color, 'headscarf'));
  else if (hair.style) out.push(coloured(hair.color, `${words(hair.style)} hair`));
  if (params.skin) out.push(`${words(params.skin)} skin`);
  const outfit = isObj(params.outfit) ? params.outfit : {};
  if (outfit.top) out.push(coloured(colors.top, words(outfit.top)));
  if (outfit.bottom && outfit.top !== 'dress') out.push(coloured(colors.bottom, words(outfit.bottom)));
  if (outfit.over) out.push(words(outfit.over));
  for (const name of Array.isArray(params.accessories) ? params.accessories : []) if (KEPT_ACCESSORIES.includes(name)) out.push(words(name));
  if (params.headwear) out.push(words(params.headwear));
  if (params.mobility) out.push(words(params.mobility));
  if (params.age && params.age !== 'adult') out.push(`a ${params.age}`);
  return out;
}

// ---------------------------------------------------------------------------
// Cast

function castEntry(entry) {
  if (!isObj(entry)) return entry;
  const out = {...entry};
  for (const key of BIBLE_CHARACTER_FIELDS) delete out[key];
  return out;
}

/** The bible's cast in the story.cast shape (the four bible fields removed), or null. */
export function bibleCast(bible) {
  const cast = bible?.cast;
  if (!isObj(cast)) return null;
  return {...cast, ...(Array.isArray(cast.characters) ? {characters: cast.characters.map(castEntry)} : {})};
}

/**
 * One bible cast entry from a resolved cast member (resolveStoryCast):
 * its full rig params, so the entry no longer depends on a starter or a
 * saved file, plus its fingerprint and must_keep. extra: {character_file?, sheet?}.
 */
export function bibleCharacter(member, extra = {}) {
  const {skin: _skin, hair: _hair, ...colors} = member.params.colors ?? {};
  return {
    id: member.id,
    ...(member.name && member.name !== member.id ? {name: member.name} : {}),
    ...(member.voice ? {voice: member.voice} : {}),
    ...(member.position ? {position: member.position} : {}),
    ...member.params,
    colors,
    ...(extra.character_file ? {character_file: extra.character_file} : {}),
    ...(extra.sheet ? {sheet: extra.sheet} : {}),
    fingerprint: member.fingerprint,
    must_keep: mustKeep(member.params)
  };
}

/**
 * A story pinned to a frozen bible: its cast is the bible's and it names the
 * bible by file and hash. Everything else in the story is left as it is.
 */
export function withBible(story, bible, file = BIBLE_FILE) {
  if (!isObj(bible) || bible.frozen !== true || !HASH.test(String(bible.hash))) throw new Error('a story is pinned to a frozen bible; freeze it first (launchclip bible freeze)');
  return {...story, cast: bibleCast(bible), bible: bibleRef(bible, file)};
}

/** A direction map naming a frozen bible. */
export function directionWithBible(map, bible, file = BIBLE_FILE) {
  if (!isObj(bible) || bible.frozen !== true || !HASH.test(String(bible.hash))) throw new Error('a direction map names a frozen bible; freeze it first (launchclip bible freeze)');
  return {...map, bible: bibleRef(bible, file)};
}

// ---------------------------------------------------------------------------
// Validation

/** Ids of the characters a script lists (SCRIPT.json `characters`; the narrator is not one). */
function scriptCharacters(script) {
  const list = Array.isArray(script?.characters) ? script.characters : [];
  return [...new Set(list.map(entry => (typeof entry === 'string' ? entry : entry?.id)).filter(id => typeof id === 'string' && id && id !== 'narrator'))];
}

/**
 * Validate a show bible. A draft (frozen: false) is checked for shape, cast,
 * world and style; a frozen bible also needs a sheet, a fingerprint and
 * must_keep on every character and a hash that matches its content.
 * options:
 *   script: the project's SCRIPT.json; every character it lists needs an
 *     entry with a voice;
 *   exists(path) → boolean: whether a project-relative file is on disk
 *     (sheets and character files). Without it, files are not looked for.
 */
export function validateBible(bible, {script = null, exists = null} = {}) {
  const errors = [];
  const warnings = [];
  const err = message => errors.push(message);
  if (!isObj(bible)) return {ok: false, errors: [`${BIBLE_FILE} must be a JSON object`], warnings};
  if (bible.schema !== BIBLE_SCHEMA) err(`schema must be "${BIBLE_SCHEMA}"`);
  for (const key of Object.keys(bible)) if (!TOP.includes(key)) err(`unknown field "${key}" (allowed: ${TOP.join(', ')})`);
  if (bible.frozen !== undefined && typeof bible.frozen !== 'boolean') err('frozen must be true or false');
  const frozen = bible.frozen === true;

  // Cast: the story.cast rules, on the cast without the bible's own fields.
  const cast = bible.cast;
  let resolved = null;
  if (!isObj(cast) || !Array.isArray(cast.characters) || !cast.characters.length) err('cast must be {style, colors?, characters: [...]} with at least one character');
  else {
    if (!DRAWING_STYLES.includes(cast.style)) err(`cast.style must be one of ${DRAWING_STYLES.join(', ')}: the one drawing style the whole cast is drawn in`);
    const castErrors = storyCastErrors(bibleCast(bible));
    errors.push(...castErrors);
    cast.characters.forEach((entry, i) => {
      if (isObj(entry) && entry.art !== undefined) err(`cast.characters[${i}] (${entry.id}) is an illustrated character (art); a bible character needs rig params, because the rig draws the animatic and is the fallback for handed-in art`);
    });
    if (!castErrors.length) { try { resolved = resolveStoryCast({cast: bibleCast(bible)}); } catch (error) { err(error.message); } }
    const voices = new Map();
    cast.characters.forEach((entry, i) => {
      if (!isObj(entry) || typeof entry.id !== 'string') return;
      const path = `cast.characters[${i}]`;
      const member = resolved?.members.get(entry.id) ?? null;
      if (nonEmpty(entry.voice)) {
        if (/^[ab][fm]_/.test(entry.voice) && !KOKORO_VOICES.includes(entry.voice)) err(`${path}.voice ${entry.voice} is not a local Kokoro voice (${KOKORO_VOICES.join(', ')})`);
        if (voices.has(entry.voice)) warnings.push(`${entry.id} and ${voices.get(entry.voice)} share the voice ${entry.voice}; give each speaking character its own`);
        else voices.set(entry.voice, entry.id);
      } else if (frozen) err(`${path} (${entry.id}) needs a voice`);
      if (entry.character_file !== undefined) {
        if (!insideProject(entry.character_file)) err(`${path}.character_file must be a path inside the project, like "cast/${entry.id}.character.json"`);
        else if (exists && !exists(entry.character_file)) err(`${path}.character_file ${entry.character_file} does not exist`);
      }
      if (entry.sheet !== undefined && !insideProject(entry.sheet)) err(`${path}.sheet must be a path inside the project, like "${BIBLE_SHEETS}/${entry.id}.png"`);
      if (entry.must_keep !== undefined && !(Array.isArray(entry.must_keep) && entry.must_keep.every(nonEmpty))) err(`${path}.must_keep must be a list of features, like ["curly espresso hair", "round glasses"]`);
      if (entry.fingerprint !== undefined && typeof entry.fingerprint !== 'string') err(`${path}.fingerprint must be a string`);
      if (!frozen) return;
      if (entry.sheet === undefined) err(`${path} (${entry.id}) needs its reference sheet (sheet: "${BIBLE_SHEETS}/${entry.id}.png")`);
      else if (insideProject(entry.sheet) && exists && !exists(entry.sheet)) err(`${path}.sheet ${entry.sheet} does not exist; draw it again with launchclip bible freeze`);
      if (member && entry.fingerprint !== member.fingerprint) err(`${path}.fingerprint does not match ${entry.id}'s rig params and the cast's drawing style; freeze the bible again`);
      if (member && Array.isArray(entry.must_keep)) {
        const missing = mustKeep(member.params).filter(feature => !entry.must_keep.includes(feature));
        if (missing.length) err(`${path}.must_keep leaves out ${missing.map(feature => `"${feature}"`).join(', ')}; it may add features but not drop what the rig params say`);
      } else if (member) err(`${path} (${entry.id}) needs must_keep`);
    });
    // Every character the script lists has an entry and a voice.
    for (const id of scriptCharacters(script)) {
      const entry = cast.characters.find(candidate => isObj(candidate) && candidate.id === id);
      if (!entry) err(`the script's character "${id}" has no entry in cast.characters`);
      else if (!nonEmpty(entry.voice)) err(`the script's character "${id}" needs a voice`);
    }
  }

  // World: a world the kit draws and the sets the story may use.
  if (bible.world !== undefined) {
    if (!isObj(bible.world)) err('world must be {kind, time?, props?, detail?, sets?}');
    else {
      const {sets, ...world} = bible.world;
      errors.push(...storyWorldErrors(world).map(message => message.replace('(kind, time, props, detail)', '(kind, time, props, detail, sets)')));
      if (!nonEmpty(world.kind)) err('world.kind must name a world');
      if (sets !== undefined) {
        if (!Array.isArray(sets)) err('world.sets must be a list of sets');
        else for (const name of sets) if (!SETS.includes(name)) err(`world.sets: ${JSON.stringify(name)} is not a set (${SETS.join(', ')})`);
      }
    }
  }

  // Style: the project's style pack and seed, and the drawing style (the cast's).
  if (bible.style !== undefined) {
    const style = bible.style;
    if (!isObj(style)) err('style must be {pack?, seed?, drawing_style?}');
    else {
      for (const key of Object.keys(style)) if (!['pack', 'seed', 'drawing_style'].includes(key)) err(`style.${key} is not supported (allowed: pack, seed, drawing_style)`);
      if (style.pack !== undefined && !nonEmpty(style.pack)) err('style.pack must be a style pack name or path');
      if (style.seed !== undefined && !(Number.isInteger(style.seed) || nonEmpty(style.seed))) err('style.seed must be the style\'s seed');
      if (style.drawing_style !== undefined && !DRAWING_STYLES.includes(style.drawing_style)) err(`style.drawing_style must be one of ${DRAWING_STYLES.join(', ')}`);
      else if (style.drawing_style !== undefined && isObj(cast) && cast.style !== undefined && style.drawing_style !== cast.style) err(`style.drawing_style (${style.drawing_style}) must be the cast's style (${cast.style}): a video has one look`);
    }
  }

  if (bible.rules !== undefined && !(Array.isArray(bible.rules) && bible.rules.every(nonEmpty))) err('rules must be a list of sentences');
  if (bible.inputs !== undefined) {
    if (!isObj(bible.inputs)) err('inputs must be {script_hash?}');
    else {
      for (const key of Object.keys(bible.inputs)) if (key !== 'script_hash') err(`inputs.${key} is not supported (allowed: script_hash)`);
      if (bible.inputs.script_hash !== undefined && !nonEmpty(bible.inputs.script_hash)) err('inputs.script_hash must be the hash of the script the bible was made from');
    }
  }

  if (frozen) {
    if (typeof bible.hash !== 'string' || !HASH.test(bible.hash)) err('a frozen bible needs its hash ("sha256:" and 64 hex digits); launchclip bible freeze writes it');
    else if (bible.hash !== bibleHash(bible)) err('hash does not match the bible\'s content: it was changed after it was frozen; freeze it again (launchclip bible freeze --force) and plan against the new one');
  } else if (bible.hash !== undefined) err('a draft bible (frozen: false) carries no hash');
  return {ok: errors.length === 0, errors, warnings};
}

// ---------------------------------------------------------------------------
// The story against its bible

const FIELDS = ['build', 'height', 'age', 'skin', 'hair', 'outfit', 'accessories', 'headwear', 'mobility', 'colors'];

/**
 * Where a story's cast differs from its bible's, as strings ([] when they
 * agree). The two casts are resolved and compared, so a story entry that
 * names a starter or was filled from a saved character matches a bible entry
 * with the same params written out. story: after the saved-character step
 * (src/story_style.js applyProjectStyle).
 */
export function bibleCastFindings(story, bible) {
  const findings = [];
  let own, pinned;
  try { pinned = resolveStoryCast({brand: story?.brand, cast: bibleCast(bible)}); } catch (error) { return [`the bible's cast does not resolve: ${error.message}`]; }
  if (story?.cast === undefined || story?.cast === null) return [`the story has no cast; the bible's is ${[...pinned.members.keys()].join(', ')}`];
  try { own = resolveStoryCast(story); } catch (error) { return [`story cast: ${error.message}`]; }
  if (own.style !== pinned.style) findings.push(`story.cast.style is ${own.style}; the bible's is ${pinned.style}`);
  if (canonical(own.mapping ?? {}) !== canonical(pinned.mapping ?? {})) findings.push('story.cast.colors differs from the bible\'s colour mapping');
  for (const [id, want] of pinned.members) {
    const have = own.members.get(id);
    if (!have) { findings.push(`${id} is in the bible but not in story.cast`); continue; }
    if (have.sprite) { findings.push(`${id} is an illustrated character (art) in story.cast; the bible's ${id} is drawn by the rig`); continue; }
    const changed = FIELDS.filter(key => canonical(have.params?.[key]) !== canonical(want.params?.[key]));
    if (changed.length) findings.push(`${id}'s ${changed.join(', ')} in story.cast ${changed.length === 1 ? 'differs' : 'differ'} from the bible`);
    if ((have.voice ?? null) !== (want.voice ?? null)) findings.push(`${id}'s voice is ${have.voice ?? 'not set'} in story.cast; the bible's is ${want.voice ?? 'not set'}`);
    if ((have.position ?? null) !== (want.position ?? null)) findings.push(`${id}'s position is ${have.position ?? 'not set'} in story.cast; the bible's is ${want.position ?? 'not set'}`);
    if (have.name !== want.name) findings.push(`${id}'s name is ${JSON.stringify(have.name)} in story.cast; the bible's is ${JSON.stringify(want.name)}`);
  }
  for (const id of own.members.keys()) if (!pinned.members.has(id)) findings.push(`${id} is in story.cast but not in the bible`);
  return findings;
}

// The show bible (launchclip.show-bible.v1, BIBLE.json beside
// storyboard.json): who is in a character story, what each of them looks and
// sounds like, where it happens and how it is drawn, pinned so every later
// step draws the same people (docs/ANIMATION_PIPELINE_RFC.md §4.2).
//
//   {schema, frozen, hash,
//    cast: {style, colors?, characters: [{...a story cast entry with full rig
//           params, character_file?, sheet, fingerprint, must_keep, description}]},
//    world?: {kind, time?, props?, detail?, sets?, shows?},
//      shows: the props of world.props the story turns on (the starting gate
//      of a story about one): the `bible` gate fails a story that never puts
//      one of them on screen (biblePropFindings).
//    style?: {pack?, seed?, drawing_style?},
//    rules?: [text], inputs?: {script_hash?},
//    engine?: {problem, episodes: [text]}}
//      engine: for a bible a series shares, the recurring problem that goes
//      wrong every episode and is never solved for good, with the episode
//      ideas pitched from it. Fewer than ENGINE_EPISODES distinct ideas is a
//      weak engine, and the bible does not validate (engineFindings).
//
// `cast` is the story.cast shape (characters/cues.mjs) with five additions
// per character: the saved character file it came from, its reference sheet,
// its fingerprint, must_keep and its written description (characterDescription:
// silhouette, proportions, colours as hex, signature item, gesture, must_keep
// and the flaw, in that order, pasted word for word wherever the character is
// described). Each character's params carry a flaw (rig param `flaw`, one small
// deliberate imperfection the rig draws); freeze gives one to a character that
// has none, and must_keep names it. Every character has rig params; an
// illustrated (`art`) entry is not a bible character, because the rig draws
// the animatic and is the fallback for handed-in art.
//
// A draft (frozen: false) carries the same fields without the hash, the
// sheets, the fingerprints, must_keep and the descriptions; `launchclip bible freeze`
// (src/bible.js) fills those in and writes the hash. Once frozen, a story's
// cast is the bible's cast (withBible), a story and its direction map name
// the bible as bible: {file, hash}, and the `bible` gate in `finish` fails
// when they disagree (bibleCastFindings).
//
//   validateBible(bible, {script, exists}) → {ok, errors, warnings}
//   bibleHash(bible)                       → "sha256:…" of the content
//   mustKeep(params)                       → what a viewer would notice changing
//   defaultFlaw(id)                        → the flaw freeze gives a character with none
//   characterDescription(member)           → the written description of a resolved cast member
//   engineFindings(engine)                 → why a series engine is too weak ([] when it holds)
//   bibleCast(bible)                       → the bible's cast as story.cast
//   bibleCharacter(member, extra)          → one bible cast entry
//   bibleFingerprint(member)               → a character's identity digest
//   withBible(story, bible, file)          → the story pinned to the bible
//   bibleRefErrors(ref, path)              → problems with a bible: {file, hash}
//   bibleCastFindings(story, bible)        → where a story's cast differs
//   biblePropFindings(story, bible)        → story props that never appear on screen
//
// Pure ESM; imports only kit/core siblings. Canonical copy: kit/core/bible.mjs.

import {sha256Hex} from './sha256.mjs';
import {bibleRefErrors} from './story.mjs';
import {DRAWING_STYLES, KOKORO_VOICES, resolveStoryCast, storyCastErrors} from './characters/cues.mjs';
import {ACCESSORIES, FACIAL_HAIR, GLASSES} from './characters/rig.mjs';
import {BRAND_ROLES} from './characters/palette.mjs';
import {FLAWS, FLAW_WORDS, KINDS, isKind} from './characters/kinds.mjs';
import {hashSeed} from './characters/generate.mjs';
import {styleGeometry, styleHeight} from './characters/styles.mjs';
import {SETS} from './characters/sets.mjs';
import {storyWorldErrors} from './worlds/index.mjs';

export const BIBLE_SCHEMA = 'launchclip.show-bible.v1';
export const BIBLE_FILE = 'BIBLE.json';
/** Where a project keeps its reference sheets: bible/sheets/<id>.png. */
export const BIBLE_SHEETS = 'bible/sheets';
/** The five fields a bible character adds to a story cast entry. */
export {bibleRefErrors};
export const BIBLE_CHARACTER_FIELDS = Object.freeze(['character_file', 'sheet', 'fingerprint', 'must_keep', 'description']);
/** How many distinct episode ideas a series engine must give before episode one. */
export const ENGINE_EPISODES = 5;

const TOP = ['schema', 'frozen', 'hash', 'cast', 'world', 'style', 'rules', 'inputs', 'engine'];
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
  // An animal, a mascot or an object with a face: what it is, its main colour and its size.
  const flaw = FLAW_WORDS[params.flaw] ? [FLAW_WORDS[params.flaw]] : [];
  if (typeof params.kind === 'string' && params.kind !== 'person') return [coloured(params.colors?.body, words(params.kind)), ...(params.size ? [`${params.size} size`] : []), ...(Array.isArray(params.marks) ? params.marks.map(name => `white ${name}`) : []), ...flaw];
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
  return [...out, ...flaw];
}

/** The flaw `bible freeze` gives a character whose params have none: fixed by its id, so it never changes on a refreeze. */
export const defaultFlaw = id => FLAWS[hashSeed(`flaw:${id}`) % FLAWS.length];

// The gesture a description names, picked from the rig's poses by the character's params.
const GESTURES = Object.freeze({
  point: 'points with a straight arm', shrug: 'shrugs with both palms up', think: 'rests a hand on the chin', 'arms-crossed': 'folds both arms',
  'hands-on-hips': 'puts both hands on the hips', 'point-self': 'points at the chest with a thumb', wave: 'waves with one raised hand', facepalm: 'drops the face into one hand'
});
// Accessories a description may name as the signature item, in order of how much they stand out.
const SIGNATURE = ['scarf', 'tie', 'bowtie', 'stethoscope', 'backpack', 'crossbody-bag', 'lanyard', 'headphones', 'watch', 'necklace', 'earrings'];

/**
 * A character's written description, from a resolved cast member
 * (resolveStoryCast: its rig params, resolved colours and drawing style):
 * one fixed paragraph in a fixed order, silhouette, proportions, colours as
 * hex, one signature item, one gesture, must_keep and the flaw. The same
 * member always gives the same words; it is frozen with the bible and pasted
 * word for word, never paraphrased (docs/GENERATED_FOOTAGE_RFC.md §4, §8).
 */
export function characterDescription(member) {
  const p = member.params, c = member.colors ?? {}, style = member.style ?? 'flat';
  const name = member.name ?? member.id;
  const hex = slot => (typeof c[slot] === 'string' ? c[slot] : null);
  const parts = [];
  let item;
  if (isKind(p)) {
    const spec = KINDS[p.kind];
    parts.push(`${name} is ${spec.describe}${p.size ? `, ${p.size} size` : ''}.`);
    parts.push(`Proportions: ${heads(style, p)}, drawn ${style}.`);
    parts.push(`Colours: ${Object.entries(spec.slots).filter(([slot]) => hex(slot)).map(([slot, what]) => `${what} ${hex(slot)}`).join(', ')}.`);
    item = p.marks?.length ? `white ${words(p.marks[0])}` : `${spec.slots.accent ?? 'its accent'} in ${hex('accent')}`;
  } else {
    const hair = p.hair.style === 'bald' ? 'a bald head' : p.hair.style === 'headscarf' ? 'a headscarf' : `${words(p.hair.style)} hair`;
    const extras = [p.headwear ? an(words(p.headwear)) : null, p.mobility ? an(words(p.mobility)) : null].filter(Boolean);
    parts.push(`${name} is ${p.age && p.age !== 'adult' ? `a ${p.age}` : 'an adult'} with a ${p.build} build and ${hair}${extras.length ? `, with ${extras.join(' and ')}` : ''}, in a ${words(p.outfit.top)}${p.outfit.top === 'dress' ? '' : ` and ${words(p.outfit.bottom)}`}${p.outfit.over ? ` under ${an(words(p.outfit.over))}` : ''}.`);
    parts.push(`Proportions: ${p.height === 'average' ? 'average height' : `${words(p.height)}`}, ${heads(style, p)}, drawn ${style}.`);
    parts.push(`Colours: skin ${hex('skin')}, hair ${hex('hair')}, ${words(p.outfit.top)} ${hex('top')}${p.outfit.top === 'dress' ? '' : `, ${words(p.outfit.bottom)} ${hex('bottom')}`}, shoes ${hex('shoes')}, accent ${hex('accent')}.`);
    const glasses = p.accessories.find(entry => GLASSES.includes(entry));
    const worn = SIGNATURE.find(entry => p.accessories.includes(entry));
    item = p.headwear ? words(p.headwear) : glasses ? words(glasses) : p.outfit.over ? `${words(p.outfit.over)} in ${hex('accent')}` : worn ? words(worn) : `${words(p.outfit.top)} in ${hex('top')}`;
  }
  const poses = Object.keys(GESTURES);
  parts.push(`Signature item: ${item}.`);
  parts.push(`Gesture: ${GESTURES[poses[hashSeed(member.fingerprint ?? JSON.stringify(p)) % poses.length]]}.`);
  const keep = mustKeep(p);
  if (keep.length) parts.push(`Must keep: ${keep.join('; ')}.`);
  parts.push(`Flaw: ${FLAW_WORDS[p.flaw] ?? 'none'}.`);
  return parts.join(' ');
}

const an = thing => (thing.endsWith('s') ? thing : `${/^[aeiou]/.test(thing) ? 'an' : 'a'} ${thing}`);
// "about 3.5 heads tall" in this drawing style; the head's height from the style's own geometry.
function heads(style, params) {
  const head = styleGeometry(style, params)?.head?.ry;
  const tall = styleHeight(style, params);
  return head > 0 && tall > 0 ? `about ${Math.round((tall / (head * 2)) * 2) / 2} heads tall` : 'proportions as on the sheet';
}

// ---------------------------------------------------------------------------
// The series engine

const STOP = new Set('the a an and or but of to in on at for with from by is are was were be been his her its their they them he she it this that these those who what when where into over again every each one gets get got has have had not never no out up down off than then so as just'.split(' '));
const content = text => new Set(String(text).toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).map(word => word.replace(/^'+|'+$/g, '')).filter(word => word.length > 2 && !STOP.has(word)));
// Two ideas are the same episode when most of their content words are shared.
const sameIdea = (a, b) => {
  const shared = [...a].filter(word => b.has(word)).length;
  return shared / Math.max(1, Math.min(a.size, b.size)) >= 0.6;
};

/**
 * The premise check for a series engine ({problem, episodes}): the engine
 * holds when it gives ENGINE_EPISODES distinct episode ideas. An idea that is
 * mostly another's words, or that only restates the engine, does not count.
 * → [] when it holds, else findings that say why and how to fix it.
 */
export function engineFindings(engine) {
  if (!isObj(engine) || !nonEmpty(engine.problem)) return ['engine must be {problem, episodes}: the recurring problem that goes wrong every episode and can never be solved for good'];
  const pitched = (Array.isArray(engine.episodes) ? engine.episodes : []).filter(nonEmpty);
  const problem = content(engine.problem);
  const kept = [];
  let restated = 0;
  for (const idea of pitched) {
    const words = content(idea);
    if (!words.size || [...words].every(word => problem.has(word))) { restated += 1; continue; }
    if (!kept.some(other => sameIdea(words, other))) kept.push(words);
  }
  if (kept.length >= ENGINE_EPISODES) return [];
  return [`the engine is too weak: it gives ${kept.length} distinct episode idea${kept.length === 1 ? '' : 's'} (of ${pitched.length} pitched${restated ? `, ${restated} only restating the engine` : ''}); a series engine needs ${ENGINE_EPISODES} before episode one. Fix the engine, not the pitches: make the problem recur by itself (a want that cannot be met for good, or two characters whose wants collide), and give it more places to go wrong, then pitch ${ENGINE_EPISODES} episodes again`];
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

/** A character's identity in a bible: a short digest of its rig params and drawing style (rig.mjs rigFingerprint). */
export const bibleFingerprint = member => sha256Hex(member.fingerprint).slice(0, 16);

/**
 * One bible cast entry from a resolved cast member (resolveStoryCast):
 * its full rig params, so the entry no longer depends on a starter or a
 * saved file, plus its fingerprint, must_keep and written description.
 * extra: {character_file?, sheet?, description? (false leaves it out)}.
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
    fingerprint: bibleFingerprint(member),
    must_keep: mustKeep(member.params),
    ...(extra.description === false ? {} : {description: characterDescription(member)})
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
      if (entry.description !== undefined && !nonEmpty(entry.description)) err(`${path}.description must be the character's written description (launchclip bible freeze writes it)`);
      if (!frozen) return;
      // A bible frozen before flaws and descriptions still holds; freezing again with --force adds them.
      if (member?.params && !member.params.flaw) warnings.push(`${path} (${entry.id}) has no flaw; freeze again with --force to give it one (a small imperfection kept in must_keep, so drift is easy to spot)`);
      if (entry.description === undefined) warnings.push(`${path} (${entry.id}) has no written description; freeze again with --force to write one`);
      if (entry.sheet === undefined) err(`${path} (${entry.id}) needs its reference sheet (sheet: "${BIBLE_SHEETS}/${entry.id}.png")`);
      else if (insideProject(entry.sheet) && exists && !exists(entry.sheet)) err(`${path}.sheet ${entry.sheet} does not exist; draw it again with launchclip bible freeze`);
      if (member && entry.fingerprint !== bibleFingerprint(member)) err(`${path}.fingerprint does not match ${entry.id}'s rig params and the cast's drawing style; freeze the bible again`);
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
    if (!isObj(bible.world)) err('world must be {kind, time?, props?, detail?, depth?, sets?, shows?}');
    else {
      const {sets, shows, ...world} = bible.world;
      errors.push(...storyWorldErrors(world).map(message => message.replace('(kind, time, props, detail, depth)', '(kind, time, props, detail, depth, sets, shows)')));
      if (!nonEmpty(world.kind)) err('world.kind must name a world');
      if (sets !== undefined) {
        if (!Array.isArray(sets)) err('world.sets must be a list of sets');
        else for (const name of sets) if (!SETS.includes(name)) err(`world.sets: ${JSON.stringify(name)} is not a set (${SETS.join(', ')})`);
      }
      if (shows !== undefined) {
        const placed = (Array.isArray(world.props) ? world.props : []).map(entry => (typeof entry === 'string' ? entry : entry?.id));
        if (!Array.isArray(shows)) err('world.shows must be a list of prop ids from world.props');
        else for (const id of shows) if (!placed.includes(id)) err(`world.shows: ${JSON.stringify(id)} is not one of world.props (${placed.join(', ') || 'none'})`);
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
  if (bible.engine !== undefined) {
    if (!isObj(bible.engine)) err('engine must be {problem, episodes}');
    else {
      for (const key of Object.keys(bible.engine)) if (!['problem', 'episodes'].includes(key)) err(`engine.${key} is not supported (allowed: problem, episodes)`);
      if (bible.engine.episodes !== undefined && !(Array.isArray(bible.engine.episodes) && bible.engine.episodes.every(nonEmpty))) err('engine.episodes must be a list of episode ideas, one sentence each');
      else errors.push(...engineFindings(bible.engine).map(message => message.startsWith('engine') ? message : `engine: ${message}`));
    }
  }
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

const FIELDS = ['build', 'height', 'age', 'skin', 'hair', 'outfit', 'accessories', 'headwear', 'mobility', 'flaw', 'colors'];

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

// ---------------------------------------------------------------------------
// Story props

const propId = entry => (typeof entry === 'string' ? entry : isObj(entry) ? entry.id : null);
const hasProp = (list, id) => Array.isArray(list) && list.some(entry => propId(entry) === id);
// A scene that draws story.world.props: a world scene without props of its own, or a cast-scene standing in the story's world.
const showsWorldProps = scene => (scene?.module === 'world' && scene.params?.props === undefined)
  || (scene?.module === 'cast-scene' && scene.params?.backdrop !== 'room' && scene.params?.world === undefined);

/**
 * Where a story fails to show what the bible says it turns on: one finding
 * per prop of the bible's world.shows that no scene puts on screen, and per
 * state change the bible cues (the starting gate opening) that the story
 * never plays. A prop is on screen when story.world.props lists it and a
 * scene draws the story's world (a world scene, or a cast-scene standing in
 * it), when a scene's own params.props places it, or when a set-prop scene
 * shows it. → string[]
 */
export function biblePropFindings(story, bible) {
  const findings = [];
  const shows = Array.isArray(bible?.world?.shows) ? bible.world.shows : [];
  const wanted = (Array.isArray(bible?.world?.props) ? bible.world.props : []).filter(entry => shows.includes(propId(entry)));
  const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
  for (const entry of wanted) {
    const id = propId(entry);
    if (!id) continue;
    const inWorld = hasProp(story?.world?.props, id) && scenes.some(showsWorldProps);
    const placed = scenes.some(scene => (['world', 'cast-scene'].includes(scene?.module) && hasProp(scene.params?.props, id)) || (scene?.module === 'set-prop' && scene.params?.prop === id));
    if (!inWorld && !placed) {
      findings.push(`the story turns on "${id}" (the show bible's world.shows), but it never appears on screen: put it back in story.world.props with a cast-scene or world scene that draws the story's world, or place it in a scene (cast-scene or world params.props, or a set-prop scene)`);
      continue;
    }
    for (const cue of isObj(entry) && Array.isArray(entry.cues) ? entry.cues : []) {
      const cued = list => Array.isArray(list) && list.some(item => isObj(item) && item.id === id && (item.state === cue.state || (Array.isArray(item.cues) && item.cues.some(own => own?.state === cue.state))));
      if (!cued(story?.world?.props) && !scenes.some(scene => cued(scene?.params?.props))) findings.push(`the script has the ${id} become ${cue.state}, but the story never shows it: give story.world.props' ${id} the bible's cue ({"at": ${JSON.stringify(cue.at)}, "state": "${cue.state}"}), or cue it in the scene where it happens (params.props: [{"id": "${id}", "cues": [{"at": …, "state": "${cue.state}"}]}])`);
    }
  }
  return findings;
}

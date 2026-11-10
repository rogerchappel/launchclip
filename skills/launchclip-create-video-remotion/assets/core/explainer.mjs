// A short explainer is carried by characters, not by diagrams.
//
// A one-prompt explainer with nothing to show (no footage, no product
// screens) used to come out as line diagrams, rows of dots and text cards:
// correct, and nobody watches it. The kit has characters (people, animals,
// mascots, objects with faces: kit/core/characters/), expressions and acting,
// so the director's default for an explainer is a small recurring cast that
// carries the idea: the subject itself as an object with a face, its parts or
// forces as mascots, acting and reacting on the narration's words, with
// diagrams and cards as support.
//
// This module is the rule in one place:
//
//   explainerDirectionLines()        the casting brief for the direction map
//   castFromDirection(map)           the cast the map chose, as a story cast
//   defaultExplainerCast()           the cast when the map chose none
//   explainerStoryboardLines(cast)   the scene rules for the storyboard
//   characterErrors(story, …)        characters on screen for most of the video
//   openingErrors(story)             the opening image is whole on frame 0
//   abstractFindings(story)          a video of only diagrams and text cards
//   explainerTone / explainerLook    the seeded style's defaults for one
//
// Honest evidence: a character illustrates what the narration says. It never
// says, shows or labels a claim the script does not make.
import { STARTER_CAST, starterCharacter } from './characters/cast.mjs';
import { KINDS, KIND_NAMES, isFourLegged } from './characters/kinds.mjs';
import { normalizeRigParams } from './characters/rig.mjs';

/** The share of the runtime a character is on screen for, at least. */
export const EXPLAINER_CHARACTER_SHARE = 0.5;
/** The longest a cast-scene holds in a portrait frame (the density gate's empty-region limit). */
export const CAST_SCENE_SECONDS = 4;
/** The most characters an explainer casts. */
export const EXPLAINER_CAST_MAX = 3;
/** The drawing style an explainer's cast is drawn in. */
export const EXPLAINER_CAST_STYLE = 'chibi';
/** Scene modules that put a character on screen. */
export const CHARACTER_SCENE_MODULES = Object.freeze(['cast-scene', 'character-cameo', 'sprite-scene']);
/** Line and node diagrams: a sketch of lines, or dots joined in a row. */
export const DIAGRAM_MODULES = Object.freeze(['line-diagram', 'process-steps', 'step-rail', 'focus-flow', 'flow-compare', 'compare', 'timeline', 'number-line', 'lineage-graph', 'feynman-diagram', 'doodle-outline', 'icon-row', 'icon-grid', 'checklist']);
/** Cards that are only words. */
export const TEXT_CARD_MODULES = Object.freeze(['hook-title', 'kinetic-words', 'motion-title', 'section-card', 'concept-card', 'glass-word', 'emphasis-caption', 'callout', 'quote-card', 'cta', 'subscribe-cta', 'masthead']);
/** Diagrams and particle pieces that draw themselves from an empty plate: frame 0 of one is (nearly) blank. Title cards are the hook check's (src/short_form_checks.js). */
export const SELF_DRAWING_MODULES = Object.freeze(['line-diagram', 'doodle-outline', 'feynman-diagram', 'particle-text', 'particle-logo', 'particle-cloud']);
/** A video this long or longer, with this many scenes, is held to the abstract-only rule. */
export const ABSTRACT_ONLY = Object.freeze({ seconds: 15, scenes: 5 });

// The kinds an explainer may cast: everything upright (four-legged animals need a wide frame).
const CASTABLE_KINDS = KIND_NAMES.filter((name) => !isFourLegged(name));
// A few of the starter people, for a topic about people (the full list: launchclip cast list).
const CASTABLE_PEOPLE = STARTER_CAST.filter((entry) => !entry.params.kind).slice(0, 12);
const ID = /^[a-z][a-z0-9-]{0,23}$/;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const round2 = (value) => Math.round(value * 100) / 100;

/** The cast when the direction map chose none: a guide and a sidekick in the palette's colours. */
export function defaultExplainerCast() {
  return {
    style: EXPLAINER_CAST_STYLE,
    characters: [{ id: 'guide', name: 'Guide', kind: 'blob' }, { id: 'spark', name: 'Spark', kind: 'blob', size: 'small', colors: { body: 'accent', accent: 'primary' } }],
    roles: [{ id: 'guide', plays: 'the idea being explained' }, { id: 'spark', plays: 'the curious viewer, who asks and reacts' }]
  };
}

/**
 * The casting brief for the direction map (the planner's first call): the
 * model casts one to three characters for the idea, as the map's `cast`.
 */
export function explainerDirectionLines() {
  const group = (name) => CASTABLE_KINDS.filter((kind) => KINDS[kind].group === name).map((kind) => `${kind} (${KINDS[kind].describe.replace(/^an? /, '')})`).join('; ');
  return [
    'This is an explainer with no footage to show, so characters carry it: a small recurring cast acts out the idea on the narration\'s words, and diagrams and cards support them. A video of only diagrams, dot rows and text cards fails the checks.',
    'Cast one to three characters as the map\'s top-level cast: {"characters": [{"id", "kind", "plays", "name"?, "size"?, "colors"?}]}. Make the subject itself a character (the thing being explained, as an object with a face) and give its parts, causes or forces a mascot each. For "why it rains": {"cast": {"characters": [{"id": "cloud", "kind": "cloud", "plays": "the rain cloud"}, {"id": "drop", "kind": "droplet", "plays": "the water that falls and comes back", "size": "small"}]}}. A kind can stand for something close to it: a recoloured cup is a jar, a pot or a bottle; a blob or a monster is a germ, a cell or an ingredient.',
    'Cast for the idea, not for decoration: every character plays something the narration names, and the story is what happens between them.',
    'id: a short lowercase name for the part it plays ("cloud", "drop"); the storyboard names characters by it. plays: what it stands for in this video, in a few words. name: its name on a cast list (optional).',
    `kind, objects: ${group('object')}.`,
    `kind, mascots (drawn in the palette's colours unless you set colors): ${group('mascot')}.`,
    `kind, animals: ${group('animal')}.`,
    'size: small | medium | large (a sidekick is small). colors: {body?, detail?, accent?}, each "#rrggbb" or primary | accent | paper, to make a kind read as your subject and to tell two of the same kind apart.',
    `For a topic about people, a character may be a starter person instead: {"id": "<starter id>", "starter": "<starter id>", "plays"}, one of ${CASTABLE_PEOPLE.map((entry) => `${entry.id} (${entry.summary})`).join('; ')}.`,
    'Every line is dress or insert. In each line\'s why, say what a character does to show the line: who, the action, the feeling ("the cloud shrugs, confused"; "the drop cheers as it lands"). Do not write line cast cues or actions here: the storyboard acts them.',
    'Give the cast most of the lines. Hand a line to a diagram, a chart or a card only when it shows something a character cannot (how parts fit together, a number, a list); never two such lines in a row.',
    'Honest evidence: a character illustrates what the narration says. It never states, shows or labels a fact, a number or a quote the script does not have.'
  ];
}

/**
 * The cast a direction map chose, as a story cast.
 * → {cast: {style, characters}, roles: [{id, plays}], dropped: [reason]} | null
 * A character the kit cannot draw is dropped (with the reason); a map with no
 * usable character gives null.
 */
export function castFromDirection(map) {
  const listed = isObject(map?.cast) && Array.isArray(map.cast.characters) ? map.cast.characters : Array.isArray(map?.cast) ? map.cast : [];
  const characters = [];
  const roles = [];
  const dropped = [];
  for (const entry of listed) {
    if (characters.length >= EXPLAINER_CAST_MAX) { dropped.push(`${entry?.id ?? '(unnamed)'}: an explainer casts at most ${EXPLAINER_CAST_MAX}`); continue; }
    if (!isObject(entry)) continue;
    const plays = typeof entry.plays === 'string' && entry.plays.trim() ? entry.plays.trim().slice(0, 120) : null;
    if (typeof entry.starter === 'string' || (entry.kind === undefined && typeof entry.id === 'string' && starterCharacter(entry.id))) {
      const starter = starterCharacter(entry.starter ?? entry.id);
      if (!starter) { dropped.push(`${entry.id ?? entry.starter}: "${entry.starter}" is not a starter character`); continue; }
      if (characters.some((member) => member.id === starter.id)) continue;
      characters.push({ id: starter.id });
      roles.push({ id: starter.id, plays: plays ?? starter.summary ?? starter.name });
      continue;
    }
    const id = String(entry.id ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!ID.test(id) || characters.some((member) => member.id === id)) { dropped.push(`${entry.id ?? '(unnamed)'}: an id is a short lowercase name, used once`); continue; }
    if (!CASTABLE_KINDS.includes(entry.kind)) { dropped.push(`${id}: kind "${entry.kind}" is not one an explainer casts`); continue; }
    const member = { id, name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim().slice(0, 24) : id.charAt(0).toUpperCase() + id.slice(1), kind: entry.kind };
    if (['small', 'medium', 'large'].includes(entry.size) && entry.size !== 'medium') member.size = entry.size;
    if (isObject(entry.colors)) {
      const colors = Object.fromEntries(Object.entries(entry.colors).filter(([slot, value]) => ['body', 'detail', 'accent'].includes(slot) && typeof value === 'string'));
      if (Object.keys(colors).length && drawable({ ...member, colors })) member.colors = colors;
    }
    if (!drawable(member)) { dropped.push(`${id}: the kit cannot draw it as described`); continue; }
    characters.push(member);
    roles.push({ id, plays: plays ?? KINDS[entry.kind].describe });
  }
  return characters.length ? { cast: { style: EXPLAINER_CAST_STYLE, characters }, roles, dropped } : null;
}

function drawable(member) {
  const { id, name, ...params } = member;
  try { normalizeRigParams(params, `cast ${id}`); return true; } catch { return false; }
}

const describeMember = (member, roles) => {
  const starter = member.kind ? null : starterCharacter(member.id);
  const look = member.kind ? `${KINDS[member.kind].describe}${member.size ? `, ${member.size}` : ''}` : starter ? `${starter.name}, ${starter.summary}` : 'a person';
  const plays = roles.find((role) => role.id === member.id)?.plays;
  return `"${member.id}" (${look})${plays ? ` plays ${plays}` : ''}`;
};

/**
 * The scene rules for the storyboard of a character-led explainer.
 * explainer: {cast: {style, characters}, roles}.
 */
export function explainerStoryboardLines(explainer) {
  const members = explainer?.cast?.characters ?? [];
  const roles = explainer?.roles ?? [];
  const short = members.some((member) => member.kind);
  return [
    `Characters carry this explainer: ${members.map((member) => describeMember(member, roles)).join('; ')}. story.cast is fixed and tooling writes it; name characters by these ids only.`,
    `A character is on screen for at least ${Math.round(EXPLAINER_CHARACTER_SHARE * 100)}% of the runtime (the check measures it), and the same characters come back through the video: the viewer follows them from the question to the answer.`,
    'The scene to reach for is character-cameo: one character, large, beside a card (kicker, title, body) that carries the line\'s few words. It is a full scene on its own: no world or panel under it, no track. In 9:16 frame most cameos "medium" or "close" (shot): the character is larger and the captions sit over its body, never across its feet.',
    `Put two or three of them together in a cast-scene for the moments they meet, disagree or celebrate${short ? ': set "standing" with shot "medium" or "close" (objects, mascots and animals are short, and the furniture sets are built for people and hide them)' : ''}. A cast-scene draws its own world; do not add a world scene under it. In 9:16 a cast-scene ends within 4 s (longer leaves the top of the frame empty and fails the density gate); cameos carry the longer lines.`,
    'Shapes: {"id": "s1", "module": "character-cameo", "start": 0, "end": "word:<text>", "energy": 2, "params": {"character": "<id>", "pose": "shrug", "expression": "confused", "card": {"kicker": "<2 words>", "title": "<the line in 3–7 words>"}, "cues": [{"at": "word:<text>", "pose": "think", "expression": "thinking"}]}} and {"id": "s4", "module": "cast-scene", "start": "word:<text>", "end": "word:<text>", "energy": 2, "params": {"set": "standing", "shot": "medium", "cast": [{"id": "<id>", "pose": "wave", "expression": "happy", "cues": [{"at": "word:<text>", "pose": "cheer", "expression": "delighted"}]}, {"id": "<id>", "pose": "arms-crossed", "expression": "smirk"}]}}. A cue\'s word is one spoken while its scene is on screen.',
    'They act, they do not stand there: pose and expression say the line\'s feeling (confused at the question, surprised at the turn, delighted at the payoff), and every character scene has cues on the narration\'s words ({"at": "word:<text>", "pose", "expression"}) so something changes about every 1.5 s. No two character scenes in a row share the same character, pose and framing.',
    'The opening scene is a character scene from 0 s (a character-cameo whose card title is the hook in 6–8 words): a character is drawn whole on frame 0. Never open on a module that draws itself from an empty plate (line-diagram, doodle-outline, feynman-diagram, a particle piece).',
    'Diagrams, charts and cards support the cast: use one where it shows what a character cannot (how parts fit together, a number, the steps in order), never two in a row, and never as the whole video.',
    'Reading time: a card is fully shown for its scene minus about 0.8 s, and needs 0.22 s a word (at least 1.2 s). A 3 s scene holds 10 words at most, a 2.5 s scene 7: count title, body, labels and steps together, and cut words or split the scene rather than go over.',
    'Honest evidence: a character illustrates what the narration says. No card, label or speech bubble states a fact, a number or a quote the script does not have, and a character never speaks lines of its own.'
  ];
}

// The seconds a resolved story's scenes of the given modules cover on screen (overlaps counted once).
function coveredSeconds(scenes, modules) {
  const spans = scenes.filter((scene) => modules.includes(scene?.module) && Number.isFinite(Number(scene.start)) && Number.isFinite(Number(scene.end))).map((scene) => [Number(scene.start), Number(scene.end)]).sort((a, b) => a[0] - b[0]);
  let total = 0, cursor = -Infinity;
  for (const [start, end] of spans) {
    if (end <= cursor) continue;
    total += end - Math.max(start, cursor);
    cursor = end;
  }
  return total;
}

const durationOf = (story) => Number(story?.resolved?.duration ?? story?.format?.duration) || 0;
const scenesOf = (story) => (Array.isArray(story?.scenes) ? story.scenes.filter(isObject) : []);
const plates = (story) => scenesOf(story).filter((scene) => (scene.track ?? 0) === 0 && scene.insert !== true).sort((a, b) => Number(a.start) - Number(b.start));

/** The share of a resolved story's runtime with a character on screen. → {share, seconds, duration} */
export function characterShare(story) {
  const duration = durationOf(story);
  const seconds = coveredSeconds(scenesOf(story), CHARACTER_SCENE_MODULES);
  return { share: duration > 0 ? round2(seconds / duration) : 0, seconds: round2(seconds), duration: round2(duration) };
}

/**
 * A character-led explainer's storyboard (resolved: numeric scene times):
 * characters on screen for most of it, and from its first frame.
 * → ["characters: …"]
 */
export function characterErrors(story, { cast = null, share = EXPLAINER_CHARACTER_SHARE } = {}) {
  const errors = [];
  const ids = (cast?.characters ?? []).map((member) => member.id);
  const who = ids.length ? ids.join(', ') : 'the cast';
  const measured = characterShare(story);
  if (measured.duration > 0 && measured.share < share - 1e-6) {
    errors.push(`characters: a character is on screen for ${Math.round(measured.share * 100)}% of the video (${measured.seconds} of ${measured.duration} s); an explainer needs one for at least ${Math.round(share * 100)}%. Replace diagram and card scenes with character-cameo scenes (${who} beside a card that carries the line's words) or a cast-scene, acting the line with pose and expression cues`);
  }
  // In 9:16 a cast-scene leaves the top third of the frame to its plate, and the density gate fails that after 4 s.
  if (Number(story?.format?.height) > Number(story?.format?.width)) {
    for (const scene of plates(story)) {
      const seconds = Number(scene.end) - Number(scene.start);
      if (scene.module === 'cast-scene' && seconds > CAST_SCENE_SECONDS + 1e-6) errors.push(`characters: ${scene.id} (cast-scene) holds for ${round2(seconds)} s; in 9:16 the top third of the frame is only its plate, and the density gate fails that after ${CAST_SCENE_SECONDS} s. End it within ${CAST_SCENE_SECONDS} s and give the rest of the line to a character-cameo (a character beside a card)`);
    }
  }
  const first = plates(story)[0];
  if (first && !CHARACTER_SCENE_MODULES.includes(first.module)) {
    errors.push(`characters: the opening scene ${first.id} (${first.module}) has no character; open on a character-cameo from 0 s whose card title is the hook, so the viewer meets ${ids[0] ?? 'the character'} on the first frame`);
  }
  return errors;
}

/**
 * The opening image is drawn on frame 0 (the structure gate measures the
 * render): a module that draws itself from an empty plate cannot open the
 * video. Stories over a recording open on the recording. → ["opening: …"]
 */
export function openingErrors(story) {
  if (story?.base) return [];
  const first = plates(story)[0];
  if (!first || Number(first.start) > 0.05 || !SELF_DRAWING_MODULES.includes(first.module)) return [];
  return [`opening: ${first.id} (${first.module}) draws itself from an empty plate, so frame 0 of the video is blank; open on an image that is whole on the first frame (a character scene, a photo, an object, a number) and let the ${first.module} follow it`];
}

/**
 * A video made only of line diagrams, dot rows and text cards, with nothing
 * pictured: no character, photo, footage, object, chart or interface in any
 * scene. Held for a story of ABSTRACT_ONLY.seconds or longer with
 * ABSTRACT_ONLY.scenes scenes or more. story: resolved.
 * → {abstract: boolean, diagrams, cards, scenes, modules}
 */
export function abstractFindings(story) {
  const scenes = plates(story);
  const diagrams = scenes.filter((scene) => DIAGRAM_MODULES.includes(scene.module));
  const cards = scenes.filter((scene) => TEXT_CARD_MODULES.includes(scene.module));
  const pictured = scenesOf(story).some((scene) => !DIAGRAM_MODULES.includes(scene.module) && !TEXT_CARD_MODULES.includes(scene.module));
  const held = !story?.base && durationOf(story) >= ABSTRACT_ONLY.seconds && scenes.length >= ABSTRACT_ONLY.scenes;
  return { abstract: held && !pictured && diagrams.length > 0, diagrams: diagrams.length, cards: cards.length, scenes: scenes.length, modules: [...new Set(scenes.map((scene) => scene.module))] };
}

/** abstractFindings as a planner error. → ["variety: …"] */
export function abstractErrors(story) {
  const found = abstractFindings(story);
  if (!found.abstract) return [];
  return [`variety: all ${found.scenes} scenes are line diagrams, step rows and text cards (${found.modules.join(', ')}), with nothing pictured; show the subject: a character acting the line (character-cameo, cast-scene), an object, a photo, a chart of real figures or an interface, and keep diagrams as support`];
}

// ---------------------------------------------------------------------------
// The seeded style of an explainer (docs/SEEDED_STYLES_RFC.md): a bare prompt
// names no tone, and the seed's neutral range reaches down to dull, tinted
// palettes. An explainer with no tone words is playful (a lively palette, a
// playful motion grammar); a topic the looks kit suits takes its look.

/** The tone an explainer's seeded style takes when the prompt names none. */
export const EXPLAINER_TONE = 'playful';

// Topic words → a whole-scene look (kit/core/look.mjs). Only where the look
// is the topic's own picture; everything else keeps the style's plain look.
export const EXPLAINER_LOOKS = Object.freeze([
  ['blueprint', ['\\bblueprints?\\b', '\\bengines?\\b', '\\bbridges?\\b', '\\bgears?\\b', '\\bturbines?\\b', '\\bhow (?:a|an|the) [a-z -]{0,24}(?:engine|motor|machine|pump|lock|clock|transmission|elevator|lift) works?\\b', '\\barchitect', '\\bmechanical\\b']],
  ['neon-night', ['\\bcyberpunk\\b', '\\bnightlife\\b', '\\barcades?\\b', '\\bsynthwave\\b']],
  ['thermal', ['\\binfrared\\b', '\\bheat loss\\b', '\\binsulation\\b', '\\bthermal\\b']],
  ['hologram', ['\\bholograms?\\b', '\\bsci-?fi\\b', '\\bspaceships?\\b']],
  ['ascii-terminal', ['\\bcommand line\\b', '\\bterminal\\b', '\\bunix\\b', '\\bshell scripts?\\b']],
  ['paper-cutout', ['\\bfolk ?tales?\\b', '\\bfairy ?tales?\\b', '\\bfor kids\\b', '\\bfor children\\b', '\\bpaper\\b', '\\borigami\\b']],
  ['watercolour', ['\\bgardens?\\b', '\\bgardening\\b', '\\bflowers?\\b', '\\bseasons?\\b', '\\bwatercolou?r\\b', '\\bbotan']]
].map(([look, words]) => Object.freeze([look, Object.freeze(words)])));

/** The whole-scene look an explainer's topic suits, or null (most topics: none). */
export function explainerLook(text) {
  const value = String(text ?? '');
  for (const [look, words] of EXPLAINER_LOOKS) if (words.some((source) => new RegExp(source, 'i').test(value))) return look;
  return null;
}

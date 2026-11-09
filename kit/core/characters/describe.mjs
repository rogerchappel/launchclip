// A plain description to character set paths, with no model: words are
// matched against the rig's own option lists (rig.mjs, palette.mjs,
// styles.mjs), so a new hair style or top is understood the day it lands.
//
//   describeCharacter("a tall woman with silver locs, round glasses and a
//                      red blazer", {seed: "nova"})
//   → {sets: [{path, op, value, from}], voice, assumed, unmatched}
//
// How it reads:
//   - Every option name is a phrase ("lab-coat" reads as "lab coat"); the
//     longest phrase wins, left to right. A small synonym table adds everyday
//     words (t-shirt, jeans, dreadlocks, hijab, specs); a synonym whose
//     option the rig no longer has is dropped.
//   - A colour belongs to the thing it sits before: "red hoodie" is the top's
//     colour, "silver bob" the hair's, "deep skin" the skin's.
//   - "no", "without", "remove", "instead of", "swap the …" before a thing
//     take it off (an accessory, headwear, a layer, a mobility aid) or leave
//     it out.
//   - "taller", "shorter", "older", "younger" step from the current value.
//   - Words for a woman or a man choose only the voice. A reference to a real
//     person is not understood: describe traits.
//
// newCharacterDefaults(seed) fills what a description leaves out (skin, hair,
// a voice), the same for the same seed, and says so in `assumed`.
//
// Imports only sibling kit/core files.

import {ACCESSORIES, AGES, BOTTOMS, BUILDS, HAIR_STYLES, HEADWEAR, HEIGHTS, HEIGHT_SCALE, MOBILITY, OVERS, TOPS} from './rig.mjs';
import {BRAND_ROLES, GREY_HAIR, HAIR_COLORS, NEUTRALS, SKIN_ORDER, SKIN_TONES} from './palette.mjs';
import {DRAWING_STYLES} from './styles.mjs';
import {KOKORO_VOICES} from './cues.mjs';
import {makeRng} from './generate.mjs';

const words = name => name.split(/[-\s]+/);
const key = tokens => tokens.join(' ');

// Everyday words for rig options: phrase → sets. Checked against the live
// lists in lexicon(), so an entry never names an option the rig lacks.
const SYNONYMS = {
  // build
  thin: {build: 'slim'}, skinny: {build: 'slim'}, slender: {build: 'slim'},
  muscular: {build: 'athletic'}, sporty: {build: 'athletic'},
  'broad shouldered': {build: 'broad'},
  chubby: {build: 'round'}, plump: {build: 'round'}, heavyset: {build: 'round'},
  'average build': {build: 'average'}, 'medium build': {build: 'average'},
  // height
  'average height': {height: 'average'}, 'medium height': {height: 'average'}, tiny: {height: 'very-short'}, towering: {height: 'very-tall'}, 'really tall': {height: 'very-tall'}, 'really short': {height: 'very-short'},
  // age
  kid: {age: 'child'}, boy: {age: 'child'}, girl: {age: 'child'}, toddler: {age: 'child'},
  teenager: {age: 'teen'}, teenage: {age: 'teen'}, adolescent: {age: 'teen'},
  elderly: {age: 'senior'}, old: {age: 'senior'}, retired: {age: 'senior'}, grandmother: {age: 'senior'}, grandfather: {age: 'senior'}, grandma: {age: 'senior'}, grandpa: {age: 'senior'}, pensioner: {age: 'senior'},
  'grown up': {age: 'adult'}, 'middle aged': {age: 'adult'},
  // hair
  dreadlocks: {'hair.style': 'locs'}, dreads: {'hair.style': 'locs'}, 'buzz cut': {'hair.style': 'buzz'}, buzzcut: {'hair.style': 'buzz'}, shaved: {'hair.style': 'buzz'}, 'crew cut': {'hair.style': 'buzz'},
  'side part': {'hair.style': 'sidepart'}, 'side parting': {'hair.style': 'sidepart'}, 'pony tail': {'hair.style': 'ponytail'}, braid: {'hair.style': 'braids'}, braided: {'hair.style': 'braids'}, plaits: {'hair.style': 'braids'},
  'shoulder length': {'hair.style': 'shoulder'}, 'top knot': {'hair.style': 'topknot'}, 'man bun': {'hair.style': 'topknot'}, receding: {'hair.style': 'balding'}, 'pixie cut': {'hair.style': 'pixie'},
  hijab: {'hair.style': 'headscarf'}, 'head scarf': {'hair.style': 'headscarf'}, curls: {'hair.style': 'curly'}, waves: {'hair.style': 'wavy'}, spiked: {'hair.style': 'spiky'}, 'corn rows': {'hair.style': 'cornrows'},
  // tops and bottoms
  't shirt': {'outfit.top': 'tee'}, tshirt: {'outfit.top': 'tee'}, 'button up': {'outfit.top': 'shirt'}, 'button down': {'outfit.top': 'shirt'}, blouse: {'outfit.top': 'shirt'},
  hoody: {'outfit.top': 'hoodie'}, sweatshirt: {'outfit.top': 'hoodie'}, suit: {'outfit.top': 'blazer'}, 'suit jacket': {'outfit.top': 'blazer'}, jumper: {'outfit.top': 'sweater'}, pullover: {'outfit.top': 'sweater'},
  'polo shirt': {'outfit.top': 'polo'}, 'tank top': {'outfit.top': 'tank'}, vest: {'outfit.over': 'vest'}, 'roll neck': {'outfit.top': 'turtleneck'}, 'polo neck': {'outfit.top': 'turtleneck'},
  overcoat: {'outfit.top': 'coat'}, 'white coat': {'outfit.top': 'lab-coat'}, 'chef whites': {'outfit.top': 'chef-coat'},
  pants: {'outfit.bottom': 'trousers'}, slacks: {'outfit.bottom': 'trousers'}, chinos: {'outfit.bottom': 'trousers', 'colors.bottom': 'khaki'}, jeans: {'outfit.bottom': 'trousers', 'colors.bottom': 'denim'},
  'maxi skirt': {'outfit.bottom': 'long-skirt'}, tights: {'outfit.bottom': 'leggings'},
  'high vis': {'outfit.over': 'hi-vis'}, 'hi viz': {'outfit.over': 'hi-vis'}, 'safety vest': {'outfit.over': 'hi-vis'}, waistcoat: {'outfit.over': 'vest'},
  // accessories
  specs: {'accessories+': 'glasses'}, spectacles: {'accessories+': 'glasses'}, eyeglasses: {'accessories+': 'glasses'}, shades: {'accessories+': 'sunglasses'},
  'cat eye glasses': {'accessories+': 'cat-eye-glasses'}, mustache: {'accessories+': 'moustache'}, bearded: {'accessories+': 'beard'}, 'full beard': {'accessories+': 'beard'}, unshaven: {'accessories+': 'stubble'},
  earring: {'accessories+': 'earrings'}, freckled: {'accessories+': 'freckles'}, 'hearing aids': {'accessories+': 'hearing-aid'}, 'bow tie': {'accessories+': 'bowtie'}, necktie: {'accessories+': 'tie'},
  rucksack: {'accessories+': 'backpack'}, 'shoulder bag': {'accessories+': 'crossbody-bag'}, satchel: {'accessories+': 'crossbody-bag'}, bag: {'accessories+': 'crossbody-bag'}, 'nose ring': {'accessories+': 'nose-stud'}, 'nose piercing': {'accessories+': 'nose-stud'},
  badge: {'accessories+': 'lanyard'},
  // headwear
  'baseball cap': {headwear: 'cap'}, hat: {headwear: 'cap'}, 'sun hat': {headwear: 'sunhat'}, 'woolly hat': {headwear: 'beanie'}, yarmulke: {headwear: 'kippah'}, helmet: {headwear: 'bike-helmet'}, 'cycling helmet': {headwear: 'bike-helmet'},
  'graduation cap': {headwear: 'grad-cap'}, mortarboard: {headwear: 'grad-cap'}, 'scrub cap': {headwear: 'surgical-cap'}, headset: {headwear: 'headphones'},
  // mobility
  'wheelchair user': {mobility: 'wheelchair'}, 'walking stick': {mobility: 'cane'}, crutch: {mobility: 'forearm-crutch'}, crutches: {mobility: 'forearm-crutch'}, 'artificial leg': {mobility: 'prosthetic-leg'}, 'artificial arm': {mobility: 'prosthetic-arm'},
  // roles: the clothes that say the job
  doctor: {'outfit.top': 'lab-coat', 'accessories+': 'stethoscope'}, scientist: {'outfit.top': 'lab-coat'}, nurse: {'outfit.top': 'scrubs'}, surgeon: {'outfit.top': 'scrubs', headwear: 'surgical-cap'},
  chef: {'outfit.top': 'chef-coat', headwear: 'chef-hat'}, cook: {'outfit.top': 'chef-coat', 'outfit.over': 'apron'}, barista: {'outfit.over': 'apron'},
  builder: {headwear: 'hard-hat', 'outfit.over': 'hi-vis'}, 'construction worker': {headwear: 'hard-hat', 'outfit.over': 'hi-vis'}, cyclist: {headwear: 'bike-helmet'}, graduate: {headwear: 'grad-cap'}
};

// Colour words by what they colour. Palette names are added in colourTable().
const CLOTH_WORDS = {blue: 'denim', green: 'forest', yellow: 'mustard', purple: 'plum', pink: 'rose', orange: 'tangerine', grey: 'slate', gray: 'slate', brown: 'tan', beige: 'sand', gold: 'ochre', violet: 'lavender', turquoise: 'teal', maroon: 'burgundy'};
const HAIR_WORDS = {blond: 'blonde', ginger: 'copper', red: 'auburn', gray: 'grey', white: 'snow', pink: 'pink-dye', blue: 'blue-dye', purple: 'violet-dye', violet: 'violet-dye', green: 'green-dye', dark: 'espresso', golden: 'honey', greying: 'grey', graying: 'grey'};
const SKIN_WORDS = {dark: 'deep', pale: 'porcelain', olive: 'tan', white: 'fair', black: 'ebony', tanned: 'tan', freckled: 'fair'};

function colourTable(names, extra, valid) {
  const out = {};
  for (const [word, value] of Object.entries(extra)) if (valid.includes(value)) out[word] = value;
  for (const name of names) for (const part of [name, key(words(name))]) out[part] = name;
  return out;
}

const HAIR_ANCHORS = ['hair', 'haired', 'hairstyle', 'haircut'];
const SKIN_ANCHORS = ['skin', 'skinned', 'complexion'];
const SHOE_ANCHORS = ['shoes', 'sneakers', 'trainers', 'boots', 'footwear'];
const SKIP = ['the', 'a', 'an', 'his', 'her', 'their', 'its', 'my', 'any', 'some', 'that', 'those', 'these'];
const NEGATE_1 = ['no', 'not', 'without', 'remove', 'removes', 'removing', 'lose', 'loses', 'drop', 'drops', 'ditch', 'minus', 'swap', 'replace', 'change', 'lost', 'removed'];
const NEGATE_2 = ['instead of', 'take off', 'takes off', 'rid of', 'rather than', 'get rid'];
const F_WORDS = ['woman', 'female', 'girl', 'she', 'lady', 'mother', 'mum', 'mom', 'grandma', 'grandmother', 'aunt', 'sister', 'daughter', 'businesswoman'];
const M_WORDS = ['man', 'male', 'boy', 'he', 'guy', 'father', 'dad', 'grandpa', 'grandfather', 'uncle', 'brother', 'son', 'businessman'];
const STOP = new Set([...SKIP, 'with', 'and', 'in', 'on', 'of', 'who', 'is', 'has', 'wears', 'wearing', 'wear', 'for', 'to', 'make', 'give', 'add', 'put', 'them', 'him', 'it', 'they', 'very', 'more', 'bit', 'little', 'pair', 'style', 'drawn', 'drawing', 'person', 'character', 'colour', 'color', 'coloured', 'colored', 'into', 'as', 'at', 'by', 'from', 'that', 'this', 'are', 'be', 'but', 'so', 'also', 'too', 'now', 'please', 'looking', 'look', 'looks', 'old', 'year', 'years', 'something', 'length', 'cut', 'build', 'height', 'voice', 'accent', 'british', 'english', 'american', ...HAIR_ANCHORS, ...SKIN_ANCHORS, ...SHOE_ANCHORS, ...F_WORDS, ...M_WORDS, ...NEGATE_1]);

/** phrase → {sets: [[path, value]], kind}; the option lists first, then the synonyms that still fit them. */
function lexicon() {
  const lists = {build: BUILDS, height: HEIGHTS, age: AGES, 'hair.style': HAIR_STYLES, 'outfit.top': TOPS, 'outfit.bottom': BOTTOMS, 'outfit.over': OVERS, 'accessories+': ACCESSORIES, headwear: HEADWEAR, mobility: MOBILITY};
  const out = new Map();
  const add = (phrase, sets) => { if (!out.has(phrase)) out.set(phrase, sets); };
  for (const [path, names] of Object.entries(lists)) {
    for (const name of names) {
      // "average" alone says nothing; "short" and "long" alone are a height or nothing (hair needs the word hair).
      if (['average', 'short', 'long'].includes(name)) continue;
      add(key(words(name)), [[path, name]]);
    }
  }
  for (const name of DRAWING_STYLES) for (const phrase of [`${key(words(name))} style`, `style ${key(words(name))}`, `${key(words(name))} drawing`]) add(phrase, [['style', name]]);
  for (const voice of KOKORO_VOICES) add(voice, [['voice', voice]]);
  // "a 30 year old" is an age in years, not a senior.
  for (const phrase of ['year old', 'years old']) add(phrase, []);
  for (const [phrase, sets] of Object.entries(SYNONYMS)) {
    const entries = Object.entries(sets);
    const fits = entries.every(([path, value]) => (path === 'colors.bottom' ? Object.hasOwn(NEUTRALS, value) : lists[path]?.includes(value)));
    if (fits) add(phrase, entries);
  }
  return out;
}

const tokenize = text => [...String(text ?? '').matchAll(/#[0-9a-fA-F]{6}\b|[\p{L}\p{N}_]+/gu)].map(match => ({text: match[0].toLowerCase(), proper: /^\p{Lu}\p{Ll}/u.test(match[0]) && match.index > 0 && !/[.!?]\s*$/.test(String(text).slice(0, match.index))}));

/**
 * Set paths for a description or an edit instruction. current: the
 * character's params now (for "taller", "older" and for taking things off).
 * → {sets: [{path, op, value, from}], voice: "f" | "m" | null,
 *    accent: "a" | "b" | null, unmatched: [words nothing understood]}
 */
export function describeCharacter(text, {current = null} = {}) {
  const tokens = tokenize(text);
  const lex = lexicon();
  const longest = Math.max(1, ...[...lex.keys()].map(phrase => phrase.split(' ').length));
  const claimed = new Array(tokens.length).fill(false);
  const cloth = colourTable([...Object.keys(NEUTRALS), ...BRAND_ROLES], CLOTH_WORDS, [...Object.keys(NEUTRALS), ...BRAND_ROLES]);
  const hair = colourTable(Object.keys(HAIR_COLORS), HAIR_WORDS, Object.keys(HAIR_COLORS));
  const skin = colourTable(Object.keys(SKIN_TONES), SKIN_WORDS, Object.keys(SKIN_TONES));
  const isHex = word => /^#[0-9a-f]{6}$/.test(word);
  const sets = [];
  const push = (at, path, value, from, op = '=') => sets.push({at, path, op, value, from});

  // Is the thing starting at token i being taken off?
  const negated = i => {
    let k = i - 1;
    while (k >= 0 && SKIP.includes(tokens[k].text)) k--;
    if (k < 0) return false;
    if (NEGATE_1.includes(tokens[k].text)) return true;
    return k > 0 && NEGATE_2.includes(`${tokens[k - 1].text} ${tokens[k].text}`);
  };
  // Colours and hair words standing right before an anchor at token i.
  const adjectives = (i, table, {styles = false, to, from}) => {
    for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
      const word = tokens[k].text;
      if (claimed[k]) break;
      // "long silver hair": two words can name one colour ("pink dye"); try the pair first.
      const pair = k > 0 && !claimed[k - 1] ? `${tokens[k - 1].text} ${word}` : null;
      if (pair && table[pair]) { push(i + 0.5 + k / 1000, to, table[pair], pair); claimed[k] = claimed[k - 1] = true; k--; continue; }
      if (table[word] || isHex(word)) { push(i + 0.5 + k / 1000, to, table[word] ?? word, word); claimed[k] = true; continue; }
      if (styles && HAIR_STYLES.includes(word)) { push(i + 0.5 + k / 1000, 'hair.style', word, `${word} ${from}`); claimed[k] = true; continue; }
      if (['very', 'and', 'light', 'bright', 'dark', 'deep'].includes(word)) continue;
      break;
    }
  };

  // 1. Phrases, longest first.
  const found = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].proper) continue;
    for (let n = Math.min(longest, tokens.length - i); n >= 1; n--) {
      const phrase = tokens.slice(i, i + n).map(token => token.text).join(' ');
      const entry = lex.get(phrase) ?? (n === 1 && phrase.length > 3 && phrase.endsWith('s') ? lex.get(phrase.slice(0, -1)) : null);
      if (!entry) continue;
      found.push({at: i, n, phrase, entry});
      for (let k = i; k < i + n; k++) claimed[k] = true;
      i += n - 1;
      break;
    }
  }
  // 2. Each phrase becomes sets; colours before it bind to it.
  for (const {at, phrase, entry} of found) {
    const off = negated(at);
    for (const [path, value] of entry) {
      if (path === 'accessories+') push(at, 'accessories', value, phrase, off ? '-=' : '+=');
      else if (off) { if (['headwear', 'mobility', 'outfit.over'].includes(path)) push(at, path, 'none', `no ${phrase}`); }
      else push(at, path, value, phrase);
    }
    if (off) continue;
    const paths = entry.map(([path]) => path);
    if (paths.includes('hair.style')) adjectives(at, entry.some(([, value]) => value === 'headscarf') ? {...hair, ...cloth} : hair, {to: 'hair.color', from: phrase});
    else if (paths.includes('outfit.top')) adjectives(at, cloth, {to: 'colors.top', from: phrase});
    else if (paths.includes('outfit.bottom')) adjectives(at, cloth, {to: 'colors.bottom', from: phrase});
    else if (paths.includes('outfit.over')) adjectives(at, cloth, {to: 'colors.accent', from: phrase});
  }
  // 3. The plain anchors: hair, skin, shoes.
  tokens.forEach((token, i) => {
    if (claimed[i]) return;
    if (HAIR_ANCHORS.includes(token.text)) adjectives(i, hair, {styles: true, to: 'hair.color', from: token.text});
    else if (SKIN_ANCHORS.includes(token.text)) adjectives(i, skin, {to: 'skin', from: token.text});
    else if (SHOE_ANCHORS.includes(token.text)) adjectives(i, cloth, {to: 'colors.shoes', from: token.text});
  });
  // 4. Single words left over: a height, a step, who is speaking.
  const heights = [...HEIGHTS].sort((a, b) => HEIGHT_SCALE[a] - HEIGHT_SCALE[b]);
  const step = (list, now, by) => list[Math.max(0, Math.min(list.length - 1, list.indexOf(now) + by))];
  let voice = null, accent = null;
  tokens.forEach((token, i) => {
    if (claimed[i] || token.proper) return;
    const word = token.text;
    const claim = () => { claimed[i] = true; };
    if (word === 'short' && HEIGHTS.includes('short')) { push(i, 'height', 'short', word); claim(); }
    else if (word === 'taller' || word === 'shorter') { push(i, 'height', step(heights, current?.height ?? 'average', word === 'taller' ? 1 : -1), word); claim(); }
    else if (word === 'older' || word === 'younger') { push(i, 'age', step([...AGES], current?.age ?? 'adult', word === 'older' ? 1 : -1), word); claim(); }
  });
  for (const token of tokens) {
    // "British" and "American" are written with a capital: read them before names are skipped.
    if (['british', 'english'].includes(token.text)) accent ??= 'b';
    else if (token.text === 'american') accent ??= 'a';
    if (token.proper) continue;
    if (F_WORDS.includes(token.text)) voice ??= 'f';
    else if (M_WORDS.includes(token.text)) voice ??= 'm';
  }
  sets.sort((a, b) => a.at - b.at);
  const unmatched = [...new Set(tokens.filter((token, i) => !claimed[i] && !token.proper && !STOP.has(token.text) && !/^\d+$/.test(token.text)).map(token => token.text))];
  const seen = new Set();
  const unique = sets.map(({at: _at, ...set}) => set).filter(set => { const id = `${set.path}${set.op}${set.value}`; if (seen.has(id)) return false; seen.add(id); return true; });
  return {sets: unique, voice, accent, unmatched};
}

/** A Kokoro voice for a seed: a woman's or a man's when asked, British or American when asked. */
export function pickVoice(seed, {voice = null, accent = null} = {}) {
  const pool = KOKORO_VOICES.filter(id => (!voice || id[1] === voice) && (!accent || id[0] === accent));
  return makeRng(`${seed}:voice`).pick(pool.length ? pool : KOKORO_VOICES);
}

/**
 * What a new character gets where its description and flags say nothing:
 * a skin tone from anywhere in the range and a natural hair, the same for
 * the same seed. → {skin, hair: {style, color}}
 */
export function newCharacterDefaults(seed, {age = 'adult'} = {}) {
  const rng = makeRng(`${seed}:character`);
  const styles = HAIR_STYLES.filter(style => !['headscarf', 'bald', 'balding', 'mohawk', 'space-buns', 'pigtails'].includes(style));
  const natural = Object.keys(HAIR_COLORS).filter(color => !color.endsWith('-dye') && !GREY_HAIR.includes(color));
  return {skin: rng.pick(SKIN_ORDER), hair: {style: rng.pick(styles), color: age === 'senior' ? rng.pick(GREY_HAIR) : rng.pick(natural)}};
}

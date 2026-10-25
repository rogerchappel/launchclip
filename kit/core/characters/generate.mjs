// Generated casts (docs/SEEDED_STYLES_RFC.md §3.5): a seed and a character
// set give a cast of distinct, respectful people, always the same for the
// same inputs. A character set fixes the wardrobe and the props (chefs wear
// chef coats and aprons, a medical team scrubs and stethoscopes); the seed
// varies the people inside it: skin tone across the whole range, build,
// height, age, hair, facial hair, glasses, headwear, accessories and
// mobility aids, with clothes coloured from the palette.
//
//   generateCast({seed, set, count, palette}) → story cast entries
//     [{id, name, voice, build, height, age?, skin, hair, outfit, accessories,
//       headwear?, mobility?, colors}]
//   castFromStyle(pack.cast) → story.cast {style, characters}
//
// Respect rules: no caricature (proportions stay inside the rig's ranges),
// every skin tone equally likely, faith and cultural headwear (headscarf,
// turban, kippah) and mobility aids appear as ordinary options at modest
// rates, and facial hair and children's features follow age.
//
// Imports only sibling kit/core files.

import {normalizeRigParams, rigFingerprint} from './rig.mjs';
import {NEUTRALS, SKIN_ORDER} from './palette.mjs';
import {STARTER_IDS} from './cast.mjs';
import {DRAWING_STYLES} from './styles.mjs';

// ---------------------------------------------------------------------------
// PRNG: a 32-bit string hash seeding mulberry32.

export function hashSeed(text) {
  let h = 2166136261 >>> 0;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

export function makeRng(seed) {
  let a = hashSeed(seed);
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = list => list[Math.floor(next() * list.length)];
  const chance = p => next() < p;
  /** A weighted pick from {value: weight}. */
  const weighted = table => {
    const entries = Object.entries(table).filter(([, w]) => w > 0);
    let r = next() * entries.reduce((sum, [, w]) => sum + w, 0);
    for (const [value, w] of entries) { r -= w; if (r <= 0) return value; }
    return entries[entries.length - 1][0];
  };
  return {next, pick, chance, weighted};
}

// ---------------------------------------------------------------------------
// Names: an international pool, none a starter id. voice: f, m or n (either).

const NAMES = [
  ['Aisha', 'f'], ['Akira', 'n'], ['Alejandro', 'm'], ['Amina', 'f'], ['Anders', 'm'], ['Ananya', 'f'], ['Andile', 'm'], ['Ari', 'n'], ['Astrid', 'f'], ['Ayo', 'n'],
  ['Bea', 'f'], ['Bilal', 'm'], ['Bo', 'n'], ['Camila', 'f'], ['Chen', 'n'], ['Chidi', 'm'], ['Chloe', 'f'], ['Dara', 'n'], ['Dev', 'm'], ['Elena', 'f'],
  ['Emeka', 'm'], ['Esi', 'f'], ['Ezra', 'm'], ['Farah', 'f'], ['Felix', 'm'], ['Freya', 'f'], ['Gabriel', 'm'], ['Hamid', 'm'], ['Haruto', 'm'], ['Ines', 'f'],
  ['Ivan', 'm'], ['Jae', 'n'], ['Jasmine', 'f'], ['Javier', 'm'], ['Jia', 'f'], ['Jordan', 'n'], ['Kai', 'n'], ['Kamala', 'f'], ['Keanu', 'm'], ['Kofi', 'm'],
  ['Lars', 'm'], ['Layla', 'f'], ['Leilani', 'f'], ['Liam', 'm'], ['Lucia', 'f'], ['Luis', 'm'], ['Mahnoor', 'f'], ['Malik', 'm'], ['Marisol', 'f'], ['Mateo', 'm'],
  ['Mira', 'f'], ['Moana', 'f'], ['Musa', 'm'], ['Nadia', 'f'], ['Naveen', 'm'], ['Niamh', 'f'], ['Nico', 'n'], ['Nkechi', 'f'], ['Olu', 'n'], ['Oscar', 'm'],
  ['Paulo', 'm'], ['Quinn', 'n'], ['Rahul', 'm'], ['Rania', 'f'], ['Ravi', 'm'], ['Reza', 'm'], ['Riley', 'n'], ['Rin', 'f'], ['Rosa', 'f'], ['Sanjay', 'm'],
  ['Santi', 'm'], ['Selin', 'f'], ['Seo-yeon', 'f'], ['Sipho', 'm'], ['Siddharth', 'm'], ['Tala', 'f'], ['Tariq', 'm'], ['Tess', 'f'], ['Thandi', 'f'], ['Tiago', 'm'],
  ['Uma', 'f'], ['Valentina', 'f'], ['Wei', 'n'], ['Xavier', 'm'], ['Yara', 'f'], ['Yusuf', 'm'], ['Zainab', 'f'], ['Zeynep', 'f'], ['Zhen', 'n'], ['Imani', 'f'],
  ['Arash', 'm'], ['Beatriz', 'f'], ['Daniyar', 'm'], ['Eitan', 'm'], ['Hiba', 'f'], ['Ikaika', 'm'], ['Jun', 'n'], ['Kiri', 'f'], ['Lwazi', 'm'], ['Noa', 'n']
].filter(([name]) => !STARTER_IDS.includes(slug(name)));

const VOICES = {
  f: ['af_heart', 'af_bella', 'af_nova', 'af_sarah', 'af_jessica', 'af_river', 'af_sky', 'af_kore', 'af_nicole', 'af_aoede', 'bf_emma', 'bf_isabella', 'bf_alice', 'bf_lily'],
  m: ['am_michael', 'am_adam', 'am_eric', 'am_liam', 'am_puck', 'am_onyx', 'am_fenrir', 'am_echo', 'bm_george', 'bm_daniel', 'bm_lewis', 'bm_fable'],
  n: ['af_alloy', 'af_river', 'am_echo', 'af_sky', 'am_puck']
};

function slug(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
}

// ---------------------------------------------------------------------------
// Character sets

const HAIR_BY_TEXTURE = {
  straight: ['short', 'sidepart', 'bob', 'long', 'ponytail', 'bun', 'pixie', 'shoulder', 'undercut', 'quiff', 'topknot'],
  wavy: ['wavy', 'shoulder', 'short', 'bob', 'ponytail', 'quiff', 'pixie', 'long'],
  curly: ['curly', 'afro', 'twists', 'pixie', 'shoulder', 'bun', 'puff'],
  coily: ['afro', 'twists', 'cornrows', 'braids', 'locs', 'buzz', 'curly', 'bun', 'space-buns']
};
const SHORT_CROPS = ['buzz', 'bald', 'short', 'sidepart', 'undercut', 'quiff', 'spiky', 'balding', 'mohawk'];
const NATURAL_HAIR = ['black', 'jet', 'espresso', 'brown', 'chestnut', 'auburn', 'copper', 'blonde', 'honey', 'ash', 'strawberry'];
const GREYS = ['grey', 'silver', 'snow', 'platinum'];
const DYES = ['pink-dye', 'blue-dye', 'violet-dye', 'green-dye'];

const BASE = {
  ages: {adult: 1},
  tops: {tee: 1}, bottoms: {trousers: 1}, over: null,
  headwear: {}, headwearRate: 0.08,
  accessories: {}, lanyardRate: 0,
  dyeRate: 0.04, glassesRate: 0.3, mobilityRate: 0.08,
  props: []
};

/**
 * Character sets: each fixes a wardrobe (weighted tops, bottoms, layers,
 * headwear and accessories), an age mix and the props its people hold;
 * the seed varies the people.
 */
export const CHARACTER_SETS = Object.freeze({
  'office-team': {...BASE, describe: 'an office team in smart-casual clothes, some with lanyards',
    tops: {shirt: 3, blazer: 2, sweater: 2, polo: 1, cardigan: 1, turtleneck: 1, dress: 1}, bottoms: {trousers: 4, skirt: 1}, lanyardRate: 0.3,
    accessories: {watch: 0.2, tie: 0.08, necklace: 0.1, earrings: 0.2}, props: ['phone', 'mug', 'tablet', 'clipboard']},
  'startup-founders': {...BASE, describe: 'founders in hoodies, tees and jackets',
    tops: {hoodie: 3, tee: 3, jacket: 2, shirt: 1, sweater: 1}, bottoms: {trousers: 5, shorts: 1}, headwear: {cap: 1, beanie: 1, headphones: 1}, headwearRate: 0.12,
    accessories: {watch: 0.2, earrings: 0.15, 'crossbody-bag': 0.1}, dyeRate: 0.08, props: ['phone', 'laptop', 'mug']},
  family: {...BASE, describe: 'a family across generations: parents, children and grandparents',
    ages: ['adult', 'adult', 'child', 'child', 'senior', 'teen'], tops: {sweater: 2, tee: 3, shirt: 2, cardigan: 1, dress: 1, polo: 1}, bottoms: {trousers: 4, skirt: 1, shorts: 1},
    accessories: {earrings: 0.15, necklace: 0.1}, props: ['phone', 'book', 'ball']},
  kids: {...BASE, describe: 'children in bright everyday clothes', ages: {child: 1},
    tops: {tee: 4, hoodie: 2, sweater: 2, dress: 1, jersey: 1}, bottoms: {trousers: 3, shorts: 2, leggings: 1, skirt: 1}, headwear: {cap: 1, beanie: 1, headband: 1}, headwearRate: 0.12,
    accessories: {backpack: 0.3}, glassesRate: 0.15, mobilityRate: 0.04, dyeRate: 0, props: ['ball', 'book']},
  seniors: {...BASE, describe: 'older people in cardigans, sweaters and coats', ages: {senior: 1},
    tops: {cardigan: 3, sweater: 3, shirt: 2, polo: 1, coat: 1}, bottoms: {trousers: 4, skirt: 1, 'long-skirt': 1}, headwear: {beret: 1, sunhat: 1, cap: 1}, headwearRate: 0.12,
    accessories: {'hearing-aid': 0.22, scarf: 0.12, necklace: 0.1, watch: 0.2}, glassesRate: 0.65, mobilityRate: 0.2, dyeRate: 0, props: ['mug', 'book', 'phone']},
  students: {...BASE, describe: 'students with backpacks, hoodies and headphones', ages: {teen: 2, adult: 3},
    tops: {hoodie: 3, tee: 3, sweater: 2, jacket: 1, cardigan: 1}, bottoms: {trousers: 4, shorts: 1, skirt: 1, leggings: 1}, headwear: {beanie: 2, headphones: 2, cap: 1, 'grad-cap': 0.5}, headwearRate: 0.18,
    accessories: {backpack: 0.5, 'crossbody-bag': 0.1, 'nose-stud': 0.06}, dyeRate: 0.1, props: ['book', 'phone', 'tablet']},
  chefs: {...BASE, describe: 'a kitchen brigade in chef coats and aprons', tops: {'chef-coat': 4, tee: 1}, bottoms: {trousers: 1}, over: {apron: 0.8},
    headwear: {'chef-hat': 4, headband: 1, beanie: 1}, headwearRate: 0.75, accessories: {}, glassesRate: 0.2, mobilityRate: 0.03, props: ['spatula', 'mug']},
  medical: {...BASE, describe: 'a medical team in scrubs and lab coats with stethoscopes', tops: {scrubs: 4, 'lab-coat': 2}, bottoms: {trousers: 1},
    headwear: {'surgical-cap': 1}, headwearRate: 0.3, accessories: {stethoscope: 0.65, watch: 0.3}, lanyardRate: 0.25, mobilityRate: 0.04, dyeRate: 0, props: ['clipboard', 'tablet']},
  athletes: {...BASE, describe: 'athletes in jerseys, tanks, shorts and leggings', ages: {teen: 1, adult: 4},
    tops: {jersey: 3, tank: 2, tee: 2, hoodie: 1}, bottoms: {shorts: 3, leggings: 2, trousers: 1}, headwear: {headband: 2, cap: 1, 'bike-helmet': 0.5}, headwearRate: 0.3,
    accessories: {watch: 0.4}, glassesRate: 0.08, builds: {athletic: 4, slim: 2, broad: 2, average: 1, stocky: 1, curvy: 1}, mobilityRate: 0.06, props: ['ball']},
  creators: {...BASE, describe: 'creators with headphones, beanies and bold colours', ages: {teen: 1, adult: 4},
    tops: {tee: 3, hoodie: 2, jacket: 2, tank: 1, turtleneck: 1, cardigan: 1}, bottoms: {trousers: 3, shorts: 1, skirt: 1, leggings: 1}, headwear: {headphones: 3, beanie: 2, cap: 1, 'bucket-hat': 1, beret: 1}, headwearRate: 0.4,
    accessories: {earrings: 0.3, necklace: 0.2, 'nose-stud': 0.12, sunglasses: 0.08}, dyeRate: 0.22, props: ['microphone', 'phone']},
  'city-crowd': {...BASE, describe: 'people in the street: coats, jackets, bags and hats', ages: {child: 1, teen: 2, adult: 8, senior: 2},
    tops: {coat: 3, jacket: 3, hoodie: 2, sweater: 2, tee: 2, shirt: 1, kurta: 1, dress: 1}, bottoms: {trousers: 5, skirt: 1, 'long-skirt': 1, shorts: 1}, headwear: {beanie: 2, cap: 2, 'bucket-hat': 1, headphones: 1, beret: 1}, headwearRate: 0.25,
    accessories: {'crossbody-bag': 0.2, backpack: 0.15, scarf: 0.15, sunglasses: 0.06}, mobilityRate: 0.1, props: ['phone', 'mug']}
});

export const CHARACTER_SET_NAMES = Object.freeze(Object.keys(CHARACTER_SETS));

// ---------------------------------------------------------------------------
// Colours from the palette

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const dist = (a, b) => { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
const CLOTH_NEUTRALS = ['white', 'cream', 'sand', 'stone', 'slate', 'charcoal', 'navy', 'denim', 'olive', 'forest', 'brick', 'mustard', 'teal', 'plum', 'rose', 'sky', 'black', 'tan', 'burgundy', 'coral', 'lavender', 'mint', 'khaki', 'ochre', 'indigo', 'sage', 'ceil', 'red', 'tangerine', 'lemon'];
const BOTTOM_NEUTRALS = ['charcoal', 'navy', 'denim', 'black', 'slate', 'stone', 'khaki', 'olive', 'sand', 'tan', 'indigo', 'burgundy'];
const SHOES = ['black', 'white', 'tan', 'brick', 'charcoal', 'navy', 'stone'];

/** Clothing colours that stand apart from the palette's background. */
function clothing(palette) {
  const bg = HEX6.test(palette?.bg ?? '') ? palette.bg : null;
  const apart = name => !bg || dist(NEUTRALS[name], bg) > 70;
  const tops = CLOTH_NEUTRALS.filter(apart);
  const roles = ['primary', 'accent'].filter(role => !bg || !HEX6.test(palette?.[role] ?? '') || dist(palette[role], bg) > 70);
  return {tops: tops.length ? tops : CLOTH_NEUTRALS, roles, bottoms: BOTTOM_NEUTRALS.filter(apart).length ? BOTTOM_NEUTRALS.filter(apart) : BOTTOM_NEUTRALS, shoes: SHOES.filter(apart).length ? SHOES.filter(apart) : SHOES};
}

// ---------------------------------------------------------------------------
// One person

const TOP_FIXED = {'lab-coat': 'white', 'chef-coat': 'white'};
const BUILD_MIX = {average: 4, slim: 3, athletic: 2, broad: 2, round: 2, petite: 2, stocky: 2, curvy: 2};
const HEIGHT_MIX = {average: 5, short: 3, tall: 3, 'very-short': 1, 'very-tall': 1};

function person(rng, spec, age, skin, voice, colors) {
  const texture = rng.weighted({straight: 3, wavy: 2, curly: 2, coily: 2});
  let style = rng.chance(0.18) ? rng.pick(SHORT_CROPS) : rng.pick(HAIR_BY_TEXTURE[texture]);
  if (style === 'puff') style = 'afro';
  if (age === 'child' && ['balding', 'bald', 'mohawk'].includes(style)) style = 'short';
  if (age === 'senior' && ['mohawk', 'spiky', 'space-buns', 'pigtails'].includes(style)) style = 'short';
  if (age === 'senior' && rng.chance(0.2)) style = rng.pick(['balding', 'short', 'bob', 'bun', 'curly']);
  const faith = rng.chance(0.06) && age !== 'child' ? rng.weighted({headscarf: voice === 'm' ? 0 : 2, turban: 1, kippah: 1}) : null;
  if (faith === 'headscarf') style = 'headscarf';
  let color = age === 'senior' ? (rng.chance(0.75) ? rng.pick(GREYS) : rng.pick(NATURAL_HAIR)) : rng.chance(spec.dyeRate) ? rng.pick(DYES) : rng.pick(NATURAL_HAIR);
  if (style === 'headscarf') color = rng.pick([...colors.roles, ...colors.tops]);
  let top = rng.weighted(spec.tops);
  if (top === 'dress' && voice === 'm' && rng.chance(0.85)) top = rng.weighted({...spec.tops, dress: 0});
  let bottom = top === 'dress' ? 'skirt' : rng.weighted(spec.bottoms);
  if (['skirt', 'long-skirt'].includes(bottom) && voice === 'm' && rng.chance(0.85)) bottom = 'trousers';
  const over = spec.over ? (rng.chance(Object.values(spec.over)[0]) ? Object.keys(spec.over)[0] : null) : null;
  const accessories = [];
  for (const [name, rate] of Object.entries(spec.accessories)) if (rng.chance(rate)) accessories.push(name);
  if (spec.lanyardRate && rng.chance(spec.lanyardRate)) accessories.push('lanyard');
  if (rng.chance(spec.glassesRate) && !accessories.includes('sunglasses')) accessories.push(rng.weighted({glasses: 4, 'round-glasses': 3, 'cat-eye-glasses': age === 'child' ? 0 : 1}));
  if (age !== 'child' && age !== 'teen' && voice !== 'f') {
    if (rng.chance(voice === 'm' ? 0.45 : 0.12)) accessories.push(rng.weighted({beard: 3, stubble: 3, moustache: 1, goatee: 1, 'long-beard': age === 'senior' ? 1 : 0.3, sideburns: 0.5}));
  }
  if (style !== 'headscarf' && rng.chance(age === 'senior' ? 0.12 : 0.05)) accessories.push('hearing-aid');
  if (rng.chance(0.06)) accessories.push('freckles');
  if (style !== 'headscarf' && rng.chance(0.06) && !accessories.includes('earrings')) accessories.push('earrings');
  if (rng.chance(0.03)) accessories.push('bindi');
  const unique = [...new Set(accessories)].filter(name => !(style === 'headscarf' && ['earrings', 'hearing-aid'].includes(name)));
  let headwear = faith && faith !== 'headscarf' ? faith : null;
  if (!headwear && Object.keys(spec.headwear).length && rng.chance(spec.headwearRate)) headwear = rng.weighted(spec.headwear);
  if (style === 'headscarf' && headwear && headwear !== 'headphones') headwear = null;
  const mobility = rng.chance(spec.mobilityRate) ? rng.weighted({wheelchair: 3, cane: age === 'senior' ? 3 : 1, 'white-cane': 1, 'forearm-crutch': 1, 'prosthetic-leg': 1, 'prosthetic-arm': 1}) : null;
  const pickTop = () => (rng.chance(0.35) && colors.roles.length ? rng.pick(colors.roles) : rng.pick(colors.tops));
  return {
    build: age === 'child' ? rng.pick(['slim', 'average', 'round', 'petite']) : rng.weighted(spec.builds ?? BUILD_MIX),
    height: rng.weighted(HEIGHT_MIX),
    ...(age !== 'adult' ? {age} : {}),
    skin,
    hair: {style, color},
    outfit: {top, bottom, ...(over ? {over} : {})},
    accessories: unique,
    ...(headwear ? {headwear} : {}),
    ...(mobility ? {mobility} : {}),
    colors: {top: TOP_FIXED[top] ?? pickTop(), bottom: rng.pick(colors.bottoms), shoes: rng.pick(colors.shoes), accent: rng.chance(0.5) && colors.roles.length ? rng.pick(colors.roles) : rng.pick(colors.tops)}
  };
}

/** How alike two params look: the number of visible traits they share. */
function likeness(a, b) {
  const skinGap = Math.abs(SKIN_ORDER.indexOf(a.skin) - SKIN_ORDER.indexOf(b.skin));
  return (skinGap <= 1) + (a.hair.style === b.hair.style) + (a.hair.color === b.hair.color) + (a.build === b.build) + (a.outfit.top === b.outfit.top) + (a.colors.top === b.colors.top) + ((a.age ?? 'adult') === (b.age ?? 'adult'));
}

/**
 * A generated cast. seed: any string or number (style packs use 8 hex
 * characters); set: a CHARACTER_SETS name (default office-team); count:
 * 1–12; palette: brand colours {primary, accent, paper, ink, bg} (clothes
 * keep clear of bg). → story cast entries, the same for the same inputs.
 */
export function generateCast({seed, set = 'office-team', count = 3, palette = null} = {}) {
  if (seed === undefined || seed === null || seed === '') throw new Error('generateCast needs a seed');
  const spec = CHARACTER_SETS[set];
  if (!spec) throw new Error(`unknown character set ${JSON.stringify(set)} (sets: ${CHARACTER_SET_NAMES.join(', ')})`);
  if (!Number.isInteger(count) || count < 1 || count > 12) throw new Error('generateCast count must be 1 to 12');
  const rng = makeRng(`${seed}:${set}`);
  const colors = clothing(palette);
  // Skin tones spread across the whole range: a shuffled walk, so a cast of
  // three never draws three neighbours.
  const tones = [...SKIN_ORDER];
  for (let i = tones.length - 1; i > 0; i--) { const k = Math.floor(rng.next() * (i + 1)); [tones[i], tones[k]] = [tones[k], tones[i]]; }
  const names = [...NAMES];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < count; i++) {
    const age = Array.isArray(spec.ages) ? spec.ages[i % spec.ages.length] : rng.weighted(spec.ages);
    let entry = null;
    for (let attempt = 0; attempt < 24 && !entry; attempt++) {
      const nameIndex = Math.floor(rng.next() * names.length);
      const [name, voiceKind] = names[nameIndex];
      const skin = tones[(i + attempt) % tones.length];
      const params = normalizeRigParams(person(rng, spec, age, skin, voiceKind, colors), `generated ${name}`);
      const print = rigFingerprint(params);
      if (seen.has(print) || out.some(other => likeness(other.params, params) >= 5)) continue;
      names.splice(nameIndex, 1);
      seen.add(print);
      entry = {name, voiceKind, params};
    }
    if (!entry) throw new Error(`generateCast could not find ${count} distinct people for ${set}`);
    out.push(entry);
  }
  return out.map(({name, voiceKind, params}) => {
    const voices = VOICES[voiceKind];
    const {skin: _skin, hair: _hair, ...colors} = params.colors;
    return {id: slug(name), name, voice: voices[hashSeed(`${seed}:${name}`) % voices.length], ...params, colors};
  });
}

/**
 * The story cast for a style pack's cast block (style-seed writes
 * {drawing_style, set, members}; older packs {drawing_style, colors,
 * characters: [id]}). Members are story cast entries (generateCast output)
 * or starter ids. → {style, characters}
 */
export function castFromStyle(packCast) {
  if (!packCast || typeof packCast !== 'object') return null;
  const style = packCast.drawing_style ?? 'flat';
  if (!DRAWING_STYLES.includes(style)) throw new Error(`cast.drawing_style must be one of ${DRAWING_STYLES.join(', ')}`);
  const list = Array.isArray(packCast.members) ? packCast.members : Array.isArray(packCast.characters) ? packCast.characters : [];
  const characters = list.map(member => (typeof member === 'string' ? {id: member} : {...member}));
  return {style, characters};
}

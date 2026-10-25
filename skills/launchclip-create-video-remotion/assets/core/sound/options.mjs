// The option lists of a style pack's `sound` block (RFC: seeded styles §3.5,
// phase 5b). The style seed draws from these; the synth audio kit
// (synth-audio-kit.mjs) renders them; finish reads the chosen values.
//
//   sound: {
//     palette: <SOUND_PALETTES>,
//     music: { genre: <MUSIC_GENRES>, bpm, key: <MUSIC_KEYS>, progression: 0-based },
//     ambience: "auto" | "none" | <AMBIENCE_BEDS>,
//     sfx_density: 0..1 | "low" | "normal" | "high"
//   }
//
// Everything is procedural synthesis: no samples, no network, no provider.

/** Sonic palettes: each sets the timbre of every effect family. */
export const SOUND_PALETTES = Object.freeze([
  'cinematic', 'glassy', 'organic', 'cartoon', 'lofi', 'retro-8bit',
  'analog', 'minimal', 'documentary', 'synthwave', 'soft', 'industrial'
]);

/** One-line descriptions, for docs and pickers. */
export const SOUND_PALETTE_NOTES = Object.freeze({
  cinematic: 'deep, wide and heavy: low pitch, long tails, a big hall',
  glassy: 'bright digital glass: high bell partials, clean and airy',
  organic: 'wood, paper and breath: woody knocks, dry room, warm noise',
  cartoon: 'bouncy and elastic: springy pitch bends, rounded tones',
  lofi: 'dusty tape: wobble, soft highs, gentle saturation',
  'retro-8bit': 'game console: square waves, bit-crushed, dry',
  analog: 'warm analogue synth: saw tones, soft drive, tape echo',
  minimal: 'crisp and short: tiny clean ticks, almost no tail',
  documentary: 'natural foley: realistic, dry, unhyped',
  synthwave: 'neon eighties: detuned saws, chorus, gated echo',
  soft: 'pastel and gentle: rounded sines, slow attacks, a soft room',
  industrial: 'metal and grit: inharmonic clanks, drive, short plate'
});

/** Every effect family the kit can render (the first eleven are the historic kit). */
export const SFX_FAMILY_NAMES = Object.freeze([
  'whoosh', 'impact', 'riser', 'tick', 'pop', 'shimmer', 'subdrop', 'click',
  'keystroke', 'keystroke-space', 'keystroke-enter',
  'swipe', 'slide', 'snap', 'thud', 'chime', 'ding', 'ping', 'glitch',
  'tape-stop', 'page-turn', 'pen-scribble', 'camera-shutter', 'cash',
  'notification', 'error-buzz', 'success', 'boing', 'sparkle', 'footstep', 'door'
]);

/** The families of the historic kit (rendered with no palette, unchanged). */
export const HISTORIC_SFX_FAMILIES = Object.freeze(SFX_FAMILY_NAMES.slice(0, 11));

/** Ambience beds: seamless loops, ducked under narration. */
export const AMBIENCE_BEDS = Object.freeze([
  'office', 'cafe', 'street-day', 'street-night', 'crickets', 'rain',
  'waves', 'wind', 'server-room', 'crowd', 'birds', 'room-tone', 'space-hum'
]);

export const AMBIENCE_NOTES = Object.freeze({
  office: 'air-conditioning hum, distant keys and murmur',
  cafe: 'warm murmur, cup clinks, an espresso hiss now and then',
  'street-day': 'traffic passing, tyre roar, a far horn',
  'street-night': 'distant traffic, a siren far away',
  crickets: 'night crickets over a soft breeze',
  rain: 'steady rain with drops and a low rumble',
  waves: 'beach waves breaking and washing back',
  wind: 'open wind, gusting',
  'server-room': 'fans, power hum and a steady air rush',
  crowd: 'a large room full of people',
  birds: 'a park in the morning: birdsong over leaves',
  'room-tone': 'a quiet room: just air',
  'space-hum': 'a deep, slow spaceship drone'
});

export const WORLD_TIMES = Object.freeze(['day', 'dusk', 'night']);

// World kind → bed per time of day. Kinds are the RFC's world ids; a kind not
// listed gets no ambience.
const SAME = (bed) => ({ day: bed, dusk: bed, night: bed });
export const WORLD_AMBIENCE = Object.freeze({
  office: { day: 'office', dusk: 'office', night: 'room-tone' },
  'home-desk': { day: 'room-tone', dusk: 'room-tone', night: 'crickets' },
  kitchen: SAME('room-tone'),
  'living-room': { day: 'room-tone', dusk: 'room-tone', night: 'crickets' },
  classroom: { day: 'crowd', dusk: 'room-tone', night: 'room-tone' },
  cafe: { day: 'cafe', dusk: 'cafe', night: 'cafe' },
  workshop: SAME('room-tone'),
  'server-room': SAME('server-room'),
  studio: SAME('room-tone'),
  gym: { day: 'crowd', dusk: 'crowd', night: 'room-tone' },
  'city-street': { day: 'street-day', dusk: 'street-day', night: 'street-night' },
  shopfronts: { day: 'street-day', dusk: 'street-day', night: 'street-night' },
  crossing: { day: 'street-day', dusk: 'street-day', night: 'street-night' },
  alley: { day: 'wind', dusk: 'street-night', night: 'street-night' },
  rooftop: { day: 'wind', dusk: 'street-night', night: 'street-night' },
  skyline: { day: 'street-day', dusk: 'street-night', night: 'street-night' },
  park: { day: 'birds', dusk: 'birds', night: 'crickets' },
  beach: SAME('waves'),
  mountains: { day: 'wind', dusk: 'wind', night: 'crickets' },
  forest: { day: 'birds', dusk: 'wind', night: 'crickets' },
  space: SAME('space-hum'),
  'abstract-stage': SAME('room-tone')
});

/** world {kind, time} → an ambience bed id, or null when the world has none. */
export function ambienceForWorld(world) {
  if (!world || typeof world !== 'object') return null;
  const kind = String(world.kind ?? '').toLowerCase().replace(/[\s_]+/g, '-');
  const time = WORLD_TIMES.includes(world.time) ? world.time : 'day';
  return WORLD_AMBIENCE[kind]?.[time] ?? null;
}

/** Synth music genres, each with its own progressions, voicings and tempo range. */
export const MUSIC_GENRES = Object.freeze([
  'ambient', 'lo-fi', 'house', 'synthwave', 'acoustic-pluck',
  'cinematic-pulse', 'chiptune', 'jazz-hop', 'orchestral-lite'
]);

/** Keys, by tonic (sharps). Every genre plays in any of them. */
export const MUSIC_KEYS = Object.freeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);

/**
 * Per genre: bpm range, how many progressions it has, the keys that suit its
 * register best (the seed picks among these; any MUSIC_KEYS value renders),
 * and a note.
 */
export const GENRE_SPECS = Object.freeze({
  ambient: { bpm: [64, 84], progressions: 4, keys: ['C', 'D', 'E', 'F', 'G', 'A'], note: 'slow pads, bells and air; a soft pulse only in the loud part' },
  'lo-fi': { bpm: [72, 90], progressions: 4, keys: ['C', 'D', 'D#', 'F', 'G', 'A#'], note: 'dusty e-piano sevenths, swung hats, a lazy kick and vinyl crackle' },
  house: { bpm: [116, 126], progressions: 4, keys: ['C', 'D', 'F', 'G', 'A'], note: 'four on the floor, offbeat hats, pumping stab chords and a rolling bass' },
  synthwave: { bpm: [84, 110], progressions: 4, keys: ['C', 'D', 'E', 'F#', 'A'], note: 'detuned saw pads, an arpeggio, gated snare and an octave bass' },
  'acoustic-pluck': { bpm: [84, 108], progressions: 4, keys: ['C', 'D', 'E', 'G', 'A'], note: 'plucked guitar-like patterns, soft shaker and a warm bass' },
  'cinematic-pulse': { bpm: [80, 100], progressions: 4, keys: ['C', 'D', 'E', 'F', 'A'], note: 'string pad, ostinato pulse, deep hits, a building tension' },
  chiptune: { bpm: [110, 140], progressions: 4, keys: ['C', 'D', 'E', 'F', 'G', 'A'], note: 'square-wave lead arps, a triangle bass and noise drums' },
  'jazz-hop': { bpm: [80, 94], progressions: 4, keys: ['C', 'D#', 'F', 'G#', 'A#'], note: 'ninth chords on keys, an upright-like bass, swung brushes' },
  'orchestral-lite': { bpm: [70, 96], progressions: 4, keys: ['C', 'D', 'F', 'G', 'A#'], note: 'strings, pizzicato and a soft timpani: warm and hopeful' }
});

/** Tone (RFC §3.3) → the palettes and genres that fit it; the seed picks inside. */
export const TONE_SOUND = Object.freeze({
  calm: { palettes: ['soft', 'organic', 'glassy', 'minimal'], genres: ['ambient', 'acoustic-pluck', 'lo-fi'] },
  serious: { palettes: ['cinematic', 'documentary', 'minimal'], genres: ['cinematic-pulse', 'ambient', 'orchestral-lite'] },
  warm: { palettes: ['organic', 'analog', 'lofi', 'soft'], genres: ['acoustic-pluck', 'lo-fi', 'jazz-hop', 'orchestral-lite'] },
  energetic: { palettes: ['synthwave', 'cinematic', 'glassy', 'industrial'], genres: ['house', 'synthwave', 'cinematic-pulse'] },
  playful: { palettes: ['cartoon', 'retro-8bit', 'soft', 'glassy'], genres: ['chiptune', 'acoustic-pluck', 'house'] },
  premium: { palettes: ['glassy', 'minimal', 'cinematic', 'soft'], genres: ['ambient', 'cinematic-pulse', 'house'] },
  technical: { palettes: ['minimal', 'glassy', 'industrial', 'retro-8bit'], genres: ['synthwave', 'ambient', 'house'] }
});

export const SFX_DENSITY_WORDS = Object.freeze({ low: 0.25, normal: 0.6, high: 1 });

/**
 * sfx_density → a number in [0, 1], or null when unset. Words map to the
 * historic levels: low 0.25, normal 0.6, high 1.
 */
export function densityValue(density) {
  if (density === undefined || density === null) return null;
  if (typeof density === 'number') return Number.isFinite(density) ? Math.min(1, Math.max(0, density)) : null;
  const word = String(density).toLowerCase();
  if (word in SFX_DENSITY_WORDS) return SFX_DENSITY_WORDS[word];
  const number = Number(word);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : null;
}

/** Problems with a `sound` block, as messages (empty when it is valid). */
export function soundProblems(sound) {
  const problems = [];
  if (sound === undefined) return problems;
  if (!sound || typeof sound !== 'object' || Array.isArray(sound)) return ['sound must be an object'];
  if (sound.palette !== undefined && !SOUND_PALETTES.includes(sound.palette)) problems.push(`sound.palette must be one of ${SOUND_PALETTES.join(', ')}`);
  if (sound.ambience !== undefined && !['auto', 'none', ...AMBIENCE_BEDS].includes(sound.ambience)) problems.push(`sound.ambience must be auto, none or one of ${AMBIENCE_BEDS.join(', ')}`);
  if (sound.sfx_density !== undefined && densityValue(sound.sfx_density) === null) problems.push('sound.sfx_density must be a number from 0 to 1, or low, normal or high');
  const music = sound.music;
  if (music !== undefined && music !== null) {
    if (typeof music !== 'object' || Array.isArray(music)) problems.push('sound.music must be an object');
    else {
      if (music.genre !== undefined && !MUSIC_GENRES.includes(music.genre)) problems.push(`sound.music.genre must be one of ${MUSIC_GENRES.join(', ')}`);
      if (music.key !== undefined && !MUSIC_KEYS.includes(normalizeKey(music.key))) problems.push(`sound.music.key must be one of ${MUSIC_KEYS.join(', ')}`);
      if (music.bpm !== undefined && !(typeof music.bpm === 'number' && music.bpm >= 40 && music.bpm <= 200)) problems.push('sound.music.bpm must be a number from 40 to 200');
      const spec = GENRE_SPECS[music.genre];
      if (music.progression !== undefined && !(Number.isInteger(music.progression) && music.progression >= 0 && music.progression < (spec?.progressions ?? 4))) problems.push(`sound.music.progression must be an integer from 0 to ${(spec?.progressions ?? 4) - 1}`);
    }
  }
  return problems;
}

const FLATS = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
/** "Bb", "bb", "a#m" → "A#"; unknown → the input. */
export function normalizeKey(key) {
  const text = String(key ?? '').trim().replace(/m(in(or)?)?$/i, '');
  const cased = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  return FLATS[cased] ?? cased.replace('♯', '#');
}

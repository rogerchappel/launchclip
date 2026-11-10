// What a character story is, and the defaults that follow from it, in one
// place: the caption treatment (captions.mjs), which style-pack captions apply
// (style.mjs), the camera's moves inside a shot (camera-world.mjs) and what
// the style gate measures (src/style_adherence.js) all ask here.
//
// A character story is a story made with a show bible (story.bible, the
// reference `launchclip make --animation` and `launchclip bible freeze` leave)
// that stages its cast in cast scenes. The bible fixes its look (the cast, the
// world and the drawing style), so most of every frame is the world and the
// characters, not the brand's colours. A story with characters but no bible
// (an explainer with a presenter character) is not one, and renders as before.
//
// Plain ESM with no imports, so every kit/core file can ask.

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The modules that stage the cast. */
export const CAST_MODULES = Object.freeze(['cast-scene', 'character-cameo']);

/** Whether a story (raw or resolved) is a character story. */
export function isCharacterStory(story) {
  if (!isObject(story) || !isObject(story.bible) || story.lane === 'footage-led') return false;
  return (Array.isArray(story.scenes) ? story.scenes : []).some((scene) => CAST_MODULES.includes(scene?.module));
}

// A character story's captions when its overlay names no preset: the kit's
// own word-highlight (no band, no plate), in sentence case, a little smaller
// and a little longer a line so a short sentence stays whole on a phone.
// White type in the preset's dark outline, whatever the brand's text colour:
// it stands over a drawn world (sky, grass, a room), not over the brand's
// background, and the outline carries it on any of them, so it takes no
// world tone (world_tone: false). The spoken word turns the brand primary.
// A style pack's caption preset is made for cards and footage in the brand's
// colours and does not apply (a pack opts in with captions.lanes.characters).
export const CHARACTER_CAPTIONS = Object.freeze({ preset: 'word-highlight', case: 'as-is', max_words: 4, max_chars: 22, size: 0.86, world_tone: false, colors: Object.freeze({ idle: '#ffffff', active: 'primary' }) });
// The style-pack captions lane a character story reads.
export const CHARACTER_CAPTION_LANE = 'characters';

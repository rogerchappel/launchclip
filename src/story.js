// Node-side entry for story.json v1. The canonical, import-free
// implementation lives in kit/core/story.mjs so Remotion bundles and skills
// can share it.
export {
  STORY_SCHEMA,
  STORY_LANES,
  STORY_TRANSITIONS,
  STORY_DIRECTIONS,
  STORY_CAPTION_STYLES,
  STORY_CAPTION_PRESETS,
  STORY_VOICE_PROVIDERS,
  parseAnchor,
  isAnchor,
  resolveAnchor,
  validateStory,
  resolveStory,
  deriveBoundaries,
  storyFormat,
  storyHits,
  storyBase,
  edlTrim,
  BASE_FITS,
  aspectName
} from "../kit/core/story.mjs";

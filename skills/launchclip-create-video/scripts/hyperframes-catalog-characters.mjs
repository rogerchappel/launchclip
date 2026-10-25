// HyperFrames emitters for the character modules (cast-scene,
// character-cameo). Same shape as catalogue E (emitParts): the module's
// layer, a screen video hoisted to the root with the cast as its overlay,
// one op list for GSAP.

import {charactersTimeline, charactersView} from './catalog-characters.mjs';
import {emitParts} from './hyperframes-catalog-e.mjs';

export function emitCharacters(model) {
  return emitParts(model, charactersView(model), charactersTimeline(model));
}

export const EMITTERS = {
  'cast-scene': emitCharacters,
  'character-cameo': emitCharacters,
};

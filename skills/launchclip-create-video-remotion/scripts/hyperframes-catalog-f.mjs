// HyperFrames emitters for catalogue F (the creative set around the
// presenter). Same shape as catalogue E (emitParts): the module's own layer,
// hoisted media, and a split module's behind part.

import {catalogFTimeline, catalogFView} from './catalog-f.mjs';
import {emitParts} from './hyperframes-catalog-e.mjs';

export function emitCatalogF(model) {
  return emitParts(model, catalogFView(model), catalogFTimeline(model));
}

export const EMITTERS = {
  'glass-word': emitCatalogF,
  'orbit-cards': emitCatalogF,
};

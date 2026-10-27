// Catalogue I: the explainer vocabulary (docs/KIT_CONTRACTS.md, "Catalogue
// I"), built on catalogue H's view tree and op list, so both renderers draw
// every module from the same shared code (kit/core/catalog-h.mjs registers
// them). Shared pieces are in catalog-i-base.mjs.
//
//   data       catalog-i-data.mjs (race-bars, small-multiples)

import {DATA_I} from './catalog-i-data.mjs';

export const EXPLAIN_MODULES = [...DATA_I];

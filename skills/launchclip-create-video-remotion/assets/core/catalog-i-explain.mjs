// Catalogue I: the explainer vocabulary (docs/KIT_CONTRACTS.md, "Catalogue
// I"), built on catalogue H's view tree and op list, so both renderers draw
// every module from the same shared code (kit/core/catalog-h.mjs registers
// them). Shared pieces are in catalog-i-base.mjs.
//
//   data       catalog-i-data.mjs (race-bars, small-multiples)
//   calendars  catalog-i-calendar.mjs (date-carousel, month-grid)
//   people     catalog-i-people.mjs (person-id, lineage-graph)

import {DATA_I} from './catalog-i-data.mjs';
import {CALENDARS} from './catalog-i-calendar.mjs';
import {PEOPLE} from './catalog-i-people.mjs';

export const EXPLAIN_MODULES = [...DATA_I, ...CALENDARS, ...PEOPLE];

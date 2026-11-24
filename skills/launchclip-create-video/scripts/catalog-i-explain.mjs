// Catalogue I: the explainer vocabulary (docs/KIT_CONTRACTS.md, "Catalogue
// I"), built on catalogue H's view tree and op list, so both renderers draw
// every module from the same shared code (kit/core/catalog-h.mjs registers
// them). Shared pieces are in catalog-i-base.mjs.
//
//   data       catalog-i-data.mjs (race-bars, small-multiples)
//   calendars  catalog-i-calendar.mjs (date-carousel, month-grid)
//   people     catalog-i-people.mjs (person-id, lineage-graph)
//   maths      catalog-i-math.mjs (equation, title-decompose, feynman-diagram);
//              equations are typeset from LaTeX by src/math/typeset.js
//   diagrams   catalog-i-diagram.mjs (line-diagram, a labelled line sketch)
//   graphs     catalog-i-graph.mjs (node-graph: nodes fanned round a hub, wires and pulses)
//   pictures   illustration.mjs (illustration: a drawn object and one change, docs/EXPLAINER_CLAIMS_RFC.md §3.2)
//              hand-drawn.mjs (hand-drawn: an object inked and coloured by a pen, docs/rd/hand-drawn-reveal.md)

import {DATA_I} from './catalog-i-data.mjs';
import {CALENDARS} from './catalog-i-calendar.mjs';
import {PEOPLE} from './catalog-i-people.mjs';
import {MATH} from './catalog-i-math.mjs';
import {DIAGRAMS} from './catalog-i-diagram.mjs';
import {GRAPHS} from './catalog-i-graph.mjs';
import {illustration} from './illustration.mjs';
import {handDrawn} from './hand-drawn.mjs';

export const EXPLAIN_MODULES = [...DATA_I, ...CALENDARS, ...PEOPLE, ...MATH, ...DIAGRAMS, ...GRAPHS, illustration, handDrawn];

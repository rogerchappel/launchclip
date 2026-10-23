// Catalogue B: renderer-neutral models for the RFC §5 modules
// function-chart, gauge-compare, flow-compare, process-steps, archive-card and
// logo-row, plus brand-lockup (title and end cards from the brand's artwork). Contract: docs/KIT_CONTRACTS.md ("Wave 2").
//
// Each MODULES entry resolves (params, ctx) into a JSON-only model. Both the
// HyperFrames emitter (kit/hyperframes/catalog-b.mjs) and the Remotion
// components (kit/remotion/catalog/*.tsx) draw from that model only, through
// catalogBView(model) (static element tree, identical DOM in both renderers)
// and catalogBTimeline(model) (renderer-neutral animation ops: GSAP on one
// side, frame-pure motion.mjs evaluation on the other).
//
// Files: catalog-b-base.mjs (parser, colour, validation, createBase),
// catalog-b-view.mjs (tree helpers, root motion, frameState), and one
// catalog-b-<id>.mjs per module exporting {id, describe, params, events,
// resolve, view, timeline}.
//
// Conventions
// - Times are absolute seconds on the host timeline (ctx.start + offset).
//   Params give times as seconds from the scene start (`at`).
// - `rect` is in canvas px. Geometry inside `content` is rect-local (px from
//   the rect's top-left corner) unless the key ends in `Canvas`.
// - Per-frame state (probe position, count-up text) is precomputed as
//   `samples: [{t, ...}]`, one per frame over the motion. GSAP applies sample
//   k with tl.set at `t - SAMPLE_LEAD`; Remotion evaluates the same op list.
//   Nothing is integrated over time, so seeking is safe.
// - Event ids are `${id}-${name}`; `name` matches story `hits[].event`.
//   When ctx.hits (resolved, absolute `at`) carries a hit whose event equals a
//   module event name, that hit times the event unless params set `at`.
// - Shared objects for morph handoff are listed in model.objects
//   ({[name]: {rect (canvas px), color, time}}), e.g. gauge-compare's
//   "gap-bracket".
//
// Hard rules (RFC §5) enforced in createBase and the modules: rects inside the
// Shorts safe zone (or the landscape title-safe zone, above the caption band
// unless the module hides captions), key text at least 44 px at 1080 (scaled by
// min(width, height) / 1080), brand colour pairs with WCAG contrast of at least
// 3:1 (throws otherwise), and no blur at settle (nothing here blurs).

import {rootNode, rootOps} from './catalog-b-view.mjs';
import {grammarTweens} from './grammar.mjs';
import {logoRow} from './catalog-b-logo-row.mjs';
import {archiveCard} from './catalog-b-archive-card.mjs';
import {processSteps} from './catalog-b-process-steps.mjs';
import {flowCompare} from './catalog-b-flow-compare.mjs';
import {gaugeCompare} from './catalog-b-gauge-compare.mjs';
import {functionChart} from './catalog-b-function-chart.mjs';
import {brandLockup} from './catalog-b-brand-lockup.mjs';

export {parseExpression, contrastRatio, luminance, mixColor, formatNumber, withUnit, sampleIndex, SAMPLE_LEAD, CATALOG_B_STYLE, CATALOG_B_TIMING} from './catalog-b-base.mjs';

const DEFINITIONS = [functionChart, gaugeCompare, flowCompare, processSteps, archiveCard, logoRow, brandLockup];

export const MODULES = Object.fromEntries(DEFINITIONS.map(def => [def.id, {describe: def.describe, params: def.params, events: def.events, timing: def.timing, resolve: def.resolve}]));
const BY_ID = Object.fromEntries(DEFINITIONS.map(def => [def.id, def]));

function definition(model) {
  const def = model && BY_ID[model.module];
  if (!def) throw new Error(`catalogue B: unknown module ${model?.module}`);
  return def;
}

/** Static element tree for a catalogue B model (initial state at scene start). */
export function catalogBView(model) {
  return rootNode(model, definition(model).view(model));
}

/** Renderer-neutral animation ops for a catalogue B model, root first. */
export function catalogBTimeline(model) {
  const def = definition(model);
  const ops = [];
  rootOps(model, ops);
  def.timeline(model, ops);
  // Motion grammar: pops (back/elastic eases) follow the story's grammar.
  if (model.grammar) grammarTweens(ops, model.grammar, {roles: ['emphasis']});
  return ops;
}

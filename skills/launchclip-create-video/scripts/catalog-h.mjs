// Catalogue H: the element library, drawn in both renderers from one view
// tree and one op list (catalogue B's conventions; kit/core/catalog-b.mjs).
// Contract: docs/KIT_CONTRACTS.md ("Catalogue H").
//
//   charts    catalog-h-charts.mjs (bar-chart, stacked-bar, pie-chart,
//             area-chart, scatter-plot, radar-chart, sparkline, progress-ring)
//             and catalog-h-flows.mjs (funnel-chart, waterfall, sankey,
//             heatmap, leaderboard, comparison-table)
//   numbers   catalog-h-numbers.mjs (odometer, flip-clock, ticker-tape,
//             slot-roll, countdown, percent-fill)
//   frames    catalog-h-frames.mjs (device-frame, window-chrome),
//             catalog-h-paper.mjs (polaroid, sticker, torn-paper, tape-note,
//             badge, ribbon) and catalog-h-callouts.mjs (speech-bubble,
//             tooltip, callout-arrow)
//
// Every module exports its VARIANTS (the default first); helpers, the series
// palette, number formats and the extra op props (blur, clip) are in
// catalog-h-base.mjs.

import {propsToStyle, rootNode, rootOps} from './catalog-b-view.mjs';
import {grammarTweens} from './grammar.mjs';
import {clipCss} from './catalog-h-base.mjs';
import {CHARTS} from './catalog-h-charts.mjs';
import {FLOWS} from './catalog-h-flows.mjs';
import {NUMBERS} from './catalog-h-numbers.mjs';
import {FRAMES} from './catalog-h-frames.mjs';
import {PAPER} from './catalog-h-paper.mjs';
import {CALLOUTS} from './catalog-h-callouts.mjs';

const ASPECTS = ['9:16', '16:9'];
const DEFINITIONS = [...CHARTS, ...FLOWS, ...NUMBERS, ...FRAMES, ...PAPER, ...CALLOUTS];

export const MODULES = Object.fromEntries(DEFINITIONS.map(def => [def.id, {describe: def.describe, params: def.params, events: def.events, timing: def.timing, resolve: def.resolve, aspects: ASPECTS, variants: def.variants}]));
/** Each module's designed variants, the default (its original look) first. */
export const VARIANTS = Object.freeze(Object.fromEntries(DEFINITIONS.map(def => [def.id, def.variants])));
const BY_ID = Object.fromEntries(DEFINITIONS.map(def => [def.id, def]));

function definition(model) {
  const def = model && BY_ID[model.module];
  if (!def) throw new Error(`catalogue H: unknown module ${model?.module}`);
  return def;
}

/** Static element tree for a catalogue H model (initial state at scene start). */
export function catalogHView(model) {
  return rootNode(model, definition(model).view(model));
}

/** Renderer-neutral animation ops for a catalogue H model, root first. */
export function catalogHTimeline(model) {
  const ops = [];
  rootOps(model, ops);
  definition(model).timeline(model, ops);
  if (model.grammar) grammarTweens(ops, model.grammar, {roles: ['emphasis']});
  return ops;
}

const CLIP_KEYS = ['clipT', 'clipR', 'clipB', 'clipL'];

/** propsToStyle plus catalogue H's blur and clip props. */
export function catalogHStyle(props) {
  const style = propsToStyle(props);
  if (props.blur !== undefined) style.filter = `blur(${Math.max(0, props.blur)}px)`;
  if (CLIP_KEYS.every(key => props[key] !== undefined)) style.clipPath = clipCss(props);
  return style;
}

/** One op's props with blur and clip written as the CSS strings GSAP tweens. */
export function cssProps(props) {
  if (!props) return props;
  const out = {};
  for (const [key, value] of Object.entries(props)) if (key !== 'blur' && !CLIP_KEYS.includes(key)) out[key] = value;
  if (props.blur !== undefined) out.filter = `blur(${Math.max(0, props.blur)}px)`;
  if (CLIP_KEYS.some(key => props[key] !== undefined)) {
    if (!CLIP_KEYS.every(key => props[key] !== undefined)) throw new Error('catalogue H: a clip op sets all of clipT, clipR, clipB and clipL');
    out.clipPath = clipCss(props);
  }
  return out;
}

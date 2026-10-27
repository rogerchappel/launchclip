// Catalogue H: the element library, drawn in both renderers from one view
// tree and one op list (catalogue B's conventions; kit/core/catalog-b.mjs).
// Contract: docs/KIT_CONTRACTS.md ("Catalogue H").
//
//   charts    catalog-h-charts.mjs (bar-chart, stacked-bar, pie-chart,
//             area-chart, scatter-plot, radar-chart, sparkline, progress-ring)
//             and catalog-h-flows.mjs (funnel-chart, waterfall, sankey,
//             heatmap, leaderboard, comparison-table), catalog-h-map.mjs
//             (map-highlight, on kit/core/world-110m.mjs)
//   numbers   catalog-h-numbers.mjs (odometer, flip-clock, ticker-tape,
//             slot-roll, countdown, percent-fill)
//   frames    catalog-h-frames.mjs (device-frame, window-chrome),
//             catalog-h-paper.mjs (polaroid, sticker, torn-paper, tape-note,
//             badge, ribbon) and catalog-h-callouts.mjs (speech-bubble,
//             tooltip, callout-arrow)
//   titles    catalog-h-text.mjs (motion-title: the 24 named text effects)
//   icons     catalog-h-icons.mjs (icon-grid, stroke or duotone)
//   data      catalog-h-data.mjs (unit-grid, number-line: the data-explainer
//             isotype and ruler)
//   social    catalog-i-social.mjs (social-post, social-stack, social-sort,
//             social-wall: real posts as cards, each with its source line)
//   channel   catalog-h-channel.mjs (logo-sting, subscribe-cta,
//             channel-watermark: the furniture round a channel's videos)
//   code      catalog-i-code.mjs (repo-pr-card, commit-card, diff-view,
//             evidence-chain, date-pinned-timeline) and catalog-i-terminal.mjs
//             (terminal-session): rebuilt GitHub evidence and a typing terminal
//   particles catalog-i-particles.mjs (catalogue I: particles and grids at
//             scale on a canvas painted by kit/core/particles.mjs) and
//             catalog-i-grids.mjs (grid-race, cell-grid: unit grids at scale)
//             and catalog-i-tokenizer.mjs (tokenizer: BPE chips and prices)
//
// Every module exports its VARIANTS (the default first); helpers, the series
// palette, number formats and the extra op props (blur, clip) are in
// catalog-h-base.mjs.

import {propsToStyle, rootNode, rootOps} from './catalog-b-view.mjs';
import {grammarTweens} from './grammar.mjs';
import {applyShotStates, shotStateView} from './shot-states.mjs';
import {clipCss} from './catalog-h-base.mjs';
import {CHARTS} from './catalog-h-charts.mjs';
import {FLOWS} from './catalog-h-flows.mjs';
import {NUMBERS} from './catalog-h-numbers.mjs';
import {FRAMES} from './catalog-h-frames.mjs';
import {PAPER} from './catalog-h-paper.mjs';
import {CALLOUTS} from './catalog-h-callouts.mjs';
import {TEXT} from './catalog-h-text.mjs';
import {ICON_MODULES} from './catalog-h-icons.mjs';
import {MAPS} from './catalog-h-map.mjs';
import {DATA_MODULES} from './catalog-h-data.mjs';
import {SOCIAL_MODULES} from './catalog-i-social.mjs';
import {CHANNEL_MODULES} from './catalog-h-channel.mjs';
import {CODE_MODULES} from './catalog-i-code.mjs';
import {PARTICLE_MODULES} from './catalog-i-particles.mjs';
import {GRID_MODULES} from './catalog-i-grids.mjs';
import {TOKENIZER_MODULES} from './catalog-i-tokenizer.mjs';

const ASPECTS = ['9:16', '16:9'];
const DEFINITIONS = [...CHARTS, ...FLOWS, ...NUMBERS, ...FRAMES, ...PAPER, ...CALLOUTS, ...TEXT, ...ICON_MODULES, ...MAPS, ...DATA_MODULES, ...SOCIAL_MODULES, ...CHANNEL_MODULES, ...CODE_MODULES, ...PARTICLE_MODULES, ...GRID_MODULES, ...TOKENIZER_MODULES];


export const MODULES = Object.fromEntries(DEFINITIONS.map(def => [def.id, {describe: def.describe, params: def.params, events: def.events, timing: def.timing, resolve: def.resolve, states: def.states, aspects: ASPECTS, variants: def.variants}]));
/** Each module's designed variants, the default (its original look) first. */
export const VARIANTS = Object.freeze(Object.fromEntries(DEFINITIONS.map(def => [def.id, def.variants])));
const BY_ID = Object.fromEntries(DEFINITIONS.map(def => [def.id, def]));

// The module's own view and op list, for the states engine to re-run with a state's params.
const stateHooks = def => ({view: model => def.view(model), timeline: model => { const ops = []; rootOps(model, ops); def.timeline(model, ops); return ops; }});

function definition(model) {
  const def = model && BY_ID[model.module];
  if (!def) throw new Error(`catalogue H: unknown module ${model?.module}`);
  return def;
}

/** Static element tree for a catalogue H model (initial state at scene start). */
export function catalogHView(model) {
  const def = definition(model);
  return rootNode(model, shotStateView(model, def.view(model), stateHooks(def)));
}

/** Renderer-neutral animation ops for a catalogue H model, root first. */
export function catalogHTimeline(model) {
  const ops = [];
  rootOps(model, ops);
  const def = definition(model);
  def.timeline(model, ops);
  // Shot states (kit/core/shot-states.mjs): param changes, reveals, the focus ring.
  if (model.shotStates) applyShotStates(model, ops, stateHooks(def));
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

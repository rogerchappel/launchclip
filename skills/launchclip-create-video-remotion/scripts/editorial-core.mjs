// Editorial module core: spec → resolved model. Renderer-neutral, plain ESM;
// imports only bounds.mjs (the shared bound tolerance), fonts.mjs and
// grammar.mjs (the motion grammar, which sets the
// shell enter/exit eases and durations; editorial is the identity). The
// HyperFrames emitter (skills/launchclip-create-video/scripts/
// editorial-ui-modules.mjs) and the Remotion modules (kit/remotion/modules/)
// both draw from this model, so validation, defaults, geometry, timing, events
// and theme live here only. Contract: docs/KIT_CONTRACTS.md, "Editorial core".
//
// Canonical copy: kit/core/editorial-core.mjs. The skill keeps a byte-identical
// copy next to its emitter; a test fails when they drift.
//
// All times are absolute seconds on the host timeline (spec.start + offset).
// "rect-local" geometry is in px from the module rect's top-left corner;
// "canvas" geometry is absolute. Geometry marked "estimate" comes from the
// same conservative text-fit model the validator uses (character widths of
// font * 0.65 and similar); the HyperFrames CSS lays those parts out in flow.
//
/**
 * @typedef {object} EditorialModel
 * @property {string} id
 * @property {string} kind                one of EDITORIAL_KINDS
 * @property {string} [variant]           the designed variant, for kinds in
 *   EDITORIAL_VARIANTS only (default: the first, the original look)
 * @property {'16:9'|'9:16'} aspect
 * @property {{width:number,height:number}} canvas
 * @property {number} start
 * @property {number} duration
 * @property {number} end                 start + duration (hard clear)
 * @property {{x:number,y:number,width:number,height:number}} rect   canvas px
 * @property {string} title
 * @property {string} accent              #RRGGBB
 * @property {{surface:string,foreground:string,muted:string,border:string,accentText:string}} theme
 *   Always filled. Defaults: surface #17191d (#101923 on the 'panel'
 *   surface), foreground #f7f7f8, muted #d3d6dd, border #535761 (#465568 on
 *   the 'panel' surface), accentText = accent. A supplied theme without accentText uses
 *   its foreground.
 * @property {boolean} customTheme        true when spec.theme was supplied
 * @property {'solid'|'glass'} presentation
 * @property {'standard'|'panel'} surface  'panel' = the dark-blue editorial
 *   panel (date-card, status-rack, code-snippet, excerpt-window, focus-flow,
 *   growth-chart, and treated callouts)
 * @property {number} track               HyperFrames track index of the root
 * @property {{font:number,titleFont:number,pad:number,titleLines:number,header:number,statusWidth:number}} chrome
 *   Base font size, title font size, padding, estimated title lines, the
 *   estimated height of the title block (rect-local) and the status column
 *   width (checklist).
 * @property {object} motion
 *   {supplied, enter, exit, distance, exitDistance, scale, enterDuration,
 *    exitDuration, enterStart, enterEnd, exitStart, end, enterEase:'power3.out',
 *    exitEase:'power2.in', transformOrigin, enterFrom:{opacity,x,y,scale},
 *    exitTo:{opacity,x,y,scale}}. Without spec.motion the module rises 18px
 *   into place over 0.28s and lifts 8px out over 0.22s (supplied:false).
 * @property {object} content            kind-specific, see below
 * @property {Array<{id:string,time:number,endTime?:number,duration?:number,role?:string}>} events
 * @property {{canvas:object,rect:object,motion?:{enterEnd:number,exitStart:number,end:number}}} layout
 *   layout.motion is present only when spec.motion was supplied.
 * @property {{scale:number,hero:boolean,source:'explicit'|'derived'|'legacy',layout:{width:number,height:number},natural:number}} density
 *   The kind lays out in `layout` (rect / scale, layout px) and renders scaled
 *   by `scale` from the rect's top-left corner; `natural` is the content's
 *   natural height in layout px. scale is 1 for media-window, for explicit
 *   16:9 rects without density: "fill" and for density: "fixed".
 *   chrome, cell/bar/stage/rail geometry and every kind-CSS size are layout px.
 *
 * Content shapes (all times absolute):
 *
 * media-window: {media:{kind:'image'|'video', src, sourceStart (video: number,
 *   default 0; image: null), alt}, bar:{height:48, label, dots:[3 colors]},
 *   mediaRect (canvas: rect minus the 48px bar), mediaRadius,
 *   mediaTransformOrigin:'0px -48px', mediaTrack, chromeTrack}
 *   The media sits on its own root element on `track`; the chrome on track+1.
 *
 * callout (plain): {variant:'plain', body, bodyLines}
 * callout (treated): {variant:'treated', icon|null, monospace, glow, corners,
 *   body (full copy), segments: null | [{index, text, highlight,
 *   underline: null | {time, endTime}}], time (heading/icon/edge start),
 *   copyTime, settleTime, inset:18, iconSize:48, headingLines, headingHeight,
 *   columns, lines, corners: [] | [{corner:'tl'|'tr'|'bl'|'br', time,
 *   from:{x,y}}]}. Plain body copy (segments null) renders as one run.
 *
 * excerpt-window: {mode, source|null, note, highlightMotion, textFont,
 *   lineHeight, noteHeight, textWidth, textHeight,
 *   lines:[{segments:[{text, highlight}], length, width}],
 *   focus:{line, scale, time, endTime, x, y, duration:0.5},
 *   highlight:{motion:'sweep'|'fade', time, duration, endTime, color},
 *   bar:{height:48, label, dots}, noteRect, viewport (rect-local)}
 *   The text block translates to (x, y) and scales from its top-left corner.
 *
 * date-card: {month, day, year|null, monthName, monthLabel, caption|null,
 *   captionLines, time, settleTime, bandHeight:48, dayHeight:132,
 *   durations:{day:0.32}}
 *
 * status-rack: {mode, source|null, note, noteLines, lightOn, lightOff,
 *   palette?:'status', tones?:{pending, active, pass, fail},
 *   rows:[{index, label, enterTime, states:[{index, time, lights:[3 bool],
 *   colors?:[3 hex], changes:[{light, on, color}], settleTime|null}]}]}
 *   palette/tones/colors appear only with the status palette (spec.palette
 *   "status", spec.tones, a state tone or a tone-named light); lit lights are
 *   then coloured by tone, and a change of colour alone is a change.
 *   settleTime is null for a state that changes nothing (no event).
 *   durations:{row:0.22 (row enter), light:0.18 (each light colour change)}
 *
 * code-snippet: {language, label (string | null: spec.label, false → null;
 *   else code.filename; else the language for code.source "real" (null
 *   without a language); else "<language> · Example"), filename, source
 *   ('example' | 'real'), typing, codeFont,
 *   lineHeight, lines:[{index, time, typeDuration, endTime, length,
 *   characters, tokens:[{text, type, chars?}], charTimes: null | number[]}]}
 *   With typing, character j becomes visible at charTimes[j]; the line itself
 *   fades in over 0.24s at `time` either way. durations:{line:0.24}
 *
 * audience-grid: {note, columns, rowCount, cellWidth, cellHeight, labelFont,
 *   gap:16, tiles:[{index, label, emoji, time, settleTime,
 *   cell (rect-local estimate)}], durations:{tile:0.24}}
 *
 * focus-flow: {note, options:[{index, label, selected, initial:{x,y},
 *   arriveTime}], selected, icon|null, progressLabel, horizontal, rowHeight,
 *   gap, stageHeight, optionWidth, optionFont, target:{x,y}, chosenScale,
 *   arriveTime, chooseTime, chosenMoveTime, progressTime, progressDuration,
 *   optionsSettle, chosenSettle, progressSettle, stage (rect-local estimate)}
 *   Option x/y are relative to the stage; distractors fade at chooseTime.
 *   durations:{arrive:0.24, chosenMove:0.42, distractorFade:0.16,
 *   distractorMove:0.38, progressFade:0.2}
 *
 * trend-chart / growth-chart: {variant:'trend'|'growth', mode, source|null,
 *   attribution, unit, showValues, defaultPoints, maximum, formattedMaximum,
 *   chartHeight:180, labelFont:22, countFont, metricHeight, columnWidth,
 *   gap:16, attributionLines, points:[{index, label, value, from, time,
 *   settleTime, barHeight, bar (rect-local estimate)}]}
 *   The count runs from `from` to `value` over 0.38s at each point's time.
 *
 * metric / progress: {variant:'metric'|'progress', mode, source|null,
 *   attribution, noteLines, format:{style:'number'|'percent'|'currency'|
 *   'progress', decimals, currency|null, max|null}, unit|null, max|null,
 *   label|null, unitText, unitLines, numberFont, requiredHeight, initialText,
 *   values:[{index, value, from, time, settleTime, text, scale|null,
 *   frames: null | [{time, text}]}]}
 *   frames is the 19-step (30fps, cubic-out) count-up from the previous value;
 *   progress `scale` is value/max for the fill bar (0.6s power2.out).
 *
 * checklist: {statusLabels:{pending,active,done}, statusWidth, rowHeight,
 *   labelWidth, doneBackground, check:{viewBox, path, strokeWidth},
 *   rows:[{index, label, status, time, stateSettle|null, doneTime|null,
 *   coveredSettle|null}]}
 *
 * step-rail: {numbered, activeColor, labelWidth, rail (rect-local estimate),
 *   steps:[{index, label, number, time, settleTime, fill}]}
 *   fill is the rail scaleX reached at that step (0..1).
 */

import {formatBound, withinBounds} from './bounds.mjs';
import {fontStack} from './fonts.mjs';
import {grammarDuration, grammarEase} from './grammar.mjs';

export const EDITORIAL_KINDS = ['media-window', 'checklist', 'step-rail', 'callout', 'audience-grid', 'trend-chart', 'metric', 'progress', 'date-card', 'status-rack', 'code-snippet', 'excerpt-window', 'focus-flow', 'growth-chart'];

// Small symbolic glyphs authored locally; no brand marks or arbitrary SVG input.
// Children of <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
// stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">.
export const EDITORIAL_SYMBOLS = Object.freeze({
  check: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
  warning: '<path d="m12 3 10 18H2ZM12 9v5m0 3h.01"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10m12-10v3c0 4-12 0-12 5"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5"/>',
  rocket: '<path d="M8 16c-2-5 2-11 11-12 1 9-5 13-10 11m4-6 2 2M8 12l-4 1-1 4 5-1m4 0 1 5 4-1 1-4m-10 3-4 3"/>'
});

// Design tokens shared by both renderers. Hex alphas ("16", "22", …) are
// appended to the accent or theme colors, as in CSS #RRGGBBAA.
// Fonts never name a system family: system-ui is platform-specific, and the two
// renderers resolved it to different faces (module text came out 10% wider in
// one of them).
export const EDITORIAL_STYLE = Object.freeze({
  font: Object.freeze({
    // The story's brand stacks (--lc-font-body / --lc-font-meta, set on the root
    // by both compilers), falling back to the bundled registry stacks (fonts.mjs:
    // Inter and JetBrains Mono) outside a story.
    sans: `var(--lc-font-body, ${fontStack(null, 'body')})`,
    mono: `var(--lc-font-meta, ${fontStack(null, 'meta')})`,
    display: `var(--lc-font-body, ${fontStack(null, 'body')})`
  }),
  size: Object.freeze({small: 22, lineHeight: 1.25, titleLineHeight: 1.15, day: 112, avatar: 52, count: 48, growthCount: 56, stepNumber: 24}),
  space: Object.freeze({pad: 24, bar: 48, inset: 18, gap: 16, rowGap: 18}),
  radius: Object.freeze({panel: 18, editorial: 14, check: 7, rail: 4, highlight: 3, rack: 8, focus: 12, viewer: 14, bar: 7, growthBar: 10, track: 8, focusTrack: 6, marker: 2}),
  color: Object.freeze({
    surface: '#17191d', panel: '#101923', foreground: '#f7f7f8', muted: '#d3d6dd', status: '#b8bbc3',
    border: '#535761', panelBorder: '#465568', divider: '#383c45', checkBorder: '#828791', axis: '#828791',
    bar: '#24272e', track: '#474c56', rackBorder: '#465061', rackMarker: '#7e8795', light: '#536071',
    media: '#111', calloutBody: '#e0e7ef', codeLanguage: '#b8c4d3', monthInk: '#101923', stepInk: '#17191d',
    themedInk: '#171612', dots: Object.freeze(['#ff6258', '#ffc04a', '#40c957']),
    token: Object.freeze({keyword: '#ffa9a0', string: '#add8ff', comment: '#a5b1c2', operator: '#e1bcff'})
  }),
  shadow: Object.freeze({panel: '0 16px 48px #0005', drop: '0 14px 38px #0005', panelGlow: '0 0 18px', panelGlowAlpha: '16', treatedGlow: '0 0 24px', treatedGlowAlpha: '25'}),
  glass: Object.freeze({blur: 18, fill: 'rgba(23,25,29,.86)', supportedFill: 'rgba(23,25,29,.74)', barFill: 'rgba(28,31,39,.88)', border: '#ffffff50', themeFillAlpha: 'DB', themeSupportedAlpha: 'BD', themeBarAlpha: 'E0'}),
  accentAlpha: Object.freeze({wash: '22', highlight: '55'}),
  symbol: Object.freeze({viewBox: '0 0 24 24', strokeWidth: 1.6})
});

// Timing constants, the single source for the validation below and for the
// generated timing table (EDITORIAL_TIMING_RULES, kit/core/modules.mjs
// moduleTiming(), the skill's storyboard-modules.md and `launchclip module fit`).
// Seconds; `at` values are scene-relative.
const TIMING = Object.freeze({
  minDuration: 1, enter: .28, exit: .22, leadOut: .45, motionHold: .5,
  series: Object.freeze({gap: .65, leadOut: .8}),
  gaps: Object.freeze({'step-rail': .3, 'status-rack': .3, 'code-snippet': .3, chart: .5}),
  callout: Object.freeze({settle: .4}),
  focus: Object.freeze({arrive: .24, stagger: .08, hold: .2, chosenSettle: .9, progressHold: .35}),
  growthDefaultHold: 2.4,
  settle: Object.freeze({'date-card': .32, 'excerpt-window': .5, 'code-snippet': .24})
});

/**
 * Timing rules per editorial kind, from TIMING: {minDuration (s), leadIn (the
 * earliest `at`), leadOut (the latest `at` is scene duration − leadOut),
 * gaps: [{between, seconds}], rules: [string]}. Defaults without spec.motion;
 * with motion, leadIn is motion.enterDuration and leadOut max(0.45,
 * motion.exitDuration + 0.3), and the scene needs enter + exit + 0.5 s.
 */
export const EDITORIAL_TIMING = TIMING;
export function editorialTimingRules(kind) {
  const T = TIMING, gap = (between, seconds) => ({between, seconds});
  const base = {minDuration: T.minDuration, leadIn: T.enter, leadOut: T.leadOut, gaps: [], rules: []};
  const settleBeforeExit = `every state settles before the ${T.exit} s exit begins`;
  switch (kind) {
    case 'media-window': return {...base, leadIn: null, leadOut: null, rules: ['no timed beats; the window holds for the scene']};
    case 'checklist': return {...base, rules: ['rows[].doneAt comes after rows[].at (status "active" only)']};
    case 'step-rail': return {...base, gaps: [gap('steps[].at', T.gaps['step-rail'])]};
    case 'callout': return {...base, rules: [`treated: underlineAt ≥ treatment.at + ${T.callout.settle} s; the treatment settles ${T.callout.settle} s after treatment.at, before the exit`]};
    case 'audience-grid': return {...base};
    case 'trend-chart': return {...base, gaps: [gap('chart.points[].at', T.gaps.chart)]};
    case 'growth-chart': return {...base, gaps: [gap('growth.points[].at', T.gaps.chart)], rules: [`default points (no growth.points) need a scene of at least ${round2(T.enter + T.exit + T.growthDefaultHold)} s`]};
    case 'metric': case 'progress': return {...base, leadOut: T.series.leadOut, gaps: [gap(`${kind}.values[].at`, T.series.gap)]};
    case 'date-card': return {...base, rules: [`the day settles ${T.settle['date-card']} s after date.at; ${settleBeforeExit}`]};
    case 'status-rack': return {...base, gaps: [gap('rack.rows[].states[].at (per row)', T.gaps['status-rack'])], rules: [settleBeforeExit]};
    case 'code-snippet': return {...base, gaps: [gap('code.lines[].at', T.gaps['code-snippet'])], rules: ['with typing, a line starts after the previous line finishes typing (at + typeDuration; typeDuration 0.12–2 s, default 0.6)', settleBeforeExit]};
    case 'excerpt-window': return {...base, rules: [`the focus settles ${T.settle['excerpt-window']} s after focus.at; ${settleBeforeExit}`]};
    case 'focus-flow': return {...base, rules: [`chooseAt ≥ arriveAt + ${T.focus.arrive} + ${T.focus.stagger} × (options − 1) + ${T.focus.hold} s`, `progressAt ≥ chooseAt + ${T.focus.chosenSettle} s`, `progressAt + progressDuration + ${T.focus.progressHold} s ≤ scene duration − ${T.exit} s`]};
    default: return base;
  }
}
const round2 = value => Math.round(value * 100) / 100;

const PANEL_KINDS = ['date-card', 'status-rack', 'code-snippet', 'excerpt-window', 'focus-flow', 'growth-chart'];
const DIRECTIONS = ['left', 'right', 'up', 'down', 'none'];
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const TOKEN_TYPES = ['plain', 'keyword', 'string', 'number', 'comment', 'operator'];
const CHECK = {viewBox: '0 0 96 96', path: 'M34 48l10 10 18-20', strokeWidth: 7};

function object(value, label, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${label}: unsupported ${key}`);
}
function number(value, label, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !withinBounds(value, min, max)) throw new Error(`${label} must be between ${formatBound(min)} and ${formatBound(max)}`);
  return value;
}
function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} must contain 1–${max} characters`);
  return value;
}
function localMedia(media) {
  object(media, 'media', ['kind', 'src', 'sourceStart']);
  if (!['image', 'video'].includes(media.kind)) throw new Error('media.kind must be image or video');
  text(media.src, 'media.src', 240);
  if (!/^[a-zA-Z0-9_./ -]+$/.test(media.src) || media.src.startsWith('/') || media.src.includes('..') || !media.src.startsWith('assets/')) throw new Error('media.src must be a project-local assets/ path');
  if (media.sourceStart !== undefined) number(media.sourceStart, 'media.sourceStart', 0, 86400);
  if (media.kind === 'image' && media.sourceStart !== undefined) throw new Error('sourceStart is only for video');
}
function series(config, label, duration, enterDuration = .28, exitDuration = null) {
  if (!['illustration', 'data'].includes(config.mode)) throw new Error(`${label}.mode must be illustration or data`);
  if (config.mode === 'data') text(config.source, `${label}.source for real data`, 80);
  else if (config.source !== undefined) throw new Error('illustration cannot claim a real data source');
  if (!Array.isArray(config.values) || config.values.length < 1 || config.values.length > 8) throw new Error(`${label}.values must contain 1–8 entries`);
  let previous = -1;
  config.values.forEach((entry, i) => {
    object(entry, `${label}.values[${i}]`, ['value', 'at']);
    number(entry.value, 'value', -1_000_000_000, 1_000_000_000);
    number(entry.at, 'at', enterDuration, duration - Math.max(TIMING.series.leadOut, (exitDuration ?? 0) + .6));
    if (entry.at <= previous || (previous >= 0 && entry.at - previous + 1e-6 < TIMING.series.gap)) throw new Error(`value times must increase with at least ${TIMING.series.gap}s between events`);
    previous = entry.at;
  });
  return config.mode === 'illustration' ? 'Illustration · example values' : `Source: ${config.source}`;
}
// Count-up states: 19 finite text states over 18 frames at 30fps (cubic out).
function countFrames(from, to, format, time) {
  const frames = [];
  for (let frame = 0; frame <= 18; frame++) {
    const progress = frame / 18, eased = 1 - (1 - progress) ** 3;
    frames.push({time: time + frame / 30, text: format(from + (to - from) * eased)});
  }
  return frames;
}
function motionSpec(value, duration) {
  if (value === undefined) return null;
  object(value, 'motion', ['enter', 'exit', 'distance', 'enterDuration', 'exitDuration', 'scale']);
  const config = {enter: 'up', exit: 'up', distance: 48, enterDuration: .36, exitDuration: .28, scale: 1, ...value};
  for (const key of ['enter', 'exit']) if (!DIRECTIONS.includes(config[key])) throw new Error(`motion.${key} must be ${DIRECTIONS.join(', ')}`);
  number(config.distance, 'motion.distance', 0, 96);
  number(config.enterDuration, 'motion.enterDuration', .2, .6);
  number(config.exitDuration, 'motion.exitDuration', .16, .5);
  number(config.scale, 'motion.scale', .92, 1);
  if (duration < config.enterDuration + config.exitDuration + .5) throw new Error('motion must leave at least 0.5s of readable hold');
  return config;
}
function offset(direction, distance) {
  return {x: direction === 'left' ? -distance : direction === 'right' ? distance : 0,
    y: direction === 'up' ? -distance : direction === 'down' ? distance : 0};
}
const hex = value => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

// Status palette (status-rack palette: "status", per-state or per-light tone).
// pending: the muted foreground; active: the accent (brand primary); pass and
// fail: a green and a red, taken from spec.tones (brand.colors.pass / fail via
// the module registry) or derived, then pushed toward the foreground until each
// lit light clears 3:1 against the surface (WCAG non-text contrast).
export const STATUS_TONES = Object.freeze(['pending', 'active', 'pass', 'fail']);
const STATUS_POSITIONS = Object.freeze(['fail', 'active', 'pass']);
const STATUS_BASE = Object.freeze({pass: '#2fbf71', fail: '#f2545b'});
const channels = value => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
const luminance = value => {
  const [r, g, b] = channels(value).map(c => c / 255).map(c => (c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4));
  return .2126 * r + .7152 * g + .0722 * b;
};
export function statusContrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + .05) / (lo + .05);
}
const mix = (top, bottom, amount) => `#${channels(top).map((c, i) => Math.round(c * amount + channels(bottom)[i] * (1 - amount)).toString(16).padStart(2, '0')).join('')}`;
function legible(colour, surface, foreground) {
  for (let step = 0; step <= 10; step++) {
    const candidate = step ? mix(foreground, colour, step / 10) : colour;
    if (statusContrast(candidate, surface) >= 3) return candidate;
  }
  return foreground;
}
function statusTones(input, theme, accent) {
  if (input.palette !== undefined && input.palette !== 'status') throw new Error('palette must be "status"');
  if (input.tones !== undefined) {
    object(input.tones, 'tones', STATUS_TONES);
    for (const [key, value] of Object.entries(input.tones)) if (!hex(value)) throw new Error(`tones.${key} must be a six-digit hex color`);
  }
  const used = input.palette === 'status' || input.tones !== undefined || (Array.isArray(input.rack?.rows) && input.rack.rows.some(row => Array.isArray(row?.states) && row.states.some(state => state?.tone !== undefined || (Array.isArray(state?.lights) && state.lights.some(light => typeof light === 'string')))));
  if (!used) return null;
  const supplied = input.tones ?? {};
  return {pending: legible(supplied.pending ?? theme.muted, theme.surface, theme.foreground), active: legible(supplied.active ?? accent, theme.surface, theme.foreground),
    pass: legible(supplied.pass ?? STATUS_BASE.pass, theme.surface, theme.foreground), fail: legible(supplied.fail ?? STATUS_BASE.fail, theme.surface, theme.foreground)};
}

// Density (docs: skills-src/references/editorial-ui-modules.md, "Defaults").
// A module lays out in a "layout box" of rect / scale and renders scaled by
// `scale` from the rect's top-left corner, so every size in the kind CSS and
// every rect-local geometry value is in layout px (canvas px = layout px *
// scale). The largest scale, from DENSITY.max down to 1, at which the content
// validates and its natural height fits is used for derived rects (no rect)
// in both aspects, for explicit 9:16 rects, and for explicit 16:9 rects that
// opt in with density: "fill". An explicit 16:9 rect without the opt-in (or
// any rect with density: "fixed") resolves at scale 1, byte-identical to the
// pre-density output.
export const DENSITY = Object.freeze({
  max: 2, min: 1, step: .05,
  // RFC §5 Shorts geometry, reference 1080x1920: safe zone, the caption band
  // top (shorts-delivery.md) and the centre-of-mass target. The default card
  // centre sits just below the lower-third line (safe.y + safe.height / 2) so
  // the lower third is never empty.
  portrait: Object.freeze({x: 90, width: 840, top: 280, captionTop: 1190, bottom: 1450, centre: 880, mediaHeight: 521}),
  // Landscape geometry, reference 1920x1080 (layout-check's landscape
  // profile): title-safe x 96–1824 / y 54–1026, caption band from y 864. The
  // default card is centred horizontally, kept inside top–captionTop (a
  // breathing margin inside title-safe, 24 px clear of the caption band) and
  // centred on the frame centre where it fits. widths: the card widths tried
  // in turn (a composed centre column, then wider for dense content, then the
  // whole safe width); minScale: the smallest scale each width accepts before
  // the next is tried. Body copy follows the card width (about 45 px at 1000
  // wide); maxScale caps padding and fixed-size type, so cards read big on a
  // 1920-wide frame without crowding it. safeX/safeWidth/bottom document the
  // title-safe zone.
  landscape: Object.freeze({maxScale: 1.75, safeX: 96, safeWidth: 1728, top: 96, captionTop: 840, bottom: 1026, centre: 540,
    widths: Object.freeze([1000, 1440, 1728]), minScale: Object.freeze([1.4, 1, 1]), mediaWidth: 1200}),
  // Hero numbers may grow to this layout size when density applies: the metric
  // number is the hero; a progress card's hero is its bar, so its number stays
  // smaller.
  heroNumber: 120, heroProgressNumber: 88, numberCap: 64
});
const LEGACY_RECT = {'16:9': {x: 80, y: 480, width: 680, height: 500}, '9:16': {x: 90, y: 960, width: 900, height: 740}};
const BASE = Object.freeze({scale: 1, hero: false});
const DENSITY_MODES = ['fill', 'fixed'];

function candidates(max = DENSITY.max) {
  const list = [];
  for (let scale = max; scale >= DENSITY.min - 1e-9; scale -= DENSITY.step) list.push({scale: Math.round(scale * 100) / 100, hero: true});
  return list;
}

// Largest density candidate at which the content validates and its natural
// height fits the explicit rect; else the scale-1 resolution (or its error).
// With an explicit density: "fill" the search is grow-only: a candidate must
// reach the module's default placement for that aspect (the content-derived
// card) in type scale or in rendered text size (minTextPx), so a short rect
// can never give smaller type than leaving the rect out. When no candidate
// does, it throws a "rect too short" error that the module registry extends
// with a fit hint, as a rect that fits nothing does without fill.
function fillRect(options, input, rect, max) {
  if (rect && typeof rect === 'object' && input.kind !== 'media-window') {
    const floor = input.density === 'fill' ? defaultDensity(options, input) : null;
    const grows = model => floor === null || model.density.scale >= floor.scale - 1e-9 || (model.minTextPx !== null && floor.minTextPx !== null && model.minTextPx >= floor.minTextPx - .01);
    for (const candidate of candidates(max)) {
      try {
        const model = resolveAt(options, input, rect, candidate, 'explicit');
        if (model.density.natural <= model.density.layout.height + .5 && grows(model)) return model;
      } catch { /* try a smaller scale */ }
    }
    if (floor !== null) {
      const base = resolveAt(options, input, rect, BASE, 'explicit');
      if (grows(base)) return base;
      throw new Error(`density "fill" never shrinks type: this rect is too short to hold the ${input.kind} at its default scale ${formatBound(floor.scale)} (${formatBound(floor.minTextPx ?? 0)} px text); enlarge the rect, omit it for the default card, or drop density: "fill" to keep scale 1`);
    }
  }
  return resolveAt(options, input, rect, BASE, 'explicit');
}

// Scale and minTextPx of the module's default (content-derived) placement;
// null when it does not resolve or falls back to the legacy footprint.
function defaultDensity(options, input) {
  const {rect: _rect, density: _density, ...rest} = input;
  try {
    const model = resolveEditorialModule(rest, options);
    return model.density.source === 'derived' ? {scale: model.density.scale, minTextPx: model.minTextPx} : null;
  } catch { return null; }
}

// Content-derived placement: for each pass, the largest candidate scale whose
// natural height fits the band at that width; the card hugs its content and is
// centred on `centre`, kept inside top..limit. Returns null when nothing fits.
function derivedRect(options, input, passes, scales) {
  for (const {x, width, top, limit, centre, maxHeight = Infinity, minScale = 0} of passes) {
    const band = limit - top;
    for (const candidate of scales) {
      if (candidate.scale < minScale) break;
      let probe;
      try { probe = resolveAt(options, input, {x, y: top, width, height: band}, candidate, 'derived'); } catch { continue; }
      const height = Math.max(160, Math.ceil(probe.density.natural * candidate.scale));
      if (height > Math.min(band, maxHeight)) continue;
      const y = Math.round(Math.min(limit - height, Math.max(top, centre - height / 2)));
      try { return resolveAt(options, input, {x, y, width, height}, candidate, 'derived'); } catch { /* next candidate */ }
    }
  }
  return null;
}

/** @returns {EditorialModel} */
// Footage checklist type-in (docs/SUBJECT_EFFECTS_RFC.md §6.2): in the
// footage-led lane each row fades in on its `at` word and its label types in
// letter by letter, then ticks on doneAt as before. The typing takes
// TYPE_IN.perChar a letter, at most TYPE_IN.window, and finishes
// TYPE_IN.beforeDone before a doneAt tick. Each letter lands on the frame
// grid, so both renderers show the same text on every frame.
export const TYPE_IN = Object.freeze({perChar: 0.04, window: 0.6, beforeDone: 0.1, fade: 0.16});

/**
 * A resolved checklist model with type-in rows: each row gains `typed`
 * ([{time, text}] text sets, the first at the row's time) and `typeEnd`, the
 * content gains `typeIn: true`, and a `<id>-row-<i>-typing-start` event
 * (with endTime) per row cues the typing track. Returns a new model.
 */
export function checklistTypeIn(model, {fps = 30} = {}) {
  if (!Array.isArray(model?.content?.rows)) return model;
  const grid = value => Math.round(Math.ceil(value * fps - 1e-6) / fps * 1e6) / 1e6;
  const events = [...(model.events ?? [])];
  const rows = model.content.rows.map(row => {
    const letters = [...row.label];
    let window = Math.min(TYPE_IN.window, letters.length * TYPE_IN.perChar);
    if (row.doneTime !== null) window = Math.max(0, Math.min(window, row.doneTime - row.time - TYPE_IN.beforeDone));
    const typed = letters.map((_, k) => ({time: k ? Math.max(grid(row.time), grid(row.time + (k / letters.length) * window)) : row.time, text: letters.slice(0, k + 1).join('')}));
    const typeEnd = typed.at(-1).time;
    events.push({id: `${model.id}-row-${row.index}-typing-start`, time: row.time, endTime: Math.max(typeEnd, row.time + 1 / fps)});
    return {...row, typed, typeEnd};
  });
  return {...model, content: {...model.content, typeIn: true, rows}, events};
}

export function resolveEditorialModule(input, options = {}) {
  const plain = input && typeof input === 'object' && !Array.isArray(input);
  if (!plain || !['16:9', '9:16'].includes(input.aspect) || !EDITORIAL_KINDS.includes(input.kind) || (input.density !== undefined && !DENSITY_MODES.includes(input.density))) return resolveAt(options, input, input?.rect, BASE, 'explicit');
  const explicit = input.rect !== undefined;
  const portrait = input.aspect === '9:16';
  const fixed = input.density === 'fixed';
  if (explicit) {
    // Explicit rect: keep the rect and, where density applies (9:16, or 16:9
    // with density: "fill"), grow the type until the content would no longer
    // fit. The final BASE attempt is the pre-density behaviour, so any spec
    // that resolved before still resolves (or throws the same error).
    if (fixed || (!portrait && input.density !== 'fill')) return resolveAt(options, input, input.rect, BASE, 'explicit');
    return fillRect(options, input, input.rect, portrait ? DENSITY.max : DENSITY.landscape.maxScale);
  }
  if (input.kind === 'media-window') {
    if (!portrait) {
      // 16:9 media frame (16:9 media under the 48 px bar), centred, above the
      // caption band.
      const L = DENSITY.landscape, width = L.mediaWidth, height = Math.round(width * 9 / 16) + 48;
      const y = Math.round(Math.min(L.captionTop - height, Math.max(L.top, L.centre - height / 2)));
      return resolveAt(options, input, {x: Math.round((1920 - width) / 2), y, width, height}, BASE, 'derived');
    }
    const P = DENSITY.portrait, height = P.mediaHeight;
    return resolveAt(options, input, {x: P.x, y: Math.round(P.centre - height / 2), width: P.width, height}, BASE, 'derived');
  }
  const scales = fixed ? [BASE] : candidates(portrait ? DENSITY.max : DENSITY.landscape.maxScale);
  if (!portrait) {
    // 16:9 default: a centred card inside the landscape title-safe zone,
    // above the caption band, at the largest scale its content allows.
    const L = DENSITY.landscape;
    const passes = L.widths.map((width, i) => ({x: Math.round((1920 - width) / 2), width, top: L.top, limit: L.captionTop, centre: L.centre, minScale: fixed ? 0 : L.minScale[i]}));
    return derivedRect(options, input, passes, scales) ?? resolveAt(options, input, LEGACY_RECT['16:9'], BASE, 'legacy');
  }
  // 9:16 default: safe-zone width, the largest scale whose natural height
  // fits above the caption band (else above the safe-zone bottom), centred
  // on the RFC centre-of-mass target.
  // First choice keeps the card centre below the lower-third line at near
  // phone scale; then any scale above the caption band; then the whole safe
  // zone.
  const P = DENSITY.portrait, lowerThird = P.top + (P.bottom - P.top) / 2;
  const column = {x: P.x, width: P.width, top: P.top, centre: P.centre};
  const passes = [{...column, limit: P.captionTop, maxHeight: 2 * (P.captionTop - lowerThird - 1), minScale: fixed ? 0 : 1.8}, {...column, limit: P.captionTop}, {...column, limit: P.bottom}];
  return derivedRect(options, input, passes, scales) ?? resolveAt(options, input, LEGACY_RECT['9:16'], BASE, 'legacy');
}

function resolveAt(options, input, suppliedRect, density, source) {
  object(input, 'module', ['id', 'kind', 'aspect', 'start', 'duration', 'rect', 'density', 'title', 'accent', 'rows', 'steps', 'media', 'body', 'track', 'statusLabels', 'audience', 'chart', 'metric', 'progress', 'presentation', 'numbered', 'motion', 'treatment', 'date', 'rack', 'code', 'excerpt', 'theme', 'focus', 'growth', 'label', 'palette', 'tones', 'variant']);
  if (!/^[a-z][a-z0-9-]{0,59}$/.test(input.id ?? '')) throw new Error('id must be a unique lowercase DOM-safe identifier');
  if (!EDITORIAL_KINDS.includes(input.kind)) throw new Error(`kind must be ${EDITORIAL_KINDS.join(', ')}`);
  if (input.presentation !== undefined && !['solid', 'glass'].includes(input.presentation)) throw new Error('presentation must be solid or glass');
  const variants = EDITORIAL_VARIANTS[input.kind];
  if (input.variant !== undefined && !variants) throw new Error(`variant: ${input.kind} has no designed variants`);
  if (input.variant !== undefined && !variants.includes(input.variant)) throw new Error(`variant must be one of ${variants.join(', ')} (the ${input.kind} variants); got ${JSON.stringify(input.variant)}`);
  const variant = variants ? input.variant ?? variants[0] : null;
  if (input.numbered !== undefined && (input.kind !== 'step-rail' || typeof input.numbered !== 'boolean')) throw new Error('numbered is a boolean for step-rail only');
  if (!['16:9', '9:16'].includes(input.aspect)) throw new Error('aspect must be 16:9 or 9:16');
  if (input.density !== undefined && !DENSITY_MODES.includes(input.density)) throw new Error('density must be fill or fixed');
  const kind = input.kind, id = input.id;
  const canvas = input.aspect === '16:9' ? {width: 1920, height: 1080} : {width: 1080, height: 1920};
  const start = number(input.start, 'start', 0, 86400);
  const duration = number(input.duration, 'duration', TIMING.minDuration, 3600);
  const movement = motionSpec(input.motion, duration);
  const enterDuration = movement?.enterDuration ?? TIMING.enter, exitDuration = movement?.exitDuration ?? TIMING.exit;
  // Motion grammar (grammar.mjs): editorial keeps .28/.22 and power3.out /
  // power2.in exactly; other grammars scale the default shell durations
  // (clamped to the motion-spec range) and swap the enter/exit eases. Event
  // windows and content defaults keep the editorial durations, so a grammar
  // never makes a valid spec invalid.
  const grammar = options.grammar ?? null;
  // A grammar may let the shell arrive more slowly than the spec range (cinematic: up to 0.8 s).
  const shellEnter = movement ? enterDuration : grammarDuration(grammar, 'enter', enterDuration, {min: .2, max: grammar?.panelEnter ?? .36});
  const shellExit = movement ? exitDuration : grammarDuration(grammar, 'exit', exitDuration, {min: .16, max: .28});
  const rect = suppliedRect ?? LEGACY_RECT[input.aspect];
  object(rect, 'rect', ['x', 'y', 'width', 'height']);
  number(rect.width, 'rect.width', 420, canvas.width);
  number(rect.height, 'rect.height', 160, canvas.height);
  number(rect.x, 'rect.x', 0, canvas.width - rect.width);
  number(rect.y, 'rect.y', 0, canvas.height - rect.height);
  // Layout box: content sizes and rect-local geometry are in layout px.
  const scale = density.scale, hero = density.hero;
  const box = scale === 1 ? {width: rect.width, height: rect.height} : {width: rect.width / scale, height: rect.height / scale};
  // The text-fit model assumes at least the 420 px minimum width.
  if (box.width < 420) throw new Error('layout box too narrow for this scale');
  let natural = 0;
  const title = text(input.title, 'title', 54);
  const accent = input.accent ?? '#FF6A00';
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) throw new Error('accent must be a six-digit hex color');
  let custom = null;
  if (input.theme !== undefined) {
    object(input.theme, 'theme', ['surface', 'foreground', 'muted', 'border', 'accentText']);
    for (const key of ['surface', 'foreground', 'muted', 'border']) if (!hex(input.theme[key])) throw new Error(`theme.${key} must be a six-digit hex color`);
    if (input.theme.accentText !== undefined && !hex(input.theme.accentText)) throw new Error('theme.accentText must be a six-digit hex color');
    custom = {surface: input.theme.surface, foreground: input.theme.foreground, muted: input.theme.muted, border: input.theme.border, accentText: input.theme.accentText ?? input.theme.foreground};
  }
  const allowed = {'media-window': ['media'], checklist: ['rows'], 'step-rail': ['steps'], callout: ['body', 'treatment'], 'audience-grid': ['audience'], 'trend-chart': ['chart'], metric: ['metric'], progress: ['progress'], 'date-card': ['date'], 'status-rack': ['rack'], 'code-snippet': ['code'], 'excerpt-window': ['excerpt'], 'focus-flow': ['focus'], 'growth-chart': ['growth']}[kind];
  for (const key of ['media', 'rows', 'steps', 'body', 'audience', 'chart', 'metric', 'progress', 'treatment', 'date', 'rack', 'code', 'excerpt', 'focus', 'growth']) if (input[key] !== undefined && !allowed.includes(key)) throw new Error(`${kind} does not accept ${key}`);
  if (input.label !== undefined && kind !== 'code-snippet') throw new Error('label is only for code-snippet');
  for (const key of ['palette', 'tones']) if (input[key] !== undefined && kind !== 'status-rack') throw new Error(`${key} is only for status-rack`);
  const statusLabels = {pending: 'Pending', active: 'Active', done: 'Done', ...(input.statusLabels ?? {})};
  if (input.statusLabels !== undefined) {
    if (kind !== 'checklist') throw new Error('statusLabels is only for checklist');
    object(input.statusLabels, 'statusLabels', ['pending', 'active', 'done']);
    for (const label of Object.values(statusLabels)) text(label, 'status label', 14);
  }
  const font = Math.max(24, Math.min(36, Math.round(box.width / 22)));
  const statusWidth = Math.max(100, Math.ceil(Math.max(...Object.values(statusLabels).map(label => label.length)) * (font - 6) * .65));
  const pad = EDITORIAL_STYLE.space.pad, titleLines = Math.ceil(title.length / Math.max(1, Math.floor((box.width - 48) / ((font + 4) * .65))));
  const header = pad * 2 + titleLines * (font + 4) * 1.15;
  const track = input.track ?? 2;
  number(track, 'track', 1, 98);
  if (!Number.isInteger(track)) throw new Error('track must be an integer');
  const panel = PANEL_KINDS.includes(kind) || (kind === 'callout' && input.treatment !== undefined);
  const C = EDITORIAL_STYLE.color;
  const theme = custom ?? {surface: panel ? C.panel : C.surface, foreground: C.foreground, muted: C.muted, border: panel ? C.panelBorder : C.border, accentText: accent};
  const events = [{id: `${id}-enter`, time: start + enterDuration}];
  const at = (value, label) => number(value, label, enterDuration, duration - (movement ? Math.max(TIMING.leadOut, exitDuration + .3) : TIMING.leadOut));
  const motion = movement
    ? {supplied: true, enter: movement.enter, exit: movement.exit, distance: movement.distance, exitDistance: movement.distance, scale: movement.scale, enterDuration, exitDuration,
      enterFrom: {opacity: 0, ...offset(movement.enter, movement.distance), scale: movement.scale}, exitTo: {opacity: 0, ...offset(movement.exit, movement.distance), scale: movement.scale}}
    : {supplied: false, enter: 'down', exit: 'up', distance: 18, exitDistance: 8, scale: 1, enterDuration: shellEnter, exitDuration: shellExit,
      enterFrom: {opacity: 0, x: 0, y: 18, scale: 1}, exitTo: {opacity: 0, x: 0, y: -8, scale: 1}};
  Object.assign(motion, {enterStart: start, enterEnd: start + shellEnter, exitStart: start + duration - shellExit, end: start + duration, enterEase: grammarEase(grammar, 'power3.out'), exitEase: grammarEase(grammar, 'power2.in'), transformOrigin: '0px 0px'});
  // A variant's own entrance, when the spec sets no motion: the shell's
  // timing (and so every event window) stays the default's; only where it
  // comes from changes. Renderers follow enterFrom/exitTo when supplied.
  const entrance = !movement && VARIANT_ENTRANCES[variant];
  if (entrance) Object.assign(motion, {supplied: true, enterFrom: {opacity: 0, ...entrance.from}, exitTo: {opacity: 0, ...entrance.to}, transformOrigin: entrance.origin});
  let content;

  if (kind === 'media-window') {
    localMedia(input.media);
    const source = input.media;
    content = {media: {kind: source.kind, src: source.src, sourceStart: source.kind === 'video' ? (source.sourceStart ?? 0) : null, alt: title},
      bar: {height: 48, label: title, dots: [...C.dots]},
      mediaRect: {x: rect.x, y: rect.y + 48, width: rect.width, height: rect.height - 48}, mediaRadius: EDITORIAL_STYLE.radius.panel,
      mediaTransformOrigin: '0px -48px', mediaTrack: track, chromeTrack: track + 1};
  } else if (kind === 'callout') {
    if (input.treatment === undefined) {
      text(input.body, 'body', 160);
      const lines = Math.ceil(input.body.length / Math.max(18, Math.floor((box.width - pad * 2) / (font * .58))));
      if (box.height < header + lines * font * 1.25 + pad) throw new Error('callout rect too short for body');
      natural = header + Math.max(lines, Math.ceil(input.body.length / Math.max(1, Math.floor((box.width - pad * 2) / (font * .62))))) * font * 1.25 + pad;
      content = {variant: 'plain', body: input.body, bodyLines: lines};
    } else {
      const treatment = input.treatment;
      object(treatment, 'treatment', ['icon', 'monospace', 'glow', 'corners', 'segments', 'at']);
      for (const key of ['monospace', 'glow', 'corners']) if (treatment[key] !== undefined && typeof treatment[key] !== 'boolean') throw new Error(`treatment.${key} must be a boolean`);
      if (treatment.icon !== undefined && !Object.hasOwn(EDITORIAL_SYMBOLS, treatment.icon)) throw new Error('icon must be terminal, branch, users, rocket, check or warning');
      let copy, segments = null; const chunks = [];
      if (treatment.segments !== undefined) {
        if (input.body !== undefined) throw new Error('segments replace body; do not supply both');
        if (!Array.isArray(treatment.segments) || treatment.segments.length < 1 || treatment.segments.length > 12) throw new Error('segments must contain 1–12 entries');
        copy = ''; segments = treatment.segments.map((segment, i) => {
          object(segment, 'segment', ['text', 'highlight', 'underlineAt']);
          if (typeof segment.text !== 'string' || !segment.text.length || segment.text.length > 160) throw new Error('segment.text must contain 1–160 characters');
          if (segment.highlight !== undefined && typeof segment.highlight !== 'boolean') throw new Error('segment.highlight must be a boolean');
          copy += segment.text;
          let underline = null;
          if (segment.underlineAt !== undefined) {
            if (/[\r\n\t]/.test(segment.text) || segment.text.length * font * .68 > box.width - 36) throw new Error('underlined phrase must fit one line');
            const time = start + at(segment.underlineAt, 'segment.underlineAt');
            underline = {time, endTime: time + .28}; chunks.push(segment.text.length);
          } else chunks.push(...(segment.text.match(/\S+\s*|\s+/g) ?? []).map(part => part.length));
          return {index: i, text: segment.text, highlight: segment.highlight === true, underline};
        });
        text(copy, 'combined segments', 160);
      } else copy = text(input.body, 'body', 160);
      const underlines = (segments ?? []).filter(segment => segment.underline);
      const inset = 18, iconWidth = treatment.icon ? 60 : 0;
      const headingLines = Math.ceil(title.length / Math.max(1, Math.floor((box.width - inset * 2 - iconWidth) / ((font + 2) * .68))));
      const headingHeight = Math.max(treatment.icon ? 48 : 0, headingLines * (font + 2) * 1.2);
      const columns = Math.max(1, Math.floor((box.width - inset * 2) / (font * .68)));
      let lines = Math.ceil(copy.length / columns);
      if (underlines.length) {let count = 1, used = 0; for (const chunk of chunks) {if (used && used + chunk > columns) {count++; used = 0;} count += Math.max(0, Math.ceil(chunk / columns) - 1); used = chunk > columns ? chunk % columns : used + chunk;} lines = Math.max(lines, count);}
      if (box.height < inset * 3 + headingHeight + lines * font * 1.3) throw new Error('treated callout rect too short for copy');
      natural = inset * 3 + headingHeight + lines * font * 1.3 + 8;
      const time = start + at(treatment.at ?? enterDuration, 'treatment.at');
      underlines.forEach(({index, underline}) => {
        if (underline.time < time + TIMING.callout.settle) throw new Error('underline must follow treatment settle');
        events.push({id: `${id}-underline-${index}-settle`, time: underline.time + .28});
      });
      if (treatment.corners && (rect.x < 12 || rect.y < 12 || rect.x + rect.width > canvas.width - 12 || rect.y + rect.height > canvas.height - 12)) throw new Error('corners require 12px canvas clearance');
      const corners = treatment.corners ? ['tl', 'tr', 'bl', 'br'].map((corner, i) => ({corner, time: time + i * .04, from: {x: corner.endsWith('l') ? 6 : -6, y: corner.startsWith('t') ? 6 : -6}})) : [];
      events.push({id: `${id}-treatment-settle`, time: time + .4});
      content = {variant: 'treated', icon: treatment.icon ?? null, monospace: treatment.monospace === true, glow: treatment.glow === true, corners, body: copy, segments,
        time, copyTime: time + .08, settleTime: time + .4, inset, iconSize: 48, headingLines, headingHeight, columns, lines};
    }
  } else if (kind === 'excerpt-window') {
    object(input.excerpt, 'excerpt', ['mode', 'source', 'lines', 'focus', 'highlightMotion']);
    const excerpt = input.excerpt;
    if (excerpt.highlightMotion !== undefined && typeof excerpt.highlightMotion !== 'boolean') throw new Error('excerpt.highlightMotion must be a boolean');
    if (!['illustration', 'data'].includes(excerpt.mode)) throw new Error('excerpt.mode must be illustration or data');
    if (excerpt.mode === 'data') text(excerpt.source, 'excerpt.source', 80);
    else if (excerpt.source !== undefined) throw new Error('illustration cannot claim a real data source');
    if (!Array.isArray(excerpt.lines) || excerpt.lines.length < 1 || excerpt.lines.length > 5) throw new Error('excerpt.lines must contain 1–5 lines');
    object(excerpt.focus, 'excerpt.focus', ['line', 'scale', 'at']);
    number(excerpt.focus.line, 'focus.line', 0, excerpt.lines.length - 1);
    if (!Number.isInteger(excerpt.focus.line)) throw new Error('focus.line must be an integer');
    const zoom = number(excerpt.focus.scale, 'focus.scale', 1, 1.3), time = start + at(excerpt.focus.at, 'focus.at');
    const note = excerpt.mode === 'illustration' ? 'Illustration · text excerpt' : `Source: ${excerpt.source}`;
    const textFont = Math.max(24, Math.min(32, Math.floor(box.width / 24))), lineHeight = Math.ceil(textFont * 1.5);
    const noteHeight = Math.ceil(note.length / Math.floor((box.width - 48) / (22 * .65))) * 29 + 16;
    const viewWidth = box.width - 48, viewHeight = box.height - 48 - noteHeight - 48;
    const textHeight = lineHeight * excerpt.lines.length;
    if (viewHeight < textHeight * zoom) throw new Error('excerpt-window rect too short for focused text');
    natural = 48 + noteHeight + 48 + textHeight * zoom + lineHeight;
    let longest = 0;
    const lines = excerpt.lines.map(line => {
      object(line, 'excerpt line', ['segments']);
      if (!Array.isArray(line.segments) || line.segments.length < 1 || line.segments.length > 12) throw new Error('excerpt segments must contain 1–12 entries');
      let length = 0;
      const segments = line.segments.map(segment => {
        object(segment, 'excerpt segment', ['text', 'highlight']);
        if (typeof segment.text !== 'string' || segment.text.length < 1 || segment.text.length > 120 || /[\r\n\t]/.test(segment.text)) throw new Error('excerpt segment must be short single-line text');
        if (segment.highlight !== undefined && typeof segment.highlight !== 'boolean') throw new Error('highlight must be a boolean');
        length += segment.text.length;
        return {text: segment.text, highlight: segment.highlight === true};
      });
      const width = length * textFont * .68;
      if (width * zoom > viewWidth) throw new Error('excerpt line too long at focused zoom; shorten or widen it');
      longest = Math.max(longest, width);
      return {segments, length, width};
    });
    // Focus travel is compiled from the supplied line and fixed geometry;
    // all text remains within the viewport at both endpoints and maximum zoom.
    const x = (viewWidth - longest * zoom) / 2;
    const y = Math.max(0, Math.min(viewHeight - textHeight * zoom, viewHeight / 2 - (excerpt.focus.line + .5) * lineHeight * zoom));
    const sweep = excerpt.highlightMotion === true;
    if (sweep) events.push({id: `${id}-highlight-sweep-settle`, time: time + .35});
    events.push({id: `${id}-excerpt-focus`, time: time + .5});
    content = {mode: excerpt.mode, source: excerpt.mode === 'data' ? excerpt.source : null, note, highlightMotion: sweep, textFont, lineHeight, noteHeight, textWidth: longest, textHeight, lines,
      focus: {line: excerpt.focus.line, scale: zoom, time, endTime: time + .5, duration: .5, x, y},
      highlight: sweep ? {motion: 'sweep', time, duration: .35, endTime: time + .35, color: accent + '55'} : {motion: 'fade', time: time + .16, duration: .24, endTime: time + .16 + .24, color: accent + '55'},
      bar: {height: 48, label: title, dots: [...C.dots]},
      noteRect: {x: 0, y: 48, width: box.width, height: noteHeight},
      viewport: {x: 24, y: 48 + noteHeight + 24, width: viewWidth, height: box.height - (48 + noteHeight + 24) - 24}};
  } else if (kind === 'date-card') {
    object(input.date, 'date', ['month', 'day', 'year', 'caption', 'at']);
    const date = input.date;
    number(date.month, 'date.month', 1, 12); number(date.day, 'date.day', 1, 31);
    if (!Number.isInteger(date.month) || !Number.isInteger(date.day)) throw new Error('date month/day must be integers');
    if (date.year !== undefined) {number(date.year, 'date.year', 1, 9999); if (!Number.isInteger(date.year)) throw new Error('date.year must be an integer');}
    const leap = date.year === undefined || date.year % 4 === 0 && (date.year % 100 !== 0 || date.year % 400 === 0);
    if (date.day > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][date.month - 1]) throw new Error('day does not exist in supplied month/year');
    const caption = date.caption === undefined ? '' : text(date.caption, 'date.caption', 42);
    const captionLines = caption ? Math.ceil(caption.length / Math.floor((box.width - 40) / (22 * .65))) : 0;
    if (box.height < 48 + 132 + titleLines * (font + 4) * 1.15 + 36 + captionLines * 29) throw new Error('date-card rect too short');
    natural = 48 + 132 + titleLines * (font + 4) * 1.15 + 36 + captionLines * 29 + 24;
    const time = start + at(date.at, 'date.at'), monthName = MONTHS[date.month - 1];
    events.push({id: `${id}-date-settle`, time: time + .32});
    content = {month: date.month, day: date.day, year: date.year ?? null, monthName, monthLabel: `${monthName}${date.year === undefined ? '' : ` · ${date.year}`}`, caption: caption || null, captionLines, time, settleTime: time + .32, bandHeight: 48, dayHeight: 132, durations: {day: .32}};
  } else if (kind === 'status-rack') {
    object(input.rack, 'rack', ['mode', 'source', 'rows']);
    const rack = input.rack;
    const tones = statusTones(input, theme, accent);
    if (!['illustration', 'data'].includes(rack.mode)) throw new Error('rack.mode must be illustration or data');
    if (rack.mode === 'data') text(rack.source, 'rack.source', 80);
    else if (rack.source !== undefined) throw new Error('illustration cannot claim a real data source');
    if (!Array.isArray(rack.rows) || rack.rows.length < 1 || rack.rows.length > 8) throw new Error('rack.rows must contain 1–8 rows');
    const note = rack.mode === 'illustration' ? 'Illustration · status states' : `Source: ${rack.source}`;
    const noteLines = Math.ceil(note.length / Math.floor((box.width - 48) / (22 * .65)));
    if (box.height < header + noteLines * 29 + 20 + rack.rows.length * 52 + 24) throw new Error('status-rack rect too short');
    natural = header + noteLines * 29 + 20 + rack.rows.length * 52 + 24;
    const lightOff = custom ? custom.border : C.light;
    const rows = rack.rows.map((row, i) => {
      object(row, 'rack row', ['label', 'states']); text(row.label, 'rack.label', 24);
      if (row.label.length > Math.floor((box.width - 48 - 24 - 22 - 24 - 70) / (22 * .65))) throw new Error('rack label too long for rect');
      if (!Array.isArray(row.states) || row.states.length < 1 || row.states.length > 8) throw new Error('row.states must contain 1–8 states');
      let previous = -1, previousLights = [false, false, false], previousColours = [lightOff, lightOff, lightOff];
      const states = row.states.map((state, n) => {
        object(state, 'rack state', ['at', 'lights', 'tone']); const stateOffset = at(state.at, 'rack state.at');
        if (stateOffset <= previous || previous >= 0 && stateOffset - previous < TIMING.gaps['status-rack'] - 1e-6) throw new Error(`rack state times must increase by at least ${TIMING.gaps['status-rack']}s`); previous = stateOffset;
        if (!Array.isArray(state.lights) || state.lights.length !== 3 || state.lights.some(light => typeof light !== 'boolean' && !(tones && STATUS_TONES.includes(light)))) throw new Error(tones ? `rack lights must be exactly three entries, each a boolean or a tone (${STATUS_TONES.join(', ')})` : 'rack lights must be exactly three booleans');
        if (state.tone !== undefined && !STATUS_TONES.includes(state.tone)) throw new Error(`rack state.tone must be ${STATUS_TONES.join(', ')}`);
        const time = start + stateOffset;
        const changes = [];
        // Lit colour: a light's own tone, else the state's tone, else (palette
        // "status") the light's position (fail, active, pass), else the accent.
        const colours = state.lights.map((light, j) => light === false ? lightOff : tones ? tones[typeof light === 'string' ? light : state.tone ?? STATUS_POSITIONS[j]] : accent);
        state.lights.forEach((light, j) => {const on = light !== false; if (on !== previousLights[j] || colours[j] !== previousColours[j]) changes.push({light: j, on, color: colours[j]});});
        previousLights = state.lights.map(light => light !== false); previousColours = colours;
        const changed = n === 0 || changes.length > 0;
        const settleTime = changed ? time + (n === 0 ? .22 : .18) : null;
        if (changed) events.push({id: `${id}-rack-${i}-state-${n}`, time: settleTime});
        return {index: n, time, lights: state.lights.map(light => light !== false), ...(tones ? {colors: colours} : {}), changes, settleTime};
      });
      return {index: i, label: row.label, enterTime: states[0].time, states};
    });
    content = {mode: rack.mode, source: rack.mode === 'data' ? rack.source : null, note, noteLines, lightOn: accent, lightOff, ...(tones ? {palette: 'status', tones} : {}), rows, durations: {row: .22, light: .18}};
  } else if (kind === 'code-snippet') {
    object(input.code, 'code', ['language', 'lines', 'typing', 'source', 'filename']); const code = input.code;
    if (code.typing !== undefined && typeof code.typing !== 'boolean') throw new Error('code.typing must be a boolean');
    if (code.source !== undefined && !['example', 'real'].includes(code.source)) throw new Error('code.source must be example or real');
    const language = code.language === undefined ? 'Example code' : text(code.language, 'code.language', 24);
    const filename = code.filename === undefined ? null : text(code.filename, 'code.filename', 40);
    if (filename !== null && /[\r\n\t]/.test(filename)) throw new Error('code.filename must be one line');
    // Label row: an explicit label (false hides the row), else the filename,
    // else the language alone for real code, else the "<language> · Example"
    // marker for illustrative snippets (the default).
    let label;
    if (input.label === false) label = null;
    else if (input.label !== undefined) {
      label = text(input.label, 'label', 40);
      if (/[\r\n\t]/.test(label)) throw new Error('label must be one line');
    } else if (filename !== null) label = filename;
    else if (code.source === 'real') label = code.language === undefined ? null : language;
    else label = `${language} · Example`;
    const labelRow = label === null ? 0 : 44;
    if (!Array.isArray(code.lines) || code.lines.length < 1 || code.lines.length > 3) throw new Error('code.lines must contain 1–3 lines');
    const codeFont = Math.max(22, Math.min(28, Math.floor(box.width / 28))), lineHeight = Math.ceil(codeFont * 1.5);
    if (box.height < header + labelRow + code.lines.length * lineHeight + 24) throw new Error('code-snippet rect too short');
    natural = header + labelRow + code.lines.length * lineHeight + 24 + 4;
    const typing = code.typing === true;
    let previous = -1, typingEnd = -1;
    const lines = code.lines.map((line, i) => {
      object(line, 'code line', ['tokens', 'at', 'typeDuration']); const lineOffset = at(line.at, 'code line.at');
      if (!typing && line.typeDuration !== undefined) throw new Error('line.typeDuration requires code.typing');
      const typeDuration = typing ? number(line.typeDuration ?? .6, 'line.typeDuration', .12, 2) : .24;
      if (typing && lineOffset < typingEnd - 1e-6) throw new Error('typing lines must not overlap');
      typingEnd = lineOffset + typeDuration;
      if (lineOffset <= previous || previous >= 0 && lineOffset - previous < TIMING.gaps['code-snippet'] - 1e-6) throw new Error(`code line times must increase by at least ${TIMING.gaps['code-snippet']}s`); previous = lineOffset;
      if (!Array.isArray(line.tokens) || line.tokens.length < 1 || line.tokens.length > 24) throw new Error('code line requires 1–24 tokens');
      let length = 0, characters = 0;
      const tokens = line.tokens.map(token => {
        object(token, 'code token', ['text', 'type']);
        if (typeof token.text !== 'string' || token.text.length < 1 || token.text.length > 80) throw new Error('token.text must contain 1–80 characters');
        if (/[\r\n\t]/.test(token.text)) throw new Error('code token must be one line without tabs');
        if (!TOKEN_TYPES.includes(token.type)) throw new Error('unsupported token type');
        length += token.text.length;
        const chars = Array.from(token.text); characters += chars.length;
        return typing ? {text: token.text, type: token.type, chars} : {text: token.text, type: token.type};
      });
      if (length > Math.floor((box.width - 48) / (codeFont * .65))) throw new Error(`code line ${i + 1} is ${length} chars; this rect (${Math.round(rect.width)} px wide) fits ${Math.floor((box.width - 48) / (codeFont * .65))} at ${codeFont} px: ${Math.ceil((48 + length * 28 * .65) * scale) <= canvas.width ? `widen the rect to ≥ ${Math.ceil((48 + length * 28 * .65) * scale)} px, or shorten the line or split it (up to 3 lines)` : `no rect at ${input.aspect} fits it, so shorten the line or split it (up to 3 lines)`}`);
      const time = start + lineOffset;
      let charTimes = null;
      if (typing) {
        charTimes = [];
        for (let j = 0; j < characters; j++) charTimes.push(start + lineOffset + (j + 1) * typeDuration / characters - .001);
        events.push({id: `${id}-code-${i}-typing-start`, time: start + lineOffset, endTime: start + lineOffset + typeDuration, duration: typeDuration, role: 'typing'}, {id: `${id}-code-${i}-typing-end`, time: start + lineOffset + typeDuration});
      }
      events.push({id: `${id}-code-${i}-settle`, time: start + lineOffset + typeDuration});
      return {index: i, time, typeDuration, endTime: start + lineOffset + typeDuration, length, characters, tokens, charTimes};
    });
    content = {language, label, filename, source: code.source ?? 'example', typing, codeFont, lineHeight, lines, durations: {line: .24}};
  } else if (kind === 'audience-grid') {
    object(input.audience, 'audience', ['tiles', 'columns']);
    const {tiles} = input.audience;
    if (!Array.isArray(tiles) || tiles.length < 2 || tiles.length > 12) throw new Error('audience.tiles must contain 2–12 entries; split larger grids');
    const columns = input.audience.columns ?? Math.min(tiles.length, box.width < 600 ? 2 : 3);
    number(columns, 'audience.columns', 2, 4);
    if (!Number.isInteger(columns) || columns > tiles.length) throw new Error('columns must be an integer no larger than the tile count');
    const cellWidth = (box.width - 48 - 16 * (columns - 1)) / columns;
    const cellHeight = font >= 32 ? 180 : 160, labelFont = Math.max(22, font - 6);
    const rowCount = Math.ceil(tiles.length / columns);
    if (cellWidth < 130 || box.height < header + 55 + 24 + rowCount * cellHeight + (rowCount - 1) * 16) throw new Error('audience grid does not fit rect; use fewer tiles/columns or a larger rect');
    natural = header + 55 + 24 + rowCount * cellHeight + (rowCount - 1) * 16;
    const gridTop = header + 22 * 1.3 + 20;
    content = {note: 'Illustration · audience tiles', columns, rowCount, cellWidth, cellHeight, labelFont, gap: 16, tiles: tiles.map((tile, i) => {
      object(tile, `audience.tiles[${i}]`, ['label', 'emoji', 'at']);
      text(tile.label, 'tile.label', 24);
      if (tile.label.length > Math.floor((cellWidth - 32) / (labelFont * .65)) * 2) throw new Error('tile label too long for rect');
      const emoji = tile.emoji ?? '👤';
      text(emoji, 'tile.emoji', 16);
      if (Array.from(emoji).length > 8 || /[\r\n]/.test(emoji)) throw new Error('tile.emoji must be a compact icon accent');
      const time = start + at(tile.at, 'tile.at');
      events.push({id: `${id}-viewer-${i}-settle`, time: time + .24});
      const column = i % columns, row = Math.floor(i / columns);
      return {index: i, label: tile.label, emoji, time, settleTime: time + .24, cell: {x: 24 + column * (cellWidth + 16), y: gridTop + row * (cellHeight + 16), width: cellWidth, height: cellHeight}};
    }), durations: {tile: .24}};
  } else if (kind === 'focus-flow') {
    object(input.focus, 'focus', ['options', 'selected', 'arriveAt', 'chooseAt', 'progressAt', 'progressDuration', 'progressLabel', 'icon']);
    const focus = input.focus, options = focus.options;
    if (!Array.isArray(options) || options.length < 2 || options.length > 4) throw new Error('focus.options must contain 2–4 meaningful labels');
    options.forEach(label => text(label, 'focus option', 24));
    if (new Set(options.map(label => label.trim().toLowerCase())).size !== options.length) throw new Error('focus options must be distinct');
    number(focus.selected, 'focus.selected', 0, options.length - 1);
    if (!Number.isInteger(focus.selected)) throw new Error('focus.selected must be an integer');
    if (focus.icon !== undefined && !Object.hasOwn(EDITORIAL_SYMBOLS, focus.icon)) throw new Error('focus.icon must be a built-in symbolic icon');
    const arrive = at(focus.arriveAt, 'focus.arriveAt'), choose = at(focus.chooseAt, 'focus.chooseAt'), progress = at(focus.progressAt, 'focus.progressAt');
    const progressDuration = number(focus.progressDuration ?? .8, 'focus.progressDuration', .3, 2);
    const F = TIMING.focus;
    if (choose < arrive + F.arrive + (options.length - 1) * F.stagger + F.hold || progress < choose + F.chosenSettle) throw new Error('focus must hold options before choosing and settle the chosen task before progress');
    if (progress + progressDuration + F.progressHold > duration - exitDuration) throw new Error('focus progress must finish with a readable hold before exit');
    const label = focus.progressLabel === undefined ? 'Illustrative progress' : text(focus.progressLabel, 'focus.progressLabel', 32);
    const rowHeight = 64, gap = 14, horizontal = input.aspect === '16:9' && box.width >= 900;
    const stageHeight = horizontal ? 96 : options.length * (rowHeight + gap) - gap;
    const optionWidth = horizontal ? (box.width - 48 - gap * (options.length - 1)) / options.length : box.width - 48;
    const optionFont = horizontal ? 22 : Math.max(24, font - 2), available = optionWidth - 32 - (focus.icon ? 46 : 0);
    if (options.some(option => option.length * optionFont * .65 > available * (horizontal ? 2 : 1))) throw new Error('focus option too long for rect');
    if (label.length * 22 * .65 > box.width - 48 || box.height < header + 50 + stageHeight + 94) throw new Error('focus-flow does not fit rect');
    natural = header + 50 + stageHeight + 94 + 4;
    const target = (stageHeight - rowHeight) / 2, targetX = (box.width - 48 - optionWidth) / 2;
    const arriveTime = start + arrive, chooseTime = start + choose, progressTime = start + progress;
    const optionsSettle = start + arrive + (options.length - 1) * .08 + .24, chosenSettle = start + choose + .6, progressSettle = start + progress + progressDuration;
    events.push({id: `${id}-options-settle`, time: optionsSettle}, {id: `${id}-chosen-task`, time: chosenSettle}, {id: `${id}-focus-progress-settle`, time: progressSettle});
    content = {note: 'Illustration · focus sequence', selected: focus.selected, icon: focus.icon ?? null, progressLabel: label, horizontal, rowHeight, gap, stageHeight, optionWidth, optionFont,
      target: {x: targetX, y: target}, chosenScale: horizontal ? 1.4 : 1, arriveTime, chooseTime, chosenMoveTime: chooseTime + .18, progressTime, progressDuration, optionsSettle, chosenSettle, progressSettle,
      stage: {x: 24, y: header + 22 * 1.3 + 20, width: box.width - 48, height: stageHeight},
      options: options.map((option, i) => ({index: i, label: option, selected: i === focus.selected,
        initial: {x: horizontal ? i * (optionWidth + gap) : 0, y: horizontal ? 0 : i * (rowHeight + gap)}, arriveTime: arriveTime + i * .08})),
      durations: {arrive: .24, chosenMove: .42, distractorFade: .16, distractorMove: .38, progressFade: .2}};
  } else if (kind === 'trend-chart' || kind === 'growth-chart') {
    const isGrowth = kind === 'growth-chart';
    const supplied = isGrowth ? input.growth : input.chart;
    object(supplied, isGrowth ? 'growth' : 'chart', isGrowth ? ['mode', 'points', 'unit', 'source', 'showValues'] : ['mode', 'points', 'unit', 'source']);
    if (isGrowth && supplied.showValues !== undefined && typeof supplied.showValues !== 'boolean') throw new Error('growth.showValues must be a boolean');
    const showValues = !isGrowth || (supplied.showValues ?? supplied.points !== undefined);
    let chart = supplied;
    const defaultPoints = isGrowth && supplied.points === undefined;
    if (defaultPoints) {
      if (supplied.mode !== 'illustration') throw new Error('real growth data requires supplied points');
      if (duration < enterDuration + exitDuration + TIMING.growthDefaultHold) throw new Error('default growth illustration needs a longer duration');
      const interval = (duration - enterDuration - exitDuration - .9) / 3;
      chart = {...supplied, points: [1, 3, 8, 20].map((value, i) => ({label: ['Start', 'Next', 'Later', 'Reach'][i], value, at: enterDuration + i * interval}))};
    }
    const {mode, points} = chart;
    if (!['illustration', 'data'].includes(mode)) throw new Error('chart.mode must be illustration or data');
    if (!Array.isArray(points) || points.length < 2 || points.length > 8) throw new Error('chart.points must contain 2–8 entries');
    const unit = text(isGrowth ? (chart.unit ?? 'reach') : chart.unit, 'chart.unit', 18);
    if (mode === 'data') text(chart.source, 'chart.source for real data', 80);
    else if (chart.source !== undefined) throw new Error('illustration cannot claim a real data source');
    const attribution = mode === 'illustration' ? (isGrowth && !showValues ? 'Illustration · relative growth' : 'Illustration · example values') : `Source: ${chart.source}`;
    const columnWidth = (box.width - 48 - 16 * (points.length - 1)) / points.length;
    const chartHeight = 180, labelFont = 22;
    const attributionLines = Math.ceil(attribution.length / Math.floor((box.width - 48) / (22 * .65)));
    if (columnWidth < 40 || box.height < header + attributionLines * 29 + 24 + (isGrowth ? (showValues ? 88 : 0) : 80) + chartHeight + 80) throw new Error('trend chart does not fit rect; use fewer points or a larger rect');
    let previous = -1;
    points.forEach((point, i) => {
      object(point, `chart.points[${i}]`, ['label', 'value', 'at']);
      text(point.label, 'point.label', 16);
      number(point.value, 'point.value', 0, 1_000_000_000);
      if (!Number.isInteger(point.value)) throw new Error('point.value must be a whole count');
      if (isGrowth && i > 0 && point.value < points[i - 1].value) throw new Error('growth values must not decrease; use trend-chart for declines');
      if (point.label.length > Math.floor(columnWidth / (labelFont * .65)) * 2) throw new Error('point label too long for rect');
      const pointOffset = at(point.at, 'point.at');
      if (pointOffset <= previous || (previous >= 0 && pointOffset - previous + 1e-6 < TIMING.gaps.chart)) throw new Error(`point times must increase with at least ${TIMING.gaps.chart}s between events`);
      previous = pointOffset;
    });
    const maximum = Math.max(1, ...points.map(point => point.value));
    const formattedMaximum = Math.round(maximum).toLocaleString('en-US');
    if (showValues && formattedMaximum.length * (isGrowth ? 56 : 48) * .65 + unit.length * 22 * .65 + 16 > box.width - 48) throw new Error('metric and unit too wide for rect');
    const metricHeight = !showValues ? 0 : isGrowth ? 88 : 80;
    const pointLines = Math.max(...points.map(point => Math.min(2, Math.ceil(point.label.length * labelFont * .65 / columnWidth))));
    natural = Math.max(header + attributionLines * 29 + 24 + (isGrowth ? (showValues ? 88 : 0) : 80) + chartHeight + 80, header + attributionLines * 22 * 1.3 + 20 + metricHeight + chartHeight + 12 + pointLines * labelFont * 1.25 + 24 + 4);
    const chartTop = header + attributionLines * 22 * 1.3 + 20 + metricHeight;
    content = {variant: isGrowth ? 'growth' : 'trend', mode, source: mode === 'data' ? chart.source : null, attribution, unit, showValues, defaultPoints, maximum, formattedMaximum,
      chartHeight, labelFont, countFont: isGrowth ? 56 : 48, metricHeight, columnWidth, gap: 16, attributionLines,
      points: points.map((point, i) => {
        const time = start + point.at, barHeight = point.value / maximum * chartHeight;
        events.push({id: `${id}-point-${i}-settle`, time: time + .38});
        return {index: i, label: point.label, value: point.value, from: i ? points[i - 1].value : 0, time, settleTime: time + .38, barHeight,
          bar: {x: 24 + i * (columnWidth + 16), y: chartTop + chartHeight - barHeight, width: columnWidth, height: barHeight}};
      })};
  } else if (kind === 'metric' || kind === 'progress') {
    const config = input[kind], isMetric = kind === 'metric';
    object(config, kind, isMetric ? ['mode', 'unit', 'format', 'currency', 'decimals', 'values', 'source'] : ['mode', 'values', 'max', 'label', 'source']);
    const attribution = series(config, kind, duration, enterDuration, movement ? exitDuration : null);
    let format, formatSpec, max = null;
    if (isMetric) {
      text(config.unit, 'metric.unit', 18);
      if (!['number', 'percent', 'currency'].includes(config.format)) throw new Error('metric.format must be number, percent or currency');
      const decimals = config.decimals ?? (config.format === 'currency' ? 2 : 0);
      number(decimals, 'metric.decimals', 0, 2);
      if (!Number.isInteger(decimals)) throw new Error('metric.decimals must be an integer');
      if (config.format === 'currency') {
        if (!/^[A-Z]{3}$/.test(config.currency ?? '')) throw new Error('metric.currency requires an explicit three-letter code');
        const formatter = new Intl.NumberFormat('en-US', {style: 'currency', currency: config.currency, currencyDisplay: 'code', minimumFractionDigits: decimals, maximumFractionDigits: decimals});
        format = value => formatter.format(value);
      } else {
        if (config.currency !== undefined) throw new Error('currency is only for currency format');
        format = value => value.toLocaleString('en-US', {minimumFractionDigits: decimals, maximumFractionDigits: decimals}) + (config.format === 'percent' ? '%' : '');
      }
      formatSpec = {style: config.format, decimals, currency: config.format === 'currency' ? config.currency : null, max: null};
    } else {
      max = config.max ?? 100;
      number(max, 'progress.max', 1, 1_000_000_000);
      if (config.label !== undefined) text(config.label, 'progress.label', 32);
      if (config.values.some(entry => entry.value < 0 || entry.value > max)) throw new Error('progress values must be between 0 and max');
      format = value => `${Math.round(value / max * 100)}%`;
      formatSpec = {style: 'progress', decimals: 0, currency: null, max};
    }
    const noteLines = Math.ceil(attribution.length / Math.floor((box.width - 48) / (22 * .65)));
    const numberFont = Math.max(36, Math.min(hero ? (isMetric ? DENSITY.heroNumber : DENSITY.heroProgressNumber) : DENSITY.numberCap, Math.floor((box.width - 48) / (Math.max(...config.values.map(entry => format(entry.value).length)) * .68))));
    if (Math.max(...config.values.map(entry => format(entry.value).length)) * numberFont * .68 > box.width - 48) throw new Error('formatted metric too wide for rect');
    const unitText = isMetric ? config.unit : (config.label ?? 'Progress');
    const unitLines = Math.ceil(unitText.length / Math.floor((box.width - 48) / (22 * .65)));
    const requiredHeight = 2 + header + noteLines * 22 * 1.3 + 20 + numberFont * 1.1 + 12 + unitLines * 22 * 1.25 + 20 + (isMetric ? 0 : 40);
    if (box.height < requiredHeight) throw new Error(`${kind} rect too short; requires at least ${Math.ceil(requiredHeight)}px`);
    natural = requiredHeight + 4;
    const values = config.values.map((entry, i) => {
      const time = start + entry.at, from = i ? config.values[i - 1].value : entry.value;
      events.push({id: `${id}-value-${i}-settle`, time: time + (i ? .6 : .2)});
      return {index: i, value: entry.value, from, time, settleTime: time + (i ? .6 : .2), text: format(entry.value), scale: isMetric ? null : entry.value / (config.max ?? 100),
        frames: i ? countFrames(config.values[i - 1].value, entry.value, format, time) : null};
    });
    content = {variant: kind, mode: config.mode, source: config.mode === 'data' ? config.source : null, attribution, noteLines, format: formatSpec,
      unit: isMetric ? config.unit : null, max, label: isMetric ? null : (config.label ?? null), unitText, unitLines, numberFont, requiredHeight, initialText: values[0].text, values};
  } else if (kind === 'checklist') {
    if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 6) throw new Error('rows must contain 1–6 entries; split longer lists');
    const rowHeight = font * 2.5 + 28;
    if (box.height < header + input.rows.length * rowHeight) throw new Error('checklist rect too short; use fewer rows or a taller rect');
    natural = header + input.rows.length * rowHeight + 2;
    const labelWidth = box.width - 48 - 36 - 36 - statusWidth;
    const rows = input.rows.map((row, i) => {
      object(row, `rows[${i}]`, ['label', 'status', 'at', 'doneAt']);
      text(row.label, 'row.label', 54);
      if (!['pending', 'active', 'done'].includes(row.status)) throw new Error('row.status must be pending, active or done');
      const eventTime = start + at(row.at, 'row.at');
      const doneTime = row.doneAt === undefined ? null : start + at(row.doneAt, 'row.doneAt');
      if (doneTime !== null && (row.status !== 'active' || doneTime <= eventTime)) throw new Error(row.status !== 'active' ? `rows[${i}].doneAt needs status "active" (got "${row.status}"): doneAt is when an active row ticks to done, so set status: "active", or drop doneAt for a row that starts done` : `rows[${i}].doneAt (${row.doneAt} s) must come after rows[${i}].at (${row.at} s): set doneAt later than at`);
      if (row.label.length > Math.floor(labelWidth / (font * .65)) * 2) throw new Error('row label too long for rect; shorten it or widen the module');
      const stateSettle = row.status !== 'pending' ? eventTime + .16 : null;
      if (stateSettle !== null) events.push({id: `${id}-row-${i}-state`, time: stateSettle});
      const coveredSettle = doneTime !== null ? doneTime + .16 : null;
      if (coveredSettle !== null) events.push({id: `${id}-row-${i}-covered`, time: coveredSettle});
      return {index: i, label: row.label, status: row.status, time: eventTime, stateSettle, doneTime, coveredSettle};
    });
    content = {statusLabels, statusWidth, rowHeight, labelWidth, doneBackground: theme.surface, check: {...CHECK}, rows};
  } else {
    if (!Array.isArray(input.steps) || input.steps.length < 2 || input.steps.length > 6) throw new Error('steps must contain 2–6 entries; split longer rails');
    if (box.height < header + 160) throw new Error('step-rail rect must leave room for labels');
    let previous = -1;
    const labelWidth = (box.width - 48 - 12 * (input.steps.length - 1)) / input.steps.length;
    const steps = input.steps.map((step, i) => {
      object(step, `steps[${i}]`, ['label', 'at']);
      text(step.label, 'step.label', 22);
      if (step.label.length > Math.floor(labelWidth / (Math.max(22, font - 4) * .65)) * 2) throw new Error('step label too long for rect; shorten it or widen the module');
      const stepOffset = at(step.at, 'step.at');
      if (stepOffset <= previous || (previous >= 0 && stepOffset - previous + 1e-6 < TIMING.gaps['step-rail'])) throw new Error(`step times must strictly increase with at least ${TIMING.gaps['step-rail']}s between events`);
      previous = stepOffset;
      const time = start + stepOffset;
      events.push({id: `${id}-step-${i}-settle`, time: time + .3});
      return {index: i, label: step.label, number: i + 1, time, settleTime: time + .3, fill: i / (input.steps.length - 1)};
    });
    const stepFont = Math.max(22, font - 4), labelLines = Math.max(...input.steps.map(step => Math.min(2, Math.ceil(step.label.length * stepFont * .65 / labelWidth))));
    natural = Math.max(header + 160, header + 20 + 8 + 22 + (input.numbered === true ? 48 : 0) + labelLines * stepFont * 1.25 + 22 + 4);
    content = {numbered: input.numbered === true, activeColor: theme.accentText, labelWidth, rail: {x: pad, y: header + 20, width: box.width - pad * 2, height: 8}, steps};
  }
  if ((movement || input.treatment || PANEL_KINDS.includes(kind)) && events.some(event => event.time > start + duration - exitDuration + 1e-9)) throw new Error('content must settle before motion exit begins');
  const layout = {canvas, rect: {...rect}, ...(movement ? {motion: {enterEnd: start + enterDuration, exitStart: start + duration - exitDuration, end: start + duration}} : {})};
  const roles = textRoles(kind, content, font, input.numbered === true);
  const smallest = list => (list.length ? Math.round(Math.min(...list) * scale * 100) / 100 : null);
  return {id, kind, aspect: input.aspect, canvas: {...canvas}, start, duration, end: start + duration, rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
    ...(variant ? {variant} : {}), title, accent, theme, customTheme: custom !== null, presentation: input.presentation === 'glass' ? 'glass' : 'solid', surface: panel ? 'panel' : 'standard', track,
    chrome: {font, titleFont: font + 4, pad, titleLines, header, statusWidth}, motion, content, events, layout,
    density: {scale, hero, source, layout: {width: box.width, height: box.height}, natural: Math.ceil(natural || box.height)},
    minTextPx: smallest(roles.key), minSecondaryTextPx: smallest(roles.secondary), textRole: 'body'};
}

// Designed variants (docs/SEEDED_STYLES_RFC.md §3.2): the main editorial
// modules' looks, chosen by spec.variant (resolveModule passes the scene's
// params.variant, else the story's variants[kind]). The first is the
// original look. A variant keeps the content geometry the core computes (so
// the layout check and both renderers agree) and changes the shell's shape
// language, colour treatment and entrance:
//   flat     no border or shadow, square corners, an accent bar inset on the
//            title; slides in from the left
//   outline  an accent outline with a soft accent halo, round corners;
//            scales up from the centre
//   banner   the title on a solid accent band; drops in from above
export const EDITORIAL_VARIANTS = Object.freeze({
  checklist: Object.freeze(['panel', 'flat', 'outline', 'banner']),
  'step-rail': Object.freeze(['panel', 'flat', 'outline', 'banner']),
  metric: Object.freeze(['panel', 'flat', 'outline', 'banner']),
  callout: Object.freeze(['panel', 'flat', 'outline', 'banner'])
});
const VARIANT_ENTRANCES = Object.freeze({
  flat: {from: {x: -64, y: 0, scale: 1}, to: {x: -24, y: 0, scale: 1}, origin: '0px 0px'},
  outline: {from: {x: 0, y: 0, scale: .9}, to: {x: 0, y: 0, scale: .96}, origin: '50% 50%'},
  banner: {from: {x: 0, y: -40, scale: 1}, to: {x: 0, y: -12, scale: 1}, origin: '0px 0px'}
});

/**
 * The variant's stylesheet, appended after the base, kind and theme CSS by
 * both renderers (empty for the default). Never changes a size, padding or
 * border width, so text wraps exactly as the core measured it.
 */
export function editorialVariantCss(model) {
  const {id, kind, variant, accent, theme} = model;
  if (!variant || variant === EDITORIAL_VARIANTS[kind]?.[0]) return '';
  const root = `#${id}`, at = selector => selector.split(',').map(part => `${root} ${part.trim()}`).join(',');
  const treated = kind === 'callout' && model.content.variant === 'treated';
  const heading = treated ? '.ui-callout-heading' : '.ui-title';
  let css = '';
  if (variant === 'flat') {
    css += `${root}{border-color:transparent;border-radius:0;box-shadow:none}${at(heading)}{box-shadow:inset 8px 0 0 ${accent}}`;
    if (kind === 'checklist') css += `${at('.ui-check')}{border-radius:50%}${at('.ui-row')}{border-top-color:${accent}40}`;
    if (kind === 'step-rail') css += `${at('.ui-rail, .ui-fill')}{border-radius:0}${at('.ui-step-number')}{border-radius:0}`;
    if (kind === 'metric') css += `${at('.ui-number')}{color:${theme.accentText}}`;
  } else if (variant === 'outline') {
    // An outline, not a wider border: the content box keeps its size.
    css += `${root}{border-color:transparent;border-radius:28px;outline:3px solid ${accent};outline-offset:-3px;box-shadow:0 0 0 8px ${accent}24,0 18px 48px #00000066}${at(heading)}{color:${theme.accentText}}`;
    if (kind === 'checklist') css += `${at('.ui-check')}{border-radius:50%;border-color:${accent}}`;
    if (kind === 'step-rail') css += `${at('.ui-rail')}{outline:2px solid ${accent}59;outline-offset:3px}`;
    if (kind === 'metric') css += `${at('.ui-number')}{color:${theme.accentText}}`;
  } else if (variant === 'banner') {
    // The band's text is whichever of the theme's surface and foreground reads
    // on the accent; a pale band (neither reaches 3:1) tints instead.
    const ink = [theme.surface, theme.foreground].sort((a, b) => statusContrast(b, accent) - statusContrast(a, accent))[0];
    const solid = statusContrast(ink, accent) >= 3;
    css += `${root}{border-radius:10px}${at(heading)}{background:${solid ? accent : `${accent}38`};color:${solid ? ink : theme.foreground}}`;
    if (treated) css += `${at('.ui-title, .ui-symbol')}{color:${solid ? ink : theme.foreground}}`;
    if (kind === 'checklist') css += `${at('.ui-check')}{border-radius:4px;background:${accent}1f}`;
    if (kind === 'metric') css += `${at('.ui-number')}{color:${theme.accentText}}`;
  }
  return css;
}

// Rendered text sizes by role, in layout px (the model multiplies by the
// density scale). key: the text a viewer reads (titles, rows, labels, numbers,
// code, excerpt lines, options), reported as minTextPx with textRole "body":
// editorial modules are body copy, so layout-check holds them to the profile's
// body floor (minBodyTextPx: 32 px Shorts, 22 px landscape) rather than the
// headline floor catalogue modules meet (44 / 32 px). secondary: supporting
// text (source and illustration notes, window-bar labels, status words,
// units, chart axis labels, the code label row, step numbers), reported as
// minSecondaryTextPx and held to minSecondaryTextPx (24 px Shorts, 18 px
// landscape). All floors scale with the canvas.
function textRoles(kind, c, font, numbered) {
  const small = EDITORIAL_STYLE.size.small, title = font + 4;
  switch (kind) {
    case 'media-window': return {key: [], secondary: [small]};
    case 'callout': return {key: c.variant === 'treated' ? [font + 2, font] : [title, font], secondary: []};
    case 'checklist': return {key: [title, font], secondary: [font - 6]};
    case 'step-rail': return {key: [title, Math.max(22, font - 4)], secondary: numbered ? [EDITORIAL_STYLE.size.stepNumber] : []};
    case 'audience-grid': return {key: [title, c.labelFont], secondary: [small]};
    case 'trend-chart': case 'growth-chart': return {key: [title, ...(c.showValues ? [c.countFont] : [])], secondary: [small, c.labelFont]};
    case 'metric': case 'progress': return {key: [title, c.numberFont], secondary: [small]};
    case 'date-card': return {key: [title, EDITORIAL_STYLE.size.day], secondary: [small]};
    case 'status-rack': return {key: [title, small], secondary: [small]};
    case 'code-snippet': return {key: [title, c.codeFont], secondary: c.label === null ? [] : [small]};
    case 'excerpt-window': return {key: [c.textFont], secondary: [small]};
    case 'focus-flow': return {key: [title, c.optionFont], secondary: [small]};
    default: return {key: [title], secondary: []};
  }
}

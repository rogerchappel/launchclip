// Medium: the material every frame looks made of (oil, watercolour, pastel,
// ink, gouache), so a motion-graphics video reads as hand-painted. Set by
// story.medium (a style pack's `medium`, merged by kit/core/style.mjs
// applyStyle) as a name or {kind, strength?, boil?, grain?}; "none" or no
// medium leaves the render exactly as it was.
//
// One SVG filter stack per medium, applied as a whole-frame finishing pass by
// a full-canvas layer with `backdrop-filter: url(#…)` that sits above the
// scenes, the camera and the footage and below the brand frame and the
// captions, so text an editor reads stays crisp and only the picture is
// painted. Both renderers draw that same layer from this plan: the
// HyperFrames compiler emits mediumDefs() and switches the filter with
// mediumSteps() on its timeline; the Remotion StoryComposition renders
// mediumDefs() and picks mediumFilterAt(frame). The stacks are built from
// feTurbulence noise (wobble, brush streaks, paper), feDisplacementMap (wobbly
// edges, smeared strokes), feDiffuseLighting (oil's impasto), blends and
// colour matrices. A medium costs render time: every frame runs its stack
// over the whole canvas on the CPU.
//
// Boil: hand-drawn animation is redrawn "on threes", so the wobble and the
// stroke texture take one of MEDIUM_BOIL.variants drawings, changing every
// MEDIUM_BOIL.every frames from frame 0 of the story. The drawing is a
// function of the absolute frame only, so any seek, a partial re-render or a
// preview window gets the same pixels. The paper never boils.
//
// Plain ESM with no imports. Canonical copy: kit/core/medium.mjs.

export const MEDIUM_KINDS = Object.freeze(['none', 'oil', 'watercolour', 'pastel', 'ink', 'gouache']);
export const MEDIUM_KEYS = Object.freeze(['kind', 'strength', 'boil', 'grain']);
export const MEDIUM_BOIL = Object.freeze({ every: 3, variants: 3 });
// Each medium's dials when the value leaves them out. strength scales how
// far the paint departs from the clean frame (wobble, smear, texture);
// grain is the paper's tooth (0 turns it off).
export const MEDIUM_DEFAULTS = Object.freeze({
  oil: Object.freeze({ strength: 0.6, boil: true, grain: 0.35 }),
  watercolour: Object.freeze({ strength: 0.6, boil: true, grain: 0.6 }),
  pastel: Object.freeze({ strength: 0.6, boil: true, grain: 0.7 }),
  ink: Object.freeze({ strength: 0.6, boil: true, grain: 0.3 }),
  gouache: Object.freeze({ strength: 0.6, boil: true, grain: 0.45 })
});
// Names people write for a medium (US spelling, the material's own name):
// the validator names the medium to use instead.
const ALIASES = Object.freeze({ watercolor: 'watercolour', 'water-colour': 'watercolour', 'water-color': 'watercolour', 'oil-paint': 'oil', oils: 'oil', chalk: 'pastel', crayon: 'pastel', pastels: 'pastel', inked: 'ink', 'pen-and-ink': 'ink', poster: 'gouache' });
export const MEDIUM_LAYER_ID = 'lc-medium';
// The layer's z-index: above every scene, the base footage and the subject,
// below the brand frame and the captions. HyperFrames stacks scenes by
// z-index and lifts the frame to 90000 and the captions to 100000; Remotion
// scenes have none and its captions sit at 50 (captions.mjs CAPTION_BAND).
export const MEDIUM_Z = Object.freeze({ hyperframes: 80000, remotion: 49 });

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isUnit = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const r = (value, digits = 4) => { const f = 10 ** digits; return Math.round(value * f) / f + 0; };

/** Validation messages for a story's or a pack's medium (empty = valid). Each names the fix. */
export function mediumErrors(value, path = 'medium') {
  if (value === undefined || value === null) return [];
  const kindError = (kind, where) => {
    const alias = typeof kind === 'string' ? ALIASES[kind.trim().toLowerCase()] : null;
    if (alias) return `${where} "${kind}" is spelled "${alias}" here; use "${alias}"`;
    return `${where} must be one of ${MEDIUM_KINDS.join(', ')} (got ${JSON.stringify(kind)})`;
  };
  if (typeof value === 'string') return MEDIUM_KINDS.includes(value) ? [] : [kindError(value, path)];
  if (!isObject(value)) return [`${path} must be a medium name (${MEDIUM_KINDS.join(', ')}) or {kind, strength?, boil?, grain?}`];
  const errors = [];
  for (const key of Object.keys(value)) if (!MEDIUM_KEYS.includes(key)) errors.push(`${path}.${key} is not supported (allowed: ${MEDIUM_KEYS.join(', ')})`);
  if (!MEDIUM_KINDS.includes(value.kind)) errors.push(kindError(value.kind, `${path}.kind`));
  if (value.strength !== undefined && !isUnit(value.strength)) errors.push(`${path}.strength must be a number from 0 to 1 (0.6 is the default; lower keeps the frame closer to clean)`);
  if (value.grain !== undefined && !isUnit(value.grain)) errors.push(`${path}.grain must be a number from 0 to 1 (0 turns the paper texture off)`);
  if (value.boil !== undefined && typeof value.boil !== 'boolean') errors.push(`${path}.boil must be true or false (true redraws the lines every ${MEDIUM_BOIL.every} frames)`);
  return errors;
}

/** A medium value with every dial filled → {kind, strength, boil, grain}, or null for none, absent or invalid. */
export function normalizeMedium(value) {
  if (value === undefined || value === null || mediumErrors(value).length) return null;
  const given = typeof value === 'string' ? { kind: value } : value;
  if (given.kind === 'none') return null;
  const defaults = MEDIUM_DEFAULTS[given.kind];
  return { kind: given.kind, strength: given.strength ?? defaults.strength, boil: given.boil ?? defaults.boil, grain: given.grain ?? defaults.grain };
}

/**
 * The finishing pass for a story, or null when it has no medium (the render
 * is then unchanged). → {kind, strength, boil, grain, width, height, fps,
 * unit, variants, filters: [ids]}
 */
export function mediumPlan(story) {
  const medium = normalizeMedium(story?.medium);
  if (!medium) return null;
  const width = Number(story?.format?.width), height = Number(story?.format?.height);
  if (!(width > 0 && height > 0)) return null;
  const fps = Number(story?.resolved?.fps ?? story?.format?.fps ?? 30);
  const variants = medium.boil ? MEDIUM_BOIL.variants : 1;
  const bg = /^#[0-9a-fA-F]{6}$/.test(story?.brand?.colors?.bg ?? '') ? story.brand.colors.bg : '#000000';
  return { ...medium, width, height, fps, bg, unit: Math.min(width, height) / 1080, variants, filters: Array.from({ length: variants }, (_, v) => `${MEDIUM_LAYER_ID}-${v}`) };
}

/** Which drawing frame `frame` (0-based, from the story's start) shows. */
export function mediumVariantAt(plan, frame) {
  if (!plan || plan.variants <= 1) return 0;
  return Math.floor(Math.max(0, Math.round(Number(frame) || 0)) / MEDIUM_BOIL.every) % plan.variants;
}

/** The backdrop-filter value at a frame: url(#lc-medium-<variant>). */
export function mediumFilterAt(plan, frame) {
  return `url(#${plan.filters[mediumVariantAt(plan, frame)]})`;
}

/**
 * The drawing changes over [0, duration] seconds as timeline steps
 * [{time, filter}]: one at 0, then one per change. Each change sits half a
 * frame before the frame that shows it, so a seek to that frame never lands
 * on the boundary. Empty when the medium does not boil.
 */
export function mediumSteps(plan, duration) {
  if (!plan || plan.variants <= 1) return [];
  const steps = [{ time: 0, filter: mediumFilterAt(plan, 0) }];
  const last = Math.floor(Number(duration) * plan.fps + 1e-6);
  for (let frame = MEDIUM_BOIL.every; frame <= last; frame += MEDIUM_BOIL.every) steps.push({ time: r((frame - 0.5) / plan.fps), filter: mediumFilterAt(plan, frame) });
  return steps;
}

// ---------------------------------------------------------------------------
// Filter stacks

const attrs = (values) => Object.entries(values).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => ` ${key}="${value}"`).join('');
const fe = (tag, values, children = '') => `<${tag}${attrs(values)}>${children}</${tag}>`;
const freq = (...values) => values.map((value) => r(value, 5)).join(' ');
const noise = (result, baseFrequency, seed, octaves = 2, type = 'fractalNoise') => fe('feTurbulence', { type, baseFrequency, numOctaves: octaves, seed, result });
const displace = (result, input, map, scale) => fe('feDisplacementMap', { in: input, in2: map, scale: r(scale, 2), xChannelSelector: 'R', yChannelSelector: 'G', result });
const blur = (result, input, deviation) => fe('feGaussianBlur', { in: input, stdDeviation: r(deviation, 2), result });
const arithmetic = (result, a, b, k1, k2, k3, k4 = 0) => fe('feComposite', { in: a, in2: b, operator: 'arithmetic', k1: r(k1), k2: r(k2), k3: r(k3), k4: r(k4), result });
const matrix = (result, input, values) => fe('feColorMatrix', { in: input, type: 'matrix', values: values.map((v) => r(v)).join(' '), result });
const saturate = (result, input, amount) => fe('feColorMatrix', { in: input, type: 'saturate', values: r(amount), result });
// Luminance into every colour channel, opaque.
const grey = (result, input, gain = 1, offset = 0) => matrix(result, input, [0.2126 * gain, 0.7152 * gain, 0.0722 * gain, 0, offset, 0.2126 * gain, 0.7152 * gain, 0.0722 * gain, 0, offset, 0.2126 * gain, 0.7152 * gain, 0.0722 * gain, 0, offset, 0, 0, 0, 0, 1]);
const transfer = (result, input, func) => fe('feComponentTransfer', { in: input, result }, ['R', 'G', 'B'].map((channel) => fe(`feFunc${channel}`, func)).join(''));
const linear = (result, input, slope, intercept) => transfer(result, input, { type: 'linear', slope: r(slope), intercept: r(intercept) });
// A relief from a height map: flat reads 0.5 grey (light at 30° elevation),
// so a soft-light blend leaves flat areas as they were.
const relief = (result, input, surfaceScale, azimuth = 235) => fe('feDiffuseLighting', { in: input, surfaceScale: r(surfaceScale, 3), diffuseConstant: 1, 'lighting-color': '#ffffff', result }, fe('feDistantLight', { azimuth, elevation: 30 }));
const softLight = (result, top, bottom) => fe('feBlend', { in: top, in2: bottom, mode: 'soft-light', result });
// |a − b| per channel, as luminance: where the colour changes.
const edges = (result, a, b, gain) => [fe('feBlend', { in: a, in2: b, mode: 'difference', result: `${result}-d` }), grey(result, `${result}-d`, gain)].join('');
// input × (1 − amount × mask): darkens where an opaque grey mask is light.
// (A blend, not arithmetic: arithmetic runs on alpha too and would thin it.)
const darken = (result, input, mask, amount) => [linear(`${result}-m`, mask, -amount, 1), fe('feBlend', { in: `${result}-m`, in2: input, mode: 'multiply', result })].join('');
// Displacement and blur sample past the canvas edge, where there is nothing:
// laying the result over what it was made from keeps the edges filled.
const filled = (result, input, under) => fe('feComposite', { in: input, in2: under, operator: 'over', result });
// One channel of a noise as opaque grey, stretched about 0.5 by gain.
const channel = (result, input, index, gain = 1) => {
  const row = [0, 0, 0, 0, 0.5 - 0.5 * gain];
  row[index] = gain;
  return matrix(result, input, [...row, ...row, ...row, 0, 0, 0, 0, 1]);
};
// input × (1 − amount × noise channel), the channel stretched about 0.5: an
// uneven darkening that keeps hue and leaves near-black alone.
const shade = (result, input, noiseInput, index, amount) => {
  const gain = 2, row = [0, 0, 0, 0, 1 - amount * (0.5 - 0.5 * gain)];
  row[index] = -amount * gain;
  return [matrix(`${result}-m`, noiseInput, [...row, ...row, ...row, 0, 0, 0, 0, 1]), fe('feBlend', { in: `${result}-m`, in2: input, mode: 'multiply', result })].join('');
};
// Paper: a fine grey tooth (0.5 ± the noise × depth × grain) overlaid into
// the picture (an overlay is proportional at both ends, so near-black and
// near-white stay calm); the same in every drawing. grain 0 leaves the
// picture as it is.
const paper = (result, input, plan, frequency, depth) => plan.grain > 0
  ? [noise(`${result}-n`, freq(frequency / plan.unit), 7, 2), channel(`${result}-g`, `${result}-n`, 0, depth * plan.grain), fe('feBlend', { in: `${result}-g`, in2: input, mode: 'overlay', result })].join('')
  : fe('feOffset', { in: input, dx: 0, dy: 0, result });

// Contrast (scale and offset) and saturation in one colour matrix.
const punch = (contrast, offset, saturation) => {
  const w = [0.2126, 0.7152, 0.0722].map((x) => x * (1 - saturation));
  const row = (i) => [...w.map((x, j) => (x + (i === j ? saturation : 0)) * contrast), 0, offset];
  return [...row(0), ...row(1), ...row(2), 0, 0, 0, 1, 0];
};

const STACKS = {
  // Thick paint: shapes swirl at the edges, short bristle strokes curve
  // through every fill and drag the colour along, and the strokes stand up
  // in relief under a raking light (the relief is the canvas: grain deepens it).
  oil(plan, v) {
    const { unit: u, strength: s } = plan;
    return [
      noise('swirl', freq(0.004 / u), 11 + v * 17, 2),
      displace('wobble-raw', 'SourceGraphic', 'swirl', 26 * u * s),
      filled('wobble', 'wobble-raw', 'SourceGraphic'),
      noise('stroke-raw', freq(0.012 / u, 0.07 / u), 23 + v * 17, 3),
      displace('stroke-bent', 'stroke-raw', 'swirl', 260 * u),
      filled('stroke', 'stroke-bent', 'stroke-raw'),
      displace('smear-raw', 'wobble', 'stroke', 18 * u * s),
      filled('smear', 'smear-raw', 'wobble'),
      relief('impasto', 'stroke', u * (1.5 + 4 * s) * (0.6 + 0.8 * plan.grain)),
      softLight('out', 'impasto', 'smear')
    ];
  },
  // Washes: soft wobbling edges that bleed, pigment pooled darker at every
  // edge, blotchy uneven washes, lifted transparent colour and cold-press paper.
  watercolour(plan, v) {
    const { unit: u, strength: s } = plan;
    return [
      noise('flow', freq(0.006 / u), 31 + v * 13, 2),
      displace('wobble-raw', 'SourceGraphic', 'flow', 15 * u * s),
      filled('wobble', 'wobble-raw', 'SourceGraphic'),
      blur('wide-raw', 'wobble', 6 * u),
      filled('wide', 'wide-raw', 'wobble'),
      arithmetic('bleed', 'wobble', 'wide', 0, 1 - 0.2 * s, 0.2 * s),
      // Pigment pools on the darker side of each edge: a wash darkens at its
      // rim, and light text on a dark wash keeps its shape.
      fe('feBlend', { in: 'wide', in2: 'wobble', mode: 'lighten', result: 'upper' }),
      edges('rim', 'upper', 'wobble', 2.6),
      darken('pooled', 'bleed', 'rim', 1.2 * s),
      // Uneven washes: a slow noise darkens some of the wash a little (a
      // multiply, so dark grounds barely change).
      shade('washed', 'pooled', 'flow', 2, 0.22 * s),
      // Transparent pigment: a little less saturated, every value lifted toward the paper.
      matrix('lifted', 'washed', punch(1 - 0.05 * s, 0.05 * s, 1 - 0.12 * s)),
      paper('out', 'lifted', plan, 0.14, 0.9)
    ];
  },
  // Chalk pastel or crayon: crumbly edges, directional strokes, and the
  // paper's tooth showing through the pigment in specks.
  pastel(plan, v) {
    const { unit: u, strength: s } = plan;
    return [
      noise('drift', freq(0.009 / u), 41 + v * 19, 2),
      displace('wobble-raw', 'SourceGraphic', 'drift', 12 * u * s),
      noise('crumb', freq(0.11 / u), 43 + v * 19, 1),
      displace('rough-raw', 'wobble-raw', 'crumb', 7 * u * s),
      filled('rough', 'rough-raw', 'SourceGraphic'),
      noise('stroke-raw', freq(0.2 / u, 0.02 / u), 47 + v * 19, 2),
      displace('stroke-bent', 'stroke-raw', 'drift', 60 * u),
      filled('stroke', 'stroke-bent', 'stroke-raw'),
      channel('stroke-grey', 'stroke', 0, 1.4),
      noise('tooth-raw', freq(0.42 / u), 5, 2),
      channel('tooth', 'tooth-raw', 0, 1.4),
      arithmetic('grit', 'stroke-grey', 'tooth', 0, 0.55, 0.45),
      // The grit's peaks (the paper's tooth) take no pigment: its height
      // becomes alpha, cut off steeply.
      matrix('grit-alpha', 'grit', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0]),
      fe('feComponentTransfer', { in: 'grit-alpha', result: 'gap-mask' }, fe('feFuncA', { type: 'linear', slope: 8, intercept: r(-8 * (0.66 - 0.12 * plan.grain)) })),
      fe('feFlood', { 'flood-color': mix(plan.bg, '#ffffff', 0.15), 'flood-opacity': r(0.4 + 0.5 * s), result: 'paper-colour' }),
      fe('feComposite', { in: 'paper-colour', in2: 'gap-mask', operator: 'in', result: 'specks' }),
      fe('feComposite', { in: 'specks', in2: 'rough', operator: 'over', result: 'chalked' }),
      arithmetic('streaked', 'chalked', 'stroke-grey', 0, 1, 0.2 * s, -0.1 * s),
      saturate('out', 'streaked', 1 - 0.1 * s)
    ];
  },
  // Inked like a graphic novel: a black line drawn round every shape that
  // jitters as it boils, richer colour and a little paper.
  ink(plan, v) {
    const { unit: u, strength: s } = plan;
    return [
      noise('jitter', freq(0.02 / u), 53 + v * 23, 2),
      displace('wobble-raw', 'SourceGraphic', 'jitter', 6 * u * (0.4 + s)),
      filled('wobble', 'wobble-raw', 'SourceGraphic'),
      blur('soft', 'wobble', 1.6 * u),
      // Only the darker side of each edge takes the line, so light text on a
      // dark ground keeps its shape and dark lines thicken outward.
      fe('feBlend', { in: 'soft', in2: 'wobble', mode: 'lighten', result: 'upper' }),
      fe('feBlend', { in: 'upper', in2: 'wobble', mode: 'difference', result: 'edge' }),
      // 1 − line, steeply: white where there is no edge, black on it. The
      // line is not thickened, so thin light text keeps its strokes.
      grey('unlined', 'edge', -6 * (2.5 + 3 * s), 1.12),
      fe('feBlend', { in: 'unlined', in2: 'wobble', mode: 'multiply', result: 'inked' }),
      saturate('vivid', 'inked', 1 + 0.2 * s),
      paper('out', 'vivid', plan, 0.25, 0.7)
    ];
  },
  // Flat gouache, like a storybook: matte opaque colour, rough dry-brush
  // edges, short brush marks through the fills and a soft paper.
  gouache(plan, v) {
    const { unit: u, strength: s } = plan;
    return [
      noise('sway', freq(0.005 / u), 61 + v * 29, 2),
      displace('wobble-raw', 'SourceGraphic', 'sway', 16 * u * s),
      noise('dry', freq(0.07 / u), 67 + v * 29, 1),
      displace('rough-raw', 'wobble-raw', 'dry', 5 * u * s),
      filled('rough', 'rough-raw', 'SourceGraphic'),
      noise('brush-raw', freq(0.02 / u, 0.09 / u), 71 + v * 29, 2),
      displace('brush-bent', 'brush-raw', 'sway', 90 * u),
      filled('brush', 'brush-bent', 'brush-raw'),
      channel('brush-grey', 'brush', 0, 1.5),
      arithmetic('brushed', 'rough', 'brush-grey', 0, 1, 0.22 * s, -0.11 * s),
      saturate('matte', 'brushed', 1 - 0.1 * s),
      paper('out', 'matte', plan, 0.15, 0.8)
    ];
  }
};

function mix(a, b, t) {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((c, i) => Math.round(c + (y[i] - c) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** One drawing's filter primitives (markup), variant 0..variants-1. */
export function mediumPrimitives(plan, variant = 0) {
  return STACKS[plan.kind](plan, variant).join('');
}

/**
 * The <svg> that defines every drawing's filter, sized to nothing. Filters
 * work in canvas pixels (userSpaceOnUse) over exactly the canvas, in sRGB,
 * so both renderers compute the same values.
 */
export function mediumDefs(plan) {
  if (!plan) return '';
  const filters = plan.filters.map((id, v) => fe('filter', { id, x: 0, y: 0, width: plan.width, height: plan.height, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' }, mediumPrimitives(plan, v))).join('');
  return `<svg class="lc-medium-defs" width="0" height="0" aria-hidden="true" style="position:absolute;left:0;top:0;width:0;height:0"><defs>${filters}</defs></svg>`;
}

/** Inline style of the medium layer (both renderers), at a frame. */
export function mediumLayerStyle(plan, frame = 0) {
  const filter = mediumFilterAt(plan, frame);
  return { position: 'absolute', left: 0, top: 0, width: plan.width, height: plan.height, pointerEvents: 'none', backdropFilter: filter, WebkitBackdropFilter: filter };
}

// ---------------------------------------------------------------------------
// Plain words → a medium

// Words that name each medium, and the look words that come with them. The
// first medium whose words match wins, in this order (ink before oil, so
// "inked like a graphic novel" never reads as paint; pastel before oil, so an
// oil pastel is a pastel). Each pattern names a way of painting, not a
// subject: "oil and gas", "pastel colours", "car wash" and "printer ink" name
// no medium.
export const MEDIUM_WORDS = Object.freeze({
  ink: ['\\binked\\b', '\\bpen[- ]and[- ]ink\\b', '\\bink (?:drawing|illustration|style|wash|lines?)\\b', '\\bgraphic[- ]novel', '\\bcomic[- ]book (?:style|look|art)\\b', '\\bline[- ]art\\b'],
  watercolour: ['\\bwater[- ]?colou?r', '\\baquarelle\\b'],
  pastel: ['\\bpastels\\b', '\\b(?:chalk|oil) pastels?\\b', '\\bpastel (?:drawing|sketch|style|on paper|crayons?)\\b', '\\bcrayons?\\b', '\\bchalk(?:y| drawing| on)\\b'],
  gouache: ['\\bgouache\\b', '\\bstorybook\\b', '\\bpicture[- ]book\\b', '\\bposter paint\\b'],
  oil: ['\\boil[- ]paint', '\\boils? on canvas\\b', '\\bin oils?\\b', '\\bimpasto\\b', '\\bpainterly\\b', '\\bbrush[- ]?strokes?\\b', '\\bvan gogh\\b']
});
// Words that soften or strengthen the paint.
const SOFT_WORDS = ['\\bsoft\\b', '\\bsubtle\\b', '\\bgentle\\b', '\\blight touch\\b', '\\bdelicate\\b', '\\bfaint\\b'];
const STRONG_WORDS = ['\\bthick\\b', '\\bheavy\\b', '\\bbold\\b', '\\bexpressive\\b', '\\bloose\\b', '\\bwild\\b', '\\bstrong\\b'];
const STILL_WORDS = ['\\bno boil\\b', '\\bsteady lines\\b', '\\bstill lines\\b', '\\bwithout boil'];
// What each medium suggests for the rest of the look, when the words name no
// tone, theme or background of their own: the seeded style's constraints
// (kit/core/style-seed.mjs). Dreamy watercolour is calm on light paper;
// crayon for kids is playful; a graphic novel is serious and dark.
export const MEDIUM_LOOKS = Object.freeze({
  oil: Object.freeze({ tone: 'warm', theme: 'tinted', background: Object.freeze({ kind: 'texture', params: Object.freeze({ type: 'canvas', amount: 0.5 }) }) }),
  watercolour: Object.freeze({ tone: 'calm', theme: 'light', background: Object.freeze({ kind: 'paper', params: Object.freeze({ grain: 0.6, intensity: 0.4 }) }) }),
  pastel: Object.freeze({ tone: 'playful', theme: 'light', background: Object.freeze({ kind: 'paper', params: Object.freeze({ grain: 0.7, intensity: 0.3 }) }) }),
  ink: Object.freeze({ tone: 'serious', theme: 'light', background: Object.freeze({ kind: 'paper', params: Object.freeze({ grain: 0.4, intensity: 0.3 }) }) }),
  gouache: Object.freeze({ tone: 'warm', theme: 'light', background: Object.freeze({ kind: 'texture', params: Object.freeze({ type: 'fibre', amount: 0.5 }) }) })
});
const DREAMY_WORDS = ['\\bdreamy\\b', '\\bethereal\\b', '\\bwhimsical\\b', '\\bfaith\\b', '\\bspiritual\\b', '\\bpeaceful\\b'];
const KIDS_WORDS = ['\\bkids?\\b', '\\bchildren\\b', '\\bchildren\'s\\b', '\\bnursery\\b'];
const DARK_WORDS = ['\\bdark\\b', '\\bnoir\\b', '\\bmoody\\b', '\\bgritty\\b'];

const matches = (patterns, text) => patterns.some((source) => new RegExp(source, 'i').test(text));

/**
 * The medium a plain-words description names, with the look that goes with
 * it: "soft watercolour, dreamy" → {medium: {kind: "watercolour", strength:
 * 0.4}, tone: "calm", theme: "light", background: {kind: "paper", ...}}.
 * strength follows soft/thick words; "no boil" keeps lines still. tone,
 * theme and background are suggestions for the seeded style; words that name
 * their own (toneFromText, "dark") win. Null when no medium is named.
 */
export function mediumFromText(text) {
  const value = String(text ?? '');
  const kind = Object.keys(MEDIUM_WORDS).find((name) => matches(MEDIUM_WORDS[name], value));
  if (!kind) return null;
  const medium = { kind };
  if (matches(SOFT_WORDS, value)) medium.strength = 0.4;
  else if (matches(STRONG_WORDS, value)) medium.strength = 0.85;
  if (matches(STILL_WORDS, value)) medium.boil = false;
  const look = MEDIUM_LOOKS[kind];
  const tone = matches(KIDS_WORDS, value) ? 'playful' : matches(DREAMY_WORDS, value) ? 'calm' : look.tone;
  const theme = matches(DARK_WORDS, value) ? 'dark' : look.theme;
  return { medium: Object.keys(medium).length === 1 ? kind : medium, tone, theme, background: JSON.parse(JSON.stringify(look.background)) };
}

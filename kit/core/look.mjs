// Look: one treatment applied to the world, the cast and the cards together
// (docs/SCENE_LOOKS_RFC.md). Set by story.look (a style pack's `look`, merged
// by kit/core/style.mjs applyStyle) as a name or {name, strength?, step?,
// furniture?, palette?, labels?}; "none" or no look leaves the render exactly
// as it was.
//
// A look is made of parts the kit shares between looks (kit/core/looks/):
//
// - presets: values for fields the story already has (brand.colors,
//   cast.style, world.time, background, light, medium), filled by applyLook
//   under the story's own values;
// - a grade: one whole-frame SVG filter stack on a full-canvas
//   `backdrop-filter` layer above the scenes, the camera, the light and the
//   medium, and below the brand frame and the captions, so the world, the
//   cast and every card take the look and the text an editor reads stays
//   crisp. It comes in a few drawings picked from the absolute frame;
// - frame stepping: with `step` (drawings a second) the scenes, the camera
//   and the light hold on the last step (lookStepFrame), "animating on twos";
// - furniture: look-specific overlay markup above the grade (scanlines, a
//   camera overlay, dimension lines), its motion a few CSS variables.
//
// Everything that changes over time is a function of the absolute story
// frame (lookVarsAt), so a seek, a partial re-render and a preview window
// give the same pixels. Both renderers draw from the same plan: the
// HyperFrames compiler emits lookDefs() and lookCss() and sets the variables
// with tl.set at lookSteps(); the Remotion StoryComposition renders the same
// markup and sets lookVarsAt(plan, frame) inline.
//
// Canonical copy: kit/core/look.mjs.

import { profileGeometry } from './layout-check.mjs';
import { LOOKS } from './looks/index.mjs';
import { fe, hash, r } from './looks/parts.mjs';

export const LOOK_NAMES = Object.freeze(['none', ...Object.keys(LOOKS)]);
export const LOOK_KEYS = Object.freeze(['name', 'strength', 'step', 'furniture', 'palette', 'labels']);
export const LOOK_PALETTES = Object.freeze(['look', 'brand']);
// Drawings a second a look may hold the picture at; 12 is "on twos" at 24 fps.
export const LOOK_STEP = Object.freeze({ min: 6, max: 15 });
export const LOOK_LABELS_MAX = 6;
export const LOOK_LABEL_LENGTH = 28;
export const LOOK_LAYER_ID = 'lc-look';
export const LOOK_FURNITURE_ID = 'lc-look-furniture';
// Above the medium (80000 / 49), below the brand frame (90000) and the
// captions (100000 / 50). Remotion draws both after the medium in DOM order.
export const LOOK_Z = Object.freeze({ hyperframes: Object.freeze({ grade: 81000, furniture: 82000 }), remotion: 49 });
export const LOOK_INFO = Object.freeze(Object.fromEntries(Object.entries(LOOKS).map(([name, look]) => [name, Object.freeze({ describe: look.describe, honest: look.honest ?? null, step: look.defaults?.step ?? 0 })])));
// Names people write for a look: the validator names the look to use instead.
const ALIASES = Object.freeze({ holo: 'hologram', holographic: 'hologram', 'thermal-camera': 'thermal', infrared: 'thermal', neon: 'neon-night', 'neon-noir': 'neon-night', cyberpunk: 'neon-night', 'paper-cut': 'paper-cutout', cutout: 'paper-cutout', 'cut-out': 'paper-cutout', iso: 'isometric', anime: 'anime-cel', cel: 'anime-cel', ascii: 'ascii-terminal', terminal: 'ascii-terminal', watercolor: 'watercolour', claymation: 'clay', plasticine: 'clay', blueprints: 'blueprint' });

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isUnit = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const clone = (value) => JSON.parse(JSON.stringify(value));

/** Validation messages for a story's or a pack's look (empty = valid). Each names the fix. */
export function lookErrors(value, path = 'look') {
  if (value === undefined || value === null) return [];
  const nameError = (name, where) => {
    const alias = typeof name === 'string' ? ALIASES[name.trim().toLowerCase()] : null;
    if (alias && LOOK_NAMES.includes(alias)) return `${where} "${name}" is called "${alias}" here; use "${alias}"`;
    return `${where} must be one of ${LOOK_NAMES.join(', ')} (got ${JSON.stringify(name)})`;
  };
  if (typeof value === 'string') return LOOK_NAMES.includes(value) ? [] : [nameError(value, path)];
  if (!isObject(value)) return [`${path} must be a look name (${LOOK_NAMES.join(', ')}) or {name, strength?, step?, furniture?, palette?, labels?}`];
  const errors = [];
  for (const key of Object.keys(value)) if (!LOOK_KEYS.includes(key)) errors.push(`${path}.${key} is not supported (allowed: ${LOOK_KEYS.join(', ')})`);
  if (!LOOK_NAMES.includes(value.name)) errors.push(nameError(value.name, `${path}.name`));
  if (value.strength !== undefined && !isUnit(value.strength)) errors.push(`${path}.strength must be a number from 0 to 1 (lower keeps the frame closer to the clean render)`);
  if (value.step !== undefined && value.step !== false && !(typeof value.step === 'number' && value.step >= LOOK_STEP.min && value.step <= LOOK_STEP.max)) errors.push(`${path}.step must be false or the drawings a second to hold the picture at, ${LOOK_STEP.min} to ${LOOK_STEP.max} (12 animates on twos)`);
  if (value.furniture !== undefined && typeof value.furniture !== 'boolean') errors.push(`${path}.furniture must be true or false (false leaves out the look's overlay: labels, grids, camera marks)`);
  if (value.palette !== undefined && !LOOK_PALETTES.includes(value.palette)) errors.push(`${path}.palette must be "look" (the look's own colours) or "brand" (keep the style's colours)`);
  if (value.labels !== undefined && !(Array.isArray(value.labels) && value.labels.length <= LOOK_LABELS_MAX && value.labels.every((label) => typeof label === 'string' && label.trim() && label.length <= LOOK_LABEL_LENGTH))) errors.push(`${path}.labels must be up to ${LOOK_LABELS_MAX} short labels (1 to ${LOOK_LABEL_LENGTH} characters each)`);
  return errors;
}

/** A look value with every key filled → {name, strength, step, furniture, palette, labels}, or null for none, absent or invalid. */
export function normalizeLook(value) {
  if (value === undefined || value === null || lookErrors(value).length) return null;
  const given = typeof value === 'string' ? { name: value } : value;
  if (given.name === 'none') return null;
  const defaults = LOOKS[given.name].defaults ?? {};
  return {
    name: given.name,
    strength: given.strength ?? defaults.strength ?? 1,
    step: given.step === false ? 0 : given.step ?? defaults.step ?? 0,
    furniture: given.furniture ?? true,
    palette: given.palette ?? 'look',
    labels: (given.labels ?? []).map((label) => label.trim())
  };
}

/** What a look sets on the fields a story already has → {colors?, cast?: {style}, world?: {time}, background?, light?, medium?}. */
export function lookPresets(value) {
  const look = normalizeLook(value);
  if (!look) return {};
  const presets = clone(LOOKS[look.name].presets?.(look) ?? {});
  if (look.palette === 'brand') delete presets.colors;
  return presets;
}

/**
 * The story with its look's presets filled under its own values: a colour
 * role, cast.style, world.time, background, light and medium are set only
 * where the story has none. `value` is the look to apply when the story names
 * none (a style pack's), and it is then written to story.look. The input is
 * not changed. → {story, applied: [paths]}
 */
export function applyLook(story, value = undefined) {
  if (!isObject(story)) throw new Error('story must be a JSON object');
  const given = story.look ?? value;
  const look = normalizeLook(given);
  if (!look) return { story, applied: [] };
  const out = clone(story);
  const applied = [];
  if (out.look === undefined) { out.look = clone(given); applied.push('look'); }
  const presets = lookPresets(given);
  if (presets.colors) {
    if (!isObject(out.brand)) out.brand = {};
    if (!isObject(out.brand.colors)) out.brand.colors = {};
    for (const [role, hex] of Object.entries(presets.colors)) if (out.brand.colors[role] === undefined) { out.brand.colors[role] = hex; applied.push(`brand.colors.${role}`); }
  }
  if (presets.cast?.style && isObject(out.cast) && out.cast.style === undefined) { out.cast.style = presets.cast.style; applied.push('cast.style'); }
  if (presets.world) {
    if (out.world === undefined && presets.world.kind) { out.world = clone(presets.world); applied.push('world'); }
    else if (isObject(out.world) && out.world.time === undefined && presets.world.time) { out.world.time = presets.world.time; applied.push('world.time'); }
  }
  for (const key of ['background', 'light', 'medium']) if (presets[key] !== undefined && out[key] === undefined) { out[key] = presets[key]; applied.push(key); }
  return { story: out, applied };
}

/** The story frame whose picture frame `frame` shows under a step of `step` drawings a second (a whole frame at or after each step's time). */
export function stepFrame(frame, fps, step) {
  const f = Math.max(0, Math.floor(Number(frame) + 1e-6));
  if (!(step > 0) || step >= fps) return f;
  const index = Math.floor((f * step) / fps + 1e-9);
  return Math.ceil((index * fps) / step - 1e-9) + 0;
}

/** Which drawing (0, 1, 2, …) frame `frame` is under a step: the step number. */
export function stepIndex(frame, fps, step) {
  const f = Math.max(0, Math.floor(Number(frame) + 1e-6));
  return step > 0 && step < fps ? Math.floor((f * step) / fps + 1e-9) : f;
}

/**
 * The look pass for a story, or null when it has no look (the render is then
 * unchanged). → {name, strength, step, labels, width, height, fps, unit,
 * duration, frames, seed, safe, band, shots, cues, title, colors, variants,
 * filters: [ids], grade: boolean, furniture: {html, css} | null}
 */
export function lookPlan(story) {
  const look = normalizeLook(story?.look);
  if (!look) return null;
  const width = Number(story?.format?.width), height = Number(story?.format?.height);
  if (!(width > 0 && height > 0)) return null;
  const def = LOOKS[look.name];
  const fps = Number(story?.resolved?.fps ?? story?.format?.fps ?? 30);
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration ?? 0);
  const geometry = profileGeometry({ width, height });
  const scenes = (Array.isArray(story?.scenes) ? story.scenes : []).filter((scene) => isObject(scene) && typeof scene.start === 'number' && typeof scene.end === 'number');
  const shots = scenes.filter((scene) => (scene.track ?? 0) === 0).map((scene) => ({ id: scene.id, start: scene.start, end: scene.end })).sort((a, b) => a.start - b.start);
  // The cast's expression changes, in story seconds (a cue's `at` is from its scene's start).
  const cues = scenes.flatMap((scene) => (Array.isArray(scene.params?.cast) ? scene.params.cast : scene.params?.character ? [scene.params] : []).flatMap((entry) => [
    ...(typeof entry?.expression === 'string' ? [{ at: scene.start, expression: entry.expression }] : []),
    ...(Array.isArray(entry?.cues) ? entry.cues.filter((cue) => isObject(cue) && typeof cue.at === 'number' && typeof cue.expression === 'string').map((cue) => ({ at: scene.start + cue.at, expression: cue.expression })) : [])
  ])).sort((a, b) => a.at - b.at);
  const plan = {
    ...look,
    // Footage is never stepped (its frames are the recording's), so a story with a base is not.
    step: story?.base ? 0 : Math.min(look.step, fps),
    width, height, fps, duration,
    frames: Math.max(1, Math.round(duration * fps)),
    unit: Math.min(width, height) / 1080,
    seed: `${look.name}:${story?.title ?? ''}`,
    safe: geometry.safeZone, band: geometry.captionBand,
    shots, cues,
    title: typeof story?.title === 'string' ? story.title : '',
    world: typeof story?.world?.kind === 'string' ? story.world.kind : null,
    colors: clone(def.presets?.(look)?.colors ?? {}),
    brand: clone(story?.brand?.colors ?? {})
  };
  plan.variants = def.grade ? Math.max(1, typeof def.variants === 'function' ? def.variants(plan) : def.variants ?? 1) : 0;
  plan.grade = Boolean(def.grade);
  plan.filters = plan.grade ? Array.from({ length: plan.variants }, (_, v) => `${LOOK_LAYER_ID}-${v}`) : [];
  plan.furniture = look.furniture && def.furniture ? def.furniture(plan) : null;
  return plan;
}

/** Whether the picture is stepped. */
export const lookStepped = (plan) => Boolean(plan && plan.step > 0 && plan.step < plan.fps);

/** The story frame whose picture frame `frame` shows (the frame itself without a step). */
export function lookStepFrame(plan, frame) {
  return lookStepped(plan) ? stepFrame(frame, plan.fps, plan.step) : Math.max(0, Math.floor(Number(frame) + 1e-6));
}

/**
 * The stepped ease of the HyperFrames scene timeline, as JavaScript source:
 * progress 0..1 over the story → the held progress. It is lookStepFrame over
 * the story's frames.
 */
export function lookStepEase(plan) {
  const total = r(plan.duration * plan.fps, 6);
  return `(p) => { const f = Math.floor(p * ${total} + 1e-6); const k = Math.floor((f * ${plan.step}) / ${plan.fps} + 1e-9); return Math.min(1, Math.ceil((k * ${plan.fps}) / ${plan.step} - 1e-9) / ${total}); }`;
}

/** Which grade drawing frame `frame` shows. */
export function lookVariantAt(plan, frame) {
  if (!plan?.grade || plan.variants <= 1) return 0;
  const f = Math.max(0, Math.floor(Number(frame) + 1e-6));
  const def = LOOKS[plan.name];
  const v = def.variantAt ? def.variantAt(plan, f) : stepIndex(f, plan.fps, plan.step || 12);
  return ((Math.floor(v) % plan.variants) + plan.variants) % plan.variants;
}

/**
 * The look's CSS variables at a story frame: `--lc-look-filter` (the grade
 * drawing) and whatever the look's furniture moves by. Set on the grade layer
 * and the furniture root.
 */
export function lookVarsAt(plan, frame) {
  const f = Math.max(0, Math.floor(Number(frame) + 1e-6));
  const vars = {};
  if (plan.grade) vars['--lc-look-filter'] = `url(#${plan.filters[lookVariantAt(plan, f)]})`;
  const own = plan.furniture || plan.grade ? LOOKS[plan.name].vars?.(plan, f) : null;
  for (const [key, value] of Object.entries(own ?? {})) vars[key] = typeof value === 'number' ? r(value) : value;
  return vars;
}

/**
 * The variable changes over [0, duration] seconds as timeline steps
 * [{time, vars}]: every variable at 0, then only what changed, half a frame
 * before the frame that shows it, so a seek to that frame never lands on the
 * boundary.
 */
export function lookSteps(plan, duration) {
  if (!plan) return [];
  let last = lookVarsAt(plan, 0);
  const steps = Object.keys(last).length ? [{ time: 0, vars: last }] : [];
  const end = Math.floor(Number(duration) * plan.fps + 1e-6);
  for (let frame = 1; frame <= end; frame += 1) {
    const now = lookVarsAt(plan, frame);
    const changed = Object.fromEntries(Object.entries(now).filter(([key, value]) => last[key] !== value));
    if (Object.keys(changed).length) steps.push({ time: r((frame - 0.5) / plan.fps), vars: changed });
    last = now;
  }
  return steps;
}

/** One grade drawing's filter primitives (markup), variant 0..variants-1. */
export function lookPrimitives(plan, variant = 0) {
  const primitives = LOOKS[plan.name].grade(plan, variant);
  // strength under 1: the graded frame mixed back toward the clean one.
  if (plan.strength < 1) primitives.push(fe('feComposite', { in: 'out', in2: 'SourceGraphic', operator: 'arithmetic', k1: 0, k2: r(plan.strength), k3: r(1 - plan.strength), k4: 0, result: 'mixed' }));
  return primitives.join('');
}

/** The <svg> that defines every grade drawing's filter, sized to nothing ('' without a grade). */
export function lookDefs(plan) {
  if (!plan?.grade) return '';
  const filters = plan.filters.map((id, v) => fe('filter', { id, x: 0, y: 0, width: plan.width, height: plan.height, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' }, lookPrimitives(plan, v))).join('');
  return `<svg class="lc-look-defs" width="0" height="0" aria-hidden="true" style="position:absolute;left:0;top:0;width:0;height:0"><defs>${filters}</defs></svg>`;
}

/** The CSS of the grade layer and the furniture (both renderers). `z`: {grade, furniture} z-indexes. */
export function lookCss(plan, z = LOOK_Z.hyperframes) {
  const box = `position: absolute; left: 0; top: 0; width: ${plan.width}px; height: ${plan.height}px; pointer-events: none;`;
  const lines = [];
  if (plan.grade) lines.push(`#${LOOK_LAYER_ID} { ${box} z-index: ${z.grade}; backdrop-filter: var(--lc-look-filter); -webkit-backdrop-filter: var(--lc-look-filter); }`);
  if (plan.furniture) lines.push(`#${LOOK_FURNITURE_ID} { ${box} z-index: ${z.furniture}; overflow: hidden; font-family: var(--lc-font-meta); }`, plan.furniture.css);
  return lines.join('\n');
}

/** The look's markup after its defs: the grade layer and the furniture root, with the variables of frame 0 inline. */
export function lookMarkup(plan) {
  const style = Object.entries(lookVarsAt(plan, 0)).map(([key, value]) => `${key}:${value}`).join(';');
  return [
    plan.grade ? `<div id="${LOOK_LAYER_ID}" data-launchclip-look="${plan.name}" aria-hidden="true" style="${style}"></div>` : '',
    plan.furniture ? `<div id="${LOOK_FURNITURE_ID}" data-launchclip-look="${plan.name}" aria-hidden="true" style="${style}">${plan.furniture.html}</div>` : ''
  ].join('');
}

/** The selector the variables are set on. */
export function lookSelector(plan) {
  return [plan.grade ? `#${LOOK_LAYER_ID}` : null, plan.furniture ? `#${LOOK_FURNITURE_ID}` : null].filter(Boolean).join(', ');
}

// ---------------------------------------------------------------------------
// Plain words → a look

/**
 * The look a plain-words description names ("as a hologram", "blueprint
 * style", "thermal camera"), or null. Each pattern names a way of drawing the
 * whole frame, not a subject.
 */
export function lookFromText(text) {
  const value = String(text ?? '');
  for (const [name, look] of Object.entries(LOOKS)) {
    if ((look.words ?? []).some((source) => new RegExp(source, 'i').test(value))) return name;
  }
  return null;
}

export { hash as lookHash };

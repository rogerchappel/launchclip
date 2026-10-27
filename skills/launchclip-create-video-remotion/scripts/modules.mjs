// Unified module registry: scene → resolved model, for editorial kinds and
// catalogue modules alike. Both compilers (kit/hyperframes/story-compiler.mjs
// and kit/remotion/StoryComposition.tsx) and the parity harness call
// resolveModule(), so a scene resolves to the same model in both renderers.
// Plain ESM; imports only sibling kit/core files. Contract:
// docs/KIT_CONTRACTS.md, "Unified module registry".
//
// Canonical copy: kit/core/modules.mjs.

import { EDITORIAL_KINDS, EDITORIAL_VARIANTS, checklistTypeIn, editorialTimingRules, resolveEditorialModule } from './editorial-core.mjs';
import { fontStack } from './fonts.mjs';
import { MODULES as CATALOG_A } from './catalog-a.mjs';
import { MODULES as CATALOG_B } from './catalog-b.mjs';
import { MODULES as CATALOG_C } from './catalog-c.mjs';
import { MODULES as CATALOG_D } from './catalog-d.mjs';
import { MODULES as CATALOG_E } from './catalog-e.mjs';
import { MODULES as CATALOG_F } from './catalog-f.mjs';
import { MODULES as CATALOG_G } from './catalog-g.mjs';
import { MODULES as CATALOG_H } from './catalog-h.mjs';
import { MODULES as CHARACTERS } from './catalog-characters.mjs';
import { MODULES as WORLD, castStandsIn, worldBeneath } from './catalog-world.mjs';
import { plateBleed, ridesPlate } from './camera-world.mjs';
import { sceneWindows } from './transitions.mjs';
import { storyBase } from './story.mjs';
import { isEditorialGrammar, resolveGrammar } from './grammar.mjs';
import { profileGeometry } from './layout-check.mjs';
import { brandFrameSafe, intersectRects } from './brand-frame.mjs';
import { sceneAmbient } from './ambient.mjs';
import { panelFill, storyPanel } from './panels.mjs';
import { cardFillStyles, fieldStyle, panelFillPlan } from './backgrounds.mjs';
import { subjectContext, subjectModelErrors } from './subject-layer.mjs';
import { sceneLayoutAt, storySections } from './footage-layout.mjs';
import { resolveShotStates, stateSpec } from './shot-states.mjs';

const EDITORIAL_CANVAS = { '9:16': { width: 1080, height: 1920 }, '16:9': { width: 1920, height: 1080 } };
const DOM_ID = /^[a-z][a-z0-9-]{0,59}$/;

/** Every catalogue module definition, keyed by id (catalogue A, then B, C, D, E, F, G, H, the character modules and the world module). */
export function catalogModules() {
  const merged = {};
  for (const [label, table] of [['catalog-a', CATALOG_A], ['catalog-b', CATALOG_B], ['catalog-c', CATALOG_C], ['catalog-d', CATALOG_D], ['catalog-e', CATALOG_E], ['catalog-f', CATALOG_F], ['catalog-g', CATALOG_G], ['catalog-h', CATALOG_H], ['characters', CHARACTERS], ['world', WORLD]]) {
    for (const [id, definition] of Object.entries(table ?? {})) {
      if (EDITORIAL_KINDS.includes(id)) throw new Error(`${label} module "${id}" collides with an editorial kind`);
      if (merged[id]) throw new Error(`${label} module "${id}" is defined twice`);
      merged[id] = definition;
    }
  }
  return merged;
}

/** Editorial kinds plus catalogue ids. */
export function knownModules() {
  return [...EDITORIAL_KINDS, ...Object.keys(catalogModules())];
}

/**
 * Every module's designed variants, {<module>: [names]} with the default (the
 * module's original look) first (docs/SEEDED_STYLES_RFC.md §3.2). A style's
 * variants (story.variants) and a scene's params.variant name one of these.
 */
export function moduleVariants() {
  const out = {};
  for (const [id, names] of Object.entries(EDITORIAL_VARIANTS)) out[id] = [...names];
  for (const [id, definition] of Object.entries(catalogModules())) if (Array.isArray(definition.variants) && definition.variants.length > 1) out[id] = [...definition.variants];
  return out;
}

export function isEditorialKind(id) {
  return EDITORIAL_KINDS.includes(id);
}

/**
 * Timing rules for a module id, generated from the module code's own timing
 * constants: {minDuration, leadIn, leadOut, gaps: [{between, seconds}],
 * rules: [string]} (seconds; leadIn is the earliest `at`, leadOut how long
 * before the scene end the last `at` may fall; null when the module has no
 * such beat). Editorial kinds come from editorial-core.mjs
 * editorialTimingRules(), catalogue modules from their MODULES[id].timing.
 * null for an unknown id.
 */
export function moduleTiming(id) {
  if (isEditorialKind(id)) return editorialTimingRules(id);
  const definition = catalogModules()[id];
  return definition?.timing ?? null;
}

/** The `at` window a timing table allows in a scene of `duration` s: {from, to} | null. */
export function timingWindow(timing, duration) {
  if (!timing || timing.leadIn == null || timing.leadOut == null || !(duration > 0)) return null;
  return { from: timing.leadIn, to: Math.round((duration - timing.leadOut) * 100) / 100 };
}

/** Scene id → a DOM-safe module id (scene ids may contain "_"). */
export function moduleDomId(sceneId) {
  return String(sceneId ?? '').toLowerCase().replace(/_/g, '-');
}

/** "9:16" | "16:9" | "1:1" | "4:5" | null */
export function formatAspect(format) {
  const ratio = Number(format?.width) / Number(format?.height);
  const table = [['9:16', 9 / 16], ['16:9', 16 / 9], ['1:1', 1], ['4:5', 4 / 5]];
  const match = table.find(([, value]) => Math.abs(ratio - value) / value < 0.01);
  return match ? match[0] : null;
}

/** Mix two #rrggbb colours: `amount` of `top` over `bottom`. */
export function mixHex(top, bottom, amount) {
  const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = parse(top), b = parse(bottom);
  return `#${a.map((value, i) => Math.round(value * amount + b[i] * (1 - amount)).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrastRatio(a, b) {
  const luminance = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Brand → editorial defaults ({accent?, theme?}); params set explicitly win.
 * accent = brand.colors.primary. theme = {surface: bg, foreground: paper,
 * muted: paper 62% over bg, border: paper 18% over bg, accentText}, where
 * accentText is the primary colour when it reaches 3:1 on bg, else paper.
 */
export function brandModuleDefaults(brand) {
  const colors = brand && typeof brand.colors === 'object' && brand.colors ? brand.colors : {};
  const defaults = {};
  if (HEX.test(colors.primary ?? '')) defaults.accent = colors.primary;
  if (HEX.test(colors.bg ?? '') && HEX.test(colors.paper ?? '')) {
    const accentText = HEX.test(colors.primary ?? '') && contrastRatio(colors.primary, colors.bg) >= 3 ? colors.primary : colors.paper;
    defaults.theme = { surface: colors.bg, foreground: colors.paper, muted: mixHex(colors.paper, colors.bg, 0.62), border: mixHex(colors.paper, colors.bg, 0.18), accentText };
  }
  return defaults;
}

// status-rack tones from brand roles: brand.colors.pass (or success) and
// brand.colors.fail (or danger / error) seed the status palette's green and
// red; the editorial core still checks their contrast. Only added when the
// scene opts in to the status palette, so a plain rack is untouched.
function statusRackDefaults(module, brand, params) {
  if (module !== 'status-rack' || params.tones !== undefined) return {};
  const rows = Array.isArray(params.rack?.rows) ? params.rack.rows : [];
  const opted = params.palette === 'status' || rows.some((row) => Array.isArray(row?.states) && row.states.some((state) => state?.tone !== undefined || (Array.isArray(state?.lights) && state.lights.some((light) => typeof light === 'string'))));
  if (!opted) return {};
  const colors = brand && typeof brand.colors === 'object' && brand.colors ? brand.colors : {};
  const pick = (...roles) => roles.map((role) => colors[role]).find((value) => HEX.test(value ?? ''));
  const tones = {};
  const pass = pick('pass', 'success'), fail = pick('fail', 'danger', 'error');
  if (pass) tones.pass = pass;
  if (fail) tones.fail = fail;
  return Object.keys(tones).length ? { tones } : {};
}

function scenePath(scene, story) {
  const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
  let index = scenes.indexOf(scene);
  if (index < 0) index = scenes.findIndex((entry) => entry?.id === scene?.id);
  return `${index >= 0 ? `scenes[${index}]` : 'scene'}${scene?.id ? ` (${scene.id})` : ''}`;
}

/**
 * Resolve one (resolved) scene to its module model.
 * options.track: HyperFrames track index for the model root (compilers set it);
 * options.end: render-window end, when a compiler holds the scene on screen
 * through the next scene's transition (default scene.end).
 * Throws with a "scenes[i] (id)…" prefixed message on unknown modules or
 * invalid params.
 */
export function resolveModule(scene, story, { track, end } = {}) {
  const where = scenePath(scene, story);
  const finalEnd = endingEnd(scene, story, end);
  try {
    const model = resolveModuleInner(scene, story, { track, end: finalEnd });
    // Subject fields (layer parts, subjectCamera, room): kit/core/subject-layer.mjs.
    const problems = subjectModelErrors(model);
    if (problems.length) throw new Error(problems.join('; '));
    // Brand frame (kit/core/brand-frame.mjs): the area a module may use
    // without colliding with the frame, as model.frame.safe; inside a footage
    // layout's panel (sceneLayoutAt(...).safe) it is that panel's safe area
    // narrowed to the frame's.
    // Panel treatment (kit/core/panels.mjs): the story's card surface, read
    // by catalogue G's cardSurface. Absent without story.panel.
    const panel = storyPanel(story);
    if (panel) {
      const { fill, ...surface } = panel;
      model.panel = surface;
      // panel.fill: a still background inside a card, at the card's size on its fill colour.
      if (fill && model.surface === 'card' && model.rect?.width > 0) {
        const plan = panelFillPlan(story, { width: model.rect.width, height: model.rect.height, bg: panelFill(surface.treatment, story.brand?.colors ?? {}).color });
        if (plan) model.panel.fill = { styles: cardFillStyles(plan), mask: fieldStyle(plan) };
      }
    }
    const frameSafe = story?.frame ? brandFrameSafe(story) : null;
    if (frameSafe) {
      const panel = Number.isFinite(Number(scene?.start)) ? sceneLayoutAt(story, Number(scene.start), Number.isFinite(Number(scene?.end)) ? Number(scene.end) : Number(scene.start))?.safe ?? null : null;
      model.frame = { ...(model.frame && typeof model.frame === 'object' ? model.frame : {}), safe: intersectRects(panel ?? model.frame?.safe, frameSafe) };
    }
    // Shot states (kit/core/shot-states.mjs): one model per param change, for the states engine to morph between.
    if (Array.isArray(scene?.states) && scene.states.length) {
      const spec = stateSpec(scene.module, isEditorialKind(scene.module) ? null : catalogModules()[scene.module]);
      model.shotStates = resolveShotStates(scene, model, { spec, resolveWith: (params) => resolveModuleInner({ ...scene, params, states: undefined }, story, { track, end: finalEnd }) });
      if (Array.isArray(model.events)) model.events.push(...model.shotStates.events);
    }
    return model;
  } catch (error) {
    throw new Error(`${where}: ${error.message}${rectFitHint(scene, story, error.message, { end: finalEnd })}${sectionFitHint(scene, story, { end: finalEnd })}`);
  }
}

// ---------------------------------------------------------------------------
// Subject-effect density (docs/SUBJECT_EFFECTS_RFC.md §7.5). Effects on the
// presenter land when they are rare, so a footage-led story warns (never
// fails) when they crowd: together over SUBJECT_DENSITY.share of the runtime,
// two closer than SUBJECT_DENSITY.gap seconds, or two different ones back to
// back. A subject effect is a module that needs the subject, a scene drawn
// behind the presenter, or one of the camera moves on the presenter.
export const SUBJECT_DENSITY = Object.freeze({ share: 0.35, gap: 3, cameras: Object.freeze(['punch-in', 'zoom-through', 'pull-back']) });

/** True when a scene is a subject effect for the density budget. */
export function isSubjectEffect(scene) {
  if (!scene || typeof scene !== 'object' || scene.insert === true) return false;
  if (scene.layer === 'behind' || scene.layer === 'split') return true;
  if (SUBJECT_DENSITY.cameras.includes(scene.module)) return true;
  return Boolean(catalogModules()[scene.module]?.needs?.includes('subject'));
}

/** Density warnings for a resolved footage-led story, as strings. */
export function subjectDensityWarnings(story, options = {}) {
  return subjectDensityFindings(story, options).map((finding) => finding.detail);
}

/**
 * Density findings for a resolved footage-led story (numeric scene times):
 * [{ids, at, detail}]. Stories outside the lane, or with no subject effects,
 * get none. The runtime share comes from the cadence profile's
 * subject_effect_share ceiling (p90) when one is given (kit/core/profiles.mjs).
 */
export function subjectDensityFindings(story, { profile = null } = {}) {
  const share = Number(profile?.measures?.subject_effect_share?.p90 ?? SUBJECT_DENSITY.share);
  if (!storyBase(story)) return [];
  const fps = Number(story?.resolved?.fps ?? story?.format?.fps ?? 30);
  const frame = 1 / (Number.isFinite(fps) && fps > 0 ? fps : 30);
  const effects = (Array.isArray(story.scenes) ? story.scenes : [])
    .filter((scene) => isSubjectEffect(scene) && Number.isFinite(Number(scene.start)) && Number.isFinite(Number(scene.end)))
    .map((scene) => ({ id: scene.id, module: scene.module, start: Number(scene.start), end: Number(scene.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (!effects.length) return [];
  const findings = [];
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration);
  let covered = 0, reach = -Infinity;
  for (const effect of effects) {
    covered += Math.max(0, effect.end - Math.max(effect.start, reach));
    reach = Math.max(reach, effect.end);
  }
  if (Number.isFinite(duration) && duration > 0 && covered / duration > share + 1e-9) {
    findings.push({ ids: effects.map((effect) => effect.id), at: round3(effects[0].start), detail: `subject effects cover ${Math.round((covered / duration) * 100)}% of the runtime (${round3(covered)} of ${round3(duration)} s; ${effects.map((effect) => effect.id).join(', ')}); keep them under ${Math.round(share * 100)}%${profile?.id ? ` (profile ${profile.id})` : ''} so each one lands. Drop or shorten some` });
  }
  for (let i = 1; i < effects.length; i += 1) {
    const before = effects[i - 1], after = effects[i];
    const gap = after.start - before.end;
    if (gap <= frame + 1e-6 && before.module !== after.module) {
      const when = gap < -frame ? `overlap from ${round3(after.start)} s` : `run back to back at ${round3(after.start)} s`;
      findings.push({ ids: [before.id, after.id], at: round3(after.start), detail: `subject effects ${before.id} (${before.module}) and ${after.id} (${after.module}) ${when}; two different presenter effects in a row read as noise. Put ${SUBJECT_DENSITY.gap} s of plain recording between them, or keep one` });
    } else if (gap < SUBJECT_DENSITY.gap - 1e-6) {
      findings.push({ ids: [before.id, after.id], at: round3(before.end), detail: `subject effects ${before.id} (${before.module}) and ${after.id} (${after.module}) are ${round3(Math.max(0, gap))} s apart (from ${round3(before.end)} s to ${round3(after.start)} s); keep presenter effects at least ${SUBJECT_DENSITY.gap} s apart` });
    }
  }
  return findings;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// The last scene of a story that does not loop. ending.final (story.mjs):
//   "hold" (default) → the module resolves with its end FINAL_HOLD_TAIL past
//     the story end, so its exit falls after the last frame and the final
//     frame shows it settled;
//   "fade" → its end is pulled in to the final frame, so the exit completes
//     to the background by the last frame (never a half-dim final frame);
//   "exit" → unchanged (the exit ends exactly at format.duration).
// Applies to every scene still on screen at the story end (scene.end at the
// duration). Not applied when the story loops (ending.loop_to) or to
// footage-led stories (they end on the recording). A cta with params.loop
// (its own fade to the background) ends as "fade" under "hold".
export const FINAL_HOLD_TAIL = 2;

/** 'hold' | 'fade' | 'exit' | null (the story loops) for a story's last scene. */
export function storyFinal(story) {
  const ending = story?.ending;
  if (ending && typeof ending === 'object' && typeof ending.loop_to === 'string') return null;
  if (storyBase(story)) return 'exit';
  const final = ending && typeof ending === 'object' ? ending.final : undefined;
  return final === 'fade' || final === 'exit' ? final : 'hold';
}

function endingEnd(scene, story, end) {
  const final = storyFinal(story);
  if (!final || final === 'exit' || !scene || typeof scene !== 'object') return end;
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration);
  const sceneEnd = Number(scene.end), start = Number(scene.start);
  if (!Number.isFinite(duration) || !Number.isFinite(sceneEnd) || sceneEnd < duration - 1e-6) return end;
  const current = Number(end ?? sceneEnd);
  // A cta with params.loop fades itself to the background: it ends as "fade".
  if (final === 'hold' && !(scene.module === 'cta' && scene.params?.loop === true)) return current + FINAL_HOLD_TAIL;
  const fps = Number(story?.resolved?.fps ?? story?.format?.fps ?? 30);
  // The final frame's time, floored to the model's 1e-6 grid so the exit has
  // completed on that frame in both renderers.
  const last = Math.floor(((Math.round(duration * fps) - 1) / fps) * 1e6) / 1e6;
  return last - start >= 1 ? Math.min(current, last) : end;
}

// ---------------------------------------------------------------------------
// Rect fitting. Whether content fits a rect depends on its width (text wraps
// and editorial type follows the width), so "rect too short" alone leaves the
// author guessing. These helpers search the rect sizes that resolve.

const GEOMETRY_ERROR = /rect|too short|too long|too wide|too narrow|too tall|does not fit|leaves (only|too little|no room)|needs \d+ px|room for/i;
const FIT_STEP = 8;

function fitBounds(story) {
  const canvas = { width: Number(story?.format?.width), height: Number(story?.format?.height) };
  if (!(canvas.width > 0 && canvas.height > 0)) return null;
  const { safeZone } = profileGeometry(canvas);
  return { canvas, safe: safeZone };
}

// Positions to try for a probe size: the authored position (when it still
// fits the canvas), centred in the safe zone, then the safe zone's top-left.
function probePositions(width, height, bounds, rect) {
  const { canvas, safe } = bounds, out = [];
  const add = (x, y) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x + width > canvas.width || y + height > canvas.height) return;
    if (!out.some((p) => p.x === x && p.y === y)) out.push({ x, y });
  };
  if (rect && Number.isFinite(rect.x) && Number.isFinite(rect.y)) add(rect.x, rect.y);
  add(safe.x + (safe.width - width) / 2, safe.y + (safe.height - height) / 2);
  add(Math.ceil(safe.x), Math.ceil(safe.y));
  return out;
}

function fitsRect(scene, story, width, height, bounds, rect, end) {
  for (const position of probePositions(width, height, bounds, rect)) {
    const probe = { ...scene, params: { ...(scene.params ?? {}), rect: { ...position, width, height } } };
    try { resolveModuleInner(probe, story, { end }); return true; } catch { /* next position */ }
  }
  return false;
}

// Smallest integer in [lo, hi] where test() holds; null when it never does.
// A coarse scan finds the first fitting step (sizes too large fail too, so
// the range has no monotone top end), then a 1 px scan refines it.
function smallest(lo, hi, test) {
  lo = Math.ceil(lo); hi = Math.floor(hi);
  let previous = lo - 1;
  for (let value = lo; value <= hi + FIT_STEP - 1; value += FIT_STEP) {
    const at = Math.min(value, hi);
    if (test(at)) {
      for (let fine = previous + 1; fine < at; fine += 1) if (test(fine)) return fine;
      return at;
    }
    previous = at;
    if (at === hi) break;
  }
  return null;
}

// Largest integer in [lo, hi] where test() holds, scanning down from hi.
function largest(lo, hi, test) {
  lo = Math.ceil(lo); hi = Math.floor(hi);
  let previous = hi + 1;
  for (let value = hi; value >= lo - FIT_STEP + 1; value -= FIT_STEP) {
    const at = Math.max(value, lo);
    if (test(at)) {
      for (let fine = previous - 1; fine > at; fine -= 1) if (test(fine)) return fine;
      return at;
    }
    previous = at;
    if (at === lo) break;
  }
  return null;
}

/**
 * Sizes that fit a scene's content. options.width / options.height (default:
 * params.rect's) pick the fixed dimension. → {width, height, minHeight: the
 * least height that fits at `width` | null, widthAtHeight: the nearest width
 * that fits at `height` ({op: '≥', value} — the least width at or above
 * `width` — else {op: '≤', value}, the largest below it) | null}. Probes stay
 * inside the canvas and try the safe zone, so a catalogue module's own
 * safe-zone bound holds.
 */
export function moduleFit(scene, story, { width, height, end } = {}) {
  const bounds = fitBounds(story);
  if (!bounds) throw new Error('moduleFit needs story.format width and height');
  const rect = scene?.params?.rect;
  const w = Number(width ?? rect?.width), h = Number(height ?? rect?.height);
  const out = { width: Number.isFinite(w) ? w : null, height: Number.isFinite(h) ? h : null, minHeight: null, widthAtHeight: null };
  if (out.width !== null) out.minHeight = smallest(120, bounds.canvas.height, (value) => fitsRect(scene, story, out.width, value, bounds, rect, end));
  if (out.height !== null) {
    const at = (value) => fitsRect(scene, story, value, out.height, bounds, rect, end);
    const from = out.width ?? 200;
    const wider = smallest(from, bounds.canvas.width, at);
    if (wider !== null) out.widthAtHeight = { op: '≥', value: wider };
    else {
      const narrower = largest(200, from, at);
      if (narrower !== null) out.widthAtHeight = { op: '≤', value: narrower };
    }
  }
  return out;
}

/**
 * Suffix for a geometry error on a scene with an explicit params.rect:
 * "; checklist needs 640 px height at width 900 (or width ≥ 1100 at this
 * height)". Empty when the error is not about geometry or no size fits.
 */
/**
 * For a footage-led scene placed in the full frame although it overlaps a
 * section: which section it fell outside and by how much, so a fitting
 * error ("does not fit beside the presenter") names the real cause.
 */
export function sectionFitHint(scene, story, { end } = {}) {
  if (story?.lane !== 'footage-led' || scene?.insert === true) return '';
  const start = Number(scene?.start), finish = Number(end ?? scene?.end);
  if (!Number.isFinite(start) || !Number.isFinite(finish) || sceneLayoutAt(story, start, finish)) return '';
  const section = storySections(story).find((entry) => entry.layout !== 'full' && Math.min(finish, entry.end) - Math.max(start, entry.start) > 1e-6);
  if (!section) return '';
  const before = section.start - start;
  return `; it was placed in the full frame because it falls outside section ${section.id} (${section.layout}, ${round(section.start)}–${round(section.end)} s): ${before > 0 ? `it starts ${round(before)} s before it` : `it ends ${round(finish - section.end)} s after it`}; move it inside ${section.id}`;
}

export function rectFitHint(scene, story, message, { end } = {}) {
  const rect = scene?.params?.rect;
  if (!rect || typeof rect !== 'object' || !GEOMETRY_ERROR.test(String(message ?? ''))) return '';
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return '';
  let fit;
  try { fit = moduleFit(scene, story, { end }); } catch { return ''; }
  const name = scene.module, W = Math.round(rect.width), H = Math.round(rect.height);
  const width = fit.widthAtHeight && `width ${fit.widthAtHeight.op} ${fit.widthAtHeight.value}`;
  if (fit.minHeight !== null && fit.minHeight > H) return `; ${name} needs ${fit.minHeight} px height at width ${W} (${width ? `or ${width} at this height` : `no width fits height ${H}`})`;
  if (fit.minHeight !== null) {
    // The size fits at some position: the error is the authored position.
    if (!fit.widthAtHeight || fit.widthAtHeight.value === W) return '';
    return `; ${name} needs ${width} at height ${H}`;
  }
  if (width) return `; ${name} fits no height at width ${W}; it needs ${width} at height ${H}`;
  return '';
}

function resolveModuleInner(scene, story, { track, end }) {
  if (!scene || typeof scene !== 'object') throw new Error('scene must be an object');
  const id = moduleDomId(scene.id);
  if (!DOM_ID.test(id)) throw new Error(`id "${scene.id}" is not a valid module id`);
  const start = Number(scene.start);
  const finish = Number(end ?? scene.end);
  if (!Number.isFinite(start) || !Number.isFinite(finish)) throw new Error('start and end must be resolved seconds (run resolveStory first)');
  const duration = round(finish - start);
  if (!(duration > 0)) throw new Error('end must be after start');
  const params = scene.params && typeof scene.params === 'object' ? scene.params : {};
  const format = { width: story?.format?.width, height: story?.format?.height, fps: story?.resolved?.fps ?? story?.format?.fps, duration: story?.resolved?.duration ?? story?.format?.duration };
  const aspect = formatAspect(format);
  const module = scene.module;
  // Motion grammar (grammar.mjs): editorial is the identity, so editorial
  // models are exactly what they were before grammars existed.
  const grammar = resolveGrammar(story);
  const styled = !isEditorialGrammar(grammar);

  if (isEditorialKind(module)) {
    const canvas = EDITORIAL_CANVAS[aspect];
    if (!canvas || canvas.width !== format.width || canvas.height !== format.height) {
      throw new Error(`module "${module}": editorial modules need a 1080x1920 (9:16) or 1920x1080 (16:9) format; got ${format.width}x${format.height}`);
    }
    // The style's variant for this kind (story.variants), unless the scene names one.
    const chosen = story?.variants?.[module];
    if (chosen !== undefined && params.variant === undefined && EDITORIAL_VARIANTS[module] && !EDITORIAL_VARIANTS[module].includes(chosen)) {
      throw new Error(`module "${module}": style variants.${module} must be one of ${EDITORIAL_VARIANTS[module].join(', ')} (the ${module} variants); got ${JSON.stringify(chosen)}`);
    }
    const variant = params.variant === undefined && chosen !== undefined && EDITORIAL_VARIANTS[module] ? { variant: chosen } : {};
    const spec = { ...brandModuleDefaults(story?.brand), ...statusRackDefaults(module, story?.brand, params), ...variant, ...params, id, kind: module, aspect, start, duration };
    if (track !== undefined) spec.track = track;
    const resolveSpec = (value) => {
      try { return styled ? resolveEditorialModule(value, { grammar }) : resolveEditorialModule(value); }
      catch (error) { throw new Error(`module "${module}" params: ${error.message}`); }
    };
    let model = resolveSpec(spec);
    // Footage checklist: with a measured presenter and no rect, the card sits
    // above their head when there is headroom, else over their chest, clear
    // of the face and the caption band (docs/SUBJECT_EFFECTS_RFC.md §6.2).
    // In a footage layout's panel (kit/core/footage-layout.mjs) the card
    // fits the panel's safe area instead.
    const layout = story?.lane === 'footage-led' ? sceneLayoutAt(story, start, start + duration) : null;
    const placement = module === 'checklist' && params.rect === undefined && story?.lane === 'footage-led'
      ? (layout?.safe ? panelChecklistRect(model, layout.safe, format) : footageChecklistRect(model, subjectContext(story, start, { end: start + duration }), format))
      : null;
    if (placement?.rect) model = resolveSpec({ ...spec, rect: placement.rect });
    if (placement) model.subjectPlacement = placement.where;
    // Footage checklist rows type in on their at word (RFC §6.2).
    if (module === 'checklist' && story?.lane === 'footage-led') model = checklistTypeIn(model, { fps: Number(format.fps) || 30 });
    return finishModel(model, { module, scene });
  }

  const definition = catalogModules()[module];
  if (!definition) throw new Error(`module "${module}" is not a known module`);
  if (typeof definition.resolve !== 'function') throw new Error(`module "${module}" has no resolve()`);
  let model;
  try { model = definition.resolve(params, { id, start, duration, format, brand: story?.brand ?? {}, aspect, hits: Array.isArray(scene.hits) ? scene.hits : [], base: storyBase(story), subject: subjectContext(story, start, { end: start + duration }), layout: story?.lane === 'footage-led' ? sceneLayoutAt(story, start, start + duration) : null, lane: story?.lane ?? null, insert: scene.insert === true, frame: story?.frame ? { safe: brandFrameSafe(story) } : null, grammar, ambient: sceneAmbient(story, scene), cast: story?.cast ?? null, variants: story?.variants ?? null, world: story?.world ?? null, beneath: beneathWithWindow(story, scene), castAbove: castStandsIn(story, scene), layer: Number.isInteger(scene.track) ? scene.track : 0, rides: ridesPlate(story, scene), bleed: plateBleed(story), castNeighbours: castNeighbours(story, scene) }); }
  catch (error) { throw new Error(`module "${module}" params: ${error.message}`); }
  if (!model || typeof model !== 'object') throw new Error(`module "${module}" resolve() returned no model`);
  const finished = finishModel(model, { module, scene });
  plateCuts(finished, story, scene);
  keepCaptions(finished, story);
  if (track !== undefined) finished.track = track;
  // Catalogue B/C timelines remap their pop eases from model.grammar.
  if (styled) finished.grammar = grammar;
  return finished;
}

// Characters in a scene: a cast-scene's cast, a cameo's character.
export function sceneCharacters(scene) {
  if (scene?.module === 'cast-scene') return (Array.isArray(scene.params?.cast) ? scene.params.cast : []).map((entry) => entry?.id).filter((id) => typeof id === 'string');
  if (scene?.module === 'character-cameo') return typeof scene.params?.character === 'string' ? [scene.params.character] : [];
  return [];
}

// The characters of the character scenes that touch a character scene's
// start (ending there, or still on screen) and its end (starting there), so
// one shared with a neighbour cuts rather than dissolves (no two copies).
function castNeighbours(story, scene) {
  if (!['cast-scene', 'character-cameo'].includes(scene?.module) || !Array.isArray(story?.scenes)) return null;
  const start = Number(scene.start), end = Number(scene.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const before = new Set(), after = new Set();
  for (const other of story.scenes) {
    if (other === scene || !['cast-scene', 'character-cameo'].includes(other?.module)) continue;
    const a = Number(other.start), z = Number(other.end);
    if (!Number.isFinite(a) || !Number.isFinite(z)) continue;
    if (a < start - 1e-3 && z > start - 0.05) for (const id of sceneCharacters(other)) before.add(id);
    if (a > start + 1e-3 && Math.abs(a - end) < 0.05) for (const id of sceneCharacters(other)) after.add(id);
  }
  return { before: [...before], after: [...after] };
}

// The world beneath a scene (catalog-world.mjs worldBeneath) plus the plate's
// render end (transitions.mjs sceneWindows: held through the next
// transition), so a scene anchored to the plate moves with its camera for as
// long as the plate is drawn. Windows are cached per story, keyed by the
// scene timing they depend on (callers may edit a story between calls).
const WINDOW_ENDS = new WeakMap();
function beneathWithWindow(story, scene) {
  const beneath = worldBeneath(story, scene);
  if (!beneath) return null;
  const key = story.scenes.map((s) => `${s?.id}|${s?.start}|${s?.end}|${s?.track ?? 0}|${s?.in?.type ?? ''}|${s?.in?.dur ?? ''}`).join(';') + `|${story?.camera?.mode ?? ''}|${story?.resolved?.duration ?? story?.format?.duration}`;
  let cached = WINDOW_ENDS.get(story);
  if (!cached || cached.key !== key) {
    const ends = new Map();
    try { for (const entry of sceneWindows(story).scenes) ends.set(entry.id, entry.renderEnd); } catch { /* unresolved story: no render ends */ }
    cached = { key, ends };
    WINDOW_ENDS.set(story, cached);
  }
  const plate = story.scenes.find((s) => s?.id === beneath.scene);
  // The plate's model end, as the compilers resolve it (a final hold extends the last scene).
  const renderEnd = endingEnd(plate, story, cached.ends.get(beneath.scene) ?? beneath.end) ?? beneath.end;
  return { ...beneath, renderEnd };
}

// Where a footage-led checklist card goes beside the measured head:
// → {rect, where: "above-head" | "chest"}, or {where: "none"} when neither
// has room (the derived rect stays; layout-check's face rule then says so).
// The card keeps its derived layout and shrinks until it fits, but never
// below the scale where its text meets the profile's minimum sizes.
function footageChecklistRect(model, subject, format) {
  if (!model?.rect || !subject?.head || subject.placement !== 'measured') return null;
  const canvas = { width: format.width, height: format.height };
  const geometry = profileGeometry(canvas);
  const { safeZone, captionBand } = geometry;
  const unit = Math.min(canvas.width, canvas.height) / 1080;
  const gap = 16 * unit;
  const layout = model.density?.layout ?? { width: model.rect.width, height: model.rect.height };
  const most = model.density?.scale ?? 1;
  // Text scales with the card: the least scale keeps body and secondary text legal.
  const bodyFloor = geometry.minBodyTextPx ?? geometry.minTextPx;
  const least = Math.max(1,
    model.minTextPx ? most * bodyFloor / model.minTextPx : 1,
    model.minSecondaryTextPx ? most * geometry.minSecondaryTextPx / model.minSecondaryTextPx : 1);
  const head = subject.head;
  const fit = (top, bottom, where) => {
    const scale = Math.min(most, (bottom - top) / layout.height, safeZone.width / layout.width);
    if (!(scale >= least - 1e-6)) return null;
    const width = round(layout.width * scale), height = round(layout.height * scale);
    const x = round(safeZone.x + (safeZone.width - width) / 2);
    return { rect: { x, y: round(where === 'above-head' ? bottom - height : top), width, height }, where };
  };
  return fit(safeZone.y, head.y - gap, 'above-head')
    ?? fit(head.y + head.height + gap, Math.min(safeZone.y + safeZone.height, captionBand.y - gap), 'chest')
    ?? { where: 'none' };
}

// A footage-led checklist inside a layout panel: the card keeps its derived
// layout, scaled to fit the panel's safe area (never below the legal text
// scale) and centred in it. → {rect, where: "panel"} or {where: "none"}.
function panelChecklistRect(model, safe, format) {
  if (!model?.rect) return null;
  const geometry = profileGeometry({ width: format.width, height: format.height });
  const layout = model.density?.layout ?? { width: model.rect.width, height: model.rect.height };
  const most = model.density?.scale ?? 1;
  const bodyFloor = geometry.minBodyTextPx ?? geometry.minTextPx;
  const least = Math.max(1,
    model.minTextPx ? most * bodyFloor / model.minTextPx : 1,
    model.minSecondaryTextPx ? most * geometry.minSecondaryTextPx / model.minSecondaryTextPx : 1);
  const scale = Math.min(most, safe.width / layout.width, safe.height / layout.height);
  if (!(scale >= least - 1e-6)) return { where: 'none' };
  const width = round(layout.width * scale), height = round(layout.height * scale);
  return { rect: { x: round(safe.x + (safe.width - width) / 2), y: round(safe.y + (safe.height - height) / 2), width, height }, where: 'panel' };
}

// Text reads or is gone (docs/DIRECTION_GUARDRAILS.md §4): a text or hero
// module's fade in and out last at most TEXT_FADE.max seconds, so a slow
// grammar never leaves a card half-transparent on screen.
export const TEXT_FADE = Object.freeze({ max: 0.5, perWord: 0.22, minHold: 1.2 });

function clampTextFades(model) {
  const m = model.motion;
  if (!m || !['text', 'hero'].includes(model.layout?.role)) return;
  const fades = (from) => from && Number.isFinite(from.opacity) && from.opacity < 1;
  if (fades(m.enterFrom) && Number.isFinite(m.enterDuration) && m.enterDuration > TEXT_FADE.max) {
    m.enterDuration = TEXT_FADE.max;
    if (Number.isFinite(m.enterStart)) m.enterEnd = round(m.enterStart + TEXT_FADE.max);
  }
  if (fades(m.exitTo) && Number.isFinite(m.exitDuration) && m.exitDuration > TEXT_FADE.max) {
    const end = Number.isFinite(m.end) ? m.end : model.end;
    m.exitDuration = TEXT_FADE.max;
    if (Number.isFinite(end)) m.exitStart = round(end - TEXT_FADE.max);
  }
}

// Cards and plate changes (docs/DIRECTION_GUARDRAILS.md §4): a text card on
// a higher track that ends where the next plate starts leaves with the cut
// (one frame) instead of fading over the change; one that starts with a
// plate arriving by a camera move or a dissolve waits for the transition to
// end, so it never shows half-transparent over the wrong place.
const TEXT_ROLES = ['text', 'hero'];
function plateCuts(model, story, scene) {
  if ((scene?.track ?? 0) === 0 || !TEXT_ROLES.includes(model.layout?.role ?? (model.module === 'cta' || model.module === 'hook-title' ? 'hero' : null)) || !model.motion) return;
  const plates = (Array.isArray(story?.scenes) ? story.scenes : []).filter((other) => (other?.track ?? 0) === 0 && Number.isFinite(Number(other?.start)));
  const fps = Number(story?.format?.fps ?? 30);
  const cut = round(1 / fps);
  const m = model.motion;
  const end = Number(m.end ?? model.end);
  // Not the video's last moments: a final hold or a loop ending has its own rules.
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration);
  const next = plates.find((plate) => Math.abs(Number(plate.start) - Number(scene.end)) < 0.05 && Number(scene.end) < duration - 0.05);
  if (next && Number.isFinite(end) && Number.isFinite(m.exitStart) && m.exitStart < end - cut) {
    const exitStart = round(end - cut);
    if (Array.isArray(model.animations)) {
      for (const anim of model.animations) if (anim.node === 'root' && anim.start >= m.exitStart - 1e-6) { anim.start = exitStart; anim.duration = cut; }
    }
    m.exitStart = exitStart;
    if (Number.isFinite(m.exitDuration)) m.exitDuration = cut;
    if (Number.isFinite(m.exit)) m.exit = cut;
    if (model.layout?.motion) model.layout.motion.exitStart = exitStart;
    model.exitsWithCut = true;
  }
  // Starting while a plate arrives (at its start or during its transition).
  const arriving = plates.find((plate) => plate.in && typeof plate.in === 'object' && plate.in.type !== 'cut' && Number(plate.in.dur) > 0
    && Number(scene.start) > Number(plate.start) - 0.05 && Number(scene.start) < Number(plate.start) + Number(plate.in.dur) - 1e-6);
  if (arriving && !Array.isArray(model.animations) && Number.isFinite(m.enterStart)) {
    const wait = round(Math.max(0, Number(arriving.start) + Number(arriving.in.dur) - Number(scene.start)));
    m.enterStart = round(m.enterStart + wait);
    if (Number.isFinite(m.enterEnd)) m.enterEnd = round(m.enterEnd + wait);
    if (model.layout?.motion && Number.isFinite(model.layout.motion.enterEnd)) model.layout.motion.enterEnd = round(model.layout.motion.enterEnd + wait);
    model.waitsForPlate = wait;
  }
}

// A call to action set clear of the caption band keeps the captions on (the
// narration goes on under it, often past the card's own words); one over the
// band hides them.
function keepCaptions(model, story) {
  if (!model.hidesCaptions || model.module !== 'cta') return;
  const rect = model.rect ?? model.layout?.rect;
  const canvas = { width: Number(story?.format?.width), height: Number(story?.format?.height) };
  if (!rect || !(canvas.width > 0)) return;
  let band;
  try { band = profileGeometry(canvas).captionBand; } catch { return; }
  if (band && rect.y + rect.height <= band.y) model.hidesCaptions = false;
}

function finishModel(model, { module, scene }) {
  model.module = model.module ?? module;
  model.sceneId = scene.id;
  if (typeof model.hidesCaptions !== 'boolean') model.hidesCaptions = false;
  clampTextFades(model);
  return model;
}

// Placeholder for a scene whose module is unknown, invalid, or has no emitter
// or component in a renderer. Both renderers draw it from this model and
// PLACEHOLDER_STYLE, so a missing module is equally visible in each.
export const PLACEHOLDER_STYLE = Object.freeze({
  surface: '#1b1d24', foreground: '#f7f7f8', muted: '#c4c7cf', border: '#ff5a36', borderWidth: 4, radius: 24,
  labelSize: 52, detailSize: 28, padding: 40, fontFamily: fontStack(null, 'body')
});

export function placeholderModel(scene, story, reason = '', { end } = {}) {
  const width = Number(story?.format?.width ?? 1080), height = Number(story?.format?.height ?? 1920);
  const start = Number(scene?.start ?? 0), finish = Number(end ?? scene?.end ?? start + 1);
  // The scene's own params.rect when it declares one (so the placeholder
  // occupies the intended footprint), else a safe-zone box.
  const declared = scene?.params?.rect;
  const valid = declared && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(declared[key])) && declared.width >= 200 && declared.height >= 120;
  const x = Math.round(width * 0.08);
  const rect = valid ? { x: declared.x, y: declared.y, width: declared.width, height: declared.height } : { x, y: Math.round(height * 0.3), width: width - 2 * x, height: Math.round(height * 0.3) };
  const still = { opacity: 1, x: 0, y: 0, scale: 1 };
  const S = PLACEHOLDER_STYLE;
  return {
    id: moduleDomId(scene?.id ?? 'scene'), module: scene?.module ?? null, sceneId: scene?.id ?? null, placeholder: true,
    canvas: { width, height }, start, duration: round(finish - start), end: finish, rect,
    motion: { enterStart: start, enterEnd: start, exitStart: finish, end: finish, enterFrom: still, exitTo: still, enterEase: 'none', exitEase: 'none' },
    content: { label: `Missing module: ${scene?.module ?? '(none)'}`, detail: String(reason ?? '').slice(0, 240) },
    events: [], layout: { canvas: { width, height }, rect, motion: { enterEnd: start, exitStart: finish, end: finish } },
    hidesCaptions: false, theme: { surface: S.surface, foreground: S.foreground, muted: S.muted, border: S.border, accentText: S.border }
  };
}

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

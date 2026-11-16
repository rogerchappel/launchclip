// The treatment block of a direction map (docs/PLAN_AND_PACE_RFC.md §1): the
// film's idea in one line, the object that carries it, what it must never do,
// the words it must not change, what each transition shows, and its one
// memorable shot. Each field has a check, run on the map alone and again
// against the planned storyboard.
//
//   validateTreatment(treatment, {sections, story, words, deferScenes, tier})
//     → {errors, warnings}
//   BANNED_CHECKS        the banned tokens that map to a check (the rest go to the critic)
//   bannedHold(treatment) → seconds | null: the `hold>N` token, the pace gate's max_still
//
// Pure ESM; imports only kit/core siblings.

import { TRANSITION_TYPES } from './transitions.mjs';
import { storyBase } from './story.mjs';

export const TREATMENT_FIELDS = Object.freeze(['concept', 'throughline', 'banned', 'locked_copy', 'guardrails', 'locked_example', 'transitions', 'signature']);
// The fields a bespoke plan must fill; the brief decides whether there is copy, a claim or an example to lock.
export const BESPOKE_TREATMENT_FIELDS = Object.freeze(['concept', 'throughline', 'banned', 'transitions', 'signature']);
export const CONCEPT_MAX_WORDS = 20;
// The signature shot lands inside this share of the runtime.
export const SIGNATURE_WINDOW = Object.freeze({ from: 0.25, to: 0.85 });
// brand-before-end: no logo or wordmark before this share of the runtime.
export const BRAND_FROM = 0.85;
// back(n) eases with a larger overshoot than this bounce (GSAP's default back is 1.70158).
export const BOUNCE_OVERSHOOT = 1.7;

/** Banned tokens that map to a check on the plan; any other token is read by the critic only. */
export const BANNED_CHECKS = Object.freeze({
  crossfade: 'no fade between two full-frame scenes',
  'bounce-ease': `no elastic ease and no back ease overshooting past ${BOUNCE_OVERSHOOT}`,
  'camera-shake': 'no camera kicks and no shake',
  'brand-before-end': `no logo or wordmark scene before the last ${Math.round((1 - BRAND_FROM) * 100)}% of the runtime`,
  particles: 'no particle scene or particle effect',
  'lens-flare': 'no light-leak transition and no flare effect',
  'hold>N': 'nothing on screen freezes for more than N seconds (the pace gate\'s max_still)'
});
// What a style bans when it names nothing (style.avoid replaces it).
export const DEFAULT_BANNED = Object.freeze(['crossfade', 'bounce-ease', 'lens-flare']);
// Words that name an effect rather than describe a shot.
const EFFECT_WORDS = Object.freeze([...TRANSITION_TYPES.filter((type) => type !== 'cut'), 'glow', 'blur', 'particle', 'particles', 'flare', 'bloom', 'shake', 'glitch', 'sparkle', 'sparkles', 'neon', 'parallax']);
const HOLD = /^hold>(\d+(?:\.\d+)?)$/;
// Param keys that hold no on-screen words.
const NOT_TEXT = /^(id|src|image|video|audio|asset|file|url|ease|color|colou?rs?|font|variant|icon|direction|align|anchor|at|from_object|module|kind|type|shape|style|mode)$/i;
const HEADLINE_KEYS = Object.freeze(['title', 'headline', 'text', 'eyebrow']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const wordsOf = (value) => String(value ?? '').trim().split(/\s+/).filter(Boolean);
// Locked copy compares case-folded with punctuation kept; the loose form (letters and digits) finds rewordings.
const fold = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const plain = (value) => String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const hasPhrase = (text, phrase) => ` ${plain(text)} `.includes(` ${plain(phrase)} `);
const round = (value) => Math.round(value * 100) / 100;

/** The `hold>N` banned token as seconds, or null. */
export function bannedHold(treatment) {
  for (const token of Array.isArray(treatment?.banned) ? treatment.banned : []) {
    const match = HOLD.exec(String(token).trim());
    if (match) return Number(match[1]);
  }
  return null;
}

function walk(value, visit, key = null, parent = null) {
  if (Array.isArray(value)) value.forEach((item) => walk(item, visit, key, parent));
  else if (isObject(value)) for (const [k, v] of Object.entries(value)) { visit(k, v, value); walk(v, visit, k, value); }
}

/** The on-screen strings of a scene's params: [{key, text}]. */
function sceneTexts(scene) {
  const out = [];
  walk(scene?.params ?? {}, (key, value) => { if (typeof value === 'string' && !NOT_TEXT.test(key) && /\p{L}/u.test(value)) out.push({ key, text: value }); });
  return out;
}

/**
 * Validation for DIRECTION.json's treatment block. sections: the map's
 * sections as [{id, scenes}] (the scene ids its lines name). With story (resolved, numeric times) and not deferScenes, each
 * field is also checked against the planned scenes. words: the narration
 * words. tier: "bespoke" requires BESPOKE_TREATMENT_FIELDS.
 */
export function validateTreatment(treatment, { sections = [], story = null, words = [], deferScenes = false, tier = null } = {}) {
  const errors = [], warnings = [];
  const err = (message) => errors.push(`treatment.${message}`);
  const warn = (message) => warnings.push(`treatment.${message}`);
  if (treatment === undefined) {
    if (tier === 'bespoke') errors.push(`treatment is required on the bespoke tier: ${BESPOKE_TREATMENT_FIELDS.join(', ')}`);
    return { errors, warnings };
  }
  if (!isObject(treatment)) return { errors: ['treatment must be an object'], warnings };
  for (const key of Object.keys(treatment)) if (!TREATMENT_FIELDS.includes(key)) err(`${key} is not a treatment field (${TREATMENT_FIELDS.join(', ')}; the sound fields come later)`);
  if (tier === 'bespoke') for (const key of BESPOKE_TREATMENT_FIELDS) if (treatment[key] === undefined) err(`${key} is required on the bespoke tier`);
  const t = treatment;
  // sections: [{id, scenes}]: each section with the scene ids its lines name.
  const sectionMap = new Map((Array.isArray(sections) ? sections : []).filter((section) => nonEmpty(section?.id)).map((section) => [section.id, section.scenes ?? []]));
  const sectionIds = new Set(sectionMap.keys());
  const scenes = !deferScenes && Array.isArray(story?.scenes) ? story.scenes.filter((scene) => finite(Number(scene?.start))) : [];
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const known = (ref) => sectionIds.has(ref) || sceneIds.has(ref);
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration) || 0;
  const narration = (Array.isArray(words) ? words : []).filter((word) => nonEmpty(word?.text));

  // concept
  if (t.concept !== undefined) {
    const n = wordsOf(t.concept).length;
    if (!nonEmpty(t.concept)) err('concept must be one sentence');
    else if (n > CONCEPT_MAX_WORDS) err(`concept is ${n} words; say the whole film in at most ${CONCEPT_MAX_WORDS}`);
    else if (n < 4) err('concept must be a sentence that names a thing that changes, not a topic');
    // shortcut: no verb check (needs a tagger); the critic reads the sentence.
    if (nonEmpty(story?.title) && plain(story.title) === plain(t.concept)) err('concept repeats the title; say what changes, not what the film is called');
  }

  // throughline
  if (t.throughline !== undefined) {
    const line = t.throughline;
    if (!isObject(line)) err('throughline must be {object, states: [{at, form, carry?}]}');
    else {
      for (const key of Object.keys(line)) if (!['object', 'states'].includes(key)) err(`throughline has unknown field "${key}"`);
      if (!nonEmpty(line.object)) err('throughline.object must name the element that carries the film');
      if (!Array.isArray(line.states) || !line.states.length) err('throughline.states must list the object\'s forms in order');
      else {
        line.states.forEach((state, i) => {
          const where = `throughline.states[${i}]`;
          if (!isObject(state)) { err(`${where} must be {at, form, carry?}`); return; }
          for (const key of Object.keys(state)) if (!['at', 'form', 'carry'].includes(key)) err(`${where} has unknown field "${key}"`);
          if (!nonEmpty(state.at)) err(`${where}.at must name a section`);
          else if ((sectionIds.size || sceneIds.size) && !known(state.at)) err(`${where}.at "${state.at}" is not a section of the map${sceneIds.size ? ' or a scene of the storyboard' : ''}`);
          if (!nonEmpty(state.form)) err(`${where}.form must say what the object looks like there`);
          if (state.carry !== undefined && !TRANSITION_TYPES.includes(state.carry)) err(`${where}.carry must be a transition type (${TRANSITION_TYPES.join(', ')})`);
        });
        const covered = new Set(line.states.map((state) => state?.at));
        const missing = [...sectionIds].filter((id) => !covered.has(id));
        if (missing.length && sectionIds.size > 1) warn(`throughline has no form in section${missing.length > 1 ? 's' : ''} ${missing.join(', ')}; the object should change at every section`);
      }
    }
  }

  // banned
  if (t.banned !== undefined) {
    if (!Array.isArray(t.banned) || !t.banned.every(nonEmpty)) err('banned must be a list of short tokens');
    else for (const token of t.banned) {
      const hold = HOLD.exec(token.trim());
      if (/^hold/.test(token) && !(hold && Number(hold[1]) > 0)) err(`banned "${token}" must read hold>N with N in seconds`);
    }
    if (scenes.length && Array.isArray(t.banned)) for (const message of bannedFindings(t.banned, { story, scenes, duration })) err(message);
  }

  // locked_copy
  if (t.locked_copy !== undefined) {
    const copy = t.locked_copy;
    if (!isObject(copy) || !Array.isArray(copy.lines) || !copy.lines.length || !copy.lines.every(nonEmpty)) err('locked_copy must be {only?, lines: ["the brief\'s exact words", …]}');
    else {
      for (const key of Object.keys(copy)) if (!['only', 'lines'].includes(key)) err(`locked_copy has unknown field "${key}"`);
      if (copy.only !== undefined && typeof copy.only !== 'boolean') err('locked_copy.only must be true or false');
      if (scenes.length) lockedCopyFindings(copy, { scenes, narration, err, warn });
    }
  }

  // guardrails
  if (t.guardrails !== undefined) {
    if (!Array.isArray(t.guardrails)) err('guardrails must be a list of {claim, forbid: [phrases]}');
    else t.guardrails.forEach((rail, i) => {
      const where = `guardrails[${i}]`;
      if (!isObject(rail) || !nonEmpty(rail.claim) || !Array.isArray(rail.forbid) || !rail.forbid.length || !rail.forbid.every(nonEmpty)) { err(`${where} must be {claim, forbid: ["phrase", …]}`); return; }
      if (!scenes.length) return;
      for (const phrase of rail.forbid) {
        for (const scene of scenes) for (const { text } of sceneTexts(scene)) if (hasPhrase(text, phrase)) err(`${where}: scene "${scene.id}" says "${phrase}" ("${text.slice(0, 60)}"), which overstates ${rail.claim}`);
        if (narration.length && hasPhrase(narration.map((word) => word.text).join(' '), phrase)) err(`${where}: the narration says "${phrase}", which overstates ${rail.claim}`);
      }
    });
  }

  // locked_example
  if (t.locked_example !== undefined) {
    const example = t.locked_example;
    if (!isObject(example) || !nonEmpty(example.label) || !isObject(example.values) || !Object.keys(example.values).length) err('locked_example must be {label, values: {name: number | [numbers]}}');
    else {
      for (const key of Object.keys(example)) if (!['label', 'values'].includes(key)) err(`locked_example has unknown field "${key}"${key === 'check' ? ' (check expressions are not evaluated yet)' : ''}`);
      for (const [key, value] of Object.entries(example.values)) if (!(finite(value) || (Array.isArray(value) && value.every(finite)))) err(`locked_example.values.${key} must be a number or a list of numbers`);
      for (const scene of scenes) for (const message of exampleFindings(scene, example.values)) err(`locked_example: ${message}`);
    }
  }

  // transitions
  if (t.transitions !== undefined) {
    if (!Array.isArray(t.transitions)) err('transitions must be a list of {from, to, type, demonstrates}');
    else {
      t.transitions.forEach((entry, i) => {
        const where = `transitions[${i}]`;
        if (!isObject(entry)) { err(`${where} must be {from, to, type, demonstrates}`); return; }
        for (const key of Object.keys(entry)) if (!['from', 'to', 'type', 'demonstrates'].includes(key)) err(`${where} has unknown field "${key}"`);
        for (const key of ['from', 'to']) if (!nonEmpty(entry[key])) err(`${where}.${key} must name a section or scene`);
        else if ((sectionIds.size || sceneIds.size) && !known(entry[key])) err(`${where}.${key} "${entry[key]}" is not a section of the map${sceneIds.size ? ' or a scene of the storyboard' : ''}`);
        if (!TRANSITION_TYPES.includes(entry.type)) err(`${where}.type must be one of ${TRANSITION_TYPES.join(', ')}`);
        if (!nonEmpty(entry.demonstrates) || wordsOf(entry.demonstrates).length < 3) err(`${where}.demonstrates must say in a few words what the change itself shows (a transition that shows nothing is a cut)`);
        else if (TRANSITION_TYPES.includes(plain(entry.demonstrates).replace(/ /g, '-'))) err(`${where}.demonstrates names a transition type; say what the change shows`);
      });
      if (scenes.length) transitionFindings(t.transitions, { scenes, sections: sectionMap, duration, err, warn });
    }
  }

  // signature
  if (t.signature !== undefined) {
    const sig = t.signature;
    if (!isObject(sig) || !nonEmpty(sig.at) || !nonEmpty(sig.describe)) err('signature must be {at, describe}');
    else {
      for (const key of Object.keys(sig)) if (!['at', 'describe'].includes(key)) err(`signature has unknown field "${key}"`);
      const effects = EFFECT_WORDS.filter((word) => hasPhrase(sig.describe, word.replace(/-/g, ' ')));
      if (effects.length) err(`signature.describe names effects (${effects.join(', ')}); describe what the viewer sees happen, not the effect`);
      if ((sectionIds.size || sceneIds.size) && !known(sig.at)) err(`signature.at "${sig.at}" is not a section of the map${sceneIds.size ? ' or a scene of the storyboard' : ''}`);
      const start = refStart(sig.at, { scenes, sections: sectionMap });
      if (finite(start) && duration > 0 && (start < SIGNATURE_WINDOW.from * duration || start > SIGNATURE_WINDOW.to * duration)) err(`signature "${sig.at}" starts at ${round(start)} s (${Math.round((start / duration) * 100)}% of the runtime); the shot people remember lands between ${SIGNATURE_WINDOW.from * 100}% and ${SIGNATURE_WINDOW.to * 100}%`);
    }
  }
  return { errors, warnings };
}

// The start of a section (its first named scene) or a scene.
function refStart(ref, { scenes, sections }) {
  const ids = sections.get?.(ref) ?? [ref];
  const starts = scenes.filter((scene) => ids.includes(scene.id)).map((scene) => Number(scene.start));
  return starts.length ? Math.min(...starts) : null;
}

const fullFrame = (story, scene) => (storyBase(story) ? scene.insert === true : (Number(scene.track) || 0) === 0);

/** The banned tokens' checks against the planned scenes → error messages. */
export function bannedFindings(banned, { story, scenes = story?.scenes ?? [], duration = Number(story?.resolved?.duration ?? story?.format?.duration) || 0 } = {}) {
  const out = [];
  const tokens = new Set(banned.map((token) => String(token).trim()));
  const ordered = [...scenes].sort((a, b) => Number(a.start) - Number(b.start));
  if (tokens.has('crossfade')) {
    for (const scene of ordered) {
      if (scene.in?.type !== 'fade' || !fullFrame(story, scene)) continue;
      const before = ordered.find((other) => other !== scene && fullFrame(story, other) && Number(other.start) < Number(scene.start) && Number(other.end) >= Number(scene.start) - 0.05);
      if (before) out.push(`banned crossfade: scene "${scene.id}" fades in over full-frame scene "${before.id}"; cut, push or carry an object across instead`);
    }
  }
  const hits = (test) => {
    const found = [];
    walk({ motion: story?.motion, camera: story?.camera, scenes: ordered, overlays: story?.overlays, ending: story?.ending }, (key, value, parent) => { const what = test(key, value, parent); if (what) found.push(what); });
    return [...new Set(found)];
  };
  if (tokens.has('bounce-ease')) {
    const found = hits((key, value) => {
      // An ease string, wherever it sits (grammar.ease.enter, params.ease, a state's ease).
      if (typeof value !== 'string' || !/^(elastic|back)(\.(in|out|inOut))?(\(|$)/i.test(value.trim())) return null;
      if (/^elastic/i.test(value.trim())) return value;
      const back = /^back[\w.]*(?:\(([\d.]+)\))?/i.exec(value.trim());
      return back && (back[1] === undefined ? 1.70158 : Number(back[1])) > BOUNCE_OVERSHOOT ? value : null;
    });
    if (found.length) out.push(`banned bounce-ease: the plan uses ${found.join(', ')}; ease into place without overshoot (power3.out)`);
  }
  if (tokens.has('camera-shake')) {
    const found = hits((key, value) => ((key === 'kicks' && Array.isArray(value) && value.length) || (/shake/i.test(key) && value) || (typeof value === 'string' && /^(type|kind|effect)$/.test(key) && /shake/i.test(value)) ? key : null));
    if (found.length) out.push(`banned camera-shake: the plan has camera ${found.join(', ')}; keep the camera steady`);
  }
  if (tokens.has('particles')) {
    const found = hits((key, value) => (typeof value === 'string' && /^(module|type|kind|effect)$/.test(key) && /particle/i.test(value) ? value : null));
    if (found.length) out.push(`banned particles: the plan uses ${found.join(', ')}`);
  }
  if (tokens.has('lens-flare')) {
    const found = hits((key, value) => (typeof value === 'string' && /^(type|kind|effect)$/.test(key) && /light-leak|flare/i.test(value) ? value : null));
    if (found.length) out.push(`banned lens-flare: the plan uses ${found.join(', ')}`);
  }
  if (tokens.has('brand-before-end') && duration > 0) {
    for (const scene of ordered) if (/logo|brand|wordmark/.test(String(scene.module)) && Number(scene.start) < BRAND_FROM * duration - 1e-6) out.push(`banned brand-before-end: scene "${scene.id}" (${scene.module}) shows the brand at ${round(Number(scene.start))} s; the logo waits for the last ${Math.round((1 - BRAND_FROM) * 100)}% (after ${round(BRAND_FROM * duration)} s)`);
  }
  return out;
}

function lockedCopyFindings(copy, { scenes, narration, err, warn }) {
  const tokens = narration.map((word) => plain(word.text)).filter(Boolean);
  const timed = narration.filter((word) => plain(word.text));
  const spokenAt = (line) => {
    const want = plain(line).split(' ');
    for (let i = 0; i + want.length <= tokens.length; i += 1) if (want.every((w, j) => tokens[i + j] === w)) return Number(timed[i].start);
    return null;
  };
  let last = -Infinity, lastLine = null;
  copy.lines.forEach((line, i) => {
    let first = null;
    for (const scene of scenes) for (const { text } of sceneTexts(scene)) {
      if (fold(text).includes(fold(line))) { first = Math.min(first ?? Infinity, Number(scene.start)); continue; }
      // The same words in other casing or punctuation: the scene rewords the locked line.
      if (plain(text).includes(plain(line)) || (plain(line).includes(plain(text)) && plain(text).split(' ').length >= 3)) err(`locked_copy.lines[${i}] is reworded in scene "${scene.id}": "${text.slice(0, 80)}" should read "${line}" exactly`);
    }
    // The narration is matched on its words only: transcripts drop punctuation.
    const spoken = spokenAt(line);
    const at = Math.min(first ?? Infinity, spoken ?? Infinity);
    if (!Number.isFinite(at)) { err(`locked_copy.lines[${i}] "${line}" appears in no scene text and is not spoken; use the brief's words exactly`); return; }
    if (at < last - 1e-6) err(`locked_copy.lines[${i}] "${line}" comes before "${lastLine}"; keep the locked lines in order`);
    else { last = at; lastLine = line; }
  });
  if (copy.only) {
    const said = ` ${tokens.join(' ')} `;
    for (const scene of scenes) for (const { key, text } of sceneTexts(scene)) {
      if (!HEADLINE_KEYS.includes(key)) continue;
      if (copy.lines.some((line) => plain(text).includes(plain(line)) || plain(line).includes(plain(text))) || said.includes(` ${plain(text)} `)) continue;
      warn(`locked_copy.only: scene "${scene.id}" ${key} "${text.slice(0, 60)}" is neither locked copy nor narration`);
    }
  }
}

function exampleFindings(scene, values) {
  const out = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const byLabel = new Map(Object.entries(values).map(([key, value]) => [plain(key.replace(/_/g, ' ')), { key, value }]));
  walk(scene?.params ?? {}, (key, value, parent) => {
    if (key in values && (finite(value) || Array.isArray(value)) && !same(value, values[key])) out.push(`scene "${scene.id}" sets ${key} ${JSON.stringify(value)}, but the example fixes it at ${JSON.stringify(values[key])}`);
    if (key === 'value' && finite(value) && nonEmpty(parent?.label)) {
      const hit = byLabel.get(plain(parent.label));
      if (hit && !same(value, hit.value)) out.push(`scene "${scene.id}" shows "${parent.label}" as ${value}, but the example fixes ${hit.key} at ${JSON.stringify(hit.value)}`);
    }
  });
  return out;
}

function transitionFindings(entries, { scenes, sections, duration, err, warn }) {
  const ordered = [...scenes].sort((a, b) => Number(a.start) - Number(b.start));
  const target = (ref) => { const ids = sections.get?.(ref); return ids?.length ? ids : [ref]; };
  let fades = 0;
  ordered.forEach((scene, i) => {
    const type = scene.in?.type;
    if (!type || type === 'cut' || i === 0) return;
    if (type === 'fade') fades += 1;
    const entry = entries.find((item) => isObject(item) && target(item.to).includes(scene.id));
    if (!entry) err(`transitions has no entry for the ${type} into scene "${scene.id}"; say what it demonstrates, or make it a cut`);
    else if (entry.type !== type && target(entry.to)[0] === scene.id) warn(`transitions says ${entry.type} into "${scene.id}", but the storyboard plays ${type}`);
  });
  const allowed = Math.max(1, Math.floor(duration / 30));
  if (fades > allowed) warn(`transitions: ${fades} fades in ${round(duration)} s; more than one fade per 30 s reads as a slideshow`);
}

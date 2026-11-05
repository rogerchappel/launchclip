// Footage inserts that vary: the frame a library shot sits in changes from
// one insert to the next.
//
// A plan with an app library puts shots in cards (src/asset_provider.js
// SHOT_CARD_SLOTS) as well as in the shot modules. For real-world footage
// (a site, a trade at work, a product in use) the only card that fits is the
// polaroid, so a plan left alone frames shot after shot in the same tilted
// instant photo. varyInserts() is the deterministic pass that runs before
// the shots are asked for:
//
// - a novelty frame (NOVELTY_FRAMES) is used at most noveltyCap() times a
//   video: none for a serious style (playfulness dial ≤ 0.33), one by
//   default, two for a playful one;
// - no two inserts in a row share a framed treatment (module + variant).
//
// The scenes before and after are what make a run: a full-bleed cut (clip,
// photo-scene) or a card without footage between two inserts breaks it.
//
// A full-screen insert over the cap, or repeating the one before it, becomes
// a footage treatment instead (FOOTAGE_TREATMENTS: a Ken Burns photo-scene
// with the card's caption as its line, or a clip with it as a callout that
// fades in and out), whichever differs from the insert before; its shot request
// moves to params.media and may now come back as a video. An overlay card
// (track 1+) cannot go full frame, so it changes variant instead.
// restoreMisses() puts a converted card back (with its placeholder) when the
// library has no shot for it, as an unconverted card would have been kept.
import { dialChoices } from "@launchclip/core/style.mjs";
import { SHOT_CARD_SLOTS, SHOT_REQUEST } from "./asset_provider.js";

// Frames that read as a gimmick when they repeat.
export const NOVELTY_FRAMES = Object.freeze(["polaroid"]);
// What a converted insert becomes, in order of preference.
// (media-window is not one: it letterboxes footage, as it should a screen capture.)
export const FOOTAGE_TREATMENTS = Object.freeze(["photo-scene", "clip"]);
// Each converted photo-scene moves differently from the last.
const MOVES = Object.freeze(["push-in", "pan-left", "pull-out", "pan-right"]);
// Overlay variants to rotate through, per card.
const VARIANTS = Object.freeze({ polaroid: ["single", "pinned", "stack"], "device-frame": ["clay", "dark", "outline"], "window-chrome": ["mac", "minimal"] });
// A converted photo-scene keeps the card's caption as its line up to this length (one display line).
const LINE_CHARS = 28;
// A Ken Burns scene shorter than this reads as a jolt; a shorter insert becomes a clip.
const PHOTO_SCENE_SECONDS = 2;
// A converted clip carries the caption as a callout when it is at least this long (the callout's hold and lead-out).
const CALLOUT_SECONDS = 2.5;

/** How many novelty frames a video may use: 0 for a serious style, 2 for a playful one, else 1. */
export function noveltyCap(style) {
  const dials = style?.dials;
  if (!dials || typeof dials !== "object") return 1;
  const mood = dialChoices(dials).mood;
  return mood === "serious" ? 0 : mood === "playful" ? 2 : 1;
}

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
const isRequest = (value) => isObject(value) && value.kind === SHOT_REQUEST;
const isAsset = (value) => typeof value === "string" ? value.startsWith("assets/") : isObject(value) && typeof value.src === "string" && value.src.startsWith("assets/");
const pathValue = (params, slot) => slot.split(".").reduce((value, key) => (isObject(value) ? value[key] : undefined), params);

// The footage a scene frames ({slot, media}) or null: a card's image slot,
// or params.media in a media-window. Full-bleed footage (clip, photo-scene)
// is the cut itself, not a frame, so it never counts as a repeat.
function framedFootage(scene) {
  const slot = SHOT_CARD_SLOTS[scene?.module];
  if (slot) {
    const media = pathValue(scene.params, slot);
    return isRequest(media) || isAsset(media) ? { slot, media } : null;
  }
  if (scene?.module === "media-window" && (isRequest(scene.params?.media) || isAsset(scene.params?.media))) return { slot: "media", media: scene.params.media };
  return null;
}

const isFootage = (scene) => framedFootage(scene) !== null || (["photo-scene", "clip"].includes(scene?.module) && scene.params?.media !== undefined);

function treatmentOf(scene, storyVariants) {
  const variant = scene.params?.variant ?? storyVariants?.[scene.module] ?? VARIANTS[scene.module]?.[0] ?? null;
  return variant ? `${scene.module}:${variant}` : scene.module;
}

const seconds = (scene) => (typeof scene.start === "number" && typeof scene.end === "number" ? scene.end - scene.start : null);

// The card's own words: its caption or title.
function cardWords(scene) {
  const p = scene.params ?? {};
  const text = [p.caption, p.title, p.label, p.text].find((value) => typeof value === "string" && value.trim());
  return text ? text.trim() : null;
}

// The shot request as a moving-footage request: a card slot showed a still,
// a footage treatment can play the clip.
function footageMedia(media) {
  if (!isRequest(media)) return media;
  const { type, ...rest } = media;
  return type === "video" ? media : rest;
}

function convert(scene, module, { media }, moveIndex) {
  const words = cardWords(scene);
  const base = Object.fromEntries(Object.entries(scene).filter(([key]) => key !== "params" && key !== "module"));
  const params = { media: footageMedia(media) };
  if (module === "photo-scene") {
    params.move = MOVES[moveIndex % MOVES.length];
    if (words && words.length <= LINE_CHARS) Object.assign(params, { lines: [{ text: words }], scrim: "bottom" });
  } else {
    // A clip cuts in by default; from a card it fades, so nothing pops.
    Object.assign(params, { enter: "fade", exit: "fade" });
    const length = seconds(scene);
    if (words && words.length <= 36 && (length === null || length >= CALLOUT_SECONDS)) params.callouts = [{ text: words }];
  }
  if (words) params.title = words.slice(0, 60);
  return { ...base, module, params };
}

/**
 * Vary the frames footage sits in (see the header). → {storyboard (a copy
 * when anything changed), changed: ["scene <id>: polaroid → photo-scene
 * (…)"], originals: Map(scene id → the scene as planned)}.
 */
export function varyInserts(storyboard, { style = null } = {}) {
  const scenes = storyboard?.scenes;
  if (!Array.isArray(scenes) || !scenes.length) return { storyboard, changed: [], originals: new Map() };
  const cap = noveltyCap(style);
  const storyVariants = isObject(storyboard.variants) ? storyboard.variants : null;
  const out = scenes.map((scene) => scene);
  const changed = [];
  const originals = new Map();
  const used = new Map();
  let previous = null; // the treatment of the insert just before, or null after a non-footage scene
  let moves = 0;
  for (let index = 0; index < out.length; index += 1) {
    const scene = out[index];
    const track = scene?.track ?? 0;
    if (track !== 0 && !framedFootage(scene)) continue; // overlays elsewhere do not break a run
    const framed = framedFootage(scene);
    if (!framed) { previous = isFootage(scene) ? scene.module : null; continue; }
    let treatment = treatmentOf(scene, storyVariants);
    const novelty = NOVELTY_FRAMES.includes(scene.module);
    const overCap = novelty && (used.get(scene.module) ?? 0) >= cap;
    const repeat = treatment === previous;
    if (overCap || repeat) {
      const why = overCap ? `${cap === 0 ? "no" : `at most ${cap}`} ${scene.module} frame${cap === 1 ? "" : "s"} a video` : `the same frame as the insert before`;
      const length = seconds(scene);
      // Novelty cards become footage; a card or window that names what it
      // shows (a phone, a browser, a post, a page capture) keeps its kind.
      const fullFrame = track === 0 && novelty;
      const options = FOOTAGE_TREATMENTS.filter((module) => module !== previous && !(module === "photo-scene" && length !== null && length < PHOTO_SCENE_SECONDS));
      if (fullFrame && options.length) {
        const module = options[0];
        originals.set(scene.id, scene);
        out[index] = convert(scene, module, framed, moves);
        if (module === "photo-scene") moves += 1;
        treatment = module;
        changed.push(`scene ${scene.id}: ${scene.module} → ${module} (${why})`);
      } else if (VARIANTS[scene.module]) {
        const names = VARIANTS[scene.module];
        const variant = names[(names.indexOf(treatment.split(":")[1]) + 1) % names.length];
        out[index] = { ...scene, params: { ...scene.params, variant } };
        treatment = `${scene.module}:${variant}`;
        changed.push(`scene ${scene.id}: ${scene.module} variant → ${variant} (${why})`);
      }
    }
    const module = out[index].module;
    used.set(module, (used.get(module) ?? 0) + 1);
    previous = treatment;
  }
  if (!changed.length) return { storyboard, changed, originals };
  return { storyboard: { ...storyboard, scenes: out }, changed, originals };
}

/**
 * A converted insert the library had no shot for goes back to the card it
 * was planned as, with the card's own placeholder (a card's image slot is
 * optional; a footage treatment's media is not). errors are resolveShots'
 * "scene <id>: …" lines. → {storyboard, errors (the rest), restored: [id]}.
 */
export function restoreMisses(storyboard, errors, originals) {
  if (!originals?.size || !errors?.length) return { storyboard, errors, restored: [] };
  const restored = [];
  const rest = [];
  let scenes = storyboard.scenes;
  for (const line of errors) {
    const id = /^scene (\S+?):/.exec(line)?.[1];
    const original = id !== undefined ? originals.get(id) : undefined;
    const slot = SHOT_CARD_SLOTS[original?.module];
    const index = original && slot ? scenes.findIndex((scene) => scene.id === id) : -1;
    if (index < 0 || /needs "shows"/.test(line)) { rest.push(line); continue; }
    const [key, ...inner] = slot.split(".");
    const params = { ...original.params };
    if (!inner.length) delete params[key];
    else if (isObject(params[key])) { params[key] = { ...params[key] }; delete params[key][inner.join(".")]; if (!Object.keys(params[key]).length) delete params[key]; }
    if (scenes === storyboard.scenes) scenes = [...scenes];
    scenes[index] = { ...original, params };
    restored.push(id);
  }
  return { storyboard: restored.length ? { ...storyboard, scenes } : storyboard, errors: rest, restored };
}

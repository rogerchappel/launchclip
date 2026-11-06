// Short-form rules the storyboard planner checks on every attempt, for the
// three ways a library-backed short most often loses the viewer:
//
//   hookErrors        the opening's on-screen text is a bare topic ("Deck
//                     care?") (only when the app has a footage library; make's
//                     structure gate already opens a short on an image)
//   cardErrors        text and icon cards crowd out the footage: too many for
//                     the length, two in a row, or the same card module three
//                     times (only when the app has a footage library)
//   fitShotCallouts   a callout or grid label names what the shot was asked
//                     to show, but the app's notes say it shows something
//                     else: tooling drops the label, the shot plays as B-roll
//                     under the narration
//
// hookErrors and cardErrors are repair errors ("hook: …", "cards: …"); a
// storyboard that fails only these still ships when the repairs run out.

import { TITLE_CARD_MODULES } from "@launchclip/core/skeleton-library.mjs";

// Cards whose whole content is a word, a title or an icon: on a library-backed
// short they stand in for footage, and several in a row read as a template.
export const TEXT_CARD_MODULES = Object.freeze([...new Set(["concept-card", "icon-row", "icon-grid", "checklist", ...TITLE_CARD_MODULES])]);
// One text or icon card for every this many seconds (and at least two).
export const SECONDS_PER_TEXT_CARD = 15;
// The same card module at most this many times a video.
export const MAX_SAME_CARD = 2;
// The opening's on-screen text needs at least this many words to say why to stay.
export const MIN_HOOK_WORDS = 4;
// The rules apply to videos of this length or less.
const SHORT_SECONDS = 90;

const mainTrack = (storyboard) => (Array.isArray(storyboard?.scenes) ? storyboard.scenes : []).filter((scene) => (scene?.track ?? 0) === 0 && !scene?.insert);
const words = (text) => String(text ?? "").trim().split(/\s+/).filter(Boolean);

/** The seconds a storyboard runs: format.duration, else the narration's last word, else the last scene's end. */
export function storyboardSeconds(storyboard, wordList = []) {
  const fromFormat = Number(storyboard?.format?.duration);
  if (Number.isFinite(fromFormat) && fromFormat > 0) return fromFormat;
  const lastWord = Number(wordList.at(-1)?.end);
  if (Number.isFinite(lastWord) && lastWord > 0) return lastWord;
  const ends = mainTrack(storyboard).map((scene) => Number(scene.end)).filter(Number.isFinite);
  return ends.length ? Math.max(...ends) : 0;
}

/** The headline text a scene puts on screen: its lines, text, title or headline. */
export function sceneHeadline(scene) {
  const params = scene?.params ?? {};
  const lines = Array.isArray(params.lines) ? params.lines.map((line) => (typeof line === "string" ? line : line?.text)).filter(Boolean) : [];
  const text = lines.length ? lines.join(" ") : params.text ?? params.headline ?? params.title ?? "";
  return typeof text === "string" ? text.trim() : "";
}

/**
 * The opening's problems, as repair errors, when the app has a footage
 * library (footage: true) and no recording opens the video. options:
 * {seconds, footage, base (a recording opens the video)}.
 */
export function hookErrors(storyboard, { seconds = storyboardSeconds(storyboard), footage = false, base = false } = {}) {
  if (!footage || base || !(seconds > 0 && seconds <= SHORT_SECONDS)) return [];
  const opening = mainTrack(storyboard)[0];
  if (!opening) return [];
  const errors = [];
  const headline = sceneHeadline(opening);
  const count = words(headline).length;
  const bareQuestion = /\?\s*$/.test(headline) && !/\d/.test(headline) && count < 6;
  if (headline && (count < MIN_HOOK_WORDS || bareQuestion)) {
    errors.push(`hook: the opening scene ${opening.id ?? ""} shows "${headline}", a bare topic${bareQuestion ? " question" : ""} that gives no reason to stay. Put the hook's stakes on screen in about 6–8 words: the myth, the mistake, the number with its unit or the bold claim the narration opens on.`);
  }
  return errors;
}

/**
 * Text and icon cards that crowd out the footage, as repair errors. Applies
 * only when the app has a footage library (footage: true). options: {seconds, footage}.
 */
export function cardErrors(storyboard, { seconds = storyboardSeconds(storyboard), footage = false } = {}) {
  if (!footage || !(seconds > 0)) return [];
  const scenes = mainTrack(storyboard);
  const cards = scenes.filter((scene) => TEXT_CARD_MODULES.includes(scene.module));
  const errors = [];
  const cap = Math.max(2, Math.round(seconds / SECONDS_PER_TEXT_CARD));
  if (cards.length > cap) {
    errors.push(`cards: ${cards.length} text or icon cards (${cards.map((scene) => `${scene.id} ${scene.module}`).join(", ")}) in ${Math.round(seconds)} s; keep at most ${cap}. Say the other lines over footage instead: a clip with a callout for the key words, a photo-scene, or a media layout.`);
  }
  for (let i = 1; i < scenes.length; i += 1) {
    const [before, after] = [scenes[i - 1], scenes[i]];
    if (TEXT_CARD_MODULES.includes(before.module) && TEXT_CARD_MODULES.includes(after.module)) {
      errors.push(`cards: ${before.id} (${before.module}) and ${after.id} (${after.module}) are text or icon cards back to back; put footage between them.`);
    }
  }
  const counts = new Map();
  for (const scene of cards) counts.set(scene.module, (counts.get(scene.module) ?? 0) + 1);
  for (const [module, count] of counts) {
    if (count > MAX_SAME_CARD) errors.push(`cards: ${module} is used ${count} times; at most ${MAX_SAME_CARD} a video. Vary the treatment or put the line over footage.`);
  }
  return errors;
}

// Words that say nothing about what a shot shows.
const STOP = new Set(["the", "and", "for", "with", "can", "may", "might", "need", "needs", "needed", "help", "helps", "still", "your", "you", "its", "it's", "not", "does", "doesn't", "more", "less", "very", "just", "only", "also", "from", "into", "this", "that", "than", "then", "when", "what", "how", "why", "are", "was", "will", "has", "have", "had", "but", "one", "two", "all", "any", "each", "every", "regular", "regularly", "good", "great", "best", "keep", "keeps", "make", "makes", "maintain", "maintains"]);

const tokens = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9'\s-]/g, " ").split(/[\s-]+/).filter((token) => token.length >= 3 && !STOP.has(token));

const notesText = (notes) => {
  if (!notes) return "";
  if (typeof notes === "string") return notes;
  const parts = [];
  const visit = (value) => {
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) if (!["windows", "start", "end", "quality", "duration"].includes(key)) visit(item);
  };
  visit(notes);
  return parts.join(" ");
};

// A label word matches a notes word when one contains the other (at least
// four letters: "hardwood" has "wood") or they share a five-letter stem.
const matches = (word, noteWords) => noteWords.some((note) =>
  note === word
  || (note.length >= 4 && word.includes(note))
  || (word.length >= 4 && note.includes(word))
  || (word.length >= 5 && note.length >= 5 && word.slice(0, 5) === note.slice(0, 5))
);

/** Whether a label fits a shot's notes: at least half its content words appear there. Labels with no content words fit. */
export function labelFitsNotes(label, notes) {
  const want = tokens(label);
  if (!want.length) return true;
  const noteWords = tokens(notesText(notes));
  if (!noteWords.length) return true;
  const hit = want.filter((word) => matches(word, noteWords)).length;
  return hit / want.length >= 0.5;
}

/**
 * Drops the callouts and grid labels that name what a shot was asked to show
 * when the app's notes say it shows something else. shots: resolveShots()'s
 * [{scene_id, src, slot?, notes?}]. → {storyboard (a copy when changed), dropped: ["<scene>: \"<label>\""]}
 */
export function fitShotCallouts(storyboard, shots = []) {
  const bySrc = new Map();
  const byScene = new Map();
  for (const shot of shots) {
    if (!shot?.notes || shot.slot === "backdrop") continue;
    if (shot.src) bySrc.set(String(shot.src), shot.notes);
    if (shot.scene_id && !shot.slot) byScene.set(String(shot.scene_id), shot.notes);
  }
  if (!bySrc.size || !Array.isArray(storyboard?.scenes)) return { storyboard, dropped: [] };
  const dropped = [];
  const scenes = storyboard.scenes.map((scene) => {
    const params = scene?.params;
    if (!params) return scene;
    let next = params;
    const sceneNotes = byScene.get(String(scene.id)) ?? (params.media?.src ? bySrc.get(String(params.media.src)) : null);
    if (sceneNotes && Array.isArray(params.callouts)) {
      const kept = params.callouts.filter((callout) => {
        const text = typeof callout === "string" ? callout : callout?.text;
        if (labelFitsNotes(text, sceneNotes)) return true;
        dropped.push(`${scene.id}: "${text}"`);
        return false;
      });
      if (kept.length !== params.callouts.length) next = { ...next, callouts: kept };
    }
    if (Array.isArray(params.items)) {
      let changed = false;
      const items = params.items.map((item) => {
        const notes = item?.media?.src ? bySrc.get(String(item.media.src)) : null;
        if (!notes || !item.label || labelFitsNotes(item.label, notes)) return item;
        dropped.push(`${scene.id}: "${item.label}"`);
        changed = true;
        const { label, ...rest } = item;
        return rest;
      });
      if (changed) next = { ...next, items };
    }
    return next === params ? scene : { ...scene, params: next };
  });
  return dropped.length ? { storyboard: { ...storyboard, scenes }, dropped } : { storyboard, dropped };
}

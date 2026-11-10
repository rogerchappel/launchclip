// Short-form rules for every video of SHORT_SECONDS or less, with or without
// supplied footage, for the ways a short most often loses the viewer:
//
//   hookErrors        the opening's on-screen text is a bare topic ("Deck
//                     care?") (skipped when a recording opens the video;
//                     make's structure gate already opens a short on an image)
//   hookTiming        the opening is slow: no readable claim or question on
//                     screen early (in a scene, or in the captions), a logo alone opens the video, the opening scene
//                     takes too long to arrive, or the voice starts late
//   cardErrors        text and icon cards crowd out everything else: too many
//                     for the length, two in a row, or the same card module
//                     three times
//   fitShotCallouts   a callout or grid label names what the shot was asked
//                     to show, but the app's notes say it shows something
//                     else: tooling drops the label, the shot plays as B-roll
//                     under the narration
//
// The planner checks the storyboard on every attempt (hookErrors,
// hookTimingErrors, cardErrors): repair errors ("hook: …", "cards: …"); a
// storyboard that fails only these still ships when the repairs run out.
// finish then gates the opening it is about to deliver (hookGate, the `hook`
// gate): the same checks plus the first spoken word, which only the measured
// narration can show. Every check reads the storyboard and the narration,
// never the render, so both renderers get the same verdict.
//
// Where the opening's numbers come from (hookThresholds): the cadence profile
// the story is gated against (kit/profiles/, docs/VIDEO_QUALITY_RFC.md §5),
// else the shipped short profile for the lane (short-talking-head over a
// recording, short-motion otherwise).
//   claim_by       first_visual_seconds p90 ("when the first designed graphic
//                  appears"), never under FIRST_FRAME_SECONDS (the structure
//                  gate's "opening image on screen by")
//   entrance_max   first_motion_seconds p90 ("when the first meaningful
//                  motion arrives"), never under FIRST_FRAME_SECONDS: the
//                  longest the opening scene's `in` transition may run
//   first_word_by  the later of the two. No profile measures when speech
//                  starts, so the voice is held to the window the profile
//                  gives the picture and the motion.

import { sceneTextWords } from "@launchclip/core/captions.mjs";
import { FIRST_FRAME_SECONDS, TITLE_CARD_MODULES } from "@launchclip/core/skeleton-library.mjs";
import { storyBase } from "@launchclip/core/story.mjs";
import { shippedProfiles } from "./profile_store.js";

// Cards whose whole content is a word, a title or an icon: several in a row
// read as a template, and on a short with footage they stand in for it.
export const TEXT_CARD_MODULES = Object.freeze([...new Set(["concept-card", "icon-row", "icon-grid", "checklist", ...TITLE_CARD_MODULES])]);
// One text or icon card for every this many seconds (and at least two).
export const SECONDS_PER_TEXT_CARD = 15;
// The same card module at most this many times a video.
export const MAX_SAME_CARD = 2;
// The opening's on-screen text needs at least this many words to say why to stay.
export const MIN_HOOK_WORDS = 4;
// The rules apply to videos of this length or less.
export const SHORT_SECONDS = 90;
// On-screen text counts as a claim from this many words (one word is a label), or when it has a number. A judgement, not a measured band.
export const MIN_CLAIM_WORDS = 2;
// Modules that put a logo on screen and say nothing yet: a slow way to open.
export const LOGO_OPEN_MODULES = Object.freeze(["brand-lockup", "logo-row"]);
// The shipped profile whose opening bands stand in when the story's own has none.
const FALLBACK_PROFILE = Object.freeze({ base: "short-talking-head", none: "short-motion" });

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
 * The opening text's problems, as repair errors, on a short no recording
 * opens. options: {seconds, base (a recording opens the video)}.
 */
export function hookErrors(storyboard, { seconds = storyboardSeconds(storyboard), base = false } = {}) {
  if (base || !(seconds > 0 && seconds <= SHORT_SECONDS)) return [];
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
 * The opening's time limits for a story, each with where it comes from.
 * profile: the cadence profile the story is gated against (or null); base: a
 * recording opens the video.
 * → {claim_by, entrance_max, first_word_by, profile, sources: {claim_by, entrance_max, first_word_by}}
 */
export function hookThresholds(profile = null, { base = false } = {}) {
  const fallbackId = base ? FALLBACK_PROFILE.base : FALLBACK_PROFILE.none;
  let fallback = null;
  const band = (measure) => {
    const own = Number(profile?.measures?.[measure]?.p90);
    if (Number.isFinite(own)) return { value: own, from: profile.id };
    fallback ??= shippedProfiles().find((entry) => entry.id === fallbackId) ?? null;
    const shipped = Number(fallback?.measures?.[measure]?.p90);
    return Number.isFinite(shipped) ? { value: shipped, from: fallbackId } : { value: FIRST_FRAME_SECONDS, from: null };
  };
  const visual = band("first_visual_seconds");
  const motion = band("first_motion_seconds");
  const floor = (entry, measure) => ({
    value: Math.max(FIRST_FRAME_SECONDS, entry.value),
    source: entry.from === null ? `FIRST_FRAME_SECONDS (${FIRST_FRAME_SECONDS} s; no profile gives ${measure})` : `${measure} p90 of the ${entry.from} profile (${entry.value} s)${entry.value < FIRST_FRAME_SECONDS ? `, raised to FIRST_FRAME_SECONDS (${FIRST_FRAME_SECONDS} s)` : ""}`
  });
  const claim = floor(visual, "first_visual_seconds");
  const entrance = floor(motion, "first_motion_seconds");
  const word = claim.value >= entrance.value ? claim : entrance;
  return {
    claim_by: claim.value,
    entrance_max: entrance.value,
    first_word_by: word.value,
    profile: profile?.id ?? null,
    sources: { claim_by: claim.source, entrance_max: entrance.source, first_word_by: `the later of the two windows: ${word.source}` }
  };
}

// On-screen words that say something: a phrase, or a number.
const isClaim = (list) => list.length >= MIN_CLAIM_WORDS || list.some((word) => /\d/.test(word));
// The words a scene shows, a brand's own name aside (a lockup's wordmark is the logo, not a claim).
const shownWords = (scene) => {
  const { wordmark, mark, logos, ...rest } = scene?.params ?? {};
  return sceneTextWords(LOGO_OPEN_MODULES.includes(scene?.module) ? rest : scene?.params);
};

const startOf = (scene, times) => {
  const timed = times?.get?.(scene?.id)?.start;
  const value = Number.isFinite(timed) ? timed : Number(scene?.start ?? scene?.resolved?.start);
  return Number.isFinite(value) ? value : null;
};

/**
 * How fast a short opens. options: {seconds, words ([{text, start}], the
 * narration as measured; omitted: the first-word check is skipped and
 * captions do not count as a claim), checkVoice (false: no first-word check), times
 * (Map(scene id → {start}), for a storyboard with word anchors; else each
 * scene's numeric start), profile, base (a recording opens the video)}.
 * → {status: "passed" | "failed" | "skipped", thresholds, checks: {claim,
 *    logo_open, entrance, first_word}, findings: [text]}
 *   claim        a phrase (MIN_CLAIM_WORDS words or more) or a number is on screen by
 *                claim_by, in a scene or in the captions of a voice that has started
 *   logo_open    the video does not open on a logo with no claim on it (skipped over a recording)
 *   entrance     the opening scene's `in` transition is no longer than entrance_max
 *   first_word   the first spoken word starts by first_word_by
 */
export function hookTiming(storyboard, { seconds = storyboardSeconds(storyboard), words = null, times = null, profile = null, base = false, checkVoice = true } = {}) {
  if (!(seconds > 0 && seconds <= SHORT_SECONDS)) return { status: "skipped", reason: `longer than ${SHORT_SECONDS} s`, checks: {}, findings: [] };
  const all = (Array.isArray(storyboard?.scenes) ? storyboard.scenes : []).filter((scene) => scene && startOf(scene, times) !== null);
  if (!all.length) return { status: "skipped", reason: "no scene has a start time yet", checks: {}, findings: [] };
  const thresholds = hookThresholds(profile, { base });
  const checks = {};
  const s = (value) => `${Math.round(value * 100) / 100} s`;
  // A claim on screen: the earliest scene (any track) that shows a phrase or a
  // number, or the captions, which put the spoken hook on screen as it is said.
  const readable = all.map((scene) => ({ scene, at: Math.max(0, startOf(scene, times)), words: shownWords(scene) })).filter((entry) => isClaim(entry.words)).sort((a, b) => a.at - b.at)[0] ?? null;
  const first = Array.isArray(words) ? words.map((word) => Number(word?.start)).filter(Number.isFinite).sort((a, b) => a - b)[0] : undefined;
  const captioned = (Array.isArray(storyboard?.overlays) ? storyboard.overlays : []).some((overlay) => overlay?.type === "captions") && first !== undefined && first <= thresholds.claim_by + 1e-6;
  checks.claim = readable && readable.at <= thresholds.claim_by + 1e-6
    ? { ok: true, detail: `${readable.scene.id} puts ${readable.words.length} word${readable.words.length === 1 ? "" : "s"} on screen at ${s(readable.at)}` }
    : captioned
      ? { ok: true, detail: `the captions put the spoken hook on screen from ${s(first)}` }
      : { ok: false, detail: `${readable ? `the first readable text (${readable.scene.id}) arrives at ${s(readable.at)}` : "no scene puts a phrase or a number on screen"}${first === undefined ? "" : `, and ${(storyboard?.overlays ?? []).some((overlay) => overlay?.type === "captions") ? `the captions start with the first word at ${s(first)}` : "there are no captions"}`}; a short needs its claim or question on screen by ${s(thresholds.claim_by)}. Put the hook's words (the myth, the mistake, the number, the question) on the opening scene itself: its title or headline, or a callout over the opening image.` };
  const opening = [...all].filter((scene) => (scene.track ?? 0) === 0 || scene.insert === true).sort((a, b) => startOf(a, times) - startOf(b, times))[0] ?? null;
  if (!base && opening) {
    // A lockup that carries the claim with it is a title, not a wait; a logo alone is.
    const logo = LOGO_OPEN_MODULES.includes(opening.module);
    const says = isClaim(shownWords(opening));
    checks.logo_open = logo && !says
      ? { ok: false, detail: `the video opens on a logo alone (${opening.id}, ${opening.module}); nobody stays for a logo. Open on the hook's image with its claim on screen and move the logo to the end card, or put the claim on the lockup (its headline).` }
      : { ok: true, detail: `opens on ${opening.id} (${opening.module}${logo ? ", a logo with its claim" : ""})` };
  }
  if (opening) {
    const entrance = Number(opening.in?.dur ?? opening.in?.duration);
    checks.entrance = Number.isFinite(entrance) && entrance > thresholds.entrance_max + 1e-6
      ? { ok: false, detail: `the opening scene ${opening.id} takes ${s(entrance)} to arrive (its in transition); the first frame must already be moving. Cut straight in, or keep the transition to ${s(thresholds.entrance_max)} or less.` }
      : { ok: true, detail: Number.isFinite(entrance) ? `${opening.id} arrives in ${s(entrance)}` : `${opening.id} cuts straight in` };
  }
  if (first !== undefined && checkVoice) {
    checks.first_word = first <= thresholds.first_word_by + 1e-6
      ? { ok: true, detail: `the first word is spoken at ${s(first)}` }
      : { ok: false, detail: `the first word is spoken at ${s(first)}; a short starts talking by ${s(thresholds.first_word_by)}. Trim the silence before the first word of the narration or the recording.` };
  }
  const findings = Object.entries(checks).filter(([, check]) => !check.ok).map(([name, check]) => `${name}: ${check.detail}`);
  return { status: findings.length ? "failed" : "passed", thresholds, checks, findings };
}

/** hookTiming()'s failures the planner can fix (not the first word: a storyboard cannot move the voice), as repair errors. */
export function hookTimingErrors(storyboard, options = {}) {
  const { checks } = hookTiming(storyboard, { ...options, checkVoice: false });
  return Object.entries(checks).filter(([, check]) => !check.ok).map(([, check]) => `hook: ${check.detail}`);
}

/**
 * finish's `hook` gate: how the short it is about to deliver opens. story:
 * the resolved storyboard; words: the narration as measured.
 * → hookTiming()'s result, with the bare-topic check as `text`
 */
export function hookGate({ story, words = [], profile = null, duration = null } = {}) {
  const seconds = Number(duration) > 0 ? Number(duration) : Number(story?.resolved?.duration) || storyboardSeconds(story, words);
  const base = Boolean(storyBase(story));
  const timing = hookTiming(story, { seconds, words, profile, base });
  if (timing.status === "skipped") return timing;
  const bare = hookErrors(story, { seconds, base }).map((entry) => entry.replace(/^hook: /, ""));
  const checks = { ...timing.checks, text: bare.length ? { ok: false, detail: bare[0] } : { ok: true, detail: "the opening text says why to stay" } };
  const findings = Object.entries(checks).filter(([, check]) => !check.ok).map(([name, check]) => `${name}: ${check.detail}`);
  return { status: findings.length ? "failed" : "passed", thresholds: timing.thresholds, checks, findings };
}

/**
 * Text and icon cards that crowd out everything else, as repair errors: on
 * every short, and at any length when the app has a footage library. options: {seconds, footage (the app has a footage library: the
 * advice names footage; otherwise it names the other kinds of scene)}.
 */
export function cardErrors(storyboard, { seconds = storyboardSeconds(storyboard), footage = false } = {}) {
  // With a footage library the cap holds at any length, as it always has; without one, on a short.
  if (!(seconds > 0) || (!footage && seconds > SHORT_SECONDS)) return [];
  const instead = footage
    ? "Say the other lines over footage instead: a clip with a callout for the key words, a photo-scene, or a media layout."
    : "Show the other lines instead of spelling them out: a chart or diagram, a product or UI scene, a character, or a supplied image or clip with a callout for the key words.";
  const between = footage ? "put footage between them" : "put a scene that shows something (a chart, a diagram, a product or UI scene, a character, an image or clip) between them";
  const scenes = mainTrack(storyboard);
  const cards = scenes.filter((scene) => TEXT_CARD_MODULES.includes(scene.module));
  const errors = [];
  const cap = Math.max(2, Math.round(seconds / SECONDS_PER_TEXT_CARD));
  if (cards.length > cap) {
    errors.push(`cards: ${cards.length} text or icon cards (${cards.map((scene) => `${scene.id} ${scene.module}`).join(", ")}) in ${Math.round(seconds)} s; keep at most ${cap}. ${instead}`);
  }
  for (let i = 1; i < scenes.length; i += 1) {
    const [before, after] = [scenes[i - 1], scenes[i]];
    if (TEXT_CARD_MODULES.includes(before.module) && TEXT_CARD_MODULES.includes(after.module)) {
      errors.push(`cards: ${before.id} (${before.module}) and ${after.id} (${after.module}) are text or icon cards back to back; ${between}.`);
    }
  }
  const counts = new Map();
  for (const scene of cards) counts.set(scene.module, (counts.get(scene.module) ?? 0) + 1);
  for (const [module, count] of counts) {
    if (count > MAX_SAME_CARD) errors.push(`cards: ${module} is used ${count} times; at most ${MAX_SAME_CARD} a video. Vary the treatment${footage ? " or put the line over footage" : ""}.`);
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
      if (kept.length !== params.callouts.length) {
        // No label left: no list either (an empty one fails the module's minItems on every attempt).
        const { callouts, ...rest } = next;
        next = kept.length ? { ...next, callouts: kept } : rest;
      }
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

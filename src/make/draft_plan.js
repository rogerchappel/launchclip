// The rule-made storyboard of a fast draft (make --speed draft).
//
// A draft does not wait on a model for its shot list. The beat director's
// clause splitter (kit/core/beat-director.mjs clauseBeats) cuts the voiced
// narration into lines of a few seconds, and each line gets a scene by rule:
//
//   - the opening line: a character, whole on frame 0, beside the hook;
//   - the closing line: the call to action card;
//   - a line that lists three things: the list, as steps;
//   - with an asset provider: every third line asks for a shot (a full-frame
//     clip), and keeps the drawn scene it would have had as its fallback;
//   - a supplied image or clip: shown in a window, one a line, in order;
//   - every other line: a character of the explainer's cast beside the
//     line's own words, or two of them together for a short line.
//
// Characters carry at least EXPLAINER_CHARACTER_SHARE of the runtime, as an
// explainer's checks ask (kit/core/explainer.mjs), and every word on a card
// is one the narration says. The result is a storyboard like a model's: the
// planner pins the fixed inputs, runs its tooling and checks it
// (src/storyboard_planner.js), so a draft is as valid as any other plan.
import { clauseBeats, extractFacts, verbatimHeadline } from "@launchclip/core/beat-director.mjs";
import { CAST_SCENE_SECONDS, EXPLAINER_CHARACTER_SHARE, defaultExplainerCast } from "@launchclip/core/explainer.mjs";

/** The longest a line holds before it is cut at a clause. */
export const DRAFT_LINE_SECONDS = 4.5;
/** The shortest piece a long sentence is cut into. */
export const DRAFT_LINE_MIN_SECONDS = 2.2;
/** A line shorter than this joins the line before it, when the two still fit one line. */
export const DRAFT_JOIN_SECONDS = 2.2;
/** A card is fully shown for its scene less this, and needs READ_SECONDS a word. */
const SETTLE_SECONDS = 0.8;
const READ_SECONDS = 0.22;

// How a character acts a line, by what the line is: [pose, expression], then the change mid-line.
const ACTING = Object.freeze({
  question: [["shrug", "confused"], ["think", "thinking"]],
  turn: [["lean-in", "surprised"], ["point", "excited"]],
  problem: [["facepalm", "frustrated"], ["slump", "worried"]],
  payoff: [["cheer", "delighted"], ["point-self", "happy"]],
  plain: [["point", "happy"], ["wave", "excited"], ["hands-on-hips", "smirk"], ["think", "focused"], ["point-self", "happy"], ["arms-crossed", "smirk"]]
});

const plain = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const wordsOf = (text) => plain(text).split(" ").filter(Boolean);
const round2 = (value) => Math.round(value * 100) / 100;

/** What a line is, for the acting: a question, a turn, a problem, a payoff, or plain. */
export function lineFeeling(text) {
  const line = plain(text).toLowerCase();
  if (/\?["”')]*$/.test(line)) return "question";
  if (/\b(but|actually|turns out|instead|until|except|surprise|secret|truth)\b/.test(line)) return "turn";
  if (/\b(problem|never|can't|cannot|won't|fail\w*|broken|stuck|wrong|mess|waste\w*|hard|slow)\b/.test(line)) return "problem";
  if (/\b(so|that's why|which means|finally|now|done|works?|easy|free|save\w*|faster|better)\b/.test(line)) return "payoff";
  return "plain";
}

/**
 * The narration cut into lines of up to DRAFT_LINE_SECONDS: sentences first,
 * a long sentence at its clauses, a very short one joined to the line before it.
 * words: [{text, start, end}]. → [{from, to, start, end, text}] (word indexes, inclusive)
 */
export function draftLines(words) {
  const list = (Array.isArray(words) ? words : []).filter((word) => Number.isFinite(word?.start) && Number.isFinite(word?.end));
  if (!list.length) return [];
  const sentences = [];
  let from = 0;
  list.forEach((word, index) => {
    if (/[.!?…]["'”’)]*$/.test(String(word.text)) || index === list.length - 1) { sentences.push([from, index]); from = index + 1; }
  });
  const ranges = [];
  for (const [first, last] of sentences) {
    if (list[last].end - list[first].start <= DRAFT_LINE_SECONDS) { ranges.push([first, last]); continue; }
    for (const beat of clauseBeats(list, { min: DRAFT_LINE_MIN_SECONDS, max: DRAFT_LINE_SECONDS, target: 3.2, from: first, to: last })) ranges.push(beat.words);
  }
  // A line too short to hold joins a neighbour, while the pair still fits one line and a half.
  const joined = [];
  for (const range of ranges) {
    const before = joined.at(-1);
    const seconds = list[range[1]].end - list[range[0]].start;
    if (before && (seconds < DRAFT_JOIN_SECONDS || list[before[1]].end - list[before[0]].start < DRAFT_JOIN_SECONDS) && list[range[1]].end - list[before[0]].start <= DRAFT_LINE_SECONDS * 1.25) before[1] = range[1];
    else joined.push([...range]);
  }
  return joined.map(([first, last]) => ({ from: first, to: last, start: list[first].start, end: list[last].end, text: list.slice(first, last + 1).map((word) => word.text).join(" ") }));
}

/**
 * A card title a line itself says: a headline the beat director finds in it,
 * else its opening words, cut to what the scene has time to show.
 */
export function lineTitle(text, seconds) {
  const room = Math.max(2, Math.min(7, Math.floor((seconds - SETTLE_SECONDS) / READ_SECONDS)));
  const strip = (value) => plain(value).replace(/^["“'(]+|["”')]*[.,;:!?…]*["”')]*$/g, "");
  const found = verbatimHeadline(text);
  if (found && wordsOf(found).length <= room) return strip(found);
  const all = wordsOf(text);
  let take = Math.min(room, all.length);
  // Stop at the line's own first pause when there is one inside the room.
  const pause = all.slice(0, take).findIndex((word, index) => index >= 1 && /[,;:—–]$/.test(word));
  if (pause >= 1) take = pause + 1;
  return strip(all.slice(0, take).join(" "));
}

/**
 * The rule-made storyboard.
 * options: {words, format {width, height, fps, duration}, lane, title,
 *   cast ({style, characters}: the explainer's; default the guide and the
 *   spark), shots ({min, max}: an asset provider answers shot requests),
 *   media ([{src, kind}]: supplied images and clips to show),
 *   plain (true: characters and the call to action only)}
 * → {storyboard, fallbacks: {scene id: the drawn scene a missed shot falls back to}, lines, cast, character_share}
 */
export function draftStoryboard(options = {}) {
  const { words = [], format, lane = "motion", title = null } = options;
  if (!format || !(format.duration > 0)) throw new Error("draftStoryboard needs format {width, height, fps, duration}");
  const cast = options.cast?.characters?.length ? options.cast : (({ style, characters }) => ({ style, characters }))(defaultExplainerCast());
  const members = cast.characters.map((member) => member.id);
  const lines = draftLines(words);
  if (!lines.length) throw new Error("draftStoryboard needs the narration's word timings");
  const portrait = format.height > format.width;
  const shots = options.plain !== true && options.shots && Number(options.shots.max) > 0 ? { min: Math.max(0, Number(options.shots.min) || 0), max: Number(options.shots.max) } : null;
  const media = (Array.isArray(options.media) ? options.media : []).filter((item) => item?.src && ["image", "video"].includes(item.kind));
  // plain: one character beside the line's words in every scene, and the call to action: the plan that cannot fail on a layout.
  const plainOnly = options.plain === true;
  // Each scene runs from its line's first word to the next line's (the last to the end of the video).
  const spans = lines.map((line, index) => ({ ...line, start: index === 0 ? 0 : round2(line.start), end: index === lines.length - 1 ? format.duration : round2(lines[index + 1].start) }));
  const last = spans.length - 1;
  let turn = 0;
  let acted = 0;
  const cameo = (span, index) => {
    const seconds = span.end - span.start;
    const feeling = index === last ? "payoff" : lineFeeling(span.text);
    const moves = ACTING[feeling];
    const [pose, expression] = moves[feeling === "plain" ? acted % moves.length : 0];
    const [nextPose, nextExpression] = moves[feeling === "plain" ? (acted + 1) % moves.length : 1];
    acted += 1;
    // The guide opens and closes; the cast takes turns between.
    const character = index === 0 || index === last ? members[0] : members[(turn += 1) % members.length];
    const params = { character, pose, expression, side: index % 2 ? "right" : "left", ...(portrait ? { shot: "medium" } : {}), card: { title: lineTitle(span.text, seconds) } };
    if (seconds >= 2.4) params.cues = [{ at: round2(Math.min(seconds - 0.6, Math.max(1.2, seconds / 2))), pose: nextPose, expression: nextExpression }];
    return { id: `d${index + 1}`, module: "character-cameo", start: span.start, end: span.end, energy: index === 0 ? 3 : 2, params };
  };
  const together = (span, index) => {
    const seconds = span.end - span.start;
    const pair = members.slice(0, 2);
    const feeling = lineFeeling(span.text);
    const [pose, expression] = ACTING[feeling][0];
    return { id: `d${index + 1}`, module: "cast-scene", start: span.start, end: span.end, energy: 2, params: { set: "standing", shot: "medium", cast: pair.map((id, at) => (at === 0 ? { id, pose, expression, ...(seconds >= 2.4 ? { cues: [{ at: round2(seconds / 2), pose: "point", expression: "happy" }] } : {}) } : { id, pose: "wave", expression: "happy", ...(seconds >= 3 ? { cues: [{ at: round2(seconds * 0.7), pose: "cheer", expression: "excited" }] } : {}) })) } };
  };
  const drawn = (span, index) => {
    const seconds = span.end - span.start;
    if (index > 0 && index < last) {
      const items = extractFacts(span.text).items ?? [];
      // A list is shown as steps only when every item is a word or two the card has room for.
      if (!plainOnly && !shots && items.length >= 3 && seconds >= 3 && items.slice(0, 4).every((item) => wordsOf(item).length <= 2 && plain(item).length <= 14)) return { id: `d${index + 1}`, module: "process-steps", start: span.start, end: span.end, energy: 2, params: { steps: items.slice(0, 4).map((item) => plain(item).replace(/^./, (letter) => letter.toUpperCase())) } };
      if (!plainOnly && members.length > 1 && index % 4 === 2 && seconds <= (portrait ? CAST_SCENE_SECONDS : DRAFT_LINE_SECONDS * 1.5)) return together(span, index);
    }
    return cameo(span, index);
  };
  let scenes = spans.map(drawn);
  // The closing line is the call to action, when it is one line of its own.
  if (last > 0) {
    const closing = spans[last];
    const action = lineTitle(closing.text, Math.max(closing.end - closing.start, 2.5));
    if (action) scenes[last] = { id: `d${last + 1}`, module: "cta", start: closing.start, end: closing.end, energy: 1, params: { action, icon: "none" } };
  }
  const isCharacter = (scene) => scene.module === "character-cameo" || scene.module === "cast-scene";
  const seconds = (list) => list.reduce((total, scene) => total + (scene.end - scene.start), 0);
  const share = (list) => seconds(list.filter(isCharacter)) / Math.max(0.01, seconds(list));
  // Supplied media and shots take lines from the middle, while characters keep their share of the runtime.
  const fallbacks = {};
  const floor = EXPLAINER_CHARACTER_SHARE + 0.02;
  const give = (index, scene, fallback = false) => {
    const next = scenes.map((entry, at) => (at === index ? scene : entry));
    if (share(next) < floor) return false;
    if (fallback) fallbacks[scene.id] = scenes[index];
    scenes = next;
    return true;
  };
  const middle = spans.map((_, index) => index).filter((index) => index > 0 && index < last);
  const free = () => middle.filter((index) => scenes[index].module === "character-cameo");
  for (const [at, item] of (plainOnly ? [] : media).entries()) {
    // Spread the files over the video, in the order given.
    const open = free();
    const index = open[Math.min(open.length - 1, Math.floor((at + 0.5) * open.length / Math.max(1, media.length)))];
    if (index === undefined) break;
    const span = spans[index];
    if (!give(index, { id: `d${index + 1}`, module: "media-window", start: span.start, end: span.end, energy: 2, params: { title: lineTitle(span.text, span.end - span.start), media: { kind: item.kind, src: item.src } } })) break;
  }
  if (shots) {
    // Every third line, then more until the minimum is asked for; each keeps its drawn scene as the fallback.
    const order = [...free().filter((index) => index % 3 === 1), ...free().filter((index) => index % 3 !== 1)];
    let asked = 0;
    for (const index of order) {
      if (asked >= shots.max || (asked >= Math.max(shots.min, Math.ceil(middle.length / 3)))) break;
      const span = spans[index];
      if (give(index, { id: `d${index + 1}`, module: "clip", start: span.start, end: span.end, energy: 2, params: { media: { kind: "shot", shows: plain(span.text).replace(/[.!?…]+$/, ""), type: "video" } } }, true)) asked += 1;
    }
  }
  const storyboard = {
    schema: "launchclip.story.v1",
    ...(title ? { title } : {}),
    lane,
    format,
    cast,
    scenes,
    overlays: [{ type: "captions" }],
    ending: { loop: false }
  };
  return { storyboard, fallbacks, lines: spans, cast, character_share: round2(share(scenes)) };
}

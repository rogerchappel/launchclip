// The screenplay (launchclip.make-script.v2, SCRIPT.json): a script with
// speakers and silent lines (docs/ANIMATION_PIPELINE_RFC.md §4.1). A line is
// spoken (`speaker` is a character id or "narrator", with `text`) or silent
// (`speaker: null`, with an `action` and its length in `seconds`). A narrated
// script is the case where every speaker is the narrator, and a version 1
// file (a title, one `narration` string and its `beats: [{beat, text}]`)
// reads as exactly that.
//
//   readScreenplay(value)                 → the version 2 shape of any SCRIPT.json
//   validateScreenplay(value, options)    → {ok, errors, warnings, stats}
//   screenplayText(script)                → the spoken text, joined in order
//   spokenLines(script)                   → [{id, speaker, text, beat, start, end}]
//   screenplayNarration(script)           → {lines: [{speaker, text, gap?}], lead_seconds, tail_seconds}
//   screenplayTiming(script, {wpm, gap})  → estimated line times at a speaking pace
//
// screenplayNarration().lines is audio.narration.lines, the dialogue format
// src/voice/dialogue.js voices: a silent line becomes the pause after the
// spoken line before it. The script checks every spoken line also has to pass
// (the opener, the clock, figures traced to the brief) live in
// src/script_check.js (checkScreenplay), which runs this validator first.
//
// Pure ESM; imports only kit/core siblings. Canonical copy: kit/core/screenplay.mjs.

import { NARRATIVE_BEATS } from './direction.mjs';

export const SCREENPLAY_VERSION = 'launchclip.make-script.v2';
/** Version 1: a narrated script (title, narration, beats: [{beat, text}]). */
export const NARRATED_SCRIPT_VERSION = 'launchclip.make-script.v1';
export const SCRIPT_VERSIONS = Object.freeze([NARRATED_SCRIPT_VERSION, SCREENPLAY_VERSION]);
export const NARRATOR = 'narrator';
export const SCREENPLAY_BEATS = NARRATIVE_BEATS;
/** The speaking pace assumed until a take is measured, in words a minute. */
export const SCREENPLAY_WPM = 150;
/** The pause between two spoken lines with no silent line between them (the dialogue default). */
export const SCREENPLAY_GAP = 0.3;
/** The longest pause a dialogue line can carry (audio.narration.lines[].gap), so the longest run of silent lines. */
export const MAX_SILENCE_SECONDS = 3;
/** How far over the target length a script may run before it fails. */
export const LENGTH_TOLERANCE = 0.15;
/** audio.narration.lines holds at most this many lines. */
export const MAX_SPOKEN_LINES = 200;

const ID = /^[a-z][a-z0-9-]{0,23}$/;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const round3 = (value) => Math.round(value * 1000) / 1000;
const countWords = (value) => String(value).split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
const isSpoken = (line) => isObject(line) && line.speaker !== null && line.speaker !== undefined;

/** Whether a SCRIPT.json value is written in the version 2 shape (its version says so, or a beat has lines). */
export function isScreenplay(value) {
  if (!isObject(value)) return false;
  if (value.schema_version === SCREENPLAY_VERSION) return true;
  return value.schema_version !== NARRATED_SCRIPT_VERSION && Array.isArray(value.beats) && value.beats.some((beat) => Array.isArray(beat?.lines));
}

/**
 * Any SCRIPT.json in the version 2 shape. A version 2 file is returned as it
 * is. A version 1 file (or an older one with no version) becomes all-narrator:
 * one narrator line per beat, or one line holding the whole narration when it
 * has no beats; its other fields (plan, title_options, check, …) are kept and
 * `source_version` records what was read. Throws on a value that is not a
 * script, and on a version this reader does not know.
 */
export function readScreenplay(value) {
  if (!isObject(value)) throw new Error('a script must be a JSON object');
  const version = value.schema_version;
  if (version !== undefined && !SCRIPT_VERSIONS.includes(version)) throw new Error(`unknown script version "${version}" (this reader knows ${SCRIPT_VERSIONS.join(' and ')})`);
  if (isScreenplay(value)) return value;
  const narration = text(value.narration);
  const beats = (Array.isArray(value.beats) ? value.beats : []).filter((beat) => isObject(beat) && text(beat.text ?? beat.spoken));
  if (!narration && !beats.length) throw new Error('the script has no narration and no beats');
  const source = beats.length ? beats : [{ beat: 'narration', text: narration }];
  return {
    ...value,
    schema_version: SCREENPLAY_VERSION,
    source_version: version ?? NARRATED_SCRIPT_VERSION,
    characters: [],
    beats: source.map((beat, index) => ({
      beat: text(beat.beat) || 'narration',
      ...(beat.role ? { role: beat.role } : {}),
      lines: [{ id: `l${index + 1}`, speaker: NARRATOR, text: text(beat.text ?? beat.spoken) }]
    })),
    narration: narration || source.map((beat) => text(beat.text ?? beat.spoken)).join(' ')
  };
}

/** Every line in order, each with its beat: [{...line, beat, beat_index}]. */
export function screenplayLines(script) {
  const beats = Array.isArray(script?.beats) ? script.beats : [];
  return beats.flatMap((beat, beatIndex) => (Array.isArray(beat?.lines) ? beat.lines : []).filter(isObject).map((line) => ({ ...line, beat: beat.beat, beat_index: beatIndex })));
}

/**
 * The spoken lines in order, with where each sits in screenplayText():
 * [{id, speaker, text, playing?, beat, start, end}] (character offsets).
 */
export function spokenLines(script) {
  let offset = 0;
  return screenplayLines(script).filter((line) => isSpoken(line) && text(line.text)).map((line) => {
    const spoken = text(line.text);
    const start = offset;
    offset += spoken.length + 1;
    return { id: line.id, speaker: line.speaker, text: spoken, ...(line.playing ? { playing: line.playing } : {}), beat: line.beat, start, end: start + spoken.length };
  });
}

/** The spoken text joined in order: what `narration` must hold, and what the script checks read. */
export const screenplayText = (script) => spokenLines(script).map((line) => line.text).join(' ');

/**
 * The dialogue the voice stage reads. lines is audio.narration.lines:
 * [{speaker, text, gap?}], where `gap` is the length of the silent lines that
 * follow that line (absent when none do, so the story's own gap applies).
 * `playing` and `action` are never spoken. Silent lines before the first
 * spoken line and after the last cannot be a pause between lines; their
 * lengths come back as lead_seconds and tail_seconds for the shot list.
 */
export function screenplayNarration(script) {
  const lines = [];
  let lead = 0;
  let pending = 0;
  for (const line of screenplayLines(script)) {
    if (isSpoken(line)) {
      if (!text(line.text)) continue;
      if (lines.length && pending > 0) lines.at(-1).gap = round3(Math.min(pending, MAX_SILENCE_SECONDS));
      pending = 0;
      lines.push({ speaker: line.speaker, text: text(line.text) });
    } else {
      const seconds = Number(line.seconds) > 0 ? Number(line.seconds) : 0;
      if (lines.length) pending += seconds;
      else lead += seconds;
    }
  }
  return { lines, lead_seconds: round3(lead), tail_seconds: round3(pending) };
}

/**
 * Estimated times at a speaking pace, before any take exists. A spoken line
 * runs its words at `wpm`; two spoken lines in a row are `gap` apart; a silent
 * line runs its own seconds.
 * → {seconds, spoken_seconds, silent_seconds, words, wpm, lines: [{id, speaker, beat, start, end}], beats: [{beat, start, end}]}
 */
export function screenplayTiming(script, { wpm = SCREENPLAY_WPM, gap = SCREENPLAY_GAP } = {}) {
  const pace = Number(wpm) > 0 ? Number(wpm) : SCREENPLAY_WPM;
  const lines = [];
  const beats = [];
  let clock = 0;
  let words = 0;
  let spokenSeconds = 0;
  let silentSeconds = 0;
  let previousSpoken = false;
  for (const line of screenplayLines(script)) {
    const spoken = isSpoken(line);
    if (spoken && !text(line.text)) continue;
    if (spoken && previousSpoken) clock += gap;
    const count = spoken ? countWords(line.text) : 0;
    const length = spoken ? count / pace * 60 : Math.max(0, Number(line.seconds) || 0);
    const entry = { id: line.id, speaker: spoken ? line.speaker : null, beat: line.beat, start: round3(clock), end: round3(clock + length) };
    lines.push(entry);
    const beat = beats.at(-1);
    if (beat && beat.index === line.beat_index) beat.end = entry.end;
    else beats.push({ index: line.beat_index, beat: line.beat, start: entry.start, end: entry.end });
    clock += length;
    words += count;
    if (spoken) spokenSeconds += length;
    else silentSeconds += length;
    previousSpoken = spoken;
  }
  return { seconds: round3(clock), spoken_seconds: round3(spokenSeconds), silent_seconds: round3(silentSeconds), words, wpm: pace, lines, beats: beats.map(({ index, ...beat }) => beat) };
}

/** Whether a character is named in a silent line's action (its id or its name, as a word). */
function actsIn(character, action) {
  return [character.id, character.name].filter((name) => typeof name === 'string' && name.trim()).some((name) => new RegExp(`(?<![\\p{L}\\p{N}])${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(action));
}

/**
 * Validate a script against the version 2 contract. A version 1 value is read
 * as all-narrator first, and the rules that only a screenplay can meet (beat
 * names, where the problem lands) are skipped for it.
 *
 * options: {duration (target seconds), wpm (the voice's measured pace; default
 *   150), gap (seconds between spoken lines; default 0.3), problemLandsSeconds
 *   (the profile's problem_lands_seconds ceiling), tolerance (default 0.15)}
 * → {ok, errors: [{id, message, fix, line?}], warnings, stats}
 *
 * Error ids: script-shape, beat-name, line-id, line-shape, silent-length,
 * speaker-unknown, character-unused, narration-mismatch, fits-length,
 * problem-missing, problem-lands. Warnings: no-duration, under-length,
 * no-problem-limit, edge-silence.
 */
export function validateScreenplay(value, options = {}) {
  const errors = [];
  const warnings = [];
  const add = (list, id, message, fix, line) => list.push(line ? { id, message, fix, line } : { id, message, fix });
  const fail = (stats = {}) => ({ ok: false, errors, warnings, stats });
  let script;
  try { script = readScreenplay(value); } catch (error) {
    add(errors, 'script-shape', `${error.message}.`, `Write SCRIPT.json as ${SCREENPLAY_VERSION}: a title, characters, and beats that each hold lines.`);
    return fail();
  }
  const narrated = script.source_version !== undefined;

  // --- Shape: characters, beats and lines.
  if (!text(script.title)) add(narrated ? warnings : errors, 'script-shape', 'The script has no title.', 'Add a short working title.');
  for (const key of ['logline', 'narration']) if (script[key] !== undefined && typeof script[key] !== 'string') add(errors, 'script-shape', `${key} must be text.`, `Write ${key} as one string.`);
  if (script.premise !== undefined && !isObject(script.premise)) add(errors, 'script-shape', 'premise must be an object ({want, obstacle, change}).', 'Write the premise as {want, obstacle, change}.');
  const characters = [];
  if (script.characters !== undefined && !Array.isArray(script.characters)) add(errors, 'script-shape', 'characters must be a list of {id, role, want, speech}.', 'List each character once, by id.');
  for (const [i, character] of (Array.isArray(script.characters) ? script.characters : []).entries()) {
    if (!isObject(character) || typeof character.id !== 'string' || !ID.test(character.id)) add(errors, 'script-shape', `characters[${i}] needs an id: lower-case letters, digits and hyphens, starting with a letter, at most 24 characters.`, 'Give the character a short id such as "maya"; the cast and the voice use the same id.');
    else if (character.id === NARRATOR) add(errors, 'script-shape', `characters[${i}].id is "narrator", which is reserved for the narrator's lines.`, 'The narrator is not a character: remove it from characters, or rename the character.');
    else if (characters.some((entry) => entry.id === character.id)) add(errors, 'script-shape', `The character id "${character.id}" is listed twice.`, 'List each character once.');
    else characters.push(character);
  }
  if (!Array.isArray(script.beats) || !script.beats.length) {
    add(errors, 'script-shape', 'The script has no beats.', 'Add beats, each {beat, lines: [...]}.');
    return fail();
  }
  const ids = new Set();
  for (const [b, beat] of script.beats.entries()) {
    const where = `beats[${b}]`;
    if (!isObject(beat) || !Array.isArray(beat.lines) || !beat.lines.length) {
      add(errors, 'script-shape', `${where} must be {beat, lines} with at least one line.`, 'Give every beat its lines, or remove the beat.');
      continue;
    }
    if (!narrated && !SCREENPLAY_BEATS.includes(beat.beat)) add(errors, 'beat-name', `${where}.beat is ${JSON.stringify(beat.beat ?? null)}; it must be one of ${SCREENPLAY_BEATS.join(', ')}.`, 'Name the beat for its job in the story: the same beats the direction map uses.');
    if (beat.place !== undefined && !text(beat.place)) add(errors, 'script-shape', `${where}.place must be a set name.`, 'Name the set the beat plays on, or leave place out.');
    for (const [l, line] of beat.lines.entries()) {
      const at = `${where}.lines[${l}]`;
      if (!isObject(line)) { add(errors, 'line-shape', `${at} must be a line object.`, 'Write a spoken line as {id, speaker, text} or a silent one as {id, speaker: null, action, seconds}.'); continue; }
      const id = typeof line.id === 'string' && line.id.trim() ? line.id.trim() : null;
      if (!id) add(errors, 'line-id', `${at} has no id.`, 'Give every line an id (l1, l2, …): the shot list points at lines by id.');
      else if (ids.has(id)) add(errors, 'line-id', `The line id "${id}" is used twice.`, 'Give every line its own id.', id);
      else ids.add(id);
      const name = id ?? at;
      if (line.speaker === null) {
        if (!text(line.action)) add(errors, 'line-shape', `Silent line ${name} has no action.`, 'Say what happens on screen in `action`, or give the line a speaker and text.', id);
        if (line.text !== undefined) add(errors, 'line-shape', `Silent line ${name} has text, but nobody speaks it.`, 'Give the line a speaker, or move the words to `action`.', id);
        if (!(typeof line.seconds === 'number' && line.seconds > 0 && line.seconds <= MAX_SILENCE_SECONDS)) add(errors, 'silent-length', `Silent line ${name} needs \`seconds\`: a length above 0 and at most ${MAX_SILENCE_SECONDS}.`, `Give the action its length in seconds (the pause a dialogue line can carry is at most ${MAX_SILENCE_SECONDS} s).`, id);
      } else if (typeof line.speaker !== 'string') {
        add(errors, 'line-shape', `Line ${name} has no speaker.`, 'Set `speaker` to a character id or "narrator"; a silent line says `speaker: null`.', id);
      } else {
        if (line.speaker !== NARRATOR && !characters.some((character) => character.id === line.speaker)) add(errors, 'speaker-unknown', `Line ${name} is spoken by "${line.speaker}", who is not in characters.`, `Use a listed character (${characters.map((character) => character.id).join(', ') || 'none listed'}) or "narrator", or add the character.`, id);
        if (!text(line.text)) add(errors, 'line-shape', `Spoken line ${name} has no text.`, 'Write the words the speaker says, or make it a silent line (speaker: null, action, seconds).', id);
        if (line.action !== undefined || line.seconds !== undefined) add(errors, 'line-shape', `Spoken line ${name} carries an action or a length; those belong to a silent line.`, 'Put the action on its own silent line. A spoken line\'s length is measured from the voice.', id);
        if (line.playing !== undefined && !text(line.playing)) add(errors, 'line-shape', `Line ${name}'s \`playing\` must be a short note.`, 'Write how the line is played (it is never spoken), or leave it out.', id);
      }
    }
  }

  const all = screenplayLines(script);
  const spoken = spokenLines(script);
  if (!spoken.length) add(errors, 'script-shape', 'Nobody speaks: the script has no spoken line.', 'Add at least one line with a speaker and text.');
  if (spoken.length > MAX_SPOKEN_LINES) add(errors, 'script-shape', `${spoken.length} spoken lines; a dialogue holds at most ${MAX_SPOKEN_LINES}.`, 'Join short lines by the same speaker.');

  // --- Every listed character speaks or acts.
  const silent = all.filter((line) => line.speaker === null);
  for (const character of characters) {
    if (spoken.some((line) => line.speaker === character.id)) continue;
    if (silent.some((line) => actsIn(character, text(line.action)))) continue;
    add(errors, 'character-unused', `"${character.id}" is listed but never speaks, and no silent line's action names them.`, 'Give the character a line or an action that names them, or remove them from characters.');
  }

  // --- A run of silent lines is one pause in the dialogue.
  let run = 0;
  let runStart = null;
  let seenSpoken = false;
  let edge = 0;
  for (const line of all) {
    if (line.speaker === null) {
      const seconds = Number(line.seconds) > 0 ? Number(line.seconds) : 0;
      if (!seenSpoken) edge += seconds;
      run += seconds;
      runStart ??= line.id;
    } else {
      if (seenSpoken && run > MAX_SILENCE_SECONDS + 1e-9) add(errors, 'silent-length', `The silent lines from ${runStart} run ${round3(run)} s between two spoken lines; a pause can be at most ${MAX_SILENCE_SECONDS} s.`, 'Shorten the actions, or put a spoken line between them.', runStart);
      seenSpoken = true;
      run = 0;
      runStart = null;
    }
  }
  if (spoken.length && (edge > 0 || run > 0)) add(warnings, 'edge-silence', `The script ${edge > 0 ? 'opens' : 'ends'}${edge > 0 && run > 0 ? ' and ends' : ''} on a silent line. The voice has no pause to hold there, so the shot list has to hold it (lead ${round3(edge)} s, tail ${round3(run)} s).`, 'Keep it if the picture carries that moment; otherwise open and close on a spoken line.');

  // --- narration is the spoken text joined in order.
  const joined = spoken.map((line) => line.text).join(' ');
  if (!narrated && script.narration !== undefined && text(script.narration) !== joined) add(errors, 'narration-mismatch', '`narration` is not the spoken lines joined in order.', 'Set narration to every spoken line\'s text, in order, joined by single spaces (actions and `playing` notes are never part of it).');

  // --- The length, at the voice's pace.
  const wpm = Number(options.wpm) > 0 ? Number(options.wpm) : SCREENPLAY_WPM;
  const timing = screenplayTiming(script, { wpm, gap: options.gap ?? SCREENPLAY_GAP });
  const duration = options.duration == null || options.duration === '' ? null : Number(options.duration);
  const tolerance = options.tolerance ?? LENGTH_TOLERANCE;
  if (duration == null) add(warnings, 'no-duration', 'No target length given, so the script\'s length was not checked.', 'Pass the target length in seconds.');
  else if (!(duration > 0)) add(errors, 'script-shape', `The target length must be a positive number of seconds; got ${options.duration}.`, 'Pass the target length in seconds.');
  else if (spoken.length) {
    const pauses = round3(timing.seconds - timing.spoken_seconds);
    if (timing.seconds > duration * (1 + tolerance)) {
      const room = Math.max(0, Math.floor((duration - pauses) * wpm / 60));
      add(errors, 'fits-length', `The script runs about ${round1(timing.seconds)} s (${timing.words} words at ${wpm} wpm, plus ${round1(pauses)} s of pauses and silent lines); the target is ${duration} s.`, `Cut to about ${room} spoken words, or shorten the silent lines.`);
    } else if (timing.seconds < duration * (1 - tolerance)) {
      add(warnings, 'under-length', `The script runs about ${round1(timing.seconds)} s; the target is ${duration} s.`, `Add about ${Math.round((duration - timing.seconds) * wpm / 60)} spoken words or a silent beat, or shorten the video.`);
    }
  }

  // --- The problem lands early enough (the profile's problem_lands_seconds).
  let problemSeconds = null;
  if (!narrated) {
    const problem = timing.beats.find((beat) => beat.beat === 'problem');
    const limit = options.problemLandsSeconds == null ? null : Number(options.problemLandsSeconds);
    if (!problem) add(errors, 'problem-missing', 'The script has no problem beat, so the problem never lands.', 'Add a beat named "problem": what stands between the lead and what they want.');
    else {
      problemSeconds = problem.start;
      if (limit == null) add(warnings, 'no-problem-limit', 'No profile limit given, so where the problem lands was not checked.', 'Pass the profile\'s problem_lands_seconds.');
      else if (problem.start > limit) add(errors, 'problem-lands', `The problem beat starts at about ${round1(problem.start)} s; it must land within ${limit} s.`, `Shorten the setup by about ${Math.ceil((problem.start - limit) * wpm / 60)} words, or open on the problem.`);
    }
  }

  const speakers = [...new Set(spoken.map((line) => line.speaker))];
  const stats = {
    version: script.source_version ?? SCREENPLAY_VERSION,
    characters: characters.map((character) => character.id),
    speakers,
    beats: script.beats.map((beat) => beat?.beat ?? null),
    lines: all.length,
    spoken_lines: spoken.length,
    silent_lines: silent.length,
    words: timing.words,
    wpm,
    estimated_seconds: timing.seconds,
    silent_seconds: timing.silent_seconds,
    duration,
    problem_seconds: problemSeconds,
    problem_limit_seconds: options.problemLandsSeconds ?? null
  };
  return { ok: errors.length === 0, errors, warnings, stats };
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

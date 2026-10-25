export const RECORDING_EDIT_VERSION = "launchclip.recording-edit.v1";
/** Cut reasons that remove spoken source words; handles and repairs must not restore them. */
export const REJECTED_SPEECH_REASONS = Object.freeze(["semantic-retake", "semantic-restart", "repeated-take", "filler", "false-start"]);
/** A word-level restart restates within a sentence, so its restatement follows closely. */
export const RESTART_GAP_SECONDS = 3;
export const RESTART_MAX_WORDS = 12;

/** Normalize timestamped Whisper and Scribe output without inventing timing. */
export function normalizeRecordingTranscript(transcript) {
  if (transcript?.segments?.some((segment) => !Array.isArray(segment.words) || !segment.words.length)) throw new Error("Every transcript segment requires word-level timestamps");
  const entries = Array.isArray(transcript) ? transcript : transcript?.words ?? transcript?.segments?.flatMap((segment) => segment.words ?? []) ?? [];
  if (!entries.length) throw new Error("Recording edit requires word-level timestamps");
  const words = [];
  for (const entry of entries) {
    if (entry.type && entry.type !== "word") continue;
    const word = String(entry.word ?? entry.text ?? "").trim();
    if (!word) continue;
    const start = entry.start;
    const end = entry.end;
    if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) throw new Error("Every spoken word requires valid start and end timestamps");
    if (end === start && Number.isFinite(start) && start >= 0) continue;
    if (words.length && start < words.at(-1).end - 0.001) throw new Error("Word timestamps must be ordered and non-overlapping");
    words.push({ word, start, end });
  }
  if (!words.length) throw new Error("Recording edit requires spoken words");
  return words;
}

/** Propose a reversible base edit; all segment source ranges refer to the original. */
export function planRecordingEdit(transcript, options = {}) {
  const words = normalizeRecordingTranscript(transcript);
  const duration = positive(options.durationSeconds, "durationSeconds");
  const trimSilence = options.silenceDuration !== null;
  const silenceDuration = trimSilence ? positive(options.silenceDuration ?? 0.8, "silenceDuration") : Infinity;
  const padding = nonnegative(options.silencePadding ?? 0.15, "silencePadding");
  const window = positive(options.retakeWindow ?? 45, "retakeWindow");
  const minimum = positive(options.minRepeatWords ?? 6, "minRepeatWords");
  const takePolicy = options.takePolicy ?? "last";
  if (!["last", "none"].includes(takePolicy)) throw new Error("takePolicy must be last or none");
  if (words.at(-1).end > duration + 0.001) throw new Error("Word timestamps exceed source duration");

  const rejected = new Set();
  const explicitCuts = [];
  const removeFillers = options.removeFillers ?? true;
  if (typeof removeFillers !== "boolean") throw new Error("removeFillers must be a boolean");
  if (removeFillers) {
    for (let index = 0; index < words.length; index++) {
      if (/^(?:um+|uh+|erm|er)$/.test(token(words[index].word))) {
        rejected.add(index);
        explicitCuts.push({ start: words[index].start, end: words[index].end, reason: "filler" });
      }
    }
    for (let index = 0; index < words.length - 1; index++) {
      // A clause comma also starts a launch: "so, but however, but whatever".
      const initial = index === 0 || /[.!?,;:][\"']?$/.test(words[index - 1].word) || words[index].start - words[index - 1].end >= 0.6;
      if (!initial || token(words[index].word) !== "but") continue;
      // A repeated initial connective abandons the first launch; a normal
      // contrast such as 'but we can ship' remains grammatical speech.
      let restart = index + 1;
      while (restart < words.length && restart <= index + 3 && (rejected.has(restart) || token(words[restart].word) === "however")) restart++;
      const repeated = restart < words.length && restart <= index + 3 && token(words[restart].word) === "but" && words[restart].start - words[index].end <= 2.5;
      const abandoned = /[.!?]$/.test(words[index].word) && words[index + 1].start - words[index].end >= 0.6;
      if (!repeated && !abandoned) continue;
      const last = repeated ? restart - 1 : index;
      for (let offset = index; offset <= last; offset++) rejected.add(offset);
      explicitCuts.push({ start: words[index].start, end: words[last].end, reason: "false-start" });
    }
  }

  // Semantic decisions use the canonical normalized word indexes, before
  // fillers or lexical retakes alter the transcript. They require no provider.
  const semanticRetakes = options.semanticRetakes ?? [];
  if (!Array.isArray(semanticRetakes)) throw new Error("semanticRetakes must be an array");
  const protectedLater = new Set();
  for (const decision of semanticRetakes) {
    for (const range of [decision?.earlier, decision?.later]) {
      if (!Number.isInteger(range?.first_word) || !Number.isInteger(range?.last_word) || range.first_word < 0 || range.last_word < range.first_word || range.last_word >= words.length) throw new Error("Semantic retake requires valid inclusive word-index ranges");
    }
    if (decision.earlier.last_word >= decision.later.first_word || decision.later_complete !== true || typeof decision.explanation !== "string" || !decision.explanation.trim()) throw new Error("Semantic retake requires an earlier range and a complete explained later take");
    if (words[decision.later.first_word].start - words[decision.earlier.last_word].end > window) throw new Error("Semantic retake exceeds retakeWindow");
  }
  for (const decision of semanticRetakes) {
    const chained = semanticRetakes.some((next) => next.earlier.first_word === decision.later.first_word && next.earlier.last_word === decision.later.last_word);
    if (!chained) for (let index = decision.later.first_word; index <= decision.later.last_word; index++) protectedLater.add(index);
  }
  for (const decision of semanticRetakes) {
    const { first_word: first, last_word: last } = decision.earlier;
    for (let index = first; index <= last; index++) {
      if (protectedLater.has(index)) throw new Error("Semantic retake decisions conflict with a retained later take");
      rejected.add(index);
    }
    explicitCuts.push({ start: words[first].start, end: words[last].end, reason: "semantic-retake" });
  }

  // Word-level restarts inside a sentence use the same original indexes. They
  // may clean a retained semantic take, but never remove their own restatement.
  const semanticRestarts = options.semanticRestarts ?? [];
  if (!Array.isArray(semanticRestarts)) throw new Error("semanticRestarts must be an array");
  const restatements = new Set();
  for (const decision of semanticRestarts) {
    checkRestart(decision, words);
    for (let index = decision.later.first_word; index <= decision.later.last_word; index++) restatements.add(index);
  }
  for (const decision of semanticRestarts) {
    const { first_word: first, last_word: last } = decision.earlier;
    for (let index = first; index <= last; index++) {
      if (restatements.has(index)) throw new Error("Semantic restart decisions conflict with a retained restatement");
      rejected.add(index);
    }
    explicitCuts.push({ start: words[first].start, end: words[last].end, reason: "semantic-restart" });
  }
  for (const index of restatements) protectedLater.add(index);

  // Lexical in-sentence restarts: a short exact run (fewer than minRepeatWords)
  // immediately restated word for word, with the restatement continuing.
  if (takePolicy === "last") {
    const sentenceEnd = (index) => /[.!?]["']?$/.test(words[index].word);
    for (let index = 0; index < words.length; index++) {
      for (let size = Math.min(5, Math.floor(minimum) - 1); size >= 2; size--) {
        const next = index + 2 * size;
        if (next >= words.length) continue;
        const span = Array.from({ length: 2 * size }, (_, offset) => index + offset);
        // A restatement may itself restart; the final copy always survives.
        if (span.some((position) => rejected.has(position))) continue;
        const earlier = span.slice(0, size).map((position) => token(words[position].word));
        const later = span.slice(size).map((position) => token(words[position].word));
        if (earlier.some((value) => !value) || new Set(earlier).size < 2 || earlier.some((value, offset) => value !== later[offset])) continue;
        // The abandoned run sits inside one sentence, and the restatement goes on.
        if (span.slice(0, size).some(sentenceEnd) || span.slice(1, size).some((position) => words[position].start - words[position - 1].end >= 0.6)) continue;
        if (words[index + size].start - words[index + size - 1].end > 2 || sentenceEnd(next - 1) || words[next].start - words[next - 1].end >= 0.6) continue;
        for (let position = index; position < index + size; position++) rejected.add(position);
        explicitCuts.push({ start: words[index].start, end: words[index + size - 1].end, reason: "false-start" });
        index += size - 1;
        break;
      }
    }
  }

  const phrases = [];
  let begin = 0;
  for (let index = 0; index < words.length; index++) {
    if (index === words.length - 1 || /[.!?][\"']?$/.test(words[index].word) || words[index + 1].start - words[index].end >= 0.6) {
      phrases.push({ first: begin, last: index, tokens: words.slice(begin, index + 1).filter((_, offset) => !rejected.has(begin + offset)).map((word) => token(word.word)).filter(Boolean) });
      begin = index + 1;
    }
  }
  const retakes = [];
  if (takePolicy === "last") {
    for (let earlier = 0; earlier < phrases.length; earlier++) {
      const left = phrases[earlier];
      if (left.tokens.length < Math.min(4, minimum) || Array.from({ length: left.last - left.first + 1 }, (_, offset) => left.first + offset).some((index) => protectedLater.has(index))) continue;
      for (let later = earlier + 1; later < phrases.length; later++) {
        const right = phrases[later];
        if (words[right.first].start - words[left.last].end > window) break;
        let match = false;
        for (let span = 1; span <= 3 && later + span <= phrases.length; span++) {
          const targetPhrases = phrases.slice(later, later + span);
          if (targetPhrases.some((phrase) => words[phrase.first].start - words[left.last].end > window)) break;
          const target = targetPhrases.flatMap((phrase) => phrase.tokens);
          if (target.length >= left.tokens.length * 0.75 && isRetake(left.tokens, target, minimum)) { match = true; break; }
        }
        if (!match) continue;
        for (let index = left.first; index <= left.last; index++) rejected.add(index);
        retakes.push({ start: words[left.first].start, end: words[left.last].end });
        break;
      }
    }
  }
  const selected = words.filter((_, index) => !rejected.has(index));
  if (!selected.length) throw new Error("Recording edit contains no retained speech");
  const cuts = [];
  for (const cut of [...retakes.map((range) => ({ ...range, reason: "repeated-take" })), ...explicitCuts].sort((left, right) => left.start - right.start)) {
    const prior = cuts.at(-1);
    if (prior && cut.start <= prior.end) {
      prior.end = Math.max(prior.end, cut.end);
      if (cutPriority(cut.reason) > cutPriority(prior.reason)) prior.reason = cut.reason;
    } else cuts.push({ ...cut });
  }
  const groups = [];
  for (const word of selected) {
    const previous = groups.at(-1);
    const crossesRetake = previous && cuts.some((retake) => retake.start >= previous.end && retake.end <= word.start);
    if (previous && !crossesRetake && word.start - previous.end < silenceDuration) previous.end = word.end;
    else groups.push({ start: word.start, end: word.end });
  }
  const ranges = groups.map((group) => ({ start: Math.max(0, group.start - padding), end: Math.min(duration, group.end + padding) }));
  if (!trimSilence) {
    for (let index = 0; index < ranges.length; index++) {
      ranges[index].start = index === 0 ? 0 : ranges[index - 1].end;
      const nextRetake = cuts.find((retake) => retake.start > groups[index].end);
      ranges[index].end = nextRetake?.start ?? duration;
      const precedingRetake = cuts.filter((retake) => retake.end <= groups[index].start).at(-1);
      if (precedingRetake) ranges[index].start = Math.max(ranges[index].start, precedingRetake.end);
    }
  }
  // Never expand speech handles into a rejected spoken take.
  for (const range of ranges) {
    for (const retake of cuts) {
      if (retake.end <= range.start + padding && retake.end > range.start) range.start = retake.end;
      if (retake.start >= range.end - padding && retake.start < range.end) range.end = retake.start;
    }
  }
  const merged = [];
  for (const range of ranges) {
    const prior = merged.at(-1);
    if (prior && range.start <= prior.end) prior.end = Math.max(prior.end, range.end);
    else merged.push({ ...range });
  }
  let clock = 0;
  const kept_segments = merged.map((range) => {
    const segment = { source_start_seconds: range.start, source_end_seconds: range.end, start_seconds: clock, end_seconds: clock + range.end - range.start };
    clock = segment.end_seconds;
    return segment;
  });
  const removed_segments = [];
  let cursor = 0;
  for (const segment of [...kept_segments, { source_start_seconds: duration, source_end_seconds: duration }]) {
    if (segment.source_start_seconds > cursor + 0.000001) {
      const causes = cuts.filter((cut) => cut.start < segment.source_start_seconds && cut.end > cursor);
      const reason = causes.sort((left, right) => cutPriority(right.reason) - cutPriority(left.reason))[0]?.reason ?? "silence";
      removed_segments.push({ source_start_seconds: cursor, source_end_seconds: segment.source_start_seconds, reason });
    }
    cursor = segment.source_end_seconds;
  }
  const remapped = selected.map((word) => {
    const segment = kept_segments.find((range) => word.start >= range.source_start_seconds - 0.001 && word.end <= range.source_end_seconds + 0.001);
    if (!segment) throw new Error("Edit plan cut through a spoken word");
    const offset = segment.start_seconds - segment.source_start_seconds;
    return { word: word.word, start: word.start + offset, end: word.end + offset };
  });
  return { schema_version: RECORDING_EDIT_VERSION, source_duration_seconds: duration, duration_seconds: clock, kept_segments, removed_segments, words: remapped, text: remapped.map((word) => word.word).join(" ") };
}

function cutPriority(reason) { return { "semantic-retake": 5, "semantic-restart": 4, "repeated-take": 3, "false-start": 2, filler: 1 }[reason] ?? 0; }
/** Structural rules shared with semantic validation; semantic judgement stays with the decision. */
export function checkRestart(decision, words) {
  for (const range of [decision?.earlier, decision?.later]) {
    if (!Number.isInteger(range?.first_word) || !Number.isInteger(range?.last_word) || range.first_word < 0 || range.last_word < range.first_word || range.last_word >= words.length) throw new Error("Semantic restart requires valid inclusive word-index ranges");
  }
  const { earlier, later } = decision;
  if (earlier.last_word >= later.first_word) throw new Error("Semantic restart must keep a strictly later restatement");
  if (decision.later_complete !== true || typeof decision.explanation !== "string" || !decision.explanation.trim()) throw new Error("Semantic restart requires a complete explained restatement");
  const earlierCount = earlier.last_word - earlier.first_word + 1;
  if (earlierCount > RESTART_MAX_WORDS) throw new Error(`Semantic restart covers more than ${RESTART_MAX_WORDS} words; use a passage retake`);
  if (later.last_word - later.first_word < 1) throw new Error("Semantic restart restatement needs at least two words");
  for (let index = earlier.last_word + 1; index < later.first_word; index++) {
    if (!/^(?:um+|uh+|erm|er)$/.test(token(words[index].word))) throw new Error("Semantic restart must be followed immediately by its restatement");
  }
  if (words[later.first_word].start - words[earlier.last_word].end > RESTART_GAP_SECONDS) throw new Error("Semantic restart restatement is not within the sentence restart window");
}
function token(word) { return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""); }
function isRetake(left, right, minimum) {
  // Require an anchored passage, not a few common words scattered in two lines.
  let prefix = 0;
  while (prefix < Math.min(left.length, right.length) && left[prefix] === right[prefix]) prefix++;
  const compared = right.slice(0, left.length);
  const similarity = 1 - distance(left, compared) / Math.max(left.length, compared.length);
  const exact = left.length === right.length && prefix === left.length && left.length >= Math.min(4, minimum) && new Set(left).size >= 4;
  const substantial = left.length >= Math.max(8, minimum) && right.length >= minimum && similarity >= 0.7 && Math.min(left.length, right.length) / Math.max(left.length, right.length) >= 0.75;
  return exact || substantial || (left.length < right.length && prefix >= Math.min(4, minimum) && prefix >= left.length * 0.8) || (prefix >= minimum && prefix >= left.length * 0.8) || (prefix >= 3 && similarity >= 0.8 && Math.min(left.length, right.length) / Math.max(left.length, right.length) >= 0.75);
}
function distance(left, right) {
  let prior = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < right.length; j++) next.push(Math.min(next[j] + 1, prior[j + 1] + 1, prior[j] + (left[i] === right[j] ? 0 : 1)));
    prior = next;
  }
  return prior.at(-1);
}
function positive(value, label) { if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive number`); return value; }
function nonnegative(value, label) { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a nonnegative number`); return value; }

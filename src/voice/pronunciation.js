// Pronunciation: respell terms in the text a voice provider speaks, never in
// the captions. A map { "term": "say-as" } (pronunciation.json in --assets,
// or audio.narration.pronunciation) rewrites whole words, case-insensitively,
// keeping the punctuation around them: { "SQL": "sequel", "AWS": "A W S" }.
// The take's word timings come back for the spoken words, so they are folded
// back onto the script's own words before captions or anchors see them.
import { alignWordsToText, normalizeWord, tokenizeText } from "./words.js";

/** Throws unless map is {term: say-as} with non-empty strings. Returns a clean copy. */
export function normalizePronunciation(map, label = "pronunciation") {
  if (map === undefined || map === null) return null;
  if (typeof map !== "object" || Array.isArray(map)) throw new Error(`${label} must be an object of { "term": "say-as" }`);
  const clean = {};
  for (const [term, say] of Object.entries(map)) {
    if (!normalizeWord(term)) throw new Error(`${label}: "${term}" has no letters or digits to match`);
    if (typeof say !== "string" || !tokenizeText(say).length) throw new Error(`${label}["${term}"] must be a non-empty string to say instead`);
    clean[term] = say;
  }
  return Object.keys(clean).length ? clean : null;
}

/**
 * The text to speak and how its words group back onto the script's words.
 * → {text, groups: [{tokens: n script tokens, spoken: m spoken tokens}]}
 */
export function applyPronunciation(text, map) {
  const tokens = tokenizeText(text);
  const terms = Object.entries(map ?? {})
    .map(([term, say]) => ({ words: tokenizeText(term).map(normalizeWord), say }))
    .filter((term) => term.words.length)
    .sort((a, b) => b.words.length - a.words.length);
  const spoken = [];
  const groups = [];
  for (let index = 0; index < tokens.length;) {
    const term = terms.find((candidate) => candidate.words.every((word, offset) => normalizeWord(tokens[index + offset]) === word));
    if (!term) {
      spoken.push(tokens[index]);
      groups.push({ tokens: 1, spoken: 1 });
      index += 1;
      continue;
    }
    const first = tokens[index];
    const last = tokens[index + term.words.length - 1];
    const lead = first.match(/^[^\p{L}\p{N}]*/u)[0];
    const trail = last.match(/[^\p{L}\p{N}]*$/u)[0];
    const said = tokenizeText(term.say);
    said[0] = lead + said[0];
    said[said.length - 1] += trail;
    spoken.push(...said);
    groups.push({ tokens: term.words.length, spoken: said.length });
    index += term.words.length;
  }
  return { text: spoken.join(" "), groups };
}

/**
 * Word timings of the spoken text → timings of the script's words: a
 * respelled term spans its spoken words. When the take's words do not match
 * the spoken text one-to-one, they are aligned to the script by edit distance.
 */
export function restoreWords(words, text, { groups }) {
  const tokens = tokenizeText(text);
  const expected = groups.reduce((sum, group) => sum + group.spoken, 0);
  if (words.length !== expected) return alignWordsToText(words, text);
  const restored = [];
  let tokenIndex = 0;
  let wordIndex = 0;
  for (const group of groups) {
    const spoken = words.slice(wordIndex, wordIndex + group.spoken);
    if (group.tokens === 1) {
      // Said as several words: their phonemes join, with the pauses between them as rests (`_`).
      const { phonemes: _first, ...head } = spoken[0];
      const phonemes = spoken.every((word) => word.phonemes) ? spoken.map((word, i) => (i ? `_:${Math.max(0, Math.round((word.start - spoken[i - 1].end) * 1000))} ` : "") + word.phonemes).join(" ") : null;
      restored.push({ ...head, text: tokens[tokenIndex], end: spoken.at(-1).end, ...(phonemes ? { phonemes } : {}) });
    } else {
      // A multi-word term said as m words: share its span out by word.
      const start = spoken[0].start;
      const end = spoken.at(-1).end;
      const step = (end - start) / group.tokens;
      for (let i = 0; i < group.tokens; i++) restored.push({ text: tokens[tokenIndex + i], start: round3(start + i * step), end: round3(i === group.tokens - 1 ? end : start + (i + 1) * step) });
    }
    tokenIndex += group.tokens;
    wordIndex += group.spoken;
  }
  return restored;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

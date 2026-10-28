// Script checks: lint a voiceover script before anything renders. Pure and
// deterministic (no I/O, no model), so `launchclip script check`, the make
// script pass and the tests all run the same rules.
//
//   checkScript({narration, duration?, brief?, format?, goal?, awareness?, cta?, product?, audience?, limits?})
//   → {schema_version, ok, errors: [{id, message, fix, span?}], warnings: [...], stats}
//
// The split follows the research report (reports/"Video scriptwriting methods
// for LaunchClip.md", "The proposed check list"): hard checks are reserved for
// arithmetic (the clock), integrity (every figure, quote, rating and deadline
// traces to the brief) and the rules every source agrees on (opener, one CTA,
// a sentence a voice can breathe through). Everything else is a warning, and
// every threshold marked "derived" is a LaunchClip proposal, not a sourced
// figure.
//
// Errors (ok is false when any is present):
//   fits-clock        words > duration × 2.75 (the script cannot physically fit)
//   fact-trace        a number, percentage, money amount or multiple not in the brief
//   testimonial       a quote or customer attribution not in the brief
//   placeholder       "Jane Doe", "lorem ipsum", "[name]", "TBD" and friends
//   social-proof      "trusted by", ratings, "#1", "award-winning" with no support
//   urgency           "only 3 left", "ends Friday", "today only" with no deadline in the brief
//   opener-filler     the first sentence opens with a greeting or filler
//   opener-length     the first sentence is longer than the hook budget
//   cta-missing / cta-multiple / cta-early / cta-mismatch
//   sentence-length   a sentence over 25 words
// Warnings:
//   mean-sentence, reading-grade, additive-transitions, brand-first,
//   superlative, numbers-per-sentence, number-precision, hook-payoff,
//   wpm-band, no-brief, no-duration
//
// Fact-trace policy for small numbers: a bare count of ten or less with no
// unit ("two steps", "3 ways", "one place") is phrasing, not a claim, and is
// not traced. It is traced when a unit makes it a claim: a percentage, a
// multiple ("3x", "three times", "twice"), money, or a measure noun ("3
// clicks", "five minutes", "two customers"). Every number above ten is
// traced. Ordinals are never traced. Matching is by value: "40 per cent" =
// "40%", "three times" = "3x", "ten thousand" = "10k" = "10,000"; a brief value
// rounds to the spoken precision (43.7% supports "44 per cent"); a hedge
// ("about", "nearly") allows 10%, "over"/"more than" needs a brief value at
// least as large; "4 in 10" is a ratio that a brief percentage within five
// points supports.

import { AWARENESS_LEVELS, MAX_WORDS_PER_SECOND, SCRIPT_FORMAT_IDS, SCRIPT_FORMATS as FORMAT_SPECS, SCRIPT_GOALS } from "@launchclip/core/script-formats.mjs";

export const SCRIPT_CHECK_VERSION = "launchclip.script-check.v1";
// The format, goal and awareness ids are the planning pass's own (kit/core/script-formats.mjs).
export { SCRIPT_GOALS, AWARENESS_LEVELS };
export const SCRIPT_FORMATS = SCRIPT_FORMAT_IDS;

// Hard ceiling: 2.75 words a second (165 wpm) cannot be read in the time.
export const WORDS_PER_SECOND_CEILING = MAX_WORDS_PER_SECOND;
// Narration-rate bands per format (derived from the report's WPM budget table:
// dense data ~135, default ~150, energetic short-form ~165; flag below ~130).
export const WPM_BANDS = Object.freeze({
  "data-explainer": Object.freeze([125, 145]),
  explainer: Object.freeze([130, 160]),
  // A story narrates over only part of its runtime (the planning pass's coverage), so its floor is lower.
  story: Object.freeze([Math.floor(125 * (FORMAT_SPECS.story.coverage ?? 1)), 160]),
  "long-form": Object.freeze([135, 165]),
  "short-form": Object.freeze([140, 165]),
  promo: Object.freeze([140, 165])
});
// Hook (first sentence) budget in words, and the mean sentence budget.
export const HOOK_WORDS = Object.freeze({ "short-form": 12, promo: 12, explainer: 12, "data-explainer": 12, story: 15, "long-form": 15 });
export const MEAN_SENTENCE_WORDS = Object.freeze({ "short-form": 10, promo: 15, explainer: 15, "data-explainer": 15, story: 15, "long-form": 15 });
export const SENTENCE_MAX_WORDS = 25;
// CTAs belong in the final quarter (long-form may add one soft CTA after 15%).
export const CTA_FINAL_SHARE = 0.25;
export const GRADE_LIMITS = Object.freeze({ consumer: 7, b2b: 9 });

const SMALL_COUNT = 10;
const MEASURE_NOUNS = /^(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|clicks?|taps?|customers?|users?|teams?|companies|company|businesses|people|developers?|devs?|engineers?|stars?|reviews?|ratings?|downloads?|installs?|members?|subscribers?|followers?|countries|languages|integrations?|seats?|spots?|lines?)$/i;
const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES = { hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
const SUFFIX_SCALES = { k: 1e3, m: 1e6, mn: 1e6, b: 1e9, bn: 1e9, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12, hundred: 100 };
const HEDGE_ABOUT = /\b(?:about|around|nearly|almost|roughly|approximately|close to|some|~)\s*$/i;
const HEDGE_OVER = /\b(?:over|more than|above|upwards of|at least|north of)\s*$/i;
const HEDGE_UNDER = /\b(?:under|less than|below|up to|at most|fewer than)\s*$/i;

const OPENER_FILLER = /^(?:hi|hello|hey|hiya|howdy|yo|what'?s up|welcome(?: back)?|good (?:morning|afternoon|evening)|greetings|ladies and gentlemen|in (?:this|today'?s) (?:video|episode|clip|tutorial)|today,? (?:we|i)(?:'re| are|'m| am|'ll| will) (?:going to|gonna|talk|look|show|cover)|so,|okay,|ok,|alright,|all right,|um+\b|uh+\b|let'?s (?:get started|dive in|jump in|talk about)|before we (?:start|begin|get started)|my name is|don'?t forget to)(?![a-z])/i;

// CTA verb classes: one class is one action. A verb counts only in imperative
// position (the clause start, or after "just", "so", "now", "then", "please",
// "and", "or"). Ambiguous verbs ("try", "click", "download", "order") also
// need a CTA signal after them (free, today, a link, a domain, the product)
// unless they sit in the last sentence, so "Then click Export" in a tutorial
// is not a call to action.
const CTA_CLASSES = [
  ["sign-up", /(?:sign up|signup|register|create (?:an|your) (?:free )?account|get started|start (?:your |a )?(?:free )?trial|start (?:for free|free))\b/i, false],
  ["sign-up", /(?:try|join|start)\b/i, true],
  ["install", /(?:get the app|add (?:it )?to (?:chrome|slack|your browser))\b/i, false],
  ["install", /(?:download|install)\b/i, true],
  ["visit", /(?:learn more|find out more|see more at)\b/i, false],
  ["visit", /(?:visit|head (?:over )?to|go to|check out|click|tap|open)\b/i, true],
  ["follow", /(?:follow (?:us|me|for more)|subscribe|hit (?:the )?(?:subscribe|like|bell|follow)|turn on notifications)\b/i, false],
  ["book", /(?:book (?:a|an|your) (?:free )?(?:demo|call|meeting|consultation|session|seat|spot)|request (?:a demo|access|an invite|early access)|schedule (?:a|your) (?:demo|call))\b/i, false],
  ["buy", /(?:buy|order|shop|pre-?order|grab (?:yours|one|it)|claim (?:yours|your|it)|get (?:yours|it|access|early access|\d+%? off))\b/i, true],
  ["comment", /(?:drop a comment|comment below|let me know in the comments|tell me in the comments)\b/i, false]
];
const CTA_PHRASES = [
  ["visit", /\blinks? in (?:the |my |our )?(?:bio|description)\b|\blinks? below\b|\bin the description\b/i],
  ["follow", /\blike and subscribe\b/i]
];
const CTA_SIGNAL = /\b(?:free|today|tonight|it out|trial|waitlist|link|bio|description|below|app store|play store|early access|us|[a-z0-9-]+\.(?:com|io|ai|app|dev|co|org|net|so|xyz|tv|gg|me|sh|tools?))\b/i;
const CTA_LEAD = /(?:^|[,;:—–]\s*|\b(?:just|so|now|then|please|and|or|today,?)\s+)$/i;
const DOMAIN = /\b[a-z0-9-]+\.(?:com|io|ai|app|dev|co|org|net|so|xyz|tv|gg|me|sh|tools?)\b(?:\/\S*)?/i;

const SOCIAL_PROOF = [
  // The brief must use the same verb: "used by" does not support "loved by".
  ["trusted", /\b(trusted|loved|used|chosen|relied on|backed|adopted) by\b/i, (found) => new RegExp(`\\b${found[1]} by\\b`, "i")],
  ["join", /\bjoin(?:ing)? (?:over |more than |the )?(?:\d[\d,.]*\s*\w*|thousands|hundreds|millions)\b/i, /\b(?:join|users|customers|teams|members)\b/i],
  ["rating", /\b(?:rated|\d(?:\.\d)?[- ]stars?|(?:four|five)[- ]stars?|star ratings?|\d(?:\.\d)? out of (?:5|five|10|ten))\b/i, /\b(?:rated|rating|stars?)\b/i],
  ["number-one", /(?:#\s?1\b|\bnumber one\b|\bno\. ?1\b)/i, /(?:#\s?1\b|\bnumber one\b|\bno\. ?1\b)/i],
  ["award", /\b(?:award[- ]winning|best[- ]selling|top[- ]rated|editor'?s choice|product of the (?:day|week|year))\b/i, /\b(?:award|best[- ]selling|top[- ]rated|editor'?s choice|product of the)\b/i],
  ["crowd", /\b(?:hundreds|thousands|millions) of (?:\w+ )?(?:users|customers|teams|companies|people|developers|businesses|creators|founders|members)\b/i, /\b(?:hundreds|thousands|millions)\b/i],
  ["reviews", /\b(?:rave reviews|\d[\d,]* reviews|five[- ]star reviews|reviews? (?:say|call|agree))\b/i, /\breviews?\b/i]
];
const URGENCY = /\b(?:only \w+ (?:left|remaining|spots?|seats?|places?|copies)|limited[- ]time|limited (?:spots|seats|places|offer|availability|stock)|(?:ends|ending|closes|expires?|goes away) (?:today|tonight|tomorrow|soon|this week|this month|at midnight|on \w+|(?:mon|tues|wednes|thurs|fri|satur|sun)day)|today only|this week only|last chance|while (?:supplies|stocks?) lasts?|hurry|don'?t miss (?:out|it)|selling (?:out|fast)|before it'?s gone|(?:for|in) the next \w+ (?:hours?|days?)|before (?:midnight|(?:mon|tues|wednes|thurs|fri|satur|sun)day)|now or never|act (?:now|fast)|spots are filling)\b/i;
// A real deadline or limit: a date, a weekday, or the words that state one
// ("may" is left out of the months; it is usually the verb).
const URGENCY_SUPPORT = /\b(?:deadline|until|expires?|expiry|limited|last day|(?:offer|sale|pricing|discount) ends|ends (?:on|at|in)|early[- ]bird|only \d+|first \d+|\d+ (?:spots|seats|places|copies)|(?:mon|tues|wednes|thurs|fri|satur|sun)day|january|february|march|april|june|july|august|september|october|november|december|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2})\b/i;
const PLACEHOLDER = /\b(?:jane doe|john doe|john smith|lorem ipsum|customer name|company name|product name|your name here|acme (?:corp|inc)|tbd|tbc)\b|\[[^\]]*\]|\{\{|<[a-z ]+>/i;
const TESTIMONIAL_CUE = /\b(?:as (?:one|a|our) (?:customer|user|client|founder|reviewer)|(?:customers?|users?|clients?|reviewers?) (?:say|says|said|tell us|told us|call it|rave|describe it|write)|in (?:their|her|his) (?:own )?words|one (?:customer|user|client|founder) (?:said|says|told us|put it|wrote)|according to (?:one|a|our) (?:customer|user|client))\b/i;
const SUPERLATIVE = /\b(?:revolutionary|revolutioni[sz]e|game[- ]chang(?:ing|er)|seamless(?:ly)?|the best(?! part)|best[- ]in[- ]class|ultimate|world[- ]class|cutting[- ]edge|next[- ]gen(?:eration)?|unparalleled|unmatched|groundbreaking|state[- ]of[- ]the[- ]art|effortless(?:ly)?|magical|incredible|unbelievable)\b/i;
const MECHANISM = /\b(?:because|by \w+ing|thanks to|using|via|which means|so (?:you|your)|that means|it (?:reads|checks|matches|syncs|runs|pulls|turns|sends|watches))\b/i;
const ADDITIVE_START = /^(?:and then|and|also|plus|additionally|moreover|furthermore|in addition|on top of that|as well)\b/i;
const B2B = /\b(?:b2b|saas|enterprise|api|apis|sdk|developers?|engineers?|devops|crm|erp|cfo|cto|ceo|finance teams?|ops teams?|compliance|soc ?2|integrations?|workflows?|stakeholders?|procurement|invoices?|payouts?|reconcil\w*|b2c)\b/i;
const STOPWORDS = new Set("the a an and or but so of to in on for with at by from is are was were be been it its it's this that these those you your we our they their i my me he she his her them us what why how when where who which do does did can could will would should not no yes than then there here just very really all any more most some such into out up about over only also as if have has had get got make made".split(" "));
const ABBREVIATIONS = /(?:\b(?:e\.g|i\.e|vs|etc|mr|mrs|ms|dr|st|inc|ltd|co|u\.s|approx)|(?:^|[\s(])[a-z])\.$/i;

/**
 * Lint a voiceover script. Throws on an unknown format, goal, awareness or
 * audience (the message lists the valid ids) and on empty narration.
 */
export function checkScript(input = {}) {
  const narration = String(input.narration ?? "").replace(/\s+/g, " ").trim();
  if (!narration) throw new Error("checkScript needs narration text");
  const duration = input.duration == null || input.duration === "" ? null : Number(input.duration);
  if (duration != null && !(duration > 0)) throw new Error(`duration must be a positive number of seconds; got ${input.duration}`);
  const goal = oneOf(input.goal, SCRIPT_GOALS, "goal");
  const awareness = oneOf(input.awareness, AWARENESS_LEVELS, "awareness");
  const explicitFormat = oneOf(input.format, SCRIPT_FORMATS, "format");
  const format = explicitFormat ?? defaultFormat(duration);
  const limits = input.limits ?? {};
  const briefText = input.brief == null ? null : briefToText(input.brief);
  const audienceIn = oneOf(input.audience, ["consumer", "b2b"], "audience");
  const audience = audienceIn ?? (briefText && B2B.test(briefText) ? "b2b" : "consumer");

  const sentences = splitSentences(narration);
  const words = countWords(narration);
  const errors = [];
  const warnings = [];
  const add = (list, id, message, fix, span) => list.push(span ? { id, message, fix, span } : { id, message, fix });
  const spanOf = (sentence) => ({ start: sentence.start, end: sentence.end, sentence: sentence.index, text: sentence.text });

  // --- The clock (hard) and the rate band (soft).
  const ceiling = duration ? Math.floor(duration * (limits.wordsPerSecond ?? WORDS_PER_SECOND_CEILING)) : null;
  const wpm = duration ? Math.round(words / duration * 60) : null;
  const band = WPM_BANDS[format];
  if (duration == null) {
    add(warnings, "no-duration", "No duration given, so the clock and the narration rate were not checked.", "Pass --duration <seconds> (the target length).");
  } else {
    if (words > ceiling) add(errors, "fits-clock", `${words} words cannot be read in ${duration}s: the ceiling is ${ceiling} (${WORDS_PER_SECOND_CEILING} words a second).`, `Cut to about ${Math.round(duration * (band[0] + band[1]) / 2 / 60)} words (${format} reads at ${band[0]}–${band[1]} wpm).`);
    else if (wpm < band[0] || wpm > band[1]) add(warnings, "wpm-band", `${wpm} wpm is outside the ${format} band (${band[0]}–${band[1]} wpm, derived).`, wpm < band[0] ? `Add about ${Math.round(duration * band[0] / 60) - words} words, or shorten the video.` : `Cut about ${words - Math.round(duration * band[1] / 60)} words.`);
  }

  // --- Integrity (hard): figures, quotes, social proof, urgency, placeholders.
  const claims = numberClaims(narration);
  const traced = claims.filter((claim) => !claim.trivial);
  if (briefText == null) {
    add(warnings, "no-brief", "No brief given, so figures, quotes, ratings and deadlines were not traced.", "Pass --brief <file> (the prompt, notes and transcripts the script was written from).");
  } else {
    const supply = numberClaims(briefText);
    for (const claim of traced) {
      if (supported(claim, supply)) continue;
      const sentence = sentenceAt(sentences, claim.start);
      add(errors, "fact-trace", `"${claim.text}" is not in the brief.`, "Use only figures given in the prompt, notes, assets or transcripts; cut the number or add its source to the brief.", { start: claim.start, end: claim.end, sentence: sentence.index, text: claim.text });
    }
    const briefNorm = normalise(briefText);
    for (const match of narration.matchAll(/[“"]([^”"]+)[”"]/g)) {
      if (countWords(match[1]) < 3) continue;
      if (briefNorm.includes(normalise(match[1]))) continue;
      add(errors, "testimonial", `The quote "${match[1].trim()}" is not in the brief.`, "Quote only words the brief quotes (FTC rule on fake testimonials); otherwise paraphrase without quotation marks and attribution.", { start: match.index, end: match.index + match[0].length, sentence: sentenceAt(sentences, match.index).index, text: match[0] });
    }
    for (const sentence of sentences) {
      // A quoted sentence is judged by its quote (above), not its attribution.
      if (TESTIMONIAL_CUE.test(sentence.text) && !/[“"][^”"]+[”"]/.test(sentence.text) && contentCoverage(sentence.text, briefText) < 0.6) {
        add(errors, "testimonial", `"${sentence.text}" attributes words to a customer the brief does not quote.`, "Use a testimonial only when the brief supplies it, word for word, with who said it.", spanOf(sentence));
      }
      for (const [kind, pattern, head] of SOCIAL_PROOF) {
        const found = pattern.exec(sentence.text);
        if (!found) continue;
        if (kind === "crowd" && supply.some((item) => item.value >= crowdScale(found[0]))) continue;
        if ((typeof head === "function" ? head(found) : head).test(briefText) || clauseSupported(sentence.text.slice(found.index), sentence.index === 0 ? found.index : -1, briefText, supply)) continue;
        add(errors, "social-proof", `"${found[0]}" (${kind}) has no support in the brief.`, "Claim users, ratings, rankings or awards only when the brief states them; otherwise show the product doing the work.", spanOf(sentence));
        break;
      }
      const urgent = URGENCY.exec(sentence.text);
      if (urgent && !URGENCY_SUPPORT.test(briefText)) {
        add(errors, "urgency", `"${urgent[0]}" implies a deadline or limit the brief does not give.`, "Use urgency or scarcity only for a real deadline or limit stated in the brief; otherwise drop it.", spanOf(sentence));
      }
    }
  }
  const placeholder = PLACEHOLDER.exec(narration);
  if (placeholder) add(errors, "placeholder", `"${placeholder[0]}" is a placeholder.`, "Replace it with a real name or fact from the brief, or cut it: placeholders ship by accident.", { start: placeholder.index, end: placeholder.index + placeholder[0].length, sentence: sentenceAt(sentences, placeholder.index).index, text: placeholder[0] });

  // --- The opener (hard).
  const hook = sentences[0];
  const hookWords = countWords(hook.text);
  const hookMax = limits.hookWords ?? HOOK_WORDS[format];
  const filler = OPENER_FILLER.exec(hook.text.replace(/^["“'(]+/, ""));
  if (filler) add(errors, "opener-filler", `The first sentence opens with "${filler[0].trim()}".`, "Open on the hook itself: a sharp claim, the problem, or a question the viewer wants answered.", spanOf(hook));
  if (hookWords > hookMax) add(errors, "opener-length", `The first sentence is ${hookWords} words; the ${format} hook budget is ${hookMax}.`, `Cut the hook to ${hookMax} words or fewer; move the detail to the next sentence.`, spanOf(hook));

  // --- Sentences (hard cap; soft mean).
  const sentenceMax = limits.sentenceWords ?? SENTENCE_MAX_WORDS;
  for (const sentence of sentences) {
    const count = countWords(sentence.text);
    if (count > sentenceMax) add(errors, "sentence-length", `Sentence ${sentence.index + 1} is ${count} words; the limit is ${sentenceMax}.`, "Split it: one idea per sentence, short enough for the voice to breathe and the captions to chunk.", spanOf(sentence));
  }
  const meanWords = round1(words / sentences.length);
  const meanMax = limits.meanSentenceWords ?? MEAN_SENTENCE_WORDS[format];
  if (meanWords > meanMax) add(warnings, "mean-sentence", `Sentences average ${meanWords} words; the ${format} budget is ${meanMax}.`, "Split the longest sentences; each should carry one idea and own one scene.");

  // --- CTA (hard).
  const ctas = findCtas(sentences, words, input.product);
  const classes = [...new Set(ctas.map((cta) => cta.class))];
  const longForm = format === "long-form";
  if (!ctas.length) {
    add(errors, "cta-missing", "No call to action found.", "End with one clear imperative: \"Try <product> free\", \"Download it today\", \"Book a demo at <site>\".");
  } else {
    const destinations = new Set(ctas.map((cta) => cta.destination).filter(Boolean));
    const softPair = longForm && ctas.length === 2 && (classes.length === 1 || destinations.size === 1);
    if (classes.length > 1 && !softPair) {
      add(errors, "cta-multiple", `${classes.length} different calls to action (${ctas.map((cta) => `"${cta.phrase}"`).join(", ")}).`, "Keep one action and one destination; drop the others.", spanOf(sentences[ctas[ctas.length - 1].sentence]));
    }
    const cutoff = 1 - CTA_FINAL_SHARE;
    ctas.forEach((cta, index) => {
      // The last sentence is the end, however short the script.
      if (cta.at >= cutoff || cta.sentence === sentences.length - 1) return;
      // Long-form: one soft CTA (the earlier of a pair) after 15%, if the last is at the end.
      if (longForm && index === 0 && ctas.length === 2 && ctas[1].at >= cutoff && cta.at >= 0.15) return;
      add(errors, "cta-early", `"${cta.phrase}" asks for the action ${Math.round(cta.at * 100)}% of the way in.`, `Move the call to action into the final ${Math.round(CTA_FINAL_SHARE * 100)}%, after the hook's promise is paid.`, spanOf(sentences[cta.sentence]));
    });
    if (input.cta) {
      const wanted = findCtas(splitSentences(String(input.cta)), countWords(String(input.cta)), input.product).map((cta) => cta.class);
      if (wanted.length && !classes.every((name) => wanted.includes(name))) add(errors, "cta-mismatch", `The spoken call to action (${classes.join(", ")}) is not the requested one ("${input.cta}").`, `Say the requested action: "${input.cta}".`, spanOf(sentences[ctas[ctas.length - 1].sentence]));
    }
  }

  // --- Reading grade (soft): Flesch-Kincaid with a local syllable heuristic.
  const syllables = narration.split(/\s+/).filter(isWord).reduce((sum, word) => sum + syllableCount(word), 0);
  const grade = round1(0.39 * (words / sentences.length) + 11.8 * (syllables / Math.max(1, words)) - 15.59);
  const gradeMax = limits.grade ?? GRADE_LIMITS[audience];
  if (grade > gradeMax) add(warnings, "reading-grade", `Reading grade ${grade} is above ${gradeMax} for a ${audience === "b2b" ? "B2B" : "consumer"} audience.`, "Use shorter words and sentences; replace or define the hardest terms.");

  // --- Transitions (soft heuristic): additive "and/also" vs "but/so/because".
  if (sentences.length >= 3) {
    const additive = sentences.slice(1).map((sentence) => ADDITIVE_START.test(sentence.text));
    const share = additive.filter(Boolean).length / additive.length;
    const run = additive.some((value, index) => value && additive[index + 1] && additive[index + 2]);
    if (share > 1 / 3 || run) add(warnings, "additive-transitions", `${additive.filter(Boolean).length} of ${additive.length} sentences start with "and"/"also"${run ? ", three in a row" : ""} (heuristic).`, "Link beats with \"but\", \"so\" or \"because\" so each one causes or turns the next.");
  }

  // --- Awareness (soft): no brand in the first sentence for cold audiences.
  if (input.product && (awareness === "unaware" || awareness === "problem") && new RegExp(`\\b${escapeRegExp(String(input.product))}\\b`, "i").test(hook.text)) {
    add(warnings, "brand-first", `The first sentence names ${input.product} to a ${awareness}-aware audience.`, "Open on the viewer's problem; introduce the product once the problem lands.", spanOf(hook));
  }

  // --- Claims and numbers (soft).
  for (const sentence of sentences) {
    const superlative = SUPERLATIVE.exec(sentence.text);
    if (superlative) {
      const next = sentences[sentence.index + 1]?.text ?? "";
      const backed = [sentence.text, next].some((text) => numberClaims(text).some((claim) => !claim.trivial) || MECHANISM.test(text));
      if (!backed) add(warnings, "superlative", `"${superlative[0]}" has no number or mechanism behind it.`, "Back it in the same or next sentence with a figure from the brief, how it works, or a demo; or cut it.", spanOf(sentence));
    }
    const inSentence = traced.filter((claim) => claim.start >= sentence.start && claim.start < sentence.end && !claim.part);
    if (inSentence.length > 1) add(warnings, "numbers-per-sentence", `Sentence ${sentence.index + 1} carries ${inSentence.length} numbers (${inSentence.map((claim) => claim.text).join(", ")}).`, "One number per sentence, so the ear can hold it.", spanOf(sentence));
  }
  for (const claim of traced) {
    if (!claim.precise) continue;
    add(warnings, "number-precision", `"${claim.text}" is hard to hear.`, `Round it for the ear ("about ${earRound(claim)}"); put the exact figure in the caption.`, { start: claim.start, end: claim.end, sentence: sentenceAt(sentences, claim.start).index, text: claim.text });
  }

  // --- Hook payoff (soft heuristic): a question in the hook should be
  // answered by a statement in the last 40% that shares one of its keywords.
  if (/\?/.test(hook.text) && sentences.length > 1) {
    const keys = keywords(hook.text);
    const late = sentences.filter((sentence) => sentence.index > 0 && sentence.wordStart / words >= 0.6 && !/\?\s*$/.test(sentence.text));
    const answered = late.some((sentence) => keywords(sentence.text).some((word) => keys.includes(word)));
    if (keys.length && !answered) add(warnings, "hook-payoff", "The hook asks a question that the last 40% of the script never comes back to (heuristic: no shared keyword).", "Pay off the hook's question before the call to action, in the hook's own words.", spanOf(hook));
  }

  const stats = {
    words,
    sentences: sentences.length,
    duration,
    wpm,
    word_ceiling: ceiling,
    word_target: duration ? Math.round(duration * (band[0] + band[1]) / 2 / 60) : null,
    wpm_band: [...band],
    hook_words: hookWords,
    hook_max: hookMax,
    mean_sentence_words: meanWords,
    max_sentence_words: Math.max(...sentences.map((sentence) => countWords(sentence.text))),
    syllables_per_word: Math.round(syllables / Math.max(1, words) * 100) / 100,
    grade,
    grade_max: gradeMax,
    numbers: traced.length,
    ctas: ctas.map(({ class: kind, phrase, at, destination }) => ({ class: kind, phrase, at: Math.round(at * 100) / 100, destination })),
    format,
    format_source: explicitFormat ? "given" : duration == null ? "default" : "duration",
    goal: goal ?? null,
    awareness: awareness ?? null,
    audience,
    brief: briefText != null
  };
  return { schema_version: SCRIPT_CHECK_VERSION, ok: errors.length === 0, errors, warnings, stats };
}

/** The errors as a numbered list a model can act on (the make repair pass). */
export function formatCheckErrors(errors) {
  return errors.map((error, index) => `${index + 1}. [${error.id}] ${error.message} Fix: ${error.fix}${error.span?.text && !error.message.includes(error.span.text) ? ` (in: "${error.span.text}")` : ""}`).join("\n");
}

/** A readable report for the terminal. */
export function formatScriptCheck(report, { label = "script" } = {}) {
  const { stats } = report;
  const lines = [`launchclip script check: ${report.ok ? "ok" : "failed"} (${label})`];
  lines.push(`  ${stats.words} words, ${stats.sentences} sentences${stats.wpm != null ? `, ${stats.wpm} wpm over ${stats.duration}s (ceiling ${stats.word_ceiling} words)` : ""}; format ${stats.format} (${stats.format_source}), audience ${stats.audience}`);
  lines.push(`  hook ${stats.hook_words}/${stats.hook_max} words, mean sentence ${stats.mean_sentence_words} words, grade ${stats.grade}/${stats.grade_max}, ${stats.ctas.length} CTA${stats.ctas.length === 1 ? "" : "s"}`);
  for (const [kind, list] of [["error", report.errors], ["warning", report.warnings]]) {
    for (const item of list) {
      lines.push(`${kind}: [${item.id}] ${item.message}`);
      lines.push(`  fix: ${item.fix}`);
    }
  }
  if (!report.errors.length && !report.warnings.length) lines.push("No errors or warnings.");
  return `${lines.join("\n")}\n`;
}

/** prompt + notes + assets + transcripts, or a string, as one text. */
export function briefToText(brief) {
  if (typeof brief === "string") return brief;
  const parts = [brief.prompt, ...(brief.notes ?? []), ...(brief.assets ?? []), ...(brief.transcripts ?? [])];
  return parts.filter((part) => part != null).map(String).join("\n");
}

/** short-form ≤ 60 s, long-form > 180 s, explainer otherwise (and with no duration). */
export function defaultFormat(duration) {
  if (duration == null) return "explainer";
  if (duration <= 60) return "short-form";
  if (duration > 180) return "long-form";
  return "explainer";
}

/** Sentences with their character spans and the index of their first word. */
export function splitSentences(text) {
  const out = [];
  const pattern = /[^.!?…]+(?:[.!?…]+["”’')\]]*|$)/g;
  let pending = null;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    if (!raw.trim()) continue;
    const start = match.index + (raw.length - raw.trimStart().length);
    const piece = { start, end: match.index + raw.trimEnd().length };
    // A decimal ("4.5") or an abbreviation ("e.g.") does not end a sentence.
    if (pending && (/\d[.]$/.test(text.slice(pending.start, pending.end)) && /^\d/.test(text.slice(piece.start)) || ABBREVIATIONS.test(text.slice(pending.start, pending.end)))) {
      pending.end = piece.end;
      continue;
    }
    if (pending) out.push(pending);
    pending = piece;
  }
  if (pending) out.push(pending);
  let wordStart = 0;
  return out.map((piece, index) => {
    const sentence = { index, start: piece.start, end: piece.end, text: text.slice(piece.start, piece.end), wordStart };
    wordStart += countWords(sentence.text);
    return sentence;
  });
}

export function countWords(text) {
  return String(text).split(/\s+/).filter(isWord).length;
}

/** Vowel groups, less a silent final e; at least one. */
export function syllableCount(word) {
  let w = String(word).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!w) return 0;
  if (/\d/.test(w)) return 2;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, (end) => end[0]).replace(/^y/, "").replace(/y(?=[aeiou])/g, "j");
  const groups = w.match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

/**
 * Every number in a text, digits or words, as {text, value, unit, decimals,
 * start, end, trivial, precise, hedge, ratio?}. unit: "%", "x", "$" or "".
 */
export function numberClaims(text) {
  const tokens = [];
  const digit = /(?<![\w.\-/])([$€£¥])?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s?(k|mn|m|bn|b|thousand|million|billion|trillion|hundred)\b)?(?:\s?(%|per ?cent\b|percent\b|x\b|×|times\b|dollars?\b|euros?\b|pounds?\b|bucks\b))?/gi;
  for (const match of text.matchAll(digit)) {
    const [whole, currency, intPart, fraction, scale, unitWord] = match;
    let value = Number(`${intPart.replace(/,/g, "")}${fraction ? `.${fraction}` : ""}`);
    if (scale) value *= SUFFIX_SCALES[scale.toLowerCase()];
    tokens.push({ text: whole.trim(), value, unit: unitOf(currency, unitWord), decimals: scale ? 0 : fraction?.length ?? 0, start: match.index, end: match.index + whole.trimEnd().length, spelled: false, plain: !scale && !fraction && !currency && !unitWord, integer: Number.isInteger(value) });
  }
  for (const run of spelledNumbers(text)) {
    if (tokens.some((token) => run.start < token.end && token.start < run.end)) continue;
    tokens.push(run);
  }
  tokens.sort((a, b) => a.start - b.start);
  // "4 in 10", "1 out of 3", "4.8 out of 5": a ratio, as a percentage.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const [a, b] = [tokens[index], tokens[index + 1]];
    if (a.unit || b.unit) continue;
    const between = text.slice(a.end, b.start);
    if (!/^\s+(?:in|out of)\s+$/i.test(between) || !(b.value > 0)) continue;
    a.ratio = { percent: a.value / b.value * 100, of: b.value };
    a.text = text.slice(a.start, b.end);
    a.end = b.end;
    b.part = true;
  }
  for (const token of tokens) {
    const after = text.slice(token.end).match(/^\s*(?:of\s+)?([a-z]+)/i)?.[1] ?? "";
    const before = text.slice(Math.max(0, token.start - 24), token.start);
    token.hedge = HEDGE_OVER.test(before) ? "over" : HEDGE_UNDER.test(before) ? "under" : HEDGE_ABOUT.test(before) ? "about" : null;
    token.trivial = Boolean(token.part) || (!token.unit && !token.ratio && token.integer && token.value <= SMALL_COUNT && !MEASURE_NOUNS.test(after));
    token.precise = !token.trivial && !token.part && token.unit !== "$" && !isYear(token) && (
      (token.decimals >= 1 && token.value >= 10) || token.decimals >= 2 ||
      (token.integer && token.value >= 1000 && significant(token.value) >= 3));
  }
  return tokens;
}

// Spelled-out numbers: "forty per cent", "ten thousand", "two hundred and
// fifty", "a million", "twice". "and" joins only after a scale word ("two
// hundred and fifty", never "steps one and two"); "a" only before one.
function spelledNumbers(text) {
  const out = [];
  let run = [];
  const isNumeric = (word) => word.split("-").every((part) => part in ONES || part in TENS || part in SCALES);
  const flush = () => {
    while (run.length && (run[run.length - 1].word === "and" || run[run.length - 1].word === "a")) run.pop();
    if (run.some((item) => isNumeric(item.word))) {
      const value = parseSpelled(run.map((item) => item.word));
      const first = run[0];
      const end = run[run.length - 1].end;
      if (value != null) out.push({ text: text.slice(first.start, end), value, unit: "", decimals: 0, start: first.start, end, spelled: true, integer: Number.isInteger(value) });
    }
    run = [];
  };
  for (const match of text.matchAll(/\b[a-z]+(?:-[a-z]+)?\b/gi)) {
    const word = match[0].toLowerCase();
    const item = { word, start: match.index, end: match.index + word.length };
    if (run.length && text.slice(run[run.length - 1].end, match.index).trim()) flush();
    const lastWord = run[run.length - 1]?.word;
    if (word === "twice") {
      flush();
      out.push({ text: match[0], value: 2, unit: "x", decimals: 0, start: item.start, end: item.end, spelled: true, integer: true });
    } else if (isNumeric(word)) {
      if (lastWord === "a" && !(word in SCALES)) run = [];
      run.push(item);
    } else if (word === "and" && lastWord && lastWord in SCALES) {
      run.push(item);
    } else {
      flush();
      if (word === "a") run = [item];
    }
  }
  flush();
  for (const token of out) {
    if (token.unit) continue;
    const unit = text.slice(token.end).match(/^\s*(%|per ?cent\b|percent\b|times\b|x\b|dollars?\b|euros?\b|pounds?\b|bucks\b)/i);
    if (!unit) continue;
    token.unit = unitOf(null, unit[1]);
    token.end += unit[0].length;
    token.text = text.slice(token.start, token.end);
  }
  return out;
}

function parseSpelled(words) {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const raw of words) {
    if (raw === "and") continue;
    if (raw === "a") { current = Math.max(current, 1); continue; }
    for (const part of raw.split("-")) {
      if (part in ONES) { current += ONES[part]; seen = true; }
      else if (part in TENS) { current += TENS[part]; seen = true; }
      else if (part === "hundred") { current = Math.max(current, 1) * 100; seen = true; }
      else if (part in SCALES) { total += Math.max(current, 1) * SCALES[part]; current = 0; seen = true; }
    }
  }
  return seen ? total + current : null;
}

function unitOf(currency, word) {
  if (currency) return "$";
  if (!word) return "";
  const lower = word.toLowerCase().replace(/\s/g, "");
  if (lower === "%" || lower === "percent") return "%";
  if (lower === "x" || lower === "×" || lower === "times") return "x";
  return "$";
}

function supported(claim, supply) {
  if (claim.ratio) {
    if (supply.some((item) => item.unit === "%" && Math.abs(item.value - claim.ratio.percent) <= 5)) return true;
    return supply.some((item) => !item.part && item.value === claim.value && (item.unit === "" || item.unit === claim.unit));
  }
  return supply.some((item) => {
    // A percentage or a multiple needs the same unit in the brief; money may
    // come from a bare figure ("49 a month"); a bare claim matches any unit.
    if (claim.unit && claim.unit !== item.unit && !(claim.unit === "$" && item.unit === "")) return false;
    const values = item.ratio ? [item.value, item.ratio.percent] : [item.value];
    return values.some((value) => {
      if (value === claim.value) return true;
      if (roundTo(value, claim.decimals) === claim.value) return true;
      if (claim.hedge === "about") return Math.abs(value - claim.value) <= 0.1 * Math.max(Math.abs(value), 1);
      if (claim.hedge === "over") return value >= claim.value && value <= claim.value * 2;
      if (claim.hedge === "under") return value <= claim.value && value >= claim.value / 2;
      // A rounded claim ("1,200") supports by significant figures too.
      return claim.integer && claim.value >= 100 && significant(claim.value) >= 2 && roundSignificant(value, significant(claim.value)) === claim.value;
    });
  });
}

// A social-proof clause is supported when it names at least one figure or
// proper name and every one of them is in the brief.
function clauseSupported(clause, skipFirst, briefText, supply) {
  const end = clause.search(/[.;!?]/);
  const text = end < 0 ? clause : clause.slice(0, end);
  const numbers = numberClaims(text).filter((claim) => !claim.part);
  const names = [...text.matchAll(/\b[A-Z][\w&'-]+/g)].filter((match) => !(skipFirst === 0 && match.index === 0)).map((match) => match[0]);
  if (!numbers.length && !names.length) return false;
  const briefNorm = ` ${normalise(briefText)} `;
  return numbers.every((claim) => supported(claim, supply)) && names.every((name) => briefNorm.includes(` ${normalise(name)} `));
}

function findCtas(sentences, totalWords, product = null) {
  const out = [];
  const productPattern = product ? new RegExp(`\\b${escapeRegExp(String(product))}\\b`, "i") : null;
  for (const sentence of sentences) {
    const last = sentence.index === sentences.length - 1;
    const seen = new Set();
    const consider = (kind, index, phrase) => {
      if (seen.has(kind)) return;
      seen.add(kind);
      const wordsBefore = countWords(sentence.text.slice(0, index));
      out.push({ class: kind, phrase: phrase.trim(), sentence: sentence.index, at: (sentence.wordStart + wordsBefore) / Math.max(1, totalWords), destination: destinationOf(sentence.text) });
    };
    for (const [kind, pattern, ambiguous] of CTA_CLASSES) {
      for (const match of sentence.text.matchAll(new RegExp(pattern.source, "gi"))) {
        const before = sentence.text.slice(0, match.index).replace(/^["“'(]+/, "");
        if (!CTA_LEAD.test(before)) continue;
        // "you can sign up and try" is a description, not an imperative.
        if (/\b(?:you|we|they|i|it|teams?|people)\b[^,;:—–]*\b(?:and|or)\s+$/i.test(before)) continue;
        const rest = sentence.text.slice(match.index + match[0].length);
        if (ambiguous && !last && !CTA_SIGNAL.test(rest) && !(productPattern?.test(rest))) continue;
        consider(kind, match.index, match[0]);
        break;
      }
    }
    for (const [kind, pattern] of CTA_PHRASES) {
      const match = pattern.exec(sentence.text);
      if (match && !seen.has(kind)) consider(kind, match.index, match[0]);
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

function destinationOf(text) {
  const domain = DOMAIN.exec(text);
  if (domain) return domain[0].toLowerCase();
  if (/\blinks? in (?:the |my |our )?bio\b/i.test(text)) return "bio";
  if (/\b(?:description|links? below)\b/i.test(text)) return "description";
  return null;
}

function crowdScale(phrase) {
  // Plural: "thousands" needs at least two thousand.
  return /millions/i.test(phrase) ? 2e6 : /thousands/i.test(phrase) ? 2e3 : 200;
}

function oneOf(value, allowed, label) {
  if (value == null || value === "") return null;
  const id = String(value).toLowerCase();
  if (!allowed.includes(id)) throw new Error(`Unknown ${label} "${value}"; use one of: ${allowed.join(", ")}`);
  return id;
}

function sentenceAt(sentences, offset) {
  return sentences.find((sentence) => offset >= sentence.start && offset < sentence.end) ?? sentences[sentences.length - 1];
}

function contentCoverage(sentence, briefText) {
  const words = keywords(sentence);
  if (!words.length) return 1;
  const brief = new Set(keywords(briefText));
  return words.filter((word) => brief.has(word)).length / words.length;
}

function keywords(text) {
  return normalise(text).split(" ").filter((word) => word.length >= 4 && !STOPWORDS.has(word)).map(stem);
}

function stem(word) {
  return word.replace(/(?:ing|ed|es|s)$/, "");
}

function normalise(text) {
  return String(text).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9%$]+/g, " ").trim();
}

function isWord(token) {
  return /[\p{L}\p{N}]/u.test(token);
}

function isYear(token) {
  return token.plain && token.integer && token.value >= 1900 && token.value <= 2100 && !/,/.test(token.text);
}

function significant(value) {
  return String(Math.abs(Math.round(value))).replace(/0+$/, "").length;
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function roundSignificant(value, digits) {
  if (!value) return 0;
  const magnitude = 10 ** (Math.floor(Math.log10(Math.abs(value))) - digits + 1);
  return Math.round(value / magnitude) * magnitude;
}

function earRound(claim) {
  if (claim.unit === "%") {
    const tens = Math.round(claim.value / 10);
    return tens > 0 && tens < 10 ? `${tens} in 10` : `${Math.round(claim.value)} per cent`;
  }
  return roundSignificant(claim.value, 2).toLocaleString("en-US");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

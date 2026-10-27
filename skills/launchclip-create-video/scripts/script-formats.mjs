// Script formats: the planning pass that decides what kind of video a script
// is before any line is written ("the script decides the video").
//
//   chooseScriptPlan({prompt, duration, aspect, assets, goal?, format?, awareness?})
//     → {format, goal, awareness, skeleton, beats, word_target, word_ceiling, …}
//   wordBudget(duration, format) → {wpm, target, ceiling}
//   scriptPlanLines(plan)        → the plan as prompt lines (format, skeleton, budget)
//   scriptRuleLines(plan)        → the cross-cutting writing rules for that plan
//   scriptFormatsReference()     → the skills' references/script-formats.md
//
// The skeletons are LaunchClip's own vocabulary: named, swappable structures
// with no claim to be proven (practitioner heuristics, mostly second-hand).
// The hard numbers are arithmetic: a script longer than duration × 2.75 words
// a second cannot be spoken in time.
//
// Pure ESM; imports only kit/core siblings. Canonical copy: kit/core/script-formats.mjs.

import { LONG_FORM_SECONDS } from './long-form.mjs';

export const SCRIPT_PLAN_VERSION = 'launchclip.script-plan.v1';
export const SCRIPT_FORMAT_IDS = Object.freeze(['short-form', 'long-form', 'explainer', 'data-explainer', 'story', 'promo']);
export const SCRIPT_GOALS = Object.freeze(['reach', 'convert']);
export const AWARENESS_LEVELS = Object.freeze(['unaware', 'problem', 'solution', 'product', 'most']);
// Narration rates (words a minute): dense data, default narration, energetic short-form.
export const WPM = Object.freeze({ dense: 135, default: 150, energetic: 165 });
// The physical ceiling: no script longer than this many words a second fits its duration.
export const MAX_WORDS_PER_SECOND = 2.75;
export const HARD_MAX_SENTENCE_WORDS = 25;
export const HOOK_MAX_WORDS = 12;
// A portrait video this short is short-form unless the brief says otherwise.
export const SHORT_FORM_MAX_SECONDS = 90;
// Every video this short meets the short-video rules (a share line, concrete
// visuals; kit/core/skeleton-library.mjs checks the rest), whatever its format.
export const SHORT_VIDEO_SECONDS = SHORT_FORM_MAX_SECONDS;
// Long form re-engages the viewer about this often.
export const REENGAGE_SECONDS = 180;

const beat = (id, label, share, rule) => Object.freeze({ id, label, share, rule });

// Named skeletons: ordered beats with a rough share of the runtime (sums to 1).
export const SCRIPT_SKELETONS = Object.freeze({
  'call-out-pas': Object.freeze({
    id: 'call-out-pas',
    name: 'Call-out hook → problem-agitate-solve',
    beats: Object.freeze([
      beat('hook', 'Call-out hook', 0.1, 'Name the viewer or their problem so they think "this is for me": a label, a yes-question, an if-then, a command or a surprising result.'),
      beat('problem', 'Problem', 0.2, 'State the problem in the viewer\'s own words, with one concrete detail.'),
      beat('agitate', 'Agitate', 0.2, 'Show what the problem costs them, but only with facts from the brief.'),
      beat('solve', 'Solve', 0.3, 'Show the answer as an outcome, then pay off the hook\'s promise.'),
      beat('cta', 'Call to action', 0.2, 'One action, one destination.')
    ])
  }),
  'before-after-bridge': Object.freeze({
    id: 'before-after-bridge',
    name: 'Before → after → bridge',
    beats: Object.freeze([
      beat('hook', 'Hook', 0.1, 'Open on the viewer\'s situation or the result they want.'),
      beat('before', 'Before', 0.25, 'The world now: the friction, in concrete terms.'),
      beat('after', 'After', 0.25, 'The world after: the same scene with the friction gone.'),
      beat('bridge', 'Bridge', 0.25, 'How to get there: the product or idea that connects the two, paying off the hook.'),
      beat('cta', 'Call to action', 0.15, 'One action, one destination.')
    ])
  }),
  'misconception-first': Object.freeze({
    id: 'misconception-first',
    name: 'Question → common belief → why it fails → the better model',
    beats: Object.freeze([
      beat('hook', 'Question', 0.12, 'Ask the question the video answers, or name the viewer\'s confusion.'),
      beat('belief', 'Common belief', 0.18, 'Say what most people think, fairly, in one or two lines.'),
      beat('break', 'Why it fails', 0.25, 'Show where that belief breaks, with one concrete case.'),
      beat('model', 'Better model', 0.3, 'Give the correct picture, one step per sentence.'),
      beat('payoff', 'Payoff', 0.15, 'Answer the opening question in a line; then the call to action, if any.')
    ])
  }),
  'fair-test': Object.freeze({
    id: 'fair-test',
    name: 'Everyone believes X → a fair test → the result',
    beats: Object.freeze([
      beat('hook', 'Belief', 0.12, 'State what everyone believes, or the question the data answers.'),
      beat('test', 'Fair test', 0.25, 'Who measured what, how many, and why it is a fair test (source from the brief).'),
      beat('result', 'Result', 0.3, 'One hero number per beat, simplified for the ear, each with a perspective ("about 1 in 4", "per person").'),
      beat('meaning', 'What it means', 0.2, 'What changes for the viewer; name a limit of the study if the brief gives one.'),
      beat('cta', 'Close', 0.13, 'Answer the hook, then one call to action or a takeaway line.')
    ])
  }),
  'story-spine': Object.freeze({
    id: 'story-spine',
    name: 'Story spine (once upon a time → every day → one day → because of that → until finally)',
    beats: Object.freeze([
      beat('once', 'Once upon a time', 0.12, 'Who the character is and what they want, in the first line.'),
      beat('every-day', 'Every day', 0.13, 'Their routine, and what blocks them.'),
      beat('one-day', 'One day', 0.15, 'The disruption that breaks the routine.'),
      beat('because', 'Because of that (×n)', 0.35, 'Cause and effect, each beat caused by the one before; repeat the slot as often as the length allows.'),
      beat('until-finally', 'Until finally', 0.15, 'The turn, caused by the character\'s own choice, not chance.'),
      beat('ever-since', 'Ever since', 0.1, 'The new normal, a moral, or the brand arriving late as the guide.')
    ])
  }),
  launch: Object.freeze({
    id: 'launch',
    name: 'Launch: news hook + specific claim → features as outcomes → real proof → offer → CTA',
    beats: Object.freeze([
      beat('hook', 'News hook + specific claim', 0.15, 'What is new and the one concrete thing it does for the viewer.'),
      beat('features', 'Feature → outcome (2–3)', 0.45, 'Two or three features, each narrated as the result it gives ("so you can…"); narrate outcomes, not clicks.'),
      beat('proof', 'Proof', 0.15, 'Real proof only: a demo of the outcome, a fact from the brief, or plain framing ("launching today"). Never an invented customer or number.'),
      beat('offer', 'Offer', 0.1, 'What they get and on what terms, only as the brief states it.'),
      beat('cta', 'Call to action', 0.15, 'One action, one destination.')
    ])
  }),
  'long-form': Object.freeze({
    id: 'long-form',
    name: 'Long form: pay the title promise by ~30 s, re-engage every ~3 min, soft mid CTA, main CTA at the end',
    beats: Object.freeze([
      beat('hook', 'Hook', 0.03, 'The topic or the viewer\'s problem in the first line, matching the title.'),
      beat('promise', 'Promise', 0.04, 'Confirm what the title promised by about 30 s: proof you can deliver, the promise and a short plan.'),
      beat('body', 'Sections', 0.6, 'Sections that escalate (never front-load the best one); a re-engagement (a reveal, a new stake, a demo result) roughly every 3 minutes.'),
      beat('soft-cta', 'Soft mid CTA', 0.03, 'One soft mention right after a payoff, never in the first 15%.'),
      beat('payoff', 'Payoff', 0.22, 'The final payoff of the title promise; no "in conclusion" before it lands.'),
      beat('cta', 'Main CTA', 0.08, 'The main call to action at the end, tied to the end screen.')
    ])
  })
});

const SENTENCES = Object.freeze({
  short: Object.freeze({ min: 4, max: 10, mean: 8, hard: HARD_MAX_SENTENCE_WORDS, rule: 'One idea per sentence, 4–10 words each.' }),
  default: Object.freeze({ min: 6, max: 20, mean: 15, hard: HARD_MAX_SENTENCE_WORDS, rule: `One idea per sentence; keep the mean at about 15 words or fewer and never pass ${HARD_MAX_SENTENCE_WORDS}.` })
});

const CTA_ONE = 'Exactly one call to action: one verb, one destination, spoken in the same words the end card shows. It comes after the hook\'s promise is paid.';

export const SCRIPT_FORMATS = Object.freeze({
  'short-form': Object.freeze({
    id: 'short-form',
    label: 'a short-form video of 15–90 s (Shorts, Reels, TikTok)',
    wpm: WPM.energetic,
    skeleton: 'call-out-pas',
    skeletons: Object.freeze(['call-out-pas', 'before-after-bridge']),
    sentences: SENTENCES.short,
    hook: `A call-out in the first sentence (≤ ${HOOK_MAX_WORDS} words, ideally about 8): it names the topic or the viewer's problem and lands in the first 3 seconds. Above 30 s, add a contrast rehook ("but…") near the middle.`,
    cta: `${CTA_ONE} At 15 s or less, the last line may flow back into the first as a loop instead.`
  }),
  'long-form': Object.freeze({
    id: 'long-form',
    label: 'a long video of 5 minutes or more (YouTube)',
    wpm: WPM.default,
    skeleton: 'long-form',
    skeletons: Object.freeze(['long-form']),
    sentences: SENTENCES.default,
    hook: `The first one or two sentences share key words with the title; no greeting, channel name or subscribe ask in the first 15 s. The title's promise is confirmed by about 30 s.`,
    cta: 'No call to action in the first 60 s or 15%. One soft mention right after a payoff; the main call to action at the end, one verb and one destination, spoken as the end screen shows it.'
  }),
  explainer: Object.freeze({
    id: 'explainer',
    label: 'an explainer of how or why something works',
    wpm: WPM.default,
    skeleton: 'misconception-first',
    skeletons: Object.freeze(['misconception-first', 'before-after-bridge']),
    sentences: SENTENCES.default,
    hook: `The first sentence (≤ ${HOOK_MAX_WORDS} words) asks the question the video answers or names the viewer's confusion. Introduce any key term in a short early line before using it.`,
    cta: CTA_ONE
  }),
  'data-explainer': Object.freeze({
    id: 'data-explainer',
    label: 'a data explainer built on a study, a survey or a dataset',
    wpm: WPM.dense,
    skeleton: 'fair-test',
    skeletons: Object.freeze(['fair-test', 'misconception-first']),
    sentences: SENTENCES.default,
    hook: `The first sentence (≤ ${HOOK_MAX_WORDS} words) states the belief the data tests or the question it answers, not the number itself.`,
    cta: CTA_ONE,
    note: 'Budgeted slower so each hero number gets a short hold; name the source in the narration or leave it for the on-screen source line.'
  }),
  story: Object.freeze({
    id: 'story',
    label: 'a story or parable (a fable, a verse, a quote, a brand story)',
    wpm: WPM.default,
    skeleton: 'story-spine',
    skeletons: Object.freeze(['story-spine']),
    sentences: SENTENCES.default,
    // Narration covers only part of the runtime: wordless beats let the image land.
    coverage: 0.75,
    hook: 'The character and what they want in the first line; no brand in it. Adapting a verse, quote or fable: keep the original wording verbatim and split it at clause boundaries.',
    cta: 'A call to action is optional; if there is one, it is a single line after the ending, never inside the story.'
  }),
  promo: Object.freeze({
    id: 'promo',
    label: 'a promo or launch video of 15 s to 3 min',
    wpm: WPM.default,
    skeleton: 'launch',
    skeletons: Object.freeze(['launch', 'call-out-pas', 'before-after-bridge']),
    sentences: SENTENCES.default,
    hook: `Open on the problem or the outcome (≤ ${HOOK_MAX_WORDS} words), not the logo; say the product name by about 5 s unless the awareness rule says otherwise.`,
    cta: `${CTA_ONE} For Product Hunt, invite people to try it and give feedback; never ask for upvotes.`
  })
});

// How the opening line changes with how much the viewer already knows.
export const AWARENESS_OPENINGS = Object.freeze({
  unaware: 'Unaware: open on something the viewer recognises about themselves (identity, a feeling, a surprising observation). No product name, price or pitch in the first sentence.',
  problem: 'Problem-aware: name their problem in their own words. No product name or price in the first sentence.',
  solution: 'Solution-aware: open on the result they want, then "here\'s how"; the product can arrive in sentence two or three.',
  product: 'Product-aware: open with proof or a comparison with the alternative they know.',
  most: 'Most-aware: lead with the offer (and a deadline only if the brief gives a real one); the call to action may come within the first 15% and again at the end.'
});

export const GOAL_RULES = Object.freeze({
  reach: 'Goal: reach. Win the scroll and the watch time: a sharp call-out, curiosity that carries self-interest (never confusion), a satisfying payoff.',
  convert: 'Goal: convert. A concrete outcome beats curiosity bait: say what the viewer gets, prove it with the brief\'s facts, and make the one action obvious. Fit to the audience matters more than stopping the scroll.'
});

// Defaults when the brief does not say.
const DEFAULT_AWARENESS = Object.freeze({ 'short-form': 'problem', 'long-form': 'problem', explainer: 'problem', 'data-explainer': 'unaware', story: 'unaware', promo: 'solution' });

const STORY_WORDS = /\b(verse|poem|poetry|fable|parable|quote|quotation|proverb|once upon a time|fairy ?tale|folk ?tale)\b/i;
const DATA_WORDS = /\b(stud(?:y|ies)|research|researchers|survey|statistics?|dataset|data set|the data|data shows?|findings|census|poll|meta-analysis|per ?cent of)\b/i;
const PROMO_WORDS = /\b(launch\w*|introduc\w*|announc\w*|product|release|new feature|promo|free trial|sign ?ups?|pre-?order|waitlist)\b/i;
const STORY_SOFT_WORDS = /\b(story|tale)\b/i;
const EXPLAIN_WORDS = /\b(explain\w*|how (?:it|does|do|to)|why\b|what is|walkthrough)\b/i;
const CONVERT_WORDS = /\b(sign ?ups?|free trial|buy|purchase|pre-?order|book a (?:demo|call)|conver(?:t|sions?)|ads?|retarget\w*)\b/i;
const MOST_AWARE_WORDS = /\b(retarget\w*|existing customers|customers who|offer ends|last chance|discount|coupon|% off|sale ends)\b/i;
const PRODUCT_MEDIA_ROLES = new Set(['screen-recording', 'screenshot', 'product-demo']);

function pick(value, allowed, flag) {
  if (value == null || value === '') return null;
  const id = String(value).trim().toLowerCase();
  if (!allowed.includes(id)) throw new Error(`--${flag} must be one of ${allowed.join(', ')}; got ${value}`);
  return id;
}

/** Validate explicit plan options; throws with the flag's valid values. */
export function scriptPlanOptions({ goal, format, awareness } = {}) {
  return { goal: pick(goal, SCRIPT_GOALS, 'goal'), format: pick(format, SCRIPT_FORMAT_IDS, 'format'), awareness: pick(awareness, AWARENESS_LEVELS, 'awareness') };
}

function isPortrait(aspect) {
  if (aspect && typeof aspect === 'object') return Number(aspect.height) > Number(aspect.width);
  const match = /^(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)$/.exec(String(aspect ?? '').trim());
  return Boolean(match) && Number(match[2]) > Number(match[1]);
}

function hasProductMedia(assets) {
  return (Array.isArray(assets) ? assets : []).some((item) => PRODUCT_MEDIA_ROLES.has(typeof item === 'string' ? item : item?.role));
}

/** The format the brief implies, with the reason. Explicit options win over this. */
function guessFormat({ prompt, duration, aspect, assets }) {
  const text = String(prompt ?? '');
  if (duration >= LONG_FORM_SECONDS) return ['long-form', `${duration}s is ${LONG_FORM_SECONDS / 60} minutes or more`];
  if (STORY_WORDS.test(text)) return ['story', 'the brief adapts a verse, quote, fable or tale'];
  if (DATA_WORDS.test(text)) return ['data-explainer', 'the brief is about a study, research or data'];
  if (PROMO_WORDS.test(text)) return ['promo', 'the brief launches or introduces a product'];
  if (STORY_SOFT_WORDS.test(text)) return ['story', 'the brief asks for a story'];
  if (isPortrait(aspect) && duration <= SHORT_FORM_MAX_SECONDS) return ['short-form', `portrait and ${SHORT_FORM_MAX_SECONDS}s or less`];
  if (EXPLAIN_WORDS.test(text)) return ['explainer', 'the brief explains how or why something works'];
  if (hasProductMedia(assets)) return ['promo', 'the assets show a product'];
  if (duration <= 60) return ['short-form', '60s or less'];
  return ['explainer', 'the default for a longer video'];
}

/**
 * Words for a duration in a format: target at the format's rate (story
 * narration covers only part of the runtime) and the hard ceiling at
 * MAX_WORDS_PER_SECOND.
 */
export function wordBudget(duration, format = 'explainer') {
  const spec = SCRIPT_FORMATS[format] ?? SCRIPT_FORMATS.explainer;
  const seconds = Math.max(1, Number(duration) || 0);
  const ceiling = Math.max(8, Math.floor(seconds * MAX_WORDS_PER_SECOND));
  const target = Math.min(ceiling, Math.max(8, Math.round(seconds * spec.wpm / 60 * (spec.coverage ?? 1))));
  return { wpm: spec.wpm, target, ceiling };
}

/**
 * The script plan: format, goal, awareness, skeleton, beats with word and
 * second budgets. Deterministic; explicit goal/format/awareness win over the
 * heuristic. options: {prompt, duration (s), aspect ("9:16" or {width,
 * height}), assets ([{role}] or role strings), goal, format, awareness, words
 * (a word-target override, e.g. after a measured take)}.
 */
export function chooseScriptPlan(options = {}) {
  const explicit = scriptPlanOptions(options);
  const duration = Number(options.duration) > 0 ? Number(options.duration) : 30;
  const text = String(options.prompt ?? '');
  const reasons = [];
  let format = explicit.format;
  if (format) reasons.push(`format ${format}: --format`);
  else {
    const [id, why] = guessFormat({ prompt: text, duration, aspect: options.aspect, assets: options.assets });
    format = id;
    reasons.push(`format ${format}: ${why}`);
  }
  let goal = explicit.goal;
  if (goal) reasons.push(`goal ${goal}: --goal`);
  else {
    goal = format === 'promo' || CONVERT_WORDS.test(text) ? 'convert' : 'reach';
    reasons.push(`goal ${goal}: ${goal === 'convert' ? (format === 'promo' ? 'a promo sells' : 'the brief asks for an action') : 'the default'}`);
  }
  let awareness = explicit.awareness;
  if (awareness) reasons.push(`awareness ${awareness}: --awareness`);
  else {
    awareness = MOST_AWARE_WORDS.test(text) ? 'most' : DEFAULT_AWARENESS[format];
    reasons.push(`awareness ${awareness}: ${awareness === 'most' && MOST_AWARE_WORDS.test(text) ? 'the brief targets people who already know the offer' : `the default for ${format}`}`);
  }
  const spec = SCRIPT_FORMATS[format];
  // An explicit skeleton (--skeleton call-out-pas) wins; short-form for a viewer
  // who already wants the result reads better as before-after-bridge.
  const pinned = options.skeleton && SCRIPT_SKELETONS[options.skeleton] ? options.skeleton : null;
  const skeletonId = pinned ?? (format === 'short-form' && ['solution', 'product'].includes(awareness) ? 'before-after-bridge' : spec.skeleton);
  if (pinned) reasons.push(`skeleton ${pinned}: --skeleton`);
  const skeleton = SCRIPT_SKELETONS[skeletonId];
  const budget = wordBudget(duration, format);
  const target = options.words != null ? Math.min(budget.ceiling, Math.max(8, Math.round(Number(options.words)))) : budget.target;
  const beats = skeleton.beats.map((entry) => ({ id: entry.id, label: entry.label, share: entry.share, words: Math.max(3, Math.round(target * entry.share)), seconds: round1(duration * entry.share), rule: entry.rule }));
  const plan = {
    schema: SCRIPT_PLAN_VERSION,
    format,
    goal,
    awareness,
    skeleton: skeletonId,
    duration,
    wpm: budget.wpm,
    word_target: target,
    word_ceiling: budget.ceiling,
    beats,
    reasons
  };
  if (format === 'long-form') plan.reengage_at = reengageTimes(duration);
  return plan;
}

/** Long form: re-engagement points (seconds) about every REENGAGE_SECONDS, short of the ending. */
export function reengageTimes(duration) {
  const out = [];
  for (let at = REENGAGE_SECONDS; at < Number(duration) * 0.9; at += REENGAGE_SECONDS) out.push(at);
  return out;
}

const round1 = (value) => Math.round(value * 10) / 10;
const mmss = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/** The plan as prompt lines: format, goal, awareness, skeleton and budget. */
export function scriptPlanLines(plan) {
  const spec = SCRIPT_FORMATS[plan.format];
  // A library skeleton's plan (kit/core/skeleton-library.mjs skeletonScriptPlan) brings its own beats.
  const skeleton = SCRIPT_SKELETONS[plan.skeleton] ?? { name: plan.structure ? `${plan.structure.title} (the skeleton library)` : plan.skeleton };
  const lines = [
    `Format: ${plan.format}, ${spec.label}.`,
    GOAL_RULES[plan.goal],
    `Awareness: ${AWARENESS_OPENINGS[plan.awareness]}`,
    `Word budget: about ${plan.word_target} words (${plan.wpm} words a minute over ${plan.duration} s${spec.coverage ? `, narration over about ${Math.round(spec.coverage * 100)}% of the runtime so wordless beats can land` : ''}); never more than ${plan.word_ceiling}.`,
    `Hook: ${spec.hook}`,
    `Call to action: ${plan.structure ? 'as the skeleton\'s last beat says: a loop back into the hook, or one action with one destination.' : spec.cta}`,
    ...(spec.note ? [spec.note] : []),
    '',
    `Skeleton: ${skeleton.name}. Write the beats in this order (about this many words each):`,
    ...plan.beats.map((entry, index) => `${index + 1}. ${entry.id} — ${entry.label}, ~${entry.words} words: ${entry.rule}`)
  ];
  if (plan.reengage_at?.length) lines.push('', `Re-engage near ${plan.reengage_at.map(mmss).join(', ')} with a reveal, an escalation, a demo result or a new stake, not a recap.`);
  if (plan.structure?.lines?.length) lines.push('', ...plan.structure.lines);
  return lines;
}

// The short-video rules for the script (every video of SHORT_VIDEO_SECONDS or less).
export const SHORT_VIDEO_RULES = Object.freeze([
  'Share line: in the last 40% of the script, one spoken line that gives a viewer a reason to send the video or comment (a surprise they can repeat, a line they recognise themselves in, one small act, a claim the brief supports that people will argue with, or a takeaway worth saving). When the plan has a share beat, this is it.',
  'Concrete pictures: every sentence names something the viewer can picture (an object, a place, a person, a number with its unit), so each one can own a scene; no sentence rests on an abstraction alone.'
]);

/** The writing rules every format shares, specialised for the plan's sentence lengths (and the short-video rules for a short plan). */
export function scriptRuleLines(plan = null) {
  const sentences = (plan && SCRIPT_FORMATS[plan.format]?.sentences) ?? SENTENCES.default;
  const short = plan && Number(plan.duration) <= SHORT_VIDEO_SECONDS;
  return [
    ...(short ? SHORT_VIDEO_RULES : []),
    `Hook: the first sentence is ${HOOK_MAX_WORDS} words or fewer and names the topic or the viewer's problem. Never open with a greeting, "in this video", "today we're going to" or the brand name (unless the awareness rule puts the offer first).`,
    'Join beats with "but", "so" or "therefore", never "and then": each beat changes what the next one means.',
    'Close every question you open. The hook\'s promise is paid off in the final quarter, before the call to action.',
    `${sentences.rule} Hard maximum ${sentences.hard} words a sentence.`,
    'Write for the ear: contractions, "you", subject-verb-object order, no parentheses. Spell symbols as spoken ("per cent", not "%").',
    'Simplify spoken numbers ("4 in 10", not "43.7%") and keep to one number per sentence; the exact figure can go on screen.',
    'Plain words: about grade 7 or below for consumers and cold audiences, grade 9 or below for business and technical buyers; define any harder word in the same line.',
    'Exactly one call to action, worded the same when spoken and when shown.',
    'Never invent facts: every number, name, customer, quote, rating, user count, price, deadline and guarantee must come from the brief, notes, assets or transcripts. No placeholder testimonials, no urgency or scarcity unless the brief gives a real deadline or limit. Illustrative numbers must be framed as examples. When the brief has no proof, use honest substitutes: a demo of the outcome, a plain product fact, "launching today".'
  ];
}

/** Markdown reference for the create-video skills (references/script-formats.md, generated). */
export function scriptFormatsReference() {
  const lines = [
    '# Script formats: plan the script before you write it',
    '',
    '<!-- Generated from kit/core/script-formats.mjs by scripts/sync-skills.mjs. Do not edit by hand; run `npm run skills:sync`. -->',
    '',
    'The script decides what kind of video this is. Before writing `SCRIPT.md` (or `audio.narration`), pick a **format**, a **goal** and the viewer\'s **awareness**, then write the script against the format\'s skeleton. `launchclip make` does the same with `--format`, `--goal` and `--awareness` (or the defaults below) and records the plan in `SCRIPT.json`.',
    '',
    'The skeletons are LaunchClip\'s own vocabulary: swappable structures from common practice, not proven formulas. The word ceiling is arithmetic and is not optional.',
    '',
    '## Steps',
    '',
    '1. **Format.** Use the user\'s words if they name one; otherwise: 5 minutes or more → `long-form`; a verse, quote, fable or tale → `story`; a study, research or data → `data-explainer`; a launch, product or announcement → `promo`; portrait and 90 s or less → `short-form`; "how/why it works" → `explainer`; otherwise `short-form` up to 60 s and `explainer` beyond (a promo when the assets show a product).',
    '2. **Goal.** `convert` when the video should drive an action (sign-ups, trials, sales, bookings, ads; every promo); otherwise `reach`.',
    '3. **Awareness.** How much the viewer already knows (table below). Cold Shorts traffic is usually `problem` or `unaware`; launch announcements `solution` or `product`; retargeting `most`.',
    `4. **Budget.** Target words = duration × the format's words a minute ÷ 60; ceiling = duration × ${MAX_WORDS_PER_SECOND}. Write to the target, measure with \`launchclip voice\`, never exceed the ceiling.`,
    '5. **Write the beats** in the skeleton\'s order, then record `format`, `goal`, `awareness` and the beat each sentence belongs to in `SCRIPT.md` so the storyboard follows the same beats (one scene group per beat; the hook beat\'s scene shows the hook\'s subject at 0 s; the CTA beat gets the end card with the spoken wording).',
    `6. **Titles.** Write three publish-ready title options (five, best first, for a video of ${SHORT_VIDEO_SECONDS} s or less). For \`convert\`, put the concrete outcome in the title; no curiosity bait.`,
    `7. **Short videos.** A video of ${SHORT_VIDEO_SECONDS} s or less may be built on a skeleton from the skeleton library (references/skeleton-library.md), chosen when the brief fits one, and always meets the short-video rules there.`,
    '',
    '## Formats',
    '',
    '| Format | Words a minute | Default skeleton | Sentences | Default awareness |',
    '| --- | --- | --- | --- | --- |',
    ...SCRIPT_FORMAT_IDS.map((id) => {
      const spec = SCRIPT_FORMATS[id];
      return `| \`${id}\` | ${spec.wpm}${spec.coverage ? ` (narration over ~${Math.round(spec.coverage * 100)}% of the runtime)` : ''} | ${SCRIPT_SKELETONS[spec.skeleton].name} | ${spec.sentences.rule} | \`${DEFAULT_AWARENESS[id]}\` |`;
    }),
    '',
    ...SCRIPT_FORMAT_IDS.flatMap((id) => {
      const spec = SCRIPT_FORMATS[id];
      return [`- **\`${id}\`**: ${spec.hook} ${spec.cta}${spec.note ? ` ${spec.note}` : ''}`];
    }),
    '',
    '## Skeletons',
    '',
    ...Object.values(SCRIPT_SKELETONS).flatMap((skeleton) => [
      `### \`${skeleton.id}\`: ${skeleton.name}`,
      '',
      ...skeleton.beats.map((entry) => `- **${entry.label}** (~${Math.round(entry.share * 100)}%): ${entry.rule}`),
      ''
    ]),
    '## Goal',
    '',
    ...SCRIPT_GOALS.map((id) => `- \`${id}\`: ${GOAL_RULES[id]}`),
    '',
    '## Awareness and the opening line',
    '',
    ...AWARENESS_LEVELS.map((id) => `- \`${id}\`: ${AWARENESS_OPENINGS[id]}`),
    '',
    '## Rules for every format',
    '',
    ...scriptRuleLines().map((line) => `- ${line}`),
    ''
  ];
  return `${lines.join('\n').trimEnd()}\n`;
}

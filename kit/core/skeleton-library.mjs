// The skeleton library (docs/VIRAL_FORMATS_RFC.md): proven short-form
// structures as rich script skeletons, so the composition, script and art
// direction a video needs to be worth watching come with the tool. A library
// skeleton is a skeleton like call-out-pas (kit/core/script-formats.mjs) that
// also knows its key shot, first frame, share beat, voice tier and packaging.
// make picks one automatically when the brief fits; nothing has to be
// switched on.
//
// Every short video (90 s or less) gets the same quality rules whether or not
// a library skeleton fits it: an image, not a title card, at 0 s; a spoken
// share line in the last 40%; concrete visual nouns; five title options.
// A library skeleton adds its key shot.
//
//   LIBRARY_SKELETONS                    the starter library (10 skeletons)
//   mergeSkeletons(extra)                the library plus the user's own (src/skeletons.js reads them)
//   kitCapabilities()                    the modules, poses, actions and sets the kit has
//   skeletonFeasibility(skeleton, kit)   → {ok, missing}: can the kit render its key shot?
//   chooseSkeleton(options)              → {skeleton, reasons, candidates, blocked}
//   skeletonScriptPlan(options, skeleton) the script plan written on its beats
//   skeletonPlanLines(skeleton)          its prompt lines (script, planner, critic)
//   isShortVideo(story)                  whether the short-video quality rules apply
//   structureCheck(story, skeleton, options) → the structure gate's checks
//   storyboardStructureErrors(story, skeleton) → the checks a plan can fail, as repair errors
//   skeletonLibraryReference()           the skills' references/skeleton-library.md
//
// A skeleton describes a structure, never someone else's video: `examples`
// are titles only. The structures are practitioner heuristics, dated by
// `version` (a month) and reviewed six months on, not proven formulas.
//
// Pure ESM; imports only kit/core siblings. Canonical copy: kit/core/skeleton-library.mjs.

import { catalogModules } from './modules.mjs';
import { EDITORIAL_KINDS } from './editorial-core.mjs';
import { POSES } from './characters/rig.mjs';
import { ACTIONS } from './characters/actions.mjs';
import { SETS } from './characters/sets.mjs';
import { SCRIPT_FORMAT_IDS, SHORT_VIDEO_SECONDS, chooseScriptPlan } from './script-formats.mjs';
import { storyBase } from './story.mjs';

export const SKELETON_SCHEMA = 'launchclip.skeleton.v1';
export const SKELETON_FAMILIES = Object.freeze(['scale', 'last-time', 'versus', 'if-were', 'nobody-tells', 'countdown', 'before-after', 'myth', 'pov', 'process']);
export const SKELETON_MEDIA = Object.freeze(['motion', 'character', 'footage', 'demo']);
export const SHARE_KINDS = Object.freeze(['surprise', 'identity', 'act', 'debate', 'useful']);
export const VOICE_TIERS = Object.freeze(['free', 'better', 'human-or-premium']);
// The story roles a skeleton's beats use (the tournament's, plus `share`).
export const SKELETON_BEAT_ROLES = Object.freeze(['hook', 'promise', 'mechanism', 'proof', 'rehook', 'escalation', 'payoff', 'share', 'closing_reframe', 'cta_or_loop']);
// Modules that read as a title card when they open a video: a short video's
// first frame is an image, never one of these.
export const TITLE_CARD_MODULES = Object.freeze(['hook-title', 'motion-title', 'kinetic-words', 'section-card', 'masthead', 'glass-word', 'emphasis-caption']);
// A skeleton reviewed this many months after its version month is stale.
export const REVIEW_MONTHS = 6;
// The share line sits in the last share of the runtime.
export const SHARE_WINDOW = 0.4;
// The opening image must be on screen by this many seconds.
export const FIRST_FRAME_SECONDS = 0.35;
// Title options a short video's script writes, best first.
export const TITLE_OPTIONS = 5;

const beat = (id, role, label, share, rule) => Object.freeze({ id, role, label, share, rule });
const LOOP = 'The last line runs back into the hook, so the video loops.';

export const LIBRARY_SKELETONS = Object.freeze([
  Object.freeze({
    schema: SKELETON_SCHEMA,
    id: 'dollar-a-second',
    title: '$1 a second',
    version: '2026-10',
    family: 'scale',
    fits: Object.freeze(['\\b(million|billion|trillion)\\b', '\\b(how (big|much|long|many)|scale|magnitude|compared? to)\\b', '\\b(money|dollars?|seconds?|years?)\\b']),
    media: Object.freeze(['motion']),
    aspects: Object.freeze(['9:16']),
    duration: Object.freeze({ min: 20, target: 30, max: 45 }),
    script_format: 'short-form',
    hook: Object.freeze({ template: "I'll {give} you {unit} every {interval}. When {milestone}?", rule: 'Second person, a personal stake in one number, and a question the viewer will answer wrong.' }),
    beats: Object.freeze([
      beat('hook', 'hook', 'Stake', 0.14, 'A personal stake in one number, as a question.'),
      beat('first', 'proof', 'First milestone', 0.16, 'The first milestone lands, smaller than the viewer guessed.'),
      beat('rehook', 'rehook', 'Keep going', 0.1, 'Push on to the next order of magnitude: "now keep going".'),
      beat('second', 'escalation', 'Second milestone', 0.2, 'The second milestone, far bigger than expected, as a concrete span of life.'),
      beat('third', 'escalation', 'Third milestone', 0.18, 'The third, absurd; compared with something the viewer already knows.'),
      beat('share', 'share', 'The gap', 0.14, 'The gap in one line the viewer will repeat at dinner.'),
      beat('loop', 'cta_or_loop', 'Loop', 0.08, LOOP)
    ]),
    key_shot: Object.freeze({ describe: 'a clock or calendar racing while the stake grows beside it', modules: Object.freeze(['count-up', 'odometer', 'flip-clock', 'slot-roll', 'number-line', 'timeline']) }),
    first_frame: Object.freeze({ describe: 'the stake as an object (a coin, a note, a counter at $1), never a title card', modules: Object.freeze(['count-up', 'odometer', 'flip-clock', 'stat-card', 'object-card', 'photo-scene']) }),
    avoid: Object.freeze(['a title card as the hook', 'a bar chart without a picturable unit', 'a source line held over scenes it does not cite']),
    share: Object.freeze({ kind: 'surprise', rule: 'A comparison the viewer can repeat ("twelve days and thirty-two years apart").' }),
    voice: Object.freeze({ tier: 'free', delivery: 'quick, amused, conversational' }),
    sound: Object.freeze({ density: 'normal', long_cues: 'rare' }),
    packaging: Object.freeze({ titles: Object.freeze(['{unit} a second: how long until {milestone}?', '{a} vs {b} is not what you think', 'How long is {milestone}, really?']), cover: 'the two milestones side by side, the gap as the headline' }),
    examples: Object.freeze(['How big is a billion, in seconds']),
    notes: 'Works for any scale gap. Weak when the numbers are already famous: find a fresher unit than seconds.'
  }),
  Object.freeze({
    schema: SKELETON_SCHEMA,
    id: 'if-it-were',
    title: 'If it were…',
    version: '2026-10',
    family: 'if-were',
    fits: Object.freeze(['\\bif (the |it |earth|history|the universe|your)\\w*', '\\b(history|timeline|age|evolution|universe|planet|years ago)\\b', '\\b(scaled? (down|up)|in one (day|year|hour))\\b']),
    media: Object.freeze(['motion']),
    aspects: Object.freeze(['9:16']),
    duration: Object.freeze({ min: 20, target: 35, max: 50 }),
    script_format: 'short-form',
    hook: Object.freeze({ template: 'If {big thing} were {familiar span}, {surprising fact}.', rule: 'Rescale something huge into something the viewer lives in (a day, a football pitch, a year).' }),
    beats: Object.freeze([
      beat('hook', 'hook', 'Rescale', 0.14, 'The rescale and its most surprising consequence, in one line.'),
      beat('frame', 'promise', 'The frame', 0.12, 'Set the familiar span on screen: where it starts and ends.'),
      beat('marks', 'proof', 'Landmarks', 0.26, 'Two or three landmarks placed on the span, each later than the viewer expects.'),
      beat('turn', 'escalation', 'The squeeze', 0.18, 'Everything the viewer knows crammed into the last sliver.'),
      beat('share', 'share', 'Reframe', 0.2, 'What that makes us, in one line worth repeating.'),
      beat('loop', 'cta_or_loop', 'Loop', 0.1, LOOP)
    ]),
    key_shot: Object.freeze({ describe: 'the familiar span (a clock, a ruler, a pitch) with the landmarks squeezed into its last sliver', modules: Object.freeze(['timeline', 'number-line', 'countdown', 'progress-ring', 'percent-fill']) }),
    first_frame: Object.freeze({ describe: 'the familiar span itself (a clock face, a calendar), never a title card', modules: Object.freeze(['timeline', 'countdown', 'progress-ring', 'number-line', 'photo-scene', 'object-card']) }),
    avoid: Object.freeze(['a title card as the hook', 'a wall of dates', 'numbers without the span on screen']),
    share: Object.freeze({ kind: 'surprise', rule: 'A reframe the viewer can repeat ("all of history fits in the last seconds before midnight").' }),
    voice: Object.freeze({ tier: 'free', delivery: 'calm wonder, unhurried' }),
    sound: Object.freeze({ density: 'normal', long_cues: 'rare' }),
    packaging: Object.freeze({ titles: Object.freeze(['If {big thing} were {familiar span}', '{big thing}, squeezed into {familiar span}']), cover: 'the span with one tiny marked sliver' }),
    examples: Object.freeze(["If Earth's history were one day"]),
    notes: 'The span must be one the viewer feels (a day, a year), not another big number.'
  }),
  Object.freeze({
    schema: SKELETON_SCHEMA,
    id: 'versus',
    title: 'X vs Y',
    version: '2026-10',
    family: 'versus',
    fits: Object.freeze(['\\b(vs\\.?|versus|compared? (to|with)|better than|difference between)\\b', '\\b(which (is|one)|should you)\\b']),
    media: Object.freeze(['motion', 'demo']),
    aspects: Object.freeze(['9:16', '1:1']),
    duration: Object.freeze({ min: 20, target: 35, max: 60 }),
    script_format: 'short-form',
    hook: Object.freeze({ template: '{X} or {Y}? {the thing everyone gets wrong}.', rule: 'Name both sides and the stake in the first line.' }),
    beats: Object.freeze([
      beat('hook', 'hook', 'The match-up', 0.14, 'Both sides and the stake.'),
      beat('round-1', 'proof', 'Round one', 0.2, 'The first comparison, side by side, on one concrete measure.'),
      beat('round-2', 'escalation', 'Round two', 0.2, 'A second measure that cuts the other way.'),
      beat('verdict', 'payoff', 'Verdict', 0.2, 'Which one, for whom, from the evidence.'),
      beat('share', 'share', 'The argument', 0.16, 'The line people will argue with, grounded in the evidence.'),
      beat('cta', 'cta_or_loop', 'Close', 0.1, 'One action, or a loop back to the match-up.')
    ]),
    key_shot: Object.freeze({ describe: 'a split frame that resolves to one side', modules: Object.freeze(['compare', 'comparison-table', 'flow-compare', 'gauge-compare', 'bar-chart']) }),
    first_frame: Object.freeze({ describe: 'both sides on screen at once, never a title card', modules: Object.freeze(['compare', 'comparison-table', 'gauge-compare', 'photo-scene', 'device-frame']) }),
    avoid: Object.freeze(['a title card as the hook', 'a verdict with no evidence', 'more than two sides']),
    share: Object.freeze({ kind: 'debate', rule: 'A claim people will argue with in the comments, and only one the evidence supports.' }),
    voice: Object.freeze({ tier: 'free', delivery: 'punchy, a little cheeky' }),
    sound: Object.freeze({ density: 'normal', long_cues: 'rare' }),
    packaging: Object.freeze({ titles: Object.freeze(['{X} vs {Y}: {stake}', 'Stop choosing {X} for {stake}']), cover: 'the two sides split down the middle, the winner a shade brighter' }),
    examples: Object.freeze(['Renting vs buying, by the numbers']),
    notes: 'Needs a real measure on each side; a vibe comparison reads as an opinion piece.'
  }),
  Object.freeze({
    schema: SKELETON_SCHEMA,
    id: 'nobody-tells',
    title: 'What nobody tells you',
    version: '2026-10',
    family: 'nobody-tells',
    fits: Object.freeze(['\\b(nobody|no one) tells?\\b', '\\b(hidden|secret|real) (cost|price|truth|reason)\\b', '\\b(mistakes?|regrets?|wish i knew|before you)\\b']),
    media: Object.freeze(['motion', 'footage']),
    aspects: Object.freeze(['9:16']),
    duration: Object.freeze({ min: 20, target: 35, max: 60 }),
    script_format: 'short-form',
    hook: Object.freeze({ template: 'Nobody tells you {the hidden cost} of {the thing}.', rule: 'Name the thing the viewer already does and promise the part they have not been told.' }),
    beats: Object.freeze([
      beat('hook', 'hook', 'The promise', 0.14, 'The thing and the hidden part.'),
      beat('known', 'promise', 'What you know', 0.14, 'The version everyone hears, in one line.'),
      beat('hidden', 'proof', 'What is under it', 0.28, 'The hidden cost, with one concrete example from the brief.'),
      beat('fix', 'payoff', 'What to do', 0.2, 'One thing the viewer can do about it.'),
      beat('share', 'share', 'Takeaway', 0.14, 'The takeaway worth saving, in one line.'),
      beat('cta', 'cta_or_loop', 'Close', 0.1, 'One action, or a loop.')
    ]),
    key_shot: Object.freeze({ describe: 'the hidden cost revealed underneath the known one', modules: Object.freeze(['stacked-bar', 'waterfall', 'object-card', 'excerpt', 'torn-paper', 'callout-arrow']) }),
    first_frame: Object.freeze({ describe: 'the familiar thing itself (the receipt, the contract, the habit), never a title card', modules: Object.freeze(['object-card', 'photo-scene', 'excerpt', 'device-frame', 'polaroid']) }),
    avoid: Object.freeze(['a title card as the hook', 'a list of five tips', 'fear without a fix']),
    share: Object.freeze({ kind: 'useful', rule: 'A takeaway the viewer will save or send to someone about to do the thing.' }),
    voice: Object.freeze({ tier: 'free', delivery: 'frank, a friend letting you in on it' }),
    sound: Object.freeze({ density: 'low', long_cues: 'rare' }),
    packaging: Object.freeze({ titles: Object.freeze(['What nobody tells you about {the thing}', 'The hidden cost of {the thing}']), cover: 'the familiar thing with its hidden part torn open' }),
    examples: Object.freeze(['What nobody tells you about your first mortgage']),
    notes: 'The hidden part must come from the brief or evidence; never invent one.'
  }),
  Object.freeze({
    schema: SKELETON_SCHEMA,
    id: 'countdown',
    title: 'Countdown to number one',
    version: '2026-10',
    family: 'countdown',
    fits: Object.freeze(['\\b(top (\\d+|three|five|ten)|ranked|ranking|countdown)\\b|\\b(\\d+|three|five|seven|ten) (things|ways|reasons|signs|tools|places)\\b', '\\b(best|worst|biggest)\\b']),
    media: Object.freeze(['motion']),
    aspects: Object.freeze(['9:16']),
    duration: Object.freeze({ min: 25, target: 40, max: 60 }),
    script_format: 'short-form',
    hook: Object.freeze({ template: 'The {n} {things}, and number one {surprising claim}.', rule: 'Tease number one in the hook; it pays off last.' }),
    beats: Object.freeze([
      beat('hook', 'hook', 'The tease', 0.12, 'The list and a tease of number one.'),
      beat('low', 'proof', 'The lower ranks', 0.3, 'The lower entries, quickly, each with one concrete detail.'),
      beat('rehook', 'rehook', 'Before number one', 0.1, 'A turn before the top: "but number one…".'),
      beat('top', 'payoff', 'Number one', 0.24, 'Number one, held, with its proof.'),
      beat('share', 'share', 'Why it matters', 0.14, 'The takeaway worth saving.'),
      beat('loop', 'cta_or_loop', 'Loop', 0.1, LOOP)
    ]),
    key_shot: Object.freeze({ describe: 'number one revealed last, bigger than the rest', modules: Object.freeze(['leaderboard', 'countdown', 'icon-grid', 'stat-card', 'object-card']) }),
    first_frame: Object.freeze({ describe: 'the list in motion, number one hidden, never a title card', modules: Object.freeze(['leaderboard', 'icon-grid', 'countdown', 'object-card', 'photo-scene']) }),
    avoid: Object.freeze(['a title card as the hook', 'numbered slides of equal weight', 'number one revealed early']),
    share: Object.freeze({ kind: 'useful', rule: 'A takeaway worth saving; the ranking itself is worth sending.' }),
    voice: Object.freeze({ tier: 'free', delivery: 'brisk, building to the top' }),
    sound: Object.freeze({ density: 'normal', long_cues: 'rare' }),
    packaging: Object.freeze({ titles: Object.freeze(['The {n} {things}, ranked', 'Number one surprised me']), cover: 'the list with number one blurred or hidden' }),
    examples: Object.freeze(['Five tools, ranked by how much time they save']),
    notes: 'Keep it to three to five entries in a Short; every entry needs one concrete detail.'
  }),
  Object.freeze({
    schema: SKELETON_SCHEMA,
    id: 'myth-check',
    title: 'Myth check',
    version: '2026-10',
    family: 'myth',
    fits: Object.freeze(['\\b(myths?|misconceptions?|true or false|wrong about|debunk\\w*)\\b', '\\b(everyone (thinks|says|believes)|you were told|actually)\\b']),
    media: Object.freeze(['motion', 'footage']),
    aspects: Object.freeze(['9:16']),
    duration: Object.freeze({ min: 20, target: 35, max: 60 }),
    script_format: 'explainer',
    hook: Object.freeze({ template: 'You were told {myth}. {it is wrong / it is worse}.', rule: 'State the belief the viewer holds, then signal it is about to fall.' }),
    beats: Object.freeze([
      beat('hook', 'hook', 'The myth', 0.14, 'The belief, stated as the viewer would.'),
      beat('why', 'promise', 'Why we believe it', 0.14, 'Where it comes from, in one line.'),
      beat('test', 'proof', 'The test', 0.28, 'The evidence that overturns it, from the brief.'),
      beat('truth', 'payoff', 'What is true', 0.2, 'The real answer, plainly.'),
      beat('share', 'share', 'The reframe', 0.14, 'The line the viewer will use to correct someone.'),
      beat('loop', 'cta_or_loop', 'Loop', 0.1, LOOP)
    ]),
    key_shot: Object.freeze({ describe: 'the myth stamped on screen, then overturned', modules: Object.freeze(['concept-card', 'object-card', 'sticker', 'badge', 'stat-card', 'excerpt']) }),
    first_frame: Object.freeze({ describe: 'the myth as a thing (the advice, the headline, the habit), never a title card', modules: Object.freeze(['excerpt', 'object-card', 'photo-scene', 'quote-card', 'feed-frame']) }),
    avoid: Object.freeze(['a title card as the hook', 'a "myth vs fact" table', 'a debunk without a source']),
    share: Object.freeze({ kind: 'surprise', rule: 'A reframe the viewer can use to correct someone, with its source.' }),
    voice: Object.freeze({ tier: 'free', delivery: 'confident, a little playful' }),
    sound: Object.freeze({ density: 'normal', long_cues: 'rare' }),
    packaging: Object.freeze({ titles: Object.freeze(['{myth}? Not quite', 'You were told {myth}']), cover: 'the myth with a stamp across it' }),
    examples: Object.freeze(['You only use 10% of your brain?']),
    notes: 'The overturning evidence must be in EVIDENCE.md or the brief.'
  }),
  Object.freeze({
    schema: SKELETON_SCHEMA,
    id: 'last-time',
    title: 'The last time',
    version: '2026-10',
    family: 'last-time',
    fits: Object.freeze(['\\b(the )?last time\\b', '\\b(one day|grow(ing)? up|parents?|dad|mum|mom|kids?|childhood|family|remember|nostalgi\\w*)\\b']),
    media: Object.freeze(['character']),
    aspects: Object.freeze(['9:16']),
    duration: Object.freeze({ min: 20, target: 30, max: 45 }),
    script_format: 'story',
    hook: Object.freeze({ template: 'There was a last time {ordinary moment}. Neither of you knew it.', rule: 'One ordinary, universal moment, and the realisation that it ended without anyone noticing.' }),
    beats: Object.freeze([
      beat('hook', 'hook', 'The moment', 0.16, 'The ordinary moment, and that it was the last.'),
      beat('then', 'proof', 'Then', 0.22, 'Two more ordinary lasts, each a concrete picture.'),
      beat('jump', 'escalation', 'The jump', 0.2, 'Years pass in a cut: the roles turn around.'),
      beat('now', 'payoff', 'Now', 0.16, 'The other person, now, still holding on to it.'),
      beat('share', 'share', 'The call', 0.16, 'The one thing to do today.'),
      beat('end', 'closing_reframe', 'Close', 0.1, 'A quiet line that lands the feeling.')
    ]),
    key_shot: Object.freeze({ describe: 'the parent lifting the child, the moment the title promises', modules: Object.freeze(['cast-scene']), requires: Object.freeze({ poses: Object.freeze(['lift']) }) }),
    first_frame: Object.freeze({ describe: 'the two characters in the ordinary moment, faces readable, never a title card', modules: Object.freeze(['cast-scene', 'character-cameo', 'photo-scene']) }),
    avoid: Object.freeze(['a title card as the hook', 'captions across the characters', 'figures too small to read their faces']),
    share: Object.freeze({ kind: 'act', rule: 'One small act the viewer can do today ("so call him").' }),
    voice: Object.freeze({ tier: 'human-or-premium', delivery: 'warm, slow, close to the microphone' }),
    sound: Object.freeze({ density: 'low', long_cues: 'rare' }),
    packaging: Object.freeze({ titles: Object.freeze(['The last time {ordinary moment}', 'Nobody tells you when it is the last time']), cover: 'the two characters in the moment, warm light, one word of text' }),
    examples: Object.freeze(['The last time your dad picked you up']),
    notes: 'Blocked until the rig can lift a child; without the lift the hook promises a moment the video never shows.'
  }),
  Object.freeze({
    schema: SKELETON_SCHEMA,
    id: 'pov',
    title: 'POV',
    version: '2026-10',
    family: 'pov',
    fits: Object.freeze(['\\b(pov|that moment when|relatable)\\b', '\\b(when you|you know (that|when)|every (founder|parent|developer|student))\\b']),
    media: Object.freeze(['character']),
    aspects: Object.freeze(['9:16']),
    duration: Object.freeze({ min: 15, target: 25, max: 40 }),
    script_format: 'short-form',
    hook: Object.freeze({ template: 'POV: {the viewer\'s exact situation}.', rule: 'The viewer\'s own situation, specific enough that they feel seen.' }),
    beats: Object.freeze([
      beat('hook', 'hook', 'The situation', 0.16, 'The viewer\'s exact situation.'),
      beat('build', 'proof', 'It gets worse', 0.3, 'Two or three beats of the situation getting more familiar.'),
      beat('turn', 'payoff', 'The turn', 0.2, 'The twist or the small win.'),
      beat('share', 'share', 'Recognition', 0.2, 'The line they will send to the friend who does this.'),
      beat('loop', 'cta_or_loop', 'Loop', 0.14, LOOP)
    ]),
    key_shot: Object.freeze({ describe: 'the character caught in the viewer\'s situation, their face doing the work', modules: Object.freeze(['cast-scene']), requires: Object.freeze({ actions: Object.freeze(['look-far']) }) }),
    first_frame: Object.freeze({ describe: 'the character mid-situation, never a title card', modules: Object.freeze(['cast-scene', 'character-cameo']) }),
    avoid: Object.freeze(['a title card as the hook', 'a narrator explaining the joke']),
    share: Object.freeze({ kind: 'identity', rule: 'A line the viewer sends to the friend who does exactly this.' }),
    voice: Object.freeze({ tier: 'better', delivery: 'deadpan, close' }),
    sound: Object.freeze({ density: 'normal', long_cues: 'rare' }),
    packaging: Object.freeze({ titles: Object.freeze(['POV: {situation}', 'Every {person} knows this feeling']), cover: 'the character\'s face at the worst moment' }),
    examples: Object.freeze(['POV: your demo breaks in front of the investor']),
    notes: 'Specific beats general: the more exact the situation, the more it travels.'
  }),
  Object.freeze({
    schema: SKELETON_SCHEMA,
    id: 'before-after',
    title: 'Before and after',
    version: '2026-10',
    family: 'before-after',
    fits: Object.freeze(['\\b(before (and|&) after|transform\\w*|makeover)\\b', '\\b(product|app|tool|feature|launch\\w*)\\b']),
    media: Object.freeze(['demo', 'footage', 'motion']),
    aspects: Object.freeze(['9:16', '1:1', '16:9']),
    duration: Object.freeze({ min: 15, target: 30, max: 60 }),
    script_format: 'promo',
    hook: Object.freeze({ template: 'This is {the painful before}. Watch.', rule: 'Open on the before, in the viewer\'s own words; the product can wait.' }),
    beats: Object.freeze([
      beat('hook', 'hook', 'Before', 0.18, 'The before, concrete and recognisable.'),
      beat('switch', 'mechanism', 'The switch', 0.18, 'The one change, shown, not described.'),
      beat('after', 'proof', 'After', 0.26, 'The same frame after, with one measured difference from the brief.'),
      beat('share', 'share', 'The difference', 0.18, 'The difference in one line worth sending.'),
      beat('cta', 'cta_or_loop', 'Call to action', 0.2, 'One action, one destination.')
    ]),
    key_shot: Object.freeze({ describe: 'the same frame, before and after', modules: Object.freeze(['compare', 'product-demo', 'app-stage', 'phone-stage', 'device-frame', 'media-window']) }),
    first_frame: Object.freeze({ describe: 'the before, on screen, never a title card or a logo', modules: Object.freeze(['product-demo', 'app-stage', 'phone-stage', 'device-frame', 'media-window', 'photo-scene']) }),
    avoid: Object.freeze(['a logo as the hook', 'a feature list', 'an after with no before']),
    share: Object.freeze({ kind: 'useful', rule: 'The difference, measured, in one line worth sending to a colleague.' }),
    voice: Object.freeze({ tier: 'free', delivery: 'plain, confident' }),
    sound: Object.freeze({ density: 'normal', long_cues: 'rare' }),
    packaging: Object.freeze({ titles: Object.freeze(['{task}: before and after {product}', 'From {before} to {after}']), cover: 'the before and after split, the after brighter' }),
    examples: Object.freeze(['Our onboarding, before and after one change']),
    notes: 'The after must be real: a recording or a fact from the brief.'
  }),
  Object.freeze({
    schema: SKELETON_SCHEMA,
    id: 'how-its-made',
    title: 'How it is made',
    version: '2026-10',
    family: 'process',
    fits: Object.freeze(['\\b(how (it|they|we|this) (is |are )?(made|built)|how .{1,30} (is|are|gets?) made|behind the scenes|step by step)\\b', '\\b(factory|workshop|recipe|process)\\b']),
    media: Object.freeze(['footage', 'motion']),
    aspects: Object.freeze(['9:16']),
    duration: Object.freeze({ min: 20, target: 40, max: 60 }),
    script_format: 'explainer',
    hook: Object.freeze({ template: 'Every {thing} goes through {the step nobody sees}.', rule: 'Lead with the step people never see, not step one.' }),
    beats: Object.freeze([
      beat('hook', 'hook', 'The unseen step', 0.14, 'The step nobody sees.'),
      beat('start', 'promise', 'Where it starts', 0.14, 'The raw start, one concrete picture.'),
      beat('steps', 'mechanism', 'The steps', 0.3, 'Two or three steps, each a visible change to the thing.'),
      beat('reveal', 'payoff', 'The unseen step', 0.18, 'The step from the hook, shown at last.'),
      beat('share', 'share', 'Takeaway', 0.14, 'What the viewer will notice next time they see one.'),
      beat('loop', 'cta_or_loop', 'Loop', 0.1, LOOP)
    ]),
    key_shot: Object.freeze({ describe: 'the one step people never see, shown in full', modules: Object.freeze(['process-steps', 'flow-compare', 'photo-scene', 'footage-callout', 'zoom-through']) }),
    first_frame: Object.freeze({ describe: 'the thing mid-process, never a title card', modules: Object.freeze(['photo-scene', 'process-steps', 'footage-callout', 'zoom-through', 'object-card']) }),
    avoid: Object.freeze(['a title card as the hook', 'step one first', 'a diagram with no real object']),
    share: Object.freeze({ kind: 'useful', rule: 'Something the viewer will notice next time they see the thing.' }),
    voice: Object.freeze({ tier: 'free', delivery: 'curious, measured' }),
    sound: Object.freeze({ density: 'normal', long_cues: 'rare' }),
    packaging: Object.freeze({ titles: Object.freeze(['How {thing} is really made', 'The step nobody sees in {thing}']), cover: 'the unseen step, close up' }),
    examples: Object.freeze(['How a pencil gets its lead']),
    notes: 'Strongest with real footage; in motion, use object scenes, not diagrams.'
  })
]);

// ---------------------------------------------------------------------------
// Loading and validation

/** Problems with a skeleton definition: [] when it is usable. */
export function skeletonProblems(skeleton) {
  const problems = [];
  const where = skeleton?.id ? `skeleton ${skeleton.id}` : 'a skeleton';
  if (!skeleton || typeof skeleton !== 'object') return ['a skeleton must be an object'];
  if (skeleton.schema !== SKELETON_SCHEMA) problems.push(`${where}: schema must be ${SKELETON_SCHEMA}`);
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(String(skeleton.id ?? ''))) problems.push(`${where}: id must be lowercase letters, digits and dashes`);
  if (!SKELETON_FAMILIES.includes(skeleton.family)) problems.push(`${where}: family must be one of ${SKELETON_FAMILIES.join(', ')}`);
  if (!/^\d{4}-\d{2}$/.test(String(skeleton.version ?? ''))) problems.push(`${where}: version must be a month (YYYY-MM)`);
  if (!Array.isArray(skeleton.media) || !skeleton.media.length || skeleton.media.some((medium) => !SKELETON_MEDIA.includes(medium))) problems.push(`${where}: media must list ${SKELETON_MEDIA.join(', ')}`);
  if (!SCRIPT_FORMAT_IDS.includes(skeleton.script_format)) problems.push(`${where}: script_format must be one of ${SCRIPT_FORMAT_IDS.join(', ')}`);
  const beats = Array.isArray(skeleton.beats) ? skeleton.beats : [];
  if (beats.length < 4) problems.push(`${where}: needs at least four beats`);
  for (const entry of beats) if (!SKELETON_BEAT_ROLES.includes(entry?.role) || !entry?.id || !entry?.rule) problems.push(`${where}: beat ${entry?.id ?? '?'} needs an id, a rule and a role (${SKELETON_BEAT_ROLES.join(', ')})`);
  if (beats[0]?.role !== 'hook') problems.push(`${where}: the first beat is the hook`);
  if (!beats.some((entry) => entry?.role === 'share')) problems.push(`${where}: needs a share beat`);
  const total = beats.reduce((sum, entry) => sum + Number(entry?.share ?? 0), 0);
  if (beats.length && Math.abs(total - 1) > 0.02) problems.push(`${where}: beat shares sum to ${total.toFixed(2)}, not 1`);
  if (!Array.isArray(skeleton.key_shot?.modules) || !skeleton.key_shot.modules.length) problems.push(`${where}: key_shot.modules is required`);
  if (!Array.isArray(skeleton.first_frame?.modules) || !skeleton.first_frame.modules.length) problems.push(`${where}: first_frame.modules is required`);
  if (!SHARE_KINDS.includes(skeleton.share?.kind)) problems.push(`${where}: share.kind must be one of ${SHARE_KINDS.join(', ')}`);
  if (!VOICE_TIERS.includes(skeleton.voice?.tier)) problems.push(`${where}: voice.tier must be one of ${VOICE_TIERS.join(', ')}`);
  for (const pattern of skeleton.fits ?? []) {
    try { new RegExp(pattern, 'i'); } catch { problems.push(`${where}: fits pattern ${pattern} is not a valid regular expression`); }
  }
  return problems;
}

/**
 * The library with the user's own skeletons merged in: [{skeleton, source}]
 * in order, later wins by id. → {skeletons: [skeleton], problems: [text]}
 */
export function mergeSkeletons(extra = []) {
  const byId = new Map(LIBRARY_SKELETONS.map((skeleton) => [skeleton.id, { ...skeleton, source: 'built-in' }]));
  const problems = [];
  for (const { skeleton, source } of extra) {
    const issues = skeletonProblems(skeleton);
    if (issues.length) { problems.push(...issues.map((issue) => `${source}: ${issue}`)); continue; }
    byId.set(skeleton.id, { ...skeleton, source });
  }
  return { skeletons: [...byId.values()], problems };
}

/** A library skeleton by id (from mergeSkeletons().skeletons, else the starters). */
export function skeletonById(id, skeletons = LIBRARY_SKELETONS) {
  return skeletons.find((skeleton) => skeleton.id === String(id ?? '').trim().toLowerCase()) ?? null;
}

/** Whether a skeleton is past its review month (version + REVIEW_MONTHS) at `now`. */
export function skeletonStale(skeleton, now = new Date()) {
  const [year, month] = String(skeleton?.version ?? '').split('-').map(Number);
  if (!year || !month) return false;
  return now >= new Date(Date.UTC(year, month - 1 + REVIEW_MONTHS, 1));
}

// ---------------------------------------------------------------------------
// Feasibility: can the kit render the key shot?

/** What the kit can draw: {modules, poses, actions, sets} as Sets. */
export function kitCapabilities() {
  return {
    modules: new Set([...Object.keys(catalogModules()), ...EDITORIAL_KINDS]),
    poses: new Set(POSES),
    actions: new Set(ACTIONS),
    sets: new Set(SETS)
  };
}

/**
 * Whether the kit renders a skeleton's key shot: at least one of its modules
 * exists, and every pose, action and set it requires does. → {ok, missing: [text]}
 */
export function skeletonFeasibility(skeleton, kit = kitCapabilities()) {
  const missing = [];
  const modules = skeleton?.key_shot?.modules ?? [];
  if (!modules.some((id) => kit.modules.has(id))) missing.push(`a key-shot module (${modules.join(', ')})`);
  const requires = skeleton?.key_shot?.requires ?? {};
  for (const [kind, label] of [['poses', 'pose'], ['actions', 'action'], ['sets', 'set']]) {
    for (const id of requires[kind] ?? []) if (!kit[kind]?.has(id)) missing.push(`${label} ${id}`);
  }
  return { ok: !missing.length, missing };
}

// ---------------------------------------------------------------------------
// Choosing a skeleton

const aspectName = (aspect) => {
  const text = aspect && typeof aspect === 'object' ? `${aspect.width}:${aspect.height}` : String(aspect ?? '').trim();
  const match = /^(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)$/.exec(text);
  if (!match) return null;
  const ratio = Number(match[1]) / Number(match[2]);
  return ratio < 0.8 ? '9:16' : ratio > 1.25 ? '16:9' : '1:1';
};

/**
 * Pick a library skeleton for a brief. requested: a library skeleton id,
 * "auto" (the default) or "none". auto chooses only for a video of
 * SHORT_VIDEO_SECONDS or less, among skeletons that fit the medium and aspect,
 * whose key shot the kit renders, and whose first `fits` pattern (its own
 * cue) the prompt matches; the most matching patterns wins, ties go to library order. With no match the
 * script format's own skeleton is used, so nothing changes for a brief that
 * fits none. An explicit id is used even when it fits loosely, but never when
 * the kit can't render its key shot.
 * options: {prompt, duration, aspect, medium ("motion" | "character" |
 * "footage" | "demo"), requested, skeletons, kit}
 * → {skeleton | null, reasons: [text], candidates: [{id, score}], blocked: [{id, missing}]}
 */
export function chooseSkeleton(options = {}) {
  const { prompt = '', duration = 30, aspect = '9:16', medium = 'motion', requested = 'auto', skeletons = LIBRARY_SKELETONS, kit = kitCapabilities() } = options;
  const blocked = [];
  const wanted = String(requested ?? 'auto').trim().toLowerCase() || 'auto';
  for (const skeleton of skeletons) {
    const feasible = skeletonFeasibility(skeleton, kit);
    if (!feasible.ok) blocked.push({ id: skeleton.id, missing: feasible.missing });
  }
  const isBlocked = (id) => blocked.some((entry) => entry.id === id);
  if (wanted === 'none') return { skeleton: null, reasons: ['no library skeleton: --skeleton none'], candidates: [], blocked };
  if (wanted !== 'auto') {
    const skeleton = skeletonById(wanted, skeletons);
    if (!skeleton) return { skeleton: null, reasons: [], candidates: [], blocked, unknown: wanted };
    if (isBlocked(skeleton.id)) throw new Error(`skeleton ${skeleton.id} is blocked: the kit can't render its key shot (needs ${blocked.find((entry) => entry.id === skeleton.id).missing.join(', ')})`);
    return { skeleton, reasons: [`skeleton ${skeleton.id}: --skeleton`], candidates: [{ id: skeleton.id, score: null }], blocked };
  }
  const seconds = Number(duration) || 30;
  if (seconds > SHORT_VIDEO_SECONDS) return { skeleton: null, reasons: [`no library skeleton: ${seconds} s is longer than a short video (the library is for ${SHORT_VIDEO_SECONDS} s or less)`], candidates: [], blocked };
  const ratio = aspectName(aspect) ?? '9:16';
  const text = String(prompt);
  const candidates = [];
  for (const skeleton of skeletons) {
    if (isBlocked(skeleton.id) || !skeleton.media.includes(medium) || !skeleton.aspects.includes(ratio)) continue;
    // The first cue is the skeleton's own; the rest only add to a match.
    if (!skeleton.fits?.length || !new RegExp(skeleton.fits[0], 'i').test(text)) continue;
    const score = (skeleton.fits ?? []).reduce((sum, pattern) => sum + (new RegExp(pattern, 'i').test(text) ? 1 : 0), 0);
    if (score > 0) candidates.push({ id: skeleton.id, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) {
    // Say when the brief fits a skeleton the kit can't draw yet: that is the kit's backlog, not a bad brief.
    const wouldFit = skeletons.filter((skeleton) => isBlocked(skeleton.id) && skeleton.media.includes(medium) && skeleton.fits?.length && new RegExp(skeleton.fits[0], 'i').test(text));
    const note = wouldFit.map((skeleton) => `${skeleton.id} fits but is blocked (needs ${blocked.find((entry) => entry.id === skeleton.id).missing.join(', ')})`);
    return { skeleton: null, reasons: [`no library skeleton fits this ${medium} brief for ${ratio}${note.length ? `: ${note.join('; ')}` : ''}; the script format's own skeleton is used`], candidates, blocked };
  }
  const skeleton = skeletonById(candidates[0].id, skeletons);
  const also = candidates.slice(1, 3).map((entry) => entry.id);
  return { skeleton, reasons: [`skeleton ${skeleton.id}: the brief matches ${candidates[0].score} of its cues${also.length ? ` (also fit: ${also.join(', ')})` : ''}`], candidates, blocked };
}

// ---------------------------------------------------------------------------
// Prompt lines

/** A skeleton's beats as script-plan beats with word and second budgets. */
export function skeletonPlanBeats(skeleton, { duration, words }) {
  return skeleton.beats.map((entry) => ({ id: entry.id, role: entry.role, label: entry.label, share: entry.share, words: Math.max(3, Math.round(words * entry.share)), seconds: Math.round(duration * entry.share * 10) / 10, rule: entry.rule }));
}

/**
 * The script plan for a video on a library skeleton: chooseScriptPlan() with
 * the skeleton's script format (unless options.format says otherwise), its
 * beats (with their roles) in place of the format's default skeleton, and
 * plan.structure carrying its prompt lines, which scriptPlanLines() writes
 * into the script pass.
 */
export function skeletonScriptPlan(options, skeleton) {
  const plan = chooseScriptPlan({ ...options, format: options.format ?? skeleton.script_format });
  return {
    ...plan,
    skeleton: skeleton.id,
    beats: skeletonPlanBeats(skeleton, { duration: plan.duration, words: plan.word_target }),
    reasons: [...plan.reasons, `skeleton ${skeleton.id}: the ${skeleton.title} structure from the skeleton library`],
    structure: { id: skeleton.id, version: skeleton.version, title: skeleton.title, lines: skeletonPlanLines(skeleton) }
  };
}

/**
 * A skeleton as prompt lines for the script pass, the storyboard planner and
 * the critic: hook, share line, key shot, first frame, what to avoid, voice
 * and packaging.
 */
export function skeletonPlanLines(skeleton) {
  const requires = skeleton.key_shot.requires ? ` (needs ${Object.entries(skeleton.key_shot.requires).map(([kind, ids]) => `${kind} ${ids.join(', ')}`).join('; ')})` : '';
  return [
    `Structure: ${skeleton.title} (${skeleton.id}). ${skeleton.notes ?? ''}`.trim(),
    `Hook: ${skeleton.hook.rule} Template: "${skeleton.hook.template}".`,
    `Share line (${skeleton.share.kind}): ${skeleton.share.rule}`,
    `Key shot (the image this structure cannot work without): ${skeleton.key_shot.describe}. Render it with ${skeleton.key_shot.modules.join(' or ')}${requires}, inside the beat it belongs to.`,
    `Opening image: ${skeleton.first_frame.describe} (${skeleton.first_frame.modules.join(', ')}).`,
    `Avoid: ${skeleton.avoid.join('; ')}.`,
    `Voice: ${skeleton.voice.delivery}${skeleton.voice.tier === 'human-or-premium' ? ' (this structure needs a human or premium read for the final; draft with the free voice)' : ''}.`,
    `Titles: shapes that suit it: ${skeleton.packaging.titles.map((title) => `"${title}"`).join(', ')}. Cover: ${skeleton.packaging.cover}.`
  ];
}

// ---------------------------------------------------------------------------
// The structure gate

const sceneModule = (scene) => scene?.module ?? scene?.kind ?? null;
const ABSTRACT_NOUNS = /^(the )?(growth|gap|scale|difference|idea|concept|change|result|impact|value|truth|feeling|emotion|time|future|success|problem|solution)s?$/i;

/** Whether the short-video quality rules apply: a story of SHORT_VIDEO_SECONDS or less. */
export function isShortVideo(story) {
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration);
  return Number.isFinite(duration) && duration > 0 && duration <= SHORT_VIDEO_SECONDS;
}

/**
 * The structure gate's checks on a storyboard: the short-video rules every
 * video of SHORT_VIDEO_SECONDS or less meets, plus the key shot when it is
 * built on a library skeleton.
 *   first_frame       an image opens the video, not a title card (skipped over a recording, which opens it)
 *   key_shot          the skeleton's key shot has a scene (library skeleton only)
 *   share_beat        a spoken share line in the last SHARE_WINDOW (on a library skeleton, in a story receipt, or when a beat has the role)
 *   concrete_visuals  no beat's visual noun is a bare abstraction (when beats name them)
 *   packaging         TITLE_OPTIONS title options (when the titles are known)
 * options: {words ([{text, start}]), beats ([{role, spoken|text, visual_noun?}]), titles ([text]), duration,
 *   requireShare (the beats are a story receipt whose author assigns roles, so a share beat is required)}
 * → {status: "passed" | "failed" | "skipped", skeleton?, checks, findings}
 */
export function structureCheck(story, skeleton = null, options = {}) {
  const duration = Number(options.duration ?? story?.resolved?.duration ?? story?.format?.duration) || 0;
  if (!skeleton && !(duration > 0 && duration <= SHORT_VIDEO_SECONDS)) return { status: 'skipped', reason: `longer than ${SHORT_VIDEO_SECONDS} s and on no library skeleton`, checks: {}, findings: [] };
  const scenes = (Array.isArray(story?.scenes) ? story.scenes : []).filter((scene) => (scene.track ?? 0) === 0 || scene.insert === true);
  const startOf = (scene) => Number(scene.start ?? scene.resolved?.start ?? 0);
  const checks = {};
  if (!storyBase(story)) {
    const opening = [...scenes].sort((a, b) => startOf(a) - startOf(b))[0] ?? null;
    const module = sceneModule(opening);
    const card = TITLE_CARD_MODULES.includes(module);
    const want = skeleton ? `; the structure wants ${skeleton.first_frame.describe}` : '';
    checks.first_frame = { ok: Boolean(opening) && startOf(opening) <= FIRST_FRAME_SECONDS && !card, detail: opening ? `opens on ${module} at ${startOf(opening)} s${card ? ' (a title card)' : ''}${want}` : 'no scene opens the video' };
  }
  let keyScenes = [];
  if (skeleton) {
    const requires = skeleton.key_shot.requires ?? {};
    keyScenes = scenes.filter((scene) => skeleton.key_shot.modules.includes(sceneModule(scene)) && castHas(scene, requires));
    checks.key_shot = { ok: keyScenes.length > 0, detail: keyScenes.length ? keyScenes.map((scene) => `${scene.id ?? sceneModule(scene)} (${sceneModule(scene)})`).join(', ') : `no scene renders the key shot (${skeleton.key_shot.describe}) with ${skeleton.key_shot.modules.join(', ')}` };
  }
  const beats = Array.isArray(options.beats) ? options.beats : [];
  if (skeleton || options.requireShare || beats.some((entry) => entry?.role === 'share')) {
    const share = beats.find((entry) => entry?.role === 'share' && String(entry.spoken ?? entry.text ?? '').trim());
    let ok = Boolean(share);
    let detail = share ? `"${String(share.spoken ?? share.text).trim().slice(0, 80)}"` : 'no share beat with a spoken line';
    if (share && Array.isArray(options.words) && options.words.length && duration) {
      const at = spokenAt(String(share.spoken ?? share.text), options.words);
      if (at === null) detail += ' (not found in the narration timings)';
      else {
        ok = at >= duration * (1 - SHARE_WINDOW) - 0.25;
        detail += ` at ${at.toFixed(2)} s${ok ? '' : `, before the last ${Math.round(SHARE_WINDOW * 100)}% (from ${(duration * (1 - SHARE_WINDOW)).toFixed(1)} s)`}`;
      }
    }
    checks.share_beat = { ok, detail };
  }
  if (beats.some((entry) => entry?.visual_noun)) {
    const abstract = beats.filter((entry) => entry?.visual_noun && ABSTRACT_NOUNS.test(String(entry.visual_noun).trim()));
    checks.concrete_visuals = { ok: !abstract.length, detail: abstract.length ? `abstract visual nouns: ${abstract.map((entry) => `${entry.role} "${entry.visual_noun}"`).join(', ')}` : 'every beat names a picturable thing' };
  }
  if (Array.isArray(options.titles)) checks.packaging = { ok: options.titles.length >= TITLE_OPTIONS, detail: `${options.titles.length} title option(s)${options.titles.length >= TITLE_OPTIONS ? '' : `; write ${TITLE_OPTIONS}, the best first`}` };
  const findings = Object.entries(checks).filter(([, entry]) => !entry.ok).map(([name, entry]) => `${name}: ${entry.detail}`);
  return { status: findings.length ? 'failed' : 'passed', ...(skeleton ? { skeleton: { id: skeleton.id, version: skeleton.version } } : {}), checks, findings };
}

/**
 * The checks a storyboard can fail before any render (the opening image and,
 * on a library skeleton, the key shot), worded for the planner's repair pass.
 * [] when it complies or the rules don't apply.
 */
export function storyboardStructureErrors(story, skeleton = null) {
  const { checks } = structureCheck(story, skeleton, {});
  const errors = [];
  if (checks.first_frame && !checks.first_frame.ok) errors.push(`opening: ${checks.first_frame.detail}. Open at 0 s on an image (${skeleton ? skeleton.first_frame.modules.join(', ') : 'a photo, object, chart, character or product scene'}) that shows the hook's subject; a title card (${TITLE_CARD_MODULES.join(', ')}) may follow, not open.`);
  if (checks.key_shot && !checks.key_shot.ok) errors.push(`skeleton ${skeleton.id}: ${checks.key_shot.detail}. Give the key shot (${skeleton.key_shot.describe}) its own scene inside the beat it belongs to.`);
  return errors;
}

function castHas(scene, requires) {
  const need = [...(requires.poses ?? []), ...(requires.actions ?? [])];
  if (!need.length) return true;
  const text = JSON.stringify(scene.params ?? {});
  return need.every((id) => text.includes(`"${id}"`));
}

/** The time (s) a line starts in the narration words, by its first three words; null when absent. */
function spokenAt(line, words) {
  const norm = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9']/g, '');
  const target = line.split(/\s+/).map(norm).filter(Boolean).slice(0, 3);
  if (!target.length) return null;
  const spoken = words.map((word) => norm(word.text ?? word.word));
  for (let i = 0; i + target.length <= spoken.length; i++) {
    if (target.every((token, k) => spoken[i + k] === token)) return Number(words[i].start ?? 0);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Skill reference

/** Markdown reference for the create-video skills (references/skeleton-library.md, generated). */
export function skeletonLibraryReference({ kit = kitCapabilities() } = {}) {
  const lines = [
    '# The skeleton library: structures that make a short video worth watching',
    '',
    '<!-- Generated from kit/core/skeleton-library.mjs by scripts/sync-skills.mjs. Do not edit by hand; run `npm run skills:sync`. -->',
    '',
    `Every short video (${SHORT_VIDEO_SECONDS} s or less) meets the same quality rules, and when the brief fits one of the structures below, it is built on that structure too. Nothing is switched on: \`launchclip make\` picks a library skeleton automatically when the brief fits (\`--skeleton <id>\` pins one, \`--skeleton none\` keeps the script format's own) and records it in \`SCRIPT.json\` and \`storyboard.json\` (\`"skeleton": {"id": "…"}\`). \`launchclip skeletons list|show|choose\` prints the library. The structures are dated practitioner heuristics, not guarantees.`,
    '',
    '## The short-video rules (every video of ' + SHORT_VIDEO_SECONDS + ' s or less)',
    '',
    `- **Open on an image.** The scene at 0 s shows the hook's subject (a photo, object, chart, character or product scene), never a title card (\`${TITLE_CARD_MODULES.join('`, `')}\`). A recording that opens the video counts as the image.`,
    `- **A share line.** One spoken line in the last ${Math.round(SHARE_WINDOW * 100)}% that gives a viewer a reason to send the video or comment: a surprise, a line they recognise themselves in, one small act, a grounded claim to argue with, or a takeaway worth saving. Give it the \`share\` role in \`STORY.json\`.`,
    '- **Concrete visuals.** Every beat\'s `visual_noun` names a thing the viewer can picture, never a bare abstraction ("the gap", "growth").',
    `- **${TITLE_OPTIONS} title options**, the best first.`,
    '',
    '`launchclip finish` checks these in its `structure` gate (and the key shot, on a library skeleton); `launchclip cinematic-check` reads the same gate.',
    '',
    '## Using the library on the agent path',
    '',
    '1. **Skeleton.** Run `launchclip skeletons choose "<brief>" --medium motion|character|footage|demo --aspect 9:16 --duration 30`, or read the table below. Never use a **blocked** skeleton: the kit cannot draw its key shot, so the video would promise a moment it never shows. No match is fine: use the script format\'s own skeleton and the short-video rules.',
    '2. **Angle.** Before the concepts, write `ANGLE.json`: `crowded` (how this topic is usually done, one sentence), `inventory` (eight to twelve concrete things only this subject has) and `angles` (three fresh angles, each saying how it differs from `crowded`). Spread the five concepts across the angles.',
    '3. **Judge** in a fresh context (a subagent that sees only the brief, evidence, the skeleton and the anonymous concepts), and score `angle_freshness` and `share_strength` with the other criteria.',
    '4. **Story.** Write `STORY.json` on the skeleton\'s beats, roles included.',
    '5. **Storyboard.** Put `"skeleton": {"id": "<id>", "version": "<month>"}` in `storyboard.json`; render the key shot inside its beat.',
    '6. **Voice.** A `human-or-premium` skeleton drafts with the free voice and says so in review: the final needs the user\'s own recording or an explicit premium opt-in.',
    '',
    '## Skeletons',
    '',
    '| Skeleton | Family | Media | Aspects | Length | Share | Voice | Status |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...LIBRARY_SKELETONS.map((skeleton) => {
      const feasible = skeletonFeasibility(skeleton, kit);
      return `| \`${skeleton.id}\` ${skeleton.title} | ${skeleton.family} | ${skeleton.media.join(', ')} | ${skeleton.aspects.join(', ')} | ${skeleton.duration.min}–${skeleton.duration.max} s | ${skeleton.share.kind} | ${skeleton.voice.tier} | ${feasible.ok ? 'ready' : `blocked: needs ${feasible.missing.join(', ')}`} |`;
    }),
    '',
    ...LIBRARY_SKELETONS.flatMap((skeleton) => [
      `### \`${skeleton.id}\`: ${skeleton.title}`,
      '',
      `- **Hook:** ${skeleton.hook.rule} Template: "${skeleton.hook.template}"`,
      `- **Beats:** ${skeleton.beats.map((entry) => `${entry.label} (${entry.role}, ~${Math.round(entry.share * 100)}%): ${entry.rule}`).join(' → ')}`,
      `- **Key shot:** ${skeleton.key_shot.describe} (${skeleton.key_shot.modules.map((id) => `\`${id}\``).join(', ')}${skeleton.key_shot.requires ? `; needs ${Object.entries(skeleton.key_shot.requires).map(([kind, ids]) => `${kind} ${ids.join(', ')}`).join('; ')}` : ''})`,
      `- **Opening image:** ${skeleton.first_frame.describe} (${skeleton.first_frame.modules.map((id) => `\`${id}\``).join(', ')})`,
      `- **Share (${skeleton.share.kind}):** ${skeleton.share.rule}`,
      `- **Avoid:** ${skeleton.avoid.join('; ')}`,
      `- **Voice:** ${skeleton.voice.tier}, ${skeleton.voice.delivery}. **Sound:** ${skeleton.sound.density} density, long cues ${skeleton.sound.long_cues}.`,
      `- **Titles:** ${skeleton.packaging.titles.map((title) => `"${title}"`).join(', ')}. **Cover:** ${skeleton.packaging.cover}.`,
      ...(skeleton.notes ? [`- **Notes:** ${skeleton.notes}`] : []),
      ''
    ]),
    '## Your own skeletons',
    '',
    `Add \`<project>/.launchclip/skeletons/<id>.json\` or \`~/.launchclip/skeletons/<id>.json\` with \`"schema": "${SKELETON_SCHEMA}"\` and the same fields; a project skeleton overrides a user one, which overrides a built-in one with the same id. \`launchclip skeletons show <id>\` validates it.`,
    ''
  ];
  return `${lines.join('\n').trimEnd()}\n`;
}

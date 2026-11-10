// Storyboard planning prompt, generated from the module registry.
//
// planningPrompt() builds the instructions a model receives when it authors
// storyboard.json (docs/STORYBOARD_ENGINE_RFC.md §4, §5 and §7). Every module
// listed comes from knownModules() and each catalogue module's own
// describe/params/events, so a module added to the registry appears here
// without editing this file. storyboardModulesReference() renders the same
// sections as the skills' references/storyboard-modules.md
// (scripts/sync-skills.mjs writes it; `npm run skills:check` fails on drift).
//
// Plain ESM; imports only sibling kit/core files. Canonical copy:
// kit/core/planning-prompt.mjs.

import { STORY_SCHEMA, STORY_LANES, STORY_TRANSITIONS, STORY_CARD_TRANSITIONS as CARD_TRANSITIONS, STORY_CAPTION_STYLES, STORY_CAMERA_LAYOUTS, STORY_AMBIENT_LEVELS } from './story.mjs';
import { GRAMMARS, GRAMMAR_NAMES } from './grammar.mjs';
import { knownModules, catalogModules, isEditorialKind, moduleTiming, SUBJECT_DENSITY } from './modules.mjs';
import { SAFE_ZONE_PROFILES, captionBandAt, profileGeometry } from './layout-check.mjs';
import { EDITORIAL_VARIANTS } from './editorial-core.mjs';
import { packCaptionsFor, stylePromptLines } from './style.mjs';
import { CAPTION_PRESETS, captionLineExtent, captionOptions } from './captions.mjs';
import { PROFILE_MEASURES, profilePromptLines } from './profiles.mjs';
import { DIRECTION_INTENTS, DIRECTION_LAYOUTS, DIRECTION_SCHEMA, DIRECTION_TREATMENTS, INTENT_RULES, NARRATIVE_BEATS, VISUAL_INTENTS, intentHints } from './direction.mjs';
import { LONG_FORM_SECONDS, longFormLines } from './long-form.mjs';
import { WORLD_KINDS, WORLD_TIMES } from './worlds/index.mjs';
import { physicsPromptLines } from './physics.mjs';
import { ACTIONS, actingPromptLines } from './characters/actions.mjs';
import { framingPromptLines } from './characters/framing.mjs';
import { EXPRESSIONS, POSES } from './characters/rig.mjs';
import { SETS } from './characters/sets.mjs';
import { compositionPromptLines } from './composition.mjs';
import { ACTION_VERBS } from './direction.mjs';
import { COVER_MAX_WORDS, COVER_SECONDS } from './story.mjs';
import { clipLedLines } from './clip-led.mjs';
import { explainerDirectionLines, explainerStoryboardLines } from './explainer.mjs';

export const PLANNER_TIERS = Object.freeze(['structured', 'guided', 'bespoke']);

// The share of the narration captions may be hidden under cards before a
// storyboard fails (the gate is src/caption_visibility.js).
export const CAPTION_HIDDEN_MAX = 0.15;

// Params that place or restyle a module. The structured tier may not set them
// (RFC §7: catalogue modules only, no raw coordinates).
export const TUNING_PARAMS = Object.freeze(['rect', 'theme', 'accent', 'motion', 'presentation', 'track']);

// Spec summaries for the editorial kinds (kit/core/editorial-core.mjs has no
// describe/params tables). A kind without an entry still appears in the prompt
// with a generic line, and test/planning_prompt.test.js fails until it has one.
export const EDITORIAL_SPECS = Object.freeze({
  'media-window': { describe: 'A browser/desktop window showing a real local image or video capture of a product, site or repo.', params: { media: '{kind: "image" | "video", src: "assets/…", sourceStart?: seconds (video only)}' }, events: ['enter'] },
  checklist: { describe: 'Rows that tick from pending to active to done: a real list of steps, features or conditions.', params: { rows: '[{label, status: "pending" | "active" | "done", at, doneAt?}] up to 6', statusLabels: '{pending, active, done} ≤ 14 chars each (optional, e.g. "Covered")' }, events: ['enter', 'row-<i>-state', 'row-<i>-covered'] },
  'step-rail': { describe: 'Ordered stages on a rail that fills as each step lights up.', params: { steps: '[{label, at}] 2–6, strictly increasing at', numbered: 'boolean (optional)' }, events: ['enter', 'step-<i>-settle'] },
  callout: { describe: 'A short explanation panel: a title over one body line, or a treated panel with icon, glow and highlighted segments.', params: { body: 'string ≤ 160 (plain)', treatment: '{icon?: "terminal" | "branch" | "users" | "rocket" | "check" | "warning", monospace?, glow?, corners?, segments?: [{text, highlight?, underlineAt?}] (replace body), at?}' }, events: ['enter', 'treatment-settle', 'underline-<i>-settle'] },
  'audience-grid': { describe: 'A grid of audience tiles that highlight in turn; illustrative, never a claim about real users.', params: { audience: '{tiles: [{label ≤ 24, emoji?, at}] 2–12, columns?: 2–4}' }, events: ['enter', 'viewer-<i>-settle'] },
  'trend-chart': { describe: 'Bars for a trend across 2–8 points with a counter that follows the selected point.', params: { chart: '{mode: "illustration" | "data", points: [{label ≤ 16, value (whole number ≥ 0), at}] 2–8 (≥ 0.5 s apart), unit ≤ 18, source (required for data)}' }, events: ['enter', 'point-<i>-settle'] },
  'growth-chart': { describe: 'Growth bars whose values never decrease (use trend-chart for declines).', params: { growth: '{mode, points: [{label, value, at}] 2–8 non-decreasing, unit? (default "reach"), source?, showValues?}' }, events: ['enter', 'point-<i>-settle'] },
  metric: { describe: 'One formatted number panel that steps through 1–8 values, with an attribution line.', params: { metric: '{mode: "illustration" | "data", unit ≤ 18, format: "number" | "percent" | "currency", currency? (three-letter code, currency only), decimals?: 0–2, values: [{value, at}] 1–8 (≥ 0.65 s apart), source? (required for data)}' }, events: ['enter', 'value-<i>-settle'] },
  progress: { describe: 'A progress bar toward an explicit goal (not an elapsed-time clock).', params: { progress: '{mode, values: [{value, at}] 1–8, max?, label? ≤ 32, source?}' }, events: ['enter', 'value-<i>-settle'] },
  'date-card': { describe: 'A calendar card for one specific date, with an optional caption.', params: { date: '{month: 1–12, day, year?, caption? ≤ 42, at?}' }, events: ['enter', 'date-settle'] },
  'status-rack': { describe: 'A rack of rows with three status lights each that change state over time.', params: { rack: '{mode, source?, rows: [{label ≤ 24, states: [{at, lights: [bool, bool, bool], tone?: "pending" | "active" | "pass" | "fail"}]}] 1–8}', palette: '"status" (optional: lights mean fail, active, pass by position, and tones colour red → green; a light may be a tone name instead of true)' }, events: ['enter', 'rack-<i>-state-<j>'] },
  'code-snippet': { describe: 'One to three lines of tokenised code, optionally typed on.', params: { code: '{language? ≤ 24, source?: "example" | "real", filename? ≤ 40, typing?: boolean, lines: [{tokens: [{text, type: "plain" | "keyword" | "string" | "number" | "comment" | "operator"}], at, typeDuration?}] 1–3}', label: 'string ≤ 40 or false (label row; default "<language> · Example", the language alone for source "real", the filename when given)' }, events: ['enter', 'code-<i>-settle', 'code-<i>-typing-start'] },
  'excerpt-window': { describe: 'A passage from a doc, README or article that zooms to one line and highlights it.', params: { excerpt: '{mode, source?, lines: [{segments: [{text, highlight?}]}] 1–5, focus: {line, scale: 1–1.3, at}, highlightMotion?}' }, events: ['enter', 'excerpt-focus', 'highlight-sweep-settle'] },
  'focus-flow': { describe: 'Two to four options arrive, one is chosen, the others fade and a progress line runs.', params: { focus: '{options: [string ≤ 24] 2–4, selected: index, arriveAt?, chooseAt?, progressAt?, progressDuration?, progressLabel? ≤ 32, icon?}' }, events: ['enter', 'options-settle', 'chosen-task', 'focus-progress-settle'] }
});

const EDITORIAL_COMMON = 'title (required, ≤ 54 chars); `at` values are seconds from the scene start, at least 0.28 and at least 0.45 s before the scene ends';
const EDITORIAL_TUNING = 'rect, density ("fill" with a rect), accent (#rrggbb), theme, presentation ("solid" | "glass"), motion';

// RFC §5 phrase→module table, as data. `patterns` are case-insensitive regex
// sources matched against one sentence of the brief or narration. A row whose
// module is planned but not yet in the registry names a `fallback` that is. A
// row with `overlay` names a story-level overlay (frame.sources), not a scene
// module.
export const PHRASE_MODULE_TABLE = Object.freeze([
  { module: 'ui-scene', when: 'explains how a software tool works (a CLI, plugin or app explainer or walkthrough): the interface built as panels that change on the words', patterns: ['\\b(tool|cli|plugin|software|app) (explainer|walkthrough|tutorial)\\b', '\\bexplain(s|er)?\\b.*\\b(tool|cli|plugin|software)\\b', '\\bhow (our|your|the|my|this) (tool|cli|plugin|software|app) works\\b'] },
  { module: 'hook-title', when: 'states a question or claim as a headline (frame 0 visible); in a video of 90 s or less, never the first scene: an image of the hook\'s subject opens it', patterns: ['^(why|how|what|did you know|ever wonder|stop)\\b', '\\?\\s*$'] },
  { module: 'kinetic-words', when: 'lands 1–3 words per beat', patterns: ['\\b(fast|simple|instantly|never|always|zero)\\b'] },
  { module: 'function-chart', when: 'describes a quantity over time or a curve', patterns: ['\\bover time\\b', '\\bcurve\\b', '\\bexponential', '\\bdecay', '\\bcool(s|ing)?\\b', '\\brate of\\b', '\\bhalf-life\\b'] },
  { module: 'gauge-compare', when: 'contrasts two values or states', patterns: ['\\bversus\\b', '\\bvs\\.?\\s', '\\bcompared (to|with)\\b', '\\b(hotter|colder|higher|lower|bigger|smaller) than\\b'] },
  { module: 'flow-compare', when: 'says "big X → fast, small X → slow"', patterns: ['\\bbig(ger)?\\b.*\\bfast(er)?\\b', '\\bsmall(er)?\\b.*\\bslow(er)?\\b', '\\bthroughput\\b', '\\bflows?\\b'] },
  // Data explainers ("the study says"): the people, the rule and the source.
  { module: 'unit-grid', intents: ['number', 'proof'], when: 'counts people or things in a study or survey, or splits them into groups ("49 trained lifters", "split into two groups", "1 in 10 people"): one icon per unit counts in, then the grid splits into labelled groups or lights a few up', patterns: ['\\b\\d{1,3} (people|participants|subjects|volunteers|users|adults|students|patients|lifters|men|women|athletes)\\b', '\\b(split|divided|randomi[sz]ed|assigned) (them )?(into|to) (two|three|2|3) groups\\b', '\\b(one|\\d+) (in|out of) (every )?(\\d+|five|ten|twenty|a hundred)\\b'] },
  { module: 'number-line', intents: ['number', 'claim'], when: 'states a range, rule or threshold on a scale ("8–12 reps for size", "above 15 is cardio", "between 7 and 9 hours"): a ruler whose ranges light up one at a time, each with its label', patterns: ['\\b\\d+\\s?(–|-|to)\\s?\\d+\\s?(reps|hours|minutes|grams|g|kg|percent|%|days|weeks|mph|km)\\b', '\\bbetween \\d+ and \\d+\\b', '\\b(above|below|over|under|more than|less than) \\d+\\b.*\\b(is|means|counts as|=)\\b', '\\b(the (gym )?rule|sweet spot|threshold)\\b'] },
  // Catalogue I: big counts, grids at scale, tokens and particles.
  { module: 'dot-field', intents: ['number'], when: 'states a huge count of small things to feel its size ("1,050,000 tokens in context", "a million rows", "2 million parameters"): one dot per unit fills a bracketed field as the counter counts, pulling back from close-up dots', patterns: ['\\b\\d{1,3}(,\\d{3}){2,}\\b', '\\b(a|one|two|\\d+(\\.\\d+)?) (million|m) (tokens|rows|users|lines|parameters|words|requests)\\b', '\\bcontext (window|length)\\b'] },
  { module: 'grid-race', intents: ['number', 'proof'], when: 'compares what the same budget or time buys from two options ("same $10 of output", "for the same money", "per dollar"): two unit grids fill side by side under live counters, "1 cell = X"', patterns: ['\\bsame \\$?\\d+', '\\bfor the same (money|price|budget|cost)\\b', '\\bper dollar\\b', '\\b(twice|half) (as many|the) tokens\\b'] },
  { module: 'cell-grid', intents: ['number', 'proof'], when: 'compares costs, money or task counts as amounts ("$1.01 vs $7.15 per task", "24 of 100 tasks passed", "grew $200,000 to $1M"): grids at one cell size whose heights compare, with ticks, a lit subset, stacked segments and a ratio ("≈9× cheaper")', patterns: ['\\bper (completed )?task\\b', '\\b\\d+ (of|out of) \\d{2,4} (tasks|questions|problems)\\b', '\\b(\\d+(\\.\\d+)?|≈\\s?\\d+)\\s?(×|x) (cheaper|faster|more)\\b', '\\bstart(ing)? (capital|stake|balance)\\b'] },
  { module: 'tokenizer', intents: ['number', 'process'], when: 'explains tokens or prices per token ("a token is part of a word", "$10 per million output tokens"): a real sentence split into token chips with each token\'s price, then the bills race to their totals', patterns: ['\\btokeni[sz](er|ed|ation)\\b', '\\bper (1m|million|thousand) (input |output )?tokens\\b', '\\b(a|each|every) token\\b'] },
  { module: 'particle-text', intents: ['number', 'hook'], when: 'reveals a headline number or word that should feel computed or leaked ("60%", "6.1", "AGI?"): it assembles from (or dissolves into) glowing particles', patterns: ['\\b(scores?|hits?|reaches|jumps to) \\d+(\\.\\d+)?%', '\\b(leaked|revealed|unveiled)\\b'] },
  { module: 'particle-logo', intents: ['claim'], when: 'pits two labs, companies or products against each other by name ("OpenAI and Anthropic", "X takes on Y"): each mark drawn in particles inside an orbiting ring, side by side', patterns: ['\\b(takes on|versus|rivals?|against)\\b.*\\b(lab|labs|company|companies)\\b', '\\bhead[- ]to[- ]head\\b'] },
  { module: 'particle-cloud', intents: ['claim'], when: 'points at what comes next after a line-up ("the next flagship", "what\'s coming", "the model after this"): steps rise to a dashed box that a particle cloud gathers round', patterns: ['\\bnext (flagship|model|release|generation|version)\\b', '\\bwhat\'?s (coming|next)\\b', '\\bcoming soon\\b'] },
  { module: 'source-note', overlay: 'frame.sources', intents: ['proof'], when: 'cites a study, survey or researchers ("according to", "a 2016 study", "researchers found", "et al."): a source note (author, year · journal) that stays along the bottom while the data scenes play (story.frame.sources, not a scene); no source in the brief, no study claim', patterns: ['\\baccording to\\b', '\\b(study|studies|survey|meta-analysis|trial|journal)\\b', '\\b(researchers?|scientists?) (found|showed|discovered|tested)\\b', '\\bet al\\.?'] },
  // Social posts: real posts only, each with its source (catalog-i-social.mjs).
  { module: 'social-post', intents: ['proof', 'quote'], when: 'quotes one real post, tweet or reply ("one user wrote", "he tweeted", "posted on X"): the post as a card, its key phrase swept with a highlight on the word', patterns: ['\\b(tweet(ed)?|posted|replied|wrote on (x|twitter|threads|bluesky|linkedin|reddit))\\b', '\\b(one|a) (user|commenter|poster|redditor) (wrote|said|posted|put it)\\b'] },
  { module: 'social-stack', intents: ['proof', 'quote'], when: 'gathers a few reactions to one thing ("people were quick to respond", "the replies poured in"): 2–5 posts cascade in, one in front', patterns: ['\\b(the )?(replies|reactions|comments|responses) (poured|flooded|came) in\\b', '\\b(people|users|fans|developers) (were quick to|reacted|responded)\\b'] },
  { module: 'social-sort', intents: ['proof', 'quote'], when: 'splits reactions into camps ("some can\'t wait, others are tired of it"): posts fly into labelled columns', patterns: ['\\b(some|half( of)?( the)?) (people|users|fans|developers|of them)\\b.*\\b(others|the rest|the other half)\\b', '\\b(divided|split) (opinion|reactions|the internet|the community)\\b'] },
  { module: 'social-wall', intents: ['proof'], when: 'says a topic took over the feeds ("the internet exploded", "everyone was talking about it"): a drifting wall of posts, one or two pulled forward', patterns: ['\\b(went viral|the internet (exploded|lost it)|everyone (was|is) talking|flooded (the )?(feeds?|timeline))\\b', '\\bthousands of (posts|tweets|comments)\\b'] },
  // Code evidence: the receipt is a real PR, commit, diff or terminal run.
  { module: 'repo-pr-card', intents: ['proof'], when: 'names a pull request or a change merged into a repo ("a PR in dotnet/efcore", "merged on Oct 16", "pull request #39217"): the PR rebuilt as a card, the token boxed on its word', patterns: ['\\bpull request\\b', '\\bPR\\s?#?\\d+', '\\bmerged\\b', '\\b[\\w-]+\\/[\\w.-]+#\\d+\\b'] },
  { module: 'commit-card', intents: ['proof'], when: 'names a commit, a sha or who committed what ("a commit by Copilot", "commit cc44805", "co-authored by"): the commit card with sha, Verified, co-authors and the hunk', patterns: ['\\bcommit(ted)?\\b', '\\bco-authored\\b', '\\b[0-9a-f]{7,12}\\b'] },
  { module: 'diff-view', intents: ['proof', 'process'], when: 'walks through what a change did line by line ("they swapped sol for terra", "the diff shows", "this line changed"): a Files-changed diff whose focus ring steps through the rows', patterns: ['\\bdiff\\b', '\\b(swapp|replac|chang)ed\\b.*\\b(line|model|config|flag)\\b', '\\bfiles? changed\\b'] },
  { module: 'evidence-chain', intents: ['proof'], when: 'finds the same name in several places ("the same model name shows up in three repos", "and again here"): the sources side by side, the token joined by a dashed connector', patterns: ['\\b(same|that) (name|token|string|model)\\b.*\\b(again|also|too|places|repos)\\b', '\\b(two|three|four) (places|repos|sources|leaks|clues)\\b'] },
  { module: 'date-pinned-timeline', intents: ['proof', 'number'], when: 'dates the clues ("on Oct 16 … then Oct 24", "three clues in nine days", "why now?"): a day axis that scrubs while each source pins to its date, or the why-now summary', patterns: ['\\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \\d{1,2}\\b.*\\b(then|and|by)\\b', '\\bclues? in \\d+ days\\b', '\\bwhy now\\b'] },
  { module: 'terminal-session', intents: ['proof', 'process'], when: 'runs something in a terminal ("clone the repo", "pip install", "run the tests", "38 scripts pass"): commands type, output streams PASS/FAIL rows, a ⏩ timer fast-forwards long runs', patterns: ['\\b(git clone|pip install|npm (i|install|ci|test)|python3?|run_all|terminal|command line)\\b', '\\b(tests?|scripts?) (pass|passed|fail|failed)\\b'] },
  { module: 'count-up', when: 'gives a number, time, price or count', patterns: ['\\d', '\\b(percent|dollars?|minutes?|seconds?|hours?|times faster)\\b', '[$%×]'] },
  { module: 'metric', when: 'gives a sourced figure that should stay on screen with captions', patterns: ['\\b(according to|reported|survey|benchmark(ed)?|measured)\\b'] },
  { module: 'checklist', when: 'lists steps, features or duties', patterns: ['\\b(features?|includes?|checklist|requirements?|you get)\\b', '\\bfirst\\b.*\\bsecond\\b'] },
  { module: 'process-steps', when: 'explains a sequence or mechanism', patterns: ['\\b(then|next|finally|steps?|process|pipeline|how it works)\\b'] },
  { module: 'step-rail', when: 'walks through the stages of a workflow', patterns: ['\\b(stages?|phases?|milestones?)\\b'] },
  { module: 'equation-lockup', when: 'names a law or formula', patterns: ['\\b(law|formula|equation|theorem|principle)\\b', '\\s=\\s'] },
  { module: 'archive-card', when: 'cites history, a source or a quote', patterns: ['\\bin \\d{3,4}\\b', '\\b(history|historian|quoted?|wrote|century|archive)\\b'] },
  { module: 'date-card', when: 'names a specific date or launch day', patterns: ['\\b(january|february|march|april|may|june|july|august|september|october|november|december) \\d{1,2}\\b', '\\blaunch(es|ed)? on\\b'] },
  { module: 'product-demo', lanes: ['motion', 'voiceover-motion'], when: 'shows the product in use: a recorded flow (assets/demo/<flow>.mp4 with <flow>.actions.json from launchclip demo record)', patterns: ['\\b(click|clicks|sign(s)? (in|up)|create[sd]?|onboard\\w*|walk(s)? through|in action|set(s)? up|watch)\\b'] },
  { module: 'evidence-clip', lanes: ['motion', 'voiceover-motion'], when: 'shows a real public page as proof: a PR or diff, a model card, an announcement, an article (assets/evidence/<id>.mp4 with <id>.evidence.json from launchclip evidence capture)', patterns: ['\\b(pull request|merged|commit(ted)?|model card|announced|announcement|the (post|page|article|diff|changelog) (says|shows)|on (github|hugging ?face)|published)\\b'] },
  { module: 'ui-showcase', fallback: 'media-window', when: 'shows a product, site or repo (real capture)', patterns: ['\\b(dashboard|screen|app|website|site|repo|interface|demo|screenshot)\\b'] },
  { module: 'code-snippet', when: 'shows a command or a few lines of code', patterns: ['\\b(npm|npx|pip|brew|install|command|cli|terminal)\\b', '`'] },
  { module: 'logo-row', when: 'names platforms or integrations', patterns: ['\\b(integrat\\w*|works with|platforms?|plugs into)\\b'] },
  { module: 'trend-chart', when: 'shows a trend across several data points', patterns: ['\\b(trend|each year|per month|monthly|year over year|week by week)\\b'] },
  { module: 'growth-chart', when: 'shows growth that never declines', patterns: ['\\b(grew|growth|doubled|tripled|stars|signups)\\b'] },
  { module: 'progress', when: 'reports progress toward a goal', patterns: ['\\b(progress|toward|goal|of the way|percent complete)\\b'] },
  { module: 'status-rack', when: 'reports the state of several systems', patterns: ['\\b(status|uptime|healthy|passing|failing|green|red)\\b'] },
  { module: 'excerpt-window', when: 'quotes a passage from a doc, README or article', patterns: ['\\b(readme|docs?|documentation|article|the paper)\\b'] },
  { module: 'audience-grid', when: 'speaks to several audiences or groups', patterns: ['\\bfor (developers|designers|teams|everyone|students)\\b', '\\bwhether you\\b'] },
  { module: 'focus-flow', when: 'picks one option from several', patterns: ['\\b(choose|pick|instead of|which one|options?)\\b'] },
  { module: 'photo-scene', lanes: ['motion', 'voiceover-motion'], when: 'sets a scene or mood with a real photo or clip (assets/… image or video, full bleed)', patterns: ['\\b(picture|imagine|out (in|on) the|on location|at the|scene|landscape|outdoors?|in the field)\\b'] },
  { module: 'clip', lanes: ['motion', 'voiceover-motion'], when: 'shows the real thing in supplied footage, cut to the line (assets/… video or still, full frame, with callouts for the key words)', patterns: ['\\b(footage|on camera|you can see|look at (this|that|it)|here it is|in the real world|for real)\\b'] },
  // Media layouts: library footage inside the design, with the line's point beside it (catalog-d-media-layouts.mjs).
  { module: 'media-compare', lanes: ['motion', 'voiceover-motion'], intents: ['claim', 'product'], when: 'contrasts two real options you can show ("hardwood or composite", "slide-on vs caravan"): each option in its own footage with a label, the second on its word, the pick ringed', patterns: ['\\b\\w+ (vs\\.?|versus) \\w+', '\\b(hardwood|timber|steel|aluminium|aluminum|composite|canvas|fibreglass|fiberglass)\\b.*\\b(or|vs\\.?|versus)\\b'] },
  { module: 'media-grid', lanes: ['motion', 'voiceover-motion'], intents: ['list', 'product'], when: 'names two to four options, models or materials you can show together ("three options", "hardwood, composite and aluminium"): a tile of footage each (a grid, or a mosaic with one large), revealed on its word', patterns: ['\\b(two|three|four|2|3|4) (options|models|materials|finishes|types|kinds|choices|sizes|layouts)\\b'] },
  { module: 'media-list', lanes: ['motion', 'voiceover-motion'], intents: ['list', 'process'], when: 'lists steps or checks that each have something to show ("check the payload, measure the tray, ask about the warranty"): a row each with a small thumbnail, one by one', patterns: ['\\b(check|measure|inspect|make sure|look for|ask about)\\b.*,'] },
  { module: 'media-stat', lanes: ['motion', 'voiceover-motion'], intents: ['number', 'proof'], when: 'gives a figure about something you can show (a payload, a weight, a build time, years in business): the figure counts up beside the footage, or over it full frame', patterns: ['\\b\\d[\\d,.]*\\s?(kg|kilos?|tonnes?|litres?|liters?|psi|km|mm|cm|years?|hours?)\\b'] },
  { module: 'picture-in-picture', lanes: ['motion', 'voiceover-motion'], intents: ['number', 'list', 'claim'], when: 'leads with a point, a figure or a short list that real footage backs up ("payload explained", "what you can carry"): the point in a panel, a rounded clip card in its corner', patterns: ['\\b(payload|capacity|rated|spec(s|ification)?|explained|in \\d+ seconds)\\b'] },
  { module: 'split-screen', lanes: ['motion', 'voiceover-motion'], intents: ['claim', 'product', 'proof'], when: 'shows real footage while the line makes a point: the shot fills the top or bottom half (left or right on 16:9), the other half carries the title, a figure or a short list', patterns: ['\\b(here\'?s why|that\'?s why|the reason|which means|because|so you)\\b'] },
  { module: 'landscape-card', lanes: ['motion', 'voiceover-motion'], intents: ['product', 'proof'], when: 'shows a wide view in landscape footage (a vehicle side-on, a campsite, a road, a beach): the shot letterboxed in a rounded 16:9 window mid-frame, a title above and a caption or chip below, no heavy crop', patterns: ['\\b(wide|panoram\\w*|side[- ]on|from above|aerial|on the road|on the beach|the whole (rig|setup|site))\\b'] },
  { module: 'brand-lockup', when: 'names the brand on a title or end card, with its logo and wordmark images (and an app-store badge or URL on the end card)', patterns: ['\\b(introducing|meet|presenting)\\b', '\\b(app store|google play|download (it|now|today))\\b'] },
  { module: 'cta', when: 'calls to action, or the loop ending', patterns: ['\\b(follow|subscribe|try it|get started|star|download|sign up|learn more|link in bio)\\b'] },
  // Channel furniture: the subscribe prompt mid-video and the channel's sting at the open and close.
  { module: 'subscribe-cta', when: 'asks the viewer to subscribe, like or ring the bell partway through a long video ("if you\'re new here, subscribe"): a glass subscribe pill on an overlay track (track 1+) over the scene, clicked on the word', patterns: ['\\bsubscribe\\b', '\\b(hit|smash|tap) (the|that) (like|bell|subscribe)', '\\bnotification bell\\b'] },
  { module: 'logo-sting', when: 'opens or closes a channel\'s video on its name ("welcome back to …", "see you in the next one"): the channel\'s glass logo sting, 3–5 s, as the first or last scene', patterns: ['\\bwelcome (back )?to\\b', '\\bsee you (in the )?next (one|video|time)\\b', '\\bthanks for watching\\b'] },
  { module: 'concept-card', intents: ['claim', 'problem', 'turn'], when: 'names a claim, a problem or a turn in a few words ("the problem is", "here\'s the thing", "too slow"): a big word or phrase with an icon and a sub-line (on a card beside the presenter, or full frame)', patterns: ['\\bthe (problem|secret|catch|trick|key|point) is\\b', '\\b(here\'s the thing|the truth is|bottom line|the real reason)\\b', '\\btoo (slow|hard|expensive|complex|long)\\b'] },
  { module: 'icon-row', intents: ['list', 'process'], when: 'lists two to five things, features, steps or audiences ("X, Y and Z", "three things"): an icon per item that pops on its word', patterns: ['\\w[^,.;]{0,24}, \\w[^,.;]{0,24},? (and|or) \\w', '\\b(two|three|four|five|2|3|4|5) (things|ways|reasons|features|tools|steps|parts)\\b'] },
  { module: 'section-card', intents: [], when: 'opens a new section or chapter ("part two", "first, the problem", "chapter", "let\'s start with"): the brand frame\'s kicker and the section title (usually an insert)', patterns: ['\\b(part|chapter|section) (one|two|three|four|five|\\d+)\\b', '\\b(let\'s start with|first up|moving on|next up)\\b'] },
  { module: 'object-card', intents: ['product', 'claim'], when: 'talks about a thing the product is or makes (a box, a launch, a calendar, a laptop, an inbox): a simple illustrated object with a caption', patterns: ['\\b(ships?|shipping|package|box|delivery|calendar|schedule|laptop|inbox|email|launch(es|ed)?|trophy|award|idea)\\b'] },
  { module: 'stat-card', intents: ['number'], when: 'states a real figure with its source in the brief or assets ("87% of", "saves $1,400", "3× faster"): the figure counts up with a label and a source line (no source, no stat-card)', patterns: ['\\d\\s?(%|×)', '\\b\\d[\\d,.]*\\s?(percent|x|times|k|m|million|billion|hours?|minutes?|days?|users?|customers?)\\b', '[$€£]\\s?\\d'] },
  { module: 'quote-card', intents: ['quote', 'proof'], when: 'quotes a named person or outlet, with the exact words in the brief ("as Ada put it", "said", "wrote"): the quote with its attribution (never "a customer")', patterns: ['\\b(said|says|told (me|us)|wrote|put it|in (her|his|their) words|quote)\\b', '["“][^"”]{12,}["”]'] },
  { module: 'excerpt', intents: ['proof', 'product'], when: 'shows real lines from code, a README, docs, a changelog or an article, supplied verbatim: the lines in a window with the key ones highlighted', patterns: ['\\b(readme|changelog|config|package\\.json|the (code|docs|diff|commit|release notes)|this line|one line of)\\b'] },
  { module: 'compare', intents: ['claim'], when: 'contrasts the old way and the new, or two options ("before", "instead of", "the old way", "X versus Y"): two panels, before and after (or two columns)', patterns: ['\\b(before|the old way|used to|no more|instead of|compared to|versus|vs\\.?)\\b'] },
  { module: 'timeline', intents: ['process'], when: 'walks through steps in order, a history or a roadmap ("first… then… finally", "day one", "by week three", "next quarter"): nodes along a line that land on their words', patterns: ['\\bfirst\\b.*\\b(then|next|after that)\\b', '\\b(day|week|month) (one|two|three|\\d+)\\b', '\\b(roadmap|timeline|milestones?|next (quarter|year))\\b'] },
  { module: 'masthead', lanes: ['footage-led'], needs: ['subject'], when: 'names the product or the one idea the video is about ("meet X", "this is X", "it\'s called X"): one word behind the presenter\'s head', patterns: ['\\b(meet|introducing|it\'s called|called|this is)\\b'] },
  { module: 'dolly-zoom', lanes: ['footage-led'], needs: ['subject'], when: 'lands a realisation, reveal or turn ("that\'s when", "it hit me", "everything changed"): the room moves, the presenter holds', patterns: ['\\b(that\'s when|it hit me|realis|realiz|everything changed|turns out|the moment)'] },
  { module: 'app-stage', lanes: ['footage-led'], needs: ['subject'], when: 'shows or describes the product on screen ("here\'s the dashboard", "this is the app"), with a screenshot or recording in the assets: the UI fills the top, their head over its edge', patterns: ['\\b(dashboard|the app|here\'s (the|our)|on screen|interface)\\b'] },
  { module: 'phone-stage', lanes: ['footage-led'], when: 'shows the product on a phone or a mobile flow, with a recording or screenshot in the assets (a demo-autopilot flow fits)', patterns: ['\\b(phone|mobile|ios|android|app store|on the go)\\b'] },
  { module: 'backdrop-swap', lanes: ['footage-led'], needs: ['subject'], when: 'turns from the problem to the product ("so we built", "that\'s why", "enter"): the room gives way to a brand backdrop', patterns: ['\\b(so (we|i) built|that\'s why|enter|instead)\\b'] },
  { module: 'feed-frame', lanes: ['footage-led'], needs: ['subject'], when: 'talks about posting, going viral or "this exact video": the frame becomes a feed window they break out of', patterns: ['\\b(post(ed|ing)?|viral|this (exact )?video|my feed|reels?|tiktok|shorts)\\b'] },
  { module: 'pull-back', lanes: ['footage-led'], when: 'reveals how the video or result was made, or a process finishing ("made with", "it transcribes, cuts…"): the frame pulls back into an app window while real steps tick', patterns: ['\\b(made (with|by)|behind the scenes|render(ed|ing)?|it (transcribes|cuts|edits))\\b'] },
  { module: 'glass-word', lanes: ['footage-led'], needs: ['subject'], when: 'names the one idea or the brand in a premium or tech piece: one glass word on the wall behind their head', patterns: ['\\b(design|craft|premium|future|vision|the one thing)\\b'] },
  { module: 'orbit-cards', lanes: ['footage-led'], needs: ['subject'], when: 'lists many things or shows social proof ("all these tools", "people keep telling me"), with real items in the assets or brief: cards circle them', patterns: ['\\ball (these|of these|the) (tools|apps|platforms)\\b', '\\b(people (keep|kept) (telling|saying)|reviews?|testimonials?)\\b'] },
  { module: 'proof-wall', lanes: ['footage-led'], needs: ['subject'], when: '"everyone is talking about it", press, reviews or a launch buzz, with real quotes and sources in the brief: proof pins to the wall behind them', patterns: ['\\beveryone(\\\'s| is) (talking|saying)\\b', '\\b(press|reviews?|went viral|the buzz|headlines?)\\b'] },
  { module: 'doodle-outline', lanes: ['footage-led'], needs: ['subject'], when: 'a warm, personal creator line about the presenter or what they made ("I built this", "my favourite part", "love this")', patterns: ['\\bi (built|made|designed)\\b', '\\bmy favou?rite\\b', '\\blove (this|it)\\b'] },
  { module: 'scrapbook', lanes: ['footage-led'], needs: ['subject'], when: 'calls out a number or claim in a playful, handmade beat ("100%", "3X", "$0", "free")', patterns: ['\\b\\d+\\s?(x|%)\\b', '\\$0\\b', '\\b(free|zero dollars)\\b'] },
  { module: 'checklist', lanes: ['footage-led'], when: 'says "all you need to do is", "three steps" or runs through a process: rows tick as each is said, beside the presenter (no rect: it places itself above their head or on their chest)', patterns: ['\\ball you (need|have) to do\\b', '\\b(three|four|two|3|4) (steps|things)\\b', '\\bstep (one|1)\\b'] },
  { module: 'growth-line', lanes: ['footage-led'], needs: ['subject'], when: 'gives a growth result ("doubled", "took off in week three"): a line kicks up behind their head', patterns: ['\\b(doubled|tripled|took off|grew|growth|skyrocket\\w*|10x)\\b'] },
  { module: 'zoom-through', lanes: ['footage-led'], when: 'turns on a contrast or jumps between takes ("but", "or you can", "instead"): rush into the cut, burst out of the next take', patterns: ['^(but|or|instead|now)\\b', '\\bbut wait\\b', '\\bor you can\\b'] },
  { module: 'punch-in', fallback: 'kinetic-words', lanes: ['footage-led'], when: 'footage-led emphasis on a word (steps for a build of emphasised words; blur for energy)', patterns: ['\\b(this|exactly|really|huge)\\b', '!\\s*$'] },
  { module: 'footage-callout', fallback: 'callout', lanes: ['footage-led'], when: 'footage-led claim sticker or label pointing at something on screen', patterns: ['\\b(note|remember|important|tip|warning|look at|see this|right here)\\b'] },
  { module: 'lower-third', lanes: ['footage-led'], when: 'introduces the speaker or a guest by name and title', patterns: ['\\b(my name is|founder|co-founder|ceo|cto|engineer at|host of|joining me)\\b'] },
  { module: 'emphasis-caption', lanes: ['footage-led'], when: 'one to three spoken words that deserve a big on-screen pop', patterns: ['\\b(never|always|free|instantly|zero|ten times|10x)\\b'] },
  { module: 'cast-scene', lanes: ['motion', 'voiceover-motion'], intents: ['problem', 'turn', 'personal', 'product'], beats: ['setup', 'problem', 'attempt', 'turn', 'resolution'], when: 'tells a story with people ("meet Maya, a…", "imagine you\'re…", someone stuck or frustrated, then the product fixes it): animated characters from story.cast act it out in a set, with poses and expressions cued to words; the screen set plays a real capture', patterns: ['\\b(imagine you\'re|picture this|meet [a-z]+, an?)\\b', '\\b(frustrat\\w*|struggl\\w*|stuck|gave up|again and again|hours? (lost|wasted))\\b'] },
  { module: 'world', lanes: ['motion', 'voiceover-motion'], intents: ['personal', 'product', 'problem'], when: 'puts the story in a place and no photo or clip of it is supplied (an office, a kitchen, a city street at night, a park at dusk, a beach, space): a drawn environment at day, dusk or night as the plate, with characters, cards or captions on higher tracks over it; story.world sets the video-wide place', patterns: ['\\b(in (the|a|her|his|their|my|your) (office|kitchen|living room|classroom|cafe|café|workshop|studio|gym|park|street|city|forest|mountains))\\b', '\\b(late at night|at night|at sunset|downtown|on the beach|on the rooftop|in space)\\b'] },
  { module: 'sprite-scene', lanes: ['motion', 'voiceover-motion'], intents: ['problem', 'turn', 'personal', 'product'], beats: ['setup', 'problem', 'attempt', 'turn', 'resolution'], when: 'an illustrated story with a recurring cast and dialogue (a series, a heist, a customer story told in episodes) when story.cast lists characters with art: each line plays as a painted scene, the speaker\'s mouth on its words, a new pose per line, a name card when someone is introduced; only for characters with art in story.cast', patterns: [] },
  { module: 'character-cameo', intents: ['problem', 'personal'], when: 'gives the viewer\'s situation a face for one beat ("if you\'re a…", "your customer", "someone like you"): one animated character beside a card or on a panel', patterns: ['\\bif you\'re an?\\b', '\\b(your (customers?|users?|team)|someone like you)\\b'] },
  { module: 'callout', lanes: ['motion', 'voiceover-motion'], when: 'a short note, tip or warning card', patterns: ['\\b(note|remember|important|tip|warning)\\b'] },
  // Catalogue H charts: data from the brief or assets only, never invented.
  { module: 'bar-chart', intents: ['number'], when: 'compares a few real values side by side ("by platform", "per region", "each month"): bars grow to their values, one can stay lit', patterns: ['\\b(by|per|across|for each) (platform|channel|region|country|month|quarter|team|plan|format)\\b'] },
  { module: 'pie-chart', intents: ['number'], when: 'splits a whole into shares ("half of", "a third", "the split", "breakdown"): a donut or pie sweeps on with its legend', patterns: ['\\b(half|a third|a quarter) of\\b', '\\b(split|breakdown|share of|mix of)\\b'] },
  { module: 'area-chart', intents: ['number'], when: 'shows a real series over time ("every month since", "over the year"): the area reveals left to right', patterns: ['\\b(every|each) (week|month|quarter|year) since\\b', '\\bover the (last|past)? ?(year|months|weeks)\\b'] },
  { module: 'funnel-chart', intents: ['number'], when: 'walks a conversion path ("of those", "signed up", "drop-off", "funnel"): stages narrow with the rate between them', patterns: ['\\b(funnel|conversion|drop-?off|of those)\\b'] },
  { module: 'waterfall', intents: ['number'], when: 'explains how a total changed through gains and losses ("we gained… but lost…", "net"): steps from the start to the new total', patterns: ['\\b(net (change|gain|loss)|gained .* lost|lost .* gained)\\b'] },
  { module: 'sankey', intents: ['number', 'process'], when: 'shows where something flows ("where the money goes", "how traffic splits"): ribbons from sources to destinations', patterns: ['\\bwhere (the|our|your) \\w+ (goes|go|comes? from)\\b', '\\b(flows? (into|from)|splits? (into|between))\\b'] },
  { module: 'heatmap', intents: ['number'], when: 'shows when or where activity peaks across two dimensions ("busiest day and hour"): cells shade in a wave', patterns: ['\\b(busiest|peak|quietest) (day|hour|time)s?\\b', '\\bheat ?map\\b'] },
  { module: 'leaderboard', intents: ['number', 'proof'], when: 'ranks things ("top five", "the most popular", "number one"): rows land from last place to first', patterns: ['\\btop (three|five|ten|3|5|10)\\b', '\\b(most popular|ranked|ranking|leaderboard|number one)\\b'] },
  { module: 'comparison-table', intents: ['claim'], when: 'compares products feature by feature ("unlike X, it…", "the only one that"): a table of ticks and crosses with the pick outlined', patterns: ['\\bunlike (other|most)\\b', '\\bthe only (one|tool|app) (that|with)\\b', '\\bfeature (by feature|comparison)\\b'] },
  { module: 'odometer', intents: ['number'], when: 'gives a big running total ("so far", "all time", "and counting"): every digit rolls on its own reel to the figure', patterns: ['\\b(so far|all[- ]time|and counting|to date)\\b'] },
  { module: 'countdown', intents: ['hook', 'cta'], when: 'counts down to a moment ("in 3, 2, 1", "launches in", "doors open"): each number punches in, then the end word', patterns: ['\\b3,? 2,? 1\\b', '\\b(countdown|launch(es)? in|starts in|doors open)\\b'] },
  { module: 'flip-clock', intents: ['turn'], when: 'turns a date, year or time over ("from 2024 to 2026", "at midnight"): split-flap cards flip to the new value', patterns: ['\\bfrom (19|20)\\d\\d to (19|20)\\d\\d\\b', '\\b(midnight|new year)\\b'] },
  { module: 'slot-roll', intents: ['list', 'claim'], when: 'names who or what it is for among several ("for founders, teachers or creators", "whatever you make"): a reel of words spins and lands on one', patterns: ['\\b(made|built) for\\b', '\\bwhatever you (make|build|sell)\\b'] },
  { module: 'device-frame', intents: ['product'], when: 'shows the product on a device ("on your phone", "in the browser", "on any laptop"): a browser, phone, laptop or tablet frame with a screenshot from the assets (or a brand mock screen)', patterns: ['\\bon (your|any|a) (phone|laptop|tablet|browser|desktop)\\b', '\\bin the browser\\b'] },
  { module: 'window-chrome', intents: ['product', 'proof'], when: 'runs real commands or shows real lines in a terminal or app window ("run", "type", "one command"): the lines type on in a window', patterns: ['\\b(one|two|three|a single) commands?\\b', '\\b(in the|from the|your) terminal\\b', '\\b(npx|npm|brew|pip) \\w'] },
  { module: 'speech-bubble', intents: ['quote', 'personal'], when: 'voices what someone says or thinks ("they asked", "you\'re thinking", "what if"): a speech or thought bubble pops from its tail', patterns: ['\\b(you\'re (probably )?thinking|they (asked|said)|what if)\\b'] },
  { module: 'sticker', intents: ['claim', 'cta'], when: 'stamps one short label on the moment ("new", "free", "beta", "sale"): a die-cut, round or starburst sticker slaps on', patterns: ['\\b(brand new|it\'s free|now free|in beta|on sale|limited)\\b'] },
  { module: 'badge', intents: ['claim', 'proof'], when: 'awards or certifies something ("award-winning", "certified", "open source", "version 2"): a badge spins in and stamps down', patterns: ['\\b(award[- ]winning|certified|open[- ]source|version \\d|v\\d\\b)'] },
  { module: 'callout-arrow', intents: ['product'], when: 'points at one thing on screen ("see this", "right here", "this button"): an arrow draws from a label to the spot and rings it', patterns: ['\\b(this button|right here|see this|look at this|over here)\\b'] },
  { module: 'tooltip', intents: ['product'], when: 'explains one control or spot in the product ("hover", "click here", "tap"): a dot lands on it and a tooltip rises beside it', patterns: ['\\b(hover|tap (on|the)|click (on|the|here))\\b'] },
  { module: 'motion-title', intents: ['hook', 'turn'], when: 'announces or names something in a few words ("announcing", "introducing", "say hello to"): a title built by the style\'s text effect, with a kicker and sub-line', patterns: ['^(announcing|introducing|presenting|say hello to)\\b'] },
  { module: 'icon-grid', intents: ['list', 'product'], when: 'lists six or more features, tools or integrations ("works with", "everything you need", "all the features"): a grid of icons that pop in with labels', patterns: ['\\b(works with|integrates with|everything you need|all the features|built-in)\\b'] },
  { module: 'map-highlight', intents: ['number', 'proof'], when: 'names countries or where something happens ("in 40 countries", "across Europe", "from Brazil to Japan"): a world map that zooms and fills the countries the brief names', patterns: ['\\b(countries|worldwide|across (europe|asia|africa|the world|the us)|global(ly)?)\\b', '\\bfrom [A-Z][a-z]+ to [A-Z][a-z]+\\b'] },
  { module: 'progress-ring', intents: ['number'], when: 'states one real percentage of a whole ("87% of renders", "nine in ten"): a ring fills while it counts', patterns: ['\\b\\d{1,3}\\s?% of\\b', '\\b(nine|eight|seven) (in|out of) ten\\b'] },
  // Catalogue I: 3D data objects (real values from the brief or assets only).
  { module: 'glass-bars-3d', intents: ['number'], when: 'compares a few prices, scores or sizes as a premium 3D beat, or a line-up from top to bottom ("the line-up", "from $50 down to $0.50", "the cheapest of the family"): glass bars grow under an orbiting camera, or a staircase of steps with a score marker hopping between them', patterns: ['\\b(line-?up|staircase|tiers?)\\b', '\\bfrom \\$?\\d[\\d.,]* (down|up) to \\$?\\d'] },
  { module: 'coin-stack', intents: ['number'], when: 'compares costs or token counts as piles ("$1 versus $10", "ten times the cost", "three times more tokens"): stacks of coins or token discs drop in, sized by value', patterns: ['\\b(coins?|stack(s|ed)? of|pile of)\\b', '\\b(\\d+|ten|three|five)\\s?(×|x|times) (the cost|more tokens|as much|cheaper|pricier)\\b'] },
  { module: 'rack-shelf', intents: ['number', 'list'], when: 'lays out a family of models or plans row by row with a score and a price ("model by model", "each tier", "on the shelf"), or places them on a price scale: trays stack in and one slides out, or cubes glide along a price rail', patterns: ['\\b(shelf|rack|row by row|model by model|price rail|price scale)\\b'] },
  { module: 'device-box', intents: ['product', 'number'], when: 'talks about a server, GPU or box running live ("one GPU", "on a single node", "it has been up for", "requests so far"): the device lands with a screen counting requests and an uptime clock', patterns: ['\\b(gpus?|servers?|nodes?|appliance|hardware|on-?prem)\\b', '\\b(up for|requests so far|uptime)\\b'] },
  { module: 'paper-stack', intents: ['proof', 'list'], when: 'walks through a long document, report or paper section by section, with what passed and what failed ("chapter by chapter", "page 14", "the audit found", "red flags"): sections land as a stack and each gets a check or a red flag (books, or a folder that opens, as variants)', patterns: ['\\b(chapters?|pages? \\d+|pp\\.|sections? of|red flags?|audit(ed)?|the report|folder|files?)\\b'] },
  { module: 'planet-family', intents: ['product'], when: 'introduces a product family from small to large ("the small one, the mid one, the flagship", "three sizes", "light, standard and pro"): each member as a moon, earth, sun or galaxy with its name and tagline, the camera tracking across', patterns: ['\\b(family|three sizes|small, medium|lite|flagship|tiers? of)\\b', '\\b(moon|planet|sun|galaxy|universe)\\b'] },
  // Explainer vocabulary (catalogue I and the upgraded charts): charts rebuilt beat by beat, races, dashboards, dates, people and maths.
  { module: 'scatter-plot', intents: ['proof', 'number'], when: 'reads an official benchmark chart or a score against cost or size ("on the chart", "cost per task", "the official numbers vs the re-run"): series lines draw on, one glows, guides and callouts land one at a time, an official chart and a re-run side by side', patterns: ['\\b(chart|plot|graph)s? (shows?|says?)\\b', '\\bcost per (task|token|run)\\b', '\\b(re-?run|independent(ly)? (tested|evaluated|re-?ran))\\b', '\\b(pareto|frontier)\\b'] },
  { module: 'race-bars', intents: ['number', 'proof'], when: 'says one thing is N times faster or finishes first ("3× faster", "in half the time"): rows fill like progress bars at their own speeds and the winner gets its badge', patterns: ['\\b\\d+(\\.\\d+)?\\s?(×|x|times) (faster|quicker|sooner)\\b', '\\bin (half|a third of|a quarter of) the time\\b', '\\b(finishe[sd]|done) (first|before)\\b'] },
  { module: 'small-multiples', intents: ['proof', 'number'], when: 'walks through several benchmarks or tests at once ("across four benchmarks", "wins 18 of 20"): a dashboard of mini bar charts with one legend, each lighting its winner', patterns: ['\\bacross (\\w+ )?(benchmarks|tests|evals)\\b', '\\bwins? \\d+ of \\d+\\b', '\\b(benchmarks?|evals?) (dashboard|suite)\\b'] },
  { module: 'date-carousel', intents: ['turn', 'proof'], when: 'goes back or forward to a date ("rewind to October 5th", "three weeks earlier", "on launch day"): day cards rewind under a REWIND sign and land on the day with its event', patterns: ['\\brewind\\b', '\\b(\\w+ )?(days|weeks) (earlier|before|later)\\b', '\\b(january|february|march|april|may|june|july|august|september|october|november|december) \\d{1,2}(st|nd|rd|th)?\\b', '\\bwhere it (all )?started\\b'] },
  { module: 'drop-grid', intents: ['number', 'process'], when: 'counts things piling up ("10 times a day", "five posts a week", "every day for a week", "3 new clients"): cards, coins or tiles drop into a grid one per word with weight, dust and a climbing counter; time each drop with params.times', patterns: ['\\b(\\d+|ten|five|three|seven) (times|posts|reels|videos|clients|jobs|orders) (a|per|every) (day|week|month)\\b', '\\bevery (single )?day\\b', '\\b(piles? up|adds? up|stacks? up)\\b'] },
  { module: 'live-counter', intents: ['number'], when: 'describes a number still climbing ("and it keeps going up", "every minute", "right now", "views today"): a big figure that ticks up for the whole scene, milestones stamping as it passes them', patterns: ['\\b(keeps? (going up|climbing|growing)|still (climbing|growing)|right now|as we speak)\\b', '\\bper (second|minute|hour)\\b', '\\b(views|sales|sign-?ups|followers) (today|this (hour|week))\\b'] },
  { module: 'live-bars', intents: ['number', 'proof'], when: 'compares several things growing at once ("views per reel", "which hook is winning", "sales by product"): raised bars whose values tick up live, each number riding its bar', patterns: ['\\b(views|sales|clicks|leads) (per|by) (reel|post|video|product|channel)\\b', '\\bwhich (one|hook|post|ad) (is )?(winning|wins|is ahead)\\b'] },
  { module: 'frame-counter', overlay: 'frame.counter', intents: ['number', 'process'], when: 'tracks progress across the whole video ("day 1… day 14", "step 2 of 4", a running total like "the liability so far"): a counter in a top corner that climbs step by step and never re-enters (story.frame.counter, not a scene)', patterns: ['\\bday (\\d+|one|two|three)\\b', '\\bstep (\\d+|one|two|three) (of|out of)\\b', '\\b(running total|so far that\'s|adds up to)\\b'] },
  { module: 'month-grid', intents: ['number', 'process'], when: 'counts a run of days ("28 days", "every day for a month", "a daily release"): a month calendar whose day cells fill in sequence, with marks on the days that matter', patterns: ['\\b\\d{1,2} days\\b', '\\bevery (single )?day\\b', '\\b(daily|each day|day \\d+)\\b', '\\bfor a (whole )?month\\b'] },
  { module: 'person-id', intents: ['personal', 'proof'], when: 'introduces a real person by name and role in an explainer ("Professor X at Y", "the paper\'s author", "her advisor"): their photo with a glowing name pill and role', patterns: ['\\b(professor|researcher|scientist|author|physicist|mathematician)\\b', '\\b(phd|ph\\.d\\.|doctoral) (student|advisor)\\b'] },
  { module: 'lineage-graph', intents: ['personal', 'proof'], when: 'traces who taught or worked with whom ("his doctoral advisor", "her student", "trained under"): photos linked by dashed connectors with role labels', patterns: ['\\b(doctoral )?advis(or|er)\\b', '\\b(trained|studied) (under|with)\\b', '\\b(former )?student of\\b', '\\bmentor(ed)?\\b'] },
  { module: 'equation', intents: ['claim', 'proof'], when: 'shows or changes a formula ("the equation", "a sign error", "this term"): typeset LaTeX that reveals term by term, boxes the term in question and diffs red to green', patterns: ['\\b(equation|formula|term|coefficient|sign (error|flip))s?\\b', '\\b(derivative|integral|lagrangian|hamiltonian)\\b', '=\\s*[-−]?\\d'] },
  { module: 'title-decompose', intents: ['claim', 'proof'], when: 'unpacks a paper or report title word by word ("the paper\'s title", "in plain English that means"): the title as word chips, each key term linked to an icon and a gloss', patterns: ['\\b(the )?(paper|study|report)(\'s)? (title|is called|is titled)\\b', '\\bin plain (english|words)\\b', '\\bword by word\\b'] },
  { module: 'feynman-diagram', intents: ['process', 'claim'], when: 'describes particle interactions or loop corrections ("one loop", "exchanges a photon", "self-energy"): a Feynman diagram that draws itself line by line; particle physics only (any other line sketch is a line-diagram)', patterns: ['\\b(one|two)[- ]loop\\b', '\\bfeynman\\b', '\\b(self[- ]energy|self[- ]mass|graviton|photon|gluon|quantum correction)s?\\b'] },
  { module: 'line-diagram', intents: ['process', 'claim'], when: 'explains how something is laid out, built or fits together ("square it up with string lines", "the beam sits on the post", "the planned roof line", "a floor plan"): a labelled line sketch on a drafting plate that fills the frame and draws itself stroke by stroke; few, short labels', patterns: ['\\b(string lines?|floor ?plan|cross[- ]section|blueprint|wiring diagram|site plan)\\b', '\\b(beams?|joists?|bearers?|footings?|stumps?|rafters?|stirrups?)\\b', '\\bsquar(e|ing) (it|them|the \\w+)( up)?\\b'] },
  { module: 'progress-ring', intents: ['number'], when: 'states one real percentage of a whole ("87% of renders", "nine in ten"): a ring fills while it counts', patterns: ['\\b\\d{1,3}\\s?% of\\b', '\\b(nine|eight|seven) (in|out of) ten\\b'] },
  { module: 'ui-scene', when: 'shows a software tool doing its job on screen (an editor timeline, a terminal, a search, a download, a locked or unlocked feature): built as interface panels that change on the words', patterns: ['\\b(on|in) (your|the|my) (timeline|terminal|editor|dashboard)\\b', '\\bscans? (your|the) (timeline|repo|codebase|project)\\b', '\\bsearch(es)? and download', '\\bunlocks?\\b', '\\bfrom (the )?(terminal|command line)\\b'] }
].map((row) => Object.freeze({ ...row, patterns: Object.freeze(row.patterns) })));

/** The registry module a phrase-table row maps to (its fallback when the module is planned). */
export function phraseRowModule(row, modules = knownModules()) {
  if (row.overlay) return row.overlay;
  if (modules.includes(row.module)) return row.module;
  if (row.fallback && modules.includes(row.fallback)) return row.fallback;
  return null;
}

/**
 * Phrase hints: for each sentence of `text`, the registry modules whose
 * phrase patterns match (at most `limit` per sentence, table order).
 * subject: true when a usable presenter cut-out is available; rows that need
 * it (masthead, dolly-zoom) are skipped otherwise.
 * Returns [{sentence, modules: [id…]}] for sentences with at least one match.
 */
export function suggestModules(text, { lane, limit = 3, subject = false } = {}) {
  const modules = knownModules();
  const sentences = String(text ?? '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map((entry) => entry.trim()).filter(Boolean);
  const hints = [];
  for (const sentence of sentences) {
    const matched = [];
    for (const row of PHRASE_MODULE_TABLE) {
      if (row.lanes && lane && !row.lanes.includes(lane)) continue;
      if (row.needs?.includes('subject') && !subject) continue;
      const id = phraseRowModule(row, modules);
      if (!id || matched.includes(id)) continue;
      if (row.patterns.some((source) => new RegExp(source, 'i').test(sentence))) matched.push(id);
      if (matched.length >= limit) break;
    }
    if (matched.length) hints.push({ sentence, modules: matched });
  }
  return hints;
}

// ---------------------------------------------------------------------------
// Motion grammar and camera from the art direction

// Art-direction words → grammar. The first grammar with a match wins, in
// this order; no match keeps editorial.
export const ART_DIRECTION_GRAMMARS = Object.freeze([
  { grammar: 'playful', patterns: ['\\bplayful\\b', '\\bfun\\b', '\\bbouncy\\b', '\\bquirky\\b', '\\bkids?\\b', '\\bcartoon', '\\bwhimsical\\b', '\\bcheeky\\b', '\\bfriendly\\b'] },
  { grammar: 'snappy', patterns: ['\\bsnappy\\b', '\\bpunchy\\b', '\\benergetic\\b', '\\bhype\\b', '\\bbold\\b', '\\bfast[- ]paced\\b', '\\bkinetic\\b', '\\bhigh[- ]energy\\b', '\\bsporty\\b', '\\blaunch\\b'] },
  { grammar: 'documentary', patterns: ['\\bdocumentary\\b', '\\bserious\\b', '\\bsober\\b', '\\brestrained\\b', '\\bhistorical\\b', '\\barchival\\b', '\\binvestigative\\b', '\\bjournalis', '\\bnews\\b', '\\bsolemn\\b'] },
  { grammar: 'cinematic', patterns: ['\\bcinematic\\b', '\\bfilmic\\b', '\\bken burns\\b', '\\btrailer\\b', '\\bslow[- ]fast[- ]slow\\b'] },
  { grammar: 'smooth', patterns: ['\\bsmooth\\b', '\\bcalm\\b', '\\belegant\\b', '\\bpremium\\b', '\\bluxur', '\\bsoft\\b', '\\bdreamy\\b', '\\bwellness\\b', '\\bflowing\\b', '\\bminimal'] }
]);
// Art-direction words → module moods (catalogue `mood` tags): a module whose
// mood matches is listed first under "Favoured by the art direction".
export const MOOD_WORDS = Object.freeze({
  bold: ['\\bbold\\b', '\\bpunchy\\b', '\\bhype\\b', '\\bloud\\b'],
  editorial: ['\\beditorial\\b', '\\bmagazine\\b', '\\bjournal'],
  premium: ['\\bpremium\\b', '\\bluxur', '\\belegant\\b', '\\bpolished\\b'],
  launch: ['\\blaunch', '\\bannounc', '\\breveal'],
  cinematic: ['\\bcinematic\\b', '\\bfilmic\\b', '\\bmovie\\b'],
  dramatic: ['\\bdramatic\\b', '\\bintense\\b', '\\bsuspense'],
  playful: ['\\bplayful\\b', '\\bfun\\b', '\\bquirky\\b', '\\bcartoon']
});

/** Modules whose mood tags the art direction names: [{id, moods: [tag…]}]. */
export function suggestModuleMoods(artDirection = '', modules = moduleCatalogue()) {
  const text = String(artDirection ?? '');
  const named = Object.entries(MOOD_WORDS).filter(([, patterns]) => patterns.some((source) => new RegExp(source, 'i').test(text))).map(([tag]) => tag);
  return modules.map((module) => ({ id: module.id, moods: (module.mood ?? []).filter((tag) => named.includes(tag)) })).filter((entry) => entry.moods.length);
}

const WORLD_WORDS = ['\\bjourney\\b', '\\bexplore', '\\bmap\\b', '\\bworld\\b', '\\bcontinuous\\b', '\\bone[- ]take\\b', '\\bpans?\\b', '\\bcamera\\b', '\\bfly[- ]?through\\b', '\\btravel'];
const CUT_WORDS = ['\\bhard cuts?\\b', '\\bjump cuts?\\b', '\\bno camera\\b', '\\bstatic\\b'];

/**
 * Motion grammar and camera mode for an art direction (free text: the brief
 * or style notes) and lane. Footage-led stories always keep cuts and
 * punch-ins; the motion and voiceover lanes travel on the world camera
 * whatever the grammar (editorial and documentary travel more calmly), unless
 * the direction asks for cuts.
 * → {grammar, camera: {mode, layout?}, reason}
 */
export function suggestMotion({ artDirection = '', lane } = {}) {
  const text = String(artDirection ?? '');
  const match = (list) => list.some((source) => new RegExp(source, 'i').test(text));
  const row = ART_DIRECTION_GRAMMARS.find((entry) => match(entry.patterns));
  const grammar = row?.grammar ?? 'editorial';
  if (lane === 'footage-led') return { grammar, camera: { mode: 'cuts' }, reason: 'footage-led keeps cuts and punch-ins' };
  if (match(CUT_WORDS)) return { grammar, camera: { mode: 'cuts' }, reason: 'the direction asks for cuts' };
  if (match(WORLD_WORDS)) return { grammar, camera: { mode: 'world', layout: 'auto' }, reason: 'the direction asks for camera travel' };
  if (lane === 'motion' || lane === 'voiceover-motion') return { grammar, camera: { mode: 'world', layout: 'auto' }, reason: `motion videos travel between scenes (${grammar} pace)` };
  if (['playful', 'snappy', 'smooth', 'cinematic'].includes(grammar)) return { grammar, camera: { mode: 'world', layout: 'auto' }, reason: `${grammar} motion travels between scenes` };
  return { grammar, camera: { mode: 'cuts' }, reason: `${grammar} motion cuts between scenes` };
}

function motionLines({ lane, artDirection, style } = {}) {
  const lines = [
    `motion? {grammar, feel?}: one feel for every entrance, exit, pop, stagger, transition and camera move. grammar is one of ${GRAMMAR_NAMES.join(', ')}, or {base, ...overrides} (ease: {enter, exit, move, camera, emphasis}, duration: {enter, exit, transition, camera}, stagger multiplier). Omit it for editorial, the default.`,
    ...GRAMMAR_NAMES.map((name) => `${name}: ${GRAMMARS[name].describe} Camera ease ${GRAMMARS[name].ease.camera}, camera moves about ${GRAMMARS[name].duration.camera} s, transitions about ${GRAMMARS[name].duration.transition} s.`),
    `camera? {mode: "cuts" | "world", layout?: ${STORY_CAMERA_LAYOUTS.join(' | ')}, spacing?: 0–1, parallax?: boolean, blur?: boolean}. "cuts" (default): scenes replace each other. "world": every track-0 scene sits in one world and the camera travels to it, with a slow drift (never fully still), a parallax background (0.3×) and overlays at 1.15×. Motion blur: whip-pans always; pans, pushes, pulls and orbits get a moderate blur in snappy and playful; blur true blurs every move fully, false none.`,
    'Camera transitions (scene.in or ending.in, track-0 scenes only): pan {direction: where the next scene sits, e.g. "right"}, whip-pan (fast, motion-blurred), orbit (pan with a slight turn), pull (dolly out to a wider scene) and, in world mode only, push (dolly into a named object: in.from_object "s3.gap-bracket", else the scene content). In cuts mode push keeps its slide meaning, and pan/whip-pan/orbit/pull still move a camera between the two scenes.',
    'Choose by meaning and art direction: pan for continuation along a path, push to go deeper into a detail, pull to reveal the bigger picture, orbit for a change of angle on the same subject, whip-pan for energy or a time jump, cut/fade when the story jumps. Give camera moves 0.6–1.2 s (whip-pan 0.3–0.5 s) and keep scenes at least 2 s longer than their move.',
    'Captions and camera moves: a vertical pan or whip-pan (up/down), push, pull or orbit carries panels through the caption band mid-move, so the captions dip out for those moves by default (captions overlay hide_during_moves: "auto"; true dips for every move, false never). Horizontal pans keep their captions. layout-check samples every frame of every camera move and flags key content crossing visible captions (camera-caption-band). When a line must stay captioned through the move, pan left or right.',
    'Zooms inside a shot: scenes[i].zooms [{at: <anchor>, box {x, y, width, height} (plate px, any module) | target (a state target: item index or element id, e.g. 0, "bar-2", "row-1", on the modules that run states) | object (a named object, e.g. "gap-bracket"), scale?: 1.15–3 (default fills ~70 % of the frame), until?: <anchor>}] (1–8, track-0 shots). The camera dives into the bar, row or number as the line names it, holds at least 1.2 s after its 0.8 s move (so until is at least 2 s after at) and eases back out at until (without until: straight on to the next zoom, or out by the shot\'s end). The zoomed box, scaled, must stay inside the frame less a 5% inset, so zoom into part of a full-width panel (a card, a row, the dial), never the whole of it. Never during the shot\'s entry move; with until, leave 0.8 s before the next zoom and before the shot ends. World mode moves the camera; cuts mode zooms the shot itself. Captions are unaffected. Use 2–3 a minute on the values the narration names.',
    'Overview (world mode only): in {type: "overview", dur ≥ 2 (2.4–3 s), span: "chapter" | 3–8, hold?: 0.6} pulls the camera back until the chapter\'s shots (or the last n) show as a map, frozen on their last frame, holds, then dives into this shot. Use one per chapter at most, on its last line or a recap line ("So…", "Either way…"), never into the first shot and at most one a minute.',
    'In world mode, an ending {"loop_to": "s1", "in": {"type": "whip-pan", "dur": 0.4}} travels home for a seamless loop.',
    'Story feel: motion {feel: "kinetic"} makes the whole video move like a top faceless animated reel with one setting: an ambient camera drifts (±0.9 % of the frame) and breathes (scale 1.02–1.045, 4–7 s waves) under every shot in every camera mode (world mode keeps its own drift), zoom kicks punch to ×1.05 over 0.12 s on the emphasised words and numbers of the narration and spring back over 0.35 s with 27 % overshoot (at most one per 1.5 s, never during a transition, camera move or zoom; a kick lasts 0.47 s (0.32 s with snap), so one within 0.53 s before a transition\'s scene start is refused too), entrances and pops spring with 27 % overshoot over the snappy grammar, and settled shots stay lively. Footage-led stories keep their base camera (no ambient camera or kicks). motion {feel: "steady"} is the same with a steadicam: the camera floats on one smooth path through wandering framings (a new direction every 3–6 s), never stopping, snapping or zooming in and out on a beat; there are no automatic kicks and explicit ones are eased. Use steady for interface explainers and anything calm or premium. motion {feel: "snap"} rests on a framing for 1.6–4.5 s and jumps to the next in 0.28 s: use it sparingly, a camera that moves about every second reads as disorienting. Overrides: motion.feel {preset: "kinetic" | "snap" | "steady", ambient?: false | {mode?: "drift" | "step" | "steady", scale?: [lo, hi] (1–1.08), shift?: 0–0.02, period?: [lo, hi] s, hold?: [lo, hi] s (1.2–10, step), move?: s (0.08–0.6, step), creep?: 0–0.5 (step)}, kicks?: false | "auto" | {auto?, scale?: 1.03–1.4, gap?: 1.1–10 s}, spring?: overshoot 0–0.6}; an explicit motion.grammar still wins over the feel\'s eases.',
    'Zoom kicks by hand: camera.kicks [{at: <anchor>, scale?: 1.03–1.4 (default 1.05), origin?: {x, y} (shares of the frame, default the centre)}] on the words that land a point ("word:twelve"); they work with or without a feel. A kick that falls in a transition or within 1.5 s of another is dropped with a warning; a kick bigger than one that keeps the content (the safe zone and the headline and top-bar margin) in frame on top of the ambient breathing is reduced with a warning (about ×1.05 in 9:16).',
    'With the kinetic feel, cut with whip-pan {dur: 0.26, direction} (the tuned whip: the next scene arrives on the same axis with directional motion blur) and turn chapters with dot-wipe {dur: 0.5} (a halftone dot grid grows in from the edges, the scene swaps at the peak, the dots shrink from the centre; track-0 scenes only). Options: color ("accent" default, "ink", "paper" or a #rrggbb hex), cover (the peak dot size 0.3–1, default 0.65 so the dots just touch and the cut shows through instead of a solid blink; 1 closes it) and hold (frames held at the peak, default 0).',
    'Lanes: footage-led keeps camera.mode "cuts" and uses punch-in for emphasis (no camera transitions). The motion and voiceover-motion lanes may use the world camera; use it when the direction asks for travel or the grammar is playful, snappy, smooth or cinematic.'
  ];
  // A pack that sets its motion and camera decides them; the wording of the brief does not.
  if (style?.motion && style?.camera?.mode) lines.push(`For this request: the style pack sets the motion and camera (camera.mode "${style.camera.mode}"); keep them.`);
  else if (artDirection || lane === 'motion' || lane === 'voiceover-motion') {
    const suggestion = suggestMotion({ artDirection, lane });
    lines.push(`For this request: motion.grammar "${suggestion.grammar}" and camera.mode "${suggestion.camera.mode}" (${suggestion.reason}).`);
    if (suggestion.camera.mode === 'world') lines.push('In world mode make it feel like one place the camera explores: an entry move on most track-0 scenes (push into the detail a line names, pull to reveal, pan along a sequence, whip-pan on a turn), 2–3 zooms a minute on the numbers, bars and rows the narration names, an overview on the recap line, and a backdrop that changes every 6–10 s (plate.cycle). Never a flat, empty frame.');
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Module catalogue

function hidesCaptionsFrom(describe) {
  return /\bHides captions\b/i.test(String(describe ?? ''));
}

function paramText(spec) {
  if (typeof spec === 'string') return spec;
  if (!spec || typeof spec !== 'object') return String(spec);
  const parts = [String(spec.type ?? 'value')];
  if (spec.required) parts.push('required');
  if (spec.enum) parts.push(`one of ${spec.enum.map((value) => JSON.stringify(value)).join(' | ')}`);
  if (spec.min !== undefined) parts.push(`min ${spec.min}`);
  if (spec.max !== undefined) parts.push(`max ${spec.max}`);
  if (spec.default !== undefined) parts.push(`default ${JSON.stringify(spec.default)}`);
  if (spec.optional) parts.push('optional');
  const head = parts.join(', ');
  return spec.description ? `${head} — ${spec.description}` : head;
}

/**
 * Every known module with its prompt-facing description:
 * [{id, family: "catalogue" | "editorial", describe, params: [{name, text, tuning}], events, hidesCaptions, needs?, layer?, aspects?, mood?}].
 */
export function moduleCatalogue() {
  const catalog = catalogModules();
  return knownModules().map((id) => {
    if (isEditorialKind(id)) {
      const spec = EDITORIAL_SPECS[id];
      return {
        id,
        family: 'editorial',
        describe: spec?.describe ?? `Editorial ${id} panel (see editorial-ui-modules.md for its spec).`,
        params: [
          { name: 'title', text: 'string ≤ 54, required', tuning: false },
          ...Object.entries(spec?.params ?? {}).map(([name, text]) => ({ name, text, tuning: false })),
          ...(EDITORIAL_VARIANTS[id] ? [{ name: 'variant', text: 'one of the variants below, the panel\'s designed look (optional; default: the style\'s variants[module], else the first); usually leave it to the style', tuning: false }] : []),
          ...['rect', 'density', 'accent', 'theme', 'presentation', 'motion'].map((name) => ({ name, text: name === 'rect' ? '{x, y, width, height} canvas px (width ≥ 420, height ≥ 160); usually omit it' : name === 'density' ? '"fill" (an explicit rect\'s text grows to fill it; recommended with rect in 16:9) | "fixed"' : name === 'accent' ? '#rrggbb' : name === 'presentation' ? '"solid" | "glass"' : name === 'motion' ? '{enter, exit, distance, enterDuration, exitDuration, scale}' : '{surface, foreground, muted, border, accentText?}', tuning: true }))
        ],
        events: spec?.events ?? ['enter'],
        hidesCaptions: false,
        ...(EDITORIAL_VARIANTS[id] ? { variants: [...EDITORIAL_VARIANTS[id]] } : {})
      };
    }
    const definition = catalog[id];
    return {
      id,
      family: 'catalogue',
      describe: String(definition.describe ?? id),
      params: Object.entries(definition.params ?? {}).map(([name, spec]) => ({ name, text: paramText(spec), tuning: TUNING_PARAMS.includes(name) })),
      events: Array.isArray(definition.events) ? [...definition.events] : [],
      hidesCaptions: hidesCaptionsFrom(definition.describe),
      ...(definition.needs ? { needs: [...definition.needs] } : {}),
      ...(definition.layer ? { layer: definition.layer } : {}),
      ...(definition.aspects ? { aspects: [...definition.aspects] } : {}),
      ...(definition.mood ? { mood: [...definition.mood] } : {}),
      ...(Array.isArray(definition.variants) && definition.variants.length > 1 ? { variants: [...definition.variants] } : {})
    };
  });
}

// ---------------------------------------------------------------------------
// Prompt sections

function tierRules(tier) {
  const common = [
    `Use only the module ids listed under "Modules". Any other id is rejected.`,
    'Use only the params a module lists; unknown params are rejected. Never set params.id, kind, aspect, start or duration (they come from the scene and the format).'
  ];
  if (tier === 'structured') return [...common,
    `Never set ${TUNING_PARAMS.map((name) => `params.${name}`).join(', ')} or scene.track: tooling places every module in the safe zone. No raw coordinates.`,
    'Never use "module": "custom".'];
  if (tier === 'guided') return [...common,
    `You may tune params: enum variants, colour roles, and ${TUNING_PARAMS.join(', ')}. A rect must sit inside the safe zone and, while captions are visible, above the caption band.`,
    'Never use "module": "custom".'];
  return [...common,
    `You may tune params, including ${TUNING_PARAMS.join(', ')}.`,
    'You may use {"module": "custom", "source": "modules/<file>"} for a topic-specific world. A custom module must be a pure function of absolute time, obey the safe zone, and have a catalogue module it can fall back to; say which one in scene.notes.'];
}

function laneRules(lane, profile = null) {
  const rules = {
    motion: 'motion: no voice. Full-frame modules cover the whole duration back to back on track 0 (no gaps). Time scenes in seconds or beat anchors. finish snaps second-timed cuts to the nearest downbeat (within 0.25 s), so plan cuts on bar lines where you can.',
    'voiceover-motion': 'voiceover-motion: audio.voice and audio.words are fixed inputs; copy them unchanged. Full-frame modules cover the whole duration on track 0. Start scenes and place hits on word anchors from the narration so visuals land on the spoken word. Add a captions overlay.',
    'footage-led': `footage-led: base (the edited recording under assets/) plays underneath and is a fixed input; copy it unchanged. Scenes are overlays beside the presenter and full-frame inserts (insert: true), placed where the direction map says: every dress or insert line gets its scenes, and face lines keep the recording on purpose. ${coverageRule(profile)}${faceTimeRule(profile)} Add a captions overlay.`
  };
  return lane && rules[lane] ? [rules[lane]] : STORY_LANES.map((name) => rules[name]);
}

// The footage-led coverage rule: the cadence profile's band (RFC §5.5), not a fixed cap.
function coverageRule(profile) {
  const band = profile?.measures?.coverage;
  const run = profile?.measures?.longest_undressed_seconds;
  if (!band) return 'Coverage (the share of the runtime with a graphic on screen) lands inside the story\'s cadence profile band (references/profiles.md); no undressed run longer than the profile allows.';
  const pct = (value) => `${Math.round(value * 100)}%`;
  return `Coverage (the share of the runtime with a graphic on screen) aims at ${pct(band.p50 ?? band.p10)} and stays between ${pct(band.p10 ?? 0)} and ${pct(band.p90 ?? 1)} (profile ${profile.id})${run?.p90 != null ? `; no stretch longer than ${run.p90} s without a graphic` : ''}.`;
}

// The footage-led face-time rule: cut away from the presenter, up to the band's ceiling.
function faceTimeRule(profile) {
  const band = profile?.measures?.face_time;
  if (!band || band.p90 == null || band.p90 >= 1) return '';
  const pct = (value) => `${Math.round(value * 100)}%`;
  return ` The presenter is on screen for about ${pct(band.p50 ?? band.p90)} of the runtime and never more than ${pct(band.p90)}: lines that name something the viewer could see (a thing, a place, a step) cut away to a full-frame insert (a shot, or a full-frame graphic).`;
}

/**
 * The band a story's captions take, in px of its format: the profile's band
 * at the style pack's caption position, grown about its centre to the
 * tallest line the pack's preset and size draw (what the layout check
 * measures against). → {band, position, moved: the band is not the
 * profile's own}, or null without a format.
 */
export function plannedCaptionBand({ format, style = null, lane, brand } = {}) {
  const canvas = { width: Number(format?.width), height: Number(format?.height) };
  if (!(canvas.width > 0 && canvas.height > 0)) return null;
  const usual = profileGeometry(canvas).captionBand;
  const captions = style ? packCaptionsFor(style, lane) : null;
  if (!usual || !captions || captions.preset === 'none') return { band: usual, position: 'auto', moved: false };
  let band = usual;
  try {
    const extent = captionLineExtent(captionOptions({ type: 'captions', ...captions }, { brand: brand ?? DEFAULT_BRAND, format }), format);
    if (extent > band.height) band = { ...band, y: band.y - (extent - band.height) / 2, height: extent };
  } catch { /* an unknown preset is the checks' to report */ }
  band = captionBandAt(band, canvas, captions.position);
  band = { x: Math.round(band.x), y: Math.round(band.y), width: Math.round(band.width), height: Math.round(band.height) };
  const position = ['top', 'middle', 'low'].includes(captions.position) ? captions.position : 'auto';
  return { band, position, moved: band.y !== Math.round(usual.y) || band.height !== Math.round(usual.height) };
}

// captions: plannedCaptionBand()'s result for this story, when its captions are not in the profile's own band.
function safeZoneLines(format, captions = null) {
  const portrait = !format || Number(format.height) > Number(format.width);
  const profiles = format ? [portrait ? SAFE_ZONE_PROFILES.shorts : SAFE_ZONE_PROFILES.landscape] : [SAFE_ZONE_PROFILES.shorts, SAFE_ZONE_PROFILES.landscape];
  const box = (rect) => `x ${rect.x}–${rect.x + rect.width}, y ${rect.y}–${rect.y + rect.height}`;
  const moved = format && captions?.moved ? captions : null;
  const lines = profiles.map((profile) => `${profile.id} (${profile.reference.width}x${profile.reference.height}): key content within ${box(profile.safeZone)}; caption band ${box(moved ? moved.band : profile.captionBand)}${moved ? ` (this story's captions: ${moved.position === 'auto' ? 'the usual position, with taller lines' : `position "${moved.position}"`})` : ''}; centre of mass near y ${profile.centerOfMassY}; key text at least ${profile.minTextPx} px${profile.lowerThird ? '; keep the lower third occupied' : ''}.`);
  return [
    ...lines,
    // Scene text is planned outside the band the captions take; tooling settles what is left (src/caption_band_fit.js).
    ...(moved ? [`The style pack puts this story's captions ${moved.position === 'auto' ? 'in a taller band than usual' : moved.position === 'middle' ? 'in the middle of the frame' : moved.position === 'top' ? 'at the top of the frame' : 'low in the frame'}: wherever these rules say "the caption band", it is y ${moved.band.y}–${moved.band.y + moved.band.height}, and "above the caption band" means clear of it, above y ${moved.band.y} or below y ${moved.band.y + moved.band.height}. Plan every scene's own text (a title, a card, a label) clear of that band, so the captions stay on screen with it: ${moved.position === 'top' ? 'keep a clip\'s callouts in their bottom slot' : 'give a clip\'s callouts position "top"'}, and where you set a rect or a position, keep key text clear of y ${moved.band.y}–${moved.band.y + moved.band.height}. A module that places itself may still sit across the band: tooling then moves the card out of it, or moves the captions for that scene, and hides the captions only when neither fits, so a caption-band error is never a reason to change a module, drop a scene or shorten copy. Captions hidden for more than ${Math.round(CAPTION_HIDDEN_MAX * 100)}% of the narration fail the storyboard (a "captions:" error names the scenes): give those scenes a module whose text sits clear of the band, or less text.`] : []),
    'Captions are on for the whole narration: plan scene text (titles, cards, labels) outside the caption band, never across it.',
    'Catalogue modules size and place themselves inside the safe zone and fail with a param error when copy is too long; shorten copy rather than shrinking it.',
    'Editorial modules without a rect size and place themselves from their content inside the safe zone and above the caption band, with type scaled to fill the panel; omit rect unless the layout needs a specific position. With a rect in 16:9, also set density: "fill", or the text stays small and a bigger rect is just more empty panel. They need a 1080x1920 or 1920x1080 format.'
  ];
}

const FOOTAGE_CAPTIONS = 'In the footage-led lane write {"type": "captions"} with no style or preset: the default is the quiet sentence-case quiet-accent preset with one accent word per line; name word-highlight only when the brief asks for loud captions.';

function captionLines(lane) {
  return [
    `Captions are one overlay: {"type": "captions", "style": ${STORY_CAPTION_STYLES.map((value) => JSON.stringify(value)).join(' | ')}}. ${lane === 'footage-led' ? FOOTAGE_CAPTIONS : lane ? 'Use "word-highlight" whenever there is a voice.' : `Use "word-highlight" whenever there is a voice, except in the footage-led lane. ${FOOTAGE_CAPTIONS}`}`,
    `A caption preset may replace style: {"type": "captions", "preset": "<name>"}, one of ${Object.keys(CAPTION_PRESETS).join(', ')}. With a style pack, write {"type": "captions"} and let the pack choose the preset.`,
    'Modules marked "hides captions" hide them while on screen; every other module keeps them visible, so its content stays above the caption band.',
    'On-screen copy is shorter than the narration; never put a whole sentence on screen.'
  ];
}

// The long-form explainer look (VISUAL_GAP_MAP C1, D5, C5): one blurred
// plate per chapter, glass panels, and the channel's furniture.
export function glassLookLines() {
  return [
    'Backdrop plates: plate {kind: hex-shell | silk | strands | bokeh | starfield | smoke | wash | image | video, params?: {focus, intensity, speed, depth 0–1 (speed 0–2), tint: neutral | primary | accent}, cycle?} sets an out-of-focus plate that drifts under every scene; it holds across a chapter and changes at the next (cycle: true walks the first four kinds per chapter, or set chapters[j].plate). scenes[i].backdrop (or .plate) overrides one scene ("none" for the story background). starfield (deep space) and smoke (grey wisps) are dark like the first four; wash is a bright full-frame gradient for a short punctuation shot (put a paneled card or ink text on it); image is a project still, blurred and dimmed: {kind: "image", params: {src: "assets/…", blur?: 0–80, dim?: 0–1}}. video is a project clip under an overlay that keeps text readable: {kind: "video", params: {src: "assets/….mp4", start?: seconds, treatment?: dim | blur | tint}}. Build a chapter as several states over one plate rather than cutting to new backgrounds.',
    'World camera backdrops: with camera.mode "world" the backdrop moves with the camera and changes with its moves (a pan slides the next one in from the side it travels toward, a push or pull crossfades, a cut switches). For the open-world look give it a new backdrop every 6–10 s: plate.cycle {every: n, plates?: [kinds or {kind, params}]} rotates every n shots without naming each one (n ≈ 8 s ÷ your shot length), and chapters[j].plate or scenes[i].backdrop place a specific one (a wash on a punchline, a starfield for scale).',
    'Glass: panel {treatment: "rim-glass"} turns every card (stat-card, excerpt, quote-card, …), window-chrome and comparison-table into translucent glass with a cyan (primary) rim and glow. Type stays paper and primary; the accent is for the one brand being discussed.',
    'Channel furniture: logo-sting opens and closes (rain, particles or clear); subscribe-cta goes on track 1+ over a card scene for 5–6 s, two or three times in a long video, never over a key figure; channel-watermark goes on the highest track across the main body (decor: scenes pass under it).'
  ];
}

// Code evidence: the receipt beat, rebuilt from real GitHub data.
export function codeEvidenceLines() {
  return [
    'A claim about code ("they are already testing it", "it shipped") lands on its receipt: repo-pr-card (a PR), commit-card (a commit), diff-view (what changed, row by row) or terminal-session (a run). Box the token (a model name, a flag) with highlight and time highlightAt to its word: "highlightAt": "word:terra".',
    'Real data only: map a public PR or commit with `node src/evidence/github.js <url> --token <text>` (cached under assets/evidence/, avatars too) and paste its params; never type or invent repo names, numbers, shas, authors or lines. Lines stay verbatim (cropping round the token is the module\'s job).',
    'Several sources for one name: evidence-chain (2–4 cards, one per beat, the token joined by a dashed connector) or date-pinned-timeline (cards pinned to their dates on a scrubbing day axis; the summary variant is the "why now? N clues in N days" recap). Keep one shot and build it source by source rather than cutting card to card.'
  ];
}

// 3D data objects (catalogue I): when they beat a flat chart, and the build-not-cut rule.
export function objectLines() {
  return [
    'Catalogue I modules (glass-bars-3d, coin-stack, rack-shelf, device-box, paper-stack, planet-family) are real 3D objects drawn from data under a slow orbiting or dollying camera. Use one for the hero beat of a chapter (the price line-up, the cost gap, the model family), not for every number: a flat bar-chart or stat-card keeps the pace between them.',
    'Build, do not cut: give one 3D scene 2–4 states on the words that name them (bars grow, then the lit bar on "half the price"; trays stack, then the focus tray slides out on its name; the marker hops step to step; the readout counts while the narration talks about load; each paper section gets its check or flag on its word).',
    'Values, prices, scores and statuses come from the brief or assets only. Names are short (≤ 24, planets ≤ 16): the modules fail when text no longer fits at key size on its face, so shorten the copy or use fewer items rather than shrinking it.',
  ];
}

// The satisfying-motion kit: things that pile up as they are said, numbers
// that never stop, objects with weight, and a progress frame across scenes.
export function satisfyingLines() {
  return [
    'Make the words physical. When the line counts things ("10 times a day"), drop-grid drops one card per word: set params.times to the word times so each landing hits its word. When a number is still growing, live-counter or live-bars keep it ticking for the whole scene instead of landing and stopping.',
    'Weight beats fades: drops fall, squash and settle with a contact shadow and a puff of dust; milestones and deltas stamp in. One tactile hero per beat; keep a still beat after a big landing so it reads.',
    'A progress frame holds the video together: frame.counter {label? ≤ 24 ("DAY", "LIABILITY"), format? {prefix?, suffix?, pad?}, steps: [{scene | start, value | text}]} climbs in a top corner on the words that move it (day 1 → day 14, $0 → $261,118), and frame.progress {style: "scrubber"} carries a knob along the bottom. Values come from the script only.',
    'Caption presets for this look: tag-chips (the sentence builds word by word; key phrases land in ink chips) or serif-accent (one key word per line turns serif italic in the brand colour). Mark the key phrases in captions.emphasis.'
  ];
}

// Interface scenes (kit/core/catalog-i-ui.mjs): the director lays out tuned
// UI components that change on the words.
export function interfaceLines() {
  return [
    'Show the tool working, not a picture of it: a ui-scene places interface components (params.elements) on a 1080-wide design canvas (1920 wide in 16:9) and each one enters, changes and resolves on the words. Every time (an element\'s at and out, a beat\'s at, any prop ending in At) is seconds from the scene start or a word anchor ("word:exact", "word:it#2-0.1", "word:frame+0.1"). "word:<text>" is the first time the narration says it, wherever the scene is: a later one needs #n, counting every occurrence from the start of the narration (story validate warns when a repeated common word has none).',
    'Cut like the reference: a new scene (or a new hero panel inside one) every 2–3 s, joined by whip-pans. The cadence counts a new hero panel inside a scene as a cut only when its rect covers at least 20% of the canvas (e.g. 760×546 in 9:16) and it enters 0.3 s or more after the scene start. Only headlines count as reading text for the text-hold gate (0.22 s a word); panel titles, track and clip labels, card names and chips are glanced at, so label the interface fully.',
    'One hero panel per scene (a window, timeline, terminal, lock-cards, results, card-wall, downloads, meter, frame-ruler, scan-plane, comment), a headline above it and one or two chips that slam in on the key word. The first scene of the video opens built: its panel and headline enter: "cut" at 0 (no move, on screen at frame 0); every other scene puts something on screen by 0.6 s.',
    'Two kinds of element, two rules. Text (headline, chip) is checked at the box it sets in (about 0.6 × size × characters wide for a headline): inside the platform safe zone (x 80–940, y 280–1450 in 9:16; centred on 540 a headline sets at most about 800 px wide) and clear of the caption band. Panels (everything else) may use the whole stage (x 40–1040, y 240–1450) and run under the captions, whose word chips sit on their own plate. With captions position "low" (the signal-ui default: one uppercase word on a small dark chip, centred 58% down) the band is y 998–1229: put headlines and chips above or below it and let a tall hero panel run behind it, top to bottom, as the reference reels do. With "middle" the band is y 845–1075. With bottom captions the band is y 1190–1420. A tilted panel is checked at its turned footprint, so shrink it or move it in. A decorative waveform or card wall may set bleed: true to run to the edge. Settled elements hold still (no hold drift): life comes from entrances (slam for the key word, zoom for a panel, left/right/up/drop/pop for parts, hop for the host, cut for an opening frame), beats ({at, set: {...props}, cue?}: a chip flips its text, a headline its text or tone) and the shared camera. The alert tone is the broken "before" state, the accent the fix. Elements of one scene may overlap (a chip on a panel, a card over a wall); the layout check only stops them colliding with another scene\'s. A whip-pan starts at the scene start, so give each scene\'s hero panel enter: "cut" at 0: it is built when the move lands, and parts and chips arrive after.',
    'Fill the frame like the reference: every scene is a dense collage in 2–3 depth layers that runs the stage top to bottom (y 240–1450), never a headline over one flat panel with the bottom third empty. Lay the panels out with an arranged stack: {kind: "stack", arrange: "fan" | "wall" | "stack" | "orbit", rect (the region it fills, default the whole stage; e.g. {x: 40, y: 470, width: 1000, height: 980} under a headline), at, enter, children [panels, the first the sharp front hero]}. It places, sizes, tilts and depth-blurs each child for you (children take no rect, depth or tilt; their own children shrink to fit), keeps the hero clear of the caption band and the rest on the stage. fan (2–5): cards fanned on a diagonal behind the hero; wall (3–16): the hero in front of a receding wall of small cards; stack (2–5): a cascade, each card lower, smaller and deeper; orbit (3–7): cards circling the hero, far at the top, near at the foot. Headlines, chips and blooms stay their own elements beside the stack.',
    'Vary the arrangement scene to scene (fan, then wall, then a hand-built split, then orbit…) and never repeat the same headline + panel template more than twice in a row. The layout check warns (stage-fill) when a ui-scene leaves a band over a quarter of its stage empty for more than 1.5 s; its message names the band to fill.',
    'Type hierarchy, not one big line: set a headline as rich lines (props.lines) that mix sizes inside one headline. Pair a small setup line over a big payoff line: [{text: "RIGHT PLACE.", size: "s"}, {text: "RIGHT *LEVEL.*", size: "l"}]. Put a number huge, alone on its line, accented and counting up, with its word small under it: [{text: "5M+", size: "xl", accent: true, count: true}, {text: "CREATORS", size: "s"}]. Mark at most one accent word per headline (*word* in a line, or accent: true on a line that is only the number); everything else stays ink. Sizes: s 52 px (tracked out, the setup), m 76, l 112 (the payoff), xl 200 (a number or a word of five letters or fewer); a line sets about 0.6 × size × characters wide (0.7 for s), so an l line holds about 12 characters and an xl line about 7 within 860 px. The rect must be as tall as the lines stacked (their sizes plus about 6% gaps). Lines after the first stagger in 0.12 s apart (props.stagger) or at their own at; a beat changes them with set.lines. Keep plain {text, size} for a one-line hit.',
    'Depth and focus: headlines focus in by default (blurred to sharp in 0.42 s) and rack out at out; set enter: "slam" only for a hit word. depth 0–1 on top-level elements: 0 the hero panel, 0.3–0.5 a supporting panel, 1 a decorative backdrop (card wall, bleed); deeper draws behind, smaller, dimmer and softer. params.stage {tilt: 6–10, dolly: {x: 40–80, y: 20–40, scale: 1.04–1.08}} gives the scene parallax: the camera drifts and far layers lag; keep panels about 40 px inside the stage, since the dolly and tilt carry them outward: the checks measure the drawn footprint, the rect zoomed by the dolly\'s scale S about (540, 864), shifted by its x, and widened by the tilt T below the canvas centre by k = 1 / (1 − (y − 960)·sin T / 1600) at its bottom edge y. A centred panel fits the stage when width ≤ 2·(500/k − |dolly x|)/S: about 870 at tilt 6 with dolly {x: 30, scale: 1.05} and the bottom at y 1300. A hero headline drawn at 70–90% of the safe width (600–770 px) fits the safe zone with any of these stages; a hero-fill warning means the headline is set too small.',
    'Light on the beat: flashAt: "word:…" (or a list) on the panel the line is about flashes it like an exposure, two or three per scene at most (flashTone: "accent" for a win). A bloom element (a 400–700 px rect centred on what changes, at the same anchor as its unlock) swells a soft glow for unlocks, hits and reveals. Pair one with a beat cue; never light every beat.',
    'The hero burst: on the reel\'s one or two hero beats (the reveal, the unlock that pays the promise off) put a burst element: thin bright rays and a white-hot flare core shoot out of a point and fade in about 0.6 s. Aim it with props.target (the id of the panel, card or headline that changes; give that element an id) and no rect, or give it a 500–1000 px rect centred on the point; at is the hero word ("word:unlocked"), cue "impact". Props: rays 6–24 [14], tone [accent], strength 0–1.5 [1], duration 0.3–1.2 s [0.6]. Use it once or twice per reel, never on every beat: the soft bloom and flashAt are for the other beats.',
    'Transitions of light and camera, not graphics: push-blur (0.45–0.5 s; direction = where the content travels, default up) between beats (the signal-ui default); light-sweep (0.5 s, accent) for a chapter turn or a big reveal, once or twice a reel, on track-0 scenes and dark brands where the light reads. Prefer these to dot-wipe: nothing opaque ever covers the frame. motion.blur {samples: 6, shutter: 1.5} (the signal-ui default) smears whips, kicks and pushes like film at about 4× render time; leave it off for quick drafts.',
    'Story light: light: {preset: "studio"} (the signal-ui default) lights the stage: an accent glow from the top centre, a floor pool, dark corners and faint haze; spot for a single hero moment, soft for calm explainers; override single fields (key: {intensity: 0.4}, pool: false). Put one light.pulses bloom on each key beat ({at: "word:unlocked", x, y centred on what changes, radius 0.3–0.45, intensity 0.7–0.9, duration 1–1.5}), one or two a scene. A dot grid with params.lit 0.8–0.9 and a low intensity (about 0.06) is a smooth dark ground whose faint dots show only where the key light falls (the signal-ui default); never a busy grid behind the interface. Keep headlines in the upper safe zone, under the key light.',
    'Panels have a smallest legible size (the module fails smaller) and paint inside their rect: meter 560×320, timeline 600×340, terminal 560×320, results 560×420, downloads 560×300, frame-ruler 800×440, marker-snap 560×240, pad-grid 150×130 a pad plus 20 px gaps (9 pads in 3 columns: 490×430; more cols, fewer rows), scan-plane 600×360, comment 560 wide and 0.75 of the height its parts stack to (120 for the box, 260 with the sent bubble, 485 with a reply and links: at least 364), lock-cards 110 px a card plus 120 px for its counter (and 64 for a title).',
    'Element keys: kind, rect, at, enter, out (it lifts and fades), props, beats, children (window and stack: rects relative to the parent, entering no earlier than it), arrange (a top-level stack: fan, wall, stack, orbit), tilt {x, y, z} degrees (a 3D plane), z (stacking), bleed, cue (the entrance sound; null for none; default by enter: slam impact, zoom whoosh, pop pop, drop thud), enterDuration 0.1–1.5 s, dist (entrance travel px), overshoot 0–3 (spring), id.',
    'Components (props, defaults in brackets): headline {text ≤ 40 chars, size px [112], tone ink|muted|accent|alert [ink], glow, align center|left|right, weight [900], swap {at, text, size, lines}} or {lines: [{text (*word* in the accent), size s|m|l|xl|px [l], accent, weight, tone, count (true or {from, dur}: the line\'s number counts up as it lands), enter, at}] (1–4), stagger s [0.12], tone, glow, align}; chip {text, tone [accent], fill solid|outline|quiet [solid], size px [30], glow, font mono|display [mono], rotate deg}; waveform {bars [width/14], seed, tone [muted], shape even|rise|decay|pulse, draw (s the bars take to draw in) [0.45], clipAt (turns the alert tone with dashed clip lines)}; window {title, sub, right (header text), ring (tone of a 3 px ring)} + children; stack + children (a group with no surface).',
    'timeline {title, sub, tracks [{label (V1, A2), kind video|audio|sfx, name (an audio track\'s file), seed, clips [{label, x and width (0–1 of the lane), tone (alert = a loud tilted chip, accent = a clean clip), rotate, at, flipAt, flipLabel, flipTone}]}], clipAt (audio tracks go red and clip), meter {level 0–16 bars [7], alertAt (jumps to 14, red), level2, level2At}, playhead {from, to (0–1 of the lane), at, dur s [3]}}. lock-cards {title, sub, cards [{no, name, sub, icon (any one glyph or emoji shown once it unlocks [✓]; locked cards show 🔒), tag (a pill on the card), at, enter, unlockAt (lock → icon, name scales in, ✓ pops, a scan runs the waveform), shakeAt}], counter (false hides the UNLOCKED n/N row) [true], counterLabel, focus (index ringed)}: give it at least 160 px a card.',
    'meter {title [LOUDNESS], unit [LUFS], from [-31], to [-14] (the needle and number spring from one to the other), settleAt [at+0.6], rangeLabel [IN RANGE] (false hides it), history (bars growing along the bottom) [true]}. marker-snap {title, snapLabel, marker [HIT], clip, from [0.12], to [0.55] (0–1 of the width), snapAt, badge [ON BEAT]}. terminal {title, sub, right, prompt (typed), typeAt, cps [40], lines [{at, key, text}] (code lines that slide in after the prompt), output {at, label, shape, badge [✓ RENDERED]} (a waveform well a scan line crosses)}: give it lines and an output so it is never empty.',
    'results {query (typed in a search box), typeAt, cps, layout fan|row [fan], cards [{label, sub, badge (NO MATCH), tone (alert, accent or quiet), at}]}. card-wall {cards [{label, tag, sub}] (repeated to fill), count [32], cols [4], highlightAt (an accent sweep across the columns), tagTone, ring (an orbit ellipse) [true]}. downloads {title, sub, prompt, typeAt, cps, items [{label, sub, pick}], selectAt (picked rows ring), doneAt [one time per picked row: its ↓ turns ✓], counterLabel [DOWNLOADS]}. comment {avatarLabel [you], placeholder, text (typed), typeAt, cps [12], sendAt, sent, reply, replyAt, links [labels]}.',
    'frame-ruler {target frame [547], start (the playhead\'s first frame) [target-3], from, snapAt (the playhead lands on the target), pin (the label over the target), lane, slot {label, dropAt} (a clip drops into a dashed slot), counterLabel [FRAME]}. pad-grid {pads [names], cols [3], runAt (the lit pad starts stepping), rate (steps a second) [7]}. scan-plane {thumbs (thumbnails along the top) [9], markers [{at, label, x 0–1}], scanAt, scanDur [3.4]} (tilt the element, e.g. {x: 38, z: -14, y: -12}).',
    'Keep a host in most interface scenes: a host element is a small pixel mascot in the accent that hops in (enter "hop", the default; props.from below|left|right), idles with a bob and a blink, and reacts on its beats. Perch it on the hero panel\'s top edge (props {perch: "<the panel\'s id>", along 0–1 [0.8]}; rect then needs only {width, height}, about 176×136, at least 132×102), enter it 0.2–0.4 s after the panel (it stands above the panel, so the panel\'s top needs the host\'s height of stage over it: y 380 or lower in 9:16), and change its pose on the key words: beats [{at: "word:wait", set: {pose: "surprised"}}, {at: "word:here", set: {pose: "point-left"}}, {at: "word:done", set: {pose: "cheer"}, cue: "success"}]. Poses: idle, hop (hops on the spot), point-left / point-right (at what the line is about), cheer (the win), surprised (the problem or the twist). Two or three reactions a scene, never on every word; a perched host shares its panel\'s depth and leaves with it. A perch needs a flat top-level element: an arranged stack\'s cards are tilted and not top-level, so in a stack scene give the host its own rect, or perch it in another scene.',
    'Text is what the script says: tool names, labels and counts come from the brief. Headlines must fit their rect at their size (the module fails a line too wide); shorten the copy rather than shrinking it below about 90 px.',
    'Sound tells the story too. signal-ui scores the video itself from what your scenes do: a playhead or scan-plane hunts like a typewriter carriage, a meter clicks round like an analog dial, a frame-ruler steps and slows, an unlockAt plays a reward that climbs each time, and a scene with energy 3 or "build" opens with a whoosh crossing the stereo field over a deep bass drum. So give interfaces moving parts the sound can follow. Then mark what the viewer should feel with hits carrying a moment, written from the script and the visuals: hits [{at: "word:cheap", event: "cheap", moment: "letdown"}]. Moments: letdown (a let-down, the floor drops), promise (three rising notes on what is coming), reveal (something unveiled), impact (the biggest precise hit, out of near silence), crystallise (something forms from nothing), wonder (scale: the room opens), miss (a search that finds nothing), resolve (warm ending). Choose a few that carry the arc, with quiet between them, and keep impact and wonder rare: if everything is big, nothing is.',
    'Paper diorama (the paper-collage style): the scene is real 3D paper, not panels on a flat stage. params.stage.rig {keys [{at, rx, ry, rz, scale, x, y, ease: "back"}], explode {at, dur}, steps: 15} moves one camera over the whole scene: open flat on the table (rx 68), swing up with ease "back", orbit slowly (ry −16 to 15), then tip over (rx 57, rz −30) as the layers spread. Give each element a lift (px off the base, 0 to 300); screen: true keeps type flat on the screen and out of the 3D. Kinds: paper-sheet {title, meta, flaps, flapAt} (the page, with hatched side panels that fold up like a pop-up book); cutout {view [w, h], parts [{shape rect|circle|ellipse|path|text, fill paper|ink|mid|accent|alert|none|#hex, shade {kind dots|lines, from, to, dir, step}, at}]} (any object, drawn from shapes with a die-cut edge: shade the side away from the light and give a part an at to pop it on its word; a shaded path needs a box [x, y, w, h]); limb {path [[x, y]…], width, growAt, fillAt} (grows from its first point; lift it below a cut-out so it comes out from behind, above to wrap across; it stays a white outline until fillAt); paper-fold {panels [{title, value, bar}], openAt, closeAt} (opens like a folded map); torn-strip {text with *accent*, size, tone paper|ink}; tape {tone, rotate}; callout-pin {no, text, target, point} (a leader line to an element, right through the 3D). Draw objects with solid silhouettes and few, confident shapes; avoid drawn people, which read as clip art.',
    'The signal-ui style fits this look: dark panels, one accent, a dark ground with a faint dot grid only under the key light, word-chip captions low-centre, the steady feel (a steadicam) and heavy motion blur (motion.blur {samples: 6, shutter: 1.5}: sub-frames blended across one and a half frames, so fast moves smear and settled panels stay sharp; captions are kept sharp, never two words at once), gated against the ui-steady-reel profile. A story\'s motion fills from the pack field by field: an object merges into the pack\'s (motion: {blur: false} keeps its grammar and feel; a grammar {defaultTransition: {cuts: {type: "light-sweep"}}} keeps the pack\'s dur and direction), a string, number or array replaces it (grammar: "smooth" replaces the whole grammar). The motion gate measures whole-frame motion (element entrances barely move it). When it asks for more change energy or harder bursts, keep content alive (a host idling and reacting, counters, live waveforms and meters), lift the steady camera a little (motion.feel: {preset: "steady", ambient: {scale: [1.025, 1.07], shift: 0.016, period: [2.5, 5]}}) and use whip-pans and push-blurs between scenes; never shorten the camera\'s period to chase a measure, since a camera that moves about every second pumps, and add a few camera.kicks on the words that earn one (a kick needs 0.25 s from the start and 0.47 s before the end); when it asks for more flow velocity, lengthen whip-pans toward 0.4 s (transition dur) and add sideways moves.'
  ];
}

// Data explainers: the "the study says" format and its source rule.
export function dataExplainerLines() {
  return [
    'Format "the study says": the question (a choice: "10 heavy reps or 25 light ones?") → what everyone believes (the rule) → the fair test (the study: who, how many, what each group did) → the result → what to do. One idea per beat.',
    'Keep a near-empty stage and add or transform one element per beat rather than cutting to a new card: the belief is a number-line whose ranges light up on their words, the study is a unit-grid that counts in and then splits into its groups (split on the word that names them), the result lands on those groups (bar-chart, gauge-compare or stat-card), stacked fragments ("same program", "12 weeks", "every set to failure") are kinetic-words.',
    'No source, no study claim: a study, survey or "researchers found" line needs its citation in the brief or assets. Show it as a source note that stays along the bottom across the data scenes: frame.sources [{text ≤ 90 ("Morton et al., 2016 · J Appl Physiol"), scene | start, until? | end?}] (keep any other frame fields; with no brand frame write frame: {kicker: false, sections: false, sources: [...]}). Every unit-grid or number-line scene sits under a note or sets params.source. Never invent an author, year or journal; without one, cut the claim.'
  ];
}

// Social cards: real posts only.
export function socialPostLines() {
  return [
    'A post on screen is a real post: its words verbatim (an excerpt marks cuts with …), its author, handle and date as posted, and a source block {url, captured_at, screenshot} from the capture (schema launchclip.capture.v1). validateStory warns on a post without source.url; never write a post someone did not post, and never fill a wall with made-up accounts.',
    'Sweep the phrase the narration reads (highlight: "<words of the post>"), timed with a scene hit on that word: hits [{at: "word:<text>", event: "highlight"}]. One card per beat; build the next card in the same shot (social-stack, social-sort) rather than cutting.'
  ];
}

// Movement grammar: builds inside a shot, the focus ring, the depth transitions.
export function buildLines() {
  return [
    'Builds, not cuts: a data or proof shot runs 2–4 states timed to the clauses on one plate (scene.states [{at: <anchor>, set: {...}}], 1–5 after the scene itself), so each line gets a new visual without a cut. Nothing holds one state longer than about 10 s, and nothing stands still over 3 s (the holds and states gates).',
    'A state sets any of: params (the module\'s state params, merged; arrays keep their length, so list every item and hold the later ones back with reveal), reveal [item], focus item | "<element id>" | null (a ring in the focus colour travels there and the rest dims to 30 %), glow item, guide {value, label} (bar-chart) or {target, edge, label}, note {text ≤ 32, target}, clear true. Items are indexes (bar 0, row 2); element ids drop the scene prefix ("cell-1-2", "line-3").',
    'States run on bar-chart (data, max, highlight), scatter-plot (points, highlight), comparison-table (rows, highlight), leaderboard (entries, highlight), unit-grid (highlight), process-steps (steps) and excerpt (lines). Example on bar-chart: the first bar ($1) → the second grows in (reveal [1]) → a dashed "half" guide → focus and glow on the winner.',
    'Between shots: "rack-focus" (the card blurs back while the next sharpens forward) is the default between builds; "card-to-card" when one card becomes the next; "glow-wipe" or "dot-wipe" (a halftone dot grid grows over the cut and shrinks away, about 0.5 s) only for chapter breaks. rack-focus and card-to-card are for cards: not between two full-frame footage scenes.'
  ];
}

function anchorLines() {
  return [
    'scene.start, scene.end, hits[].at and zooms[].at / until accept: seconds (2.5); "word:<text>" (the first time that word is spoken); "word:<text>#<n>" (its n-th occurrence); an optional offset ("word:fast-0.2", "word:fast+0.1"); "beat:<n>" or "downbeat:<n>" (from BEATS.json).',
    'Word anchors must name a word that is actually in the narration (case and punctuation are ignored; a hyphenated anchor matches hyphenated or consecutive words).',
    'Scenes on the same track must not overlap. scene.end must not exceed format.duration. A hit should fall inside its scene.',
    'hits: [{"at": <anchor>, "event": "<module event name>", "cue"?: "<sound>"}]. When the event matches a module event (for example "hit" on count-up or "gap-bar-0" on function-chart), the hit times that event.'
  ];
}

function contractLines() {
  return [
    `schema: "${STORY_SCHEMA}" (exactly). lane: one of ${STORY_LANES.join(', ')} (given; never change it).`,
    'format: {width, height, fps, duration, platform?} and brand: {colors, fonts} are given; copy them unchanged.',
    'audio: {voice?, words?, music?, sfx?}; base: null, or the recording path for footage-led.',
    'audio.music: omit it (finish picks ElevenLabs when a key is set, else the synth bed), or "synth", "none", an assets/ path, or {provider: "elevenlabs" | "synth" | "file", prompt?, bpm?, file?, sync?: "auto" | "off" | "cuts" | "hits"}. The music follows scene energy, so set energy honestly: calm intro, "build" before the payoff, 3 on the payoff. A prompt describes style only (no vocals is added for you).',
    `scenes: [{id ("s1", "s2"…), module, start, end, energy (0 calm, 1 light, 2 groove, 3 full, "build"), in? {type: ${STORY_TRANSITIONS.join(' | ')}, dur, direction?, from_object?, color?, cover?, hold? (dot-wipe only)}, params, hits?, zooms?, ambient?, layer? (footage-led: "behind" draws it behind the presenter)}].`,
    'in.dur must be shorter than the scene. Choose transitions by meaning: cut for contrast, push for continuation, whip for speed, zoom for scale change, morph for identity (name in.from_object, e.g. "s2.gap-bracket"), iris for focus; camera moves (pan, whip-pan, orbit, pull, world push) are under "Motion grammar and camera".',
    'overlays: [captions]. ending: {loop_to: "<first scene id>"} for a seamless loop (Shorts). For no loop, set ending {loop: false} (or loop_to: null, or omit ending without a looping style pack); the last scene then holds settled to the final frame (ending.final "hold", the default), or use final "fade" to fade it fully to the background by the final frame, or "exit" to play its own exit. ending accepts only loop_to, in, loop and final.',
    ...ambientLines(),
    ...worldLines(),
    'Recorded product flows (assets/demo/<flow>.mp4 with demo/<flow>.actions.json, from launchclip demo record) play in product-demo scenes. Copy the params the asset inventory gives for each flow (media, viewport, actions, callouts) unchanged: the zooms, outlines and SFX are timed from the real action log, so never invent or move action boxes or times. Time the scene to the clip window (media.sourceStart plus the scene length must stay inside the clip); you may shorten a scene from the end, and drop actions after it.',
    'Captured evidence (assets/evidence/<id>.mp4 with <id>.evidence.json, from launchclip evidence capture) plays in evidence-clip scenes. Copy the params the asset inventory gives (media, viewport, source) unchanged; the page\'s own beats (scroll, selection, focus ring, date pin) are already in the clip, so add focus or cursor only on boxes the sidecar lists, and never retype what the page says.',
    'Supplied footage (assets/ videos and stills) plays full frame in clip scenes, cut to the narration: params.media {src, sourceStart?, sourceEnd?} picks the source window (the scene must fit inside it), focus keeps the subject in frame when the source is cropped to the canvas, and 1–3 callouts carry the key words over the footage. Higher-track scenes may sit over a clip.',
    `Footage to footage (a clip or photo-scene on track 0 straight after another): use cut, fade, push, whip, zoom or iris (or push-blur, light-sweep, glow-wipe, dot-wipe); the new picture arrives over the old one, which stays whole under it, so the frame never drops to the background. In world mode a camera pan, whip-pan, push or pull works too (a push grows the new picture out of the old one). Never ${CARD_TRANSITIONS.join(', ')} between footage: they move a card or hand a named object across, footage has neither, and they play as a plain fade there.`,
    'Vary the modules: a 20–40 s piece uses at least four different modules and never the same module three times in a row.'
  ];
}

// Worlds (kit/core/worlds/): the video-wide place for world scenes.
function worldLines() {
  return [
    `world? (optional): {kind: ${WORLD_KINDS.join(' | ')}, time?: ${WORLD_TIMES.join(' | ')}, props?: [prop ids]}. The default for every world scene; a style may set it. Pick the place that fits the topic (cooking → kitchen or cafe, fitness → gym or park, developer tools → home-desk or server-room) and the time the story is set at.`,
    'A world scene is a plate on track 0. Put characters (cast-scene, character-cameo), cards or text on track 1 over it, and set its scrim ("auto") when text sits on top, so the text keeps 4.5:1.',
    'A set-prop puts one story object in that world: a drawn prop (fridge, bookshelf, washing-machine, microwave, toaster, or any world prop) or an assets/ cut-out image or video, on its floor, back wall, counter or wall, sized in metres to match the cast. On a lower track than the cast-scene it stands behind the characters, on a higher one in front of them; it moves with the world camera. Give it the plate\'s window to have it there all shot, or start it on the word to pop it in.',
    'A photo-scene, evidence-clip or product-demo plate cuts as its transitions say: whole on its first frame after a cut or a typed in, whole on frame 0 when it opens the video, and gone with the cut into the next plate; it fades only on its own (or with params.enter / exit: fade).'
  ];
}

// Direction guardrails (docs/DIRECTION_GUARDRAILS.md): the rules the finish
// gates (physics, acting, layout captions, ghosting, density, variety) check.
/**
 * The script was planned first (kit/core/script-formats.mjs): its beats are
 * the video's structure, so the storyboard follows them.
 */
export function scriptBeatLines() {
  return [
    'The script was written against a beat skeleton (hook, problem, proof, CTA and so on). When the brief lists "Script beats", follow them in order: each beat gets its own scene or group of scenes, and no scene spans two beats.',
    'The hook beat\'s first scene shows the hook\'s subject from 0 s, with on-screen text that paraphrases the spoken hook in about 6–8 words and keeps its stakes (the myth, the mistake, the number with its unit, the bold claim): never a bare topic such as "Deck care?" or "Solar panels", which gives no reason to stay. In a video of 90 s or less that scene is an image (a photo, object, number with its unit, chart, character or product scene), never a title card (hook-title, motion-title, kinetic-words, section-card, masthead, glass-word, emphasis-caption); a title card may follow it.',
    'A beat with the share role carries the line a viewer would send or comment on: give it a scene of its own that shows it, not a recap card.',
    'Turns in the script ("but", "so", a reveal) are where a new scene, a transition or a hit lands; a payoff beat gets the strongest visual of the video.',
    'The CTA beat gets the end card, worded exactly as the narration speaks it; no other scene shows a call to action.'
  ];
}

export function guardrailLines() {
  return [
    ...physicsPromptLines(),
    ...actingPromptLines(),
    ...framingPromptLines(),
    'No ghosting: one copy of a person on screen at a time. Never put a character in two scenes that overlap; the next shot\'s copy of a character appears by itself when the transition ends. Never fade a character in or out over a world that is already there.',
    'Text reads or is gone: cards fade in and out fast (0.5 s at most, whatever the grammar) and stay fully shown for their reading time (about 0.22 s a word, at least 1.2 s).',
    'Let shots breathe: in a video under 90 s every shot after the opening hook holds at least 2.5 s. A quick list ("hardwood, treated pine, composite") is one shot whose items build in on their words, not a 1.5 s card per item; tooling lengthens shorter shots from their neighbours.',
    'Captions must read on what is behind them: finish measures every line on the render and adds a backing plate where it does not; keep captions out of a character\'s face and off busy props where you can.',
    ...compositionPromptLines()
  ];
}

// Ambient motion (kit/core/ambient.mjs): what the planner may set and what
// the default already does.
function ambientLines() {
  return [
    `ambient? (optional): {level: ${STORY_AMBIENT_LEVELS.join(' | ')}, background?: boolean, drift?: boolean}, or just the level. Ambient motion keeps settled frames alive between beats: a slow push-in on each settled module (kept inside the safe zone) and soft brand-colour light drifting behind the plates.`,
    'Usually leave ambient out: the level follows each scene\'s energy (0 → subtle, 1, 2 or "build" → standard, 3 → lively; every scene is lively under the cinematic grammar), and footage-led stories get no background field and drift overlays only. Set story ambient only to change the whole piece (for example "subtle" for a calm brand film); "off" makes settled frames hold still and fails the cinematic motion gate.',
    'A scene may set ambient to override the story: "off" for one deliberately still beat, {"drift": false} when the module\'s own motion should stand alone, or a level.'
  ];
}

function moduleLines(tier, modules = moduleCatalogue()) {
  const lines = [];
  for (const module of modules) {
    const params = module.params.filter((param) => tier !== 'structured' || !param.tuning);
    const flags = [module.family === 'editorial' ? 'editorial panel, keeps captions' : module.hidesCaptions ? 'hides captions' : 'keeps captions'];
    if (module.layer === 'behind') flags.push('behind the presenter');
    if (module.needs?.includes('subject')) flags.push('needs the subject');
    lines.push(`### ${module.id} (${flags.join(', ')})`);
    lines.push(module.describe);
    if (module.family === 'editorial') lines.push(`Common: ${EDITORIAL_COMMON}.`);
    lines.push('params:');
    for (const param of params) lines.push(`- ${param.name}: ${param.text}${param.tuning ? ' [guided and bespoke tiers only]' : ''}`);
    if (module.events.length) lines.push(`events: ${module.events.join(', ')}`);
    // The style's story.variants picks one per module; set params.variant only to break from it.
    if (module.variants) lines.push(`variants: ${module.variants.map((name, i) => (i ? name : `${name} (default)`)).join(', ')}`);
    lines.push('');
  }
  if (tier === 'bespoke') lines.push('### custom (bespoke tier only)', 'A project module at scene.source (no params schema): a project-relative path to its Remotion component, or {"remotion": "<component>.tsx", "hyperframes": "<fragment>.html"} with a form for each renderer the video will be rendered with. A renderer with no form for the scene refuses to render it. Pure function of absolute time; must obey the safe zone; falls back to the nearest catalogue module when it fails a gate.', '');
  return lines;
}

// subject: undefined lists every row, marking the ones that need the
// subject; false drops them; true lists them unmarked.
function phraseLines({ subject } = {}) {
  const modules = knownModules();
  return PHRASE_MODULE_TABLE.map((row) => {
    const needs = row.needs?.includes('subject');
    if (needs && subject === false) return null;
    const target = phraseRowModule(row, modules);
    if (!target) return null;
    const planned = row.overlay ? ' (story overlay, not a scene module)' : target !== row.module ? ` (planned module ${row.module}; use ${target})` : '';
    const lanes = row.lanes ? ` [${row.lanes.join(', ')}]` : '';
    const marker = needs && subject === undefined ? ' (needs the subject)' : '';
    return `| ${row.when}${lanes}${marker} | ${target}${planned} |`;
  }).filter(Boolean);
}

/**
 * Prompt lines about the presenter for the footage-led lane. subject: the
 * probe summary ({usable, reasons, framing, headroom, head}) or null when
 * there is no cut-out (no runtime, no person, or several people).
 */
export function subjectLines(subject, { profile = null } = {}) {
  const share = Math.round((profile?.measures?.subject_effect_share?.p90 ?? SUBJECT_DENSITY.share) * 100);
  if (!subject?.usable) {
    const why = subject?.reasons?.length ? subject.reasons.join('; ') : 'the presenter cut-out is not available';
    return [`No subject modules: ${why}. Every scene stays in front (no layer, no masthead or dolly-zoom).`];
  }
  return [
    `The presenter can be cut out: ${subject.framing ?? 'unknown'} framing${typeof subject.headroom === 'number' ? `, ${Math.round(subject.headroom * 100)}% headroom above the head` : ''}${subject.head ? `, head centred at x ${subject.head.x}, y ${subject.head.y} of the frame` : ''}.`,
    'scene.layer: "behind" draws a scene behind the presenter, so their head and body cover it (a word or chart behind them); omit it (front) for everything else. masthead and dolly-zoom are always behind.',
    `Density budget: use at most one or two subject effects in a 30–60 s piece (behind or split scenes, the modules that need the subject, and punch-in, zoom-through and pull-back), at least 3 s apart, never two different ones back to back, and together under ${share}% of the runtime${profile ? ` (profile ${profile.id})` : ''}. Validation warns past any of these.`,
    `masthead and app-stage need headroom${subject.framing === 'close-up' ? ' (this recording is a close-up: avoid masthead, app-stage and dolly-zoom)' : ''}; dolly-zoom needs a medium or wide shot.`,
    `A masthead keeps 60% of every letter clear of the head, or layout-check fails it: in a portrait Short that takes about 20% headroom (more with a kicker)${typeof subject.headroom === 'number' && subject.headroom < 0.2 ? `, and this recording has ${Math.round(subject.headroom * 100)}%: use another module` : ''}.`,
    'app-stage, phone-stage and a backdrop-swap backdrop show real product media from the asset inventory (screenshots, screen recordings, demo flows); never invent a screenshot. feed-frame shows counts only when the brief gives them.',
    'A checklist without a rect places itself beside the presenter (above the head, else on the chest) at a legible size; keep it to two or three short rows on a close shot.',
    'Never put a front scene over the presenter\'s face for more than 0.3 s; layout-check fails it.'
  ];
}

/** A compact valid storyboard for the given format and brand (motion lane, structured tier). */
export function exampleStoryboard({ format, brand } = {}) {
  const fmt = { width: 1080, height: 1920, fps: 30, duration: 14, platform: 'youtube-shorts', ...(format ?? {}) };
  fmt.duration = 14;
  return {
    schema: STORY_SCHEMA,
    title: 'Faster builds',
    lane: 'motion',
    format: fmt,
    brand: brand ?? DEFAULT_BRAND,
    audio: { music: { provider: 'synth', bpm: 100, key: 'A' }, sfx: 'auto' },
    base: null,
    scenes: [
      { id: 's1', module: 'count-up', start: 0, end: 3, energy: 1, params: { value: 40, suffix: ' min', label: 'One CI run on your repo today', note: 'illustrative' }, hits: [{ at: 1.4, event: 'hit' }] },
      { id: 's2', module: 'count-up', start: 3, end: 6.5, energy: 2, in: { type: 'push', dur: 0.4, direction: 'left' }, params: { value: 12, suffix: ' min', label: 'Same pipeline after caching', note: 'illustrative' }, hits: [{ at: 4.6, event: 'hit' }] },
      { id: 's3', module: 'checklist', start: 6.5, end: 11, energy: 2, in: { type: 'whip', dur: 0.3, direction: 'up' }, params: { title: 'Three changes', rows: [{ label: 'Cache dependencies', status: 'done', at: 0.5 }, { label: 'Split the test suite', status: 'done', at: 1.4 }, { label: 'Ship smaller images', status: 'done', at: 2.3 }] } },
      { id: 's4', module: 'cta', start: 11, end: 14, energy: 1, in: { type: 'fade', dur: 0.3 }, params: { action: 'Try it on your repo', handle: '@launchclip', loop: true } }
    ],
    overlays: [{ type: 'captions', style: 'word-highlight' }],
    ending: { loop_to: 's1' }
  };
}

export const DEFAULT_BRAND = Object.freeze({
  colors: Object.freeze({ bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6' }),
  fonts: Object.freeze({ display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono' })
});

function wordLines(words) {
  const list = Array.isArray(words) ? words : Array.isArray(words?.words) ? words.words : [];
  const entries = list
    .map((entry) => ({ text: String(entry?.text ?? entry?.word ?? '').trim(), start: Number(entry?.start) }))
    .filter((entry) => entry.text && Number.isFinite(entry.start));
  if (!entries.length) return [];
  const body = entries.map((entry) => `${entry.text}@${Math.round(entry.start * 100) / 100}`).join(' ');
  return [`${entries.length} words, as text@start seconds. Anchor to these words only.`, body];
}

function moodSection(artDirection, modules) {
  const favoured = suggestModuleMoods(artDirection, modules);
  if (!favoured.length) return [];
  return section('Favoured by the art direction', [`Where the script allows, reach for: ${favoured.map((entry) => `${entry.id} (${entry.moods.join(', ')})`).join(', ')}.`]);
}

function section(title, lines) {
  return [`## ${title}`, '', ...lines, ''];
}

function cadenceLines(profile) {
  return [
    `What a strong ${profile.title ?? profile.id} measures like (${profile.provenance?.kind === 'measured' ? `measured from ${profile.references} references` : 'seed ranges, not yet measured'}). Plan to the targets; the gates measure the render against the bands.`,
    ...profilePromptLines(profile)
  ];
}

function directionPlanLines(direction) {
  return [
    'The direction map gives every narration line an intent and a treatment. Plan the storyboard to it:',
    '',
    '- Create every scene a line names, with that id, starting and ending on the line\'s own words (word anchors), and choose its module for the line\'s intent.',
    '- dress: an overlay beside the presenter (footage-led) or a scene on track 0 (motion lanes). insert: a full-frame scene (insert: true in footage-led). camera: a punch-in or zoom-through only. face: no scene; the recording plays.',
    '- A scene may run across the next line when the map names it there too. Keep scenes the map does not name to captions and camera moves.',
    '',
    '```json',
    JSON.stringify(direction),
    '```'
  ];
}

// ---------------------------------------------------------------------------
// Direction map (docs/VIDEO_QUALITY_RFC.md §6): the planner's first call and
// the skills' reference.

function directionContractLines({ lane } = {}) {
  const motion = lane && lane !== 'footage-led';
  return [
    `schema: "${DIRECTION_SCHEMA}" (exactly); profile: the cadence profile id (given).`,
    'sections: [{id ("s1"…), title, layout?, lines: [...]}]: topics in order (story beats for a character story). A section holds one footage layout: ' + DIRECTION_LAYOUTS.map((name) => `"${name}"`).join(', ') + ' (footage-led only; "full" is today\'s overlays-over-the-recording).',
    'lines: [{words: [first, last], intent, treatment, scenes?, why?}]. words are inclusive indexes into the narration words, so the map survives re-timing. Every word belongs to exactly one line, in order.',
    `intent: one of ${DIRECTION_INTENTS.join(', ')} (see the intent rules).`,
    `treatment: dress (a visual alongside the presenter), insert (a full-frame visual over the voice), face (hold on the presenter on purpose), camera (a punch-in or camera move only).${motion ? ' This story has no presenter: every line is dress or insert.' : ''}`,
    'dress and insert lines name the scene ids that will show them ("scenes": ["s3"]); face and camera lines give a short why ("the turn lands on his face").',
    `Dress every line whose intent calls for a visual (${VISUAL_INTENTS.join(', ')}) unless it works better on the presenter, and then say why. A character story's lines may add cast cues ({id, pose, expression, at: "word:<text>"}) and a set.`,
    `A character story's line with cast cues names its key action, and every beat (section) has at least one: action {verb: ${ACTION_VERBS.slice(0, 7).join(' | ')} | a pose, who, target?}. It is what a character does on screen to show the line (looking far away, standing up, pointing at the proof). The acting gate fails when no cast scene performs it on that line.`,
    'A character story keeps a speaking character on screen: while a character (not the narrator) speaks a line, a scene that draws that character is up for those words. To hold the picture elsewhere (the listener\'s reaction, a prop), give the line a why ("we stay on Maya as it sinks in"). A line may also carry line: the id of the script line it plays (SCRIPT.json, "l3") when the story has a script; the word range stays the source of timing.'
  ];
}

function intentRuleLines() {
  return [
    '| Intent | The line… |',
    '| --- | --- |',
    ...INTENT_RULES.map((rule) => `| ${rule.intent} | ${rule.when.replace(/\|/g, '\\|')} |`),
    '| hook | is the first line (unless it is a call to action) |',
    '| claim | matches none of the above |'
  ];
}

/**
 * The instructions for the planner's first call: the direction map before the
 * storyboard. words: the narration words; the lines are pre-split with their
 * suggested intents from the shared rules, so both paths classify the same way.
 */
export function directionPrompt({ lane, format, profile = null, words, subject = null, segments = null, cast = null, explainer = false } = {}) {
  const hints = intentHints(words);
  const lines = [
    `You author DIRECTION.json (${DIRECTION_SCHEMA}) for LaunchClip: the visual decision for every line of the narration, made before the storyboard. The storyboard is planned against it next.`,
    'Return exactly one JSON object: the complete direction map. No prose, no Markdown fences.',
    '',
    ...section('Fixed inputs', [`lane: ${lane ?? '(given)'}`, `format: ${format ? JSON.stringify(format) : '(given)'}`, `profile: ${profile?.id ?? '(none)'}`]),
    ...section('Contract', directionContractLines({ lane }).map((line) => `- ${line}`)),
    ...section('Intent rules (first match wins)', intentRuleLines()),
    ...(profile ? section(`Cadence profile (${profile.id})`, [...cadenceLines(profile).map((line) => `- ${line}`), '- Coverage comes from the treatments: plan enough dress and insert lines to land near the coverage target, and no run of face or camera lines longer than the undressed limit.', ...(lane === 'footage-led' && profile.measures?.face_time?.p90 < 1 ? ['- Face time comes from the treatments too: only insert lines take the presenter off screen. Make the lines that name something the viewer could see (a thing, a place, a step) insert lines, so face time lands near its target and never above its ceiling.'] : [])]) : []),
    ...(profile?.id === 'youtube-long-form' || Number(format?.duration) >= LONG_FORM_SECONDS ? section('Long form', longFormLines().map((line) => `- ${line}`)) : []),
    ...(Array.isArray(segments) && segments.length ? section('Recurring segments (the style\'s)', ['When a section is one of these, set its "segment" to the id and title it like the segment, so the series looks like a series:', ...segments.map((segment) => `- ${segment.id}: "${segment.title}"${segment.layout ? `, layout ${segment.layout}` : ''}${segment.modules?.length ? `, prefer ${segment.modules.join(', ')}` : ''}`)]) : []),
    ...(cast && !explainer ? section('Cast (the character kit)', directionCastLines(cast).map((line) => `- ${line}`)) : []),
    // explainer: a character-led explainer (kit/core/explainer.mjs): the map casts the characters that carry it.
    ...(explainer ? section('Characters carry the explainer (cast them here)', explainerDirectionLines().map((line) => `- ${line}`)) : []),
    ...(lane === 'footage-led' ? section('Presenter', [subject?.usable ? `The presenter can be cut out (${subject.framing ?? 'unknown'} framing): split and framed layouts and behind-the-presenter scenes are available.` : 'No presenter cut-out: use full and insert layouts, or split on the base camera.']) : []),
    ...section('Narration lines (suggested intents)', ['Keep these lines unless two belong together or one holds two ideas; keep the word ranges exact.', '', ...hints.map((hint) => `- [${hint.words[0]}, ${hint.words[1]}] ${hint.intent}: "${hint.text.slice(0, 200)}" (${round2(hint.start)}–${round2(hint.end)} s)`)]),
    ...section('Example', [JSON.stringify(exampleDirection())])
  ];
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * The cast section of the direction prompt. cast: {characters: [{id, name?}],
 * bindable?}: the cast the story will have; bindable when it is a seeded
 * style's default roster, whose names the story's own characters take.
 */
export function directionCastLines(cast) {
  const members = (Array.isArray(cast?.characters) ? cast.characters : []).filter((member) => typeof member?.id === 'string');
  const roster = members.map((member) => `"${member.id}"${member.name ? ` (${member.name})` : ''}`).join(', ');
  const lines = cast?.bindable
    ? [`The style supplies ${members.length} default character${members.length === 1 ? '' : 's'} (${roster}). When the story names its characters, use those names as cue ids, lowercase ("Mia" → "mia"), and in action.who: tooling gives each new name one of these looks and voices, in order of first appearance. At most ${members.length} characters.`]
    : [`Cue ids and action.who name characters of the story cast only: ${roster || '(none yet)'}. Never invent an id.`];
  return [
    ...lines,
    `pose: exactly one of ${POSES.join(', ')}.`,
    `expression: exactly one of ${EXPRESSIONS.join(', ')}. Pick the one the line's feeling calls for, and cue a new one when the feeling turns.`,
    `set: exactly one of ${SETS.join(', ')}, or none.`,
    `action.verb: one of ${ACTIONS.join(', ')}, or a pose. Say where someone stands or what they look at with the action's target, not in the pose.`
  ];
}

function exampleDirection() {
  return {
    schema: DIRECTION_SCHEMA,
    profile: 'youtube-talking-head-launch',
    sections: [{ id: 's1', title: 'The problem', layout: 'split-right', lines: [
      { words: [0, 23], intent: 'claim', treatment: 'dress', scenes: ['die'], why: 'three parallel claims; one visual per claim' },
      { words: [24, 43], intent: 'problem', treatment: 'dress', scenes: ['build-properly'] },
      { words: [44, 52], intent: 'personal', treatment: 'face', why: 'the turn lands on his face' }
    ] }]
  };
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * Markdown reference for the create-video skills
 * (skills-src/references/direction-map.md, generated).
 */
export function directionMapReference() {
  const lines = [
    '# Direction map',
    '',
    '<!-- Generated from kit/core/planning-prompt.mjs by scripts/sync-skills.mjs. Do not edit by hand; run `npm run skills:sync`. -->',
    '',
    `Write \`DIRECTION.json\` (${DIRECTION_SCHEMA}) beside \`storyboard.json\` before the storyboard: every line of the narration gets an intent and a visual decision. The storyboard says what renders, the map says why each scene exists, and the cadence profile (\`references/profiles.md\`) says what the whole should measure like. \`launchclip story plan\` and \`launchclip make\` ask the model for the same map first. Design: \`docs/VIDEO_QUALITY_RFC.md\` §6 in the LaunchClip repo.`,
    '',
    ...section('Steps', [
      '1. Read the narration words (`NARRATION.json`, or the edited transcript for footage) and split them into lines at sentence ends. Number the words from 0.',
      '2. Pick the cadence profile for the story (`launchclip profile list`; `references/profiles.md`) and note its coverage target and undressed limit.',
      '3. Classify each line with the intent rules below, then choose its treatment. Dress every line whose intent calls for a visual; hold a line on the presenter only on purpose, and say why.',
      '4. Name the scene ids each dress or insert line will get, then author `storyboard.json` with those scenes on those words.',
      '5. `launchclip story validate storyboard.json` checks the map: every word in a line, every named scene present and overlapping its words, and coverage, face time and the longest undressed run against the profile band.'
    ]),
    ...section('Contract', directionContractLines().map((line) => `- ${line}`)),
    ...section('Intent rules (first match wins)', intentRuleLines()),
    ...section('Narrative maps', [
      `A story told by characters uses story beats as sections (\`beat\`: ${NARRATIVE_BEATS.join(', ')}), and each line says who acts: \`cast: [{id, pose, expression, at: "word:<text>"}]\` and a \`set\`. Cast cues name characters from the story's cast and poses, expressions and sets from the character kit; validation checks them when the kit is present.`,
      'Each line with cast cues names its key action, `action: {verb, who, target?}` (an acting cue such as look-far, turn-to-look, gaze-at, point-at, walk-to, stand-up, stretch, or a pose), and each beat names at least one. If the idea is an action, someone does it on screen, toward what it is about. `launchclip finish` fails the acting gate when no cast scene performs it on its line.',
      'With a script (`SCRIPT.json`, speakers and silent lines), give each line `line`: the id of the script line it plays, e.g. `"line": "l3"`. Validation checks the id names a spoken line of the script and that the words in its range are voiced by that line\'s speaker. A script line may be played by more than one map line; a silent line (`speaker: null`) is played by no map line, so act it with a cue in the pause it leaves.',
      'While a character speaks, a scene that draws that character is on screen: every spoken word (its midpoint) falls inside a `cast-scene`, `character-cameo` or `sprite-scene` with the speaker in it. A line whose picture stays elsewhere says so in `why` (`"why": "we stay on Maya\'s reaction"`); without one, `story validate` and the direction gate fail it. The narrator is never held to this.',
      '`launchclip story shots <project> [--json]` prints the shot list from the two files: each character scene with its time and frames, who is in it, the set and framing, the key actions, every pose change, and the lines said while it is up (script line id, speaker, on screen or off). Read it before rendering: a shot with nothing said, a speaker off screen, or a script line no map line plays shows there.'
    ]),
    ...section('Long form', [...longFormLines().map((line) => `- ${line}`), '- `launchclip story long-form <project>` then writes `chapters` into storyboard.json (and section titles into the map); `launchclip finish` writes `renders/chapters.txt` for the YouTube description and puts the chapters in the MP4 and the NLE exports.']),
    ...section('Required', [
      '- `story validate` requires `DIRECTION.json` in the footage-led, motion and voiceover-motion lanes when the story has narration words (`audio.words`); without words a missing map is a warning.',
      '- `launchclip finish` gates coverage, direction and face against the profile.'
    ]),
    ...section('Example', ['```json', JSON.stringify(exampleDirection(), null, 2), '```'])
  ];
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/**
 * Markdown reference for the cadence profiles (skills-src/references/profiles.md,
 * generated from the shipped profiles in kit/profiles/, which the caller loads).
 */
export function profilesReference(profiles = []) {
  const pct = (value, unit) => (value == null ? '—' : unit === 'share' ? `${Math.round(value * 100)}%` : String(value));
  const lines = [
    '# Cadence profiles',
    '',
    '<!-- Generated from kit/profiles/*.json by scripts/sync-skills.mjs. Do not edit by hand; run `npm run skills:sync`. -->',
    '',
    'A cadence profile (`launchclip.cadence-profile.v1`) is what a strong video of one format and platform measures like: ranges (p10, p50, p90) over measurements of a reference set. Plan to the p50 targets inside the p10–p90 band; `launchclip finish` measures the render against the band. `launchclip profile list` and `launchclip profile show <id>` print them; `launchclip profile measure <folder>` measures your own references into one. Design: `docs/VIDEO_QUALITY_RFC.md` §5.',
    '',
    'A shipped profile is a seed until it is measured: conservative ranges, not statistics, so treat a seed\'s bands as guard rails. A measured profile\'s bands are statistics over its references (with fewer than 10 references, p10 and p90 are the smallest and largest reference values).',
    '',
    ...section('Choosing a profile', [
      'The profile follows the story\'s lane, aspect, duration and platform (`launchclip make --profile <id>`, a direction map\'s `profile` or a style\'s `profile` names one explicitly). A measured profile beats a seed that fits as well:',
      '',
      '| Profile | Format | Lanes | Aspects | Duration | Provenance |',
      '| --- | --- | --- | --- | --- | --- |',
      ...profiles.map((profile) => `| ${profile.id} | ${profile.format} | ${(profile.match?.lanes ?? ['any']).join(', ')} | ${(profile.match?.aspects ?? ['any']).join(', ')} | ${profile.duration_seconds[0]}–${profile.duration_seconds[1]} s | ${profile.provenance.kind} |`)
    ]),
    ...section('Measures', [
      '| Measure | What it is | Gate holds |',
      '| --- | --- | --- |',
      ...Object.entries(PROFILE_MEASURES).map(([name, spec]) => `| ${name} | ${spec.describe} | ${spec.check === 'band' ? 'p10 and p90' : spec.check === 'max' ? 'p90 (a ceiling)' : 'p10 (a floor)'} |`),
      '',
      'The motion gate holds still_share and longest_still_seconds to the profile\'s p90 when it has them, else to defaults by format: motion and character stories at most 10% still and 0.6 s, product demos 25% and 1.5 s, footage-led (a talking head) only a frozen picture of 4 s. A failing render lists its worst still spans with a fix for each: zoom-kick, drift, whip, dot-wipe or new visual.'
    ])
  ];
  for (const profile of profiles) {
    lines.push(...section(profile.id, [
      `${profile.description ?? profile.title ?? profile.id}`,
      '',
      '| Measure | p10 | p50 | p90 |',
      '| --- | --- | --- | --- |',
      ...Object.entries(profile.measures).map(([name, band]) => `| ${name} | ${pct(band.p10, PROFILE_MEASURES[name]?.unit)} | ${pct(band.p50, PROFILE_MEASURES[name]?.unit)} | ${pct(band.p90, PROFILE_MEASURES[name]?.unit)} |`)
    ]));
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/**
 * The storyboard-authoring instructions for one tier.
 * tier: "structured" | "guided" | "bespoke"; lane, format and brand are the
 * fixed inputs (copied into the prompt); words: optional measured narration
 * (NARRATION.json words) for word anchors.
 */
export function planningPrompt({ tier = 'structured', lane, format, brand, words, style, artDirection, subject, profile = null, direction = null, clipLed = null, explainer = null } = {}) {
  if (!PLANNER_TIERS.includes(tier)) throw new Error(`tier must be one of ${PLANNER_TIERS.join(', ')}`);
  if (lane !== undefined && !STORY_LANES.includes(lane)) throw new Error(`lane must be one of ${STORY_LANES.join(', ')}`);
  // Subject modules are offered only to a footage-led story whose presenter can be cut out.
  const subjectReady = lane === 'footage-led' && Boolean(subject?.usable);
  const available = moduleCatalogue().filter((module) => !module.needs?.includes('subject') || subjectReady);
  const lines = [
    `You author storyboard.json (${STORY_SCHEMA}) for LaunchClip, a renderer-neutral short-video contract. Tested modules draw every frame; you choose modules, write their copy and params, and time them. Model tier: ${tier}.`,
    'Return exactly one JSON object: the complete storyboard. No prose, no Markdown fences.',
    '',
    ...section('Fixed inputs', [
      `lane: ${lane ?? '(given in the request)'}`,
      `format: ${format ? JSON.stringify(format) : '(given in the request)'}`,
      `brand: ${JSON.stringify(brand ?? DEFAULT_BRAND)}`
    ]),
    ...(style ? section('Style pack (keep the channel consistent)', stylePromptLines(style, { lane }).map((line) => `- ${line}`)) : []),
    ...section('Contract', contractLines().map((line) => `- ${line}`)),
    ...section('Lane rules', laneRules(lane, profile).map((line) => `- ${line}`)),
    ...(profile ? section(`Cadence profile (${profile.id})`, cadenceLines(profile).map((line) => `- ${line}`)) : []),
    // clipLed: the clip-led rule in force (kit/core/clip-led.mjs clipLedPlan), when footage and a low density dial call for it.
    ...(clipLedLines(clipLed).length ? section('Footage and graphics (density)', clipLedLines(clipLed).map((line) => `- ${line}`)) : []),
    ...(direction ? section('Direction map (plan the storyboard against it)', directionPlanLines(direction)) : []),
    // explainer: {cast, roles}, a character-led explainer (kit/core/explainer.mjs).
    ...(explainer?.cast ? section('Characters carry the explainer', explainerStoryboardLines(explainer).map((line) => `- ${line}`)) : []),
    ...section('Script beats', scriptBeatLines().map((line) => `- ${line}`)),
    ...section('Motion grammar and camera', motionLines({ lane, artDirection, style }).map((line) => `- ${line}`)),
    ...section('Direction guardrails (finish gates fail these)', guardrailLines().map((line) => `- ${line}`)),
    ...section(`Tier rules (${tier})`, tierRules(tier).map((line) => `- ${line}`)),
    ...section('Time anchors', anchorLines().map((line) => `- ${line}`)),
    ...section('Safe zone', safeZoneLines(format, plannedCaptionBand({ format, style, lane, brand })).map((line) => `- ${line}`)),
    ...section('Captions', captionLines(lane).map((line) => `- ${line}`)),
    ...section('Data explainers (the study says)', dataExplainerLines().map((line) => `- ${line}`)),
    ...section('Social posts', socialPostLines().map((line) => `- ${line}`)),
    ...section('Code evidence (the receipt)', codeEvidenceLines().map((line) => `- ${line}`)),
    ...section('Builds, not cuts (shot states)', buildLines().map((line) => `- ${line}`)),
    ...section('Long-form look (plates and glass)', glassLookLines().map((line) => `- ${line}`)),
    ...section('3D data objects', objectLines().map((line) => `- ${line}`)),
    ...section('Satisfying motion (weight, piles and live numbers)', satisfyingLines().map((line) => `- ${line}`)),
    ...section('Interface scenes (ui-scene)', interfaceLines().map((line) => `- ${line}`)),
    ...(isShortFormat(format) ? section('Cover (Shorts)', coverLines().map((line) => `- ${line}`)) : []),
    ...(lane === 'footage-led' ? section('Presenter (subject)', subjectLines(subject, { profile }).map((line) => `- ${line}`)) : []),
    ...(lane === 'footage-led' ? section('Footage layouts (sections)', layoutLines({ format })) : []),
    ...section('Phrase → module', ['Pick the module from what the line says:', '', '| The script… | Module |', '| --- | --- |', ...phraseLines({ subject: lane === 'footage-led' ? Boolean(subject?.usable) : false })]),
    ...moodSection(artDirection, available),
    ...section('Modules', moduleLines(tier, available)),
    ...section('Example (motion lane, structured tier)', [JSON.stringify(exampleStoryboard({ format, brand }))])
  ];
  const narration = wordLines(words);
  if (narration.length) lines.push(...section('Narration word timings', narration));
  lines.push(...section('Checks', [
    'Your storyboard is validated against this contract, every scene is resolved through its module (param errors), and a layout check runs on the declared geometry. If anything fails you receive the exact errors: fix the named scenes and params and return the whole corrected storyboard. The checks and their thresholds never change.'
  ]));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * Markdown reference for the create-video skills
 * (skills-src/references/storyboard-modules.md, generated).
 */
const seconds = (value) => (value == null ? '—' : `${Math.round(value * 1000) / 1000} s`);

/**
 * The per-module timing table (kit/core/modules.mjs moduleTiming(), generated
 * from each module's own timing constants) as markdown lines.
 */
export function timingTableLines() {
  const rows = knownModules().map((id) => {
    const timing = moduleTiming(id);
    if (!timing) return `| ${id} | — | — | — | — |`;
    const notes = [...timing.gaps.map((gap) => `${gap.between}: ≥ ${seconds(gap.seconds)} apart`), ...timing.rules].join('; ') || '—';
    return `| ${id} | ${seconds(timing.minDuration)} | ${seconds(timing.leadIn)} | ${timing.leadOut == null ? '—' : `scene − ${seconds(timing.leadOut)}`} | ${notes.replace(/\|/g, '\\|')} |`;
  });
  return [
    'Generated from the modules\' own timing constants (`moduleTiming(id)` in kit/core/modules.mjs; `launchclip module fit <module>` prints the same rules with the window for a given `--duration`). `at` values are seconds from the scene start: the first beat no earlier than the lead-in, the last no later than the lead-out before the scene end. A faster motion grammar can shorten a catalogue B enter, which only moves its lead-in earlier.',
    '',
    '| Module | Min scene | First `at` | Last `at` | Gaps and rules |',
    '| --- | --- | --- | --- | --- |',
    ...rows
  ];
}

// Footage layouts (kit/core/footage-layout.mjs): the art director picks one
// per section of a footage-led story.
const LAYOUT_ROWS = [
  ['full', 'full frame, overlays only (no section needed)', 'the face carries the line: personal beats, the hook, the turn'],
  ['split-left', 'reframed onto the left side', 'a list, steps, a comparison or a product shot held beside them for a stretch'],
  ['split-right', 'reframed onto the right side', 'the same, mirrored; alternate sides between sections'],
  ['framed', 'inset in a rounded frame (`side` left/right in 16:9, top/bottom in 9:16)', 'proof, numbers or a quote that needs most of the canvas while they keep talking'],
  ['stacked', 'the bottom (or top, `side`) half, 9:16 only', 'a Short\'s explainer stretch: graphics on top, the presenter under them'],
  ['insert', 'hidden; the voice continues', 'a full-canvas visual over the voice (a demo, a chart), as an insert without cutting away from the section']
];

/** Prompt and reference lines for footage layouts. format: the story's, when known. */
export function layoutLines({ format } = {}) {
  const portrait = format ? Number(format.height) > Number(format.width) : null;
  const rows = LAYOUT_ROWS.filter(([name]) => !(name === 'stacked' && portrait === false));
  return [
    'A footage-led story may hold top-level `sections: [{id, start, end, layout, side?, panel?, room?, breakout?, transition?}]`: one layout for a stretch of the recording, and the scenes inside render within it. Times are seconds or word anchors; sections may not overlap; time outside every section is `full`. Plan the layout per section of the direction map, then place the section\'s scenes in its panel.',
    '',
    '| Layout | Presenter | Use it when the section… |',
    '| --- | --- | --- |',
    ...rows.map(([name, presenter, when]) => `| \`${name}\` | ${presenter} | ${when} |`),
    '',
    '- The panel is a brand colour (`panel`: bg (default), primary, accent, paper, ink or #rrggbb). `room`: "dim" or "replace" darkens or removes the recording behind the cut-out presenter (needs a matte over the section; `make` mattes it).',
    '- `breakout: true` on a `stacked` section, or a `framed` one with `side: "bottom"`, lifts the presenter\'s head over the top edge of their window, in front of the panel (needs a matte over the section; `make` mattes it). Keep panel content clear of the bottom of the panel there. Use it for a whole section, not for one line.',
    '- Changing layout is a `layout-shift` transition (0.5 s; `transition: {type: "layout-shift" | "cut", dur?}`). Hold a layout for a whole section (about 4 s or more); do not flip layouts line by line.',
    '- In a section with a panel, a checklist without `rect` fits the panel\'s safe area; give other modules a `rect` inside the panel, clear of the presenter\'s side.'
  ];
}

export function storyboardModulesReference() {
  const lines = [
    '# Storyboard modules',
    '',
    '<!-- Generated from kit/core/planning-prompt.mjs by scripts/sync-skills.mjs. Do not edit by hand; run `npm run skills:sync`. -->',
    '',
    `Use this reference when you author \`storyboard.json\` (${STORY_SCHEMA}). It is generated from the module registry, so every module listed here exists in both renderers. The same text, specialised for one model tier, is what \`launchclip story plan\` sends to a model.`,
    '',
    'Check every edit with `launchclip story validate storyboard.json` and `launchclip layout-check <project>`.',
    '',
    ...section('Model tiers', [
      '| Tier | May write | May not |',
      '| --- | --- | --- |',
      `| structured | catalogue modules and their content params, hits | ${TUNING_PARAMS.map((name) => `\`${name}\``).join(', ')}, \`custom\` |`,
      `| guided | the above plus enum variants and ${TUNING_PARAMS.map((name) => `\`${name}\``).join(', ')} | \`custom\` |`,
      '| bespoke | the above plus `custom` modules (pure functions of time with a catalogue fallback) | bypassing gates |'
    ]),
    ...section('Contract', contractLines().map((line) => `- ${line}`)),
    ...section('Lane rules', laneRules().map((line) => `- ${line}`)),
    ...section('Motion grammar and camera', motionLines().map((line) => `- ${line}`)),
    ...section('Direction guardrails (finish gates fail these)', guardrailLines().map((line) => `- ${line}`)),
    ...section('Time anchors', anchorLines().map((line) => `- ${line}`)),
    ...section('Safe zone', safeZoneLines().map((line) => `- ${line}`)),
    ...section('Captions', captionLines().map((line) => `- ${line}`)),
    ...section('Data explainers (the study says)', dataExplainerLines().map((line) => `- ${line}`)),
    ...section('Social posts', socialPostLines().map((line) => `- ${line}`)),
    ...section('Code evidence (the receipt)', codeEvidenceLines().map((line) => `- ${line}`)),
    ...section('Builds, not cuts (shot states)', buildLines().map((line) => `- ${line}`)),
    ...section('Long-form look (plates and glass)', glassLookLines().map((line) => `- ${line}`)),
    ...section('3D data objects', objectLines().map((line) => `- ${line}`)),
    ...section('Satisfying motion (weight, piles and live numbers)', satisfyingLines().map((line) => `- ${line}`)),
    ...section('Interface scenes (ui-scene)', interfaceLines().map((line) => `- ${line}`)),
    ...section('Footage layouts (sections)', layoutLines()),
    ...section('Phrase → module', ['| The script… | Module |', '| --- | --- |', ...phraseLines()]),
    ...section('Modules', moduleLines('guided')),
    ...section('Timing rules', timingTableLines()),
    ...section('Example', ['```json', JSON.stringify(exampleStoryboard(), null, 2), '```'])
  ];
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * Markdown reference for subject-aware effects in the create-video skills
 * (skills-src/references/subject-effects.md, generated). Built from the same
 * registry, phrase table and presenter rules as the planner prompt.
 */
export function subjectEffectsReference() {
  const catalogue = moduleCatalogue();
  const AROUND = ['pull-back', 'phone-stage'];
  const subjectModules = catalogue.filter((module) => module.needs?.includes('subject') || AROUND.includes(module.id));
  const punchIn = catalogue.filter((module) => module.id === 'punch-in');
  const rows = subjectModules.map((module) => {
    const uses = PHRASE_MODULE_TABLE.filter((row) => row.module === module.id).map((row) => row.when).join('; ') || '—';
    return `| ${module.id} | ${module.layer ?? 'front'} | ${module.needs?.includes('subject') ? 'yes' : 'no'} | ${(module.aspects ?? ['9:16', '16:9']).join(', ')} | ${(module.mood ?? []).join(', ') || '—'} | ${uses.replace(/\|/g, '\\|')} |`;
  });
  const ready = { usable: true, reasons: [], framing: 'medium', headroom: 0.2 };
  const lines = [
    '# Subject effects',
    '',
    '<!-- Generated from kit/core/planning-prompt.mjs by scripts/sync-skills.mjs. Do not edit by hand; run `npm run skills:sync`. -->',
    '',
    'Effects that use the presenter cut out of a footage-led recording: graphics that sit behind them, a room that moves while they hold still. They need one person in frame and a local matte; everything else in a footage-led story still works without one. Design: `docs/SUBJECT_EFFECTS_RFC.md` in the LaunchClip repo.',
    '',
    ...section('Getting the subject', [
      '1. Probe the recording before planning: `launchclip subject probe assets/recording.mp4 --json`. Read `usable` (and `reasons` when it is false), `framing` (close-up, medium or wide) and `headroom`. Plan subject effects only when `usable` is true. Then track the presenter over the whole recording: `launchclip subject track assets/recording.mp4 --project .` files `assets/subject/track.json`, so footage placement and layout-check\'s face rule know where the head is outside the matted ranges.',
      '2. Plan the storyboard. Subject effects are timed on the edited timeline like every other scene.',
      '3. Matte the source range each subject scene covers, padded by about 0.5 s: `launchclip subject matte assets/recording.mp4 --range <in>-<out> --project .`. The matte, its framing data, the room plate and the traced outline (`contours.json`, which doodle-outline draws from) are filed under `assets/subject/`, and `base.subject` (default `"auto"`) picks them up. With `base.trim` or `base.edl`, map timeline seconds back to source seconds first.',
      '4. `launchclip story validate`, `launchclip layout-check` and `launchclip finish` read the filed mattes. `launchclip make` runs all of this for you; `launchclip fx <video> <module>` does it for one effect on a clip.',
      '',
      'The models download on first use (`launchclip subject setup` fetches them up front; `launchclip doctor` reports them). Mattes take about 0.2 s a frame at 1080×1920 on an Apple-silicon Mac, so matte only the ranges you use.'
    ]),
    ...section('Layers', [
      '- `scene.layer: "behind"`: the scene draws behind the presenter, so their head and body cover it. masthead and dolly-zoom are behind by default.',
      '- No layer (front): the scene draws over the presenter, as every footage-led overlay always has.',
      '- `"split"`: modules that draw on both sides of the presenter (feed-frame: its backdrop behind them, its feed chrome in front).',
      '- `base.subject: "off"` turns the subject off; `{"mattes": [...]}` lists mattes explicitly (`src`, `in`, `out`, `info`, `plate`, `contours`).',
      '',
      'Both renderers stack the base recording, behind scenes, the cut-out presenter, front scenes, then captions. A punch-in moves (and blurs) the presenter and the room together.',
      '',
      '`launchclip export` keeps that depth for editors: FCPXML (Final Cut Pro), Premiere XML and OpenTimelineIO stack behind overlays, a subject track (the mattes, transcoded to ProRes 4444 and placed through the base\'s cuts), front overlays and captions above the base. A split scene exports as two clips, its behind and front parts. EDL has one video track, so it carries only the base. A scene that sets `subjectCamera`, `room` or `subjectStyle` exports its static layering, with a warning in `EXPORT.json`; `--overlays none` exports no subject track.'
    ]),
    ...section('Rules', subjectLines(ready).slice(1).map((line) => `- ${line}`)),
    ...section('Modules', [
      '| Module | Layer | Needs the matte | Aspects | Moods | Use when the presenter… |',
      '| --- | --- | --- | --- | --- | --- |',
      ...rows,
      '',
      ...moduleLines('guided', [...subjectModules, ...punchIn])
    ])
  ];
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

// ---------------------------------------------------------------------------
// The cover (kit/core/story.mjs validateCover): for a Short, the first frame
// is the cover in the profile grid, so it has to read on its own.

/** A Short: 9:16 (portrait) and at most 60 s. */
export function isShortFormat(format) {
  return Boolean(format) && Number(format.height) > Number(format.width) && Number(format.duration) <= 60;
}

export function coverLines() {
  return [
    'Set cover: {text, number?, kicker?, frame}. finish renders it on its own as video/cover.png, the thumbnail to upload; it is what the profile grid shows, so it must read on its own.',
    `cover.frame: the seconds of the strongest image in the video (the key shot when the brief names one), a frame that already reads as the cover. Never "first": that opens the video on a ${COVER_SECONDS} s text card, and a short video opens on an image.`,
    `cover.text echoes the best title (the first under "Titles", when the brief lists them) and the hook in at most ${COVER_MAX_WORDS} words: one number or a short question ("100g PROTEIN. ALL AT ONCE?", "10 vs 25: WHICH BUILDS MORE MUSCLE?"). Name the concrete outcome; never tease and never lead with the brand or product name. When the brief names a skeleton's cover idea, build the cover on it.`,
    'cover.number: the one huge number when there is one ("100g"); it leads the headline unless the text already says it. cover.kicker: an optional sticker of at most 18 characters.'
  ];
}

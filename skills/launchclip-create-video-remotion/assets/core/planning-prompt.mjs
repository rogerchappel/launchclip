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

import { STORY_SCHEMA, STORY_LANES, STORY_TRANSITIONS, STORY_CAPTION_STYLES, STORY_CAMERA_LAYOUTS, STORY_AMBIENT_LEVELS } from './story.mjs';
import { GRAMMARS, GRAMMAR_NAMES } from './grammar.mjs';
import { knownModules, catalogModules, isEditorialKind, moduleTiming, SUBJECT_DENSITY } from './modules.mjs';
import { SAFE_ZONE_PROFILES } from './layout-check.mjs';
import { stylePromptLines } from './style.mjs';
import { CAPTION_PRESETS } from './captions.mjs';
import { PROFILE_MEASURES, profilePromptLines } from './profiles.mjs';
import { DIRECTION_INTENTS, DIRECTION_LAYOUTS, DIRECTION_SCHEMA, DIRECTION_TREATMENTS, INTENT_RULES, NARRATIVE_BEATS, VISUAL_INTENTS, intentHints } from './direction.mjs';

export const PLANNER_TIERS = Object.freeze(['structured', 'guided', 'bespoke']);

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
// module is planned but not yet in the registry names a `fallback` that is.
export const PHRASE_MODULE_TABLE = Object.freeze([
  { module: 'hook-title', when: 'opens on a question or claim (frame 0 visible)', patterns: ['^(why|how|what|did you know|ever wonder|stop)\\b', '\\?\\s*$'] },
  { module: 'kinetic-words', when: 'lands 1–3 words per beat', patterns: ['\\b(fast|simple|instantly|never|always|zero)\\b'] },
  { module: 'function-chart', when: 'describes a quantity over time or a curve', patterns: ['\\bover time\\b', '\\bcurve\\b', '\\bexponential', '\\bdecay', '\\bcool(s|ing)?\\b', '\\brate of\\b', '\\bhalf-life\\b'] },
  { module: 'gauge-compare', when: 'contrasts two values or states', patterns: ['\\bversus\\b', '\\bvs\\.?\\s', '\\bcompared (to|with)\\b', '\\b(hotter|colder|higher|lower|bigger|smaller) than\\b'] },
  { module: 'flow-compare', when: 'says "big X → fast, small X → slow"', patterns: ['\\bbig(ger)?\\b.*\\bfast(er)?\\b', '\\bsmall(er)?\\b.*\\bslow(er)?\\b', '\\bthroughput\\b', '\\bflows?\\b'] },
  { module: 'count-up', when: 'gives a number, time, price or count', patterns: ['\\d', '\\b(percent|dollars?|minutes?|seconds?|hours?|times faster)\\b', '[$%×]'] },
  { module: 'metric', when: 'gives a sourced figure that should stay on screen with captions', patterns: ['\\b(according to|reported|survey|benchmark(ed)?|measured)\\b'] },
  { module: 'checklist', when: 'lists steps, features or duties', patterns: ['\\b(features?|includes?|checklist|requirements?|you get)\\b', '\\bfirst\\b.*\\bsecond\\b'] },
  { module: 'process-steps', when: 'explains a sequence or mechanism', patterns: ['\\b(then|next|finally|steps?|process|pipeline|how it works)\\b'] },
  { module: 'step-rail', when: 'walks through the stages of a workflow', patterns: ['\\b(stages?|phases?|milestones?)\\b'] },
  { module: 'equation-lockup', when: 'names a law or formula', patterns: ['\\b(law|formula|equation|theorem|principle)\\b', '\\s=\\s'] },
  { module: 'archive-card', when: 'cites history, a source or a quote', patterns: ['\\bin \\d{3,4}\\b', '\\b(history|historian|quoted?|wrote|century|archive)\\b'] },
  { module: 'date-card', when: 'names a specific date or launch day', patterns: ['\\b(january|february|march|april|may|june|july|august|september|october|november|december) \\d{1,2}\\b', '\\blaunch(es|ed)? on\\b'] },
  { module: 'product-demo', lanes: ['motion', 'voiceover-motion'], when: 'shows the product in use: a recorded flow (assets/demo/<flow>.mp4 with <flow>.actions.json from launchclip demo record)', patterns: ['\\b(click|clicks|sign(s)? (in|up)|create[sd]?|onboard\\w*|walk(s)? through|in action|set(s)? up|watch)\\b'] },
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
  { module: 'brand-lockup', when: 'names the brand on a title or end card, with its logo and wordmark images (and an app-store badge or URL on the end card)', patterns: ['\\b(introducing|meet|presenting)\\b', '\\b(app store|google play|download (it|now|today))\\b'] },
  { module: 'cta', when: 'calls to action, or the loop ending', patterns: ['\\b(follow|subscribe|try it|get started|star|download|sign up|learn more|link in bio)\\b'] },
  { module: 'concept-card', intents: ['claim', 'problem', 'turn'], when: 'names a claim, a problem or a turn in a few words ("the problem is", "here\'s the thing", "too slow"): a big word or phrase with an icon and a sub-line (on a card beside the presenter, or full frame)', patterns: ['\\bthe (problem|secret|catch|trick|key|point) is\\b', '\\b(here\'s the thing|the truth is|bottom line|the real reason)\\b', '\\btoo (slow|hard|expensive|complex|long)\\b'] },
  { module: 'icon-row', intents: ['list', 'process'], when: 'lists two to five things, features, steps or audiences ("X, Y and Z", "three things"): an icon per item that pops on its word', patterns: ['\\w[^,.;]{0,24}, \\w[^,.;]{0,24},? (and|or) \\w', '\\b(two|three|four|five|2|3|4|5) (things|ways|reasons|features|tools|steps|parts)\\b'] },
  { module: 'section-card', intents: ['section'], when: 'opens a new section or chapter ("part two", "first, the problem", "chapter", "let\'s start with"): the brand frame\'s kicker and the section title (usually an insert)', patterns: ['\\b(part|chapter|section) (one|two|three|four|five|\\d+)\\b', '\\b(let\'s start with|first up|moving on|next up)\\b'] },
  { module: 'object-card', intents: ['product', 'claim'], when: 'talks about a thing the product is or makes (a box, a launch, a calendar, a laptop, an inbox): a simple illustrated object with a caption', patterns: ['\\b(ships?|shipping|package|box|delivery|calendar|schedule|laptop|inbox|email|launch(es|ed)?|trophy|award|idea)\\b'] },
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
  { module: 'callout', lanes: ['motion', 'voiceover-motion'], when: 'a short note, tip or warning card', patterns: ['\\b(note|remember|important|tip|warning)\\b'] }
].map((row) => Object.freeze({ ...row, patterns: Object.freeze(row.patterns) })));

/** The registry module a phrase-table row maps to (its fallback when the module is planned). */
export function phraseRowModule(row, modules = knownModules()) {
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
 * punch-ins; the motion and voiceover lanes get the world camera when the
 * direction asks for travel, or when its grammar is playful, snappy, smooth or cinematic
 * (editorial and documentary keep cuts unless asked).
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
  if (['playful', 'snappy', 'smooth', 'cinematic'].includes(grammar)) return { grammar, camera: { mode: 'world', layout: 'auto' }, reason: `${grammar} motion travels between scenes` };
  return { grammar, camera: { mode: 'cuts' }, reason: `${grammar} motion cuts between scenes` };
}

function motionLines({ lane, artDirection } = {}) {
  const lines = [
    `motion? {grammar}: one feel for every entrance, exit, pop, stagger, transition and camera move. grammar is one of ${GRAMMAR_NAMES.join(', ')}, or {base, ...overrides} (ease: {enter, exit, move, camera, emphasis}, duration: {enter, exit, transition, camera}, stagger multiplier). Omit it for editorial, the default.`,
    ...GRAMMAR_NAMES.map((name) => `${name}: ${GRAMMARS[name].describe} Camera ease ${GRAMMARS[name].ease.camera}, camera moves about ${GRAMMARS[name].duration.camera} s, transitions about ${GRAMMARS[name].duration.transition} s.`),
    `camera? {mode: "cuts" | "world", layout?: ${STORY_CAMERA_LAYOUTS.join(' | ')}, spacing?: 0–1, parallax?: boolean, blur?: boolean}. "cuts" (default): scenes replace each other. "world": every track-0 scene sits in one world and the camera travels to it, with a slow drift (never fully still), a parallax background (0.3×) and overlays at 1.15×. Motion blur: whip-pans always; pans, pushes, pulls and orbits get a moderate blur in snappy and playful; blur true blurs every move fully, false none.`,
    'Camera transitions (scene.in or ending.in, track-0 scenes only): pan {direction: where the next scene sits, e.g. "right"}, whip-pan (fast, motion-blurred), orbit (pan with a slight turn), pull (dolly out to a wider scene) and, in world mode only, push (dolly into a named object: in.from_object "s3.gap-bracket", else the scene content). In cuts mode push keeps its slide meaning, and pan/whip-pan/orbit/pull still move a camera between the two scenes.',
    'Choose by meaning and art direction: pan for continuation along a path, push to go deeper into a detail, pull to reveal the bigger picture, orbit for a change of angle on the same subject, whip-pan for energy or a time jump, cut/fade when the story jumps. Give camera moves 0.6–1.2 s (whip-pan 0.3–0.5 s) and keep scenes at least 2 s longer than their move.',
    'Captions and camera moves: a vertical pan or whip-pan (up/down), push, pull or orbit carries panels through the caption band mid-move, so the captions dip out for those moves by default (captions overlay hide_during_moves: "auto"; true dips for every move, false never). Horizontal pans keep their captions. layout-check samples every frame of every camera move and flags key content crossing visible captions (camera-caption-band). When a line must stay captioned through the move, pan left or right.',
    'In world mode, an ending {"loop_to": "s1", "in": {"type": "whip-pan", "dur": 0.4}} travels home for a seamless loop.',
    'Lanes: footage-led keeps camera.mode "cuts" and uses punch-in for emphasis (no camera transitions). The motion and voiceover-motion lanes may use the world camera; use it when the direction asks for travel or the grammar is playful, snappy, smooth or cinematic.'
  ];
  if (artDirection) {
    const suggestion = suggestMotion({ artDirection, lane });
    lines.push(`For this request: motion.grammar "${suggestion.grammar}" and camera.mode "${suggestion.camera.mode}" (${suggestion.reason}).`);
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
          ...['rect', 'density', 'accent', 'theme', 'presentation', 'motion'].map((name) => ({ name, text: name === 'rect' ? '{x, y, width, height} canvas px (width ≥ 420, height ≥ 160); usually omit it' : name === 'density' ? '"fill" (an explicit rect\'s text grows to fill it; recommended with rect in 16:9) | "fixed"' : name === 'accent' ? '#rrggbb' : name === 'presentation' ? '"solid" | "glass"' : name === 'motion' ? '{enter, exit, distance, enterDuration, exitDuration, scale}' : '{surface, foreground, muted, border, accentText?}', tuning: true }))
        ],
        events: spec?.events ?? ['enter'],
        hidesCaptions: false
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
      ...(definition.mood ? { mood: [...definition.mood] } : {})
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
    'footage-led': `footage-led: base (the edited recording under assets/) plays underneath and is a fixed input; copy it unchanged. Scenes are overlays beside the presenter and full-frame inserts (insert: true), placed where the direction map says: every dress or insert line gets its scenes, and face lines keep the recording on purpose. ${coverageRule(profile)} Add a captions overlay.`
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

function safeZoneLines(format) {
  const portrait = !format || Number(format.height) > Number(format.width);
  const profiles = format ? [portrait ? SAFE_ZONE_PROFILES.shorts : SAFE_ZONE_PROFILES.landscape] : [SAFE_ZONE_PROFILES.shorts, SAFE_ZONE_PROFILES.landscape];
  const box = (rect) => `x ${rect.x}–${rect.x + rect.width}, y ${rect.y}–${rect.y + rect.height}`;
  const lines = profiles.map((profile) => `${profile.id} (${profile.reference.width}x${profile.reference.height}): key content within ${box(profile.safeZone)}; caption band ${box(profile.captionBand)}; centre of mass near y ${profile.centerOfMassY}; key text at least ${profile.minTextPx} px${profile.lowerThird ? '; keep the lower third occupied' : ''}.`);
  return [
    ...lines,
    'Catalogue modules size and place themselves inside the safe zone and fail with a param error when copy is too long; shorten copy rather than shrinking it.',
    'Editorial modules without a rect size and place themselves from their content inside the safe zone and above the caption band, with type scaled to fill the panel; omit rect unless the layout needs a specific position. With a rect in 16:9, also set density: "fill", or the text stays small and a bigger rect is just more empty panel. They need a 1080x1920 or 1920x1080 format.'
  ];
}

function captionLines() {
  return [
    `Captions are one overlay: {"type": "captions", "style": ${STORY_CAPTION_STYLES.map((value) => JSON.stringify(value)).join(' | ')}}. Use "word-highlight" whenever there is a voice.`,
    `A caption preset may replace style: {"type": "captions", "preset": "<name>"}, one of ${Object.keys(CAPTION_PRESETS).join(', ')}. With a style pack, write {"type": "captions"} and let the pack choose the preset.`,
    'Modules marked "hides captions" hide them while on screen; every other module keeps them visible, so its content stays above the caption band.',
    'On-screen copy is shorter than the narration; never put a whole sentence on screen.'
  ];
}

function anchorLines() {
  return [
    'scene.start, scene.end and hits[].at accept: seconds (2.5); "word:<text>" (the first time that word is spoken); "word:<text>#<n>" (its n-th occurrence); an optional offset ("word:fast-0.2"); "beat:<n>" or "downbeat:<n>" (from BEATS.json).',
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
    `scenes: [{id ("s1", "s2"…), module, start, end, energy (0 calm, 1 light, 2 groove, 3 full, "build"), in? {type: ${STORY_TRANSITIONS.join(' | ')}, dur, direction?, from_object?}, params, hits?, ambient?, layer? (footage-led: "behind" draws it behind the presenter)}].`,
    'in.dur must be shorter than the scene. Choose transitions by meaning: cut for contrast, push for continuation, whip for speed, zoom for scale change, morph for identity (name in.from_object, e.g. "s2.gap-bracket"), iris for focus; camera moves (pan, whip-pan, orbit, pull, world push) are under "Motion grammar and camera".',
    'overlays: [captions]. ending: {loop_to: "<first scene id>"} for a seamless loop (Shorts). For no loop, set ending {loop: false} (or loop_to: null, or omit ending without a looping style pack); the last scene then holds settled to the final frame (ending.final "hold", the default), or use final "fade" to fade it fully to the background by the final frame, or "exit" to play its own exit. ending accepts only loop_to, in, loop and final.',
    ...ambientLines(),
    'Recorded product flows (assets/demo/<flow>.mp4 with demo/<flow>.actions.json, from launchclip demo record) play in product-demo scenes. Copy the params the asset inventory gives for each flow (media, viewport, actions, callouts) unchanged: the zooms, outlines and SFX are timed from the real action log, so never invent or move action boxes or times. Time the scene to the clip window (media.sourceStart plus the scene length must stay inside the clip); you may shorten a scene from the end, and drop actions after it.',
    'Vary the modules: a 20–40 s piece uses at least four different modules and never the same module three times in a row.'
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
    lines.push('');
  }
  if (tier === 'bespoke') lines.push('### custom (bespoke tier only)', 'A project module at scene.source (project-relative path, no params schema). Pure function of absolute time; must obey the safe zone; falls back to the nearest catalogue module when it fails a gate.', '');
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
    const planned = target !== row.module ? ` (planned module ${row.module}; use ${target})` : '';
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
      { id: 's1', module: 'hook-title', start: 0, end: 3, energy: 1, params: { headline: 'Why does CI take 40 minutes?', emphasis: '40 minutes', kicker: 'Fix it' }, hits: [{ at: 0.8, event: 'emphasis-0' }] },
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
    `Dress every line whose intent calls for a visual (${VISUAL_INTENTS.join(', ')}) unless it works better on the presenter, and then say why. A character story's lines may add cast cues ({id, pose, expression, at: "word:<text>"}) and a set.`
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
export function directionPrompt({ lane, format, profile = null, words, subject = null } = {}) {
  const hints = intentHints(words);
  const lines = [
    `You author DIRECTION.json (${DIRECTION_SCHEMA}) for LaunchClip: the visual decision for every line of the narration, made before the storyboard. The storyboard is planned against it next.`,
    'Return exactly one JSON object: the complete direction map. No prose, no Markdown fences.',
    '',
    ...section('Fixed inputs', [`lane: ${lane ?? '(given)'}`, `format: ${format ? JSON.stringify(format) : '(given)'}`, `profile: ${profile?.id ?? '(none)'}`]),
    ...section('Contract', directionContractLines({ lane }).map((line) => `- ${line}`)),
    ...section('Intent rules (first match wins)', intentRuleLines()),
    ...(profile ? section(`Cadence profile (${profile.id})`, [...cadenceLines(profile).map((line) => `- ${line}`), '- Coverage comes from the treatments: plan enough dress and insert lines to land near the coverage target, and no run of face or camera lines longer than the undressed limit.']) : []),
    ...(lane === 'footage-led' ? section('Presenter', [subject?.usable ? `The presenter can be cut out (${subject.framing ?? 'unknown'} framing): split and framed layouts and behind-the-presenter scenes are available.` : 'No presenter cut-out: use full and insert layouts, or split on the base camera.']) : []),
    ...section('Narration lines (suggested intents)', ['Keep these lines unless two belong together or one holds two ideas; keep the word ranges exact.', '', ...hints.map((hint) => `- [${hint.words[0]}, ${hint.words[1]}] ${hint.intent}: "${hint.text.slice(0, 200)}" (${round2(hint.start)}–${round2(hint.end)} s)`)]),
    ...section('Example', [JSON.stringify(exampleDirection())])
  ];
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
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
      `A story told by characters uses story beats as sections (\`beat\`: ${NARRATIVE_BEATS.join(', ')}), and each line says who acts: \`cast: [{id, pose, expression, at: "word:<text>"}]\` and a \`set\`. Cast cues name characters from the story's cast and poses, expressions and sets from the character kit; validation checks them when the kit is present.`
    ]),
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
    'Every shipped profile is a seed until it is measured: conservative ranges, not statistics. Treat the bands as guard rails.',
    '',
    ...section('Choosing a profile', [
      'The profile follows the story\'s lane, aspect, duration and platform (a direction map\'s `profile` or a style\'s `profile` names one explicitly):',
      '',
      '| Profile | Format | Lanes | Aspects | Duration | Provenance |',
      '| --- | --- | --- | --- | --- | --- |',
      ...profiles.map((profile) => `| ${profile.id} | ${profile.format} | ${(profile.match?.lanes ?? ['any']).join(', ')} | ${(profile.match?.aspects ?? ['any']).join(', ')} | ${profile.duration_seconds[0]}–${profile.duration_seconds[1]} s | ${profile.provenance.kind} |`)
    ]),
    ...section('Measures', [
      '| Measure | What it is | Gate holds |',
      '| --- | --- | --- |',
      ...Object.entries(PROFILE_MEASURES).map(([name, spec]) => `| ${name} | ${spec.describe} | ${spec.check === 'band' ? 'p10 and p90' : spec.check === 'max' ? 'p90 (a ceiling)' : 'p10 (a floor)'} |`)
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
export function planningPrompt({ tier = 'structured', lane, format, brand, words, style, artDirection, subject, profile = null, direction = null } = {}) {
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
    ...(style ? section('Style pack (keep the channel consistent)', stylePromptLines(style).map((line) => `- ${line}`)) : []),
    ...section('Contract', contractLines().map((line) => `- ${line}`)),
    ...section('Lane rules', laneRules(lane, profile).map((line) => `- ${line}`)),
    ...(profile ? section(`Cadence profile (${profile.id})`, cadenceLines(profile).map((line) => `- ${line}`)) : []),
    ...(direction ? section('Direction map (plan the storyboard against it)', directionPlanLines(direction)) : []),
    ...section('Motion grammar and camera', motionLines({ lane, artDirection }).map((line) => `- ${line}`)),
    ...section(`Tier rules (${tier})`, tierRules(tier).map((line) => `- ${line}`)),
    ...section('Time anchors', anchorLines().map((line) => `- ${line}`)),
    ...section('Safe zone', safeZoneLines(format).map((line) => `- ${line}`)),
    ...section('Captions', captionLines().map((line) => `- ${line}`)),
    ...(lane === 'footage-led' ? section('Presenter (subject)', subjectLines(subject, { profile }).map((line) => `- ${line}`)) : []),
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
    ...section('Time anchors', anchorLines().map((line) => `- ${line}`)),
    ...section('Safe zone', safeZoneLines().map((line) => `- ${line}`)),
    ...section('Captions', captionLines().map((line) => `- ${line}`)),
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

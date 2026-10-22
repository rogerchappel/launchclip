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
import { knownModules, catalogModules, isEditorialKind } from './modules.mjs';
import { SAFE_ZONE_PROFILES } from './layout-check.mjs';
import { stylePromptLines } from './style.mjs';
import { CAPTION_PRESETS } from './captions.mjs';

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
  { module: 'cta', when: 'calls to action, or the loop ending', patterns: ['\\b(follow|subscribe|try it|get started|star|download|sign up|learn more|link in bio)\\b'] },
  { module: 'punch-in', fallback: 'kinetic-words', lanes: ['footage-led'], when: 'footage-led emphasis on a word', patterns: ['\\b(this|exactly|really|huge)\\b', '!\\s*$'] },
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
 * Returns [{sentence, modules: [id…]}] for sentences with at least one match.
 */
export function suggestModules(text, { lane, limit = 3 } = {}) {
  const modules = knownModules();
  const sentences = String(text ?? '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map((entry) => entry.trim()).filter(Boolean);
  const hints = [];
  for (const sentence of sentences) {
    const matched = [];
    for (const row of PHRASE_MODULE_TABLE) {
      if (row.lanes && lane && !row.lanes.includes(lane)) continue;
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
  { grammar: 'smooth', patterns: ['\\bsmooth\\b', '\\bcalm\\b', '\\belegant\\b', '\\bpremium\\b', '\\bluxur', '\\bsoft\\b', '\\bdreamy\\b', '\\bwellness\\b', '\\bflowing\\b', '\\bcinematic\\b', '\\bminimal'] }
]);
const WORLD_WORDS = ['\\bjourney\\b', '\\bexplore', '\\bmap\\b', '\\bworld\\b', '\\bcontinuous\\b', '\\bone[- ]take\\b', '\\bpans?\\b', '\\bcamera\\b', '\\bfly[- ]?through\\b', '\\btravel'];
const CUT_WORDS = ['\\bhard cuts?\\b', '\\bjump cuts?\\b', '\\bno camera\\b', '\\bstatic\\b'];

/**
 * Motion grammar and camera mode for an art direction (free text: the brief
 * or style notes) and lane. Footage-led stories always keep cuts and
 * punch-ins; the motion and voiceover lanes get the world camera when the
 * direction asks for travel, or when its grammar is playful, snappy or smooth
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
  if (['playful', 'snappy', 'smooth'].includes(grammar)) return { grammar, camera: { mode: 'world', layout: 'auto' }, reason: `${grammar} motion travels between scenes` };
  return { grammar, camera: { mode: 'cuts' }, reason: `${grammar} motion cuts between scenes` };
}

function motionLines({ lane, artDirection } = {}) {
  const lines = [
    `motion? {grammar}: one feel for every entrance, exit, pop, stagger, transition and camera move. grammar is one of ${GRAMMAR_NAMES.join(', ')}, or {base, ...overrides} (ease: {enter, exit, move, camera, emphasis}, duration: {enter, exit, transition, camera}, stagger multiplier). Omit it for editorial, the default.`,
    ...GRAMMAR_NAMES.map((name) => `${name}: ${GRAMMARS[name].describe} Camera ease ${GRAMMARS[name].ease.camera}, camera moves about ${GRAMMARS[name].duration.camera} s, transitions about ${GRAMMARS[name].duration.transition} s.`),
    `camera? {mode: "cuts" | "world", layout?: ${STORY_CAMERA_LAYOUTS.join(' | ')}, spacing?: 0–1, parallax?: boolean, blur?: boolean}. "cuts" (default): scenes replace each other. "world": every track-0 scene sits in one world and the camera travels to it, with a slow drift (never fully still), a parallax background (0.3×) and overlays at 1.15×.`,
    'Camera transitions (scene.in or ending.in, track-0 scenes only): pan {direction: where the next scene sits, e.g. "right"}, whip-pan (fast, motion-blurred), orbit (pan with a slight turn), pull (dolly out to a wider scene) and, in world mode only, push (dolly into a named object: in.from_object "s3.gap-bracket", else the scene content). In cuts mode push keeps its slide meaning, and pan/whip-pan/orbit/pull still move a camera between the two scenes.',
    'Choose by meaning and art direction: pan for continuation along a path, push to go deeper into a detail, pull to reveal the bigger picture, orbit for a change of angle on the same subject, whip-pan for energy or a time jump, cut/fade when the story jumps. Give camera moves 0.6–1.2 s (whip-pan 0.3–0.5 s) and keep scenes at least 2 s longer than their move.',
    'In world mode, an ending {"loop_to": "s1", "in": {"type": "whip-pan", "dur": 0.4}} travels home for a seamless loop.',
    'Lanes: footage-led keeps camera.mode "cuts" and uses punch-in for emphasis (no camera transitions). The motion and voiceover-motion lanes may use the world camera; use it when the direction asks for travel or the grammar is playful, snappy or smooth.'
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
 * [{id, family: "catalogue" | "editorial", describe, params: [{name, text, tuning}], events, hidesCaptions}].
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
      hidesCaptions: hidesCaptionsFrom(definition.describe)
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

function laneRules(lane) {
  const rules = {
    motion: 'motion: no voice. Full-frame modules cover the whole duration back to back on track 0 (no gaps). Time scenes in seconds or beat anchors. finish snaps second-timed cuts to the nearest downbeat (within 0.25 s), so plan cuts on bar lines where you can.',
    'voiceover-motion': 'voiceover-motion: audio.voice and audio.words are fixed inputs; copy them unchanged. Full-frame modules cover the whole duration on track 0. Start scenes and place hits on word anchors from the narration so visuals land on the spoken word. Add a captions overlay.',
    'footage-led': 'footage-led: base (the edited recording under assets/) plays underneath and is a fixed input; copy it unchanged. Scenes are overlays and inserts on the strong lines only, covering 10–40% of the runtime (up to 50% with resource inserts); gaps show the recording. Prefer callout, kinetic-words, count-up and metric. Add a captions overlay.'
  };
  return lane && rules[lane] ? [rules[lane]] : STORY_LANES.map((name) => rules[name]);
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
    `scenes: [{id ("s1", "s2"…), module, start, end, energy (0 calm, 1 light, 2 groove, 3 full, "build"), in? {type: ${STORY_TRANSITIONS.join(' | ')}, dur, direction?, from_object?}, params, hits?, ambient?}].`,
    'in.dur must be shorter than the scene. Choose transitions by meaning: cut for contrast, push for continuation, whip for speed, zoom for scale change, morph for identity (name in.from_object, e.g. "s2.gap-bracket"), iris for focus; camera moves (pan, whip-pan, orbit, pull, world push) are under "Motion grammar and camera".',
    'overlays: [captions]. ending: {loop_to: "<first scene id>"} for a seamless loop (Shorts).',
    ...ambientLines(),
    'Vary the modules: a 20–40 s piece uses at least four different modules and never the same module three times in a row.'
  ];
}

// Ambient motion (kit/core/ambient.mjs): what the planner may set and what
// the default already does.
function ambientLines() {
  return [
    `ambient? (optional): {level: ${STORY_AMBIENT_LEVELS.join(' | ')}, background?: boolean, drift?: boolean}, or just the level. Ambient motion keeps settled frames alive between beats: a slow push-in on each settled module (kept inside the safe zone) and soft brand-colour light drifting behind the plates.`,
    'Usually leave ambient out: the level follows each scene\'s energy (0 → subtle, 1, 2 or "build" → standard, 3 → lively), and footage-led stories get no background field and drift overlays only. Set story ambient only to change the whole piece (for example "subtle" for a calm brand film); "off" makes settled frames hold still and fails the cinematic motion gate.',
    'A scene may set ambient to override the story: "off" for one deliberately still beat, {"drift": false} when the module\'s own motion should stand alone, or a level.'
  ];
}

function moduleLines(tier, modules = moduleCatalogue()) {
  const lines = [];
  for (const module of modules) {
    const params = module.params.filter((param) => tier !== 'structured' || !param.tuning);
    const flags = [module.family === 'editorial' ? 'editorial panel, keeps captions' : module.hidesCaptions ? 'hides captions' : 'keeps captions'];
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

function phraseLines() {
  const modules = knownModules();
  return PHRASE_MODULE_TABLE.map((row) => {
    const target = phraseRowModule(row, modules);
    if (!target) return null;
    const planned = target !== row.module ? ` (planned module ${row.module}; use ${target})` : '';
    const lanes = row.lanes ? ` [${row.lanes.join(', ')}]` : '';
    return `| ${row.when}${lanes} | ${target}${planned} |`;
  }).filter(Boolean);
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

function section(title, lines) {
  return [`## ${title}`, '', ...lines, ''];
}

/**
 * The storyboard-authoring instructions for one tier.
 * tier: "structured" | "guided" | "bespoke"; lane, format and brand are the
 * fixed inputs (copied into the prompt); words: optional measured narration
 * (NARRATION.json words) for word anchors.
 */
export function planningPrompt({ tier = 'structured', lane, format, brand, words, style, artDirection } = {}) {
  if (!PLANNER_TIERS.includes(tier)) throw new Error(`tier must be one of ${PLANNER_TIERS.join(', ')}`);
  if (lane !== undefined && !STORY_LANES.includes(lane)) throw new Error(`lane must be one of ${STORY_LANES.join(', ')}`);
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
    ...section('Lane rules', laneRules(lane).map((line) => `- ${line}`)),
    ...section('Motion grammar and camera', motionLines({ lane, artDirection }).map((line) => `- ${line}`)),
    ...section(`Tier rules (${tier})`, tierRules(tier).map((line) => `- ${line}`)),
    ...section('Time anchors', anchorLines().map((line) => `- ${line}`)),
    ...section('Safe zone', safeZoneLines(format).map((line) => `- ${line}`)),
    ...section('Captions', captionLines().map((line) => `- ${line}`)),
    ...section('Phrase → module', ['Pick the module from what the line says:', '', '| The script… | Module |', '| --- | --- |', ...phraseLines()]),
    ...section('Modules', moduleLines(tier)),
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
    ...section('Example', ['```json', JSON.stringify(exampleStoryboard(), null, 2), '```'])
  ];
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

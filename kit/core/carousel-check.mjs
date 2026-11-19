// launchclip carousel check, the plan rules (docs/CAROUSELS_RFC.md §6): what
// can be judged from the story alone, before anything is rendered. Pure; the
// pixel and geometry rules (type-size, contrast, safe-zone, cover-thumbnail)
// run on the rendered slides in src/carousel/check.js.
// Each finding: {rule, slide (1-based, null for the whole carousel), level: "fail" | "warn", reason}.

import { CAROUSEL_ARCS, carouselSlides } from "./carousel.mjs";
import { crossesSeam } from "./carousel-continuity.mjs";

// Thresholds are the RFC's proposals (§6, §13): they need a pass against real feeds.
export const COVER_WORDS = Object.freeze([3, 12]);
export const BODY_WORD_BUDGET = 25;
export const COVER_WORD_BUDGET = 12;
export const ALT_MIN_WORDS = 3;

// Which params carry text, by what the text is. shortcut: a fixed key list,
// not each module's param schema; a module whose text sits under another key
// is not counted until the key is added here.
export const HEADLINE_KEYS = Object.freeze(["headline", "title", "quote", "action", "hook", "statement", "text", "word", "stat"]);
export const SUPPORT_KEYS = Object.freeze(["sub", "subtitle", "body", "detail", "description", "caption", "items", "steps", "points", "lines", "rows", "entries", "note", "tagline", "terms"]);
export const META_KEYS = Object.freeze(["kicker", "eyebrow", "label", "badge", "pill", "counter", "prefix", "suffix", "unit", "author", "name", "handle", "cta"]);
// Inside a list entry, the fields that are text.
const ENTRY_TEXT_KEYS = ["label", "text", "title", "detail", "body", "name", "value", "note"];
// Params that restyle a slide (continuity) and scene fields that swap the look.
export const LOOK_KEYS = Object.freeze(["tone", "surface", "theme", "look", "scrim", "backdrop", "tint", "color"]);
const SCENE_LOOK_KEYS = ["style", "look", "brand", "grade"];

const words = (text) => String(text ?? "").split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function strings(value) {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (isObject(value)) return ENTRY_TEXT_KEYS.flatMap((key) => strings(value[key]));
  return [];
}

/** A slide's text from its module params: {headlines: [..], supports: [..], meta: [..], all: "..."}; each entry one block. */
export function slideText(scene) {
  const params = isObject(scene?.params) ? scene.params : {};
  const blocks = (keys) => keys.filter((key) => params[key] !== undefined).map((key) => ({ key, text: strings(params[key]).join(" ") })).filter((block) => block.text.trim());
  const headlines = blocks(HEADLINE_KEYS);
  const supports = blocks(SUPPORT_KEYS);
  const meta = blocks(META_KEYS);
  return { headlines, supports, meta, all: [...headlines, ...supports, ...meta].map((block) => block.text).join(" ") };
}

const NUMBER_WORDS = new Set(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "fifteen", "twenty", "hundred", "thousand", "million", "billion", "half", "double", "triple"]);
// Words that make no promise on their own. shortcut: an English word list; a
// cover in another language passes on any long word until this is per-language.
const VAGUE = new Set(["this", "that", "these", "those", "thing", "things", "stuff", "secret", "secrets", "tips", "tricks", "hacks", "everything", "something", "anything", "nothing", "need", "know", "see", "look", "read", "wait", "really", "very", "just", "about", "what", "when", "where", "which", "while", "with", "your", "you", "will", "would", "should", "could", "have", "here", "there", "they", "them", "their", "from", "into", "every", "more", "most", "best", "better", "great", "amazing", "ultimate", "simple", "easy", "change", "life", "game", "changer", "must", "make", "made", "like", "want", "never", "always", "ever", "only", "today", "people"]);

/** Does a headline name a specific subject or number? */
export function namesSomething(headline) {
  return words(headline).some((raw) => {
    const word = raw.toLowerCase().replace(/[^\p{L}\p{N}%$€£]/gu, "");
    if (/\d/.test(word) || NUMBER_WORDS.has(word)) return true;
    return word.length >= 4 && !VAGUE.has(word);
  });
}

// What counts as a swipe cue on the cover or slide 2: text asking to swipe or
// pointing on, a progress counter ("1", "1/5", "01"), or a carry to the next slide.
const SWIPE_TEXT = /\bswipe\b|\bnext\b|\bkeep going\b|[→›»➜➡]|\d+\s*\/\s*\d+/i;
const COUNTER = /^\s*(?:#|no\.?\s*)?\d{1,2}(?:\s*\/\s*\d{1,2})?\s*$/i;

const CTA_WORDS = Object.freeze({
  save: /\b(save|bookmark|keep this|pin)\b/i,
  comment: /\b(comment|reply|tell (us|me)|drop|type|write)\b/i,
  follow: /\b(follow|subscribe)\b/i,
  visit: /\b(visit|link|bio|go to|check out|read more|learn more|sign up)\b|\w\.\w{2,}\b/i,
  install: /\b(install|download|get the app|app store|play store|try it)\b/i
});

// A number that states a result, not a count of items: 40%, 3x, $2M, 10 times.
const CLAIM = /\d+(?:[.,]\d+)?\s*(?:%|x\b|×|times\b|percent\b)|[$€£]\s?\d/i;

const ALT_FILE = /^[\w .()-]+\.(png|jpe?g|webp|gif|svg|mp4|mov|heic|avif)$/i;
const ALT_PLACEHOLDER = /^(slide|image|img|photo|picture|screenshot|untitled)[\s_-]*\d*$/i;

// The copy rules (filler, hook-length, cut-off, restated-ending, duplicates,
// word-budget, scaffold-leak): thresholds from a production carousel system's
// copy checks. shortcut: English word lists, like VAGUE above.
export const HOOK_WORDS = Object.freeze([4, 14]);
export const HOOK_MIN_WORDS = 3;
export const RESTATED_OVERLAP = 0.85;
export const WORDS_PER_SLIDE = Object.freeze([3, 28]);
export const MIN_DECK_WORDS = 6;

// Stock phrases that say nothing a reader can use.
const FILLER = [
  /\bgame[\s-]?changer\b/i, /\bunlock (?:your|the) (?:full )?potential\b/i, /\belevate your\b/i, /\btransform your (?:journey|life|business|workflow)\b/i,
  /\bstay tuned\b/i, /\bin today'?s (?:fast[\s-]paced|digital|modern) world\b/i, /\btake (?:it|your \w+) to the next level\b/i, /\blook no further\b/i,
  /\bwithout further ado\b/i, /\bsecret sauce\b/i, /\bsupercharge your\b/i, /\brevolutioni[sz]e (?:the way|your)\b/i, /\bthe power of\b/i, /\bdive (?:deep )?into\b/i
];
// Words a finished line does not end on.
const DANGLING = new Set(["a", "an", "the", "and", "or", "but", "nor", "to", "of", "is", "are", "was", "were", "can", "will", "should", "would", "could", "my", "your", "our", "their", "its", "than"]);
const ELLIPSIS = /(?:…|\.\.\.)\s*$/;
const SENTENCE_END = /[.!?…]["'”’)]*\s*$/;
// Planning labels the model wrote around the copy instead of leaving out.
const SCAFFOLD = [/^\s*(?:slide\s*\d+|hook|cta|body|headline|caption|cover|payoff|title|subtitle)\s*[:–—]/im, /\[(?:image|photo|img|visual|graphic|icon|placeholder|b-roll)\b[^\]]*\]/i, /\{\{[^}]*\}\}/, /\b(?:lorem ipsum|TODO|TBD)\b/];
const STOP = new Set([...DANGLING, "this", "that", "for", "with", "in", "on", "at", "by", "from", "it", "you", "we", "i", "be", "do", "not", "no", "so", "as", "if"]);
const norm = (text) => words(text).map((word) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
const contentWords = (text) => norm(text).filter((word) => !STOP.has(word));

/** Is this line cut off? The reason, or null. prose: a sentence (body copy), so one left open counts. */
export function cutOff(text, { prose = false } = {}) {
  const line = String(text ?? "").trim();
  if (!line) return null;
  if (ELLIPSIS.test(line)) return "ends in an ellipsis";
  const last = norm(line).at(-1);
  if (last && DANGLING.has(last) && !/[.!?]["'”’)]*$/.test(line)) return `ends on "${last}"`;
  if (prose && /[.!?]\s/.test(line) && !SENTENCE_END.test(line)) return "stops mid-sentence";
  return null;
}

/** The plan rules on a carousel story. → findings ({rule, slide, level, reason}). */
export function carouselPlanFindings(story) {
  const findings = [];
  const add = (rule, slide, level, reason) => findings.push({ rule, slide, level, reason });
  const slides = carouselSlides(story);
  const carousel = isObject(story?.carousel) ? story.carousel : {};
  const arc = carousel.arc;
  const texts = slides.map(slideText);
  const roleOf = (i) => slides[i]?.slide?.role;

  // cover-promise
  const coverIndex = slides.findIndex((scene) => scene.slide?.role === "cover");
  if (coverIndex === -1) add("cover-promise", null, "fail", "no cover slide (slide.role \"cover\")");
  else {
    const headline = texts[coverIndex].headlines[0]?.text ?? "";
    const count = words(headline).length;
    if (!count) add("cover-promise", coverIndex + 1, "fail", `the cover has no headline (params ${HEADLINE_KEYS.slice(0, 4).join(", ")} …)`);
    else if (count < COVER_WORDS[0] || count > COVER_WORDS[1]) add("cover-promise", coverIndex + 1, "fail", `the cover headline is ${count} word${count === 1 ? "" : "s"}; a promise reads in ${COVER_WORDS[0]} to ${COVER_WORDS[1]}: "${headline}"`);
    else if (!namesSomething(headline)) add("cover-promise", coverIndex + 1, "fail", `the cover headline names no specific subject or number: "${headline}"`);
  }

  // one-idea
  slides.forEach((scene, i) => {
    const text = texts[i];
    if (text.headlines.length > 1) add("one-idea", i + 1, "fail", `${text.headlines.length} headlines (${text.headlines.map((block) => block.key).join(", ")}); one per slide`);
    if (text.supports.length > 1) add("one-idea", i + 1, "fail", `${text.supports.length} supporting blocks (${text.supports.map((block) => block.key).join(", ")}); one per slide`);
    const budget = roleOf(i) === "cover" ? COVER_WORD_BUDGET : BODY_WORD_BUDGET;
    const count = words(text.all).length;
    if (count > budget) add("one-idea", i + 1, "fail", `${count} words; a ${roleOf(i) === "cover" ? "cover" : "slide"} reads in ${budget} or fewer`);
  });

  // continuity: a slide whose look keys differ from what most slides use
  const lookOf = (scene) => JSON.stringify([
    ...LOOK_KEYS.map((key) => scene.params?.[key] ?? null),
    ...SCENE_LOOK_KEYS.map((key) => scene[key] ?? null)
  ]);
  if (slides.length > 2) {
    const looks = slides.map(lookOf);
    const tally = new Map();
    for (const look of looks) tally.set(look, (tally.get(look) ?? 0) + 1);
    const [common] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    looks.forEach((look, i) => {
      if (look === common) return;
      const changed = [...LOOK_KEYS.filter((key) => slides[i].params?.[key] !== undefined).map((key) => `params.${key}`), ...SCENE_LOOK_KEYS.filter((key) => slides[i][key] !== undefined)];
      add("continuity", i + 1, "warn", `this slide switches its look (${changed.join(", ") || "drops the look the other slides set"}) from the rest of the carousel`);
    });
  }

  // swipe-cue
  if (slides.length > 1 && arc !== "single" && arc !== "quote") {
    const cued = [0, 1].some((i) => {
      const scene = slides[i];
      if (!scene) return false;
      if ((scene.carry !== undefined && scene.carry !== false) || crossesSeam(story, i)) return true;
      if (SWIPE_TEXT.test(texts[i].all)) return true;
      return i === 1 && texts[i].meta.some((block) => COUNTER.test(block.text));
    });
    if (!cued) add("swipe-cue", 1, "fail", "neither the cover nor slide 2 carries a cue to swipe: a \"swipe\" or arrow kicker, a counter on slide 2 (\"1/5\"), or a carry into the next slide");
  }

  // payoff
  if (CAROUSEL_ARCS[arc]?.payoff && slides.length > 2) {
    const payoff = slides.findIndex((scene) => scene.slide?.role === "payoff");
    if (payoff === -1) add("payoff", null, "fail", `a ${arc} carousel promises a list, steps or data, so it needs a payoff slide (slide.role "payoff")`);
    else {
      const expected = roleOf(slides.length - 1) === "cta" ? slides.length - 2 : slides.length - 1;
      if (payoff !== expected) add("payoff", payoff + 1, "warn", `the payoff is slide ${payoff + 1}; it saves best as the ${expected === slides.length - 2 ? "second-to-last slide, before the cta" : "last slide"}`);
    }
  }

  // cta-match
  const goal = carousel.goal;
  if (goal && CTA_WORDS[goal]) {
    const cta = slides.findIndex((scene) => scene.slide?.role === "cta");
    if (cta === -1) add("cta-match", null, "warn", `the goal is ${goal} but no slide is the cta (slide.role "cta")`);
    else if (!CTA_WORDS[goal].test(texts[cta].all)) add("cta-match", cta + 1, "fail", `the goal is ${goal} but the cta slide says "${texts[cta].all}"`);
    const caption = carousel.caption?.cta;
    if (typeof caption === "string" && caption.trim() && !CTA_WORDS[goal].test(caption)) add("cta-match", null, "warn", `the goal is ${goal} but the caption's cta says "${caption}"`);
  }

  // alt-text
  slides.forEach((scene, i) => {
    const alt = typeof scene.slide?.alt === "string" ? scene.slide.alt.trim() : "";
    if (!alt) add("alt-text", i + 1, "fail", "no alt text (slide.alt)");
    else if (ALT_FILE.test(alt) || ALT_PLACEHOLDER.test(alt)) add("alt-text", i + 1, "fail", `the alt text "${alt}" is a file name or placeholder; describe what the slide shows`);
    else if (words(alt).length < ALT_MIN_WORDS) add("alt-text", i + 1, "warn", `the alt text "${alt}" is too short to describe the slide`);
  });

  // claims: a result-type number on a slide needs a source, as a video's does
  const sources = Array.isArray(story?.frame?.sources) ? story.frame.sources.filter(isObject) : [];
  slides.forEach((scene, i) => {
    const match = texts[i].all.match(CLAIM);
    if (!match) return;
    const sourced = (typeof scene.params?.source === "string" && scene.params.source.trim()) || sources.some((entry) => entry.scene === scene.id || entry.until === scene.id);
    if (!sourced) add("claims", i + 1, "warn", `"${match[0].trim()}" states a result with no source: add params.source or frame.sources [{text, scene: "${scene.id}"}]`);
  });

  findings.push(...copyFindings(slides, texts, carousel.caption));
  return findings;
}

// The copy rules, on slide text and the caption.
function copyFindings(slides, texts, caption) {
  const findings = [];
  const add = (rule, slide, level, reason) => findings.push({ rule, slide, level, reason });
  const captionParts = isObject(caption) ? ["hook", "body", "cta"].filter((key) => typeof caption[key] === "string" && caption[key].trim()).map((key) => ({ key, text: caption[key] })) : [];
  const headlineOf = (i) => texts[i].headlines[0]?.text ?? "";
  const bodyOf = (i) => texts[i].supports.map((block) => block.text).join(" ");

  // filler
  const filler = (text) => FILLER.map((pattern) => text.match(pattern)?.[0]).find(Boolean);
  texts.forEach((text, i) => { const hit = filler(text.all); if (hit) add("filler", i + 1, "fail", `"${hit}" is a stock phrase; say the specific thing instead`); });
  for (const part of captionParts) { const hit = filler(part.text); if (hit) add("filler", null, "fail", `caption.${part.key} uses the stock phrase "${hit}"; say the specific thing instead`); }

  // hook-length: the caption's first line and the cover headline
  const coverIndex = slides.findIndex((scene) => scene.slide?.role === "cover");
  const hooks = [
    ...(isObject(caption) && typeof caption.hook === "string" ? [{ slide: null, name: "caption.hook", text: caption.hook }] : []),
    ...(coverIndex === -1 ? [] : [{ slide: coverIndex + 1, name: "the cover headline", text: headlineOf(coverIndex) }])
  ].filter((hook) => hook.text.trim());
  for (const hook of hooks) {
    const count = words(hook.text).length;
    if (count < HOOK_MIN_WORDS) add("hook-length", hook.slide, "fail", `${hook.name} is ${count} word${count === 1 ? "" : "s"}; a hook needs ${HOOK_WORDS[0]} to ${HOOK_WORDS[1]}: "${hook.text}"`);
    else if (count < HOOK_WORDS[0] || count > HOOK_WORDS[1]) add("hook-length", hook.slide, "warn", `${hook.name} is ${count} words; a hook reads best in ${HOOK_WORDS[0]} to ${HOOK_WORDS[1]}`);
  }

  // cut-off: a headline left hanging, or body copy stopped mid-sentence
  slides.forEach((scene, i) => {
    const headline = cutOff(headlineOf(i));
    if (headline) add("cut-off", i + 1, "fail", `the headline ${headline}: "${headlineOf(i)}"`);
    for (const block of texts[i].supports) {
      const why = cutOff(block.text, { prose: typeof scene.params?.[block.key] === "string" });
      if (why) add("cut-off", i + 1, "fail", `params.${block.key} ${why}: "${block.text}"`);
    }
  });

  // restated-ending: the last slide says nothing the deck has not. A payoff
  // summary does this on purpose, so a deck ending on its payoff is let be.
  const last = slides.length - 1;
  if (slides.length > 2 && slides[last].slide?.role !== "payoff") {
    const end = [...new Set(contentWords(texts[last].all))];
    const before = new Set(texts.slice(0, last).flatMap((text) => contentWords(text.all)));
    const shared = end.filter((word) => before.has(word)).length;
    if (end.length >= 3 && shared / end.length >= RESTATED_OVERLAP) add("restated-ending", last + 1, "warn", `${Math.round(shared / end.length * 100)}% of the last slide's words are on earlier slides; end on something new: the next step, the takeaway in one line`);
  }

  // duplicates
  const repeated = (pick, name) => {
    const seen = new Map();
    texts.forEach((_, i) => {
      const key = norm(pick(i)).join(" ");
      if (!key) return;
      if (seen.has(key)) add("duplicates", i + 1, "fail", `the same ${name} as slide ${seen.get(key)}: "${pick(i)}"`);
      else seen.set(key, i + 1);
    });
  };
  repeated(headlineOf, "headline");
  repeated(bodyOf, "body text");

  // word-budget: the deck as a whole
  const total = texts.reduce((sum, text) => sum + words(text.all).length, 0);
  const low = Math.max(MIN_DECK_WORDS, WORDS_PER_SLIDE[0] * slides.length), high = WORDS_PER_SLIDE[1] * slides.length;
  if (slides.length && total < low) add("word-budget", null, "warn", `${total} words across ${slides.length} slides; under ${low}, the slides say too little to be worth a swipe`);
  if (total > high) add("word-budget", null, "fail", `${total} words across ${slides.length} slides; over ${high}, it reads as a document, not a carousel`);

  // scaffold-leak
  const leak = (text) => SCAFFOLD.map((pattern) => text.match(pattern)?.[0]).find(Boolean);
  texts.forEach((text, i) => {
    const hit = [...text.headlines, ...text.supports, ...text.meta].map((block) => leak(block.text)).find(Boolean);
    if (hit) add("scaffold-leak", i + 1, "fail", `"${hit.trim()}" is a planning label, not copy; take it out`);
  });
  for (const part of captionParts) { const hit = leak(part.text); if (hit) add("scaffold-leak", null, "fail", `caption.${part.key} carries the planning label "${hit.trim()}"; take it out`); }

  return findings;
}

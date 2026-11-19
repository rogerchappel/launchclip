// Carousel templates: the design layer between a carousel's plan and its
// modules (docs/guide/carousels.md, "Templates"). The planner writes each
// slide's content (a headline, a body line, list items, a figure, a quote, a
// photo); a template turns that content into the module and params that draw
// it, so a carousel looks designed whatever the planner picked.
//
//   CAROUSEL_GRAMMARS    six layouts a slide can take, each with the share of
//                        the slide its text may cover, its smallest type at
//                        1080 wide, its copy caps and the modules that draw it
//   CAROUSEL_TEMPLATES   eight looks: a grammar and a surface per slide role,
//                        copy caps, type, the arcs each suits
//   slideGrammar         the grammar a slide's content asks for
//   pickTemplate         carousel.template, or the brief's best fit with a
//                        seeded pick among the close ones
//   layoutCarousel       template + slide content → scenes (module, params,
//                        plate) and the story fields the template sets
//   templateCopyProblems copy over a template's caps, for the planner's repair
//
// Colours are never fixed here: surfaces name the brand's own roles (its
// ground, a plate lit in its primary, a photo under a reading layer), and a
// light ground is the brand's palette turned over (its pale tone as the
// ground, its darkest colour as the type). Every module used is a catalogue
// module both renderers draw. Import-free, so carousel.mjs can read the ids.

// Smallest type at 1080 wide (scale by width / 1080).
export const MIN_HEADLINE_PX = 52;
export const MIN_BODY_PX = 46;
// The reading layer over a photo under text: how much of the brand's ground covers it.
export const READING_LAYER = 0.6;

export const CAROUSEL_SURFACES = Object.freeze(["light", "dark", "brand", "on-image"]);
export const CAROUSEL_GROUNDS = Object.freeze(["dark", "light"]);
const ROLES = ["cover", "body", "payoff", "cta"];
const ASPECTS = ["4:5", "1:1", "9:16"];

// textShare: the most of the slide its text may cover. caps: what the drawing
// module holds at every aspect (a template's caps sit inside these). draws:
// the module (and the params that shape it) at each aspect.
export const CAROUSEL_GRAMMARS = Object.freeze({
  "full-bleed": { describe: "a photo across the whole slide under a reading layer, the text set over it", textShare: 0.36, needsImage: true, caps: { headline: 44, body: 22 },
    draws: { "4:5": "photo-scene, 1–3 lines over a full or bottom scrim", "1:1": "photo-scene, as 4:5", "9:16": "photo-scene, as 4:5" } },
  "image-panel": { describe: "a photo across the top of the slide, the headline and a line or a short list in a panel under it", textShare: 0.4, needsImage: true, caps: { headline: 48, body: 60 },
    draws: { "4:5": "split-screen top, share 0.47", "1:1": "split-screen top, share 0.45", "9:16": "split-screen top, share 0.45" } },
  "two-region": { describe: "two halves that answer each other: before and after, myth and fact, don't and do", textShare: 0.36, needsImage: false, caps: { headline: 40, body: 40 },
    draws: { "4:5": "compare in free type (halves, versus or verdict), the negative side crossed, the positive ticked", "1:1": "compare, side by side", "9:16": "compare, stacked" } },
  "proof-stat": { describe: "one big figure with what it measures and where it comes from", textShare: 0.6, needsImage: false, caps: { headline: 48, body: 60 },
    draws: { "4:5": "stat-card (with a source), media-stat behind (with a photo), else concept-card free", "1:1": "as 4:5", "9:16": "as 4:5" } },
  steps: { describe: "a checklist or a numbered sequence in free type", textShare: 0.6, needsImage: false, caps: { headline: 48, body: 40, items: 6, item: 32 },
    draws: { "4:5": "item-list, up to 6 items", "1:1": "item-list", "9:16": "item-list" } },
  "text-card": { describe: "type only on the ground: a claim, a quote or the call to action", textShare: 0.68, needsImage: false, caps: { headline: 60, body: 50 },
    draws: { "4:5": "hook-title (headline), motion-title (with a line under it), quote-card, cta", "1:1": "as 4:5", "9:16": "as 4:5" } }
});
export const CAROUSEL_GRAMMAR_IDS = Object.freeze(Object.keys(CAROUSEL_GRAMMARS));

// grammar: per role, the layout the template prefers when the content does not
// ask for another (a pair, a figure, a list) and the slide has what it needs
// (an image for full-bleed and image-panel). surface: per role. plate: the
// ground's backdrop (kit/core/plates.mjs), brandPlate: the brand surface's.
// type: alignment and each module's designed variant.
const T = (entry) => Object.freeze(entry);
export const CAROUSEL_TEMPLATES = Object.freeze({
  "product-proof": T({
    describe: "An app or SaaS ad: the product on screen, the result it gives in one figure, a plain offer.",
    best_for: ["app", "saas", "product", "launch", "feature", "software", "tool", "install", "download", "trial", "pricing", "ad", "dashboard", "customers"],
    avoid_when: ["quote", "myth", "journal", "personal", "motivation"],
    arcs: ["ad", "before-after", "data"], images: "wanted", ground: "dark", plate: { kind: "studio", tint: "neutral" }, brandPlate: { kind: "blooms", tint: "primary" },
    grammar: { cover: "full-bleed", body: "image-panel", payoff: "proof-stat", cta: "text-card" },
    surface: { cover: "on-image", body: "dark", payoff: "brand", cta: "brand" },
    caps: { headline: 40, body: 80 },
    type: { align: "left", hook: "flush", cta: "flush", stat: "giant", list: "stack", compare: "versus", quote: "pull", title: "soft-blur-in" }
  }),
  "study-notes": T({
    describe: "An educational list or how-to: one idea per slide in large free type, a numbered marker pulling to the next, a checklist to save.",
    best_for: ["tips", "habits", "how", "guide", "steps", "learn", "checklist", "mistakes", "ways", "lessons", "rules", "framework", "beginners"],
    avoid_when: ["photo", "quote", "survey", "report"],
    arcs: ["listicle", "how-to"], images: "none", ground: "dark", plate: { kind: "dot-field", tint: "neutral" }, brandPlate: { kind: "prism", tint: "primary" },
    grammar: { cover: "text-card", body: "text-card", payoff: "steps", cta: "text-card" },
    surface: { cover: "brand", body: "dark", payoff: "dark", cta: "brand" },
    caps: { headline: 48, body: 50 },
    type: { align: "left", hook: "flush", cta: "flush", stat: "giant", list: "stack", compare: "halves", quote: "pull", title: "line-by-line-slide" }
  }),
  "field-notes": T({
    describe: "An editorial list, how-to or lesson on a light ground: ink type on the brand's pale tone, quiet and printed.",
    best_for: ["notes", "lessons", "learned", "reading", "writing", "principles", "ideas", "framework", "how", "guide", "habits"],
    avoid_when: ["launch", "ad", "install", "neon", "night"],
    arcs: ["listicle", "how-to", "story", "quote"], images: "optional", ground: "light", plate: null, brandPlate: null,
    grammar: { cover: "text-card", body: "text-card", payoff: "steps", cta: "text-card" },
    surface: { cover: "light", body: "light", payoff: "light", cta: "light" },
    caps: { headline: 48, body: 50 },
    type: { align: "left", hook: "flush", cta: "flush", stat: "giant", list: "stack", compare: "halves", quote: "mark", title: "mask-reveal-up" }
  }),
  "photo-diary": T({
    describe: "A personal-brand photo story: every slide a photo with one line over it, the lesson on the ground, the ask on a photo.",
    best_for: ["story", "journey", "personal", "behind", "day", "year", "founder", "life", "travel", "moment", "lesson", "my"],
    avoid_when: ["data", "statistics", "saas", "pricing", "myth"],
    arcs: ["story", "before-after", "single"], images: "needed", ground: "dark", plate: { kind: "grain", tint: "neutral" }, brandPlate: { kind: "blooms", tint: "primary" },
    grammar: { cover: "full-bleed", body: "full-bleed", payoff: "text-card", cta: "text-card" },
    surface: { cover: "on-image", body: "on-image", payoff: "dark", cta: "on-image" },
    caps: { headline: 44, body: 50 },
    type: { align: "left", hook: "low", cta: "low", stat: "giant", list: "stack", compare: "halves", quote: "pull", title: "soft-blur-in" }
  }),
  "quiet-quote": T({
    describe: "A quote or a motivation series: the words large and alone on a brand-lit ground, the name under them.",
    best_for: ["quote", "motivation", "mindset", "wisdom", "said", "inspire", "reminder", "monday", "affirmation", "words"],
    avoid_when: ["steps", "data", "pricing", "install"],
    arcs: ["quote", "single"], images: "optional", ground: "dark", plate: { kind: "veil", tint: "primary" }, brandPlate: { kind: "light-leak", tint: "accent" },
    grammar: { cover: "text-card", body: "text-card", payoff: "text-card", cta: "text-card" },
    surface: { cover: "brand", body: "dark", payoff: "dark", cta: "brand" },
    caps: { headline: 60, body: 50 },
    type: { align: "center", hook: "centered", cta: "centered", stat: "giant", list: "stack", compare: "halves", quote: "centered", title: "focus-blur-resolve" }
  }),
  "signal-report": T({
    describe: "A data or report carousel: one figure per slide, each with its source, the takeaways as a checklist.",
    best_for: ["data", "report", "survey", "research", "numbers", "statistics", "stats", "percent", "growth", "trends", "benchmark", "study", "state"],
    avoid_when: ["quote", "journal", "motivation"],
    arcs: ["data", "ad"], images: "optional", ground: "dark", plate: { kind: "pinstripe", tint: "neutral" }, brandPlate: { kind: "bands", tint: "primary" },
    grammar: { cover: "text-card", body: "proof-stat", payoff: "steps", cta: "text-card" },
    surface: { cover: "brand", body: "dark", payoff: "dark", cta: "brand" },
    caps: { headline: 48, body: 60 },
    type: { align: "left", hook: "flush", cta: "flush", stat: "giant", list: "stack", compare: "halves", quote: "pull", title: "shared-axis-y" }
  }),
  "myth-split": T({
    describe: "Myth and fact: each slide splits into the belief and the correction, the wrong side crossed, the right side ticked.",
    best_for: ["myth", "myths", "fact", "facts", "misconception", "wrong", "truth", "believe", "actually", "debunk", "lies"],
    avoid_when: ["quote", "photo", "journal"],
    arcs: ["myth-fact"], images: "none", ground: "dark", plate: { kind: "halftone", tint: "primary" }, brandPlate: { kind: "prism", tint: "accent" },
    grammar: { cover: "text-card", body: "two-region", payoff: "text-card", cta: "text-card" },
    surface: { cover: "brand", body: "dark", payoff: "dark", cta: "brand" },
    caps: { headline: 40, body: 40 },
    type: { align: "center", hook: "centered", cta: "centered", stat: "giant", list: "stack", compare: "verdict", quote: "pull", title: "kinetic-center-build" }
  }),
  "then-now": T({
    describe: "A before-and-after: the old way and the new side by side, the change in one figure, photos where there are some.",
    best_for: ["before", "after", "transformation", "redesign", "results", "changed", "makeover", "progress", "switch", "migrated"],
    avoid_when: ["quote", "motivation", "myth"],
    arcs: ["before-after", "story", "ad"], images: "optional", ground: "dark", plate: { kind: "panes", tint: "neutral" }, brandPlate: { kind: "blooms", tint: "accent" },
    grammar: { cover: "full-bleed", body: "two-region", payoff: "proof-stat", cta: "text-card" },
    surface: { cover: "on-image", body: "dark", payoff: "brand", cta: "brand" },
    caps: { headline: 40, body: 40 },
    type: { align: "left", hook: "flush", cta: "flush", stat: "giant", list: "stack", compare: "versus", quote: "pull", title: "short-slide-right" }
  })
});
export const CAROUSEL_TEMPLATE_IDS = Object.freeze(Object.keys(CAROUSEL_TEMPLATES));
const IMAGE_USE = ["none", "optional", "wanted", "needed"];

/** Problems with a template's own fields; [] when it is sound. arcIds: the carousel arcs (carousel.mjs). */
export function templateProblems(id, template = CAROUSEL_TEMPLATES[id], { arcIds = null } = {}) {
  const errors = [];
  const err = (message) => errors.push(`${id}: ${message}`);
  if (!template || typeof template !== "object") return [`${id}: not a template`];
  for (const key of ["describe"]) if (typeof template[key] !== "string" || !template[key]) err(`${key} must be a sentence`);
  for (const key of ["best_for", "avoid_when", "arcs"]) if (!Array.isArray(template[key]) || !template[key].length) err(`${key} must be a non-empty list`);
  if (arcIds) for (const arc of template.arcs ?? []) if (!arcIds.includes(arc)) err(`arcs: ${arc} is not an arc`);
  if (!CAROUSEL_GROUNDS.includes(template.ground)) err(`ground must be ${CAROUSEL_GROUNDS.join(" or ")}`);
  if (!IMAGE_USE.includes(template.images)) err(`images must be one of ${IMAGE_USE.join(", ")}`);
  for (const role of ROLES) {
    if (!CAROUSEL_GRAMMAR_IDS.includes(template.grammar?.[role])) err(`grammar.${role} must be one of ${CAROUSEL_GRAMMAR_IDS.join(", ")}`);
    const surface = template.surface?.[role];
    if (!CAROUSEL_SURFACES.includes(surface)) err(`surface.${role} must be one of ${CAROUSEL_SURFACES.join(", ")}`);
    // One ground per story (the engine renders one palette per story): a role is on that ground, the brand's plate or a photo.
    else if ((surface === "light" || surface === "dark") && surface !== template.ground) err(`surface.${role} is ${surface} on a ${template.ground} ground; use ${template.ground}, brand or on-image`);
    if (surface === "brand" && !template.brandPlate) err(`surface.${role} is brand, so the template needs a brandPlate`);
  }
  if (template.ground === "light" && (template.plate || template.brandPlate)) err("a light ground takes no plate (every plate is drawn for a dark ground)");
  for (const key of ["headline", "body"]) if (!(Number.isInteger(template.caps?.[key]) && template.caps[key] >= 16)) err(`caps.${key} must be a whole number of characters from 16`);
  if (!["left", "center"].includes(template.type?.align)) err("type.align must be left or center");
  return errors;
}

// ---------------------------------------------------------------------------
// Content → grammar

const PAIRS = [["myth", "fact"], ["before", "after"], ["don't", "do"], ["dont", "do"], ["old way", "new way"], ["then", "now"], ["instead of", "try"], ["stop", "start"]];
const FIGURE = /(?:[$€£¥]\s?\d[\d,.]*\s?(?:k|m|bn|b)?\b|\d[\d,.]*\s?(?:%|x\b|×|k\b|m\b|bn\b)|\d[\d,.]*\s?(?:hours?|hrs?|days?|weeks?|minutes?|mins?|users|customers|people|teams|downloads|signups|sales|leads)\b)/i;
const SEQUENCE = /\b(first|second|third|then|next|after that|finally|lastly|step \d+)\b/gi;
const words = (text) => String(text ?? "").trim();

// "Myth: X" → {word: "Myth", rest: "X"} when the text opens on that marker.
function marker(text, word) {
  const match = new RegExp(`^\\s*${word.replace("'", "['’]")}\\b\\s*[:\\-–—]?\\s*(.*)$`, "i").exec(words(text));
  return match ? { word: match[0].slice(0, match[0].length - match[1].length).replace(/[:\-–—\s]+$/, "").trim(), rest: match[1].trim() } : null;
}

/** The pair a slide's headline and body split into: {left, right, negative} or null. left is the side being corrected. */
export function slidePair(slide) {
  for (const [a, b] of PAIRS) {
    for (const [first, second] of [[a, b], [b, a]]) {
      const head = marker(slide?.headline, first);
      const tail = head && marker(slide?.body, second);
      if (head?.rest && tail?.rest) {
        const [left, right] = first === a ? [head, tail] : [tail, head];
        return { left: { title: left.word, text: left.rest }, right: { title: right.word, text: right.rest }, negative: a !== "then" && a !== "instead of" };
      }
    }
  }
  return null;
}

/** The figure a slide states: {value, label, source} or null. */
export function slideFigure(slide) {
  if (slide?.stat && typeof slide.stat === "object" && words(slide.stat.value)) return { value: words(slide.stat.value), label: words(slide.stat.label) || words(slide.headline), source: words(slide.stat.source) || null };
  for (const [text, other] of [[slide?.headline, slide?.body], [slide?.body, slide?.headline]]) {
    const match = FIGURE.exec(words(text));
    if (!match) continue;
    const head = /^[$€£¥]?\s?[\d,.]+\s?(?:%|x|×|k|m|bn|b)?/i.exec(match[0])[0].trim();
    const label = (words(text).replace(match[0], match[0].slice(head.length)).replace(/\s+/g, " ").replace(/^[\s,:;–—-]+|[\s,:;–—-]+$/g, "")) || words(other);
    return { value: head, label, source: words(slide?.source) || null };
  }
  return null;
}

/** A slide's list: its items, or its text split on two or more sequence words; [] for none. */
export function slideItems(slide) {
  if (Array.isArray(slide?.items)) return slide.items.map((item) => words(typeof item === "string" ? item : item?.label)).filter(Boolean);
  const text = words(slide?.body);
  if ((text.match(SEQUENCE) ?? []).length < 2) return [];
  return text.split(SEQUENCE).filter((part, i) => i % 2 === 0).map((part) => part.replace(/^[\s,;:.]+|[\s,;:.]+$/g, "").replace(/^(and|,)\s+/i, "")).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1));
}

/**
 * The grammar a slide's content asks for. The content decides first (a pair,
 * a figure, a list, a quote, the call to action); then the template's choice
 * for the role when the slide has what it needs; then the cover's or a body's
 * plain layout.
 */
export function slideGrammar(slide, template = null) {
  const image = Boolean(words(slide?.photo));
  if (slide?.role === "cta" || slide?.quote) return "text-card";
  if (slidePair(slide)) return "two-region";
  if (slideFigure(slide)) return "proof-stat";
  if (slideItems(slide).length >= 2) return "steps";
  const wanted = template?.grammar?.[slide?.role];
  if (wanted && !["two-region", "proof-stat", "steps"].includes(wanted) && (!CAROUSEL_GRAMMARS[wanted].needsImage || image)) return wanted;
  if (slide?.role === "cover") return image ? "full-bleed" : "text-card";
  return image ? "image-panel" : "text-card";
}

// ---------------------------------------------------------------------------
// Picking a template

const tokens = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
// FNV-1a: the same seed picks the same template in every process.
const hash = (text) => { let h = 0x811c9dc5; for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h; };

/** Each template's score for a brief: +2 per best_for word, −3 per avoid_when word, +4 for the arc, ± for photos. */
export function templateScores({ brief = "", arc = null, images = false } = {}) {
  const seen = new Set(tokens(brief));
  const has = (word) => word.split(" ").every((part) => seen.has(part));
  return CAROUSEL_TEMPLATE_IDS.map((id) => {
    const t = CAROUSEL_TEMPLATES[id];
    let score = 2 * t.best_for.filter(has).length - 3 * t.avoid_when.filter(has).length;
    if (arc && t.arcs.includes(arc)) score += 4;
    if (t.images === "needed") score += images ? 2 : -6;
    if (t.images === "wanted") score += images ? 1 : -2;
    if (t.images === "none" && images) score -= 1;
    return { id, score };
  });
}

/**
 * The template for a carousel: `template` when it names one; else the best
 * scores, and among those within `spread` of the top a pick by the seed (the
 * style's seed or name), so two carousels on one brief rarely look the same.
 */
export function pickTemplate({ template = null, brief = "", arc = null, images = false, seed = "", spread = 2 } = {}) {
  if (template != null) {
    if (!CAROUSEL_TEMPLATES[template]) throw new Error(`carousel.template must be one of ${CAROUSEL_TEMPLATE_IDS.join(", ")}`);
    return template;
  }
  const scores = templateScores({ brief, arc, images });
  const top = Math.max(...scores.map((entry) => entry.score));
  const close = scores.filter((entry) => entry.score >= top - spread).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return close[hash(`${seed}|${arc ?? ""}`) % close.length].id;
}

// ---------------------------------------------------------------------------
// Template + content → scenes

/** A grammar's caps inside a template's: {headline, body}. */
export function slideCaps(template, grammar) {
  const g = CAROUSEL_GRAMMARS[grammar].caps;
  return { headline: Math.min(template.caps.headline, g.headline), body: Math.min(template.caps.body, g.body) };
}

/** Copy over its caps, slide by slide, said for the planner's repair. [] when every slide fits. */
export function templateCopyProblems(templateId, slides) {
  const template = CAROUSEL_TEMPLATES[templateId];
  if (!template) return [`carousel.template ${templateId} is not a template; use one of ${CAROUSEL_TEMPLATE_IDS.join(", ")}`];
  const errors = [];
  (Array.isArray(slides) ? slides : []).forEach((slide, i) => {
    const name = `slides[${i}] (${slide?.id ?? i + 1})`;
    const grammar = slideGrammar(slide, template);
    const caps = slideCaps(template, grammar);
    const pair = grammar === "two-region" ? slidePair(slide) : null;
    if (!words(slide?.headline) && !slide?.quote) errors.push(`${name} needs a headline`);
    if (!pair) {
      if (words(slide?.headline).length > caps.headline) errors.push(`${name} headline is ${words(slide.headline).length} characters; the ${templateId} template's ${grammar} slide holds ${caps.headline}`);
      if (grammar !== "steps" && words(slide?.body).length > caps.body) errors.push(`${name} body is ${words(slide.body).length} characters; the ${templateId} template's ${grammar} slide holds ${caps.body}`);
    } else for (const side of [pair.left, pair.right]) if (side.text.length > CAROUSEL_GRAMMARS["two-region"].caps.body) errors.push(`${name} "${side.title}" side is ${side.text.length} characters; a two-region side holds ${CAROUSEL_GRAMMARS["two-region"].caps.body}`);
    if (grammar === "steps") {
      const items = slideItems(slide);
      const { items: most, item } = CAROUSEL_GRAMMARS.steps.caps;
      if (items.length > most) errors.push(`${name} has ${items.length} items; a list holds ${most}`);
      items.forEach((text, k) => { if (text.length > item) errors.push(`${name} item ${k + 1} is ${text.length} characters; a list item holds ${item}`); });
    }
    if (grammar === "proof-stat" && slideFigure(slide).value.length > 12) errors.push(`${name} figure ${slideFigure(slide).value} is longer than 12 characters`);
    if (slide?.quote && !(words(slide.quote.text) && words(slide.quote.author))) errors.push(`${name} quote needs its exact words and the person who said them`);
  });
  return errors;
}

// Words into lines of at most `width` characters, at most `most` lines (the rest joins the last).
function lines(text, width, most) {
  const out = [];
  for (const word of words(text).split(/\s+/).filter(Boolean)) {
    if (out.length && (out.at(-1) + " " + word).length <= width) out[out.length - 1] += ` ${word}`;
    else out.push(word);
  }
  if (out.length > most) out.splice(most - 1, out.length, out.slice(most - 1).join(" "));
  return out;
}
const cut = (text, most) => { const t = words(text); return t.length <= most ? t : `${t.slice(0, most - 1).replace(/\s+\S*$/, "")}…`; };
const emphasisOf = (slide, headline) => { const e = words(slide?.emphasis); return e && headline.toLowerCase().includes(e.toLowerCase()) ? e : undefined; };
const drop = (params) => Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""));

/** The module and params that draw one slide in a grammar → {module, params}. */
// cue: the cover of a carousel with more slides asks for the swipe (an arrow on its small label, or a last line on a photo).
export function drawSlide(slide, grammar, template, { aspect = "4:5", cue = false } = {}) {
  const type = template.type;
  const headline = words(slide.headline);
  const body = words(slide.body);
  const image = words(slide.photo) || null;
  const asks = cue && !/\bswipe\b|→/i.test(`${headline} ${body} ${words(slide.eyebrow)}`);
  const eyebrow = asks ? (words(slide.eyebrow) ? `${cut(slide.eyebrow, 28)} →` : "Swipe →") : words(slide.eyebrow) || undefined;
  if (grammar === "full-bleed") {
    const width = aspect === "1:1" ? 24 : 22;
    const head = lines(headline, width, body ? 2 : 3).map((text, i, all) => ({ text, ...(i === all.length - 1 ? { emphasis: true } : {}) }));
    const rest = body ? lines(body, width, 3 - head.length).map((text) => ({ text })) : [];
    const all = [...head, ...rest].slice(0, 3);
    if (asks) { const last = all.at(-1); if (last.text.length + 2 <= width) last.text += " →"; else if (all.length < 3) all.push({ text: "Swipe →" }); }
    return { module: "photo-scene", params: { media: image, lines: all, align: type.align, scrim: type.align === "center" ? "full" : "bottom", move: "push-in", zoom: 0.04, title: cut(headline, 60) } };
  }
  if (grammar === "image-panel") {
    const items = slideItems(slide);
    const figure = slideFigure(slide);
    const extra = items.length >= 2 ? { items: items.slice(0, 4) } : figure && !body ? { stat: drop({ value: figure.value, label: cut(figure.label, 40) }) } : { body: body || undefined };
    return { module: "split-screen", params: drop({ media: image, variant: "top", share: aspect === "4:5" ? 0.47 : 0.45, kicker: eyebrow, title: headline, align: type.align, ...extra }) };
  }
  if (grammar === "two-region") {
    const pair = slidePair(slide);
    return { module: "compare", params: { mode: pair.negative ? "before-after" : "columns", variant: type.compare, left: { title: pair.left.title, items: [pair.left.text] }, right: { title: pair.right.title, items: [pair.right.text] } } };
  }
  if (grammar === "proof-stat") {
    const figure = slideFigure(slide);
    const label = cut(figure.label, 48);
    if (image) return { module: "media-stat", params: drop({ media: image, variant: "behind", value: figure.value, label: cut(label, 40), source: figure.source, kicker: eyebrow }) };
    if (figure.source) return { module: "stat-card", params: { value: figure.value, label, source: figure.source, variant: type.stat } };
    return { module: "concept-card", params: drop({ text: figure.value, sub: cut(label, 64), variant: "free" }) };
  }
  if (grammar === "steps") {
    const items = slideItems(slide).slice(0, 6);
    return { module: "item-list", params: drop({ title: headline || undefined, items, variant: type.list, ...(slide.role === "payoff" ? { ticks: true } : {}) }) };
  }
  // text-card
  if (slide.role === "cta") return { module: "cta", params: drop({ action: cut(headline, 40), emphasis: emphasisOf(slide, headline), detail: body || undefined, handle: words(slide.handle) || undefined, variant: type.cta }) };
  if (slide.quote) return { module: "quote-card", params: drop({ quote: words(slide.quote.text), author: words(slide.quote.author), role: words(slide.quote.role) || undefined, highlight: emphasisOf(slide, words(slide.quote.text)), variant: type.quote }) };
  // motion-title lights whole words (1–3), so a phrase goes in word by word.
  const highlight = emphasisOf(slide, headline)?.split(/\s+/).slice(0, 3);
  if (body) return { module: "motion-title", params: drop({ text: headline, kicker: eyebrow, sub: body, highlight: highlight?.length === 1 ? highlight[0] : highlight, align: type.align, variant: type.title }) };
  return { module: "hook-title", params: drop({ headline, emphasis: emphasisOf(slide, headline), eyebrow, variant: type.hook }) };
}

/** The scene's own backdrop for a role's surface: a brand-lit plate, a photo under the reading layer, or none (the ground). */
export function surfacePlate(template, surface, slide, grammar) {
  if (surface === "brand") return { kind: template.brandPlate.kind, params: { tint: template.brandPlate.tint } };
  // A photo grammar draws its own photo; a type-only slide with a photo sets it behind the reading layer.
  if (surface === "on-image" && words(slide?.photo) && !CAROUSEL_GRAMMARS[grammar].needsImage && grammar !== "proof-stat") return { kind: "image", params: { src: words(slide.photo), dim: READING_LAYER, blur: 6 } };
  return null;
}

// --- a light ground: the brand turned over ---------------------------------
const HEX = /^#[0-9a-f]{6}$/i;
const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255); };
export const contrastRatio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mixHex = (a, b, t) => `#${[16, 8, 0].map((s) => Math.round(((parseInt(a.slice(1), 16) >> s) & 255) * (1 - t) + ((parseInt(b.slice(1), 16) >> s) & 255) * t).toString(16).padStart(2, "0")).join("")}`;
// The colour darkened toward `ink` until it keeps 4.5:1 on `ground`.
const onGround = (hex, ground, ink) => { let out = hex; for (let t = 0.1; contrastRatio(out, ground) < 4.5 && t <= 1.0001; t += 0.1) out = mixHex(hex, ink, Math.min(1, t)); return out; };

/**
 * The brand on a light ground: its palest colour (else a near-white tinted by
 * its primary) as bg, its darkest as type (paper and ink), primary and accent
 * darkened until they read on it. palette "as-given", so nothing moves it back.
 */
export function lightBrand(brand) {
  const colors = { ...(brand?.colors ?? {}) };
  const given = Object.values(colors).filter((hex) => HEX.test(String(hex)));
  if (!given.length) return brand;
  const sorted = [...given].sort((a, b) => luminance(b) - luminance(a));
  const pale = luminance(sorted[0]) >= 0.75 ? sorted[0] : mixHex(HEX.test(colors.primary ?? "") ? colors.primary : sorted[0], "#ffffff", 0.92);
  const dark = luminance(sorted.at(-1)) <= 0.05 ? sorted.at(-1) : mixHex(sorted.at(-1), "#000000", 0.75);
  const primary = onGround(HEX.test(colors.primary ?? "") ? colors.primary : dark, pale, dark);
  const accent = onGround(HEX.test(colors.accent ?? "") ? colors.accent : primary, pale, dark);
  return { ...brand, palette: "as-given", colors: { ...colors, bg: pale, paper: dark, ink: dark, primary, accent } };
}

/**
 * A template and the slides' content → the carousel's scenes and the story
 * fields the template sets. slides: [{id, role, headline, body?, items?,
 * stat?: {value, label?, source?}, quote?: {text, author, role?}, photo? (assets/…),
 * eyebrow?, emphasis?, handle?, alt}]. → {template, story: {plate?,
 * background?, brand?}, scenes: [{id, grammar, surface, module, params, plate?}]}
 */
export function layoutCarousel(templateId, slides, { aspect = "4:5", brand = null } = {}) {
  const template = CAROUSEL_TEMPLATES[templateId];
  if (!template) throw new Error(`carousel.template must be one of ${CAROUSEL_TEMPLATE_IDS.join(", ")}`);
  if (!ASPECTS.includes(aspect)) throw new Error(`a carousel template lays out at ${ASPECTS.join(", ")}; got ${aspect}`);
  const scenes = (Array.isArray(slides) ? slides : []).map((slide, i) => {
    const grammar = slideGrammar(slide, template);
    const surface = template.surface[slide.role] ?? template.ground;
    const { module, params } = drawSlide(slide, grammar, template, { aspect, cue: i === 0 && slides.length > 1 });
    const plate = surfacePlate(template, surface, slide, grammar);
    return { id: words(slide.id) || `slide-${i + 1}`, grammar, surface, module, params, ...(plate ? { plate } : {}) };
  });
  const story = template.ground === "light"
    ? { background: { kind: "paper" }, ...(brand ? { brand: lightBrand(brand) } : {}) }
    : { plate: { kind: template.plate.kind, params: { tint: template.plate.tint } } };
  return { template: templateId, story, scenes };
}

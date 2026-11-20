// Carousel templates: the design layer between a carousel's plan and its
// modules (docs/guide/carousels.md, "Templates"). The planner writes each
// slide's content (a headline, a body line, list items, a figure, a quote, a
// photo); a template turns that content into the module and params that draw
// it, so a carousel looks designed whatever the planner picked.
//
//   CAROUSEL_GRAMMARS    the layouts a slide can take, each with the share of
//                        the slide its text may cover, its smallest type at
//                        1080 wide, its copy caps and the modules that draw it
//   CAROUSEL_TEMPLATES   the looks: a ground, a grammar and a surface per slide
//                        role, copy caps, type, the arcs each suits. Most follow
//                        feed styles proven in production; a few are LaunchClip's own
//   slideGrammar         the grammar a slide's content asks for
//   pickTemplate         carousel.template, or the brief's best fit with a
//                        seeded pick among the close ones
//   layoutCarousel       template + slide content → scenes (module, params,
//                        plate) and the story fields the template sets
//   templateCopyProblems copy over a template's caps, for the planner's repair
//
// Colours are never fixed here. A template names a ground: the brand's own
// dark ground, its palette turned over onto its pale tone (light), or its
// primary as the page (brand); `pure` takes the ground to a near-white or
// near-black page in the brand's hue. Surfaces are that ground, a plate lit in
// the brand colour, or the slide's photo under a reading layer. Every module
// used is a catalogue module both renderers draw. Import-free, so carousel.mjs
// can read the ids.

// Smallest type at 1080 wide (scale by width / 1080).
export const MIN_HEADLINE_PX = 52;
export const MIN_BODY_PX = 46;
// The default reading layer over a photo under text: how much of the ground covers it.
export const READING_LAYER = 0.6;

export const CAROUSEL_SURFACES = Object.freeze(["light", "dark", "brand", "on-image"]);
export const CAROUSEL_GROUNDS = Object.freeze(["dark", "light", "brand"]);
const ROLES = ["cover", "body", "payoff", "cta"];
const ASPECTS = ["4:5", "1:1", "9:16"];
const BACKGROUNDS = ["flat", "paper"];

// textShare: the most of the slide its text may cover. caps: what the drawing
// module holds at every aspect (a template's caps sit inside these). draws:
// the module (and the params that shape it) at each aspect.
export const CAROUSEL_GRAMMARS = Object.freeze({
  "full-bleed": { describe: "a photo across the whole slide under a reading layer, the text set over it", textShare: 0.36, needsImage: true, caps: { headline: 44, body: 22 },
    draws: { "4:5": "photo-scene, 1–3 lines over a full or bottom scrim", "1:1": "photo-scene, as 4:5", "9:16": "photo-scene, as 4:5" } },
  "image-panel": { describe: "a photo across the top of the slide, the headline and a line or a short list in a solid panel under it", textShare: 0.4, needsImage: true, caps: { headline: 48, body: 60 },
    draws: { "4:5": "split-screen top, the template's share per role (0.3–0.6)", "1:1": "split-screen top, share at most 0.5", "9:16": "split-screen top" } },
  "framed-image": { describe: "an editorial page: the headline above a framed photo, a caption under it", textShare: 0.36, needsImage: true, caps: { headline: 60, body: 60 },
    draws: { "4:5": "landscape-card, a rounded window mid-page", "1:1": "landscape-card", "9:16": "landscape-card" } },
  "two-region": { describe: "two halves that answer each other: before and after, myth and fact, don't and do", textShare: 0.36, needsImage: false, caps: { headline: 40, body: 40 },
    draws: { "4:5": "compare in free type (halves, versus or verdict), the negative side crossed, the positive ticked", "1:1": "compare, side by side", "9:16": "compare, stacked" } },
  "proof-stat": { describe: "one big figure with what it measures and where it comes from", textShare: 0.6, needsImage: false, caps: { headline: 48, body: 60 },
    draws: { "4:5": "stat-card (with a source), media-stat behind (with a photo), else concept-card free", "1:1": "as 4:5", "9:16": "as 4:5" } },
  steps: { describe: "a checklist or short numbered lines in free type", textShare: 0.6, needsImage: false, caps: { headline: 48, body: 40, items: 6, item: 32 },
    draws: { "4:5": "item-list, up to 6 items", "1:1": "item-list", "9:16": "item-list" } },
  step: { describe: "one step per slide: a big step number in the accent, a small label and the step as the headline", textShare: 0.5, needsImage: false, caps: { headline: 48, body: 0 },
    draws: { "4:5": "section-card centered, numbered in slide order", "1:1": "section-card", "9:16": "section-card" } },
  "text-card": { describe: "type only on the ground: a claim, an observation, a quote or the call to action", textShare: 0.68, needsImage: false, caps: { headline: 90, body: 80 },
    draws: { "4:5": "hook-title (capitals), motion-title (sentence case or with a line under it), quote-card, cta", "1:1": "as 4:5", "9:16": "as 4:5" } }
});
export const CAROUSEL_GRAMMAR_IDS = Object.freeze(Object.keys(CAROUSEL_GRAMMARS));
// Grammars only content can ask for (a pair, a figure, a list): a template's role preference never forces one.
const CONTENT_GRAMMARS = ["two-region", "proof-stat", "steps"];

// ground / pure / background: the page (see the header). plate: a backdrop
// plate under the whole carousel instead of a plain ground. grammar: per role,
// the layout the template prefers when the content does not ask for another
// and the slide has what it needs. surface: per role. reading: the layer over a
// photo under type (dim: how much ground covers it, blur in px). brandPlate:
// the plate a "brand" surface lights. type: alignment, case (caps: display
// capitals; sentence: as written), the photo's share of an image-panel slide
// per role, ticks (a payoff checklist ticks rather than numbers), byline (the
// carousel's handle as a small label on every slide), note (a type slide is the
// account's own observation, set as a pull quote signed by that handle;
// poster: a type slide is a feed poster (heavy capitals in the lower middle,
// a line under them, the brand name and page number along the foot); swipe:
// the cover's swipe line under its headline), mark (how the emphasis is drawn) and each
// module's designed variant.
const T = (entry) => Object.freeze(entry);
const type = (fields) => ({ align: "left", case: "caps", ticks: true, hook: "flush", cta: "flush", stat: "giant", list: "stack", compare: "halves", quote: "mark", title: "soft-blur-in", step: "centered", ...fields });
export const CAROUSEL_TEMPLATES = Object.freeze({
  // --- Proven feed styles, rebuilt on LaunchClip modules -------------------
  "caption-block": T({
    describe: "Photo-led education: the photo on top, a solid ground panel under it with condensed capitals; a short checklist under a slimmer photo.",
    best_for: ["education", "checklist", "checklists", "tips", "guide", "explain", "learn", "how", "busy"],
    avoid_when: ["cinematic", "minimal", "quote", "motivation"],
    arcs: ["listicle", "how-to", "ad", "data", "before-after"], images: "wanted", ground: "dark", background: "flat",
    grammar: { cover: "image-panel", body: "image-panel", payoff: "image-panel", cta: "text-card" },
    surface: { cover: "dark", body: "dark", payoff: "dark", cta: "dark" },
    caps: { headline: 48, body: 60 },
    type: type({ share: { cover: 0.5, body: 0.45, payoff: 0.32 } })
  }),
  "cinematic-dark": T({
    describe: "Documentary photos edge to edge under a dark reading layer, direct coaching copy in heavy centred capitals.",
    best_for: ["advice", "practical", "motivation", "coach", "coaching", "creator", "habit", "habits", "mindset", "lesson", "lessons", "discipline"],
    avoid_when: ["statistics", "data", "report", "survey", "numbers"],
    arcs: ["listicle", "how-to", "story", "quote", "single"], images: "needed", ground: "dark", pure: true, background: "flat", reading: { dim: 0.6, blur: 0 },
    grammar: { cover: "text-card", body: "text-card", payoff: "text-card", cta: "text-card" },
    surface: { cover: "on-image", body: "on-image", payoff: "on-image", cta: "on-image" },
    caps: { headline: 48, body: 80 },
    type: type({ align: "center", poster: true, hook: "centered", cta: "centered", title: "focus-blur-resolve" })
  }),
  "cinematic-light": T({
    describe: "Documentary photos edge to edge under a soft light wash, direct coaching copy in heavy centred capitals.",
    best_for: ["advice", "practical", "motivation", "coach", "coaching", "creator", "habit", "habits", "wellness", "morning", "calm"],
    avoid_when: ["statistics", "data", "report", "survey", "night"],
    arcs: ["listicle", "how-to", "story", "quote", "single"], images: "needed", ground: "light", pure: true, background: "flat", reading: { dim: 0.6, blur: 0 },
    grammar: { cover: "text-card", body: "text-card", payoff: "text-card", cta: "text-card" },
    surface: { cover: "on-image", body: "on-image", payoff: "on-image", cta: "on-image" },
    caps: { headline: 48, body: 80 },
    type: type({ align: "center", poster: true, hook: "centered", cta: "centered", title: "focus-blur-resolve" })
  }),
  "plain-note": T({
    describe: "A white page: the brand's name and handle, then one short observation in plain sentence-case type, like a text post.",
    best_for: ["observation", "observations", "founder", "notes", "thought", "leadership", "opinion", "lessons", "learned", "thread"],
    avoid_when: ["statistics", "data", "columns", "checklist", "photo"],
    arcs: ["quote", "single", "story", "listicle"], images: "optional", ground: "light", pure: true, background: "flat",
    grammar: { cover: "text-card", body: "text-card", payoff: "text-card", cta: "text-card" },
    surface: { cover: "light", body: "light", payoff: "light", cta: "light" },
    caps: { headline: 90, body: 48 },
    type: type({ case: "sentence", byline: true, note: true, title: "fade-through", quote: "post" })
  }),
  "plain-note-dark": T({
    describe: "A near-black page with an identity line and one observation in plain sentence-case type.",
    best_for: ["observation", "observations", "founder", "reminder", "reminders", "contrast", "opinion", "hot", "take", "thread"],
    avoid_when: ["statistics", "data", "columns", "checklist", "photo"],
    arcs: ["quote", "single", "story", "listicle"], images: "optional", ground: "dark", pure: true, background: "flat",
    grammar: { cover: "text-card", body: "text-card", payoff: "text-card", cta: "text-card" },
    surface: { cover: "dark", body: "dark", payoff: "dark", cta: "dark" },
    caps: { headline: 90, body: 48 },
    type: type({ case: "sentence", byline: true, note: true, title: "fade-through", quote: "post" })
  }),
  "numbered-steps": T({
    describe: "A photo-led cover with the promise on black, then one big numbered step per slide, the checklist as short numbered lines.",
    best_for: ["steps", "step", "how", "guide", "numbered", "routine", "routines", "habits", "process", "framework", "checklist"],
    avoid_when: ["single", "photo", "story", "quote"],
    arcs: ["how-to", "listicle"], images: "optional", ground: "dark", pure: true, background: "flat", reading: { dim: 0.74, blur: 0 },
    grammar: { cover: "image-panel", body: "step", payoff: "steps", cta: "text-card" },
    surface: { cover: "dark", body: "dark", payoff: "dark", cta: "dark" },
    caps: { headline: 48, body: 60 },
    type: type({ align: "center", hook: "centered", cta: "centered", ticks: false, swipe: "Swipe for the steps", share: { cover: 0.5 } })
  }),
  "paper-story": T({
    describe: "Warm paper pages: a serif headline above a framed photo, a caption under it; a considered product or founder story.",
    best_for: ["product", "story", "founder", "thought", "leadership", "education", "craft", "behind", "making", "brand"],
    avoid_when: ["urgent", "alert", "neon", "sale", "countdown"],
    arcs: ["story", "how-to", "ad", "listicle"], images: "wanted", ground: "light", background: "paper",
    grammar: { cover: "framed-image", body: "framed-image", payoff: "text-card", cta: "text-card" },
    surface: { cover: "light", body: "light", payoff: "light", cta: "light" },
    caps: { headline: 60, body: 60 },
    type: type({ case: "sentence", title: "mask-reveal-up" })
  }),
  "bold-statement": T({
    describe: "The brand colour as the page and oversized display capitals, one phrase lit in the accent.",
    best_for: ["statement", "statements", "manifesto", "values", "reminder", "reminders", "announcement", "bold", "belief"],
    avoid_when: ["explanation", "detailed", "schedule", "event", "data"],
    arcs: ["quote", "single", "myth-fact", "listicle", "ad"], images: "none", ground: "brand", background: "flat",
    grammar: { cover: "text-card", body: "text-card", payoff: "text-card", cta: "text-card" },
    surface: { cover: "brand", body: "brand", payoff: "brand", cta: "brand" },
    caps: { headline: 48, body: 60 },
    type: type({ hook: "flush", cta: "flush", title: "kinetic-center-build", compare: "verdict" })
  }),
  "pull-quote": T({
    describe: "Expressive serif statements and pull quotes on a paper page, a large quotation mark in the accent.",
    best_for: ["quote", "quotes", "testimonial", "testimonials", "values", "said", "words", "wisdom"],
    avoid_when: ["checklist", "schedule", "event", "data", "steps"],
    arcs: ["quote", "single", "story"], images: "optional", ground: "light", background: "paper",
    grammar: { cover: "text-card", body: "text-card", payoff: "text-card", cta: "text-card" },
    surface: { cover: "light", body: "light", payoff: "light", cta: "light" },
    caps: { headline: 90, body: 60 },
    type: type({ case: "sentence", quote: "mark", title: "soft-blur-in" })
  }),
  "photo-essay": T({
    describe: "Large documentary photos edge to edge across the top of a light page, restrained captions under them.",
    best_for: ["photography", "photo", "photos", "community", "documentary", "recap", "trip", "travel", "event", "behind"],
    avoid_when: ["dense", "statistics", "checklist", "unrelated"],
    arcs: ["story", "before-after", "listicle"], images: "needed", ground: "light", background: "flat",
    grammar: { cover: "image-panel", body: "image-panel", payoff: "text-card", cta: "text-card" },
    surface: { cover: "light", body: "light", payoff: "light", cta: "light" },
    caps: { headline: 48, body: 60 },
    type: type({ case: "sentence", share: { cover: 0.52, body: 0.45 }, title: "soft-blur-in" })
  }),
  // --- LaunchClip's own --------------------------------------------------
  "lit-window": T({
    describe: "LaunchClip's own: each photo in a rounded window floating in a soft pool of brand-coloured light, the type set free around it.",
    best_for: ["product", "app", "launch", "feature", "showcase", "screenshot", "portfolio", "work", "case", "study"],
    avoid_when: ["quote", "plain", "minimal", "documentary"],
    arcs: ["ad", "story", "data", "listicle", "before-after"], images: "wanted", ground: "dark", plate: { kind: "spotlight", tint: "primary" },
    grammar: { cover: "framed-image", body: "framed-image", payoff: "proof-stat", cta: "text-card" },
    surface: { cover: "dark", body: "dark", payoff: "dark", cta: "dark" },
    caps: { headline: 48, body: 60 },
    type: type({ case: "sentence", title: "soft-blur-in" })
  })
});
export const CAROUSEL_TEMPLATE_IDS = Object.freeze(Object.keys(CAROUSEL_TEMPLATES));
const IMAGE_USE = ["none", "optional", "wanted", "needed"];

/** Problems with a template's own fields; [] when it is sound. arcIds: the carousel arcs (carousel.mjs). */
export function templateProblems(id, template = CAROUSEL_TEMPLATES[id], { arcIds = null } = {}) {
  const errors = [];
  const err = (message) => errors.push(`${id}: ${message}`);
  if (!template || typeof template !== "object") return [`${id}: not a template`];
  if (typeof template.describe !== "string" || !template.describe) err("describe must be a sentence");
  for (const key of ["best_for", "avoid_when", "arcs"]) if (!Array.isArray(template[key]) || !template[key].length) err(`${key} must be a non-empty list`);
  if (arcIds) for (const arc of template.arcs ?? []) if (!arcIds.includes(arc)) err(`arcs: ${arc} is not an arc`);
  if (!CAROUSEL_GROUNDS.includes(template.ground)) err(`ground must be ${CAROUSEL_GROUNDS.join(", ")}`);
  if (!IMAGE_USE.includes(template.images)) err(`images must be one of ${IMAGE_USE.join(", ")}`);
  if (!template.plate === !template.background || (template.background && !BACKGROUNDS.includes(template.background))) err(`set one of background (${BACKGROUNDS.join(", ")}) or plate`);
  if (template.plate && template.ground !== "dark") err("a plate is drawn for a dark ground; a light or brand ground takes a background");
  if (template.reading && !(template.reading.dim >= 0.4 && template.reading.dim <= 0.9 && template.reading.blur >= 0 && template.reading.blur <= 40)) err("reading must be {dim 0.4–0.9, blur 0–40}");
  for (const role of ROLES) {
    if (!CAROUSEL_GRAMMAR_IDS.includes(template.grammar?.[role])) err(`grammar.${role} must be one of ${CAROUSEL_GRAMMAR_IDS.join(", ")}`);
    else if (CONTENT_GRAMMARS.includes(template.grammar[role]) && role !== "payoff") err(`grammar.${role} is ${template.grammar[role]}, which only content asks for; a template may prefer it for the payoff only`);
    const surface = template.surface?.[role];
    if (!CAROUSEL_SURFACES.includes(surface)) err(`surface.${role} must be one of ${CAROUSEL_SURFACES.join(", ")}`);
    // One ground per story (the engine renders one palette per story): a role is on that ground, the brand's plate or a photo.
    else if ((surface === "light" || surface === "dark") && surface !== template.ground) err(`surface.${role} is ${surface} on a ${template.ground} ground; use ${template.ground}, brand or on-image`);
    if (surface === "brand" && template.ground !== "brand" && !template.brandPlate) err(`surface.${role} is brand, so the template needs a brandPlate`);
    if (surface === "on-image" && !template.reading) err(`surface.${role} is on-image, so the template needs a reading layer`);
  }
  for (const key of ["headline", "body"]) if (!(Number.isInteger(template.caps?.[key]) && template.caps[key] >= 16)) err(`caps.${key} must be a whole number of characters from 16`);
  if (!["left", "center"].includes(template.type?.align)) err("type.align must be left or center");
  if (!["caps", "sentence"].includes(template.type?.case)) err("type.case must be caps or sentence");
  for (const [role, share] of Object.entries(template.type?.share ?? {})) if (!ROLES.includes(role) || !(share >= 0.3 && share <= 0.62)) err(`type.share.${role} must be 0.3–0.62 for a role`);
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
    // A word unit stays whole ("52 minutes"); a short one only as a whole word ("3x", "$2m"), not the "m" of "minutes".
    const head = /[a-z]{3,}$/i.test(match[0]) && match[0].length <= 12 ? match[0] : /^[$€£¥]?\s?[\d,.]+(?:\s?(?:%|×|(?:x|k|m|bn|b)\b))?/i.exec(match[0])[0].trim();
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
  // A cover is the promise in words: a number in it ("in 20 minutes") does not make it a stat card.
  if (slide?.role !== "cover" && slideFigure(slide)) return "proof-stat";
  const wanted = template?.grammar?.[slide?.role];
  // A short list with a photo stays in the template's photo panel (split-screen holds 2–4 short items).
  const items = slideItems(slide);
  if (items.length >= 2) return wanted === "image-panel" && image && items.length <= 4 && items.every((item) => item.length <= 32) ? "image-panel" : "steps";
  if (wanted && !CONTENT_GRAMMARS.includes(wanted) && (!CAROUSEL_GRAMMARS[wanted].needsImage || image)) return wanted;
  if (template) return "text-card";
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
  return CAROUSEL_TEMPLATE_IDS.map((id) => {
    const t = CAROUSEL_TEMPLATES[id];
    let score = 2 * t.best_for.filter((word) => seen.has(word)).length - 3 * t.avoid_when.filter((word) => seen.has(word)).length;
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
      if (grammar !== "steps" && words(slide?.body).length > caps.body) errors.push(caps.body ? `${name} body is ${words(slide.body).length} characters; the ${templateId} template's ${grammar} slide holds ${caps.body}` : `${name} has a body; the ${templateId} template's ${grammar} slide is the headline alone, so fold the line into it or drop it`);
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

/**
 * The module and params that draw one slide in a grammar → {module, params}.
 * cue: the cover of a carousel with more slides asks for the swipe (an arrow on
 * its small label, or a last line on a photo). number: the slide's step number.
 * byline: the small identity label a template sets on every slide.
 */
export function drawSlide(slide, grammar, template, { aspect = "4:5", cue = false, number = 1, byline = null, name = null, page = null } = {}) {
  const type = template.type;
  const headline = words(slide.headline);
  const body = words(slide.body);
  const image = words(slide.photo) || null;
  const label = words(slide.eyebrow) || byline || "";
  const asks = cue && !/\bswipe\b|→/i.test(`${headline} ${body} ${label}`);
  // A template with a swipe line asks under the headline instead of over it.
  const swipe = asks && type.swipe ? type.swipe.toUpperCase() : null;
  const eyebrow = asks && !swipe ? (label ? `${cut(label, 28)} →` : "Swipe →") : label || undefined;
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
    const share = Math.min(type.share?.[slide.role] ?? 0.47, aspect === "1:1" ? 0.5 : 0.62);
    const panel = swipe ? { body: swipe } : extra;
    return { module: "split-screen", params: drop({ media: image, variant: "top", share, kicker: eyebrow, title: type.case === "caps" ? headline.toUpperCase() : headline, align: type.align, ...panel }) };
  }
  if (grammar === "framed-image") return { module: "landscape-card", params: drop({ media: image, kicker: eyebrow, title: headline, caption: body || undefined }) };
  if (grammar === "two-region") {
    const pair = slidePair(slide);
    return { module: "compare", params: { mode: pair.negative ? "before-after" : "columns", variant: type.compare, left: { title: pair.left.title, items: [pair.left.text] }, right: { title: pair.right.title, items: [pair.right.text] } } };
  }
  if (grammar === "proof-stat") {
    const figure = slideFigure(slide);
    const text = cut(figure.label, 48);
    if (image) return { module: "media-stat", params: drop({ media: image, variant: "behind", value: figure.value, label: cut(text, 40), source: figure.source, kicker: eyebrow }) };
    if (figure.source) return { module: "stat-card", params: { value: figure.value, label: text, source: figure.source, variant: type.stat } };
    return { module: "concept-card", params: drop({ text: figure.value, sub: cut(text, 64), variant: "free" }) };
  }
  if (grammar === "steps") {
    const items = slideItems(slide).slice(0, 6);
    return { module: "item-list", params: drop({ title: headline || undefined, items, variant: type.list, ...(slide.role === "payoff" && type.ticks ? { ticks: true } : {}) }) };
  }
  if (grammar === "step") return { module: "section-card", params: drop({ title: headline, kicker: cut(words(slide.eyebrow) || "Step", 28), number: Math.min(99, number), variant: type.step }) };
  // text-card
  const emphasis = emphasisOf(slide, headline);
  // A feed poster: every type slide of the template, the call to action included.
  if (type.poster && !slide.quote) return { module: "section-card", params: drop({ title: cut(headline, 48), kicker: eyebrow, sub: (body || (slide.role === "cta" ? words(slide.handle) : "")) ? cut(body || words(slide.handle), 90) : undefined, footer: name ? cut(name, 32) : undefined, page: page ?? undefined, variant: "poster" }) };
  // A note: the account's own words under its name and handle, as a text post (the call to action too).
  if (type.note && (name || byline) && !slide.quote) return { module: "quote-card", params: drop({ quote: headline, author: cut(name || byline, 40), role: byline && name ? byline : undefined, variant: type.quote }) };
  if (slide.role === "cta") return { module: "cta", params: drop({ action: cut(headline, 40), emphasis, detail: body || undefined, handle: words(slide.handle) || undefined, variant: type.cta }) };
  if (slide.quote) return { module: "quote-card", params: drop({ quote: words(slide.quote.text), author: words(slide.quote.author), role: words(slide.quote.role) || undefined, highlight: emphasisOf(slide, words(slide.quote.text)), variant: type.quote }) };
  if (body || type.case === "sentence") {
    // motion-title lights whole words (1–3), so a phrase goes in word by word.
    const highlight = emphasis?.split(/\s+/).slice(0, 3);
    return { module: "motion-title", params: drop({ text: headline, kicker: eyebrow, sub: body || undefined, highlight: highlight?.length === 1 ? highlight[0] : highlight, ...(highlight && type.mark ? { mark: type.mark } : {}), align: type.align, variant: type.title }) };
  }
  return { module: "hook-title", params: drop({ headline, emphasis, eyebrow, variant: type.hook }) };
}

/** The scene's own backdrop for a role's surface: a brand-lit plate, a photo under the reading layer, or none (the ground). */
export function surfacePlate(template, surface, slide, grammar) {
  if (surface === "brand" && template.brandPlate) return { kind: template.brandPlate.kind, params: { tint: template.brandPlate.tint } };
  // A photo grammar draws its own photo; a type-only slide with a photo sets it behind the reading layer.
  if (surface === "on-image" && words(slide?.photo) && !CAROUSEL_GRAMMARS[grammar].needsImage && grammar !== "proof-stat") {
    const { dim, blur } = template.reading ?? { dim: READING_LAYER, blur: 6 };
    return { kind: "image", params: { src: words(slide.photo), dim, blur } };
  }
  return null;
}

// --- grounds: the brand turned over, on its primary, or taken to a pure page ---
const HEX = /^#[0-9a-f]{6}$/i;
const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255); };
export const contrastRatio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mixHex = (a, b, t) => `#${[16, 8, 0].map((s) => Math.round(((parseInt(a.slice(1), 16) >> s) & 255) * (1 - t) + ((parseInt(b.slice(1), 16) >> s) & 255) * t).toString(16).padStart(2, "0")).join("")}`;
// The colour moved toward `ink` until it keeps 4.5:1 on `ground`.
const onGround = (hex, ground, ink) => { let out = hex; for (let t = 0.1; contrastRatio(out, ground) < 4.5 && t <= 1.0001; t += 0.1) out = mixHex(hex, ink, Math.min(1, t)); return out; };
// ink is the type on a primary fill (a cta pill): whichever candidate reads best on it.
const withInk = (out, candidates) => ({ ...out, ink: [...candidates].sort((a, b) => contrastRatio(b, out.primary) - contrastRatio(a, out.primary))[0] });
const brandColors = (brand) => {
  const colors = { ...(brand?.colors ?? {}) };
  const sorted = Object.values(colors).filter((hex) => HEX.test(String(hex))).sort((a, b) => luminance(b) - luminance(a));
  return { colors, sorted, primary: HEX.test(colors.primary ?? "") ? colors.primary : sorted[0] };
};

/**
 * The brand on a light ground: its palest colour (else a near-white tinted by
 * its primary) as bg, its darkest as type (paper and ink), primary and accent
 * darkened until they read on it. pure: the ground taken to a near-white page.
 * palette "as-given", so nothing moves it back.
 */
export function lightBrand(brand, { pure = false } = {}) {
  const { colors, sorted, primary } = brandColors(brand);
  if (!sorted.length) return brand;
  const pale = luminance(sorted[0]) >= 0.75 ? sorted[0] : mixHex(primary, "#ffffff", 0.92);
  const bg = pure ? mixHex(pale, "#ffffff", 0.85) : pale;
  const dark = luminance(sorted.at(-1)) <= 0.05 ? sorted.at(-1) : mixHex(sorted.at(-1), "#000000", 0.75);
  const ink = pure ? mixHex(dark, "#000000", 0.5) : dark;
  const lead = onGround(primary, bg, ink);
  return { ...brand, palette: "as-given", colors: withInk({ ...colors, bg, paper: ink, primary: lead, accent: onGround(HEX.test(colors.accent ?? "") ? colors.accent : lead, bg, ink) }, [bg, ink]) };
}

/** The brand on its own dark ground, taken to a near-black page in its hue. */
export function pureDarkBrand(brand) {
  const { colors, sorted } = brandColors(brand);
  if (!sorted.length) return brand;
  const bg = mixHex(sorted.at(-1), "#000000", 0.7);
  const paper = mixHex(sorted[0], "#ffffff", 0.6);
  return { ...brand, palette: "as-given", colors: withInk({ ...colors, bg, paper, primary: onGround(colors.primary ?? paper, bg, paper), accent: onGround(colors.accent ?? colors.primary ?? paper, bg, paper) }, [bg, paper]) };
}

/**
 * The brand's primary as the page: the type in whichever of its palest and
 * darkest colours reads better on it, and the accent (else that type colour)
 * moved until it reads too.
 */
export function brandGroundBrand(brand) {
  const { colors, sorted, primary } = brandColors(brand);
  if (!sorted.length) return brand;
  const type = [sorted[0], sorted.at(-1)].sort((a, b) => contrastRatio(b, primary) - contrastRatio(a, primary))[0];
  const ink = contrastRatio(type, primary) >= 4.5 ? type : luminance(primary) > 0.18 ? "#111111" : "#fafafa";
  // The renderers set small labels in muted type (the ink at 62% over the page) and refuse it under 3:1,
  // so a mid-tone primary is deepened (or lifted) away from the ink until that reads.
  let bg = primary;
  for (let t = 0.05; contrastRatio(mixHex(bg, ink, 0.62), bg) < 3.2 && t <= 1.0001; t += 0.05) bg = mixHex(primary, luminance(ink) > 0.18 ? "#000000" : "#ffffff", Math.min(1, t));
  const accent = HEX.test(colors.accent ?? "") && contrastRatio(colors.accent, bg) >= 3 ? onGround(colors.accent, bg, ink) : ink;
  return { ...brand, palette: "as-given", colors: withInk({ ...colors, bg, paper: ink, primary: accent, accent }, [bg, ink, ...sorted]) };
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
  const list = Array.isArray(slides) ? slides : [];
  const handle = words((list.find((slide) => slide?.role === "cta" && words(slide.handle)) ?? list.find((slide) => words(slide?.handle)))?.handle);
  const byline = template.type.byline && handle ? cut(handle.startsWith("@") ? handle : `@${handle}`, 24) : null;
  // The brand's name for a byline or a footer: brand.name, else the handle without its @.
  const name = words(brand?.name) || (handle ? handle.replace(/^@/, "") : "") || null;
  let steps = 0;
  const scenes = list.map((slide, i) => {
    const grammar = slideGrammar(slide, template);
    if (grammar === "step") steps += 1;
    const surface = template.surface[slide.role] ?? template.ground;
    const { module, params } = drawSlide(slide, grammar, template, { aspect, cue: i === 0 && list.length > 1, number: steps, byline: slide.role === "cta" && list.length > 1 && !template.type.note ? null : byline, name, page: String(i + 1).padStart(2, "0") });
    const plate = surfacePlate(template, surface, slide, grammar);
    return { id: words(slide.id) || `slide-${i + 1}`, grammar, surface, module, params, ...(plate ? { plate } : {}) };
  });
  const turned = !brand ? null : template.ground === "light" ? lightBrand(brand, { pure: template.pure }) : template.ground === "brand" ? brandGroundBrand(brand) : template.pure ? pureDarkBrand(brand) : null;
  const story = {
    ...(template.plate ? { plate: { kind: template.plate.kind, params: { tint: template.plate.tint } } } : { background: { kind: template.background } }),
    ...(turned ? { brand: turned } : {})
  };
  return { template: templateId, story, scenes };
}
